# 05 · Integration — ABDM / ABHA Identity, HIP/HIU, Consent, FHIR R4

> **Status:** TARGET-STATE rebuild specification. Build to this, not to the
> current `supabase/functions/abdm-*` + `generate-fhir-bundle` prototype.
> This document is the single source of truth for the ABDM/ABHA + FHIR R4
> integration of the rebuilt Radhakishan Pediatric OPD system. It is consistent
> with the TARGET-ARCHITECTURE DIGEST §7 (API + ABDM/FHIR), §1 (off-edge
> compute), §4 (bounded contexts), §5 (DB schema), §8 (security/DPDP), and §9
> (command bus). Where this document and the prototype disagree, this document
> wins.

---

## 0. Scope, vision, and the one load-bearing decision

Radhakishan Hospital is a NABH-accredited pediatric OPD in Kurukshetra, Haryana,
participating in the **Ayushman Bharat Digital Mission (ABDM)**. ABDM is India's
national health-data exchange: it federates patient identity (**ABHA** — Ayushman
Bharat Health Account), provider identity (**HPR** — Health Professional
Registry), and facility identity (**HFR** — Health Facility Registry), and moves
clinical records as **FHIR R4 document bundles** through a consent-gated,
end-to-end-encrypted exchange between **HIPs** (Health Information Providers, who
hold records) and **HIUs** (Health Information Users, who request them).

