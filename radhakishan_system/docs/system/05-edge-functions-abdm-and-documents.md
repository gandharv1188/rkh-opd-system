# 05 — Edge Functions: ABDM & Document/Audio Pipelines

> **Scope:** Permanent system documentation for all ABDM (Ayushman Bharat Digital Mission) integration Edge Functions plus the document OCR (`process-document`) and audio transcription (`transcribe-audio`) Edge Functions. These are the non-clinical-generation Deno/TypeScript functions deployed at `https://ecywxuqhnlkjtdshpcbc.supabase.co/functions/v1/<name>`.

> **Status as of writing (2026-04-27):** ABDM functions are STUBS for local sandbox modelling. They write/read our Supabase tables correctly, but every outbound HTTPS call to `${ABDM_GATEWAY_URL}` is commented out (`// TODO`). Production go-live requires sandbox + HFR + HPR registration, Fidelius (ECDH/Curve25519) encryption, gateway signature verification, and a WASA "Safe-to-Host" certificate. See `radhakishan_system/docs/abdm/ABDM_next_steps.md`.

---

## 1. Function Inventory

| Function | Source | Lines | Role | Direction |
|---|---|---|---|---|
| `abdm-identity` | `supabase/functions/abdm-identity/index.ts` | 343 | ABHA verify / create / Scan-and-Share / link-care-context | Web app → us → (ABDM) |
| `abdm-hip-discover` | `supabase/functions/abdm-hip-discover/index.ts` | 290 | HIP callback: patient discovery by ABHA or demographics | ABDM gateway → us |
| `abdm-hip-link` | `supabase/functions/abdm-hip-link/index.ts` | 236 | HIP callback: confirm care-context linking to ABHA | ABDM gateway → us |
| `abdm-hip-consent` | `supabase/functions/abdm-hip-consent/index.ts` | 278 | HIP callback: consent GRANTED/DENIED/REVOKED/EXPIRED notification | ABDM gateway → us |
| `abdm-hip-data-transfer` | `supabase/functions/abdm-hip-data-transfer/index.ts` | 490 | HIP callback: serve FHIR bundles to ABDM/HIU under valid consent | ABDM gateway → us → HIU push URL |
| `abdm-hiu-consent-request` | `supabase/functions/abdm-hiu-consent-request/index.ts` | 353 | HIU initiate: doctor requests other facility's records | Web app → us → (ABDM) |
| `abdm-hiu-data-receive` | `supabase/functions/abdm-hiu-data-receive/index.ts` | 577 | HIU callback: receive consent notifications + encrypted FHIR data | ABDM gateway → us |
| `process-document` | `supabase/functions/process-document/index.ts` | 466 | OCR / Vision extraction of lab reports, Rx, discharge summaries, vaccination cards, doctor's notepad | Web app → us → Anthropic Vision |
| `transcribe-audio` | `supabase/functions/transcribe-audio/index.ts` | 150 | Speech-to-text for clinical dictation | Web app → us → OpenAI Whisper-class |

The "FHIR generator" referenced by `abdm-hip-data-transfer` is `generate-fhir-bundle` — documented separately in `04-edge-functions-clinical.md`.

---

## 2. Architecture Overview

```
                         ┌────────────────────────────────────────────────┐
                         │   ABDM Gateway (sandbox dev.abdm.gov.in /      │
                         │   prod live.abdm.gov.in / abdm.gov.in)         │
                         └────────────┬───────────────────────────┬───────┘
            HIP role (we serve data)  │                           │  HIU role (we consume)
                                      ▼                           ▼
          ┌──────────────────────────────────────────┐   ┌──────────────────────────┐
          │ abdm-hip-discover  abdm-hip-link         │   │ abdm-hiu-consent-request │
          │ abdm-hip-consent   abdm-hip-data-transfer│   │ abdm-hiu-data-receive    │
          └──────────┬───────────────────────────────┘   └──────────────┬───────────┘
                     │ reads patients/visits/                            │ writes to
                     │ prescriptions/lab_results/                        │ Storage:documents/
                     │ vaccinations/abdm_care_contexts                   │ abdm-received/<txn>/
                     │ /abdm_consent_artefacts                           │
                     ▼                                                   ▼
          ┌──────────────────────────────────────────────────────────────────────────┐
          │                     Supabase Postgres + Storage                          │
          └──────────────────────────────────────────────────────────────────────────┘
                     ▲                                                   ▲
                     │ called by web (registration page)                 │ called by web (Rx pad)
                     │ to verify ABHA, link care contexts                │ to attach docs, dictate
          ┌──────────┴──────────┐                              ┌─────────┴────────────┐
          │   abdm-identity     │                              │ process-document     │
          │                     │                              │ transcribe-audio     │
          └─────────────────────┘                              └──────────────────────┘
                                                                        │
                                                                        ▼
                                                           Anthropic Vision (Claude)
                                                           OpenAI gpt-4o-transcribe
```

