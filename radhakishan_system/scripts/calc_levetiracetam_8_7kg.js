// One-off: run web/dose-engine.js for Levetiracetam Oral, 8.7 kg, pediatric epilepsy band.
// Uses the Oral solution formulation (100 mg/mL) and the child epilepsy band
// (10-30 mg/kg/day BID, max single 1500 mg, max daily 3000 mg).

// Shim globals because dose-engine.js is an IIFE that attaches to `window`.
global.window = {};
require("../../web/dose-engine.js");
const DE = global.window.DoseEngine;

const WEIGHT_KG = 8.7;

// Primary ingredient from formulary: Levetiracetam 100 mg/mL oral solution.
const ingredients = [
  DE.makeIngredient("Levetiracetam", true, 100, "mg", 1, "mL"),
];

// Midpoint of the 10-30 mg/kg/day range = 20 mg/kg/day (BID).
// Engine expects sliderValue in mg/kg/day when method=weight and isPerDay=true.
const sliderValue = 20;
const frequency = 2; // BID

// Per-ingredient max caps from the dosing band.
const ingredientBands = [
  {
    ingredient_name: "Levetiracetam",
    max_single_mg: 1500,
    max_daily_mg: 3000,
    dose_min_qty: 10,
    dose_max_qty: 30,
  },
];

const result = DE.computeDose({
  method: "weight",
  weight: WEIGHT_KG,
  sliderValue,
  isPerDay: true,
  frequency,
  ingredients,
  form: "syrup",
  outputUnit: "mL",
  ingredientBands,
});

const li = result.ingredientDoses[0];

console.log(
  "=== Levetiracetam Oral — 8.7 kg baby, 20 mg/kg/day BID (midpoint of 10-30 mg/kg/day band) ===",
);
console.log(
  "Dispense per dose        :",
  result.vol,
  "(",
  result.enD,
  "/",
  result.hiD,
  ")",
);
console.log(
  "Dispense per day         :",
  (result.volumeUnits * frequency).toFixed(2),
  "mL",
);
console.log("Volume (mL) per dose     :", result.volumeMl, "mL");
console.log("mg per dose (actual)     :", result.fd, "mg");
console.log("mg per day (actual)      :", li.mgPerDay.toFixed(2), "mg");
console.log("mg/kg/day (actual)       :", (li.mgPerDay / WEIGHT_KG).toFixed(2));
console.log("Within therapeutic range :", li.withinRange);
console.log("Max exceeded             :", li.maxExceeded);
console.log("Capped                   :", result.capped);
console.log("Warnings                 :", result.warnings);
console.log("");
console.log("Calc trace:");
console.log(result.calc);
