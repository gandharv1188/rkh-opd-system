#!/usr/bin/env node
/**
 * Import SNOMED-CT diagnosis mappings into standard_prescriptions table.
 *
 * Reads snomed_diagnosis_mappings.json and PATCHes each row's snomed_code
 * in the standard_prescriptions table via Supabase REST API.
 *
 * Idempotent: safe to run multiple times.
 *
 * Usage: node radhakishan_system/scripts/import_snomed_diagnosis_mappings.js
 */

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const mappingsPath = path.join(
  __dirname,
  "..",
  "data",
  "snomed_diagnosis_mappings.json",
);
const mappings = JSON.parse(fs.readFileSync(mappingsPath, "utf8"));

async function importMappings() {
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  // Filter to entries with a non-null snomed_code
  const toUpdate = mappings.filter((m) => m.snomed_code !== null);
  console.log(`Total mappings: ${mappings.length}`);
  console.log(`With SNOMED codes: ${toUpdate.length}`);
  console.log(
    `Without SNOMED codes (skipped): ${mappings.length - toUpdate.length}`,
  );
  console.log("");

  // Process in batches of 10 to avoid rate limiting
  const BATCH_SIZE = 10;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (mapping) => {
      try {
        const url = `${SUPABASE_URL}/rest/v1/standard_prescriptions?id=eq.${mapping.id}`;
        const response = await fetch(url, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ snomed_code: mapping.snomed_code }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        updated++;
        if (updated % 50 === 0) {
          console.log(`  Updated ${updated}/${toUpdate.length}...`);
        }
      } catch (err) {
        failed++;
        errors.push({
          id: mapping.id,
          icd10: mapping.icd10,
          diagnosis: mapping.diagnosis_name,
          error: err.message,
        });
      }
    });

    await Promise.all(promises);
  }

  console.log("\n=== Import Summary ===");
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (null SNOMED): ${mappings.length - toUpdate.length}`);
  console.log(`Failed: ${failed}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach((e) =>
      console.log(`  ${e.icd10} (${e.diagnosis}): ${e.error}`),
    );
  }

  console.log("\nDone.");
}

importMappings().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
