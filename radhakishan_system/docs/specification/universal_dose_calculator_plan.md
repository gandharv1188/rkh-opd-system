# Universal Dose Calculator Engine

## Context

The current dose calculator in `web/prescription-pad.html` handles only **single-ingredient drugs** correctly. For multi-ingredient combo drugs (e.g., Wikoryl AF drops — Phenylephrine 2.5mg/mL + Chlorpheniramine 1mg/mL), `getConc()` picks only the `is_primary` ingredient's concentration, making calculations wrong. Fixed-dose drugs disable the slider and use a stepper hack (`cmg=1, cml=1`). BSA/GFR methods fall through to weight-based with wrong units.

**Goal:** Replace the calculation engine with a universal one that works from first principles — **concentration × volume = dose** — for all drug types, all dosing methods, and any number of ingredients. Keep the existing UI (slider, radios, bilingual display).

**Phased approach:**
- **Phase 1 (this build):** Engine works with current drug-level dosing bands. Mono drugs work perfectly. Combo drugs get volume-based per-ingredient dose display (derived from concentrations). Slider is universal for all methods.
- **Phase 2 (data enrichment):** Add per-ingredient dosing bands (`ingredient_bands[]`). Engine already supports them — just needs data.

---

## Architecture

### New file: `web/dose-engine.js` (~350 lines)
- Pure calculation logic, no DOM access
- Loaded via `<script src="dose-engine.js"></script>` before inline script in prescription-pad.html
- Exports via `window.DoseEngine = { ... }`

### Modified file: `web/prescription-pad.html`
- Replace `calcDose()` calls with `DoseEngine.computeDose()`
- Remove `dpFixedChange()` — slider is universal now
- Simplify `dpRecalc()` — no more fixed-dose branch
- Update `applyDose()` — multi-ingredient calc strings + Row 1
- Unify dose panel rendering — all methods use slider

---

## `dose-engine.js` API

### Data Types

```js
// Ingredient (parsed from formulary formulation)
Ingredient = {
  name: string,             // "Phenylephrine hydrochloride"
  isPrimary: boolean,       // true for the dosing-basis ingredient
  concMgPerUnit: number,    // concentration: mg per denominator unit (e.g., 2.5 for 2.5mg/mL)
  denominator: number,      // denominator quantity (e.g., 1 for 1mL, 5 for 5mL)
  denominatorUnit: string,  // "mL", "tablet", "g", etc.
  // Phase 2: per-ingredient dosing ranges
  doseMinPerKg: number|null,    // mg/kg min (null = not specified, derive from drug-level band)
  doseMaxPerKg: number|null,    // mg/kg max
  maxSingleMg: number|null,     // absolute max per dose
  maxDailyMg: number|null       // absolute max per day
}

// Input to computeDose
DoseParams = {
  method: "weight"|"fixed"|"bsa"|"age"|"gfr"|"infusion",
  weight: number,                // kg
  bsa: number|null,              // m² (for BSA method, Mosteller)
  heightCm: number|null,         // for BSA calculation if bsa not provided
  sliderValue: number,           // slider position
    // weight/bsa: mg/kg or mg/m² (per-day or per-dose)
    // fixed/age: dispensing units (drops, mL, tablets)
  isPerDay: boolean,
  frequency: number,             // 1-6
  ingredients: Ingredient[],     // ALL ingredients
  form: string,                  // "syrup","drops","tablet", etc.
  outputUnit: string,            // "mL","drops","tsp","tablet","capsule","puffs"
  dropsPerMl: number,            // default 20
  // Drug-level max doses (Phase 1 — from dosing band)
  maxSingleDoseMg: number|null,  // primary ingredient max per dose
  maxDailyDoseMg: number|null    // primary ingredient max per day
}

// Output from computeDose
DoseResult = {
  vol: string,              // "5 drops", "2.5ml", "1 tablet"
  enD: string,              // English display
  hiD: string,              // Hindi display
  calc: string,             // Multi-ingredient calc trace
  capped: boolean,          // any max dose applied
  fd: string,               // final dose mg (primary) as string
  volumeMl: number,         // raw volume in mL (for liquids)
  volumeUnits: number,      // raw count (for solids: tablets, capsules)
  ingredientDoses: IngredientDose[],
  warnings: string[]
}

IngredientDose = {
  name: string,
  isPrimary: boolean,
  mgPerDose: number,        // mg delivered per administration
  mgPerDay: number,         // mg delivered per day
  mgPerKg: number|null,     // mg/kg achieved (null for fixed without weight)
  maxExceeded: boolean,     // true if exceeds known max
  maxNote: string|null,     // "capped at 4mg/dose"
  withinRange: boolean|null // true/false/null (null = no range known)
}
```

