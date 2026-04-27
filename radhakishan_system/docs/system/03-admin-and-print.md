# 03 — Admin Tools and Print Station

**Scope.** This document covers the administrative surfaces that maintain the clinical knowledge base (formulary, standard prescription protocols) and the live Print Station that renders A4 prescriptions for the patient. Together these four pages constitute the read/write boundary between the clinical staff and the underlying Supabase tables that the prescription generator depends on.

| Page | Role | File | LOC |
| --- | --- | --- | --- |
| Print Station | Render and print today's approved prescriptions | `web/prescription-output.html` | 1074 |
| Formulary Manager | Edit drug entries (dosing bands, formulations, safety) | `web/formulary.html` | 3643 |
| Formulary Import | Bulk JSON upsert into `formulary` | `web/formulary-import.html` | 1552 |
| Standard Rx Manager | Edit ICD-10 keyed protocols | `web/standard-rx.html` | 1837 |

All four pages are self-contained single-file HTML applications, served from GitHub Pages, talking directly to Supabase via PostgREST with a hardcoded anon key. None of them require authentication today (POC); RLS uses a permissive `anon_full_access` policy.

---

## 1. Architectural Position

```
                  ┌──────────────────────────────────────┐
                  │          Supabase PostgREST          │
                  │   formulary │ standard_prescriptions │
                  │       │            │                 │
                  │   prescriptions ◄── Print Station    │
                  └──────────────────────────────────────┘
                          ▲             ▲             ▲
                          │             │             │
   Formulary Manager  Formulary Import  Standard Rx Mgr
        (edit)          (bulk upsert)         (edit)
                          │
                          ▼
              Prescription Pad (read-only consumer
              via preloadKnowledge / get_formulary tool)
                          │
                          ▼
            generate-prescription Edge Function
              (Claude with get_formulary,
               get_standard_rx tools)
                          │
                          ▼
              prescriptions table  ◄── Print Station
```

The two read consumers — the Prescription Pad and the `generate-prescription` Edge Function — both treat `formulary` and `standard_prescriptions` as a live source of truth. There is no separate publishing step or staging table. Edits made in the admin UIs become visible to the next prescription generation, in some cases the next REST call.

The Print Station is downstream: it reads only from `prescriptions` (filtered to today + approved), then renders the same `printRx()` HTML the Prescription Pad uses at sign-off.

---

## 2. Print Station — `web/prescription-output.html`

### 2.1 Purpose and load flow

The Print Station is the standalone surface staff use to physically print prescriptions on the A4 printer at the dispensary counter. The Prescription Pad opens the same printRx routine via `window.print()` at sign-off, but the Print Station exists so a clerk can:

- Re-print a Rx without going through the doctor's pad
- Print today's queue in batch
- Search a specific prescription by patient name / UHID / Rx UUID prefix

**Connect → load flow** (`connectAndLoad()`, line 903):

1. Health check: `GET /rest/v1/formulary?select=id&limit=1` — sets connection dot green/red and the `Connected` / `Connection failed` label.
2. `loadTodayRx()` — fetches today's approved prescriptions:
   ```
   GET /rest/v1/prescriptions
     ?select=id,patient_id,visit_id,generated_json,is_approved,created_at
     &is_approved=eq.true
     &created_at=gte.<todayISO>T00:00:00
     &order=created_at.desc
   ```
3. Enriches each row with patient name via a single batched lookup against `patients`:
   ```
   GET /rest/v1/patients?select=id,name&id=in.("uhid1","uhid2",...)
   ```
4. Populates a `<select>` dropdown in the toolbar with `<id-prefix> | <name> | <UHID> | <HH:MM>` per row.
5. Toast: `Loaded N prescription(s) for today`.

The loaded rows are held in two arrays:

- `allRxRows` — every row fetched (master list)
- `displayedRxRows` — the currently filtered subset (driven by the search box)

### 2.2 Search and filter

`filterRxList()` (line 990): client-side filter against `name`, `patient_id` (UHID), and the Rx UUID. If the filter narrows to exactly one match, the dropdown auto-selects index 0 and renders that prescription immediately. The search input has an `oninput` debounce-free handler — every keystroke filters the in-memory list, so it is O(N) per keystroke against today's prescriptions only (typically tens, not hundreds).

