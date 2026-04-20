/**
 * Queue port — background job abstraction satisfied by the pg_cron/pg_net
 * POC adapter and the SQS production adapter.
 *
 * @see portability.md §Queue portability
 */

/**
 * Payload shape accepted by {@link QueuePort.enqueue}.
 *
 * Structured as a JSON-serialisable record; adapters MUST serialise via
 * `JSON.stringify` and reject non-serialisable values (functions, bigints,
 * cyclic refs) at the adapter boundary.
 */
export type QueuePayload = Record<string, unknown>;

/**
 * Options accepted by {@link QueuePort.enqueue}.
 */
export type EnqueueOptions = {
  /** Delay, in seconds, before the message becomes visible to consumers. */
  readonly delaySec?: number;
};

/**
 * Result of a successful {@link QueuePort.enqueue} call.
 */
export type EnqueueResult = {
  readonly messageId: string;
};

/**
 * Consumer handler signature. `payload` is delivered as parsed JSON; handlers
 * MUST validate its shape before use (callers are responsible for schema
 * validation).
 */
export type QueueHandler = (payload: unknown) => Promise<void>;

/**
 * Provider-agnostic queue port.
 *
 * @see portability.md §Queue portability
 */
export interface QueuePort {
  enqueue(
    topic: string,
    payload: QueuePayload,
    opts?: EnqueueOptions,
  ): Promise<EnqueueResult>;
  startConsumer(topic: string, handler: QueueHandler): Promise<void>;
}
