# Dosing Methods & Pharmaceutical Calculations — Complete Reference Guide

**Prepared for:** Radhakishan Hospital Prescription System
**Date:** 2026-03-24
**Sources:** USP, IAP Drug Formulary 2024, BNF for Children 2025-26, Nelson Textbook of Pediatrics 22e, Harriet Lane Handbook, WHO, StatPearls (NCBI), Merck Manual, GINA 2024

---

## 1. Weight-Based Dosing (mg/kg)

The most common method in pediatrics. Dose is proportional to body weight.

**Formulas:**

```
Single dose (mg)  = Dose (mg/kg/dose) x Weight (kg)
Daily dose (mg)   = Dose (mg/kg/day) x Weight (kg)
Per-dose amount   = Daily dose / Number of doses per day
Volume per dose   = Dose (mg) / Concentration (mg/mL) x Volume per unit (mL)
```

**Variants found in our formulary:**

| Unit            | Meaning                                               | Example                                     |
| --------------- | ----------------------------------------------------- | ------------------------------------------- |
| mg/kg           | milligrams per kilogram per dose                      | Paracetamol 15 mg/kg/dose                   |
| mg/kg/dose      | same as mg/kg (explicit)                              | Amoxicillin 25 mg/kg/dose                   |
| mg/kg/day       | milligrams per kilogram per day (divide by frequency) | Amoxicillin 45 mg/kg/day ÷ 3 = 15 mg/kg TDS |
| mcg/kg          | micrograms per kilogram per dose                      | Fentanyl 1-2 mcg/kg                         |
| mcg/kg/day      | micrograms per kilogram per day                       | Levothyroxine 10-15 mcg/kg/day              |
| g/kg            | grams per kilogram (for large-volume agents)          | Mannitol 0.5-1 g/kg                         |
| mL/kg           | millilitres per kilogram (for fluids/blood products)  | Packed RBCs 10-15 mL/kg                     |
| mEq/kg          | milliequivalents per kilogram (for electrolytes)      | KCl 1-2 mEq/kg/day                          |
| mmol/kg         | millimoles per kilogram                               | Sodium bicarbonate 1-2 mmol/kg              |
| IU/kg           | international units per kilogram                      | Heparin 50-100 IU/kg                        |
| U/kg            | units per kilogram                                    | Insulin 0.5-1 U/kg/day                      |
| units/kg        | same as U/kg                                          | Factor VIII 50 units/kg                     |
| mg base/kg      | milligrams of base form per kilogram                  | Chloroquine 10 mg base/kg                   |
| mg TMP/kg       | component-specific weight-based dose                  | Cotrimoxazole 8 mg TMP/kg/day               |
| mg PE/kg        | phosphate equivalents per kilogram                    | Fosphenytoin 20 mg PE/kg                    |
| mg DHA/kg       | dihydroartemisinin component                          | Artemisinin combinations                    |
| mg elemental Fe | elemental iron (not salt weight)                      | Ferrous sulfate 3-6 mg elemental Fe/kg/day  |

**Worked example:** Amoxicillin 45 mg/kg/day divided TDS for a 10 kg child

- Daily dose: 45 x 10 = 450 mg/day
- Per dose: 450 / 3 = 150 mg per dose
- If syrup 125 mg/5 mL: (150 / 125) x 5 = 6 mL per dose

**Caution:** Use ideal body weight (IBW) for obese children. Never exceed the published adult maximum dose regardless of weight.

---

## 2. Body Surface Area Dosing (mg/m2)

More accurate than weight-based for drugs with narrow therapeutic index. BSA correlates better with cardiac output, renal function, and drug clearance.

**BSA Formulas:**

| Formula                     | Equation                               | Preferred for               |
| --------------------------- | -------------------------------------- | --------------------------- |
| **Mosteller** (recommended) | BSA = sqrt(Ht(cm) x Wt(kg) / 3600)     | Clinical practice, oncology |
| **Haycock**                 | BSA = 0.024265 x Ht^0.3964 x Wt^0.5378 | Neonates and infants        |
| **DuBois & DuBois**         | BSA = 0.007184 x Ht^0.725 x Wt^0.425   | Research                    |

