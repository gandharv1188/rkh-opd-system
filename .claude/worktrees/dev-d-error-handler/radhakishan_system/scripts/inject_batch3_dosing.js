#!/usr/bin/env node
/**
 * Injects dosing_bands from _batch3_dosing_bands.json into the formulary files.
 * Matches by generic_name (case-insensitive).
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

// Load dosing bands
const dosingBands = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "_batch3_dosing_bands.json"), "utf8"),
);

// Load all 3 formulary files
const files = [
  "formulary_data_ABDM_FHIR.json",
  "formulary_data_ABDM_FHIR_generics.json",
  "formulary_data_ABDM_FHIR_orphans.json",
];

let totalInjected = 0;
let notFound = [];

for (const fileName of files) {
  const filePath = path.join(DATA_DIR, fileName);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let injectedInFile = 0;

  for (const [drugName, bands] of Object.entries(dosingBands)) {
    const drugLower = drugName.toLowerCase().trim();

    for (const entry of data) {
      const gn = (entry.generic_name || "").toLowerCase().trim();
      if (gn === drugLower) {
        if (!entry.dosing_bands || entry.dosing_bands.length === 0) {
          entry.dosing_bands = bands;
          injectedInFile++;
          totalInjected++;
          console.log(
            `  [${fileName}] Injected ${bands.length} bands into: ${entry.generic_name}`,
          );
        } else {
          console.log(
            `  [${fileName}] SKIPPED (already has bands): ${entry.generic_name}`,
          );
        }
        break;
      }
    }
  }

  if (injectedInFile > 0) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    console.log(`\nWrote ${injectedInFile} updates to ${fileName}`);
  } else {
    console.log(`\nNo updates for ${fileName}`);
  }
}

// Check for drugs in dosingBands that weren't found
for (const drugName of Object.keys(dosingBands)) {
  const drugLower = drugName.toLowerCase().trim();
  let found = false;
  for (const fileName of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"),
    );
    if (
      data.some(
        (e) => (e.generic_name || "").toLowerCase().trim() === drugLower,
      )
    ) {
      found = true;
      break;
    }
  }
  if (!found) notFound.push(drugName);
}

console.log(`\n=== SUMMARY ===`);
console.log(
  `Total drugs with dosing bands: ${Object.keys(dosingBands).length}`,
);
console.log(`Total injections: ${totalInjected}`);
if (notFound.length > 0) {
  console.log(`Not found in formulary: ${notFound.join(", ")}`);
}
