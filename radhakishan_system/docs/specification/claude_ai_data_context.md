# What Data Claude AI Receives vs What's Stripped

**Example drug: CHLORPHENAMINE MALEATE + PHENYLEPHRINE HYDROCHLORIDE (Wikoryl AF)**
**Total tokens sent: ~1,312** (combo drug, 2 formulations, 2 dosing bands)

---

## SENT TO CLAUDE (via `condenseDrugForAI()` in Edge Function)

| Section | Fields | Notes |
|---------|--------|-------|
| **Identity** | generic_name, drug_class, **category**, **therapeutic_use[]**, licensed_in_children | Category + therapeutic_use added for clinical context |
| **Formulations** | form, route, indian_conc_note | unit_of_presentation removed (redundant) |
| **Ingredients** (per formulation) | name, is_primary, strength_numerator/unit, strength_denominator/unit | Ingredient SNOMED codes stripped |
| **Dosing bands** | indication, age_band, method, is_per_day, frequency_per_day, interval_hours, duration_days, duration_note, rounding_rule, notes | Null fields auto-stripped (ga_weeks, loading_dose when null) |
| **ingredient_doses[]** (per band) | ingredient, dose_min_qty, dose_max_qty, dose_unit, max_single_mg, max_daily_mg, is_limiting, **source** | SNOMED code stripped; source kept for Claude's reference |
| **Safety** (conditional) | contraindications, interactions, cross_reactions, black_box_warnings, pediatric_specific_warnings, monitoring_parameters | Only included when non-empty |
| **Renal** (conditional) | renal_adjustment_required, renal_bands | Only when renal_adjustment_required=true |
| **Hepatic** (conditional) | hepatic_adjustment_required, hepatic_note | Only when hepatic_adjustment_required=true |
| **Admin** (conditional) | administration, food_instructions | Only when non-empty/non-null |
| **Other** (conditional) | unlicensed_note, snomed_code, notes | Only when non-null |

---

## NOT SENT TO CLAUDE

| Field | Reason |
|-------|--------|
| `brand_names[]` | Pharmacist's domain, not needed for prescribing |
| `formulations[].indian_brands[]` | 77% of raw tokens — manufacturer data, trade names, SNOMED product codes |
| `formulations[].form_snomed_code` | SNOMED metadata |
| `formulations[].display_name` | Redundant with form + ingredients |
| `formulations[].generic_clinical_drug_code/name` | SNOMED reference |
| `ingredients[].snomed_code` | Not needed for dose calculation |
| `ingredients[].basis_of_strength/code` | Salt vs base metadata |
| `ingredients[].is_active` | Always true |
| `ingredient_doses[].snomed_code` | Not needed for dose calculation |
| `snomed_display` | Redundant with generic_name |
| `storage_instructions` | Pharmacist's domain |
| `pregnancy_category` | Pediatric system |
| `lactation_safe/note` | Pediatric system |
| `data_source` | Internal metadata |
| `reference_source[]` | Audit trail |
| `last_reviewed_date` | Internal |
| `id`, `created_at`, `updated_at`, `active` | Database internals |
| **Empty arrays/null values** | Auto-stripped to save tokens |

---

## CONDITIONAL INCLUSION LOGIC

```
If field is null/empty → NOT sent (saves ~3-4 tokens per null field)
If interactions[] is empty → NOT sent
If contraindications[] is empty → NOT sent
If renal_adjustment_required is false → neither renal field sent
If hepatic_adjustment_required is false → neither hepatic field sent
If no administration instructions → NOT sent
If no food_instructions → NOT sent
```

For a simple mono drug with no safety data (e.g., Zinc), only ~400 tokens are sent.
For a complex combo drug with full safety data (e.g., Wikoryl AF), ~1,312 tokens.

---

## DATA FLOW

```
Doctor types clinical note
  → prescription-pad.html sends to Edge Function:
      { clinical_note, patient_allergies, patient_id }
  → Edge Function loads core_prompt.md as system prompt
  → Claude receives: system prompt + clinical note + 5 tool definitions
  → Claude calls get_formulary(["AMOXICILLIN", "PARACETAMOL"])
  → Edge Function queries Supabase: SELECT [21 columns] FROM formulary
  → condenseDrugForAI():
      - Adds: category, therapeutic_use
      - Strips: indian_brands, SNOMED metadata, null fields
      - Strips from ingredient_doses: snomed_code (keeps source)
      - Conditional: only includes safety/admin/renal/hepatic when non-empty
  → Claude receives condensed JSON (~400-1400 tokens per drug)
  → Claude generates prescription JSON
```

---

## SAMPLE OUTPUT (Wikoryl AF — what Claude actually sees)

```json
{
  "generic_name": "CHLORPHENAMINE MALEATE + PHENYLEPHRINE HYDROCHLORIDE",
  "drug_class": "Antihistamine + Decongestant",
  "category": "Respiratory",
  "therapeutic_use": ["Common cold", "Allergic rhinitis", "Nasal congestion"],
  "licensed_in_children": true,
  "formulations": [
    {
      "form": "Conventional release oral drops",
      "route": "PO",
      "indian_conc_note": "Phenylephrine hydrochloride 2.5 mg / 1 mL + Chlorpheniramine maleate 1 mg / 1 mL",
      "ingredients": [
        { "name": "Phenylephrine hydrochloride", "is_primary": true, "strength_numerator": 2.5, "strength_numerator_unit": "mg", "strength_denominator": 1, "strength_denominator_unit": "mL" },
        { "name": "Chlorpheniramine maleate", "is_primary": false, "strength_numerator": 1, "strength_numerator_unit": "mg", "strength_denominator": 1, "strength_denominator_unit": "mL" }
      ]
    }
  ],
  "dosing_bands": [
    {
      "indication": "Common cold / Allergic rhinitis with nasal congestion",
      "age_band": "child",
      "method": "weight",
      "is_per_day": false,
      "frequency_per_day": 3,
      "interval_hours": 8,
      "duration_days": 5,
      "rounding_rule": "whole_unit",
      "notes": "DCGI: Not for children <4 years...",
      "ingredient_doses": [
        { "ingredient": "Phenylephrine hydrochloride", "dose_min_qty": 0.125, "dose_max_qty": 0.25, "dose_unit": "mg/kg/dose", "max_single_mg": 2.5, "max_daily_mg": 15, "is_limiting": false, "source": "FDA OTC monograph" },
        { "ingredient": "Chlorpheniramine maleate", "dose_min_qty": 0.05, "dose_max_qty": 0.1, "dose_unit": "mg/kg/dose", "max_single_mg": 1, "max_daily_mg": 3, "is_limiting": true, "source": "Harriet Lane" }
      ]
    }
  ],
  "snomed_code": "372914003",
  "contraindications": ["Age <4 years (DCGI)", "Neonates", "Severe hypertension", "MAO inhibitor use within 14 days"],
  "pediatric_specific_warnings": ["DCGI restriction: Not for children <4 years", "CPM causes sedation", "..."],
  "monitoring_parameters": ["Sedation level", "Heart rate"],
  "notes": "Two market variants exist..."
}
```
