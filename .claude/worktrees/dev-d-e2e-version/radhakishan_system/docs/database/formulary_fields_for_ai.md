# Formulary Data Fields — What to Send to AI for Prescription Generation

## Decision Criteria

- **SEND**: AI needs this to calculate dose, check safety, or generate prescription text
- **OMIT**: AI doesn't need this — it's for display, FHIR compliance, or internal tracking

---

## Drug-Level Fields

| Field                  | Send?   | Reason                                                       |
| ---------------------- | ------- | ------------------------------------------------------------ |
| `generic_name`         | ✅ SEND | AI needs the drug name for prescription row1 and lookups     |
| `snomed_code`          | ✅ SEND | AI includes in prescription output for FHIR compliance       |
| `snomed_display`       | ✅ SEND | AI uses as alternative display name                          |
| `drug_class`           | ✅ SEND | AI uses for clinical context (e.g., "NSAID" → check GI risk) |
| `category`             | ❌ OMIT | Internal classification — AI doesn't use it                  |
| `brand_names`          | ❌ OMIT | Display only — AI doesn't prescribe by brand                 |
| `therapeutic_use`      | ❌ OMIT | AI already knows indications from clinical training          |
| `licensed_in_children` | ✅ SEND | AI must flag unlicensed use                                  |
| `unlicensed_note`      | ✅ SEND | AI includes the warning if unlicensed                        |
| `data_source`          | ❌ OMIT | Internal tracking (snomed_branded/generic/orphan)            |
| `active`               | ❌ OMIT | Already filtered in SELECT query (active=eq.true)            |
| `reference_source`     | ❌ OMIT | Internal provenance                                          |
| `last_reviewed_date`   | ❌ OMIT | Internal tracking                                            |

## Formulations — SEND CONDENSED, NOT FULL

The full `formulations[]` array has 61 Indian brands per formulation (77% of token cost). Send only the clinical essentials.

### Per Formulation: What to include

| Field                        | Send?   | Reason                                                                       |
| ---------------------------- | ------- | ---------------------------------------------------------------------------- |
| `form`                       | ✅ SEND | AI needs to know: Syrup, Tablet, Injection, Drops, etc.                      |
| `route`                      | ✅ SEND | AI needs for prescription (PO, IV/IM, Topical, etc.)                         |
| `indian_conc_note`           | ✅ SEND | Human-readable concentration string — easier for AI than parsing ingredients |
| `unit_of_presentation`       | ✅ SEND | Tablet, mL, puff — needed for dose rounding                                  |
| `form_snomed_code`           | ❌ OMIT | FHIR metadata — AI doesn't need it                                           |
| `generic_clinical_drug_code` | ❌ OMIT | SNOMED reference — not needed for prescribing                                |
| `generic_clinical_drug_name` | ❌ OMIT | Redundant with indian_conc_note                                              |
| `display_name`               | ❌ OMIT | Redundant                                                                    |

### Per Ingredient: What to include

| Field                       | Send?   | Reason                                             |
| --------------------------- | ------- | -------------------------------------------------- |
| `name`                      | ✅ SEND | AI needs ingredient name for combination drugs     |
| `is_primary`                | ✅ SEND | AI doses by primary ingredient                     |
| `strength_numerator`        | ✅ SEND | Concentration value (e.g., 250)                    |
| `strength_numerator_unit`   | ✅ SEND | Concentration unit (e.g., mg)                      |
| `strength_denominator`      | ✅ SEND | Per-amount (e.g., 5)                               |
| `strength_denominator_unit` | ✅ SEND | Per-unit (e.g., mL)                                |
| `snomed_code`               | ❌ OMIT | SNOMED substance code — not needed for prescribing |
| `is_active`                 | ❌ OMIT | Always true for our data                           |
| `basis_of_strength`         | ❌ OMIT | Pharmacological detail — AI knows from training    |
| `basis_of_strength_code`    | ❌ OMIT | SNOMED reference                                   |

### Per Indian Brand: OMIT ENTIRELY

| Field               | Send?   | Reason                                     |
| ------------------- | ------- | ------------------------------------------ |
| `name`              | ❌ OMIT | 61 brands × 7 fields = massive token waste |
| `manufacturer`      | ❌ OMIT | Not needed for prescribing                 |
| `snomed_code`       | ❌ OMIT | SNOMED reference                           |
| `trade_name`        | ❌ OMIT | Display only                               |
| `trade_name_code`   | ❌ OMIT | SNOMED reference                           |
| `brand_family`      | ❌ OMIT | Display only                               |
| `brand_family_code` | ❌ OMIT | SNOMED reference                           |
| `verified_on`       | ❌ OMIT | Internal tracking                          |

## Dosing Bands — SEND ALL

