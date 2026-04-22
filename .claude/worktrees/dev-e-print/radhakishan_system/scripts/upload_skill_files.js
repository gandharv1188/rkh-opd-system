#!/usr/bin/env node
/**
 * Upload all skill .md files to Supabase Storage bucket "website" with prefix "skill/".
 *
 * Usage: node upload_skill_files.js
 * Reads credentials from .env file in project root, or pass as arguments:
 *   node upload_skill_files.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
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
    "  1. Create .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
  );
  console.error(
    "  2. Pass as arguments: node upload_skill_files.js <URL> <KEY>",
  );
  process.exit(1);
}

const SKILL_DIR = path.join(__dirname, "..", "skill");
const BUCKET = "website";
const PREFIX = "skill";

/**
 * Recursively find all .md files in a directory.
 */
function findMdFiles(dir, baseDir) {
  baseDir = baseDir || dir;
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findMdFiles(fullPath, baseDir));
    } else if (entry.name.endsWith(".md")) {
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      results.push({ fullPath, relativePath });
    }
  }
  return results;
}

async function uploadFile(filePath, storagePath) {
  const content = fs.readFileSync(filePath);
  const url = `${SB}/storage/v1/object/${BUCKET}/${storagePath}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "text/markdown",
      "x-upsert": "true",
    },
    body: content,
  });

  if (res.ok) {
    return { success: true };
  } else {
    const text = await res.text();
    return { success: false, status: res.status, error: text };
  }
}

async function main() {
  const files = findMdFiles(SKILL_DIR);
  console.log(`Found ${files.length} .md files in ${SKILL_DIR}\n`);

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const storagePath = `${PREFIX}/${file.relativePath}`;
    process.stdout.write(`  ${storagePath} ... `);

    const result = await uploadFile(file.fullPath, storagePath);
    if (result.success) {
      console.log("OK");
      successCount++;
    } else {
      console.log(`FAILED (${result.status}: ${result.error})`);
      failCount++;
    }
  }

  console.log(`\nDone: ${successCount} uploaded, ${failCount} failed.`);

  // Verify core_prompt.md is accessible
  console.log("\nVerifying public access to core_prompt.md ...");
  const verifyUrl = `${SB}/storage/v1/object/public/${BUCKET}/${PREFIX}/core_prompt.md`;
  const verifyRes = await fetch(verifyUrl);
  if (verifyRes.ok) {
    const text = await verifyRes.text();
    const preview = text.substring(0, 120).replace(/\n/g, " ");
    console.log(`  OK (${text.length} bytes) — "${preview}..."`);
  } else {
    console.log(`  FAILED (${verifyRes.status})`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
