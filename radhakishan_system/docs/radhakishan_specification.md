---
title: "Radhakishan Hospital — Super Pediatric OPD Prescription System"
subtitle: "Complete Technical & Clinical Specification"
version: "2026 Edition"
date: "March 2026"
authors:
  - "Dr. Lokender Goyal, MD Pediatrics (PGI Chandigarh), HMCI Reg. HN 21452"
  - "Dr. Swati Goyal, MD Pediatrics"
hospital: "Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana"
accreditation: "NABH HCO 6th Edition"
status: "Production-ready for pilot deployment"
---

# RADHAKISHAN HOSPITAL

राधाकिशन हस्पताल

Jyoti Nagar, Kurukshetra, Haryana · NABH HCO 6th Edition Accredited

## SUPER PEDIATRIC OPD PRESCRIPTION SYSTEM

_Complete Technical & Clinical Specification_

Version 2026 | March 2026

Dr. Lokender Goyal, MD Pediatrics (PGI Chandigarh) · HMCI Reg. HN 21452

Dr. Swati Goyal, MD Pediatrics · Pediatrics & Neonatology

> **CONFIDENTIAL — FOR AUTHORIZED USE ONLY**

Built on Claude.ai (Anthropic) · Supabase · IAP / NABH / WHO Clinical Standards

# Table of Contents

1. Executive Summary

2. Problem Statement & Design Rationale

3. System Architecture

4. Supabase Database Schema

5. Artifacts — Complete Inventory

6. The Radhakishan Prescription Skill

7. Prescription Format — Clinical Standard

8. Growth Assessment Protocol

9. Developmental Screening Protocol

10. IAP 2024 Vaccination Schedule

11. Drug Safety Framework

12. NABH Compliance

13. Technology Stack

14. Setup Instructions

15. SDK Migration Path

16. Reference Sources

17. Glossary

# 1. Executive Summary

The Radhakishan Hospital Super Pediatric OPD Prescription System is an AI-assisted clinical documentation and prescription generation platform designed specifically for pediatric and neonatal outpatient practice. It replaces the fragmented, form-heavy approach of traditional HMIS systems with a single-input, notebook-style workflow where the doctor dictates or types a free-text clinical note and AI handles all structured output generation.

The system generates complete NABH HCO 6th Edition compliant prescriptions including weight-based drug dose calculations, bilingual (Hindi + English) patient instructions, IAP 2024 vaccination schedules, WHO Z-score growth assessments, developmental milestone screening, diet prescriptions, and emergency warning signs — all from a single clinical note. Every prescription is saved to a Supabase database, linked to a patient and visit record, and rendered as a print-ready A4 document with an embedded QR code.

> _KEY DESIGN PRINCIPLE: The doctor writes or dictates one free-text note. Everything else — extraction, calculation, formatting, bilingual translation, safety checking, NABH compliance — is handled by AI. No forms. No dropdowns. No HMIS-style field entry._

|               |                                                         |
| ------------- | ------------------------------------------------------- |
| **Parameter** | **Value**                                               |
| Hospital      | Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana |
| Department    | Pediatrics & Neonatology (OPD)                          |
| Accreditation | NABH HCO 6th Edition (January 2025)                     |
| Patient scope | Pediatric (0-18 years) + Neonatal (preterm & term)      |
| Platform      | Claude.ai Artifacts + Supabase                          |
| AI model      | Claude Sonnet (claude-sonnet-4-20250514)                |
| Version       | 2026 Edition                                            |
| Status        | Production-ready for pilot deployment                   |

# 2. Problem Statement & Design Rationale

## 2.1 The Problem with Traditional HMIS

Traditional Hospital Management Information Systems force doctors to navigate dozens of structured fields before a prescription can be generated. In a busy pediatric OPD — where a doctor may see 80-120 patients per day — this overhead is clinically unacceptable. The first and most important design decision made in this project was:

> _DECISION: Eliminate all mandatory structured input fields. The doctor's clinical note is the only required input. AI extracts all structured data from it._

This directly addresses the most common complaint about HMIS systems: they interrupt clinical workflow rather than supporting it.

## 2.2 Specific Challenges for Pediatric OPD

- Weight-based dose calculation is complex and error-prone when done manually

- Neonatal dosing requires gestational age correction — a different calculation pathway entirely

- Bilingual (Hindi + English) instructions are mandatory for patient compliance in Kurukshetra's patient population

- NABH mandates 20+ sections per prescription — impossible to complete manually for every patient

- IAP vaccination schedules, WHO growth charts, and developmental milestone tracking add further documentation burden

- Indian market drug concentrations often differ from international formularies — dose rounding must use local concentrations

## 2.3 Why Claude.ai Artifacts (not a custom app)

A key architectural decision was to build entirely within Claude.ai rather than developing a standalone SDK-based application. The rationale:

|                                    |                             |                          |
| ---------------------------------- | --------------------------- | ------------------------ |
| **Factor**                         | **Claude.ai Artifacts**     | **Custom SDK App**       |
| Time to first working prescription | Days                        | 8-10 weeks               |
| Development cost                   | \$0 (existing subscription) | \$5,000-15,000           |
| Clinical validation speed          | Immediate with real doctors | After full development   |
| Maintenance                        | Zero DevOps                 | Ongoing                  |
| AI integration                     | Native, no code needed      | SDK integration required |
| Risk if concept fails              | Minimal                     | High sunk cost           |

> _DECISION: Build in Claude.ai first. Validate clinically. Migrate to SDK only when volume, multi-user concurrency, or mobile requirements justify it. All prompts, schema, and knowledge base transfer directly — nothing is throwaway work._

# 3. System Architecture

## 3.1 High-Level Architecture

The system has four layers:

|                  |                                       |                                                |
| ---------------- | ------------------------------------- | ---------------------------------------------- |
| **Layer**        | **Technology**                        | **Purpose**                                    |
| UI / Interaction | Claude.ai Artifacts (HTML/JS/React)   | All doctor-facing interfaces                   |
| AI Generation    | Claude API (claude-sonnet-4-20250514) | Prescription generation from clinical notes    |
| Knowledge Base   | Supabase (PostgreSQL + JSONB)         | Formulary, standard protocols, patient records |
| File Storage     | Supabase Storage                      | Prescription files (PDF/text)                  |

## 3.2 Data Flow — Complete Patient Visit

### Stage 1: Reception (Patient Registration Artifact)

Patient arrives at reception desk

