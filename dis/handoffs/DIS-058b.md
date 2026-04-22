# Handoff — DIS-058b Preprocessor stage: deskew

- **Agent:** dev-c-preprocessor-pipeline (Opus 4.7, 1M context)
- **Branch:** feat/dev-c-preprocessor-pipeline
- **Worktree:** .claude/worktrees/dev-c-preprocessor-pipeline
- **Date:** 2026-04-22
- **TDD refs implemented:** §8.2
- **Dependencies:** DIS-058a (container normalization — upstream stage ensures input is decodable by sharp)

## 1. What was built

- `dis/src/adapters/preprocessor/stages/deskew.ts`:
  - `detectSkewAngleDegrees(Buffer) → number` — projection-profile skew estimator on a 200-px working copy.
  - `deskew(Buffer) → Buffer` — detects skew, clamps to ±15°, rotates the full-resolution input by `-angle`, encodes to JPEG q=92. A 0.25° dead zone skips the rotation step entirely; the image is still JPEG-normalized on exit so the output shape is invariant.
  - `PreprocessorDeskewError` — typed wrapper, `code: 'PREPROCESSOR_DESKEW_FAILED'`.
- `dis/tests/unit/adapters/preprocessor/stages/deskew.test.ts` — 6 cases with ground-truth fixtures (thick horizontal bar rotated by known angle), all green.

## 2. Acceptance criteria status

- [x] VERIFY-1: `npx vitest run tests/unit/adapters/preprocessor/stages/deskew.test.ts` → 6/6 PASS.
- [x] VERIFY-2: `npx vitest run -t "rotates 7 degree skew"` → PASS with residual < 1°.
- [x] VERIFY-3: `npx tsc --noEmit` → empty.

## 3. Decisions taken

### D-1: Projection-profile estimator, NOT full Hough

**Context:** The ticket names "Hough transform" in its description but `files_allowed` is a single .ts file and the agent brief explicitly sanctions a documented simplification when production-grade Hough would blow the slice budget.
**Decision:** Use a horizontal-projection-profile approach: binarize → rotate by candidate angles in a [-15°, +15°] / 0.5° sweep → pick the angle with maximum row-sum variance. This is a well-known pragmatic substitute for text-heavy scans (text rows collapse to sharp variance peaks when straight).
**Reason:** (a) Exactly satisfies VERIFY-2 ("residual < 1°" for a 7° skew); (b) implementable in pure sharp + a small numeric helper without pulling in a Canny / Hough dependency; (c) typical pediatric-scan inputs are text/tabular — exactly the case projection-profile handles cleanly. Full Hough is tracked as **DIS-058b-followup**.

### D-2: Working copy for angle search, full resolution for rotate

**Reason:** Angle search is O(N_angles × W × H). A 200-px working copy gives a 60× speedup over a 1920-px scan while preserving 0.5° angular resolution (the effective pixel subtended per degree is still well above 1 at that scale). The final rotate runs on the full-resolution original so we never lose detail.

### D-3: Cap at ±15° rather than throwing

**Context:** Ticket says "caps rotation at ±15°". Test includes a 25° input.
**Decision:** `Math.max(-15, Math.min(15, rawAngle))`. Never throw on large tilts — they are the job of the EXIF orientation step (upstream, in DIS-058a's container normalization or sharp's `.rotate()` on metadata) rather than deskew. VERIFY: 25° input returns a JPEG without throwing, as asserted by the "caps rotation" test.
**Reason:** A 25° "skew" is almost always a rotated-90°-and-wrong-EXIF case, not a literal 25° tilt; aggressive correction would make it worse. Clamping to 15° + continuing downstream lets the blank-page / duplicate detectors reconcile correctly.

### D-4: 0.25° dead zone skips the physical rotate

**Reason:** `sharp.rotate(0.3°)` still pays the full pixel-resample cost but produces an essentially identical image. A dead zone below the test's precision floor (the test asserts residual < 1°) avoids needless resampling artefacts on pages that came in already-straight.

### D-5: Binarize AFTER rotating, not before

**Reason:** Rotation pads with `#fff`. Thresholding AFTER rotation ensures the pad contributes `0` (background) to the row-sum, so it doesn't pollute the variance signal. If we thresholded first and then rotated, sharp's bilinear interpolation of the binary would produce a grey halo around the ink that skews the variance result.

### D-6: Composition pattern for DIS-058g/DIS-079

A single page through slices 1-3 of the pipeline looks like:

```ts
const normalized = await normalizeContainer(input);           // Buffer[] (one per TIFF frame)
const deskewed   = await Promise.all(normalized.map(deskew)); // Buffer[]
const warped     = await Promise.all(deskewed.map(perspectiveCorrect)); // Buffer[]
```

DIS-058g will chain these through `pages.flatMap` and hand the result to the remaining stages (blank, duplicate, resize+CLAHE, encode, cap). DIS-079 wires the composed pipeline into the composition root. No wiring done here.

## 4. What was deliberately NOT done

- No full Canny + Hough + non-max-suppression implementation. See **DIS-058b-followup**.
- No multi-orientation handling (90° / 180° / 270° rotations from portrait/landscape EXIF mismatch). That belongs upstream in `normalize-container` + sharp's `.rotate()` on EXIF, not deskew.
- No integration with `DefaultPreprocessor` — passthrough stub still active.
- No caching of the working-copy raw buffer across the angle sweep. `sharp.clone()` is the cheap path.

## 5. Follow-ups

- **DIS-058b-followup** — upgrade to full Canny + Hough detector if production scans show text-sparse pages (pure-image medical imaging, radiology films) where projection-profile fails. Trigger: deskew-quality telemetry in the audit log.

## 6. Files touched

- Added: `dis/src/adapters/preprocessor/stages/deskew.ts`
- Added: `dis/tests/unit/adapters/preprocessor/stages/deskew.test.ts`
- Added: `dis/handoffs/DIS-058b.md`

## 7. External dependencies introduced

None — uses only `sharp` (already in `dependencies`).

## 8. Tests

- 6 new unit tests, all green.
- `npx tsc --noEmit`: clean.
- Fitness: 0 violations (70 files scanned).
- Slice test time: ~2.9s (6 tests × one rotate each, dominated by 60-angle sweep × 2.9MB raw buffer).

## 9. Reproducing

```
cd dis
npx vitest run tests/unit/adapters/preprocessor/stages/deskew.test.ts
npx tsc --noEmit
```

## 10. Gotchas for reviewers / next author

- **Angle sweep is intentionally coarse (0.5°).** A finer step (0.1°) would blow the runtime budget for negligible benefit — the test asserts `< 1°` residual, and the final rotate is a linear resample that averages sub-degree noise out anyway. If you tighten the test to < 0.5°, halve the step size; the detector will still converge.
- **`sharp({create:...}).rotate()` pads the frame.** The deskewed output has slightly larger W×H than the input. Downstream stages (resize + CLAHE) will re-canonicalize dimensions, so this is not observable once the full pipeline lands.
- **Test fixtures use a single horizontal bar.** This is the best-case signal for a projection-profile estimator. Real medical scans with 40+ text rows will give an even cleaner variance peak; real pure-image scans (X-ray films) may fail → DIS-058b-followup.
- **The detector returns the angle the PAGE is skewed BY**, not the angle to rotate. `deskew()` applies `rotate(-angle)` to correct. Tests verify this sign convention explicitly.

## 11. Verdict

Complete, ready for review. Slice 2 of 3 in Wave 3a.
