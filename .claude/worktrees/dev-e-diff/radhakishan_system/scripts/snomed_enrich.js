#!/usr/bin/env node
/**
 * SNOMED Enrich — Add missing SNOMED data to the 3 formulary files.
 *
 * For BRANDED drugs (125):
 *   - Add generic_clinical_drug_code (the intermediate Clinical Drug concept)
 *   - Add unit_of_presentation + unit_of_presentation_code per formulation
 *   - Add trade_name_concept per brand
 *   - Add basis_of_strength_substance per ingredient
 *   - Fix snomed_display where missing
 *
 * For GENERIC drugs (231):
 *   - Populate ingredient names from substance code
 *   - Add snomed_display where missing
 *
 * Reads: formulary_data_ABDM_FHIR*.json
 * Writes: same files (enriched in place)
 * Safety: --dry-run writes to _enriched_preview_*.json
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
const DRY_RUN = process.argv.includes("--dry-run");

// ===================== LOAD SNOMED =====================
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

console.timeEnd("Load");

function getName(cid) {
  return (
    prefMap.get(cid) || (fsnMap.get(cid) || cid).replace(/\s*\([^)]+\)\s*$/, "")
  );
}

function getSubstanceName(cid) {
  if (!cid) return null;
  const fsn = fsnMap.get(cid);
  if (fsn && fsn.includes("(substance)")) {
    return prefMap.get(cid) || fsn.replace(/\s*\(substance\)\s*$/, "");
  }
  return getName(cid);
}

// For a branded drug (real clinical drug), extract extra SNOMED fields
function getExtraFields(brandCid) {
  const rels = relMap.get(brandCid) || [];
  const cvs = cvMap.get(brandCid) || [];
  const g0rels = rels.filter((r) => r.group === "0");

  // Unit of presentation (763032000)
  const uopRel = g0rels.find((r) => r.typeId === "763032000");
  // Trade name (774158006)
  const tradeRel = g0rels.find((r) => r.typeId === "774158006");
  // IS-A parents
  const isaRels = rels.filter((r) => r.typeId === "116680003");
  let genericCDCode = null;
  let brandFamilyCode = null;
  for (const isa of isaRels) {
    const fsn = fsnMap.get(isa.destId);
    if (!fsn) continue;
    if (fsn.includes("(clinical drug)") && !fsn.includes("real")) {
      genericCDCode = isa.destId;
    }
    if (fsn.includes("(real medicinal product)")) {
      brandFamilyCode = isa.destId;
    }
  }

  // Per-ingredient: basis of strength substance (732943007)
  const groups = {};
  for (const r of rels) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }
  const bossMap = {}; // group → basis of strength substance
  for (const [gNum, gRels] of Object.entries(groups)) {
    if (gNum === "0") continue;
    const bossRel = gRels.find((r) => r.typeId === "732943007");
    if (bossRel)
      bossMap[gNum] = { code: bossRel.destId, name: getName(bossRel.destId) };
  }

  return {
    unit_of_presentation: uopRel ? getName(uopRel.destId) : null,
    unit_of_presentation_code: uopRel ? uopRel.destId : null,
    trade_name: tradeRel ? getName(tradeRel.destId) : null,
    trade_name_code: tradeRel ? tradeRel.destId : null,
    generic_clinical_drug_code: genericCDCode,
    generic_clinical_drug_name: genericCDCode ? getName(genericCDCode) : null,
    brand_family_code: brandFamilyCode,
    brand_family_name: brandFamilyCode ? getName(brandFamilyCode) : null,
    bossMap,
  };
}

// ===================== ENRICH BRANDED =====================
console.log("\n=== Enriching branded drugs ===");
const branded = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"), "utf8"),
);

let enrichedBrands = 0,
  enrichedForms = 0,
  enrichedIngs = 0;

for (const drug of branded) {
  // Fix missing snomed_display
  if (!drug.snomed_display && drug.snomed_code) {
    drug.snomed_display = getSubstanceName(drug.snomed_code);
  }

  for (const form of drug.formulations || []) {
    // Pick the first brand with a SNOMED code to extract extra fields
    const snomedBrand = (form.indian_brands || []).find((b) => b.snomed_code);
    if (!snomedBrand) continue;

    const extra = getExtraFields(snomedBrand.snomed_code);

    // Add unit_of_presentation to formulation level
    if (extra.unit_of_presentation && !form.unit_of_presentation) {
      form.unit_of_presentation = extra.unit_of_presentation;
      form.unit_of_presentation_code = extra.unit_of_presentation_code;
      enrichedForms++;
    }

    // Add generic_clinical_drug_code to formulation level (each formulation may have different generic CD)
    if (extra.generic_clinical_drug_code && !form.generic_clinical_drug_code) {
      form.generic_clinical_drug_code = extra.generic_clinical_drug_code;
      form.generic_clinical_drug_name = extra.generic_clinical_drug_name;
    }

    // Add trade_name + brand_family to each brand entry
    for (const brand of form.indian_brands || []) {
      if (!brand.snomed_code) continue;
      const bExtra = getExtraFields(brand.snomed_code);
      if (bExtra.trade_name && !brand.trade_name) {
        brand.trade_name = bExtra.trade_name;
        brand.trade_name_code = bExtra.trade_name_code;
      }
      if (bExtra.brand_family_name && !brand.brand_family) {
        brand.brand_family = bExtra.brand_family_name;
        brand.brand_family_code = bExtra.brand_family_code;
      }
      enrichedBrands++;
    }

    // Add basis_of_strength_substance to ingredients
    // Match by group position (ingredients are in group order)
    const ingGroups = Object.keys(extra.bossMap).sort();
    for (
      let i = 0;
      i < (form.ingredients || []).length && i < ingGroups.length;
      i++
    ) {
      const ing = form.ingredients[i];
      const boss = extra.bossMap[ingGroups[i]];
      if (boss && !ing.basis_of_strength) {
        ing.basis_of_strength = boss.name;
        ing.basis_of_strength_code = boss.code;
        enrichedIngs++;
      }
    }
  }
}

console.log("  Formulations enriched (unit_of_presentation):", enrichedForms);
console.log("  Brands enriched (trade_name, brand_family):", enrichedBrands);
console.log("  Ingredients enriched (basis_of_strength):", enrichedIngs);

// ===================== ENRICH GENERICS =====================
console.log("\n=== Enriching generic drugs ===");
const generics = JSON.parse(
  fs.readFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_generics.json"),
    "utf8",
  ),
);

let genericsEnriched = 0;
for (const drug of generics) {
  // Fix missing snomed_display
  if (!drug.snomed_display && drug.snomed_code) {
    drug.snomed_display = getSubstanceName(drug.snomed_code);
  }

  // For old-format formulations with null ingredient names, populate from substance code
  if (drug.snomed_code) {
    const substName = getSubstanceName(drug.snomed_code);
    for (const form of drug.formulations || []) {
      for (const ing of form.ingredients || []) {
        if (!ing.name && substName) {
          ing.name = substName;
          ing.snomed_code = drug.snomed_code;
          genericsEnriched++;
        }
      }
    }
  }
}
console.log(
  "  Generic ingredients populated with substance name:",
  genericsEnriched,
);

// ===================== ENRICH ORPHANS =====================
console.log("\n=== Enriching orphan drugs ===");
const orphans = JSON.parse(
  fs.readFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans.json"),
    "utf8",
  ),
);

// For orphans, populate ingredient name from generic_name if missing
let orphansEnriched = 0;
for (const drug of orphans) {
  for (const form of drug.formulations || []) {
    for (const ing of form.ingredients || []) {
      if (!ing.name) {
        // Use the generic_name as the ingredient name for single-ingredient drugs
        ing.name = drug.generic_name;
        orphansEnriched++;
      }
    }
  }
}
console.log(
  "  Orphan ingredients populated with generic_name:",
  orphansEnriched,
);

// ===================== INTEGRITY CHECK =====================
console.log("\n=== INTEGRITY CHECK ===");
let ok = true;
for (const [label, arr] of [
  ["branded", branded],
  ["generics", generics],
  ["orphans", orphans],
]) {
  const seen = new Set();
  for (const d of arr) {
    const key = d.generic_name.toUpperCase();
    if (seen.has(key)) {
      console.log("ERROR: Duplicate in " + label + ": " + d.generic_name);
      ok = false;
    }
    seen.add(key);
    if (!d.generic_name) {
      console.log("ERROR: Missing generic_name in " + label);
      ok = false;
    }
  }
}
const total = branded.length + generics.length + orphans.length;
console.log("  Total drugs:", total);
if (total < 679) {
  console.log("ERROR: Drug count decreased!");
  ok = false;
}
if (!ok) {
  console.log("ERRORS — aborting");
  process.exit(1);
}
console.log("  All checks passed");

// ===================== WRITE =====================
if (DRY_RUN) {
  console.log("\n=== DRY RUN — writing preview files ===");
  fs.writeFileSync(
    path.join(DATA_DIR, "_enriched_preview_branded.json"),
    JSON.stringify(branded, null, 2),
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "_enriched_preview_generics.json"),
    JSON.stringify(generics, null, 2),
  );
  fs.writeFileSync(
    path.join(DATA_DIR, "_enriched_preview_orphans.json"),
    JSON.stringify(orphans, null, 2),
  );
  console.log("Preview files written.");
} else {
  console.log("\n=== WRITING ENRICHED FILES ===");
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
  console.log("Files written.");
}

// Show sample enriched brand
const sampleBrand = branded.find((d) =>
  d.formulations.some(
    (f) => f.unit_of_presentation && f.generic_clinical_drug_code,
  ),
);
if (sampleBrand) {
  const sf = sampleBrand.formulations.find((f) => f.unit_of_presentation);
  const sb = sf.indian_brands.find((b) => b.trade_name);
  console.log("\n=== SAMPLE ENRICHED ENTRY ===");
  console.log("Drug:", sampleBrand.generic_name);
  console.log("  snomed_code:", sampleBrand.snomed_code);
  console.log("  snomed_display:", sampleBrand.snomed_display);
  console.log("  Formulation:");
  console.log("    form:", sf.form);
  console.log(
    "    unit_of_presentation:",
    sf.unit_of_presentation,
    "[" + sf.unit_of_presentation_code + "]",
  );
  console.log(
    "    generic_clinical_drug:",
    sf.generic_clinical_drug_name,
    "[" + sf.generic_clinical_drug_code + "]",
  );
  if (sf.ingredients[0]) {
    const i = sf.ingredients[0];
    console.log(
      "    ingredient:",
      i.name,
      i.strength_numerator,
      i.strength_numerator_unit,
    );
    console.log(
      "    basis_of_strength:",
      i.basis_of_strength,
      "[" + i.basis_of_strength_code + "]",
    );
  }
  if (sb) {
    console.log("    brand:", sb.name);
    console.log(
      "    trade_name:",
      sb.trade_name,
      "[" + sb.trade_name_code + "]",
    );
    console.log(
      "    brand_family:",
      sb.brand_family,
      "[" + sb.brand_family_code + "]",
    );
  }
}