### Core Functions

**`DoseEngine.computeDose(params) → DoseResult`**

Algorithm:
1. Find primary ingredient (`isPrimary === true` or index 0)
2. Compute primary mg/dose based on method:
   - **weight**: `mgPerDose = isPerDay ? (sliderValue × weight / frequency) : (sliderValue × weight)`
   - **fixed/age**: slider is dispensing units → `mgPerDose = sliderValue × primary.concMgPerUnit` (direct: units × concentration)
   - **bsa**: `mgPerDose = isPerDay ? (sliderValue × bsa / frequency) : (sliderValue × bsa)`
   - **gfr**: same as weight (GFR adjustment is upstream in band selection)
   - **infusion**: `mgPerDose = sliderValue × weight` (rate-based)
3. Cap primary at maxSingleDoseMg if exceeded
4. Compute volume: `volumeMl = mgPerDose / primary.concMgPerUnit`
5. Round to form-appropriate precision:
   - drops: `Math.round(volumeMl × dropsPerMl)` → whole drops
   - syrup: `Math.round(volumeMl × 2) / 2` → 0.5mL
   - tablet: `Math.round(count × 4) / 4` → 0.25 tab
   - capsule: `Math.round(count)` → whole
   - injection: `Math.round(volumeMl × 10) / 10` → 0.1mL
   - puffs: `Math.round(count)` → whole
6. Back-calculate actual primary mg from rounded volume
7. Compute ALL other ingredients' mg from same volume: `mgPerDose = volumeMl × ingredient.concMgPerUnit`
8. Check per-ingredient max doses (Phase 2: from `ingredient.maxSingleMg`; Phase 1: only primary checked)
9. Build ingredientDoses array
10. Format bilingual display + calc string
11. Return DoseResult

**`DoseEngine.computeSliderRange(params) → SliderRange`**

```js
SliderRange = {
  min: number,
  max: number,
  step: number,
  value: number,       // initial position
  unit: string,        // what slider axis represents ("mg/kg/day", "drops", "mL", "mg/m²/day")
  zones: BandZone[]    // for gradient rendering
}
```

Universal slider logic:
- **weight/bsa/gfr**: axis = mg/kg or mg/m², range from `0.5×globalMin` to `2×globalMax`
- **fixed/age**: axis = dispensing units, range from `min(1, band.dose_min_qty)` to `band.dose_max_qty × 1.5`
- **infusion**: axis = rate units

**`DoseEngine.snapToUnit(rawValue, params) → number`**

Snaps slider to discrete dispensing units. For weight-based: finds the mg/kg that produces a clean volume (whole drops, 0.5mL, etc.). For fixed: snaps to the unit step directly.

**`DoseEngine.parseIngredients(formulation) → Ingredient[]`**

Replaces `getConc()`. Handles both FHIR format (`ingredients[]` with `strength_numerator/denominator`) and legacy format (`conc_qty/per_qty`). Returns ALL ingredients. For legacy single-ingredient, wraps in array.

**`DoseEngine.calculateBSA(weightKg, heightCm) → number`**

Mosteller formula: `√(height × weight / 3600)`

### Hindi/English Constants (consolidated)

