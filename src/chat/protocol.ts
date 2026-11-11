import type { ChatMessage, Phase, StatKey } from '../engine/types';

/** BroadcastChannel name shared by the host page and local chat simulator tabs. */
export const LOCAL_CHANNEL = 'english-derby-local';

export const MAX_TEXT_LENGTH = 200;
export const MAX_ID_LENGTH = 64;
/** TikTok usernames: letters, digits, underscore and period, at most 24 characters. */
export const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,24}$/;

export interface ChatEnvelope extends ChatMessage {
  readonly kind: 'chat';
}

/** What the host tells simulator tabs, so testers can see what to answer. */
export interface StatusEnvelope {
  readonly kind: 'status';
  readonly phase: Phase;
  readonly raceNumber: number;
  readonly round: number;
  readonly rounds: number;
  readonly prompt: string | null;
  readonly choices: readonly string[];
  readonly stat: StatKey | null;
  readonly racerIds: readonly string[];
  readonly queuedIds: readonly string[];
}

export type Envelope = ChatEnvelope | StatusEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > max ? null : trimmed;
}

/** Validate untrusted channel data into a ChatMessage, or null. */
export function parseChatEnvelope(data: unknown): ChatMessage | null {
  if (!isRecord(data) || data.kind !== 'chat') return null;
  const userId = boundedString(data.userId, MAX_ID_LENGTH);
  const nickname = boundedString(data.nickname, MAX_ID_LENGTH);
  const text = boundedString(data.text, MAX_TEXT_LENGTH);
  if (userId === null || nickname === null || text === null) return null;
  // A malformed handle is dropped, not fatal: the comment itself is still valid chat.
  const handle = typeof data.handle === 'string' && HANDLE_PATTERN.test(data.handle) ? data.handle : null;
  return handle === null ? { userId, nickname, text } : { userId, nickname, text, handle };
}

const PHASES: readonly string[] = ['lobby', 'question', 'reveal', 'race', 'results'];
const STATS: readonly string[] = ['speed', 'stamina', 'strength'];

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
}

/** Validate untrusted channel data into a StatusEnvelope, or null. */
export function parseStatusEnvelope(data: unknown): StatusEnvelope | null {
  if (!isRecord(data) || data.kind !== 'status') return null;
  const { phase, raceNumber, round, rounds, prompt, stat } = data;
  const choices = stringArray(data.choices);
  const racerIds = stringArray(data.racerIds);
  const queuedIds = stringArray(data.queuedIds);
  if (typeof phase !== 'string' || !PHASES.includes(phase)) return null;
  if (typeof raceNumber !== 'number' || typeof round !== 'number' || typeof rounds !== 'number') return null;
  if (prompt !== null && typeof prompt !== 'string') return null;
  if (stat !== null && (typeof stat !== 'string' || !STATS.includes(stat))) return null;
  if (choices === null || racerIds === null || queuedIds === null) return null;
  return {
    kind: 'status',
    phase: phase as Phase,
    raceNumber,
    round,
    rounds,
    prompt,
    choices,
    stat: stat as StatKey | null,
    racerIds,
    queuedIds,
  };
}
