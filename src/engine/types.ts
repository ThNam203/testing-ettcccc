export type StatKey = 'speed' | 'stamina' | 'strength';

export type Stats = Readonly<Record<StatKey, number>>;

export type Level = 'A2' | 'B1' | 'B2';

export type Phase = 'lobby' | 'question' | 'reveal' | 'race' | 'results';

/** One chat line, already normalised by a ChatSource (local simulator or TikTok). */
export interface ChatMessage {
  readonly userId: string;
  readonly nickname: string;
  readonly text: string;
  /** TikTok @handle (without the @), when the source has one. Lets the admin find the viewer later, e.g. for a prize. */
  readonly handle?: string;
}

export interface Player {
  readonly id: string;
  readonly name: string;
}

export interface Racer extends Player {
  readonly lane: number;
  readonly color: string;
  readonly stats: Stats;
  readonly correct: number;
}

/** Bank entry: `answer` indexes the correct choice before shuffling. */
export interface QuestionSource {
  readonly id: string;
  readonly level: Level;
  readonly category: string;
  readonly prompt: string;
  readonly choices: readonly [string, string, string, string];
  readonly answer: 0 | 1 | 2 | 3;
  readonly explanation: string;
}

/** A question as played in one race: choices shuffled, stat assigned by round. */
export interface RoundQuestion extends QuestionSource {
  readonly stat: StatKey;
}

export interface RevealSummary {
  readonly round: number;
  readonly stat: StatKey;
  readonly points: number;
  readonly correctIndex: number;
  readonly correctIds: readonly string[];
  readonly answeredCount: number;
}

export interface LaneResult {
  readonly racerId: string;
  readonly finishTimeMs: number;
  /** Distance in metres at each sample (sampleHz). Continues past the finish line for run-out. */
  readonly positions: readonly number[];
}

export interface RaceResult {
  readonly seed: number;
  readonly distance: number;
  readonly sampleHz: number;
  /** Time at which the last horse crosses the line. */
  readonly durationMs: number;
  readonly lanes: readonly LaneResult[];
  readonly finishOrder: readonly string[];
}

export interface Standing {
  readonly place: number;
  readonly racerId: string;
  readonly name: string;
  readonly color: string;
  readonly finishTimeMs: number;
  readonly correct: number;
}

export interface SessionRecord {
  readonly name: string;
  readonly races: number;
  readonly wins: number;
  readonly podiums: number;
  readonly correct: number;
}

export interface GameConfig {
  readonly maxRacers: number;
  readonly maxQueue: number;
  readonly roundsPerRace: number;
  readonly pointsPerCorrect: number;
  readonly lobbyMs: number;
  readonly questionMs: number;
  /** Once every racer has answered, the question closes after this grace period. */
  readonly allAnsweredGraceMs: number;
  readonly revealMs: number;
  readonly raceCountdownMs: number;
  readonly raceOutroMs: number;
  readonly resultsMs: number;
  readonly statRotation: readonly StatKey[];
  /** The lobby countdown starts only once this many riders have joined (host can still start early). */
  readonly minRacersToStart: number;
  /** '' = any chat message joins. Otherwise the message must contain this word or phrase (normalised). */
  readonly joinKeyword: string;
  /** Questions the host switched off; never picked. */
  readonly disabledQuestionIds: readonly string[];
}

/** A viewer whose chat is ignored. `name` is kept only so the host can recognise them in the admin page. */
export interface BlockedUser {
  readonly id: string;
  readonly name: string;
}

/** Settings saved mid-game; they take effect when the next lobby opens, so a running race never changes. */
export interface PendingSettings {
  readonly config: GameConfig;
  readonly level: Level;
}

export interface GameState {
  readonly config: GameConfig;
  readonly bank: readonly QuestionSource[];
  readonly phase: Phase;
  readonly phaseStartedAt: number;
  /** null = waiting (e.g. empty lobby). */
  readonly phaseEndsAt: number | null;
  readonly seed: number;
  readonly level: Level;
  readonly raceNumber: number;
  readonly racers: readonly Racer[];
  readonly queue: readonly Player[];
  readonly round: number;
  readonly questions: readonly RoundQuestion[];
  /** racerId -> chosen index, for the current question only. */
  readonly answers: Readonly<Record<string, number>>;
  readonly lastReveal: RevealSummary | null;
  readonly race: RaceResult | null;
  readonly standings: readonly Standing[] | null;
  readonly session: Readonly<Record<string, SessionRecord>>;
  readonly usedQuestionIds: readonly string[];
  readonly pending: PendingSettings | null;
  readonly blocked: readonly BlockedUser[];
}

export type GameAction =
  | { readonly type: 'chat'; readonly message: ChatMessage; readonly now: number }
  | { readonly type: 'tick'; readonly now: number }
  | { readonly type: 'hostStart'; readonly now: number }
  | { readonly type: 'hostSkip'; readonly now: number }
  | { readonly type: 'hostReset'; readonly now: number }
  | { readonly type: 'setLevel'; readonly level: Level }
  | { readonly type: 'configure'; readonly config: GameConfig; readonly level: Level; readonly now: number }
  | { readonly type: 'kick'; readonly userId: string; readonly now: number }
  | { readonly type: 'setBlocked'; readonly blocked: readonly BlockedUser[]; readonly now: number }
  | { readonly type: 'clearSession' };
