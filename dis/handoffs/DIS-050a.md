# Handoff — DIS-050a DatalabChandraAdapter wire-contract hotfix

- **Agent:** dis-050a (Opus 4.7)
- **Branch:** feat/dis-050a
- **Worktree:** .claude/worktrees/dis-050a
- **Date:** 2026-04-20
- **TDD refs:** §9.2 (Datalab submit/poll flow, timeout budget)
- **CS refs:** CS-2 (raw provider response preserved byte-identically — unchanged by this hotfix)
- **ADR refs:** ADR-004 (Datalab webhooks over polling)
- **Flow doc:** `dis/handoffs/sessions/document_ocr_flow.md §13.2` (5 bugs found on live wire audit)

## 1. What was built

Six wire-contract fixes to `DatalabChandraAdapter`, one PR, Gate 2 test-first.

1. **output_format comma-join.** Replaced the per-format `form.append` loop with a single `form.append('output_format', input.outputFormats.join(','))` call. The live Datalab `/api/v1/convert` spec requires a single comma-separated value; the old loop emitted two form fields and only the last one was honored.
2. **Removed `langs` field.** Deleted the `if (input.hints?.languageCodes?.length)` block. Live Datalab docs (verified 2026-04-20) have no language-hint field. `OcrPort.hints.languageCodes` stays on the port contract because on-prem Chandra and future providers may support it; this adapter no longer forwards it. Added a `NOTE (2026-04-21 DIS-050a)` comment with date stamp and doc reference.
3. **`skipCache` constructor option.** Added `readonly skipCache?: boolean` to `DatalabChandraAdapterOptions`, stored as a private field defaulting to `false`. When `true`, `buildForm` appends `skip_cache=true`. Useful for CS-2 fresh-response audit on retries.
4. **Default budget 300 s.** Raised `DEFAULT_MAX_TOTAL_WAIT_MS` from `120_000` to `300_000` (5 min). Accurate-mode Chandra on multi-page discharge summaries legitimately exceeds 2 min. The `maxTotalWaitMs` constructor option still overrides.
5. **HTTP 429 → `OcrProviderRateLimitedError`.** New exported error class alongside `OcrProviderError` / `OcrProviderTimeoutError`:
   - `code: 'RATE_LIMITED'`
   - `provider: OcrProvider`
   - `retryAfterSec: number` (parsed from `Retry-After` header, default 1 if missing/unparseable)
     Both submit and poll paths now check `response.status === 429` before the generic error branch. Adapter does not retry internally — caller retries per `error_model.md §Retry policy`.
6. **`webhook_url` wiring (ADR-004).** Added `readonly webhookUrl?: string` option. When provided, `buildForm` appends `webhook_url`. Adapter continues to poll as a fallback because the webhook receiver endpoint lives in Epic-D scope (DIS-097-extended); this is documented inline and in ADR-004's Follow-up tickets. When webhook mode is active the adapter emits a `console.error` debug line (POC-level; real pino wiring is deferred to DIS-008).

## 2. Acceptance criteria status

- [x] `output_format` sent as a single comma-joined field.
- [x] `langs` form field never sent.
- [x] `skipCache` option plumbed through to `skip_cache=true`.
- [x] Default budget raised to 300 s.
- [x] HTTP 429 mapped to `OcrProviderRateLimitedError` with parsed `retryAfterSec`.
- [x] `webhook_url` forwarded when `webhookUrl` option set; polling still runs as fallback.
- [x] CS-2 byte-identical `rawResponse` preservation unchanged.
- [x] Test-first: failing-test commit `1b1d486` precedes impl commit.
- [x] All 13 unit tests pass (7 existing + 6 new).

## 3. Decisions taken during implementation

### D-1: Budget default 300 s, not per-request signal

**Decision:** Change the module-level default constant rather than require every caller to opt-in via `maxTotalWaitMs`.
**Reason:** DIS-022 and the orchestrator wiring (DIS-020) currently construct the adapter without passing `maxTotalWaitMs`; a default change is safer than audit-and-update of every call site. Tighter budgets remain possible via the option.

### D-2: `RATE_LIMITED` error check precedes `!resp.ok` branch

**Decision:** Explicit `if (resp.status === 429)` check before the generic non-2xx branch in both submit and poll.
**Reason:** 429 is not semantically a provider error; it's a throttling signal the caller must handle with backoff. Keeping it as a distinct typed error prevents upstream retry loops from treating it as a retriable `OcrProviderError` with a different retry policy.

### D-3: `console.error` for webhook-mode debug signal

