import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { SecretsPort } from '../../../src/ports/secrets.js';
import type { OcrInput } from '../../../src/ports/ocr.js';
import {
  DatalabChandraAdapter,
  OcrProviderError,
  OcrProviderTimeoutError,
  OcrProviderRateLimitedError,
} from '../../../src/adapters/ocr/datalab-chandra.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONVERT_RESPONSE = JSON.parse(
  readFileSync(resolve(__dirname, '../../fixtures/datalab/convert-response.json'), 'utf8'),
) as Record<string, unknown>;

class FakeSecrets implements SecretsPort {
  public readonly requested: string[] = [];
  constructor(private readonly value: string = 'sk-test-datalab-key') {}
  async get(name: string): Promise<string> {
    this.requested.push(name);
    return this.value;
  }
}

type FetchCall = {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly tAt: number;
  readonly body: FormData | undefined;
};

interface QueuedResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/**
 * Build a fake fetch that returns queued responses in order and records calls.
 * Time is simulated: each call advances a virtual clock so backoff is observable
 * without real setTimeout waits — the adapter injects a `sleep` seam for this.
 */
function makeFetch(responses: QueuedResponse[]): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let i = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = init?.body instanceof FormData ? init.body : undefined;
    calls.push({ url, init, tAt: Date.now(), body });
    if (i >= responses.length) {
      throw new Error(`Unexpected fetch #${i + 1} to ${url}`);
    }
    const r = responses[i++]!;
    const hdrs = r.headers ?? {};
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: `HTTP ${r.status}`,
      headers: {
        get(name: string) {
          const key = Object.keys(hdrs).find((k) => k.toLowerCase() === name.toLowerCase());
          return key ? hdrs[key]! : null;
        },
      },
      async json() {
        return r.body;
      },
      async text() {
        return JSON.stringify(r.body);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function makeSleep(): { fn: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    fn: async (ms: number) => {
      waits.push(ms);
    },
    waits,
  };
}

const PDF_INPUT: OcrInput = {
  pages: [Buffer.from('%PDF-1.4 fake', 'utf8')],
  mediaType: 'application/pdf',
  outputFormats: ['markdown', 'json'],
};

function formFields(fd: FormData | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!fd) return out;
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') out.push([k, v]);
    else out.push([k, `<blob:${(v as Blob).size}>`]);
  }
  return out;
}

