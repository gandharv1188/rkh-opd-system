import { useEffect, useRef, useState } from 'react';

export interface StatusChangedEvent {
  readonly type: 'extraction.status.changed';
  readonly extraction_id: string;
  readonly patient_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly version: number;
  readonly timestamp: string;
}

export type EventHandler = (e: StatusChangedEvent) => void;

export interface RealtimeTransport {
  connect(): Promise<void>;
  subscribe(onEvent: EventHandler): () => void;
  disconnect(): void;
  readonly isConnected: boolean;
}

export class SseTransport implements RealtimeTransport {
  private source: EventSource | null = null;
  private listeners = new Set<EventHandler>();
  isConnected = false;

  constructor(private readonly endpoint = '/admin/realtime/events') {}

  async connect(): Promise<void> {
    if (typeof EventSource === 'undefined') return;
    this.source = new EventSource(this.endpoint);
    this.source.onopen = () => {
      this.isConnected = true;
    };
    this.source.onerror = () => {
      this.isConnected = false;
    };
    this.source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as StatusChangedEvent;
        for (const l of this.listeners) l(event);
      } catch {
        // Skip malformed messages silently.
      }
    };
  }

  subscribe(onEvent: EventHandler): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
    this.isConnected = false;
  }
}

export function useRealtime(transport: RealtimeTransport): {
  isConnected: boolean;
  subscribe: (h: EventHandler) => () => void;
} {
  const [isConnected, setIsConnected] = useState(transport.isConnected);
  const transportRef = useRef(transport);

  useEffect(() => {
    let cancelled = false;
    void transportRef.current.connect().then(() => {
      if (!cancelled) setIsConnected(true);
    });
    const poll = setInterval(() => {
      if (!cancelled) setIsConnected(transportRef.current.isConnected);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      transportRef.current.disconnect();
    };
  }, []);

  return {
    isConnected,
    subscribe: transportRef.current.subscribe.bind(transportRef.current),
  };
}
