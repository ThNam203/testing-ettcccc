import { describe, expect, test } from 'vitest';
import { QUESTION_BANK } from '../src/content/questions';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { createGame, isLockedAnswer, reduce } from '../src/engine/game';
import type { GameAction, GameState } from '../src/engine/types';

const CFG = DEFAULT_CONFIG;
const LETTERS = ['a', 'b', 'c', 'd'] as const;

function newGame(): GameState {
  return createGame({ bank: QUESTION_BANK, seed: 1234, now: 0 });
}

function chat(state: GameState, userId: string, text: string, now: number): GameState {
  return reduce(state, { type: 'chat', message: { userId, nickname: userId.toUpperCase(), text }, now });
}

function apply(state: GameState, actions: readonly GameAction[]): GameState {
  return actions.reduce(reduce, state);
}

function joinAll(state: GameState, ids: readonly string[], now = 100): GameState {
  return ids.reduce((s, id) => chat(s, id, 'hi', now), state);
}

function correctLetter(state: GameState): string {
  return LETTERS[state.questions[state.round]!.answer]!;
}

function wrongLetter(state: GameState): string {
  return LETTERS[(state.questions[state.round]!.answer + 1) % 4]!;
}

/** Jump to the end of the current phase. */
function expire(state: GameState): GameState {
  expect(state.phaseEndsAt).not.toBeNull();
  return reduce(state, { type: 'tick', now: state.phaseEndsAt! });
}

describe('lobby', () => {
  test('starts in an empty lobby with no countdown', () => {
    const game = newGame();
    expect(game.phase).toBe('lobby');
    expect(game.racers).toEqual([]);
    expect(game.phaseEndsAt).toBeNull();
  });

  test('any chat message joins the race and the first join starts the countdown', () => {
    const game = chat(newGame(), 'u1', 'hello!', 500);
    expect(game.racers).toHaveLength(1);
    expect(game.racers[0]).toMatchObject({ id: 'u1', name: 'U1', lane: 0, correct: 0 });
    expect(game.racers[0]!.stats).toEqual({ speed: 0, stamina: 0, strength: 0 });
    expect(game.phaseEndsAt).toBe(500 + CFG.lobbyMs);
  });

  test('the same viewer chatting twice joins only once', () => {
    const game = apply(newGame(), [
      { type: 'chat', message: { userId: 'u1', nickname: 'U1', text: 'hi' }, now: 1 },
      { type: 'chat', message: { userId: 'u1', nickname: 'U1', text: 'hi again' }, now: 2 },
    ]);
    expect(game.racers).toHaveLength(1);
    expect(game.phaseEndsAt).toBe(1 + CFG.lobbyMs);
  });

  test('lanes and colours are unique; overflow goes to the queue in order', () => {
    const ids = Array.from({ length: CFG.maxRacers + 3 }, (_, i) => `u${i}`);
    const game = joinAll(newGame(), ids);
    expect(game.racers).toHaveLength(CFG.maxRacers);
    expect(new Set(game.racers.map((r) => r.lane)).size).toBe(CFG.maxRacers);
    expect(new Set(game.racers.map((r) => r.color)).size).toBe(CFG.maxRacers);
    expect(game.queue.map((p) => p.id)).toEqual(['u12', 'u13', 'u14']);
  });

  test('ignores messages with blank user id or nickname', () => {
    const game = reduce(newGame(), { type: 'chat', message: { userId: '  ', nickname: 'x', text: 'hi' }, now: 1 });
    expect(game.racers).toEqual([]);
  });

  test('tick before the countdown ends does nothing; expiry starts question 1', () => {
    const joined = chat(newGame(), 'u1', 'hi', 0);
    expect(reduce(joined, { type: 'tick', now: CFG.lobbyMs - 1 })).toBe(joined);
    const q = expire(joined);
    expect(q.phase).toBe('question');
    expect(q.round).toBe(0);
    expect(q.questions).toHaveLength(CFG.roundsPerRace);
    expect(q.phaseEndsAt).toBe(CFG.lobbyMs + CFG.questionMs);
  });

  test('host can start early only when someone has joined', () => {
    const empty = reduce(newGame(), { type: 'hostStart', now: 10 });
    expect(empty.phase).toBe('lobby');
    const started = reduce(chat(newGame(), 'u1', 'hi', 0), { type: 'hostStart', now: 10 });
    expect(started.phase).toBe('question');
  });

  test('level can be changed in the lobby and is used for the questions', () => {
    const game = expire(chat(reduce(newGame(), { type: 'setLevel', level: 'B2' }), 'u1', 'hi', 0));
    expect(game.questions.every((q) => q.level === 'B2')).toBe(true);
  });

  test('level cannot change mid-race', () => {
    const inQuestion = expire(chat(newGame(), 'u1', 'hi', 0));
    expect(reduce(inQuestion, { type: 'setLevel', level: 'B2' }).level).toBe(inQuestion.level);
  });
});

