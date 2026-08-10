/**
 * DIS-110 — E2E rate-limit + Retry-After.
 *
 * Bursts past the per-operator token bucket and asserts the 4th request
 * receives 429 with a positive `Retry-After` header and the
 * `RATE_LIMITED` envelope from the DIS-101 error handler. Uses an
 * injectable clock so no real sleeps are needed.
 *
 * @see backlog line 2433
 * @see tests/http/rate-limit.test.ts (unit coverage)
 */

import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/http/server.js';
import type {
  ExtractionRecord,
  IngestInput,
  IngestionOrchestrator,
} from '../../src/core/orchestrator.js';

class FakeOrchestrator {
  public calls: IngestInput[] = [];
  async ingest(input: IngestInput): Promise<ExtractionRecord> {
    this.calls.push(input);
    return {
      id: `ext-${this.calls.length}`,
      patientId: input.patientId,
      status: 'uploaded',
      version: 1,
      parentExtractionId: null,
    };
  }
}

function asOrchestrator(fake: FakeOrchestrator): IngestionOrchestrator {
  return fake as unknown as IngestionOrchestrator;
}

describe('E2E rate-limit + Retry-After', () => {
  it('Retry-After header present on 429', async () => {
    let clock = 1_000_000;
    const fakeOrchestrator = new FakeOrchestrator();
    const app = createServer({
      rateLimit: {
        maxTokens: 3,
        windowMs: 60_000,
        now: () => clock,
      },
      routes: {
        ingest: { orchestrator: asOrchestrator(fakeOrchestrator) },
      },
    });

    const headers = (key: string) => ({
      'content-type': 'application/pdf',
      'X-Patient-Id': 'pt-1',
      'Idempotency-Key': key,
      'X-Operator-Id': 'op-burst',
    });
    const body = Buffer.from('%PDF-1.4').buffer as ArrayBuffer;

    // Burst: 3 passes, 4th should 429.
    for (let i = 0; i < 3; i++) {
      const r = await app.request('/ingest', {
        method: 'POST',
        headers: headers(`k-${i}`),
        body,
      });
      expect(r.status).toBe(201);
    }

    const exhausted = await app.request('/ingest', {
      method: 'POST',
      headers: headers('k-3'),
      body,
    });
    expect(exhausted.status).toBe(429);

    const retryAfter = exhausted.headers.get('retry-after');
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body429 = (await exhausted.json()) as {
      error: { code: string };
    };
    expect(body429.error.code).toBe('RATE_LIMITED');
  });
});