### 2.3 Render contract — `buildRxHtml()`

This is the most safety-critical function in the file (line 691). It mirrors the Prescription Pad's `printRx()` byte-for-byte so that a Rx printed from either surface looks identical. Sections rendered, in order:

1. **Header band** — Doctor block (left, 30%) · Hospital name + Hindi + NABH badge (centre, 40%) · Emergency contacts (right, 30%). Hardcoded to Dr. Lokender Goyal / Radhakishan Hospital, Kurukshetra.
2. **Info strip** — Date + time, Rx ID, UHID, ABDM check (when `patient.abha_number` is set).
3. **Meta row** — Patient · Age · Sex · Weight · Guardian.
4. **Chief complaints / History / Vitals / Examination** (skipped if absent).
5. **Provisional Diagnosis** — diagnosis name + ICD-10 in muted text.
6. **℞ Medicines** — the 4-row format. Row 1 is the medicine name in caps + concentration (royal blue), Row 2 is English dosing, Row 3 is Hindi (Devanagari font), with a right-side pictogram sidebar carrying inline SVG glyphs for time-of-day (morning/afternoon/evening/bedtime/PRN), dose form (pill/spoon/drop), duration in days, and food instruction (`भोजन के बाद` or `खाली पेट`).
7. **Non-pharmacological advice / IV fluids / Investigations** (red).
8. **Growth assessment / Vaccination / Neonatal / Developmental / Diet / Referral / Counselling.**
9. **Emergency warning signs** — the AI's `warning_signs` if present, otherwise the hardcoded `EMERGENCY_BASE` list combined with `EMERGENCY_INFANT` (when age < 12 months) or `EMERGENCY_CHILD` otherwise. Bilingual two-column grid.
10. **Follow-up / Admission.**
11. **Footer** — Doctor sign-off (digitally signed), safety summary (Allergy · Interactions · Max dose · NABH · ABDM), and a QR code.

### 2.4 QR code generation

The QR is generated by an external service (`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=…`) — **not** generated locally. The encoded payload is a verification URL constructed at render time:

```
<origin>/<path>/verify.html?rx=<uuid>&uhid=<UHID>&hash=<6-char SHA-256 prefix>&abha=<optional>
```

`hash` is the first 6 hex chars of `SHA-256(rxId + uhid + YYYY-MM-DD + "rkh-salt-2026")`, computed via the Web Crypto API. Note that the salt is hardcoded and the hash is short (24 bits), so the QR is a tamper-evidence aid for the patient, not a cryptographic proof.

### 2.5 Print contract

`@media print` (line 451):

- `.toolbar { display: none !important; }` hides the search bar so only the prescription is on paper.
- `@page { size: A4; margin: 12mm 10mm; }` matches the registration/pad layouts.
- `print-color-adjust: exact` to preserve the royal blue on medicines and the red on investigations.
- The `.rx-area` drops its shadow and box constraints when printing.

Click `Print` → browser opens its native print dialog. Click `Refresh` → re-runs `loadTodayRx()` to pick up Rx generated since page load (the page does not auto-poll).

### 2.6 Safety properties

- **XSS:** every dynamic value is wrapped in `esc()` (line 558), which uses `textContent` round-tripping. This is the only form of HTML safety; there is no Trusted Types / DOMPurify.
- **Trust boundary:** the page accepts `generated_json` verbatim. If a malformed Rx JSON is in the database, `JSON.parse` will throw; rendering falls back to the empty state via the catch in `loadTodayRx()`.
- **No edit path:** the Print Station is read-only. There is no PATCH or DELETE on `prescriptions` from this page.
- **No filter beyond today:** by design, only `created_at >= today 00:00 UTC` rows are loaded. A clerk cannot accidentally print yesterday's queue.
- **Pictogram fallbacks:** if `m.pictogram` is missing the row prints with no sidebar (the medicine text remains complete). A medicine without a pictogram still has correct row 1 / row 2 / row 3 content.

---

## 3. Formulary Manager — `web/formulary.html`

### 3.1 Purpose

The Formulary Manager is the row-level editor for the `formulary` table. Currently 680 drugs (454 SNOMED-branded, 158 SNOMED-generic, 68 orphan, plus any manual additions). Doctors and pharmacy staff use it to:

