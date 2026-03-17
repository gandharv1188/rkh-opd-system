// Supabase Edge Function: generate-fhir-bundle
// Generates ABDM-compliant FHIR R4 Document Bundles from existing prescription,
// lab, vaccination, and visit data stored in Supabase.
//
// Supports 5 record types mandated by ABDM Milestone 2:
//   1. OPConsultation  — OPD visit consultation note
//   2. Prescription    — Medication orders
//   3. DiagnosticReport — Lab results
//   4. ImmunizationRecord — Vaccination records
//   5. HealthDocumentRecord — Uploaded documents
//
// FHIR profiles: NRCeS FHIR Implementation Guide for ABDM v6.5.0
// Reference: https://nrces.in/ndhm/fhir/r4/index.html
//
// Deploy: supabase functions deploy generate-fhir-bundle --project-ref ecywxuqhnlkjtdshpcbc

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// ===== CONSTANTS =====

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ABDM identifier systems
const ABHA_SYSTEM = "https://healthid.ndhm.gov.in";
const HPR_SYSTEM = "https://doctor.ndhm.gov.in";
const HFR_SYSTEM = "https://facility.ndhm.gov.in";
const MRN_SYSTEM = "https://rx.radhakishanhospital.com/patients";
const SNOMED_SYSTEM = "http://snomed.info/sct";
const ICD10_SYSTEM = "http://hl7.org/fhir/sid/icd-10";
const LOINC_SYSTEM = "http://loinc.org";

// Hospital details (to be moved to env vars in production)
const HOSPITAL = {
  name: "Radhakishan Hospital",
  hfr_id: "", // To be filled after HFR registration
  phone: "+91-1744-123456",
  address: {
    line: ["Kurukshetra"],
    city: "Kurukshetra",
    state: "Haryana",
    postalCode: "136118",
    country: "IN",
  },
};

// SNOMED codes for composition types
const COMPOSITION_TYPES: Record<string, { code: string; display: string }> = {
  OPConsultation: {
    code: "371530004",
    display: "Clinical consultation report",
  },
  Prescription: { code: "440545006", display: "Prescription record" },
  DiagnosticReport: { code: "721981007", display: "Diagnostic studies report" },
  ImmunizationRecord: {
    code: "41000179103",
    display: "Immunization record",
  },
  HealthDocumentRecord: { code: "419891008", display: "Record artifact" },
};

// SNOMED codes for OPConsultation sections
const SECTION_CODES: Record<string, { code: string; display: string }> = {
  ChiefComplaints: { code: "422843007", display: "Chief complaint section" },
  PhysicalExamination: {
    code: "425044008",
    display: "Physical examination section",
  },
  Allergies: { code: "722446000", display: "Allergy record" },
  MedicalHistory: {
    code: "371529009",
    display: "History and physical report",
  },
  InvestigationAdvice: { code: "721963009", display: "Order document" },
  Medications: { code: "721912009", display: "Medication summary document" },
  FollowUp: { code: "390906007", display: "Follow-up encounter" },
};

// LOINC codes for vitals
const VITAL_LOINC: Record<
  string,
  { code: string; display: string; unit: string }
> = {
  weight_kg: { code: "29463-7", display: "Body weight", unit: "kg" },
  height_cm: { code: "8302-2", display: "Body height", unit: "cm" },
  hc_cm: {
    code: "9843-4",
    display: "Head Occipital-frontal circumference",
    unit: "cm",
  },
  muac_cm: {
    code: "56072-2",
    display: "Mid upper arm circumference",
    unit: "cm",
  },
  temp_f: { code: "8310-5", display: "Body temperature", unit: "[degF]" },
  hr_per_min: { code: "8867-4", display: "Heart rate", unit: "/min" },
  rr_per_min: { code: "9279-1", display: "Respiratory rate", unit: "/min" },
  spo2_pct: {
    code: "2708-6",
    display: "Oxygen saturation in Arterial blood",
    unit: "%",
  },
};

// SNOMED route codes
const ROUTE_CODES: Record<string, { code: string; display: string }> = {
  oral: { code: "26643006", display: "Oral route" },
  iv: { code: "47625008", display: "Intravenous route" },
  im: { code: "78421000", display: "Intramuscular route" },
  sc: { code: "34206005", display: "Subcutaneous route" },
  inhaled: { code: "18679011000001101", display: "Inhalation" },
  topical: { code: "6064005", display: "Topical route" },
  rectal: { code: "37161004", display: "Rectal route" },
  nasal: { code: "46713006", display: "Nasal route" },
  ophthalmic: { code: "54485002", display: "Ophthalmic route" },
  nebulisation: { code: "45890007", display: "Transdermal route" },
};

// ===== SUPABASE HELPERS =====

const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

