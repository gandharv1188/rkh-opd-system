# North Star

## The one-sentence goal

Build a cloud-portable, verification-gated Document Ingestion Service that
reliably converts uploaded medical documents into structured clinical data
— without a single unreviewed OCR-derived row ever reaching the doctor's
decision surface.

## Why this exists

The current pipeline (`supabase/functions/process-document`) does the
right things in the wrong order: it lets Claude Vision's raw output flow
directly into `lab_results` and `vaccinations` with no staging, no
verification, no audit trail, and no way to reproduce or challenge a
clinical row after the fact.

That is safe-ish for a POC but unacceptable as the product scales. It
also ties the pipeline to a single model (Claude Sonnet 4) and a single
cloud (Supabase) — both of which the team plans to move away from.

## The three properties we must guarantee

1. **Auditability.** Every OCR-derived field in clinical tables traces
   back to: the source file, the raw model output, the extracted
   structure, the confidence score, the verifier, and the verification
   timestamp.

2. **Safety.** No OCR-derived row appears in `lab_results` or
   `vaccinations` until a human has verified it OR it passes an
   explicit auto-approval gate with documented criteria.

3. **Portability.** The service runs on Supabase today and on AWS
   tomorrow with only adapter-layer changes — no business logic rewrites.

## The shape of the solution

```
Browser (unchanged UX)
   │
   ▼
Ingestion Service API  ──────── Staging Store (ocr_extractions)
   │                                    │
   │                                    ├── Raw model response
   │                                    ├── Structured extraction
   │                                    ├── Confidence scores
   │                                    └── Verification state
   │
   ├── File Router (native-PDF vs scan vs DOCX vs XLSX)
   ├── Preprocessor (deskew, compress, blank-page drop)
   ├── OCR Adapter (Datalab Chandra today, pluggable)
   └── Structuring Adapter (Claude Haiku today, pluggable)

Verification UI ──── nurse/reception approves/edits ──── promote to clinical tables
                                                         (lab_results, vaccinations)
```

## What "done" looks like

- A reception clerk uploads a scanned discharge summary.
- It becomes an extraction in `ocr_extractions` with status `pending_review`.
- The nurse opens the verification UI, sees side-by-side original + extracted
  fields with confidence badges, corrects one value, approves.
- Rows appear in `lab_results` with `source: 'verified'` and
  `ocr_extraction_id` linking back to the raw response.
- The doctor on the prescription pad sees the verified labs. No surprises.
- If the extraction is ever challenged, the full pipeline output is
  reproducible from the staging row.
- When the team ports to AWS, the same service spins up in ECS/Lambda with
  S3 instead of Supabase Storage and RDS instead of Supabase Postgres —
  zero changes to verification logic, zero changes to frontend.
