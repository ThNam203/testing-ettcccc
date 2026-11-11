import { normalise } from './chatParser';
import { LANE_COLORS, STAT_KEYS } from './config';
import type { GameConfig, Level, QuestionSource } from './types';

export const LEVELS: readonly Level[] = ['A2', 'B1', 'B2'];

export interface NumberRule {
  readonly min: number;
  readonly max: number;
}

export type NumericConfigKey =
  | 'maxRacers' | 'minRacersToStart' | 'maxQueue' | 'pointsPerCorrect'
  | 'lobbyMs' | 'questionMs' | 'allAnsweredGraceMs' | 'revealMs'
  | 'raceCountdownMs' | 'raceOutroMs' | 'resultsMs';

/**
 * Allowed ranges. Lanes are capped by the track and silk colours (12).
 * Timings are milliseconds; the admin page edits them in seconds.
 */
export const CONFIG_LIMITS: Readonly<Record<NumericConfigKey, NumberRule>> = {
  maxRacers: { min: 1, max: LANE_COLORS.length },
  minRacersToStart: { min: 1, max: LANE_COLORS.length },
  maxQueue: { min: 0, max: 1_000 },
  pointsPerCorrect: { min: 1, max: 100 },
  lobbyMs: { min: 5_000, max: 300_000 },
  questionMs: { min: 5_000, max: 60_000 },
  allAnsweredGraceMs: { min: 0, max: 5_000 },
  revealMs: { min: 2_000, max: 30_000 },
  raceCountdownMs: { min: 0, max: 10_000 },
  raceOutroMs: { min: 0, max: 15_000 },
  resultsMs: { min: 5_000, max: 120_000 },
};

export const NUMERIC_CONFIG_KEYS = Object.keys(CONFIG_LIMITS) as readonly NumericConfigKey[];

/** Questions per race must be a multiple of the stat count so every stat gets the same number of rounds. */
export const ROUND_OPTIONS: readonly number[] = [3, 6, 9, 12];

export const MAX_KEYWORD_LENGTH = 24;
const LETTER_KEYWORDS = new Set(['a', 'b', 'c', 'd']);

export interface ConfigIssue {
  readonly field: keyof GameConfig;
  readonly message: string;
}

/** Enabled (not switched off) questions per level. */
export function enabledQuestionCounts(
  bank: readonly QuestionSource[], disabledIds: readonly string[],
): Readonly<Record<Level, number>> {
  const disabled = new Set(disabledIds);
  const count = (level: Level): number => bank.filter((q) => q.level === level && !disabled.has(q.id)).length;
  return { A2: count('A2'), B1: count('B1'), B2: count('B2') };
}

function numberIssues(config: GameConfig): ConfigIssue[] {
  return NUMERIC_CONFIG_KEYS.flatMap((field): ConfigIssue[] => {
    const value = config[field];
    const { min, max } = CONFIG_LIMITS[field];
    if (!Number.isInteger(value)) return [{ field, message: 'must be a whole number' }];
    if (value < min || value > max) return [{ field, message: `must be between ${min} and ${max}` }];
    return [];
  });
}

function keywordIssues(keyword: string): ConfigIssue[] {
  if (keyword === '') return [];
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return [{ field: 'joinKeyword', message: `must be at most ${MAX_KEYWORD_LENGTH} characters` }];
  }
  if (normaliseKeyword(keyword) !== keyword) {
    return [{ field: 'joinKeyword', message: `use lowercase letters, numbers and single spaces (e.g. "${normaliseKeyword(keyword)}")` }];
  }
  if (LETTER_KEYWORDS.has(keyword)) {
    return [{ field: 'joinKeyword', message: 'cannot be a, b, c or d — those are answers' }];
  }
  return [];
}

function questionIssues(config: GameConfig, bank: readonly QuestionSource[]): ConfigIssue[] {
  const known = new Set(bank.map((q) => q.id));
  const unknown = config.disabledQuestionIds.filter((id) => !known.has(id));
  const issues: ConfigIssue[] = unknown.length > 0
    ? [{ field: 'disabledQuestionIds', message: `unknown question ids: ${unknown.slice(0, 5).join(', ')}` }]
    : [];
  const counts = enabledQuestionCounts(bank, config.disabledQuestionIds);
  for (const level of LEVELS) {
    if (counts[level] < config.roundsPerRace) {
      issues.push({
        field: 'disabledQuestionIds',
        message: `the question bank has only ${counts[level]} enabled ${level} questions; a race needs ${config.roundsPerRace}`,
      });
    }
  }
  return issues;
}

/** Every rule a config must satisfy. Empty array = valid. Used by the engine, the host and the admin page. */
export function validateConfig(config: GameConfig, bank: readonly QuestionSource[]): ConfigIssue[] {
  const issues = numberIssues(config);
  if (config.minRacersToStart > config.maxRacers) {
    issues.push({ field: 'minRacersToStart', message: 'cannot be more than max riders' });
  }
  if (!ROUND_OPTIONS.includes(config.roundsPerRace)) {
    issues.push({ field: 'roundsPerRace', message: `must be one of ${ROUND_OPTIONS.join(', ')}` });
  }
  const rotation = new Set(config.statRotation);
  if (config.statRotation.length !== STAT_KEYS.length || STAT_KEYS.some((k) => !rotation.has(k))) {
    issues.push({ field: 'statRotation', message: 'must list speed, stamina and strength once each' });
  }
  return [...issues, ...keywordIssues(config.joinKeyword), ...questionIssues(config, bank)];
}

/** What to tell viewers on screen: in the lobby, or on the results screen for the next race. */
export function joinPrompt(keyword: string, when: 'lobby' | 'next'): string {
  if (when === 'lobby') return keyword === '' ? 'Type anything in chat to join! 🐎' : `Type “${keyword}” in chat to join! 🐎`;
  return keyword === '' ? 'Chat now to ride in the next race!' : `Type “${keyword}” now to ride in the next race!`;
}

/** Keyword form of any text: answer normalisation without apostrophes ("Let's GO!" -> "lets go"). */
export function normaliseKeyword(text: string): string {
  return normalise(text.replace(/['\u2019]/g, ''));
}

/** True when the chat line asks to join (whole-word match on the keyword form). */
export function matchesJoinKeyword(text: string, keyword: string): boolean {
  if (keyword === '') return true;
  return ` ${normaliseKeyword(text)} `.includes(` ${keyword} `);
}
