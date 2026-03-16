// Supabase Edge Function: generate-prescription
// Fetches the full skill prompt from Supabase Storage at runtime,
// then proxies the doctor's clinical note to Claude API.
//
// Deploy: supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx --project-ref ecywxuqhnlkjtdshpcbc
//
// To update the skill prompt: re-upload skill/radhakishan_prescription_skill.md
// to Supabase Storage bucket "website" as "skill.md". No redeployment needed.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const SKILL_URL = SUPABASE_URL + "/storage/v1/object/public/website/skill.md";

// Cache the skill prompt in memory (survives across requests within same instance)
let cachedSkill: string | null = null;

// Single-shot override: prepended to the skill to replace the multi-step workflow
const SINGLE_SHOT_OVERRIDE = `IMPORTANT OVERRIDE — SINGLE-SHOT MODE:
This is a single API call, NOT a multi-step conversation. Ignore the Step 1 / Step 2 workflow.
Generate the COMPLETE prescription JSON immediately from the clinical note provided.
Output ONLY the raw JSON object — no markdown fences, no preamble, no commentary, no navigation cues.
The clinical note will include an "INCLUDE THESE SECTIONS" instruction — follow it.
`;

async function loadSkill(): Promise<string> {
  if (cachedSkill) return cachedSkill;
  const res = await fetch(SKILL_URL);
  if (!res.ok)
    throw new Error("Failed to load skill prompt from storage: " + res.status);
  cachedSkill = await res.text();
  console.log("Skill loaded:", cachedSkill.length, "chars");
  return cachedSkill;
}

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

    // Load the full skill prompt from Supabase Storage (cached after first load)
    const skill = await loadSkill();
    const systemPrompt = SINGLE_SHOT_OVERRIDE + "\n\n" + skill;

    // Build the user message with context
    let userMessage = clinical_note;
    if (formulary_context) {
      userMessage +=
        "\n\nFORMULARY DATA (use these exact concentrations and dose ranges):\n" +
        formulary_context;
    }
    if (std_rx_context) {
      userMessage += "\n\nSTANDARD PRESCRIPTION PROTOCOLS:\n" + std_rx_context;
    }
    if (patient_allergies && patient_allergies.length) {
      userMessage +=
        "\n\nKNOWN PATIENT ALLERGIES: " + patient_allergies.join(", ");
    }

    // Call Claude API with the full skill as system prompt
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
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
      const error = await response.json();
      throw new Error(
        error.error?.message || `Claude API error: ${response.status}`,
      );
    }

    const data = await response.json();
    let raw = data.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // Extract JSON from response (Claude may add fences or commentary)
    raw = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      raw = raw.slice(jsonStart, jsonEnd + 1);
    }

    const prescription = JSON.parse(raw);

    return new Response(JSON.stringify({ prescription, raw_response: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
