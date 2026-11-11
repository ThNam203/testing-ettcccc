import type { GameConfig, StatKey } from './types';

export const STAT_KEYS: readonly StatKey[] = ['speed', 'stamina', 'strength'];

export const DEFAULT_CONFIG: GameConfig = {
  maxRacers: 12,
  maxQueue: 500,
  roundsPerRace: 6,
  pointsPerCorrect: 10,
  lobbyMs: 30_000,
  questionMs: 15_000,
  allAnsweredGraceMs: 1_500,
  revealMs: 6_000,
  raceCountdownMs: 3_000,
  raceOutroMs: 3_000,
  resultsMs: 15_000,
  statRotation: STAT_KEYS,
  minRacersToStart: 1,
  joinKeyword: '',
  disabledQuestionIds: [],
};

/** Highest score one stat can reach in a race (stats rotate evenly, so this is the same for every stat). */
export function maxPointsPerStat(config: GameConfig): number {
  return Math.ceil(config.roundsPerRace / config.statRotation.length) * config.pointsPerCorrect;
}

/** Jockey silks, one per lane. High contrast on green grass and brown dirt. */
export const LANE_COLORS: readonly string[] = [
  '#e6194b', '#3cb4ff', '#ffe119', '#f58231', '#911eb4', '#46f0f0',
  '#f032e6', '#bcf60c', '#fabebe', '#ffffff', '#4363d8', '#aaffc3',
];

export const ZERO_STATS = { speed: 0, stamina: 0, strength: 0 } as const;
