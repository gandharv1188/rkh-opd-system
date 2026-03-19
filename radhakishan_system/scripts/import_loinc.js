// Import LOINC v2.82 into Supabase loinc_investigations table
// Filters out survey, claims, veterinary, and research classes
// Run: node radhakishan_system/scripts/import_loinc.js
//
// Requires LOINC CSV at: C:/Users/gandh/Downloads/RADHAKISHAN HOSPITAL/Loinc_2.82/Loinc_2.82/LoincTable/Loinc.csv

const fs = require("fs");

const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const LOINC_CSV =
  "C:/Users/gandh/Downloads/RADHAKISHAN HOSPITAL/Loinc_2.82/Loinc_2.82/LoincTable/Loinc.csv";

// Classes to EXCLUDE
const EXCLUDE_PREFIXES = [
  "SURVEY.",
  "PANEL.SURVEY.",
  "ATTACH.",
  "PANEL.ATTACH.",
  "PHENX",
  "PANEL.PHENX",
  "CLIN.VET",
  "PANEL.CLIN.VET",
  "CLINTRIAL",
  "DOC.REF.CTP",
  "MEPS",
  "PANEL.MEPS",
  "NR STATS",
  "SURVEY", // catch-all for any remaining
];

const EXCLUDE_EXACT = new Set(["PHENX", "CLINTRIAL", "MEPS", "NR STATS"]);

function shouldExclude(cls) {
  if (EXCLUDE_EXACT.has(cls)) return true;
  for (const prefix of EXCLUDE_PREFIXES) {
    if (cls.startsWith(prefix)) return true;
  }
  return false;
}

// CSV parser that handles quoted fields with commas and newlines
function parseLine(line) {
  const fields = [];
  let inQuote = false,
    field = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (c === "," && !inQuote) {
      fields.push(field);
      field = "";
      continue;
    }
    field += c;
  }
  fields.push(field);
  return fields;
}

const CLASS_TYPE_MAP = {
  1: "Laboratory",
  2: "Clinical",
  3: "Claims",
  4: "Survey",
};

// Normalize specimen system to readable name
function normalizeSystem(sys) {
  if (!sys) return null;
  const map = {
    Bld: "Blood",
    Ser: "Serum",
    "Ser/Plas": "Serum/Plasma",
    Plas: "Plasma",
    Urine: "Urine",
    "Urine sed": "Urine sediment",
    CSF: "CSF",
    Stool: "Stool",
    "Body fld": "Body fluid",
    "Synv fld": "Synovial fluid",
    "Amnio fld": "Amniotic fluid",
    "Dial fld prt": "Dialysis fluid",
    Tiss: "Tissue",
    "Bld/Tiss": "Blood/Tissue",
    Isolate: "Isolate",
    XXX: "Unspecified",
    "^Patient": "Patient",
  };
  return map[sys] || sys;
}

async function importLoinc() {
  console.log("Reading LOINC CSV...");
  const csv = fs.readFileSync(LOINC_CSV, "utf8");
  const lines = csv.split("\n");
  const headers = parseLine(lines[0]);

  // Map header names to indexes
  const idx = {};
  headers.forEach((h, i) => {
    idx[h] = i;
  });

  let total = 0,
    included = 0,
    excluded = 0,
    failed = 0;
  const batch = [];
  const BATCH_SIZE = 100;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);
    total++;

    const status = cols[idx.STATUS];
    if (status !== "ACTIVE") {
      excluded++;
      continue;
    }

    const cls = cols[idx.CLASS];
    if (shouldExclude(cls)) {
      excluded++;
      continue;
    }

    const row = {
      loinc_code: cols[idx.LOINC_NUM],
      component: cols[idx.COMPONENT],
      long_name: cols[idx.LONG_COMMON_NAME] || cols[idx.COMPONENT],
      short_name: cols[idx.SHORTNAME] || null,
      display_name: cols[idx.DisplayName] || null,
      consumer_name: cols[idx.CONSUMER_NAME] || null,
      class: cls,
      class_type: CLASS_TYPE_MAP[cols[idx.CLASSTYPE]] || null,
      system_specimen: normalizeSystem(cols[idx.SYSTEM]),
      property: cols[idx.PROPERTY] || null,
      scale: cols[idx.SCALE_TYP] || null,
      method: cols[idx.METHOD_TYP] || null,
      example_units: cols[idx.EXAMPLE_UNITS] || null,
      example_ucum_units: cols[idx.EXAMPLE_UCUM_UNITS] || null,
      order_obs: cols[idx.ORDER_OBS] || null,
      related_names: cols[idx.RELATEDNAMES2] || null,
      common_test_rank: parseInt(cols[idx.COMMON_TEST_RANK]) || 0,
      common_order_rank: parseInt(cols[idx.COMMON_ORDER_RANK]) || 0,
      active: true,
    };

    if (!row.loinc_code || !row.component) {
      excluded++;
      continue;
    }
    batch.push(row);

    if (batch.length >= BATCH_SIZE) {
      const ok = await insertBatch(batch);
      included += ok;
      failed += batch.length - ok;
      batch.length = 0;
      process.stdout.write(
        `\r  Processed ${total} lines, inserted ${included}, excluded ${excluded}, failed ${failed}`,
      );
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    const ok = await insertBatch(batch);
    included += ok;
    failed += batch.length - ok;
  }

  console.log(
    `\n\nDone: ${included} imported, ${excluded} excluded, ${failed} failed (${total} total lines)`,
  );
}

async function insertBatch(rows) {
  try {
    const res = await fetch(SB + "/rest/v1/loinc_investigations", {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) return rows.length;
    const err = await res.text();
    console.error(
      `\nBatch insert error (${res.status}): ${err.substring(0, 200)}`,
    );
    // Try one-by-one fallback
    let ok = 0;
    for (const row of rows) {
      const r2 = await fetch(SB + "/rest/v1/loinc_investigations", {
        method: "POST",
        headers: {
          apikey: KEY,
          Authorization: "Bearer " + KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal,resolution=ignore-duplicates",
        },
        body: JSON.stringify(row),
      });
      if (r2.ok) ok++;
    }
    return ok;
  } catch (e) {
    console.error(`\nBatch error: ${e.message}`);
    return 0;
  }
}

importLoinc();
