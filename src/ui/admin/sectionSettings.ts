import {
  CONFIG_LIMITS, MAX_KEYWORD_LENGTH, ROUND_OPTIONS, enabledQuestionCounts, normaliseKeyword, type NumericConfigKey,
} from '../../engine/configRules';
import type { GameConfig, Level, QuestionSource } from '../../engine/types';
import { DISPLAY_LIMITS, estimateLoop, type DisplaySettings, type Settings } from '../../settings/schema';
import { el } from '../dom';
import { LEVEL_LABEL } from '../labels';
import type { DraftStore } from './draft';
import { card, numberField, selectField, textField, toggleField } from './fields';

const withConfig = (s: Settings, patch: Partial<GameConfig>): Settings => ({ ...s, config: { ...s.config, ...patch } });
const withDisplay = (s: Settings, patch: Partial<DisplaySettings>): Settings => ({ ...s, display: { ...s.display, ...patch } });

function configNumber(
  store: DraftStore, key: NumericConfigKey, label: string, help: string,
  unit: string, seconds: boolean, step = 1,
): HTMLElement {
  const scale = seconds ? 1000 : 1;
  const { min, max } = CONFIG_LIMITS[key];
  return numberField(store, {
    path: `config.${key}`, label, help, unit, scale, step,
    min: min / scale, max: max / scale,
    get: (s) => s.config[key],
    set: (s, v) => withConfig(s, { [key]: v }),
  });
}

export function playersSection(store: DraftStore): HTMLElement {
  const keyword = textField(store, {
    path: 'config.joinKeyword',
    label: 'Join word',
    help: 'Empty: any chat message joins. With a word (e.g. "join"), only messages containing it join or queue, so random chat does not fill the lanes. Riders still answer with A/B/C/D.',
    placeholder: 'empty = any message',
    maxLength: MAX_KEYWORD_LENGTH + 8,
    get: (s) => s.config.joinKeyword,
    set: (s, v) => withConfig(s, { joinKeyword: v }),
    tidy: normaliseKeyword,
    preview: (v) => (v.trim() === ''
      ? 'Viewers join by typing anything in chat.'
      : `Viewers join by typing a message containing “${normaliseKeyword(v)}”, e.g. “${normaliseKeyword(v)} me!”.`),
  });
  const wrap = el('div', 'asection__body');
  wrap.append(
    card('Capacity', null,
      configNumber(store, 'maxRacers', 'Max riders per race', 'Horses on the track. Extra viewers wait in the queue for the next race.', 'riders', false),
      configNumber(store, 'minRacersToStart', 'Riders needed to start', 'The lobby countdown waits for this many riders. Start now still works with fewer.', 'riders', false),
      configNumber(store, 'maxQueue', 'Max queue length', 'Viewers waiting for the next race. 0 disables the queue.', 'people', false),
    ),
    card('Joining', null, keyword),
  );
  return wrap;
}

