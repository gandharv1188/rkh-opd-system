# Drug Formulary Data Structure — Industry Standards Research

**Date:** 2026-03-24
**Purpose:** Design the proper data structure for our hospital formulary, aligned with international and Indian standards.

---

## 1. ABDM India — FHIR R4 Medication Profile (v6.5.0)

**Source:** [ABDM FHIR IG - Medication](https://nrces.in/ndhm/fhir/r4/StructureDefinition-Medication.html)

ABDM uses FHIR R4 with India-specific extensions. This is the standard we should align with.

### Medication Resource Structure

```json
{
  "resourceType": "Medication",
  "id": "example-amox-clav",
  "code": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "398731002",
        "display": "Amoxicillin 500 mg and clavulanic acid 125 mg oral tablet"
      }
    ],
    "text": "Amoxicillin + Clavulanic Acid 500/125 mg Tablet"
  },
  "status": "active",
  "manufacturer": {
    "reference": "Organization/glaxosmithkline"
  },
  "form": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "385055001",
        "display": "Tablet"
      }
    ]
  },
  "ingredient": [
    {
      "itemCodeableConcept": {
        "coding": [
          {
            "system": "http://snomed.info/sct",
            "code": "372687004",
            "display": "Amoxicillin"
          }
        ]
      },
      "isActive": true,
      "strength": {
        "numerator": { "value": 500, "unit": "mg" },
        "denominator": { "value": 1, "unit": "tablet" }
      }
    },
    {
      "itemCodeableConcept": {
        "coding": [
          {
            "system": "http://snomed.info/sct",
            "code": "395938000",
            "display": "Clavulanic acid"
          }
        ]
      },
      "isActive": true,
      "strength": {
        "numerator": { "value": 125, "unit": "mg" },
        "denominator": { "value": 1, "unit": "tablet" }
      }
    }
  ],
  "batch": {
    "lotNumber": "ABC123",
    "expirationDate": "2027-06-30"
  }
}
```

### Key Design Principles from ABDM/FHIR

1. **Each ingredient is a separate object** with its own strength (numerator/denominator ratio)
2. **Strength is a Ratio** — numerator (amount) / denominator (per unit)
3. **Combination drugs** have multiple `ingredient` entries, each with own strength
4. **Drug codes** use SNOMED CT (International + India National Extension)
5. **Form** is coded (SNOMED CT dose form codes)
6. **Identifier** uses HSN (Harmonized System of Nomenclature) — India-specific

---

## 2. RxNorm (US National Library of Medicine)

**Source:** [RxNorm Overview](https://www.nlm.nih.gov/research/umls/rxnorm/overview.html)

### Key Structure

- Each drug has: **Ingredient + Strength + Dose Form**
- Strength expressed as **numerator/denominator** (e.g., 20 mg/mL, not "100 mg/5 mL")
- Combination drugs: **separate strength for each ingredient**
- Display name: `"Amoxicillin 500 MG / Clavulanate 125 MG Oral Tablet"`

### Term Types

| Code | Meaning                          | Example                         |
| ---- | -------------------------------- | ------------------------------- |
| IN   | Ingredient                       | Amoxicillin                     |
| SCD  | Semantic Clinical Drug           | Amoxicillin 250 MG Oral Capsule |
| SBD  | Semantic Branded Drug            | Amoxil 250 MG Oral Capsule      |
| SCDC | Semantic Clinical Drug Component | Amoxicillin 250 MG              |
| SBDC | Semantic Branded Drug Component  | Amoxil 250 MG                   |

---

## 3. SNOMED CT Medicinal Product Model

**Source:** [SNOMED CT Ingredient Strength Attributes](https://confluence.ihtsdotools.org/display/DOCMPM/Ingredient+Strength+Attributes)

### Two Types of Strength

| Type                       | Meaning                                          | Example           |
| -------------------------- | ------------------------------------------------ | ----------------- |
| **Presentation Strength**  | Amount per discrete unit (tablet, capsule, vial) | 500 mg / 1 tablet |
| **Concentration Strength** | Amount per volume                                | 250 mg / 5 mL     |

### Key Attributes

- `Has active ingredient` → the substance
- `Has basis of strength substance` → what the strength refers to (may differ from ingredient — e.g., "amoxicillin trihydrate" ingredient but strength expressed as "amoxicillin")
- `Has presentation strength numerator value/unit`
- `Has presentation strength denominator value/unit`
- `Has concentration strength numerator value/unit`
- `Has concentration strength denominator value/unit`

---

## 4. ABDM Medicine Codes (India Drug Extension)

**Source:** [ABDM Medicine Codes ValueSet](https://www.nrces.in/ndhm/fhir/r4/ValueSet-ndhm-medicine-codes.html)

- Uses SNOMED CT International Edition + **Common Drug Codes for India (National Extension)**
- Drug codes include: Clinical Drugs AND Branded Medicines (Real Clinical Drugs)
- Display name pattern: `"[Drug Name] [Strength] [Dosage Form]"`
- Examples:
  - `"Aspirin 75 mg oral tablet"`
  - `"Acetaminophen 325 mg and oxycodone hydrochloride 5 mg oral tablet"`
  - `"Diazepam 5 mg/mL solution for injection"`

---

## 5. Proposed Structure for Our Hospital Formulary

Based on ABDM FHIR R4 + SNOMED CT + RxNorm best practices:

### Formulation Entry (per drug, per strength/form)

```json
{
  "form": "Tablet",
  "form_code": "385055001",
  "route": "PO",
  "ingredients": [
    {
      "name": "Amoxicillin",
      "is_active": true,
      "is_primary": true,
      "strength_numerator": 500,
      "strength_numerator_unit": "mg",
      "strength_denominator": 1,
      "strength_denominator_unit": "tablet",
      "basis_of_strength": "Amoxicillin"
    },
    {
      "name": "Clavulanic acid",
      "is_active": true,
      "is_primary": false,
      "strength_numerator": 125,
      "strength_numerator_unit": "mg",
      "strength_denominator": 1,
      "strength_denominator_unit": "tablet",
      "basis_of_strength": "Clavulanic acid"
    }
  ],
  "indian_brands": [
    {
      "name": "Augmentin 625 Duo",
      "manufacturer": "GSK",
      "verified_on": "1mg.com"
    }
  ],
  "display_name": "Amoxicillin 500 mg + Clavulanic acid 125 mg Tablet",
  "indian_conc_note": "Amoxicillin 500 mg + Clavulanic acid 125 mg per tablet"
}
```

### For Liquid Formulations (Concentration Strength)

```json
{
  "form": "Oral suspension",
  "form_code": "385024007",
  "route": "PO",
  "ingredients": [
    {
      "name": "Amoxicillin",
      "is_active": true,
      "is_primary": true,
      "strength_numerator": 400,
      "strength_numerator_unit": "mg",
      "strength_denominator": 5,
      "strength_denominator_unit": "mL",
      "basis_of_strength": "Amoxicillin"
    },
    {
      "name": "Clavulanic acid",
      "is_active": true,
      "is_primary": false,
      "strength_numerator": 57,
      "strength_numerator_unit": "mg",
      "strength_denominator": 5,
      "strength_denominator_unit": "mL",
      "basis_of_strength": "Clavulanic acid"
    }
  ],
  "indian_brands": [
    {
      "name": "Augmentin Duo DS",
      "manufacturer": "GSK",
      "verified_on": "1mg.com"
    }
  ],
  "display_name": "Amoxicillin 400 mg + Clavulanic acid 57 mg per 5 mL Suspension"
}
```

### For Single-Ingredient Drugs (Simpler)

```json
{
  "form": "Oral drops",
  "form_code": "385023001",
  "route": "PO",
  "ingredients": [
    {
      "name": "Paracetamol",
      "is_active": true,
      "is_primary": true,
      "strength_numerator": 100,
      "strength_numerator_unit": "mg",
      "strength_denominator": 1,
      "strength_denominator_unit": "mL",
      "basis_of_strength": "Paracetamol"
    }
  ],
  "indian_brands": [
    {
      "name": "Calpol Drops",
      "manufacturer": "GSK",
      "verified_on": "1mg.com"
    }
  ],
  "display_name": "Paracetamol 100 mg/mL Oral Drops"
}
```

### For Drops with Manufacturer-Labeled Per-Drop Strength

```json
{
  "form": "Oral drops",
  "form_code": "385023001",
  "route": "PO",
  "ingredients": [
    {
      "name": "Cholecalciferol",
      "is_active": true,
      "is_primary": true,
      "strength_numerator": 400,
      "strength_numerator_unit": "IU",
      "strength_denominator": 1,
      "strength_denominator_unit": "drop",
      "basis_of_strength": "Cholecalciferol"
    }
  ],
  "indian_brands": [
    {
      "name": "D-Rise Drops",
      "manufacturer": "USV",
      "verified_on": "1mg.com"
    }
  ],
  "display_name": "Cholecalciferol 400 IU per drop Oral Drops"
}
```

---

## 6. How calcDose() Should Use This Structure

```javascript
function calcDose(weight_kg, dose_per_kg, freq, formulation) {
  // Find the primary ingredient
  const primary = formulation.ingredients.find((i) => i.is_primary);

  // Calculate dose needed
  const totalDay = weight_kg * dose_per_kg;
  const perDose = totalDay / freq;

  // Calculate volume/units needed
  const strengthPerUnit =
    primary.strength_numerator / primary.strength_denominator;
  // strengthPerUnit = 100 mg / 1 mL = 100 mg per mL (for Paracetamol drops)
  // strengthPerUnit = 500 mg / 1 tablet = 500 mg per tablet

  const unitsNeeded = perDose / strengthPerUnit;
  // For drops: unitsNeeded in mL, then convert: mL × 20 = drops
  // For tablets: unitsNeeded in tablets (round to ¼)
  // For syrup: unitsNeeded in mL (round to 0.5 mL)

  // If denominator is "drop", strength is already per-drop — no conversion needed
  if (primary.strength_denominator_unit === "drop") {
    return Math.round(perDose / primary.strength_numerator); // direct drop count
  }
}
```

---

## 7. Comparison: Current vs Proposed

| Aspect                     | Current Structure                                         | Proposed (ABDM-aligned)                                                                                                             |
| -------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Single-ingredient strength | `conc_qty: 100, conc_unit: "mg"`                          | `ingredients: [{strength_numerator: 100, strength_numerator_unit: "mg", strength_denominator: 1, strength_denominator_unit: "mL"}]` |
| Combination drug           | `conc_qty: 2, conc_unit: "mg CPM + 5mg PE"` (hacky)       | `ingredients: [{name: "Chlorpheniramine", strength_numerator: 2, ...}, {name: "Phenylephrine", strength_numerator: 5, ...}]`        |
| Primary component          | Not tracked                                               | `is_primary: true` on one ingredient                                                                                                |
| Per-drop labeling          | Breaks calcDose                                           | `strength_denominator_unit: "drop"` — calcDose handles it                                                                           |
| ABDM compliance            | No                                                        | Yes — maps directly to FHIR Medication.ingredient                                                                                   |
| Brand names                | `indian_brand: "Augmentin 625 Duo (GSK)"` (single string) | `indian_brands: [{name, manufacturer, verified_on}]` (structured)                                                                   |

---

## 8. Migration Path

1. **Keep backward compatibility**: existing `conc_qty`/`conc_unit` fields remain for single-ingredient drugs
2. **Add `ingredients` array**: for ALL drugs (single and combination)
3. **Add `is_primary` flag**: identifies which ingredient drives dose calculation
4. **Deprecate `conc_qty`/`conc_unit`**: frontend reads from `ingredients` first, falls back to old fields
5. **gradual migration**: agents update drugs in batches, adding `ingredients` array

---

## References

1. [ABDM FHIR IG v6.5.0 — Medication Profile](https://nrces.in/ndhm/fhir/r4/StructureDefinition-Medication.html)
2. [ABDM Medicine Codes ValueSet](https://www.nrces.in/ndhm/fhir/r4/ValueSet-ndhm-medicine-codes.html)
3. [FHIR R4 Medication Resource](https://hl7.org/fhir/medication.html)
4. [RxNorm Overview — NLM](https://www.nlm.nih.gov/research/umls/rxnorm/overview.html)
5. [SNOMED CT Ingredient Strength Attributes](https://confluence.ihtsdotools.org/display/DOCMPM/Ingredient+Strength+Attributes)
6. [SNOMED CT Medicinal Product Model](https://pmc.ncbi.nlm.nih.gov/articles/PMC9584358/)
7. [NRCES — Common Drug Codes for India](https://nrces.in/services/national-releases)
