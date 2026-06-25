---
trace_id: ENG-PRINCIPLES-001
title: Engineering Principles — Architectural Constitution & Extensibility Discipline
status: ratified
authority: governs all build agents (human + AI); enforced by CI gates, not convention
supersedes_when_conflict: false   # The OPERATING-MODEL DIGEST wins on conflict until amended via ADR
companion_files:
  - 09_engineering_discipline/dor_dod.md
  - 09_engineering_discipline/ci_gates.md
  - 09_engineering_discipline/evals.md
  - 09_engineering_discipline/fitness_functions.md
  - 09_engineering_discipline/contract_tests.md
  - 09_engineering_discipline/agent_workflow.md
  - 09_engineering_discipline/observability.md
  - 09_engineering_discipline/supply_chain.md
  - 09_engineering_discipline/scaffolding.md
last_reviewed: 2026-06-25
---

# 09 — Engineering Principles: The Architectural Constitution

> **What this file is.** The *architectural constitution* for the agent-built rebuild of the Radhakishan pediatric OPD prescription system. It is the **spec-independent** half of the engineering-discipline pack: it defines the design principles every slice must obey and — critically — makes each principle **machine-checkable**, so an agent or human **cannot merge code that violates it**. It is the bridge between abstract design wisdom (SOLID, hexagonal, CQRS, DDD) and the concrete fitness functions, contract tests, and eval gates that enforce them.
>
> **What this file is NOT.** It is not the product architecture. It does not name the actual bounded contexts, the actual aggregate roots, or the actual database schema of *this* system — that is authored in parallel in the architecture spec and married later. Here we specify the *shape* of the architecture and the *seams* it must expose, and we prove the shape holds via the **extensibility-scenarios test** (§14). When you read "the dosing context" or "the AI adapter" below, read it as *a* context / *an* adapter of that role, not a committed module name.
>
> **The founding incident (the whole reason this file exists).** On 2026-06-25 a hardcoded, dated Claude model id was retired by the vendor and **broke production**. The emergency fix swapped models and tuned reasoning effort **by guesswork**, with no eval harness to prove the new behavior was safe. This file's job is to make that class of incident *structurally impossible*: a model id is a pinned dependency that lives behind one adapter, in one config module, and changing it is a gated, eval-scored, rollback-drilled event — never a hotfix.

---

## 0. The five axioms this file inherits (non-negotiable)

Every principle below is an instrument of one of these five axioms from the operating-model digest. If a downstream rule does not serve one of these, it is ceremony and should be cut.

| # | Axiom | What it means for *architecture* specifically |
|---|---|---|
| **A1** | **Done = proven + gated, never declared.** | An architecture rule is only real if a build fails when it is broken. "We follow SOLID" is worthless; `dependency-cruiser` failing the PR is worth everything. |
| **A2** | **Enforce in CI, not in convention.** | Each principle in §1–§13 lists its **enforcement mechanism**. No principle ships as a comment in a style guide. |
| **A3** | **Answer from data, not guesswork.** | Architecture exists to make change *cheap and provable*. The test of the architecture is §14: each future change must be **one seam**, and the eval set proves the swap was safe. |
| **A4** | **Humans and AI are symmetric actors.** | Every state change is a **command** on a bus carrying `actor={human|agent}`. The architecture must not special-case who is calling. Going AI-first later is *additive*, not a rewrite (§9). |
| **A5** | **The deterministic dose-engine is the dosing source of truth; AI never does arithmetic.** | This is an enforced architectural boundary (§13), not a guideline. It is the single most safety-critical seam in the system. |

---

## 1. SOLID — applied here, enforced here

SOLID is not five aphorisms; it is five *forces* that keep change local. Below: what each means **in this codebase**, the **concrete rule**, and the **gate** that enforces it.

