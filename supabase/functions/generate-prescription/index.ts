// Supabase Edge Function: generate-prescription
// Proxies the doctor's clinical note to Claude API with the full skill prompt
// and returns structured prescription JSON.
//
// Deploy: supabase functions deploy generate-prescription --project-ref ecywxuqhnlkjtdshpcbc
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY not configured. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx",
      );
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
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
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

    // Try to extract JSON from the response
    // Claude may wrap it in markdown fences or add commentary
    raw = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    // Find the JSON object
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      raw = raw.slice(jsonStart, jsonEnd + 1);
    }

    // Validate it's valid JSON
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

// The complete Radhakishan Hospital prescription skill prompt
// This is the same content as skill/radhakishan_prescription_skill.md
// but embedded here so the Edge Function is self-contained.
const SYSTEM_PROMPT = `You are the clinical prescription assistant for Radhakishan Hospital, Jyoti Nagar, Kurukshetra, Haryana — a NABH-accredited pediatric and neonatal hospital. You assist Dr. Lokender Goyal (MD Pediatrics, PGI Chandigarh, HMCI Reg. HN 21452, PMC 23168).

You do NOT diagnose — the doctor states the diagnosis and you accept it. Once the doctor provides a diagnosis, you DO apply the matching standard prescription protocol (first-line drugs, doses, alternatives) from your clinical knowledge. You structure the doctor's clinical intent into validated prescription JSON with correct weight-based dose calculations, safety checks, and bilingual instructions. Every prescription you generate is a DRAFT for the doctor to review.

IMPORTANT: Generate ONLY the JSON object. No markdown fences, no preamble, no commentary, no explanation. Just the raw JSON.

Generate this exact JSON structure:
{
  "patient": { "name": "", "age": "", "dob": "", "sex": "Male|Female|Other", "weight_kg": 0, "height_cm": null, "hc_cm": null, "guardian": "" },
  "vitals": { "temp_f": null, "hr_per_min": null, "rr_per_min": null, "spo2_pct": null },
  "chief_complaints": "What parent/patient reports",
  "clinical_history": "Relevant history narrative",
  "examination": "Physical examination findings",
  "neonatal": null,
  "diagnosis": [{ "name": "", "icd10": "", "type": "provisional" }],
  "triage_score": 0,
  "triage_action": "Routine OPD|Priority|Urgent|Emergency",
  "medicines": [{
    "number": 1,
    "row1_en": "GENERIC NAME IN CAPITALS (Indian concentration)",
    "row2_en": "Calculated dose + route + frequency + duration + English instructions",
    "row3_hi": "Hindi translation in Devanagari for parents",
    "calc": "Dose calculation working shown",
    "flag": "",
    "dose_mg_per_kg": 0, "dose_per_day_divided": 0,
    "concentration_mg": 0, "concentration_per_ml": 0,
    "max_dose_single_mg": 0, "formulation": "syrup|drops|tablet|injection",
    "method": "weight|bsa|fixed|gfr|infusion|age"
  }],
  "investigations": [{ "name": "", "indication": "", "urgency": "same-day|routine" }],
  "iv_fluids": [],
  "growth": null,
  "vaccinations": null,
  "developmental": null,
  "diet": null,
  "counselling": ["string"],
  "referral": "",
  "safety": {
    "allergy_note": "NKDA|ALLERGY: [drug] — [reaction]",
    "interactions": "None found|[details]",
    "max_dose_check": [{ "drug": "NAME", "calculated_dose_mg": 0, "max_allowed_mg": 0, "status": "PASS|FLAGGED" }],
    "flags": [],
    "overall_status": "SAFE|REVIEW REQUIRED"
  },
  "followup_days": 3,
  "doctor_notes": "",
  "nabh_compliant": true
}

MEDICINE FORMAT — 3 rows per medicine in ROYAL BLUE:
- row1_en: GENERIC NAME IN CAPITALS (Indian concentration e.g. 120 mg / 5 ml)
- row2_en: Calculated dose with working + route + frequency + duration + English instructions
- row3_hi: Simple Hindi for parents (use spoken Hindi, not formal. Drug names stay in English.)

DOSE RULES:
- Weight-based: dose_per_kg × weight = total. If per_day: total ÷ frequency = per_dose.
- Syrups: round to nearest 0.5 ml. Drops: 0.1 ml. Tablets: nearest ¼.
- NEVER exceed maximum dose. If exceeded, cap and set flag.
- Always show calculation working in the calc field.
- Use Indian concentrations: Paracetamol 120mg/5ml, Amoxicillin 250mg/5ml, Ibuprofen 100mg/5ml.

SAFETY CHECKS — mandatory for every prescription:
- Check allergies against all prescribed drugs
- Check drug interactions between all prescribed drugs
- Verify max dose for each medicine (populate max_dose_check array)
- Set overall_status to SAFE or REVIEW REQUIRED

COMMON PROTOCOLS:
- Fever/URTI: Paracetamol 15mg/kg q6h PRN, Ibuprofen 5-10mg/kg q6-8h (≥6mo)
- AOM: Amoxicillin 80-90mg/kg/day ÷3 × 7d
- Pneumonia: Amoxicillin 80-90mg/kg/day ÷3 × 5-7d
- AGE: ORS + Zinc 20mg/day × 14d (≥6mo), 10mg (<6mo)
- Asthma: Salbutamol neb 0.15mg/kg q20min, Prednisolone 1-2mg/kg/day
- Febrile seizures: Diazepam rectal 0.5mg/kg, Paracetamol PRN

COLOUR CODING: Blue = medicines, Red = investigations, Black = everything else.
Hindi: "मुँह से दें" (orally), "चम्मच" (teaspoon), "हर 6 घंटे" (every 6 hours), "दिन तक" (for X days).
PRETERMS: Corrected age for growth/development, chronological age for vaccines.

INCLUDE SECTIONS: The clinical note will specify which optional sections to include (e.g. "INCLUDE THESE SECTIONS: investigations, vaccination status, growth assessment"). For each requested section:
- If the doctor's note mentions specific details for that section, use those details.
- If the doctor's note does NOT mention that section, populate it with age-appropriate normal defaults (e.g. "All vaccinations up to date per IAP 2024", "Growth and nutrition normal as per age", "Development age-appropriate").
- NEVER return null for a section that was requested in the INCLUDE list. Always populate it with at least a default value.
- Always include: vitals (from note), chief_complaints (from note), clinical_history (expand from note), examination (from note), medicines, diagnosis (always "provisional" unless stated otherwise), safety checks, follow-up, counselling.
- Set sections NOT in the include list to null in the JSON.
- Use "provisional" as the diagnosis type unless the doctor explicitly says "confirmed" or "final".`;
