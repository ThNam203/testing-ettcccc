/**
 * Routing and query parsing for the local derby server (scripts/derby-server.mjs).
 * No runtime imports: Node loads this file directly with type stripping.
 */
import type { GiftInput, GiftPatch, GiftStatus } from './gifts';

export type ExportName = 'sessions' | 'races' | 'race_results' | 'question_plays' | 'answers' | 'viewers' | 'gifts';
const EXPORTS: readonly ExportName[] = ['sessions', 'races', 'race_results', 'question_plays', 'answers', 'viewers', 'gifts'];

export type Route =
  | { readonly kind: 'health' }
  | { readonly kind: 'sse' }
  | { readonly kind: 'ingest' }
  | { readonly kind: 'overview' }
  | { readonly kind: 'questions' }
  | { readonly kind: 'groups' }
  | { readonly kind: 'players' }
  | { readonly kind: 'sessions' }
  | { readonly kind: 'hours' }
  | { readonly kind: 'export'; readonly table: ExportName }
  | { readonly kind: 'deleteViewer'; readonly viewerId: string }
  | { readonly kind: 'winners' }
  | { readonly kind: 'gifts' }
  | { readonly kind: 'giftCreate' }
  | { readonly kind: 'giftUpdate'; readonly giftId: number }
  | { readonly kind: 'giftDelete'; readonly giftId: number }
  | { readonly kind: 'preflight' };

const GET_ROUTES: Readonly<Record<string, Route>> = {
  '/health': { kind: 'health' },
  '/events': { kind: 'sse' },
  '/stats/overview': { kind: 'overview' },
  '/stats/questions': { kind: 'questions' },
  '/stats/groups': { kind: 'groups' },
  '/stats/players': { kind: 'players' },
  '/stats/sessions': { kind: 'sessions' },
  '/stats/hours': { kind: 'hours' },
  '/stats/winners': { kind: 'winners' },
  '/stats/gifts': { kind: 'gifts' },
};

const VIEWER_PREFIX = '/stats/viewers/';
const EXPORT_PATTERN = /^\/stats\/export\/([a-z_]+)\.csv$/;
const MAX_VIEWER_ID = 64;
const GIFT_PATTERN = /^\/stats\/gifts\/([1-9]\d{0,12})$/;

function giftIdOf(path: string): number | null {
  const id = GIFT_PATTERN.exec(path)?.[1];
  return id === undefined ? null : Number(id);
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function routeOf(method: string | undefined, path: string): Route | null {
  if (method === 'OPTIONS') return { kind: 'preflight' };
  if (method === 'POST') {
    if (path === '/history/events') return { kind: 'ingest' };
    if (path === '/stats/gifts') return { kind: 'giftCreate' };
    const giftId = giftIdOf(path);
    return giftId === null ? null : { kind: 'giftUpdate', giftId };
  }
  if (method === 'DELETE') {
    const giftId = giftIdOf(path);
    if (giftId !== null) return { kind: 'giftDelete', giftId };
    if (!path.startsWith(VIEWER_PREFIX)) return null;
    const viewerId = decode(path.slice(VIEWER_PREFIX.length));
    return viewerId === null || viewerId === '' || viewerId.length > MAX_VIEWER_ID ? null : { kind: 'deleteViewer', viewerId };
  }
  if (method !== 'GET') return null;
  if (Object.hasOwn(GET_ROUTES, path)) return GET_ROUTES[path] ?? null;
  const name = EXPORT_PATTERN.exec(path)?.[1];
  const table = EXPORTS.find((t) => t === name);
  return table === undefined ? null : { kind: 'export', table };
}

export function parseSince(value: string | null): number | null {
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

export function parseLimit(value: string | null, fallback: number, max: number): number {
  if (value === null || !/^\d{1,6}$/.test(value)) return fallback;
  const n = Number(value);
  return n <= 0 ? fallback : Math.min(n, max);
}

/** Host header must name this machine: blocks DNS-rebinding pages from reaching the local server. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

// ---------------------------------------------------------------- gift request bodies (untrusted)

export const GIFT_LIMITS = { prize: 120, note: 500, id: 64 } as const;
const STATUSES: readonly GiftStatus[] = ['owed', 'sent', 'skipped'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trimmed text within [min, max] characters, or null. */
function textIn(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
}

export function parseGiftStatus(v: unknown): GiftStatus | null {
  return STATUSES.find((s) => s === v) ?? null;
}

export function parseGiftCreate(data: unknown): GiftInput | null {
  if (!isRec(data)) return null;
  const viewerId = textIn(data.viewerId, 1, GIFT_LIMITS.id);
  const prize = textIn(data.prize, 1, GIFT_LIMITS.prize);
  const note = data.note === undefined ? '' : textIn(data.note, 0, GIFT_LIMITS.note);
  const sessionId = data.sessionId === null ? null : textIn(data.sessionId, 1, GIFT_LIMITS.id);
  const raceSeq = data.raceSeq === null ? null
    : typeof data.raceSeq === 'number' && Number.isInteger(data.raceSeq) && data.raceSeq >= 1 ? data.raceSeq : undefined;
  const status = data.status === 'owed' || data.status === 'sent' ? data.status : null;
  if (viewerId === null || prize === null || note === null || status === null || raceSeq === undefined) return null;
  if (data.sessionId !== null && sessionId === null) return null;
  if (raceSeq !== null && sessionId === null) return null; // a race only means something inside a session
  return { viewerId, sessionId, raceSeq, prize, note, status };
}

export function parseGiftPatch(data: unknown): GiftPatch | null {
  if (!isRec(data)) return null;
  const patch: { status?: GiftStatus; prize?: string; note?: string } = {};
  if (data.status !== undefined) {
    const status = parseGiftStatus(data.status);
    if (status === null) return null;
    patch.status = status;
  }
  if (data.prize !== undefined) {
    const prize = textIn(data.prize, 1, GIFT_LIMITS.prize);
    if (prize === null) return null;
    patch.prize = prize;
  }
  if (data.note !== undefined) {
    const note = textIn(data.note, 0, GIFT_LIMITS.note);
    if (note === null) return null;
    patch.note = note;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}
