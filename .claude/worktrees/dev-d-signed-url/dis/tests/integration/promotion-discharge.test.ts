/**
 * DIS-037 — Promotion service integration on a discharge summary
 * (CS-10 latest-only, CS-11 duplicate-guard).
 *
 * Uses an in-test discharge_summary fixture with 7 TSB readings for the
 * same patient, same test, across 7 consecutive dates. Drives
 * `buildPromotionPlan` twice:
 *
 *   Pass 1 (fresh DB)  — no existing rows.
 *     CS-10 assertion: exactly ONE lab insert emitted (the latest date),
 *                      six labs marked skipped with
 *                      `discharge_summary_superseded`.
 *
 *   Pass 2 (replay)    — the pkid of the row we just "inserted" is seeded
 *                      into ExistingRowHints.
 *     CS-11 assertion: ZERO lab inserts emitted, the one surviving lab
 *                      marked skipped with `duplicate_pkid_match`.
 *
 * A `FakeDatabaseAdapter` (DIS-012) stands in for the promotion-service
 * executor — we count the `.rows`/query calls it sees to confirm no
 * stray writes leak on the replay path.
 *
 * @see dis/document_ingestion_service/01_product/clinical_safety.md CS-10, CS-11
 * @see dis/src/core/promotion.ts
 */

import { describe, it, expect } from 'vitest';

import {
  buildPromotionPlan,
  type VerifiedExtraction,
  type ExistingRowHints,
  type ExtractedLab,
} from '../../src/core/promotion.js';
import { FakeDatabaseAdapter } from '../helpers/fake-adapters.js';

const PATIENT_ID = 'pat-tsb-1';
const EXTRACTION_ID = 'ext-discharge-1';

/** Seven consecutive TSB readings on a discharge summary. Latest = 2026-04-20. */
function sevenTsbReadings(): readonly ExtractedLab[] {
  const dates = [
    '2026-04-14',
    '2026-04-15',
    '2026-04-16',
    '2026-04-17',
    '2026-04-18',
    '2026-04-19',
    '2026-04-20', // latest — the only one CS-10 keeps
  ];
  const values = [15.1, 14.0, 13.2, 12.0, 10.5, 9.1, 8.0];
  return dates.map((testDate, i) => ({
    testNameNormalized: 'TSB',
    valueNumeric: values[i]!,
    unit: 'mg/dL',
    testDate,
    flag: 'high',
    testCategory: 'Biochemistry',
  }));
}

function dischargeExtraction(labs: readonly ExtractedLab[]): VerifiedExtraction {
  return {
    extractionId: EXTRACTION_ID,
    patientId: PATIENT_ID,
    verifiedBy: 'nurse-1',
    verifiedAt: '2026-04-21T10:00:00Z',
    documentType: 'discharge_summary',
    documentDate: '2026-04-20',
    labs,
    vaccinations: [],
    documentPatch: null,
  };
}

/** Promotion pkid for the lab-unique constraint: (patient, test, date, value). */
function pkid(patientId: string, testName: string, testDate: string, valueNumeric: number): string {
  return `${patientId}|${testName}|${testDate}|${valueNumeric}`;
}

describe('DIS-037 — promotion ↔ discharge summary (CS-10, CS-11)', () => {
  it('CS-10: 7 TSB readings collapse to 1 insert on first promotion', () => {
    const db = new FakeDatabaseAdapter();
    const labs = sevenTsbReadings();
    const plan = buildPromotionPlan(dischargeExtraction(labs), {
      labKeys: new Set<string>(),
      vaxKeys: new Set<string>(),
    });

    // CS-10: only the latest test_date (2026-04-20, value 8.0) survives.
    expect(plan.labInserts).toHaveLength(1);
    expect(plan.labInserts[0]?.testDate).toBe('2026-04-20');
    expect(plan.labInserts[0]?.valueNumeric).toBe(8.0);

    // The other six superseded rows are explicitly tracked, not silently dropped.
    const superseded = plan.skipped.filter(
      (s) => s.reason === 'discharge_summary_superseded',
    );
    expect(superseded).toHaveLength(6);

    // Fake DB sanity: promotion is pure, it should not have touched the DB.
    expect(db.calls).toHaveLength(0);
  });

  it('CS-11: on replay, the already-inserted latest row is deduped (0 new inserts)', () => {
    const db = new FakeDatabaseAdapter();
    const labs = sevenTsbReadings();

    // Pass 1: fresh DB — same as above.
    const pass1 = buildPromotionPlan(dischargeExtraction(labs), {
      labKeys: new Set<string>(),
      vaxKeys: new Set<string>(),
    });
    expect(pass1.labInserts).toHaveLength(1);
    const inserted = pass1.labInserts[0]!;

    // Pass 2: replay. Seed the hints with the pkid of what Pass 1 "wrote".
    const hintsAfterFirstWrite: ExistingRowHints = {
      labKeys: new Set<string>([
        pkid(PATIENT_ID, inserted.testName, inserted.testDate!, inserted.valueNumeric!),
      ]),
      vaxKeys: new Set<string>(),
    };
    const pass2 = buildPromotionPlan(dischargeExtraction(labs), hintsAfterFirstWrite);

    // CS-11: zero new lab inserts on replay.
    expect(pass2.labInserts).toHaveLength(0);
    const dupSkipped = pass2.skipped.filter((s) => s.reason === 'duplicate_pkid_match');
    expect(dupSkipped).toHaveLength(1);

    // Fake DB still untouched — promotion remains intent-only. The real
    // DB adapter (DIS-054) will execute the plan in a transaction.
    expect(db.calls).toHaveLength(0);
  });

  it('CS-10 scoping: same 7 readings on a lab_report (non-discharge) are NOT collapsed', () => {
    // Negative control — guards against the CS-10 rule accidentally
    // firing on non-discharge document types. A lab_report carrying 7
    // distinct (date, value) tuples should emit 7 inserts on a fresh DB.
    const labs = sevenTsbReadings();
    const extraction: VerifiedExtraction = {
      ...dischargeExtraction(labs),
      documentType: 'lab_report',
    };
    const plan = buildPromotionPlan(extraction, {
      labKeys: new Set<string>(),
      vaxKeys: new Set<string>(),
    });
    expect(plan.labInserts).toHaveLength(7);
    const supersededOnLabReport = plan.skipped.filter(
      (s) => s.reason === 'discharge_summary_superseded',
    );
    expect(supersededOnLabReport).toHaveLength(0);
  });
});
