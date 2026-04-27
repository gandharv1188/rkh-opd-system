# 00 — System Documentation Overview

> Living index of the system documentation set. Read this first.
>
> Each numbered doc in this folder describes one slice of the live production
> system in detail. Together they are the durable reference for anyone (engineer,
> auditor, future Claude session) who needs to understand the codebase without
> re-deriving it from scratch.

## How this set was produced

Generated 2026-04-27 by 8 reading agents working in parallel, each in an isolated
git worktree off `main`. Every agent read every file in its assigned slice in
full (no grep-and-skim) and produced one durable system document. The agent
brief, output template, and review process are documented at the bottom of this
overview.

## When to update

Each individual doc has a "Living reference. Update when behavior changes."
banner. Treat them as part of the system, not a one-off audit. When you ship a
PR that meaningfully changes a slice's behavior, update the corresponding doc in
the same PR. Section 9 (Known Fragility) and Section 14 (Suggested Follow-ups)
are the most volatile — keep them honest.

---

## The 8 slices

### [01 — Prescription Pad](01-prescription-pad.md)
**File:** `web/prescription-pad.html` (7,875 lines)
The doctor's primary clinical surface. Patient selection from today's-visits
combo box; vitals/growth/labs/vaccination panels; clinical-note text+voice+OCR
input with auto-save; AI prescription generation via the 5-tool Edge Function
loop; review with editable rows and dose-band slider; sign-off → DB writes
across 5 tables → bilingual A4 print with pictograms and verification QR.
Largest single file in the repo; richest safety surface.

### [02 — Registration & Lookup](02-registration-and-lookup.md)
**Files:** `web/registration.html` (3,748), `web/patient-lookup.html` (1,284),
`web/verify.html` (382). Reception + nurse cockpit (UHID generation, demographics,
visit creation, vitals with pediatric BP centile, IAP/NHM vaccination checklists,
LOINC-searchable lab entry, document upload with pre-OCR), plus the read-mostly
patient browser used by doctor/admin, plus the public Rx verification page
reached via the printed QR code.

### [03 — Admin & Print](03-admin-and-print.md)
**Files:** `web/formulary.html` (3,643), `web/formulary-import.html` (1,552),
`web/standard-rx.html` (1,837), `web/prescription-output.html` (1,074).
The Print Station is **live and clinical** — auto-loads today's approved Rx
from Supabase and re-renders the pad's print template; carries the same QR/hash
guarantees as the pad. Formulary and Standard-Rx admin tools are anon-key only,
no auth, no audit trail, last-write-wins; staff editing live data while another
doctor is mid-prescription is a documented hazard (in-memory caches stay stale
until reload).

### [04 — Clinical Edge Functions](04-edge-functions-clinical.md)
**Functions:** `generate-prescription` (the 5-tool Claude loop, 772 lines),
`generate-fhir-bundle` (1,680 lines), `generate-visit-summary` (194), plus
`ai-drug-lookup` and `ai-protocol-lookup`. Documents the tool definitions
(`get_reference`, `get_formulary`, `get_standard_rx`, `get_previous_rx`,
`get_lab_history`), the 120-second loop timeout, the single-shot fallback, and
the prompt loading path from Supabase Storage. Pairs with the skill prompt
files in `radhakishan_system/skill/`.

### [05 — ABDM & Documents Edge Functions](05-edge-functions-abdm-and-documents.md)
**Functions:** four `abdm-hip-*` (HIP callbacks: discover, link, consent,
data-transfer), two `abdm-hiu-*` (HIU consent-request, data-receive),
`abdm-identity` (ABHA verify/create/Scan-and-Share), `process-document`
(image/PDF OCR), `transcribe-audio` (voice). Documents the ABDM gateway URLs,
required secrets, and how care-context links and consent artefacts thread
through the database tables.

### [06 — Schema & Data Contracts](06-schema-and-data-contracts.md)
**Files:** `radhakishan_system/schema/*.sql` plus `radhakishan_system/docs/database/*`.
Per-table column/type/null/constraint/FK/index/RLS map for all 13 tables and
3 Storage buckets, an ASCII relationship diagram, and a CHECK-constraint
patient-safety inventory (vital-sign ranges, blood-group enum, dose-range
guards). **Critical:** the live database has drifted from the repo schema
(~50 indexes live vs ~21 in repo, `loinc_investigations` table exists live
but not in repo schema, missing `lab_results` `updated_at` trigger, denormalised
`prescriptions.patient_id`, soft FK on `first_line_drugs[].drug`). Every drift
is enumerated in §12 of the doc.

