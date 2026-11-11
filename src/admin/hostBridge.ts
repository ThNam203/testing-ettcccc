import type { GameState, QuestionSource } from '../engine/types';
import type { DisplaySettings } from '../settings/schema';
import { ADMIN_CHANNEL, buildSnapshot, parseAdminRequest, type AdminCommand, type AdminResult, type HostBye } from './protocol';

const MIN_PUBLISH_MS = 250;
const HEARTBEAT_MS = 1_000;

export interface HostBridge {
  /** Call every logic tick; publishes a snapshot when something changed, plus a heartbeat. */
  sync(state: GameState, display: DisplaySettings, now: number): void;
}

export interface HostView {
  readonly state: GameState;
  readonly display: DisplaySettings;
}

/** Game-tab side of the admin channel. Returns null when BroadcastChannel is missing. */
export function createHostBridge(
  bank: readonly QuestionSource[],
  onCommand: (command: AdminCommand) => { ok: boolean; message: string },
  view: () => HostView,
): HostBridge | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(ADMIN_CHANNEL);
  // getRandomValues works on plain http too (randomUUID needs a secure context).
  const hostId = Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join('-');
  let lastState: GameState | null = null;
  let lastDisplay: DisplaySettings | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  let force = true;

  const publish = (now: number): void => {
    const { state, display } = view();
    channel.postMessage(buildSnapshot(state, display, hostId, now));
    lastState = state;
    lastDisplay = display;
    lastAt = now;
    force = false;
  };

  window.addEventListener('pagehide', () => {
    const bye: HostBye = { kind: 'adminBye', hostId };
    channel.postMessage(bye);
  });

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const request = parseAdminRequest(event.data, bank);
    if (request === null) return;
    const outcome = onCommand(request.command);
    const result: AdminResult = { kind: 'adminResult', requestId: request.requestId, ok: outcome.ok, message: outcome.message };
    channel.postMessage(result);
    // Reply with fresh state at once: timers in a background game tab can be throttled by the browser.
    publish(performance.now());
  });

  return {
    sync(state, display, now) {
      const changed = state !== lastState || display !== lastDisplay;
      const due = force || (changed && now - lastAt >= MIN_PUBLISH_MS) || now - lastAt >= HEARTBEAT_MS;
      if (due) publish(now);
    },
  };
}
