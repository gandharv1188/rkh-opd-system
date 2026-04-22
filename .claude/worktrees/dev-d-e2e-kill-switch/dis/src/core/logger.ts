import type { Writable } from 'node:stream';
import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerOptionsDIS {
  /** Service name stamped on every log line (e.g. "dis"). */
  service: string;
  /** Service version stamped on every log line. */
  version: string;
  /** Minimum level to emit. Defaults to `info`. */
  level?: LogLevel;
  /** Destination stream (tests inject a capture sink; prod uses stdout). */
  destination?: Writable;
}

/**
 * Structured logger — thin wrapper over pino with DIS base fields.
 *
 * Why a wrapper:
 *   - centralises the base context (`service`, `version`) so call sites
 *     cannot forget them (TDD §14 requires it on every line).
 *   - keeps the public surface intentionally narrow — swap pino later
 *     without touching call sites.
 */
export type Logger = PinoLogger<never, false>;

export function createLogger(opts: LoggerOptionsDIS): Logger {
  const base: LoggerOptions = {
    level: opts.level ?? 'info',
    base: { service: opts.service, version: opts.version },
  };
  // pino(options, destinationStream?) — stream is an optional second arg.
  if (opts.destination) {
    return pino(base, opts.destination) as Logger;
  }
  return pino(base) as Logger;
}

let _root: Logger | undefined;

/**
 * Returns a process-wide default logger. Lazily initialised so tests that
 * import this module without using it do not emit noise.
 */
export function getRootLogger(): Logger {
  if (!_root) {
    _root = createLogger({
      service: 'dis',
      version: process.env.DIS_VERSION ?? '0.0.1',
      level: (process.env.DIS_LOG_LEVEL as LogLevel | undefined) ?? 'info',
    });
  }
  return _root;
}
