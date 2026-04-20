# User Stories

Format: `[DIS-US-###]` As a <role>, I want <capability>, so that <outcome>.
Acceptance criteria are enumerated; each maps to one or more tickets.

---

## Reception clerk

### DIS-US-001 — Upload a document during registration

As a reception clerk,
I want to upload a scanned document during patient registration,
so that the system captures the document for clinical use.

**Acceptance criteria:**
- File picker on registration.html accepts PDF, JPEG, PNG, HEIC, WebP, TIFF, DOCX, XLSX.
- Files over 20 MB are rejected client-side with a clear message.
- Upload returns an `extraction_id` within 2 seconds of the POST.
- The status line shows `⏳ Processing…` immediately and transitions to
  `✓ Ready for review` or `⚠ Needs attention` within 90 s P95.
- Nothing blocks the rest of the registration form.

### DIS-US-002 — See extraction progress without polling in the UI

As a reception clerk,
I want the status line to update on its own,
so that I know when the document is ready without refreshing.

**Acceptance criteria:**
- The client subscribes to the extraction status via Supabase realtime
  (or equivalent on AWS) and updates the badge live.
- If the subscription drops, the client falls back to polling every 5 s.
- Terminal states (`ready_for_review`, `auto_approved`, `failed`) stop further polling.

### DIS-US-003 — Re-upload a failed document

As a reception clerk,
I want to retry a failed upload,
so that transient failures don't lose my work.

**Acceptance criteria:**
- A retry button appears only on `failed` extractions.
- Retrying creates a new extraction; the old one is kept for audit.
- A "Retry" action is logged with operator ID and timestamp.

---

## Nurse / verifier

### DIS-US-010 — See the verification queue

As a nurse,
I want to see a list of extractions awaiting my review,
so that I know what to work on and in what order.

**Acceptance criteria:**
- Queue page lists all `pending_review` extractions, oldest first.
- Each row shows: patient name + UHID, document category, uploaded time,
  confidence badge (green/yellow/red), and thumbnail.
- Queue auto-refreshes every 30 s.
- Filter by category, by uploader, by age.

### DIS-US-011 — Verify an extraction side-by-side

As a nurse,
I want to see the original document and the extracted fields side-by-side,
so that I can compare quickly.

**Acceptance criteria:**
- Left pane: source document viewer (PDF.js for PDFs, `<img>` for images).
- Right pane: editable form with all extracted fields grouped by entity
  (labs, vaccinations, diagnoses, medications, summary).
- Each field shows its confidence; low-confidence fields are highlighted.
- Bounding-box overlay on the source when a field is hovered (when
  `bbox` is present in the raw response).

### DIS-US-012 — Approve an extraction

As a nurse,
I want a single action to approve a clean extraction,
so that verification is fast when the AI is right.

**Acceptance criteria:**
- "Approve all" button disabled until all required fields pass validation.
- On approve, rows are written to `lab_results` / `vaccinations`,
  `ocr_extractions.status` flips to `verified`, `verified_by` and
  `verified_at` are set.
- Success toast shows exactly how many rows were written.
- An audit row is inserted in `ocr_audit_log`.

### DIS-US-013 — Edit a value before approving

As a nurse,
I want to correct an extracted value before approving,
so that the clinical table receives the correct data.

**Acceptance criteria:**
- Every field is editable.
- Original AI value is preserved in the extraction row (JSON column `raw_structured`).
- The verified value is stored separately (`verified_structured`).
- The audit log records the before/after per edited field.

### DIS-US-014 — Reject an extraction

As a nurse,
I want to reject an extraction that is junk,
so that no bad data leaks into clinical tables.

**Acceptance criteria:**
- Reject requires a reason code (dropdown: `illegible`, `wrong_patient`,
  `not_medical`, `duplicate`, `other`).
- If "other", a free-text note is required.
- Rejected extractions never promote. They remain in `ocr_extractions`
  with status `rejected`.

### DIS-US-015 — Handle a duplicate document

As a nurse,
I want the system to warn me if an identical document was already
verified,
so that I don't create duplicate lab rows.

**Acceptance criteria:**
- On open, the verification UI checks for extractions with the same
  `content_hash` already in `verified` state.
- If found, a banner shows the prior verified extraction ID and a
  "This looks like a duplicate" warning.
- Nurse can still approve (explicit override, logged).

---

## Doctor

### DIS-US-020 — Doctor sees only verified labs

As a doctor,
I want the prescription pad to show only verified lab values,
so that I don't make decisions on un-checked OCR output.

**Acceptance criteria:**
- `loadRecentLabs()` in prescription-pad.html filters out rows where
  `lab_results.verification_status != 'verified'` (unless a feature flag
  explicitly allows showing `ai_extracted` rows during migration).
- `get_lab_history` tool in `generate-prescription` applies the same filter.

### DIS-US-021 — Doctor can see which labs are AI-originated

As a doctor,
I want a visual indicator on labs that came from AI extraction,
so that I can apply appropriate judgment.

**Acceptance criteria:**
- A small `AI` badge renders beside any lab row where `source = 'ai_extracted'`
  and `verification_status = 'verified'`.
- Hover shows verifier name + time.

---

## System admin

### DIS-US-030 — Monitor the queue

As an admin,
I want to see queue depth and processing latency,
so that I can intervene when the system is overloaded.

**Acceptance criteria:**
- Internal `/admin/metrics` endpoint returns: pending count, oldest
  pending age, mean processing time (last 100 extractions), error count
  (last 24 h), cost counters per provider.
- Alerts fire (via configured webhook) when queue depth > 20 or oldest
  pending > 2 h during business hours.

### DIS-US-031 — Rotate provider keys

As an admin,
I want to rotate the Datalab and Anthropic keys without downtime,
so that I can respond to security events.

**Acceptance criteria:**
- Keys read from Secrets Adapter on every call (no in-memory caching
  beyond 5 min).
- Runbook in `09_runbooks/key_rotation.md` describes the steps.

### DIS-US-032 — Activate the kill switch

As an admin,
I want a single flag to route all traffic back to the legacy
`process-document`,
so that I can recover from a DIS regression instantly.

**Acceptance criteria:**
- `DIS_KILL_SWITCH=1` env var (read on every request) redirects the
  public endpoint to the legacy Edge Function behavior.
- Kill switch change is logged.
- Documented in runbook.
