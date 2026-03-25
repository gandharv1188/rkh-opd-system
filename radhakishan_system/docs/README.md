# Radhakishan Hospital — Super Pediatric OPD Prescription System

## Complete Build Documentation | Version 2026

---

## Documentation Index

```
docs/
├── README.md                    ← You are here
├── SETUP_GUIDE.md               ← First-time setup instructions
│
├── specification/               ← System specs and requirements
│   ├── radhakishan_specification.md / .docx
│   ├── dose_calculator_spec.md
│   └── missing_standard_prescription_sections.md
│
├── architecture/                ← System design and component inventory
│   └── ARTIFACT_INVENTORY.md
│
├── database/                    ← Supabase schema, table specs, field contracts
│   ├── SUPABASE_SCHEMA_NOTES.md
│   ├── formulary_database_spec.md
│   ├── formulary_fields_for_ai.md
│   └── standard_prescriptions_spec.md
│
├── clinical/                    ← Clinical rules, dosing, diagnosis protocols
│   ├── CLINICAL_RULES_SUMMARY.md
│   ├── dosing_reference_guide.md
│   ├── Standard_Diagnosis_full.txt / .docx / .pdf
│   └── RADHIKA MEDICINE DRUG FORMULARY.csv
│
├── formulary/                   ← Drug data, SNOMED/LOINC, formulary research
│   ├── formulary_comparison.md
│   ├── snomed_database_spec.md
│   ├── LOINC_sample_per_class.md
│   └── formulary-research/
│
├── code-review/                 ← Code review findings, issues, resolution notes
│   ├── CODE_REVIEW_ISSUES.md
│   ├── ISSUES.md
│   ├── data_contract_audit.md
│   ├── code_review_documents_and_summaries.md
│   ├── code_review_document_flow_v2.md
│   ├── section_a_resolution_notes.md
│   ├── section_b2_resolution_notes.md
│   └── section_c_resolution_notes.md
│
├── abdm/                        ← ABDM/ABHA integration research and plans
│   ├── ABDM_integration_research.md
│   ├── ABDM_comprehensive_adoption_plan.md
│   └── ABDM_next_steps.md
│
└── planning/                    ← Migration plans, upgrade plans, task tracking
    ├── SDK_MIGRATION_PLAN.md
    ├── voice_transcription_upgrade_plan.md
    ├── doctor_update_notes_20260324.md / .pdf
    └── tasks.md
```

---

## System Overview

A complete AI-assisted OPD prescription system for pediatric and neonatal patients.
Standalone web app hosted on GitHub Pages, backed by Supabase + Claude API with tool_use.

**Hospital:** Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana — NABH HCO 6th Edition Accredited
**Doctor:** Dr. Lokender Goyal (MD Pediatrics, PGI Chandigarh)

---

## Architecture

```
Web App (GitHub Pages: rx.radhakishanhospital.com)
  ├── Registration Page → Supabase (patients, visits)
  ├── Prescription Pad → Supabase Edge Function (generate-prescription)
  │                       ├── Loads core_prompt.md from Storage
  │                       ├── Claude API with 5 tools
  │                       └── Returns prescription JSON
  ├── Print Station → Supabase (today's approved Rx) → Print (A4 with QR)
  └── Patient Lookup → Supabase
```

---

## Quick Links

| Topic            | File                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| First-time setup | [SETUP_GUIDE.md](SETUP_GUIDE.md)                                                         |
| Full system spec | [specification/radhakishan_specification.md](specification/radhakishan_specification.md) |
| Schema details   | [database/SUPABASE_SCHEMA_NOTES.md](database/SUPABASE_SCHEMA_NOTES.md)                   |
| Clinical rules   | [clinical/CLINICAL_RULES_SUMMARY.md](clinical/CLINICAL_RULES_SUMMARY.md)                 |
| Dosing methods   | [clinical/dosing_reference_guide.md](clinical/dosing_reference_guide.md)                 |
| Known issues     | [code-review/ISSUES.md](code-review/ISSUES.md)                                           |
| ABDM integration | [abdm/ABDM_comprehensive_adoption_plan.md](abdm/ABDM_comprehensive_adoption_plan.md)     |
| SDK migration    | [planning/SDK_MIGRATION_PLAN.md](planning/SDK_MIGRATION_PLAN.md)                         |

---

## Key Clinical Rules

1. Weight-based dosing — never exceed max dose
2. Syrups rounded to nearest 0.5ml, drops to 0.1ml, tablets to 1/4 tab
3. ALWAYS include Hindi (Row 3) for every medicine
4. ALWAYS check allergy, cross-reactions, interactions
5. Preterms: CORRECTED AGE for growth + development, CHRONOLOGICAL AGE for vaccinations
6. Colour coding: Blue = medicines, Red = investigations, Black = everything else

---

## Deployment

- **Web app**: Push to `main` → GitHub Actions deploys `web/` to GitHub Pages
- **Edge Functions**: `npx supabase functions deploy <name> --project-ref ecywxuqhnlkjtdshpcbc`
- **Schema migrations**: `npx supabase db query --linked -f <file.sql>`

---

_Built with Claude | Radhakishan Hospital, Kurukshetra | Edition 2026_
