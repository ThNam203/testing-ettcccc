import { DatabaseSync, type Row, type SQLInputValue, type SQLOutputValue, type StatementSync } from 'node:sqlite';
import type { AnalyticsEvent, EventBody } from '../history/events';
// Explicit .ts: the derby server loads this file in plain Node (type stripping), which needs real file names.
import { GIFT_SCHEMA, createGiftLedger, type AddGiftResult, type GiftInput, type GiftPatch, type GiftRow, type GiftStatus, type UpdateGiftResult, type Winners } from './gifts.ts';

/**
 * Stats database (SQLite file via Node's built-in node:sqlite). Runs in the derby server, not the browser.
 * Only runtime import is node:sqlite, so Node can load this file directly with type stripping.
 * Stores who/what/when for analysis, plus race placings and the admin's gift ledger; never comment text, horse stats or cosmetics.
 */

export type { AddGiftResult, GiftInput, GiftPatch, GiftRow, GiftStatus, UpdateGiftResult, Winners } from './gifts.ts';

export interface StatsFilter {
  /** Only data at or after this wall-clock ms; null = all time. */
  readonly since: number | null;
}

export interface Overview {
  readonly sessions: number;
  readonly streamMs: number;
  readonly comments: number;
  readonly uniqueViewers: number;
  /** Viewers who chatted in 2+ sessions. */
  readonly returningViewers: number;
  readonly racesFinished: number;
  readonly racesReset: number;
  readonly avgRidersPerRace: number | null;
  readonly answers: number;
  /** Answers / (riders x questions asked). */
  readonly answerRate: number | null;
  readonly accuracy: number | null;
}

export interface Funnel {
  readonly chatted: number;
  readonly joined: number;
  readonly rode: number;
  readonly answered: number;
  readonly finished: number;
}

export interface QuestionRow {
  readonly questionId: string;
  readonly category: string;
  readonly level: string;
  readonly plays: number;
  /** Riders who could have answered, summed over plays. */
  readonly asked: number;
  readonly answered: number;
  readonly correct: number;
  readonly accuracy: number | null;
  readonly answerRate: number | null;
  readonly medianMs: number | null;
  /** Answers per choice, original bank order. */
  readonly counts: readonly [number, number, number, number];
  readonly correctChoice: number;
  /** A wrong choice was picked more often than the right one (min 3 answers). */
  readonly misleading: boolean;
}

export interface GroupRow {
  readonly key: string;
  readonly questions: number;
  readonly answered: number;
  readonly correct: number;
  readonly accuracy: number | null;
  readonly answerRate: number | null;
}

export interface PlayerRow {
  readonly viewerId: string;
  readonly nickname: string;
  /** Latest TikTok @handle seen, or null (simulator viewers have none). */
  readonly handle: string | null;
  readonly races: number;
  readonly answers: number;
  readonly correct: number;
  readonly accuracy: number | null;
  readonly sessions: number;
  readonly firstSeen: number;
  readonly lastSeen: number;
}

export interface SessionRow {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly lastAt: number;
  readonly source: string | null;
  readonly host: string | null;
  readonly racesFinished: number;
  readonly racesReset: number;
  readonly viewers: number;
  readonly answers: number;
}

export interface HourRow {
  /** 0–23, server local time. */
  readonly hour: number;
  readonly comments: number;
  readonly joins: number;
  readonly chatters: number;
}

export const EXPORT_TABLES = ['sessions', 'races', 'race_results', 'question_plays', 'answers', 'viewers', 'gifts'] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
const EXPORT_TIME_COLUMN: Readonly<Record<ExportTable, string>> = {
  sessions: 'started_at', races: 'started_at', race_results: 'at', question_plays: 'closed_at', answers: 'at', viewers: 'last_seen',
  gifts: 'created_at',
};

/** How many recent finished races the winners view returns per session. */
export const MAX_WINNER_RACES = 50;