- View the full monograph for any drug
- Edit dosing bands, safety notes, administration instructions
- Add new drugs manually
- Trigger an AI-assisted lookup that pre-fills a draft drug entry

### 3.2 List view

`loadDrugs()` (line 1783) issues a single REST call:

```
GET /rest/v1/formulary?select=*&order=generic_name.asc&active=eq.true
```

All ~680 active drugs land in the `drugs[]` array client-side. The full payload (with `indian_brands`) is held in memory; this is roughly 5–7 MB. From this single fetch, `renderTable(data)` builds five columns:

| Column | Source |
| --- | --- |
| Drug | `generic_name`, `data_source` badge, `drug_class · category`, top 2 `brand_names`, licensing chip |
| Constituents | Aggregated `formulations[].ingredients[]` — single ingredient drugs show a one-liner; multi-ingredient FDCs show one row per ingredient with primary/non-primary bullets |
| Dosing | First three dosing bands, summarised. Excipients/vehicles/`data_error` units are deliberately filtered out so they don't crowd the column |
| Formulations | `form` + concentration (`125mg/5ml` style) green chip per formulation |
| Safety | Black box / contraindication count / Renal / Pediatric chips |

### 3.3 Filtering

Three independent filters can stack with the search box (`filterDrugs(q)`, line 2085):

- **Categories** — chip multi-select via datalist `dl-categories`. Uses `category.includes(c)` so a category with slashes (`Allergy / Pain`) matches both halves.
- **Drug classes** — same pattern, against `drug_class`.
- **Form** — single-select against any `formulations[].form`.
- **Search** — covers `generic_name`, `drug_class`, `brand_names[]`, `therapeutic_use[]`, plus a deeper search via `_drugMatchesBrandSearch` that walks `formulations[].indian_brands[]` (.name / .manufacturer / .trade_name).

`populateFilterDropdowns()` (line 2205) builds the datalists from the loaded drugs, with category counts shown in the option labels.

### 3.4 Drawer — view mode (read-only monograph)

`viewDrug(id)` (line 3363) saves the original edit-mode drawer body HTML (`_editBodyHtml`) and replaces both the tabs and the body with rendered monograph sections:

- **Identity** — Generic name, SNOMED CT code/display, drug class, category, data source badge, licensing flag, constituents table (all unique ingredients with their concentrations across all formulations), brand chips, therapeutic use chips, references.
- **Formulations** — One card per formulation: form + SNOMED dose form code + route + unit of presentation, indian conc note, ingredient table (Ingredient, SNOMED, Strength, Per, Basis), Indian brands list (first 5 visible + "Show N more" toggle).
- **Dosing** — Bands grouped by `indication`. Per band, a 10-column table: Age, Method, Dose, Freq, Duration, Max single, Max daily, Loading, Round, Notes. When `ingredient_doses[]` is present each ingredient gets its own row with a star marker for the limiting ingredient.
- **Safety** — Black box (red cards), contraindications, drug interactions table, pediatric warnings, renal bands table, hepatic note, monitoring parameters.
- **Admin** — Per-route administration cards (route, instruction, reconstitution, dilution, infusion rate, compatibility, storage), top-level food and storage, pregnancy category, lactation note.

The save button is hidden in view mode. `closeDrawer()` calls `exitViewMode()` which restores the original edit body HTML — this is important: the edit drawer's DOM (with all its `bandCnt`, `intCnt` counters and onclick handlers) survives the view round-trip without being torn down.

### 3.5 Drawer — edit mode

5 tabs, all writing into the same JSON payload in `saveDrug()`:

