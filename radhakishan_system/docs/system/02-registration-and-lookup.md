# 02 — Patient Registration & Lookup

_System documentation for `web/registration.html`, `web/patient-lookup.html`, and `web/verify.html`._
_Edition: 2026 · Status: live in production at `rx.radhakishanhospital.com`_

---

## 1. Purpose

The registration and lookup surfaces sit at the front door of every clinical encounter at Radhakishan Hospital's pediatric OPD. They handle three jobs that must succeed before the doctor ever opens the Prescription Pad:

1. **Patient identity** — find the right patient (by name / UHID / phone / guardian / QR), or enroll a new one with a hospital-allocated UHID.
2. **Visit creation** — capture demographics, vitals, chief complaints, allergies, vaccinations, structured lab results and external documents into a single `visits` row that the Prescription Pad will read.
3. **Public verification** — give parents (and any third party who scans the QR on a printed prescription) a read-only, PII-masked confirmation that an Rx was actually issued by RKH.

`registration.html` is the receptionist + nurse cockpit (full create/update flow). `patient-lookup.html` is a read-mostly browser of the patient record (visits, prescriptions, growth) intended for the doctor or admin and was authored when the system still ran inside Claude.ai artifact iframes (postMessage hooks are still present). `verify.html` is the public-internet face of every printed prescription QR code.

---

## 2. Files

| File | Lines | Role |
|---|---|---|
| `web/registration.html` | 3748 | Reception + nurse station: full registration, edit, vitals, vax, labs, docs, visit creation |
| `web/patient-lookup.html` | 1284 | Searchable patient browser with expandable cards (visits / Rx / growth tabs) |
| `web/verify.html` | 382 | Public Rx verification page reached via QR code on printed prescription |
| `radhakishan_system/docs/clinical/CLINICAL_RULES_SUMMARY.md` | 211 | Authoritative clinical rules cited throughout this doc |
| `radhakishan_system/docs/specification/radhakishan_specification.md` | 1198 | Full system spec (sections 5.3, 5.4, 8, 10, 11.1 are most relevant here) |

Supporting infrastructure (referenced but documented elsewhere in the `docs/system/` series):

- Supabase REST endpoints: `patients`, `visits`, `vaccinations`, `lab_results`, `growth_records`, `prescriptions`, `loinc_investigations`
- Supabase Edge Functions: `generate-visit-summary`, `process-document`, `transcribe-audio`, `abdm-identity` (planned)
- Supabase Storage: `documents` bucket
- CDN: `cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js`, `api.qrserver.com/v1/create-qr-code/`

---

## 3. Clinical Workflow Context

Per the project's 3-stage workflow (see CLAUDE.md and spec §3.2), registration straddles **Stage 1 (Reception)** and **Stage 2 (Nurse Station)** — the same HTML page is operated by two different staff members in sequence. The doctor in Stage 3 (Prescription Pad) consumes this output as read-only context.

**Section order on registration.html (line 938 onward, `renderForm`):**

1. Demographics (required) — name, UHID (auto), DOB, sex, blood group, phone, ABHA, guardian
2. Visit Details (required) — date, doctor, visit type, fee, payment, optional procedures
3. Chief Complaints — free-text, what the parent reports
4. Neonatal Details — auto-shown when DOB < 90 days OR GA/BW already on record
5. Known Allergies — comma-separated text → `patients.known_allergies` text array
6. Vitals & Measurements (nurse) — weight, height, HC, MUAC, BMI auto, temp, HR, RR, SpO₂, BP + auto MAP + auto pediatric BP centile
7. Lab Results & External Records — LOINC-searchable test entry, free-text notes, document upload
8. Vaccination History — IAP / NHM-UIP age-based checklist + manual rows

This order deliberately puts **doctor-blocking fields** (demographics, visit type, complaints) before the slower **nurse measurements** so reception can save and hand the patient to the nurse mid-form if needed (the form persists; revisits within the same day reload existing visit data and switch the save button to "Update Visit").

Patient-lookup is a separate read flow used when the receptionist or doctor wants the historical view: it returns up to 50 visits, 50 prescriptions, and 50 growth records per patient with tabs to switch between them.

---

## 4. Data Flow

### 4.1 New patient registration (registration.html)

