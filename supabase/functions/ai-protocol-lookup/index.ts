// Supabase Edge Function: ai-protocol-lookup
// Takes a diagnosis name and/or ICD-10 code, uses Claude to research and return
// a complete standard prescription protocol ready for database insertion.
// System prompt loaded from Supabase Storage: skill/protocol_lookup_prompt.md
//
// Deploy: npx supabase functions deploy ai-protocol-lookup --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const STORAGE_BASE = SUPABASE_URL + "/storage/v1/object/public/website/skill";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_CATEGORIES = [
  "Respiratory",
  "ENT",
  "GI",
  "Infectious",
  "Neurology",
  "Neonatal",
  "Endocrine",
  "Emergency",
  "Dermatology",
  "Haematology",
  "Renal",
  "Allergy",
  "Musculoskeletal",
  "Ophthalmology",
  "Cardiovascular",
  "Developmental",
];

// ===== PROMPT CACHE =====
let cachedPrompt: string | null = null;

async function loadPrompt(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;
  const url = STORAGE_BASE + "/protocol_lookup_prompt.md";
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to load prompt from storage: HTTP ${res.status}`);
  cachedPrompt = await res.text();
  console.log(
    `Loaded protocol_lookup_prompt.md (${cachedPrompt.length} chars)`,
  );
  return cachedPrompt;
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
  return JSON.parse(cleaned);
}

// ===== VALIDATION =====

function validateProtocol(protocol: any): string[] {
  const errors: string[] = [];
  if (!protocol.icd10) errors.push("Missing icd10");
  if (!protocol.diagnosis_name) errors.push("Missing diagnosis_name");
  if (!protocol.category) {
    errors.push("Missing category");
  } else if (!VALID_CATEGORIES.includes(protocol.category)) {
    errors.push(
      `Invalid category "${protocol.category}". Must be one of: ${VALID_CATEGORIES.join(", ")}`,
    );
  }
  if (
    !protocol.first_line_drugs ||
    !Array.isArray(protocol.first_line_drugs) ||
    protocol.first_line_drugs.length === 0
  ) {
    errors.push("first_line_drugs must be a non-empty array");
  }
  if (
    protocol.second_line_drugs &&
    !Array.isArray(protocol.second_line_drugs)
  ) {
    errors.push("second_line_drugs must be an array");
  }
  if (protocol.investigations && !Array.isArray(protocol.investigations)) {
    errors.push("investigations must be an array");
  }
  if (protocol.counselling && !Array.isArray(protocol.counselling)) {
    errors.push("counselling must be an array");
  }
  return errors;
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

    const { diagnosis, icd10 } = await req.json();

    if (!diagnosis && !icd10) {
      return new Response(
        JSON.stringify({
          error: "At least one of 'diagnosis' or 'icd10' is required.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Load system prompt from Supabase Storage
    const systemPrompt = await loadPrompt();

    // Build user message
    let userMessage =
      "Generate a complete pediatric standard prescription protocol for:\n";
    if (diagnosis) userMessage += `Diagnosis: ${diagnosis}\n`;
    if (icd10) userMessage += `ICD-10 Code: ${icd10}\n`;
    if (!icd10) {
      userMessage +=
        "\nThe ICD-10 code was not provided — please determine the correct ICD-10 code.\n";
    }

    console.log(
      `ai-protocol-lookup: diagnosis="${diagnosis || ""}", icd10="${icd10 || ""}"`,
    );

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Claude API error:", err);
      throw new Error(
        err.error?.message || `Claude API error: ${response.status}`,
      );
    }

    const data = await response.json();
    const rawText = data.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    console.log(
      `Claude response: ${rawText.length} chars, ${data.usage?.input_tokens || 0} in / ${data.usage?.output_tokens || 0} out tokens`,
    );

    const protocol = extractJSON(rawText);

    // Validate the generated protocol
    const validationErrors = validateProtocol(protocol);
    if (validationErrors.length > 0) {
      console.warn("Validation warnings:", validationErrors);
    }

    return new Response(
      JSON.stringify({
        ...protocol,
        ...(validationErrors.length > 0 ? { _warnings: validationErrors } : {}),
        _meta: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("Edge Function error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
