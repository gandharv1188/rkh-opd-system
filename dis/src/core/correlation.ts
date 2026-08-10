import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface Store {
  correlationId: string;
}

const als = new AsyncLocalStorage<Store>();

/** Generate a fresh UUIDv4 suitable for `X-Correlation-Id`. */
export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * Run `fn` with `id` bound as the current correlation ID. The ID is
 * readable via {@link currentCorrelationId} inside `fn` and any async
 * continuations awaited from it. Nested calls override within their
 * own scope and restore on exit. Returns whatever `fn` returns,
 * preserving sync-vs-async return type via the overload.
 */
export function withCorrelation<T>(id: string, fn: () => T): T;
export function withCorrelation<T>(id: string, fn: () => Promise<T>): Promise<T>;
export function withCorrelation<T>(id: string, fn: () => T | Promise<T>): T | Promise<T> {
  return als.run({ correlationId: id }, fn);
}

/**
 * The correlation ID of the current ALS scope, or `undefined` if none
 * is active. Logger, metrics, and audit-log sinks read this when no
 * explicit ID is passed in.
 */
export function currentCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}
