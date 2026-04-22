# Standard Prescriptions Database Specification

**System**: Radhakishan Hospital Pediatric OPD Prescription System
**Table**: `standard_prescriptions`
**Current count**: 24 protocols across 9 categories
**Last updated**: 2026-03-25

---

## 1. Table Schema

Defined in `radhakishan_system/schema/radhakishan_supabase_schema.sql` (lines 174-217) with ABDM extensions in `radhakishan_system/schema/abdm_schema.sql` (lines 47-48) and additional columns in `radhakishan_system/scripts/migrate_stdpx_new_fields.sql`.

### All Columns

| Column                     | Type          | Constraints                     | Description                                                                                                       |
| -------------------------- | ------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid`        | PK, default `gen_random_uuid()` | Auto-generated primary key                                                                                        |
| `icd10`                    | `text`        | nullable, NOT unique            | ICD-10 code (e.g. "J00", "J21.9"). Not unique because same code may have different protocols by category/severity |
| `diagnosis_name`           | `text`        | NOT NULL                        | Standard medical diagnosis name (e.g. "Common Cold / Acute Rhinopharyngitis")                                     |
| `category`                 | `text`        | nullable                        | Clinical category (e.g. "Respiratory", "GI", "ENT", "Infectious", "Neonatal")                                     |
| `severity`                 | `text`        | default `'any'`                 | Severity qualifier (e.g. "any", "mild", "moderate", "severe")                                                     |
| `first_line_drugs`         | `jsonb`       | CHECK `jsonb_typeof = 'array'`  | First-line treatment drugs (see section 3)                                                                        |
| `second_line_drugs`        | `jsonb`       | CHECK `jsonb_typeof = 'array'`  | Second-line/alternative drugs (same structure)                                                                    |
| `investigations`           | `jsonb`       | CHECK `jsonb_typeof = 'array'`  | Recommended investigations (see section 4)                                                                        |
| `duration_days_default`    | `integer`     | nullable                        | Default treatment duration in days                                                                                |
| `counselling`              | `text[]`      | nullable                        | Parent counselling points (see section 5)                                                                         |
| `warning_signs`            | `jsonb`       | CHECK `jsonb_typeof = 'array'`  | Danger signs requiring immediate medical attention (see section 6)                                                |
| `referral_criteria`        | `text`        | nullable                        | When to refer to specialist                                                                                       |
| `hospitalisation_criteria` | `text`        | nullable                        | When to admit                                                                                                     |
| `expected_course`          | `text`        | nullable                        | Natural history (e.g. "Fever: 2-3 days. Cough: 5-7 days."). Added by migration                                    |
| `key_clinical_points`      | `text[]`      | nullable                        | Clinical pearls for the doctor. Added by migration                                                                |
| `severity_assessment`      | `jsonb`       | nullable                        | Severity grading object (e.g. `{mild: "...", moderate: "...", severe: "..."}`). Added by migration                |
| `monitoring_parameters`    | `jsonb`       | nullable                        | Monitoring schedule (e.g. `[{parameter: "Temperature", frequency: "4-hourly"}]`). Added by migration              |
| `notes`                    | `text`        | nullable                        | General clinical notes and management guidance                                                                    |
| `source`                   | `text`        | nullable                        | Guideline references (e.g. "IAP 2024, WHO 2023, ACCP 2017")                                                       |
| `guideline_changes`        | `text`        | nullable                        | Recent guideline updates relevant to this diagnosis                                                               |
| `last_reviewed_date`       | `date`        | nullable                        | Last clinical review date                                                                                         |
| `snomed_code`              | `text`        | nullable                        | SNOMED CT diagnosis code (added by abdm_schema.sql)                                                               |
| `active`                   | `boolean`     | default `true`                  | Soft delete flag                                                                                                  |
| `created_at`               | `timestamptz` | default `now()`                 | Row creation timestamp                                                                                            |
| `updated_at`               | `timestamptz` | default `now()`                 | Auto-updated via trigger `trg_stdpx_updated`                                                                      |

Note: `snomed_display` is present in some JSON data entries but is NOT a database column -- it exists only in the import data for reference.

### Indexes

| Index                     | Type   | Column(s)        | Notes                            |
| ------------------------- | ------ | ---------------- | -------------------------------- |
| `idx_stdpx_icd10`         | B-tree | `icd10`          | Full index on ICD-10             |
| `idx_stdpx_icd10_partial` | B-tree | `icd10`          | Partial: WHERE icd10 IS NOT NULL |
| `idx_stdpx_name`          | B-tree | `diagnosis_name` |                                  |
| `idx_stdpx_cat`           | B-tree | `category`       |                                  |
| `idx_stdpx_active`        | B-tree | `active`         |                                  |

### Row Level Security

RLS enabled. Current policy: `authenticated_full_access` (POC mode). `updated_at` auto-maintained by `update_updated_at()` trigger.

---

## 2. Category Distribution

Current data in `standard_prescriptions_data_new.json` (24 protocols):

| Category    | Count |
| ----------- | ----- |
| Respiratory | 5     |
| GI          | 7     |
| ENT         | 4     |
| Infectious  | 3     |
| Neonatal    | 1     |
| Emergency   | 1     |
| Dermatology | 1     |
| Urology     | 1     |
| General     | 1     |

The `ai-protocol-lookup` Edge Function defines 16 valid categories: Respiratory, ENT, GI, Infectious, Neurology, Neonatal, Endocrine, Emergency, Dermatology, Haematology, Renal, Allergy, Musculoskeletal, Ophthalmology, Cardiovascular, Developmental.

---

## 3. Protocol Structure: first_line_drugs / second_line_drugs

Each entry in the `first_line_drugs` or `second_line_drugs` JSONB array:

```json
{
  "drug": "Paracetamol",
  "notes": "10-15 mg/kg/dose PO q6-8h SOS for fever >100F, drops/syrup",
  "is_new_2024_2025": false
}
```

| Field              | Type    | Description                                                                  |
| ------------------ | ------- | ---------------------------------------------------------------------------- |
| `drug`             | string  | Generic drug name. Should match `formulary.generic_name` for cross-reference |
| `notes`            | string  | Dosing guidance, route, frequency, duration, and clinical context            |
| `is_new_2024_2025` | boolean | Whether this is a new addition from 2024-2025 guideline updates              |

**Schema definition** (in SQL comments) specifies a more structured format:

```
{drug, dose_qty, dose_unit, dose_basis: per_kg|per_m2|per_dose, is_per_day, frequency_per_day, duration_days, route, notes}
```

However, the actual data uses the simpler `{drug, notes, is_new_2024_2025}` format, with dosing details embedded in the `notes` string rather than as separate structured fields.

### Drug Name Consistency with Formulary

Drug names in `first_line_drugs[].drug` should match `formulary.generic_name` for the AI to cross-reference dosing bands. Some entries use non-formulary names (e.g. "Cough Management (Honey + Warm Fluids)", "Oxygen Therapy", "Nasal Suction", "Preterm Formula / Fortified Feeds") -- these represent non-pharmacological interventions and will not match formulary lookups.

---

## 4. Investigations Structure

Each entry in the `investigations` JSONB array:

```json
{
  "name": "Complete blood count",
  "indication": "Persistent high fever >3 days or toxic look",
  "urgency": "routine"
}
```

| Field        | Type   | Allowed Values        | Description                      |
| ------------ | ------ | --------------------- | -------------------------------- |
| `name`       | string |                       | Investigation name               |
| `indication` | string |                       | When to order this investigation |
| `urgency`    | string | `same-day`, `routine` | Timing urgency                   |

### Example from Prematurity Follow-up (P07.3):

```json
[
  {
    "name": "Hemoglobin",
    "indication": "Screen for anemia at 3-4 months",
    "urgency": "routine"
  },
  {
    "name": "ROP Screening",
    "indication": "Retinopathy of prematurity screening as per schedule",
    "urgency": "routine"
  },
  {
    "name": "Hearing screening (OAE/BERA)",
    "indication": "All preterm infants, once",
    "urgency": "routine"
  },
  {
    "name": "Weight monitoring",
    "indication": "Weekly weight check for growth assessment",
    "urgency": "routine"
  },
  {
    "name": "Length and Head Circumference",
    "indication": "Monthly anthropometry",
    "urgency": "routine"
  }
]
```

---

## 5. Counselling Structure

The `counselling` column is a `text[]` (PostgreSQL text array). Each element is a single counselling point:

```json
[
  "This is a viral illness - antibiotics are not needed",
  "Medicines are only for symptom relief, not to cure the cold",
  "Continue breastfeeding / ORS / fluids frequently",
  "Continue feeding with small frequent feeds",
  "Keep child warm, avoid cold exposure",
  "Avoid over-medication",
  "Report immediately if fast breathing or chest retractions",
  "Report immediately if poor feeding or persistent vomiting",
  "Report immediately if lethargy or irritability",
  "Report immediately if fever persists >3 days",
  "Report immediately if oxygen saturation drops"
]
```

Points prefixed with "Report immediately if" function as warning signs mixed into counselling. AI translates these to Hindi at prescription time.

---

## 6. Warning Signs Structure

The `warning_signs` column is a JSONB array of English strings:

```json
[
  "Fast breathing or chest indrawing",
  "Bluish discoloration of lips or tongue",
  "Convulsions or fits",
  "Excessive sleepiness or unresponsive",
  "Poor feeding or refusal to eat",
  "Persistent vomiting",
  "Fever not responding to medication for more than 3 days",
  "Drop in oxygen saturation"
]
```

These are danger signs requiring immediate medical attention. AI translates them to Hindi on the prescription output.

---

## 7. SNOMED Diagnosis Mapping

Each protocol can optionally carry a SNOMED CT code for the diagnosis:

| Field            | Source                                     | Description                                             |
| ---------------- | ------------------------------------------ | ------------------------------------------------------- |
| `snomed_code`    | Database column (added by abdm_schema.sql) | SNOMED CT diagnosis concept code                        |
| `snomed_display` | JSON data only (not a DB column)           | SNOMED CT display name (e.g. "Baby premature 29 weeks") |

Of 24 current protocols, 23 have a `snomed_code` and 7 have a `snomed_display` in the data file.

### Example SNOMED mappings:

| ICD-10 | Diagnosis                            | SNOMED Code       | SNOMED Display          |
| ------ | ------------------------------------ | ----------------- | ----------------------- |
| J00    | Common Cold / Acute Rhinopharyngitis | 82272006          | --                      |
| P07.3  | Prematurity Follow-up                | 15750041000189101 | Baby premature 29 weeks |
| J21.9  | Acute Bronchiolitis                  | 4120002           | --                      |
| A09    | Acute Gastroenteritis (AGE)          | 25458004          | --                      |

SNOMED codes were imported via `radhakishan_system/scripts/import_snomed_diagnosis_mappings.js`.

---

## 8. Severity Assessment, Monitoring Parameters, Expected Course, Key Clinical Points

These four fields were added by a migration (`radhakishan_system/scripts/migrate_stdpx_new_fields.sql`):

```sql
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS expected_course text;
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS key_clinical_points text[];
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS severity_assessment jsonb;
ALTER TABLE standard_prescriptions ADD COLUMN IF NOT EXISTS monitoring_parameters jsonb;
```

These fields exist in the database schema but are not present in the current `standard_prescriptions_data_new.json` data (verified: zero matches for these field names in the JSON file). They are available for future protocol enrichment and are included in the Edge Function's SELECT queries.

**Expected structures** (from DDL comments):

- `severity_assessment`: `{"mild": "description", "moderate": "description", "severe": "description"}`
- `monitoring_parameters`: `[{"parameter": "Temperature", "frequency": "4-hourly"}, ...]`
- `expected_course`: Free text, e.g. "Fever: 2-3 days. Cough: 5-7 days. Full recovery: 7-10 days."
- `key_clinical_points`: `text[]`, e.g. `["Lactulose = cornerstone", "Avoid unnecessary antibiotics"]`

---

## 9. Complete Protocol Example (from actual data)

### Common Cold (J00)

```json
{
  "icd10": "J00",
  "diagnosis_name": "Common Cold / Acute Rhinopharyngitis",
  "category": "Respiratory",
  "severity": "any",
  "first_line_drugs": [
    {
      "drug": "Paracetamol",
      "notes": "10-15 mg/kg/dose PO q6-8h SOS for fever >100F, drops/syrup",
      "is_new_2024_2025": false
    },
    {
      "drug": "Sodium Chloride Nasal Drops",
      "notes": "0.65% normal saline, 2-3 drops each nostril 4-6 times/day",
      "is_new_2024_2025": false
    },
    {
      "drug": "Chlorpheniramine + Phenylephrine",
      "notes": "Antihistamine-decongestant drops, dose as per weight, TDS, max 5 days. Use cautiously in infants",
      "is_new_2024_2025": false
    },
    {
      "drug": "Karvol Plus Capsule (Inhalation)",
      "notes": "Add in warm water or inhalation cloth, 2-3 times/day for congestion relief",
      "is_new_2024_2025": false
    },
    {
      "drug": "Cough Management (Honey + Warm Fluids)",
      "notes": "Honey (>1 year only) + warm fluids. Avoid strong cough syrups in infants",
      "is_new_2024_2025": false
    }
  ],
  "second_line_drugs": [],
  "investigations": [
    {
      "name": "Complete blood count",
      "indication": "Persistent high fever >3 days or toxic look",
      "urgency": "routine"
    },
    {
      "name": "CRP",
      "indication": "Suspicion of bacterial infection",
      "urgency": "routine"
    }
  ],
  "duration_days_default": 5,
  "counselling": [
    "This is a viral illness - antibiotics are not needed",
    "Medicines are only for symptom relief, not to cure the cold",
    "Continue breastfeeding / ORS / fluids frequently",
    "Continue feeding with small frequent feeds",
    "Keep child warm, avoid cold exposure",
    "Avoid over-medication",
    "Report immediately if fast breathing or chest retractions",
    "Report immediately if poor feeding or persistent vomiting",
    "Report immediately if lethargy or irritability",
    "Report immediately if fever persists >3 days",
    "Report immediately if oxygen saturation drops"
  ],
  "warning_signs": [
    "Fast breathing or chest indrawing",
    "Bluish discoloration of lips or tongue",
    "Convulsions or fits",
    "Excessive sleepiness or unresponsive",
    "Poor feeding or refusal to eat",
    "Persistent vomiting",
    "Fever not responding to medication for more than 3 days",
    "Drop in oxygen saturation"
  ],
  "referral_criteria": "Refer if persistent high fever >3 days, toxic appearance, or suspicion of bacterial complication",
  "hospitalisation_criteria": "Admit if severe respiratory distress, poor feeding, dehydration, or toxic appearance",
  "notes": "Viral illness, self-limiting 5-7 days. No routine antibiotics. Symptomatic management is mainstay. Honey for cough (>1 year only). Steam/menthol inhalation 2-3 times/day for congestion relief. Antibiotics only if secondary bacterial infection suspected.",
  "source": "IAP 2024, WHO 2023, ACCP 2017",
  "guideline_changes": "IAP 2024: Continued emphasis on no routine antibiotics or OTC cough/cold medicines in children; ACCP: Recommends against OTC cough suppressants in pediatric URI; No major guideline changes in 2024-2025 for common cold management",
  "snomed_code": "82272006",
  "active": true
}
```

---

## 10. API Endpoints and Data Flow

### 10.1 Edge Function: `get_standard_rx` Tool

Defined in `supabase/functions/generate-prescription/index.ts` (line 89-109, executed at line 288-336).

**Tool definition** sent to Claude:

```json
{
  "name": "get_standard_rx",
  "description": "Look up hospital-approved standard prescription protocols. ALWAYS use ICD-10 code as the primary lookup...",
  "input_schema": {
    "type": "object",
    "properties": {
      "icd10": {
        "type": "string",
        "description": "ICD-10 code (e.g. 'H66.90', 'J06.9', 'A09'). PREFERRED -- use this as the primary lookup key."
      },
      "name": {
        "type": "string",
        "description": "Standard medical diagnosis name (e.g. 'Acute Otitis Media'). Use only as fallback if ICD-10 code is unknown."
      }
    },
    "required": []
  }
}
```

**3-Strategy Lookup** (`executeGetStandardRx`, line 288):

1. **Strategy 1 -- Exact ICD-10 match** (preferred):

   ```
   GET /rest/v1/standard_prescriptions
     ?icd10=eq.<code>
     &active=eq.true
     &select=<17 columns>
     &limit=5
   ```

2. **Strategy 2 -- Partial ICD-10 match** (prefix):

   ```
   GET /rest/v1/standard_prescriptions
     ?icd10=ilike.<code>%25
     &active=eq.true
     &select=<17 columns>
     &limit=5
   ```

   This catches cases like searching "H66" matching "H66.90".

3. **Strategy 3 -- Diagnosis name match** (fallback):
   ```
   GET /rest/v1/standard_prescriptions
     ?diagnosis_name=ilike.%25<name>%25
     &active=eq.true
     &select=<17 columns>
     &limit=5
   ```

**Selected columns** (all strategies):

```
icd10, diagnosis_name, snomed_code, first_line_drugs, second_line_drugs, investigations,
counselling, warning_signs, referral_criteria, hospitalisation_criteria, expected_course,
key_clinical_points, severity_assessment, monitoring_parameters, guideline_changes,
notes, duration_days_default
```

**No match**: Returns `"No hospital protocol found for <searched>. Use standard clinical guidelines."`

### 10.2 Prescription Pad: `preloadKnowledge()` and `stdRxCache`

In `web/prescription-pad.html` (line 3015):

**REST query**:

```
GET /rest/v1/standard_prescriptions
  ?select=icd10,diagnosis_name,snomed_code,first_line_drugs,second_line_drugs,investigations,counselling,warning_signs,referral_criteria,hospitalisation_criteria,notes,duration_days_default
  &active=eq.true
