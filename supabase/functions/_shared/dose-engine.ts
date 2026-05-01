/**
 * Universal Dose Calculation Engine — TypeScript port for Edge Functions.
 *
 * Verbatim port of web/dose-engine.js (the doctor-facing source of truth per
 * CLAUDE.md). Two callers — the prescription pad (browser) and the
 * generate-prescription Edge Function — share the same arithmetic. Any logic
 * change here MUST be mirrored in web/dose-engine.js, and vice versa.
 *
 * Sprint 2 (2026-05-02): introduced as the deterministic backstop for the
 * compute_doses tool, so the LLM stops doing dose math and instead delegates
 * to this module. Per Goodell et al. 2025 (npj Digital Medicine), tool-based
 * deterministic calculation beats LLM mental math 95% vs 36% on hard
 * pediatric tasks.
 *
 * Pure calculation. No DOM access. No I/O. Safe to import from Deno or browser.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface Ingredient {
  name: string;
  isPrimary: boolean;
  concMgPerUnit: number;
  strengthNum: number;
  strengthNumUnit: string;
  strengthDen: number;
  strengthDenUnit: string;
  doseMinPerKg: number | null;
  doseMaxPerKg: number | null;
  maxSingleMg: number | null;
  maxDailyMg: number | null;
  snomed_code?: string;
}

export interface FormulationLike {
  ingredients?: any[];
  conc_qty?: number;
  per_qty?: number;
  conc_unit?: string;
  per_unit?: string;
}

export interface IngredientBand {
  ingredient?: string;
  snomed_code?: string;
  ingredient_doses?: any[];
  max_single_mg?: number;
  max_daily_mg?: number;
}

export interface IngredientDoseDetail {
  name: string;
  isPrimary: boolean;
  mgPerDose: number;
  mgPerDay: number;
  mgPerKg: number | null;
  maxExceeded: boolean;
  maxNote: string | null;
  withinRange: boolean | null;
}

export interface ComputeDoseParams {
  method?: "weight" | "bsa" | "fixed" | "gfr" | "infusion" | "age";
  weight?: number;
  bsa?: number;
  heightCm?: number;
  sliderValue?: number;
  isPerDay?: boolean;
  frequency?: number;
  ingredients?: Ingredient[];
  form?: string;
  outputUnit?: string;
  dropsPerMl?: number;
  ingredientBands?: IngredientBand[];
  /** @deprecated use ingredientBands */
  maxSingleDoseMg?: number;
  /** @deprecated use ingredientBands */
  maxDailyDoseMg?: number;
}

export interface ComputeDoseResult {
  vol: string;
  enD: string;
  hiD: string;
  calc: string;
  capped: boolean;
  fd: string;
  volumeMl: number;
  volumeUnits: number;
  ingredientDoses: IngredientDoseDetail[];
  warnings: string[];
}

