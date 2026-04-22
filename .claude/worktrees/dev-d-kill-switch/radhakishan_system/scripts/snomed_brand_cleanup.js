#!/usr/bin/env node
/**
 * Phase 1: Validate all brand→generic mappings against SNOMED
 * Phase 2: Pull all SNOMED brands for each generic
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
const FORMULARY_PATH = path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json");

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
const brandedConcepts = new Map(); // conceptId → {term, brandName}
const brandWordIndex = new Map(); // word → Set<conceptId>

for (let i = 1; i < descLines.length; i++) {
  const cols = descLines[i].split("\t");
  if (cols.length < 9 || cols[2] !== "1") continue;
  const cid = cols[4],
    tid = cols[6],
    term = cols[7];
  if (!descMap.has(cid)) descMap.set(cid, []);
  descMap.get(cid).push({ typeId: tid, term });

  // Index branded drugs by brand name words
  if (term.includes("(real clinical drug)") && tid === "900000000000003001") {
    // Extract brand name: everything before first '('
    const brandName = term.split("(")[0].trim();
    brandedConcepts.set(cid, { term, brandName });
    const words = brandName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    for (const w of words) {
      if (!brandWordIndex.has(w)) brandWordIndex.set(w, new Set());
      brandWordIndex.get(w).add(cid);
    }
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
const isaParents = new Map(); // child → [parent concept IDs]
const isaChildren = new Map(); // parent → [child concept IDs]
const ingredientOf = new Map(); // conceptId → [ingredient concept IDs]
const supplierOf = new Map(); // conceptId → supplier concept ID
const doseFormOf = new Map(); // conceptId → dose form concept ID

for (let i = 1; i < relLines.length; i++) {
  const cols = relLines[i].split("\t");
  if (cols.length < 10 || cols[2] !== "1") continue;
  const src = cols[4],
    dest = cols[5],
    tid = cols[7],
    grp = cols[6];

  if (tid === "116680003") {
    // IS-A
    if (!isaParents.has(src)) isaParents.set(src, []);
    isaParents.get(src).push(dest);
    if (!isaChildren.has(dest)) isaChildren.set(dest, []);
    isaChildren.get(dest).push(src);
  }
  if ((tid === "762949000" || tid === "127489000") && grp !== "0") {
    // HAS_INGREDIENT
    if (!ingredientOf.has(src)) ingredientOf.set(src, []);
    ingredientOf.get(src).push(dest);
  }
  if (tid === "774159003" && grp === "0") {
    // HAS_SUPPLIER
    supplierOf.set(src, dest);
  }
  if (tid === "411116001" && grp === "0") {
    // HAS_DOSE_FORM
    doseFormOf.set(src, dest);
  }
}

// Load concrete values for strengths
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
console.log("Branded drugs indexed:", brandedConcepts.size);
console.log("Brand word index:", brandWordIndex.size, "words");

function getName(cid) {
  const d = descMap.get(cid);
  if (!d) return String(cid);
  return (
    (d.find((x) => x.typeId === "900000000000013009") || d[0])?.term ||
    String(cid)
  );
}

// Search SNOMED for a brand name
function findBrandInSnomed(brandName) {
  const clean = brandName.replace(/\s*\(.+?\)$/g, "").trim();
  const words = clean
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (!words.length) return null;

  // Intersect word hits
  let candidates = null;
  for (const w of words) {
    const hits = brandWordIndex.get(w);
    if (!hits) continue;
    if (!candidates) candidates = new Set(hits);
    else {
      const intersected = new Set();
      for (const c of candidates) {
        if (hits.has(c)) intersected.add(c);
      }
      candidates = intersected;
    }
  }
  if (!candidates || !candidates.size) {
    // Try just first word
    const hits = brandWordIndex.get(words[0]);
    if (hits) candidates = hits;
    else return null;
  }

  // Find best match by checking term contains brand name
  const cleanLower = clean.toLowerCase();
  for (const cid of candidates) {
    const info = brandedConcepts.get(cid);
    if (info && info.brandName.toLowerCase().includes(cleanLower)) {
      return { conceptId: cid, ...info };
    }
  }
  // Return first candidate
  const first = [...candidates][0];
  const info = brandedConcepts.get(first);
  return info ? { conceptId: first, ...info } : null;
}

// Get ingredients of a SNOMED concept
function getIngredients(cid) {
  const ings = ingredientOf.get(cid) || [];
  return ings.map((id) => getName(id));
}

// Get the generic parent description
function getGenericParent(brandCid) {
  const parents = isaParents.get(brandCid) || [];
  // Find the parent that is a clinical drug (not a branded product family)
  for (const pid of parents) {
    const descs = descMap.get(pid) || [];
    const fsn = descs.find((d) => d.typeId === "900000000000003001");
    if (
      fsn &&
      fsn.term.includes("(clinical drug)") &&
      !fsn.term.includes("real")
    ) {
      return { conceptId: pid, term: getName(pid) };
    }
  }
  // If no clinical drug parent, return any parent
  return parents.length
    ? { conceptId: parents[0], term: getName(parents[0]) }
    : null;
}

// ===== PHASE 1: Validate brand→generic mappings =====
console.log("\n===== PHASE 1: Validating brand→generic mappings =====");
const formulary = JSON.parse(fs.readFileSync(FORMULARY_PATH, "utf8"));

const mismatches = [];
let validated = 0,
  correct = 0,
  mismatchCount = 0,
  notFound = 0;

for (const drug of formulary) {
  // Check top-level brand_names
  for (const brandStr of drug.brand_names || []) {
    const brandClean = brandStr.replace(/\s*\(.+?\)$/, "").trim();
    if (brandClean.length < 3) continue;

    const snomedMatch = findBrandInSnomed(brandClean);
    validated++;

    if (snomedMatch) {
      // Get SNOMED's ingredients for this branded drug
      const snomedIngs = getIngredients(snomedMatch.conceptId);
      const snomedGeneric = getGenericParent(snomedMatch.conceptId);

      // Check if our generic name matches any of SNOMED's ingredients
      const ourGenWords = drug.generic_name
        .toLowerCase()
        .replace(/[^a-z]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const snomedTermLower = snomedMatch.term.toLowerCase();
      const matches = ourGenWords.some((w) => snomedTermLower.includes(w));

      if (!matches && snomedIngs.length > 0) {
        mismatchCount++;
        mismatches.push({
          brand: brandStr,
          ourGeneric: drug.generic_name,
          snomedTerm: snomedMatch.term,
          snomedIngredients: snomedIngs.join(" + "),
          snomedGenericParent: snomedGeneric?.term || null,
          snomedConceptId: snomedMatch.conceptId,
        });
      } else {
        correct++;
      }
    } else {
      notFound++;
    }
  }
}

console.log("Brands validated:", validated);
console.log("Correct:", correct);
console.log("Mismatches:", mismatchCount);
console.log("Not found in SNOMED:", notFound);

if (mismatches.length) {
  console.log("\n--- MISMATCHES ---");
  // Deduplicate by brand name
  const seen = new Set();
  const unique = mismatches.filter((m) => {
    const key = m.brand.split(" ")[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.slice(0, 30).forEach((m) => {
    console.log(`  ${m.brand}`);
    console.log(`    Listed under: ${m.ourGeneric}`);
    console.log(`    SNOMED says: ${m.snomedIngredients}`);
    console.log("");
  });
  if (unique.length > 30) console.log("  ... and", unique.length - 30, "more");
}

// ===== PHASE 2: Pull all SNOMED brands for each generic =====
console.log("\n===== PHASE 2: Pulling SNOMED brands for each generic =====");

let brandsAdded = 0,
  drugsEnriched = 0;

for (const drug of formulary) {
  if (!drug.snomed_code) continue;

  // Find all branded children of this generic concept
  const children = isaChildren.get(drug.snomed_code) || [];
  const brands = children.filter((cid) => brandedConcepts.has(cid));

  if (!brands.length) continue;
  drugsEnriched++;

  // Add to first formulation's indian_brands (deduplicated)
  const form = drug.formulations[0];
  if (!form) continue;
  if (!form.indian_brands) form.indian_brands = [];

  const existingNames = new Set(
    form.indian_brands.map((b) => (b.name || "").toLowerCase()),
  );

  for (const brandCid of brands) {
    const info = brandedConcepts.get(brandCid);
    if (!info) continue;

    // Extract brand name and manufacturer from the FSN
    // Pattern: "BrandName (generic) strength form Manufacturer (real clinical drug)"
    const parts = info.term.split(")");
    let manufacturer = null;
    if (parts.length >= 2) {
      // Last part before "(real clinical drug)" is manufacturer
      const lastPart = parts[parts.length - 2]?.trim();
      if (lastPart) {
        // Extract manufacturer name (after the strength/form)
        const supplierCid = supplierOf.get(brandCid);
        if (supplierCid) manufacturer = getName(supplierCid);
      }
    }

    const brandName = info.brandName.split(/\d/)[0].trim(); // Brand name without strength
    if (brandName.length < 2) continue;
    if (existingNames.has(brandName.toLowerCase())) continue;

    form.indian_brands.push({
      name: info.brandName,
      manufacturer: manufacturer,
      snomed_code: brandCid,
      verified_on: "SNOMED CT India Extension March 2026",
    });
    existingNames.add(brandName.toLowerCase());
    brandsAdded++;
  }
}

console.log("Drugs enriched with SNOMED brands:", drugsEnriched);
console.log("Brand entries added:", brandsAdded);

// Final stats
const totalBrands = formulary.reduce(
  (sum, d) =>
    sum +
    d.formulations.reduce((s, f) => s + (f.indian_brands?.length || 0), 0),
  0,
);
console.log("Total brand entries in formulary now:", totalBrands);

// Save
fs.writeFileSync(FORMULARY_PATH, JSON.stringify(formulary, null, 2));
console.log("\nFormulary saved.");

// Save mismatches report
fs.writeFileSync(
  path.join(DATA_DIR, "_brand_mismatches.json"),
  JSON.stringify(mismatches, null, 2),
);
console.log("Mismatches report saved to _brand_mismatches.json");
