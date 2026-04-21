# Integration Hold — Tickets Awaiting Gatekeeper Approval

> **BINDING:** no ticket in this file may be pulled into active work
> without the Integration Gatekeeper's (Dr. Lokender Goyal) written
> `INTEGRATION APPROVED` note in the ticket thread.
>
> Worker agents cannot select tickets from this file.
> The Architect cannot move them into `in_progress.md` without the note.

---

## Policy

Tickets land here when they carry the `integration` tag — i.e. they
touch any of:

- Files under `web/`
- Existing Edge Functions under `supabase/functions/` (including
  `process-document`, `generate-visit-summary`, `generate-prescription`)
- The live Radhakishan Supabase database (schema or data)
- Any integration point that makes DIS visible to existing users

## The held tickets (Epic G)

Each ticket below keeps its full Verify-Driven detail in
`backlog.md` under Epic G. The one-liners here are the index;
dry-run verification commands (all tagged `[STAGING ONLY]`) live
alongside the ticket body in `backlog.md` per `verify_format.md` §9.

### DIS-200 — Apply M-001..M-008 to LIVE Supabase [HELD]

- **Tags:** `integration`, `migration`, `clinical-safety` (CS-5)
- **Files allowed:** `dis/scripts/apply-live.mjs`, `dis/migrations/M-001..M-008` (no edits here)
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Applies the additive M-001..M-008 migrations to the live Radhakishan Supabase project; no data mutation.

**VERIFY:** see `backlog.md` DIS-200 (all steps `[STAGING ONLY]` until approval lifts the hold).

**Status:** HELD

### DIS-201 — Add FK columns to `lab_results` + `vaccinations` (M-006 live) [HELD]

- **Tags:** `integration`, `migration`, `clinical-safety` (CS-10, CS-11)
- **Files allowed:** `dis/migrations/M-006_*.sql`, `dis/scripts/apply-m006-live.mjs`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Adds nullable `ocr_extraction_id` FK columns to `lab_results` and `vaccinations` on the live DB; constraint stays nullable until DIS-208.

**VERIFY:** see `backlog.md` DIS-201 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-202 — Wire `registration.html` upload to DIS `/ingest` [HELD]

- **Tags:** `integration`, `ui`, `clinical-safety` (CS-1)
- **Files allowed:** `web/registration.html`, `web/assets/dis-ingest-client.js`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Client-side helper that POSTs uploads to DIS `/ingest` behind a feature flag (default OFF).

**VERIFY:** see `backlog.md` DIS-202 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-203 — Enable shadow mode in `process-document` Edge Function [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-1, CS-9)
- **Files allowed:** `supabase/functions/process-document/index.ts`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Teaches the legacy Edge Function to fan out uploads to DIS in shadow mode — both paths write, behaviour unchanged for users.

**VERIFY:** see `backlog.md` DIS-203 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-204 — Filter `loadRecentLabs()` by `verification_status` [HELD]

- **Tags:** `integration`, `ui`, `clinical-safety` (CS-1, CS-3)
- **Files allowed:** `web/prescription-pad.html`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Hides unverified DIS labs from the prescription-pad labs panel while preserving legacy rows.

**VERIFY:** see `backlog.md` DIS-204 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-205 — Filter `get_lab_history` tool output by `verification_status` [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-1)
- **Files allowed:** `supabase/functions/generate-prescription/index.ts` (only the `get_lab_history` handler)
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Mirrors DIS-204's filter server-side so Claude never sees unverified labs.

**VERIFY:** see `backlog.md` DIS-205 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-206 — Opt-in rollout per reception clerk [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-9)
- **Files allowed:** `supabase/migrations/dis_operator_flags.sql`, `web/registration.html`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Per-operator flag so specific clerks can adopt the new flow without global rollout.

**VERIFY:** see `backlog.md` DIS-206 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-207 — Default rollout (DIS becomes primary) [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-1, CS-9)
- **Files allowed:** `web/registration.html`, `supabase/functions/process-document/index.ts`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Flips the default to DIS-primary; legacy path remains available by explicit opt-out.

**VERIFY:** see `backlog.md` DIS-207 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-208 — Apply cutover migration M-009 [HELD]

- **Tags:** `integration`, `migration`, `clinical-safety` (CS-10, CS-11)
- **Files allowed:** `dis/migrations/M-009_*.sql`, `dis/scripts/apply-m009-live.mjs`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Backfills a legacy sentinel extraction, then promotes the FK to NOT NULL on new rows.

**VERIFY:** see `backlog.md` DIS-208 (all steps `[STAGING ONLY]`).

**Status:** HELD

### DIS-209 — Delete legacy `process-document` Edge Function [HELD]

- **Tags:** `integration`, `clinical-safety` (CS-9)
- **Files allowed:** `supabase/functions/process-document/**` (deletion only); `dis/document_ingestion_service/10_handoff/legacy-retired.md`
- **Execution gate:** INTEGRATION APPROVED required per review_gates.md §6b.

**Description:** Retires the legacy `process-document` Edge Function after a quiet period (per rollout plan); records the retirement.

**VERIFY:** see `backlog.md` DIS-209 (all steps `[STAGING ONLY]`).

**Status:** HELD

## Approval format

In the ticket thread (or via a signed commit on `feat/dis-plan`), the
Integration Gatekeeper writes:

> **INTEGRATION APPROVED — DIS-### — <name>, <date>**
>
> Scope: <what specifically is being approved to integrate>
> Preconditions confirmed: <list>
> Rollback plan acknowledged: yes/no
> Applies to phase: <Phase 0 / 1 / 2 / 3 / 4>

Anything less than this format is not an approval.

## Auto-revocation

An approval applies to the specific ticket named. It does **not**
extend to:

- Related tickets
- Later phases
- Retries after rollback

Each re-attempt requires a fresh approval.
