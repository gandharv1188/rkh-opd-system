/**
 * Datalab Chandra OCR adapter — implements {@link OcrPort} against Datalab's
 * hosted Marker/Chandra API. Submits pages via multipart POST, polls the
 * provider's `request_check_url` with exponential backoff until the job is
 * `complete`, and surfaces the full provider response verbatim via
 * {@link OcrResult.rawResponse} so downstream audit/reprocessing can treat the
 * adapter as a transparent pipe.
 *
 * @see TDD §9.2 (Datalab adapter submit/poll flow, timeout budget)
 * @see clinical_safety.md CS-2 (raw provider response must be preserved
 *      byte-for-byte for every extraction so a later pipeline run on the same
 *      document is reproducible).
 */

import type {
  OcrPort,
  OcrInput,
  OcrResult,
  OcrProvider,
  Block,
  BlockType,
} from '../../ports/ocr.js';
import type { SecretsPort } from '../../ports/secrets.js';

const PROVIDER: OcrProvider = 'datalab';
const SUBMIT_URL = 'https://www.datalab.to/api/v1/convert';
const API_KEY_NAME = 'DATALAB_API_KEY';

const DEFAULT_MAX_TOTAL_WAIT_MS = 120_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 10_000;

/**
 * Error thrown when the Datalab API returns a non-success status or a
 * `failed` job result. `provider` is carried so higher layers can route
 * error handling without sniffing instance types.
 */
export class OcrProviderError extends Error {
  public readonly provider: OcrProvider;
  public readonly status?: number;
  public readonly rawResponse?: unknown;

  constructor(
    message: string,
    opts: { provider: OcrProvider; status?: number; rawResponse?: unknown },
  ) {
    super(message);
    this.name = 'OcrProviderError';
    this.provider = opts.provider;
    this.status = opts.status;
    this.rawResponse = opts.rawResponse;
  }
}

/**
 * Error thrown when total polling wall-time exceeds the configured budget.
 * CS-2 requires fail-closed on stalled providers — the calling pipeline
 * treats this as a retriable infrastructure failure, not a clinical miss.
 */
export class OcrProviderTimeoutError extends Error {
  public readonly provider: OcrProvider;
  public readonly waitedMs: number;

  constructor(message: string, opts: { provider: OcrProvider; waitedMs: number }) {
    super(message);
    this.name = 'OcrProviderTimeoutError';
    this.provider = opts.provider;
    this.waitedMs = opts.waitedMs;
  }
}

type SleepFn = (ms: number) => Promise<void>;
type NowFn = () => number;

export interface DatalabChandraAdapterOptions {
  readonly secretsPort: SecretsPort;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: SleepFn;
  readonly now?: NowFn;
  readonly maxTotalWaitMs?: number;
  readonly submitUrl?: string;
}

interface SubmitResponse {
  readonly status?: string;
  readonly request_check_url?: string;
  readonly markdown?: string;
  readonly json?: unknown;
  readonly html?: string;
  readonly page_count?: number;
  readonly error?: string;
  readonly version?: string;
}

