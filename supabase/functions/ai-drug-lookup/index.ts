// Supabase Edge Function: ai-drug-lookup
// Takes a drug name (generic or brand), uses Claude AI to research it,
// and returns a complete structured formulary entry ready for database insertion.
//
// Deploy: npx supabase functions deploy ai-drug-lookup --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are a pediatric clinical pharmacology expert for a NABH-accredited pediatric hospital in Haryana, India. Given a drug name (generic or brand), return a COMPLETE formulary entry as valid JSON.

PRIMARY REFERENCES (in order of priority):
1. IAP (Indian Academy of Pediatrics) Drug Formulary 2024
2. BNF for Children 2025-26
3. Nelson Textbook of Pediatrics
4. WHO Essential Medicines List for Children

CRITICAL RULES:
- Focus on PEDIATRIC use — dosing bands, formulations, and warnings must be pediatric-oriented
- Include Indian brand names with manufacturer in parentheses where possible
- If the input is a brand name, resolve to the generic name and include the brand in brand_names
- For combination drugs (e.g., "Amoxicillin + Clavulanic Acid"), use the combination as generic_name
- generic_name must be in UPPERCASE
- Include ALL available formulations: syrup, drops, dry syrup, tablet, dispersible tablet, injection, MDI, nebulisation solution, cream, ointment, eye drops, ear drops, suppository, etc.
- Include complete dosing bands for different indications and age groups (neonate, infant, child, adolescent)
- For each dosing band, specify method: "weight" (mg/kg), "bsa" (mg/m2), "fixed", "age_tier", or "gfr_adjusted"
- Include drug interactions with severity: "minor", "moderate", "major", or "contraindicated"
- Include renal dose adjustments if applicable (with GFR bands)
- licensed_in_children and lactation_safe must be string "true" or "false"
- pregnancy_category must be one of: A, B, C, D, X, or N/A
- category must be EXACTLY one of: Infectious, Haematology, Endocrine, Cardiovascular, GI, Neurological, Emergency, ENT, Neonatology, Developmental, Dermatology, Renal, Allergy, Anaesthesia, Ophthalmology, Respiratory, Musculoskeletal, Psychiatry, Obstetrics
- For drugs used across multiple categories, pick the PRIMARY pediatric use category
- Return ONLY valid JSON — no markdown, no code fences, no commentary
- Every field in the schema must be present (use null for truly inapplicable fields, empty arrays [] for list fields with no data)

RETURN THIS EXACT JSON STRUCTURE:
{
  "generic_name": "DRUG NAME IN CAPS",
  "drug_class": "pharmacological class",
  "category": "one of the allowed categories",
  "brand_names": ["Brand1 (Manufacturer)", "Brand2 (Manufacturer)"],
  "therapeutic_use": ["indication1", "indication2"],
  "licensed_in_children": "true or false",
  "unlicensed_note": "string or null",
  "formulations": [
    {
      "form": "Syrup|Tablet|Drops|Injection|MDI|Nebulisation|Cream|etc.",
      "conc_qty": 125,
      "conc_unit": "mg",
      "per_qty": 5,
      "per_unit": "ml",
      "route": "PO|IV|IM|SC|INH|TOP|PR|SL|NASAL|OPHTHALMIC|OTIC",
      "indian_brand": "BrandName strength (Manufacturer)"
    }
  ],
  "dosing_bands": [
    {
      "indication": "specific indication",
      "age_band": "all|neonate|infant|child|adolescent|neonate_preterm",
      "method": "weight|bsa|fixed|age_tier|gfr_adjusted",
      "dose_min_qty": 10,
      "dose_max_qty": 20,
      "dose_min_unit": "mg/kg/day",
      "dose_max_unit": "mg/kg/day",
      "frequency": "once daily|twice daily|three times daily|four times daily|every 8 hours|etc.",
      "max_dose": "max daily dose with unit",
      "notes": "additional dosing notes"
    }
  ],
  "interactions": [
    {"drug": "interacting drug", "severity": "minor|moderate|major|contraindicated", "effect": "clinical effect"}
  ],
  "contraindications": ["contraindication1", "contraindication2"],
  "black_box_warnings": "string or null",
  "cross_reactions": ["cross-reactive drug/class"],
  "monitoring_parameters": ["parameter1", "parameter2"],
  "pediatric_specific_warnings": ["warning1", "warning2"],
  "renal_adjustment_required": true,
  "renal_bands": [
    {"gfr_min": 10, "gfr_max": 30, "action": "reduce_dose|extend_interval|contraindicated", "note": "adjustment detail"}
  ],
  "hepatic_adjustment_required": false,
  "hepatic_note": "string or null",
  "administration": [
    {"route": "PO|IV|IM|etc.", "storage": "storage instructions", "reconstitution": "string or null", "dilution": "string or null", "infusion_rate_note": "string or null", "compatibility_note": "string or null"}
  ],
  "food_instructions": "food interaction/timing instructions",
  "storage_instructions": "general storage instructions",
  "pregnancy_category": "A|B|C|D|X|N/A",
  "lactation_safe": "true or false",
  "lactation_note": "string or null",
  "reference_source": ["source1", "source2"],
  "notes": "any additional clinically relevant notes for pediatric use",
  "snomed_code": "SNOMED-CT concept ID for this drug substance (e.g., 372687004 for amoxicillin) or null if unknown",
  "snomed_display": "SNOMED-CT preferred term (e.g., Amoxicillin) or null if unknown"
}`;

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
        system: SYSTEM_PROMPT,
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
        `AI returned invalid category "${formularyEntry.category}" for ${cleanName}, defaulting to first therapeutic use mapping`,
      );
      // Keep as-is but log — caller can correct
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
