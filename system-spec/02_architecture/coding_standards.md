# Coding Standards — Code & Function Writing Style (Frontend · Backend · Database · AI)

> **Status:** Authoritative TARGET-STATE rebuild specification. Build to **this**, not to the live `web/` + Supabase Edge-Function prototype. Where this document and an upstream study report disagree, this document wins; where it disagrees with a verified API fact, the file author flags it.
>
> **Scope of this file.** The *minutest* code- and function-authoring rules for the entire rebuild — language/runtime, module organization, naming, function design (size/purity/error handling/return types), typing, async patterns, dependency rules (ports/adapters), comments/docstrings, lint/format, and commit conventions. Every rule here is **concrete and enforceable**: it is either a lint rule, a CI fitness rule, a `tsconfig` flag, a typecheck, or a merge-blocking review-gate checklist item. Aspirational prose without an enforcement hook does not belong in this file.
>
> **Foundation.** These standards extend `dis/document_ingestion_service/02_architecture/coding_standards.md` (verified on `origin/feat/dis-plan`) from one service (document ingestion) to the whole OPD system (frontend + backend + database + AI). The `dis/` skeleton already obeys most of this: `strict` `tsconfig`, flat ESLint with `consistent-type-imports` + guarded `no-explicit-any`, `.prettierrc.json` (printWidth 100, singleQuote, trailingComma all), `.editorconfig` (2-space, LF, final newline), `.nvmrc` (Node 20), and `scripts/fitness-rules.json` (6 CI merge-blockers). We **copy that wholesale** and add the rules a clinical, bilingual, AI-streaming, multi-context system needs.
>
> **Companion documents.** Architecture spine: `overview.md`. Service decomposition: `backend_services.md`. Frontend: `frontend_architecture.md`, `frontend_design_system.md`. Database DDL/migration: `04_database/`. AI orchestration internals: `05_ai/`. API/SSE/ABDM: `06_api/`, `07_integrations/`. Security/RLS/DPDP: `08_security/`. The TDD/eval *operating model* (review gates, agentic-dev protocol, drift control, OpenAPI-as-truth, quality gates) lives in `09_engineering_discipline/` — this file defines the *style rules* those gates enforce, not the runner.

---

## 0. How to read this file

Each rule carries an **enforcement tag** in the right-hand column of its table, or inline as `[tag]`:

| Tag | Meaning | Where it fails the build |
|---|---|---|
| `tsc` | TypeScript compiler / `tsconfig` flag | `npm run typecheck` |
| `lint` | ESLint rule (flat config) | `npm run lint` |
| `fmt` | Prettier / EditorConfig | `npm run format:check` |
| `fit` | CI fitness rule (`scripts/fitness-rules.json` regex over source) | `npm run fitness` |
| `ci` | A dedicated CI job (audit, spec-diff, golden-parity, license) | the named CI workflow |
| `hook` | Pre-commit / pre-push git hook | local commit/push |
| `gate` | Human review-gate checklist item (`09_engineering_discipline/code_review_standards.md`) | PR approval |

A rule with **no** enforcement tag is not a rule — it is a note. If you propose one, propose its enforcement hook in the same PR. **Violations are not style preferences; they are merge blockers.**

---

## 1. Language, runtime & toolchain (one stack, no exceptions)

| Decision | Value | Enforcement |
|---|---|---|
| Language | **TypeScript, `strict: true`** everywhere — backend, workers, and the SPA. No plain JS in `src/`/`ui/src/` (config files may be `.mjs`). | `tsc` |
| Backend/worker runtime | **Node 20 LTS**, ESM only (`"type": "module"`). No CommonJS. Bun-compatible (no Node-only API without a portability shim — that is why Hono is the HTTP framework). | `.nvmrc`, `package.json#engines`, `tsc` (`module: NodeNext`) |
| Frontend runtime | **Vite + TypeScript SPA** (React or the framework `dis/ui` settles on — match it; do not introduce a second). Replaces the 8 single-file HTML pages and ~21k lines of duplicated inline JS/CSS. | `gate` |
| HTTP framework | **Hono** (portable Node/Deno/Bun/Lambda; ADR-005). Never Supabase Edge Functions for long-running compute. | `gate` |
| DB driver | **`postgres` (porsager)** — parameterized `` sql`` `` / `sql.unsafe`. **No ORM** (no Drizzle/Prisma); schema lives only in migrations (ADR-006). | `fit` (`core_no_sql_literals`), `gate` |
| Migrations | **dbmate**, forward + `.rollback.sql`; CI verifies up→down→up and pg_dump schema-diff. | `ci` |
| Validation | **Zod** (env + DTO boundaries) + **Ajv** (clinical JSON payloads, formulary schema). | `gate`, `ci` |
| Logging | **pino** + correlation IDs + PII redactor. No `console.log` in production code. | `lint` (`no-console`), `gate` |
| Tests | **vitest**; fakes-only core suites must run < 1 s. | `ci` |
| AI SDK | **`@anthropic-ai/sdk`**, used **only** inside the `model/anthropic` adapter. | `fit` |

**`tsconfig.json` — the exact flags (copy from `dis/`, do not soften):**

