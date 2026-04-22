#!/usr/bin/env node
/**
 * Live Integration Test — Radhakishan Hospital Prescription System
 * Tests actual Supabase REST API + Edge Functions
 *
 * Usage: node integration_test.js
 *
 * Tests:
 * 1. Create test patient -> verify all fields accepted
 * 2. Create test visit with ALL vitals -> verify all columns exist in live DB
 * 3. Read visit back -> verify all fields returned
 * 4. Create lab results -> verify schema
 * 5. Create vaccination record -> verify schema
 * 6. Create growth record -> verify schema
 * 7. Formulary structure: branded drug (AMOXICILLIN) new ABDM FHIR fields
 * 8. Formulary structure: generic drug (data_source = snomed_generic)
 * 9. Formulary structure: orphan drug (data_source = orphan)
 * 10. Standard Rx: snomed_code present on diagnosis protocol
 * 11. Drug name consistency: standard_prescriptions drugs exist in formulary
 * 12. Call generate-prescription Edge Function -> verify response structure
 * 13. Save prescription -> verify all fields
 * 14. Read prescription back -> verify generated_json round-trip
 * 15. Edge Function tools - get_lab_history
 * 16. Clean up all test data
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
    console.log(`  + PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  x FAIL: ${testName} -- ${detail || ""}`);
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
    console.log("  ! Visit creation failed -- remaining tests may fail");
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

// ===== TEST 7: Formulary structure — branded drug (ABDM FHIR) =====
async function test7_formularyBranded() {
  console.log(
    "\n--- TEST 7: Formulary structure -- branded drug (AMOXICILLIN) ---",
  );

  const res = await q(
    `formulary?generic_name=ilike.*amoxicillin*&select=generic_name,snomed_code,snomed_display,data_source,formulations,dosing_bands&limit=1`,
  );

  assert(res.ok, "Formulary query OK", `HTTP ${res.status}`);

  if (!res.ok || !res.data?.length) {
    console.log(
      "  ! Could not find AMOXICILLIN in formulary -- skipping sub-tests",
    );
    console.log("  Response:", JSON.stringify(res.data)?.slice(0, 300));
    return;
  }

  const drug = res.data[0];
  console.log(`  (Found: ${drug.generic_name})`);

  // snomed_code must be present
  assert(
    drug.snomed_code != null && drug.snomed_code !== "",
    "snomed_code is not null",
    `Got: ${drug.snomed_code}`,
  );

  // data_source should be snomed_branded
  assert(
    drug.data_source === "snomed_branded",
    "data_source is 'snomed_branded'",
    `Got: ${drug.data_source}`,
  );

  // formulations must be array with at least 1 entry
  assert(
    Array.isArray(drug.formulations) && drug.formulations.length >= 1,
    "formulations is array with >= 1 entry",
    `Got: ${Array.isArray(drug.formulations) ? drug.formulations.length + " entries" : typeof drug.formulations}`,
  );

  if (Array.isArray(drug.formulations) && drug.formulations.length > 0) {
    const f = drug.formulations[0];

    // Each formulation has ingredients[] array
    assert(
      Array.isArray(f.ingredients) && f.ingredients.length >= 1,
      "formulation[0].ingredients is array with >= 1 entry",
      `Got: ${Array.isArray(f.ingredients) ? f.ingredients.length + " ingredients" : typeof f.ingredients}`,
    );

    if (Array.isArray(f.ingredients) && f.ingredients.length > 0) {
      const ing = f.ingredients[0];

      // Each ingredient has strength_numerator and strength_numerator_unit
      assert(
        ing.strength_numerator != null &&
          typeof ing.strength_numerator === "number",
        "ingredient[0].strength_numerator is a number",
        `Got: ${ing.strength_numerator} (${typeof ing.strength_numerator})`,
      );
      assert(
        typeof ing.strength_numerator_unit === "string" &&
          ing.strength_numerator_unit.length > 0,
        "ingredient[0].strength_numerator_unit is non-empty string",
        `Got: ${ing.strength_numerator_unit}`,
      );
    }

    // indian_brands[] array
    assert(
      Array.isArray(f.indian_brands),
      "formulation[0].indian_brands is array",
      `Got: ${typeof f.indian_brands}`,
    );

    if (Array.isArray(f.indian_brands) && f.indian_brands.length > 0) {
      const brand = f.indian_brands[0];
      assert(
        typeof brand.name === "string" && brand.name.length > 0,
        "indian_brands[0].name is non-empty string",
        `Got: ${brand.name}`,
      );
      assert(
        brand.manufacturer !== undefined,
        "indian_brands[0].manufacturer field exists",
        `Got: ${brand.manufacturer}`,
      );
      assert(
        brand.snomed_code !== undefined,
        "indian_brands[0].snomed_code field exists",
        `Got: ${brand.snomed_code}`,
      );
    }
  }

  // dosing_bands must be array with at least 1 entry
  assert(
    Array.isArray(drug.dosing_bands) && drug.dosing_bands.length >= 1,
    "dosing_bands is array with >= 1 entry",
    `Got: ${Array.isArray(drug.dosing_bands) ? drug.dosing_bands.length + " bands" : typeof drug.dosing_bands}`,
  );

  if (Array.isArray(drug.dosing_bands) && drug.dosing_bands.length > 0) {
    const band = drug.dosing_bands[0];
    assert(
      typeof band.age_band === "string" && band.age_band.length > 0,
      "dosing_band[0].age_band is non-empty string",
      `Got: ${band.age_band}`,
    );
    assert(
      typeof band.method === "string" && band.method.length > 0,
      "dosing_band[0].method is non-empty string",
      `Got: ${band.method}`,
    );

    // NEW: ingredient_doses[] structure
    assert(
      Array.isArray(band.ingredient_doses) && band.ingredient_doses.length >= 1,
      "dosing_band[0].ingredient_doses is array with >= 1 entry",
      `Got: ${Array.isArray(band.ingredient_doses) ? band.ingredient_doses.length + " entries" : typeof band.ingredient_doses}`,
    );

    if (
      Array.isArray(band.ingredient_doses) &&
      band.ingredient_doses.length > 0
    ) {
      const id = band.ingredient_doses[0];
      assert(
        typeof id.ingredient === "string" && id.ingredient.length > 0,
        "ingredient_doses[0].ingredient is non-empty string",
        `Got: ${id.ingredient}`,
      );
      assert(
        id.dose_min_qty != null ||
          id.dose_unit === "excipient" ||
          id.dose_unit === "vehicle",
        "ingredient_doses[0].dose_min_qty exists or is excipient/vehicle",
        `Got: dose_min=${id.dose_min_qty}, unit=${id.dose_unit}`,
      );
      assert(
        typeof id.is_limiting === "boolean",
        "ingredient_doses[0].is_limiting is boolean",
        `Got: ${id.is_limiting}`,
      );

      // At least one ingredient should be limiting
      const hasLimiting = band.ingredient_doses.some((d) => d.is_limiting);
      assert(
        hasLimiting,
        "At least one ingredient_dose is_limiting=true",
        `Got: ${band.ingredient_doses.map((d) => d.ingredient + ":" + d.is_limiting).join(", ")}`,
      );
    }

    // Verify OLD band-level fields are REMOVED
    assert(
      band.dose_min_qty === undefined,
      "OLD band.dose_min_qty is REMOVED (migrated to ingredient_doses)",
      `Got: ${band.dose_min_qty}`,
    );
    assert(
      band.max_single_qty === undefined,
      "OLD band.max_single_qty is REMOVED (migrated to ingredient_doses)",
      `Got: ${band.max_single_qty}`,
    );
  }

  console.log(
    `  i ${drug.formulations?.length || 0} formulations, ${drug.dosing_bands?.length || 0} dosing bands`,
  );
}

// ===== TEST 8: Formulary structure — generic drug =====
async function test8_formularyGeneric() {
  console.log(
    "\n--- TEST 8: Formulary structure -- generic drug (snomed_generic) ---",
  );

  const res = await q(
    `formulary?data_source=eq.snomed_generic&select=generic_name,snomed_code,data_source,formulations,dosing_bands&limit=1`,
  );

  assert(res.ok, "Formulary generic query OK", `HTTP ${res.status}`);

  if (!res.ok || !res.data?.length) {
    console.log("  ! No snomed_generic drugs found -- skipping sub-tests");
    return;
  }

  const drug = res.data[0];
  console.log(`  (Found: ${drug.generic_name})`);

  assert(
    drug.data_source === "snomed_generic",
    "data_source is 'snomed_generic'",
    `Got: ${drug.data_source}`,
  );
  assert(
    drug.snomed_code != null && drug.snomed_code !== "",
    "snomed_code is not null for generic drug",
    `Got: ${drug.snomed_code}`,
  );
  assert(
    Array.isArray(drug.formulations) && drug.formulations.length >= 1,
    "Generic drug has formulations[]",
    `Got: ${drug.formulations?.length || 0} entries`,
  );
  assert(
    Array.isArray(drug.dosing_bands) && drug.dosing_bands.length >= 1,
    "Generic drug has dosing_bands[]",
    `Got: ${drug.dosing_bands?.length || 0} bands`,
  );
}

// ===== TEST 9: Formulary structure — orphan drug =====
async function test9_formularyOrphan() {
  console.log("\n--- TEST 9: Formulary structure -- orphan drug ---");

  const res = await q(
    `formulary?data_source=eq.orphan&select=generic_name,snomed_code,data_source,formulations,dosing_bands&limit=1`,
  );

  assert(res.ok, "Formulary orphan query OK", `HTTP ${res.status}`);

  if (!res.ok || !res.data?.length) {
    console.log("  ! No orphan drugs found -- skipping sub-tests");
    return;
  }

  const drug = res.data[0];
  console.log(`  (Found: ${drug.generic_name})`);

  assert(
    drug.data_source === "orphan",
    "data_source is 'orphan'",
    `Got: ${drug.data_source}`,
  );
  // Orphan drugs may or may not have snomed_code (many are null)
  assert(
    drug.snomed_code === null || typeof drug.snomed_code === "string",
    "Orphan snomed_code is null or string (acceptable)",
    `Got: ${drug.snomed_code}`,
  );
  assert(
    Array.isArray(drug.formulations),
    "Orphan drug has formulations array",
    `Got: ${typeof drug.formulations}`,
  );
}

// ===== TEST 10: Standard Rx — snomed_code for diagnosis =====
async function test10_standardRxSnomed() {
  console.log(
    "\n--- TEST 10: Standard Rx -- snomed_code on diagnosis protocol ---",
  );

  // Pick a common diagnosis that should have snomed_code
  const res = await q(
    `standard_prescriptions?snomed_code=not.is.null&select=icd10,diagnosis_name,snomed_code,first_line_drugs,category&limit=3`,
  );

  assert(res.ok, "Standard Rx query OK", `HTTP ${res.status}`);

  if (!res.ok || !res.data?.length) {
    console.log("  ! No standard prescriptions with snomed_code found");
    return;
  }

  const rx = res.data[0];
  console.log(`  (Found: ${rx.icd10} - ${rx.diagnosis_name})`);

  assert(
    rx.snomed_code != null && rx.snomed_code !== "",
    "snomed_code is not null on standard_prescription",
    `Got: ${rx.snomed_code}`,
  );
  assert(
    typeof rx.diagnosis_name === "string" && rx.diagnosis_name.length > 0,
    "diagnosis_name is non-empty string",
    `Got: ${rx.diagnosis_name}`,
  );
  assert(
    Array.isArray(rx.first_line_drugs) && rx.first_line_drugs.length >= 1,
    "first_line_drugs is array with entries",
    `Got: ${rx.first_line_drugs?.length || 0} drugs`,
  );

  // Verify first_line_drugs have .drug field
  if (rx.first_line_drugs?.length > 0) {
    assert(
      typeof rx.first_line_drugs[0].drug === "string",
      "first_line_drugs[0].drug is string",
      `Got: ${rx.first_line_drugs[0].drug}`,
    );
  }

  // Count total protocols with snomed_code
  const countRes = await q(
    `standard_prescriptions?snomed_code=not.is.null&select=id`,
  );
  if (countRes.ok) {
    console.log(`  i ${countRes.data?.length || 0} protocols have snomed_code`);
  }
}

// ===== TEST 11: Drug name consistency — std_rx drugs exist in formulary =====
async function test11_drugNameConsistency() {
  console.log(
    "\n--- TEST 11: Drug name consistency -- std_rx drugs in formulary ---",
  );

  // Fetch 5 standard prescriptions to extract drug names
  const rxRes = await q(
    `standard_prescriptions?active=eq.true&first_line_drugs=not.is.null&select=icd10,diagnosis_name,first_line_drugs&limit=5`,
  );

  assert(
    rxRes.ok,
    "Standard Rx query for drug names OK",
    `HTTP ${rxRes.status}`,
  );

  if (!rxRes.ok || !rxRes.data?.length) {
    console.log("  ! No standard prescriptions found -- skipping");
    return;
  }

  // Collect unique drug names from first_line_drugs
  const drugNames = new Set();
  for (const rx of rxRes.data) {
    if (Array.isArray(rx.first_line_drugs)) {
      for (const d of rx.first_line_drugs) {
        if (d.drug) drugNames.add(d.drug);
      }
    }
  }

  // Pick up to 5 drug names to check
  const sampled = [...drugNames].slice(0, 5);
  console.log(`  Checking ${sampled.length} drugs: ${sampled.join(", ")}`);

  let matchCount = 0;
  let skipCount = 0;
  for (const drugName of sampled) {
    // Some entries are non-drug items (e.g., "Honey + Warm Fluids", "Karvol Plus Capsule (Inhalation)")
    // These won't match formulary. Only flag actual drug names as failures.
    const isLikelyNonDrug =
      /honey|warm fluid|karvol|cough management|inhalation cloth|counsell/i.test(
        drugName,
      );

    const fRes = await q(
      `formulary?generic_name=ilike.*${encodeURIComponent(drugName.split("/")[0].split("(")[0].trim())}*&select=generic_name&limit=1`,
    );

    if (fRes.ok && fRes.data?.length > 0) {
      console.log(`  + MATCH: "${drugName}" -> "${fRes.data[0].generic_name}"`);
      matchCount++;
    } else if (isLikelyNonDrug) {
      console.log(`  ~ SKIP (non-drug): "${drugName}"`);
      skipCount++;
    } else {
      console.log(
        `  ? MISS: "${drugName}" not found in formulary (may be non-pharmacological)`,
      );
    }
  }

  assert(
    matchCount > 0,
    `At least 1 of ${sampled.length} drugs found in formulary`,
    `${matchCount} matched, ${skipCount} non-drug skipped`,
  );
}

// ===== TEST 12: Call generate-prescription Edge Function =====
async function test12_generatePrescription() {
  console.log("\n--- TEST 12: Call generate-prescription Edge Function ---");
  console.log("  (This calls Claude API -- may take 15-30 seconds...)");

  const clinicalNote = `${TEST_PREFIX}Arjun Kumar, 9 months, 7.5 kg boy. Guardian: Test Guardian. ALLERGY: Penicillin.
Chief complaints: Fever 3 days, cough, not eating well.
Vitals: Temp 100.4F, HR 130/min, RR 36/min, SpO2 97%, BP 85/55 mmHg, HC 43.5 cm, MUAC 14.2 cm.
Ht 68 cm, BMI 16.2 kg/m2.
O/E: Bilateral crepitations, mild chest indrawing. No cyanosis.
Diagnosis: Acute bronchiolitis (J21.9).
Give paracetamol for fever, salbutamol nebulization.

INCLUDE THESE SECTIONS (use clinical note details if mentioned, otherwise populate with age-appropriate normal defaults): investigations, growth assessment, vaccination status (use IAP 2024 ACVIP schedule -- includes paid vaccines)
LANGUAGE: Bilingual`;

  const res = await fn("generate-prescription", {
    clinical_note: clinicalNote,
    patient_allergies: ["Penicillin"],
    patient_id: TEST_PATIENT_ID,
  });

  assert(res.ok, "Edge Function returned 200", `HTTP ${res.status}`);

  if (res.ok && res.data) {
    console.log("  i Response keys:", Object.keys(res.data).join(", "));
    // Edge Function may wrap in { prescription: {...} } or return flat
    const rx = res.data.prescription || res.data;
    if (res.data.prescription) {
      console.log(
        "  i Prescription keys:",
        Object.keys(rx).slice(0, 15).join(", "),
      );
    } else {
      console.log(
        "  i (no .prescription wrapper) Top keys:",
        Object.keys(rx).slice(0, 15).join(", "),
      );
    }
    assert(!!rx, "Response has prescription data");

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

      // NEW: non_pharmacological[] (may be empty array or populated)
      assert(
        Array.isArray(rx.non_pharmacological) ||
          rx.non_pharmacological === undefined,
        "non_pharmacological is array or absent",
        `Got: ${typeof rx.non_pharmacological}`,
      );
      if (
        Array.isArray(rx.non_pharmacological) &&
        rx.non_pharmacological.length > 0
      ) {
        const np = rx.non_pharmacological[0];
        assert(
          typeof np.instruction === "string",
          "non_pharmacological[0].instruction is string",
          `Got: ${np.instruction}`,
        );
        assert(
          typeof np.category === "string",
          "non_pharmacological[0].category is string (diet/therapy/procedure/lifestyle)",
          `Got: ${np.category}`,
        );
        console.log(
          `  i non_pharmacological: ${rx.non_pharmacological.length} items`,
        );
      } else {
        console.log(
          "  i non_pharmacological: empty or absent (acceptable for this case)",
        );
      }

      console.log(
        `  i AI generated ${rx.medicines?.length || 0} medicines, ${rx.investigations?.length || 0} investigations`,
      );
      console.log(
        `  i Safety: ${rx.safety?.overall_status}, Allergy: ${rx.safety?.allergy_note}`,
      );
      console.log(`  i Warning signs: ${rx.warning_signs?.length || 0}`);
    }
  } else {
    console.log("  Response:", JSON.stringify(res.data)?.slice(0, 500));
  }
}

// ===== TEST 13: Save prescription =====
async function test13_savePrescription() {
  console.log("\n--- TEST 13: Save prescription to DB ---");
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
        { row1_en: "PARACETAMOL", row2_en: "test dose", row3_hi: "test" },
      ],
      non_pharmacological: [
        {
          instruction: "Tepid sponging for fever",
          instruction_hi: "test",
          category: "therapy",
        },
      ],
      warning_signs: [{ hi: "test", en: "High fever" }],
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

// ===== TEST 14: Read prescription back =====
async function test14_readPrescription() {
  console.log(
    "\n--- TEST 14: Read prescription and verify JSON round-trip ---",
  );
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
      g?.warning_signs?.[0]?.en === "High fever",
      "English warning sign round-trips",
    );
    assert(g?.followup_days === 3, "followup_days round-trips");
    assert(
      g?.admission_recommended === null,
      "admission_recommended null round-trips",
    );
    assert(g?.safety?.overall_status === "SAFE", "safety round-trips");

    // NEW: non_pharmacological round-trip
    assert(
      Array.isArray(g?.non_pharmacological),
      "non_pharmacological round-trips as array",
    );
    if (g?.non_pharmacological?.length > 0) {
      assert(
        g.non_pharmacological[0].instruction === "Tepid sponging for fever",
        "non_pharmacological[0].instruction round-trips",
      );
      assert(
        g.non_pharmacological[0].category === "therapy",
        "non_pharmacological[0].category round-trips",
      );
    }
  }
}

// ===== TEST 15: Edge Function tools — get_lab_history =====
async function test15_labHistory() {
  console.log(
    "\n--- TEST 15: Verify lab_results readable by Edge Function tools ---",
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

// ===== TEST 16: Cleanup =====
async function test16_cleanup() {
  console.log("\n--- TEST 16: Cleanup test data ---");

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
  console.log("LIVE INTEGRATION TEST -- Radhakishan Hospital System");
  console.log("Target:", SB);
  console.log("Time:", new Date().toISOString());
  console.log("=".repeat(60));

  await test1_createPatient();
  await test2_createVisit();
  await test3_readVisit();
  await test4_createLab();
  await test5_createVax();
  await test6_createGrowth();
  await test7_formularyBranded();
  await test8_formularyGeneric();
  await test9_formularyOrphan();
  await test10_standardRxSnomed();
  await test11_drugNameConsistency();
  await test12_generatePrescription();
  await test13_savePrescription();
  await test14_readPrescription();
  await test15_labHistory();
  await test16_cleanup();

  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach((f, i) =>
      console.log(`  ${i + 1}. ${f.test}: ${f.detail}`),
    );
  } else {
    console.log("\n+ ALL TESTS PASSED");
  }
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(2);
});
