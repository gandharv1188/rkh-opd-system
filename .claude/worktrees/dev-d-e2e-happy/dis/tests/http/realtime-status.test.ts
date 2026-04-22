import { describe, expect, it, vi } from 'vitest';
import {
  createStatusChannel,
  type StatusChangedEvent,
} from '../../src/http/realtime/status-channel.js';

function makeEvent(overrides: Partial<StatusChangedEvent> = {}): StatusChangedEvent {
  return {
    type: 'extraction.status.changed',
    extraction_id: 'ext-1',
    patient_id: 'pat-1',
    from_status: 'ready_for_review',
    to_status: 'verified',
    version: 2,
    timestamp: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('StatusChannel', () => {
  it('emits event on state transition', () => {
    const channel = createStatusChannel();
    const listener = vi.fn();
    channel.subscribe(listener);

    const event = makeEvent();
    channel.publish(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('multiple subscribers receive the event', () => {
    const channel = createStatusChannel();
    const a = vi.fn();
    const b = vi.fn();
    channel.subscribe(a);
    channel.subscribe(b);

    const event = makeEvent({ extraction_id: 'ext-2' });
    channel.publish(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('unsubscribe stops delivery', () => {
    const channel = createStatusChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);

    unsubscribe();
    channel.publish(makeEvent());

    expect(listener).not.toHaveBeenCalled();
  });

  it('event shape has all required fields', () => {
    const channel = createStatusChannel();
    let received: StatusChangedEvent | undefined;
    channel.subscribe((e) => {
      received = e;
    });

    channel.publish(makeEvent());

    expect(received).toBeDefined();
    expect(received?.type).toBe('extraction.status.changed');
    expect(received?.extraction_id).toBe('ext-1');
    expect(received?.to_status).toBe('verified');
    expect(typeof received?.timestamp).toBe('string');
  });
});
