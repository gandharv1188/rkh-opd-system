# 09 — Findings and Action Plan

> Plain-language summary of the IO investigation **and** every other concern
> the 8 reading agents surfaced. Written for the doctor / product owner, not
> just engineers.
>
> _Last updated: 2026-04-28_

This document answers two questions:

1. **How do we fix the Supabase Disk-IO Budget warning?**
2. **What else came up during the read-through that we should know about?**

Nothing in this file has been changed in the codebase or the database yet.
This is a proposal. Each item lists the risk and what would have to be true
for you to approve it.

---

## Part 1 — The IO problem and how to fix it

> **Note (2026-04-28):** This section was rewritten after running the live
> diagnostic against the production database via the Supabase MCP tools. The
> earlier version of this document ranked the four fixes by educated guess.
> The real numbers — pulled from `pg_stat_statements` over the last 6 weeks —
> tell a very different story. The fix priority below reflects the actual
> data, not the original guess.

### What we actually found

We connected to the live database and read the `pg_stat_statements` view,
which records every SQL statement executed since 2026-03-16 along with how
much work each one did. The picture is dominated by a single source we did
not even rank in the original document: **Supabase Realtime polling the
write-ahead log every few seconds, even though nothing is registered for it
to broadcast.**

Top consumers of database work over the 6-week window:

| Category | Cache hits | % of all hits | Pages dirtied | % of writes | Exec time |
|---|---|---|---|---|---|
| Realtime WAL polling | 1,799,684,329 | **97.0%** | 31 | 0.05% | 5,776 sec (54%) |
| pgrst SELECTs (drug / dx) | 35,637,443 | 1.9% | 1,741 | 2.7% | 3,117 sec |
| pgrst INSERTs | 2,908,550 | — | 32,330 | 50.7% | 127 sec |
| pgrst UPDATEs | 2,591,230 | — | 19,040 | 29.9% | 427 sec |
| Other | 4,942,565 | — | 7,590 | — | 987 sec |

Two Realtime decoder queries together ran **1,382,727 times** in 6 weeks —
that's roughly once every 3 seconds, around the clock — and each one touches
about 1,300 buffer pages. Meanwhile the publication those queries serve
(`supabase_realtime`) has **zero tables registered**. The work is real; the
output is nothing.

### The key insight (in plain words)

Our database is small (95 MB) and the cache hit rate is essentially 100% —
in other words, the data already lives in RAM. So when Supabase shows a
"Disk IO Budget" warning, it is not really measuring trips to the actual
hard disk. It is measuring how often queries thrash the in-memory buffer
cache and burn CPU in the process.

That changes which fixes matter. A change that drops a column from a query
might make the page feel snappier, but if both versions already read the
same set of pages from cache, the IO budget barely moves. The thing that
*does* move the IO budget is stopping a background loop that thrashes the
cache 1.4 million times for nothing.

### Where the waste is coming from (ranked by real impact)

| # | Source | Plain explanation | Share of IO budget |
|---|---|---|---|
| 1 | **Realtime polling on an empty publication** | Supabase's "live updates" worker is reading the write-ahead log every ~3 seconds even though no tables are configured to publish. | **~97%** of all buffer hits, **54%** of total exec time |
| 2 | Auto-save fires every 30 seconds even when nothing changed | The visit auto-save rewrites the row every cycle, dirtying ~12,500 pages over 6 weeks. | ~0.3% of total IO, but **19.7% of all writes** (largest write source) |
| 3 | Drug-list preload pulls 9 columns when only 3 are used | The Prescription Pad asks for columns it never reads. The wasted columns are TOAST'd, so the disk doesn't actually fetch them — but parsing/serialising them is slow. | ~0.5% of IO, but **80× slower page load** (164 ms vs 2 ms) |
| 4 | ~~Trigram indexes for search~~ | Search queries are already cheap on these tiny tables (67–485 buffers per call). The biggest one is 0.005% of the IO budget. | <0.1% — not worth doing for IO |