**Dose calculation:**

```
Dose (mg) = Dose (mg/m2) x BSA (m2)
```

**Variants from our formulary:**

| Unit        | Meaning                                                 | Example                              |
| ----------- | ------------------------------------------------------- | ------------------------------------ |
| mg/m2       | milligrams per metre squared                            | Methotrexate 12 mg/m2                |
| mL/m2/day   | millilitres per metre squared per day                   | Maintenance IV fluids 1500 mL/m2/day |
| mL/kg/%TBSA | millilitres per kg per % total body surface area burned | Parkland formula for burns           |

**Reference values:** Average adult BSA = 1.73 m2. Newborn BSA = 0.2-0.25 m2. 1-year-old = ~0.45 m2.

**When to use:** Chemotherapy, certain immunosuppressants (cyclosporine, tacrolimus), cardiac drugs, burn fluid resuscitation, some antimicrobials.

---

## 3. Fixed-Dose / Age-Based / Weight-Band Dosing

Pre-determined dose based on age group, weight range, or a fixed amount per administration.

**WHO Weight Bands (simplified dosing):**

| Weight   | Age (approx) | Fraction of adult dose |
| -------- | ------------ | ---------------------- |
| 3-5 kg   | Neonate      | 1/4                    |
| 6-9 kg   | Infant       | 1/4 - 1/3              |
| 10-14 kg | 1-3 years    | 1/3 - 1/2              |
| 15-19 kg | 4-6 years    | 1/2                    |
| 20-24 kg | 7-9 years    | 1/2 - 2/3              |
| 25-34 kg | 10-12 years  | 2/3 - 3/4              |
| 35+ kg   | >12 years    | Adult dose             |

**Historical approximation rules (NOT for precise dosing):**

- **Young's Rule:** Child dose = (Age / (Age + 12)) x Adult dose
- **Clark's Rule:** Child dose = (Weight in lbs / 150) x Adult dose
- **Fried's Rule (infants):** Child dose = (Age in months / 150) x Adult dose

**Fixed-dose units from our formulary:**

| Unit        | Meaning                           | Example                                             |
| ----------- | --------------------------------- | --------------------------------------------------- |
| tablet      | Fixed number of tablets           | Albendazole 1 tablet (400 mg)                       |
| capsule     | Fixed capsule count               | Omeprazole 1 capsule OD                             |
| suppository | Fixed suppository dose            | Paracetamol 125 mg suppository                      |
| sachet      | Fixed sachet (powder/granules)    | ORS 1 sachet in 1 litre                             |
| vial        | Entire vial as one dose           | Anti-D immunoglobulin 1 vial                        |
| puffs       | Number of inhaler actuations      | Salbutamol 2 puffs PRN                              |
| sprays      | Number of nasal spray actuations  | Fluticasone 1 spray each nostril                    |
| drops       | Number of drops                   | Paracetamol 12 drops                                |
| application | Single topical application        | Mupirocin 1 application TDS                         |
| billion CFU | Colony forming units (probiotics) | Saccharomyces boulardii 250 million - 5 billion CFU |

---

## 4. GFR-Adjusted Dosing (Renal)

For drugs cleared by the kidneys. Dose adjusted based on estimated glomerular filtration rate (eGFR).

**Schwartz Formula (Bedside, 2009 Revised):**

```
eGFR (mL/min/1.73m2) = k x Height (cm) / Serum Creatinine (mg/dL)

k values:
  Preterm infant (<34 wk GA):  0.33
  Term infant (< 1 year):      0.45
  Child (1-12 years):          0.55
  Adolescent female:           0.55
  Adolescent male:             0.70
```

**Dose adjustment categories:**

