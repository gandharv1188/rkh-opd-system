#!/usr/bin/env node
/**
 * validate_standard_rx.js
 *
 * Validates drug names in standard prescriptions against the formulary.
 * Fixes clear name mismatches for actual drugs; leaves non-drug items untouched.
 *
 * Usage: node radhakishan_system/scripts/validate_standard_rx.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

// --- Load files ---
const stdRxPath = path.join(DATA_DIR, "standard_prescriptions_data.json");
const stdRxNewPath = path.join(
  DATA_DIR,
  "standard_prescriptions_data_new.json",
);

const stdRx = JSON.parse(fs.readFileSync(stdRxPath, "utf8"));
const stdRxNew = JSON.parse(fs.readFileSync(stdRxNewPath, "utf8"));
const formulary1 = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, "formulary_data_ABDM_FHIR.json"), "utf8"),
);
const formulary2 = JSON.parse(
  fs.readFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_generics.json"),
    "utf8",
  ),
);
const formulary3 = JSON.parse(
  fs.readFileSync(
    path.join(DATA_DIR, "formulary_data_ABDM_FHIR_orphans.json"),
    "utf8",
  ),
);

// --- Build formulary lookup (case-insensitive) ---
const formularyLower = new Map(); // lowercase -> original casing
for (const f of [...formulary1, ...formulary2, ...formulary3]) {
  formularyLower.set(f.generic_name.toLowerCase(), f.generic_name);
}

console.log(
  `\nFormulary: ${formularyLower.size} unique generic names across 3 files`,
);
console.log(
  `Standard Rx: ${stdRx.length} protocols (main) + ${stdRxNew.length} protocols (new)`,
);

// --- Extract all drug references ---
function extractDrugs(protocols) {
  const refs = [];
  for (const p of protocols) {
    for (const d of p.first_line_drugs || []) {
      refs.push({
        drug: d.drug,
        icd10: p.icd10,
        diagnosis: p.diagnosis_name,
        line: "first_line",
      });
    }
    for (const d of p.second_line_drugs || []) {
      refs.push({
        drug: d.drug,
        icd10: p.icd10,
        diagnosis: p.diagnosis_name,
        line: "second_line",
      });
    }
  }
  return refs;
}

const allRefs = [...extractDrugs(stdRx), ...extractDrugs(stdRxNew)];
const uniqueDrugs = [...new Set(allRefs.map((r) => r.drug))].sort();

const matched = uniqueDrugs.filter((d) => formularyLower.has(d.toLowerCase()));
const unmatched = uniqueDrugs.filter(
  (d) => !formularyLower.has(d.toLowerCase()),
);

console.log(`Total drug references: ${allRefs.length}`);
console.log(`Unique drug names: ${uniqueDrugs.length}`);
console.log(`Matched in formulary: ${matched.length}`);
console.log(`Unmatched: ${unmatched.length}\n`);

// Helper: get canonical formulary name
function F(name) {
  return formularyLower.get(name.toLowerCase());
}

// =====================================================================
// EXPLICIT DRUG NAME MAPPINGS
// Only CLEAR mismatches where the correct formulary name is obvious.
// =====================================================================
const DRUG_FIXES = {
  // --- Acetaminophen -> Paracetamol (Indian formulary uses Paracetamol) ---
  "Acetaminophen (cautious)": "Paracetamol",
  "Acetaminophen (postoperative)": "Paracetamol",
  "Acetaminophen IV": "Paracetamol",
  "Acetaminophen/Ibuprofen": "Paracetamol",

  // --- Albuterol -> Salbutamol (Albuterol) per formulary ---
  "Albuterol (salbutamol)": "Salbutamol (Albuterol)",
  "Albuterol/Salbutamol": "Salbutamol (Albuterol)",
  Salbutamol: "Salbutamol (Albuterol)",
  "Salbutamol Inhaler": "Salbutamol (Albuterol)",
  "Continuous albuterol nebulization": "Salbutamol (Albuterol)",
  "Trial of albuterol": "Salbutamol (Albuterol)",

  // --- Adrenaline -> Epinephrine (formulary has Epinephrine) ---
  "Adrenaline (Epinephrine)": "Epinephrine",

  // --- Route-qualified names -> base drug name ---
  "Aminophylline IV": "Aminophylline",
  "Ampicillin IV": "Ampicillin",
  "Ampicillin IV (inpatient)": "Ampicillin",
  "Ampicillin-sulbactam IV": "Ampicillin-sulbactam",
  "Artesunate IV": "Artesunate",
  "Artesunate IV (severe)": "Artesunate",
  "Ceftriaxone IM": "Ceftriaxone",
  "Ceftriaxone IV": "Ceftriaxone",
  "Ceftriaxone IV/IM": "Ceftriaxone",
  "Clindamycin IV": "Clindamycin",
  "Dexamethasone IV (perioperative)": "Dexamethasone",
  "Diphenhydramine IV/IM": "Diphenhydramine",
  "Epinephrine IM": "Epinephrine",
  "Epinephrine (nebulisation)": "Epinephrine",
  "Esomeprazole IV": "Esomeprazole",
  "Ganciclovir IV": "Ganciclovir",
  "Glucagon IV": "Glucagon",
  "Ibuprofen IV": "Ibuprofen",
  "Indomethacin IV": "Indomethacin",
  "Lorazepam IV": "Lorazepam",
  "Magnesium sulfate IV": "Magnesium sulfate",
  "Methylprednisolone IV": "Methylprednisolone",
  "Phenobarbital IV": "Phenobarbital",
  "Terbutaline IV": "Terbutaline",

  // --- Oral-prefixed -> base drug ---
  "Prednisolone oral": "Prednisolone",
  "Erythromycin oral": "Erythromycin",
  "Fluconazole oral": "Fluconazole",

  // --- Phenytoin/Fosphenytoin -> Phenytoin (primary drug) ---
  "Phenytoin/Fosphenytoin": "Phenytoin",

  // --- Alternating paracetamol/ibuprofen -> existing formulary entry ---
  "Alternating paracetamol and ibuprofen":
    "Alternating acetaminophen/ibuprofen",

  // --- Vitamin K variants -> formulary name ---
  "Vitamin K": "Phytonadione",
  "Vitamin K (Phytonadione)": "Phytonadione",
  "Vitamin K1 (phytonadione)": "Phytonadione",
  "Vitamin K1 (prophylaxis)": "Phytonadione",
  "Vitamin K1 (treatment)": "Phytonadione",
  "Oral Vitamin K": "Oral Vitamin K (Phytomenadione)",

  // --- Vitamin D -> formulary Cholecalciferol ---
  "Vitamin D": "Cholecalciferol",

  // --- Vitamin B12 -> formulary name ---
  "Vitamin B12 (cyanocobalamin)": "Cyanocobalamin",

  // --- Zinc (bare) -> formulary Zinc Sulfate ---
  Zinc: "Zinc Sulfate",

  // --- Nystatin variants -> Nystatin ---
  "Nystatin cream 100,000 U/g": "Nystatin",
  "Nystatin suspension": "Nystatin",

  // --- Erythromycin ophthalmic variants -> Erythromycin ---
  "Erythromycin ophthalmic": "Erythromycin",
  "Erythromycin ophthalmic ointment 0.5%": "Erythromycin",

  // --- Dexamethasone elixir -> Dexamethasone ---
  "Dexamethasone 0.5mg/5mL elixir": "Dexamethasone",

  // --- Levosalbutamol + Ambroxol -> Levosalbutamol (primary active) ---
  "Levosalbutamol + Ambroxol": "Levosalbutamol",

  // --- Clotrimazole 1% -> Clotrimazole 1% cream ---
  "Clotrimazole 1%": "Clotrimazole 1% cream",

  // --- Miconazole 2% cream -> Miconazole ---
  "Miconazole 2% cream": "Miconazole",

  // --- Ascorbic Acid -> Vitamin C ---
  "Ascorbic Acid": "Vitamin C",
};

// Validate that all target names actually exist in formulary
const invalidTargets = [];
for (const [from, to] of Object.entries(DRUG_FIXES)) {
  if (!formularyLower.has(to.toLowerCase())) {
    invalidTargets.push({ from, to });
  }
}

if (invalidTargets.length > 0) {
  console.log("WARNING: Some fix targets not found in formulary:");
  invalidTargets.forEach((t) =>
    console.log(`  "${t.from}" -> "${t.to}" (NOT IN FORMULARY)`),
  );
  // Remove invalid targets
  for (const t of invalidTargets) {
    delete DRUG_FIXES[t.from];
  }
  console.log(
    `Removed ${invalidTargets.length} invalid mappings. Continuing with valid ones.\n`,
  );
}

// Use canonical casing from formulary
for (const [from, to] of Object.entries(DRUG_FIXES)) {
  const canonical = formularyLower.get(to.toLowerCase());
  if (canonical && canonical !== to) {
    DRUG_FIXES[from] = canonical;
  }
}

// --- Classify all unmatched items ---
const fixableItems = [];
const nonDrugItems = [];
const unresolvedItems = [];

// Non-drug patterns
const NON_DRUG_PATTERNS = [
  /\bcompress/i,
  /\bsurgic/i,
  /\btherapy\b/i,
  /\bbehavior/i,
  /\bphototherapy/i,
  /\bcounsel/i,
  /\bdiet/i,
  /\bexercise/i,
  /\bphysiotherapy/i,
  /\bsplint/i,
  /\bbandage/i,
  /\bdressing/i,
  /\bobservation/i,
  /\bmonitor/i,
  /\bfollow.?up/i,
  /\breferral/i,
  /\badmission/i,
  /\btransfusion/i,
  /\bexchange\b/i,
  /\bincision/i,
  /\bdrainage/i,
  /\blavage/i,
  /\birrigation/i,
  /\bsuction/i,
  /\bintubation/i,
  /\bventilat/i,
  /\bresuscitat/i,
  /\brehydration/i,
  /\bbreastfeed/i,
  /\bformula feed/i,
  /\bsaline gargle/i,
  /\bsteam inhal/i,
  /\bsitz bath/i,
  /\belevation\b/i,
  /\bimmobili/i,
  /\btraction\b/i,
  /\bmanagement\b/i,
  /\bavoid\b/i,
  /\brestrict/i,
  /\bsupplement/i,
  /\brepair\b/i,
  /\breduction\b/i,
  /\baspiration\b/i,
  /\bcough management/i,
  /\bkarvol/i,
  /\bsurgery\b/i,
  /\boperation\b/i,
  /\bimplant\b/i,
  /\bprosthe/i,
  /\borthosis/i,
  /\bbracing/i,
  /\bcast\b/i,
  /\bscreen/i,
  /\bcatheter/i,
  /\bablation/i,
  /\bvalvuloplasty/i,
  /\bseptostomy/i,
  /\bangioplasty/i,
  /\bstent/i,
  /\bshunt/i,
  /\bcolostomy/i,
  /\bileostomy/i,
  /\bgastrostomy/i,
  /\btracheostomy/i,
  /\bcranio/i,
  /\bexploration\b/i,
  /\borchidopexy/i,
  /\bcircumcision/i,
  /\breconstruct/i,
  /\btonsillectomy/i,
  /\badenoidectomy/i,
  /\bmyringotomy/i,
  /\bcochlear/i,
  /\bhearing\b/i,
  /\bspectacle/i,
  /\bcontact lens/i,
  /\bfilter\b/i,
  /\bpatch\b.*eye/i,
  /\beye.*patch/i,
  /\bpenalization/i,
  /\bABA\b/i,
  /\bCBT\b/i,
  /\bAAC\b/i,
  /\bORS\b/,
  /\bfluids?\b/i,
  /\bhoney\b/i,
  /\bcool\s*mist/i,
  /\bhumidif/i,
  /\bcooling\b/i,
  /\bwarming\b/i,
  /\beducation\b/i,
  /\bconsult\b/i,
  /\bconsulting/i,
  /\bsupport\b/i,
  /\bcare\b/i,
  /\bsurveil/i,
  /\bscreening/i,
  /\bprotocol\b/i,
  /\bregimen\b/i,
  /\bseries\b/i,
  /\bsurvey\b/i,
  /\bthrusts?\b/i,
  /\bblows?\b/i,
  /\bcompress/i,
  /\bneedle remov/i,
  /\benema\b/i,
  /\bairway\b/i,
  /\bintervention\b/i,
  /\bCPAP\b/i,
  /\bCRRT\b/i,
  /\bHSCT\b/i,
  /\birradiation/i,
  /\bbiopsy\b/i,
  /\bexamination\b/i,
  /\bevaluation\b/i,
  /\btesting\b/i,
  /\bconfirm\b/i,
  /\boptimi[sz]/i,
  /\bBP control/i,
  /\bACE inhibitor/i,
  /\bARB\b/i,
  /\bcorticosteroid/i,
  /\bantibiotic/i,
  /\banticholinergic/i,
  /\banticoagulat/i,
  /\bbroad.?spectrum/i,
  /\boral antibiot/i,
  /\bsupplementation/i,
  /\bfortifi/i,
  /\bbreast milk/i,
  /\bcaloric\b/i,
  /\bfeeding\b/i,
  /\btoilet train/i,
  /\bsleep\b/i,
  /\bcommunication\b/i,
  /\btechnology\b/i,
  /\bassistive/i,
  /\brehabilitat/i,
  /\boccupation/i,
  /\bspeech\b/i,
  /\bdesensi/i,
  /\bimmunotherapy\b/i,
  /\bcardiac\b/i,
  /\belectrolyte\b/i,
  /\bACID suppression/i,
  /\bconservative/i,
  /\bcontralateral/i,
  /\bcorrective/i,
  /\bchest\b.*tube/i,
  /\bchest.*physiotherapy/i,
  /\bpacking\b/i,
  /\bcauteriz/i,
  /\bcorrect\b/i,
];

function isNonDrug(name) {
  return NON_DRUG_PATTERNS.some((p) => p.test(name));
}

for (const drug of unmatched) {
  if (DRUG_FIXES[drug]) {
    fixableItems.push(drug);
  } else if (isNonDrug(drug)) {
    nonDrugItems.push(drug);
  } else {
    unresolvedItems.push(drug);
  }
}

// --- Print Report ---
console.log("=".repeat(80));
console.log("VALIDATION REPORT: Standard Prescriptions vs Formulary");
console.log("=".repeat(80));

console.log(`\n--- MATCHED IN FORMULARY: ${matched.length} ---`);
// Don't print all matched to keep output manageable

console.log(
  `\n--- DRUG NAME FIXES TO APPLY: ${fixableItems.length} unique names ---`,
);
for (const drug of fixableItems.sort()) {
  const count = allRefs.filter((r) => r.drug === drug).length;
  console.log(
    `  "${drug}" -> "${DRUG_FIXES[drug]}"  (${count} occurrence${count > 1 ? "s" : ""})`,
  );
}

console.log(`\n--- NON-DRUG ITEMS (left as-is): ${nonDrugItems.length} ---`);
for (const drug of nonDrugItems.sort()) {
  const count = allRefs.filter((r) => r.drug === drug).length;
  console.log(`  [SKIP] ${drug}  (${count} ref${count > 1 ? "s" : ""})`);
}

console.log(`\n--- UNRESOLVED (left as-is): ${unresolvedItems.length} ---`);
for (const drug of unresolvedItems.sort()) {
  const count = allRefs.filter((r) => r.drug === drug).length;
  console.log(`  [?] ${drug}  (${count} ref${count > 1 ? "s" : ""})`);
}

// --- Apply fixes to data ---
function applyFixes(protocols) {
  let count = 0;
  for (const p of protocols) {
    for (const d of p.first_line_drugs || []) {
      if (DRUG_FIXES[d.drug]) {
        d.drug = DRUG_FIXES[d.drug];
        count++;
      }
    }
    for (const d of p.second_line_drugs || []) {
      if (DRUG_FIXES[d.drug]) {
        d.drug = DRUG_FIXES[d.drug];
        count++;
      }
    }
  }
  return count;
}

const fixedMain = applyFixes(stdRx);
const fixedNew = applyFixes(stdRxNew);
const fixCount = fixedMain + fixedNew;

if (fixCount > 0) {
  fs.writeFileSync(stdRxPath, JSON.stringify(stdRx, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    stdRxNewPath,
    JSON.stringify(stdRxNew, null, 2) + "\n",
    "utf8",
  );
  console.log(
    `\n--- APPLIED ${fixCount} fixes (${fixedMain} in main, ${fixedNew} in new) ---`,
  );
  console.log("Files updated:");
  console.log(`  - ${stdRxPath}`);
  console.log(`  - ${stdRxNewPath}`);
} else {
  console.log("\nNo fixes to apply.");
}

// --- Post-fix validation ---
console.log("\n--- POST-FIX VALIDATION ---");
const allRefsAfter = [...extractDrugs(stdRx), ...extractDrugs(stdRxNew)];
const uniqueAfter = [...new Set(allRefsAfter.map((r) => r.drug))];
const matchedAfter = uniqueAfter.filter((d) =>
  formularyLower.has(d.toLowerCase()),
).length;
const unmatchedAfter = uniqueAfter.length - matchedAfter;
console.log(`  Unique drug names: ${uniqueAfter.length}`);
console.log(`  Matched: ${matchedAfter}`);
console.log(
  `  Unmatched: ${unmatchedAfter} (non-drugs + drugs not in formulary)`,
);
console.log(
  `  Match rate: ${((matchedAfter / uniqueAfter.length) * 100).toFixed(1)}%`,
);
console.log("\nDone.");