```jsonc
{
  "compilerOptions": {
    "strict": true,                          // [tsc] non-negotiable
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,        // [tsc] arr[i] is T | undefined — forces narrowing
    "noImplicitOverride": true,              // [tsc] `override` keyword required
    "noUnusedLocals": true,                  // [tsc] add for the rebuild
    "noUnusedParameters": true,              // [tsc] (prefix intentionally-unused with _)
    "exactOptionalPropertyTypes": true,      // [tsc] {x?: T} ≠ {x: T | undefined}
    "noFallthroughCasesInSwitch": true,      // [tsc] safety net under assertNever
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

> The four flags added beyond the `dis/` baseline (`noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`) are mandatory for the rebuild. They are cheap to obey from a clean start and prevent whole classes of clinical bugs (a silently-unread `weight`, a fall-through that skips a max-dose cap).

---

## 2. Typing rules (the type system is the first test)

| # | Rule | Enforcement |
|---|---|---|
| T1 | **No `any` without justification.** Every `any` carries a `// reason: …` comment on the same or preceding line. Prefer `unknown` and narrow at the boundary. | `lint` (`@typescript-eslint/no-explicit-any: warn`) + `gate` |
| T2 | **No `// @ts-ignore`.** If unavoidable, use `// @ts-expect-error reason: <cause> (#ticket)` so it self-removes when the cause is fixed. | `lint`, `gate` |
| T3 | **Discriminated unions for all state, results, and events.** A literal discriminator field (`kind` / `type` / `status`). Models: `state-machine.ts` `State` (string literals) and `Event` (`{kind: …}` union), verified on-branch. | `gate` |
| T4 | **Exhaustiveness via `assertNever`.** Every `switch` on a discriminator ends `default: return assertNever(x)`. Ship one shared `assertNever(x: never): never` (already in `dis/src/types/assert-never.ts`). | `tsc` (the `never` arg fails on a missed case) + `gate` |
| T5 | **`readonly` by default.** `readonly` on interface fields and `readonly T[]` on collection params/returns. Mutate locals only; never a caller's array. Use `toSorted`/`toReversed`/spread, never in-place `push`/`sort` on inputs. | `gate` (consider `eslint-plugin-functional` `prefer-readonly-type`) |
| T6 | **Validate at every boundary, trust within.** Untyped data (HTTP body, DB row of unknown shape, AI tool output, ABDM callback) is `unknown` until a Zod parse (transport DTOs) or Ajv validate (clinical JSON, formulary) returns a typed value. Inside a context, types are trusted. | `gate`, `ci` (Ajv schema in CI) |
| T7 | **Branded primitives for clinical identifiers.** `Uhid`, `PatientId`, `VisitId`, `Icd10Code`, `LoincCode`, `MicroINR` are `string & { readonly __brand: '…' }` (or a Zod brand), never bare `string`/`number`. A weight in **kg** and a dose in **mg** must not be interchangeable. Cost is integer micro-INR (`MicroINR`), never a float. | `tsc` + `gate` |
| T8 | **No structural primitive obsession in signatures.** A function taking 3+ same-typed positional args (e.g. `(weight, height, age)`) takes a single named-fields object instead — mirrors `ComputeDoseParams`. | `gate` |
| T9 | **`type` for unions/aliases, `interface` for object contracts/ports.** Ports are `interface`. | `gate` |
| T10 | **Type-only imports are explicit.** `import type { … }`. | `lint` (`@typescript-eslint/consistent-type-imports: error`, already on-branch) |

**Branded-identifier pattern (canonical):**

```ts
// core/types/ids.ts — pure, no I/O
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type PatientId = Brand<string, 'PatientId'>;
export type Uhid       = Brand<string, 'Uhid'>;      // RKH-<FY4><MM2><SEQ5> (^RKH-\d{11}$) — business key, never a PK
export type Icd10Code  = Brand<string, 'Icd10Code'>;
export type MicroINR   = Brand<number, 'MicroINR'>;  // integer micro-rupees; cost ledger unit

// Construction is the only place the brand is applied, and it validates:
export function toUhid(raw: string): Uhid {
  if (!/^RKH-\d{4}\d{5}$/.test(raw)) throw new InvalidUhidError(raw);
  return raw as Uhid;
}
```

---

## 3. Module & repository organization

### 3.1 Layout (the monorepo template — copy `dis/` wholesale)

```
src/
  core/        pure TS — NO fetch, NO fs, NO SQL, NO adapter imports   [fit-enforced]
  ports/       interfaces only — the narrow waist — NO adapter imports [fit-enforced]
  adapters/    vendor edge; each adapter has a __fakes__/ peer
  http/        Hono router + middleware + SSE relay (thin)
  workers/     off-edge long-running compute (generation, FHIR, ABDM)
  wiring/      the ONLY composition root that picks adapters by env
ui/            Vite + TS SPA; mirrors the server's port pattern client-side
scripts/       fitness-rules.json, migration helpers, parity-fixture runner
migrations/    dbmate forward + .rollback.sql
```

### 3.2 Organization rules

| # | Rule | Enforcement |
|---|---|---|
| M1 | **Folder by feature/context, not by layer.** `core/dose-engine.ts` + `core/dose-engine.test.ts` sit together. No `controllers/`, `services/`, `utils/` buckets. A `util.ts` grab-bag is a review block. | `gate` |
| M2 | **Bounded contexts are first-class.** `catalog`, `clinical`, `prescribing`, `identity`, `abdm`, `ops`, `generation` are top-level groupings in `core/` and own their Postgres schema (§5 of `04_database/`). Cross-context calls go through the **command/event bus**, never a direct function import into another context's internals. | `gate` (+ `fit` boundary rule once contexts settle) |
| M3 | **One public export per file when feasible; name the file after it.** `state-machine.ts` exports `transition`; `error-envelope.ts` exports `toEnvelope`. | `gate` |
| M4 | **Barrel files only at package boundaries.** `ports/index.ts`, `adapters/*/index.ts`. Deep imports *within* a package are fine; deep imports *across* a boundary are not. | `gate` |
| M5 | **`core/` imports only `ports/` and other `core/`.** `ports/` imports only `core/` types. Adapters import their vendor SDK + ports. `http/`/`workers/` import core + ports; `wiring/` is the only place that imports adapters. | `fit` (`core_no_adapter_imports`, `ports_no_adapter_imports`) |
| M6 | **No shared mutable module state.** Singletons (db pool, logger, model client) are constructed in `wiring/` and injected. No top-level `let` holding request state. | `gate` |
| M7 | **`createServer()` / `createApp()` returns a fresh instance per call** for test isolation (the `dis/` pattern). No ambient app singleton. | `gate` |

