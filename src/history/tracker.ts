import type { ChatMessage, GameState } from '../engine/types';
import { RACE_SCOPED, deriveEvents, type AnalyticsEvent, type EventBody, type SourceKind } from './events';

// ---------------------------------------------------------------- tracker: stamps events

export interface TrackerOptions {
  readonly sessionId: string;
  /** Wall clock (Date.now) — injected for tests. */
  readonly clock: () => number;
  readonly emit: (event: AnalyticsEvent) => void;
  readonly source: SourceKind;
  readonly host: string | null;
  /** Settings snapshot as JSON text. */
  readonly settings: string;
}

export interface Tracker {
  /** Call after every state change. */
  observe(prev: GameState, next: GameState, now: number): void;
  chat(message: ChatMessage): void;
  source(source: SourceKind, host: string | null): void;
  end(): void;
}

export function createTracker(options: TrackerOptions): Tracker {
  let counter = 0;
  let raceSeq = 0;
  const stamp = (body: EventBody): void => {
    if (body.type === 'raceStarted') raceSeq += 1;
    counter += 1;
    options.emit({
      id: `${options.sessionId}:${counter}`,
      sessionId: options.sessionId,
      at: options.clock(),
      raceSeq: RACE_SCOPED.has(body.type) ? raceSeq : null,
      body,
    });
  };
  stamp({ type: 'sessionStarted', source: options.source, host: options.host, settings: options.settings });
  return {
    observe(prev, next, now) {
      deriveEvents(prev, next, now).forEach(stamp);
    },
    chat(message) {
      stamp({
        type: 'chatSeen', viewerId: message.userId.trim(), nickname: message.nickname.trim() || message.userId.trim(),
        handle: message.handle ?? null,
      });
    },
    source(source, host) {
      stamp({ type: 'sessionSource', source, host });
    },
    end() {
      stamp({ type: 'sessionEnded' });
    },
  };
}

// ---------------------------------------------------------------- sink: queue + batched delivery

export interface SinkOptions {
  /** Deliver a batch; resolve true when the server stored it. Throwing counts as "down". */
  readonly post: (batch: readonly AnalyticsEvent[]) => Promise<boolean>;
  readonly maxQueue: number;
  readonly batchSize: number;
  /** Called when delivery health changes (true = saving, false = server unreachable). */
  readonly onHealth?: (ok: boolean) => void;
}

export interface Sink {
  push(event: AnalyticsEvent): void;
  /** Send everything queued, batch by batch; stops at the first failure and keeps the rest. */
  flush(): Promise<void>;
  /** Take everything still queued (for navigator.sendBeacon when the page closes). */
  drain(): AnalyticsEvent[];
  pending(): number;
  dropped(): number;
}

export function createSink(options: SinkOptions): Sink {
  let queue: AnalyticsEvent[] = [];
  let droppedCount = 0;
  let healthy: boolean | null = null;
  let busy = false;
  const setHealth = (ok: boolean): void => {
    if (healthy === ok) return;
    healthy = ok;
    options.onHealth?.(ok);
  };
  const send = async (batch: readonly AnalyticsEvent[]): Promise<boolean> => {
    try {
      return await options.post(batch);
    } catch {
      return false; // network error = server down; events stay queued
    }
  };
  return {
    push(event) {
      queue = [...queue, event];
      if (queue.length > options.maxQueue) {
        droppedCount += queue.length - options.maxQueue;
        queue = queue.slice(queue.length - options.maxQueue);
      }
    },
    async flush() {
      if (busy) return;
      busy = true;
      try {
        while (queue.length > 0) {
          const batch = queue.slice(0, options.batchSize);
          const ok = await send(batch);
          setHealth(ok);
          if (!ok) return;
          const sent = new Set(batch.map((e) => e.id));
          queue = queue.filter((e) => !sent.has(e.id));
        }
      } finally {
        busy = false;
      }
    },
    drain() {
      const all = queue;
      queue = [];
      return all;
    },
    pending: () => queue.length,
    dropped: () => droppedCount,
  };
}
