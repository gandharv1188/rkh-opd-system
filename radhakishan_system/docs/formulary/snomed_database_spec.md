# SNOMED CT Database Specification

**Project:** Radhakishan Hospital Prescription System
**Last updated:** 2026-03-25
**Scope:** Documents the SNOMED CT data sources, RF2 file format, drug concept hierarchy, relationship types, known data issues, extraction pipeline, diagnosis mapping, and unit concept IDs used to build the formulary.

---

## 1. SNOMED CT Editions Used

| Edition                                | Release                                                      | Module ID            | Package Name                                                           | Purpose                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **International Edition**              | March 2026 (20260301T120000Z)                                | `900000000000207008` | `SnomedCT_InternationalRF2_PRODUCTION_20260301T120000Z`                | Substance concepts, dose form concepts, unit concepts, generic Clinical Drug concepts, description terms for all referenced concepts                                                                                                |
| **India Drug Extension**               | March 2026 (20260313T120000Z)                                | `IN1000189`          | `SnomedCT_IndiaDrugExtensionRF2_PRODUCTION_IN1000189_20260313T120000Z` | Real Clinical Drug (branded) concepts, Real Medicinal Product (brand family) concepts, Indian manufacturer/supplier concepts, trade name concepts, presentation + concentration strength values, IS-A links from branded to generic |
| **AYUSH Extension**                    | (Referenced in ecosystem, not directly consumed by pipeline) | —                    | —                                                                      | Ayurveda, Yoga, Unani, Siddha, Homeopathy drug concepts                                                                                                                                                                             |
| **Patient Instructions Reference Set** | (Referenced in ecosystem, not directly consumed)             | —                    | —                                                                      | Standardised dosing instruction phrases                                                                                                                                                                                             |
| **Geographical Extension**             | (Referenced in ecosystem, not directly consumed)             | —                    | —                                                                      | India-specific geographical concepts (states, districts) for manufacturer addresses                                                                                                                                                 |

The extraction pipeline loads the **International Edition** and **India Drug Extension** only. International Edition provides the substance, dose form, unit, and generic Clinical Drug concepts that India Extension branded drugs reference via their relationships.

### Release Statistics (India Drug Extension)

| Metric                        | Count     |
| ----------------------------- | --------- |
| Total concepts                | 244,714   |
| Real Clinical Drugs (branded) | ~91,718   |
| Clinical Drugs (generic)      | ~1,704    |
| Descriptions (English)        | 678,501   |
| Relationships                 | 1,506,423 |
| Concrete Values               | 436,817   |

---

## 2. RF2 File Format

All SNOMED CT releases use the **RF2 (Release Format 2)** standard: tab-separated text files with a header row. Each row represents one component in its latest state (Snapshot view). Only rows with `active = 1` (column index 2) are used.

### 2.1 Concepts (`sct2_Concept_Snapshot`)

| Column | Field                | Description                    |
| ------ | -------------------- | ------------------------------ |
| 0      | `id`                 | SNOMED CT Concept ID (SCTID)   |
| 1      | `effectiveTime`      | Date of last change (YYYYMMDD) |
| 2      | `active`             | `1` = active, `0` = inactive   |
| 3      | `moduleId`           | Originating module             |
| 4      | `definitionStatusId` | Primitive or fully defined     |

### 2.2 Descriptions (`sct2_Description_Snapshot-en`)

| Column | Field                | Description                             |
| ------ | -------------------- | --------------------------------------- |
| 0      | `id`                 | Description ID                          |
| 1      | `effectiveTime`      | Date of last change                     |
| 2      | `active`             | `1` = active                            |
| 3      | `moduleId`           | Originating module                      |
| 4      | `conceptId`          | The concept this description belongs to |
| 5      | `languageCode`       | `en`                                    |
| 6      | `typeId`             | Description type (see below)            |
| 7      | `term`               | The human-readable text                 |
| 8      | `caseSignificanceId` | Case sensitivity rule                   |

**Description Type IDs:**

| Type ID              | Name                       | Purpose                                                                                |
| -------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `900000000000003001` | Fully Specified Name (FSN) | Unambiguous name including semantic tag in parentheses, e.g. `Amoxicillin (substance)` |
| `900000000000013009` | Synonym / Preferred Term   | Shorter display name without semantic tag                                              |

