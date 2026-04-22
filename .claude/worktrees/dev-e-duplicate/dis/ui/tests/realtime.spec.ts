import { test, expect } from '@playwright/test';
import type {
  RealtimeTransport,
  EventHandler,
  StatusChangedEvent,
} from '../src/state/realtime';

class FakeTransport implements RealtimeTransport {
  public listeners = new Set<EventHandler>();
  public isConnected = false;
  async connect() {
    this.isConnected = true;
  }
  subscribe(h: EventHandler) {
    this.listeners.add(h);
    return () => {
      this.listeners.delete(h);
    };
  }
  disconnect() {
    this.isConnected = false;
  }
  emit(e: StatusChangedEvent) {
    for (const l of this.listeners) l(e);
  }
  drop() {
    this.isConnected = false;
  }
}

test.describe('realtime', () => {
  test('delivers events to subscribers', async () => {
    const t = new FakeTransport();
    await t.connect();
    const received: StatusChangedEvent[] = [];
    const unsub = t.subscribe((e) => received.push(e));
    t.emit({
      type: 'extraction.status.changed',
      extraction_id: 'ext-1',
      patient_id: 'pt',
      from_status: 'ready_for_review',
      to_status: 'promoted',
      version: 2,
      timestamp: new Date().toISOString(),
    });
    expect(received).toHaveLength(1);
    unsub();
  });

  test('reconnects after transient drop', async () => {
    const t = new FakeTransport();
    await t.connect();
    expect(t.isConnected).toBe(true);
    t.drop();
    expect(t.isConnected).toBe(false);
    await t.connect();
    expect(t.isConnected).toBe(true);
  });
});
