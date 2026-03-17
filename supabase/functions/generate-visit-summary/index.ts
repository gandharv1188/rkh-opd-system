// Supabase Edge Function: generate-visit-summary
// Called at registration when a returning patient creates a new visit.
// Fetches past prescriptions, sends to Claude for clinical summary.
//
// Deploy: supabase functions deploy generate-visit-summary --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are a clinical summary assistant for a pediatric hospital. Generate a concise clinical summary of a patient's previous visits for the doctor who is about to see them today.

RULES:
- Write in clinical note style — concise, factual, no pleasantries
- Weight the most recent visit HEAVILY — include diagnosis, treatment, examination findings, doctor's notes, and outcome expectations
- For older visits, mention only diagnosis and key treatment
- Note trends: weight changes, recurring conditions, escalation/de-escalation of treatment
- Flag: ongoing medications, unresolved conditions, allergies, pending follow-ups
- If the last visit had a follow-up recommendation, note whether the patient is returning within or past the recommended window
- Keep under 200 words
- Write in English
- Do NOT include patient name, UHID, or other PII — the summary will be attached to the visit record which already has that
- Start directly with clinical content — no headers or labels`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not configured.");
    }

    const { patient_id, current_weight_kg, current_complaints, patient_age } =
      await req.json();

    if (!patient_id) {
      return new Response(JSON.stringify({ error: "patient_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch past prescriptions (HIPAA: strip PII before sending to Claude)
    const rxUrl = `${SUPABASE_URL}/rest/v1/prescriptions?patient_id=eq.${encodeURIComponent(patient_id)}&is_approved=eq.true&order=created_at.desc&limit=5&select=id,created_at,generated_json`;
    const rxRes = await fetch(rxUrl, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });

    if (!rxRes.ok) {
      return new Response(
        JSON.stringify({
          summary: null,
          reason: "Could not fetch prescriptions",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const rxList = await rxRes.json();
    if (!rxList.length) {
      return new Response(
        JSON.stringify({ summary: null, reason: "No previous prescriptions" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Build clinical data for Claude (PII stripped)
    const visits = rxList.map((rx: any, i: number) => {
      const g = rx.generated_json || {};
      return {
        visit_number: i + 1,
        date: rx.created_at,
        diagnosis: g.diagnosis,
        medicines: (g.medicines || []).map((m: any) => ({
          drug: (m.row1_en || "").split("(")[0].trim(),
          dose: m.row2_en,
          formulation: m.formulation,
        })),
        chief_complaints: g.chief_complaints,
        clinical_history: g.clinical_history,
        examination: g.examination,
        vitals: g.vitals,
        weight_kg: g.patient?.weight_kg,
        investigations: g.investigations,
        safety: {
          allergy_note: g.safety?.allergy_note,
          flags: g.safety?.flags,
        },
        followup_days: g.followup_days,
        doctor_notes: g.doctor_notes,
        growth: g.growth?.classification,
        vaccinations: g.vaccinations?.notes,
      };
    });

    const userMessage = `Generate a clinical summary for a returning pediatric patient.

CURRENT VISIT CONTEXT:
- Patient age: ${patient_age || "unknown"}
- Current weight: ${current_weight_kg || "not yet recorded"} kg
- Today's complaints: ${current_complaints || "not yet recorded"}

PREVIOUS VISITS (most recent first):
${JSON.stringify(visits, null, 2)}

Generate the clinical summary now.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({
          summary: null,
          reason: "AI summary generation failed",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await response.json();
    const summary = data.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    console.log(
      `Summary generated for ${patient_id}: ${summary.length} chars, ${data.usage?.input_tokens || 0} in / ${data.usage?.output_tokens || 0} out tokens`,
    );

    return new Response(JSON.stringify({ summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Edge Function error:", error.message);
    return new Response(
      JSON.stringify({ summary: null, reason: error.message }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
