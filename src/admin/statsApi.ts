import { BRIDGE_PORT } from '../chat/tiktokBridge';

/** Admin page -> derby server stats API. Responses are validated before use. */

export const STATS_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;

export interface Overview {
  readonly sessions: number; readonly streamMs: number; readonly comments: number; readonly uniqueViewers: number;
  readonly returningViewers: number; readonly racesFinished: number; readonly racesReset: number;
  readonly avgRidersPerRace: number | null; readonly answers: number; readonly answerRate: number | null;
  readonly accuracy: number | null;
}
export interface Funnel { readonly chatted: number; readonly joined: number; readonly rode: number; readonly answered: number; readonly finished: number }
export interface QuestionRow {
  readonly questionId: string; readonly category: string; readonly level: string; readonly plays: number; readonly asked: number;
  readonly answered: number; readonly correct: number; readonly accuracy: number | null; readonly answerRate: number | null;
  readonly medianMs: number | null; readonly counts: readonly number[]; readonly correctChoice: number; readonly misleading: boolean;
}
export interface GroupRow {
  readonly key: string; readonly questions: number; readonly answered: number; readonly correct: number;
  readonly accuracy: number | null; readonly answerRate: number | null;
}
export interface PlayerRow {
  readonly viewerId: string; readonly nickname: string; readonly handle: string | null; readonly races: number; readonly answers: number; readonly correct: number;
  readonly accuracy: number | null; readonly sessions: number; readonly firstSeen: number; readonly lastSeen: number;
}
export interface SessionRow {
  readonly id: string; readonly startedAt: number; readonly endedAt: number | null; readonly lastAt: number;
  readonly source: string | null; readonly host: string | null; readonly racesFinished: number; readonly racesReset: number;
  readonly viewers: number; readonly answers: number;
}
export interface HourRow { readonly hour: number; readonly comments: number; readonly joins: number; readonly chatters: number }

export type GiftStatus = 'owed' | 'sent' | 'skipped';
export const GIFT_STATUSES: readonly GiftStatus[] = ['owed', 'sent', 'skipped'];
export interface GiftRef { readonly id: number; readonly status: GiftStatus }
export interface LeaderboardRow {
  readonly viewerId: string; readonly nickname: string; readonly handle: string | null; readonly races: number; readonly wins: number;
  readonly podiums: number; readonly bestPlace: number; readonly correct: number; readonly answers: number;
  readonly accuracy: number | null; readonly gifts: number; readonly lastGiftAt: number | null; readonly sessionGift: GiftRef | null;
}
export interface RaceResultRow {
  readonly raceSeq: number; readonly endedAt: number; readonly level: string; readonly rounds: number; readonly riders: number;
  readonly place: number; readonly viewerId: string; readonly nickname: string; readonly handle: string | null;
  readonly correct: number; readonly finishMs: number; readonly gifts: number; readonly lastGiftAt: number | null;
  readonly gift: GiftRef | null;
}
export interface Winners { readonly leaderboard: LeaderboardRow[]; readonly races: RaceResultRow[] }
export interface GiftRow {
  readonly id: number; readonly viewerId: string | null; readonly nickname: string | null; readonly handle: string | null;
  readonly sessionId: string | null; readonly raceSeq: number | null; readonly place: number | null; readonly prize: string;
  readonly note: string; readonly status: GiftStatus; readonly createdAt: number; readonly updatedAt: number;
  readonly sentAt: number | null;
}
export interface NewGift {
  readonly viewerId: string; readonly sessionId: string; readonly raceSeq: number | null;
  readonly prize: string; readonly note: string; readonly status: 'owed' | 'sent';
}

// ---------------------------------------------------------------- validation

type Rec = Record<string, unknown>;
type Kind = 'num' | 'num?' | 'str' | 'str?' | 'bool' | 'nums4' | 'status' | 'giftRef?';
type Shape = Readonly<Record<string, Kind>>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function matches(v: unknown, kind: Kind): boolean {
  switch (kind) {
    case 'num': return isNum(v);
    case 'num?': return v === null || isNum(v);
    case 'str': return typeof v === 'string';
    case 'str?': return v === null || typeof v === 'string';
    case 'bool': return typeof v === 'boolean';
    case 'nums4': return Array.isArray(v) && v.length === 4 && v.every(isNum);
    case 'status': return GIFT_STATUSES.some((s) => s === v);
    case 'giftRef?': return v === null || (isRec(v) && isNum(v.id) && GIFT_STATUSES.some((s) => s === v.status));
  }
}