The pipeline loads both India Extension and International Edition description files. For each concept, `fsnMap` stores the FSN and `prefMap` stores the preferred term. When displaying a concept, preferred term is used first, falling back to FSN with the semantic tag stripped.

### 2.3 Relationships (`sct2_Relationship_Snapshot`)

| Column | Field                  | Description                                                                          |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| 0      | `id`                   | Relationship ID                                                                      |
| 1      | `effectiveTime`        | Date of last change                                                                  |
| 2      | `active`               | `1` = active                                                                         |
| 3      | `moduleId`             | Originating module                                                                   |
| 4      | `sourceId`             | Subject concept (the concept being described)                                        |
| 5      | `destinationId`        | Object concept (the target concept)                                                  |
| 6      | `relationshipGroup`    | Group number (`0` = ungrouped product-level, `1`/`2`/`3`... = per-ingredient groups) |
| 7      | `typeId`               | Relationship type concept ID (see Section 4)                                         |
| 8      | `characteristicTypeId` | Stated or inferred                                                                   |
| 9      | `modifierId`           | Existential or universal                                                             |

### 2.4 Concrete Values (`sct2_RelationshipConcreteValues_Snapshot`)

Same column layout as Relationships, except column 5 contains a literal numeric value prefixed with `#` (e.g. `#500`) instead of a destination concept ID. The `#` prefix is stripped during loading.

Concrete values carry the actual numeric strengths (e.g. `500` for "500 mg per tablet") and counts (e.g. number of active ingredients).

---

## 3. Drug Concept Hierarchy

```
Substance (semantic tag: "substance")
  e.g. Amoxicillin [372687004]
    |
    v  HAS_ACTIVE_INGREDIENT (reverse lookup)
    |
Clinical Drug (semantic tag: "clinical drug")
  = generic drug at a specific strength + dose form
  e.g. Amoxicillin 500 mg oral tablet [323539009]
    |
    v  IS-A (child → parent)
    |
Real Clinical Drug (semantic tag: "real clinical drug")
  = branded product at a specific strength + dose form + manufacturer
  e.g. Augmentin DUO 500 mg + 125 mg oral tablet GSK [1067681000189102]
    |
    v  IS-A (child → parent, second parent)
    |
Real Medicinal Product (semantic tag: "real medicinal product")
  = brand family across all strengths for one manufacturer
  e.g. Augmentin DUO [GSK] [1053441000189109]
```

### Key relationships between levels

| From               | To                                    | Via                                                                                |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------- |
| Real Clinical Drug | Clinical Drug (generic parent)        | IS-A (`116680003`) — identifies the generic equivalent                             |
| Real Clinical Drug | Real Medicinal Product (brand family) | IS-A (`116680003`) — identifies the brand family                                   |
| Clinical Drug      | Substance                             | HAS_PRECISE_ACTIVE_INGREDIENT (`762949000`) or HAS_ACTIVE_INGREDIENT (`127489000`) |

### Concept identification by FSN semantic tag

The pipeline identifies concept types by checking the FSN suffix:

| Semantic Tag in FSN                | Concept Type                  | Example                                          |
| ---------------------------------- | ----------------------------- | ------------------------------------------------ |
| `(substance)`                      | Substance / Active ingredient | `Amoxicillin (substance)`                        |
| `(clinical drug)` (without "real") | Generic Clinical Drug         | `Amoxicillin 500 mg oral tablet (clinical drug)` |
| `(real clinical drug)`             | Branded (Real) Clinical Drug  | `Augmentin DUO ... (real clinical drug)`         |
| `(real medicinal product)`         | Brand family                  | `Augmentin DUO [GSK] (real medicinal product)`   |

---

## 4. Relationship Types Used

### 4.1 Product-Level Relationships (Group 0)

These appear in relationship group `0` and describe the product as a whole.

