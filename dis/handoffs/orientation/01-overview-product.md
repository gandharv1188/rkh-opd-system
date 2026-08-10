---
report: 01-overview-product
last_refreshed: 2026-04-22
source_commit: 69ce4bc
source_paths:
  - dis/document_ingestion_service/00_overview/
  - dis/document_ingestion_service/01_product/
covered_files:
  - path: dis/document_ingestion_service/00_overview/north_star.md
    lines: 71
  - path: dis/document_ingestion_service/00_overview/non_goals.md
    lines: 95
  - path: dis/document_ingestion_service/00_overview/glossary.md
    lines: 34
  - path: dis/document_ingestion_service/01_product/product_brief.md
    lines: 94
  - path: dis/document_ingestion_service/01_product/clinical_safety.md
    lines: 134
  - path: dis/document_ingestion_service/01_product/user_stories.md
    lines: 211
  - path: dis/document_ingestion_service/README.md
    lines: 90
report_owner: overview-reviewer
confidence:
  overview: high
  product: high
---

## What changed since last refresh

(Empty on first write. Future refreshers append delta entries here, newest on top, with date + source_commit range + bullet summary per file touched.)

## Executive summary

The Document Ingestion Service (DIS) is a standalone, verification-gated replacement for the Radhakishan Hospital POC's current `supabase/functions/process-document` Edge Function. Its job is to turn uploaded medical documents (lab reports, discharge summaries, vaccination cards, Rx photos) into structured clinical data that reaches `lab_results` and `vaccinations` only after a human (nurse/verifier) has reviewed and approved the extraction — or an explicit, opt-in auto-approval policy has cleared it.

Three non-negotiable properties anchor the project (`dis/document_ingestion_service/00_overview/north_star.md:22-35`): **Auditability** (raw model output preserved forever, every clinical row traces back to its extraction), **Safety** (no OCR-derived row in clinical tables without verification), **Portability** (Supabase today, AWS tomorrow, via a Ports & Adapters architecture with zero business-logic rewrites).

Users are reception clerks (uploaders, unchanged UX), nurses (new verifier role), doctors (consume only verified rows), and a system admin (queue + keys + kill-switch). Scope boundary: DIS handles new uploads only, for a single tenant, on browser only, and deliberately excludes the prescription-pad's "pad mode" camera-to-text flow, on-prem Chandra, ABDM/FHIR work, DICOM/HL7, mobile apps, and rewriting `generate-prescription`.

## North Star

Source: `dis/document_ingestion_service/00_overview/north_star.md`.

### One-sentence goal (north_star.md:3-8)

> Build a cloud-portable, verification-gated Document Ingestion Service that reliably converts uploaded medical documents into structured clinical data — without a single unreviewed OCR-derived row ever reaching the doctor's decision surface.

### Why it exists (north_star.md:10-20)

The current `process-document` flow writes Claude Vision output directly into `lab_results`/`vaccinations` with no staging, no verification, no audit trail, and no reproducibility. It is also hard-coupled to Claude Sonnet 4 and to Supabase — both of which the team intends to migrate away from. DIS fixes ordering (stage → verify → promote) and decoupling (adapters) simultaneously.

### The three guarantees (north_star.md:22-35)

| # | Property | What it means concretely |
|---|----------|--------------------------|
| 1 | Auditability | Every OCR-derived clinical field traces to: source file, raw model output, structured extraction, confidence score, verifier identity, verification timestamp. |
| 2 | Safety | No row lands in `lab_results` / `vaccinations` until `verification_status = 'verified'` (human) or `auto_approved` (policy gate). |
| 3 | Portability | Move from Supabase (Edge Functions + Postgres + Storage) to AWS (ECS/Lambda + RDS + S3) by changing adapters only — verification logic and frontend untouched. |

### Shape of the solution (north_star.md:36-56)

A new HTTP Ingestion Service API sits between the browser (registration page) and a new staging table `ocr_extractions`. Inside the service are four composable pieces: **File Router** (decides native-PDF vs scan vs DOCX vs XLSX path), **Preprocessor** (deskew, compress, drop blank pages), **OCR Adapter** (Datalab Chandra `/convert` today, pluggable), **Structuring Adapter** (Claude Haiku today, pluggable). A **Verification UI** lets nurse/reception approve or edit; only then does the **promotion** step copy fields into `lab_results` / `vaccinations`.

