# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-assisted pediatric OPD prescription system for Radhakishan Hospital (NABH accredited), Kurukshetra, Haryana. Standalone web app hosted on GitHub Pages, backed by Supabase (PostgreSQL + Edge Functions + Storage). Prescription generation uses Claude API with tool_use for progressive disclosure of clinical knowledge.

## Architecture

```
Web App (GitHub Pages: rx.radhakishanhospital.com)
  ├── Registration Page → Supabase (patients, visits)
  ├── Prescription Pad → Supabase Edge Function (generate-prescription)
  │                       ├── Loads core_prompt.md from Storage
  │                       ├── Claude API with 5 tools:
  │                       │   ├── get_reference(name) → Storage .md files
  │                       │   ├── get_formulary(drug_names) → Supabase REST
  │                       │   ├── get_standard_rx(icd10, name) → Supabase REST
  │                       │   ├── get_previous_rx(patient_id) → PII-stripped past Rx
  │                       │   └── get_lab_history(patient_id) → Recent lab results with flags
  │                       └── Returns prescription JSON
  ├── Registration → Edge Function (generate-visit-summary)
  │                  └── AI clinical summary for returning patients
  ├── Print Station → Supabase (today's approved Rx) → Print (A4 with QR)
  └── Patient Lookup → Supabase
```

Supabase credentials (URL + anon key) are hardcoded in all pages. Auto-connect on page load. No manual configuration needed.

## Repository Structure

- **`web/`** — 8 HTML files deployed to GitHub Pages (the live app):
  - `index.html` — Landing page with navigation cards
  - `registration.html`, `prescription-pad.html`, `prescription-output.html` (Print Station), `patient-lookup.html`, `formulary.html`, `formulary-import.html`, `standard-rx.html`

- **`radhakishan_system/skill/`** — AI prompt system (progressive disclosure):
  - `radhakishan_prescription_skill.md` — Original full skill (933 lines, reference artifact — NOT used at runtime)
  - `core_prompt.md` — Lean core prompt (~250 lines) loaded every API call
  - `references/` — 11 clinical reference files fetched on-demand by Claude via tools
  - `examples/worked_example.md` — Complete Arjun AOM case
  - All skill files also uploaded to Supabase Storage (`website/skill/` prefix)

- **`supabase/functions/generate-prescription/`** — Edge Function (Deno/TypeScript) with tool_use loop (5 tools: `get_reference`, `get_formulary`, `get_standard_rx`, `get_previous_rx`, `get_lab_history`)
- **`supabase/functions/generate-visit-summary/`** — Edge Function: AI clinical summary for returning patients at registration
- **`supabase/functions/generate-fhir-bundle/`** — Edge Function: ABDM FHIR R4 Bundle generator (OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord)
- **`supabase/functions/abdm-identity/`** — Edge Function: ABHA verify, create, Scan & Share
- **`supabase/functions/abdm-hip-*/`** — 4 Edge Functions: HIP callbacks (discover, link, consent, data-transfer)
- **`supabase/functions/abdm-hiu-*/`** — 2 Edge Functions: HIU services (consent-request, data-receive)

- **`radhakishan_system/schema/`** — Supabase DDL: `radhakishan_supabase_schema.sql` (base, 10 tables) + `abdm_schema.sql` (ABDM extension)
- **`radhakishan_system/data/`** — 530 drugs + 446 diagnosis protocols (JSON) + LOINC/SNOMED mappings
- **`radhakishan_system/scripts/`** — Node.js import scripts + `create_sample_data.js` (20 patients, 20 visits, 8 with past Rx history; auto-scrubs and reseeds)
- **`radhakishan_system/docs/`** — Specification, setup guide, clinical rules, code review issues

- **`.github/workflows/deploy-pages.yml`** — GitHub Actions deploys `web/` to GitHub Pages
- **`web/CNAME`** — Custom domain: `rx.radhakishanhospital.com`

## Workflow (3-Stage)