| Principle | "How we apply this here" | Enforcement (gate) |
|---|---|---|
| **S — Single Responsibility** | A module changes for **one reason**. The dose engine changes when dosing math changes — never because the print layout or the Claude prompt changed. An Edge Function orchestrates; it does not also format Hindi text and validate FHIR. | ESLint `max-lines`/`max-lines-per-function`; `dependency-cruiser` rule: a "service" module may not import both a `vendor-adapter` and a `presentation` module. PR review checklist item. |
| **O — Open/Closed** | Adding a **new drug source**, a **new vaccination schedule**, or a **new notification channel (WhatsApp Rx)** is done by adding an adapter that implements an existing **port**, *not* by editing the consumer. See §2 and §14. | Fitness function: ports live in `domain/ports/**`; a new adapter under `adapters/**` must implement a port interface — adding one must touch **zero** files in `domain/**`. CI diff-scope check on the extensibility slices. |
| **L — Liskov Substitution** | Any adapter behind a port is **fully substitutable**: the in-memory test double, the Supabase REST adapter, and a future Postgres adapter all satisfy the same contract tests. If swapping the DB adapter breaks behavior, the port abstraction leaked. | **Shared contract test suite** (Ajv + Pact-style) run against *every* adapter implementing a port. A new adapter is not "done" until it passes the port's contract suite unmodified. |
| **I — Interface Segregation** | A consumer depends only on the slice of a port it uses. The Rx-generation flow depends on `FormularyReadPort` (lookups), not on a fat `FormularyPort` that also exposes bulk-import writes. | `dependency-cruiser`: forbid importing write-side ports into read-side (CQRS, §3) modules. Lint rule flags ports with > N methods (split candidate). |
| **D — Dependency Inversion** | **Domain depends on abstractions; vendors depend on the domain's ports.** The dosing/Rx domain defines `AiModelPort`; the Anthropic adapter implements it. Domain code **never** imports `@anthropic-ai/*`, `supabase-js`, or an ABDM SDK. | **Headline fitness function** (digest §4a.2): `domain/** ⇏ vendor SDK`. Any `import` of a vendor package outside `adapters/**` fails the build. This is the anti-corruption firewall (§8) and the model-retirement firewall (§12). |

> **Decisive stance:** we do not debate SOLID per-PR. We encode it once as `dependency-cruiser` + ESLint rules in the scaffold (§ scaffolding companion), and the conversation becomes "the build is red," not "is this SOLID enough."

---

## 2. Separation of Concerns (SoC) — the layer cake & its grain

We separate **four** concerns and forbid the wrong ones from touching each other. The grain of the wood is: *dependencies point inward, toward the domain.*

```
            ┌─────────────────────────────────────────────────────────┐
            │  PRESENTATION   (web/ components, print layout, pictograms)│  ← may depend on app
            ├─────────────────────────────────────────────────────────┤
            │  APPLICATION    (command handlers, query handlers, bus)   │  ← may depend on domain + ports
            ├─────────────────────────────────────────────────────────┤
            │  DOMAIN         (dose engine, Rx rules, bounded contexts) │  ← depends on NOTHING outward
            │                 (ports = interfaces defined HERE)         │
            ├─────────────────────────────────────────────────────────┤
            │  INFRASTRUCTURE / ADAPTERS                                 │  ← implements domain ports
            │  (Anthropic adapter · Supabase adapter · ABDM/FHIR adapter │
            │   · OCR adapter · WhatsApp adapter · config/secrets adapter)│
            └─────────────────────────────────────────────────────────┘
                    dependencies point UP toward DOMAIN only
```

**How we apply this here**
- **Presentation** (the `web/` HTML pages, components, print/pictogram rendering) never calls a vendor or a DB directly; it issues **commands/queries** (§3) and renders the result. XSS escaping (`esc()`) is a presentation concern enforced as its own fitness function (§13).
- **Application** holds the command/query handlers and the bus. No clinical math, no SQL, no HTTP to a vendor — it *orchestrates*.
- **Domain** is the only place clinical rules and dosing math live. It has **zero** outward imports. The dose engine (`web/dose-engine.js` today; a proper domain module after scaffolding) is the crown jewel of this layer (§13, A5).
- **Infrastructure/adapters** is the only place vendor SDKs, SQL, FHIR, and secrets appear.

**Enforcement**
- `dependency-cruiser` layer rules: `domain → (nothing)`, `application → domain|ports`, `presentation → application`, `adapters → ports`. Any upward-into-domain or domain-outward edge fails CI.
- Folder convention is **generated by the scaffolding workflow from the spec**, so the layer boundaries exist *by construction* and drift from them is a "generated-files-out-of-sync" CI failure (§ single-source-of-truth, digest §4c).

---

## 3. Command Bus + CQRS — every state change is a command; reads and writes are separated

This is the spine that makes A4 (symmetric actors) and the audit trail real.

