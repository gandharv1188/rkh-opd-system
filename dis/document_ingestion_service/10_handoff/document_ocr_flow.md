# Document OCR Flow — Comprehensive Reference

> A full end-to-end walkthrough of how uploaded/attached medical documents are
> read, understood, and turned into usable clinical data in the Radhakishan
> Hospital prescription system.

---

## 1. What "OCR" means in this codebase

The feature is labelled "OCR" throughout the UI and code, but it is **not**
classical OCR (Tesseract, Google Vision OCR API, etc.). It is:

> **Claude Vision (a multi-modal LLM) receiving the raw image/PDF bytes and
> returning either structured JSON or verbatim transcribed text.**

There is no intermediate text-extraction step, no bounding boxes, no OCR engine.
The model sees the document as an image (or PDF page) and emits a response
shaped by one of two system prompts.

Why this matters:

- Handwriting, multi-column layouts, mixed languages, rotated photos — all
  handled by the model directly.
- Quality is bounded by Claude Sonnet 4's vision accuracy, not by OCR tuning.
- Cost is paid in tokens (image = input tokens; JSON/text = output tokens).
- Latency is a single round-trip to the Anthropic API.

The Edge Function that wraps Claude is the single choke-point:
`supabase/functions/process-document/index.ts` (~467 lines).

---

## 2. The two call sites

OCR is invoked from exactly two places in the web app. They have **different
goals** and **different output shapes**.

| #   | Caller                                    | File                        | Goal                                                               | Mode                 | Input                          | Output                                                                                       |
| --- | ----------------------------------------- | --------------------------- | ------------------------------------------------------------------ | -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | Registration page — per uploaded document | `web/registration.html`     | Extract labs/meds/diagnoses/vaccinations into a database           | structured (default) | Image/PDF bytes or Storage URL | JSON object with `lab_values[]`, `medications[]`, `diagnoses[]`, `vaccinations[]`, `summary` |
| 2   | Prescription pad — attach-to-note         | `web/prescription-pad.html` | Dump doctor's handwritten note text into the pad textarea verbatim | `mode: "pad"`        | Image bytes                    | `{ text_for_pad: "...", summary: "..." }`                                                    |

Everything else (pad textarea dictation, voice, formulary search, etc.) does
**not** go through the OCR pipeline.

---

## 3. The Edge Function contract — `process-document`

### 3.1. Request schema

```jsonc
{
  // EITHER:
  "image_base64": "<base64 without data: prefix>",
  "media_type":   "image/jpeg" | "image/png" | "application/pdf",
  // OR:
  "image_url":    "https://…/storage/v1/object/public/documents/…",

  // Context (all optional — drive prompt framing + DB saves):
  "patient_id":   "uuid",
  "visit_id":     "uuid",
  "category":     "lab_report" | "discharge_summary" | … ,
  "doc_date":     "YYYY-MM-DD",

  // Mode switch:
  "mode":         "pad"   // omit for structured JSON mode
}
```

- **`image_base64` path** is used when the client has the file locally and
  does not yet have a Storage URL (Registration pre-OCR, Pad attach).
- **`image_url` path** is used after the file has been uploaded to the
  `documents` Storage bucket (Registration post-upload path). Claude fetches
  the URL directly — the Edge Function never downloads it.
- Media type defaults to `image/jpeg`; PDFs are detected by `.pdf` extension
  or explicit media type and sent as `type: "document"` content blocks
  (PDF support is GA — no beta header).

### 3.2. Two system prompts, one function

| Mode       | `system` prompt variable       | User text                                                           | Output                       |
| ---------- | ------------------------------ | ------------------------------------------------------------------- | ---------------------------- |
| structured | `SYSTEM_PROMPT` (~95 lines)    | `"Extract all medical data from this document."` + optional context | **JSON object** (must parse) |
| pad        | `PAD_SYSTEM_PROMPT` (one line) | `padPrompt` (~15 lines of transcription rules)                      | **Raw text** (verbatim)      |

The prompts are **mutually exclusive** — `isPadMode = mode === "pad"` picks
which system + user prompt pair to send. (Earlier versions used the same
system prompt in both modes, which wasted ~800 tokens per pad-mode call and
risked contradictory instructions — see `code_review_document_flow_v2.md` §13.)

### 3.3. The structured prompt — what Claude is told to produce

The prompt in `SYSTEM_PROMPT` (lines 22–118) enforces:

1. **Output shape** — a fixed JSON schema with these top-level fields:
   - `document_type` — one of `lab_report | prescription | discharge_summary | radiology | other`.
   - `summary` — a 3-6 sentence clinical note-style summary. This is the field
     the doctor sees in the prescription pad's "Attached Documents" panel.
   - `lab_values[]` — each with `test_name`, `value`, `unit`, `flag`,
     `test_category`, `reference_range`, `report_date`.
   - `diagnoses[]`
   - `medications[]` — drug/dose/frequency/duration
   - `vaccinations[]` — vaccine_name/dose_number/date_given/site/batch_no
   - `clinical_notes`, `lab_name`, `report_date`
2. **Document-type-specific rules** — the most important being:
   - Discharge summaries: only the **latest** value per test (avoids 7 TSB
     readings being inserted as separate rows — a real clinical-safety bug
     documented in `code_review_document_flow_v2.md` §2).
   - Discharge summaries: only discharge-time medications, not in-hospital.
   - Vaccination cards: each dose as a separate entry with correct
     `dose_number`.
3. **Test-name normalization table** — ~25 aliases (e.g. `Hb → Hemoglobin`,
   `TLC → TLC (WBC)`, `SGPT → SGPT/ALT`) so the same test from different labs
   lands as a single row in `lab_results`.
4. **Four test categories** — `Hematology`, `Biochemistry`, `Microbiology`,
   `Imaging`. Directly maps to the category grouping on the registration page
   and the `test_category` column.
5. **Four flag values** — `normal | low | high | critical`.
6. **Fail-soft rule** — if the document is unclear, return the JSON skeleton
   with empty arrays and "partially legible" in the summary. No throws, no
   half-JSON.

### 3.4. The pad prompt — verbatim transcription

`padPrompt` tells Claude:

