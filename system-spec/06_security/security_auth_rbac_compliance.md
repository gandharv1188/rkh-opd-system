# Security, Authentication, Authorization & Compliance

> **Scope.** This is the **target-state** security specification for the rebuilt Radhakishan pediatric OPD prescription system. It is the single source of truth for: authentication (authn), authorization + RBAC (authz), PII/PHI handling, secrets & configuration management, audit logging, and regulatory compliance (**NABH Digital Health**, **ABDM**, **DPDP Act 2023 + Rules 2025**, **CERT-In**).
>
> **It replaces the prototype's security model entirely.** The current `web/` + Edge-Function POC ships a hardcoded Supabase **anon JWT** in every static HTML page, a blanket `authenticated_full_access` RLS policy, `Access-Control-Allow-Origin: *`, client-side ID allocation, no real user identity, and `console.log`-grade "audit". Every one of those is a DPDP / NABH / CERT-In liability and is explicitly designed out below.
>
> **Build to this, not to the prototype.** Where this file and an upstream study report disagree, this file wins. Engineering-discipline mechanics (TDD gates, eval runners, review checklists) are owned by `09_engineering_discipline/`; this file defines *what* security properties must hold and *how* they are enforced in code, not the CI runner that enforces them.

---

## 0. Threat Model & Security Posture (decisive)

The system handles **child PHI** (almost every patient is <18), generates **legally-significant prescriptions**, and federates to a **national health network (ABDM)**. The posture is therefore **fail-closed, least-privilege, defense-in-depth, fully-audited**.

### 0.1 Assets, actors, trust boundaries

| Asset | Sensitivity | Primary threat |
|---|---|---|
| Patient PII/PHI (demographics, allergies, vitals, labs, growth, Rx) | DPDP "personal data of a child" — highest | Unauthorized read/exfiltration; tampering |
| Signed prescriptions | Legal medical record (NABH) | Forgery, post-signature tampering, repudiation |
| ABDM credentials + Fidelius keys | Network-federation secret | Leakage → impersonation of the HIP/HIU |
| `ANTHROPIC_API_KEY` / service-role key | Billing + full-DB power | Client exposure → financial + data-breach blast radius |
| Audit log | Compliance evidence | Tampering, deletion, gaps |

| Actor | Identity source | Trust |
|---|---|---|
| Reception / Nurse / Doctor / Admin | Supabase Auth user (real JWT) | Authenticated, role-scoped |
| `service` (workers, gateway) | Service identity (signed service token / OIDC) | Trusted backend, never client-reachable |
| AI generation agent | Acts **only** through the `service` identity on the CommandBus | Symmetric actor, **cannot** sign off |
| ABDM Gateway / CM | mTLS + JWS verified against ABDM JWKS | External, verified-then-trusted |
| Anonymous public | none | QR **verify** endpoint only (read-only, no PHI) |

**Trust boundaries:** (1) Browser ↔ API Gateway (Hono) — the only ingress for clinical data; (2) Gateway ↔ Workers ↔ Postgres — all `service`-identity, network-isolated; (3) System ↔ ABDM Gateway — mTLS + JWS; (4) System ↔ Anthropic API — server-side only, key never leaves the worker.

### 0.2 Non-negotiable security invariants (enforced as code, not prose)

| # | Invariant | Enforcement |
|---|---|---|
| SEC-1 | **No vendor key reaches the browser.** No anon key, no service key, no model key in client bundle. | `core_no_secret_literals` fitness rule; build-time secret scan; CSP. |
| SEC-2 | **Every clinical mutation is authenticated and role-checked.** | Gateway authn middleware + per-role RLS (defense-in-depth: app *and* DB). |
| SEC-3 | **No PII/PHI is sent to the AI model.** | Typed PII-stripping boundary on every tool; eval gate "no PII leakage". |
| SEC-4 | **An AI draft cannot become a signed prescription without a human `SignOff` command.** | State machine `transition()` throws on illegal transitions; never persisted. |
| SEC-5 | **Audit log and signed prescriptions are append-only / immutable.** | `BEFORE UPDATE/DELETE` triggers raise; no DELETE RLS policy. |
| SEC-6 | **Secrets are config, not source.** Rotatable without redeploy; never logged. | `SecretsPort` + pino PII/secret redactor + git-history secret scan. |
| SEC-7 | **Guardian consent (DPDP) is captured before clinical data processing.** | Registration write blocked until consent row exists. |
| SEC-8 | **Fail closed.** Missing/invalid identity, missing consent, unverified ABDM signature → reject, never default-allow. | Default-deny RLS; `verify-then-trust` middleware. |
| SEC-9 | **AI-assisted generation is blocked unless an active `ai_assisted_rx` guardian consent exists.** Withdrawal blocks new generations immediately and cancels in-flight/speculative ones. | `assertActiveAiConsent` on the `RequestGeneration` boundary (§2.4.1); `403 CONSENT_REQUIRED`; partial-index lookup + RLS backstop; withdrawal supersedes queued jobs (§2.4.2). |

---

## 1. Authentication (authn)

### 1.1 Identity provider — Supabase Auth (real JWT), not anon key

The prototype's `ANON_KEY` baked into every page is **deleted**. Identity is **Supabase Auth** (POC) behind an `AuthnPort` so it is portable to AWS Cognito / any OIDC provider by a `wiring/` flip — the same dependency-inversion discipline applied to DB/queue/secrets.

