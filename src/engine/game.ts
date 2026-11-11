import { parseAnswer } from './chatParser';
import { DEFAULT_CONFIG, maxPointsPerStat } from './config';
import { matchesJoinKeyword, validateConfig } from './configRules';
import { closeIfAllAnswered, enterPhase, isBlocked, lobbyDeadline, makeRacer, toLobby } from './flow';
import { configure, removeUsers, setBlocked } from './moderation';
import { pickRoundQuestions, validateBank } from './questions';
import { scaleStats, simulateRace } from './race';
import { nextRandom } from './rng';
import type {
  BlockedUser, ChatMessage, GameAction, GameConfig, GameState, Level, Player,
  QuestionSource, SessionRecord, Standing,
} from './types';

const MAX_NAME_LENGTH = 24;

export interface CreateGameOptions {
  readonly bank: readonly QuestionSource[];
  readonly seed: number;
  readonly now: number;
  readonly config?: GameConfig;
  readonly level?: Level;
  readonly blocked?: readonly BlockedUser[];
}

function assertUsable(bank: readonly QuestionSource[], config: GameConfig): void {
  const bankErrors = validateBank(bank);
  if (bankErrors.length > 0) throw new Error(`Invalid question bank:\n- ${bankErrors.join('\n- ')}`);
  const configErrors = validateConfig(config, bank).map((i) => `${i.field}: ${i.message}`);
  if (configErrors.length > 0) throw new Error(`Invalid game settings:\n- ${configErrors.join('\n- ')}`);
}

/**
 * Own-property check. userIds come from chat (e.g. TikTok uniqueId) and may be
 * "constructor" or "__proto__", which plain `obj[id]` would resolve via the prototype.
 */
export function hasAnswered(state: GameState, racerId: string): boolean {
  return Object.hasOwn(state.answers, racerId);
}

/** True when this message is a racer's answer to the open question (the chat feed masks these). */
export function isLockedAnswer(state: GameState, message: ChatMessage): boolean {
  const question = state.questions[state.round];
  if (state.phase !== 'question' || question === undefined) return false;
  if (!state.racers.some((r) => r.id === message.userId.trim())) return false;
  return parseAnswer(message.text, question.choices) !== null;
}

export function createGame(opts: CreateGameOptions): GameState {
  const config = opts.config ?? DEFAULT_CONFIG;
  assertUsable(opts.bank, config);
  const game: GameState = {
    config,
    bank: opts.bank,
    phase: 'lobby',
    phaseStartedAt: opts.now,
    phaseEndsAt: null,
    seed: opts.seed >>> 0,
    level: opts.level ?? 'B1',
    raceNumber: 1,
    racers: [],
    queue: [],
    round: 0,
    questions: [],
    answers: {},
    lastReveal: null,
    race: null,
    standings: null,
    session: {},
    usedQuestionIds: [],
    pending: null,
    blocked: [],
  };
  return opts.blocked === undefined ? game : setBlocked(game, opts.blocked, opts.now);
}

export function reduce(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'chat':
      return handleChat(state, action.message, action.now);
    case 'tick':
      return state.phaseEndsAt !== null && action.now >= state.phaseEndsAt ? advance(state, action.now) : state;
    case 'hostStart':
      return state.phase === 'lobby' && state.racers.length > 0 ? advance(state, action.now) : state;
    case 'hostSkip':
      return state.phase === 'lobby' && state.racers.length === 0 ? state : advance(state, action.now);
    case 'hostReset':
      return toLobby({ ...state, queue: [] }, [], action.now, state.raceNumber);
    case 'setLevel':
      return state.phase === 'lobby' ? { ...state, level: action.level } : state;
    case 'configure':
      return configure(state, action.config, action.level, action.now);
    case 'kick':
      return removeUsers(state, new Set([action.userId.trim()]), action.now);
    case 'setBlocked':
      return setBlocked(state, action.blocked, action.now);
    case 'clearSession':
      return { ...state, session: {} };
  }
}

// ---------------------------------------------------------------- chat

function toPlayer(message: ChatMessage): Player | null {
  const id = message.userId.trim();
  const name = message.nickname.trim().slice(0, MAX_NAME_LENGTH);
  return id === '' || name === '' ? null : { id, name };
}

function handleChat(state: GameState, message: ChatMessage, now: number): GameState {
  const player = toPlayer(message);
  if (player === null || isBlocked(state, player.id)) return state;
  const isRacer = state.racers.some((r) => r.id === player.id);
  const wantsIn = matchesJoinKeyword(message.text, state.config.joinKeyword);
  if (state.phase === 'lobby') return isRacer || !wantsIn ? state : joinLobby(state, player, now);
  // Anyone asking to join during the race or results (current racers included) rides next.
  if (state.phase === 'race' || state.phase === 'results') return wantsIn ? enqueue(state, player) : state;
  if (!isRacer) return wantsIn ? enqueue(state, player) : state;
  return state.phase === 'question' ? recordAnswer(state, player.id, message.text, now) : state;
}

function joinLobby(state: GameState, player: Player, now: number): GameState {
  if (state.racers.length >= state.config.maxRacers) return enqueue(state, player);
  const racers = [...state.racers, makeRacer(player, state.racers.length)];
  return { ...state, racers, phaseEndsAt: lobbyDeadline(state, racers.length, now) };
}

