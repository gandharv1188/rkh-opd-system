/**
 * Universal Dose Calculation Engine
 * Radhakishan Hospital Pediatric OPD Prescription System
 *
 * Pure calculation logic — no DOM access.
 * Handles mono + multi-ingredient drugs, all dosing methods,
 * route-based band filtering, and per-ingredient safety checks.
 *
 * Loaded via <script src="dose-engine.js"></script> before inline script.
 * Exports: window.DoseEngine
 */

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════
  // CONSTANTS — bilingual maps (consolidated from 5+ locations)
  // ═══════════════════════════════════════════════════════════════

  const HINDI_DROPS = {
    1: "\u090F\u0915",
    2: "\u0926\u094B",
    3: "\u0924\u0940\u0928",
    4: "\u091A\u093E\u0930",
    5: "\u092A\u093E\u0901\u091A",
    6: "\u091B\u0939",
    7: "\u0938\u093E\u0924",
    8: "\u0906\u0920",
    9: "\u0928\u094C",
    10: "\u0926\u0938",
    12: "\u092C\u093E\u0930\u0939",
    15: "\u092A\u0902\u0926\u094D\u0930\u0939",
    20: "\u092C\u0940\u0938",
    24: "\u091A\u094C\u092C\u0940\u0938",
    25: "\u092A\u091A\u094D\u091A\u0940\u0938",
    30: "\u0924\u0940\u0938",
  };

  const HINDI_ML = {
    0.5: "\u0906\u0927\u093E",
    1: "\u090F\u0915",
    1.5: "\u0921\u0947\u0922\u093C",
    2: "\u0926\u094B",
    2.5: "\u0922\u093E\u0908",
    3: "\u0924\u0940\u0928",
    3.5: "\u0938\u093E\u0922\u093C\u0947 \u0924\u0940\u0928",
    4: "\u091A\u093E\u0930",
    4.5: "\u0938\u093E\u0922\u093C\u0947 \u091A\u093E\u0930",
    5: "\u092A\u093E\u0901\u091A",
    5.5: "\u0938\u093E\u0922\u093C\u0947 \u092A\u093E\u0901\u091A",
    6: "\u091B\u0939",
    7: "\u0938\u093E\u0924",
    7.5: "\u0938\u093E\u0922\u093C\u0947 \u0938\u093E\u0924",
    8: "\u0906\u0920",
    10: "\u0926\u0938",
  };

  const HINDI_TABLETS = {
    0.25: "\u091A\u094C\u0925\u093E\u0908",
    0.5: "\u0906\u0927\u0940",
    0.75: "\u0924\u0940\u0928-\u091A\u094C\u0925\u093E\u0908",
    1: "\u090F\u0915",
    1.5: "\u0921\u0947\u0922\u093C",
    2: "\u0926\u094B",
  };

  const HINDI_UNITS = {
    drops: "\u092C\u0942\u0901\u0926\u0947\u0902",
    puffs: "\u092A\u092B",
    tablet: "\u0917\u094B\u0932\u0940",
    capsule: "\u0915\u0948\u092A\u094D\u0938\u0942\u0932",
    application: "\u0932\u0917\u093E\u090F\u0902",
    mg: "mg",
    mL: "ml",
    sprays: "\u0938\u094D\u092A\u094D\u0930\u0947",
    tsp: "\u091A\u092E\u094D\u092E\u091A",
    sachet: "\u0938\u0948\u0936\u0947",
  };

  const FREQ_EN = {
    1: "once",
    2: "twice",
    3: "three times",
    4: "four times",
    5: "five times",
    6: "six times",
  };

  const FREQ_HI = {
    1: "\u090F\u0915 \u092C\u093E\u0930",
    2: "\u0926\u094B \u092C\u093E\u0930",
    3: "\u0924\u0940\u0928 \u092C\u093E\u0930",
    4: "\u091A\u093E\u0930 \u092C\u093E\u0930",
    5: "\u092A\u093E\u0901\u091A \u092C\u093E\u0930",
    6: "\u091B\u0939 \u092C\u093E\u0930",
  };

  const DROPS_PER_ML = 20;

  // ═══════════════════════════════════════════════════════════════
  // parseIngredients — replaces getConc()
  // ═══════════════════════════════════════════════════════════════

  function parseIngredients(formulation) {
    if (!formulation) return [];
    var ings = formulation.ingredients;
    if (ings && ings.length) {
      return ings.map(function (i) {
        var sn = i.strength_numerator || 0;
        var sd = i.strength_denominator || 1;
        var sdu = (i.strength_denominator_unit || "mL").toLowerCase();
        // Compute concentration as mg per 1 unit of denominator
        var concPerUnit = sd !== 0 ? sn / sd : sn;
        return {
          name: i.name || "Unknown",
          isPrimary: !!i.is_primary,
          concMgPerUnit: concPerUnit,
          strengthNum: sn,
          strengthNumUnit: i.strength_numerator_unit || "mg",
          strengthDen: sd,
          strengthDenUnit: i.strength_denominator_unit || "mL",
          // Phase 2 per-ingredient bands (null = not specified yet)
          doseMinPerKg: null,
          doseMaxPerKg: null,
          maxSingleMg: null,
          maxDailyMg: null,
        };
      });
    }
    // Legacy format fallback
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

  // Build single ingredient from scalar cmg/cml (backward compat)
  function makeIngredient(name, isPrimary, cmg, cmgUnit, cml, cmlUnit) {
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

  function calculateBSA(weightKg, heightCm) {
    if (!weightKg || !heightCm) return null;
    return Math.sqrt((heightCm * weightKg) / 3600);
  }

  // ═══════════════════════════════════════════════════════════════
  // roundToUnit — form-specific rounding
  // ═══════════════════════════════════════════════════════════════

  function roundToUnit(rawValue, form, outputUnit, dropsPerMl) {
    var dpm = dropsPerMl || DROPS_PER_ML;

    if (
      outputUnit === "drops" ||
      form === "drops" ||
      form === "eye drops" ||
      form === "ear drops" ||
      form === "nasal drops"
    ) {
      if (outputUnit === "drops" || !outputUnit || outputUnit === "mL") {
        // rawValue is mL, convert to drops and round
        var drops = Math.round(rawValue * dpm);
        return { value: Math.max(1, drops), unit: "drops", volumeMl: drops / dpm };
      }
    }
    if (outputUnit === "tsp") {
      var tsp = Math.round((rawValue / 5) * 2) / 2;
      return { value: Math.max(0.5, tsp), unit: "tsp", volumeMl: tsp * 5 };
    }
    if (outputUnit === "tablet" || form === "tablet" || form === "dt") {
      var tabs = Math.round(rawValue * 4) / 4;
      return { value: Math.max(0.25, tabs), unit: "tablet", volumeMl: 0 };
    }
    if (outputUnit === "capsule" || form === "capsule") {
      var caps = Math.max(1, Math.round(rawValue));
      return { value: caps, unit: "capsule", volumeMl: 0 };
    }
    if (outputUnit === "puffs" || form === "inhaler") {
      var puffs = Math.max(1, Math.round(rawValue));
      return { value: puffs, unit: "puffs", volumeMl: 0 };
    }
    if (form === "suppository") {
      return { value: Math.round(rawValue), unit: "mg", volumeMl: 0 };
    }
    if (form === "injection") {
      var ml = Math.round(rawValue * 10) / 10;
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
      return { value: Math.max(1, Math.round(rawValue)), unit: "sprays", volumeMl: 0 };
    }
    if (outputUnit === "sachet" || form === "sachet") {
      return { value: Math.max(1, Math.ceil(rawValue)), unit: "sachet", volumeMl: 0 };
    }
    // Default: mL rounded to 0.5
    var v = Math.round(rawValue * 2) / 2;
    return { value: Math.max(0.5, v), unit: "mL", volumeMl: v };
  }

  // ═══════════════════════════════════════════════════════════════
  // isSolidForm — does this form use count (tabs/caps) vs volume?
  // ═══════════════════════════════════════════════════════════════

  function isSolidForm(form) {
    return /tablet|capsule|dt|suppository|sachet|patch/i.test(form || "");
  }

  // ═══════════════════════════════════════════════════════════════
  // computeDose — MAIN CALCULATION
  // ═══════════════════════════════════════════════════════════════

  function computeDose(params) {
    var method = params.method || "weight";
    var weight = params.weight || 0;
    var bsa = params.bsa || (params.heightCm ? calculateBSA(weight, params.heightCm) : null);
    var sv = params.sliderValue || 0;
    var isPerDay = params.isPerDay !== false;
    var freq = params.frequency || 1;
    var ingredients = params.ingredients || [];
    var form = (params.form || "syrup").toLowerCase();
    var outputUnit = params.outputUnit || "mL";
    var dpm = params.dropsPerMl || DROPS_PER_ML;
    var maxSingleMg = params.maxSingleDoseMg;
    var maxDailyMg = params.maxDailyDoseMg;

    if (!ingredients.length) {
      return _emptyResult();
    }

    // Find primary ingredient
    var primary = ingredients.find(function (i) { return i.isPrimary; }) || ingredients[0];
    var capped = false;
    var warnings = [];
    var primaryMgPerDose;

    // ── Step 1: Compute primary ingredient mg per dose ──

    if (method === "fixed" || method === "age") {
      // Slider value IS dispensing units (drops, mL, tablets, etc.)
      if (isSolidForm(form)) {
        // Tablet/capsule: sv is count, mg = count × strengthNum per unit
        primaryMgPerDose = sv * primary.concMgPerUnit * primary.strengthDen;
      } else if (outputUnit === "drops" || form.indexOf("drop") >= 0) {
        // Drops: sv is drop count → mL = drops / dropsPerMl → mg = mL × conc
        primaryMgPerDose = (sv / dpm) * primary.concMgPerUnit;
      } else {
        // mL or other volume: sv is mL → mg = mL × conc
        primaryMgPerDose = sv * primary.concMgPerUnit;
      }
    } else if (method === "bsa") {
      if (!bsa) {
        warnings.push("Height required for BSA dosing — using weight-based fallback");
        primaryMgPerDose = isPerDay
          ? (sv * weight) / freq
          : sv * weight;
      } else {
        primaryMgPerDose = isPerDay
          ? (sv * bsa) / freq
          : sv * bsa;
      }
    } else {
      // weight, gfr, infusion — slider is mg/kg (or mg/kg/day)
      primaryMgPerDose = isPerDay
        ? (sv * weight) / freq
        : sv * weight;
    }

    // ── Step 2: Apply max single dose cap (primary) ──

    if (maxSingleMg && primaryMgPerDose > maxSingleMg) {
      primaryMgPerDose = maxSingleMg;
      capped = true;
      warnings.push("Max single dose " + maxSingleMg + "mg applied");
    }

    // ── Step 3: Compute volume from primary ingredient ──

    var volumeRaw; // in mL for liquids, in count for solids
    if (primary.concMgPerUnit <= 0) {
      volumeRaw = 0;
    } else if (isSolidForm(form)) {
      // Solid: count = mg / (strengthNum per unit × strengthDen)
      volumeRaw = primaryMgPerDose / (primary.concMgPerUnit * primary.strengthDen);
    } else {
      // Liquid: mL = mg / concMgPerUnit
      volumeRaw = primaryMgPerDose / primary.concMgPerUnit;
    }

    // ── Step 4: Round to dispensing unit ──

    var rounded = roundToUnit(volumeRaw, form, outputUnit, dpm);
    var roundedValue = rounded.value;
    var dispUnit = rounded.unit;
    var roundedMl = rounded.volumeMl;

    // ── Step 5: Back-calculate actual primary mg from rounded volume ──

    var actualPrimaryMg;
    if (isSolidForm(form)) {
      actualPrimaryMg = roundedValue * primary.concMgPerUnit * primary.strengthDen;
    } else if (dispUnit === "drops") {
      actualPrimaryMg = (roundedValue / dpm) * primary.concMgPerUnit;
    } else if (dispUnit === "tsp") {
      actualPrimaryMg = roundedValue * 5 * primary.concMgPerUnit;
    } else {
      // mL
      actualPrimaryMg = roundedValue * primary.concMgPerUnit;
    }

    // ── Step 6: Compute all ingredients' doses from same volume ──

    var ingredientDoses = ingredients.map(function (ing) {
      var mgPerDose;
      if (isSolidForm(form)) {
        mgPerDose = roundedValue * ing.concMgPerUnit * ing.strengthDen;
      } else if (dispUnit === "drops") {
        mgPerDose = (roundedValue / dpm) * ing.concMgPerUnit;
      } else if (dispUnit === "tsp") {
        mgPerDose = roundedValue * 5 * ing.concMgPerUnit;
      } else {
        mgPerDose = (roundedMl || roundedValue) * ing.concMgPerUnit;
      }

      var mgPerDay = mgPerDose * freq;
      var mgPerKg = weight > 0 ? mgPerDose / weight : null;
      var maxExceeded = false;
      var maxNote = null;

      // Phase 2: per-ingredient max check
      if (ing.maxSingleMg && mgPerDose > ing.maxSingleMg) {
        maxExceeded = true;
        maxNote = "exceeds max " + ing.maxSingleMg + "mg/dose";
        warnings.push(ing.name + ": " + maxNote);
      }
      if (ing.maxDailyMg && mgPerDay > ing.maxDailyMg) {
        maxExceeded = true;
        maxNote = "exceeds max " + ing.maxDailyMg + "mg/day";
        warnings.push(ing.name + ": " + maxNote);
      }

      // Phase 1: primary max check from drug-level band
      if (ing.isPrimary && !ing.maxSingleMg) {
        if (maxSingleMg && mgPerDose > maxSingleMg) {
          maxExceeded = true;
          maxNote = "capped at " + maxSingleMg + "mg/dose";
        }
        if (maxDailyMg && mgPerDay > maxDailyMg) {
          maxExceeded = true;
          maxNote = (maxNote ? maxNote + "; " : "") + "exceeds max " + maxDailyMg + "mg/day";
          if (warnings.indexOf(ing.name + ": exceeds max " + maxDailyMg + "mg/day") < 0) {
            warnings.push(ing.name + ": exceeds max " + maxDailyMg + "mg/day");
          }
        }
      }

      return {
        name: ing.name,
        isPrimary: ing.isPrimary,
        mgPerDose: Math.round(mgPerDose * 1000) / 1000,
        mgPerDay: Math.round(mgPerDay * 1000) / 1000,
        mgPerKg: mgPerKg !== null ? Math.round(mgPerKg * 1000) / 1000 : null,
        maxExceeded: maxExceeded,
        maxNote: maxNote,
        withinRange:
          ing.doseMinPerKg != null && mgPerKg != null
            ? mgPerKg >= ing.doseMinPerKg && mgPerKg <= (ing.doseMaxPerKg || ing.doseMinPerKg)
            : null,
      };
    });

    // ── Step 7: Build display strings ──

    var display = formatDoseDisplay(roundedValue, dispUnit, form, outputUnit);
    var calcStr = buildCalcString(
      method, sv, isPerDay, weight, bsa, freq,
      primaryMgPerDose, roundedValue, dispUnit,
      ingredientDoses, capped, maxSingleMg
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

  function formatDoseDisplay(value, unit, form, outputUnit) {
    var vol, enD, hiD;

    if (unit === "drops") {
      vol = value + " drops";
      enD = value + " drop" + (value !== 1 ? "s" : "");
      hiD = (HINDI_DROPS[value] || String(value)) + " \u092C\u0942\u0901\u0926\u0947\u0902";
    } else if (unit === "mL") {
      vol = value + "ml";
      enD = value + "ml";
      hiD = (HINDI_ML[value] || String(value)) + " ml";
      // Add tsp parenthetical for whole/half tsp
      var tspVal = value / 5;
      if (tspVal >= 0.5 && Number.isInteger(tspVal * 2)) {
        var tspHi = HINDI_ML[tspVal] || String(tspVal);
        hiD += " (" + tspHi + " \u091A\u092E\u094D\u092E\u091A)";
      }
    } else if (unit === "tablet") {
      vol = value + " tablet";
      enD = value + " tablet" + (value !== 1 ? "s" : "");
      hiD = (HINDI_TABLETS[value] || String(value)) + " \u0917\u094B\u0932\u0940";
    } else if (unit === "capsule") {
      vol = value + " capsule";
      enD = value + " capsule" + (value !== 1 ? "s" : "");
      hiD = (HINDI_TABLETS[value] || String(value)) + " \u0915\u0948\u092A\u094D\u0938\u0942\u0932";
    } else if (unit === "puffs") {
      vol = value + " puff" + (value !== 1 ? "s" : "");
      enD = vol;
      hiD = String(value) + " \u092A\u092B";
    } else if (unit === "tsp") {
      vol = value + " tsp";
      enD = value + " tsp (" + (value * 5) + " mL)";
      hiD = (HINDI_ML[value] || String(value)) + " \u091A\u092E\u094D\u092E\u091A";
    } else if (unit === "application") {
      vol = value + " application";
      enD = vol;
      hiD = String(value) + " \u0932\u0917\u093E\u090F\u0902";
    } else if (unit === "sprays") {
      vol = value + " spray" + (value !== 1 ? "s" : "");
      enD = vol;
      hiD = String(value) + " \u0938\u094D\u092A\u094D\u0930\u0947";
    } else if (unit === "sachet") {
      vol = value + " sachet" + (value !== 1 ? "s" : "");
      enD = vol;
      hiD = String(value) + " \u0938\u0948\u0936\u0947";
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

  function buildCalcString(
    method, sv, isPerDay, weight, bsa, freq,
    primaryMgPerDose, roundedValue, dispUnit,
    ingredientDoses, capped, maxSingleMg
  ) {
    var lines = [];
    var multi = ingredientDoses.length > 1;

    if (method === "fixed" || method === "age") {
      // Fixed: show dispensing units and per-ingredient breakdown
      lines.push(roundedValue + " " + dispUnit);
      ingredientDoses.forEach(function (id) {
        var mgStr = id.mgPerDose.toFixed(2) + "mg";
        var kgStr = id.mgPerKg !== null ? " (" + id.mgPerKg.toFixed(3) + "mg/kg)" : "";
        var flag = id.maxExceeded ? " \u26A0" : "";
        lines.push("  " + id.name + ": " + mgStr + kgStr + flag);
      });
    } else if (method === "bsa" && bsa) {
      var bsaLabel = isPerDay ? "mg/m\u00B2/day" : "mg/m\u00B2/dose";
      var totalDay = isPerDay ? sv * bsa : sv * bsa * freq;
      lines.push(
        sv + bsaLabel + " \u00D7 " + bsa.toFixed(2) + "m\u00B2 = " +
        totalDay.toFixed(1) + "mg/day \u00F7 " + freq + " = " +
        primaryMgPerDose.toFixed(1) + "mg/dose" +
        (capped ? " \u2192 max " + maxSingleMg + "mg" : "") +
        " \u2192 " + roundedValue + dispUnit
      );
      if (multi) {
        ingredientDoses.forEach(function (id) {
          if (!id.isPrimary) {
            lines.push("  " + id.name + ": " + id.mgPerDose.toFixed(2) + "mg/dose");
          }
        });
      }
    } else {
      // Weight-based (default)
      var unitLabel = isPerDay ? "mg/kg/day" : "mg/kg/dose";
      var totalDay2 = isPerDay ? sv * weight : sv * weight * freq;
      var primary = ingredientDoses.find(function (d) { return d.isPrimary; }) || ingredientDoses[0];
      lines.push(
        sv + unitLabel + " \u00D7 " + weight + "kg = " +
        totalDay2.toFixed(1) + "mg/day \u00F7 " + freq + " = " +
        primary.mgPerDose.toFixed(1) + "mg/dose" +
        (capped ? " \u2192 max " + maxSingleMg + "mg" : "") +
        " \u2192 " + roundedValue + dispUnit
      );
      if (multi) {
        ingredientDoses.forEach(function (id) {
          if (!id.isPrimary) {
            var kgStr = id.mgPerKg !== null ? " (" + id.mgPerKg.toFixed(2) + "mg/kg)" : "";
            lines.push("  " + id.name + ": " + id.mgPerDose.toFixed(2) + "mg/dose" + kgStr);
          }
        });
      }
    }

    return lines.join("\n");
  }

  // ═══════════════════════════════════════════════════════════════
  // computeSliderRange — slider min/max/step/zones
  // ═══════════════════════════════════════════════════════════════

  function computeSliderRange(params) {
    var method = params.method || "weight";
    var allBands = params.allBands || [];
    var weight = params.weight || 10;
    var form = (params.form || "syrup").toLowerCase();
    var outputUnit = params.outputUnit || "mL";
    var currentDose = params.currentDose;
    var dpm = params.dropsPerMl || DROPS_PER_ML;

    var bandColors = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4"];
    var zones = [];

    if (method === "fixed" || method === "age") {
      // Slider axis = dispensing units
      var globalMin = Infinity, globalMax = 0;
      allBands.forEach(function (b) {
        if (b.dose_min_qty != null) {
          globalMin = Math.min(globalMin, b.dose_min_qty);
          globalMax = Math.max(globalMax, b.dose_max_qty || b.dose_min_qty);
        }
      });
      if (globalMin === Infinity) { globalMin = 1; globalMax = 20; }

      var sliderMin = Math.max(0, Math.floor(globalMin * 0.5));
      var sliderMax = Math.ceil(globalMax * 1.5);

      // Step based on unit type
      var step = 1;
      if (outputUnit === "mL" || form === "syrup") step = 0.5;
      else if (outputUnit === "tablet" || form === "tablet" || form === "dt") step = 0.25;

      var range = sliderMax - sliderMin || 1;
      allBands.forEach(function (b, i) {
        if (b.dose_min_qty == null) return;
        var bMin = b.dose_min_qty;
        var bMax = b.dose_max_qty || bMin;
        zones.push({
          startPct: ((bMin - sliderMin) / range) * 100,
          endPct: ((bMax - sliderMin) / range) * 100,
          color: bandColors[i % bandColors.length],
          label: b.indication || "",
          midValue: (bMin + bMax) / 2,
        });
      });

      var unit = outputUnit || (form.indexOf("drop") >= 0 ? "drops" : "mL");
      return {
        min: sliderMin,
        max: sliderMax,
        step: step,
        value: currentDose != null ? currentDose : (globalMin + globalMax) / 2,
        unit: unit,
        zones: zones,
      };
    }

    // Weight/BSA/GFR: slider axis = mg/kg or mg/m²
    var gMin = Infinity, gMax = 0;
    allBands.forEach(function (b) {
      if (b.dose_min_qty != null) {
        gMin = Math.min(gMin, b.dose_min_qty);
        gMax = Math.max(gMax, b.dose_max_qty || b.dose_min_qty);
      }
    });
    if (gMin === Infinity) { gMin = 1; gMax = 100; }

    var sMin = Math.max(0, gMin * 0.5);
    var sMax = gMax * 2;
    var sRange = sMax - sMin || 1;

    // Adaptive step
    var sStep;
    if (sRange < 2) sStep = 0.01;
    else if (sRange < 10) sStep = 0.1;
    else if (sRange < 50) sStep = 0.5;
    else sStep = 1;

    allBands.forEach(function (b, i) {
      if (b.dose_min_qty == null) return;
      var bMin2 = b.dose_min_qty;
      var bMax2 = b.dose_max_qty || bMin2;
      zones.push({
        startPct: ((bMin2 - sMin) / sRange) * 100,
        endPct: ((bMax2 - sMin) / sRange) * 100,
        color: bandColors[i % bandColors.length],
        label: b.indication || "",
        midValue: (bMin2 + bMax2) / 2,
      });
    });

    var axisUnit = method === "bsa" ? "mg/m\u00B2" : "mg/kg";

    return {
      min: sMin,
      max: sMax,
      step: sStep,
      value: currentDose != null ? currentDose : (gMin + gMax) / 2,
      unit: axisUnit,
      zones: zones,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // snapToUnit — snap slider value to discrete dispensing unit
  // ═══════════════════════════════════════════════════════════════

  function snapToUnit(rawValue, params) {
    var method = params.method || "weight";
    var weight = params.weight || 10;
    var freq = params.frequency || 1;
    var ingredients = params.ingredients || [];
    var form = (params.form || "syrup").toLowerCase();
    var outputUnit = params.outputUnit || "mL";
    var isPerDay = params.isPerDay !== false;
    var dpm = params.dropsPerMl || DROPS_PER_ML;

    if (method === "fixed" || method === "age") {
      // Slider is already in dispensing units — just snap to step
      if (outputUnit === "drops" || form.indexOf("drop") >= 0) {
        return Math.max(1, Math.round(rawValue));
      }
      if (outputUnit === "tablet" || form === "tablet" || form === "dt") {
        return Math.max(0.25, Math.round(rawValue * 4) / 4);
      }
      if (outputUnit === "capsule" || form === "capsule") {
        return Math.max(1, Math.round(rawValue));
      }
      if (outputUnit === "mL") {
        return Math.max(0.5, Math.round(rawValue * 2) / 2);
      }
      if (outputUnit === "puffs" || form === "inhaler") {
        return Math.max(1, Math.round(rawValue));
      }
      return Math.max(1, Math.round(rawValue));
    }

    // Weight/BSA: slider is mg/kg — snap so output is a clean dispensing unit
    var primary = ingredients.find(function (i) { return i.isPrimary; }) || ingredients[0];
    if (!primary || primary.concMgPerUnit <= 0) return rawValue;

    // Forward: mg/kg → mg/dose → volume
    var mgPerDose = isPerDay ? (rawValue * weight) / freq : rawValue * weight;
    var volumeMl = mgPerDose / primary.concMgPerUnit;

    // Snap the volume
    var snapped;
    if (outputUnit === "drops" || form.indexOf("drop") >= 0) {
      var drops = Math.max(1, Math.round(volumeMl * dpm));
      snapped = (drops / dpm) * primary.concMgPerUnit;
    } else if (outputUnit === "tsp") {
      var tsp = Math.max(0.5, Math.round((volumeMl / 5) * 2) / 2);
      snapped = tsp * 5 * primary.concMgPerUnit;
    } else if (outputUnit === "tablet" || form === "tablet" || form === "dt") {
      var rawTabs = mgPerDose / (primary.concMgPerUnit * primary.strengthDen);
      var tabs = Math.max(0.25, Math.round(rawTabs * 4) / 4);
      snapped = tabs * primary.concMgPerUnit * primary.strengthDen;
    } else if (outputUnit === "capsule" || form === "capsule") {
      var rawCaps = mgPerDose / (primary.concMgPerUnit * primary.strengthDen);
      var capR = Math.max(1, Math.round(rawCaps));
      snapped = capR * primary.concMgPerUnit * primary.strengthDen;
    } else if (outputUnit === "puffs" || form === "inhaler") {
      var rawPuffs = mgPerDose / (primary.concMgPerUnit * primary.strengthDen);
      var pR = Math.max(1, Math.round(rawPuffs));
      snapped = pR * primary.concMgPerUnit * primary.strengthDen;
    } else {
      // mL: snap to 0.5
      var ml = Math.max(0.5, Math.round(volumeMl * 2) / 2);
      snapped = ml * primary.concMgPerUnit;
    }

    // Back-calculate mg/kg
    if (weight <= 0) return rawValue;
    return isPerDay ? (snapped * freq) / weight : snapped / weight;
  }

  // ═══════════════════════════════════════════════════════════════
  // formatConcentration — multi-ingredient concentration string
  // ═══════════════════════════════════════════════════════════════

  function formatConcentration(ingredients) {
    if (!ingredients || !ingredients.length) return "";
    if (ingredients.length === 1) {
      var i = ingredients[0];
      return i.strengthNum + i.strengthNumUnit + "/" + i.strengthDen + i.strengthDenUnit;
    }
    // Multi: "2.5+1mg/mL" or "250+62.5mg/5mL"
    var nums = ingredients.map(function (i) { return i.strengthNum; });
    var unit = ingredients[0].strengthNumUnit;
    var den = ingredients[0].strengthDen;
    var denUnit = ingredients[0].strengthDenUnit;
    return nums.join("+") + unit + "/" + den + denUnit;
  }

  // ═══════════════════════════════════════════════════════════════
  // getAvailableRoutes — extract unique routes from formulations
  // ═══════════════════════════════════════════════════════════════

  function getAvailableRoutes(formulations) {
    var routes = {};
    (formulations || []).forEach(function (f) {
      var r = (f.route || "PO").toUpperCase();
      if (!routes[r]) routes[r] = true;
    });
    return Object.keys(routes);
  }

  // Route display labels
  var ROUTE_LABELS = {
    PO: "Oral",
    PR: "Rectal",
    IV: "IV",
    IM: "IM",
    SC: "SC",
    SL: "Sublingual",
    INH: "Inhaled",
    TOP: "Topical",
    NASAL: "Nasal",
    OPHTHALMIC: "Ophthalmic",
    OTIC: "Otic",
    TRANSDERMAL: "Transdermal",
    NEB: "Nebulised",
  };

  function routeLabel(code) {
    return ROUTE_LABELS[(code || "").toUpperCase()] || code || "Oral";
  }

  // ═══════════════════════════════════════════════════════════════
  // Empty result
  // ═══════════════════════════════════════════════════════════════

  function _emptyResult() {
    return {
      vol: "0", enD: "0", hiD: "0", calc: "", capped: false, fd: "0",
      volumeMl: 0, volumeUnits: 0, ingredientDoses: [], warnings: [],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════

  window.DoseEngine = {
    computeDose: computeDose,
    computeSliderRange: computeSliderRange,
    snapToUnit: snapToUnit,
    parseIngredients: parseIngredients,
    makeIngredient: makeIngredient,
    calculateBSA: calculateBSA,
    formatDoseDisplay: formatDoseDisplay,
    formatConcentration: formatConcentration,
    getAvailableRoutes: getAvailableRoutes,
    routeLabel: routeLabel,
    buildCalcString: buildCalcString,
    roundToUnit: roundToUnit,
    // Expose constants for UI code that needs them
    FREQ_EN: FREQ_EN,
    FREQ_HI: FREQ_HI,
    HINDI_DROPS: HINDI_DROPS,
    HINDI_ML: HINDI_ML,
    HINDI_TABLETS: HINDI_TABLETS,
    HINDI_UNITS: HINDI_UNITS,
    DROPS_PER_ML: DROPS_PER_ML,
  };
})();
