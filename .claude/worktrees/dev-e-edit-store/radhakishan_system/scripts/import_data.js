#!/usr/bin/env node
/**
 * Radhakishan Hospital — Data Import Script
 * Imports formulary_data.json and standard_prescriptions_data.json into Supabase.
 *
 * Usage: node import_data.js
 * Reads credentials from .env file in project root, or pass as arguments:
 *   node import_data.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
 */

const fs = require("fs");
const path = require("path");

// Load .env file if it exists
const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) process.env[match[1].trim()] = match[2].trim();
    });
}

const SB = process.argv[2] || process.env.SUPABASE_URL;
const KEY = process.argv[3] || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SB || !KEY) {
  console.error("Missing credentials. Either:");
  console.error(
    "  1. Create .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
  console.error("  2. Pass as arguments: node import_data.js <URL> <KEY>");
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
      // Use composite key: diagnosis_name + icd10 (icd10 alone may be duplicated)
      const icd10Filter = proto.icd10
        ? `&icd10=eq.${encodeURIComponent(proto.icd10)}`
        : `&icd10=is.null`;
      const checkRes = await fetch(
        `${SB}/rest/v1/standard_prescriptions?diagnosis_name=eq.${encodeURIComponent(proto.diagnosis_name)}${icd10Filter}&select=id`,
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