| GFR (mL/min/1.73m2) | Kidney function     | Action                         |
| ------------------- | ------------------- | ------------------------------ |
| > 90                | Normal              | Standard dose                  |
| 60-89               | Mild impairment     | Usually no change              |
| 30-59               | Moderate impairment | Reduce dose or extend interval |
| 15-29               | Severe impairment   | Significant dose reduction     |
| < 15                | Kidney failure      | Specialist dosing / dialysis   |

**When to use:** Aminoglycosides, vancomycin, acyclovir, methotrexate, lithium, digoxin, and any drug >50% renally excreted.

---

## 5. Milliequivalent (mEq) Dosing — Electrolytes

A milliequivalent measures the chemical combining power of an ion, accounting for both mass and ionic charge (valence). Used for electrolytes because body fluid balance depends on charge, not weight.

**Conversion formula:**

```
mEq = (mg x Valence) / Molecular Weight

Or equivalently:
mg = (mEq x Molecular Weight) / Valence
```

**Common electrolyte conversions:**

| Electrolyte      | Molecular Wt | Valence | 1 mEq =           | Common dose                |
| ---------------- | ------------ | ------- | ----------------- | -------------------------- |
| Potassium (K+)   | 39.1         | 1       | 39.1 mg           | 1-2 mEq/kg/day             |
| KCl              | 74.5         | 1       | 74.5 mg KCl       | Oral/IV replacement        |
| Sodium (Na+)     | 23.0         | 1       | 23.0 mg           | 2-4 mEq/kg/day maintenance |
| NaCl 0.9%        | —            | —       | 154 mEq Na+/L     | Normal saline              |
| NaHCO3 8.4%      | 84.0         | 1       | 84.0 mg = 1 mL    | 1-2 mEq/kg for acidosis    |
| Calcium (Ca2+)   | 40.1         | 2       | 20.0 mg           | Ca gluconate 100 mg/kg     |
| Magnesium (Mg2+) | 24.3         | 2       | 12.2 mg           | 25-50 mg/kg MgSO4          |
| Phosphate (PO4)  | 95.0         | varies  | context-dependent | 0.5-1 mmol/kg/day          |

**Key rules:**

- For monovalent ions (Na+, K+, Cl-, HCO3-): 1 mEq = 1 mmol
- For divalent ions (Ca2+, Mg2+): 1 mmol = 2 mEq
- Always clarify: "mg of the salt" vs "mg of the element" (e.g., Calcium gluconate 100 mg ≠ 100 mg elemental Ca)

**"Elemental" dosing from our formulary:**

| Label                   | Meaning                     | Conversion                                  |
| ----------------------- | --------------------------- | ------------------------------------------- |
| mg elemental Fe         | Iron content only, not salt | Ferrous sulfate 300 mg = 60 mg elemental Fe |
| mg elemental Ca         | Calcium content only        | Ca gluconate 1 g = 90 mg elemental Ca       |
| mg elemental phosphorus | Phosphorus content          | Sodium phosphate varies by preparation      |
| mg base                 | Active base form            | Chloroquine phosphate 250 mg = 150 mg base  |

---

## 6. International Units (IU) & Units Dosing

IU measures biological activity, not mass. Each substance has its own IU definition — 1 IU of insulin ≠ 1 IU of heparin ≠ 1 IU of vitamin D.

**Common IU conversions:**

| Substance                    | 1 IU =                                   | Typical pediatric dose           |
| ---------------------------- | ---------------------------------------- | -------------------------------- |
| Vitamin D3 (Cholecalciferol) | 0.025 mcg                                | 400 IU/day (prophylaxis)         |
| Vitamin A (Retinol)          | 0.3 mcg retinol                          | 100,000-200,000 IU (therapeutic) |
| Vitamin E (alpha-tocopherol) | 0.67 mg (natural) or 0.45 mg (synthetic) | 25-50 IU/day                     |
| Insulin (regular/human)      | 0.0347 mg (34.7 mcg)                     | 0.5-1 U/kg/day                   |
| Heparin                      | ~0.002 mg (varies by source)             | 50-100 U/kg bolus                |
| Erythropoietin               | ~8.4 ng                                  | 50-250 IU/kg 3x/week             |