1. **Reception** (Registration page): Sticky header with search + Scan QR + Clear Form. Register patient → capture demographics, allergies → structured lab entry (COMMON_LABS: 39 pediatric tests in 4 categories — Hematology, Biochemistry, Microbiology, Imaging — with auto-unit and auto-flag, saved to `lab_results`; returning patients see previous results as read-only pills) → smart neonatal section (hidden by default, auto-shows when DOB < 90 days, fields: GA, birth weight, time of birth) → smart IAP vaccination checklist (IAP_SCHEDULE: 13 milestones birth–12yr, age-based display, pre-checks existing records, OVERDUE labels) → enter external records (free-text + document uploads to `documents` bucket) → create visit with vitals + chief complaints → AI visit summary generated for returning patients (stored in `visits.visit_summary`). Section order: Demographics → Visit Details → Chief Complaints → Neonatal → Allergies → Vitals → Vaccination → Labs → Documents.
2. **Nurse station** (same page): Weight, height, HC, MUAC, temp, HR, RR, SpO2
3. **Doctor OPD** (Prescription Pad): Search patient in combo box (name/UHID/guardian/token) → view nurse-captured data + visit summary + growth trends (loadGrowthTrend: weight/height history with trend arrows + WAZ) + recent labs (loadRecentLabs: flagged results from lab_results table) + vaccination status (loadVaxStatus: dose count summary) → select NHM or IAP vaccination schedule → review previous Rx history tabs → type/dictate clinical note (auto-saves to `visits.raw_dictation` with debounce; save indicator in tab bar) → click Generate → Edge Function calls Claude (5-tool loop incl. get_lab_history) → prescription renders → review, edit → sign off (saves vaccinations given_today) → print auto-opens. Re-selecting a "done" patient auto-loads their saved prescription (read-only).

## Supabase Schema (12 Tables)

