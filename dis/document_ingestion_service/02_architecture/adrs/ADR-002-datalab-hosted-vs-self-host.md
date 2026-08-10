# ADR-002 — Datalab hosted Chandra at POC; self-host threshold at sustained 1000 docs/day

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Architect, Product Owner
- **Supersedes:** none

## Context

The OCR + layout-understanding stage is the only part of the
pipeline with a meaningful build-vs-buy decision. Source documents:

- `dis/handoffs/sessions/document_ocr_flow.md §12` — Chandra vs Claude Vision
  comparison with benchmarks, pricing, license analysis.
- `dis/handoffs/sessions/document_ocr_flow.md §13` — Live-verified Datalab
  platform constraints (400 rpm, 5000 concurrent pages, 200 MB
  files, 7000 pages/request, $3 markdown + $4.50 accurate +
  $25 flat plan fee with $25 included credit).
- Memory `project_chandra_inflection_point.md` — "Switch from
  Datalab hosted Chandra to self-hosted at sustained 1,000
  docs/day."

POC volume is ~20 docs/day and expected to grow slowly. Current
monthly cost is dominated by the $25 flat plan fee; metered
extraction would be ~$0.45-$0.60/month at this volume. Self-hosting
a GPU-backed Chandra deployment would cost $200-400/month just for
compute (A10G or L4 on AWS/GCP), ignoring ops time.

At some volume threshold the monthly savings from self-hosting
cross over the monthly GPU cost + the fixed ops overhead.

## Decision

1. **Use Datalab's hosted `/api/v1/convert` endpoint with
   `mode=accurate`** (runs Chandra) as the primary OCR path in POC
   and through Phase 4 default rollout.
2. **Defer self-hosting evaluation until sustained 1000 docs/day
   over 60 consecutive days.** Below that threshold the hosted plan
   is both cheaper and operationally simpler.
3. **Keep the `OcrPort` contract provider-agnostic** so the future
   switch is a one-adapter change. `OnpremChandraAdapter.stub` is
   a placeholder in the backlog (DIS-062) reserving the interface.

## Consequences

**Enforced by code:**

- `DatalabChandraAdapter` (DIS-050) reads `DATALAB_API_KEY` via
  `SecretsPort` and preserves the full provider response
  byte-identically on `OcrResult.rawResponse` (CS-2). This means
  even after a future switch to self-hosted, the audit trail of
  hosted-era extractions stays intact.
- The adapter enforces live platform limits observed in
  `document_ocr_flow.md §13.3`: max wait is being raised to 300s
  in DIS-050a (from 120s) to accommodate accurate-mode latency on
  multi-page discharge summaries; 429 rate-limit responses will be
  mapped to `RATE_LIMITED` retryable errors.

**Becomes easier:**

- POC operations: no GPU to run, no inference-server uptime to
  monitor, no Chandra-model-update cadence to track. All the ops
  burden is Datalab's.
- Cost predictability: flat $25/month + per-1000-pages overage.
  `dis_cost_ledger` will track spending per extraction for
  variance alerting (DIS-149).

**Becomes harder:**

- PHI crosses to a third-party boundary. Datalab is not formally a
  HIPAA-equivalent provider for Indian clinical contexts — that
  risk is accepted at POC scale and revisited at the self-host
  threshold.
- Outage exposure: Datalab unavailability blocks the DIS ingestion
  path. Mitigated by the fallback adapter (`ClaudeVisionAdapter`,
  DIS-052) and the kill switch (ADR-003).
- Provider-shape drift: Datalab is free to change their response
  format; the block-type coercion in the adapter is tolerant
  (unknown → 'text') but schema-significant changes require an
  adapter update. Mitigated by CS-2 byte-identical preservation —
  historical responses remain parseable against old code.

**Threshold trigger (sustained 1000 docs/day for 60 days)
produces:**

- A new ADR-002-self-host-switchover that evaluates monthly cost
  (~$333 hosted at 60k pages/month vs ~$200-400 self-hosted GPU
  - ops time), data residency posture, and the OnpremChandraAdapter
    (DIS-062) readiness.
- A parallel-run plan where hosted and self-hosted adapters emit
  the same `OcrResult` against a shared fixture set for A/B
  validation, before any cutover.

**Future ADRs that would supersede this one:**

- ADR-002-self-host-switchover (when threshold triggers).
- An ADR choosing a different hosted provider (e.g. Google Document
  AI) would supersede this; no current pressure.

## Alternatives considered

### Self-host Chandra from day 1

**Rejected because:** at ~20 docs/day the $200-400/month GPU cost
and the ops overhead (model updates, Docker image management, VRAM
tuning, inference-server monitoring) dwarf the $25-flat hosted
plan by an order of magnitude. This is a classic premature
infrastructure decision.

### Skip Chandra entirely, use Claude Vision for OCR too

**Rejected because:** Claude Vision is the pre-DIS status quo —
the reason DIS exists is the clinical-safety need for a staged
verification path, not an OCR-accuracy need. Chandra happens to
outperform Claude Vision on tables, handwriting, South-Asian
scripts, and price (per `document_ocr_flow.md §12.3`), so the
switch to Chandra during DIS delivery is net-positive even if
clinical safety is the primary driver.

### Gemini / Google Document AI

**Rejected because:** adds a third cloud dependency (Google) and
the benchmarks in `document_ocr_flow.md §12.2` show Chandra 2
outperforming Gemini 2.5 Flash on the relevant multilingual
benchmark (72.7% vs 60.8%). No strong reason to introduce another
vendor.

### On-prem Chandra immediately for data residency

**Rejected because:** ABDM guidance favors India-resident data but
POC data volumes don't justify the ops investment, and the
Radhakishan Supabase project already resides in India (per the
existing `generate-prescription` Edge Function deployment). Full
data residency discipline arrives with ADR-002-self-host-switchover.
