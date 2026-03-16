# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-assisted pediatric OPD prescription system for Radhakishan Hospital (NABH accredited), Kurukshetra, Haryana. Built as Claude.ai artifacts (browser-based HTML widgets) backed by a Supabase (PostgreSQL) database. There is no traditional build system, test suite, or package manager — the "code" consists of self-contained HTML artifact files, a SQL schema, a Claude skill prompt, JSON data, and Node.js import scripts.

## Architecture

```
Reception/Nurse (Patient Registration artifact)
        ↓ registers patient, captures vitals, creates visit
Supabase Database + Storage (PostgreSQL, 10 tables)
        ↑ ↓ HTTPS fetch()
Doctor OPD (Prescription Pad artifact + Claude.ai conversation)
        ↓ doctor dictates note → Claude generates JSON → artifact renders
Prescription Output (A4 print artifact with QR code)
```

All artifacts run inside Claude.ai's sandbox. Prescription generation happens through the Claude.ai conversation using Project Custom Instructions (the skill prompt). Artifacts communicate via `postMessage` (target origin: `https://claude.ai`). Supabase credentials are entered once per session.

## Repository Structure

Everything lives under `radhakishan_system/`:

- **`artifacts/`** — 7 HTML files, each a standalone Claude.ai artifact widget:
  - `radhakishan_patient_registration.html` — Reception & nurse station (registration, QR scan, vitals, visit creation)
  - `radhakishan_connected_prescription_system.html` — Main prescription pad (doctor-facing, voice dictation, visit info panel, JSON paste)
  - `radhakishan_prescription_output_v2.html` — Print-ready A4 prescription renderer with QR code
  - `radhakishan_patient_lookup.html` — Patient search, history, previous Rx reuse, growth trends
  - `radhakishan_formulary_v2.html` — Drug monograph editor (all 6 dosing methods, dual category tabs)
  - `radhakishan_formulary_importer.html` — Bulk JSON drug import with field auto-mapping
  - `radhakishan_standard_rx_manager.html` — ICD-10 keyed diagnosis protocol manager
- **`schema/radhakishan_supabase_schema.sql`** — Complete DDL for 10 tables with RLS, CHECK constraints, indexes, triggers, doctor seed data
- **`skill/radhakishan_prescription_skill.md`** — Comprehensive system prompt (v2026.2) with XML-tagged sections, all 6 dosing methods, IAP 2024 + NHM-UIP vaccination schedules, safety checks, complete worked example
- **`data/formulary_data.json`** — 530 drug formulary entries
- **`data/standard_prescriptions_data.json`** — 446 diagnosis protocols with ICD-10 codes
- **`scripts/import_data.js`** — Node.js script to import formulary + standard prescriptions into Supabase
- **`scripts/create_sample_data.js`** — Creates sample patient (Arjun Kumar) with full visit data
- **`docs/`** — README, specification, setup guide, schema notes, clinical rules, code review issues, artifact inventory, SDK migration plan

## Workflow (3-Stage)

1. **Reception** (Patient Registration artifact): Register patient → capture demographics, allergies, vaccination history → create visit
2. **Nurse station** (same artifact): Weigh child → capture vitals (temp, HR, RR, SpO2, height, HC, MUAC) → record chief complaints
3. **Doctor OPD** (Prescription Pad + Claude.ai conversation): Select patient → see nurse-captured vitals + allergies → dictate/type clinical note → Claude generates prescription JSON via conversation → paste into artifact → review, edit, sign off → print

## Supabase Schema (10 Tables)

| Table                           | Purpose                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `formulary`                     | Drug monographs (530 drugs) with JSONB: formulations, dosing_bands, renal_bands, interactions, administration. UNIQUE on generic_name. |
| `doctors`                       | Reference table with credentials. Seeded with Dr. Lokender Goyal and Dr. Swati Goyal.                                                  |
| `standard_prescriptions`        | 446 ICD-10 keyed protocols with first_line_drugs, investigations, guideline_changes                                                    |
| `patients`                      | Demographics, UHID (RKH-YYMM#####), known_allergies text[], blood_group, is_active soft-delete                                         |
| `visits`                        | Per-visit vitals, diagnoses, clinical notes, raw dictation. NOT NULL on patient_id.                                                    |
| `prescriptions`                 | Generated Rx JSON, approval status, QR data. NOT NULL on visit_id + patient_id.                                                        |
| `vaccinations`                  | Per-patient vaccination history (IAP 2024 + NHM-UIP)                                                                                   |
| `growth_records`                | WHO Z-scores (WAZ, HAZ, WHZ, HCZ), chart used, classification                                                                          |
| `developmental_screenings`      | Structured developmental assessments by domain (motor, language, social, cognitive)                                                    |
| Storage: `prescriptions` bucket | Public bucket for prescription text files                                                                                              |

All tables have: RLS enabled (authenticated access policy), ON DELETE RESTRICT, updated_at triggers, CHECK constraints on medical data ranges, JSONB type validation.

## Key Domain Rules (Critical When Editing)

- **3-row medicine format**: Row 1 = GENERIC NAME IN CAPS (concentration), Row 2 = English dosing, Row 3 = Hindi (Devanagari). All in Royal Blue.
- **Colour coding**: Blue = medicines, Red = investigations, Black = everything else.
- **6 dosing methods**: Weight-based, BSA, GFR-adjusted, fixed, infusion, age/GA-tier. NEVER exceed max dose.
- **Rounding**: Syrups → 0.5ml, drops → 0.1ml, tablets → ¼ tab.
- **Preterms**: CORRECTED age for growth/development, CHRONOLOGICAL age for vaccinations.
- **Vaccination**: Both IAP 2024 and NHM-UIP schedules supported. Haryana: PCV + Rotavirus free, no JE.
- **Safety checks**: AI reports specific findings (not blanket booleans) — allergy_note, interactions, per-medicine max_dose_check, overall_status (SAFE/REVIEW REQUIRED).
- **XSS protection**: All artifacts use `esc()` function on every dynamic innerHTML value.
- **Patient IDs**: Format RKH-YYMM##### (Indian financial year). Sequential from Supabase.
- **QR code payload**: Minimal re-registration data (UHID, name, DOB, sex initial).

## Working with Artifacts

Each artifact is a single self-contained HTML file with inline CSS and JavaScript. They use:

- `fetch()` for Supabase REST API calls (anon key in Authorization header)
- Web Speech API for voice dictation (Chrome only, `en-IN` locale)
- `window.postMessage` for inter-artifact communication (target: `https://claude.ai`)
- CDN libraries: qrcodejs (QR codes), html5-qrcode (QR scanning), Noto Sans Devanagari (Hindi font)
- Browser print API for A4 output with `@page` rules

When editing artifacts, maintain the self-contained nature — no external build step, no imports from other local files. All dynamic data must be wrapped in `esc()` before innerHTML insertion.