**How we apply this here**
- **Writes** = **commands**. `IssuePrescription`, `SignOffPrescription`, `RegisterPatient`, `RecordVaccination`, `SwapAiModel` (yes — even a config change is a command, so it is audited). A command is handled by exactly one handler, mutates state, and **emits one or more events** (`PrescriptionIssued`, `PrescriptionSignedOff`).
- **Reads** = **queries**, served from read models. `GetPatientGrowthTrend`, `GetRecentLabs`, `GetPreviousRx`. Queries never mutate. They may be served from denormalized/projection views built off the event stream.
- **Every command carries the standard envelope** below. This is what makes humans and AI symmetric and gives us the IEC-62304-adjacent audit trail.

```ts
// application/bus/command-envelope.ts  (illustrative shape — not a committed type)
interface CommandEnvelope<TPayload> {
  commandId: string;            // ulid — idempotency key
  type: string;                 // "IssuePrescription"
  actor: {
    kind: "human" | "agent";    // ← A4: symmetric. The bus does NOT branch on this for authz logic;
    id: string;                 //    it records it. AI-first later = more 'agent' commands, same bus.
    onBehalfOf?: string;        // e.g. supervising physician for an agent-initiated draft
  };
  traceId: string;              // links spec ↔ task ↔ code ↔ test ↔ eval (digest §4c)
  riskTier: "low" | "high" | "critical";   // routes human-in-the-loop (§6 of digest)
  payload: TPayload;
  emittedAt: string;            // ISO-8601
}
```

**Enforcement (fitness functions)**
- **No back-door writes:** `dependency-cruiser` + AST grep — presentation/application code may not call an adapter's write method directly; all mutations route through a command handler. A write-capable adapter method invoked outside `application/handlers/**` fails CI.
- **CQRS separation:** read-side modules may not import write-side ports, and vice-versa (digest §2). Query handlers that import a command bus fail the build.
- **Envelope completeness:** a contract test asserts every dispatched command carries `actor`, `traceId`, `riskTier`. A command without `actor` is unrepresentable (TS type) *and* rejected at runtime by the bus.

> **Why this is the right altitude:** CQRS here is a *discipline*, not a microservice topology. We are not building separate read/write databases on day one — we are committing to the *seam* so that, when read load demands a projection store, it is one adapter swap (§14), not a rewrite.

---

## 4. Event-Driven & Async — slow, fallible work happens off the hot path

The Rx-generation call to Claude is slow (seconds), occasionally fails, and must not block the clinician's UI or be trapped inside an Edge Function timeout. The architecture treats it as an **async, event-driven** flow.

**How we apply this here**
- `IssuePrescription` command → handler emits `PrescriptionRequested` → an async worker invokes the `AiModelPort` and the dose engine → emits `PrescriptionDrafted` (or `PrescriptionGenerationFailed`) → UI subscribes and streams the result in.
- **Streaming generation** is the **first rollout slice** (digest §8.3): move Rx generation **off the Edge Function constraint** and stream tokens to the pad. This is the safe, incremental first vertical, gated by the identical checks as everything else.
- Failure is a **first-class event**, not an exception that vanishes. `PrescriptionGenerationFailed{reason: "model_retired"|"timeout"|...}` feeds the alerting in the observability companion (model-retirement & timeout-rate alarms, digest §7).

**Enforcement**
- Contract test: every command handler that touches a vendor adapter must emit a terminal event (success **or** failure) — a handler with a code path that can return without emitting fails a fitness test.
- SLO/observability gate (companion): **timeout-rate** and **severe-error online score** are alarmed; the async boundary is what makes those measurable.

---

## 5. Domain-Driven Design (DDD) — bounded contexts with published contracts

**How we apply this here**
- The system decomposes into **bounded contexts** (e.g., *Registration/Patient*, *Clinical Dosing & Rx*, *Vaccination*, *ABDM/Health-Records Exchange*, *Labs*). The **exact** context map is the architecture spec's job; this file mandates only the *rules of engagement* between contexts.
- **Each context owns its data and its ubiquitous language.** "Visit" in Registration and "encounter" in ABDM/FHIR are *different models*; the translation between them lives in an **anti-corruption layer** (§8), never as a shared mutable type.
- **Cross-context communication is via published contracts only** — a domain event or a query against a published read model. One context **never** reaches into another's internal types or tables.

**Enforcement**
- `dependency-cruiser`: `context-a/internal/** ⇏ context-b/internal/**`. Cross-context imports are allowed **only** from `context-b/contracts/**` (published events, public query DTOs). Internal-to-internal cross-context import fails CI.
- Each published cross-context contract has a **JSON Schema** under contract tests; changing it without a versioned, backward-compatible bump fails the contract gate (consumer-driven, Pact-style).

