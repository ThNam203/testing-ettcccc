import type { ChatMessage, GameState, Level } from '../engine/types';
import type { DisplaySettings } from '../settings/schema';
import { renderLobby, renderQuestion, renderResults } from './cards';
import { el, setVisible } from './dom';
import { LEVEL_LABEL, PHASE_LABEL } from './labels';
import { createChatFeed, renderRacers } from './sidebars';

const RACE_LIST_REFRESH_MS = 250;
const GO_FLASH_MS = 900;

export interface HostHandlers {
  readonly onStart: () => void;
  readonly onSkip: () => void;
  readonly onReset: () => void;
  readonly onLevel: (level: Level) => void;
}

export interface Hud {
  /** Call when the game state object changes. */
  render(state: GameState, now: number): void;
  /** Call every frame for timers and countdowns. */
  tick(state: GameState, now: number): void;
  pushChat(message: ChatMessage): void;
  setSourceLabel(text: string): void;
  /** Stats database status pill. */
  setStatsLabel(text: string, ok: boolean): void;
  showError(message: string, retry?: () => void): void;
  clearError(): void;
  /** Apply display settings from the admin page. */
  applyDisplay(display: DisplaySettings): void;
}

function buildHostBar(handlers: HostHandlers): { bar: HTMLElement; level: HTMLSelectElement; start: HTMLButtonElement; skip: HTMLButtonElement } {
  const bar = el('div', 'hostbar');
  const start = el('button', 'btn btn--primary', '▶ Start now');
  const skip = el('button', 'btn', '⏭ Skip');
  const reset = el('button', 'btn', '↺ Reset');
  const level = el('select', 'select');
  level.setAttribute('aria-label', 'Question level');
  for (const [value, label] of Object.entries(LEVEL_LABEL)) {
    const opt = el('option', undefined, label);
    opt.value = value;
    level.append(opt);
  }
  const sim = el('a', 'btn', '💬 Open chat simulator');
  sim.href = './player.html';
  sim.target = '_blank';
  sim.rel = 'noopener';
  const admin = el('a', 'btn', '⚙ Admin');
  admin.href = './admin.html';
  admin.target = '_blank';
  admin.rel = 'noopener';
  const hint = el('span', 'hostbar__hint', 'H = hide controls');

  start.addEventListener('click', handlers.onStart);
  skip.addEventListener('click', handlers.onSkip);
  reset.addEventListener('click', handlers.onReset);
  level.addEventListener('change', () => {
    const value = level.value;
    if (value === 'A2' || value === 'B1' || value === 'B2') handlers.onLevel(value);
  });
  bar.append(start, skip, reset, level, sim, admin, hint);
  return { bar, level, start, skip };
}

export function createHud(root: HTMLElement, handlers: HostHandlers): Hud {
  const top = el('header', 'topbar');
  const brand = el('div', 'brand', '🐎 English Derby');
  const phase = el('span', 'pill pill--phase');
  const levelPill = el('span', 'pill');
  const source = el('span', 'pill pill--source');
  const stats = el('span', 'pill pill--stats', 'stats: connecting…');
  const timer = el('div', 'timer');
  const timerFill = el('div', 'timer__fill');
  const timerText = el('span', 'timer__text');
  timer.append(timerFill, timerText);
  top.append(brand, phase, levelPill, source, stats, timer);

  const racersPanel = el('aside', 'panel panel--racers');
  const racersList = el('ol', 'racers');
  racersPanel.append(el('div', 'panel__title', 'Riders'), racersList);

  const chatPanel = el('aside', 'panel panel--chat');
  const chatList = el('ul', 'chat');
  chatPanel.append(el('div', 'panel__title', 'Live chat'), chatList);
  const chat = createChatFeed(chatList);

  const card = el('section', 'card');
  const countdown = el('div', 'countdown');
  const error = el('div', 'error-banner');
  setVisible(error, false);
  const host = buildHostBar(handlers);

  root.append(top, racersPanel, chatPanel, card, countdown, error, host.bar);

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'h' && !(event.target instanceof HTMLInputElement)) {
      host.bar.classList.toggle('hostbar--hidden');
    }
  });

  let lastRaceListAt = 0;

  function renderCard(state: GameState): void {
    card.className = `card card--${state.phase}`;
    switch (state.phase) {
      case 'lobby':
        renderLobby(card, state);
        break;
      case 'question':
      case 'reveal':
        renderQuestion(card, state);
        break;
      case 'results':
        renderResults(card, state);
        break;
      case 'race':
        card.replaceChildren();
        break;
    }
    setVisible(card, state.phase !== 'race');
  }

  function tickTimer(state: GameState, now: number): void {
    const end = state.phaseEndsAt;
    if (end === null) {
      timerFill.style.transform = 'scaleX(1)';
      timerText.textContent = state.phase === 'lobby' ? 'waiting' : '';
      return;
    }
    const total = Math.max(1, end - state.phaseStartedAt);
    const left = Math.max(0, end - now);
    timerFill.style.transform = `scaleX(${left / total})`;
    timerText.textContent = `${Math.ceil(left / 1000)}s`;
    const lobbyCountdown = card.querySelector('.lobby__countdown');
    if (lobbyCountdown) lobbyCountdown.textContent = `Starting in ${Math.ceil(left / 1000)}s`;
  }

  function tickCountdown(state: GameState, now: number): void {
    if (state.phase !== 'race') {
      setVisible(countdown, false);
      return;
    }
    const sinceGo = now - state.phaseStartedAt - state.config.raceCountdownMs;
    const text = sinceGo < 0 ? String(Math.ceil(-sinceGo / 1000)) : sinceGo < GO_FLASH_MS ? 'GO!' : '';
    countdown.textContent = text;
    setVisible(countdown, text !== '');
  }

  return {
    render(state, now) {
      phase.textContent = PHASE_LABEL[state.phase];
      phase.dataset.phase = state.phase;
      levelPill.textContent = LEVEL_LABEL[state.level];
      host.level.value = state.level;
      host.level.disabled = state.phase !== 'lobby';
      host.start.disabled = !(state.phase === 'lobby' && state.racers.length > 0);
      host.skip.disabled = state.phase === 'lobby' && state.racers.length === 0;
      renderCard(state);
      renderRacers(racersList, state, now);
      setVisible(racersPanel, state.racers.length > 0);
    },
    tick(state, now) {
      tickTimer(state, now);
      tickCountdown(state, now);
      if (state.phase === 'race' && now - lastRaceListAt > RACE_LIST_REFRESH_MS) {
        lastRaceListAt = now;
        renderRacers(racersList, state, now);
      }
    },
    pushChat: chat.push,
    setStatsLabel(text, ok) {
      stats.textContent = text;
      stats.dataset.ok = String(ok);
    },
    setSourceLabel(text) {
      source.textContent = text;
    },
    applyDisplay(display) {
      chat.setLimit(display.chatRows);
      chatPanel.classList.toggle('panel--off', display.chatRows === 0);
      host.bar.classList.toggle('hostbar--hidden', !display.showHostBar);
      root.classList.toggle('hide-explanation', !display.showExplanation);
    },
    clearError() {
      error.replaceChildren();
      setVisible(error, false);
    },
    showError(message, retry) {
      const text = el('span', undefined, `⚠️ ${message}`);
      error.replaceChildren(text);
      if (retry) {
        const button = el('button', 'btn', 'Retry');
        button.addEventListener('click', retry);
        error.append(button);
      }
      setVisible(error, true);
    },
  };
}
