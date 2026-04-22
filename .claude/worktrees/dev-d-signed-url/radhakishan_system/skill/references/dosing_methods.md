# Dosing Methods — Radhakishan Hospital

## DOSE CALCULATION — 6 METHODS

### Method A: Weight-based (mg/kg) — MOST COMMON

**Formula:** dose_per_kg × patient_weight_kg = total_dose
**If is_per_day:** total_daily ÷ frequency = per_dose_amount

**`calc` field format:** `"15 mg/kg × 7.2 kg = 108 mg/day ÷ 3 = 36 mg/dose → 1.5 ml"`

**ABSOLUTE RULE:** Calculated dose MUST NEVER exceed the published maximum single or daily dose. If it does, cap at the maximum, use the capped dose, and set `flag`: `"Dose capped at max X mg (calculated Y mg exceeds limit)"`.

### Method B: BSA-based (mg/m²)

**BSA (Mosteller):** √(height_cm × weight_kg / 3600)
**Formula:** dose_per_m2 × BSA = total_dose

Used for: oncology drugs, immunosuppressants, some cardiac drugs.
Always state BSA value used in `calc`.

### Method C: GFR-adjusted

**Schwartz formula (pediatric):** GFR = k × height_cm / serum_creatinine

- k = 0.413 for age 1-18yr
- k = 0.45 for full-term infants

Used for: aminoglycosides (gentamicin, amikacin), vancomycin, carboplatin.
Adjust dose or interval per GFR tier. State GFR and adjustment in `calc`.

### Method D: Fixed dose

Flat dose regardless of weight, based on age band.

**Examples:**

- Albendazole: 400 mg single dose if >2 years; 200 mg if 1-2 years
- ORS: 1 sachet in 1 litre water (no weight calculation)

`calc` format: `"Fixed dose: 400 mg single dose (age >2yr)"`

### Method E: Infusion rate (mcg/kg/min)

**Formula:** dose_mcg_per_kg_per_min × weight_kg × 60 = mcg/hr
Convert to ml/hr based on concentration.

Used for: PICU vasoactive drugs (dopamine, dobutamine, adrenaline, milrinone).
State concentration, rate in mcg/kg/min, and calculated ml/hr in `calc`.

### Method F: Age/GA-tier dosing

Dose determined by gestational age band or postnatal age, not weight.

**Common GA tiers:**

- <29 weeks, 29-36 weeks, ≥37 weeks
- Postnatal day 0-7, 8-28, >28

Used for: neonatal drugs (gentamicin, ampicillin, caffeine citrate, phenobarbitone).
State GA tier and postnatal age in `calc`.

---

## DOSE ROUNDING RULES

| Formulation | Round to           | Example                    |
| ----------- | ------------------ | -------------------------- |
| Syrup       | Nearest 0.5 ml     | 4.3 ml → 4.5 ml            |
| Drops       | Nearest 0.1 ml     | 0.83 ml → 0.8 ml           |
| Tablet      | Nearest ¼ tablet   | 0.6 tab → ½ tab            |
| Injection   | Exact to 0.01 ml   | State ml + dilution + rate |
| Insulin     | Nearest whole unit | 7.3 units → 7 units        |
| BSA drugs   | Exact              | State BSA used             |

**Indian Concentration Rule:** When Indian commercial concentration (MIMS/CIMS) differs from international formulary, use the INDIAN concentration for dose volume calculation. Always state the concentration used in Row 1.

**Common Indian concentrations:**

- Paracetamol: 120 mg/5 ml OR 250 mg/5 ml
- Amoxicillin: 125 mg/5 ml OR 250 mg/5 ml
- Ibuprofen: 100 mg/5 ml
- Cetirizine: 5 mg/5 ml
- Azithromycin: 100 mg/5 ml OR 200 mg/5 ml