---

## 6. Open/Closed at the system level — the extensibility contract

Open/Closed is the principle that pays for all the others. We state it as a **contract on the future**: every anticipated change is *adding* an adapter behind an *existing* port, not editing a consumer. §14 is the executable proof.

| Anticipated change | Closed (untouched) | Open (the one place you add) |
|---|---|---|
| Swap AI model / provider | domain, application, all handlers | a new `AiModelPort` adapter + the model-id line in the **config adapter** |
| Add WhatsApp Rx delivery | Rx domain, sign-off rule | a new `RxDeliveryPort` adapter (`WhatsAppRxAdapter`) |
| Add a new drug data source | dose engine, Rx flow | a new `FormularyReadPort` adapter |
| Change the database | domain, all queries/commands | new `*Repository` adapters implementing existing repo ports |
| Go AI-first | the command bus, the audit envelope | more `actor:"agent"` command producers (additive, §9) |

**Enforcement:** the **extensibility-scenarios CI job** (§14) literally measures the diff-scope of these changes on fixture branches and fails if a "closed" directory was modified.

---

## 7. Dependency Injection — wiring at the edge, not in the core

**How we apply this here**
- Domain and application code receives ports via **constructor / parameter injection**; it never news-up an adapter and never reads global state. The dose engine receives no I/O at all (it is pure).
- A single **composition root** per deployable (one per Edge Function, one for the web app shell) wires concrete adapters to ports. This is the *only* place `new AnthropicAdapter(...)` or `new SupabaseFormularyAdapter(...)` appears.
- Tests inject **in-memory doubles** behind the same ports — this is *why* the dose engine and Rx logic are unit-testable without a network (digest: dose engine is first TDD target).

**Enforcement**
- Fitness function: `new <VendorAdapter>` may appear **only** in `**/composition-root.ts`. AST grep gate.
- No service-locator / global singleton for adapters: ESLint rule forbids module-level mutable adapter exports.

---

## 8. Anti-Corruption Layers (ACLs) — vendors quarantined behind ports

External vendors (the **AI model**, **ABDM/FHIR gateway**, **OCR/document processing**) are sources of *foreign models* and *breaking change*. We wrap each in an ACL so their concepts never leak into the domain.

**How we apply this here**

```
   DOMAIN (clean, vendor-agnostic)
        │  speaks: AiModelPort, RxDeliveryPort, HealthRecordExchangePort, OcrPort
        ▼
   ┌──────────────── ANTI-CORRUPTION LAYER (adapters) ────────────────┐
   │ AnthropicAdapter      → translates Rx domain request ⇄ Claude     │
   │   (model id from config; messages/tool_use are vendor detail)     │
   │ AbdmFhirAdapter       → translates Encounter/Visit ⇄ FHIR R4      │
   │ OcrAdapter            → translates Document ⇄ vendor OCR payload   │
   │ WhatsAppRxAdapter     → translates Rx ⇄ WhatsApp delivery API     │
   └──────────────────────────────────────────────────────────────────┘
        │  vendor SDKs / HTTP live ONLY below this line
        ▼
   Anthropic API · ABDM Gateway · OCR vendor · WhatsApp Business API
```

- The **AI model id is a vendor detail** — it lives in the config adapter (§10), read by `AnthropicAdapter`, invisible to the domain. This is the literal fix for the founding incident.
- The **ABDM/FHIR boundary** is regulator-adjacent and cannot be hotfixed in the gateway; its ACL is verified by **HL7 FHIR R4 validation** + Pact-style provider verification in CI (digest §1 contract tests).
- An OCR vendor's quirky JSON never reaches the domain; the `OcrAdapter` normalizes to a domain `ExtractedDocument`.

**Enforcement**
- Headline fitness function (again, §1-D): vendor SDK imports forbidden outside `adapters/**`.
- Contract tests pin each ACL's I/O (Ajv schemas for Claude tool I/O & Rx output; FHIR validator for ABDM). A vendor changing its shape fails *our* contract test before it reaches production.

---

## 9. Symmetric Human/AI Actors — AI-first is additive, not a rewrite

This is A4 made architectural. The system must let us move from "human drives, AI assists" to "AI drives, human supervises" **without touching the core**.