This system is a **HIP** first (it generates records) and a **HIU** second (it
pulls a returning patient's history from other facilities). The integration has
exactly one load-bearing architectural decision, and every other decision in this
document follows from it:

> **The ABDM/FHIR integration runs OFF-EDGE, behind ports, event-driven from the
> command bus. Sign-off NEVER blocks on it.** A `PrescriptionSigned` event is the
> trigger; FHIR generation, bundle signing, care-context linking, and HIP push
> are async subscribers on the worker (Cloud Run / Fly, §1 of the digest), never
> inline in the doctor's request path and never in a 150 s-capped Edge Function.

The prototype violates this on every axis (synchronous Edge Functions, hardcoded
anon keys, a forgeable 6-character QR hash, plaintext "encryption", an N+1
formulary re-fetch inside the bundle builder, blanket RLS over an anon key, an
empty `HFR_SYSTEM`/`hfr_id` baked into source). This spec replaces all of it.

### 0.1 What "done" looks like (acceptance summary)

| # | Capability | Acceptance signal |
|---|---|---|
| A1 | ABHA verify/create at registration (V3 API) | Patient row carries verified `abha_number` + `abha_address`; linking token stored encrypted; no PII in logs. |
| A2 | HIP push: 5 record types as valid NRCeS R4 bundles | FHIR validator CI gate passes; `Bundle.signature` present; care contexts linked to ABDM. |
| A3 | Consent-gated data transfer (HIP) | `on-data-request` validated against a `GRANTED` artefact whose HI-types/date-range cover the request; Fidelius-encrypted payload pushed. |
| A4 | Real gateway request auth | Inbound ABDM callbacks verified against the CM JWKS (JWS + timestamp + nonce); fail closed. |
| A5 | Signed QR verification | ES256 JWS QR; `verify.html` calls a read-only server endpoint; no PHI in the QR; QR rendered client-side. |
| A6 | HIU pull (deferred to M3) | Consent request → encrypted receive → decrypt → store as `verification_status='external'`. |

---

## 1. Where ABDM/FHIR sits in the target architecture

### 1.1 The `abdm` bounded context (digest §4.7)

ABDM is its own hexagon — an **anti-corruption layer** around a notoriously
quirky external gateway. It owns no clinical truth; it reads from `clinical`/
`prescribing`/`catalog` through ports and projects ABDM-specific state into the
`abdm` schema. Nothing in `core/` touches `fetch`, the ABDM SDK, or libsodium —
the fitness rules (`core_no_fetch`, `core_no_adapter_imports`,
`ports_no_adapter_imports`, extended from `dis/scripts/fitness-rules.json`)
enforce this at CI merge-time.

```
src/
  contexts/abdm/
    core/                pure: bundle-composition logic, consent-policy evaluation,
                         care-context derivation, state machine. No fetch/fs/SQL.
      fhir-composition.ts        FhirCompositionPort impl input → bundle (data in, not a DB)
      consent-policy.ts          evaluate(artefact, request) → allow|deny|reason
      care-context.ts            derive(visit, rx, labs, vax) → care contexts + record types
      abdm-state-machine.ts      transition(state, event) — the safety spine (§9)
    ports/               interfaces only — the narrow waist
      abdm-gateway.port.ts       AbdmGatewayPort  (session/auth, on-* callbacks, push, consent)
      crypto-box.port.ts         CryptoBoxPort    (Fidelius — Curve25519 SW)
      signature.port.ts          SignaturePort    (ES256 JWS sign/verify, QR)
      fhir-composition.port.ts   FhirCompositionPort (data → R4 bundle; pure)
      terminology.port.ts        TerminologyPort  (ICD-10 ↔ SNOMED ↔ LOINC lookup)
    adapters/            vendor edge — each has a __fakes__/ peer
      gateway/abdm-v3.adapter.ts          real ABDM Gateway V3 (HTTPS + JWS)
      gateway/__fakes__/sandbox.fake.ts   deterministic sandbox for tests
      crypto/fidelius.adapter.ts          Curve25519 Short-Weierstrass ECDH + AES-GCM
      crypto/__fakes__/crypto.fake.ts
      signature/es256-jws.adapter.ts
      fhir/nrces-r4.adapter.ts            ports the 1680-LOC builders, decoupled from DB
    workers/             off-edge handlers subscribed to the bus
      on-prescription-signed.ts           PrescriptionSigned → build+sign+link+push
      on-data-request.ts                  ABDM on-data-request → consent-check → push
      on-consent-notify.ts                ABDM consent grant/revoke → persist artefact
    wiring/              the ONLY composition root for this context
```

### 1.2 Off-edge, event-driven (digest §1, §2)

| Concern | Prototype (retire) | Target |
|---|---|---|
| Compute host | Supabase Edge Function, 150 s wall clock | Hono container on Cloud Run / Fly; SQS/pgmq-driven workers |
| Trigger | Frontend `fetch('/functions/v1/generate-fhir-bundle')` inline | `PrescriptionSigned` domain event → `abdm.fhir_outbox` → worker |
| Inbound ABDM callbacks | Edge Function is the tool-loop host | Thin signed-webhook receiver: `verify JWS → enqueue → 202`; worker does the work |
| Realtime to clinician | n/a | SSE / status-row poll on the job (digest §3); ABDM never blocks the pad |
| Secrets | Hardcoded anon key + `Deno.env.get` | `SecretsPort` (Supabase secrets POC → AWS Secrets Manager prod) |

**Edge Functions, if kept at all, are reduced to `validate → enqueue → 202`
relays for ABDM callbacks** — never the place where a tool loop, an HTTP round
trip to the gateway, or encryption happens.

### 1.3 The reliable-callback substrate (digest §5, §7)

ABDM is asynchronous and at-least-once: every action is a request/`on-*`-callback
pair correlated by `requestId`/`transactionId`, and the gateway retries. We mirror
the `dis/` `M004_dis_jobs` durable-queue pattern with an **outbox/inbox** pair:

- `abdm.outbox` — our intent to call ABDM (link care context, push HI). Drained
  by a worker, retried with backoff, idempotent on `correlation_id`.
- `abdm.inbox` — every inbound ABDM callback, persisted **before** processing,
  deduped on `(request_id)`, so a gateway retry is a no-op and a crash mid-handler
  replays cleanly.

This is the schema half of the latency/reliability fix and is detailed in §6.

---

## 2. ABDM identity — ABHA, HPR, HFR

### 2.1 Prerequisites (blocker — move out of source NOW)

The prototype bakes `HOSPITAL.hfr_id = ""` and `HPR_SYSTEM`/`HFR_SYSTEM` constants
into `generate-fhir-bundle/index.ts`. An empty HFR ID is a **hard blocker** for
HIP registration — without it the facility cannot be discovered on ABDM and no
push succeeds. These are config/secrets, not source:

| Value | Where it lives | Notes |
|---|---|---|
| `ABDM_HFR_ID` | `ConfigPort` (non-secret) | Facility ID from HFR registration. Required for HIP bridge onboarding. |
| `ABDM_HIP_ID` / `ABDM_HIU_ID` | `ConfigPort` | Bridge service IDs registered on ABDM. |
| Default practitioner `hpr_id` (Dr. Lokender Goyal) | `identity.practitioners` DB column | Already a column (`doctors.hpr_id`); populate it, never default to a placeholder. |
| `ABDM_CLIENT_ID` / `ABDM_CLIENT_SECRET` | `SecretsPort` | Bridge session credentials. |
| `ABDM_GATEWAY_URL` | `ConfigPort`, env-flipped | Sandbox `https://dev.abdm.gov.in` → prod `https://live.abdm.gov.in`. |
| `ABDM_CM_JWKS_URL` | `ConfigPort` | Consent-manager public keys for inbound JWS verification (§4). |

`env.schema.ts` (Zod, fail-fast on boot, the `dis/` pattern) MUST require
`ABDM_HFR_ID`, `ABDM_HIP_ID`, `ABDM_CLIENT_ID/SECRET`, and `ABDM_CM_JWKS_URL`
when `ABDM_ENABLED=true`, exactly as `dis/`'s `env.schema.ts` requires
`SUPABASE_*` when `DIS_STACK=supabase`.

### 2.2 ABHA at registration (Milestone 1 — ship first)

ABHA capture happens on the **Registration page** (digest workflow stage 1),
behind the client `DataAccessPort`/`ConfigPort`, never with a hardcoded key.
Two entry points, both through `AbdmGatewayPort`:

1. **Verify an existing ABHA** (number or address). The patient provides a
   14-digit ABHA number or `abha@abdm` address; the service runs the **V3
   verification flow** and, on success, stores `abha_number`, `abha_address`,
   `abha_verified=true`, and an **encrypted** short-lived linking token.
2. **Create a new ABHA** via Aadhaar/mobile OTP (V3 enrollment). Deferred behind
   a feature flag until sandbox credentials are live, but the port shape is final
   so the worker code does not change when it lands.
3. **Scan & Share** — the patient scans the facility QR in their PHR app; ABDM
   posts the profile to our **signed-webhook receiver**, which verifies the JWS
   (§4), matches/creates the patient, and links.

#### `AbdmGatewayPort` (the anti-corruption seam)

```typescript
// contexts/abdm/ports/abdm-gateway.port.ts — interface only, no fetch here.
export interface AbdmGatewayPort {
  /** Bridge session: exchanges client_id/secret for a short-lived access token,
   *  cached per portability.md §Secrets (≈ token TTL minus a safety margin). */
  session(): Promise<{ accessToken: string; expiresAt: string }>;

  // --- Identity (M1) ---
  verifyAbha(input: AbhaVerifyInput): Promise<AbhaProfile>;          // V3 verify
  initAbhaCreate(input: AbhaCreateInit): Promise<{ txnId: string }>; // V3 enrol OTP req
  confirmAbhaCreate(input: AbhaCreateConfirm): Promise<AbhaProfile>; // V3 enrol byAadhaar

  // --- Care-context linking (M2, HIP) ---
  linkCareContexts(input: LinkCareContextInput): Promise<LinkAck>;

  // --- HI exchange (M2 HIP push / M3 HIU pull) ---
  pushHealthInformation(input: HiPushInput): Promise<PushAck>;
  notifyHiStatus(input: HiStatusNotify): Promise<void>;

  // --- Consent (M3, HIU) ---
  requestConsent(input: ConsentRequestInput): Promise<{ consentRequestId: string }>;

  /** on-* callbacks are NOT methods here — they arrive at the webhook receiver,
   *  are verified, persisted to abdm.inbox, and dispatched to workers. */
}
```

Every method has a `__fake__` deterministic sandbox peer so the identity,
linking, and push flows are unit-tested with zero network and sub-second suites
(digest §1 fakes-only core).

#### Data captured (target `identity` / `clinical` schemas)

The existing `abdm_schema.sql` columns are kept but **re-homed and hardened**:

- `clinical.patients.abha_number` — `UNIQUE` partial index (already present), plus
  a `CHECK` on the 14-digit normalized form. UHID remains the business key; ABHA
  is a secondary identifier, never a PK.
- `abha_linking_token` — **never stored plaintext.** Encrypt at the `SecretsPort`/
  `CryptoBoxPort` boundary; it is a 24-hour bearer credential. The prototype's
  `TODO: Also store linking_token` is closed by an encrypted column + a TTL sweep.
- `identity.practitioners.hpr_id` — populated from HPR; surfaced in the FHIR
  `Practitioner.identifier` with `HPR_SYSTEM`.

---

## 3. FHIR R4 bundle generation (NRCeS / ABDM Milestone 2)

### 3.1 What to keep, what to fix

The prototype's `generate-fhir-bundle/index.ts` (1680 LOC) is **strong domain
logic with bad coupling**. Port the NRCeS R4 builders verbatim into a **pure
adapter** behind `FhirCompositionPort`; fix four defects:

| Defect in prototype | Fix |
|---|---|
| Builder takes a DB and re-fetches formulary/`standard_prescriptions` per medicine/diagnosis (N+1, lines 897–934, 1194–1230) | `FhirCompositionPort.build(input)` takes **fully-resolved data**, not a DB. SNOMED/LOINC enrichment happens **once**, upstream, via `TerminologyPort` against `catalog.concepts`. The adapter is pure: data in, bundle out. |
| No `Bundle.signature` | Add ES256 JWS `Bundle.signature` (digest §7) — NRCeS mandates a signed document bundle for HIP push. |
| No `DocumentReference` / no `Composition` narrative on some types | Add `DocumentReference` for `HealthDocumentRecord` (uploaded scans), and a generated XHTML narrative on every `Composition`. |
| Validated only by eyeball | **FHIR-validator CI gate** (NRCeS profiles) + golden-snapshot tests (digest §10). |

### 3.2 The five record types (ABDM M2 mandate)

Unchanged from the prototype's coverage, now produced by the pure adapter:

| Composition profile | Source data | Key resources |
|---|---|---|
| `OPConsultRecord` | `visits` (+ vitals), `prescriptions`, allergies, diagnoses | Composition, Patient, Practitioner, Organization, Encounter, Condition[], AllergyIntolerance[], Observation[] (vitals), MedicationRequest[], ServiceRequest[] |
| `PrescriptionRecord` | `prescriptions.generated_json` | Composition, Patient, Practitioner, Encounter, Condition[] (reason), MedicationRequest[] |
| `DiagnosticReportRecord` | `lab_results` | Composition, Patient, Practitioner, DiagnosticReport, Observation[] (lab) |
| `ImmunizationRecord` | `vaccinations` (IAP/NHM) | Composition, Patient, Practitioner, Immunization[] |
| `HealthDocumentRecord` | `documents` bucket uploads | Composition, Patient, **DocumentReference** (base64 / URL + content type) |

### 3.3 Terminology integrity (digest §5)

Codes are validated **on write** and resolved once, not re-fetched per resource.
`catalog.concepts(system ∈ {ICD10, SNOMED, LOINC}, code, display)` is the single
governed table; `formulary`, `standard_prescriptions`, and `lab_results` carry
FK references into it. The FHIR adapter consumes already-coded data:

| FHIR element | Code system | Source column |
|---|---|---|
| `Condition.code` | ICD-10 (`http://hl7.org/fhir/sid/icd-10`) + SNOMED | `visits.diagnosis_codes` → `concepts` |
| `MedicationRequest.medicationCodeableConcept` | SNOMED CT | `formulary.snomed_code/display` |
| `Observation.code` (vitals) | LOINC | static `VITAL_LOINC` map (kept) |
| `Observation.code` (labs) | LOINC + SNOMED | `lab_results.loinc_code/snomed_code` |
| `dosage.route` | SNOMED route | `ROUTE_CODES` map (kept; widen coverage) |

The `nebulisation → "Transdermal route"` mis-mapping in the prototype's
`ROUTE_CODES` is a **known bug** — fix the SNOMED code for nebulisation/inhalation
in the rebuild; do not port the wrong code.

### 3.4 `FhirCompositionPort` contract

```typescript
// contexts/abdm/ports/fhir-composition.port.ts
export interface FhirCompositionPort {
  /** Pure: fully-resolved, terminology-coded input → NRCeS R4 document Bundle.
   *  No DB, no fetch, no clock — `timestamp` is injected by the caller for
   *  deterministic snapshots and cache-stable bundles. */
  build(input: BundleInput): FhirBundle; // signature applied separately by SignaturePort
}

export type BundleInput =
  | { type: 'OPConsultation';      patient: P; practitioner: Pr; org: O; encounter: E; visit: V; rx?: Rx; timestamp: string }
  | { type: 'Prescription';        patient: P; practitioner: Pr; encounter: E; rx: Rx;  timestamp: string }
  | { type: 'DiagnosticReport';    patient: P; practitioner: Pr; encounter?: E; labs: Lab[]; timestamp: string }
  | { type: 'ImmunizationRecord';  patient: P; practitioner: Pr; vaccinations: Vax[]; timestamp: string }
  | { type: 'HealthDocumentRecord';patient: P; practitioner: Pr; documents: Doc[]; timestamp: string };
```

PII-stripping is enforced as a **typed boundary**, not ad-hoc `.map()`: the
input types only expose what each profile needs.

### 3.5 Persistence and provenance

The signed bundle is stored on `prescribing.prescriptions.fhir_bundle` (JSONB,
already a column) and content-hashed for tamper-evidence (digest §5 append-only
audit). Bundles are immutable; a re-issue creates a new `rx_versions` row, never
an in-place edit.

---

## 4. Gateway request authentication — fail closed (digest §7, §8)

This is the single largest security gap in the prototype. `validateGatewayRequest`
in `abdm-hip-data-transfer/index.ts` checks only for the presence of an
`X-HIP-ID` header and then **processes anyway** ("Gateway validation failed —
processing anyway for sandbox"). That is an unauthenticated, internet-reachable
endpoint that returns PHI. The rebuild **fails closed**.

### 4.1 Inbound (ABDM → us): verify the JWS

Every ABDM callback (`on-discover`, `on-link`, `on-init`, `on-confirm`,
`on-data-request`, consent notifications) carries a signature in the gateway's
auth header. The webhook receiver:

1. **Persists the raw body to `abdm.inbox` first** (dedupe on `request_id`),
   before any processing — at-least-once safety.
2. **Verifies the JWS against the ABDM CM JWKS** (`ABDM_CM_JWKS_URL`, cached per
   `SecretsPort`/HTTP cache semantics), via `SignaturePort.verify`.
3. **Checks `timestamp` freshness** (reject > N seconds skew) and **nonce
   uniqueness** to prevent replay.
4. On any failure → **HTTP 401, no body, audit-logged.** No "process anyway".
5. On success → `enqueue → 202`. The worker does the real work.

### 4.2 Outbound (us → ABDM): bridge session + signing

`AbdmGatewayPort.session()` exchanges `ABDM_CLIENT_ID/SECRET` for a short-lived
token; outbound requests are signed/authorized as the gateway requires, with
backoff+jitter on 429/5xx (the `dis/` retry discipline). The service-role key
**never** appears in any client-reachable path (digest §8).

### 4.3 `SignaturePort` — kills the forgeable QR (digest §7)

The prototype's QR verification (`web/prescription-output.html:870`,
`verify.html`) hashes the receipt with a **6-character static salt**
(`"rkh-salt-2026"`) and embeds the result in a QR rendered via
`api.qrserver.com` (PHI/identifiers in a third-party URL). This is trivially
forgeable and leaks data. Replace wholesale:

```typescript
// contexts/abdm/ports/signature.port.ts
export interface SignaturePort {
  signJws(payload: object, kid: string): Promise<string>;   // ES256 JWS
  verifyJws(jws: string, jwks: Jwks): Promise<object>;      // throws on invalid
}
```

- The printed Rx carries an **ES256 JWS** (asymmetric, unforgeable) covering a
  minimal claim set (Rx id, content hash, issued-at) — **no PHI**.
- The QR is **rendered client-side** (inline SVG / canvas) — drop `api.qrserver.com`.
- `verify.html` calls a **read-only server endpoint** that verifies the JWS
  against the published JWKS and returns a yes/no + the non-PHI claim set. The
  QR URL contains no patient data.
- The same `SignaturePort` produces the `Bundle.signature` in §3.1.

---

## 5. Consent, HIP, and HIU — the exchange flows

### 5.1 Sequencing (digest §7 — decisive)

> **M1 (ABHA at registration) → M2 (HIP push) first; defer M3 (HIU pull).**

| Milestone | Role | Flows | Status |
|---|---|---|---|
| M1 | — | ABHA verify/create/scan-share at registration | Ship first |
| M2 | **HIP** | Care-context discovery & linking; consent-gated data push (OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord) | Second |
| M3 | **HIU** | Consent request → encrypted receive → store external records for returning patients | Deferred |

### 5.2 HIP — care-context linking and discovery

A **care context** is one linkable health-record unit — typically one OPD visit
plus its prescription, derived deterministically by `core/care-context.ts`:

```
derive(visit, rx, labs, vax) → CareContext {
  care_context_ref : 'RKH-CC-<uuid>',
  display_text     : 'OPD Visit — 17 Mar 2026',
  record_types     : ['OPConsultation','Prescription', ...present types only]
}
```

On `PrescriptionSigned`, the `on-prescription-signed` worker:
1. Derives care contexts, writes `abdm.care_contexts` (kept from the prototype,
   re-homed to the `abdm` schema with `version`/`correlation_id`/`facility_id`).
2. Enqueues a `linkCareContexts` intent to `abdm.outbox`.
3. The outbox drainer calls `AbdmGatewayPort.linkCareContexts`; on the `on-link`
   callback the worker marks `linked=true, linked_at`.

**Discovery** (`on-discover`): ABDM asks "do you hold records for this patient?".
The HIP-discover worker matches by ABHA / demographics + verified mobile, returns
matching care contexts, and **never** returns records — discovery is metadata only.

### 5.3 Consent artefacts — the authorization gate

`abdm.consent_artefacts` (kept, hardened) is the authorization record. A grant
notification persists the **full artefact JSON**, HI-types, date range, expiry,
and purpose (`CAREMGT`/`BTG`/`PUBHLTH`). `core/consent-policy.ts` is the pure
evaluator used before any push:

```typescript
// pure — no IO. The data-transfer worker calls this BEFORE building any bundle.
export function evaluateConsent(artefact: ConsentArtefact, req: HiRequest): ConsentDecision {
  if (artefact.status !== 'GRANTED')                 return deny('NOT_GRANTED');
  if (now() > artefact.expiry)                        return deny('EXPIRED');
  if (!coversDateRange(artefact, req.dateRange))      return deny('OUT_OF_RANGE');
  if (!coversHiTypes(artefact, req.hiTypes))          return deny('HI_TYPE_NOT_CONSENTED');
  return allow();
}
```

This closes the prototype's gap: it checks only `status === 'GRANTED'` (line ~ in
`abdm-hip-data-transfer`) and ignores date-range and HI-type scoping, so a
narrow consent could leak broad data. The rebuild **filters the pushed records to
exactly the consented HI-types and date range**, and a revoked/expired artefact
short-circuits to a typed `ERRORED` acknowledgement.

