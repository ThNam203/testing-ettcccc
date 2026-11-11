import {
  STATS_BASE, StatsUnavailableError, addGift, deleteGift, formatPercent, getJson, parseGifts, parseSessions, parseWinners,
  sinceFor, updateGift,
  type GiftRef, type GiftRow, type GiftStatus, type LeaderboardRow, type Period, type RaceResultRow, type SessionRow, type Winners,
} from '../../admin/statsApi';
import { el } from '../dom';
import { confirmButton } from './sectionLive';
import { PERIODS, button, cardWith, dateTime, playerCell, table, td, tile, type Notify } from './statsUi';

/**
 * Winners & gifts: session leaderboard and race placings to choose prize winners from, and a ledger of
 * gifts owed / sent. Who gets a gift is the admin's decision; the tab shows the numbers and remembers what was given.
 */

const DAY = 86_400_000;
/** A viewer gifted within this window is highlighted, so prizes get spread around. */
const RECENT_GIFT_MS = 7 * DAY;
const MAX_SESSIONS = 50;
const STATUS_LABEL: Readonly<Record<GiftStatus, string>> = { owed: 'Owed', sent: 'Sent', skipped: 'Skipped' };
const LEDGER_FILTERS: readonly { value: GiftStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' }, { value: 'owed', label: 'Owed' }, { value: 'sent', label: 'Sent' }, { value: 'skipped', label: 'Skipped' },
];

export interface GiftsSection {
  readonly root: HTMLElement;
  show(): void;
  hide(): void;
}

interface GiftTarget {
  readonly viewerId: string;
  readonly nickname: string;
  readonly raceSeq: number | null;
}

// ---------------------------------------------------------------- cells

