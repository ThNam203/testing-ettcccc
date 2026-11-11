import type { ChatEnvelope } from './protocol';

/**
 * Shared by the local TikTok bridge (scripts/tiktok-bridge.mjs, runs in Node) and the game page.
 * No runtime imports on purpose: Node loads this file directly with type stripping.
 */

export const BRIDGE_PORT = 5180;
export const BRIDGE_PATH = '/events';

/** Must equal MAX_TEXT_LENGTH / MAX_ID_LENGTH in protocol.ts (a test checks this). */
export const BRIDGE_LIMITS = { text: 200, id: 64 } as const;
/** Must equal HANDLE_PATTERN in protocol.ts and events.ts (a test checks this). */
export const BRIDGE_HANDLE_PATTERN = /^[A-Za-z0-9._]{1,24}$/;

export type BridgeState = 'connecting' | 'live' | 'ended' | 'error';
const STATES: readonly BridgeState[] = ['connecting', 'live', 'ended', 'error'];

export interface BridgeStatus {
  readonly kind: 'bridgeStatus';
  readonly state: BridgeState;
  /** The streamer's @uniqueId. */
  readonly host: string;
  readonly message: string;
}

const LETTERS = ['a', 'b', 'c', 'd'] as const;
export type AnswerLetter = (typeof LETTERS)[number];

/**
 * Test mode: turn any comment into an answer so a random live visibly drives the game.
 * Starts with a–d -> that letter; otherwise the first character's code point picks one.
 */
export function firstCharAnswer(text: string): AnswerLetter | null {
  const first = text.trim().codePointAt(0);
  if (first === undefined) return null;
  const lower = String.fromCodePoint(first).toLowerCase();
  const direct = LETTERS.find((l) => l === lower);
  return direct ?? LETTERS[first % LETTERS.length] ?? null;
}

/** Cut to `max` UTF-16 units without leaving half an emoji at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * TikTok chat event -> the game's chat envelope, or null.
 * tiktok-live-connector 2.5 emits { user: { idStr, id, displayId, nickname }, content };
 * older versions and the README use { user: { uniqueId, nickname }, comment }. Both are read.
 * The numeric id comes first because it survives a viewer renaming their @handle.
 */
export function toChatEnvelope(event: unknown): ChatEnvelope | null {
  if (!isRecord(event) || !isRecord(event.user)) return null;
  const user = event.user;
  const handle = str(user.displayId) || str(user.uniqueId);
  const uniqueId = str(user.idStr) || str(user.id) || handle;
  const comment = str(event.content) || str(event.comment);
  if (uniqueId === '' || comment === '') return null;
  const nickname = str(user.nickname) || handle || uniqueId;
  const envelope: ChatEnvelope = {
    kind: 'chat',
    userId: cut(`tiktok:${uniqueId}`, BRIDGE_LIMITS.id),
    nickname: cut(nickname, BRIDGE_LIMITS.id),
    text: cut(comment, BRIDGE_LIMITS.text),
  };
  return BRIDGE_HANDLE_PATTERN.test(handle) ? { ...envelope, handle } : envelope;
}

export function parseBridgeStatus(data: unknown): BridgeStatus | null {
  if (!isRecord(data) || data.kind !== 'bridgeStatus') return null;
  const state = STATES.find((s) => s === data.state);
  if (state === undefined || typeof data.host !== 'string' || typeof data.message !== 'string') return null;
  return { kind: 'bridgeStatus', state, host: data.host, message: data.message };
}

/** The bridge only answers pages served from this computer. */
export function isLocalOrigin(origin: string | undefined): boolean {
  return origin !== undefined && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}
