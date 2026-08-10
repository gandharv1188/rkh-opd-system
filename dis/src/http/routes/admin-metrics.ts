import type { Hono } from 'hono';
import { getDefaultMetrics, type Metrics } from '../../core/metrics.js';

/**
 * Registers `GET /admin/metrics` on the provided Hono app.
 *
 * Returns `Metrics.snapshot()` as JSON for POC per TDD §14. Auth is
 * deliberately out of scope (DIS-009 ticket "Out of scope").
 *
 * The `metrics` argument is injectable so tests can assert behaviour
 * without mutating process-wide state; omitting it uses the default.
 */
export function registerAdminMetricsRoute(app: Hono, metrics: Metrics = getDefaultMetrics()): void {
  app.get('/admin/metrics', (c) => {
    const snap = metrics.snapshot();
    return c.json(snap, 200);
  });
}
