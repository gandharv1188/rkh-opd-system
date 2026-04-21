# DIS Operational Runbooks

This folder contains the on-call playbooks for the Document Ingestion
Service (DIS). Every runbook is written for the 3 a.m. scenario:
assume the operator is tired, stressed, and has not read the TDD in a
week. Runbooks are **executable** — each step is a command, a
decision, or a link, never "investigate".

## Index

| File                                             | Use when                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`incident_response.md`](incident_response.md)   | Anything smells wrong. Start here. Master playbook: severity, paging, first 15 min, kill-switch, post-mortem.      |
| [`key_rotation.md`](key_rotation.md)             | Scheduled 90-day rotation of Datalab / Anthropic / Supabase keys, or an emergency rotation after a suspected leak. |
| [`migration_incident.md`](migration_incident.md) | A DB migration (M-001..M-009) has failed partway. Do **not** run the next migration.                               |
| [`provider_outage.md`](provider_outage.md)       | Datalab or Anthropic is down. `OCR_PROVIDER_UNAVAILABLE` / `STRUCTURING_PROVIDER_FAILED` spiking.                  |
| [`dr_and_backup.md`](dr_and_backup.md)           | Data loss, accidental delete, corruption. Restore from backup, quarterly restore drill.                            |
| [`stuck_jobs.md`](stuck_jobs.md)                 | Individual extraction stuck, queue backlog, duplicate promotion, confidence oddity.                                |

## On-call rotation

- **Primary on-call:** Backend engineer (see `08_team/RACI.md`).
- **Secondary:** SRE / Ops Engineer.
- **Clinical escalation:** Dr. Lokender Goyal (clinical reviewer,
  `08_team/RACI.md`). Paged for any **SEV1** (clinical-safety incident).
- **Rotation handover:** Monday 09:00 IST. Outgoing on-call writes a
  1-paragraph note in the shared channel listing anything flaky.

## Paging thresholds

| Signal                                           | Threshold            | Severity | Who                       |
| ------------------------------------------------ | -------------------- | -------- | ------------------------- |
| Verified-but-wrong audit rate (CS weekly audit)  | > 0 in a week        | **SEV1** | Primary + Clinical        |
| Any CS-1 / CS-3 / CS-5 / CS-12 violation in logs | 1 event              | **SEV1** | Primary + Clinical        |
| 5xx rate across DIS endpoints                    | > 5% for 5 min       | **SEV2** | Primary                   |
| `OCR_PROVIDER_UNAVAILABLE`                       | > 10 in 5 min        | **SEV2** | Primary                   |
| Queue depth (`dis_jobs` status=`queued`)         | > 200 and growing    | **SEV2** | Primary                   |
| Individual extraction stuck in `ocr` state       | > 5 min              | **SEV3** | Primary (email, not page) |
| Cost spike (`dis_cost_ledger`)                   | > 2x 7-day avg daily | **SEV3** | Primary                   |
| Migration CI check fails on main                 | 1 event              | **SEV2** | Primary                   |

## Conventions used in these runbooks

- Commands shown are copy-pasteable. Where a value must be substituted,
  it appears in `<ANGLE_BRACKETS>`.
- POC environment = Supabase project `ecywxuqhnlkjtdshpcbc`.
- Prod (future) = AWS account per `02_architecture/portability.md`.
- All CS-## references point to `01_product/clinical_safety.md`.
- All TDD §§ references point to `02_architecture/tdd.md`.

## First rule

**If anything is unclear, flip the kill switch and then investigate.**
DIS is a non-critical augmentation layer — reception can fall back to
manual entry (the workflow that existed before DIS shipped). The cost
of 30 min of degraded AI assistance is tiny compared to a single wrong
lab value reaching a prescription.

See `incident_response.md` for the kill-switch decision tree.

## How to use this folder at 3 a.m.

1. **Symptom unclear?** → open `incident_response.md` and work
   top-to-bottom. It will route you.
2. **Symptom is a specific provider failure** → `provider_outage.md`.
3. **Symptom is data missing / wrong / deleted** → `dr_and_backup.md`.
4. **Symptom is a DB migration just failed** → `migration_incident.md`.
5. **Symptom is a key leak or suspected compromise** →
   `key_rotation.md` (emergency section).
6. **Symptom is one extraction misbehaving** → `stuck_jobs.md`.

Every runbook ends with an exit-criteria checklist. Do not declare
"all-clear" until that checklist is fully green.

## What lives elsewhere (not in this folder)

- **Clinical-safety definitions (CS-1 … CS-12):** `01_product/clinical_safety.md`.
- **Error codes & retry semantics:** `04_api/error_model.md`.
- **Architecture / adapter wiring / secret caching:** `02_architecture/tdd.md` and `02_architecture/adapters.md`.
- **Migration order & rollback spec:** `03_data/migrations.md`.
- **Who to page & RACI:** `08_team/RACI.md`.
- **Rollout / kill-switch configuration:** `06_rollout/`.
- **Acceptance fixtures for restore / smoke tests:** `05_testing/`.

## Self-review checklist for runbook authors

When updating a runbook, confirm:

- Every action is a command, a decision, or a link — no "investigate".
- Every command is copy-pasteable with obvious substitutions in
  `<ANGLE_BRACKETS>`.
- Every CS-## or TDD §§ reference is a live link (or at least a
  findable filename).
- Every path has both a POC (Supabase) and a Prod (AWS) variant
  where they differ.
- Every path has a rollback / undo step.
- There is a final exit-criteria block.

## Change log

| Date       | Author | Change                             |
| ---------- | ------ | ---------------------------------- |
| 2026-04-20 | SRE    | Initial set of 7 runbooks created. |
