#!/usr/bin/env node
/**
 * Radhakishan Hospital — ABDM FHIR Formulary Import
 *
 * Imports all three formulary files into Supabase with data_source tagging:
 *   - formulary_data_ABDM_FHIR.json          → data_source = 'snomed_branded'
 *   - formulary_data_ABDM_FHIR_generics.json → data_source = 'snomed_generic'
 *   - formulary_data_ABDM_FHIR_orphans.json  → data_source = 'orphan'
 *
 * Usage:
 *   node import_formulary_abdm.js
 *   node import_formulary_abdm.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
 *
 * Reads .env from project root if present.
 * Uses upsert (ON CONFLICT generic_name) so it's safe to re-run.
 */

const fs = require("fs");
const path = require("path");

// Load .env
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
    "  1. Create .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
  console.error(
    "  2. Pass as arguments: node import_formulary_abdm.js <URL> <KEY>",
  );
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "..", "data");

const FILES = [
  { file: "formulary_data_ABDM_FHIR.json", source: "snomed_branded" },
  { file: "formulary_data_ABDM_FHIR_generics.json", source: "snomed_generic" },
  { file: "formulary_data_ABDM_FHIR_orphans.json", source: "orphan" },
];

// Map JSON drug object → DB row
function toRow(drug, dataSource) {
  return {
    generic_name: drug.generic_name,
    snomed_code: drug.snomed_code || null,
    drug_class: drug.drug_class || null,
    category: drug.category || null,
    brand_names: drug.brand_names || [],
    therapeutic_use: drug.therapeutic_use || [],
    licensed_in_children:
      drug.licensed_in_children != null ? drug.licensed_in_children : true,
    unlicensed_note: drug.unlicensed_note || null,
    data_source: dataSource,
    formulations: drug.formulations || [],
    dosing_bands: drug.dosing_bands || [],
    renal_adjustment_required: drug.renal_adjustment_required || false,
    renal_bands: drug.renal_bands || [],
    hepatic_adjustment_required: drug.hepatic_adjustment_required || false,
    hepatic_note: drug.hepatic_note || null,
    black_box_warnings: drug.black_box_warnings || [],
    contraindications: drug.contraindications || [],
    cross_reactions: drug.cross_reactions || [],
    interactions: drug.interactions || [],
    monitoring_parameters: drug.monitoring_parameters || [],
    pediatric_specific_warnings: drug.pediatric_specific_warnings || [],
    administration: drug.administration || [],
    food_instructions: drug.food_instructions || null,
    storage_instructions: drug.storage_instructions || null,
    pregnancy_category: drug.pregnancy_category || null,
    lactation_safe: drug.lactation_safe || null,
    lactation_note: drug.lactation_note || null,
    reference_source: drug.reference_source || [],
    last_reviewed_date: drug.last_reviewed_date || null,
    active: drug.active != null ? drug.active : true,
  };
}

async function upsertBatch(rows) {
  const res = await fetch(`${SB}/rest/v1/formulary?on_conflict=generic_name`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upsert failed: ${res.status} — ${err}`);
  }
  return rows.length;
}

async function main() {
  console.log("=== Radhakishan Hospital — ABDM FHIR Formulary Import ===");
  console.log(`URL: ${SB}\n`);

  // Verify connection
  const check = await fetch(`${SB}/rest/v1/formulary?select=id&limit=0`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!check.ok) {
    console.error("Cannot connect:", check.status, await check.text());
    process.exit(1);
  }
  console.log("Connected to Supabase\n");

  let totalImported = 0;

  for (const { file, source } of FILES) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  SKIP: ${file} (not found)`);
      continue;
    }

    const drugs = JSON.parse(fs.readFileSync(filePath, "utf8"));
    console.log(`${file}: ${drugs.length} drugs (${source})`);

    const rows = drugs.map((d) => toRow(d, source));

    // Batch in chunks of 50 (Supabase REST limit is ~1000 but 50 is safer)
    const BATCH = 50;
    let imported = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      try {
        await upsertBatch(batch);
        imported += batch.length;
        process.stdout.write(`  ${imported}/${rows.length}\r`);
      } catch (e) {
        console.error(`\n  Batch error at ${i}: ${e.message}`);
        // Fall back to one-by-one for this batch
        for (const row of batch) {
          try {
            await upsertBatch([row]);
            imported++;
          } catch (e2) {
            console.error(`  FAIL: ${row.generic_name}: ${e2.message}`);
          }
        }
      }
    }
    console.log(`  Done: ${imported} imported                    `);
    totalImported += imported;
  }

  // Verify final count
  const countRes = await fetch(
    `${SB}/rest/v1/formulary?select=data_source&limit=0`,
    {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Prefer: "count=exact",
      },
    },
  );
  const total = countRes.headers.get("content-range")?.split("/")[1] || "?";

  // Get breakdown by data_source
  for (const src of ["snomed_branded", "snomed_generic", "orphan", "manual"]) {
    const r = await fetch(
      `${SB}/rest/v1/formulary?data_source=eq.${src}&select=id&limit=0`,
      {
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          Prefer: "count=exact",
        },
      },
    );
    const c = r.headers.get("content-range")?.split("/")[1] || "0";
    console.log(`  ${src}: ${c}`);
  }

  console.log(`\nTotal in DB: ${total} | Imported this run: ${totalImported}`);
  console.log("\n=== Import complete ===");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
