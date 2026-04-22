/**
 * Combine standard prescription data from all sources into one file
 * with the full schema (including enriched fields).
 *
 * Sources:
 *   1. standard_prescriptions_data_new.json (24 protocols — older format)
 *   2. docs/Standard Diagnosis/*.json (55 protocols — new enriched format)
 *
 * Output:
 *   standard_prescriptions_combined.json
 *
 * Schema normalization:
 *   - source: string → kept as-is (DB accepts text)
 *   - Adds missing fields with null defaults
 *   - severity_assessment: object {mild, moderate, severe} or null
 *   - monitoring_parameters: array [{parameter, frequency}] or null
 *   - key_clinical_points: array of strings or null
 *   - expected_course: string or null
 *   - snomed_display: null (can be populated later)
 *
 * Dedup: by icd10 code. If same ICD-10 exists in both sources,
 *   the new enriched version wins (has more data).
 *
 * Usage: node combine_standard_rx.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DIAG_DIR = path.join(__dirname, "..", "docs", "Standard Diagnosis");

// Full schema with defaults
function normalize(d) {
  return {
    icd10: d.icd10 || null,
    diagnosis_name: d.diagnosis_name || null,
    category: d.category || "Uncategorized",
    severity: d.severity || "any",
    first_line_drugs: d.first_line_drugs || [],
    second_line_drugs: d.second_line_drugs || [],
    investigations: d.investigations || [],
    counselling: d.counselling || [],
    warning_signs: d.warning_signs || [],
    referral_criteria: d.referral_criteria || null,
    hospitalisation_criteria: d.hospitalisation_criteria || null,
    notes: d.notes || null,
    source: d.source || null,
    duration_days_default: d.duration_days_default || null,
    guideline_changes: d.guideline_changes || null,
    snomed_code: d.snomed_code || null,
    snomed_display: d.snomed_display || null,
    expected_course: d.expected_course || null,
    key_clinical_points: d.key_clinical_points || null,
    severity_assessment: d.severity_assessment || null,
    monitoring_parameters: d.monitoring_parameters || null,
    active: d.active !== undefined ? d.active : true,
  };
}

// Load source 1: original data file (446 protocols)
const origFile = path.join(DATA_DIR, "standard_prescriptions_data.json");
let origData = [];
if (fs.existsSync(origFile)) {
  origData = JSON.parse(fs.readFileSync(origFile, "utf8"));
  console.log("Source 1 (original):", origData.length, "protocols");
}

// Load source 2: newer batch (24 protocols)
const oldFile = path.join(DATA_DIR, "standard_prescriptions_data_new.json");
let oldData = [];
if (fs.existsSync(oldFile)) {
  oldData = JSON.parse(fs.readFileSync(oldFile, "utf8"));
  console.log("Source 2 (new batch):", oldData.length, "protocols");
}

// Load source 2: new enriched JSON files
let newData = [];
if (fs.existsSync(DIAG_DIR)) {
  const files = fs.readdirSync(DIAG_DIR).filter((f) => f.endsWith(".json"));
  files.forEach((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DIAG_DIR, f), "utf8"));
      // If diagnosis_name is missing, derive from filename
      if (!d.diagnosis_name) {
        d.diagnosis_name = f
          .replace(/\.json$/, "")
          .replace(/_/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      d._source_file = f;
      newData.push(d);
    } catch (e) {
      console.warn("  SKIP (parse error):", f, "-", e.message.substring(0, 60));
    }
  });
  console.log("Source 2 (new files):", newData.length, "protocols");
}

// Merge priority: enriched JSON files (55) > new batch (24) > original (446)
// The 55 enriched files are the latest and should REPLACE any duplicates
const combined = new Map();

// Add original data first (lowest priority)
origData.forEach((d) => {
  const key = (d.icd10 || d.diagnosis_name || "").toUpperCase();
  combined.set(key, normalize(d));
});
console.log("After source 1:", combined.size, "protocols");

// Add new batch (medium priority — overwrites original if same ICD-10)
oldData.forEach((d) => {
  const key = (d.icd10 || d.diagnosis_name || "").toUpperCase();
  combined.set(key, normalize(d));
});

console.log("After source 2:", combined.size, "protocols");

// Add enriched JSON files (HIGHEST priority — these are the latest, replace any duplicates)
newData.forEach((d) => {
  const key = (d.icd10 || d.diagnosis_name || "").toUpperCase();

  // Also check if an existing entry matches by diagnosis name (for protocols without ICD-10)
  let existingKey = null;
  if (combined.has(key)) {
    existingKey = key;
  } else if (d.diagnosis_name) {
    // Search by diagnosis name similarity
    for (const [k, v] of combined.entries()) {
      if (
        v.diagnosis_name &&
        v.diagnosis_name
          .toUpperCase()
          .includes(d.diagnosis_name.toUpperCase().substring(0, 20))
      ) {
        existingKey = k;
        break;
      }
    }
  }

  const existing = existingKey ? combined.get(existingKey) : null;

  if (existing) {
    // Enriched file REPLACES the old entry, but preserve any old data for fields the new doesn't have
    const merged = normalize(d);
    if (!merged.second_line_drugs.length && existing.second_line_drugs.length) {
      merged.second_line_drugs = existing.second_line_drugs;
    }
    if (!merged.guideline_changes && existing.guideline_changes) {
      merged.guideline_changes = existing.guideline_changes;
    }
    if (!merged.snomed_code && existing.snomed_code) {
      merged.snomed_code = existing.snomed_code;
    }
    // Remove old key if different from new key
    if (existingKey !== key) combined.delete(existingKey);
    combined.set(key, merged);
    console.log(
      "  REPLACED:",
      existingKey,
      "->",
      key,
      "(" + (d._source_file || d.diagnosis_name) + ")",
    );
  } else {
    combined.set(key, normalize(d));
  }
});

const result = Array.from(combined.values()).sort((a, b) => {
  // Sort by ICD-10 code, nulls last
  if (!a.icd10 && !b.icd10)
    return (a.diagnosis_name || "").localeCompare(b.diagnosis_name || "");
  if (!a.icd10) return 1;
  if (!b.icd10) return -1;
  return a.icd10.localeCompare(b.icd10);
});

// Write combined file
const outFile = path.join(DATA_DIR, "standard_prescriptions_combined.json");
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

console.log();
console.log("=== COMBINED RESULT ===");
console.log("Total protocols:", result.length);
console.log(
  "From old file only:",
  result.filter(
    (d) =>
      !newData.some(
        (n) => (n.icd10 || n.diagnosis_name) === (d.icd10 || d.diagnosis_name),
      ),
  ).length,
);
console.log("From new files:", newData.length);
console.log(
  "Merged (both sources):",
  oldData.filter((o) =>
    newData.some((n) => (n.icd10 || "") === (o.icd10 || "") && o.icd10),
  ).length,
);
console.log();

// Stats
const withSnomed = result.filter((d) => d.snomed_code).length;
const withSeverity = result.filter((d) => d.severity_assessment).length;
const withMonitoring = result.filter(
  (d) => d.monitoring_parameters && d.monitoring_parameters.length,
).length;
const withExpected = result.filter((d) => d.expected_course).length;
const withKeyPoints = result.filter(
  (d) => d.key_clinical_points && d.key_clinical_points.length,
).length;
const withWarnings = result.filter(
  (d) => d.warning_signs && d.warning_signs.length,
).length;
const withHindi = result.filter((d) =>
  (d.counselling || []).some((c) => /[\u0900-\u097F]/.test(c)),
).length;

console.log("SNOMED codes:", withSnomed + "/" + result.length);
console.log("severity_assessment:", withSeverity + "/" + result.length);
console.log("monitoring_parameters:", withMonitoring + "/" + result.length);
console.log("expected_course:", withExpected + "/" + result.length);
console.log("key_clinical_points:", withKeyPoints + "/" + result.length);
console.log("warning_signs:", withWarnings + "/" + result.length);
console.log("Hindi counselling:", withHindi + "/" + result.length);
console.log();
console.log("Output:", outFile);
