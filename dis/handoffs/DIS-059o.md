# Handoff — DIS-059o OcrBridgeAdapter

- **Agent:** dev-c-ocr-bridge (Opus 4.7)
- **Branch:** feat/dev-c-ocr-bridge
- **Worktree:** .claude/worktrees/dev-c-ocr-bridge
- **Date:** 2026-04-22
- **Duration:** ~25 minutes wall-clock
- **TDD refs implemented:** §7 (file-router dispatch), §9.1 (OCR port)
- **CS refs:** CS-2 (byte-identical rawResponse preservation)
- **User story refs:** DIS-US-014 (ingest any document type)

## 1. What was built

- `dis/src/adapters/document-text-extractor/ocr-bridge.ts` — `OcrBridgeAdapter`
  class implementing `DocumentTextExtractorPort` by delegating to an injected
  `OcrPort`. Maps `ExtractionInput` → `OcrInput` (wraps bytes in `Buffer`,
  validates media type, forwards hints) and `OcrResult` → `ExtractionResult`
  (pins `route: 'ocr_image'`, lifts `provider`/`providerVersion`/`tokensUsed`
  into `providerDetails`, passes `rawResponse` through reference-equal for
  CS-2).
- `dis/tests/adapters/document-text-extractor/ocr-bridge.test.ts` — 7 vitest
  cases: datalab happy-path mapping, tokensUsed omission, unsupported media
  type error, PDF passthrough, markdown fallback, hints forwarding, and
  `image/jpg` → `image/jpeg` normalisation.
- `dis/handoffs/DIS-059o.md` — this file.

## 2. Acceptance criteria status

- [x] AC-1: adapter implements `DocumentTextExtractorPort` and delegates to
  `OcrPort` — class declaration line 30, `this.ocr.extract(...)` line 41.
- [x] AC-2: `route === 'ocr_image'` on the returned `ExtractionResult` — test
  `maps OcrResult to ExtractionResult with providerDetails`.
- [x] AC-3: CS-2 byte-identical `rawResponse` preservation — tested with
  `toBe(rawResponse)` (reference-equality).
- [x] AC-4: `providerDetails` omits `tokensUsed` when the OCR result lacks
  it — test `omits tokensUsed from providerDetails when absent`.
- [x] AC-5: unsupported media types throw with a clear message.
- [x] AC-6: `npx tsc --noEmit` on the full project reports 0 errors in
  this ticket's files (3 pre-existing errors in `src/http/server.ts`
  unrelated to DIS-059o).
- [x] AC-7: `node dis/scripts/fitness.mjs` → 0 violations.
- [ ] AC-8 (vitest run green): BLOCKED by broken install — see §5 and §10.

## 3. Decisions taken during implementation

### D-1: Normalise `image/jpg` to `image/jpeg` in `toOcrMediaType`

**Context:** the brief mentioned `'image/jpeg'` and `'image/jpg'` as both
valid inputs, but `OcrPort.OcrMediaType` only admits `'image/jpeg'`.
**Options considered:** (a) reject `image/jpg`; (b) silently collapse it.
**Decision:** (b) — file router may see either IANA/HTTP spelling; bridge
collapses to the canonical form the OCR port accepts.
**Reason:** caller-friendly and lossless — the `rawResponse` still records
what the provider saw.
**Revisit if:** OcrPort ever distinguishes the two.

### D-2: `extractHints` returns undefined for empty hints

**Context:** `ExtractionInput.hints` is free-form `Record<string,unknown>`;
`OcrHints` is strict (languageCodes/documentCategory only).
**Decision:** whitelist those two fields; if neither survives validation,
return `undefined` so the spread in `OcrInput` omits the key entirely.
**Reason:** compatible with `exactOptionalPropertyTypes`-style strictness
in future tsconfig tightening; avoids accidentally passing `undefined`.
**Revisit if:** OcrHints grows new fields.

### D-3: Build `providerDetails` object with conditional spread

**Context:** `tokensUsed` is optional on `OcrResult`; setting it to
`undefined` on `ExtractionResult.providerDetails` would violate strict
optional-property typing if the repo ever enables `exactOptionalPropertyTypes`.
**Decision:** conditional spread `(x ? { tokensUsed: x } : {})`.
**Reason:** the brief calls this out explicitly; matches the idiom used in
sibling adapters landed in Wave 3b.

