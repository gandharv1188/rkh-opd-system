# Radhakishan Hospital — Super Pediatric OPD Prescription System

## Complete Build Documentation | Version 2026

---

## System Overview

A complete AI-assisted OPD prescription system for pediatric and neonatal patients.
Built on Claude.ai artifacts + Supabase backend.

**Hospital:** Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana — NABH HCO 6th Edition Accredited
**Doctors:** Dr. Lokender Goyal (MD Pediatrics, PGI Chandigarh) · Dr. Swati Goyal (MD Pediatrics)

---

## Architecture

```
Claude.ai Artifacts (browser UI)
        ↕ HTTPS fetch()
Supabase Database + Storage (backend)
        ↕
Claude API (prescription generation)
```

---

## Artifacts Built (10 total)

### Core Clinical Tools

| #   | Artifact                | Purpose                                                     |
| --- | ----------------------- | ----------------------------------------------------------- |
| 01  | **Prescription Pad**    | Main doctor tool — dictate/type, generate, edit, sign off   |
| 02  | **Prescription Output** | Modular PDF rendering, QR code, print-ready A4              |
| 03  | **Patient Lookup**      | Search patients, view history, reuse previous prescriptions |

### Knowledge Base Management

| #   | Artifact                           | Purpose                                         |
| --- | ---------------------------------- | ----------------------------------------------- |
| 04  | **Formulary Manager**              | Full drug monograph editor — all dosing methods |
| 05  | **Formulary Import Tool**          | Bulk JSON import with field auto-mapping        |
| 06  | **Standard Prescriptions Manager** | ICD-10 keyed diagnosis protocols                |

---

## Supabase Schema (7 tables)

| Table                    | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `formulary`              | Drug monographs — formulations, dosing bands, safety |
| `standard_prescriptions` | ICD-10 keyed prescription protocols                  |
| `patients`               | Patient demographics and neonatal details            |
| `visits`                 | Every OPD visit with anthropometry and vitals        |
| `prescriptions`          | Generated prescriptions with approval status         |
| `vaccinations`           | Vaccination history per patient                      |
| `growth_records`         | WHO Z-scores and growth measurements per visit       |

---

## Setup Instructions

### Step 1: Supabase Setup

1. Create account at supabase.com
2. Create new project: "Radhakishan Hospital"
3. Go to SQL Editor
4. Paste contents of `schema/radhakishan_supabase_schema.sql`
5. Click Run
6. Go to Project Settings → API → copy URL and anon key
7. Go to Project Settings → API → CORS → add `https://claude.ai`
8. Go to Storage → Create bucket named `prescriptions` (public)

### Step 2: Claude.ai Project Setup

1. Go to claude.ai → Projects → New Project
2. Name: "Radhakishan Hospital Rx"
3. Project Settings → Custom Instructions
4. Paste entire contents of `skill/radhakishan_prescription_skill.md`
5. Save

### Step 3: Populate Knowledge Base

1. Open Formulary Import Tool artifact
2. Enter Supabase URL and anon key
3. Paste your drug JSON data
4. Click Parse & Preview, then Import
5. Open Standard Prescriptions Manager
6. Add diagnosis protocols manually or via JSON

### Step 4: Daily Use Workflow

```
Doctor opens Prescription Pad
→ Connects Supabase (once, credentials saved in browser)
→ Selects patient or types new patient
→ Dictates or types clinical note
→ Clicks Generate
→ Reviews prescription (edits inline, adjusts doses)
→ Signs off → saves to Supabase → sends to Output
→ Output artifact renders PDF with QR code
→ Print or view saved file
```

---

## Dosing Methods Supported

