import type { GameState, Phase, QuestionSource, Stats } from '../engine/types';
import { parseSettings, settingsFromState, type DisplaySettings, type Settings } from '../settings/schema';

/**
 * Admin page <-> game tab messages over BroadcastChannel (same browser, same origin only).
 * Separate channel from chat so the chat simulator never sees admin traffic.
 */
export const ADMIN_CHANNEL = 'english-derby-admin';
export const SESSION_ROWS = 20;
const MAX_ID = 64;

export type AdminCommand =
  | { readonly type: 'hello' }
  | { readonly type: 'applySettings'; readonly settings: Settings }
  | { readonly type: 'start' }
  | { readonly type: 'skip' }
  | { readonly type: 'reset' }
  | { readonly type: 'kick'; readonly userId: string }
  | { readonly type: 'block'; readonly userId: string; readonly name: string }
  | { readonly type: 'unblock'; readonly userId: string }
  | { readonly type: 'clearSession' };

export interface AdminRequest {
  readonly kind: 'adminRequest';
  readonly requestId: string;
  readonly command: AdminCommand;
}

export interface AdminResult {
  readonly kind: 'adminResult';
  readonly requestId: string;
  readonly ok: boolean;
  readonly message: string;
}

export interface LivePlayer {
  readonly id: string;
  readonly name: string;
}

export interface LiveRacer extends LivePlayer {
  readonly lane: number;
  readonly color: string;
  readonly correct: number;
  readonly stats: Stats;
  readonly answered: boolean;
}

export interface LiveSessionRow extends LivePlayer {
  readonly races: number;
  readonly wins: number;
  readonly podiums: number;
  readonly correct: number;
}

export interface LiveStatus {
  readonly phase: Phase;
  readonly raceNumber: number;
  readonly round: number;
  readonly rounds: number;
  /** Time left in this phase when the snapshot was built; null = waiting. */
  readonly msLeft: number | null;
  readonly racers: readonly LiveRacer[];
  readonly queue: readonly LivePlayer[];
  readonly session: readonly LiveSessionRow[];
}

export interface AdminSnapshot {
  readonly kind: 'adminSnapshot';
  /** Random per game tab, so the admin page can warn when two game tabs are open. */
  readonly hostId: string;
  /** Settings that will run next (pending ones if saved mid-game). */
  readonly settings: Settings;
  /** True when saved game settings are waiting for the next lobby. */
  readonly pendingUntilLobby: boolean;
  readonly live: LiveStatus;
}

/** Sent by a game tab as it closes or reloads, so the admin page forgets it at once. */
export interface HostBye {
  readonly kind: 'adminBye';
  readonly hostId: string;
}

export function parseHostBye(data: unknown): HostBye | null {
  if (!isRecord(data) || data.kind !== 'adminBye') return null;
  const hostId = id(data.hostId);
  return hostId === null ? null : { kind: 'adminBye', hostId };
}

// ---------------------------------------------------------------- build

export function buildSnapshot(state: GameState, display: DisplaySettings, hostId: string, now: number): AdminSnapshot {
  const session = Object.entries(state.session)
    .map(([id, r]) => ({ id, name: r.name, races: r.races, wins: r.wins, podiums: r.podiums, correct: r.correct }))
    .sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.correct - a.correct)
    .slice(0, SESSION_ROWS);
  return {
    kind: 'adminSnapshot',
    hostId,
    settings: settingsFromState(state, display),
    pendingUntilLobby: state.pending !== null,
    live: {
      phase: state.phase,
      raceNumber: state.raceNumber,
      round: state.round,
      rounds: state.questions.length,
      msLeft: state.phaseEndsAt === null ? null : Math.max(0, state.phaseEndsAt - now),
      racers: state.racers.map((r) => ({
        id: r.id, name: r.name, lane: r.lane, color: r.color, correct: r.correct, stats: r.stats,
        answered: state.phase === 'question' && Object.hasOwn(state.answers, r.id),
      })),
      queue: state.queue.map((p) => ({ id: p.id, name: p.name })),
      session,
    },
  };
}

