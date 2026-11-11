import { joinPrompt } from '../engine/configRules';
import type { GameState, SessionRecord, Standing } from '../engine/types';
import { el, formatSeconds } from './dom';
import { LETTERS, STAT_LABEL } from './labels';

/** Lobby: call to action + who has joined. */
export function renderLobby(card: HTMLElement, state: GameState): void {
  const { racers, queue, config } = state;
  card.replaceChildren(
    el('div', 'card__eyebrow', `Race #${state.raceNumber}`),
    el('h2', 'card__title', joinPrompt(config.joinKeyword, 'lobby')),
    el('p', 'card__sub', racers.length === 0
      ? 'Waiting for the first rider…'
      : `${racers.length}/${config.maxRacers} riders · ${queue.length} waiting for next race`),
    el('div', 'lobby__countdown', ''),
    el('p', 'card__hint', `Answer ${config.roundsPerRace} English questions with A, B, C or D. Every correct answer = +${config.pointsPerCorrect} for your horse. Same points for everyone!`),
  );
  const chips = el('div', 'chips');
  for (const r of racers) {
    const chip = el('span', 'chip', r.name);
    chip.style.setProperty('--silk', r.color);
    chips.append(chip);
  }
  card.append(chips);
}

/** Question + reveal share one card so the layout doesn't jump. */
export function renderQuestion(card: HTMLElement, state: GameState): void {
  const q = state.questions[state.round];
  if (q === undefined) {
    card.replaceChildren();
    return;
  }
  const revealing = state.phase === 'reveal' && state.lastReveal !== null;
  const header = el('div', 'question__header');
  header.append(
    el('span', 'card__eyebrow', `Question ${state.round + 1}/${state.questions.length} · ${q.category}`),
    el('span', `stat-chip stat-chip--${q.stat}`, `Trains ${STAT_LABEL[q.stat]}`),
  );

  const grid = el('div', 'choices');
  q.choices.forEach((choice, i) => {
    const state_ = !revealing ? '' : i === q.answer ? ' choice--correct' : ' choice--wrong';
    const item = el('div', `choice${state_}`);
    item.append(el('span', 'choice__letter', LETTERS[i] ?? '?'), el('span', 'choice__text', choice));
    grid.append(item);
  });

  const footer = el('div', 'question__footer');
  if (revealing && state.lastReveal) {
    const { correctIds, points, stat } = state.lastReveal;
    footer.append(
      el('p', 'explanation', `💡 ${q.explanation}`),
      el('p', 'gain', `+${points} ${STAT_LABEL[stat]} → ${correctIds.length}/${state.racers.length} riders`),
    );
  } else {
    const answered = Object.keys(state.answers).length;
    footer.append(el('p', 'card__sub', `Type A, B, C or D · ${answered}/${state.racers.length} answered`));
  }
  card.replaceChildren(header, el('h2', 'question__prompt', q.prompt), grid, footer);
}

function podiumStep(s: Standing): HTMLElement {
  const step = el('div', `podium__step podium__step--${s.place}`);
  step.style.setProperty('--silk', s.color);
  step.append(
    el('div', 'podium__medal', ['🥇', '🥈', '🥉'][s.place - 1] ?? ''),
    el('div', 'podium__name', s.name),
    el('div', 'podium__meta', `${formatSeconds(s.finishTimeMs)} · ✔ ${s.correct}`),
  );
  return step;
}

function sessionTable(session: Readonly<Record<string, SessionRecord>>): HTMLElement {
  const top = Object.values(session)
    .sort((a, b) => b.wins - a.wins || b.correct - a.correct || b.podiums - a.podiums)
    .slice(0, 5);
  const box = el('div', 'session');
  box.append(el('div', 'card__eyebrow', 'Today\'s leaderboard'));
  const list = el('ol', 'session__list');
  for (const rec of top) {
    const row = el('li', 'session__row');
    row.append(el('span', 'session__name', rec.name), el('span', 'session__stats', `🏆 ${rec.wins} · ✔ ${rec.correct} · ${rec.races} races`));
    list.append(row);
  }
  box.append(list);
  return box;
}

export function renderResults(card: HTMLElement, state: GameState): void {
  const standings = state.standings ?? [];
  const podium = el('div', 'podium');
  for (const place of [2, 1, 3]) {
    const s = standings.find((x) => x.place === place);
    if (s) podium.append(podiumStep(s));
  }
  const rest = el('ol', 'results__rest');
  rest.start = 4;
  for (const s of standings.slice(3)) {
    rest.append(el('li', undefined, `${s.name} · ${formatSeconds(s.finishTimeMs)} · ✔ ${s.correct}`));
  }
  card.replaceChildren(
    el('div', 'card__eyebrow', `Race #${state.raceNumber} results`),
    podium,
    rest,
    sessionTable(state.session),
    // The next race uses saved-but-pending rules, if any.
    el('p', 'card__hint', joinPrompt((state.pending?.config ?? state.config).joinKeyword, 'next')),
  );
}
