# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-assisted pediatric OPD prescription system for Radhakishan Hospital (NABH HCO 6th Edition accredited), Kurukshetra, Haryana. Built as Claude.ai artifacts (browser-based React/HTML widgets) backed by a Supabase (PostgreSQL) database. There is no traditional build system, test suite, or package manager — the "code" consists of self-contained HTML artifact files, a SQL schema, a Claude skill prompt, and JSON data.

## Architecture

```
Claude.ai Artifacts (browser UI — self-contained HTML/React widgets)
        ↕ HTTPS fetch()
Supabase Database + Storage (PostgreSQL backend, 7 tables)
        ↕
Claude API (prescription generation via claude-sonnet model)
```

All artifacts run inside Claude.ai's sandbox. They communicate with each other via `postMessage` (e.g., Prescription Pad → Output). Supabase credentials are entered once per session and stored in browser localStorage.

## Repository Structure

Everything lives under `radhakishan_system/`:

- **`artifacts/`** — 7 HTML files, each a standalone Claude.ai artifact widget:
  - `radhakishan_connected_prescription_system.html` — Main prescription pad (doctor-facing, voice dictation, dose calculation, sign-off)
  - `radhakishan_prescription_output_v2.html` — Print-ready A4 prescription renderer with QR code
  - `radhakishan_patient_lookup.html` — Patient search, history, previous Rx reuse
  - `radhakishan_formulary_v2.html` — Drug monograph editor (all 6 dosing methods)
  - `radhakishan_formulary_importer.html` — Bulk JSON drug import with field auto-mapping
  - `radhakishan_standard_rx_manager.html` — ICD-10 keyed diagnosis protocol manager
  - `01_prescription_pad.html` — Earlier version of the prescription pad
- **`schema/radhakishan_supabase_schema.sql`** — Complete DDL for 7 tables (formulary, standard_prescriptions, patients, visits, prescriptions, vaccinations, growth_records) with indexes, foreign keys, triggers
- **`skill/radhakishan_prescription_skill.md`** — Full system prompt pasted into Claude.ai Project Custom Instructions; contains all clinical rules, NABH compliance, dosing logic, bilingual format rules
- **`data/formulary_data.json`** — Drug formulary seed data for import
- **`docs/`** — README, setup guide, schema notes, clinical rules summary, artifact inventory, SDK migration plan, full specification

## Key Domain Rules (Critical When Editing Artifacts)

- **3-row medicine format**: Row 1 = GENERIC NAME IN CAPS (concentration), Row 2 = English dosing instructions, Row 3 = Hindi instructions. All medicines in Royal Blue.
- **Colour coding**: Blue = medicines, Red = investigations, Black = everything else.
- **Dose calculations**: Weight-based (mg/kg), BSA-based (mg/m²), GFR-adjusted, fixed, infusion (mcg/kg/min), loading+maintenance. Calculated dose must NEVER exceed published max.
- **Rounding**: Syrups → nearest 0.5ml, drops → nearest 0.1ml, tablets → nearest ¼ tab.
- **Preterm patients**: Use CORRECTED age for growth/development, CHRONOLOGICAL age for vaccinations.
- **Growth charts**: WHO 2006 (0–5yr), IAP 2015 (5–18yr), Fenton 2013 (NICU preterms).
- **NABH compliance**: Prescriptions must include UHID, ICD-10 codes, generic drug names, allergy/interaction checks, bilingual education, doctor authentication block.

## Supabase Schema (7 Tables)

| Table                    | Purpose                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `formulary`              | Drug monographs with JSONB fields: formulations, dosing_bands, renal_bands, interactions, administration |
| `standard_prescriptions` | ICD-10 keyed protocols with first_line_drugs, investigations, counselling                                |
| `patients`               | Demographics, UHID format RKH-YYMM##### (e.g. RKH-25260300001), neonatal fields (GA, birth weight)       |
| `visits`                 | Per-visit anthropometry, vitals, diagnoses, clinical notes, raw dictation                                |
| `prescriptions`          | Generated Rx JSON, approval status, PDF URL, QR data, versioning                                         |
| `vaccinations`           | Per-patient vaccination history (IAP 2024 schedule)                                                      |
| `growth_records`         | WHO Z-scores (WAZ, HAZ, WHZ, HCZ), chart used, classification                                            |

## Working with Artifacts

Each artifact is a single self-contained HTML file with inline CSS and JavaScript. They use:

- `fetch()` for Supabase REST API calls (with anon key in Authorization header)
- Web Speech API for voice dictation (Chrome only, `en-IN` locale)
- `window.postMessage` for inter-artifact communication
- CDN-loaded libraries: qrcodejs for QR codes
- Browser print API for A4 output

When editing artifacts, maintain the self-contained nature — no external build step, no imports from other local files.

## Future Migration Path

The system is designed for eventual migration to a standalone React + Anthropic SDK app. The skill prompt, schema, and all data transfer directly. Only the UI needs rebuilding. See `docs/SDK_MIGRATION_PLAN.md` for details.
