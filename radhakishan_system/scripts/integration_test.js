#!/usr/bin/env node
/**
 * Live Integration Test — Radhakishan Hospital Prescription System
 * Tests actual Supabase REST API + Edge Functions
 *
 * Usage: node integration_test.js
 *
 * Tests:
 * 1. Create test patient → verify all fields accepted
 * 2. Create test visit with ALL vitals → verify all columns exist in live DB
 * 3. Read visit back → verify all fields returned
 * 4. Create lab results → verify schema
 * 5. Create vaccination record → verify schema
 * 6. Create growth record → verify schema
 * 7. Call generate-prescription Edge Function → verify response structure
 * 8. Save prescription → verify all fields
 * 9. Read prescription back → verify generated_json round-trip
 * 10. Call process-document Edge Function (text mode) → verify response
 * 11. Clean up all test data
 */

const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const TEST_PATIENT_ID = "RKH-00000099999";
const TEST_PREFIX = "INTEGRATION-TEST-";
let testVisitId = null;
let testRxId = null;
let testLabId = null;
let testVaxId = null;
let testGrowthId = null;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${testName} — ${detail || ""}`);
    failed++;
    failures.push({ test: testName, detail });
  }
}

async function q(path, method = "GET", body = null) {
  const opts = { method, headers: { ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SB}/rest/v1/${path}`, opts);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function fn(name, body) {
  const res = await fetch(`${SB}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

// ===== TEST 1: Create test patient =====
async function test1_createPatient() {
  console.log("\n--- TEST 1: Create test patient ---");

  // Clean up first in case previous test didn't finish
  await q(`patients?id=eq.${TEST_PATIENT_ID}`, "DELETE");

  const res = await q("patients", "POST", {
    id: TEST_PATIENT_ID,
    name: TEST_PREFIX + "Arjun Kumar",
    dob: "2025-06-15",
    sex: "Male",
    guardian_name: "Test Guardian",
    contact_phone: "9999999999",
    blood_group: "B+",
    known_allergies: ["Penicillin"],
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  assert(
    res.ok,
    "Patient created",
    `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`,
  );
  if (res.ok && res.data?.[0]) {
    assert(res.data[0].id === TEST_PATIENT_ID, "Patient ID matches");
    assert(res.data[0].blood_group === "B+", "Blood group saved");
    assert(Array.isArray(res.data[0].known_allergies), "Allergies is array");
  }
}

// ===== TEST 2: Create test visit with ALL vitals =====
async function test2_createVisit() {
  console.log("\n--- TEST 2: Create visit with ALL fields ---");

  const today = new Date().toISOString().split("T")[0];
  const visitPayload = {
    patient_id: TEST_PATIENT_ID,
    visit_date: today,
    doctor_id: "DR-LOKENDER",

    // Anthropometry
    weight_kg: 7.5,
    height_cm: 68.0,
    hc_cm: 43.5,
    muac_cm: 14.2,

    // Vitals
    temp_f: 100.4,
    hr_per_min: 130,
    rr_per_min: 36,
    spo2_pct: 97,
    bp_systolic: 85,
    bp_diastolic: 55,
    map_mmhg: 65.0,
    bmi: 16.2,

    // Schedule + receipt
    vax_schedule: "iap",
    receipt_no: "RKH-RCT-TEST-001",

    // Clinical
    chief_complaints: "Fever 3 days, cough, not eating well",
    clinical_notes: "Test clinical notes",
    raw_dictation: "Test raw dictation",
    visit_summary: "Test AI visit summary",
    triage_score: 3,

    // Billing
    consultation_fee: 300,
    payment_mode: "cash",
    payment_status: "paid",
    procedures: [{ name: "Nebulization", charge: 200, status: "paid" }],

    // Documents
    attached_documents: [
      {
        file_name: "test.jpg",
        category: "lab_report",
        ocr_summary: "Test summary",
      },
    ],

    created_at: new Date().toISOString(),
  };

  const res = await q("visits", "POST", visitPayload);
  assert(
    res.ok,
    "Visit created with all fields",
    `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 300)}`,
  );

  if (res.ok && res.data?.[0]) {
    testVisitId = res.data[0].id;
    assert(!!testVisitId, "Visit ID returned (UUID)");

    // Verify every field round-trips
    const v = res.data[0];
    assert(v.weight_kg === 7.5, "weight_kg saved");
    assert(v.height_cm === 68.0, "height_cm saved");
    assert(v.hc_cm === 43.5, "hc_cm saved");
    assert(v.muac_cm === 14.2, "muac_cm saved");
    assert(v.temp_f === 100.4, "temp_f saved");
    assert(v.hr_per_min === 130, "hr_per_min saved");
    assert(v.rr_per_min === 36, "rr_per_min saved");
    assert(v.spo2_pct === 97, "spo2_pct saved");
    assert(v.bp_systolic === 85, "bp_systolic saved");
    assert(v.bp_diastolic === 55, "bp_diastolic saved");
    assert(v.map_mmhg === 65.0, "map_mmhg saved");
    assert(v.bmi === 16.2, "bmi saved");
    assert(v.vax_schedule === "iap", "vax_schedule saved");
    assert(v.receipt_no === "RKH-RCT-TEST-001", "receipt_no saved");
    assert(v.consultation_fee === 300, "consultation_fee saved");
    assert(v.payment_mode === "cash", "payment_mode saved");
    assert(v.payment_status === "paid", "payment_status saved");
    assert(Array.isArray(v.procedures), "procedures saved as JSONB array");
    assert(Array.isArray(v.attached_documents), "attached_documents saved");
    assert(v.triage_score === 3, "triage_score saved");
  } else {
    console.log("  ⚠ Visit creation failed — remaining tests may fail");
    console.log("  Response:", JSON.stringify(res.data));
  }
}

// ===== TEST 3: Read visit back =====
async function test3_readVisit() {
  console.log("\n--- TEST 3: Read visit back with full SELECT ---");
  if (!testVisitId) {
    console.log("  SKIP (no visit ID)");
    return;
  }

  // Use the same SELECT as prescription-pad loadTodayPatients
  const select =
    "id,patient_id,weight_kg,height_cm,hc_cm,muac_cm,temp_f,hr_per_min,rr_per_min,spo2_pct,bp_systolic,bp_diastolic,map_mmhg,chief_complaints,doctor_id,visit_summary,raw_dictation,attached_documents,vax_schedule,created_at";
  const res = await q(`visits?id=eq.${testVisitId}&select=${select}`);

  assert(res.ok, "Visit read with full SELECT", `HTTP ${res.status}`);
  if (res.ok && res.data?.[0]) {
    const v = res.data[0];
    assert(v.bp_systolic === 85, "bp_systolic readable");
    assert(v.bp_diastolic === 55, "bp_diastolic readable");
    assert(v.map_mmhg === 65.0, "map_mmhg readable");
    assert(v.vax_schedule === "iap", "vax_schedule readable");
    assert(v.raw_dictation === "Test raw dictation", "raw_dictation readable");
    assert(
      v.visit_summary === "Test AI visit summary",
      "visit_summary readable",
    );
    assert(Array.isArray(v.attached_documents), "attached_documents readable");
  }
}

// ===== TEST 4: Create lab result =====
async function test4_createLab() {
  console.log("\n--- TEST 4: Create lab result ---");
  if (!testVisitId) {
    console.log("  SKIP (no visit ID)");
    return;
  }

  const res = await q("lab_results", "POST", {
    patient_id: TEST_PATIENT_ID,
    visit_id: testVisitId,
    test_name: "Hemoglobin",
    value: "11.2",
    value_numeric: 11.2,
    unit: "g/dL",
    flag: "normal",
    test_category: "Hematology",
    reference_range: "11.5-16.5 g/dL",
    test_date: new Date().toISOString().split("T")[0],
    source: "manual",
  });

  assert(
    res.ok,
    "Lab result created",
    `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`,
  );
  if (res.ok && res.data?.[0]) {
    testLabId = res.data[0].id;
    assert(!!testLabId, "Lab result ID returned (UUID)");
    assert(res.data[0].test_name === "Hemoglobin", "test_name saved");
    assert(res.data[0].flag === "normal", "flag saved");
  }
}

// ===== TEST 5: Create vaccination record =====
async function test5_createVax() {
  console.log("\n--- TEST 5: Create vaccination record ---");

  const res = await q("vaccinations", "POST", {
    patient_id: TEST_PATIENT_ID,
    visit_id: testVisitId,
    vaccine_name: "BCG",
    dose_number: 1,
    date_given: "2025-06-16",
    given_by: "integration_test",
    free_or_paid: "free_uip",
  });

  assert(
    res.ok,
    "Vaccination created",
    `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`,
  );
  if (res.ok && res.data?.[0]) {
    testVaxId = res.data[0].id;
    assert(!!testVaxId, "Vaccination ID returned (UUID)");
    assert(res.data[0].vaccine_name === "BCG", "vaccine_name saved");
  }
}

// ===== TEST 6: Create growth record =====
async function test6_createGrowth() {
  console.log("\n--- TEST 6: Create growth record ---");
  if (!testVisitId) {
    console.log("  SKIP (no visit ID)");
    return;
  }

  const res = await q("growth_records", "POST", {
    patient_id: TEST_PATIENT_ID,
    visit_id: testVisitId,
    recorded_date: new Date().toISOString().split("T")[0],
    weight_kg: 7.5,
    height_cm: 68.0,
    hc_cm: 43.5,
    muac_cm: 14.2,
    waz: -0.5,
    haz: -0.3,
    whz: -0.4,
    chart_used: "WHO 2006",
    classification: "Normal",
  });

  assert(
    res.ok,
    "Growth record created",
    `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`,
  );
  if (res.ok && res.data?.[0]) {
    testGrowthId = res.data[0].id;
    assert(!!testGrowthId, "Growth record ID returned (UUID)");
  }
}

// ===== TEST 7: Call generate-prescription Edge Function =====
async function test7_generatePrescription() {
  console.log("\n--- TEST 7: Call generate-prescription Edge Function ---");
  console.log("  (This calls Claude API — may take 15-30 seconds...)");

  const clinicalNote = `${TEST_PREFIX}Arjun Kumar, 9 months, 7.5 kg boy. Guardian: Test Guardian. ALLERGY: Penicillin.