- Output only the transcription — no labels, no flags, no reformatting.
- Preserve abbreviations (`c/o`, `o/e`, `Dx`, `Rx`, `BD`, `TDS`).
- Guess unclear words instead of skipping.
- Handle both handwritten pads and printed lab reports uniformly ("just
  transcribe verbatim").

This is what makes the "attach to pad" flow feel like dictation on paper —
the doctor snaps a photo of their scribble, Claude returns the words, the pad
textarea gets the words appended.

### 3.5. Anthropic API call

```ts
POST https://api.anthropic.com/v1/messages
{
  model: "claude-sonnet-4-20250514",
  max_tokens: 2048,
  system: <SYSTEM_PROMPT or PAD_SYSTEM_PROMPT>,
  messages: [{
    role: "user",
    content: [
      <contentSource: image|document block with base64 or URL source>,
      { type: "text", text: <userText> }
    ]
  }]
}
```

Headers: `x-api-key` from `Deno.env.get("ANTHROPIC_API_KEY")`,
`anthropic-version: 2023-06-01`.

The function logs `input_tokens / output_tokens` from `data.usage` — useful
for cost attribution per document.

### 3.6. Parsing the response

For structured mode:

1. Concatenate all `content[].type === "text"` blocks into `rawText`.
2. `JSON.parse(rawText)`.
3. If that fails, try to pull JSON out of a `\`\`\`json … \`\`\`` fence.
4. If _that_ fails, fall back to `{ summary: rawText, lab_values: [], medications: [], diagnoses: [] }` so the client at least gets the summary.

For pad mode: return `{ text_for_pad: rawText, summary: rawText.substring(0, 200) }`.

---

## 4. Server-side database writes (structured mode only)

When `patient_id`, `visit_id`, and `image_url` are all present (the
post-upload Registration path), the Edge Function writes directly to the
database using the service-role key. This is the only call site that touches
three tables:

### 4.1. `lab_results` inserts

For each entry in `extracted.lab_values`:

- **Quality guard** — skip if `test_name`, `value`, or a usable date
  (`report_date || doc_date`) is missing. Counts skipped vs saved.
- **Numeric conversion** — `isNaN(parseFloat(lab.value)) ? null : parseFloat(lab.value)`
  is used deliberately instead of `parseFloat(v) || null`, because the latter
  would turn a legitimate zero (e.g. reticulocyte 0) into `null`
  (see `code_review_document_flow_v2.md` §3).
- **Fields written**: `patient_id`, `visit_id`, `test_name`, `value`,
  `value_numeric`, `unit`, `flag`, `test_category`, `reference_range`,
  `lab_name`, `test_date`, `source: "ai_extracted"`.
- **Duplicate prevention**: **none currently implemented** — re-processing
  the same document inserts duplicate rows. This is a known open issue
  (`code_review_document_flow_v2.md` §14).

### 4.2. `vaccinations` inserts

For each entry in `extracted.vaccinations`:

- **Quality guard** — skip if `vaccine_name` or `date_given` missing.
- **Fields written**: `patient_id`, `vaccine_name`, `dose_number`,
  `date_given`, `site`, `batch_number`, `given_by: "extracted_from_document"`,
  `free_or_paid: "unknown"`.

### 4.3. `visits.attached_documents` patch

The `attached_documents` JSONB column on the `visits` row is fetched, the
entry matching `doc_url` is located by URL, and four OCR fields are merged
in-place:

- `ocr_summary` — the clinical summary (displayed to the doctor in the
  prescription pad under each document card).
- `ocr_lab_count`
- `ocr_vax_count`
- `ocr_diagnoses[]`
- `ocr_medications[]`

Then the row is PATCHed with the updated array + `updated_at`.

### 4.4. Response to the client

The structured JSON is returned with two additional fields when DB writes
happen:

- `_saved_to_db: boolean`
- `_lab_count_saved: number`

(Note: the flag currently reflects whether any write succeeded, not whether
all writes did — `_saved_to_db` can be `true` even when some inserts fail.
See `code_review_document_flow_v2.md` §4.)

---

## 5. Client-side flows

### 5.1. Registration — per-document dual-trigger OCR

This is the complex path. Every uploaded document can potentially trigger
Claude Vision **twice**: once on file select (pre-OCR) and once after upload
(server-side OCR). A guard prevents both from running.

#### 5.1.1. `OCR_CATEGORIES` gate

Only these categories trigger OCR at all (registration.html:2516):

```
lab_report, radiology, prescription, discharge_summary, referral_letter,
vaccination_card, growth_chart, insurance, consent_form, birth_certificate
```

Files with other categories are uploaded to Storage but skipped by OCR.

#### 5.1.2. Pre-OCR on file select — `onDocFileSelected(idx)`

(registration.html:3225)

1. User picks a file in the doc row.
2. Category-gate: if not in `OCR_CATEGORIES`, just show "File selected" and stop.
3. Size cap: 10 MB.
4. `processImage(file)` — resize to max 1920 px, canvas-redraw, light
   contrast enhancement, JPEG re-encode (skipped for PDFs).
5. Convert processed blob → base64.
6. POST to `/functions/v1/process-document` with `{ image_base64, media_type, category }`
   — **no patient_id/visit_id yet, because the visit hasn't been saved**.
7. Store the returned JSON in `_preOcrResults[idx]` keyed by row index.
8. Update the row's status line with a snippet of the summary and the lab count.

Result: by the time the reception clerk clicks **Register**, OCR has already
finished (latency-hidden behind form-filling).

#### 5.1.3. Post-upload OCR — `uploadDocuments(patientId, visitId)`

(registration.html:3304)

After the patient + visit rows are created:

1. For each populated doc row:
   1. `processImage(file)` again (pipeline re-runs; not shared with the pre-OCR
      path — the compressed blob is re-computed).
   2. Upload the processed bytes to `documents/{patientId}/{visitId}/{cat}_{ts}.{ext}`
      via Storage REST (`x-upsert: true`, public bucket).
   3. Build `docEntry = { category, date, description, filename, url, size_bytes }`.
   4. **If** `_preOcrResults[i]` exists (pre-OCR succeeded), copy the fields
      `ocr_summary`, `ocr_lab_count`, `ocr_diagnoses`, `ocr_medications` into
      `docEntry` — **and skip the server-side OCR call**.
   5. **Else** push a background fetch to `/functions/v1/process-document`
      with `{ image_url, patient_id, visit_id, category, doc_date }` into
      `_ocrPromises[]`. These run fire-and-forget — the UI does not await them.
   6. Append `docEntry` to the `uploaded[]` array.
2. Return `uploaded[]` to be stored on the visit row's `attached_documents`.

Why both paths exist:

- Pre-OCR gives the reception clerk real-time feedback ("✓ AI extracted:
  Hemoglobin low, WBC high…") and pre-populates the summary before the visit
  is saved.
- Post-upload OCR is needed when pre-OCR fails or was skipped, because **only
  the post-upload path writes to `lab_results` and `vaccinations` tables**
  (the pre-OCR call has no `patient_id` / `visit_id` context). The post-upload
  call is also what patches `visits.attached_documents` with the OCR summary.

Consequence: if pre-OCR succeeds, the `ocr_summary` ends up in
`attached_documents` via the client-side write (`docEntry.ocr_summary`)
during visit creation — no second Claude Vision call happens. If pre-OCR
fails or was skipped (e.g. non-OCR category), the server-side call takes
over on the post-upload path.

### 5.2. Prescription pad — `handleAttachment(input)` (pad mode)

(prescription-pad.html:4681)

1. Doctor clicks the attach button during a consultation.
2. File read as base64.
3. Images compressed through `compressForVision(file)` — canvas resize to
   1200 px wide + sigmoid contrast push (lines 4758+). PDFs sent as-is.
4. POST to `/functions/v1/process-document` with
   `{ image_base64, media_type, patient_id, category: "attached", mode: "pad" }`.
5. The Edge Function skips all DB writes (pad mode never writes).
6. Client takes `data.text_for_pad`, collapses multi-line whitespace into a
   single space-separated string (`cleanText`), and **appends** it to the
   pad's `<textarea>` — not replacing, always appending, always with a
   leading space separator.
7. Status line animates: "Processing attachment…" → "Optimizing image…" →
   "AI reading document…" → "Notes added ✓" → fades back after 5 s.

This is why the feature feels like dictation-by-photo: the doctor's own
scribbled words end up as a string in `raw_dictation` alongside voice
dictation text, all flowing into the eventual `generate-prescription` call.

---

## 6. Downstream use of OCR data

Once OCR results are in the database, they are read back in three places:

1. **Registration page — previous labs as pills.** `loadRecentLabs()` reads
   `lab_results` for the patient. AI-extracted rows (with `source: "ai_extracted"`)
   appear alongside manually-entered rows, color-coded by `flag`.
2. **Prescription pad — "Attached Documents" panel.** Iterates
   `visit.attached_documents` and renders each card with its `ocr_summary`
   under the filename. Markdown `**bold**` in the summary is rendered as
   `<strong>` (prescription-pad.html:3794-3798).
3. **Prescription pad — `get_lab_history` tool.** The `generate-prescription`
   Edge Function exposes a tool that reads recent lab values from
   `lab_results`. Claude calls this during prescription generation — meaning
   OCR-extracted labs directly influence drug choice and dosing. This is the
   strongest clinical-safety reason the "latest value only" rule for
   discharge summaries matters.
4. **Prescription pad — vaccination status.** `loadVaxStatus()` reads
   `vaccinations`, including rows inserted via OCR with
   `given_by = "extracted_from_document"`.

---

## 7. Failure modes and their handling

| Failure                                 | Where it's caught                                                           | User impact                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` missing             | Edge Function throw                                                         | 500 returned; client logs warning, registration still completes without OCR data |
| File > 10 MB                            | Client-side check                                                           | Status line: "File too large"; OCR skipped                                       |
| Claude API returns non-2xx              | Edge Function 502 with `detail`                                             | Client logs and continues; document uploaded without `ocr_summary`               |
| JSON parse fails on structured response | Fallback: return raw text as `summary`, empty arrays                        | Doctor sees text summary but no rows in `lab_results`                            |
| Lab INSERT fails                        | `try/catch` inside loop, `console.warn` only                                | Lost silently; client is told `_saved_to_db: true` anyway (open issue)           |
| Pre-OCR fails on Registration           | `onDocFileSelected` catch — status line updates                             | Post-upload OCR still runs as fallback                                           |
| PDF with no extractable image content   | Claude returns summary with "partially legible"                             | Empty arrays; human review needed                                                |
| Non-image, non-PDF (e.g. `.docx`)       | Upload proceeds, OCR is sent with default `image/jpeg` — Claude will reject | `ocr_summary` unset; document present but opaque                                 |

---

## 8. Performance and cost characteristics

- **Model**: `claude-sonnet-4-20250514`, `max_tokens: 2048`.
- **Image pre-processing** (registration): resize to 1920 px max + contrast enhancement.
- **Image pre-processing** (pad): resize to 1200 px max + sigmoid-curve contrast — more aggressive, to keep token count low because pad OCR is interactive.
- **Concurrency**: the post-upload OCR fetches are pushed into `_ocrPromises[]` and run **in parallel** with the rest of registration. They are not awaited, so a slow API call does not block the clerk from finishing.
- **Typical cost**: per-document logs show `input_tokens` dominated by the image (roughly 1000–2500 tokens for a 1920 px page) and `output_tokens` 200–800 for structured JSON, ~50–500 for pad transcription.

---

## 9. File inventory

| File                                                                  | Role                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/process-document/index.ts`                        | The OCR Edge Function — both modes, both input types, all DB writes.                                                                                    |
| `web/registration.html` (2516, 3108, 3225, 3304)                      | `OCR_CATEGORIES`, `processImage`, `onDocFileSelected` (pre-OCR), `uploadDocuments` (post-upload OCR orchestration).                                     |
| `web/prescription-pad.html` (3794, 4681, 4758)                        | `handleAttachment` (pad mode), `compressForVision`, rendering `ocr_summary` on attached-document cards.                                                 |
| `radhakishan_system/schema/radhakishan_supabase_schema.sql`           | `lab_results` table (value, value_numeric, unit, flag, test_category, reference_range, lab_name, test_date, source); `visits.attached_documents` JSONB. |
| `radhakishan_system/docs/code-review/code_review_document_flow_v2.md` | 20 open/closed issues in this exact flow — read alongside this doc.                                                                                     |
| `radhakishan_system/docs/code-review/section_b2_resolution_notes.md`  | History of vaccination extraction being added and data-quality guards.                                                                                  |
| `radhakishan_system/docs/code-review/section_c_resolution_notes.md`   | Records which specific issues in `process-document/index.ts` were fixed.                                                                                |

---

## 10. Known issues worth being aware of when editing

Taken from `code_review_document_flow_v2.md`; these are currently in the code:

- **No duplicate prevention** — re-OCR of the same document creates duplicate `lab_results` rows.
- **`_saved_to_db` is misleading** — set on any success, not all-success.
- **Silent service-key fallback** — if `SUPABASE_SERVICE_ROLE_KEY` is unset, writes happen with `ANON_KEY`, which RLS may silently drop depending on policy.
- **Discharge-summary latest-only rule is prompt-enforced, not code-enforced** — a model regression could once again insert serial values.
- **Pre-OCR + post-upload OCR are not shared** — if pre-OCR succeeded, only its result is used; if it failed, post-upload is a fresh Vision call (no caching, no reuse of the compressed blob).

---

## 11. TL;DR mental model

1. **Two callers, one function, two prompts.** Structured JSON for uploads; raw text for pad attachments.
2. **Claude Vision is the OCR engine.** No Tesseract. No external OCR API.
3. **Registration OCR is dual-phase and non-blocking.** Pre-OCR hides latency; post-upload OCR handles DB writes. A `_preOcrResults` cache prevents duplicate Claude calls.
4. **The server-side path is the only path that writes to `lab_results` and `vaccinations`.** Everything else is display-only (`ocr_summary` in JSONB).
5. **Pad mode never writes to DB.** It just returns verbatim text that the client appends to the textarea.
6. **Quality guards are in two layers** — prompt-level (schema, normalization, "latest only") and code-level (skip incomplete rows, safe numeric parse).
7. **Downstream the extracted labs reach the doctor's prescription generation via the `get_lab_history` tool in `generate-prescription`** — so OCR accuracy is clinically load-bearing, not cosmetic.

---

## 12. Appendix — Chandra OCR (Datalab) vs. Claude Vision

This section compares the current implementation (Claude Vision) against
**Chandra OCR 2** from Datalab, a purpose-built document-understanding
model released in late 2025 / early 2026. The goal is to inform any future
decision about swapping, augmenting, or wrapping the current pipeline.

### 12.1. What Chandra is

Chandra is an open-weights, vision-language model specialised for document
parsing. Unlike Claude Vision — which is a general-purpose multimodal LLM
pointed at a document — Chandra is **trained end-to-end for OCR + layout
understanding + structured output**.

| Attribute  | Chandra OCR 2                                                                                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor     | Datalab (`datalab-to`)                                                                                                                                                                                                                                   |
| Released   | Chandra 1 — Oct 2025; Chandra 1.5 — 22 Jan 2026; Chandra 2 — early 2026                                                                                                                                                                                  |
| Model size | ~5B parameters (BF16) — Hugging Face model card lists 5B; some blog posts report 4B                                                                                                                                                                      |
| Base model | Qwen 3.5 (image-text-to-text)                                                                                                                                                                                                                            |
| License    | Code: Apache 2.0. Weights: **modified OpenRAIL-M** — free for research, personal use, and startups under **$2M funding/revenue**; cannot be used competitively with Datalab's own API; broader commercial use requires paid licensing.                   |
| Deployment | Local (HuggingFace Transformers, vLLM), Docker, or Datalab-hosted API.                                                                                                                                                                                   |
| Hardware   | GPU with ≥ ~10 GB VRAM for BF16 inference; H100 80 GB benchmarked at 1.44 pages/sec with 96 concurrent sequences.                                                                                                                                        |
| Output     | Markdown, HTML, and JSON with explicit layout blocks (text, section-header, caption, footnote, table, form, list-group, image, figure, diagram, equation-block, code-block, chemical-block, bibliography, TOC, page-header, page-footer, complex-block). |

### 12.2. Benchmarks (from Datalab's published numbers)

| Benchmark                                                    | Chandra 2                 | Comparison points                          |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------ |
| olmOCR overall                                               | **85.9%**                 | GPT-4o ~69.9%                              |
| olmOCR — ArXiv Math                                          | 90.2%                     | —                                          |
| olmOCR — Tables                                              | 89.9%                     | —                                          |
| olmOCR — Headers/Footers                                     | 92.5%                     | —                                          |
| olmOCR — Long tiny text                                      | 92.1%                     | —                                          |
| olmOCR — Old scans                                           | 49.8%                     | (hardest category)                         |
| 43-language internal                                         | 77.8% avg                 | +12 pts over Chandra 1                     |
| 90-language internal                                         | 72.7% avg                 | Gemini 2.5 Flash ~60.8%                    |
| South Asian scripts (Bengali/Tamil/Telugu/Kannada/Malayalam) | +27–46 pts over Chandra 1 | Directly relevant for Indian-language docs |

### 12.3. Feature-by-feature vs. Claude Vision

| Capability                                         | Claude Vision (current)                                          | Chandra OCR 2                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Core paradigm                                      | General LLM reading an image                                     | OCR-specialised VLM                                                                               |
| Output contract                                    | Whatever the prompt asks for (we enforce JSON via prompt)        | Native structured output with typed layout blocks                                                 |
| Handwriting                                        | Good; prompt-dependent                                           | Trained specifically on handwriting; typically stronger                                           |
| Complex tables                                     | Good with careful prompting; occasional hallucinations           | State-of-the-art on olmOCR tables (89.9%)                                                         |
| Math / equations                                   | Prompt-dependent; no LaTeX guarantees                            | Explicit `equation-block` output, ArXiv Math 90.2%                                                |
| Forms / checkboxes                                 | Must be coaxed via prompt                                        | First-class form + checkbox support                                                               |
| South-Asian languages (Hindi/Bengali/Tamil/Telugu) | Reasonable; inconsistent on low-resource scripts                 | Best-in-class per Datalab's multilingual benchmark                                                |
| Clinical summarisation                             | **Strong** — produces 3–6 sentence clinical-note-style summaries | **Weak / not designed for it** — Chandra outputs the raw document content, not clinical summaries |
| Medication / diagnosis extraction                  | Strong — we already get `medications[]`, `diagnoses[]` reliably  | Not a built-in capability. Would need a second LLM pass over Chandra's markdown.                  |
| Test-name normalisation (`Hb → Hemoglobin`, etc.)  | Strong — prompt-driven                                           | Not supported natively — would need a post-processor.                                             |
| "Latest value only for discharge summaries" rule   | Enforceable via prompt                                           | Not supported — Chandra would emit every reading; code would need to filter.                      |
| Hallucination risk                                 | Non-zero; generative model can fabricate                         | Lower for transcription; still possible for layout inference.                                     |
| Prompt flexibility                                 | Very high — 2 system prompts today, easy to add more             | Low — model is trained for a fixed set of prompt types (`ocr_layout`, etc.).                      |
| Latency                                            | Single HTTP call to Anthropic; P50 ~3–8 s/doc                    | ~0.5–2 s/page on H100; batch-friendly. Single-page latency on CPU/small GPU is higher.            |
| Scaling model                                      | Pay-per-token, no infra                                          | Either pay Datalab per page, or run your own GPU.                                                 |
| Data residency                                     | Data sent to Anthropic (US).                                     | Fully self-hostable — data never leaves the hospital network if run locally.                      |
| Offline capability                                 | Requires internet to Anthropic API                               | **Can run entirely air-gapped.** Relevant for Indian hospitals with intermittent connectivity.    |
| Vendor lock-in                                     | Tied to Anthropic API + pricing.                                 | Open weights — portable between clouds and on-prem.                                               |

### 12.4. Pricing comparison

Pricing below is from the official Datalab Cloud-Hosted API plan
(verified April 2026). The plan is a flat monthly subscription with
included credit; pages beyond the credit are billed pay-as-you-go at the
per-mode rates.

**Datalab Cloud-Hosted API plan:**

| Component                                                 | Price                   | Notes                                              |
| --------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| Plan fee                                                  | **$25 / month**         | Flat; includes **$25** in usage credit             |
| Markdown, layout, table recognition (with model training) | **$3.00 / 1 000 pages** | = $0.003/page                                      |
| Extraction, Marker accurate mode (with model training)    | **$4.50 / 1 000 pages** | = $0.0045/page; this is the mode that runs Chandra |
| Minimum charge                                            | **$0.01 / request**     | Applies to every API call regardless of page count |

The $25 credit is consumed first; overage is billed at the per-mode rates
above. For Radhakishan's extraction use-case (clinical documents via
Chandra / Marker accurate), the effective rate is **$4.50 / 1 000 pages**
once the monthly credit is exhausted.

**Self-hosted Chandra (our own GPU):**

| Cost component                          | Estimate                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Commercial license                      | Free if under $2M funding/revenue **and** not competing with Datalab's API. Radhakishan Hospital qualifies. |
| GPU — A10G (24 GB) on AWS (`g5.xlarge`) | ~$1.00/hour on-demand; ~$0.40/hour spot. Enough for Chandra 2 BF16.                                         |
| GPU — L4 (24 GB) on GCP                 | ~$0.70/hour                                                                                                 |
| Throughput at that tier                 | Single-page latency ~2–5 s; batched throughput 0.3–0.8 pages/sec                                            |
| Effective cost at ~500 docs/day         | ~$0.02–0.05/page amortised; drops sharply with batching                                                     |
| Datalab-managed deployment              | Contact sales — not publicly priced                                                                         |

**Claude Vision (current):**

| Cost component                             | Rate (Sonnet 4, Apr 2026)                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Input tokens                               | ~$3 / 1M tokens                                                            |
| Output tokens                              | ~$15 / 1M tokens                                                           |
| Image encoding                             | Roughly 1 000–2 500 input tokens per 1920 px page (varies by aspect ratio) |
| Output per document (structured)           | ~200–800 output tokens                                                     |
| **Effective per-document cost**            | ~$0.008–$0.020 per document (≈ **$8–$20 per 1 000 pages**)                 |
| **Effective per-document cost (pad mode)** | ~$0.004–$0.010 per document (shorter output)                               |

### 12.5. Cost summary table (per 1 000 pages, rough)

| Path                                                                      | Per-1K-pages             | Notes                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Claude Vision Sonnet 4 (current — structured JSON + clinical summary)** | **$8 – $20**             | Includes clinical summary, normalization, and drug/diagnosis extraction in a single call                   |
| **Claude Vision Sonnet 4 (pad mode, verbatim text)**                      | **$4 – $10**             | Shorter output                                                                                             |
| Datalab markdown / layout / table recognition                             | **$3**                   | Transcription + layout only; no clinical summary, no structured drug/lab schema — post-processing required |
| Datalab extraction / Marker accurate (Chandra)                            | **$4.50**                | Closest to Claude's structured JSON but still not clinical                                                 |
| **Chandra self-hosted on our own GPU**                                    | **~$1 – $5** (amortised) | Plus engineering + ops time; plus a follow-up LLM call for clinical summary/extraction                     |

Note: the Datalab Cloud-Hosted plan carries a **$25/month floor** (flat
fee with $25 included credit). Small-volume months effectively cost
$25 even if metered usage is below that; per-1K rates above apply to
overage once the credit is exhausted.

### 12.5a. Monthly cost projections (Radhakishan volume)

Assumes ~2 pages/document average, extraction mode ($4.50/1K pages) for
Datalab, plus a follow-up Haiku structuring call at ~$1/1K pages.

| Daily docs       | Pages/month (~2pp avg) | Datalab cost                    | Haiku structuring cost | **Total/month** | Notes                                   |
| ---------------- | ---------------------- | ------------------------------- | ---------------------- | --------------- | --------------------------------------- |
| 20 (current POC) | 1 200                  | $25 (flat, credit covers usage) | $1                     | **$26**         | Inside $25 credit                       |
| 50               | 3 000                  | $25                             | $3                     | **$28**         | Still inside credit                     |
| 100              | 6 000                  | $25 + (500 × $4.50/1k) = $27.25 | $6                     | **$33**         | Credit exhausted, small overage         |
| 250              | 15 000                 | $25 + $45 = $70                 | $15                    | **$85**         |                                         |
| 500              | 30 000                 | $25 + $112.50 = $137.50         | $30                    | **$168**        |                                         |
| 1 000            | 60 000                 | $25 + $247.50 = $272.50         | $60                    | **$333**        | **Inflection point for self-host eval** |
| 2 500            | 150 000                | $25 + $652.50 = $677.50         | $150                   | **$828**        | Self-hosted likely cheaper here         |

- **Inflection point:** ~1 000 docs/day sustained for 60+ days is when
  self-hosted Chandra (~$200–400/month GPU) becomes worth evaluating.
  Below that, hosted wins on both cost and operational simplicity.
- **Caveat:** these numbers assume 2 pages/doc average. Discharge
  summaries (multi-page) will push the average higher; single-page OPD
  slips pull it lower. Re-run projections against real volume data
  quarterly.

### 12.6. What Chandra would actually replace — and what it wouldn't

The current `process-document` Edge Function does **two jobs** in a single
Claude call:

1. **OCR + layout understanding** — reading the pixels.
2. **Clinical structuring** — turning "Hb 9.2 g/dL" into
   `{test_name: "Hemoglobin", value: "9.2", unit: "g/dL", flag: "low", test_category: "Hematology"}`,
   writing a 3–6 sentence doctor-facing summary, picking the latest value
   from a serial panel, and normalising test names.

Chandra only does **Job 1** (superlatively well). It does **not** do
Job 2. A realistic Chandra-based architecture would therefore be **two
stages**:

```
Document → Chandra (Markdown/JSON with layout) → Claude Haiku or Sonnet (JSON structuring + clinical summary) → DB
```

This is potentially cheaper and more accurate on the pixel-reading step,
but adds a second model hop, a second failure mode, and an integration
surface that currently doesn't exist in the codebase.

### 12.7. Should the project switch?

**Arguments for switching to Chandra (self-hosted) for Job 1:**

- **Indian-language handwriting and printed scripts** — Chandra's
  Bengali/Tamil/Telugu/Kannada gains are exactly what a Haryana pediatric
  OPD encounters on external records.
- **Data residency** — ABDM policy direction favours data staying in
  India. Self-hosted Chandra keeps PHI off third-party clouds.
- **Per-page cost** — at 500+ documents/day, self-hosted Chandra is
  cheaper than Claude Vision by roughly 4–10×.
- **Offline capability** — works when the hospital's uplink is flaky.
- **Open weights** — escape hatch if Anthropic pricing or policy changes.

**Arguments for staying on Claude Vision:**

- **One call, one model, one failure mode.** Chandra needs a second LLM
  pass to produce `summary`, `medications[]`, `diagnoses[]` in our schema.
- **Clinical summary quality.** Claude's 3-6 sentence clinical-note-style
  summary is the thing the doctor actually reads. Chandra does not produce
  this.
- **Operational cost.** Running a GPU 24/7 for a single hospital is
  overkill; the current per-doc cost is small in absolute terms.
- **Prompt flexibility.** We already have two prompt modes and could add
  more (vaccination-card-only, lab-only) with zero infra work.
- **License restriction.** OpenRAIL-M forbids using Chandra "competitively"
  with Datalab's API — safe for internal hospital use, but would need a
  paid licence if the product ever becomes a multi-tenant SaaS.

**Recommendation (brief):**

- **Short term** — stay on Claude Vision. It's doing two jobs well in one
  call; the swap is non-trivial.
- **If Indian-language OCR accuracy becomes a complaint**, prototype a
  Chandra-first pipeline behind a feature flag: Chandra → Markdown →
  Claude Haiku (cheap, fast) → our existing JSON schema. Haiku-based
  structuring would also bring per-document cost down even on the current
  Claude-only pipeline.
- **If/when the project moves toward on-prem deployment**, Chandra becomes
  strategically important — it's the only piece of the pipeline that can
  run fully offline.

### 12.8. Datalab hosted API — what the official docs actually say

This subsection was verified against the official Datalab documentation at
[documentation.datalab.to](https://documentation.datalab.to/) and overrides
any third-party pricing above where they disagree.

#### 12.8.1. How you actually invoke Chandra

There is **no `/chandra` endpoint** on the Datalab API. Chandra is one of
three core engines (alongside Marker and Surya) that power the unified
document-processing surface. The public-facing endpoints are:

| Product               | Endpoint                                                              | What it does                                                                                                           |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Document Conversion   | `POST /api/v1/convert` → poll `/convert-result-check`                 | PDF/image/Word → Markdown, HTML, JSON, chunks. **Chandra is the engine used for the `balanced` and `accurate` modes.** |
| Structured Extraction | `POST /api/v1/extract-structured-data` → poll `/extract-result-check` | Pull typed fields out of a document against a JSON schema (with source citations).                                     |
| Document Segmentation | `POST /api/v1/segment-document` → poll `/segment-result-check`        | Split multi-doc PDFs into component documents.                                                                         |
| Form Filling          | `POST /api/v1/form-filling` → poll `/form-filling-result-check`       | Auto-fill PDF/image forms.                                                                                             |
| Track Changes         | `POST /api/v1/track-changes` → poll `/track-changes-result-check`     | Extract Word redline edits.                                                                                            |
| Create Document       | `POST /api/v1/create-document` → poll `/create-document-result-check` | Generate DOCX from Markdown.                                                                                           |
| Health                | `GET /api/v1/health`; authenticated: `GET /api-health`                | Liveness + API-key validation.                                                                                         |

The legacy standalone `/marker`, `/ocr`, and `/table-recognition` endpoints
are **deprecated** — the current path is `/convert` + `/extract` +
`/segment` on the unified surface. Any older community posts quoting
`/ocr` rates are referring to a product that has since been folded into
`/convert`.

All long-running endpoints use the **submit-then-poll** pattern: the `POST`
returns a request ID; the client polls the matching `*-result-check`
endpoint until the job is `complete`. This is a meaningful difference from
Claude Vision's single synchronous `/messages` call, and would change the
Edge Function's control flow if we switched.

#### 12.8.2. Authoritative pricing model (from `/platform/billing`)

- **Billing unit:** per page. No per-token or per-second billing.
- **Page-counting rules (verified):**
  - PDFs and Office documents — charged per page.
  - Images (JPEG/PNG/etc.) — **1 image = 1 page**.
  - Multi-page TIFFs — charged per frame.
  - Spreadsheets — Simple mode: 2 500 cells/page, capped at 100 pages
    ($0.60) per sheet. Advanced mode: 500 cells/page, no cap.
- **New-account free credits:** **$5** after credit-card verification
  (official, replaces the "free playground" framing from third-party
  sources).
- **Subscription shape:** monthly fixed fee that functions as **prepaid
  credits**; once exhausted, pay-as-you-go with overage charges. Specific
  subscription-tier dollar amounts are _not_ published in the public docs
  — they are surfaced only on the pricing page / after sign-in. The
  third-party rates quoted in §12.4 (**$2/1k pages OCR**, **$4/1k pages
  Marker fast+balanced**, **$6/1k pages Marker accurate/schema**) remain
  the best public numbers for order-of-magnitude planning but should be
  reconfirmed against the signed-in billing page before contract.
- **Pipeline rates:** there is a dedicated endpoint,
  `/pipelines/get-pipeline-rate`, which returns the per-page rate for a
  custom pipeline — suggesting pricing can vary by the steps chained
  together.
- **Grace period:** 24-hour grace after payment failure before access is
  restricted.

#### 12.8.3. Platform constraints worth knowing before migrating

- **Supported file types:** PDF, common image formats, Office documents
  (docx/xlsx/pptx). See `/platform/supported-file-types`.
- **Async-only for real work:** every heavy endpoint is async. Claude
  Vision's "one round-trip, one answer" pattern is not replicated here —
  we would need polling + timeout logic inside `process-document`.
- **Rate limits:** a dedicated "API Limits & Rate Limiting" page exists at
  `/platform/limits` but returned 404 at fetch time; verify in-product.
- **Webhooks:** the platform exposes webhooks as an alternative to
  polling — relevant if we want push-based completion instead of
  long-poll inside the Edge Function.
- **On-prem offering:** Datalab ships an on-prem container (see the
  "On-Premises" docs section). This is the path that combines Chandra's
  quality with the data-residency posture ABDM prefers, at the cost of
  running the container ourselves.

#### 12.8.4. How this changes the §12.7 recommendation

The recommendation in §12.7 is unchanged, with two refinements:

1. **Migrating is more work than "swap the fetch call."** The async
   submit/poll contract, per-product endpoints, and the lack of a
   clinical-summary step mean a Chandra-via-Datalab-API variant of
   `process-document` is a genuine rewrite, not a drop-in. Minimum
   realistic scope: (a) submit to `/convert`, (b) poll
   `/convert-result-check` until done, (c) pass the returned Markdown
   into a second call (e.g. Claude Haiku) that produces our existing
   structured JSON + clinical summary, (d) DB writes as today.
2. **$5 free credits makes piloting trivial.** A short spike —
   30-50 real scanned prescriptions and lab reports from the hospital,
   routed through `/convert` in `accurate` mode — would settle the
   accuracy question empirically on Indian-language handwritten scripts
   before any architectural commitment.

### 12.9. Sources

- **Datalab official documentation** — [documentation.datalab.to](https://documentation.datalab.to/)
- **Datalab docs index (machine-readable)** — [documentation.datalab.to/llms.txt](https://documentation.datalab.to/llms.txt)
- **Health endpoint reference** — [documentation.datalab.to/api-reference/health](https://documentation.datalab.to/api-reference/health)
- **Billing page** — `documentation.datalab.to/platform/billing`
- **OpenAPI spec** — [datalab.to/openapi.json](https://www.datalab.to/openapi.json)
- [Datalab — Introducing Chandra (blog)](https://www.datalab.to/blog/introducing-chandra)
- [datalab-to/chandra-ocr-2 on Hugging Face (model card)](https://huggingface.co/datalab-to/chandra-ocr-2)
- [datalab-to/chandra on GitHub (README, benchmarks, license)](https://github.com/datalab-to/chandra)
- [Datalab hosted API — DeepWiki page](https://deepwiki.com/datalab-to/chandra/8.3-hosted-api)
- [Replicate blog — Datalab Marker and OCR pricing](https://replicate.com/blog/datalab-marker-and-ocr-fast-parsing)
- [Datalab pricing page](https://www.datalab.to/pricing) (verify in-product before committing)
- [Perficient — Chandra OCR open-source review](https://blogs.perficient.com/2025/11/19/chandra-ocr-open-source-document-parsing/)
- Anthropic Claude pricing — Sonnet 4 rates from Anthropic's public pricing page as of April 2026.

---

## 13. Session 2 findings — live API re-verification (2026-04-20, orientation session)

> Authored during the post-Wave-3 orientation session after re-reading
> the built `dis/` code against the current Datalab documentation.
> Purpose: capture every discrepancy between what the adapter does,
> what the plan says, and what the live API currently exposes, so the
> next wave (Epic D) does not compound drift that already snuck in
> during Wave 3.
>
> Research method: fetched the canonical pages at
> `documentation.datalab.to/api-reference/convert-document.md`,
> `documentation.datalab.to/docs/common/limits.md`, and
> `documentation.datalab.to/platform/webhooks.md`. Cross-referenced
> against `dis/src/adapters/ocr/datalab-chandra.ts` and §12 above.

### 13.1. What the live API contract looks like today (authoritative)

Verified against `POST /api/v1/convert` documentation:

**Request — multipart form-data fields (complete list):**

| Field                        | Type    | Default    | Notes                                                                                              |
| ---------------------------- | ------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `file`                       | binary  | —          | PDF / image / Word / PowerPoint                                                                    |
| `file_url`                   | string  | —          | Optional HTTP/HTTPS URL as an alternative to `file`                                                |
| `mode`                       | string  | `fast`     | **Enum: `fast` \| `balanced` \| `accurate`.** `accurate` runs **Chandra**.                         |
| `output_format`              | string  | `markdown` | **Singular field.** Accepts `json`, `html`, `markdown`, `chunks`. **Comma-separated** if multiple. |
| `max_pages`                  | integer | —          | Per-request cap                                                                                    |
| `page_range`                 | string  | —          | e.g. `"0,5-10,20"`                                                                                 |
| `paginate`                   | boolean | `false`    | —                                                                                                  |
| `add_block_ids`              | boolean | `false`    | —                                                                                                  |
| `include_markdown_in_chunks` | boolean | `false`    | —                                                                                                  |
| `disable_image_extraction`   | boolean | `false`    | —                                                                                                  |
| `disable_image_captions`     | boolean | `false`    | —                                                                                                  |
| `fence_synthetic_captions`   | boolean | `false`    | —                                                                                                  |
| `token_efficient_markdown`   | boolean | `false`    | —                                                                                                  |
| `skip_cache`                 | boolean | `false`    | Forces a fresh run — relevant to CS-2 re-ingest audit                                              |
| `save_checkpoint`            | boolean | `false`    | Saves parsed state so a later `/extract` or `/segment` can reuse it                                |
| `additional_config`          | string  | —          | JSON string for advanced tuning                                                                    |
| `extras`                     | string  | —          | Comma-separated extra features                                                                     |
| `webhook_url`                | string  | —          | **Alternative to polling** (see §13.4)                                                             |
| `force_new`                  | boolean | `false`    | —                                                                                                  |
| `model_override_settings`    | string  | —          | —                                                                                                  |
| `eval_rubric_id`             | integer | —          | —                                                                                                  |
| `workflowstepdata_id`        | integer | —          | —                                                                                                  |

**No language-hint field exists.** No `langs`, no `language_codes`, no
`language`. This is a hard disconfirmation of our adapter's behavior
(see §13.2.2).

**Authentication:** `X-API-Key` header (case-insensitive in HTTP, so
our `X-Api-Key` works; docs use uppercase).

**Initial response (from `POST /api/v1/convert`):**

```json
{
  "success": true,
  "error": null | "string",
  "request_id": "string (required)",
  "request_check_url": "string (required)",
  "versions": {...} | null
}
```

**Polling:** `GET` the `request_check_url` returned in the initial
response. The URL is server-assigned; **do not hardcode
`/convert-result-check`** (our adapter already does the right thing
here at `datalab-chandra.ts:159`).

**Final response** (polled from `request_check_url`): spec does not
fully enumerate, but response includes `status`, `markdown`,
`html`, `json`, `page_count`, `error`, `version` — matching what §3
above described.

### 13.2. Bugs found in `dis/src/adapters/ocr/datalab-chandra.ts`

Flagged for a small hotfix ticket (proposed DIS-050-followup-a).
None of these are CS-tagged surfaces, but they compound drift.

#### 13.2.1. 🔴 `output_format` sent as multiple form fields, not comma-separated

```ts
// datalab-chandra.ts:148-150 — CURRENT (wrong)
for (const fmt of input.outputFormats) {
  form.append('output_format', fmt);
}
```

`output_format` is a **singular** field. The docs state explicitly:
_"Comma separate multiple formats"_. Appending the same key N times
in `multipart/form-data` is a well-defined operation (N distinct
parts with the same name), but the Datalab server reads only one
value per key. Today this works by accident because DIS-050's only
caller passes `['markdown']` (length 1). It will silently drop
formats the moment we ask for `['markdown', 'json']` in
DIS-051/DIS-058.

**Fix:**

```ts
form.append('output_format', input.outputFormats.join(','));
```

**Urgency:** Low today (only breaks when DIS-051/DIS-058 start
requesting multiple formats). **Medium** before Wave 4 ships, because
DIS-097 (worker endpoint) will exercise the multi-format path.

#### 13.2.2. 🔴 `langs` parameter is not part of the API

```ts
// datalab-chandra.ts:152-154 — CURRENT (wrong)
if (input.hints?.languageCodes?.length) {
  form.append('langs', input.hints.languageCodes.join(','));
}
```

No `langs` (or any language-hint) field exists on `/api/v1/convert`.
The field is either silently ignored by the server (best case:
wasted bandwidth) or will be rejected in a future API version
(worst case: CS-2 audit trail breaks when a production adapter
starts returning errors on an ignored field the team forgot about).

**Fix options:**

- **A — Remove the field entirely.** Accept that Chandra auto-detects
  language (the docs don't describe a hint mechanism). Simplest.
- **B — Marshal via `additional_config`.** The `additional_config`
  field takes a JSON string for advanced tuning. If Datalab
  eventually documents a language-hint inside `additional_config`,
  this is where it would go. Today the shape is unknown.
- **C — Keep it, add a `// lint-allow:` comment citing
  `DIS-050-followup-a` (or an ADR).** Contradicts coding_standards
  §1 (`any` escape hatches need reasons); functionally equivalent
  to A.

**Recommendation:** A. Strip the `langs` send-path, preserve the
port's `hints.languageCodes` field (it costs us nothing in the
`OcrPort` contract), and add a comment in the adapter saying
Datalab's `/convert` auto-detects language as of 2026-04-20.

#### 13.2.3. 🟡 No awareness of `skip_cache` / `force_new`

For CS-2 (raw response preserved forever) and CS-4 (re-ingest
creates a new extraction, never overwrites), a re-ingest on the
same content hash should probably run with `skip_cache=true` so
the raw response is genuinely new. Today the adapter doesn't pass
it, so Datalab is free to serve a cached response — which would
be a semantically different raw_response from a fresh run.

**Fix:** Expose a `skipCache?: boolean` on the adapter options
(not the port — keep the port clean), default `false`, set `true`
on retry paths. Not a CS violation today because we preserve the
response either way; it is a CS-2 audit-clarity improvement.

**Urgency:** Low. Worth bundling into DIS-050-followup-a.

#### 13.2.4. 🟡 Polling max-wait of 120s is tight for accurate mode

```ts
// datalab-chandra.ts:29 — CURRENT
const DEFAULT_MAX_TOTAL_WAIT_MS = 120_000;
```

Accurate-mode Chandra on a multi-page discharge summary routinely
takes 30-90s. A 20-page TSB-serial discharge summary at the
adversarial end of our fixture set (fixture #6 per
`05_testing/clinical_acceptance.md`) could run past 120s. We would
surface `OcrProviderTimeoutError` on a document the provider would
have completed successfully.

**Fix:** Raise default to **300s** and make it env-configurable
(`DIS_OCR_MAX_WAIT_MS`). Aligns with TDD §18 "P95 end-to-end to
ready_for_review < 90s" (which is end-to-end, inclusive of
structuring) — the OCR slice can consume up to ~60-70s before
cutting into structuring budget.