### "Done" definition (north_star.md:58-71)

The reference user journey: clerk uploads a scanned discharge summary → extraction created in `pending_review` → nurse opens UI → side-by-side original + extracted fields with confidence badges → nurse corrects one value → approves → rows land in `lab_results` with `source: 'verified'` and `ocr_extraction_id` back-reference → doctor sees verified labs on the prescription pad, no surprises → full pipeline output is reproducible from the staging row → AWS port works by swapping adapters, no verification logic changes, no frontend changes.

### Success criteria (product_brief.md:35-49)

Measured 30 days after default rollout:

| # | Criterion | Threshold |
|---|-----------|-----------|
| 1 | Zero unverified clinical rows | Every DIS-created `lab_results` row has non-null `ocr_extraction_id` or `verified_by` |
| 2 | Verification latency | >95% of extractions verified within 4 hours during business hours |
| 3 | Nurse edit rate | <30% (higher → improve prompts or preprocessing) |
| 4 | Per-document cost | ≤ current cost; target 30% cheaper via Chandra + Haiku vs. Sonnet Vision |
| 5 | P95 upload → ready-for-review latency | ≤ 60 s |
| 6 | Clinical-safety incidents from un-audited OCR rows | Zero |
| 7 | AWS redeploy-from-scratch | ≤ one working day, proven via dry-run |

## Non-goals

Source: `dis/document_ingestion_service/00_overview/non_goals.md`. These are as load-bearing as goals: any ticket drifting toward them must be split.

| # | Non-goal | Rationale (per doc) | Cite |
|---|----------|---------------------|------|
| 1 | Prescription-pad "pad mode" OCR (doctor photographs handwritten notes) | Ephemeral dictation-by-photo; no staging/verification semantics apply. Stays on Claude Vision. | non_goals.md:7-17 |
| 2 | On-prem / self-hosted Chandra (GPU provisioning, Docker, VRAM tuning) | Premature infra for POC volume. v1 uses Datalab hosted `/convert` only. | non_goals.md:19-26 |
| 3 | ABDM / FHIR integration | Separate track; `generate-fhir-bundle` unchanged; HIP/HIU untouched. | non_goals.md:28-34 |
| 4 | Mobile applications (iOS/Android) | POC is browser-only; verification UI is a web page. | non_goals.md:36-41 |
| 5 | Real-time collaboration in the verification UI (CRDTs, presence, live cursors) | Last-writer-wins with optimistic locking (`version` column) only. | non_goals.md:43-49 |
| 6 | DICOM / HL7 / EML / archive (`.zip`) support | Imaging needs its own pipeline; archives risk zip bombs. | non_goals.md:51-57 |
| 7 | Multi-tenant / multi-hospital | Single-tenant Radhakishan; no org-scoping beyond existing Supabase RLS. | non_goals.md:59-64 |
| 8 | Rewriting the frontend upload form on `registration.html` | Only the backend endpoint changes; verification UI is a new page. | non_goals.md:66-72 |
| 9 | Replacing `generate-prescription` | Unchanged; it still reads `lab_results` / `vaccinations` — only how rows arrive is new. | non_goals.md:74-78 |
| 10 | Auth / SSO rework | Same anon-key + RLS; AWS port maps to Cognito later. | non_goals.md:80-84 |
| 11 | Analytics / BI on extraction data (dashboards, Looker) | Operational logging only. | non_goals.md:86-89 |
| 12 | Automatic reprocessing of the 379 historical PDFs already in the `documents` bucket | New uploads only; backfill is a separate future ticket. | non_goals.md:91-95 |

File-router accepted types (v1, from non_goals.md:53): PDF, JPEG, PNG, HEIC, WebP, TIFF, DOCX, XLSX. Everything else rejects at upload.

## Glossary (key terms only)

Source: `dis/document_ingestion_service/00_overview/glossary.md`. Agents MUST use these exact terms — no synonyms.

