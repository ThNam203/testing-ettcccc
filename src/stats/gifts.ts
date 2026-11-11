import type { Row, SQLInputValue, SQLOutputValue } from 'node:sqlite';

/**
 * Winners and the gift ledger: who placed where, and which prizes the admin has promised or sent.
 * Who gets a gift is the admin's call; this module only records it and shows the history.
 * Type-only imports: Node loads this file directly with type stripping.
 */

export const GIFT_STATUSES = ['owed', 'sent', 'skipped'] as const;
export type GiftStatus = (typeof GIFT_STATUSES)[number];

export interface GiftRef {
  readonly id: number;
  readonly status: GiftStatus;
}

export interface LeaderboardRow {
  readonly viewerId: string;
  readonly nickname: string;
  readonly handle: string | null;
  /** Finished races ridden in this session. */
  readonly races: number;
  readonly wins: number;
  /** Top-3 finishes. */
  readonly podiums: number;
  readonly bestPlace: number;
  /** Correct answers across those races. */
  readonly correct: number;
  readonly answers: number;
  readonly accuracy: number | null;
  /** Gifts owed or sent to this viewer, ever (skipped ones don't count). */
  readonly gifts: number;
  readonly lastGiftAt: number | null;
  /** Latest open gift given for this session as a whole (not one race). */
  readonly sessionGift: GiftRef | null;
}

export interface RaceResultRow {
  readonly raceSeq: number;
  readonly endedAt: number;
  readonly level: string;
  readonly rounds: number;
  readonly riders: number;
  readonly place: number;
  readonly viewerId: string;
  readonly nickname: string;
  readonly handle: string | null;
  readonly correct: number;
  readonly finishMs: number;
  readonly gifts: number;
  readonly lastGiftAt: number | null;
  /** Open gift for this viewer for this race, if any. */
  readonly gift: GiftRef | null;
}

export interface Winners {
  readonly leaderboard: LeaderboardRow[];
  /** Newest race first; riders in finishing order. */
  readonly races: RaceResultRow[];
}

export interface GiftRow {
  readonly id: number;
  /** Null once the viewer's data was deleted. */
  readonly viewerId: string | null;
  readonly nickname: string | null;
  readonly handle: string | null;
  readonly sessionId: string | null;
  readonly raceSeq: number | null;
  readonly place: number | null;
  readonly prize: string;
  readonly note: string;
  readonly status: GiftStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sentAt: number | null;
}

export interface GiftInput {
  readonly viewerId: string;
  readonly sessionId: string | null;
  /** Set with sessionId when the gift is for one race place. */
  readonly raceSeq: number | null;
  readonly prize: string;
  readonly note: string;
  readonly status: 'owed' | 'sent';
}

export interface GiftPatch {
  readonly status?: GiftStatus;
  readonly prize?: string;
  readonly note?: string;
}

export type AddGiftResult = { readonly ok: true; readonly gift: GiftRow } | { readonly ok: false; readonly error: string };
export type UpdateGiftResult =
  | { readonly ok: true; readonly gift: GiftRow }
  | { readonly ok: false; readonly error: string; readonly reason: 'notFound' | 'conflict' };

export interface GiftLedger {
  winners(sessionId: string, maxRaces: number): Winners;
  gifts(since: number, status: GiftStatus | null): GiftRow[];
  addGift(input: GiftInput, now: number): AddGiftResult;
  updateGift(id: number, patch: GiftPatch, now: number): UpdateGiftResult;
  deleteGift(id: number): boolean;
}

export interface Sql {
  run(sql: string, ...params: SQLInputValue[]): number;
  one(sql: string, ...params: SQLInputValue[]): Row;
  all(sql: string, ...params: SQLInputValue[]): Row[];
  /** Id of the last inserted row. */
  lastId(): number;
}

export const GIFT_SCHEMA = `
CREATE TABLE IF NOT EXISTS race_results (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL, viewer_id TEXT NOT NULL, place INTEGER NOT NULL,
  correct INTEGER NOT NULL, finish_ms INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session_id, seq, viewer_id));
CREATE INDEX IF NOT EXISTS results_viewer ON race_results (viewer_id);
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, viewer_id TEXT, session_id TEXT, race_seq INTEGER, place INTEGER,
  prize TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sent_at INTEGER);
CREATE INDEX IF NOT EXISTS gifts_viewer ON gifts (viewer_id);
CREATE INDEX IF NOT EXISTS gifts_session ON gifts (session_id, race_seq);
`;

