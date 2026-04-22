// Import formulary_data_2.json (122 new drugs) into Supabase formulary table
// Run: node radhakishan_system/scripts/import_formulary_2.js

const fs = require("fs");

const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const drugs = JSON.parse(
  fs.readFileSync("radhakishan_system/data/formulary_data_2.json", "utf8"),
);

async function importDrugs() {
  let success = 0,
    skipped = 0,
    failed = 0;

  for (const drug of drugs) {
    const payload = {
      generic_name: drug.generic_name,
      drug_class: drug.drug_class || null,
      category: drug.category || null,
      brand_names: drug.brand_names || null,
      therapeutic_use: drug.therapeutic_use || null,
      licensed_in_children: drug.licensed_in_children || "true",
      formulations: drug.formulations || null,
      dosing_bands: drug.dosing_bands || null,
      renal_adjustment_required: drug.renal_adjustment_required || false,
      renal_bands: drug.renal_bands || null,
      hepatic_adjustment_required: drug.hepatic_adjustment_required || false,
      hepatic_note: drug.hepatic_note || null,
      black_box_warnings: drug.black_box_warnings || null,
      contraindications: drug.contraindications || null,
      interactions: drug.interactions || null,
      monitoring_parameters: drug.monitoring_parameters || null,
      pediatric_specific_warnings: drug.pediatric_specific_warnings || null,
      administration: drug.administration || null,
      food_instructions: drug.food_instructions || null,
      storage_instructions: drug.storage_instructions || null,
      reference_source: drug.reference_source || null,
      notes: drug.notes || null,
      snomed_code: drug.snomed_code || null,
      snomed_display: drug.snomed_display || null,
      active: true,
    };

    try {
      const res = await fetch(SB + "/rest/v1/formulary", {
        method: "POST",
        headers: {
          apikey: KEY,
          Authorization: "Bearer " + KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        success++;
        console.log(`✓ ${drug.generic_name}`);
      } else if (res.status === 409) {
        skipped++;
        console.log(`⊘ ${drug.generic_name} (already exists)`);
      } else {
        const err = await res.text();
        failed++;
        console.log(
          `✗ ${drug.generic_name}: ${res.status} ${err.substring(0, 100)}`,
        );
      }
    } catch (e) {
      failed++;
      console.log(`✗ ${drug.generic_name}: ${e.message}`);
    }
  }

  console.log(
    `\nDone: ${success} imported, ${skipped} skipped, ${failed} failed (total ${drugs.length})`,
  );
}

importDrugs();
