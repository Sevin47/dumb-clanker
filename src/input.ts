/** Keyboard state. Nobody drives a bot any more — this is only for the result screen. */
const DOWN = new Set<string>();

export function initInput() {
  window.addEventListener('keydown', (e) => DOWN.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => DOWN.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => DOWN.clear());
}

export const pressed = (k: string) => DOWN.has(k);
export const consume = (k: string) => DOWN.delete(k);