function ago(ms: number, now: number): string {
  const days = Math.floor((now - ms) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

function pastGiftsCell(gifts: number, lastGiftAt: number | null, now: number): HTMLTableCellElement {
  if (gifts === 0 || lastGiftAt === null) return td('–');
  const recent = now - lastGiftAt < RECENT_GIFT_MS;
  const cell = td(`${gifts} · last ${ago(lastGiftAt, now)}`, recent ? 'flag' : undefined);
  if (recent) cell.title = 'Got a gift in the last 7 days';
  return cell;
}

function statusChip(status: GiftStatus): HTMLElement {
  return el('span', `gift-chip gift-chip--${status}`, STATUS_LABEL[status]);
}

function sessionLabel(s: SessionRow): string {
  const source = s.source === 'tiktok' ? `TikTok @${s.host ?? '?'}` : s.source === 'local' ? 'Simulator' : 'Unknown source';
  return `${dateTime(s.startedAt)} · ${source} · ${s.racesFinished} race${s.racesFinished === 1 ? '' : 's'}`;
}

function giftForLabel(g: GiftRow): string {
  if (g.raceSeq !== null) return `Race ${g.raceSeq}${g.place === null ? '' : `, place ${g.place}`}`;
  return g.sessionId === null ? '–' : 'Whole session';
}

// ---------------------------------------------------------------- section

export function giftsSection(notify: Notify): GiftsSection {
  const root = el('div', 'asection__body');
  let sessions: SessionRow[] = [];
  let sessionId: string | null = null;
  let winners: Winners = { leaderboard: [], races: [] };
  /** Session the shown winners belong to. Gifts use this, never the live select value, so they can't land on another session. */
  let winnersSession: string | null = null;
  let period: Period = '30d';
  let statusFilter: GiftStatus | 'all' = 'all';
  /** Row whose "Give gift" form is open: `${viewerId}|${raceSeq ?? ''}`. */
  let openForm: string | null = null;
  /** What was typed in the open form, so a re-render (refresh, another action) doesn't wipe it. */
  let draft = { prize: '', note: '', status: 'owed' as 'owed' | 'sent' };
  let saving = false;
  let loading = false;
  /** A load was asked for while one was running: run once more when it finishes, so nothing shows stale data. */
  let reloadQueued = false;

  // Toolbar
  const toolbar = el('div', 'stats-toolbar');
  const sessionSelect = el('select', 'select');
  sessionSelect.setAttribute('aria-label', 'Session');
  sessionSelect.addEventListener('change', () => {
    sessionId = sessionSelect.value || null;
    openGiftForm(null);
    void load();
  });
  const updated = el('span', 'stats-toolbar__meta');
  toolbar.append(el('span', 'stats-toolbar__label', 'Session'), sessionSelect, button('Refresh', 'btn btn--small', () => void load()), updated);
  const error = el('p', 'banner banner--warn');
  error.hidden = true;

  const tiles = el('div', 'tiles');
  const leaderboardBox = el('div');
  const racesBox = el('div');
  const ledgerBox = el('div');

  // Ledger controls
  const ledgerControls = el('div', 'ledger-controls');
  const seg = el('div', 'seg');
  const periodButtons = PERIODS.map((p) => {
    const b = button(p.label, 'seg__btn', () => {
      period = p.value;
      void load();
    });
    seg.append(b);
    return { p, b };
  });
  const statusSelect = el('select', 'select select--small');
  statusSelect.setAttribute('aria-label', 'Gift status');
  for (const f of LEDGER_FILTERS) statusSelect.append(new Option(f.label, f.value));
  statusSelect.addEventListener('change', () => {
    statusFilter = LEDGER_FILTERS.find((f) => f.value === statusSelect.value)?.value ?? 'all';
    render(); // filtering is local; the tiles stay on the full list
  });
  const csv = el('a', 'btn btn--small', 'gifts.csv');
  csv.rel = 'noopener';
  ledgerControls.append(seg, statusSelect, csv);

  root.append(
    toolbar, error, tiles,
    cardWith('Session leaderboard', 'Ranked by wins, then correct answers, top-3 finishes and best place. Past gifts counts every gift the viewer was ever given; highlighted = within 7 days.', leaderboardBox),
    cardWith('Races in this session', 'Newest first, riders in finishing order. Give a gift for a specific place here.', racesBox),
    cardWith('Gift ledger', 'Everything promised or handed out. Change the status once a prize is sent. Contact winners by TikTok DM; keep phone numbers and addresses out of the notes.', ledgerBox, ledgerControls),
  );

  // ---- actions

  async function act(work: () => Promise<string>): Promise<void> {
    try {
      notify(true, await work());
      await load();
    } catch (e: unknown) {
      notify(false, e instanceof Error ? e.message : 'Request failed');
      render(); // put edited inputs back to the saved values so nothing looks saved that isn't
    }
  }

  const openGiftForm = (key: string | null): void => {
    openForm = key;
    draft = { prize: '', note: '', status: 'owed' };
  };

  function giftFormRow(target: GiftTarget, columns: number): HTMLTableRowElement {
    const row = el('tr', 'gift-form-row');
    const cell = el('td');
    cell.colSpan = columns;
    const form = el('form', 'gift-form');
    const prize = el('input', 'field__text');
    prize.placeholder = 'Prize, e.g. 50k voucher';
    prize.maxLength = 120;
    prize.required = true;
    prize.value = draft.prize;
    const note = el('input', 'field__text');
    note.placeholder = 'Note (optional)';
    note.maxLength = 500;
    note.value = draft.note;
    const status = el('select', 'select select--small');
    status.append(new Option('Owed', 'owed', false, draft.status === 'owed'), new Option('Already sent', 'sent', false, draft.status === 'sent'));
    const save = el('button', 'btn btn--small btn--primary', saving ? 'Saving…' : 'Save gift');
    save.type = 'submit';
    save.disabled = saving;
    const keep = (): void => {
      draft = { prize: prize.value, note: note.value, status: status.value === 'sent' ? 'sent' : 'owed' };
    };
    form.addEventListener('input', keep);
    form.append(el('span', 'gift-form__who', `Gift for ${target.nickname}`), prize, note, status, save,
      button('Cancel', 'btn btn--small', () => {
        openGiftForm(null);
        render();
      }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saving || winnersSession === null) return; // a double click sends one request
      keep();
      const session = winnersSession;
      const chosen = draft.status;
      saving = true;
      save.disabled = true;
      void act(async () => {
        try {
          await addGift({ viewerId: target.viewerId, sessionId: session, raceSeq: target.raceSeq, prize: draft.prize, note: draft.note, status: chosen });
        } finally {
          saving = false;
        }
        openGiftForm(null);
        return `Gift saved for ${target.nickname}.`;
      });
    });
    cell.append(form);
    row.append(cell);
    if (draft.prize === '') window.setTimeout(() => prize.focus(), 0); // only when the form first opens
    return row;
  }

  function giftCell(target: GiftTarget, gift: GiftRef | null): HTMLTableCellElement {
    const cell = el('td', 'atable__actions');
    if (gift !== null) {
      cell.append(statusChip(gift.status));
      return cell;
    }
    cell.append(button('Give gift', 'btn btn--small', () => {
      openGiftForm(`${target.viewerId}|${target.raceSeq ?? ''}`);
      render();
    }));
    return cell;
  }

  /** Data rows, each followed by its open gift form (if any). */
  function withForms<T>(rows: readonly T[], target: (r: T) => GiftTarget, build: (r: T) => HTMLTableRowElement, columns: number): HTMLTableRowElement[] {
    return rows.flatMap((r) => {
      const t = target(r);
      const isOpen = openForm === `${t.viewerId}|${t.raceSeq ?? ''}`;
      return isOpen ? [build(r), giftFormRow(t, columns)] : [build(r)];
    });
  }

  // ---- renderers

  function renderLeaderboard(rows: readonly LeaderboardRow[], now: number): HTMLElement {
    const headers = ['#', 'Player', 'Races', 'Wins', 'Top 3', 'Best', 'Correct', 'Accuracy', 'Past gifts', 'Session gift'];
    const target = (r: LeaderboardRow): GiftTarget => ({ viewerId: r.viewerId, nickname: r.nickname, raceSeq: null });
    return table(headers, withForms(rows, target, (r) => {
      const row = el('tr');
      row.append(td(String(rows.indexOf(r) + 1)), playerCell(r.nickname, r.handle), td(String(r.races)), td(String(r.wins)),
        td(String(r.podiums)), td(String(r.bestPlace)), td(String(r.correct)), td(formatPercent(r.accuracy)),
        pastGiftsCell(r.gifts, r.lastGiftAt, now), giftCell(target(r), r.sessionGift));
      return row;
    }, headers.length), 'No finished races in this session.');
  }

  function renderRaces(rows: readonly RaceResultRow[], now: number): HTMLElement {
    if (rows.length === 0) return el('p', 'empty', 'No finished races in this session.');
    const box = el('div', 'race-list');
    const seqs = [...new Set(rows.map((r) => r.raceSeq))];
    const headers = ['Place', 'Player', 'Correct', 'Time', 'Past gifts', 'Gift'];
    for (const seq of seqs) {
      const riders = rows.filter((r) => r.raceSeq === seq);
      const first = riders[0];
      if (first === undefined) continue;
      const head = el('h3', 'race-list__title', `Race ${seq} · ${dateTime(first.endedAt)} · ${first.level} · ${first.riders} rider${first.riders === 1 ? '' : 's'}`);
      const target = (r: RaceResultRow): GiftTarget => ({ viewerId: r.viewerId, nickname: r.nickname, raceSeq: r.raceSeq });
      box.append(head, table(headers, withForms(riders, target, (r) => {
        const row = el('tr');
        row.append(td(String(r.place), r.place === 1 ? 'place place--first' : 'place'), playerCell(r.nickname, r.handle),
          td(`${r.correct}/${r.rounds}`), td(`${(r.finishMs / 1000).toFixed(1)}s`), pastGiftsCell(r.gifts, r.lastGiftAt, now),
          giftCell(target(r), r.gift));
        return row;
      }, headers.length), ''));
    }
    return box;
  }

  function editableText(value: string, max: number, label: string, save: (v: string) => void): HTMLTableCellElement {
    const cell = el('td');
    const input = el('input', 'field__text field__text--cell');
    input.value = value;
    input.maxLength = max;
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => save(input.value));
    cell.append(input);
    return cell;
  }

  function renderLedger(rows: readonly GiftRow[]): HTMLElement {
    return table(['Given', 'Player', 'For', 'Prize', 'Note', 'Status', ''], rows.map((g) => {
      const row = el('tr');
      const statusCell = el('td');
      const select = el('select', 'select select--small');
      select.setAttribute('aria-label', 'Status');
      for (const s of ['owed', 'sent', 'skipped'] as const) select.append(new Option(STATUS_LABEL[s], s, false, s === g.status));
      select.addEventListener('change', () => {
        const next = ['owed', 'sent', 'skipped'].find((s): s is GiftStatus => s === select.value);
        if (next !== undefined) void act(async () => { await updateGift(g.id, { status: next }); return `Marked ${STATUS_LABEL[next].toLowerCase()}.`; });
      });
      statusCell.append(select);
      if (g.sentAt !== null) statusCell.append(el('span', 'gift-sent-at', dateTime(g.sentAt)));
      const actions = el('td', 'atable__actions');
      actions.append(confirmButton('Delete', 'Confirm delete', 'btn btn--small btn--danger', () => void act(async () => {
        await deleteGift(g.id);
        return 'Gift removed from the ledger.';
      })));
      row.append(td(dateTime(g.createdAt)), playerCell(g.nickname, g.handle), td(giftForLabel(g)),
        editableText(g.prize, 120, 'Prize', (v) => {
          if (v.trim() === '') { notify(false, 'Prize cannot be empty.'); return; }
          void act(async () => { await updateGift(g.id, { prize: v }); return 'Prize updated.'; });
        }),
        editableText(g.note, 500, 'Note', (v) => void act(async () => { await updateGift(g.id, { note: v }); return 'Note saved.'; })),
        statusCell, actions);
      return row;
    }), 'No gifts in this period.');
  }

  /** Every gift in the period plus all still-owed ones (the server keeps owed gifts regardless of age). */
  let ledger: GiftRow[] = [];
  function render(): void {
    const now = Date.now();
    // Tiles ignore the status filter: "owed" must never read 0 just because the table shows sent gifts.
    const owed = ledger.filter((g) => g.status === 'owed').length;
    const sent = ledger.filter((g) => g.status === 'sent').length;
    const people = new Set(ledger.filter((g) => g.status !== 'skipped' && g.viewerId !== null).map((g) => g.viewerId)).size;
    tiles.replaceChildren(
      tile('Gifts owed', String(owed), 'promised, not sent yet (any date)'),
      tile('Gifts sent', String(sent), 'in the ledger period'),
      tile('Viewers gifted', String(people), 'owed or sent'),
    );
    leaderboardBox.replaceChildren(renderLeaderboard(winners.leaderboard, now));
    racesBox.replaceChildren(renderRaces(winners.races, now));
    ledgerBox.replaceChildren(renderLedger(statusFilter === 'all' ? ledger : ledger.filter((g) => g.status === statusFilter)));
  }

  function fillSessions(): void {
    if (sessionId === null || !sessions.some((s) => s.id === sessionId)) {
      sessionId = (sessions.find((s) => s.racesFinished > 0) ?? sessions[0])?.id ?? null;
    }
    sessionSelect.replaceChildren(...sessions.map((s) => new Option(sessionLabel(s), s.id, false, s.id === sessionId)));
    if (sessions.length === 0) sessionSelect.append(new Option('No sessions yet', ''));
  }

  async function load(): Promise<void> {
    if (loading) {
      reloadQueued = true;
      return;
    }
    loading = true;
    try {
      do {
        reloadQueued = false;
        await loadOnce();
      } while (reloadQueued);
    } finally {
      loading = false;
    }
  }

  async function loadOnce(): Promise<void> {
    for (const { p, b } of periodButtons) b.setAttribute('aria-selected', String(p.value === period));
    const since = sinceFor(period, Date.now());
    const query = since === null ? '' : `?since=${since}`;
    csv.href = `${STATS_BASE}/stats/export/gifts.csv${since === null ? '' : `?since=${since}`}`;
    try {
      sessions = await getJson(`/stats/sessions?limit=${MAX_SESSIONS}`, parseSessions);
      fillSessions();
      const session = sessionId;
      const [w, g] = await Promise.all([
        session === null ? Promise.resolve<Winners>({ leaderboard: [], races: [] })
          : getJson(`/stats/winners?session=${encodeURIComponent(session)}`, parseWinners),
        getJson(`/stats/gifts${query}`, parseGifts),
      ]);
      winners = w;
      winnersSession = session;
      ledger = g;
      render();
      error.hidden = true;
      updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (e: unknown) {
      error.hidden = false;
      error.textContent = e instanceof StatsUnavailableError ? e.message : `Could not load winners: ${e instanceof Error ? e.message : 'unknown error'}`;
    }
  }

  return {
    root,
    show() {
      void load();
    },
    hide() {
      openGiftForm(null);
    },
  };
}