| Type ID     | Relationship Name          | Points To                                               | Used In                                                                                                   |
| ----------- | -------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `116680003` | IS-A                       | Parent concept (generic CD, brand family, or substance) | All scripts: hierarchy traversal, brand-to-generic resolution, sibling discovery                          |
| `411116001` | Has manufactured dose form | Dose form concept (e.g. `421026006` Oral tablet)        | `extractBrandedDrug()`: populates `form` and `form_snomed_code`                                           |
| `774159003` | Has supplier               | Manufacturer/company concept                            | `extractBrandedDrug()`: populates `supplier` / `manufacturer`                                             |
| `774158006` | Has trade name             | Brand name concept                                      | `snomed_enrich.js`: populates `trade_name` and `trade_name_code` per brand                                |
| `763032000` | Has unit of presentation   | Unit concept (Tablet, Capsule, mL)                      | `extractBrandedDrug()`: populates `uop` / `unit_of_presentation`; critical for denominator unit inference |
| `766939001` | Has trade name qualifier   | Brand qualifier concept                                 | Referenced in data dictionary; not directly extracted by pipeline                                         |

### 4.2 Ingredient-Level Relationships (Group 1, 2, 3, ...)

Each active ingredient occupies its own numbered relationship group. A mono-ingredient drug has group 1; a combo drug has groups 1, 2, 3, etc.

| Type ID     | Relationship Name                           | Points To                                                                                     | Used In                                                                                                        |
| ----------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `762949000` | Has precise active ingredient               | Substance concept (e.g. Amoxicillin)                                                          | All scripts: ingredient identification, reverse index building                                                 |
| `127489000` | Has active ingredient                       | Substance concept (less specific)                                                             | Fallback when `762949000` is absent                                                                            |
| `732943007` | Has basis of strength substance             | Substance the strength is expressed in terms of (may differ from ingredient for salts/esters) | `snomed_enrich.js`: populates `basis_of_strength` and `basis_of_strength_code` per ingredient                  |
| `733722007` | Has presentation strength numerator unit    | Unit concept (mg, mcg, IU, etc.)                                                              | `extractBrandedDrug()`: **CAUTION — unit concepts are swapped in India Extension for liquids** (see Section 5) |
| `732945000` | Has presentation strength denominator unit  | Unit concept (tablet, mL, etc.)                                                               | `extractBrandedDrug()`: **CAUTION — swapped**                                                                  |
| `733725009` | Has concentration strength numerator unit   | Unit concept                                                                                  | `snomed_reextract_v2.js`: preferred source for numerator unit (correct in India Extension)                     |
| `732947008` | Has concentration strength denominator unit | Unit concept                                                                                  | `snomed_reextract_v2.js`: preferred source for denominator unit (correct in India Extension)                   |

### 4.3 Concrete Value Type IDs (Numeric Values)

These appear in the `RelationshipConcreteValues` file. Values are literal numbers (no destination concept).

| Type ID      | Value Name                               | Meaning                                                                       | Example    |
| ------------ | ---------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| `1142135004` | Presentation strength numerator value    | Amount per unit of presentation (e.g. 500 for "500 mg/tablet")                | `500`      |
| `1142136003` | Presentation strength denominator value  | Usually 1 for solids; may be >1 for liquids (e.g. 5 for "per 5 mL")           | `1` or `5` |
| `1142137007` | Concentration strength numerator value   | Amount per volume, normalized (e.g. 50 for "250 mg/5 mL" normalized to mg/mL) | `50`       |
| `1142138002` | Concentration strength denominator value | Volume denominator (usually 1 for concentration)                              | `1`        |
| `1142139005` | Count of base of active ingredient       | Number of active ingredients in the product                                   | `2`        |
| `1142140007` | Count of units of presentation           | Units in the pack (if applicable)                                             | —          |

### 4.4 Strength Model Summary

Each ingredient group can carry two independent strength representations:

| Strength Type            | Value Type IDs                         | Unit Type IDs                                  | Meaning                                                      | Example: Amoxicillin 250 mg/5 mL syrup |
| ------------------------ | -------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ | -------------------------------------- |
| **Presentation (PRES)**  | `1142135004` (num), `1142136003` (den) | `733722007` (num unit), `732945000` (den unit) | Amount per unit of presentation (per tablet, per 5 mL, etc.) | NUM: 250, DEN: 5                       |
| **Concentration (CONC)** | `1142137007` (num), `1142138002` (den) | `733725009` (num unit), `732947008` (den unit) | Amount per volume, normalized to per-mL                      | NUM: 50, DEN: 1                        |

---

## 5. Known Data Issues