| Tab | Inputs | Maps to |
| --- | --- | --- |
| 0. Identity | Name, drug_class, category (drug-class or specialty optgroup), licensed, brands (CSV), therapeutic uses (tag input), unlicensed note, pregnancy, lactation, lactation note, SNOMED code/display | `generic_name`, `drug_class`, `category`, `licensed_in_children`, `brand_names[]`, `therapeutic_use[]`, `unlicensed_note`, `pregnancy_category`, `lactation_safe`, `lactation_note`, `snomed_code`, `snomed_display` |
| 1. Formulations | **Read-only.** The page renders the current `formulations[]` from the database; there is no UI to add/edit them | `_editFormulations` is preserved and emitted unchanged in `getForms()` (line 2334). Formulations must be edited via the import page or SNOMED extraction scripts |
| 2. Dosing bands | Per-band: indication, age band, calculation method (with explanatory help text per method), per-day vs per-dose, frequency or interval, duration + note, loading dose, rounding rule, band notes, and an `ingredient_doses[]` sub-form (collapsible per ingredient: name, SNOMED, limiting flag, dose min/max + unit, max single mg, max daily mg, source) | `dosing_bands[]` |
| 3. Safety | Black box (tags), contraindications (tags), cross-reactions (tags), interactions (drug, severity, effect rows), monitoring parameters (tags), pediatric warnings (tags), renal adjustment required + GFR bands (gfr_min, gfr_max, action, note rows), hepatic adjustment required + note | `black_box_warnings[]`, `contraindications[]`, `cross_reactions[]`, `interactions[]`, `monitoring_parameters[]`, `pediatric_specific_warnings[]`, `renal_adjustment_required`, `renal_bands[]`, `hepatic_adjustment_required`, `hepatic_note` |
| 4. Admin & notes | Administration rows (route, instruction, reconstitution, dilution, infusion rate, compatibility, storage), top-level food and storage instructions, prescriber notes, primary reference (CSV), last reviewed date | `administration[]`, `food_instructions`, `storage_instructions`, `notes`, `reference_source[]`, `last_reviewed_date` |

The dosing-band sub-form preserves any fields not exposed in the UI (`ga_weeks_min`, `ga_weeks_max`, `loading_dose_basis`, `maintenance_dose_qty`, `maintenance_dose_unit`) by storing them as a JSON string on `el.dataset.extra` when the band is loaded, then merging them back in `getBands()` (line 2632). This is the only mechanism that prevents the editor from silently destroying schema fields it doesn't render.

### 3.6 Save and delete semantics

`saveDrug()` (line 2865) emits a single payload covering all five tabs, then either:

- **Edit:** `PATCH /rest/v1/formulary?id=eq.<id>` — full-row replace of the listed columns. Columns not in the payload are not updated.
- **Add:** `POST /rest/v1/formulary` with `Prefer: return=representation` and `active: true`.

Both paths set `updated_at = now()` from the client; the server-side `trg_formulary_updated` trigger also updates it.

`deleteDrug(id)` (line 2936) is a **soft delete only** — `PATCH active=false`. There is no hard delete. The list view's `active=eq.true` filter hides the row but the data and any FK references survive. This is significant for the `prescriptions.fhir_bundle` history: a Rx generated before a drug was retired will still resolve correctly via direct ID lookup.

### 3.7 AI lookup — `aiDrugLookup()`

Line 3501. Sends `{ drug_name }` to the `ai-drug-lookup` Edge Function, which uses Claude to research the drug and return a fully populated payload. Two modes:

- **Add mode:** the function checks for duplicates against the loaded `drugs[]` array, stripping common salt suffixes (MALEATE / SULPHATE / HYDROCHLORIDE / SODIUM …) before comparison. If a near-match is found, the user is prompted (OK = update existing, Cancel = add as new entry). Duplicate hit flips `editId` to the existing drug's id so the next save becomes a PATCH.
- **Edit mode:** the AI's output is loaded into the drawer to enrich the existing drug; the editId is preserved.

The salt-stripping regex catches 26 common Indian-pharmacopoeia salts. A drug whose generic name contains a salt not in this list will show as a "new" entry.

### 3.8 Concurrency and live-edit hazard

**No locking, no last-write-wins detection.** Two doctors editing the same drug simultaneously will race on PATCH; the second save silently overwrites the first. There is no `If-Match` / ETag header sent by the client and no version column in the schema (only `updated_at`).

**Read-during-write hazard (live concern):**

- The Prescription Pad's `preloadKnowledge()` runs on page load and caches the formulary client-side in `formularyCache`. A drug edited mid-session is **not** picked up — the doctor at the pad sees the old dosing bands until they reload the page.
- The Edge Function's `get_formulary` tool issues a fresh REST call on every prescription generation. This means: any save in the formulary manager is reflected in the **next AI-generated prescription** (not the next manual edit on the pad).
- The Edge Function's tool fetches `formulations`, `dosing_bands`, `interactions`, `contraindications`, `cross_reactions`, `black_box_warnings`, `pediatric_specific_warnings`, `monitoring_parameters`, `renal_bands`, `administration`, `food_instructions`, `notes`, `snomed_code`, `snomed_display`, `brand_names`. So a save that changes any of these fields propagates to AI generation immediately.

