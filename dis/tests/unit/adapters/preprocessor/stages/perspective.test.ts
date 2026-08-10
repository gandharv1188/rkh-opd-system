/**
 * DIS-058c — Perspective correction stage tests (TDD §8.3).
 *
 * Verifies that an image without a strong quadrilateral boundary is left
 * essentially unchanged, and that the stage returns a valid JPEG for
 * typical page input. Full perspective-warp correctness (true homography
 * restoration) is beyond the scope of the sharp-only slice; see
 * DIS-058c-followup in the handoff.
 *
 * The stage's real-world job is to crop a photographed document off a
 * contrasting background (e.g., a scan-with-phone photo of a lab report
 * on a dark table). When NO such quadrilateral is detected (the
 * overwhelming common case for already-scanned documents), the stage
 * MUST be a no-op — never warp based on a weak signal.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  perspectiveCorrect,
  detectDocumentQuadrilateral,
} from '../../../../../src/adapters/preprocessor/stages/perspective.js';

const makeFlatDocPage = async (w = 200, h = 140): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite([
      {
        input: await sharp({
          create: { width: w - 40, height: 10, channels: 3, background: '#000000' },
        })
          .png()
          .toBuffer(),
        left: 20,
        top: 30,
      },
    ])
    .jpeg()
    .toBuffer();

/**
 * Simulate a document photographed against a dark background: a bright
 * white rectangle offset inside a dark frame. Strong quadrilateral edges.
 */
const makePhotoedDocOnDarkFrame = async (): Promise<Buffer> =>
  sharp({ create: { width: 240, height: 180, channels: 3, background: '#101010' } })
    .composite([
      {
        input: await sharp({
          create: { width: 160, height: 120, channels: 3, background: '#ffffff' },
        })
          .png()
          .toBuffer(),
        left: 40,
        top: 30,
      },
    ])
    .jpeg()
    .toBuffer();

describe('DIS-058c — perspectiveCorrect (TDD §8.3)', () => {
  it('no quad detected leaves image unchanged', async () => {
    const flat = await makeFlatDocPage();
    const out = await perspectiveCorrect(flat);
    // When no strong quadrilateral is detected, the output is re-encoded
    // as JPEG but dimensionally identical.
    const inMeta = await sharp(flat).metadata();
    const outMeta = await sharp(out).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(outMeta.width).toBe(inMeta.width);
    expect(outMeta.height).toBe(inMeta.height);
  });

  it('returns a valid JPEG buffer', async () => {
    const page = await makeFlatDocPage();
    const out = await perspectiveCorrect(page);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect((meta.width ?? 0) > 0).toBe(true);
    expect((meta.height ?? 0) > 0).toBe(true);
  });

  it('detects quadrilateral on a bright doc over dark frame', async () => {
    const photoed = await makePhotoedDocOnDarkFrame();
    const quad = await detectDocumentQuadrilateral(photoed);
    // We assert the detector FOUND *some* quadrilateral, not exact corners —
    // corner-detection precision is the follow-up ticket's concern.
    expect(quad).not.toBeNull();
    if (quad) {
      // The quad should be smaller than the full frame (document is inset).
      expect(quad.width).toBeLessThan(240);
      expect(quad.height).toBeLessThan(180);
      // And larger than a trivial noise blob.
      expect(quad.width).toBeGreaterThan(50);
      expect(quad.height).toBeGreaterThan(50);
    }
  });

  it('detectDocumentQuadrilateral returns null for a plain white-on-white page', async () => {
    const flat = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    const quad = await detectDocumentQuadrilateral(flat);
    expect(quad).toBeNull();
  });

  it('rejects empty input with typed error', async () => {
    await expect(perspectiveCorrect(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'PREPROCESSOR_PERSPECTIVE_FAILED',
    });
  });
});
