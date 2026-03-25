/**
 * Apply dosing data from agents 1, 2, and 4 to the v3 formulary file.
 * Agents 3 and 5 already applied their changes directly.
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "formulary_data_ABDM_FHIR_v3.json");
const drugs = JSON.parse(fs.readFileSync(FILE, "utf8"));

const allUpdates = [
  // ═══ AGENT 1: Anti-infectives ═══
  { generic_name: "Abacavir/Lamivudine", updates: [
    { ingredient: "3TC", dose_min_qty: 5, dose_max_qty: 5, dose_unit: "mg/kg/dose", max_single_mg: 150, max_daily_mg: 300, source: "NIH Pediatric ARV Guidelines: 5 mg/kg/dose BID" }
  ]},
  { generic_name: "Cefazolin", updates: [
    { ingredient: "INH", dose_min_qty: 10, dose_max_qty: 15, dose_unit: "mg/kg/day", max_single_mg: 300, max_daily_mg: 300, source: "WHO TB Guidelines 2022; AAP Red Book 2024" }
  ]},
  { generic_name: "Lopinavir/Ritonavir", updates: [
    { ingredient: "Lopinavir", dose_min_qty: 10, dose_max_qty: 16, dose_unit: "mg/kg/dose", max_single_mg: 400, max_daily_mg: 800, source: "FDA Kaletra label; NIH Pediatric ARV Guidelines" }
  ]},
  { generic_name: "Piperacillin-tazobactam", updates: [
    { ingredient: "Tazobactam", dose_min_qty: 37.5, dose_max_qty: 50, dose_unit: "mg/kg/day", max_single_mg: 500, max_daily_mg: 2000, source: "Harriet Lane 23e; FDA Zosyn label. Fixed 8:1 ratio" }
  ]},
  { generic_name: "CEFOPERAZONE+SULBACTAM", updates: [
    { ingredient: "Sulbactam", dose_min_qty: 20, dose_max_qty: 40, dose_unit: "mg/kg/day", max_single_mg: 1000, max_daily_mg: 4000, source: "Pfizer Magnex label. Fixed 1:1 ratio" }
  ]},
  { generic_name: "Ampicillin-sulbactam", updates: [
    { ingredient: "Sulbactam", dose_min_qty: 50, dose_max_qty: 100, dose_unit: "mg/kg/day", max_single_mg: 1000, max_daily_mg: 4000, source: "Pfizer Unasyn label; Harriet Lane 23e. Fixed 2:1 ratio" }
  ]},
  { generic_name: "Sofosbuvir/Velpatasvir", updates: [
    { ingredient: "Velpatasvir", dose_min_qty: 37.5, dose_max_qty: 100, dose_unit: "mg/dose", max_single_mg: 100, max_daily_mg: 100, source: "FDA Epclusa label. <17kg:37.5mg, 17-30kg:50mg, >=30kg:100mg" }
  ]},
  { generic_name: "HEPATITIS-B VACCINE", updates: [
    { ingredient: "Aluminum hydroxide", dose_min_qty: null, dose_max_qty: null, dose_unit: "excipient", max_single_mg: null, max_daily_mg: null, source: "Adjuvant - fixed with antigen dose" },
    { ingredient: "Merthiolate", dose_min_qty: null, dose_max_qty: null, dose_unit: "excipient", max_single_mg: null, max_daily_mg: null, source: "Preservative - fixed with antigen dose" }
  ]},

  // ═══ AGENT 2: Emergency/ICU ═══
  { generic_name: "Dextrose 10%", updates: [
    { ingredient: "Dextrose", dose_min_qty: 4, dose_max_qty: 6, dose_unit: "mg/kg/min", max_single_mg: null, max_daily_mg: null, source: "Nelson 22e; NRP/AAP. GIR 4-6 initially, up to 12" }
  ]},
  { generic_name: "Lipid Emulsion 20%", updates: [
    { ingredient: "Egg phospholipid", dose_min_qty: null, dose_max_qty: null, dose_unit: "excipient", max_single_mg: null, max_daily_mg: null, source: "FDA Intralipid label. Emulsifier 1.2% w/v" },
    { ingredient: "1,2,3-propanetriol", dose_min_qty: null, dose_max_qty: null, dose_unit: "excipient", max_single_mg: null, max_daily_mg: null, source: "FDA Intralipid label. Glycerol isotonicity agent" }
  ]},
  { generic_name: "Silver Sulfadiazine 1%", updates: [
    { ingredient: "Silver sulfadiazine", dose_min_qty: 1, dose_max_qty: 2, dose_unit: "application/day", max_single_mg: null, max_daily_mg: null, source: "FDA Silvadene label; BNFC. CI neonates <2mo" }
  ]},
  { generic_name: "SODIUM CHLORIDE 0.9% (NORMAL SALINE)", updates: [
    { ingredient: "Tinidazole", dose_min_qty: null, dose_max_qty: null, dose_unit: "data_error", max_single_mg: null, max_daily_mg: null, source: "DATA ERROR - not a constituent of Normal Saline" },
    { ingredient: "Disodium phosphate", dose_min_qty: null, dose_max_qty: null, dose_unit: "data_error", max_single_mg: null, max_daily_mg: null, source: "DATA ERROR - not a constituent of Normal Saline" },
    { ingredient: "Dibasic sodium phosphate", dose_min_qty: null, dose_max_qty: null, dose_unit: "data_error", max_single_mg: null, max_daily_mg: null, source: "DATA ERROR - not a constituent of Normal Saline" }
  ]},
  { generic_name: "DEXTROSE + SODIUM CHLORIDE (DNS)", updates: [
    { ingredient: "Dextrose", dose_min_qty: 4, dose_max_qty: 8, dose_unit: "mg/kg/min", max_single_mg: null, max_daily_mg: null, source: "Nelson 22e; Harriet Lane 23e. GIR target" }
  ]},
  { generic_name: "EPINEPHRINE (ADRENALINE) INJECTION", updates: [
    { ingredient: "Lignocaine", dose_min_qty: 4.5, dose_max_qty: 7, dose_unit: "mg/kg", max_single_mg: 500, max_daily_mg: 500, source: "AAPD Guidelines; FDA Xylocaine label. Max 7mg/kg with epi" }
  ]},
  { generic_name: "LIDOCAINE (LIGNOCAINE) INJECTION", updates: [
    { ingredient: "Dextrose", dose_min_qty: null, dose_max_qty: null, dose_unit: "vehicle", max_single_mg: null, max_daily_mg: null, source: "Harriet Lane 23e. D5W is IV vehicle" }
  ]},
  { generic_name: "SODIUM CHLORIDE+DEXTROSE", updates: [
    { ingredient: "Calcium chloride", dose_min_qty: 0.5, dose_max_qty: 1, dose_unit: "mEq/kg/day", max_single_mg: null, max_daily_mg: null, source: "Nelson 22e; Harriet Lane 23e" },
    { ingredient: "Potassium chloride", dose_min_qty: 1, dose_max_qty: 2, dose_unit: "mEq/kg/day", max_single_mg: null, max_daily_mg: null, source: "Holliday-Segar; Nelson 22e" },
    { ingredient: "Magnesium chloride", dose_min_qty: 0.25, dose_max_qty: 0.5, dose_unit: "mEq/kg/day", max_single_mg: null, max_daily_mg: null, source: "Nelson 22e; Harriet Lane 23e" },
    { ingredient: "Dextrose", dose_min_qty: 4, dose_max_qty: 8, dose_unit: "mg/kg/min", max_single_mg: null, max_daily_mg: null, source: "GIR-based dosing" }
  ]},
  { generic_name: "Potassium citrate", updates: [
    { ingredient: "Citric acid monohydrate", dose_min_qty: null, dose_max_qty: null, dose_unit: "vehicle", max_single_mg: null, max_daily_mg: null, source: "FDA Polycitra label. Buffer, not independently dosed" }
  ]},
  { generic_name: "CALCIUM+VITAMIN D3", updates: [
    { ingredient: "Prepared chalk", dose_min_qty: 500, dose_max_qty: 500, dose_unit: "mg/dose", max_single_mg: 500, max_daily_mg: 1500, source: "Indian Pharmacopoeia. Prepared chalk IS calcium carbonate" }
  ]},

  // ═══ AGENT 4: Analgesic/GI/Resp ═══
  { generic_name: "IBUPROFEN+PARACETAMOL", updates: [
    { ingredient: "Paracetamol", dose_min_qty: 10, dose_max_qty: 15, dose_unit: "mg/kg/dose", max_single_mg: 1000, max_daily_mg: 4000, source: "Harriet Lane 23e; BNFC. Max 75mg/kg/day or 4g/day" }
  ]},
  { generic_name: "MEFENAMIC ACID+PARACETAMOL", updates: [
    { ingredient: "Paracetamol", dose_min_qty: 10, dose_max_qty: 15, dose_unit: "mg/kg/dose", max_single_mg: 1000, max_daily_mg: 4000, source: "Harriet Lane 23e; BNFC" },
    { ingredient: "Scopolamine butylbromide", dose_min_qty: 0.3, dose_max_qty: 0.6, dose_unit: "mg/kg/dose", max_single_mg: 20, max_daily_mg: 60, source: "BNFC; Harriet Lane 23e" }
  ]},
  { generic_name: "ACECLOFENAC+PARACETAMOL+SERRATIOPEPTIDASE", updates: [
    { ingredient: "Aceclofenac", dose_min_qty: null, dose_max_qty: null, dose_unit: "not recommended <18yr", max_single_mg: null, max_daily_mg: null, source: "No established pediatric dosing" },
    { ingredient: "Serratiopeptidase", dose_min_qty: null, dose_max_qty: null, dose_unit: "no EBM dosing", max_single_mg: null, max_daily_mg: null, source: "Enzyme supplement, no pharmacopeial monograph" }
  ]},
  { generic_name: "Dextromethorphan", updates: [
    { ingredient: "Phenylephrine hydrochloride", dose_min_qty: 0.15, dose_max_qty: 0.25, dose_unit: "mg/kg/dose", max_single_mg: 10, max_daily_mg: 40, source: "FDA OTC Monograph; Harriet Lane 23e" },
    { ingredient: "Chlorpheniramine maleate", dose_min_qty: 0.09, dose_max_qty: 0.12, dose_unit: "mg/kg/dose", max_single_mg: 4, max_daily_mg: 24, source: "Harriet Lane 23e: 0.35mg/kg/day div Q4-6h" }
  ]},
  { generic_name: "Diphenhydramine", updates: [
    { ingredient: "Alpha-glyceryl guaiacol ether", dose_min_qty: 2.5, dose_max_qty: 5, dose_unit: "mg/kg/dose", max_single_mg: 400, max_daily_mg: 2400, source: "Harriet Lane 23e; FDA OTC Monograph. Guaifenesin" }
  ]},
  { generic_name: "THEOPHYLLINE+ETOPHYLLINE", updates: [
    { ingredient: "Etofylline", dose_min_qty: null, dose_max_qty: null, dose_unit: "proportional (fixed FDC ratio)", max_single_mg: null, max_daily_mg: null, source: "No independent PK. Dose governed by theophylline. 3:1 ratio" }
  ]},
  { generic_name: "ANTACID (ALUMINIUM HYDROXIDE+MAGNESIUM HYDROXIDE+SIMETHICONE)", updates: [
    { ingredient: "Activated dimeticone", dose_min_qty: 20, dose_max_qty: 40, dose_unit: "mg/dose", max_single_mg: 125, max_daily_mg: 500, source: "Harriet Lane 23e. Simethicone" },
    { ingredient: "Carmellose sodium", dose_min_qty: null, dose_max_qty: null, dose_unit: "excipient", max_single_mg: null, max_daily_mg: null, source: "Suspending agent" },
    { ingredient: "Dried aluminium hydroxide gel", dose_min_qty: null, dose_max_qty: null, dose_unit: "component (combination mL)", max_single_mg: null, max_daily_mg: null, source: "Harriet Lane 23e. 0.5-1mL/kg/dose as combination" }
  ]},
  { generic_name: "SIMETHICONE+DILL OIL+FENNEL OIL", updates: [
    { ingredient: "Activated dimeticone", dose_min_qty: 20, dose_max_qty: 40, dose_unit: "mg/dose", max_single_mg: 40, max_daily_mg: 240, source: "Harriet Lane 23e. Infant colic" },
    { ingredient: "Fennel oil", dose_min_qty: null, dose_max_qty: null, dose_unit: "traditional", max_single_mg: null, max_daily_mg: null, source: "No EBM dosing. Traditional/herbal" },
    { ingredient: "Oil of dill", dose_min_qty: null, dose_max_qty: null, dose_unit: "traditional", max_single_mg: null, max_daily_mg: null, source: "No EBM dosing. Traditional/herbal" },
    { ingredient: "Furazolidone", dose_min_qty: null, dose_max_qty: null, dose_unit: "data_error", max_single_mg: null, max_daily_mg: null, source: "DATA ERROR - does not belong in colic drops" },
    { ingredient: "Domperidone", dose_min_qty: null, dose_max_qty: null, dose_unit: "data_error", max_single_mg: null, max_daily_mg: null, source: "DATA ERROR - does not belong in colic drops" },
    { ingredient: "Magaldrate", dose_min_qty: null, dose_max_qty: null, dose_unit: "data_error", max_single_mg: null, max_daily_mg: null, source: "DATA ERROR - does not belong in colic drops" }
  ]},
  { generic_name: "Vitamin E", updates: [
    { ingredient: "L-carnitine", dose_min_qty: 50, dose_max_qty: 100, dose_unit: "mg/kg/day", max_single_mg: 1000, max_daily_mg: 3000, source: "Harriet Lane 23e; Nelson 22e. For carnitine deficiency" }
  ]},
  { generic_name: "CAMPHOR + CHLOROTHYMOL + EUCALYPTOL + MENTHOL + TERPINEOL (DECONGESTANT INHALATION)", updates: [
    { ingredient: "Chlorothymol", dose_min_qty: null, dose_max_qty: null, dose_unit: "inhalation capsule component", max_single_mg: null, max_daily_mg: null, source: "Volatile oil - dose is per capsule" },
    { ingredient: "Eucalyptol", dose_min_qty: null, dose_max_qty: null, dose_unit: "inhalation capsule component", max_single_mg: null, max_daily_mg: null, source: "Volatile oil - dose is per capsule" },
    { ingredient: "Menthol", dose_min_qty: null, dose_max_qty: null, dose_unit: "inhalation capsule component", max_single_mg: null, max_daily_mg: null, source: "Volatile oil. CAUTION: avoid <3mo (apnea risk)" },
    { ingredient: "Terpineol", dose_min_qty: null, dose_max_qty: null, dose_unit: "inhalation capsule component", max_single_mg: null, max_daily_mg: null, source: "Volatile oil - dose is per capsule" }
  ]},
];

// Apply updates
let applied = 0, notFound = 0;

allUpdates.forEach(u => {
  const drug = drugs.find(d => d.generic_name === u.generic_name);
  if (!drug) {
    console.log("NOT FOUND:", u.generic_name);
    notFound++;
    return;
  }

  u.updates.forEach(upd => {
    let matched = false;
    (drug.dosing_bands || []).forEach(b => {
      (b.ingredient_doses || []).forEach(id => {
        const idName = (id.ingredient || "").toLowerCase();
        const updName = (upd.ingredient || "").toLowerCase();
        if (idName.includes(updName) || updName.includes(idName)) {
          // Only update if currently null (don't overwrite agent 3/5 data)
          if (id.source == null) {
            id.dose_min_qty = upd.dose_min_qty;
            id.dose_max_qty = upd.dose_max_qty;
            id.dose_unit = upd.dose_unit;
            id.max_single_mg = upd.max_single_mg;
            id.max_daily_mg = upd.max_daily_mg;
            id.source = upd.source;
            applied++;
            matched = true;
          }
        }
      });
    });
    if (!matched) {
      console.log("  No match for:", u.generic_name, "->", upd.ingredient);
    }
  });
});

fs.writeFileSync(FILE, JSON.stringify(drugs, null, 2));
console.log("\nApplied:", applied, "| Not found drugs:", notFound);

// Final count
let stillNull = 0, classified = 0, filled = 0;
drugs.forEach(d => {
  (d.dosing_bands || []).forEach(b => {
    (b.ingredient_doses || []).forEach(id => {
      if (id.is_limiting) return;
      if (id.source != null) {
        if (id.dose_min_qty != null) filled++;
        else classified++; // has source but null dose (excipient/vehicle/error)
      } else {
        stillNull++;
      }
    });
  });
});
console.log("Secondary ingredients: filled=" + filled + ", classified=" + classified + ", still null=" + stillNull);