### 3.3 The dependency-direction diagram (memorize it)

```
        ui/ components ──▶ ui/ ports ──▶ ui/ adapters ──▶ network
                                                              │
   ┌──────────────────────────────────────────────────────────┘
   ▼
  http/ ─┐
  workers/├──▶ core/ ◀── ports/ ◀── adapters/ ──▶ Postgres · Storage · Anthropic · ABDM
  wiring/─┘      ▲          ▲           ▲
                │          │           └─ each has __fakes__/ peer (tests bind fakes)
        depends on        defines           imports vendor SDK ONLY here
        abstractions      contracts
        (never on a       (no impl)
         concrete adapter)
```

The arrows **never** reverse. `core/` knowing the word `claude-opus-4-8`, `@supabase/supabase-js`, or `fetch` is a CI failure, not a code-review opinion.

---

## 4. Dependency rules — ports, adapters & anti-corruption (the heart of it)

### 4.1 The fitness rules (CI merge-blockers — extend `dis/scripts/fitness-rules.json` to every context)

| Rule | Forbidden in | Why |
|---|---|---|
| `core_no_adapter_imports` | `src/core/**` | DIP — core depends on abstractions only |
| `ports_no_adapter_imports` | `src/ports/**` | ports are the contract, not a consumer |
| `core_no_fetch` | `src/core/**` | no network I/O in core |
| `core_no_xhr` | `src/core/**` | no `XMLHttpRequest` in core |
| `core_no_sql_literals` | `src/core/**` | SQL lives at the adapter boundary only |
| `supabase_sdk_only_in_supabase_adapters` | all but `adapters/**/supabase-*` | vendor SDK containment |
| `aws_sdk_only_in_aws_adapters` | all but `adapters/**/{s3,aws-,sqs}*` | vendor SDK containment |
| **`core_no_model_id_literals`** *(new)* | `src/**` outside `adapters/model/**` | **no `claude-*` / `us.anthropic.*` / `claude-opus`/`sonnet`/`haiku` string in business code.** *A hardcoded dated model ID retired and broke production. The model lives behind `ModelPolicyPort` config only.* |
| **`ui_no_raw_fetch_in_components`** *(new)* | `ui/src/components/**`, `ui/src/pages/**` | no raw `fetch(` / Supabase client / anon key in components — they go through `DataAccessPort`/`GenerationPort` |
| **`no_hardcoded_supabase_url`** *(new)* | `src/**`, `ui/src/**` outside `wiring/`/`ConfigPort` | no `*.supabase.co` literal, no anon/JWT key literal anywhere in source |

`core_no_model_id_literals` regex (illustrative): `claude-(opus|sonnet|haiku)|us\.anthropic\.` over `src/**` and `ui/src/**`, excluding `adapters/model/**` and `**/*.test.ts` fixture data.

### 4.2 Port design rules