**Two distinct ABDM roles played by the same hospital:**

- **HIP (Health Information Provider)** — Radhakishan Hospital is the *source* of records. ABDM gateway pushes callbacks to our 4 `abdm-hip-*` endpoints when another facility (or the patient via a PHR app) needs our data.
- **HIU (Health Information User)** — Radhakishan Hospital is the *consumer* of records. The doctor on the Prescription Pad invokes our 2 `abdm-hiu-*` endpoints to fetch records from other facilities for an ABHA-linked patient.

`abdm-identity` is identity-only (not data-flow): it is invoked by our own web app for ABHA verify / Scan-and-Share / care-context linking.

---

## 3. Common Conventions

All nine functions share these properties:

- **Runtime:** Deno on Supabase Edge Runtime, served via `https://deno.land/std@0.177.0/http/server.ts` `serve()`.
- **CORS:** All functions accept `OPTIONS` preflight. ABDM HIP callbacks add `x-hip-id` to allowed headers.
- **Hardcoded Supabase access:** Each function carries a hardcoded `SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co"` and `ANON_KEY` (long-lived JWT through 2036). Database writes that require RLS bypass (`process-document`) optionally use `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
- **JSON in / JSON out:** All ABDM endpoints expect `POST` + `application/json`. `transcribe-audio` is the lone exception — it expects `multipart/form-data` with an `audio` field.
- **Logging:** `console.log` / `console.warn` / `console.error` only — viewable via `npx supabase functions logs <name> --project-ref ecywxuqhnlkjtdshpcbc`.
- **No auth on the function itself:** Anyone with the URL can POST. Production needs (a) ABDM gateway signature verification on HIP callbacks and (b) Supabase Auth JWTs on identity / HIU initiator endpoints.

---

## 4. Secrets & Environment Variables

Set via:

```bash
npx supabase secrets set ABDM_CLIENT_ID=... ABDM_CLIENT_SECRET=... \
  ABDM_GATEWAY_URL=https://dev.abdm.gov.in ABDM_HIU_ID=... \
  ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  --project-ref ecywxuqhnlkjtdshpcbc
```

| Env var | Used by | Default | Purpose |
|---|---|---|---|
| `ABDM_GATEWAY_URL` | All `abdm-*` | `https://dev.abdm.gov.in` (sandbox) | Base URL for ABDM gateway. Production: `https://abdm.gov.in` (live) or `https://live.abdm.gov.in`. |
| `ABDM_CLIENT_ID` | All `abdm-*` HIP/HIU | `""` | OAuth2 client ID issued at sandbox registration. |
| `ABDM_CLIENT_SECRET` | All `abdm-*` HIP/HIU | `""` | OAuth2 client secret. Used to obtain gateway access token (`POST /v3/gateway/sessions`). |
| `ABDM_HIU_ID` | `abdm-hiu-consent-request` | `"radhakishan-hospital-hiu"` | HIU identifier registered with ABDM (typically the HFR ID). |
| `ANTHROPIC_API_KEY` | `process-document` | required | Claude Vision OCR. Function throws if missing. |
| `OPENAI_API_KEY` | `transcribe-audio` | optional | If absent, function returns 503 with `fallback: true` so client falls back to Web Speech API. |
| `SUPABASE_SERVICE_ROLE_KEY` | `process-document` | optional | Used for server-side writes to `lab_results`, `vaccinations`, `visits.attached_documents`. Falls back to anon key with a console warning. |

**No secret is consulted by `abdm-identity` for verify/link operations today** — those are pure local stubs. They will need `ABDM_CLIENT_ID/SECRET` once the V3 calls are uncommented.

---

## 5. `abdm-identity` — Web-Initiated Identity Operations

**Endpoint:** `POST /functions/v1/abdm-identity`
**Caller:** Web app (registration page mainly; Rx pad on sign-off for care-context link).
**Routing:** A single `action` field in the JSON body multiplexes four handlers.

### 5.1 `action: "verify-abha"`

