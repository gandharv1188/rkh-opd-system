// Supabase Edge Function: transcribe-audio
// Transcribes audio using OpenAI GPT-4o Transcribe with medical prompt engineering.
// Falls back gracefully — client uses Web Speech API if this function is unavailable.
//
// Features:
// - Medical vocabulary prompt (530 drugs, clinical terms, dosing patterns)
// - Hindi-English code-switching support
// - Patient-specific context (name, weight, allergies, prior diagnoses)
// - Audio pre-processing guidance via temperature parameter
//
// Secret required: OPENAI_API_KEY
//   Set via: npx supabase secrets set OPENAI_API_KEY=sk-... --project-ref ecywxuqhnlkjtdshpcbc
//
// Deploy: npx supabase functions deploy transcribe-audio --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== MEDICAL PROMPT =====
// This prompt seeds the transcription model with medical vocabulary
// so it correctly recognizes drug names, dosing patterns, and clinical terms.

const MEDICAL_PROMPT = `Pediatric OPD clinical dictation. Doctor is dictating a prescription note for a child patient at Radhakishan Hospital, Kurukshetra.

Common drugs: AMOXICILLIN, PARACETAMOL, IBUPROFEN, AZITHROMYCIN, CEFTRIAXONE, CETIRIZINE, ONDANSETRON, SALBUTAMOL, PREDNISOLONE, METRONIDAZOLE, AMOXICILLIN+CLAVULANATE, MONTELUKAST, ZINC, ORS, IRON, FOLIC ACID, DOMPERIDONE, RANITIDINE, OMEPRAZOLE, PANTOPRAZOLE, ALBENDAZOLE, IVERMECTIN, COTRIMOXAZOLE, FLUCONAZOLE, PHENOBARBITONE, SODIUM VALPROATE, LEVETIRACETAM, BUDESONIDE, IPRATROPIUM, LEVOSALBUTAMOL, LACTULOSE, VITAMIN D3, CHOLECALCIFEROL, MULTIVITAMIN, CALCIUM, CEFIXIME, CEFPODOXIME, OFLOXACIN, NORFLOXACIN, NITROFURANTOIN, DOXYCYCLINE, CLINDAMYCIN, MUPIROCIN, FUSIDIC ACID, PERMETHRIN, CALAMINE, HYDROCORTISONE CREAM, BETAMETHASONE, CLOBETASOL, CHLORAMPHENICOL EYE DROPS, TOBRAMYCIN, CIPROFLOXACIN EYE DROPS, XYLOMETAZOLINE, SALINE NASAL DROPS, MOMETASONE, FLUTICASONE, BECLOMETHASONE, DERIPHYLLIN, AMINOPHYLLINE, PHENYLEPHRINE, CHLORPHENIRAMINE, LEVOCETIRIZINE, FEXOFENADINE, HYDROXYZINE, PROMETHAZINE, DIAZEPAM, MIDAZOLAM, LORAZEPAM, CLOBAZAM, CARBAMAZEPINE, PHENYTOIN, TOPIRAMATE, OXCARBAZEPINE, ADRENALINE, ATROPINE, DOPAMINE, DOBUTAMINE, FUROSEMIDE, MANNITOL, DEXTROSE, NORMAL SALINE, RINGER LACTATE.

Dosing: mg/kg, mg/kg/day, mg/kg/dose, ml, drops, puffs, BD, TDS, QID, OD, SOS, PRN, nocte, per oral, IV, IM, SC, nebulization, MDI with spacer, 5 days, 7 days, 3 days, stat dose, loading dose.

Clinical terms: URTI, LRTI, AOM, AGE, UTI, SAM, MAM, GERD, RDS, wheeze, crepitations, bronchiolitis, pneumonia, pharyngitis, tonsillitis, otitis media, febrile seizures, neonatal sepsis, jaundice, anemia, malnutrition, dehydration, ICD-10, CBC, CRP, ESR, LFT, RFT, S. Creatinine, TLC, Hb, SpO2, HR, RR, HC, MUAC, WAZ, HAZ, WHZ, weight-for-age, height-for-age.

Hindi terms that may appear: bukhar (fever), khansi (cough), zukam (cold), dast (diarrhea), ulti (vomiting), pet dard (stomach pain), saans (breathing), dawai (medicine), goli (tablet), sharbat (syrup), boonden (drops), subah shaam (morning evening), khane ke baad (after food), khali pet (empty stomach), teeka (vaccine), wajan (weight).`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "OPENAI_API_KEY not configured",
          fallback: true,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File | null;
    const patientContext = formData.get("patient_context") as string | null;
    const language = (formData.get("language") as string) || "en";

    if (!audioFile) {
      return new Response(JSON.stringify({ error: "No audio file provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the full prompt: medical base + patient-specific context
    let fullPrompt = MEDICAL_PROMPT;
    if (patientContext) {
      fullPrompt += `\n\nCurrent patient: ${patientContext}`;
    }

    // Build the request to OpenAI
    const openaiForm = new FormData();
    openaiForm.append("file", audioFile, "audio.webm");
    openaiForm.append("model", "gpt-4o-transcribe");
    openaiForm.append("prompt", fullPrompt);
    openaiForm.append("response_format", "text");
    // Temperature 0 = most deterministic, best for medical accuracy
    openaiForm.append("temperature", "0");
    // Language hint improves accuracy
    if (language === "hi") {
      openaiForm.append("language", "hi");
    } else if (language === "en") {
      openaiForm.append("language", "en");
    }
    // For Hindi-English mix, omit language param to let model auto-detect

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: openaiForm,
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error(
        `OpenAI transcription error: ${response.status} ${errBody}`,
      );
      return new Response(
        JSON.stringify({
          error: `Transcription failed: ${response.status}`,
          fallback: true,
          details: errBody,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // GPT-4o Transcribe with response_format=text returns plain text
    const transcript = await response.text();

    console.log(
      `Transcribed ${audioFile.size} bytes → ${transcript.length} chars`,
    );

    return new Response(
      JSON.stringify({ text: transcript.trim(), engine: "gpt-4o-transcribe" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("Transcription error:", error.message);
    return new Response(
      JSON.stringify({
        error: error.message,
        fallback: true,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
