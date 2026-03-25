# Dose Calculator Specification

**File**: `web/prescription-pad.html` (inline JavaScript and CSS)
**Last verified**: 2026-03-25

---

## 1. Product Overview

The dose calculator is an inline panel embedded in each medicine card on the Prescription Pad's Review tab. It allows the doctor to adjust the AI-generated dose before signing off.

**Who uses it**: Pediatrician (Dr. Lokender Goyal or Dr. Gandharv Goyal) during OPD prescription review.

**When invoked**: After AI generates a prescription via the Edge Function, the doctor clicks "Adjust dose" on any medicine card. The panel opens inline (`.ep.open`), reads the current medicine data from `rxData.medicines[idx]`, cross-references the local `formularyCache`, and provides interactive controls. On "Apply & update", the panel rewrites rows 1-3, the calculation string, and the pictogram in `rxData`.

**What it does**:

- Switches between available formulations (Syrup, Tablet, Drops, etc.) and strengths from the formulary
- Shows dosing reference from `formularyCache[drug].dosing_bands` matched to patient age
- Provides method-aware input: a multi-zone colour slider for weight-based dosing, or a stepper for fixed-dose drugs
- Converts mg/kg/day to dispensable units (mL, drops, tablets, capsules, puffs) with rounding
- Generates English Row 2 and Hindi Row 3 text with route, frequency, and duration
- Caps at max single dose when exceeded, with a visible warning
- Snaps slider to discrete output units so the doctor always sees a prescribable quantity
- Updates the pictogram sidebar (SVG icons for time-of-day, dose quantity, duration)

---

## 2. UI Components

### 2.1 Medicine Card Layout

Each medicine is rendered as a `.med-card` with ID `m{idx}` (e.g., `m0`, `m1`). Inside:

| Element            | ID pattern                     | Description                                                                                       |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Calculation line   | `{pid}-calc`                   | Grey text showing the formula, e.g., `10mg/kg x 12kg = 120mg/day / 3 = 40mg/dose -> 1.5ml`        |
| Row 1 (drug name)  | `{pid}-r1`                     | Contenteditable. GENERIC NAME IN CAPS with concentration. CSS class `med-r r1`                    |
| Row 2 (English)    | `{pid}-r2`                     | Contenteditable. Dosing instructions in English. CSS class `med-r`                                |
| Row 3 (Hindi)      | `{pid}-r3`                     | Contenteditable. Devanagari translation. CSS class `med-r r3`, font-family `Noto Sans Devanagari` |
| Flag line          | `{pid}-flag`                   | Max-dose or interaction warning. CSS class `med-flag`                                             |
| Pictogram sidebar  | `.dose-sidebar` inside `{pid}` | Inline SVG icons rendered by `renderPictogram(m)`                                                 |
| Adjust dose button | `.adj-btn`                     | Calls `toggleEP('{pid}', {idx})`                                                                  |
| Remove button      | `{pid}-rm`                     | Calls `toggleStrike('med', {idx})`                                                                |

### 2.2 Expand Panel (`.ep`)

The panel container has ID `{pid}-ep`. It is hidden by default (`display: none`) and shown by adding CSS class `open` (`display: block`). Only one panel is open at a time -- `toggleEP` closes all others first.

**CSS classes**:

- `.ep` -- container (padding 12px, white background, top border)
- `.ep.open` -- visible state
- `.ep-title` -- uppercase blue header, 11px, letter-spacing 0.05em
- `.ep-result` -- green background result box (font-size 16px, font-weight 600)
- `.ep-result .ep-hindi` -- Hindi sub-line (Noto Sans Devanagari, 13px, normal weight)
- `.ep-result .ep-calc-detail` -- calculation detail line (11px, opacity 0.7)
- `.ep-warn` -- amber warning box, hidden by default
- `.ep-btns` -- flex row for Apply and Cancel buttons
- `.ep-apply` -- green background, 12px, border-radius 6px
- `.ep-cancel` -- outlined, 12px

### 2.3 Form Radios

Row label "Form". Container: `{pid}-dp-forms`, CSS class `dp-radios`.

Radio group name: `{pid}-form-r`. Values are simplified form names returned by `simplifyForm()`. On change calls `dpFormChanged(pid, idx)`.

Simplified forms produced by `simplifyForm(snomedFormName)`:

- Eye drops, Ear drops, Nasal drops, Drops
- Syrup (includes oral suspensions)
- DT (dispersible/chewable tablets)
- Tablet (non-dispersible, non-chewable)
- Capsule
- Injection (includes infusion)
- Cream, Ointment, Gel, Lotion
- Inhaler (includes inhalation, puff)
- Nebulisation
- Suppository (includes rectal)
- Dry syrup (oral powder)
- Nasal spray
- Sachet (includes granules)
- Patch
- "Other" (fallback)

### 2.4 Strength Radios

Row label "Strength". Container: `{pid}-dp-strengths`, CSS class `dp-radios`.

Radio group name: `{pid}-str-r`. Values are pipe-delimited: `{concQty}|{concUnit}|{perQty}|{perUnit}` (e.g., `125|mg|5|mL`). On change calls `dpStrengthChanged(pid, idx)`.

Strengths are derived from `formularyCache[genericName].formulations` filtered to the currently selected form. Concentrations are extracted via `getConc(f)`. If no formulations match, a single "Manual entry" radio with value `0|mg|5|mL` is shown.

