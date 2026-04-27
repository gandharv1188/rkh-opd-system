# Prescription Pad — System Documentation

> Living reference. Update when behavior changes.

## 1. Purpose

The Prescription Pad (`web/prescription-pad.html`) is the primary clinical tool used by the doctor at the Radhakishan Hospital pediatric OPD. Its job is to take the doctor's free-text clinical note (typed, dictated, or extracted from an attachment), feed it together with patient context to the `generate-prescription` Supabase Edge Function (which calls Claude with a 5-tool progressive-disclosure loop), render the resulting structured prescription JSON for review and direct in-place editing, allow the doctor to adjust drug doses against a recommended dosing band slider, then sign-and-save the prescription to Supabase plus auto-open an A4 print window with bilingual (Hindi + English) instructions, dosing pictograms, and a verification QR code.

It is the third stage of the three-stage workflow (Reception → Nurse Station → Doctor OPD) and is the only page the doctor needs during a consultation. Reception/nurse data captured on `registration.html` flows in by patient selection from the today's-visits combo box; growth/lab/vaccination history is fetched server-side from Supabase and pre-loaded into the clinical context the doctor sees and that the AI receives.

## 2. Files in this slice (with line counts and one-line purpose each)

- `web/prescription-pad.html` — 7,875 lines — single-file self-contained app: inline CSS (~1,675 lines of styles, lines 1–1,674), DOM scaffolding (lines 1,676–2,141), and a ~5,700-line inline `<script>` block (lines 2,146–7,875) implementing all behavior. References `dose-engine.js` via `<script src>` for the universal dose computation library.
- `radhakishan_system/docs/specification/radhakishan_specification.md` — 1,198 lines — full system spec; sections 3.2/3.3/5.1 are the canonical description of this slice.
- `radhakishan_system/docs/code-review/section_a_resolution_notes.md` — 366 lines — log of A1–A11 user-reported issue fixes, many touching this file (BMI in vitals, draft auto-save, sequential RX-IDs, calcAge for infants, language switch, admission_recommended, doctor-override rule, vax_schedule sync).
- `radhakishan_system/docs/code-review/section_b2_resolution_notes.md` — 885 lines — log of 50 functional/integrity/code-quality fixes. Pad-relevant: B3.8 listener leak fix (`_autoSaveInputHandler`), B3.9 race-guard (`_patientLoadId`), B3.10 popup-blocker null-check, B6.5 saveNote HTTP error handling, B6.6 vaccine status filter, B7.8 object-URL revoke, B7.10 font.ready before print, B7.25 cancelUpdate cache restore.
- `radhakishan_system/docs/code-review/section_c_resolution_notes.md` — 305 lines — 14 post-deployment corrections; pad-relevant: C1 draft persistence after sign-off, C2 language dropdown move, C3 Admit chip, C4 restore-button pointer-events, C5 chip sizing, C8 search combo UX, C9 vaccination statuses, C14 growth trend.
- `radhakishan_system/docs/planning/doctor_update_notes_20260324.md` — 120 lines — doctor-facing release notes describing the same changes in plain language; useful as ground-truth for intended behavior.
- `radhakishan_system/docs/clinical/CLINICAL_RULES_SUMMARY.md` — 211 lines — clinical rulebook v2 (NABH 20-section rule, 3-row medicine format, dose rounding, growth/Z-score classification, vaccination schedule, emergency warning signs, triage scoring) — these are the rules the pad and the AI prompt must enforce.
- `radhakishan_system/docs/SETUP_GUIDE.md` — 189 lines — operational setup; mostly registration/Supabase, but daily-workflow section describes how a doctor uses the pad.

## 3. Clinical workflow context (where in Reception→Nurse→Doctor flow)

Stage 3 (Doctor OPD). When a doctor opens the pad in Chrome (the page is the live URL `rx.radhakishanhospital.com/prescription-pad.html`):

1. The page auto-connects to Supabase (`window.load` → `connectSB`, plus retry timers at 1 s and 3 s; URL and anon key hardcoded as JS constants `SB`/`KEY`).
2. On successful connect: pre-loads the entire active formulary (`formularyCache`, keyed by uppercase generic name) and all active standard prescriptions (`stdRxCache`, keyed by ICD-10 and diagnosis name) into in-memory caches; subscribes to a Supabase Realtime websocket on `public.visits` so newly-registered patients appear in the dropdown without page reload; calls `loadTodayPatients()` to populate the searchable combo box with all patients who have a visit dated today.
3. The doctor selects a patient (or auto-selection picks the first pending one). `onPatientSelect()` builds the visit info panel: allergies (red), ABHA verified status, nurse-captured vitals (Wt/Ht/HC/MUAC/Temp/HR/RR/SpO₂/BP/MAP/BMI), chief complaints, growth trend with arrows + WAZ, recent labs with flags, vaccination dose count, AI-generated visit summary panel (collapsible), attached documents tab, and up to 5 history tabs of prior approved prescriptions (read-only).
4. The clinical note textarea is either restored from `visits.raw_dictation` (if the doctor previously typed something for this visit) or pre-filled with a structured context line (name, age, weight, height, BMI, sex, guardian, allergy/NKDA, chief complaints, vitals, vaccination history). Doctor types or dictates additional findings; auto-save fires 3 s after each input and every 30 s as a safety net.
5. Doctor toggles inclusion chips (Investigations, Std Rx, NHM/IAP Vacc., Growth, Development, Diet, IV fluids, Admit, Neonatal) and chooses the language (Bilingual / Hindi / English). Std Rx, Investigations, and Growth are pre-on by default; vaccination chip auto-selects from `visits.vax_schedule`; Neonatal auto-activates if age < 28 days OR GA < 37 wk OR birth weight < 2.5 kg.
6. Doctor clicks Generate → `generatePrescription()` POSTs to the Edge Function with the note + selected sections + language + visit summary + allergies. Status messages rotate in the tab bar ("Reading clinical note…", "Fetching formulary data…", …) until the JSON returns.
7. Review screen renders. Every line is `contenteditable`. "Adjust dose" opens a smart panel with form/route/strength/unit radios, a multi-zone slider that snaps to clean dispensing units (via DoseEngine), and a frequency stepper. Vaccinations have per-row status dropdowns and date pickers. The doctor can strike-out medicines/investigations, add new ones (formulary-search popup with fuzzy match including brand names, LOINC investigation search via `loinc_investigations` RPC + offline list of 65+ tests).
8. Sign off → `signOff()` collects all DOM edits, generates a sequential `RX-YYMMDD-NNN` ID, updates or creates the visit row, inserts the prescription row (with `qr_data`), inserts a `growth_records` row if Z-scores are present, inserts `vaccinations` rows (only those marked Administered or Previously given), uploads a plain-text rendering to the `prescriptions` Storage bucket, calls `generate-fhir-bundle` for ABDM (non-blocking), creates an `abdm_care_contexts` row.
9. The signoff bar shows ✓ Saved with Print / Edit / View note / New prescription buttons; print auto-opens after ~800 ms in a new window with A4 stylesheet, waits for fonts and the QR-server image to load, then calls `window.print()`.
10. If the doctor re-selects a "done" patient, `onPatientSelect` auto-loads the saved prescription read-only with disabled controls; the Edit button (`enableUpdateMode()`) caches `_preUpdateRxData` and re-enables editing for revisions; Cancel restores from cache (no network round-trip).

