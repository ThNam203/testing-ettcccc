import { describe, expect, test } from 'vitest';
import { QUESTION_BANK } from '../src/content/questions';
import { DEFAULT_CONFIG, maxPointsPerStat } from '../src/engine/config';
import {
  CONFIG_LIMITS, NUMERIC_CONFIG_KEYS, enabledQuestionCounts, joinPrompt, matchesJoinKeyword, normaliseKeyword, validateConfig,
} from '../src/engine/configRules';
import type { GameConfig } from '../src/engine/types';

function issues(patch: Partial<GameConfig>): string[] {
  return validateConfig({ ...DEFAULT_CONFIG, ...patch }, QUESTION_BANK).map((i) => `${i.field}: ${i.message}`);
}

describe('validateConfig', () => {
  test('the default config is valid', () => {
    expect(issues({})).toEqual([]);
  });

  test('every number is checked against its range and must be whole', () => {
    for (const key of NUMERIC_CONFIG_KEYS) {
      const { min, max } = CONFIG_LIMITS[key];
      const low = key === 'minRacersToStart' ? { [key]: min - 1 } : { [key]: min - 1, minRacersToStart: 1 };
      expect(issues(low).some((m) => m.startsWith(`${key}:`)), `${key} below`).toBe(true);
      expect(issues({ [key]: max + 1 }).some((m) => m.startsWith(`${key}:`)), `${key} above`).toBe(true);
      expect(issues({ [key]: min + 0.5 }).some((m) => m.startsWith(`${key}: must be a whole`)), `${key} fraction`).toBe(true);
    }
  });

  test('minimum riders cannot exceed max riders', () => {
    expect(issues({ maxRacers: 4, minRacersToStart: 5 })).toContain('minRacersToStart: cannot be more than max riders');
  });

  test('questions per race must be a multiple of 3 between 3 and 12', () => {
    expect(issues({ roundsPerRace: 9 })).toEqual([]);
    expect(issues({ roundsPerRace: 4 }).some((m) => m.startsWith('roundsPerRace'))).toBe(true);
  });

  test('stat rotation must cover each stat once', () => {
    expect(issues({ statRotation: ['speed', 'speed', 'stamina'] }).some((m) => m.startsWith('statRotation'))).toBe(true);
  });

  test('join keyword: empty or normalised, not an answer letter, not too long', () => {
    expect(issues({ joinKeyword: 'join' })).toEqual([]);
    expect(issues({ joinKeyword: 'lets ride' })).toEqual([]);
    expect(issues({ joinKeyword: 'JOIN!' })[0]).toContain('"join"');
    expect(issues({ joinKeyword: 'b' })[0]).toContain('answers');
    expect(issues({ joinKeyword: 'x'.repeat(25) })[0]).toContain('at most');
  });

  test('unknown disabled ids and levels left too small are reported', () => {
    expect(issues({ disabledQuestionIds: ['nope'] })[0]).toContain('unknown question ids: nope');
    const b2 = QUESTION_BANK.filter((q) => q.level === 'B2').map((q) => q.id);
    expect(issues({ disabledQuestionIds: b2.slice(0, 15) })[0]).toContain('5 enabled B2');
    expect(issues({ disabledQuestionIds: b2.slice(0, 14) })).toEqual([]);
  });
});

describe('helpers', () => {
  test('enabledQuestionCounts counts per level minus disabled', () => {
    const one = QUESTION_BANK.find((q) => q.level === 'A2')!.id;
    expect(enabledQuestionCounts(QUESTION_BANK, [one])).toEqual({ A2: 19, B1: 20, B2: 20 });
  });

  test('normaliseKeyword drops case, punctuation and apostrophes', () => {
    expect(normaliseKeyword("  Let's   GO!! ")).toBe('lets go');
    expect(normaliseKeyword('I’m in')).toBe('im in');
  });

  test('matchesJoinKeyword matches whole words only; empty keyword matches anything', () => {
    expect(matchesJoinKeyword('whatever', '')).toBe(true);
    expect(matchesJoinKeyword('Count me in, JOIN!', 'join')).toBe(true);
    expect(matchesJoinKeyword('rejoin', 'join')).toBe(false);
  });

  test('joinPrompt tells viewers exactly what to type', () => {
    expect(joinPrompt('', 'lobby')).toBe('Type anything in chat to join! 🐎');
    expect(joinPrompt('join', 'lobby')).toBe('Type “join” in chat to join! 🐎');
    expect(joinPrompt('', 'next')).toBe('Chat now to ride in the next race!');
    expect(joinPrompt('lets go', 'next')).toBe('Type “lets go” now to ride in the next race!');
  });

  test('maxPointsPerStat follows questions per race and points per answer', () => {
    expect(maxPointsPerStat(DEFAULT_CONFIG)).toBe(20);
    expect(maxPointsPerStat({ ...DEFAULT_CONFIG, roundsPerRace: 12, pointsPerCorrect: 5 })).toBe(20);
    expect(maxPointsPerStat({ ...DEFAULT_CONFIG, roundsPerRace: 3 })).toBe(10);
  });
});