describe('questions and fairness', () => {
  function inQuestion(ids: readonly string[] = ['u1', 'u2', 'u3']): GameState {
    return expire(joinAll(newGame(), ids, 0));
  }

  test('a racer\'s first valid answer locks; later answers are ignored', () => {
    let game = inQuestion();
    const wrong = wrongLetter(game);
    const right = correctLetter(game);
    game = chat(game, 'u1', wrong, 1);
    game = chat(game, 'u1', right, 2);
    expect(game.answers.u1).toBe(LETTERS.indexOf(wrong as (typeof LETTERS)[number]));
  });

  test('chatter that is not an answer does not lock the racer', () => {
    let game = inQuestion();
    game = chat(game, 'u1', 'hmm let me think', 1);
    expect(game.answers.u1).toBeUndefined();
    game = chat(game, 'u1', correctLetter(game), 2);
    expect(game.answers.u1).toBe(game.questions[0]!.answer);
  });

  test('every correct racer gets exactly the same points, regardless of answer time', () => {
    let game = inQuestion(['u1', 'u2', 'u3']);
    const start = game.phaseStartedAt;
    game = chat(game, 'u1', correctLetter(game), start + 200);
    game = chat(game, 'u2', wrongLetter(game), start + 300);
    game = chat(game, 'u3', correctLetter(game), start + 14_000);
    const reveal = expire(game);
    expect(reveal.phase).toBe('reveal');
    const stat = reveal.lastReveal!.stat;
    const byId = Object.fromEntries(reveal.racers.map((r) => [r.id, r]));
    expect(byId.u1!.stats[stat]).toBe(CFG.pointsPerCorrect);
    expect(byId.u3!.stats[stat]).toBe(CFG.pointsPerCorrect);
    expect(byId.u2!.stats[stat]).toBe(0);
    expect(byId.u1!.correct).toBe(1);
    expect(byId.u2!.correct).toBe(0);
    expect(reveal.lastReveal).toMatchObject({
      round: 0, points: CFG.pointsPerCorrect, answeredCount: 3,
      correctIndex: reveal.questions[0]!.answer,
    });
    expect([...reveal.lastReveal!.correctIds].sort()).toEqual(['u1', 'u3']);
  });

  test('when every racer has answered, the question closes after a short grace period', () => {
    let game = inQuestion(['u1', 'u2']);
    const t = game.phaseStartedAt + 1_000;
    game = chat(game, 'u1', 'a', t);
    expect(game.phaseEndsAt).toBe(game.phaseStartedAt + CFG.questionMs);
    game = chat(game, 'u2', 'b', t + 10);
    expect(game.phaseEndsAt).toBe(t + 10 + CFG.allAnsweredGraceMs);
  });

  test('viewers who chat after the lobby closed are queued, cannot answer, and are not duplicated', () => {
    let game = inQuestion(['u1']);
    game = chat(game, 'late', correctLetter(game), 1);
    game = chat(game, 'late', 'again', 2);
    expect(game.racers.map((r) => r.id)).toEqual(['u1']);
    expect(game.answers.late).toBeUndefined();
    expect(game.queue.map((p) => p.id)).toEqual(['late']);
  });

  test('queue is capped', () => {
    let game = inQuestion(['u1']);
    for (let i = 0; i < CFG.maxQueue + 5; i += 1) game = chat(game, `q${i}`, 'hi', 1);
    expect(game.queue).toHaveLength(CFG.maxQueue);
  });

  test('stats rotate so a perfect player ends with equal stats in every category', () => {
    let game = inQuestion(['ace', 'zero']);
    for (let r = 0; r < CFG.roundsPerRace; r += 1) {
      expect(game.phase).toBe('question');
      game = chat(game, 'ace', correctLetter(game), game.phaseStartedAt + 1);
      game = chat(game, 'zero', wrongLetter(game), game.phaseStartedAt + 2);
      game = expire(game); // -> reveal
      if (r < CFG.roundsPerRace - 1) game = expire(game); // -> next question
    }
    const per = (CFG.roundsPerRace / 3) * CFG.pointsPerCorrect;
    const ace = game.racers.find((r) => r.id === 'ace')!;
    expect(ace.stats).toEqual({ speed: per, stamina: per, strength: per });
    expect(ace.correct).toBe(CFG.roundsPerRace);
  });
});

