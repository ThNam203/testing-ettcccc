import { describe, expect, test } from 'vitest';
import { createSink, createTracker } from '../src/history/tracker';
import { deriveEvents, parseAnalyticsEvent, type AnalyticsEvent, type EventBody } from '../src/history/events';
import { QUESTION_BANK } from '../src/content/questions';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { createGame, reduce } from '../src/engine/game';
import type { GameAction, GameState } from '../src/engine/types';

const LETTERS = ['a', 'b', 'c', 'd'] as const;

function chatAction(id: string, text: string, now: number): GameAction {
  return { type: 'chat', message: { userId: id, nickname: id.toUpperCase(), text }, now };
}

/** Run actions, collecting derived events like the game tab does. */
function play(start: GameState, actions: readonly GameAction[]): { state: GameState; events: EventBody[] } {
  let state = start;
  const events: EventBody[] = [];
  for (const action of actions) {
    const next = reduce(state, action);
    events.push(...deriveEvents(state, next, 'now' in action ? action.now : 0));
    state = next;
  }
  return { state, events };
}

function lobbyWith(ids: readonly string[]): { state: GameState; events: EventBody[] } {
  return play(createGame({ bank: QUESTION_BANK, seed: 5, now: 0 }), ids.map((id) => chatAction(id, 'hi', 10)));
}

function types(events: readonly EventBody[]): string[] {
  return events.map((e) => e.type);
}

describe('deriveEvents', () => {
  test('new riders and queued viewers emit viewerJoined once', () => {
    const start = createGame({ bank: QUESTION_BANK, seed: 5, now: 0, config: { ...DEFAULT_CONFIG, maxRacers: 1 } });
    const { events } = play(start, [chatAction('u1', 'hi', 1), chatAction('u2', 'hi', 2), chatAction('u2', 'again', 3)]);
    expect(events).toEqual([
      { type: 'viewerJoined', viewerId: 'u1', nickname: 'U1', as: 'rider' },
      { type: 'viewerJoined', viewerId: 'u2', nickname: 'U2', as: 'queue' },
    ]);
  });

  test('lobby -> question emits raceStarted with riders, level and size', () => {
    const lobby = lobbyWith(['u1', 'u2']);
    const { events } = play(lobby.state, [{ type: 'hostStart', now: 100 }]);
    expect(events).toEqual([{ type: 'raceStarted', level: 'B1', rounds: 6, riderIds: ['u1', 'u2'], queue: 0 }]);
  });

  test('each locked answer emits answerLocked with the ORIGINAL choice index and time since the question opened', () => {
    const started = play(lobbyWith(['u1', 'u2']).state, [{ type: 'hostStart', now: 100 }]).state;
    const q = started.questions[0]!;
    const right = LETTERS[q.answer]!;
    const { events } = play(started, [chatAction('u1', right, 1_600), chatAction('u1', 'b', 1_700)]);
    const bankQ = QUESTION_BANK.find((b) => b.id === q.id)!;
    expect(events).toEqual([{
      type: 'answerLocked', round: 0, questionId: q.id, viewerId: 'u1', nickname: 'U1',
      choice: bankQ.answer, correct: true, ms: 1_500,
    }]);
  });

  test('question -> reveal emits questionClosed with per-choice counts in original order', () => {
    const started = play(lobbyWith(['u1', 'u2', 'u3']).state, [{ type: 'hostStart', now: 100 }]).state;
    const q = started.questions[0]!;
    const right = LETTERS[q.answer]!;
    const wrong = LETTERS[(q.answer + 1) % 4]!;
    const { events } = play(started, [chatAction('u1', right, 200), chatAction('u2', wrong, 300), { type: 'hostSkip', now: 400 }]);
    const closed = events.find((e) => e.type === 'questionClosed');
    const bankQ = QUESTION_BANK.find((b) => b.id === q.id)!;
    const wrongOriginal = bankQ.choices.indexOf(q.choices[(q.answer + 1) % 4]!);
    const counts = [0, 0, 0, 0];
    counts[bankQ.answer] = 1;
    counts[wrongOriginal] = 1;
    expect(closed).toEqual({
      type: 'questionClosed', round: 0, questionId: q.id, category: q.category, level: q.level, stat: q.stat,
      riders: 3, answered: 2, correct: 1, counts, correctChoice: bankQ.answer,
    });
  });

  test('race -> results emits raceEnded finished with the simulated duration', () => {
    let s = play(lobbyWith(['u1']).state, [{ type: 'hostStart', now: 100 }]).state;
    while (s.phase !== 'race') s = reduce(s, { type: 'hostSkip', now: 200 });
    const { events } = play(s, [{ type: 'hostSkip', now: 300 }]);
    const results = reduce(s, { type: 'hostSkip', now: 300 });
    const lane = results.race!.lanes[0]!;
    expect(events).toEqual([{
      type: 'raceEnded', outcome: 'finished', durationMs: Math.round(s.race!.durationMs), riders: 1,
      placings: [{ viewerId: 'u1', place: 1, correct: 0, finishMs: Math.round(lane.finishTimeMs) }],
    }]);
  });

  test('a reset mid-race emits raceEnded reset; a reset in an idle lobby emits nothing', () => {
    const started = play(lobbyWith(['u1']).state, [{ type: 'hostStart', now: 100 }]).state;
    expect(play(started, [{ type: 'hostReset', now: 150 }]).events)
      .toEqual([{ type: 'raceEnded', outcome: 'reset', durationMs: null, riders: 1, placings: [] }]);
    expect(play(createGame({ bank: QUESTION_BANK, seed: 1, now: 0 }), [{ type: 'hostReset', now: 1 }]).events).toEqual([]);
  });

  test('results -> next lobby re-seats queued players without counting them as new joins', () => {
    let s = lobbyWith(['u1']).state;
    s = reduce(s, { type: 'hostStart', now: 100 });
    while (s.phase !== 'race') s = reduce(s, { type: 'hostSkip', now: 200 });
    s = reduce(s, chatAction('late', 'hi', 210));
    s = reduce(s, { type: 'hostSkip', now: 300 }); // results
    const { events } = play(s, [{ type: 'hostSkip', now: 400 }]); // lobby, late promoted
    expect(types(events)).toEqual([]);
  });
});

