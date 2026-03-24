# Dosing Methods & Pharmaceutical Calculations — Reference Guide

**Prepared for:** Radhakishan Hospital Prescription System
**Date:** 2026-03-24
**Sources:** USP, IAP Drug Formulary 2024, BNF for Children 2025-26, Nelson Textbook of Pediatrics 22e, WHO, StatPearls (NCBI)

---

## 1. Weight-Based Dosing (mg/kg)

The most common method in pediatrics. Dose is proportional to body weight.

**Formula:**

```
Single dose (mg) = Dose (mg/kg) x Weight (kg)
Daily dose (mg/day) = Dose (mg/kg/day) x Weight (kg)
Per-dose amount = Daily dose / Number of doses per day
```

**Example:** Amoxicillin 45 mg/kg/day divided TDS for a 10 kg child

- Daily dose: 45 x 10 = 450 mg/day
- Per dose: 450 / 3 = 150 mg per dose
- If syrup 125 mg/5 ml: 150/125 x 5 = 6 ml per dose

**When to use:** Most routine pediatric drugs (antibiotics, antipyretics, anticonvulsants, etc.)

**Caution:** Use ideal body weight (IBW) for obese children, actual weight for underweight. Never exceed the published adult maximum dose regardless of weight.

---

## 2. Body Surface Area Dosing (mg/m2)

More accurate than weight-based for drugs with narrow therapeutic index. BSA correlates better with cardiac output, renal function, and drug clearance.

**BSA Formulas:**

| Formula                     | Equation                                   | Preferred for               |
| --------------------------- | ------------------------------------------ | --------------------------- |
| **Mosteller** (recommended) | BSA = sqrt(Height(cm) x Weight(kg) / 3600) | Clinical practice, oncology |
| **Haycock**                 | BSA = 0.024265 x Ht^0.3964 x Wt^0.5378     | Neonates and infants        |
| **DuBois & DuBois**         | BSA = 0.007184 x Ht^0.725 x Wt^0.425       | Research                    |

**Formula:**

```
Dose (mg) = Dose (mg/m2) x BSA (m2)
```

**Example:** Methotrexate 12 mg/m2 for a child with BSA 0.6 m2

- Dose: 12 x 0.6 = 7.2 mg

**When to use:** Chemotherapy, certain immunosuppressants (cyclosporine, tacrolimus), cardiac drugs, some antimicrobials

**Note:** Average adult BSA = 1.73 m2. Average newborn BSA = 0.25 m2.

---

## 3. Fixed-Dose (Age-Based or Weight-Band)

Pre-determined dose based on age group or weight range. Used for OTC medicines, vaccines, and when precision is less critical.

**WHO Weight Bands (simplified dosing):**

| Weight   | Age (approx) | Dose fraction  |
| -------- | ------------ | -------------- |
| 3-5 kg   | Neonate      | 1/4 adult dose |
| 6-9 kg   | Infant       | 1/4 - 1/3      |
| 10-14 kg | 1-3 years    | 1/3 - 1/2      |
| 15-19 kg | 4-6 years    | 1/2            |
| 20-24 kg | 7-9 years    | 1/2 - 2/3      |
| 25-34 kg | 10-12 years  | 2/3 - 3/4      |
| 35+ kg   | >12 years    | Adult dose     |

**Historical rules (approximations only, NOT for precise dosing):**

- **Young's Rule:** Child dose = (Age / (Age + 12)) x Adult dose
- **Clark's Rule:** Child dose = (Weight in lbs / 150) x Adult dose
- **Fried's Rule (infants):** Child dose = (Age in months / 150) x Adult dose

**When to use:** Vaccines, OTC medications, emergency weight-band dosing

---

## 4. GFR-Adjusted Dosing (Renal)

For drugs cleared by the kidneys. Dose adjusted based on glomerular filtration rate.

**Schwartz Formula (Bedside, 2009 Revised):**

```
eGFR (ml/min/1.73m2) = k x Height (cm) / Serum Creatinine (mg/dL)

k values:
  Preterm infant: 0.33
  Term infant (< 1 year): 0.45
  Child (1-12 years): 0.55
  Adolescent female: 0.55
  Adolescent male: 0.70
```