| Field               | Send?   | Reason                                       |
| ------------------- | ------- | -------------------------------------------- |
| `indication`        | ✅ SEND | AI matches patient diagnosis to correct band |
| `age_band`          | ✅ SEND | AI selects band by patient age               |
| `ga_weeks_min/max`  | ✅ SEND | Preterm dosing                               |
| `method`            | ✅ SEND | weight/bsa/fixed/gfr/infusion/age            |
| `dose_min_qty`      | ✅ SEND | Dose range minimum                           |
| `dose_max_qty`      | ✅ SEND | Dose range maximum                           |
| `dose_unit`         | ✅ SEND | mg/kg/day, mcg/kg/min, etc.                  |
| `is_per_day`        | ✅ SEND | Per-day vs per-dose                          |
| `frequency_per_day` | ✅ SEND | How many times daily                         |
| `interval_hours`    | ✅ SEND | Alternative to frequency                     |
| `duration_days`     | ✅ SEND | Treatment duration                           |
| `duration_note`     | ✅ SEND | Duration context                             |
| `max_single_qty`    | ✅ SEND | Safety ceiling per dose                      |
| `max_single_unit`   | ✅ SEND | Unit for max single                          |
| `max_daily_qty`     | ✅ SEND | Safety ceiling per day                       |
| `max_daily_unit`    | ✅ SEND | Unit for max daily                           |
| `loading_dose_qty`  | ✅ SEND | Loading dose if applicable                   |
| `loading_dose_unit` | ✅ SEND | Loading dose unit                            |
| `rounding_rule`     | ✅ SEND | 0.5ml, quarter_tab, etc.                     |
| `notes`             | ✅ SEND | Clinical pearls for the AI                   |

## Safety — SEND ALL

| Field                         | Send?   | Reason                                              |
| ----------------------------- | ------- | --------------------------------------------------- |
| `interactions`                | ✅ SEND | AI checks against other prescribed drugs            |
| `contraindications`           | ✅ SEND | AI checks against patient allergies/conditions      |
| `cross_reactions`             | ✅ SEND | AI checks for cross-reactivity with known allergies |
| `black_box_warnings`          | ✅ SEND | AI must flag these prominently                      |
| `pediatric_specific_warnings` | ✅ SEND | Pediatric-specific safety info                      |
| `monitoring_parameters`       | ✅ SEND | AI includes in prescription notes                   |
| `renal_adjustment_required`   | ✅ SEND | Flags need for renal dose adjustment                |
| `renal_bands`                 | ✅ SEND | GFR-based dose adjustment tiers                     |
| `hepatic_adjustment_required` | ✅ SEND | Flags need for hepatic adjustment                   |
| `hepatic_note`                | ✅ SEND | Hepatic adjustment guidance                         |

## Administration — SEND ALL

| Field                  | Send?   | Reason                                                        |
| ---------------------- | ------- | ------------------------------------------------------------- |
| `administration`       | ✅ SEND | Route, reconstitution, dilution, infusion rate, compatibility |
| `food_instructions`    | ✅ SEND | AI includes in prescription (e.g., "Take with food")          |
| `storage_instructions` | ❌ OMIT | Not included in prescription — pharmacy concern               |
| `pregnancy_category`   | ❌ OMIT | Not relevant for pediatric prescribing                        |
| `lactation_safe`       | ❌ OMIT | Not relevant for pediatric prescribing                        |
| `lactation_note`       | ❌ OMIT | Not relevant for pediatric prescribing                        |

---

## Token Impact Estimate

For a drug like Amoxicillin (1 formulation, 61 brands, 4 dosing bands):

| What                             | Tokens     | % of full |
| -------------------------------- | ---------- | --------- |
| Full drug JSON                   | ~6,400     | 100%      |
| **Condensed (SEND fields only)** | **~1,100** | **17%**   |
| Savings                          | ~5,300     | 83%       |

For a typical prescription with 5 drugs looked up: **~26,500 tokens saved** per prescription.

---

## Implementation

In `executeGetFormulary()` in the Edge Function, transform each drug before passing to Claude:

```javascript
function condenseDrugForAI(drug) {
  return {
    generic_name: drug.generic_name,
    snomed_code: drug.snomed_code,
    snomed_display: drug.snomed_display,
    drug_class: drug.drug_class,
    licensed_in_children: drug.licensed_in_children,
    unlicensed_note: drug.unlicensed_note,
    formulations: (drug.formulations || []).map((f) => {
      const pri =
        (f.ingredients || []).find((i) => i.is_primary) || f.ingredients?.[0];
      return {
        form: f.form,
        route: f.route,
        unit_of_presentation: f.unit_of_presentation,
        indian_conc_note: f.indian_conc_note,
        ingredients: (f.ingredients || []).map((i) => ({
          name: i.name,
          is_primary: i.is_primary,
          strength_numerator: i.strength_numerator,
          strength_numerator_unit: i.strength_numerator_unit,
          strength_denominator: i.strength_denominator,
          strength_denominator_unit: i.strength_denominator_unit,
        })),
        // indian_brands OMITTED — saves ~80% tokens
      };
    }),
    dosing_bands: drug.dosing_bands,
    interactions: drug.interactions,
    contraindications: drug.contraindications,
    cross_reactions: drug.cross_reactions,
    black_box_warnings: drug.black_box_warnings,
    pediatric_specific_warnings: drug.pediatric_specific_warnings,
    monitoring_parameters: drug.monitoring_parameters,
    renal_adjustment_required: drug.renal_adjustment_required,
    renal_bands: drug.renal_bands,
    hepatic_adjustment_required: drug.hepatic_adjustment_required,
    hepatic_note: drug.hepatic_note,
    administration: drug.administration,
    food_instructions: drug.food_instructions,
  };
}
```
