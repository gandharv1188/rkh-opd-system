#!/usr/bin/env node
const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  process.argv[2] ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzYzNDY1NywiZXhwIjoyMDg5MjEwNjU3fQ.n1UDULMkpnch3i09onX5uE5YucBGhHqREDpHhL2zWEA";

async function post(table, data) {
  const r = await fetch(`${SB}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`${table}: ${r.status} — ${await r.text()}`);
  const result = await r.json();
  return Array.isArray(result) ? result[0] : result;
}

async function run() {
  console.log("=== Creating sample patient: Arjun Kumar ===\n");

  // 1. Patient
  const patient = await post("patients", {
    id: "RKH-25260300001",
    name: "Arjun Kumar",
    dob: "2025-07-15",
    sex: "Male",
    guardian_name: "Raj Kumar",
    guardian_relation: "Father",
    contact_phone: "9876543210",
    blood_group: "B+",
    known_allergies: null,
    is_active: true,
  });
  console.log("Patient:", patient.id, patient.name);

  // 2. Visit
  const visit = await post("visits", {
    patient_id: "RKH-25260300001",
    visit_date: "2026-03-16",
    doctor_id: "DR-LOKENDER",
    weight_kg: 7.2,
    height_cm: 67,
    hc_cm: 43,
    muac_cm: 13.5,
    temp_f: 101.2,
    hr_per_min: 128,
    rr_per_min: 36,
    spo2_pct: 98,
    chief_complaints: "Fever 3 days, pulling left ear, irritable",
    diagnosis_codes: [
      { icd10: "H66.90", name: "Acute Otitis Media", type: "provisional" },
      { icd10: "R50.9", name: "Fever", type: "provisional" },
    ],
    clinical_notes:
      "Active child, febrile (101.2F). Left TM bulging, erythematous. Right TM normal. Throat: mild congestion. Chest: clear. No rash. Well hydrated.",
    raw_dictation:
      "Arjun 8 months 7.2 kg boy fever 3 days pulling left ear irritable left TM bulging red right normal throat mild congestion chest clear no rash well hydrated diagnosis AOM add paracetamol",
    triage_score: 1,
  });
  console.log("Visit:", visit.id);

  // 3. Prescription
  const rxData = {
    patient: {
      name: "Arjun Kumar",
      age: "8 months",
      sex: "Male",
      weight_kg: 7.2,
      height_cm: 67,
      hc_cm: 43,
      guardian: "Raj Kumar (Father)",
      uhid: "RKH-25260300001",
    },
    neonatal: null,
    diagnosis: [
      { name: "Acute Otitis Media", icd10: "H66.90", type: "provisional" },
    ],
    triage_score: 1,
    triage_action: "Routine OPD",
    medicines: [
      {
        number: 1,
        row1_en: "AMOXICILLIN SUSPENSION (250 mg / 5 ml)",
        row2_en:
          "4 ml orally three times a day for 7 days. Give with or after food.",
        row3_hi:
          "4 ml (\u0932\u0917\u092D\u0917 \u090F\u0915 \u091A\u092E\u094D\u092E\u091A \u0938\u0947 \u0915\u092E) \u0926\u093F\u0928 \u092E\u0947\u0902 3 \u092C\u093E\u0930 7 \u0926\u093F\u0928 \u0924\u0915 \u0916\u093E\u0928\u0947 \u0915\u0947 \u092C\u093E\u0926 \u0926\u0947\u0902\u0964",
        calc: "80 mg/kg/day \u00d7 7.2 kg = 576 mg/day \u00f7 3 = 192 mg/dose. 250 mg/5 ml \u2192 3.84 ml \u2192 rounded to 4 ml",
        flag: "",
        dose_mg_per_kg: 80,
        dose_per_day_divided: 3,
        concentration_mg: 250,
        concentration_per_ml: 5,
        max_dose_single_mg: 1000,
        formulation: "syrup",
        method: "weight",
      },
      {
        number: 2,
        row1_en: "PARACETAMOL SUSPENSION (120 mg / 5 ml)",
        row2_en:
          "4.5 ml orally every 6 hours as needed for fever. Do not give if temp < 38\u00b0C. Max 4 doses/day.",
        row3_hi:
          "4.5 ml (\u0932\u0917\u092D\u0917 \u090F\u0915 \u091A\u092E\u094D\u092E\u091A) \u092C\u0941\u0916\u093E\u0930 \u0939\u094B\u0928\u0947 \u092A\u0930 \u0939\u0930 6 \u0918\u0902\u091F\u0947 \u092E\u0947\u0902 \u092E\u0941\u0901\u0939 \u0938\u0947 \u0926\u0947\u0902\u0964 38\u00b0C \u0938\u0947 \u0915\u092E \u0924\u093E\u092A\u092E\u093E\u0928 \u092A\u0930 \u0928 \u0926\u0947\u0902\u0964 \u0926\u093F\u0928 \u092E\u0947\u0902 4 \u092C\u093E\u0930 \u0938\u0947 \u091C\u093C\u094D\u092F\u093E\u0926\u093E \u0928 \u0926\u0947\u0902\u0964",
        calc: "15 mg/kg \u00d7 7.2 kg = 108 mg/dose. 120 mg/5 ml \u2192 4.5 ml",
        flag: "",
        dose_mg_per_kg: 15,
        dose_per_day_divided: 4,
        concentration_mg: 120,
        concentration_per_ml: 5,
        max_dose_single_mg: 1000,
        formulation: "syrup",
        method: "weight",
      },
    ],
    investigations: [
      {
        name: "CBC with differential",
        indication: "Fever >3 days, rule out bacterial infection",
        urgency: "same-day",
      },
    ],
    iv_fluids: [],
    growth: {
      chart: "WHO2006",
      waz: "-0.8",
      haz: "-0.5",
      whz: "-0.6",
      hcaz: "0.2",
      muac: "13.5",
      classification: "Well nourished",
      comment: "Growth appropriate for age. All Z-scores within normal range.",
    },
    vaccinations: {
      schedule_used: "IAP2024",
      due: ["OPV 2 (due at 9 months)"],
      overdue: [],
      next_due: "MMR 1 + TCV 1 at 9 months",
      notes: "All vaccines up to date per IAP 2024.",
    },
    developmental: {
      tool_used: "Clinical assessment",
      findings:
        "Sits without support, transfers objects, babbles, stranger anxiety present. Age-appropriate.",
      red_flags: [],
    },
    diet: "Continue breastfeeding. Age-appropriate complementary feeds. Increase fluid intake during fever.",
    counselling: [
      "Complete the full 7-day antibiotic course",
      "Danger signs explained",
      "Fever management demonstrated",
    ],
    referral: "",
    safety: {
      allergy_note: "NKDA",
      interactions:
        "None found (Amoxicillin + Paracetamol \u2014 no interaction)",
      max_dose_check: [
        {
          drug: "AMOXICILLIN",
          calculated_dose_mg: 192,
          max_allowed_mg: 1000,
          status: "PASS",
        },
        {
          drug: "PARACETAMOL",
          calculated_dose_mg: 108,
          max_allowed_mg: 1000,
          status: "PASS",
        },
      ],
      flags: [],
      overall_status: "SAFE",
    },
    followup_days: 3,
    doctor_notes: "Review in 3 days. If no improvement, consider ENT referral.",
    nabh_compliant: true,
  };

  const rx = await post("prescriptions", {
    id: "RX-20260316",
    visit_id: visit.id,
    patient_id: "RKH-25260300001",
    generated_json: rxData,
    medicines: rxData.medicines,
    investigations: rxData.investigations,
    vaccinations: rxData.vaccinations,
    growth: rxData.growth,
    is_approved: true,
    approved_by: "DR-LOKENDER",
    approved_at: "2026-03-16T10:30:00+05:30",
    qr_data: {
      uhid: "RKH-25260300001",
      pt: "Arjun Kumar",
      dob: "2025-07-15",
      sex: "M",
    },
    version: 1,
  });
  console.log("Prescription:", rx.id);

  // 4. Vaccination history (IAP schedule for 8-month-old)
  const vaccines = [
    {
      vaccine_name: "BCG",
      dose_number: 1,
      date_given: "2025-07-15",
      route: "intradermal",
      site: "Left upper arm",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "OPV",
      dose_number: 0,
      date_given: "2025-07-15",
      route: "oral",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Hepatitis B",
      dose_number: 1,
      date_given: "2025-07-15",
      route: "im",
      site: "Right thigh",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Pentavalent (DPT+HepB+Hib)",
      dose_number: 1,
      date_given: "2025-08-26",
      route: "im",
      site: "Right thigh",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "IPV",
      dose_number: 1,
      date_given: "2025-08-26",
      route: "im",
      site: "Left thigh",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "PCV",
      dose_number: 1,
      date_given: "2025-08-26",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Rotavirus",
      dose_number: 1,
      date_given: "2025-08-26",
      route: "oral",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Pentavalent (DPT+HepB+Hib)",
      dose_number: 2,
      date_given: "2025-09-23",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "IPV",
      dose_number: 2,
      date_given: "2025-09-23",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "PCV",
      dose_number: 2,
      date_given: "2025-09-23",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Rotavirus",
      dose_number: 2,
      date_given: "2025-09-23",
      route: "oral",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Pentavalent (DPT+HepB+Hib)",
      dose_number: 3,
      date_given: "2025-10-21",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "IPV",
      dose_number: 3,
      date_given: "2025-10-21",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "PCV",
      dose_number: 3,
      date_given: "2025-10-21",
      route: "im",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Rotavirus",
      dose_number: 3,
      date_given: "2025-10-21",
      route: "oral",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "OPV",
      dose_number: 1,
      date_given: "2026-01-15",
      route: "oral",
      free_or_paid: "free_uip",
    },
    {
      vaccine_name: "Hepatitis B",
      dose_number: 3,
      date_given: "2026-01-15",
      route: "im",
      free_or_paid: "free_uip",
    },
  ];

  for (const v of vaccines) {
    await post("vaccinations", {
      patient_id: "RKH-25260300001",
      visit_id: visit.id,
      given_by: "DR-LOKENDER",
      ...v,
    });
  }
  console.log("Vaccinations:", vaccines.length, "records");

  // 5. Growth record
  const growth = await post("growth_records", {
    patient_id: "RKH-25260300001",
    visit_id: visit.id,
    recorded_date: "2026-03-16",
    weight_kg: 7.2,
    height_cm: 67,
    hc_cm: 43,
    muac_cm: 13.5,
    waz: -0.8,
    haz: -0.5,
    whz: -0.6,
    hcaz: 0.2,
    chart_used: "WHO2006",
    classification: "Well nourished",
  });
  console.log("Growth record:", growth.id);

  // 6. Developmental screening
  const dev = await post("developmental_screenings", {
    patient_id: "RKH-25260300001",
    visit_id: visit.id,
    screening_date: "2026-03-16",
    tool_used: "Clinical assessment + IAP Developmental Card",
    gross_motor: "Sits without support, pulls to stand with support",
    fine_motor: "Transfers objects hand to hand, raking grasp developing",
    language: "Babbles (ba-ba, da-da), responds to name",
    social: "Stranger anxiety present, plays peek-a-boo",
    cognitive: "Object permanence developing, explores objects by mouthing",
    overall_result: "Normal",
    red_flags: null,
    referral_needed: false,
    notes: "All milestones age-appropriate for 8 months. No concerns.",
  });
  console.log("Developmental screening:", dev.id);

  console.log("\n=== COMPLETE ===");
  console.log("Patient: RKH-25260300001 (Arjun Kumar, 8 months, Male)");
  console.log("Visit: " + visit.id + " (2026-03-16, Dr. Lokender)");
  console.log("Prescription: RX-20260316 (Amoxicillin + Paracetamol)");
  console.log("Vaccinations: 17 doses recorded (IAP schedule up to 8 months)");
  console.log("Growth: WHO2006, all Z-scores normal, well nourished");
  console.log("Development: Normal, all milestones met");
}

run().catch((e) => console.error("Error:", e.message));
