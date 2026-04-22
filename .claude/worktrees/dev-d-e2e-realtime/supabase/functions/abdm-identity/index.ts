// Supabase Edge Function: abdm-identity
// Handles ABHA (Ayushman Bharat Health Account) identity operations:
//   - verify-abha: Verify an ABHA number and fetch patient profile
//   - create-abha: Create a new ABHA via Aadhaar OTP flow
//   - profile-share: Handle Scan & Share callback from ABDM
//   - link-care-context: Link a care context (visit/episode) with ABDM
//
// Deploy: supabase functions deploy abdm-identity --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

// TODO: Set via `supabase secrets set ABDM_GATEWAY_URL=https://live.abdm.gov.in --project-ref ecywxuqhnlkjtdshpcbc`
// Sandbox: https://dev.abdm.gov.in  |  Production: https://live.abdm.gov.in
const ABDM_GATEWAY_URL =
  Deno.env.get("ABDM_GATEWAY_URL") || "https://dev.abdm.gov.in";

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

/** Validate ABHA number format: 14 digits, with or without hyphens (XX-XXXX-XXXX-XXXX) */
function validateAbhaFormat(abhaNumber: string): {
  valid: boolean;
  normalized: string;
} {
  const digits = abhaNumber.replace(/-/g, "");
  if (!/^\d{14}$/.test(digits)) {
    return { valid: false, normalized: "" };
  }
  // Normalize to XX-XXXX-XXXX-XXXX format
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
      Prefer: method === "PATCH" ? "return=minimal" : "return=representation",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ===== ACTION HANDLERS =====

/**
 * verify-abha: Verify an ABHA number and return patient profile.
 *
 * TODO: Real ABDM V3 integration steps:
 *   1. POST ${ABDM_GATEWAY_URL}/v3/hip/patient/verify with ABHA number
 *   2. Receive patient profile + linking token from ABDM
 *   3. Store linking token for care context linking
 *   4. Match/create patient in our system
 *
 * Current: STUB — validates format, returns mock profile, updates patients table.
 */
async function handleVerifyAbha(
  body: Record<string, unknown>,
): Promise<Response> {
  const abhaNumber = body.abha_number as string;
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

  // TODO: Replace mock with real ABDM V3 API call
  // const abdmRes = await fetch(`${ABDM_GATEWAY_URL}/v3/hip/patient/verify`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json", Authorization: `Bearer ${abdmAccessToken}` },
  //   body: JSON.stringify({ abha_number: normalized }),
  // });

  const mockProfile = {
    abha_number: normalized,
    abha_address: `${normalized.replace(/-/g, "")}@abdm`,
    name: "ABDM Verified Patient",
    gender: "U",
    year_of_birth: 2020,
    mobile: "9999999999",
    address: {
      line: "Kurukshetra",
      district: "Kurukshetra",
      state: "Haryana",
      pincode: "136118",
    },
    verified: true,
    _stub: true, // Flag indicating this is mock data
  };

  // If patient_id provided, update their record with ABHA verification status
  const patientId = body.patient_id as string | undefined;
  if (patientId) {
    // TODO: Also store linking_token from ABDM response
    const patchRes = await supabaseRest(
      `patients?id=eq.${encodeURIComponent(patientId)}`,
      {
        method: "PATCH",
        body: {
          abha_number: normalized,
          abha_verified: true,
        },
      },
    );
    if (!patchRes.ok) {
      console.error(
        "Failed to update patient ABHA status:",
        await patchRes.text(),
      );
      // Non-fatal — still return the profile
    }
  }

  return jsonResponse({
    success: true,
    profile: mockProfile,
    message:
      "STUB: ABHA verification simulated. Real ABDM integration pending.",
  });
}

/**
 * create-abha: Create a new ABHA number for a patient.
 *
 * TODO: Real ABDM V3 integration steps:
 *   1. POST ${ABDM_GATEWAY_URL}/v3/enrollment/request/otp — send Aadhaar OTP
 *   2. POST ${ABDM_GATEWAY_URL}/v3/enrollment/auth/byAadhaar — verify OTP
 *   3. POST ${ABDM_GATEWAY_URL}/v3/enrollment/enrol/byAadhaar — create ABHA
 *   4. Receive ABHA number + profile
 *   5. Store in patients table
 *
 * Current: Returns not-implemented response.
 */
async function handleCreateAbha(
  _body: Record<string, unknown>,
): Promise<Response> {
  // TODO: Implement ABDM V3 Aadhaar OTP flow for ABHA creation
  return jsonResponse(
    {
      success: false,
      error: "not_implemented",
      message:
        "ABHA creation via Aadhaar OTP is not yet implemented. Requires ABDM sandbox credentials.",
      gateway_url: ABDM_GATEWAY_URL,
    },
    501,
  );
}

/**
 * profile-share: Handle Scan & Share callback from ABDM.
 * When a patient scans the hospital's QR code in their PHR app,
 * ABDM sends the patient's profile to this endpoint.
 *
 * TODO: Real ABDM V3 integration steps:
 *   1. Receive patient profile from ABDM callback
 *   2. Validate the request signature/token
 *   3. Match patient by ABHA number in our patients table
 *   4. If no match, create a new patient or queue for manual review
 *   5. Auto-fill registration form with received demographics
 *
 * Current: Returns not-implemented response.
 */
async function handleProfileShare(
  _body: Record<string, unknown>,
): Promise<Response> {
  // TODO: Implement ABDM Scan & Share profile callback handler
  return jsonResponse(
    {
      success: false,
      error: "not_implemented",
      message:
        "Scan & Share profile callback is not yet implemented. Requires ABDM HIP registration.",
      gateway_url: ABDM_GATEWAY_URL,
    },
    501,
  );
}

/**
 * link-care-context: Link a visit/episode as a care context with ABDM.
 * This allows the patient to access their health records from this visit
 * via any PHR app connected to ABDM.
 *
 * TODO: Real ABDM V3 integration steps:
 *   1. POST ${ABDM_GATEWAY_URL}/v3/hip/patient/care-context/link with linking_token
 *   2. Include care_context_ref (our visit ID) and display name
 *   3. Receive acknowledgement from ABDM
 *   4. Mark care context as linked in our table
 *
 * Current: STUB — marks care context as linked in abdm_care_contexts table.
 */
async function handleLinkCareContext(
  body: Record<string, unknown>,
): Promise<Response> {
  const patientId = body.patient_id as string;
  const careContextRef = body.care_context_ref as string;
  const linkingToken = body.linking_token as string;

  if (!patientId || !careContextRef) {
    return jsonResponse(
      { error: "patient_id and care_context_ref are required" },
      400,
    );
  }

  // TODO: Replace with real ABDM V3 care context linking API call
  // const abdmRes = await fetch(`${ABDM_GATEWAY_URL}/v3/hip/patient/care-context/link`, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json", Authorization: `Bearer ${abdmAccessToken}` },
  //   body: JSON.stringify({
  //     linking_token: linkingToken,
  //     care_contexts: [{ reference_number: careContextRef, display: `Visit ${careContextRef}` }],
  //   }),
  // });

  // Upsert care context record in our table
  const upsertRes = await supabaseRest("abdm_care_contexts", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: {
      patient_id: patientId,
      care_context_ref: careContextRef,
      linked: true,
      linked_at: new Date().toISOString(),
    },
  });

  if (!upsertRes.ok) {
    const errText = await upsertRes.text();
    console.error("Failed to upsert care context:", errText);
    return jsonResponse(
      {
        success: false,
        error: "Failed to save care context link",
        details: errText,
      },
      500,
    );
  }

  return jsonResponse({
    success: true,
    care_context_ref: careContextRef,
    linked: true,
    message:
      "STUB: Care context marked as linked locally. Real ABDM linking pending.",
  });
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
    const action = body.action as string;

    if (!action) {
      return jsonResponse(
        {
          error:
            "Missing 'action' field. Supported: verify-abha, create-abha, profile-share, link-care-context",
        },
        400,
      );
    }

    switch (action) {
      case "verify-abha":
        return await handleVerifyAbha(body);
      case "create-abha":
        return await handleCreateAbha(body);
      case "profile-share":
        return await handleProfileShare(body);
      case "link-care-context":
        return await handleLinkCareContext(body);
      default:
        return jsonResponse(
          {
            error: `Unknown action: '${action}'. Supported: verify-abha, create-abha, profile-share, link-care-context`,
          },
          400,
        );
    }
  } catch (err) {
    console.error("abdm-identity error:", err);
    return jsonResponse(
      { error: "Internal server error", details: String(err) },
      500,
    );
  }
});