→ **New patient:** Reception registers demographics (name, DOB, sex, guardian, phone, blood group, allergies). UHID auto-generated (RKH-YYMM#####).

→ **Returning patient:** Reception searches by name/UHID/phone OR scans QR code from previous prescription. QR payload (UHID, name, DOB, sex) auto-fills search → patient loaded for revisit.

→ Vaccination history entered from card (optional — dropdown with common vaccines + date)

→ Neonatal details if applicable (GA, birth weight)

→ Visit created: date, assigned doctor, visit type (new/follow-up/vaccination/emergency)

→ OPD token printed with UHID, name, doctor, visit details

### Stage 2: Nurse Station (Patient Registration Artifact — continued)

Nurse weighs and measures the child

→ Vitals captured: weight (kg), height (cm), head circumference, MUAC, temperature (°F), heart rate, respiratory rate, SpO₂

→ Chief complaints recorded (what parent reports)

→ All data saved to the visit record in Supabase

### Stage 3: Doctor OPD (Prescription Pad Artifact + Claude.ai Conversation)

Doctor opens Prescription Pad, selects patient

→ Supabase credentials entered once (session-persisted)

→ System pre-loads formulary + standard Rx protocols into memory cache

→ On patient selection: fetches today's visit (created by reception/nurse)

→ **Visit info panel** displays: allergies (RED), nurse-captured vitals (pills), chief complaints, assigned doctor auto-selected

→ Clinical note textarea pre-filled with: name, age, weight, sex, allergy status, chief complaints, temperature

Doctor dictates or types additional clinical findings

→ Voice: Web Speech API (Chrome, en-IN locale) / Text: direct keyboard entry

→ Doctor sends clinical note to Claude.ai conversation (via "Send to Chat" button which copies prompt with formulary context to clipboard, or types directly in conversation)

Claude.ai generates prescription (using Project Custom Instructions = Skill)

→ **Step 1:** Claude confirms patient/diagnosis, presents numbered options for additional sections (investigations, growth, vaccination, etc.)

→ **Step 2:** After doctor selects, Claude generates structured JSON prescription with dose calculations, safety checks, Hindi translations

→ Conversation named: "[Patient Name] — [UHID]"

Doctor pastes JSON into Prescription Pad (via "Paste JSON" or postMessage)

→ Prescription rendered for review — every line directly editable (contenteditable)

→ 'Adjust dose' panel: change weight/dose/freq → live recalculation

Doctor signs off

→ Supabase: patient record updated (if new data)

→ Supabase: visit record updated (diagnosis, clinical notes, raw dictation)

→ Supabase: prescription record saved (full JSON + approval)

→ Supabase: growth record saved (if Z-scores present)

→ Supabase Storage: prescription file uploaded to `prescriptions` bucket

→ postMessage → Output artifact renders A4 prescription with QR code

→ Print / save

## 3.3 Skill Prompt Architecture

### Current Approach: Project Custom Instructions

The prescription generation logic is delivered as a Claude.ai **Project Custom Instructions** prompt (file: `skill/radhakishan_prescription_skill.md`, v2026.2). This prompt is pasted into the project's Custom Instructions field and is automatically loaded into every conversation within the "Radhakishan Hospital Rx" project.

This approach was chosen over the newer Claude Skills system (`.claude/skills/SKILL.md` with YAML frontmatter) because:

1. **Always-on loading:** Every conversation in this project is a prescription — there is no scenario where the skill should _not_ load. Skills are designed for selective/dynamic activation, which is unnecessary here.
2. **Single project:** The system currently serves one hospital with one project. Cross-project reusability is not needed yet.
3. **Simplicity:** Plain markdown pasted into a text box — no ZIP packaging, no YAML frontmatter, no directory structure required.

### Production Migration: Claude Skills Format

When the system needs to be shared with other hospitals or packaged for distribution, the prompt should be converted to the Agent Skills Open Standard format:

```
radhakishan-prescription-skill/
├── SKILL.md          (YAML frontmatter + core workflow instructions, <500 lines)
├── references/
│   ├── iap_2024_schedule.md
│   ├── nhm_uip_schedule.md
│   ├── dosing_methods.md
│   ├── safety_checks.md
│   ├── standard_prescriptions.md
│   └── growth_charts.md
├── assets/
│   └── prescription_json_schema.json
└── scripts/
    └── (future: validation scripts)
```

This enables progressive disclosure — the core SKILL.md stays under 500 lines and references external files only when needed, reducing context window usage.

### Artifact Navigation Guidance

Claude.ai artifacts cannot be programmatically opened, switched, or controlled from the conversation. The user must manually click on the artifact they want to use. To guide the doctor through the multi-artifact workflow, the skill prompt includes navigation cues in its responses:

- After Step 1 (confirming patient): "Open the **Prescription Pad** artifact and select your patient."
- After Step 2 (generating JSON): "Copy this JSON and paste it into the **Prescription Pad** → **Paste JSON** button."
- After sign-off: "Click **Send to Output** in the Prescription Pad to view the printable prescription in the **Prescription Output** artifact."

These are text-based cues only — Claude cannot switch artifacts programmatically. This is a platform limitation that would be resolved in a standalone app (SDK migration).

## 3.4 Knowledge Base Architecture

A critical architectural decision was how to store the clinical knowledge base (formulary and standard prescriptions). Three options were considered:

|                            |                                                   |                                                         |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| **Option**                 | **Approach**                                      | **Decision**                                            |
| Full document in prompt    | Embed entire formulary in every API call          | Rejected — ~37,500 tokens overhead per call             |
| window.storage (key-value) | Store in browser, fetch by key                    | Partially used — 5MB limit constrains large formularies |
| Supabase database          | Pre-load at session start, query at generate time | ADOPTED — instant after pre-load, no per-call overhead  |

> _DECISION: Store formulary and standard prescriptions in Supabase. Pre-load entire dataset into JavaScript memory cache at session start. At generate time, scan the clinical note for drug names and diagnosis keywords, then inject only the relevant 2-4 entries as context into the API call. This keeps API context to ~500-1000 tokens of knowledge per call instead of 37,500+._

## 3.4 Prescription PDF Storage

> _DECISION: No Google Drive. All prescription files stored in Supabase Storage. Rationale: (1) Supabase is already the database — single system of record; (2) Queryable by patient ID and date; (3) No separate authentication; (4) Faster access than Drive API fetch (500ms-2s latency). Google Drive was considered and explicitly rejected in favor of Supabase-only architecture._

# 4. Supabase Database Schema

## 4.1 Tables Overview

|                        |                                                                      |                                                               |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Table**              | **Purpose**                                                          | **Key Relationships**                                         |
| formulary              | Drug monographs — all dosing methods, safety, formulations           | Referenced by prescription generator at runtime               |
| standard_prescriptions | ICD-10 keyed diagnosis protocols                                     | Referenced by prescription generator at runtime               |
| patients               | Patient demographics, neonatal details                               | Parent of visits, prescriptions, vaccinations, growth_records |
| visits                 | Per-visit clinical data — vitals, anthropometry, diagnosis, raw note | Child of patients, parent of prescriptions                    |
| prescriptions          | Full generated prescription JSON + approval status + PDF URL         | Child of visits and patients                                  |
| vaccinations           | Vaccination history per patient                                      | Child of patients                                             |
| growth_records         | WHO Z-scores and measurements per visit                              | Child of patients and visits                                  |

## 4.2 Formulary Table — Critical Design Decisions

The formulary table stores drug monographs in a structure that reflects real-world pediatric dosing complexity. Three critical design decisions:

> _DECISION 1: Separate quantity from unit. Every dose is stored as two fields — dose_min_qty (number) and dose_unit (string). Never as a combined string like '40mg/kg'. This enables programmatic calculation without string parsing._

> _DECISION 2: Multiple dosing bands per drug. A single drug (e.g. Amoxicillin) can have different dosing bands for different age groups and indications — a neonatal band, a standard pediatric band, and a high-dose AOM band. All stored as a JSONB array._

> _DECISION 3: Six supported dosing methods. The system handles all legitimate pediatric dosing methods: weight-based (mg/kg, mcg/kg, units/kg, mmol/kg), BSA-based (mg/m²), fixed dose, GFR-adjusted (Schwartz formula), continuous infusion (mcg/kg/min), and age-band flat dose (neonatal GA tiers)._

|                   |                                                    |                                  |
| ----------------- | -------------------------------------------------- | -------------------------------- |
| **Dosing Method** | **Used For**                                       | **Calculation**                  |
| weight            | Most drugs (antibiotics, antipyretics)             | qty × weight_kg = dose           |
| bsa               | Oncology, immunosuppressants, precision drugs      | qty × BSA(m²), BSA=√(Ht×Wt/3600) |
| fixed             | Age-band flat doses (e.g. Albendazole 400mg \>2yr) | qty directly                     |
| gfr               | Aminoglycosides, vancomycin, renally cleared drugs | Dose per Schwartz eGFR tier      |
| infusion          | PICU vasoactive drugs (dopamine, adrenaline)       | qty × weight × 60 = dose/hr      |
| age               | Neonatal GA-specific tiers                         | Dose per GA + postnatal age band |

## 4.3 Key JSONB Structures

### 4.3.1 formulations array (in formulary)

{ "form": "syrup", "conc_qty": 120, "conc_unit": "mg",

"per_qty": 5, "per_unit": "ml", "route": "oral",

"indian_brand": "Calpol 120mg/5ml" }

> _Indian concentration rule: When Indian market concentration (MIMS/CIMS) differs from international formulary, Indian concentration takes precedence for dose rounding. Always state concentration used in Row 1 of prescription._

### 4.3.2 dosing_bands array (in formulary)

{ "indication": "AOM / severe infection", "age_band": "child",

"method": "weight", "dose_min_qty": 80, "dose_max_qty": 90,

"dose_unit": "mg", "is_per_day": true, "frequency_per_day": 3,

"duration_days": 7, "max_single_qty": 500, "max_single_unit": "mg",

"max_daily_qty": 3000, "max_daily_unit": "mg",

"loading_dose_qty": null, "loading_dose_unit": null,

"rounding_rule": "0.5ml",

"notes": "High-dose AOM protocol per IAP 2024" }

### 4.3.3 standard_prescriptions — first_line_drugs

{ "drug": "AMOXICILLIN", "dose_qty": 80, "dose_unit": "mg",

"dose_basis": "per_kg", "is_per_day": true,

"frequency_per_day": 3, "duration_days": 7, "route": "oral",

"notes": "High-dose AOM protocol" }

# 5. Artifacts — Complete Inventory

The system comprises 7 Claude.ai artifacts. Each artifact is a self-contained HTML/JS application that runs in the browser and communicates with Supabase via fetch().

## 5.1 Artifact 01 — Prescription Pad (Primary Clinical Tool)

**Identifier**

radhakishan_connected_prescription_system

**Purpose**

The main doctor-facing tool. The doctor's only required action is to write or dictate a clinical note. Everything else is automated.

**Key features**

- Voice dictation via Web Speech API (Chrome, en-IN locale)

- Patient search — live query to Supabase patients table (filtered by is_active)

- On patient selection: fetches today's visit from Supabase and displays **visit info panel** with nurse-captured vitals (weight, height, HC, MUAC, temp, HR, RR, SpO₂), chief complaints, and known allergies (RED highlight)

- Pre-fills clinical note textarea with patient context + vitals + allergy status + chief complaints from nurse

- Auto-selects the doctor assigned at registration

- Dual-mode prescription input: "Send to Chat" (copies prompt with formulary context to clipboard for Claude.ai conversation) OR "Paste JSON" (receives Claude's JSON response)

- Auto-receives prescription JSON via postMessage (`radhakishan-rx-json` type)

- Supabase pre-load: formulary + standard Rx loaded into memory at session start

- Optional module sections now handled in the Claude.ai conversation workflow (Claude presents numbered options after confirming diagnosis)

- Smart inline dose adjustment: change weight/mg-per-kg/frequency → live recalculation → Row 2 (English) and Row 3 (Hindi) both auto-update

- Sign-off saves simultaneously to: patients, visits, prescriptions, growth_records tables + Supabase Storage

- postMessage to Artifact 04 (Output) after sign-off

**Supabase tables**

READ: formulary, standard_prescriptions, patients | WRITE: patients, visits, prescriptions, growth_records, Storage

## 5.2 Artifact 02 — Prescription Output (PDF Renderer)

**Identifier**

radhakishan_prescription_output_v2

**Purpose**

Renders the final signed prescription as a formatted A4 document with full Radhakishan Hospital letterhead, QR code, and print-ready CSS.

**Key features**

- Modular rendering: only sections where data exists are rendered — no empty sections

- Full hospital letterhead (blue header, NABH badge, doctor details, emergency contacts)

- QR code generated client-side (qrcodejs CDN library) encoding: UHID, patient name (max 30 chars), DOB, sex initial — designed for patient re-registration on next visit via QR scan at reception

- Print-optimised CSS: hides UI chrome, A4 @page margins, colour-correct (blue medicines, red investigations)

- Receives prescription JSON via postMessage from Artifact 01 OR by pasting JSON directly

- 'Paste JSON' button for manual input when not connected to pad

**Sections rendered (conditional)**

Always: hospital header, patient meta strip, diagnosis, medicines (3-row bilingual), emergency warning signs (bilingual), follow-up, safety compliance strip, doctor authentication + QR code

Conditional: triage score, safety flags, neonatal details, IV fluids, investigations (RED), growth assessment (Z-scores), vaccination status, developmental screening, diet, counselling given, referral

## 5.3 Artifact 03 — Patient Lookup

**Identifier**

radhakishan_patient_lookup

**Purpose**

Search patients, view complete clinical history, register new patients, and load previous prescriptions as templates.

**Key features**

- Live search by name, UHID (RKH-YYMM##### format, e.g. RKH-25260300001), or phone number

- New patient registration with auto-generated UHID

- Expandable patient cards showing: visit history, prescription history, growth trend

- Growth records display with Z-score colour chips (green/amber/red)

- 'Reuse as template' button: sends previous prescription JSON to Artifact 01 via postMessage

- 'Start new prescription' button: pre-fills pad with patient demographics

**Supabase tables**

READ/WRITE: patients | READ: visits, prescriptions, growth_records, vaccinations

## 5.4 Artifact 04 — Patient Registration (Reception & Nursing Station)

**Identifier**

radhakishan_patient_registration

**Purpose**

Used at the reception desk and nurse station before the patient sees the doctor. Handles new patient registration, returning patient revisit (including QR scan), vitals capture, vaccination history entry, and visit creation.

**Key features**

- **Search:** Live search by name, UHID, or phone number (filtered by is_active)

- **QR Scanner:** Opens rear camera (html5-qrcode library) to scan QR code from previous prescription. QR payload (UHID, name, DOB, sex) auto-loads patient for revisit. If patient not in database, pre-fills new registration form from QR data.

- **New patient registration:** Demographics (name, DOB, sex, guardian, phone, blood group, address), known allergies (comma-separated), neonatal details (GA, birth weight). Only name is mandatory. UHID auto-generated (RKH-YYMM#####).

- **Returning patient revisit:** On selection, form pre-fills with existing data. Reception can update any changed fields (new phone, updated allergies, etc.)

- **Nurse station vitals:** Weight (kg), height (cm), head circumference, MUAC, temperature (°F), heart rate, respiratory rate, SpO₂. These are captured before the doctor sees the patient and are available in the Prescription Pad's visit info panel.

- **Chief complaints:** Free-text field for what the parent/patient reports at reception

- **Vaccination history:** Quick-entry with dropdown (BCG, OPV, Pentavalent, IPV, PCV, Rotavirus, MR, MMR, DPT, Hep A, Varicella, TCV, Influenza, HPV, Td, Tdap) + dose number + date

- **Visit creation:** Select doctor (Dr. Lokender / Dr. Swati), visit type (new/follow-up/vaccination/emergency), date

- **OPD token:** After save, displays a printable token with UHID, name, age, vitals, doctor, allergy status

**Supabase tables**

READ/WRITE: patients, visits, vaccinations

## 5.5 Artifact 05 — Formulary Manager (Admin)

**Identifier**

radhakishan_formulary_v2

**Purpose**

Admin/pharmacist tool for adding and editing drug monographs. Full BNFC/Lexicomp-style monograph structure.

**Five-tab drawer structure**

|               |                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tab**       | **Contents**                                                                                                                                             |
| Identity      | Generic name, drug class, category, brands, therapeutic uses, licensed status, pregnancy/lactation                                                       |
| Formulations  | Each formulation: form, concentration qty+unit, per qty+unit, route, Indian brand name                                                                   |
| Dosing bands  | Multiple bands per drug: method, dose qty+unit, per-day/per-dose, frequency, duration, loading dose, max doses, rounding rule                            |
| Safety        | Black box warnings, contraindications, cross-reactions, interactions (with severity), monitoring parameters, renal bands (GFR tiers), hepatic adjustment |
| Admin & Notes | Reconstitution, dilution, infusion rate, food instructions, storage, clinical notes, reference sources                                                   |

## 5.6 Artifact 06 — Formulary Import Tool (Admin)

**Identifier**

radhakishan_formulary_importer

**Purpose**

Bulk-import drug data from any JSON format into the Supabase formulary table.

**Key features**

- Accepts any reasonable JSON structure — auto-detects field names (name/drug_name/generic/medicine_name all recognised)

- Parses dose strings: '40-90 mg/kg/day ÷ 3' → structured dosing band object

- Parses formulation strings: 'Syrup 125mg/5ml' → structured formulation object

- Preview table with per-drug validation status before import

- Upsert logic: updates existing drugs, inserts new ones — safe to re-run

- Import log with per-drug success/failure status

- Sample data loader with 3 complete reference entries (Amoxicillin, Paracetamol, Gentamicin)

## 5.7 Artifact 07 — Standard Prescriptions Manager (Admin)

**Identifier**

radhakishan_standard_rx_manager

**Purpose**

Add and manage ICD-10 keyed diagnosis protocols. These pre-populate the prescription generator when a matching diagnosis is identified.

**Key features**

- Built-in ICD-10 search (34 common paediatric diagnoses pre-loaded) — auto-fills diagnosis name and category

- First-line and second-line drug entries with separate dose qty, unit, basis, frequency, duration fields

- Investigations with urgency (same-day / routine)

- Counselling points as tag chips

- Referral criteria, hospitalisation criteria, clinical notes

- Category filter tabs for fast navigation

- Source/guideline attribution field (IAP 2024, BNFC, Radhakishan Protocol)

# 6. The Radhakishan Prescription Skill

## 6.1 What the Skill Is

The Skill is the system prompt embedded in the Claude.ai Project custom instructions. It is the clinical brain of the system — it contains all the rules that govern how Claude generates prescriptions. Every API call from every artifact uses this as the base system prompt, augmented with relevant knowledge from Supabase.

_The Skill is 18,376 characters (approximately 4,600 tokens). It is loaded once into the Project and applies to all conversations and artifact API calls within that project._

## 6.2 Skill Contents — Section by Section

|                                     |                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Section**                         | **Contents**                                                                                    |
| Hospital identity                   | Radhakishan Hospital, doctor names, NABH accreditation, output format declaration               |
| Output format                       | Complete JSON schema for prescription output with all required fields                           |
| Colour coding                       | Royal Blue = medicines, Red = investigations, Black = everything else                           |
| 3-row medicine format               | Row 1: GENERIC NAME (concentration), Row 2: English dose+instructions, Row 3: Hindi translation |
| Dose calculation — Method A         | Weight-based: mg/kg, mcg/kg, units/kg. Max dose rule. Rounding rules.                           |
| Dose calculation — Method B         | BSA-based: Mosteller formula. For chemotherapy, immunosuppressants.                             |
| Dose calculation — Method C         | GFR-adjusted: Schwartz formula. CKD staging. Drugs requiring renal adjustment.                  |
| Dose rounding rules                 | Syrups 0.5ml, drops 0.1ml, tablets ¼, insulin whole units, BSA exact                            |
| Standard prescriptions by diagnosis | 12 common diagnoses with first-line drugs and doses (IAP protocols)                             |
| IV fluid prescribing                | Holiday-Segar formula, bolus fluids, ORS, neonatal Day 1 fluid rules                            |
| Drug safety checks                  | Allergy, cross-reaction table, drug interaction examples                                        |
| Growth assessment                   | Chart selection rules (Fenton/WHO/IAP), Z-score classification, MUAC, corrected age rule        |
| Developmental screening             | TDSC, DDST-II, HINE, M-CHAT-R, LEST — by setting and age. Red flags.                            |
| IAP 2024 vaccination schedule       | Complete schedule by age band. Chronological age for vaccines (even preterms).                  |
| NABH 20-section compliance          | All 20 mandatory sections listed                                                                |
| Emergency warning signs             | 10 signs in bilingual (Hindi + English)                                                         |
| Triage scoring                      | 10-parameter scoring with action thresholds                                                     |
| Doctor authentication block         | Full doctor details, emergency contacts, AI draft disclaimer                                    |
| Antibiotic stewardship              | 9-point checklist                                                                               |
| 18 critical rules summary           | Cannot exceed max dose, always CAPITALS, always Hindi Row 3, corrected age, etc.                |

## 6.3 Critical Rules Enforced by the Skill

1.  NEVER exceed maximum dose regardless of calculated weight-based dose

2.  ALWAYS write generic names in CAPITALS

3.  ALWAYS include Hindi Row 3 for every medicine

4.  ALWAYS check allergy, cross-reactions, and drug interactions

5.  ALWAYS use CORRECTED AGE for preterms in growth and developmental assessment (until 2 years chronological age)

6.  ALWAYS use CHRONOLOGICAL AGE for vaccinations in preterms

7.  ALWAYS calculate and record WHO Z-scores (WAZ, HAZ, WHZ, HCZ)

8.  ALWAYS include IAP 2024 vaccination due/overdue status

9.  ALWAYS include bilingual emergency warning signs

10. ALWAYS end with complete doctor authentication block

11. The AI prescription is a DRAFT — doctor must review and approve

12. Never finalise a prescription without explicit doctor sign-off

# 7. Prescription Format — Clinical Standard

## 7.1 NABH-Mandated 20 Sections

|        |                                   |            |                                    |
| ------ | --------------------------------- | ---------- | ---------------------------------- |
| **\#** | **Section**                       | **Colour** | **Notes**                          |
| 1      | Patient demographics + UHID       | Black      | UHID mandatory — NABH CORE ★       |
| 2      | Anthropometry + WHO Z-scores      | Black      | Weight, height, HC, MUAC, Z-scores |
| 3      | Vitals                            | Black      | Temp, HR, RR, SpO₂                 |
| 4      | Chief complaints                  | Black      |                                    |
| 5      | History of present illness        | Black      |                                    |
| 6      | Past medical history              | Black      |                                    |
| 7      | Birth history                     | Black      |                                    |
| 8      | Developmental history + screening | Black      |                                    |
| 9      | Immunization history              | Black      |                                    |
| 10     | Dietary history                   | Black      |                                    |
| 11     | GPE / PICCLE                      | Black      | General physical examination       |
| 12     | Systemic examination              | Black      | Respiratory, CVS, Abdomen, Neuro   |
| 13     | Diagnosis + ICD-10 code           | Black      | Provisional and/or final           |
| 14     | Medication grid (3-row)           | Royal Blue | Generic names, CAPS, numbered      |
| 15     | IV fluids (if applicable)         | Black      | Volume ml, rate ml/hour mandatory  |
| 16     | Investigations                    | Red        | Test name + indication + urgency   |
| 17     | Follow-up                         | Black      | Days + next date                   |
| 18     | Immunization advice               | Black      | Due/overdue vaccines per IAP 2024  |
| 19     | Diet, home care + emergency signs | Black      | Bilingual (Hindi + English)        |
| 20     | Doctor authentication block       | Black      | Name, degree, reg no, date, time   |

## 7.2 3-Row Medicine Format

Every medicine must be written in exactly three rows, all in Royal Blue:

|         |              |                                                                                            |
| ------- | ------------ | ------------------------------------------------------------------------------------------ |
| **Row** | **Language** | **Content**                                                                                |
| Row 1   | English      | GENERIC NAME IN CAPITALS (Concentration — Indian market format e.g. 120mg/5ml)             |
| Row 2   | English      | Calculated dose (with working shown) + route + frequency + duration + special instructions |
| Row 3   | Hindi        | Exact Hindi translation of Row 2 in simple parent-friendly language                        |

Example — Paracetamol:

1. PARACETAMOL SUSPENSION (120 mg / 5 ml)

1½ teaspoon (7.5 ml) orally every 6 hours as needed for fever above 38°C.

Do not give if temperature \< 38°C. Max 4 doses/day.

डेढ़ चम्मच (7.5 ml) बुखार होने पर हर 6 घंटे में मुँह से दें।

38°C से कम तापमान पर न दें। दिन में 4 बार से ज़्यादा न दें।

Example — Injection (with dilution):

2. CEFTRIAXONE INJECTION (1 g/vial → reconstitute 10ml NS → 100mg/ml)

600mg (6ml) in 50ml NS, infuse IV over 30 minutes, once daily for 5 days.

600mg (6ml) को 50ml नॉर्मल सेलाइन में मिलाकर नस में 30 मिनट में धीरे-धीरे

चढ़ाएं, एक बार रोज़, 5 दिन तक।

## 7.3 Dose Rounding Rules

|                    |                               |                        |
| ------------------ | ----------------------------- | ---------------------- |
| **Formulation**    | **Express As**                | **Round To**           |
| Syrup (mg/5ml)     | ml or teaspoons (1 tsp = 5ml) | Nearest 0.5ml          |
| Oral drops (mg/ml) | ml                            | Nearest 0.1ml          |
| Tablet             | Whole, ½, or ¼ tablet         | Nearest ¼ tablet       |
| Injection IV/IM    | mg + ml + dilution + rate     | Exact to 0.1ml         |
| Insulin            | Units                         | Nearest whole unit     |
| BSA-based drugs    | Calculated mg/units           | Exact — state BSA used |

## 7.4 Smart Dose Adjustment (Inline)

When the doctor taps 'Adjust dose' on any medicine in the review screen, a calculation panel opens showing:

- Weight (kg) — editable

- mg/kg/day — editable

- Frequency (times/day) — editable

- Concentration (mg per unit) — editable

- Per volume (ml) — editable

- Max single dose cap (mg) — editable

As any field changes, the calculation updates live showing: mg/kg × weight = total/day ÷ frequency = per dose → rounded volume. When 'Apply' is pressed, Row 2 (English) and Row 3 (Hindi) both rewrite simultaneously. A green flash on the card confirms the update.

_This is the key UX innovation over traditional HMIS: the doctor changes one number and the entire bilingual prescription updates. No re-entering. No re-typing Hindi._

# 8. Growth Assessment Protocol

## 8.1 Chart Selection Rules

|                                                |                                          |                                     |
| ---------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| **Patient**                                    | **Chart**                                | **Parameters**                      |
| NICU / Preterm \< 40wks corrected age          | Fenton 2013                              | Weight, Length, HC — plotted weekly |
| Preterm post-discharge until 2yr corrected age | WHO 2006 — USE CORRECTED AGE             | WAZ, HAZ, WHZ, HCZ                  |
| Term infants 0-5 years                         | WHO 2006                                 | WAZ, HAZ, WHZ, HCZ                  |
| Children 5-18 years                            | IAP 2015 (BMI cut-offs: 23 & 27)         | Height, Weight, BMI                 |
| High-risk NICU graduates                       | Fenton 2013 → WHO 2006 → IAP 2015 at 5yr | All parameters                      |

> _CRITICAL PRETERM RULE: Always use CORRECTED AGE = Chronological age minus weeks of prematurity for ALL growth and developmental assessments until the child reaches 2 years of chronological age. EXCEPTION: Use chronological age for vaccinations even in preterms._

## 8.2 WHO Z-Score Classification

|               |             |                      |                                    |
| ------------- | ----------- | -------------------- | ---------------------------------- |
| **Parameter** | **Z-Score** | **Classification**   | **Action**                         |
| WAZ           | \< -3 SD    | Severely Underweight | Immediate nutritional intervention |
| WAZ           | \< -2 SD    | Underweight          | Nutritional counselling, monitor   |
| HAZ           | \< -3 SD    | Severe Stunting      | Investigate chronic malnutrition   |
| HAZ           | \< -2 SD    | Stunting             | Nutritional counselling            |
| WHZ / BMI     | \< -3 SD    | SAM                  | SAM protocol — NRC referral        |
| WHZ / BMI     | \< -2 SD    | MAM                  | MAM protocol — nutritional support |
| WHZ / BMI     | \> +2 SD    | Overweight           | Diet counselling                   |
| WHZ / BMI     | \> +3 SD    | Obese                | Specialist review                  |
| HCZ           | \< -2 SD    | Microcephaly         | Refer Neurology                    |
| HCZ           | \> +2 SD    | Macrocephaly         | Investigate                        |

## 8.3 MUAC (Mid-Upper Arm Circumference)

Used for 6 months to 5 years: \< 11.5cm = SAM (immediate intervention) | 11.5-12.5cm = MAM | ≥ 12.5cm = Normal

# 9. Developmental Screening Protocol

## 9.1 Screening Tools by Setting

|                                    |                                                      |                                                        |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| **Setting**                        | **Primary Tool**                                     | **Additional Tools**                                   |
| Routine OPD (all children)         | IAP Developmental Card                               | Clinical milestone assessment by history + observation |
| Children 0-6 years (formal screen) | TDSC — Trivandrum Development Screening Chart        | Denver DDST-II                                         |
| High-risk NICU graduates           | HINE — Hammersmith Infant Neurological Examination   | ASQ (Ages & Stages Questionnaire)                      |
| Autism concern 18-24 months        | M-CHAT-R (Modified Checklist for Autism in Toddlers) | M-CHAT-R/F if screen positive                          |
| Language delay                     | LEST — Language Evaluation Scale Trivandrum          | Refer Speech Therapy if positive                       |
| School age 5+ years                | IAP 2015 developmental criteria                      | Formal psychometric testing if GDD suspected           |

## 9.2 Developmental Red Flags — Immediate Referral

- No social smile by 3 months

- No babbling by 9 months

- No words by 16 months

- No 2-word phrases by 24 months

- ANY loss of previously acquired language or social skills at ANY age

- No head control by 4 months

- Hand dominance before 18 months (may indicate hemiplegia)

- No walking by 18 months

# 10. Vaccination Schedules (IAP 2024 + NHM-UIP)

The system supports both the **IAP 2024 ACVIP** schedule (recommended, includes paid vaccines) and the **NHM Universal Immunisation Programme** schedule (government free). The doctor specifies which schedule to use; default is IAP 2024. The skill prompt contains both schedules with a comparison table and Haryana-specific notes (Rotavirus & PCV free under UIP, JE not endemic, HPV state programme 2026-27).

## 10.1 IAP 2024 ACVIP Schedule

|               |                                                                                                   |               |                |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------- | -------------- |
| **Age**       | **Vaccines Due**                                                                                  | **Free/Paid** | **Route**      |
| Birth         | BCG, Hep B dose 1, OPV 0                                                                          | Free UIP      | ID / IM / Oral |
| 6 weeks       | DTwP/DTaP 1, IPV 1, Hib 1, PCV 1, Rotavirus 1, Hep B 2                                            | Free UIP      | IM / Oral      |
| 10 & 14 weeks | DTwP/DTaP 2&3, IPV 2&3, Hib 2&3, PCV 2&3, Rotavirus 2&3                                           | Free UIP      | IM / Oral      |
| 6-9 months    | OPV 1, Hep B 3, Influenza dose 1 (annual), MMR 1, OPV 2, TCV dose 1                               | UIP + Paid    | Oral / IM / SC |
| 12-18 months  | Hep A dose 1, PCV booster, MMR 2, Varicella 1, DTwP booster, IPV booster, Hib booster             | UIP + Paid    | IM / SC        |
| 2-6 years     | Typhoid booster, Influenza (annual), DTwP booster 2, OPV booster, Varicella 2, MMR 3 (optional)   | Paid          | IM / Oral / SC |
| 10-18 years   | Tdap, Typhoid booster, HPV 2 doses 6mo apart (boys & girls 9-14yr), Td booster 16-18yr (new 2024) | Paid          | IM             |

> _Vaccination age rule: Always use chronological age for all vaccinations — even for preterm infants. This is the opposite of the growth and developmental screening rule which uses corrected age._

# 11. Drug Safety Framework

## 11.1 Three Mandatory Safety Checks

Every prescription must complete all three checks before finalisation:

**Check 1: Allergy**

- Ask at every visit — do not rely on previous records alone

- Document NKDA (No Known Drug Allergy) if confirmed

- If allergy present: STOP, choose alternative, document in RED on prescription

**Allergy storage:** The `patients` table stores `known_allergies` as a text array (e.g., `{'Penicillin', 'Sulfa drugs'}`). This is displayed in RED in patient search results and should be included in every prescription generation prompt.

**POC (current):** Simple text array — the doctor enters comma-separated allergy names during patient registration. Displayed on the patient card. Claude uses this information during prescription generation to check for conflicts.

**Production (future):** Upgrade to structured JSONB: `[{"drug": "Penicillin", "reaction": "Anaphylaxis", "severity": "severe", "date_reported": "2026-01-15"}]`. This enables automated cross-reaction checking, severity-based alerts, and audit history of when allergies were reported.

**Check 2: Cross-Reaction**

|                     |                                               |                |                                                |
| ------------------- | --------------------------------------------- | -------------- | ---------------------------------------------- |
| **Primary Allergy** | **Cross-Reactive Drug Class**                 | **Risk**       | **Action**                                     |
| Penicillin          | Cephalosporins (1st/2nd gen)                  | ~1-2% (low)    | Use with caution; avoid if anaphylaxis history |
| Penicillin          | Carbapenems                                   | ~1% (very low) | Generally safe; monitor                        |
| Sulfonamides        | Thiazide diuretics, furosemide, sulfonylureas | Low            | Avoid if severe sulfa allergy                  |
| Aspirin / NSAIDs    | Other NSAIDs                                  | Moderate       | Avoid all NSAIDs if urticaria/bronchospasm     |
| Cephalosporins      | Carbapenems                                   | ~1%            | Usually safe; document and monitor             |

**Check 3: Drug Interactions (Critical Examples)**

|                              |                                |                                        |
| ---------------------------- | ------------------------------ | -------------------------------------- |
| **Interaction**              | **Effect**                     | **Action**                             |
| Erythromycin + Theophylline  | Theophylline toxicity (CYP450) | Adjust dose or choose alternative      |
| Fluconazole + Phenytoin      | Phenytoin toxicity (CYP450)    | Adjust dose or choose alternative      |
| Aminoglycoside + Furosemide  | Ototoxicity (additive)         | Avoid combination or monitor closely   |
| Two QT-prolonging drugs      | Arrhythmia risk                | Avoid combination                      |
| Ondansetron + Metoclopramide | Opposing gut motility effects  | Do not co-prescribe without indication |
| Ceftriaxone + Ca²⁺ solutions | Precipitation in IV line       | Use separate lines/bags                |
| Ciprofloxacin + milk         | Reduced absorption             | Space doses from dairy                 |

## 11.2 Maximum Dose Rule

> _ABSOLUTE RULE: The calculated dose (by weight, BSA, or any other method) MUST NEVER exceed the published maximum dose for that drug. If the calculated dose exceeds the maximum, prescribe the maximum dose, flag it on the prescription, and document this. This rule has no exceptions._

## 11.3 Antibiotic Stewardship Checklist

Every antibiotic prescription must verify: clinically indicated, site of infection documented, fever pattern documented, prior antibiotic in past 30 days asked, allergy checked, culture sent before starting (where relevant), narrowest appropriate antibiotic chosen, review date at 48-72 hours documented, parents counselled against unnecessary antibiotic use.

## 11.4 Safety Check Implementation

**POC (current):** All safety checks (allergy, cross-reaction, drug interactions, max dose verification) are performed by Claude AI during prescription generation. The AI outputs detailed findings in a structured `safety_checks` object within the prescription JSON — not blanket pass/fail booleans, but specific results for each check (e.g., which drugs were compared, what max dose was used, whether any interaction was found and what action was taken). The `overall_status` field is set to `"SAFE"` or `"REVIEW REQUIRED"`. The Prescription Pad artifact renders these findings for the doctor to review before sign-off.

**Production (future):** Client-side verification will independently cross-reference prescribed drugs against the formulary's `interactions`, `contraindications`, `black_box_warnings`, and `max_single_qty` / `max_daily_qty` values. This provides a second layer of validation — if the AI misses something, the client-side check catches it. The two results are compared and any disagreement is flagged.

# 12. NABH Compliance

## 12.1 Chapters Covered

|                  |                                 |                                                                                                                                                   |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NABH Chapter** | **Standard**                    | **How the System Addresses It**                                                                                                                   |
| AAC              | Assessment of Patients — CORE ★ | Demographics, anthropometry, WHO Z-scores, vitals, history, examination all captured and stored per visit                                         |
| COP              | Care of Patients                | Diagnosis with ICD-10 code, treatment plan, IV fluid prescribing, triage scoring, follow-up instructions                                          |
| MOM              | Medication Management           | Generic names in CAPITALS, doses by mg/kg/BSA/GFR, max dose verification, allergy/interaction checks, 3-row bilingual format                      |
| PFE              | Patient & Family Education      | Bilingual instructions (Hindi + English) on every medicine, emergency warning signs bilingual checklist, diet counselling, developmental guidance |
| IMS              | Information Management          | UHID mandatory, complete date/time, doctor signature and credentials, corrected age documented for preterms, all records in Supabase              |
| PRE              | Patient Rights & Education      | Informed counselling documented, emergency signs explained (tick-box format), doctor details and emergency contacts on every prescription         |

## 12.2 NABH Compliance Checklist on Every Prescription

- Allergy history asked and documented

- Cross-reaction risk assessed for all new drugs

- Drug interactions checked (all drugs against each other)

- IV fluid compatibility confirmed if IV drugs co-administered

- Dose verified against maximum dose limit

- GFR / renal function considered for renally cleared drugs

- Hepatic function considered for hepatically metabolised drugs

- Weight recorded today and dose recalculated if weight changed

- Antibiotic stewardship check completed (if antibiotic prescribed)

- Parents counselled on side effects of new medicines

## 12.3 Row Level Security and Access Control

**POC (current):** Row Level Security (RLS) is enabled on all 7 tables with a single policy: `auth.role() = 'authenticated'` grants full access. This means:

- Anonymous/unauthenticated requests are blocked
- Any authenticated Supabase user has full read/write access to all tables
- The anon key alone cannot access data — Supabase Auth must be configured and users must sign in
- **Prerequisite:** Supabase Auth must be set up with at least one user (doctor login) before the artifacts can connect. Until then, the artifacts should use the service_role key for development/testing only.

**Production (future):** Replace the blanket authenticated policy with per-doctor row-level policies:

- Each doctor sees only their own patients and prescriptions (filtered by `doctor_id`)
- Formulary and standard prescriptions remain readable by all authenticated doctors
- Admin role for data management (formulary editing, protocol management)
- Audit logging of all access and modifications (NABH IMS requirement)
- Consider Supabase Auth with email/password or OTP for doctor login

## 12.4 Doctors Reference Table

A `doctors` table stores credentials for all doctors (ID, full name, degree, registration number, specialisation). Seeded with Dr. Lokender Goyal and Dr. Swati Goyal.

**POC (current):** The table exists as a reference but is not FK-enforced. The artifacts use free-text `doctor_id` values (e.g., `'DR-LOKENDER'`) in visits, prescriptions, and vaccinations. The doctor selector dropdown in the Prescription Pad is hardcoded.

**Production (future):**

- Add foreign key constraints from `visits.doctor_id`, `prescriptions.approved_by`, and `vaccinations.given_by` to `doctors.id`
- Load the doctor dropdown dynamically from the `doctors` table
- Link `doctors.id` to Supabase Auth user IDs for per-doctor RLS policies
- Add PIN-based or password-based sign-off before prescription approval

## 12.5 Audit Log (Production)

**POC (current):** No dedicated audit log table. The `updated_at` timestamps on all tables and Supabase's built-in Postgres logs provide a minimal audit trail. The `prescriptions` table stores `version` and `edit_notes` for tracking post-approval edits.

**Production (future):** Create a dedicated `audit_log` table to satisfy NABH IMS requirements:

- Fields: `id`, `timestamp`, `user_id` (doctor), `action` (view/create/update/delete), `table_name`, `record_id`, `before_value` (JSONB), `after_value` (JSONB), `ip_address`
- Populated via Supabase database triggers on INSERT/UPDATE/DELETE for all clinical tables (patients, visits, prescriptions, vaccinations, growth_records)
- Read-only — no UPDATE or DELETE allowed on audit_log itself
- Retention policy: minimum 5 years per NABH medical records requirements
- Queryable by doctor, patient, date range for compliance audits

## 12.6 QR Code Library — Offline Consideration

**POC (current):** The Prescription Output artifact loads qrcodejs (v1.0.0, ~9 KB minified) from cdnjs CDN. If the CDN is unavailable (offline clinic), QR generation silently fails and shows a "QR" text fallback. This is acceptable for the POC since internet connectivity is required for Supabase access anyway.

**Production (future):** Bundle the qrcodejs library inline in the HTML artifact (only 9 KB). This ensures QR codes generate even if the CDN is temporarily unreachable. When migrating to a standalone React app, include `qrcode` as an npm dependency.

# 13. Technology Stack

|                 |                                   |                                      |
| --------------- | --------------------------------- | ------------------------------------ |
| **Component**   | **Technology**                    | **Version / Details**                |
| UI Framework    | Claude.ai Artifacts (HTML/CSS/JS) | Max Plan subscription                |
| AI Model        | Claude Sonnet                     | claude-sonnet-4-20250514             |
| Database        | Supabase (PostgreSQL)             | Free tier → Pro (\$25/mo)            |
| File Storage    | Supabase Storage                  | Included with Supabase               |
| Voice Dictation | Web Speech API                    | Chrome browser only, en-IN locale    |
| QR Code         | qrcodejs 1.0.0                    | CDN: cdnjs.cloudflare.com            |
| PDF (current)   | Browser print API                 | Print → Save as PDF                  |
| PDF (planned)   | jsPDF + html2canvas               | Client-side pixel-perfect generation |

## 13.1 Inter-Artifact Communication

Artifacts communicate via browser postMessage API. The message format:

window.parent.postMessage({

type: "radhakishan-rx",

payload: rxData // full prescription JSON

}, "\*")

The Output artifact listens for this message and renders automatically:

window.addEventListener("message", e =\> {

if (e.data && e.data.type === "radhakishan-rx") {

render(e.data.payload);

}

});

## 13.2 Supabase Integration Pattern

All artifacts use a common pattern for Supabase queries:

function sbFetch(table, query="", method="GET", body=null) {

return fetch(SB_URL + "/rest/v1/" + table + query, {

method,

headers: {

"apikey": KEY,

"Authorization": "Bearer " + KEY,

"Content-Type": "application/json",

"Prefer": method === "POST" ? "return=representation" : ""

},

body: body ? JSON.stringify(body) : null

});

}

> _CORS requirement: The Supabase project must have https://claude.ai added to allowed CORS origins in Project Settings → API → CORS before any artifact can connect._

# 14. Setup Instructions

## 14.1 Supabase Setup

13. Create account at supabase.com

14. New Project: 'Radhakishan Hospital' — Region: Southeast Asia (Singapore)

15. SQL Editor → New query → Paste 02_supabase_schema.sql → Run

16. Project Settings → API → Copy URL and anon key

17. Project Settings → API → CORS → Add https://claude.ai

18. Storage → New bucket → Name: 'prescriptions' → Public: ON

## 14.2 Claude.ai Project Setup

19. claude.ai → Projects → New Project → 'Radhakishan Hospital Rx'

20. Project Settings → Custom Instructions

21. Paste entire contents of 03_radhakishan_prescription_skill.md

22. Save

## 14.3 Populate Knowledge Base

23. Open Artifact 05 (Formulary Import Tool) → Connect Supabase

24. Paste drug JSON → Parse & Preview → Import

25. Open Artifact 04 (Formulary Manager) → review and enrich imported drugs

26. Open Artifact 06 (Standard Prescriptions Manager) → add diagnosis protocols

## 14.4 First Test

27. Open Artifact 01 (Prescription Pad) → Connect Supabase

28. Verify 'X drugs and Y protocols loaded' confirmation message

29. Type: 'Arjun, 8 months, 7.2 kg. Fever 3 days, left ear pain. Diagnosis: acute otitis media.'

30. Click Generate → Verify Amoxicillin + Paracetamol with correct doses + Hindi Row 3

31. Sign off → Verify record in Supabase Table Editor

# 15. SDK Migration Path

## 15.1 Migration Triggers

Migrate from Claude.ai to a full SDK-based application when ANY of these conditions are met:

- Volume exceeds 150 prescriptions per day (SDK becomes more cost-effective)

- More than 2 doctors using the system simultaneously (concurrency limits)

- Mobile app required (Android / iOS for ward rounds)

- HIS / EMR integration required

- Legal digital signature (DSC / PKI) required

- Offline mode required (no internet in clinic)

- Knowledge base exceeds 5MB browser storage limit

## 15.2 What Transfers Directly (Zero Rework)

|                                     |                     |                                        |
| ----------------------------------- | ------------------- | -------------------------------------- |
| **Component**                       | **Transfer Effort** | **Notes**                              |
| All system prompts / Skill          | Direct copy         | Paste into SDK system_prompt parameter |
| Supabase schema                     | Zero                | Unchanged — no migration               |
| All patient/visit/prescription data | Zero                | Already in Supabase                    |
| Formulary and standard Rx data      | Zero                | Already in Supabase                    |
| Clinical rules and NABH logic       | Direct copy         | From skill document                    |
| Dose calculation formulas           | Rewrite in Node.js  | Straightforward port                   |

## 15.3 Recommended SDK Stack

|                    |                                                                |
| ------------------ | -------------------------------------------------------------- |
| **Layer**          | **Technology**                                                 |
| Frontend (web)     | React 18 + Vite                                                |
| Frontend (mobile)  | React Native (shared logic with web)                           |
| Voice              | OpenAI Whisper API (better Hindi accuracy than Web Speech API) |
| AI Generation      | Anthropic SDK (claude-sonnet)                                  |
| Backend            | Node.js + Express (or Next.js API routes)                      |
| Database           | Supabase (existing — no change)                                |
| PDF                | Puppeteer (pixel-perfect, server-side)                         |
| Hosting (frontend) | Vercel (free CDN)                                              |
| Hosting (backend)  | Railway (~\$5/month)                                           |
| Auth               | Supabase Auth (doctor login)                                   |

## 15.4 Estimated Migration Effort

|                              |                           |
| ---------------------------- | ------------------------- |
| **Component**                | **Effort**                |
| Prescription Pad UI → React  | 2-3 weeks                 |
| Patient Lookup UI → React    | 1 week                    |
| Formulary Manager UI → React | 2 weeks                   |
| Output / PDF → Puppeteer     | 1 week                    |
| Voice → Whisper API upgrade  | 2 days                    |
| Backend API + deployment     | 1 week                    |
| Testing + parallel run       | 2 weeks                   |
| TOTAL                        | ~8 weeks with 1 developer |

# 16. Reference Sources

|                                                                  |                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Source**                                                       | **Used For**                                                     |
| Lexicomp — Pediatric Lexi-Drugs (latest edition)                 | Primary dose reference — standard doses, interactions, max doses |
| British National Formulary for Children (BNFC) 2025-26           | Secondary dose reference, neonatal guidance                      |
| British Neonatal Drug Formulary                                  | Neonatal doses, dilutions, GA-specific dosing                    |
| MIMS India (current edition)                                     | Indian market concentrations and brand availability              |
| CIMS India                                                       | Concentration and brand verification                             |
| IAP Drug Formulary                                               | Indian pediatric practice standards                              |
| Radhakishan Hospital Drug Formulary                              | In-house doses and dilution charts                               |
| Micromedex / Lexicomp Drug Interactions module                   | Interaction checking                                             |
| IAP 2024 Vaccination Schedule (ACVIP-IAP)                        | Immunization protocols                                           |
| NABH Hospital Accreditation Standards 6th Edition (January 2025) | Compliance framework                                             |
| WHO Child Growth Standards 2006                                  | Growth charts and Z-score tables (0-5 years)                     |
| IAP 2015 Revised Growth Charts                                   | Growth reference (5-18 years)                                    |
| Fenton 2013 Preterm Growth Chart                                 | NICU and preterm growth plotting                                 |
| TDSC — Trivandrum Development Screening Chart                    | Developmental screening tool                                     |
| M-CHAT-R                                                         | Autism screening (18-24 months)                                  |

# 17. Glossary

|               |                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Term**      | **Definition**                                                                                                        |
| AGA           | Appropriate for Gestational Age                                                                                       |
| BSA           | Body Surface Area — calculated using Mosteller formula: √(Ht×Wt/3600)                                                 |
| CORRECTED AGE | Chronological age minus weeks of prematurity. Used for growth and development in preterms until 2yr chronological age |
| DDST-II       | Denver Developmental Screening Test — developmental screening tool                                                    |
| eGFR          | Estimated Glomerular Filtration Rate — calculated using Schwartz formula: k × Height(cm) / Serum Creatinine           |
| GA            | Gestational Age in weeks                                                                                              |
| GPE / PICCLE  | General Physical Examination / Pallor, Icterus, Cyanosis, Clubbing, Lymphadenopathy, Edema                            |
| HAZ           | Height-for-Age Z-score                                                                                                |
| HCZ           | Head Circumference-for-Age Z-score                                                                                    |
| HINE          | Hammersmith Infant Neurological Examination                                                                           |
| HMCI          | Haryana Medical Council of India                                                                                      |
| IAP           | Indian Academy of Pediatrics                                                                                          |
| LEST          | Language Evaluation Scale Trivandrum                                                                                  |
| MAM           | Moderate Acute Malnutrition (WHZ \< -2 SD OR MUAC 11.5-12.5cm)                                                        |
| M-CHAT-R      | Modified Checklist for Autism in Toddlers — Revised                                                                   |
| MUAC          | Mid-Upper Arm Circumference                                                                                           |
| NABH          | National Accreditation Board for Hospitals & Healthcare Providers                                                     |
| NKDA          | No Known Drug Allergy                                                                                                 |
| PDMP          | Prescription Drug Monitoring Program                                                                                  |
| PNA           | Postnatal Age in days                                                                                                 |
| SAM           | Severe Acute Malnutrition (WHZ \< -3 SD OR MUAC \< 11.5cm)                                                            |
| SGA           | Small for Gestational Age                                                                                             |
| TDSC          | Trivandrum Development Screening Chart                                                                                |
| UHID          | Unique Health Identification Number (format: RKH-YYMM#####, e.g. RKH-25260300001)                                     |
| UIP           | Universal Immunization Programme (Government of India — free vaccines)                                                |
| WAZ           | Weight-for-Age Z-score                                                                                                |
| WHZ           | Weight-for-Height Z-score (or BMI-for-Age in older children)                                                          |

_End of Specification Document_

Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana · NABH Accredited

Dr. Lokender Goyal & Dr. Swati Goyal · Edition 2026
