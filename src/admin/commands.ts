import { MAX_BLOCKED } from '../engine/moderation';
import type { GameAction, GameState, QuestionSource } from '../engine/types';
import { validateSettings, type DisplaySettings } from '../settings/schema';
import type { AdminCommand } from './protocol';

export interface HostContext {
  readonly state: GameState;
  readonly display: DisplaySettings;
  readonly now: number;
}

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message: string;
  /** Engine actions to dispatch, in order. */
  readonly actions: readonly GameAction[];
  /** Display settings after the command (host applies them to the HUD and 3D view). */
  readonly display: DisplaySettings;
  /** True when settings or the block list changed and should be saved. */
  readonly persist: boolean;
}

function done(ctx: HostContext, message: string, actions: readonly GameAction[] = [], persist = false): CommandOutcome {
  return { ok: true, message, actions, display: ctx.display, persist };
}

function refused(ctx: HostContext, message: string): CommandOutcome {
  return { ok: false, message, actions: [], display: ctx.display, persist: false };
}

function knownName(state: GameState, userId: string): string | null {
  const live = [...state.racers, ...state.queue].find((p) => p.id === userId);
  if (live !== undefined) return live.name;
  return Object.hasOwn(state.session, userId) ? state.session[userId]?.name ?? null : null;
}

/** Decide what an admin command does. Pure: the host tab dispatches the actions and saves. */
export function runAdminCommand(ctx: HostContext, command: AdminCommand, bank: readonly QuestionSource[]): CommandOutcome {
  const { state, now } = ctx;
  switch (command.type) {
    case 'hello':
      return done(ctx, 'Connected to the game tab.');
    case 'applySettings': {
      const issues = validateSettings(command.settings, bank);
      if (issues.length > 0) return refused(ctx, `Not saved: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
      const { config, level, display, blocked } = command.settings;
      const actions: GameAction[] = [{ type: 'configure', config, level, now }, { type: 'setBlocked', blocked, now }];
      const rulesChanged = level !== state.level || JSON.stringify(config) !== JSON.stringify(state.config);
      const message = state.phase === 'lobby' || !rulesChanged
        ? 'Saved and applied.'
        : 'Saved. Display and block list apply now; game rules apply when the next lobby opens (this race is not changed).';
      return { ok: true, message, actions, display, persist: true };
    }
    case 'start':
      return state.phase === 'lobby' && state.racers.length > 0
        ? done(ctx, 'Race started.', [{ type: 'hostStart', now }])
        : refused(ctx, 'Start works in the lobby once at least one rider has joined.');
    case 'skip':
      return state.phase === 'lobby' && state.racers.length === 0
        ? refused(ctx, 'Nothing to skip: the lobby has no riders yet.')
        : done(ctx, 'Skipped to the next phase.', [{ type: 'hostSkip', now }]);
    case 'reset':
      return done(ctx, 'Race reset. Back to an empty lobby (leaderboard kept).', [{ type: 'hostReset', now }]);
    case 'kick': {
      const name = [...state.racers, ...state.queue].find((p) => p.id === command.userId)?.name;
      if (name === undefined) return refused(ctx, 'That user is not riding or queued.');
      const note = state.phase === 'race' || state.phase === 'results' ? ' (this race result stands)' : '';
      return done(ctx, `${name} removed${note}.`, [{ type: 'kick', userId: command.userId, now }]);
    }
    case 'block': {
      if (state.blocked.some((b) => b.id === command.userId)) return refused(ctx, 'Already blocked.');
      if (state.blocked.length >= MAX_BLOCKED) return refused(ctx, `Block list is full (${MAX_BLOCKED}). Unblock someone first.`);
      const name = knownName(state, command.userId) ?? command.name;
      const blocked = [...state.blocked, { id: command.userId, name }];
      return done(ctx, `${name} blocked. Their chat is now ignored.`, [{ type: 'setBlocked', blocked, now }], true);
    }
    case 'unblock': {
      const entry = state.blocked.find((b) => b.id === command.userId);
      if (entry === undefined) return refused(ctx, 'That user is not blocked.');
      const blocked = state.blocked.filter((b) => b.id !== command.userId);
      return done(ctx, `${entry.name} unblocked.`, [{ type: 'setBlocked', blocked, now }], true);
    }
    case 'clearSession':
      return done(ctx, 'Session leaderboard cleared.', [{ type: 'clearSession' }]);
  }
}
