/**
 * Unit tests — script-driven fake adapters (DIS-012).
 *
 * Proves each fake implements its port interface and that the script-entry
 * contract (success vs error) is honoured. No real I/O is performed.
 */

import { describe, it, expect } from 'vitest';

import {
  FakeDatabaseAdapter,
  FakeFileRouterAdapter,
  FakeOcrAdapter,
  FakePreprocessorAdapter,
  FakeQueueAdapter,
  FakeSecretsAdapter,
  FakeStorageAdapter,
  FakeStructuringAdapter,
} from '../helpers/index.js';
import type {
  DatabasePort,
  FileRouterPort,
  OcrPort,
  OcrResult,
  PreprocessorPort,
  QueuePort,
  SecretsPort,
  StoragePort,
  StructuringPort,
  StructuringResult,
} from '../../src/ports/index.js';

const ocrResult: OcrResult = {
  provider: 'datalab',
  providerVersion: 'test',
  rawResponse: {},
  markdown: '# hello',
  pageCount: 1,
  latencyMs: 5,
};

const structResult: StructuringResult = {
  provider: 'claude-haiku',
  providerVersion: 'test',
  rawResponse: {},
  structured: { ok: true },
  tokensUsed: { input: 1, output: 1 },
  costMicroINR: 100,
  latencyMs: 5,
};

describe('FakeOcrAdapter', () => {
  it('implements OcrPort and returns scripted success', async () => {
    const ocr: OcrPort = new FakeOcrAdapter({ 'sample.pdf': { success: ocrResult } });
    const out = await ocr.extract({
      pages: [Buffer.from('sample.pdf')],
      mediaType: 'application/pdf',
      outputFormats: ['markdown'],
    });
    expect(out.markdown).toBe('# hello');
  });

  it('throws scripted error codes', async () => {
    const ocr = new FakeOcrAdapter({ 'bad.pdf': { error: 'TIMEOUT' } });
    await expect(
      ocr.extract({
        pages: [Buffer.from('bad.pdf')],
        mediaType: 'application/pdf',
        outputFormats: ['markdown'],
      }),
    ).rejects.toThrow('TIMEOUT');
  });

  it('throws when no script entry matches', async () => {
    const ocr = new FakeOcrAdapter({});
    await expect(
      ocr.extract({
        pages: [Buffer.from('missing.pdf')],
        mediaType: 'application/pdf',
        outputFormats: ['markdown'],
      }),
    ).rejects.toThrow(/no script entry/);
  });
});

describe('FakeStructuringAdapter', () => {
  it('implements StructuringPort and returns scripted success by documentCategory', async () => {
    const s: StructuringPort = new FakeStructuringAdapter({
      'discharge_summary': { success: structResult },
    });
    const out = await s.structure({ markdown: '...', documentCategory: 'discharge_summary' });
    expect(out.structured).toEqual({ ok: true });
  });

  it('throws scripted error', async () => {
    const s = new FakeStructuringAdapter({ 'lab': { error: 'SCHEMA_DRIFT' } });
    await expect(s.structure({ markdown: 'x', documentCategory: 'lab' })).rejects.toThrow(
      'SCHEMA_DRIFT',
    );
  });
});

