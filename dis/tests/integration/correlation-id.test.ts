import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start } from '../../src/http/server.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let server: { close: () => Promise<void> };
let baseUrl: string;

beforeAll(async () => {
  const started = await start(0);
  server = started;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('correlation-id middleware (integration)', () => {
  it('generates a UUIDv4 when no inbound header is present', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const corr = res.headers.get('x-correlation-id');
    expect(corr).toBeTruthy();
    expect(corr).toMatch(UUID_V4_RE);
  });

  it('echoes a well-formed inbound x-correlation-id unchanged', async () => {
    const inbound = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-correlation-id': inbound } });
    expect(res.headers.get('x-correlation-id')).toBe(inbound);
  });

  it('rejects a malformed inbound id and mints a fresh UUIDv4 instead', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-correlation-id': 'not-a-uuid' } });
    const corr = res.headers.get('x-correlation-id');
    expect(corr).not.toBe('not-a-uuid');
    expect(corr).toMatch(UUID_V4_RE);
  });

  it('also accepts canonical header casing (X-Correlation-Id)', async () => {
    const inbound = '12345678-1234-4abc-8def-1234567890ab';
    const res = await fetch(`${baseUrl}/health`, { headers: { 'X-Correlation-Id': inbound } });
    expect(res.headers.get('x-correlation-id')).toBe(inbound);
  });
});
