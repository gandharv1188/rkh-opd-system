import { describe, it, expect } from 'vitest';
import {
  buildPromotionPlan,
  type VerifiedExtraction,
  type ExistingRowHints,
} from '../../src/core/promotion.js';

const baseExtraction = (overrides: Partial<VerifiedExtraction> = {}): VerifiedExtraction => ({
  extractionId: 'ext-1',
  patientId: 'pat-1',
  verifiedBy: 'nurse-1',
  verifiedAt: '2026-04-20T10:00:00Z',
  documentType: 'lab_report',
  documentDate: '2026-04-20',
  labs: [],
  vaccinations: [],
  documentPatch: null,
  ...overrides,
});

const emptyHints: ExistingRowHints = {
  labKeys: new Set<string>(),
  vaxKeys: new Set<string>(),
};

describe('buildPromotionPlan — CS-10 discharge-summary latest-only', () => {
  it('collapses 7 TSB readings on a discharge_summary to the single latest date', () => {
    const extraction = baseExtraction({
      documentType: 'discharge_summary',
      labs: [
        {
          testNameNormalized: 'TSB',
          valueNumeric: 15.1,
          unit: 'mg/dL',
          testDate: '2026-04-14',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 14.0,
          unit: 'mg/dL',
          testDate: '2026-04-15',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 13.2,
          unit: 'mg/dL',
          testDate: '2026-04-16',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 12.0,
          unit: 'mg/dL',
          testDate: '2026-04-17',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 10.5,
          unit: 'mg/dL',
          testDate: '2026-04-18',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 9.1,
          unit: 'mg/dL',
          testDate: '2026-04-19',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 8.2,
          unit: 'mg/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
      ],
    });

    const plan = buildPromotionPlan(extraction, emptyHints);

    expect(plan.labInserts).toHaveLength(1);
    expect(plan.labInserts[0]?.testDate).toBe('2026-04-20');
    expect(plan.labInserts[0]?.valueNumeric).toBe(8.2);
    expect(plan.skipped.filter((s) => s.entity === 'lab').length).toBe(6);
    expect(
      plan.skipped.every((s) => s.entity !== 'lab' || s.reason === 'discharge_summary_superseded'),
    ).toBe(true);
  });

  it('keeps discharge-summary latest row per distinct test_name', () => {
    const extraction = baseExtraction({
      documentType: 'discharge_summary',
      labs: [
        {
          testNameNormalized: 'TSB',
          valueNumeric: 15.1,
          unit: 'mg/dL',
          testDate: '2026-04-14',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 8.2,
          unit: 'mg/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'Hb',
          valueNumeric: 10.0,
          unit: 'g/dL',
          testDate: '2026-04-14',
          flag: 'low',
          testCategory: 'Hematology',
        },
        {
          testNameNormalized: 'Hb',
          valueNumeric: 12.0,
          unit: 'g/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Hematology',
        },
      ],
    });

    const plan = buildPromotionPlan(extraction, emptyHints);
    expect(plan.labInserts).toHaveLength(2);
    const names = plan.labInserts.map((l) => l.testName).sort();
    expect(names).toEqual(['Hb', 'TSB']);
  });
});

describe('buildPromotionPlan — non-discharge documents preserve all rows', () => {
  it('lab_report with 3 labs promotes 3 rows, no dedup across dates', () => {
    const extraction = baseExtraction({
      documentType: 'lab_report',
      labs: [
        {
          testNameNormalized: 'TSB',
          valueNumeric: 15.1,
          unit: 'mg/dL',
          testDate: '2026-04-14',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 12.0,
          unit: 'mg/dL',
          testDate: '2026-04-17',
          flag: 'high',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'TSB',
          valueNumeric: 8.2,
          unit: 'mg/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
      ],
    });

    const plan = buildPromotionPlan(extraction, emptyHints);
    expect(plan.labInserts).toHaveLength(3);
    expect(plan.skipped.filter((s) => s.entity === 'lab')).toHaveLength(0);
  });
});

describe('buildPromotionPlan — CS-11 duplicate-row skip', () => {
  it('second promotion of the same extraction inserts zero rows (all dupes)', () => {
    const extraction = baseExtraction({
      documentType: 'lab_report',
      labs: [
        {
          testNameNormalized: 'TSB',
          valueNumeric: 8.2,
          unit: 'mg/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
        {
          testNameNormalized: 'Hb',
          valueNumeric: 12.0,
          unit: 'g/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Hematology',
        },
      ],
    });

    const firstPlan = buildPromotionPlan(extraction, emptyHints);
    expect(firstPlan.labInserts).toHaveLength(2);

    const hintsAfterFirst: ExistingRowHints = {
      labKeys: new Set(
        firstPlan.labInserts.map(
          (l) => `${l.patientId}|${l.testName}|${l.testDate}|${l.valueNumeric ?? ''}`,
        ),
      ),
      vaxKeys: new Set<string>(),
    };

    const secondPlan = buildPromotionPlan(extraction, hintsAfterFirst);
    expect(secondPlan.labInserts).toHaveLength(0);
    expect(secondPlan.skipped.filter((s) => s.entity === 'lab')).toHaveLength(2);
    expect(secondPlan.skipped.every((s) => s.reason === 'duplicate_pkid_match')).toBe(true);
  });

  it('skipped rows carry entity + reason + original input', () => {
    const extraction = baseExtraction({
      documentType: 'lab_report',
      labs: [
        {
          testNameNormalized: 'TSB',
          valueNumeric: 8.2,
          unit: 'mg/dL',
          testDate: '2026-04-20',
          flag: 'normal',
          testCategory: 'Biochemistry',
        },
      ],
    });
    const hints: ExistingRowHints = {
      labKeys: new Set(['pat-1|TSB|2026-04-20|8.2']),
      vaxKeys: new Set<string>(),
    };
    const plan = buildPromotionPlan(extraction, hints);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.entity).toBe('lab');
    expect(plan.skipped[0]?.reason).toBe('duplicate_pkid_match');
    expect(plan.skipped[0]?.input).toBeDefined();
  });
});

describe('buildPromotionPlan — vaccination dedup', () => {
  it('same vaccine+date+dose is skipped on re-promotion', () => {
    const extraction = baseExtraction({
      documentType: 'vaccination_card',
      vaccinations: [
        { vaccineNameNormalized: 'BCG', dateGiven: '2026-01-10', doseNumber: 1 },
        { vaccineNameNormalized: 'OPV0', dateGiven: '2026-01-10', doseNumber: 0 },
      ],
    });
    const firstPlan = buildPromotionPlan(extraction, emptyHints);
    expect(firstPlan.vaxInserts).toHaveLength(2);

    const hints: ExistingRowHints = {
      labKeys: new Set<string>(),
      vaxKeys: new Set(
        firstPlan.vaxInserts.map(
          (v) => `${v.patientId}|${v.vaccineName}|${v.dateGiven}|${v.doseNumber ?? 0}`,
        ),
      ),
    };
    const secondPlan = buildPromotionPlan(extraction, hints);
    expect(secondPlan.vaxInserts).toHaveLength(0);
    expect(secondPlan.skipped.filter((s) => s.entity === 'vax')).toHaveLength(2);
    expect(secondPlan.skipped.every((s) => s.reason === 'duplicate_pkid_match')).toBe(true);
  });
});

describe('buildPromotionPlan — document patch', () => {
  it('passes through the documentPatch unchanged', () => {
    const extraction = baseExtraction({
      documentPatch: {
        visitId: 'v-1',
        documentUrl: 'https://example/doc.pdf',
        ocrExtractionId: 'ext-1',
        ocrVerificationStatus: 'verified',
      },
    });
    const plan = buildPromotionPlan(extraction, emptyHints);
    expect(plan.documentPatch).not.toBeNull();
    expect(plan.documentPatch?.ocrVerificationStatus).toBe('verified');
  });
});
