import { describe, expect, test } from 'vitest';
import { QUESTION_BANK } from '../src/content/questions';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { createGame, reduce } from '../src/engine/game';
import type { GameConfig, GameState } from '../src/engine/types';

const LETTERS = ['a', 'b', 'c', 'd'] as const;

function newGame(config: Partial<GameConfig> = {}): GameState {
  return createGame({ bank: QUESTION_BANK, seed: 99, now: 0, config: { ...DEFAULT_CONFIG, ...config } });
}

function chat(state: GameState, userId: string, text: string, now = 100): GameState {
  return reduce(state, { type: 'chat', message: { userId, nickname: userId.toUpperCase(), text }, now });
}

function joinAll(state: GameState, ids: readonly string[], now = 100): GameState {
  return ids.reduce((s, id) => chat(s, id, 'hi', now), state);
}

function expire(state: GameState): GameState {
  expect(state.phaseEndsAt).not.toBeNull();
  return reduce(state, { type: 'tick', now: state.phaseEndsAt! });
}

function configure(state: GameState, config: Partial<GameConfig>, now = 200): GameState {
  return reduce(state, { type: 'configure', config: { ...state.config, ...config }, level: state.level, now });
}

function toRace(state: GameState): GameState {
  let s = expire(state); // lobby -> question
  while (s.phase !== 'race') s = expire(s);
  return s;
}

describe('minimum riders before the lobby countdown', () => {
  test('countdown waits until enough riders joined', () => {
    const one = chat(newGame({ minRacersToStart: 3 }), 'u1', 'hi', 10);
    expect(one.phaseEndsAt).toBeNull();
    const three = joinAll(one, ['u2', 'u3'], 50);
    expect(three.phaseEndsAt).toBe(50 + DEFAULT_CONFIG.lobbyMs);
  });

  test('host can still start early with fewer riders', () => {
    const one = chat(newGame({ minRacersToStart: 3 }), 'u1', 'hi', 10);
    const started = reduce(one, { type: 'hostStart', now: 20 });
    expect(started.phase).toBe('question');
  });

  test('next lobby filled from the queue also respects the minimum', () => {
    let s = joinAll(newGame({ minRacersToStart: 2 }), ['u1', 'u2']);
    s = toRace(s);
    s = chat(s, 'late', 'hi', s.phaseStartedAt + 10);
    s = expire(expire(s)); // race -> results -> lobby
    expect(s.phase).toBe('lobby');
    expect(s.racers.map((r) => r.id)).toEqual(['late']);
    expect(s.phaseEndsAt).toBeNull();
  });
});

describe('join keyword', () => {
  test('only messages containing the keyword join', () => {
    let s = newGame({ joinKeyword: 'join' });
    s = chat(s, 'u1', 'hello there');
    s = chat(s, 'u2', 'I want to JOIN!');
    s = chat(s, 'u3', 'joining?');
    expect(s.racers.map((r) => r.id)).toEqual(['u2']);
  });

  test('multi-word keyword must appear as whole words', () => {
    let s = newGame({ joinKeyword: 'lets go' });
    s = chat(s, 'u1', "let's go!!");
    s = chat(s, 'u2', 'lets gooo');
    expect(s.racers.map((r) => r.id)).toEqual(['u1']);
  });

  test('during the quiz, non-riders queue only with the keyword; riders still answer with letters', () => {
    let s = chat(newGame({ joinKeyword: 'join' }), 'u1', 'join');
    s = expire(s);
    expect(s.phase).toBe('question');
    s = chat(s, 'v1', 'a');
    s = chat(s, 'v2', 'join me');
    expect(s.queue.map((p) => p.id)).toEqual(['v2']);
    s = chat(s, 'u1', LETTERS[s.questions[0]!.answer]!);
    expect(Object.keys(s.answers)).toEqual(['u1']);
  });
});

