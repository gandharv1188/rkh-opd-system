# SNOMED CT India Drug Extension — Data Dictionary

**Source:** SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z
**Release:** March 2026
**Total concepts:** 244,714
**Total branded drugs (Real Clinical Drugs):** 91,718
**Total generic drugs (Clinical Drugs):** ~1,704

---

## What data is available per drug

### For each Branded Drug (Real Clinical Drug)

Every branded drug in the India extension carries the following information:

| #   | Data Item                             | Source               | Description                                                                                        | Example (Augmentin DUO 500+125 Tablet)                                                                                                           |
| --- | ------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **SNOMED Concept ID**                 | Concept file         | Unique numeric identifier for this specific branded product                                        | `1067681000189102`                                                                                                                               |
| 2   | **Fully Specified Name (FSN)**        | Description file     | Complete unambiguous name including brand, generic, strength, form, manufacturer, and semantic tag | `Augmentin DUO (amoxicillin and clavulanate potassium) 500 mg + 125 mg oral tablet GlaxoSmithKline Pharmaceuticals Limited (real clinical drug)` |
| 3   | **Preferred Term**                    | Description file     | Shorter display name without manufacturer                                                          | `Augmentin DUO (amoxicillin and clavulanate potassium) 500 mg + 125 mg oral tablet`                                                              |
| 4   | **Short Synonym**                     | Description file     | Shortest display name                                                                              | `Augmentin DUO 500 mg + 125 mg oral tablet`                                                                                                      |
| 5   | **Brand Name + Manufacturer Synonym** | Description file     | Brand + generic + strength + form + manufacturer (without semantic tag)                            | `Augmentin DUO (amoxicillin and clavulanate potassium) 500 mg + 125 mg oral tablet GlaxoSmithKline Pharmaceuticals Limited`                      |
| 6   | **IS-A Parent (Generic)**             | Relationship file    | The generic Clinical Drug concept this brand belongs to                                            | → `323539009` (Amoxicillin 500mg + Clavulanic acid 125mg oral tablet)                                                                            |
| 7   | **IS-A Parent (Brand Family)**        | Relationship file    | The Real Medicinal Product (brand family, all strengths)                                           | → `1053441000189109` (Augmentin DUO [GSK])                                                                                                       |
| 8   | **Manufacturer (Supplier)**           | Relationship file    | The pharmaceutical company that makes this product                                                 | → `677631000189103` (GlaxoSmithKline Pharmaceuticals Limited)                                                                                    |
| 9   | **Trade Name**                        | Relationship file    | The registered brand name                                                                          | → `51621000189101` (Augmentin DUO)                                                                                                               |
| 10  | **Dose Form**                         | Relationship file    | Pharmaceutical form of the product                                                                 | → `421026006` (Oral tablet)                                                                                                                      |
| 11  | **Unit of Presentation**              | Relationship file    | The countable unit in which the drug is dispensed                                                  | → `732936001` (Tablet)                                                                                                                           |
| 12  | **Count of Active Ingredients**       | Concrete Values file | Number of active ingredients in the product                                                        | `2`                                                                                                                                              |

### Per Ingredient (one entry per active ingredient, grouped by relationship group)

| #   | Data Item                                    | Source               | Description                                                                                                      | Example (Ingredient 1: Amoxicillin)                   |
| --- | -------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 13  | **Precise Active Ingredient**                | Relationship file    | The exact chemical substance                                                                                     | → `372687004` (Amoxicillin)                           |
| 14  | **Basis of Strength Substance**              | Relationship file    | The substance in terms of which the strength is expressed (may differ from ingredient — e.g., salt vs base form) | → `372687004` (Amoxicillin)                           |
| 15  | **Presentation Strength Numerator Value**    | Concrete Values file | Amount of ingredient per unit of presentation (e.g., per tablet) — the numerator                                 | `500`                                                 |
| 16  | **Presentation Strength Numerator Unit**     | Relationship file    | Unit of the numerator                                                                                            | → `258684004` (mg)                                    |
| 17  | **Presentation Strength Denominator Value**  | Concrete Values file | The denominator quantity (usually 1 for tablets/capsules)                                                        | `1`                                                   |
| 18  | **Presentation Strength Denominator Unit**   | Relationship file    | Unit of the denominator                                                                                          | → `732936001` (Tablet)                                |
| 19  | **Concentration Strength Numerator Value**   | Concrete Values file | Amount per volume (for liquids) — the numerator                                                                  | (not applicable for tablets; for syrups: e.g., `250`) |
| 20  | **Concentration Strength Numerator Unit**    | Relationship file    | Unit of concentration numerator                                                                                  | → `258684004` (mg)                                    |
| 21  | **Concentration Strength Denominator Value** | Concrete Values file | Volume denominator (for liquids)                                                                                 | (e.g., `5` for "per 5 mL")                            |
| 22  | **Concentration Strength Denominator Unit**  | Relationship file    | Unit of concentration denominator                                                                                | → `258685003` (mL)                                    |

---

## Relationship Type IDs (for decoding the RF2 files)

### Product-Level Relationships (Group 0)

