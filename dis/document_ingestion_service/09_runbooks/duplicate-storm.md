# Runbook: Duplicate Upload Storm (CS-4)

**Scenario:** The ingestion queue spikes because the same payload (identified by `payload_hash`) is being uploaded many times in rapid succession. This runbook covers the CS-4 "duplicate upload" class — whether caused by legitimate reception-desk behaviour (multiple operators re-submitting the same lab PDF for the same visit) or a malicious/buggy retry loop.

Owner: on-call ingestion operator. Expected resolution: < 30 min for contain, < 24 h for post-mortem.

## Step 1 — Detect

Signals that a duplicate storm is under way:

- **Metric:** `dis_ingestion_duplicate_rate` (payloads-with-existing-hash / total) > 20% over a 5 min window.
- **Queue depth:** `dis_queue_depth` climbs faster than `dis_ingestion_throughput` drains it.
- **Logs:** many rows in `ingestion_events` with `event_type='duplicate_detected'` against the same `payload_hash` inside a short window.
- **UX signal:** reception operators report seeing the DIS-122 `DuplicateBanner` repeatedly for the same patient.

Query the last 15 min of duplicate events grouped by `payload_hash` and by `operator_id` to see whether the storm is concentrated on one hash, one operator, or broadly distributed.

## Step 2 — Triage (legitimate vs. malicious)

Determine storm class before containing, because the containment differs:

- **Legitimate concurrent retry:** two or more reception operators at the front desk simultaneously uploaded the same scanned report for the same patient/visit. Typically: same `payload_hash`, 2–5 distinct `operator_id` values, timestamps clustered within seconds, from on-premise IP. Action: proceed to Step 4 (operator notification) and let CS-4 override protocol handle promotion.
- **Client retry loop (bug):** same `operator_id`, same `payload_hash`, dozens to hundreds of attempts per minute, exponential or constant cadence. Action: Step 3 containment against that operator/session is mandatory before anything else.
- **Malicious abuse:** same or rotating `operator_id` but anomalous cadence, off-hours, or payloads that fail validation. Action: Step 3 containment plus security paging.

Record the classification in the incident ticket — it drives Step 6 post-mortem scope.

## Step 3 — Contain

- Engage the DIS-102 per-operator rate limiter. Temporarily lower `max_tokens` for the offending `operator_id` (or IP, for malicious classification) from the default to a tight ceiling (e.g. 2/min). Limiter config is ephemeral — document the override in the incident ticket so it is reverted post-incident.
- If an entire client build is looping, lower the global `max_tokens` for that version header until a patched client rolls out.
- Do NOT disable the DIS-037 promotion dedupe. The dedupe layer is what keeps `lab_results` clean even while the queue is noisy; turning it off turns a queue storm into a data-integrity incident.

Verify containment: `dis_ingestion_duplicate_rate` should drop within one minute. If not, escalate to platform on-call.

## Step 4 — Notify operators

- Confirm DIS-122 `DuplicateBanner` is rendering for the affected payload at reception. The banner is the user-facing signal that the upload was recognised as a duplicate — operators should stop re-submitting when they see it.
- For the clinician at the doctor OPD station: point them at the CS-4 override protocol. If the duplicate actually represents a clinically distinct result (e.g. repeat lab with a different value under the same filename), the clinician uses the override to force-promote the new payload; otherwise the existing promoted record stands.
- Announce in the ops channel so no second responder re-triages the same alert.

## Step 5 — Audit

Before declaring the incident resolved, prove no bad data leaked past the dedupe:

- Run the DIS-037 dedupe audit query: for each `payload_hash` touched in the storm window, confirm at most one row in `lab_results` (or whichever domain table) was promoted. Any `payload_hash` with >1 promoted row is a dedupe failure and escalates to a P1.
- Cross-check `ingestion_events` against `lab_results.created_at` to confirm no promotion happened during the window for a duplicate that should have been suppressed.
- Spot-check 3–5 affected patient records end-to-end (registration → lab_results → prescription) to make sure the UI shows exactly one entry per real result.

Attach the audit query output to the incident ticket.

## Step 6 — Post-mortem

Within 24 h of resolution, answer:

- Root cause: bug, process gap, or abuse? Legitimate concurrent re-submit (CS-4-LEG) vs. client retry loop (CS-4-BUG) vs. abuse (CS-4-SEC).
- Did DIS-122 `DuplicateBanner` render correctly and soon enough? If operators kept retrying past the banner, the UX needs work.
- Did DIS-037 promotion dedupe hold under the burst? Record the peak duplicate rate and whether dedupe latency degraded.
- Was the DIS-102 rate limit override appropriate, or does the default `max_tokens` need tuning?
- Action items: file tickets for any UX, limiter, or client-side fixes. If classification was CS-4-BUG, a client patch is mandatory before closing the post-mortem.

Link the post-mortem from the incident ticket and from `dis/document_ingestion_service/09_runbooks/README.md` (index) if material changes.

## References

- DIS-037 — promotion dedupe (audit query lives there)
- DIS-102 — per-operator rate limiter (`max_tokens` override mechanism)
- DIS-122 — `DuplicateBanner` reception-desk UX
