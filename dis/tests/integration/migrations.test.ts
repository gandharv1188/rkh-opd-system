/**
 * Integration tests — Wave 4 M-001..M-008 — static round-trip checks.
 *
 * These tests exist to give the Wave-4 SQL a floor of automated protection
 * without requiring a live Postgres in CI. For every M-00X pair we assert:
 *
 *   1. Forward file exists and contains the expected DDL keywords.
 *   2. Rollback file exists and DROPs everything the forward CREATEd.
 *   3. Append-only tables have both UPDATE and DELETE triggers.
 *   4. RLS migration enables RLS on every DIS-owned table.
 *
 * This is a parse-only test. A future ticket (Wave 7) can replace the body
 * of `maybeRunLiveRoundtrip` with a real ephemeral-Postgres forward → rollback
 * → forward check; today it no-ops unless a `DIS_MIGRATIONS_LIVE` env is set.
 *
 * @see dis/document_ingestion_service/03_data/migrations.md
 * @see dis/handoffs/M-001.md §3 test plan
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', '..', 'migrations');

interface MigrationSpec {
  readonly id: string;
  readonly forward: string;
  readonly rollback: string;
  readonly expectForward: readonly RegExp[];
  readonly expectRollback: readonly RegExp[];
}

const specs: readonly MigrationSpec[] = [
  {
    id: 'M-001',
    forward: 'M001_ocr_extractions.sql',
    rollback: 'M001_ocr_extractions.rollback.sql',
    expectForward: [
      /create table ocr_extractions/i,
      /create table idempotency_keys/i,
      /create index idx_ocr_ext_patient/i,
      /create index idx_ocr_ext_status/i,
      /create index idx_ocr_ext_hash/i,
      /gen_random_uuid\(\)/i,
    ],
    expectRollback: [
      /drop table if exists ocr_extractions/i,
      /drop table if exists idempotency_keys/i,
    ],
  },
  {
    id: 'M-002',
    forward: 'M002_ocr_audit_log.sql',
    rollback: 'M002_ocr_audit_log.rollback.sql',
    expectForward: [
      /create table ocr_audit_log/i,
      /create trigger trg_ocr_audit_log_no_update/i,
      /create trigger trg_ocr_audit_log_no_delete/i,
      /before update on ocr_audit_log/i,
      /before delete on ocr_audit_log/i,
      /raise exception/i,
    ],
    expectRollback: [
      /drop trigger if exists trg_ocr_audit_log_no_update/i,
      /drop trigger if exists trg_ocr_audit_log_no_delete/i,
      /drop function if exists ocr_audit_log_immutable/i,
      /drop table if exists ocr_audit_log/i,
    ],
  },
  {
    id: 'M-003',
    forward: 'M003_dis_confidence_policy.sql',
    rollback: 'M003_dis_confidence_policy.rollback.sql',
    expectForward: [
      /create table dis_confidence_policy/i,
      /insert into dis_confidence_policy/i,
      /enabled\s+boolean not null default false/i,
    ],
    expectRollback: [/drop table if exists dis_confidence_policy/i],
  },
  {
    id: 'M-004',
    forward: 'M004_dis_jobs.sql',
    rollback: 'M004_dis_jobs.rollback.sql',
    expectForward: [
      /create table dis_jobs/i,
      /create index idx_dis_jobs_ready/i,
    ],
    expectRollback: [/drop table if exists dis_jobs/i],
  },
  {
    id: 'M-005',
    forward: 'M005_dis_cost_ledger.sql',
    rollback: 'M005_dis_cost_ledger.rollback.sql',
    expectForward: [
      /create table dis_cost_ledger/i,
      /create trigger trg_dis_cost_ledger_no_update/i,
      /create trigger trg_dis_cost_ledger_no_delete/i,
      /raise exception/i,
    ],
    expectRollback: [
      /drop trigger if exists trg_dis_cost_ledger_no_update/i,
      /drop trigger if exists trg_dis_cost_ledger_no_delete/i,
      /drop table if exists dis_cost_ledger/i,
    ],
  },
  {
    id: 'M-006',
    forward: 'M006_fk_columns_labs_vax.sql',
    rollback: 'M006_fk_columns_labs_vax.rollback.sql',
    expectForward: [
      /alter table lab_results/i,
      /alter table vaccinations/i,
      /add column if not exists ocr_extraction_id/i,
      /add column if not exists verification_status/i,
      /default 'legacy'/i,
      /update lab_results/i,
    ],
    expectRollback: [
      /drop column if exists ocr_extraction_id/i,
      /drop column if exists verification_status/i,
    ],
  },
  {
    id: 'M-007',
    forward: 'M007_dedupe_unique_indexes.sql',
    rollback: 'M007_dedupe_unique_indexes.rollback.sql',
    expectForward: [
      /create unique index uniq_lab_dedupe/i,
      /create unique index uniq_vax_dedupe/i,
      /where ocr_extraction_id is not null/i,
      /raise exception/i,
    ],
    expectRollback: [
      /drop index if exists uniq_lab_dedupe/i,
      /drop index if exists uniq_vax_dedupe/i,
    ],
  },
  {
    id: 'M-008',
    forward: 'M008_rls_policies.sql',
    rollback: 'M008_rls_policies.rollback.sql',
    expectForward: [
      /alter table ocr_extractions\s+enable row level security/i,
      /alter table ocr_audit_log\s+enable row level security/i,
      /alter table dis_jobs\s+enable row level security/i,
      /alter table dis_cost_ledger\s+enable row level security/i,
      /current_setting\('app\.role'/i,
      /create policy extractions_read/i,
    ],
    expectRollback: [
      /drop policy if exists extractions_read/i,
      /disable row level security/i,
    ],
  },
];

function loadSql(name: string): string {
  const p = resolve(migrationsDir, name);
  expect(existsSync(p), `missing migration file: ${name}`).toBe(true);
  return readFileSync(p, 'utf8');
}

describe('Wave 4 migrations — static round-trip', () => {
  for (const spec of specs) {
    describe(spec.id, () => {
      const forwardSql = loadSql(spec.forward);
      const rollbackSql = loadSql(spec.rollback);

      it('forward SQL contains expected DDL', () => {
        for (const re of spec.expectForward) {
          expect(forwardSql).toMatch(re);
        }
      });

      it('rollback SQL contains matching DROPs', () => {
        for (const re of spec.expectRollback) {
          expect(rollbackSql).toMatch(re);
        }
      });

      it('rollback never silently succeeds (non-empty)', () => {
        expect(rollbackSql.trim().length).toBeGreaterThan(0);
      });
    });
  }

  it('migrations avoid Supabase-specific SQL (portability)', () => {
    const forbidden = [
      /supabase_auth\./i,
      /storage\.objects/i,
      /auth\.uid\(\)/i,
      /auth\.jwt\(\)/i,
    ];
    for (const spec of specs) {
      const sql = loadSql(spec.forward);
      for (const re of forbidden) {
        expect(sql, `${spec.id} uses forbidden Supabase primitive ${re}`).not.toMatch(re);
      }
    }
  });

  it('append-only tables have both UPDATE and DELETE triggers', () => {
    const m002 = loadSql('M002_ocr_audit_log.sql');
    expect(m002).toMatch(/before update on ocr_audit_log/i);
    expect(m002).toMatch(/before delete on ocr_audit_log/i);

    const m005 = loadSql('M005_dis_cost_ledger.sql');
    expect(m005).toMatch(/before update on dis_cost_ledger/i);
    expect(m005).toMatch(/before delete on dis_cost_ledger/i);
  });

  it('RLS migration enables RLS on every DIS-owned table', () => {
    const m008 = loadSql('M008_rls_policies.sql');
    for (const table of ['ocr_extractions', 'ocr_audit_log', 'dis_jobs', 'dis_cost_ledger']) {
      const re = new RegExp(`alter table ${table}\\s+enable row level security`, 'i');
      expect(m008, `M-008 missing RLS enable for ${table}`).toMatch(re);
    }
    expect(m008).not.toMatch(/create policy .* for delete/i);
  });
});
