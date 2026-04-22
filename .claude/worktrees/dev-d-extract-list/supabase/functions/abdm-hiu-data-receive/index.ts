// Supabase Edge Function: abdm-hiu-data-receive
// HIU (Health Information User) — Receives encrypted health data from other
// HIPs (Health Information Providers) after patient consent is granted.
//
// Flow:
//   1. Doctor initiates consent request (abdm-hiu-consent-request)
//   2. Patient approves consent via PHR app
//   3. ABDM calls back with consent artefact (on-notify)
//   4. Our system requests data from HIP using consent artefact
//   5. HIP sends encrypted FHIR bundles to THIS endpoint
//   6. We decrypt and store/display the records
//
// TODO: Full ABDM V3 gateway integration:
//   - Implement Fidelius (ECDH) decryption for production encrypted payloads
//   - Handle /v3/hiu/health-information/on-request callback
//   - Validate request signatures from ABDM gateway
//   - Implement data request initiation (POST /v3/health-information/cm/request)
//
// Current: STUB — Accepts data payloads, attempts to parse FHIR bundles,
//          stores received records in Supabase Storage, and updates consent status.
//
// Deploy: supabase functions deploy abdm-hiu-data-receive --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

// TODO: Set via `supabase secrets set ABDM_GATEWAY_URL=https://live.abdm.gov.in --project-ref ecywxuqhnlkjtdshpcbc`
const ABDM_GATEWAY_URL =
  Deno.env.get("ABDM_GATEWAY_URL") || "https://dev.abdm.gov.in";

const STORAGE_BUCKET = "documents"; // Reuse existing documents bucket for received records

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

/** Make a Supabase REST API call */
async function supabaseRest(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown> | Record<string, unknown>[];
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
      Prefer:
        method === "POST"
          ? "return=representation"
          : method === "PATCH"
            ? "return=minimal"
            : "",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Upload a file to Supabase Storage */
async function uploadToStorage(
  bucket: string,
  path: string,
  content: string,
  contentType = "application/json",
): Promise<{ success: boolean; error?: string }> {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: content,
  });

  if (!res.ok) {
    const errText = await res.text();
    return { success: false, error: errText };
  }
  return { success: true };
}

/**
 * TODO: Decrypt ABDM health data using Fidelius (ECDH).
 *
 * ABDM encrypts health data using Elliptic Curve Diffie-Hellman (ECDH)
 * with Curve25519. The decryption requires:
 *   - Our private key (generated during data request)
 *   - Sender's public key (from keyMaterial.dhPublicKey)
 *   - Random nonce (from keyMaterial.nonce)
 *
 * Libraries: node-forge or WebCrypto API for ECDH
 *
 * Steps:
 *   1. Derive shared secret using our private key + sender's public key
 *   2. Generate AES key from shared secret + nonces
 *   3. Decrypt content using AES-GCM
 *   4. Result is a FHIR Bundle JSON string
 *
 * @param encryptedContent - Base64 encoded encrypted content
 * @param keyMaterial - ABDM key material with dhPublicKey, nonce, etc.
 * @returns Decrypted content string (FHIR Bundle JSON)
 */
function _decryptFidelius(
  _encryptedContent: string,
  _keyMaterial: Record<string, unknown>,
): string | null {
  // TODO: Implement Fidelius (ECDH Curve25519) decryption
  // For sandbox, data may arrive unencrypted or with test keys
  console.warn(
    "STUB: Fidelius decryption not implemented. Attempting to parse as plain text.",
  );
  return null;
}

/**
 * Parse a FHIR Bundle and extract human-readable clinical data.
 * Returns a simplified summary for display in the Prescription Pad.
 */
