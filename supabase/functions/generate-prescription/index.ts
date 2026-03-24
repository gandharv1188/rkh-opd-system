// Supabase Edge Function: generate-prescription
// Uses Claude tool_use for progressive disclosure — Claude fetches only
// the clinical knowledge it needs via tools.
//
// Tools: get_reference, get_formulary, get_standard_rx
//
// Deploy: supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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
      "Look up drugs in the hospital formulary. Returns ABDM FHIR-compliant formulations with ingredients[] (each having strength_numerator/strength_denominator), indian_brands[], indian_conc_note, dosing_bands (dose ranges by age/weight/indication), interactions, contraindications, cross_reactions, renal_bands, and administration instructions. ALWAYS call this for every drug you plan to prescribe.",
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

async function executeGetFormulary(drugNames: string[]): Promise<string> {
  try {
    const orFilter = drugNames
      .map((d) => `generic_name.ilike.%25${encodeURIComponent(d.trim())}%25`)
      .join(",");
    const url = `${SUPABASE_URL}/rest/v1/formulary?or=(${orFilter})&select=generic_name,formulations,dosing_bands,interactions,contraindications,cross_reactions,black_box_warnings,renal_bands,administration,food_instructions,notes,snomed_code,snomed_display&active=eq.true`;
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) return `Formulary query error: HTTP ${res.status}`;
    const drugs = await res.json();
    if (!drugs.length)
      return `No formulary entries found for: ${drugNames.join(", ")}. Use your clinical training knowledge for dosing.`;
    return JSON.stringify(drugs, null, 2);
  } catch (e) {
    return `Formulary query error: ${e.message}`;
  }
}

async function executeGetStandardRx(
  icd10?: string,
  name?: string,
): Promise<string> {
  const select =
    "icd10,diagnosis_name,snomed_code,first_line_drugs,second_line_drugs,investigations,counselling,warning_signs,referral_criteria,hospitalisation_criteria,notes,duration_days_default";
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
  console.log(`  Tool: ${name}(${JSON.stringify(input)})`);
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
): Promise<{
  text: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  rounds: number;
}> {
  const messages: Message[] = [{ role: "user", content: userMessage }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Timeout: abort entire loop after 120 seconds
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

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
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
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
        return { text, totalInputTokens, totalOutputTokens, rounds: round };
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
          return { text, totalInputTokens, totalOutputTokens, rounds: round };
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
          return { text, totalInputTokens, totalOutputTokens, rounds: round };
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
        return { text, totalInputTokens, totalOutputTokens, rounds: round };
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
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
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
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("extractJSON parse failed. Raw text:", raw.substring(0, 500));
    return {
      error: "Failed to parse prescription JSON",
      parse_error: e.message,
      raw_preview: raw.substring(0, 200),
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
    const corePrompt = corePromptRaw + "\n\n" + nabhRef;

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

    try {
      // Primary path: tool-use loop
      const result = await toolUseLoop(
        ANTHROPIC_API_KEY,
        corePrompt,
        userMessage,
      );
      rawText = result.text;
      meta = {
        mode: "tool-use",
        rounds: result.rounds,
        input_tokens: result.totalInputTokens,
        output_tokens: result.totalOutputTokens,
      };
    } catch (loopError: any) {
      // Fallback: single-shot with full skill
      console.warn("Tool-use loop failed:", loopError.message);
      rawText = await singleShotFallback(ANTHROPIC_API_KEY, userMessage);
      meta = { mode: "fallback-single-shot", error: loopError.message };
    }

    const prescription = extractJSON(rawText);

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