```
src/
  ports/authn.ts          # interface only — verify(token) -> Principal
  adapters/authn/
    supabase-jwt.ts        # POC: verify against Supabase JWKS
    supabase-jwt.__fakes__/ # deterministic principals for tests
    cognito-jwt.ts         # prod option (DIS_STACK=aws)
  wiring/                  # the ONLY place an adapter is chosen
```

```ts
// ports/authn.ts — the narrow waist; no adapter imports, no fetch
export type Role = 'reception' | 'nurse' | 'doctor' | 'admin' | 'service';

export interface Principal {
  readonly userId: string;        // stable subject (uuid)
  readonly role: Role;            // single primary role (see §2.2 for multi-role)
  readonly facilityId: string;    // multi-site scope
  readonly doctorId?: string;     // identity.practitioners.id when role='doctor'
  readonly sessionId: string;     // for audit correlation + revocation
  readonly tokenExpiry: number;   // epoch seconds
}

export interface AuthnPort {
  /** Verify a bearer token; throw AuthnError (401) on any failure. Fail closed. */
  verify(bearerToken: string): Promise<Principal>;
}
```

**Token rules (decisive):**

- **Asymmetric verification (RS256/ES256) against the provider JWKS**, cached with a short TTL. Never trust unsigned/`alg:none`; reject if `kid` is unknown after a JWKS refresh.
- **Short-lived access tokens (≤30 min)** + refresh-token rotation. Access tokens are **bearer** in the `Authorization` header only — never in URLs, query strings, or `localStorage` (use in-memory + httpOnly refresh cookie, `SameSite=Strict`, `Secure`).
- **Mandatory claims:** `sub`, `role` (app metadata), `facility_id`, `exp`, `iat`, `aud`, `iss`. Missing claim → 401.
- **Clock skew** tolerance ≤60s; expired token → 401 (never silent renew on the data path).

### 1.2 Login & session model

- **Login UI** is a dedicated `<LoginScreen>` component (not a shared inline snippet). Email + password (POC) with a clear path to **TOTP 2FA for the `doctor` and `admin` roles** (NABH and DPDP "reasonable security safeguards" expectation for privileged clinical access).
- **Session binding:** every issued session row is stored in `identity.sessions` (`id`, `user_id`, `device`, `ip_hash`, `created_at`, `last_seen_at`, `revoked_at`). Logout and admin revoke set `revoked_at`; the gateway checks revocation on each request (cached, short TTL).
- **Idle + absolute timeout:** idle 30 min, absolute 12 h. Re-auth required after absolute expiry.
- **Brute-force protection:** exponential backoff + lockout after N failures (per-account and per-IP), recorded in the audit log as `auth.login_failed`.
- **Tablet/shared-device reality (clinical floor):** auto-lock on idle, fast role re-auth (PIN/biometric on tablet), and **never** auto-fill another clinician's session. The pad surfaces *which* clinician is signed in at all times (the signoff is legally theirs).

### 1.3 Gateway authn middleware (Hono)

A thin `auth` middleware runs **before** any clinical route, after `correlation-id` and before `idempotency`/`kill-switch`:

```ts
// http/middleware/authn.ts (thin; delegates to AuthnPort)
export const authn = (authnPort: AuthnPort) => async (c, next) => {
  const hdr = c.req.header('authorization');
  if (!hdr?.startsWith('Bearer ')) return c.json(envelope('AUTH_MISSING', 'auth required'), 401);
  let principal: Principal;
  try {
    principal = await authnPort.verify(hdr.slice(7));
  } catch {
    return c.json(envelope('AUTH_INVALID', 'invalid or expired token'), 401);
  }
  c.set('principal', principal);          // available to authz + DB session-var wiring
  await next();
};
```

Public exceptions are **explicitly allow-listed** (only `GET /healthz`, `GET /verify/:receipt` QR-verify which returns no PHI). Everything else is authenticated by default (fail-closed).

---

## 2. Authorization & RBAC (authz)

### 2.1 Why two layers (defense-in-depth)

Authorization is enforced **twice**, independently:

1. **Application layer** — the CommandBus refuses to dispatch a command the principal's role is not permitted to issue (fast, expressive, gives clean 403s and good audit).
2. **Database layer** — **per-role RLS** is the backstop: even if an app check is bypassed (bug, injection, mis-wired adapter), Postgres denies the row. This replaces the prototype's single blanket policy that made the anon key omnipotent.

Neither layer trusts the other. This is the core fix for the POC's "one anon key = full DB" flaw.

### 2.2 Role model

Five roles (extensible). One **primary** role per principal keeps RLS simple; users needing multiple capabilities (e.g., a doctor who also does reception) get the **superset** role or a documented role grant — never silent privilege creep.

| Role | Can do | Cannot do |
|---|---|---|
| `reception` | Create/read patients, visits, demographics, allergies, documents upload, **capture guardian consent**, allocate UHID/token (server-side) | Read full clinical notes, write vitals, generate/sign Rx |
| `nurse` | Reception scope + write vitals, growth, labs, vaccinations, view visit summary | Generate/sign Rx, edit signed records |
| `doctor` | Nurse scope + request generation, edit draft, **`SignOff` (sole signing authority)**, give vaccinations | Delete clinical rows, edit *another* doctor's signed Rx, touch audit log |
| `admin` | User/role management, formulary/protocol governance, read audit log, config (non-secret) | Sign prescriptions, **delete** clinical/audit rows, read raw secrets |
| `service` | Backend workers + gateway: run generation, write jobs/drafts/outbox, ABDM push, set session vars | Be presented by a browser; sign off clinically |

