import { afterEach, describe, expect, test } from 'vitest';
import type { AnalyticsEvent, EventBody } from '../src/history/events';
import { openStatsStore, type StatsStore } from '../src/stats/store';

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0); // fixed wall clock
const MIN = 60_000;

let store: StatsStore | null = null;
afterEach(() => store?.close());

/** Event factory with a per-session counter, like the tracker. */
function session(id: string, start = T0) {
  let n = 0;
  let raceSeq = 0;
  const make = (body: EventBody, offsetMs: number): AnalyticsEvent => {
    if (body.type === 'raceStarted') raceSeq += 1;
    n += 1;
    const scoped = ['raceStarted', 'answerLocked', 'questionClosed', 'raceEnded'].includes(body.type);
    return { id: `${id}:${n}`, sessionId: id, at: start + offsetMs, raceSeq: scoped ? raceSeq : null, body };
  };
  return make;
}

function answer(viewerId: string, round: number, questionId: string, choice: number, correct: boolean, ms: number): EventBody {
  return { type: 'answerLocked', round, questionId, viewerId, nickname: viewerId.toUpperCase(), choice, correct, ms };
}

function closed(round: number, questionId: string, counts: [number, number, number, number], correctChoice: number, riders = 3): EventBody {
  const answered = counts.reduce((a, b) => a + b, 0);
  return {
    type: 'questionClosed', round, questionId, category: 'Idioms', level: 'B1', stat: 'speed',
    riders, answered, correct: counts[correctChoice] ?? 0, counts, correctChoice,
  };
}

/** One session: 3 chatters, 2 ride, 1 question, race finishes; then a second session where 'a' returns. */
function seed(s: StatsStore): void {
  const e = session('S1');
  s.ingest([
    e({ type: 'sessionStarted', source: 'tiktok', host: 'host1', settings: '{}' }, 0),
    e({ type: 'chatSeen', viewerId: 'a', nickname: 'Ann', handle: null }, 1_000),
    e({ type: 'chatSeen', viewerId: 'b', nickname: 'Bo', handle: null }, 2_000),
    e({ type: 'chatSeen', viewerId: 'c', nickname: 'Cy', handle: null }, MIN + 1_000),
    e({ type: 'viewerJoined', viewerId: 'a', nickname: 'Ann', as: 'rider' }, 1_000),
    e({ type: 'viewerJoined', viewerId: 'b', nickname: 'Bo', as: 'rider' }, 2_000),
    e({ type: 'viewerJoined', viewerId: 'c', nickname: 'Cy', as: 'queue' }, MIN + 1_000),
    e({ type: 'raceStarted', level: 'B1', rounds: 1, riderIds: ['a', 'b'], queue: 1 }, 30_000),
    e(answer('a', 0, 'q1', 2, true, 1_200), 31_200),
    e(answer('b', 0, 'q1', 1, false, 3_000), 33_000),
    e(closed(0, 'q1', [0, 1, 1, 0], 2, 2), 45_000),
    e({ type: 'raceEnded', outcome: 'finished', durationMs: 38_000, riders: 2, placings: [
      { viewerId: 'a', place: 1, correct: 1, finishMs: 36_000 }, { viewerId: 'b', place: 2, correct: 0, finishMs: 38_000 },
    ] }, 90_000),
    e({ type: 'sessionEnded' }, 10 * MIN),
  ]);
  const f = session('S2', T0 + 24 * 60 * MIN);
  s.ingest([
    f({ type: 'sessionStarted', source: 'local', host: null, settings: '{}' }, 0),
    f({ type: 'chatSeen', viewerId: 'a', nickname: 'Ann2', handle: null }, 1_000),
    f({ type: 'viewerJoined', viewerId: 'a', nickname: 'Ann2', as: 'rider' }, 1_000),
    f({ type: 'raceStarted', level: 'A2', rounds: 1, riderIds: ['a'], queue: 0 }, 5_000),
    f({ type: 'raceEnded', outcome: 'reset', durationMs: null, riders: 1, placings: [] }, 6_000),
  ]);
}