function parseFhirBundle(bundle: Record<string, unknown>): {
  resourceType: string;
  entries: Record<string, unknown>[];
  summary: string[];
} {
  const entries: Record<string, unknown>[] = [];
  const summary: string[] = [];

  if (bundle.resourceType !== "Bundle") {
    return {
      resourceType: String(bundle.resourceType || "Unknown"),
      entries: [bundle],
      summary: ["Non-Bundle FHIR resource received"],
    };
  }

  const bundleEntries =
    (bundle.entry as Array<{ resource?: Record<string, unknown> }>) || [];

  for (const entry of bundleEntries) {
    const resource = entry.resource;
    if (!resource) continue;

    entries.push(resource);
    const resType = resource.resourceType as string;

    // Extract human-readable summaries based on resource type
    switch (resType) {
      case "Condition": {
        const code = resource.code as Record<string, unknown> | undefined;
        const coding = (code?.coding as Array<Record<string, string>>) || [];
        const display = coding[0]?.display || code?.text || "Unknown condition";
        summary.push(`Dx: ${display}`);
        break;
      }
      case "MedicationRequest": {
        const medCode = resource.medicationCodeableConcept as Record<
          string,
          unknown
        >;
        const medCoding =
          (medCode?.coding as Array<Record<string, string>>) || [];
        const medName =
          medCoding[0]?.display || medCode?.text || "Unknown medication";
        summary.push(`Rx: ${medName}`);
        break;
      }
      case "DiagnosticReport": {
        const drCode = resource.code as Record<string, unknown> | undefined;
        const drCoding =
          (drCode?.coding as Array<Record<string, string>>) || [];
        const drDisplay =
          drCoding[0]?.display || drCode?.text || "Unknown report";
        summary.push(`Lab: ${drDisplay}`);
        break;
      }
      case "Observation": {
        const obsCode = resource.code as Record<string, unknown> | undefined;
        const obsCoding =
          (obsCode?.coding as Array<Record<string, string>>) || [];
        const obsDisplay =
          obsCoding[0]?.display || obsCode?.text || "Observation";
        const value = resource.valueQuantity as Record<string, unknown>;
        const valStr = value
          ? `${value.value} ${value.unit || ""}`
          : String(resource.valueString || "");
        summary.push(`Obs: ${obsDisplay} = ${valStr}`);
        break;
      }
      case "Immunization": {
        const vaccCode = resource.vaccineCode as
          | Record<string, unknown>
          | undefined;
        const vaccCoding =
          (vaccCode?.coding as Array<Record<string, string>>) || [];
        const vaccDisplay =
          vaccCoding[0]?.display || vaccCode?.text || "Unknown vaccine";
        summary.push(`Vacc: ${vaccDisplay}`);
        break;
      }
      case "AllergyIntolerance": {
        const allergyCode = resource.code as Record<string, unknown>;
        const allergyCoding =
          (allergyCode?.coding as Array<Record<string, string>>) || [];
        const allergyDisplay =
          allergyCoding[0]?.display || allergyCode?.text || "Unknown allergen";
        summary.push(`Allergy: ${allergyDisplay}`);
        break;
      }
      default:
        summary.push(`${resType}: (data received)`);
    }
  }

  return {
    resourceType: "Bundle",
    entries,
    summary,
  };
}

// ===== ACTION HANDLERS =====

/**
 * Handle incoming health data from ABDM / HIP.
 *
 * ABDM payload structure (V3):
 * {
 *   requestId: string,
 *   timestamp: string,
 *   transactionId: string,
 *   entries: [
 *     {
 *       content: string,          // Base64 encoded (encrypted or plain) FHIR Bundle
 *       media: string,            // MIME type, e.g., "application/fhir+json"
 *       careContextReference: string  // Reference to the care context
 *     }
 *   ],
 *   keyMaterial: {
 *     cryptoAlg: string,          // e.g., "ECDH"
 *     curve: string,              // e.g., "Curve25519"
 *     dhPublicKey: { ... },
 *     nonce: string
 *   }
 * }
 */