### 5.4 HIP data transfer — the encryption that actually encrypts

On `on-data-request`, after consent passes, the `on-data-request` worker:
1. Builds **only the consented** bundles via `FhirCompositionPort` (data already
   resolved — no N+1).
2. **Encrypts with Fidelius** (§5.5) using the requester's `keyMaterial` from the
   request.
3. Pushes to `dataPushUrl` and sends an HI-status notification.

The prototype's `// TODO: Implement Fidelius … For sandbox we send unencrypted`
is a **release blocker**. Plaintext PHI transfer is gated behind a double-locked
sandbox flag that is **off** in any non-dev environment (digest §7).

### 5.5 `CryptoBoxPort` — Fidelius (the correct curve)

ABDM's Fidelius uses **Curve25519 in Short-Weierstrass form for ECDH**, then
HKDF + AES-GCM. The most common implementation mistake — and the trap to avoid —
is reaching for libsodium's **Montgomery-form X25519**, which is *not*
interoperable with ABDM's Java Fidelius reference. The digest is explicit
(§7): **Curve25519 Short-Weierstrass, NOT libsodium Montgomery.**

```typescript
// contexts/abdm/ports/crypto-box.port.ts
export interface CryptoBoxPort {
  /** Generate our ephemeral ECDH key pair (Curve25519 Short-Weierstrass). */
  generateKeyPair(): Promise<{ publicKeyB64: string; privateKeyHandle: KeyHandle }>;

  /** HIP→HIU: ECDH(ourPriv, theirPub) → HKDF(nonce) → AES-GCM encrypt. */
  encrypt(input: EncryptInput): Promise<EncryptedBlock>;   // → { encryptedData, keyMaterial, nonce }

  /** HIU←HIP: the inverse, for M3 receive. */
  decrypt(input: DecryptInput): Promise<string>;
}
```

