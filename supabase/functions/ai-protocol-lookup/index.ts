// Supabase Edge Function: ai-protocol-lookup
// Takes a diagnosis name and/or ICD-10 code, uses Claude to research and return
// a complete standard prescription protocol ready for database insertion.
//
// Deploy: supabase functions deploy ai-protocol-lookup --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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

const SYSTEM_PROMPT = `You are a pediatric clinical pharmacology expert. Your task is to generate a COMPLETE standard prescription protocol for a given diagnosis, ready for insertion into a hospital database.

CONTEXT: This is for Radhakishan Hospital, a NABH-accredited pediatric OPD in Kurukshetra, Haryana, India.

GUIDELINES:
- Focus EXCLUSIVELY on PEDIATRIC management (neonates through 18 years)
- Use IAP (Indian Academy of Pediatrics) 2024 guidelines as the PRIMARY source
- Also reference AAP, WHO, Nelson's, and IDSA where relevant
- Drug names must be in UPPERCASE (e.g., AMOXICILLIN, PARACETAMOL)
- Doses must be in mg/kg/day (or mg/kg/dose where appropriate) with frequency and duration
- Include BOTH first-line and second-line/alternative drugs
- Include relevant investigations with indications and urgency (routine/urgent/stat)
- Include practical counselling points for Indian parents (plain language)
- Include referral criteria and hospitalisation criteria
- Provide the correct ICD-10 code if not supplied by the user
- Try to provide a SNOMED-CT code for the diagnosis
- Category must be EXACTLY one of: ${VALID_CATEGORIES.join(", ")}

DRUG ENTRY FORMAT — each drug object must have:
- "drug": string — UPPERCASE generic name (e.g., "AMOXICILLIN")
- "dose_qty": number — numeric dose value (e.g., 90 for 90 mg/kg/day)
- "dose_unit": string — unit (e.g., "mg/kg/day", "mg/kg/dose", "mcg/kg/day")
- "dose_basis": string — one of "per_kg", "per_m2", "fixed", "age_tier"
- "is_per_day": boolean — true if dose_qty is total daily dose, false if per-dose
- "frequency_per_day": number — how many times per day (e.g., 3 for TDS, 2 for BD)
- "duration_days": number — typical duration in days
- "route": string — "PO", "IV", "IM", "SC", "INH", "TOP", "PR", "NEB"
- "notes": string — clinical notes (indications, caveats, Indian formulation tips)

INVESTIGATION FORMAT — each investigation object must have:
- "name": string — investigation name
- "indication": string — when to order this
- "urgency": string — "routine", "urgent", or "stat"

OUTPUT: Return ONLY a single valid JSON object matching the schema. No markdown, no code fences, no explanation — just raw JSON.

JSON SCHEMA:
{
  "icd10": "string — ICD-10 code (e.g., H66.90)",
  "diagnosis_name": "string — full diagnosis name",
  "category": "string — one of the valid categories",
  "severity": "string — 'any', 'mild', 'moderate', 'severe'",
  "first_line_drugs": [/* array of drug objects */],
  "second_line_drugs": [/* array of drug objects */],
  "investigations": [/* array of investigation objects */],
  "duration_days_default": "number — typical total treatment duration",
  "counselling": ["string array — practical points for parents"],
  "referral_criteria": "string — when to refer to specialist",
  "hospitalisation_criteria": "string — when to admit",
  "notes": "string — additional clinical notes, age-specific caveats, watchful waiting criteria",
  "source": "string — guideline sources (e.g., 'IAP 2024, AAP 2023, WHO')",
  "snomed_code": "string — SNOMED-CT concept ID if known, or empty string"
}`;

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
        system: SYSTEM_PROMPT,
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
      // Still return it but include warnings
      return new Response(
        JSON.stringify({
          ...protocol,
          _warnings: validationErrors,
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
    }

    return new Response(
      JSON.stringify({
        ...protocol,
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
