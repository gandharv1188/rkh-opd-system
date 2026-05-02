# Unit Test Suites — DIS Core

> Scope: pure business logic under `dis/src/core/`. Composed with fakes
> only (see `adapters.md` §Fakes). Runs on every PR. Target: < 5 s total.
>
> Every test lists the CS-##, user story, or TDD § it implements. No test
> without a reference.

## File layout

```
dis/tests/unit/
├── orchestrator.test.ts
├── state-machine.test.ts
├── confidence-policy.test.ts
├── promotion.test.ts
├── audit-log.test.ts
├── file-router.test.ts
├── preprocessor.test.ts
└── structuring.test.ts       (covers CS-9)
```

---

## 1. `orchestrator.test.ts` — TDD §4 (state machine) + §5 (idempotency)

Purpose: the `IngestionOrchestrator` glues ports together and drives
`ocr_extractions.status` transitions. All ports injected as fakes.

1. `creates extraction in status=uploaded on fresh Idempotency-Key` — TDD §5
2. `returns existing extraction on duplicate Idempotency-Key with identical payload` — TDD §5
3. `returns IDEMPOTENCY_KEY_CONFLICT when same key is reused with a different payload hash` — error_model
4. `routes native_text path: uploaded → structuring → ready_for_review` — TDD §7
5. `routes ocr_scan path: uploaded → preprocessing → ocr → structuring → ready_for_review` — TDD §7, §8
6. `records latencyMs and cost_micro_inr on every port call into dis_cost_ledger fake` — TDD §14
7. `surfaces OCR_PROVIDER_UNAVAILABLE and parks extraction in status=failed with retryable=true` — error_model
8. `does not transition to ready_for_review until structuring returns schema-valid JSON` — TDD §11
9. `respects DIS_KILL_SWITCH=1 by returning 503 UNAVAILABLE before any port call` — DIS-US-032
10. `correlation_id is stable across all port calls within one ingestion` — TDD §14

## 2. `state-machine.test.ts` — TDD §4

Tests the pure transition table. No ports.

1. `uploaded → preprocessing is valid` — TDD §4
2. `uploaded → ocr is invalid (must go through preprocessing)` — TDD §4
3. `ready_for_review → verified is valid` — DIS-US-012
4. `ready_for_review → rejected is valid` — DIS-US-014
5. `rejected → verified throws InvalidStateTransition` — CS-5
6. `promoted → rejected throws InvalidStateTransition` — CS-5
7. `failed → uploaded is invalid (retry creates new extraction, not reset)` — DIS-US-003
8. `every transition emits an event payload {from, to, actor, at}` — CS-6
9. `auto_approved is reachable only when confidence policy enabled=true` — CS-7
10. `terminal states (verified, rejected, promoted, failed) have no outbound edges except audit reads` — CS-5

## 3. `confidence-policy.test.ts` — CS-7, TDD §12

Tests the policy evaluator. Policy JSON provided inline.

1. `default policy (enabled=false) returns {auto_approve:false} for every extraction` — CS-7
2. `enabled=true policy with labs.auto_approve_if=confidence>=0.95 approves a 0.97 labs-only extraction` — TDD §12
3. `mixed extraction (labs 0.97, medications 0.8) returns auto_approve:false because medications rule is false` — TDD §12
4. `rule referencing unknown field_path raises PolicyEvaluationError (never silently approves)` — CS-7
5. `policy change without actor_id is rejected` — CS-7
6. `evaluator returns per-field rule_results for audit storage in policy_decision column` — CS-7
7. `activating a new policy deactivates the previous one (single-active invariant)` — data_model
8. `block_type guard: labs rule requires block_type='table'; non-table input → not auto-approved` — TDD §12
9. `enabled policy with empty rules array → auto_approve:false` — CS-7
10. `policy evaluator is pure (same input → same decision object, deep-equal)` — TDD §1

## 4. `promotion.test.ts` — CS-10, CS-11, TDD §13

Tests `PromotionService` with in-memory fake database.

1. `CS-10: discharge_summary with 7 TSB readings across 7 dates → 1 row with max(test_date)` — CS-10
2. `CS-10: dedupe is by test_name_normalized, not test_name_raw` — CS-9, CS-10
3. `CS-10: lab_report (not discharge_summary) does NOT dedupe — all rows promoted` — CS-10
4. `CS-11: second run of same extraction inserts 0 rows, audit log shows one skip per prior row` — CS-11
5. `CS-11: duplicate check key is (patient_id, test_name, test_date, value_numeric)` — CS-11
6. `CS-11: two different values for same (patient,test,date) both insert (not considered duplicate)` — CS-11
7. `promotion runs in a single transaction — one invalid row fails all` — TDD §13
8. `on transaction failure, extraction returns to ready_for_review with error_code=PROMOTION_FAILED` — TDD §13
9. `promotion_result JSON records {labs_inserted, labs_skipped, vax_inserted, vax_skipped}` — DIS-US-012
10. `rejected extraction cannot be promoted (guard before transaction even starts)` — CS-5
11. `promotion sets lab_results.ocr_extraction_id and verification_status='verified'` — CS-1, CS-3