**How we apply this here**
- Every state-changing action — whether a nurse taps a button or an autonomous agent proposes a draft — is the **same command** on the **same bus**, distinguished only by `actor.kind` and recorded identically in the audit log.
- Authorization, rate-limits, and the **mandatory physician sign-off** (§13) are policies on the command, **not** branches in business logic. Sign-off is required to *issue* a prescription regardless of whether a human or an agent drafted it.
- Going AI-first = adding command *producers* (agents that emit `DraftPrescription` commands), **not** new write paths. The handlers, events, gates, and audit trail are unchanged.

**Enforcement**
- Fitness function: there is exactly one write path per state change (the command handler); no "AI-only" or "human-only" alternate mutation path may exist (AST/dependency check).
- The sign-off fitness function (§13.4) is `actor`-agnostic — it fails for *any* issuance without a sign-off event, human or agent.

> **The payoff:** the day we decide to let an agent auto-draft prescriptions for low-risk refills, the diff is "register a new command producer + raise its risk tier routing," and the eval/sign-off gates already constrain it. That is a seam, not a project.

---

## 10. Centralized Config & Secrets — one module, no literals, no model ids in code

The founding incident was a **dated model id hardcoded in a function**. The constitutional response: **no vendor model id and no secret may exist outside the centralized config adapter.**

**How we apply this here**
- A single **config adapter** is the only module that reads environment/secret stores and exposes typed config to adapters. Secrets (`ANTHROPIC_API_KEY`, `ABDM_CLIENT_SECRET`, …) are injected, never literal.
- **Vendor model ids are pinned dependencies declared in config** — with a deprecation watch and a **pre-validated fallback model** (digest §7, §12). Changing one is a *command* (`SwapAiModel`), gated by the eval suite (§14, scenario 1).

```ts
// adapters/config/ai-config.ts  (illustrative — the ONLY place a model id appears)
export const aiConfig = {
  primaryModel:   env.required("AI_PRIMARY_MODEL"),     // pinned; deprecation-monitored
  fallbackModel:  env.required("AI_FALLBACK_MODEL"),    // pre-validated rollback target
  reasoningEffort: env.optional("AI_REASONING_EFFORT", "high"),
  maxTokens:      env.int("AI_MAX_TOKENS", 4096),
} as const;
// Domain & application import NOTHING from here. Only AnthropicAdapter does.
```

**Enforcement (two independent gates)**
1. **`model-id-in-config-only` fitness function:** a regex/AST scan fails the build if a vendor model id pattern (`claude-*`, `us.anthropic.*`, dated ids, `gpt-*`, `gemini-*`) appears anywhere except `adapters/config/**`.
2. **`no-secrets` gate:** GitHub secret scanning + push protection + **gitleaks** in CI; plus a fitness rule that no secret-shaped literal appears outside the config module. PHI/secret-in-log Semgrep rule (digest §7).

---

## 11. Frontend Componentization Standard — the UI is held to the same bar

The frontend is not exempt. It obeys the same SoC, DI, and testability rules as the backend.

**How we apply this here**

| Standard | Rule | Enforcement |
|---|---|---|
| **Component model** | UI is decomposed into reusable components (patient header, growth-trend card, medicine 4-row block, pictogram sidebar, sign-off bar), not monolithic page scripts. | Lint: max file/function size; component registry. |
| **Container / Presentational split** | *Presentational* components are pure (props in, DOM out, no fetch). *Container* components dispatch commands/queries and pass data down. | Fitness rule: presentational components may not import the bus or an adapter (dependency-cruiser on `web/components/presentational/**`). |
| **State behind an abstraction** | No component reads raw global/window state or fetches Supabase directly; it goes through a query/command facade. | Lint rule forbids raw `fetch(` to vendor URLs and raw global-state access in components. |
| **Design-system tokens** | Colors are tokens, not magic strings — and they carry clinical meaning (Blue=medicines, Red=investigations, Black=other). | Lint: forbid raw hex in components; require token import. |
| **XSS safety** | Every dynamic value into `innerHTML` is `esc()`-wrapped. | **Headline fitness function** (§13.1). |
| **Component & E2E tests** | Components tested with **Vitest + Testing Library**; print/sign-off critical paths with **Playwright** E2E. | CI job; coverage threshold on safety-critical UI. |

> **Decisive stance:** the frontend's clinical-safety surfaces (the 4-row medicine block, the sign-off bar, the print layout) are **safety-critical UI** and carry the same coverage threshold and E2E gating as backend dosing code. A pictogram that renders the wrong schedule is a patient-safety bug.

---

## 12. Supply-Chain & Vendor-Pinning — the model-retirement lesson, generalized