**Dose adjustment categories:**

| GFR (ml/min/1.73m2) | Kidney function     | Action                         |
| ------------------- | ------------------- | ------------------------------ |
| > 90                | Normal              | Standard dose                  |
| 60-89               | Mild impairment     | Usually no change              |
| 30-59               | Moderate impairment | Reduce dose or extend interval |
| 15-29               | Severe impairment   | Significant dose reduction     |
| < 15                | Kidney failure      | Specialist dosing / dialysis   |

**When to use:** Aminoglycosides, vancomycin, acyclovir, methotrexate, lithium, digoxin, and any drug >50% renally excreted

---

## 5. Loading Dose + Maintenance Dose

For drugs requiring rapid therapeutic levels. A larger initial dose saturates the body, followed by smaller regular doses.

**Formulas:**

```
Loading dose = Target concentration x Volume of distribution (Vd)
Maintenance dose = Target concentration x Clearance
```

**Example:** Phenytoin loading 20 mg/kg IV, then maintenance 5 mg/kg/day

- 10 kg child: Loading = 200 mg IV over 20 min
- Maintenance: 50 mg/day divided BD (25 mg BD)

**When to use:** Anticonvulsants (phenytoin, phenobarbital), digoxin, aminoglycosides, theophylline, some antibiotics (vancomycin)

---

## 6. Infusion Rate Calculation

**IV drip rate formula:**

```
Drops/min = (Volume in mL x Drop factor) / Time in minutes
mL/hr = Volume (mL) / Time (hours)
```

**Drop factors (tubing types):**

| Tubing        | Drops per mL  | Used for                           |
| ------------- | ------------- | ---------------------------------- |
| Macrodrip     | 10 gtt/mL     | Large volume, adults               |
| Macrodrip     | 15 gtt/mL     | Standard adult                     |
| Macrodrip     | 20 gtt/mL     | Standard adult/older child         |
| **Microdrip** | **60 gtt/mL** | **Pediatric / neonatal (precise)** |

**Holliday-Segar Formula (Maintenance IV fluids):**

```
First 10 kg:  100 mL/kg/day  (= 4 mL/kg/hr)
Next 10 kg:    50 mL/kg/day  (= 2 mL/kg/hr)
Each kg > 20:  20 mL/kg/day  (= 1 mL/kg/hr)
```

**Example:** 15 kg child

- First 10 kg: 1000 mL + Next 5 kg: 250 mL = 1250 mL/day = 52 mL/hr

---

## 7. Drop Calculations — ALL Types

### Standard Pharmaceutical Drops (Oral)

Per **USP (United States Pharmacopeia):**

```
1 mL = 20 drops (standard calibrated dropper)
1 drop = 0.05 mL (50 microliters)
```

**Calculation:**

```
Number of drops = Volume in mL x 20
Volume in mL = Number of drops / 20
```

**Example:** Paracetamol drops 100 mg/mL. Dose needed: 60 mg

- Volume: 60/100 = 0.6 mL
- Drops: 0.6 x 20 = 12 drops

### Ophthalmic (Eye) Drops

| Parameter                     | Value                             |
| ----------------------------- | --------------------------------- |
| Average commercial eye drop   | 25-50 microliters (0.025-0.05 mL) |
| Conjunctival sac capacity     | 7-10 microliters                  |
| Maximum eye surface retention | 30 microliters                    |
| Excess (overflow/runoff)      | 60-80% of each drop               |

**Key facts:**

- One drop is sufficient per application — adding more just increases waste and systemic absorption
- Pediatric dosing: half-adult dose for age < 2 years, two-thirds for age 3
- Always apply punctal occlusion (press inner corner of eye) for 3-4 min to reduce systemic absorption by 40%
- Wait 5 minutes between different eye drop medications

### Nasal Drops

- Standard nasal drop: ~0.05 mL (same as USP standard)
- Typical dose: 1-3 drops per nostril
- Saline drops (0.65% NaCl): 2-3 drops each nostril, 4-6 times/day

### Ear (Otic) Drops

