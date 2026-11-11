import { afterEach, describe, expect, test } from 'vitest';
import type { AnalyticsEvent, EventBody, Placing } from '../src/history/events';
import { openStatsStore, type StatsStore } from '../src/stats/store';

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const HOUR = 3_600_000;

let store: StatsStore | null = null;
afterEach(() => store?.close());

function session(id: string, start = T0) {
  let n = 0;
  let raceSeq = 0;
  return (body: EventBody, offsetMs: number): AnalyticsEvent => {
    if (body.type === 'raceStarted') raceSeq += 1;
    n += 1;
    const scoped = ['raceStarted', 'answerLocked', 'questionClosed', 'raceEnded'].includes(body.type);
    return { id: `${id}:${n}`, sessionId: id, at: start + offsetMs, raceSeq: scoped ? raceSeq : null, body };
  };
}

const place = (viewerId: string, p: number, correct: number): Placing => ({ viewerId, place: p, correct, finishMs: 30_000 + p * 1_000 });

/** Session S1: race 1 (a wins), race 2 (b wins), race 3 reset. a and b chat with @handles; c is a simulator viewer. */
function seed(s: StatsStore): void {
  const e = session('S1');
  s.ingest([
    e({ type: 'sessionStarted', source: 'tiktok', host: 'host1', settings: '{}' }, 0),
    e({ type: 'chatSeen', viewerId: 'tiktok:1', nickname: 'Ann', handle: 'ann.1' }, 1_000),
    e({ type: 'chatSeen', viewerId: 'tiktok:2', nickname: 'Bo', handle: 'bo_2' }, 2_000),
    e({ type: 'chatSeen', viewerId: 'c', nickname: 'Cy', handle: null }, 3_000),
    e({ type: 'raceStarted', level: 'B1', rounds: 6, riderIds: ['tiktok:1', 'tiktok:2', 'c'], queue: 0 }, 10_000),
    e({ type: 'answerLocked', round: 0, questionId: 'q1', viewerId: 'tiktok:1', nickname: 'Ann', choice: 0, correct: true, ms: 900 }, 11_000),
    e({ type: 'answerLocked', round: 0, questionId: 'q1', viewerId: 'tiktok:2', nickname: 'Bo', choice: 1, correct: false, ms: 900 }, 11_500),
    e({ type: 'raceEnded', outcome: 'finished', durationMs: 33_000, riders: 3, placings: [place('tiktok:1', 1, 5), place('tiktok:2', 2, 3), place('c', 3, 1)] }, 60_000),
    e({ type: 'raceStarted', level: 'B1', rounds: 6, riderIds: ['tiktok:1', 'tiktok:2'], queue: 0 }, 70_000),
    e({ type: 'raceEnded', outcome: 'finished', durationMs: 32_000, riders: 2, placings: [place('tiktok:2', 1, 6), place('tiktok:1', 2, 4)] }, 120_000),
    e({ type: 'raceStarted', level: 'B1', rounds: 6, riderIds: ['c'], queue: 0 }, 130_000),
    e({ type: 'raceEnded', outcome: 'reset', durationMs: null, riders: 1, placings: [] }, 131_000),
  ]);
}

describe('viewer @handles', () => {
  test('stored from chat; a message without a handle keeps the known one; a newer handle replaces it', () => {
    store = openStatsStore(':memory:');
    const e = session('S');
    store.ingest([
      e({ type: 'chatSeen', viewerId: 'tiktok:1', nickname: 'Ann', handle: 'ann.1' }, 1),
      e({ type: 'viewerJoined', viewerId: 'tiktok:1', nickname: 'Ann', as: 'rider' }, 2),
    ]);
    expect(store.players({ since: null }, 5)[0]!.handle).toBe('ann.1');
    store.ingest([e({ type: 'chatSeen', viewerId: 'tiktok:1', nickname: 'Ann', handle: 'ann.renamed' }, 3)]);
    expect(store.players({ since: null }, 5)[0]!.handle).toBe('ann.renamed');
  });
});