async function fetchOne(table: string, filter: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { ...headers, Accept: "application/vnd.pgrst.object+json" },
  });
  if (!res.ok) return null;
  return await res.json();
}

async function fetchMany(table: string, filter: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers,
  });
  if (!res.ok) return [];
  return await res.json();
}

// ===== UUID GENERATOR =====

function uuid(): string {
  return crypto.randomUUID();
}

// ===== FHIR RESOURCE BUILDERS =====

function buildPatientResource(
  patient: any,
  resourceId: string,
): Record<string, any> {
  const identifiers: any[] = [];

  // ABHA number (primary for ABDM)
  if (patient.abha_number) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "MR",
            display: "Medical record number",
          },
        ],
      },
      system: ABHA_SYSTEM,
      value: patient.abha_number,
    });
  }

  // Hospital UHID (secondary)
  identifiers.push({
    type: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v2-0203",
          code: "MR",
          display: "Medical record number",
        },
      ],
    },
    system: MRN_SYSTEM,
    value: patient.id,
  });

  const resource: any = {
    resourceType: "Patient",
    id: resourceId,
    meta: {
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"],
    },
    identifier: identifiers,
    name: [{ text: patient.name }],
    gender:
      patient.sex === "Male"
        ? "male"
        : patient.sex === "Female"
          ? "female"
          : "other",
  };

  if (patient.dob) {
    resource.birthDate = patient.dob;
  }
  if (patient.contact_phone) {
    resource.telecom = [
      { system: "phone", value: patient.contact_phone, use: "home" },
    ];
  }

  return resource;
}

function buildPractitionerResource(
  doctor: any,
  resourceId: string,
): Record<string, any> {
  const identifiers: any[] = [];

  if (doctor.hpr_id) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "MD",
            display: "Medical License number",
          },
        ],
      },
      system: HPR_SYSTEM,
      value: doctor.hpr_id,
    });
  }

  if (doctor.registration_no) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "MD",
            display: "Medical License number",
          },
        ],
      },
      system: "https://mciindia.org/registration",
      value: doctor.registration_no,
    });
  }

  return {
    resourceType: "Practitioner",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner",
      ],
    },
    identifier: identifiers.length > 0 ? identifiers : undefined,
    name: [{ text: doctor.full_name }],
    qualification: doctor.degree
      ? [{ code: { text: doctor.degree } }]
      : undefined,
  };
}

function buildOrganizationResource(resourceId: string): Record<string, any> {
  const resource: any = {
    resourceType: "Organization",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization",
      ],
    },
    name: HOSPITAL.name,
    telecom: [{ system: "phone", value: HOSPITAL.phone }],
    address: [HOSPITAL.address],
  };

  if (HOSPITAL.hfr_id) {
    resource.identifier = [
      {
        system: HFR_SYSTEM,
        value: HOSPITAL.hfr_id,
      },
    ];
  }

  return resource;
}

function buildEncounterResource(
  visit: any,
  patientRef: string,
  resourceId: string,
): Record<string, any> {
  return {
    resourceType: "Encounter",
    id: resourceId,
    meta: {
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Encounter"],
    },
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    subject: { reference: patientRef },
    period: {
      start: visit.visit_date
        ? `${visit.visit_date}T00:00:00+05:30`
        : new Date().toISOString(),
    },
  };
}

function buildConditionResource(
  dx: any,
  patientRef: string,
  resourceId: string,
): Record<string, any> {
  const codings: any[] = [];

  if (dx.icd10) {
    codings.push({
      system: ICD10_SYSTEM,
      code: dx.icd10,
      display: dx.name || dx.icd10,
    });
  }

  if (dx.snomed_code) {
    codings.push({
      system: SNOMED_SYSTEM,
      code: dx.snomed_code,
      display: dx.name,
    });
  }

  return {
    resourceType: "Condition",
    id: resourceId,
    meta: {
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition"],
    },
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
          display: "Active",
        },
      ],
    },
    code: {
      coding: codings.length > 0 ? codings : undefined,
      text: dx.name || dx.icd10 || "Unknown",
    },
    subject: { reference: patientRef },
  };
}

function buildAllergyIntoleranceResource(
  allergy: string,
  patientRef: string,
  resourceId: string,
): Record<string, any> {
  return {
    resourceType: "AllergyIntolerance",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/AllergyIntolerance",
      ],
    },
    clinicalStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
          display: "Active",
        },
      ],
    },
    code: { text: allergy },
    patient: { reference: patientRef },
  };
}

