# Universal Drug Dose Calculator System

## FHIR R4 + ABDM v6.5 Compliant Architecture

---

## 1. SYSTEM OVERVIEW

This system has three layers:

1. **Schema** — FHIR R4 resources with ABDM extensions
2. **Calculation Engine** — Pure logic, independent of transport
3. **API Contracts** — RESTful endpoints with FHIR request/response

---

## 2. FHIR RESOURCE MAP

```
MedicationKnowledge          ← Drug + Formulary entry
  └── ingredient[]           ← Active ingredients + concentrations
  └── administrationGuidelines[]  ← Dosing rules per indication
  └── drugCharacteristic[]   ← PK parameters, formulation properties
  └── regulatory[]           ← CDSCO / ABDM jurisdiction

Patient                      ← Patient variables
  └── extension[weight]
  └── extension[gestationalAge]
  └── extension[renalFunction]
  └── extension[hepaticScore]

MedicationRequest            ← Output: the actual prescription
  └── dosageInstruction[]
  └── dispenseRequest

Observation                  ← Lab values feeding into adjustments
  └── serum creatinine
  └── GFR
  └── albumin
```

---

## 3. DATABASE SCHEMA (JSON — FHIR R4 MedicationKnowledge Profile)

### 3.1 Core Drug Entry

```json
{
  "resourceType": "MedicationKnowledge",
  "id": "wikoryl-af-drops",
  "meta": {
    "profile": [
      "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Medication",
      "http://hl7.org/fhir/StructureDefinition/MedicationKnowledge"
    ]
  },

  "code": {
    "coding": [
      {
        "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
        "code": "857005",
        "display": "Chlorpheniramine / Phenylephrine Oral Drops"
      },
      {
        "system": "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-drugcode",
        "code": "IN-WIKORYL-AF-DROPS",
        "display": "Wikoryl AF Oral Drops"
      }
    ],
    "text": "Wikoryl AF Oral Drops"
  },

  "status": "active",

  "manufacturer": {
    "display": "Alembic Pharmaceuticals Ltd"
  },

  "doseForm": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "385023001",
        "display": "Oral drops"
      }
    ]
  },

  "amount": {
    "numerator": { "value": 15, "unit": "mL" },
    "denominator": { "value": 1, "unit": "bottle" }
  },

  // ── ACTIVE INGREDIENTS ──────────────────────────────────────────
  "ingredient": [
    {
      "itemCodeableConcept": {
        "coding": [
          {
            "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
            "code": "2676",
            "display": "Chlorpheniramine Maleate"
          }
        ]
      },
      "isActive": true,
      "strength": {
        "numerator": { "value": 2.5, "unit": "mg" },
        "denominator": { "value": 1, "unit": "mL" }
      },
      "extension": [
        {
          "url": "https://nrces.in/ndhm/fhir/r4/Extension/ingredient-dose-basis",
          "extension": [
            { "url": "dosingBasis", "valueCode": "mg/kg/dose" },
            {
              "url": "standardDose",
              "valueQuantity": { "value": 0.1, "unit": "mg/kg/dose" }
            },
            {
              "url": "minDose",
              "valueQuantity": { "value": 0.05, "unit": "mg/kg/dose" }
            },
            {
              "url": "maxDose",
              "valueQuantity": { "value": 0.2, "unit": "mg/kg/dose" }
            },
            {
              "url": "maxSingleDose",
              "valueQuantity": { "value": 4, "unit": "mg" }
            },
            {
              "url": "maxDailyDose",
              "valueQuantity": { "value": 16, "unit": "mg/day" }
            },
            { "url": "weightBasis", "valueCode": "actual" }
          ]
        }
      ]
    },
    {
      "itemCodeableConcept": {
        "coding": [
          {
            "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
            "code": "8163",
            "display": "Phenylephrine Hydrochloride"
          }
        ]
      },
      "isActive": true,
      "strength": {
        "numerator": { "value": 1, "unit": "mg" },
        "denominator": { "value": 1, "unit": "mL" }
      },
      "extension": [
        {
          "url": "https://nrces.in/ndhm/fhir/r4/Extension/ingredient-dose-basis",
          "extension": [
            { "url": "dosingBasis", "valueCode": "mg/kg/dose" },
            {
              "url": "standardDose",
              "valueQuantity": { "value": 0.05, "unit": "mg/kg/dose" }
            },
            {
              "url": "minDose",
              "valueQuantity": { "value": 0.025, "unit": "mg/kg/dose" }
            },
            {
              "url": "maxDose",
              "valueQuantity": { "value": 0.1, "unit": "mg/kg/dose" }
            },
            {
              "url": "maxSingleDose",
              "valueQuantity": { "value": 10, "unit": "mg" }
            },
            {
              "url": "maxDailyDose",
              "valueQuantity": { "value": 40, "unit": "mg/day" }
            },
            { "url": "weightBasis", "valueCode": "actual" }
          ]
        }
      ]
    }
  ],

  // ── FORMULATION / DISPENSING PROPERTIES ─────────────────────────
  "drugCharacteristic": [
    {
      "type": {
        "coding": [
          {
            "system": "http://terminology.hl7.org/CodeSystem/medicationknowledge-characteristic",
            "code": "dropsPerMl"
          }
        ]
      },
      "valueQuantity": { "value": 20, "unit": "drops/mL" }
    },
    {
      "type": {
        "coding": [{ "code": "dispensingUnit" }]
      },
      "valueString": "drops"
    },
    {
      "type": { "coding": [{ "code": "minAgeMonths" }] },
      "valueQuantity": { "value": 48, "unit": "months" }
    },
    {
      "type": { "coding": [{ "code": "multiIngredientStrategy" }] },
      "valueString": "limiting"
    }
  ],

  // ── DOSING GUIDELINES ────────────────────────────────────────────
  "administrationGuidelines": [
    {
      "indication": {
        "coding": [
          {
            "system": "http://snomed.info/sct",
            "code": "82272006",
            "display": "Common cold"
          }
        ]
      },
      "dosage": [
        {
          "type": { "text": "standard" },
          "dosage": [
            {
              "timing": {
                "repeat": {
                  "frequency": 3,
                  "period": 1,
                  "periodUnit": "d"
                }
              },
              "route": {
                "coding": [
                  {
                    "system": "http://snomed.info/sct",
                    "code": "26643006",
                    "display": "Oral"
                  }
                ]
              },
              "doseAndRate": [
                {
                  "type": { "text": "calculated" },
                  "doseRange": {
                    "low": { "value": 0.04, "unit": "mL/kg" },
                    "high": { "value": 0.05, "unit": "mL/kg" }
                  }
                }
              ],
              "maxDosePerAdministration": { "value": 1, "unit": "mL" },
              "maxDosePerPeriod": {
                "numerator": { "value": 4, "unit": "mL" },
                "denominator": { "value": 1, "unit": "d" }
              }
            }
          ]
        }
      ],
      "patientCharacteristics": [
        {
          "characteristicCodeableConcept": {
            "coding": [{ "code": "bodyWeight" }]
          }
        },
        {
          "characteristicCodeableConcept": {
            "coding": [{ "code": "ageGroup", "display": "Pediatric" }]
          },
          "value": ["4y - 12y"]
        }
      ]
    }
  ],

  // ── PHARMACOKINETICS (for advanced PK-based dosing) ──────────────
  "kinetics": [
    {
      "areaUnderCurve": [],
      "lethalDose50": [],
      "halfLifePeriod": {
        "value": 21,
        "unit": "h",
        "system": "http://unitsofmeasure.org"
      }
    }
  ],

  // ── REGULATORY (ABDM / CDSCO) ────────────────────────────────────
  "regulatory": [
    {
      "regulatoryAuthority": {
        "display": "Central Drugs Standard Control Organisation (CDSCO)"
      },
      "substitution": [
        {
          "type": {
            "coding": [
              { "code": "therapeutic", "display": "Therapeutic Substitution" }
            ]
          },
          "allowed": true
        }
      ],
      "schedule": [
        {
          "coding": [
            {
              "system": "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-drugschedule",
              "code": "H",
              "display": "Schedule H"
            }
          ]
        }
      ]
    }
  ]
}
```

