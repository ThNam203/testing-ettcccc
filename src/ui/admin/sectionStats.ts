import {
  STATS_BASE, StatsUnavailableError, deleteViewer, formatCompact, formatDuration, formatPercent, getJson,
  parseGroups, parseHours, parseOverview, parsePlayers, parseQuestions, parseSessions, sinceFor,
  type Funnel, type GroupRow, type HourRow, type Overview, type Period, type PlayerRow, type QuestionRow, type SessionRow,
} from '../../admin/statsApi';
import type { QuestionSource } from '../../engine/types';
import { el } from '../dom';
import { confirmButton } from './sectionLive';
import { PERIODS, cardWith, dateTime, meterRow, playerCell, table, td, tile, type Notify } from './statsUi';

export type { Notify } from './statsUi';

const AUTO_REFRESH_MS = 20_000;
const EXPORTS = ['sessions', 'races', 'race_results', 'question_plays', 'answers', 'viewers'] as const;

export interface StatsSection {
  readonly root: HTMLElement;
  /** Tab became visible: load now and keep refreshing. */
  show(): void;
  hide(): void;
}

// ---------------------------------------------------------------- renderers

function renderTiles(o: Overview): HTMLElement {
  const grid = el('div', 'tiles');
  const returningShare = o.uniqueViewers > 0 ? o.returningViewers / o.uniqueViewers : null;
  grid.append(
    tile('Sessions', formatCompact(o.sessions), `${formatDuration(o.streamMs)} streamed`),
    tile('Unique viewers', formatCompact(o.uniqueViewers), `${formatCompact(o.comments)} comments`),
    tile('Returning viewers', formatCompact(o.returningViewers), `${formatPercent(returningShare)} of viewers`),
    tile('Races finished', formatCompact(o.racesFinished), `${formatCompact(o.racesReset)} reset`),
    tile('Riders per race', o.avgRidersPerRace === null ? '–' : o.avgRidersPerRace.toFixed(1)),
    tile('Answer rate', formatPercent(o.answerRate), 'riders who answered each question'),
    tile('Accuracy', formatPercent(o.accuracy), `${formatCompact(o.answers)} answers`),
  );
  return grid;
}

function renderFunnel(f: Funnel): HTMLElement {
  const list = el('div', 'meter-list');
  const steps: readonly [string, number][] = [
    ['Chatted', f.chatted], ['Joined or queued', f.joined], ['Rode a race', f.rode], ['Answered a question', f.answered], ['Finished a race', f.finished],
  ];
  for (const [name, n] of steps) {
    const share = f.chatted > 0 ? n / f.chatted : null;
    list.append(meterRow(name, share, `${formatCompact(n)} · ${formatPercent(share)}`));
  }
  return list;
}

function renderGroups(rows: readonly GroupRow[], empty: string): HTMLElement {
  if (rows.length === 0) return el('p', 'empty', empty);
  const list = el('div', 'meter-list');
  for (const r of rows) {
    list.append(meterRow(r.key, r.accuracy, `${formatPercent(r.accuracy)} of ${formatCompact(r.answered)}`,
      `${r.questions} questions asked · answer rate ${formatPercent(r.answerRate)}`));
  }
  return list;
}

function choicesCell(q: QuestionRow, source: QuestionSource | undefined): HTMLTableCellElement {
  const cell = el('td', 'choices-cell');
  q.counts.forEach((count, i) => {
    const label = source?.choices[i] ?? `#${i + 1}`;
    const isRight = i === q.correctChoice;
    const chip = el('span', isRight ? 'choice choice--right' : 'choice', `${label} ${count}`);
    chip.title = isRight ? 'Correct answer' : 'Wrong choice';
    cell.append(chip);
  });
  return cell;
}