**Mitigation in practice:** the editing surface is currently used by 1–2 admins offline (after OPD hours). There is no formal lock; the convention is that nobody edits a drug while a prescription is being generated for it.

### 3.9 Validation gaps to be aware of

- **Dosing bands without `ingredient_doses[]` are silently dropped** by `getBands()` (line 2635): the filter `b.ingredient_doses.length > 0 || b.indication` keeps only bands with either ingredient doses or an indication. A band with neither is removed on save.
- **No required-field enforcement** beyond `generic_name`. Every other field can be blank.
- **No schema validation** on dose units, GFR ranges, age bands. The CHECK constraints on the table are limited to JSONB-array shape, not content.
- **`category` is free text** in the database but the UI exposes only a fixed set of options. Imported drugs may have categories that don't appear in the dropdown — they will display correctly but the dropdown will start blank when editing.

---

## 4. Standard Rx Manager — `web/standard-rx.html`

### 4.1 Purpose

Edits the `standard_prescriptions` table (24+ ICD-10 keyed protocols today). Each protocol becomes the AI's first-line skeleton for a given diagnosis: when the AI calls `get_standard_rx(icd10="H66.0")` and gets a hit, it pre-populates `first_line_drugs`, `investigations`, `counselling`, and `warning_signs` from this row.

### 4.2 List view

`load()` (line 1278):

```
GET /rest/v1/standard_prescriptions?select=*&order=diagnosis_name.asc&active=eq.true
```

Render columns: ICD-10 chip, diagnosis name + category + severity, first-line drug chips (drug name only), default duration, source badge, edit/delete actions.

### 4.3 Filters

- **Search box** — substring match on `diagnosis_name` + `icd10`.
- **Category chips** — fixed list of 16 categories (Respiratory, ENT, GI, Infectious, Neurological, Neonatology, Endocrine, Emergency, Haematology, Cardiovascular, Renal, Skin, Surgical, Developmental, Rheumatology, plus "All").

### 4.4 Drawer — 5 tabs

| Tab | Inputs | Maps to |
| --- | --- | --- |
| 0. Diagnosis | ICD-10 (with autocomplete from a hardcoded `ICD10[]` list of ~40 common pediatric diagnoses), diagnosis name, category, severity, default duration, guideline source, last reviewed, SNOMED code | `icd10`, `diagnosis_name`, `category`, `severity`, `duration_days_default`, `source`, `last_reviewed_date`, `snomed_code` |
| 1. First-line drugs | Per drug: drug name (must match `formulary.generic_name`), route, dose qty / unit / basis (per_kg / per_m2 / per_dose), per_day vs per_dose, frequency, duration, notes | `first_line_drugs[]` (note: the actual data convention is `{drug, notes, is_new_2024_2025}` — the structured fields are emitted by this UI but the existing JSON imports use the simpler form; the AI tolerates both) |
| 2. Alternatives | Same shape as first-line | `second_line_drugs[]` |
| 3. Investigations | Per investigation: name, indication, urgency (same-day / routine / urgent) | `investigations[]` |
| 4. Guidance | Counselling (tags), warning signs (tags, English; AI translates to Hindi at print time), referral criteria (textarea), hospitalisation criteria (textarea), prescriber notes, expected course, key clinical points (tags), severity assessment (mild/moderate/severe inputs), monitoring parameters (tags) | `counselling[]`, `warning_signs[]`, `referral_criteria`, `hospitalisation_criteria`, `notes`, `expected_course`, `key_clinical_points[]`, `severity_assessment`, `monitoring_parameters[]` |

`save()` (line 1613): PATCH for edit, POST with `active: true` for add. Validates only `icd10` and `diagnosis_name` as required.

### 4.5 ICD-10 autocomplete

`searchICD()` (line 1343) does substring match against the `ICD10[]` constant (40 entries hardcoded in the page, lines 1075–1226). Selecting an entry auto-fills name + category. The list is curated; an ICD-10 not in this list can still be typed manually.

