// Supabase Edge Function: abdm-hiu-consent-request
// HIU (Health Information User) — Initiates consent requests to fetch patient
// health records from OTHER hospitals/facilities via ABDM.
//
// The doctor on the Prescription Pad can request records (OPConsultation,
// Prescription, DiagnosticReport, etc.) for an ABHA-linked patient.
//
// TODO: Full ABDM V3 gateway integration for consent request flow:
//   1. Authenticate with ABDM gateway (client credentials)
//   2. POST /v3/consent-requests/init with consent request payload
//   3. Receive consent request ID from ABDM
//   4. ABDM notifies patient via PHR app for consent approval
//   5. On approval, ABDM calls back with consent artefact
//   6. Use consent artefact to request health data (see abdm-hiu-data-receive)
//
// Current: STUB — Creates a consent record in abdm_consent_artefacts table
//          with status "REQUESTED" and returns the consent request ID.
//
// Deploy: supabase functions deploy abdm-hiu-consent-request --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

// TODO: Set via `supabase secrets set ABDM_GATEWAY_URL=https://live.abdm.gov.in --project-ref ecywxuqhnlkjtdshpcbc`
// Sandbox: https://dev.abdm.gov.in  |  Production: https://live.abdm.gov.in
const ABDM_GATEWAY_URL =
  Deno.env.get("ABDM_GATEWAY_URL") || "https://dev.abdm.gov.in";

// TODO: Set via `supabase secrets set ABDM_CLIENT_ID=xxx ABDM_CLIENT_SECRET=xxx --project-ref ecywxuqhnlkjtdshpcbc`
const ABDM_CLIENT_ID = Deno.env.get("ABDM_CLIENT_ID") || "";
const ABDM_CLIENT_SECRET = Deno.env.get("ABDM_CLIENT_SECRET") || "";

// HIU ID assigned by ABDM during facility registration
const HIU_ID = Deno.env.get("ABDM_HIU_ID") || "radhakishan-hospital-hiu";
const HIU_NAME = "Radhakishan Hospital, Kurukshetra";

