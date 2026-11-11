import type { AdminCommand, AdminSnapshot, LivePlayer, LiveRacer, LiveSessionRow } from '../../admin/protocol';
import { STAT_KEYS } from '../../engine/config';
import { el } from '../dom';
import { STAT_SHORT } from '../labels';

export type Send = (command: AdminCommand) => Promise<boolean>;

/** Plain operator wording (the game screen uses viewer-facing labels). */
const PHASE_NAME: Readonly<Record<AdminSnapshot['live']['phase'], string>> = {
  lobby: 'Lobby',
  question: 'Question',
  reveal: 'Answer shown',
  race: 'Racing',
  results: 'Results',
};

const CONFIRM_MS = 4_000;

/** Button that needs a second click within a few seconds (no browser dialogs). */
export function confirmButton(label: string, confirmLabel: string, className: string, onConfirm: () => void): HTMLButtonElement {
  const button = el('button', className, label);
  button.type = 'button';
  let armedUntil = 0;
  let timer = 0;
  button.addEventListener('click', () => {
    const now = performance.now();
    if (now < armedUntil) {
      armedUntil = 0;
      window.clearTimeout(timer);
      button.textContent = label;
      button.classList.remove('btn--armed');
      onConfirm();
      return;
    }
    armedUntil = now + CONFIRM_MS;
    button.textContent = confirmLabel;
    button.classList.add('btn--armed');
    timer = window.setTimeout(() => {
      button.textContent = label;
      button.classList.remove('btn--armed');
    }, CONFIRM_MS);
  });
  return button;
}

