#!/usr/bin/env node
/**
 * Radhakishan Hospital — SNOMED-CT Drug Mapping Import Script
 * Reads snomed_drug_mappings.json and PATCHes formulary rows with snomed_code + snomed_display.
 *
 * Usage: node import_snomed_mappings.js
 * Idempotent — safe to run multiple times.
 */

const fs = require("fs");
const path = require("path");

const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

async function main() {
  console.log("=== SNOMED-CT Drug Mapping Import ===");
  console.log(`URL: ${SB}\n`);

  // Verify connection
  try {
    const res = await fetch(`${SB}/rest/v1/formulary?select=count&limit=0`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const count = res.headers.get("content-range")?.split("/")[1] || "?";
    console.log(`Connected. Formulary has ${count} rows.\n`);
  } catch (e) {
    console.error("Cannot connect to Supabase:", e.message);
    process.exit(1);
  }

  // Load mappings
  const dataPath = path.join(
    __dirname,
    "..",
    "data",
    "snomed_drug_mappings.json",
  );
  const mappings = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded ${mappings.length} drug mappings.\n`);

  let updated = 0,
    skipped = 0,
    failed = 0;

  for (const entry of mappings) {
    // Skip null SNOMED codes
    if (!entry.snomed_code) {
      skipped++;
      continue;
    }

    try {
      const url = `${SB}/rest/v1/formulary?generic_name=ilike.${encodeURIComponent(entry.generic_name)}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          snomed_code: entry.snomed_code,
          snomed_display: entry.snomed_display,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`${res.status} — ${err}`);
      }

      console.log(
        `Updated ${entry.generic_name} → ${entry.snomed_code} (${entry.snomed_display})`,
      );
      updated++;
    } catch (e) {
      console.error(`FAILED ${entry.generic_name}: ${e.message}`);
      failed++;
    }
  }

  console.log("\n=== Import Summary ===");
  console.log(`${updated} drugs mapped`);
  console.log(`${skipped} skipped (no SNOMED code)`);
  console.log(`${failed} failed`);
  console.log(`Total: ${mappings.length}`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