- Standard ear drop: ~0.05 mL
- Typical dose: 3-5 drops in affected ear
- Warm to body temperature before instilling to prevent vertigo

### Important Caveats

- The USP 20 drops/mL standard applies to **water-like** solutions with a **calibrated dropper**
- Viscous solutions (suspensions, oils) produce **larger drops** — fewer per mL
- Manufacturer-labeled "drops" should always take precedence (e.g., "400 IU/drop" on the label = 400 IU per drop regardless of mL conversion)
- When a manufacturer specifies dose in drops, use their drop count directly — do NOT convert to mL and back

---

## 8. Dose Rounding Rules

| Formulation   | Round to           | Example              |
| ------------- | ------------------ | -------------------- |
| Oral syrup    | Nearest 0.5 mL     | 3.3 mL -> 3.5 mL     |
| Oral drops    | Nearest whole drop | 3.8 drops -> 4 drops |
| Tablet        | Nearest 1/4 tablet | 0.6 tab -> 1/2 tab   |
| Injection     | Nearest 0.1 mL     | 0.76 mL -> 0.8 mL    |
| Inhaler puffs | Nearest whole puff | 1.3 puffs -> 1 puff  |
| IV infusion   | Nearest 1 mL/hr    | 52.3 -> 52 mL/hr     |
| IV bolus      | Nearest 0.1 mL     |                      |

**Never round UP beyond the maximum single dose.**

---

## 9. Special Populations

### Neonates (< 28 days)

- Immature hepatic and renal function — doses often 50-75% of infant doses
- Use CORRECTED gestational age for dose calculations
- Extended dosing intervals (q12h or q24h for aminoglycosides)
- Avoid certain drugs entirely (chloramphenicol → grey baby syndrome)

### Preterm Infants

- Even lower doses than term neonates
- GFR: 2-4 mL/min/1.73m2 at birth (vs adult 120)
- Drug half-lives significantly prolonged
- Use corrected age for growth/development, chronological for vaccinations

### Obese Children

- Use ideal body weight (IBW) for hydrophilic drugs
- Use actual body weight for lipophilic drugs
- Use adjusted body weight for aminoglycosides: AdjBW = IBW + 0.4 x (Actual - IBW)

---

## 10. Maximum Dose Rule

**Regardless of calculation method, NEVER exceed the published adult maximum dose.**

```
Calculated dose = min(weight-based dose, published maximum dose)
```

**Example:** Ibuprofen 10 mg/kg/dose for a 50 kg adolescent

- Calculated: 10 x 50 = 500 mg
- Adult max single dose: 400 mg
- **Use 400 mg** (capped at adult max)

---

## Quick Reference Conversions

| From                | To               | Factor         |
| ------------------- | ---------------- | -------------- |
| 1 mL                | Drops (standard) | x 20           |
| 1 teaspoon (tsp)    | mL               | = 5 mL         |
| 1 tablespoon (tbsp) | mL               | = 15 mL        |
| 1 kg                | lbs              | x 2.2          |
| 1 inch              | cm               | x 2.54         |
| Fahrenheit          | Celsius          | (F - 32) x 5/9 |
| mg                  | mcg              | x 1000         |
| g                   | mg               | x 1000         |
| 1 unit insulin      | mL (U-100)       | = 0.01 mL      |

---

## References

1. United States Pharmacopeia (USP) — Drop volume standard (0.05 mL/drop, 20 drops/mL)
2. IAP (Indian Academy of Pediatrics) Drug Formulary 2024
3. BNF for Children (BNFC) 2025-26
4. Nelson Textbook of Pediatrics, 22nd Edition (2024)
5. WHO Essential Medicines List for Children
6. Harriet Lane Handbook (Johns Hopkins)
7. Schwartz GJ et al. "New equations to estimate GFR in children with CKD" (2009) — Bedside Schwartz formula
8. Mosteller RD. "Simplified calculation of body-surface area" (1987)
9. Holliday MA, Segar WE. "The maintenance need for water in parenteral fluid therapy" (1957)
10. StatPearls — Clark's Rule, Young's Rule (NCBI Bookshelf)
11. Cancer Care Ontario — BSA calculation standards (Mosteller only)