- Input: `{ action, abha_number, patient_id? }`
- ABHA format check: 14 digits, hyphenated or not, normalised to `XX-XXXX-XXXX-XXXX` (`validateAbhaFormat`).
- Returns a **mock profile** (`name="ABDM Verified Patient"`, `_stub: true`).
- If `patient_id` supplied, PATCHes `patients` table: `{ abha_number, abha_verified: true }`. Failure is non-fatal.
- TODO: real call is `POST ${ABDM_GATEWAY_URL}/v3/hip/patient/verify` plus storing the returned 24-hour linking token.

### 5.2 `action: "create-abha"`

- Returns HTTP 501 `not_implemented`.
- Production flow per code comments: Aadhaar OTP init → verify OTP → enrol (`/v3/enrollment/...`).

### 5.3 `action: "profile-share"`

- Returns HTTP 501 `not_implemented`. Slot for the Scan-and-Share callback (patient scans hospital QR in their PHR app, ABDM POSTs profile here).

### 5.4 `action: "link-care-context"`

- Input: `{ action, patient_id, care_context_ref, linking_token? }`
- Upserts into `abdm_care_contexts` with `linked=true`, `linked_at=now`. Uses `Prefer: resolution=merge-duplicates,return=representation` for idempotency.
- TODO: real call is `POST ${ABDM_GATEWAY_URL}/v3/hip/patient/care-context/link` with `linking_token` + array of `{reference_number, display}`.

Unknown `action` → 400 listing supported actions.

---

## 6. HIP Side — Callback Endpoints From ABDM

