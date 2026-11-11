import { describe, expect, test } from 'vitest';
import { frameAt, runningOrder } from '../src/engine/playback';
import { simulateRace } from '../src/engine/race';
import type { RaceResult } from '../src/engine/types';

const handmade: RaceResult = {
  seed: 1,
  distance: 10,
  sampleHz: 2, // one sample every 500 ms
  durationMs: 1500,
  finishOrder: ['b', 'a'],
  lanes: [
    { racerId: 'a', finishTimeMs: 1500, positions: [0, 2, 6, 10, 12] },
    { racerId: 'b', finishTimeMs: 1000, positions: [0, 4, 10, 12, 13] },
  ],
};

describe('frameAt', () => {
  test('interpolates between samples and derives speed', () => {
    const [a] = frameAt(handmade, 750);
    expect(a!.position).toBeCloseTo(4);
    expect(a!.speed).toBeCloseTo(8); // (6-2) m per 0.5 s
    expect(a!.finished).toBe(false);
  });

  test('clamps before start and after the last sample', () => {
    expect(frameAt(handmade, -500)[0]!.position).toBe(0);
    const end = frameAt(handmade, 99_000)[1]!;
    expect(end.position).toBe(13);
    expect(end.speed).toBe(0);
    expect(end.finished).toBe(true);
  });

  test('handles a lane with no samples', () => {
    const empty: RaceResult = { ...handmade, lanes: [{ racerId: 'x', finishTimeMs: 0, positions: [] }] };
    expect(frameAt(empty, 100)[0]).toMatchObject({ position: 0, speed: 0 });
  });
});

describe('runningOrder', () => {
  test('leader by distance mid-race', () => {
    expect(runningOrder(handmade, 400)).toEqual(['b', 'a']);
  });

  test('finished horses are ordered by finish, ahead of those still running', () => {
    expect(runningOrder(handmade, 1200)).toEqual(['b', 'a']);
    expect(runningOrder(handmade, 5000)).toEqual(['b', 'a']);
  });

  test('final order of a simulated race matches its finish order', () => {
    const race = simulateRace([
      { id: 'x', stats: { speed: 0, stamina: 0, strength: 0 } },
      { id: 'y', stats: { speed: 20, stamina: 20, strength: 20 } },
      { id: 'z', stats: { speed: 10, stamina: 10, strength: 10 } },
    ], 3);
    expect(runningOrder(race, race.durationMs + 1)).toEqual(race.finishOrder);
  });
});