function renderQuestions(rows: readonly QuestionRow[], bank: readonly QuestionSource[], onlyFlagged: boolean): HTMLElement {
  const shown = onlyFlagged ? rows.filter((q) => q.misleading) : rows;
  return table(['Question', 'Level', 'Plays', 'Answer rate', 'Accuracy', 'Median time', 'Answers per choice', ''],
    shown.map((q) => {
      const source = bank.find((b) => b.id === q.questionId);
      const row = el('tr');
      const question = el('td', 'q-cell');
      question.append(el('span', 'atable__id', q.questionId), el('span', undefined, source?.prompt ?? '(no longer in the bank)'));
      const accuracy = el('td');
      accuracy.append(meterRow('', q.accuracy, formatPercent(q.accuracy)));
      row.append(question, td(q.level), td(String(q.plays)), td(formatPercent(q.answerRate)), accuracy,
        td(q.medianMs === null ? '–' : `${(q.medianMs / 1000).toFixed(1)}s`), choicesCell(q, source),
        td(q.misleading ? 'Misleading' : '', q.misleading ? 'flag' : undefined));
      return row;
    }), onlyFlagged ? 'No misleading questions in this period.' : 'No questions answered in this period.');
}

function renderPlayers(rows: readonly PlayerRow[], onDelete: (p: PlayerRow) => void): HTMLElement {
  return table(['Name', 'User ID', 'Races', 'Answers', 'Accuracy', 'Sessions', 'Last seen', ''], rows.map((p) => {
    const row = el('tr');
    const actions = el('td', 'atable__actions');
    actions.append(confirmButton('Delete data', 'Confirm delete', 'btn btn--small btn--danger', () => onDelete(p)));
    row.append(playerCell(p.nickname, p.handle), td(p.viewerId, 'atable__id'), td(String(p.races)), td(String(p.answers)),
      td(formatPercent(p.accuracy)), td(String(p.sessions)), td(dateTime(p.lastSeen)), actions);
    return row;
  }), 'No viewers in this period.');
}

function renderSessions(rows: readonly SessionRow[]): HTMLElement {
  return table(['Started', 'Length', 'Source', 'Viewers', 'Races', 'Answers'], rows.map((s) => {
    const row = el('tr');
    const source = s.source === 'tiktok' ? `TikTok @${s.host ?? '?'}` : s.source === 'local' ? 'Simulator' : '–';
    const races = s.racesReset > 0 ? `${s.racesFinished} (+${s.racesReset} reset)` : String(s.racesFinished);
    row.append(td(dateTime(s.startedAt)), td(formatDuration((s.endedAt ?? s.lastAt) - s.startedAt) + (s.endedAt === null ? ' *' : '')),
      td(source), td(String(s.viewers)), td(races), td(String(s.answers)));
    return row;
  }), 'No sessions yet.');
}

function renderHours(rows: readonly HourRow[]): HTMLElement {
  if (rows.length === 0) return el('p', 'empty', 'No activity in this period.');
  const max = Math.max(1, ...rows.map((h) => h.comments));
  const list = el('div', 'meter-list');
  for (const h of rows) {
    const label = `${String(h.hour).padStart(2, '0')}:00`;
    list.append(meterRow(label, h.comments / max, `${formatCompact(h.comments)} comments`,
      `${h.chatters} chatters · ${h.joins} joins`));
  }
  return list;
}

// ---------------------------------------------------------------- section

