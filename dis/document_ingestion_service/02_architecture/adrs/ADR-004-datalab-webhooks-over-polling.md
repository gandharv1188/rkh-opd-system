# ADR-004 — Datalab webhooks over polling for OCR completion

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect, Product Owner
- **Supersedes:** none (refines the adapter wire pattern from ADR-002)

## Context

`DatalabChandraAdapter` (DIS-050) currently polls
`request_check_url` with exponential backoff (1s → 10s cap, 120s
total budget). Live-docs verification (`document_ocr_flow.md §13.4`)
confirmed Datalab supports an alternative push-based pattern via a
`webhook_url` form field. Payload shape:

```
{
  "request_id": "...",
  "request_check_url": "...",
  "webhook_secret": "..."
}
```

Delivery semantics: Datalab retries on 5xx / timeouts (≤30s), not on
4xx. Shared-secret auth — the configured secret is transmitted in
plaintext in the payload body; HTTPS required; handlers must be
idempotent (possible duplicate deliveries).

Polling works today but has two costs: wasted bandwidth on in-flight
documents that complete quickly, and an artificial 10s-cap ceiling
on completion-signal latency even when Datalab finishes in 3s. At
POC volume neither cost is material; at 1000 docs/day both grow
linearly.

## Decision

**Switch `DatalabChandraAdapter` from polling-only to a
webhook-first pattern with polling as fallback.**

Specifically:

1. Submit requests include a `webhook_url` pointing at an internal
   DIS endpoint (to be built in Epic D as DIS-097 extended; the
   webhook receiver validates `webhook_secret` and marks the
   `dis_jobs` row complete — adapter emits a debug-level log noting
   webhook mode is active).
2. Adapter continues to poll `request_check_url` on an internal
   timer (raised to 300s total budget per DIS-050a) as fallback for
   the case where the webhook fails delivery and retries exhaust.
3. The webhook receiver endpoint is out of scope for DIS-050a (the
   adapter hotfix). It lands in Epic D as an extension of DIS-097
   (process-job worker). The adapter is wired so that passing no
   `webhookUrl` constructor option keeps the polling-only behaviour
   — this lets DIS-050a merge before DIS-097 extends.

## Consequences

**Enforced by:**

- DIS-050a (Datalab adapter hotfix) — adds `webhookUrl`
  constructor option and the conditional `form.append('webhook_url',
…)` call. VERIFY-7 in the backlog entry asserts `webhook_url`
  appears in the adapter source.
- DIS-097-extended (Epic D) — implements the
  `/internal/datalab-webhook` receiver with shared-secret
  validation, idempotent handling of duplicate deliveries, and
  the `dis_jobs` state update.
- Integration tests must cover: webhook-arrived-first happy path,
  webhook-never-arrives poll-fallback, duplicate-delivery
  idempotency.

**Becomes easier:**

- **Completion-latency floor drops** from ~10s (next poll) to
  webhook-delivery-latency (typically sub-second).
- **Bandwidth savings** at any non-trivial volume — no wasted
  poll for completed jobs.
- **Provider retry semantics** (5xx / timeout retry built in) give
  us more resilience than pure polling, where a transient network
  hiccup during a poll cycle was previously opaque.

**Becomes harder:**

- **Second failure surface** — webhook delivery can now fail
  independently of the OCR job itself. Mitigation: polling fallback
  - Datalab's own 5xx retries + idempotent receiver.
- **Public reachability requirement** — the webhook receiver
  endpoint must be reachable from Datalab's egress. In POC on
  Supabase, the Edge Function URL is already public; on AWS, ALB
  with appropriate path routing suffices.
- **Shared-secret rotation** becomes a fourth secret to track (in
  addition to `DATALAB_API_KEY`, `ANTHROPIC_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`). Key rotation runbook
  (`09_runbooks/key_rotation.md`) needs a note; otherwise no
  procedural change.
- **Plaintext secret transmission** — Datalab transmits
  `webhook_secret` in the JSON body, not as an HMAC header. HTTPS
  is mandatory end-to-end; the receiver MUST compare the received
  secret against the configured one and refuse any request where it
  doesn't match. This is the sole authentication mechanism; log
  every mismatch as a potential probe.

**What this does NOT change:**

- CS-2 preservation (raw response stored byte-identically) — the
  webhook path still fetches the final body from
  `request_check_url` before declaring the job complete, so the
  stored `rawResponse` is the same full response polling would
  have produced.
- Idempotency-Key contract on DIS `/ingest` (TDD §5) — webhook
  delivery doesn't change the request-level idempotency semantics.
- Error taxonomy (`04_api/error_model.md`) — `OcrProviderError`,
  `OcrProviderTimeoutError`, and the new
  `OcrProviderRateLimitedError` from DIS-050a remain the adapter's
  typed error surface.

## Alternatives considered

### Keep polling only (status quo)

**Rejected because:** at sustained volume the latency floor and
bandwidth waste are real costs; the webhook path has no architectural
downside beyond the public-reachability requirement, which is
already satisfied.

### Webhook only, no polling fallback

**Rejected because:** webhook delivery is best-effort. Without a
fallback, a single Datalab → DIS connectivity blip could leave a
job in `processing` forever. Polling fallback is a cheap belt to the
webhook suspenders.

### Server-sent events (SSE) instead of webhooks

**Rejected because:** Datalab does not offer SSE. Polling remains
the only option if webhooks are rejected.

### Long-poll instead of short-poll

**Rejected because:** Datalab's check endpoint is a short-poll
returning immediately with the current status; long-poll is not a
supported mode.

## Follow-up tickets

- **DIS-050a** (already in backlog) — implements the adapter side.
- **DIS-097-extended** (Epic D extension) — implements the receiver.
  Note in DIS-097 handoff required when Epic D dispatches.
- **09_runbooks/key_rotation.md** — add a note about the webhook
  secret once DIS-097-extended lands. Out of scope for DIS-002e
  (ADR authoring only); will be handled as part of DIS-097
  handoff.