**Urgency:** Low today, **Medium** before first real-traffic
fixture run. Adjust in the same hotfix.

#### 13.2.5. 🟡 429 handling is generic

Our adapter treats any non-2xx as `OcrProviderError`. Datalab
explicitly documents 429 for rate-limit exceeded (400 req/min
ceiling). `error_model.md` has `RATE_LIMITED` as a first-class
code; we should map Datalab's 429 to it and mark `retryable: true`
with the backoff policy `04_api/error_model.md §Retry policy`
specifies (base 1s, factor 2, cap 30s, jitter ±20%).

**Urgency:** Low at POC volumes (20 docs/day ≪ 400 rpm). Add to
DIS-050-followup-a so the contract is correct before volume grows.

### 13.3. Rate limits and platform constraints (now documented — were 404 in §12.8.3)

From `documentation.datalab.to/docs/common/limits.md`:

| Limit                                | Value                    | Notes                                                                                                                            |
| ------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Requests per minute                  | **400**                  | 429 on exceed. Retriable per §13.2.5.                                                                                            |
| Concurrent requests                  | **400**                  | Hard cap.                                                                                                                        |
| Concurrent pages in flight           | **5 000**                | Enforced **at processing time**, not submission. Fails soft.                                                                     |
| Max file size (PDF / image / Office) | **200 MB**               | Our `DIS_MAX_UPLOAD_MB=20` is well inside this.                                                                                  |
| Max pages per request                | **7 000**                | Our `DIS_MAX_PAGES=50` is well inside this.                                                                                      |
| 429 response                         | returned on RPM exceed   | SDK auto-retries; raw calls (ours) need manual retry.                                                                            |
| Soft failure on page-concurrency cap | `success: false` in body | **Not** an HTTP error. Our adapter parses the body — we'll catch this at `isComplete(body)`, but should branch on it explicitly. |
| Enterprise                           | custom limits            | Not relevant at Radhakishan volumes.                                                                                             |

