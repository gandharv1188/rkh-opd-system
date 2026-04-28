#!/usr/bin/env node
/**
 * Radhakishan Hospital — Supabase Health Check
 *
 * Run:
 *   node --env-file=.env radhakishan_system/scripts/health_check.js
 *
 * Reads SUPABASE_ANON_KEY from .env. Project URL is hardcoded
 * (it's public — present in every web/*.html file).
 *
 * Read-only. No writes, no deletes.
 */

const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY = process.env.SUPABASE_ANON_KEY;

if (!KEY) {
  console.error("ERROR: SUPABASE_ANON_KEY not set.");
  console.error("Run with: node --env-file=.env radhakishan_system/scripts/health_check.js");
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

// ---------- helpers ----------
const pad = (s, n) => String(s).padEnd(n);
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const grn = (s) => `\x1b[32m${s}\x1b[0m`;
const yel = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

async function rest(path, extraHeaders = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { ...H, ...extraHeaders },
  });
  return r;
}

async function count(table, filter = "") {
  const path = `${table}?select=*${filter ? "&" + filter : ""}`;
  const r = await rest(path, { Prefer: "count=exact", Range: "0-0" });
  if (!r.ok) return { error: `${r.status} ${await r.text()}`.slice(0, 80) };
  const range = r.headers.get("content-range") || "";
  const total = parseInt(range.split("/")[1], 10);
  return { total: Number.isFinite(total) ? total : 0 };
}

function section(title) {
  console.log("\n" + bold(cyan(`━━━ ${title} ━━━`)));
}

// ---------- checks ----------
async function checkTableCounts() {
  section("1. Row counts (12 tables)");
  const tables = [
    "patients", "visits", "prescriptions", "doctors",
    "formulary", "standard_prescriptions",
    "vaccinations", "growth_records", "lab_results",
    "developmental_screenings",
    "abdm_care_contexts", "abdm_consent_artefacts",
  ];
  for (const t of tables) {
    const { total, error } = await count(t);
    if (error) console.log(`  ${pad(t, 28)} ${red("ERR")} ${dim(error)}`);
    else console.log(`  ${pad(t, 28)} ${grn(String(total).padStart(7))}`);
  }
}

async function checkRecentActivity() {
  section("2. Recent activity");
  const now = new Date();
  const d7 = new Date(now - 7 * 864e5).toISOString();
  const d30 = new Date(now - 30 * 864e5).toISOString();

  const buckets = [
    ["visits last 7d",         "visits",        `created_at=gte.${d7}`],
    ["visits last 30d",        "visits",        `created_at=gte.${d30}`],
    ["prescriptions last 7d",  "prescriptions", `created_at=gte.${d7}`],
    ["prescriptions last 30d", "prescriptions", `created_at=gte.${d30}`],
    ["new patients last 30d",  "patients",      `created_at=gte.${d30}`],
  ];
  for (const [label, table, f] of buckets) {
    const { total, error } = await count(table, f);
    if (error) console.log(`  ${pad(label, 28)} ${red("ERR")} ${dim(error)}`);
    else console.log(`  ${pad(label, 28)} ${grn(String(total).padStart(7))}`);
  }
}

async function checkOrphans() {
  section("3. Orphans / referential integrity");

  // visits with null patient_id (schema says NOT NULL — should be 0)
  const v = await count("visits", "patient_id=is.null");
  console.log(`  visits w/ null patient_id     ${(v.total === 0 ? grn : red)(String(v.total ?? "ERR").padStart(7))}  ${dim("(schema: NOT NULL)")}`);

  // prescriptions with null visit_id / patient_id (NOT NULL)
  const pV = await count("prescriptions", "visit_id=is.null");
  const pP = await count("prescriptions", "patient_id=is.null");
  console.log(`  prescriptions w/ null visit_id ${(pV.total === 0 ? grn : red)(String(pV.total ?? "ERR").padStart(6))}  ${dim("(schema: NOT NULL)")}`);
  console.log(`  prescriptions w/ null patient  ${(pP.total === 0 ? grn : red)(String(pP.total ?? "ERR").padStart(6))}  ${dim("(schema: NOT NULL)")}`);

  // lab_results without visit
  const lr = await count("lab_results", "visit_id=is.null");
  console.log(`  lab_results w/ null visit_id  ${(lr.total === 0 ? grn : yel)(String(lr.total ?? "ERR").padStart(7))}`);

  // patients without UHID
  const noUhid = await count("patients", "uhid=is.null");
  console.log(`  patients w/ null uhid         ${(noUhid.total === 0 ? grn : red)(String(noUhid.total ?? "ERR").padStart(7))}`);
}

