#!/usr/bin/env node
/**
 * Walks the Supabase `documents` bucket, picks up to 5 images and 5 PDFs
 * (preferring images), downloads them into
 * radhakishan_system/data/sample_ocr_pdfs/, and writes a single markdown
 * file with each document's already-computed `ocr_summary` pulled from
 * visits.attached_documents.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const SB = "https://ecywxuqhnlkjtdshpcbc.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjeXd4dXFobmxranRkc2hwY2JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzQ2NTcsImV4cCI6MjA4OTIxMDY1N30.oo-x5L87FzJoprHIK8iFmHRa7AlIZlpDLg5Q1taY1Dg";

const OUT_DIR = path.resolve(__dirname, "..", "data", "sample_ocr_pdfs");

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tiff",
  ".bmp",
]);
const PDF_EXT = new Set([".pdf"]);

function req(method, url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        ...extraHeaders,
      },
    };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(body);
    }
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
      );
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https
      .get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { apikey: KEY, Authorization: "Bearer " + KEY },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          const f = fs.createWriteStream(dest);
          res.pipe(f);
          f.on("finish", () => f.close(() => resolve(dest)));
          f.on("error", reject);
        },
      )
      .on("error", reject);
  });
}

async function listPrefix(prefix) {
  const r = await req(
    "POST",
    `${SB}/storage/v1/object/list/documents`,
    JSON.stringify({
      prefix,
      limit: 200,
      sortBy: { column: "created_at", order: "desc" },
    }),
  );
  if (r.status !== 200) throw new Error(`list ${prefix} -> ${r.status}`);
  return JSON.parse(r.body.toString("utf8"));
}

async function walk() {
  // Supabase storage list is non-recursive. Paths look like:
  //   <patient_id>/<visit_id>/<category>_<ts>.<ext>
  // So we walk patient -> visit -> files.
  const allFiles = [];
  const patients = await listPrefix("");
  for (const p of patients) {
    if (!p.id && p.name) {
      // folder entries come back with name but no id
      const visits = await listPrefix(p.name + "/");
      for (const v of visits) {
        if (!v.id && v.name) {
          const files = await listPrefix(p.name + "/" + v.name + "/");
          for (const f of files) {
            if (f.id && f.name) {
              const fullPath = `${p.name}/${v.name}/${f.name}`;
              const ext = path.extname(f.name).toLowerCase();
              allFiles.push({
                path: fullPath,
                name: f.name,
                ext,
                patient_id: p.name,
                visit_id: v.name,
                created_at: f.created_at || f.updated_at,
                size: f.metadata?.size || null,
              });
            }
          }
        }
      }
    }
  }
  return allFiles;
}

async function fetchVisitAttachedDocs(visitIds) {
  if (visitIds.length === 0) return {};
  const ids = visitIds.map((v) => `"${v}"`).join(",");
  const url = `${SB}/rest/v1/visits?id=in.(${encodeURIComponent(
    visitIds.join(","),
  )})&select=id,attached_documents`;
  const r = await req("GET", url, null);
  if (r.status !== 200) {
    console.warn(
      "visits fetch",
      r.status,
      r.body.toString("utf8").slice(0, 300),
    );
    return {};
  }
  const rows = JSON.parse(r.body.toString("utf8"));
  const map = {};
  for (const row of rows) map[row.id] = row.attached_documents || [];
  return map;
}

function findDocEntry(attachedDocs, publicUrl) {
  return attachedDocs.find((d) => d.url === publicUrl) || null;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Listing bucket…");
  const all = await walk();
  console.log(`Found ${all.length} files total.`);

  const images = all.filter((f) => IMAGE_EXT.has(f.ext));
  const pdfs = all.filter((f) => PDF_EXT.has(f.ext));
  console.log(`  Images: ${images.length}`);
  console.log(`  PDFs:   ${pdfs.length}`);

  // Sort newest first
  const byNewest = (a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "");
  images.sort(byNewest);
  pdfs.sort(byNewest);

  const picked = {
    images: images.slice(0, 5),
    pdfs: pdfs.slice(0, 5),
  };

  const visitIds = [
    ...new Set([...picked.images, ...picked.pdfs].map((f) => f.visit_id)),
  ];
  console.log(`Fetching attached_documents for ${visitIds.length} visits…`);
  const visitMap = await fetchVisitAttachedDocs(visitIds);

  const downloaded = [];
  for (const group of ["images", "pdfs"]) {
    for (const f of picked[group]) {
      const localName = `${group === "images" ? "img" : "pdf"}_${f.patient_id.slice(
        0,
        8,
      )}_${f.visit_id.slice(0, 8)}_${f.name}`;
      const dest = path.join(OUT_DIR, localName);
      const publicUrl = `${SB}/storage/v1/object/public/documents/${f.path}`;
      try {
        console.log(`  ↓ ${f.path}`);
        await download(publicUrl, dest);
        const entry = findDocEntry(visitMap[f.visit_id] || [], publicUrl);
        downloaded.push({
          group,
          local: localName,
          path: f.path,
          patient_id: f.patient_id,
          visit_id: f.visit_id,
          created_at: f.created_at,
          size: f.size,
          ocr_summary: entry?.ocr_summary || null,
          ocr_lab_count: entry?.ocr_lab_count ?? null,
          ocr_vax_count: entry?.ocr_vax_count ?? null,
          ocr_diagnoses: entry?.ocr_diagnoses || [],
          ocr_medications: entry?.ocr_medications || [],
          category: entry?.category || null,
          description: entry?.description || null,
          filename: entry?.filename || f.name,
        });
      } catch (e) {
        console.warn(`  ! failed: ${f.path} — ${e.message}`);
      }
    }
  }

  // Build markdown
  const mdLines = [];
  mdLines.push("# Sample OCR Documents — Bucket Dump");
  mdLines.push("");
  mdLines.push(
    `> Downloaded ${downloaded.length} files from the Supabase \`documents\` bucket for OCR comparison/benchmarking.`,
  );
  mdLines.push(
    `> Each entry below includes the already-computed \`ocr_summary\` (via \`process-document\` Edge Function — Claude Sonnet 4 Vision) from \`visits.attached_documents\`.`,
  );
  mdLines.push("");

  for (const group of ["images", "pdfs"]) {
    const items = downloaded.filter((d) => d.group === group);
    mdLines.push(
      `## ${group === "images" ? "Images" : "PDFs"} (${items.length})`,
    );
    mdLines.push("");
    if (items.length === 0) {
      mdLines.push("_None found in bucket._");
      mdLines.push("");
      continue;
    }
    items.forEach((d, i) => {
      mdLines.push(
        `### ${group === "images" ? "Image" : "PDF"} ${i + 1} — \`${d.local}\``,
      );
      mdLines.push("");
      mdLines.push(`- **Original path:** \`${d.path}\``);
      mdLines.push(`- **Original filename:** ${d.filename || "(n/a)"}`);
      mdLines.push(`- **Category:** ${d.category || "(n/a)"}`);
      if (d.description) mdLines.push(`- **Description:** ${d.description}`);
      mdLines.push(`- **Uploaded:** ${d.created_at || "(unknown)"}`);
      if (d.size) mdLines.push(`- **Size:** ${d.size} bytes`);
      mdLines.push(`- **Patient ID:** \`${d.patient_id}\``);
      mdLines.push(`- **Visit ID:** \`${d.visit_id}\``);
      mdLines.push(
        `- **OCR diagnoses:** ${d.ocr_diagnoses.length ? d.ocr_diagnoses.map((x) => `\`${x}\``).join(", ") : "(none)"}`,
      );
      mdLines.push(
        `- **OCR medications:** ${
          d.ocr_medications.length
            ? d.ocr_medications
                .map((m) =>
                  typeof m === "string"
                    ? m
                    : `${m.drug || "?"} ${m.dose || ""} ${m.frequency || ""} ${m.duration || ""}`.trim(),
                )
                .map((s) => `\`${s}\``)
                .join(", ")
            : "(none)"
        }`,
      );
      mdLines.push(`- **Lab values extracted:** ${d.ocr_lab_count ?? "(n/a)"}`);
      mdLines.push(
        `- **Vaccinations extracted:** ${d.ocr_vax_count ?? "(n/a)"}`,
      );
      mdLines.push("");
      mdLines.push("**OCR summary (Claude Sonnet 4 Vision):**");
      mdLines.push("");
      if (d.ocr_summary) {
        mdLines.push("> " + d.ocr_summary.replace(/\n/g, "\n> "));
      } else {
        mdLines.push("> _No OCR summary stored for this document._");
      }
      mdLines.push("");
      mdLines.push("---");
      mdLines.push("");
    });
  }

  const mdPath = path.join(OUT_DIR, "README.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  console.log(`\nWrote ${mdPath}`);
  console.log(`Total downloaded: ${downloaded.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
