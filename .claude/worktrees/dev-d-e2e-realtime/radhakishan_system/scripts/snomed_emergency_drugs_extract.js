#!/usr/bin/env node
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
const FORMULARY = path.join(
  "radhakishan_system",
  "data",
  "formulary_data_ABDM_FHIR.json",
);

console.log("Loading...");
const allNames = new Map();
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
    if (c[6] === "900000000000013009") allNames.set(c[4], c[7]);
    else if (!allNames.has(c[4]))
      allNames.set(c[4], c[7].replace(/\s*\([^)]+\)\s*$/, ""));
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

function getName(cid) {
  return allNames.get(cid) || cid;
}

function extractDrug(cid) {
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
  };
}

// Define emergency drug searches with their generic names and categories
const EMERGENCY_DRUGS = [
  {
    search: "dopamine.*injection|dopamine.*infusion",
    generic: "DOPAMINE INJECTION",
    category: "Emergency",
    drugClass: "Vasopressor / Inotrope",
  },
  {
    search: "dobutamine.*injection",
    generic: "DOBUTAMINE INJECTION",
    category: "Emergency",
    drugClass: "Inotrope",
  },
  {
    search: "epinephrine.*injection|adrenaline.*injection",
    generic: "EPINEPHRINE (ADRENALINE) INJECTION",
    category: "Emergency",
    drugClass: "Vasopressor / Sympathomimetic",
  },
  {
    search: "norepinephrine.*injection|noradrenaline.*injection",
    generic: "NOREPINEPHRINE (NORADRENALINE) INJECTION",
    category: "Emergency",
    drugClass: "Vasopressor",
  },
  {
    search: "milrinone.*injection",
    generic: "MILRINONE INJECTION",
    category: "Emergency",
    drugClass: "Phosphodiesterase-3 inhibitor / Inodilator",
  },
  {
    search: "phenylephrine.*injection",
    generic: "PHENYLEPHRINE INJECTION",
    category: "Emergency",
    drugClass: "Alpha-1 agonist / Vasopressor",
  },
  {
    search: "atropine.*injection",
    generic: "ATROPINE INJECTION",
    category: "Emergency",
    drugClass: "Anticholinergic",
  },
  {
    search: "adenosine.*injection",
    generic: "ADENOSINE INJECTION",
    category: "Emergency",
    drugClass: "Antiarrhythmic",
  },
  {
    search: "amiodarone.*injection",
    generic: "AMIODARONE INJECTION",
    category: "Emergency",
    drugClass: "Antiarrhythmic (Class III)",
  },
  {
    search: "lidocaine.*injection",
    generic: "LIDOCAINE (LIGNOCAINE) INJECTION",
    category: "Emergency",
    drugClass: "Local anaesthetic / Antiarrhythmic",
  },
  {
    search: "naloxone.*injection",
    generic: "NALOXONE INJECTION",
    category: "Emergency",
    drugClass: "Opioid antagonist",
  },
  {
    search: "alprostadil.*injection",
    generic: "ALPROSTADIL (PROSTAGLANDIN E1) INJECTION",
    category: "Neonatology",
    drugClass: "Prostaglandin E1 analogue",
  },
  {
    search: "sodium nitroprusside|nitroprusside.*injection",
    generic: "SODIUM NITROPRUSSIDE INJECTION",
    category: "Emergency",
    drugClass: "Vasodilator",
  },
  {
    search: "dexmedetomidine.*injection|dexmedetomidine.*infusion",
    generic: "DEXMEDETOMIDINE INJECTION",
    category: "Anaesthesia",
    drugClass: "Alpha-2 agonist / Sedative",
  },
  {
    search: "midazolam.*injection",
    generic: "MIDAZOLAM INJECTION",
    category: "Anaesthesia",
    drugClass: "Benzodiazepine / Sedative",
  },
  {
    search: "ketamine.*injection",
    generic: "KETAMINE INJECTION",
    category: "Anaesthesia",
    drugClass: "Dissociative anaesthetic",
  },
  {
    search: "propofol.*injection|propofol.*emulsion",
    generic: "PROPOFOL INJECTION",
    category: "Anaesthesia",
    drugClass: "General anaesthetic",
  },
  {
    search: "rocuronium.*injection",
    generic: "ROCURONIUM INJECTION",
    category: "Anaesthesia",
    drugClass: "Non-depolarizing neuromuscular blocker",
  },
  {
    search: "vecuronium.*injection",
    generic: "VECURONIUM INJECTION",
    category: "Anaesthesia",
    drugClass: "Non-depolarizing neuromuscular blocker",
  },
  {
    search: "succinylcholine.*injection|suxamethonium",
    generic: "SUCCINYLCHOLINE (SUXAMETHONIUM) INJECTION",
    category: "Anaesthesia",
    drugClass: "Depolarizing neuromuscular blocker",
  },
  {
    search: "neostigmine.*injection",
    generic: "NEOSTIGMINE INJECTION",
    category: "Anaesthesia",
    drugClass: "Anticholinesterase / Reversal agent",
  },
  {
    search: "esmolol.*injection",
    generic: "ESMOLOL INJECTION",
    category: "Emergency",
    drugClass: "Ultra-short-acting beta blocker",
  },
  {
    search: "labetalol.*injection",
    generic: "LABETALOL INJECTION",
    category: "Emergency",
    drugClass: "Alpha + Beta blocker / Antihypertensive",
  },
  {
    search: "hydralazine.*injection",
    generic: "HYDRALAZINE INJECTION",
    category: "Emergency",
    drugClass: "Direct vasodilator / Antihypertensive",
  },
  {
    search: "calcium chloride.*injection",
    generic: "CALCIUM CHLORIDE INJECTION",
    category: "Emergency",
    drugClass: "Electrolyte / Calcium supplement",
  },
];

console.log("Finding emergency drugs...");
const indiaDescs = fs
  .readFileSync(
    path.join(
      INDIA_BASE,
      "sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt",
    ),
    "utf8",
  )
  .split("\n");

const newDrugs = [];

for (const def of EMERGENCY_DRUGS) {
  const regex = new RegExp(def.search, "i");
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
    if (regex.test(tl)) matches.push({ cid: c[4], fsn: c[7] });
  }

  if (!matches.length) continue;

  const formMap = new Map();
  for (const m of matches) {
    const info = extractDrug(m.cid);
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

  newDrugs.push({
    generic_name: def.generic,
    snomed_code: matches[0].cid,
    drug_class: def.drugClass,
    category: def.category,
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
}

console.log("\nEmergency drug entries:", newDrugs.length);
newDrugs.forEach((d) => {
  const bc = d.formulations.reduce((s, f) => s + f.indian_brands.length, 0);
  console.log(
    "  " +
      d.generic_name +
      ": " +
      d.formulations.length +
      " formulations, " +
      bc +
      " brands",
  );
});

const formulary = JSON.parse(fs.readFileSync(FORMULARY, "utf8"));
const existing = new Set(formulary.map((d) => d.generic_name.toUpperCase()));
let added = 0,
  skipped = 0;
for (const drug of newDrugs) {
  if (existing.has(drug.generic_name.toUpperCase())) {
    skipped++;
    continue;
  }
  formulary.push(drug);
  added++;
}
fs.writeFileSync(FORMULARY, JSON.stringify(formulary, null, 2));
console.log(
  "\nAdded:",
  added,
  "| Skipped (exists):",
  skipped,
  "| Total now:",
  formulary.length,
);
