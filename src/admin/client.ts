import type { QuestionSource } from '../engine/types';
import {
  ADMIN_CHANNEL, parseAdminResult, parseAdminSnapshot, parseHostBye,
  type AdminCommand, type AdminRequest, type AdminResult, type AdminSnapshot,
} from './protocol';

const REPLY_TIMEOUT_MS = 3_000;
/** No snapshot for this long = game tab closed or frozen. Host heartbeat is 1 s. */
const STALE_MS = 3_500;
const KEEPALIVE_MS = 1_500;

export interface Connection {
  readonly connected: boolean;
  /** Game tabs heard from recently; more than one means settings go to all of them. */
  readonly hosts: number;
}

export interface AdminClient {
  send(command: AdminCommand): Promise<AdminResult>;
  onSnapshot(listener: (snapshot: AdminSnapshot, receivedAt: number) => void): void;
  onConnection(listener: (connection: Connection) => void): void;
}

/** Admin-page side of the admin channel. Returns null when BroadcastChannel is missing. */
export function createAdminClient(bank: readonly QuestionSource[]): AdminClient | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(ADMIN_CHANNEL);
  const waiting = new Map<string, (result: AdminResult) => void>();
  const snapshotListeners: ((s: AdminSnapshot, at: number) => void)[] = [];
  const connectionListeners: ((c: Connection) => void)[] = [];
  const hostsSeen = new Map<string, number>();
  let counter = 0;
  let last: Connection = { connected: false, hosts: 0 };

  const checkConnection = (): void => {
    const now = performance.now();
    for (const [id, at] of hostsSeen) if (now - at > STALE_MS) hostsSeen.delete(id);
    const next: Connection = { connected: hostsSeen.size > 0, hosts: hostsSeen.size };
    if (next.connected === last.connected && next.hosts === last.hosts) return;
    last = next;
    connectionListeners.forEach((fn) => fn(next));
  };

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const result = parseAdminResult(event.data);
    if (result !== null) {
      waiting.get(result.requestId)?.(result);
      waiting.delete(result.requestId);
      return;
    }
    const bye = parseHostBye(event.data);
    if (bye !== null) {
      hostsSeen.delete(bye.hostId);
      checkConnection();
      return;
    }
    const snapshot = parseAdminSnapshot(event.data, bank);
    if (snapshot === null) return;
    const at = performance.now();
    hostsSeen.set(snapshot.hostId, at);
    checkConnection();
    snapshotListeners.forEach((fn) => fn(snapshot, at));
  });
  window.setInterval(checkConnection, 1_000);
  // Keep-alive: the game tab answers in its message handler, which the browser does not throttle
  // the way it throttles timers in a hidden tab, so the admin page does not flap to "not found".
  window.setInterval(() => {
    counter += 1;
    const ping: AdminRequest = { kind: 'adminRequest', requestId: `ping-${counter}`, command: { type: 'hello' } };
    channel.postMessage(ping);
  }, KEEPALIVE_MS);

  const client: AdminClient = {
    send(command) {
      counter += 1;
      const requestId = `${Date.now().toString(36)}-${counter}`;
      const request: AdminRequest = { kind: 'adminRequest', requestId, command };
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          waiting.delete(requestId);
          resolve({ kind: 'adminResult', requestId, ok: false, message: 'No answer from the game tab. Is it open in this browser?' });
        }, REPLY_TIMEOUT_MS);
        waiting.set(requestId, (result) => {
          window.clearTimeout(timer);
          resolve(result);
        });
        channel.postMessage(request);
      });
    },
    onSnapshot(listener) {
      snapshotListeners.push(listener);
    },
    onConnection(listener) {
      connectionListeners.push(listener);
      listener(last);
    },
  };
  return client;
}
