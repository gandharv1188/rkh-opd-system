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

  // Step 3: Create today's visits
  console.log(`\nCreating ${visits.length} visits for ${TODAY}...`);
  for (let i = 0; i < visits.length; i++) {
    const v = { ...visits[i], visit_date: TODAY, doctor_id: "DR-LOKENDER" };
    const result = await post("visits", v);
    console.log(
      `  ${i + 1}. ${v.patient_id} — ${v.chief_complaints.slice(0, 60)}...`,
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
}

run().catch((e) => console.error("\nError:", e.message));
