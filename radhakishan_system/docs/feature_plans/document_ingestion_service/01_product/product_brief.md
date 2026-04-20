# Product Brief

## Problem

Reception and nurses upload medical documents (lab reports, discharge
summaries, prescriptions, vaccination cards) during patient registration.
The current pipeline extracts clinical fields using Claude Sonnet 4 Vision
and writes them directly into `lab_results`, `vaccinations`, and
`visits.attached_documents`. No human verifies the extraction. There is
no audit trail of the raw model output. Re-processing creates duplicate
rows. The model provider and cloud provider are both baked into the
Edge Function.

## Proposal

Replace the single-step pipeline with a staged, verification-gated
Document Ingestion Service. All OCR-derived data lands first in a
staging table. A nurse reviews, optionally edits, and approves. Only
approved data reaches clinical tables. The raw model output is
preserved indefinitely for audit and reproducibility.

Architecturally, separate the service into Ports & Adapters so the OCR
provider, the structuring LLM, the storage backend, and the database
can each be swapped without touching business logic.

## Users

| Role             | Interaction with DIS                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Reception clerk  | Uploads files at registration. Unchanged UX. Sees a "Processing" → "Ready for review" status instead of "AI extracted: …" today. |
| Nurse / verifier | **New role in this flow.** Opens the Verification UI, reviews extracted fields side-by-side with the source, approves or edits.  |
| Doctor           | Reads verified labs on the prescription pad. Never sees unverified OCR output again.                                             |
| System admin     | Monitors extraction queue, handles stuck jobs, rotates provider keys.                                                            |

## Success criteria

Measured 30 days after default rollout:

1. **Zero unverified clinical rows.** Every row in `lab_results` created
   by DIS has a non-null `ocr_extraction_id` or `verified_by` (manual).
2. **>95% of extractions verified within 4 hours** during business hours.
3. **Nurse edit rate <30%** — most extractions approved as-is. If
   higher, it's a signal to improve prompts or preprocessing.
4. **Per-document cost <= current cost.** Target: at least 30% cheaper
   via Chandra + Haiku vs. Sonnet Vision.
5. **P95 end-to-end latency (upload → ready-for-review) <= 60 s.**
6. **Zero clinical-safety incidents** attributable to an un-audited OCR row.
7. **The service can be redeployed to a fresh AWS account in one working
   day** using only the portability plan — proven via a dry-run.

## Scope (v1)

**In scope:**

- New `ocr_extractions` table + FK column on `lab_results` and `vaccinations`.
- New HTTP service with file router, preprocessor, OCR adapter, structuring adapter.
- Datalab `/convert` integration.
- Claude Haiku integration for structuring.
- Confidence-gated auto-approval policy (off by default; opt-in per deployment).
- Verification UI (new page).
- Rollout via feature flag: shadow → opt-in → default.
- Portability adapters: `StorageAdapter`, `DatabaseAdapter`, `SecretsAdapter`, `QueueAdapter`.
- Comprehensive test suite including clinical acceptance tests.
- Runbooks for incident response.

**Explicitly out of scope** — see `00_overview/non_goals.md`.

## Assumptions

- Datalab hosted API remains available with current pricing.
- Claude Haiku produces JSON reliably when given a strong schema prompt.
- Nurses have a ~5-minute window during/after registration for verification.
- Clinical team accepts the latency tradeoff (verification adds human time, but removes clinical risk).
- Daily document volume stays under 100/day during POC — relevant for Supabase free-tier sizing.

## Risks and mitigations

| Risk                                           | Likelihood | Impact | Mitigation                                                                                             |
| ---------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Datalab API outage                             | M          | H      | Fallback adapter → Claude Vision. Kill switch → legacy `process-document`.                             |
| Claude Haiku JSON drift                        | M          | M      | Schema validation on every response; on failure, re-prompt with `strict: true` or fall back to Sonnet. |
| Verification backlog grows                     | M          | H      | Alerting at queue depth > 20; nurse role is accountable per RACI.                                      |
| Nurse fatigue → rubber-stamp approvals         | H          | H      | UI shows diff-from-Claude if edited; weekly sample audit by clinician.                                 |
| Migration collision with live data             | L          | H      | All new columns are nullable; deploys via shadow mode first.                                           |
| Supabase free-tier storage cap                 | H          | M      | PDF compression on ingest; planned S3 migration at 70% capacity.                                       |
| Claude/Datalab key leak                        | L          | H      | Keys in secrets manager only; rotation runbook; CI secret-scan.                                        |
| Model hallucination slips through verification | M          | H      | Clinical reviewer does weekly sample audit. Metrics track override rate.                               |

## Out-of-the-box wins

- Raw audit trail → satisfies NABH documentation expectations far better than current.
- Adapter layer → buys future optionality (on-prem Chandra, GPT, Gemini) with no rewrites.
- Decoupled structuring LLM → cost tuning dial (Haiku now, Sonnet for hard cases, local model later).
- Verification UI → gives nurses ownership, reduces doctor cognitive load.