### [07 — Scripts & Migrations](07-scripts-and-migrations.md)
**Path:** `radhakishan_system/scripts/` — 33 files (28 .js + 5 .sql) grouped
into 11 functional clusters: data import, schema migrations, SNOMED enrichment,
dosing-band population, validation, sample data, integration test, storage
upload, diagnostics, mapping builders, combination. **Critical fragility:**
schema migrations applied via `supabase db query -f` are **not tracked** —
no migration table, no rollback, base DDL has drifted (live `visits` has 7
extra columns, live `standard_prescriptions` has 5 extra). 5 generations of
SNOMED rebuilders coexist with no explicit deprecation. `create_sample_data.js`
is unconditionally destructive across 7 tables with no project-id guard.

### [08 — Specification & Known Issues](08-specification-and-known-issues.md)
**Path:** `radhakishan_system/docs/specification/`, `docs/code-review/`,
`docs/release-notes/`, `docs/planning/`. The "what we already decided" index.
Synthesizes the canonical spec, prior code-review issue lists (resolved vs
open), ABDM adoption plan, voice-transcription upgrade plan, SDK migration
plan, and dated doctor-update notes. Read this before proposing anything that
sounds like a new decision — it may already have been settled.

---

## Cross-cutting truths every reader should know

### Identity, persistence, deployment
- **Single-file pages.** Each `web/*.html` is self-contained (inline CSS+JS).
  No build step. GitHub Pages CI deploys `web/` on push to `main`.
- **Hardcoded credentials.** Supabase URL + anon key are inlined in every web
  page. `KEY` is a JWT exp 2089. Rotation = coordinated edit across ~8 files.
- **Anon-key only / RLS `anon_full_access`.** POC mode. There is no auth, no
  audit trail, no per-user scoping.
- **ID conventions.** Patient UHID = `RKH-YYMM#####` on Indian FY. Prescription
  ID = `RKH-RX-YYMMDD-NNN` (sequential per day). Visit receipt = `RKH-RCT-…`.
  Procedure receipt = `RKH-PRC-…` (per-tab counter, not DB-coordinated).
- **XSS discipline.** `esc()` wraps every dynamic value before innerHTML
  insertion across all pages.

### Data flow at a glance
```
Reception (registration.html)         Nurse (registration.html)         Doctor (prescription-pad.html)
       │                                    │                                       │
       ├─► patients (insert / patch)        ├─► visits (vitals patch)               ├─► visits (raw_dictation autosave)
       ├─► visits (insert)                  └─► lab_results (skipped on edit)       ├─► generate-prescription Edge Fn
       ├─► lab_results (batch insert)                                               │      └─► Claude tool loop ──► formulary, standard_prescriptions, prior Rx, labs, references
       ├─► vaccinations (batch insert)                                              ├─► prescriptions (insert generated_json)
       ├─► documents bucket (uploads)                                               ├─► growth_records (insert if Z-scores)
       └─► generate-visit-summary (fire-and-forget)                                 ├─► vaccinations (insert given-today)
                                                                                    ├─► prescriptions bucket (.txt)
                                                                                    ├─► generate-fhir-bundle (best-effort) ──► prescriptions.fhir_bundle
                                                                                    └─► abdm_care_contexts (best-effort)

Print Station (prescription-output.html)
       └─► prescriptions where is_approved=true and created_at>=today
              └─► same printRx() rendering as the pad

Public Verify (verify.html)
       └─► prescriptions where id=:rx and is_approved=true
              └─► hash check against `rxId+uhid+date+"rkh-salt-2026"` (24-bit SHA-256 prefix)
```

### Safety mechanisms shared across slices
- `esc()` everywhere; `is_approved=eq.true` filter on every Print Station and
  Verify read; sequential Rx-ID + 3-retry UHID; race-guards in
  `onPatientSelect` (`_patientLoadId`); explicit doctor-override rule for AI
  drug substitutions; allergy injection into every Edge Function call;
  max-dose enforcement via `DoseEngine.computeDose`; auto-save with HTTP-error
  surfacing (no silent success); read-only re-load for "done" patients; print
  font/QR-image readiness gate; popup-blocker null-check.