**Implication for the adapter:** we need a soft-failure branch.
Today a `success: false` response with `status: "failed"` surfaces
as `OcrProviderError` (which is correct behaviour) — but we should
distinguish "hit page-concurrency cap" (retriable with delay) from
"document is genuinely unparseable" (not retriable, goes to
`failed` terminal state per TDD §4). Add a discriminator on
`body.error` if Datalab populates an error code; otherwise leave
as-is and rely on the on-call runbook (`09_runbooks/stuck_jobs.md`)
to diagnose.

### 13.4. Webhooks are supported — relevant to DIS-097

From `documentation.datalab.to/platform/webhooks.md`:

- **Parameter:** `webhook_url` on `POST /api/v1/convert` (and other
  long-running endpoints).
- **Payload** (POSTed to our URL):

  ```json
  {
    "request_id": "...",
    "request_check_url": "...",
    "webhook_secret": "..."
  }
  ```

- **Auth:** shared-secret model. The `webhook_secret` is transmitted
  **in plaintext** inside the payload; compare against our
  configured secret. **HTTPS is required.** No HMAC signature
  header.
- **Retries:** Datalab retries on 5xx and timeouts, not on 4xx.
  Timeout is 30s to our endpoint. Handlers must be **idempotent**
  (possible duplicate deliveries).

