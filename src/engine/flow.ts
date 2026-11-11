import { LANE_COLORS, ZERO_STATS } from './config';
import type { GameState, Phase, Player, Racer } from './types';

/** Shared phase helpers used by the main reducer (game.ts) and host actions (moderation.ts). */

export function enterPhase(state: GameState, phase: Phase, now: number, durationMs: number | null): GameState {
  return { ...state, phase, phaseStartedAt: now, phaseEndsAt: durationMs === null ? null : now + durationMs };
}

export function makeRacer(player: Player, lane: number): Racer {
  return {
    id: player.id,
    name: player.name,
    lane,
    color: LANE_COLORS[lane % LANE_COLORS.length]!,
    stats: ZERO_STATS,
    correct: 0,
  };
}

export function asPlayer(racer: Player): Player {
  return { id: racer.id, name: racer.name };
}

export function isBlocked(state: GameState, userId: string): boolean {
  return state.blocked.some((b) => b.id === userId);
}

/** Lobby countdown: runs only with enough riders; an already running countdown is never extended. */
export function lobbyDeadline(state: GameState, racerCount: number, now: number): number | null {
  if (racerCount === 0 || racerCount < state.config.minRacersToStart) return null;
  return state.phaseEndsAt ?? now + state.config.lobbyMs;
}

/** Lobby only: seat `waiting` in lanes 0..max-1 in order; the rest queue (capped). */
export function seatLobby(state: GameState, waiting: readonly Player[], now: number): GameState {
  const { maxRacers, maxQueue } = state.config;
  const racers = waiting.slice(0, maxRacers).map((player, lane) => makeRacer(player, lane));
  const queue = waiting.slice(maxRacers, maxRacers + maxQueue);
  const seated = { ...state, racers, queue };
  return { ...seated, phaseEndsAt: lobbyDeadline(seated, racers.length, now) };
}

/** Open a fresh lobby. Settings saved mid-game take effect here. */
export function toLobby(state: GameState, waiting: readonly Player[], now: number, raceNumber: number): GameState {
  const applied = state.pending === null
    ? state
    : { ...state, config: state.pending.config, level: state.pending.level, pending: null };
  const fresh = enterPhase({
    ...applied,
    raceNumber,
    racers: [],
    queue: [],
    round: 0,
    questions: [],
    answers: {},
    lastReveal: null,
    race: null,
    standings: null,
  }, 'lobby', now, null);
  return seatLobby(fresh, waiting.filter((p) => !isBlocked(fresh, p.id)), now);
}

/** Once every racer has answered, the question closes after a short grace period. */
export function closeIfAllAnswered(state: GameState, now: number): GameState {
  const everyoneAnswered = state.racers.length > 0 && state.racers.every((r) => Object.hasOwn(state.answers, r.id));
  if (!everyoneAnswered || state.phaseEndsAt === null) return state;
  return { ...state, phaseEndsAt: Math.min(state.phaseEndsAt, now + state.config.allAnsweredGraceMs) };
}
