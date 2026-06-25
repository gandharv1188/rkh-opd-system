---
trace_id: ENG-DISC-09-DATA-MIGRATION-ROLLBACK
title: Data Migration & Rollback Discipline — Expand/Contract, Restore-in-CI, Proven Reversibility, Forward-Fix
status: binding
scope: methodology/governance (spec-independent)
parent_digest: OPERATING-MODEL DIGEST (single source of truth)
parent_canonical: 00_overview/canonical_decisions.md (Part D.1 — this file is the named owner of the migration round-trip gate, restore-drill-in-CI, and the never-drop-cascade enforcement)
last_verified_repo_state: 2026-06-25
owners: [engineering-discipline, gatekeeper-ci, release-captain, data-steward]
supersedes: "radhakishan_supabase_schema.sql lines 12–18 (the `drop table … cascade` clean-slate header)"
related:
  - 03_data/schema_migration.md   (the table-by-table journey this file gates; that file owns the WHAT, this owns the HOW-IT-IS-PROVEN)
  - 03_data/schema_design.md       (P13 forward-only migrations; ON DELETE RESTRICT; CHECK constraints; RLS; immutability triggers)
  - 08_migration/migration_roadmap.md (Phase 5 is the reversibility-critical phase this file's gate guards)
  - 09_engineering_discipline/quality_gates_ci.md (the gate ledger this file's checks slot into)
  - 09_engineering_discipline/change_management_versioning.md (schema versioning, ADRs, release/rollback drills)
  - 09_engineering_discipline/testing_strategy.md (PHI-free fixtures; the dose-engine bar)
  - 09_engineering_discipline/eval_data_governance.md (PHI de-identification of any restored dataset)
---

# Data Migration & Rollback Discipline

> **Purpose.** This file is the **migration-safety contract** for the agent-built rebuild of the Radhakishan pediatric OPD prescription system. It owns *how a schema or data change is proven reversible before it can merge or deploy* — the **expand/contract (backward-compatible) discipline**, the **prod-like dataset seed/restore in CI**, the **proof of reversibility WITHOUT data loss under the live constraint regime (RLS / `ON DELETE RESTRICT` / `CHECK` / immutability triggers)**, the **forward-fix policy**, and the **migration gate** that makes all of the above unbypassable.
>
> **Authority & scope boundary.** This file conforms to the OPERATING-MODEL DIGEST and to `00_overview/canonical_decisions.md`. Where this file and the digest/canonical disagree, the **digest/canonical wins** until amended by an [ADR](change_management_versioning.md#3-adrs). This file is **spec-independent**: it constrains *how migration correctness is proven and how a bad migration is reversed*, not the target product architecture. It is the **methodology twin** of `03_data/schema_migration.md`: that file owns the table-by-table *journey* (source→target mapping, ETL, backfill, dedupe, the cutover); **this file owns the machine-checkable proof** that every step of that journey is reversible without data loss, and the gate that blocks any migration that is not.
>
> **Founding incident (never again).** On 2026-06-25 a hardcoded model id retired and broke production, fixed by guesswork with **no pre-validated rollback**. The data-layer corollary is worse: the prototype ships a `drop table … cascade` "clean slate" DDL header (`radhakishan_supabase_schema.sql:12–18`) — **one mis-run of which destroys live patient data with no reverse gear**. This file exists to make destructive-by-default migration *structurally impossible* and reversibility *machine-proven*, on a live, NABH-accredited, in-clinical-use clinical database.

---

## 0. Axioms this file enforces (inherited, non-negotiable)

| # | Axiom | How migration discipline enforces it |
|---|---|---|
| A1 | **Done = proven + gated, never declared.** | A migration is "done" only when `ci/migration-roundtrip` and `ci/migration-restore-drill` are green and the integrity asserts exit 0 against a prod-like dataset. No migration merges on an author's word that "the down works." |
| A2 | **Enforce in CI, not in convention.** | "We never `drop cascade`", "every migration has a `.rollback.sql`", "the down restores the shape" are **required status checks** (§7), not review etiquette. A grep-lint and a `pg_dump` schema-diff *fail the build*. |
| A3 | **Answer from data, not guesswork.** | Reversibility is proven by running `up → down → up` and a **restore drill on a prod-like dataset**, then diffing — not by reading the SQL and reasoning about it. The dataset is real-shaped (de-identified prod snapshot or a generated prod-faithful seed), not a toy. |
| A4 | **Humans and AI are symmetric actors.** | A migration authored by an agent passes the identical gate as one authored by a human; the `correlation_id` on every migrated row and the audit envelope are the same regardless of `actor`. No "agent migrations get a fast lane." |
| A5 | **Deterministic dose-engine is the dosing source of truth.** | A migration that touches `catalog.formulary` `dosing_bands` / promoted ceiling columns re-runs the formulary Ajv contract **and** the dose-parity gate, because a silent band corruption is a dosing hazard, not a schema cosmetic. |

---

## 1. The five disciplines this file owns (and the one it explicitly does not)

| # | Discipline | One-line definition | Owned here |
|---|---|---|---|
| **D1** | **Expand/contract (parallel-change) migration** | Every schema change is split into a backward-compatible **expand**, a data **migrate**, and a separately-gated **contract** — the old code path keeps working until the new one is proven. | ✅ §2 |
| **D2** | **Prod-like dataset seed/restore in CI** | The migration chain is exercised against a dataset with **production shape, volume, and edge distribution** (a de-identified snapshot or a prod-faithful generated seed), restored fresh in CI — never an empty schema or a 3-row toy. | ✅ §3 |
| **D3** | **Proven reversibility WITHOUT data loss under the constraint regime** | `up → down → up` + a restore drill prove the down path restores the prior schema **and** loses zero rows, **with RLS, `ON DELETE RESTRICT`, `CHECK`, and immutability triggers all live** — the constraints that make a naive rollback fail. | ✅ §4 |
| **D4** | **Forward-fix policy** | Once a migration has run against production data, the default recovery is a **new forward migration**, not a `down` in prod; `down` is a *pre-production* proof tool and a *narrow, gated* in-flight escape hatch. | ✅ §5 |
| **D5** | **The migration gate** | The unbypassable CI contract that blocks merge/deploy unless D1–D4 are demonstrably satisfied; folds in the **migration round-trip gate**, the **restore-drill-in-CI gate**, the **never-`drop … cascade`** enforcement, and the **abort-on-duplicate ETL** guard. | ✅ §6–§7 |
| — | The **table-by-table mapping/ETL itself** | Which source column becomes which target column; the mojibake fix; the concept upserts. | ❌ owned by `03_data/schema_migration.md`; this file *gates* it. |

> **Canonical-decisions binding (Part D.1).** `00_overview/canonical_decisions.md` names **this file** as the single owner of: (a) the migration round-trip gate (`up → down → up` + `pg_dump` schema-diff), (b) the restore-drill-in-CI gate, (c) the "never `drop … cascade`" enforcement, and (d) the abort-on-duplicate ETL guard. They are folded into §6–§7 below so **no migration gate is ownerless**.

---

## 2. D1 — Expand / Contract (backward-compatible) migration discipline

A clinical database cannot take a maintenance window casually and cannot take a destructive DDL at all. The only safe shape of change is **parallel-change**: the new shape is added *alongside* the old, data is moved, the application is cut over behind a flag, and only then — separately, last, and gated — is the old shape retired. This is the **P13** principle from `03_data/schema_design.md` made into a discipline.

### 2.1 The three phases of every change

```
        EXPAND  (additive, backward-compatible)         MIGRATE  (data)              CONTRACT  (tighten, last, gated)
   ┌────────────────────────────────────┐   ┌────────────────────────────┐   ┌──────────────────────────────────────┐
   │ ADD columns/tables/indexes NULLABLE │   │ Backfill legacy → new with  │   │ Promote nullable→NOT NULL;            │
   │ ADD new constraints as NOT VALID    │   │ verification_status='legacy'│   │ VALIDATE CONSTRAINT (no full lock);   │
   │ ADD new RLS policies DARK           │   │ Reconcile drift (RX↔visit)  │   │ add the composite FK once drift=0;    │
   │ Old app/columns UNCHANGED & readable│   │ Idempotent, re-runnable     │   │ retire legacy public.* to READ-ONLY   │
   │ → ZERO downtime, ZERO behaviour drift│   │ Abort-on-duplicate pre-flight│   │   (NEVER dropped) → §4 boundary        │
   └────────────────────────────────────┘   └────────────────────────────┘   └──────────────────────────────────────┘
        reversible: drop empty objects          reversible: TRUNCATE target        reversible: re-enable legacy writes
```

- **Expand is always backward-compatible.** A column is added **nullable** (or with a default that does not rewrite the table — Postgres 16 adds a non-volatile default without a full rewrite, but a volatile default is forbidden in an expand). A new constraint is added `NOT VALID` first, then `VALIDATE CONSTRAINT` in the contract phase so the expand never takes an `ACCESS EXCLUSIVE` lock long enough to stall reception. A new index is `CREATE INDEX CONCURRENTLY`. A new RLS policy is created in the expand but is harmless ("dark") because the legacy anon path never touches the new schemas.
- **Migrate is data-only and idempotent.** It copies legacy rows forward (`verification_status='legacy'`), upserts concepts, reconciles drift. It uses `INSERT … ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE` so a partial re-run never errors. It runs an **abort-on-duplicate pre-flight** (§6.4) before any new `UNIQUE` is introduced.
- **Contract is the only place anything tightens, and it is the last, separately-gated step.** It promotes `NULL → NOT NULL`, runs `VALIDATE CONSTRAINT` on the `NOT VALID` constraints, adds the composite FK `(visit_id, patient_id) REFERENCES clinical.visits(id, patient_id)` **only after drift = 0**, and sets legacy `public.*` tables **read-only (RLS revoke of write) — never `DROP`**. Contract is the hard rollback boundary (§4.3).

### 2.2 The expand/contract rules (machine-checkable where possible)

| Rule | Statement | Enforcement |
|---|---|---|
| **X1** | **No migration is both expanding and contracting.** Adding a column and dropping another in the same file is forbidden — they have different rollback semantics and different blast radii. | Lint: a single migration may not contain both an additive (`ADD COLUMN`/`CREATE TABLE`) and a tightening (`DROP`/`SET NOT NULL`/`VALIDATE CONSTRAINT`) statement (warn→fail). |
| **X2** | **New columns ship nullable; constraints ship `NOT VALID`.** | Lint: `ADD COLUMN … NOT NULL` without a non-volatile default in an expand-phase file fails; `ADD CONSTRAINT … CHECK/FOREIGN KEY` in an expand file must carry `NOT VALID`. |
| **X3** | **New indexes are `CONCURRENTLY`.** | Lint: `CREATE INDEX` (non-concurrent) on a populated target table fails. |
| **X4** | **`NOT NULL` / `VALIDATE` / mandatory FK live only in a contract-phase file**, after the data is proven. | Filename phase tag (`…_contract_*`) + lint pairing. |
| **X5** | **Contract never drops a clinical table.** Legacy retirement is `REVOKE`/read-only RLS, not `DROP TABLE`. | The never-drop-cascade gate (§6.3). |
| **X6** | **Every phase is reversible to the state before it.** Expand→drop the empty objects; migrate→truncate the target (legacy intact); contract→re-enable legacy writes. | The round-trip + restore-drill gates (§6.1–§6.2). |

### 2.3 Why this is the only acceptable shape here

The legacy app, the new service, a returning patient mid-consult, a nurse saving vitals, and a doctor signing an Rx may all be live during cutover (`03_data/schema_migration.md §3`). Expand/contract means the new schema is **already current** at the instant of the flag flip, so cutover is a sub-second flag change, and **every intermediate state is a valid, readable database** — there is no window in which a crash leaves a half-migrated table that the app cannot read. That property is what makes reversibility (§4) *possible at all*.

---

## 3. D2 — Prod-like dataset seed / restore in CI

A migration that passes against an empty schema or a hand-typed 3-row fixture proves nothing about the live system. The defects that bite — mojibake in real formulary JSON, duplicate ICD-10 protocols, `RX↔visit` drift, non-contiguous UHID sequences, rows that violate a new `CHECK` only at production scale — exist **only in production-shaped data**. The migration gate therefore runs against a dataset with **production shape, volume class, and edge distribution**.

### 3.1 What "prod-like" means (the dataset contract)

| Property | Requirement | Why |
|---|---|---|
| **Shape** | Identical column set, types, and JSONB structure to the live baseline (`origin/sprint-2-saved:…20260428000000_baseline_from_live.sql`). | A migration must meet the real schema, not an idealized one. |
| **Volume class** | At least the live order of magnitude per table (≈ 570 patients, ≈ 600+ visits, hundreds of prescriptions, 530 drugs, 446 protocols, 77,922 LOINC). Volume governs lock duration and `CONCURRENTLY` behaviour. | A `CREATE INDEX` that is instant on 10 rows can stall reception on 78k. |
| **Edge distribution** | Carries the **known source defects** deliberately (mojibake rows, a duplicate-ICD-10 pair, at least one `RX↔visit` drift row, a non-contiguous UHID gap, a placeholder dosing band). | The gate must *exercise* the dedupe abort, the drift reconciler, and the quarantine path — not skip them because the toy data was clean. |
| **PHI status** | **Zero real PHI.** Either a **de-identified** snapshot (names/DOB/contact/guardian/free-text scrubbed and surrogate-substituted, structure preserved) or a **generated prod-faithful seed**. | DPDP + the global safety rule: no patient data in fixtures, logs, or CI. De-identification proof is owned by `eval_data_governance.md`; this file *requires* it. |

### 3.2 Two acceptable sources (both PHI-free)

1. **De-identified prod snapshot (preferred for fidelity).** A `pg_dump` (custom format) of the live DB, run through a **deterministic de-identification pass** *before it ever leaves the prod boundary*: scrub/surrogate every PII column (P-spec from `06_security`), strip free-text `raw_dictation`/`visit_summary`/document text, retain structure, dose-relevant numbers, codes, and the deliberate defect rows. The de-id transform itself is versioned, reviewed, and its output is PHI-scanned (`ci/eval-phi-scan`, owned by `eval_data_governance.md`) before any CI run touches it.
2. **Generated prod-faithful seed (preferred for hermeticity).** A versioned seed script that emits the same shape/volume/edge distribution from synthetic data — no de-id step needed because it was never real. The 530-drug / 446-protocol KB seeds from the **cleaned repo JSON** (it is reference, not PHI); patients/visits/prescriptions are synthesized with the defect rows injected on purpose.

> **Default:** the **generated prod-faithful seed** is the merge-gate dataset (hermetic, fast, no de-id dependency, runs on every PR). The **de-identified snapshot** is the heavier **staging dress-rehearsal** dataset (run on release and on a schedule), because it catches shape drift the generator's authors did not anticipate. Both are gates; they differ in cadence (§7).

### 3.3 The restore step (fresh every run)

```
RESTORE DRILL (per CI run, ephemeral Postgres 16 service):
  1. createdb migrate_ci                                  # clean cluster, no residue
  2. psql < seed/prod_like_baseline.sql                   # OR: pg_restore de-identified snapshot
  3. record pre = { per-table row counts, content hashes } # the baseline truth
  4. scripts/migrate.sh up                                 # EXPAND → MIGRATE → VERIFY (asserts) → (CONTRACT in the contract job)
  5. run …validate_integrity.sql                          # hard asserts, exit 0 or fail the gate
  6. (round-trip job) migrate down → migrate up; pg_dump --schema-only diff == empty
  7. (no-data-loss job) record post = counts/hashes; assert NO clinical row lost vs pre (§4)
  8. dropdb migrate_ci
```

The restore is **fresh per run** so no state leaks between PRs, and it uses the **same `scripts/migrate.sh`** the real deploy uses (dbmate is the source of truth on both Supabase POC and AWS RDS) — the CI proof and the production run are the *same* code path, not a CI-only approximation.

---

## 4. D3 — Proven reversibility WITHOUT data loss, under the constraint regime

This is the heart of the file. "Reversible" is not "there is a `.rollback.sql`." It is: **running the down path restores the exact prior schema AND loses zero rows AND succeeds with RLS, `ON DELETE RESTRICT`, `CHECK`, and immutability triggers all enforced.** Those constraints are precisely what make a naive rollback fail, so the proof must run *with them on*.

### 4.1 The constraint regime that a rollback must survive

The target schema (`03_data/schema_design.md`) makes four properties load-bearing — and each one is a rollback hazard if a `.rollback.sql` is written carelessly:

| Constraint | Where | The rollback hazard | The discipline that defuses it |
|---|---|---|---|
| **`ON DELETE RESTRICT`** on every clinical/prescribing FK | `schema_design §6.x` — `patients`, `visits`, `prescriptions`, drafts, jobs, audit | A `.rollback.sql` that tries to `DELETE`/`TRUNCATE` a parent during a down step **fails loudly** (RESTRICT is the loud failure — by design). A rollback must therefore truncate **child→parent in dependency order**, or not delete clinical rows at all. | Rollback semantics are **phase-typed** (§4.2): backfill-down `TRUNCATE`s targets in reverse-dependency order; clinical parents are never deleted post-cutover (forward-fix instead, §5). |
| **`CHECK` constraints** (medical ranges; enum domains: `sex ∈ ('male','female','other')`, `overall_status ∈ ('SAFE','REVIEW_REQUIRED')`, `severity_final ∈ ('none','moderate','high')`, `verification_status` enums) | `schema_design §5–§6` | A down path that re-introduces a legacy column with a **looser/different** domain (e.g. title-case `'Male'`) re-inserts rows the forward `CHECK` would have rejected — a silent integrity regression. | The round-trip gate diffs the **full** `pg_dump --schema-only` including `CHECK` text; a down path that does not restore the *exact* prior constraint fails. Canonical enum values (C2/C3 of `canonical_decisions`) are pinned so a rollback cannot resurrect a retired spelling. |
| **RLS (per-role, JWT-derived)** | `schema_design §12`; `…rls_policies.sql` deployed dark | A migration run **as a restricted role** can silently skip rows it cannot see, making a backfill look complete when it lost data; a rollback as `service_role` can over-delete. | Migrations run as the **migration role with RLS bypass for the migration session only** (`SET LOCAL role`), explicit and audited; the no-data-loss assert (§4.4) counts rows **with RLS bypassed** so the count is the true count, not the visible count. |
| **Immutability triggers** (`BEFORE UPDATE/DELETE … RAISE` on `ops.audit_log`, `ops.cost_ledger`, `prescribing.rx_versions`, signed prescriptions) | `schema_design §11.3, P6` | A `.rollback.sql` that tries to `UPDATE`/`DELETE` an append-only table **cannot** — the trigger raises. So append-only data is, by construction, **not reversible by deletion**. | Append-only tables are **never targeted by a destructive down**; their rollback is "leave the rows, they are evidence." The down path for an audit/ledger migration drops *the trigger and table only if the table is empty in the expand-down case*; populated append-only data is forward-fixed (§5), never rolled back. |

### 4.2 Phase-typed rollback semantics (what each `.rollback.sql` is allowed to do)

| Phase | `.rollback.sql` may | `.rollback.sql` must NOT | Data safety proof |
|---|---|---|---|
| **EXPAND** | `DROP` the **new, empty** schema objects (tables/columns/indexes/policies it created). | Drop or alter any `public.*` legacy object; drop a populated target. | New objects hold no authoritative data yet → drop is lossless by definition; restore drill confirms `public.*` byte-identical after down. |
| **MIGRATE (backfill)** | `TRUNCATE` the migrated **target** tables (in reverse-dependency order to satisfy RESTRICT). | Touch `public.*`; delete any row in a parent that a child RESTRICTs. | Legacy `public.*` is the source of truth and is untouched → re-running the backfill reproduces the target exactly; restore drill asserts legacy counts unchanged. |
| **VERIFY** | no-op (read-only asserts). | — | Nothing changed. |
| **RLS / counters** | drop policies / drop counter table. | Drop a clinical table. | Policies/counters carry no clinical rows. |
| **CONTRACT** | re-enable legacy writes (drop the read-only RLS), set promoted columns back to nullable, `DROP CONSTRAINT` on the validated FK/CHECK, **re-create** any index it dropped. | `DROP` any clinical/prescribing/audit table; delete clinical rows. | The **hard rollback boundary** (§4.3): nothing was destroyed, so reverse = loosen, not restore-from-backup. |

### 4.3 The contract boundary — why reversibility holds even past cutover

Because **CONTRACT never drops a clinical table** (X5/§6.3) and legacy `public.*` is retired to **read-only, not deleted**, there is always a known-good state to return to:

- **Before cutover** (expand/backfill/verify fails): `dbmate down` the backfill, fix the ETL, re-run. The legacy app never noticed. RTO: minutes.
- **At cutover** (flag flipped, smoke red): flip the feature flag back to the legacy schema; in-window writes are mirrored by the dual-write trigger / replayed from `ops.outbox`. RTO: seconds.
- **Post-cutover, pre-CONTRACT**: flag back to legacy; reconcile new-schema-only writes back to `public.*` via the bidirectional dual-write trigger. `public.*` is still fully writable. RTO: minutes.
- **Post-CONTRACT**: legacy is read-only but **present**. Roll back = re-enable legacy writes (drop the read-only RLS), flag to legacy, **forward-fix** the new schema offline. **Zero rows lost** because nothing was dropped. RTO: < 1 hour.

This staircase is owned operationally by `03_data/schema_migration.md §6.2`; **this file owns the proof** that each step is loss-free (§4.4) and the gate that blocks any migration whose down path would violate it.

### 4.4 The no-data-loss assertion (the proof, not the promise)

```
NO-DATA-LOSS GATE (runs inside the restore drill, RLS bypassed for the count session):
  pre  := { for each clinical/catalog/prescribing table: row_count, sha256(canonical-ordered rows) }
  RUN  up (expand → migrate → verify)
  mid  := snapshot
  assert  every legacy public.* count in `mid` == its count in `pre`     # backfill read-only on legacy
  assert  every target table count == expected(pre, quarantine_manifest)  # incl. documented quarantine deltas
  RUN  down (phase-appropriate)
  post := snapshot
  assert  every legacy public.* count/hash in `post` == `pre`             # the down restored, lost nothing
  assert  NO append-only row (audit_log/cost_ledger/rx_versions) was deleted by any down  # immutability honoured
  IF any assert fails → gate RED → merge blocked
```

The hashes are over **canonical-ordered** rows so ordering noise is not a false diff; the quarantine manifest accounts for every ETL-rejected row so "fewer rows than source" is only ever *documented* quarantine, **never a silent drop**. This is the literal machine-checkable definition of "reversible without data loss."

---

## 5. D4 — Forward-fix policy

`down` migrations are **proof tools and pre-production / in-flight escape hatches — not the production recovery default.** Once a migration has run against *real* production data, rolling it *down* in production risks exactly the data loss this file exists to prevent (a down that drops a column drops the data in it). The default recovery is a **new forward migration**.

### 5.1 The policy, stated as a decision tree

```
A migration N is found defective.
│
├─ Has N run against PRODUCTION data yet?
│   │
│   ├─ NO (caught in CI / staging / shadow)
│   │     → roll DOWN (the proven `.rollback.sql`), fix N in place is forbidden;
│   │       author a NEW migration N' (never edit a shipped file — schema_migration §2 rule),
│   │       re-run the gate. RTO: minutes.
│   │
│   └─ YES (already applied to prod)
│         → DO NOT roll down in prod by default.
│           Author a NEW forward migration N+1 that corrects the defect
│           (add the missing column, relax the bad CHECK additively, re-backfill the bad rows).
│           N+1 is itself expand/contract, gated, reversible-in-CI.
│           EXCEPTION (narrow, gated): if N is pre-CONTRACT, additive-only, and its down is
│           proven loss-free for the CURRENT data (re-run the §4.4 assert against a prod-like
│           snapshot first), a down MAY be used as an in-flight escape — with release-captain
│           sign-off (Critical risk tier, human confirm even with auto-approve).
│
└─ Is the defect a clinical-data corruption (wrong dose band, dropped clinical row)?
      → STOP. This is the never-event class. Restore-from-backup (PITR / snapshot) is the floor;
        human confirm is mandatory (global safety rule). Then forward-fix.
```

### 5.2 Why forward-fix is the default (the rationale)

- **A production `down` is itself an untested-against-current-data destructive operation.** The `.rollback.sql` was proven loss-free against the dataset at *author time*; production has drifted (new patients, new prescriptions) since. A down that was safe in CI can drop rows added since. A forward migration is *additive* and can be proven against *current* data.
- **Forward-fix preserves the audit narrative.** Rolling down erases the fact that the defect existed; a forward correction leaves both N and N+1 in the migration log and the `ops.audit_log`, which is what NABH/DPDP traceability wants.
- **It composes with expand/contract.** A forward fix is just another expand/contract change — same gate, same reversibility proof. There is no second machinery to maintain.

### 5.3 What is still required of every `down`

Forward-fix-by-default does **not** excuse a missing or fake `down`. Every migration **must** ship a real, proven `.rollback.sql` because the down is:
- the **round-trip gate's** subject (`up → down → up`, §6.1) — a migration with no working down cannot prove its forward is clean;
- the **pre-production rollback** (CI/staging/shadow), where down *is* the recovery;
- the **narrow in-flight escape** of §5.1.

A `.rollback.sql` that is a no-op or a `-- TODO` fails the gate (§6.1).

---

## 6. D5 — The migration gate (the folded-in, unbypassable checks)

The migration gate is the set of required CI status checks that make D1–D4 impossible to skip. It folds in the four checks `canonical_decisions.md` Part D.1 assigns to this file. All run inside the prod-like restore drill (§3.3) so they test real shape, not a toy.

### 6.1 `ci/migration-roundtrip` — the round-trip gate (MERGE-blocking)

```
GIVEN  every migration in this PR (and the full chain it composes with)
WHEN   run against a fresh prod-like dataset:
         dbmate up   → dbmate down → dbmate up
THEN   pg_dump --schema-only AFTER the second up  ==  pg_dump --schema-only after the first up   (byte-identical)
  AND  the down path executed with RLS / RESTRICT / CHECK / immutability triggers LIVE (no DISABLE)
  AND  no `.rollback.sql` is a no-op / TODO / empty
  ANY divergence → RED → merge blocked.
```

The schema-diff includes constraint text (so a `CHECK` that comes back with a different domain fails), index definitions, RLS policy bodies, and trigger definitions — the full structural fingerprint. This is the canonical "every migration ships `NNN_name.sql` + `NNN_name.rollback.sql`; CI runs up→down→up and diffs `pg_dump --schema-only`" rule (`schema_design §13`, P13) made the owner's gate.

### 6.2 `ci/migration-restore-drill` — restore-drill-in-CI gate (MERGE + DEPLOY)

```
GIVEN  the prod-like dataset (generated seed on every PR; de-identified snapshot on release/schedule)
WHEN   restored fresh and the full chain run up to (and including, in the contract job) CONTRACT
THEN   …validate_integrity.sql exits 0  (row-count parity, zero orphans, RX↔visit drift = 0,
         composite-FK pre-check, no mojibake remains, quarantine accounted, counter monotonicity)
  AND  the §4.4 NO-DATA-LOSS assert passes (legacy counts/hashes unchanged after down; no append-only deletes)
  AND  the abort-on-duplicate pre-flight (§6.4) ran and was clean (or aborted with the offending keys — see §6.4)
  ANY failure → RED.  On release, this re-runs on the heavier de-identified snapshot before promote.
```

This is the canonical "CI runs it against a restored prod snapshot in staging" requirement (`schema_migration §5.4, §8.1`) made the owner's gate, generalized to a generated prod-faithful seed on the PR boundary so it gates **every** migration, not only release.

### 6.3 `ci/no-destructive-ddl` — the never-`drop … cascade` enforcement (MERGE-blocking)

```
A grep/AST lint over migrations/**:
  FAIL on:  DROP TABLE … CASCADE                 (against any table)
            DROP SCHEMA … CASCADE                (outside an EXPAND-phase down of a NEW empty schema)
            TRUNCATE … CASCADE                   (in any forward migration)
            DROP TABLE  (of a clinical/prescribing/catalog/audit table) in ANY forward file
            DELETE FROM clinical.* / prescribing.* / *.audit_log   in a forward migration
  ALLOW (narrowly):
            DROP INDEX CONCURRENTLY  in a *_contract_* file, only on a proven idx_scan=0 index,
              and only after the index-settling window — itself reversible by re-CREATE.
            DROP of a NEW empty object inside its own EXPAND-phase .rollback.sql.
```

This is the direct successor to the forbidden `radhakishan_supabase_schema.sql:12–18` clean-slate header. The lint is **fail-closed**: if it cannot prove a `DROP` targets a new-empty object, it blocks. It is owned here per Part D.1 and surfaced in the `quality_gates_ci.md` ledger as a fitness-adjacent required check.

### 6.4 The abort-on-duplicate ETL guard (folded in; runs inside the migrate phase)

Every backfill that introduces a new `UNIQUE` runs a `DO $$ … RAISE EXCEPTION` **dry-run first** (the `dis/` M-007 pattern), so a constraint violation **aborts with the offending keys printed** rather than failing opaquely mid-`CREATE UNIQUE INDEX`:

```sql
-- e.g. before catalog.protocols  UNIQUE (icd10, category, severity)
do $$
declare dup_count int; dup_sample text;
begin
  select count(*), string_agg(k, ', ') into dup_count, dup_sample
  from (
    select icd10 || '|' || coalesce(category,'∅') || '|' || coalesce(severity,'any') as k
    from public.standard_prescriptions group by 1 having count(*) > 1 limit 10
  ) d;
  if dup_count > 0 then
    raise exception 'protocols dedupe abort: % colliding (icd10,category,severity). Sample: %',
      dup_count, dup_sample;
  end if;
end $$;
```

The same guard protects `catalog.formulary.generic_name`, `clinical.patients.uhid`, `prescribing.prescriptions.rx_no`, and the OCR-origin lab/vax dedupe. In CI, the prod-like dataset **carries a deliberate duplicate** (§3.1) so the gate proves the abort *fires* — a guard that never triggers in test is not a proven guard. An abort is a **clean, intended failure** (data needs human dedupe), not a flaky one; it surfaces the keys for a six-eye fix and is re-run after.

### 6.5 The dose-safety re-trigger (A5 coupling)

If a migration in the PR touches `catalog.formulary` `dosing_bands` or any promoted dose-ceiling column, the gate **additionally** re-runs the `formulary.v1.json` Ajv contract over the migrated rows **and** triggers `ci/dose-parity` (the byte-for-byte JS↔TS golden-parity gate, `canonical_decisions` Part C). A schema migration is not allowed to silently change a number the dose engine reads.

### 6.6 Gate-ledger placement (where these slot into `quality_gates_ci.md`)

| This file's check | Boundary | Maps to ledger |
|---|---|---|
| `ci/migration-roundtrip` | MERGE | new required check; sibling to G5 contract / G8 fitness |
| `ci/migration-restore-drill` | MERGE + DEPLOY (heavier on release) | new required check; release re-run alongside G5/G9 |
| `ci/no-destructive-ddl` | MERGE | fitness-adjacent (G8 family) |
| abort-on-duplicate ETL | MERGE (inside restore-drill) | folded into `ci/migration-restore-drill` |
| dose-safety re-trigger | MERGE | composes G5 (formulary Ajv) + `ci/dose-parity` (Part C) |

All are under branch protection on `main` (config-as-code, owned by `branch_protection_and_required_checks.md`); none can be self-attested past (A1/A2). **Fails closed:** if a check cannot determine whether a change is migration-affecting, it treats it as affecting and runs.

---

## 7. Cadence — what runs when

| Trigger | Dataset | Checks run | Why |
|---|---|---|---|
| **Every PR touching `migrations/**` or schema-adjacent code** | generated prod-faithful seed (hermetic, fast) | round-trip, restore-drill (up→VERIFY, no-data-loss), no-destructive-DDL, abort-on-dup, dose re-trigger if relevant | gate every migration on real shape without a de-id dependency |
| **Release ref / tag** | de-identified prod snapshot (heavier, higher-fidelity) | full restore-drill **including CONTRACT**, integrity asserts, no-data-loss across the full chain | catch shape drift the generator's authors missed; prove the contract step before prod |
| **Scheduled (nightly/weekly)** | de-identified prod snapshot | full chain + a **restore-from-backup drill** (PITR/snapshot restore to a throwaway DB, integrity asserts) | "an untested backup is not a backup" (`schema_migration §6.3`); keep the last-resort floor proven |
| **Phase-0 / pre-EXPAND / pre-CONTRACT (operational)** | live prod | `pg_dump` backup taken + a staging restore verified before the destructive-adjacent step | the operational rehearsal `migration_roadmap` Phase 0 mandates |

The **restore-from-backup drill** is this file's check that the PITR/snapshot floor under the whole plan (`migration_roadmap §6.3`) actually restores — rehearsed, not assumed.

---

## 8. The migration PR contract (Definition-of-Done, machine-checkable)

A migration PR is "done" only when **all** hold (encoded in the PR template + required checks; an actor cannot self-attest past them):

- [ ] **Expand/contract honoured** — the change is split; no file both expands and contracts (X1); new columns nullable, constraints `NOT VALID`, indexes `CONCURRENTLY` (X2–X3); tightening only in a `_contract_*` file (X4). *(lint + phase tags)*
- [ ] **Every forward migration has a real, proven `.rollback.sql`** — no no-op/TODO. *(`ci/migration-roundtrip`)*
- [ ] **`up → down → up` + `pg_dump` schema-diff empty**, with RLS/RESTRICT/CHECK/immutability triggers live. *(`ci/migration-roundtrip`)*
- [ ] **Restore drill green on a prod-like dataset** — `…validate_integrity.sql` exits 0; row-count parity; zero orphans; `RX↔visit` drift = 0; composite-FK pre-check passes; no mojibake; quarantine accounted; counter monotonicity. *(`ci/migration-restore-drill`)*
- [ ] **No data loss proven** — §4.4 assert green: legacy counts/hashes unchanged after the down; no append-only row deleted. *(`ci/migration-restore-drill`)*
- [ ] **No destructive DDL** — no `drop … cascade`, no `DROP TABLE` of a clinical/audit/catalog table, no clinical `DELETE` in a forward migration. *(`ci/no-destructive-ddl`)*
- [ ] **Abort-on-duplicate guard present and exercised** — the dedupe pre-flight runs and *fires* against the deliberate-duplicate fixture. *(inside restore-drill)*
- [ ] **Dose-safety re-trigger green if formulary/dosing touched** — `formulary.v1.json` Ajv + `ci/dose-parity`. *(§6.5)*
- [ ] **Forward-fix discipline** — if correcting a prod-applied migration, the fix is a **new forward migration**, not an edit of a shipped file or a default prod `down`. *(review + §5)*
- [ ] **Risk tier + sign-off** — any CONTRACT-phase or clinical-data-touching migration is **High → mandatory human review**; any backup-touching/destructive-adjacent step is **Critical → explicit human confirm even with auto-approve** (global safety rule). *(CODEOWNERS / HITL)*
- [ ] **ADR present** if the change alters the schema contract version or the migration strategy. *(`ci/adr-check`)*

---

## 9. Honest caveats (carry into every migration)

- **A prod-like seed is faithful, not identical.** The generated seed reproduces *known* defects; production can hold a defect class the generator's authors never imagined. The de-identified-snapshot release gate exists precisely to catch that — but it, too, is only as complete as the last snapshot. Keep the snapshot recent.
- **De-identification can leak.** A de-id pass that misses a free-text PHI fragment puts real patient data in CI. The PHI scanner (`ci/eval-phi-scan`, owned by `eval_data_governance.md`) is the backstop, but **prefer the generated seed for the high-frequency PR gate** so real data is touched as rarely as possible.
- **Reversibility ≠ safety of the *forward* change.** The round-trip gate proves the *shape* round-trips; it does not prove the *forward migration is clinically correct*. Correctness of the data transform is the integrity asserts' job (and, for dosing, the dose-parity gate). Both must be green.
- **`down` is a CI/staging tool, not a prod button.** The single most dangerous misreading of "reversible" is "I can roll back in prod whenever." Past CONTRACT, the answer is **forward-fix**, with PITR as the only floor and a human in the loop. This file makes the down *prove* the forward; it does not license a casual production down.
- **This is engineering rigor, not regulatory clearance.** No machine gate certifies a medical device; **mandatory physician sign-off and severe-error gating remain the clinical backstop.** The migration gate prevents *data* harm (loss/corruption); it does not adjudicate clinical correctness.

---

## 10. Cross-references

| Concern | Owning document |
|---|---|
| Table-by-table source→target mapping, ETL, backfill, cutover orchestration, the operational rollback staircase | `03_data/schema_migration.md` (the journey; this file gates it) |
| Target schema shape, P13 forward-only migrations, `ON DELETE RESTRICT`, `CHECK` domains, RLS, immutability triggers, server-side counters | `03_data/schema_design.md` |
| Phase 5 (reversibility-critical DB migration) sequencing, the three-tier rollback strategy, shadow→cutover | `08_migration/migration_roadmap.md` §3.1(C), §5, §6 |
| The gate ledger these checks slot into; branch protection; fails-closed principle | `09_engineering_discipline/quality_gates_ci.md`; `branch_protection_and_required_checks.md` |
| Schema versioning, ADR discipline, release/rollback drills, the model-retirement firewall | `09_engineering_discipline/change_management_versioning.md` |
| Prod-like dataset de-identification PROOF, the PHI scanner gate, prod-miss → fixture loop | `09_engineering_discipline/eval_data_governance.md` |
| The byte-for-byte dose-engine parity gate (`ci/dose-parity`) the dose re-trigger calls | `00_overview/canonical_decisions.md` Part C; `09_engineering_discipline/testing_strategy.md` |
| Canonical enum values a rollback must not resurrect (`sex`, `overall_status`, `severity_final`, UHID grammar) | `00_overview/canonical_decisions.md` Part A (C1–C3) |

### Key source files this discipline is built from (read-only)

- `radhakishan_system/schema/radhakishan_supabase_schema.sql:12–18` — the forbidden `drop table … cascade` clean-slate header this file's `ci/no-destructive-ddl` gate supersedes.
- `origin/feat/dis-plan:dis/migrations/M001–M008` (+ each `.rollback.sql`) — the up/down pairing, M-002 immutability triggers, M-007 abort-on-duplicate, M-008 portable RLS templates.
- `origin/sprint-2-saved:supabase/migrations/20260428000000_baseline_from_live.sql` — the live-shape baseline the prod-like dataset must match.
- `origin/fix/io-indexes:radhakishan_system/scripts/migration_io_indexes.sql` — the `idx_scan=0` "DO NOT RUN AS PART OF" list governing the only permitted `DROP INDEX CONCURRENTLY`.