export interface RoundResult {
  value: number;
  unit: string;
  volumeMl: number;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS — bilingual maps
// ═══════════════════════════════════════════════════════════════

export const HINDI_DROPS: Record<number, string> = {
  1: "एक",
  2: "दो",
  3: "तीन",
  4: "चार",
  5: "पाँच",
  6: "छह",
  7: "सात",
  8: "आठ",
  9: "नौ",
  10: "दस",
  12: "बारह",
  15: "पंद्रह",
  20: "बीस",
  24: "चौबीस",
  25: "पच्चीस",
  30: "तीस",
};

export const HINDI_ML: Record<number, string> = {
  0.5: "आधा",
  1: "एक",
  1.5: "डेढ़",
  2: "दो",
  2.5: "ढाई",
  3: "तीन",
  3.5: "साढ़े तीन",
  4: "चार",
  4.5: "साढ़े चार",
  5: "पाँच",
  5.5: "साढ़े पाँच",
  6: "छह",
  7: "सात",
  7.5: "साढ़े सात",
  8: "आठ",
  10: "दस",
};

export const HINDI_TABLETS: Record<number, string> = {
  0.25: "चौथाई",
  0.5: "आधी",
  0.75: "तीन-चौथाई",
  1: "एक",
  1.5: "डेढ़",
  2: "दो",
};

export const HINDI_UNITS: Record<string, string> = {
  drops: "बूँदें",
  puffs: "पफ",
  tablet: "गोली",
  capsule: "कैप्सूल",
  application: "लगाएं",
  mg: "mg",
  mL: "ml",
  sprays: "स्प्रे",
  tsp: "चम्मच",
  sachet: "सैशे",
};

export const FREQ_EN: Record<number, string> = {
  1: "once",
  2: "twice",
  3: "three times",
  4: "four times",
  5: "five times",
  6: "six times",
};

export const FREQ_HI: Record<number, string> = {
  1: "एक बार",
  2: "दो बार",
  3: "तीन बार",
  4: "चार बार",
  5: "पाँच बार",
  6: "छह बार",
};

export const DROPS_PER_ML = 20;

// ═══════════════════════════════════════════════════════════════
// parseIngredients — same behaviour as web/dose-engine.js
// ═══════════════════════════════════════════════════════════════

export function parseIngredients(formulation: FormulationLike | null | undefined): Ingredient[] {
  if (!formulation) return [];
  const ings = formulation.ingredients;
  if (ings && ings.length) {
    return ings.map((i: any) => {
      const sn = i.strength_numerator || 0;
      const sd = i.strength_denominator || 1;
      const concPerUnit = sd !== 0 ? sn / sd : sn;
      return {
        name: i.name || "Unknown",
        isPrimary: !!i.is_primary,
        concMgPerUnit: concPerUnit,
        strengthNum: sn,
        strengthNumUnit: i.strength_numerator_unit || "mg",
        strengthDen: sd,
        strengthDenUnit: i.strength_denominator_unit || "mL",
        doseMinPerKg: null,
        doseMaxPerKg: null,
        maxSingleMg: null,
        maxDailyMg: null,
        snomed_code: i.snomed_code,
      } as Ingredient;
    });
  }
  // Legacy fallback — same as JS
  return [
    {
      name: "Active ingredient",
      isPrimary: true,
      concMgPerUnit:
        formulation.conc_qty && formulation.per_qty
          ? formulation.conc_qty / formulation.per_qty
          : formulation.conc_qty || 0,
      strengthNum: formulation.conc_qty || 0,
      strengthNumUnit: formulation.conc_unit || "mg",
      strengthDen: formulation.per_qty || 1,
      strengthDenUnit: formulation.per_unit || "mL",
      doseMinPerKg: null,
      doseMaxPerKg: null,
      maxSingleMg: null,
      maxDailyMg: null,
    },
  ];
}

export function makeIngredient(
  name: string,
  isPrimary: boolean,
  cmg: number,
  cmgUnit: string,
  cml: number,
  cmlUnit: string,
): Ingredient {
  return {
    name: name || "Active ingredient",
    isPrimary: isPrimary,
    concMgPerUnit: cml !== 0 ? cmg / cml : cmg,
    strengthNum: cmg,
    strengthNumUnit: cmgUnit || "mg",
    strengthDen: cml,
    strengthDenUnit: cmlUnit || "mL",
    doseMinPerKg: null,
    doseMaxPerKg: null,
    maxSingleMg: null,
    maxDailyMg: null,
  };
}

// ═══════════════════════════════════════════════════════════════
// BSA — Mosteller formula
// ═══════════════════════════════════════════════════════════════

export function calculateBSA(weightKg: number, heightCm: number): number | null {
  if (!weightKg || !heightCm) return null;
  return Math.sqrt((heightCm * weightKg) / 3600);
}

// ═══════════════════════════════════════════════════════════════
// roundToUnit — form-specific rounding
// ═══════════════════════════════════════════════════════════════

export function roundToUnit(
  rawValue: number,
  form: string,
  outputUnit: string,
  dropsPerMl?: number,
): RoundResult {
  const dpm = dropsPerMl || DROPS_PER_ML;

  if (
    outputUnit === "drops" ||
    form === "drops" ||
    form === "eye drops" ||
    form === "ear drops" ||
    form === "nasal drops"
  ) {
    if (outputUnit === "drops" || !outputUnit || outputUnit === "mL") {
      const drops = Math.round(rawValue * dpm);
      return {
        value: Math.max(1, drops),
        unit: "drops",
        volumeMl: drops / dpm,
      };
    }
  }
  if (outputUnit === "tsp") {
    const tsp = Math.round((rawValue / 5) * 2) / 2;
    return { value: Math.max(0.5, tsp), unit: "tsp", volumeMl: tsp * 5 };
  }
  if (outputUnit === "tablet" || form === "tablet" || form === "dt") {
    const tabs = Math.round(rawValue * 4) / 4;
    return { value: Math.max(0.25, tabs), unit: "tablet", volumeMl: 0 };
  }
  if (outputUnit === "capsule" || form === "capsule") {
    const caps = Math.max(1, Math.round(rawValue));
    return { value: caps, unit: "capsule", volumeMl: 0 };
  }
  if (outputUnit === "puffs" || form === "inhaler") {
    const puffs = Math.max(1, Math.round(rawValue));
    return { value: puffs, unit: "puffs", volumeMl: 0 };
  }
  if (form === "suppository") {
    return { value: Math.round(rawValue), unit: "mg", volumeMl: 0 };
  }
  if (form === "injection") {
    const ml = Math.round(rawValue * 10) / 10;
    return { value: Math.max(0.1, ml), unit: "mL", volumeMl: ml };
  }
  if (
    outputUnit === "application" ||
    form === "cream" ||
    form === "ointment" ||
    form === "gel" ||
    form === "lotion"
  ) {
    return {
      value: Math.max(1, Math.round(rawValue)),
      unit: "application",
      volumeMl: 0,
    };
  }
  if (outputUnit === "sprays" || form === "nasal spray") {
    return {
      value: Math.max(1, Math.round(rawValue)),
      unit: "sprays",
      volumeMl: 0,
    };
  }
  if (outputUnit === "sachet" || form === "sachet") {
    return {
      value: Math.max(1, Math.ceil(rawValue)),
      unit: "sachet",
      volumeMl: 0,
    };
  }
  // Default: mL rounded to 0.5
  const v = Math.round(rawValue * 2) / 2;
  return { value: Math.max(0.5, v), unit: "mL", volumeMl: v };
}

export function isSolidForm(form: string | undefined): boolean {
  return /tablet|capsule|dt|suppository|sachet|patch/i.test(form || "");
}

function _findIngBand(
  ingredientBands: IngredientBand[] | undefined,
  ing: Ingredient,
): IngredientBand | null {
  if (!ingredientBands || !ingredientBands.length) return null;
  if (ing.snomed_code) {
    const snomedMatch = ingredientBands.find(
      (ib) => ib.snomed_code && ib.snomed_code === ing.snomed_code,
    );
    if (snomedMatch) return snomedMatch;
  }
  return (
    ingredientBands.find((ib) => {
      if (!ib.ingredient || !ing.name) return false;
      return (
        ing.name.toLowerCase().indexOf(ib.ingredient.toLowerCase()) >= 0 ||
        ib.ingredient.toLowerCase().indexOf(ing.name.toLowerCase()) >= 0
      );
    }) || null
  );
}

function _getLimiting(band: IngredientBand | null | undefined): any | null {
  const ids = band && band.ingredient_doses;
  if (!ids || !ids.length) return null;
  return ids.find((id: any) => id.is_limiting) || ids[0];
}

// ═══════════════════════════════════════════════════════════════
// computeDose — MAIN CALCULATION
// ═══════════════════════════════════════════════════════════════

export function computeDose(params: ComputeDoseParams): ComputeDoseResult {
  const method = params.method || "weight";
  const weight = params.weight || 0;
  const bsa =
    params.bsa ||
    (params.heightCm ? calculateBSA(weight, params.heightCm) : null);
  const sv = params.sliderValue || 0;
  const isPerDay = params.isPerDay !== false;
  const freq = params.frequency || 1;
  const ingredients = params.ingredients || [];
  const form = (params.form || "syrup").toLowerCase();
  const outputUnit = params.outputUnit || "mL";
  const dpm = params.dropsPerMl || DROPS_PER_ML;
  const ingredientBands = params.ingredientBands || [];
  const maxSingleMg = params.maxSingleDoseMg;
  const maxDailyMg = params.maxDailyDoseMg;

  if (!ingredients.length) {
    return _emptyResult();
  }

  const primary = ingredients.find((i) => i.isPrimary) || ingredients[0];
  let capped = false;
  const warnings: string[] = [];
  let primaryMgPerDose: number;

  if (method === "fixed" || method === "age") {
    if (isSolidForm(form)) {
      primaryMgPerDose = sv * primary.concMgPerUnit * primary.strengthDen;
    } else if (outputUnit === "drops" || form.indexOf("drop") >= 0) {
      primaryMgPerDose = (sv / dpm) * primary.concMgPerUnit;
    } else {
      primaryMgPerDose = sv * primary.concMgPerUnit;
    }
  } else if (method === "bsa") {
    if (!bsa) {
      warnings.push(
        "Height required for BSA dosing — using weight-based fallback",
      );
      primaryMgPerDose = isPerDay ? (sv * weight) / freq : sv * weight;
    } else {
      primaryMgPerDose = isPerDay ? (sv * bsa) / freq : sv * bsa;
    }
  } else {
    primaryMgPerDose = isPerDay ? (sv * weight) / freq : sv * weight;
  }

  const primaryBand = _findIngBand(ingredientBands, primary);
  const effMaxSingle =
    (primaryBand && primaryBand.max_single_mg) || maxSingleMg;

  if (effMaxSingle && primaryMgPerDose > effMaxSingle) {
    primaryMgPerDose = effMaxSingle;
    capped = true;
    warnings.push(
      "Max single dose " + effMaxSingle + "mg applied (" + primary.name + ")",
    );
  }

  let volumeRaw: number;
  if (primary.concMgPerUnit <= 0) {
    volumeRaw = 0;
  } else if (isSolidForm(form)) {
    volumeRaw =
      primaryMgPerDose / (primary.concMgPerUnit * primary.strengthDen);
  } else {
    volumeRaw = primaryMgPerDose / primary.concMgPerUnit;
  }

  const rounded = roundToUnit(volumeRaw, form, outputUnit, dpm);
  const roundedValue = rounded.value;
  const dispUnit = rounded.unit;
  const roundedMl = rounded.volumeMl;

  let actualPrimaryMg: number;
  if (isSolidForm(form)) {
    actualPrimaryMg =
      roundedValue * primary.concMgPerUnit * primary.strengthDen;
  } else if (dispUnit === "drops") {
    actualPrimaryMg = (roundedValue / dpm) * primary.concMgPerUnit;
  } else if (dispUnit === "tsp") {
    actualPrimaryMg = roundedValue * 5 * primary.concMgPerUnit;
  } else {
    actualPrimaryMg = roundedValue * primary.concMgPerUnit;
  }

  const ingredientDoses: IngredientDoseDetail[] = ingredients.map((ing) => {
    let mgPerDose: number;
    if (isSolidForm(form)) {
      mgPerDose = roundedValue * ing.concMgPerUnit * ing.strengthDen;
    } else if (dispUnit === "drops") {
      mgPerDose = (roundedValue / dpm) * ing.concMgPerUnit;
    } else if (dispUnit === "tsp") {
      mgPerDose = roundedValue * 5 * ing.concMgPerUnit;
    } else {
      mgPerDose = (roundedMl || roundedValue) * ing.concMgPerUnit;
    }

    const mgPerDay = mgPerDose * freq;
    const mgPerKg = weight > 0 ? mgPerDose / weight : null;
    let maxExceeded = false;
    let maxNote: string | null = null;

    const ib = _findIngBand(ingredientBands, ing);
    const ingMaxSingle = (ib && ib.max_single_mg) || ing.maxSingleMg || null;
    const ingMaxDaily = (ib && ib.max_daily_mg) || ing.maxDailyMg || null;

    if (ingMaxSingle && mgPerDose > ingMaxSingle) {
      maxExceeded = true;
      maxNote = "exceeds max " + ingMaxSingle + "mg/dose";
      warnings.push(ing.name + ": " + maxNote);
    }
    if (ingMaxDaily && mgPerDay > ingMaxDaily) {
      maxExceeded = true;
      const dailyNote = "exceeds max " + ingMaxDaily + "mg/day";
      maxNote = maxNote ? maxNote + "; " + dailyNote : dailyNote;
      warnings.push(ing.name + ": " + dailyNote);
    }

    const ibMin = ib ? (ib as any).dose_min_qty : ing.doseMinPerKg || null;
    const ibMax = ib
      ? (ib as any).dose_max_qty || (ib as any).dose_min_qty
      : ing.doseMaxPerKg || null;
    let withinRange: boolean | null = null;
    if (ibMin != null && mgPerKg != null) {
      withinRange = mgPerKg >= ibMin && mgPerKg <= (ibMax || ibMin);
    }

    return {
      name: ing.name,
      isPrimary: ing.isPrimary,
      mgPerDose: Math.round(mgPerDose * 1000) / 1000,
      mgPerDay: Math.round(mgPerDay * 1000) / 1000,
      mgPerKg: mgPerKg !== null ? Math.round(mgPerKg * 1000) / 1000 : null,
      maxExceeded: maxExceeded,
      maxNote: maxNote,
      withinRange: withinRange,
    };
  });

  const display = formatDoseDisplay(roundedValue, dispUnit, form, outputUnit);
  const calcStr = buildCalcString(
    method,
    sv,
    isPerDay,
    weight,
    bsa,
    freq,
    primaryMgPerDose,
    roundedValue,
    dispUnit,
    ingredientDoses,
    capped,
    maxSingleMg,
  );

  return {
    vol: display.vol,
    enD: display.enD,
    hiD: display.hiD,
    calc: calcStr,
    capped: capped,
    fd: String(Math.round(actualPrimaryMg)),
    volumeMl: roundedMl || 0,
    volumeUnits: roundedValue,
    ingredientDoses: ingredientDoses,
    warnings: warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// formatDoseDisplay — bilingual vol/enD/hiD
// ═══════════════════════════════════════════════════════════════

export function formatDoseDisplay(
  value: number,
  unit: string,
  form: string,
  outputUnit: string,
): { vol: string; enD: string; hiD: string } {
  let vol: string, enD: string, hiD: string;

  if (unit === "drops") {
    vol = value + " drops";
    enD = value + " drop" + (value !== 1 ? "s" : "");
    hiD =
      (HINDI_DROPS[value] || String(value)) +
      " बूँदें";
  } else if (unit === "mL") {
    vol = value + "ml";
    enD = value + "ml";
    hiD = (HINDI_ML[value] || String(value)) + " ml";
    const tspVal = value / 5;
    if (tspVal >= 0.5 && Number.isInteger(tspVal * 2)) {
      const tspHi = HINDI_ML[tspVal] || String(tspVal);
      hiD += " (" + tspHi + " चम्मच)";
    }
  } else if (unit === "tablet") {
    vol = value + " tablet";
    enD = value + " tablet" + (value !== 1 ? "s" : "");
    hiD =
      (HINDI_TABLETS[value] || String(value)) + " गोली";
  } else if (unit === "capsule") {
    vol = value + " capsule";
    enD = value + " capsule" + (value !== 1 ? "s" : "");
    hiD =
      (HINDI_TABLETS[value] || String(value)) +
      " कैप्सूल";
  } else if (unit === "puffs") {
    vol = value + " puff" + (value !== 1 ? "s" : "");
    enD = vol;
    hiD = String(value) + " पफ";
  } else if (unit === "tsp") {
    vol = value + " tsp";
    enD = value + " tsp (" + value * 5 + " mL)";
    hiD =
      (HINDI_ML[value] || String(value)) + " चम्मच";
  } else if (unit === "application") {
    vol = value + " application";
    enD = vol;
    hiD = String(value) + " लगाएं";
  } else if (unit === "sprays") {
    vol = value + " spray" + (value !== 1 ? "s" : "");
    enD = vol;
    hiD = String(value) + " स्प्रे";
  } else if (unit === "sachet") {
    vol = value + " sachet" + (value !== 1 ? "s" : "");
    enD = vol;
    hiD = String(value) + " सैशे";
  } else if (unit === "mg") {
    vol = value + "mg";
    enD = value + "mg";
    hiD = value + " mg";
  } else {
    vol = value + unit;
    enD = value + " " + unit;
    hiD = String(value) + " " + (HINDI_UNITS[unit] || unit);
  }

  return { vol: vol, enD: enD, hiD: hiD };
}

// ═══════════════════════════════════════════════════════════════
// buildCalcString — human-readable calculation trace
// ═══════════════════════════════════════════════════════════════

export function buildCalcString(
  method: string,
  sv: number,
  isPerDay: boolean,
  weight: number,
  bsa: number | null,
  freq: number,
  primaryMgPerDose: number,
  roundedValue: number,
  dispUnit: string,
  ingredientDoses: IngredientDoseDetail[],
  capped: boolean,
  maxSingleMg: number | undefined,
): string {
  const lines: string[] = [];
  const multi = ingredientDoses.length > 1;

  if (method === "fixed" || method === "age") {
    lines.push(roundedValue + " " + dispUnit);
    ingredientDoses.forEach((id) => {
      const mgStr = id.mgPerDose.toFixed(2) + "mg";
      const kgStr =
        id.mgPerKg !== null ? " (" + id.mgPerKg.toFixed(3) + "mg/kg)" : "";
      const flag = id.maxExceeded ? " ⚠" : "";
      lines.push("  " + id.name + ": " + mgStr + kgStr + flag);
    });
  } else if (method === "bsa" && bsa) {
    const bsaLabel = isPerDay ? "mg/m²/day" : "mg/m²/dose";
    const totalDay = isPerDay ? sv * bsa : sv * bsa * freq;
    lines.push(
      sv +
        bsaLabel +
        " × " +
        bsa.toFixed(2) +
        "m² = " +
        totalDay.toFixed(1) +
        "mg/day ÷ " +
        freq +
        " = " +
        primaryMgPerDose.toFixed(1) +
        "mg/dose" +
        (capped ? " → max " + maxSingleMg + "mg" : "") +
        " → " +
        roundedValue +
        dispUnit,
    );
    if (multi) {
      ingredientDoses.forEach((id) => {
        if (!id.isPrimary) {
          lines.push(
            "  " + id.name + ": " + id.mgPerDose.toFixed(2) + "mg/dose",
          );
        }
      });
    }
  } else {
    const unitLabel = isPerDay ? "mg/kg/day" : "mg/kg/dose";
    const totalDay2 = isPerDay ? sv * weight : sv * weight * freq;
    const primary =
      ingredientDoses.find((d) => d.isPrimary) || ingredientDoses[0];
    lines.push(
      sv +
        unitLabel +
        " × " +
        weight +
        "kg = " +
        totalDay2.toFixed(1) +
        "mg/day ÷ " +
        freq +
        " = " +
        primary.mgPerDose.toFixed(1) +
        "mg/dose" +
        (capped ? " → max " + maxSingleMg + "mg" : "") +
        " → " +
        roundedValue +
        dispUnit,
    );
    if (multi) {
      ingredientDoses.forEach((id) => {
        if (!id.isPrimary) {
          const kgStr =
            id.mgPerKg !== null
              ? " (" + id.mgPerKg.toFixed(2) + "mg/kg)"
              : "";
          lines.push(
            "  " +
              id.name +
              ": " +
              id.mgPerDose.toFixed(2) +
              "mg/dose" +
              kgStr,
          );
        }
      });
    }
  }

  return lines.join("\n");
}

function _emptyResult(): ComputeDoseResult {
  return {
    vol: "0",
    enD: "0",
    hiD: "0",
    calc: "",
    capped: false,
    fd: "0",
    volumeMl: 0,
    volumeUnits: 0,
    ingredientDoses: [],
    warnings: [],
  };
}