| Type ID     | Relationship Name          | Points To                                        |
| ----------- | -------------------------- | ------------------------------------------------ |
| `116680003` | IS-A                       | Parent concept (generic drug or brand family)    |
| `411116001` | Has manufactured dose form | Dose form concept (e.g., Oral tablet, Injection) |
| `763032000` | Has unit of presentation   | Unit concept (e.g., Tablet, Capsule, mL)         |
| `774158006` | Has trade name             | Brand name concept                               |
| `774159003` | Has supplier               | Manufacturer/company concept                     |
| `766939001` | Has trade name qualifier   | Brand qualifier                                  |

### Ingredient-Level Relationships (Group 1, 2, 3, ...)

| Type ID     | Relationship Name                           | Points To                             |
| ----------- | ------------------------------------------- | ------------------------------------- |
| `762949000` | Has precise active ingredient               | Substance concept (e.g., Amoxicillin) |
| `127489000` | Has active ingredient                       | Substance concept (less specific)     |
| `732943007` | Has basis of strength substance             | Substance the strength refers to      |
| `733722007` | Has presentation strength numerator unit    | Unit concept (mg, mcg, IU, etc.)      |
| `732945000` | Has presentation strength denominator unit  | Unit concept (tablet, mL, etc.)       |
| `733725009` | Has concentration strength numerator unit   | Unit concept                          |
| `732947008` | Has concentration strength denominator unit | Unit concept                          |

### Concrete Value Type IDs (numeric values)

| Type ID      | Value Name                               | Meaning                                                 |
| ------------ | ---------------------------------------- | ------------------------------------------------------- |
| `1142135004` | Presentation strength numerator value    | Amount per unit (e.g., 500 for "500 mg/tablet")         |
| `1142136003` | Presentation strength denominator value  | Usually 1 (1 tablet, 1 capsule)                         |
| `1142137007` | Concentration strength numerator value   | Amount per volume (e.g., 250 for "250 mg/5 mL")         |
| `1142138002` | Concentration strength denominator value | Volume (e.g., 5 for "per 5 mL")                         |
| `1142139005` | Count of base of active ingredient       | Number of active ingredients (e.g., 2 for a combo drug) |
| `1142140007` | Count of units of presentation           | Units in the pack (if applicable)                       |

---

## Concept Hierarchy

```
Medicinal Product (abstract)
  └── Clinical Drug (generic — e.g., "Amoxicillin 500 mg oral tablet")
        └── Real Clinical Drug (branded — e.g., "Augmentin DUO 500 mg tablet GSK")

Real Medicinal Product (brand family — e.g., "Augmentin DUO [GSK]")
  └── Real Clinical Drug (specific strength of that brand)
```

---

## Description Types

| Type ID              | Name                       | Purpose                                           |
| -------------------- | -------------------------- | ------------------------------------------------- |
| `900000000000003001` | Fully Specified Name (FSN) | Unambiguous, includes semantic tag in parentheses |
| `900000000000013009` | Synonym / Preferred Term   | Shorter display name                              |

---

## What is NOT in the India Drug Extension

| Data                                                                          | Available?                 | Where to get it                 |
| ----------------------------------------------------------------------------- | -------------------------- | ------------------------------- |
| Dosing guidelines (mg/kg, frequency)                                          | No                         | IAP Drug Formulary, BNFC        |
| Drug interactions                                                             | No                         | Micromedex, UpToDate            |
| Contraindications                                                             | No                         | BNFC, drug monographs           |
| Side effects                                                                  | No                         | BNFC, manufacturer PI           |
| Pregnancy/lactation safety                                                    | No                         | BNFC, TGA categories            |
| Renal/hepatic dose adjustment                                                 | No                         | BNFC, Lexicomp                  |
| MRP / pricing                                                                 | No                         | 1mg.com, NPPA                   |
| Scheduling (Schedule H, X, etc.)                                              | No                         | CDSCO                           |
| International SNOMED concepts (ingredient names, dose form names, unit names) | No — referenced by ID only | SNOMED CT International Edition |

---

## Files in the Release Package

| File                                       | Content                                                                 | Rows      |
| ------------------------------------------ | ----------------------------------------------------------------------- | --------- |
| `sct2_Concept_Snapshot`                    | All concept IDs with active/inactive status                             | 244,715   |
| `sct2_Description_Snapshot-en`             | Human-readable names (FSN + synonyms) in English                        | 678,501   |
| `sct2_Relationship_Snapshot`               | Concept-to-concept relationships (IS-A, has ingredient, has form, etc.) | 1,506,423 |
| `sct2_RelationshipConcreteValues_Snapshot` | Numeric values (strength numerator/denominator, counts)                 | 436,817   |
| `sct2_Identifier_Snapshot`                 | External identifiers mapped to SNOMED concepts                          | —         |
| `sct2_StatedRelationship_Snapshot`         | Authoring-form relationships (used by terminology tools)                | —         |
| `sct2_sRefset_OWLExpressionSnapshot`       | OWL axiom definitions (for ontology reasoners)                          | —         |
| `der2_cRefset_LanguageSnapshot-en`         | Language preference flags for descriptions                              | —         |
| `der2_cRefset_AssociationSnapshot`         | Concept replacement/historical associations                             | —         |
| `der2_cRefset_AttributeValueSnapshot`      | Concept inactivation reasons                                            | —         |