**U-100 Insulin (standard):**

```
100 units per 1 mL
1 unit = 0.01 mL
```

**Variants from our formulary:**

| Unit         | Meaning                           | Example                           |
| ------------ | --------------------------------- | --------------------------------- |
| IU           | International units per dose      | Vitamin D 400 IU                  |
| IU/kg        | IU per kilogram body weight       | Heparin 75 IU/kg bolus            |
| IU/day       | Total IU per day                  | Vitamin D 400 IU/day              |
| U/kg         | Units per kilogram                | Insulin 0.1 U/kg/hr               |
| U/kg/hr      | Units per kg per hour (infusion)  | Heparin 10-25 U/kg/hr             |
| units/kg     | Same as U/kg                      | Factor VIII 50 units/kg           |
| units/kg/hr  | Same as U/kg/hr                   |                                   |
| units/kg/min | Units per kg per minute           | Very fine titration               |
| lipase units | For pancreatic enzyme replacement | Creon 500-4000 lipase units/g fat |

**Critical rule:** IU cannot be converted between different substances. Always specify which drug.

---

## 7. Continuous Infusion Dosing (mcg/kg/min, mg/kg/hr)

For vasoactive drugs, sedatives, and other agents requiring precise titration.

**Core formula:**

```
Infusion rate (mL/hr) = (Dose (mcg/kg/min) x Weight (kg) x 60) / Concentration (mcg/mL)
```

**Simplified "Rule of 6" (neonatal/pediatric):**

```
6 x Weight (kg) = mg of drug to add to 100 mL
Then: 1 mL/hr = 1 mcg/kg/min
```

**Variants from our formulary:**

| Unit         | Meaning                             | Example drugs                                         |
| ------------ | ----------------------------------- | ----------------------------------------------------- |
| mcg/kg/min   | Micrograms per kg per minute        | Dopamine 5-20, Dobutamine 2.5-20, Nitroprusside 0.5-8 |
| mcg/kg/hr    | Micrograms per kg per hour          | Dexmedetomidine 0.2-0.7                               |
| mg/kg/hr     | Milligrams per kg per hour          | Propofol 1-4, Midazolam 0.05-0.2                      |
| mg/kg/h      | Same as mg/kg/hr                    |                                                       |
| ng/kg/min    | Nanograms per kg per minute         | Prostaglandin E1 (Alprostadil) 5-100                  |
| IU/kg/hr     | International units per kg per hour | Heparin infusion 10-25                                |
| U/kg/hr      | Units per kg per hour               | Insulin infusion 0.05-0.1                             |
| units/kg/min | Units per kg per minute             | Very fine titration agents                            |
| mL/kg/day    | Millilitres per kg per day          | TPN fluids, blood products                            |

**Vasoactive drug dose ranges (pediatric):**

| Drug           | Low dose               | Standard         | High dose       | Max  |
| -------------- | ---------------------- | ---------------- | --------------- | ---- |
| Dopamine       | 2-5 mcg/kg/min (renal) | 5-10 (inotropic) | 10-20 (pressor) | 20   |
| Dobutamine     | 2.5 mcg/kg/min         | 5-10             | 10-20           | 40   |
| Epinephrine    | 0.01 mcg/kg/min        | 0.05-0.1         | 0.1-0.3         | 1.0  |
| Norepinephrine | 0.01 mcg/kg/min        | 0.05-0.1         | 0.1-0.3         | 2.0  |
| Milrinone      | 0.25 mcg/kg/min        | 0.5-0.75         | —               | 0.75 |

---

## 8. Loading Dose + Maintenance Dose

For drugs requiring rapid therapeutic levels.

**Formulas:**

```
Loading dose = Target concentration (mg/L) x Volume of distribution (L/kg) x Weight (kg)
Maintenance dose = Target concentration x Clearance (L/hr)
Maintenance rate = (Dose x Bioavailability) / (Dosing interval x Clearance)
```

**Common loading/maintenance regimens:**

