# Formulary Database Specification

**System**: Radhakishan Hospital Pediatric OPD Prescription System
**Table**: `formulary`
**Current count**: 680 drugs (454 snomed_branded + 158 snomed_generic + 68 orphan)
**Last updated**: 2026-03-25

---

## 1. Table Schema

Defined in `radhakishan_system/schema/radhakishan_supabase_schema.sql` (lines 26-134) with ABDM extensions in `radhakishan_system/schema/abdm_schema.sql` (lines 38-42).

### All Columns

| Column                        | Type          | Constraints                          | Description                                                                                    |
| ----------------------------- | ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `id`                          | `uuid`        | PK, default `gen_random_uuid()`      | Auto-generated primary key                                                                     |
| `generic_name`                | `text`        | NOT NULL, UNIQUE                     | Drug name (e.g. "Amoxicillin"). Primary lookup key                                             |
| `snomed_code`                 | `text`        | nullable                             | SNOMED CT concept code for the drug substance (added by abdm_schema.sql)                       |
| `snomed_display`              | `text`        | nullable                             | SNOMED CT display name (added by abdm_schema.sql)                                              |
| `drug_class`                  | `text`        | nullable                             | Pharmacological class (e.g. "Aminopenicillin antibiotic")                                      |
| `category`                    | `text`        | nullable                             | Therapeutic category (e.g. "Infectious", "Neurological", "Respiratory")                        |
| `brand_names`                 | `text[]`      | nullable                             | Legacy brand name array (e.g. `["Abamune-L (Cipla)", "Virolam (Hetero)"]`)                     |
| `therapeutic_use`             | `text[]`      | nullable                             | Indications (e.g. `["Human immunodeficiency virus [HIV] disease"]`)                            |
| `licensed_in_children`        | `boolean`     | default `true`                       | Whether licensed for pediatric use                                                             |
| `unlicensed_note`             | `text`        | nullable                             | Details when not licensed (e.g. "Fixed-dose combination tablet licensed for children >=25 kg") |
| `data_source`                 | `text`        | default `'manual'`, CHECK constraint | Provenance classification (see section 3)                                                      |
| `formulations`                | `jsonb`       | CHECK `jsonb_typeof = 'array'`       | ABDM FHIR-aligned formulation array (see section 4)                                            |
| `dosing_bands`                | `jsonb`       | CHECK `jsonb_typeof = 'array'`       | Dosing bands by age/indication (see section 5)                                                 |
| `renal_adjustment_required`   | `boolean`     | default `false`                      | Whether renal dose adjustment needed                                                           |
| `renal_bands`                 | `jsonb`       | CHECK `jsonb_typeof = 'array'`       | GFR-based adjustment tiers (see section 6)                                                     |
| `hepatic_adjustment_required` | `boolean`     | default `false`                      | Whether hepatic dose adjustment needed                                                         |
| `hepatic_note`                | `text`        | nullable                             | Hepatic adjustment guidance                                                                    |
| `black_box_warnings`          | `text[]`      | nullable                             | Critical safety warnings                                                                       |
| `contraindications`           | `text[]`      | nullable                             | Absolute/relative contraindications                                                            |
| `cross_reactions`             | `text[]`      | nullable                             | Cross-reactivity warnings (e.g. allergy groups)                                                |
| `interactions`                | `jsonb`       | CHECK `jsonb_typeof = 'array'`       | Drug-drug interactions (see section 7)                                                         |
| `monitoring_parameters`       | `text[]`      | nullable                             | Required monitoring (e.g. `["CBC", "LFT"]`)                                                    |
| `pediatric_specific_warnings` | `text[]`      | nullable                             | Pediatric-only safety warnings                                                                 |
| `administration`              | `jsonb`       | CHECK `jsonb_typeof = 'array'`       | Route-specific administration details (see section 8)                                          |
| `food_instructions`           | `text`        | nullable                             | Food timing (e.g. "May be taken with or without food")                                         |
| `storage_instructions`        | `text`        | nullable                             | Storage requirements                                                                           |
| `pregnancy_category`          | `text`        | nullable                             | FDA pregnancy category                                                                         |
| `lactation_safe`              | `text`        | nullable                             | Lactation safety status                                                                        |
| `lactation_note`              | `text`        | nullable                             | Lactation details                                                                              |
| `reference_source`            | `text[]`      | nullable                             | Guideline sources (e.g. `["WHO 2023", "BNF for Children"]`)                                    |
| `last_reviewed_date`          | `date`        | nullable                             | Last clinical review date                                                                      |
| `notes`                       | `text`        | nullable                             | General clinical notes                                                                         |
| `active`                      | `boolean`     | default `true`                       | Soft delete flag                                                                               |
| `created_at`                  | `timestamptz` | default `now()`                      | Row creation timestamp                                                                         |
| `updated_at`                  | `timestamptz` | default `now()`                      | Auto-updated via trigger `trg_formulary_updated`                                               |