describe('FakeStorageAdapter', () => {
  it('round-trips put -> get', async () => {
    const storage: StoragePort = new FakeStorageAdapter();
    const put = await storage.putObject({
      key: 'k1',
      body: Buffer.from('hello'),
      contentType: 'text/plain',
    });
    expect(put.kind).toBe('put');
    const got = await storage.getObject('k1');
    expect(got.body.toString('utf8')).toBe('hello');
  });

  it('throws scripted error on getObject', async () => {
    const storage = new FakeStorageAdapter({ 'k1': { error: 'S3_DOWN' } });
    await expect(storage.getObject('k1')).rejects.toThrow('S3_DOWN');
  });

  it('deleteObject removes stored object', async () => {
    const storage = new FakeStorageAdapter();
    await storage.putObject({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' });
    await storage.deleteObject('k');
    await expect(storage.getObject('k')).rejects.toThrow(/no object/);
  });

  it('signed URL methods return discriminated results', async () => {
    const storage = new FakeStorageAdapter();
    const up = await storage.getSignedUploadUrl({
      key: 'k',
      expiresSec: 60,
      maxSizeBytes: 1024,
      contentType: 'application/pdf',
    });
    expect(up.kind).toBe('signed-upload');
    const down = await storage.getSignedDownloadUrl('k', 60);
    expect(down.kind).toBe('signed-download');
  });
});

describe('FakeDatabaseAdapter', () => {
  it('implements full DatabasePort surface', async () => {
    const db: DatabasePort = new FakeDatabaseAdapter();
    const row = await db.insertExtraction({
      id: 'e1',
      patientId: 'p1',
      status: 'uploaded',
      idempotencyKey: 'idem-1',
      payloadHash: 'h1',
      parentExtractionId: null,
    });
    expect(row.version).toBe(1);

    const byId = await db.findExtractionById('e1');
    expect(byId?.id).toBe('e1');

    const byKey = await db.findExtractionByIdempotencyKey('idem-1');
    expect(byKey?.id).toBe('e1');

    const updated = await db.updateExtractionStatus('e1', 1, 'preprocessing');
    expect(updated?.status).toBe('preprocessing');
    expect(updated?.version).toBe(2);

    const stale = await db.updateExtractionStatus('e1', 1, 'ocr');
    expect(stale).toBeNull();
  });

  it('runs transaction work against itself', async () => {
    const db = new FakeDatabaseAdapter();
    const result = await db.transaction(async (tx) => {
      await tx.setSessionVars({ 'app.role': 'nurse' });
      return 42;
    });
    expect(result).toBe(42);
    expect(db.sessionVars).toEqual([{ 'app.role': 'nurse' }]);
  });

  it('query returns scripted rows', async () => {
    const db = new FakeDatabaseAdapter({
      queries: { 'SELECT 1': { success: [{ one: 1 }] } },
    });
    const rows = await db.query<{ one: number }>('SELECT 1', []);
    expect(rows).toEqual([{ one: 1 }]);
    const one = await db.queryOne<{ one: number }>('SELECT 1', []);
    expect(one).toEqual({ one: 1 });
  });
});

describe('FakeQueueAdapter', () => {
  it('implements QueuePort and records enqueues', async () => {
    const q: QueuePort = new FakeQueueAdapter();
    const r = await q.enqueue('ingest', { jobId: 'j1' });
    expect(r.messageId).toMatch(/fake-msg-/);
  });

  it('honours scripted enqueue errors', async () => {
    const q = new FakeQueueAdapter({ enqueue: { 'ingest': { error: 'QUEUE_FULL' } } });
    await expect(q.enqueue('ingest', {})).rejects.toThrow('QUEUE_FULL');
  });

  it('registers consumers', async () => {
    const q = new FakeQueueAdapter();
    await q.startConsumer('ingest', async () => {});
    expect(q.consumers.has('ingest')).toBe(true);
  });
});

describe('FakeSecretsAdapter', () => {
  it('implements SecretsPort and returns scripted values', async () => {
    const s: SecretsPort = new FakeSecretsAdapter({ 'ANTHROPIC_API_KEY': { success: 'sk-fake' } });
    expect(await s.get('ANTHROPIC_API_KEY')).toBe('sk-fake');
  });

  it('throws when secret is not scripted', async () => {
    const s = new FakeSecretsAdapter({});
    await expect(s.get('MISSING')).rejects.toThrow(/not set/);
  });
});

describe('FakeFileRouterAdapter', () => {
  it('implements FileRouterPort and branches by filename', async () => {
    const r: FileRouterPort = new FakeFileRouterAdapter({
      'scan.pdf': { success: { kind: 'ocr_scan', pageCount: 3 } },
      'doc.docx': { success: { kind: 'office_word' } },
    });
    const out1 = await r.route({
      filename: 'scan.pdf',
      body: Buffer.from([]),
      contentType: 'application/pdf',
    });
    expect(out1.kind).toBe('ocr_scan');
    const out2 = await r.route({
      filename: 'doc.docx',
      body: Buffer.from([]),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(out2.kind).toBe('office_word');
  });
});

describe('FakePreprocessorAdapter', () => {
  it('implements PreprocessorPort with pass-through default', async () => {
    const p: PreprocessorPort = new FakePreprocessorAdapter();
    const out = await p.preprocess({
      pages: [Buffer.from('a'), Buffer.from('b')],
      mediaType: 'image/jpeg',
    });
    expect(out.pages.length).toBe(2);
    expect(out.dropped).toEqual({ blank: 0, duplicate: 0 });
  });

  it('honours scripted override keyed by media type', async () => {
    const p = new FakePreprocessorAdapter({
      'image/jpeg': {
        success: { pages: [], dropped: { blank: 2, duplicate: 0 }, originalPageCount: 2 },
      },
    });
    const out = await p.preprocess({
      pages: [Buffer.from('a'), Buffer.from('b')],
      mediaType: 'image/jpeg',
    });
    expect(out.pages.length).toBe(0);
    expect(out.dropped.blank).toBe(2);
  });
});
