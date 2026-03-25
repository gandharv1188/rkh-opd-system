# Combo Drug Dosing: Proposed Data Structure

## Current: Drug-level dosing band (single band for all ingredients)

```json
{
  "generic_name": "CHLORPHENAMINE MALEATE + PHENYLEPHRINE HYDROCHLORIDE",
  "formulations": [
    {
      "form": "Conventional release oral drops",
      "ingredients": [
        {
          "name": "Phenylephrine HCl",
          "is_primary": true,
          "strength_numerator": 2.5,
          "strength_denominator": 1,
          "strength_denominator_unit": "mL"
        },
        {
          "name": "Chlorpheniramine maleate",
          "is_primary": false,
          "strength_numerator": 1,
          "strength_denominator": 1,
          "strength_denominator_unit": "mL"
        }
      ]
    }
  ],
  "dosing_bands": [
    {
      "indication": "Common cold",
      "age_band": "child",
      "method": "weight",
      "dose_min_qty": 0.05,
      "dose_max_qty": 0.1,
      "dose_unit": "mg/kg/dose",
      "dose_reference_ingredient": "Chlorpheniramine maleate",
      "is_per_day": false,
      "frequency_per_day": 3,
      "max_single_qty": 1,
      "max_single_unit": "mg CPM"
    }
  ]
}
```

**Problem:** Only one dose range and one max. The calculator doesn't know PE's safe range or max. `dose_reference_ingredient` is a free-text hint — the engine can't programmatically check each ingredient.

---

## Proposed: Per-ingredient dosing within each band

```json
{
  "generic_name": "CHLORPHENAMINE MALEATE + PHENYLEPHRINE HYDROCHLORIDE",
  "formulations": ["...same as current..."],
  "dosing_bands": [
    {
      "indication": "Common cold",
      "age_band": "child",
      "method": "weight",
      "is_per_day": false,
      "frequency_per_day": 3,
      "interval_hours": 8,
      "duration_days": 5,
      "rounding_rule": "whole_unit",
      "notes": "DCGI: Not for children <4 years.",

      "ingredient_doses": [
        {
          "ingredient": "Chlorpheniramine maleate",
          "dose_min_qty": 0.05,
          "dose_max_qty": 0.1,
          "dose_unit": "mg/kg/dose",
          "max_single_mg": 1,
          "max_daily_mg": 3,
          "is_limiting": true,
          "source": "Harriet Lane: 0.35 mg/kg/day div TDS"
        },
        {
          "ingredient": "Phenylephrine HCl",
          "dose_min_qty": 0.125,
          "dose_max_qty": 0.25,
          "dose_unit": "mg/kg/dose",
          "max_single_mg": 2.5,
          "max_daily_mg": 15,
          "is_limiting": false,
          "source": "FDA OTC monograph (derived)"
        }
      ]
    }
  ]
}
```

---

## What changes

| Field                       | Current                                    | Proposed                                              |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| `dose_min/max_qty`          | At band level (one ingredient)             | Moves inside `ingredient_doses[]` per ingredient      |
| `max_single_qty`            | At band level (ambiguous which ingredient) | Per ingredient: `max_single_mg`                       |
| `max_daily_qty`             | At band level                              | Per ingredient: `max_daily_mg`                        |
| `dose_reference_ingredient` | Free-text hint                             | Replaced by `is_limiting: true` flag                  |
| `dose_unit`                 | At band level                              | Per ingredient (allows mixed units in future)         |
| `source`                    | Not present                                | Per ingredient — tracks authority for each dose range |

**What stays at band level:** `indication`, `age_band`, `method`, `is_per_day`, `frequency_per_day`, `interval_hours`, `duration_days`, `rounding_rule`, `notes`.

---

## How the engine uses it

```
For each ingredient in ingredient_doses[]:
    mg_per_dose = dose from slider (via concentration math)
    mg_per_kg   = mg_per_dose / weight

    Check: mg_per_kg within [dose_min_qty, dose_max_qty]?
    Check: mg_per_dose <= max_single_mg?
    Check: mg_per_dose * freq <= max_daily_mg?

    If is_limiting: this ingredient's range drives the slider zones
```

---

## Backward compatibility

Mono drugs don't need `ingredient_doses[]` — current band-level fields keep working. The engine checks:

```
if (band.ingredient_doses) → use per-ingredient ranges
else → use band-level dose_min/max_qty for primary ingredient only
```

No migration required for the 404 single-ingredient drugs.