### Indexes

| Index                        | Type   | Column(s)         | Notes                                  |
| ---------------------------- | ------ | ----------------- | -------------------------------------- |
| `idx_formulary_cat`          | B-tree | `category`        |                                        |
| `idx_formulary_active`       | B-tree | `active`          |                                        |
| `idx_formulary_brands`       | GIN    | `brand_names`     | Array search                           |
| `idx_formulary_use`          | GIN    | `therapeutic_use` | Array search                           |
| `idx_formulary_interactions` | GIN    | `interactions`    | JSONB search                           |
| `idx_formulary_dosing`       | GIN    | `dosing_bands`    | JSONB search                           |
| `idx_formulary_snomed`       | B-tree | `snomed_code`     | Partial: WHERE snomed_code IS NOT NULL |
| `idx_formulary_datasource`   | B-tree | `data_source`     |                                        |

### Row Level Security

RLS enabled. Current policy: `anon_full_access` (POC mode). `updated_at` auto-maintained by `update_updated_at()` trigger.

---

## 2. Data Source Files

Three JSON files in `radhakishan_system/data/`, each tagged with a `data_source` value:

| File                                     | data_source      | Count | Description                                                                                                          |
| ---------------------------------------- | ---------------- | ----- | -------------------------------------------------------------------------------------------------------------------- |
| `formulary_data_ABDM_FHIR.json`          | `snomed_branded` | 454   | SNOMED CT code + branded children from India extension. Full formulation data with `indian_brands[]` per formulation |
| `formulary_data_ABDM_FHIR_generics.json` | `snomed_generic` | 158   | SNOMED CT code but no branded children in India extension. Generic formulation data only                             |
| `formulary_data_ABDM_FHIR_orphans.json`  | `orphan`         | 68    | No SNOMED CT code. Rare biologics, OTC supplements, non-standard items                                               |

A fourth value `manual` exists in the CHECK constraint for manually added entries.

---

## 3. data_source Classification

Defined as a CHECK constraint on the `data_source` column:

```sql
check (data_source in ('snomed_branded', 'snomed_generic', 'orphan', 'manual'))
```

| Value            | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `snomed_branded` | Has SNOMED code AND branded children with full formulation data from SNOMED CT India Extension March 2026 |
| `snomed_generic` | Has SNOMED code but no branded children in the India extension                                            |
| `orphan`         | No SNOMED code (rare biologics, OTC supplements)                                                          |
| `manual`         | Manually added entry (default)                                                                            |

---

## 4. Formulation Structure (ABDM FHIR R4 Aligned)

Each entry in the `formulations` JSONB array follows this structure:

### Full Structure (as stored in database)

```json
{
  "form": "Conventional release oral tablet",
  "form_snomed_code": "421026006",
  "route": "PO",
  "unit_of_presentation": "Tablet",
  "unit_of_presentation_code": "732936001",
  "generic_clinical_drug_code": "429473005",
  "generic_clinical_drug_name": "Lamivudine 150 mg and stavudine 30 mg oral tablet",
  "ingredients": [
    {
      "name": "Stavudine",
      "snomed_code": "386895008",
      "is_active": true,
      "is_primary": true,
      "strength_numerator": 30,
      "strength_numerator_unit": "mg",
      "strength_denominator": 1,
      "strength_denominator_unit": "tablet",
      "basis_of_strength": "Stavudine",
      "basis_of_strength_code": "386895008"
    },
    {
      "name": "3TC",
      "snomed_code": "386897000",
      "is_active": true,
      "is_primary": false,
      "strength_numerator": 150,
      "strength_numerator_unit": "mg",
      "strength_denominator": 1,
      "strength_denominator_unit": "tablet",
      "basis_of_strength": "3TC",
      "basis_of_strength_code": "386897000"
    }
  ],
  "indian_brands": [
    {
      "name": "Lamistar",
      "manufacturer": "Hetero Healthcare Limited",
      "snomed_code": "1528181000189101",
      "verified_on": "SNOMED CT India Extension March 2026",
      "trade_name": "Lamistar",
      "trade_name_code": "1515611000189103",
      "brand_family": "Lamistar (lamivudine and stavudine) [Hetero Healthcare Limited]",
      "brand_family_code": "1526811000189100"
    }
  ],
  "indian_conc_note": "Stavudine 30 mg / 1 tablet + 3TC 150 mg / 1 tablet",
  "display_name": "Lamistar 150 mg + 30 mg oral tablet"
}
```

