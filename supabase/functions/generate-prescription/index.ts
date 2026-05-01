// Supabase Edge Function: generate-prescription
// Uses Claude tool_use for progressive disclosure — Claude fetches only
// the clinical knowledge it needs via tools.
//
// Tools: get_reference, get_formulary, get_standard_rx
//
// Deploy: supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  computeDose,
  parseIngredients,
  type ComputeDoseParams,
  type ComputeDoseResult,
} from "../_shared/dose-engine.ts";

// ===== HELPERS =====

function maskUhid(uhid?: string | null): string {
  if (!uhid || uhid.length < 9) return uhid ?? '';
  return uhid.slice(0, 4) + '****' + uhid.slice(-4);
}

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";
const STORAGE_BASE = SUPABASE_URL + "/storage/v1/object/public/website/skill";
const MAX_TOOL_LOOPS = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== CACHES =====

const cache: Record<string, string> = {};

async function fetchCached(url: string, key: string): Promise<string> {
  if (cache[key]) return cache[key];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${key}: HTTP ${res.status}`);
  const text = await res.text();
  cache[key] = text;
  return text;
}

// ===== TOOL DEFINITIONS =====

const REFERENCE_NAMES = [
  "dosing_methods",
  "standard_prescriptions",
  "vaccination_iap2024",
  "vaccination_nhm_uip",
  "growth_charts",
  "developmental",
  "iv_fluids",
  "neonatal",
  "emergency_triage",
  "nabh_compliance",
  "antibiotic_stewardship",
];

const tools = [
  {
    name: "get_reference",
    description: `Fetch a clinical reference document. Available references: ${REFERENCE_NAMES.join(", ")}, worked_example. Use this to get detailed clinical knowledge on specific topics before generating the prescription.`,
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Reference name (e.g. 'dosing_methods', 'vaccination_iap2024', 'neonatal', 'worked_example')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_formulary",
    description:
      "Look up drugs in the hospital formulary. Returns ABDM FHIR-compliant formulations with ingredients[] (each having strength_numerator/strength_denominator and concentration), dosing_bands with per-ingredient dose ranges via ingredient_doses[] (each having dose_min/max, unit, max_single/daily, and is_limiting flag for combo drugs), interactions, contraindications, cross_reactions, renal_bands, and administration instructions. ALWAYS call this for every drug you plan to prescribe. For combo drugs, use the LIMITING ingredient's dose range and check all ingredients' max doses.",
    input_schema: {
      type: "object",
      properties: {
        drug_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of generic drug names (e.g. ['AMOXICILLIN', 'PARACETAMOL']). Case-insensitive.",
        },
      },
      required: ["drug_names"],
    },
  },
  {
    name: "get_standard_rx",
    description:
      "Look up hospital-approved standard prescription protocols. ALWAYS use ICD-10 code as the primary lookup — it is exact and unambiguous. Fall back to diagnosis name only if you don't know the ICD-10 code. Returns first_line_drugs with doses, second_line_drugs, recommended investigations, counselling points, referral and hospitalisation criteria. ALWAYS call this when a diagnosis is provided.",
    input_schema: {
      type: "object",
      properties: {
        icd10: {
          type: "string",
          description:
            "ICD-10 code (e.g. 'H66.90', 'J06.9', 'A09'). PREFERRED — use this as the primary lookup key.",
        },
        name: {
          type: "string",
          description:
            "Standard medical diagnosis name (e.g. 'Acute Otitis Media'). Use only as fallback if ICD-10 code is unknown. Use proper medical terminology, not colloquial terms.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_previous_rx",
    description:
      "Fetch the patient's most recent approved prescription(s). Use when doctor says 'continue same treatment', 'repeat last prescription', 'modify previous', 'add X to last prescription', or 'stop Y'. Returns clinical data only (HIPAA compliant — no patient PII). Use the patient_id from the PATIENT ID line in the clinical note.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: {
          type: "string",
          description: "Patient UHID (e.g., 'RKH-25260300001')",
        },
        limit: {
          type: "number",
          description:
            "Number of past prescriptions to fetch (default 1, max 3)",
        },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "get_lab_history",
    description:
      "Fetch the patient's recent lab test results. Use when clinical note mentions previous lab values, when monitoring treatment response (e.g., Hb trend for anaemia), or when prescribing drugs requiring monitoring (aminoglycosides, methotrexate). Returns test name, value, unit, flag (normal/low/high), and date.",
    input_schema: {
      type: "object",
      properties: {
        patient_id: {
          type: "string",
          description: "Patient UHID (e.g., 'RKH-25260300001')",
        },
        test_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional: specific tests to filter (e.g., ['Hemoglobin', 'S. Creatinine']). Omit for all recent results.",
        },
      },
      required: ["patient_id"],
    },
  },
  {
    name: "compute_doses",
    description: "Deterministic dose calculator. CALL THIS for every weight-based, BSA, GFR-adjusted, or fixed-dose medicine BEFORE emitting medicines[]. Pass ALL drugs the doctor wants in ONE call. Returns canonical volume_ml/drops/tablets per drug. Use the returned numbers verbatim in row2_en — do NOT do mental math. The dose engine is web/dose-engine.js (the same code is invoked here). For combo drugs, use the LIMITING ingredient.",
    input_schema: {
      type: "object",
      properties: {
        patient: {
          type: "object",
          properties: {
            weight_kg: { type: "number", description: "Patient weight in kg" },
            height_cm: { type: ["number", "null"], description: "Patient height in cm (optional, needed for BSA dosing)" },
            age_months: { type: ["number", "null"], description: "Chronological age in months" },
            ga_weeks: { type: ["number", "null"], description: "Gestational age in weeks (preterms only)" }
          },
          required: ["weight_kg"]
        },
        meds: {
          type: "array",
          description: "ALL medicines the doctor wants, batched in one call.",
          items: {
            type: "object",
            properties: {
              generic_name: { type: "string", description: "Generic name in CAPS, must match formulary" },
              method: { type: "string", enum: ["weight", "bsa", "fixed", "gfr", "infusion", "age"] },
              dose_value: { type: "number", description: "mg/kg if method=weight; mg/m² if bsa; total mg if fixed; etc." },
              is_per_day: { type: "boolean", description: "true if dose_value is per day (will be divided by frequency)" },
              frequency: { type: "number", description: "Doses per day (1=OD, 2=BD, 3=TDS, 4=QID)" },
              formulation: { type: "object", description: "Formulation object from get_formulary's response — must include ingredients[] with strength_numerator/strength_denominator", properties: {} },
              output_unit: { type: "string", description: "Preferred display unit: drops, mL, tablet, capsule, sachet, etc." },
              dosing_band: { type: "object", description: "Optional ingredient_doses entry from formulary's dosing_bands for max-dose checks", properties: {} }
            },
            required: ["generic_name", "method", "dose_value", "frequency", "formulation"]
          }
        }
      },
      required: ["patient", "meds"]
    }
  }
];

// ===== TOOL EXECUTION =====

async function executeGetReference(name: string): Promise<string> {
  const pathMap: Record<string, string> = {};
  for (const n of REFERENCE_NAMES) {
    pathMap[n] = `${STORAGE_BASE}/references/${n}.md`;
  }
  pathMap["worked_example"] = `${STORAGE_BASE}/examples/worked_example.md`;

  const url = pathMap[name];
  if (!url) {
    return `Unknown reference "${name}". Available: ${Object.keys(pathMap).join(", ")}`;
  }
  try {
    return await fetchCached(url, "ref:" + name);
  } catch (e) {
    return `Error loading reference "${name}": ${e.message}`;
  }
}

// Condense drug data for AI — strips indian_brands (77% of tokens), SNOMED metadata,
// and null fields. Keeps: identity, category, therapeutic_use, condensed formulations,
// dosing bands with ingredient_doses (source kept, snomed stripped), all safety data.
function condenseDrugForAI(drug: any): any {
  const result: any = {
    generic_name: drug.generic_name,
    drug_class: drug.drug_class,
    category: drug.category,
    therapeutic_use: drug.therapeutic_use,
    licensed_in_children: drug.licensed_in_children,
    formulations: (drug.formulations || []).map((f: any) => ({
      form: f.form,
      route: f.route,
      indian_conc_note: f.indian_conc_note,
      ingredients: (f.ingredients || []).map((i: any) => ({
        name: i.name,
        is_primary: i.is_primary,
        strength_numerator: i.strength_numerator,
        strength_numerator_unit: i.strength_numerator_unit,
        strength_denominator: i.strength_denominator,
        strength_denominator_unit: i.strength_denominator_unit,
      })),
    })),
    // Dosing bands: pass through but strip ingredient snomed_codes (keep source)
    dosing_bands: (drug.dosing_bands || []).map((b: any) => {
      const band = { ...b };
      if (band.ingredient_doses) {
        band.ingredient_doses = band.ingredient_doses.map((id: any) => {
          const { snomed_code, ...rest } = id;
          return rest;
        });
      }
      // Strip null fields from band
      Object.keys(band).forEach((k) => {
        if (band[k] === null || band[k] === undefined) delete band[k];
      });
      return band;
    }),
  };

  // Conditionally include non-null fields
  if (drug.unlicensed_note) result.unlicensed_note = drug.unlicensed_note;
  if (drug.snomed_code) result.snomed_code = drug.snomed_code;
  if ((drug.interactions || []).length) result.interactions = drug.interactions;
  if ((drug.contraindications || []).length)
    result.contraindications = drug.contraindications;
  if ((drug.cross_reactions || []).length)
    result.cross_reactions = drug.cross_reactions;
  if ((drug.black_box_warnings || []).length)
    result.black_box_warnings = drug.black_box_warnings;
  if ((drug.pediatric_specific_warnings || []).length)
    result.pediatric_specific_warnings = drug.pediatric_specific_warnings;
  if ((drug.monitoring_parameters || []).length)
    result.monitoring_parameters = drug.monitoring_parameters;
  if (drug.renal_adjustment_required) {
    result.renal_adjustment_required = true;
    result.renal_bands = drug.renal_bands;
  }
  if (drug.hepatic_adjustment_required) {
    result.hepatic_adjustment_required = true;
    if (drug.hepatic_note) result.hepatic_note = drug.hepatic_note;
  }
  if ((drug.administration || []).length)
    result.administration = drug.administration;
  if (drug.food_instructions) result.food_instructions = drug.food_instructions;
  if (drug.notes) result.notes = drug.notes;

  return result;
}

async function executeGetFormulary(drugNames: string[]): Promise<string> {
  const selectCols =
    "generic_name,drug_class,licensed_in_children,unlicensed_note,formulations,dosing_bands,interactions,contraindications,cross_reactions,black_box_warnings,pediatric_specific_warnings,monitoring_parameters,renal_adjustment_required,renal_bands,hepatic_adjustment_required,hepatic_note,administration,food_instructions,notes,snomed_code,snomed_display,brand_names";
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  try {
    // Strategy 1: Search by generic_name (primary — most drugs match this way)
    const orFilter = drugNames
      .map((d) => `generic_name.ilike.%25${encodeURIComponent(d.trim())}%25`)
      .join(",");
    const url1 = `${SUPABASE_URL}/rest/v1/formulary?or=(${orFilter})&select=${selectCols}&active=eq.true`;
    const res1 = await fetch(url1, { headers });
    if (!res1.ok) return `Formulary query error: HTTP ${res1.status}`;
    let drugs = await res1.json();

    // Strategy 2: For any names NOT found, search brand_names array
    // This catches brand lookups like "Wikoryl", "Augmentin", "Crocin"
    const foundNames = new Set(
      drugs.map((d: any) => d.generic_name.toUpperCase()),
    );
    const notFound = drugNames.filter((n) => {
      const nl = n.trim().toUpperCase();
      return !drugs.some((d: any) => d.generic_name.toUpperCase().includes(nl));
    });

    if (notFound.length) {
      // Search brand_names text[] array using ilike on each element
      // Supabase PostgREST: brand_names filter via full-text or manual iteration
      // Simplest: fetch all active drugs and filter client-side (679 drugs is small)
      const url2 = `${SUPABASE_URL}/rest/v1/formulary?select=${selectCols}&active=eq.true`;
      const res2 = await fetch(url2, { headers });
      if (res2.ok) {
        const allDrugs = await res2.json();
        for (const searchName of notFound) {
          const sl = searchName.trim().toLowerCase();
          const match = allDrugs.find((d: any) => {
            // Search brand_names[] array
            if (
              (d.brand_names || []).some((b: string) =>
                b.toLowerCase().includes(sl),
              )
            )
              return true;
            // Search indian_brands inside formulations
            if (
              (d.formulations || []).some((f: any) =>
                (f.indian_brands || []).some(
                  (ib: any) =>
                    (ib.name || "").toLowerCase().includes(sl) ||
                    (ib.trade_name || "").toLowerCase().includes(sl),
                ),
              )
            )
              return true;
            return false;
          });
          if (match && !foundNames.has(match.generic_name.toUpperCase())) {
            drugs.push(match);
            foundNames.add(match.generic_name.toUpperCase());
          }
        }
      }
    }

    if (!drugs.length)
      return JSON.stringify({
        status: "not_found",
        drug_query: drugNames.join(", "),
        tried: ["generic_name_ilike", "brand_names_ilike", "indian_brands_ilike"],
        instruction_to_model: "DO NOT dose from memory. For each name not found, append an entry to omitted_medicines[] in your output: {name: <name>, reason: 'not_in_formulary'}. Set safety.severity_server = 'high'. The doctor will fill the dose manually."
      });
    // Condense for AI — strips indian_brands and SNOMED metadata (~83% token savings)
    const condensed = drugs.map(condenseDrugForAI);
    return JSON.stringify(condensed, null, 2);
  } catch (e) {
    return `Formulary query error: ${e.message}`;
  }
}

async function executeGetStandardRx(
  icd10?: string,
  name?: string,
): Promise<string> {
  const select =
    "icd10,diagnosis_name,snomed_code,first_line_drugs,second_line_drugs,investigations,counselling,warning_signs,referral_criteria,hospitalisation_criteria,expected_course,key_clinical_points,severity_assessment,monitoring_parameters,guideline_changes,notes,duration_days_default";
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

  try {
    // Strategy 1: Exact ICD-10 match (preferred — unambiguous)
    if (icd10) {
      const enc = encodeURIComponent(icd10.trim());
      const url = `${SUPABASE_URL}/rest/v1/standard_prescriptions?icd10=eq.${enc}&active=eq.true&select=${select}&limit=5`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const protocols = await res.json();
        if (protocols.length) return JSON.stringify(protocols, null, 2);
      }
      // Try partial ICD-10 match (e.g. "H66" matches "H66.90")
      const url2 = `${SUPABASE_URL}/rest/v1/standard_prescriptions?icd10=ilike.${enc}%25&active=eq.true&select=${select}&limit=5`;
      const res2 = await fetch(url2, { headers });
      if (res2.ok) {
        const protocols2 = await res2.json();
        if (protocols2.length) return JSON.stringify(protocols2, null, 2);
      }
    }

    // Strategy 2: Diagnosis name match (fallback)
    if (name) {
      const enc = encodeURIComponent(name.trim());
      const url = `${SUPABASE_URL}/rest/v1/standard_prescriptions?diagnosis_name=ilike.%25${enc}%25&active=eq.true&select=${select}&limit=5`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const protocols = await res.json();
        if (protocols.length) return JSON.stringify(protocols, null, 2);
      }
    }

    // Strategy 3 (Sprint 2): pg_trgm-style token-OR fuzzy match for diagnosis text.
    // PostgREST doesn't expose pg_trgm's % operator without an RPC, so we tokenize
    // the diagnosis name and OR-match each meaningful token via ILIKE; the trigram
    // index on diagnosis_name still accelerates the substring planner.
    if (name) {
      const tokens = name.trim().split(/\s+/).filter((t) => t.length >= 3);
      if (tokens.length > 0) {
        const orFilter = tokens
          .map((t) => `diagnosis_name.ilike.%25${encodeURIComponent(t)}%25`)
          .join(",");
        const url4 = `${SUPABASE_URL}/rest/v1/standard_prescriptions?or=(${orFilter})&active=eq.true&select=${select}&limit=5`;
        const res4 = await fetch(url4, { headers });
        if (res4.ok) {
          const protocols4 = await res4.json();
          if (protocols4.length) return JSON.stringify(protocols4, null, 2);
        }
      }
    }

    const searched = [
      icd10 ? `ICD-10: ${icd10}` : "",
      name ? `Name: ${name}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return `No hospital protocol found for ${searched}. Use standard clinical guidelines.`;
  } catch (e) {
    return `Standard Rx query error: ${e.message}`;
  }
}

