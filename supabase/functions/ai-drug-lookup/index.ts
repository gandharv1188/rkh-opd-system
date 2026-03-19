// Supabase Edge Function: ai-drug-lookup
// Takes a drug name (generic or brand), uses Claude AI to research it,
// and returns a complete structured formulary entry ready for database insertion.
// System prompt loaded from Supabase Storage: skill/formulary_lookup_prompt.md
//
// Deploy: npx supabase functions deploy ai-drug-lookup --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const STORAGE_BASE = SUPABASE_URL + "/storage/v1/object/public/website/skill";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== PROMPT CACHE =====
let cachedPrompt: string | null = null;

async function loadPrompt(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;
  const url = STORAGE_BASE + "/formulary_lookup_prompt.md";
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to load prompt from storage: HTTP ${res.status}`);
  cachedPrompt = await res.text();
  console.log(
    `Loaded formulary_lookup_prompt.md (${cachedPrompt.length} chars)`,
  );
  return cachedPrompt;
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

    const { drug_name } = await req.json();

    if (!drug_name || typeof drug_name !== "string" || !drug_name.trim()) {
      return new Response(
        JSON.stringify({ error: "drug_name is required (non-empty string)" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const cleanName = drug_name.trim();

    // Load system prompt from Supabase Storage
    const systemPrompt = await loadPrompt();

    const userMessage = `Research the drug "${cleanName}" and return a complete pediatric formulary entry as JSON.

If this is a brand name, resolve it to the generic name. Include all formulations available in India, complete pediatric dosing bands per IAP guidelines, drug interactions, renal adjustments, and pediatric-specific warnings.

Return ONLY the JSON object — no other text.`;

    // Call Claude API
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
      return new Response(
        JSON.stringify({
          error: "AI drug lookup failed",
          detail: err?.error?.message || "Unknown error",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();
    const rawText = data.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    console.log(
      `Drug lookup for "${cleanName}": ${data.usage?.input_tokens || 0} in / ${data.usage?.output_tokens || 0} out tokens`,
    );

    // Parse the JSON response
    let formularyEntry;
    try {
      formularyEntry = JSON.parse(rawText);
    } catch {
      // Try extracting JSON from markdown code fences
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        formularyEntry = JSON.parse(jsonMatch[1].trim());
      } else {
        // Try finding JSON object in the text
        const start = rawText.indexOf("{");
        const end = rawText.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          formularyEntry = JSON.parse(rawText.slice(start, end + 1));
        } else {
          return new Response(
            JSON.stringify({
              error: "Failed to parse AI response as JSON",
              raw_response: rawText.substring(0, 500),
            }),
            {
              status: 422,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }
    }

    // Validate required fields
    if (!formularyEntry.generic_name) {
      return new Response(
        JSON.stringify({
          error: "AI response missing generic_name",
          raw_response: rawText.substring(0, 500),
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Ensure generic_name is uppercase
    formularyEntry.generic_name = formularyEntry.generic_name.toUpperCase();

    // Validate category
    const VALID_CATEGORIES = [
      "Infectious",
      "Haematology",
      "Endocrine",
      "Cardiovascular",
      "GI",
      "Neurological",
      "Emergency",
      "ENT",
      "Neonatology",
      "Developmental",
      "Dermatology",
      "Renal",
      "Allergy",
      "Anaesthesia",
      "Ophthalmology",
      "Respiratory",
      "Musculoskeletal",
      "Psychiatry",
      "Obstetrics",
    ];
    if (!VALID_CATEGORIES.includes(formularyEntry.category)) {
      console.warn(
        `AI returned invalid category "${formularyEntry.category}" for ${cleanName}`,
      );
    }

    console.log(
      `Formulary entry generated: ${formularyEntry.generic_name}, ` +
        `${formularyEntry.formulations?.length || 0} formulations, ` +
        `${formularyEntry.dosing_bands?.length || 0} dosing bands, ` +
        `${formularyEntry.interactions?.length || 0} interactions`,
    );

    return new Response(JSON.stringify(formularyEntry), {
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
