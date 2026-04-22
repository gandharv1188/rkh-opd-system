#!/usr/bin/env node
/**
 * SNOMED Re-extraction v2 — Correct unit extraction + combo filtering
 *
 * Fixes:
 * 1. Uses CONCENTRATION strength (CONC_NUM/DEN) for units — these are correct in SNOMED India
 * 2. Falls back to PRESENTATION strength (PRES_NUM/DEN) for VALUES only
 * 3. Uses UNIT_OF_PRESENTATION for denominator unit on solids (tablets, capsules)
 * 4. Only adds mono-ingredient formulations to single-ingredient drugs
 * 5. Combo formulations only go to combo drug entries
 *
 * Output: _v2 files for review before replacing real files
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

// Standard unit abbreviations
const UNIT_ABBREV = {
  258684004: "mg",
  258685003: "mcg", // microgram (NOT mL — SNOMED pref term misleading)
  258682000: "g",
  258686002: "mcg", // nanogram? Actually microgram alternate
  258773002: "mL",
  258774008: "mL", // cubic millimeter
  732936001: "tablet",
  258997004: "IU",
  258718000: "mmol",
  767525000: "unit",
  259022006: "mL",
  408102007: "dose",
  258798001: "mcg",
  732981002: "actuation",
  258770004: "L",
  258683005: "kg",
  733020007: "vial",
  385055001: "tablet", // Tablet dose form
  385049006: "capsule", // Capsule dose form
};

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

// Ingredient reverse index
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

function getUnitAbbrev(conceptId) {
  if (UNIT_ABBREV[conceptId]) return UNIT_ABBREV[conceptId];
  const name = prefMap.get(conceptId) || fsnMap.get(conceptId) || conceptId;
  // Normalize common terms
  const nl = name.toLowerCase();
  if (nl === "milligram" || nl === "mg") return "mg";
  if (nl === "millilitre" || nl === "ml" || nl === "milliliter") return "mL";
  if (nl === "microgram" || nl === "mcg" || nl === "ug") return "mcg";
  if (nl === "gram" || nl === "g") return "g";
  if (nl === "tablet") return "tablet";
  if (nl === "capsule") return "capsule";
  if (nl.includes("international unit")) return "IU";
  return name;
}

function getName(cid) {
  return (
    prefMap.get(cid) || (fsnMap.get(cid) || cid).replace(/\s*\([^)]+\)\s*$/, "")
  );
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

/**
 * Extract drug info from a branded concept using CORRECT unit resolution.
 * Priority: CONC strength for units, PRES strength for values (solids),
 * UNIT_OF_PRESENTATION for denominator of solids.
 */
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

  const ingredients = [];
  for (const [gNum, gRels] of Object.entries(groups)) {
    if (gNum === "0") continue;
    const ingRel = gRels.find(
      (r) => r.typeId === "762949000" || r.typeId === "127489000",
    );
    if (!ingRel) continue;

    // Concrete values
    const pnv = gRels.find((r) => r.isConcrete && r.typeId === "1142135004"); // PRES_NUM_VAL
    const pdv = gRels.find((r) => r.isConcrete && r.typeId === "1142136003"); // PRES_DEN_VAL
    const cnv = gRels.find((r) => r.isConcrete && r.typeId === "1142137007"); // CONC_NUM_VAL
    const cdv = gRels.find((r) => r.isConcrete && r.typeId === "1142138002"); // CONC_DEN_VAL

    // Unit relationships
    const pnu = gRels.find((r) => r.typeId === "733722007"); // PRES_NUM_UNIT
    const pdu = gRels.find((r) => r.typeId === "732945000"); // PRES_DEN_UNIT
    const cnu = gRels.find((r) => r.typeId === "733725009"); // CONC_NUM_UNIT
    const cdu = gRels.find((r) => r.typeId === "732947008"); // CONC_DEN_UNIT

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

    // STRATEGY: VALUES from PRES (presentation), UNITS from CONC (concentration)
    // SNOMED India bug: PRES has correct values but swapped unit concepts
    // CONC has wrong values (normalized) but correct unit concepts
    if (pnv) {
      // VALUES always from PRES (these match the product label)
      ing.strength_numerator = parseFloat(pnv.value);
      ing.strength_denominator = pdv ? parseFloat(pdv.value) : 1;

      // NUMERATOR UNIT: prefer CONC_NUM_UNIT (correct), else check PRES
      if (cnu) {
        ing.strength_numerator_unit = getUnitAbbrev(cnu.destId);
      } else if (pnu) {
        const pnuAbbrev = getUnitAbbrev(pnu.destId);
        // PRES_NUM_UNIT is swapped for liquids (says mL when should be mg)
        // Use UNIT_OF_PRESENTATION to detect: if UoP is mL, numerator should be mg
        if (
          pnuAbbrev === "mL" &&
          uopRel &&
          getUnitAbbrev(uopRel.destId) === "mL"
        ) {
          ing.strength_numerator_unit = "mg"; // liquid: numerator is always mass
        } else if (
          pnuAbbrev === "mL" &&
          uopRel &&
          (getUnitAbbrev(uopRel.destId) === "tablet" ||
            getUnitAbbrev(uopRel.destId) === "capsule")
        ) {
          ing.strength_numerator_unit = "mg"; // solid: numerator is mass
        } else {
          ing.strength_numerator_unit = pnuAbbrev;
        }
      } else {
        ing.strength_numerator_unit = "mg";
      }

      // DENOMINATOR UNIT: prefer CONC_DEN_UNIT (correct), else UNIT_OF_PRESENTATION
      if (cdu) {
        ing.strength_denominator_unit = getUnitAbbrev(cdu.destId);
      } else if (uopRel) {
        ing.strength_denominator_unit = getUnitAbbrev(uopRel.destId);
      } else if (pdu) {
        // PRES_DEN_UNIT is swapped (says mg when should be mL for liquids)
        const pduAbbrev = getUnitAbbrev(pdu.destId);
        if (
          pduAbbrev === "mg" &&
          uopRel &&
          getUnitAbbrev(uopRel.destId) === "mL"
        ) {
          ing.strength_denominator_unit = "mL";
        } else {
          ing.strength_denominator_unit = pduAbbrev;
        }
      } else {
        ing.strength_denominator_unit = "unit";
      }
    }

    ingredients.push(ing);
  }

  return {
    form: doseFormRel ? getName(doseFormRel.destId) : null,
    formCode: doseFormRel ? doseFormRel.destId : null,
    supplier: supplierRel ? getName(supplierRel.destId) : null,
    uop: uopRel ? getUnitAbbrev(uopRel.destId) : null,
    uopCode: uopRel ? uopRel.destId : null,
    ingredients,
    displayName: getName(cid),
    brandName: (fsnMap.get(cid) || "").split("(")[0].trim(),
    ingredientCount: ingredients.length,
  };
}

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
        unit_of_presentation: bd.uop || null,
        unit_of_presentation_code: bd.uopCode || null,
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
        _ingredientCount: bd.ingredientCount,
      });
    }
    // Fill UoP from this brand if the formulation group doesn't have one yet
    const entry = formMap.get(key);
    if (!entry.unit_of_presentation && bd.uop) {
      entry.unit_of_presentation = bd.uop;
      entry.unit_of_presentation_code = bd.uopCode;
    }
    entry.indian_brands.push({
      name: bd.brandName,
      manufacturer: bd.supplier,
      snomed_code: cid,
      verified_on: "SNOMED CT India Extension March 2026",
    });
  }
  return [...formMap.values()];
}

