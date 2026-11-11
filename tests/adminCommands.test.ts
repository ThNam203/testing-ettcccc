import { describe, expect, test } from 'vitest';
import { runAdminCommand, type CommandOutcome } from '../src/admin/commands';
import type { AdminCommand } from '../src/admin/protocol';
import { QUESTION_BANK } from '../src/content/questions';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { createGame, reduce } from '../src/engine/game';
import { MAX_BLOCKED } from '../src/engine/moderation';
import type { GameState } from '../src/engine/types';
import { DEFAULT_DISPLAY, defaultSettings } from '../src/settings/schema';

const BANK = QUESTION_BANK;

function game(ids: readonly string[] = []): GameState {
  return ids.reduce(
    (s, id) => reduce(s, { type: 'chat', message: { userId: id, nickname: id.toUpperCase(), text: 'hi' }, now: 10 }),
    createGame({ bank: BANK, seed: 3, now: 0 }),
  );
}

function run(state: GameState, command: AdminCommand): CommandOutcome {
  return runAdminCommand({ state, display: DEFAULT_DISPLAY, now: 100 }, command, BANK);
}

function applyOutcome(state: GameState, outcome: CommandOutcome): GameState {
  return outcome.actions.reduce(reduce, state);
}

describe('runAdminCommand', () => {
  test('hello is a no-op success', () => {
    expect(run(game(), { type: 'hello' })).toMatchObject({ ok: true, actions: [], persist: false });
  });

  test('applySettings in the lobby applies at once and persists', () => {
    const settings = { ...defaultSettings(), config: { ...DEFAULT_CONFIG, maxRacers: 4 }, display: { ...DEFAULT_DISPLAY, chatRows: 3 } };
    const out = run(game(), { type: 'applySettings', settings });
    expect(out).toMatchObject({ ok: true, persist: true, display: { chatRows: 3 } });
    expect(out.message).toMatch(/applied/i);
    expect(applyOutcome(game(), out).config.maxRacers).toBe(4);
  });

  test('applySettings mid-game says it waits for the next lobby', () => {
    const playing = reduce(game(['u1']), { type: 'hostStart', now: 50 });
    const out = run(playing, { type: 'applySettings', settings: { ...defaultSettings(), level: 'A2' } });
    expect(out.ok).toBe(true);
    expect(out.message).toMatch(/next lobby/i);
    expect(applyOutcome(playing, out).pending?.level).toBe('A2');
  });

  test('mid-game display-only change says applied, not waiting', () => {
    const playing = reduce(game(['u1']), { type: 'hostStart', now: 50 });
    const out = run(playing, { type: 'applySettings', settings: { ...defaultSettings(), display: { ...DEFAULT_DISPLAY, chatRows: 2 } } });
    expect(out.message).toBe('Saved and applied.');
    expect(applyOutcome(playing, out).pending).toBeNull();
  });

  test('applySettings with rule violations is refused with the reasons', () => {
    const bad = { ...defaultSettings(), config: { ...DEFAULT_CONFIG, maxRacers: 50 } };
    const out = run(game(), { type: 'applySettings', settings: bad });
    expect(out).toMatchObject({ ok: false, actions: [], persist: false });
    expect(out.message).toContain('config.maxRacers');
  });

  test('start needs a lobby with riders; skip needs riders in the lobby', () => {
    expect(run(game(), { type: 'start' }).ok).toBe(false);
    expect(run(game(['u1']), { type: 'start' })).toMatchObject({ ok: true, actions: [{ type: 'hostStart', now: 100 }] });
    expect(run(game(), { type: 'skip' }).ok).toBe(false);
    expect(run(game(['u1']), { type: 'skip' }).actions).toEqual([{ type: 'hostSkip', now: 100 }]);
    expect(run(game(), { type: 'reset' }).actions).toEqual([{ type: 'hostReset', now: 100 }]);
  });

  test('kick removes a rider or queued player; unknown users fail', () => {
    expect(run(game(['u1']), { type: 'kick', userId: 'u1' })).toMatchObject({ ok: true, actions: [{ type: 'kick', userId: 'u1' }] });
    expect(run(game(['u1']), { type: 'kick', userId: 'ghost' }).ok).toBe(false);
  });

  test('block looks up the display name, persists, and refuses duplicates', () => {
    const out = run(game(['u1']), { type: 'block', userId: 'u1', name: 'u1' });
    expect(out).toMatchObject({ ok: true, persist: true });
    const blocked = applyOutcome(game(['u1']), out);
    expect(blocked.blocked).toEqual([{ id: 'u1', name: 'U1' }]);
    expect(blocked.racers).toEqual([]);
    expect(run(blocked, { type: 'block', userId: 'u1', name: 'U1' }).ok).toBe(false);
  });

  test('block is refused when the block list is full', () => {
    const full = Array.from({ length: MAX_BLOCKED }, (_, i) => ({ id: `b${i}`, name: `B${i}` }));
    const state = reduce(game(), { type: 'setBlocked', blocked: full, now: 1 });
    const out = run(state, { type: 'block', userId: 'one-more', name: 'x' });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/full/);
  });

  test('unblock removes the entry; unknown ids fail', () => {
    const blocked = applyOutcome(game(), run(game(), { type: 'block', userId: 'x', name: 'Mr X' }));
    expect(blocked.blocked).toEqual([{ id: 'x', name: 'Mr X' }]);
    const out = run(blocked, { type: 'unblock', userId: 'x' });
    expect(applyOutcome(blocked, out).blocked).toEqual([]);
    expect(run(game(), { type: 'unblock', userId: 'x' }).ok).toBe(false);
  });

  test('clearSession dispatches clearSession', () => {
    expect(run(game(), { type: 'clearSession' }).actions).toEqual([{ type: 'clearSession' }]);
  });
});
