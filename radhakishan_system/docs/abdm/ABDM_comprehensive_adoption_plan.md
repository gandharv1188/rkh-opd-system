# ABDM / ABHA / FHIR Comprehensive Adoption Plan for Radhakishan Hospital OPD System

## Research & Implementation Blueprint

---

## Current State Summary

**Already compliant:**

- ICD-10 coded diagnoses (446 protocols)
- Structured prescription JSON, lab results, vaccinations, patient demographics
- QR codes on prescriptions
- Document uploads
- NABH compliance checks in AI prompt

**Zero ABDM code exists today** — no ABHA fields, no FHIR generation, no HIP/HIU endpoints, no consent APIs, no SNOMED-CT/LOINC codes anywhere in the codebase.

---

## Architecture Decision: ABDM Wrapper vs Native Edge Functions

The official NHA ABDM Wrapper is a **Java Spring Boot + MongoDB** application. Your system runs on **Supabase Edge Functions (Deno/TypeScript) + PostgreSQL**. Two approaches:

| Approach                             | Pros                                                    | Cons                                                                            |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **A: Deploy NHA Wrapper as sidecar** | Official, pre-built M1-M3 flows, NHA-maintained         | Requires Java 17 + MongoDB server, additional infra cost, two databases to sync |
| **B: Native Edge Functions**         | Same stack, single DB, no Java dependency, full control | Must implement ABDM V3 API calls yourself, more dev effort                      |

**Recommendation: Hybrid** — Use the NHA Wrapper (dockerized) for the complex gateway callback handling (consent flows, discovery, data transfer encryption via Fidelius), but build FHIR Bundle generators and ABHA UI natively in your existing stack. The wrapper handles the "plumbing" while your system handles the "content."

---

## ABDM Integration Milestones — Research Findings

### ABDM V3 API Status

- **V1.0 APIs**: Currently in production
- **V3 APIs**: Currently available in sandbox only
- All new integrations must target **V3 exclusively**
- In V3, use the linking token received during profile share for HIP-initiated linking, removing the need for separate OTP-based flows
- API requests to the ABDM gateway use endpoints like `https://dev.abdm.gov.in/api/hiecm/gateway/v3/bridge-services` with Authorization Bearer tokens
- Requests require `CLIENT-ID`, `REQUEST-ID`, `TIMESTAMP` headers

### ABDM Sandbox Registration Process

1. Fill and submit the "ABDM Sandbox Request Form" on https://sandbox.abdm.gov.in/ to get Client ID and Client Secret (3-4 days approval)
2. Register the health facility (HIP) in the ABDM Sandbox Health Facility Registry → get HFR ID (which also acts as HIP ID)
3. Register healthcare professionals in Health Professional Registry (HPR) → get HPR ID
4. Configure callback URL — ABDM gateway posts responses to this URL
5. The `/v1/bridge/getServices` API can verify what is configured for the client ID including the callback URL

### Scan & Share Workflow — Detailed Research

The ABHA-based Scan & Share service was launched under ABDM in October 2022:

1. Hospital displays a **unique ABDM QR code** at the OPD registration counter
2. Patient scans it using any ABDM-enabled app (ABHA App, Aarogya Setu, EkaCare, DRiefcase, Bajaj Health, PayTM)
3. Patient's **ABHA profile** (name, age, gender, ABHA number) is shared with the hospital's HMIS
4. Hospital generates an **OPD token number** sent as notification to patient's app
5. Token displayed on OPD counter screens

**Current Scale:**

- Operational across **5,435+ healthcare facilities** spanning 546 districts in 35 States/UTs
- Average **1.3 lakh individuals** use Scan & Share daily
- Registration time reduced from **~50 minutes to 4-5 minutes**
- Being extended to pharmacy counters and laboratory settings
- Upcoming services: "Scan and Send" and "Scan and Pay"

### Consent Manager Workflow — Detailed Research

Every health data access requires **explicit, granular patient consent:**

1. Patient reviews and approves consent requests through their ABHA app
2. Upon consent approval, ABDM sends the consent artefact to the system at the `consents/hip/notify` endpoint
3. System sends acknowledgement back to ABDM at the `consents/hip/on-notify` endpoint
4. After acknowledgement, consent artefacts can be fetched via `consents/fetch`
5. ABDM responds in the `consent/on-fetch` callback API

**Care Context Linking Flow:**

1. Patient initiates a link request to the HIP to link care context to their Consent Manager's User ID
2. HIP system returns a link reference number along with authentication type and parameters
3. OTP sent to patient's phone number
4. In V3, use the linking token received during profile share for HIP-initiated linking (removes separate OTP flow)

**Care Context Discovery:**

1. ABDM sends patient identifiers to HIP
2. System identifies the patient using provided data
3. Returns consultation IDs for linking care contexts via callback API at `care-contexts/on-discover`

### HIP Data Transfer Workflow — Detailed Research

1. Health information request is sent to ABDM via `health-information/cm/request` with encryption details and data push URL
2. ABDM forwards this request to the HIP at `health-information/hip/request`
3. HIP must:
   a. Validate consent artefact (purpose, date range, record types, expiry)
   b. Fetch relevant data from database
   c. Convert data into **FHIR R4 format**
   d. **Encrypt** bundles using **Fidelius** (ECDH encryption library mandated by ABDM)
   e. Send encrypted data directly to the data push URL
4. HIP sends acknowledgement to ABDM at `health-information/hip/on-request` after pushing data

### NHA ABDM Wrapper Architecture

**Technology Stack:**

- **Backend:** Spring Boot application with Java 17
- **Build:** Gradle (version ≥ 8.5)
- **Database:** MongoDB (default port 27017)

**Three Primary Modules:**

1. **Patient Module** — manages patient storage and consent tracking
2. **HIP Module** — handles health information provider workflows (linking, discovery, data transfer)
3. **HIU Module** — manages health information user consent creation and exchange

**Deployment:**

- Dockerized — `docker-compose.yaml` brings up wrapper + MongoDB
- Can include mock gateway services for testing
- Designed for facility-level deployment on existing HMIS infrastructure
- **Critical:** Callback APIs from gateway must be behind facility's firewall