**Principle of least privilege:** `service` is powerful but **never client-reachable** (no browser can obtain a `service` token); `admin` is powerful over *governance* but powerless over *clinical signing and deletion*. No single human role can both create and irreversibly destroy clinical data.

### 2.3 Permission matrix (command → roles)

Authorization is **command-centric** (matches the CommandBus / symmetric-actor design). Each `Command` declares the roles allowed to issue it; the bus rejects others with `403 FORBIDDEN` and audits the denial.

| Command | reception | nurse | doctor | admin | service |
|---|:---:|:---:|:---:|:---:|:---:|
| `RegisterPatient` / `UpdatePatient` | ✓ | ✓ | ✓ | — | — |
| `CaptureGuardianConsent` | ✓ | ✓ | ✓ | — | — |
| `CreateVisit` | ✓ | ✓ | ✓ | — | — |
| `RecordVitals` / `RecordGrowth` / `RecordLab` | — | ✓ | ✓ | — | — |
| `GiveVaccination` | — | ✓ | ✓ | — | — |
| `SaveNote` (autosave → `DraftNoteUpdated`) | — | — | ✓ | — | — |
| `RequestGeneration` (click \| speculative \| AI) | — | — | ✓³ | — | ✓¹˒³ |
| `AdjustDose` / `AddMedicine` / `EditDraft` | — | — | ✓ | — | — |
| **`SignOff`** | — | — | **✓** | — | **—²** |
| `PrintPrescription` | ✓ | ✓ | ✓ | — | ✓ |
| `ManageFormulary` / `ManageProtocol` | — | — | — | ✓ | — |
| `ManageUser` / `GrantRole` | — | — | — | ✓ | — |
| `ReadAuditLog` | — | — | — | ✓ | ✓ |
| `PushToAbdm` | — | — | — | — | ✓ |

¹ `service` may *request* generation (speculative/background or on behalf of a future autonomous agent) — it produces a `pending_review` draft only.
² **SEC-4:** `service`/AI can never `SignOff`. The signing authority is a human `doctor`. This is the clinical-safety boundary that makes "AI-drafts, doctor-signs" safe and makes a later AI-first mode an *additive subscriber*, not a trust escalation.
³ **SEC-9 (guardian-consent runtime gate):** `RequestGeneration` is **blocked at the command boundary** — for both the doctor-click and the `service` (speculative/AI) path — unless an **active** `purpose='ai_assisted_rx'` guardian consent exists for the patient. "Active" = a `clinical.guardian_consents` row with `consent_given = true AND withdrawn_at IS NULL`. Absent/withdrawn consent → `403 CONSENT_REQUIRED` (fail-closed). This is enforced *before* enqueue, so a withdrawn-consent patient never has an AI draft sitting in `prescription_drafts`. See §2.4.1, §6.1.

### 2.4 Application-layer enforcement (the bus)

```ts
// core/authz.ts — pure, no IO; a policy table, not scattered if-checks
const COMMAND_ROLES: Record<CommandType, ReadonlySet<Role>> = {
  SignOff: new Set(['doctor']),
  RequestGeneration: new Set(['doctor', 'service']),
  ManageUser: new Set(['admin']),
  // ...complete table mirrors §2.3
};

export function assertAuthorized(cmd: Command, p: Principal): void {
  const allowed = COMMAND_ROLES[cmd.type];
  if (!allowed?.has(p.role)) {
    throw new ForbiddenError(cmd.type, p.role); // -> 403 + audit 'authz.denied'
  }
  // Resource-scope checks (ownership / facility) layered on top:
  assertFacilityScope(cmd, p);            // facility_id must match
  if (cmd.type === 'EditDraft' || cmd.type === 'SignOff') {
    assertVisitOwnership(cmd, p);          // doctor edits only own visit's draft
  }
}
```

This is centralized (one policy table), testable with fakes (<1s), and CI-guarded against `core` reaching into adapters.

### 2.4.1 Guardian-consent runtime enforcement on `RequestGeneration` (SEC-9, DPDP)

Role authorization alone does **not** license AI-assisted generation. **Capturing** a `purpose='ai_assisted_rx'` guardian consent that is never *enforced* is theatre; the DPDP child-data regime (§6.1) and the fail-closed invariant (SEC-8) require that the **absence or withdrawal** of that consent **stops the AI**, not merely the registration write. Enforcement therefore lives on the **`RequestGeneration` command boundary** — the symmetric-actor seam — so it applies identically to a doctor click, a speculative/background trigger, and a future autonomous AI agent (all of which dispatch the same command).

```ts
// core/consent.ts — pure predicate; "active" is the single canonical definition
export interface GuardianConsentView {           // read-side projection; no PII
  readonly patientId: string;
  readonly purpose: 'ai_assisted_rx' | 'opd_care';
  readonly consentGiven: boolean;
  readonly withdrawnAt: number | null;           // epoch seconds | null
}
export function isActiveConsent(c: GuardianConsentView | undefined): boolean {
  return !!c && c.consentGiven && c.withdrawnAt === null;
}

// command handler precondition — runs AFTER assertAuthorized, BEFORE enqueue. Fail closed.
export async function assertActiveAiConsent(
  patientId: string,
  consents: ConsentReadPort,
): Promise<void> {
  const c = await consents.getActive(patientId, 'ai_assisted_rx');
  if (!isActiveConsent(c)) {
    throw new ConsentRequiredError(patientId, 'ai_assisted_rx'); // -> 403 CONSENT_REQUIRED
  }
}
```