| # | Rule | Enforcement |
|---|---|---|
| P1 | **Ports are narrow and single-purpose (ISP).** `DosingPort` does dosing, not formulary lookup; `ClinicalKnowledgePort` does knowledge fetch, not generation. A port that grows a second responsibility is split. | `gate` |
| P2 | **Ports expose named domain methods, not a generic escape hatch into the vendor.** `DatabasePort` exposes `findVisit`, `insertDraft`, `setSessionVars`, `transaction(work)` — plus a parameterized `query<T>(sql, params)` whose callers own row-shape validation. SQL strings live in adapters/query modules, never in `core/`. (Verified pattern: `dis/src/ports/database.ts`.) | `fit` + `gate` |
| P3 | **Every adapter has a `__fakes__/` peer** implementing the same port deterministically (scripted responses, no network). Core tests bind fakes; suites run < 1 s. | `ci`, `gate` |
| P4 | **Adapters honor the port contract exactly (LSP).** No silent behavior drift between `supabase-postgres` and `aws-rds`, or between `pg-cron` queue and `sqs`. Contract tests run the **same** suite against every adapter of a port. | `ci` |
| P5 | **Anti-corruption layer around every vendor.** The Anthropic API, ABDM gateway, Fidelius crypto, and OCR provider are wrapped; their wire shapes never leak into `core/`. The model behind `ModelPolicyPort`; ABDM behind `AbdmGatewayPort`; crypto behind `CryptoBoxPort`; signing behind `SignaturePort`. | `gate` |
| P6 | **Config & secrets only via `ConfigPort` / `SecretsPort`.** No hardcoded URL/key/**model** anywhere — client or server. Env is parsed once at boot via the Zod `env.schema.ts` (fail-fast). | `fit`, `gate` |

### 4.3 The port catalog (build to these — see `overview.md` §1.1)

**Server:** `DatabasePort` · `StoragePort` · `QueuePort` · `SecretsPort` · `ConfigPort` · `ModelPolicyPort` · `ClinicalKnowledgePort` · `DosingPort` · `GrowthEnginePort` · `RealtimePort` · `FhirCompositionPort` · `AbdmGatewayPort` · `CryptoBoxPort` · `SignaturePort` · `EventBus`/`CommandBus`.
**Client (anti-corruption seams — no component touches a vendor):** `DataAccessPort` · `GenerationPort` (streaming, states `idle|streaming|ready|stale|error|timeout`) · `TranscriptionPort` (dual-engine VAD) · `ConfigPort` · `PrintPort` · `RealtimePort` (SSE/status-row) · `EventBus`/`CommandBus`.

### 4.4 The dependency budget

| # | Rule | Enforcement |
|---|---|---|
| D1 | **Every new runtime dependency requires a justification comment in the PR** and a one-line entry in the PR description. | `gate` |
| D2 | **No AGPL / SSPL / non-OSI licenses.** | `ci` (license check) |
| D3 | **Lockfile committed; deps pinned.** `package-lock.json` in every PR that touches deps. | `gate` |
| D4 | **`npm audit` blocks HIGH/CRITICAL** on PR. | `ci` |
| D5 | **No transitive runtime fetches** — everything declared in `package.json`. | `gate` |

---

## 5. Function design (size · purity · return types · error handling)

### 5.1 Shape & size

| # | Rule | Enforcement |
|---|---|---|
| F1 | **One function, one job (SRP).** A function that "fetches and validates and persists and notifies" is four functions. | `gate` |
| F2 | **Soft size budget: ≤ 50 lines / ≤ 4 params / cyclomatic complexity ≤ 10.** Over budget needs a one-line justification comment. The pure clinical kernels (`computeDose` is ~175 lines) are the *deliberate* exception — they are exhaustively branched dosing logic with golden fixtures, not sprawl. | `lint` (`max-lines-per-function`, `max-params`, `complexity` as `warn` → `gate`) |
| F3 | **Pure by default; side effects are named and isolated.** A function that does I/O is `async` **and** carries a verb that announces the effect (`write`, `persist`, `send`, `fetch`, `enqueue`, `emit`). A pure transform never has such a verb. The dose engine and growth engine are **100% pure** (zero DOM/IO) — `fit`-checked the same way `core/` is. | `fit` (engines under `core/`) + `gate` |
| F4 | **No boolean-flag parameters that switch behavior.** `render(rx, true)` is two functions (`renderForScreen` / `renderForPrint`). | `gate` |
| F5 | **No default-export functions** in `src/`/`ui/src/` (named exports only; aids refactor + grep). | `lint` (`import/no-default-export`) |
| F6 | **Functions return a value or `void`/`Promise<void>`; they do not return *and* mutate an argument.** | `gate` |

### 5.2 Return types & error handling — the two-channel rule

This is the most important function-design rule in the system, because clinical correctness depends on it.

> **Expected failures are values (`Result<T, E>` / discriminated unions). Unexpected failures are thrown typed errors. Core never `throw`s for expected control flow.**

| # | Rule | Enforcement |
|---|---|---|
| E1 | **Typed error classes, never bare strings.** Each module exposes its hierarchy: a base `XxxError extends Error` with a `readonly code`, subclassed per case. Models verified on-branch: `VersionConflictError`, `InvalidStateTransitionError`, `NativePdfUnavailableError`. Add: `InvalidUhidError`, `DoseRangeExceededError`, `DoseMismatchError`, `FormularyMissError`, `ModelOverloadedError`, `AbdmGatewayError`. | `gate` |
| E2 | **Expected, caller-handled outcomes are `Result`/unions, not exceptions.** A formulary miss, a low-confidence OCR, a dose at cap → a discriminated result the caller must branch on (and `assertNever` makes them). Throwing for these defeats exhaustiveness. | `gate` |
| E3 | **Errors cross the HTTP/worker boundary as the canonical envelope** `{ error: { code, message, correlation_id, retryable? } }` — never a raw stack trace, never a vendor error shape. Builder: `core/error-envelope.ts` `toEnvelope(err, correlationId?)` (verified). | `gate`, `ci` (error-model spec-diff) |
| E4 | **Never swallow.** Every `catch` logs (with correlation id) or rethrows. `catch (e) { /* ignore */ }` is a lint error. | `lint` (`no-empty` + `@typescript-eslint/no-unused-vars` on the binding) + `gate` |
| E5 | **No `throw` in pure `core/` kernels for expected outcomes.** `computeDose` returns `{ capped, warnings[] }`; it does not throw when a dose hits a cap — it flags. It *may* throw `DoseRangeExceededError` only for a programming-error input (negative weight). | `gate` |
| E6 | **`stop_reason: "refusal"` and overload are checked before reading content** in the model adapter; map to typed errors, never index `content[0]` blindly. | `gate`, `ci` (AI eval) |
| E7 | **Optimistic-lock conflicts surface as `409 VERSION_CONFLICT`** carrying expected vs actual version (`VersionConflictError`). | `gate` |

**Canonical Result type (ship once in `core/types/result.ts`):**

```ts
export type Result<T, E> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok  = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

**Error-class pattern (canonical — mirrors `dis/src/core/errors.ts`):**

```ts
export class DoseRangeExceededError extends Error {
  public override readonly name = 'DoseRangeExceededError';
  public readonly code = 'DOSE_RANGE_EXCEEDED' as const;
  constructor(
    public readonly drug: string,
    public readonly requestedMg: number,
    public readonly maxMg: number,
  ) {
    super(`Dose for ${drug} (${requestedMg}mg) exceeds cap ${maxMg}mg`);
  }
}
```

### 5.3 The clinical-safety function laws (clamp these hardest)

| # | Law | Enforcement |
|---|---|---|
| C1 | **The AI never computes a number that reaches paper.** The AI proposes drug + regimen with **no numeric dose fields**; the pure `DoseEnginePort` (`computeDose`, signatures verified on `sprint-2-saved`) recomputes mg/ml/drops from concentration + band + weight/BSA and rebuilds the bilingual R2/R3 + pictogram. | `gate`, `ci` (AI eval: no numeric fields in model output schema) |
| C2 | **Server re-checks the engine byte-for-byte — no tolerance.** A client/AI dose that disagrees with the recompute is **rejected** (the 20% override is not honored); mismatch → `REVIEW REQUIRED`. | `gate`, `ci` |
| C3 | **Golden JS↔TS parity fixtures gate any trust in the engine** (≥ 20 cases: syrups round 0.5 ml, drops 0.1 ml, tablets 0.25; single/daily caps; bilingual strings). `sprint-2-saved` ships the TS port **without** fixtures — that gap is closed *before* the engine is trusted. | `ci` (parity job is a merge blocker) |
| C4 | **A draft is `pending_review` until a human `SignOff` command.** No code path auto-finalizes. Identical fail-closed gate to OCR `promotion.ts` (CS-1/CS-7). | `gate`, `ci` (state-contract test) |
| C5 | **The state machine `transition(state, event)` is the only legal state-change path**; invalid transitions throw and are never persisted; even failure paths route through `transition()`. | `gate`, `ci` |
| C6 | **Preterm corrected/chronological age is computed on the client/engine, never by the AI.** | `gate` |
| C7 | **No PII to the model.** PII-stripping in `get_previous_rx`/visit-summary is a typed boundary function with its own test, not an ad-hoc `.map`. | `gate`, `ci` (eval asserts no PII in prompt) |