const num = (v: SQLOutputValue | undefined): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : 0);
const numOrNull = (v: SQLOutputValue | undefined): number | null => (v === null || v === undefined ? null : num(v));
const text = (v: SQLOutputValue | undefined): string => (typeof v === 'string' ? v : '');
const textOrNull = (v: SQLOutputValue | undefined): string | null => (typeof v === 'string' ? v : null);
const statusOf = (v: SQLOutputValue | undefined): GiftStatus => GIFT_STATUSES.find((s) => s === v) ?? 'owed';

/** Gifts that count as "given": skipped ones were never handed out. */
const GIVEN = `SELECT viewer_id, COUNT(*) AS n, MAX(COALESCE(sent_at, created_at)) AS last FROM gifts
  WHERE status != 'skipped' AND viewer_id IS NOT NULL GROUP BY viewer_id`;

const GIFT_SELECT = `SELECT g.*, v.nickname, v.handle FROM gifts g LEFT JOIN viewers v ON v.viewer_id = g.viewer_id`;

function toGift(r: Row): GiftRow {
  return {
    id: num(r.id), viewerId: textOrNull(r.viewer_id), nickname: textOrNull(r.nickname), handle: textOrNull(r.handle),
    sessionId: textOrNull(r.session_id), raceSeq: numOrNull(r.race_seq), place: numOrNull(r.place),
    prize: text(r.prize), note: text(r.note), status: statusOf(r.status),
    createdAt: num(r.created_at), updatedAt: num(r.updated_at), sentAt: numOrNull(r.sent_at),
  };
}

