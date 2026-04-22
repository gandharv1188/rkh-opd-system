# Handoff — DIS-058c Preprocessor stage: perspective correction

- **Agent:** dev-c-preprocessor-pipeline (Opus 4.7, 1M context)
- **Branch:** feat/dev-c-preprocessor-pipeline
- **Worktree:** .claude/worktrees/dev-c-preprocessor-pipeline
- **Date:** 2026-04-22
- **TDD refs implemented:** §8.3
- **Dependencies:** DIS-058b (deskew — upstream stage delivers a rotationally-normalized page)

## 1. What was built

- `dis/src/adapters/preprocessor/stages/perspective.ts`:
  - `detectDocumentQuadrilateral(Buffer) → DocumentQuadrilateral | null` — finds the tight bounding rectangle of the bright region inside a contrasting dark frame, at a 240-px working copy.
  - `perspectiveCorrect(Buffer) → Buffer` — crops to the detected quad OR returns a JPEG-normalized passthrough when no quad is detected. **Never warps on a weak signal.**
  - `PreprocessorPerspectiveError` — typed wrapper, `code: 'PREPROCESSOR_PERSPECTIVE_FAILED'`.
- `dis/tests/unit/adapters/preprocessor/stages/perspective.test.ts` — 5 cases, all green.

## 2. Acceptance criteria status

- [x] VERIFY-1: `npx vitest run tests/unit/adapters/preprocessor/stages/perspective.test.ts` → 5/5 PASS.
- [x] VERIFY-2: `npx vitest run -t "no quad detected leaves image unchanged"` → PASS (dimensions preserved, JPEG re-encoded).
- [x] VERIFY-3: `npx tsc --noEmit` → empty.

## 3. Decisions taken

### D-1: Axis-aligned bounding-box crop, NOT full homography warp

**Context:** The TDD §8.3 design is "detect quadrilateral, warp to rectangle via 3×3 homography." sharp does not expose arbitrary perspective transforms; implementing one needs either opencv-node (heavy native dep, not in our bundle) or a hand-rolled bilinear warp kernel (outside `files_allowed`).
**Decision:** Ship a **transparently simplified** implementation: detect a strong axis-aligned bright-document-on-dark-frame boundary and crop to it. When no such boundary is detectable, pass through. Flag **DIS-058c-followup** for the full 4-corner homography warp.
**Reason:** Respects DIS-025 precedent — transparency over cosmetic dodges. The simplified stage is genuinely useful (dominant real-world case is a phone-photo of a document against a dark table, which is exactly what the axis-aligned crop addresses after deskew). The contract the downstream pipeline depends on — "no detection = no-op" — is preserved.

### D-2: Guard rails to prevent false-positive crops

**Reason:** The single most dangerous failure mode is a weak-signal crop that destroys the page. Three guards compose:
1. **Dark-pixel count ≥ 5% of frame.** If there's no dark region, there's no frame.
2. **Bounding box area ∈ [15%, 90%] of frame.** < 15% = noise speck; > 90% = the frame IS the page and there's no real crop.
3. **Passthrough on any null detection.** The JPEG re-encode keeps the output shape invariant so downstream stages don't branch on "did perspective fire?"

Each threshold is a defensible pick, not tuned to the tests. Tests would still pass if the thresholds moved within ±5%.

### D-3: Work at 240-px, crop at full resolution

**Same rationale as DIS-058b D-2:** the detection math doesn't need pixel precision, but the crop must preserve full-res detail. The scale factor is applied back at crop time.

### D-4: Composition contract (for DIS-058g)

These three Wave-3a slices chain as:

```ts
// pages: Buffer[] arriving from upstream split (PDF → page JPEGs, etc.)
const step1 = (await Promise.all(pages.map(normalizeContainer))).flat(); // may fan out (TIFF)
const step2 = await Promise.all(step1.map(deskew));                       // Buffer[]
const step3 = await Promise.all(step2.map(perspectiveCorrect));           // Buffer[]
```

All three slices output JPEG, so the composition is type-stable. DIS-058g wires this into the full 9-step pipeline; DIS-079 does the composition-root wiring. Each slice is a pure function with no shared state.

## 4. What was deliberately NOT done

- No 4-corner detection + homography warp. See **DIS-058c-followup**.
- No rotation of detected quad corners to rectangle orientation (would require knowing the 4 corners, not just the bbox).
- No integration with `DefaultPreprocessor` — passthrough stub still active.
- No cascade with DIS-058b deskew outputs in a single pipeline test. That's DIS-058g's end-to-end test.

## 5. Follow-ups

- **DIS-058c-followup** — upgrade to true corner detection + perspective warp via a bilinear-inverse-mapping kernel or a minimal opencv-node dependency, gated on production data showing phone-photo ingests with non-axis-aligned skew after DIS-058b deskew.

## 6. Files touched

- Added: `dis/src/adapters/preprocessor/stages/perspective.ts`
- Added: `dis/tests/unit/adapters/preprocessor/stages/perspective.test.ts`
- Added: `dis/handoffs/DIS-058c.md`

## 7. External dependencies introduced

None.

## 8. Tests

- 5 new unit tests, all green.
- `npx tsc --noEmit`: clean.
- Fitness: 0 violations (71 files scanned).
- Full suite (all slices + baseline): 307/307 passing.

## 9. Reproducing

```
cd dis
npx vitest run tests/unit/adapters/preprocessor/stages/perspective.test.ts
npx tsc --noEmit
```

## 10. Gotchas for reviewers / next author

- **The "no-op" contract is load-bearing.** If a future reviewer tightens detection and starts cropping normal already-scanned documents, OCR quality downstream will drop. The three guards (dark-pixel %, area bounds, null-passthrough) are the contract's teeth.
- **The current detector produces a rectangle, not a quadrilateral.** The `DocumentQuadrilateral` type name is kept forward-compatible so DIS-058c-followup can upgrade to 4 corners without a type rename.
- **The `MIN_QUAD_FRAC = 0.15` threshold matches the test fixture** (160×120 = 19200 px of 240×180 = 43200 px = 44.4%). Wide margin. Real phone-photo-of-document scans typically sit at 40-70% frame fraction.
- **Future integration: CS-8 / CS-9 implications.** Clinical-safety ticket CS-8 may require us to audit-log any perspective crop as it alters provenance. When DIS-058g composes the pipeline, consider piping a `stageAppliedCorrection` signal upward so the audit log can record "perspective-corrected: true/false" per page.

## 11. Verdict

Complete, ready for review. Slice 3 of 3 in Wave 3a.

All three Wave-3a slices (DIS-058a, DIS-058b, DIS-058c) are shipped on branch `feat/dev-c-preprocessor-pipeline`. Invariants green: fitness 0, tsc 0, vitest 307/307.
