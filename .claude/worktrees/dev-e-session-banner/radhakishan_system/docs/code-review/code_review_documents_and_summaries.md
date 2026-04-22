# Code Review: Document Attachment & Visit Summary Flow

**Date:** 2026-03-22
**Reviewer:** Claude Code
**Severity:** CRITICAL — Scanned documents not visible to doctors on the prescription pad

---

## Executive Summary

Documents uploaded during registration (lab reports, X-rays, discharge summaries, etc.) are being stored correctly in Supabase Storage but **never loaded or displayed** on the prescription pad. The doctor has no way to see what the receptionist uploaded. Visit summaries ARE generated and displayed, but only as plain text in the notepad — not in a dedicated UI section.

---

## Architecture Overview

```
Registration Page                    Prescription Pad
─────────────────                    ─────────────────
1. Upload documents                  1. Select patient
   ├─ processImage() → compress      2. Load vitals, labs, vax ✓
   ├─ POST → Storage/documents/      3. Load visit summary ✓ (notepad)
   └─ extractDocumentData() → OCR    4. Load documents ✗ MISSING
                                     5. Doctor sees nothing
2. Save metadata
   ├─ visits.raw_dictation = JSON[]
   ├─ visits.clinical_notes += links
   └─ lab_results ← AI-extracted

3. Generate visit summary (returning)
   ├─ Fetch last 5 prescriptions
   ├─ Claude → 200-word summary
   └─ visits.visit_summary = text
```

---

## Finding 1: CRITICAL — Documents Not Displayed on Prescription Pad

### Problem

When the doctor selects a patient on the prescription pad, the system loads:

- ✅ Vitals (weight, height, temp, BP, SpO2)
- ✅ Growth trends (`loadGrowthTrend()`)
- ✅ Recent lab results (`loadRecentLabs()`)
- ✅ Vaccination status (`loadVaxStatus()`)
- ✅ Visit summary (appended to notepad text)
- ❌ **Documents — NOT loaded at all**

### Root Cause

**No `loadDocuments()` function exists** on the prescription pad. The document metadata is stored in `visits.raw_dictation` as a JSON array, but the prescription pad treats `raw_dictation` as the doctor's saved dictation text (which it also is — the field is overloaded).

### Evidence

**registration.html** (line ~1923) stores documents:

```javascript
// After uploading documents:
await q(`visits?id=eq.${visitId}`, "", "PATCH", {
  clinical_notes: existingNotes + docSummary,
  raw_dictation: JSON.stringify(uploadedDocs), // JSON array of {category, date, description, url}
});
```

**prescription-pad.html** (line ~2594) reads it as text:

```javascript
// When loading saved patient note:
if (
  visit?.raw_dictation &&
  typeof visit.raw_dictation === "string" &&
  !visit.raw_dictation.startsWith("[")
) {
  // Treated as doctor's saved note text — NOT parsed as document JSON
  document.getElementById("pad-ta").value = savedNote;
}
```

The `raw_dictation` field is used for **two completely different purposes**:

1. Registration: stores JSON array of uploaded document metadata
2. Prescription pad: stores doctor's free-text dictation with auto-save

When registration saves documents to `raw_dictation`, the prescription pad's auto-save later **overwrites** it with the doctor's dictation text, losing the document metadata entirely.

### Impact

- Doctor cannot see lab reports, X-rays, or discharge summaries uploaded by reception
- Doctor must ask reception to show them the physical documents
- OCR-extracted lab values ARE visible (via `lab_results` table), but the source documents are invisible
- Document URLs exist in Storage but are inaccessible from the prescription pad UI

---

## Finding 2: MODERATE — Visit Summary Display is Functional but Minimal

### Current Behavior

Visit summaries are generated correctly for returning patients:

1. **registration.html** calls `buildVisitSummary(patientId)` → Edge Function `generate-visit-summary`
2. Edge Function fetches last 5 approved prescriptions, sends to Claude Sonnet
3. Returns a ~200-word clinical summary
4. Stored in `visits.visit_summary` column
5. **prescription-pad.html** appends it to the notepad textarea

### Issues

- Summary appears as **plain text mixed with other notepad content** — no visual distinction
- No dedicated "Visit Summary" section in the patient info panel
- If the doctor types over the notepad, the summary text can be accidentally modified
- Summary is only generated for **returning patients** — first-visit patients get no summary

### Evidence

**prescription-pad.html** (line ~2644):

```javascript
if (visit?.visit_summary) ctx += "\n\n" + visit.visit_summary;
// Appended to notepad text — not in a separate read-only section
```

---

## Finding 3: MODERATE — Document Metadata Field Collision

### Problem

The `visits.raw_dictation` field serves dual purpose:

- **Registration**: JSON array of uploaded document metadata
- **Prescription pad**: Doctor's auto-saved dictation text (debounced every 3 seconds)

### Flow

