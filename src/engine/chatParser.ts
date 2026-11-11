const LETTERS: readonly string[] = ['a', 'b', 'c', 'd'];

/** Lowercase, drop punctuation, collapse whitespace. Shared with bank validation. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn a chat line into a choice index, or null if it is not an answer.
 * Accepts a lone letter ("b", "B.", "(c)") or the exact choice text.
 */
export function parseAnswer(text: string, choices: readonly string[]): number | null {
  const cleaned = normalise(text);
  if (cleaned.length === 0) return null;

  const letterIndex = LETTERS.indexOf(cleaned);
  if (letterIndex !== -1 && letterIndex < choices.length) return letterIndex;

  const choiceIndex = choices.findIndex((choice) => normalise(choice) === cleaned);
  return choiceIndex === -1 ? null : choiceIndex;
}
