/**
 * DIS-058c — Perspective correction stage (TDD §8.3).
 *
 * Detects a strong document quadrilateral against a contrasting background
 * and crops to it. True homography-based perspective warp (4-corner ->
 * rectangle via a 3×3 transform) is deferred to DIS-058c-followup: sharp
 * does not expose arbitrary perspective transforms, and pulling in
 * opencv-node or a custom warp kernel exceeds this slice's scope.
 *
 * Per ticket + agent brief, the slice ships a **transparent simplified
 * implementation** (DIS-025 precedent over cosmetic dodges):
 *
 *  - If a strong axis-aligned bright rectangle is detected in the image
 *    (by thresholding ink < 96 against background > 160 and finding the
 *    tight bounding box of the bright region), crop to it.
 *  - Otherwise, pass through (JPEG-normalized).
 *
 * Correctness floor: the stage MUST NEVER warp based on a weak signal —
 * a false positive crop would destroy the page. "No quad detected =
 * identity" is the contract the downstream pipeline relies on.
 *
 * @see TDD §8.3
 */
import sharp from 'sharp';

const MAX_SEARCH_EDGE = 240;
const DARK_PIXEL_MAX = 96; // pixel value ≤ this = "dark frame"
const MIN_QUAD_FRAC = 0.15; // the detected doc must cover ≥ 15% of the frame
const MAX_QUAD_FRAC = 0.9; // and ≤ 90% (otherwise it's just the page itself, no dark frame)
const DARK_BORDER_MIN_FRAC = 0.05; // at least 5% of frame must be "dark background"

export class PreprocessorPerspectiveError extends Error {
  readonly code = 'PREPROCESSOR_PERSPECTIVE_FAILED' as const;
  constructor(cause: unknown) {
    super(
      `Preprocessor perspective correction failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'PreprocessorPerspectiveError';
  }
}

export type DocumentQuadrilateral = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export const detectDocumentQuadrilateral = async (
  input: Buffer,
): Promise<DocumentQuadrilateral | null> => {
  if (input.length === 0) {
    throw new PreprocessorPerspectiveError('empty buffer');
  }
  let working: { data: Buffer; info: sharp.OutputInfo };
  try {
    const meta = await sharp(input).metadata();
    const w = meta.width ?? MAX_SEARCH_EDGE;
    const h = meta.height ?? MAX_SEARCH_EDGE;
    const scale = Math.min(1, MAX_SEARCH_EDGE / Math.max(w, h));
    const targetW = Math.max(32, Math.round(w * scale));
    const targetH = Math.max(32, Math.round(h * scale));
    working = await sharp(input)
      .resize(targetW, targetH, { fit: 'inside' })
      .grayscale()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    throw new PreprocessorPerspectiveError(err);
  }

  const { data, info } = working;
  const { width, height } = info;
  const totalPixels = width * height;

  // Count dark pixels — proxy for "is there a contrasting frame at all?"
  let darkCount = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i]! <= DARK_PIXEL_MAX) darkCount++;
  }
  if (darkCount < totalPixels * DARK_BORDER_MIN_FRAC) {
    return null;
  }

  // Find the tight bounding box of the NON-dark (i.e., bright) region.
  // For a bright document on a dark frame, this is the document's bounding
  // rectangle — axis-aligned, so we return a rectangle, not an arbitrary
  // quadrilateral. DIS-058c-followup upgrades to a true 4-corner detector.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (data[rowOff + x]! > DARK_PIXEL_MAX) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;

  const quadW = maxX - minX + 1;
  const quadH = maxY - minY + 1;
  const quadArea = quadW * quadH;
  const frac = quadArea / totalPixels;

  if (frac < MIN_QUAD_FRAC || frac > MAX_QUAD_FRAC) {
    // Too small = noise. Too large = frame IS the page (no dark border).
    return null;
  }

  // Scale the detected box back to input-pixel space.
  const metaIn = await sharp(input).metadata();
  const inW = metaIn.width ?? width;
  const inH = metaIn.height ?? height;
  const scaleX = inW / width;
  const scaleY = inH / height;

  return {
    left: Math.round(minX * scaleX),
    top: Math.round(minY * scaleY),
    width: Math.round(quadW * scaleX),
    height: Math.round(quadH * scaleY),
  };
};

export const perspectiveCorrect = async (input: Buffer): Promise<Buffer> => {
  if (input.length === 0) {
    throw new PreprocessorPerspectiveError('empty buffer');
  }
  const quad = await detectDocumentQuadrilateral(input);
  try {
    if (quad === null) {
      // No strong quadrilateral → identity (JPEG-normalized to keep output
      // shape invariant). NEVER warp on a weak signal.
      return await sharp(input).jpeg({ quality: 92 }).toBuffer();
    }
    return await sharp(input)
      .extract({ left: quad.left, top: quad.top, width: quad.width, height: quad.height })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (err) {
    throw new PreprocessorPerspectiveError(err);
  }
};