All bilingual maps currently duplicated across 5+ places in prescription-pad.html are consolidated in dose-engine.js:
- `HINDI_DROPS` (1-25), `HINDI_ML` (0.5-10), `HINDI_TABLETS` (0.25-2)
- `HINDI_UNITS` (drops→बूंदें, tablet→गोली, etc.)
- `FREQ_EN` (1→once, 2→twice, etc.), `FREQ_HI` (1→एक बार, etc.)

---

## Changes in prescription-pad.html

### REMOVE
| Function | Lines | Reason |
|---|---|---|
| `calcDose()` | 5139-5239 | → `DoseEngine.computeDose()` |
| `getConc()` | 2145-2169 | → `DoseEngine.parseIngredients()` |
| `dpFixedChange()` | 2534-2609 | Slider is universal — no stepper |
| Fixed stepper HTML | 5504-5556 | All methods use slider |

### SIMPLIFY
| Function | Lines | Change |
|---|---|---|
| `dpRecalc()` | 2612-2819 | Remove 70-line fixed branch (2615-2686). Single path: read state → `DoseEngine.computeDose()` → update display |
| `dpSliderChanged()` | 2422-2520 | Replace 50 lines of snap logic with `DoseEngine.snapToUnit()` + `dpRecalc()` |

### MODIFY
| Function | Lines | Change |
|---|---|---|
| `applyDose()` | 5932-6179 | Use `DoseEngine.computeDose()`. Multi-ingredient calc string. Remove unit override block (engine handles it via `outputUnit`). |
| `dpFormChanged()` | 2312-2397 | Use `DoseEngine.parseIngredients()`. Strength radios show multi-ingredient concentrations for combo drugs. |
| `dpStrengthChanged()` | 2400-2414 | Store full ingredients array via `data-ingredients` attribute on panel. |
| `confirmAddMed()` | 7274-7326 | Use `DoseEngine.parseIngredients()`. Store `ingredients[]` on medicine object. |
| Dose panel HTML | 5329-5700 | Unify: always render slider via `DoseEngine.computeSliderRange()`. Remove stepper branch. |
| `fmtConc()` | 2172-2181 | Show multi-ingredient: "2.5+1mg/mL" for combo drugs. |

### KEEP UNCHANGED
`getDoseRef()`, `parseAgeMonths()`, `fmtDoseBand()`, `simplifyForm()`, `getUnitOptions()`, `dpFreqChange()`, `dpUnitChanged()`, `toggleEP()`, `renderPictogram()`, `showAddMedicine()`, all route maps, form maps.

### ADD
```js
function getSelectedIngredients(pid, med) {
  // Returns Ingredient[] from formularyCache for current form+strength selection
  // Fallback: single ingredient from cmg/cml hidden fields (backward compat)
}
```

---

## Universal Slider — How It Works for Each Method

| Method | Slider represents | Gradient zones | Slider label shows |
|---|---|---|---|
| `weight` | mg/kg/day (or /dose) | Band dose ranges | "2.5ml — 15mg/kg/day — Pneumonia" |
| `bsa` | mg/m²/day (or /dose) | Band dose ranges | "1.2ml — 75mg/m²/day" |
| `fixed` | dispensing units (drops/mL/tab) | Band min-max range | "5 drops (PE 0.625mg + CPM 0.25mg)" |
| `age` | dispensing units | Band min-max range | "5ml (125mg)" |
| `gfr` | mg/kg (adjusted) | Band dose ranges | Same as weight + GFR note |
| `infusion` | rate (mL/hr or mg/kg/hr) | Band dose ranges | "12 mL/hr" |

For **fixed/age**, the engine back-calculates per-ingredient mg at the selected volume and displays them in the slider label. The doctor sees what they're actually giving.

---

## Calc String Format

**Single ingredient weight-based (Amoxicillin):**
```
15mg/kg × 10kg = 150mg/day ÷ 3 = 50mg/dose → 2.5ml
```

**Multi-ingredient (Wikoryl AF drops, 10kg child, 5 drops):**
```
5 drops = 0.25mL
  Phenylephrine: 0.625mg (0.06mg/kg) ✓
  Chlorpheniramine: 0.25mg (0.025mg/kg) ✓
```