describe('contract: game tab -> server', () => {
  test('every event from a full simulated race passes the server-side parser', () => {
    const emitted: AnalyticsEvent[] = [];
    const tracker = createTracker({ sessionId: 'C', clock: () => 1_700_000_000_000, emit: (e) => emitted.push(e), source: 'local', host: null, settings: '{}' });
    let state = createGame({ bank: QUESTION_BANK, seed: 77, now: 0 });
    const step = (action: GameAction): void => {
      const next = reduce(state, action);
      tracker.observe(state, next, 'now' in action ? action.now : 0);
      state = next;
    };
    let t = 0;
    ['u1', 'u2', 'u3'].forEach((id) => step(chatAction(id, 'hi', (t += 7))));
    step({ type: 'hostStart', now: (t += 13) });
    while (state.phase !== 'results') {
      if (state.phase === 'question') {
        step(chatAction('u1', 'a', (t += 333)));
        step(chatAction('u2', 'c', (t += 271)));
      }
      step({ type: 'hostSkip', now: (t += 1_001) });
    }
    tracker.chat({ userId: 'spec', nickname: 'Spec', text: 'gg' });
    tracker.chat({ userId: 'tiktok:9', nickname: 'Nine', text: 'gg', handle: 'nine.9' });
    tracker.end();
    const ended = emitted.find((e) => e.body.type === 'raceEnded')?.body;
    expect(ended?.type === 'raceEnded' ? ended.placings.map((p) => p.place) : []).toEqual([1, 2, 3]);
    expect(emitted.length).toBeGreaterThan(10);
    const rejected = emitted.filter((e) => parseAnalyticsEvent(JSON.parse(JSON.stringify(e))) === null);
    expect(rejected.map((e) => e.body)).toEqual([]);
  });
});

