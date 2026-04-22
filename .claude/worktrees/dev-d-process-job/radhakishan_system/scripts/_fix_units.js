#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "..", "data");

function normalize(u) {
  if (!u) return u;
  const ul = u.toLowerCase().trim();
  if (ul === "milligram" || ul === "mg") return "mg";
  if (ul === "millilitre" || ul === "ml" || ul === "milliliter") return "mL";
  if (ul === "microgram" || ul === "mcg" || ul === "ug" || ul === "μg")
    return "mcg";
  if (ul === "gram" || ul === "g") return "g";
  if (ul === "tablet") return "tablet";
  if (ul === "capsule") return "capsule";
  if (ul === "international unit" || ul === "iu") return "IU";
  if (ul === "unit") return "unit";
  if (ul === "actuation") return "actuation";
  if (ul === "dose") return "dose";
  if (ul === "litre" || ul === "l") return "L";
  if (ul === "kilogram" || ul === "kg") return "kg";
  if (ul === "nanogram") return "ng";
  if (ul === "mmol") return "mmol";
  if (ul === "meq") return "mEq";
  if (ul === "vial") return "vial";
  return u;
}

const massUnits = new Set([
  "mg",
  "mcg",
  "g",
  "ng",
  "kg",
  "IU",
  "unit",
  "mmol",
  "mEq",
]);
const volumeUnits = new Set(["mL", "L"]);

let totalFixed = 0;
for (const file of [
  "formulary_data_ABDM_FHIR.json",
  "formulary_data_ABDM_FHIR_generics.json",
  "formulary_data_ABDM_FHIR_orphans.json",
]) {
  const fp = path.join(DATA_DIR, file);
  const drugs = JSON.parse(fs.readFileSync(fp, "utf8"));
  let fixed = 0;

  for (const d of drugs) {
    for (const f of d.formulations || []) {
      for (const ing of f.ingredients || []) {
        const oldNu = ing.strength_numerator_unit;
        const oldDu = ing.strength_denominator_unit;
        ing.strength_numerator_unit = normalize(ing.strength_numerator_unit);
        ing.strength_denominator_unit = normalize(
          ing.strength_denominator_unit,
        );

        // Detect swap: numerator should be mass (mg), denominator should be volume (mL) or unit (tablet)
        const nu = ing.strength_numerator_unit;
        const du = ing.strength_denominator_unit;
        if (volumeUnits.has(nu) && massUnits.has(du)) {
          ing.strength_numerator_unit = du;
          ing.strength_denominator_unit = nu;
          fixed++;
        }

        if (
          oldNu !== ing.strength_numerator_unit ||
          oldDu !== ing.strength_denominator_unit
        ) {
          totalFixed++;
        }
      }

      // Rebuild conc note
      if (f.ingredients && f.ingredients.length) {
        f.indian_conc_note = f.ingredients
          .map(
            (i) =>
              i.name +
              " " +
              (i.strength_numerator || "?") +
              " " +
              (i.strength_numerator_unit || "") +
              " / " +
              (i.strength_denominator || 1) +
              " " +
              (i.strength_denominator_unit || ""),
          )
          .join(" + ")
          .trim();
      }
    }
  }

  fs.writeFileSync(fp, JSON.stringify(drugs, null, 2));
  console.log(
    file + ": " + fixed + " swaps fixed, total normalized: " + totalFixed,
  );
}

// Audit
const all = [
  ...JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"),
      "utf8",
    ),
  ),
  ...JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, "formulary_data_ABDM_FHIR_generics.json"),
      "utf8",
    ),
  ),
  ...JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans.json"),
      "utf8",
    ),
  ),
];
let bad = 0;
for (const d of all) {
  for (const f of d.formulations || []) {
    for (const ing of f.ingredients || []) {
      if (volumeUnits.has(ing.strength_numerator_unit)) {
        bad++;
        if (bad <= 5)
          console.log(
            "STILL BAD: " +
              d.generic_name +
              " " +
              ing.strength_numerator +
              " " +
              ing.strength_numerator_unit +
              "/" +
              ing.strength_denominator +
              " " +
              ing.strength_denominator_unit,
          );
      }
    }
  }
}
console.log("\nRemaining volume-as-numerator: " + bad);

// Show Paracetamol
const para = all.find((d) => d.generic_name === "Paracetamol");
if (para) {
  console.log("\nParacetamol suspensions:");
  para.formulations
    .filter((f) => f.form && f.form.includes("suspension"))
    .slice(0, 3)
    .forEach((f) => console.log("  " + f.indian_conc_note));
}
