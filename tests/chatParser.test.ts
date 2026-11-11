import { describe, expect, test } from 'vitest';
import { parseAnswer } from '../src/engine/chatParser';

const CHOICES = ['have lived', 'lived', 'live', 'am living'] as const;

describe('parseAnswer', () => {
  test('accepts a single letter, any case, with surrounding spaces', () => {
    expect(parseAnswer('a', CHOICES)).toBe(0);
    expect(parseAnswer(' B ', CHOICES)).toBe(1);
    expect(parseAnswer('c', CHOICES)).toBe(2);
    expect(parseAnswer('D', CHOICES)).toBe(3);
  });

  test('accepts letter with common punctuation like "A." "(b)" "c)"', () => {
    expect(parseAnswer('A.', CHOICES)).toBe(0);
    expect(parseAnswer('(b)', CHOICES)).toBe(1);
    expect(parseAnswer('c)', CHOICES)).toBe(2);
    expect(parseAnswer('d!', CHOICES)).toBe(3);
  });

  test('accepts the exact choice text, ignoring case, punctuation and extra spaces', () => {
    expect(parseAnswer('Have  Lived', CHOICES)).toBe(0);
    expect(parseAnswer('am living!', CHOICES)).toBe(3);
  });

  test('returns null for chatter that is not an answer', () => {
    expect(parseAnswer('hello everyone', CHOICES)).toBeNull();
    expect(parseAnswer('e', CHOICES)).toBeNull();
    expect(parseAnswer('ab', CHOICES)).toBeNull();
    expect(parseAnswer('a b', CHOICES)).toBeNull();
    expect(parseAnswer('', CHOICES)).toBeNull();
    expect(parseAnswer('   ', CHOICES)).toBeNull();
  });

  test('does not treat a sentence starting with "a" as answer A', () => {
    expect(parseAnswer('a horse is cool', CHOICES)).toBeNull();
  });
});