async function fetchIcd10Menu(): Promise<string> {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
  const url = `${SUPABASE_URL}/rest/v1/standard_prescriptions?select=icd10,diagnosis_name&active=eq.true&order=icd10`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return '';
    const rows = await res.json();
    if (!rows.length) return '';
    return '\n\n## Available Standard Rx Diagnoses (ICD-10 menu)\n\nWhen calling get_standard_rx, pick the icd10 from this list:\n\n' +
      rows.map((r: any) => `- ${r.icd10} — ${r.diagnosis_name}`).join('\n');
  } catch { return ''; }
}

async function executeGetPreviousRx(
  patientId: string,
  limit = 1,
): Promise<string> {
  try {
    const n = Math.min(Math.max(limit || 1, 1), 3);
    const url = `${SUPABASE_URL}/rest/v1/prescriptions?patient_id=eq.${encodeURIComponent(patientId)}&is_approved=eq.true&order=created_at.desc&limit=${n}&select=id,created_at,generated_json`;
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) return `Previous Rx query error: HTTP ${res.status}`;
    const rxList = await res.json();
    if (!rxList.length)
      return `No previous approved prescriptions found for patient ${patientId}.`;
    // HIPAA compliant: strip PII, keep only clinical data
    const cleaned = rxList.map((rx: any) => {
      const g = rx.generated_json || {};
      return {
        rx_id: rx.id,
        date: rx.created_at,
        diagnosis: g.diagnosis,
        medicines: (g.medicines || []).map((m: any) => ({
          row1_en: m.row1_en,
          row2_en: m.row2_en,
          row3_hi: m.row3_hi,
          formulation: m.formulation,
          dose_mg_per_kg: m.dose_mg_per_kg,
          dose_per_day_divided: m.dose_per_day_divided,
          calc: m.calc,
          pictogram: m.pictogram,
        })),
        investigations: g.investigations,
        vitals: g.vitals,
        safety: {
          allergy_note: g.safety?.allergy_note,
          interactions: g.safety?.interactions,
          overall_status: g.safety?.overall_status,
        },
        followup_days: g.followup_days,
        admission_recommended: g.admission_recommended || null,
        warning_signs: g.warning_signs || [],
        doctor_notes: g.doctor_notes,
        vaccinations: g.vaccinations,
        growth: g.growth,
        counselling: g.counselling,
        diet: g.diet,
        referral: g.referral,
        chief_complaints: g.chief_complaints,
        clinical_history: g.clinical_history,
        examination: g.examination,
      };
    });
    return JSON.stringify(cleaned, null, 2);
  } catch (e) {
    return `Previous Rx query error: ${e.message}`;
  }
}

