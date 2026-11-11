import type { Settings } from '../../settings/schema';
import { el } from '../dom';
import type { DraftStore } from './draft';

/** Human names for setting paths, used by fields and the "unsaved changes" bar. */
export const PATH_LABEL: Readonly<Record<string, string>> = {
  'config.maxRacers': 'Max riders',
  'config.minRacersToStart': 'Riders needed to start',
  'config.maxQueue': 'Max queue',
  'config.joinKeyword': 'Join word',
  'config.roundsPerRace': 'Questions per race',
  'config.pointsPerCorrect': 'Points per correct answer',
  'config.lobbyMs': 'Lobby countdown',
  'config.questionMs': 'Time to answer',
  'config.allAnsweredGraceMs': 'Close after all answered',
  'config.revealMs': 'Show the answer',
  'config.raceCountdownMs': 'Gate countdown',
  'config.raceOutroMs': 'After the finish',
  'config.resultsMs': 'Results screen',
  'config.disabledQuestionIds': 'Switched-off questions',
  'config.statRotation': 'Stat order',
  level: 'Question level',
  'display.showNameTags': 'Name tags',
  'display.maskAnswers': 'Hide answers in chat',
  'display.showExplanation': 'Explanations',
  'display.showHostBar': 'Host bar',
  'display.chatRows': 'Chat lines',
  blocked: 'Blocked users',
};

export function labelFor(path: string): string {
  return PATH_LABEL[path] ?? path;
}

interface FieldBase {
  readonly path: string;
  readonly label: string;
  readonly help: string;
}

interface Shell {
  readonly root: HTMLElement;
  /** Left column: label, help, error, plus field-specific notes. */
  readonly info: HTMLElement;
  /** Right column: the input. */
  readonly control: HTMLElement;
  /** Re-renders error text and the changed marker. */
  readonly refreshMeta: () => void;
}

let fieldCounter = 0;

function shell(store: DraftStore, spec: FieldBase): Shell & { id: string } {
  fieldCounter += 1;
  const id = `f-${fieldCounter}`;
  // Settings row: description on the left, input on the right.
  const root = el('div', 'field');
  const info = el('div', 'field__info');
  const head = el('div', 'field__head');
  const label = el('label', 'field__label', spec.label);
  label.htmlFor = id;
  const changed = el('span', 'field__changed', 'Modified');
  head.append(label, changed);
  const help = el('p', 'field__help', spec.help);
  const error = el('p', 'field__error');
  error.setAttribute('role', 'alert');
  info.append(head, help, error);
  const control = el('div', 'field__control');
  root.append(info, control);
  const refreshMeta = (): void => {
    const issue = store.issues().find((i) => i.path === spec.path);
    error.textContent = issue === undefined ? '' : `${spec.label} ${issue.message}.`;
    root.classList.toggle('field--error', issue !== undefined);
    changed.hidden = !store.changedPaths().includes(spec.path);
  };
  return { root, info, control, refreshMeta, id };
}

const isFocused = (node: HTMLElement): boolean => document.activeElement === node;

export interface NumberSpec extends FieldBase {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Shown after the box, e.g. "s" or "riders". */
  readonly unit: string;
  /** Stored value = shown value × scale (1000 for seconds stored as ms). */
  readonly scale: number;
  readonly get: (s: Settings) => number;
  readonly set: (s: Settings, value: number) => Settings;
}

/** Number box with a unit suffix. Allowed range is shown in the help line. */
export function numberField(store: DraftStore, spec: NumberSpec): HTMLElement {
  const f = shell(store, { ...spec, help: `${spec.help} Range ${spec.min}–${spec.max}${spec.unit ? ` ${spec.unit}` : ''}.` });
  const box = el('input', 'field__number');
  box.type = 'number';
  box.id = f.id;
  box.min = String(spec.min);
  box.max = String(spec.max);
  box.step = String(spec.step);
  box.inputMode = spec.step < 1 ? 'decimal' : 'numeric';
  const write = (text: string): void => {
    const shown = text.trim() === '' ? Number.NaN : Number(text);
    // NaN is kept on purpose: validation then shows "must be a whole number" and Apply stays disabled.
    // Seconds -> ms rounds away float noise (1.5 * 1000); whole-number fields keep 2.5 so validation flags it.
    const stored = !Number.isFinite(shown) ? Number.NaN : spec.scale === 1 ? shown : Math.round(shown * spec.scale);
    store.update((s) => spec.set(s, stored));
  };
  box.addEventListener('input', () => write(box.value));
  const group = el('div', 'input-group');
  group.append(box, el('span', 'input-group__unit', spec.unit));
  f.control.append(group);
  store.subscribe(() => {
    const value = spec.get(store.current()) / spec.scale;
    if (Number.isFinite(value) && !isFocused(box)) box.value = String(value);
    f.refreshMeta();
  });
  return f.root;
}