describe('stats store', () => {
  test('ingest stores events once; resending the same batch is ignored', () => {
    store = openStatsStore(':memory:');
    const e = session('S');
    const batch = [e({ type: 'sessionStarted', source: 'local', host: null, settings: '{}' }, 0), e({ type: 'chatSeen', viewerId: 'v', nickname: 'V', handle: null }, 1)];
    expect(store.ingest(batch)).toEqual({ stored: 2, duplicates: 0 });
    expect(store.ingest(batch)).toEqual({ stored: 0, duplicates: 2 });
    expect(store.overview({ since: null }).comments).toBe(1);
  });

  test('overview: sessions, viewers, returning viewers, races, accuracy, answer rate', () => {
    store = openStatsStore(':memory:');
    seed(store);
    expect(store.overview({ since: null })).toEqual({
      sessions: 2,
      streamMs: 10 * MIN + 6_000,
      comments: 4,
      uniqueViewers: 3,
      returningViewers: 1,
      racesFinished: 1,
      racesReset: 1,
      avgRidersPerRace: 1.5,
      answers: 2,
      answerRate: 1, // 2 answered / 2 riders asked
      accuracy: 0.5,
    });
  });

  test('since filter keeps only newer data', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const later = store.overview({ since: T0 + 12 * 60 * MIN });
    expect(later.sessions).toBe(1);
    expect(later.uniqueViewers).toBe(1);
    expect(later.answers).toBe(0);
  });

  test('funnel: chatted -> joined -> rode -> answered -> finished a race', () => {
    store = openStatsStore(':memory:');
    seed(store);
    expect(store.funnel({ since: null })).toEqual({ chatted: 3, joined: 3, rode: 2, answered: 2, finished: 2 });
  });

  test('questions: accuracy, median answer time, per-choice counts and the misleading flag', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const e = session('S3', T0 + 2 * 24 * 60 * MIN);
    store.ingest([
      e({ type: 'sessionStarted', source: 'local', host: null, settings: '{}' }, 0),
      e({ type: 'raceStarted', level: 'B1', rounds: 1, riderIds: ['x', 'y', 'z'], queue: 0 }, 1_000),
      e(answer('x', 0, 'q1', 1, false, 2_000), 3_000),
      e(answer('y', 0, 'q1', 1, false, 4_000), 5_000),
      e(closed(0, 'q1', [0, 2, 0, 0], 2, 3), 9_000),
    ]);
    const [q1] = store.questions({ since: null });
    expect(q1).toEqual({
      questionId: 'q1', category: 'Idioms', level: 'B1', plays: 2, asked: 5, answered: 4, correct: 1,
      accuracy: 0.25, answerRate: 0.8, medianMs: 2_500, counts: [0, 3, 1, 0], correctChoice: 2, misleading: true,
    });
  });

  test('levels and categories', () => {
    store = openStatsStore(':memory:');
    seed(store);
    expect(store.levels({ since: null })).toEqual([{ key: 'B1', questions: 1, answered: 2, correct: 1, accuracy: 0.5, answerRate: 1 }]);
    expect(store.categories({ since: null })).toEqual([{ key: 'Idioms', questions: 1, answered: 2, correct: 1, accuracy: 0.5, answerRate: 1 }]);
  });

  test('players: latest nickname, races, answers, accuracy, sessions', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const players = store.players({ since: null }, 10);
    expect(players[0]).toEqual({
      viewerId: 'a', nickname: 'Ann2', handle: null, races: 2, answers: 1, correct: 1, accuracy: 1, sessions: 2,
      firstSeen: T0 + 1_000, lastSeen: T0 + 24 * 60 * MIN + 1_000,
    });
    expect(players.map((p) => p.viewerId)).toEqual(['a', 'b', 'c']);
  });

  test('sessions list, newest first', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const list = store.sessions(10);
    expect(list.map((s) => [s.id, s.source, s.host, s.racesFinished, s.viewers, s.answers])).toEqual([
      ['S2', 'local', null, 0, 1, 0],
      ['S1', 'tiktok', 'host1', 1, 3, 2],
    ]);
    expect(list[1]!.endedAt).toBe(T0 + 10 * MIN);
  });

  test('activity by hour of day', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const hours = store.hours({ since: null });
    expect(hours.reduce((sum, h) => sum + h.comments, 0)).toBe(4);
    expect(hours.every((h) => h.hour >= 0 && h.hour <= 23)).toBe(true);
  });

  test('delete viewer removes their personal rows but keeps anonymous totals', () => {
    store = openStatsStore(':memory:');
    seed(store);
    expect(store.deleteViewer('a')).toBe(true);
    expect(store.players({ since: null }, 10).map((p) => p.viewerId)).toEqual(['b', 'c']);
    expect(store.questions({ since: null })[0]!.answered).toBe(2); // question totals are anonymous counts
    expect(store.deleteViewer('nobody')).toBe(false);
  });

  test('CSV export escapes commas, quotes and newlines', () => {
    store = openStatsStore(':memory:');
    const e = session('S');
    store.ingest([
      e({ type: 'sessionStarted', source: 'local', host: null, settings: '{}' }, 0),
      e({ type: 'chatSeen', viewerId: 'v1', nickname: 'Mai, "the best"\nok', handle: null }, 1),
    ]);
    const csv = store.exportCsv('viewers', { since: null });
    expect(csv.split('\n')[0]).toContain('viewer_id');
    expect(csv).toContain('"Mai, ""the best""\nok"');
  });

  test('events for unknown sessions still store (session row created on demand)', () => {
    store = openStatsStore(':memory:');
    const e = session('LATE');
    expect(store.ingest([e({ type: 'chatSeen', viewerId: 'v', nickname: 'V', handle: null }, 5)])).toEqual({ stored: 1, duplicates: 0 });
    expect(store.sessions(5)[0]!.id).toBe('LATE');
  });
});