| Method                  | Used For                            | Formula               |
| ----------------------- | ----------------------------------- | --------------------- |
| Weight-based (mg/kg)    | Most drugs                          | qty × weight_kg       |
| Weight-based (mcg/kg)   | Potent drugs (adrenaline, fentanyl) | qty × weight_kg       |
| Weight-based (units/kg) | Insulin, heparin                    | qty × weight_kg       |
| BSA-based (mg/m²)       | Oncology, immunosuppressants        | qty × BSA (Mosteller) |
| Fixed dose              | Age-band protocols (albendazole)    | flat qty              |
| GFR-adjusted            | Aminoglycosides, vancomycin         | Schwartz formula      |
| Infusion (mcg/kg/min)   | PICU vasoactive drugs               | qty × wt × 60         |
| Loading + maintenance   | Phenobarbitone, digoxin             | separate bands        |

---

## Prescription Sections (modular — only present sections print)

**Always present:**

- Hospital header (Radhakishan, NABH badge)
- Patient demographics + UHID
- Diagnosis with ICD-10 code
- Medicines (3-row bilingual: English + Hindi)
- Emergency warning signs (bilingual)
- Follow-up instructions
- Doctor authentication block + QR code

**Conditional (only if data provided):**

- Triage score
- Safety flags
- Neonatal details (GA, corrected age)
- IV fluids
- Investigations (in RED per NABH)
- Growth assessment (WHO Z-scores)
- Vaccination status (IAP 2024)
- Developmental screening
- Diet & nutrition
- Counselling given
- Referral

---

## NABH Compliance

Compliant with NABH HCO 6th Edition (January 2025):

- AAC: Standardised OPD assessment
- COP: Diagnosis + ICD-10 + treatment plan
- MOM: Generic names, CAPS, doses, allergy/interaction checks
- PFE: Bilingual patient education (Hindi + English)
- IMS: UHID, date/time, doctor signature, complete records

---

## Colour Coding (Radhakishan Hospital Standard)

| Colour     | Used For                                            |
| ---------- | --------------------------------------------------- |
| Royal Blue | All medicines (name, dose, route, frequency, Hindi) |
| Red        | All investigations                                  |
| Black      | Everything else                                     |

---

## Key Clinical Rules

1. Weight-based dosing — never exceed max dose
2. Syrups rounded to nearest 0.5ml
3. Drops rounded to nearest 0.1ml
4. Tablets rounded to nearest ¼ tablet
5. ALWAYS include Hindi Row 3 for every medicine
6. ALWAYS check allergy, cross-reactions, interactions
7. Preterms: CORRECTED AGE for growth + development
8. Preterms: CHRONOLOGICAL AGE for vaccinations
9. WHO 2006 charts (0-5yr), IAP 2015 (5-18yr), Fenton 2013 (NICU)
10. IAP 2024 vaccination schedule

---

## Emergency Contacts — Radhakishan Hospital

- Reception: 01744-251441
- Alternate: 01744-270516
- Mobile: 7206029516
- Emergency: 01744-312067

---

## Technology Stack

| Component       | Technology                            |
| --------------- | ------------------------------------- |
| UI              | Claude.ai Artifacts (React/HTML)      |
| AI Generation   | Claude API (claude-sonnet-4-20250514) |
| Database        | Supabase (PostgreSQL)                 |
| File Storage    | Supabase Storage                      |
| Voice Dictation | Web Speech API (Chrome)               |
| QR Code         | qrcodejs (CDN)                        |
| Print           | Browser print API                     |

---

## Cost Estimate

| Item                       | Cost                 |
| -------------------------- | -------------------- |
| Claude.ai Max Plan         | Current subscription |
| Supabase Free tier (pilot) | $0/month             |
| Supabase Pro (production)  | ~$25/month           |

---

## Migration Path to SDK (when ready)

When volume justifies a proper app:

1. All prompts/skill → copy to SDK system prompt (direct transfer)
2. Supabase schema → unchanged (no migration needed)
3. Knowledge base data → unchanged
4. UI → rebuild in React (significant work)
5. Voice → upgrade to Whisper API for better accuracy

Estimated SDK migration effort: 6-8 weeks with 1-2 developers.
Everything built in Claude.ai is not throwaway — it's your clinical validation and blueprint.

---

_Built with Claude.ai | Radhakishan Hospital, Kurukshetra | Edition 2026_
