#!/usr/bin/env node
/**
 * Extract IV fluids, electrolytes from SNOMED India Drug Extension
 * Add them to formulary_data_ABDM_FHIR.json
 */
const fs = require("fs");
const path = require("path");

const INDIA_BASE = path.join(
  "E:",
  "AI-Enabled HMIS",
  "SNOMED",
  "SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z",
  "SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z",
  "Snapshot",
  "Terminology",
);
const INT_BASE = path.join(
  "E:",
  "AI-Enabled HMIS",
  "SNOMED",
  "SnomedCT_InternationalRF2_PRODUCTION_20260301T120000Z",
  "SnomedCT_InternationalRF2_PRODUCTION_20260301T120000Z",
  "Snapshot",
  "Terminology",
);
const FORMULARY = path.join(
  "radhakishan_system",
  "data",
  "formulary_data_ABDM_FHIR.json",
);

// Load all names
console.log("Loading names...");
const allNames = new Map();
for (const file of [
  path.join(
    INDIA_BASE,
    "sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt",
  ),
  path.join(INT_BASE, "sct2_Description_Snapshot-en_INT_20260301.txt"),
]) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const c = line.split("\t");
    if (c.length < 9 || c[2] !== "1") continue;
    if (c[6] === "900000000000013009") allNames.set(c[4], c[7]);
    else if (!allNames.has(c[4]))
      allNames.set(c[4], c[7].replace(/\s*\([^)]+\)\s*$/, ""));
  }
}

