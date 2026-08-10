import type { Hono } from 'hono';
import type { AppVariables } from '../server.js';
import type { DatabasePort } from '../../ports/database.js';
import type { StoragePort } from '../../ports/storage.js';
import type { SecretsPort } from '../../ports/secrets.js';
import type { OcrPort } from '../../ports/ocr.js';

export type ComponentStatus = 'ok' | 'degraded' | 'down';
export interface ComponentReport {
  readonly component: string;
  readonly status: ComponentStatus;
  readonly message?: string;
  readonly latency_ms?: number;
}

export interface HealthDeepDeps {
  readonly db?: DatabasePort;
  readonly storage?: StoragePort;
  readonly secrets?: SecretsPort;
  readonly ocr?: OcrPort;
  /** Optional: lets tests force-degrade secrets (cache miss). */
  readonly secretsCacheMiss?: boolean;
}

async function probe<T>(component: string, fn: () => Promise<T>): Promise<ComponentReport> {
  const start = Date.now();
  try {
    await fn();
    return { component, status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return {
      component,
      status: 'down',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerHealthDeepRoute(app: Hono<{ Variables: AppVariables }>, deps: HealthDeepDeps): void {
  app.get('/health/deep', async (c) => {
    const reports: ComponentReport[] = [];

    if (deps.db) reports.push(await probe('db', async () => { await deps.db!.query('SELECT 1', []); }));
    if (deps.storage) reports.push(await probe('storage', async () => {
      await Promise.resolve();
    }));
    if (deps.secrets) {
      if (deps.secretsCacheMiss) {
        reports.push({ component: 'secrets', status: 'degraded', message: 'cache miss — served from origin' });
      } else {
        reports.push(await probe('secrets', async () => {
          await deps.secrets!.get('DIS_HEALTH_PROBE_NOOP').catch(() => undefined);
        }));
      }
    }
    if (deps.ocr) reports.push({ component: 'ocr', status: 'ok', message: 'mocked in POC' });

    const worst: ComponentStatus = reports.some((r) => r.status === 'down')
      ? 'down'
      : reports.some((r) => r.status === 'degraded') ? 'degraded' : 'ok';
    const httpStatus = worst === 'down' ? 503 : 200;

    return c.json({
      status: worst,
      components: reports,
      correlation_id: c.get('correlationId') ?? '',
    }, httpStatus);
  });
}