---

## 6. Async, concurrency & the latency design

The headline UX promise (perceived wait ≈ 0, never an infinite spinner) is a **code-style** constraint as much as an architecture one.

| # | Rule | Enforcement |
|---|---|---|
| A1 | **No long-running compute in a request handler.** Generation, FHIR build, and ABDM push run on off-edge workers pulling from the durable queue. A handler that awaits the Claude tool loop is rejected. | `gate` (+ perf budget `ci`) |
| A2 | **Every outbound AI/network call carries an `AbortController` and a hard deadline.** No unbounded `await fetch`. On deadline → typed timeout → degraded UI (retry / manual edit / single-shot), never an infinite spinner. | `gate` |
| A3 | **Streaming for large `max_tokens`.** The worker uses `client.messages.stream(...)` and `getFinalMessage()` for timeout-protected completion (the SDK refuses non-streaming above ~16K tokens; prescription generation is ~16K+). It emits domain events (`GenerationStarted`, `ToolInvoked`, `DraftDelta`, `GenerationCompleted`, `GenerationFailed`). | `gate`, `ci` |
| A4 | **Retry with exponential backoff + jitter** on 429/5xx; **model-tier downgrade** (Opus 4.8 → Sonnet 4.6) on overload via `ModelPolicyPort`, **flagged** — never a silent clinical-model-class downgrade. | `gate` |
| A5 | **Parallel independent I/O uses `Promise.all`** (the 5 clinical tools execute in parallel). Never serialize independent awaits in a loop. | `gate` |
| A6 | **Read-modify-write goes through a DB transaction or `SELECT … FOR UPDATE`.** Server-side ID allocation (UHID/receipt/token) uses `UPDATE … RETURNING` under row lock behind a `SECURITY DEFINER` function — the client-side `MAX(seq)+1` race is deleted. | `gate`, `ci` (race fixture) |
| A7 | **Every mutating command is idempotent.** `Idempotency-Key` mandatory on writes (middleware verified in `dis/`); DB writes use `ON CONFLICT` or a pre-check; speculative generation dedups on a `content_hash` of `{note, patient_context_version, selected_sections}` (last-write-wins supersedes in-flight runs). This dedup is also what kills the prototype's 3× `raw_dictation` write. | `gate`, `ci` |
| A8 | **No floating promises.** Every promise is awaited, returned, or explicitly `void`-ed with a reason. | `lint` (`@typescript-eslint/no-floating-promises: error`) |
| A9 | **No `async` without `await`** (a function declared `async` that never awaits hides intent). | `lint` (`@typescript-eslint/require-await`) |

**Streaming-state contract (the `GenerationPort` state union — exact literals):**

```ts
export type GenerationState =
  | { kind: 'idle' }
  | { kind: 'streaming'; jobId: string; delta: string }
  | { kind: 'ready'; jobId: string; draftId: string }
  | { kind: 'stale'; reason: 'note_changed' }     // speculative draft superseded
  | { kind: 'error'; code: string; retryable: boolean }
  | { kind: 'timeout' };
// Consumers MUST handle every case (assertNever in the render switch).
```

---

## 7. Naming conventions (one table, no ambiguity)

| Element | Convention | Example |
|---|---|---|
| Files (TS) | `kebab-case.ts`; name after the single export | `dose-engine.ts`, `error-envelope.ts`, `command-bus.ts` |
| Test files | sibling `*.test.ts` | `dose-engine.test.ts` |
| Adapter files | `<vendor>-<port>.ts` under `adapters/<port>/` | `adapters/database/supabase-postgres.ts`, `adapters/queue/sqs.ts` |
| Fakes | `__fakes__/<port>.ts` | `core/__fakes__/database.ts` |
| Types / interfaces / classes | `PascalCase`; ports end `Port`; errors end `Error`; events are commands/events nouns | `DosingPort`, `DoseMismatchError`, `DraftNoteUpdated` |
| Functions / variables | `camelCase`; side-effecting fns lead with a verb (`persistDraft`, `sendSignedRx`); pure transforms are noun-ish (`computeDose`, `bilingualLabel`) | — |
| Constants (module-level immutable maps) | `UPPER_SNAKE` for true constants, `camelCase` for derived | `FREQ_EN`, `HINDI_DROPS`, `DROPS_PER_ML` (verified in dose-engine) |
| Booleans | predicate prefix `is`/`has`/`should`/`can` | `isPreterm`, `hasAllergyConflict`, `shouldAutoFlag` |
| Commands (bus) | imperative verb-phrase, `PascalCase` | `SaveNote`, `AdjustDose`, `RequestGeneration`, `SignOff`, `GiveVaccination` |
| Events (bus) | past-tense, `PascalCase` | `NoteSaved`, `DraftReady`, `PrescriptionSigned`, `GenerationFailed` |
| React components | `PascalCase` `.tsx`, one component per file | `MedicineCard.tsx`, `SignoffGate.tsx` |
| Hooks | `useXxx` | `useGenerationStream` |
| CSS / design tokens | `--rkh-*` custom properties; colour tokens only (`--rkh-color-med` blue, `--rkh-color-investigation` red, `--rkh-color-default` black) | no inline style literals |
| DB schemas / tables / columns | `snake_case`, plural tables, schema-qualified | `clinical.lab_results`, `prescribing.rx_generation_jobs` |
| Migrations | dbmate timestamp prefix + `.sql` + `.rollback.sql` | `20260701000000_rx_generation_jobs.sql` |
| Env vars | `UPPER_SNAKE`, `DIS_`/`RKH_` prefix for app config | `DIS_STACK`, `RKH_MODEL_POLICY`, `ANTHROPIC_API_KEY` |
| Branded ids | `PascalCase` brand string matches the type name | `Brand<string, 'PatientId'>` |

