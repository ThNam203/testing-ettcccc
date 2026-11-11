import { BRIDGE_PORT } from '../chat/tiktokBridge';
import type { ChatMessage, GameState } from '../engine/types';
import type { AnalyticsEvent, SourceKind } from './events';
import { createSink, createTracker, type Tracker } from './tracker';

/** Browser glue: game tab -> derby server (npm run server). Pure logic lives in events.ts / tracker.ts. */

export const STATS_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
const INGEST_URL = `${STATS_URL}/history/events`;
const FLUSH_EVERY_MS = 2_000;
const MAX_QUEUE = 5_000;
const BATCH_SIZE = 200;

export interface Analytics {
  observe(prev: GameState, next: GameState, now: number): void;
  chat(message: ChatMessage): void;
  source(source: SourceKind, host: string | null): void;
}

export interface AnalyticsOptions {
  readonly source: SourceKind;
  readonly settings: string;
  /** true = saving, false = server unreachable (events are kept and retried). */
  readonly onHealth: (ok: boolean, pending: number, dropped: number) => void;
  /** The server refused events it could not validate (a bug, never expected): total so far. */
  readonly onRejected: (total: number) => void;
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('');
}


export function createAnalytics(options: AnalyticsOptions): Analytics {
  let health: boolean | null = null;
  let rejectedTotal = 0;
  /** text/plain keeps the request "simple" (no CORS preflight) and works for sendBeacon too. */
  const post = async (batch: readonly AnalyticsEvent[]): Promise<boolean> => {
    const response = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (!response.ok) return false;
    const body: unknown = await response.json().catch(() => null);
    const rejected = typeof body === 'object' && body !== null && 'rejected' in body && typeof body.rejected === 'number' ? body.rejected : 0;
    if (rejected > 0) {
      rejectedTotal += rejected;
      options.onRejected(rejectedTotal);
    }
    return true;
  };
  const sink = createSink({
    post,
    maxQueue: MAX_QUEUE,
    batchSize: BATCH_SIZE,
    onHealth: (ok) => {
      health = ok;
      options.onHealth(ok, sink.pending(), sink.dropped());
    },
  });
  const tracker: Tracker = createTracker({
    sessionId: randomId(),
    clock: () => Date.now(),
    emit: (event) => sink.push(event),
    source: options.source,
    host: null,
    settings: options.settings,
  });

  window.setInterval(() => {
    void sink.flush().then(() => {
      if (health === false) options.onHealth(false, sink.pending(), sink.dropped());
    });
  }, FLUSH_EVERY_MS);

  window.addEventListener('pagehide', () => {
    tracker.end();
    const rest = sink.drain();
    if (rest.length === 0) return;
    const sent = navigator.sendBeacon(INGEST_URL, new Blob([JSON.stringify({ events: rest })], { type: 'text/plain' }));
    if (!sent) rest.forEach((e) => sink.push(e)); // nothing more we can do while the page closes
  });

  return {
    observe: (prev, next, now) => tracker.observe(prev, next, now),
    chat: (message) => tracker.chat(message),
    source: (source, host) => tracker.source(source, host),
  };
}
