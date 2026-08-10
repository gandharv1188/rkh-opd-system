# ADR-006 — `postgres` (porsager) as the Postgres driver; no `pg`, no Drizzle, no Supabase SDK in core

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect, Product Owner
- **Supersedes:** none (formalises the DIS-054 handoff driver choice)

## Context

The `DatabasePort` adapter needs a Postgres driver. Candidates:
`pg` (node-postgres), `postgres` (porsager/postgres), an ORM
(Drizzle, Prisma, TypeORM), or the Supabase SDK.

Source documents:

- `02_architecture/tdd.md §6` — optimistic locking via
  parameterised `UPDATE ... WHERE id=? AND version=?`.
- `02_architecture/coding_standards.md §6 A03` — "Injection:
  parameterised queries only; no string concatenation into SQL."
- `02_architecture/coding_standards.md §7` — "Postgres only...
  no DB-specific vendor extensions that break portability."
- `02_architecture/portability.md §Database portability` — the
  same adapter file targets both Supabase Postgres and AWS RDS
  Postgres; no Supabase-specific SQL.
- `dis/handoffs/DIS-054.md §Driver wiring` — "The adapter does
  not import `postgres` at module load so unit tests stay
  hermetic."
- `dis/src/adapters/database/supabase-postgres.ts` —
  `setPostgresDriverLoader` indirection already in place.

The decision was effectively taken during DIS-054 implementation;
this ADR elevates it to an architectural record because (a)
switching drivers is a cross-cutting breaking change and (b) DIS-021b
is about to extract named DatabasePort methods that will use the
driver surface.

## Decision

**Use `postgres ^3.4.4` (porsager/postgres) as the Postgres driver
for all DIS adapter code.**

Four binding rules:

1. **The `postgres` module is imported only by
   `src/adapters/database/supabase-postgres.ts` (and its future AWS
   equivalent).** Core and ports never import it directly.
2. **The adapter uses `sql.unsafe(text, params)` for parameterised
   queries** — not the tagged-template form — because the
   `DatabasePort` contract takes `(sql: string, params: readonly
unknown[])` and the tagged-template form would require a different
   port shape that we are not adopting.
3. **Module-level import is indirected via
   `setPostgresDriverLoader`** so unit tests inject a fake
   `SqlClient` without loading the real driver. The wiring layer
   (`src/wiring/supabase.ts`) calls `setPostgresDriverLoader(...)`
   once at boot.
4. **No ORM.** No Drizzle, no Prisma, no TypeORM. Schema lives in
   migrations under `dis/migrations/`; queries are SQL strings with
   positional parameters. This is explicit per
   `coding_standards.md §7`.

## Consequences

**Enforced by:**

- DIS-054 — adapter implementation.
- DIS-021b — extracts named methods on `DatabasePort`
  (`findExtractionById`, `findExtractionByIdempotencyKey`,
  `updateExtractionStatus`, `insertExtraction`) that internally use
  `sql.unsafe()`. This resolves the 5 pre-existing
  `core_no_sql_literals` fitness violations by moving the SQL
  strings out of `core/orchestrator.ts` into the adapter boundary
  where they belong.
- `dis/scripts/fitness-rules.json` — `core_no_sql_literals`
  enforces the rule that SQL strings live only in adapters.
- The `dis/package.json` runtime-deps set (merged in DIS-001b)
  lists `postgres ^3.4.4` and NOT `pg` or Drizzle.

**Becomes easier:**

- **Parameterised queries are the only path.** `sql.unsafe(text,
params)` does not support string concatenation into the text
  slot when user data is involved — developer would have to
  actively subvert the shape to create an injection.
- **Same adapter file for Supabase Postgres and AWS RDS.** Only
  the wiring differs. The portability dry-run (Epic H) does not
  touch the adapter's body.
- **Hermetic unit tests.** `setPostgresDriverLoader` + the `sql`
  constructor option let tests inject a fake client. DIS-054's
  7 unit tests run without any real Postgres.