The adapter (`crypto/fidelius.adapter.ts`) is the only place curve crypto lives;
plaintext output is gated behind a sandbox flag in the adapter, never in core.
Golden interop fixtures (encrypt → decrypt round-trip against ABDM-reference test
vectors) are a **TDD gate** before this path is trusted (digest §10).

### 5.6 HIU pull (M3, deferred)

The returning-patient story (digest workflow): for a patient with an ABHA, the
HIU service requests consent, receives encrypted records, decrypts via
`CryptoBoxPort.decrypt`, and stores them as **external** records
(`verification_status='external'`, the `dis/` legacy/external convention) so they
feed `get_previous_rx`/`get_lab_history` for the AI generation context — always
PII-handled through the typed boundary. Port shape is final now; implementation
lands after M2 is in production.

---

## 6. Target database schema — `abdm` bounded-context

DDD schema separation (digest §5). Every mutable table carries the standard
surrogate `id uuid`, `created_at`, `updated_at`, `version int` (optimistic lock →
409 `VersionConflictError`), `correlation_id`, `facility_id`. **No DELETE policy**
on these tables (append-only / soft-state only). RLS uses the portable
`current_setting('app.role' / 'app.facility_id')` pattern from `dis/` `M008`, so
the same policy file runs on Supabase and AWS RDS.

