// Supabase Edge Function: abdm-hip-link
// ABDM HIP callback — Care Context Linking.
// ABDM gateway calls this when a patient confirms linking specific care contexts
// from Radhakishan Hospital to their ABHA account.
//
// Deploy: supabase functions deploy abdm-hip-link --project-ref ecywxuqhnlkjtdshpcbc

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
    const { requestId, timestamp, transactionId, patient } = body;

    console.log(
      `[abdm-hip-link] requestId=${requestId} transactionId=${transactionId}`,
    );

    if (!patient || !patient.referenceNumber || !patient.careContexts) {
      return new Response(
        JSON.stringify({
          requestId,
          error: {
            code: 1000,
            message: "Invalid request: missing patient or careContexts",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { id: abhaAddress, referenceNumber, careContexts } = patient;

    // --- Validate patient exists ---
    const patientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/patients?uhid=eq.${encodeURIComponent(
        referenceNumber,
      )}&is_active=eq.true&select=id,uhid,full_name`,
      { headers: supabaseHeaders() },
    );

    if (!patientRes.ok) {
      throw new Error(`Failed to query patients: HTTP ${patientRes.status}`);
    }

    const patients = await patientRes.json();
    if (patients.length === 0) {
      console.error(
        `[abdm-hip-link] Patient not found: referenceNumber=${referenceNumber}`,
      );

      const callbackPayload = {
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        resp: {
          requestId,
          error: {
            code: 1000,
            message: `Patient with reference ${referenceNumber} not found`,
          },
        },
      };
      // TODO: Send callback to ABDM gateway at /v0.5/links/link/on-add-contexts
      console.log(
        "[abdm-hip-link] Would send on-add-contexts callback:",
        JSON.stringify(callbackPayload),
      );

      return new Response(JSON.stringify({ status: "PATIENT_NOT_FOUND" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const matchedPatient = patients[0];
    console.log(
      `[abdm-hip-link] Patient found: ${matchedPatient.uhid} (${matchedPatient.full_name})`,
    );

    // --- Link each care context ---
    const linkedContexts: string[] = [];
    const failedContexts: string[] = [];

    for (const cc of careContexts) {
      const ccRef = cc.referenceNumber;

      // Verify care context exists for this patient
      const ccRes = await fetch(
        `${SUPABASE_URL}/rest/v1/abdm_care_contexts?patient_id=eq.${
          matchedPatient.id
        }&care_context_ref=eq.${encodeURIComponent(ccRef)}&select=id`,
        { headers: supabaseHeaders() },
      );

      if (!ccRes.ok) {
        console.error(`[abdm-hip-link] Failed to query care context: ${ccRef}`);
        failedContexts.push(ccRef);
        continue;
      }

      const ccRows = await ccRes.json();
      if (ccRows.length === 0) {
        console.warn(`[abdm-hip-link] Care context not found: ${ccRef}`);
        failedContexts.push(ccRef);
        continue;
      }

      // Update care context as linked
      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/abdm_care_contexts?id=eq.${ccRows[0].id}`,
        {
          method: "PATCH",
          headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            linked: true,
            linked_at: new Date().toISOString(),
          }),
        },
      );

      if (updateRes.ok) {
        console.log(`[abdm-hip-link] Linked care context: ${ccRef}`);
        linkedContexts.push(ccRef);
      } else {
        console.error(
          `[abdm-hip-link] Failed to update care context ${ccRef}: HTTP ${updateRes.status}`,
        );
        failedContexts.push(ccRef);
      }
    }

    // Build ABDM on-add-contexts callback payload
    const acknowledgement = {
      status: failedContexts.length === 0 ? "SUCCESS" : "PARTIAL",
      linkedContexts,
      failedContexts,
    };

    const callbackPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      resp: {
        requestId,
        patient: {
          referenceNumber,
          careContexts: linkedContexts.map((ref) => ({
            referenceNumber: ref,
          })),
        },
      },
    };

    // TODO: Send callback to ABDM gateway at /v0.5/links/link/on-add-contexts
    // await fetch(`${ABDM_GATEWAY_URL}/v0.5/links/link/on-add-contexts`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "X-CM-ID": ABDM_CLIENT_ID,
    //     Authorization: `Bearer ${gatewayAccessToken}`,
    //   },
    //   body: JSON.stringify(callbackPayload),
    // });
    console.log(
      "[abdm-hip-link] Would send on-add-contexts callback:",
      JSON.stringify(callbackPayload),
    );

    return new Response(JSON.stringify(acknowledgement), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[abdm-hip-link] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
