import { profileUrl, type Period } from '../../admin/statsApi';
import { el } from '../dom';

/** Builders shared by the Stats and Winners & gifts tabs. */

export type Notify = (ok: boolean, message: string) => void;

export const PERIODS: readonly { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: 'all', label: 'All time' },
];

export function cardWith(title: string, intro: string | null, body: HTMLElement, extra?: HTMLElement): HTMLElement {
  const node = el('section', 'acard');
  const head = el('header', extra ? 'acard__header acard__header--row' : 'acard__header');
  const titles = el('div');
  titles.append(el('h2', 'acard__title', title));
  if (intro !== null) titles.append(el('p', 'acard__intro', intro));
  head.append(titles);
  if (extra) head.append(extra);
  const wrap = el('div', 'acard__body');
  wrap.append(body);
  node.append(head, wrap);
  return node;
}

export function tile(label: string, value: string, note?: string): HTMLElement {
  const node = el('div', 'tile');
  node.append(el('p', 'tile__label', label), el('p', 'tile__value', value));
  if (note !== undefined) node.append(el('p', 'tile__note', note));
  return node;
}

/** Meter list row: name, bar (share of a whole), figure. Single hue; the track is a lighter step. */
export function meterRow(name: string, share: number | null, figure: string, title?: string): HTMLElement {
  const row = el('div', 'meter-row');
  if (title !== undefined) row.title = title;
  const track = el('div', 'meter');
  const fill = el('div', 'meter__fill');
  fill.style.width = `${Math.max(0, Math.min(1, share ?? 0)) * 100}%`;
  track.append(fill);
  row.append(el('span', 'meter-row__name', name), track, el('span', 'meter-row__figure', figure));
  return row;
}

export function table(headers: readonly string[], rows: readonly HTMLTableRowElement[], empty: string): HTMLElement {
  if (rows.length === 0) return el('p', 'empty', empty);
  const node = el('table', 'atable');
  const head = el('tr');
  headers.forEach((h) => head.append(el('th', undefined, h)));
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  tbody.append(...rows);
  node.append(thead, tbody);
  const scroll = el('div', 'atable__scroll');
  scroll.append(node);
  return scroll;
}

export const td = (text: string, className?: string): HTMLTableCellElement => el('td', className, text);
export const dateTime = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Nickname over a TikTok profile link (or "no @handle"), for finding the viewer to contact them. */
export function playerCell(nickname: string | null, handle: string | null): HTMLTableCellElement {
  const cell = el('td', 'player-cell');
  cell.append(el('span', 'player-cell__name', nickname ?? '(deleted viewer)'));
  const url = profileUrl(handle);
  if (url !== null && handle !== null) {
    const a = el('a', 'player-cell__handle', `@${handle}`);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    cell.append(a);
  } else if (nickname !== null) {
    cell.append(el('span', 'player-cell__none', 'no @handle'));
  }
  return cell;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
