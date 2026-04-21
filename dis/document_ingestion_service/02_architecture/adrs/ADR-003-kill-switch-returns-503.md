# ADR-003 — Kill switch returns HTTP 503 UNAVAILABLE (not 307 proxy to legacy)

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect, Product Owner
- **Supersedes:** none (reconciles cross-doc inconsistency)

## Context

Three DIS documents prescribed a single source of kill-switch
behaviour but disagreed on the HTTP semantics:

- `06_rollout/rollout_plan.md` (Phase 1 onward) — "DIS_KILL_SWITCH=true
  → /ingest returns 503 UNAVAILABLE."
- `06_rollout/feature_flags.md §2` — "When enabled, every write
  endpoint returns 503 with a Retry-After header pointing at the
  legacy flow."
- `07_tickets/backlog.md` DIS-100 (kill-switch middleware ticket) —
  "returns 503 on writes when enabled; GETs still succeed."
- `09_runbooks/kill_switch.md` — "Returns HTTP-307 proxy to the
  legacy `process-document` handler with the original request body
  unchanged."
- `04_api/error_model.md` — lists `UNAVAILABLE` (503) as a
  first-class error code with `retryable: true`.

Three of the five sources say 503. One (the runbook) says 307
proxy. The error model has a code for 503 and no dedicated one for 307. The conflict must be resolved before DIS-100 (Epic D) is built
— otherwise the middleware implementer faces a contradiction.

## Decision

**DIS returns HTTP 503 UNAVAILABLE on write endpoints when
`DIS_KILL_SWITCH=true`**, with a `Retry-After` header and an error
body conforming to `04_api/error_model.md` (code `UNAVAILABLE`,
`retryable: true`). GETs continue to succeed so nurses can still
drain the pending verification queue.

The client is responsible for falling back to the legacy path —
either by user-agent (browser code in `web/registration.html` can
branch on a 503 from `/ingest`) or by an upstream proxy if one is
ever introduced. The DIS service does not itself proxy to the
legacy Edge Function.

Reconciliation: `06_rollout/kill_switch.md` prose is amended to
replace the "307 proxy to legacy" description with the 503
decision. The un-flip ritual (48h shadow re-soak + clinician
sign-off) stays unchanged.

## Consequences

**Enforced by:**

- DIS-100 backlog ticket (kill-switch middleware) — its VERIFY
  block already asserts 503 on writes + GETs succeed + typed
  `Retry-After` header.
- DIS-108 integration test (kill-switch flip) — end-to-end
  assertion that POST /ingest returns 503 within one request
  after the flag flips.
- `04_api/error_model.md` — no change needed; UNAVAILABLE is
  already the canonical code.

**Becomes easier:**

- **Separation of concerns.** DIS has one job (verify-and-promote
  OCR-derived data). Proxying to a legacy Edge Function would
  entangle two lifecycles; 503 keeps DIS clean.
- **Client-side fallback is explicit.** The browser (or caller)
  chooses whether to retry, display a banner, or invoke the legacy
  path. The DIS service stays honest about being unavailable.
- **Kill-switch testing is local.** DIS integration tests do not
  need a running legacy service; they only need to assert the 503
  response shape.
- **Observability is cleaner.** Every kill-switch activation is
  one log event in one service; no inter-service proxy traces to
  correlate.

**Becomes harder:**

- Clients (browsers, internal callers) must implement the
  fallback themselves. The registration page's existing upload
  code already has a legacy-first architecture — the kill-switch
  503 path simply means "if DIS says UNAVAILABLE, go back to
  legacy," which is the existing flow anyway during Phase 0-1.
- On-call playbook must state clearly that 503 is expected
  behaviour during an incident — the runbook's "how to detect
  the flip has taken effect" section will be updated to match.

**What this does NOT change:**

- Un-flip ritual: still 48h shadow re-soak (4h for non-safety) +
  clinical-lead sign-off (per `kill_switch.md §How to un-flip`).
- RTO: still ≤5 min flip-to-effect (TDD §18).
- Three flip paths: CLI secrets set / dashboard / DB-row via
  LISTEN/NOTIFY — unchanged.
- The `DIS_KILL_SWITCH` flag itself (`feature_flags.md §2`) —
  unchanged semantics, just clearer HTTP response behaviour.

## Alternatives considered

### HTTP 307 proxy to legacy (the rejected inconsistency)

**Rejected because:**

- Entangles two service lifecycles. If the legacy service is itself
  down, the kill-switch now propagates a different error class
  (502 from the proxy rather than 503 from DIS) — giving on-call a
  confusing signal.
- No canonical error code for "proxied to legacy" in
  `error_model.md`. Adding one just to support the 307 path is
  pure cost.
- Testing requires a running legacy stub. Integration tests
  multiply in complexity.
- Post-Phase-4 legacy removal (`rollout_plan.md §Phase 4`) would
  delete the proxy target. The kill switch would then have no
  legacy to proxy to — the 307 would 404. The 503 response has
  no equivalent trap.

### HTTP 503 with no Retry-After

**Rejected because:** retriable 5xx errors without `Retry-After`
force clients into ad-hoc backoff, exactly the drift
`04_api/error_model.md §Retry policy` was designed to prevent.

### HTTP 451 Unavailable For Legal Reasons

**Rejected because:** semantically wrong. The kill switch is an
operational circuit breaker, not a legal-compliance block.

### Return 200 with a `kill_switch: true` payload

**Rejected because:** violates the HTTP contract. A write endpoint
that accepts the request but doesn't actually write has to return
a 2xx + "accepted but deferred" envelope, which is not the
semantics kill switch wants. Kill switch is a refusal, not a defer.

## Follow-up changes in this PR

- `06_rollout/kill_switch.md` — replace "307-proxy to legacy"
  prose with the 503 + Retry-After description. Keep all other
  sections (un-flip ritual, RTO, three flip paths, detection,
  quarterly game-day).