| Term | Definition (abbreviated) |
|------|--------------------------|
| **DIS** | Document Ingestion Service. The project. |
| **Ingestion** | Full lifecycle: upload → parse/OCR → structure → verify → promote. |
| **Extraction** | One row in `ocr_extractions` = one document's lifecycle state. |
| **Extraction ID** | UUID PK of `ocr_extractions`. Canonical reference. |
| **Raw response** | Unmodified JSON from the OCR provider (Datalab `/convert`). |
| **Structured data** | Clinical JSON produced by the Structuring Adapter from the raw response. |
| **Block** | Typed region emitted by Chandra: `{block_type, bbox, content, confidence?}`. |
| **Staging** | Pre-verified state — in `ocr_extractions` only, not in clinical tables. |
| **Promotion** | Copying verified fields from `ocr_extractions` into `lab_results` / `vaccinations`. |
| **Verification** | Human review: approve, edit-then-approve, or reject. |
| **Auto-approval** | Machine-executed promotion when confidence gates pass (disabled by default per CS-7). |
| **Clinical tables** | `lab_results`, `vaccinations`, `visits.attached_documents` — anything a doctor consumes. |
| **File Router / Preprocessor / OCR Adapter / Structuring Adapter** | Pipeline components. |
| **Port / Adapter** | Hexagonal architecture: Port = interface, Adapter = implementation. |
| **Shadow mode** | New pipeline runs parallel to legacy; outputs compared, not shown to users. |
| **Kill switch** | Feature flag routing all traffic back to legacy `process-document`. |
| **POC stack / Prod stack** | Supabase (Edge Fn + PG + Storage) vs AWS (ECS/Lambda + RDS + S3). |
| **Native PDF / Scan PDF** | Selectable-text PDF vs. raster-image wrapper needing OCR. |
| **Confidence gate** | Policy: `(block_type, confidence_score) → auto_approve \| needs_review`. |
| **DoD** | Definition of Done per ticket. |
| **Clinical reviewer** | Human clinician in `08_team/RACI.md` who reviews safety-tagged tickets. |

Note: the markdown table in `glossary.md:6-7` has a malformed header row (three `|` columns instead of two) — see Drift section.

## Product brief

Source: `dis/document_ingestion_service/01_product/product_brief.md`.

### Problem (product_brief.md:3-13)

Reception/nurses upload documents at registration. Today Claude Sonnet 4 Vision extracts and writes directly to `lab_results`, `vaccinations`, and `visits.attached_documents`. No human verifies. No raw-output audit trail. Re-processing creates duplicates. Model and cloud provider are both baked into the Edge Function.

### Proposal (product_brief.md:15-25)

Staged, verification-gated pipeline. Raw output preserved indefinitely for audit/reproducibility. Ports & Adapters so OCR provider, structuring LLM, storage, and database are independently swappable.

### Personas (product_brief.md:27-33)

| Role | Interaction |
|------|-------------|
| Reception clerk | Uploads files during registration. UX unchanged except status label: "Processing" → "Ready for review" (not "AI extracted: …"). |
| Nurse / verifier | **New role in this flow.** Opens Verification UI, compares source vs extracted fields side-by-side, approves/edits/rejects. |
| Doctor | Reads only verified labs on the prescription pad. Never sees unverified OCR again. |
| System admin | Monitors queue, handles stuck jobs, rotates provider keys, flips kill switch. |

### Scope v1 (product_brief.md:51-66)

**In scope:** `ocr_extractions` table + FK columns on `lab_results` and `vaccinations`; new HTTP service with file router, preprocessor, OCR + structuring adapters; Datalab `/convert` + Claude Haiku integrations; confidence-gated auto-approval policy (off by default, opt-in per deployment); verification UI (new page); rollout via feature flag (shadow → opt-in → default); portability adapters (`StorageAdapter`, `DatabaseAdapter`, `SecretsAdapter`, `QueueAdapter`); comprehensive test suite incl. clinical acceptance tests; incident-response runbooks.

**Out of scope:** see `00_overview/non_goals.md` table above.

### Assumptions (product_brief.md:68-74)

- Datalab hosted API remains available at current pricing.
- Claude Haiku produces reliable JSON under strong schema prompting.
- Nurses have a ~5-minute window during/after registration for verification.
- Clinical team accepts the latency tradeoff (verification adds human time, removes clinical risk).
- Daily document volume ≤ 100/day during POC (relevant to Supabase free-tier).

### Risks + mitigations (product_brief.md:76-87)