async function handleDataReceive(
  body: Record<string, unknown>,
): Promise<Response> {
  const requestId = body.requestId as string;
  const transactionId = body.transactionId as string;
  const timestamp = (body.timestamp as string) || new Date().toISOString();
  const entries = (body.entries as Array<Record<string, unknown>>) || [];
  const keyMaterial = (body.keyMaterial as Record<string, unknown>) || null;

  if (!transactionId) {
    return jsonResponse({ error: "transactionId is required" }, 400);
  }

  if (!entries || entries.length === 0) {
    return jsonResponse(
      { error: "No entries provided in the data payload" },
      400,
    );
  }

  console.log(
    `Receiving ${entries.length} health record entries for transaction: ${transactionId}`,
  );

  const processedEntries: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const content = entry.content as string;
    const media = (entry.media as string) || "application/fhir+json";
    const careContextRef =
      (entry.careContextReference as string) || `entry-${i}`;

    if (!content) {
      errors.push(`Entry ${i}: No content provided`);
      continue;
    }

    let parsedContent: Record<string, unknown> | null = null;
    let decryptionMethod = "none";

    // Attempt 1: Try to parse content as plain JSON (sandbox mode)
    try {
      parsedContent = JSON.parse(content);
      decryptionMethod = "plain_json";
    } catch {
      // Not plain JSON — might be Base64 encoded
    }

    // Attempt 2: Try Base64 decode then parse as JSON
    if (!parsedContent) {
      try {
        const decoded = atob(content);
        parsedContent = JSON.parse(decoded);
        decryptionMethod = "base64_json";
      } catch {
        // Not Base64 JSON either
      }
    }

    // Attempt 3: Try Fidelius decryption (TODO)
    if (!parsedContent && keyMaterial) {
      const decrypted = _decryptFidelius(content, keyMaterial);
      if (decrypted) {
        try {
          parsedContent = JSON.parse(decrypted);
          decryptionMethod = "fidelius";
        } catch {
          errors.push(
            `Entry ${i}: Fidelius decryption succeeded but content is not valid JSON`,
          );
        }
      }
    }

    if (!parsedContent) {
      errors.push(
        `Entry ${i}: Could not parse content. May require Fidelius decryption (not yet implemented).`,
      );
      // Store raw content anyway for later processing
      const storagePath = `abdm-received/${transactionId}/${careContextRef}-raw.txt`;
      const uploadResult = await uploadToStorage(
        STORAGE_BUCKET,
        storagePath,
        content,
        "text/plain",
      );
      if (!uploadResult.success) {
        errors.push(
          `Entry ${i}: Failed to store raw content: ${uploadResult.error}`,
        );
      }
      continue;
    }

    // Parse FHIR Bundle for human-readable summary
    const parsed = parseFhirBundle(parsedContent);

    // Store parsed FHIR bundle in Supabase Storage
    const storagePath = `abdm-received/${transactionId}/${careContextRef}.json`;
    const uploadResult = await uploadToStorage(
      STORAGE_BUCKET,
      storagePath,
      JSON.stringify(parsedContent, null, 2),
      "application/json",
    );

    if (!uploadResult.success) {
      errors.push(
        `Entry ${i}: Failed to store in Storage: ${uploadResult.error}`,
      );
    }

    processedEntries.push({
      index: i,
      careContextReference: careContextRef,
      media,
      decryptionMethod,
      resourceType: parsed.resourceType,
      entryCount: parsed.entries.length,
      summary: parsed.summary,
      storagePath,
      fhirResources: parsed.entries, // Full FHIR resources for the UI
    });
  }

  // ===== UPDATE CONSENT STATUS =====

  // Try to find and update the consent artefact for this transaction
  // TODO: Link transactionId to consent_request_id properly via ABDM callbacks
  const patchRes = await supabaseRest(
    `abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(transactionId)}`,
    {
      method: "PATCH",
      body: {
        status: "DATA_RECEIVED",
      },
    },
  );
  if (!patchRes.ok) {
    // Non-fatal — the transactionId may not match a consent_request_id directly
    console.warn(
      "Could not update consent artefact status (may not exist for this transactionId)",
    );
  }

  // ===== SEND ACKNOWLEDGEMENT =====

  // TODO: Send acknowledgement to ABDM gateway
  // POST ${ABDM_GATEWAY_URL}/v3/health-information/notify
  // Body: {
  //   requestId: generateUUID(),
  //   timestamp: new Date().toISOString(),
  //   notification: {
  //     consentId: consentArtefactId,
  //     transactionId,
  //     doneAt: new Date().toISOString(),
  //     statusNotification: {
  //       sessionStatus: "TRANSFERRED",
  //       hipId: sourceHipId,
  //     }
  //   }
  // }

  return jsonResponse({
    success: true,
    requestId: requestId || null,
    transactionId,
    timestamp,
    processed: processedEntries.length,
    total: entries.length,
    entries: processedEntries,
    errors: errors.length > 0 ? errors : undefined,
    message:
      processedEntries.length > 0
        ? `Successfully processed ${processedEntries.length}/${entries.length} health record entries.`
        : "No entries could be processed. Check errors for details.",
    _stub: true,
    _note:
      "STUB: Fidelius decryption not implemented. Sandbox data parsed as plain JSON/Base64.",
  });
}

