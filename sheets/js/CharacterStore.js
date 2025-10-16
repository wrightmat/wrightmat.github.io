const clone = (value) => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

export class CharacterStore {
  constructor(character) {
    this.character = clone(character);
    if (!this.character.data) this.character.data = {};
    if (!this.character.state) this.character.state = { timers: {}, log: [] };
    this.history = [this.#cloneData()];
    this.pointer = 0;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCharacter() {
    return clone(this.character);
  }

  getData() {
    return clone(this.character.data || {});
  }

  #cloneData() {
    return clone(this.character.data || {});
  }

  #notify() {
    for (const listener of this.listeners) {
      listener(this.character);
    }
  }

  #commit(newData, pushHistory = true) {
    this.character.data = newData;
    if (pushHistory) {
      this.history = this.history.slice(0, this.pointer + 1);
      this.history.push(clone(newData));
      this.pointer = this.history.length - 1;
    }
    this.#notify();
  }

  #ensureObjectPath(target, segments) {
    let node = target;
    for (let i = 0; i < segments.length; i++) {
      const key = segments[i];
      if (i === segments.length - 1) {
        return { node, key };
      }
      if (typeof node[key] !== 'object' || node[key] === null) {
        node[key] = {};
      }
      node = node[key];
    }
    return { node, key: segments[segments.length - 1] };
  }

  #splitPath(bind) {
    if (!bind || !bind.startsWith('@')) return [];
    return bind.slice(1).split('.').filter(Boolean);
  }

  write(bind, value) {
    const segments = this.#splitPath(bind);
    if (!segments.length) return;
    const draft = this.#cloneData();
    const { node, key } = this.#ensureObjectPath(draft, segments);
    node[key] = value;
    this.#commit(draft);
  }

  transaction(mutator) {
    const draft = this.#cloneData();
    mutator(draft);
    this.#commit(draft);
  }

  removeAt(bind, index) {
    const segments = this.#splitPath(bind);
    if (!segments.length) return;
    const draft = this.#cloneData();
    let node = draft;
    for (let i = 0; i < segments.length; i++) {
      const key = segments[i];
      if (i === segments.length - 1) {
        if (!Array.isArray(node[key])) return;
        node[key].splice(index, 1);
      } else {
        node = node[key];
        if (typeof node !== 'object' || node === null) return;
      }
    }
    this.#commit(draft);
  }

  undo() {
    if (this.pointer === 0) return;
    this.pointer -= 1;
    const snapshot = clone(this.history[this.pointer]);
    this.#commit(snapshot, false);
  }

  redo() {
    if (this.pointer >= this.history.length - 1) return;
    this.pointer += 1;
    const snapshot = clone(this.history[this.pointer]);
    this.#commit(snapshot, false);
  }

  canUndo() {
    return this.pointer > 0;
  }

  canRedo() {
    return this.pointer < this.history.length - 1;
  }

  exportData() {
    return clone(this.character.data || {});
  }

  importData(obj) {
    const data = clone(obj || {});
    this.#commit(data);
  }

  updateTimer(path, payload) {
    if (!this.character.state) this.character.state = {};
    if (!this.character.state.timers) this.character.state.timers = {};
    const segments = this.#splitPath(path.startsWith('@') ? path : `@${path}`);
    const timerKey = segments.slice(1).join('.') || segments[0] || '';
    this.character.state.timers[timerKey] = payload;
    this.#notify();
  }

  readTimer(path) {
    const segments = this.#splitPath(path.startsWith('@') ? path : `@${path}`);
    const timerKey = segments.slice(1).join('.') || segments[0] || '';
    return this.character.state?.timers?.[timerKey] || null;
  }
}