function levelOptions(bank: readonly QuestionSource[], store: DraftStore): { value: Level; label: string }[] {
  const counts = enabledQuestionCounts(bank, store.current().config.disabledQuestionIds);
  return (Object.keys(LEVEL_LABEL) as Level[]).map((value) => ({ value, label: `${LEVEL_LABEL[value]} (${counts[value]} on)` }));
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function estimateBox(store: DraftStore): HTMLElement {
  const box = el('div', 'estimate');
  box.setAttribute('aria-live', 'polite');
  store.subscribe(() => {
    const c = store.current().config;
    const valid = [c.lobbyMs, c.questionMs, c.revealMs, c.raceCountdownMs, c.raceOutroMs, c.resultsMs, c.roundsPerRace]
      .every(Number.isFinite);
    if (!valid) {
      box.replaceChildren(el('p', 'estimate__main', 'Fix the highlighted fields to see the race length.'));
      return;
    }
    const e = estimateLoop(c);
    box.replaceChildren(
      el('p', 'estimate__label', 'Estimated race loop'),
      el('p', 'estimate__main', `${formatDuration(e.totalMinMs)} – ${formatDuration(e.totalMaxMs)}`),
      el('p', 'estimate__detail', `Lobby ${formatDuration(c.lobbyMs)} · Quiz up to ${formatDuration(e.quizMs)} (${c.roundsPerRace} × ${c.questionMs / 1000}s + ${c.revealMs / 1000}s) · Race ${Math.round(e.raceMinMs / 1000)}–${Math.round(e.raceMaxMs / 1000)}s · Results ${formatDuration(c.resultsMs)}. The quiz is shorter when every rider answers early.`),
    );
  });
  return box;
}

export function quizSection(store: DraftStore, bank: readonly QuestionSource[]): HTMLElement {
  const level = selectField<Level>(store, {
    path: 'level',
    label: 'Question level',
    help: 'CEFR level of the questions. Switch off single questions in the Questions tab.',
    options: levelOptions(bank, store),
    get: (s) => s.level,
    set: (s, v) => ({ ...s, level: v }),
  });
  const rounds = selectField<number>(store, {
    path: 'config.roundsPerRace',
    label: 'Questions per race',
    help: 'Always a multiple of 3, so Speed, Stamina and Strength get the same number of questions.',
    options: ROUND_OPTIONS.map((n) => ({ value: n, label: `${n} questions (${n / 3} per stat)` })),
    get: (s) => s.config.roundsPerRace,
    set: (s, v) => withConfig(s, { roundsPerRace: v }),
  });
  const points = configNumber(store, 'pointsPerCorrect', 'Points per correct answer',
    'Same for every rider. It changes the numbers shown on screen only: the race uses the share of points earned, so the balance stays fair.', 'pts', false);

  const wrap = el('div', 'asection__body');
  wrap.append(
    card('Questions', null, level, rounds, points),
    card('Phase timing', 'All values in seconds.',
      configNumber(store, 'lobbyMs', 'Lobby countdown', 'How long the lobby stays open after enough riders joined.', 's', true),
      configNumber(store, 'questionMs', 'Time to answer', 'Seconds riders have for each question.', 's', true),
      configNumber(store, 'allAnsweredGraceMs', 'Close after everyone answered', 'Once every rider has answered, the question closes after this short pause.', 's', true, 0.5),
      configNumber(store, 'revealMs', 'Show the answer', 'Correct answer + explanation on screen.', 's', true),
      configNumber(store, 'raceCountdownMs', 'Gate countdown', '3-2-1-GO before the gates open. 0 = start at once.', 's', true),
      configNumber(store, 'raceOutroMs', 'After the finish', 'Time after the last horse crosses the line, before results.', 's', true),
      configNumber(store, 'resultsMs', 'Results screen', 'Podium and leaderboard before the next lobby.', 's', true),
      estimateBox(store),
    ),
    fairnessCard(),
  );
  // Level labels show live question counts.
  store.subscribe(() => {
    const select = level.querySelector('select');
    if (select === null) return;
    levelOptions(bank, store).forEach((o, i) => {
      const node = select.options[i];
      if (node !== undefined) node.textContent = o.label;
    });
  });
  return wrap;
}

const FAIRNESS_RULES: readonly [string, string][] = [
  ['Same points for everyone', 'No bonus for answering fast: TikTok chat reaches the game with different delays per viewer.'],
  ['First answer counts', 'Later messages are ignored, so typing A, B, C, D in a row does not work.'],
  ['Stats take turns', 'Speed → Stamina → Strength, the same number of times each. A perfect rider always ends with the same stats.'],
  ['Every stat is worth the same', '+1 correct answer in any stat gives about the same time gain.'],
  ['Knowledge beats luck', 'Luck only breaks ties; one extra correct answer always wins (tested on hundreds of races for 3, 6, 9 and 12 questions).'],
  ['No late joining', 'Viewers who arrive after the lobby wait for the next race instead of riding with fewer answers.'],
];

function fairnessCard(): HTMLElement {
  const list = el('ul', 'rules');
  for (const [title, why] of FAIRNESS_RULES) {
    const item = el('li', 'rules__item');
    item.append(el('strong', undefined, title), el('span', undefined, why));
    list.append(item);
  }
  const node = card('Fixed fairness rules', 'Built into the engine and not configurable.');
  node.append(list);
  return node;
}

export function displaySection(store: DraftStore): HTMLElement {
  const wrap = el('div', 'asection__body');
  const { min, max } = DISPLAY_LIMITS.chatRows;
  wrap.append(card('Game screen', null,
    toggleField(store, {
      path: 'display.maskAnswers', label: 'Hide answers in the on-screen chat',
      help: 'Shows “answered ✓” instead of the letter, so viewers cannot copy each other.',
      warnWhenOff: 'Off: answers are visible on the stream and can be copied.',
      get: (s) => s.display.maskAnswers, set: (s, v) => withDisplay(s, { maskAnswers: v }),
    }),
    toggleField(store, {
      path: 'display.showExplanation', label: 'Show explanations',
      help: 'One-line grammar or vocabulary note under the correct answer. This is the learning moment.',
      warnWhenOff: 'Off: viewers see the right answer but not why.',
      get: (s) => s.display.showExplanation, set: (s, v) => withDisplay(s, { showExplanation: v }),
    }),
    toggleField(store, {
      path: 'display.showNameTags', label: 'Name tags above horses',
      help: 'Floating tags with place, lane and name. Turn off for a cleaner 3D view.',
      get: (s) => s.display.showNameTags, set: (s, v) => withDisplay(s, { showNameTags: v }),
    }),
    toggleField(store, {
      path: 'display.showHostBar', label: 'Host control bar',
      help: 'Start/Skip/Reset bar on the game screen. Turn off before streaming (press H on the game tab to toggle).',
      get: (s) => s.display.showHostBar, set: (s, v) => withDisplay(s, { showHostBar: v }),
    }),
    numberField(store, {
      path: 'display.chatRows', label: 'Chat lines on screen', help: 'Latest chat messages shown. 0 hides the chat panel.',
      unit: 'lines', scale: 1, step: 1, min, max,
      get: (s) => s.display.chatRows, set: (s, v) => withDisplay(s, { chatRows: v }),
    }),
  ));
  return wrap;
}