**Forbidden names:** `util`, `utils`, `helper`, `helpers`, `common`, `misc`, `data`, `manager`, `tmp`, `foo`, `stuff` as a module/file name `[gate]`. They signal a missing abstraction.

---

## 8. Frontend-specific code style (held to the same standard as the backend)

The SPA is **not** a lower-rigor zone. The same hexagonal discipline applies client-side.

| # | Rule | Enforcement |
|---|---|---|
| UI1 | **Container/presentational split.** Presentational components are pure(ish) functions of props with no data fetching; containers wire ports → presentational. | `gate` |
| UI2 | **No raw `fetch` / Supabase client / anon key / model ID in any component.** All vendor access is behind `DataAccessPort`/`GenerationPort`/`ConfigPort`. | `fit` (`ui_no_raw_fetch_in_components`, `no_hardcoded_supabase_url`, `core_no_model_id_literals`) |
| UI3 | **State behind an abstraction** = the typed client-side store / command-bus analog. Every mutation (`SaveNote`, `AdjustDose`, `AddMedicine`, `GiveVaccination`, `SignOff`) is a **command**; reads go through cached query objects (CQRS). This enables audit, optimistic UI, and dedup. | `gate` |
| UI4 | **One canonical print renderer.** `<PrintDocument>` is the single A4 renderer — the duplicate `printRx`/`renderRx` (prototype `prescription-pad.html` ~6682 and `prescription-output.html` 690–1073) collapse to one component. | `gate` |
| UI5 | **Components are built once and shared** between the pad and the print station (`<MedicineCard>`, `<PrescriptionReview>`, `<GrowthTrend>`, `<LabPills>`, `<VaxChecklist>`, `<SafetyPanel>`, `<SignoffGate>`). No copy-paste between pages. | `gate` |
| UI6 | **`esc()` discipline becomes a safe-render primitive.** Every dynamic value is escaped/auto-escaped by the framework; raw `innerHTML`/`dangerouslySetInnerHTML` is banned except in one audited, schema-validated SVG-pictogram renderer. | `lint` (`react/no-danger` / framework equivalent), `gate` |
| UI7 | **Design tokens, not inline styles.** Colour code (blue=meds, red=investigations, black=else), spacing, and the A4 print metrics live as CSS custom properties / a token module — never inline `style="color:#…"`. | `lint` (no inline style literals), `gate` |
| UI8 | **Inline SVG only — no external images.** Pictograms are inline SVG (sunrise/sun/sunset/moon + dose-qty + Hindi food/duration). No `api.qrserver.com`; QR renders client-side from a server-signed payload. | `gate` |
| UI9 | **a11y is a build gate:** WCAG 2.2 AA, Lighthouse a11y ≥ 90, semantic HTML first, every form field labeled, **no colour-only status** (mitigates the rubber-stamp risk), keyboard-navigable, contrast ≥ 4.5:1. | `ci` (Lighthouse), `gate` |
| UI10 | **AI-vs-clinician provenance is visually distinct** in the review UI, and an "AI-assisted, doctor-reviewed" line prints on the Rx. | `gate` |
| UI11 | **The dose `<DoseAdjuster>` binds to the same pure `DoseEngine`** as the server — the slider/radios call `computeDose`; the UI does no arithmetic of its own. | `gate`, `ci` (shared-engine parity) |

---

## 9. AI-orchestration code style (model behind config; arithmetic out)

| # | Rule | Enforcement |
|---|---|---|
| AI1 | **Model selection is config, never a literal.** Per-task model + effort lives in `ModelPolicyPort` (Opus 4.8 for generation with `output_config.effort:"high"`, `thinking:{type:"adaptive"}`; Haiku 4.5 for visit summary/lookup; Haiku→Sonnet escalation for OCR structuring). No `claude-*` string outside `adapters/model/**`. | `fit` (`core_no_model_id_literals`), `gate` |
| AI2 | **Respect the verified API surface.** Opus 4.8: `thinking:{type:"adaptive"}` only (`budget_tokens` → 400; `temperature`/`top_p`/`top_k` → 400); `effort` inside `output_config`; no assistant prefill (use structured outputs); stream when `max_tokens` is large. These constraints are encoded in the adapter and asserted in a contract test — not left to memory. | `gate`, `ci` |
| AI3 | **Prompt caching is part of the code, not an afterthought.** Render order `tools → system → messages`; freeze tool defs (deterministic order) + `core_prompt.md` + pre-embedded NABH block; `cache_control:{type:"ephemeral"}` on the last system block; volatile content (note, allergies, patient_id, tool results) **after** the breakpoint; **no timestamps/UUIDs in the cached prefix**; pre-warm with `max_tokens:0` on worker boot. Tests assert `usage.cache_read_input_tokens > 0`. | `gate`, `ci` |
| AI4 | **Tools live behind `ClinicalKnowledgePort`/`StoragePort`, each with a `__fake__`.** `get_formulary` (with `condenseDrugForAI()` token-stripping), `get_standard_rx` (ICD-10-first), `get_previous_rx` (PII-stripped — typed boundary), `get_lab_history`, `get_reference`, and `compute_doses` (LLM batches all drugs, passes full `dosing_bands`, copies engine output verbatim). | `gate` |
| AI5 | **Prefer `strict:true` tools + structured outputs over regex extraction.** Validate model output against the `core_prompt.md` JSON schema (Ajv); the brittle `extractJSON` regex is retired. | `gate`, `ci` |
| AI6 | **Every generation attempt is a fully-audited event row** (`prescription_audit`: `meta_mode`, `stop_reason`, tokens, rounds, `tools_called[]`, requested/emitted/omitted/added, `severity_*`, `warnings[]`, `duration_ms`, model id+version actually used) — not a `console.log`. | `gate`, `ci` |