async function executeComputeDoses(input: any): Promise<string> {
  try {
    const patient = input.patient || {};
    const meds = Array.isArray(input.meds) ? input.meds : [];
    if (!patient.weight_kg || patient.weight_kg <= 0) {
      return JSON.stringify({
        error: "patient.weight_kg required and must be > 0",
        instruction_to_model: "Cannot compute doses without weight. If weight is missing, surface to omitted_medicines[] with reason='age_contraindication' or ask the doctor."
      });
    }
    const results = meds.map((m: any) => {
      try {
        const ingredients = parseIngredients(m.formulation || {});
        const params: ComputeDoseParams = {
          method: m.method || "weight",
          weight: patient.weight_kg,
          heightCm: patient.height_cm || undefined,
          sliderValue: m.dose_value,
          isPerDay: m.is_per_day !== false,
          frequency: m.frequency || 1,
          ingredients,
          form: (m.formulation && m.formulation.form) || "syrup",
          outputUnit: m.output_unit || "mL",
          ingredientBands: m.dosing_band ? [m.dosing_band] : []
        };
        const r = computeDose(params);
        return {
          generic_name: m.generic_name,
          ok: true,
          volume_display: r.vol,
          english_dose: r.enD,
          hindi_dose: r.hiD,
          calc_string: r.calc,
          volume_ml: r.volumeMl,
          volume_units: r.volumeUnits,
          actual_primary_mg: r.fd,
          capped: r.capped,
          warnings: r.warnings,
          ingredient_doses: r.ingredientDoses
        };
      } catch (e: any) {
        return {
          generic_name: m.generic_name,
          ok: false,
          error: e.message,
          instruction_to_model: `Engine could not compute ${m.generic_name}. Add to omitted_medicines[] with reason='not_in_formulary' OR 'doctor_specified_dose_unsafe_engine_capped'.`
        };
      }
    });
    return JSON.stringify({
      tool: "compute_doses",
      results,
      instruction_to_model: "Use volume_display, english_dose, hindi_dose, calc_string verbatim in your medicines[] entries. Do NOT compute dose values yourself. If any result has ok:false, route that drug to omitted_medicines[]."
    });
  } catch (e: any) {
    return JSON.stringify({ error: "compute_doses failed: " + e.message });
  }
}

