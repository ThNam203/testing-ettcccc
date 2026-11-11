import { describe, expect, test } from 'vitest';
import { QUESTION_BANK } from '../src/content/questions';
import { defaultSettings, type Settings } from '../src/settings/schema';
import { createDraftStore } from '../src/ui/admin/draft';

const BANK = QUESTION_BANK;
const base = defaultSettings();
const withLobby = (s: Settings, ms: number): Settings => ({ ...s, config: { ...s.config, lobbyMs: ms } });

describe('draft store', () => {
  test('first remote replaces the draft; not dirty', () => {
    const store = createDraftStore(base, BANK);
    store.receiveRemote(withLobby(base, 20_000));
    expect(store.current().config.lobbyMs).toBe(20_000);
    expect(store.isDirty()).toBe(false);
  });

  test('edits make it dirty and list changed paths; discard goes back', () => {
    const store = createDraftStore(base, BANK);
    store.receiveRemote(base);
    store.update((s) => ({ ...withLobby(s, 10_000), level: 'A2' }));
    expect(store.isDirty()).toBe(true);
    expect(store.changedPaths()).toEqual(['config.lobbyMs', 'level']);
    store.discard();
    expect(store.isDirty()).toBe(false);
  });

  test('no remote yet: never dirty, discard keeps the draft', () => {
    const store = createDraftStore(base, BANK);
    store.update((s) => withLobby(s, 10_000));
    expect(store.isDirty()).toBe(false);
    expect(store.changedPaths()).toEqual([]);
    store.discard();
    expect(store.current().config.lobbyMs).toBe(10_000);
  });

  test('a remote update keeps unsaved edits but follows the live block list', () => {
    const store = createDraftStore(base, BANK);
    store.receiveRemote(base);
    store.update((s) => withLobby(s, 10_000));
    store.receiveRemote({ ...base, blocked: [{ id: 'x', name: 'X' }] });
    expect(store.current().config.lobbyMs).toBe(10_000);
    expect(store.current().blocked).toEqual([{ id: 'x', name: 'X' }]);
  });

  test('a clean draft follows every remote update', () => {
    const store = createDraftStore(base, BANK);
    store.receiveRemote(base);
    store.receiveRemote(withLobby(base, 40_000));
    expect(store.current().config.lobbyMs).toBe(40_000);
  });

  test('an imported block list survives remote updates until applied', () => {
    const store = createDraftStore(base, BANK);
    store.receiveRemote(base);
    const imported = { ...withLobby(base, 9_000), blocked: [{ id: 'imp', name: 'Imp' }] };
    store.load(imported, true);
    expect(store.importedBlockList()).toBe(true);
    store.receiveRemote({ ...base, blocked: [{ id: 'live', name: 'Live' }] });
    expect(store.current().blocked).toEqual([{ id: 'imp', name: 'Imp' }]);
    store.receiveRemote(imported); // applied: remote now equals the draft
    expect(store.isDirty()).toBe(false);
    expect(store.importedBlockList()).toBe(false);
  });

  test('loading defaults keeps the live block list', () => {
    const store = createDraftStore(base, BANK);
    const live = { ...withLobby(base, 9_000), blocked: [{ id: 'x', name: 'X' }] };
    store.receiveRemote(live);
    store.load(defaultSettings(), false);
    expect(store.current().blocked).toEqual([{ id: 'x', name: 'X' }]);
    expect(store.current().config.lobbyMs).toBe(base.config.lobbyMs);
  });

  test('issues come from validation and are cached per draft', () => {
    const store = createDraftStore(base, BANK);
    expect(store.issues()).toEqual([]);
    store.update((s) => ({ ...s, config: { ...s.config, maxRacers: Number.NaN } }));
    const first = store.issues();
    expect(first.map((i) => i.path)).toContain('config.maxRacers');
    expect(store.issues()).toBe(first);
  });

  test('subscribers are notified on change', () => {
    const store = createDraftStore(base, BANK);
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    store.update((s) => s);
    store.receiveRemote(base);
    store.receiveRemote(base); // identical: no notify
    expect(calls).toBe(2);
  });
});
