import type { AdminSnapshot } from '../../admin/protocol';
import type { QuestionSource } from '../../engine/types';
import { MAX_BLOCKED_ID, defaultSettings, parseSettings } from '../../settings/schema';
import { el } from '../dom';
import type { DraftStore } from './draft';
import { confirmButton, type Send } from './sectionLive';

/** Moderation (block list) and Backup (export / import / defaults). */

export interface ModerationSection {
  readonly root: HTMLElement;
  update(snapshot: AdminSnapshot): void;
}

export function moderationSection(send: Send, store: DraftStore): ModerationSection {
  const root = el('div', 'asection__body');
  const form = el('form', 'block-form');
  const idInput = el('input', 'field__text');
  idInput.placeholder = 'User ID (e.g. local:mai, or a TikTok @id later)';
  idInput.maxLength = MAX_BLOCKED_ID;
  idInput.required = true;
  idInput.setAttribute('aria-label', 'User ID to block');
  const nameInput = el('input', 'field__text');
  nameInput.placeholder = 'Name to remember them by (optional)';
  nameInput.maxLength = MAX_BLOCKED_ID;
  nameInput.setAttribute('aria-label', 'Name');
  const submit = el('button', 'btn btn--danger', 'Block');
  submit.type = 'submit';
  form.append(idInput, nameInput, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const userId = idInput.value.trim();
    if (userId === '') return;
    void send({ type: 'block', userId, name: nameInput.value.trim() || userId }).then((ok) => {
      if (ok) form.reset();
    });
  });

  const list = el('div');
  const importNote = el('p', 'note', 'An imported settings file will replace this block list when you press Apply.');
  const card = el('section', 'acard');
  const head = el('header', 'acard__header');
  head.append(
    el('h2', 'acard__title', 'Blocked users'),
    el('p', 'acard__intro', 'Blocked users cannot join or queue, and their chat is hidden from the screen. Applies immediately and is saved. Use Kick on the Live page for a one-off removal.'),
  );
  const body = el('div', 'acard__body');
  body.append(form, importNote, list);
  card.append(head, body);
  root.append(card);

  store.subscribe(() => {
    importNote.hidden = !store.importedBlockList();
  });
  importNote.hidden = true;

  let last = '';
  const render = (snapshot: AdminSnapshot): void => {
    const blocked = snapshot.settings.blocked;
    const key = JSON.stringify(blocked);
    if (key === last) return;
    last = key;
    if (blocked.length === 0) {
      list.replaceChildren(el('p', 'empty', 'Nobody is blocked.'));
      return;
    }
    const ul = el('ul', 'blocked');
    for (const b of blocked) {
      const li = el('li', 'blocked__item');
      const unblock = el('button', 'btn btn--small', 'Unblock');
      unblock.type = 'button';
      unblock.addEventListener('click', () => void send({ type: 'unblock', userId: b.id }));
      li.append(el('span', 'blocked__name', b.name), el('span', 'atable__id', b.id), unblock);
      ul.append(li);
    }
    list.replaceChildren(el('p', 'qcount', `${blocked.length} blocked`), ul);
  };
  return { root, update: render };
}

export type Notify = (ok: boolean, message: string) => void;

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const MAX_IMPORT_BYTES = 512 * 1024;

export function backupSection(store: DraftStore, bank: readonly QuestionSource[], notify: Notify): HTMLElement {
  const root = el('div', 'asection__body');

  const exportBtn = el('button', 'btn btn--primary', 'Download settings file');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', () => {
    const date = new Date().toISOString().slice(0, 10);
    download(`english-derby-settings-${date}.json`, `${JSON.stringify(store.current(), null, 2)}\n`);
    notify(true, store.isDirty() ? 'Downloaded, including your unsaved changes.' : 'Downloaded.');
  });

  const file = el('input', 'file');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.setAttribute('aria-label', 'Settings file to import');
  const report = el('ul', 'import-report');
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    file.value = '';
    if (picked === undefined) return;
    if (picked.size > MAX_IMPORT_BYTES) {
      notify(false, 'That file is too big to be a settings file.');
      return;
    }
    void picked.text().then((text) => {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        notify(false, 'That file is not valid JSON.');
        return;
      }
      const parsed = parseSettings(data, bank);
      if (!parsed.ok) {
        report.replaceChildren(...parsed.issues.map((i) => el('li', 'import-report__bad', `${i.path || 'file'}: ${i.message}`)));
        notify(false, 'Import failed. See the problems listed under Import.');
        return;
      }
      // A file without a block list must not wipe the current one.
      const hasBlockList = typeof data === 'object' && data !== null && 'blocked' in data;
      store.load(parsed.settings, hasBlockList);
      report.replaceChildren(...parsed.warnings.map((w) => el('li', undefined, w)));
      notify(true, 'Imported into the form. Check it, then press Apply to use it.');
    }, () => notify(false, 'Could not read that file.'));
  });

  const defaults = confirmButton('Load default settings', 'Click again to load defaults', 'btn', () => {
    store.load(defaultSettings(), false);
    notify(true, 'Defaults loaded into the form (block list kept). Press Apply to use them.');
  });

  const card = (title: string, intro: string, ...children: HTMLElement[]): HTMLElement => {
    const node = el('section', 'acard');
    const head = el('header', 'acard__header');
    head.append(el('h2', 'acard__title', title), el('p', 'acard__intro', intro));
    const body = el('div', 'acard__body');
    body.append(...children);
    node.append(head, ...(children.length > 0 ? [body] : []));
    return node;
  };
  root.append(
    card('Export', 'Save the settings in the form (including the block list) as a JSON file, to back them up or move them to another computer.', exportBtn),
    card('Import', 'Load a settings file into the form. Nothing changes in the game until you press Apply.', file, report),
    card('Reset', 'Put every setting back to its default in the form. The block list is kept.', defaults),
    card('Where settings live', 'The game tab saves settings in this browser (localStorage). Another browser or computer starts with defaults — use Export/Import to copy them.'),
  );
  return root;
}
