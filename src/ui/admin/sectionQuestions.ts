import { LEVELS, enabledQuestionCounts } from '../../engine/configRules';
import type { Level, QuestionSource } from '../../engine/types';
import type { Settings } from '../../settings/schema';
import { el } from '../dom';
import { LETTERS, LEVEL_LABEL } from '../labels';
import type { DraftStore } from './draft';

function setDisabled(s: Settings, ids: readonly string[], disabled: boolean): Settings {
  const current = new Set(s.config.disabledQuestionIds);
  for (const id of ids) {
    if (disabled) current.add(id);
    else current.delete(id);
  }
  return { ...s, config: { ...s.config, disabledQuestionIds: [...current].sort() } };
}

function questionRow(q: QuestionSource, store: DraftStore): { row: HTMLElement; box: HTMLInputElement } {
  const row = el('li', 'qrow');
  const box = el('input', 'qrow__check');
  box.type = 'checkbox';
  box.setAttribute('aria-label', `Use question ${q.id}`);
  box.addEventListener('change', () => store.update((s) => setDisabled(s, [q.id], !box.checked)));
  const body = el('div', 'qrow__body');
  const meta = el('div', 'qrow__meta');
  meta.append(el('span', 'tag', q.id), el('span', 'tag', q.category));
  const choices = el('ol', 'qrow__choices');
  q.choices.forEach((c, i) => {
    const item = el('li', i === q.answer ? 'is-correct' : undefined, `${LETTERS[i] ?? ''}. ${c}`);
    if (i === q.answer) item.title = 'Correct answer';
    choices.append(item);
  });
  body.append(meta, el('p', 'qrow__prompt', q.prompt), choices, el('p', 'qrow__explain', q.explanation));
  const label = el('label', 'qrow__label');
  label.append(box, body);
  row.append(label);
  return { row, box };
}

export function questionsSection(store: DraftStore, bank: readonly QuestionSource[]): HTMLElement {
  const root = el('div', 'asection__body');
  const intro = el('p', 'acard__intro',
    'Untick a question to stop it being asked (e.g. too hard, or a mistake). Each level needs at least as many questions on as “Questions per race”. Questions are edited in src/content/questions.ts.');

  let level: Level = store.current().level;
  let search = '';
  let category = '';

  const tabs = el('div', 'seg');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = LEVELS.map((lv) => {
    const b = el('button', 'seg__btn');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      level = lv;
      category = '';
      render();
    });
    tabs.append(b);
    return { lv, b };
  });

  const searchBox = el('input', 'field__text');
  searchBox.type = 'search';
  searchBox.placeholder = 'Search prompt, answer or id';
  searchBox.setAttribute('aria-label', 'Search questions');
  searchBox.addEventListener('input', () => {
    search = searchBox.value.trim().toLowerCase();
    render();
  });
  const categorySelect = el('select', 'select');
  categorySelect.setAttribute('aria-label', 'Category');
  categorySelect.addEventListener('change', () => {
    category = categorySelect.value;
    render();
  });

  const count = el('p', 'qcount');
  const enableShown = el('button', 'btn btn--small', 'Turn on all shown');
  const disableShown = el('button', 'btn btn--small', 'Turn off all shown');
  const toolbar = el('div', 'qtools');
  toolbar.append(searchBox, categorySelect, enableShown, disableShown);

  const rows = bank.map((q) => ({ q, ...questionRow(q, store) }));
  const list = el('ul', 'qlist');
  list.append(...rows.map((r) => r.row));
  const empty = el('p', 'empty', 'No questions match.');

  const shown = (): typeof rows => rows.filter(({ q }) => q.level === level
    && (category === '' || q.category === category)
    && (search === '' || [q.id, q.prompt, ...q.choices].some((t) => t.toLowerCase().includes(search))));

  enableShown.addEventListener('click', () => store.update((s) => setDisabled(s, shown().map((r) => r.q.id), false)));
  disableShown.addEventListener('click', () => store.update((s) => setDisabled(s, shown().map((r) => r.q.id), true)));

  function render(): void {
    const draft = store.current();
    const disabled = new Set(draft.config.disabledQuestionIds);
    const counts = enabledQuestionCounts(bank, draft.config.disabledQuestionIds);
    const need = draft.config.roundsPerRace;
    for (const { lv, b } of tabButtons) {
      b.textContent = `${LEVEL_LABEL[lv]} · ${counts[lv]}/${bank.filter((q) => q.level === lv).length}`;
      b.setAttribute('aria-selected', String(lv === level));
      b.classList.toggle('seg__btn--short', counts[lv] < need);
    }
    const categories = [...new Set(bank.filter((q) => q.level === level).map((q) => q.category))].sort();
    categorySelect.replaceChildren(...['', ...categories].map((c) => {
      const o = el('option', undefined, c === '' ? 'All categories' : c);
      o.value = c;
      return o;
    }));
    categorySelect.value = category;
    const visible = new Set(shown().map((r) => r.q.id));
    for (const r of rows) {
      r.row.hidden = !visible.has(r.q.id);
      r.box.checked = !disabled.has(r.q.id);
      r.row.classList.toggle('qrow--off', disabled.has(r.q.id));
    }
    empty.hidden = visible.size > 0;
    const short = counts[level] < need;
    count.textContent = `${level}: ${counts[level]} on · a race uses ${need}${short ? ` — turn on at least ${need - counts[level]} more` : ''}. Showing ${visible.size}.`;
    count.classList.toggle('qcount--bad', short);
  }

  store.subscribe(render);
  const node = el('section', 'acard');
  const head = el('header', 'acard__header');
  head.append(el('h2', 'acard__title', 'Question bank'), intro);
  node.append(head, tabs, toolbar, count, list, empty);
  root.append(node);
  render();
  return root;
}