describe('winners', () => {
  test('session leaderboard: wins, podiums, correct answers, best place; handle included', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const { leaderboard } = store.winners('S1');
    expect(leaderboard.map((r) => [r.viewerId, r.handle, r.races, r.wins, r.podiums, r.bestPlace, r.correct])).toEqual([
      ['tiktok:1', 'ann.1', 2, 1, 2, 1, 9],
      ['tiktok:2', 'bo_2', 2, 1, 2, 1, 9],
      ['c', null, 1, 0, 1, 3, 1],
    ]);
    // Order: wins, then correct answers, podiums, best place; a full tie falls back to nickname.
    expect(leaderboard[0]).toMatchObject({ nickname: 'Ann', answers: 1, accuracy: 1, gifts: 0, lastGiftAt: null, sessionGift: null });
  });

  test('races: finished races only, newest first, riders in finishing order', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const { races } = store.winners('S1');
    expect(races.map((r) => [r.raceSeq, r.place, r.viewerId])).toEqual([
      [2, 1, 'tiktok:2'], [2, 2, 'tiktok:1'],
      [1, 1, 'tiktok:1'], [1, 2, 'tiktok:2'], [1, 3, 'c'],
    ]);
    expect(races[0]).toMatchObject({ level: 'B1', rounds: 6, riders: 2, correct: 6, finishMs: 31_000, endedAt: T0 + 120_000, gift: null });
  });

  test('unknown session: empty lists', () => {
    store = openStatsStore(':memory:');
    expect(store.winners('nope')).toEqual({ leaderboard: [], races: [] });
  });
});