| Drug             | Loading dose                         | Maintenance dose       |
| ---------------- | ------------------------------------ | ---------------------- |
| Phenytoin        | 20 mg/kg IV (max 1g)                 | 5-8 mg/kg/day div BD   |
| Phenobarbital    | 20 mg/kg IV                          | 3-5 mg/kg/day OD       |
| Digoxin          | 20-30 mcg/kg total digitalising dose | 5-10 mcg/kg/day div BD |
| Vancomycin       | 15 mg/kg IV                          | 10 mg/kg q6-8h         |
| Caffeine citrate | 20 mg/kg                             | 5-10 mg/kg/day OD      |
| Fosphenytoin     | 20 mg PE/kg                          | 5-8 mg PE/kg/day       |

**Loading dose units from our formulary:** mg, mg/kg, mcg/kg, IU/kg, mg PE/kg, units/kg, mL/kg, g/kg/day

---

## 9. IV Fluid & Infusion Rate Calculations

**IV drip rate formula:**

```
Drops/min = (Volume (mL) x Drop factor (gtt/mL)) / Time (minutes)
mL/hr = Volume (mL) / Time (hours)
```

**IV tubing drop factors:**

| Tubing                    | Drops per mL  | Used for                              |
| ------------------------- | ------------- | ------------------------------------- |
| Macrodrip (standard)      | 15 gtt/mL     | Adults, large volumes                 |
| Macrodrip (blood)         | 10 gtt/mL     | Blood/blood products                  |
| Macrodrip                 | 20 gtt/mL     | Older children                        |
| **Microdrip (pediatric)** | **60 gtt/mL** | **Neonates, infants, precise dosing** |

**Holliday-Segar Formula (Maintenance IV fluids):**

```
First 10 kg:   100 mL/kg/day  (4 mL/kg/hr)
Next 10 kg:     50 mL/kg/day  (2 mL/kg/hr)
Each kg > 20:   20 mL/kg/day  (1 mL/kg/hr)
```

**Example:** 25 kg child

- First 10 kg: 1000 mL + Next 10 kg: 500 mL + Next 5 kg: 100 mL = 1600 mL/day = 67 mL/hr

**Parkland Formula (Burns):**

```
Total fluid (mL) = 4 mL x Weight (kg) x %TBSA burned
Give 50% in first 8 hours, 50% in next 16 hours
```

**Alternative BSA method for maintenance fluids:**

```
1500 mL/m2/day maintenance
2000 mL/m2/day for insensible + maintenance
```

---

## 10. Drop Calculations — ALL Types

### 10a. Standard Oral Drops (USP Standard)

Per **United States Pharmacopeia (USP):**

```
1 mL = 20 drops (standard calibrated dropper)
1 drop = 0.05 mL (50 microliters)
```

**Calculation:**

```
Number of drops = Volume (mL) x 20
Volume (mL) = Number of drops / 20
```

**Example:** Paracetamol drops 100 mg/mL. Dose needed: 60 mg

- Volume: 60 / 100 = 0.6 mL
- Drops: 0.6 x 20 = **12 drops**

### 10b. Ophthalmic (Eye) Drops

| Parameter                          | Value                             |
| ---------------------------------- | --------------------------------- |
| Average commercial eye drop volume | 25-50 microliters (0.025-0.05 mL) |
| Conjunctival sac capacity          | 7-10 microliters                  |
| Maximum eye surface retention      | 30 microliters                    |
| Excess overflow/runoff             | 60-80% of each drop               |

**Key rules:**

- One drop is sufficient per application — additional drops are wasted
- Pediatric adjustment: half-adult dose for age < 2 years, two-thirds for age 3
- Apply punctal occlusion (press inner corner of eye) for 3-4 min to reduce systemic absorption by up to 40%
- Wait 5 minutes between different eye drop medications
- Eye drops are prescribed as "1 drop" or "2 drops" — never in mL

### 10c. Nasal Drops

