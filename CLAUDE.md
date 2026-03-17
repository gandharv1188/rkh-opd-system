# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-assisted pediatric OPD prescription system for Radhakishan Hospital (NABH accredited), Kurukshetra, Haryana. Standalone web app hosted on GitHub Pages, backed by Supabase (PostgreSQL + Edge Functions + Storage). Prescription generation uses Claude API with tool_use for progressive disclosure of clinical knowledge.

## Architecture

```
Web App (GitHub Pages: rx.radhakishanhospital.com)
  ├── Registration Page → Supabase (patients, visits)
  ├── Prescription Pad → Supabase Edge Function
  │                       ├── Loads core_prompt.md from Storage
  │                       ├── Claude API with 3 tools:
  │                       │   ├── get_reference(name) → Storage .md files
  │                       │   ├── get_formulary(drug_names) → Supabase REST
  │                       │   └── get_standard_rx(icd10, name) → Supabase REST
  │                       └── Returns prescription JSON
  ├── Prescription Output → Print (A4 with QR)
  └── Patient Lookup → Supabase
```

Supabase credentials (URL + anon key) are hardcoded in all pages. Auto-connect on page load. No manual configuration needed.

## Repository Structure

- **`web/`** — 8 HTML files deployed to GitHub Pages (the live app):
  - `index.html` — Landing page with navigation cards
  - `registration.html`, `prescription-pad.html`, `prescription-output.html`, `patient-lookup.html`, `formulary.html`, `formulary-import.html`, `standard-rx.html`

- **`radhakishan_system/artifacts/`** — 7 source HTML files (canonical versions, copied to `web/` on deploy)

- **`radhakishan_system/skill/`** — AI prompt system (progressive disclosure):
  - `radhakishan_prescription_skill.md` — Original full skill (933 lines, reference artifact — NOT used at runtime)
  - `core_prompt.md` — Lean core prompt (~250 lines) loaded every API call
  - `references/` — 11 clinical reference files fetched on-demand by Claude via tools
  - `examples/worked_example.md` — Complete Arjun AOM case
  - All skill files also uploaded to Supabase Storage (`website/skill/` prefix)

- **`supabase/functions/generate-prescription/`** — Edge Function (Deno/TypeScript) with tool_use loop

- **`radhakishan_system/schema/`** — Supabase DDL (10 tables)
- **`radhakishan_system/data/`** — 530 drugs + 446 diagnosis protocols (JSON)
- **`radhakishan_system/scripts/`** — Node.js import scripts
- **`radhakishan_system/docs/`** — Specification, setup guide, clinical rules, code review issues

- **`.github/workflows/deploy-pages.yml`** — GitHub Actions deploys `web/` to GitHub Pages
- **`web/CNAME`** — Custom domain: `rx.radhakishanhospital.com`

## Workflow (3-Stage)

1. **Reception** (Registration page): Register patient → capture demographics, allergies → create visit with vitals + chief complaints
2. **Nurse station** (same page): Weight, height, HC, MUAC, temp, HR, RR, SpO2
3. **Doctor OPD** (Prescription Pad): Select patient from today's dropdown → view nurse-captured data → type/dictate clinical note → click Generate → Edge Function calls Claude (tool_use loop) → prescription renders → review, edit → sign off → print auto-opens

## Supabase Schema (10 Tables)

| Table                           | Purpose                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `formulary`                     | 530 drugs with JSONB: formulations, dosing_bands, renal_bands, interactions. UNIQUE on generic_name. |
| `doctors`                       | Seeded with Dr. Lokender Goyal.                                                                      |
| `standard_prescriptions`        | 446 ICD-10 keyed protocols with first_line_drugs, investigations                                     |
| `patients`                      | Demographics, UHID (RKH-YYMM#####), known_allergies text[], is_active                                |
| `visits`                        | Per-visit vitals, diagnoses, clinical notes. NOT NULL on patient_id.                                 |
| `prescriptions`                 | Generated Rx JSON, approval status. NOT NULL on visit_id + patient_id.                               |
| `vaccinations`                  | Per-patient vaccination history (IAP 2024 + NHM-UIP)                                                 |
| `growth_records`                | WHO Z-scores (WAZ, HAZ, WHZ, HCZ)                                                                    |
| `developmental_screenings`      | Assessments by domain                                                                                |
| Storage: `website` bucket       | Skill files (.md) + web pages                                                                        |
| Storage: `prescriptions` bucket | Prescription text files                                                                              |

RLS enabled with anon_full_access policy for POC. ON DELETE RESTRICT. CHECK constraints on medical ranges.

## Key Domain Rules (Critical When Editing)

- **4-row medicine format**: Row 1 = GENERIC NAME IN CAPS (concentration), Row 2 = English dosing, Row 3 = Hindi (Devanagari), Row 4 = Pictogram sidebar (SVG icons for dosing schedule). All in Royal Blue.
- **Medication pictograms**: Compact right-side sidebar with inline SVG time-of-day icons (sunrise/sun/sunset/moon), dose quantity icons (pills/spoon/drops), duration + food instructions in Hindi.
- **Colour coding**: Blue = medicines, Red = investigations, Black = everything else.
- **6 dosing methods**: Weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier. NEVER exceed max dose.
- **Rounding**: Syrups → 0.5ml, drops → 0.1ml, tablets → ¼ tab.
- **Preterms**: CORRECTED age for growth/development, CHRONOLOGICAL age for vaccinations. Neonatal chip auto-activates for age < 28d, GA < 37wk, BW < 2.5kg.
- **Vaccination**: Both IAP 2024 and NHM-UIP schedules. Haryana: PCV + Rotavirus free, no JE.
- **Safety checks**: allergy_note, interactions, per-medicine max_dose_check, overall_status (SAFE/REVIEW REQUIRED).
- **NABH compliance**: Mandatory on every prescription. Claude always fetches nabh_compliance reference.
- **ICD-10 primary**: Standard prescription lookup uses ICD-10 code first, diagnosis name as fallback.
- **XSS protection**: `esc()` function on every dynamic innerHTML value.
- **Patient IDs**: Format RKH-YYMM##### (Indian financial year).
- **QR code payload**: Minimal re-registration data (UHID, name, DOB, sex initial).

## Working with Web Pages

Each page is a single self-contained HTML file with inline CSS and JavaScript. They use:

- `fetch()` for Supabase REST API calls (anon key hardcoded)
- Web Speech API for voice dictation (Chrome only, `en-IN` locale)
- CDN libraries: html5-qrcode (QR scanning), Noto Sans Devanagari (Hindi font)
- Inline SVG for medication pictograms (no external images)
- Browser print API for A4 output with `@page` rules

When editing, maintain the self-contained nature. After editing an artifact in `radhakishan_system/artifacts/`, copy it to `web/` with the clean filename. All dynamic data must be wrapped in `esc()` before innerHTML insertion.

## Deployment

- **Web app**: Push to `main` → GitHub Actions deploys `web/` to GitHub Pages
- **Edge Function**: `supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc`
- **Skill files**: Upload to Supabase Storage `website/skill/` prefix (cached by Edge Function)
- **Secrets**: `ANTHROPIC_API_KEY` set via `supabase secrets set`
