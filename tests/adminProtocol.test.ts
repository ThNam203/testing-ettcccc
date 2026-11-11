import { describe, expect, test } from 'vitest';
import {
  SESSION_ROWS, buildSnapshot, parseAdminRequest, parseAdminResult, parseAdminSnapshot, parseHostBye,
} from '../src/admin/protocol';
import { QUESTION_BANK } from '../src/content/questions';
import { createGame, reduce } from '../src/engine/game';
import type { GameState } from '../src/engine/types';
import { DEFAULT_DISPLAY, defaultSettings } from '../src/settings/schema';

const BANK = QUESTION_BANK;

function lobbyWith(ids: readonly string[]): GameState {
  return ids.reduce(
    (s, id) => reduce(s, { type: 'chat', message: { userId: id, nickname: id.toUpperCase(), text: 'hi' }, now: 10 }),
    createGame({ bank: BANK, seed: 3, now: 0 }),
  );
}

describe('parseAdminRequest', () => {
  test('accepts every command shape', () => {
    const commands = [
      { type: 'hello' }, { type: 'start' }, { type: 'skip' }, { type: 'reset' }, { type: 'clearSession' },
      { type: 'kick', userId: 'u1' }, { type: 'block', userId: 'u1', name: 'U1' }, { type: 'unblock', userId: 'u1' },
      { type: 'applySettings', settings: defaultSettings() },
    ];
    for (const command of commands) {
      const parsed = parseAdminRequest({ kind: 'adminRequest', requestId: 'r1', command }, BANK);
      expect(parsed, command.type).toEqual({ kind: 'adminRequest', requestId: 'r1', command });
    }
  });

  test('rejects junk, unknown commands, missing ids and invalid settings', () => {
    const bad: unknown[] = [
      null, 'x', { kind: 'chat' },
      { kind: 'adminRequest', requestId: '', command: { type: 'hello' } },
      { kind: 'adminRequest', requestId: 'r', command: { type: 'explode' } },
      { kind: 'adminRequest', requestId: 'r', command: { type: 'kick' } },
      { kind: 'adminRequest', requestId: 'r', command: { type: 'kick', userId: 'x'.repeat(65) } },
      { kind: 'adminRequest', requestId: 'r', command: { type: 'applySettings', settings: { version: 9 } } },
    ];
    for (const data of bad) expect(parseAdminRequest(data, BANK)).toBeNull();
  });

  test('block without a name falls back to the id', () => {
    const parsed = parseAdminRequest({ kind: 'adminRequest', requestId: 'r', command: { type: 'block', userId: 'u9' } }, BANK);
    expect(parsed?.command).toEqual({ type: 'block', userId: 'u9', name: 'u9' });
  });
});

describe('parseAdminResult', () => {
  test('validates shape', () => {
    expect(parseAdminResult({ kind: 'adminResult', requestId: 'r', ok: true, message: 'done' }))
      .toEqual({ kind: 'adminResult', requestId: 'r', ok: true, message: 'done' });
    expect(parseAdminResult({ kind: 'adminResult', requestId: 'r', ok: 'yes', message: 'x' })).toBeNull();
  });
});

describe('parseHostBye', () => {
  test('validates shape', () => {
    expect(parseHostBye({ kind: 'adminBye', hostId: 'h1' })).toEqual({ kind: 'adminBye', hostId: 'h1' });
    expect(parseHostBye({ kind: 'adminBye', hostId: '' })).toBeNull();
    expect(parseHostBye({ kind: 'other', hostId: 'h1' })).toBeNull();
  });
});

describe('snapshots', () => {
  test('build -> JSON -> parse round-trips', () => {
    const state = lobbyWith(['u1', 'u2']);
    const snap = buildSnapshot(state, DEFAULT_DISPLAY, 'host-1', 1_010);
    expect(snap.live.racers.map((r) => r.id)).toEqual(['u1', 'u2']);
    expect(snap.live.msLeft).toBe(state.phaseEndsAt! - 1_010);
    expect(snap.pendingUntilLobby).toBe(false);
    expect(parseAdminSnapshot(JSON.parse(JSON.stringify(snap)), BANK)).toEqual(snap);
  });

  test('null timer in an empty lobby', () => {
    const snap = buildSnapshot(createGame({ bank: BANK, seed: 1, now: 0 }), DEFAULT_DISPLAY, 'h', 5);
    expect(snap.live.msLeft).toBeNull();
  });

  test('session rows are sorted (wins, podiums, correct) and capped', () => {
    const base = createGame({ bank: BANK, seed: 1, now: 0 });
    const session = Object.fromEntries(Array.from({ length: SESSION_ROWS + 5 }, (_, i) => [
      `p${i}`, { name: `P${i}`, races: 3, wins: i % 3, podiums: i % 5, correct: i },
    ]));
    const snap = buildSnapshot({ ...base, session }, DEFAULT_DISPLAY, 'h', 0);
    expect(snap.live.session).toHaveLength(SESSION_ROWS);
    const keys = snap.live.session.map((r) => [r.wins, r.podiums, r.correct]);
    const sorted = [...keys].sort((a, b) => b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]!);
    expect(keys).toEqual(sorted);
  });

  test('rejects malformed snapshots', () => {
    const snap = buildSnapshot(lobbyWith(['u1']), DEFAULT_DISPLAY, 'h', 0);
    const broken: unknown[] = [
      { ...snap, live: { ...snap.live, phase: 'party' } },
      { ...snap, live: { ...snap.live, racers: [{ id: 'x' }] } },
      { ...snap, settings: { version: 7 } },
      { ...snap, hostId: 3 },
    ];
    for (const data of broken) expect(parseAdminSnapshot(data, BANK)).toBeNull();
  });
});
