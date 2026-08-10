#!/usr/bin/env node
/**
 * Export standard_prescriptions_combined.json to Excel for doctor review.
 * Output: radhakishan_system/data/standard_prescriptions_review.xlsx
 */
const XLSX = require("xlsx");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const protocols = require(
  path.join(dataDir, "standard_prescriptions_combined.json"),
);

// Format drug list: "DrugName — notes [NEW]"
function fmtDrugs(arr) {
  if (!arr || !arr.length) return "";
  return arr
    .map((d) => {
      let s = d.drug;
      if (d.notes) s += " — " + d.notes;
      if (d.is_new_2024_2025) s += " [NEW 2024-25]";
      return s;
    })
    .join("\n");
}

// Format investigations
function fmtInvestigations(arr) {
  if (!arr || !arr.length) return "";
  return arr
    .map((i) => {
      let s = i.name;
      if (i.indication) s += " — " + i.indication;
      if (i.urgency && i.urgency !== "routine")
        s += " [" + i.urgency.toUpperCase() + "]";
      return s;
    })
    .join("\n");
}

// Format array to newline-separated
function fmtList(arr) {
  if (!arr || !arr.length) return "";
  return arr.join("\n");
}

// Build rows
const rows = protocols.map((p, idx) => ({
  "#": idx + 1,
  "ICD-10": p.icd10,
  SNOMED: p.snomed_code || "",
  Diagnosis: p.diagnosis_name,
  Category: p.category || "",
  Severity: p.severity || "",
  "First-Line Drugs": fmtDrugs(p.first_line_drugs),
  "Second-Line Drugs": fmtDrugs(p.second_line_drugs),
  Investigations: fmtInvestigations(p.investigations),
  Counselling: fmtList(p.counselling),
  "Warning Signs": fmtList(p.warning_signs),
  "Referral Criteria": p.referral_criteria || "",
  "Hospitalisation Criteria": p.hospitalisation_criteria || "",
  "Duration (days)": p.duration_days_default || "",
  Notes: p.notes || "",
  "Guideline Changes": p.guideline_changes || "",
  Source: p.source || "",
  Active: p.active ? "Yes" : "No",
}));

// Create workbook
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);

// Column widths
ws["!cols"] = [
  { wch: 4 }, // #
  { wch: 8 }, // ICD-10
  { wch: 10 }, // SNOMED
  { wch: 35 }, // Diagnosis
  { wch: 14 }, // Category
  { wch: 10 }, // Severity
  { wch: 60 }, // First-Line
  { wch: 60 }, // Second-Line
  { wch: 55 }, // Investigations
  { wch: 55 }, // Counselling
  { wch: 40 }, // Warning Signs
  { wch: 45 }, // Referral
  { wch: 45 }, // Hospitalisation
  { wch: 10 }, // Duration
  { wch: 50 }, // Notes
  { wch: 40 }, // Guideline Changes
  { wch: 20 }, // Source
  { wch: 6 }, // Active
];

XLSX.utils.book_append_sheet(wb, ws, "Standard Protocols");

// Category summary sheet
const categories = {};
protocols.forEach((p) => {
  const cat = p.category || "Uncategorized";
  categories[cat] = (categories[cat] || 0) + 1;
});
const catRows = Object.entries(categories)
  .sort((a, b) => b[1] - a[1])
  .map(([cat, count]) => ({ Category: cat, "Protocol Count": count }));
catRows.push({ Category: "TOTAL", "Protocol Count": protocols.length });

const wsCat = XLSX.utils.json_to_sheet(catRows);
wsCat["!cols"] = [{ wch: 25 }, { wch: 15 }];
XLSX.utils.book_append_sheet(wb, wsCat, "Category Summary");

const outPath = path.join(dataDir, "standard_prescriptions_review.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Exported ${protocols.length} protocols to:\n${outPath}`);