### Formulation-Level Fields

| Field                        | Type        | Present In     | Description                                                                                                              |
| ---------------------------- | ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `form`                       | string      | All            | Dose form (e.g. "Oral suspension", "Tablet", "Tablet (pediatric)", "Oral solution (Abacavir)", "Solution for injection") |
| `form_snomed_code`           | string/null | snomed_branded | SNOMED CT dose form concept code                                                                                         |
| `route`                      | string      | All            | Route of administration: "PO", "IV/IM", "Topical", "Inhaled", "Rectal", etc.                                             |
| `unit_of_presentation`       | string/null | snomed_branded | "Tablet", "mL", "puff", etc.                                                                                             |
| `unit_of_presentation_code`  | string/null | snomed_branded | SNOMED code for unit of presentation                                                                                     |
| `generic_clinical_drug_code` | string/null | snomed_branded | SNOMED clinical drug concept                                                                                             |
| `generic_clinical_drug_name` | string/null | snomed_branded | Full SNOMED clinical drug name                                                                                           |
| `indian_conc_note`           | string      | All            | Human-readable concentration (e.g. "Abacavir/Lamivudine 20 mg / 1 mL")                                                   |
| `display_name`               | string/null | snomed_branded | Display label (e.g. "Lamistar 150 mg + 30 mg oral tablet")                                                               |

### Ingredient Fields

| Field                       | Type    | Present In     | Description                                   |
| --------------------------- | ------- | -------------- | --------------------------------------------- |
| `name`                      | string  | All            | Ingredient name                               |
| `snomed_code`               | string  | snomed_branded | SNOMED CT substance code                      |
| `is_active`                 | boolean | All            | Always `true` for formulary data              |
| `is_primary`                | boolean | All            | `true` for the primary dosing ingredient      |
| `strength_numerator`        | number  | All            | Strength value (e.g. 250)                     |
| `strength_numerator_unit`   | string  | All            | Strength unit (e.g. "mg", "mg/300mg" for FDC) |
| `strength_denominator`      | number  | All            | Per-amount (e.g. 5 for "per 5 mL")            |
| `strength_denominator_unit` | string  | All            | Per-unit (e.g. "mL", "tablet")                |
| `basis_of_strength`         | string  | snomed_branded | Pharmacological basis name                    |
| `basis_of_strength_code`    | string  | snomed_branded | SNOMED code for basis of strength             |

### Indian Brand Fields

| Field               | Type        | Description                                                                            |
| ------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `name`              | string      | Brand name (e.g. "Lamistar", "LAMIVIR-S 30")                                           |
| `manufacturer`      | string/null | Manufacturer name (e.g. "Cipla Limited")                                               |
| `snomed_code`       | string/null | SNOMED CT India Extension product code                                                 |
| `verified_on`       | string      | Data source (e.g. "SNOMED CT India Extension March 2026" or "Original formulary data") |
| `trade_name`        | string      | Trade name                                                                             |
| `trade_name_code`   | string      | SNOMED code for trade name                                                             |
| `brand_family`      | string      | Full brand family description                                                          |
| `brand_family_code` | string      | SNOMED code for brand family                                                           |

`indian_brands` can have many entries per formulation (up to 61 for popular drugs). These fields are only fully populated for `snomed_branded` drugs; `snomed_generic` and `orphan` drugs have minimal brand data (name + manufacturer only, no SNOMED codes).

---

## 5. Dosing Band Structure

Each entry in the `dosing_bands` JSONB array:

```json
{
  "indication": "HIV treatment (NRTI backbone)",
  "age_band": "child",
  "ga_weeks_min": null,
  "ga_weeks_max": null,
  "method": "weight",
  "dose_min_qty": 8,
  "dose_max_qty": 8,
  "dose_unit": "mg/kg/dose",
  "is_per_day": false,
  "frequency_per_day": 2,
  "interval_hours": 12,
  "duration_days": null,
  "duration_note": "Lifelong ART. Dose as abacavir component: 8 mg/kg BD (max 600mg/day)",
  "max_single_qty": 600,
  "max_single_unit": "mg abacavir",
  "max_daily_qty": 600,
  "max_daily_unit": "mg abacavir",
  "loading_dose_qty": null,
  "loading_dose_unit": null,
  "rounding_rule": "0.5ml",
  "notes": "Screen HLA-B*5701 before starting. FDC: >=25kg: 600/300mg OD or 300/150mg BD"
}
```

### All Dosing Band Fields

| Field               | Type        | Allowed Values                                                          | Description                                                         |
| ------------------- | ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `indication`        | string      | free text                                                               | Clinical indication this band applies to                            |
| `age_band`          | string      | `all`, `neonate`, `infant`, `child`, `adolescent`, `neonate-preterm`    | Patient age group                                                   |
| `ga_weeks_min`      | number/null | 22-44                                                                   | Minimum gestational age (preterm neonates only)                     |
| `ga_weeks_max`      | number/null | 22-44                                                                   | Maximum gestational age (preterm neonates only)                     |
| `method`            | string      | `weight`, `bsa`, `fixed`, `gfr`, `infusion`, `age`                      | Dose calculation method                                             |
| `dose_min_qty`      | number      |                                                                         | Minimum dose quantity                                               |
| `dose_max_qty`      | number      |                                                                         | Maximum dose quantity                                               |
| `dose_unit`         | string      | `mg`, `mcg`, `g`, `units`, `mmol`, `mEq`, `nanomol`, `mg/kg/dose`, etc. | Dose unit                                                           |
| `is_per_day`        | boolean     |                                                                         | `true` = total daily dose (divide by frequency); `false` = per-dose |
| `frequency_per_day` | number      |                                                                         | Number of administrations per day                                   |
| `interval_hours`    | number      |                                                                         | Hours between doses (alternative to frequency)                      |
| `duration_days`     | number/null |                                                                         | Default treatment duration                                          |
| `duration_note`     | string/null |                                                                         | Duration context (e.g. "Lifelong ART")                              |
| `max_single_qty`    | number/null |                                                                         | Maximum single dose (safety ceiling)                                |
| `max_single_unit`   | string/null | `mg`, `mcg`, `g`, `units`                                               | Unit for max single dose                                            |
| `max_daily_qty`     | number/null |                                                                         | Maximum daily dose (safety ceiling)                                 |
| `max_daily_unit`    | string/null | `mg`, `mcg`, `g`, `units`                                               | Unit for max daily dose                                             |
| `loading_dose_qty`  | number/null |                                                                         | Loading dose if applicable                                          |
| `loading_dose_unit` | string/null | `mg`, `mcg`, `units`, `mg/kg`, `mcg/kg`                                 | Loading dose unit                                                   |
| `rounding_rule`     | string/null | `0.5ml`, `0.1ml`, `quarter_tab`, `whole_unit`, `exact`                  | How to round calculated dose                                        |
| `notes`             | string/null |                                                                         | Clinical pearls for this dosing band                                |

---

## 6. Renal Band Structure

Each entry in the `renal_bands` JSONB array:

```json
{
  "gfr_min": 0,
  "gfr_max": 50,
  "action": "avoid",
  "adjusted_dose_note": "FDC tablet contraindicated if CrCl <50 mL/min; use individual components with dose adjustment of lamivudine"
}
```

| Field                | Type   | Allowed Values                                                                  | Description                    |
| -------------------- | ------ | ------------------------------------------------------------------------------- | ------------------------------ |
| `gfr_min`            | number |                                                                                 | Minimum GFR threshold (mL/min) |
| `gfr_max`            | number |                                                                                 | Maximum GFR threshold (mL/min) |
| `action`             | string | `reduce_dose`, `extend_interval`, `reduce_and_extend`, `avoid`, `no_adjustment` | Adjustment action              |
| `adjusted_dose_note` | string |                                                                                 | Detailed adjustment guidance   |

---

## 7. Interaction Structure

Each entry in the `interactions` JSONB array:

```json
{
  "drug_or_class": "Methadone",
  "severity": "moderate",
  "effect": "May require methadone dose increase due to increased clearance"
}
```

| Field           | Type   | Allowed Values                            | Description                    |
| --------------- | ------ | ----------------------------------------- | ------------------------------ |
| `drug_or_class` | string |                                           | Interacting drug or drug class |
| `severity`      | string | `black_box`, `major`, `moderate`, `minor` | Interaction severity           |
| `effect`        | string |                                           | Clinical effect description    |

Note: The schema comment references fields `drug`, `severity`, `effect` but the actual data uses `drug_or_class` instead of `drug`.

---

## 8. Administration Structure

Each entry in the `administration` JSONB array:

```json
{
  "route": "PO",
  "reconstitution": null,
  "dilution": null,
  "infusion_rate_note": null,
  "compatibility_note": null,
  "storage": "Store below 25C; oral solution refrigerate after opening"
}
```

| Field                | Type        | Description                                                             |
| -------------------- | ----------- | ----------------------------------------------------------------------- |
| `route`              | string      | Administration route                                                    |
| `reconstitution`     | string/null | Reconstitution instructions                                             |
| `dilution`           | string/null | Dilution instructions                                                   |
| `infusion_rate_note` | string/null | Infusion rate guidance                                                  |
| `compatibility_note` | string/null | IV compatibility notes                                                  |
| `storage`            | string/null | Route-specific storage (distinct from top-level `storage_instructions`) |

---

## 9. API Endpoints and Data Flow

### 9.1 Supabase REST API (Direct)

All use PostgREST conventions with `apikey` and `Authorization: Bearer <key>` headers.

**Prescription Pad preload** (`web/prescription-pad.html`, `preloadKnowledge()`, line 3015):

```
GET /rest/v1/formulary
  ?select=generic_name,dosing_bands,formulations,contraindications,interactions,black_box_warnings,notes,snomed_code,snomed_display
  &active=eq.true
```

Result: cached in `formularyCache` keyed by `generic_name.toUpperCase()`. Indian brands are stripped from formulations client-side to save memory (~7 MB), but a `_brandIndex` array of brand names is preserved for fuzzy search.

### 9.2 Edge Function: `get_formulary` Tool

Defined in `supabase/functions/generate-prescription/index.ts` (line 72-88, executed at line 214-286).

**Tool definition** sent to Claude:

```json
{
  "name": "get_formulary",
  "description": "Look up drugs in the hospital formulary...",
  "input_schema": {
    "type": "object",
    "properties": {
      "drug_names": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Array of generic drug names (e.g. ['AMOXICILLIN', 'PARACETAMOL']). Case-insensitive."
      }
    },
    "required": ["drug_names"]
  }
}
```

**Execution strategy** (`executeGetFormulary`, line 214):

1. **Strategy 1 -- Generic name search** (primary):

   ```
   GET /rest/v1/formulary
     ?or=(generic_name.ilike.%25<drug1>%25,generic_name.ilike.%25<drug2>%25)
     &select=<22 columns>
     &active=eq.true
   ```

   Selected columns: `generic_name,drug_class,licensed_in_children,unlicensed_note,formulations,dosing_bands,interactions,contraindications,cross_reactions,black_box_warnings,pediatric_specific_warnings,monitoring_parameters,renal_adjustment_required,renal_bands,hepatic_adjustment_required,hepatic_note,administration,food_instructions,notes,snomed_code,snomed_display,brand_names`

2. **Strategy 2 -- Brand name fallback** (for unmatched names):
   ```
   GET /rest/v1/formulary?select=<22 columns>&active=eq.true
   ```
   Fetches all active drugs, then searches client-side through:
   - `brand_names[]` array (legacy field)
   - `formulations[].indian_brands[].name` and `.trade_name` (FHIR field)

**No match**: Returns `"No formulary entries found for: <names>. Use your clinical training knowledge for dosing."`

### 9.3 `condenseDrugForAI()` -- Token Optimization

Defined in `generate-prescription/index.ts` (line 175-212). Strips token-heavy fields before sending to Claude:

**Kept fields** (sent to AI):