Chief complaints: Fever 3 days, cough, not eating well.
Vitals: Temp 100.4°F, HR 130/min, RR 36/min, SpO₂ 97%, BP 85/55 mmHg, HC 43.5 cm, MUAC 14.2 cm.
Ht 68 cm, BMI 16.2 kg/m².
O/E: Bilateral crepitations, mild chest indrawing. No cyanosis.
Diagnosis: Acute bronchiolitis (J21.9).
Give paracetamol for fever, salbutamol nebulization.

INCLUDE THESE SECTIONS (use clinical note details if mentioned, otherwise populate with age-appropriate normal defaults): investigations, growth assessment, vaccination status (use IAP 2024 ACVIP schedule — includes paid vaccines)
LANGUAGE: Bilingual`;

  const res = await fn("generate-prescription", {
    clinical_note: clinicalNote,
    patient_allergies: ["Penicillin"],
    patient_id: TEST_PATIENT_ID,
  });

  assert(res.ok, "Edge Function returned 200", `HTTP ${res.status}`);

  if (res.ok && res.data) {
    const rx = res.data.prescription;
    assert(!!rx, "Response has prescription object");

    if (rx) {
      // Patient
      assert(!!rx.patient, "Has patient object");
      assert(!!rx.patient?.name, "patient.name present");
      assert(!!rx.patient?.age, "patient.age present");
      assert(rx.patient?.weight_kg > 0, "patient.weight_kg present");

      // Vitals
      assert(!!rx.vitals, "Has vitals object");
      assert(rx.vitals?.temp_f != null, "vitals.temp_f present");

      // Clinical
      assert(!!rx.chief_complaints, "chief_complaints present");
      assert(!!rx.diagnosis, "diagnosis array present");
      assert(Array.isArray(rx.diagnosis), "diagnosis is array");
      if (rx.diagnosis?.length) {
        assert(!!rx.diagnosis[0].icd10, "diagnosis[0].icd10 present");
      }

      // Medicines
      assert(Array.isArray(rx.medicines), "medicines is array");
      if (rx.medicines?.length) {
        const m = rx.medicines[0];
        assert(!!m.row1_en, "medicine row1_en present");
        assert(!!m.row2_en, "medicine row2_en present");
        assert(!!m.row3_hi, "medicine row3_hi (Hindi) present");
        assert(!!m.calc, "medicine calc present");
        assert(!!m.pictogram, "medicine pictogram present");
      }

      // Safety
      assert(!!rx.safety, "safety object present");
      assert(!!rx.safety?.allergy_note, "safety.allergy_note present");
      assert(!!rx.safety?.overall_status, "safety.overall_status present");

      // Warning signs
      assert(Array.isArray(rx.warning_signs), "warning_signs is array");
      if (rx.warning_signs?.length) {
        assert(
          !!rx.warning_signs[0].hi || !!rx.warning_signs[0].en,
          "warning_signs have hi or en",
        );
      }

      // Optional sections
      assert(
        rx.followup_days != null || rx.admission_recommended != null,
        "followup_days or admission_recommended present",
      );
      assert(Array.isArray(rx.counselling), "counselling is array");

      // Growth (requested in INCLUDE SECTIONS)
      assert(!!rx.growth, "growth section present (was requested)");

      // Vaccinations (requested in INCLUDE SECTIONS)
      assert(!!rx.vaccinations, "vaccinations section present (was requested)");

      // NABH
      assert(rx.nabh_compliant === true, "nabh_compliant is true");

      console.log(
        `  ℹ AI generated ${rx.medicines?.length || 0} medicines, ${rx.investigations?.length || 0} investigations`,
      );
      console.log(
        `  ℹ Safety: ${rx.safety?.overall_status}, Allergy: ${rx.safety?.allergy_note}`,
      );
      console.log(`  ℹ Warning signs: ${rx.warning_signs?.length || 0}`);
    }
  } else {
    console.log("  Response:", JSON.stringify(res.data)?.slice(0, 500));
  }
}

// ===== TEST 8: Save prescription =====
async function test8_savePrescription() {
  console.log("\n--- TEST 8: Save prescription to DB ---");
  if (!testVisitId) {
    console.log("  SKIP (no visit ID)");
    return;
  }

  testRxId = "RX-TEST-001";
  const rxPayload = {
    id: testRxId,
    visit_id: testVisitId,
    patient_id: TEST_PATIENT_ID,
    generated_json: {
      patient: { name: "Test", uhid: TEST_PATIENT_ID, age: "9 months" },
      medicines: [
        { row1_en: "PARACETAMOL", row2_en: "test dose", row3_hi: "टेस्ट" },
      ],
      warning_signs: [{ hi: "तेज बुखार", en: "High fever" }],
      admission_recommended: null,
      followup_days: 3,
      safety: { overall_status: "SAFE", allergy_note: "ALLERGY: Penicillin" },
    },
    medicines: [{ row1_en: "PARACETAMOL" }],
    investigations: [],
    is_approved: true,
    approved_by: "DR-LOKENDER",
    approved_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  const res = await q("prescriptions", "POST", rxPayload);
  assert(
    res.ok,
    "Prescription saved",
    `HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`,
  );

  if (res.ok && res.data?.[0]) {
    assert(res.data[0].id === testRxId, "Prescription ID matches");
    assert(res.data[0].is_approved === true, "is_approved saved");
    assert(
      typeof res.data[0].generated_json === "object",
      "generated_json is JSONB",
    );
  }
}

// ===== TEST 9: Read prescription back =====
async function test9_readPrescription() {
  console.log("\n--- TEST 9: Read prescription and verify JSON round-trip ---");
  if (!testRxId) {
    console.log("  SKIP (no Rx ID)");
    return;
  }

  const res = await q(
    `prescriptions?id=eq.${testRxId}&select=id,generated_json,is_approved`,
  );
  assert(res.ok, "Prescription read back", `HTTP ${res.status}`);

  if (res.ok && res.data?.[0]) {
    const g = res.data[0].generated_json;
    assert(!!g, "generated_json present");
    assert(g?.patient?.name === "Test", "patient.name round-trips");
    assert(Array.isArray(g?.medicines), "medicines round-trips as array");
    assert(Array.isArray(g?.warning_signs), "warning_signs round-trips");
    assert(
      g?.warning_signs?.[0]?.hi === "तेज बुखार",
      "Hindi warning sign round-trips",
    );
    assert(g?.followup_days === 3, "followup_days round-trips");
    assert(
      g?.admission_recommended === null,
      "admission_recommended null round-trips",
    );
    assert(g?.safety?.overall_status === "SAFE", "safety round-trips");
  }
}

// ===== TEST 10: Edge Function tools — get_lab_history =====
async function test10_labHistory() {
  console.log(
    "\n--- TEST 10: Verify lab_results readable by Edge Function tools ---",
  );
  if (!testLabId) {
    console.log("  SKIP (no lab ID)");
    return;
  }

  const res = await q(
    `lab_results?patient_id=eq.${TEST_PATIENT_ID}&select=test_name,value,unit,flag,test_date,loinc_code`,
  );
  assert(res.ok, "lab_results query OK", `HTTP ${res.status}`);
  if (res.ok && res.data?.length) {
    assert(res.data[0].test_name === "Hemoglobin", "Lab test_name readable");
    assert(res.data[0].value === "11.2", "Lab value readable");
  }
}

// ===== TEST 11: Cleanup =====
async function test11_cleanup() {
  console.log("\n--- TEST 11: Cleanup test data ---");

  // Delete in reverse FK order
  if (testRxId) {
    const r = await q(`prescriptions?id=eq.${testRxId}`, "DELETE");
    assert(r.ok, "Prescription deleted", `HTTP ${r.status}`);
  }
  if (testLabId) {
    const r = await q(`lab_results?id=eq.${testLabId}`, "DELETE");
    assert(r.ok, "Lab result deleted", `HTTP ${r.status}`);
  }
  if (testVaxId) {
    const r = await q(`vaccinations?id=eq.${testVaxId}`, "DELETE");
    assert(r.ok, "Vaccination deleted", `HTTP ${r.status}`);
  }
  if (testGrowthId) {
    const r = await q(`growth_records?id=eq.${testGrowthId}`, "DELETE");
    assert(r.ok, "Growth record deleted", `HTTP ${r.status}`);
  }
  if (testVisitId) {
    const r = await q(`visits?id=eq.${testVisitId}`, "DELETE");
    assert(r.ok, "Visit deleted", `HTTP ${r.status}`);
  }
  {
    const r = await q(`patients?id=eq.${TEST_PATIENT_ID}`, "DELETE");
    assert(r.ok, "Patient deleted", `HTTP ${r.status}`);
  }

  // Verify cleanup
  const check = await q(`patients?id=eq.${TEST_PATIENT_ID}&select=id`);
  assert(check.ok && check.data?.length === 0, "Patient fully cleaned up");
}

// ===== MAIN =====
async function main() {
  console.log("=".repeat(60));
  console.log("LIVE INTEGRATION TEST — Radhakishan Hospital System");
  console.log("Target:", SB);
  console.log("Time:", new Date().toISOString());
  console.log("=".repeat(60));

  await test1_createPatient();
  await test2_createVisit();
  await test3_readVisit();
  await test4_createLab();
  await test5_createVax();
  await test6_createGrowth();
  await test7_generatePrescription();
  await test8_savePrescription();
  await test9_readPrescription();
  await test10_labHistory();
  await test11_cleanup();

  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach((f, i) =>
      console.log(`  ${i + 1}. ${f.test}: ${f.detail}`),
    );
  } else {
    console.log("\n✓ ALL TESTS PASSED");
  }
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(2);
});
