import { validateConfig } from './configRules';
import { asPlayer, closeIfAllAnswered, seatLobby, toLobby } from './flow';
import type { BlockedUser, GameConfig, GameState, Level } from './types';

/** Host/admin actions: change settings, remove riders, block list. */

export const MAX_BLOCKED = 1_000;
const MAX_BLOCKED_NAME = 64;

/**
 * Lobby: apply now (re-seat riders under the new limits). Mid-game: keep as pending until
 * the next lobby, so questions, points and the race already under way never change.
 * Invalid configs are ignored; callers validate first and show the reasons.
 */
export function configure(state: GameState, config: GameConfig, level: Level, now: number): GameState {
  if (validateConfig(config, state.bank).length > 0) return state;
  if (state.phase !== 'lobby') {
    // Same rules as the running race: nothing to wait for (e.g. a display-only save).
    const unchanged = level === state.level && JSON.stringify(config) === JSON.stringify(state.config);
    return { ...state, pending: unchanged ? null : { config, level } };
  }
  // A new lobby length restarts a running countdown, so "applied" means applied.
  const restart = config.lobbyMs !== state.config.lobbyMs;
  const next: GameState = { ...state, config, level, pending: null, phaseEndsAt: restart ? null : state.phaseEndsAt };
  return seatLobby(next, [...state.racers.map(asPlayer), ...state.queue], now);
}

/**
 * Remove users from the room.
 * Lobby: lanes are re-numbered and the queue fills the gap.
 * Quiz: their lane empties and their answer is dropped; if nobody is left, back to the lobby.
 * Race/results: the race already happened, so it stands; they only leave the queue.
 */
export function removeUsers(state: GameState, ids: ReadonlySet<string>, now: number): GameState {
  const queue = state.queue.filter((p) => !ids.has(p.id));
  const base: GameState = { ...state, queue };
  switch (state.phase) {
    case 'lobby': {
      const stay = state.racers.filter((r) => !ids.has(r.id)).map(asPlayer);
      return seatLobby(base, [...stay, ...queue], now);
    }
    case 'question':
    case 'reveal': {
      const racers = state.racers.filter((r) => !ids.has(r.id));
      if (racers.length === state.racers.length) return base;
      if (racers.length === 0) return toLobby(base, queue, now, state.raceNumber);
      const answers = Object.fromEntries(Object.entries(state.answers).filter(([id]) => !ids.has(id)));
      const next: GameState = { ...base, racers, answers };
      return state.phase === 'question' ? closeIfAllAnswered(next, now) : next;
    }
    case 'race':
    case 'results':
      return base;
  }
}

/** Trim, drop blank ids and duplicates (first wins), cap length. Shared with settings parsing. */
export function cleanBlockList(blocked: readonly BlockedUser[]): BlockedUser[] {
  const seen = new Set<string>();
  const clean: BlockedUser[] = [];
  for (const entry of blocked) {
    const id = entry.id.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const name = entry.name.trim().slice(0, MAX_BLOCKED_NAME) || id;
    clean.push({ id, name });
  }
  return clean.slice(0, MAX_BLOCKED);
}

/**
 * Replace the block list; anyone newly blocked is removed like a kick and dropped from the
 * session leaderboard (so an offensive name does not stay on screen).
 */
export function setBlocked(state: GameState, blocked: readonly BlockedUser[], now: number): GameState {
  const clean = cleanBlockList(blocked);
  const before = new Set(state.blocked.map((b) => b.id));
  const added = new Set(clean.map((b) => b.id).filter((id) => !before.has(id)));
  const session = Object.fromEntries(Object.entries(state.session).filter(([id]) => !added.has(id)));
  const next: GameState = { ...state, blocked: clean, session };
  return added.size === 0 ? next : removeUsers(next, added, now);
}