```
RequestGeneration(visit_id, …):                  // doctor click | speculative | AI — same command
  assertAuthorized(cmd, principal)                // role gate (§2.4)
  patient_id = resolvePatientFromVisit(visit_id)  // server-side; never client-supplied
  assertActiveAiConsent(patient_id, consents)     // SEC-9; else -> 403 CONSENT_REQUIRED, audited
  … enqueue generation job …
```

- **Three distinct consent purposes, three distinct gates — none substitutes for another.** `opd_care` (SEC-7) gates clinical *processing* at registration; **`ai_assisted_rx` (SEC-9) gates AI *generation*** at the `RequestGeneration` boundary; **ABDM consent artefacts** (§6.2) gate health-information *sharing*. A patient may have given `opd_care` and still lack `ai_assisted_rx` — generation is blocked, manual prescribing is not.
- **The speculative/background path is gated too.** The auto-save trigger that pre-generates a draft from the note dispatches `RequestGeneration` and therefore hits the *same* `assertActiveAiConsent` check *before* enqueue — a withdrawn-consent patient never has an AI draft materialise in `prescription_drafts`.
- **New error code: `CONSENT_REQUIRED` (403, non-retryable)** with `details:{ purpose:'ai_assisted_rx' }`. It is a distinct code from `AUTH_*` (authn) and `FORBIDDEN` (role authz): the principal *is* authenticated and role-authorized; the *patient* lacks the lawful basis. Added to the error catalogue (`04_api/error_model.md`).
- **DB backstop.** A partial index `idx_consent_active on clinical.guardian_consents (patient_id, purpose) where consent_given and withdrawn_at is null` (owned by `03_data/schema_design.md §5.2`) makes the lookup O(1); RLS on the clinical context a generation reads means a bypass of the app check still cannot assemble the inputs a generation needs (defense-in-depth, SEC-2).

### 2.4.2 Consent withdrawal — DPDP effect on in-flight and future generations

DPDP grants the guardian the right to **withdraw** consent "as easily as it was given." Withdrawal is a first-class command, not a delete: `WithdrawConsent` (and the `consent.withdrawn` audit event) sets `withdrawn_at = now()` on the `ai_assisted_rx` row — **the row is preserved** for audit (consent history is append-only-in-spirit; withdrawal is a state transition, never a row deletion). Its runtime effects:

