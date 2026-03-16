#!/usr/bin/env node
/**
 * Radhakishan Hospital — Data Import Script
 * Imports formulary_data.json and standard_prescriptions_data.json into Supabase.
 *
 * Usage: node import_data.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
 */

const fs = require("fs");
const path = require("path");

const SB = process.argv[2];
const KEY = process.argv[3];

if (!SB || !KEY) {
  console.error("Usage: node import_data.js <SUPABASE_URL> <SERVICE_ROLE_KEY>");
  console.error(
    "Example: node import_data.js https://xxx.supabase.co eyJhbG...",
  );
  process.exit(1);
}

async function q(table, method, body) {
  const res = await fetch(`${SB}/rest/v1/${table}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${method} ${table}: ${res.status} — ${err}`);
  }
  return res;
}

async function importFormulary() {
  const dataPath = path.join(__dirname, "..", "data", "formulary_data.json");
  const drugs = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`\nImporting ${drugs.length} drugs into formulary...`);

  let success = 0,
    failed = 0;
  for (const drug of drugs) {
    try {
      // Check if exists
      const checkRes = await fetch(
        `${SB}/rest/v1/formulary?generic_name=eq.${encodeURIComponent(drug.generic_name)}&select=id`,
        {
          headers: {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`,
          },
        },
      );
      const existing = await checkRes.json();

      if (existing.length > 0) {
        // Update
        await q(`formulary?id=eq.${existing[0].id}`, "PATCH", drug);
        process.stdout.write("U");
      } else {
        // Insert
        await q("formulary", "POST", drug);
        process.stdout.write(".");
      }
      success++;
    } catch (e) {
      process.stdout.write("X");
      failed++;
      if (failed <= 3)
        console.error(`\n  Error: ${drug.generic_name}: ${e.message}`);
    }
  }
  console.log(`\nFormulary: ${success} imported, ${failed} failed.`);
}

async function importStandardPrescriptions() {
  const dataPath = path.join(
    __dirname,
    "..",
    "data",
    "standard_prescriptions_data.json",
  );
  const protocols = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`\nImporting ${protocols.length} standard prescriptions...`);

  let success = 0,
    failed = 0;
  for (const proto of protocols) {
    try {
      // Use diagnosis_name as the unique key (icd10 may be duplicated)
      const checkRes = await fetch(
        `${SB}/rest/v1/standard_prescriptions?diagnosis_name=eq.${encodeURIComponent(proto.diagnosis_name)}&select=id`,
        {
          headers: {
            apikey: KEY,
            Authorization: `Bearer ${KEY}`,
          },
        },
      );
      const existing = await checkRes.json();

      if (existing.length > 0) {
        await q(
          `standard_prescriptions?id=eq.${existing[0].id}`,
          "PATCH",
          proto,
        );
        process.stdout.write("U");
      } else {
        await q("standard_prescriptions", "POST", proto);
        process.stdout.write(".");
      }
      success++;
    } catch (e) {
      process.stdout.write("X");
      failed++;
      if (failed <= 3)
        console.error(`\n  Error: ${proto.diagnosis_name}: ${e.message}`);
    }
  }
  console.log(
    `\nStandard prescriptions: ${success} imported, ${failed} failed.`,
  );
}

async function verifyTables() {
  console.log("\nVerifying tables...");
  const tables = [
    "formulary",
    "doctors",
    "standard_prescriptions",
    "patients",
    "visits",
    "prescriptions",
    "vaccinations",
    "growth_records",
    "developmental_screenings",
  ];

  for (const table of tables) {
    try {
      const res = await fetch(`${SB}/rest/v1/${table}?select=count&limit=0`, {
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          Prefer: "count=exact",
        },
      });
      const count = res.headers.get("content-range")?.split("/")[1] || "?";
      console.log(`  ✓ ${table}: ${count} rows`);
    } catch (e) {
      console.log(`  ✗ ${table}: ${e.message}`);
    }
  }
}

async function main() {
  console.log("=== Radhakishan Hospital — Supabase Data Import ===");
  console.log(`URL: ${SB}`);

  // Verify connection
  try {
    const res = await fetch(`${SB}/rest/v1/`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log("✓ Connected to Supabase");
  } catch (e) {
    console.error("✗ Cannot connect to Supabase:", e.message);
    process.exit(1);
  }

  await importFormulary();
  await importStandardPrescriptions();
  await verifyTables();

  console.log("\n=== Import complete ===");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
