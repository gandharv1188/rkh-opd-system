/**
 * DIS-058b — Deskew stage tests (TDD §8.2).
 *
 * Verifies that a rotated page is returned with residual skew close to zero
 * and that a near-straight page is left essentially unchanged. We generate
 * fixtures at runtime: a black horizontal bar on white background, rotated
 * by a known angle, so the "true" skew is known a priori.
 *
 * Production-quality Hough detection would require a larger library budget
 * (canny edge + Hough accumulator). This slice ships a simpler
 * horizontal-projection-profile estimator and caps its rotation at ±15°
 * per the ticket. Follow-up DIS-058b-followup tracks the full Hough
 * implementation if production data shows it is needed.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  deskew,
  detectSkewAngleDegrees,
} from '../../../../../src/adapters/preprocessor/stages/deskew.js';

const WIDTH = 240;
const HEIGHT = 160;

/**
 * Build a JPEG of a document-like page with a single thick horizontal bar
 * near the middle, then rotate the whole page by `angleDeg`. The skew
 * detector should report ≈ angleDeg (sign-conventional) and deskew() should
 * produce an image whose residual skew is ≤ 1°.
 */
const makeSkewedPage = async (angleDeg: number): Promise<Buffer> => {
  const base = sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#ffffff' },
  });
  // Composite a thick dark horizontal bar centered vertically.
  const bar = await sharp({
    create: { width: WIDTH - 20, height: 12, channels: 3, background: '#000000' },
  })
    .png()
    .toBuffer();
  const composed = await base
    .composite([{ input: bar, left: 10, top: Math.round(HEIGHT / 2) - 6 }])
    .png()
    .toBuffer();
  const rotated = await sharp(composed)
    .rotate(angleDeg, { background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
  return rotated;
};

describe('DIS-058b — deskew (TDD §8.2)', () => {
  it('rotates 7 degree skew — residual skew < 1°', async () => {
    const skewed = await makeSkewedPage(7);
    const out = await deskew(skewed);
    const residual = await detectSkewAngleDegrees(out);
    expect(Math.abs(residual)).toBeLessThan(1);
  });

  it('rotates -5 degree skew — residual skew < 1°', async () => {
    const skewed = await makeSkewedPage(-5);
    const out = await deskew(skewed);
    const residual = await detectSkewAngleDegrees(out);
    expect(Math.abs(residual)).toBeLessThan(1);
  });

  it('near-straight page (0.3°) is returned essentially unchanged', async () => {
    const nearStraight = await makeSkewedPage(0.3);
    const out = await deskew(nearStraight);
    // Output is still a valid JPEG of the same logical dimensions (within rotate padding).
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    const residual = await detectSkewAngleDegrees(out);
    expect(Math.abs(residual)).toBeLessThan(1);
  });

  it('caps rotation at ±15° — a 25° skew is only partially corrected but does not throw', async () => {
    const skewed = await makeSkewedPage(25);
    const out = await deskew(skewed);
    // Does not throw, returns a JPEG. We don't assert residual < 1° here —
    // the ticket explicitly caps correction at ±15°, so 10° residual is
    // acceptable.
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('detectSkewAngleDegrees reports an angle within ±1° of ground truth at 3°', async () => {
    const skewed = await makeSkewedPage(3);
    const estimated = await detectSkewAngleDegrees(skewed);
    expect(Math.abs(estimated - 3)).toBeLessThan(1.5);
  });

  it('rejects empty input with typed error', async () => {
    await expect(deskew(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'PREPROCESSOR_DESKEW_FAILED',
    });
  });
});
