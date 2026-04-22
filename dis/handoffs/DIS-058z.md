# Handoff — DIS-058z Author DocumentTextExtractorPort + fake (ADR-008)

- **Agent:** dev-c-dte-port (Claude Opus 4.7)
- **Branch:** feat/dev-c-dte-port
- **Worktree:** .claude/worktrees/dev-c-dte-port
- **Date:** 2026-04-22
- **Duration:** ~15 minutes wall-clock
- **TDD refs implemented:** §7 (file-router decision tree, dispatch target)
- **CS refs (if any):** CS-2 (rawResponse byte-identical preservation)
- **User story refs:** n/a (infrastructure ticket)
- **ADR:** ADR-008 (DocumentTextExtractorPort as file-router's dispatch target)

## 1. What was built

- `dis/src/ports/document-text-extractor.ts` — new port file exporting
  `DocumentTextExtractorPort`, `ExtractionInput`, `ExtractionResult`,
  `ExtractionRoute` per ADR-008 §Decision rule 4.
- `dis/src/ports/index.ts` — barrel re-exports for the four new types.
- `dis/tests/helpers/fake-adapters.ts` — added
  `FakeDocumentTextExtractorAdapter` (+ `DocumentTextExtractorScript` type),
  matching the "script-driven" pattern used by the sibling fakes.
- `dis/tests/helpers/index.ts` — re-export of the new fake + script type.
- `dis/tests/unit/fake-adapters.test.ts` — appended 3-case describe block
  asserting the fake honours the port (success, error, `.calls` recording).

## 2. Acceptance criteria status

- [x] AC-1: Port file exists with correct signature → VERIFY-1/2.
- [x] AC-2: Fake adapter implements the port and is script-driven →
      `fake-adapters.test.ts > FakeDocumentTextExtractorAdapter`.
- [x] AC-3: Barrel re-exports the new types → `src/ports/index.ts`.
- [x] AC-4: `tsc --noEmit` clean → VERIFY-4.
- [x] AC-5: Vitest GREEN (23/23) → VERIFY-5.
- [x] AC-6: fitness.mjs → 0 violations → VERIFY-6.

## 3. Decisions taken during implementation

### D-1: `scriptKey` hint for fake-adapter key resolution

**Context:** `ExtractionInput` has no stable caller-provided identifier like
`OcrInput.pages[0]` or `StructuringInput.documentCategory`.
**Options considered:** (a) hash of `bytes`, (b) `mediaType` only,
(c) caller-provided `hints.scriptKey`.
**Decision:** (c) with (b) as fallback.
**Reason:** hashing bytes is expensive and brittle in tests; mediaType alone
cannot distinguish two PDFs; `hints.scriptKey` gives tests full control and
mirrors how `FakeFileRouterAdapter` keys off `filename`.
**Revisit if:** a real adapter needs `hints.scriptKey` to mean something
concrete (it currently does not — the hint is free-form per ADR-008).

### D-2: Authored `ExtractionInput` per brief expansion

**Context:** ADR-008 §Decision rule 4 declares the method signature as
`routeAndExtract(input: ExtractionInput): Promise<ExtractionResult>` but does
not spell out `ExtractionInput`.
**Decision:** `{ bytes: Uint8Array; mediaType: string; hints?: Readonly<Record<string, unknown>> }`
as specified in the dispatch brief.
**Reason:** matches the brief's expansion verbatim and the ADR's Context
sentence "take bytes + media type hints, return extracted text".

## 4. What was deliberately NOT done

- The four concrete adapters (DIS-059 NativePdf, DIS-060 OfficeWord,
  DIS-061 OfficeSheet, DIS-059o OcrBridge) — owned by separate tickets.
- `adapters.md` Port inventory row — flagged as follow-up in ADR-008.
- `tdd.md §7` text amendment — flagged as follow-up in ADR-008.

## 5. Follow-ups / known gaps

- DIS-059 (Ready-after-058z) — NativePdfTextAdapter — urgency M.
- DIS-060 (Ready-after-058z) — OfficeWordAdapter — urgency M.
- DIS-061 (Ready-after-058z) — OfficeSheetAdapter — urgency M.
- DIS-059o (Ready-after-058z) — OcrBridgeAdapter — urgency M.
- `adapters.md` and `tdd.md §7` text amendments — urgency S.

## 6. Files touched

- Added: `dis/src/ports/document-text-extractor.ts`
- Added: `dis/handoffs/DIS-058z.md`
- Modified: `dis/src/ports/index.ts`
- Modified: `dis/tests/helpers/fake-adapters.ts`
- Modified: `dis/tests/helpers/index.ts`
- Modified: `dis/tests/unit/fake-adapters.test.ts`

## 7. External dependencies introduced

None.

## 8. Tests

- Tests added: 3 unit (inside the single new describe block).
- Tests passing: 23/23 in `tests/unit/fake-adapters.test.ts`.
- Coverage for new module: 100% lines on fake; port is types-only.
- Known flaky tests introduced: none.
- Snapshot files added: none.

## 9. Reproducing the work locally

```
cd dis
npm ci
npx tsc --noEmit
npx vitest run tests/unit/fake-adapters.test.ts
node scripts/fitness.mjs
```

## 10. Non-obvious gotchas

- Worktree ships without `node_modules`. First action after checkout must be
  `npm ci` inside `dis/`, otherwise vitest fails to load its config file
  ("Cannot find package 'vitest'").
- Node 24 triggers an `EBADENGINE` warn (engines field pins node 20); the
  warning is harmless for tests.

## 11. Verdict

Complete, ready for review — unblocks Wave 3b (DIS-059, DIS-060, DIS-061,
DIS-059o).