const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export class DatalabChandraAdapter implements OcrPort {
  private readonly secretsPort: SecretsPort;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: SleepFn;
  private readonly now: NowFn;
  private readonly maxTotalWaitMs: number;
  private readonly submitUrl: string;

  constructor(opts: DatalabChandraAdapterOptions) {
    this.secretsPort = opts.secretsPort;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
    this.maxTotalWaitMs = opts.maxTotalWaitMs ?? DEFAULT_MAX_TOTAL_WAIT_MS;
    this.submitUrl = opts.submitUrl ?? SUBMIT_URL;
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    const apiKey = await this.secretsPort.get(API_KEY_NAME);
    const startedAt = this.now();

    const form = this.buildForm(input);
    const submitResp = await this.fetchImpl(this.submitUrl, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
    });

    if (!submitResp.ok) {
      const body = await this.safeJson(submitResp);
      throw new OcrProviderError(`Datalab submit failed with HTTP ${submitResp.status}`, {
        provider: PROVIDER,
        status: submitResp.status,
        rawResponse: body,
      });
    }

    const submitted = (await submitResp.json()) as SubmitResponse;

    const final = isComplete(submitted) ? submitted : await this.poll(submitted, apiKey);

    return this.toResult(final, this.now() - startedAt);
  }

  private buildForm(input: OcrInput): FormData {
    const form = new FormData();
    const ext = input.mediaType === 'application/pdf' ? 'pdf' : 'jpg';
    input.pages.forEach((buf, idx) => {
      const blob = new Blob([new Uint8Array(buf)], { type: input.mediaType });
      form.append('file', blob, `page-${idx + 1}.${ext}`);
    });
    for (const fmt of input.outputFormats) {
      form.append('output_format', fmt);
    }
    form.append('mode', 'accurate');
    if (input.hints?.languageCodes?.length) {
      form.append('langs', input.hints.languageCodes.join(','));
    }
    return form;
  }

  private async poll(initial: SubmitResponse, apiKey: string): Promise<SubmitResponse> {
    const checkUrl = initial.request_check_url;
    if (!checkUrl) {
      throw new OcrProviderError('Datalab submit response missing request_check_url', {
        provider: PROVIDER,
        rawResponse: initial,
      });
    }

    let attempt = 0;
    let totalWaited = 0;
    const startedAt = this.now();

    while (true) {
      const wait = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
      if (totalWaited + wait > this.maxTotalWaitMs) {
        throw new OcrProviderTimeoutError(`Datalab polling exceeded ${this.maxTotalWaitMs}ms`, {
          provider: PROVIDER,
          waitedMs: this.now() - startedAt,
        });
      }
      await this.sleep(wait);
      totalWaited += wait;
      attempt += 1;

      const resp = await this.fetchImpl(checkUrl, {
        method: 'GET',
        headers: { 'X-Api-Key': apiKey },
      });
      if (!resp.ok) {
        const body = await this.safeJson(resp);
        throw new OcrProviderError(`Datalab poll failed with HTTP ${resp.status}`, {
          provider: PROVIDER,
          status: resp.status,
          rawResponse: body,
        });
      }
      const body = (await resp.json()) as SubmitResponse;
      if (isComplete(body)) return body;
      if (body.status === 'failed') {
        throw new OcrProviderError(`Datalab job failed: ${body.error ?? 'unknown error'}`, {
          provider: PROVIDER,
          rawResponse: body,
        });
      }
    }
  }

  private toResult(raw: SubmitResponse, latencyMs: number): OcrResult {
    const blocks = extractBlocks(raw.json);
    const pageCount = raw.page_count ?? 1;
    return {
      provider: PROVIDER,
      providerVersion: raw.version ?? 'unknown',
      rawResponse: raw,
      markdown: raw.markdown,
      blocks,
      html: raw.html,
      pageCount,
      latencyMs,
    };
  }

  private async safeJson(resp: Response): Promise<unknown> {
    try {
      return await resp.json();
    } catch {
      try {
        return await resp.text();
      } catch {
        return undefined;
      }
    }
  }
}

function isComplete(body: SubmitResponse): boolean {
  return body.status === 'complete' && typeof body.markdown === 'string';
}

interface RawBlock {
  id?: string;
  block_type?: string;
  bbox?: { page?: number; x?: number; y?: number; w?: number; h?: number };
  content?: string;
  confidence?: number;
}

const BLOCK_TYPES: readonly BlockType[] = [
  'text',
  'section-header',
  'caption',
  'table',
  'form',
  'list-group',
  'image',
  'figure',
  'equation-block',
  'code-block',
  'page-header',
  'page-footer',
  'complex-block',
];

function extractBlocks(json: unknown): readonly Block[] | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const raw = (json as { blocks?: RawBlock[] }).blocks;
  if (!Array.isArray(raw)) return undefined;
  const out: Block[] = [];
  for (const b of raw) {
    const blockType = BLOCK_TYPES.includes(b.block_type as BlockType)
      ? (b.block_type as BlockType)
      : 'text';
    out.push({
      id: b.id ?? '',
      blockType,
      bbox: {
        page: b.bbox?.page ?? 0,
        x: b.bbox?.x ?? 0,
        y: b.bbox?.y ?? 0,
        w: b.bbox?.w ?? 0,
        h: b.bbox?.h ?? 0,
      },
      content: b.content ?? '',
      ...(typeof b.confidence === 'number' ? { confidence: b.confidence } : {}),
    });
  }
  return out;
}
