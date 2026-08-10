/**
 * DIS-043 — Error envelope integration (end-to-end).
 *
 * Composes the correlation-id middleware (DIS-008) with the DIS-029
 * envelope builder as a Hono `onError` handler, then drives a route
 * that throws each known DIS error class. Asserts the resulting JSON
 * body matches `04_api/error_model.md`: `{error: {code, message,
 * correlation_id}}` with a stable UPPER_SNAKE `code`.
 *
 * The test uses `app.fetch(request)` (no bound socket) so it is
 * hermetic and parallel-safe.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { correlationId } from '../../src/http/middleware/correlation-id.js';
import { toEnvelope } from '../../src/core/error-envelope.js';
import type { AppVariables } from '../../src/http/server.js';
import { VersionConflictError } from '../../src/core/orchestrator.js';
import { InvalidStateTransitionError } from '../../src/core/state-machine.js';
import {
  OcrProviderTimeoutError,
  OcrProviderRateLimitedError,
} from '../../src/adapters/ocr/datalab-chandra.js';
import { StructuringSchemaInvalidError } from '../../src/adapters/structuring/claude-haiku.js';

type Thrower = () => never;

const throwers: Record<string, { expectedCode: string; throw: Thrower }> = {
  '/invalid-state': {
    expectedCode: 'INVALID_STATE_TRANSITION',
    throw: () => {
      throw new InvalidStateTransitionError('promoted', { kind: 'policy_auto_approved' });
    },
  },
  '/version-conflict': {
    expectedCode: 'VERSION_CONFLICT',
    throw: () => {
      throw new VersionConflictError('ext-42', 1, 'verified');
    },
  },
  '/ocr-timeout': {
    expectedCode: 'OCR_PROVIDER_TIMEOUT',
    throw: () => {
      throw new OcrProviderTimeoutError('datalab timed out', {
        provider: 'datalab',
        waitedMs: 120_000,
      });
    },
  },
  '/ocr-rate-limited': {
    expectedCode: 'RATE_LIMITED',
    throw: () => {
      throw new OcrProviderRateLimitedError('429 from datalab', {
        provider: 'datalab',
        retryAfterSec: 5,
      });
    },
  },
  '/structuring-invalid': {
    expectedCode: 'STRUCTURING_SCHEMA_INVALID',
    throw: () => {
      throw new StructuringSchemaInvalidError('drift detected', 2, '{"bad":true}');
    },
  },
  '/generic': {
    expectedCode: 'INTERNAL_ERROR',
    throw: () => {
      throw new Error('kaboom');
    },
  },
};

function buildApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', correlationId());
  for (const [path, spec] of Object.entries(throwers)) {
    app.get(path, () => spec.throw());
  }
  app.onError((err, c) => {
    const correlation_id = c.get('correlationId') ?? '';
    const body = toEnvelope(err, correlation_id);
    return c.json(body, 500);
  });
  return app;
}

describe('error envelope (end-to-end through Hono)', () => {
  const app = buildApp();

  for (const [path, spec] of Object.entries(throwers)) {
    it(`${path} → envelope with code ${spec.expectedCode}`, async () => {
      const inbound = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const res = await app.fetch(
        new Request(`http://local${path}`, { headers: { 'x-correlation-id': inbound } }),
      );
      expect(res.status).toBe(500);
      const body = (await res.json()) as {
        error: { code: string; message: string; correlation_id: string };
      };
      expect(body.error.code).toBe(spec.expectedCode);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(body.error.correlation_id).toBe(inbound);
    });
  }

  it('mints a fresh correlation_id when no inbound header is present', async () => {
    const res = await app.fetch(new Request('http://local/generic'));
    const body = (await res.json()) as { error: { code: string; correlation_id: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
