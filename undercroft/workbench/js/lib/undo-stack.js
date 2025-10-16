const DEFAULT_LIMIT = 100;

function readSession(key) {
  try {
    const stored = sessionStorage.getItem(key);
    return stored ? JSON.parse(stored) : { undo: [], redo: [] };
  } catch (error) {
    console.warn("UndoStack: unable to read session storage", error);
    return { undo: [], redo: [] };
  }
}

function writeSession(key, payload) {
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.warn("UndoStack: unable to persist session storage", error);
  }
}

export class UndoRedoStack {
  constructor({ storageKey = null, limit = DEFAULT_LIMIT } = {}) {
    this.limit = limit;
    this.storageKey = storageKey;
    this.undo = [];
    this.redo = [];
    if (storageKey) {
      const { undo, redo } = readSession(storageKey);
      this.undo = undo;
      this.redo = redo;
    }
  }

  push(entry) {
    this.undo.push(entry);
    if (this.undo.length > this.limit) {
      this.undo.splice(0, this.undo.length - this.limit);
    }
    this.redo = [];
    this._persist();
  }

  undoStep() {
    if (!this.undo.length) {
      return null;
    }
    const entry = this.undo.pop();
    this.redo.push(entry);
    this._persist();
    return entry;
  }

  redoStep() {
    if (!this.redo.length) {
      return null;
    }
    const entry = this.redo.pop();
    this.undo.push(entry);
    this._persist();
    return entry;
  }

  clear() {
    this.undo = [];
    this.redo = [];
    this._persist();
  }

  _persist() {
    if (!this.storageKey) {
      return;
    }
    writeSession(this.storageKey, { undo: this.undo, redo: this.redo });
  }
}