### 5.1 PRES Unit Swap (Critical)

**Problem:** In the India Drug Extension, presentation strength unit concepts (`733722007` PRES_NUM_UNIT and `732945000` PRES_DEN_UNIT) are swapped for many liquid formulations. For example, a syrup that should be "250 mg / 5 mL" has:

- PRES_NUM_UNIT pointing to `258773002` (mL) instead of `258684004` (mg)
- PRES_DEN_UNIT pointing to `258684004` (mg) instead of `258773002` (mL)

The **values** (250 and 5) are correct; only the **unit concept references** are transposed.

**Workaround (`snomed_reextract_v2.js`):** The pipeline uses a hybrid strategy:

- **VALUES** always come from **PRES** concrete values (these match the product label)
- **UNITS** preferentially come from **CONC** relationships (which have correct unit concepts in India Extension)
- When CONC units are unavailable, heuristic correction is applied using the Unit of Presentation:
  - If PRES_NUM_UNIT = mL and UoP = mL (liquid), force numerator unit to `mg`
  - If PRES_NUM_UNIT = mL and UoP = tablet/capsule (solid), force numerator unit to `mg`
  - If PRES_DEN_UNIT = mg and UoP = mL (liquid), force denominator unit to `mL`

### 5.2 Missing Unit of Presentation for Liquids

**Problem:** Some liquid formulations (syrups, suspensions) lack a `763032000` (Has unit of presentation) relationship entirely, making it impossible to infer the denominator unit from UoP alone.

**Workaround:** Falls back to CONC_DEN_UNIT if available; otherwise defaults to `"unit"`.

### 5.3 Combo Drugs Appearing in Mono-Ingredient Index

**Problem:** The ingredient reverse index (`ingredientToCDs`) maps a substance to all Clinical Drugs that contain it. For a substance like Amoxicillin, this includes both `Amoxicillin 500 mg tablet` (mono) and `Amoxicillin 500 mg + Clavulanic acid 125 mg tablet` (combo). Without filtering, a mono drug entry (e.g. "Amoxicillin") would incorrectly receive combo formulations.

**Workaround (`snomed_reextract_v2.js`):** Formulations carry an `_ingredientCount` field. For single-ingredient drugs (no `+` or `and` in generic_name), only formulations with `_ingredientCount === 1` are kept. Combo formulations are only assigned to combo drug entries.

### 5.4 International Clinical Drugs Not in India Relationships

**Problem:** The India Drug Extension's relationship file only contains relationships authored in the India module. Generic Clinical Drug concepts (e.g. `Amoxicillin 500 mg oral tablet`) are defined in the International Edition, and their ingredient relationships exist only in the International relationship file.

**Workaround (`snomed_reextract_v3.js`):** Loads relationships from **both** India Extension **and** International Edition into the same `relMap` and `isaChildren` maps. This ensures that:

- IS-A relationships from International CDs to substances are visible
- Ingredient relationships on International CDs are available for the reverse index

### 5.5 Salt/Ester Code Mismatch

**Problem:** Some formulary drugs use a salt or ester form name (e.g. "Cefpodoxime Proxetil") while the SNOMED substance code points to the base form (e.g. "Cefpodoxime"). The ingredient relationships in Clinical Drugs may reference either the salt SCTID or the base SCTID, so a single code lookup may miss formulations.

**Workaround (`snomed_reextract_v3.js`):** Drugs can carry an `_alt_substance_codes` array listing additional substance SCTIDs. The pipeline searches all codes when building the ingredient reverse index lookup:

```
const codesToSearch = [drug.snomed_code];
if (drug._alt_substance_codes) codesToSearch.push(...drug._alt_substance_codes);
```

### 5.6 CONC Values Are Normalized (Not Label Values)

**Problem:** Concentration strength values (`1142137007` / `1142138002`) represent the normalized per-mL concentration, not the label concentration. For example, "250 mg / 5 mL" has CONC_NUM = 50, CONC_DEN = 1 (i.e. 50 mg/mL). These do not match what appears on the product label.

**Consequence:** The pipeline uses PRES values (which match labels) and only borrows CONC **unit concepts** (which are correct).

---

## 6. Extraction Pipeline

The formulary is built by a sequence of scripts, each refining the output of the previous one.

### 6.1 Phase Overview

