# DIS Observability Stack

How to read, trace, and alert across the four telemetry pillars of the Document Ingestion Service. This page is the single entry point for operators; follow the links into specific runbooks when an alert fires.

## Logs

- **Source**: pino JSON lines (DIS-146 at `src/observability/logger.ts`). Every subsystem uses the shared logger; no `console.log` is allowed in shipped code.
- **PII redaction**: applied at emit time by the pii-redactor (DIS-161). Redaction happens BEFORE the log line leaves the process — there is no raw-PII path to disk.
- **Shipped to**: file per pod in POC (stdout → container log); structured drain → cloud log aggregator in staging/prod.
- **Key fields**: `correlation_id`, `extraction_id`, `operator_id`, `stage`, `level`, `msg`. Every log line carrying a request MUST include `correlation_id` (enforced by middleware).
- **Query examples**:
  - Single request trace: `jq 'select(.correlation_id == "corr-xyz")' dis.log`
  - All errors for an operator: `jq 'select(.operator_id == "op-42" and .level == "error")' dis.log`
  - Stage breakdown: `jq -r '.stage' dis.log | sort | uniq -c`

## Traces

- **Source**: in-process Tracer (DIS-147 at `src/observability/tracing.ts`). OTel SDK migration is tracked as DIS-147-followup; until then the in-process tracer emits spans in the OTel JSON wire format so the upgrade is drop-in.
- **Sampling**: DIS-164 policy — 100% of errors and anything tagged `clinical-safety`; 10% of successes. Errors are never dropped.
- **Span names**: `adapter.<port>.<operation>` (port adapters), `core.<stage>` (pipeline stages), `http.<method>.<route>` (inbound HTTP). Span names are stable — do NOT rename without a deprecation window.
- **Correlation**: every span carries `correlation_id` as an attribute so traces join to logs and metrics by a single key.

## Metrics

- **Endpoint**: `GET /admin/metrics` (DIS-099) exposes Prometheus-format counters, gauges, and histograms.
- **Canonical names** (DIS-148, frozen):
  - `queue_depth` — gauge, current depth of the extraction queue.
  - `extractions_approved_total` — counter.
  - `extractions_rejected_total` — counter with `reason` label.
  - `ocr_latency_ms_p95` — summary, OCR wall time.
  - `cost_micro_inr_total` — counter, cumulative cost in micro-rupees (AI + OCR + storage).
- **SLO**: operator p95 verify latency < target (DIS-159). Breach triggers review, not auto-page.

## Alerts

- **Queue depth breach**: DIS-150 webhook fires when `queue_depth > 20` sustained 5 min → `09_runbooks/stuck_jobs.md`.
- **Cost budget**: DIS-165 refuses uploads when the daily budget is exhausted; operators see a banner and a scheduled retry at budget reset.
- **Audit integrity**: DIS-162 nightly merkle check; mismatch opens a P1 incident — see `incident_response.md`.
- **OCR provider outage**: DIS-150 webhook on sustained adapter-level 5xx rate → `provider_outage.md`.
- **Schema drift**: migration verifier mismatch → `migration_incident.md`.

## Runbooks

- `09_runbooks/stuck_jobs.md` — queue stalled or jobs looping.
- `09_runbooks/provider_outage.md` — OCR/AI provider degraded or down.
- `09_runbooks/incident_response.md` — P1 playbook, paging, comms.
- `09_runbooks/migration_incident.md` — schema drift or bad migration.
- `09_runbooks/key_rotation.md` — credential rotation steps.
- `09_runbooks/dr_and_backup.md` — DR and backup verification.

## Cross-references

- Logger: DIS-146. Tracer: DIS-147. Metrics endpoint: DIS-099. Metric names: DIS-148. Webhook alerts: DIS-150. SLO: DIS-159. PII redaction: DIS-161. Audit merkle: DIS-162. Sampling policy: DIS-164. Cost budget: DIS-165.