| Risk | L | I | Mitigation |
|------|---|---|------------|
| Datalab API outage | M | H | Fallback → Claude Vision; kill switch → legacy. |
| Claude Haiku JSON drift | M | M | Schema validation every response; re-prompt `strict:true` or fall back to Sonnet. |
| Verification backlog | M | H | Alert at queue depth > 20; nurse role accountable per RACI. |
| Nurse fatigue → rubber-stamp | H | H | UI shows diff-from-Claude on edit; weekly sample clinician audit. |
| Migration collision with live data | L | H | All new columns nullable; shadow-mode deploy first. |
| Supabase free-tier storage cap | H | M | PDF compression on ingest; planned S3 migration at 70% capacity. |
| Claude / Datalab key leak | L | H | Secrets manager only; rotation runbook; CI secret-scan. |
| Hallucination slips through verification | M | H | Weekly clinician sample audit; override-rate metric. |

### Out-of-the-box wins (product_brief.md:89-95)

Raw audit trail satisfies NABH documentation expectations; adapter layer buys optionality (on-prem Chandra, GPT, Gemini) without rewrites; structuring-LLM decoupled from OCR gives a cost-tuning dial (Haiku default, Sonnet for hard cases, local model later); verification UI gives nurses ownership, reduces doctor cognitive load.

## Clinical safety requirements

Source: `dis/document_ingestion_service/01_product/clinical_safety.md`. **Hard requirements** — any violating ticket is blocked until resolved. Safety-tagged tickets require a second human review by the clinician on `08_team/RACI.md` (clinical_safety.md:1-5).

| ID | Requirement | Test | Cite |
|----|-------------|------|------|
| **CS-1** | No row inserted into `lab_results`, `vaccinations`, or `visits.attached_documents.ocr_*` from DIS without `verification_status = 'verified'` + non-null `verified_by`, OR `verification_status = 'auto_approved'` having passed every gate in active policy. | Integration test: promoting a `pending_review` extraction must return 409 and write nothing. | :7-18 |
| **CS-2** | Raw OCR response and raw structuring-LLM response stored indefinitely in `ocr_extractions.raw_ocr_response` + `raw_structured_response`. Never deleted, never updated; append-only via new extraction rows. Retrievable via audit API. | After 6 months' simulated time (fixture), all raw responses retrievable. | :20-30 |
| **CS-3** | Every DIS-created `lab_results`/`vaccinations` row has non-null `ocr_extraction_id` FK. FK is `ON DELETE RESTRICT`. Admin cannot merge/reassign FK without audit log entry. | DDL check in migration test; integration test asserts delete fails. | :32-41 |
| **CS-4** | Re-ingest of same document produces a new extraction; prior verified clinical rows remain; UI shows both, timestamped; only a human can merge/supersede — never automatic. | Ingest same content twice → two distinct extractions; no clinical-table updates. | :43-53 |
| **CS-5** | A `rejected` extraction cannot be promoted by any code path. Recovery = new upload. | Attempt to approve a rejected extraction → 409. | :55-60 |
| **CS-6** | Every nurse edit between AI output and verified value is recorded in `ocr_audit_log` with before/after + actor. | Two edits in one submission → two audit rows. | :62-67 |
| **CS-7** | Auto-approval policy stored as **configuration** in `dis_confidence_policy` table (not code). Changes require admin action and are logged. **Default at launch: auto-approval DISABLED.** Opt-in future. | (implicit — policy-change audit) | :69-76 |
| **CS-8** | Raw responses contain PII. RLS: `patient_id = auth.patient_id()` for nurse role; admin role only for cross-patient queries. | RLS policy test: non-matching patient read returns 0 rows. | :78-86 |
| **CS-9** | When the structuring LLM normalizes a test name (e.g., `"Hb" → "Hemoglobin"`), the original string is kept in `raw_structured_response`. Nurse sees both in UI. | (no automated test specified; rationale-only section) | :88-95 |
| **CS-10** | For `document_type = 'discharge_summary'`, the **server-side promotion step** keeps only the most recent value per `test_name` across the `lab_values[]` array. This is a code-enforced guard above any prompt instruction, so a model regression cannot re-introduce serial values. | Fixture with 7 TSB readings across 7 days → exactly one row promoted, latest date. | :97-105 |
| **CS-11** | Before insert into `lab_results`, promotion checks for an existing row with same `(patient_id, test_name, test_date, value_numeric)`. If present, skip + note in audit log. | Promote same extraction twice → second run inserts zero rows; audit log shows skips. | :107-114 |
| **CS-12** | No OCR data may reach `generate-prescription` unverified. Its `get_lab_history` tool filters `lab_results.verification_status = 'verified'` OR `source = 'manual'` / `source = 'upload'`. | With only `ai_extracted pending_review` row present, tool returns zero labs. | :116-123 |