| Script                   | Phase           | Input                                                   | Output                                                                                                                                          | Purpose                                                                                       |
| ------------------------ | --------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `snomed_rebuild.js`      | 1-7             | `formulary_working.json` (652 drugs) + SNOMED RF2 files | `formulary_data_ABDM_FHIR.json` (branded), `formulary_data_ABDM_FHIR_generics.json` (generic), `formulary_data_ABDM_FHIR_orphans.json` (orphan) | Full rebuild from scratch: code matching, formulation extraction, classification              |
| `snomed_reextract_v2.js` | Post-rebuild    | Same 3 JSON files + SNOMED RF2                          | `*_v2.json` files                                                                                                                               | Re-extract formulations with corrected unit resolution (CONC units, combo filtering)          |
| `snomed_reextract_v3.js` | Post-v2         | `*_v2.json` files + SNOMED RF2 (both editions)          | `*_v2.json` files (updated in place)                                                                                                            | Fill gaps for drugs with 0 SNOMED formulations by loading International Edition relationships |
| `snomed_enrich.js`       | Post-extraction | Main 3 JSON files + SNOMED RF2                          | Same 3 JSON files (enriched in place)                                                                                                           | Add missing SNOMED fields: UoP, trade_name, brand_family, basis_of_strength, snomed_display   |

### 6.2 `snomed_rebuild.js` — 7-Phase Pipeline

#### Phase 1: Load SNOMED Data

Loads four data structures from both International and India Extension RF2 files:

1. **`fsnMap`** (Map: conceptId -> FSN) — All Fully Specified Names
2. **`prefMap`** (Map: conceptId -> preferred term) — All preferred terms/synonyms
3. **`relMap`** (Map: sourceId -> [{destId, typeId, group}]) — All relationships
4. **`cvMap`** (Map: sourceId -> [{value, typeId, group}]) — All concrete values
5. **`isaChildren`** / **`isaParents`** (Maps) — IS-A hierarchy in both directions

Builds four indexes:

- **Brand Index** (`brandIndex`): First word of brand name (lowercase) -> [{conceptId, fsn, brandName}] for all Real Clinical Drug FSNs
- **Substance Index** (`substanceIndex`): Lowercase substance name -> conceptId for all concepts with FSN ending in `(substance)`
- **Clinical Drug FSN Index** (`clinicalDrugFSNs`): conceptId -> FSN for all `(clinical drug)` concepts (excluding "real")
- **Ingredient Reverse Index** (`ingredientToCDs`): Substance conceptId -> Set of Clinical Drug conceptIds that contain that substance (via `762949000` or `127489000`)

#### Phase 2: Validate Existing Substance Codes

For the ~113 drugs in `formulary_working.json` that already have a `snomed_code`:

- Verify the code points to an active concept with FSN containing `(substance)`
- If invalid (e.g. points to a clinical drug or missing concept), clear the code

#### Phase 3: Brand Name Matching

For all drugs without a valid substance code, attempt to find a match via Indian brand names:

**Three matching strategies (tried in order):**

1. **Brand + Manufacturer match:** First word of brand name matches in `brandIndex`, AND the manufacturer name appears in the FSN
2. **Exact brand name match:** Brand name exactly equals or starts the SNOMED branded drug name
3. **Brand name contains:** Brand name appears anywhere in the SNOMED branded drug name

On match, traces the hierarchy upward:

- Real Clinical Drug -> IS-A -> Clinical Drug (generic parent) -> HAS_ACTIVE_INGREDIENT -> Substance

Stores: `_genericCid`, `_substanceCid`, `_matchedBrand`, `_matchedBrandCid`, `_matchMethod = "brand"`

#### Phase 4: Substance Name Matching

For drugs still unmatched after Phase 3:

- Normalize generic name (lowercase, replace `+` with `and`, strip non-alphanumeric)
- Try exact match against `substanceIndex`
- Try first-word match (for single-ingredient drugs with name >= 4 chars)

Stores: `snomed_code`, `_matchMethod = "substance_name"`

#### Phase 5: Find Clinical Drug Concepts + Extract Formulations

For each matched drug, discover all relevant generic Clinical Drug concepts through multiple paths:

**For brand-matched drugs:**

