# ADR-001 — Hexagonal Ports & Adapters architecture

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect (Claude Opus 4.7), Product Owner (Dr. Lokender Goyal)
- **Supersedes:** none

## Context

DIS must (a) guarantee no OCR-derived row reaches a clinical table
without human verification or an explicit auto-approval gate, and
(b) port from Supabase to AWS in one working day with zero
business-logic rewrites. Both requirements point at the same
architectural primitive: a pure business-logic core that depends on
abstractions, with provider- and cloud-specific concerns isolated at
the edge.

Source documents that bind this decision:

- `02_architecture/tdd.md §1` — Architectural style: "Hexagonal
  (Ports & Adapters) with a thin event-driven core."
- `02_architecture/adapters.md §Ground rules` — 6 rules (core never
  imports adapter; adapters never import each other; core is pure
  TypeScript; adapters avoid Deno/Lambda-specific APIs; every
  adapter has a fake; adapter swaps are configuration).
- `02_architecture/portability.md §The three containment boundaries`
  — Pure core / thin wiring / adapters.
- `02_architecture/coding_standards.md §2` — SOLID + hexagonal +
  CQRS-lite + idempotency first + fail closed.
- `01_product/clinical_safety.md` — CS-1..CS-12 require the
  command-side (staging) / query-side (clinical tables) separation
  that the hexagonal contract makes structural, not accidental.

## Decision

Adopt Hexagonal Ports & Adapters as the DIS architectural style with
**eight named ports** forming the narrow waist between the pure
business-logic core and every external concern:

1. `OcrPort` — document OCR (Datalab Chandra in POC, on-prem later).
2. `StructuringPort` — LLM-to-schema transformation (Claude Haiku
   default, Sonnet escalation).
3. `StoragePort` — object storage (Supabase Storage in POC, S3 in
   prod).
4. `DatabasePort` — Postgres access (Supabase in POC, RDS in prod).
5. `QueuePort` — background jobs (pg_cron in POC, SQS in prod).
6. `SecretsPort` — secret retrieval (Supabase secrets in POC, AWS
   Secrets Manager in prod).
7. `FileRouterPort` — native-PDF vs scan vs office dispatch.
8. `PreprocessorPort` — image normalisation pipeline.

Every adapter is swappable by configuration, not deployment. The
composition root (`src/wiring/supabase.ts` or `src/wiring/aws.ts`) is
the only place the choice is made.

## Consequences

**Enforced by CI:**

- `dis/scripts/fitness.mjs` rules `core_no_adapter_imports` and
  `ports_no_adapter_imports` fail any PR where `core/` or `ports/`
  imports from `adapters/`.
- `supabase_sdk_only_in_supabase_adapters` and
  `aws_sdk_only_in_aws_adapters` fail any PR that leaks
  provider-specific SDKs outside the adapter directories allowed
  to use them.
- `core_no_fetch` and `core_no_sql_literals` fail any PR that puts
  network or SQL concerns inside core. (Note: 5 pre-existing
  `core_no_sql_literals` violations in `orchestrator.ts` +
  `__fakes__/database.ts` are resolved in DIS-021b by extracting
  named `DatabasePort` methods.)
- Every adapter has a fake under `__fakes__/`; core unit tests
  compose the core with fakes only.

**Becomes easier:**

- Swapping Datalab for an on-prem Chandra deployment when volume
  justifies (see ADR-002) is a one-adapter change with no core
  edits.
- Running the full core unit test suite in <1s, because fakes are
  in-memory and deterministic.
- Adding a new OCR provider (e.g. a vision-LLM fallback) is a new
  adapter + a wiring-layer flag, not an orchestrator rewrite.

**Becomes harder:**

- "Quick prototypes" inside the core are not possible — any new
  external concern must first be modelled as a port. This is the
  intended friction.
- A port-version bump is a breaking change that needs an ADR + all
  adapters updated in the same PR (per `adapters.md §Change
control`).

**Future ADRs that would supersede this one:**

- Moving to a message-oriented architecture (CQRS + event sourcing)
  would be a new ADR superseding this. No current pressure.
- Moving away from TypeScript would require a new architectural ADR.
  Not on any roadmap.

## Alternatives considered

### Layered MVC (Controller / Service / Repository)

**Rejected because:** the success criterion is swapping cloud and
vendor with zero business-logic changes. Layered MVC typically
couples the service layer to a specific ORM / HTTP framework; the
portability dry-run would hit rewrites exactly where we cannot
afford them.

### Clean Architecture (Uncle Bob's concentric layers)

**Rejected because:** Clean Architecture is a superset of Hexagonal
for our needs and adds complexity (entity / use-case / interface /
framework layers) without benefit at this scale. Hexagonal gives us
the Dependency Inversion boundary we need; Clean Architecture's
additional inner layers would pay for themselves only at a much
larger codebase.

### Event-Sourced / CQRS-heavy

**Rejected because:** medical document ingestion is request/response
in nature — a document arrives, gets processed, gets verified, gets
promoted. Event sourcing buys audit trail, but DIS already has
`ocr_audit_log` (CS-3, CS-6) and `ocr_extractions` preserving raw
responses forever (CS-2). A full event-sourced design would add a
projection layer we do not need.

### "Just write it plainly and refactor later"

**Rejected because:** clinical data makes the refactor-later plan
unacceptable. Every month DIS runs without the hexagonal boundary is
a month where a well-meaning patch can land an adapter import inside
core and break CS-1 by accident. The boundary is cheapest to enforce
on day 1.