```sql
-- M-ABDM-001  reliable callback substrate (mirrors dis/ M004_dis_jobs)
create table abdm.inbox (
  id             uuid primary key default gen_random_uuid(),
  request_id     text not null,                    -- ABDM requestId (dedupe key)
  callback_type  text not null,                    -- on-discover | on-link | on-data-request | ...
  raw_body       jsonb not null,                   -- persisted BEFORE processing
  jws_verified   boolean not null default false,
  status         text not null default 'received'
                 check (status in ('received','processing','done','failed','dead')),
  attempts       int not null default 0,
  correlation_id text not null,
  facility_id    uuid not null,
  last_error     text,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz
);
create unique index uq_abdm_inbox_request on abdm.inbox(request_id);  -- retry = no-op
create index idx_abdm_inbox_ready on abdm.inbox(callback_type, received_at)
  where processed_at is null;

create table abdm.outbox (                          -- our intent to call ABDM
  id             uuid primary key default gen_random_uuid(),
  topic          text not null,                     -- link_care_context | push_hi | request_consent
  payload        jsonb not null,
  status         text not null default 'pending'
                 check (status in ('pending','running','done','failed','dead')),
  attempts       int not null default 0,
  max_attempts   int not null default 5,
  available_at   timestamptz not null default now(),
  locked_until   timestamptz,
  locked_by      text,
  idempotency_key text not null,
  correlation_id text not null,
  facility_id    uuid not null,
  last_error     text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create unique index uq_abdm_outbox_idem on abdm.outbox(idempotency_key);
create index idx_abdm_outbox_ready on abdm.outbox(topic, available_at)
  where completed_at is null;

-- M-ABDM-002  care contexts (re-homed from abdm_care_contexts, hardened)
create table abdm.care_contexts (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references clinical.patients(id),
  visit_id         uuid,
  prescription_id  uuid,
  -- composite FK so DB enforces visit↔prescription consistency (digest §5)
  foreign key (visit_id, patient_id) references clinical.visits(id, patient_id),
  care_context_ref text not null unique,            -- 'RKH-CC-<uuid>'
  display_text     text not null,
  record_types     text[] not null,
  linked           boolean not null default false,
  linked_at        timestamptz,
  version          int not null default 1,
  correlation_id   text not null,
  facility_id      uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- M-ABDM-003  consent artefacts (re-homed, with policy fields enforced)
create table abdm.consent_artefacts (
  id              uuid primary key default gen_random_uuid(),
  consent_id      text not null unique,
  patient_id      uuid references clinical.patients(id),
  requester_name  text,
  purpose         text,                             -- CAREMGT | BTG | PUBHLTH
  hi_types        text[] not null,
  date_range_from timestamptz not null,
  date_range_to   timestamptz not null,
  expiry          timestamptz not null,
  status          text not null default 'REQUESTED'
                  check (status in ('REQUESTED','GRANTED','DENIED','REVOKED','EXPIRED')),
  artefact_json   jsonb not null,
  version         int not null default 1,
  facility_id     uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- M-ABDM-004  FHIR bundle audit (one row per generation, append-only)
create table abdm.fhir_bundles (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid references prescribing.prescriptions(id),
  record_type     text not null,
  content_hash    text not null,                    -- tamper-evidence
  signed          boolean not null default false,
  validator_pass  boolean,                          -- NRCeS profile validation result
  correlation_id  text not null,
  facility_id     uuid not null,
  created_at      timestamptz not null default now()
);

-- RLS (dis/ M008 pattern; portable current_setting; NO delete policy)
alter table abdm.inbox             enable row level security;
alter table abdm.outbox            enable row level security;
alter table abdm.care_contexts     enable row level security;
alter table abdm.consent_artefacts enable row level security;
alter table abdm.fhir_bundles      enable row level security;

create policy abdm_service_all on abdm.outbox for all
  using (current_setting('app.role', true) = 'service')
  with check (current_setting('app.role', true) = 'service');
-- care_contexts / consent_artefacts: service writes; doctor/admin read scoped by facility.
create policy cc_read on abdm.care_contexts for select
  using (current_setting('app.role', true) in ('service','doctor','admin')
         and facility_id::text = current_setting('app.facility_id', true));
-- (analogous read/insert/update policies per table; no DELETE policy anywhere)
```