1. Use the directly matched generic CD (`_genericCid`)
2. Find sibling CDs by traversing: matched brand -> Real Medicinal Product parent -> all brand siblings -> their generic CD parents
3. Search substance -> IS-A children that are Clinical Drugs
4. Search ingredient reverse index

**For substance-matched drugs:**

1. Direct IS-A children of the substance that are Clinical Drugs
2. Ingredient reverse index lookup

**Formulation building (`buildFormulations`):**
For each generic CD, find all IS-A children that are Real Clinical Drugs (branded). For each branded concept:

- Extract dose form, supplier, ingredients with strengths via `extractBrandedDrug()`
- Group by form + ingredient strength key (deduplicates same-strength products)
- Collect all brands under each unique formulation

#### Phase 6: Classify into Branded / Generic / Orphan

| Category    | Criteria                                                                         | Count (typical) |
| ----------- | -------------------------------------------------------------------------------- | --------------- |
| **Branded** | Has SNOMED substance code AND has SNOMED-sourced formulations with Indian brands | ~355            |
| **Generic** | Has SNOMED substance code but NO branded formulations in India Extension         | ~231            |
| **Orphan**  | No SNOMED substance code found                                                   | ~66             |

Each drug entry carries: `generic_name` (original, never replaced), `snomed_code` (substance), `snomed_display` (SNOMED preferred term for substance), `formulations[]`, `dosing_bands[]`, and clinical metadata.

#### Phase 7: Add Special Entries

Manually adds drugs not found through standard matching:

- **IV Fluids** (10 types): Normal Saline, Dextrose, DNS, KCl, NaHCO3, Calcium Gluconate, MgSO4, Mannitol, Water for Injection, Albumin — searched via regex patterns against India Extension description file
- **Emergency Drugs** (18 types): Dopamine, Dobutamine, Epinephrine, Norepinephrine, Milrinone, Phenylephrine, Adenosine, Amiodarone, Lidocaine, Naloxone, Alprostadil, Nitroprusside, Midazolam, Ketamine, Rocuronium, Esmolol, Hydralazine, Calcium Chloride
- **Combo drugs** (manual): Wikoryl AF (Chlorphenamine + Phenylephrine) with specific SNOMED concept IDs
- **Orphan combos** (manual): Paracetamol + Chlorphenamine + Phenylephrine (Sinarest AF, Wicoryl)
- **Nutritional** (manual): Neogadine Elixir (Multivitamin + Multimineral)

### 6.3 `snomed_reextract_v2.js` — Corrected Unit Extraction

Runs after `snomed_rebuild.js` to fix the PRES unit swap issue.

**Core strategy:**

```
VALUES  -> always from PRES (1142135004 / 1142136003) — match product label
UNITS   -> prefer CONC (733725009 / 732947008) — correct in India Extension
FALLBACK -> heuristic using Unit of Presentation to detect and correct swaps
```

**Additional fixes:**

- Filters combo formulations out of mono-ingredient drug entries (`_ingredientCount` check)
- Deduplicates formulations by `form + strength_numerator + strength_numerator_unit + strength_denominator + strength_denominator_unit`
- Preserves non-SNOMED formulations (from original manual data) that do not overlap with SNOMED-extracted ones
- Cross-checks output against known Indian concentrations for Paracetamol, Amoxicillin, Ibuprofen, Azithromycin, and Cetirizine

### 6.4 `snomed_reextract_v3.js` — International Edition Relationships

Addresses the gap where some drugs have 0 SNOMED formulations because their Clinical Drug concepts exist in the International Edition (not the India Extension).

**Key change from v2:** Loads relationships from **both** India Extension **and** International Edition:

```javascript
for (const relFile of [
  path.join(INDIA_BASE, "sct2_Relationship_Snapshot_IN1000189_..."),
  path.join(INT_BASE, "sct2_Relationship_Snapshot_INT_20260301.txt"),
]) { ... }
```

This makes International Clinical Drug -> Substance ingredient relationships visible, expanding the reverse index.

Also supports `_alt_substance_codes` for salt/ester variant lookups.

Only processes drugs that have **no existing SNOMED-sourced formulations** (skips already-enriched drugs).

### 6.5 `snomed_enrich.js` — Brand Enrichment

Adds missing SNOMED metadata to already-extracted formulary files without re-extracting formulations.

