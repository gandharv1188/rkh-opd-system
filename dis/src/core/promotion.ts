/**
 * DIS-023 — Promotion plan builder.
 *
 * Pure function that converts a verified extraction into an intent-only
 * PromotionPlan. It does NOT execute SQL. The DatabasePort adapter is
 * responsible for running the plan inside a transaction.
 *
 * Implements TDD §13 and clinical-safety rules:
 *   CS-10 — discharge_summary: latest-only per test_name_normalized.
 *   CS-11 — duplicate-row skip on (patient, test_name, test_date, value_numeric)
 *            and (patient, vaccine_name, date_given, dose_number).
 */

export type DocumentType =
  | 'lab_report'
  | 'prescription'
  | 'discharge_summary'
  | 'radiology'
  | 'vaccination_card'
  | 'other';

export type LabFlag = 'normal' | 'low' | 'high' | 'critical' | 'unknown';

export type TestCategory = 'Hematology' | 'Biochemistry' | 'Microbiology' | 'Imaging' | 'Other';

export type ExtractedLab = {
  readonly testNameNormalized: string;
  readonly valueNumeric: number | null;
  readonly valueText?: string | null;
  readonly unit: string | null;
  readonly referenceRange?: string | null;
  readonly flag: LabFlag;
  readonly testCategory: TestCategory;
  readonly testDate: string | null;
};

export type ExtractedVaccination = {
  readonly vaccineNameNormalized: string;
  readonly dateGiven: string | null;
  readonly doseNumber: number | null;
  readonly site?: string | null;
  readonly batchNo?: string | null;
};

export type DocumentPatch = {
  readonly visitId: string;
  readonly documentUrl: string;
  readonly ocrExtractionId: string;
  readonly ocrVerificationStatus: 'verified' | 'auto_approved' | 'pending_review' | 'rejected';
};

export type VerifiedExtraction = {
  readonly extractionId: string;
  readonly patientId: string;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly documentType: DocumentType;
  readonly documentDate: string | null;
  readonly labs: readonly ExtractedLab[];
  readonly vaccinations: readonly ExtractedVaccination[];
  readonly documentPatch: DocumentPatch | null;
};

export type LabInsert = {
  readonly patientId: string;
  readonly ocrExtractionId: string;
  readonly testName: string;
  readonly valueNumeric: number | null;
  readonly valueText: string | null;
  readonly unit: string | null;
  readonly referenceRange: string | null;
  readonly flag: LabFlag;
  readonly testCategory: TestCategory;
  readonly testDate: string | null;
  readonly verificationStatus: 'verified';
  readonly verifiedBy: string;
  readonly verifiedAt: string;
};

export type VaxInsert = {
  readonly patientId: string;
  readonly ocrExtractionId: string;
  readonly vaccineName: string;
  readonly dateGiven: string | null;
  readonly doseNumber: number | null;
  readonly site: string | null;
  readonly batchNo: string | null;
  readonly verificationStatus: 'verified';
  readonly verifiedBy: string;
  readonly verifiedAt: string;
};

export type SkippedRow = {
  readonly entity: 'lab' | 'vax';
  readonly reason: string;
  readonly input: unknown;
};

export type PromotionPlan = {
  readonly labInserts: readonly LabInsert[];
  readonly vaxInserts: readonly VaxInsert[];
  readonly documentPatch: DocumentPatch | null;
  readonly skipped: readonly SkippedRow[];
};

export type ExistingRowHints = {
  readonly labKeys: ReadonlySet<string>;
  readonly vaxKeys: ReadonlySet<string>;
};

const labKey = (
  patientId: string,
  testName: string,
  testDate: string | null,
  valueNumeric: number | null,
): string => `${patientId}|${testName}|${testDate ?? ''}|${valueNumeric ?? ''}`;

const vaxKey = (
  patientId: string,
  vaccineName: string,
  dateGiven: string | null,
  doseNumber: number | null,
): string => `${patientId}|${vaccineName}|${dateGiven ?? ''}|${doseNumber ?? 0}`;