### How we fix each, in real-impact order

**The principle: do the change with the largest verified impact first. Watch
the IO needle. Re-run the diagnostic before deciding whether the smaller
fixes are still worth the effort.**

---

#### Fix #1 — Disable Supabase Realtime (one click + small JS replacement)

- **What changes.** In the Supabase dashboard, **Project Settings → API**,
  turn Realtime off. Confirm the `supabase_realtime` publication has no
  tables (verified — it has zero). Then in `web/prescription-pad.html`
  (lines ~3100–3189), replace the broken WebSocket subscription with a
  simple `setInterval(loadTodayPatients, 60000)` so the today's-patients
  dropdown still refreshes once a minute.
- **Verified evidence.** Two Realtime decoder queries account for
  **1,799,684,329 buffer hits** (97% of all database read work) and
  **5,776 seconds of execution time** (54% of total) over 6 weeks. They
  ran **1,382,727 times** — roughly every 3 seconds, 24/7. The publication
  they serve is empty. The web page that "subscribes" already doesn't
  receive anything because of the empty publication.
- **Risk.** Near zero. Nothing in the codebase depends on Realtime
  working. The current behaviour is a no-op anyway.
- **How to revert.** Re-enable Realtime in the dashboard. The 60-second
  poll fallback has zero downside if Realtime returns.
- **Expected impact.** **~95% reduction in the IO budget.** This is the
  one fix that actually moves the needle.
- **Where it lives.** Supabase dashboard toggle (yours to flip) plus a
  small change in `web/prescription-pad.html`. No database migration.

---

#### Fix #2 — Add a "did anything change?" check to auto-save

- **What changes.** In `web/prescription-pad.html` (line ~3979–3997), the
  auto-save currently does two things:
  1. Saves 3 seconds after the doctor stops typing (debounce).
  2. Saves every 30 seconds **whether or not** anything changed.

  We add a check: before each save, compare the current text to the last
  saved text. If identical, skip the network call. Optionally raise the
  debounce from 3 s to 5 s.
- **What we keep.** The 30-second timer stays as the crash-safety net. If
  the doctor pauses for several minutes (phone call, examining a child)
  and the browser crashes, the periodic save still protects up to the last
  30 seconds of dictation.
- **Verified evidence.** The exact UPDATE on `visits.raw_dictation` ran
  **37,786 times** in 6 weeks (~900/day, confirms the 30-second cadence)
  and dirtied **12,555 pages** — that is **19.7% of all writes** in the
  database, the single largest source of write churn.
- **Risk.** Very low. ~10 lines of JavaScript. If the dirty-check is wrong
  and a save is skipped when it shouldn't be, the next keystroke triggers
  a debounced save anyway.
- **How to revert.** Remove the dirty-check; auto-save returns to its
  current behaviour.
- **Expected impact.** ~0.3% reduction in total IO budget — small in the
  overall picture, but meaningful for **WAL bloat and write churn** (cuts
  the largest write source by ~80%). Worth doing for backup/replication
  health and SSD wear.
- **Where it lives.** `web/prescription-pad.html` only. No database change.

---

#### Fix #3 — Narrow the formulary preload (small IO win, big latency win)

- **What changes.** One line in `web/prescription-pad.html` (line ~3057).
  Today it asks Supabase for 9 columns. We change it to ask for 3:
  `generic_name`, `formulations`, `dosing_bands`. Nothing else changes.
- **What we keep.** The AI tool that generates prescriptions
  (`get_formulary` inside the Edge Function) still pulls all 22 columns it
  needs. We do not touch it.
- **Verified evidence.** Ran `EXPLAIN (ANALYZE, BUFFERS)` on both versions
  of the query against the live database:
  - 9-column SELECT: 338 shared hit blocks, **execution time 164.5 ms**.
  - 3-column SELECT: 338 shared hit blocks (identical), **execution time
    2.2 ms** — about **80× faster**.

  The 6 dropped columns are big JSONB blobs (interactions,
  contraindications, notes) stored in a TOAST side-table — Postgres only
  fetches them if you ask for them. Both versions read the same heap
  pages, so the disk-page count is identical. The win is CPU and
  serialisation time.