**For branded drugs (enrichment per formulation):**

- `unit_of_presentation` + `unit_of_presentation_code` (from `763032000`)
- `generic_clinical_drug_code` + `generic_clinical_drug_name` (from IS-A parent that is a Clinical Drug)
- Per brand: `trade_name` + `trade_name_code` (from `774158006`)
- Per brand: `brand_family` + `brand_family_code` (from IS-A parent that is a Real Medicinal Product)
- Per ingredient: `basis_of_strength` + `basis_of_strength_code` (from `732943007`)

**For generic drugs:**

- Populates ingredient `name` from substance code when missing
- Fills `snomed_display` from substance preferred term

**For orphan drugs:**

- Populates ingredient `name` from `generic_name` when missing

**Safety:** Supports `--dry-run` mode (writes to `_enriched_preview_*.json`). Integrity check verifies no duplicates, no missing names, and drug count >= 679 before writing.

---

## 7. ICD-10 to SNOMED Diagnosis Mapping

The `standard_prescriptions` table stores diagnosis protocols keyed by **ICD-10 code** (primary) with diagnosis name as fallback. Each protocol carries a `snomed_code` field for the corresponding SNOMED CT diagnosis concept.

The mapping is used for:

- ABDM FHIR Bundle generation (`generate-fhir-bundle` Edge Function) — requires SNOMED CT diagnosis codes for `Condition` resources in OPConsultation bundles
- Clinical Drug lookup via `get_standard_rx` tool — matches ICD-10 code first, then diagnosis name

Standard prescriptions include `first_line_drugs` (arrays of drug names that cross-reference the `formulary` table by `generic_name`), `investigations`, and protocol-specific notes.

---

## 8. Unit Concept IDs

The following SNOMED CT concept IDs represent units of measurement and presentation used in drug strength expressions. These are defined in the International Edition and referenced by ID in India Extension relationships.

| Concept ID  | Abbreviation | Full Name                             | Usage                                                                 |
| ----------- | ------------ | ------------------------------------- | --------------------------------------------------------------------- |
| `258684004` | mg           | Milligram                             | Most common numerator unit for drug strength                          |
| `258685003` | mcg          | Microgram                             | Used for potent drugs (Note: SNOMED preferred term can be misleading) |
| `258682000` | g            | Gram                                  | Bulk substances, topicals                                             |
| `258686002` | mcg          | Microgram (alternate)                 | Alternate microgram concept                                           |
| `258798001` | mcg          | Microgram (third variant)             | Another microgram concept ID                                          |
| `258773002` | mL           | Millilitre                            | Liquid denominator unit, liquid UoP                                   |
| `258774008` | mL           | Millilitre (cubic millimeter variant) | Alternate mL concept                                                  |
| `259022006` | mL           | Millilitre (yet another variant)      | Alternate mL concept                                                  |
| `258770004` | L            | Litre                                 | Large-volume infusions                                                |
| `258997004` | IU           | International Unit                    | Vaccines, vitamins, biologics                                         |
| `258718000` | mmol         | Millimole                             | Electrolyte concentrations                                            |
| `767525000` | unit         | Unit                                  | Generic dosing unit                                                   |
| `408102007` | dose         | Dose                                  | Vaccine doses, inhalers                                               |
| `732936001` | tablet       | Tablet                                | Solid oral UoP                                                        |
| `385055001` | tablet       | Tablet (dose form variant)            | Tablet as dose form concept                                           |
| `385049006` | capsule      | Capsule (dose form variant)           | Capsule as dose form concept                                          |
| `732981002` | actuation    | Actuation                             | Metered-dose inhalers                                                 |
| `258683005` | kg           | Kilogram                              | Body weight (dosing context)                                          |
| `733020007` | vial         | Vial                                  | Injectable UoP                                                        |

### Unit Resolution Logic

The `getUnitAbbrev()` function resolves a concept ID to a short abbreviation:

1. Check the hardcoded `UNIT_ABBREV` lookup table (above)
2. If not found, retrieve the preferred term or FSN for the concept
3. Normalize common English terms (`milligram` -> `mg`, `millilitre` -> `mL`, etc.)
4. If no match, return the raw concept name

---

## Appendix A: RF2 Files Used by the Pipeline