```

**Dual-key cache** (line 3053-3055):

```javascript
stds.forEach((s) => {
  if (s.icd10) stdRxCache[s.icd10.toUpperCase()] = s;
  if (s.diagnosis_name) stdRxCache[s.diagnosis_name.toUpperCase()] = s;
});
```

Each protocol is stored under BOTH its ICD-10 code and its diagnosis name (both uppercased). This means a 24-protocol dataset produces up to 48 cache keys. Lookup is O(1) by either key.

### 10.3 Client-Side Context Building: `buildStdRxContext()`

In `web/prescription-pad.html` (line 4873):

Scans the clinical note for matches against `stdRxCache` entries:

- Matches the first word of `diagnosis_name` (case-insensitive) in the note
- Matches `icd10` code (case-insensitive) in the note

Builds a context string for up to 3 matched protocols, listing first-line drugs with notes. This was part of the original design for embedding context directly in the prompt. The current architecture uses the Edge Function's `get_standard_rx` tool instead, where Claude actively fetches protocols as needed.

### 10.4 Edge Function: `ai-protocol-lookup`

Defined in `supabase/functions/ai-protocol-lookup/index.ts`. A separate Edge Function for AI-assisted protocol generation.

**Purpose**: Takes a diagnosis name and/or ICD-10 code, uses Claude to research and generate a complete standard prescription protocol ready for database insertion.

**Endpoint**:

```
POST /functions/v1/ai-protocol-lookup
Body: { "diagnosis": "...", "icd10": "..." }
```

At least one of `diagnosis` or `icd10` is required.

**Process**:

1. Loads system prompt from Supabase Storage (`skill/protocol_lookup_prompt.md`)
2. Sends to Claude (claude-sonnet-4-20250514, max 4096 tokens)
3. Extracts JSON from response
4. Validates the protocol:
   - Required: `icd10`, `diagnosis_name`, `category` (must be one of 16 valid values)
   - `first_line_drugs` must be a non-empty array
   - `second_line_drugs`, `investigations`, `counselling`, `warning_signs` must be arrays if present
5. Returns the protocol JSON with `_warnings` (validation issues) and `_meta` (token usage)

**Valid categories**: Respiratory, ENT, GI, Infectious, Neurology, Neonatal, Endocrine, Emergency, Dermatology, Haematology, Renal, Allergy, Musculoskeletal, Ophthalmology, Cardiovascular, Developmental.

This function is used to expand the protocol database by generating new protocols on demand.

---

## 11. Data Flow Summary

```
Guideline Sources (IAP 2024, WHO 2023, etc.)
  |
  v
