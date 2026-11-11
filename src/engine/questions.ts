import { normalise } from './chatParser';
import { shuffle } from './rng';
import type { Level, QuestionSource, RoundQuestion, StatKey } from './types';

const LETTER_CHOICES = new Set(['a', 'b', 'c', 'd']);

/** Returns human-readable problems; empty array = bank is valid. */
export function validateBank(bank: readonly QuestionSource[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const q of bank) {
    if (seen.has(q.id)) errors.push(`${q.id}: duplicate id`);
    seen.add(q.id);

    if (q.prompt.trim() === '' || q.explanation.trim() === '' || q.choices.some((c) => c.trim() === '')) {
      errors.push(`${q.id}: empty prompt, explanation or choice`);
    }
    // Same normalisation as answer parsing, so every choice stays typeable and unambiguous.
    const normalised = q.choices.map(normalise);
    if (new Set(normalised).size !== normalised.length) errors.push(`${q.id}: duplicate choices`);
    if (normalised.some((c) => LETTER_CHOICES.has(c))) {
      errors.push(`${q.id}: a choice reads like a letter (a-d); typing it would pick the wrong slot`);
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      errors.push(`${q.id}: answer index out of range`);
    }
  }
  return errors;
}

export interface PickOptions {
  readonly level: Level;
  readonly count: number;
  readonly statRotation: readonly StatKey[];
  readonly seed: number;
  readonly usedIds: readonly string[];
  /** Question ids switched off by the host. */
  readonly excludedIds?: readonly string[];
}

export interface PickResult {
  readonly questions: readonly RoundQuestion[];
  readonly seed: number;
  readonly usedIds: readonly string[];
}

type Choices = QuestionSource['choices'];
type AnswerIndex = QuestionSource['answer'];
const CHOICE_SLOTS: readonly AnswerIndex[] = [0, 1, 2, 3];

function shuffleChoices(q: QuestionSource, stat: StatKey, seed: number): { question: RoundQuestion; seed: number } {
  const order = shuffle(CHOICE_SLOTS, seed);
  const [a, b, c, d] = order.items;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error(`Question ${q.id}: expected 4 choices`);
  }
  const choices: Choices = [q.choices[a], q.choices[b], q.choices[c], q.choices[d]];
  const answer = CHOICE_SLOTS[order.items.indexOf(q.answer)];
  if (answer === undefined) throw new Error(`Question ${q.id}: answer missing after shuffle`);
  return { question: { ...q, choices, answer, stat }, seed: order.seed };
}

/**
 * Pick `count` questions for one race at `level`.
 * Unused questions come first; once a level is exhausted its used list is recycled.
 * Choices are shuffled so the correct letter varies.
 */
export function pickRoundQuestions(bank: readonly QuestionSource[], opts: PickOptions): PickResult {
  const excluded = new Set(opts.excludedIds ?? []);
  const pool = bank.filter((q) => q.level === opts.level && !excluded.has(q.id));
  if (pool.length < opts.count) {
    throw new Error(`Question bank has ${pool.length} enabled ${opts.level} questions, need at least ${opts.count}`);
  }

  const used = new Set(opts.usedIds);
  const fresh = shuffle(pool.filter((q) => !used.has(q.id)), opts.seed);
  const recycled = shuffle(pool.filter((q) => used.has(q.id)), fresh.seed);
  const chosen = [...fresh.items, ...recycled.items].slice(0, opts.count);

  let seed = recycled.seed;
  const questions: RoundQuestion[] = chosen.map((q, i) => {
    const stat = opts.statRotation[i % opts.statRotation.length]!;
    const result = shuffleChoices(q, stat, seed);
    seed = result.seed;
    return result.question;
  });

  const chosenIds = new Set(chosen.map((q) => q.id));
  const levelIds = new Set(pool.map((q) => q.id));
  const stillUnused = pool.filter((q) => !used.has(q.id) && !chosenIds.has(q.id));
  // Level exhausted -> start a fresh cycle that remembers only this race.
  const usedIds = stillUnused.length === 0
    ? [...opts.usedIds.filter((id) => !levelIds.has(id)), ...chosenIds]
    : [...opts.usedIds, ...chosen.filter((q) => !used.has(q.id)).map((q) => q.id)];

  return { questions, seed, usedIds };
}