### 4.6 AI lookup — `aiProtocolLookup()`

Line 1724. Sends `{ diagnosis, icd10 }` to the `ai-protocol-lookup` Edge Function; same add/edit duplicate handling as the formulary AI lookup. The Edge Function validates 16 valid categories (slightly different list than the UI: it includes Allergy, Musculoskeletal, Ophthalmology) and returns `_warnings` for any validation issues.

### 4.7 Live-edit hazard

Same shape as the formulary:

- `preloadKnowledge()` on the Prescription Pad caches `stdRxCache` keyed by both `icd10` and `diagnosis_name` (uppercased). Edits don't propagate until the pad is reloaded.
- The Edge Function's `get_standard_rx` tool fetches fresh on every generation, so a saved protocol is visible to the next AI-generated prescription.

### 4.8 Soft delete

`del(id)` (line 1688) — same pattern as the formulary: `PATCH active=false`. Hidden from list view but preserved.

---

## 5. Formulary Import — `web/formulary-import.html`

### 5.1 Purpose

Bulk JSON ingest into the `formulary` table. Used to seed the database from `formulary_data_ABDM_FHIR*.json` exports and to onboard ad-hoc drug lists from external sources (MIMS, IAP, BNFC). Not used during steady-state operation — once 680 drugs are loaded, this page is rarely opened.

### 5.2 4-step UX

1. **Connect** — auto-connects with the hardcoded credentials. The Step-1 form is hidden by default.
2. **Paste JSON** — textarea accepts an array of drugs. Field names are flexible — the importer accepts ~30 different keys per field.
3. **Preview** — `parseJSON()` (line 600) maps each drug via `mapDrug()` (line 643), classifies as valid (has a generic name) / invalid, shows a table with name / category / dosing summary / formulations summary / status. Invalid rows are highlighted red and will be skipped.
4. **Import** — `importDrugs()` (line 1026) batches in chunks of 50, posting to:
   ```
   POST /rest/v1/formulary
   Prefer: return=representation,resolution=merge-duplicates
   ```
   Progress bar updates per chunk; success/error logged in a Courier-styled console box.

### 5.3 Field mapping

`mapDrug(d, idx)` (line 643) tries multiple aliases per logical field. Examples:

| Logical field | Accepted aliases |
| --- | --- |
| Generic name | `generic_name`, `name`, `drug_name`, `drug`, `generic`, `medicine_name`, `GENERIC_NAME`, `NAME` |
| Drug class | `drug_class`, `class`, `pharmacological_class`, `type`, `drug_type`, `classification` |
| Category | `category`, `drug_category`, `group`, `therapeutic_class` (run through `mapCategory()` to canonicalise to one of 18 standard buckets) |
| Brands | `brand_names`, `brands`, `brand`, `trade_names`, `trade_name`, `indian_brands` |
| Dose | `dose`, `dosage`, `dose_range`, `standard_dose`, `pediatric_dose`, `dose_mg_kg` (parsed via `parseDoseString()`) |
| Formulations | `formulations`, `formulation`, `forms`, `available_forms`, `preparations` |

`parseDoseString()` (line 840) understands strings like `"40-90 mg/kg/day ÷ 3"`, `"15 mg/kg/dose q6h"`, `"400mg single dose"` — extracting dose min/max, unit, frequency, BSA flag.

`parseFormString()` (line 881) understands strings like `"Syrup 125mg/5ml"`, `"Tab 500mg"` — extracting form, route, concentration.

If `formulations` is missing entirely, the importer synthesises a minimal one from flat `concentration`/`form` fields, so even a sparse drug entry round-trips into the FHIR-aligned schema.

### 5.4 Dedupe — `resolution=merge-duplicates`

The PostgREST `Prefer: resolution=merge-duplicates` header combined with the `UNIQUE (generic_name)` constraint means: an existing row with the same `generic_name` is **upserted**, not duplicated. Behaviour:

- **Conflicting row exists** → the row is updated with the new payload (full replace of provided columns).
- **No conflict** → a new row is inserted with `active: true`.

`generic_name` is uppercased at parse time (`.toUpperCase()` in line 673) so the dedupe is case-insensitive in practice as long as the source data is consistent.