// ===== MAIN =====
console.log("\nRe-extracting formulations...");

// Process branded + generics files
for (const file of [
  "formulary_data_ABDM_FHIR.json",
  "formulary_data_ABDM_FHIR_generics.json",
]) {
  const fp = path.join(DATA_DIR, file);
  const drugs = JSON.parse(fs.readFileSync(fp, "utf8"));
  let totalNewForms = 0,
    removedCombos = 0,
    keptOld = 0;

  for (const drug of drugs) {
    if (!drug.snomed_code) continue;

    // Is this a combo drug? (has + in name or multiple substance codes)
    const isCombo =
      drug.generic_name.includes("+") || drug.generic_name.includes(" and ");

    // Find ALL Clinical Drug concepts containing this substance
    const allCDs = ingredientToCDs.get(drug.snomed_code) || new Set();
    if (!allCDs.size) continue;

    // Build fresh formulations from SNOMED with correct units
    let newFormulations = [];
    for (const cdCid of allCDs) {
      const forms = buildFormulations(cdCid);
      if (forms) newFormulations = newFormulations.concat(forms);
    }
    if (!newFormulations.length) continue;

    // FILTER: For single-ingredient drugs, only keep mono formulations
    if (!isCombo) {
      const before = newFormulations.length;
      newFormulations = newFormulations.filter((f) => f._ingredientCount === 1);
      removedCombos += before - newFormulations.length;
    }

    // Clean up temp field
    newFormulations.forEach((f) => delete f._ingredientCount);

    // De-duplicate by form+strength key
    const seen = new Set();
    const deduped = [];
    for (const f of newFormulations) {
      const ing = (f.ingredients || [])[0];
      if (!ing) continue;
      const key =
        (f.form || "").toLowerCase() +
        "::" +
        ing.strength_numerator +
        "::" +
        ing.strength_numerator_unit +
        "::" +
        ing.strength_denominator +
        "::" +
        ing.strength_denominator_unit;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(f);
    }

    // Keep non-SNOMED formulations (old format from original data) that don't overlap
    const oldNonSnomed = (drug.formulations || []).filter(
      (f) =>
        !(f.indian_brands || []).some(
          (b) => b.verified_on && b.verified_on.includes("SNOMED"),
        ),
    );
    keptOld += oldNonSnomed.length;

    // Replace formulations
    drug.formulations = [...deduped, ...oldNonSnomed];
    totalNewForms += deduped.length;
  }

  // Write to _v2 file
  const outFp = fp.replace(".json", "_v2.json");
  fs.writeFileSync(outFp, JSON.stringify(drugs, null, 2));
  console.log(file + ":");
  console.log("  New SNOMED formulations: " + totalNewForms);
  console.log("  Combos removed from mono drugs: " + removedCombos);
  console.log("  Old non-SNOMED formulations kept: " + keptOld);
}