These four endpoints are ABDM-driven. ABDM sends an `X-HIP-ID` header; `validateGatewayRequest()` currently logs a warning if it's missing but processes the request anyway (sandbox tolerance). Production must verify the gateway's request signature (RS256 against ABDM's published JWKS) and reject replays via timestamp window.

### 6.1 `abdm-hip-discover` — Patient Discovery

**Inbound payload:** `{ requestId, timestamp, transactionId, patient: { verifiedIdentifiers, unverifiedIdentifiers, name, gender, yearOfBirth } }`

Two-strategy match against `patients` (filtered `is_active=true`):

1. **By verified ABHA** (`identifier.type === "HEALTH_NUMBER" | "HEALTH_ID"`) → `patients?abha_number=eq.<value>`.
2. **By demographics** (`name ilike %x%` + `sex=eq.<mappedGender>` filtered locally by `yearOfBirth`). Gender map: `M→Male, F→Female, O→Other, U→Unknown`.

Outcomes returned synchronously to ABDM (200 status with one of):

- `{status:"MATCHED", patient:{referenceNumber:UHID, display:full_name, careContexts:[{referenceNumber, display}], matchedBy:["HEALTH_NUMBER"|"DEMOGRAPHIC"]}}` — care contexts pulled from `abdm_care_contexts` with `display_text` + `record_types`.
- `{status:"MULTIPLE_MATCH"}` — >1 demographic match; cannot disambiguate, returns error.
- `{status:"NO_MATCH"}` — no candidate.

A `callbackPayload` for `POST /v0.5/care-contexts/on-discover` is built and **logged but not sent** (TODO).

### 6.2 `abdm-hip-link` — Care Context Linking

**Inbound:** `{ requestId, timestamp, transactionId, patient:{ id (ABHA address), referenceNumber (UHID), careContexts:[{referenceNumber}] } }`

1. Look up `patients?uhid=eq.<referenceNumber>&is_active=true`. 0 rows → returns `{status:"PATIENT_NOT_FOUND"}` and would callback `/v0.5/links/link/on-add-contexts` with error.
2. For each care context: verify it exists in `abdm_care_contexts` for this `patient_id`, then PATCH `linked=true, linked_at=now`. Track success in `linkedContexts[]` and failures in `failedContexts[]`.
3. Returns `{status: "SUCCESS"|"PARTIAL", linkedContexts, failedContexts}`.

### 6.3 `abdm-hip-consent` — Consent Notification

**Inbound:** `{ requestId, timestamp, notification:{ consentRequestId, status, consentArtefacts?:[{id}] } }` where `status ∈ {GRANTED, DENIED, REVOKED, EXPIRED}`.

- **GRANTED:** For each artefact ID, INSERT into `abdm_consent_artefacts` with `consent_id, status="GRANTED", artefact_json={consent_request_id, granted_at}`. On 409 conflict, PATCH instead. **TODO:** fetch full artefact via `GET /v0.5/consents/fetch` and persist `patient_id, hi_types, date_range_from/to, expiry, purpose, requester_name`.
- **DENIED / EXPIRED:** PATCH all rows where `consent_id=eq.<consentRequestId>` to that status.
- **REVOKED:** PATCH each artefact in `consentArtefacts[]` plus all `consent_id=eq.<consentRequestId>&status=eq.GRANTED` rows.

Acknowledgement payload for `POST /v0.5/consents/hip/on-notify` is logged but not sent (TODO).

### 6.4 `abdm-hip-data-transfer` — Health Information Request

**Inbound:** `{ requestId, timestamp, transactionId, hiRequest:{ consent:{id}, dataPushUrl, dateRange:{from,to}, keyMaterial:{cryptoAlg, curve, dhPublicKey, nonce} } }`

This is the load-bearing data-flow endpoint. Six sequential steps:

1. **Validate consent artefact:** Fetch `abdm_consent_artefacts?consent_id=eq.<id>`. If `status !== "GRANTED"` or `expiry < now()`, send `ERRORED` ack and bail.
2. **Validate date range:** Requested `from`/`to` must lie within `consentArtefact.date_range_from/to`. Otherwise `DATE_RANGE_EXCEEDED` + ack.
3. **Fetch health data** for `patient_id` (from artefact) per `hiTypes` (default `["Prescription","DiagnosticReport","OPConsultation"]`):
   - `Prescription | OPConsultation` → `prescriptions` (id, visit_id, prescription_data, status, created_at).
   - `DiagnosticReport` → `lab_results` (id, test_name, test_category, value, unit, flag, created_at).
   - `OPConsultation` → `visits` (chief_complaints, vitals, diagnoses, clinical_notes, visit_summary, ...).
   - `ImmunizationRecord` → `vaccinations` (id, vaccine_name, dose_number, date_given, schedule_type).
   - All filtered by `created_at` against requested date range.
4. **Generate FHIR bundles** by POSTing internally to `${SUPABASE_URL}/functions/v1/generate-fhir-bundle` with `{patientId, hiTypes, healthData, dateRange}`. On failure, falls back to wrapping each `healthData[type]` in a `{resourceType:"Bundle", type:"collection", entry:..., meta:{tag:[{code:type}]}}` shell.
5. **Encrypt & push:** Builds `pushPayload = { pageNumber:1, pageCount:1, transactionId, entries:[{content: JSON.stringify(bundle), media:"application/fhir+json", checksum:"" /*TODO SHA256*/, careContextReference:"CC-N"}], keyMaterial: null /*TODO our public key*/ }` and POSTs to `dataPushUrl`. **WARNING IN CODE:** Fidelius (ECDH/Curve25519 + AES-GCM) encryption is not implemented; data is sent unencrypted. Acceptable in sandbox only.
6. **Acknowledge to ABDM:** `sendAcknowledgement(requestId, transactionId, "OK"|"ERRORED", error?)` builds payload for `POST /v0.5/health-information/hip/on-request` with `hiRequest.sessionStatus = "TRANSFERRED"|"FAILED"` — currently logged, not sent.

Synchronous response to caller: `{status:"OK", transactionId, bundleCount}` or one of the error statuses listed above.

---

## 7. HIU Side — Records We Pull From Other Facilities

### 7.1 `abdm-hiu-consent-request` — Initiate

**Caller:** Web app (Prescription Pad, when doctor wants outside records for an ABHA-verified patient).

**Input:** `{ patient_id, abha_number, purpose?, hi_types?, date_range_from?, date_range_to? }`

Validation:

- ABHA format normalised same as `abdm-identity`.
- `hi_types` must be subset of `["OPConsultation","Prescription","DiagnosticReport","DischargeSummary","ImmunizationRecord","HealthDocumentRecord","WellnessRecord"]`.
- `purpose` must be one of `["CAREMGT","BTG","PUBHLTH","HPAYMT","DSRCH"]`. Default `CAREMGT`.
- Default date range: last 12 months.

Builds an ABDM V3 consent request envelope `_abdmPayload` with:

- `consent.purpose: {text:"Care Management", code:"CAREMGT"}`
- `consent.patient.id: <abha-digits>@sbx`
- `consent.hiu.id: ABDM_HIU_ID`
- `consent.requester: {name:"Radhakishan Hospital, Kurukshetra", identifier:{type:"REGNO", value:HIU_ID, system:"https://www.mciindia.org"}}`
- `consent.permission: {accessMode:"VIEW", dateRange, dataEraseAt:+30 days, frequency:{unit:"HOUR", value:1, repeats:0}}`

**TODO commented out:** `_getAbdmAccessToken()` (`POST /v3/gateway/sessions` client-credentials grant, cache till expiry) and `POST /v3/consent-requests/init`.

INSERT into `abdm_consent_artefacts` with `status="REQUESTED"`, returns `{success, consent_request_id, status:"REQUESTED", _stub: true}`.

### 7.2 `abdm-hiu-data-receive` — Receive

This endpoint serves **two** distinct ABDM callbacks. The dispatch logic at the bottom of `serve()`:

1. If body has `notification.consentRequestId` → `handleConsentNotify`.
2. Else if body has `transactionId` or `entries` → `handleDataReceive`.
3. Else fall through to explicit `action` field (`"consent-notify" | "data-receive"`).

#### 7.2.1 `handleConsentNotify`

- Maps incoming `status` to internal: `GRANTED→GRANTED`, `DENIED→DENIED`, otherwise pass-through.
- PATCHes `abdm_consent_artefacts?consent_id=eq.<consentRequestId>`.
- TODO on `GRANTED`: trigger `POST /v3/health-information/cm/request` with consent artefact ID to start data fetch.

#### 7.2.2 `handleDataReceive`

For each `entry = {content, media, careContextReference}` in `entries[]`:

1. **Plain JSON parse** of `entry.content` (sandbox path).
2. **Base64 decode → JSON parse** if step 1 fails.
3. **Fidelius decrypt** (`_decryptFidelius` — STUB; comment-only ECDH+Curve25519 plan using `keyMaterial.dhPublicKey` + `nonce`).
4. If all three fail, store the raw content as `abdm-received/<transactionId>/<careContextRef>-raw.txt` in the `documents` Storage bucket so it can be processed later.

If parsed, pass through `parseFhirBundle()` which produces a human-readable `summary[]` array per resource type:

- `Condition` → `Dx: <display>`
- `MedicationRequest` → `Rx: <medName>`
- `DiagnosticReport` → `Lab: <display>`
- `Observation` → `Obs: <name> = <value> <unit>`
- `Immunization` → `Vacc: <name>`
- `AllergyIntolerance` → `Allergy: <code>`
- Other resourceType → `<type>: (data received)`

Stores the parsed bundle as `abdm-received/<transactionId>/<careContextRef>.json` (`application/json`) in `documents` bucket via Supabase Storage REST `POST /storage/v1/object/<bucket>/<path>` with `x-upsert: true`.

Then PATCHes `abdm_consent_artefacts?consent_id=eq.<transactionId>` with `status="DATA_RECEIVED"` (best-effort; `transactionId` may not actually equal `consent_request_id`, so failure is non-fatal).

Returns `{success, processed, total, entries:[{index, careContextReference, media, decryptionMethod, resourceType, entryCount, summary, storagePath, fhirResources}], errors?, _stub:true}`.

ACK to ABDM at `POST /v3/health-information/notify` with `notification.statusNotification.sessionStatus="TRANSFERRED"` is **TODO** (not even logged, just commented).

---

## 8. ABDM Tables Touched

Both tables live in `radhakishan_system/schema/abdm_schema.sql` (see system doc 06 — schema):

### `abdm_care_contexts`

Written by `abdm-identity` (link-care-context), `abdm-hip-discover` (read), `abdm-hip-link` (PATCH linked). Columns referenced in this layer: `id, patient_id, care_context_ref, display_text, record_types, linked, linked_at`.

### `abdm_consent_artefacts`

Written by `abdm-hip-consent` (status updates GRANTED/DENIED/REVOKED/EXPIRED), `abdm-hiu-consent-request` (INSERT REQUESTED), `abdm-hiu-data-receive` (PATCH DATA_RECEIVED), and read by `abdm-hip-data-transfer` (validate consent + date range + hi_types). Columns referenced: `consent_id, patient_id, status, hi_types, date_range_from, date_range_to, expiry, purpose, requester_name, artefact_json`.

`hi_types` defaults to `["Prescription","DiagnosticReport","OPConsultation"]` when null on the artefact. Status values observed in code: `REQUESTED, GRANTED, DENIED, REVOKED, EXPIRED, DATA_RECEIVED`.

---

## 9. ABDM Gateway URLs Referenced

All commented out (`// TODO`) but documented for future enablement:

| Direction | URL (sandbox base `dev.abdm.gov.in`) | Function |
|---|---|---|
| Outbound (HIP) | `POST /v0.5/care-contexts/on-discover` | `abdm-hip-discover` callback |
| Outbound (HIP) | `POST /v0.5/links/link/on-add-contexts` | `abdm-hip-link` callback |
| Outbound (HIP) | `POST /v0.5/consents/hip/on-notify` | `abdm-hip-consent` ack |
| Outbound (HIP) | `POST /v0.5/health-information/hip/on-request` | `abdm-hip-data-transfer` ack |
| Outbound (HIP) | `GET /v0.5/consents/fetch` | Fetch full artefact for GRANTED notifications |
| Outbound (Identity) | `POST /v3/hip/patient/verify` | Real ABHA verify |
| Outbound (Identity) | `POST /v3/hip/patient/care-context/link` | Real care-context link |
| Outbound (Identity) | `POST /v3/enrollment/request/otp`, `auth/byAadhaar`, `enrol/byAadhaar` | ABHA creation via Aadhaar OTP |
| Outbound (HIU) | `POST /v3/gateway/sessions` | OAuth2 client-credentials access token |
| Outbound (HIU) | `POST /v3/consent-requests/init` | `abdm-hiu-consent-request` |
| Outbound (HIU) | `POST /v3/health-information/cm/request` | Trigger data fetch on consent GRANTED |
| Outbound (HIU) | `POST /v3/health-information/notify` | `abdm-hiu-data-receive` ack |
| Inbound (HIP) | Whatever URL is registered as our HIP callback root | All four `abdm-hip-*` |

Production: replace `dev.abdm.gov.in` with `abdm.gov.in` (or `live.abdm.gov.in`). Per `ABDM_next_steps.md`, this requires HFR ID, HPR ID for Dr. Lokender Goyal, sandbox + production credentials, WASA "Safe-to-Host" certificate, and NHA functional verification.

---

## 10. `process-document` — Document OCR Pipeline

**Endpoint:** `POST /functions/v1/process-document`
**Caller:** Registration page (external records upload), Prescription Pad (notepad photo, attach lab images).

### 10.1 Inputs

```json
{
  "image_url"?: "https://.../documents/<path>",
  "image_base64"?: "<bytes>",
  "media_type"?: "image/jpeg" | "image/png" | "application/pdf",
  "patient_id"?: "<uuid>",
  "visit_id"?: "<uuid>",
  "category"?: "lab" | "discharge" | "prescription" | "vaccination" | "other",
  "doc_date"?: "YYYY-MM-DD",
  "mode"?: "pad" | undefined
}
```

Either `image_url` OR `image_base64` is required (400 otherwise).

### 10.2 Two operating modes

**Mode A: structured extraction (default).**
System prompt `SYSTEM_PROMPT` instructs Claude to return strict JSON with fields `document_type, summary, lab_values[], diagnoses[], medications[], vaccinations[], clinical_notes, lab_name, report_date`. Includes a long test-name normalisation table (Hb→Hemoglobin, TSB→Total Serum Bilirubin, etc.) and category mapping (Hematology / Biochemistry / Microbiology / Imaging) and flag values (`normal | low | high | critical`). Discharge summaries: only the latest serial value per test, only discharge medications.

**Mode B: pad transcription (`mode: "pad"`).**
Uses a separate fast prompt `padPrompt` that instructs Claude to transcribe a doctor's handwritten notepad photo *verbatim* — preserving abbreviations (`c/o`, `Dx`, `Rx`, `BD`, `TDS`), no labels, no rephrasing, no flag annotations. Returns `{text_for_pad, summary: text_for_pad.substring(0,200)}`.

### 10.3 Vision content source construction

- If `image_base64`: builds `{type: "document"|"image" (PDF? document : image), source: {type:"base64", media_type, data:base64}}`.
- If `image_url`: builds `{type: "document"|"image", source: {type:"url", url:image_url}}` (Claude fetches directly — no client-side base64 conversion). PDF detected by `.pdf` extension or `content-type=application/pdf` in URL.

### 10.4 Claude call

- Model: `claude-sonnet-4-20250514`
- `max_tokens: 2048`
- Endpoint: `https://api.anthropic.com/v1/messages`
- Header: `anthropic-version: 2023-06-01` (PDF support is GA, no beta header).
- Cost logged: `input_tokens`, `output_tokens` per call.

Failure → 502 `{error: "AI extraction failed", detail}`.

### 10.5 JSON parsing fallbacks

Tries `JSON.parse(rawText)` first. If that fails, looks for a markdown code-fenced block (` ```json ... ``` `). If that also fails, returns `{summary: rawText, lab_values:[], medications:[], diagnoses:[]}`.

### 10.6 Server-side persistence (structured mode only)

If `patient_id && visit_id && !isPadMode`:

- Uses `SUPABASE_SERVICE_ROLE_KEY` if set, else falls back to anon key (with warning).
- For each `lab_values[]`: must have `test_name`, `value`, AND a date (`report_date || doc_date`). Skips incomplete rows. INSERT into `lab_results` with `value_numeric = parseFloat(value) || null`, `flag` defaults to `"normal"`, `source: "ai_extracted"`. Counts `savedCount` and `skippedLabs`.
- For each `vaccinations[]`: must have `vaccine_name` AND `date_given`. INSERT into `vaccinations` with `given_by: "extracted_from_document"`, `free_or_paid: "unknown"`, batch number from `vax.batch_no`.
- Updates `visits.attached_documents[]` JSONB array: finds the entry where `url === doc_url` and patches in `ocr_summary, ocr_lab_count, ocr_vax_count, ocr_diagnoses, ocr_medications`.
- Annotates response with `_saved_to_db: boolean` and `_lab_count_saved: number`.

### 10.7 Storage interaction

Files themselves live in the `documents` bucket (uploaded by the web client, not by this function). This function only reads via `image_url` or accepts inline `image_base64`.

---

## 11. `transcribe-audio` — Speech-to-Text

**Endpoint:** `POST /functions/v1/transcribe-audio`
**Caller:** Prescription Pad voice dictation (when Web Speech API is unavailable or low-confidence).

### 11.1 Input (multipart/form-data)

| Field | Type | Required | Notes |
|---|---|---|---|
| `audio` | File | Yes | Sent to OpenAI as `audio.webm` regardless of actual extension |
| `patient_context` | string | No | Appended to medical prompt: name, weight, allergies, prior diagnoses |
| `language` | string | No | `"en"` default. `"hi"` forces Hindi. Anything else (or empty) → omitted so model auto-detects (good for Hindi-English code-switching) |

### 11.2 Prompt strategy

`MEDICAL_PROMPT` (~500 words) seeds the model with:

- ~80 pediatric drug names in caps (AMOXICILLIN, PARACETAMOL, AZITHROMYCIN, ...).
- Dosing terms: `mg/kg`, `mg/kg/day`, `BD/TDS/QID/OD/SOS/PRN`, routes (PO/IV/IM/SC), durations.
- Clinical abbreviations: URTI, LRTI, AOM, AGE, UTI, SAM, MAM, CBC, CRP, etc.
- Romanised Hindi terms common in Kurukshetra OPD: bukhar, khansi, zukam, dast, ulti, pet dard, dawai, goli, sharbat, boonden, subah shaam, khane ke baad, khali pet, teeka, wajan.

If `patient_context` provided, appended as `\n\nCurrent patient: <ctx>`.

### 11.3 OpenAI call

- Endpoint: `https://api.openai.com/v1/audio/transcriptions`
- Model: `gpt-4o-transcribe`
- `prompt: <medical+patient context>`
- `response_format: text` (returns plain text, not JSON)
- `temperature: 0` (deterministic; best for medical accuracy)
- `language: hi|en` only when explicitly requested.

### 11.4 Output and fallback contract

- Success: `{text: "<trim>", engine: "gpt-4o-transcribe"}` + 200.
- Missing `OPENAI_API_KEY`: 503 `{error, fallback: true}` — explicit signal for client to use Web Speech API instead.
- Network/OpenAI error: passes through OpenAI's status code with `{error, fallback: true, details}`.
- Server error: 500 `{error, fallback: true}`.

The `fallback: true` flag is load-bearing — the prescription pad client checks it and silently degrades instead of surfacing an error to the doctor.

---

## 12. Where Artifacts Land

| Artifact | Bucket / Table | Key / Path |
|---|---|---|
| Original uploaded document | Storage `documents` bucket | Client-chosen path (e.g., `<patient_id>/<timestamp>-<filename>`) |
| Document metadata | `visits.attached_documents` JSONB | Array of `{url, name, type, size, ocr_summary?, ocr_lab_count?, ocr_vax_count?, ocr_diagnoses?, ocr_medications?}` |
| Extracted lab values | `lab_results` rows | `source = "ai_extracted"` |
| Extracted vaccinations | `vaccinations` rows | `given_by = "extracted_from_document"`, `free_or_paid = "unknown"` |
| Pad transcription | (returned to client only) | Dropped into Rx pad textarea; saved later via auto-save into `visits.raw_dictation` |
| Audio transcript | (returned to client only) | Same pad textarea path |
| Received ABDM FHIR bundle (parsed) | Storage `documents` bucket | `abdm-received/<transactionId>/<careContextRef>.json` |
| Received ABDM raw (undecryptable) content | Storage `documents` bucket | `abdm-received/<transactionId>/<careContextRef>-raw.txt` |
| Care context records | `abdm_care_contexts` | One per patient × care context |
| Consent artefacts (HIP-side notifications + HIU-side requests) | `abdm_consent_artefacts` | Keyed by `consent_id` |

---

## 13. Security & Production Readiness Gaps

These are explicitly TODO in the source — collected here so they are not lost:

1. **Gateway signature verification** (`validateGatewayRequest`) — currently checks only `X-HIP-ID` presence and proceeds anyway. Production must verify request signature against ABDM's published JWKS public key and enforce a timestamp window to defeat replays.
2. **OAuth2 token acquisition** (`_getAbdmAccessToken`) — stub returns `""`. Needs `POST /v3/gateway/sessions` with `{clientId, clientSecret, grantType: "client_credentials"}` and an in-memory cache keyed by expiry.
3. **Fidelius (ECDH/Curve25519 + AES-GCM) encryption** — both directions:
   - `abdm-hip-data-transfer` sends FHIR bundles UNENCRYPTED with a `console.warn` (sandbox-only acceptable).
   - `abdm-hiu-data-receive._decryptFidelius` is a stub. Plan in comments: derive shared secret with our private key + sender public key, derive AES key from shared secret + nonces, AES-GCM decrypt → FHIR Bundle JSON. WebCrypto API or `node-forge` recommended.
4. **SHA-256 checksum** on each FHIR bundle entry in `abdm-hip-data-transfer` push payload — currently empty string.
5. **Full consent-artefact fetch** in `abdm-hip-consent` — currently stores only `{consent_request_id, granted_at}` placeholder. Real `GET /v0.5/consents/fetch` should populate `patient_id, hi_types, date_range_from/to, expiry, purpose, requester_name`.
6. **Auth on web-initiated endpoints** — `abdm-identity` and `abdm-hiu-consent-request` accept any caller. Until Supabase Auth is wired in (see ABDM next-steps Step 8a), the anon key is the only barrier.
7. **Rate limiting** — none on any function.
8. **PII at rest** — anon key has full read access via the `anon_full_access` RLS policy used during POC.
9. **`SUPABASE_SERVICE_ROLE_KEY`** falls back to anon key in `process-document` with only a warning — DB writes still succeed because of the open RLS policy. This silently masks misconfiguration in production.
10. **Process-document `_saved_to_db` reporting** flips on lab save count only; vaccination save success isn't reflected in the boolean.

WASA "Safe-to-Host" certificate (CERT-IN empanelled auditor) is required by NHA before production credentials are issued.

---

## 14. Deployment

```bash
# Each function deployed independently
npx supabase functions deploy abdm-identity            --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy abdm-hip-discover        --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy abdm-hip-link            --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy abdm-hip-consent         --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy abdm-hip-data-transfer   --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy abdm-hiu-consent-request --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy abdm-hiu-data-receive    --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy process-document         --project-ref ecywxuqhnlkjtdshpcbc
npx supabase functions deploy transcribe-audio         --project-ref ecywxuqhnlkjtdshpcbc

# Logs
npx supabase functions logs <name> --project-ref ecywxuqhnlkjtdshpcbc
```

**Prerequisite secret rotation** before flipping any TODO outbound call: `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET`, `ABDM_HIU_ID`, `ABDM_GATEWAY_URL`. Production also needs `HOSPITAL.hfr_id` updated in `generate-fhir-bundle/index.ts` and `doctors.hpr_id` updated in the database for Dr. Lokender Goyal.

**Cross-references:**

- `radhakishan_system/docs/abdm/ABDM_comprehensive_adoption_plan.md` — full strategy.
- `radhakishan_system/docs/abdm/ABDM_integration_research.md` — research notes.
- `radhakishan_system/docs/abdm/ABDM_next_steps.md` — checklist (sandbox, HFR, HPR, SNOMED, security audit, go-live).
- `radhakishan_system/schema/abdm_schema.sql` — `abdm_care_contexts`, `abdm_consent_artefacts` DDL.
- `04-edge-functions-clinical.md` — `generate-fhir-bundle`, `generate-prescription`, `generate-visit-summary`.
