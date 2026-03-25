# Migrate dosing_bands to per-ingredient format (ingredient_doses[])

## Context

Dosing bands currently store dose ranges, max doses, and units at the **band level** — implicitly referring to one ingredient. For combo drugs this is ambiguous (which ingredient does `max_single_qty: 1` refer to?). For mono drugs the data is correct but inconsistent with the combo format.

**Goal:** Migrate ALL 671 dosing bands (across 454 drugs) to include `ingredient_doses[]`, creating a unified format. Keep band-level fields intact during rollout for backward compatibility. Update the 3 consumer files to prefer `ingredient_doses[]` when present.

---

## Data Migration

### Step 1: Migrate Wikoryl AF first (test case)

Current:
```json
{
  "dose_min_qty": 0.05,
  "dose_max_qty": 0.1,
  "dose_unit": "mg/kg/dose",
  "max_single_qty": 1,
  "max_single_unit": "mg CPM",
  "max_daily_qty": 3,
  "dose_reference_ingredient": "Chlorpheniramine maleate"
}
```

After:
```json
{
  "dose_min_qty": 0.05,
  "dose_max_qty": 0.1,
  "dose_unit": "mg/kg/dose",
  "max_single_qty": 1,
  "max_single_unit": "mg",
  "max_daily_qty": 3,
  "dose_reference_ingredient": "Chlorpheniramine maleate",
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
```

### Step 2: Bulk migrate all mono drugs via script

For each drug with 1 ingredient per formulation:
```js
band.ingredient_doses = [{
  ingredient: primaryIngredient.name,  // from formulations[0].ingredients[0].name
  dose_min_qty: band.dose_min_qty,
  dose_max_qty: band.dose_max_qty,
  dose_unit: band.dose_unit,
  max_single_mg: band.max_single_qty || null,
  max_daily_mg: band.max_daily_qty || null,
  is_limiting: true,
  source: null
}];
```

Band-level `dose_min/max_qty` and `max_single/daily_qty` are **removed** after migration — `ingredient_doses[]` is the single source of truth. No backward compatibility branching.

### Step 3: Push to Supabase

Update each drug's `dosing_bands` JSONB column via REST API PATCH.

---

## Code Changes (3 files)

### 1. `web/dose-engine.js`

**`computeSliderRange()`** — Read dose ranges from `band.ingredient_doses` (limiting ingredient). Remove fallback to band-level `dose_min/max_qty`.

```js
const lim = band.ingredient_doses.find(id => id.is_limiting) || band.ingredient_doses[0];
const bMin = lim.dose_min_qty;
const bMax = lim.dose_max_qty || bMin;
```

**`computeDose()`** — New parameter: `ingredientBands` (the `ingredient_doses[]` from the band). In the per-ingredient loop (Step 6), match each ingredient by name and check its own `max_single_mg` / `max_daily_mg`. Remove `maxSingleDoseMg` / `maxDailyDoseMg` scalar params — everything comes from `ingredientBands`.

### 2. `web/prescription-pad.html`

**`fmtDoseBand(b)`** (~line 2860) — Always reads from `b.ingredient_doses`. For >1 entry, show per-ingredient ranges:
```
CPM: 0.05-0.1 mg/kg/dose (max 1mg) | PE: 0.125-0.25 mg/kg/dose (max 2.5mg)
```
For 1 entry: display same as current format.

**`confirmAddMed()`** (~line 7200) — Read from limiting ingredient_dose:
```js
const lim = band.ingredient_doses.find(id => id.is_limiting) || band.ingredient_doses[0];
```

**`dpRecalc()`** — Pass `band.ingredient_doses` to `DoseEngine.computeDose()`.

**Slider rendering in `renderReview()`** — Use limiting ingredient's range for zones.

### 3. `web/formulary.html`

**`_renderViewDosingBands()`** (~line 2698) — Always reads from `band.ingredient_doses`. Renders a sub-table showing each ingredient's dose range, max doses, and source.

---

## Migration Script

New file: `radhakishan_system/scripts/migrate_dosing_bands.js`

```js
// 1. Read formulary_data_ABDM_FHIR.json
// 2. For each drug:
//    a. Find ingredient names from formulations[0].ingredients
//    b. For each dosing_band:
//       - If ingredient_doses already exists, skip
//       - Create ingredient_doses[] with one entry per ingredient
//       - Mono drugs: single entry with is_limiting=true
//       - Combo drugs: primary gets band-level values, secondary gets null ranges
//         (combo drugs need manual enrichment for secondary ingredients later)
//    c. Remove band-level dose_min/max_qty, max_single/daily_qty
//       (move to ingredient_doses only)
//    d. Keep band-level: indication, age_band, method, is_per_day,
//       frequency_per_day, interval_hours, duration_*, rounding_rule, notes
// 3. Write back to JSON
// 4. PATCH each drug to Supabase
```

---

## Verification

1. **Wikoryl AF** — manually enriched with both ingredients' dose ranges → slider shows CPM-based zones, engine checks both PE and CPM max doses
2. **Amoxicillin** (mono) — `ingredient_doses` has 1 entry, identical to current band-level → no behavior change
3. **Formulary page** — combo drugs show per-ingredient table, mono drugs show same as before
4. **No fallbacks** — all drugs have `ingredient_doses[]`, no branching needed anywhere

## Critical Files

- `radhakishan_system/data/formulary_data_ABDM_FHIR.json` — data migration
- `radhakishan_system/scripts/migrate_dosing_bands.js` — NEW migration script
- `web/dose-engine.js` — computeSliderRange(), computeDose()
- `web/prescription-pad.html` — fmtDoseBand(), confirmAddMed(), dpRecalc(), renderReview()
- `web/formulary.html` — _renderViewDosingBands()

## Execution Order

1. Write migration script
2. Run migration script on JSON (adds ingredient_doses[] to all 671 bands)
3. Manually enrich Wikoryl AF with PE's dose ranges (already researched)
4. Update dose-engine.js (computeSliderRange + computeDose)
5. Update prescription-pad.html (fmtDoseBand + confirmAddMed + dpRecalc)
6. Update formulary.html (_renderViewDosingBands)
7. Push JSON to Supabase
8. Commit + push to GitHub
