# ADR-005 — Hono as the HTTP framework, not Fastify / Express

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect, Product Owner
- **Supersedes:** none (formalises the DIS-004 handoff decision D-1)

## Context

DIS needs an HTTP framework for its browser-facing endpoints
(`/ingest`, `/extractions/:id`, `/approve`, `/reject`, `/retry`,
`/admin/metrics` — see TDD §3) and its internal worker endpoint
(`/internal/process-job` — see backlog DIS-097). The framework
choice affects portability (Supabase Edge Functions today → AWS
Fargate tomorrow), test ergonomics (integration tests need to hit
the app without a real listening port), bundle size, and ecosystem
compatibility.

Source documents:

- `02_architecture/tdd.md §3` — service boundary and endpoints.
- `02_architecture/portability.md §Runtime compatibility` — "HTTP
  framework: Hono (portable between Node, Deno, Bun, Lambda)."
- `02_architecture/coding_standards.md §1` — language target and
  runtime portability requirements.
- `dis/handoffs/DIS-004.md §3 D-1` — initial framework decision
  during health endpoint implementation.

Wave-3 code already uses Hono (`dis/src/http/server.ts`,
`routes/health.ts`, `middleware/correlation-id.ts`); this ADR
documents the reasoning retroactively and elevates it from a handoff
decision to an architectural decision record.

## Decision

**Use Hono as the HTTP framework for the DIS server.**

Specifically:

- `hono ^4.6.0` — core framework.
- `@hono/node-server ^1.13.0` — Node.js adapter for local dev and
  POC deployment (Supabase Edge Functions run Hono natively if we
  deploy there; the Node adapter covers the Fly.io / Render fallback
  called out in `portability.md`).
- Future AWS deployment uses either Hono on Fargate (same code,
  Node adapter) or Hono on Lambda via `@hono/aws-lambda` (no
  code change; wiring-layer only).

## Consequences

**Enforced by:**

- DIS-001b merges `hono` and `@hono/node-server` into
  `dis/package.json.dependencies`.
- `dis/src/http/server.ts` constructs `new Hono<{ Variables:
AppVariables }>()`; `createServer()` returns a fresh instance per
  call; `start(port)` binds via `serve({ fetch: app.fetch, ... })`
  from `@hono/node-server`.
- The fitness-rules `core_no_fetch` rule already forbids raw
  `fetch(` in `core/` — Hono lives only in `http/`, never in
  `core/`.

**Becomes easier:**

- **Test ergonomics.** Integration tests call `app.fetch(request)`
  directly without binding a port (see
  `dis/tests/integration/health.test.ts` — uses `start(0)` for an
  OS-assigned free port, but unit tests can skip even that and
  drive the Hono fetch handler synchronously).
- **Runtime portability.** Hono runs on Node, Deno, Bun, Cloudflare
  Workers, and AWS Lambda with only the binding adapter changing.
  Our portability story (Supabase → AWS) becomes a wiring-layer
  edit, not a framework rewrite.
- **Typed context.** `Hono<{ Variables: AppVariables }>` gives us
  `c.get('correlationId')` with compile-time type safety for the
  correlation-id middleware (TDD §14).
- **Small surface.** Hono's core is ~100 KB; Express is ~1.5 MB
  with middleware; Fastify sits in between. Startup time matters on
  cold starts in edge/serverless deployments.

**Becomes harder:**

- **Smaller middleware ecosystem** than Express. Mitigation: we
  have carefully scoped middleware needs (correlation ID, error
  envelope, kill-switch, idempotency, rate limit) and each is a
  few lines of native Hono middleware — no ecosystem search
  required.
- **Less familiar to engineers coming from the Express world.**
  Mitigation: Hono's API is Fetch-API-shaped (Request/Response),
  which every TypeScript engineer already knows from browsers and
  service workers.

**What this does NOT change:**

- OpenAPI 3.1 remains source of truth (`coding_standards §10`).
  Hono does not auto-generate the spec; the spec is authored in
  `dis/openapi.yaml` (DIS-007 backlog ticket).
- Error envelope (`04_api/error_model.md`) is enforced by the
  error-envelope middleware (DIS-005 backlog ticket), not by any
  framework-specific plugin.
- The `transition()` state machine (DIS-020) lives in `core/` and
  has zero HTTP dependency. A future framework switch would not
  touch it.

## Alternatives considered

### Fastify

**Rejected because:** Fastify is excellent on Node but has no
first-class non-Node runtime support. Supabase Edge Functions run
Deno, Cloudflare Workers run V8 isolates, AWS Lambda runs Node but
with startup-cost sensitivity. Hono runs on all of them.
Fastify's plugin ecosystem is richer, but we don't need most of the
plugins (we're avoiding ORM plugins per `coding_standards §7`,
avoiding session middleware because DIS is stateless per
`coding_standards §2`, etc.).

### Express

**Rejected because:** large bundle, no TypeScript-native types
(requires `@types/express` shim), no built-in Fetch-API shape,
weaker Lambda story. Essentially outgrown for a 2026 project.

### Hapi / Koa / Fastify-equivalents

**Rejected because:** no meaningful differentiator over Fastify
against Hono's portability + Fetch-API-native advantage. We would
be trading one Node-first framework for another.

### Raw Node `http` + hand-rolled router

**Rejected because:** every routing / middleware / typed-context
feature we need is a reimplementation cost. Hono's core is already
tiny; reinventing a worse version of it wastes time.

### A Deno-only framework (Oak)

**Rejected because:** couples us to Deno and loses the Node story.
Supabase Edge Functions being Deno today is not a binding — the
`portability.md §Compute` table explicitly contemplates Fly.io /
Render (Node) as a POC option.

## Follow-up tickets

None. Hono is already in use in Wave-3 code; DIS-001b lands the
package.json merge; no further ADR-005-specific work is needed.
