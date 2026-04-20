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

### DIS-200 — Apply M-001..M-008 to LIVE Supabase **[HELD]**

### DIS-201 — Add FK columns to `lab_results` + `vaccinations` (M-006 live) **[HELD]**

### DIS-202 — Wire `registration.html` upload to DIS `/ingest` **[HELD]**

### DIS-203 — Enable shadow mode in `process-document` Edge Function **[HELD]**

### DIS-204 — Filter `loadRecentLabs()` by `verification_status` **[HELD]**

### DIS-205 — Filter `get_lab_history` tool output by `verification_status` **[HELD]**

### DIS-206 — Opt-in rollout per reception clerk **[HELD]**

### DIS-207 — Default rollout (DIS becomes primary) **[HELD]**

### DIS-208 — Apply cutover migration M-009 **[HELD]**

### DIS-209 — Delete legacy `process-document` Edge Function **[HELD]**

Each ticket's full detail is in `backlog.md` under Epic G. They remain
in `Ready` status pending approval; once approved, each moves to
`in_progress.md` one at a time with explicit phasing per
`06_rollout/rollout_plan.md`.

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
