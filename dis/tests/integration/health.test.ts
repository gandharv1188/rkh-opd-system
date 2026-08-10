import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { start } from '../../src/http/server.js';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let server: { close: () => Promise<void> };
let baseUrl: string;

beforeAll(async () => {
  // Port 0 => OS-assigned random free port; no global state.
  const started = await start(0);
  server = started;
  baseUrl = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok and a string version', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);

    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });

  it('echoes/generates an x-correlation-id response header (UUIDv4)', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const corrId = res.headers.get('x-correlation-id');
    expect(corrId).toBeTruthy();
    expect(corrId).toMatch(UUID_V4_RE);
  });

  it('echoes an inbound x-correlation-id back unchanged', async () => {
    const inbound = '11111111-2222-4333-8444-555555555555';
    const res = await fetch(`${baseUrl}/health`, {
      headers: { 'x-correlation-id': inbound },
    });
    expect(res.headers.get('x-correlation-id')).toBe(inbound);
  });
});