// Valid Health Information types per ABDM spec
const VALID_HI_TYPES = [
  "OPConsultation",
  "Prescription",
  "DiagnosticReport",
  "DischargeSummary",
  "ImmunizationRecord",
  "HealthDocumentRecord",
  "WellnessRecord",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===== HELPERS =====

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Generate a UUID v4 for consent request ID */
function generateUUID(): string {
  return crypto.randomUUID();
}

/** Validate ABHA number format: 14 digits, with or without hyphens */
function validateAbhaFormat(abhaNumber: string): {
  valid: boolean;
  normalized: string;
} {
  const digits = abhaNumber.replace(/-/g, "");
  if (!/^\d{14}$/.test(digits)) {
    return { valid: false, normalized: "" };
  }
  const normalized = `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
  return { valid: true, normalized };
}

/** Make a Supabase REST API call */
async function supabaseRest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const { method = "GET", body, headers = {} } = options;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * TODO: Obtain ABDM gateway access token using client credentials.
 *
 * POST ${ABDM_GATEWAY_URL}/v3/gateway/sessions
 * Body: { clientId, clientSecret, grantType: "client_credentials" }
 * Returns: { accessToken, expiresIn }
 *
 * Should cache token until expiry.
 */
async function _getAbdmAccessToken(): Promise<string> {
  // TODO: Implement real token fetch from ABDM gateway
  // const res = await fetch(`${ABDM_GATEWAY_URL}/v3/gateway/sessions`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({
  //     clientId: ABDM_CLIENT_ID,
  //     clientSecret: ABDM_CLIENT_SECRET,
  //     grantType: "client_credentials",
  //   }),
  // });
  // const data = await res.json();
  // return data.accessToken;
  console.warn("STUB: Using empty ABDM access token");
  return "";
}

// ===== MAIN HANDLER =====

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
    }

    const body = await req.json();

    // ===== VALIDATE INPUT =====

    const patientId = body.patient_id as string;
    const abhaNumber = body.abha_number as string;
    const purpose = (body.purpose as string) || "CAREMGT";
    const hiTypes = (body.hi_types as string[]) || [
      "OPConsultation",
      "Prescription",
      "DiagnosticReport",
    ];
    const dateRangeFrom = body.date_range_from as string;
    const dateRangeTo = body.date_range_to as string;

    if (!patientId) {
      return jsonResponse({ error: "patient_id is required" }, 400);
    }

    if (!abhaNumber) {
      return jsonResponse({ error: "abha_number is required" }, 400);
    }

    const { valid, normalized } = validateAbhaFormat(abhaNumber);
    if (!valid) {
      return jsonResponse(
        {
          error:
            "Invalid ABHA number format. Expected 14 digits (e.g., 91-1234-5678-9012)",
        },
        400,
      );
    }

    // Validate HI types
    const invalidTypes = hiTypes.filter((t) => !VALID_HI_TYPES.includes(t));
    if (invalidTypes.length > 0) {
      return jsonResponse(
        {
          error: `Invalid hi_types: ${invalidTypes.join(", ")}. Valid types: ${VALID_HI_TYPES.join(", ")}`,
        },
        400,
      );
    }

    // Validate purpose — ABDM supports: CAREMGT, BTG, PUBHLTH, HPAYMT, DSRCH
    const validPurposes = ["CAREMGT", "BTG", "PUBHLTH", "HPAYMT", "DSRCH"];
    if (!validPurposes.includes(purpose)) {
      return jsonResponse(
        {
          error: `Invalid purpose: ${purpose}. Valid: ${validPurposes.join(", ")}`,
        },
        400,
      );
    }

    // Default date range: last 1 year if not provided
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const fromDate = dateRangeFrom || oneYearAgo.toISOString().split("T")[0];
    const toDate = dateRangeTo || now.toISOString().split("T")[0];

    // ===== BUILD ABDM CONSENT REQUEST PAYLOAD =====

    const consentRequestId = generateUUID();
    const timestamp = new Date().toISOString();

    // ABDM V3 Consent Request payload structure
    const _abdmPayload = {
      requestId: generateUUID(),
      timestamp,
      consent: {
        purpose: {
          text: purpose === "CAREMGT" ? "Care Management" : purpose,
          code: purpose,
        },
        patient: {
          id: normalized.replace(/-/g, "") + "@sbx", // TODO: Use correct ABDM patient ID suffix
        },
        hiu: {
          id: HIU_ID,
        },
        requester: {
          name: HIU_NAME,
          identifier: {
            type: "REGNO",
            value: HIU_ID,
            system: "https://www.mciindia.org",
          },
        },
        hiTypes,
        permission: {
          accessMode: "VIEW",
          dateRange: {
            from: `${fromDate}T00:00:00.000Z`,
            to: `${toDate}T23:59:59.999Z`,
          },
          dataEraseAt: new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(), // 30 days from now
          frequency: {
            unit: "HOUR",
            value: 1,
            repeats: 0,
          },
        },
      },
    };

    // ===== TODO: SEND TO ABDM GATEWAY =====

    // TODO: Uncomment when ABDM sandbox credentials are configured
    // const accessToken = await _getAbdmAccessToken();
    // const abdmRes = await fetch(
    //   `${ABDM_GATEWAY_URL}/v3/consent-requests/init`,
    //   {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       Authorization: `Bearer ${accessToken}`,
    //       "X-CM-ID": "sbx", // TODO: Use correct CM ID for production
    //     },
    //     body: JSON.stringify(_abdmPayload),
    //   },
    // );
    //
    // if (!abdmRes.ok) {
    //   const errText = await abdmRes.text();
    //   console.error("ABDM consent request failed:", errText);
    //   return jsonResponse(
    //     {
    //       success: false,
    //       error: "ABDM gateway rejected consent request",
    //       details: errText,
    //     },
    //     502,
    //   );
    // }
    //
    // const abdmData = await abdmRes.json();
    // Use abdmData.consentRequest.id as the real consent request ID

    // ===== STORE CONSENT REQUEST IN SUPABASE =====

    const consentRecord = {
      consent_id: consentRequestId,
      patient_id: patientId,
      purpose,
      hi_types: hiTypes,
      date_range_from: fromDate,
      date_range_to: toDate,
      status: "REQUESTED",
      expiry: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      artefact_json: {
        abha_number: normalized,
        requested_at: timestamp,
      },
    };

    const insertRes = await supabaseRest("abdm_consent_artefacts", {
      method: "POST",
      body: consentRecord,
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error("Failed to store consent request:", errText);
      return jsonResponse(
        {
          success: false,
          error: "Failed to store consent request record",
          details: errText,
        },
        500,
      );
    }

    const savedRecords = await insertRes.json();

    // ===== RETURN RESULT =====

    return jsonResponse({
      success: true,
      consent_request_id: consentRequestId,
      status: "REQUESTED",
      patient_id: patientId,
      abha_number: normalized,
      hi_types: hiTypes,
      date_range: { from: fromDate, to: toDate },
      record: savedRecords[0] || consentRecord,
      message:
        "STUB: Consent request created locally. Real ABDM gateway integration pending. " +
        "In production, ABDM will notify the patient via their PHR app for consent approval.",
      _gateway_url: ABDM_GATEWAY_URL,
      _stub: true,
    });
  } catch (err) {
    console.error("abdm-hiu-consent-request error:", err);
    return jsonResponse(
      { error: "Internal server error", details: String(err) },
      500,
    );
  }
});
