# Code Review: Document Upload → OCR → Save → Display (V2)

**Date:** 2026-03-23
**Reviewer:** Claude Code
**Scope:** Complete end-to-end flow from document attachment to doctor's display

---

## Critical Bugs

### 1. Double OCR Execution — Double API Cost

**Files:** `web/registration.html` lines 3146-3231, 3295-3312
**Issue:** Every eligible document gets OCR'd twice:

- Pre-OCR on file selection (`onDocFileSelected` → base64 → Claude Vision)
- Server-side OCR on save (`uploadDocuments` → URL → process-document Edge Function)

Both call Claude Vision. The server-side call overwrites the pre-OCR summary in `attached_documents`.

**Impact:** 2x API cost per document. ~$0.02-0.10 wasted per document.

**Fix:** Skip server-side OCR if pre-OCR result exists. Use pre-OCR data and only send it to the Edge Function for DB writes (without re-running Claude Vision).

### 2. Historical Lab Values Extracted as Current

**File:** `supabase/functions/process-document/index.ts`
**Issue:** A discharge summary PDF containing serial lab values (e.g., 7 TSB readings from different days of a neonatal stay) are all extracted and saved as individual lab_results. The doctor sees 7 TSB readings in "Recent Labs" — clinically misleading.

**Impact:** Incorrect clinical data displayed to the doctor. Risk of clinical error.

**Fix Options:**

- A) Add `source_document` field to lab_results to distinguish AI-extracted from manual
- B) Show AI-extracted labs in a separate section ("From attached documents") not "Recent Labs"
- C) Only extract the latest value for each test from a discharge summary
- D) Let the doctor review extracted values before they're saved

### 3. `parseFloat("0") || null` Loses Zero Values

**File:** `supabase/functions/process-document/index.ts` line 304
**Issue:** `parseFloat("0") || null` evaluates to `null` because `0` is falsy. Legitimate zero values (e.g., zero reticulocyte count) are lost.

**Fix:** `isNaN(parseFloat(lab.value)) ? null : parseFloat(lab.value)`

### 4. `_saved_to_db: true` Even When All Saves Fail

**File:** `supabase/functions/process-document/index.ts` lines 312, 349
**Issue:** Lab INSERT errors are caught and logged, but `_saved_to_db` is always set to `true`. The client has no way to know saves failed.

**Fix:** Track actual success count and return it.

---

## Important Bugs

### 5. Dead Code: `extractDocumentData()` — 84 Lines

**File:** `web/registration.html` lines 3056-3140
**Issue:** The original monolithic OCR handler is defined but never called anywhere. It was replaced by the two-phase approach.

**Fix:** Delete lines 3056-3140.

### 6. `URL.createObjectURL` Memory Leak

**File:** `web/registration.html` line 3000
**Issue:** Object URL created for image processing is never revoked with `URL.revokeObjectURL()`. Each call leaks a blob URL.

**Fix:** Add `URL.revokeObjectURL(img.src)` in the `img.onload` handler.

### 7. Category Read at File-Selection Time, Not Save Time

**File:** `web/registration.html` line 3150
**Issue:** Pre-OCR reads the category when the file is selected. If the user changes category after, the pre-OCR used the wrong category hint.

**Fix:** Re-read category at save time, or re-trigger OCR if category changes.

### 8. Inconsistent OCR Category Lists

**File:** `web/registration.html` lines 3155 vs 3291
**Issue:** `onDocFileSelected` uses `["lab_report", "radiology", "prescription", "discharge_summary", "discharge"]`. `uploadDocuments` uses `["lab_report", "radiology", "prescription", "discharge"]`. Works by coincidence (`.includes("discharge")` matches both).

**Fix:** Centralize into a constant: `const OCR_CATEGORIES = ["lab_report", "radiology", "prescription", "discharge_summary"];`

### 9. `docUploadCount` and `_preOcrResults` Never Reset

**File:** `web/registration.html` lines 2931, 3143
**Issue:** On form clear / next patient registration, counters keep climbing and pre-OCR results accumulate. The upload loop iterates over ghost indices.

**Fix:** Reset both in `clearForm()` or `renderForm()`.

### 10. HEIC Files Mislabeled as `image/jpeg`

**File:** `web/registration.html` line 3186
**Issue:** For non-PDF files, `mediaType` is hardcoded to `"image/jpeg"`. HEIC files get wrong media type.

**Fix:** Use `file.type || "image/jpeg"` as media type.

### 11. Missing `test_category` in Lab Results INSERT

**File:** `supabase/functions/process-document/index.ts` lines 298-312
**Issue:** The `lab_results` table has a `test_category` column that is never populated for AI-extracted results. The registration page groups labs by category.

**Fix:** Add test_category to the AI prompt schema and include in INSERT.

### 12. Missing `lab_name` and `reference_range` in Lab Results INSERT

**File:** `supabase/functions/process-document/index.ts` lines 298-312
**Issue:** `lab_name` is extracted at the document level but not included in per-test INSERTs.

**Fix:** Include `lab_name: extracted.lab_name || null` in INSERT body.

### 13. Contradictory System Prompt in Pad Mode

**File:** `supabase/functions/process-document/index.ts` lines 182-183
**Issue:** In "pad" mode, the system prompt says "RETURN ONLY valid JSON" but the user message says "transcribe text verbatim". Wastes ~800 tokens and could confuse the model.

**Fix:** Use a minimal system prompt for pad mode.

### 14. No Duplicate Prevention for Lab Results

**File:** `supabase/functions/process-document/index.ts`
**Issue:** Re-processing the same document inserts duplicate lab_results rows. No UNIQUE constraint or existence check.

**Fix:** Check for existing rows with same patient_id + test_name + test_date before inserting.

---

## Minor Issues

### 15. `processImage` Called Twice Per Document

Both `onDocFileSelected` (pre-OCR) and `uploadDocuments` call `processImage()` on the same file. The second call re-reads from the file input.

### 16. `ocr_lab_count` Not Wrapped in `esc()`

**File:** `web/prescription-pad.html` line 2760
XSS risk if OCR response is tampered. Wrap in `esc(String(...))`.

### 17. Past Visits Query Includes Current Visit

**File:** `web/prescription-pad.html` line 2576
Wastes a query. Add `&id=neq.${visit.id}` filter.

### 18. `_from_date` Set But Never Displayed

**File:** `web/prescription-pad.html` line 2587
Past-visit documents have `_from_date` but the UI doesn't show which visit they came from.

### 19. `SERVICE_KEY` Fallback to `ANON_KEY` is Silent

**File:** `supabase/functions/process-document/index.ts` line 287
Should log a warning if service key is missing.

### 20. Spread Operator with 32K Args is Fragile

**File:** `supabase/functions/process-document/index.ts` line 131
`String.fromCharCode(...imageBytes.subarray(i, i + 32768))` — could fail on some runtimes.

**Fix:** Use Deno's `base64.ts` standard library.

---

## Recommended Priority Order

1. **Fix double OCR** (cost saving)
2. **Fix historical lab values display** (clinical safety)
3. **Fix parseFloat zero handling** (data correctness)
4. **Delete dead code** (maintenance)
5. **Fix memory leaks** (reliability)
6. **Centralize OCR category list** (maintainability)
7. **Reset counters on form clear** (reliability)
8. **Fix pad mode system prompt** (token saving)
9. **Add duplicate prevention for labs** (data quality)