// Copy orphans unchanged (no SNOMED extraction for them)
fs.copyFileSync(
  path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans.json"),
  path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans_v2.json"),
);
console.log("\nOrphans: copied unchanged");

// ===== CROSS-CHECK =====
console.log("\n=== CROSS-CHECK against known Indian concentrations ===");
const v2 = JSON.parse(
  fs.readFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_v2.json"),
    "utf8",
  ),
);

const KNOWN = {
  Paracetamol: [
    {
      form: /suspension|syrup/,
      strengths: [120, 125, 250],
      per: 5,
      unit: "mg",
      perUnit: "mL",
    },
    {
      form: /tablet|dispersible/,
      strengths: [125, 170, 250, 325, 500, 650],
      per: 1,
      unit: "mg",
      perUnit: "tablet",
    },
    {
      form: /suppository/,
      strengths: [125, 170, 250],
      per: 1,
      unit: "mg",
      perUnit: "tablet",
    }, // suppository stored as tablet in SNOMED
    {
      form: /injection|infusion/,
      strengths: [150, 300, 1000, 1],
      per: [1, 2, 100],
      unit: "mg",
      perUnit: "mL",
    },
  ],
  Amoxicillin: [
    {
      form: /suspension|syrup/,
      strengths: [125, 200, 250, 400],
      per: 5,
      unit: "mg",
      perUnit: "mL",
    },
    {
      form: /tablet|dispersible/,
      strengths: [125, 200, 250, 500],
      per: 1,
      unit: "mg",
      perUnit: "tablet",
    },
    {
      form: /capsule/,
      strengths: [250, 500],
      per: 1,
      unit: "mg",
      perUnit: "capsule",
    },
  ],
  Ibuprofen: [
    {
      form: /suspension|syrup/,
      strengths: [100, 200],
      per: 5,
      unit: "mg",
      perUnit: "mL",
    },
    {
      form: /tablet/,
      strengths: [200, 400, 600],
      per: 1,
      unit: "mg",
      perUnit: "tablet",
    },
  ],
  Azithromycin: [
    {
      form: /suspension|syrup/,
      strengths: [100, 200],
      per: 5,
      unit: "mg",
      perUnit: "mL",
    },
    {
      form: /tablet/,
      strengths: [250, 500],
      per: 1,
      unit: "mg",
      perUnit: "tablet",
    },
  ],
  Cetirizine: [
    {
      form: /syrup|suspension/,
      strengths: [5],
      per: 5,
      unit: "mg",
      perUnit: "mL",
    },
    {
      form: /tablet/,
      strengths: [5, 10],
      per: 1,
      unit: "mg",
      perUnit: "tablet",
    },
  ],
};

let correct = 0,
  wrong = 0;
for (const [drugName, expected] of Object.entries(KNOWN)) {
  const drug = v2.find((d) => d.generic_name === drugName);
  if (!drug) {
    console.log("NOT FOUND: " + drugName);
    continue;
  }

  // Check mono formulations only
  const monoForms = drug.formulations.filter(
    (f) => (f.ingredients || []).length === 1,
  );
  console.log("\n" + drugName + ": " + monoForms.length + " mono formulations");

  for (const f of monoForms) {
    const ing = f.ingredients[0];
    const matchesExpected = expected.some((exp) => {
      if (!exp.form.test((f.form || "").toLowerCase())) return false;
      const strengthOk = exp.strengths.includes(ing.strength_numerator);
      const unitOk = ing.strength_numerator_unit === exp.unit;
      return strengthOk && unitOk;
    });

    const tag = matchesExpected ? "✅" : "❌";
    if (matchesExpected) correct++;
    else wrong++;
    console.log(
      "  " +
        tag +
        " " +
        f.form +
        ": " +
        ing.strength_numerator +
        " " +
        ing.strength_numerator_unit +
        " / " +
        ing.strength_denominator +
        " " +
        ing.strength_denominator_unit,
    );
  }
}
console.log("\nCross-check: " + correct + " correct, " + wrong + " wrong");

// Overall stats
const allV2 = [
  ...v2,
  ...JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, "formulary_data_ABDM_FHIR_generics_v2.json"),
      "utf8",
    ),
  ),
  ...JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans_v2.json"),
      "utf8",
    ),
  ),
];
const totalDrugs = allV2.length;
const totalForms = allV2.reduce((s, d) => s + (d.formulations || []).length, 0);
const totalBrands = allV2.reduce(
  (s, d) =>
    s +
    (d.formulations || []).reduce(
      (s2, f) => s2 + (f.indian_brands || []).length,
      0,
    ),
  0,
);
const totalBands = allV2.reduce((s, d) => s + (d.dosing_bands || []).length, 0);
console.log("\n=== V2 STATS ===");
console.log("Drugs: " + totalDrugs);
console.log("Formulations: " + totalForms);
console.log("Indian brands: " + totalBrands);
console.log("Dosing bands: " + totalBands + " (should be 940)");