## 4. Data flow (inputs, outputs, with detail)

### Inputs

- **User input via DOM**: `#pad-ta` clinical note textarea (free text, voice, or attachment-extracted); inclusion chips (`activeMods` Set: `inv`, `stdrx`, `vax-nhm`, `vax-iap`, `growth`, `dev`, `diet`, `iv`, `ref`, `admit`, `neo`); `#rx-lang` select (`bilingual` | `hindi` | `english`); `#doctor-sel` (`DR-LOKENDER` | `DR-GANDHARV`); `#pt-search` combo box; per-medicine dose-panel radios/slider/freq inputs in review view; `contenteditable` cells throughout review; vaccination status selects + date inputs; `#fu-days` follow-up days input.
- **Voice**: `MediaRecorder` → 16 kHz audio webm chunks → `transcribe-audio` Edge Function → text appended to pad. Falls back to Web Speech API (`en-IN`).
- **Attachment**: image/PDF read as base64 → image compressed via canvas to 1200 px wide JPEG with sigmoid contrast enhancement → POST to `process-document` Edge Function (mode=`pad`) → `text_for_pad` (cleaned, single-line) appended.
- **Supabase reads** on connect: `formulary` (530 rows, full monograph JSONB), `standard_prescriptions` (446 rows). On patient select: `visits` (today's), `patients` (today's), `prescriptions` (today's approved), `prescriptions` (last 5 approved per selected patient for history tabs), `growth_records` (last Z-scores), `lab_results` (last 8), `vaccinations`. On document tab: `visits.attached_documents` JSONB, plus `storage/v1/object/list/documents` with prefix `<patient_id>/`. On add-investigation popup: `loinc_investigations` table (RPC `search_investigations` + ilike fallback) or fallback offline list of 65 tests.
- **Realtime websocket**: `wss://<project>.supabase.co/realtime/v1/websocket?apikey=<KEY>&vsn=1.0.0`, subscribes to `realtime:public:visits` INSERT events, heartbeats every 30 s, auto-reconnects 5 s after close.

### Outputs

- **Edge Function call**: POST `<SB>/functions/v1/generate-prescription` with `{ clinical_note, patient_allergies, patient_id }`. Note carries appended sections instruction, language note, and AI visit summary. Returns `{ prescription: <full structured JSON> }`.
- **localStorage**: `rx-draft-<visit_id|patient_id>` ← full `rxData` JSON after generation. Persists across refresh; restored on patient re-select if patient is not "done"; survives sign-off (intentional, per A3 correction in Section C1).
- **Supabase writes** on auto-save: `PATCH visits?id=eq.<visit_id>` with `{ raw_dictation, updated_at }`. On sign-off: `PATCH visits` (existing today's visit) or `POST visits` with `{ patient_id, visit_date, doctor_id, weight_kg, height_cm, hc_cm, diagnosis_codes, clinical_notes, raw_dictation, triage_score }`; `POST prescriptions` with `{ id, visit_id, patient_id, generated_json, medicines, investigations, vaccinations, growth, is_approved=true, approved_by, approved_at, qr_data: {rx, uhid, pt, date, dx, abha} }`; conditionally `POST growth_records`, `POST vaccinations` (one per administered or previously-given dose); `PATCH prescriptions` with `pdf_url` and (after FHIR call) `fhir_bundle`; `POST abdm_care_contexts` (best-effort).
- **Storage write**: PUT/POST `storage/v1/object/prescriptions/<patient_id>/<rx_id>.txt` with plain-text prescription summary (header, patient, diagnosis, numbered medicines with all 3 rows, follow-up, signing doctor). `x-upsert: true` header; falls back from POST to PUT on HTTP 400.
- **FHIR bundle**: POST `<SB>/functions/v1/generate-fhir-bundle` with `{ type: "OPConsultation", patient_id, visit_id, prescription_id }`; bundle returned and saved to `prescriptions.fhir_bundle`.
- **Print window**: `window.open("", "_blank")` → A4-styled HTML built into the popup window (hospital letterhead, info strip Date/Rx ID/UHID, patient meta, all clinical sections, 3-row medicine cards with pictogram sidebar, emergency warning signs, follow-up or admission notice, doctor authentication block, footer with safety compliance summary + QR sourced from `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=<verify URL with rx, uhid, hash, abha>`).

## 5. State and storage (local state, DB tables/columns read+written, storage, browser storage)

### Module-level JS state (lines ~2,148–2,162 + scattered)

- `SB`, `KEY` — Supabase URL and anon key (hardcoded constants).
- `sbConnected` (bool), `sbDirty` (bool, unused after auto-connect simplification).
- `selectedPatient` (object | null) — currently loaded patient incl. `.visit`, `.done`, `.rx_diagnosis`.
- `rxData` (object | null) — active prescription JSON. Cleared on patient switch; restored from localStorage draft or DB.
- `visitId`, `rxId` (string | null) — IDs of the current visit/prescription rows.
- `activeMods` (Set<string>) — section-inclusion chips, default `{inv, stdrx, growth}`.
- `recog` (SpeechRecognition | null), `isRec` (bool), plus AI voice state (`mediaRecorder`, `audioChunks`, `chunkTimer`, `aiTranscribeFailed`, `micStream`, `audioCtx`, `vadAnalyser`, `isSpeaking`, `silenceStart`, `chunkStartTime`, `chunkHadSpeech`, `voiceEngine` "ai" | "web", `pushToTalkActive`).
- `formularyCache` (object) — `{GENERIC_NAME: <full row>}`. `stdRxCache` (object) — keyed by both ICD-10 and diagnosis_name uppercase.
- `todayPatients` (array), `historyTabs` (array of `{id, date, rxData}`).
- `realtimeWs` (WebSocket | null).
- `autoSaveTimer` (interval), `autoSaveVisitId`, `_autoSaveInputHandler`, `_patientLoadId` (race-guard counter).
- `isUpdateMode` (bool), `_preUpdateRxData` (object | null) — for cancel-edit cache restore.
- `_invDebounce` (timeout id) for investigation search.

### DB tables read

- `formulary` — `select=generic_name,dosing_bands,formulations,contraindications,interactions,black_box_warnings,notes,snomed_code,snomed_display&active=eq.true`.
- `standard_prescriptions` — `select=icd10,diagnosis_name,snomed_code,first_line_drugs,second_line_drugs,investigations,counselling,warning_signs,referral_criteria,hospitalisation_criteria,notes,duration_days_default,expected_course,key_clinical_points,severity_assessment,monitoring_parameters,guideline_changes&active=eq.true`.
- `visits` — `select=id,patient_id,weight_kg,height_cm,hc_cm,muac_cm,temp_f,hr_per_min,rr_per_min,spo2_pct,bp_systolic,bp_diastolic,map_mmhg,chief_complaints,doctor_id,visit_summary,raw_dictation,attached_documents,vax_schedule,created_at` filtered by `visit_date=eq.<today>`.
- `patients` — `id=in.(...)&is_active=eq.true` (returns demographics + ABHA fields + known_allergies).
- `prescriptions` — `is_approved=eq.true&created_at=gte.<today>` (today's done set, projects `patient_id, generated_json`); per patient `is_approved=eq.true&order=created_at.desc&limit=5&select=id,created_at,generated_json` for history tabs; per patient on re-select `select=id,generated_json`.
- `growth_records` — `order=recorded_date.desc&limit=1&select=waz,haz,classification`.
- `lab_results` — `order=test_date.desc&limit=8&select=test_name,value,unit,flag,test_date`.
- `vaccinations` — `select=vaccine_name,dose_number,date_given&order=date_given.desc.nullslast`.
- `loinc_investigations` — `?active=eq.true&common_test_rank=gt.0&order=common_test_rank.asc&limit=30` for the top-30 default; full-text RPC `search_investigations` for queries; ilike fallback on `component`, `long_name`, `related_names`.

### DB tables written

- `visits` — PATCH `{raw_dictation, updated_at}` from auto-save; PATCH/POST on signoff (`diagnosis_codes`, `clinical_notes`, `raw_dictation`, `triage_score`, vitals if newly created).
- `prescriptions` — POST `{id, visit_id, patient_id, generated_json, medicines, investigations, vaccinations, growth, is_approved, approved_by, approved_at, qr_data, created_at, updated_at}` for new; PATCH for update mode; PATCH again to attach `pdf_url` and `fhir_bundle`.
- `growth_records` — POST `{patient_id, visit_id, recorded_date, weight_kg, height_cm, hc_cm, muac_cm, waz, haz, whz, hcaz, chart_used, classification, created_at}` (skipped in update mode to avoid duplicates).
- `vaccinations` — POST per dose given today (`given_by=<doctor_sel>`, `free_or_paid`, `date_given=<today>`); plus per Previously-given dose (`given_by="reported_by_parent"`, `free_or_paid="unknown"`, `date_given=<picker value or null>`).
- `abdm_care_contexts` — POST `{patient_id, visit_id, prescription_id, care_context_ref: "RKH-CC-"+rxId, display_text, record_types, linked, linked_at}` (best-effort, RLS may reject).

### Storage

- `prescriptions` bucket — `<patient_id>/<rx_id>.txt` plain-text Rx (despite legacy variable name `pdfUrl`).
- `documents` bucket — read-only here via `storage/v1/object/list/documents` with `prefix: <patient_id>/`; categories guessed from filename in `guessCategory()`.

### Browser storage

- `localStorage["rx-draft-<visitOrPatientId>"]` — JSON of `rxData` after each generation. Restored on re-select; cleared only when the next generation overwrites it. Survives sign-off intentionally.
- Session memory only (no localStorage): `formularyCache`, `stdRxCache`, `todayPatients`, draft DOM edits before sign-off.

## 6. External dependencies (Supabase REST endpoints WITH column projections, Edge Functions, Anthropic/ABDM APIs, CDN libs)

### Supabase REST (PostgREST) — all carry `apikey: <KEY>`, `Authorization: Bearer <KEY>`

- `GET /rest/v1/formulary?select=id&limit=1` — connection probe.
- `GET /rest/v1/formulary?select=generic_name,dosing_bands,formulations,contraindications,interactions,black_box_warnings,notes,snomed_code,snomed_display&active=eq.true` — preload.
- `GET /rest/v1/standard_prescriptions?select=<wide list>&active=eq.true` — preload.
- `GET /rest/v1/patients?select=id&id=like.<RKH-YYMM>*&order=id.desc&limit=1` — UHID sequence lookup.
- `GET /rest/v1/visits?visit_date=eq.<today>&select=<...>&order=created_at.asc` — today's visits.
- `GET /rest/v1/patients?id=in.(<ids>)&is_active=eq.true` — bulk demographics.
- `GET /rest/v1/prescriptions?patient_id=in.(<ids>)&is_approved=eq.true&created_at=gte.<today>&select=patient_id,generated_json` — today's done set.
- `GET /rest/v1/prescriptions?patient_id=eq.<id>&is_approved=eq.true&order=created_at.desc&limit=5&select=id,created_at,generated_json` — history tabs.
- `GET /rest/v1/visits?patient_id=eq.<id>&attached_documents=not.is.null&select=attached_documents,visit_date&order=visit_date.desc&limit=10` — past attachments aggregation.
- `GET /rest/v1/visits?patient_id=eq.<id>&weight_kg=not.is.null&order=visit_date.desc&limit=6&select=visit_date,weight_kg,height_cm,hc_cm` — growth trend.
- `GET /rest/v1/growth_records?patient_id=eq.<id>&order=recorded_date.desc&limit=1&select=waz,haz,classification`.
- `GET /rest/v1/lab_results?patient_id=eq.<id>&order=test_date.desc&limit=8&select=test_name,value,unit,flag,test_date`.
- `GET /rest/v1/vaccinations?patient_id=eq.<id>&select=vaccine_name,dose_number,date_given&order=date_given.desc.nullslast`.
- `GET /rest/v1/visits?patient_id=eq.<id>&visit_date=eq.<today>&order=created_at.desc&limit=1&select=id` — visit existence check on signoff.
- `GET /rest/v1/loinc_investigations?active=eq.true&common_test_rank=gt.0&order=common_test_rank.asc&limit=30` — top investigations.
- `POST /rest/v1/rpc/search_investigations` body `{query, lim:30}` — full-text search.
- `GET /rest/v1/loinc_investigations?or=(component.ilike.*<q>*,long_name.ilike.*<q>*,related_names.ilike.*<q>*)&active=eq.true&order=common_test_rank.asc.nullslast&limit=30` — fallback search.
- `POST /rest/v1/visits` (new visit at signoff if registration didn't create one).
- `PATCH /rest/v1/visits?id=eq.<id>` — auto-save and signoff updates.
- `POST /rest/v1/prescriptions`, `PATCH /rest/v1/prescriptions?id=eq.<id>` — initial save + later attach pdf_url/fhir_bundle, plus update-mode patch.
- `POST /rest/v1/growth_records`.
- `POST /rest/v1/vaccinations`.
- `POST /rest/v1/abdm_care_contexts`.
- `POST /rest/v1/patients` — only if signoff lacks a `selectedPatient.id` and `rxData.patient.name` exists (on-the-fly registration).

### Supabase Storage REST

- `POST /storage/v1/object/list/documents` body `{prefix:"<patient_id>/", limit:100, offset:0}` — fallback document lister.
- `POST/PUT /storage/v1/object/prescriptions/<patient_id>/<rx_id>.txt` with `Content-Type: text/plain`, `x-upsert: true`.
- Public read URLs of form `<SB>/storage/v1/object/public/documents/...` and `.../prescriptions/...`.

### Supabase Realtime

- `wss://<project>.supabase.co/realtime/v1/websocket?apikey=<KEY>&vsn=1.0.0` — phx_join `realtime:public:visits` with `postgres_changes:[{event:"INSERT",schema:"public",table:"visits"}]`; 30 s heartbeats.

### Edge Functions (POST `<SB>/functions/v1/<name>`, `Authorization: Bearer <KEY>`)

- `generate-prescription` — body `{clinical_note, patient_allergies, patient_id}`. Returns `{prescription: <JSON>}`. Can return `{error}` or HTTP error.
- `transcribe-audio` — multipart/form-data with `audio` (webm), `patient_context`, `language="en"`. Returns `{text, engine}` or `{fallback:true}` to trigger Web Speech fallback.
- `process-document` — body `{image_base64, media_type, patient_id, category:"attached", mode:"pad"}`. Returns `{text_for_pad}` or `{summary}`.
- `generate-fhir-bundle` — body `{type:"OPConsultation", patient_id, visit_id, prescription_id}`. Returns `{bundle}`. Non-blocking if it fails.

### Other external

- `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=<verify URL>` — QR image source on the printed prescription. Third-party CDN; image load awaited with 5 s per-image timeout.
- Google Fonts CSS for `Noto Sans Devanagari` (loaded inside the print window only).

### Sibling JS

- `web/dose-engine.js` — `DoseEngine.computeDose`, `DoseEngine.snapToUnit`, `DoseEngine.computeSliderRange`, `DoseEngine.parseIngredients`, `DoseEngine.makeIngredient`, `DoseEngine.getLimiting`, `DoseEngine.getAvailableRoutes`, `DoseEngine.routeLabel`, `DoseEngine.FREQ_EN`, `DoseEngine.FREQ_HI`. Per project memory `project_dose_engine_is_source_of_truth.md`, the engine is correct; dosing errors come from the AI's mental math, not the engine.

### CDN libs not loaded by the pad itself

- The pad does not include `html5-qrcode`; QR scanning lives on `registration.html`.

## 7. Safety mechanisms (every fallback, retry, defensive check, error path — what protects the patient)

- **`esc()`** XSS guard wrapping every dynamic value before innerHTML insertion (`document.createElement("div").textContent = s`). Used hundreds of times.
- **Connection auto-retry**: `connectSB` runs on `window.load`, again at 1 s, again at 3 s. Per-request 8 s `AbortController` timeout; UI shows red dot + "Retry" label on failure.
- **Realtime auto-reconnect** 5 s after WebSocket close, but only while `sbConnected` (avoids busy-looping when offline).
- **Race guard** `_patientLoadId` (B3.9): every `onPatientSelect` increments a counter and re-checks `_patientLoadId !== myLoadId` after each `await` to discard stale async continuations when the doctor switches patients quickly.
- **Auto-save listener leak fix** (B3.8): `_autoSaveInputHandler` is removed before each new `addEventListener("input", ...)` so listeners do not accumulate across patient switches.
- **Auto-save HTTP error surfaced**: `saveNote()` checks `r.ok` and shows "Save failed" red badge; never silently claims success (B6.5).
- **Stale `rxData` cleared** at the top of `onPatientSelect` so a previous patient's prescription cannot leak into a new patient's view.
- **Draft auto-restore** from localStorage if Edge Function call succeeded but the page later refreshed before sign-off; toast "Restored unsaved prescription draft" alerts the doctor.
- **Read-only re-load** for "done" patients: contenteditable removed, dose adjust panels hidden, vax/fu inputs disabled at 0.6 opacity. Update mode requires explicit Edit button click which caches `_preUpdateRxData` for safe cancel.
- **Cancel-update restore from cache** rather than refetch (B7.25) — avoids race conditions where the network result might be stale relative to the user's local edits in flight.
- **Doctor override rule** (A9): explicitly named drugs in the clinical note are never silently dropped by the AI; instead they appear flagged with `safety.flags` entries and `overall_status: "REVIEW REQUIRED"`. Pad renders these flags at the top of the medicines section.
- **Allergy injection**: `selectedPatient.known_allergies` is sent to the Edge Function as `patient_allergies`, ensuring the AI sees them even if the doctor's free text omits them.
- **Maximum dose enforcement**: `applyDose()` reads `m.max_dose_single_mg` and passes it to `DoseEngine.computeDose` which caps and reports `r.capped` and `r.warnings`; capped result triggers visible `med-flag` "⚠ Max dose applied — Xmg".
- **Outside-range slider warning**: review panel's slider shows red value (`dp-warn`) and "⚠ Outside recommended range" if the chosen mg/kg falls outside any matched dosing band.
- **Voice safety**: VAD threshold 25, silence-send delay 1.5 s, max chunk 15 s, MIN_BLOB_BYTES 4 KB. Skips silent chunks (`chunkHadSpeech` flag), avoiding unnecessary API calls that could mis-transcribe ambient noise into the clinical note.
- **AI transcription fallback to Web Speech**: `aiTranscribeFailed` sticky flag — once the Edge Function returns `{fallback:true}` or fails, the rest of the session uses browser Web Speech without retrying AI.
- **Print popup-blocker null check** (B3.10): `window.open` result tested; user-friendly alert "Please allow pop-ups for printing" replaces the silent crash that previously occurred when accessing `w.document` on null.
- **Print font/image readiness** (B7.10): `w.document.fonts.ready` is awaited together with all `<img>` `onload`/`onerror` (5 s max per image) before `w.print()` so Hindi text never prints in fallback Latin and the QR image never prints blank. 1.5 s safety-net `setTimeout` if any promise rejects.
- **Sequential `RX-YYMMDD-NNN` IDs** (A5): looks up the largest existing prefix-match, increments, falls back to `001`. Eliminates ID collisions and yields readable receipts.
- **Sequential UHID** (B3.4): same query-then-increment; unique constraint on `patients.id` ensures concurrent collisions fail loudly rather than silently overwrite.
- **`Realtime updates preserve current selection`**: when a new visit INSERT arrives, the dropdown silently refreshes but re-selects the patient the doctor was working on (matched by `selectedPatient.id`).
- **Patient-data filename guesser** for documents fetched from Storage uses regex matching to assign categories — non-critical metadata.
- **FHIR/ABDM calls non-blocking**: prescription is already saved before `generate-fhir-bundle` is invoked; failures are logged but do not unwind the save.
- **Object URL revoke** (B7.8) in `compressForVision()` — both `onload` and `onerror` revoke `img.src` to prevent memory leaks on long sessions.
- **Storage upload POST→PUT fallback**: if POST returns 400 (file exists), retries with PUT and the same `x-upsert: true`.
- **Vaccine status filter on save** (B6.6): only doses with `status === "administered"` are saved as `given_today`; "Previously given" creates a separate `vaccinations` row with `given_by="reported_by_parent"`; "Deferred"/"Refused" generate no DB write.
- **Tool-use loop has 120 s timeout** in the Edge Function (B4.3) and detects repeated identical tool calls. Pad sees this as either a returned prescription or a thrown error caught and shown inline.
- **Single-shot fallback** in the Edge Function (B6.11) loads `core_prompt.md` from the correct Storage path if the tool loop fails.
- **Generation error inline**: `generatePrescription()` `catch` writes "Error: …" into the save indicator with red color and auto-clears after 8 s; the doctor stays on the pad and does not lose the typed note.

## 8. Configuration knobs (every tunable: debounce intervals, timeouts, retry counts, hardcoded values, env vars)

- `SB` = `https://ecywxuqhnlkjtdshpcbc.supabase.co` (line 2148).
- `KEY` = JWT anon key (line 2150). Hardcoded; no env var.
- Connect retry timers: 0 ms, 1000 ms, 3000 ms after `window.load` (lines 7869, 7872).
- Connect HTTP timeout: 8000 ms `AbortController` (line 3021).
- Auto-save debounce: 3000 ms after last input (line 3992); periodic save every 30000 ms (line 3996).
- Realtime heartbeat: 30000 ms (line 3142). Reconnect after close: 5000 ms (line 3182).
- VAD threshold: `VAD_THRESHOLD = 25` (0–255 energy scale, line 4376). `SILENCE_SEND_MS = 1500`, `MAX_CHUNK_MS = 15000`, `MIN_BLOB_BYTES = 4000` (lines 4377–4379). VAD poll interval: 150 ms (line 4457).
- Web Speech locale: `en-IN` (line 4481).
- Audio capture: 16 kHz, `echoCancellation`, `noiseSuppression`, `autoGainControl` (lines 4395–4400).
- Image compression: max width 1200 px, JPEG quality 0.85, sigmoid contrast `k=0.05` around mean luminance (lines 4763, 4783, 4801).
- Patient list fetch: today's visits, ordered ascending by created_at; up to as many patients exist for that day. History tabs: limit 5. Past document visits: limit 10. Growth trend: limit 6 visits. Recent labs: limit 8. Top investigations: limit 30. Storage list: limit 100, offset 0.
- "Done" detection window: `created_at >= <today ISO>`.
- Patient search auto-select: `inp.value && inp.select()` on focus.
- Generate progress message rotation: 1500 ms (line 4961). Six messages cycled.
- Post-success delay before view switch: 400 ms (line 5022).
- Error auto-clear: 8000 ms (line 5043).
- `_patientLoadId`: monotonic counter for race-guarding.
- Print preparation: per-image 5000 ms `setTimeout` (line 7022); fallback `setTimeout(w.print, 1500)` if any promise rejects (line 7028); success print delay 300 ms (line 7027).
- QR hash: SHA-256 of `rxId + uhid + dateISO + "rkh-salt-2026"`, sliced to 6 hex chars (line 6932).
- QR image source: `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=<encoded URL>` (line 6949).
- Doctor profiles: `DR-LOKENDER` (Dr. Lokender Goyal, MD Pediatrics, HMC HN 21452 / PMC 23168) and `DR-GANDHARV` (Dr. Gandharv Goyal, MBBS AIIMS, DMC/R/0632) (lines 2289–2304).
- Default active mods: `inv`, `stdrx`, `growth` (lines 2157, 4047–4049).
- Neonatal auto-activate thresholds: age < 28 days, GA < 37 wk, BW < 2.5 kg (lines 4319–4324; CLAUDE.md uses 90 d for the registration smart neonatal section, which is a different threshold per B3.7).
- Frequency stepper bounds: 1–6 doses/day (`Math.max(1, Math.min(6, cur+delta))`, line 2601).
- Follow-up days input range: 1–90 (line 5801).
- Receipt-style `RX-YYMMDD-NNN` zero-padded to 3 digits.
- UHID `RKH-<FYstart><FYend><MM>NNNNN` zero-padded to 5 digits, financial year April–March (lines 2974–3001).
- Localisation: dates `en-IN` (`day:2-digit, month:short, year:numeric`); times `en-IN` (`hour:2-digit, minute:2-digit`).
- A4 print: `@page size:A4; margin:12mm 10mm`; body 12 px Georgia 1.5 line-height; medicine row1 14 px / row2-row3 12 px; emergency grid 2 columns; QR 80×80 px (lines 6961–7011).
- CSS palette: blue `#1e3a6b`, blue-mid `#2d5aa0`, green `#1a5c35`, red `#8b1a1a`, amber `#7a4a00` (lines 8–17).
- Sticky header height tracked dynamically via `--hdr-h` CSS variable, computed by `updateHdrH()` from `.hdr` `offsetHeight`.
- No env vars are read; the page uses hardcoded credentials by design (POC).

## 9. Known fragility (what's risky to change, what would harm patient if it broke, what has previously broken)

- **`signOff()` dependency on DOM contenteditable order**: the code re-reads chief complaints, history, examination, diet, referral by walking `.rv-sec` and matching `.rv-hdr` text prefixes (lines 6325–6337). Renaming a section header or re-ordering DOM would silently drop the doctor's edits.
- **`applyDose()` Row 2/3 regex**: the duration phrase is parsed back from Row 2 with `/(?:for |×\s*)(\d+)\s*days?/i` (line 5962). Localized variants like "for 7d" or Hindi "7 दिन" would fail and produce a Row 2 without a duration suffix.
- **Form-name heuristics**: `simplifyForm()` and the giant uppercase regex stripping `SYRUP|TABLET|...|RESPULES|NEBULISATION|IV INFUSION|...` are repeated in 4+ places (lines 2216, 2274, 4429, 5191, 5923). Any new formulation type must be added to all of them. Already a known fragility — fragments differ slightly between sites.
- **`dose-engine.js` is canonical**: the pad re-implements form mapping (`formMap` line 5864), route map (`ROUTE_EN`/`ROUTE_HI`), and unit options (`getUnitOptions`). If these drift from `dose-engine.js`, the slider snap and the displayed mL volume may disagree.
- **Hardcoded NABH branding/letterhead** in `printRx()`: hospital name, address, NABH badge, emergency phones, doctor degrees are all string-concatenated into HTML. Changing branding requires editing inline strings in the print stylesheet plus the in-app `.hdr` HTML.
- **localStorage draft key uses visit_id when available, else patient_id** (line 5004): if a patient has multiple visits today (rare but possible with on-the-fly visit creation in signoff), the draft from one visit can be loaded into another.
- **Realtime websocket assumes Postgres CDC is enabled** on `public.visits` in Supabase project settings. If CDC is disabled, the WebSocket connects but never emits INSERT events; the dropdown only refreshes via manual reload.
- **History-tab insertion uses DOM manipulation** that finds the flex-spacer span (`tabBar.querySelector("span[style*='flex']")`, line 3430). Restyling the tabs bar can break tab insertion order.
- **Edit-mode contenteditable re-enable** has a heuristic blocklist (skip `.rv-hdr`, `.med-calc`, `.med-flag`, `.emerg-grid`, `.auth-block`, line 6147–6160). A new read-only section that lacks one of those classes would become editable on Edit, allowing the doctor to overwrite computed values.
- **A regex parses frequency words from Row 2 in update mode** (line 6193–6221): the AI must consistently emit "qid/q6h/tds/tid/q8h/bd/bid/q12h/od/once/twice/three times/four times". Locale variants would break frequency restoration.
- **Print uses `api.qrserver.com`** — third-party. If down, prescriptions print without the QR. Failure path: 5 s timeout per image then `print()` proceeds with a broken `<img>`.
- **The QR `verify.html` page must exist** at the same origin (line 6943). If renamed/moved, every printed QR points to a 404.
- **Race between `loadTodayPatients` auto-select and a manual selection**: auto-select fires only if `!selectedPatient`, but if the user selects faster than the patients-fetch resolves, the auto-select is skipped — fine; the converse (patients fetch finishes after a manual select) is also handled correctly.
- **Patient-info-panel innerHTML contains a `collapse-hdr` with an inline `onclick`** that toggles a sibling element (line 4130). Restructuring the panel breaks the collapse.
- **Vaccine Edit row matching** uses `data-type` and `data-idx` attributes (line 6349–6368). Any restyling that drops these attributes loses the link between checkbox, status select, and date input.
- **`generated_json` overwrite on update mode** PATCHes the row in place with the new JSON, dropping any audit trail of prior versions; Section A intentionally chose this over append-only versioning.
- **`isUpdateMode` reset is in `showSaveSuccess`** (line 6708): if `signOff` throws after the new POST/PATCH but before `showSaveSuccess`, `isUpdateMode` stays true and a subsequent click would treat the next save as an update.
- **Auto-fill of clinical note context** could be very long for returning patients with long allergy lists, vaccinations, and chief complaints — there is no explicit token budget. Edge Function timeout (120 s) will eventually fire, but the doctor sees only "Generation failed".
- **Browser-only feature requirements**: voice dictation needs Chrome (Web Speech) or AI fallback; `MediaRecorder` for AI; `crypto.subtle` for QR hash (HTTPS only). Self-hosted on http would silently disable voice and break the QR.
- **Past breakages explicitly fixed but worth watching**: `--brd`/`--ink1` undefined CSS vars (B6.3); tabs sticky overlap (B6.4); restore button blocked by pointer-events:none (C4); listener accumulation on patient switch (B3.8); race on rapid patient switching (B3.9); silent saveNote success on HTTP error (B6.5); URL.createObjectURL leak (B7.8); print fired before fonts loaded (B7.10).

## 10. Why-it-was-built-this-way (best-evidence reconstruction)

- **Single-file HTML with inline CSS+JS** is mandated by the spec ("Each page is a single self-contained HTML file") so that GitHub Pages can serve it without bundlers. No build step → easy hot-fix in the field. [Spec §5.1; CLAUDE.md "Working with Web Pages"]
- **Auto-connect with hardcoded credentials** is intentional for the POC: doctors do not see a config dialog. The original Claude.ai artifact required URL+key entry; the migration removed it. [CLAUDE.md "Supabase credentials … hardcoded"; spec §3.2]
- **Free-text clinical note as the only required input** is the central design decision that separates this system from traditional HMIS. [Spec §2.1: "Eliminate all mandatory structured input fields. The doctor's clinical note is the only required input."]
- **Tool-use loop** (5 tools) for Claude is progressive disclosure — load only what's needed instead of stuffing the full 530-drug formulary into every prompt. [Spec §3.3]
- **3-row medicine format** (CAPS / English / Hindi) plus a fourth pictogram column is a clinical/literacy requirement: caregivers in the OPD have varying literacy levels and many speak only Hindi. [Clinical Rules Summary §3-row format]
- **Pictogram sidebar** (sunrise/sun/sunset/moon SVG icons + dose-quantity icons + Hindi duration/food text) is per project memory `project_pictograms.md`: low-literacy patients benefit from visual dosing cues.
- **Auto-save to `visits.raw_dictation`** (3 s debounce + 30 s safety) protects against power cuts and browser crashes during long pediatric exams. [CLAUDE.md "Auto-save notes"]
- **localStorage draft survives sign-off** (per C1) because the doctor often needs to revisit and reprint within minutes; clearing the draft forced a regeneration which costs API tokens and time. [Section C resolution notes C1]
- **Sequential `RX-YYMMDD-NNN`** replaced timestamp-based IDs because pharmacy and reception need readable, predictable counters they can call out to caregivers. [A5]
- **`admission_recommended` as an explicit field** rather than inferring from `followup_days==null && referral` came after a clinical safety review: the AI was sometimes producing contradictory output (referral + 1-day follow-up). [A8 / C3]
- **Doctor-override rule** (A9) was added because the AI's allergy/contraindication checks were silently dropping or substituting medicines the doctor had explicitly written. The rule mandates inclusion-with-flag rather than omission.
- **`vax_schedule` carry-forward from registration** (A10) eliminates a redundant doctor click and prevents the wrong schedule (NHM vs IAP) being used for poor families on the government programme. [A10]
- **Universal slider with multi-zone gradient** for dose adjustment (vs. fixed steppers) was intentional: dose ranges differ by indication band (e.g. low-dose vs high-dose Amoxicillin for AOM), and the slider visually shows the doctor where each band lives. [Spec §3.2; pad code lines 5497–5527]
- **Realtime websocket on visits** lets the doctor see new patients arrive without a page reload during clinic hours. [Pad code lines 3105–3189]
- **AI transcription primary, Web Speech fallback** because Web Speech in `en-IN` mis-handles code-switched Hinglish that doctors actually speak. AI Whisper-class transcription with `patient_context` improves recognition. [Pad code lines 4391–4514]
- **Image compression with sigmoid contrast** before sending to Vision: low-cost OCR token use plus better contrast on poor-quality phone photos of lab reports. [Pad code lines 4775–4791]
- **PostgREST + anon key + RLS `anon_full_access`**: POC mode; per CLAUDE.md "RLS enabled with anon_full_access policy for POC". Production hardening is deferred. [Speculation: this would change for go-live; today the RLS is intentionally permissive.]
- **No PDF generation**: the system uploads `.txt` to Storage as a portable summary; an actual PDF requires server-side rendering which is intentionally out of scope. The browser print path produces the patient-facing PDF. [Pad code lines 6640–6705 with explanatory comment "not PDF despite legacy variable names"]
- **3rd-party QR API** instead of inline JS QR library: page weight is already large; offloading the 1 KB QR PNG to a CDN keeps the print HTML lean. [Speculation; not documented elsewhere.]
- **`patient_id` denormalized on `prescriptions`**: query-performance optimisation — looking up "today's prescriptions for patient X" without a JOIN. Consistency enforced at app layer. [B7.19 schema comment]
- **History tabs limited to 5**: balance between context for the doctor and DOM/network cost. [Pad code line 3398; speculation: arbitrary, no spec citation.]

## 11. Cross-references (other slices this depends on)

- `web/dose-engine.js` — universal dose computation library; canonical source of truth for dose math. Required at runtime.
- `web/registration.html` — produces `visits.raw_dictation`/`chief_complaints`/`vitals`/`vax_schedule`/`attached_documents`/`visit_summary` and the `lab_results`/`vaccinations` rows the pad reads. Section ordering on registration determines what ends up in the visit info panel.
- `web/prescription-output.html` — Print Station; uses the same `printRx`-style rendering for today's approved Rx. Independent file but must stay schema-aligned with whatever JSON `signOff` writes (admission_recommended, warning_signs, etc.).
- `web/verify.html` — target of the printed QR code's `?rx=…&uhid=…&hash=…&abha=…` URL. Must exist on the same origin or the QR is dead.
- `supabase/functions/generate-prescription/index.ts` — server side of Generate. Carries the 5-tool loop, fallback single-shot path, 120 s timeout, repeated-call detection. Returns `{prescription}`.
- `supabase/functions/transcribe-audio/index.ts` — voice → text.
- `supabase/functions/process-document/index.ts` — image/PDF → `text_for_pad` for attachment ingestion.
- `supabase/functions/generate-fhir-bundle/index.ts` — ABDM FHIR bundle generator called after sign-off (non-blocking).
- `radhakishan_system/skill/core_prompt.md` — the lean core prompt loaded by the Edge Function on every call. Defines the JSON output schema the pad renders.
- `radhakishan_system/skill/references/*.md` — fetched on-demand by Claude via `get_reference`; their content shapes outputs (NABH, antibiotic stewardship, vaccination schedules, growth charts, etc.).
- `radhakishan_system/schema/radhakishan_supabase_schema.sql` — table definitions and CHECK constraints the pad relies on (vital sign ranges, blood-group enum, FK from `doctor_id` → `doctors`, etc.).
- `radhakishan_system/schema/abdm_schema.sql` — `abdm_care_contexts` and `abdm_consent_artefacts` tables touched on sign-off.

## 12. Surprises (unexpected patterns, latent bugs, dead code)

- **`switchFormulation` exists** (line 6070) but is never wired up — replaced by the radio-driven `dpFormChanged`/`dpStrengthChanged` cascade. Dead code with no obvious caller; auto-applies dose at the end which would be surprising if invoked.
- **`dpFixedChange` legacy stub** (line 2610) — explicitly labeled "Legacy stub — fixed-dose stepper replaced by universal slider. Kept for backward compat if any old HTML references it." It's exposed via `window.dpFixedChange` for safety.
- **Two competing CSS classes for collapsibles** — `.collapse-panel` / `.collapse-hdr` / `.collapse-body` plus aliases `.visit-summary-panel` / `.visit-summary-header` / `.visit-summary-body` (lines 345–419). Comment says "Legacy aliases" but both are still rendered.
- **`activeMods.add("inv"); activeMods.add("growth")` runs at module top-level** (lines 4816–4817) right after `toggleMod` is defined — this is _additional_ to the initialisation in the `let activeMods = new Set([...])` literal at line 2157 and to the reset in `onPatientSelect`. Triple-redundant but harmless.
- **`MODS` map (line 2317)** with labels and placeholders for `inv`/`vax`/`growth`/`dev`/`diet`/`iv`/`ref`/`neo` is defined but never read in this version — older version had inline text areas per chip; current version uses chip-only toggles and sends the section names via `getSelectedSections`.
- **`KEY` typo-resistant**: the JWT is hardcoded twice (config bar input default value and the JS constant). The hidden config bar (`display:none !important`) is dead UI but the inputs still exist in DOM.
- **`#cfg-bar` is hidden but its `oninput` handlers reference `sbDirty`** which is otherwise unused. Removing the bar would clean it up.
- **Patient pre-fill assembly is procedural string-concatenation** (lines 4151–4218) that mixes English + numbers + the occasional unit. There is no escaping and the result is inserted into a textarea (`ta.value = ctx`), so HTML-like content in `chief_complaints` is treated as text — actually safe.
- **The `paste-area` UI (line 723, .paste-area)** appears to be vestigial — historical paste-JSON workflow from the Claude.ai artifact era. CSS exists; no DOM references it.
- **`window.opener.postMessage` listener** (line 5048) still receives `radhakishan-rx-json` and `radhakishan-rx-template` payloads — used when the Patient Lookup page launches the pad with a template. Cross-origin postMessage is never validated; if any iframe sends the right `type`, it can inject a prescription.
- **`removeNP` re-renders the entire review** (line 7036) instead of splicing one DOM node, which is surprisingly expensive but consistent with how add-medicine and add-investigation work.
- **`fmtConc(f)` and `getConc(f)`** support both new ABDM-FHIR-style `f.ingredients[]` and legacy `f.conc_qty` formats. Backward compatibility with the formulary-import script's older shape.
- **Pictogram cream/ointment Hindi**: row3 omits "दें" suffix only for cream/ointment (line 6024). Counter-intuitive but aligns with Hindi grammar — "लगाएं" already means "apply".
- **`editVisit()` in registration was dead code** (B6.9) — not in this slice but worth noting for parity.
- **The print stylesheet duplicates `.dose-sidebar` styling** because the popup window's stylesheet is built inline alongside the body markup — any CSS change here must mirror the in-pad `<style>` and the print `<style>` block.
- **`generateRxId`** has a one-liner fallback (`return prefix + "001"`) but does not handle the wraparound past 999 prescriptions/day — a non-issue for current OPD volume but a latent bug.

## 13. Open questions for domain expert (only the doctor/PO can answer these)

1. **Neonatal threshold of 28 days vs 90 days** — the registration page hides the neonatal section under DOB < 90 d, while the prescription pad auto-activates the Neonatal chip only when age < 28 d. Is this intentional (90 d for "young infant" data capture, 28 d for "neonatal-specific dosing")? Documenting the rationale will help future maintainers.
2. **Default-on inclusion chips** are `Investigations`, `Std Rx`, `Growth`. Why not `Development` or vaccination? Should defaults vary by age (e.g. Development on for under-5)?
3. **History tab limit** is 5 most-recent approved prescriptions. Is 5 clinically right, or should chronic-disease patients have more?
4. **`previously_given` vaccinations save with `dose_number: null`** (line 6552) — is that acceptable for ABDM/IAP audit trails, or should the doctor be prompted for the dose number?
5. **`doctor_notes` editable but freed-form**: any mandatory minimum content?
6. **Update mode silently overwrites `generated_json`** with no version history. Acceptable medico-legally, or do we need an audit trail?
7. **The "Admit" chip and the AI-derived `admission_recommended`** can disagree (chip on but AI returns null, or vice versa). Which wins on print? Current code shows "ADMISSION RECOMMENDED" only if `r.admission_recommended` is truthy — the chip merely instructs the AI. Confirm this is the desired precedence.
8. **Maximum dose flag** is only displayed; sign-off is not blocked. Should certain "REVIEW REQUIRED" statuses require an explicit acknowledgment checkbox?
9. **QR code includes ABHA number unconditionally** if the patient has one. Is this acceptable PHI exposure on a printed page?
10. **Voice dictation sends patient name + sex + weight + complaints as `patient_context`** to the transcription Edge Function for accuracy. Is that PII budget acceptable, especially over the public Edge Function URL?
11. **Real-time visits subscription receives all hospital INSERTs**, even ones for other doctors / future visit dates. Filtering is client-side. Is this OK for now, or do we need server-side filters?
12. **`abdm_care_contexts` `linked` flag** is set to `!!selectedPatient?.abha_verified`. Confirm: a patient with an unverified ABHA is `linked:false`, even though we store the relationship?
13. **Dr. Gandharv Goyal's profile** is hardcoded with degree "MBBS (AIIMS, New Delhi)" and Reg "DMC/R/0632". Confirm correctness; is this profile in production use, or only for testing?
14. **Hardcoded emergency phone numbers** `01744-251441 / 01744-270516 / 7206029516` — confirm none have changed.

## 14. Suggested follow-ups (read-only observations, NOT a fix list)

- Consolidate the form-name regex (the long `/\s+(SYRUP|TABLET|...)\s*$/i` literal) into a single exported helper to remove the four near-duplicates.
- Move hardcoded `SB`/`KEY` into a tiny `web/config.js` so the value is referenced once rather than four times.
- Consider making the "Admit" chip read the AI's `admission_recommended` after generation and visually sync — currently they can drift apart between Generate and Sign-off.
- Replace `api.qrserver.com` with a vendored JS QR library for offline reliability.
- The `removeNP`/add-medicine paths re-render the entire review wrap — consider in-place DOM mutations for large prescriptions.
- The postMessage listener should validate `event.origin` to a whitelist of known pages (Patient Lookup, Print Station).
- `localStorage` drafts use `visit_id` if present else `patient_id`, but never expire — a janitor that prunes drafts older than 7 days would prevent unbounded growth.
- The print stylesheet duplicates the in-pad pictogram CSS; extracting a shared `print.css` would reduce drift risk between the two views.
- `_renderPatientRow` uses inline `style=` for hover colors via inline `onmouseover/onmouseout`. Migrating to CSS `:hover` would simplify and improve a11y.
- Vaccine `previously_given` rows are saved with `given_by="reported_by_parent"` and `free_or_paid="unknown"`; consider explicit DB CHECK constraints to enforce this enum.
- Update-mode toggling resets dose-panel input values via per-medicine string parsing; a structured DTO would be more robust than DOM read-back.
- The 120 s tool-use timeout is in the Edge Function only; the pad has no front-end timeout, so a hung Edge Function makes the rotating status messages cycle indefinitely. Adding an explicit 130–150 s `fetch` timeout in `generatePrescription` would surface failures earlier.
- The Realtime subscription shape (`postgres_changes:[{...}]`) currently lives client-side; if the Supabase project's CDC publication settings change, the WebSocket will silently stop emitting — no observability.
- Triage and `safety.overall_status="REVIEW REQUIRED"` are rendered but not blocking; a discreet visual interlock (button colour, additional confirm dialog) before sign-off could enforce review without breaking workflow.
- The pad is the single largest file in the repo (7,875 lines). Extracting voice, dose-panel, history-tab, and document-tab modules into separate `<script src>` files would aid review without changing runtime behavior.

---

Generated 2026-04-27 by reading-agent R1. Source files:

- `web/prescription-pad.html` — 7,875 lines (read in full)
- `radhakishan_system/docs/specification/radhakishan_specification.md` — 1,198 lines (read sections 1–5.4, ~600 lines, + scanned remainder for terminology)
- `radhakishan_system/docs/code-review/section_a_resolution_notes.md` — 366 lines
- `radhakishan_system/docs/code-review/section_b2_resolution_notes.md` — 885 lines
- `radhakishan_system/docs/code-review/section_c_resolution_notes.md` — 305 lines
- `radhakishan_system/docs/planning/doctor_update_notes_20260324.md` — 120 lines
- `radhakishan_system/docs/clinical/CLINICAL_RULES_SUMMARY.md` — 211 lines
- `radhakishan_system/docs/SETUP_GUIDE.md` — 189 lines
