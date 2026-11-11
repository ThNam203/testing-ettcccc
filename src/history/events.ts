import type { GameState, Level, StatKey } from '../engine/types';

/**
 * Analytics events: derived from game-state changes in the game tab, stored by the derby server.
 * Type-only imports on purpose: the Node server loads this file directly (type stripping) to validate input.
 * Never contains comment text — only who, what and when.
 */

export type SourceKind = 'local' | 'tiktok';

export type EventBody =
  | { readonly type: 'sessionStarted'; readonly source: SourceKind; readonly host: string | null; readonly settings: string }
  | { readonly type: 'sessionSource'; readonly source: SourceKind; readonly host: string | null }
  | { readonly type: 'sessionEnded' }
  | { readonly type: 'chatSeen'; readonly viewerId: string; readonly nickname: string; readonly handle: string | null }
  | { readonly type: 'viewerJoined'; readonly viewerId: string; readonly nickname: string; readonly as: 'rider' | 'queue' }
  | { readonly type: 'raceStarted'; readonly level: Level; readonly rounds: number; readonly riderIds: readonly string[]; readonly queue: number }
  | {
    readonly type: 'answerLocked'; readonly round: number; readonly questionId: string;
    readonly viewerId: string; readonly nickname: string;
    /** Index in the bank's original choice order (not the shuffled on-screen slot). */
    readonly choice: number; readonly correct: boolean;
    /** Milliseconds after the question opened. */
    readonly ms: number;
  }
  | {
    readonly type: 'questionClosed'; readonly round: number; readonly questionId: string; readonly category: string;
    readonly level: Level; readonly stat: StatKey; readonly riders: number; readonly answered: number; readonly correct: number;
    /** Answers per choice, original bank order. */
    readonly counts: readonly [number, number, number, number];
    readonly correctChoice: number;
  }
  | {
    readonly type: 'raceEnded'; readonly outcome: 'finished' | 'reset'; readonly durationMs: number | null; readonly riders: number;
    /** Finishing order of a finished race (empty for a reset). */
    readonly placings: readonly Placing[];
  };

/** One rider's result in a finished race. */
export interface Placing {
  readonly viewerId: string;
  /** 1 = winner. */
  readonly place: number;
  /** Questions this rider answered correctly in the race. */
  readonly correct: number;
  /** Whole milliseconds from the start to crossing the line. */
  readonly finishMs: number;
}

export type EventType = EventBody['type'];

export interface AnalyticsEvent {
  /** `${sessionId}:${n}` — unique, so a resent batch is never counted twice. */
  readonly id: string;
  readonly sessionId: string;
  /** Wall-clock ms (Date.now) when the event happened. */
  readonly at: number;
  /** Which race in this session (1, 2, …); null for session-level events. */
  readonly raceSeq: number | null;
  readonly body: EventBody;
}

/** Events tied to a race get the race sequence number. */
export const RACE_SCOPED: ReadonlySet<EventType> = new Set(['raceStarted', 'answerLocked', 'questionClosed', 'raceEnded']);

// ---------------------------------------------------------------- derive (pure)

function originalIndex(state: GameState, questionId: string, shownChoice: string): number {
  const source = state.bank.find((q) => q.id === questionId);
  return source === undefined ? -1 : source.choices.indexOf(shownChoice);
}

function joins(prev: GameState, next: GameState): EventBody[] {
  const known = new Set([...prev.racers.map((r) => r.id), ...prev.queue.map((p) => p.id)]);
  const riders = next.phase === 'lobby' ? next.racers : [];
  const fresh = (id: string): boolean => !known.has(id);
  return [
    ...riders.filter((r) => fresh(r.id)).map((r): EventBody => ({ type: 'viewerJoined', viewerId: r.id, nickname: r.name, as: 'rider' })),
    ...next.queue.filter((p) => fresh(p.id)).map((p): EventBody => ({ type: 'viewerJoined', viewerId: p.id, nickname: p.name, as: 'queue' })),
  ];
}