**Architectural implication:** this is ADR-004 territory.

- **Current state:** our adapter polls `request_check_url` with
  exponential backoff. Works, wastes a little bandwidth, adds up to
  120s of wall-clock even on fast jobs.
- **Alternative state:** submit with `webhook_url =
<our DIS host>/internal/datalab-webhook`. Drop the poll loop.
  DIS-097 (worker endpoint) is the natural hook-point.
- **Why not now:** adds a second failure surface (webhook delivery
  vs. provider completion), and requires our `/internal/...`
  endpoint to be publicly reachable (Fly.io / Render on POC, ALB on
  AWS). For POC volumes (20 docs/day, P95 < 90s target), polling
  is fine.
- **Recommendation (ADR-004):** **poll in v1; add webhook path as
  DIS-097.5 once the public `/internal/process-job` endpoint
  exists in Wave 4.** No code change to the adapter; wiring-only.

### 13.5. Documentation prose corrections (minor)

- **§12.8.1** of this file says the result-check pattern is
  `/convert-result-check`. The live docs show the canonical pattern
  is whatever URL the initial response returns in `request_check_url`
  — we should never hardcode the path. Our adapter is already
  correct here; only the prose is stale.
- **§12.8.3** said the limits page was 404. It is now live at
  `documentation.datalab.to/docs/common/limits.md` with the numbers
  captured in §13.3 above.