describe('parseAnalyticsEvent', () => {
  const valid: AnalyticsEvent = {
    id: 's1:1', sessionId: 's1', at: 1_700_000_000_000, raceSeq: 2,
    body: { type: 'answerLocked', round: 0, questionId: 'b1-01', viewerId: 'tiktok:1', nickname: 'Mai', choice: 2, correct: true, ms: 900 },
  };

  test('accepts every well-formed event type', () => {
    const bodies: EventBody[] = [
      { type: 'sessionStarted', source: 'tiktok', host: 'abc', settings: '{"a":1}' },
      { type: 'sessionSource', source: 'local', host: null },
      { type: 'sessionEnded' },
      { type: 'chatSeen', viewerId: 'v', nickname: 'V', handle: null },
      { type: 'chatSeen', viewerId: 'tiktok:1', nickname: 'Mai', handle: 'mai_1' },
      { type: 'viewerJoined', viewerId: 'v', nickname: 'V', as: 'queue' },
      { type: 'raceStarted', level: 'A2', rounds: 6, riderIds: ['a', 'b'], queue: 3 },
      valid.body,
      { type: 'questionClosed', round: 1, questionId: 'q', category: 'Idioms', level: 'B2', stat: 'speed', riders: 4, answered: 3, correct: 1, counts: [1, 0, 2, 0], correctChoice: 0 },
      { type: 'raceEnded', outcome: 'finished', durationMs: 38_000, riders: 2, placings: [
        { viewerId: 'a', place: 1, correct: 4, finishMs: 37_100 }, { viewerId: 'b', place: 2, correct: 1, finishMs: 38_000 },
      ] },
      { type: 'raceEnded', outcome: 'reset', durationMs: null, riders: 2, placings: [] },
    ];
    for (const body of bodies) {
      const event = { ...valid, raceSeq: null, body };
      expect(parseAnalyticsEvent(JSON.parse(JSON.stringify(event))), body.type).toEqual(event);
    }
  });

  test('rejects malformed events', () => {
    const bad: unknown[] = [
      null, 'x', { ...valid, id: '' }, { ...valid, at: 'now' }, { ...valid, raceSeq: 'one' },
      { ...valid, body: { ...valid.body, type: 'hack' } },
      { ...valid, body: { ...valid.body, choice: 7 } },
      { ...valid, body: { ...valid.body, viewerId: 'x'.repeat(65) } },
      { ...valid, body: { type: 'questionClosed', round: 0, questionId: 'q', category: 'c', level: 'B1', stat: 'speed', riders: 1, answered: 1, correct: 0, counts: [1, 0, 0], correctChoice: 0 } },
      { ...valid, body: { type: 'sessionStarted', source: 'tiktok', host: null, settings: 'x'.repeat(50_001) } },
      { ...valid, body: { type: 'chatSeen', viewerId: 'v', nickname: 'V', handle: 'bad handle' } },
      { ...valid, body: { type: 'chatSeen', viewerId: 'v', nickname: 'V' } },
      { ...valid, body: { type: 'raceEnded', outcome: 'finished', durationMs: 1, riders: 1 } },
      { ...valid, body: { type: 'raceEnded', outcome: 'finished', durationMs: 1, riders: 1, placings: [{ viewerId: 'a', place: 0, correct: 0, finishMs: 1 }] } },
      { ...valid, body: { type: 'raceEnded', outcome: 'finished', durationMs: 1, riders: 1, placings: [{ viewerId: 'a', place: 1, correct: 0, finishMs: 1.5 }] } },
    ];
    for (const data of bad) expect(parseAnalyticsEvent(data)).toBeNull();
  });
});