// ---------------------------------------------------------------- parse (untrusted channel data)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > MAX_ID ? null : trimmed;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseCommand(data: unknown, bank: readonly QuestionSource[]): AdminCommand | null {
  if (!isRecord(data)) return null;
  switch (data.type) {
    case 'hello':
    case 'start':
    case 'skip':
    case 'reset':
    case 'clearSession':
      return { type: data.type };
    case 'kick':
    case 'unblock': {
      const userId = id(data.userId);
      return userId === null ? null : { type: data.type, userId };
    }
    case 'block': {
      const userId = id(data.userId);
      if (userId === null) return null;
      return { type: 'block', userId, name: id(data.name) ?? userId };
    }
    case 'applySettings': {
      const parsed = parseSettings(data.settings, bank);
      return parsed.ok ? { type: 'applySettings', settings: parsed.settings } : null;
    }
    default:
      return null;
  }
}

export function parseAdminRequest(data: unknown, bank: readonly QuestionSource[]): AdminRequest | null {
  if (!isRecord(data) || data.kind !== 'adminRequest') return null;
  const requestId = id(data.requestId);
  const command = parseCommand(data.command, bank);
  return requestId === null || command === null ? null : { kind: 'adminRequest', requestId, command };
}

export function parseAdminResult(data: unknown): AdminResult | null {
  if (!isRecord(data) || data.kind !== 'adminResult') return null;
  const requestId = id(data.requestId);
  if (requestId === null || typeof data.ok !== 'boolean' || typeof data.message !== 'string') return null;
  return { kind: 'adminResult', requestId, ok: data.ok, message: data.message };
}

const PHASES: readonly Phase[] = ['lobby', 'question', 'reveal', 'race', 'results'];

function player(v: unknown): LivePlayer | null {
  if (!isRecord(v)) return null;
  const pid = id(v.id);
  return pid === null || typeof v.name !== 'string' ? null : { id: pid, name: v.name };
}

function stats(v: unknown): Stats | null {
  return isRecord(v) && isNum(v.speed) && isNum(v.stamina) && isNum(v.strength)
    ? { speed: v.speed, stamina: v.stamina, strength: v.strength }
    : null;
}

function racer(v: unknown): LiveRacer | null {
  const p = player(v);
  if (p === null || !isRecord(v)) return null;
  const s = stats(v.stats);
  if (s === null || !isNum(v.lane) || !isNum(v.correct) || typeof v.color !== 'string' || typeof v.answered !== 'boolean') return null;
  return { ...p, lane: v.lane, color: v.color, correct: v.correct, stats: s, answered: v.answered };
}

function sessionRow(v: unknown): LiveSessionRow | null {
  const p = player(v);
  if (p === null || !isRecord(v)) return null;
  if (!isNum(v.races) || !isNum(v.wins) || !isNum(v.podiums) || !isNum(v.correct)) return null;
  return { ...p, races: v.races, wins: v.wins, podiums: v.podiums, correct: v.correct };
}

function list<T>(v: unknown, item: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(item);
  return out.every((x): x is T => x !== null) ? out : null;
}

function live(v: unknown): LiveStatus | null {
  if (!isRecord(v)) return null;
  const phase = PHASES.find((p) => p === v.phase);
  const racers = list(v.racers, racer);
  const queue = list(v.queue, player);
  const session = list(v.session, sessionRow);
  if (phase === undefined || racers === null || queue === null || session === null) return null;
  if (!isNum(v.raceNumber) || !isNum(v.round) || !isNum(v.rounds)) return null;
  if (v.msLeft !== null && !isNum(v.msLeft)) return null;
  return { phase, raceNumber: v.raceNumber, round: v.round, rounds: v.rounds, msLeft: v.msLeft, racers, queue, session };
}

export function parseAdminSnapshot(data: unknown, bank: readonly QuestionSource[]): AdminSnapshot | null {
  if (!isRecord(data) || data.kind !== 'adminSnapshot') return null;
  const hostId = id(data.hostId);
  const settings = parseSettings(data.settings, bank);
  const status = live(data.live);
  if (hostId === null || !settings.ok || status === null || typeof data.pendingUntilLobby !== 'boolean') return null;
  return { kind: 'adminSnapshot', hostId, settings: settings.settings, pendingUntilLobby: data.pendingUntilLobby, live: status };
}