describe('blocked users', () => {
  test('blocked users cannot join or queue', () => {
    let s = createGame({
      bank: QUESTION_BANK, seed: 1, now: 0, blocked: [{ id: 'troll', name: 'Troll' }],
    });
    s = chat(s, 'troll', 'hi');
    expect(s.racers).toEqual([]);
    expect(s.blocked).toEqual([{ id: 'troll', name: 'Troll' }]);
  });

  test('blocking removes the user from the lobby, refills from the queue and re-numbers lanes', () => {
    let s = joinAll(newGame({ maxRacers: 2 }), ['u1', 'u2', 'u3']);
    expect(s.queue.map((p) => p.id)).toEqual(['u3']);
    s = reduce(s, { type: 'setBlocked', blocked: [{ id: 'u1', name: 'U1' }], now: 300 });
    expect(s.racers.map((r) => [r.id, r.lane])).toEqual([['u2', 0], ['u3', 1]]);
    expect(s.queue).toEqual([]);
  });

  test('blocking also removes the user from the session leaderboard', () => {
    let s = toRace(joinAll(newGame(), ['u1', 'u2']));
    s = expire(s);
    expect(Object.keys(s.session).sort()).toEqual(['u1', 'u2']);
    s = reduce(s, { type: 'setBlocked', blocked: [{ id: 'u1', name: 'U1' }], now: s.phaseStartedAt + 1 });
    expect(Object.keys(s.session)).toEqual(['u2']);
  });

  test('unblocking lets the user chat again', () => {
    let s = reduce(newGame(), { type: 'setBlocked', blocked: [{ id: 'u1', name: 'U1' }], now: 1 });
    s = reduce(s, { type: 'setBlocked', blocked: [], now: 2 });
    s = chat(s, 'u1', 'hi');
    expect(s.racers.map((r) => r.id)).toEqual(['u1']);
  });

  test('duplicate and blank ids in the block list are dropped', () => {
    const s = reduce(newGame(), {
      type: 'setBlocked',
      blocked: [{ id: 'x', name: 'X' }, { id: 'x', name: 'X2' }, { id: '  ', name: 'blank' }],
      now: 1,
    });
    expect(s.blocked).toEqual([{ id: 'x', name: 'X' }]);
  });
});

describe('kick', () => {
  test('kicking from the lobby stops the countdown when below the minimum', () => {
    let s = joinAll(newGame({ minRacersToStart: 2 }), ['u1', 'u2']);
    expect(s.phaseEndsAt).not.toBeNull();
    s = reduce(s, { type: 'kick', userId: 'u1', now: 500 });
    expect(s.racers.map((r) => r.id)).toEqual(['u2']);
    expect(s.phaseEndsAt).toBeNull();
  });

  test('kicking a rider mid-quiz removes them and their answer, other lanes stay put', () => {
    let s = joinAll(newGame(), ['u1', 'u2', 'u3']);
    s = expire(s);
    s = chat(s, 'u2', 'a', s.phaseStartedAt + 1);
    s = reduce(s, { type: 'kick', userId: 'u2', now: s.phaseStartedAt + 2 });
    expect(s.racers.map((r) => [r.id, r.lane])).toEqual([['u1', 0], ['u3', 2]]);
    expect(Object.keys(s.answers)).toEqual([]);
  });

  test('kicking the last unanswered rider closes the question after the grace period', () => {
    let s = joinAll(newGame(), ['u1', 'u2']);
    s = expire(s);
    const t = s.phaseStartedAt + 1000;
    s = chat(s, 'u1', 'b', t);
    s = reduce(s, { type: 'kick', userId: 'u2', now: t + 10 });
    expect(s.phaseEndsAt).toBe(t + 10 + DEFAULT_CONFIG.allAnsweredGraceMs);
  });

  test('kicking every rider mid-quiz returns to the lobby with the same race number', () => {
    let s = joinAll(newGame(), ['u1']);
    s = expire(s);
    s = chat(s, 'q1', 'hi', s.phaseStartedAt + 1);
    s = reduce(s, { type: 'kick', userId: 'u1', now: s.phaseStartedAt + 5 });
    expect(s.phase).toBe('lobby');
    expect(s.raceNumber).toBe(1);
    expect(s.racers.map((r) => r.id)).toEqual(['q1']);
  });

  test('during the race the result stands, but the user leaves the queue', () => {
    let s = toRace(joinAll(newGame(), ['u1', 'u2']));
    s = chat(s, 'u1', 'gg', s.phaseStartedAt + 1);
    expect(s.queue.map((p) => p.id)).toEqual(['u1']);
    s = reduce(s, { type: 'kick', userId: 'u1', now: s.phaseStartedAt + 2 });
    expect(s.racers.map((r) => r.id)).toEqual(['u1', 'u2']);
    expect(s.queue).toEqual([]);
  });
});

