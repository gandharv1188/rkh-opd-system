# Fixtures — DIS

> Fixtures are the backbone of unit, integration, and clinical acceptance
> tests. They are PHI-sensitive. This document is binding.
>
> See `clinical_acceptance.md` for how fixtures are consumed; this doc
> is about how they are _managed_.

## 1. Location

```
dis/tests/fixtures/
├── preproc/                   # synthetic images for preprocessor unit tests
│   ├── tilt_5deg.jpg
│   ├── perspective.jpg
│   ├── blank.png
│   ├── dup_a.jpg
│   └── dup_b.jpg              # near-duplicate of dup_a
├── routing/                   # small byte stubs for file-router unit tests
│   ├── native_text.pdf
│   ├── scan.pdf
│   ├── image.jpg
│   ├── office.docx
│   └── office.xlsx
├── ocr/                       # for OCR adapter unit tests (recorded responses)
│   └── datalab_recorded/
│       └── <fixture_id>/
│           ├── request.json
│           ├── response.json
│           └── meta.json
├── structuring/               # for structuring adapter tests
│   └── haiku_recorded/
│       └── <fixture_id>/
│           ├── prompt.md
│           ├── response.json
│           └── meta.json
└── clinical/                  # consumed by clinical acceptance suite
    └── <fixture_id>/
        ├── source/<file>      # the anonymized original
        ├── expected/
        │   ├── structured.json
        │   ├── promotion.json
        │   ├── ui_flags.json
        │   └── canonical_edits.json (optional)
        └── fixture.meta.yaml  # metadata block (§3)
```

Path references in tests use `FIXTURES_DIR = tests/fixtures` — no ad-hoc
paths allowed (lint rule).

## 2. Naming convention

- Fixture IDs are **kebab-case**, descriptive, no PHI: e.g.
  `lab-cbc-native-pdf-01`, `discharge-neonate-tsb-serial-02`.
- IDs are globally unique across the `clinical/` folder.
- Numeric suffix `-NN` allows multiple fixtures of the same challenge
  (e.g. `prescription-handwritten-hindi-01`, `prescription-handwritten-hindi-02`).
- File extensions reflect the original type (`.pdf`, `.jpg`, etc.).
- Never encode patient initials, dates of birth, UHIDs, or hospital
  names in filenames.

## 3. Metadata (`fixture.meta.yaml`)

Every clinical fixture has a metadata block:

```yaml
id: lab-cbc-native-pdf-01
category: lab_report # matches document_type enum
source: internal_anonymized # internal_anonymized | synthetic | vendor_sample
original_language: en
challenge_tags: [native_text, table_extraction]
cs_coverage: [] # CS-## this fixture is relevant to
added_by: qa@radhakishanhospital
added_at: 2026-04-20
anonymization:
  method: manual_pdf_redaction # manual_pdf_redaction | synthetic_generation | overlay
  verified_by: clinical_reviewer@...
  verified_at: 2026-04-20
notes: |
  Real CBC from a sibling patient; name box blanked, DOB set to 2020-01-01,
  UHID replaced with TEST-UHID-0001. Values are authentic.
```

Linted by `scripts/validate-fixture-meta.ts` in CI. Missing or invalid
meta = build fail.

## 4. PHI handling (non-negotiable)

### 4.1. Anonymization rules

Every real-source fixture must have:

- Patient name → `TEST PATIENT NN` or fully redacted.
- Guardian name → redacted.
- DOB → shifted to a plausible but fixed test date; year within ±2 of
  original to preserve clinical plausibility.
- UHID / MR number → `TEST-UHID-####`.
- Phone, email, address → redacted.
- Doctor's signature → redacted or replaced with `TEST DOCTOR`.
- Barcode / QR payload — re-encoded to a safe string or blurred.
- Hospital name/logo — replaced with `TEST HOSPITAL` watermark.

**Clinical values (Hb, WBC, drug names, dosages) are preserved verbatim**
— that is the test signal.

### 4.2. Verification

Anonymization is always pair-reviewed:

- Redactor (QA) runs the redaction.
- Clinical reviewer audits and signs the `anonymization.verified_by`
  field in the meta.