The importer **does not** preserve fields that aren't in the new payload — a re-import of a sparse JSON will overwrite the rich existing entry with the sparse one. This is why the recommended pipeline is to always import via the curated `formulary_data_ABDM_FHIR*.json` files, not arbitrary lists.

### 5.5 Columns the importer writes

Every column listed in `formulary_database_spec.md §1` except: `id`, `created_at`, `updated_at`, `data_source` (defaults to `manual` when not provided), and `active` (always set to `true`). Fields the importer does not understand are dropped silently — there is no `notes` overflow column for unrecognised input fields, despite the format reference card claiming otherwise.

### 5.6 Validation

- `_valid` flag is set per drug; only `_valid` drugs are sent on import.
- Rows without a generic name are flagged invalid and skipped.
- No JSONB-shape validation client-side; the database CHECK constraints catch malformed `formulations` / `dosing_bands` / etc and the batch fails. On batch failure all 50 drugs in the chunk are reported failed (the importer does not retry one-by-one on chunk failure today, despite the description in earlier versions).

---

## 6. Cross-cutting concerns

### 6.1 Authentication and RLS

All four pages use the **anon key** hardcoded in the file:

```js
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";
```

The RLS policies on `formulary`, `standard_prescriptions`, `prescriptions`, `patients` all permit the anon role full read/write (`anon_full_access` or `authenticated_full_access` for standard_prescriptions). This is a deliberate POC choice; it means **anyone with the URL can edit the formulary** unless network access is restricted. There is no audit trail of who edited what.

### 6.2 XSS surface

Every page wraps user-controlled values in an `esc()` function that uses `document.createElement('div')` + `textContent` to neutralise HTML. This is applied consistently across all `innerHTML` assignments. Failure modes I noticed while reading:

- The `viewDrug` brand-list "Show N more" toggle puts the random-generated `hiddenId` directly into a DOM attribute — safe because it's hex.
- The `selectICD()` callback inlines the diagnosis name into a `onclick` string with `replace(/'/g, "\\'")`; double-quote escapes are not handled but the data source is the curated `ICD10[]` constant.

### 6.3 Numeric and unit invariants

Neither admin tool enforces:

- That `dose_min_qty <= dose_max_qty`.
- That `gfr_min < gfr_max`.
- That `ga_weeks_min <= ga_weeks_max`.
- That `max_single_qty < max_daily_qty`.
- That dose units in `dosing_bands` align with formulation strength units.

The dose engine and the AI rely on the data being well-formed. A typo here can produce a clinically wrong dose.

### 6.4 What admin tools cannot do

- **Cannot edit `formulations[]`** in the formulary UI (read-only display). Formulation edits require the import page or running a SNOMED extraction script.
- **Cannot delete prescriptions** from the Print Station. (The pad has no UI to delete past Rx either; there is no delete-Rx flow anywhere in `web/`.)
- **Cannot publish/unpublish.** A drug or protocol is either `active=true` (live) or `active=false` (soft-deleted). There is no draft/published distinction.
- **Cannot add audit comments.** No history table; only `updated_at` is preserved.

---

## 7. Failure modes worth documenting

| Failure | Surface | What happens |
| --- | --- | --- |
| Concurrent edit collision | Formulary / Standard Rx | Last PATCH wins silently. No warning. |
| Bad JSON in `prescriptions.generated_json` | Print Station | `JSON.parse` throws inside `renderRx`. The `<select>` still shows the bad row, but selecting it does nothing visible (no error toast — the catch is in `loadTodayRx`, not in `renderRx`). |
| Drug renamed mid-session on pad | Prescription Pad | Old name in `formularyCache` → AI receives stale band. Fixed by reloading the pad. |
| Mass import with overlapping `generic_name` | Formulary Import | Existing rich entry is overwritten by the sparse new entry. |
| Soft-deleted drug referenced by past Rx | Print Station | Past Rx renders correctly (the JSON snapshots the dosing at sign-off time). New AI prescription cannot use the drug (filter is `active=eq.true`). |
| Anon key compromised | All four pages | Attacker can rewrite the formulary. No mitigation in place beyond not publishing the URL externally. |
| `created_at` timezone skew | Print Station | The "today" filter uses the server's UTC clock with `todayISO`. A Rx created at 23:30 IST falls into the next UTC day and won't appear in tomorrow's print queue until tomorrow 05:30 IST. |