async function checkPatientHealth() {
  section("4. Patients");
  const active = await count("patients", "is_active=eq.true");
  const inactive = await count("patients", "is_active=eq.false");
  const abhaVerified = await count("patients", "abha_verified=eq.true");
  const total = (active.total ?? 0) + (inactive.total ?? 0);
  console.log(`  active                        ${grn(String(active.total ?? "ERR").padStart(7))}`);
  console.log(`  inactive (soft-deleted)       ${dim(String(inactive.total ?? "ERR").padStart(7))}`);
  console.log(`  abha_verified                 ${grn(String(abhaVerified.total ?? "ERR").padStart(7))}  ${dim(total ? `(${((abhaVerified.total/total)*100).toFixed(1)}% of all)` : "")}`);
}

async function checkPrescriptionStatus() {
  section("5. Prescription status breakdown");
  const r = await rest("prescriptions?select=approval_status");
  if (!r.ok) {
    console.log(`  ${red("ERR")} ${dim(await r.text())}`);
    return;
  }
  const rows = await r.json();
  const counts = {};
  for (const row of rows) {
    const s = row.approval_status || "(null)";
    counts[s] = (counts[s] || 0) + 1;
  }
  for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(s, 28)} ${grn(String(n).padStart(7))}`);
  }
  console.log(`  ${pad("TOTAL", 28)} ${grn(String(rows.length).padStart(7))}`);
}

async function checkAbdmLinkage() {
  section("6. ABDM linkage");
  const careCtx = await count("abdm_care_contexts");
  const consent = await count("abdm_consent_artefacts");
  const fhirBundles = await count("prescriptions", "fhir_bundle=not.is.null");
  console.log(`  care contexts                 ${grn(String(careCtx.total ?? "ERR").padStart(7))}`);
  console.log(`  consent artefacts             ${grn(String(consent.total ?? "ERR").padStart(7))}`);
  console.log(`  prescriptions w/ FHIR bundle  ${grn(String(fhirBundles.total ?? "ERR").padStart(7))}`);
}

async function checkStorageBuckets() {
  section("7. Storage buckets");
  const buckets = ["website", "prescriptions", "documents"];
  for (const b of buckets) {
    const r = await fetch(`${SB}/storage/v1/bucket/${b}`, { headers: H });
    const ok = r.status === 200;
    console.log(`  ${pad(b, 28)} ${ok ? grn("OK   ") : red("FAIL ")} ${dim(`HTTP ${r.status}`)}`);
  }
}

async function checkEdgeFunctions() {
  section("8. Edge Functions reachability");
  const fns = [
    "generate-prescription",
    "generate-visit-summary",
    "generate-fhir-bundle",
    "abdm-identity",
    "abdm-hip-discover",
    "abdm-hip-link",
    "abdm-hip-consent",
    "abdm-hip-data-transfer",
    "abdm-hiu-consent-request",
    "abdm-hiu-data-receive",
  ];
  for (const fn of fns) {
    // OPTIONS request — proves the function is deployed and CORS-routable
    // without invoking business logic or burning Anthropic tokens.
    const r = await fetch(`${SB}/functions/v1/${fn}`, {
      method: "OPTIONS",
      headers: H,
    });
    // 200/204 = deployed and CORS-handling. 404 = not deployed. 401 = deployed but auth-rejected (still healthy).
    const deployed = r.status !== 404;
    const tag = deployed ? grn("OK   ") : red("MISS ");
    console.log(`  ${pad(fn, 28)} ${tag} ${dim(`HTTP ${r.status}`)}`);
  }
}

async function checkFormularyShape() {
  section("9. Formulary integrity (530 drugs expected)");
  const total = await count("formulary");
  const withDosing = await count("formulary", "dosing_bands=not.is.null");
  const withSnomed = await count("formulary", "snomed_code=not.is.null");
  console.log(`  total drugs                   ${grn(String(total.total ?? "ERR").padStart(7))}  ${total.total === 530 ? grn("✓") : yel("(expected 530)")}`);
  console.log(`  with dosing_bands             ${grn(String(withDosing.total ?? "ERR").padStart(7))}`);
  console.log(`  with snomed_code              ${grn(String(withSnomed.total ?? "ERR").padStart(7))}`);
}

// ---------- main ----------
(async () => {
  const t0 = Date.now();
  console.log(bold(`Supabase health check — ${SB}`));
  console.log(dim(`Started ${new Date().toISOString()}`));

  try {
    await checkTableCounts();
    await checkRecentActivity();
    await checkOrphans();
    await checkPatientHealth();
    await checkPrescriptionStatus();
    await checkAbdmLinkage();
    await checkStorageBuckets();
    await checkEdgeFunctions();
    await checkFormularyShape();
  } catch (e) {
    console.error(red(`\nFATAL: ${e.message}`));
    process.exit(2);
  }

  console.log(dim(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`));
})();