function actionButton(label: string, title: string, onClick: () => void, className = 'btn btn--small'): HTMLButtonElement {
  const button = el('button', className, label);
  button.type = 'button';
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

function table(headers: readonly string[], rows: readonly HTMLTableRowElement[], empty: string): HTMLElement {
  if (rows.length === 0) return el('p', 'empty', empty);
  const node = el('table', 'atable');
  const head = el('tr');
  headers.forEach((h) => head.append(el('th', undefined, h)));
  node.append(el('thead'), el('tbody'));
  node.tHead?.append(head);
  node.tBodies[0]?.append(...rows);
  const scroll = el('div', 'atable__scroll');
  scroll.append(node);
  return scroll;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  return el('td', className, text);
}

function racerRow(r: LiveRacer, send: Send): HTMLTableRowElement {
  const row = el('tr');
  const lane = cell(String(r.lane + 1), 'atable__lane');
  lane.style.setProperty('--silk', r.color);
  const stats = STAT_KEYS.map((k) => `${STAT_SHORT[k]} ${r.stats[k]}`).join(' · ');
  const actions = el('td', 'atable__actions');
  actions.append(
    actionButton('Kick', 'Remove from this race. They can join again later.', () => void send({ type: 'kick', userId: r.id })),
    actionButton('Block', 'Remove and ignore all their chat from now on.', () => void send({ type: 'block', userId: r.id, name: r.name }), 'btn btn--small btn--danger'),
  );
  row.append(lane, cell(r.name), cell(r.id, 'atable__id'), cell(r.answered ? 'Yes' : '–'), cell(String(r.correct)), cell(stats), actions);
  return row;
}

function queueRow(p: LivePlayer, index: number, send: Send): HTMLTableRowElement {
  const row = el('tr');
  const actions = el('td', 'atable__actions');
  actions.append(
    actionButton('Remove', 'Take them out of the queue.', () => void send({ type: 'kick', userId: p.id })),
    actionButton('Block', 'Remove and ignore all their chat.', () => void send({ type: 'block', userId: p.id, name: p.name }), 'btn btn--small btn--danger'),
  );
  row.append(cell(String(index + 1)), cell(p.name), cell(p.id, 'atable__id'), actions);
  return row;
}

function sessionRow(s: LiveSessionRow, index: number): HTMLTableRowElement {
  const row = el('tr');
  row.append(cell(String(index + 1)), cell(s.name), cell(String(s.races)), cell(String(s.wins)), cell(String(s.podiums)), cell(String(s.correct)));
  return row;
}

export interface LiveSection {
  readonly root: HTMLElement;
  update(snapshot: AdminSnapshot, receivedAt: number): void;
  setConnected(connected: boolean): void;
}

export function liveSection(send: Send): LiveSection {
  const root = el('div', 'asection__body');
  const status = el('div', 'live-status');
  const phase = el('span', 'badge badge--phase');
  const race = el('span', 'live-status__item');
  const round = el('span', 'live-status__item');
  const timer = el('span', 'live-status__timer');
  status.append(phase, race, round, timer);

  const controls = el('div', 'live-controls');
  const start = actionButton('Start now', 'Start the quiz with the riders in the lobby.', () => void send({ type: 'start' }), 'btn btn--primary');
  const skip = actionButton('Skip phase', 'Jump to the next phase.', () => void send({ type: 'skip' }), 'btn');
  const reset = confirmButton('Reset race', 'Confirm reset', 'btn', () => void send({ type: 'reset' }));
  controls.append(start, skip, reset);
  const offline = el('p', 'offline', 'Game tab not connected. Open the game page in this browser to control it.');

  const ridersBox = el('div');
  const queueBox = el('div');
  const sessionBox = el('div');
  const clear = confirmButton('Clear leaderboard', 'Confirm clear', 'btn btn--small', () => void send({ type: 'clearSession' }));

  const block = (title: string, body: HTMLElement, extra?: HTMLElement): HTMLElement => {
    const node = el('section', 'acard');
    const head = el('header', 'acard__header acard__header--row');
    head.append(el('h2', 'acard__title', title));
    if (extra) head.append(extra);
    const wrap = el('div', 'acard__body');
    wrap.append(body);
    node.append(head, wrap);
    return node;
  };
  const ridersTitle = el('span', 'acard__meta');
  const queueTitle = el('span', 'acard__meta');
  root.append(
    block('Status', (() => { const b = el('div'); b.append(status, controls, offline); return b; })()),
    block('Riders', ridersBox, ridersTitle),
    block('Queue for next race', queueBox, queueTitle),
    block('Session leaderboard', sessionBox, clear),
  );

  let receivedAt = 0;
  let msLeft: number | null = null;
  let lastLists = '';
  window.setInterval(() => {
    if (msLeft === null) {
      timer.textContent = 'waiting';
      return;
    }
    const left = Math.max(0, msLeft - (performance.now() - receivedAt));
    timer.textContent = `${Math.ceil(left / 1000)}s left`;
  }, 250);

  return {
    root,
    update(snapshot, at) {
      const live = snapshot.live;
      receivedAt = at;
      msLeft = live.msLeft;
      phase.textContent = PHASE_NAME[live.phase];
      phase.dataset.phase = live.phase;
      race.textContent = `Race #${live.raceNumber}`;
      round.textContent = live.phase === 'question' || live.phase === 'reveal' ? `Question ${live.round + 1}/${live.rounds}` : '';
      start.disabled = !(live.phase === 'lobby' && live.racers.length > 0);
      skip.disabled = live.phase === 'lobby' && live.racers.length === 0;
      ridersTitle.textContent = snapshot.pendingUntilLobby
        ? `${live.racers.length} riding · max ${snapshot.settings.config.maxRacers} from next race`
        : `${live.racers.length}/${snapshot.settings.config.maxRacers}`;
      queueTitle.textContent = String(live.queue.length);

      const lists = JSON.stringify([live.racers, live.queue, live.session]);
      if (lists === lastLists) return; // keep hover/focus stable when nothing changed
      lastLists = lists;
      ridersBox.replaceChildren(table(['Lane', 'Name', 'User ID', 'Answered', 'Correct', 'Stats', ''],
        live.racers.map((r) => racerRow(r, send)), 'No riders yet. Viewers join by chatting in the lobby.'));
      queueBox.replaceChildren(table(['#', 'Name', 'User ID', ''],
        live.queue.map((p, i) => queueRow(p, i, send)), 'Nobody waiting.'));
      sessionBox.replaceChildren(table(['#', 'Name', 'Races', 'Wins', 'Top 3', 'Correct'],
        live.session.map(sessionRow), 'No finished races yet.'));
    },
    setConnected(connected) {
      offline.hidden = connected;
      controls.classList.toggle('is-disabled', !connected);
      for (const b of [start, skip, reset]) if (!connected) b.disabled = true;
      if (connected) reset.disabled = false;
    },
  };
}
