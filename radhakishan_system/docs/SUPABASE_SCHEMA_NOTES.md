# Supabase Schema Notes

## Radhakishan Hospital Prescription System

---

## Table: formulary

Central drug knowledge base. One row per drug.

### Key JSONB fields explained

**formulations** (array) — each entry:

```json
{
  "form": "syrup",
  "conc_qty": 120,
  "conc_unit": "mg",
  "per_qty": 5,
  "per_unit": "ml",
  "route": "oral",
  "indian_brand": "Calpol 120mg/5ml"
}
```

**dosing_bands** (array) — each entry supports all 6 dosing methods:

```json
{
  "indication": "Fever / pain",
  "age_band": "all",
  "method": "weight",
  "dose_min_qty": 15,
  "dose_max_qty": 15,
  "dose_unit": "mg",
  "is_per_day": false,
  "frequency_per_day": 4,
  "interval_hours": 6,
  "duration_days": 3,
  "max_single_qty": 1000,
  "max_single_unit": "mg",
  "max_daily_qty": 4000,
  "max_daily_unit": "mg",
  "loading_dose_qty": null,
  "loading_dose_unit": null,
  "rounding_rule": "0.5ml",
  "notes": "PRN only. Do not give if temp < 38°C."
}
```

Dosing method values: `weight` | `bsa` | `fixed` | `gfr` | `infusion` | `age`

**renal_bands** (array):

```json
{
  "gfr_min": 0,
  "gfr_max": 30,
  "action": "extend_interval",
  "note": "Extend to q24-48h. Monitor serum levels."
}
```

Action values: `reduce_dose` | `extend_interval` | `reduce_and_extend` | `avoid` | `no_adjustment`

**interactions** (array):

```json
{
  "drug": "Warfarin",
  "severity": "major",
  "effect": "Increased bleeding risk — avoid combination"
}
```

Severity values: `black_box` | `major` | `moderate` | `minor`

**administration** (array):

```json
{
  "route": "iv",
  "reconstitution": "Dissolve vial in 10ml WFI → 100mg/ml",
  "dilution": "Dilute dose in 50ml NS",
  "infusion_rate": "Infuse over 30 minutes. Incompatible with Ca²⁺ solutions."
}
```

---

## Table: standard_prescriptions

ICD-10 keyed protocols. Fetched at prescription generation time.

**first_line_drugs** (array):

```json
{
  "drug": "AMOXICILLIN",
  "dose_qty": 80,
  "dose_unit": "mg",
  "dose_basis": "per_kg",
  "is_per_day": true,
  "frequency_per_day": 3,
  "duration_days": 7,
  "route": "oral",
  "notes": "High-dose AOM protocol per IAP 2024"
}
```

dose_basis values: `per_kg` | `per_m2` | `per_dose`

**investigations** (array):

```json
{
  "name": "CBC with differential",
  "indication": "Fever > 3 days, rule out bacterial infection",
  "urgency": "same-day"
}
```

---

## Table: patients

```
id              TEXT PRIMARY KEY    Format: RH-A123456
name            TEXT
dob             DATE
sex             TEXT               Male / Female
guardian_name   TEXT
guardian_relation TEXT
contact_phone   TEXT
gestational_age_weeks NUMERIC     Neonatal only
birth_weight_kg NUMERIC           Neonatal only
```

---

## Table: visits

```
id              UUID (auto)
patient_id      TEXT → patients.id
visit_date      DATE
doctor_id       TEXT               DR-LOKENDER / DR-SWATI
weight_kg       NUMERIC
height_cm       NUMERIC
hc_cm           NUMERIC
muac_cm         NUMERIC
temp_f          NUMERIC
hr_per_min      INTEGER
rr_per_min      INTEGER
spo2_pct        NUMERIC
chief_complaints TEXT
diagnosis_codes  JSONB             [{icd10, name, type}]
clinical_notes  TEXT
raw_dictation   TEXT               Doctor's original note saved
triage_score    INTEGER
```

---

## Table: prescriptions

```
id              TEXT PRIMARY KEY    Format: RX-XXXXXXXX
visit_id        UUID → visits.id
patient_id      TEXT → patients.id
generated_json  JSONB              Full AI-generated prescription
medicines       JSONB              Extracted medicines array
investigations  JSONB              Extracted investigations
vaccinations    JSONB              Vaccination status snapshot
growth          JSONB              Growth assessment
is_approved     BOOLEAN
approved_by     TEXT               Doctor ID
approved_at     TIMESTAMPTZ
pdf_url         TEXT               Supabase Storage URL
qr_data         JSONB              {rx, uhid, pt, date, dx}
version         INTEGER            For edits after approval
edit_notes      TEXT
```

---

## Table: vaccinations

```
id              SERIAL
patient_id      TEXT → patients.id
vaccine_name    TEXT
dose_number     INTEGER
date_given      DATE
next_due_date   DATE
batch_number    TEXT
given_by        TEXT
visit_id        UUID → visits.id
free_or_paid    TEXT               free_uip / paid
route           TEXT
site            TEXT
```

---

## Table: growth_records

```
id              SERIAL
patient_id      TEXT → patients.id
visit_id        UUID → visits.id
recorded_date   DATE
weight_kg       NUMERIC
height_cm       NUMERIC
hc_cm           NUMERIC
muac_cm         NUMERIC
waz             NUMERIC            Weight-for-Age Z-score
haz             NUMERIC            Height-for-Age Z-score
whz             NUMERIC            Weight-for-Height Z-score
hcaz            NUMERIC            Head Circumference-for-Age Z-score
chart_used      TEXT               WHO2006 / IAP2015 / Fenton2013
classification  TEXT               Well nourished / MAM / SAM / etc.
```

---

## Supabase Storage Structure

```
Bucket: prescriptions (public)
/
└── {patient_id}/
    └── {rx_id}.txt   (prescription text, upgradeable to PDF)
```

Future upgrade: use jsPDF + html2canvas for pixel-perfect PDF upload.

---

## Row Level Security (Production)

When ready to restrict access by doctor login:

```sql
-- Enable RLS
alter table patients enable row level security;
alter table visits enable row level security;
alter table prescriptions enable row level security;

-- Policy: authenticated users can access all records
-- (customize per doctor when multi-user auth is needed)
create policy "authenticated_access" on patients
  for all using (auth.role() = 'authenticated');
```

---

_Radhakishan Hospital | Schema Reference | Edition 2026_