describe('gift ledger', () => {
  test('add a gift for a race place; it shows on that race row and on the viewer history', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const added = store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: '50k voucher', note: '', status: 'owed' }, T0 + HOUR);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.gift).toMatchObject({
      viewerId: 'tiktok:1', nickname: 'Ann', handle: 'ann.1', sessionId: 'S1', raceSeq: 1, place: 1,
      prize: '50k voucher', status: 'owed', createdAt: T0 + HOUR, sentAt: null,
    });
    const { races, leaderboard } = store.winners('S1');
    expect(races.find((r) => r.raceSeq === 1 && r.place === 1)?.gift).toEqual({ id: added.gift.id, status: 'owed' });
    expect(leaderboard.find((r) => r.viewerId === 'tiktok:1')).toMatchObject({ gifts: 1, lastGiftAt: T0 + HOUR });
  });

  test('a session-level gift (no race) is allowed and shows on the leaderboard row', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const added = store.addGift({ viewerId: 'tiktok:2', sessionId: 'S1', raceSeq: null, prize: 'Top of stream', note: 'DM sent', status: 'sent' }, T0 + HOUR);
    expect(added.ok && added.gift.place).toBeNull();
    expect(added.ok && added.gift.sentAt).toBe(T0 + HOUR);
    expect(store.winners('S1').leaderboard.find((r) => r.viewerId === 'tiktok:2')?.sessionGift).toMatchObject({ status: 'sent' });
  });

  test('refuses unknown viewers, a race the viewer did not ride, and a second open gift for the same race', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const base = { sessionId: 'S1', raceSeq: 1, prize: 'x', note: '', status: 'owed' } as const;
    expect(store.addGift({ ...base, viewerId: 'ghost' }, T0)).toEqual({ ok: false, error: 'Unknown viewer.' });
    expect(store.addGift({ ...base, viewerId: 'c', raceSeq: 2 }, T0)).toEqual({ ok: false, error: 'That viewer did not finish that race.' });
    expect(store.addGift({ ...base, viewerId: 'c' }, T0).ok).toBe(true);
    expect(store.addGift({ ...base, viewerId: 'c' }, T0)).toEqual({ ok: false, error: 'This viewer already has a gift for that race.' });
  });

  test('update status, prize and note; sent stamps sentAt once; skipped gifts do not count as received', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const added = store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: 'x', note: '', status: 'owed' }, T0);
    if (!added.ok) throw new Error('add failed');
    const id = added.gift.id;
    const gift = (r: ReturnType<StatsStore['updateGift']>) => (r.ok ? r.gift : r);
    expect(gift(store.updateGift(id, { status: 'sent', note: 'DM 11/11' }, T0 + 1))).toMatchObject({ status: 'sent', note: 'DM 11/11', sentAt: T0 + 1, updatedAt: T0 + 1 });
    expect(gift(store.updateGift(id, { prize: 'y' }, T0 + 2))).toMatchObject({ prize: 'y', sentAt: T0 + 1 });
    expect(gift(store.updateGift(id, { status: 'skipped' }, T0 + 3))).toMatchObject({ status: 'skipped', sentAt: null });
    expect(store.winners('S1').leaderboard.find((r) => r.viewerId === 'tiktok:1')).toMatchObject({ gifts: 0, lastGiftAt: null });
    expect(store.updateGift(999, { status: 'sent' }, T0)).toEqual({ ok: false, error: 'No such gift.', reason: 'notFound' });
    // a skipped gift no longer blocks a new one for the same race
    expect(store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: 'z', note: '', status: 'owed' }, T0 + 4).ok).toBe(true);
    // ...but the skipped one cannot be reopened while the new one is open
    expect(store.updateGift(id, { status: 'owed' }, T0 + 5)).toEqual({
      ok: false, error: 'This viewer already has a gift for that race.', reason: 'conflict',
    });
    expect(store.updateGift(id, { note: 'still skipped' }, T0 + 6).ok).toBe(true);
  });

  test('one open session-wide gift per viewer per session (double submit is refused)', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const input = { viewerId: 'tiktok:2', sessionId: 'S1', raceSeq: null, prize: 'Top of stream', note: '', status: 'owed' } as const;
    expect(store.addGift(input, T0).ok).toBe(true);
    expect(store.addGift(input, T0)).toEqual({ ok: false, error: 'This viewer already has a gift for this session.' });
    // a race gift in the same session is a separate thing
    expect(store.addGift({ ...input, raceSeq: 2 }, T0).ok).toBe(true);
  });

  test('owed gifts stay listed after the period window, so promises are never lost', () => {
    store = openStatsStore(':memory:');
    seed(store);
    store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: 'old owed', note: '', status: 'owed' }, T0);
    store.addGift({ viewerId: 'tiktok:2', sessionId: 'S1', raceSeq: 2, prize: 'old sent', note: '', status: 'sent' }, T0);
    expect(store.gifts({ since: T0 + HOUR }, null).map((g) => g.prize)).toEqual(['old owed']);
  });

  test('list filters by time and status, newest first; delete removes one', () => {
    store = openStatsStore(':memory:');
    seed(store);
    const a = store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: 'a', note: '', status: 'owed' }, T0 + HOUR);
    const b = store.addGift({ viewerId: 'tiktok:2', sessionId: 'S1', raceSeq: 2, prize: 'b', note: '', status: 'sent' }, T0 + 2 * HOUR);
    if (!a.ok || !b.ok) throw new Error('add failed');
    expect(store.gifts({ since: null }, null).map((g) => g.prize)).toEqual(['b', 'a']);
    expect(store.gifts({ since: null }, 'owed').map((g) => g.prize)).toEqual(['a']);
    expect(store.gifts({ since: T0 + 90 * 60_000 }, null).map((g) => g.prize)).toEqual(['b', 'a']); // a is older but still owed
    expect(store.deleteGift(a.gift.id)).toBe(true);
    expect(store.deleteGift(a.gift.id)).toBe(false);
    expect(store.gifts({ since: null }, null)).toHaveLength(1);
  });

  test('deleting a viewer keeps the gift (date, prize, status) but removes who it was and the note', () => {
    store = openStatsStore(':memory:');
    seed(store);
    store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: '50k', note: 'phone 0909…', status: 'sent' }, T0);
    store.deleteViewer('tiktok:1');
    expect(store.gifts({ since: null }, null)[0]).toMatchObject({ viewerId: null, nickname: null, handle: null, note: '', prize: '50k', status: 'sent' });
    expect(store.winners('S1').races.some((r) => r.viewerId === 'tiktok:1')).toBe(false);
  });

  test('gifts and race results export as CSV', () => {
    store = openStatsStore(':memory:');
    seed(store);
    store.addGift({ viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: 'Voucher, 50k', note: '', status: 'owed' }, T0);
    expect(store.exportCsv('gifts', { since: null })).toContain('"Voucher, 50k"');
    expect(store.exportCsv('race_results', { since: null }).split('\n')[0]).toContain('place');
  });
});