describe('DatalabChandraAdapter', () => {
  it('submits and returns markdown + pageCount with rawResponse preserved (CS-2)', async () => {
    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: { status: 'complete', ...CONVERT_RESPONSE } },
    ]);
    const secrets = new FakeSecrets();
    const { fn: sleep } = makeSleep();
    const adapter = new DatalabChandraAdapter({ secretsPort: secrets, fetchImpl, sleep });

    const result = await adapter.extract(PDF_INPUT);

    expect(result.provider).toBe('datalab');
    expect(result.markdown).toBe(CONVERT_RESPONSE.markdown);
    expect(result.pageCount).toBe(2);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.rawResponse).toEqual({ status: 'complete', ...CONVERT_RESPONSE });
    expect(secrets.requested).toContain('DATALAB_API_KEY');
    expect(calls[0]!.url).toContain('datalab.to');
  });

  it('polls request_check_url with exponential backoff until complete', async () => {
    const submitted = {
      status: 'submitted',
      request_check_url: 'https://www.datalab.to/api/v1/convert/req-123',
    };
    const inProgress = { status: 'processing' };
    const complete = { status: 'complete', ...CONVERT_RESPONSE };

    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: submitted },
      { status: 200, body: inProgress },
      { status: 200, body: inProgress },
      { status: 200, body: inProgress },
      { status: 200, body: inProgress },
      { status: 200, body: complete },
    ]);
    const { fn: sleep, waits } = makeSleep();
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep,
    });

    const result = await adapter.extract(PDF_INPUT);

    expect(result.markdown).toBe(CONVERT_RESPONSE.markdown);
    expect(result.rawResponse).toEqual(complete);
    expect(calls.length).toBe(6);
    expect(calls[1]!.url).toBe(submitted.request_check_url);
    // Exponential backoff observed: 1s, 2s, 4s, 8s (capped at 10s).
    expect(waits.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(waits.every((w) => w <= 10000)).toBe(true);
  });

  it('throws OcrProviderError on submit 500', async () => {
    const { fn: fetchImpl } = makeFetch([{ status: 500, body: { error: 'boom' } }]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
    });

    await expect(adapter.extract(PDF_INPUT)).rejects.toSatisfy((e: unknown) => {
      return e instanceof OcrProviderError && (e as OcrProviderError).provider === 'datalab';
    });
  });

  it('throws OcrProviderTimeoutError when polling exceeds max total wait (default 300s)', async () => {
    // Submit then indefinite in_progress. Simulate >300s of backoff wait.
    const submitted = {
      status: 'submitted',
      request_check_url: 'https://www.datalab.to/api/v1/convert/req-slow',
    };
    const polls: QueuedResponse[] = [];
    for (let i = 0; i < 100; i++) polls.push({ status: 200, body: { status: 'processing' } });
    const { fn: fetchImpl } = makeFetch([{ status: 200, body: submitted }, ...polls]);

    // Track virtual elapsed wall-clock via the sleep seam.
    let elapsed = 0;
    const sleep = async (ms: number) => {
      elapsed += ms;
    };
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep,
      now: () => elapsed,
      // Default budget applies; explicit override validated in the 300s-default test.
    });

    await expect(adapter.extract(PDF_INPUT)).rejects.toBeInstanceOf(OcrProviderTimeoutError);
  });

  it('throws OcrProviderError when polling returns failed status', async () => {
    const submitted = {
      status: 'submitted',
      request_check_url: 'https://www.datalab.to/api/v1/convert/req-fail',
    };
    const { fn: fetchImpl } = makeFetch([
      { status: 200, body: submitted },
      { status: 200, body: { status: 'failed', error: 'parse error' } },
    ]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
    });

    await expect(adapter.extract(PDF_INPUT)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof OcrProviderError && (e as OcrProviderError).provider === 'datalab',
    );
  });

  it('sends X-Api-Key header fetched from SecretsPort', async () => {
    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: { status: 'complete', ...CONVERT_RESPONSE } },
    ]);
    const secrets = new FakeSecrets('sk-rotated-xyz');
    const adapter = new DatalabChandraAdapter({
      secretsPort: secrets,
      fetchImpl,
      sleep: makeSleep().fn,
    });

    await adapter.extract(PDF_INPUT);

    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    const headerVal = headers['X-Api-Key'] ?? headers['x-api-key'];
    expect(headerVal).toBe('sk-rotated-xyz');
  });

  it('preserves provider JSON byte-identically as rawResponse (CS-2)', async () => {
    const body = { status: 'complete', ...CONVERT_RESPONSE };
    const { fn: fetchImpl } = makeFetch([{ status: 200, body }]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
    });

    const result = await adapter.extract(PDF_INPUT);

    // rawResponse must deep-equal what the provider returned, with no mutation
    // or field-stripping by the adapter.
    expect(JSON.stringify(result.rawResponse)).toBe(JSON.stringify(body));
  });

  // ---------------------------------------------------------------------------
  // DIS-050a wire-contract fixes (6)
  // ---------------------------------------------------------------------------

  it('sends output_format as a single comma-joined field (DIS-050a fix 1)', async () => {
    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: { status: 'complete', ...CONVERT_RESPONSE } },
    ]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
    });

    await adapter.extract(PDF_INPUT);

    const fields = formFields(calls[0]!.body);
    const outputFormatEntries = fields.filter(([k]) => k === 'output_format');
    expect(outputFormatEntries.length).toBe(1);
    expect(outputFormatEntries[0]![1]).toBe('markdown,json');
  });

  it('does not send a langs form field (DIS-050a fix 2)', async () => {
    const inputWithLangs: OcrInput = {
      ...PDF_INPUT,
      hints: { languageCodes: ['en', 'hi'] },
    };
    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: { status: 'complete', ...CONVERT_RESPONSE } },
    ]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
    });

    await adapter.extract(inputWithLangs);

    const fields = formFields(calls[0]!.body);
    expect(fields.filter(([k]) => k === 'langs').length).toBe(0);
  });

  it('sends skip_cache=true when skipCache option is set (DIS-050a fix 3)', async () => {
    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: { status: 'complete', ...CONVERT_RESPONSE } },
    ]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
      skipCache: true,
    });

    await adapter.extract(PDF_INPUT);

    const fields = formFields(calls[0]!.body);
    const skipCacheEntries = fields.filter(([k]) => k === 'skip_cache');
    expect(skipCacheEntries.length).toBe(1);
    expect(skipCacheEntries[0]![1]).toBe('true');
  });

  it('default budget now 300s: tolerates >120s but <300s, throws past 300s (DIS-050a fix 4)', async () => {
    const submitted = {
      status: 'submitted',
      request_check_url: 'https://www.datalab.to/api/v1/convert/req-budget',
    };
    // Build enough polls to cover the 300s budget.
    const polls: QueuedResponse[] = [];
    for (let i = 0; i < 100; i++) polls.push({ status: 200, body: { status: 'processing' } });

    // Scenario A: complete at ~150s virtual — must NOT throw (would have under 120s).
    const completeBody = { status: 'complete', ...CONVERT_RESPONSE };
    const earlyComplete: QueuedResponse[] = [];
    for (let i = 0; i < 20; i++)
      earlyComplete.push({ status: 200, body: { status: 'processing' } });
    earlyComplete.push({ status: 200, body: completeBody });
    {
      const { fn: fetchImpl } = makeFetch([{ status: 200, body: submitted }, ...earlyComplete]);
      let elapsed = 0;
      const sleep = async (ms: number) => {
        elapsed += ms;
      };
      const adapter = new DatalabChandraAdapter({
        secretsPort: new FakeSecrets(),
        fetchImpl,
        sleep,
        now: () => elapsed,
      });
      const result = await adapter.extract(PDF_INPUT);
      expect(result.markdown).toBe(CONVERT_RESPONSE.markdown);
      // Default budget must be > 120s; specifically ≥ 300s.
      expect(elapsed).toBeGreaterThan(120_000);
      expect(elapsed).toBeLessThanOrEqual(300_000);
    }

    // Scenario B: never completes — must throw timeout (budget exhausted ~300s).
    {
      const { fn: fetchImpl } = makeFetch([{ status: 200, body: submitted }, ...polls]);
      let elapsed = 0;
      const sleep = async (ms: number) => {
        elapsed += ms;
      };
      const adapter = new DatalabChandraAdapter({
        secretsPort: new FakeSecrets(),
        fetchImpl,
        sleep,
        now: () => elapsed,
      });
      await expect(adapter.extract(PDF_INPUT)).rejects.toBeInstanceOf(OcrProviderTimeoutError);
      expect(elapsed).toBeGreaterThan(120_000);
    }
  });

  it('maps HTTP 429 with Retry-After to OcrProviderRateLimitedError (DIS-050a fix 5)', async () => {
    const { fn: fetchImpl } = makeFetch([
      { status: 429, body: { error: 'rate limited' }, headers: { 'Retry-After': '42' } },
    ]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
    });

    await expect(adapter.extract(PDF_INPUT)).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof OcrProviderRateLimitedError)) return false;
      const err = e as OcrProviderRateLimitedError;
      return err.provider === 'datalab' && err.code === 'RATE_LIMITED' && err.retryAfterSec === 42;
    });
  });

  it('sends webhook_url form field when webhookUrl option is set (DIS-050a fix 6)', async () => {
    const { fn: fetchImpl, calls } = makeFetch([
      { status: 200, body: { status: 'complete', ...CONVERT_RESPONSE } },
    ]);
    const adapter = new DatalabChandraAdapter({
      secretsPort: new FakeSecrets(),
      fetchImpl,
      sleep: makeSleep().fn,
      webhookUrl: 'https://example.test/hook',
    });

    await adapter.extract(PDF_INPUT);

    const fields = formFields(calls[0]!.body);
    const webhookEntries = fields.filter(([k]) => k === 'webhook_url');
    expect(webhookEntries.length).toBe(1);
    expect(webhookEntries[0]![1]).toBe('https://example.test/hook');
  });
});