function newAnswers(prev: GameState, next: GameState, now: number): EventBody[] {
  if (next.phase !== 'question') return [];
  const question = next.questions[next.round];
  if (question === undefined) return [];
  const sameQuestion = prev.phase === 'question' && prev.round === next.round;
  const before = sameQuestion ? prev.answers : {};
  return next.racers.flatMap((r): EventBody[] => {
    if (!Object.hasOwn(next.answers, r.id) || Object.hasOwn(before, r.id)) return [];
    const shown = next.answers[r.id] ?? -1;
    return [{
      type: 'answerLocked', round: next.round, questionId: question.id, viewerId: r.id, nickname: r.name,
      choice: originalIndex(next, question.id, question.choices[shown] ?? ''),
      correct: shown === question.answer,
      ms: Math.max(0, Math.round(now - next.phaseStartedAt)),
    }];
  });
}

function questionClosed(next: GameState): EventBody[] {
  const question = next.questions[next.round];
  if (question === undefined) return [];
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  let answered = 0;
  let correct = 0;
  for (const r of next.racers) {
    if (!Object.hasOwn(next.answers, r.id)) continue;
    const shown = next.answers[r.id] ?? -1;
    const original = originalIndex(next, question.id, question.choices[shown] ?? '');
    if (original >= 0 && original < 4) counts[original] = (counts[original] ?? 0) + 1;
    answered += 1;
    if (shown === question.answer) correct += 1;
  }
  return [{
    type: 'questionClosed', round: next.round, questionId: question.id, category: question.category,
    level: question.level, stat: question.stat, riders: next.racers.length, answered, correct, counts,
    correctChoice: originalIndex(next, question.id, question.choices[question.answer] ?? ''),
  }];
}

/** What happened between two game states, as analytics events (in order). */
export function deriveEvents(prev: GameState, next: GameState, now: number): EventBody[] {
  if (prev === next) return [];
  const events: EventBody[] = [...joins(prev, next)];
  if (prev.phase === 'lobby' && next.phase === 'question') {
    events.push({
      type: 'raceStarted', level: next.level, rounds: next.questions.length,
      riderIds: next.racers.map((r) => r.id), queue: next.queue.length,
    });
  }
  events.push(...newAnswers(prev, next, now));
  if (prev.phase === 'question' && next.phase === 'reveal') events.push(...questionClosed(next));
  if (prev.phase === 'race' && next.phase === 'results') {
    // The simulation runs at 60 Hz, so durations are fractional; stats store whole milliseconds.
    const durationMs = next.race === null ? null : Math.round(next.race.durationMs);
    const placings = (next.standings ?? []).map((s): Placing => ({
      viewerId: s.racerId, place: s.place, correct: s.correct, finishMs: Math.round(s.finishTimeMs),
    }));
    events.push({ type: 'raceEnded', outcome: 'finished', durationMs, riders: next.racers.length, placings });
  }
  const midRace = prev.phase === 'question' || prev.phase === 'reveal' || prev.phase === 'race';
  if (midRace && next.phase === 'lobby') {
    events.push({ type: 'raceEnded', outcome: 'reset', durationMs: null, riders: prev.racers.length, placings: [] });
  }
  return events;
}

// ---------------------------------------------------------------- parse (untrusted input at the server)