---

### 3.2 Patient Resource (ABDM Profile)

```json
{
  "resourceType": "Patient",
  "id": "patient-001",
  "meta": {
    "profile": ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"]
  },
  "identifier": [
    {
      "type": {
        "coding": [
          { "code": "ABHA", "display": "Ayushman Bharat Health Account" }
        ]
      },
      "system": "https://abha.abdm.gov.in",
      "value": "91-1234-5678-9012"
    }
  ],
  "name": [{ "text": "Ramesh Kumar" }],
  "birthDate": "2022-03-10",
  "gender": "male",
  "extension": [
    {
      "url": "https://nrces.in/ndhm/fhir/r4/Extension/patient-weight",
      "valueQuantity": {
        "value": 10,
        "unit": "kg",
        "system": "http://unitsofmeasure.org",
        "code": "kg"
      }
    },
    {
      "url": "https://nrces.in/ndhm/fhir/r4/Extension/patient-height",
      "valueQuantity": { "value": 80, "unit": "cm" }
    },
    {
      "url": "https://nrces.in/ndhm/fhir/r4/Extension/patient-gestational-age",
      "valueQuantity": { "value": 40, "unit": "weeks" }
    },
    {
      "url": "https://nrces.in/ndhm/fhir/r4/Extension/renal-function",
      "extension": [
        {
          "url": "serumCreatinine",
          "valueQuantity": { "value": 0.4, "unit": "mg/dL" }
        },
        {
          "url": "GFR",
          "valueQuantity": { "value": 90, "unit": "mL/min/1.73m2" }
        },
        { "url": "renalImpairment", "valueCode": "none" }
      ]
    },
    {
      "url": "https://nrces.in/ndhm/fhir/r4/Extension/hepatic-function",
      "extension": [
        { "url": "childPughScore", "valueInteger": 5 },
        { "url": "hepaticImpairment", "valueCode": "none" }
      ]
    },
    {
      "url": "https://nrces.in/ndhm/fhir/r4/Extension/weight-basis-type",
      "valueCode": "actual"
    }
  ]
}
```

---

### 3.3 Dose Calculation Request (Custom Operation Input)