### Known fragility cross-references
- **Schema drift.** §12 of doc 06 + §9 of doc 07. Repo schema is not authoritative.
- **Untracked production migrations.** §9.1 of doc 07.
- **Hardcoded creds in 8 files.** §9 of doc 02 + cross-page note in 03.
- **Realtime publication shape.** Pad subscribes to `realtime:public:visits`;
  if Supabase CDC settings change the WS connects but emits nothing — no
  observability. §7 of doc 01.
- **Live-edit hazards on formulary/standard-rx.** Pad's `formularyCache` is
  stale until reload while admin edits flow live. §9 of doc 03.
- **postMessage to `https://claude.ai`.** Dead artifact-era code in
  `patient-lookup.html`. §9 of doc 02.
- **`api.qrserver.com` external dependency** for printed QRs. §9 of doc 01.
- **Verify hash 24-bit.** Tamper signal, not authn. §7 of doc 02.
- **Procedure receipt collisions across tabs.** §9 of doc 02.

### Unresolved open questions for the domain expert
Each slice doc has its own §13 "Open questions". The recurring themes:
1. NABH "asked, none" allergy state vs blank-ambiguous (doc 02).
2. Same-day visit edit semantics — when reception adds labs after nurse already
   filed, should they append or be dropped (doc 02)?
3. Update-mode `generated_json` overwrite — medico-legal version history (doc 01)?
4. Vaccine `previously_given` rows save with `dose_number: null` — acceptable for
   ABDM/IAP audit (doc 01)?
5. Maximum-dose flag is informational; sign-off is not blocked (doc 01).
6. ABHA on printed QR — PHI exposure consent (doc 01)?
7. Voice-context PII budget over public Edge Function URL (doc 01)?

---

## How to merge this documentation set

The 8 individual docs were each committed on a dedicated branch
(`docs/system-r1-rxpad` … `docs/system-r8-spec-issues`) off `origin/main`. This
overview (`00-overview.md`) was written after all 8 landed and lives on
`chore/io-diagnostic`. Recommended merge plan:

1. Cherry-pick each `docs/system-r*` commit onto a single integration branch
   `docs/system-bundle` off `origin/main`.
2. Cherry-pick this overview commit on top.
3. Open a single PR `docs/system-bundle → main`. No code changes, doc-only,
   no CI risk beyond the existing `deploy-pages.yml` (which only deploys `web/`,
   so adding `radhakishan_system/docs/system/*.md` does not trigger a redeploy).
4. After merge, delete the 8 worktrees and 8 branches.

---

## Appendix — agent reading brief and template

Each agent's brief required:

1. Read every file in the slice **in full**, line by line. No grep-and-skim.
   Grep allowed only to confirm a finding already formed by reading.
2. Output **one markdown file** at `radhakishan_system/docs/system/<NN>-<slug>.md`
   using the 14-section template:
   - 1. Purpose
   - 2. Files in this slice (with line counts)
   - 3. Clinical workflow context
   - 4. Data flow (inputs and outputs in detail)
   - 5. State and storage (local state, DB tables/columns, browser storage)
   - 6. External dependencies (REST endpoints with column projections, Edge
     Functions, third-party APIs, CDN libs)
   - 7. Safety mechanisms (every fallback, retry, defensive check, error path)
   - 8. Configuration knobs (every tunable with the literal value)
   - 9. Known fragility (what's risky to change, what would harm a patient)
   - 10. Why-it-was-built-this-way (with `[Speculation]` where evidence absent)
   - 11. Cross-references (other slices this depends on)
   - 12. Surprises (latent bugs, dead code, unexpected patterns)
   - 13. Open questions for domain expert
   - 14. Suggested follow-ups (read-only observations, NOT a fix list)
3. Strict read-only: no code edits, no DB queries, no commits other than the
   agent's own doc.
4. Agent commits only its doc to its branch. No push.

---

_Generated 2026-04-27. Index curated from R1–R8 reading-agent outputs._