### Out-of-band safeguards (clinical_safety.md:125-134)

- **Weekly clinician audit** — 10 random verified extractions reviewed against source; results logged.
- **Red-team fixtures** — adversarial documents (wrong patient name, smudged values, mixed-patient reports) must be caught by verification.
- **Metrics** — edit rate, reject rate, verified-but-wrong audit rate tracked; thresholds trigger investigation tickets.

### Ambiguities / gaps to watch

- **CS-9** has no automated test — only a rationale paragraph. A future ticket probably needs to formalize a "UI shows both raw and normalized test name" assertion.
- **CS-1** requires "every confidence gate in the active policy" — but the policy schema lives in `dis_confidence_policy` (per CS-7), a table not yet modeled here. Its shape is deferred to `03_data/`.
- **CS-12** enumerates `source = 'manual' / 'upload'` as allowed unverified-bypass sources. The exact `source` enum values for DIS vs pre-existing rows are load-bearing — the doctor-side filter depends on them matching what `loadRecentLabs()` in `prescription-pad.html` writes.

## User stories

Source: `dis/document_ingestion_service/01_product/user_stories.md`. Format: `[DIS-US-###]` As <role>, I want <capability>, so that <outcome>. Numbering reserves 001–009 for Reception, 010–019 Nurse, 020–029 Doctor, 030–039 Admin (gaps are intentional).

### Reception clerk

| ID | Story (spirit) | Key acceptance criteria |
|----|----------------|-------------------------|
| DIS-US-001 | Upload a document during registration. | Accepts PDF/JPEG/PNG/HEIC/WebP/TIFF/DOCX/XLSX; >20 MB rejected client-side; POST returns `extraction_id` within 2 s; status badge goes ⏳ Processing → ✓ Ready for review / ⚠ Needs attention within P95 90 s; upload is non-blocking for the rest of the form. (:10-23) |
| DIS-US-002 | Live status without manual polling. | Client subscribes via Supabase realtime (or equivalent on AWS); drop → fallback poll every 5 s; terminal states (`ready_for_review`, `auto_approved`, `failed`) stop polling. (:26-36) |
| DIS-US-003 | Retry a failed upload. | Retry button only on `failed`; retry creates a new extraction (old one kept); "Retry" action logged with operator ID + timestamp. (:39-48) |

### Nurse / verifier

| ID | Story (spirit) | Key acceptance criteria |
|----|----------------|-------------------------|
| DIS-US-010 | See the verification queue. | Lists all `pending_review`, oldest first; row shows patient+UHID, category, uploaded time, confidence badge (green/yellow/red), thumbnail; auto-refresh 30 s; filter by category/uploader/age. (:54-66) |
| DIS-US-011 | Side-by-side verification. | Left: source viewer (PDF.js for PDFs, `<img>` for images). Right: editable form grouped by entity (labs, vaccinations, diagnoses, medications, summary); per-field confidence; low-confidence highlighted; hover → bbox overlay when `bbox` present. (:69-81) |
| DIS-US-012 | One-click approve. | "Approve all" disabled until required fields pass validation; on approve → rows written to `lab_results`/`vaccinations`, status flips to `verified`, `verified_by`+`verified_at` set; toast shows row count; audit row in `ocr_audit_log`. (:84-96) |
| DIS-US-013 | Edit before approve. | Every field editable; original AI value preserved in `raw_structured`; verified value in `verified_structured`; audit log records before/after per edited field. (:99-109) |
| DIS-US-014 | Reject junk extractions. | Requires reason code (`illegible` / `wrong_patient` / `not_medical` / `duplicate` / `other`); "other" requires free-text note; rejected rows never promote; remain in `ocr_extractions` as `rejected`. (:112-123) |
| DIS-US-015 | Duplicate-document warning. | On open, UI checks for extractions with same `content_hash` already `verified`; if found, banner with prior extraction ID + "This looks like a duplicate"; nurse can still approve (explicit override, logged). (:126-138) |

### Doctor