- **Connection pool reuse.** The adapter holds one `SqlClient`
  per process; `postgres`'s internal pool handles concurrency.
  No manual pool wiring in the adapter.

**Becomes harder:**

- **Query builders absent.** No Drizzle-style typed query DSL; the
  developer writes SQL strings. Mitigation: named methods on
  `DatabasePort` (DIS-021b) localise the SQL so most callers
  don't write it.
- **Type inference over row shapes is limited.** `query<T>(sql,
params): T[]` takes T from the caller; the driver doesn't
  validate it. Mitigation: schema validation at the boundary —
  callers that care about shape use Ajv (DIS-030) or hand-rolled
  checks, same as every other external-data path in DIS.
- **Supabase SDK features (e.g. PostgREST filters, Realtime
  channels) are not available through this adapter.** By design:
  `StoragePort` uses REST and a plain `fetch` (DIS-053);
  realtime (DIS-098) uses Supabase Realtime through its own
  port-layer abstraction, not the DB adapter. The DB adapter stays
  a pure SQL surface.

**What this does NOT change:**

- Transactions: `DatabasePort.transaction(work)` delegates to
  `sql.begin(fn)`, preserving the driver's BEGIN/COMMIT/ROLLBACK
  semantics including session-scoped vars.
- RLS session vars: `setSessionVars` emits parameterised
  `SET LOCAL` — key names validated against
  `^[a-z_][a-z0-9_.]*$/i` to refuse injection via the identifier
  slot.
- Typed error wrapping: `DatabaseConnectionError` wraps driver
  connection errors (`ECONNREFUSED`, `ECONNRESET`, etc.) without
  leaking driver types.

## Alternatives considered

### `pg` (node-postgres)

**Rejected because:** broader ecosystem but weaker ergonomics —
callback-based pool by default (promise wrapper needed), no
tagged-template form, less pleasant error surface. `postgres`
(porsager) is the modern equivalent; no technical reason to prefer
`pg` in 2026.

### Drizzle ORM

**Rejected because:** we do not need a query builder. The
orchestrator + promotion + audit-log paths all use ≤5 distinct
SQL statements each; hand-writing them is cheaper than maintaining
Drizzle schema definitions in parallel with migrations. Drizzle
also couples us to its migration tool vs. `dbmate` (chosen for
portability per `portability.md`).

### Prisma

**Rejected because:** Prisma's runtime is heavyweight (engine
binary), not compatible with Cloudflare Workers, poor fit for
serverless cold starts. Type safety benefits don't offset the
operational cost.

### Supabase SDK (`@supabase/supabase-js`)

**Rejected because:** the SDK is an HTTP-over-PostgREST wrapper
— it would leak Supabase-specific behaviour into the adapter
(filter operators, PostgREST error shapes, auth-header
conventions). `portability.md §Runtime compatibility` explicitly
says "Supabase SDK confined to `adapters/storage/supabase-storage.ts`,
`adapters/database/supabase-postgres.ts`, `adapters/secrets/
supabase-secrets.ts`, `adapters/queue/pg-cron.ts`." The database
adapter uses `postgres` directly over TCP — no SDK — so the same
file works unchanged on AWS RDS.

### Raw `pg` pool + hand-rolled parameterised-query helper

**Rejected because:** reinvents what `postgres` gives us for free.
Worse, any shortcut in the hand-rolled helper becomes an injection
vector.

## Follow-up tickets

- **DIS-021b** — extracts named `DatabasePort` methods that
  encapsulate the SQL strings, clearing the 5 pre-existing
  `core_no_sql_literals` violations.
- **DIS-074** (Shared `DatabasePort` contract test suite) — will
  exercise this ADR's invariants (parameterised queries only,
  transaction semantics, session-var scope) against every
  `DatabasePort` implementation (Supabase Postgres, future
  AWS-RDS, FakeSupabasePostgresAdapter).