```json
{
  "resourceType": "Parameters",
  "parameter": [
    { "name": "medicationKnowledgeId", "valueString": "wikoryl-af-drops" },
    { "name": "patientId", "valueString": "patient-001" },
    {
      "name": "indication",
      "valueCoding": {
        "system": "http://snomed.info/sct",
        "code": "82272006",
        "display": "Common cold"
      }
    },
    { "name": "frequency", "valueInteger": 3 },
    { "name": "duration", "valueQuantity": { "value": 5, "unit": "d" } },
    { "name": "weightOverride", "valueQuantity": { "value": 10, "unit": "kg" } }
  ]
}
```

---

### 3.4 MedicationRequest Output (ABDM Prescription)

```json
{
  "resourceType": "MedicationRequest",
  "id": "rx-001",
  "meta": {
    "profile": [
      "https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest"
    ]
  },
  "status": "active",
  "intent": "order",
  "medicationReference": {
    "reference": "MedicationKnowledge/wikoryl-af-drops"
  },
  "subject": { "reference": "Patient/patient-001" },

  "dosageInstruction": [
    {
      "text": "10 drops (0.5 mL) orally, 3 times daily for 5 days",
      "timing": {
        "repeat": {
          "frequency": 3,
          "period": 1,
          "periodUnit": "d",
          "boundsDuration": { "value": 5, "unit": "d" }
        }
      },
      "route": {
        "coding": [
          {
            "system": "http://snomed.info/sct",
            "code": "26643006",
            "display": "Oral"
          }
        ]
      },
      "doseAndRate": [
        {
          "doseQuantity": {
            "value": 10,
            "unit": "drops",
            "system": "http://unitsofmeasure.org"
          }
        }
      ],
      "maxDosePerAdministration": { "value": 20, "unit": "drops" },
      "maxDosePerPeriod": {
        "numerator": { "value": 60, "unit": "drops" },
        "denominator": { "value": 1, "unit": "d" }
      },
      "extension": [
        {
          "url": "https://nrces.in/ndhm/fhir/r4/Extension/dose-calculation-detail",
          "extension": [
            {
              "url": "weightUsed",
              "valueQuantity": { "value": 10, "unit": "kg" }
            },
            {
              "url": "limitingIngredient",
              "valueString": "Chlorpheniramine Maleate"
            },
            { "url": "calculatedVolumeMl", "valueDecimal": 0.5 },
            { "url": "calculatedDrops", "valueDecimal": 10 },
            {
              "url": "mgPerKgAchieved",
              "valueString": "Chlorpheniramine: 0.125 mg/kg, Phenylephrine: 0.05 mg/kg"
            },
            { "url": "dosingBasis", "valueCode": "mg/kg/dose" },
            { "url": "capApplied", "valueBoolean": false }
          ]
        }
      ]
    }
  ],

  "dispenseRequest": {
    "quantity": { "value": 15, "unit": "mL" },
    "expectedSupplyDuration": { "value": 5, "unit": "d" }
  }
}
```

---

## 4. CALCULATION ENGINE (TypeScript / JavaScript)

