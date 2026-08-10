import { EventEmitter } from 'node:events';
import type { State } from '../../core/state-machine.js';

export interface StatusChangedEvent {
  readonly type: 'extraction.status.changed';
  readonly extraction_id: string;
  readonly patient_id: string;
  readonly from_status: State | null;
  readonly to_status: State;
  readonly version: number;
  readonly timestamp: string;
  readonly correlation_id?: string;
}

export interface StatusChannelListener {
  (event: StatusChangedEvent): void;
}

export class StatusChannel {
  private readonly emitter = new EventEmitter();

  publish(event: StatusChangedEvent): void {
    this.emitter.emit('status.changed', event);
  }

  subscribe(listener: StatusChannelListener): () => void {
    this.emitter.on('status.changed', listener);
    return () => this.emitter.off('status.changed', listener);
  }
}

export function createStatusChannel(): StatusChannel {
  return new StatusChannel();
}
