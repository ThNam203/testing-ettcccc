import './ui/styles.css';
import {
  LOCAL_CHANNEL, MAX_TEXT_LENGTH, parseChatEnvelope, parseStatusEnvelope,
  type ChatEnvelope, type StatusEnvelope,
} from './chat/protocol';
import type { ChatMessage } from './engine/types';
import { el } from './ui/dom';
import { LETTERS, PHASE_LABEL, STAT_LABEL } from './ui/labels';

const NICK_KEY = 'derby-sim:nickname';
const RECENT_KEY = 'derby-sim:recent';
const MAX_RECENT = 8;
const MAX_LOG = 60;
const MAX_NICK = 24;

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`Missing #${id}`);
  return node;
}

/** localStorage is a convenience only; failures (private mode etc.) are ignored on purpose. */
function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the simulator still works, it just won't remember nicknames.
  }
}

function loadRecent(): string[] {
  const raw = load(RECENT_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function userIdFor(nickname: string): string {
  return `local:${nickname.trim().toLowerCase()}`;
}

function renderStatus(box: HTMLElement, status: StatusEnvelope, nickname: string): void {
  const id = userIdFor(nickname);
  const role = status.racerIds.includes(id) ? '🏇 riding'
    : status.queuedIds.includes(id) ? '⏳ queued for next race' : '👀 not joined yet — send any message';
  const head = el('p', 'sim__phase', `Race #${status.raceNumber} · ${PHASE_LABEL[status.phase]} · ${nickname || '(no nickname)'}: ${role}`);
  box.replaceChildren(head);
  if (status.prompt === null) return;
  box.append(el('p', 'sim__muted', `Question ${status.round + 1}/${status.rounds}${status.stat ? ` · ${STAT_LABEL[status.stat]}` : ''}`));
  box.append(el('p', 'sim__prompt', status.prompt));
  const list = el('ol', 'sim__choices');
  status.choices.forEach((c, i) => list.append(el('li', undefined, `${LETTERS[i] ?? '?'}. ${c}`)));
  box.append(list);
}

function boot(): void {
  const form = byId('chat-form', HTMLFormElement);
  const nickInput = byId('nickname', HTMLInputElement);
  const msgInput = byId('message', HTMLInputElement);
  const recentBox = byId('recent', HTMLDivElement);
  const quick = byId('quick', HTMLDivElement);
  const statusBox = byId('status', HTMLElement);
  const log = byId('log', HTMLUListElement);
  const formError = byId('form-error', HTMLParagraphElement);

  const showError = (text: string | null): void => {
    formError.textContent = text ?? '';
    formError.hidden = text === null;
  };

  if (typeof BroadcastChannel === 'undefined') {
    showError('This browser does not support BroadcastChannel. Use a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  const channel = new BroadcastChannel(LOCAL_CHANNEL);
  let recent = loadRecent();
  let lastStatus: StatusEnvelope | null = null;
  nickInput.value = load(NICK_KEY) ?? '';

  const appendLog = (m: ChatMessage): void => {
    const row = el('li');
    row.append(el('strong', undefined, m.nickname), el('span', undefined, ` ${m.text}`));
    log.prepend(row);
    while (log.children.length > MAX_LOG) log.lastElementChild?.remove();
  };

  const renderRecent = (): void => {
    recentBox.replaceChildren(...recent.map((name) => {
      const chip = el('button', 'chip chip--button', name);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        nickInput.value = name;
        save(NICK_KEY, name);
        if (lastStatus) renderStatus(statusBox, lastStatus, name);
        msgInput.focus();
      });
      return chip;
    }));
  };

  const send = (text: string): void => {
    const nickname = nickInput.value.trim().slice(0, MAX_NICK);
    const body = text.trim();
    if (nickname === '') return showError('Type a nickname first.');
    if (body === '' || body.length > MAX_TEXT_LENGTH) return showError(`Message must be 1–${MAX_TEXT_LENGTH} characters.`);
    showError(null);
    const envelope: ChatEnvelope = { kind: 'chat', userId: userIdFor(nickname), nickname, text: body };
    channel.postMessage(envelope);
    appendLog(envelope);
    save(NICK_KEY, nickname);
    recent = [nickname, ...recent.filter((n) => n !== nickname)].slice(0, MAX_RECENT);
    save(RECENT_KEY, JSON.stringify(recent));
    renderRecent();
  };

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const chat = parseChatEnvelope(event.data);
    if (chat) return appendLog(chat);
    const status = parseStatusEnvelope(event.data);
    if (status) {
      lastStatus = status;
      renderStatus(statusBox, status, nickInput.value.trim());
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(msgInput.value);
    msgInput.value = '';
    msgInput.focus();
  });
  quick.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.text) send(target.dataset.text);
  });
  nickInput.addEventListener('input', () => {
    if (lastStatus) renderStatus(statusBox, lastStatus, nickInput.value.trim());
  });
  renderRecent();
}

boot();
