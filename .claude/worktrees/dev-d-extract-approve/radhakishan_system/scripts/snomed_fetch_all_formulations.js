#!/usr/bin/env node
/**
 * Fetch ALL formulations from SNOMED for every drug that has a substance code.
 * Uses the ingredient reverse index: substance → all Clinical Drugs → all branded children.
 * Adds missing formulations to existing drugs without removing existing ones.
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
const DATA_DIR = path.join(__dirname, "..", "data");

console.log("Loading SNOMED...");
console.time("Load");

const fsnMap = new Map();
const prefMap = new Map();
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
    if (c[6] === "900000000000003001") fsnMap.set(c[4], c[7]);
    if (c[6] === "900000000000013009") prefMap.set(c[4], c[7]);
  }
}

const relMap = new Map();
const isaChildren = new Map();
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
  if (c[7] === "116680003") {
    if (!isaChildren.has(c[5])) isaChildren.set(c[5], []);
    isaChildren.get(c[5]).push(c[4]);
  }
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

// Build ingredient reverse index: substance → Clinical Drug concepts
const ingredientToCDs = new Map();
for (const [cdCid, fsn] of fsnMap) {
  if (!fsn.includes("(clinical drug)") || fsn.includes("real")) continue;
  const rels = relMap.get(cdCid) || [];
  for (const r of rels) {
    if (r.typeId === "762949000" || r.typeId === "127489000") {
      if (!ingredientToCDs.has(r.destId))
        ingredientToCDs.set(r.destId, new Set());
      ingredientToCDs.get(r.destId).add(cdCid);
    }
  }
}

console.timeEnd("Load");
console.log("Ingredient→CD index:", ingredientToCDs.size, "substances");

function getName(cid) {
  return (
    prefMap.get(cid) || (fsnMap.get(cid) || cid).replace(/\s*\([^)]+\)\s*$/, "")
  );
}

function extractBrandedDrug(cid) {
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
  const uopRel = g0.find((r) => r.typeId === "763032000");
  const tradeRel = g0.find((r) => r.typeId === "774158006");
  const ingredients = [];
  for (const [gNum, gRels] of Object.entries(groups)) {
    if (gNum === "0") continue;
    const ingRel = gRels.find(
      (r) => r.typeId === "762949000" || r.typeId === "127489000",
    );
    if (!ingRel) continue;
    const bossRel = gRels.find((r) => r.typeId === "732943007");
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
    if (bossRel) {
      ing.basis_of_strength = getName(bossRel.destId);
      ing.basis_of_strength_code = bossRel.destId;
    }
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
    uop: uopRel ? getName(uopRel.destId) : null,
    uopCode: uopRel ? uopRel.destId : null,
    tradeName: tradeRel ? getName(tradeRel.destId) : null,
    tradeNameCode: tradeRel ? tradeRel.destId : null,
    ingredients,
    displayName: getName(cid),
    brandName: (fsnMap.get(cid) || "").split("(")[0].trim(),
  };
}

function inferRoute(form) {
  const fl = (form || "").toLowerCase();
  if (
    /oral|tablet|capsule|syrup|suspension|powder for oral|dispersible/.test(fl)
  )
    return "PO";
  if (/injection|infusion|lyophili/.test(fl)) return "IV/IM";
  if (/eye drop|ophthalmic/.test(fl)) return "Ophthalmic";
  if (/ear drop|otic/.test(fl)) return "Otic";
  if (/nasal/.test(fl)) return "Nasal";
  if (/cream|ointment|gel|cutaneous|lotion/.test(fl)) return "Topical";
  if (/suppository|rectal/.test(fl)) return "Rectal";
  if (/inhalation|nebuli/.test(fl)) return "Inhaled";
  if (/spray/.test(fl)) return "Spray";
  return "PO";
}

// Build formulations from a Clinical Drug concept's branded children
function buildFormulations(genericCDCid) {
  const children = (isaChildren.get(genericCDCid) || []).filter((cid) =>
    (fsnMap.get(cid) || "").includes("(real clinical drug)"),
  );
  if (!children.length) return null;

  const formMap = new Map();
  for (const cid of children) {
    const bd = extractBrandedDrug(cid);
    const ingKey = bd.ingredients
      .map(
        (i) => i.name + ":" + i.strength_numerator + i.strength_numerator_unit,
      )
      .sort()
      .join("|");
    const key = (bd.form || "unknown") + "::" + ingKey;

    if (!formMap.has(key)) {
      formMap.set(key, {
        form: bd.form,
        form_snomed_code: bd.formCode,
        route: inferRoute(bd.form),
        unit_of_presentation: bd.uop,
        unit_of_presentation_code: bd.uopCode,
        generic_clinical_drug_code: genericCDCid,
        generic_clinical_drug_name: getName(genericCDCid),
        ingredients: bd.ingredients,
        indian_brands: [],
        indian_conc_note: bd.ingredients
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
          .trim(),
        display_name: bd.displayName,
      });
    }
    formMap.get(key).indian_brands.push({
      name: bd.brandName,
      manufacturer: bd.supplier,
      snomed_code: cid,
      verified_on: "SNOMED CT India Extension March 2026",
      trade_name: bd.tradeName,
      trade_name_code: bd.tradeNameCode,
    });
  }
  return [...formMap.values()];
}

// ===== MAIN =====
console.log("\nProcessing formulary files...");

let totalNewForms = 0,
  totalNewBrands = 0,
  drugsEnriched = 0;

for (const file of [
  "formulary_data_ABDM_FHIR.json",
  "formulary_data_ABDM_FHIR_generics.json",
]) {
  const fp = path.join(DATA_DIR, file);
  const drugs = JSON.parse(fs.readFileSync(fp, "utf8"));
  let fileNewForms = 0;

  for (const drug of drugs) {
    if (!drug.snomed_code) continue;

    // Find ALL Clinical Drug concepts that have this substance as ingredient
    const allCDs = ingredientToCDs.get(drug.snomed_code) || new Set();
    if (!allCDs.size) continue;

    // Build formulations from each Clinical Drug
    let newFormulations = [];
    for (const cdCid of allCDs) {
      const forms = buildFormulations(cdCid);
      if (forms) newFormulations = newFormulations.concat(forms);
    }
    if (!newFormulations.length) continue;

    // Build a key for existing formulations to avoid duplicates
    const existingKeys = new Set();
    for (const f of drug.formulations || []) {
      const ing = (f.ingredients || [])[0];
      if (ing) {
        existingKeys.add(
          (f.form || "").toLowerCase() +
            "::" +
            ing.strength_numerator +
            "::" +
            ing.strength_numerator_unit,
        );
      }
    }

    // Add only truly new formulations
    let added = 0;
    for (const nf of newFormulations) {
      const ing = (nf.ingredients || [])[0];
      if (!ing) continue;
      const key =
        (nf.form || "").toLowerCase() +
        "::" +
        ing.strength_numerator +
        "::" +
        ing.strength_numerator_unit;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      drug.formulations.push(nf);
      added++;
      totalNewBrands += (nf.indian_brands || []).length;
    }

    if (added) {
      fileNewForms += added;
      drugsEnriched++;
    }
  }

  fs.writeFileSync(fp, JSON.stringify(drugs, null, 2));
  console.log(file + ": " + fileNewForms + " new formulations added");
  totalNewForms += fileNewForms;
}

console.log("\n=== RESULTS ===");
console.log("Drugs enriched:", drugsEnriched);
console.log("New formulations added:", totalNewForms);
console.log("New brand entries:", totalNewBrands);

// Verify
const b = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"), "utf8"),
);
const g = JSON.parse(
  fs.readFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_generics.json"),
    "utf8",
  ),
);
const totalForms = [...b, ...g].reduce(
  (s, d) => s + (d.formulations || []).length,
  0,
);
const totalBrands = [...b, ...g].reduce(
  (s, d) =>
    s +
    (d.formulations || []).reduce(
      (s2, f) => s2 + (f.indian_brands || []).length,
      0,
    ),
  0,
);
console.log("Total formulations now:", totalForms);
console.log("Total Indian brands now:", totalBrands);

// Show Amoxicillin as proof
const amox = b.find((d) => d.generic_name === "Amoxicillin");
if (amox) {
  console.log("\nAmoxicillin formulations: " + amox.formulations.length);
  amox.formulations.forEach((f) => {
    const ing = f.ingredients[0];
    console.log(
      "  " +
        f.form +
        " | " +
        (ing
          ? ing.strength_numerator +
            " " +
            ing.strength_numerator_unit +
            " / " +
            ing.strength_denominator +
            " " +
            ing.strength_denominator_unit
          : "?") +
        " | " +
        (f.indian_brands || []).length +
        " brands",
    );
  });
}
