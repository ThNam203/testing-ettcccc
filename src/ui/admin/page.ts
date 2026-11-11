import type { AdminClient } from '../../admin/client';
import type { AdminCommand } from '../../admin/protocol';
import type { QuestionSource } from '../../engine/types';
import { defaultSettings } from '../../settings/schema';
import { el } from '../dom';
import { createDraftStore } from './draft';
import { labelFor } from './fields';
import { liveSection } from './sectionLive';
import { questionsSection } from './sectionQuestions';
import { giftsSection } from './sectionGifts';
import { statsSection } from './sectionStats';
import { displaySection, playersSection, quizSection } from './sectionSettings';
import { backupSection, moderationSection } from './sectionTools';

const TOAST_MS = 5_000;
const MAX_TOASTS = 4;

interface Tab {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly body: HTMLElement;
  readonly onShow?: () => void;
  readonly onHide?: () => void;
}

function createToasts(): { root: HTMLElement; show: (ok: boolean, message: string) => void } {
  const root = el('div', 'toasts');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  return {
    root,
    show(ok, message) {
      const toast = el('div', `toast ${ok ? 'toast--ok' : 'toast--bad'}`, message);
      root.append(toast);
      while (root.children.length > MAX_TOASTS) root.firstElementChild?.remove();
      window.setTimeout(() => toast.remove(), TOAST_MS);
    },
  };
}