The model retirement was a *supply-chain* failure: an undeclared, unmonitored, unpinned external dependency changed under us. We generalize the fix.

**How we apply this here**
- **A vendor model id is a pinned dependency** — declared in config (§10), monitored for deprecation, and changed only via a gated change (eval gate + ADR + rollback), **never a hotfix** (digest §7).
- **Lockfiles committed**; **Renovate** does *security* auto-merge only and must pass CI; **CycloneDX SBOM** on build; **SRI** on every CDN `<script>` in the `web/` pages (html5-qrcode, Noto fonts today); lifecycle scripts disabled; prefer deps > 30 days old (Shai-Hulud / GhostAction era).
- A **named runbook** exists for the founding incident: deprecation alarm → pre-validated fallback model → drilled rollback (digest §7, observability companion).

**Enforcement**
- CI: `gitleaks`, SBOM generation, SRI-present check on new CDN scripts, lockfile-presence check. Model-deprecation alarm wired in observability.

---

## 13. The Dose-Engine Separation & the five founding fitness functions (A5)

The deterministic dose engine is the **dosing source of truth**; **AI never does arithmetic** (A5, and the project memory note `project_dose_engine_is_source_of_truth.md`). Dosing errors come from AI mental math, *not* the engine — so the architecture forbids AI from owning the number.

**How we apply this here**
- All dosing arithmetic (weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier; rounding rules; max-dose caps) lives **only** in the dose engine, a pure domain module with no I/O.
- The Edge/AI path **calls the engine** for every number and **cross-checks** the AI's claimed dose against the engine's computed dose. Disagreement is a **never-event** (eval gate, below).
- The engine is the **first TDD target** of the rebuild (digest); it is unit-tested exhaustively against the high-risk pediatric edges (neonates, preterms corrected-vs-chronological age, renal adjustment, max-dose).

**The five founding architecture fitness functions** (digest §4a — start here, accrete from here):

| # | Fitness function | What it forbids | Tooling |
|---|---|---|---|
| 13.1 | **esc()-XSS** | any `innerHTML =` with a dynamic, un-`esc()`'d value in `web/**` | AST/grep fitness test in CI |
| 13.2 | **no-circular / boundary** | circular deps; cross-context internal imports; `domain ⇒ vendor SDK` | dependency-cruiser |
| 13.3 | **dose-engine-only-dosing** | dosing arithmetic outside the dose engine; any parallel math in AI/Edge paths | AST grep + import check |
| 13.4 | **sign-off-before-issue** | any code path that issues/prints an Rx without an explicit doctor **sign-off event** (also the regulatory firewall: keeps CDS a non-device under CDSCO review) | AST/flow fitness test |
| 13.5 | **no-secrets / model-id-in-config** | secret literals or vendor model ids outside the config adapter | gitleaks + regex/AST fitness test |

These are **structural drift** control. They run on every PR and **fail the build** — they catch "an agent crossed a boundary" *faster than human review*. They are necessary but **not sufficient**: they cannot see that the model now gives subtly worse prescriptions. That is the job of evals (§ evals companion + §14), which run as the *behavioral* drift axis. **A change must pass both axes.**

---

## 14. The Extensibility-Scenarios Test — proof the architecture is one-seam-per-change

This is the executable acceptance test **for the architecture itself**. The thesis of every principle above is: *the changes we know are coming should each be a single seam.* We prove it. Each scenario below is run as a **CI fixture branch** that makes the change and asserts the **diff-scope** — the set of directories allowed to change. If a "closed" directory is touched, the architecture has failed and the job is red.

### Scenario 1 — Swap the AI model (the founding incident, now a seam)
- **The seam:** one line in the **config adapter** (`AI_PRIMARY_MODEL`); optionally a new `AnthropicAdapter` variant behind `AiModelPort`.
- **Allowed diff:** `adapters/config/**`, `adapters/ai/**`. **Forbidden:** any change in `domain/**`, `application/**`, presentation.
- **Gate marrying structure + behavior:** the **eval gate** runs the golden set **base-vs-branch** (promptfoo): never-events 100% pass, **severe-error count = 0**, soft-quality ≥ threshold, cost/latency within budget; PR comment posts the diff. The decision that was made by guesswork on 2026-06-25 is now a scored, gated, rollback-drilled change. *This is the entire point of the operating model.*