- **Risk.** Very low. Static reading shows the dropped columns are not
  used anywhere on the Prescription Pad. Before deploy: open the pad in
  Chrome, run a real prescription end-to-end (drug interaction warning,
  contraindication alert, allergy check) to confirm.
- **How to revert.** One-line revert. The change is a single fetch URL.
- **Expected impact.** ~0.5% reduction in IO budget. **Page-load latency
  for the drug list drops from ~165 ms to ~2 ms.** Do this for the user
  experience, not for the IO budget.
- **Where it lives.** `web/prescription-pad.html` only. No database change.

---

#### Skip — Trigram indexes for search

- **What it would have done.** Install `pg_trgm` and add GIN trigram
  indexes on `formulary.generic_name`, `formulary.brand_names`,
  `standard_prescriptions.diagnosis_name`, `patients.name`,
  `patients.guardian_name`.
- **Why we are skipping.** The numbers do not justify it.
  - The most expensive search query in the entire database hits 84,458
    buffers across 174 calls — that's 485 buffers per call, and **0.005%
    of the IO budget total.**
  - The patient-name search hits 67 buffers per call. Already cheap.
  - The formulary heap is only 335 pages (2.6 MB). A sequential scan
    touches the whole table; a trigram index would still need to hit heap
    pages for matches. On tables this small, the index barely helps.
  - `pg_trgm` is not installed. Adding it requires an extension change to
    the live database — small risk, but non-zero.
- **When to revisit.** Once the `patients` table grows past ~10,000 rows
  (we have 534 today), or if a search latency complaint appears.

---

#### Recommended sequence

1. **Today:** Fix #1 (Disable Realtime). Dashboard toggle + ~30 lines of
   JS. Watch the IO budget for 24 hours.
2. **Re-run the diagnostic** (`bash radhakishan_system/scripts/run_diagnose.sh`).
   With ~95% of the IO gone, decide whether Fix #2 and Fix #3 are still
   worth doing — they likely are, but for write-churn and latency reasons,
   not for the IO budget.
3. **This week:** Fix #2 (auto-save dirty-check) and Fix #3 (narrow
   preload). Both are pure web-app changes that auto-deploy via GitHub
   Pages. No database migration needed.

After Fix #1 alone, the IO budget warning should disappear. Fixes #2 and #3
are quality improvements that we recommend regardless, but they are not
load-bearing for the warning.

---

## Part 2 — Other problems found during the read-through

These are **not** the IO problem. They came up because eight agents read
every line of every file and wrote a permanent system reference. Most are
small. A few matter for patient safety. None are emergencies. All are
documented in detail in the corresponding `01–08` system docs.

### Highest concern (clinical or safety implications)

