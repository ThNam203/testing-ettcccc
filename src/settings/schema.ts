import { DEFAULT_CONFIG, STAT_KEYS } from '../engine/config';
import { LEVELS, NUMERIC_CONFIG_KEYS, normaliseKeyword, validateConfig } from '../engine/configRules';
import { MAX_BLOCKED, cleanBlockList } from '../engine/moderation';
import { TUNED_MAX_PER_STAT, simulateRace } from '../engine/race';
import type { BlockedUser, GameConfig, GameState, Level, QuestionSource } from '../engine/types';

/** Everything the admin page can change. Saved by the host tab; exported/imported as JSON. */

export const SETTINGS_VERSION = 1;
export const MAX_BLOCKED_ID = 64;

export interface DisplaySettings {
  /** Floating name tags above the horses. */
  readonly showNameTags: boolean;
  /** Show "answered ✓" instead of the letter in the on-screen chat, so viewers cannot copy. */
  readonly maskAnswers: boolean;
  /** One-line explanation under the correct answer. */
  readonly showExplanation: boolean;
  /** Host control bar visible when the game page opens (H still toggles it). */
  readonly showHostBar: boolean;
  /** Chat lines kept in the on-screen chat panel; 0 hides the panel. */
  readonly chatRows: number;
}

export const DISPLAY_LIMITS = { chatRows: { min: 0, max: 20 } } as const;

export const DEFAULT_DISPLAY: DisplaySettings = {
  showNameTags: true,
  maskAnswers: true,
  showExplanation: true,
  showHostBar: true,
  chatRows: 8,
};

export interface Settings {
  readonly version: typeof SETTINGS_VERSION;
  readonly config: GameConfig;
  readonly level: Level;
  readonly display: DisplaySettings;
  readonly blocked: readonly BlockedUser[];
}

export interface SettingsIssue {
  /** e.g. "config.maxRacers", "display.chatRows", "blocked". */
  readonly path: string;
  readonly message: string;
}

export function defaultSettings(): Settings {
  return { version: SETTINGS_VERSION, config: DEFAULT_CONFIG, level: 'B1', display: DEFAULT_DISPLAY, blocked: [] };
}

export function validateSettings(settings: Settings, bank: readonly QuestionSource[]): SettingsIssue[] {
  const issues: SettingsIssue[] = validateConfig(settings.config, bank)
    .map((i) => ({ path: `config.${i.field}`, message: i.message }));
  if (!LEVELS.includes(settings.level)) issues.push({ path: 'level', message: 'must be A2, B1 or B2' });
  const { min, max } = DISPLAY_LIMITS.chatRows;
  const rows = settings.display.chatRows;
  if (!Number.isInteger(rows) || rows < min || rows > max) {
    issues.push({ path: 'display.chatRows', message: `must be a whole number between ${min} and ${max}` });
  }
  if (settings.blocked.length > MAX_BLOCKED) issues.push({ path: 'blocked', message: `at most ${MAX_BLOCKED} entries` });
  if (settings.blocked.some((b) => b.id.trim() === '' || b.id.length > MAX_BLOCKED_ID)) {
    issues.push({ path: 'blocked', message: `every entry needs an id of 1–${MAX_BLOCKED_ID} characters` });
  }
  return issues;
}

/** The settings that will run next: pending (saved mid-game) wins over the ones in use. */
export function settingsFromState(state: GameState, display: DisplaySettings): Settings {
  return {
    version: SETTINGS_VERSION,
    config: state.pending?.config ?? state.config,
    level: state.pending?.level ?? state.level,
    display,
    blocked: state.blocked,
  };
}