```typescript
// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type DosingBasis =
  | "mg/kg/dose"
  | "mg/kg/day"
  | "mg/m2/dose"
  | "mg/m2/day"
  | "mcg/kg/dose"
  | "mmol/kg/dose"
  | "fixed"
  | "target_concentration"
  | "AUC_target";

type WeightBasis = "actual" | "ideal" | "adjusted" | "lean";
type DispensingUnit = "drops" | "mL" | "tablet" | "capsule" | "sachet" | "mg";
type ImpairmentLevel = "none" | "mild" | "moderate" | "severe";

interface Ingredient {
  name: string;
  rxNormCode?: string;
  concentrationMgPerMl: number; // for liquids
  strengthMgPerUnit?: number; // for tablets/capsules
  dosingBasis: DosingBasis;
  standardDoseMgPerUnit: number; // "unit" depends on dosingBasis
  minDoseMgPerUnit: number;
  maxDoseMgPerUnit: number;
  maxSingleDoseMg: number;
  maxDailyDoseMg: number;
  weightBasis: WeightBasis;
}

interface Formulation {
  type: DispensingUnit;
  dropsPerMl?: number; // default 20
  tabletStrengthMg?: number;
  capsuleStrengthMg?: number;
  canSplitTablet?: boolean;
  roundingUnit?: number; // e.g. 0.5 for half-tablets
}

interface DrugFormularyEntry {
  id: string;
  name: string;
  ingredients: Ingredient[];
  formulation: Formulation;
  multiIngredientStrategy: "limiting" | "primary";
  primaryIngredientIndex?: number;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  pkHalfLifeHours?: number;
  bioavailabilityFraction?: number; // F
  volumeOfDistributionLPerKg?: number; // Vd
  clearanceMlMinPer73m2?: number; // CL
  renalFractionExcreted?: number; // fe
  hepaticExtractionRatio?: number;
  isNarrowTherapeuticIndex?: boolean;
}

interface PatientParameters {
  weightKg: number;
  weightBasisType?: WeightBasis;
  ageMonths?: number;
  gestationalAgeWeeks?: number;
  heightCm?: number;
  sexBiologicalFemale?: boolean;
  gfrMlMinPer173m2?: number;
  serumCreatinineMgDl?: number;
  childPughScore?: number;
  serumAlbuminGDl?: number;
  isObese?: boolean;
  isPregnant?: boolean;
}

interface DosingRequest {
  drug: DrugFormularyEntry;
  patient: PatientParameters;
  frequencyPerDay: number;
  indication?: string;
  durationDays?: number;
  targetCssMgL?: number; // for target-concentration dosing
}

interface IngredientResult {
  ingredientName: string;
  dosingBasis: DosingBasis;
  weightUsedKg: number;
  bsaM2?: number;
  targetDoseMg: number;
  calculatedVolumeMl: number;
  calculatedUnits: number;
  dispensingUnit: DispensingUnit;
  capApplied: boolean;
  capType?: "maxSingleDose" | "maxDailyDose" | "adultEquivalent";
  mgPerKgAchieved: number;
  withinTherapeuticRange: boolean;
  isLimitingIngredient: boolean;
}

interface DoseCalculationResult {
  drugName: string;
  patientWeightKg: number;
  recommendedDosePerAdmin: number;
  dispensingUnit: DispensingUnit;
  recommendedVolumeMl?: number;
  frequencyPerDay: number;
  totalDailyDose: number;
  totalDailyDoseUnit: DispensingUnit;
  durationDays?: number;
  totalSupplyNeeded?: number;
  ingredientBreakdown: IngredientResult[];
  limitingIngredient: string;
  renalAdjustmentApplied: boolean;
  hepaticAdjustmentApplied: boolean;
  ageWarning?: string;
  safetyFlags: string[];
  calculationTrace: string[]; // human-readable steps
  fhirMedicationRequest: object; // ready-to-use FHIR resource
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: BSA (Mosteller formula)
// ═══════════════════════════════════════════════════════════════════

function calculateBSA(weightKg: number, heightCm: number): number {
  // Mosteller: BSA (m²) = sqrt((height_cm × weight_kg) / 3600)
  return Math.sqrt((heightCm * weightKg) / 3600);
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Ideal Body Weight (Devine formula)
// ═══════════════════════════════════════════════════════════════════

function idealBodyWeightKg(heightCm: number, female: boolean): number {
  const heightInches = heightCm / 2.54;
  const base = female ? 45.5 : 50.0;
  return base + 2.3 * (heightInches - 60);
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Adjusted Body Weight (for obese patients)
// ═══════════════════════════════════════════════════════════════════

function adjustedBodyWeightKg(actualKg: number, ibwKg: number): number {
  // ABW = IBW + 0.4 × (actual - IBW)
  return ibwKg + 0.4 * (actualKg - ibwKg);
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Cockcroft-Gault GFR
// ═══════════════════════════════════════════════════════════════════

function cockcroftGaultGFR(
  ageYears: number,
  weightKg: number,
  serumCrMgDl: number,
  female: boolean,
): number {
  const gfr = ((140 - ageYears) * weightKg) / (72 * serumCrMgDl);
  return female ? gfr * 0.85 : gfr;
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Renal Dose Adjustment Factor
// ═══════════════════════════════════════════════════════════════════

function renalAdjustmentFactor(
  gfr: number,
  renalFractionExcreted: number, // fe: 0-1
  normalGFR: number = 100,
): number {
  // Dose fraction = 1 - fe + fe × (GFR/normalGFR)
  const factor =
    1 - renalFractionExcreted + renalFractionExcreted * (gfr / normalGFR);
  return Math.min(1.0, Math.max(0.1, factor)); // clamp 10%-100%
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Hepatic Dose Adjustment Factor (Child-Pugh)
// ═══════════════════════════════════════════════════════════════════

function hepaticAdjustmentFactor(
  childPughScore: number,
  hepaticExtractionRatio: number, // 0-1
): number {
  if (!hepaticExtractionRatio || hepaticExtractionRatio < 0.3) return 1.0;
  if (childPughScore <= 6) return 1.0; // Child-Pugh A: no adjustment
  if (childPughScore <= 9) return 0.75; // Child-Pugh B: reduce 25%
  return 0.5; // Child-Pugh C: reduce 50%
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Select Weight to Use
// ═══════════════════════════════════════════════════════════════════

function selectWeight(patient: PatientParameters, basis: WeightBasis): number {
  if (basis === "actual" || !patient.heightCm) return patient.weightKg;

  const ibw = idealBodyWeightKg(
    patient.heightCm,
    patient.sexBiologicalFemale ?? false,
  );

  if (basis === "ideal") return ibw;

  if (basis === "adjusted") {
    return patient.weightKg > ibw
      ? adjustedBodyWeightKg(patient.weightKg, ibw)
      : ibw;
  }

  // lean — approximate as IBW for now
  return ibw;
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Convert dose to mg based on basis
// ═══════════════════════════════════════════════════════════════════

function computeTargetDoseMg(
  ingredient: Ingredient,
  patient: PatientParameters,
  frequencyPerDay: number,
  targetCssMgL?: number,
  drugClearanceMlMinPer73m2?: number,
  bioavailability?: number,
): { targetMg: number; weightUsed: number; bsa?: number } {
  const w = selectWeight(patient, ingredient.weightBasis);
  const basis = ingredient.dosingBasis;
  const dose = ingredient.standardDoseMgPerUnit;

  // mcg → mg
  const unit_factor = basis.startsWith("mcg") ? 0.001 : 1.0;

  if (basis === "mg/kg/dose" || basis === "mcg/kg/dose") {
    return { targetMg: dose * w * unit_factor, weightUsed: w };
  }

  if (basis === "mg/kg/day" || basis === "mcg/kg/day") {
    const perDose = (dose * w * unit_factor) / frequencyPerDay;
    return { targetMg: perDose, weightUsed: w };
  }

  if (basis === "mg/m2/dose" || basis === "mg/m2/day") {
    if (!patient.heightCm) throw new Error("Height required for BSA dosing");
    const bsa = calculateBSA(w, patient.heightCm);
    const perDose =
      basis === "mg/m2/day" ? (dose * bsa) / frequencyPerDay : dose * bsa;
    return { targetMg: perDose, weightUsed: w, bsa };
  }

  if (basis === "fixed") {
    // dose field holds the fixed mg value
    return { targetMg: dose, weightUsed: w };
  }

  if (
    basis === "target_concentration" &&
    targetCssMgL &&
    drugClearanceMlMinPer73m2
  ) {
    // Maintenance dose = Css × CL / Bioavailability
    // CL in mL/min → convert to L/h: ÷ 1000 × 60
    const cl_L_h = (drugClearanceMlMinPer73m2 / 1000) * 60;
    const F = bioavailability ?? 1.0;
    const doseMgPerDay = (targetCssMgL * cl_L_h * 24) / F;
    return { targetMg: doseMgPerDay / frequencyPerDay, weightUsed: w };
  }

  throw new Error(`Unsupported dosing basis: ${basis}`);
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Convert mg → dispensing units
// ═══════════════════════════════════════════════════════════════════

function mgToDispensingUnit(
  doseMg: number,
  ingredient: Ingredient,
  formulation: Formulation,
): { volumeMl: number; units: number } {
  const type = formulation.type;

  if (type === "drops" || type === "mL") {
    const concMgMl = ingredient.concentrationMgPerMl;
    if (!concMgMl) throw new Error(`Concentration required for ${type} dosing`);
    const volumeMl = doseMg / concMgMl;
    const dropsPerMl = formulation.dropsPerMl ?? 20;
    const drops = type === "drops" ? volumeMl * dropsPerMl : volumeMl;
    return { volumeMl, units: drops };
  }

  if (type === "tablet" || type === "capsule") {
    const strength =
      ingredient.strengthMgPerUnit ??
      formulation.tabletStrengthMg ??
      formulation.capsuleStrengthMg;
    if (!strength) throw new Error("Tablet/capsule strength required");
    const rawUnits = doseMg / strength;
    // Round to nearest 0.5 (if splittable) or 1.0
    const roundTo = formulation.canSplitTablet ? 0.5 : 1.0;
    const units = Math.round(rawUnits / roundTo) * roundTo;
    return { volumeMl: 0, units };
  }

  if (type === "sachet") {
    const strength = ingredient.strengthMgPerUnit ?? 1000;
    return { volumeMl: 0, units: Math.ceil(doseMg / strength) };
  }

  // fallback: return raw mg
  return { volumeMl: 0, units: doseMg };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN CALCULATION FUNCTION
// ═══════════════════════════════════════════════════════════════════

function calculateDose(req: DosingRequest): DoseCalculationResult {
  const { drug, patient, frequencyPerDay } = req;
  const trace: string[] = [];
  const safetyFlags: string[] = [];
  let renalAdjApplied = false;
  let hepaticAdjApplied = false;

  // Step 1: Age check
  if (drug.minAgeMonths && patient.ageMonths !== undefined) {
    if (patient.ageMonths < drug.minAgeMonths) {
      safetyFlags.push(
        `⚠️ Patient age (${patient.ageMonths}m) below minimum age for this drug (${drug.minAgeMonths}m)`,
      );
    }
  }

  // Step 2: Compute per-ingredient results
  const ingredientResults: IngredientResult[] = drug.ingredients.map(
    (ing, idx) => {
      trace.push(`\n── Ingredient: ${ing.name} ──`);

      // 2a. Compute weight to use
      const w = selectWeight(patient, ing.weightBasis);
      trace.push(`Weight basis: ${ing.weightBasis} → ${w} kg`);

      // 2b. Compute target dose in mg
      const { targetMg, weightUsed, bsa } = computeTargetDoseMg(
        ing,
        patient,
        frequencyPerDay,
        req.targetCssMgL,
        drug.clearanceMlMinPer73m2,
        drug.bioavailabilityFraction,
      );
      trace.push(
        `Target dose: ${ing.standardDoseMgPerUnit} ${ing.dosingBasis} × ${w} kg = ${targetMg.toFixed(3)} mg`,
      );

      // 2c. Renal adjustment
      let adjustedMg = targetMg;
      if (
        patient.gfrMlMinPer173m2 !== undefined &&
        drug.renalFractionExcreted !== undefined &&
        patient.gfrMlMinPer173m2 < 90
      ) {
        const factor = renalAdjustmentFactor(
          patient.gfrMlMinPer173m2,
          drug.renalFractionExcreted,
        );
        adjustedMg *= factor;
        renalAdjApplied = true;
        trace.push(
          `Renal adjustment: GFR=${patient.gfrMlMinPer173m2}, factor=${factor.toFixed(2)} → ${adjustedMg.toFixed(3)} mg`,
        );
      }

      // 2d. Hepatic adjustment
      if (
        patient.childPughScore !== undefined &&
        drug.hepaticExtractionRatio !== undefined
      ) {
        const factor = hepaticAdjustmentFactor(
          patient.childPughScore,
          drug.hepaticExtractionRatio,
        );
        if (factor < 1.0) {
          adjustedMg *= factor;
          hepaticAdjApplied = true;
          trace.push(
            `Hepatic adjustment: Child-Pugh=${patient.childPughScore}, factor=${factor} → ${adjustedMg.toFixed(3)} mg`,
          );
        }
      }

      // 2e. Apply safety caps
      let capApplied = false;
      let capType: IngredientResult["capType"];

      if (adjustedMg > ing.maxSingleDoseMg) {
        trace.push(
          `Cap applied: ${adjustedMg.toFixed(3)} mg > maxSingleDose ${ing.maxSingleDoseMg} mg`,
        );
        adjustedMg = ing.maxSingleDoseMg;
        capApplied = true;
        capType = "maxSingleDose";
        safetyFlags.push(
          `${ing.name}: capped at max single dose ${ing.maxSingleDoseMg} mg`,
        );
      }

      const dailyMg = adjustedMg * frequencyPerDay;
      if (dailyMg > ing.maxDailyDoseMg) {
        const cappedPerDose = ing.maxDailyDoseMg / frequencyPerDay;
        trace.push(
          `Daily cap: ${dailyMg.toFixed(2)} mg/day > maxDaily ${ing.maxDailyDoseMg} → per dose = ${cappedPerDose.toFixed(3)} mg`,
        );
        adjustedMg = cappedPerDose;
        capApplied = true;
        capType = "maxDailyDose";
        safetyFlags.push(
          `${ing.name}: capped at max daily dose ${ing.maxDailyDoseMg} mg/day`,
        );
      }

      // 2f. Convert to volume/units
      const { volumeMl, units } = mgToDispensingUnit(
        adjustedMg,
        ing,
        drug.formulation,
      );
      trace.push(
        `Volume: ${adjustedMg.toFixed(3)} mg ÷ ${ing.concentrationMgPerMl} mg/mL = ${volumeMl.toFixed(3)} mL = ${units.toFixed(1)} ${drug.formulation.type}`,
      );

      const mgPerKgAchieved = adjustedMg / w;

      return {
        ingredientName: ing.name,
        dosingBasis: ing.dosingBasis,
        weightUsedKg: weightUsed,
        bsaM2: bsa,
        targetDoseMg: adjustedMg,
        calculatedVolumeMl: volumeMl,
        calculatedUnits: units,
        dispensingUnit: drug.formulation.type,
        capApplied,
        capType,
        mgPerKgAchieved,
        withinTherapeuticRange:
          mgPerKgAchieved >= ing.minDoseMgPerUnit &&
          mgPerKgAchieved <= ing.maxDoseMgPerUnit,
        isLimitingIngredient: false,
      };
    },
  );

  // Step 3: Multi-ingredient strategy
  let finalUnits: number;
  let limitingName: string;

  if (
    drug.multiIngredientStrategy === "limiting" ||
    drug.ingredients.length > 1
  ) {
    // Take the ingredient that requires the SMALLEST volume/units
    let minUnits = Infinity;
    let limitingIdx = 0;

    ingredientResults.forEach((r, i) => {
      if (r.calculatedUnits < minUnits) {
        minUnits = r.calculatedUnits;
        limitingIdx = i;
      }
    });

    ingredientResults[limitingIdx].isLimitingIngredient = true;
    finalUnits = ingredientResults[limitingIdx].calculatedUnits;
    limitingName = ingredientResults[limitingIdx].ingredientName;
    trace.push(
      `\nLimiting ingredient: ${limitingName} (${finalUnits.toFixed(1)} ${drug.formulation.type})`,
    );
  } else {
    const primaryIdx = drug.primaryIngredientIndex ?? 0;
    finalUnits = ingredientResults[primaryIdx].calculatedUnits;
    limitingName = ingredientResults[primaryIdx].ingredientName;
    ingredientResults[primaryIdx].isLimitingIngredient = true;
  }

  // Round to practical unit
  const roundedUnits = Math.round(finalUnits);
  const finalVolumeMl = roundedUnits / (drug.formulation.dropsPerMl ?? 20);
  const totalDailyUnits = roundedUnits * frequencyPerDay;

  trace.push(
    `\nFINAL: ${roundedUnits} ${drug.formulation.type} per dose × ${frequencyPerDay}/day = ${totalDailyUnits} ${drug.formulation.type}/day`,
  );

  // Step 4: Total supply
  const totalSupply = req.durationDays
    ? totalDailyUnits * req.durationDays
    : undefined;

  // Step 5: Build FHIR MedicationRequest
  const fhirRx = buildFHIRMedicationRequest({
    drug,
    patient,
    roundedUnits,
    finalVolumeMl,
    frequencyPerDay,
    durationDays: req.durationDays,
    ingredientResults,
    limitingName,
    renalAdjApplied,
    hepaticAdjApplied,
  });

  return {
    drugName: drug.name,
    patientWeightKg: patient.weightKg,
    recommendedDosePerAdmin: roundedUnits,
    dispensingUnit: drug.formulation.type,
    recommendedVolumeMl:
      drug.formulation.type === "drops" ? finalVolumeMl : undefined,
    frequencyPerDay,
    totalDailyDose: totalDailyUnits,
    totalDailyDoseUnit: drug.formulation.type,
    durationDays: req.durationDays,
    totalSupplyNeeded: totalSupply,
    ingredientBreakdown: ingredientResults,
    limitingIngredient: limitingName,
    renalAdjustmentApplied: renalAdjApplied,
    hepaticAdjustmentApplied: hepaticAdjApplied,
    safetyFlags,
    calculationTrace: trace,
    fhirMedicationRequest: fhirRx,
  };
}

// ═══════════════════════════════════════════════════════════════════
// FHIR OUTPUT BUILDER
// ═══════════════════════════════════════════════════════════════════

function buildFHIRMedicationRequest(params: any): object {
  const {
    drug,
    patient,
    roundedUnits,
    finalVolumeMl,
    frequencyPerDay,
    durationDays,
    ingredientResults,
    limitingName,
  } = params;

  return {
    resourceType: "MedicationRequest",
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest",
      ],
    },
    status: "active",
    intent: "order",
    medicationReference: { reference: `MedicationKnowledge/${drug.id}` },
    subject: { reference: `Patient/${patient.id ?? "unknown"}` },
    dosageInstruction: [
      {
        text: `${roundedUnits} ${drug.formulation.type} (${finalVolumeMl.toFixed(2)} mL) ${frequencyPerDay}x daily${durationDays ? ` for ${durationDays} days` : ""}`,
        timing: {
          repeat: {
            frequency: frequencyPerDay,
            period: 1,
            periodUnit: "d",
            ...(durationDays && {
              boundsDuration: { value: durationDays, unit: "d" },
            }),
          },
        },
        route: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "26643006",
              display: "Oral",
            },
          ],
        },
        doseAndRate: [
          {
            doseQuantity: {
              value: roundedUnits,
              unit: drug.formulation.type,
            },
          },
        ],
        extension: [
          {
            url: "https://nrces.in/ndhm/fhir/r4/Extension/dose-calculation-detail",
            extension: [
              { url: "weightUsedKg", valueDecimal: patient.weightKg },
              { url: "limitingIngredient", valueString: limitingName },
              { url: "calculatedVolumeMl", valueDecimal: finalVolumeMl },
              {
                url: "ingredientBreakdown",
                valueString: ingredientResults
                  .map(
                    (r: IngredientResult) =>
                      `${r.ingredientName}: ${r.targetDoseMg.toFixed(2)}mg (${r.mgPerKgAchieved.toFixed(3)} mg/kg)${r.isLimitingIngredient ? " ← LIMITING" : ""}`,
                  )
                  .join(" | "),
              },
            ],
          },
        ],
      },
    ],
  };
}
```

