/**
 * Migrate dosing_bands to per-ingredient format (ingredient_doses[])
 *
 * For each drug:
 *   1. Match dosing band fields to ingredients from formulations
 *   2. Create ingredient_doses[] with snomed_code from formulation ingredients
 *   3. Move dose_min/max_qty, max_single/daily_qty into ingredient_doses
 *   4. Remove those fields from band level
 *   5. Keep band-level: indication, age_band, method, is_per_day,
 *      frequency_per_day, interval_hours, duration_*, rounding_rule, notes, etc.
 *
 * Usage: node migrate_dosing_bands.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

const SOURCE_FILES = [
  "formulary_data_ABDM_FHIR.json",
  "formulary_data_ABDM_FHIR_generics.json",
  "formulary_data_ABDM_FHIR_orphans.json",
];

// Fields to MOVE from band level into ingredient_doses
const FIELDS_TO_MOVE = [
  "dose_min_qty",
  "dose_min_unit",
  "dose_max_qty",
  "dose_max_unit",
  "dose_unit",
  "dose_basis",
  "max_single_qty",
  "max_single_unit",
  "max_daily_qty",
  "max_daily_unit",
  "dose_reference_ingredient",
];

// Fields to KEEP at band level
// indication, age_band, ga_weeks_min, ga_weeks_max, method, is_per_day,
// frequency_per_day, interval_hours, duration_days, duration_days_default,
// duration_note, loading_dose_qty, loading_dose_unit, loading_dose_basis,
// maintenance_dose_qty, maintenance_dose_unit, rounding_rule, notes

function getIngredients(drug) {
  // Get unique ingredients across all formulations
  const seen = {};
  const result = [];
  for (const fm of drug.formulations || []) {
    for (const ing of fm.ingredients || []) {
      const key = ing.snomed_code || ing.name;
      if (!seen[key]) {
        seen[key] = true;
        result.push({
          name: ing.name,
          snomed_code: ing.snomed_code || null,
          is_primary: !!ing.is_primary,
        });
      }
    }
  }
  return result;
}

function migrateDrug(drug) {
  if (!drug.dosing_bands || !drug.dosing_bands.length) return 0;

  const ingredients = getIngredients(drug);
  if (!ingredients.length) {
    // No formulations/ingredients — create a generic single entry
    ingredients.push({
      name: drug.generic_name || "Active ingredient",
      snomed_code: drug.snomed_code || null,
      is_primary: true,
    });
  }

  let migratedCount = 0;

  for (const band of drug.dosing_bands) {
    // Skip if already migrated
    if (band.ingredient_doses && band.ingredient_doses.length) continue;

    // Build ingredient_doses array
    const ingredientDoses = [];

    // Find which ingredient the band-level dose refers to
    const refIngredient = band.dose_reference_ingredient;

    for (const ing of ingredients) {
      const isRef =
        refIngredient &&
        ing.name.toLowerCase().includes(refIngredient.toLowerCase());
      const isPrimary = ing.is_primary;
      const isTarget = isRef || (!refIngredient && isPrimary);

      if (isTarget) {
        // This ingredient gets the band-level dose values
        ingredientDoses.push({
          ingredient: ing.name,
          snomed_code: ing.snomed_code,
          dose_min_qty: band.dose_min_qty ?? null,
          dose_max_qty: band.dose_max_qty ?? null,
          dose_unit: band.dose_unit || null,
          max_single_mg: band.max_single_qty ?? null,
          max_daily_mg: band.max_daily_qty ?? null,
          is_limiting: true,
          source: null,
        });
      } else {
        // Secondary ingredient — ranges unknown, need manual enrichment
        ingredientDoses.push({
          ingredient: ing.name,
          snomed_code: ing.snomed_code,
          dose_min_qty: null,
          dose_max_qty: null,
          dose_unit: band.dose_unit || null,
          max_single_mg: null,
          max_daily_mg: null,
          is_limiting: false,
          source: null,
        });
      }
    }

    // Set ingredient_doses on the band
    band.ingredient_doses = ingredientDoses;

    // Remove fields that moved into ingredient_doses
    for (const field of FIELDS_TO_MOVE) {
      delete band[field];
    }

    migratedCount++;
  }

  return migratedCount;
}

function processFile(filename) {
  const srcPath = path.join(DATA_DIR, filename);
  const dstFilename = filename.replace(".json", "_v3.json");
  const dstPath = path.join(DATA_DIR, dstFilename);

  console.log(`\n=== Processing ${filename} ===`);

  if (!fs.existsSync(srcPath)) {
    console.log(`  SKIP: file not found`);
    return;
  }

  // Copy source to destination
  const drugs = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  console.log(`  Total drugs: ${drugs.length}`);

  let totalBands = 0;
  let migratedBands = 0;
  let drugsWithBands = 0;
  let comboDrugs = 0;

  for (const drug of drugs) {
    const bandCount = (drug.dosing_bands || []).length;
    if (bandCount > 0) drugsWithBands++;

    // Check if combo drug
    const ings = getIngredients(drug);
    if (ings.length > 1) comboDrugs++;

    totalBands += bandCount;
    migratedBands += migrateDrug(drug);
  }

  // Write to new file
  fs.writeFileSync(dstPath, JSON.stringify(drugs, null, 2));

  console.log(`  Drugs with dosing bands: ${drugsWithBands}`);
  console.log(`  Combo drugs (>1 ingredient): ${comboDrugs}`);
  console.log(`  Total bands: ${totalBands}`);
  console.log(`  Migrated bands: ${migratedBands}`);
  console.log(`  Output: ${dstFilename}`);

  // Verify a sample
  const sample = drugs.find(
    (d) =>
      d.dosing_bands &&
      d.dosing_bands.length &&
      d.dosing_bands[0].ingredient_doses,
  );
  if (sample) {
    const b = sample.dosing_bands[0];
    console.log(`\n  Sample: ${sample.generic_name}`);
    console.log(`    Band method: ${b.method}`);
    console.log(`    ingredient_doses: ${b.ingredient_doses.length} entries`);
    b.ingredient_doses.forEach((id) => {
      console.log(
        `      ${id.ingredient} (${id.snomed_code}): ${id.dose_min_qty}-${id.dose_max_qty} ${id.dose_unit} | max_single: ${id.max_single_mg} | limiting: ${id.is_limiting}`,
      );
    });
    // Verify band-level fields are removed
    const removed = FIELDS_TO_MOVE.filter((f) => b[f] !== undefined);
    if (removed.length) {
      console.log(`    WARNING: band-level fields NOT removed: ${removed}`);
    } else {
      console.log(`    OK: all band-level dose fields removed`);
    }
    // Verify band-level fields that should remain
    const kept = [
      "indication",
      "age_band",
      "method",
      "is_per_day",
      "frequency_per_day",
    ];
    const missing = kept.filter((f) => b[f] === undefined);
    if (missing.length) {
      console.log(
        `    WARNING: expected band-level fields missing: ${missing}`,
      );
    } else {
      console.log(`    OK: band-level structural fields preserved`);
    }
  }
}

// Run
console.log("Dosing Bands Migration: band-level → ingredient_doses[]");
console.log("=========================================================");
SOURCE_FILES.forEach(processFile);
console.log(
  "\n✓ Migration complete. Review _v3 files before replacing originals.",
);
