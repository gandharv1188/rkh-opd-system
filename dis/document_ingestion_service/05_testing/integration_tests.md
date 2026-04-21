# Integration Tests — DIS

> Scope: end-to-end flows with the HTTP layer, real adapters (or typed
> sandboxes), and a real Postgres (testcontainers). Provider calls use
> Datalab sandbox + Anthropic sandbox on the nightly job; on PRs, providers
> are replaced with high-fidelity fakes seeded from recorded responses.
>
> Every scenario maps to user stories + CS-## requirements. See
> `test_strategy.md` §7 for the CS mapping.

## Harness

```
dis/tests/integration/
├── setup/
│   ├── testcontainers-postgres.ts
│   ├── migrate.ts                # runs 03_data/migrations.md SQL
│   ├── seed-patient.ts           # creates a minimal patient + visit
│   └── http-client.ts            # supertest with default headers
└── scenarios/
    ├── happy_path_pdf.test.ts
    ├── reject_path.test.ts
    ├── duplicate_document.test.ts
    ├── discharge_latest_only.test.ts
    ├── idempotency.test.ts
    ├── version_conflict.test.ts
    ├── kill_switch.test.ts
    ├── provider_outage.test.ts
    ├── confidence_default_off.test.ts
    └── rls_patient_isolation.test.ts
```

Each test starts from a migrated, seeded DB snapshot (transaction rollback
between tests where possible, else `TRUNCATE` cascade).

---

## 1. `happy_path_pdf.test.ts` — DIS-US-001, DIS-US-011, DIS-US-012, CS-1, CS-3

Upload → review → approve → lab_results present.

Steps + assertions:

1. `POST /uploads/signed-url` with a lab-report PDF → 200; `storage_key` returned.
2. `PUT` the bytes of `tests/fixtures/lab_reports/cbc_native_pdf.pdf` to the signed URL.
3. `POST /ingest` with `Idempotency-Key=K1` → 201; `extraction_id=X`, `status` in `{uploaded, preprocessing, structuring}`.
4. Poll `GET /extractions/X` until `status=ready_for_review` (timeout 60 s).
5. Assert `raw_ocr_response`, `raw_structured_response`, `structured.labs.length > 0`.
6. `POST /extractions/X/approve` with `version=1` → 200; `PromotionSummary.labs_inserted >= 1`.
7. Query `lab_results` directly: every inserted row has `ocr_extraction_id=X`, `verification_status='verified'`, `verified_by` non-null.
8. `ocr_extractions.status='promoted'`, `promoted_at` set, `version=2`.
9. `ocr_audit_log` contains at least: 1 `state_transition` to `verified`, 1 `approve` event, N `state_transition` events matching the path.

CS tags: CS-1 (no pending row in lab_results), CS-3 (FK present).

---

## 2. `reject_path.test.ts` — DIS-US-014, CS-5

1. Ingest a fixture as above → reach `ready_for_review`.
2. `POST /extractions/X/reject` with `reason_code=illegible`, `version=1` → 200.
3. `ocr_extractions.status='rejected'`, `rejected_reason_code='illegible'`.
4. `lab_results` contains zero rows linked to X.
5. `POST /extractions/X/approve` afterwards → 409 `INVALID_STATE_TRANSITION`.
6. `ocr_audit_log` shows `reject` event with `actor_id` and `reason_code`.

CS tag: CS-5.

---

## 3. `duplicate_document.test.ts` — DIS-US-015, CS-4

1. Ingest fixture F1 → verify → promote. Capture `lab_results` row count = C1.
2. Ingest same fixture bytes (same `source_content_hash`) with new Idempotency-Key=K2.
3. Extraction X2 created; `GET /extractions/X2` returns body with `warnings[] including {code:'DUPLICATE_DOCUMENT', prior_extraction_id: X1}`.
4. `POST /extractions/X2/approve` WITHOUT `override_duplicates` → 409 `DUPLICATE_DOCUMENT`.
5. `POST /extractions/X2/approve` WITH `override_duplicates=true` → 200.
6. `lab_results` row count is still C1 (because of CS-11 duplicate-row guard even though nurse overrode the doc-level dup).
7. `ocr_audit_log` shows `override` event on X2.

CS tags: CS-4 (doc-level), CS-11 (row-level).

---

## 4. `discharge_latest_only.test.ts` — CS-10

1. Ingest `tests/fixtures/discharge_summaries/neonate_tsb_7_readings.pdf` which the structuring adapter surfaces as 7 lab entries for `test_name_normalized='Total Serum Bilirubin'` across 7 distinct `test_date` values.
2. Approve with `version=1`, no edits.
3. Assert `lab_results` contains exactly **one** row for TSB for this patient.
4. The row's `test_date = max(dates)`; `value_numeric` matches the latest-dated entry.
5. Promotion summary: `labs_inserted=1`, `labs_skipped=6`.
6. Audit log has 6 `system`-actor skip entries with reason `discharge_latest_only_dedupe`.

CS tag: CS-10.

---

## 5. `idempotency.test.ts` — TDD §5

