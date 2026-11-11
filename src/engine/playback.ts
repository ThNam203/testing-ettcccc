import type { LaneResult, RaceResult } from './types';

export interface LaneFrame {
  readonly racerId: string;
  /** Metres from the start line. */
  readonly position: number;
  /** Metres per second at this moment. */
  readonly speed: number;
  readonly finished: boolean;
}

function sampleAt(lane: LaneResult, sampleHz: number, elapsedMs: number): { position: number; speed: number } {
  const last = lane.positions.length - 1;
  if (last < 0) return { position: 0, speed: 0 };
  const exact = Math.max(0, (elapsedMs / 1000) * sampleHz);
  const i = Math.min(Math.floor(exact), last);
  const j = Math.min(i + 1, last);
  const a = lane.positions[i]!;
  const b = lane.positions[j]!;
  const t = j === i ? 0 : exact - i;
  return { position: a + (b - a) * t, speed: (b - a) * sampleHz };
}

/** Where every horse is `elapsedMs` after the gates open. */
export function frameAt(race: RaceResult, elapsedMs: number): readonly LaneFrame[] {
  return race.lanes.map((lane) => ({
    racerId: lane.racerId,
    ...sampleAt(lane, race.sampleHz, elapsedMs),
    finished: elapsedMs >= lane.finishTimeMs,
  }));
}

/** Live running order: finished horses by finish time, then the rest by distance. */
export function runningOrder(race: RaceResult, elapsedMs: number): readonly string[] {
  const frames = frameAt(race, elapsedMs);
  const finishIndex = new Map(race.finishOrder.map((id, i) => [id, i]));
  return [...frames]
    .sort((a, b) => {
      if (a.finished && b.finished) return finishIndex.get(a.racerId)! - finishIndex.get(b.racerId)!;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.position - a.position;
    })
    .map((f) => f.racerId);
}
