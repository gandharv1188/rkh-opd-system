// Supabase Edge Function: abdm-hip-discover
// ABDM HIP callback — Patient Discovery.
// ABDM gateway calls this when another system wants to discover if a patient
// exists at Radhakishan Hospital and retrieve their care contexts.
//
// Deploy: supabase functions deploy abdm-hip-discover --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const ABDM_GATEWAY_URL =
  Deno.env.get("ABDM_GATEWAY_URL") || "https://dev.abdm.gov.in";
const ABDM_CLIENT_ID = Deno.env.get("ABDM_CLIENT_ID") || "";
const ABDM_CLIENT_SECRET = Deno.env.get("ABDM_CLIENT_SECRET") || "";

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
// For now, we only check that the request has expected headers.
function validateGatewayRequest(req: Request): boolean {
  // ABDM gateway sends X-HIP-ID header with the HIP's registered ID
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
    const { requestId, timestamp, transactionId, patient } = body;

    console.log(
      `[abdm-hip-discover] requestId=${requestId} transactionId=${transactionId}`,
    );

    if (!patient) {
      return new Response(
        JSON.stringify({
          requestId,
          error: { code: 1000, message: "Invalid request: missing patient" },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const {
      verifiedIdentifiers,
      unverifiedIdentifiers,
      name,
      gender,
      yearOfBirth,
    } = patient;

    // --- Strategy 1: Search by ABHA number (verified identifier) ---
    let matchedPatient: Record<string, unknown> | null = null;

    if (verifiedIdentifiers && verifiedIdentifiers.length > 0) {
      for (const identifier of verifiedIdentifiers) {
        if (
          identifier.type === "HEALTH_NUMBER" ||
          identifier.type === "HEALTH_ID"
        ) {
          const abhaValue = identifier.value;
          console.log(`[abdm-hip-discover] Searching by ABHA: ${abhaValue}`);

          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/patients?abha_number=eq.${encodeURIComponent(
              abhaValue,
            )}&is_active=eq.true&select=id,uhid,full_name,date_of_birth,sex`,
            { headers: supabaseHeaders() },
          );

          if (res.ok) {
            const rows = await res.json();
            if (rows.length > 0) {
              matchedPatient = rows[0];
              break;
            }
          }
        }
      }
    }

    // --- Strategy 2: Demographic match (name + gender + year of birth) ---
    if (!matchedPatient && name && gender && yearOfBirth) {
      console.log(
        `[abdm-hip-discover] Searching by demographics: name=${name}, gender=${gender}, yob=${yearOfBirth}`,
      );

      // Map ABDM gender to our schema
      const genderMap: Record<string, string> = {
        M: "Male",
        F: "Female",
        O: "Other",
        U: "Unknown",
      };
      const mappedGender = genderMap[gender] || gender;

      // Search by name (case-insensitive) and year of birth
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/patients?full_name=ilike.%25${encodeURIComponent(
          name,
        )}%25&sex=eq.${encodeURIComponent(
          mappedGender,
        )}&is_active=eq.true&select=id,uhid,full_name,date_of_birth,sex`,
        { headers: supabaseHeaders() },
      );

      if (res.ok) {
        const rows = await res.json();
        // Filter by year of birth
        const matches = rows.filter((p: Record<string, string>) => {
          if (!p.date_of_birth) return false;
          return new Date(p.date_of_birth).getFullYear() === yearOfBirth;
        });

        if (matches.length === 1) {
          matchedPatient = matches[0];
        } else if (matches.length > 1) {
          console.warn(
            `[abdm-hip-discover] Multiple demographic matches (${matches.length}), cannot disambiguate`,
          );
          // Return error — cannot uniquely identify patient
          const callbackPayload = {
            requestId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            resp: {
              requestId,
              error: {
                code: 1000,
                message: "Multiple patients matched — cannot disambiguate",
              },
            },
          };
          // TODO: Send callback to ABDM gateway at /v0.5/care-contexts/on-discover
          console.log(
            "[abdm-hip-discover] Would send on-discover callback:",
            JSON.stringify(callbackPayload),
          );

          return new Response(JSON.stringify({ status: "MULTIPLE_MATCH" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // --- No match found ---
    if (!matchedPatient) {
      console.log("[abdm-hip-discover] No patient match found");

      const callbackPayload = {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        resp: {
          requestId,
          error: {
            code: 1000,
            message: "No matching patient found at this HIP",
          },
        },
      };
      // TODO: Send callback to ABDM gateway at /v0.5/care-contexts/on-discover
      console.log(
        "[abdm-hip-discover] Would send on-discover callback:",
        JSON.stringify(callbackPayload),
      );

      return new Response(JSON.stringify({ status: "NO_MATCH" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Patient found — fetch care contexts ---
    console.log(
      `[abdm-hip-discover] Matched patient: ${matchedPatient.uhid} (${matchedPatient.full_name})`,
    );

    const ccRes = await fetch(
      `${SUPABASE_URL}/rest/v1/abdm_care_contexts?patient_id=eq.${matchedPatient.id}&select=care_context_ref,display_text,record_types`,
      { headers: supabaseHeaders() },
    );

    let careContexts: Array<{ referenceNumber: string; display: string }> = [];
    if (ccRes.ok) {
      const ccRows = await ccRes.json();
      careContexts = ccRows.map(
        (cc: { care_context_ref: string; display_text: string }) => ({
          referenceNumber: cc.care_context_ref,
          display: cc.display_text,
        }),
      );
    }

    // Build ABDM on-discover callback payload
    const callbackPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      transactionId,
      resp: {
        requestId,
        patient: {
          referenceNumber: matchedPatient.uhid,
          display: matchedPatient.full_name as string,
          careContexts,
          matchedBy:
            verifiedIdentifiers?.length > 0
              ? ["HEALTH_NUMBER"]
              : ["DEMOGRAPHIC"],
        },
      },
    };

    // TODO: Send callback to ABDM gateway at /v0.5/care-contexts/on-discover
    // await fetch(`${ABDM_GATEWAY_URL}/v0.5/care-contexts/on-discover`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "X-CM-ID": ABDM_CLIENT_ID,
    //     Authorization: `Bearer ${gatewayAccessToken}`,
    //   },
    //   body: JSON.stringify(callbackPayload),
    // });
    console.log(
      "[abdm-hip-discover] Would send on-discover callback:",
      JSON.stringify(callbackPayload),
    );

    return new Response(
      JSON.stringify({
        status: "MATCHED",
        patient: callbackPayload.resp.patient,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[abdm-hip-discover] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