async function executeTool(
  name: string,
  input: Record<string, any>,
): Promise<string> {
  const logInput = input.patient_id
    ? { ...input, patient_id: maskUhid(input.patient_id) }
    : input;
  console.log(`  Tool: ${name}(${JSON.stringify(logInput)})`);
  switch (name) {
    case "get_reference":
      return await executeGetReference(input.name);
    case "get_formulary":
      return await executeGetFormulary(input.drug_names);
    case "get_standard_rx":
      return await executeGetStandardRx(input.icd10, input.name);
    case "get_previous_rx":
      return await executeGetPreviousRx(input.patient_id, input.limit);
    case "get_lab_history":
      return await executeGetLabHistory(input.patient_id, input.test_names);
    case "compute_doses":
      return await executeComputeDoses(input);
    default:
      return `Unknown tool: ${name}`;
  }
}

async function executeGetLabHistory(
  patientId: string,
  testNames?: string[],
): Promise<string> {
  try {
    let url = `${SUPABASE_URL}/rest/v1/lab_results?patient_id=eq.${encodeURIComponent(patientId)}&order=test_date.desc&limit=20&select=test_name,value,value_numeric,unit,reference_range,flag,test_date,notes,loinc_code`;
    if (testNames && testNames.length) {
      const filter = testNames
        .map((t) => `test_name.ilike.%25${encodeURIComponent(t)}%25`)
        .join(",");
      url += `&or=(${filter})`;
    }
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) return `Lab history query error: HTTP ${res.status}`;
    const labs = await res.json();
    if (!labs.length) return `No lab results found for patient ${patientId}.`;
    return JSON.stringify(labs, null, 2);
  } catch (e) {
    return `Lab history query error: ${e.message}`;
  }
}

