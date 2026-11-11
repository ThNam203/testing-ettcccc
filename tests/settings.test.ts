import { describe, expect, test } from 'vitest';
import { QUESTION_BANK } from '../src/content/questions';
import { DEFAULT_CONFIG, STAT_KEYS } from '../src/engine/config';
import { createGame, reduce } from '../src/engine/game';
import {
  DEFAULT_DISPLAY, defaultSettings, diffPaths, estimateLoop, parseSettings, sameSettings, settingsFromState, validateSettings,
} from '../src/settings/schema';

const BANK = QUESTION_BANK;

describe('defaults and validation', () => {
  test('default settings are valid', () => {
    expect(validateSettings(defaultSettings(), BANK)).toEqual([]);
  });

  test('config issues are reported with a config. path; display issues with display.', () => {
    const s = defaultSettings();
    const found = validateSettings({
      ...s,
      config: { ...s.config, maxRacers: 0 },
      display: { ...s.display, chatRows: 99 },
    }, BANK);
    expect(found.map((i) => i.path)).toEqual(expect.arrayContaining(['config.maxRacers', 'display.chatRows']));
  });

  test('blocked entries need an id', () => {
    const s = defaultSettings();
    const found = validateSettings({ ...s, blocked: [{ id: ' ', name: 'x' }] }, BANK);
    expect(found.map((i) => i.path)).toContain('blocked');
  });
});

describe('parseSettings', () => {
  test('round-trips through JSON', () => {
    const s = { ...defaultSettings(), level: 'A2' as const, blocked: [{ id: 'local:spam', name: 'Spam' }] };
    const parsed = parseSettings(JSON.parse(JSON.stringify(s)), BANK);
    expect(parsed).toEqual({ ok: true, settings: s, warnings: [] });
  });

  test('missing fields fall back to defaults with a warning (older export files still load)', () => {
    const parsed = parseSettings({ version: 1, config: { maxRacers: 6 } }, BANK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.settings.config.maxRacers).toBe(6);
    expect(parsed.settings.config.lobbyMs).toBe(DEFAULT_CONFIG.lobbyMs);
    expect(parsed.settings.display).toEqual(DEFAULT_DISPLAY);
    expect(parsed.warnings.some((w) => w.includes('config.lobbyMs'))).toBe(true);
    // A missing section is reported once, not field by field.
    expect(parsed.warnings.filter((w) => w.startsWith('display'))).toEqual(['display missing; defaults used']);
  });

  test('wrong types are errors, not silently replaced', () => {
    const parsed = parseSettings({ version: 1, config: { maxRacers: '6' }, display: { maskAnswers: 'yes' } }, BANK);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['config.maxRacers', 'display.maskAnswers']));
  });

  test('rejects non-objects, other versions and bad levels', () => {
    expect(parseSettings('nope', BANK).ok).toBe(false);
    expect(parseSettings(null, BANK).ok).toBe(false);
    expect(parseSettings({ version: 2 }, BANK).ok).toBe(false);
    expect(parseSettings({ version: 1, level: 'C2' }, BANK).ok).toBe(false);
  });

  test('unknown question ids are dropped with a warning; stat rotation is always the fixed fair order', () => {
    const parsed = parseSettings({
      version: 1,
      config: { disabledQuestionIds: ['a2-01', 'gone-99'], statRotation: ['speed', 'speed', 'speed'] },
    }, BANK);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.settings.config.disabledQuestionIds).toEqual(['a2-01']);
    expect(parsed.settings.config.statRotation).toEqual(STAT_KEYS);
    expect(parsed.warnings.join(' ')).toContain('gone-99');
    expect(parsed.warnings.join(' ')).toContain('statRotation');
  });

  test('a keyword that is not normalised is normalised with a warning', () => {
    const parsed = parseSettings({ version: 1, config: { joinKeyword: 'JOIN!' } }, BANK);
    expect(parsed.ok && parsed.settings.config.joinKeyword).toBe('join');
    expect(parsed.ok && parsed.warnings.some((w) => w.includes('joinKeyword'))).toBe(true);
  });

  test('settings that parse but break a rule are rejected with the rule', () => {
    const parsed = parseSettings({ version: 1, config: { maxRacers: 2, minRacersToStart: 5 } }, BANK);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0]!.path).toBe('config.minRacersToStart');
  });

  test('blocked list is cleaned the same way the engine stores it (trim, dedupe)', () => {
    const parsed = parseSettings({ version: 1, blocked: [{ id: ' a ', name: ' x ' }, { id: 'a', name: 'y' }, { id: 'b', name: '' }] }, BANK);
    expect(parsed.ok && parsed.settings.blocked).toEqual([{ id: 'a', name: 'x' }, { id: 'b', name: 'b' }]);
  });

  test('a file without a block list says so', () => {
    const parsed = parseSettings({ version: 1 }, BANK);
    expect(parsed.ok && parsed.warnings.some((w) => w.startsWith('blocked missing'))).toBe(true);
  });

  test('malformed blocked list is an error', () => {
    expect(parseSettings({ version: 1, blocked: [{ id: 5 }] }, BANK).ok).toBe(false);
    expect(parseSettings({ version: 1, blocked: 'x' }, BANK).ok).toBe(false);
  });
});

describe('settingsFromState', () => {
  test('shows pending settings (what will run next), plus the live block list', () => {
    let game = createGame({ bank: BANK, seed: 1, now: 0 });
    game = reduce(game, { type: 'chat', message: { userId: 'u1', nickname: 'U1', text: 'hi' }, now: 1 });
    game = reduce(game, { type: 'hostStart', now: 2 });
    game = reduce(game, { type: 'configure', config: { ...DEFAULT_CONFIG, maxRacers: 5 }, level: 'B2', now: 3 });
    game = reduce(game, { type: 'setBlocked', blocked: [{ id: 'x', name: 'X' }], now: 4 });
    const s = settingsFromState(game, DEFAULT_DISPLAY);
    expect(s.config.maxRacers).toBe(5);
    expect(s.level).toBe('B2');
    expect(s.blocked).toEqual([{ id: 'x', name: 'X' }]);
  });
});

describe('estimateLoop', () => {
  test('adds up phases and a 30–45 s race', () => {
    const e = estimateLoop(DEFAULT_CONFIG);
    const fixed = 30_000 + 6 * (15_000 + 6_000) + 3_000 + 3_000 + 15_000;
    expect(e.quizMs).toBe(6 * (15_000 + 6_000));
    expect(e.raceMinMs).toBeGreaterThan(30_000);
    expect(e.raceMaxMs).toBeLessThan(45_000);
    expect(e.totalMinMs).toBe(fixed + e.raceMinMs);
    expect(e.totalMaxMs).toBe(fixed + e.raceMaxMs);
  });
});

describe('sameSettings', () => {
  test('compares by value', () => {
    expect(sameSettings(defaultSettings(), defaultSettings())).toBe(true);
    expect(sameSettings(defaultSettings(), { ...defaultSettings(), level: 'A2' })).toBe(false);
  });
});

describe('diffPaths', () => {
  test('lists changed leaf paths; lists compare as a whole', () => {
    const a = defaultSettings();
    const b = {
      ...a,
      level: 'A2' as const,
      config: { ...a.config, lobbyMs: 10_000, disabledQuestionIds: ['a2-01'] },
      display: { ...a.display, chatRows: 2 },
    };
    expect(diffPaths(a, b)).toEqual(['config.lobbyMs', 'config.disabledQuestionIds', 'level', 'display.chatRows']);
    expect(diffPaths(a, a)).toEqual([]);
  });
});