describe('race, results, next race', () => {
  function playToRace(): GameState {
    let game = expire(joinAll(newGame(), ['ace', 'mid', 'zero'], 0));
    for (let r = 0; r < CFG.roundsPerRace; r += 1) {
      game = chat(game, 'ace', correctLetter(game), game.phaseStartedAt + 1);
      game = chat(game, 'mid', r % 2 === 0 ? correctLetter(game) : wrongLetter(game), game.phaseStartedAt + 1);
      game = expire(expire(game));
    }
    return game;
  }

  test('after the last reveal the race is simulated with a countdown and outro', () => {
    const game = playToRace();
    expect(game.phase).toBe('race');
    expect(game.race).not.toBeNull();
    expect(game.race!.lanes).toHaveLength(3);
    expect(game.phaseEndsAt).toBe(
      game.phaseStartedAt + CFG.raceCountdownMs + game.race!.durationMs + CFG.raceOutroMs,
    );
  });

  test('more correct answers finish ahead: ace > mid > zero', () => {
    const game = playToRace();
    expect(game.race!.finishOrder).toEqual(['ace', 'mid', 'zero']);
  });

  test('results list standings and update the session leaderboard', () => {
    const results = expire(playToRace());
    expect(results.phase).toBe('results');
    expect(results.standings!.map((s) => [s.place, s.racerId])).toEqual([[1, 'ace'], [2, 'mid'], [3, 'zero']]);
    expect(results.session.ace).toEqual({ name: 'ACE', races: 1, wins: 1, podiums: 1, correct: 6 });
    expect(results.session.zero).toMatchObject({ races: 1, wins: 0, podiums: 1, correct: 0 });
  });

  test('after results, queued viewers are promoted into a fresh lobby with countdown running', () => {
    let game = playToRace();
    game = chat(game, 'late1', 'hi', game.phaseStartedAt + 1);
    game = chat(game, 'late2', 'hi', game.phaseStartedAt + 2);
    const lobby = expire(expire(game));
    expect(lobby.phase).toBe('lobby');
    expect(lobby.racers.map((r) => r.id)).toEqual(['late1', 'late2']);
    expect(lobby.racers.every((r) => r.correct === 0 && r.stats.speed === 0)).toBe(true);
    expect(lobby.queue).toEqual([]);
    expect(lobby.phaseEndsAt).toBe(lobby.phaseStartedAt + CFG.lobbyMs);
    expect(lobby.raceNumber).toBe(2);
    expect(lobby.race).toBeNull();
  });

  test('empty queue after results gives an idle lobby waiting for chat', () => {
    const lobby = expire(expire(playToRace()));
    expect(lobby.racers).toEqual([]);
    expect(lobby.phaseEndsAt).toBeNull();
  });

  test('second race does not reuse the first race\'s questions', () => {
    let game = playToRace();
    const firstIds = new Set(game.questions.map((q) => q.id));
    game = chat(game, 'next', 'hi', game.phaseStartedAt + 1);
    game = expire(expire(expire(game))); // results -> lobby -> question
    expect(game.questions.some((q) => firstIds.has(q.id))).toBe(false);
  });
});