// ===== TOOL-USE LOOP =====

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
}

interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

async function toolUseLoop(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  timeoutMs: number = 50_000,
): Promise<{
  text: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  rounds: number;
  durationMs: number;
  toolsCalled: string[];
}> {
  const startMs = Date.now();
  const messages: Message[] = [{ role: "user", content: userMessage }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const toolsCalledList: string[] = [];

  // Timeout: abort entire loop after `timeoutMs` (default 50s, leaving budget
  // for completeness retry within Supabase Edge Function 150s wall).
  // Sprint 2 fix: was 120s, which caused 150s wall-clock timeouts on large
  // notes when paired with a single retry. See task #9.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Track last tool call to detect repeated identical calls
  let lastToolCallKey = "";

  try {
    for (let round = 1; round <= MAX_TOOL_LOOPS; round++) {
      console.log(`Round ${round}: calling Claude API...`);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          temperature: 0,
          system: systemPrompt,
          messages,
          tools,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          err.error?.message || `Claude API error: ${response.status}`,
        );
      }

      const data = await response.json();
      totalInputTokens += data.usage?.input_tokens || 0;
      totalOutputTokens += data.usage?.output_tokens || 0;

      // Add assistant response to message history
      messages.push({ role: "assistant", content: data.content });

      if (data.stop_reason === "end_turn") {
        // Extract text from final response
        const text = data.content
          .filter((b: ContentBlock) => b.type === "text")
          .map((b: ContentBlock) => b.text || "")
          .join("");
        console.log(
          `Completed in ${round} round(s). Tokens: ${totalInputTokens} in, ${totalOutputTokens} out.`,
        );
        return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs, toolsCalled: toolsCalledList };
      }

      if (data.stop_reason === "tool_use") {
        const toolBlocks = data.content.filter(
          (b: ContentBlock) => b.type === "tool_use",
        );
        for (const b of toolBlocks) {
          if (b.name) toolsCalledList.push(b.name);
        }
        if (!toolBlocks.length) {
          // No tool calls despite tool_use stop reason — treat as end
          const text = data.content
            .filter((b: ContentBlock) => b.type === "text")
            .map((b: ContentBlock) => b.text || "")
            .join("");
          return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs, toolsCalled: toolsCalledList };
        }

        console.log(`  ${toolBlocks.length} tool call(s) in round ${round}`);

        // Detect repeated identical tool calls to avoid infinite loops
        const currentToolCallKey = toolBlocks
          .map((b: ContentBlock) => `${b.name}:${JSON.stringify(b.input)}`)
          .sort()
          .join("|");
        if (currentToolCallKey === lastToolCallKey) {
          console.warn(
            "Skipping repeated identical tool call(s), ending loop.",
          );
          const text = data.content
            .filter((b: ContentBlock) => b.type === "text")
            .map((b: ContentBlock) => b.text || "")
            .join("");
          return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs, toolsCalled: toolsCalledList };
        }
        lastToolCallKey = currentToolCallKey;

        // Execute all tools IN PARALLEL for speed
        const toolResults = await Promise.all(
          toolBlocks.map(async (block: ContentBlock) => ({
            type: "tool_result",
            tool_use_id: block.id,
            content: await executeTool(block.name!, block.input!),
          })),
        );

        // Add tool results as user message
        messages.push({ role: "user", content: toolResults });
      } else {
        // Unexpected stop reason (max_tokens, etc.)
        console.warn(`Unexpected stop_reason: ${data.stop_reason}`);
        const text = data.content
          .filter((b: ContentBlock) => b.type === "text")
          .map((b: ContentBlock) => b.text || "")
          .join("");
        return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs, toolsCalled: toolsCalledList };
      }
    }

    throw new Error(`Tool-use loop exceeded ${MAX_TOOL_LOOPS} rounds`);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ===== FALLBACK: Single-shot with full skill.md =====

