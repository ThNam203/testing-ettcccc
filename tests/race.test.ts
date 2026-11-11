import { describe, expect, test } from 'vitest';
import { DEFAULT_CONFIG, STAT_KEYS } from '../src/engine/config';
import { RACE, TUNED_MAX_PER_STAT, scaleStats, simulateRace } from '../src/engine/race';
import type { StatKey, Stats } from '../src/engine/types';

const POINTS = DEFAULT_CONFIG.pointsPerCorrect;
const MAX_PER_STAT = (DEFAULT_CONFIG.roundsPerRace / STAT_KEYS.length) * POINTS;

function stats(speed: number, stamina: number, strength: number): Stats {
  return { speed, stamina, strength };
}

function finishTime(s: Stats, seed = 1): number {
  const result = simulateRace([{ id: 'solo', stats: s }], seed);
  return result.lanes[0]!.finishTimeMs;
}

/** Finish time with luck removed: average over many seeds would be slow, so compare two horses in one race. */
function withBonus(base: Stats, stat: StatKey): Stats {
  return { ...base, [stat]: base[stat] + POINTS };
}

describe('simulateRace', () => {
  test('is deterministic for the same entries and seed', () => {
    const entries = [
      { id: 'a', stats: stats(10, 0, 20) },
      { id: 'b', stats: stats(0, 20, 10) },
    ];
    expect(simulateRace(entries, 7)).toEqual(simulateRace(entries, 7));
  });

  test('every horse finishes, finish order is sorted by finish time', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      id: `h${i}`, stats: stats((i % 3) * 10, ((i + 1) % 3) * 10, ((i + 2) % 3) * 10),
    }));
    const result = simulateRace(entries, 5);
    expect(result.finishOrder).toHaveLength(12);
    const times = result.finishOrder.map((id) => result.lanes.find((l) => l.racerId === id)!.finishTimeMs);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(result.durationMs).toBe(Math.max(...times));
  });

  test('positions are sampled, start at 0, never go backwards, and pass the finish line', () => {
    const result = simulateRace([{ id: 'a', stats: stats(0, 0, 0) }], 1);
    const positions = result.lanes[0]!.positions;
    expect(positions[0]).toBe(0);
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]!).toBeGreaterThanOrEqual(positions[i - 1]!);
    }
    expect(positions[positions.length - 1]!).toBeGreaterThan(RACE.distance);
    const expectedSamples = Math.ceil(((result.durationMs + RACE.runOutMs) / 1000) * result.sampleHz) + 1;
    expect(positions.length).toBe(expectedSamples);
  });

  test('race length suits a live stream: 25–45 seconds across the stat range', () => {
    const slowest = finishTime(stats(0, 0, 0));
    const fastest = finishTime(stats(MAX_PER_STAT, MAX_PER_STAT, MAX_PER_STAT));
    expect(slowest).toBeLessThan(45_000);
    expect(fastest).toBeGreaterThan(25_000);
  });

  test('every stat point helps: each +10 is strictly faster, for every stat, across the whole range', () => {
    for (const stat of STAT_KEYS) {
      for (let v = 0; v < MAX_PER_STAT; v += POINTS) {
        const base = stats(10, 10, 10);
        const before = { ...base, [stat]: v };
        const after = { ...base, [stat]: v + POINTS };
        expect(finishTime(after), `${stat} ${v}->${v + POINTS}`).toBeLessThan(finishTime(before));
      }
    }
  });

  test('fairness: each stat gives a similar time gain (within 35% of each other)', () => {
    const base = stats(0, 0, 0);
    const baseTime = finishTime(base);
    const gains = STAT_KEYS.map((stat) => baseTime - finishTime(withBonus(base, stat)));
    const min = Math.min(...gains);
    const max = Math.max(...gains);
    expect(min).toBeGreaterThan(0);
    expect(max / min).toBeLessThan(1.35);
  });

  test('fairness: one extra correct answer always beats luck, for any stat, over many seeds', () => {
    const profiles: Stats[] = [stats(0, 0, 0), stats(10, 10, 10), stats(20, 10, 0), stats(0, 10, 20)];
    for (const base of profiles) {
      for (const stat of STAT_KEYS) {
        if (base[stat] + POINTS > MAX_PER_STAT) continue;
        for (let seed = 1; seed <= 400; seed += 1) {
          const result = simulateRace([
            { id: 'base', stats: base },
            { id: 'plus', stats: withBonus(base, stat) },
          ], seed);
          expect(result.finishOrder[0], `${JSON.stringify(base)} +${stat} seed ${seed}`).toBe('plus');
        }
      }
    }
  });

  test('equal stats: luck decides, and both horses win sometimes', () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const result = simulateRace([
        { id: 'x', stats: stats(10, 10, 10) },
        { id: 'y', stats: stats(10, 10, 10) },
      ], seed);
      winners.add(result.finishOrder[0]!);
    }
    expect(winners).toEqual(new Set(['x', 'y']));
  });

  test('scaleStats maps any points-per-stat maximum onto the tuned range', () => {
    expect(scaleStats(stats(40, 20, 0), 40)).toEqual(stats(TUNED_MAX_PER_STAT, TUNED_MAX_PER_STAT / 2, 0));
    expect(scaleStats(stats(10, 10, 10), 10)).toEqual(stats(20, 20, 20));
    expect(() => scaleStats(stats(0, 0, 0), 0)).toThrow();
  });

  test('fairness holds for 3, 9 and 12 question races: one extra correct answer beats luck', () => {
    for (const rounds of [3, 9, 12]) {
      const maxPerStat = (rounds / STAT_KEYS.length) * POINTS;
      for (const stat of STAT_KEYS) {
        for (let v = 0; v + POINTS <= maxPerStat; v += POINTS) {
          const base = stats(0, 0, 0);
          const before = { ...base, [stat]: v };
          const after = { ...base, [stat]: v + POINTS };
          for (let seed = 1; seed <= 150; seed += 1) {
            const result = simulateRace([
              { id: 'base', stats: scaleStats(before, maxPerStat) },
              { id: 'plus', stats: scaleStats(after, maxPerStat) },
            ], seed);
            expect(result.finishOrder[0], `${rounds} rounds ${stat} ${v} seed ${seed}`).toBe('plus');
          }
        }
      }
    }
  });

  test('handles an empty field', () => {
    const result = simulateRace([], 1);
    expect(result.lanes).toEqual([]);
    expect(result.finishOrder).toEqual([]);
    expect(result.durationMs).toBe(0);
  });
});