1. `POST /ingest` with `Idempotency-Key=K` and body B → 201, returns `extraction_id=X`.
2. Second `POST /ingest` with the same K + identical B → 201, returns the **same** `extraction_id=X`, no new row.
3. Third `POST /ingest` with the same K but B' (different storage_key) → 409 `IDEMPOTENCY_KEY_CONFLICT`.
4. Only one row exists in `ocr_extractions` for K.
5. `POST /extractions/X/approve` replayed with same Idempotency-Key → second call returns same `PromotionSummary`; `lab_results` row count unchanged after second call (true idempotency on approve).

---

## 6. `version_conflict.test.ts` — TDD §6

1. Ingest to `ready_for_review`; `version=1`.
2. Client A `POST /approve` with `version=1` → 200; now `version=2`.
3. Client B `POST /approve` with `version=1` (stale) → 409 `VERSION_CONFLICT`; details include current `version`.
4. No duplicate rows in `lab_results`.

---

## 7. `kill_switch.test.ts` — DIS-US-032

1. Set env `DIS_KILL_SWITCH=1` on the test server.
2. `POST /ingest` → 503 `UNAVAILABLE` with body telling client to fall back to legacy.
3. (Optional integration with legacy) If `DIS_KILL_SWITCH_ROUTE_TO_LEGACY=1`, server returns 307 to the legacy path.
4. Unset the var → `POST /ingest` → 201 as normal.
5. Kill-switch activation is logged to `ocr_audit_log` with `event_type='kill_switch'`.

---

## 8. `provider_outage.test.ts` — error_model, product_brief risk table

Two sub-scenarios, both using fake OCR adapter that throws `ProviderDownError`.

### 8.a Datalab outage → failed extraction

1. Fake adapter returns 503 on every call.
2. `POST /ingest` → 201 (accepted; async pipeline).
3. Poll `GET /extractions/X` → status eventually `failed`, `error_code='OCR_PROVIDER_UNAVAILABLE'`, `retryable=true` in the extraction error payload.
4. `POST /extractions/X/retry` → 201 creates a **new** extraction X', preserves X for audit.

### 8.b Structuring JSON drift recovery

1. Fake structuring adapter: first 2 calls return invalid JSON, 3rd returns valid.
2. Extraction reaches `ready_for_review`.
3. `raw_structured_response` column is an array-like log with 3 entries OR a list stored under `structuring_attempts[]`.
4. `dis_cost_ledger` shows 3 structuring operations.

---

## 9. `confidence_default_off.test.ts` — CS-7

1. Seed `dis_confidence_policy` with factory default (`enabled=false`).
2. Ingest any fixture → reaches `ready_for_review`, never `auto_approved`, regardless of confidence scores.
3. Assert no row in `lab_results` at this point.
4. Activate a policy (`enabled=true`, simple rule) via service-role call; audit row written.
5. Re-ingest same fixture → extraction reaches `auto_approved`, rows appear in `lab_results` with `verification_status='auto_approved'`, `verified_by='system'`.
6. Deactivate → next extraction again `pending_review`.

---

## 10. `rls_patient_isolation.test.ts` — CS-8

1. Seed patients P1, P2; create ingested extractions E1 for P1, E2 for P2.
2. Open a DB session as `app.role='nurse'`, `app.patient_id='P1'`.
3. `SELECT * FROM ocr_extractions WHERE id=E2` returns 0 rows.
4. `SELECT * FROM ocr_extractions WHERE id=E1` returns 1 row.
5. Session as `app.role='admin'` sees both.
6. `INSERT` as `app.role='nurse'` into `ocr_extractions` fails (only `service` may insert per policy).

CS tag: CS-8.

---

## 11. Additional scenarios (shorter)

- `office_word.test.ts` — `.docx` upload → routing_path=office_word, structured output with diagnoses. TDD §7.
- `office_sheet.test.ts` — `.xlsx` upload → office_sheet path, labs table extracted. TDD §7.
- `large_file.test.ts` — 25 MB file → 413 `PAYLOAD_TOO_LARGE` at signed-url stage.
- `page_cap.test.ts` — 60-page PDF → rejects per TDD §8.9.
- `retry_audit.test.ts` — DIS-US-003 retry logs include operator ID + timestamp; old extraction preserved.
- `admin_metrics.test.ts` — `GET /admin/metrics` with service-role token returns queue depth + latency; anon token returns 403.
- `rx_filter.cs12.test.ts` — `generate-prescription` helper queried with only `ai_extracted pending_review` lab row returns zero labs. CS-12.

## Execution matrix

| Scenario                  | Uses real Datalab?     | Uses real Anthropic?   |
| ------------------------- | ---------------------- | ---------------------- |
| 1–10 above                | No (PR); Yes (nightly) | No (PR); Yes (nightly) |
| Nightly live-provider job | Yes                    | Yes                    |

Live-provider job uses sandbox credentials (`DATALAB_SANDBOX_KEY`,
`ANTHROPIC_SANDBOX_KEY`). Cost capped by budget check in CI.

## Test data hygiene

- Every test creates its own `patient_id = 'TEST-<uuid>'`. No shared state.
- `tests/fixtures/` paths are deterministic; see `fixtures.md`.
- Tests run serially within a file, parallel across files (Vitest default).