export interface StatsStore {
  ingest(events: readonly AnalyticsEvent[]): { stored: number; duplicates: number };
  overview(filter: StatsFilter): Overview;
  funnel(filter: StatsFilter): Funnel;
  questions(filter: StatsFilter): QuestionRow[];
  levels(filter: StatsFilter): GroupRow[];
  categories(filter: StatsFilter): GroupRow[];
  players(filter: StatsFilter, limit: number): PlayerRow[];
  sessions(limit: number): SessionRow[];
  hours(filter: StatsFilter): HourRow[];
  /** Removes a viewer's personal rows (name, answers, joins, activity, placings). Anonymous totals stay;
   * their gifts stay as date + prize + status, with who and the note removed. */
  deleteViewer(viewerId: string): boolean;
  winners(sessionId: string): Winners;
  gifts(filter: StatsFilter, status: GiftStatus | null): GiftRow[];
  addGift(input: GiftInput, now: number): AddGiftResult;
  updateGift(id: number, patch: GiftPatch, now: number): UpdateGiftResult;
  deleteGift(id: number): boolean;
  exportCsv(table: ExportTable, filter: StatsFilter): string;
  close(): void;
}

const MINUTE = 60_000;
const MISLEADING_MIN_ANSWERS = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS event_log (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER, last_at INTEGER NOT NULL,
  source TEXT, host TEXT, settings TEXT);
CREATE TABLE IF NOT EXISTS viewers (
  viewer_id TEXT PRIMARY KEY, nickname TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, handle TEXT);
CREATE TABLE IF NOT EXISTS races (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  level TEXT, rounds INTEGER, riders INTEGER, queue INTEGER, outcome TEXT NOT NULL DEFAULT 'open', duration_ms INTEGER,
  PRIMARY KEY (session_id, seq));
CREATE TABLE IF NOT EXISTS race_riders (
  session_id TEXT NOT NULL, seq INTEGER NOT NULL, viewer_id TEXT NOT NULL, PRIMARY KEY (session_id, seq, viewer_id));
CREATE TABLE IF NOT EXISTS joins (session_id TEXT NOT NULL, viewer_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS answers (
  session_id TEXT NOT NULL, race_seq INTEGER NOT NULL, round INTEGER NOT NULL, question_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL, choice INTEGER NOT NULL, correct INTEGER NOT NULL, ms INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (session_id, race_seq, round, viewer_id));
CREATE TABLE IF NOT EXISTS question_plays (
  session_id TEXT NOT NULL, race_seq INTEGER NOT NULL, round INTEGER NOT NULL, question_id TEXT NOT NULL,
  category TEXT NOT NULL, level TEXT NOT NULL, stat TEXT NOT NULL, riders INTEGER NOT NULL, answered INTEGER NOT NULL,
  correct INTEGER NOT NULL, c0 INTEGER NOT NULL, c1 INTEGER NOT NULL, c2 INTEGER NOT NULL, c3 INTEGER NOT NULL,
  correct_choice INTEGER NOT NULL, closed_at INTEGER NOT NULL, PRIMARY KEY (session_id, race_seq, round));
CREATE TABLE IF NOT EXISTS room_minutes (
  session_id TEXT NOT NULL, minute INTEGER NOT NULL, comments INTEGER NOT NULL DEFAULT 0, joins INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, minute));
CREATE TABLE IF NOT EXISTS minute_chatters (
  session_id TEXT NOT NULL, minute INTEGER NOT NULL, viewer_id TEXT NOT NULL, PRIMARY KEY (session_id, minute, viewer_id));