- **§12.8.2** said subscription tier dollar amounts were not
  published in public docs. Still true as of 2026-04-20; the
  $3/$4.50/$25-flat numbers remain best-effort from third-party
  sources. Flag for in-product verification before any contract
  commitment.

### 13.6. What this changes in the plan

| Document / artefact                              | Change                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `02_architecture/adrs/ADR-002-*.md` (to write)   | Incorporate §13.3 limits, §13.4 webhook option, and the `mode=accurate` → Chandra mapping. Raise polling max-wait default to 300s.                                                                                                                                                                                 |
| `02_architecture/adrs/ADR-004-*.md` (new)        | Poll-first, webhook-later. Document the DIS-097.5 hook-point.                                                                                                                                                                                                                                                      |
| `07_tickets/backlog.md` — **DIS-050-followup-a** | New adapter-hotfix ticket: fix `output_format` comma-join, remove `langs`, raise polling max-wait to 300s, add 429 handling, add `skipCache` option. Files allowed: `dis/src/adapters/ocr/datalab-chandra.ts`, `dis/tests/unit/adapters/datalab-chandra.test.ts`, `dis/handoffs/DIS-050-followup-a.md`. No CS tag. |
| `09_runbooks/provider_outage.md`                 | Add: 429 handling via base-1s exponential backoff; `success:false` soft failure on concurrent-pages cap; webhook delivery retry semantics once ADR-004 implements the webhook path.                                                                                                                                |
| `09_runbooks/stuck_jobs.md`                      | Add: distinguish "page-concurrency soft-fail" (retriable) from "genuine failed" (not retriable) via the `error` field in the final response.                                                                                                                                                                       |
| `04_api/error_model.md`                          | No change. `RATE_LIMITED` already exists as a code — the adapter just needs to emit it for Datalab 429s.                                                                                                                                                                                                           |
| `06_rollout/feature_flags.md`                    | Add `DIS_OCR_MAX_WAIT_MS` (default 300000) once the hotfix lands.                                                                                                                                                                                                                                                  |

