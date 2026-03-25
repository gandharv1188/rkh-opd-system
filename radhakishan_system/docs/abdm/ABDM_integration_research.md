# National Health Digitization — ABDM Integration & Healthcare Data Interoperability

## Research Report for Radhakishan Hospital OPD System

---

## 1. Ayushman Bharat Digital Mission (ABDM) — Overview

The **Ayushman Bharat Digital Mission (ABDM)**, formerly the National Digital Health Mission (NDHM), was launched in September 2021 with a budget of **₹1,600 crore for 5 years** (2021-2026). It is India's national-scale effort to create a unified digital health ecosystem.

**Current Scale (as of January 2026):**

- **84.79 crore ABHA IDs** created
- **82.69 crore health records** linked
- **17,000+ health facilities** integrated across 35 states/UTs
- **6.6 crore OPD registrations** completed via ABDM
- **~2 lakh OPD tokens** generated daily

**Core Components:**
| Component | Purpose |
|---|---|
| **ABHA (Ayushman Bharat Health Account)** | 14-digit unique health ID for every citizen |
| **Health Facility Registry (HFR)** | National registry of all healthcare facilities |
| **Health Professional Registry (HPR)** | National registry of all healthcare professionals |
| **Health Information Exchange & Consent Manager (HIE-CM)** | Federated consent-based health data exchange |
| **ABDM Sandbox** | Testing environment for integration |

