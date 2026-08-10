/**
 * DIS-058b — Deskew stage (TDD §8.2).
 *
 * Detects page tilt and rotates to within ±1°. Correction is capped at
 * ±15° per ticket: inputs skewed beyond that are clamped rather than
 * throwing, so legitimate upside-down or sideways pages are handled by
 * the container's EXIF orientation step (not this stage) instead of
 * being over-rotated.
 *
 * Algorithm (simplified projection-profile estimator, not a full Hough):
 *  1. Decode input to 8-bit grayscale at a fixed 200-px max edge (keeps the
 *     search cheap — real documents share the same skew at any resolution).
 *  2. Threshold so ink=1, background=0 using a fixed mid-gray cutoff.
 *  3. For each candidate angle in [-15°, +15°] at 0.5° steps, rotate the
 *     binary image and compute the variance of its horizontal row sums.
 *     The true skew maximizes row-sum variance — straightened text rows
 *     collapse onto sharply-varying peaks.
 *  4. Rotate the ORIGINAL full-resolution image by -bestAngle.
 *
 * Why not Hough here? A production-grade Canny + Hough accumulator needs
 * an edge-map lib (not in our bundle) and a careful non-max-suppression
 * pass. The projection-profile estimator is a standard pragmatic
 * substitute for text-heavy scans and is trivially composable with sharp.
 * Follow-up DIS-058b-followup tracks upgrading to full Hough if
 * production data shows it is needed.
 *
 * @see TDD §8.2
 */
import sharp from 'sharp';

const MAX_SEARCH_EDGE = 200;
const ANGLE_SEARCH_MIN = -15;
const ANGLE_SEARCH_MAX = 15;
const ANGLE_SEARCH_STEP = 0.5;
const ROTATION_CAP_DEG = 15;
const DEAD_ZONE_DEG = 0.25; // below this, skip the physical rotate
const INK_THRESHOLD = 160; // 8-bit gray — below this is ink

export class PreprocessorDeskewError extends Error {
  readonly code = 'PREPROCESSOR_DESKEW_FAILED' as const;
  constructor(cause: unknown) {
    super(
      `Preprocessor deskew failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'PreprocessorDeskewError';
  }
}

const rowSumVariance = (binary: Uint8Array, width: number, height: number): number => {
  const rowSums = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      s += binary[rowOff + x]!;
    }
    rowSums[y] = s;
  }
  let mean = 0;
  for (let y = 0; y < height; y++) mean += rowSums[y]!;
  mean /= height;
  let variance = 0;
  for (let y = 0; y < height; y++) {
    const d = rowSums[y]! - mean;
    variance += d * d;
  }
  return variance / height;
};

const rotatedBinary = async (
  baseGray: sharp.Sharp,
  angleDeg: number,
): Promise<{ data: Uint8Array; width: number; height: number }> => {
  // Rotate with white background, then threshold. We threshold AFTER rotation
  // rather than before so the rotated padding (white) does not contribute ink
  // noise — white stays above threshold.
  const { data, info } = await baseGray
    .clone()
    .rotate(angleDeg, { background: { r: 255, g: 255, b: 255 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const binary = new Uint8Array(info.width * info.height);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = data[i]! < INK_THRESHOLD ? 1 : 0;
  }
  return { data: binary, width: info.width, height: info.height };
};

export const detectSkewAngleDegrees = async (input: Buffer): Promise<number> => {
  if (input.length === 0) {
    throw new PreprocessorDeskewError('empty buffer');
  }
  try {
    const meta = await sharp(input).metadata();
    const w = meta.width ?? MAX_SEARCH_EDGE;
    const h = meta.height ?? MAX_SEARCH_EDGE;
    const scale = Math.min(1, MAX_SEARCH_EDGE / Math.max(w, h));
    const targetW = Math.max(32, Math.round(w * scale));
    const targetH = Math.max(32, Math.round(h * scale));
    const gray = sharp(input)
      .resize(targetW, targetH, { fit: 'inside' })
      .grayscale()
      .removeAlpha();

    let bestAngle = 0;
    let bestVariance = -Infinity;
    for (
      let a = ANGLE_SEARCH_MIN;
      a <= ANGLE_SEARCH_MAX + 1e-9;
      a += ANGLE_SEARCH_STEP
    ) {
      // We rotate by -a so that if the page is skewed by +a, rotating by -a
      // un-rotates it → maximum row variance → reports bestAngle = a.
      const { data, width, height } = await rotatedBinary(gray, -a);
      const v = rowSumVariance(data, width, height);
      if (v > bestVariance) {
        bestVariance = v;
        bestAngle = a;
      }
    }
    return bestAngle;
  } catch (err) {
    throw new PreprocessorDeskewError(err);
  }
};

export const deskew = async (input: Buffer): Promise<Buffer> => {
  if (input.length === 0) {
    throw new PreprocessorDeskewError('empty buffer');
  }
  const rawAngle = await detectSkewAngleDegrees(input);
  const clamped = Math.max(-ROTATION_CAP_DEG, Math.min(ROTATION_CAP_DEG, rawAngle));
  if (Math.abs(clamped) < DEAD_ZONE_DEG) {
    // Near-zero skew — return original as a jpeg-normalized buffer so the
    // downstream pipeline always sees a JPEG regardless of whether skew was
    // applied. This keeps the stage's output shape invariant.
    try {
      return await sharp(input).jpeg({ quality: 92 }).toBuffer();
    } catch (err) {
      throw new PreprocessorDeskewError(err);
    }
  }
  try {
    return await sharp(input)
      .rotate(-clamped, { background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (err) {
    throw new PreprocessorDeskewError(err);
  }
};
