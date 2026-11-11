import { STAT_KEYS } from '../engine/config';
import { hasAnswered } from '../engine/game';
import { runningOrder } from '../engine/playback';
import type { ChatMessage, GameState, Racer } from '../engine/types';
import { el } from './dom';
import { STAT_SHORT } from './labels';

/** Max points one stat can reach in a race; used to scale the bars. */
function statMax(state: GameState): number {
  return Math.max(1, (state.config.roundsPerRace / STAT_KEYS.length) * state.config.pointsPerCorrect);
}

function racerRow(state: GameState, racer: Racer, place: number | null): HTMLElement {
  const row = el('li', 'racer');
  row.style.setProperty('--silk', racer.color);
  const head = el('div', 'racer__head');
  head.append(
    el('span', 'racer__place', place === null ? String(racer.lane + 1) : `#${place}`),
    el('span', 'racer__name', racer.name),
  );
  const answered = state.phase === 'question' && hasAnswered(state, racer.id);
  head.append(el('span', 'racer__status', answered ? '✓' : `✔${racer.correct}`));

  const bars = el('div', 'racer__bars');
  const max = statMax(state);
  for (const stat of STAT_KEYS) {
    const bar = el('div', `bar bar--${stat}`);
    bar.title = `${STAT_SHORT[stat]} ${racer.stats[stat]}`;
    const fill = el('div', 'bar__fill');
    fill.style.transform = `scaleX(${Math.min(1, racer.stats[stat] / max)})`;
    bar.append(el('span', 'bar__label', STAT_SHORT[stat]), fill);
    bars.append(bar);
  }
  row.append(head, bars);
  return row;
}

/** Racer list; in race/results ordered by place, otherwise by lane. */
export function renderRacers(list: HTMLElement, state: GameState, now: number): void {
  const race = state.race;
  const showPlaces = race !== null && (state.phase === 'race' || state.phase === 'results');
  let ordered: readonly Racer[] = state.racers;
  const places = new Map<string, number>();
  if (showPlaces) {
    const elapsed = state.phase === 'results'
      ? Number.POSITIVE_INFINITY
      : now - state.phaseStartedAt - state.config.raceCountdownMs;
    const order = runningOrder(race, elapsed);
    order.forEach((id, i) => places.set(id, i + 1));
    ordered = order.flatMap((id) => state.racers.filter((r) => r.id === id));
  }
  list.replaceChildren(...ordered.map((r) => racerRow(state, r, showPlaces ? places.get(r.id) ?? null : null)));
}

const DEFAULT_CHAT_HISTORY = 8;

export interface ChatFeed {
  push(message: ChatMessage): void;
  /** Lines kept on screen (admin setting). */
  setLimit(rows: number): void;
}

export function createChatFeed(list: HTMLElement): ChatFeed {
  let limit = DEFAULT_CHAT_HISTORY;
  const trim = (): void => {
    while (list.children.length > limit) list.firstElementChild?.remove();
  };
  return {
    push(message) {
      const row = el('li', 'chat__row');
      row.append(el('span', 'chat__name', message.nickname), el('span', 'chat__text', message.text));
      list.append(row);
      trim();
    },
    setLimit(rows) {
      limit = Math.max(0, Math.floor(rows));
      trim();
    },
  };
}
