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

const PAD_SYSTEM_PROMPT = `You are a medical document transcription assistant for a pediatric hospital.`;

const SYSTEM_PROMPT = `You are a medical document OCR assistant for a pediatric hospital in India. Extract structured data from medical documents (lab reports, prescriptions, discharge summaries, radiology reports).

RETURN ONLY valid JSON (no markdown, no code fences) with this structure:
{
  "document_type": "lab_report|prescription|discharge_summary|radiology|other",
  "summary": "Comprehensive clinical summary of the ENTIRE document — include patient demographics, admission/discharge details, key clinical findings, course of treatment, investigations done, procedures performed, condition at discharge, and follow-up advice. This summary will be shown to the treating doctor as context. Write 3-6 sentences in clinical note style.",
  "lab_values": [
    {
      "test_name": "Hemoglobin",
      "value": "11.2",
      "unit": "g/dL",
      "flag": "normal|low|high|critical",
      "test_category": "Hematology|Biochemistry|Microbiology|Imaging",
      "reference_range": "11.5-16.5 g/dL",
      "report_date": "YYYY-MM-DD or null"
    }
  ],
  "diagnoses": ["diagnosis text"],
  "medications": [
    { "drug": "drug name", "dose": "250mg", "frequency": "TDS", "duration": "5 days" }
  ],
  "vaccinations": [
    { "vaccine_name": "BCG", "dose_number": 1, "date_given": "YYYY-MM-DD or null", "site": "left arm", "batch_no": "string or null" }
  ],
  "clinical_notes": "any other relevant clinical text from the document",
  "lab_name": "name of lab or hospital if visible",
  "report_date": "YYYY-MM-DD if date is visible, otherwise null"
}

DOCUMENT-TYPE SPECIFIC RULES:

For LAB REPORTS:
- Extract ALL lab values visible in the document.

For DISCHARGE SUMMARIES:
- Lab values: extract ONLY the MOST RECENT / LATEST value for each test. Discharge summaries often contain serial monitoring values (e.g., 7 TSB readings across days). Return only the last one. Set report_date to the date that value was measured.
- Medications: extract only DISCHARGE medications (medications at the time of discharge / "medications on discharge" / "discharge advice"). Do NOT include historical in-hospital medications.
- Extract all diagnoses (primary + secondary).

For PRESCRIPTIONS:
- Extract medications with dose, frequency, duration.
- Extract diagnoses if present.

For VACCINATION CARDS / IMMUNIZATION RECORDS:
- Extract ALL vaccination entries visible: vaccine name, dose number, date given, site of injection, batch number.
- Normalize vaccine names to standard abbreviations: BCG, OPV, IPV, Hep B, DPT, DTwP, DTaP, Pentavalent, PCV, Rotavirus, MR, MMR, Typhoid, Hep A, Varicella, JE, Influenza, HPV, Td, TT.
- If multiple doses of same vaccine, list each as a separate entry with correct dose_number (1, 2, 3, booster).
- Date format: YYYY-MM-DD. If only month/year visible, use first day of month.
- Return empty vaccinations array [] for non-vaccination documents.

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
- TSB, Total Serum Bilirubin → Total Serum Bilirubin

TEST CATEGORY — assign one of:
- "Hematology" — CBC, Hb, TLC, RBC, Platelets, ESR, blood film, coagulation
- "Biochemistry" — LFT, KFT, electrolytes, glucose, bilirubin, thyroid, CRP, HbA1c
- "Microbiology" — cultures, sensitivity, urine R/M, stool R/M, rapid tests
- "Imaging" — X-ray, USG, CT, MRI findings

FLAGS:
- "normal" — within reference range
- "low" — below reference range
- "high" — above reference range
- "critical" — dangerously abnormal

GENERAL RULES:
- If a value has a reference range printed, include it in reference_range and flag accordingly
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
      visit_id,
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

    // Determine media type and build the content source for Claude
    let contentSource: any;
    let mediaType: string;

    if (image_base64) {
      // Direct base64 from client (prescription pad attach flow — no storage)
      mediaType = reqMediaType || "image/jpeg";
      const isPdf = mediaType === "application/pdf";
      contentSource = {
        type: isPdf ? "document" : "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: image_base64,
        },
      };
    } else {
      // URL-based source — let Claude fetch directly (no chunked base64 conversion)
      // Detect media type from URL extension or HEAD request
      const urlLower = image_url.toLowerCase();
      const isPdf =
        urlLower.endsWith(".pdf") ||
        urlLower.includes("content-type=application/pdf");
      if (isPdf) {
        mediaType = "application/pdf";
        contentSource = {
          type: "document",
          source: { type: "url", url: image_url },
        };
      } else {
        mediaType = "image/jpeg"; // Claude auto-detects actual type from URL
        contentSource = {
          type: "image",
          source: { type: "url", url: image_url },
        };
      }
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

    // Use separate system prompt for pad mode
    const systemPrompt = isPadMode ? PAD_SYSTEM_PROMPT : SYSTEM_PROMPT;

    // Call Claude Vision API (PDF support is GA — no beta header needed)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              contentSource,
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

    // Server-side save: if patient_id, visit_id, and doc_url provided, save directly to DB
    const doc_url = image_url;
    if (patient_id && visit_id && !isPadMode) {
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!SERVICE_KEY)
        console.warn("SUPABASE_SERVICE_ROLE_KEY not set — DB writes may fail");
      const dbKey = SERVICE_KEY || ANON_KEY;
      const dbHeaders = {
        apikey: dbKey,
        Authorization: `Bearer ${dbKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      };

      // Save lab values to lab_results table (only if test_name, value, and date are present)
      let savedCount = 0;
      let skippedLabs = 0;
      if (extracted.lab_values?.length) {
        for (const lab of extracted.lab_values) {
          // Skip incomplete records — don't pollute the database
          const testDate = lab.report_date || doc_date || null;
          if (!lab.test_name || !lab.value || !testDate) {
            skippedLabs++;
            continue;
          }
          try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/lab_results`, {
              method: "POST",
              headers: dbHeaders,
              body: JSON.stringify({
                patient_id,
                visit_id,
                test_name: lab.test_name,
                value: lab.value,
                value_numeric: isNaN(parseFloat(lab.value))
                  ? null
                  : parseFloat(lab.value),
                unit: lab.unit || null,
                flag: lab.flag || "normal",
                test_category: lab.test_category || null,
                reference_range: lab.reference_range || null,
                lab_name: extracted.lab_name || null,
                test_date: testDate,
                source: "ai_extracted",
              }),
            });
            if (res.ok) savedCount++;
            else console.warn("Lab save failed:", res.status);
          } catch (e: any) {
            console.warn("Lab save error:", e.message);
          }
        }
        console.log(
          `Saved ${savedCount}/${extracted.lab_values.length} lab results to DB` +
            (skippedLabs
              ? ` (${skippedLabs} skipped — missing test_name, value, or date)`
              : ""),
        );
      }

      // Save extracted vaccinations to vaccinations table (only with vaccine_name and date)
      let vaxSavedCount = 0;
      let skippedVax = 0;
      if (extracted.vaccinations?.length) {
        for (const vax of extracted.vaccinations) {
          // Skip incomplete records — must have vaccine name and date to be useful
          if (!vax.vaccine_name || !vax.date_given) {
            skippedVax++;
            continue;
          }
          try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/vaccinations`, {
              method: "POST",
              headers: dbHeaders,
              body: JSON.stringify({
                patient_id,
                vaccine_name: vax.vaccine_name,
                dose_number: vax.dose_number || null,
                date_given: vax.date_given,
                site: vax.site || null,
                batch_number: vax.batch_no || null,
                given_by: "extracted_from_document",
                free_or_paid: "unknown",
              }),
            });
            if (res.ok) vaxSavedCount++;
            else console.warn("Vaccination save failed:", res.status);
          } catch (e: any) {
            console.warn("Vaccination save error:", e.message);
          }
        }
        console.log(
          `Saved ${vaxSavedCount}/${extracted.vaccinations.length} vaccination records to DB` +
            (skippedVax
              ? ` (${skippedVax} skipped — missing vaccine_name or date)`
              : ""),
        );
      }

      // Update attached_documents with OCR summary
      if (doc_url) {
        try {
          const vRes = await fetch(
            `${SUPABASE_URL}/rest/v1/visits?id=eq.${visit_id}&select=attached_documents`,
            { headers: dbHeaders },
          );
          if (vRes.ok) {
            const vData = await vRes.json();
            const docs = vData[0]?.attached_documents || [];
            const docIdx = docs.findIndex((d: any) => d.url === doc_url);
            if (docIdx >= 0) {
              docs[docIdx].ocr_summary = extracted.summary || null;
              docs[docIdx].ocr_lab_count = extracted.lab_values?.length || 0;
              docs[docIdx].ocr_vax_count = extracted.vaccinations?.length || 0;
              docs[docIdx].ocr_diagnoses = extracted.diagnoses || [];
              docs[docIdx].ocr_medications = extracted.medications || [];
              await fetch(`${SUPABASE_URL}/rest/v1/visits?id=eq.${visit_id}`, {
                method: "PATCH",
                headers: dbHeaders,
                body: JSON.stringify({
                  attached_documents: docs,
                  updated_at: new Date().toISOString(),
                }),
              });
              console.log("OCR summary saved to attached_documents");
            }
          }
        } catch (e: any) {
          console.warn("Failed to save OCR summary:", e.message);
        }
      }

      extracted._saved_to_db = savedCount > 0;
      extracted._lab_count_saved = savedCount;
    }

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
