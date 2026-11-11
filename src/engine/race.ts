import { nextRandom } from './rng';
import type { LaneResult, RaceResult, Stats } from './types';

/**
 * Race physics constants. Tuned so that (see tests/race.test.ts):
 *  - a race lasts ~30–40 s,
 *  - +10 points in any stat is worth a similar amount of time,
 *  - +10 points always beats the maximum luck swing.
 */
export const RACE = {
  distance: 450,
  simHz: 60,
  sampleHz: 20,
  runOutMs: 4_000,
  maxSimMs: 180_000,
  baseTopSpeed: 14,
  topSpeedPerPoint: 0.045,
  /** Seconds from standstill to top speed; Strength shortens it linearly. */
  baseTimeToTopSpeed: 11,
  timeToTopSpeedPerPoint: 0.3,
  /** Pool is sized so even max Stamina runs out before the line: every point counts. */
  baseStamina: 30,
  staminaPerPoint: 1.6,
  /** Stamina used per second at full top speed (scales with (v/top)^2). */
  drainPerSecond: 3,
  /** Speed once stamina is empty, as a share of top speed. */
  fatigueRatio: 0.8,
  decel: 2.5,
  runOutSpeed: 4,
  /** Max ± share of top speed from luck. */
  luck: 0.005,
} as const;

/** Points per stat the physics above were tuned for (6 questions x 10 points / 3 stats). */
export const TUNED_MAX_PER_STAT = 20;

/**
 * Map raw stats onto the tuned range, so that changing questions-per-race or points-per-answer
 * never breaks the balance: what counts is the share of a stat's maximum a rider earned.
 */
export function scaleStats(stats: Stats, maxPerStat: number): Stats {
  if (!(maxPerStat > 0)) throw new Error(`maxPerStat must be positive, got ${maxPerStat}`);
  const factor = TUNED_MAX_PER_STAT / maxPerStat;
  return { speed: stats.speed * factor, stamina: stats.stamina * factor, strength: stats.strength * factor };
}

export interface RaceEntry {
  readonly id: string;
  readonly stats: Stats;
}

interface HorseParams {
  readonly topSpeed: number;
  readonly accel: number;
  readonly stamina: number;
}

interface HorseRun {
  readonly finishTimeMs: number;
  readonly positions: readonly number[];
}

function toParams(stats: Stats, luck: number): HorseParams {
  const topSpeed = (RACE.baseTopSpeed + stats.speed * RACE.topSpeedPerPoint) * (1 + luck);
  const timeToTop = RACE.baseTimeToTopSpeed - stats.strength * RACE.timeToTopSpeedPerPoint;
  return {
    topSpeed,
    accel: topSpeed / timeToTop,
    stamina: RACE.baseStamina + stats.stamina * RACE.staminaPerPoint,
  };
}

/**
 * Integrates one horse. Runs until it finishes (when totalMs is null) or for exactly totalMs,
 * recording a sample every simHz/sampleHz steps.
 */
function runHorse(p: HorseParams, totalMs: number | null): HorseRun {
  const dt = 1 / RACE.simHz;
  const stepsPerSample = RACE.simHz / RACE.sampleHz;
  const sampleCount = totalMs === null ? 0 : Math.ceil((totalMs / 1000) * RACE.sampleHz) + 1;
  const maxSteps = totalMs === null
    ? Math.ceil((RACE.maxSimMs / 1000) * RACE.simHz)
    : (sampleCount - 1) * stepsPerSample;

  const positions: number[] = totalMs === null ? [] : [0];
  let pos = 0;
  let v = 0;
  let energy = p.stamina;
  let finishTimeMs = Number.POSITIVE_INFINITY;

  for (let step = 1; step <= maxSteps; step += 1) {
    const finished = Number.isFinite(finishTimeMs);
    const target = finished ? RACE.runOutSpeed : energy > 0 ? p.topSpeed : p.topSpeed * RACE.fatigueRatio;
    v = v < target ? Math.min(target, v + p.accel * dt) : Math.max(target, v - RACE.decel * dt);
    if (!finished) energy = Math.max(0, energy - RACE.drainPerSecond * (v / p.topSpeed) ** 2 * dt);

    const prev = pos;
    pos += v * dt;

    if (!finished && pos >= RACE.distance) {
      const fraction = (RACE.distance - prev) / (pos - prev);
      finishTimeMs = ((step - 1 + fraction) * dt) * 1000;
      if (totalMs === null) break;
    }
    if (totalMs !== null && step % stepsPerSample === 0) positions.push(pos);
  }

  if (!Number.isFinite(finishTimeMs)) {
    throw new Error('Race simulation did not finish within maxSimMs; check RACE constants');
  }
  return { finishTimeMs, positions };
}

/** Deterministic race: same entries + seed => identical result. */
export function simulateRace(entries: readonly RaceEntry[], seed: number): RaceResult {
  let current = seed;
  const params = entries.map((entry) => {
    const r = nextRandom(current);
    current = r.seed;
    return toParams(entry.stats, (r.value * 2 - 1) * RACE.luck);
  });

  const finishTimes = params.map((p) => runHorse(p, null).finishTimeMs);
  const durationMs = finishTimes.length === 0 ? 0 : Math.max(...finishTimes);

  const lanes: LaneResult[] = entries.map((entry, i) => {
    const run = runHorse(params[i]!, durationMs + RACE.runOutMs);
    return { racerId: entry.id, finishTimeMs: finishTimes[i]!, positions: run.positions };
  });

  const finishOrder = lanes
    .map((lane, index) => ({ lane, index }))
    .sort((a, b) => a.lane.finishTimeMs - b.lane.finishTimeMs || a.index - b.index)
    .map(({ lane }) => lane.racerId);

  return { seed, distance: RACE.distance, sampleHz: RACE.sampleHz, durationMs, lanes, finishOrder };
}
