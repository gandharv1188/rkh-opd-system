#!/usr/bin/env node
/**
 * Full SNOMED Extraction — For each generic in our formulary:
 * 1. Find ALL branded children (Real Clinical Drugs)
 * 2. For each branded drug: extract SNOMED code, brand name, manufacturer,
 *    dose form, ingredients with strengths
 * 3. Populate formulations[] with complete ABDM-aligned ingredient arrays
 * 4. Replace existing formulations with SNOMED-sourced data
 */

const fs = require("fs");
const path = require("path");

const BASE = path.join(
  "E:",
  "AI-Enabled HMIS",
  "SNOMED",
  "SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z",
  "SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z",
  "Snapshot",
  "Terminology",
);

const DATA_DIR = path.join(
  "E:",
  "AI-Enabled HMIS",
  "radhakishan_hospital_prescription_system_2026",
  "radhakishan_system",
  "data",
);

const UNIT_MAP = {
  258684004: "mg",
  258685003: "mL",
  732936001: "tablet",
  258682000: "g",
  258686002: "mcg",
  258774008: "mL",
  258773002: "mL",
  732981002: "actuation",
  767525000: "unit",
  259022006: "mL",
  258997004: "IU",
  258683005: "kg",
  258770004: "L",
  258718000: "mL",
  258672001: "mg",
  258718000: "mL",
  408102007: "dose",
  258798001: "mcg",
  258838006: "nL",
  733020007: "vial",
};

// Known dose form codes → readable names
const FORM_MAP = {
  385055001: "Tablet",
  385049006: "Capsule",
  385024007: "Oral suspension",
  385023001: "Oral drops",
  385219001: "Injection",
  421026006: "Oral tablet",
  385018001: "Oral solution",
  385023001: "Oral drops",
  385025008: "Powder for oral suspension",
  385057009: "Film-coated tablet",
  385060002: "Dispersible tablet",
  385229008: "Injection solution",
  385049006: "Capsule",
  385101003: "Ointment",
  385099005: "Cream",
  385220007: "Solution for injection",
  421720008: "Spray",
  385210002: "Inhalation solution",
  421637006: "Lyophilised powder for injection",
  385087003: "Eye drops",
  385115002: "Ear drops",
  385136004: "Suppository",
  385048003: "Syrup",
  385043007: "Oral powder",
  385117005: "Nasal drops",
  385114003: "Eye ointment",
  385174007: "Gel",
  385197005: "Nebuliser solution",
  385108003: "Cutaneous cream",
};

console.log("Loading SNOMED CT India Drug Extension...");
console.time("Load");