| Effect | Mechanism |
|---|---|
| **New generations blocked immediately** | The next `RequestGeneration` for that patient evaluates `isActiveConsent(...) === false` (because `withdrawn_at` is now set) → `403 CONSENT_REQUIRED`. No grace window, no caching of the consent decision beyond the current request. |
| **In-flight / speculative jobs cancelled** | `WithdrawConsent` emits a domain event that **supersedes/cancels** any queued or running generation job for that patient (the job's state machine transitions to `superseded`/`failed`); any speculative draft already in `prescription_drafts` is marked `discarded`. The withdrawal must not leave an AI artefact behind that a doctor could later sign. |
| **No secondary use after withdrawal** | Withdrawal stops *new* AI processing and any secondary use; clinical records already lawfully created for the ongoing care episode are retained under the **medico-legal retention obligation** (§6.1) — withdrawal narrows future processing, it does not erase the legal medical record. The boundary is documented and audited. |
| **Re-consent re-enables** | A subsequent `CaptureGuardianConsent` for `ai_assisted_rx` inserts a fresh active row (`consent_given=true, withdrawn_at=null`); generation is permitted again from that point forward. |

This makes withdrawal **effective at the AI boundary in real time**, satisfying DPDP's "withdraw as easily as given" while honouring NABH/medico-legal record retention — the two obligations are reconciled, not traded off.

### 2.5 Database-layer enforcement — per-role RLS (the backstop)

RLS uses the **portable `current_setting('app.*')` pattern** proven in `dis/migrations/M008_rls_policies.sql` — the *same* policy file runs on Supabase **and** AWS RDS. Session vars are set from the verified JWT at request start by the DB adapter's `setSessionVars` (validated key regex; `SET LOCAL` so they reset per transaction):

```ts
// wiring sets these from the Principal at the start of each request transaction
await db.setSessionVars({
  'app.role':        principal.role,
  'app.user_id':     principal.userId,
  'app.doctor_id':   principal.doctorId ?? '',
  'app.facility_id': principal.facilityId,
});
```

**The anon key never sets these and never reaches a clinical schema.** Pattern for a clinical table (illustrative — full set lives in the `identity`/`clinical`/`prescribing` migrations):

```sql
-- clinical.visits — facility-scoped, role-gated, NO DELETE policy (SEC-5)
alter table clinical.visits enable row level security;
alter table clinical.visits force row level security;  -- applies even to table owner

create policy visits_select on clinical.visits for select
  using (
    facility_id = current_setting('app.facility_id', true)
    and current_setting('app.role', true) in ('reception','nurse','doctor','admin','service')
  );

create policy visits_insert on clinical.visits for insert
  with check (
    facility_id = current_setting('app.facility_id', true)
    and current_setting('app.role', true) in ('reception','nurse','doctor','service')
  );

create policy visits_update on clinical.visits for update
  using (
    facility_id = current_setting('app.facility_id', true)
    and current_setting('app.role', true) in ('nurse','doctor','service')
  );
-- NO delete policy: clinical rows are never deleted (CS-2 / SEC-5).

-- prescribing.prescriptions — signed Rx are immutable after sign-off
create policy rx_update_unsigned_only on prescribing.prescriptions for update
  using (
    status <> 'signed'                                   -- cannot mutate a signed Rx
    and facility_id = current_setting('app.facility_id', true)
    and current_setting('app.role', true) = 'doctor'
  );
```

**Default-deny:** RLS is `enable` + `force`; any table with RLS on and no matching policy denies the row. Roles are never granted blanket `BYPASSRLS`. `service` has broad-but-scoped policies, not omnipotence.

### 2.6 Resource-scope rules beyond role

- **Facility isolation:** every mutable table carries `facility_id`; both bus and RLS enforce `facility_id = app.facility_id`. Multi-site cannot read across sites.
- **Visit ownership:** a `doctor` may `EditDraft`/`SignOff` only on a draft for a visit they are the attending clinician of (or a documented hand-off). Enforced app-side; RLS narrows update to `doctor` + facility.
- **Patient-scope for guardians (future ABHA Scan&Share / patient portal):** the `current_setting('app.patient_id')` self-read pattern (seen in `dis` `extractions_read`) is reserved for a patient-facing read path; not used by staff roles.

---

## 3. PII / PHI Handling

### 3.1 Data classification

| Class | Examples | Rule |
|---|---|---|
| **PHI (highest)** | Name, DOB, guardian name/phone, address, UHID↔identity link, allergies, diagnoses, Rx, labs, growth, ABHA number | Encrypted in transit + at rest; role-scoped; never to AI; audited on access |
| **Clinical (de-identified-able)** | Weight, age-in-days, GA, dosing bands, drug choice | Permitted to AI **only after PII strip**; safe to compute on |
| **Operational** | job ids, token counts, latency, correlation ids, cost | Logged freely (no PII) |
| **Secret** | API keys, service-role key, Fidelius private keys, JWT signing keys | `SecretsPort` only; never logged, never client |

### 3.2 The PII-stripping boundary to the AI model (SEC-3)

The prototype's `get_previous_rx` strips PII with an ad-hoc `.map`. The rebuild makes this a **typed, single-responsibility boundary** that *cannot* be bypassed — every `ClinicalKnowledgePort` tool returns a de-identified DTO whose type *has no PII fields*, so leakage is a compile error, not a review miss.

```ts
// core/phi/deidentify.ts — pure, total, the ONLY path data takes to the model
export interface DeidentifiedPatientContext {
  ageInDays: number;            // computed client/server-side, never DOB
  weightKg?: number;
  gestationalAgeWeeks?: number;
  sex: 'M' | 'F';              // de-id model form; '0'/unknown is omitted (no sex-specific pediatric dosing branch)
  allergies: readonly string[]; // drug/substance terms only — no identifiers
  // NOTHING that identifies the child: no name, no UHID, no guardian, no address, no ABHA
}
```

> **`sex` representation (canonical mapping, C2).** Three layers, one anti-corruption seam: the **DB** stores lowercase tokens `('male','female','other')`; the **API/DTO** uses single-letter `'M' | 'F' | 'O'`; the **de-identified model context** above uses `'M' | 'F'` only (`'other'`/unknown never reaches the model — no pediatric dosing branch depends on it). The conversion lives in exactly **one** pure function (`sexToApi`/`sexFromApi`, `male↔M`/`female↔F`/`other↔O`) at the database-adapter boundary; no other code branches on a sex string. This aligns the wire form to HL7 AdministrativeGender (`M→male`, `F→female`, `O→other`).

**Rules:**

- The AI receives **clinical facts only** — it selects drugs/regimens and narrates. It **never** receives a name, UHID, phone, address, ABHA, or DOB (only derived `ageInDays`).
- Preterm corrected/chronological age and BSA/weight are **pre-computed deterministically** (client + server) and passed as numbers; the AI does **no arithmetic that reaches paper** (the dose engine is the sole arithmetic authority — open/closed safety boundary).
- A frozen **eval gate "no PII leakage"** scans every outbound model payload over the pediatric fixture set; a single PII token fails the gate (owned operationally by `09_engineering_discipline/evals_framework.md`).
- **Prompt-cache hygiene:** the cacheable prefix (tools → system → NABH block) contains **no PII, no UUIDs, no timestamps**. PII-bearing volatile content sits strictly *after* the cache breakpoint.

### 3.3 Encryption

- **In transit:** TLS 1.2+ everywhere (browser↔gateway, gateway↔Postgres, gateway↔Anthropic, system↔ABDM via mTLS). HSTS on the web origin.
- **At rest:** Postgres storage encryption (Supabase/RDS managed); Storage buckets encrypted. **Column-level encryption / hashing** for the highest-sensitivity identifiers where it does not break clinical use (e.g., guardian phone stored + a hashed lookup column; `ip_hash` in sessions). ABHA numbers stored encrypted-at-rest with access audited.
- **Key management:** DB/storage keys are platform-managed (KMS); application-level keys (JWS signing, Fidelius) via `SecretsPort`/KMS, rotatable.

### 3.4 Minimization, retention, output safety

- **Minimization:** collect only what care requires (DPDP purpose-limitation). The QR payload carries **minimal** re-registration data (UHID, name, DOB, sex initial) — and the **verify** flow puts **no PHI in the QR URL** (the QR encodes a receipt id; verification calls a read-only server endpoint).
- **Retention:** medical records retained per NABH/medico-legal norms (pediatric records typically retained until the child reaches majority + statutory years); audit logs retained ≥ the longer of regulatory minimum and breach-investigation needs. Retention/erasure is **policy-driven**, executed by a `service` job, and itself audited. (Note: DPDP erasure rights are bounded by the healthcare/legal-retention exemption — see §6.)
- **Output safety (XSS):** the prototype's `esc()` is preserved as the design system's **safe-render primitive** — every dynamic value is escaped before `innerHTML`. Pictograms are **inline SVG only** (no external image fetches), each paired with Hindi+English text (never icon-only — false-confidence risk).
- **Redaction in logs:** pino is configured with a **PII/secret redactor** (allow-list of safe fields + deny-list of PII paths). Correlation IDs, not names, tie log lines to a patient.

---

## 4. Secrets & Configuration Management

### 4.1 The rule that broke prod today (and the fix)

A hardcoded dated model id (`claude-*`) in business code was retired upstream and broke production. **Config is never source.** Two mechanisms:

1. **`SecretsPort`** (proven in `dis/`) for *secrets* — Supabase secrets (POC) → AWS Secrets Manager (prod) by a `wiring/` flip. Adapters cache resolved secrets ~5 min to bound rotation blast radius. Implementations **throw** if a named secret is missing (fail-fast).
2. **`ConfigPort` + Zod `env.schema.ts`** for *non-secret config* (URLs, model ids, feature flags, limits) — validated and **fail-fast at boot** (extends the `dis/` `env.schema.ts` pattern). No hardcoded URL/key/**model** anywhere in client or worker code.

```ts
// ports/secrets.ts (verbatim discipline from dis/)
export interface SecretsPort { get(name: string): Promise<string>; } // throws if unset
```

### 4.2 Secret inventory & placement

| Secret | Stored | Reachable by | NEVER in |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | SecretsPort | generation worker (`service`) only | client, logs, URLs, commit msgs |
| Supabase **service-role** key | SecretsPort | gateway/worker (`service`) only | any client-reachable function |
| Supabase **anon** key | (eliminated from clinical paths) | n/a | every static page (the POC flaw) |
| JWT/JWS signing key (QR `SignaturePort`) | SecretsPort / KMS | signing worker | client |
| Fidelius (Curve25519) private key | SecretsPort / KMS | ABDM `CryptoBoxPort` | logs, code, plaintext-gated sandbox only |
| ABDM `CLIENT_ID` / `CLIENT_SECRET`, HFR id, HPR id | SecretsPort / Config | ABDM `service` | source (the baked-in `HOSPITAL.hfr_id=""` blocker) |

### 4.3 Enforcement (fitness rules + scanning)

Extend `dis/scripts/fitness-rules.json` (CI merge-blockers):

- `core_no_model_id_literals` — no `claude-*` / dated-model string in business code (model ids live only in `ModelPolicyPort` config).
- `core_no_secret_literals` — no key-shaped strings (`sk-ant-`, `eyJ...` JWTs, service-role patterns) in any tracked file.
- `supabase_sdk_only_in_supabase_adapters` / `aws_sdk_only_in_aws_adapters` — vendor SDKs (and thus their credential surfaces) confined to adapter edges.
- **Pre-commit + CI secret scanning** (gitleaks/trufflehog) over the diff **and** full history; **build-time client-bundle scan** asserts zero secrets shipped to the browser. A hit fails the build.
- **Rotation runbook:** every secret is rotatable without code change; rotation of the prod model key / API key is a config push, not a redeploy. Any suspected exposure → immediate rotate + audit-log entry + breach assessment (§6.4).

### 4.4 CORS, CSP, headers (replacing `Allow-Origin: *`)

- **CORS** is locked to the GitHub-Pages / app origin(s) — **never `*`** (the POC's `Access-Control-Allow-Origin: *` is removed). Methods/headers allow-listed; credentials mode explicit.
- **CSP:** strict `default-src 'self'`; script/style from self + pinned CDNs (Noto Sans Devanagari, html5-qrcode) with SRI; `connect-src` limited to the gateway + Supabase Auth; `img-src 'self' data:` (inline SVG, no `api.qrserver.com`). `frame-ancestors 'none'`, `object-src 'none'`.
- **Security headers:** HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` minimal.

---

## 5. Audit Logging

### 5.1 Principles

NABH and clinical-safety traceability require that **every clinically- or security-significant action is recorded immutably and attributably**. The prototype's heuristic `console.log` is replaced by a structured, append-only, queryable audit substrate.

| Principle | Mechanism |
|---|---|
| **Append-only / immutable** (SEC-5) | `ops.audit_log` with `BEFORE UPDATE/DELETE` triggers that `raise` (proven in `dis/ M002`); no DELETE RLS policy. |
| **Attributable** | Every row carries `actor_type` (`user`\|`system`), `actor_id`, `role`, `session_id`, `correlation_id`. AI actions are `actor_type='system'` with the model id+version. |
| **Complete** | Authn events, authz denials, every CommandBus mutation, every `ToolInvoked`, generation start/complete/fail, sign-off, print, PII reads of sensitive tables, config/secret-rotation events, ABDM pushes. |
| **Tamper-evident** | Signed prescriptions carry a content hash; audit rows are immutable at rest; chain integrity verifiable. |
| **Privacy-preserving** | Audit stores *what/who/when*, not full PHI payloads in the clear (before/after for clinical edits stored as needed for safety, access-controlled to `admin`/`service`). |

### 5.2 Schema (target)

```sql
create schema if not exists ops;

create table ops.audit_log (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  facility_id     text not null,
  event           text not null,                 -- e.g. 'rx.signed','auth.login_failed','authz.denied','phi.read'
  event_type      text not null,                 -- state_transition|command|authn|authz|access|config|abdm
  actor_type      text not null check (actor_type in ('user','system')),
  actor_id        text,                           -- user_id or service/agent id
  role            text,
  session_id      text,
  subject_id      uuid,                           -- patient/visit/rx affected
  correlation_id  uuid not null,
  command_type    text,
  from_state      text,
  to_state        text,
  field_path      text,
  before_value    jsonb,
  after_value     jsonb,
  model_id        text,                           -- for AI actions: which model+version actually ran
  note            text,
  ip_hash         text
);

create index idx_audit_subject on ops.audit_log(subject_id, created_at);
create index idx_audit_corr    on ops.audit_log(correlation_id);
create index idx_audit_event   on ops.audit_log(event, created_at);

create or replace function ops.audit_log_immutable() returns trigger as $$
begin raise exception 'ops.audit_log is append-only'; end;
$$ language plpgsql;

create trigger trg_audit_no_update before update on ops.audit_log
  for each row execute function ops.audit_log_immutable();
create trigger trg_audit_no_delete before delete on ops.audit_log
  for each row execute function ops.audit_log_immutable();

alter table ops.audit_log enable row level security;
alter table ops.audit_log force row level security;
create policy audit_read   on ops.audit_log for select
  using (current_setting('app.role', true) in ('admin','service'));
create policy audit_insert on ops.audit_log for insert
  with check (current_setting('app.role', true) in ('service'));
-- no update/delete policy: nobody mutates audit, ever.
```

### 5.3 The generation event stream (NABH + AI auditability)

Every prescription generation is a **replayable event stream** (`GenerationStarted → ToolInvoked* → DraftDelta* → GenerationCompleted|Failed`), projected into `prescribing.rx_generation_jobs` and a per-attempt `prescription_audit` row (ported from `sprint-2-saved`): `meta_mode`, `stop_reason`, tokens, rounds, `tools_called[]`, requested/emitted/omitted/added counts, `severity_*`, `warnings[]`, `duration_ms`, **and the model id+version actually used**. This satisfies NABH traceability ("which knowledge informed this Rx, and which model produced it") and replaces console heuristics. The append-only audit writer exposes only `write`/`writeMany` (mutators are absent from the type — the `dis/ AuditLogger` discipline).

### 5.4 What is audited (event taxonomy)

`auth.login_success` · `auth.login_failed` · `auth.logout` · `auth.session_revoked` · `authz.denied` · `patient.created`/`updated` · `consent.captured`/`withdrawn` · `visit.created` · `vitals.recorded` · `rx.generation_requested` (incl. speculative) · `rx.tool_invoked` · `rx.draft_ready` · `rx.edited` · **`rx.signed`** · `rx.printed` · `phi.read` (sensitive-table reads) · `formulary.changed` · `user.role_granted` · `config.changed` · `secret.rotated` · `abdm.pushed` · `abdm.callback_verified`/`rejected`.

---

## 6. Regulatory Compliance

### 6.1 DPDP Act 2023 + Rules 2025 — children's data (the load-bearing one)

**~Every patient is a child (<18), so DPDP's child-data regime governs by default.**

| Requirement | How the system meets it |
|---|---|
| **Verifiable guardian consent before processing a child's data** | **SEC-7:** registration captures `CaptureGuardianConsent` (timestamped, plain-language notice shown, guardian name/relationship, channel) into `identity.consents` / `clinical.guardian_consents` *before* any clinical write is permitted. Distinct from ABDM consent artefacts. **A separate `ai_assisted_rx` purpose gates AI generation (SEC-9, §2.4.1):** generation is **blocked at the `RequestGeneration` boundary** unless an active `ai_assisted_rx` consent exists — captured consent is *enforced*, not just recorded. |
| **No tracking, behavioural monitoring, or targeted advertising to children** | Architecturally absent: no analytics/ad SDKs; the **healthcare exemption is scope-limited to service delivery** — no secondary use, no marketing, no profiling. |
| **Purpose limitation & data minimization** | §3.4; data used only for the care episode it was collected for. |
| **Notice (plain language)** | Consent capture renders a plain-language notice (English/Hindi) of what is collected and why. |
| **Right to withdraw / correction / erasure** | `WithdrawConsent` → `consent.withdrawn` (sets `withdrawn_at = now()`, row preserved for audit) + a `service` erasure/correction job — **bounded by the medico-legal retention obligation** (records required for ongoing care or by law are retained; withdrawal stops *new* processing and secondary use). **Runtime effect of withdrawing `ai_assisted_rx` (§2.4.2):** the next `RequestGeneration` fails `403 CONSENT_REQUIRED` immediately, in-flight/speculative jobs are superseded/cancelled, and any speculative draft is discarded — withdrawal is effective at the AI boundary in real time. The boundary is documented and audited. |
| **Reasonable security safeguards** | Encryption (§3.3), RBAC + RLS (§2), audit (§5), access logging, breach runbook (below). |
| **Breach notification** | §6.4 dual-clock runbook. |

> **Decisive stance:** the DPDP "healthcare provider" exemption reduces the *consent friction* for routine care but does **not** license analytics, marketing, secondary use, or weak security. Treat child-data protections as binding.

### 6.2 ABDM compliance (federation security)

| Control | Spec |
|---|---|
| **Gateway request-auth — fail closed** | Every inbound ABDM callback's JWS is verified against the **ABDM CM JWKS** + timestamp/nonce replay protection; invalid → reject (replaces any implicit trust). |
| **Fidelius crypto (correct curve)** | `CryptoBoxPort` uses **Fidelius — Curve25519 Short-Weierstrass, NOT libsodium Montgomery**; plaintext is gated behind a double-locked sandbox flag, keys via `SecretsPort`/KMS. |
| **Signed QR (non-forgeable)** | `SignaturePort` issues **ES256 JWS**, replacing the forgeable 6-char client-salt hash. `verify.html` calls a **read-only server endpoint**; **no PHI in the QR URL**; QR rendered client-side (drop `api.qrserver.com`). |
| **Consent artefacts (HIP/HIU)** | `abdm.consent_artefacts` recorded and honoured before any health-information push; reliable delivery via `abdm_outbox`/`abdm_inbox`. |
| **Identity prereqs as config** | HFR id + HPR id live in config/secrets, never source. |
| **Off-edge, event-driven** | ABDM/FHIR generation runs on the `PrescriptionSigned` event asynchronously; **sign-off never blocks** on ABDM, and ABDM credentials never touch the client. |

### 6.3 NABH Digital Health (2nd ed., Sep 2025) — EMR compliance checklist

Met by the controls above: **access control** (RBAC + RLS), **audit trail** (immutable `ops.audit_log` + generation stream), **data integrity** (composite FKs, content-hashed signed Rx, append-only), **availability/backup** (managed Postgres backups + reversible migrations), **clinician attribution** (sign-off is a named human, "AI-assisted, doctor-reviewed" line on the printed Rx), **mandatory NABH block** on every prescription (pre-embedded in the prompt prefix). These plus ABDM milestones target **Silver → Gold**.

### 6.4 Breach response (dual-clock runbook — memorize the clocks)

On a confirmed or suspected personal-data breach:

| Clock | Action |
|---|---|
| **CERT-In: 6 hours** | Report the incident to **CERT-In within 6 hours** of becoming aware. |
| **DPB: without delay** | Notify the **Data Protection Board "without delay"**, with a **full report within 72 hours**. |
| **Affected principals: 72 hours** | Notify affected data principals (guardians) within 72 hours, in plain language, with mitigation steps. |

Supporting steps: contain (rotate secrets §4.3, revoke sessions), preserve the immutable audit trail as evidence, scope the blast radius from `phi.read`/`authz.denied` events, and post-incident review feeds back into controls. The runbook lives with on-call; this spec fixes the **obligations and clocks**.

---

## 7. Where security lives in the architecture (summary map)

```
Browser (no secrets, CSP-locked, esc()-safe render, in-mem token)
   │  Bearer JWT (short-lived)  +  Idempotency-Key  +  correlation-id
   ▼
API Gateway (Hono)  ── middleware order ──►
   correlation-id → authn(AuthnPort) → authz(CommandBus policy) → idempotency → kill-switch → rate-limit → route
   │  sets app.role/app.user_id/app.facility_id from verified Principal
   ▼
Workers / Core (service identity)            Postgres (per-role RLS, force, no-DELETE)
   │  PII-strip boundary (SEC-3)                 ├ clinical.* / prescribing.* (role+facility scoped)
   ▼                                             ├ ops.audit_log (append-only triggers)
Anthropic API (server-side; key via SecretsPort, never client)   └ identity.* (users, roles, sessions, consents)

ABDM Gateway ── mTLS + JWS verify (fail closed) ── CryptoBoxPort(Fidelius) · SignaturePort(ES256)
```

**Ports introduced by this spec:** `AuthnPort`, `ConfigPort`, `SecretsPort` (existing), `ConsentReadPort` (the `ai_assisted_rx` consent lookup behind `assertActiveAiConsent`, §2.4.1), plus security-relevant `SignaturePort`/`CryptoBoxPort` (ABDM). **Fitness rules added:** `core_no_model_id_literals`, `core_no_secret_literals`, `aws_sdk_only_in_aws_adapters`. **Invariants SEC-1…SEC-9** are the acceptance criteria; their machine-checkable gates are operated by `09_engineering_discipline/`.

---

## 8. Decision log (final)

| # | Decision | Rationale |
|---|---|---|
| D-1 | Real Supabase-Auth JWT behind `AuthnPort`; **delete the embedded anon key** from all clinical paths | Anon-key-in-page is the single biggest DPDP/NABH/CERT-In liability |
| D-2 | **Two-layer authz**: CommandBus policy + per-role RLS (`current_setting('app.*')`, `force`, no-DELETE) | Defense-in-depth; portable Supabase↔RDS; DB backstops app bugs |
| D-3 | **AI/`service` can never `SignOff`** | Clinical-safety invariant (SEC-4); makes AI-first an additive subscriber |
| D-4 | **Typed PII-strip DTO** as the only path to the model; eval gate enforces zero leakage | Compile-time safety > review vigilance |
| D-5 | Secrets via `SecretsPort`, config via Zod env (fail-fast); `core_no_model_id_literals` | The hardcoded-model outage is structurally prevented |
| D-6 | **Immutable `ops.audit_log`** + generation event stream incl. model id+version | NABH traceability; replaces console heuristics |
| D-7 | Lock CORS to app origin; strict CSP; ES256-JWS signed QR with **no PHI in URL** | Removes `Allow-Origin:*` and the forgeable QR hash |
| D-8 | **Guardian consent before clinical write**; dual-clock breach runbook (CERT-In 6h / DPB 72h / principals 72h) | DPDP child-data regime is the governing default |
| D-9 | **Runtime guardian-consent gate on AI generation (SEC-9):** `RequestGeneration` fail-closed on an active `ai_assisted_rx` consent (`403 CONSENT_REQUIRED`); speculative path gated; withdrawal blocks new generations immediately and cancels in-flight ones | A captured consent that is never enforced is theatre; DPDP "withdraw as easily as given" must bite at the AI boundary, not just at registration |