**Integration Pattern:**

- Wrapper exposes REST APIs that existing services invoke for ABDM workflows
- If HMIS is an HIP, existing services must expose interfaces that wrapper invokes to get information from health providers

### WASA Security Audit — Detailed Research

**Web Application Security Audit (WASA)** is mandatory for ABDM sandbox exit:

**Audit Areas:**

- Authentication Mechanisms (robust user verification)
- Authorization Controls (appropriate access levels)
- Data Encryption (at rest and in transit)
- Session Management (timeout, cookie handling, token security)
- API Security (secure communication, access control)
- OWASP Top 10 compliance

**Process:**

1. Audit conducted by **CERT-IN empanelled agencies** only (vendors listed on official CERT-IN website)
2. Follows OWASP guidelines
3. All OWASP Top 10 threats must be remediated
4. Once critical vulnerabilities mitigated → clean WASA audit report generated
5. **"Safe-to-Host" certificate** issued
6. This certificate is required for ABDM production credentials

**Estimated cost:** ₹2-5 lakhs for CERT-IN empanelled agency audit

---

## FHIR R4 Implementation Guide — Research Findings

### NRCeS FHIR IG v6.5.0

The **National Resource Centre for EHR Standards (NRCeS)** maintains the India-specific FHIR Implementation Guide at [nrces.in/ndhm/fhir/r4](https://nrces.in/ndhm/fhir/r4/index.html) — currently at **v6.5.0**.

ABDM supports three types of data formats:

1. **Unstructured** — scanned documents (Binary resource)
2. **Structured** — FHIR JSON with natural text
3. **Fully structured** — FHIR with SNOMED-CT, LOINC coding

### FHIR Profiles Defined in ABDM IG

**Core Resource Profiles:**

| Profile              | Base Resource    | Purpose                                  |
| -------------------- | ---------------- | ---------------------------------------- |
| **Patient**          | Patient          | Basic demographics, ABHA identifier      |
| **Practitioner**     | Practitioner     | Healthcare provider demographics, HPR ID |
| **PractitionerRole** | PractitionerRole | Practitioner role information            |
| **Organization**     | Organization     | Healthcare facility data, HFR ID         |

**Clinical Resource Profiles:**

| Profile                     | Base Resource      | Purpose                             |
| --------------------------- | ------------------ | ----------------------------------- |
| **Encounter**               | Encounter          | OPD visit data                      |
| **MedicationRequest**       | MedicationRequest  | Medication prescriptions/orders     |
| **Condition**               | Condition          | Patient diagnoses (ICD-10 + SNOMED) |
| **Observation**             | Observation        | Lab results, vitals (LOINC coded)   |
| **Immunization**            | Immunization       | Vaccination records                 |
| **DiagnosticReportLab**     | DiagnosticReport   | Laboratory diagnostic reports       |
| **DiagnosticReportImaging** | DiagnosticReport   | Imaging diagnostic reports          |
| **AllergyIntolerance**      | AllergyIntolerance | Allergies and adverse reactions     |
| **ServiceRequest**          | ServiceRequest     | Investigation/procedure requests    |

**Document Profiles:**

| Profile               | Base Resource     | Purpose                     |
| --------------------- | ----------------- | --------------------------- |
| **DocumentBundle**    | Bundle            | Document exchange container |
| **DocumentReference** | DocumentReference | Document metadata           |

### OPConsultRecord Profile — Detailed Structure

The OPConsultRecord represents "outpatient visit consultation notes which may include clinical information on OP examinations, procedures along with medication administered."

**Mandatory Elements (Cardinality 1..1):**

| Element       | Type                 | Coding System                                                                |
| ------------- | -------------------- | ---------------------------------------------------------------------------- |
| **status**    | code                 | CompositionStatus (required)                                                 |
| **type**      | CodeableConcept      | SNOMED CT: 371530004 "Clinical consultation report"                          |
| **subject**   | Reference(Patient)   | —                                                                            |
| **encounter** | Reference(Encounter) | —                                                                            |
| **date**      | dateTime             | —                                                                            |
| **author**    | Reference (1..\*)    | Device, RelatedPerson, Patient, Practitioner, PractitionerRole, Organization |
| **title**     | string               | —                                                                            |

**Optional Sections (All 0..1 Cardinality) with SNOMED CT codes:**

| Section                 | SNOMED Code | FHIR Resource References               |
| ----------------------- | ----------- | -------------------------------------- |
| **ChiefComplaints**     | 422843007   | Condition                              |
| **PhysicalExamination** | 425044008   | Observation                            |
| **Allergies**           | 722446000   | AllergyIntolerance                     |
| **MedicalHistory**      | 371529009   | Condition, Procedure                   |
| **FamilyHistory**       | 422432008   | FamilyMemberHistory                    |
| **InvestigationAdvice** | 721963009   | ServiceRequest                         |
| **Medications**         | 721912009   | MedicationStatement, MedicationRequest |
| **FollowUp**            | 390906007   | Appointment                            |
| **Procedure**           | 371525003   | Procedure                              |
| **Referral**            | —           | ServiceRequest                         |

**Key Constraints:**

- All sections require at least one narrative text, entry reference, or subsection
- Status binding: preliminary | final | amended | entered-in-error
- Attesters (optional) require mode (personal | professional | legal | official)

### Prescription Bundle — Example Structure (Prescription-example-06)

From NRCeS FHIR IG, a Prescription DocumentBundle contains **7 resource entries:**

**Entry 1: Composition (PrescriptionRecord)**

- Profile: PrescriptionRecord
- Identifier: `https://ndhm.in/phr/{uuid}`
- Status: Final
- Type: SNOMED CT #440545006 "Prescription record"
- Language: en-IN

**Entry 2: Patient**

- Profile: Patient (ABDM)
- Identifier system: `https://healthid.ndhm.gov.in` (ABHA number)
- MRN identifier type: HL7 v2.0203
- Demographics: name, DOB, gender, contact

**Entry 3: Practitioner**

- Identifier system: `https://doctor.ndhm.gov.in` (HPR ID)
- Name, qualification

**Entry 4 & 5: MedicationRequest Resources**

- Status: active
- Intent: order
- Medication: SNOMED coded (e.g., Azithromycin 250mg #324252006)
- Reason: SNOMED coded condition (e.g., Traveler's diarrhea #11840006)
- Dosage: with route, method, timing, additional instructions
- Additional instruction: SNOMED coded (e.g., "With/after food" #311504000)

**Entry 6: Condition**

- Clinical status: active
- Code: SNOMED coded (e.g., "Abdominal pain" #21522001)

**Entry 7: Binary**

- Content type: application/pdf
- Base64-encoded prescription PDF

**Coding Systems Used:**

- **SNOMED CT** — medications, conditions, routes, methods, instructions
- **HL7 v2.0203** — identifier types (MR = Medical Record)
- **HL7 v3-Confidentiality** — security classifications

**Key Identifiers:**

- PHR Identifier: UUID (Composition)
- Bundle Identifier: UUID
- Timestamp: ISO 8601 with IST offset (+05:30)

---

## Phase 1: ABHA Identity Integration (M1) — Foundation

### 1.1 Schema Changes

**`patients` table — add columns:**

```sql
ALTER TABLE patients ADD COLUMN abha_number TEXT;          -- 14-digit ABHA ID (e.g., "91-1234-5678-9012")
ALTER TABLE patients ADD COLUMN abha_address TEXT;          -- e.g., "patient@abdm"
ALTER TABLE patients ADD COLUMN abha_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN abha_linking_token TEXT;    -- 24-hour token from verification
ALTER TABLE patients ADD COLUMN abha_linked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX idx_patients_abha ON patients(abha_number) WHERE abha_number IS NOT NULL;
```

**`doctors` table — add columns:**

```sql
ALTER TABLE doctors ADD COLUMN hpr_id TEXT;                 -- Health Professional Registry ID
```

**New table: `abdm_care_contexts`**

```sql
CREATE TABLE abdm_care_contexts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id      TEXT NOT NULL REFERENCES patients(id),
  visit_id        UUID REFERENCES visits(id),
  prescription_id TEXT REFERENCES prescriptions(id),
  care_context_ref TEXT NOT NULL,           -- unique ref sent to ABDM
  display_text    TEXT NOT NULL,            -- e.g., "OPD Visit - 17 Mar 2026"
  record_types    TEXT[] NOT NULL,          -- ['OPConsultation', 'Prescription']
  linked          BOOLEAN DEFAULT FALSE,
  linked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**New table: `abdm_consent_artefacts`**

```sql
CREATE TABLE abdm_consent_artefacts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  consent_id      TEXT NOT NULL UNIQUE,     -- ABDM consent artefact ID
  patient_id      TEXT REFERENCES patients(id),
  requester_name  TEXT,
  purpose         TEXT,                     -- CAREMGT, BTG, PUBHLTH, etc.
  hi_types        TEXT[],                   -- ['OPConsultation', 'Prescription']
  date_range_from TIMESTAMPTZ,
  date_range_to   TIMESTAMPTZ,
  expiry          TIMESTAMPTZ,
  status          TEXT DEFAULT 'REQUESTED', -- REQUESTED, GRANTED, DENIED, REVOKED, EXPIRED
  artefact_json   JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.2 Registration Page Changes (`registration.html`)

**New UI elements:**

- **ABHA Number field** in Demographics section (after contact phone, before blood group)
- **"Verify ABHA" button** — calls ABDM V3 API to verify via Aadhaar OTP or demographics
- **"Create ABHA" button** — for patients without ABHA, initiate creation flow
- **"Scan & Share" receiver** — display hospital's ABDM QR code, listen for profile-share callbacks
- **Visual indicator**: Green checkmark when ABHA verified, linking token saved
- ABHA number displayed as pill/badge alongside UHID in patient header

**Flow:**

1. Patient arrives → reception scans existing QR (existing feature) OR patient scans hospital's ABDM QR from their ABHA app
2. If Scan & Share: patient profile auto-populates name, DOB, sex, ABHA number
3. If manual: receptionist enters ABHA number → clicks Verify → OTP sent to patient's phone → patient provides OTP → verified + linking token saved
4. If no ABHA: receptionist can create one via Aadhaar OTP flow (optional, not mandatory)

### 1.3 New Edge Function: `abdm-identity`

Handles ABHA verification, creation, and linking token management:

- `POST /verify-abha` — verify ABHA number, get patient profile, save linking token
- `POST /create-abha` — initiate ABHA creation via Aadhaar
- `POST /profile-share-callback` — receive Scan & Share profile from ABDM gateway

### 1.4 Health Facility Registry

- Register **Radhakishan Hospital** in ABDM Health Facility Registry (HFR) → get HFR ID
- Register **Dr. Lokender Goyal** in Health Professional Registry (HPR) → get HPR ID
- Store these IDs in `doctors` table and as environment variables

---

## Phase 2: FHIR Bundle Generation + Coding Standards

### 2.1 Add SNOMED-CT Codes

**`formulary` table — add column:**

```sql
ALTER TABLE formulary ADD COLUMN snomed_code TEXT;          -- SNOMED CT code for the drug
ALTER TABLE formulary ADD COLUMN snomed_display TEXT;        -- SNOMED display name
```

Populate for all 530 drugs. Example mappings:
| Generic Name | SNOMED Code | Display |
|---|---|---|
| AMOXICILLIN | 27658006 | Amoxicillin |
| PARACETAMOL | 387517004 | Paracetamol |
| AZITHROMYCIN | 396065005 | Azithromycin |
| IBUPROFEN | 387207008 | Ibuprofen |
| CETIRIZINE | 372523007 | Cetirizine |
| ONDANSETRON | 372487007 | Ondansetron |
| SALBUTAMOL | 372897005 | Salbutamol |
| PREDNISOLONE | 116601002 | Prednisolone |
| METRONIDAZOLE | 372602008 | Metronidazole |
| CEFTRIAXONE | 372670001 | Ceftriaxone |

**`standard_prescriptions` table — add column:**

```sql
ALTER TABLE standard_prescriptions ADD COLUMN snomed_code TEXT;  -- SNOMED for diagnosis
```

(ICD-10 already present — SNOMED adds clinical term specificity)

### 2.2 Add LOINC Codes to Lab Tests

The `COMMON_LABS` constant in `registration.html` currently defines 39 tests. Add LOINC codes:

```javascript
// Current:
{ name: 'Hemoglobin', unit: 'g/dL', category: 'Hematology' }
// Becomes:
{ name: 'Hemoglobin', unit: 'g/dL', category: 'Hematology', loinc: '718-7', loincDisplay: 'Hemoglobin [Mass/volume] in Blood' }
```

**`lab_results` table — add columns:**

```sql
ALTER TABLE lab_results ADD COLUMN loinc_code TEXT;
ALTER TABLE lab_results ADD COLUMN snomed_code TEXT;         -- for non-LOINC observations
```

### 2.3 New Edge Function: `generate-fhir-bundle`

This is the core FHIR generation engine. It converts your existing structured data into ABDM-compliant FHIR R4 Document Bundles.

**Endpoint:** `POST /generate-fhir-bundle`

**Input:** `{ type: 'OPConsultation' | 'Prescription' | 'DiagnosticReport' | 'ImmunizationRecord', visit_id, patient_id }`

**Output:** FHIR R4 Document Bundle JSON

**Bundle structure for each type:**

#### OPConsultation Bundle

```
Bundle (type: document)
├── Composition (type: SNOMED #371530004 "Clinical consultation report")
│   ├── section: ChiefComplaints → Condition resources
│   ├── section: PhysicalExamination → Observation resources (vitals)
│   ├── section: Allergies → AllergyIntolerance resources
│   ├── section: Medications → MedicationRequest resources
│   ├── section: InvestigationAdvice → ServiceRequest resources
│   └── section: FollowUp → Appointment resource
├── Patient (ABHA number as identifier)
├── Practitioner (HPR ID as identifier)
├── Organization (HFR ID as identifier)
├── Encounter (visit data)
├── Condition[] (diagnoses with ICD-10 + SNOMED)
├── Observation[] (vitals: weight, height, temp, HR, RR, SpO2)
├── AllergyIntolerance[] (from patients.known_allergies)
├── MedicationRequest[] (from prescriptions.medicines)
└── ServiceRequest[] (from prescriptions.investigations)
```

#### Prescription Bundle

```
Bundle (type: document)
├── Composition (type: SNOMED #440545006 "Prescription record")
│   └── section: Medications → MedicationRequest resources
├── Patient
├── Practitioner
├── MedicationRequest[] (with SNOMED drug codes, dosage instructions)
├── Condition[] (diagnoses as reason references)
└── Binary (optional: PDF of printed prescription)
```

#### DiagnosticReport Bundle

```
Bundle (type: document)
├── Composition (type: SNOMED #721981007)
├── Patient
├── Practitioner
├── DiagnosticReport (with LOINC coded results)
└── Observation[] (individual test results with LOINC codes)
```

#### ImmunizationRecord Bundle

```
Bundle (type: document)
├── Composition (type: SNOMED #41000179103)
├── Patient
├── Practitioner
└── Immunization[] (vaccine name, dose, date, batch, route)
```

### 2.4 FHIR Resource Mapping from Existing Data

| Your Data                        | FHIR Resource        | Key Mapping                                                                                     |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `patients` row                   | `Patient`            | `abha_number` → identifier (system: `https://healthid.ndhm.gov.in`), UHID → MRN identifier      |
| `doctors` row                    | `Practitioner`       | `hpr_id` → identifier (system: `https://doctor.ndhm.gov.in`), `registration_no` → qualification |
| Hospital                         | `Organization`       | HFR ID → identifier (system: `https://facility.ndhm.gov.in`)                                    |
| `visits` row                     | `Encounter`          | visit_date, chief_complaints, vitals                                                            |
| `prescriptions.medicines[]`      | `MedicationRequest`  | drug name → SNOMED code, dosage → FHIR Dosage                                                   |
| `prescriptions.investigations[]` | `ServiceRequest`     | investigation name → SNOMED code                                                                |
| `visits.diagnosis_codes[]`       | `Condition`          | ICD-10 code → coding, name → text                                                               |
| `patients.known_allergies[]`     | `AllergyIntolerance` | allergy name → substance                                                                        |
| `visits` vitals                  | `Observation`        | weight → LOINC 29463-7, height → LOINC 8302-2, temp → LOINC 8310-5, etc.                        |
| `lab_results` row                | `Observation`        | loinc_code → coding, value → valueQuantity                                                      |
| `vaccinations` row               | `Immunization`       | vaccine_name → vaccineCode, date_given → occurrenceDateTime                                     |

### 2.5 Vital Signs LOINC Mapping

| Vital              | LOINC Code | LOINC Display                        | Source Column     |
| ------------------ | ---------- | ------------------------------------ | ----------------- |
| Body Weight        | 29463-7    | Body weight                          | visits.weight_kg  |
| Body Height        | 8302-2     | Body height                          | visits.height_cm  |
| Head Circumference | 9843-4     | Head Occipital-frontal circumference | visits.hc_cm      |
| Body Temperature   | 8310-5     | Body temperature                     | visits.temp_f     |
| Heart Rate         | 8867-4     | Heart rate                           | visits.hr_per_min |
| Respiratory Rate   | 9279-1     | Respiratory rate                     | visits.rr_per_min |
| SpO2               | 2708-6     | Oxygen saturation in Arterial blood  | visits.spo2_pct   |
| MUAC               | 56072-2    | Mid upper arm circumference          | visits.muac_cm    |

### 2.6 Lab Tests LOINC Mapping (39 COMMON_LABS)

| Test Name               | LOINC Code | LOINC Display                                             |
| ----------------------- | ---------- | --------------------------------------------------------- |
| Hemoglobin              | 718-7      | Hemoglobin [Mass/volume] in Blood                         |
| WBC Count               | 6690-2     | Leukocytes [#/volume] in Blood                            |
| Platelet Count          | 777-3      | Platelets [#/volume] in Blood                             |
| RBC Count               | 789-8      | Erythrocytes [#/volume] in Blood                          |
| Hematocrit (PCV)        | 4544-3     | Hematocrit [Volume Fraction] of Blood                     |
| MCV                     | 787-2      | MCV [Entitic volume]                                      |
| MCH                     | 785-6      | MCH [Entitic mass]                                        |
| MCHC                    | 786-4      | MCHC [Mass/volume]                                        |
| ESR                     | 4537-7     | Erythrocyte sedimentation rate                            |
| Reticulocyte Count      | 17849-1    | Reticulocytes/100 erythrocytes in Blood                   |
| Peripheral Smear        | 34165-1    | Blood smear finding                                       |
| Blood Group             | 882-1      | ABO+Rh group [Type] in Blood                              |
| S. Creatinine           | 2160-0     | Creatinine [Mass/volume] in Serum                         |
| Blood Urea              | 3094-0     | Urea nitrogen [Mass/volume] in Serum                      |
| S. Bilirubin (Total)    | 1975-2     | Bilirubin.total [Mass/volume] in Serum                    |
| S. Bilirubin (Direct)   | 1968-7     | Bilirubin.direct [Mass/volume] in Serum                   |
| SGPT (ALT)              | 1742-6     | ALT [Enzymatic activity/volume] in Serum                  |
| SGOT (AST)              | 1920-8     | AST [Enzymatic activity/volume] in Serum                  |
| Alkaline Phosphatase    | 6768-6     | Alkaline phosphatase [Enzymatic activity/volume] in Serum |
| S. Albumin              | 1751-7     | Albumin [Mass/volume] in Serum                            |
| Total Protein           | 2885-2     | Total protein [Mass/volume] in Serum                      |
| Blood Glucose (Random)  | 2339-0     | Glucose [Mass/volume] in Blood                            |
| Blood Glucose (Fasting) | 1558-6     | Fasting glucose [Mass/volume] in Blood                    |
| HbA1c                   | 4548-4     | Hemoglobin A1c/Hemoglobin.total in Blood                  |
| S. Sodium               | 2951-2     | Sodium [Moles/volume] in Serum                            |
| S. Potassium            | 2823-3     | Potassium [Moles/volume] in Serum                         |
| S. Calcium              | 17861-6    | Calcium [Mass/volume] in Serum                            |
| S. Phosphorus           | 2777-1     | Phosphate [Mass/volume] in Serum                          |
| S. Magnesium            | 19123-9    | Magnesium [Mass/volume] in Serum                          |
| CRP                     | 1988-5     | C reactive protein [Mass/volume] in Serum                 |
| Procalcitonin           | 75241-0    | Procalcitonin [Mass/volume] in Serum                      |
| S. Ferritin             | 2276-4     | Ferritin [Mass/volume] in Serum                           |
| S. Iron                 | 2498-4     | Iron [Mass/volume] in Serum                               |
| TIBC                    | 2500-7     | Iron binding capacity [Mass/volume] in Serum              |
| Urine Routine           | 24356-8    | Urinalysis complete panel in Urine                        |
| Blood Culture           | 600-7      | Bacteria identified in Blood by Culture                   |
| Urine Culture           | 630-4      | Bacteria identified in Urine by Culture                   |
| Chest X-Ray             | 36643-5    | Chest X-ray                                               |
| USG Abdomen             | 24861-7    | US Abdomen                                                |

### 2.7 Prescription Pad Changes (`prescription-pad.html`)

After prescription is approved and saved:

1. Auto-generate FHIR OPConsultation + Prescription bundles
2. Create care context entry in `abdm_care_contexts`
3. If patient has verified ABHA → auto-link care context to ABDM via linking token
4. Store FHIR bundle JSON in `prescriptions` table (new column: `fhir_bundle JSONB`)
5. Show "ABDM Linked" badge on the prescription

### 2.8 Print Station Changes (`prescription-output.html`)

- Display ABDM linking status on each prescription card
- Add "View FHIR Bundle" debug button (for testing)

---

## Phase 3: HIP Services (M2) — Share Records

### 3.1 ABDM Wrapper Deployment

Deploy the NHA ABDM Wrapper as a Docker container:

- **Wrapper service**: Java Spring Boot on port 8082
- **MongoDB**: port 27017
- **Connects to**: ABDM V3 Gateway (sandbox: `https://dev.abdm.gov.in`)

Configure wrapper with:

- Facility's HFR ID
- Callback URL pointing to your Supabase Edge Functions
- Client ID + Client Secret from ABDM sandbox registration

### 3.2 New Edge Functions for HIP Callbacks

The ABDM gateway calls back to the HIP (your system) for these flows:

**`abdm-hip-discover`** — Patient discovery

- ABDM sends patient identifiers (ABHA number, demographics)
- Your function searches `patients` table, returns matching care contexts
- Response: list of visits/prescriptions as care contexts

**`abdm-hip-link`** — Care context linking

- ABDM sends link request for specific care contexts
- Your function validates and confirms the link
- Updates `abdm_care_contexts.linked = true`

**`abdm-hip-consent`** — Consent notification

- ABDM notifies when patient grants/revokes consent
- Your function stores consent artefact in `abdm_consent_artefacts`
- Acknowledges receipt to ABDM

**`abdm-hip-data-transfer`** — Health information request

- ABDM requests specific health records (with consent artefact)
- Your function:
  1. Validates consent artefact (purpose, date range, record types, expiry)
  2. Fetches relevant data from your tables
  3. Generates FHIR Bundles via `generate-fhir-bundle`
  4. **Encrypts** bundles using **Fidelius** (ECDH encryption library mandated by ABDM)
  5. Pushes encrypted data to the data-push URL provided by ABDM
  6. Acknowledges to ABDM

### 3.3 Fidelius Encryption

ABDM mandates all health data be encrypted using the Fidelius library (Elliptic Curve Diffie-Hellman). Need a Deno/TypeScript implementation or call out to the Java Fidelius library via the wrapper.

### 3.4 Record Types to Support (5 mandatory for M2)

| Record Type            | Source Data             | FHIR Bundle Type       |
| ---------------------- | ----------------------- | ---------------------- |
| OPD Consultation Notes | visits + prescriptions  | OPConsultRecord        |
| Prescriptions          | prescriptions.medicines | PrescriptionRecord     |
| Diagnostic Reports     | lab_results             | DiagnosticReportRecord |
| Immunization Records   | vaccinations            | ImmunizationRecord     |
| Health Documents       | documents bucket files  | HealthDocumentRecord   |

---

## Phase 4: HIU Services (M3) — Receive Records

### 4.1 Purpose

Allow Dr. Lokender to **request and view health records** from other hospitals/facilities where the patient has been treated. This gives a complete medical history beyond what's in your system.

### 4.2 Prescription Pad Changes

New **"Fetch ABDM Records"** button on the patient info panel:

1. Doctor clicks → consent request sent to patient's ABHA app
2. Patient approves on their phone
3. Encrypted FHIR bundles arrive from other HIPs
4. Your system decrypts and renders them in a "External Records" tab

### 4.3 New Edge Functions

**`abdm-hiu-consent-request`** — Initiate consent request

- Doctor specifies: purpose (treatment), record types, date range
- Sends to ABDM gateway via wrapper

**`abdm-hiu-data-receive`** — Receive health records

- Decrypts incoming FHIR bundles
- Parses and stores temporarily for doctor viewing
- Renders in Patient Lookup / Prescription Pad

### 4.4 Patient Lookup Changes (`patient-lookup.html`)

- New "ABDM Records" section showing records fetched from other facilities
- FHIR Bundle renderer to display external prescriptions, lab reports, discharge summaries in readable format

---

## Phase 5: Coding & Terminology Enrichment

### 5.1 SNOMED-CT Integration

**Data enrichment needed:**

- Map all 530 formulary drugs to SNOMED-CT codes (medication codes)
- Map all 446 standard prescriptions to SNOMED-CT codes (clinical finding codes)
- Map common procedures to SNOMED-CT
- Map routes of administration to SNOMED-CT (e.g., oral → 26643006)

**SNOMED-CT Route Codes:**

| Route         | SNOMED Code       | Display                          |
| ------------- | ----------------- | -------------------------------- |
| Oral          | 26643006          | Oral route                       |
| Intravenous   | 47625008          | Intravenous route                |
| Intramuscular | 78421000          | Intramuscular route              |
| Subcutaneous  | 34206005          | Subcutaneous route               |
| Inhaled       | 18679011000001101 | Inhalation                       |
| Topical       | 6064005           | Topical route                    |
| Rectal        | 37161004          | Rectal route                     |
| Nasal         | 46713006          | Nasal route                      |
| Ophthalmic    | 54485002          | Ophthalmic route                 |
| Nebulisation  | 45890007          | Transdermal route (nebulisation) |

**SNOMED-CT Dosage Method Codes:**

| Method   | SNOMED Code | Display  |
| -------- | ----------- | -------- |
| Swallow  | 421521009   | Swallow  |
| Chew     | 419747000   | Chew     |
| Dissolve | 421682005   | Dissolve |
| Inject   | 422145002   | Inject   |
| Apply    | 417924000   | Apply    |
| Inhale   | 420606003   | Inhale   |

**SNOMED-CT Additional Instruction Codes:**

| Instruction     | SNOMED Code | Display            |
| --------------- | ----------- | ------------------ |
| With/after food | 311504000   | With or after food |
| Before food     | 311501003   | Before food        |
| Empty stomach   | 69621006    | On empty stomach   |
| At bedtime      | 307163004   | At bedtime         |

**Script needed:** `import_snomed_mappings.js` — bulk update formulary and standard_prescriptions tables with SNOMED codes. Can use the SNOMED CT Browser API or NRCeS SNOMED browser for mapping (India has free national license via NRCeS).

### 5.2 LOINC Integration

Full mapping tables provided in sections 2.5 and 2.6 above.

**Script needed:** `import_loinc_mappings.js` — update COMMON_LABS with LOINC codes and bulk update lab_results table.

---

## Phase 6: Security & Certification

### 6.1 WASA (Web Application Security Audit)

**Mandatory** for ABDM sandbox exit. Must be conducted by a **CERT-IN empanelled agency**. Covers:

- OWASP Top 10 audit (your system already uses `esc()` for XSS, but needs full audit)
- Authentication & authorization (currently anon-key POC — must implement proper auth)
- Data encryption at rest and in transit (Supabase provides TLS, need to verify)
- Session management (currently no sessions — need to add for ABDM)
- API security (CORS, rate limiting, input validation)
- PHI/PII handling audit

**Pre-WASA remediation needed:**

1. **Replace anon-key full access with proper Supabase Auth** — role-based RLS policies for doctor, nurse, receptionist
2. **Add rate limiting** to Edge Functions
3. **Audit all REST API calls** for injection risks
4. **Add HTTPS enforcement** (GitHub Pages already provides this)
5. **Implement session timeouts** and secure cookie handling
6. **PHI encryption** for sensitive fields (diagnosis, prescriptions) at rest

### 6.2 Sandbox Testing

1. Register on [sandbox.abdm.gov.in](https://sandbox.abdm.gov.in/) → get Client ID + Client Secret
2. Test all M1 flows (ABHA verify, create, link)
3. Test all M2 flows (HIP discovery, linking, consent, data transfer)
4. Test all M3 flows (HIU consent request, data receive)
5. NHA team conducts functional testing
6. Pass WASA audit → get "Safe-to-Host" certificate
7. Get production credentials

---

## Summary: Files to Create/Modify

### New Files to Create

| File                                                     | Purpose                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| `supabase/functions/abdm-identity/index.ts`              | ABHA verify, create, Scan & Share                                 |
| `supabase/functions/generate-fhir-bundle/index.ts`       | FHIR R4 Bundle generator (all 5 types)                            |
| `supabase/functions/abdm-hip-discover/index.ts`          | HIP patient discovery callback                                    |
| `supabase/functions/abdm-hip-link/index.ts`              | HIP care context linking callback                                 |
| `supabase/functions/abdm-hip-consent/index.ts`           | HIP consent notification handler                                  |
| `supabase/functions/abdm-hip-data-transfer/index.ts`     | HIP health data transfer (encrypt + push)                         |
| `supabase/functions/abdm-hiu-consent-request/index.ts`   | HIU consent request initiator                                     |
| `supabase/functions/abdm-hiu-data-receive/index.ts`      | HIU data receive + decrypt                                        |
| `radhakishan_system/schema/abdm_schema.sql`              | New tables (care_contexts, consent_artefacts) + ALTER statements  |
| `radhakishan_system/scripts/import_snomed_mappings.js`   | Bulk SNOMED-CT code import for formulary + standard_prescriptions |
| `radhakishan_system/scripts/import_loinc_mappings.js`    | Bulk LOINC code import for lab tests                              |
| `radhakishan_system/data/snomed_drug_mappings.json`      | 530 drug → SNOMED-CT mappings                                     |
| `radhakishan_system/data/snomed_diagnosis_mappings.json` | 446 diagnosis → SNOMED-CT mappings                                |
| `radhakishan_system/data/snomed_route_mappings.json`     | Route/method/instruction → SNOMED-CT mappings                     |
| `radhakishan_system/data/loinc_lab_mappings.json`        | 39 lab test → LOINC mappings                                      |
| `radhakishan_system/data/loinc_vitals_mappings.json`     | 8 vitals → LOINC mappings                                         |

### Existing Files to Modify

| File                                                                                     | Changes                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `radhakishan_system/schema/radhakishan_supabase_schema.sql`                              | Add ABHA columns to patients, hpr_id to doctors, snomed_code to formulary + standard_prescriptions, loinc_code to lab_results, fhir_bundle to prescriptions, new tables |
| `radhakishan_system/artifacts/registration.html` → `web/registration.html`               | ABHA number field, verify button, Scan & Share QR receiver, LOINC codes in COMMON_LABS                                                                                  |
| `radhakishan_system/artifacts/prescription-pad.html` → `web/prescription-pad.html`       | FHIR generation on approve, ABDM linking, "Fetch ABDM Records" button, care context creation, "ABDM Linked" badge                                                       |
| `radhakishan_system/artifacts/prescription-output.html` → `web/prescription-output.html` | ABDM linked status badge, "View FHIR Bundle" debug button                                                                                                               |
| `radhakishan_system/artifacts/patient-lookup.html` → `web/patient-lookup.html`           | "ABDM Records" tab for external records, FHIR Bundle renderer                                                                                                           |
| `supabase/functions/generate-prescription/index.ts`                                      | Pass SNOMED codes through to prescription JSON for downstream FHIR generation                                                                                           |
| `radhakishan_system/artifacts/index.html` → `web/index.html`                             | ABDM compliance badge on landing page                                                                                                                                   |

### No Changes Needed

| File                                       | Reason                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `formulary.html` / `formulary-import.html` | Formulary UI unchanged (SNOMED added at DB level)                            |
| `standard-rx.html`                         | Standard Rx UI unchanged                                                     |
| Skill files (`core_prompt.md`, references) | AI prompt doesn't need FHIR awareness — FHIR generation is post-prescription |
| `generate-visit-summary/index.ts`          | Visit summary is internal, not shared via ABDM                               |

---

## Implementation Priority & Dependency Order

```
Phase 1 (M1): ABHA Identity
  ├── 1a. Schema changes (abha columns, new tables)
  ├── 1b. HFR + HPR registration (manual, one-time)
  ├── 1c. abdm-identity Edge Function
  └── 1d. Registration page UI changes

Phase 2: FHIR + Coding
  ├── 2a. SNOMED mappings for formulary (530 drugs)
  ├── 2b. LOINC mappings for labs (39 tests) + vitals (8)
  ├── 2c. generate-fhir-bundle Edge Function
  └── 2d. Prescription pad FHIR generation on approve

Phase 3 (M2): HIP Services
  ├── 3a. Deploy ABDM Wrapper (Docker)
  ├── 3b. HIP callback Edge Functions (4 functions)
  ├── 3c. Fidelius encryption integration
  └── 3d. Sandbox M2 testing

Phase 4 (M3): HIU Services
  ├── 4a. HIU Edge Functions (2 functions)
  ├── 4b. Prescription pad "Fetch ABDM Records" UI
  ├── 4c. Patient lookup external records display
  └── 4d. Sandbox M3 testing

Phase 5: Security & Certification
  ├── 5a. Replace anon-key with proper auth (pre-requisite for WASA)
  ├── 5b. WASA audit by CERT-IN empanelled agency
  └── 5c. Production credentials
```

---

## Key Risks & Mitigations

| Risk                                               | Impact                                    | Mitigation                                                      |
| -------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| ABDM V3 APIs still sandbox-only (V1 in production) | May need to support both API versions     | Build against V3, wrapper abstracts this                        |
| Fidelius encryption in Deno (no official Deno lib) | Can't encrypt health data for transfer    | Use wrapper's Java Fidelius, or port ECDH to WebCrypto API      |
| SNOMED-CT licensing                                | India has free national license via NRCeS | Use NRCeS SNOMED browser for mapping                            |
| WASA audit cost                                    | ₹2-5 lakhs for CERT-IN empanelled audit   | Budget for this, it's mandatory                                 |
| Auth migration breaks existing workflow            | Current POC uses anon key everywhere      | Phase auth migration carefully, test thoroughly                 |
| ABDM gateway uptime / latency                      | May slow down registration flow           | Make ABHA verification async/non-blocking, cache linking tokens |
| MongoDB requirement from NHA Wrapper               | Additional database to manage             | Dockerized, wrapper manages its own data                        |

---

## Compliance Timeline

| Timeline    | Requirement                                                        | Our Status                           |
| ----------- | ------------------------------------------------------------------ | ------------------------------------ |
| **2024**    | NMC directed medical colleges to integrate ABDM                    | N/A                                  |
| **2025**    | ABDM compliance recommended for all hospitals                      | Not started                          |
| **2026**    | **Mandatory for AB-PMJAY empanelled hospitals**                    | Planning phase (this document)       |
| **Ongoing** | NABH accreditation increasingly linked to digital health standards | NABH accredited, need ABDM alignment |

**For Radhakishan Hospital (NABH accredited):**

- ABDM integration is **strongly recommended now** and will likely become **mandatory**
- NABH's Digital Health Standards (DHS) 2nd Edition (September 2025) aligns with ABDM
- Being an early adopter gives competitive advantage
- Strategic advantage shifts from differentiator to table stakes in 2026-2027

---

## References

- [ABDM Official Portal](https://abdm.gov.in/)
- [ABDM Sandbox Documentation](https://sandbox.abdm.gov.in/)
- [ABDM Sandbox Docs (Community)](https://kiranma72.github.io/abdm-docs/)
- [NRCeS FHIR Implementation Guide v6.5.0](https://nrces.in/ndhm/fhir/r4/index.html)
- [NRCeS FHIR IG v3.0.1](https://nrces.in/ndhm/fhir/r4/3.0.1/)
- [FHIR Profiles List](https://nrces.in/ndhm/fhir/r4/profiles.html)
- [OPConsultRecord Profile](https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html)
- [PrescriptionRecord Profile](https://www.nrces.in/ndhm/fhir/r4/StructureDefinition-PrescriptionRecord.html)
- [MedicationRequest Profile](https://nrces.in/ndhm/fhir/r4/StructureDefinition-MedicationRequest.html)
- [Patient Profile](https://nrces.in/ndhm/fhir/r4/StructureDefinition-Patient.html)
- [Prescription Bundle Example](https://www.nrces.in/ndhm/fhir/r4/Bundle-Prescription-example-06.html)
- [Prescription Bundle JSON](https://nrces.in/ndhm/fhir/r4/3.0.1/Bundle-Prescription-example-06.json.html)
- [Implementation Guide PDF](https://www.nrces.in/download/files/pdf/Implementation_Guide_for_Adoption_of_FHIR_in_ABDM_and_NHCX.pdf)
- [ABDM Integration Milestones M1-M3](https://nirmitee.io/blog/abdm-integration-milestones-m1-m2-m3-m4-multi-software-guide/)
- [ABDM Integration Guide 2026](https://www.adrine.in/blog/abdm-integration-guide)
- [ABHA Integration Guide (PM Playbook)](https://productgrowth.in/insights/healthtech/abha-integration-guide/)
- [ABDM Compliance for AB-PMJAY 2026](https://ehr.network/abdm-compliance-ab-pmjay-hospitals-2026/)
- [NHA ABDM Wrapper (GitHub)](https://github.com/NHA-ABDM/ABDM-wrapper)
- [ABDM Wrapper (Community)](https://github.com/imvpathak/ABDM-Wrapper)
- [Building HIP (CoronaSafe Docs)](https://docs.coronasafe.network/abdm-documentation/implementers-guide/building-hip)
- [Consent Manager (CoronaSafe Docs)](https://docs.coronasafe.network/abdm-documentation/building-blocks/consent-manager-and-gateway)
- [Care Context Linking (CoronaSafe Docs)](https://docs.coronasafe.network/abdm-documentation/abha-number-service-or-milestone-2/user-patient-initiated-linking/verify-the-patient-and-link-the-care-context-as-requested-by-the-patient)
- [ABDM Certification Guide 2026](https://qualysec.com/abdm-certification/)
- [WASA Audit Requirements (CertCube)](https://blog.certcube.com/wasa-audits-ensuring-abdm-compliance/)
- [WASA Audit (QRC Solutions)](https://www.qrcsolutionz.com/blog/understanding-wasa-audits-abdm-compliance-simplified)
- [ABHA Security Certificate (Astra)](https://www.getastra.com/blog/compliance/abha-web-application-security-certificate/)
- [ABDM Penetration Testing Companies](https://www.getastra.com/blog/compliance/abdm-penetration-testing-companies/)
- [NABH Digital Health Standards 2nd Edition](https://portal.nabh.co/Announcement/Draft%20NABH%20DHS%202nd%20Edition.pdf)
- [FHIR Terminology Server Guide](https://www.nrces.in/download/files/pdf/Guide_to_Setup_FHIR_Terminology_Server.pdf)
- [Scan & Share (PMC Study)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11774221/)
- [Scan & Share (MoHFW)](https://mohfw.gov.in/?q=hi/node/7543)
- [Scan & Share (PIB)](https://www.pib.gov.in/PressReleasePage.aspx?PRID=1901721)
- [ABDM Best Practices (NITI Aayog)](https://www.nitiforstates.gov.in/public-assets/images/20250625_121028_best-practices-draft-scan-&-share-+-hmis-implementation.pdf)
- [Bahmni ABDM Integration](https://bahmni.atlassian.net/wiki/spaces/BAH/pages/2901114904/Bahmni+as+Health+Information+Provider+ABDM+NDHM)
- [OHC ABDM Docs](https://docs.ohc.network/docs/care/abdm/)
- [ABDM (CoronaSafe Overview)](https://docs.coronasafe.network/abdm-documentation/overview-of-fhr-framework/apis-and-standards)
- [Medblocks ABDM Case Study (Andhra Pradesh)](https://medblocks.com/blog/abdm-for-the-ap-government-a-honest-review)
- [HL7 FHIR SNOMED-CT Usage](https://build.fhir.org/snomedct-usage.html)
- [SNOMED-CT Medication Codes](http://hl7.org/fhir/valueset-medication-codes.html)
- [EHR.Network ABDM Workflows](https://ehr.network/unified-abdm-workflows-one-service-for-all-abdm-integration-workflows/)
- [ABDM QCI Certification](https://abdm.gov.in/qcicertified)
- [HL7 India ABDM Track](https://confluence.hl7.org/display/HIN/ABDM+Implementation+Track)
- [PMC: ABDM Assessment](https://www.tandfonline.com/doi/full/10.1080/23288604.2024.2392290)
- [PMC: Digital Foundations for Health Equity](https://pmc.ncbi.nlm.nih.gov/articles/PMC12349786/)

---

**Document prepared:** 17 March 2026
**System:** Radhakishan Hospital Pediatric OPD Prescription System
**Status:** Planning phase — no ABDM code implemented yet