This replaces `abdm_schema.sql`'s `authenticated_full_access` blanket policy
over an anon key — the single biggest DPDP/NABH/CERT-In liability in the
prototype (digest §8). The anon key never touches `abdm` (or any clinical) schema.

---

## 7. API surface (digest §7)

OpenAPI 3.1 is source-of-truth, diffed against routes in CI. ABDM endpoints split
into **inbound webhooks** (signed, thin, `validate → enqueue → 202`) and
**internal triggers** (off the bus).

| Method · Path | Role | Auth | Behavior |
|---|---|---|---|
| `POST /abdm/webhooks/discover` | HIP | ABDM JWS | persist inbox → 202 |
| `POST /abdm/webhooks/link` | HIP | ABDM JWS | persist inbox → 202 |
| `POST /abdm/webhooks/data-request` | HIP | ABDM JWS | persist inbox → 202 |
| `POST /abdm/webhooks/consent-notify` | HIP/HIU | ABDM JWS | persist inbox → 202 |
| `POST /abdm/webhooks/scan-share` | HIP | ABDM JWS | persist inbox → 202 |
| `GET  /rx/{id}/verify` | public | none (read-only) | verify ES256 JWS → `{ valid, claims }`, **no PHI** |
| `POST /abdm/identity/verify` | reception | JWT (reception/admin) | sync ABHA verify (short call, may stay sync) |
| `POST /abdm/identity/create` | reception | JWT | ABHA enrol (OTP txn) |

