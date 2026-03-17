#!/usr/bin/env node
// Creates 20 sample OPD patients with today's visits for testing.
// Run daily after scrubbing: node create_sample_data.js
// Prerequisite: node import_data.js (formulary + standard Rx must exist)

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    });
}

const SB =
  process.argv[2] ||
  process.env.SUPABASE_URL ||
  "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  process.argv[3] ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SB || !KEY) {
  console.error("Missing credentials. Create .env file or pass as arguments.");
  process.exit(1);
}

const TODAY = new Date().toISOString().split("T")[0];

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

async function del(table) {
  const r = await fetch(`${SB}/rest/v1/${table}?id=not.is.null`, {
    method: "DELETE",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: "return=minimal",
    },
  });
  return r.status;
}

// ===== 20 PATIENTS — Wide clinical spectrum =====
const patients = [
  // --- INFANTS (0-12 months) ---
  {
    id: "RKH-25260300001",
    name: "Arjun Kumar",
    dob: "2025-07-15",
    sex: "Male",
    guardian_name: "Raj Kumar",
    guardian_relation: "Father",
    contact_phone: "9876543210",
    blood_group: "B+",
    known_allergies: null,
  },
  {
    id: "RKH-25260300002",
    name: "Ananya Gupta",
    dob: "2025-12-01",
    sex: "Female",
    guardian_name: "Vikram Gupta",
    guardian_relation: "Father",
    contact_phone: "9871234567",
    blood_group: "AB+",
    known_allergies: null,
  },
  {
    id: "RKH-25260300003",
    name: "Dev Raj",
    dob: "2025-09-05",
    sex: "Male",
    guardian_name: "Manoj Raj",
    guardian_relation: "Father",
    contact_phone: "9856789012",
    blood_group: "O+",
    known_allergies: null,
  },

  // --- PRETERM / NEONATAL ---
  {
    id: "RKH-25260300004",
    name: "Aadhya Verma",
    dob: "2026-02-20",
    sex: "Female",
    guardian_name: "Amit Verma",
    guardian_relation: "Father",
    contact_phone: "9823456789",
    blood_group: "O-",
    known_allergies: null,
    gestational_age_weeks: 34,
    birth_weight_kg: 1.8,
  },
  {
    id: "RKH-25260300005",
    name: "Reyansh Sharma",
    dob: "2026-03-05",
    sex: "Male",
    guardian_name: "Priya Sharma",
    guardian_relation: "Mother",
    contact_phone: "9845671234",
    blood_group: "A+",
    known_allergies: null,
    gestational_age_weeks: 32,
    birth_weight_kg: 1.5,
  },

  // --- TODDLERS (1-3 years) ---
  {
    id: "RKH-25260300006",
    name: "Priya Sharma",
    dob: "2024-11-20",
    sex: "Female",
    guardian_name: "Suresh Sharma",
    guardian_relation: "Father",
    contact_phone: "9812345678",
    blood_group: "A+",
    known_allergies: null,
  },
  {
    id: "RKH-25260300007",
    name: "Ishita Chauhan",
    dob: "2024-04-18",
    sex: "Female",
    guardian_name: "Pooja Chauhan",
    guardian_relation: "Mother",
    contact_phone: "9834567890",
    blood_group: "B+",
    known_allergies: ["Cephalosporins"],
  },
  {
    id: "RKH-25260300008",
    name: "Aditya Yadav",
    dob: "2023-08-10",
    sex: "Male",
    guardian_name: "Neha Yadav",
    guardian_relation: "Mother",
    contact_phone: "9867891234",
    blood_group: "O+",
    known_allergies: null,
  },

  // --- PRESCHOOL (3-5 years) ---
  {
    id: "RKH-25260300009",
    name: "Rohan Singh",
    dob: "2023-03-08",
    sex: "Male",
    guardian_name: "Harpreet Singh",
    guardian_relation: "Mother",
    contact_phone: "9898765432",
    blood_group: "O+",
    known_allergies: ["Penicillin"],
  },
  {
    id: "RKH-25260300010",
    name: "Vihaan Yadav",
    dob: "2022-06-15",
    sex: "Male",
    guardian_name: "Sunita Yadav",
    guardian_relation: "Mother",
    contact_phone: "9845678901",
    blood_group: "B-",
    known_allergies: ["Sulfa drugs", "Eggs"],
  },
  {
    id: "RKH-25260300011",
    name: "Saanvi Joshi",
    dob: "2021-12-30",
    sex: "Female",
    guardian_name: "Ravi Joshi",
    guardian_relation: "Father",
    contact_phone: "9878901234",
    blood_group: "AB-",
    known_allergies: null,
  },

  // --- SCHOOL AGE (5-10 years) ---
  {
    id: "RKH-25260300012",
    name: "Karan Malik",
    dob: "2020-09-25",
    sex: "Male",
    guardian_name: "Deepak Malik",
    guardian_relation: "Father",
    contact_phone: "9867890123",
    blood_group: "A-",
    known_allergies: null,
  },
  {
    id: "RKH-25260300013",
    name: "Diya Patel",
    dob: "2019-05-14",
    sex: "Female",
    guardian_name: "Sanjay Patel",
    guardian_relation: "Father",
    contact_phone: "9812340987",
    blood_group: "B+",
    known_allergies: ["Aspirin"],
  },
  {
    id: "RKH-25260300014",
    name: "Aryan Mehra",
    dob: "2018-01-22",
    sex: "Male",
    guardian_name: "Kavita Mehra",
    guardian_relation: "Mother",
    contact_phone: "9876540123",
    blood_group: "A+",
    known_allergies: null,
  },
  {
    id: "RKH-25260300015",
    name: "Nisha Kumari",
    dob: "2017-07-09",
    sex: "Female",
    guardian_name: "Ram Kumar",
    guardian_relation: "Father",
    contact_phone: "9845670987",
    blood_group: "O+",
    known_allergies: null,
  },

  // --- ADOLESCENT (10+ years) ---
  {
    id: "RKH-25260300016",
    name: "Rahul Verma",
    dob: "2014-11-03",
    sex: "Male",
    guardian_name: "Sunil Verma",
    guardian_relation: "Father",
    contact_phone: "9834560987",
    blood_group: "AB+",
    known_allergies: null,
  },
  {
    id: "RKH-25260300017",
    name: "Simran Kaur",
    dob: "2013-04-18",
    sex: "Female",
    guardian_name: "Gurpreet Kaur",
    guardian_relation: "Mother",
    contact_phone: "9823450987",
    blood_group: "B+",
    known_allergies: null,
  },

  // --- SPECIAL CASES ---
  {
    id: "RKH-25260300018",
    name: "Lakshmi Devi",
    dob: "2022-02-14",
    sex: "Female",
    guardian_name: "Ramesh Kumar",
    guardian_relation: "Father",
    contact_phone: "9812349876",
    blood_group: "O+",
    known_allergies: null,
  },
  {
    id: "RKH-25260300019",
    name: "Mohammed Akhtar",
    dob: "2024-06-20",
    sex: "Male",
    guardian_name: "Fatima Begum",
    guardian_relation: "Mother",
    contact_phone: "9856780123",
    blood_group: "A+",
    known_allergies: ["Ibuprofen"],
  },
  {
    id: "RKH-25260300020",
    name: "Tanvi Aggarwal",
    dob: "2023-01-05",
    sex: "Female",
    guardian_name: "Rajesh Aggarwal",
    guardian_relation: "Father",
    contact_phone: "9867890456",
    blood_group: "B-",
    known_allergies: null,
  },
];