## 5. `audit-log.test.ts` — CS-6, TDD §14

Tests `AuditLogger` and its append-only invariant.

1. `append-only: insert succeeds, update throws (simulated trigger from fake DB)` — CS-6
2. `append-only: delete throws` — CS-6
3. `state_transition event writes {from_state, to_state, actor}` — TDD §4
4. `field_edit event: editing {labs[0].value_numeric: 11 → 11.2} writes one row with before/after JSON` — CS-6
5. `field_edit: editing two fields writes exactly two rows in the same transaction` — CS-6
6. `approve event is preceded by N field_edit events where N = count of edits` — CS-6
7. `reject event requires reason_code; missing code throws` — DIS-US-014
8. `override event is written when approve has override_duplicates=true` — DIS-US-015
9. `correlation_id on the audit row matches the correlation_id on the extraction` — TDD §14
10. `actor_type='system' is used for auto_approved and promotion-time skips` — CS-7, CS-11

## 6. `file-router.test.ts` — TDD §7

Pure decision-tree tests. Input: `{filename, contentType, sampleBytes}`.

1. `pdf with embedded text ≥ 100 chars/page avg → routing_path=native_text` — TDD §7
2. `pdf with ink but < 100 chars/page avg → routing_path=ocr_scan` — TDD §7
3. `jpeg → routing_path=ocr_image` — TDD §7
4. `heic → routing_path=ocr_image (normalization happens in preprocessor, not router)` — TDD §8
5. `docx → routing_path=office_word` — TDD §7
6. `xlsx → routing_path=office_sheet` — TDD §7
7. `csv → routing_path=office_sheet` — TDD §7
8. `zip → throws UnsupportedMediaType (415)` — non_goals §6
9. `dcm → throws UnsupportedMediaType` — non_goals §6
10. `extension allowlist bypass attempt: file named .pdf but MIME=application/zip → 415` — TDD §16
11. `threshold configurable via env DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE=250` — TDD §7

## 7. `preprocessor.test.ts` — TDD §8

Each step tested independently against synthetic fixture images
(`tests/fixtures/preproc/`).

1. `heic → jpeg conversion preserves pixel count ±1%` — TDD §8.1
2. `multi-frame tiff → N jpeg buffers, one per frame` — TDD §8.1
3. `deskew: 5° tilted fixture rotates to within ±1°` — TDD §8.2
4. `perspective correction: four-corner fixture warps to a rectangle; aspect ratio preserved` — TDD §8.3
5. `blank-page detection: all-white page dropped; dropped count recorded` — TDD §8.4
6. `duplicate-page detection: pHash distance ≤ 5 → second page dropped` — TDD §8.5
7. `resize cap: 4000×3000 input → max 1920 longest side, aspect preserved` — TDD §8.6
8. `CLAHE contrast enhancement: low-contrast fixture histogram widens by ≥ 20%` — TDD §8.7
9. `jpeg encode quality=85; output file size ≤ 70% of 95-quality baseline` — TDD §8.8
10. `page-count cap: 51-page input → rejects with PAYLOAD_TOO_LARGE before OCR call` — TDD §8.9
11. `emits PreprocessedDocument with dropped={blank:N, duplicate:M} + original_page_count` — TDD §8

## 8. `structuring.test.ts` — CS-9, TDD §10, §11

Covers the structuring adapter seam and schema validation.

1. `valid Haiku response parses into ClinicalExtraction and passes JSON Schema v1` — TDD §11
2. `missing required document_type → STRUCTURING_SCHEMA_INVALID` — TDD §11
3. `CS-9: test_name_raw "Hb" + test_name_normalized "Hemoglobin" both stored in raw_structured_response` — CS-9
4. `CS-9: verified_structured edit to normalized name does NOT mutate raw_structured_response` — CS-9, CS-2
5. `confidence field outside [0,1] → validation error with field_path=labs[0].confidence` — TDD §11
6. `schema_version stored on the extraction matches the schema file used` — TDD §11
7. `retry-on-invalid: first response invalid, second valid → extraction reaches ready_for_review; both raw responses recorded` — TDD §10
8. `after 3 invalid responses → status=failed, error_code=STRUCTURING_SCHEMA_INVALID` — error_model
9. `providerVersion is recorded on the extraction row` — TDD §10
10. `structuring prompt version id is stamped on every call (audit)` — TDD §10

---

## Naming & conventions

- Test names are full English sentences describing behaviour, present tense.
- Every test file starts with a `// CS-## | DIS-US-### | TDD §X` banner
  listing every requirement it covers.
- No `it.skip`, no `test.only` on main.
- Assertions use explicit matchers (`toStrictEqual`, not `toEqual`).
- Fakes are imported from `dis/src/adapters/*/__fakes__/`, never hand-rolled
  inline.
