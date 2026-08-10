import type {
  QueuePort,
  QueuePayload,
  QueueHandler,
  EnqueueOptions,
  EnqueueResult,
} from '../../ports/queue.js';

export class FakeQueue implements QueuePort {
  readonly enqueued: Array<{
    topic: string;
    payload: QueuePayload;
    opts?: EnqueueOptions;
  }> = [];
  private seq = 0;

  async enqueue(
    topic: string,
    payload: QueuePayload,
    opts?: EnqueueOptions,
  ): Promise<EnqueueResult> {
    this.enqueued.push({ topic, payload, opts });
    this.seq += 1;
    return { messageId: `msg-${this.seq}` };
  }

  async startConsumer(_topic: string, _handler: QueueHandler): Promise<void> {
    // no-op
  }
}
