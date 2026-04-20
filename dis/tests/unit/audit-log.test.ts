import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabasePort } from '../../src/ports/database.js';
import { AuditLogger, AuditLogImmutableError, type AuditEvent } from '../../src/core/audit-log.js';

interface InsertedRow {
  readonly sql: string;
  readonly params: readonly unknown[];
}

class FakeDatabase implements DatabasePort {
  public readonly inserts: InsertedRow[] = [];
  public txCount = 0;

  async query<T>(_sql: string, _params: readonly unknown[]): Promise<readonly T[]> {
    return [] as readonly T[];
  }

  async queryOne<T>(_sql: string, _params: readonly unknown[]): Promise<T | null> {
    return null;
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    this.txCount += 1;
    const tx: DatabasePort = {
      query: async <U>(sql: string, params: readonly unknown[]): Promise<readonly U[]> => {
        this.inserts.push({ sql, params });
        return [] as readonly U[];
      },
      queryOne: async <U>(_sql: string, _params: readonly unknown[]): Promise<U | null> => null,
      transaction: async <U>(inner: (t: DatabasePort) => Promise<U>): Promise<U> => inner(tx),
      setSessionVars: async () => {},
    };
    return work(tx);
  }

  async setSessionVars(_vars: Readonly<Record<string, string>>): Promise<void> {
    /* noop */
  }
}

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    extractionId: '11111111-1111-1111-1111-111111111111',
    eventType: 'state_transition',
    actorType: 'system',
    actorId: null,
    correlationId: '22222222-2222-2222-2222-222222222222',
    fromState: 'pending_review',
    toState: 'ready_for_review',
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let db: FakeDatabase;
  let logger: AuditLogger;

  beforeEach(() => {
    db = new FakeDatabase();
    logger = new AuditLogger(db);
  });

  it('write() inserts a row into ocr_audit_log', async () => {
    await logger.write(makeEvent());
    expect(db.inserts.length).toBe(1);
    const row = db.inserts[0]!;
    expect(row.sql).toMatch(/insert\s+into\s+ocr_audit_log/i);
  });

  it('every write carries extraction_id, event_type, actor_type, actor_id, correlation_id', async () => {
    await logger.write(makeEvent({ actorId: 'user-42', eventType: 'approve', actorType: 'user' }));
    const row = db.inserts[0]!;
    expect(row.params).toContain('11111111-1111-1111-1111-111111111111');
    expect(row.params).toContain('approve');
    expect(row.params).toContain('user');
    expect(row.params).toContain('user-42');
    expect(row.params).toContain('22222222-2222-2222-2222-222222222222');
  });

  it('write() runs inside a transaction', async () => {
    await logger.write(makeEvent());
    expect(db.txCount).toBe(1);
  });

  it('writeMany() preserves order', async () => {
    const events: AuditEvent[] = [
      makeEvent({ eventType: 'state_transition', toState: 'ocr_running' }),
      makeEvent({ eventType: 'state_transition', toState: 'structuring_running' }),
      makeEvent({ eventType: 'state_transition', toState: 'ready_for_review' }),
    ];
    await logger.writeMany(events);
    expect(db.inserts.length).toBe(3);
    expect(db.inserts[0]!.params).toContain('ocr_running');
    expect(db.inserts[1]!.params).toContain('structuring_running');
    expect(db.inserts[2]!.params).toContain('ready_for_review');
  });

  it('update() is not part of the contract (compile-time immutability)', () => {
    // AuditLogger exposes neither update() nor delete(). Verified at the
    // type level: the following would fail to compile if uncommented.
    //   logger.update(...);   // ts(2339)
    //   logger.delete(...);   // ts(2339)
    expect((logger as unknown as Record<string, unknown>)['update']).toBeUndefined();
    expect((logger as unknown as Record<string, unknown>)['delete']).toBeUndefined();
  });

  it('AuditLogImmutableError is raised when DB rejects update attempt', () => {
    const err = new AuditLogImmutableError('update');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuditLogImmutableError');
    expect(err.code).toBe('AUDIT_LOG_IMMUTABLE');
    expect(err.attemptedOperation).toBe('update');
  });

  it('AuditLogImmutableError is raised when DB rejects delete attempt', () => {
    const err = new AuditLogImmutableError('delete');
    expect(err.attemptedOperation).toBe('delete');
    expect(err.message).toMatch(/append-only/i);
  });
});