```
  Change AI model
        │
        ├─ structural gate: model-id-in-config-only ✓  · vendor-behind-adapter ✓  · domain untouched ✓
        │
        └─ behavioral gate (promptfoo, base vs branch):
              dose-engine cross-check ✓ · allergy/interaction ✓ · NABH block ✓
              never-events 100% ✓ · severe-errors = 0 ✓ · cost/latency ≤ budget ✓
              → PR comment: Δsevere, Δcost, Δlatency, cases improved/regressed
        →  merge ships with pre-validated fallback model + drilled rollback
```

### Scenario 2 — Add WhatsApp Rx delivery
- **The seam:** a new `WhatsAppRxAdapter` implementing the existing `RxDeliveryPort`, registered in the composition root.
- **Allowed diff:** `adapters/whatsapp/**`, `composition-root.ts`, config. **Forbidden:** the Rx domain, the **sign-off rule** (delivery still requires a signed Rx — §9, §13.4), the print path.
- **Gate:** the sign-off fitness function (13.4) must still pass — WhatsApp cannot become a back door that delivers an unsigned prescription. Contract test pins the new adapter to `RxDeliveryPort`.

### Scenario 3 — Add a new drug data source
- **The seam:** a new adapter implementing `FormularyReadPort`; it must pass the **port's shared contract suite** (Liskov, §1-L) unmodified.
- **Allowed diff:** `adapters/formulary/**`, config. **Forbidden:** the **dose engine** and the Rx flow — the new source feeds the engine; it does not duplicate dosing math (13.3).
- **Gate:** dose-engine-only-dosing (13.3) must pass; the new adapter must satisfy `FormularyReadPort` contract tests.

### Scenario 4 — Change the database (Supabase → other Postgres / managed DB)
- **The seam:** new `*Repository` adapters implementing the existing repository ports; CQRS read models re-pointed.
- **Allowed diff:** `adapters/persistence/**`, migrations, config. **Forbidden:** `domain/**`, command/query handlers (they speak ports, not SQL — §1-D, §7).
- **Gate:** every new repository adapter passes the repo ports' contract suite; no domain file changes (diff-scope assertion).

### Scenario 5 — Go AI-first (additive, §9)
- **The seam:** register new command *producers* (agents emitting `DraftPrescription` commands) + raise their risk-tier routing.
- **Allowed diff:** new producer modules + routing config. **Forbidden:** the command bus, the command handlers, the audit envelope, the sign-off rule.
- **Gate:** the audit envelope still carries `actor:"agent"` for every such command; sign-off (13.4) is enforced identically; the symmetric-actor fitness check confirms no new alternate write path was introduced.

### The extensibility scorecard (the architecture's own DoD)

| Scenario | Seam (the one place you add) | Allowed diff-scope | Must NOT touch | Marrying gate |
|---|---|---|---|---|
| Swap model | config + AI adapter | `adapters/config`,`adapters/ai` | domain, application | eval gate (never-events, severe=0) + model-id-in-config |
| WhatsApp Rx | `RxDeliveryPort` adapter | `adapters/whatsapp`, comp-root | Rx domain, sign-off | sign-off-before-issue (13.4) + port contract |
| New drug source | `FormularyReadPort` adapter | `adapters/formulary` | dose engine, Rx flow | dose-engine-only-dosing (13.3) + port contract |
| Change DB | repository adapters | `adapters/persistence` | domain, handlers | repo contract suite + diff-scope |
| AI-first | new command producers | producers + routing | bus, handlers, audit, sign-off | symmetric-actor check + sign-off (13.4) |

> **If any row cannot be satisfied as a single seam, the architecture is wrong and must be amended via ADR before the slice ships.** This table is the litmus test that the constitution actually buys what it promises: *change is cheap and provable.*

---

## 15. How the two drift axes compose (structure × behavior)

```
        ┌──────────────────────────── PR ────────────────────────────┐
        │                                                             │
        │   STRUCTURAL AXIS                  BEHAVIORAL AXIS            │
        │   (fitness functions, §13)         (evals, §14 + companion)  │
        │   ─────────────────────            ────────────────────       │
        │   esc()-XSS                        golden set (30–50, grows) │
        │   no-circular / boundary           deterministic assertions: │
        │   dose-engine-only-dosing      ←──   dose-engine cross-check  │
        │   sign-off-before-issue              allergy / interaction    │
        │   model-id-in-config / no-secrets    NABH / 4-row schema      │
        │   vendor-behind-adapter            never-events: 100% pass    │
        │                                    severe-error count = 0     │
        │   "did the agent cross a           cost + latency ≤ budget    │
        │    boundary?" — fast               "is the OUTPUT still safe?" │
        │                                                             │
        │            BOTH must be green, independently.                │
        └─────────────────────────────────────────────────────────────┘
```