| # | What | Where | Why it matters |
|---|---|---|---|
| H1 | **Schema drift between repo and live database.** Live DB has ~50 indexes, repo has ~21. Live `visits` table has 7 extra columns. `loinc_investigations` exists live but not in repo. | doc 06 §12, doc 07 §9.1 | Any future engineer or AI assistant reading the repo schema will plan changes against an outdated picture. Could cause real bugs. |
| H2 | **Schema migrations applied to production are not tracked.** They are run via `supabase db query -f <file.sql>` and the file is sometimes not even committed. No migration table, no rollback story. | doc 07 §9.1 | If we ever need to rebuild the database, we cannot reproduce its current state from the repo. |
| H3 | **No audit trail on prescription edits.** When a doctor uses "Edit" mode after sign-off, the new `generated_json` overwrites the old one. No version history. | doc 01 §9, §13 question 6 | Medico-legal: if a parent disputes a prescription, we cannot show what was originally signed. |
| H4 | **Vaccine "Other…" entries are silently dropped.** When a doctor manually adds a vaccine that isn't in the IAP/NHM dropdown (e.g. Vitamin A on the NHM schedule), the save handler discards rows where the dropdown value is `"other"`. | doc 02 §12 item 9 | The patient appears to have received the vaccine in the UI, but no `vaccinations` row is created. This breaks ABDM/IAP audit trails. |
| H5 | **Vaccine `previously_given` rows save with `dose_number: null`**. | doc 01 §13 question 4 | ABDM and IAP audit may require an explicit dose number. |
| H6 | **NABH "asked, none" allergy state is missing.** The receipt prints either red ALLERGY or green NKDA, never "asked but no answer" — and never blank-but-asked. | doc 02 §12 item 14, §13 question 5 | NABH requires documenting that the question was *asked*. Two-state UI hides "not asked" cases. |
| H7 | **`create_sample_data.js` is unconditionally destructive across 7 tables with no project-id guard.** | doc 07 §9.5 | If accidentally run pointed at production, it deletes patients, visits, prescriptions, etc. |
| H8 | **Procedure receipt numbers can collide across browser tabs.** The counter is per-tab in memory, not DB-coordinated. Two reception PCs can issue the same receipt number. | doc 02 §9, §13 question 2 | Receipt mismatch confuses pharmacy and billing reconciliation. |
| H9 | **Maximum-dose flag is informational only — sign-off is not blocked.** When the AI flags `overall_status: "REVIEW REQUIRED"` or applies a max-dose cap, the doctor sees a warning but can still sign off without acknowledging it. | doc 01 §13 question 8 | Clinical risk if the warning is missed during a busy clinic. |

### Medium concern (security / privacy / hygiene)

| # | What | Where | Why it matters |
|---|---|---|---|
| M1 | **Hardcoded credentials in 8+ HTML files.** Supabase URL and anon JWT inlined; rotation requires a coordinated edit and redeploy. | doc 02 §9 | Security and maintainability risk. JWT expires in 2089 — that part is fine — but any operational rotation is painful. |
| M2 | **Anon-key only, RLS `anon_full_access`.** Per CLAUDE.md this is the POC mode; there is no auth, no per-user scoping, no audit. | doc 06 §7, doc 02 §11.2 | Acceptable for POC; must be hardened before any wider deployment. |
| M3 | **postMessage to `https://claude.ai`** is leftover artifact-era code in `patient-lookup.html`. Harmless on GitHub Pages but misleading. | doc 02 §9 | Dead code; if removed, simplifies the file. |
| M4 | **postMessage listener in prescription pad does not validate `event.origin`.** Any frame that sends the right `type` could inject a prescription template. | doc 01 §12 | Low likelihood (no iframe today) but a defensive `origin` whitelist costs nothing. |
| M5 | **Voice transcription sends patient name + sex + weight + complaints** as `patient_context` to `transcribe-audio` for accuracy. | doc 01 §13 question 10 | PHI budget over a public Edge Function URL — confirm this is acceptable. |
| M6 | **Pre-OCR sends image to Edge Function before patient is saved.** If the user cancels, the image was already uploaded to OCR. | doc 02 §13 question 9 | Privacy. Could defer OCR until patient_id is known. |
| M7 | **ABHA number printed on QR unconditionally.** | doc 01 §13 question 9 | PHI exposure on a printed page. Confirm consent model. |
| M8 | **Verify-page hash is 24 bits.** Brute-forceable in seconds. The real gate is `is_approved=true`; the hash is only a tamper signal, not auth. | doc 02 §7.4 | Acceptable for the documented purpose; just be clear about what it does and doesn't do. |
| M9 | **`api.qrserver.com` external dependency** for printed QR codes. If the service is down, prescriptions print without a QR. | doc 01 §9 | Vendor a JS QR library locally; a few hundred kilobytes. |
| M10 | **Five generations of SNOMED rebuilders coexist** in `scripts/` with no explicit deprecation. | doc 07 §9.9 | Future engineer doesn't know which to use. |
| M11 | **Hard-coded Windows paths to local SNOMED/LOINC release files** in 10+ scripts. | doc 07 §9.2 | Scripts are maintainer-workstation-only. |

