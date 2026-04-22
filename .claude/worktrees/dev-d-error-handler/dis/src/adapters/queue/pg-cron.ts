/**
 * PgCronAdapter — implements {@link QueuePort} over the pg_cron + pg_net
 * dispatch pattern documented in portability.md §Queue.
 *
 * enqueue(): inserts a row into `dis_jobs` with a JSON-serialised payload and
 * a visible_at timestamp. A pg_cron-scheduled SQL poller (out of scope here,
 * owned by the schema/DIS-097 wiring) performs
 * `SELECT FOR UPDATE SKIP LOCKED` batches and uses pg_net to HTTP-POST each
 * payload to the service's /internal/process-job endpoint (Epic D).
 *
 * startConsumer(): no-op in the POC because dispatch lives in the database
 * (pg_cron + pg_net). The AWS SQS adapter will have a non-trivial consumer.
 *
 * The adapter depends only on {@link DatabasePort} — no direct postgres or
 * supabase imports — so it runs identically against the live SupabasePostgres
 * adapter, the fake, or any future Postgres driver.
 *
 * @see TDD §9.5 (QueuePort)
 * @see portability.md §Queue portability
 * @see ADR-006 (Postgres driver isolated at adapter boundary)
 */

import type { DatabasePort } from '../../ports/database.js';
import type {
  EnqueueOptions,
  EnqueueResult,
  QueueHandler,
  QueuePayload,
  QueuePort,
} from '../../ports/queue.js';

const INSERT_SQL =
  'INSERT INTO dis_jobs (topic, payload, visible_at) VALUES ($1, $2::jsonb, $3) RETURNING id';

type NowFn = () => number;

export interface PgCronAdapterOptions {
  readonly db: DatabasePort;
  readonly now?: NowFn;
}

export class PgCronAdapter implements QueuePort {
  private readonly db: DatabasePort;
  private readonly now: NowFn;

  public constructor(opts: PgCronAdapterOptions) {
    this.db = opts.db;
    this.now = opts.now ?? Date.now;
  }

  public async enqueue(
    topic: string,
    payload: QueuePayload,
    opts?: EnqueueOptions,
  ): Promise<EnqueueResult> {
    const serialised = safeStringify(payload);
    const visibleAt = new Date(this.now() + (opts?.delaySec ?? 0) * 1000);

    const rows = await this.db.query<{ id: string }>(INSERT_SQL, [topic, serialised, visibleAt]);
    const row = rows[0];
    if (!row || typeof row.id !== 'string' || row.id.length === 0) {
      throw new Error(
        `PgCronAdapter.enqueue: dis_jobs INSERT returned no id (topic=${topic})`,
      );
    }
    return { messageId: row.id };
  }

  public async startConsumer(_topic: string, _handler: QueueHandler): Promise<void> {
    // POC: pg_cron + pg_net dispatch HTTP calls to /internal/process-job
    // (Epic D / DIS-097). Nothing for the in-process adapter to do.
  }
}

function safeStringify(payload: QueuePayload): string {
  try {
    return JSON.stringify(payload, (_k, v) => {
      if (typeof v === 'bigint') {
        throw new Error('bigint is not JSON-serialisable');
      }
      if (typeof v === 'function') {
        throw new Error('function is not JSON-serialisable');
      }
      return v;
    });
  } catch (err) {
    throw new Error(
      `PgCronAdapter.enqueue: payload is not JSON-serialisable — ${(err as Error).message}`,
    );
  }
}