describe('host controls', () => {
  test('skip advances any running phase immediately', () => {
    let game = expire(chat(newGame(), 'u1', 'hi', 0));
    game = reduce(game, { type: 'hostSkip', now: game.phaseStartedAt + 10 });
    expect(game.phase).toBe('reveal');
  });

  test('skip in an empty lobby does nothing', () => {
    const game = newGame();
    expect(reduce(game, { type: 'hostSkip', now: 5 })).toBe(game);
  });

  test('reset returns to an empty lobby but keeps the session leaderboard and level', () => {
    let game = reduce(newGame(), { type: 'setLevel', level: 'A2' });
    game = expire(chat(game, 'u1', 'hi', 0));
    game = { ...game, session: { u1: { name: 'U1', races: 3, wins: 1, podiums: 2, correct: 9 } } };
    const reset = reduce(game, { type: 'hostReset', now: 999 });
    expect(reset.phase).toBe('lobby');
    expect(reset.racers).toEqual([]);
    expect(reset.queue).toEqual([]);
    expect(reset.phaseEndsAt).toBeNull();
    expect(reset.session.u1!.races).toBe(3);
    expect(reset.level).toBe('A2');
  });

  test('createGame rejects an invalid question bank', () => {
    expect(() => createGame({ bank: [], seed: 1, now: 0 })).toThrow(/question bank/i);
  });
});

describe('review fixes', () => {
  test('ids that collide with Object.prototype keys can join, answer and score', () => {
    let game = expire(joinAll(newGame(), ['constructor', '__proto__', 'toString'], 0));
    for (const id of ['constructor', '__proto__', 'toString']) game = chat(game, id, correctLetter(game), 1);
    expect(Object.keys(game.answers).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    for (let r = 0; r < CFG.roundsPerRace; r += 1) {
      if (r > 0) for (const id of ['constructor', '__proto__', 'toString']) game = chat(game, id, correctLetter(game), game.phaseStartedAt + 1);
      game = expire(expire(game));
    }
    game = expire(game); // race -> results
    expect(game.session.constructor).toMatchObject({ races: 1, correct: CFG.roundsPerRace });
    const viaToString = new Map(Object.entries(game.session)).get('toString');
    expect(viaToString?.races).toBe(1);
  });

  test('answers arriving at or after the deadline are ignored even before a tick', () => {
    let game = expire(joinAll(newGame(), ['u1', 'u2'], 0));
    const deadline = game.phaseEndsAt!;
    game = chat(game, 'u1', correctLetter(game), deadline);
    game = chat(game, 'u2', correctLetter(game), deadline + 5_000);
    expect(game.answers).toEqual({});
  });

  test('racers who chat during race or results are queued for the next race', () => {
    let game = expire(joinAll(newGame(), ['u1', 'u2'], 0));
    for (let r = 0; r < CFG.roundsPerRace; r += 1) game = expire(expire(game));
    expect(game.phase).toBe('race');
    game = chat(game, 'u2', 'again!', game.phaseStartedAt + 1);
    game = expire(game);
    expect(game.phase).toBe('results');
    game = chat(game, 'u1', 'me too', game.phaseStartedAt + 1);
    const lobby = expire(game);
    expect(lobby.racers.map((r) => r.id)).toEqual(['u2', 'u1']);
  });

  test('isLockedAnswer flags a racer\'s valid answer during a question, nothing else', () => {
    const game = expire(joinAll(newGame(), ['u1'], 0));
    const msg = (userId: string, text: string) => ({ userId, nickname: userId, text });
    expect(isLockedAnswer(game, msg('u1', 'b'))).toBe(true);
    expect(isLockedAnswer(game, msg('u1', 'hello'))).toBe(false);
    expect(isLockedAnswer(game, msg('stranger', 'b'))).toBe(false);
    expect(isLockedAnswer(newGame(), msg('u1', 'b'))).toBe(false);
  });
});