function buildVitalObservation(
  vitalKey: string,
  value: number,
  patientRef: string,
  encounterRef: string,
  effectiveDate: string,
  resourceId: string,
): Record<string, any> {
  const loinc = VITAL_LOINC[vitalKey];
  if (!loinc) return {};

  return {
    resourceType: "Observation",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation",
      ],
    },
    status: "final",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "vital-signs",
            display: "Vital Signs",
          },
        ],
      },
    ],
    code: {
      coding: [
        { system: LOINC_SYSTEM, code: loinc.code, display: loinc.display },
      ],
      text: loinc.display,
    },
    subject: { reference: patientRef },
    encounter: { reference: encounterRef },
    effectiveDateTime: effectiveDate,
    valueQuantity: {
      value: value,
      unit: loinc.unit,
      system: "http://unitsofmeasure.org",
      code: loinc.unit,
    },
  };
}

function buildMedicationRequestResource(
  med: any,
  patientRef: string,
  practitionerRef: string,
  encounterRef: string,
  conditionRefs: string[],
  effectiveDate: string,
  resourceId: string,
): Record<string, any> {
  // Parse drug name from row1_en (e.g., "AMOXICILLIN (125mg/5ml syrup)")
  const drugName = (med.row1_en || "").split("(")[0].trim().toUpperCase();

  const medicationCoding: any[] = [];
  if (med.snomed_code) {
    medicationCoding.push({
      system: SNOMED_SYSTEM,
      code: med.snomed_code,
      display: med.snomed_display || drugName,
    });
  }

  // Build dosage
  const dosage: any = {
    text: med.row2_en || "",
  };

  // Route
  if (med.formulation) {
    const form = (med.formulation || "").toLowerCase();
    let routeKey = "oral";
    if (
      form.includes("injection") ||
      form.includes("iv") ||
      form.includes("infusion")
    )
      routeKey = "iv";
    else if (form.includes("im")) routeKey = "im";
    else if (form.includes("cream") || form.includes("ointment"))
      routeKey = "topical";
    else if (form.includes("inhaler")) routeKey = "inhaled";
    else if (form.includes("nebul")) routeKey = "nebulisation";
    else if (form.includes("suppository") || form.includes("rectal"))
      routeKey = "rectal";
    else if (form.includes("nasal")) routeKey = "nasal";
    else if (form.includes("eye") || form.includes("ophthalmic"))
      routeKey = "ophthalmic";

    const route = ROUTE_CODES[routeKey];
    if (route) {
      dosage.route = {
        coding: [
          { system: SNOMED_SYSTEM, code: route.code, display: route.display },
        ],
      };
    }
  }

  const resource: any = {
    resourceType: "MedicationRequest",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest",
      ],
    },
    status: "active",
    intent: "order",
    medicationCodeableConcept: {
      coding: medicationCoding.length > 0 ? medicationCoding : undefined,
      text: med.row1_en || drugName,
    },
    subject: { reference: patientRef },
    encounter: { reference: encounterRef },
    authoredOn: effectiveDate,
    requester: { reference: practitionerRef },
    dosageInstruction: [dosage],
  };

  if (conditionRefs.length > 0) {
    resource.reasonReference = conditionRefs.map((ref) => ({
      reference: ref,
    }));
  }

  return resource;
}

function buildServiceRequestResource(
  investigation: any,
  patientRef: string,
  practitionerRef: string,
  encounterRef: string,
  effectiveDate: string,
  resourceId: string,
): Record<string, any> {
  return {
    resourceType: "ServiceRequest",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ServiceRequest",
      ],
    },
    status: "active",
    intent: "order",
    code: {
      text:
        typeof investigation === "string"
          ? investigation
          : investigation.name || investigation.test || "Investigation",
    },
    subject: { reference: patientRef },
    encounter: { reference: encounterRef },
    authoredOn: effectiveDate,
    requester: { reference: practitionerRef },
  };
}

function buildLabObservation(
  lab: any,
  patientRef: string,
  encounterRef: string | null,
  resourceId: string,
): Record<string, any> {
  const codings: any[] = [];

  if (lab.loinc_code) {
    codings.push({
      system: LOINC_SYSTEM,
      code: lab.loinc_code,
      display: lab.test_name,
    });
  }

  if (lab.snomed_code) {
    codings.push({
      system: SNOMED_SYSTEM,
      code: lab.snomed_code,
      display: lab.test_name,
    });
  }

  const resource: any = {
    resourceType: "Observation",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation",
      ],
    },
    status: "final",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
            display: "Laboratory",
          },
        ],
      },
    ],
    code: {
      coding: codings.length > 0 ? codings : undefined,
      text: lab.test_name,
    },
    subject: { reference: patientRef },
    effectiveDateTime: lab.test_date
      ? `${lab.test_date}T00:00:00+05:30`
      : undefined,
  };

  if (encounterRef) {
    resource.encounter = { reference: encounterRef };
  }

  // Value: use valueQuantity if numeric, valueString otherwise
  if (lab.value_numeric != null && lab.unit) {
    resource.valueQuantity = {
      value: lab.value_numeric,
      unit: lab.unit,
      system: "http://unitsofmeasure.org",
    };
  } else {
    resource.valueString = lab.value;
  }

  // Reference range
  if (lab.reference_range) {
    resource.referenceRange = [{ text: lab.reference_range }];
  }

  // Interpretation (flag)
  if (lab.flag && lab.flag !== "normal") {
    const flagMap: Record<string, { code: string; display: string }> = {
      low: { code: "L", display: "Low" },
      high: { code: "H", display: "High" },
      critical: { code: "AA", display: "Critical abnormal" },
      abnormal: { code: "A", display: "Abnormal" },
    };
    const flag = flagMap[lab.flag];
    if (flag) {
      resource.interpretation = [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
              code: flag.code,
              display: flag.display,
            },
          ],
        },
      ];
    }
  }

  return resource;
}

