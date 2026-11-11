/**
 * Pure seeded RNG (mulberry32). Seeds are carried in game state so every
 * outcome is reproducible from (state, actions).
 */
export interface RandomResult {
  readonly value: number;
  readonly seed: number;
}

const UINT32 = 0x1_0000_0000;

export function nextRandom(seed: number): RandomResult {
  const nextSeed = (seed + 0x6d2b79f5) >>> 0;
  let t = nextSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32;
  return { value, seed: nextSeed };
}

export interface ShuffleResult<T> {
  readonly items: readonly T[];
  readonly seed: number;
}

/** Fisher–Yates on a copy; input is never mutated. */
export function shuffle<T>(items: readonly T[], seed: number): ShuffleResult<T> {
  const copy = [...items];
  let current = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const r = nextRandom(current);
    current = r.seed;
    const j = Math.floor(r.value * (i + 1));
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return { items: copy, seed: current };
}