### 2.5 Unit Radios (Prescribe As)

Row label "Prescribe as". Container: `{pid}-dp-units`, CSS class `dp-radios`.

Radio group name: `{pid}-unit-r`. Values and options depend on form, produced by `getUnitOptions(form)`:

| Form                      | Unit options             |
| ------------------------- | ------------------------ |
| Any drop form             | `["drops", "mL"]`        |
| Syrup, Dry syrup          | `["mL", "tsp", "drops"]` |
| Tablet, DT                | `["tablet"]`             |
| Capsule                   | `["capsule"]`            |
| Inhaler                   | `["puffs"]`              |
| Nebulisation              | `["mL"]`                 |
| Injection                 | `["mL"]`                 |
| Suppository               | `["mg"]`                 |
| Cream/Ointment/Gel/Lotion | `["application"]`        |
| Nasal spray               | `["sprays"]`             |
| Sachet                    | `["sachet"]`             |
| Default fallback          | `["mL", "drops"]`        |

On change calls `dpUnitChanged(pid, idx)`.

### 2.6 Dosing Reference Bar

Container: `{pid}-doseref`, CSS class `dose-ref` (blue left border, light blue background).

Shows the primary matched dosing band formatted by `fmtDoseBand(band)`, including:

- Dose range (e.g., "8-30 mg/kg/day")
- Frequency (e.g., "BD", "TDS")
- Max single dose if present
- Indication as a note below

If multiple bands exist, a "Other indications" toggle button shows/hides `{pid}-morebands`.

### 2.7 Dose Input (Method-Aware)

Determined by `band.method || m.method || "weight"`. Two paths:

#### 2.7.1 Weight-Based Slider (`method !== "fixed" && method !== "age"`)

