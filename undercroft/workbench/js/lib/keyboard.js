function normalizeKey(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("ctrl");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}

export class KeyboardShortcuts {
  constructor({ target = document } = {}) {
    this.target = target;
    this.shortcuts = new Map();
    this._listener = this._handleKey.bind(this);
    this.target.addEventListener("keydown", this._listener);
  }

  register(combo, handler, { preventDefault = true } = {}) {
    const key = Array.isArray(combo) ? combo.join("+") : combo;
    this.shortcuts.set(key.toLowerCase(), { handler, preventDefault });
  }

  unregister(combo) {
    const key = Array.isArray(combo) ? combo.join("+") : combo;
    this.shortcuts.delete(key.toLowerCase());
  }

  _handleKey(event) {
    const key = normalizeKey(event);
    if (this.shortcuts.has(key)) {
      const { handler, preventDefault } = this.shortcuts.get(key);
      if (preventDefault) {
        event.preventDefault();
      }
      handler(event);
    }
  }

  destroy() {
    this.target.removeEventListener("keydown", this._listener);
    this.shortcuts.clear();
  }
}
