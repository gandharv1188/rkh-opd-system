/**
 * DIS-058a — Container normalization stage (TDD §8.1).
 *
 * First step of the preprocessing pipeline. Takes a single raw image buffer
 * (any sharp-supported container: JPEG, PNG, WebP, BMP, TIFF, optionally
 * HEIC) and returns one or more JPEG buffers. JPEG inputs pass through as
 * identity so we do not needlessly re-encode. Multi-page TIFFs fan out to
 * one JPEG per frame.
 *
 * Pure function — no I/O beyond the sharp decode/encode. Composed into the
 * full pipeline by DIS-058g + DIS-079; it is NOT wired as the default
 * preprocessor yet (the DIS-058 passthrough stub remains the fallback).
 *
 * @see TDD §8.1
 */
import sharp from 'sharp';

const JPEG_MAGIC_0 = 0xff;
const JPEG_MAGIC_1 = 0xd8;
const JPEG_MAGIC_2 = 0xff;

const JPEG_QUALITY = 92;

export class PreprocessorContainerDecodeError extends Error {
  readonly code = 'PREPROCESSOR_CONTAINER_DECODE_FAILED' as const;
  constructor(cause: unknown) {
    super(
      `Preprocessor container normalization failed to decode input: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'PreprocessorContainerDecodeError';
  }
}

const isJpegMagic = (b: Buffer): boolean =>
  b.length >= 3 && b[0] === JPEG_MAGIC_0 && b[1] === JPEG_MAGIC_1 && b[2] === JPEG_MAGIC_2;

const encodeToJpeg = (pipeline: sharp.Sharp): Promise<Buffer> =>
  pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: false }).toBuffer();

export const normalizeContainer = async (input: Buffer): Promise<Buffer[]> => {
  if (input.length === 0) {
    throw new PreprocessorContainerDecodeError('empty buffer');
  }

  if (isJpegMagic(input)) {
    return [input];
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch (err) {
    throw new PreprocessorContainerDecodeError(err);
  }

  const pageCount = meta.pages && meta.pages > 1 ? meta.pages : 1;

  try {
    if (pageCount === 1) {
      const jpeg = await encodeToJpeg(sharp(input, { failOn: 'none' }));
      return [jpeg];
    }
    const frames: Buffer[] = [];
    for (let i = 0; i < pageCount; i++) {
      const frame = await encodeToJpeg(sharp(input, { failOn: 'none', page: i }));
      frames.push(frame);
    }
    return frames;
  } catch (err) {
    throw new PreprocessorContainerDecodeError(err);
  }
};