function buildImmunizationResource(
  vax: any,
  patientRef: string,
  resourceId: string,
): Record<string, any> {
  const resource: any = {
    resourceType: "Immunization",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Immunization",
      ],
    },
    status: "completed",
    vaccineCode: {
      text: vax.vaccine_name,
    },
    patient: { reference: patientRef },
    occurrenceDateTime: vax.date_given
      ? `${vax.date_given}T00:00:00+05:30`
      : undefined,
  };

  if (vax.dose_number) {
    resource.protocolApplied = [{ doseNumberPositiveInt: vax.dose_number }];
  }

  if (vax.batch_number) {
    resource.lotNumber = vax.batch_number;
  }

  if (vax.route) {
    const routeCode = ROUTE_CODES[vax.route.toLowerCase()];
    if (routeCode) {
      resource.route = {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: routeCode.code,
            display: routeCode.display,
          },
        ],
      };
    }
  }

  if (vax.site) {
    resource.site = { text: vax.site };
  }

  return resource;
}

function buildDiagnosticReportResource(
  observationRefs: string[],
  patientRef: string,
  encounterRef: string | null,
  effectiveDate: string,
  resourceId: string,
): Record<string, any> {
  const resource: any = {
    resourceType: "DiagnosticReport",
    id: resourceId,
    meta: {
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab",
      ],
    },
    status: "final",
    code: {
      text: "Laboratory Results",
    },
    subject: { reference: patientRef },
    effectiveDateTime: effectiveDate,
    result: observationRefs.map((ref) => ({ reference: ref })),
  };

  if (encounterRef) {
    resource.encounter = { reference: encounterRef };
  }

  return resource;
}

// ===== BUNDLE BUILDERS =====

function wrapInBundle(
  compositionType: string,
  title: string,
  entries: { resource: any }[],
  timestamp: string,
): Record<string, any> {
  const bundleId = uuid();

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      lastUpdated: timestamp,
      profile: [
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle",
      ],
    },
    identifier: {
      system: "https://rx.radhakishanhospital.com/bundles",
      value: bundleId,
    },
    type: "document",
    timestamp: timestamp,
    entry: entries.map((e) => ({
      fullUrl: `urn:uuid:${e.resource.id}`,
      resource: e.resource,
    })),
  };
}

function buildComposition(
  type: string,
  title: string,
  patientRef: string,
  practitionerRef: string,
  encounterRef: string | null,
  date: string,
  sections: any[],
  resourceId: string,
): Record<string, any> {
  const compType = COMPOSITION_TYPES[type];
  if (!compType) {
    throw new Error(`Unknown composition type: ${type}`);
  }

  const resource: any = {
    resourceType: "Composition",
    id: resourceId,
    meta: {
      profile: [
        `https://nrces.in/ndhm/fhir/r4/StructureDefinition/${type === "OPConsultation" ? "OPConsultRecord" : type === "Prescription" ? "PrescriptionRecord" : type === "DiagnosticReport" ? "DiagnosticReportRecord" : type === "ImmunizationRecord" ? "ImmunizationRecord" : "HealthDocumentRecord"}`,
      ],
    },
    language: "en-IN",
    identifier: {
      system: "https://rx.radhakishanhospital.com/compositions",
      value: uuid(),
    },
    status: "final",
    type: {
      coding: [
        {
          system: SNOMED_SYSTEM,
          code: compType.code,
          display: compType.display,
        },
      ],
    },
    subject: { reference: patientRef },
    date: date,
    author: [{ reference: practitionerRef }],
    title: title,
    confidentiality: "V",
    section: sections,
  };

  if (encounterRef) {
    resource.encounter = { reference: encounterRef };
  }

  return resource;
}

// ===== BUNDLE TYPE GENERATORS =====