**Decision:** Emit a single `console.error` line when `webhookUrl` is configured, rather than wiring pino now.
**Reason:** Real structured logging lands with DIS-008. For POC, the ticket explicitly permits `console.error` and operators just need a breadcrumb that webhook mode is active so they can correlate Datalab-side behavior with the adapter's polling trace.

### D-4: Poll path still runs when `webhookUrl` is set

**Decision:** Webhook and polling are not mutually exclusive; the adapter polls even when a webhook URL is configured.
**Reason:** ADR-004 and the ticket body: the webhook receiver endpoint is Epic-D (DIS-097-extended); until it ships, we cannot rely on the webhook for completion detection. Polling-as-fallback keeps the adapter working today, and when the receiver lands a follow-up ticket can short-circuit the poll once the webhook callback has observed `status=complete`.

## 4. Files touched

- `dis/src/adapters/ocr/datalab-chandra.ts` (modified)
- `dis/tests/unit/adapters/datalab-chandra.test.ts` (modified — 6 new tests, 1 existing 120s-budget test renamed to 300s-default)
- `dis/handoffs/DIS-050a.md` (this file, new)

No changes to `dis/src/ports/*` (port contracts untouched), `dis/src/core/*`, sibling adapter files, or any non-`dis-050a` worktree.

## 5. Follow-ups / open items

- **DIS-097-extended (Epic-D):** Implement the webhook receiver endpoint that Datalab posts to when a job completes, and short-circuit the adapter's polling loop once the callback has observed `status=complete`. ADR-004 documents the design.
- **DIS-008 (observability):** Replace the `console.error` webhook-mode breadcrumb with a structured pino log. Track in the Observability backlog.
- **DIS-020 (orchestrator wiring):** If the caller needs per-retry `skipCache`, the orchestrator retry policy will need to construct a dedicated adapter instance (or we can later thread `skipCache` down through the port `extract()` call signature — deferred until a real need emerges).

## 6. Verify Report

### Command outputs (actual)

| #   | Check                                                                                  | Expected        | Actual                                               |
| --- | -------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------- |
| V1  | `cd dis && npx vitest run tests/unit/adapters/datalab-chandra.test.ts \| tail -5`      | ≥ 13 tests pass | `Test Files  1 passed (1) / Tests  13 passed (13)` ✓ |
| V2  | `grep -cE "output_format.*join\s*\(\s*['\"]," dis/src/adapters/ocr/datalab-chandra.ts` | ≥ 1             | `1` ✓                                                |
| V3  | `grep -c "langs" dis/src/adapters/ocr/datalab-chandra.ts`                              | `0`             | `0` ✓                                                |
| V4  | `grep -c "skipCache\|skip_cache" dis/src/adapters/ocr/datalab-chandra.ts`              | ≥ 2             | `6` ✓                                                |
| V5  | `grep -c "300_000\|300000\|5 \* 60 \* 1000" dis/src/adapters/ocr/datalab-chandra.ts`   | ≥ 1             | `1` ✓                                                |
| V6  | `grep -c "OcrProviderRateLimitedError" dis/src/adapters/ocr/datalab-chandra.ts`        | ≥ 2             | `4` ✓                                                |
| V7  | `grep -c "webhook_url\|webhookUrl" dis/src/adapters/ocr/datalab-chandra.ts`            | ≥ 2             | `8` ✓                                                |
| V8  | `grep -c "RATE_LIMITED" dis/src/adapters/ocr/datalab-chandra.ts`                       | ≥ 1             | `1` ✓                                                |
| V9  | `test -f dis/handoffs/DIS-050a.md && echo EXISTS`                                      | `EXISTS`        | `EXISTS` ✓                                           |

### V1 full transcript

```
RUN  v4.1.4 E:/AI-Enabled HMIS/radhakishan_hospital_prescription_system_2026/.claude/worktrees/dis-050a/dis


 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  10:34:49
   Duration  313ms
```

All 9 VERIFY checks pass.

## 7. Tagged references (coding_standards §11, §15)

- Implements `tdd.md §9.2`
- Implements `adrs/ADR-004-datalab-webhooks-over-polling.md`
- Implements `dis/handoffs/sessions/document_ocr_flow.md §13` (all 5 documented bugs)
- Introduces `RATE_LIMITED` per `error_model.md`
- Session log per `session_handoff.md §3` (11-section template) + Verify Report per `verify_format.md §2`
- No CS tag — CS-2 byte-identical preservation is unaffected: `rawResponse` still carries the final complete body verbatim regardless of whether delivery is via poll or (future) webhook.