---

## 8. Files referenced

- `web/prescription-output.html` (1074 lines) — Print Station
- `web/formulary.html` (3643 lines) — Formulary Manager
- `web/formulary-import.html` (1552 lines) — Bulk import
- `web/standard-rx.html` (1837 lines) — Standard Rx Manager
- `radhakishan_system/docs/database/formulary_database_spec.md` — Schema and API for `formulary`
- `radhakishan_system/docs/database/standard_prescriptions_spec.md` — Schema and API for `standard_prescriptions`
- `radhakishan_system/docs/formulary/dose-calculation-system.md` — FHIR R4 / ABDM-aligned ingredient-level dose model that the formulary's `ingredient_doses[]` sub-form maps to
- `supabase/functions/generate-prescription/index.ts` — Consumer of `formulary` and `standard_prescriptions` via tool_use loop
- `supabase/functions/ai-drug-lookup/index.ts` — Backs the formulary AI Lookup button
- `supabase/functions/ai-protocol-lookup/index.ts` — Backs the standard-rx AI Lookup button
- `radhakishan_system/scripts/import_formulary_abdm.js` — Server-side equivalent of the formulary import flow
- `radhakishan_system/schema/radhakishan_supabase_schema.sql` — Source of truth for table DDL and CHECK constraints
- `radhakishan_system/schema/abdm_schema.sql` — Adds `snomed_code`, `snomed_display`, `data_source` columns

---

## 9. Hard-coded constants worth knowing

- **Hospital identity** (Print Station, lines 707–712): Dr. Lokender Goyal, MD Pediatrics (PGI Chandigarh), HMC HN 21452 · PMC 23168, Radhakishan Hospital, Jyoti Nagar, Kurukshetra; Emergency 01744-251441 / 01744-270516 / 7206029516. Changing the doctor or hospital requires editing this file and the Prescription Pad's `printRx` in tandem.
- **QR salt** (Print Station, line 870): `"rkh-salt-2026"`. The hash uses 6 hex chars (24 bits).
- **Emergency warning signs** (Print Station, lines 573–604): Three lists — `EMERGENCY_BASE` (6 signs, all ages), `EMERGENCY_INFANT` (4 signs, < 12 months), `EMERGENCY_CHILD` (4 signs, ≥ 12 months). Used as the bilingual fallback when the AI does not provide `warning_signs`.
- **ICD-10 picker list** (Standard Rx, lines 1075–1226): 40 hardcoded common pediatric diagnoses for the autocomplete. Editing this list does not affect the database.
- **Drug class category buckets** (Formulary, dropdown lines 1241–1276): Two optgroups — drug class (13 options) and clinical specialty (17 options). Imported drugs may have categories outside this list.
- **Salt-strip regex** (Formulary AI lookup, line 3543): 26 common Indian-pharmacopoeia salts.

---

## 10. Hand-off notes for future maintainers

- The Print Station and the Prescription Pad's `printRx` are duplicate render code. **Any change to one must be made to the other.** A single rendering library would be ideal but the self-contained-HTML constraint argues against it.
- The Formulary's view-mode → edit-mode toggle is fragile: it stashes the entire drawer body HTML in `_editBodyHtml` and restores it on close. If the edit drawer DOM changes elsewhere (for instance, if a band was added in view mode — which can't happen today, but might in future), the restored DOM will not reflect that change.
- **Adding a new column to `formulary`:** 4 places to update — DDL, `import_formulary_abdm.js`, `formulary.html` (read in `populate`, write in `saveDrug`, render in `renderTable` and the view-mode renderers), and `generate-prescription/index.ts` (`condenseDrugForAI` keep/strip list).
- **Adding a new column to `standard_prescriptions`:** 3 places — DDL, `standard-rx.html` (`populate`, `save`, `render`), and `generate-prescription/index.ts` (the `select=` clause in `executeGetStandardRx`).
- The Print Station does **not** need redeploying when the prescription JSON shape changes — it only needs the Pad's `printRx` to keep emitting that shape. But every new field needs both surfaces updated to render it.
