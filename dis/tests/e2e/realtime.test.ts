import { describe, it, expect } from 'vitest';
import { StatusChannel, type StatusChangedEvent } from '../../src/http/realtime/status-channel.js';

describe('E2E realtime channel roundtrip', () => {
  it('event arrives within 2s', async () => {
    const channel = new StatusChannel();
    const received: StatusChangedEvent[] = [];

    const unsub = channel.subscribe((e) => received.push(e));

    const event: StatusChangedEvent = {
      type: 'extraction.status.changed',
      extraction_id: 'ext-1',
      patient_id: 'pt-1',
      from_status: 'ready_for_review',
      to_status: 'promoted',
      version: 2,
      timestamp: new Date().toISOString(),
    };

    const deadline = Promise.race([
      new Promise<boolean>((resolve) => {
        const check = () => {
          if (received.length > 0) resolve(true);
          else setTimeout(check, 10);
        };
        check();
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);

    channel.publish(event);
    const arrivedInTime = await deadline;

    expect(arrivedInTime).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);

    unsub();
  });
});