| ID | Story (spirit) | Key acceptance criteria |
|----|----------------|-------------------------|
| DIS-US-020 | See only verified labs. | `loadRecentLabs()` in `prescription-pad.html` filters out `verification_status != 'verified'` (feature flag can allow `ai_extracted` during migration); `get_lab_history` tool applies same filter. (:144-155) |
| DIS-US-021 | Distinguish AI-originated verified labs visually. | Small `AI` badge next to any lab row with `source = 'ai_extracted'` AND `verification_status = 'verified'`; hover shows verifier name + time. (:158-167) |

### System admin

| ID | Story (spirit) | Key acceptance criteria |
|----|----------------|-------------------------|
| DIS-US-030 | Monitor the queue. | Internal `/admin/metrics` returns: pending count, oldest pending age, mean processing time (last 100), error count (24 h), cost counters per provider; alert webhook fires at queue depth > 20 or oldest pending > 2 h during business hours. (:173-185) |
| DIS-US-031 | Rotate keys without downtime. | Keys read from Secrets Adapter every call (no in-memory caching > 5 min); runbook at `09_runbooks/key_rotation.md`. (:188-197) |
| DIS-US-032 | Kill switch. | `DIS_KILL_SWITCH=1` env var (read every request) redirects public endpoint to legacy `process-document` behavior; switch change is logged; runbook-documented. (:199-211) |

## Cross-references observed

References out of `00_overview/` and `01_product/` into other sections of the plan. "Load-bearing" = the cited artifact is a hard dependency; "informational" = cite for context.

| From | To | Weight | Why |
|------|----|--------|-----|
| clinical_safety.md:5 | `08_team/RACI.md` | Load-bearing | Defines the clinician-reviewer list that safety-tagged tickets gate on. |
| glossary.md:33-34 | `07_tickets/` + `08_team/RACI.md` | Load-bearing | Ticket + clinical-reviewer terminology is canonical. |
| product_brief.md:66 | `00_overview/non_goals.md` | Load-bearing | Scope-negative reference. |
| user_stories.md:196 | `09_runbooks/key_rotation.md` | Load-bearing | Admin AC depends on the runbook existing at that path. |
| user_stories.md:210 | runbook for kill switch | Load-bearing | AC requires the switch be documented in a runbook. |
| user_stories.md:153, 155 | `web/prescription-pad.html` (`loadRecentLabs`) and `supabase/functions/generate-prescription` (`get_lab_history`) | Load-bearing | Doctor-side filter is a concrete code-level contract; CS-12 echoes it. |
| north_star.md (implicit) | `02_architecture/adapters.md`, `02_architecture/portability.md` | Load-bearing | North Star names adapter layers that are specified there. |
| product_brief.md:62 | `02_architecture/` (adapter names: `StorageAdapter`, `DatabaseAdapter`, `SecretsAdapter`, `QueueAdapter`) | Load-bearing | Architectural vocabulary must match. |
| README.md:68-90 | All downstream sections | Informational (links-index) | Master table of contents. |

## Drift, gaps, contradictions

Specific concerns a future executor should investigate or resolve.

1. **Malformed glossary table header.** `dis/document_ingestion_service/00_overview/glossary.md:6-7` has three `|` columns in the separator row but the body rows mostly have two columns — and the `Confidence gate` row (glossary.md:31) reintroduces a third column (`needs_review`) mid-value because the cell value itself contains a `|`. Renderers will corrupt that row. Fix: escape the `|` inside the cell or restructure to two proper columns.

2. **Confidence-policy schema undefined here.** CS-1 (`clinical_safety.md:11-14`) and CS-7 (:71-73) reference a `dis_confidence_policy` table whose shape is not specified in 00/01. Executors must look to `03_data/data_model.md` for this. Flag if that table is missing or under-specified when reviewing §03 next.

3. **CS-9 has no automated test.** Every other CS-N item specifies a concrete test. `clinical_safety.md:88-95` is rationale-only. Recommend a follow-up ticket to add a UI-level or promotion-level test that the original and normalized test names are both accessible post-verification.

4. **Source-enum ambiguity.** CS-12 (:116-123), DIS-US-020 (:144-155), and DIS-US-021 (:158-167) reference `lab_results.source` values `ai_extracted`, `manual`, `upload`, `verified`. The north-star `lab_results.source: 'verified'` (north_star.md:63-65) treats `'verified'` as a source value, whereas the user stories treat `source` and `verification_status` as independent columns (source=`ai_extracted`, verification_status=`verified`). This looks like a contradiction that `03_data/data_model.md` must pin down. **If an executor is wiring CS-12's filter without reading §03, they will get it wrong.**