### 13.7. What this does NOT change

- **CS-1..CS-12** — none are affected. The bugs in §13.2 are
  correctness issues on the adapter wire, not clinical-safety
  surfaces.
- **State machine (TDD §4)** — unchanged.
- **Port contracts** — `OcrPort`, `OcrInput`, `OcrResult` all stay.
  The `hints.languageCodes` field stays on the port (it is
  provider-agnostic), only the Datalab adapter stops sending it.
- **DIS-025 reconciliation scope** — unrelated. The adapter hotfix
  is a separate, parallel track.
- **Integration hold** — no Epic G ticket is affected. Safe to run
  DIS-050-followup-a without gatekeeper approval.

### 13.8. Verification commands used (reproducible)

Each finding in §13.1–§13.4 is reproducible by fetching the
documentation pages directly:

```bash
# Convert endpoint contract
curl -s https://documentation.datalab.to/api-reference/convert-document.md

# Rate limits
curl -s https://documentation.datalab.to/docs/common/limits.md

# Webhooks
curl -s https://documentation.datalab.to/platform/webhooks.md

# Machine-readable documentation index (for future re-verification)
curl -s https://documentation.datalab.to/llms.txt

# OpenAPI spec (canonical field list, but less verbose than the
# convert-document reference — use the reference as primary source)
curl -s https://www.datalab.to/openapi.json | jq '.paths."/api/v1/convert"'
```