- Standard nasal drop: ~0.05 mL (USP standard)
- Prescribed as number of drops per nostril
- Typical: 1-3 drops per nostril
- Saline drops (0.65% NaCl): 2-3 drops each nostril, 4-6 times/day

### 10d. Ear (Otic) Drops

- Standard ear drop: ~0.05 mL
- Prescribed as number of drops in the affected ear
- Typical: 3-5 drops per ear
- Warm to body temperature before instilling (prevents vertigo)

### 10e. Important Caveats

- The USP 20 drops/mL standard applies to **water-like solutions** with a **calibrated dropper**
- Viscous solutions (suspensions, oils) produce **larger drops** — fewer per mL
- **Manufacturer-labeled "drops" always take precedence** — e.g., "400 IU/drop" on the label = 400 IU per drop, regardless of theoretical mL conversion
- When a manufacturer specifies dose in drops, use their drop count directly — do NOT convert to mL and back
- Different dropper sizes exist — always use the dropper provided with the product

---

## 11. Inhaler & Nebulisation Dosing

### 11a. Metered-Dose Inhaler (MDI)

Dose expressed as **micrograms per actuation (puff)**. Each puff delivers a fixed, metered amount.

| Drug               | mcg/puff           | Pediatric dose        | With spacer?        |
| ------------------ | ------------------ | --------------------- | ------------------- |
| Salbutamol MDI     | 100 mcg/puff       | 2-4 puffs PRN (q4-6h) | Always in < 6 years |
| Budesonide MDI     | 200 mcg/puff       | 1-2 puffs BD          | Always in < 6 years |
| Fluticasone MDI    | 50 or 125 mcg/puff | 1-2 puffs BD          | Always in < 6 years |
| Ipratropium MDI    | 20 mcg/puff        | 2-4 puffs TDS-QID     | Recommended         |
| Beclomethasone MDI | 50 or 100 mcg/puff | 1-2 puffs BD          | Recommended         |

**Spacer rule:** Children < 6 years MUST use MDI + spacer + face mask. Children 6-12 should use spacer. >12 years may use MDI alone if technique is good.

### 11b. Nebulisation

Dose expressed in **mg or mL** of nebulisation solution.

| Drug                  | Solution strength                | Pediatric dose                      |
| --------------------- | -------------------------------- | ----------------------------------- |
| Salbutamol NEB        | 5 mg/mL (0.5%)                   | 2.5-5 mg (0.5-1 mL) diluted to 3 mL |
| Levosalbutamol NEB    | 0.63 mg/respule, 1.25 mg/respule | < 10 kg: 0.63 mg, ≥ 10 kg: 1.25 mg  |
| Budesonide NEB        | 0.25, 0.5, 1.0 mg/2 mL respule   | 0.25-1 mg OD-BD                     |
| Ipratropium NEB       | 250 mcg/mL                       | 250 mcg q6-8h                       |
| Hypertonic saline NEB | 3% NaCl                          | 4 mL q6-8h (bronchiolitis)          |
| Normal saline NEB     | 0.9% NaCl                        | 3-5 mL q4-6h (humidification)       |

---

## 12. Topical Dosing — Percentage, FTU, Concentration

### 12a. Percentage Concentrations

| Expression | Meaning          | Example                         |
| ---------- | ---------------- | ------------------------------- |
| % w/v      | Grams per 100 mL | 1% Hydrocortisone = 10 mg/mL    |
| % w/w      | Grams per 100 g  | 2% Mupirocin ointment = 20 mg/g |
| % v/v      | mL per 100 mL    | 70% Alcohol = 70 mL per 100 mL  |

**Conversion:** 1% w/v = 10 mg/mL = 10,000 mcg/mL

### 12b. Fingertip Unit (FTU)

One FTU = amount of cream/ointment from a 5mm nozzle tube, squeezed from the distal skin crease to the tip of the adult index finger.

```
1 FTU ≈ 0.5 g (adult)
1 FTU covers approximately 2 adult handprints of skin area
```

**Pediatric FTU guide (using adult FTU measurement):**

