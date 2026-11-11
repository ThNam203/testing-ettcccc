import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  formatCompact, formatDuration, formatPercent, parseGroups, parseHours, parseOverview, parsePlayers, parseQuestions,
  StatsUnavailableError, addGift, deleteGift, getJson, updateGift, parseGift, parseGifts, parseSessions, parseWinners, profileUrl, sinceFor,
} from '../src/admin/statsApi';

const overview = {
  overview: {
    sessions: 2, streamMs: 606_000, comments: 4, uniqueViewers: 3, returningViewers: 1, racesFinished: 1, racesReset: 1,
    avgRidersPerRace: 1.5, answers: 2, answerRate: 1, accuracy: 0.5,
  },
  funnel: { chatted: 3, joined: 3, rode: 2, answered: 2, finished: 2 },
};

describe('response parsers', () => {
  test('overview + funnel round-trip; nullable ratios allowed', () => {
    expect(parseOverview(overview)).toEqual(overview);
    const empty = { ...overview, overview: { ...overview.overview, accuracy: null, answerRate: null, avgRidersPerRace: null } };
    expect(parseOverview(empty)).toEqual(empty);
  });

  test('rejects wrong shapes', () => {
    expect(parseOverview({ overview: { sessions: '2' }, funnel: overview.funnel })).toBeNull();
    expect(parseOverview(null)).toBeNull();
    expect(parseQuestions({ questions: [{ questionId: 'q' }] })).toBeNull();
    expect(parsePlayers({ players: 'x' })).toBeNull();
  });

  test('questions, groups, players, sessions, hours', () => {
    const q = {
      questionId: 'q1', category: 'Idioms', level: 'B1', plays: 2, asked: 5, answered: 4, correct: 1, accuracy: 0.25,
      answerRate: 0.8, medianMs: 2500, counts: [0, 3, 1, 0], correctChoice: 2, misleading: true,
    };
    expect(parseQuestions({ questions: [q] })).toEqual([q]);
    const g = { key: 'B1', questions: 1, answered: 2, correct: 1, accuracy: 0.5, answerRate: 1 };
    expect(parseGroups({ levels: [g], categories: [] })).toEqual({ levels: [g], categories: [] });
    const p = { viewerId: 'a', nickname: 'Ann', handle: 'ann.1', races: 2, answers: 1, correct: 1, accuracy: 1, sessions: 2, firstSeen: 1, lastSeen: 2 };
    expect(parsePlayers({ players: [p] })).toEqual([p]);
    const s = { id: 'S1', startedAt: 1, endedAt: null, lastAt: 5, source: 'tiktok', host: 'h', racesFinished: 1, racesReset: 0, viewers: 3, answers: 2 };
    expect(parseSessions({ sessions: [s] })).toEqual([s]);
    const h = { hour: 20, comments: 4, joins: 3, chatters: 3 };
    expect(parseHours({ hours: [h] })).toEqual([h]);
  });
});

describe('winners and gifts', () => {
  const lead = {
    viewerId: 'tiktok:1', nickname: 'Ann', handle: 'ann.1', races: 2, wins: 1, podiums: 2, bestPlace: 1, correct: 9,
    answers: 1, accuracy: 1, gifts: 0, lastGiftAt: null, sessionGift: null,
  };
  const race = {
    raceSeq: 1, endedAt: 5, level: 'B1', rounds: 6, riders: 3, place: 1, viewerId: 'tiktok:1', nickname: 'Ann', handle: null,
    correct: 5, finishMs: 31_000, gifts: 1, lastGiftAt: 9, gift: { id: 3, status: 'owed' },
  };
  const gift = {
    id: 3, viewerId: null, nickname: null, handle: null, sessionId: 'S1', raceSeq: 1, place: 1, prize: '50k', note: '',
    status: 'sent', createdAt: 1, updatedAt: 2, sentAt: 2,
  };

  test('round-trip', () => {
    expect(parseWinners({ leaderboard: [lead], races: [race] })).toEqual({ leaderboard: [lead], races: [race] });
    expect(parseGifts({ gifts: [gift] })).toEqual([gift]);
    expect(parseGift({ gift })).toEqual(gift);
  });

  test('rejects unknown gift status and bad nested refs', () => {
    expect(parseGifts({ gifts: [{ ...gift, status: 'lost' }] })).toBeNull();
    expect(parseWinners({ leaderboard: [], races: [{ ...race, gift: { id: 'x', status: 'owed' } }] })).toBeNull();
    expect(parseWinners({ leaderboard: [{ ...lead, sessionGift: { id: 1, status: 'nope' } }], races: [] })).toBeNull();
  });

  test('profile link only for real handles', () => {
    expect(profileUrl('ann.1')).toBe('https://www.tiktok.com/@ann.1');
    expect(profileUrl(null)).toBeNull();
    expect(profileUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('formatting', () => {
  test('compact numbers, percents, durations', () => {
    expect(formatCompact(1284)).toBe('1.3K');
    expect(formatCompact(42)).toBe('42');
    expect(formatPercent(0.256)).toBe('26%');
    expect(formatPercent(null)).toBe('–');
    expect(formatDuration(606_000)).toBe('10m 06s');
    expect(formatDuration(3_725_000)).toBe('1h 02m');
    expect(formatDuration(null)).toBe('–');
  });

  test('period -> since (wall clock)', () => {
    const now = Date.UTC(2026, 10, 11, 15, 30);
    expect(sinceFor('all', now)).toBeNull();
    expect(sinceFor('7d', now)).toBe(now - 7 * 86_400_000);
    expect(sinceFor('30d', now)).toBe(now - 30 * 86_400_000);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    expect(sinceFor('today', now)).toBe(today.getTime());
  });
});

describe('gift requests (fetch stubbed at the network boundary)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const gift = {
    id: 3, viewerId: 'tiktok:1', nickname: 'Ann', handle: 'ann.1', sessionId: 'S1', raceSeq: 1, place: 1, prize: '50k', note: '',
    status: 'owed', createdAt: 1, updatedAt: 1, sentAt: null,
  };
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  test('addGift posts JSON and returns the validated gift', async () => {
    const fetchMock = respond(200, { gift });
    vi.stubGlobal('fetch', fetchMock);
    const input = { viewerId: 'tiktok:1', sessionId: 'S1', raceSeq: 1, prize: '50k', note: '', status: 'owed' } as const;
    await expect(addGift(input)).resolves.toEqual(gift);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:5180/stats/gifts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  test('server error text reaches the admin (e.g. duplicate gift)', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'This viewer already has a gift for that race.' }));
    await expect(updateGift(3, { status: 'sent' })).rejects.toThrow('already has a gift');
    vi.stubGlobal('fetch', respond(500, 'oops'));
    await expect(deleteGift(3)).rejects.toThrow('Request failed (500)');
  });

  test('unreachable server and malformed replies are reported, not swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(deleteGift(3)).rejects.toBeInstanceOf(StatsUnavailableError);
    await expect(getJson('/stats/gifts', parseGifts)).rejects.toBeInstanceOf(StatsUnavailableError);
    vi.stubGlobal('fetch', respond(200, { deleted: 'yes' }));
    await expect(deleteGift(3)).rejects.toThrow('Unexpected stats data');
    vi.stubGlobal('fetch', respond(200, { deleted: true }));
    await expect(deleteGift(3)).resolves.toBe(true);
  });
});