- **Range input** (HTML `<input type="range">`): ID `{pid}-slider`, CSS class `dp-slider`
- **Min**: `globalMin * 0.5` (half the lowest band's `dose_min_qty`)
- **Max**: `globalMax * 2.0` (double the highest band's `dose_max_qty`), fallback 100
- **Step**: adaptive based on slider range:
  - `rounding_rule === "exact"`: range / 200
  - `rounding_rule === "quarter_tab"`: 0.25
  - Range < 2: 0.01
  - Range < 10: 0.1
  - Range < 50: 0.5
  - Otherwise: 1
- **Background gradient**: multi-zone with up to 6 indication colors (`#3b82f6`, `#22c55e`, `#f59e0b`, `#a855f7`, `#ec4899`, `#06b6d4`). Gaps between bands are red (`#fca5a5`).
- **Slider value display**: `{pid}-sliderval`, CSS class `dp-slider-val`. Shows output quantity in bold + mg/kg annotation. Class toggles between `dp-safe` (green) and `dp-warn` (red) depending on whether the value falls within any dosing band.
- **Band legend**: clickable colored dots below the slider. Clicking sets the slider to the midpoint of that band.
- On input calls `dpSliderChanged(pid, idx)`.

#### 2.7.2 Fixed-Dose Stepper (`method === "fixed" || method === "age"`)

- **Stepper**: minus button, value display `{pid}-fixedval`, plus button
- **Buttons**: CSS class `dp-freq-btn` (36x36px, font-size 20px), call `dpFixedChange(pid, idx, -1|+1)`
- **Step sizes** in `dpFixedChange`:
  - drops, puffs, capsule, application: step = 1
  - mg: step = 1 if < 10, 5 if < 100, 10 otherwise
  - mL: step = 0.5
  - tablet: step = 0.25
- **Min**: one step (never goes below the step size)
- **Hidden fields**: `{pid}-fixeddose` (current quantity), `{pid}-fixedunit` (unit string)
- For fixed-dose drugs, `cmg` and `cml` are set to 1/1 so `calcDose` treats the quantity as a direct amount.

### 2.8 Frequency Stepper

CSS class `dp-freq-row`. Contains:

- Minus button (CSS class `dp-freq-btn`, calls `dpFreqChange(pid, idx, -1)`)
- Value display: `{pid}-freqval`, CSS class `dp-freq-val`, format `{n}x/day`
- Plus button (calls `dpFreqChange(pid, idx, 1)`)
- Range: 1 to 6 (clamped by `Math.max(1, Math.min(6, ...))`)

Hidden field: `{pid}-freq`.

### 2.9 Result Display

Container: `{pid}-res`, CSS class `ep-result`.

Shows:

- English dose line in bold (e.g., "1.5ml three times daily")
- Hindi translation line with CSS class `ep-hindi`
- Calculation detail with CSS class `ep-calc-detail`

Warning container: `{pid}-warn`, CSS class `ep-warn`. Shown when max dose is capped.

### 2.10 Apply / Cancel Buttons

CSS class `ep-btns` (flex row).

- **Apply & update**: CSS class `ep-apply`, calls `applyDose(pid, idx)`. Writes all changes to `rxData.medicines[idx]` and updates the DOM. Closes the panel. Flashes a green outline on the card for 1.4 seconds.
- **Cancel**: CSS class `ep-cancel`, calls `toggleEP(pid, idx)` to close without saving.

### 2.11 Hidden Fields

Every panel contains six hidden `<input>` elements used by `calcDose` and `applyDose`:

| ID           | Source                                             | Purpose                                           |
| ------------ | -------------------------------------------------- | ------------------------------------------------- |
| `{pid}-wt`   | `rxData.patient.weight_kg`                         | Patient weight in kg                              |
| `{pid}-mgkg` | `m.dose_mg_per_kg` or band midpoint                | mg/kg/day (or direct quantity for fixed)          |
| `{pid}-freq` | Parsed from Row 2 text or `m.dose_per_day_divided` | Frequency per day (1-6)                           |
| `{pid}-cmg`  | `m.concentration_mg`                               | Numerator of concentration (mg)                   |
| `{pid}-cml`  | `m.concentration_per_ml` or 5                      | Denominator of concentration (mL or tablet count) |
| `{pid}-max`  | `m.max_dose_single_mg`                             | Max single dose in mg (null if none)              |

---

## 3. Data Flow

### 3.1 Data Sources

**`formularyCache`** (global object): Populated by `preloadKnowledge()` at connection time. Keyed by `generic_name.toUpperCase()`. Each entry has:

- `formulations` -- array of formulation objects with `form` (SNOMED display name), `ingredients[]` (with `is_primary`, `strength_numerator`, `strength_numerator_unit`, `strength_denominator`, `strength_denominator_unit`)
- `dosing_bands` -- array of dosing band objects (see Section 8)
- `contraindications`, `interactions`, `black_box_warnings`, `notes`

**`rxData`** (global object): The AI-generated prescription JSON. Key fields:

- `rxData.patient.weight_kg` -- patient weight
- `rxData.patient.age` -- age string (e.g., "2yr 3mo")
- `rxData.medicines[]` -- array of medicine objects, each with:
  - `row1_en` -- "AMOXICILLIN SYRUP (125mg/5mL)"
  - `row2_en` -- "2.5ml orally three times daily. for 5 days."
  - `row3_hi` -- Hindi equivalent
  - `calc` -- calculation string
  - `formulation` -- simplified form name (e.g., "syrup")
  - `concentration_mg` -- numerator (e.g., 125)
  - `concentration_per_ml` -- denominator (e.g., 5)
  - `dose_mg_per_kg` -- mg/kg value used
  - `dose_per_day_divided` -- frequency
  - `max_dose_single_mg` -- cap if any
  - `method` -- dosing method from AI (weight, fixed, etc.)
  - `flag` -- warning text
  - `pictogram` -- object with `dose_display`, `dose_qty`, `form`, `times[]`, `duration_days`, `food`, `food_hi`

### 3.2 Generic Name Extraction

Both `getDoseRef` and `dpFormChanged` strip the form word suffix from Row 1 before looking up the formulary. The form words list (used in both places) is:

```
SYRUP, TABLET, CAPSULE, DROPS, INJECTION, CREAM, OINTMENT, INHALER,
SUSPENSION, ORAL DROPS, SUPPOSITORY, DISPERSIBLE TABLET, CHEWABLE TABLET,
DRY SYRUP, NASAL DROPS, NASAL SPRAY, EYE DROPS, EYE OINTMENT, EAR DROPS,
GEL, LOTION, PASTE, SPRAY, PATCH, SACHETS, POWDER, GRANULES, ENEMA,
PESSARY, RESPULES, NEBULISATION, IV INFUSION, IM INJECTION, SC INJECTION
```

The text before `(` in Row 1 is taken, then the last matching form word is stripped. Result is upper-cased and used as the `formularyCache` key.

### 3.3 Cascade Logic

```
dpFormChanged(pid, idx)
  |-> Rebuilds strength radios (filtered to selected form)
  |-> Rebuilds unit radios (via getUnitOptions)
  |-> Updates m.formulation
  |-> Calls dpStrengthChanged(pid, idx)
        |-> Reads selected strength pipe-delimited value
        |-> Updates hidden fields {pid}-cmg, {pid}-cml
        |-> Updates m.concentration_mg, m.concentration_per_ml
        |-> Calls dpRecalc(pid, idx)

dpUnitChanged(pid, idx)
  |-> Calls dpRecalc(pid, idx)

dpSliderChanged(pid, idx)    [weight-based only]
  |-> Reads slider value as mg/kg
  |-> Snaps to discrete output (see Section 3.4)
  |-> Updates {pid}-mgkg hidden field
  |-> Updates slider value display with output quantity + band match info
  |-> Calls dpRecalc(pid, idx)

dpFixedChange(pid, idx, delta)   [fixed-dose only]
  |-> Steps the quantity by unit-appropriate amount
  |-> Updates {pid}-fixeddose, {pid}-fixedval, {pid}-sliderval
  |-> Builds Hindi translation inline (uses HN map)
  |-> Updates result display directly (bypasses calcDose)
  |-> Sets {pid}-cmg=1, {pid}-cml=1

dpFreqChange(pid, idx, delta)
  |-> Clamps frequency to [1, 6]
  |-> Updates {pid}-freq hidden and {pid}-freqval display
  |-> Calls dpRecalc(pid, idx)

dpRecalc(pid, idx)   [master recalculator]
  |-> Reads all hidden fields + unit radio
  |-> Determines is_per_day from dosing band
  |-> Converts mg/kg to per-day if band is per-dose (multiplies by freq)
  |-> Calls calcDose(wt, mgkgForCalc, freq, cmg, cml, maxS, form)
  |-> Converts calcDose output to selected unit (drops, tsp, mL override)
  |-> Updates {pid}-res with English + Hindi + calc detail
  |-> Updates {pid}-warn visibility if capped
  |-> Updates {pid}-sliderval with matched band info + safe/warn class
```

### 3.4 Slider Snap Logic

In `dpSliderChanged`, after reading the raw slider value, the mg/kg is reverse-engineered from a snapped output quantity to ensure the displayed dose is always prescribable:

| Output unit | Snap rule                                                          | Minimum   |
| ----------- | ------------------------------------------------------------------ | --------- |
| drops       | Round to nearest whole drop (`Math.round(mlRaw * 20)`)             | 1 drop    |
| mL          | Round to nearest 0.5 mL (`Math.round(mlRaw * 2) / 2`)              | 0.5 mL    |
| tsp         | Round to nearest 0.5 tsp (`Math.round((mlRaw/5) * 2) / 2`)         | 0.5 tsp   |
| tablet      | Round to nearest 0.25 tablet (`Math.round((perDose/cmg) * 4) / 4`) | 0.25 tab  |
| capsule     | Round to nearest whole capsule (`Math.round(perDose / cmg)`)       | 1 capsule |
| puffs       | Round to nearest whole puff (`Math.round(perDose / cmg)`)          | 1 puff    |

After snapping the output quantity, the mg/kg value is back-calculated:

```
mgkg = isPerDay ? (snappedPerDose * freq) / wt : snappedPerDose / wt
```

---

## 4. Calculation Engine (`calcDose`)

### 4.1 Signature

```javascript
function calcDose(wt, mgkg, freq, cmg, cml, maxS, form)
```

**Parameters**:

- `wt` -- patient weight in kg
- `mgkg` -- dose in mg/kg/day (ALWAYS per-day; callers convert per-dose bands by multiplying by freq)
- `freq` -- doses per day (integer 1-6)
- `cmg` -- concentration numerator (mg of drug per `cml` units of vehicle)
- `cml` -- concentration denominator (mL for liquids, 1 for tablets/capsules)
- `maxS` -- max single dose in mg, or null
- `form` -- simplified formulation string (lowercase)

**Returns** object:

```javascript
{
  (vol, // String: output quantity with unit (e.g., "2.5ml", "3 drops", "1 tablet")
    enD, // String: English display text for Row 2
    hiD, // String: Hindi (Devanagari) display text for Row 3
    calc, // String: full calculation breakdown
    capped, // Boolean: true if max dose was applied
    fd); // String: final dose per administration in mg (toFixed(0))
}
```

### 4.2 Core Formula

```
totalDay = wt * mgkg              // total mg per day
perDose  = totalDay / freq         // mg per administration
capped   = maxS && perDose > maxS  // check max dose
fd       = capped ? maxS : perDose // final dose (mg)
```

### 4.3 Form-Specific Output

| Form                                             | Volume calculation                                                 | Rounding                  | English `enD`           | Hindi `hiD`                                                |
| ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------- | ----------------------- | ---------------------------------------------------------- |
| `drops`, `eye drops`, `nasal drops`, `ear drops` | `mlPerDose = (fd / cmg) * cml; drops = Math.round(mlPerDose * 20)` | Whole drops (20 drops/mL) | `"{n} drops"`           | Hindi numeral map (DN) + "बूंदें"                          |
| `syrup`                                          | `v = (fd / cmg) * cml; r = Math.round(v * 2) / 2`                  | 0.5 mL                    | `"{r}ml"`               | Hindi numeral map (HN) + "ml" + tsp parenthetical if whole |
| `tablet`                                         | `tabs = fd / cmg; r = Math.round(tabs * 4) / 4`                    | 0.25 tablet               | `"{r} tablet"`          | Hindi numeral map (TN) + "गोली"                            |
| `capsule`                                        | Same as tablet                                                     | 0.25 capsule              | `"{r} capsule"`         | TN + "कैप्सूल"                                             |
| `inhaler`, `puffs`                               | `puffs = Math.round(fd / cmg)`                                     | Whole puffs               | `"{n} puff(s)"`         | `"{n} पफ"`                                                 |
| `suppository`                                    | `fd.toFixed(0)`                                                    | Whole mg                  | `"{mg} mg suppository"` | `"{mg} mg सपोसिटरी"`                                       |
| `injection`                                      | `v = (fd / cmg) * cml; r = Math.round(v * 10) / 10`                | 0.1 mL                    | `"{r} mL"`              | `"{r} mL"`                                                 |
| Default (anything else)                          | `((fd / cmg) * cml).toFixed(1)`                                    | 0.1 mL                    | `"{v}ml"`               | `"{v}ml"`                                                  |

### 4.4 Calc String

Format: `{mgkg}mg/kg x {wt}kg = {totalDay}mg/day / {freq} = {perDose}mg/dose[ -> max {maxS}mg] -> {vol}`

### 4.5 Hindi Number Maps

**Drops (DN)**: 1-10, 12, 15, 20

**Syrup mL (HN)**: 0.5 "आधा", 1 "एक", 1.5 "डेढ़", 2 "दो", 2.5 "ढाई", 3 "तीन", 3.5 "साढ़े तीन", 4 "चार", 4.5 "साढ़े चार", 5 "पाँच", 5.5 "साढ़े पाँच", 6 "छह", 7 "सात", 8 "आठ", 10 "दस"

**Tablets (TN)**: 0.25 "चौथाई", 0.5 "आधी", 0.75 "तीन-चौथाई", 1 "एक", 1.5 "डेढ़", 2 "दो"

**Frequency**:

- English (FW): `{1: "once", 2: "twice", 3: "three times", 4: "four times"}`
- Hindi (FH): `{1: "एक बार", 2: "दो बार", 3: "तीन बार", 4: "चार बार"}`

### 4.6 Drops Conversion Rule

Standard medical dropper: **1 mL = 20 drops**. All formulary concentrations are per-mL. The conversion is:

```
drops = Math.round(mlPerDose * 20)
mlPerDose = drops / 20
```

### 4.7 Per-Day vs Per-Dose Conversion

`calcDose` always expects `mgkg` as a per-day value. When a dosing band has `is_per_day === false` (per-dose), callers (`dpRecalc` and `applyDose`) multiply by `freq` before calling `calcDose`:

```javascript
const isPerDay = band ? band.is_per_day !== false : true; // default per-day
const mgkgForCalc = isPerDay ? mgkg : mgkg * freq;
```

---

## 5. API Contracts

### 5.1 Input Requirements

**From `formularyCache[genericName]`**:

- `formulations[].form` -- SNOMED form display name (string)
- `formulations[].ingredients[].is_primary` -- boolean, selects which ingredient's concentration to use
- `formulations[].ingredients[].strength_numerator` -- number (mg)
- `formulations[].ingredients[].strength_numerator_unit` -- string ("mg", "mcg", etc.)
- `formulations[].ingredients[].strength_denominator` -- number (mL, tablet count)
- `formulations[].ingredients[].strength_denominator_unit` -- string ("ml", "tablet", etc.)
- `dosing_bands[]` -- array (see Section 8)

Fallback path in `getConc(f)` when no `ingredients` array: reads `f.conc_qty`, `f.conc_unit`, `f.per_qty`, `f.per_unit`.

**From `rxData.medicines[idx]`**:

- `row1_en` -- drug name with concentration parenthetical
- `row2_en` -- English dosing instruction (parsed for duration: `/for (\d+) days?/`)
- `row3_hi` -- Hindi dosing instruction
- `formulation` -- simplified form name
- `concentration_mg`, `concentration_per_ml` -- numbers
- `dose_mg_per_kg`, `dose_per_day_divided` -- numbers
- `max_dose_single_mg` -- number or null
- `method` -- string ("weight", "fixed", "age", etc.)
- `pictogram` -- object (optional)

**From `rxData.patient`**:

- `weight_kg` -- number
- `age` -- string (parsed by `parseAgeMonths`)

### 5.2 Output (What `applyDose` Writes)

**To `rxData.medicines[idx]`**:

- `row1_en` -- rebuilt: `"{CLEAN_NAME} {FORM} ({cmg}mg/{cml}{perUnit})"`
  - `perUnit` is `"tablet"` for tablet/capsule, `"ml"` otherwise
- `row2_en` -- rebuilt: `"{enD} {routeEn} {freqEn} daily.[ for {N} days.]"`
- `row3_hi` -- rebuilt: `"{hiD} {routeHi} दिन में {freqHi}[ दें][ {durHi}]।"`
- `calc` -- the calculation string from `calcDose`
- `dose_mg_per_kg` -- the mg/kg value from the panel
- `dose_per_day_divided` -- frequency from the panel
- `formulation` -- mapped from radio selection through `formMap`
- `concentration_mg` -- updated cmg
- `concentration_per_ml` -- updated cml
- `max_dose_single_mg` -- maxS

**To `rxData.patient`**:

- `weight_kg` -- updated from panel (in case doctor changed it)

**To `rxData.medicines[idx].pictogram`** (if exists):

- `dose_display` -- the `vol` string from calcDose
- `dose_qty` -- parsed float from vol
- `form` -- the formulation
- `times` -- array derived from frequency: 1=`["morning"]`, 2=`["morning","evening"]`, 3=`["morning","afternoon","evening"]`, 4=`["morning","afternoon","evening","bedtime"]`
- `duration_days` -- parsed from Row 2 duration match

**To DOM**:

- `{pid}-r1` textContent -- new Row 1
- `{pid}-r2` textContent -- new Row 2
- `{pid}-r3` textContent -- new Row 3
- `{pid}-calc` textContent -- "Calculation: " + calc
- `{pid}-flag` -- shown with max-dose text if capped, hidden otherwise
- Pictogram sidebar `.dose-sidebar` -- re-rendered via `renderPictogram(m)`
- Panel `.ep` -- closed (class `open` removed)
- Card outline -- green flash for 1.4s

### 5.3 Route Maps

`applyDose` uses two route maps (English and Hindi) keyed by form:

| Form key     | English route                          | Hindi route     |
| ------------ | -------------------------------------- | --------------- |
| syrup        | orally                                 | मुँह से         |
| drops        | orally (unless eye/nasal/ear detected) | मुँह से         |
| tablet       | orally                                 | मुँह से         |
| capsule      | orally                                 | मुँह से         |
| injection    | intramuscularly                        | इंजेक्शन से     |
| inhaler      | via inhaler                            | इनहेलर से       |
| nebulisation | via nebuliser                          | नेब्युलाइज़र से |
| cream        | topically                              | लगाएं           |
| ointment     | topically                              | लगाएं           |
| suppository  | rectally                               | गुदा में        |
| nasal        | intranasally                           | नाक में         |
| eye          | in the affected eye                    | आँख में         |
| iv           | intravenously                          | नस में          |

**Drop subtype detection**: If form is `"drops"` or contains "drop", `applyDose` inspects `m.row1_en + m.formulation` for keywords:

- "eye" / "ophthalmic" -> "in the affected eye" / "आँख में"
- "nasal" / "nose" -> "intranasally" / "नाक में"
- "ear" / "otic" / "aural" -> "in the affected ear" / "कान में"
- else -> "orally" / "मुँह से"

### 5.4 Form Map (Simplified to calcDose)

In `applyDose`, the selected radio value (simplified form) is mapped to a calcDose-compatible form name:

```javascript
const formMap = {
  syrup: "syrup",
  "dry syrup": "syrup",
  drops: "drops",
  "eye drops": "eye drops",
  "ear drops": "ear drops",
  "nasal drops": "nasal drops",
  tablet: "tablet",
  dt: "tablet",
  capsule: "capsule",
  injection: "injection",
  inhaler: "inhaler",
  nebulisation: "nebulisation",
  cream: "cream",
  ointment: "ointment",
  gel: "cream",
  suppository: "suppository",
  "nasal spray": "nasal",
  lotion: "cream",
  sachet: "syrup",
  patch: "cream",
};
```

### 5.5 Unit Override in `applyDose`

After calling `calcDose`, if the doctor selected a unit other than `"mL"`, `applyDose` overrides `r.vol`, `r.enD`, and `r.hiD`:

- **drops**: `drops = Math.round(mlPerDose * 20)`, Hindi from extended DN map (includes 24 "चौबीस", 25 "पच्चीस", 30 "तीस")
- **tsp**: `tsp = Math.round((mlPerDose / 5) * 2) / 2`, English shows `"{tsp} tsp ({ml} mL)"`, Hindi from TN map + "चम्मच"

---

## 6. Method-Aware Behavior

### 6.1 Weight-Based (`method: "weight"`)

Default and most common. The slider represents mg/kg/day (or mg/kg/dose if `is_per_day === false`). The multi-zone gradient visualises all dosing bands. The doctor drags to select a dose, and the output snaps to a prescribable quantity.

**Slider range**: 50% below the global minimum band to 200% above the global maximum band. This allows prescribing outside guidelines (shown in red) while making the recommended range prominent.

**Band matching**: A band matches if `mgkg >= b.dose_min_qty && mgkg <= (b.dose_max_qty || b.dose_min_qty)`. If no band matches, the slider value display shows a red "Outside recommended range" warning.

### 6.2 Fixed-Dose (`method: "fixed"` or `method: "age"`)

No weight calculation. The stepper shows whole units (drops, puffs, applications, mg, tablets). The doctor clicks +/- to adjust. The result is written directly without dividing by weight.

To make this work with `calcDose` (which always does `wt * mgkg`), `dpFixedChange` sets `cmg=1` and `cml=1`, and stores the quantity directly in `{pid}-mgkg`. This way `calcDose` produces `fd = wt * qty / freq` which is... incorrect -- but the result display is overridden directly by `dpFixedChange` before the user sees it. The `applyDose` path reads the same hidden fields.

### 6.3 BSA-Based (`method: "bsa"`)

Falls through to the weight-based slider path. The slider still shows mg/kg units. BSA-specific calculation (mg/m2) is not yet implemented in the client-side panel -- the AI generates BSA doses server-side, and the panel allows weight-based adjustment.

### 6.4 Infusion (`method: "infusion"`)

Falls through to the weight-based slider path. Rate-based calculations (mcg/kg/min, units/kg/hr) are not handled by the client panel.

### 6.5 GFR-Adjusted

Not implemented. GFR-adjusted dosing is handled by the AI via the `get_formulary` tool's `renal_bands` data, not by the dose calculator panel.

---

## 7. Known Limitations

1. **Combo drugs and `is_primary`**: `getConc()` uses `ingredients.find(i => i.is_primary) || ingredients[0]` to select which ingredient's concentration to use. For combination drugs (e.g., Amoxicillin + Clavulanate), only the primary ingredient's strength is shown. If `is_primary` is not set, the first ingredient is used, which may not be the active drug the dose is calculated for.

2. **Percentage concentrations**: Topical formulations often specify concentration as a percentage (e.g., "Mupirocin 2% ointment") rather than mg/mL. The `getConc()` function reads `strength_numerator` which may be `2` with unit `%`. This flows through to `calcDose` as `cmg=2`, which does not produce meaningful volume calculations. These drugs typically use `method: "fixed"` with `dose_unit: "application"`, bypassing the concentration math.

3. **BSA not implemented client-side**: Drugs dosed by body surface area (`method: "bsa"`, `dose_unit: "mg/m2"`) fall through to the weight-based slider, which shows mg/kg units. The slider works but the units displayed are misleading.

4. **Infusion rates not implemented**: Drugs with `method: "infusion"` and units like `mcg/kg/min` or `units/kg/hr` fall through to the basic slider. The calculation assumes simple weight-based dosing.

5. **Fixed-dose `calcDose` hack**: For fixed-dose drugs, `dpFixedChange` sets `cmg=1, cml=1` and stores the dose quantity in the mg/kg field. The `calcDose` function then computes `wt * qty` which is nonsensical, but the result is overridden by direct DOM updates in `dpFixedChange`. The `applyDose` path also calls `calcDose` with these values, so the calc string for fixed-dose drugs shows misleading intermediate math.

6. **Duration parsing**: Only the pattern `for N days` or `x N days` is extracted from Row 2. Other duration formats (e.g., "for 2 weeks", "until resolved") are lost on apply.

7. **Tsp display**: The tsp parenthetical in Hindi for syrup (`HN` map) only shows when the tsp value is a whole integer (`Number.isInteger(tsp)`). Half-tsp values like 0.5 tsp do not get the parenthetical.

8. **No undo**: Apply is immediate. The only recovery is to close without applying (Cancel) or to re-adjust. There is no undo stack.

9. **`switchFormulation` (legacy)**: A legacy function at line 6118 that reads from a `{pid}-form` select element (no longer rendered). It is still callable but not invoked by current UI. `dpFormChanged` is the active replacement.

---

## 8. Dosing Band Schema

Each entry in `formularyCache[drug].dosing_bands[]` is a JSON object with the following fields:

| Field                   | Type           | Allowed values                                                                                                                                                                                                                                                                          | Description                                                                                                                                                                          |
| ----------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `indication`            | string         | Free text                                                                                                                                                                                                                                                                               | Clinical indication (e.g., "Epilepsy", "Acne vulgaris")                                                                                                                              |
| `age_band`              | string         | `"neonate"`, `"infant"`, `"child"`, `"adolescent"`, `"all"`                                                                                                                                                                                                                             | Target age group. `getDoseRef` matches against patient age: <1mo = neonate, 1-11mo = infant, 12-143mo = child, >=144mo = adolescent                                                  |
| `ga_weeks_min`          | number or null |                                                                                                                                                                                                                                                                                         | Gestational age minimum (for neonatal drugs)                                                                                                                                         |
| `ga_weeks_max`          | number or null |                                                                                                                                                                                                                                                                                         | Gestational age maximum                                                                                                                                                              |
| `method`                | string         | `"weight"`, `"bsa"`, `"fixed"`, `"age"`, `"infusion"`                                                                                                                                                                                                                                   | Dosing calculation method. Determines slider vs stepper in the panel                                                                                                                 |
| `dose_min_qty`          | number         |                                                                                                                                                                                                                                                                                         | Minimum dose quantity                                                                                                                                                                |
| `dose_min_unit`         | string or null | See dose_unit values                                                                                                                                                                                                                                                                    | Unit for dose_min_qty (used when dose_unit is absent)                                                                                                                                |
| `dose_max_qty`          | number or null |                                                                                                                                                                                                                                                                                         | Maximum dose quantity. If null, treated as equal to dose_min_qty                                                                                                                     |
| `dose_max_unit`         | string or null |                                                                                                                                                                                                                                                                                         | Unit for dose_max_qty                                                                                                                                                                |
| `dose_unit`             | string         | `"mg/kg/day"`, `"mg/kg/dose"`, `"mg/kg"`, `"mg/dose"`, `"mg"`, `"mg/m2"`, `"mcg/kg"`, `"mcg/kg/min"`, `"units/kg"`, `"IU"`, `"puffs"`, `"drops"`, `"tablet"`, `"capsule"`, `"application"`, `"mL"`, `"g/kg/day"`, `"mEq/kg"`, `"units/kg/hr"`, `"ng/kg/min"`, ... (many compound units) | Unit for the dose range. Displayed in the slider value and dosing reference                                                                                                          |
| `dose_basis`            | string or null | `"per_dose"`, `"per_kg"`, `"per_m2"`                                                                                                                                                                                                                                                    | What the quantity is relative to                                                                                                                                                     |
| `is_per_day`            | boolean        | `true`, `false`                                                                                                                                                                                                                                                                         | Whether dose_min/max_qty is a daily total or per-administration. Default `true`. Critical for the per-day/per-dose conversion                                                        |
| `frequency_per_day`     | number         | 1-6                                                                                                                                                                                                                                                                                     | Recommended administrations per day                                                                                                                                                  |
| `interval_hours`        | number or null |                                                                                                                                                                                                                                                                                         | Hours between doses                                                                                                                                                                  |
| `duration_days`         | number or null |                                                                                                                                                                                                                                                                                         | Recommended duration in days (legacy field)                                                                                                                                          |
| `duration_days_default` | number or null |                                                                                                                                                                                                                                                                                         | Default duration in days                                                                                                                                                             |
| `duration_note`         | string or null |                                                                                                                                                                                                                                                                                         | Free-text duration guidance                                                                                                                                                          |
| `max_single_qty`        | number or null |                                                                                                                                                                                                                                                                                         | Maximum dose per administration in absolute units                                                                                                                                    |
| `max_single_unit`       | string or null | `"mg"`, `"application"`, etc.                                                                                                                                                                                                                                                           | Unit for max_single_qty                                                                                                                                                              |
| `max_daily_qty`         | number or null |                                                                                                                                                                                                                                                                                         | Maximum total daily dose                                                                                                                                                             |
| `max_daily_unit`        | string or null |                                                                                                                                                                                                                                                                                         | Unit for max_daily_qty                                                                                                                                                               |
| `loading_dose_qty`      | number or null |                                                                                                                                                                                                                                                                                         | Loading dose quantity (not used by panel)                                                                                                                                            |
| `loading_dose_unit`     | string or null |                                                                                                                                                                                                                                                                                         | Loading dose unit                                                                                                                                                                    |
| `loading_dose_basis`    | string or null |                                                                                                                                                                                                                                                                                         | Loading dose basis                                                                                                                                                                   |
| `maintenance_dose_qty`  | number or null |                                                                                                                                                                                                                                                                                         | Maintenance dose (not used by panel)                                                                                                                                                 |
| `maintenance_dose_unit` | string or null |                                                                                                                                                                                                                                                                                         | Maintenance dose unit                                                                                                                                                                |
| `rounding_rule`         | string         | `"0.5ml"`, `"0.1ml"`, `"exact"`, `"whole_unit"`, `"whole_tab"`, `"quarter_tab"`, `"whole_cap"`, `"nearest_syringe_size"`, `"nearest_sachet"`, `"nearest_vial"`, `"nearest_mEq"`, `"whole_tab_or_sachet"`                                                                                | How to round the final output. Affects slider step size. Only `"exact"` and `"quarter_tab"` have special handling in the slider step calculation; others use the range-based default |
| `notes`                 | string or null |                                                                                                                                                                                                                                                                                         | Clinical notes, warnings, special instructions                                                                                                                                       |

### 8.1 Age Band Matching in `getDoseRef`

```javascript
function parseAgeMonths(ageStr)
// "2yr 3mo" -> 27 months
// "5d" -> 0 months
// Returns null if unparseable

// In getDoseRef:
if (ageMonths < 1)    ageBand = "neonate"
else if (ageMonths < 12)  ageBand = "infant"
else if (ageMonths < 144) ageBand = "child"     // < 12 years
else                      ageBand = "adolescent"
```

Matching priority: bands where `b.age_band === ageBand || b.age_band === "all"`. If no bands match, falls back to `[bands[0]]`.

Return value of `getDoseRef`:

```javascript
{
  (bands, // Array: matched bands for this age (primary set)
    allBands, // Array: ALL dosing bands for this drug (used for slider zones)
    ageBand); // String: the determined age band
}
```

### 8.2 Band Display (`fmtDoseBand`)

Formats a single band as a one-line string:

- If min == max: `"{min} {unit}"`
- If min != max: `"{min}-{max} {unit}"`
- Appends `/day` if `is_per_day` is true
- Appends `/dose` if `dose_basis === "per_kg"`
- Appends frequency: `", OD"` / `", BD"` / `", TDS"` / `", QID"` or `", {n}x/day"`
- Appends max single: `", max {qty}{unit}/dose"` if present

---

## 9. Function Reference

| Function                                         | Line | Purpose                                                                                                     |
| ------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------- |
| `getConc(f)`                                     | 2145 | Extracts concentration from a formulation object (handles both `ingredients[]` and flat `conc_qty` formats) |
| `simplifyForm(form)`                             | 2248 | Maps SNOMED form names to doctor-friendly categories                                                        |
| `getUnitOptions(form)`                           | 2294 | Returns array of output unit choices for a given simplified form                                            |
| `dpFormChanged(pid, idx)`                        | 2312 | Form radio changed: rebuilds strength + unit radios, cascades to recalc                                     |
| `dpStrengthChanged(pid, idx)`                    | 2400 | Strength radio changed: updates concentration hidden fields, recalcs                                        |
| `dpUnitChanged(pid, idx)`                        | 2417 | Unit radio changed: triggers recalc                                                                         |
| `dpSliderChanged(pid, idx)`                      | 2422 | Slider input: snaps to discrete output, updates display, recalcs                                            |
| `dpFreqChange(pid, idx, delta)`                  | 2523 | Frequency +/-: clamps [1,6], recalcs                                                                        |
| `dpFixedChange(pid, idx, delta)`                 | 2534 | Fixed-dose stepper +/-: unit-aware step, direct result update                                               |
| `dpRecalc(pid, idx)`                             | 2612 | Master recalculator: reads all state, calls calcDose, updates result                                        |
| `parseAgeMonths(ageStr)`                         | 2788 | Parses age string to months                                                                                 |
| `getDoseRef(drugName, patientAge)`               | 2802 | Looks up matched dosing bands from formularyCache                                                           |
| `fmtDoseBand(b)`                                 | 2873 | Formats a dosing band for display                                                                           |
| `calcDose(wt, mgkg, freq, cmg, cml, maxS, form)` | 5076 | Core calculation engine: mg/kg/day to dispensable output                                                    |
| `toggleEP(pid, idx)`                             | 5854 | Opens/closes the expand panel (only one open at a time)                                                     |
| `liveCalc(pid, idx)`                             | 5865 | Delegates to `dpRecalc` (called when panel opens)                                                           |
| `applyDose(pid, idx)`                            | 5869 | Reads panel state, calls calcDose, writes to rxData + DOM                                                   |
| `switchFormulation(pid, idx)`                    | 6118 | Legacy formulation switcher (reads from `{pid}-form` select, no longer rendered)                            |