- Drug identity: `generic_name`, `snomed_code`, `snomed_display`, `drug_class`, `licensed_in_children`, `unlicensed_note`
- Formulations (condensed): `form`, `route`, `unit_of_presentation`, `indian_conc_note`, and per-ingredient: `name`, `is_primary`, `strength_numerator`, `strength_numerator_unit`, `strength_denominator`, `strength_denominator_unit`
- All dosing bands (unmodified)
- All safety data: `interactions`, `contraindications`, `cross_reactions`, `black_box_warnings`, `pediatric_specific_warnings`, `monitoring_parameters`
- Renal/hepatic: `renal_adjustment_required`, `renal_bands`, `hepatic_adjustment_required`, `hepatic_note`
- Administration: `administration`, `food_instructions`
- Notes: `notes`

**Stripped fields** (not sent to AI):

- `indian_brands[]` from each formulation (~77-83% of tokens)
- SNOMED metadata: `form_snomed_code`, `generic_clinical_drug_code`, `generic_clinical_drug_name`, ingredient `snomed_code`, `is_active`, `basis_of_strength`, `basis_of_strength_code`
- Display/presentation codes: `display_name`, `unit_of_presentation_code`
- Internal fields: `category`, `brand_names`, `therapeutic_use`, `data_source`, `active`, `reference_source`, `last_reviewed_date`
- Not relevant for pediatric: `pregnancy_category`, `lactation_safe`, `lactation_note`, `storage_instructions`

**Token savings**: ~83% per drug. For a typical 5-drug prescription: ~26,500 tokens saved.

### 9.4 Prescription Pad Client-Side Usage

In `web/prescription-pad.html`:

- **`formularyCache`** (line 2134): In-memory dictionary keyed by `GENERIC_NAME` (uppercase). Populated at page load by `preloadKnowledge()`.
- **`buildFormularyContext(fullNote)`** (line 4847): Scans the clinical note for drug names matching `formularyCache` keys. Builds a summary string of mentioned drugs' formulations and dosing bands. This was used in the original design but is now superseded by the Edge Function's tool-based approach.
- **`getDoseRef(drugName, patientAge)`** (line 2801): Looks up dosing bands from `formularyCache` for a specific drug and patient age. Maps age in months to `age_band` values. Used by the smart dose panel UI.
- **Drug picker / Add Medicine popup** (line 7061): Searches `formularyCache` keys with fuzzy matching. Also searches `_brandIndex` (extracted from `indian_brands[].name` at preload time) so doctors can find drugs by brand name.
- **Formulation picker** (line 2327, 5275): Displays available formulations (form + concentration) from `formularyCache` when editing a medicine row.

---

## 10. Import/Export Workflow

### Import Script: `radhakishan_system/scripts/import_formulary_abdm.js`

**Usage**:

```bash
node import_formulary_abdm.js
node import_formulary_abdm.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
```

**Process**:

1. Loads credentials from `.env` or command-line arguments
2. Verifies connection with `GET /rest/v1/formulary?select=id&limit=0`
3. Iterates through three source files, tagging each with the appropriate `data_source`
4. Maps each JSON drug to a database row via `toRow(drug, dataSource)` -- maps all 30+ fields
5. Upserts in batches of 50 using:
   ```
   POST /rest/v1/formulary?on_conflict=generic_name
   Prefer: resolution=merge-duplicates,return=minimal
   ```
6. Falls back to one-by-one upsert on batch errors
7. Prints final count breakdown by `data_source`

**Idempotent**: Safe to re-run. Uses `ON CONFLICT generic_name` with merge-duplicates, so existing rows are updated.

### Legacy Import: `radhakishan_system/scripts/import_data.js`

Imports from the older `formulary_data.json` (pre-ABDM format) and `standard_prescriptions_data.json`. Superseded by `import_formulary_abdm.js` for formulary data.

### Data Pipeline Summary

```
SNOMED CT India Extension (March 2026)
  |
  v
snomed_reextract_v2.js (extraction script)
  |
  +--> formulary_data_ABDM_FHIR.json       (snomed_branded, 454 drugs)
  +--> formulary_data_ABDM_FHIR_generics.json (snomed_generic, 158 drugs)
  +--> formulary_data_ABDM_FHIR_orphans.json  (orphan, 68 drugs)
  |
  v
import_formulary_abdm.js
  |
  v
Supabase `formulary` table (680 rows)
  |
  +--[preloadKnowledge]--> formularyCache (prescription-pad.html, client-side)
  +--[get_formulary tool]--> condenseDrugForAI() --> Claude API (Edge Function)
```
