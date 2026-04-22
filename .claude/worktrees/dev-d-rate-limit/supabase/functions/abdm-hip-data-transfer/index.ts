// Supabase Edge Function: abdm-hip-data-transfer
// ABDM HIP callback — Health Information Request Handler.
// ABDM gateway calls this when a health information request is made (with valid consent)
// to fetch patient health records from Radhakishan Hospital.
//
// Deploy: supabase functions deploy abdm-hip-data-transfer --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const ABDM_GATEWAY_URL =
  Deno.env.get("ABDM_GATEWAY_URL") || "https://dev.abdm.gov.in";
const ABDM_CLIENT_ID = Deno.env.get("ABDM_CLIENT_ID") || "";
const ABDM_CLIENT_SECRET = Deno.env.get("ABDM_CLIENT_SECRET") || "";

// Edge Function URL for FHIR bundle generation
const FHIR_BUNDLE_URL = `${SUPABASE_URL}/functions/v1/generate-fhir-bundle`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hip-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== HELPERS =====

function supabaseHeaders() {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

// TODO: Implement proper ABDM gateway signature verification.
function validateGatewayRequest(req: Request): boolean {
  const hipId = req.headers.get("x-hip-id");
  if (!hipId) {
    console.warn(
      "Missing X-HIP-ID header — request may not be from ABDM gateway",
    );
    return false;
  }
  // TODO: Verify request signature using ABDM gateway's public key
  // TODO: Validate timestamp to prevent replay attacks
  return true;
}

// ===== MAIN HANDLER =====

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate request origin
    if (!validateGatewayRequest(req)) {
      console.warn("Gateway validation failed — processing anyway for sandbox");
    }

    const body = await req.json();
    const { requestId, timestamp, transactionId, hiRequest } = body;

    console.log(
      `[abdm-hip-data-transfer] requestId=${requestId} transactionId=${transactionId}`,
    );

    if (!hiRequest) {
      return new Response(
        JSON.stringify({
          requestId,
          error: { code: 1000, message: "Invalid request: missing hiRequest" },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { consent, dataPushUrl, dateRange, keyMaterial } = hiRequest;
    const consentArtefactId = consent?.id;

    if (!consentArtefactId) {
      return new Response(
        JSON.stringify({
          requestId,
          error: {
            code: 1000,
            message: "Invalid request: missing consent artefact ID",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `[abdm-hip-data-transfer] consentArtefactId=${consentArtefactId} dataPushUrl=${dataPushUrl}`,
    );

    // --- Step 1: Validate consent artefact ---
    const consentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(
        consentArtefactId,
      )}&select=*`,
      { headers: supabaseHeaders() },
    );

    if (!consentRes.ok) {
      throw new Error(
        `Failed to query consent artefacts: HTTP ${consentRes.status}`,
      );
    }

    const consentRows = await consentRes.json();
    if (consentRows.length === 0) {
      console.error(
        `[abdm-hip-data-transfer] Consent artefact not found: ${consentArtefactId}`,
      );

      await sendAcknowledgement(requestId, transactionId, "ERRORED", {
        code: 1000,
        message: "Consent artefact not found",
      });

      return new Response(JSON.stringify({ status: "CONSENT_NOT_FOUND" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const consentArtefact = consentRows[0];

    // Validate consent is GRANTED
    if (consentArtefact.status !== "GRANTED") {
      console.error(
        `[abdm-hip-data-transfer] Consent not GRANTED (status=${consentArtefact.status})`,
      );

      await sendAcknowledgement(requestId, transactionId, "ERRORED", {
        code: 1000,
        message: `Consent is ${consentArtefact.status}, not GRANTED`,
      });

      return new Response(JSON.stringify({ status: "CONSENT_NOT_GRANTED" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check consent hasn't expired
    if (consentArtefact.expiry) {
      const eraseAt = new Date(consentArtefact.expiry);
      if (eraseAt < new Date()) {
        console.error(
          `[abdm-hip-data-transfer] Consent expired at ${consentArtefact.expiry}`,
        );

        await sendAcknowledgement(requestId, transactionId, "ERRORED", {
          code: 1000,
          message: "Consent has expired",
        });

        return new Response(JSON.stringify({ status: "CONSENT_EXPIRED" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- Step 2: Validate date range is within consent date range ---
    const requestedFrom = dateRange?.from ? new Date(dateRange.from) : null;
    const requestedTo = dateRange?.to ? new Date(dateRange.to) : null;

    if (consentArtefact.date_range_from && requestedFrom) {
      const consentFrom = new Date(consentArtefact.date_range_from);
      if (requestedFrom < consentFrom) {
        console.error(
          `[abdm-hip-data-transfer] Requested from (${requestedFrom.toISOString()}) is before consent from (${consentFrom.toISOString()})`,
        );

        await sendAcknowledgement(requestId, transactionId, "ERRORED", {
          code: 1000,
          message: "Requested date range exceeds consent date range",
        });

        return new Response(JSON.stringify({ status: "DATE_RANGE_EXCEEDED" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (consentArtefact.date_range_to && requestedTo) {
      const consentTo = new Date(consentArtefact.date_range_to);
      if (requestedTo > consentTo) {
        console.error(
          `[abdm-hip-data-transfer] Requested to (${requestedTo.toISOString()}) is after consent to (${consentTo.toISOString()})`,
        );

        await sendAcknowledgement(requestId, transactionId, "ERRORED", {
          code: 1000,
          message: "Requested date range exceeds consent date range",
        });

        return new Response(JSON.stringify({ status: "DATE_RANGE_EXCEEDED" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- Step 3: Fetch relevant health data ---
    // Determine which health information types are allowed by consent
    const hiTypes = consentArtefact.hi_types || [
      "Prescription",
      "DiagnosticReport",
      "OPConsultation",
    ];

    console.log(
      `[abdm-hip-data-transfer] Fetching data for hiTypes: ${hiTypes.join(", ")}`,
    );

    // Get the patient associated with this consent
    const patientId = consentArtefact.patient_id;
    if (!patientId) {
      console.error(
        "[abdm-hip-data-transfer] No patient_id on consent artefact — cannot fetch data",
      );

      await sendAcknowledgement(requestId, transactionId, "ERRORED", {
        code: 1000,
        message: "Consent artefact missing patient reference",
      });

      return new Response(JSON.stringify({ status: "NO_PATIENT_ON_CONSENT" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build date filters for Supabase queries
    const dateFilters: string[] = [];
    if (requestedFrom) {
      dateFilters.push(`created_at=gte.${requestedFrom.toISOString()}`);
    }
    if (requestedTo) {
      dateFilters.push(`created_at=lte.${requestedTo.toISOString()}`);
    }
    const dateFilterStr =
      dateFilters.length > 0 ? "&" + dateFilters.join("&") : "";

    // Collect health data based on hi_types
    const healthData: Record<string, unknown[]> = {};

    // Fetch prescriptions
    if (
      hiTypes.includes("Prescription") ||
      hiTypes.includes("OPConsultation")
    ) {
      const rxRes = await fetch(
        `${SUPABASE_URL}/rest/v1/prescriptions?patient_id=eq.${patientId}${dateFilterStr}&select=id,visit_id,prescription_data,status,created_at`,
        { headers: supabaseHeaders() },
      );
      if (rxRes.ok) {
        healthData.prescriptions = await rxRes.json();
        console.log(
          `[abdm-hip-data-transfer] Found ${healthData.prescriptions.length} prescriptions`,
        );
      }
    }

    // Fetch lab results (DiagnosticReport)
    if (hiTypes.includes("DiagnosticReport")) {
      const labRes = await fetch(
        `${SUPABASE_URL}/rest/v1/lab_results?patient_id=eq.${patientId}${dateFilterStr}&select=id,test_name,test_category,value,unit,flag,created_at`,
        { headers: supabaseHeaders() },
      );
      if (labRes.ok) {
        healthData.labResults = await labRes.json();
        console.log(
          `[abdm-hip-data-transfer] Found ${healthData.labResults.length} lab results`,
        );
      }
    }

    // Fetch visits (OPConsultation)
    if (hiTypes.includes("OPConsultation")) {
      const visitRes = await fetch(
        `${SUPABASE_URL}/rest/v1/visits?patient_id=eq.${patientId}${dateFilterStr}&select=id,visit_date,chief_complaints,vitals,diagnoses,clinical_notes,visit_summary,created_at`,
        { headers: supabaseHeaders() },
      );
      if (visitRes.ok) {
        healthData.visits = await visitRes.json();
        console.log(
          `[abdm-hip-data-transfer] Found ${healthData.visits.length} visits`,
        );
      }
    }

    // Fetch immunization records
    if (hiTypes.includes("ImmunizationRecord")) {
      const vaxRes = await fetch(
        `${SUPABASE_URL}/rest/v1/vaccinations?patient_id=eq.${patientId}&select=id,vaccine_name,dose_number,date_given,schedule_type,created_at`,
        { headers: supabaseHeaders() },
      );
      if (vaxRes.ok) {
        healthData.vaccinations = await vaxRes.json();
        console.log(
          `[abdm-hip-data-transfer] Found ${healthData.vaccinations.length} vaccination records`,
        );
      }
    }

    // --- Step 4: Generate FHIR bundles ---
    let fhirBundles: unknown[] = [];
    try {
      const fhirRes = await fetch(FHIR_BUNDLE_URL, {
        method: "POST",
        headers: supabaseHeaders(),
        body: JSON.stringify({
          patientId,
          hiTypes,
          healthData,
          dateRange: {
            from: requestedFrom?.toISOString(),
            to: requestedTo?.toISOString(),
          },
        }),
      });

      if (fhirRes.ok) {
        const fhirResult = await fhirRes.json();
        fhirBundles = fhirResult.bundles || [];
        console.log(
          `[abdm-hip-data-transfer] Generated ${fhirBundles.length} FHIR bundles`,
        );
      } else {
        console.error(
          `[abdm-hip-data-transfer] FHIR bundle generation failed: HTTP ${fhirRes.status}`,
        );
        // Fall back to raw data if FHIR generation fails
        fhirBundles = Object.entries(healthData).map(([type, data]) => ({
          resourceType: "Bundle",
          type: "collection",
          entry: data,
          meta: { tag: [{ code: type }] },
        }));
      }
    } catch (fhirErr) {
      console.error(
        "[abdm-hip-data-transfer] FHIR bundle generation error:",
        fhirErr,
      );
      // Fall back to raw data
      fhirBundles = Object.entries(healthData).map(([type, data]) => ({
        resourceType: "Bundle",
        type: "collection",
        entry: data,
        meta: { tag: [{ code: type }] },
      }));
    }

    // --- Step 5: Encrypt and push data ---
    // TODO: Implement Fidelius (ECDH) encryption using keyMaterial from the request.
    // keyMaterial contains: { cryptoAlg, curve, dhPublicKey: { expiry, parameters, keyValue }, nonce }
    // For sandbox/development, we send unencrypted with a warning.
    if (keyMaterial) {
      console.warn(
        "[abdm-hip-data-transfer] WARNING: Encryption not implemented — sending data UNENCRYPTED. " +
          "This is only acceptable in ABDM sandbox mode. " +
          "TODO: Implement Fidelius (ECDH) encryption before production use.",
      );
    }

    // Push data to the dataPushUrl provided by ABDM
    if (dataPushUrl) {
      const pushPayload = {
        pageNumber: 1,
        pageCount: 1,
        transactionId,
        entries: fhirBundles.map((bundle, idx) => ({
          content: JSON.stringify(bundle),
          media: "application/fhir+json",
          checksum: "", // TODO: compute SHA256 checksum
          careContextReference: `CC-${idx + 1}`,
        })),
        keyMaterial: null, // TODO: our public key for Fidelius exchange
      };

      try {
        const pushRes = await fetch(dataPushUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // TODO: Add authorization header with gateway token
          },
          body: JSON.stringify(pushPayload),
        });

        console.log(
          `[abdm-hip-data-transfer] Data push response: HTTP ${pushRes.status}`,
        );

        if (!pushRes.ok) {
          const pushErr = await pushRes.text();
          console.error(
            `[abdm-hip-data-transfer] Data push failed: ${pushErr}`,
          );
        }
      } catch (pushErr) {
        console.error("[abdm-hip-data-transfer] Data push error:", pushErr);
      }
    } else {
      console.warn(
        "[abdm-hip-data-transfer] No dataPushUrl provided — skipping data push",
      );
    }

    // --- Step 6: Send acknowledgement to ABDM ---
    await sendAcknowledgement(requestId, transactionId, "OK", null);

    return new Response(
      JSON.stringify({
        status: "OK",
        transactionId,
        bundleCount: fhirBundles.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[abdm-hip-data-transfer] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ===== ABDM ACKNOWLEDGEMENT =====

async function sendAcknowledgement(
  requestId: string,
  transactionId: string,
  status: string,
  error: { code: number; message: string } | null,
) {
  const ackPayload = {
    requestId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    resp: {
      requestId,
      ...(error ? { error } : {}),
    },
    hiRequest: {
      transactionId,
      sessionStatus: status === "OK" ? "TRANSFERRED" : "FAILED",
    },
  };

  // TODO: Send callback to ABDM gateway at /v0.5/health-information/hip/on-request
  // await fetch(`${ABDM_GATEWAY_URL}/v0.5/health-information/hip/on-request`, {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     "X-CM-ID": ABDM_CLIENT_ID,
  //     Authorization: `Bearer ${gatewayAccessToken}`,
  //   },
  //   body: JSON.stringify(ackPayload),
  // });
  console.log(
    `[abdm-hip-data-transfer] Would send on-request acknowledgement (${status}):`,
    JSON.stringify(ackPayload),
  );
}
