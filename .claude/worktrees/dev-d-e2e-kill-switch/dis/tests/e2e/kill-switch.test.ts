/**
 * DIS-108 — E2E kill-switch flip (CS-9).
 *
 * End-to-end: wires `createServer()` with the `/ingest` route and the
 * kill-switch middleware, then flips the switch mid-session and asserts
 * the next POST is blocked with 503 within a single request.
 *
 * CS-9 sign-off is batched at the Epic-D → Epic-G boundary; this test
 * lands without an in-line CLINICAL APPROVED marker (see DIS-100 handoff).
 */

import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/http/server.js';
import type {
  ExtractionRecord,
  IngestInput,
  IngestionOrchestrator,
} from '../../src/core/orchestrator.js';

class FakeOrchestrator {
  public readonly calls: IngestInput[] = [];
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

describe('E2E kill-switch flip (CS-9)', () => {
  it('subsequent POST returns 503', async () => {
    let killSwitchOn = false;
    const fakeOrchestrator = new FakeOrchestrator();
    const app = createServer({
      killSwitch: { isEnabled: () => killSwitchOn },
      routes: {
        ingest: { orchestrator: fakeOrchestrator as unknown as IngestionOrchestrator },
      },
    });

    // Phase 1 — kill switch OFF, POST /ingest succeeds.
    const headers = {
      'content-type': 'application/pdf',
      'X-Patient-Id': 'pt-1',
      'Idempotency-Key': 'idem-1',
    };
    const body = Buffer.from('%PDF-1.4').buffer;
    const res1 = await app.request('/ingest', { method: 'POST', headers, body });
    expect(res1.status).toBe(201); // success

    // Phase 2 — flip kill-switch ON mid-session.
    killSwitchOn = true;

    // Phase 3 — next POST returns 503 within one request.
    const res2 = await app.request('/ingest', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'idem-2' },
      body,
    });
    expect(res2.status).toBe(503);
    expect(res2.headers.get('retry-after')).toBeTruthy();
    const body2 = (await res2.json()) as { error: { code: string } };
    expect(body2.error.code).toBe('KILL_SWITCH_ACTIVE');

    // Phase 4 — GETs still work when kill-switch is on (sanity).
    const res3 = await app.request('/health');
    expect(res3.status).toBe(200);

    // Orchestrator was invoked exactly once — the second POST was short-circuited.
    expect(fakeOrchestrator.calls).toHaveLength(1);
  });
});