export function sameSettings(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function leafDiff(a: unknown, b: unknown, path: string): string[] {
  const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (isPlain(a) && isPlain(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => leafDiff(a[k], b[k], path === '' ? k : `${path}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

/** Paths that differ, e.g. ["config.lobbyMs", "level"]. Lists (blocked, disabled ids) compare as a whole. */
export function diffPaths(a: Settings, b: Settings): string[] {
  return leafDiff(a, b, '');
}

// ---------------------------------------------------------------- parsing untrusted JSON

export type ParsedSettings =
  | { readonly ok: true; readonly settings: Settings; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly issues: readonly SettingsIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects problems while reading fields; missing fields use defaults (warning), wrong types are errors. */
class Reader {
  readonly issues: SettingsIssue[] = [];
  readonly warnings: string[] = [];
  /** Sections reported missing as a whole; their fields are not reported one by one. */
  private readonly missing = new Set<Record<string, unknown>>();

  section(data: Record<string, unknown>, key: string): Record<string, unknown> {
    const value = data[key];
    if (value === undefined) {
      this.warnings.push(`${key} missing; defaults used`);
      const empty: Record<string, unknown> = {};
      this.missing.add(empty);
      return empty;
    }
    if (isRecord(value)) return value;
    this.issues.push({ path: key, message: 'must be an object' });
    return {};
  }

  field<T>(data: Record<string, unknown>, path: string, key: string, fallback: T, guard: (v: unknown) => v is T, kind: string): T {
    const value = data[key];
    const where = path === '' ? key : `${path}.${key}`;
    if (value === undefined) {
      if (!this.missing.has(data)) this.warnings.push(`${where} missing; default used`);
      return fallback;
    }
    if (guard(value)) return value;
    this.issues.push({ path: where, message: `must be ${kind}` });
    return fallback;
  }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

function readConfig(r: Reader, data: Record<string, unknown>, bank: readonly QuestionSource[]): GameConfig {
  const numbers = Object.fromEntries(NUMERIC_CONFIG_KEYS.map((key) => (
    [key, r.field(data, 'config', key, DEFAULT_CONFIG[key], isNumber, 'a number')]
  )));
  const rounds = r.field(data, 'config', 'roundsPerRace', DEFAULT_CONFIG.roundsPerRace, isNumber, 'a number');
  const rawKeyword = r.field(data, 'config', 'joinKeyword', DEFAULT_CONFIG.joinKeyword, isString, 'text');
  const joinKeyword = normaliseKeyword(rawKeyword);
  if (joinKeyword !== rawKeyword) r.warnings.push(`config.joinKeyword "${rawKeyword}" normalised to "${joinKeyword}"`);

  const rawDisabled = r.field(data, 'config', 'disabledQuestionIds', DEFAULT_CONFIG.disabledQuestionIds, isStringArray, 'a list of question ids');
  const known = new Set(bank.map((q) => q.id));
  const unknown = rawDisabled.filter((id) => !known.has(id));
  if (unknown.length > 0) r.warnings.push(`config.disabledQuestionIds: unknown ids dropped (${unknown.join(', ')})`);

  if (data.statRotation !== undefined && JSON.stringify(data.statRotation) !== JSON.stringify(STAT_KEYS)) {
    r.warnings.push('config.statRotation ignored; the stat order is fixed for fairness');
  }
  return {
    ...DEFAULT_CONFIG,
    ...numbers,
    roundsPerRace: rounds,
    joinKeyword,
    disabledQuestionIds: [...new Set(rawDisabled.filter((id) => known.has(id)))],
    statRotation: STAT_KEYS,
  };
}

function readDisplay(r: Reader, data: Record<string, unknown>): DisplaySettings {
  const flag = (key: keyof Omit<DisplaySettings, 'chatRows'>): boolean => (
    r.field(data, 'display', key, DEFAULT_DISPLAY[key], isBoolean, 'true or false')
  );
  return {
    showNameTags: flag('showNameTags'),
    maskAnswers: flag('maskAnswers'),
    showExplanation: flag('showExplanation'),
    showHostBar: flag('showHostBar'),
    chatRows: r.field(data, 'display', 'chatRows', DEFAULT_DISPLAY.chatRows, isNumber, 'a number'),
  };
}

function readBlocked(r: Reader, data: Record<string, unknown>): BlockedUser[] {
  const value = data.blocked;
  if (value === undefined) {
    r.warnings.push('blocked missing; current block list kept');
    return [];
  }
  const isEntry = (v: unknown): v is BlockedUser => isRecord(v) && isString(v.id) && isString(v.name);
  if (!Array.isArray(value) || !value.every(isEntry)) {
    r.issues.push({ path: 'blocked', message: 'must be a list of { id, name }' });
    return [];
  }
  const clean = cleanBlockList(value.map((b) => ({ id: b.id, name: b.name })));
  if (clean.length < value.length) r.warnings.push(`blocked: ${value.length - clean.length} blank, duplicate or extra entries removed`);
  return clean;
}

/** Read settings from untrusted data (localStorage, an imported file, the admin channel). */
export function parseSettings(data: unknown, bank: readonly QuestionSource[]): ParsedSettings {
  if (!isRecord(data)) return { ok: false, issues: [{ path: '', message: 'not a settings object' }] };
  if (data.version !== SETTINGS_VERSION) {
    return { ok: false, issues: [{ path: 'version', message: `unsupported version (expected ${SETTINGS_VERSION})` }] };
  }
  const r = new Reader();
  const level = r.field(data, '', 'level', 'B1', (v): v is Level => LEVELS.some((l) => l === v), 'A2, B1 or B2');
  const settings: Settings = {
    version: SETTINGS_VERSION,
    config: readConfig(r, r.section(data, 'config'), bank),
    level,
    display: readDisplay(r, r.section(data, 'display')),
    blocked: readBlocked(r, data),
  };
  const issues = [...r.issues, ...(r.issues.length === 0 ? validateSettings(settings, bank) : [])];
  return issues.length > 0 ? { ok: false, issues } : { ok: true, settings, warnings: r.warnings };
}

// ---------------------------------------------------------------- loop length estimate

export interface LoopEstimate {
  readonly quizMs: number;
  readonly raceMinMs: number;
  readonly raceMaxMs: number;
  readonly totalMinMs: number;
  readonly totalMaxMs: number;
}

let raceRange: { min: number; max: number } | null = null;

/** Race length does not depend on settings (stats are scaled), so measure the extremes once. */
function measureRaceRange(): { min: number; max: number } {
  if (raceRange !== null) return raceRange;
  const top = TUNED_MAX_PER_STAT;
  const fast = simulateRace([{ id: 'fast', stats: { speed: top, stamina: top, strength: top } }], 1);
  const slow = simulateRace([{ id: 'slow', stats: { speed: 0, stamina: 0, strength: 0 } }], 1);
  raceRange = { min: fast.durationMs, max: slow.durationMs };
  return raceRange;
}

/**
 * One full race loop: lobby + quiz + race + results. Quiz assumes every question runs its full time
 * (it ends sooner when all riders answer early).
 */
export function estimateLoop(config: GameConfig): LoopEstimate {
  const { min, max } = measureRaceRange();
  const quizMs = config.roundsPerRace * (config.questionMs + config.revealMs);
  const fixed = config.lobbyMs + quizMs + config.raceCountdownMs + config.raceOutroMs + config.resultsMs;
  return { quizMs, raceMinMs: min, raceMaxMs: max, totalMinMs: fixed + min, totalMaxMs: fixed + max };
}
