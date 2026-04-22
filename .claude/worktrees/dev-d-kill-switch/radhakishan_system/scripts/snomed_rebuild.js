#!/usr/bin/env node
/**
 * SNOMED Rebuild — Complete formulary rebuild from original data.
 *
 * Input:  formulary_working.json (652 drugs from f1+f2)
 * Output: formulary_data_ABDM_FHIR.json        (branded — has SNOMED code + branded children)
 *         formulary_data_ABDM_FHIR_generics.json (generic — has SNOMED code but no brands in India ext)
 *         formulary_data_ABDM_FHIR_orphans.json  (orphan — no SNOMED code found)
 *
 * Strategy:
 *   Phase 1: Load all SNOMED data
 *   Phase 2: For 113 drugs with existing substance codes — validate & keep
 *   Phase 3: For 539 drugs without codes — match brand names in SNOMED branded FSNs
 *            Brand match → IS-A parent → generic Clinical Drug → substance code
 *   Phase 4: For still-unmatched — try exact generic name match against SNOMED substance concepts
 *   Phase 5: Extract full formulation data for all matched drugs
 *   Phase 6: Classify into branded / generic / orphan
 *   Phase 7: Add IV fluids, emergency drugs, electrolytes, Wikoryl, Neogadine
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

// ===================== PHASE 1: LOAD SNOMED =====================
console.log("=== PHASE 1: Loading SNOMED data ===");
console.time("Load");

// Load all descriptions (FSN + preferred terms)
const fsnMap = new Map(); // conceptId → FSN
const prefMap = new Map(); // conceptId → preferred term
const allDescs = new Map(); // conceptId → [{typeId, term}]

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
    const cid = c[4],
      tid = c[6],
      term = c[7];
    if (!allDescs.has(cid)) allDescs.set(cid, []);
    allDescs.get(cid).push({ typeId: tid, term });
    if (tid === "900000000000003001") fsnMap.set(cid, term);
    if (tid === "900000000000013009") prefMap.set(cid, term);
  }
}

// Load IS-A relationships
const isaChildren = new Map(); // parent → [children]
const isaParents = new Map(); // child → [parents]
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
  if (c.length < 10 || c[2] !== "1" || c[7] !== "116680003") continue;
  const child = c[4],
    parent = c[5];
  if (!isaChildren.has(parent)) isaChildren.set(parent, []);
  isaChildren.get(parent).push(child);
  if (!isaParents.has(child)) isaParents.set(child, []);
  isaParents.get(child).push(parent);
}

// Load relationships + concrete values (for extracting drug details)
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

// Build indexes
// Index 1: Brand name first word → [{conceptId, fsn, brandName}] for Real Clinical Drugs
const brandIndex = new Map();
let totalBranded = 0;
for (const [cid, fsn] of fsnMap) {
  if (!fsn.includes("(real clinical drug)")) continue;
  totalBranded++;
  const firstParen = fsn.indexOf("(");
  if (firstParen < 1) continue;
  const brandName = fsn.substring(0, firstParen).trim();
  const firstWord = brandName.split(/\s+/)[0].toLowerCase();
  if (firstWord.length < 2) continue;
  if (!brandIndex.has(firstWord)) brandIndex.set(firstWord, []);
  brandIndex.get(firstWord).push({ conceptId: cid, fsn, brandName });
}

// Index 2: Substance concepts — name → conceptId
const substanceIndex = new Map(); // lowercase name → conceptId
for (const [cid, fsn] of fsnMap) {
  if (!fsn.endsWith("(substance)")) continue;
  const name = fsn.replace(/\s*\(substance\)\s*$/, "").toLowerCase();
  substanceIndex.set(name, cid);
}

// Index 3: Clinical Drug concepts (generics)
const clinicalDrugFSNs = new Map(); // conceptId → fsn (only clinical drug, not real)
for (const [cid, fsn] of fsnMap) {
  if (fsn.includes("(clinical drug)") && !fsn.includes("real")) {
    clinicalDrugFSNs.set(cid, fsn);
  }
}

console.timeEnd("Load");
console.log("Branded FSNs:", totalBranded);
console.log("Substance concepts:", substanceIndex.size);
console.log("Clinical Drug concepts:", clinicalDrugFSNs.size);
console.log("Brand index keys:", brandIndex.size);

// Index 4: substance/ingredient → Clinical Drug concepts that contain it
// (reverse index of HAS_ACTIVE_INGREDIENT relationships)
const ingredientToCDs = new Map(); // substanceCid → Set of clinicalDrugCids
for (const [cdCid] of clinicalDrugFSNs) {
  const rels = relMap.get(cdCid) || [];
  for (const r of rels) {
    if (r.typeId === "762949000" || r.typeId === "127489000") {
      if (!ingredientToCDs.has(r.destId))
        ingredientToCDs.set(r.destId, new Set());
      ingredientToCDs.get(r.destId).add(cdCid);
    }
  }
}
console.log("Ingredient→CD reverse index:", ingredientToCDs.size, "substances");

// ===================== HELPER FUNCTIONS =====================

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
    displayName: getName(cid),
    brandName: (fsnMap.get(cid) || "").split("(")[0].trim(),
  };
}

function inferRoute(form) {
  const fl = (form || "").toLowerCase();
  if (/oral|tablet|capsule|syrup|suspension|powder for oral/.test(fl))
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

// Search for a brand name in SNOMED branded drugs
function findBrand(brandStr) {
  // Parse "BrandName (Manufacturer)" format
  const match = brandStr.match(/^(.+?)\s*\((.+?)\)$/);
  const brandName = match ? match[1].trim() : brandStr.trim();
  if (brandName.length < 3) return null;

  const firstWord = brandName.split(/\s+/)[0].toLowerCase();
  const candidates = brandIndex.get(firstWord);
  if (!candidates) return null;

  const brandLower = brandName.toLowerCase();
  const mfg = match ? match[2].toLowerCase() : null;

  // Strategy 1: brand + manufacturer match
  if (mfg) {
    for (const c of candidates) {
      if (
        c.brandName.toLowerCase().includes(brandLower) &&
        c.fsn.toLowerCase().includes(mfg.split(/\s+/)[0])
      ) {
        return c;
      }
    }
  }

  // Strategy 2: exact brand name match
  for (const c of candidates) {
    if (
      c.brandName.toLowerCase() === brandLower ||
      c.brandName.toLowerCase().startsWith(brandLower + " ")
    ) {
      return c;
    }
  }

  // Strategy 3: brand name contains
  for (const c of candidates) {
    if (c.brandName.toLowerCase().includes(brandLower)) {
      return c;
    }
  }
  return null;
}

// From a branded concept, find its generic Clinical Drug parent
function findGenericParent(brandedCid) {
  const parents = isaParents.get(brandedCid) || [];
  for (const pid of parents) {
    if (clinicalDrugFSNs.has(pid)) return pid;
  }
  return null;
}

// From a generic Clinical Drug, find its substance via HAS_ACTIVE_INGREDIENT
function findSubstance(clinicalDrugCid) {
  const rels = relMap.get(clinicalDrugCid) || [];
  const ingRel = rels.find(
    (r) => r.typeId === "762949000" || r.typeId === "127489000",
  );
  if (ingRel) {
    const fsn = fsnMap.get(ingRel.destId);
    if (fsn && fsn.includes("(substance)")) return ingRel.destId;
  }
  return null;
}

// Build ABDM FHIR formulations from branded children of a generic Clinical Drug
function buildFormulations(genericCid) {
  const children = (isaChildren.get(genericCid) || []).filter((cid) => {
    const fsn = fsnMap.get(cid);
    return fsn && fsn.includes("(real clinical drug)");
  });
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
        ingredients: bd.ingredients,
        indian_brands: [],
        display_name: bd.displayName,
        indian_conc_note: bd.ingredients
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
          .trim(),
      });
    }
    formMap.get(key).indian_brands.push({
      name: bd.brandName,
      manufacturer: bd.supplier,
      snomed_code: cid,
      verified_on: "SNOMED CT India Extension March 2026",
    });
  }
  return [...formMap.values()];
}

// Convert old-format formulation to ABDM FHIR (for drugs without SNOMED brands)
function convertOldFormulation(f) {
  return {
    form: f.form || null,
    form_snomed_code: null,
    route: f.route || "PO",
    ingredients: [
      {
        name: null,
        snomed_code: null,
        is_active: true,
        is_primary: true,
        strength_numerator: f.conc_qty || null,
        strength_numerator_unit: f.conc_unit || null,
        strength_denominator: f.per_qty || null,
        strength_denominator_unit: f.per_unit || null,
      },
    ],
    indian_brands: f.indian_brand
      ? [
          {
            name: f.indian_brand,
            manufacturer: null,
            snomed_code: null,
            verified_on: "Original formulary data",
          },
        ]
      : [],
    indian_conc_note: f.conc_qty
      ? f.conc_qty +
        " " +
        (f.conc_unit || "") +
        " / " +
        (f.per_qty || 1) +
        " " +
        (f.per_unit || "")
      : null,
    display_name: null,
  };
}

// Build ABDM drug entry
function buildEntry(drug, snomedCode, snomedName, formulations, dataSource) {
  return {
    generic_name: drug.generic_name,
    snomed_code: snomedCode || null,
    snomed_display: snomedName || null,
    drug_class: drug.drug_class || null,
    category: drug.category || null,
    therapeutic_use: drug.therapeutic_use || [],
    brand_names: drug.brand_names || [],
    licensed_in_children:
      drug.licensed_in_children != null ? drug.licensed_in_children : true,
    unlicensed_note: drug.unlicensed_note || "",
    formulations:
      formulations || (drug.formulations || []).map(convertOldFormulation),
    dosing_bands: [], // intentionally empty — old units were wrong
    renal_adjustment_required: drug.renal_adjustment_required || false,
    renal_bands: drug.renal_bands || [],
    hepatic_adjustment_required: drug.hepatic_adjustment_required || false,
    hepatic_note: drug.hepatic_note || null,
    contraindications: drug.contraindications || [],
    cross_reactions: drug.cross_reactions || [],
    interactions: drug.interactions || [],
    black_box_warnings: drug.black_box_warnings || [],
    pediatric_specific_warnings: drug.pediatric_specific_warnings || [],
    monitoring_parameters: drug.monitoring_parameters || [],
    administration: drug.administration || [],
    food_instructions: drug.food_instructions || null,
    storage_instructions: drug.storage_instructions || null,
    pregnancy_category: drug.pregnancy_category || null,
    lactation_safe: drug.lactation_safe || null,
    lactation_note: drug.lactation_note || null,
    reference_source: drug.reference_source || [],
    last_reviewed_date: drug.last_reviewed_date || null,
    active: drug.active != null ? drug.active : true,
  };
}

// ===================== PHASE 2: VALIDATE EXISTING CODES =====================
console.log("\n=== PHASE 2: Validate 113 existing substance codes ===");
const working = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "formulary_working.json"), "utf8"),
);
console.log("Working drugs:", working.length);

let existingValid = 0,
  existingInvalid = 0;
for (const drug of working) {
  if (!drug.snomed_code) continue;
  const fsn = fsnMap.get(drug.snomed_code);
  if (fsn && fsn.includes("(substance)")) {
    existingValid++;
  } else {
    // Not a substance code — clear it
    console.log(
      "  Invalid code cleared: " +
        drug.generic_name +
        " => " +
        (fsn || "not found"),
    );
    drug.snomed_code = null;
    existingInvalid++;
  }
}
console.log("Valid substance codes:", existingValid);
console.log("Invalid (cleared):", existingInvalid);

// ===================== PHASE 3: BRAND NAME MATCHING =====================
console.log(
  "\n=== PHASE 3: Brand name matching for " +
    working.filter((d) => !d.snomed_code).length +
    " drugs ===",
);

let brandMatched = 0,
  brandNotFound = 0;
for (const drug of working) {
  if (drug.snomed_code) continue; // already has valid code

  // Try each brand name
  let found = false;
  for (const brandStr of drug.brand_names || []) {
    const snomedBrand = findBrand(brandStr);
    if (!snomedBrand) continue;

    // Found a brand match — trace up to generic → substance
    const genericCid = findGenericParent(snomedBrand.conceptId);
    if (!genericCid) continue;

    const substanceCid = findSubstance(genericCid);
    // Store the generic clinical drug code (more useful than substance for formulation lookup)
    drug._genericCid = genericCid;
    drug._substanceCid = substanceCid;
    drug._matchedBrand = snomedBrand.brandName;
    drug._matchedBrandCid = snomedBrand.conceptId;
    drug._matchMethod = "brand";
    found = true;
    brandMatched++;
    break;
  }
  if (!found) brandNotFound++;
}
console.log("Matched via brand:", brandMatched);
console.log("Not found via brand:", brandNotFound);

// ===================== PHASE 4: SUBSTANCE NAME MATCHING =====================
console.log(
  "\n=== PHASE 4: Substance name matching for remaining " +
    brandNotFound +
    " drugs ===",
);

let substanceMatched = 0;
for (const drug of working) {
  // Skip drugs that already have a valid substance code
  if (drug.snomed_code) continue;
  // For brand-matched drugs without substance code, still try name matching

  // Try matching generic_name against substance index
  const nameLower = drug.generic_name
    .toLowerCase()
    .replace(/\+/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .trim();

  // Exact match
  let subCid = substanceIndex.get(nameLower);

  // Try first word (single-ingredient drugs)
  if (!subCid) {
    const firstWord = nameLower.split(/\s+/)[0];
    if (firstWord.length >= 4) {
      for (const [name, cid] of substanceIndex) {
        if (name === firstWord || name.startsWith(firstWord + " ")) {
          subCid = cid;
          break;
        }
      }
    }
  }

  if (subCid) {
    drug.snomed_code = subCid;
    drug._matchMethod = "substance_name";
    substanceMatched++;
  }
}
console.log("Matched via substance name:", substanceMatched);

// ===================== PHASE 5: FIND GENERIC CLINICAL DRUG + EXTRACT FORMULATIONS =====================
console.log(
  "\n=== PHASE 5: Find Clinical Drug concepts + extract formulations ===",
);

// For drugs with substance codes but no _genericCid, find Clinical Drug children
// that are generic (not real) clinical drugs
let formulationsExtracted = 0,
  noFormulations = 0;
for (const drug of working) {
  // If we have a genericCid from brand matching, use that
  if (drug._genericCid) {
    const substCid = drug._substanceCid || drug.snomed_code;
    if (substCid && !drug.snomed_code) drug.snomed_code = substCid;

    // Strategy: use _genericCid directly AND find all sibling Clinical Drugs
    // Sibling = shares a branded child's brand family (Real Medicinal Product) parent
    // OR = same substance's Clinical Drug children
    const allGenericCDs = new Set();
    allGenericCDs.add(drug._genericCid);

    // Find sibling generic CDs: from the matched brand, find ALL branded siblings,
    // then collect their generic CD parents
    const matchedBrandCid = drug._matchedBrandCid;
    if (matchedBrandCid) {
      // Get all parents of this brand
      const brandParents = isaParents.get(matchedBrandCid) || [];
      for (const parent of brandParents) {
        const parentFsn = fsnMap.get(parent) || "";
        // If parent is a brand family (real medicinal product), get all its children
        if (parentFsn.includes("(real medicinal product)")) {
          const familyChildren = isaChildren.get(parent) || [];
          for (const sibling of familyChildren) {
            // Each sibling brand → find its generic CD parent
            const sibParents = isaParents.get(sibling) || [];
            for (const sp of sibParents) {
              if (clinicalDrugFSNs.has(sp)) allGenericCDs.add(sp);
            }
          }
        }
        // If parent is a generic CD, add it directly
        if (clinicalDrugFSNs.has(parent)) allGenericCDs.add(parent);
      }
    }

    // Also try substance → Clinical Drug children (works when substance is in India ext)
    if (substCid) {
      const substChildren = isaChildren.get(substCid) || [];
      for (const kid of substChildren) {
        if (clinicalDrugFSNs.has(kid)) allGenericCDs.add(kid);
      }
    }

    // Build formulations from ALL found generic CDs
    let allFormulations = [];
    for (const gcd of allGenericCDs) {
      const forms = buildFormulations(gcd);
      if (forms) allFormulations = allFormulations.concat(forms);
    }

    if (allFormulations.length) {
      drug._snomedFormulations = allFormulations;
      formulationsExtracted++;
    } else {
      noFormulations++;
    }
    continue;
  }

  // For drugs with existing substance codes (from f2)
  if (drug.snomed_code) {
    // Try multiple paths to find Clinical Drug concepts:
    // 1. Direct children of substance (works if substance is in India ext)
    // 2. Search all Clinical Drugs whose ingredient matches this substance
    const allGenericCDs = new Set();

    const substChildren = isaChildren.get(drug.snomed_code) || [];
    for (const kid of substChildren) {
      if (clinicalDrugFSNs.has(kid)) allGenericCDs.add(kid);
    }

    // If no direct children found, use reverse ingredient index
    if (!allGenericCDs.size) {
      const cds = ingredientToCDs.get(drug.snomed_code);
      if (cds) {
        for (const cdCid of cds) {
          allGenericCDs.add(cdCid);
        }
      }
    }

    let allFormulations = [];
    for (const gcd of allGenericCDs) {
      const forms = buildFormulations(gcd);
      if (forms) allFormulations = allFormulations.concat(forms);
    }

    if (allFormulations.length) {
      drug._snomedFormulations = allFormulations;
      formulationsExtracted++;
    } else {
      noFormulations++;
    }
  }
}
console.log("Formulations extracted:", formulationsExtracted);
console.log("No SNOMED formulations:", noFormulations);

// ===================== PHASE 6: CLASSIFY + BUILD OUTPUT =====================
console.log("\n=== PHASE 6: Classify into branded / generic / orphan ===");

const branded = [];
const generics = [];
const orphans = [];

for (const drug of working) {
  const hasCode = !!(drug.snomed_code || drug._substanceCid);
  const hasSnomedForms = !!(
    drug._snomedFormulations && drug._snomedFormulations.length
  );
  const snomedCode = drug.snomed_code || drug._substanceCid || null;

  // Get SNOMED display name for the substance — but KEEP original generic_name
  // Only use SNOMED name as snomed_display, never replace generic_name
  // (multiple drugs may share one substance code, e.g. Azithromycin oral vs ophthalmic)
  let snomedName = null;
  if (snomedCode) {
    const fsn = fsnMap.get(snomedCode);
    if (fsn && fsn.includes("(substance)")) {
      snomedName =
        prefMap.get(snomedCode) || fsn.replace(/\s*\(substance\)\s*$/, "");
    }
  }

  if (hasCode && hasSnomedForms) {
    branded.push(
      buildEntry(drug, snomedCode, snomedName, drug._snomedFormulations),
    );
  } else if (hasCode) {
    generics.push(buildEntry(drug, snomedCode, snomedName, null));
  } else {
    orphans.push(buildEntry(drug, null, null, null));
  }
}

console.log("Branded (SNOMED code + formulations):", branded.length);
console.log("Generic (SNOMED code, no India brands):", generics.length);
console.log("Orphan (no SNOMED code):", orphans.length);

// ===================== PHASE 7: ADD SPECIAL ENTRIES =====================
console.log(
  "\n=== PHASE 7: Adding IV fluids, emergency drugs, electrolytes, Wikoryl, Neogadine ===",
);

// Helper: check if a generic_name already exists in any list
function alreadyExists(name) {
  const upper = name.toUpperCase();
  return (
    branded.some((d) => d.generic_name.toUpperCase() === upper) ||
    generics.some((d) => d.generic_name.toUpperCase() === upper) ||
    orphans.some((d) => d.generic_name.toUpperCase() === upper)
  );
}

// --- IV Fluids (from snomed_iv_fluids_extract logic, inline) ---
const IV_FLUID_SEARCHES = [
  {
    regex: /sodium chloride.*(infusion|injection)/i,
    type: "SODIUM CHLORIDE 0.9% (NORMAL SALINE)",
    noGlucose: true,
  },
  {
    regex: /glucose.*(infusion)/i,
    type: "DEXTROSE INFUSION",
    noSodiumChloride: true,
  },
  {
    regex: /(sodium chloride).*(glucose|dextrose)/i,
    type: "DEXTROSE + SODIUM CHLORIDE (DNS)",
  },
  {
    regex: /potassium chloride.*(infusion|injection)/i,
    type: "POTASSIUM CHLORIDE INJECTION",
  },
  {
    regex: /sodium bicarbonate.*injection/i,
    type: "SODIUM BICARBONATE INJECTION",
  },
  {
    regex: /calcium gluconate.*injection/i,
    type: "CALCIUM GLUCONATE INJECTION",
  },
  {
    regex: /(magnesium sulf|magnesium sulph).*injection/i,
    type: "MAGNESIUM SULPHATE INJECTION",
  },
  { regex: /mannitol.*infusion/i, type: "MANNITOL INFUSION" },
  { regex: /water for injection/i, type: "WATER FOR INJECTION" },
  { regex: /albumin.*(infusion|injection)/i, type: "ALBUMIN HUMAN INFUSION" },
];

// Scan India descriptions for IV fluid clinical drugs
const indiaDescFile = path.join(
  INDIA_BASE,
  "sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt",
);
const indiaDescs = fs.readFileSync(indiaDescFile, "utf8").split("\n");

for (const def of IV_FLUID_SEARCHES) {
  if (alreadyExists(def.type)) continue;
  const matches = [];
  for (let i = 1; i < indiaDescs.length; i++) {
    const c = indiaDescs[i].split("\t");
    if (c.length < 9 || c[2] !== "1" || c[6] !== "900000000000003001") continue;
    if (!c[7].includes("clinical drug)")) continue;
    const tl = c[7].toLowerCase();
    if (
      !tl.includes("infusion") &&
      !tl.includes("injection") &&
      !tl.includes("emulsion for")
    )
      continue;
    if (def.noGlucose && (tl.includes("glucose") || tl.includes("dextrose")))
      continue;
    if (
      def.noSodiumChloride &&
      tl.includes("sodium chloride") &&
      !tl.includes("glucose")
    )
      continue;
    if (def.regex.test(tl)) matches.push({ cid: c[4], fsn: c[7] });
  }
  if (!matches.length) continue;

  const formMap = new Map();
  for (const m of matches) {
    const info = extractBrandedDrug(m.cid);
    const key = info.ingredients
      .map(
        (i) => i.name + ":" + i.strength_numerator + i.strength_numerator_unit,
      )
      .sort()
      .join("|");
    if (!formMap.has(key)) {
      formMap.set(key, {
        form: info.form || "Solution for infusion",
        form_snomed_code: info.formCode,
        route: "IV",
        ingredients: info.ingredients,
        indian_brands: [],
        indian_conc_note: info.ingredients
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
        display_name: getName(m.cid),
      });
    }
    formMap.get(key).indian_brands.push({
      name: m.fsn.split("(")[0].trim(),
      manufacturer: info.supplier,
      snomed_code: m.cid,
      verified_on: "SNOMED CT India Extension March 2026",
    });
  }

  branded.push({
    generic_name: def.type,
    snomed_code: matches[0].cid,
    drug_class: "IV Fluid / Electrolyte",
    category: "Emergency",
    therapeutic_use: [
      "Fluid resuscitation",
      "Electrolyte replacement",
      "IV therapy",
    ],
    brand_names: [
      ...new Set(matches.map((m) => m.fsn.split("(")[0].trim())),
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
    storage_instructions: "Store below 25°C. Do not freeze.",
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["SNOMED CT India Drug Extension March 2026"],
    last_reviewed_date: null,
    active: true,
  });
  console.log(
    "  Added IV fluid: " +
      def.type +
      " (" +
      matches.length +
      " concepts, " +
      formMap.size +
      " formulations)",
  );
}

// --- Emergency Drugs ---
const EMERGENCY_DRUGS = [
  {
    search: /dopamine.*(injection|infusion)/i,
    generic: "DOPAMINE INJECTION",
    drugClass: "Vasopressor / Inotrope",
  },
  {
    search: /dobutamine.*injection/i,
    generic: "DOBUTAMINE INJECTION",
    drugClass: "Inotrope",
  },
  {
    search: /epinephrine.*injection|adrenaline.*injection/i,
    generic: "EPINEPHRINE (ADRENALINE) INJECTION",
    drugClass: "Vasopressor / Sympathomimetic",
  },
  {
    search: /norepinephrine.*injection|noradrenaline.*injection/i,
    generic: "NOREPINEPHRINE (NORADRENALINE) INJECTION",
    drugClass: "Vasopressor",
  },
  {
    search: /milrinone.*injection/i,
    generic: "MILRINONE INJECTION",
    drugClass: "PDE-3 inhibitor / Inodilator",
  },
  {
    search: /phenylephrine.*injection/i,
    generic: "PHENYLEPHRINE INJECTION",
    drugClass: "Alpha-1 agonist / Vasopressor",
  },
  {
    search: /adenosine.*injection/i,
    generic: "ADENOSINE INJECTION",
    drugClass: "Antiarrhythmic",
  },
  {
    search: /amiodarone.*injection/i,
    generic: "AMIODARONE INJECTION",
    drugClass: "Antiarrhythmic (Class III)",
  },
  {
    search: /lidocaine.*injection/i,
    generic: "LIDOCAINE (LIGNOCAINE) INJECTION",
    drugClass: "Local anaesthetic / Antiarrhythmic",
  },
  {
    search: /naloxone.*injection/i,
    generic: "NALOXONE INJECTION",
    drugClass: "Opioid antagonist",
  },
  {
    search: /alprostadil.*injection/i,
    generic: "ALPROSTADIL (PROSTAGLANDIN E1) INJECTION",
    drugClass: "Prostaglandin E1 analogue",
  },
  {
    search: /sodium nitroprusside|nitroprusside.*injection/i,
    generic: "SODIUM NITROPRUSSIDE INJECTION",
    drugClass: "Vasodilator",
  },
  {
    search: /midazolam.*injection/i,
    generic: "MIDAZOLAM INJECTION",
    drugClass: "Benzodiazepine / Sedative",
  },
  {
    search: /ketamine.*injection/i,
    generic: "KETAMINE INJECTION",
    drugClass: "Dissociative anaesthetic",
  },
  {
    search: /rocuronium.*injection/i,
    generic: "ROCURONIUM INJECTION",
    drugClass: "Non-depolarizing NMB",
  },
  {
    search: /esmolol.*injection/i,
    generic: "ESMOLOL INJECTION",
    drugClass: "Ultra-short-acting beta blocker",
  },
  {
    search: /hydralazine.*injection/i,
    generic: "HYDRALAZINE INJECTION",
    drugClass: "Direct vasodilator / Antihypertensive",
  },
  {
    search: /calcium chloride.*injection/i,
    generic: "CALCIUM CHLORIDE INJECTION",
    drugClass: "Electrolyte / Calcium supplement",
  },
];

for (const def of EMERGENCY_DRUGS) {
  if (alreadyExists(def.generic)) continue;
  const matches = [];
  for (let i = 1; i < indiaDescs.length; i++) {
    const c = indiaDescs[i].split("\t");
    if (c.length < 9 || c[2] !== "1" || c[6] !== "900000000000003001") continue;
    if (!c[7].includes("clinical drug)")) continue;
    const tl = c[7].toLowerCase();
    if (
      !tl.includes("injection") &&
      !tl.includes("infusion") &&
      !tl.includes("emulsion for")
    )
      continue;
    if (def.search.test(tl)) matches.push({ cid: c[4], fsn: c[7] });
  }
  if (!matches.length) continue;

  const formMap = new Map();
  for (const m of matches) {
    const info = extractBrandedDrug(m.cid);
    const key = info.ingredients
      .map(
        (i) => i.name + ":" + i.strength_numerator + i.strength_numerator_unit,
      )
      .sort()
      .join("|");
    if (!formMap.has(key)) {
      formMap.set(key, {
        form: info.form || "Solution for injection",
        form_snomed_code: info.formCode,
        route: "IV/IM",
        ingredients: info.ingredients,
        indian_brands: [],
        indian_conc_note: info.ingredients
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
        display_name: getName(m.cid),
      });
    }
    formMap.get(key).indian_brands.push({
      name: m.fsn.split("(")[0].trim(),
      manufacturer: info.supplier,
      snomed_code: m.cid,
      verified_on: "SNOMED CT India Extension March 2026",
    });
  }

  branded.push({
    generic_name: def.generic,
    snomed_code: null,
    drug_class: def.drugClass,
    category: "Emergency",
    therapeutic_use: ["Emergency / Critical care", "NICU/PICU"],
    brand_names: [
      ...new Set(matches.map((m) => m.fsn.split("(")[0].trim())),
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
    storage_instructions: null,
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["SNOMED CT India Drug Extension March 2026"],
    last_reviewed_date: null,
    active: true,
  });
  console.log(
    "  Added emergency: " +
      def.generic +
      " (" +
      formMap.size +
      " formulations, " +
      matches.length +
      " brands)",
  );
}

// --- Wikoryl AF (Chlorphenamine + Phenylephrine) ---
if (!alreadyExists("CHLORPHENAMINE MALEATE + PHENYLEPHRINE HYDROCHLORIDE")) {
  const dropsInfo = extractBrandedDrug("1937451000189106");
  const syrupInfo = extractBrandedDrug("2399791000189101");
  branded.push({
    generic_name: "CHLORPHENAMINE MALEATE + PHENYLEPHRINE HYDROCHLORIDE",
    snomed_code: null,
    drug_class: "Antihistamine + Decongestant",
    category: "Respiratory",
    therapeutic_use: ["Common cold", "Allergic rhinitis", "Nasal congestion"],
    brand_names: ["Wikoryl AF (Alembic Pharmaceuticals)"],
    licensed_in_children: true,
    unlicensed_note: "",
    formulations: [
      {
        form: dropsInfo.form || "Oral drops",
        form_snomed_code: dropsInfo.formCode,
        route: "PO",
        ingredients: dropsInfo.ingredients,
        indian_brands: [
          {
            name: "Wikoryl AF",
            manufacturer: "Alembic Pharmaceuticals Limited",
            snomed_code: "1937451000189106",
            verified_on: "SNOMED CT India Extension March 2026",
          },
        ],
        indian_conc_note: dropsInfo.ingredients
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
        display_name: getName("1937451000189106"),
      },
      {
        form: syrupInfo.form || "Oral syrup",
        form_snomed_code: syrupInfo.formCode,
        route: "PO",
        ingredients: syrupInfo.ingredients,
        indian_brands: [
          {
            name: "Wikoryl AF",
            manufacturer: "Alembic Pharmaceuticals Limited",
            snomed_code: "2399791000189101",
            verified_on: "SNOMED CT India Extension March 2026",
          },
        ],
        indian_conc_note: syrupInfo.ingredients
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
        display_name: getName("2399791000189101"),
      },
    ],
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
    storage_instructions: null,
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["SNOMED CT India Drug Extension March 2026"],
    last_reviewed_date: null,
    active: true,
  });
  console.log("  Added: Wikoryl AF (Chlorphenamine + Phenylephrine)");
}

// --- Paracetamol triple combo (orphan) ---
if (!alreadyExists("PARACETAMOL + CHLORPHENAMINE MALEATE + PHENYLEPHRINE")) {
  orphans.push({
    generic_name: "PARACETAMOL + CHLORPHENAMINE MALEATE + PHENYLEPHRINE",
    snomed_code: null,
    drug_class: "Antipyretic + Antihistamine + Decongestant",
    category: "Respiratory",
    therapeutic_use: ["Common cold with fever", "Flu symptoms"],
    brand_names: ["Sinarest AF (Centaur)", "Wicoryl (Alkem)"],
    licensed_in_children: true,
    unlicensed_note: "",
    formulations: [
      {
        form: "Oral drops",
        form_snomed_code: null,
        route: "PO",
        ingredients: [
          {
            name: "Paracetamol",
            snomed_code: "387517004",
            is_active: true,
            is_primary: true,
            strength_numerator: 125,
            strength_numerator_unit: "mg",
            strength_denominator: 1,
            strength_denominator_unit: "mL",
          },
          {
            name: "Chlorphenamine Maleate",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 1,
            strength_numerator_unit: "mg",
            strength_denominator: 1,
            strength_denominator_unit: "mL",
          },
          {
            name: "Phenylephrine Hydrochloride",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 5,
            strength_numerator_unit: "mg",
            strength_denominator: 1,
            strength_denominator_unit: "mL",
          },
        ],
        indian_brands: [
          {
            name: "Sinarest AF Drops",
            manufacturer: "Centaur Pharmaceuticals",
            snomed_code: null,
            verified_on: "Manual - March 2026",
          },
        ],
        indian_conc_note: "Paracetamol 125 mg + CPM 1 mg + PE 5 mg per mL",
        display_name: "Paracetamol + Chlorphenamine + Phenylephrine drops",
      },
      {
        form: "Oral syrup",
        form_snomed_code: null,
        route: "PO",
        ingredients: [
          {
            name: "Paracetamol",
            snomed_code: "387517004",
            is_active: true,
            is_primary: true,
            strength_numerator: 125,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Chlorphenamine Maleate",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 1,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Phenylephrine Hydrochloride",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 5,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
        ],
        indian_brands: [
          {
            name: "Sinarest AF Syrup",
            manufacturer: "Centaur Pharmaceuticals",
            snomed_code: null,
            verified_on: "Manual - March 2026",
          },
          {
            name: "Wicoryl Syrup",
            manufacturer: "Alkem Laboratories",
            snomed_code: null,
            verified_on: "Manual - March 2026",
          },
        ],
        indian_conc_note: "Paracetamol 125 mg + CPM 1 mg + PE 5 mg per 5 mL",
        display_name: "Paracetamol + Chlorphenamine + Phenylephrine syrup",
      },
    ],
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
    storage_instructions: null,
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["Manual entry"],
    last_reviewed_date: null,
    active: true,
  });
  console.log(
    "  Added orphan: Paracetamol + Chlorphenamine + Phenylephrine (Wicoryl)",
  );
}

// --- Neogadine Elixir (orphan) ---
if (!alreadyExists("NEOGADINE ELIXIR (MULTIVITAMIN + MULTIMINERAL)")) {
  orphans.push({
    generic_name: "NEOGADINE ELIXIR (MULTIVITAMIN + MULTIMINERAL)",
    snomed_code: null,
    drug_class: "Appetite stimulant / Nutritional supplement",
    category: "Nutritional",
    therapeutic_use: [
      "Appetite stimulation",
      "Vitamin deficiency",
      "Mineral deficiency",
    ],
    brand_names: ["Neogadine Elixir (Raptakos Brett & Co.)"],
    licensed_in_children: true,
    unlicensed_note: "",
    formulations: [
      {
        form: "Elixir",
        form_snomed_code: null,
        route: "PO",
        ingredients: [
          {
            name: "Iodised Peptone",
            snomed_code: null,
            is_active: true,
            is_primary: true,
            strength_numerator: 0.322,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Magnesium Chloride",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 6.67,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Manganese Sulphate",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 1.33,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Sodium Metavanadate",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 0.22,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Zinc Sulphate",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 10.71,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Pyridoxine Hydrochloride",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 0.25,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Cyanocobalamin",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 0.167,
            strength_numerator_unit: "mcg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Nicotinamide",
            snomed_code: null,
            is_active: true,
            is_primary: false,
            strength_numerator: 3.33,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
        ],
        indian_brands: [
          {
            name: "Neogadine Elixir",
            manufacturer: "Raptakos Brett & Co. Ltd.",
            snomed_code: null,
            verified_on: "1mg.com / PharmEasy March 2026",
          },
        ],
        indian_conc_note:
          "Per 5 mL: Iodised Peptone 0.322 mg + MgCl2 6.67 mg + MnSO4 1.33 mg + Na Metavanadate 0.22 mg + ZnSO4 10.71 mg + Pyridoxine 0.25 mg + Cyanocobalamin 0.167 mcg + Nicotinamide 3.33 mg",
        display_name: "Neogadine Elixir (Multivitamin + Multimineral)",
      },
    ],
    dosing_bands: [],
    renal_adjustment_required: false,
    renal_bands: [],
    hepatic_adjustment_required: false,
    hepatic_note: null,
    contraindications: [],
    cross_reactions: [],
    interactions: [],
    black_box_warnings: [],
    pediatric_specific_warnings: [
      "Contains ethanol (95%) 0.317 mL per 5 mL - caution in neonates",
    ],
    monitoring_parameters: [],
    administration: [{ route: "PO", instruction: "Give with or after meals." }],
    food_instructions: "Take with or after food",
    storage_instructions: "Store below 25C. Keep away from light.",
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["1mg.com", "PharmEasy"],
    last_reviewed_date: null,
    active: true,
  });
  console.log("  Added orphan: Neogadine Elixir");
}

// --- Ferrous Ascorbate + Folic Acid (orphan) ---
if (!alreadyExists("FERROUS ASCORBATE + FOLIC ACID")) {
  orphans.push({
    generic_name: "FERROUS ASCORBATE + FOLIC ACID",
    snomed_code: null,
    drug_class: "Iron supplement + Vitamin",
    category: "Nutritional",
    therapeutic_use: ["Iron deficiency anaemia", "Folic acid deficiency"],
    brand_names: ["Orofer-XT (Emcure)"],
    licensed_in_children: true,
    unlicensed_note: "",
    formulations: [
      {
        form: "Oral drops",
        form_snomed_code: null,
        route: "PO",
        ingredients: [
          {
            name: "Ferrous Ascorbate",
            snomed_code: null,
            is_active: true,
            is_primary: true,
            strength_numerator: 30,
            strength_numerator_unit: "mg",
            strength_denominator: 1,
            strength_denominator_unit: "mL",
          },
          {
            name: "Folic Acid",
            snomed_code: "387174006",
            is_active: true,
            is_primary: false,
            strength_numerator: 0.2,
            strength_numerator_unit: "mg",
            strength_denominator: 1,
            strength_denominator_unit: "mL",
          },
        ],
        indian_brands: [
          {
            name: "Orofer-XT Drops",
            manufacturer: "Emcure Pharmaceuticals",
            snomed_code: null,
            verified_on: "Manual - March 2026",
          },
        ],
        indian_conc_note: "Ferrous Ascorbate 30 mg + Folic Acid 0.2 mg per mL",
        display_name: "Ferrous Ascorbate + Folic Acid drops",
      },
      {
        form: "Oral syrup",
        form_snomed_code: null,
        route: "PO",
        ingredients: [
          {
            name: "Ferrous Ascorbate",
            snomed_code: null,
            is_active: true,
            is_primary: true,
            strength_numerator: 30,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
          {
            name: "Folic Acid",
            snomed_code: "387174006",
            is_active: true,
            is_primary: false,
            strength_numerator: 0.5,
            strength_numerator_unit: "mg",
            strength_denominator: 5,
            strength_denominator_unit: "mL",
          },
        ],
        indian_brands: [
          {
            name: "Orofer-XT Syrup",
            manufacturer: "Emcure Pharmaceuticals",
            snomed_code: null,
            verified_on: "Manual - March 2026",
          },
        ],
        indian_conc_note:
          "Ferrous Ascorbate 30 mg + Folic Acid 0.5 mg per 5 mL",
        display_name: "Ferrous Ascorbate + Folic Acid syrup",
      },
    ],
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
    food_instructions:
      "Take on empty stomach or with Vitamin C for better absorption",
    storage_instructions: null,
    pregnancy_category: null,
    lactation_safe: null,
    lactation_note: null,
    reference_source: ["Manual entry"],
    last_reviewed_date: null,
    active: true,
  });
  console.log("  Added orphan: Ferrous Ascorbate + Folic Acid");
}

// ===================== INTEGRITY CHECKS =====================
console.log("\n=== INTEGRITY CHECKS ===");
let hasError = false;

// Check 1: No duplicate generic_names within each file
for (const [label, arr] of [
  ["branded", branded],
  ["generics", generics],
  ["orphans", orphans],
]) {
  const seen = new Set();
  const dupes = [];
  for (const d of arr) {
    const key = d.generic_name.toUpperCase();
    if (seen.has(key)) dupes.push(d.generic_name);
    seen.add(key);
  }
  if (dupes.length) {
    console.log(
      "ERROR: " +
        dupes.length +
        " duplicate names in " +
        label +
        ": " +
        dupes.join(", "),
    );
    hasError = true;
  } else {
    console.log("  " + label + ": no duplicates");
  }
}

// Check 2: No duplicate generic_names across files
const allNames = new Set();
let crossDupes = 0;
for (const arr of [branded, generics, orphans]) {
  for (const d of arr) {
    const key = d.generic_name.toUpperCase();
    if (allNames.has(key)) {
      crossDupes++;
      console.log("  CROSS-DUPE: " + d.generic_name);
    }
    allNames.add(key);
  }
}
if (crossDupes) {
  console.log("ERROR: " + crossDupes + " cross-file duplicates");
  hasError = true;
} else console.log("  No cross-file duplicates");

// Check 3: Total count >= original 652
const total = branded.length + generics.length + orphans.length;
if (total < 652) {
  console.log("ERROR: Total " + total + " < original 652 — drugs lost!");
  hasError = true;
} else {
  console.log("  Total " + total + " >= 652 original — OK");
}

// Check 4: Every drug has generic_name and formulations array
for (const arr of [branded, generics, orphans]) {
  for (const d of arr) {
    if (!d.generic_name) {
      console.log("ERROR: Drug without generic_name!");
      hasError = true;
    }
    if (!Array.isArray(d.formulations)) {
      console.log("ERROR: " + d.generic_name + " has non-array formulations");
      hasError = true;
    }
  }
}
console.log("  All drugs have generic_name and formulations array");

// Check 5: No SNOMED code duplicates within branded+generics
const codeSet = new Map();
let codeDupes = 0;
for (const arr of [branded, generics]) {
  for (const d of arr) {
    if (!d.snomed_code) continue;
    if (codeSet.has(d.snomed_code)) {
      codeDupes++;
      if (codeDupes <= 10)
        console.log(
          "  WARN: code " +
            d.snomed_code +
            " shared by: " +
            codeSet.get(d.snomed_code) +
            " AND " +
            d.generic_name,
        );
    }
    codeSet.set(d.snomed_code, d.generic_name);
  }
}
if (codeDupes) console.log("  Total duplicate SNOMED codes: " + codeDupes);

// ===================== DRY RUN vs REAL WRITE =====================
const DRY_RUN = process.argv.includes("--dry-run");

if (hasError && !process.argv.includes("--force")) {
  console.log("\nERRORS FOUND — aborting write. Use --force to override.");
  process.exit(1);
}

if (DRY_RUN) {
  console.log("\n=== DRY RUN — writing to _preview files ===");
  fs.writeFileSync(
    path.join(DATA_DIR, "_preview_branded.json"),
    JSON.stringify(branded, null, 2),
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "_preview_generics.json"),
    JSON.stringify(generics, null, 2),
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "_preview_orphans.json"),
    JSON.stringify(orphans, null, 2),
  );
  console.log(
    "Preview files written. Inspect them, then run without --dry-run.",
  );
} else {
  console.log("\n=== WRITING FINAL OUTPUT ===");
  fs.writeFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"),
    JSON.stringify(branded, null, 2),
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_generics.json"),
    JSON.stringify(generics, null, 2),
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans.json"),
    JSON.stringify(orphans, null, 2),
  );
  console.log("Final files written.");
}

const totalBrands = branded.reduce(
  (s, d) =>
    s +
    (d.formulations || []).reduce(
      (s2, f) => s2 + (f.indian_brands || []).length,
      0,
    ),
  0,
);
const totalForms = branded.reduce(
  (s, d) => s + (d.formulations || []).length,
  0,
);

console.log("\n=== FINAL RESULTS ===");
console.log(
  "Branded:  " +
    branded.length +
    " drugs, " +
    totalForms +
    " formulations, " +
    totalBrands +
    " Indian brands",
);
console.log(
  "Generics: " + generics.length + " drugs (SNOMED code, no India brands)",
);
console.log("Orphans:  " + orphans.length + " drugs (no SNOMED code)");
console.log(
  "TOTAL:    " + (branded.length + generics.length + orphans.length) + " drugs",
);
