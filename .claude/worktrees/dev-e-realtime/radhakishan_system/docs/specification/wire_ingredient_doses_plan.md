# Wire App to ingredient_doses[] Data Structure

## Context

The formulary database has been fully migrated: all 680 drugs across 3 files now use `ingredient_doses[]` inside each dosing band. Band-level dose fields (`dose_min_qty`, `dose_max_qty`, `max_single_qty`, `max_daily_qty`, `dose_unit`, `dose_basis`) have been **removed**. However, the application code still references these removed fields in ~20 locations across 3 files. The most critical: Claude AI receives null dosing data because `buildFormularyContext()` reads the removed fields.

---

## Files to Modify

### 1. `web/prescription-pad.html` — 8 fixes

**FIX A (CRITICAL): `buildFormularyContext()` ~line 4879-4884**
Rewrite the dosing bands string builder to read from `ingredient_doses[]`:

```js
const bands = (f.dosing_bands || [])
  .map((b) => {
    const ids = b.ingredient_doses || [];
    const doseStr = ids
      .map(
        (id) =>
          (id.ingredient || "").split(" ")[0] +
          ": " +
          (id.dose_min_qty || "?") +
          (id.dose_max_qty ? "-" + id.dose_max_qty : "") +
          " " +
          (id.dose_unit || "mg/kg"),
      )
      .join(", ");
    return (
      doseStr +
      " " +
      (b.frequency_per_day || "?") +
      "x/day (" +
      (b.age_band || "all") +
      ")"
    );
  })
  .join("; ");
```

**FIX B: `renderReview()` slider section — `doseUnit` ~line 5573**

```js
// OLD: const doseUnit = band?.dose_unit || "mg/kg/day";
const limBand = DoseEngine.getLimiting(band);
const doseUnit = limBand?.dose_unit || "mg/kg/day";
```

**FIX C: `renderReview()` — `curDose` initialization ~line 5574,5579**

```js
// OLD: let curDose = m.dose_mg_per_kg || band?.dose_min_qty || 0;
const limForCurDose = DoseEngine.getLimiting(band);
let curDose = m.dose_mg_per_kg || limForCurDose?.dose_min_qty || 0;
// Fixed method branch: band?.dose_min_qty → limForCurDose?.dose_min_qty
```

**FIX D: `renderReview()` — `inAnyBand` check ~line 5619-5620**

```js
// OLD: curDose >= b.dose_min_qty && curDose <= (b.dose_max_qty || b.dose_min_qty)
const lb = DoseEngine.getLimiting(b);
lb &&
  curDose >= lb.dose_min_qty &&
  curDose <= (lb.dose_max_qty || lb.dose_min_qty);
```

**FIX E: `renderReview()` — band legend sort + labels ~line 5662,5672,5685-5687**

```js
// OLD: a.dose_min_qty - b.dose_min_qty → sort by limiting ingredient
.sort((a, b) => {
  const la = DoseEngine.getLimiting(a), lb = DoseEngine.getLimiting(b);
  return (la?.dose_min_qty || 0) - (lb?.dose_min_qty || 0);
})
// And in the label/onclick: b.dose_min_qty → DoseEngine.getLimiting(b)?.dose_min_qty
```

**FIX F: `dpRecalc()` slider label — `doseUnit` ~line 2702**

```js
// OLD: const doseUnit = band?.dose_unit || "mg/kg/day";
const limForUnit = DoseEngine.getLimiting(band);
const doseUnit = limForUnit?.dose_unit || "mg/kg/day";
```

**FIX G: `fmtDoseBand()` — remove legacy fallback ~line 2913-2929**
Remove the entire `else` block that reads band-level fields. If `ingredient_doses` is missing, return "No dosing data".

**FIX H: Remove dead code + outdated comments**

- Remove `calcDose()` function (~line 5094-5142, ~50 lines)
- Update 4 comments referencing "calcDose" to "DoseEngine"
- Remove `confirmAddMed()` fallbacks to `band.dose_unit`, `band.max_single_qty` (~line 7251-7252)

### 2. `web/dose-engine.js` — 3 fixes

**FIX I: `computeSliderRange()` — remove band-level fallbacks ~lines 702,728,758,785**
Replace all 4 instances of:

```js
var dMin = lim ? lim.dose_min_qty : b.dose_min_qty;
```

with:

```js
if (!lim) return; // skip bands without ingredient_doses
var dMin = lim.dose_min_qty;
```

**FIX J: `_findIngBand()` — fix snomed matching ~line 273-274**
Make snomed match preferred but not blocking:

```js
// Try snomed first, then fall back to name matching
var match = ingredientBands.find(ib =>
  ib.snomed_code && ing.snomed_code && ib.snomed_code === ing.snomed_code
);
if (match) return match;
return ingredientBands.find(ib => /* name matching */) || null;
```

**FIX K: Remove legacy scalar params**
Remove `maxSingleDoseMg`/`maxDailyDoseMg` from `computeDose()` params — everything should come from `ingredientBands`. Update callers in prescription-pad.html to stop passing `maxSingleDoseMg: maxS`.

### 3. `web/formulary.html` — 1 fix

**FIX L: Search results display ~line 1770-1772**
Read dose from `ingredient_doses[]` instead of band-level:

```js
const ids = b.ingredient_doses || [];
const lim = ids.find((id) => id.is_limiting) || ids[0];
const qty = lim
  ? lim.dose_min_qty !== (lim.dose_max_qty || lim.dose_min_qty)
    ? lim.dose_min_qty + "-" + lim.dose_max_qty
    : lim.dose_min_qty
  : "?";
```

---

## Execution Order

1. Fix A (buildFormularyContext) — CRITICAL, Claude can't generate prescriptions without this
2. Fixes B-F (renderReview + dpRecalc slider) — all band-level field references in UI
3. Fix G (fmtDoseBand legacy removal)
4. Fix H (dead code cleanup)
5. Fix I (dose-engine.js fallbacks)
6. Fix J (snomed matching improvement)
7. Fix K (remove legacy scalar params)
8. Fix L (formulary.html search results)

---

## Verification

1. Open prescription pad → connect Supabase → select a patient
2. Type "amoxicillin" in clinical note → Generate → verify Claude receives proper dosing data
3. Click "Adjust dose" on any medicine → verify slider shows correct zones
4. Add Wikoryl AF drops → verify slider shows CPM-based range with PE breakdown
5. Open formulary.html → search "CHLORPHENAMINE" → verify dose shows per-ingredient
6. Check browser console for any undefined/null errors

## Critical Files

- `web/prescription-pad.html` — lines ~2702, 4879-4884, 5094-5142, 5573-5687, 7250-7252
- `web/dose-engine.js` — lines ~273-274, 702-788
- `web/formulary.html` — lines ~1770-1772
