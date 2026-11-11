import type { QuestionSource } from '../../engine/types';
import {
  diffPaths, sameSettings, validateSettings, type Settings, type SettingsIssue,
} from '../../settings/schema';

/**
 * The admin form edits a draft. Nothing reaches the game until Apply.
 * The block list is managed live (Block/Unblock buttons), so the draft always follows the
 * game's list — except right after importing a file, when the imported list is kept until Apply/Discard.
 */
export interface DraftStore {
  current(): Settings;
  remote(): Settings | null;
  update(change: (draft: Settings) => Settings): void;
  /** New settings from the game tab. */
  receiveRemote(settings: Settings): void;
  discard(): void;
  /** Load a whole settings object (import / defaults) into the draft. */
  load(settings: Settings, replacesBlockList: boolean): void;
  isDirty(): boolean;
  importedBlockList(): boolean;
  changedPaths(): string[];
  issues(): SettingsIssue[];
  subscribe(listener: () => void): void;
}

export function createDraftStore(initial: Settings, bank: readonly QuestionSource[]): DraftStore {
  let draft = initial;
  let remote: Settings | null = null;
  let keepImportedBlocks = false;
  let cachedIssues: { for: Settings; issues: SettingsIssue[] } | null = null;
  const listeners: (() => void)[] = [];
  const notify = (): void => listeners.forEach((fn) => fn());
  const dirty = (): boolean => remote !== null && !sameSettings(draft, remote);

  return {
    current: () => draft,
    remote: () => remote,
    update(change) {
      draft = change(draft);
      notify();
    },
    receiveRemote(settings) {
      const wasDirty = dirty();
      const first = remote === null;
      if (remote !== null && sameSettings(remote, settings)) return;
      remote = settings;
      if (first || !wasDirty) {
        draft = settings;
        keepImportedBlocks = false;
      } else if (!keepImportedBlocks) {
        draft = { ...draft, blocked: settings.blocked };
      }
      if (!dirty()) keepImportedBlocks = false;
      notify();
    },
    discard() {
      if (remote !== null) draft = remote;
      keepImportedBlocks = false;
      notify();
    },
    load(settings, replacesBlockList) {
      keepImportedBlocks = replacesBlockList;
      draft = replacesBlockList || remote === null ? settings : { ...settings, blocked: remote.blocked };
      notify();
    },
    isDirty: dirty,
    importedBlockList: () => keepImportedBlocks,
    changedPaths: () => (remote === null ? [] : diffPaths(remote, draft)),
    issues() {
      if (cachedIssues?.for !== draft) cachedIssues = { for: draft, issues: validateSettings(draft, bank) };
      return cachedIssues.issues;
    },
    subscribe(listener) {
      listeners.push(listener);
    },
  };
}