```
User input → renderForm() (line 938)
         → saveAndCreateVisit() (line 1773)
              ├─ generateUHID() (line 681)               → SELECT id FROM patients WHERE id LIKE 'RKH-YYMM*' ORDER BY id DESC LIMIT 1
              ├─ POST /rest/v1/patients                  → insert with id = RKH-YYMM##### (3 retries on UHID conflict)
              ├─ generateReceiptNo("RKH-RCT")            → SELECT receipt_no FROM visits WHERE visit_date=today
              ├─ POST /rest/v1/visits                    → insert visit (returns id)
              ├─ POST /rest/v1/lab_results               → batch insert structured labs
              ├─ uploadDocuments(patientId, visitId)     → PUT to documents bucket per file
              │     ├─ processImage()                    → canvas resize 1920px + sigmoid contrast + unsharp mask + JPEG 85%
              │     └─ POST /functions/v1/process-document (already pre-OCR'd at file-select time)
              ├─ POST /rest/v1/vaccinations              → batch from checklist + manual rows
              ├─ PATCH /rest/v1/visits?id=eq.<id>        → append document metadata to clinical_notes + attached_documents JSONB
              ├─ Render OPD receipt ticket               → printToken() opens new window with A4 receipt + QR
              └─ buildVisitSummary() (fire-and-forget)   → POST /functions/v1/generate-visit-summary (returning patients OR docs with OCR summaries)
                                                         → PATCH visits.visit_summary
```

### 4.2 Returning patient revisit

`debounceSearch()` (300 ms) → `doSearch()` queries `patients` with `or=(name.ilike,id.ilike,contact_phone.ilike,guardian_name.ilike)&is_active=eq.true&limit=20`. Selecting a card calls `selectPatient()` which:

1. Fetches last visit date for header display
2. Renders the form with values pre-filled from the patient row
3. Checks for **today's visit** — if one exists, `currentVisitId` is set, fields are populated from the saved visit, the save button label flips to "Update Visit", and a toast announces edit mode
4. Fetches existing vaccinations and renders the age-based IAP/NHM checklist with pre-checked, disabled, dated boxes
5. Fetches the last 10 lab results and prepends them as read-only pills above the lab entry UI
6. The save flow on update branches into PATCH-with-diff for the patient row (only changed fields) and PATCH on the visit row instead of POST

### 4.3 QR scan re-registration

`startQrScan()` (line 3556) uses html5-qrcode with `facingMode: environment`. `handleQrResult()` accepts three formats:

- A `verify.html?...` URL — extract `uhid` query param
- A JSON payload `{uhid, pt, dob, sex}` (legacy and current OPD token format)
- Plain `RKH-...` UHID string

If the UHID exists in `patients`, `selectPatient()` is called. If not, the new-patient form is opened pre-filled from QR fields with the UHID input flagged "from QR — will verify".

### 4.4 Patient lookup browser

`patient-lookup.html` is structurally similar but read-oriented. `searchPatients()` (350 ms debounce) runs the same `or=` query. Each result card collapses; expanding fires `loadDetail()` which runs three queries in parallel: `visits` / `prescriptions` / `growth_records` (each `limit=50`). Tabs switch between the three views. Two postMessage hooks (`radhakishan-load-patient`, `radhakishan-rx-template`) target `https://claude.ai` — leftover from the artifact-iframe POC architecture, harmless on GitHub Pages but dead code.

### 4.5 Verify (public)

`verify.html?rx=<id>&uhid=<uhid>&hash=<6char>&abha=<optional>` → fetches `prescriptions?id=eq.<rx>&is_approved=eq.true&select=id,patient_id,created_at,generated_json`. Computes SHA-256 of `rxId + uhid + dateOnly + "rkh-salt-2026"` and compares the first 6 hex chars with the `hash` query param. Mismatch shows an amber warning but still renders the data; missing or unapproved Rx shows an error. Patient name is masked (first/last char + asterisks), ABHA is masked (first 2 + last 4 digits).

---

## 5. State and Storage

### 5.1 Module-level state (registration.html)

| Variable | Purpose | Reset by |
|---|---|---|
| `SB`, `KEY` | Hardcoded Supabase URL + anon JWT (line 599) | never |
| `connected` | Connection probe result (formulary count query) | `connectSB()` |
| `lastToken` | Last-saved patient ticket payload for `printToken()` | `resetAll()` |
| `currentPatient` | Loaded patient object (null = new) | `cancelForm()`, `resetAll()`, `showNewPatientForm()` |
| `currentVisitId` | Set when today's visit exists → enables PATCH-mode save | as above |
| `_searchResults` | Array passed to `selectPatientByIndex()` to avoid JSON-in-HTML attribute escaping bugs | each search |
| `vaxRows` | Counter for unique IDs of manually-added vaccine rows | `renderForm` |
| `existingVax` | Vaccinations fetched for returning patient (used by checklist re-render) | `cancelForm` |
| `proceduresList` | OPD procedures with auto-generated `RKH-PRC-YYMMDD-NNN` receipt numbers | `cancelForm` |
| `labEntries` | Structured lab entries pending visit save | `cancelForm` |
| `_preOcrResults` | Map of doc-row index → OCR result (run at file-select time, reused at upload time to avoid re-OCR) | `renderForm` |
| `_ocrPromises` | Awaited before save completes ("Processing documents…") | `saveAndCreateVisit` |
| `_procReceiptSeq` | Per-session procedure receipt counter | never (session-scoped) |
| `activeVaxSchedule` | "iap" / "nhm" / null — checklist hidden until explicitly chosen | `switchVaxSchedule` |