CREATE INDEX IF NOT EXISTS answers_question ON answers (question_id);
CREATE INDEX IF NOT EXISTS answers_viewer ON answers (viewer_id);
CREATE INDEX IF NOT EXISTS answers_at ON answers (at);
CREATE INDEX IF NOT EXISTS plays_question ON question_plays (question_id);
CREATE INDEX IF NOT EXISTS chatters_viewer ON minute_chatters (viewer_id);
`;

function num(v: SQLOutputValue | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

function numOrNull(v: SQLOutputValue | undefined): number | null {
  return v === null || v === undefined ? null : num(v);
}

function text(v: SQLOutputValue | undefined): string {
  return typeof v === 'string' ? v : '';
}

function textOrNull(v: SQLOutputValue | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function csvCell(v: SQLOutputValue | undefined): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Uint8Array ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function openStatsStore(path: string): StatsStore {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  db.exec(GIFT_SCHEMA);
  const viewerColumns = db.prepare('PRAGMA table_info(viewers)').all().map((c) => c.name);
  if (!viewerColumns.includes('handle')) db.exec('ALTER TABLE viewers ADD COLUMN handle TEXT'); // files made before @handles

  const cache = new Map<string, StatementSync>();
  const q = (sql: string): StatementSync => {
    const hit = cache.get(sql);
    if (hit !== undefined) return hit;
    const stmt = db.prepare(sql);
    cache.set(sql, stmt);
    return stmt;
  };
  const run = (sql: string, ...params: SQLInputValue[]): number => num(q(sql).run(...params).changes);
  const one = (sql: string, ...params: SQLInputValue[]): Row => q(sql).get(...params) ?? {};
  const all = (sql: string, ...params: SQLInputValue[]): Row[] => q(sql).all(...params);

  const touchSession = (id: string, at: number): void => {
    run('INSERT OR IGNORE INTO sessions (id, started_at, last_at) VALUES (?, ?, ?)', id, at, at);
    run('UPDATE sessions SET last_at = MAX(last_at, ?) WHERE id = ?', at, id);
  };
  /** handle null = this event doesn't carry one; the known handle is kept. */
  const touchViewer = (viewerId: string, nickname: string, at: number, handle: string | null = null): void => {
    run(`INSERT INTO viewers (viewer_id, nickname, first_seen, last_seen, handle) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (viewer_id) DO UPDATE SET
        nickname = CASE WHEN excluded.last_seen >= viewers.last_seen THEN excluded.nickname ELSE viewers.nickname END,
        handle = CASE WHEN excluded.handle IS NOT NULL AND (viewers.handle IS NULL OR excluded.last_seen >= viewers.last_seen)
          THEN excluded.handle ELSE viewers.handle END,
        first_seen = MIN(viewers.first_seen, excluded.first_seen),
        last_seen = MAX(viewers.last_seen, excluded.last_seen)`, viewerId, nickname, at, at, handle);
  };
  const bumpMinute = (sessionId: string, at: number, column: 'comments' | 'joins'): void => {
    const minute = Math.floor(at / MINUTE);
    run('INSERT OR IGNORE INTO room_minutes (session_id, minute) VALUES (?, ?)', sessionId, minute);
    run(`UPDATE room_minutes SET ${column} = ${column} + 1 WHERE session_id = ? AND minute = ?`, sessionId, minute);
  };

  function apply(e: AnalyticsEvent): void {
    const { sessionId: sid, at, raceSeq } = e;
    const body: EventBody = e.body;
    touchSession(sid, at);
    switch (body.type) {
      case 'sessionStarted':
        run('UPDATE sessions SET started_at = MIN(started_at, ?), source = ?, host = ?, settings = ? WHERE id = ?',
          at, body.source, body.host, body.settings, sid);
        return;
      case 'sessionSource':
        run('UPDATE sessions SET source = ?, host = ? WHERE id = ?', body.source, body.host, sid);
        return;
      case 'sessionEnded':
        run('UPDATE sessions SET ended_at = ? WHERE id = ?', at, sid);
        return;
      case 'chatSeen':
        touchViewer(body.viewerId, body.nickname, at, body.handle);
        bumpMinute(sid, at, 'comments');
        run('INSERT OR IGNORE INTO minute_chatters (session_id, minute, viewer_id) VALUES (?, ?, ?)', sid, Math.floor(at / MINUTE), body.viewerId);
        return;
      case 'viewerJoined':
        touchViewer(body.viewerId, body.nickname, at);
        bumpMinute(sid, at, 'joins');
        run('INSERT INTO joins (session_id, viewer_id, at, kind) VALUES (?, ?, ?, ?)', sid, body.viewerId, at, body.as);
        return;
      default:
        break;
    }
    if (raceSeq === null) return; // race-scoped event without a race: nothing to attach it to
    switch (body.type) {
      case 'raceStarted':
        run(`INSERT OR IGNORE INTO races (session_id, seq, started_at, level, rounds, riders, queue)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, sid, raceSeq, at, body.level, body.rounds, body.riderIds.length, body.queue);
        for (const id of body.riderIds) {
          run('INSERT OR IGNORE INTO race_riders (session_id, seq, viewer_id) VALUES (?, ?, ?)', sid, raceSeq, id);
          run('INSERT OR IGNORE INTO viewers (viewer_id, nickname, first_seen, last_seen) VALUES (?, ?, ?, ?)', id, id, at, at);
        }
        return;
      case 'answerLocked':
        touchViewer(body.viewerId, body.nickname, at);
        run(`INSERT OR IGNORE INTO answers (session_id, race_seq, round, question_id, viewer_id, choice, correct, ms, at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, sid, raceSeq, body.round, body.questionId, body.viewerId,
        body.choice, body.correct ? 1 : 0, body.ms, at);
        return;
      case 'questionClosed': {
        const [c0, c1, c2, c3] = body.counts;
        run(`INSERT OR REPLACE INTO question_plays (session_id, race_seq, round, question_id, category, level, stat,
          riders, answered, correct, c0, c1, c2, c3, correct_choice, closed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, sid, raceSeq, body.round, body.questionId,
        body.category, body.level, body.stat, body.riders, body.answered, body.correct, c0, c1, c2, c3, body.correctChoice, at);
        return;
      }
      case 'raceEnded':
        run('UPDATE races SET outcome = ?, ended_at = ?, duration_ms = ? WHERE session_id = ? AND seq = ?',
          body.outcome, at, body.durationMs, sid, raceSeq);
        for (const p of body.placings) {
          run(`INSERT OR REPLACE INTO race_results (session_id, seq, viewer_id, place, correct, finish_ms, at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, sid, raceSeq, p.viewerId, p.place, p.correct, p.finishMs, at);
        }
        return;
      default:
        return;
    }
  }

  const sinceOf = (f: StatsFilter): number => f.since ?? 0;
  const sinceMinute = (f: StatsFilter): number => Math.floor(sinceOf(f) / MINUTE);

  function grouped(column: 'level' | 'category', f: StatsFilter): GroupRow[] {
    return all(`SELECT ${column} AS key, COUNT(*) AS plays, SUM(riders) AS asked, SUM(answered) AS answered, SUM(correct) AS correct
      FROM question_plays WHERE closed_at >= ? GROUP BY ${column} ORDER BY ${column}`, sinceOf(f))
      .map((r) => {
        const answered = num(r.answered);
        const correct = num(r.correct);
        return {
          key: text(r.key), questions: num(r.plays), answered, correct,
          accuracy: ratio(correct, answered), answerRate: ratio(answered, num(r.asked)),
        };
      });
  }

  const ledger = createGiftLedger({ run, one, all, lastId: () => num(one('SELECT last_insert_rowid() AS id').id) });

  const RIDDEN = `SELECT rr.viewer_id, rr.session_id, r.outcome FROM race_riders rr
    JOIN races r ON r.session_id = rr.session_id AND r.seq = rr.seq WHERE r.started_at >= ?`;

  return {
    ingest(events) {
      let stored = 0;
      let duplicates = 0;
      db.exec('BEGIN');
      try {
        for (const e of events) {
          if (run('INSERT OR IGNORE INTO event_log (id, at) VALUES (?, ?)', e.id, e.at) === 0) {
            duplicates += 1;
            continue;
          }
          apply(e);
          stored += 1;
        }
        db.exec('COMMIT');
      } catch (error: unknown) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { stored, duplicates };
    },

    overview(f) {
      const s = sinceOf(f);
      const sm = sinceMinute(f);
      const sessions = one('SELECT COUNT(*) AS n, SUM(COALESCE(ended_at, last_at) - started_at) AS ms FROM sessions WHERE started_at >= ?', s);
      const comments = one('SELECT SUM(comments) AS n FROM room_minutes WHERE minute >= ?', sm);
      const viewers = one('SELECT COUNT(DISTINCT viewer_id) AS n FROM minute_chatters WHERE minute >= ?', sm);
      const returning = one(`SELECT COUNT(*) AS n FROM (SELECT viewer_id FROM minute_chatters WHERE minute >= ?
        GROUP BY viewer_id HAVING COUNT(DISTINCT session_id) >= 2)`, sm);
      const races = one(`SELECT SUM(outcome = 'finished') AS fin, SUM(outcome = 'reset') AS rst, AVG(riders) AS avg
        FROM races WHERE started_at >= ?`, s);
      const answers = one('SELECT COUNT(*) AS n FROM answers WHERE at >= ?', s);
      const plays = one('SELECT SUM(riders) AS asked, SUM(answered) AS answered, SUM(correct) AS correct FROM question_plays WHERE closed_at >= ?', s);
      return {
        sessions: num(sessions.n),
        streamMs: num(sessions.ms),
        comments: num(comments.n),
        uniqueViewers: num(viewers.n),
        returningViewers: num(returning.n),
        racesFinished: num(races.fin),
        racesReset: num(races.rst),
        avgRidersPerRace: numOrNull(races.avg),
        answers: num(answers.n),
        answerRate: ratio(num(plays.answered), num(plays.asked)),
        accuracy: ratio(num(plays.correct), num(plays.answered)),
      };
    },

    funnel(f) {
      const s = sinceOf(f);
      const count = (sql: string, ...p: SQLInputValue[]): number => num(one(sql, ...p).n);
      return {
        chatted: count('SELECT COUNT(DISTINCT viewer_id) AS n FROM minute_chatters WHERE minute >= ?', sinceMinute(f)),
        joined: count('SELECT COUNT(DISTINCT viewer_id) AS n FROM joins WHERE at >= ?', s),
        rode: count(`SELECT COUNT(DISTINCT viewer_id) AS n FROM (${RIDDEN})`, s),
        answered: count('SELECT COUNT(DISTINCT viewer_id) AS n FROM answers WHERE at >= ?', s),
        finished: count(`SELECT COUNT(DISTINCT viewer_id) AS n FROM (${RIDDEN}) WHERE outcome = 'finished'`, s),
      };
    },

    questions(f) {
      const s = sinceOf(f);
      const times = new Map<string, number[]>();
      for (const r of all('SELECT question_id, ms FROM answers WHERE at >= ?', s)) {
        const id = text(r.question_id);
        times.set(id, [...(times.get(id) ?? []), num(r.ms)]);
      }
      return all(`SELECT question_id, MAX(category) AS category, MAX(level) AS level, COUNT(*) AS plays,
          SUM(riders) AS asked, SUM(answered) AS answered, SUM(correct) AS correct,
          SUM(c0) AS c0, SUM(c1) AS c1, SUM(c2) AS c2, SUM(c3) AS c3, MAX(correct_choice) AS correct_choice
        FROM question_plays WHERE closed_at >= ? GROUP BY question_id`, s)
        .map((r): QuestionRow => {
          const id = text(r.question_id);
          const answered = num(r.answered);
          const correct = num(r.correct);
          const counts: [number, number, number, number] = [num(r.c0), num(r.c1), num(r.c2), num(r.c3)];
          const correctChoice = num(r.correct_choice);
          const rightCount = counts[correctChoice] ?? 0;
          const misleading = answered >= MISLEADING_MIN_ANSWERS && counts.some((c, i) => i !== correctChoice && c > rightCount);
          return {
            questionId: id, category: text(r.category), level: text(r.level), plays: num(r.plays), asked: num(r.asked),
            answered, correct, accuracy: ratio(correct, answered), answerRate: ratio(answered, num(r.asked)),
            medianMs: median(times.get(id) ?? []), counts, correctChoice, misleading,
          };
        })
        .sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || b.plays - a.plays);
    },

    levels: (f) => grouped('level', f),
    categories: (f) => grouped('category', f),

    players(f, limit) {
      const s = sinceOf(f);
      const sm = sinceMinute(f);
      return all(`WITH seen AS (
          SELECT viewer_id, session_id FROM minute_chatters WHERE minute >= ?
          UNION SELECT viewer_id, session_id FROM joins WHERE at >= ?
          UNION SELECT viewer_id, session_id FROM answers WHERE at >= ?
          UNION SELECT viewer_id, session_id FROM (${RIDDEN})
        ),
        rides AS (SELECT viewer_id, COUNT(*) AS n FROM (${RIDDEN}) GROUP BY viewer_id),
        ans AS (SELECT viewer_id, COUNT(*) AS n, SUM(correct) AS ok FROM answers WHERE at >= ? GROUP BY viewer_id),
        sess AS (SELECT viewer_id, COUNT(DISTINCT session_id) AS n FROM seen GROUP BY viewer_id)
        SELECT v.viewer_id, v.nickname, v.handle, v.first_seen, v.last_seen,
          COALESCE(rides.n, 0) AS races, COALESCE(ans.n, 0) AS answers, COALESCE(ans.ok, 0) AS correct, sess.n AS sessions
        FROM viewers v JOIN sess ON sess.viewer_id = v.viewer_id
        LEFT JOIN rides ON rides.viewer_id = v.viewer_id
        LEFT JOIN ans ON ans.viewer_id = v.viewer_id
        ORDER BY correct DESC, answers DESC, races DESC, v.last_seen DESC
        LIMIT ?`, sm, s, s, s, s, s, limit)
        .map((r) => {
          const answers = num(r.answers);
          const correct = num(r.correct);
          return {
            viewerId: text(r.viewer_id), nickname: text(r.nickname), handle: textOrNull(r.handle), races: num(r.races), answers, correct,
            accuracy: ratio(correct, answers), sessions: num(r.sessions),
            firstSeen: num(r.first_seen), lastSeen: num(r.last_seen),
          };
        });
    },

    sessions(limit) {
      return all(`SELECT s.id, s.started_at, s.ended_at, s.last_at, s.source, s.host,
          (SELECT COUNT(*) FROM races r WHERE r.session_id = s.id AND r.outcome = 'finished') AS fin,
          (SELECT COUNT(*) FROM races r WHERE r.session_id = s.id AND r.outcome = 'reset') AS rst,
          (SELECT COUNT(*) FROM (SELECT viewer_id FROM minute_chatters WHERE session_id = s.id
            UNION SELECT viewer_id FROM joins WHERE session_id = s.id)) AS viewers,
          (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id) AS answers
        FROM sessions s ORDER BY s.started_at DESC LIMIT ?`, limit)
        .map((r) => ({
          id: text(r.id), startedAt: num(r.started_at), endedAt: numOrNull(r.ended_at), lastAt: num(r.last_at),
          source: textOrNull(r.source), host: textOrNull(r.host), racesFinished: num(r.fin), racesReset: num(r.rst),
          viewers: num(r.viewers), answers: num(r.answers),
        }));
    },

    hours(f) {
      const sm = sinceMinute(f);
      const hourExpr = "CAST(strftime('%H', minute * 60, 'unixepoch', 'localtime') AS INTEGER)";
      const chatters = new Map(all(`SELECT ${hourExpr} AS hour, COUNT(DISTINCT viewer_id) AS n FROM minute_chatters
        WHERE minute >= ? GROUP BY hour`, sm).map((r) => [num(r.hour), num(r.n)]));
      return all(`SELECT ${hourExpr} AS hour, SUM(comments) AS comments, SUM(joins) AS joins FROM room_minutes
        WHERE minute >= ? GROUP BY hour ORDER BY hour`, sm)
        .map((r) => ({ hour: num(r.hour), comments: num(r.comments), joins: num(r.joins), chatters: chatters.get(num(r.hour)) ?? 0 }));
    },

    deleteViewer(viewerId) {
      db.exec('BEGIN');
      try {
        const removed = run('DELETE FROM viewers WHERE viewer_id = ?', viewerId);
        for (const table of ['answers', 'joins', 'minute_chatters', 'race_riders', 'race_results']) {
          run(`DELETE FROM ${table} WHERE viewer_id = ?`, viewerId);
        }
        // The note may hold contact details, so it goes too; date, prize and status keep the gift totals right.
        run(`UPDATE gifts SET viewer_id = NULL, note = '' WHERE viewer_id = ?`, viewerId);
        db.exec('COMMIT');
        return removed > 0;
      } catch (error: unknown) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    winners: (sessionId) => ledger.winners(sessionId, MAX_WINNER_RACES),
    gifts: (f, status) => ledger.gifts(sinceOf(f), status),
    addGift: (input, now) => ledger.addGift(input, now),
    updateGift: (id, patch, now) => ledger.updateGift(id, patch, now),
    deleteGift: (id) => ledger.deleteGift(id),

    exportCsv(table, f) {
      if (!EXPORT_TABLES.includes(table)) throw new Error(`Unknown table ${String(table)}`);
      const stmt = q(`SELECT * FROM ${table} WHERE ${EXPORT_TIME_COLUMN[table]} >= ? ORDER BY ${EXPORT_TIME_COLUMN[table]}`);
      const header = stmt.columns().map((c) => c.name);
      const rows = stmt.all(sinceOf(f)).map((r) => header.map((h) => csvCell(r[h])).join(','));
      return [header.join(','), ...rows].join('\n') + '\n';
    },

    close() {
      db.close();
    },
  };
}