| Body area       | 3-6 months | 1-2 years | 3-5 years | 6-10 years |
| --------------- | ---------- | --------- | --------- | ---------- |
| Face + neck     | 1 FTU      | 1.5 FTU   | 1.5 FTU   | 2 FTU      |
| One arm + hand  | 1 FTU      | 1.5 FTU   | 2 FTU     | 2.5 FTU    |
| One leg + foot  | 1.5 FTU    | 2 FTU     | 3 FTU     | 4.5 FTU    |
| Chest + abdomen | 1 FTU      | 2 FTU     | 3 FTU     | 3.5 FTU    |
| Back + buttocks | 1.5 FTU    | 3 FTU     | 3.5 FTU   | 5 FTU      |

### 12c. Other Topical Units from our formulary

| Unit             | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| thin layer       | Apply a thin layer to affected area                              |
| pea-sized amount | Approximately 0.25 g                                             |
| cm ribbon        | Length of ribbon from tube (e.g., "1 cm ribbon" of eye ointment) |
| application      | Single application event                                         |

---

## 13. Combination Drug Dosing

Many pediatric formulations are fixed-dose combinations. Dose is expressed per the primary component.

**From our formulary:**

| Expression                     | Meaning                         | Example                                |
| ------------------------------ | ------------------------------- | -------------------------------------- |
| mg TMP/kg                      | Dose per trimethoprim component | Cotrimoxazole: 8 mg TMP/kg/day         |
| mg PE/kg                       | Fosphenytoin equivalents        | 20 mg PE/kg loading                    |
| mg LPV                         | Lopinavir component dose        | Kaletra: 300/75 mg LPV/m2 BD           |
| mg base/kg                     | Active base (not salt)          | Chloroquine 10 mg base/kg              |
| mg DHA/kg                      | Dihydroartemisinin component    | ACT combinations                       |
| mg sof                         | Sofosbuvir component            | HCV combinations                       |
| mg ELX                         | Elexacaftor component           | Trikafta: 100 mg ELX/50 TEZ/75 IVA     |
| mg pip                         | Piperacillin component          | Piperacillin-tazobactam: 100 mg pip/kg |
| mg nirmatrelvir + mg ritonavir | Dual component                  | Paxlovid                               |

**Rule:** When a combination drug is dosed, the dose always refers to the NAMED component (usually the primary active ingredient). Always verify which component the dose refers to.

---

## 14. Special Populations

### 14a. Neonates (< 28 days)

- Immature hepatic and renal function — doses often 50-75% of infant doses
- Use **CORRECTED gestational age** for dose calculations
- Extended dosing intervals (q12h or q24h for aminoglycosides)
- GFR at birth: 2-4 mL/min/1.73m2 (preterm) to 20 mL/min/1.73m2 (term) — reaches adult values (~120) by 1 year
- Avoid certain drugs: chloramphenicol (grey baby), sulfonamides (kernicterus), ceftriaxone with calcium-containing IV fluids

### 14b. Preterm Infants

- Even lower doses than term neonates
- Drug half-lives significantly prolonged (immature metabolism)
- Use **corrected age** for growth/development, **chronological age** for vaccinations
- Gestational-age-specific dosing (our formulary has `ga_weeks_min`, `ga_weeks_max`)

### 14c. Obese Children

- **Hydrophilic drugs** (aminoglycosides, vancomycin): Use ideal body weight (IBW)
- **Lipophilic drugs** (benzodiazepines, some anesthetics): Use actual body weight
- **Aminoglycosides**: Use adjusted body weight: AdjBW = IBW + 0.4 x (Actual - IBW)
- **Chemotherapy**: Most protocols cap BSA at 2.0 m2

---

## 15. Dose Rounding Rules