5. **Auto-approval policy "active" criteria under-defined.** CS-1 requires passing "every confidence gate in the active policy," but CS-7 only says the default policy is auto-approval DISABLED. The intermediate case — some gates pass, some don't — is not addressed here. Expected resolution in `02_architecture/tdd.md` or `03_data/`.

6. **Duplicate detection uses two different signals.** DIS-US-015 (:126-138) uses `content_hash`. CS-11 (:107-114) uses `(patient_id, test_name, test_date, value_numeric)` at promotion time. These are complementary (one at upload, one at promotion) but neither doc states that explicitly — an executor could reasonably think only one is needed. Recommend a line in `product_brief.md` or `data_model.md` clarifying the two-layer dedupe.

7. **File-size limit redundancy.** DIS-US-001 says >20 MB rejected client-side; no counterpart server-side limit is stated in 00/01. Server-side enforcement is a clinical-safety-adjacent concern (denial-of-service, storage-quota blow-out). Flag to check `04_api/` and the service TDD.

8. **`visits.attached_documents.ocr_*` column semantics.** CS-1 mentions `visits.attached_documents.ocr_*` as a clinical table. The current schema (per root `CLAUDE.md`) has `visits.attached_documents` as a JSONB array, not a nested table with `ocr_*` columns. Either the JSONB shape will gain `ocr_*` keys (staging prefix), or a new column is being added. Clarify in `03_data/`.

9. **Volume assumption vs. alert threshold.** Brief assumes ≤100/day (product_brief.md:74); queue-depth alert fires at >20 pending (user_stories.md:184). At 100/day spread over an 8-hour work-day that's ~12/hour — a single nurse-out-sick event will trip the alert routinely. Either the volume assumption is conservative, or the alert threshold is aggressive, or the "business hours" qualifier in the AC carries more weight than it reads. Worth a product-level confirmation.

10. **No explicit SLA for OCR-adapter failure mode.** Risks table (product_brief.md:80) says fallback to Claude Vision on Datalab outage — but no user story describes what the clerk/nurse sees during fallback, and no success criterion constrains the degraded-mode quality. A minor gap worth tracking.

11. **"Retry" semantics in DIS-US-003 vs CS-4.** Retry creates a new extraction (user_stories.md:46). If retry happens on the *same* file after a transient failure (e.g., OCR adapter 502), CS-4's "re-ingest → new extraction, old remains" rule is consistent. But DIS-US-003 only fires on `failed` state, whereas CS-4 covers *any* re-ingest including verified ones. An executor should confirm the state-machine allows retry only from terminal `failed` and not from mid-flight states.

## Refresh instructions for next session

To update this report incrementally:

1. Re-run the first-action verify to confirm worktree + branch.
2. Identify changes since the recorded source commit:
   - Bash: `git log --name-only 69ce4bc..HEAD -- dis/document_ingestion_service/00_overview/ dis/document_ingestion_service/01_product/`
3. For each changed file:
   - Read it in full (do not glob-summarize).
   - Update the relevant section above, preserving structure (tables stay tables; cite file:line for every non-trivial claim).
   - Re-validate cross-references in the "Cross-references observed" table — if a pointed-to file moved or renamed, correct the cell.
4. Re-verify the Drift/Gaps list: items resolved by newer docs should be moved into a "Resolved" subsection under the drift heading, not deleted (so future reviewers can audit the resolution). New drift goes at the top of the list.
5. Append a bullet to "What changed since last refresh" summarizing the delta, newest entry on top, keyed by date and new source_commit.
6. Update the frontmatter: bump `last_refreshed` to today, set `source_commit` to current `HEAD`, recompute line counts for any changed `covered_files` entry.
7. Confidence levels: downgrade to `medium` if any drift item remains unresolved in the section for this report; downgrade to `low` if the owning source doc is in active flux (e.g., PR in flight touching it).
8. Commit with message: `docs(dis): orientation report 01 refresh — <yyyy-mm-dd>`.

Do **not** re-summarize unchanged sections — edit surgically. The whole point of this report is stability for future agents; large rewrites defeat that.