1. Registration saves: `raw_dictation = '[{"category":"lab_report","url":"..."}]'`
2. Doctor opens patient on prescription pad
3. Prescription pad auto-save writes: `raw_dictation = "Patient has fever since 2 days..."`
4. Document metadata is **permanently lost**

### Recommendation

Separate these into distinct fields or use a dedicated `documents` table.

---

## Finding 4: LOW — Document OCR Results Are Stored Correctly

### Current Behavior (Working)

When reception uploads a lab report:

1. `uploadDocuments()` uploads file to Storage bucket `documents/`
2. `extractDocumentData()` calls `process-document` Edge Function
3. Claude Vision extracts lab values, medications, diagnoses
4. Extracted lab values are inserted into `lab_results` table with `source: 'ai_extracted'`
5. Doctor CAN see these via `loadRecentLabs()` on the prescription pad

### Issue

- The lab values show up, but the **source document** (the actual scan/image) is not accessible
- Doctor cannot verify the AI extraction against the original document

---

## Finding 5: LOW — Document Storage Structure is Sound

### Current Implementation

- **Bucket**: `documents` (Supabase Storage)
- **Path**: `{patient_id}/{visit_id}/{category}_{timestamp}.{ext}`
- **Public URL**: `SB/storage/v1/object/public/documents/{path}`
- **Image processing**: Resize to 1920px, contrast enhancement, sharpening, JPEG 85%
- **Categories**: 15 types (lab_report, radiology, prescription, discharge_summary, etc.)
- **File types**: jpg, jpeg, png, heic, pdf (max 10MB)

The storage layer is well-implemented — the gap is only in the display layer.

---

## Finding 6: INFO — Visit Summary Edge Function is Well-Designed

### Current Implementation

- **Model**: Claude Sonnet
- **Input**: Last 5 approved prescriptions (PII-stripped)
- **Output**: Under 200 words, clinical note style
- **Prompt quality**: Good — weights recent visits, flags ongoing meds, unresolved conditions
- **Error handling**: Non-blocking — visit creation continues if summary fails

### Minor Issue

- Does NOT include uploaded document data (OCR summaries) in the summary
- Only considers past prescriptions, not lab results or document uploads

---

## Recommendations

### Priority 1: Display Documents on Prescription Pad (CRITICAL)

Create a `loadDocuments()` function that:

1. Lists files from Supabase Storage at `documents/{patient_id}/` path
2. OR reads document metadata from `visits.clinical_notes` (which has the ATTACHED DOCUMENTS section)
3. Renders clickable thumbnails/links in the patient info panel
4. Allows the doctor to view/download the original document

### Priority 2: Fix Field Collision (HIGH)

Option A: Add a `documents` JSONB column to the `visits` table — store document metadata there instead of in `raw_dictation`.

Option B: Create a dedicated `document_uploads` table:

```sql
CREATE TABLE document_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  visit_id UUID REFERENCES visits(id),
  category TEXT NOT NULL,
  description TEXT,
  filename TEXT,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_size_bytes INTEGER,
  ocr_summary TEXT,
  doc_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Priority 3: Dedicated Visit Summary Display (MEDIUM)

Show the AI visit summary in a distinct, read-only section (e.g., a collapsible panel above the notepad) rather than mixing it into the editable notepad text.

### Priority 4: Include Documents in Visit Summary (LOW)

Update `generate-visit-summary` to also consider:

- Recent lab results (from `lab_results` table)
- Document upload summaries (OCR-extracted text)
- Not just past prescriptions

---

## Files Reviewed

| File                                                        | Lines | Key Functions                                                                                         |
| ----------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `web/registration.html`                                     | ~3400 | `uploadDocuments()`, `extractDocumentData()`, `buildVisitSummary()`, `processImage()`                 |
| `web/prescription-pad.html`                                 | ~5600 | `onPatientSelect()`, `loadGrowthTrend()`, `loadRecentLabs()`, `loadVaxStatus()`, `handleAttachment()` |
| `supabase/functions/generate-visit-summary/index.ts`        | ~182  | Claude Sonnet summary from last 5 prescriptions                                                       |
| `supabase/functions/process-document/index.ts`              | ~277  | Claude Vision OCR: "pad" mode (text) and structured mode (JSON)                                       |
| `radhakishan_system/schema/radhakishan_supabase_schema.sql` | ~544  | `visits` table (visit_summary, raw_dictation, clinical_notes), `lab_results` table                    |

---

## Summary of Gaps

| #   | Issue                                                | Severity | Status              |
| --- | ---------------------------------------------------- | -------- | ------------------- |
| 1   | Documents not displayed on prescription pad          | CRITICAL | Not implemented     |
| 2   | Visit summary mixed into editable notepad            | MODERATE | Working but poor UX |
| 3   | `raw_dictation` field collision (docs vs dictation)  | MODERATE | Data loss risk      |
| 4   | OCR lab values visible but source documents not      | LOW      | Partially working   |
| 5   | Visit summary doesn't consider lab results/documents | LOW      | Enhancement         |