standard_prescriptions_data_new.json (24 protocols, manually curated)
  |
  v
import_data.js (import script)
  |
  v
Supabase `standard_prescriptions` table
  |
  +--[preloadKnowledge]--> stdRxCache (prescription-pad.html, dual-key: ICD-10 + name)
  |                         |
  |                         +--> buildStdRxContext() (legacy context builder)
  |
  +--[get_standard_rx tool]--> Claude API (Edge Function, 3-strategy lookup)
  |
  +--[ai-protocol-lookup]--> Claude generates new protocols --> can be inserted into table


SNOMED CT Mapping:
  build_snomed_mappings.js --> import_snomed_diagnosis_mappings.js --> standard_prescriptions.snomed_code
```

### Fields by Consumer

| Field                      | Edge Function (get_standard_rx) | Prescription Pad (preload) | ai-protocol-lookup (validation) |
| -------------------------- | :-----------------------------: | :------------------------: | :-----------------------------: |
| `icd10`                    |                Y                |             Y              |            Required             |
| `diagnosis_name`           |                Y                |             Y              |            Required             |
| `snomed_code`              |                Y                |             Y              |               --                |
| `first_line_drugs`         |                Y                |             Y              |    Required, non-empty array    |
| `second_line_drugs`        |                Y                |             Y              |        Array if present         |
| `investigations`           |                Y                |             Y              |        Array if present         |
| `counselling`              |                Y                |             Y              |        Array if present         |
| `warning_signs`            |                Y                |             Y              |        Array if present         |
| `referral_criteria`        |                Y                |             Y              |               --                |
| `hospitalisation_criteria` |                Y                |             Y              |               --                |
| `expected_course`          |                Y                |             --             |               --                |
| `key_clinical_points`      |                Y                |             --             |               --                |
| `severity_assessment`      |                Y                |             --             |               --                |
| `monitoring_parameters`    |                Y                |             --             |               --                |
| `guideline_changes`        |                Y                |             --             |               --                |
| `notes`                    |                Y                |             Y              |               --                |
| `duration_days_default`    |                Y                |             Y              |               --                |
| `category`                 |               --                |             --             |       Required, validated       |
| `severity`                 |               --                |             --             |               --                |
| `source`                   |               --                |             --             |               --                |
