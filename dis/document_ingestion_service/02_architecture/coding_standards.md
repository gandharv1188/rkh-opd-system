# Coding Standards

> Binding on every agent writing code in `dis/`. This codifies the
> "don't cut corners" rule. Each section cites the source standard so
> the reasoning is traceable when agents make judgment calls on edge
> cases.
>
> The current Radhakishan POC repo does not follow all of these. DIS
> must, because it is designed to be ported into other applications.

## §1. Language & runtime

- **TypeScript strict mode.** `"strict": true` in `tsconfig.json`. No `// @ts-ignore` without a line comment citing the specific cause and an issue ticket.
- **No `any` without justification.** Every `any` requires a `// reason: …` comment. `unknown` is preferred; narrow at boundaries.
- **Discriminated unions for state.** State machine states, result types, and error types are unions with a literal discriminator (`kind` or `type` field).
- **Exhaustiveness checks.** `switch` on a discriminated union ends with `default: return assertNever(x)`. We ship an `assertNever(x: never): never` helper.
- **Node 20 LTS** target. ESM only (`"type": "module"`). No CommonJS in `dis/`.
- **Bun-compatible** — code must not use Node-specific APIs without a portability shim. Hono is chosen for this reason.

## §2. Architectural principles

- **SOLID.**
  - **S**RP — each module has one reason to change. No "util.ts" grab bags.
  - **O**CP — extend via new adapters, not by editing the core.
  - **L**SP — adapters honor their port contract exactly; no silent behavior drift.
  - **I**SP — ports are small and focused. `OcrPort` does OCR, not file routing.
  - **D**IP — core depends on ports (abstractions), never on adapters (concretions).
