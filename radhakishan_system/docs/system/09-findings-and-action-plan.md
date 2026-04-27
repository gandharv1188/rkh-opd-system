# 09 — Findings and Action Plan

> Plain-language summary of the IO investigation **and** every other concern
> the 8 reading agents surfaced. Written for the doctor / product owner, not
> just engineers.
>
> _Last updated: 2026-04-27_

This document answers two questions:

1. **How do we fix the Supabase Disk-IO Budget warning?**
2. **What else came up during the read-through that we should know about?**

Nothing in this file has been changed in the codebase or the database yet.
This is a proposal. Each item lists the risk and what would have to be true
for you to approve it.

---

## Part 1 — The IO problem and how to fix it

### What the problem is, in one paragraph

Supabase warned us we are using too much "Disk IO" — the work the database
does to read and write data on its hard drive. If we keep using it at this
pace, the system gets slow during clinic hours. Our database is small (95 MB)
and most data sits in memory (cache hit rate 100%), so we are not running
out of space or RAM. The waste is in **how often** and **how much** we read
and write.

### Where the waste is coming from (ranked by size)

| # | Source | Plain explanation | How big |
|---|---|---|---|
| 1 | Drug list preload pulls too many columns | The Prescription Pad asks for 9 details about every drug at startup; the page only ever uses 3 of them. The other 6 are big text blobs (interactions, contraindications, notes). | About 78% of all drug-related IO. |
| 2 | Realtime polling on empty publication | Supabase has a "live updates" feature that is constantly checking for changes — but our setup has no tables registered for it, and the only page that listens is already broken. | Over 4,000 seconds of database time. |
| 3 | Drug / diagnosis / patient search has no fast index | Every keystroke in a search box reads every row of the table. Small tables, but search runs many times per minute. | About 3 million rows of unnecessary reads on the drug table. |
| 4 | Auto-save fires every 30 seconds even when nobody is typing | Each save rewrites the whole visit row (25 columns including big text fields). | 37,000+ unnecessary writes. |

### How we fix each, in safe order

**The principle: do the cheapest, safest, most-revertable change first. Watch
the IO needle. Then move to the next.**

---

#### Fix 1 — Narrow the drug preload (biggest win, safest change)

- **What changes.** One line in `web/prescription-pad.html` (line ~3057).
  Today it asks Supabase for 9 columns. We change it to ask for 3:
  `generic_name`, `formulations`, `dosing_bands`. Nothing else changes.
- **What we keep.** The AI tool that generates prescriptions (`get_formulary`
  inside the Edge Function) still pulls all 22 columns it needs. That tool
  uses every column. We do not touch it.
- **Risk.** Very low. Static reading of the file shows the dropped columns
  are not used anywhere on the Prescription Pad. But before we deploy, we
  open the pad in Chrome and run through a real prescription end-to-end —
  drug interaction warning, contraindication alert, allergy check — to be
  certain.
- **How to revert.** One-line revert. The change is a single fetch URL.
- **Expected impact.** ~70-78% drop in formulary-related IO.
- **Where it lives.** `web/prescription-pad.html` only. Auto-deploys to
  GitHub Pages on push to `main`. No database change.

---

#### Fix 2 — Slow the auto-save without removing the safety net

- **What changes.** In `web/prescription-pad.html` (line ~3979–3997), the
  auto-save currently does two things:
  1. Saves 3 seconds after the doctor stops typing (debounce).
  2. Saves every 30 seconds **whether or not** anything changed.
- **The fix.** Keep both, but add a "did anything actually change?" check
  before each save. If the text is identical to the last saved version,
  skip the network call. Optionally raise the debounce from 3 s to 5 s so
  rapid typing doesn't fire as often.
- **What we keep.** The 30-second timer stays. **This is the crash-safety
  net** — if the doctor pauses for several minutes (taking a phone call,
  examining a child, dictating slowly with long gaps) and the browser
  crashes, the periodic save protects up to the last 30 seconds of
  dictation. We must not remove it.
