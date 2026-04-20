# Non-Goals

Explicitly **out of scope** for DIS v1. Anything on this list must not be
built, touched, or designed for. If a ticket drifts toward any of these,
it must be split.

## 1. Prescription-pad "pad mode" OCR

The existing `mode: "pad"` path in `process-document` (used by doctors to
photograph their handwritten notes) is intentionally ephemeral — the
image is read, the text is appended to the textarea, the image is
discarded. DIS does **not** replace or modify this flow. The pad mode
stays on Claude Vision.

Rationale: it's dictation-by-photo, not clinical document ingestion. No
staging or verification makes sense for it.

## 2. On-prem / self-hosted Chandra

DIS v1 uses **Datalab's hosted `/convert` API** only. On-prem deployment
of the Chandra model (GPU provisioning, Docker container, VRAM tuning)
is a later phase and has its own plan.

Rationale: premature infrastructure work. POC data volumes don't justify
a GPU.

## 3. ABDM / FHIR integration

DIS produces internal structured data. ABDM FHIR Bundle generation
remains in `generate-fhir-bundle` and is unchanged. DIS does not touch
the HIP/HIU flows.

Rationale: separate track, separate compliance surface, separate
stakeholders.

## 4. Mobile applications

DIS is browser-only. No iOS/Android client work is in scope. The
verification UI is a web page.

Rationale: POC is a web app; mobile is a product decision for later.

## 5. Real-time collaboration on verification UI

Two nurses cannot simultaneously edit the same extraction. Last-writer
wins with optimistic locking (version column). No presence indicators,
no CRDTs, no live cursors.

Rationale: not needed at POC volume; adds substantial complexity.

## 6. DICOM / HL7 / EML / archives

File router v1 handles: PDF, JPEG, PNG, HEIC, WebP, TIFF, DOCX, XLSX.
Everything else rejects at upload with a clear error.

Rationale: medical imaging (DICOM) is a separate pipeline with viewers
and storage patterns of its own. Archives risk zip bombs.

## 7. Multi-tenant / multi-hospital support

Single-tenant (Radhakishan). No org-scoping, no row-level tenant
isolation beyond what's already in Supabase RLS.

Rationale: the SaaS transition is not a v1 problem.

## 8. Rewriting the frontend upload form

The registration page's document-row UI stays as-is. DIS only changes
the backend endpoint it POSTs to. The verification UI is a **new**
page; it does not modify `registration.html` or `prescription-pad.html`.

Rationale: minimize blast radius during rollout.

## 9. Replacing `generate-prescription`

The Rx generation Edge Function is untouched. It continues to read from
`lab_results` and `vaccinations` the same way. DIS just changes *how*
rows arrive there.

## 10. Auth / SSO rework

DIS uses the same Supabase anon key + RLS policies as the rest of the
POC. No new auth system. On the AWS port, it becomes Cognito — but
that's a porting concern, not a DIS design decision.

## 11. Analytics / BI on extraction data

No dashboards, no metrics exports, no Looker integration. Basic
operational logging is in scope; product analytics are not.

## 12. Automatic reprocessing of historical documents

The 379 PDFs already in the `documents` bucket stay as they are. DIS
applies to **new uploads only**. A separate backfill ticket may be
scheduled later if the clinical team wants it.