Sources: [ABDM Official](https://abdm.gov.in/), [PIB Factsheet](https://www.pib.gov.in/FactsheetDetails.aspx?Id=149066), [PMC Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC10064942/)

---

## 2. ABHA Integration — What It Means for OPD

### 2.1 ABHA Number

- **14-digit randomly generated unique ID** for each patient
- Can be linked to multiple ABHA addresses (e.g., `patient@abdm`)
- Created via Aadhaar OTP, driving license, or demographic verification
- **Replaces hospital-specific UHIDs** for interoperability — but hospitals can maintain internal IDs alongside

### 2.2 Scan & Share for OPD Registration

The ABDM **Scan & Share** workflow is directly relevant to our Registration page:

1. Hospital displays a **unique ABDM QR code** at reception
2. Patient scans it using ABHA App / Aarogya Setu / any ABDM-enabled app
3. Patient's **profile details auto-shared** with the hospital
4. Hospital generates an **OPD token number** sent as notification to patient's app
5. Token displayed on OPD counter screens

**Impact:** Registration time reduced from **~50 minutes to 4-5 minutes** with accurate data capture.

### 2.3 What We Need to Build

| Current State (Our System)        | ABDM Requirement                                 |
| --------------------------------- | ------------------------------------------------ |
| UHID: RKH-YYMM##### (internal)    | Link ABHA Number to our UHID                     |
| Manual patient entry at reception | Support Scan & Share QR flow                     |
| No health record sharing          | Implement HIP (Health Information Provider) APIs |
| Prescription as PDF               | Prescription as FHIR Bundle                      |
| Vaccination in local table        | ImmunizationRecord as FHIR document              |
| Lab results in local table        | DiagnosticReport as FHIR document                |

Sources: [ABDM Scan & Share](https://www.dpi.global/globaldpi/abdm), [MoHFW Press Release](https://www.mohfw.gov.in/?q=en/pressrelease-87)

---

## 3. Health Data Interoperability Standards

ABDM mandates the following coding systems:

### 3.1 Coding Standards

| Standard      | Used For                   | Our Current State                | Gap                                        |
| ------------- | -------------------------- | -------------------------------- | ------------------------------------------ |
| **ICD-10**    | Diagnosis codes            | ✅ Already using (446 protocols) | None — compliant                           |
| **SNOMED-CT** | Clinical terms, procedures | ❌ Not implemented               | Need SNOMED codes for procedures, findings |
| **LOINC**     | Lab tests, observations    | ❌ Not implemented               | Need LOINC codes for lab_results           |
| **FHIR R4**   | Data exchange format       | ❌ Not implemented               | Need FHIR Bundle generation                |
| **HL7**       | Message format             | ❌ Not implemented               | Wrapped by FHIR                            |
| **DICOM**     | Imaging                    | ❌ Not applicable (no imaging)   | N/A for OPD text prescriptions             |

### 3.2 FHIR (Fast Healthcare Interoperability Resources)

ABDM mandates **FHIR R4** as the data exchange format. All health records must be packaged as **FHIR Bundles** containing a **Composition** resource.

The **NRCeS (National Resource Centre for EHR Standards)** maintains the India-specific FHIR Implementation Guide at [nrces.in/ndhm/fhir/r4](https://nrces.in/ndhm/fhir/r4/index.html) — currently at **v6.5.0** (May 2025).

### 3.3 ABDM Health Record Types (8 Types)

| Record Type              | SNOMED Code | Relevant to Us?           | FHIR Composition Profile |
| ------------------------ | ----------- | ------------------------- | ------------------------ |
| **OPConsultation**       | 371530004   | ✅ Core — our main output | OPConsultNote            |
| **Prescription**         | —           | ✅ Core — medicine orders | PrescriptionRecord       |
| **DiagnosticReport**     | 721981007   | ✅ Lab results            | DiagnosticReportLab      |
| **ImmunizationRecord**   | 41000179103 | ✅ Vaccination tracking   | ImmunizationRecord       |
| **DischargeSummary**     | 373942005   | ❌ Not OPD                | DischargeSummaryRecord   |
| **HealthDocumentRecord** | 419891008   | ✅ Uploaded documents     | HealthDocumentRecord     |
| **WellnessRecord**       | —           | ⚠️ Growth/vitals tracking | WellnessRecord           |
| **InvoiceRecord**        | —           | ❌ No billing yet         | N/A                      |

Sources: [ABDM Sandbox Health Record Formats](https://sandbox.abdm.gov.in/sandbox/v3/new-documentation?doc=HealthRecordFormats), [NRCeS FHIR IG](https://nrces.in/ndhm/fhir/r4/index.html), [ABDM FHIR Toolkit](https://ndhmexchange.uat.dcservices.in/FHIRConnector/)

---

## 4. ABDM Integration Milestones (Certification Path)

Integration follows **3 mandatory milestones** tested in the ABDM Sandbox:

### M1 — ABHA Operations (Patient Identity)

- Create ABHA Number (via Aadhaar OTP / demographics)
- Capture & verify ABHA during OPD registration
- Link ABHA to patient health information
- Save linking token

### M2 — HIP Services (Share Records)

- Register as **Health Information Provider (HIP)**
- Generate health records as FHIR Bundles
- Support **5 major record types:**
  - OPD Consultation Notes
  - Prescriptions
  - Diagnostic Reports
  - Immunization Records
  - Health Document Records
- Handle consent-based data sharing

### M3 — HIU Services (Receive Records)

- Register as **Health Information User (HIU)**
- Request patient's health records from other facilities
- Handle consent artefacts (time-bound, purpose-specific)
- Display received records to authorized healthcare workers

### Sandbox Exit Process

1. Integration in V3 Sandbox
2. Functional testing by NHA team
3. **Web Application Security Assessment (WASA)** by CERT-IN empanelled agency (OWASP-10 audit)
4. Final approval → production credentials issued

Sources: [ABDM Milestones Guide](https://nirmitee.io/blog/abdm-integration-milestones-m1-m2-m3-m4-multi-software-guide/), [Sandbox Documentation](https://kiranma72.github.io/abdm-docs/), [EHR.Network Guide](https://ehr.network/unified-abdm-workflows-one-service-for-all-abdm-integration-workflows/)

---

## 5. Consent Framework

Every health data access requires **explicit, granular patient consent:**

| Consent Element       | Description                                               |
| --------------------- | --------------------------------------------------------- |
| **Purpose**           | Treatment, Self-use, Payment, Research, etc.              |
| **Health Info Types** | Which record types (Prescription, DiagnosticReport, etc.) |
| **Date Range**        | Time window for records requested                         |
| **Expiry**            | When the consent expires                                  |
| **Frequency**         | How many times data can be accessed                       |
| **Encryption**        | All data encrypted before transmission                    |

The patient grants/revokes consent via their PHR app (ABHA app). The **Consent Manager** mediates between HIP and HIU.

Sources: [ABDM Consent Framework](https://docs.coronasafe.network/abdm-documentation/overview-of-fhr-framework/apis-and-standards)

---

## 6. Compliance Timeline & Mandate

| Timeline    | Requirement                                                        |
| ----------- | ------------------------------------------------------------------ |
| **2024**    | NMC directed all medical colleges to integrate HMIS with ABDM      |
| **2025**    | ABDM compliance recommended for all hospitals                      |
| **2026**    | **Mandatory for AB-PMJAY empanelled hospitals**                    |
| **Ongoing** | NABH accreditation increasingly linked to digital health standards |

**For Radhakishan Hospital (NABH accredited):**

- ABDM integration is **strongly recommended now** and will likely become **mandatory**
- NABH's Digital Health Standards (DHS) 2nd Edition (September 2025) aligns with ABDM
- Being an early adopter gives competitive advantage

Sources: [ABDM Compliance 2026](https://ehr.network/abdm-compliance-ab-pmjay-hospitals-2026/), [ABDM Integration Guide](https://www.adrine.in/blog/abdm-integration-guide), [NMC Notification](https://medicaldialogues.in/health-news/nmc/nmc-orders-medical-colleges-to-integrate-hmis-of-attached-hospitals-with-ayushman-bharat-digital-mission-portal-165965)

---

## 7. Gap Analysis — Radhakishan Hospital System vs ABDM

### What We Already Have (Compliant)

| Feature                                    | ABDM Alignment                                   |
| ------------------------------------------ | ------------------------------------------------ |
| ICD-10 coded diagnoses (446 protocols)     | ✅ Required for all records                      |
| Structured prescription JSON               | ✅ Can be mapped to FHIR MedicationRequest       |
| Structured lab results (lab_results table) | ✅ Can be mapped to FHIR DiagnosticReport        |
| Vaccination records (vaccinations table)   | ✅ Can be mapped to FHIR ImmunizationRecord      |
| Patient demographics (patients table)      | ✅ Can be mapped to FHIR Patient resource        |
| Visit records with vitals                  | ✅ Can be mapped to FHIR Encounter + Observation |
| Document uploads (documents bucket)        | ✅ Can be packaged as HealthDocumentRecord       |
| QR code on prescriptions                   | ✅ Aligns with Scan & Share concept              |

### What We Need to Build

| Feature                                        | Priority | Effort                                          |
| ---------------------------------------------- | -------- | ----------------------------------------------- |
| **ABHA Number field** in patients table        | HIGH     | Low — add column + UI field                     |
| **ABHA verification API** at registration      | HIGH     | Medium — ABDM sandbox integration               |
| **FHIR Bundle generator** for prescriptions    | HIGH     | Medium — map JSON to FHIR Composition           |
| **FHIR Bundle generator** for lab reports      | MEDIUM   | Medium — map lab_results to DiagnosticReport    |
| **FHIR Bundle generator** for vaccinations     | MEDIUM   | Medium — map vaccinations to ImmunizationRecord |
| **HIP callback APIs** (consent + data share)   | HIGH     | High — new backend endpoints                    |
| **SNOMED-CT coding** for clinical findings     | MEDIUM   | Medium — add SNOMED codes to relevant fields    |
| **LOINC coding** for lab tests                 | MEDIUM   | Low — add LOINC codes to COMMON_LABS            |
| **HIU integration** (receive external records) | LOW      | High — new backend + consent UI                 |
| **WASA security audit**                        | REQUIRED | External — CERT-IN empanelled agency            |

### Recommended Integration Roadmap

**Phase 1 (2-4 weeks): ABHA Identity**

- Add `abha_number` column to patients table
- Add ABHA field to registration form
- Integrate ABHA creation/verification API (Sandbox M1)

**Phase 2 (4-8 weeks): Share Records (HIP)**

- Build FHIR Bundle generators for OPConsultation + Prescription
- Register as HIP in ABDM Health Facility Registry
- Implement consent callback APIs (Sandbox M2)
- Add LOINC codes to lab tests, SNOMED codes to findings

**Phase 3 (4-6 weeks): Receive Records (HIU)**

- Implement HIU APIs to fetch patient records from other facilities
- Build consent request UI for the doctor
- Display received FHIR records in Patient Lookup (Sandbox M3)

**Phase 4 (2-4 weeks): Certification**

- Sandbox exit functional testing
- WASA security audit by CERT-IN empanelled agency
- Production credentials

Sources: [ABDM Sandbox](https://sandbox.abdm.gov.in/), [NRCeS FHIR Profiles](https://nrces.in/ndhm/fhir/r4/index.html), [NABH DHS](https://portal.nabh.co/Announcement/Draft%20NABH%20DHS%202nd%20Edition.pdf)

---

## 8. Key References

- [ABDM Official Portal](https://abdm.gov.in/)
- [ABDM Sandbox Documentation](https://sandbox.abdm.gov.in/)
- [NRCeS FHIR Implementation Guide v6.5.0](https://nrces.in/ndhm/fhir/r4/index.html)
- [ABDM Integration Milestones M1-M3](https://nirmitee.io/blog/abdm-integration-milestones-m1-m2-m3-m4-multi-software-guide/)
- [ABDM Compliance for AB-PMJAY 2026](https://ehr.network/abdm-compliance-ab-pmjay-hospitals-2026/)
- [NABH Digital Health Standards 2nd Edition](https://portal.nabh.co/Announcement/Draft%20NABH%20DHS%202nd%20Edition.pdf)
- [HL7 India ABDM Implementation Track](https://confluence.hl7.org/display/HIN/ABDM+Implementation+Track)
- [ABDM FHIR Toolkit](https://ndhmexchange.uat.dcservices.in/FHIRConnector/)
- [PMC: ABDM Assessment](https://www.tandfonline.com/doi/full/10.1080/23288604.2024.2392290)
- [PMC: Digital Foundations for Health Equity](https://pmc.ncbi.nlm.nih.gov/articles/PMC12349786/)

---

**Bottom line for Radhakishan Hospital:** Our system is well-positioned for ABDM integration. We already use ICD-10, have structured data (prescriptions, labs, vaccinations, documents), and follow NABH standards. The main gaps are ABHA identity integration, FHIR Bundle generation, and HIP/HIU consent APIs. The system architecture (Supabase + Edge Functions) can accommodate these additions — FHIR generators can be Edge Functions, ABHA verification can happen at registration, and consent callbacks can be new API endpoints.