async function generateOPConsultationBundle(
  patient: any,
  visit: any,
  prescription: any,
  doctor: any,
): Promise<Record<string, any>> {
  const timestamp = new Date().toISOString();
  const effectiveDate = visit.visit_date
    ? `${visit.visit_date}T00:00:00+05:30`
    : timestamp;
  const entries: { resource: any }[] = [];
  const sections: any[] = [];

  // Resource IDs
  const patientId = uuid();
  const practitionerId = uuid();
  const orgId = uuid();
  const encounterId = uuid();
  const compositionId = uuid();

  const patientRef = `Patient/${patientId}`;
  const practitionerRef = `Practitioner/${practitionerId}`;
  const encounterRef = `Encounter/${encounterId}`;

  // Build core resources
  const patientResource = buildPatientResource(patient, patientId);
  const practitionerResource = buildPractitionerResource(
    doctor,
    practitionerId,
  );
  const orgResource = buildOrganizationResource(orgId);
  const encounterResource = buildEncounterResource(
    visit,
    patientRef,
    encounterId,
  );

  const rxData = prescription?.generated_json || {};

  // === Enrich medicines with SNOMED codes from formulary (fallback for older prescriptions) ===
  const medicines = prescription?.medicines || rxData.medicines || [];
  for (const med of medicines) {
    if (!med.snomed_code) {
      const drugName = (med.row1_en || "").split("(")[0].trim();
      if (drugName) {
        const fRes = await fetch(
          `${SUPABASE_URL}/rest/v1/formulary?generic_name=ilike.${encodeURIComponent(drugName)}&select=snomed_code,snomed_display&limit=1`,
          { headers },
        );
        if (fRes.ok) {
          const fData = await fRes.json();
          if (fData.length > 0 && fData[0].snomed_code) {
            med.snomed_code = fData[0].snomed_code;
            med.snomed_display = fData[0].snomed_display;
          }
        }
      }
    }
  }

  // === Enrich diagnoses with SNOMED codes from standard_prescriptions (fallback) ===
  const diagnosisCodes = visit.diagnosis_codes || rxData.diagnosis || [];
  for (const dx of diagnosisCodes) {
    const dxObj = typeof dx === "string" ? { name: dx } : dx;
    if (!dxObj.snomed_code && dxObj.icd10) {
      const spRes = await fetch(
        `${SUPABASE_URL}/rest/v1/standard_prescriptions?icd10=eq.${encodeURIComponent(dxObj.icd10)}&select=snomed_code&limit=1`,
        { headers },
      );
      if (spRes.ok) {
        const spData = await spRes.json();
        if (spData.length > 0 && spData[0].snomed_code) {
          dxObj.snomed_code = spData[0].snomed_code;
        }
      }
    }
  }

  // === Section: Chief Complaints ===
  if (visit.chief_complaints || rxData.chief_complaints) {
    const text = visit.chief_complaints || rxData.chief_complaints;
    sections.push({
      title: "Chief Complaints",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.ChiefComplaints.code,
            display: SECTION_CODES.ChiefComplaints.display,
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${text}</div>`,
      },
    });
  }

  // === Section: Physical Examination (Vitals) ===
  const vitalEntryRefs: string[] = [];
  const vitalKeys = [
    "weight_kg",
    "height_cm",
    "hc_cm",
    "muac_cm",
    "temp_f",
    "hr_per_min",
    "rr_per_min",
    "spo2_pct",
  ];
  for (const key of vitalKeys) {
    const val = visit[key];
    if (val != null) {
      const vitalId = uuid();
      const obs = buildVitalObservation(
        key,
        val,
        patientRef,
        encounterRef,
        effectiveDate,
        vitalId,
      );
      if (obs.resourceType) {
        entries.push({ resource: obs });
        vitalEntryRefs.push(`Observation/${vitalId}`);
      }
    }
  }
  if (vitalEntryRefs.length > 0) {
    sections.push({
      title: "Physical Examination",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.PhysicalExamination.code,
            display: SECTION_CODES.PhysicalExamination.display,
          },
        ],
      },
      entry: vitalEntryRefs.map((ref) => ({ reference: ref })),
    });
  }

  // === Section: Allergies ===
  const allergyRefs: string[] = [];
  if (patient.known_allergies && patient.known_allergies.length > 0) {
    for (const allergy of patient.known_allergies) {
      const allergyId = uuid();
      entries.push({
        resource: buildAllergyIntoleranceResource(
          allergy,
          patientRef,
          allergyId,
        ),
      });
      allergyRefs.push(`AllergyIntolerance/${allergyId}`);
    }
    sections.push({
      title: "Allergies",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.Allergies.code,
            display: SECTION_CODES.Allergies.display,
          },
        ],
      },
      entry: allergyRefs.map((ref) => ({ reference: ref })),
    });
  }

  // === Diagnoses as Condition resources ===
  const conditionRefs: string[] = [];
  for (const dx of diagnosisCodes) {
    const dxObj = typeof dx === "string" ? { name: dx } : dx;
    const conditionId = uuid();
    entries.push({
      resource: buildConditionResource(dxObj, patientRef, conditionId),
    });
    conditionRefs.push(`Condition/${conditionId}`);
  }

  // === Section: Medications ===
  const medRefs: string[] = [];
  for (const med of medicines) {
    const medId = uuid();
    entries.push({
      resource: buildMedicationRequestResource(
        med,
        patientRef,
        practitionerRef,
        encounterRef,
        conditionRefs,
        effectiveDate,
        medId,
      ),
    });
    medRefs.push(`MedicationRequest/${medId}`);
  }
  if (medRefs.length > 0) {
    sections.push({
      title: "Medications",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.Medications.code,
            display: SECTION_CODES.Medications.display,
          },
        ],
      },
      entry: medRefs.map((ref) => ({ reference: ref })),
    });
  }

  // === Section: Investigation Advice ===
  const invRefs: string[] = [];
  const investigations =
    prescription?.investigations || rxData.investigations || [];
  for (const inv of investigations) {
    const invId = uuid();
    entries.push({
      resource: buildServiceRequestResource(
        inv,
        patientRef,
        practitionerRef,
        encounterRef,
        effectiveDate,
        invId,
      ),
    });
    invRefs.push(`ServiceRequest/${invId}`);
  }
  if (invRefs.length > 0) {
    sections.push({
      title: "Investigation Advice",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.InvestigationAdvice.code,
            display: SECTION_CODES.InvestigationAdvice.display,
          },
        ],
      },
      entry: invRefs.map((ref) => ({ reference: ref })),
    });
  }

  // === Section: Follow Up ===
  if (rxData.followup_days) {
    sections.push({
      title: "Follow Up",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.FollowUp.code,
            display: SECTION_CODES.FollowUp.display,
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">Follow up in ${rxData.followup_days} days. ${rxData.doctor_notes || ""}</div>`,
      },
    });
  }

  // Build Composition
  const composition = buildComposition(
    "OPConsultation",
    "OP Consultation Record",
    patientRef,
    practitionerRef,
    encounterRef,
    effectiveDate,
    sections,
    compositionId,
  );

  // Assemble bundle: Composition first, then Patient, Practitioner, Organization, Encounter, then all others
  const allEntries = [
    { resource: composition },
    { resource: patientResource },
    { resource: practitionerResource },
    { resource: orgResource },
    { resource: encounterResource },
    ...entries,
  ];

  return wrapInBundle(
    "OPConsultation",
    "OP Consultation Record",
    allEntries,
    timestamp,
  );
}

