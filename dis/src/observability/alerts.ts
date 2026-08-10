export interface AlertPolicy {
  readonly threshold: number;
  readonly sustainedMs: number;
  readonly cooldownMs: number;
  readonly webhookUrl: string;
  readonly now?: () => number;
  readonly fetchFn?: typeof fetch;
}

export class QueueDepthAlerter {
  private breachStartAt: number | null = null;
  private lastFiredAt = 0;

  constructor(private readonly policy: AlertPolicy) {}

  /** Call on each metrics tick with the latest queue depth. */
  async observe(queueDepth: number): Promise<'fired' | 'noop' | 'armed'> {
    const now = (this.policy.now ?? Date.now)();
    if (queueDepth <= this.policy.threshold) {
      this.breachStartAt = null;
      return 'noop';
    }
    if (this.lastFiredAt > 0 && now - this.lastFiredAt < this.policy.cooldownMs) {
      return 'noop';
    }
    if (this.breachStartAt === null) {
      this.breachStartAt = now;
      return 'armed';
    }
    const sustained = now - this.breachStartAt;
    if (sustained < this.policy.sustainedMs) return 'armed';

    const fetchFn = this.policy.fetchFn ?? fetch;
    await fetchFn(this.policy.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alert: 'queue_depth_breach',
        threshold: this.policy.threshold,
        current: queueDepth,
        sustained_ms: sustained,
        fired_at: new Date(now).toISOString(),
      }),
    });
    this.lastFiredAt = now;
    this.breachStartAt = now;
    return 'fired';
  }
}