## 4. What was deliberately NOT done

- No mutation of `OcrPort`, the extractor port, or any barrel file.
- No change to `package.json` or `tsconfig.json`.
- No Datalab- or Claude-specific logic — this adapter is provider-agnostic
  by design.
- No error wrapping around the `OcrPort.extract` promise — errors propagate
  unchanged so the orchestrator can apply route-level fallback.

## 5. Follow-ups / known gaps

- **DIS-059q (suggested):** Repair the DIS `node_modules` install so vitest
  can start. Root cause: `@jridgewell/sourcemap-codec` (dep of `magic-string`,
  itself a transitive of vite/vitest) is entirely missing from
  `dis/node_modules`. All worktrees share this broken install via Windows
  junctions. Urgency S — blocks every Wave 3b/3c TDD verification step.
- **DIS-059p (suggested):** Wire `OcrBridgeAdapter` into the composition
  root's file-router dispatch map alongside the three peer adapters.

## 6. Files touched

- Added: `dis/src/adapters/document-text-extractor/ocr-bridge.ts`
- Added: `dis/tests/adapters/document-text-extractor/ocr-bridge.test.ts`
- Added: `dis/handoffs/DIS-059o.md`

## 7. External dependencies introduced

None. (Uses only `OcrPort`, `DocumentTextExtractorPort`, and the Node
`Buffer` global already in use across the codebase.)

## 8. Tests

- Tests added: 7 unit (all in `ocr-bridge.test.ts`)
- Test run status: **not executed** — vitest cannot start due to the
  broken `@jridgewell/sourcemap-codec` install; see §5 and §10.
- Type-check on full project: 0 errors in DIS-059o files (3 unrelated
  errors in `src/http/server.ts`).
- Fitness: 0 violations across 81 files.

## 9. Reproducing the work locally

```
cd .claude/worktrees/dev-c-ocr-bridge/dis
node node_modules/typescript/bin/tsc --noEmit    # expect 0 errors in ocr-bridge*
node scripts/fitness.mjs                         # expect 0 violations
# Once DIS-059q lands:
node node_modules/vitest/dist/cli.js run tests/adapters/document-text-extractor/ocr-bridge.test.ts
```

The worktree needs a `node_modules` junction pointing at main's `dis/node_modules`:
```powershell
New-Item -ItemType Junction `
  -Path   ".\.claude\worktrees\dev-c-ocr-bridge\dis\node_modules" `
  -Target ".\dis\node_modules"
```
(This junction was created during this ticket — see §10.)

## 10. Non-obvious gotchas

- **Broken install, repo-wide.** `dis/node_modules/@jridgewell/sourcemap-codec`
  is missing — `magic-string` cannot resolve it, which means vite's config
  loader crashes before any test file is read. Every active worktree
  inherits the same failure (verified by running vitest from
  `dev-c-native-pdf-text/dis` — same error). This is a pre-existing
  condition, NOT caused by DIS-059o. I flagged it as DIS-059q (§5).
- **Worktree had no `node_modules` on arrival.** Peer worktrees
  (`dev-c-native-pdf-text`, `dev-c-office-sheet`, etc.) all had one. I
  created a Windows junction to main's `dis/node_modules` — no `npm install`
  was run, no files were duplicated, so the "broken duplicate on Windows"
  risk the brief warns about is avoided.
- **`.bin` is empty.** None of main's or the worktrees' `node_modules/.bin`
  has executables. Sibling workers must have invoked test runners by node
  + direct path (`node node_modules/vitest/dist/cli.js …`). I followed the
  same pattern.
- **Hints shape.** `ExtractionInput.hints` is `Record<string, unknown>`, so
  the adapter must narrow each field (`Array.isArray` + element typeof)
  before forwarding to `OcrHints` — I kept the whitelist minimal
  (`languageCodes`, `documentCategory`) per the current `OcrHints`
  definition.

## 11. Verdict

Partial — complete from an implementation standpoint (code, tests, types,
fitness all clean); vitest execution blocked by environmental issue
DIS-059q (missing `@jridgewell/sourcemap-codec` in the shared install).
Ready for review and merge once that install is repaired and the test
file runs green.