async function generatePrescriptionBundle(
  patient: any,
  visit: any,
  prescription: any,
  doctor: any,
): Promise<Record<string, any>> {
  const timestamp = new Date().toISOString();
  const effectiveDate = visit.visit_date
    ? `${visit.visit_date}T00:00:00+05:30`
    : timestamp;
  const entries: { resource: any }[] = [];

  const patientId = uuid();
  const practitionerId = uuid();
  const encounterId = uuid();
  const compositionId = uuid();

  const patientRef = `Patient/${patientId}`;
  const practitionerRef = `Practitioner/${practitionerId}`;
  const encounterRef = `Encounter/${encounterId}`;

  const patientResource = buildPatientResource(patient, patientId);
  const practitionerResource = buildPractitionerResource(
    doctor,
    practitionerId,
  );
  const encounterResource = buildEncounterResource(
    visit,
    patientRef,
    encounterId,
  );

  const rxData = prescription?.generated_json || {};

  // === Enrich with SNOMED codes from database (fallback for older prescriptions) ===
  const medicines = prescription?.medicines || rxData.medicines || [];
  for (const med of medicines) {
    if (!med.snomed_code) {
      const drugName = (med.row1_en || "").split("(")[0].trim();
      if (drugName) {
        const fRes = await fetch(
          `${SUPABASE_URL}/rest/v1/formulary?generic_name=ilike.${encodeURIComponent(drugName)}&select=snomed_code,snomed_display&limit=1`,
          { headers },
        );
        if (fRes.ok) {
          const fData = await fRes.json();
          if (fData.length > 0 && fData[0].snomed_code) {
            med.snomed_code = fData[0].snomed_code;
            med.snomed_display = fData[0].snomed_display;
          }
        }
      }
    }
  }

  const diagnosisCodes = visit.diagnosis_codes || rxData.diagnosis || [];
  for (const dx of diagnosisCodes) {
    const dxObj = typeof dx === "string" ? { name: dx } : dx;
    if (!dxObj.snomed_code && dxObj.icd10) {
      const spRes = await fetch(
        `${SUPABASE_URL}/rest/v1/standard_prescriptions?icd10=eq.${encodeURIComponent(dxObj.icd10)}&select=snomed_code&limit=1`,
        { headers },
      );
      if (spRes.ok) {
        const spData = await spRes.json();
        if (spData.length > 0 && spData[0].snomed_code) {
          dxObj.snomed_code = spData[0].snomed_code;
        }
      }
    }
  }

  // Build Condition resources for diagnoses (as reason references)
  const conditionRefs: string[] = [];
  for (const dx of diagnosisCodes) {
    const dxObj = typeof dx === "string" ? { name: dx } : dx;
    const conditionId = uuid();
    entries.push({
      resource: buildConditionResource(dxObj, patientRef, conditionId),
    });
    conditionRefs.push(`Condition/${conditionId}`);
  }

  // Build MedicationRequest resources
  const medRefs: string[] = [];
  for (const med of medicines) {
    const medId = uuid();
    entries.push({
      resource: buildMedicationRequestResource(
        med,
        patientRef,
        practitionerRef,
        encounterRef,
        conditionRefs,
        effectiveDate,
        medId,
      ),
    });
    medRefs.push(`MedicationRequest/${medId}`);
  }

  // Sections
  const sections: any[] = [];
  if (medRefs.length > 0) {
    sections.push({
      title: "Medications",
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: SECTION_CODES.Medications.code,
            display: SECTION_CODES.Medications.display,
          },
        ],
      },
      entry: medRefs.map((ref) => ({ reference: ref })),
    });
  }

  const composition = buildComposition(
    "Prescription",
    "Prescription Record",
    patientRef,
    practitionerRef,
    encounterRef,
    effectiveDate,
    sections,
    compositionId,
  );

  const allEntries = [
    { resource: composition },
    { resource: patientResource },
    { resource: practitionerResource },
    { resource: encounterResource },
    ...entries,
  ];

  return wrapInBundle(
    "Prescription",
    "Prescription Record",
    allEntries,
    timestamp,
  );
}

