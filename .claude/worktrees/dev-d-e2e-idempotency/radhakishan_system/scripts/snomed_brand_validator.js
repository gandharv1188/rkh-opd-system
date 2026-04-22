#!/usr/bin/env node
/**
 * SNOMED Brand Validator — Correct approach
 *
 * For each brand in our formulary:
 * 1. Search ONLY in Real Clinical Drug FSNs (branded entries)
 * 2. Match brand name + manufacturer when available
 * 3. Extract the actual generic from the SNOMED FSN parentheses
 * 4. Compare against our listed generic
 * 5. Report true mismatches
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

console.log("Loading SNOMED...");
console.time("Load");

// Load ONLY Real Clinical Drug FSNs (branded entries)
// FSN format: "BrandName (generic_name) strength form Manufacturer (real clinical drug)"
const descLines = fs
  .readFileSync(
    path.join(
      BASE,
      "sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");

// Index: first word of brand name (lowercase) → [{conceptId, fsn, brandName, generic, manufacturer}]
const brandIndex = new Map();
let totalBranded = 0;

for (let i = 1; i < descLines.length; i++) {
  const cols = descLines[i].split("\t");
  if (cols.length < 9 || cols[2] !== "1") continue;
  const cid = cols[4],
    tid = cols[6],
    term = cols[7];

  // Only FSNs of Real Clinical Drugs
  if (tid !== "900000000000003001" || !term.includes("(real clinical drug)"))
    continue;

  totalBranded++;

  // Parse FSN: "BrandName (generic) strength form Manufacturer (real clinical drug)"
  // Extract brand name = everything before first '('
  const firstParen = term.indexOf("(");
  if (firstParen < 1) continue;
  const brandName = term.substring(0, firstParen).trim();

  // Extract generic = content inside first parentheses
  const genericMatch = term.match(/\(([^)]+)\)/);
  const generic = genericMatch ? genericMatch[1] : null;

  // Extract manufacturer = last entity before "(real clinical drug)"
  // Pattern: "... strength form ManufacturerName (real clinical drug)"
  const beforeRCD = term.replace(" (real clinical drug)", "");
  // Manufacturer is after the last number+unit pattern
  const mfgMatch = beforeRCD.match(/(?:mg|mL|mcg|IU|g|%)\s+(.+?)$/i);
  const manufacturer = mfgMatch ? mfgMatch[1].trim() : null;

  // Index by first word of brand name
  const firstWord = brandName.split(/\s+/)[0].toLowerCase();
  if (firstWord.length < 2) continue;

  if (!brandIndex.has(firstWord)) brandIndex.set(firstWord, []);
  brandIndex.get(firstWord).push({
    conceptId: cid,
    fsn: term,
    brandName,
    generic,
    manufacturer,
  });
}

console.timeEnd("Load");
console.log("Branded FSNs indexed:", totalBranded);
console.log("Unique first-words:", brandIndex.size);

// Load IS-A relationships for generic parent lookup
const relLines = fs
  .readFileSync(
    path.join(
      BASE,
      "sct2_Relationship_Snapshot_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");
const isaParents = new Map();
for (let i = 1; i < relLines.length; i++) {
  const cols = relLines[i].split("\t");
  if (cols.length < 10 || cols[2] !== "1" || cols[7] !== "116680003") continue;
  if (!isaParents.has(cols[4])) isaParents.set(cols[4], []);
  isaParents.get(cols[4]).push(cols[5]);
}

// Load all descriptions for getName()
const allDescMap = new Map();
for (let i = 1; i < descLines.length; i++) {
  const cols = descLines[i].split("\t");
  if (cols.length < 9 || cols[2] !== "1") continue;
  if (!allDescMap.has(cols[4])) allDescMap.set(cols[4], []);
  allDescMap.get(cols[4]).push({ typeId: cols[6], term: cols[7] });
}

function getName(cid) {
  const d = allDescMap.get(cid);
  if (!d) return String(cid);
  return (
    (d.find((x) => x.typeId === "900000000000013009") || d[0])?.term ||
    String(cid)
  );
}

function getGenericParent(brandCid) {
  const parents = isaParents.get(brandCid) || [];
  for (const pid of parents) {
    const descs = allDescMap.get(pid) || [];
    const fsn = descs.find((d) => d.typeId === "900000000000003001");
    if (
      fsn &&
      fsn.term.includes("(clinical drug)") &&
      !fsn.term.includes("real")
    ) {
      return { conceptId: pid, term: getName(pid) };
    }
  }
  return parents.length
    ? { conceptId: parents[0], term: getName(parents[0]) }
    : null;
}

// Search for a brand in SNOMED branded drugs
function findBrandedDrug(brandName, manufacturer) {
  const brandClean = brandName.replace(/\s*\(.+?\)$/g, "").trim();
  const firstWord = brandClean.split(/\s+/)[0].toLowerCase();
  if (firstWord.length < 2) return null;

  const candidates = brandIndex.get(firstWord);
  if (!candidates) return null;

  const brandLower = brandClean.toLowerCase();
  const mfgLower = manufacturer ? manufacturer.toLowerCase() : null;

  // Strategy 1: Match brand name + manufacturer
  if (mfgLower) {
    for (const c of candidates) {
      if (
        c.brandName.toLowerCase().includes(brandLower) &&
        c.manufacturer &&
        c.manufacturer.toLowerCase().includes(mfgLower.split(/\s+/)[0])
      ) {
        return c;
      }
    }
  }

  // Strategy 2: Match brand name only (exact start)
  for (const c of candidates) {
    if (
      c.brandName.toLowerCase() === brandLower ||
      c.brandName.toLowerCase().startsWith(brandLower + " ")
    ) {
      return c;
    }
  }

  // Strategy 3: Brand name contains our search
  for (const c of candidates) {
    if (c.brandName.toLowerCase().includes(brandLower)) {
      return c;
    }
  }

  return null;
}

// ===== MAIN: Validate all brands =====
console.log("\n===== Validating brand→generic mappings =====\n");

const formulary = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"), "utf8"),
);

let validated = 0,
  correct = 0,
  mismatchCount = 0,
  notFound = 0;
const mismatches = [];
const corrections = []; // {drugIdx, brandStr, actualGeneric, snomedConceptId}

for (let di = 0; di < formulary.length; di++) {
  const drug = formulary[di];

  for (const brandStr of drug.brand_names || []) {
    // Parse "BrandName (Manufacturer)" from our data
    const match = brandStr.match(/^(.+?)\s*\((.+?)\)$/);
    const brandName = match ? match[1].trim() : brandStr.trim();
    const manufacturer = match ? match[2].trim() : null;

    if (brandName.length < 3) continue;
    validated++;

    const snomedMatch = findBrandedDrug(brandName, manufacturer);

    if (snomedMatch) {
      // SNOMED tells us the actual generic
      const actualGeneric = snomedMatch.generic;

      // Compare: does our generic match SNOMED's generic?
      const ourGenWords = drug.generic_name
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const snomedGenLower = (actualGeneric || "").toLowerCase();

      const isMatch = ourGenWords.some((w) => snomedGenLower.includes(w));

      if (isMatch) {
        correct++;
      } else {
        mismatchCount++;
        const genericParent = getGenericParent(snomedMatch.conceptId);
        const entry = {
          brand: brandStr,
          ourGeneric: drug.generic_name,
          snomedBrand: snomedMatch.brandName,
          snomedGeneric: actualGeneric,
          snomedFSN: snomedMatch.fsn,
          snomedManufacturer: snomedMatch.manufacturer,
          snomedConceptId: snomedMatch.conceptId,
          genericParentId: genericParent?.conceptId || null,
          genericParentName: genericParent?.term || null,
        };
        mismatches.push(entry);

        if (mismatchCount <= 30) {
          console.log(`MISMATCH: "${brandStr}"`);
          console.log(`  Our generic:    ${drug.generic_name}`);
          console.log(
            `  SNOMED says:    ${snomedMatch.brandName} = ${actualGeneric}`,
          );
          console.log(
            `  Manufacturer:   ${snomedMatch.manufacturer || "unknown"}`,
          );
          console.log(`  Generic parent: ${genericParent?.term || "none"}`);
          console.log("");
        }
      }
    } else {
      notFound++;
    }
  }
}

console.log("\n===== RESULTS =====");
console.log("Brands validated:", validated);
console.log("Correct:", correct);
console.log("TRUE mismatches:", mismatchCount);
console.log("Not found in SNOMED:", notFound);

// Save detailed mismatch report
fs.writeFileSync(
  path.join(DATA_DIR, "_brand_mismatches_v2.json"),
  JSON.stringify(mismatches, null, 2),
);
console.log("\nMismatch report saved to _brand_mismatches_v2.json");

// Summary: group mismatches by actual generic
const byGeneric = new Map();
for (const m of mismatches) {
  const key = m.snomedGeneric || "unknown";
  if (!byGeneric.has(key)) byGeneric.set(key, []);
  byGeneric.get(key).push(m);
}
console.log("\nUnique actual generics in mismatches:", byGeneric.size);
console.log("\n--- Top mismatched generics ---");
[...byGeneric.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 20)
  .forEach(([gen, brands]) => {
    console.log(`  ${gen} (${brands.length} brands):`);
    brands
      .slice(0, 3)
      .forEach((b) =>
        console.log(`    ${b.brand} → was under: ${b.ourGeneric}`),
      );
  });