export function createGiftLedger(sql: Sql): GiftLedger {
  const getGift = (id: number): GiftRow | null => {
    const row = sql.one(`${GIFT_SELECT} WHERE g.id = ?`, id);
    return row.id === undefined ? null : toGift(row);
  };

  /**
   * Rule: one open (owed or sent) gift per viewer per race, and one per viewer for a session as a whole.
   * `race_seq IS ?` also matches NULL, so session-wide gifts are covered. Returns the error text, or null if free.
   */
  const openGiftConflict = (viewerId: string, sessionId: string, raceSeq: number | null, exceptId: number): string | null => {
    const taken = sql.one(`SELECT 1 AS ok FROM gifts WHERE viewer_id = ? AND session_id = ? AND race_seq IS ?
      AND status != 'skipped' AND id != ?`, viewerId, sessionId, raceSeq, exceptId);
    if (taken.ok === undefined) return null;
    return raceSeq === null ? 'This viewer already has a gift for this session.' : 'This viewer already has a gift for that race.';
  };

  /** Open (owed or sent) gifts in a session, keyed by `${viewerId}|${raceSeq ?? ''}`; the newest wins. */
  const openGifts = (sessionId: string): Map<string, GiftRef> => new Map(
    sql.all(`SELECT id, viewer_id, race_seq, status FROM gifts WHERE session_id = ? AND status != 'skipped' ORDER BY id`, sessionId)
      .map((r) => [`${text(r.viewer_id)}|${numOrNull(r.race_seq) ?? ''}`, { id: num(r.id), status: statusOf(r.status) }]),
  );

  return {
    winners(sessionId, maxRaces) {
      const open = openGifts(sessionId);
      const leaderboard = sql.all(`WITH rr AS (
          SELECT viewer_id, COUNT(*) AS races, SUM(place = 1) AS wins, SUM(place <= 3) AS podiums, MIN(place) AS best,
            SUM(correct) AS correct FROM race_results WHERE session_id = ? GROUP BY viewer_id),
        ans AS (SELECT viewer_id, COUNT(*) AS n, SUM(correct) AS ok FROM answers WHERE session_id = ? GROUP BY viewer_id),
        given AS (${GIVEN})
        SELECT v.viewer_id, v.nickname, v.handle, rr.races, rr.wins, rr.podiums, rr.best, rr.correct,
          COALESCE(ans.n, 0) AS answers, COALESCE(ans.ok, 0) AS answers_ok, COALESCE(given.n, 0) AS gifts, given.last
        FROM rr JOIN viewers v ON v.viewer_id = rr.viewer_id
        LEFT JOIN ans ON ans.viewer_id = rr.viewer_id
        LEFT JOIN given ON given.viewer_id = rr.viewer_id
        ORDER BY rr.wins DESC, rr.correct DESC, rr.podiums DESC, rr.best ASC, v.nickname ASC`, sessionId, sessionId)
        .map((r): LeaderboardRow => {
          const answers = num(r.answers);
          const viewerId = text(r.viewer_id);
          return {
            viewerId, nickname: text(r.nickname), handle: textOrNull(r.handle), races: num(r.races), wins: num(r.wins),
            podiums: num(r.podiums), bestPlace: num(r.best), correct: num(r.correct), answers,
            accuracy: answers > 0 ? num(r.answers_ok) / answers : null,
            gifts: num(r.gifts), lastGiftAt: numOrNull(r.last), sessionGift: open.get(`${viewerId}|`) ?? null,
          };
        });
      const races = sql.all(`WITH recent AS (
          SELECT seq FROM races WHERE session_id = ? AND outcome = 'finished' ORDER BY seq DESC LIMIT ?),
        given AS (${GIVEN})
        SELECT r.seq, r.ended_at, r.level, r.rounds, r.riders, x.place, x.viewer_id, v.nickname, v.handle, x.correct, x.finish_ms,
          COALESCE(given.n, 0) AS gifts, given.last
        FROM recent JOIN races r ON r.session_id = ? AND r.seq = recent.seq
        JOIN race_results x ON x.session_id = r.session_id AND x.seq = r.seq
        JOIN viewers v ON v.viewer_id = x.viewer_id
        LEFT JOIN given ON given.viewer_id = x.viewer_id
        ORDER BY r.seq DESC, x.place ASC`, sessionId, maxRaces, sessionId)
        .map((r): RaceResultRow => {
          const viewerId = text(r.viewer_id);
          const raceSeq = num(r.seq);
          return {
            raceSeq, endedAt: num(r.ended_at), level: text(r.level), rounds: num(r.rounds), riders: num(r.riders),
            place: num(r.place), viewerId, nickname: text(r.nickname), handle: textOrNull(r.handle), correct: num(r.correct),
            finishMs: num(r.finish_ms), gifts: num(r.gifts), lastGiftAt: numOrNull(r.last),
            gift: open.get(`${viewerId}|${raceSeq}`) ?? null,
          };
        });
      return { leaderboard, races };
    },

    gifts(since, status) {
      // Owed gifts are listed whatever their age: they are promises still to keep.
      const inWindow = `(g.created_at >= ? OR g.status = 'owed')`;
      return status === null
        ? sql.all(`${GIFT_SELECT} WHERE ${inWindow} ORDER BY g.created_at DESC, g.id DESC`, since).map(toGift)
        : sql.all(`${GIFT_SELECT} WHERE ${inWindow} AND g.status = ? ORDER BY g.created_at DESC, g.id DESC`, since, status).map(toGift);
    },

    addGift(input, now) {
      if (sql.one('SELECT 1 AS ok FROM viewers WHERE viewer_id = ?', input.viewerId).ok === undefined) {
        return { ok: false, error: 'Unknown viewer.' };
      }
      let place: number | null = null;
      if (input.raceSeq !== null) {
        const result = sql.one('SELECT place FROM race_results WHERE session_id = ? AND seq = ? AND viewer_id = ?',
          input.sessionId, input.raceSeq, input.viewerId);
        if (result.place === undefined) return { ok: false, error: 'That viewer did not finish that race.' };
        place = num(result.place);
      }
      if (input.sessionId !== null) {
        const conflict = openGiftConflict(input.viewerId, input.sessionId, input.raceSeq, 0);
        if (conflict !== null) return { ok: false, error: conflict };
      }
      sql.run(`INSERT INTO gifts (viewer_id, session_id, race_seq, place, prize, note, status, created_at, updated_at, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.viewerId, input.sessionId, input.raceSeq, place, input.prize, input.note,
      input.status, now, now, input.status === 'sent' ? now : null);
      const gift = getGift(sql.lastId());
      return gift === null ? { ok: false, error: 'Gift was not saved.' } : { ok: true, gift };
    },

    updateGift(id, patch, now) {
      const current = getGift(id);
      if (current === null) return { ok: false, error: 'No such gift.', reason: 'notFound' };
      const status = patch.status ?? current.status;
      if (status !== 'skipped' && current.status === 'skipped' && current.viewerId !== null && current.sessionId !== null) {
        const conflict = openGiftConflict(current.viewerId, current.sessionId, current.raceSeq, id);
        if (conflict !== null) return { ok: false, error: conflict, reason: 'conflict' };
      }
      const sentAt = status === 'sent' ? (current.sentAt ?? now) : null;
      sql.run('UPDATE gifts SET status = ?, prize = ?, note = ?, sent_at = ?, updated_at = ? WHERE id = ?',
        status, patch.prize ?? current.prize, patch.note ?? current.note, sentAt, now, id);
      const gift = getGift(id);
      return gift === null ? { ok: false, error: 'No such gift.', reason: 'notFound' } : { ok: true, gift };
    },

    deleteGift(id) {
      return sql.run('DELETE FROM gifts WHERE id = ?', id) > 0;
    },
  };
}