async function generateDiagnosticReportBundle(
  patient: any,
  visit: any | null,
  labResults: any[],
  doctor: any,
): Promise<Record<string, any>> {
  const timestamp = new Date().toISOString();
  const effectiveDate = labResults[0]?.test_date
    ? `${labResults[0].test_date}T00:00:00+05:30`
    : timestamp;
  const entries: { resource: any }[] = [];

  const patientId = uuid();
  const practitionerId = uuid();
  const compositionId = uuid();
  const diagnosticReportId = uuid();

  const patientRef = `Patient/${patientId}`;
  const practitionerRef = `Practitioner/${practitionerId}`;

  let encounterRef: string | null = null;
  let encounterId: string | undefined;

  if (visit) {
    encounterId = uuid();
    encounterRef = `Encounter/${encounterId}`;
    entries.push({
      resource: buildEncounterResource(visit, patientRef, encounterId),
    });
  }

  const patientResource = buildPatientResource(patient, patientId);
  const practitionerResource = buildPractitionerResource(
    doctor,
    practitionerId,
  );

  // Build Observation resources for each lab result
  const observationRefs: string[] = [];
  for (const lab of labResults) {
    const obsId = uuid();
    entries.push({
      resource: buildLabObservation(lab, patientRef, encounterRef, obsId),
    });
    observationRefs.push(`Observation/${obsId}`);
  }

  // Build DiagnosticReport resource
  const drResource = buildDiagnosticReportResource(
    observationRefs,
    patientRef,
    encounterRef,
    effectiveDate,
    diagnosticReportId,
  );
  entries.push({ resource: drResource });

  // Sections
  const sections: any[] = [
    {
      title: "Diagnostic Reports",
      entry: [
        { reference: `DiagnosticReport/${diagnosticReportId}` },
        ...observationRefs.map((ref) => ({ reference: ref })),
      ],
    },
  ];

  const composition = buildComposition(
    "DiagnosticReport",
    "Diagnostic Report",
    patientRef,
    practitionerRef,
    encounterRef,
    effectiveDate,
    sections,
    compositionId,
  );

  const allEntries = [
    { resource: composition },
    { resource: patientResource },
    { resource: practitionerResource },
    ...entries,
  ];

  return wrapInBundle(
    "DiagnosticReport",
    "Diagnostic Report",
    allEntries,
    timestamp,
  );
}