| File                                                                      | Edition        | Content                                                                                        | Used By                  |
| ------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| `sct2_Description_Snapshot-en_IN1000189_20260313T120000Z.txt`             | India Drug Ext | Branded drug names, manufacturer names, trade names                                            | All scripts              |
| `sct2_Description_Snapshot-en_INT_20260301.txt`                           | International  | Substance names, dose form names, unit names                                                   | All scripts              |
| `sct2_Relationship_Snapshot_IN1000189_20260313T120000Z.txt`               | India Drug Ext | Branded drug relationships (IS-A, ingredient, form, supplier, trade name, UoP, strength units) | All scripts              |
| `sct2_Relationship_Snapshot_INT_20260301.txt`                             | International  | Generic Clinical Drug relationships (IS-A, ingredient)                                         | `snomed_reextract_v3.js` |
| `sct2_RelationshipConcreteValues_Snapshot_IN1000189_20260313T120000Z.txt` | India Drug Ext | Numeric strength values (PRES + CONC)                                                          | All scripts              |

## Appendix B: Output File Structure

Each drug entry in the output JSON files follows this structure:

```json
{
  "generic_name": "Amoxicillin",
  "snomed_code": "372687004",
  "snomed_display": "Amoxicillin",
  "drug_class": "Aminopenicillin",
  "category": "Antibiotic",
  "formulations": [
    {
      "form": "Oral tablet",
      "form_snomed_code": "421026006",
      "route": "PO",
      "unit_of_presentation": "tablet",
      "unit_of_presentation_code": "732936001",
      "generic_clinical_drug_code": "323539009",
      "generic_clinical_drug_name": "Amoxicillin 500 mg oral tablet",
      "ingredients": [
        {
          "name": "Amoxicillin",
          "snomed_code": "372687004",
          "is_active": true,
          "is_primary": true,
          "strength_numerator": 500,
          "strength_numerator_unit": "mg",
          "strength_denominator": 1,
          "strength_denominator_unit": "tablet",
          "basis_of_strength": "Amoxicillin",
          "basis_of_strength_code": "372687004"
        }
      ],
      "indian_brands": [
        {
          "name": "Amoxil 500",
          "manufacturer": "GSK Pharmaceuticals",
          "snomed_code": "1067681000189102",
          "verified_on": "SNOMED CT India Extension March 2026",
          "trade_name": "Amoxil",
          "trade_name_code": "51621000189101",
          "brand_family": "Amoxil [GSK]",
          "brand_family_code": "1053441000189109"
        }
      ],
      "indian_conc_note": "Amoxicillin 500 mg / 1 tablet"
    }
  ],
  "dosing_bands": [],
  "...": "other clinical metadata fields"
}
```

## Appendix C: Cross-Check Validation

`snomed_reextract_v2.js` includes a built-in cross-check against known Indian market concentrations for 5 sentinel drugs:

| Drug         | Form               | Expected Strengths                     | Expected Units |
| ------------ | ------------------ | -------------------------------------- | -------------- |
| Paracetamol  | Suspension/Syrup   | 120, 125, 250 mg/5 mL                  | mg / mL        |
| Paracetamol  | Tablet/Dispersible | 125, 170, 250, 325, 500, 650 mg/tablet | mg / tablet    |
| Amoxicillin  | Suspension/Syrup   | 125, 200, 250, 400 mg/5 mL             | mg / mL        |
| Amoxicillin  | Tablet/Dispersible | 125, 200, 250, 500 mg/tablet           | mg / tablet    |
| Amoxicillin  | Capsule            | 250, 500 mg/capsule                    | mg / capsule   |
| Ibuprofen    | Suspension/Syrup   | 100, 200 mg/5 mL                       | mg / mL        |
| Ibuprofen    | Tablet             | 200, 400, 600 mg/tablet                | mg / tablet    |
| Azithromycin | Suspension/Syrup   | 100, 200 mg/5 mL                       | mg / mL        |
| Azithromycin | Tablet             | 250, 500 mg/tablet                     | mg / tablet    |
| Cetirizine   | Syrup/Suspension   | 5 mg/5 mL                              | mg / mL        |
| Cetirizine   | Tablet             | 5, 10 mg/tablet                        | mg / tablet    |
