/**
 * OcrBridgeAdapter — tests.
 *
 * @see ADR-008
 * @see DIS-059o
 */

import { describe, expect, it } from 'vitest';

import { OcrBridgeAdapter } from '../../../src/adapters/document-text-extractor/ocr-bridge.js';
import type {
  OcrInput,
  OcrPort,
  OcrResult,
} from '../../../src/ports/ocr.js';

class StubOcrAdapter implements OcrPort {
  public lastInput: OcrInput | undefined;

  constructor(private readonly result: OcrResult) {}

  async extract(input: OcrInput): Promise<OcrResult> {
    this.lastInput = input;
    return this.result;
  }
}

describe('OcrBridgeAdapter', () => {
  it('maps OcrResult to ExtractionResult with providerDetails (datalab happy path)', async () => {
    const rawResponse = { fake: 'datalab-raw' };
    const stubResult: OcrResult = {
      provider: 'datalab',
      providerVersion: '2026.04.01',
      rawResponse,
      markdown: 'extracted text',
      pageCount: 3,
      tokensUsed: { input: 100, output: 50 },
      costMicroINR: 500,
      latencyMs: 1200,
    };
    const stub = new StubOcrAdapter(stubResult);
    const adapter = new OcrBridgeAdapter(stub);

    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const result = await adapter.routeAndExtract({
      bytes,
      mediaType: 'image/jpeg',
    });

    expect(result.route).toBe('ocr_image');
    expect(result.markdown).toBe('extracted text');
    expect(result.pageCount).toBe(3);
    expect(result.rawResponse).toBe(rawResponse);
    expect(result.providerDetails).toEqual({
      provider: 'datalab',
      providerVersion: '2026.04.01',
      tokensUsed: { input: 100, output: 50 },
    });
    expect(result.latencyMs).toBe(1200);
    expect(result.costMicroINR).toBe(500);

    expect(stub.lastInput).toBeDefined();
    const firstPage = stub.lastInput!.pages[0];
    expect(Buffer.isBuffer(firstPage)).toBe(true);
    expect(firstPage!.equals(Buffer.from(bytes))).toBe(true);
    expect(stub.lastInput!.mediaType).toBe('image/jpeg');
    expect(stub.lastInput!.outputFormats).toContain('markdown');
  });

  it('omits tokensUsed from providerDetails when absent on OcrResult', async () => {
    const stub = new StubOcrAdapter({
      provider: 'claude-vision',
      providerVersion: 'haiku-4.5',
      rawResponse: {},
      markdown: 'ok',
      pageCount: 1,
      latencyMs: 300,
    });
    const adapter = new OcrBridgeAdapter(stub);

    const result = await adapter.routeAndExtract({
      bytes: new Uint8Array([0, 1]),
      mediaType: 'image/jpeg',
    });

    expect(result.providerDetails).toEqual({
      provider: 'claude-vision',
      providerVersion: 'haiku-4.5',
    });
    expect(result.providerDetails).not.toHaveProperty('tokensUsed');
  });

  it('throws on unsupported mediaType', async () => {
    const stub = new StubOcrAdapter({
      provider: 'datalab',
      providerVersion: 'x',
      rawResponse: {},
      pageCount: 0,
      latencyMs: 0,
    });
    const adapter = new OcrBridgeAdapter(stub);

    await expect(
      adapter.routeAndExtract({
        bytes: new Uint8Array([0]),
        mediaType: 'application/msword',
      }),
    ).rejects.toThrow(/unsupported.*application\/msword/);
  });

  it('passes through application/pdf mediaType', async () => {
    const stub = new StubOcrAdapter({
      provider: 'datalab',
      providerVersion: '2026.04.01',
      rawResponse: {},
      markdown: 'pdf text',
      pageCount: 2,
      latencyMs: 500,
    });
    const adapter = new OcrBridgeAdapter(stub);

    await adapter.routeAndExtract({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mediaType: 'application/pdf',
    });

    expect(stub.lastInput?.mediaType).toBe('application/pdf');
  });

  it('defaults markdown to empty string when provider omits it', async () => {
    const stub = new StubOcrAdapter({
      provider: 'datalab',
      providerVersion: 'x',
      rawResponse: {},
      pageCount: 1,
      latencyMs: 10,
    });
    const adapter = new OcrBridgeAdapter(stub);

    const result = await adapter.routeAndExtract({
      bytes: new Uint8Array([0]),
      mediaType: 'image/jpeg',
    });

    expect(result.markdown).toBe('');
  });

  it('forwards hints (languageCodes, documentCategory) to OcrPort', async () => {
    const stub = new StubOcrAdapter({
      provider: 'datalab',
      providerVersion: 'x',
      rawResponse: {},
      markdown: '',
      pageCount: 1,
      latencyMs: 1,
    });
    const adapter = new OcrBridgeAdapter(stub);

    await adapter.routeAndExtract({
      bytes: new Uint8Array([0]),
      mediaType: 'image/jpeg',
      hints: {
        languageCodes: ['en', 'hi'],
        documentCategory: 'lab-report',
      },
    });

    expect(stub.lastInput?.hints).toEqual({
      languageCodes: ['en', 'hi'],
      documentCategory: 'lab-report',
    });
  });

  it('normalises image/jpg to image/jpeg on the OcrPort input', async () => {
    const stub = new StubOcrAdapter({
      provider: 'datalab',
      providerVersion: 'x',
      rawResponse: {},
      markdown: '',
      pageCount: 1,
      latencyMs: 1,
    });
    const adapter = new OcrBridgeAdapter(stub);

    await adapter.routeAndExtract({
      bytes: new Uint8Array([0xff, 0xd8]),
      mediaType: 'image/jpg',
    });

    expect(stub.lastInput?.mediaType).toBe('image/jpeg');
  });
});
