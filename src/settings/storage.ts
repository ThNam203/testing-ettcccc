import type { QuestionSource } from '../engine/types';
import { defaultSettings, parseSettings, type Settings } from './schema';

/** The game tab owns settings and keeps them in this browser's localStorage. */
const STORAGE_KEY = 'english-derby:settings:v1';

export interface LoadedSettings {
  readonly settings: Settings;
  /** Something the host should know (bad saved data, migrated fields); null = all fine. */
  readonly notice: string | null;
  /** True when the stored copy should be rewritten (e.g. defaults filled in for new fields). */
  readonly shouldResave: boolean;
}

function readRaw(): { raw: string | null; error: string | null } {
  try {
    return { raw: window.localStorage.getItem(STORAGE_KEY), error: null };
  } catch (error: unknown) {
    return { raw: null, error: error instanceof Error ? error.message : 'storage unavailable' };
  }
}

export function loadSettings(bank: readonly QuestionSource[]): LoadedSettings {
  const { raw, error } = readRaw();
  if (error !== null) {
    return { settings: defaultSettings(), notice: `Saved settings unavailable (${error}); using defaults.`, shouldResave: false };
  }
  if (raw === null) return { settings: defaultSettings(), notice: null, shouldResave: false };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { settings: defaultSettings(), notice: 'Saved settings were damaged; using defaults.', shouldResave: false };
  }
  const parsed = parseSettings(data, bank);
  if (!parsed.ok) {
    const why = parsed.issues.map((i) => `${i.path} ${i.message}`).join('; ');
    return { settings: defaultSettings(), notice: `Saved settings were ignored (${why}); using defaults.`, shouldResave: false };
  }
  const changed = parsed.warnings.filter((w) => !w.endsWith('missing; default used') && !w.endsWith('missing; defaults used'));
  return {
    settings: parsed.settings,
    notice: changed.length > 0 ? `Saved settings adjusted: ${changed.join('; ')}` : null,
    shouldResave: parsed.warnings.length > 0,
  };
}

/** Returns an error message, or null when saved. */
export function saveSettings(settings: Settings): string | null {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return null;
  } catch (error: unknown) {
    return `Settings could not be saved in this browser (${error instanceof Error ? error.message : 'unknown error'}). They apply until the page reloads.`;
  }
}