- **Risk.** Very low. ~10 lines of JavaScript. If the dirty-check is wrong
  (saves are skipped when they shouldn't be), we lose at most one cycle of
  unsaved text — the next keystroke triggers a debounced save anyway.
- **How to revert.** Remove the dirty-check; auto-save returns to its
  current behaviour.
- **Expected impact.** ~70-85% reduction in `visits.raw_dictation` writes.
- **Where it lives.** `web/prescription-pad.html` only. No database change.

---

#### Fix 3 — Turn off Realtime publication (Supabase dashboard, not code)

- **What changes.** In the Supabase dashboard, **Database → Publications →
  `supabase_realtime`**, confirm it has no tables registered (already
  empty per the diagnostic). Then in **Project Settings → API**, turn off
  Realtime entirely if no future feature needs it.
- **The web change.** Replace the broken WebSocket subscription in
  `web/prescription-pad.html` (lines ~3100–3189) with a simple
  `setInterval(loadTodayPatients, 60000)` — refresh the today's-patients
  dropdown once a minute. Strictly better than the current state, where
  the WebSocket connects but never fires because the publication is empty.
- **Risk.** Near zero. The only client subscriber is already broken
  (publication has no tables to push). Nothing in the codebase depends on
  Realtime working.
- **How to revert.** Re-enable Realtime in the dashboard; the JavaScript
  fallback to a 60-second poll has zero downside if Realtime is back.
- **Expected impact.** Stops ~4,300 seconds of background polling work.
- **Where it lives.** Supabase dashboard toggle (yours to flip) plus a
  small change in `web/prescription-pad.html`.

---

#### Fix 4 — Add fast-search indexes for drug / diagnosis / patient search

- **What changes.** A small SQL file applied once to the live database that
  installs the `pg_trgm` extension (if not already present) and creates
  ~5 GIN trigram indexes on the columns that get searched: `formulary
  (generic_name)`, `formulary (brand_names)`, `standard_prescriptions
  (diagnosis_name)`, `patients (name)`, `patients (guardian_name)`.
- **Why it matters.** Today every keystroke in a search box reads every
  row in the table. With trigram indexes, Postgres jumps directly to
  matching rows.
- **Risk.** Low — but more careful than Fixes 1, 2, 3 because it touches
  the live database. We use `CREATE INDEX CONCURRENTLY` which never blocks
  writes (clinic can keep running). Indexes are additive — they don't
  change query results, only speed.
- **Estimated total index size:** under 10 MB on a 95 MB database.
- **How to revert.** `DROP INDEX CONCURRENTLY` if any concern arises. No
  data change.
- **Expected impact.** Sequential scans on `formulary` and
  `standard_prescriptions` go from millions of row-reads to a few index
  hits per search. Cumulative IO win is large because search runs
  constantly during clinic hours.
- **When to apply.** Off-clinic-hours, one index at a time, with a `git
  commit` of the migration file before and a verification query after each.
- **Where it lives.** A new tracked migration in
  `radhakishan_system/schema/` (also closes a documentation gap — see
  Fix 5 below).

---

#### Recommended sequence

1. **Today, immediately:** Fix 1 + Fix 2 (web changes, deploy via GitHub
   Pages CI). Watch IO budget for 24 hours.
2. **Tomorrow:** Fix 3 (Supabase dashboard toggle + small web change).
3. **This week, off-hours:** Fix 4 (DDL with `CONCURRENTLY`).

After all four, expected disk-IO reduction is **70-85%**. We re-run the
diagnostic and confirm before declaring victory.

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

1. **Fix the IO budget (Part 1).** Four fixes, sized small to large.
2. **Close the schema-drift problem (H1, H2).** Dump the live schema back
   into `radhakishan_system/schema/` and start a real migrations folder
   (`supabase/migrations/`) tracked in git. This is a one-day exercise; it
   pays dividends on every future change.
3. **Fix the silent vaccine-drop bug (H4).** Small UI+save change, real
   patient-record correctness benefit.
4. **Add prescription-edit version history (H3).** Either an
   `prescriptions_history` table or an append-only column. Medico-legal.
5. **Three-state allergy flag (H6).** Requires a small UI change and the
   word "asked, none" on the receipt — NABH compliance.
6. **Vaccine "Other" save path (H4 second half).** Free-text capture +
   pediatrics whitelist.
7. **Procedure receipt DB-coordination (H8).**
8. **`create_sample_data.js` project-id guard (H7).** One-line check;
   prevents catastrophe.
9. **Move credentials out of HTML (M1).** `web/config.js` + script-src.
10. **Vendor QR library (M9), validate postMessage origin (M4), defer
    pre-OCR (M6).** Small hardenings.

For everything in **Low concern**, fold into normal hygiene work — fix
opportunistically when touching nearby code.

---

## Re-running the diagnostic

The diagnostic harness is committed at
`radhakishan_system/scripts/diagnose_io.sql` and `run_diagnose2.sh` (on the
`chore/io-diagnostic` branch — to be merged when ready). Run with:

```bash
bash radhakishan_system/scripts/run_diagnose2.sh
```

Output goes to `radhakishan_system/scripts/diagnose_io.out.txt` (gitignored).
Re-run before and after each fix to measure impact.

---

_End of findings and action plan._