Internal events (not HTTP): `PrescriptionSigned` → `on-prescription-signed`;
`ConsentGranted/Revoked` → `on-consent-notify`. Every write carries
`Idempotency-Key`; every response carries `correlation_id`; errors use the
envelope `{error:{code,message,correlation_id,retryable}}`.

---

## 8. Security, PII, and DPDP/NABH compliance (digest §8)

| Control | Target |
|---|---|
| **Secrets** | All ABDM creds via `SecretsPort`. `ABDM_CLIENT_SECRET`, service-role key, signing private key NEVER in client, logs, URLs, or commit messages. |
| **Fail-closed gateway auth** | Inbound JWS verified against CM JWKS + timestamp + nonce; reject on failure (§4). No "process anyway". |
| **No PII to the model / no PII in QR** | FHIR input is a typed PII-minimized boundary; the QR carries only Rx id + hash + issued-at. |
| **Encryption** | Fidelius (Curve25519 SW + AES-GCM); plaintext gated behind a double-locked sandbox flag, off in prod. |
| **DPDP Act 2023 + Rules 2025** | ~Every patient is a child <18. Healthcare exemption covers routine care only — ABDM sharing is service delivery, not secondary use. **Guardian consent at registration** (timestamped, plain-language notice, withdrawal path) is captured separately from ABDM consent artefacts. |
| **Breach runbook** | DPB notify "without delay" + full report 72 h; affected principals 72 h; **CERT-In 6 h** — both clocks run. |
| **NABH Digital Health 2nd ed. (Sep 2025)** | ABDM + real RLS + append-only audit earns Silver→Gold. |
| **Auditability** | Every ABDM action is an event row: inbound callback (inbox), outbound intent (outbox), consent decision, bundle generation (`fhir_bundles` with content hash), JWS verify result. Replaces heuristic `console.log`. |

---

## 9. Command-bus / symmetric-actor integration (digest §9)

