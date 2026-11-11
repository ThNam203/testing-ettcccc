import { describe, expect, test } from 'vitest';
import { QUESTION_BANK } from '../src/content/questions';
import { STAT_KEYS } from '../src/engine/config';
import { pickRoundQuestions, validateBank } from '../src/engine/questions';
import type { Level, QuestionSource } from '../src/engine/types';

const LEVELS: readonly Level[] = ['A2', 'B1', 'B2'];

function makeQuestion(id: string, level: Level = 'A2'): QuestionSource {
  return {
    id,
    level,
    category: 'grammar',
    prompt: `Prompt ${id}`,
    choices: ['right', 'wrong one', 'wrong two', 'wrong three'],
    answer: 0,
    explanation: 'because',
  };
}

describe('validateBank', () => {
  test('the shipped question bank is valid', () => {
    expect(validateBank(QUESTION_BANK)).toEqual([]);
  });

  test('the shipped bank has at least 2 races worth of questions per level', () => {
    for (const level of LEVELS) {
      expect(QUESTION_BANK.filter((q) => q.level === level).length).toBeGreaterThanOrEqual(12);
    }
  });

  test('reports duplicate ids, duplicate choices, empty text and bad answer index', () => {
    const bad: QuestionSource[] = [
      makeQuestion('q1'),
      makeQuestion('q1'),
      { ...makeQuestion('q2'), choices: ['same', 'same', 'x', 'y'] },
      { ...makeQuestion('q3'), prompt: '  ' },
      { ...makeQuestion('q4'), answer: 7 as unknown as 0 },
    ];
    const errors = validateBank(bad);
    expect(errors.some((e) => e.includes('q1') && e.includes('duplicate id'))).toBe(true);
    expect(errors.some((e) => e.includes('q2') && e.includes('duplicate choices'))).toBe(true);
    expect(errors.some((e) => e.includes('q3') && e.includes('empty'))).toBe(true);
    expect(errors.some((e) => e.includes('q4') && e.includes('answer'))).toBe(true);
  });

  test('rejects choices that collide after answer normalisation, or that look like a letter', () => {
    const errors = validateBank([
      { ...makeQuestion('p1'), choices: ['Is', 'is.', 'are', 'am'] },
      { ...makeQuestion('p2'), choices: ['an', 'a', 'the', 'no article'] },
    ]);
    expect(errors.some((e) => e.includes('p1') && e.includes('duplicate choices'))).toBe(true);
    expect(errors.some((e) => e.includes('p2') && e.includes('letter'))).toBe(true);
  });
});

describe('pickRoundQuestions', () => {
  const bank = Array.from({ length: 10 }, (_, i) => makeQuestion(`q${i}`));

  test('picks the requested count at the requested level, no duplicates', () => {
    const result = pickRoundQuestions(QUESTION_BANK, {
      level: 'B1', count: 6, statRotation: STAT_KEYS, seed: 42, usedIds: [],
    });
    expect(result.questions).toHaveLength(6);
    expect(new Set(result.questions.map((q) => q.id)).size).toBe(6);
    expect(result.questions.every((q) => q.level === 'B1')).toBe(true);
  });

  test('assigns stats by rotating evenly through the stat list', () => {
    const result = pickRoundQuestions(bank, {
      level: 'A2', count: 6, statRotation: STAT_KEYS, seed: 1, usedIds: [],
    });
    expect(result.questions.map((q) => q.stat)).toEqual([
      'speed', 'stamina', 'strength', 'speed', 'stamina', 'strength',
    ]);
  });

  test('shuffling choices keeps the answer pointing at the same correct text', () => {
    for (let seed = 1; seed < 50; seed += 1) {
      const result = pickRoundQuestions(bank, {
        level: 'A2', count: 3, statRotation: STAT_KEYS, seed, usedIds: [],
      });
      for (const q of result.questions) {
        expect(q.choices[q.answer]).toBe('right');
      }
    }
  });

  test('correct answer slot is spread across A-D, not stuck in one position', () => {
    const slots = new Set<number>();
    for (let seed = 1; seed < 40; seed += 1) {
      const result = pickRoundQuestions(bank, {
        level: 'A2', count: 1, statRotation: STAT_KEYS, seed, usedIds: [],
      });
      slots.add(result.questions[0]!.answer);
    }
    expect(slots.size).toBe(4);
  });

  test('avoids recently used ids and recycles when the level runs out', () => {
    const first = pickRoundQuestions(bank, {
      level: 'A2', count: 6, statRotation: STAT_KEYS, seed: 3, usedIds: [],
    });
    const second = pickRoundQuestions(bank, {
      level: 'A2', count: 6, statRotation: STAT_KEYS, seed: first.seed, usedIds: first.usedIds,
    });
    const firstIds = new Set(first.questions.map((q) => q.id));
    const overlap = second.questions.filter((q) => firstIds.has(q.id));
    // 10 in bank, 6 used: 4 fresh ones must all be used before any repeat
    expect(overlap).toHaveLength(2);
    expect(new Set(second.questions.map((q) => q.id)).size).toBe(6);
  });

  test('is deterministic for the same seed', () => {
    const opts = { level: 'A2' as const, count: 4, statRotation: STAT_KEYS, seed: 99, usedIds: [] };
    expect(pickRoundQuestions(bank, opts)).toEqual(pickRoundQuestions(bank, opts));
  });

  test('throws when the level has fewer questions than one race needs', () => {
    expect(() => pickRoundQuestions(bank, {
      level: 'B2', count: 6, statRotation: STAT_KEYS, seed: 1, usedIds: [],
    })).toThrow(/B2/);
  });
});