export interface ToggleSpec extends FieldBase {
  readonly get: (s: Settings) => boolean;
  readonly set: (s: Settings, value: boolean) => Settings;
  /** Extra warning shown while the toggle is off. */
  readonly warnWhenOff?: string;
}

export function toggleField(store: DraftStore, spec: ToggleSpec): HTMLElement {
  const f = shell(store, spec);
  const box = el('input', 'switch');
  box.type = 'checkbox';
  box.id = f.id;
  box.setAttribute('role', 'switch');
  const state = el('span', 'switch__state');
  const warn = el('p', 'field__warn', spec.warnWhenOff ?? '');
  box.addEventListener('change', () => store.update((s) => spec.set(s, box.checked)));
  f.control.append(state, box);
  f.info.append(warn);
  store.subscribe(() => {
    const on = spec.get(store.current());
    box.checked = on;
    state.textContent = on ? 'On' : 'Off';
    warn.hidden = on || spec.warnWhenOff === undefined;
    f.refreshMeta();
  });
  return f.root;
}

export interface SelectSpec<T extends string | number> extends FieldBase {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly get: (s: Settings) => T;
  readonly set: (s: Settings, value: T) => Settings;
}

export function selectField<T extends string | number>(store: DraftStore, spec: SelectSpec<T>): HTMLElement {
  const f = shell(store, spec);
  const select = el('select', 'select');
  select.id = f.id;
  for (const option of spec.options) {
    const node = el('option', undefined, option.label);
    node.value = String(option.value);
    select.append(node);
  }
  select.addEventListener('change', () => {
    const picked = spec.options.find((o) => String(o.value) === select.value);
    if (picked !== undefined) store.update((s) => spec.set(s, picked.value));
  });
  f.control.append(select);
  store.subscribe(() => {
    select.value = String(spec.get(store.current()));
    f.refreshMeta();
  });
  return f.root;
}

export interface TextSpec extends FieldBase {
  readonly placeholder: string;
  readonly maxLength: number;
  readonly get: (s: Settings) => string;
  readonly set: (s: Settings, value: string) => Settings;
  /** Applied when the box loses focus (e.g. keyword normalisation). */
  readonly tidy?: (value: string) => string;
  /** Live preview line under the box. */
  readonly preview?: (value: string) => string;
}

export function textField(store: DraftStore, spec: TextSpec): HTMLElement {
  const f = shell(store, spec);
  const input = el('input', 'field__text');
  input.id = f.id;
  input.placeholder = spec.placeholder;
  input.maxLength = spec.maxLength;
  input.autocomplete = 'off';
  const preview = el('p', 'field__preview');
  input.addEventListener('input', () => store.update((s) => spec.set(s, input.value)));
  input.addEventListener('blur', () => {
    if (spec.tidy === undefined) return;
    const tidy = spec.tidy(input.value);
    if (tidy !== input.value) store.update((s) => spec.set(s, tidy));
  });
  f.control.append(input);
  f.info.append(preview);
  store.subscribe(() => {
    const value = spec.get(store.current());
    if (!isFocused(input)) input.value = value;
    preview.textContent = spec.preview?.(value) ?? '';
    f.refreshMeta();
  });
  return f.root;
}

/** A titled group of settings rows. */
export function card(title: string, intro: string | null, ...children: HTMLElement[]): HTMLElement {
  const node = el('section', 'acard');
  const head = el('header', 'acard__header');
  head.append(el('h2', 'acard__title', title));
  if (intro !== null) head.append(el('p', 'acard__intro', intro));
  const rows = el('div', 'acard__rows');
  rows.append(...children);
  node.append(head, rows);
  return node;
}
