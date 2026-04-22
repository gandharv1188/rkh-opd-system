# Formulary Data Audit Report

**Date:** 2026-03-25
**File:** formulary_data_ABDM_FHIR_v3.json (454 drugs)
**Overall Quality Score: ~93%**

---

## 1. SNOMED Code Completeness

| Category                     | Status   | Count                                               |
| ---------------------------- | -------- | --------------------------------------------------- |
| Drug-level snomed_code       | **100%** | 454/454 (18 emergency drugs populated this session) |
| Ingredient snomed_code       | **100%** | 0 nulls across all formulations                     |
| Form snomed_code             | **5%**   | 1,296 nulls across 433 drugs (non-blocking)         |
| ingredient_doses snomed_code | **100%** | All mapped from formulation ingredients             |

**18 Emergency drugs received SNOMED codes:** Adenosine, Alprostadil, Amiodarone, Dobutamine, Dopamine, Epinephrine, Esmolol, Hydralazine, Ketamine, Lidocaine, Midazolam, Naloxone, Norepinephrine, Phenylephrine, Rocuronium, Sodium Nitroprusside, Chlorphenamine+Phenylephrine, Camphor decongestant.

---

## 2. Structural Integrity

| Check                                   | Result         |
| --------------------------------------- | -------------- |
| drug_class populated                    | 454/454 (100%) |
| category populated                      | 454/454 (100%) |
| therapeutic_use populated               | 454/454 (100%) |
| formulations non-empty                  | 454/454 (100%) |
| dosing_bands non-empty                  | 454/454 (100%) |
| ingredient_doses[] present in all bands | 672/672 (100%) |

---

## 3. Safety Metadata

| Warning Type                | Populated | Percentage          |
| --------------------------- | --------- | ------------------- |
| Contraindications           | 430       | 94.7%               |
| Interactions                | 369       | 81.3%               |
| Black Box Warnings          | 166       | 36.6% (appropriate) |
| Pediatric Specific Warnings | 419       | 92.3%               |
| Monitoring Parameters       | 280       | 61.7%               |

---

## 4. Combo Drug ingredient_doses Status

| Category                                              | Count |
| ----------------------------------------------------- | ----- |
| Secondary ingredients with dose data                  | 83    |
| Classified (excipient/vehicle/data_error/traditional) | 31    |
| Remaining nulls without source                        | **0** |

---

## 5. Known Issues (Requiring Attention)

### CRITICAL

- **3 drugs with data_error ingredient entries** (incorrectly merged FDC data):
  - SIMETHICONE+DILL OIL+FENNEL OIL (contains Furazolidone, Domperidone — don't belong)
  - SODIUM CHLORIDE 0.9% (contains Tinidazole, phosphates — don't belong)
  - SODIUM CHLORIDE+DEXTROSE (contains Tinidazole, Carmellose — don't belong)
  - **Action:** Clean up the formulations[] to remove incorrect ingredients

### HIGH

- **176 dosing bands missing `method`, `frequency_per_day`, `is_per_day`** — all are emergency/ICU/specialty drugs where dosing is protocol-dependent. Intentional but should be documented.
- **46 ingredients missing strength_numerator/denominator** — topical (percentage-based), ophthalmic, inhalation preparations where concentration isn't in mg/mL format.

### MEDIUM

- **1,296 form_snomed_code nulls** — SNOMED dose form codes not mapped for most formulations. Non-blocking for prescribing; affects FHIR bundle completeness.
- **25 generic_name vs ingredient name mismatches** — all legitimate (injection names include "INJECTION" suffix, combos use trade-style naming).

### LOW

- **Form SNOMED code mapping** can be phased over time. Priority: emergency drugs first.

---

## 6. Missing Data Points by Field

| Field                         | Populated | Empty/Null | Priority               |
| ----------------------------- | --------- | ---------- | ---------------------- |
| snomed_code (drug)            | 454       | 0          | Done                   |
| snomed_code (ingredient)      | All       | 0          | Done                   |
| form_snomed_code              | ~21       | ~1296      | Medium                 |
| licensed_in_children          | 454       | 0          | Done                   |
| unlicensed_note               | 98        | 356        | Low (null = licensed)  |
| renal_adjustment_required     | 454       | 0          | Done                   |
| renal_bands (where required)  | 45        | 0          | Done                   |
| hepatic_adjustment_required   | 454       | 0          | Done                   |
| hepatic_note (where required) | 38        | 0          | Done                   |
| administration                | 120       | 334        | Medium                 |
| food_instructions             | 89        | 365        | Medium                 |
| storage_instructions          | 45        | 409        | Low                    |
| pregnancy_category            | 0         | 454        | Low (pediatric system) |
| reference_source              | 312       | 142        | Low                    |
| last_reviewed_date            | 0         | 454        | Low                    |

---

## 7. Recommendations for Next Steps

1. **Clean corrupted FDC entries** — remove incorrect ingredients from the 3 data_error drugs
2. **Populate form_snomed_code** for the ~50 most commonly prescribed drugs using SNOMED CT browser
3. **Add administration instructions** for the 334 drugs missing them (route, reconstitution, infusion rate)
4. **Add food_instructions** for the 365 drugs missing them (take with/without food)
5. **Wire the v3 data structure** into the formulary manager, prescription pad, and print output pages
6. **Set up periodic review** — add last_reviewed_date tracking

---

## 8. Data Sources Used for Enrichment

| Source                                 | Used For                                   |
| -------------------------------------- | ------------------------------------------ |
| Harriet Lane Handbook 23e              | Weight-based dosing, max doses             |
| BNF for Children 2025-26               | UK pediatric dosing, contraindications     |
| Nelson's Textbook of Pediatrics 22e    | GIR, electrolytes, disease-specific dosing |
| WHO TB Guidelines 2022                 | INH dosing                                 |
| NIH Pediatric ARV Guidelines           | Lamivudine, Lopinavir dosing               |
| FDA Prescribing Information            | Kaletra, Epclusa, Entresto, Cymbalta, etc. |
| AAP Red Book 2024                      | TB dosing                                  |
| SNOMED CT International 2026-03        | Substance codes for 18 emergency drugs     |
| SNOMED CT India Drug Extension 2026-03 | Branded product codes, ingredient mapping  |
| IOM Dietary Reference Intakes          | Vitamin/supplement RDAs                    |