ABDM is a **subscriber on the same bus** as everything else; it is not special.
The clinical-safety invariant holds: an ABDM push is **never** triggered by an
unreviewed draft — only a human (or future AI agent) `SignOff` command emits
`PrescriptionSigned`, and only that event drives FHIR/HIP. The pure
`abdm-state-machine.ts transition(state, event)` is the safety spine; invalid
transitions throw and are never persisted, even on failure paths:

```
not_pushed → bundle_built → bundle_signed → care_context_linked → pushed
                                                                 ↘ push_failed (retry via outbox)
                                                                 ↘ revoked (consent withdrawn → halt)
```

Going AI-first later is an additive subscriber that emits the same commands — no
rewrite. The webhook receiver, the outbox drainer, and a future autonomous agent
all act through `AbdmGatewayPort`; humans and AI are symmetric.

---

## 10. Build order & gates (digest §10)

1. **Config/secrets first.** `env.schema.ts` requires `ABDM_HFR_ID`, `ABDM_HIP_ID`,
   `ABDM_CLIENT_ID/SECRET`, `ABDM_CM_JWKS_URL` when `ABDM_ENABLED`. Remove every
   hardcoded URL/anon-key/`hfr_id=""` from `supabase/functions/abdm-*` and
   `generate-fhir-bundle`.
2. **Ports + fakes.** `AbdmGatewayPort`, `CryptoBoxPort`, `SignaturePort`,
   `FhirCompositionPort`, `TerminologyPort`, each with a `__fake__`. Extend
   `fitness-rules.json` to the `abdm` context.
3. **Pure `NrcesR4Adapter`.** Port the 1680-LOC builders; decouple from the DB;
   add `Bundle.signature`, `DocumentReference`, narrative. **FHIR-validator CI
   gate + golden snapshots** before trust.
4. **`SignaturePort` + signed QR.** Retire `rkh-salt-2026` and `api.qrserver.com`;
   add the read-only `/rx/{id}/verify` endpoint.
5. **Gateway auth.** JWS verify against CM JWKS + timestamp + nonce; inbox-first
   webhook receiver; fail closed.
6. **`CryptoBoxPort` (Fidelius).** Curve25519 Short-Weierstrass + AES-GCM;
   **interop round-trip fixtures against ABDM reference vectors** as a TDD gate.
7. **M1 → M2 sequencing.** ABHA at registration; then HIP discovery/link/push;
   defer M3 HIU.
8. **Shadow rollout.** Generate + sign + validate in shadow (no actual push),
   diff against legacy Edge output behind a feature-flag ladder
   (`ENABLED → SHADOW → OPT_IN_OPERATORS → *`) + kill-switch before cutover.

### What gets gated (the discipline suite under `09_engineering_discipline/`
owns the runner; this spec defines WHAT)

- FHIR snapshot validation against NRCeS profiles (every record type).
- `Bundle.signature` present and verifiable.
- `GenerationPort`/`AbdmGatewayPort` state-contract tests (port behavior).
- Fidelius encrypt↔decrypt interop against ABDM reference vectors.
- Consent-policy unit tests: expired / out-of-range / wrong HI-type → deny;
  pushed records are exactly the consented subset.
- No-PII-in-QR test: QR payload contains no patient identifiers.
- Inbound JWS verification: tampered / stale / replayed callbacks → 401.

---

### Key file references (port-from, then retire)

| Prototype artifact | Disposition |
|---|---|
| `supabase/functions/generate-fhir-bundle/index.ts` (1680 LOC) | Port builders into pure `NrcesR4Adapter`; kill N+1 (lines 897–934, 1194–1230), empty `hfr_id` (line 44), hardcoded anon key (line 22), `nebulisation` SNOMED bug. |
| `supabase/functions/abdm-identity/index.ts` | Replace mock with V3 verify/enrol behind `AbdmGatewayPort`; encrypt linking token. |
| `supabase/functions/abdm-hip-data-transfer/index.ts` | Replace `validateGatewayRequest` (header-only, "process anyway") with fail-closed JWS verify; implement Fidelius; enforce HI-type/date-range consent filtering. |
| `supabase/functions/abdm-hip-{discover,link,consent}/index.ts`, `abdm-hiu-*` | Re-home as off-edge workers + thin webhook receivers; inbox-first. |
| `radhakishan_system/schema/abdm_schema.sql` | Migrate columns into `abdm` schema (§6); replace `authenticated_full_access` blanket RLS with `current_setting` per-role policies. |
| `web/prescription-output.html:870`, `web/verify.html` | Replace `rkh-salt-2026` hash + `api.qrserver.com` with ES256 JWS + client-rendered QR + read-only verify endpoint. |
| Foundation (`origin/feat/dis-plan`) | `dis/src/ports/*`, `dis/src/core/{state-machine,error-envelope,audit-log,env.schema}.ts`, `dis/scripts/fitness-rules.json`, `dis/migrations/{M004_dis_jobs,M008_rls_policies}.sql` — the exact patterns the `abdm` context copies. |