- **Hexagonal (Ports & Adapters).** See `02_architecture/adapters.md`. Core imports only ports; adapters import only their own dependencies.
- **12-Factor App** (https://12factor.net). Config via env; stateless processes; logs as event streams; dev/prod parity; admin tasks as one-off processes; port binding; graceful shutdown.
- **CQRS-lite.** Staging (`ocr_extractions`) is separate from production (`lab_results`). Promotion is the named command between them — never implicit.
- **Idempotency first.** All state-changing endpoints require `Idempotency-Key`. All DB writes use `ON CONFLICT` or pre-check.
- **Fail closed.** When unsure, err on the side of `pending_review`. Clinical data is never auto-promoted without an explicit policy match.

## §3. Code organization

- **Folder by feature, not by layer.** `src/core/orchestrator.ts` holds the orchestrator; `src/core/orchestrator.test.ts` sits beside it. No `src/controllers/` / `src/services/` buckets.
- **Barrel files only at package boundaries.** `ports/index.ts` re-exports; `adapters/*/index.ts` does. Deep imports inside a package are fine.
- **One public export per file** when feasible. Name the file after the export.
- **Pure functions by default.** Side-effecting functions carry `async` or a descriptive verb (`write`, `send`, `persist`).
- **Immutability by default.** Prefer `readonly` + spread; avoid `Array.prototype.push`/`sort` in place; use `toSorted`/`toReversed`.

## §4. Error handling

- **Typed errors, not strings.** A module exposes its error class hierarchy:

  ```ts
  export class OrchestratorError extends Error { readonly code: string; }
  export class InvalidStateTransitionError extends OrchestratorError {...}
  export class VersionConflictError extends OrchestratorError {...}
  ```

- **Errors cross the boundary as the envelope from `04_api/error_model.md`.** No raw stack traces in responses.
- **Never swallow errors.** `try/catch` must log or rethrow. `catch (e) { /* ignore */ }` is a lint error.
- **No `throw` in core for expected control flow.** Return `Result<T, E>` (or discriminated union) where the caller is supposed to handle failure.

## §5. Concurrency & state

- **Optimistic locking with version column** on every mutable row (already in TDD §6).
- **No shared mutable module state.** Singletons are composed at the wiring layer, not ambiently.
- **Race-aware.** Any read-modify-write goes through either a DB transaction or a `SELECT ... FOR UPDATE`.

## §6. Security (OWASP Top 10, aligned)

- **A01 Broken Access Control** — every endpoint asserts RLS OR service-role context. No "trust the caller."
- **A02 Cryptographic Failures** — no custom crypto. `node:crypto` only. TLS required in prod.
- **A03 Injection** — parameterized queries only; no string concatenation into SQL.
- **A04 Insecure Design** — pen-test the staging → clinical promotion path; red-team fixtures in the test suite.
- **A05 Security Misconfiguration** — CSP, HSTS, COOP/COEP headers. No `*` in CORS.
- **A06 Vulnerable Components** — `npm audit` in CI; block HIGH/CRIT on PR.
- **A07 Authn Failures** — bearer tokens only; short TTL; rotation runbook.
- **A08 Software & Data Integrity** — signed upload URLs only; SHA-256 content hash stored with every extraction.
- **A09 Logging Failures** — structured logs with correlation IDs; PII scrubbed; retention per runbook.
- **A10 SSRF** — outbound calls go only to allowlisted provider hostnames.

- **No secrets in code, logs, or error messages.** CI has a secret scanner. Keys come from the Secrets Adapter only.

## §7. Database

- **Postgres only** (Supabase Postgres or AWS RDS Postgres). No DB-specific vendor extensions that break portability (see `portability.md`).
- **All schema changes via migrations.** No ad-hoc ALTER.
- **Every migration has a `.rollback.sql`.** CI verifies round-trip.
- **Every mutable table has:** `id UUID PK`, `created_at`, `updated_at`, `version INT`, `correlation_id UUID` where applicable.
- **Append-only tables** (audit, cost ledger) use triggers to block UPDATE/DELETE.
- **FKs use `ON DELETE RESTRICT`** for clinical data. `CASCADE` only for staging-owned child rows that are inert without the parent.
- **Naming:** `snake_case` for tables/columns; pluralized table names (`ocr_extractions`, not `ocr_extraction`).

## §8. Logging & observability

- **Structured JSON logs.** `pino` + level (`debug|info|warn|error|fatal`).
- **Every log line carries** `correlation_id`, `request_id`, `extraction_id` (when known). No `console.log` in production code.
- **Metrics** via a neutral interface; adapter writes to Prometheus (prod) or a DB table (POC).
- **Tracing** via OpenTelemetry; no-op exporter in POC.
- **No PII in logs.** Patient ID only (opaque). Never names, UHIDs, DOB, phone.

## §9. Testing (cross-reference `05_testing/`)

- **TDD mandatory.** Failing test committed before impl (Gate 2).
- **Pyramid:** 80% unit, 15% integration, 5% e2e/clinical-acceptance.
- **Core coverage ≥ 90%** lines + branches. Adapters ≥ 70%.
- **No "test-only" branches in production code.** No `if (process.env.NODE_ENV === 'test')` shortcuts.
- **Fakes > mocks.** Prefer a hand-written `FakeOcrAdapter` with scripted responses over a Jest spy.
- **Property-based tests** (fast-check) for anything combinatorial — state machine, file router decisions, promotion dedup.
- **Golden-file tests** for structured extraction schemas.
- **Clinical-acceptance tests** are part of CI; they must all pass before merge.

## §10. API design

- **OpenAPI 3.1 is the source of truth.** Code is generated or hand-written to match; CI diffs the spec against the live routes.
- **Semantic versioning on the API path** (`/dis/v1/...`). Breaking changes → `/v2/...`, never mutate v1.
- **Consistent pagination:** cursor-based (`next_cursor`), not offset.
- **Consistent error envelope** (`04_api/error_model.md`).
- **Idempotency-Key header mandatory** on all state-changing endpoints.

## §11. Commits, branches, PRs

- **Conventional Commits** (https://www.conventionalcommits.org). Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`, `style`, `build`.
- **Scope = ticket ID.** Example: `feat(DIS-023): promotion service with CS-10/CS-11 guards`.
- **One ticket = one branch = one PR** (squashed on merge).
- **Branch names:** `feat/dis-###-<slug>`.
- **PR description** references TDD section + acceptance criteria checklist.
- **No force-pushing shared branches.** `main` and `feat/dis-plan` are protected.
- **Co-authored trailers** required when an agent committed: `Co-Authored-By: Claude <noreply@anthropic.com>`.

## §12. Dependencies

- **Minimize.** Every new runtime dep requires a justification comment in the PR.
- **Pinned** — `package-lock.json` committed.
- **License check** — no AGPL / SSPL / non-OSI licenses.
- **No transitive fetches at runtime** — everything declared in `package.json`.
- **`npm audit` in CI** blocks HIGH+.

## §13. Accessibility (verification UI)

- **WCAG 2.2 AA** baseline. Lighthouse a11y ≥ 90.
- **Semantic HTML first.** ARIA only when semantics are insufficient.
- **Keyboard navigable.** All actions reachable without a mouse.
- **Color contrast ≥ 4.5:1** for text, 3:1 for large text.
- **No reliance on color alone** for conveying confidence or status.
- **Screen-reader labels** on every form field.

## §14. Performance

- **Budget per endpoint** documented in `02_architecture/tdd.md` §18. CI fails if P95 regresses >10%.
- **N+1 queries banned.** Use joins or `IN` lists.
- **No blocking synchronous I/O in request handlers.**
- **Streaming where reasonable** — long OCR responses, large PDF viewers.

## §15. Documentation

- **Every public function has a JSDoc** stating: purpose, params, return, throws, relation to a TDD section.
- **ADRs for meaningful decisions** under `02_architecture/adrs/NNNN-title.md`. Format: Context / Decision / Consequences / Alternatives.
- **Code-level comments explain WHY, not WHAT.** WHAT is in the code.

## §16. What counts as "done"

A ticket is done when:

- All acceptance criteria satisfied with linked evidence.
- Tests written, green, merged on the same PR.
- TDD / runbook / API doc updated in the same PR if touched.
- `CHANGELOG.md` updated.
- Lint / typecheck / tests / audit all green in CI.
- Reviewer has left `Approved`.
- All applicable Gate-6 sign-offs present.

## §17. Enforcement

These standards are enforced through:

- **`.eslintrc`** bans `any` (with exception comment pragma), enforces import boundaries (via `eslint-plugin-boundaries`).
- **`tsconfig.json`** strict mode.
- **CI** runs lint, typecheck, test, audit, port-validator, spec-diff.
- **Pre-commit hook** runs format + lint staged.
- **PR template** contains the standards checklist.

Violations are not style preferences — they are merge blockers.