Re-run these quarterly (or before any ADR-004 implementation PR) to
catch drift in the API contract.

### 13.9. Sources for session 2

- [Datalab — Convert endpoint reference](https://documentation.datalab.to/api-reference/convert-document.md) (primary source for §13.1, §13.2.1, §13.2.2)
- [Datalab — API limits & rate limiting](https://documentation.datalab.to/docs/common/limits.md) (primary source for §13.3)
- [Datalab — Webhooks](https://documentation.datalab.to/platform/webhooks.md) (primary source for §13.4)
- [Datalab — docs index (machine-readable)](https://documentation.datalab.to/llms.txt) (used to locate the three primary pages above)
- [Datalab — OpenAPI spec](https://www.datalab.to/openapi.json) (cross-reference; the convert-document reference is more detailed)
- `dis/src/adapters/ocr/datalab-chandra.ts` at commit `602c634` (adapter under review)

### 13.10. Sign-off (session 2)

- **Reviewer:** Claude Opus 4.7 (1M context), orientation session post-Wave-3
- **Date:** 2026-04-20
- **Method:** live docs fetch + code re-read, no code changes made
- **Next action gated on user approval:** ADR-002 + ADR-004 drafts in PR #3; DIS-050-followup-a ticket added to backlog for execution after DIS-025 lands