// ===== 20 VISITS — Diverse chief complaints covering major pediatric categories =====
const visits = [
  // 1. Arjun (8mo) — AOM + fever
  {
    patient_id: "RKH-25260300001",
    weight_kg: 7.2,
    height_cm: 67,
    hc_cm: 43,
    temp_f: 101.2,
    hr_per_min: 128,
    rr_per_min: 36,
    spo2_pct: 98,
    chief_complaints:
      "Fever 3 days, pulling at left ear, irritable, decreased appetite",
  },

  // 2. Ananya (3mo) — Vaccination visit + mild cold
  {
    patient_id: "RKH-25260300002",
    weight_kg: 5.1,
    height_cm: 58,
    hc_cm: 39,
    temp_f: 98.6,
    hr_per_min: 140,
    rr_per_min: 42,
    spo2_pct: 98,
    chief_complaints:
      "Vaccination visit. Mild nasal congestion since 2 days, no fever",
  },

  // 3. Dev (6mo) — AGE with dehydration
  {
    patient_id: "RKH-25260300003",
    weight_kg: 6.8,
    height_cm: 65,
    hc_cm: 42,
    temp_f: 101.0,
    hr_per_min: 132,
    rr_per_min: 38,
    spo2_pct: 97,
    chief_complaints:
      "Loose watery stools 6-7 times since yesterday, vomiting twice, decreased urine output",
  },

  // 4. Aadhya (25 days, preterm 34wk) — Poor feeding + weight check
  {
    patient_id: "RKH-25260300004",
    weight_kg: 2.1,
    height_cm: 46,
    hc_cm: 31,
    temp_f: 97.8,
    hr_per_min: 155,
    rr_per_min: 50,
    spo2_pct: 95,
    chief_complaints:
      "Poor weight gain, not taking feeds well, excessive sleepiness. Preterm 34 weeks, birth weight 1.8 kg",
  },

  // 5. Reyansh (12 days, preterm 32wk) — Neonatal jaundice
  {
    patient_id: "RKH-25260300005",
    weight_kg: 1.6,
    height_cm: 42,
    hc_cm: 29,
    temp_f: 98.2,
    hr_per_min: 160,
    rr_per_min: 52,
    spo2_pct: 96,
    chief_complaints:
      "Yellowish discoloration of skin and eyes since day 5, deepening. Preterm 32 weeks",
  },

  // 6. Priya (16mo) — Croup
  {
    patient_id: "RKH-25260300006",
    weight_kg: 9.8,
    height_cm: 76,
    hc_cm: 46,
    temp_f: 100.4,
    hr_per_min: 118,
    rr_per_min: 32,
    spo2_pct: 97,
    chief_complaints:
      "Barking cough since last night, noisy breathing, low-grade fever, hoarse cry",
  },

  // 7. Ishita (23mo, ALLERGY: Cephalosporins) — UTI
  {
    patient_id: "RKH-25260300007",
    weight_kg: 10.5,
    height_cm: 80,
    hc_cm: 47,
    temp_f: 102.2,
    hr_per_min: 120,
    rr_per_min: 28,
    spo2_pct: 99,
    chief_complaints:
      "High fever 2 days, foul-smelling urine, irritable during urination, decreased appetite",
  },

  // 8. Aditya (2yr 7mo) — Pneumonia
  {
    patient_id: "RKH-25260300008",
    weight_kg: 12.0,
    height_cm: 87,
    temp_f: 103.0,
    hr_per_min: 110,
    rr_per_min: 40,
    spo2_pct: 94,
    chief_complaints:
      "Cough 5 days worsening, high fever 3 days, fast breathing, refusing to eat, chest sounds wheezy",
  },

  // 9. Rohan (3yr, ALLERGY: Penicillin) — Acute pharyngitis
  {
    patient_id: "RKH-25260300009",
    weight_kg: 13.5,
    height_cm: 92,
    temp_f: 102.5,
    hr_per_min: 105,
    rr_per_min: 24,
    spo2_pct: 99,
    chief_complaints:
      "Sore throat 2 days, fever, difficulty swallowing, enlarged neck glands",
  },

  // 10. Vihaan (3yr 9mo, ALLERGY: Sulfa+Eggs) — Asthma exacerbation
  {
    patient_id: "RKH-25260300010",
    weight_kg: 15.2,
    height_cm: 98,
    temp_f: 99.0,
    hr_per_min: 100,
    rr_per_min: 28,
    spo2_pct: 95,
    chief_complaints:
      "Wheezing since last night, cough, difficulty breathing, history of recurrent wheeze. Known asthmatic",
  },

  // 11. Saanvi (4yr 2mo) — Iron deficiency anaemia
  {
    patient_id: "RKH-25260300011",
    weight_kg: 14.8,
    height_cm: 100,
    temp_f: 98.4,
    hr_per_min: 92,
    rr_per_min: 22,
    spo2_pct: 99,
    chief_complaints:
      "Pale, poor appetite for 2 months, tires easily, pica (eating mud). Previous Hb 8.2 g/dl",
  },

  // 12. Karan (5yr 5mo) — Worm infestation + abdominal pain
  {
    patient_id: "RKH-25260300012",
    weight_kg: 18.5,
    height_cm: 108,
    temp_f: 98.4,
    hr_per_min: 88,
    rr_per_min: 20,
    spo2_pct: 99,
    chief_complaints:
      "Recurrent abdominal pain 2 weeks, perianal itching at night, poor appetite, visible worms in stool",
  },

  // 13. Diya (6yr 10mo, ALLERGY: Aspirin) — Skin infection / Impetigo
  {
    patient_id: "RKH-25260300013",
    weight_kg: 21.0,
    height_cm: 118,
    temp_f: 99.6,
    hr_per_min: 85,
    rr_per_min: 20,
    spo2_pct: 99,
    chief_complaints:
      "Honey-colored crusty lesions on face around mouth and nose, spreading, mild itching, started 4 days ago",
  },

  // 14. Aryan (8yr) — Febrile seizures
  {
    patient_id: "RKH-25260300014",
    weight_kg: 25.0,
    height_cm: 128,
    temp_f: 103.5,
    hr_per_min: 95,
    rr_per_min: 22,
    spo2_pct: 98,
    chief_complaints:
      "Episode of shaking of all limbs during fever lasting 2 minutes, now responsive. First episode. High fever since morning",
  },

  // 15. Nisha (8yr 8mo) — Viral exanthem / measles-like rash
  {
    patient_id: "RKH-25260300015",
    weight_kg: 26.5,
    height_cm: 132,
    temp_f: 101.5,
    hr_per_min: 88,
    rr_per_min: 20,
    spo2_pct: 99,
    chief_complaints:
      "Fever 4 days, red rash started on face spreading to trunk and limbs, conjunctivitis, runny nose, cough",
  },

  // 16. Rahul (11yr) — Acute appendicitis suspicion
  {
    patient_id: "RKH-25260300016",
    weight_kg: 35.0,
    height_cm: 142,
    temp_f: 100.8,
    hr_per_min: 90,
    rr_per_min: 18,
    spo2_pct: 99,
    chief_complaints:
      "Severe right lower abdominal pain since yesterday, started around navel then shifted to right. Vomiting twice. Cannot walk straight",
  },

  // 17. Simran (12yr) — Adolescent migraine
  {
    patient_id: "RKH-25260300017",
    weight_kg: 42.0,
    height_cm: 152,
    temp_f: 98.4,
    hr_per_min: 76,
    rr_per_min: 16,
    spo2_pct: 99,
    chief_complaints:
      "Recurrent severe headache left side, throbbing, with nausea and light sensitivity. 3rd episode this month. Missed school",
  },

  // 18. Lakshmi (4yr) — Severe malnutrition (SAM)
  {
    patient_id: "RKH-25260300018",
    weight_kg: 9.5,
    height_cm: 88,
    muac_cm: 11.0,
    temp_f: 98.0,
    hr_per_min: 110,
    rr_per_min: 24,
    spo2_pct: 98,
    chief_complaints:
      "Very thin, not gaining weight for 6 months, frequent infections, poor appetite, visible ribs, thinning hair",
  },

  // 19. Mohammed (21mo, ALLERGY: Ibuprofen) — Viral URTI with wheeze
  {
    patient_id: "RKH-25260300019",
    weight_kg: 10.2,
    height_cm: 78,
    hc_cm: 47,
    temp_f: 100.2,
    hr_per_min: 115,
    rr_per_min: 30,
    spo2_pct: 97,
    chief_complaints:
      "Runny nose and cough 4 days, now mild wheeze, low-grade fever, eating less",
  },

  // 20. Tanvi (3yr 2mo) — Developmental delay concern
  {
    patient_id: "RKH-25260300020",
    weight_kg: 11.8,
    height_cm: 90,
    hc_cm: 48,
    temp_f: 98.4,
    hr_per_min: 100,
    rr_per_min: 22,
    spo2_pct: 99,
    chief_complaints:
      "Not speaking in sentences yet, only 5-6 single words, does not follow two-step commands, plays alone. Parents concerned about development",
  },
];

