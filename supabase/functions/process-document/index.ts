// Supabase Edge Function: process-document
// OCR + AI extraction of medical documents (lab reports, prescriptions, discharge summaries).
// Receives an image URL, sends to Claude Vision, returns structured JSON.
//
// Deploy: npx supabase functions deploy process-document --project-ref ecywxuqhnlkjtdshpcbc

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

const SYSTEM_PROMPT = `You are a medical document OCR assistant for a pediatric hospital in India. Extract structured data from medical documents (lab reports, prescriptions, discharge summaries, radiology reports).

RETURN ONLY valid JSON (no markdown, no code fences) with this structure:
{
  "document_type": "lab_report|prescription|discharge_summary|radiology|other",
  "summary": "Brief 1-2 sentence description of the document",
  "lab_values": [
    { "test_name": "Hemoglobin", "value": "11.2", "unit": "g/dL", "flag": "normal|low|high|critical" }
  ],
  "diagnoses": ["diagnosis text"],
  "medications": [
    { "drug": "drug name", "dose": "250mg", "frequency": "TDS", "duration": "5 days" }
  ],
  "clinical_notes": "any other relevant clinical text from the document",
  "lab_name": "name of lab or hospital if visible",
  "report_date": "YYYY-MM-DD if date is visible, otherwise null"
}

TEST NAME NORMALIZATION — always use the standard name:
- Hb, Hemoglobin → Hemoglobin
- WBC, TLC, Total WBC → TLC (WBC)
- RBC, Total RBC → RBC Count
- PCV, HCT, Hematocrit → PCV/Hematocrit
- MCV → MCV
- MCH → MCH
- MCHC → MCHC
- PLT, Platelet, Platelet Count → Platelet Count
- ESR → ESR
- CRP → CRP
- ALT, SGPT → SGPT/ALT
- AST, SGOT → SGOT/AST
- ALP, Alkaline Phosphatase → ALP
- Bilirubin Total, T.Bil → Total Bilirubin
- Bilirubin Direct, D.Bil → Direct Bilirubin
- BUN, Blood Urea Nitrogen → BUN
- Creat, Creatinine, S.Creatinine → Serum Creatinine
- Na, Sodium → Sodium
- K, Potassium → Potassium
- Ca, Calcium → Calcium
- FBS, Fasting Blood Sugar, Fasting Glucose → Fasting Blood Sugar
- RBS, Random Blood Sugar → Random Blood Sugar
- HbA1c, Glycated Hb → HbA1c
- TSH → TSH
- T3, Total T3 → T3
- T4, Total T4 → T4
- Urine R/M, Urine Routine → Urine Routine

FLAGS:
- "normal" — within reference range
- "low" — below reference range
- "high" — above reference range
- "critical" — dangerously abnormal

RULES:
- Extract ALL lab values visible in the document
- If a value has a reference range printed and the result is outside it, flag accordingly
- For prescriptions, extract medications with dose, frequency, duration
- For discharge summaries, extract diagnoses, medications, and clinical notes
- If the document is unclear or illegible, still return the JSON structure with empty arrays and note "partially legible" in summary
- Dates should be in YYYY-MM-DD format
- Return empty arrays [] for fields with no data (never omit fields)`;

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
      image_url,
      image_base64,
      media_type: reqMediaType,
      patient_id,
      category,
      doc_date,
      mode,
    } = await req.json();

    if (!image_url && !image_base64) {
      return new Response(
        JSON.stringify({ error: "image_url or image_base64 is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let base64: string;
    let mediaType: string;

    if (image_base64) {
      // Direct base64 from client (prescription pad attach flow — no storage)
      base64 = image_base64;
      mediaType = reqMediaType || "image/jpeg";
    } else {
      // Fetch from URL (registration upload flow)
      const imageRes = await fetch(image_url);
      if (!imageRes.ok)
        throw new Error(`Failed to fetch image: ${imageRes.status}`);
      const imageBytes = new Uint8Array(await imageRes.arrayBuffer());
      // Convert to base64 in chunks to avoid stack overflow on large files
      let binary = "";
      const chunkSize = 32768;
      for (let i = 0; i < imageBytes.length; i += chunkSize) {
        binary += String.fromCharCode(...imageBytes.subarray(i, i + chunkSize));
      }
      base64 = btoa(binary);
      const contentType = imageRes.headers.get("content-type") || "image/jpeg";
      // Support PDFs (Claude Vision handles application/pdf natively)
      mediaType = contentType.split(";")[0] || "image/jpeg";
    }

    // Build the user message with context
    const contextParts: string[] = [];
    if (category) contextParts.push(`Document category: ${category}`);
    if (doc_date) contextParts.push(`Document date: ${doc_date}`);
    if (patient_id) contextParts.push(`Patient ID: ${patient_id}`);

    // For prescription pad mode, use a fast text-dump prompt instead of structured JSON
    const isPadMode = mode === "pad";
    const padPrompt = `This is a photo of a doctor's handwritten notes on a notepad. The handwriting may be messy, abbreviated, or use medical shorthand — this is normal.

Your job: transcribe EXACTLY what is written. Do not summarize, interpret, rephrase, or add commentary. Output the text as-is, preserving the doctor's own words, abbreviations, and structure.

Rules:
- Output ONLY the transcribed text, nothing else
- Keep the doctor's exact abbreviations (e.g., "c/o", "o/e", "Dx", "Rx", "Hb", "TLC", "BD", "TDS")
- Keep the doctor's exact phrasing and sentence fragments
- If a word is unclear, write your best guess — do not skip it
- Preserve line breaks as the doctor wrote them
- Do NOT add labels like "Patient:", "Diagnosis:", "Medicines:" unless the doctor wrote them
- Do NOT add "(HIGH)" or "(LOW)" or any flags
- Do NOT rearrange or reformat the content
- If it is a printed lab report or prescription (not handwritten), still just transcribe all the text verbatim`;

    const userText = isPadMode
      ? padPrompt
      : contextParts.length
        ? `Extract all medical data from this document.\n\nContext: ${contextParts.join(", ")}`
        : "Extract all medical data from this document.";

    // Call Claude Vision API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        ...(mediaType === "application/pdf"
          ? { "anthropic-beta": "pdfs-2024-09-25" }
          : {}),
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              mediaType === "application/pdf"
                ? {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: base64,
                    },
                  }
                : {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mediaType,
                      data: base64,
                    },
                  },
              {
                type: "text",
                text: userText,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Claude API error:", err);
      return new Response(
        JSON.stringify({
          error: "AI extraction failed",
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
      `Document processed (${isPadMode ? "pad" : "structured"}) for ${patient_id || "unknown"}: ` +
        `${data.usage?.input_tokens || 0} in / ${data.usage?.output_tokens || 0} out tokens`,
    );

    // Pad mode: return raw text for dumping into prescription pad textarea
    if (isPadMode) {
      return new Response(
        JSON.stringify({
          text_for_pad: rawText,
          summary: rawText.substring(0, 200),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Structured mode: parse JSON response
    let extracted;
    try {
      extracted = JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[1].trim());
      } else {
        // Return raw text as summary if JSON parsing fails
        return new Response(
          JSON.stringify({
            summary: rawText,
            lab_values: [],
            medications: [],
            diagnoses: [],
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    console.log(
      `Extracted: type=${extracted.document_type}, labs=${extracted.lab_values?.length || 0}, meds=${extracted.medications?.length || 0}`,
    );

    return new Response(JSON.stringify(extracted), {
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