/** Copies only the declared fields, after checking each one; null if any is wrong. */
function pick<T>(v: unknown, shape: Shape): T | null {
  if (!isRec(v)) return null;
  const out: Rec = {};
  for (const [key, kind] of Object.entries(shape)) {
    if (!matches(v[key], kind)) return null;
    out[key] = v[key];
  }
  return out as T;
}

function list<T>(v: unknown, shape: Shape): T[] | null {
  if (!Array.isArray(v)) return null;
  const rows = v.map((item) => pick<T>(item, shape));
  return rows.every((r): r is T => r !== null) ? rows : null;
}

const OVERVIEW: Shape = {
  sessions: 'num', streamMs: 'num', comments: 'num', uniqueViewers: 'num', returningViewers: 'num', racesFinished: 'num',
  racesReset: 'num', avgRidersPerRace: 'num?', answers: 'num', answerRate: 'num?', accuracy: 'num?',
};
const FUNNEL: Shape = { chatted: 'num', joined: 'num', rode: 'num', answered: 'num', finished: 'num' };
const QUESTION: Shape = {
  questionId: 'str', category: 'str', level: 'str', plays: 'num', asked: 'num', answered: 'num', correct: 'num',
  accuracy: 'num?', answerRate: 'num?', medianMs: 'num?', counts: 'nums4', correctChoice: 'num', misleading: 'bool',
};
const GROUP: Shape = { key: 'str', questions: 'num', answered: 'num', correct: 'num', accuracy: 'num?', answerRate: 'num?' };
const PLAYER: Shape = {
  viewerId: 'str', nickname: 'str', handle: 'str?', races: 'num', answers: 'num', correct: 'num', accuracy: 'num?', sessions: 'num',
  firstSeen: 'num', lastSeen: 'num',
};
const SESSION: Shape = {
  id: 'str', startedAt: 'num', endedAt: 'num?', lastAt: 'num', source: 'str?', host: 'str?', racesFinished: 'num',
  racesReset: 'num', viewers: 'num', answers: 'num',
};
const HOUR: Shape = { hour: 'num', comments: 'num', joins: 'num', chatters: 'num' };
const LEADER: Shape = {
  viewerId: 'str', nickname: 'str', handle: 'str?', races: 'num', wins: 'num', podiums: 'num', bestPlace: 'num', correct: 'num',
  answers: 'num', accuracy: 'num?', gifts: 'num', lastGiftAt: 'num?', sessionGift: 'giftRef?',
};
const RACE_RESULT: Shape = {
  raceSeq: 'num', endedAt: 'num', level: 'str', rounds: 'num', riders: 'num', place: 'num', viewerId: 'str', nickname: 'str',
  handle: 'str?', correct: 'num', finishMs: 'num', gifts: 'num', lastGiftAt: 'num?', gift: 'giftRef?',
};
const GIFT: Shape = {
  id: 'num', viewerId: 'str?', nickname: 'str?', handle: 'str?', sessionId: 'str?', raceSeq: 'num?', place: 'num?',
  prize: 'str', note: 'str', status: 'status', createdAt: 'num', updatedAt: 'num', sentAt: 'num?',
};