/**
 * Handle consent notification callback from ABDM.
 * ABDM calls this when a patient approves or denies a consent request.
 *
 * TODO: Implement full consent notification handling:
 *   - Verify callback signature
 *   - On GRANTED: Store consent artefact, initiate data request
 *   - On DENIED/REVOKED: Update status, notify doctor
 */
async function handleConsentNotify(
  body: Record<string, unknown>,
): Promise<Response> {
  const notification = body.notification as Record<string, unknown>;
  if (!notification) {
    return jsonResponse({ error: "notification object is required" }, 400);
  }

  const consentRequestId = notification.consentRequestId as string;
  const status = notification.status as string; // GRANTED, DENIED, REVOKED, EXPIRED
  const consentArtefacts =
    (notification.consentArtefacts as Array<Record<string, string>>) || [];

  console.log(`Consent notification: ${consentRequestId} -> ${status}`);

  // Update consent status in our table
  if (consentRequestId) {
    const newStatus =
      status === "GRANTED"
        ? "GRANTED"
        : status === "DENIED"
          ? "DENIED"
          : status;

    const patchRes = await supabaseRest(
      `abdm_consent_artefacts?consent_id=eq.${encodeURIComponent(consentRequestId)}`,
      {
        method: "PATCH",
        body: {
          status: newStatus,
        },
      },
    );

    if (!patchRes.ok) {
      console.error("Failed to update consent status:", await patchRes.text());
    }
  }

  // TODO: If GRANTED, initiate health data request:
  // POST ${ABDM_GATEWAY_URL}/v3/health-information/cm/request
  // with consent artefact ID to start the data transfer

  return jsonResponse({
    success: true,
    consentRequestId,
    status,
    artefactCount: consentArtefacts.length,
    message:
      `STUB: Consent notification received (${status}). ` +
      (status === "GRANTED"
        ? "In production, this would trigger a health data request to the HIP."
        : "Consent was not granted."),
    _stub: true,
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

    // Route based on the type of callback from ABDM
    // The action field is used for our internal routing;
    // ABDM callbacks are detected by the presence of specific fields.

    // Check if this is a consent notification callback from ABDM
    if (
      body.notification &&
      (body.notification as Record<string, unknown>).consentRequestId
    ) {
      return await handleConsentNotify(body);
    }

    // Check if this is a health data transfer (has entries + transactionId)
    if (body.transactionId || body.entries) {
      return await handleDataReceive(body);
    }

    // Explicit action routing for internal use
    const action = body.action as string;
    if (action === "consent-notify") {
      return await handleConsentNotify(body);
    }
    if (action === "data-receive") {
      return await handleDataReceive(body);
    }

    return jsonResponse(
      {
        error:
          "Could not determine request type. Expected: ABDM data transfer (with transactionId + entries), " +
          "consent notification (with notification.consentRequestId), or explicit action field.",
        supported_actions: ["data-receive", "consent-notify"],
      },
      400,
    );
  } catch (err) {
    console.error("abdm-hiu-data-receive error:", err);
    return jsonResponse(
      { error: "Internal server error", details: String(err) },
      500,
    );
  }
});
