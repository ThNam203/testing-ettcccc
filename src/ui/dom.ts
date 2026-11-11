/** Tiny DOM helper. Text is always set via textContent so chat-supplied strings can't inject HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setVisible(node: HTMLElement, visible: boolean): void {
  node.hidden = !visible;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