- **Structural** catches boundary violations faster than any human reviewer.
- **Behavioral** catches subtly-worse prescriptions no structural check can see.
- **Neither alone is sufficient.** The constitution requires *both* gates on any change that touches model / prompt / reference / Rx schema (high-risk tier, mandatory human approver too — digest §6).

---

## 16. Conformance checklist (paste into the PR template)

A slice conforms to this constitution only if **every** box is checkable by a machine gate, not by assertion (A1/A2):

- [ ] **DI / composition root:** no `new <VendorAdapter>` outside the composition root.
- [ ] **Dependency inversion:** no vendor SDK / `fetch` to a vendor URL outside `adapters/**` (13.2).
- [ ] **SoC layers:** `domain/**` has zero outward imports; dependency-cruiser layer rules green.
- [ ] **Command bus / CQRS:** all mutations route through a command handler; envelope carries `actor`,`traceId`,`riskTier`; read-side ⇏ write-side.
- [ ] **Bounded contexts:** no cross-context internal import; only published contracts crossed.
- [ ] **Config/secrets:** no secret literal or vendor model id outside `adapters/config/**` (13.5); gitleaks clean.
- [ ] **Dose engine (A5):** no dosing math outside the engine (13.3); AI numbers cross-checked.
- [ ] **Sign-off (A4 + regulatory firewall):** no issuance/print path without a sign-off event (13.4).
- [ ] **Frontend bar:** presentational components pure; `esc()` on every dynamic `innerHTML` (13.1); no raw hex/global-state.
- [ ] **Supply-chain:** lockfile present; SRI on any new CDN script; SBOM generated.
- [ ] **Extensibility (if the slice touches a seam):** the relevant §14 fixture branch stays within its allowed diff-scope.
- [ ] **Both drift axes green** if model/prompt/reference/Rx-schema touched: fitness functions **and** eval gate (never-events 100%, severe=0).
- [ ] **ADR added** if any §1 canonical choice, a model policy, or a constitutional rule was changed.

---

## 17. Amendment procedure & honest caveats

**Amending the constitution.** Any rule here changes **only** via a Markdown ADR (`docs/adr/NNNN-*.md`) that (a) names the change, (b) shows the replacement satisfies the same *gate contract*, and (c) updates this file and the digest. Until merged, the existing rule is binding so all discipline files compose. On conflict with the **OPERATING-MODEL DIGEST**, the digest wins until amended.

**Caveats carried from the digest (do not let the architecture's elegance hide these):**
- An eval suite is only as good as its golden set; v1 is a **safety net, not proof of safety** — grow it from production misses.
- **LLM-judge scores drift** when the judge model updates — pin and re-validate; **never let a judge verify a dose** (A5 is absolute).
- This is **engineering rigor, not regulatory clearance.** CDSCO is the binding regulator; **severe-error gating + mandatory physician sign-off** remain the real clinical safety backstop — the sign-off fitness function (13.4) is therefore the single rule that may never be relaxed.
- Start with **5 fitness functions + ~30–50 eval cases** on the highest-risk pediatric edges; let the harness **accrete**. Front-load the gates that block harm, not enterprise ceremony.

---

### Cross-references
- Drift control, golden set, scorers, gates → `09_engineering_discipline/evals.md`, `09_engineering_discipline/fitness_functions.md`
- DoR/DoD machine gates → `09_engineering_discipline/dor_dod.md`
- CI/CD wiring, branch protection → `09_engineering_discipline/ci_gates.md`
- Contract tests (Ajv / Pact / FHIR validator) → `09_engineering_discipline/contract_tests.md`
- Agent loop, roles, audit trail → `09_engineering_discipline/agent_workflow.md`
- SLOs, online eval, model-retirement & timeout alarms, runbooks → `09_engineering_discipline/observability.md`
- Pinning, SBOM, SRI, Renovate, gitleaks → `09_engineering_discipline/supply_chain.md`
- Spec-driven scaffolding + parallel worktrees → `09_engineering_discipline/scaffolding.md`
- Current zero-gate deploy (the thing being gated) → `.github/workflows/deploy-pages.yml`
- Dosing source of truth (A5 anchor, first TDD target) → `web/dose-engine.js`
- Primary eval-gated surface → `supabase/functions/generate-prescription/`