### 5.2 Persisted writes (Supabase)

| Table | Operation | Triggered from |
|---|---|---|
| `patients` | INSERT (new) or PATCH-diff (revisit if any field changed) | `saveAndCreateVisit` |
| `visits` | INSERT (new visit) or PATCH (today's visit edit) — includes `vax_schedule`, `procedures` JSONB, `attached_documents` JSONB, `receipt_no`, `consultation_fee`, `payment_*`, all vitals + BP/MAP, `chief_complaints`, `clinical_notes`, `visit_summary` (set later, async) | `saveAndCreateVisit` |
| `vaccinations` | Batch INSERT for newly-checked vaccines + manual rows; existing records are skipped (checkboxes disabled) | `saveAndCreateVisit` |
| `lab_results` | Batch INSERT only on new visit (skipped on edit to avoid duplicates) — includes `loinc_code`, `flag`, `test_category`, `value_numeric`, `source: "manual"` | `saveAndCreateVisit` |
| Storage `documents/<uhid>/<visitId>/<cat>_<ts>.<ext>` | PUT with `x-upsert: true` | `uploadDocuments` |

### 5.3 UHID generation (line 681)

Format `RKH-YYMM#####` where YYMM is a 6-character compound: 2-digit Indian financial year start (April-roll), 2-digit FY end, 2-digit calendar month. Examples: April 2025 → `RKH-25260400001`, March 2026 → `RKH-25260300001` (still FY 2025-26). The next sequence number is computed by querying `patients?id=like.<prefix>*&order=id.desc&limit=1` and parsing characters 10+ as an int. Three-attempt retry on insert conflict (HTTP 409 / "duplicate" / "unique"). The same algorithm is duplicated in `patient-lookup.html` line 1158.

### 5.4 Receipt numbers

`RKH-RCT-YYMMDD-NNN` for visits (queries `visits?visit_date=eq.<today>&order=receipt_no.desc&limit=1`). `RKH-PRC-YYMMDD-NNN` for procedures (uses the in-memory `_procReceiptSeq` counter, NOT a DB lookup — collisions across browser tabs are possible).

---

## 6. External Dependencies

| Dependency | Used by | Notes |
|---|---|---|
| Supabase REST `/rest/v1/*` | All three pages | Hardcoded URL + anon JWT exp 2089. RLS policy `anon_full_access` per CLAUDE.md. |
| Supabase Storage `/storage/v1/object/documents/*` | registration.html `uploadDocuments` | Public bucket; URLs embedded in visit `clinical_notes` and `attached_documents` JSONB |
| Supabase Edge Function `process-document` | Pre-OCR at file select + post-upload write-through | Returns `{summary, lab_values, diagnoses, medications}` |
| Supabase Edge Function `generate-visit-summary` | Fire-and-forget after registration save | Skipped for brand-new patients with no docs (cost-saving) |
| Supabase Edge Function `transcribe-audio` | External-records dictation | VAD-chunked WebM/Opus → falls back to Web Speech API on 4xx + `fallback: true` flag |
| Supabase RPC `search_investigations` | Lab test search (LOINC) | Falls back to `loinc_investigations` ilike search on `component`, `long_name`, `related_names` |
| html5-qrcode 2.3.8 (cdnjs) | QR scan camera | `facingMode: environment`, fps 10, qrbox 250×250 |
| `api.qrserver.com/v1/create-qr-code/` | OPD receipt + token QR | External GET; payload is JSON `{uhid, pt, dob, sex}` |
| Web Speech API (`webkitSpeechRecognition`) | External-records dictation fallback | `lang: en-IN`, continuous, interim — Chrome only |
| MediaRecorder + Web Audio API | Primary AI-dictation pipeline | VAD threshold 25, silence-send 1500ms, max chunk 15s, min blob 4KB |
| Canvas 2D + sigmoid pixel pass | `processImage` / `enhanceDocument` | 1920px max width, JPEG 85%, adaptive contrast around frame mean, 0.3 unsharp mask |
| `crypto.subtle.digest("SHA-256", ...)` | verify.html hash check | Salt: literal string `"rkh-salt-2026"` |

---

## 7. Safety Mechanisms

### 7.1 XSS / injection

- `esc()` (line 592) is the universal HTML-encoder. Used on every dynamic value before innerHTML insertion (allergies, names, UHIDs, search results, vax labels, lab pills, procedure rows, doc rows, OCR summaries, ticket fields, ABHA, hashes). Same function in patient-lookup.html and verify.html.
- Search-result patient cards never embed JSON in `onclick`; they use `selectPatientByIndex(idx)` against `window._searchResults` to dodge attribute-escape bugs (line 766).

### 7.2 Identity safety

- UHID generation has 3-retry collision handling against unique constraint.
- `patients.known_allergies` are surfaced **in red** at three places: search-result cards, the registration form pre-fill, and the printed OPD token. The token shows "NKDA" in green when the field is blank — explicit, never blank-ambiguous.
- Per spec §11.1, allergies are asked **at every visit** — the UI re-presents the field on revisit pre-filled, not hidden, prompting a recheck.
- ABHA verification (`verifyAbha`, line 3705) is currently a format check (14 digits) — full ABDM sandbox call is `TODO`; the field saves the number plus an "ABHA recorded (verification pending)" status banner.

### 7.3 Clinical-input safety

- BMI auto-recalc on weight/height change (`calcBMI`, line 1421) with classification chip.
- Pediatric BP percentile lookup (`BP_CENTILES` table, AAP 2017, ages 1–18) classifies into <50th / 50–90th / 90–95th / ≥95th (Stage 1 HTN) with traffic-light colours. MAP auto-computes via `dia + (sys − dia)/3`. Under-1-year shows "use neonatal norms" rather than risk a wrong centile.
- Neonatal section auto-shows when DOB < 90 days (per CLAUDE.md neonatal chip rule). DOB change handler re-evaluates and re-renders the IAP/NHM checklist for the new age.
- Auto-flag on lab values: parses reference range `"low-high"`, sets `flag` to `low` / `high` / `normal`; for `"Negative"` / `"No growth"` ranges it sets `abnormal` if value contains "positive" / "growth". Stored alongside `value_numeric` for downstream Z-score / trend logic.
- Vaccination checkboxes for **already-given** doses are pre-checked and `disabled` so they cannot be double-saved. OVERDUE labels (red) appear when the milestone age has passed but the dose was not recorded.
- Vaccination button bar (IAP / NHM-UIP) is **mutually exclusive and unselected by default** (per CLAUDE.md). The checklist body shows an explicit "Select IAP or NHM-UIP" hint — there is no implicit fallback.
- The new-visit save returns the visit's UUID before any child writes (labs, vaccinations, doc-metadata patch) — no orphan rows.
- Document upload size cap: 10 MB, validated client-side at file select and again at upload.

### 7.4 Verify.html

- Only `is_approved=eq.true` prescriptions are returned — drafts and unapproved rows are inaccessible.
- Patient name is masked (`maskName`); ABHA is masked (`maskAbha`).
- Hash mismatch produces an amber error banner but still renders content with a tamper warning, so a parent who can read the data can still confirm it is plausible while flagging the QR as untrusted.
- Salt `"rkh-salt-2026"` is hard-coded — not a security boundary against a determined attacker, but defends against trivial URL-fiddling by parents/staff.

---

## 8. Configuration Knobs

| Knob | Where | Default |
|---|---|---|
| Supabase URL | `SB` constant (line 599 + verify line 229 + lookup line 735) | `https://ecywxuqhnlkjtdshpcbc.supabase.co` |
| Supabase anon key | `KEY` constant (same lines) | hard-coded JWT (exp 2089) |
| Hash salt | `verify.html` `computeHash` | `"rkh-salt-2026"` |
| Consultation fees | `updateFee()` (line 1598) | new ₹300, follow-up ₹150 (auto-detect ≤7 days), vaccination ₹0, emergency ₹500 |
| Doctor list | inline `<select>` (line 1019) | `DR-LOKENDER` (default), `DR-GANDHARV` |
| Search debounce | `debounceSearch` 300 ms; lookup 350 ms | — |
| Search result limit | `limit=20` (registration), `limit=20` (lookup) | — |
| Visit / Rx / growth tab limit (lookup) | `limit=50`; "50+" badge | — |
| Lab pre-fill on revisit | last 10 results (`order=test_date.desc`) | — |
| OCR-eligible doc categories | `OCR_CATEGORIES` array (line 2516) | all 15 |
| Image processing target | 1920px max width, JPEG 85% | `processImage` |
| Unsharp mask strength | `sharpen = 0.3` | `enhanceDocument` |
| Sigmoid contrast steepness | `0.06` | `enhanceDocument` |
| VAD chunking | threshold 25, silence-send 1500 ms, max chunk 15 s, min blob 4 KB | `EXT_*` constants line 2308 |
| Web Speech locale | `en-IN`, continuous, interimResults | `extRecog` |
| QR scanner | fps 10, qrbox 250×250, rear camera | `startQrScan` |
| Token QR pixel size | 80×80 (ticket), 70×70 (printed receipt) | inline `<img>` |
| Neonatal auto-show threshold | `ageDays < 90` OR `gestational_age_weeks` OR `birth_weight_kg` populated | `renderForm` |
| BP centile reference table | `BP_CENTILES` (AAP 2017 simplified), ages 1–18 | line 1401 |
| `IAP_SCHEDULE` | 13 milestones, birth → 10–12 yr Tdap | line 1221 |
| `NHM_SCHEDULE` | 9 milestones, birth → 16 yr TT | line 1310 |
| `COMMON_LABS_OFFLINE` | 4 categories, 39 tests with LOINC + ref ranges | line 2616 |
| `INDIAN_LAB_ALIASES` | 30+ Indian abbreviations → LOINC search terms | line 2569 |
| `DOC_CATEGORIES` | 15 document types | line 2533 |

---

## 9. Known Fragility

- **Hard-coded Supabase credentials.** All three pages embed the URL and anon JWT verbatim. Rotation requires a coordinated edit and redeploy of every HTML in `web/`. `connectSB()` accepts UI overrides via the (currently hidden) config panel, but the panel has `display:none !important` and no UI button to surface it.
- **Inline anon key with 64-year expiry.** The JWT expires in 2089. Any Supabase project rebind requires changing it in 8+ HTML files plus verify.html.
- **Receipt-number race.** `_procReceiptSeq` is a **per-tab in-memory counter** for procedure receipts. Two browser tabs (or two reception PCs) can produce the same `RKH-PRC-YYMMDD-NNN` value. Only the visit-level `RKH-RCT-` numbers are DB-coordinated.
- **UHID retry only handles three collisions.** Under sustained concurrent registrations the fourth collision throws.
- **`patient-lookup.html` postMessage targets `https://claude.ai`.** Dead code from the artifact-era — harmless because the parent frame on GitHub Pages is the same origin and silently ignores, but misleading when reading the source. `startNewVisit` and `reusePrescription` both still trigger `alert(...)` placeholders rather than navigation.
- **Vaccination checkbox `id` derivation** uses `replace(/[^a-zA-Z0-9-]/g, "_")` on the vaccine name. New vaccine entries that collide after sanitization (e.g., "DTaP/IPV" vs "DTaP IPV") would clobber each other. None currently collide in IAP/NHM tables but new entries need review.
- **Lab DB search RPC fallback is silent.** If `search_investigations` RPC is missing/dropped, the page silently falls back to ilike on `loinc_investigations` and never alerts the operator.
- **Document upload + visit PATCH not atomic.** If the visit row is created but the upload step fails partway, the user sees a toast with the failed file name but the patient already has a saved visit. The retry is "register next patient" — there is no resume-upload UI.
- **`_ocrPromises` blocks save UI.** If the `process-document` Edge Function hangs, the save button stays at "Processing documents…" until network timeout. No abort path.
- **OPD token fee/payment values are read AFTER form clear in some paths.** Mitigated by `lastToken` + reading fee/payMode/payStatus into local consts before the form-area HTML wipe (lines 2147–2150) — but the order of operations is fragile: any future refactor that wipes earlier breaks the receipt.
- **`patients.is_active=true` filter** is the only soft-delete gate. There is no UI in registration to flip `is_active=false`; deactivated patients become invisible to search but the column is unmaintained.
- **Verify hash uses 6 hex chars (24 bits)** — sufficient against casual tampering, brute-forceable in seconds. Acceptable because the underlying `is_approved=eq.true` filter is the real gate; the hash is a tamper signal, not an authn boundary.
- **Image enhancement runs on the main thread.** `enhanceDocument` does an O(width×height) sigmoid + unsharp mask in JavaScript. `processImage` defers it inside a `setTimeout(0)` to yield, but a 12-megapixel phone photo still freezes the page for ~1 second on slower terminals.
- **The form is HTML-injected via `innerHTML` of a single 250-line template literal** — any future field added with un-`esc`'d interpolation introduces XSS. Reviewers must check every `${...}` against the `esc()` discipline.

---

## 10. Why It Was Built This Way

- **Single self-contained HTML per page.** Per CLAUDE.md, each web page is an inline-CSS, inline-JS, browser-native bundle deployed via GitHub Pages with no build step. This is intentional: GitHub Pages cannot run Node, and the team wanted zero deploy friction beyond `git push`. Hardcoded Supabase credentials follow from this — there is no place to inject secrets.
- **Form pre-rendered on connect.** `connectSB()` calls `showNewPatientForm()` if no form is present (line 627). Spec §5.4 explicitly states "form shows on page load — no need to click 'New Patient' to start registration." This is a workflow optimization for a 100-patient OPD day.
- **Sticky header bar** (search + Scan QR + Clear Form) is per CLAUDE.md; survives scrolling through the long form.
- **Section order (Demographics → Visit → Complaints → Neonatal → Allergies → Vitals → Vax → Labs → Docs)** was reordered after pilot (visible from the comment at line 1066: "Chief Complaints (moved up — needed before vitals)" and line 1133: "(Chief Complaints moved to after Demographics)") because reception couldn't take vitals before the patient was demographically identified.
- **Neonatal auto-show < 90 days** matches the spec's "neonatal chip auto-activates for age < 28 days, GA < 37 weeks, or birth weight < 2.5 kg" but is intentionally widened to 90 days here because reception captures birth history before the chip fires in the Prescription Pad. Spec §3.2 stage 1 lists "Neonatal details if applicable (GA, birth weight)" as part of reception.
- **Two vaccination schedules with no default** (line 1374, `activeVaxSchedule = null`) per CLAUDE.md "Split NHM Vacc. / IAP Vacc. buttons (mutually exclusive, neither pre-selected)". Haryana-specific reality: PCV + Rotavirus are free under UIP, JE is not endemic — defaulting either way risks bad data.
- **Structured lab entry with LOINC** (COMMON_LABS_OFFLINE + INDIAN_LAB_ALIASES + RPC fallback) replaced an earlier free-text grid because the doctor's `loadRecentLabs()` panel in the Prescription Pad needed `flag` and `test_category` to display traffic-light pills.
- **Document upload with 15 categories** implements the spec §5.4 "External records" requirement. Pre-OCR runs at file-select time so the save button doesn't stall on slow OCR — the result is cached in `_preOcrResults[idx]` and reused.
- **Visit summary is fire-and-forget after registration.** Per spec §5.4: "AI-generated visit summary: For returning patients, the `generate-visit-summary` Edge Function calls Claude... New patients skip this step (cost saving)." The save UI completes immediately; the PATCH on `visits.visit_summary` happens later. Skipped entirely for first-visit patients with no uploaded docs.
- **Edit-mode flip on same-day reselect** (line 802) was added so that nurse measurements can be filed against an already-created reception visit without creating a duplicate row. This honours `visits` table's NOT-NULL constraint on `patient_id` while permitting incremental data capture.
- **OPD receipt + QR.** The QR payload is intentionally minimal (UHID, name first 30 chars, DOB, sex initial) per CLAUDE.md "QR code payload: Minimal re-registration data." Designed for next-visit re-registration via the same QR scanner.
- **Public verify.html with masked PII.** Required by NABH (spec §12) for patient-facing prescription verification. Masking lets a stranger who finds a printed Rx confirm authenticity without exposing the patient's identity.

---

## 11. Cross-References

- **Patient ID format and FY math** — see `~/.claude/.../memory/MEMORY.md` → `project_patient_id_format.md`.
- **Sticky-header rule** — CLAUDE.md "Key Domain Rules": all pages use `position:sticky` headers.
- **XSS rule (`esc()`)** — CLAUDE.md "XSS protection".
- **Allergy storage POC vs production** — spec §11.1 (text array now → JSONB later with severity/date).
- **Vaccination schedules (IAP 2024 + NHM-UIP)** — spec §10, CLINICAL_RULES_SUMMARY.md, and the skill reference files `vaccination_iap2024.md` / `vaccination_nhm_uip.md` in Supabase Storage.
- **Preterm corrected-age vs chronological-age rule** — CLINICAL_RULES_SUMMARY.md and spec §8.1. Note: registration.html does not display corrected age (lookup.html `calcAge` does, line 1213). The Prescription Pad reads `patients.gestational_age_weeks` and computes corrected age there; the spec's "VACCINATION EXCEPTION: Always use chronological age" is honoured implicitly because the IAP_SCHEDULE checklist uses `dob` directly, not GA.
- **WHO Z-scores, MUAC bands, BMI cut-offs** — CLINICAL_RULES_SUMMARY.md §"WHO Z-Score Classification" and §"MUAC". `growth_records` are written by the Prescription Pad after the doctor signs off, not by registration. Registration captures the inputs (weight, height, HC, MUAC, BMI auto), not the Z-scores.
- **NABH 20-section list** — spec §7.1; section 1 (UHID) is generated here, sections 2–4 (anthro, vitals, complaints) are captured here, section 9 (immunization history) is captured here.
- **Pediatric BP centile** — AAP 2017 simplified; full source noted at line 1399.
- **ABDM / ABHA fields** — schema/abdm_schema.sql adds `abha_number`, `abha_address`, `abha_verified` to `patients`. Edge Function `abdm-identity` is referenced as a TODO target inside `verifyAbha()` (line 3715).
- **Patient lookup → Prescription Pad** — `reusePrescription` and `startNewVisit` use postMessage to `https://claude.ai` (legacy artifact target). On GitHub Pages they fall through to alerts.
- **Verify.html linked from prescription QR** — see Prescription Pad's print template (`docs/system/03-...` when written).

---

## 12. Surprises

1. **`patient-lookup.html` is a sibling, not a successor.** Both pages can search and create patients (registration's "Clear Form" button shows the new-patient form; lookup has a "+ New patient" button with a smaller form). Their UHID generators are byte-identical duplicates. New-patient forms have **different field sets**: lookup omits ABHA, blood-group dropdown vs free text, and visit creation. Maintenance hazard.
2. **`renderForm` injects 250+ lines of HTML via a single template literal** (line 946–1218). Editing a single field requires understanding the full string concatenation chain.
3. **Two fee values can coexist.** `updateFee()` sets `f-fee` to 300/150/500/0 based on visit type and a 7-day-window query. On save, both `consultation_fee` and saved `payment_status` are PATCH'd. On reload of an existing visit, the form respects "saved payment" (fee>0 OR status=paid) and only recalculates for legacy `0/pending` rows (line 837).
4. **Procedure receipts are A4 landscape with a "✂" cut line** rendered to a `window.open("", "_blank")`. They print at width 48% so two procedures fit per page; the cut line is visual only (no actual perforation).
5. **OPD token print also uses width 48%** — designed to be either two-up on A4 or cut and stapled to the case sheet.
6. **`processImage` enhancement runs even on PDFs by short-circuiting** (`if (file.type === "application/pdf") return file;`) — but the calling code still labels the result with extension `pdf` and content type `application/pdf`. PDFs go through unchanged; images become `<cat>_<ts>.jpg`.
7. **Voice dictation has two fallbacks: AI VAD-chunked → Web Speech.** If `transcribe-audio` returns 4xx with `fallback: true` in body, the AI path is permanently disabled for the session (`extAiFailed = true`) and the next start uses Web Speech directly.
8. **Verify hash includes the date-only portion** (`(rx.created_at || "").split("T")[0]`) — meaning a re-print of the same Rx on a different day would mismatch. Only the original print's date is valid.
9. **Vaccination dropdown in `addVaxRow` (manual override)** does NOT include all IAP_SCHEDULE entries. "Pentavalent" is there but "PCV Booster", "DPT Booster" appear without their primary forms; "Vitamin A" (NHM only) is missing entirely. Doctors who need it pick "Other…" but the save handler **silently skips** rows whose select value is `"other"` (line 2065 `if (vName && vName !== "other")`). Vitamin A entered as "Other" never reaches the database.
10. **Lab `value_numeric` is `parseFloat(value) || null`** — so a perfectly valid `0` parses to null because `0 || null === null`. Trend graphs lose true-zero values (rare but real for some inflammatory markers).
11. **`p.sex.slice(0, 1)`** in the QR payload uses the first character of the literal value. If `f-sex` stores "Other", QR carries `"O"` and the QR-rescan handler re-maps `O → "Other"` correctly. But "" (unset) silently QRs as empty.
12. **`existingVax` is module-scope, set inside `selectPatient` via a Promise chain** that runs *after* the form is rendered. There is a brief window where the checklist renders empty before being repainted with pre-checks. Acceptable visually but a flicker exists.
13. **`window._searchResults`** — using a global to dodge JSON-in-attribute escaping is a deliberate but unusual pattern. Search result elements call `selectPatientByIndex(idx)` and look up the actual object on the global.
14. **`p.allergyText` chip on the OPD receipt is "ALLERGY: …" red OR "No Known Drug Allergy" green** — never blank/yellow/uncertain. There is no "not asked" state, which silently inverts the spec's NABH requirement to **document** that the question was asked.

---

## 13. Open Questions for Domain Expert

1. **Same-day visit edit semantics.** Today, a re-selected patient with an existing today's-visit goes into PATCH-mode and lab results are skipped on edit (line 1988). What if reception captures three more lab results after the nurse already filed two? Current behavior: silently dropped. Should they be appended?
2. **Procedure receipt numbering across tabs.** Should procedure receipts be DB-coordinated like visit receipts, or is the per-session counter acceptable given that receptionists rarely use two tabs? If DB-coordinated, what is the prefix scheme — `RKH-PRC-YYMMDD-NNN` shared across the day, or per-visit?
3. **Vaccine name normalization.** "MMR" vs "MR/MMR" vs "MR" appear in IAP and NHM schedules. The checklist treats them as distinct (so a child with "MR" in DB will show "MMR" as unchecked). Is this clinically correct (they ARE different vaccines) or should they alias?
4. **NHM "Vitamin A" lost via "Other".** The manual-row save explicitly drops `value === "other"`. Should Vitamin A be added to `addVaxRow`'s dropdown, or is it intentionally not tracked in the `vaccinations` table?
5. **Allergy "not asked" state.** The receipt prints either red ALLERGY or green NKDA. NABH requires documenting that the question was asked. Should the receipt distinguish "asked, none" from "blank"?
6. **Pediatric BP centile under 1 year.** Currently shows "use neonatal norms" — there is no neonatal table. Does the doctor accept the current behaviour (no flag) or should infant BP have its own table?
7. **`patients.gestational_age_weeks` collected only via Neonatal section.** A 4-year-old who was preterm needs corrected-age math at every visit but there is no UI to set GA after the 90-day window (Neonatal section is hidden). Should GA always be editable?
8. **Document categories.** Is the 15-item list canonical, or should it be DB-driven so it can be extended without redeploys?
9. **OCR pre-fetch leaks token.** Pre-OCR sends the file via base64 to `process-document` *before* the patient is saved. If the user cancels, the OCR call already happened. Is there a privacy concern (uploaded image to Edge Function with no `patient_id`)?
10. **Verify hash salt rotation.** `"rkh-salt-2026"` is hard-coded. If salt rotates, all previously-printed prescriptions fail verify. Acceptable trade-off?
11. **Lab `flag = "abnormal"` for textual results** triggers only on substring match of "positive" / "growth". A "Trace positive" or "Light growth" result currently flags. A "Possible positive" too. Is that the desired conservative behaviour?

---

## 14. Suggested Follow-ups

1. **Move Supabase URL/anon key into a single `web/config.js`** and `<script src>` it from each HTML, so rotation is one file. Revisit if a build step is acceptable.
2. **Replace per-session `_procReceiptSeq` with a DB-coordinated query** matching `RKH-RCT` so two reception PCs can't collide.
3. **Extract the duplicated `generateUHID` and `calcAge`** into the same `web/util.js` to prevent drift between registration.html and patient-lookup.html.
4. **Audit the postMessage targets in patient-lookup.html** and either remove (now dead) or repoint to a hospital-internal target.
5. **Surface the hidden config panel** behind a long-press / dev gesture so on-site staff can override credentials when the inline JWT expires.
6. **Add an "asked, none" allergy state** to satisfy NABH "documented that the question was asked" — three-state instead of two.
7. **Increase UHID retry to 5 and back-off** to better tolerate registration spikes.
8. **Web Worker for `enhanceDocument`** to free the main thread on phone uploads.
9. **Bundle html5-qrcode locally** for clinic-offline resilience.
10. **OPD token printer integration test** — `printToken` uses `window.open` which is popup-blocker bait. Modern browsers may ignore the call; document the print-environment requirement.
11. **Make Neonatal section editable post-90-days** via a manual "Show neonatal details" link, so legacy preterm patients can have GA captured retroactively for corrected-age math.
12. **Replace `_searchResults` global** with an event-delegation pattern attaching click handlers in JS rather than `onclick="..."` — cleaner and removes a global.
13. **Lab `value_numeric` should use `Number.isFinite`-aware parsing** so true zeros survive.
14. **Verify.html should expire `?hash`** after a configurable window (e.g., reject hashes for prescriptions older than 1 year) to harden the public face.
15. **Audit-log integration.** Per spec §12.5, every INSERT/UPDATE on `patients` and `visits` should land in `audit_log` via a Postgres trigger. Currently absent.
16. **Pre-OCR call should defer until patient_id is known** OR should redact the image until then, to close the privacy hole flagged in Q9.
17. **Patient-lookup new-patient form parity.** Either remove the duplicate form (route to `registration.html`) or align field sets. The two diverge on ABHA, blood group, and visit creation.
18. **Vaccine-name canonicalisation table.** Persist a single source of truth for vaccine names so IAP "MMR" / NHM "MR" / OPD-card "MR/MMR" all reconcile.
19. **`addVaxRow` "Other" should prompt for a free-text name** and save it (after a pediatrics-team-approved whitelist), instead of silently dropping it.
20. **Generalize the registration form template literal** into smaller `renderSection*` functions; current 250-line literal is a hot spot for XSS regressions.

---

_End of registration & lookup system documentation._