function enqueue(state: GameState, player: Player): GameState {
  const alreadyQueued = state.queue.some((p) => p.id === player.id);
  if (alreadyQueued || state.queue.length >= state.config.maxQueue) return state;
  return { ...state, queue: [...state.queue, player] };
}

function recordAnswer(state: GameState, racerId: string, text: string, now: number): GameState {
  if (hasAnswered(state, racerId)) return state;
  // Deadline is enforced here too, not only on tick: a throttled host tab must not stretch the window.
  if (state.phaseEndsAt !== null && now >= state.phaseEndsAt) return state;
  const question = state.questions[state.round];
  if (question === undefined) return state;
  const choice = parseAnswer(text, question.choices);
  if (choice === null) return state;

  return closeIfAllAnswered({ ...state, answers: { ...state.answers, [racerId]: choice } }, now);
}

// ---------------------------------------------------------------- phases

function advance(state: GameState, now: number): GameState {
  switch (state.phase) {
    case 'lobby':
      return startQuestions(state, now);
    case 'question':
      return revealAnswer(state, now);
    case 'reveal':
      return state.round + 1 < state.questions.length ? nextQuestion(state, now) : startRace(state, now);
    case 'race':
      return showResults(state, now);
    case 'results':
      return toLobby(state, state.queue, now, state.raceNumber + 1);
  }
}

function startQuestions(state: GameState, now: number): GameState {
  const picked = pickRoundQuestions(state.bank, {
    level: state.level,
    count: state.config.roundsPerRace,
    statRotation: state.config.statRotation,
    seed: state.seed,
    usedIds: state.usedQuestionIds,
    excludedIds: state.config.disabledQuestionIds,
  });
  return enterPhase({
    ...state,
    seed: picked.seed,
    usedQuestionIds: picked.usedIds,
    questions: picked.questions,
    round: 0,
    answers: {},
    lastReveal: null,
  }, 'question', now, state.config.questionMs);
}

function nextQuestion(state: GameState, now: number): GameState {
  return enterPhase({ ...state, round: state.round + 1, answers: {} }, 'question', now, state.config.questionMs);
}

function revealAnswer(state: GameState, now: number): GameState {
  const question = state.questions[state.round];
  if (question === undefined) throw new Error(`No question for round ${state.round}`);

  const points = state.config.pointsPerCorrect;
  const correctIds = state.racers
    .filter((r) => hasAnswered(state, r.id) && state.answers[r.id] === question.answer)
    .map((r) => r.id);
  const correctSet = new Set(correctIds);
  const racers = state.racers.map((r) => (correctSet.has(r.id)
    ? { ...r, correct: r.correct + 1, stats: { ...r.stats, [question.stat]: r.stats[question.stat] + points } }
    : r));

  return enterPhase({
    ...state,
    racers,
    lastReveal: {
      round: state.round,
      stat: question.stat,
      points,
      correctIndex: question.answer,
      correctIds,
      answeredCount: Object.keys(state.answers).length,
    },
  }, 'reveal', now, state.config.revealMs);
}

function startRace(state: GameState, now: number): GameState {
  // Physics are tuned for one scale; map stats onto it so any questions-per-race setting stays fair.
  const maxPerStat = maxPointsPerStat(state.config);
  const entries = state.racers.map((r) => ({ id: r.id, stats: scaleStats(r.stats, maxPerStat) }));
  const race = simulateRace(entries, state.seed);
  const { raceCountdownMs, raceOutroMs } = state.config;
  return enterPhase(
    { ...state, race, seed: nextRandom(state.seed).seed },
    'race', now, raceCountdownMs + race.durationMs + raceOutroMs,
  );
}

function buildStandings(state: GameState): Standing[] {
  const race = state.race;
  if (race === null) return [];
  return race.finishOrder.flatMap((racerId, index) => {
    const racer = state.racers.find((r) => r.id === racerId);
    const lane = race.lanes.find((l) => l.racerId === racerId);
    if (racer === undefined || lane === undefined) return [];
    return [{
      place: index + 1, racerId, name: racer.name, color: racer.color,
      finishTimeMs: lane.finishTimeMs, correct: racer.correct,
    }];
  });
}

function updateSession(
  session: GameState['session'], standings: readonly Standing[],
): Readonly<Record<string, SessionRecord>> {
  return standings.reduce<Record<string, SessionRecord>>((acc, s) => {
    const prev = Object.hasOwn(acc, s.racerId) && acc[s.racerId]
      ? acc[s.racerId]!
      : { name: s.name, races: 0, wins: 0, podiums: 0, correct: 0 };
    return {
      ...acc,
      [s.racerId]: {
        name: s.name,
        races: prev.races + 1,
        wins: prev.wins + (s.place === 1 ? 1 : 0),
        podiums: prev.podiums + (s.place <= 3 ? 1 : 0),
        correct: prev.correct + s.correct,
      },
    };
  }, { ...session });
}

function showResults(state: GameState, now: number): GameState {
  const standings = buildStandings(state);
  return enterPhase(
    { ...state, standings, session: updateSession(state.session, standings) },
    'results', now, state.config.resultsMs,
  );
}