| Table                           | Purpose                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `formulary`                     | 530 drugs with JSONB: formulations, dosing_bands, renal_bands, interactions. UNIQUE on generic_name. + snomed_code   |
| `doctors`                       | Seeded with Dr. Lokender Goyal. + hpr_id (Health Professional Registry)                                              |
| `standard_prescriptions`        | 446 ICD-10 keyed protocols with first_line_drugs, investigations. + snomed_code                                      |
| `patients`                      | Demographics, UHID (RKH-YYMM#####), known_allergies text[], is_active. + ABHA fields (abha_number, abha_verified)    |
| `visits`                        | Per-visit vitals, diagnoses, clinical notes, raw_dictation (auto-saved), visit_summary (AI). NOT NULL on patient_id. |
| `prescriptions`                 | Generated Rx JSON, approval status, fhir_bundle (JSONB). NOT NULL on visit_id + patient_id.                          |
| `vaccinations`                  | Per-patient vaccination history (IAP 2024 + NHM-UIP)                                                                 |
| `growth_records`                | WHO Z-scores (WAZ, HAZ, WHZ, HCZ)                                                                                    |
| `lab_results`                   | Structured lab results: test_name, value, unit, flag, test_category. + loinc_code, snomed_code                       |
| `developmental_screenings`      | Assessments by domain                                                                                                |
| `abdm_care_contexts`            | ABDM care context tracking: links visits/prescriptions to ABDM for health record sharing (HIP)                       |
| `abdm_consent_artefacts`        | ABDM consent artefacts: patient consent for health data sharing (HIP/HIU)                                            |
| Storage: `website` bucket       | Skill files (.md) + web pages                                                                                        |
| Storage: `prescriptions` bucket | Prescription text files                                                                                              |
| Storage: `documents` bucket     | Uploaded external records (lab reports, imaging, discharge summaries, etc.)                                          |

RLS enabled with anon_full_access policy for POC. ON DELETE RESTRICT. CHECK constraints on medical ranges.

## Key Domain Rules (Critical When Editing)

- **4-row medicine format**: Row 1 = GENERIC NAME IN CAPS (concentration), Row 2 = English dosing, Row 3 = Hindi (Devanagari), Row 4 = Pictogram sidebar (SVG icons for dosing schedule). All in Royal Blue.
- **Medication pictograms**: Compact right-side sidebar with inline SVG time-of-day icons (sunrise/sun/sunset/moon), dose quantity icons (pills/spoon/drops), duration + food instructions in Hindi.
- **Colour coding**: Blue = medicines, Red = investigations, Black = everything else.
- **6 dosing methods**: Weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier. NEVER exceed max dose.
- **Rounding**: Syrups → 0.5ml, drops → 0.1ml, tablets → ¼ tab.
- **Preterms**: CORRECTED age for growth/development, CHRONOLOGICAL age for vaccinations. Neonatal chip auto-activates for age < 90d, GA < 37wk, BW < 2.5kg.
- **Vaccination**: Split "NHM Vacc." / "IAP Vacc." buttons (mutually exclusive, neither pre-selected). Haryana: PCV + Rotavirus free, no JE.
- **Safety checks**: allergy_note, interactions, per-medicine max_dose_check, overall_status (SAFE/REVIEW REQUIRED).
- **NABH compliance**: Mandatory on every prescription. Claude always fetches nabh_compliance reference.
- **ICD-10 primary**: Standard prescription lookup uses ICD-10 code first, diagnosis name as fallback.
- **Sticky headers**: All pages use `position:sticky` headers — home page header, registration header bar (search + buttons), prescription pad hospital header + tabs bar, print station toolbar.
- **Print layout**: Comfortable spacing — page margins 12mm 10mm, body font 12px, line-height 1.5, section margins 10px, medicine font r1 14px / r2-r3 12px, emergency grid 2 columns. Hospital name "Radhakishan Hospital" centered in print header (.hdr-l/.hdr-r 30% + .hdr-c 40% centered).
- **Auto-save notes**: Doctor's note auto-saves to `visits.raw_dictation` (debounced 3s + every 30s). Save indicator in tab bar: "Editing..." → "Saving..." → "Saved HH:MM" → "Save failed".
- **Print Station**: Prescription Output is a standalone print station — auto-loads today's approved Rx from Supabase, search/filter by patient name/UHID/Rx ID, renders identical output to Prescription Pad's printRx().
- **XSS protection**: `esc()` function on every dynamic innerHTML value.
- **Patient IDs**: Format RKH-YYMM##### (Indian financial year).
- **QR code payload**: Minimal re-registration data (UHID, name, DOB, sex initial).

## Working with Web Pages

Each page is a single self-contained HTML file with inline CSS and JavaScript. They use:

- `fetch()` for Supabase REST API calls (anon key hardcoded)
- Web Speech API for voice dictation (Chrome only, `en-IN` locale)
- CDN libraries: html5-qrcode (QR scanning), Noto Sans Devanagari (Hindi font)
- Inline SVG for medication pictograms (no external images)
- Browser print API for A4 output with `@page` rules and comfortable spacing

When editing, maintain the self-contained nature. Edit files directly in `web/`. All dynamic data must be wrapped in `esc()` before innerHTML insertion.

## Deployment

- **Web app**: Push to `main` → GitHub Actions deploys `web/` to GitHub Pages
- **Edge Functions**: `npx supabase functions deploy <name> --project-ref ecywxuqhnlkjtdshpcbc`
  - Core: `generate-prescription`, `generate-visit-summary`
  - ABDM: `generate-fhir-bundle`, `abdm-identity`, `abdm-hip-discover`, `abdm-hip-link`, `abdm-hip-consent`, `abdm-hip-data-transfer`, `abdm-hiu-consent-request`, `abdm-hiu-data-receive`
- **Schema migrations**: `npx supabase db query --linked -f <file.sql>`
- **Skill files**: Upload to Supabase Storage `website/skill/` prefix (cached by Edge Function)
- **Secrets**: `ANTHROPIC_API_KEY` set via `supabase secrets set`. ABDM: `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET`, `ABDM_GATEWAY_URL`