async function singleShotFallback(
  apiKey: string,
  userMessage: string,
): Promise<string> {
  console.log("Falling back to single-shot with full skill.md...");
  const skillUrl =
    SUPABASE_URL + "/storage/v1/object/public/website/skill/core_prompt.md";
  const skill = await fetchCached(skillUrl, "full-skill");
  const systemPrompt =
    "SINGLE-SHOT MODE: Generate the COMPLETE prescription JSON immediately. Output ONLY raw JSON.\n\n" +
    skill;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      err.error?.message || `Fallback API error: ${response.status}`,
    );
  }

  const data = await response.json();
  return data.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}

// ===== JSON EXTRACTION =====

function extractJSON(raw: string): any {
  let cleaned = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") {
      parsed.requested_medicines = Array.isArray(parsed.requested_medicines)
        ? parsed.requested_medicines
        : [];
      parsed.omitted_medicines = Array.isArray(parsed.omitted_medicines)
        ? parsed.omitted_medicines
        : [];
    }
    return parsed;
  } catch (e) {
    console.error("extractJSON parse failed. Raw text:", raw.substring(0, 500));
    return {
      error: "Failed to parse prescription JSON",
      parse_error: e.message,
      raw_preview: raw.substring(0, 200),
      requested_medicines: [],
      omitted_medicines: [],
    };
  }
}

// ===== COMPLETENESS MATCHERS (Sprint 2 GAP-1/2) =====

// Brand-aware match: handles row1_en formats like
// "IBUPROFEN+PARACETAMOL SUSPENSION (Combiflam)" when doctor wrote "Combiflam".
function _normalizeForMatch(s: string): string {
  return (s || '')
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9+\s\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _matchesEmittedOrOmitted(
  req: string,
  emittedRows: string[],
  omittedNames: Set<string>,
): boolean {
  const reqN = _normalizeForMatch(req);
  if (!reqN) return false;
  if (omittedNames.has(reqN)) return true;
  for (const row of emittedRows) {
    const rowN = _normalizeForMatch(row);
    if (!rowN) continue;
    // 1. exact substring either direction (legacy behaviour, still useful)
    if (rowN.includes(reqN) || reqN.includes(rowN.split(' ')[0])) return true;
    // 2. row1_en often has "(Brand)" — check brand tokens inside parens
    const parenMatches = row.match(/\(([^)]+)\)/g) || [];
    for (const m of parenMatches) {
      const brand = _normalizeForMatch(m.replace(/[()]/g, ''));
      if (!brand) continue;
      if (brand === reqN || brand.includes(reqN) || reqN.includes(brand)) return true;
    }
  }
  return false;
}

// Build the omitted-name set normalised the same way matcher uses.
function _buildOmittedNameSet(omittedMeds: any[]): Set<string> {
  const set = new Set<string>();
  for (const o of omittedMeds || []) {
    const n = _normalizeForMatch(o?.name ?? '');
    if (n) set.add(n);
  }
  return set;
}

// Run the completeness check. Returns the list of doctor-requested drugs that
// are neither in medicines[] nor explicitly listed in omitted_medicines[].
// GAP-2: cardinality-aware — if every reqMed individually matches, treat as
// PASS even when emittedMeds.length < reqMeds.length (combo collapse).
function _findStillMissing(prescription: any): string[] {
  const reqMeds: string[] = prescription?.requested_medicines ?? [];
  const emittedRows: string[] = (prescription?.medicines ?? []).map(
    (m: any) => (m?.row1_en ?? '').toString(),
  );
  const omittedNames = _buildOmittedNameSet(prescription?.omitted_medicines ?? []);
  const missing: string[] = [];
  for (const req of reqMeds) {
    if (!_matchesEmittedOrOmitted(req, emittedRows, omittedNames)) {
      missing.push(req);
    }
  }
  return missing;
}

