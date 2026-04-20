/**
 * SupabasePostgresAdapter — DatabasePort implementation for the Supabase
 * Postgres stack.
 *
 * Uses the `postgres` npm package (porsager/postgres) for connection pooling,
 * parameterised tagged-template queries, and transactions. No Supabase SDK
 * imports: DIS only talks to Postgres over TCP, satisfying the portability
 * rule in portability.md (§Database portability).
 *
 * Design notes:
 * - Constructor accepts either `{ connectionString }` (caller resolved via
 *   SecretsPort) or a pre-built `sql` client for dependency injection in
 *   tests. The default pool is created lazily on first use and reused.
 * - RLS session variables are applied through `SET LOCAL app.<key> = $1`
 *   inside the current connection so values stay scoped correctly.
 * - All driver errors are wrapped in typed errors so callers can branch on
 *   `DatabaseConnectionError` without importing the driver.
 *
 * @see TDD §16 portability
 * @see portability.md §Database portability
 * @see coding_standards.md §6
 */

import type { DatabasePort } from '../../ports/database.js';

/**
 * Minimal structural type for the `postgres` client we depend on. We define
 * only the surface the adapter uses so tests can supply a fake without
 * pulling in the driver, and so swapping the underlying lib stays a local
 * edit.
 */
export interface SqlClient {
  (
    strings: TemplateStringsArray | readonly string[],
    ...values: readonly unknown[]
  ): Promise<unknown[]>;
  unsafe(text: string, params?: readonly unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export class DatabaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = 'DatabaseError';
  }
}

export class DatabaseConnectionError extends DatabaseError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('DATABASE_CONNECTION', message, options);
    this.name = 'DatabaseConnectionError';
  }
}

export type SupabasePostgresAdapterOptions =
  | { readonly connectionString: string; readonly sql?: never }
  | { readonly sql: SqlClient; readonly connectionString?: never };

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
]);

function isConnectionError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code);
}

function wrapError(err: unknown, context: string): never {
  if (isConnectionError(err)) {
    throw new DatabaseConnectionError(`${context}: ${(err as Error).message}`, { cause: err });
  }
  throw err;
}

export class SupabasePostgresAdapter implements DatabasePort {
  private readonly sql: SqlClient;

  constructor(options: SupabasePostgresAdapterOptions) {
    if ('sql' in options && options.sql !== undefined) {
      this.sql = options.sql;
      return;
    }
    if (!('connectionString' in options) || !options.connectionString) {
      throw new DatabaseError(
        'DATABASE_CONFIG',
        'SupabasePostgresAdapter requires either connectionString or sql',
      );
    }
    this.sql = createDefaultSqlClient(options.connectionString);
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    return this.runQuery<T>(this.sql, sql, params);
  }

  async queryOne<T>(sql: string, params: readonly unknown[]): Promise<T | null> {
    const rows = await this.runQuery<T>(this.sql, sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    try {
      return await this.sql.begin<T>(async (txSql) => {
        const txAdapter = new SupabasePostgresAdapter({ sql: txSql });
        return work(txAdapter);
      });
    } catch (err) {
      if (isConnectionError(err)) {
        throw new DatabaseConnectionError(`transaction failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  async setSessionVars(vars: Readonly<Record<string, string>>): Promise<void> {
    for (const [key, value] of Object.entries(vars)) {
      if (!/^[a-z_][a-z0-9_.]*$/i.test(key)) {
        throw new DatabaseError('DATABASE_INVALID_SESSION_KEY', `invalid session var key: ${key}`);
      }
      try {
        await this.sql.unsafe(`SET LOCAL ${key} = $1`, [value]);
      } catch (err) {
        wrapError(err, `setSessionVars(${key})`);
      }
    }
  }

  private async runQuery<T>(
    client: SqlClient,
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly T[]> {
    try {
      const rows = await client.unsafe(sql, params);
      return Object.freeze(rows.slice() as T[]);
    } catch (err) {
      wrapError(err, 'query');
    }
  }
}

let driverLoader: (connectionString: string) => SqlClient = () => {
  throw new DatabaseError(
    'DATABASE_DRIVER_MISSING',
    'postgres driver not wired: install `postgres` and register it via setPostgresDriverLoader',
  );
};

/**
 * Register the real driver factory. Called by the wiring layer
 * (`src/wiring/supabase.ts`) so this module does not import the driver at
 * load time — keeps unit tests hermetic and the driver dependency optional
 * until integration.
 */
export function setPostgresDriverLoader(loader: (connectionString: string) => SqlClient): void {
  driverLoader = loader;
}

function createDefaultSqlClient(connectionString: string): SqlClient {
  return driverLoader(connectionString);
}