### Low concern (code hygiene, latent bugs, doc gaps)

| # | What | Where |
|---|---|---|
| L1 | The `removeNP` function re-renders the entire prescription review for one removed item — wasteful for large prescriptions. | doc 01 §12 |
| L2 | Duplicate `simplifyForm` regex repeated in 4+ places; new formulation types must be added to all. | doc 01 §9 |
| L3 | `generateRxId` falls back to `001` and does not handle wraparound past 999/day. | doc 01 §9 |
| L4 | Lab `value_numeric = parseFloat(value) || null` makes a true zero parse to null. | doc 02 §12 item 10 |
| L5 | `existingVax` populated after form render — brief flicker where checklist appears empty. | doc 02 §12 item 12 |
| L6 | `MODS` map defined at the top of `prescription-pad.html` but never read. Dead code. | doc 01 §12 |
| L7 | "Two competing CSS classes for collapsibles" with both still rendered. | doc 01 §12 |
| L8 | Verify hash includes the date-only portion of `created_at` — re-printing on a different day mismatches. Documented intentional. | doc 02 §12 item 8 |
| L9 | History tabs limited to 5 — arbitrary, not in the spec. | doc 01 §13 question 3 |
| L10 | `_searchResults` global to dodge JSON-in-attribute escaping. Works, but unusual pattern. | doc 02 §12 item 13 |
| L11 | Image enhancement runs on the main thread; large phone photos freeze the page for ~1s. | doc 02 §9 |
| L12 | Several Storage policies live outside the repo. | doc 06 §12 |
| L13 | Missing `lab_results.updated_at` trigger. | doc 06 §12 |

---

## How this list translates to next steps

The IO fixes (Part 1) are the active priority because Supabase warned us.
**Everything in Part 2 is a backlog**, not an emergency. Suggested order:

1. **Fix the IO budget — Realtime first (Part 1, Fix #1).** This is a
   single dashboard toggle plus a small JS swap, and it is responsible for
   roughly 95% of the warning. Re-run the diagnostic afterwards.
2. **Auto-save dirty-check and narrow preload (Part 1, Fix #2 and #3).**
   Small IO impact, but worthwhile for write churn and page-load latency.
3. **Close the schema-drift problem (H1, H2).** Dump the live schema back
   into `radhakishan_system/schema/` and start a real migrations folder
   (`supabase/migrations/`) tracked in git. This is a one-day exercise; it
   pays dividends on every future change.
4. **Fix the silent vaccine-drop bug (H4).** Small UI+save change, real
   patient-record correctness benefit.
5. **Add prescription-edit version history (H3).** Either an
   `prescriptions_history` table or an append-only column. Medico-legal.
6. **Three-state allergy flag (H6).** Requires a small UI change and the
   word "asked, none" on the receipt — NABH compliance.
7. **Vaccine "Other" save path (H4 second half).** Free-text capture +
   pediatrics whitelist.
8. **Procedure receipt DB-coordination (H8).**
9. **`create_sample_data.js` project-id guard (H7).** One-line check;
   prevents catastrophe.
10. **Move credentials out of HTML (M1).** `web/config.js` + script-src.
11. **Vendor QR library (M9), validate postMessage origin (M4), defer
    pre-OCR (M6).** Small hardenings.

For everything in **Low concern**, fold into normal hygiene work — fix
opportunistically when touching nearby code.

---

## Re-running the diagnostic

The diagnostic harness is committed at
`radhakishan_system/scripts/diagnose_io.sql` and `run_diagnose.sh`. Run with:

```bash
bash radhakishan_system/scripts/run_diagnose.sh
```

Output goes to `radhakishan_system/scripts/diagnose_io.out.txt` (gitignored).
Re-run before and after each fix to measure impact. The 2026-04-28 baseline
that informed this rewrite was captured via the Supabase MCP tools directly
against `pg_stat_statements` (stats since 2026-03-16).

---

_End of findings and action plan._