async function run() {
  console.log(`\n=== Radhakishan Hospital — Sample Data Creator ===`);
  console.log(`Date: ${TODAY}\n`);

  // Step 1: Scrub all existing clinical data
  console.log("Scrubbing existing data...");
  for (const t of [
    "developmental_screenings",
    "growth_records",
    "vaccinations",
    "prescriptions",
    "visits",
    "patients",
  ]) {
    await del(t);
  }
  console.log("  All patient/visit data cleared.\n");

  // Step 2: Create patients
  console.log("Creating 20 patients...");
  for (const p of patients) {
    p.is_active = true;
    const result = await post("patients", p);
    const allergy = p.known_allergies
      ? ` [ALLERGY: ${p.known_allergies.join(", ")}]`
      : "";
    const preterm = p.gestational_age_weeks
      ? ` [Preterm ${p.gestational_age_weeks}wk, BW ${p.birth_weight_kg}kg]`
      : "";
    console.log(`  ${result.id} ${result.name}${allergy}${preterm}`);
  }

  // Step 3: Create past visits + prescriptions for returning patients (BEFORE today's visits)
  console.log(
    "\nCreating past visits & prescriptions for returning patients...",
  );

  const pastRx = [
    // #1 Arjun — URTI 2 weeks ago
    {
      patient_id: "RKH-25260300001",
      daysAgo: 14,
      visit: {
        weight_kg: 7.0,
        temp_f: 100.4,
        hr_per_min: 125,
        rr_per_min: 34,
        spo2_pct: 99,
        chief_complaints: "Runny nose, cough, low-grade fever 2 days",
      },
      rx: {
        patient: {
          name: "Arjun Kumar",
          age: "7.5 months",
          sex: "Male",
          weight_kg: 7.0,
        },
        diagnosis: [
          { name: "Acute URTI", icd10: "J06.9", type: "provisional" },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "PARACETAMOL SUSPENSION (120 mg / 5 ml)",
            row2_en:
              "4 ml orally every 6 hours as needed for fever. Max 4 doses/day.",
            row3_hi:
              "4 ml बुखार होने पर हर 6 घंटे में मुँह से दें। दिन में 4 बार से ज़्यादा न दें।",
            calc: "15 mg/kg × 7 kg = 105 mg → 4 ml",
            formulation: "syrup",
            dose_mg_per_kg: 15,
            dose_per_day_divided: 4,
            concentration_mg: 120,
            concentration_per_ml: 5,
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "4 ml",
              times: [],
              prn: true,
              max_per_day: 4,
              duration_days: null,
              with_food: false,
              special: "fever_only",
            },
          },
          {
            number: 2,
            row1_en: "CETIRIZINE DROPS (10 mg / ml)",
            row2_en: "2 drops (0.2 ml) orally once daily for 5 days.",
            row3_hi: "2 बूँदें दिन में एक बार 5 दिन तक दें।",
            calc: "0.25 mg/kg × 7 kg = 1.75 mg → 0.2 ml (2 drops)",
            formulation: "drops",
            dose_mg_per_kg: 0.25,
            dose_per_day_divided: 1,
            concentration_mg: 10,
            concentration_per_ml: 1,
            flag: "",
            pictogram: {
              form: "drops",
              dose_display: "2 drops",
              dose_qty: 2,
              times: ["morning"],
              prn: false,
              duration_days: 5,
              with_food: false,
            },
          },
        ],
        investigations: [],
        vitals: {
          temp_f: "100.4",
          hr_per_min: "125",
          rr_per_min: "34",
          spo2_pct: "99",
        },
        chief_complaints: "Runny nose, cough, low-grade fever 2 days",
        clinical_history:
          "7.5-month-old male with acute onset rhinorrhea and cough for 2 days. Low-grade fever (100.4°F). Feeding well. No rash, no vomiting.",
        examination:
          "Mild nasal congestion. Throat clear. Chest clear. No distress.",
        safety: {
          allergy_note: "NKDA",
          interactions: "None found",
          overall_status: "SAFE",
          max_dose_check: [
            {
              drug: "PARACETAMOL",
              calculated_dose_mg: 105,
              max_allowed_mg: 1000,
              status: "PASS",
            },
          ],
          flags: [],
        },
        counselling: [
          "Nasal saline drops",
          "Increase fluid intake",
          "Return if fever persists >3 days",
        ],
        followup_days: 5,
        doctor_notes: "Viral URTI. Symptomatic management.",
        nabh_compliant: true,
      },
    },
    // #6 Priya — URTI 3 weeks ago
    {
      patient_id: "RKH-25260300006",
      daysAgo: 21,
      visit: {
        weight_kg: 9.5,
        temp_f: 99.8,
        hr_per_min: 112,
        rr_per_min: 28,
        spo2_pct: 99,
        chief_complaints: "Cough and cold 4 days, slight fever",
      },
      rx: {
        patient: {
          name: "Priya Sharma",
          age: "15 months",
          sex: "Female",
          weight_kg: 9.5,
        },
        diagnosis: [
          { name: "Acute URTI", icd10: "J06.9", type: "provisional" },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "PARACETAMOL SUSPENSION (120 mg / 5 ml)",
            row2_en: "6 ml orally every 6 hours as needed for fever.",
            row3_hi: "6 ml बुखार होने पर हर 6 घंटे में मुँह से दें।",
            calc: "15 mg/kg × 9.5 kg = 142 mg → 6 ml",
            formulation: "syrup",
            dose_mg_per_kg: 15,
            dose_per_day_divided: 4,
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "6 ml",
              times: [],
              prn: true,
              max_per_day: 4,
            },
          },
          {
            number: 2,
            row1_en: "AMBROXOL SYRUP (15 mg / 5 ml)",
            row2_en: "2.5 ml orally twice daily for 5 days.",
            row3_hi: "2.5 ml सुबह-शाम 5 दिन तक दें।",
            calc: "1.2 mg/kg × 9.5 kg = 11.4 mg → 3.8 ml → rounded to 2.5 ml (pediatric dose)",
            formulation: "syrup",
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "2.5 ml",
              times: ["morning", "evening"],
              prn: false,
              duration_days: 5,
              with_food: false,
            },
          },
        ],
        investigations: [],
        vitals: { temp_f: "99.8" },
        chief_complaints: "Cough and cold 4 days, slight fever",
        clinical_history:
          "15-month-old female with cough and nasal discharge for 4 days. Low-grade fever.",
        examination:
          "Rhinorrhea present. Throat mildly congested. Chest clear.",
        safety: {
          allergy_note: "NKDA",
          interactions: "None",
          overall_status: "SAFE",
          max_dose_check: [],
          flags: [],
        },
        counselling: ["Steam inhalation", "Warm fluids"],
        followup_days: 5,
        nabh_compliant: true,
      },
    },
    // #9 Rohan (Penicillin allergy) — Skin infection 1 month ago
    {
      patient_id: "RKH-25260300009",
      daysAgo: 30,
      visit: {
        weight_kg: 13.2,
        temp_f: 99.4,
        hr_per_min: 100,
        rr_per_min: 22,
        spo2_pct: 99,
        chief_complaints: "Itchy red patches on arms, worsening for 1 week",
      },
      rx: {
        patient: {
          name: "Rohan Singh",
          age: "2 yr 11 mo",
          sex: "Male",
          weight_kg: 13.2,
        },
        diagnosis: [
          { name: "Dermatitis", icd10: "L30.9", type: "provisional" },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "CETIRIZINE SYRUP (5 mg / 5 ml)",
            row2_en: "2.5 ml orally once daily for 7 days.",
            row3_hi: "2.5 ml दिन में एक बार 7 दिन तक दें।",
            calc: "0.25 mg/kg × 13.2 kg = 3.3 mg → 2.5 ml (standard pediatric dose)",
            formulation: "syrup",
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "2.5 ml",
              times: ["bedtime"],
              prn: false,
              duration_days: 7,
              with_food: false,
            },
          },
          {
            number: 2,
            row1_en: "CALAMINE LOTION (Topical)",
            row2_en: "Apply thin layer to affected areas twice daily.",
            row3_hi: "प्रभावित जगह पर पतली परत दिन में 2 बार लगाएं।",
            calc: "Topical — no dose calculation",
            formulation: "topical",
            flag: "",
            pictogram: {
              form: "topical",
              dose_display: "Apply",
              times: ["morning", "evening"],
              prn: false,
              duration_days: 7,
              with_food: false,
            },
          },
        ],
        investigations: [],
        vitals: { temp_f: "99.4" },
        chief_complaints: "Itchy red patches on arms, worsening for 1 week",
        examination:
          "Erythematous papular rash on bilateral forearms. No vesicles. No secondary infection.",
        safety: {
          allergy_note: "ALLERGY: Penicillin",
          interactions: "None",
          overall_status: "SAFE",
          max_dose_check: [],
          flags: [],
        },
        counselling: [
          "Keep skin moisturized",
          "Avoid scratching",
          "Cotton clothing",
        ],
        followup_days: 7,
        nabh_compliant: true,
      },
    },
    // #10 Vihaan (Asthma) — Previous asthma episode 6 weeks ago
    {
      patient_id: "RKH-25260300010",
      daysAgo: 42,
      visit: {
        weight_kg: 14.8,
        temp_f: 98.6,
        hr_per_min: 96,
        rr_per_min: 26,
        spo2_pct: 96,
        chief_complaints:
          "Wheezing, cough at night, difficulty breathing after running",
      },
      rx: {
        patient: {
          name: "Vihaan Yadav",
          age: "3 yr 7 mo",
          sex: "Male",
          weight_kg: 14.8,
        },
        diagnosis: [
          {
            name: "Asthma Exacerbation",
            icd10: "J45.901",
            type: "provisional",
          },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "SALBUTAMOL NEBULISATION (5 mg / ml)",
            row2_en:
              "2.5 mg (0.5 ml + 2 ml NS) nebulised every 6 hours for 3 days, then as needed.",
            row3_hi: "2.5 mg नेबुलाइज़र से हर 6 घंटे 3 दिन, फिर ज़रूरत पर।",
            calc: "0.15 mg/kg × 14.8 kg = 2.22 mg → 2.5 mg (min dose)",
            formulation: "inhaler",
            flag: "",
            pictogram: {
              form: "inhaler",
              dose_display: "2.5 mg neb",
              times: ["morning", "afternoon", "evening", "bedtime"],
              prn: false,
              duration_days: 3,
            },
          },
          {
            number: 2,
            row1_en: "PREDNISOLONE ORAL (5 mg / 5 ml)",
            row2_en: "7.5 ml (15 mg) orally once daily for 3 days.",
            row3_hi: "7.5 ml सुबह एक बार 3 दिन तक दें।",
            calc: "1 mg/kg × 14.8 kg = 14.8 mg → 15 mg = 7.5 ml",
            formulation: "syrup",
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "7.5 ml",
              times: ["morning"],
              prn: false,
              duration_days: 3,
              with_food: true,
            },
          },
        ],
        investigations: [],
        vitals: { temp_f: "98.6", spo2_pct: "96" },
        chief_complaints:
          "Wheezing, cough at night, difficulty breathing after running",
        examination:
          "Bilateral wheeze on auscultation. No retractions. SpO2 96%.",
        safety: {
          allergy_note: "ALLERGY: Sulfa drugs, Eggs",
          interactions: "None",
          overall_status: "SAFE",
          max_dose_check: [
            {
              drug: "PREDNISOLONE",
              calculated_dose_mg: 15,
              max_allowed_mg: 40,
              status: "PASS",
            },
          ],
          flags: ["Egg allergy — avoid egg-based vaccines"],
        },
        counselling: [
          "Avoid triggers (dust, smoke)",
          "Asthma action plan explained",
          "Return if breathing worsens",
        ],
        followup_days: 3,
        nabh_compliant: true,
      },
    },
    // #11 Saanvi — Iron deficiency follow-up 1 month ago
    {
      patient_id: "RKH-25260300011",
      daysAgo: 30,
      visit: {
        weight_kg: 14.5,
        temp_f: 98.4,
        hr_per_min: 90,
        rr_per_min: 22,
        spo2_pct: 99,
        chief_complaints:
          "Follow-up for anaemia. Started iron 1 month ago. Hb was 8.2.",
      },
      rx: {
        patient: {
          name: "Saanvi Joshi",
          age: "4 yr",
          sex: "Female",
          weight_kg: 14.5,
        },
        diagnosis: [
          {
            name: "Iron Deficiency Anaemia",
            icd10: "D50.9",
            type: "provisional",
          },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "IRON (ELEMENTAL) SYRUP (50 mg / 5 ml)",
            row2_en:
              "4.5 ml orally twice daily for 3 months. Give on empty stomach with Vitamin C.",
            row3_hi:
              "4.5 ml सुबह-शाम 3 महीने तक खाली पेट दें। विटामिन C के साथ दें।",
            calc: "3 mg/kg × 14.5 kg = 43.5 mg/day ÷ 2 = 21.75 mg/dose → 2.2 ml → rounded to 2.5 ml. Total: 4.5 ml/day",
            formulation: "syrup",
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "2.5 ml",
              times: ["morning", "evening"],
              prn: false,
              duration_days: 90,
              with_food: false,
              special: "empty_stomach",
            },
          },
          {
            number: 2,
            row1_en: "VITAMIN C TABLET (100 mg)",
            row2_en: "Half tablet (50 mg) orally twice daily with iron.",
            row3_hi: "आधी गोली दिन में 2 बार आयरन के साथ दें।",
            calc: "50 mg × 2 = 100 mg/day",
            formulation: "tablet",
            flag: "",
            pictogram: {
              form: "tablet",
              dose_display: "½ tab",
              dose_qty: 0,
              dose_fraction: "half",
              times: ["morning", "evening"],
              prn: false,
              duration_days: 90,
              with_food: false,
            },
          },
          {
            number: 3,
            row1_en: "ALBENDAZOLE TABLET (400 mg)",
            row2_en: "400 mg single dose today. Repeat after 2 weeks.",
            row3_hi: "400 mg की एक गोली आज दें। 2 हफ्ते बाद दोबारा दें।",
            calc: "Fixed dose: 400 mg single dose (age >2yr)",
            formulation: "tablet",
            flag: "",
            pictogram: {
              form: "tablet",
              dose_display: "1 tab",
              dose_qty: 1,
              times: [],
              prn: false,
              duration_days: 1,
            },
          },
        ],
        investigations: [
          {
            name: "CBC with reticulocyte count",
            indication: "Baseline for anaemia treatment",
            urgency: "routine",
          },
        ],
        vitals: { temp_f: "98.4" },
        chief_complaints:
          "Follow-up for anaemia. Started iron 1 month ago. Hb was 8.2.",
        examination:
          "Mild pallor of conjunctiva and nail beds. No organomegaly.",
        safety: {
          allergy_note: "NKDA",
          interactions: "Iron + Vitamin C — beneficial (enhances absorption)",
          overall_status: "SAFE",
          max_dose_check: [],
          flags: [],
        },
        counselling: [
          "Continue iron for full 3 months",
          "Iron-rich diet (green leafy vegetables, jaggery)",
          "Avoid milk/tea 1 hour before/after iron",
        ],
        followup_days: 30,
        doctor_notes: "Recheck Hb in 4 weeks.",
        nabh_compliant: true,
      },
    },
    // #12 Karan — URTI 2 months ago
    {
      patient_id: "RKH-25260300012",
      daysAgo: 60,
      visit: {
        weight_kg: 18.0,
        temp_f: 100.8,
        hr_per_min: 92,
        rr_per_min: 22,
        spo2_pct: 99,
        chief_complaints: "Fever, sore throat, body aches 2 days",
      },
      rx: {
        patient: {
          name: "Karan Malik",
          age: "5 yr 3 mo",
          sex: "Male",
          weight_kg: 18.0,
        },
        diagnosis: [
          { name: "Acute Pharyngitis", icd10: "J02.9", type: "provisional" },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "AMOXICILLIN SUSPENSION (250 mg / 5 ml)",
            row2_en: "7 ml orally three times a day for 7 days.",
            row3_hi: "7 ml दिन में 3 बार 7 दिन तक खाने के बाद दें।",
            calc: "50 mg/kg/day × 18 kg = 900 mg/day ÷ 3 = 300 mg/dose → 6 ml → 7 ml",
            formulation: "syrup",
            dose_mg_per_kg: 50,
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "7 ml",
              times: ["morning", "afternoon", "evening"],
              prn: false,
              duration_days: 7,
              with_food: true,
            },
          },
          {
            number: 2,
            row1_en: "IBUPROFEN SUSPENSION (100 mg / 5 ml)",
            row2_en:
              "4.5 ml orally every 8 hours as needed for fever/pain. Max 3 doses/day.",
            row3_hi:
              "4.5 ml बुखार/दर्द पर हर 8 घंटे दें। दिन में 3 बार से ज़्यादा न दें।",
            calc: "5 mg/kg × 18 kg = 90 mg → 4.5 ml",
            formulation: "syrup",
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "4.5 ml",
              times: [],
              prn: true,
              max_per_day: 3,
              special: "fever_only",
            },
          },
        ],
        investigations: [
          {
            name: "Rapid Strep Test",
            indication: "Rule out GAS pharyngitis",
            urgency: "same-day",
          },
        ],
        vitals: { temp_f: "100.8" },
        chief_complaints: "Fever, sore throat, body aches 2 days",
        examination:
          "Pharynx erythematous with tonsillar exudate. Bilateral tender anterior cervical lymphadenopathy.",
        safety: {
          allergy_note: "NKDA",
          interactions: "None",
          overall_status: "SAFE",
          max_dose_check: [],
          flags: [],
        },
        counselling: [
          "Complete full antibiotic course",
          "Gargle with warm salt water",
          "Soft diet",
        ],
        followup_days: 3,
        nabh_compliant: true,
      },
    },
    // #17 Simran — Previous migraine episode 2 weeks ago
    {
      patient_id: "RKH-25260300017",
      daysAgo: 14,
      visit: {
        weight_kg: 41.5,
        temp_f: 98.4,
        hr_per_min: 78,
        rr_per_min: 16,
        spo2_pct: 99,
        chief_complaints:
          "Severe left-sided headache, throbbing, nausea, light sensitivity. 2nd episode this month.",
      },
      rx: {
        patient: {
          name: "Simran Kaur",
          age: "12 yr 11 mo",
          sex: "Female",
          weight_kg: 41.5,
        },
        diagnosis: [
          {
            name: "Migraine without aura",
            icd10: "G43.009",
            type: "provisional",
          },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "IBUPROFEN TABLET (400 mg)",
            row2_en:
              "1 tablet orally at onset of headache. May repeat once after 6 hours. Max 2 tablets/day.",
            row3_hi:
              "सिरदर्द शुरू होते ही 1 गोली मुँह से लें। 6 घंटे बाद दोबारा ले सकते हैं। दिन में 2 से ज़्यादा न लें।",
            calc: "10 mg/kg × 41.5 kg = 415 mg → 400 mg (1 tablet)",
            formulation: "tablet",
            dose_mg_per_kg: 10,
            flag: "",
            pictogram: {
              form: "tablet",
              dose_display: "1 tab",
              dose_qty: 1,
              times: [],
              prn: true,
              max_per_day: 2,
              special: null,
            },
          },
          {
            number: 2,
            row1_en: "DOMPERIDONE TABLET (10 mg)",
            row2_en: "Half tablet orally at onset with ibuprofen. For nausea.",
            row3_hi: "आधी गोली सिरदर्द की दवा के साथ उल्टी आने पर लें।",
            calc: "0.25 mg/kg × 41.5 = 10.4 mg → 10 mg (½ tab of 10 mg insufficient, use 1 tab). Adjusted to ½ tab.",
            formulation: "tablet",
            flag: "",
            pictogram: {
              form: "tablet",
              dose_display: "½ tab",
              dose_qty: 0,
              dose_fraction: "half",
              times: [],
              prn: true,
              max_per_day: 2,
            },
          },
        ],
        investigations: [],
        vitals: { temp_f: "98.4" },
        chief_complaints:
          "Severe left-sided headache, throbbing, nausea, light sensitivity. 2nd episode this month.",
        examination:
          "Alert, oriented. No focal neurological deficit. No papilloedema. BP 110/70.",
        safety: {
          allergy_note: "NKDA",
          interactions: "None",
          overall_status: "SAFE",
          max_dose_check: [
            {
              drug: "IBUPROFEN",
              calculated_dose_mg: 400,
              max_allowed_mg: 600,
              status: "PASS",
            },
          ],
          flags: [],
        },
        counselling: [
          "Maintain headache diary",
          "Identify triggers (stress, screen time, sleep)",
          "Adequate hydration",
          "Return if frequency increases",
        ],
        followup_days: 14,
        doctor_notes: "If >4 episodes/month, start prophylaxis (Flunarizine).",
        nabh_compliant: true,
      },
    },
    // #19 Mohammed (Ibuprofen allergy) — Viral fever 3 weeks ago
    {
      patient_id: "RKH-25260300019",
      daysAgo: 21,
      visit: {
        weight_kg: 10.0,
        temp_f: 102.0,
        hr_per_min: 120,
        rr_per_min: 30,
        spo2_pct: 98,
        chief_complaints: "High fever 2 days, runny nose, irritable",
      },
      rx: {
        patient: {
          name: "Mohammed Akhtar",
          age: "20 months",
          sex: "Male",
          weight_kg: 10.0,
        },
        diagnosis: [
          {
            name: "Acute Febrile Illness",
            icd10: "R50.9",
            type: "provisional",
          },
        ],
        medicines: [
          {
            number: 1,
            row1_en: "PARACETAMOL SUSPENSION (120 mg / 5 ml)",
            row2_en:
              "6 ml orally every 6 hours as needed for fever. Max 4 doses/day.",
            row3_hi:
              "6 ml बुखार होने पर हर 6 घंटे दें। दिन में 4 बार से ज़्यादा न दें।",
            calc: "15 mg/kg × 10 kg = 150 mg → 6 ml (rounded)",
            formulation: "syrup",
            dose_mg_per_kg: 15,
            flag: "",
            pictogram: {
              form: "syrup",
              dose_display: "6 ml",
              times: [],
              prn: true,
              max_per_day: 4,
              special: "fever_only",
            },
          },
        ],
        investigations: [
          {
            name: "CBC",
            indication: "Fever >2 days, rule out bacterial",
            urgency: "same-day",
          },
        ],
        vitals: { temp_f: "102.0" },
        chief_complaints: "High fever 2 days, runny nose, irritable",
        examination:
          "Febrile. Nasal discharge. Throat mildly congested. Chest clear. No rash.",
        safety: {
          allergy_note: "ALLERGY: Ibuprofen — avoid all NSAIDs",
          interactions: "None",
          overall_status: "SAFE",
          max_dose_check: [
            {
              drug: "PARACETAMOL",
              calculated_dose_mg: 150,
              max_allowed_mg: 1000,
              status: "PASS",
            },
          ],
          flags: ["Ibuprofen allergy — Paracetamol only for antipyretic"],
        },
        counselling: [
          "Tepid sponging for fever",
          "Increase fluid intake",
          "Return if fever >3 days or rash appears",
        ],
        followup_days: 3,
        nabh_compliant: true,
      },
    },
  ];

  for (const prx of pastRx) {
    const pastDate = new Date(Date.now() - prx.daysAgo * 86400000)
      .toISOString()
      .split("T")[0];
    // Create past visit
    const pv = await post("visits", {
      ...prx.visit,
      patient_id: prx.patient_id,
      visit_date: pastDate,
      doctor_id: "DR-LOKENDER",
    });
    // Create past prescription
    const rxId = "RX-" + pastDate.replace(/-/g, "") + prx.patient_id.slice(-3);
    await post("prescriptions", {
      id: rxId,
      visit_id: pv.id,
      patient_id: prx.patient_id,
      generated_json: prx.rx,
      medicines: prx.rx.medicines,
      investigations: prx.rx.investigations || [],
      is_approved: true,
      approved_by: "DR-LOKENDER",
      approved_at: new Date(Date.now() - prx.daysAgo * 86400000).toISOString(),
      version: 1,
    });
    console.log(
      `  ${prx.patient_id} — ${pastDate} — ${prx.rx.diagnosis[0].name} (${rxId})`,
    );
  }

  // Build a map of past Rx summaries per patient (for today's visit_summary)
  const pastRxMap = {};
  for (const prx of pastRx) {
    const g = prx.rx;
    const pastDate = new Date(
      Date.now() - prx.daysAgo * 86400000,
    ).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
    const dx = (g.diagnosis || [])
      .map((d) => d.name + (d.icd10 ? " (" + d.icd10 + ")" : ""))
      .join(", ");
    const meds = (g.medicines || [])
      .map((m) => (m.row1_en || "").split("(")[0].trim())
      .join(" + ");
    let summary = `LAST VISIT (${pastDate}): Dx: ${dx}. Rx: ${meds}.`;
    if (g.chief_complaints) summary += ` Complaints: ${g.chief_complaints}.`;
    if (g.followup_days) summary += ` Follow-up: ${g.followup_days} days.`;
    if (g.doctor_notes) summary += ` Notes: ${g.doctor_notes}`;
    pastRxMap[prx.patient_id] = summary.trim();
  }

  // Step 4: Create today's visits (with visit_summary for returning patients)
  console.log(`\nCreating ${visits.length} visits for ${TODAY}...`);
  for (let i = 0; i < visits.length; i++) {
    const v = { ...visits[i], visit_date: TODAY, doctor_id: "DR-LOKENDER" };
    if (pastRxMap[v.patient_id]) v.visit_summary = pastRxMap[v.patient_id];
    await post("visits", v);
    const sumTag = v.visit_summary ? " [+summary]" : "";
    console.log(
      `  ${i + 1}. ${v.patient_id} — ${v.chief_complaints.slice(0, 50)}...${sumTag}`,
    );
  }

  // Summary
  console.log(`\n=== COMPLETE ===`);
  console.log(`${patients.length} patients created`);
  console.log(`${visits.length} visits for ${TODAY}`);
  console.log(`\nSpectrum covered:`);
  console.log(
    `  Neonatal:    #4 (preterm 34wk poor feeding), #5 (preterm 32wk jaundice)`,
  );
  console.log(
    `  Infant:      #1 (AOM), #2 (vaccination), #3 (AGE/dehydration)`,
  );
  console.log(`  Toddler:     #6 (croup), #7 (UTI + allergy), #8 (pneumonia)`);
  console.log(
    `  Preschool:   #9 (pharyngitis + penicillin allergy), #10 (asthma + multi-allergy)`,
  );
  console.log(`               #11 (anaemia), #12 (worms)`);
  console.log(
    `  School-age:  #13 (impetigo + aspirin allergy), #14 (febrile seizures)`,
  );
  console.log(`               #15 (viral exanthem/measles)`);
  console.log(`  Adolescent:  #16 (appendicitis), #17 (migraine)`);
  console.log(
    `  Special:     #18 (SAM/malnutrition), #19 (URTI+wheeze + ibuprofen allergy)`,
  );
  console.log(`               #20 (developmental delay)`);
  console.log(
    `\nAllergies: #7 Cephalosporins, #9 Penicillin, #10 Sulfa+Eggs, #13 Aspirin, #19 Ibuprofen`,
  );
  console.log(`Preterms:  #4 (34wk/1.8kg), #5 (32wk/1.5kg)`);
  console.log(`\nPast prescriptions (${pastRx.length} returning patients):`);
  console.log(`  #1 Arjun — URTI 2 weeks ago`);
  console.log(`  #6 Priya — URTI 3 weeks ago`);
  console.log(`  #9 Rohan — Dermatitis 1 month ago (Penicillin allergy)`);
  console.log(
    `  #10 Vihaan — Asthma exacerbation 6 weeks ago (Sulfa+Eggs allergy)`,
  );
  console.log(
    `  #11 Saanvi — Iron deficiency anaemia 1 month ago (Iron+VitC+Albendazole)`,
  );
  console.log(`  #12 Karan — Pharyngitis 2 months ago (Amoxicillin+Ibuprofen)`);
  console.log(`  #17 Simran — Migraine 2 weeks ago (Ibuprofen+Domperidone)`);
  console.log(
    `  #19 Mohammed — Viral fever 3 weeks ago (Ibuprofen allergy, Paracetamol only)`,
  );
}

run().catch((e) => console.error("\nError:", e.message));
