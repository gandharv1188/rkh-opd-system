# ABDM Integration — Next Steps Checklist

**Date:** 17 March 2026
**Status:** Phase 1 complete (schema, Edge Functions, UI). Pending: sandbox registration, terminology mappings, security audit.

---

## Completed

- [x] ABHA fields on registration page + database
- [x] LOINC codes on all 39 lab tests + 8 vitals
- [x] FHIR R4 Bundle generator (4 record types: OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord)
- [x] Auto FHIR generation on prescription sign-off
- [x] Care context creation on every visit
- [x] 8 ABDM Edge Functions deployed (identity, HIP x4, HIU x2, FHIR)
- [x] Schema migration (ABHA, SNOMED, LOINC, FHIR columns + abdm_care_contexts + abdm_consent_artefacts tables)
- [x] ABDM badges on all pages (registration, prescription pad, print station, landing)
- [x] SNOMED route/method/dose-form/instruction mappings
- [x] LOINC lab + vitals mappings (JSON data files)
- [x] Comprehensive adoption plan document
- [x] Cleanup (removed duplicate artifacts/, updated CLAUDE.md)

---

## Step 1: ABDM Sandbox Registration

**Who:** You (manual, portal-based)
**Depends on:** Nothing — can start now
**Time:** 3-4 business days for approval

1. Go to **https://sandbox.abdm.gov.in/**
2. Click "Register" and fill the form:
   - Organization: **Radhakishan Hospital**
   - Type: Hospital / Health Facility
   - Address: Jyoti Nagar, Kurukshetra, Haryana 136118
   - Purpose: OPD Prescription System — ABDM integration for health record sharing
3. You'll receive **Client ID** and **Client Secret** via email
4. Once received, set them as Edge Function secrets:

```bash
npx supabase secrets set ABDM_CLIENT_ID=your_client_id ABDM_CLIENT_SECRET=your_client_secret ABDM_GATEWAY_URL=https://dev.abdm.gov.in --project-ref ecywxuqhnlkjtdshpcbc
```

---

## Step 2: Health Facility Registry (HFR) Registration

**Who:** You (manual, portal-based)
**Depends on:** Nothing — can start now

1. Go to **https://facility.abdm.gov.in/**
2. Register Radhakishan Hospital
3. You'll receive an **HFR ID** (this also serves as your HIP ID in ABDM APIs)
4. Share the HFR ID — needs to be updated in `generate-fhir-bundle/index.ts` (`HOSPITAL.hfr_id`) and redeployed

---

## Step 3: Health Professional Registry (HPR) Registration

**Who:** You (manual, portal-based)
**Depends on:** Nothing — can start now

1. Go to **https://hpr.abdm.gov.in/**
2. Register **Dr. Lokender Goyal** (MD Pediatrics, HMCI HN 21452 / PMC 23168)
3. You'll receive an **HPR ID**
4. Update the database:

```sql
UPDATE doctors SET hpr_id = 'YOUR_HPR_ID' WHERE id = 'DR-LOKENDER';
```

Or via CLI:

```bash
npx supabase db query --linked "UPDATE doctors SET hpr_id = 'YOUR_HPR_ID' WHERE id = 'DR-LOKENDER';"
```

---

## Step 4: SNOMED-CT Drug Mappings

**Who:** Claude (code task)
**Depends on:** Nothing — can start now

530 drugs in the formulary need SNOMED-CT codes. The `snomed_code` and `snomed_display` columns exist but are empty.

Tasks:

- Create `radhakishan_system/data/snomed_drug_mappings.json` — all 530 drug-to-SNOMED mappings
- Create `radhakishan_system/scripts/import_snomed_mappings.js` — bulk-update script
- Run the import against Supabase

This enriches FHIR bundles with proper coded medication terminology (currently text-only).

---

## Step 5: SNOMED-CT Diagnosis Mappings

**Who:** Claude (code task)
**Depends on:** Nothing — can start now

446 standard prescriptions already have ICD-10 codes. Adding SNOMED-CT codes alongside makes FHIR bundles fully coded per ABDM requirements.

Tasks:

- Create `radhakishan_system/data/snomed_diagnosis_mappings.json` — 446 ICD-10 to SNOMED mappings
- Update `import_snomed_mappings.js` to handle diagnosis mappings too
- Run the import

---

## Step 6: Connect ABHA Verify to Real ABDM APIs

**Who:** Claude (code task)
**Depends on:** Step 1 (sandbox credentials)

Currently `abdm-identity/index.ts` has a stub that validates ABHA format locally. Once sandbox credentials are available:

- Update to call real ABDM V3 APIs for ABHA verification
- Implement Aadhaar OTP verification flow (3-step: init → verify OTP → get profile)
- Implement Scan & Share profile receive callback
- Handle linking token storage (24-hour validity)
- Redeploy the function

---

## Step 7: Connect HIP Callbacks to ABDM Gateway

**Who:** Claude (code task)
**Depends on:** Steps 1, 2, 3 (all registrations complete)

Once sandbox credentials + HFR ID + HPR ID are set:

- Configure ABDM gateway callback URL to point to Edge Functions
- Test M1 flow: ABHA verify → link → care context creation
- Test M2 flow: patient discovery → care context linking → consent → FHIR data transfer
- Test with ABDM's sandbox test ABHA numbers
- Implement Fidelius encryption (ECDH) for health data transfer — currently sends unencrypted (sandbox only)

---

## Step 8: WASA Security Audit

**Who:** You (hire external agency) + Claude (pre-audit remediation)
**Depends on:** Nothing for remediation; Steps 6-7 for full audit
**Cost:** Approx ₹2-5 lakhs

### 8a. Pre-Audit Remediation (Claude does this)

- [ ] Replace anon-key full access with proper Supabase Auth (role-based RLS for doctor, nurse, receptionist)
- [ ] Add rate limiting to Edge Functions
- [ ] Implement session management and timeouts
- [ ] Add input validation on all API endpoints
- [ ] PHI encryption for sensitive fields at rest
- [ ] Audit all REST API calls for injection risks

### 8b. WASA Audit (you hire agency)

1. Find a **CERT-IN empanelled** security audit firm
   - Reference list: https://www.cert-in.org.in/
   - Examples: QualySec, Astra, CertCube
2. They audit for:
   - OWASP Top 10 compliance
   - Authentication & authorization
   - Data encryption (at rest + in transit)
   - Session management
   - API security
3. Remediate any findings they report
4. Receive **"Safe-to-Host" certificate**

---

## Step 9: Sandbox Exit & Production Credentials

**Who:** You + NHA
**Depends on:** Steps 6, 7, 8 (all integration + security complete)

1. Complete M1, M2, M3 functional testing in sandbox
2. NHA team conducts their functional verification
3. Submit WASA "Safe-to-Host" certificate to NHA
4. Receive **production** Client ID and Client Secret
5. Switch gateway URL:

```bash
npx supabase secrets set ABDM_GATEWAY_URL=https://abdm.gov.in --project-ref ecywxuqhnlkjtdshpcbc
```

6. Redeploy all ABDM Edge Functions
7. Go live

---

## Priority & Dependency Matrix

| Priority | Step                            | Who          | Depends On    | Can Start                 |
| -------- | ------------------------------- | ------------ | ------------- | ------------------------- |
| 1        | Sandbox Registration            | You          | Nothing       | **Now**                   |
| 2        | HFR Registration                | You          | Nothing       | **Now**                   |
| 3        | HPR Registration                | You          | Nothing       | **Now**                   |
| 4        | SNOMED Drug Mappings (530)      | Claude       | Nothing       | **Now**                   |
| 5        | SNOMED Diagnosis Mappings (446) | Claude       | Nothing       | **Now**                   |
| 6        | Connect ABHA Verify             | Claude       | Step 1        | After sandbox credentials |
| 7        | Connect HIP Callbacks           | Claude       | Steps 1, 2, 3 | After all registrations   |
| 8a       | Security Remediation            | Claude       | Nothing       | **Now**                   |
| 8b       | WASA Audit                      | You + agency | Step 8a       | After remediation         |
| 9        | Production Go-Live              | You + NHA    | Steps 6-9     | After everything          |

**Parallel tracks:**

- You do Steps 1, 2, 3 simultaneously (all portal registrations)
- Claude does Steps 4, 5, 8a simultaneously (code tasks)
- Steps 6, 7 unblock once you share sandbox credentials + HFR/HPR IDs

---

## Key URLs

| Resource                     | URL                                                         |
| ---------------------------- | ----------------------------------------------------------- |
| ABDM Sandbox Portal          | https://sandbox.abdm.gov.in/                                |
| Health Facility Registry     | https://facility.abdm.gov.in/                               |
| Health Professional Registry | https://hpr.abdm.gov.in/                                    |
| ABDM Official                | https://abdm.gov.in/                                        |
| NRCeS FHIR IG v6.5.0         | https://nrces.in/ndhm/fhir/r4/index.html                    |
| ABDM Sandbox Docs            | https://kiranma72.github.io/abdm-docs/                      |
| CERT-IN (for WASA auditors)  | https://www.cert-in.org.in/                                 |
| Supabase Dashboard           | https://supabase.com/dashboard/project/ecywxuqhnlkjtdshpcbc |
| Live Site                    | https://rx.radhakishanhospital.com                          |
| GitHub Repo                  | https://github.com/gandharv1188/rkh-opd-system              |

---

## CLI Quick Reference

```bash
# Deploy an Edge Function
npx supabase functions deploy <function-name> --project-ref ecywxuqhnlkjtdshpcbc

# Set secrets
npx supabase secrets set KEY=value --project-ref ecywxuqhnlkjtdshpcbc

# Run SQL migration
npx supabase db query --linked -f path/to/file.sql

# Run inline SQL
npx supabase db query --linked "SELECT * FROM patients LIMIT 5;"

# List deployed functions
npx supabase functions list --project-ref ecywxuqhnlkjtdshpcbc

# View function logs
npx supabase functions logs <function-name> --project-ref ecywxuqhnlkjtdshpcbc
```