// Load descriptions
const descLines = fs
  .readFileSync(
    path.join(
      BASE,
      "sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");

const descMap = new Map();
const brandedFSNs = new Map(); // conceptId → FSN term (for Real Clinical Drugs only)

for (let i = 1; i < descLines.length; i++) {
  const cols = descLines[i].split("\t");
  if (cols.length < 9 || cols[2] !== "1") continue;
  const cid = cols[4],
    tid = cols[6],
    term = cols[7];
  if (!descMap.has(cid)) descMap.set(cid, []);
  descMap.get(cid).push({ typeId: tid, term });
  if (tid === "900000000000003001" && term.includes("(real clinical drug)")) {
    brandedFSNs.set(cid, term);
  }
}

// Load relationships
const relLines = fs
  .readFileSync(
    path.join(
      BASE,
      "sct2_Relationship_Snapshot_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");

const isaChildren = new Map(); // parent → [children]
const relMap = new Map(); // src → [{destId, typeId, group}]

for (let i = 1; i < relLines.length; i++) {
  const cols = relLines[i].split("\t");
  if (cols.length < 10 || cols[2] !== "1") continue;
  const src = cols[4],
    dest = cols[5],
    grp = cols[6],
    tid = cols[7];

  if (tid === "116680003") {
    // IS-A
    if (!isaChildren.has(dest)) isaChildren.set(dest, []);
    isaChildren.get(dest).push(src);
  }

  if (!relMap.has(src)) relMap.set(src, []);
  relMap.get(src).push({ destId: dest, typeId: tid, group: grp });
}

// Load concrete values
const cvLines = fs
  .readFileSync(
    path.join(
      BASE,
      "sct2_RelationshipConcreteValues_Snapshot_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");

const cvMap = new Map();
for (let i = 1; i < cvLines.length; i++) {
  const cols = cvLines[i].split("\t");
  if (cols.length < 10 || cols[2] !== "1") continue;
  if (!cvMap.has(cols[4])) cvMap.set(cols[4], []);
  cvMap.get(cols[4]).push({
    value: cols[5].replace(/^#/, ""),
    typeId: cols[7],
    group: cols[6],
  });
}

console.timeEnd("Load");
console.log("Concepts:", descMap.size, "| Branded FSNs:", brandedFSNs.size);
console.log(
  "IS-A parents:",
  isaChildren.size,
  "| Rels:",
  relMap.size,
  "| CVs:",
  cvMap.size,
);

function getName(cid) {
  const d = descMap.get(cid);
  if (!d) return String(cid);
  return (
    (d.find((x) => x.typeId === "900000000000013009") || d[0])?.term ||
    String(cid)
  );
}

function getUnit(cid) {
  return UNIT_MAP[cid] || getName(cid);
}
function getForm(cid) {
  return FORM_MAP[cid] || getName(cid);
}

// Extract complete drug info from a branded concept
function extractBrandedDrug(cid) {
  const rels = relMap.get(cid) || [];
  const cvs = cvMap.get(cid) || [];

  // Group by relationship group
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
  const tradeNameRel = g0.find((r) => r.typeId === "774158006");

  // Parse FSN for brand name
  const fsn = brandedFSNs.get(cid) || "";
  const brandName = fsn.split("(")[0].trim();

  // Extract ingredients
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
      ing.strength_numerator_unit = pnu ? getUnit(pnu.destId) : "mg";
      ing.strength_denominator = pdv ? parseFloat(pdv.value) : 1;
      ing.strength_denominator_unit = pdu ? getUnit(pdu.destId) : "unit";
    } else if (cnv) {
      ing.strength_numerator = parseFloat(cnv.value);
      ing.strength_numerator_unit = cnu ? getUnit(cnu.destId) : "mg";
      ing.strength_denominator = cdv ? parseFloat(cdv.value) : 1;
      ing.strength_denominator_unit = cdu ? getUnit(cdu.destId) : "mL";
    }
    ingredients.push(ing);
  }

  return {
    snomed_code: cid,
    brand_name: brandName,
    manufacturer: supplierRel ? getName(supplierRel.destId) : null,
    dose_form: doseFormRel ? getForm(doseFormRel.destId) : null,
    dose_form_code: doseFormRel ? doseFormRel.destId : null,
    trade_name: tradeNameRel ? getName(tradeNameRel.destId) : null,
    ingredients,
    display_name: getName(cid),
  };
}

// ===== MAIN =====
console.log("\nExtracting all branded drugs for 625 generics...");

const formulary = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"), "utf8"),
);

let totalBrands = 0,
  totalFormulations = 0,
  drugsEnriched = 0;

for (let di = 0; di < formulary.length; di++) {
  const drug = formulary[di];
  if (!drug.snomed_code) continue;

  // Find all branded children
  const children = isaChildren.get(drug.snomed_code) || [];
  const brandedChildren = children.filter((cid) => brandedFSNs.has(cid));

  if (!brandedChildren.length) continue;
  drugsEnriched++;

  // Extract info from each branded drug
  const brandedDrugs = brandedChildren.map((cid) => extractBrandedDrug(cid));

  // Group by dose form + strength combination to create unique formulations
  const formMap = new Map(); // key → {form, ingredients, brands[]}
  for (const bd of brandedDrugs) {
    // Key: dose form + ingredients signature
    const ingKey = bd.ingredients
      .map(
        (i) => i.name + ":" + i.strength_numerator + i.strength_numerator_unit,
      )
      .sort()
      .join("|");
    const key = (bd.dose_form || "unknown") + "::" + ingKey;

    if (!formMap.has(key)) {
      formMap.set(key, {
        form: bd.dose_form,
        form_snomed_code: bd.dose_form_code,
        route: null, // Will need to be inferred
        ingredients: bd.ingredients,
        indian_brands: [],
        display_name: bd.display_name,
      });
    }

    // Add brand
    formMap.get(key).indian_brands.push({
      name: bd.brand_name,
      manufacturer: bd.manufacturer,
      snomed_code: bd.snomed_code,
      verified_on: "SNOMED CT India Extension March 2026",
    });
    totalBrands++;
  }

  // Convert to array and replace formulations
  const newFormulations = [...formMap.values()];

  // Infer route from dose form
  for (const f of newFormulations) {
    const fl = (f.form || "").toLowerCase();
    if (
      fl.includes("oral") ||
      fl.includes("tablet") ||
      fl.includes("capsule") ||
      fl.includes("syrup") ||
      fl.includes("suspension") ||
      fl.includes("powder for oral")
    )
      f.route = "PO";
    else if (
      fl.includes("injection") ||
      fl.includes("solution for infusion") ||
      fl.includes("lyophilised")
    )
      f.route = "IV/IM";
    else if (fl.includes("eye drop") || fl.includes("ophthalmic"))
      f.route = "Ophthalmic";
    else if (fl.includes("ear drop") || fl.includes("otic")) f.route = "Otic";
    else if (fl.includes("nasal")) f.route = "Nasal";
    else if (
      fl.includes("cream") ||
      fl.includes("ointment") ||
      fl.includes("gel") ||
      fl.includes("cutaneous")
    )
      f.route = "Topical";
    else if (fl.includes("suppository") || fl.includes("rectal"))
      f.route = "Rectal";
    else if (fl.includes("inhalation") || fl.includes("nebuli"))
      f.route = "Inhaled";
    else if (fl.includes("spray")) f.route = "Spray";
    else f.route = "PO";

    // Add indian_conc_note from ingredients
    if (f.ingredients.length) {
      f.indian_conc_note = f.ingredients
        .map(
          (i) =>
            i.name +
            " " +
            (i.strength_numerator || "?") +
            " " +
            (i.strength_numerator_unit || "") +
            "/" +
            (i.strength_denominator || 1) +
            " " +
            (i.strength_denominator_unit || ""),
        )
        .join(" + ")
        .trim();
    }
  }

  // Only replace if SNOMED gave us formulations
  if (newFormulations.length) {
    // Keep old formulations that have dosing_bands or other data we want to preserve
    // But use SNOMED formulations as the primary source
    drug.formulations = newFormulations;
    totalFormulations += newFormulations.length;
  }

  if (di % 50 === 0) {
    process.stdout.write(
      "  " +
        di +
        "/" +
        formulary.length +
        " (" +
        totalBrands +
        " brands, " +
        totalFormulations +
        " formulations)\r",
    );
  }
}

console.log("\n\n=== RESULTS ===");
console.log("Drugs enriched:", drugsEnriched, "/", formulary.length);
console.log("Total branded drugs extracted:", totalBrands);
console.log("Unique formulations created:", totalFormulations);
console.log(
  "Average brands per drug:",
  drugsEnriched ? (totalBrands / drugsEnriched).toFixed(1) : 0,
);
console.log(
  "Average formulations per drug:",
  drugsEnriched ? (totalFormulations / drugsEnriched).toFixed(1) : 0,
);

// Stats on drugs NOT enriched
const notEnriched = formulary.filter(
  (d) =>
    d.snomed_code &&
    !(isaChildren.get(d.snomed_code) || []).some((c) => brandedFSNs.has(c)),
);
console.log("Drugs with SNOMED but no branded children:", notEnriched.length);

// Save
fs.writeFileSync(
  path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"),
  JSON.stringify(formulary, null, 2),
);
const size = (
  fs.statSync(path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json")).size /
  1024 /
  1024
).toFixed(1);
console.log("\nFormulary saved:", size, "MB");