describe('configure', () => {
  test('in the lobby, settings apply at once; shrinking max riders moves the overflow to the queue front', () => {
    let s = joinAll(newGame(), ['u1', 'u2', 'u3', 'u4']);
    s = configure(s, { maxRacers: 2 });
    expect(s.config.maxRacers).toBe(2);
    expect(s.pending).toBeNull();
    expect(s.racers.map((r) => r.id)).toEqual(['u1', 'u2']);
    expect(s.queue.map((p) => p.id)).toEqual(['u3', 'u4']);
  });

  test('in the lobby, raising max riders promotes queued players', () => {
    let s = joinAll(newGame({ maxRacers: 1 }), ['u1', 'u2', 'u3']);
    s = configure(s, { maxRacers: 3 });
    expect(s.racers.map((r) => [r.id, r.lane])).toEqual([['u1', 0], ['u2', 1], ['u3', 2]]);
  });

  test('in the lobby, a level change applies at once', () => {
    const s = reduce(newGame(), { type: 'configure', config: DEFAULT_CONFIG, level: 'A2', now: 1 });
    expect(s.level).toBe('A2');
  });

  test('mid-game, settings wait for the next lobby and do not change the running race', () => {
    let s = expire(joinAll(newGame(), ['u1']));
    s = reduce(s, { type: 'configure', config: { ...DEFAULT_CONFIG, questionMs: 9_000 }, level: 'B2', now: s.phaseStartedAt + 1 });
    expect(s.config.questionMs).toBe(DEFAULT_CONFIG.questionMs);
    expect(s.level).toBe('B1');
    expect(s.pending).toEqual({ config: { ...DEFAULT_CONFIG, questionMs: 9_000 }, level: 'B2' });
    s = reduce(s, { type: 'hostReset', now: s.phaseStartedAt + 2 });
    expect(s.config.questionMs).toBe(9_000);
    expect(s.level).toBe('B2');
    expect(s.pending).toBeNull();
  });

  test('pending settings apply when results return to the lobby', () => {
    let s = toRace(joinAll(newGame(), ['u1']));
    s = configure(s, { roundsPerRace: 3 }, s.phaseStartedAt + 1);
    s = expire(expire(s));
    expect(s.phase).toBe('lobby');
    expect(s.config.roundsPerRace).toBe(3);
  });

  test('mid-game, re-sending the rules already in use clears pending instead of setting it', () => {
    let s = expire(joinAll(newGame(), ['u1']));
    s = configure(s, { questionMs: 9_000 }, s.phaseStartedAt + 1);
    expect(s.pending).not.toBeNull();
    s = reduce(s, { type: 'configure', config: DEFAULT_CONFIG, level: 'B1', now: s.phaseStartedAt + 2 });
    expect(s.pending).toBeNull();
  });

  test('invalid settings are ignored by the engine', () => {
    const s = newGame();
    const next = configure(s, { maxRacers: 0 });
    expect(next).toBe(s);
  });

  test('in the lobby, a new lobby length restarts the running countdown with that length', () => {
    let s = joinAll(newGame(), ['u1'], 100);
    expect(s.phaseEndsAt).toBe(100 + DEFAULT_CONFIG.lobbyMs);
    s = configure(s, { lobbyMs: 120_000 }, 5_000);
    expect(s.phaseEndsAt).toBe(5_000 + 120_000);
    s = configure(s, { maxQueue: 10 }, 9_000); // other changes keep the countdown
    expect(s.phaseEndsAt).toBe(5_000 + 120_000);
  });

  test('raising the minimum in the lobby stops a running countdown', () => {
    let s = joinAll(newGame(), ['u1']);
    s = configure(s, { minRacersToStart: 2 });
    expect(s.phaseEndsAt).toBeNull();
  });
});

describe('question selection and rounds', () => {
  test('disabled questions are never picked', () => {
    const b1 = QUESTION_BANK.filter((q) => q.level === 'B1');
    const disabled = b1.slice(0, b1.length - 6).map((q) => q.id);
    const s = expire(joinAll(newGame({ disabledQuestionIds: disabled }), ['u1']));
    const allowed = new Set(b1.slice(-6).map((q) => q.id));
    expect(s.questions.every((q) => allowed.has(q.id))).toBe(true);
  });

  test('createGame rejects settings that leave a level without enough questions', () => {
    const disabled = QUESTION_BANK.filter((q) => q.level === 'A2').slice(0, 16).map((q) => q.id);
    expect(() => newGame({ disabledQuestionIds: disabled })).toThrow(/A2/);
  });

  test('9 rounds rotate the stats evenly (3 each)', () => {
    const s = expire(joinAll(newGame({ roundsPerRace: 9 }), ['u1']));
    const counts = s.questions.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.stat]: (acc[q.stat] ?? 0) + 1 }), {});
    expect(counts).toEqual({ speed: 3, stamina: 3, strength: 3 });
  });
});

describe('session', () => {
  test('clearSession empties the leaderboard', () => {
    let s = toRace(joinAll(newGame(), ['u1']));
    s = expire(s);
    expect(Object.keys(s.session)).toEqual(['u1']);
    s = reduce(s, { type: 'clearSession' });
    expect(s.session).toEqual({});
  });
});