---

## 5. API CONTRACTS

### BASE URL

```
https://api.yoursystem.in/fhir/r4
```

All endpoints are FHIR R4 compliant. ABDM headers required on production.

---

### 5.1 Formulary CRUD

#### Create / Update Drug Entry

```
POST   /MedicationKnowledge
PUT    /MedicationKnowledge/{id}

Content-Type: application/fhir+json
X-ABDM-TxnId: {uuid}

Body: MedicationKnowledge resource (see Schema §3.1)

Response 201:
{
  "resourceType": "MedicationKnowledge",
  "id": "wikoryl-af-drops",
  "meta": { "versionId": "1", "lastUpdated": "2025-01-01T00:00:00Z" },
  ...
}
```

#### Get Drug Entry

```
GET /MedicationKnowledge/{id}
GET /MedicationKnowledge?code=IN-WIKORYL-AF-DROPS
GET /MedicationKnowledge?ingredient=Chlorpheniramine&doseform=drops

Response 200: MedicationKnowledge resource
Response 404: OperationOutcome
```

---

### 5.2 Patient Registration

```
POST /Patient
PUT  /Patient/{id}

Body: Patient resource (see Schema §3.2)

Response 201: Patient resource with assigned ABHA reference
```

---

### 5.3 ⭐ DOSE CALCULATION (Core Operation)