// ===== MAIN HANDLER =====

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured.");
    }

    const {
      clinical_note,
      formulary_context,
      std_rx_context,
      patient_allergies,
      patient_id,
    } = await req.json();

    if (!clinical_note) {
      return new Response(
        JSON.stringify({ error: "clinical_note is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Load core prompt from Storage (cached) + embed NABH compliance (saves a tool call every time)
    const [corePromptRaw, nabhRef] = await Promise.all([
      fetchCached(STORAGE_BASE + "/core_prompt.md", "core-prompt"),
      fetchCached(
        STORAGE_BASE + "/references/nabh_compliance.md",
        "ref:nabh_compliance",
      ),
    ]);
    let corePrompt = corePromptRaw + "\n\n" + nabhRef;
    corePrompt = corePrompt + await fetchIcd10Menu();

    // Build user message — send clinical note + allergies + patient ID only.
    // Formulary and standard Rx data are fetched by Claude via tools as needed.
    let userMessage = clinical_note;
    if (patient_allergies && patient_allergies.length) {
      userMessage +=
        "\n\nKNOWN PATIENT ALLERGIES: " + patient_allergies.join(", ");
    }
    if (patient_id) {
      userMessage +=
        "\n\nPATIENT ID: " +
        patient_id +
        " (use with get_previous_rx tool if doctor requests continuation or modification of previous treatment)";
    }

    let rawText: string;
    let meta: any = {};

    // GAP-7: Shared deadline budget — guarantees the whole request stays under
    // 130s with ~20s headroom against the 150s Edge Function wall. Each
    // toolUseLoop call computes its remaining budget from this deadline rather
    // than holding an independent timer.
    const requestStart = Date.now();
    const HARD_DEADLINE_MS = requestStart + 130_000;
    const RESPONSE_HEADROOM_MS = 5_000;

    function remainingBudgetMs(): number {
      return HARD_DEADLINE_MS - Date.now() - RESPONSE_HEADROOM_MS;
    }

    let firstAttemptDurationMs = 0;
    try {
      // Primary path: tool-use loop. Cap first attempt at 50s (gives the model
      // time but leaves room for the completeness retry within the 130s
      // shared deadline).
      const firstBudget = Math.min(50_000, remainingBudgetMs());
      const result = await toolUseLoop(
        ANTHROPIC_API_KEY,
        corePrompt,
        userMessage,
        firstBudget,
      );
      rawText = result.text;
      firstAttemptDurationMs = result.durationMs;
      meta = {
        mode: "tool-use",
        rounds: result.rounds,
        input_tokens: result.totalInputTokens,
        output_tokens: result.totalOutputTokens,
        first_attempt_duration_ms: result.durationMs,
        first_attempt_budget_ms: firstBudget,
        tools_called: result.toolsCalled,
      };
    } catch (loopError: any) {
      // Fallback: single-shot with full skill
      console.warn("Tool-use loop failed:", loopError.message);
      rawText = await singleShotFallback(ANTHROPIC_API_KEY, userMessage);
      meta = { mode: "fallback-single-shot", error: loopError.message };
    }

    let prescription = extractJSON(rawText);

    // GAP-6: extractJSON parse failure must NOT silently fall through to the
    // completeness check (which would see empty arrays and produce a blank
    // prescription). Surface the parse error to the frontend immediately.
    if (prescription && prescription.error) {
      meta.parse_failed = true;
      meta.parse_error = prescription.parse_error;
      meta.raw_preview = prescription.raw_preview;
      return new Response(
        JSON.stringify({
          prescription,
          meta,
          error: 'AI output could not be parsed as JSON. See meta.raw_preview.',
        }),
        {
          // 200 keeps the frontend's existing error path (which inspects body)
          // rather than triggering a generic network error.
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Server-side completeness check (GAP-1: brand-aware matcher).
    let stillMissing = _findStillMissing(prescription);

    // GAP-12: fallback path skips retry — fallback can't recover from the same
    // single-shot. Synthesize omitted entries + force severity to 'high' so
    // the doctor cannot miss the gap, then run severity merge below.
    if (meta.mode === 'fallback-single-shot') {
      if (stillMissing.length > 0) {
        meta.fallback_completeness_warning = true;
        meta.first_attempt_missing = stillMissing;
        const existingOmittedNames = _buildOmittedNameSet(
          prescription.omitted_medicines ?? [],
        );
        const synthetic = stillMissing
          .filter((m) => !existingOmittedNames.has(_normalizeForMatch(m)))
          .map((m) => ({ name: m, reason: 'fallback_mode_omission' }));
        prescription.omitted_medicines = [
          ...(prescription.omitted_medicines ?? []),
          ...synthetic,
        ];
        if (!prescription.safety) prescription.safety = {};
        prescription.safety.severity_server = 'high';
      }
    } else {
      // GAP-7: retry gating uses the shared deadline. Need at least 25s of
      // remaining budget to attempt a second round; otherwise accept and
      // surface the gap.
      const RETRY_MIN_REMAINING_MS = 25_000;
      const remainingMs = remainingBudgetMs();
      const canRetry =
        stillMissing.length > 0 &&
        firstAttemptDurationMs > 0 &&
        remainingMs >= RETRY_MIN_REMAINING_MS;

      if (stillMissing.length > 0) {
        meta.first_attempt_missing = stillMissing;
      }

      if (canRetry) {
        console.log(
          `Completeness mismatch: missing ${stillMissing.join(', ')}. Retrying once with ${remainingMs}ms budget.`,
        );
        meta.completeness_retry = true;
        meta.completeness_retry_budget_ms = remainingMs;
        const retryUserMessage =
          userMessage +
          `\n\nIMPORTANT: Your previous output omitted these drugs the doctor explicitly requested: ${stillMissing.join(', ')}. Either include each one in medicines[] with full dose calculation, OR add an entry to omitted_medicines[] with a clear reason.`;
        try {
          const retry = await toolUseLoop(
            ANTHROPIC_API_KEY,
            corePrompt,
            retryUserMessage,
            remainingMs,
          );
          rawText = retry.text;
          meta.rounds = (meta.rounds || 0) + retry.rounds;
          meta.input_tokens = (meta.input_tokens || 0) + retry.totalInputTokens;
          meta.output_tokens = (meta.output_tokens || 0) + retry.totalOutputTokens;
          meta.retry_duration_ms = retry.durationMs;
          meta.tools_called = [...(meta.tools_called || []), ...retry.toolsCalled];
          const retryPrescription = extractJSON(rawText);
          // GAP-6: if retry parse failed, keep the first-attempt prescription
          // and surface the retry error in meta — do NOT overwrite with error obj.
          if (retryPrescription && retryPrescription.error) {
            meta.retry_parse_failed = true;
            meta.retry_parse_error = retryPrescription.parse_error;
          } else {
            const reqMedsSnapshot: string[] = prescription.requested_medicines ?? [];
            if (
              (!retryPrescription.requested_medicines ||
                retryPrescription.requested_medicines.length === 0) &&
              reqMedsSnapshot.length > 0
            ) {
              retryPrescription.requested_medicines = reqMedsSnapshot;
            }
            Object.assign(prescription, retryPrescription);
          }
          // Re-evaluate stillMissing after retry merge.
          stillMissing = _findStillMissing(prescription);
        } catch (retryErr: any) {
          console.warn("Completeness retry failed:", retryErr.message);
          meta.completeness_retry_error = retryErr.message;
        }
      }

      if (stillMissing.length > 0) {
        // Skipped or post-retry residual. Surface so the doctor sees gaps.
        meta.completeness_retry_skipped = !canRetry;
        if (!canRetry) {
          meta.completeness_retry_skipped_reason =
            remainingMs < RETRY_MIN_REMAINING_MS
              ? `insufficient_budget_${remainingMs}ms_remaining`
              : 'unknown';
        }
        const existingOmittedNames = _buildOmittedNameSet(
          prescription.omitted_medicines ?? [],
        );
        const reason = canRetry
          ? 'server_completeness_check_post_retry_residual'
          : 'server_completeness_check_skipped_retry';
        const synthetic = stillMissing
          .filter((m) => !existingOmittedNames.has(_normalizeForMatch(m)))
          .map((m) => ({ name: m, reason }));
        prescription.omitted_medicines = [
          ...(prescription.omitted_medicines ?? []),
          ...synthetic,
        ];
        if (!prescription.safety) prescription.safety = {};
        prescription.safety.severity_server = 'high';
      }
    }

    // Sprint 2: enforce compute_doses tool was called when medicines[] is non-empty.
    // Prefer the tracked tool list from toolUseLoop; fall back to a calc-string
    // heuristic when fallback-single-shot left tools_called empty.
    {
      const meds = (prescription.medicines ?? []) as any[];
      const toolsCalled: string[] = (meta as any).tools_called || [];
      const computeDosesCalled = toolsCalled.includes("compute_doses");
      const weightMeds = meds.filter(
        (m: any) => m && m.method && ["weight", "bsa", "gfr", "infusion"].includes(m.method),
      );
      let sketchy = false;
      if (weightMeds.length > 0 && !computeDosesCalled) {
        const sketchyMeds = weightMeds.filter((m: any) => {
          const calc = (m.calc || "").toString();
          return (
            calc.length === 0 ||
            (!calc.includes("→") && !calc.includes("mg/dose") && !calc.includes("ml") && !calc.includes("mL"))
          );
        });
        if (sketchyMeds.length > 0) {
          sketchy = true;
          if (!prescription.safety) prescription.safety = {};
          const aiSev = prescription.safety.severity_server ?? prescription.safety.severity_ai ?? 'low';
          const escalate: Record<string, string> = { low: 'moderate', moderate: 'moderate', high: 'high' };
          prescription.safety.severity_server = escalate[aiSev] ?? 'moderate';
          prescription.safety.flags = [
            ...(prescription.safety.flags ?? []),
            `compute_doses_likely_skipped — ${sketchyMeds.length}/${weightMeds.length} weight-based medicine(s) lack engine calc trace. Verify dose manually.`,
          ];
          (meta as any).compute_doses_enforcement = "warning_added";
        }
      }
    }

    // Sprint 2: three-tier severity. Server-derived severity is computed from
    // detected issues; AI's severity is in safety.severity_ai (if emitted).
    // Final = max(server, AI).
    {
      function severityRank(s?: string): number {
        return s === 'high' ? 3 : s === 'moderate' ? 2 : s === 'low' ? 1 : 0;
      }
      function severityLabel(r: number): 'high' | 'moderate' | 'low' {
        return r >= 3 ? 'high' : r >= 2 ? 'moderate' : 'low';
      }
      if (!prescription.safety) prescription.safety = {};
      const safetyBlock = prescription.safety as any;

      let serverSev: 'high' | 'moderate' | 'low' =
        (safetyBlock.severity_server as any) || 'low';
      const omittedCount = (prescription.omitted_medicines ?? []).length;
      if (omittedCount > 0) serverSev = 'high';
      const allergyText = (safetyBlock.allergy_note ?? '').toString().toUpperCase();
      if (allergyText.includes('ALLERGY:')) serverSev = 'high';
      const interactions = safetyBlock.interactions;
      if (typeof interactions === 'string' && interactions !== 'None found' && interactions.trim() !== '') {
        if (severityRank(serverSev) < severityRank('moderate')) serverSev = 'moderate';
      }
      const maxDose = (safetyBlock.max_dose_check ?? []) as any[];
      if (maxDose.some((c: any) => c.status === 'FLAGGED')) serverSev = 'high';

      const aiSeverity = (safetyBlock.severity_ai ?? '').toString().toLowerCase();
      const aiRank = severityRank(aiSeverity);
      const serverRank = severityRank(serverSev);
      const finalRank = Math.max(serverRank, aiRank);
      safetyBlock.severity_server = serverSev;
      safetyBlock.severity_ai = aiSeverity || 'low';
      safetyBlock.severity_final = severityLabel(finalRank);

      safetyBlock.overall_status = safetyBlock.severity_final === 'low' ? 'SAFE' : 'REVIEW REQUIRED';
    }

    return new Response(JSON.stringify({ prescription, meta }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Edge Function error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