const MAX_ID = 64;
const MAX_LABEL = 80;
const MAX_SETTINGS = 50_000;
const MAX_RIDERS = 64;
/** Must equal HANDLE_PATTERN in chat/protocol.ts (a test checks this; no runtime import so Node can load this file). */
export const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,24}$/;
const LEVELS: readonly string[] = ['A2', 'B1', 'B2'];
const STATS: readonly string[] = ['speed', 'stamina', 'strength'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => (
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
);
const isHost = (v: unknown): v is string | null => v === null || isStr(v, MAX_ID);
const isSource = (v: unknown): v is SourceKind => v === 'local' || v === 'tiktok';
const isHandle = (v: unknown): v is string | null => v === null || (typeof v === 'string' && HANDLE_PATTERN.test(v));

function parsePlacings(v: unknown): Placing[] | null {
  if (!Array.isArray(v) || v.length > MAX_RIDERS) return null;
  const out: Placing[] = [];
  for (const p of v) {
    if (!isRec(p) || !isStr(p.viewerId, MAX_ID) || !isInt(p.place, 1, MAX_RIDERS) || !isInt(p.correct, 0, 100) || !isInt(p.finishMs)) return null;
    out.push({ viewerId: p.viewerId, place: p.place, correct: p.correct, finishMs: p.finishMs });
  }
  return out;
}

function parseBody(b: Rec): EventBody | null {
  switch (b.type) {
    case 'sessionStarted':
      return isSource(b.source) && isHost(b.host) && typeof b.settings === 'string' && b.settings.length <= MAX_SETTINGS
        ? { type: b.type, source: b.source, host: b.host, settings: b.settings } : null;
    case 'sessionSource':
      return isSource(b.source) && isHost(b.host) ? { type: b.type, source: b.source, host: b.host } : null;
    case 'sessionEnded':
      return { type: b.type };
    case 'chatSeen':
      return isStr(b.viewerId, MAX_ID) && isStr(b.nickname, MAX_ID) && isHandle(b.handle)
        ? { type: b.type, viewerId: b.viewerId, nickname: b.nickname, handle: b.handle } : null;
    case 'viewerJoined':
      return isStr(b.viewerId, MAX_ID) && isStr(b.nickname, MAX_ID) && (b.as === 'rider' || b.as === 'queue')
        ? { type: b.type, viewerId: b.viewerId, nickname: b.nickname, as: b.as } : null;
    case 'raceStarted': {
      const ids = b.riderIds;
      const ok = typeof b.level === 'string' && LEVELS.includes(b.level) && isInt(b.rounds, 1, 100) && isInt(b.queue)
        && Array.isArray(ids) && ids.length <= MAX_RIDERS && ids.every((id) => isStr(id, MAX_ID));
      return ok ? { type: b.type, level: b.level as Level, rounds: b.rounds as number, riderIds: ids as string[], queue: b.queue as number } : null;
    }
    case 'answerLocked':
      return isInt(b.round, 0, 100) && isStr(b.questionId, MAX_ID) && isStr(b.viewerId, MAX_ID) && isStr(b.nickname, MAX_ID)
        && isInt(b.choice, -1, 3) && typeof b.correct === 'boolean' && isInt(b.ms)
        ? {
          type: b.type, round: b.round, questionId: b.questionId, viewerId: b.viewerId, nickname: b.nickname,
          choice: b.choice, correct: b.correct, ms: b.ms,
        } : null;
    case 'questionClosed': {
      const c = b.counts;
      const counts = Array.isArray(c) && c.length === 4 && c.every((n) => isInt(n)) ? (c as [number, number, number, number]) : null;
      const ok = counts !== null && isInt(b.round, 0, 100) && isStr(b.questionId, MAX_ID) && isStr(b.category, MAX_LABEL)
        && typeof b.level === 'string' && LEVELS.includes(b.level) && typeof b.stat === 'string' && STATS.includes(b.stat)
        && isInt(b.riders) && isInt(b.answered) && isInt(b.correct) && isInt(b.correctChoice, -1, 3);
      return ok ? {
        type: b.type, round: b.round as number, questionId: b.questionId as string, category: b.category as string,
        level: b.level as Level, stat: b.stat as StatKey, riders: b.riders as number, answered: b.answered as number,
        correct: b.correct as number, counts, correctChoice: b.correctChoice as number,
      } : null;
    }
    case 'raceEnded': {
      const placings = parsePlacings(b.placings);
      return (b.outcome === 'finished' || b.outcome === 'reset') && (b.durationMs === null || isInt(b.durationMs)) && isInt(b.riders)
        && placings !== null
        ? { type: b.type, outcome: b.outcome, durationMs: b.durationMs, riders: b.riders, placings } : null;
    }
    default:
      return null;
  }
}

export function parseAnalyticsEvent(data: unknown): AnalyticsEvent | null {
  if (!isRec(data) || !isRec(data.body)) return null;
  if (!isStr(data.id, MAX_ID * 2) || !isStr(data.sessionId, MAX_ID) || !isInt(data.at)) return null;
  if (data.raceSeq !== null && !isInt(data.raceSeq, 1)) return null;
  const body = parseBody(data.body);
  return body === null ? null : { id: data.id, sessionId: data.sessionId, at: data.at, raceSeq: data.raceSeq, body };
}