export function parseOverview(data: unknown): { overview: Overview; funnel: Funnel } | null {
  if (!isRec(data)) return null;
  const overview = pick<Overview>(data.overview, OVERVIEW);
  const funnel = pick<Funnel>(data.funnel, FUNNEL);
  return overview === null || funnel === null ? null : { overview, funnel };
}
export const parseQuestions = (d: unknown): QuestionRow[] | null => (isRec(d) ? list<QuestionRow>(d.questions, QUESTION) : null);
export const parsePlayers = (d: unknown): PlayerRow[] | null => (isRec(d) ? list<PlayerRow>(d.players, PLAYER) : null);
export const parseSessions = (d: unknown): SessionRow[] | null => (isRec(d) ? list<SessionRow>(d.sessions, SESSION) : null);
export const parseHours = (d: unknown): HourRow[] | null => (isRec(d) ? list<HourRow>(d.hours, HOUR) : null);
export const parseGifts = (d: unknown): GiftRow[] | null => (isRec(d) ? list<GiftRow>(d.gifts, GIFT) : null);
export const parseGift = (d: unknown): GiftRow | null => (isRec(d) ? pick<GiftRow>(d.gift, GIFT) : null);
export function parseWinners(d: unknown): Winners | null {
  if (!isRec(d)) return null;
  const leaderboard = list<LeaderboardRow>(d.leaderboard, LEADER);
  const races = list<RaceResultRow>(d.races, RACE_RESULT);
  return leaderboard === null || races === null ? null : { leaderboard, races };
}

/** TikTok profile link for a stored @handle; null when there is none or it doesn't look like one. */
export function profileUrl(handle: string | null): string | null {
  return handle !== null && /^[A-Za-z0-9._]{1,24}$/.test(handle) ? `https://www.tiktok.com/@${handle}` : null;
}

export function parseGroups(d: unknown): { levels: GroupRow[]; categories: GroupRow[] } | null {
  if (!isRec(d)) return null;
  const levels = list<GroupRow>(d.levels, GROUP);
  const categories = list<GroupRow>(d.categories, GROUP);
  return levels === null || categories === null ? null : { levels, categories };
}

// ---------------------------------------------------------------- fetching

export class StatsUnavailableError extends Error {}

export async function getJson<T>(path: string, parse: (d: unknown) => T | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${STATS_BASE}${path}`);
  } catch {
    throw new StatsUnavailableError('Stats server not reachable. Start it with: npm run server');
  }
  if (!response.ok) throw new Error(`Stats server answered ${response.status} for ${path}`);
  const parsed = parse(await response.json());
  if (parsed === null) throw new Error(`Unexpected stats data from ${path}`);
  return parsed;
}

/** Sends JSON; the server's error text is surfaced so the admin sees why (e.g. a duplicate gift). */
async function sendJson<T>(method: 'POST' | 'DELETE', path: string, body: unknown, parse: (d: unknown) => T | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${STATS_BASE}${path}`, {
      method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StatsUnavailableError('Stats server not reachable. Start it with: npm run server');
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(isRec(data) && typeof data.error === 'string' ? data.error : `Request failed (${response.status})`);
  }
  const parsed = parse(data);
  if (parsed === null) throw new Error(`Unexpected stats data from ${path}`);
  return parsed;
}

export const addGift = (gift: NewGift): Promise<GiftRow> => sendJson('POST', '/stats/gifts', gift, parseGift);
export const updateGift = (id: number, patch: { status?: GiftStatus; prize?: string; note?: string }): Promise<GiftRow> => (
  sendJson('POST', `/stats/gifts/${id}`, patch, parseGift)
);
export const deleteGift = (id: number): Promise<boolean> => (
  sendJson('DELETE', `/stats/gifts/${id}`, undefined, (d) => (isRec(d) && typeof d.deleted === 'boolean' ? d.deleted : null))
);

export async function deleteViewer(viewerId: string): Promise<boolean> {
  const response = await fetch(`${STATS_BASE}/stats/viewers/${encodeURIComponent(viewerId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Delete failed (${response.status})`);
  const body: unknown = await response.json();
  return isRec(body) && body.deleted === true;
}

// ---------------------------------------------------------------- period + formatting

export type Period = 'today' | '7d' | '30d' | 'all';
const DAY = 86_400_000;

export function sinceFor(period: Period, now: number): number | null {
  switch (period) {
    case 'all': return null;
    case '7d': return now - 7 * DAY;
    case '30d': return now - 30 * DAY;
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
  }
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompact = (n: number): string => COMPACT.format(n);
export const formatPercent = (r: number | null): string => (r === null ? '–' : `${Math.round(r * 100)}%`);

export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