### 4.3. Storage

- Fixtures live **in the repo** (they are test assets). The repo is
  private.
- A pre-commit hook (`scripts/fixtures-guard.sh`) runs a naive PII
  detector on any new fixture:
  - OCRs the file and greps for common Indian name prefixes, 10-digit
    mobile regex, 12-digit Aadhaar regex, UHIDs matching the production
    prefix.
  - Any hit blocks the commit pending manual review.
- On detection of suspected un-anonymized content in `main`, the
  incident runbook `09_runbooks/phi_exposure.md` fires.

### 4.4. No production data in fixtures

Do not copy files directly from the `documents` bucket into fixtures.
The flow is: export → redact on a clean workstation → verify → commit.

## 5. Adding a new fixture

1. Open a ticket in `07_tickets/` titled `fixture: add <id>` with:
   - Category, challenge being illustrated, CS-## relevance.
   - Source (real or synthetic).
2. Place the redacted file under `source/<file>`.
3. Write `fixture.meta.yaml`.
4. Run the suite once with `--capture-goldens` to generate
   `expected/structured.json`.
5. Open `expected/structured.json` and review every value against the
   source PDF. Edit anything wrong (the model WILL make mistakes; the
   golden is the **correct** answer, not the model's answer).
6. Add `expected/promotion.json` and `expected/ui_flags.json` either by
   running the approval flow in a scratch DB or by hand.
7. PR is labeled `fixture-add`. Requires clinical-reviewer approval per
   §4.2.

## 6. Updating an existing fixture

Allowed reasons:

- Schema version bump (e.g., `clinical_extraction v1 → v2`).
- Model migration (prompt + provider) with clinical reviewer approval.
- Bug fix in a golden value.

Procedure:

1. PR labeled `golden-update` (see `clinical_acceptance.md` §2).
2. Include a table of fixtures and diffs in the PR description.
3. Clinical reviewer comment: `APPROVED` on the PR with reasoning.
4. Merge.

## 7. Golden-file testing pattern

Test helper:

```ts
// dis/tests/helpers/golden.ts
export async function assertGolden(id: string, actual: ClinicalExtraction): Promise<void> {
  const expected = await readGolden(id); // reads expected/structured.json
  const normalised = normalise(actual); // trim, lowercase raw names, round confidence
  expect(normalised).toStrictEqualWithTolerance(expected, {
    numericTolerance: { 'labs.*.confidence': 0.05 },
    ignorePaths: ['provider_version'], // varies day to day
  });
}
```

Rules:

- Goldens are **not** authoritative AI output — they are the correct
  answer.
- Diffs print with field paths, not JSON blobs, for reviewability.
- A failing golden halts CI. The fix is **one** of: update code, file
  bug, or open `golden-update` PR — never silently update.

## 8. Fixture lifecycle

- `active` — in use by at least one test.
- `retired` — no longer referenced; folder archived under
  `tests/fixtures/_retired/<id>/` with a note in meta explaining why.
- `quarantined` — under review (e.g., suspected PHI leak); test that
  references it is skipped with a tagged `test.skip(..., 'quarantined')`;
  CI reports count of quarantined tests separately (ratchet — can go down,
  not up).

## 9. Minimum coverage targets

At any time, `tests/fixtures/clinical/` must contain at least:

- 5 lab reports (2 native PDF, 2 scans, 1 handwritten).
- 3 discharge summaries (1 neonatal for CS-10, 1 adult, 1 adversarial).
- 2 prescriptions (1 typed, 1 handwritten).
- 2 vaccination cards (1 IAP, 1 UIP).
- 2 radiology reports.
- 4 adversarial / red-team fixtures.

A CI check (`scripts/fixtures-coverage.ts`) enforces this floor.

## 10. Synthetic fixture generation

For scenarios where real anonymized data is hard (e.g., CS-10 7-reading
TSB), synthetic PDFs are generated from LaTeX / HTML templates under
`tests/fixtures/_generators/`. Each generator:

- Produces deterministic output given a seed.
- Writes the generator source alongside the fixture for reproducibility.
- Is categorized `source: synthetic` in meta.
- Still requires clinical reviewer approval of clinical plausibility.