**Multi-ingredient weight-based (Amox-Clav 250+62.5/5ml):**
```
25mg/kg × 10kg = 250mg/day ÷ 3 = 83mg/dose → 1.7ml
  Amoxicillin: 83mg (8.3mg/kg) ✓
  Clavulanate: 21mg (2.1mg/kg)
```

---

## Phase 2 Data Model (future — engine supports it now)

Each dosing band gains an optional `ingredient_bands[]`:

```json
{
  "indication": "Common cold",
  "method": "weight",
  "dose_min_qty": 0.1,
  "dose_max_qty": 0.2,
  "dose_unit": "mg/kg/dose",
  "dosing_ingredient": "Chlorpheniramine maleate",
  "ingredient_bands": [
    {
      "ingredient_name": "Chlorpheniramine maleate",
      "dose_min_qty": 0.05,
      "dose_max_qty": 0.2,
      "dose_unit": "mg/kg/dose",
      "max_single_qty": 4,
      "max_daily_qty": 16
    },
    {
      "ingredient_name": "Phenylephrine hydrochloride",
      "dose_min_qty": 0.025,
      "dose_max_qty": 0.1,
      "dose_unit": "mg/kg/dose",
      "max_single_qty": 10,
      "max_daily_qty": 40
    }
  ]
}
```

The engine checks: if `band.ingredient_bands` exists, it maps each ingredient's max doses from there. If not, it uses the drug-level `max_single_qty` for the primary ingredient only (Phase 1 behavior).

---

## Backward Compatibility

- AI-generated prescriptions return scalar `concentration_mg`/`concentration_per_ml`. The engine handles this: if no `ingredients[]` on medicine object, construct single-ingredient from `cmg`/`cml`.
- Hidden fields `cmg`/`cml` still populated (primary ingredient) for any code that reads them.
- `fmtConc()` still works for display.
- Edge Function's `get_formulary` tool returns full ingredients — no change needed server-side.

---

## Implementation Sequence

1. Create `web/dose-engine.js` — all pure functions + constants
2. Add `<script src="dose-engine.js"></script>` to prescription-pad.html
3. Add `getSelectedIngredients()` helper in prescription-pad.html
4. Replace `calcDose()` calls in `dpRecalc()` with `DoseEngine.computeDose()`
5. Replace `calcDose()` calls in `applyDose()` with `DoseEngine.computeDose()`
6. Unify dose panel rendering — remove stepper branch, all methods use slider via `DoseEngine.computeSliderRange()`
7. Update `dpSliderChanged()` to use `DoseEngine.snapToUnit()`
8. Remove `calcDose()`, `getConc()`, `dpFixedChange()`, stepper HTML
9. Update `confirmAddMed()` to store ingredients array on medicine object
10. Update `dpFormChanged()` + `fmtConc()` for multi-ingredient display

---

## Verification

Test with real formulary data:
1. **Amoxicillin syrup** (125mg/5mL, 10kg, 25mg/kg/day TDS) → 2.5ml ✓
2. **Wikoryl AF drops** (PE 2.5+CPM 1 mg/mL, 10kg) → slider shows drops, calc shows both ingredients
3. **Albendazole 400mg tablet** (fixed) → slider shows tablets (0.5-2), at 1 tab shows 400mg
4. **Amox-Clav syrup** (250+62.5/5mL) → slider mg/kg, calc shows both
5. **Paracetamol drops** (100mg/mL, weight-based) → drops with correct rounding
6. **No formulary match** → falls back to cmg/cml, works like current single-ingredient
7. **BSA drug** (Lopinavir/Ritonavir, method=bsa) → slider in mg/m², uses Mosteller

## Critical Files
- `web/dose-engine.js` — NEW (create)
- `web/prescription-pad.html` — MODIFY (lines 2145-2169, 2312-2609, 2612-2819, 5139-5556, 5932-6179, 7274-7326)
