# Artifact Inventory — Radhakishan Hospital Prescription System

All artifacts are Claude.ai interactive widgets. They can be re-generated
from the conversation or copy-pasted into new Claude.ai artifacts.

---

## Artifact 01 — Prescription Pad (Connected)

**Title in Claude.ai:** `radhakishan_connected_prescription_system`
**Purpose:** Main doctor-facing tool
**Key features:**

- Voice dictation (Chrome, en-IN)
- Patient search from Supabase
- Optional module sections (investigations, growth, vaccination, etc.)
- Calls Claude API with formulary + standard Rx context from Supabase
- Smart inline dose adjustment with live recalculation
- Hindi + English bilingual output
- Sign-off saves to: patients, visits, prescriptions, growth_records tables
- Uploads prescription file to Supabase Storage
- postMessage to Output artifact

**Supabase tables used:** patients, visits, prescriptions, growth_records, formulary, standard_prescriptions

---

## Artifact 02 — Prescription Output

**Title in Claude.ai:** `radhakishan_prescription_output_v2`
**Purpose:** Render final prescription for printing
**Key features:**

- Modular — only present sections render
- Full Radhakishan Hospital letterhead
- QR code (qrcodejs)
- Print-optimised A4 CSS
- Receives prescription JSON via postMessage OR paste
- Colour coding: Blue=medicines, Red=investigations, Black=rest

---

## Artifact 03 — Patient Lookup

**Title in Claude.ai:** `radhakishan_patient_lookup`
**Purpose:** Search patients, view history, load previous Rx
**Key features:**

- Live search by name, UHID, phone
- New patient registration (auto-generates UHID)
- View visits, prescriptions, growth records per patient
- Reuse previous prescription as template (postMessage to pad)
- Growth trend with Z-score colour chips

**Supabase tables used:** patients, visits, prescriptions, growth_records, vaccinations

---

## Artifact 04 — Formulary Manager

**Title in Claude.ai:** `radhakishan_formulary_v2`
**Purpose:** Add/edit drug monographs
**Key features:**

- 5-tab drawer: Identity, Formulations, Dosing bands, Safety, Admin
- All 6 dosing methods: weight, BSA, fixed, GFR, infusion, age-band
- Quantity and unit stored separately
- Loading dose separate from maintenance
- Renal bands with GFR thresholds
- Drug interactions with severity levels
- Black box warnings, contraindications, cross-reactions
- Category filter tabs
- Search by name, class, brand

**Supabase table used:** formulary

---

## Artifact 05 — Formulary Import Tool

**Title in Claude.ai:** `radhakishan_formulary_importer`
**Purpose:** Bulk import drugs from JSON
**Key features:**

- Accepts any reasonable JSON format
- Auto-detects field names (name, drug_name, generic, etc.)
- Parses dose strings ("40-90 mg/kg/day ÷ 3")
- Parses formulation strings ("Syrup 125mg/5ml")
- Preview table with validation status
- Upsert (update if exists, insert if new)
- Import log with per-drug status
- Sample data loader

**Supabase table used:** formulary

---

## Artifact 06 — Standard Prescriptions Manager

**Title in Claude.ai:** `radhakishan_standard_rx_manager`
**Purpose:** Manage ICD-10 keyed prescription protocols
**Key features:**

- Built-in ICD-10 search (34 common paediatric diagnoses)
- 5-tab drawer: Diagnosis, First-line, Alternatives, Investigations, Guidance
- Dose quantity, unit, basis (per_kg/per_m2/per_dose) all separate
- Counselling points as tags
- Referral criteria, hospitalisation criteria
- Category filter tabs
- Source/guideline attribution

**Supabase table used:** standard_prescriptions

---

## Supporting Files

### schema/radhakishan_supabase_schema.sql

Complete PostgreSQL schema for all 7 tables.
Run in Supabase SQL Editor on first setup.
Tables: formulary, standard_prescriptions, patients, visits,
prescriptions, vaccinations, growth_records
Includes: indexes, foreign keys, updated_at triggers

### skill/radhakishan_prescription_skill.md

Complete system prompt / skill for the Claude.ai Project.
Contains all clinical rules from:

- OPD Prescription Rulebook v2 (Radhakishan Hospital, Edition 2026)
- NABH HCO 6th Edition Guide
- IAP 2024 vaccination schedule
- WHO growth chart rules
- Developmental screening protocols
- Drug safety check rules
- 3-row bilingual medicine format
- 12 Core Prescription Rules

Paste into: Claude.ai → Projects → Radhakishan Hospital Rx → Custom Instructions

---

_Radhakishan Hospital Prescription System | Built March 2026_