async function generateImmunizationBundle(
  patient: any,
  vaccinations: any[],
  doctor: any,
): Promise<Record<string, any>> {
  const timestamp = new Date().toISOString();
  const entries: { resource: any }[] = [];

  const patientId = uuid();
  const practitionerId = uuid();
  const compositionId = uuid();

  const patientRef = `Patient/${patientId}`;
  const practitionerRef = `Practitioner/${practitionerId}`;

  const patientResource = buildPatientResource(patient, patientId);
  const practitionerResource = buildPractitionerResource(
    doctor,
    practitionerId,
  );

  // Build Immunization resources
  const immRefs: string[] = [];
  for (const vax of vaccinations) {
    const immId = uuid();
    entries.push({
      resource: buildImmunizationResource(vax, patientRef, immId),
    });
    immRefs.push(`Immunization/${immId}`);
  }

  const sections: any[] = [
    {
      title: "Immunization Records",
      entry: immRefs.map((ref) => ({ reference: ref })),
    },
  ];

  const composition = buildComposition(
    "ImmunizationRecord",
    "Immunization Record",
    patientRef,
    practitionerRef,
    null,
    timestamp,
    sections,
    compositionId,
  );

  const allEntries = [
    { resource: composition },
    { resource: patientResource },
    { resource: practitionerResource },
    ...entries,
  ];

  return wrapInBundle(
    "ImmunizationRecord",
    "Immunization Record",
    allEntries,
    timestamp,
  );
}

// ===== MAIN HANDLER =====

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { type, patient_id, visit_id, prescription_id } = await req.json();

    if (!type || !patient_id) {
      return new Response(
        JSON.stringify({
          error: "type and patient_id are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch patient
    const patient = await fetchOne(
      "patients",
      `id=eq.${encodeURIComponent(patient_id)}&select=*`,
    );
    if (!patient) {
      return new Response(
        JSON.stringify({ error: `Patient ${patient_id} not found` }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Fetch doctor (default to DR-LOKENDER)
    const doctor = (await fetchOne(
      "doctors",
      "id=eq.DR-LOKENDER&select=*",
    )) || {
      id: "DR-LOKENDER",
      full_name: "Dr. Lokender Goyal",
      degree: "MD Pediatrics (PGI Chandigarh)",
      registration_no: "HMCI HN 21452 / PMC 23168",
    };

    let visit: any = null;
    let prescription: any = null;

    // Fetch visit if provided
    if (visit_id) {
      visit = await fetchOne(
        "visits",
        `id=eq.${encodeURIComponent(visit_id)}&select=*`,
      );
    }

    // Fetch prescription if provided
    if (prescription_id) {
      prescription = await fetchOne(
        "prescriptions",
        `id=eq.${encodeURIComponent(prescription_id)}&select=*`,
      );
    }

    let bundle: Record<string, any>;

    switch (type) {
      case "OPConsultation": {
        if (!visit) {
          return new Response(
            JSON.stringify({
              error: "visit_id is required for OPConsultation",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        // Fetch prescription for this visit if not provided
        if (!prescription) {
          prescription = await fetchOne(
            "prescriptions",
            `visit_id=eq.${encodeURIComponent(visit_id!)}&is_approved=eq.true&select=*&order=created_at.desc&limit=1`,
          );
        }
        bundle = await generateOPConsultationBundle(
          patient,
          visit,
          prescription,
          doctor,
        );
        break;
      }

      case "Prescription": {
        if (!visit) {
          return new Response(
            JSON.stringify({
              error: "visit_id is required for Prescription",
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        if (!prescription) {
          prescription = await fetchOne(
            "prescriptions",
            `visit_id=eq.${encodeURIComponent(visit_id!)}&is_approved=eq.true&select=*&order=created_at.desc&limit=1`,
          );
        }
        bundle = await generatePrescriptionBundle(
          patient,
          visit,
          prescription,
          doctor,
        );
        break;
      }

      case "DiagnosticReport": {
        const labResults = await fetchMany(
          "lab_results",
          `patient_id=eq.${encodeURIComponent(patient_id)}&order=test_date.desc&limit=50&select=*${visit_id ? `&visit_id=eq.${encodeURIComponent(visit_id)}` : ""}`,
        );
        if (labResults.length === 0) {
          return new Response(
            JSON.stringify({
              error: `No lab results found for patient ${patient_id}`,
            }),
            {
              status: 404,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        bundle = await generateDiagnosticReportBundle(
          patient,
          visit,
          labResults,
          doctor,
        );
        break;
      }

      case "ImmunizationRecord": {
        const vaccinations = await fetchMany(
          "vaccinations",
          `patient_id=eq.${encodeURIComponent(patient_id)}&order=date_given.desc&select=*`,
        );
        if (vaccinations.length === 0) {
          return new Response(
            JSON.stringify({
              error: `No vaccination records for patient ${patient_id}`,
            }),
            {
              status: 404,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        bundle = await generateImmunizationBundle(
          patient,
          vaccinations,
          doctor,
        );
        break;
      }

      default:
        return new Response(
          JSON.stringify({
            error: `Unsupported bundle type: ${type}. Supported: OPConsultation, Prescription, DiagnosticReport, ImmunizationRecord`,
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          },
        );
    }

    console.log(
      `FHIR Bundle generated: type=${type}, patient=${patient_id}, entries=${bundle.entry?.length || 0}`,
    );

    return new Response(JSON.stringify({ bundle }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("FHIR Bundle generation error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