/**
 * CS-10: for discharge_summary, keep only the latest row per
 * test_name_normalized. Ties broken by array order (last wins).
 * Non-discharge docs pass through untouched.
 */
const applyDischargeSummaryLatestOnly = (
  labs: readonly ExtractedLab[],
  documentType: DocumentType,
): { kept: readonly ExtractedLab[]; superseded: readonly ExtractedLab[] } => {
  if (documentType !== 'discharge_summary') {
    return { kept: labs, superseded: [] };
  }
  const latestByTest = new Map<string, ExtractedLab>();
  for (const lab of labs) {
    const prev = latestByTest.get(lab.testNameNormalized);
    if (!prev) {
      latestByTest.set(lab.testNameNormalized, lab);
      continue;
    }
    const prevDate = prev.testDate ?? '';
    const curDate = lab.testDate ?? '';
    if (curDate >= prevDate) {
      latestByTest.set(lab.testNameNormalized, lab);
    }
  }
  const keptSet = new Set<ExtractedLab>(latestByTest.values());
  const kept: ExtractedLab[] = [];
  const superseded: ExtractedLab[] = [];
  for (const lab of labs) {
    if (keptSet.has(lab)) kept.push(lab);
    else superseded.push(lab);
  }
  return { kept, superseded };
};

export const buildPromotionPlan = (
  verifiedExtraction: VerifiedExtraction,
  existingRowHints: ExistingRowHints,
): PromotionPlan => {
  const skipped: SkippedRow[] = [];

  const { kept: labsAfterCs10, superseded } = applyDischargeSummaryLatestOnly(
    verifiedExtraction.labs,
    verifiedExtraction.documentType,
  );
  for (const s of superseded) {
    skipped.push({ entity: 'lab', reason: 'discharge_summary_superseded', input: s });
  }

  const labInserts: LabInsert[] = [];
  for (const lab of labsAfterCs10) {
    const key = labKey(
      verifiedExtraction.patientId,
      lab.testNameNormalized,
      lab.testDate,
      lab.valueNumeric,
    );
    if (existingRowHints.labKeys.has(key)) {
      skipped.push({ entity: 'lab', reason: 'duplicate_pkid_match', input: lab });
      continue;
    }
    labInserts.push({
      patientId: verifiedExtraction.patientId,
      ocrExtractionId: verifiedExtraction.extractionId,
      testName: lab.testNameNormalized,
      valueNumeric: lab.valueNumeric,
      valueText: lab.valueText ?? null,
      unit: lab.unit,
      referenceRange: lab.referenceRange ?? null,
      flag: lab.flag,
      testCategory: lab.testCategory,
      testDate: lab.testDate,
      verificationStatus: 'verified',
      verifiedBy: verifiedExtraction.verifiedBy,
      verifiedAt: verifiedExtraction.verifiedAt,
    });
  }

  const vaxInserts: VaxInsert[] = [];
  for (const vax of verifiedExtraction.vaccinations) {
    const key = vaxKey(
      verifiedExtraction.patientId,
      vax.vaccineNameNormalized,
      vax.dateGiven,
      vax.doseNumber,
    );
    if (existingRowHints.vaxKeys.has(key)) {
      skipped.push({ entity: 'vax', reason: 'duplicate_pkid_match', input: vax });
      continue;
    }
    vaxInserts.push({
      patientId: verifiedExtraction.patientId,
      ocrExtractionId: verifiedExtraction.extractionId,
      vaccineName: vax.vaccineNameNormalized,
      dateGiven: vax.dateGiven,
      doseNumber: vax.doseNumber,
      site: vax.site ?? null,
      batchNo: vax.batchNo ?? null,
      verificationStatus: 'verified',
      verifiedBy: verifiedExtraction.verifiedBy,
      verifiedAt: verifiedExtraction.verifiedAt,
    });
  }

  return {
    labInserts,
    vaxInserts,
    documentPatch: verifiedExtraction.documentPatch,
    skipped,
  };
};