```
POST /MedicationKnowledge/$calculate-dose

Content-Type: application/fhir+json
X-ABDM-TxnId: {uuid}
X-ABDM-Timestamp: {ISO8601}

Body: Parameters resource (see Schema §3.3)
```

**Request Parameters:**

| Parameter             | Type    | Required | Description                   |
| --------------------- | ------- | -------- | ----------------------------- |
| medicationKnowledgeId | string  | YES      | Drug formulary ID             |
| patientId             | string  | NO       | Lookup patient from store     |
| weightKg              | decimal | YES\*    | Direct weight if no patientId |
| ageMonths             | integer | NO       | For age-based checks          |
| heightCm              | decimal | NO       | Required for BSA dosing       |
| gfr                   | decimal | NO       | For renal adjustment          |
| childPughScore        | integer | NO       | For hepatic adjustment        |
| indication            | Coding  | NO       | Indication-specific dosing    |
| frequency             | integer | YES      | Doses per day                 |
| durationDays          | integer | NO       | For total supply calc         |
| weightBasis           | code    | NO       | actual/ideal/adjusted         |
| targetCssMgL          | decimal | NO       | For TDM-based dosing          |

**Response 200:**

```json
{
  "resourceType": "Parameters",
  "parameter": [
    { "name": "result",
      "resource": {
        "resourceType": "MedicationRequest",
        ...
      }
    },
    { "name": "calculationDetail",
      "part": [
        { "name": "recommendedDosePerAdmin", "valueDecimal": 10 },
        { "name": "dispensingUnit",          "valueString": "drops" },
        { "name": "recommendedVolumeMl",     "valueDecimal": 0.5 },
        { "name": "frequencyPerDay",         "valueInteger": 3 },
        { "name": "totalDailyDose",          "valueDecimal": 30 },
        { "name": "limitingIngredient",      "valueString": "Chlorpheniramine Maleate" },
        { "name": "renalAdjustmentApplied",  "valueBoolean": false },
        { "name": "hepaticAdjustmentApplied","valueBoolean": false },
        { "name": "safetyFlags",             "valueString": "" },
        { "name": "ingredientBreakdown",
          "part": [
            {
              "name": "ingredient",
              "part": [
                { "name": "name",              "valueString": "Chlorpheniramine Maleate" },
                { "name": "targetDoseMg",      "valueDecimal": 1.25 },
                { "name": "mgPerKgAchieved",   "valueDecimal": 0.125 },
                { "name": "calculatedUnits",   "valueDecimal": 10 },
                { "name": "dispensingUnit",    "valueString": "drops" },
                { "name": "isLimiting",        "valueBoolean": true },
                { "name": "capApplied",        "valueBoolean": false },
                { "name": "inTherapeuticRange","valueBoolean": true }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**Error responses:**

```json
// 400 — Validation failure
{
  "resourceType": "OperationOutcome",
  "issue": [{
    "severity": "error",
    "code": "business-rule",
    "details": { "text": "Patient age below minimum for this drug" }
  }]
}

