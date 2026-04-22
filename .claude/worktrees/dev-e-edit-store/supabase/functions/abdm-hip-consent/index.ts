// Supabase Edge Function: abdm-hip-consent
// ABDM HIP callback — Consent Notification Handler.
// ABDM gateway calls this when a patient grants, denies, or revokes consent
// for sharing their health data from Radhakishan Hospital.
//
// Deploy: supabase functions deploy abdm-hip-consent --project-ref ecywxuqhnlkjtdshpcbc

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
    const { requestId, timestamp, notification } = body;

    console.log(`[abdm-hip-consent] requestId=${requestId}`);

    if (!notification) {
      return new Response(
        JSON.stringify({
          requestId,
          error: {
            code: 1000,
            message: "Invalid request: missing notification",
          },
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { consentRequestId, status, consentArtefacts } = notification;

    console.log(
      `[abdm-hip-consent] consentRequestId=${consentRequestId} status=${status} artefacts=${
        consentArtefacts?.length || 0
      }`,
    );

    // --- Handle based on consent status ---

    if (status === "GRANTED" && consentArtefacts) {
      for (const artefact of consentArtefacts) {
        const artefactId = artefact.id;
        console.log(
          `[abdm-hip-consent] Processing GRANTED artefact: ${artefactId}`,
        );

        // TODO: Fetch the full consent artefact from ABDM gateway
        // GET /v0.5/consents/fetch with artefactId
        // The full artefact contains: purpose, patient, hip, hiTypes, permission (dateRange, frequency, dataEraseAt)
        // For now, store a placeholder record

        // Store consent artefact in our table
        const insertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts`,
          {
            method: "POST",
            headers: { ...supabaseHeaders(), Prefer: "return=representation" },
            body: JSON.stringify({
              consent_id: artefactId,
              status: "GRANTED",
              artefact_json: {
                consent_request_id: consentRequestId,
                granted_at: new Date().toISOString(),
              },
              // TODO: Populate these from the full artefact fetch:
              // patient_id, hi_types, date_range_from, date_range_to,
              // expiry, purpose, requester_name
            }),
          },
        );

        if (insertRes.ok) {
          console.log(
            `[abdm-hip-consent] Stored consent artefact: ${artefactId}`,
          );
        } else {
          const errText = await insertRes.text();
          // May be a duplicate — try update instead
          if (insertRes.status === 409) {
            console.log(
              `[abdm-hip-consent] Artefact ${artefactId} already exists, updating status`,
            );
            await fetch(
              `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(
                artefactId,
              )}`,
              {
                method: "PATCH",
                headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
                body: JSON.stringify({
                  status: "GRANTED",
                  artefact_json: {
                    consent_request_id: consentRequestId,
                    granted_at: new Date().toISOString(),
                  },
                }),
              },
            );
          } else {
            console.error(
              `[abdm-hip-consent] Failed to store artefact ${artefactId}: ${errText}`,
            );
          }
        }
      }
    } else if (status === "DENIED") {
      console.log(
        `[abdm-hip-consent] Consent DENIED for request: ${consentRequestId}`,
      );

      // Update any existing artefacts for this consent request
      await fetch(
        `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(
          consentRequestId,
        )}`,
        {
          method: "PATCH",
          headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "DENIED",
          }),
        },
      );
    } else if (status === "REVOKED") {
      console.log(
        `[abdm-hip-consent] Consent REVOKED for request: ${consentRequestId}`,
      );

      if (consentArtefacts) {
        for (const artefact of consentArtefacts) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(
              artefact.id,
            )}`,
            {
              method: "PATCH",
              headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
              body: JSON.stringify({
                status: "REVOKED",
              }),
            },
          );
          console.log(`[abdm-hip-consent] Revoked artefact: ${artefact.id}`);
        }
      }

      // Also mark by consent_id
      await fetch(
        `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(
          consentRequestId,
        )}&status=eq.GRANTED`,
        {
          method: "PATCH",
          headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "REVOKED",
          }),
        },
      );
    } else if (status === "EXPIRED") {
      console.log(
        `[abdm-hip-consent] Consent EXPIRED for request: ${consentRequestId}`,
      );

      await fetch(
        `${SUPABASE_URL}/rest/v1/abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(
          consentRequestId,
        )}`,
        {
          method: "PATCH",
          headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "EXPIRED",
          }),
        },
      );
    }

    // --- Send acknowledgement to ABDM ---
    const ackPayload = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      resp: {
        requestId,
      },
    };

    // TODO: Send callback to ABDM gateway at /v0.5/consents/hip/on-notify
    // await fetch(`${ABDM_GATEWAY_URL}/v0.5/consents/hip/on-notify`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "X-CM-ID": ABDM_CLIENT_ID,
    //     Authorization: `Bearer ${gatewayAccessToken}`,
    //   },
    //   body: JSON.stringify(ackPayload),
    // });
    console.log(
      "[abdm-hip-consent] Would send on-notify acknowledgement:",
      JSON.stringify(ackPayload),
    );

    return new Response(
      JSON.stringify({
        status: "OK",
        consentRequestId,
        consentStatus: status,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[abdm-hip-consent] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