export function statsSection(bank: readonly QuestionSource[], notify: Notify): StatsSection {
  const root = el('div', 'asection__body');
  let period: Period = '7d';
  let onlyFlagged = false;
  let timer = 0;
  let loading = false;
  let lastQuestions: QuestionRow[] = [];

  // Toolbar
  const toolbar = el('div', 'stats-toolbar');
  const seg = el('div', 'seg');
  const periodButtons = PERIODS.map((p) => {
    const b = el('button', 'seg__btn', p.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      period = p.value;
      void load();
    });
    seg.append(b);
    return { p, b };
  });
  const refresh = el('button', 'btn btn--small', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => void load());
  const updated = el('span', 'stats-toolbar__meta');
  toolbar.append(seg, refresh, updated);
  const error = el('p', 'banner banner--warn');
  error.hidden = true;

  // Content holders
  const tiles = el('div');
  const funnel = el('div');
  const levels = el('div');
  const categories = el('div');
  const questions = el('div');
  const players = el('div');
  const sessions = el('div');
  const hours = el('div');

  const flaggedToggle = el('label', 'inline-check');
  const flaggedBox = el('input');
  flaggedBox.type = 'checkbox';
  flaggedBox.addEventListener('change', () => {
    onlyFlagged = flaggedBox.checked;
    questions.replaceChildren(renderQuestions(lastQuestions, bank, onlyFlagged));
  });
  flaggedToggle.append(flaggedBox, el('span', undefined, 'Only misleading'));

  const exportsBox = el('div', 'export-links');
  const exportLinks = EXPORTS.map((t) => {
    const a = el('a', 'btn btn--small', `${t.replaceAll('_', ' ')}.csv`);
    a.rel = 'noopener';
    exportsBox.append(a);
    return { t, a };
  });

  const pair = el('div', 'stats-pair');
  pair.append(
    cardWith('Accuracy by level', null, levels),
    cardWith('Accuracy by category', null, categories),
  );
  root.append(
    toolbar, error, tiles,
    cardWith('Viewer funnel', 'Share of viewers who chatted that reached each step.', funnel),
    pair,
    cardWith('Questions', 'Hardest first. Misleading: a wrong choice was picked more often than the right one (min. 3 answers). Consider rewording or switching these off.', questions, flaggedToggle),
    cardWith('Players', 'Delete data removes a viewer’s name, answers and activity. Anonymous totals stay.', players),
    cardWith('Sessions', 'Newest first. * = still running or closed without saying goodbye.', sessions),
    cardWith('Activity by hour', 'Comments per hour of the day (this computer’s time zone).', hours),
    cardWith('Export', 'Download raw tables as CSV for the selected period.', exportsBox),
  );

  async function removePlayer(p: PlayerRow): Promise<void> {
    try {
      const deleted = await deleteViewer(p.viewerId);
      notify(deleted, deleted ? `Deleted stored data for ${p.nickname}.` : 'That viewer was already gone.');
      await load();
    } catch (e: unknown) {
      notify(false, e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    for (const { p, b } of periodButtons) b.setAttribute('aria-selected', String(p.value === period));
    const since = sinceFor(period, Date.now());
    const q = since === null ? '' : `?since=${since}`;
    for (const { t, a } of exportLinks) a.href = `${STATS_BASE}/stats/export/${t}.csv${q}`;
    try {
      const [ov, qs, gr, pl, se, hr] = await Promise.all([
        getJson(`/stats/overview${q}`, parseOverview),
        getJson(`/stats/questions${q}`, parseQuestions),
        getJson(`/stats/groups${q}`, parseGroups),
        getJson(`/stats/players${q}${q ? '&' : '?'}limit=50`, parsePlayers),
        getJson('/stats/sessions?limit=20', parseSessions),
        getJson(`/stats/hours${q}`, parseHours),
      ]);
      lastQuestions = qs;
      tiles.replaceChildren(renderTiles(ov.overview));
      funnel.replaceChildren(renderFunnel(ov.funnel));
      levels.replaceChildren(renderGroups(gr.levels, 'No answers yet.'));
      categories.replaceChildren(renderGroups(gr.categories, 'No answers yet.'));
      questions.replaceChildren(renderQuestions(qs, bank, onlyFlagged));
      players.replaceChildren(renderPlayers(pl, (p) => void removePlayer(p)));
      sessions.replaceChildren(renderSessions(se));
      hours.replaceChildren(renderHours(hr));
      error.hidden = true;
      updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e: unknown) {
      error.hidden = false;
      error.textContent = e instanceof StatsUnavailableError ? e.message : `Could not load stats: ${e instanceof Error ? e.message : 'unknown error'}`;
    } finally {
      loading = false;
    }
  }

  return {
    root,
    show() {
      void load();
      window.clearInterval(timer);
      timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    },
    hide() {
      window.clearInterval(timer);
    },
  };
}