// 422 — Cannot calculate
{
  "resourceType": "OperationOutcome",
  "issue": [{
    "severity": "error",
    "code": "not-supported",
    "details": { "text": "BSA dosing requires patient height" }
  }]
}
```

---

### 5.4 Batch Calculation (Multiple Drugs)

```
POST /MedicationKnowledge/$batch-calculate

Body:
{
  "resourceType": "Bundle",
  "type": "batch",
  "entry": [
    {
      "request": { "method": "POST", "url": "MedicationKnowledge/$calculate-dose" },
      "resource": { Parameters for drug 1 }
    },
    {
      "request": { "method": "POST", "url": "MedicationKnowledge/$calculate-dose" },
      "resource": { Parameters for drug 2 }
    }
  ]
}

Response 200: Bundle of type batch-response
```

---

### 5.5 Formulary Search

```
GET /MedicationKnowledge?
    doseform=drops|tablet|syrup|capsule
    &ingredient=Chlorpheniramine
    &code=IN-xxx
    &status=active
    &_include=MedicationKnowledge:ingredient
    &_sort=name
    &_count=20

Response 200: Bundle of MedicationKnowledge resources
```

---

### 5.6 ABDM Prescription Output

```
POST /Composition   (PrescriptionRecord)

Wraps MedicationRequest output in ABDM-compliant
Composition → Bundle for PHR/ABHA sharing.

Headers:
  X-HIP-ID: {your-HIP-id}
  X-ABDM-TxnId: {uuid}

Body: ABDM PrescriptionRecord bundle
```

---

## 6. COMPLIANCE CHECKLIST

### FHIR R4 Compliance

- [x] All resources use FHIR R4 resource types
- [x] Coding systems: SNOMED CT, RxNorm, UCUM, LOINC
- [x] Extensions use proper FHIR extension URLs
- [x] OperationOutcome for all errors
- [x] Custom Operation ($calculate-dose) follows FHIR Operation framework
- [x] Bundle used for batch operations
- [x] Parameters resource for operation input/output

### ABDM v6.5 Compliance

- [x] Profile URLs: nrces.in/ndhm/fhir/r4
- [x] Patient identifier: ABHA number
- [x] PrescriptionRecord Composition profile
- [x] MedicationRequest ABDM profile
- [x] CDSCO regulatory data in MedicationKnowledge.regulatory
- [x] Drug schedule coding (Schedule H, H1, X)
- [x] Indian drug codes in CodeableConcept alongside RxNorm
- [x] X-ABDM-TxnId header on all transactions
- [x] Pharmacy Council of India (PCI) prescription compliance fields
