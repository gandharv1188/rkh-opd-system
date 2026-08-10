/**
 * Unit tests — SupabasePostgresAdapter (DIS-054).
 *
 * TDD §16 (portability via DatabasePort). Portability rule: no Supabase SDK
 * in queries. The adapter uses `postgres` (porsager/postgres) under the hood;
 * for testability it accepts a pre-built `sql` client via the factory, so
 * these tests drive it with an in-memory fake that records calls.
 */

import { describe, it, expect } from 'vitest';

import {
  SupabasePostgresAdapter,
  DatabaseConnectionError,
  type SqlClient,
} from '../../../src/adapters/database/supabase-postgres.js';

type Call = { strings: readonly string[]; values: readonly unknown[] };

type FakeBehavior = {
  rows?: readonly unknown[];
  throwOnTag?: string;
  throwError?: unknown;
};

function makeFakeSql(behavior: FakeBehavior = {}): {
  sql: SqlClient;
  calls: Call[];
  ended: { count: number };
} {
  const calls: Call[] = [];
  const ended = { count: 0 };

  const tag = (
    strings: TemplateStringsArray | readonly string[],
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const stringsArr = Array.from(strings);
    calls.push({ strings: stringsArr, values });
    if (
      behavior.throwOnTag &&
      stringsArr.join('').toLowerCase().includes(behavior.throwOnTag.toLowerCase())
    ) {
      return Promise.reject(behavior.throwError ?? new Error('forced'));
    }
    return Promise.resolve(Array.from(behavior.rows ?? []));
  };

  const unsafe = (text: string, params: readonly unknown[] = []): Promise<unknown[]> => {
    calls.push({ strings: [text], values: params });
    if (behavior.throwOnTag && text.toLowerCase().includes(behavior.throwOnTag.toLowerCase())) {
      return Promise.reject(behavior.throwError ?? new Error('forced'));
    }
    return Promise.resolve(Array.from(behavior.rows ?? []));
  };

  const begin = async <T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> => {
    calls.push({ strings: ['BEGIN'], values: [] });
    try {
      const result = await fn(sql);
      calls.push({ strings: ['COMMIT'], values: [] });
      return result;
    } catch (err) {
      calls.push({ strings: ['ROLLBACK'], values: [] });
      throw err;
    }
  };

  const end = async (): Promise<void> => {
    ended.count += 1;
  };

  const sql = Object.assign(tag, { unsafe, begin, end }) as unknown as SqlClient;
  return { sql, calls, ended };
}

describe('SupabasePostgresAdapter', () => {
  it('query() returns a readonly array of rows via parameterized call (no string concat)', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const { sql, calls } = makeFakeSql({ rows });
    const adapter = new SupabasePostgresAdapter({ sql });

    const result = await adapter.query<{ id: string }>(
      'SELECT id FROM patients WHERE tenant = $1',
      ['rkh'],
    );

    expect(result).toEqual(rows);
    expect(Object.isFrozen(result)).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.values).toEqual(['rkh']);
    expect(call.strings.join('')).not.toContain('rkh');
  });

  it('queryOne() returns the first row or null', async () => {
    {
      const { sql } = makeFakeSql({ rows: [{ id: '1' }] });
      const adapter = new SupabasePostgresAdapter({ sql });
      const row = await adapter.queryOne<{ id: string }>('SELECT id FROM x WHERE id=$1', ['1']);
      expect(row).toEqual({ id: '1' });
    }
    {
      const { sql } = makeFakeSql({ rows: [] });
      const adapter = new SupabasePostgresAdapter({ sql });
      const row = await adapter.queryOne<{ id: string }>('SELECT id FROM x WHERE id=$1', ['nope']);
      expect(row).toBeNull();
    }
  });

  it('transaction() commits on success', async () => {
    const { sql, calls } = makeFakeSql({ rows: [] });
    const adapter = new SupabasePostgresAdapter({ sql });

    const result = await adapter.transaction(async (tx) => {
      await tx.query('INSERT INTO x(id) VALUES ($1)', ['a']);
      return 42;
    });

    expect(result).toBe(42);
    const tags = calls.map((c) => c.strings.join('').trim().toUpperCase());
    expect(tags).toContain('BEGIN');
    expect(tags).toContain('COMMIT');
    expect(tags).not.toContain('ROLLBACK');
  });

  it('transaction() rolls back on error and rethrows', async () => {
    const { sql, calls } = makeFakeSql({ rows: [] });
    const adapter = new SupabasePostgresAdapter({ sql });

    const boom = new Error('work-failed');
    await expect(
      adapter.transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const tags = calls.map((c) => c.strings.join('').trim().toUpperCase());
    expect(tags).toContain('BEGIN');
    expect(tags).toContain('ROLLBACK');
    expect(tags).not.toContain('COMMIT');
  });

  it('setSessionVars() emits SET LOCAL parameterized for each key', async () => {
    const { sql, calls } = makeFakeSql({ rows: [] });
    const adapter = new SupabasePostgresAdapter({ sql });

    await adapter.setSessionVars({ 'app.role': 'doctor', 'app.patient_id': 'p-1' });

    const setLocalCalls = calls.filter((c) =>
      c.strings.join('').toUpperCase().includes('SET LOCAL'),
    );
    expect(setLocalCalls.length).toBe(2);
    for (const c of setLocalCalls) {
      const sqlText = c.strings.join('').toUpperCase();
      expect(sqlText).toContain('SET LOCAL');
      expect(c.values.length).toBe(1);
      expect(['doctor', 'p-1']).toContain(c.values[0]);
    }
  });

  it('reuses a single connection pool across calls', async () => {
    const { sql, calls } = makeFakeSql({ rows: [] });
    const adapter = new SupabasePostgresAdapter({ sql });

    await adapter.query('SELECT 1', []);
    await adapter.query('SELECT 2', []);
    await adapter.queryOne('SELECT 3', []);

    expect(calls.length).toBe(3);
  });

  it('wraps connection errors in DatabaseConnectionError', async () => {
    const connError = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const { sql } = makeFakeSql({ throwOnTag: 'select', throwError: connError });
    const adapter = new SupabasePostgresAdapter({ sql });

    await expect(adapter.query('SELECT 1', [])).rejects.toBeInstanceOf(DatabaseConnectionError);
  });
});