describe('tracker', () => {
  function collect(): { events: AnalyticsEvent[]; tracker: ReturnType<typeof createTracker> } {
    const events: AnalyticsEvent[] = [];
    let t = 1_000;
    const tracker = createTracker({
      sessionId: 'S', clock: () => (t += 1), emit: (e) => events.push(e),
      source: 'local', host: null, settings: '{}',
    });
    return { events, tracker };
  }

  test('starts the session, numbers events, and stamps race-scoped events with the race sequence', () => {
    const { events, tracker } = collect();
    const lobby = lobbyWith(['u1']).state;
    tracker.observe(lobby, reduce(lobby, { type: 'hostStart', now: 5 }), 5);
    tracker.chat({ userId: 'u9', nickname: 'U9', text: 'hello' });
    expect(events.map((e) => [e.id, e.body.type, e.raceSeq])).toEqual([
      ['S:1', 'sessionStarted', null],
      ['S:2', 'raceStarted', 1],
      ['S:3', 'chatSeen', null],
    ]);
    expect(events[2]!.body).toEqual({ type: 'chatSeen', viewerId: 'u9', nickname: 'U9', handle: null });
  });

  test('race sequence increases per started race', () => {
    const { events, tracker } = collect();
    const lobby = lobbyWith(['u1']).state;
    const q = reduce(lobby, { type: 'hostStart', now: 5 });
    tracker.observe(lobby, q, 5);
    const back = reduce(q, { type: 'hostReset', now: 6 });
    tracker.observe(q, back, 6);
    const lobby2 = reduce(back, chatAction('u1', 'hi', 7));
    tracker.observe(back, lobby2, 7);
    tracker.observe(lobby2, reduce(lobby2, { type: 'hostStart', now: 8 }), 8);
    expect(events.filter((e) => e.body.type === 'raceStarted').map((e) => e.raceSeq)).toEqual([1, 2]);
    expect(events.find((e) => e.body.type === 'raceEnded')?.raceSeq).toBe(1);
  });

  test('source and end events', () => {
    const { events, tracker } = collect();
    tracker.source('tiktok', 'abc');
    tracker.end();
    expect(events.slice(1).map((e) => e.body)).toEqual([
      { type: 'sessionSource', source: 'tiktok', host: 'abc' },
      { type: 'sessionEnded' },
    ]);
  });
});

describe('sink', () => {
  const event = (n: number): AnalyticsEvent => ({ id: `S:${n}`, sessionId: 'S', at: n, raceSeq: null, body: { type: 'sessionEnded' } });

  test('sends in batches and removes only what the server accepted', async () => {
    const sent: string[][] = [];
    const sink = createSink({ post: async (batch) => { sent.push(batch.map((e) => e.id)); return true; }, maxQueue: 100, batchSize: 2 });
    [1, 2, 3].forEach((n) => sink.push(event(n)));
    await sink.flush();
    expect(sent).toEqual([['S:1', 'S:2'], ['S:3']]);
    expect(sink.pending()).toBe(0);
  });

  test('keeps events when the server is down and reports health', async () => {
    let up = false;
    const health: boolean[] = [];
    const sink = createSink({ post: async () => up, maxQueue: 100, batchSize: 10, onHealth: (ok) => health.push(ok) });
    sink.push(event(1));
    await sink.flush();
    expect(sink.pending()).toBe(1);
    up = true;
    await sink.flush();
    expect(sink.pending()).toBe(0);
    expect(health).toEqual([false, true]);
  });

  test('a thrown network error counts as down, not a crash', async () => {
    const sink = createSink({ post: async () => { throw new Error('offline'); }, maxQueue: 10, batchSize: 10 });
    sink.push(event(1));
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(sink.pending()).toBe(1);
  });

  test('when the queue is full the oldest events are dropped and counted', () => {
    const sink = createSink({ post: async () => true, maxQueue: 2, batchSize: 10 });
    [1, 2, 3].forEach((n) => sink.push(event(n)));
    expect(sink.pending()).toBe(2);
    expect(sink.dropped()).toBe(1);
  });

  test('drain hands back everything still queued (for sendBeacon on page close)', () => {
    const sink = createSink({ post: async () => true, maxQueue: 10, batchSize: 10 });
    [1, 2].forEach((n) => sink.push(event(n)));
    expect(sink.drain().map((e) => e.id)).toEqual(['S:1', 'S:2']);
    expect(sink.pending()).toBe(0);
  });
});
