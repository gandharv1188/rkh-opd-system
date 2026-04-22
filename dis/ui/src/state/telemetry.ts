export interface VerifyDuration {
  readonly extraction_id: string;
  readonly started_at: number;
  readonly ended_at: number;
  readonly duration_ms: number;
  readonly outcome: 'approved' | 'rejected' | 'abandoned';
}

export interface TelemetryPort {
  postAggregate(duration: VerifyDuration): Promise<void>;
}

const timers = new Map<string, number>();

export function startVerifyTimer(extractionId: string, now: () => number = Date.now): void {
  timers.set(extractionId, now());
}

export function stopVerifyTimer(
  extractionId: string,
  outcome: VerifyDuration['outcome'],
  now: () => number = Date.now,
): VerifyDuration | null {
  const started = timers.get(extractionId);
  if (!started) return null;
  timers.delete(extractionId);
  const ended = now();
  return {
    extraction_id: extractionId,
    started_at: started,
    ended_at: ended,
    duration_ms: ended - started,
    outcome,
  };
}

export async function postVerifyDuration(
  duration: VerifyDuration,
  endpoint = '/admin/metrics/verify-duration',
): Promise<void> {
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(duration),
    });
  } catch {
    // Telemetry must never crash the UI.
  }
}

export function __resetTimers(): void {
  timers.clear();
}
