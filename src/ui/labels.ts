import type { Level, Phase, StatKey } from '../engine/types';

export const STAT_LABEL: Readonly<Record<StatKey, string>> = {
  speed: '⚡ Speed',
  stamina: '🔋 Stamina',
  strength: '💪 Strength',
};

export const STAT_SHORT: Readonly<Record<StatKey, string>> = {
  speed: 'SPD',
  stamina: 'STA',
  strength: 'STR',
};

export const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  lobby: 'Join now',
  question: 'Training',
  reveal: 'Answer',
  race: 'Race!',
  results: 'Results',
};

export const LEVEL_LABEL: Readonly<Record<Level, string>> = {
  A2: 'A2 · Elementary',
  B1: 'B1 · Intermediate',
  B2: 'B2 · Upper-intermediate',
};

export const LETTERS: readonly string[] = ['A', 'B', 'C', 'D'];