---

## 10. Database & SQL code style (recap of the rules that touch code)

The full DDL/migration spec is `04_database/`; the **code-style** rules that bind every author:

| # | Rule | Enforcement |
|---|---|---|
| DB1 | **Postgres only**, no portability-breaking extensions. SQL is parameterized; **no string concatenation into SQL, ever**. | `fit` (`core_no_sql_literals`), `gate` |
| DB2 | **All schema change via dbmate migrations; every migration has a `.rollback.sql`;** CI verifies up→down→up + pg_dump diff. No ad-hoc `ALTER`. **Never** a `DROP TABLE … CASCADE` monolith (the prototype's destructive DDL is forbidden). | `ci`, `gate` |
| DB3 | **Every mutable table:** `id uuid PK`, `created_at`, `updated_at`, `version int` (optimistic lock), `correlation_id`, `facility_id`. UHID/receipt/token are **UNIQUE business columns**, never PKs. | `ci` (schema lint), `gate` |
| DB4 | **Append-only tables** (`ops.audit_log`, cost ledger, signed prescriptions) carry BEFORE UPDATE/DELETE triggers that raise. Signed Rx edits → new `prescribing.rx_versions` rows + content hash. | `ci`, `gate` |
| DB5 | **Real RLS + JWT** — `current_setting('app.role'/'app.doctor_id'/'app.facility_id')` set from JWT at request start (the portable `dis/ M008` pattern). Roles: `reception`, `nurse`, `doctor`, `service`, `admin`. **No DELETE policy** on clinical/audit tables. Anon key never touches clinical schemas. | `ci`, `gate` |
| DB6 | **FKs `ON DELETE RESTRICT`** for clinical data; composite FK `(visit_id, patient_id) REFERENCES visits(id, patient_id)` enforces the prescriptions↔visits consistency in the DB, not app code. | `ci`, `gate` |
| DB7 | **`snake_case`, plural tables, schema-qualified** (`catalog`, `clinical`, `prescribing`, `identity`, `abdm`, `ops`). | `gate` |
| DB8 | **N+1 banned** in request handlers — joins or `IN` lists; no per-row re-fetch (kills the FHIR builder's N+1 formulary re-fetch). | `gate`, `ci` (perf budget) |

---

## 11. Comments & docstrings (WHY, not WHAT)

| # | Rule | Enforcement |
|---|---|---|
| CM1 | **Every exported function/port method/class has a JSDoc** stating purpose, params, return, throws, and a `@see` to the governing spec section (TDD §, ADR, or `clinical_safety.md` CS-id). The `dis/` ports are the model — e.g. `DatabasePort.transaction` cites `coding_standards §6`. | `lint` (`jsdoc/require-jsdoc` on exports) + `gate` |
| CM2 | **Comments explain WHY; the code says WHAT.** A comment that restates the code is deleted. | `gate` |
| CM3 | **Clinical-safety invariants are commented at the enforcement point** with their CS-id (e.g. `// CS-1: no auto-promotion; draft stays pending_review until SignOff`). | `gate` |
| CM4 | **Every `any`, every `@ts-expect-error`, every over-budget function, every new dependency carries an inline justification.** | `lint` + `gate` |
| CM5 | **No commented-out code on `main`.** Delete it; git remembers. | `lint` (`no-warning-comments` for `TODO`/`FIXME` without a ticket) + `gate` |
| CM6 | **ADRs for meaningful decisions** under `02_architecture/adrs/NNNN-title.md` (Context / Decision / Consequences / Alternatives) — the `dis/` format. | `gate` |

**Docstring template (the house style):**

```ts
/**
 * Recompute the verbatim dose for one drug from concentration, band, and weight/BSA.
 *
 * The sole arithmetic authority for any number that reaches paper (CS-2). The AI
 * proposes the drug + regimen with no numeric fields; this function is the only
 * code allowed to produce mg/ml/drops and the bilingual R2/R3 strings.
 *
 * @param params  Drug formulation, dosing band, weight/BSA, frequency, output unit.
 * @returns       Volume, English + Hindi display, calc string, cap flag, warnings[].
 * @throws        {DoseRangeExceededError} only on a programming-error input (e.g. negative weight).
 * @see           clinical_safety.md CS-2 (dose-engine separation)
 * @see           05_ai/dose_engine.md
 */
export function computeDose(params: ComputeDoseParams): ComputeDoseResult { /* … */ }
```

---

## 12. Lint & format (the exact config — zero per-author drift)

| Tool | Config (committed at repo root) | Notes |
|---|---|---|
| **Prettier** | `printWidth: 100`, `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `arrowParens: "always"` | exact `dis/.prettierrc.json`; `format:check` in CI |
| **EditorConfig** | `end_of_line=lf`, `charset=utf-8`, `indent_style=space`, `indent_size=2`, `insert_final_newline=true`, `trim_trailing_whitespace=true` | exact `dis/.editorconfig`; critical for the Devanagari/UTF-8 files (mojibake `â€"` is what the migration ETL must clean — never re-introduce it) |
| **ESLint** | flat config: `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked` | start from `dis/eslint.config.mjs` |

**ESLint rules — the enforced set (extends `dis/`):**

```js
// eslint.config.mjs (additions over the dis/ baseline shown with their §)
rules: {
  '@typescript-eslint/no-explicit-any': 'warn',                 // §2 T1 (needs // reason:)
  '@typescript-eslint/consistent-type-imports': 'error',        // §2 T10 (already on-branch)
  '@typescript-eslint/no-floating-promises': 'error',           // §6 A8
  '@typescript-eslint/require-await': 'error',                  // §6 A9
  '@typescript-eslint/switch-exhaustiveness-check': 'error',    // §2 T4
  'no-console': 'error',                                        // §1 (pino only)
  'no-restricted-syntax': [/* ban default exports, raw innerHTML */], // §5 F5, §8 UI6
  'import/no-default-export': 'error',                          // §5 F5 (allow vite config)
  'max-params': ['warn', 4],                                    // §5 F2
  'complexity': ['warn', 10],                                   // §5 F2
  'jsdoc/require-jsdoc': ['warn', { publicOnly: true }],        // §11 CM1
}
// boundaries enforced by scripts/fitness-rules.json (regex CI), not just eslint-plugin-boundaries.
```

| # | Rule | Enforcement |
|---|---|---|
| L1 | **CI runs, in order:** `format:check` → `lint` → `typecheck` → `fitness` → `test` → `audit` → `spec-diff` → `parity` (dose golden) → `migrations` (up/down/diff). Any red = no merge. | `ci` |
| L2 | **Pre-commit hook** runs `prettier --write` + `eslint --fix` on staged files; **pre-push** runs `typecheck` + fast `vitest`. | `hook` |
| L3 | **No `eslint-disable` without a `// reason:` and a ticket.** | `lint`, `gate` |

---

## 13. Commits, branches & PRs (Conventional Commits + ticket scope)

| # | Rule | Enforcement |
|---|---|---|
| G1 | **Conventional Commits.** Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`, `build`. | `hook` (commitlint), `gate` |
| G2 | **Scope = ticket ID.** Example: `feat(RKH-118): speculative draft state machine + GenerationPort contract tests`. | `hook`, `gate` |
| G3 | **One ticket = one branch = one PR**, squash-merged. Branch: `feat/rkh-###-<slug>`. | `gate` |
| G4 | **Co-authored trailer required when an agent committed:** `Co-Authored-By: Claude <noreply@anthropic.com>`. | `gate` |
| G5 | **Never force-push shared branches** (`main`, `feat/dis-plan`). | branch protection |
| G6 | **No secrets / PHI in code, logs, URLs, commit messages, or test fixtures** — ever. Secret scanner in CI; test fixtures use synthetic patients only. | `ci` (secret scan), `gate` |
| G7 | **PR description** references the governing spec section + DoR/DoD checklist + an enforcement-tag note for any new rule. | `gate` |
| G8 | **TDD order: failing test committed before implementation** (the engineering-discipline Gate 2). | `gate` |

**Commit message footer (house standard, this repo):**

```
feat(RKH-118): speculative draft state machine + GenerationPort contract tests

<body: WHY + which clinical-safety invariants are touched (CS-ids)>

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## 14. Definition of "done" (a function/PR is done when…)

A unit of work is **done** only when every box is checked — these are merge blockers, not aspirations:

- [ ] **Failing test committed first**, now green; fakes-only core suite < 1 s `[ci]`
- [ ] **Golden parity fixtures pass** for any dose-engine/growth-engine touch `[ci]`
- [ ] `format:check`, `lint`, `typecheck`, `fitness`, `audit`, `spec-diff`, `migrations` all green `[ci]`
- [ ] **No new `core_no_*` violation**; no `claude-*`/Supabase-URL/anon-key literal added `[fit]`
- [ ] Every `any` / `@ts-expect-error` / over-budget fn / new dep **justified inline** `[gate]`
- [ ] Exported functions carry JSDoc with `@see` to the governing spec `[lint]`
- [ ] Clinical-safety invariants commented at the enforcement point with CS-ids `[gate]`
- [ ] **No PII** in logs, prompts, fixtures, or the QR payload `[ci/gate]`
- [ ] If migration touched: `.rollback.sql` present; up→down→up verified `[ci]`
- [ ] If UI touched: a11y ≥ 90, no colour-only status, no raw `fetch`/inline style `[ci/gate]`
- [ ] `CHANGELOG.md` + any touched spec/runbook/OpenAPI updated **in the same PR** `[gate]`
- [ ] Reviewer left **Approved**; all applicable review-gate sign-offs present `[gate]`

---

## 15. Enforcement summary (where each rule actually fails the build)

| Mechanism | Owns | File |
|---|---|---|
| `tsconfig.json` strict + 4 added flags | typing, exhaustiveness, unused code | `tsconfig.json` |
| ESLint flat config | `any`/type-imports/floating-promises/console/default-export/complexity/JSDoc | `eslint.config.mjs` |
| Prettier + EditorConfig | format, UTF-8/LF, Devanagari integrity | `.prettierrc.json`, `.editorconfig` |
| **Fitness rules (regex CI)** | **dependency direction, no-fetch/SQL/model-ID in core, vendor-SDK containment, no hardcoded URL/key, no raw-fetch in components** | `scripts/fitness-rules.json` |
| CI pipeline | lint→type→fitness→test→audit→spec-diff→**dose parity**→migrations | CI workflow |
| Golden parity job | JS↔TS dose-engine equivalence (≥ 20 cases) | `scripts/parity/*` `[ci]` |
| AI eval suite | no-PII, no-numeric-fields-from-model, JSON-schema conformance, cache-hit | `09_engineering_discipline/evals_framework.md` |
| Pre-commit / pre-push hooks | format+lint staged; typecheck+fast tests | `hook` |
| commitlint | Conventional Commits + ticket scope | `hook` |
| Review gates | architecture, clinical-safety, JSDoc, DoD checklist | `09_engineering_discipline/code_review_standards.md` |

> **The one-line creed for every author:** *the type system is the first test, the fitness rules are the second, the golden fixtures are the third, and a human signs the fourth.* If a rule in this file has no row in §15, it is not enforced — and an unenforced rule is a bug in this document, to be fixed in the PR that discovers it.