// Load relationships + concrete values
console.log("Loading relationships...");
const relMap = new Map();
for (const line of fs
  .readFileSync(
    path.join(
      INDIA_BASE,
      "sct2_Relationship_Snapshot_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n")) {
  const c = line.split("\t");
  if (c.length < 10 || c[2] !== "1") continue;
  if (!relMap.has(c[4])) relMap.set(c[4], []);
  relMap.get(c[4]).push({ destId: c[5], typeId: c[7], group: c[6] });
}
const cvMap = new Map();
for (const line of fs
  .readFileSync(
    path.join(
      INDIA_BASE,
      "sct2_RelationshipConcreteValues_Snapshot_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n")) {
  const c = line.split("\t");
  if (c.length < 10 || c[2] !== "1") continue;
  if (!cvMap.has(c[4])) cvMap.set(c[4], []);
  cvMap
    .get(c[4])
    .push({ value: c[5].replace(/^#/, ""), typeId: c[7], group: c[6] });
}

function getName(cid) {
  return allNames.get(cid) || cid;
}

function extractDrug(cid) {
  const rels = relMap.get(cid) || [];
  const cvs = cvMap.get(cid) || [];
  const groups = {};
  for (const r of rels) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }
  for (const cv of cvs) {
    if (!groups[cv.group]) groups[cv.group] = [];
    groups[cv.group].push({ ...cv, isConcrete: true });
  }
  const g0 = groups["0"] || [];
  const doseFormRel = g0.find((r) => r.typeId === "411116001");
  const supplierRel = g0.find((r) => r.typeId === "774159003");
  const ingredients = [];
  for (const [gNum, gRels] of Object.entries(groups)) {
    if (gNum === "0") continue;
    const ingRel = gRels.find(
      (r) => r.typeId === "762949000" || r.typeId === "127489000",
    );
    if (!ingRel) continue;
    const pnv = gRels.find((r) => r.isConcrete && r.typeId === "1142135004");
    const pdv = gRels.find((r) => r.isConcrete && r.typeId === "1142136003");
    const pnu = gRels.find((r) => r.typeId === "733722007");
    const pdu = gRels.find((r) => r.typeId === "732945000");
    const cnv = gRels.find((r) => r.isConcrete && r.typeId === "1142137007");
    const cdv = gRels.find((r) => r.isConcrete && r.typeId === "1142138002");
    const cnu = gRels.find((r) => r.typeId === "733725009");
    const cdu = gRels.find((r) => r.typeId === "732947008");
    const ing = {
      name: getName(ingRel.destId),
      snomed_code: ingRel.destId,
      is_active: true,
      is_primary: ingredients.length === 0,
      strength_numerator: null,
      strength_numerator_unit: null,
      strength_denominator: null,
      strength_denominator_unit: null,
    };
    if (pnv) {
      ing.strength_numerator = parseFloat(pnv.value);
      ing.strength_numerator_unit = pnu ? getName(pnu.destId) : "mg";
      ing.strength_denominator = pdv ? parseFloat(pdv.value) : 1;
      ing.strength_denominator_unit = pdu ? getName(pdu.destId) : "unit";
    } else if (cnv) {
      ing.strength_numerator = parseFloat(cnv.value);
      ing.strength_numerator_unit = cnu ? getName(cnu.destId) : "mg";
      ing.strength_denominator = cdv ? parseFloat(cdv.value) : 1;
      ing.strength_denominator_unit = cdu ? getName(cdu.destId) : "mL";
    }
    ingredients.push(ing);
  }
  return {
    form: doseFormRel ? getName(doseFormRel.destId) : null,
    formCode: doseFormRel ? doseFormRel.destId : null,
    supplier: supplierRel ? getName(supplierRel.destId) : null,
    ingredients,
  };
}

// Find IV fluids
console.log("Finding IV fluids...");
const indiaDescs = fs
  .readFileSync(
    path.join(
      INDIA_BASE,
      "sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");
const ivConcepts = new Map();

for (let i = 1; i < indiaDescs.length; i++) {
  const c = indiaDescs[i].split("\t");
  if (c.length < 9 || c[2] !== "1" || c[6] !== "900000000000003001") continue;
  if (!c[7].includes("clinical drug)")) continue;
  const tl = c[7].toLowerCase();
  const isInfusion = tl.includes("solution for infusion");
  const isInjSolution = tl.includes("solution for injection");
  const isIVFluid =
    (tl.includes("sodium chloride") && (isInfusion || isInjSolution)) ||
    (tl.includes("glucose") && isInfusion && !tl.includes("monitor")) ||
    (tl.includes("potassium chloride") && (isInfusion || isInjSolution)) ||
    (tl.includes("sodium bicarbonate") && isInjSolution) ||
    (tl.includes("calcium gluconate") && isInjSolution) ||
    ((tl.includes("magnesium sulfate") || tl.includes("magnesium sulphate")) &&
      isInjSolution) ||
    (tl.includes("mannitol") && isInfusion) ||
    (tl.includes("water for injection") && tl.includes("clinical drug")) ||
    (tl.includes("albumin") &&
      (isInfusion || tl.includes("solution for infusion and/or injection"))) ||
    (tl.includes("gelatin") && isInfusion) ||
    (tl.includes("hydroxyethyl") && isInfusion);
  if (isIVFluid) ivConcepts.set(c[4], c[7]);
}

console.log("IV fluid concepts found:", ivConcepts.size);

// Group by generic type
const typeMap = new Map();
for (const [cid, fsn] of ivConcepts) {
  const tl = fsn.toLowerCase();
  let type;
  if (
    tl.includes("sodium chloride") &&
    (tl.includes("glucose") || tl.includes("dextrose"))
  )
    type = "DEXTROSE + SODIUM CHLORIDE (DNS)";
  else if (tl.includes("sodium chloride"))
    type = "SODIUM CHLORIDE 0.9% (NORMAL SALINE)";
  else if (tl.includes("glucose") || tl.includes("dextrose"))
    type = "DEXTROSE INFUSION";
  else if (tl.includes("potassium chloride"))
    type = "POTASSIUM CHLORIDE INJECTION";
  else if (tl.includes("sodium bicarbonate"))
    type = "SODIUM BICARBONATE INJECTION";
  else if (tl.includes("calcium gluconate"))
    type = "CALCIUM GLUCONATE INJECTION";
  else if (tl.includes("magnesium")) type = "MAGNESIUM SULPHATE INJECTION";
  else if (tl.includes("mannitol")) type = "MANNITOL INFUSION";
  else if (tl.includes("water for injection")) type = "WATER FOR INJECTION";
  else if (tl.includes("albumin")) type = "ALBUMIN HUMAN INFUSION";
  else if (tl.includes("gelatin")) type = "GELATIN (COLLOID) INFUSION";
  else if (tl.includes("hydroxyethyl"))
    type = "HYDROXYETHYL STARCH (HES) INFUSION";
  else type = "OTHER IV FLUID";
  if (!typeMap.has(type)) typeMap.set(type, []);
  const info = extractDrug(cid);
  typeMap.get(type).push({
    snomed_code: cid,
    brand_name: fsn.split("(")[0].trim(),
    manufacturer: info.supplier,
    form: info.form,
    form_code: info.formCode,
    ingredients: info.ingredients,
    display: getName(cid),
  });
}

// Build formulary entries
const newDrugs = [];
for (const [genericName, brands] of typeMap) {
  const formMap = new Map();
  for (const b of brands) {
    const key = b.ingredients
      .map(
        (i) => i.name + ":" + i.strength_numerator + i.strength_numerator_unit,
      )
      .sort()
      .join("|");
    if (!formMap.has(key)) {
      formMap.set(key, {
        form: b.form || "Solution for infusion",
        form_snomed_code: b.form_code,
        route: "IV",
        ingredients: b.ingredients,
        indian_brands: [],
        indian_conc_note: b.ingredients
          .map(
            (i) =>
              i.name +
              " " +
              i.strength_numerator +
              " " +
              i.strength_numerator_unit +
              " / " +
              i.strength_denominator +
              " " +
              i.strength_denominator_unit,
          )
          .join(" + "),
        display_name: b.display,
      });
    }
    formMap.get(key).indian_brands.push({
      name: b.brand_name,
      manufacturer: b.manufacturer,
      snomed_code: b.snomed_code,
      verified_on: "SNOMED CT India Extension March 2026",
    });
  }
  newDrugs.push({
    generic_name: genericName,
    snomed_code: brands[0]?.snomed_code || null,
    drug_class: "IV Fluid / Electrolyte",
    category: "Emergency",
    therapeutic_use: [
      "Fluid resuscitation",
      "Electrolyte replacement",
      "IV therapy",
    ],
    brand_names: [
      ...new Set(
        brands.map(
          (b) =>
            b.brand_name + (b.manufacturer ? " (" + b.manufacturer + ")" : ""),
        ),
      ),
    ].slice(0, 10),
    licensed_in_children: true,
    unlicensed_note: "",
    formulations: [...formMap.values()],
    dosing_bands: [],
    renal_adjustment_required: false,
    renal_bands: [],
    hepatic_adjustment_required: false,
    hepatic_note: null,
    contraindications: [],
    cross_reactions: [],
    interactions: [],
    black_box_warnings: [],
    pediatric_specific_warnings: [],
    monitoring_parameters: [],
    administration: [],
    food_instructions: null,
    storage_instructions: "Store below 25 C. Do not freeze.",
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["SNOMED CT India Drug Extension March 2026"],
    last_reviewed_date: null,
    active: true,
  });
}

console.log("\nIV fluid drug entries created:", newDrugs.length);
newDrugs.forEach((d) => {
  const bc = d.formulations.reduce((s, f) => s + f.indian_brands.length, 0);
  console.log(
    "  " +
      d.generic_name +
      ": " +
      d.formulations.length +
      " formulations, " +
      bc +
      " brands",
  );
});

// Add to formulary
const formulary = JSON.parse(fs.readFileSync(FORMULARY, "utf8"));
const existingNames = new Set(
  formulary.map((d) => d.generic_name.toUpperCase()),
);
let added = 0,
  skipped = 0;
for (const drug of newDrugs) {
  if (existingNames.has(drug.generic_name.toUpperCase())) {
    skipped++;
    continue;
  }
  formulary.push(drug);
  added++;
}
fs.writeFileSync(FORMULARY, JSON.stringify(formulary, null, 2));
console.log(
  "\nAdded:",
  added,
  "| Skipped (exists):",
  skipped,
  "| Total now:",
  formulary.length,
);