function link(label: string, href: string): HTMLAnchorElement {
  const a = el('a', 'btn btn--small', label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function createAdminPage(root: HTMLElement, client: AdminClient, bank: readonly QuestionSource[]): void {
  const store = createDraftStore(defaultSettings(), bank);
  const toasts = createToasts();
  let connected = false;

  const send = async (command: AdminCommand): Promise<boolean> => {
    const result = await client.send(command);
    toasts.show(result.ok, result.message);
    return result.ok;
  };

  // ---- header and banners
  const header = el('header', 'aheader');
  const brand = el('div', 'aheader__brand');
  brand.append(el('span', 'aheader__product', 'English Derby'), el('span', 'aheader__divider', '/'), el('span', 'aheader__area', 'Admin'));
  const conn = el('span', 'conn');
  const links = el('div', 'aheader__links');
  links.append(link('Open game', './'), link('Chat simulator', './player.html'));
  header.append(brand, conn, links);
  const pendingBanner = el('p', 'banner', 'Saved game rules take effect when the next lobby opens. The race in progress keeps its current rules.');
  const multiBanner = el('p', 'banner banner--warn');
  const waitingBanner = el('p', 'banner banner--warn', 'Waiting for the game tab… The form shows defaults until it connects.');

  // ---- sections
  const live = liveSection(send);
  const moderation = moderationSection(send, store);
  const stats = statsSection(bank, toasts.show);
  const gifts = giftsSection(toasts.show);
  const tabs: readonly Tab[] = [
    { id: 'live', label: 'Live', description: 'Control the running game and manage riders.', body: live.root },
    { id: 'riders', label: 'Riders & joining', description: 'Who can ride and how viewers get in. Changes made during a race apply from the next lobby.', body: playersSection(store) },
    { id: 'quiz', label: 'Quiz & timing', description: 'Question level, race length and phase durations. Changes made during a race apply from the next lobby.', body: quizSection(store, bank) },
    { id: 'display', label: 'Display', description: 'What the game screen shows. Applies immediately, including during a race.', body: displaySection(store) },
    { id: 'questions', label: 'Questions', description: 'Choose which questions can be asked.', body: questionsSection(store, bank) },
    { id: 'stats', label: 'Stats', description: 'Saved history from the stats database (npm run server). Use it to see how the game is used and which questions need work.', body: stats.root, onShow: stats.show, onHide: stats.hide },
    { id: 'gifts', label: 'Winners & gifts', description: 'Pick prize winners from a session’s results, record each gift, and track which ones are still owed. Needs npm run server.', body: gifts.root, onShow: gifts.show, onHide: gifts.hide },
    { id: 'moderation', label: 'Moderation', description: 'Block viewers from joining and from the on-screen chat.', body: moderation.root },
    { id: 'backup', label: 'Backup', description: 'Export, import or reset settings.', body: backupSection(store, bank, toasts.show) },
  ];
  const nav = el('nav', 'anav');
  nav.setAttribute('aria-label', 'Admin sections');
  const main = el('main', 'amain');
  const buttons = tabs.map((tab) => {
    const b = el('button', 'anav__btn', tab.label);
    b.type = 'button';
    b.addEventListener('click', () => select(tab.id));
    nav.append(b);
    const page = el('section', 'apage');
    page.dataset.tab = tab.id;
    const head = el('header', 'apage__header');
    head.append(el('h1', 'apage__title', tab.label), el('p', 'apage__desc', tab.description));
    page.append(head, tab.body);
    main.append(page);
    return { tab, page, b };
  });
  function select(id: string): void {
    const known = tabs.some((t) => t.id === id) ? id : 'live';
    for (const { tab, page, b } of buttons) {
      const visible = tab.id === known;
      if (visible && page.hidden) tab.onShow?.();
      if (!visible && !page.hidden) tab.onHide?.();
      page.hidden = !visible;
      b.setAttribute('aria-current', tab.id === known ? 'page' : 'false');
    }
    if (window.location.hash !== `#${known}`) window.history.replaceState(null, '', `#${known}`);
  }
  select(window.location.hash.slice(1));

  // ---- apply bar
  const bar = el('div', 'applybar');
  const summary = el('div', 'applybar__summary');
  const discard = el('button', 'btn', 'Discard');
  const apply = el('button', 'btn btn--primary', 'Apply');
  discard.type = 'button';
  apply.type = 'button';
  bar.append(summary, discard, apply);
  discard.addEventListener('click', () => {
    store.discard();
    toasts.show(true, 'Changes discarded.');
  });
  const doApply = async (): Promise<void> => {
    if (apply.disabled) return;
    apply.disabled = true;
    await send({ type: 'applySettings', settings: store.current() });
    renderBar();
  };
  apply.addEventListener('click', () => void doApply());
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void doApply();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (store.isDirty()) event.preventDefault();
  });

  function renderBar(): void {
    const changed = store.changedPaths();
    const issues = store.issues();
    const dirty = store.isDirty();
    bar.hidden = !dirty && issues.length === 0;
    const parts: HTMLElement[] = [];
    if (dirty) parts.push(el('strong', undefined, `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}: `), el('span', undefined, changed.map(labelFor).join(', ')));
    if (issues.length > 0) parts.push(el('span', 'applybar__bad', ` · ${issues.length} problem${issues.length === 1 ? '' : 's'} to fix (${[...new Set(issues.map((i) => labelFor(i.path)))].join(', ')})`));
    if (!connected) parts.push(el('span', 'applybar__bad', ' · game tab not connected'));
    summary.replaceChildren(...parts);
    apply.disabled = !dirty || issues.length > 0 || !connected;
    discard.disabled = !dirty;
  }
  store.subscribe(renderBar);

  // ---- wiring
  client.onConnection((c) => {
    connected = c.connected;
    conn.textContent = c.connected ? 'Connected' : 'Game tab not found';
    conn.title = c.connected ? 'Receiving live data from the game tab.' : 'Open the game page in this browser.';
    conn.classList.toggle('conn--on', c.connected);
    multiBanner.hidden = c.hosts <= 1;
    multiBanner.textContent = `${c.hosts} game tabs are open. Commands go to all of them; close the extra tabs.`;
    live.setConnected(c.connected);
    renderBar();
  });
  client.onSnapshot((snapshot, at) => {
    waitingBanner.hidden = true;
    pendingBanner.hidden = !snapshot.pendingUntilLobby;
    store.receiveRemote(snapshot.settings);
    live.update(snapshot, at);
    moderation.update(snapshot);
  });

  pendingBanner.hidden = true;
  multiBanner.hidden = true;
  const shell = el('div', 'ashell');
  const content = el('div', 'acontent');
  content.append(waitingBanner, multiBanner, pendingBanner, main, bar);
  const layout = el('div', 'alayout');
  layout.append(nav, content);
  shell.append(header, layout, toasts.root);
  root.append(shell);
  store.update((s) => s); // first render of every field
  // Ask for a snapshot now instead of waiting for the heartbeat. No toast on failure:
  // the "waiting for the game tab" banner already says what to do.
  void client.send({ type: 'hello' });
}
