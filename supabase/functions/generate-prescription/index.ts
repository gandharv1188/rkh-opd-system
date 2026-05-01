// Supabase Edge Function: generate-prescription
// Uses Claude tool_use for progressive disclosure — Claude fetches only
// the clinical knowledge it needs via tools.
//
// Tools: get_reference, get_formulary, get_standard_rx
//
// Deploy: supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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
}> {
  const startMs = Date.now();
  const messages: Message[] = [{ role: "user", content: userMessage }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

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
        return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs };
      }

      if (data.stop_reason === "tool_use") {
        const toolBlocks = data.content.filter(
          (b: ContentBlock) => b.type === "tool_use",
        );
        if (!toolBlocks.length) {
          // No tool calls despite tool_use stop reason — treat as end
          const text = data.content
            .filter((b: ContentBlock) => b.type === "text")
            .map((b: ContentBlock) => b.text || "")
            .join("");
          return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs };
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
          return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs };
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
        return { text, totalInputTokens, totalOutputTokens, rounds: round, durationMs: Date.now() - startMs };
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

    let firstAttemptDurationMs = 0;
    try {
      // Primary path: tool-use loop with 50s budget. The Edge Function has a
      // 150s wall, and we need budget for both the first attempt AND the
      // optional completeness retry.
      const result = await toolUseLoop(
        ANTHROPIC_API_KEY,
        corePrompt,
        userMessage,
        50_000,
      );
      rawText = result.text;
      firstAttemptDurationMs = result.durationMs;
      meta = {
        mode: "tool-use",
        rounds: result.rounds,
        input_tokens: result.totalInputTokens,
        output_tokens: result.totalOutputTokens,
        first_attempt_duration_ms: result.durationMs,
      };
    } catch (loopError: any) {
      // Fallback: single-shot with full skill
      console.warn("Tool-use loop failed:", loopError.message);
      rawText = await singleShotFallback(ANTHROPIC_API_KEY, userMessage);
      meta = { mode: "fallback-single-shot", error: loopError.message };
    }

    const prescription = extractJSON(rawText);

    // Server-side completeness check: ensure every doctor-requested drug is
    // either emitted in medicines[] or explicitly listed in omitted_medicines[].
    const reqMeds: string[] = prescription.requested_medicines ?? [];
    const emittedMeds: string[] = (prescription.medicines ?? []).map((m: any) => (m.row1_en ?? '').toUpperCase());
    const omittedMeds: any[] = prescription.omitted_medicines ?? [];
    const omittedNames = new Set(omittedMeds.map((o: any) => (o.name ?? '').toUpperCase()));

    const stillMissing = reqMeds.filter((req: string) => {
      const reqU = req.toUpperCase();
      if (omittedNames.has(reqU)) return false;
      return !emittedMeds.some((e: string) => e.includes(reqU) || reqU.includes(e.split(' ')[0]));
    });

    // Retry gating:
    //   - missing > 0
    //   - not in fallback mode (would re-fail with same single-shot)
    //   - first attempt finished in < 60s (otherwise no time left in 150s wall)
    // If first attempt was slow but produced output, accept it and surface
    // the omission via meta + omitted_medicines so the doctor sees gaps.
    const RETRY_FIRST_ATTEMPT_BUDGET_MS = 60_000;
    const canRetry =
      stillMissing.length > 0 &&
      meta.mode !== 'fallback-single-shot' &&
      firstAttemptDurationMs > 0 &&
      firstAttemptDurationMs < RETRY_FIRST_ATTEMPT_BUDGET_MS;

    if (stillMissing.length > 0) {
      meta.first_attempt_missing = stillMissing;
    }

    if (canRetry) {
      // Compute remaining wall time, leave 5s headroom for response handling.
      const remainingMs = Math.max(20_000, 145_000 - firstAttemptDurationMs - 5_000);
      console.log(`Completeness mismatch: missing ${stillMissing.join(', ')}. Retrying once with ${remainingMs}ms budget.`);
      meta.completeness_retry = true;
      meta.completeness_retry_budget_ms = remainingMs;
      const retryUserMessage = userMessage + `\n\nIMPORTANT: Your previous output omitted these drugs the doctor explicitly requested: ${stillMissing.join(', ')}. Either include each one in medicines[] with full dose calculation, OR add an entry to omitted_medicines[] with a clear reason.`;
      try {
        const retry = await toolUseLoop(ANTHROPIC_API_KEY, corePrompt, retryUserMessage, remainingMs);
        rawText = retry.text;
        meta.rounds = (meta.rounds || 0) + retry.rounds;
        meta.input_tokens = (meta.input_tokens || 0) + retry.totalInputTokens;
        meta.output_tokens = (meta.output_tokens || 0) + retry.totalOutputTokens;
        meta.retry_duration_ms = retry.durationMs;
        const retryPrescription = extractJSON(rawText);
        // Re-apply requested_medicines from first attempt if retry dropped it
        if ((!retryPrescription.requested_medicines || retryPrescription.requested_medicines.length === 0) && reqMeds.length > 0) {
          retryPrescription.requested_medicines = reqMeds;
        }
        Object.assign(prescription, retryPrescription);
      } catch (retryErr: any) {
        console.warn("Completeness retry failed:", retryErr.message);
        meta.completeness_retry_error = retryErr.message;
      }
    } else if (stillMissing.length > 0) {
      // Skipped retry. Surface omissions so the doctor and audit see them.
      meta.completeness_retry_skipped = true;
      meta.completeness_retry_skipped_reason =
        firstAttemptDurationMs >= RETRY_FIRST_ATTEMPT_BUDGET_MS
          ? `first_attempt_too_slow_${firstAttemptDurationMs}ms`
          : (meta.mode === 'fallback-single-shot' ? 'fallback_mode' : 'unknown');
      // Auto-add stillMissing into omitted_medicines so the front-end shows them
      const existingOmittedNames = new Set((prescription.omitted_medicines ?? []).map((o: any) => (o.name ?? '').toUpperCase()));
      const synthetic = stillMissing
        .filter(m => !existingOmittedNames.has(m.toUpperCase()))
        .map(m => ({ name: m, reason: 'server_completeness_check_skipped_retry' }));
      prescription.omitted_medicines = [...(prescription.omitted_medicines ?? []), ...synthetic];
      // Force severity_server to 'high' so the doctor can't miss it
      if (!prescription.safety) prescription.safety = {};
      prescription.safety.severity_server = 'high';
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