| Formulation      | Round to                     | Example                          |
| ---------------- | ---------------------------- | -------------------------------- |
| Oral syrup       | Nearest 0.5 mL               | 3.3 mL -> 3.5 mL                 |
| Oral drops       | Nearest whole drop           | 3.8 drops -> 4 drops             |
| Tablet           | Nearest 1/4 tablet           | 0.6 tab -> 1/2 tab               |
| Capsule          | Nearest whole capsule        | Cannot split capsules            |
| Injection        | Nearest 0.1 mL               | 0.76 mL -> 0.8 mL                |
| IV infusion rate | Nearest 0.1 mL/hr or 1 mL/hr | Depends on pump precision        |
| Inhaler puffs    | Nearest whole puff           | 1.3 puffs -> 1 puff              |
| Topical          | Per FTU or "thin layer"      | No volumetric rounding           |
| Suppository      | Nearest available size       | 125 mg or 250 mg                 |
| Nebulisation     | Nearest 0.25 mL or respule   | Use whole respules when possible |

**Additional rounding rules from our formulary:** nearest_mEq, nearest_sachet, nearest_scoop, nearest_vial, nearest_syringe_size, nearest_FDC_tablet, whole_cap, whole_tab_or_sachet, protocol_specific, exact (no rounding for critical drugs).

**Golden rule:** Never round UP beyond the maximum single dose.

---

## 16. Maximum Dose Rule

**Regardless of calculation method, NEVER exceed the published adult maximum dose.**

```
Final dose = min(calculated dose, published maximum single dose)
Final daily dose = min(calculated daily dose, published maximum daily dose)
```

**Example:** Ibuprofen 10 mg/kg/dose for a 50 kg adolescent

- Calculated: 10 x 50 = 500 mg
- Adult max single dose: 400 mg
- **Use 400 mg** (capped at max)

---

## Quick Reference — Unit Conversions

| From                   | To                  | Factor         |
| ---------------------- | ------------------- | -------------- |
| 1 mL                   | Standard oral drops | x 20           |
| 1 teaspoon (tsp)       | mL                  | = 5 mL         |
| 1 tablespoon (tbsp)    | mL                  | = 15 mL        |
| 1 kg                   | lbs                 | x 2.2          |
| 1 inch                 | cm                  | x 2.54         |
| Fahrenheit → Celsius   |                     | (F - 32) x 5/9 |
| Celsius → Fahrenheit   |                     | (C x 9/5) + 32 |
| mg → mcg               |                     | x 1000         |
| g → mg                 |                     | x 1000         |
| 1 unit insulin (U-100) | mL                  | = 0.01 mL      |
| 1 mEq K+               | mg K+               | = 39.1 mg      |
| 1 mEq Na+              | mg Na+              | = 23.0 mg      |
| 1 mEq Ca2+             | mg Ca2+             | = 20.0 mg      |
| 1 mmol Ca2+            | mEq Ca2+            | = 2 mEq        |
| 1 IU Vitamin D3        | mcg                 | = 0.025 mcg    |
| 1% w/v                 | mg/mL               | = 10 mg/mL     |

---

## References

1. United States Pharmacopeia (USP) — Drop volume standard (0.05 mL/drop, 20 drops/mL)
2. IAP (Indian Academy of Pediatrics) Drug Formulary 2024
3. BNF for Children (BNFC) 2025-26
4. Nelson Textbook of Pediatrics, 22nd Edition (2024)
5. Harriet Lane Handbook, 23rd Edition (Johns Hopkins)
6. WHO Essential Medicines List for Children
7. Schwartz GJ et al. "New equations to estimate GFR in children with CKD" (2009)
8. Mosteller RD. "Simplified calculation of body-surface area" (1987)
9. Holliday MA, Segar WE. "The maintenance need for water in parenteral fluid therapy" (1957)
10. StatPearls — Clark's Rule, Young's Rule, Body Surface Area (NCBI Bookshelf)
11. Cancer Care Ontario — BSA calculation standards
12. Merck Manual — Unit of Measure Conversions
13. Long SS, Prober CG, Fischer M. "Principles and Practice of Pediatric Infectious Diseases" (2024)
14. GINA 2024 — Global Initiative for Asthma, inhaler dosing guidelines
15. DermNet NZ — Fingertip Unit reference
