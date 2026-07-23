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

  requeueUndo(entry) {
    if (!entry) {
      return;
    }
    if (this.redo.length && this.redo[this.redo.length - 1] === entry) {
      this.redo.pop();
    }
    this.undo.push(entry);
    this._persist();
  }

  requeueRedo(entry) {
    if (!entry) {
      return;
    }
    if (this.undo.length && this.undo[this.undo.length - 1] === entry) {
      this.undo.pop();
    }
    this.redo.push(entry);
    this._persist();
  }

  clear() {
    this.undo = [];
    this.redo = [];
    this._persist();
  }

  // Drops only the entries a predicate matches, leaving the rest of the
  // stack intact — for a consumer sharing one stack across several
  // independent editors (tagging each entry with its own `type`, say), so
  // resetting one editor's history doesn't wipe every other editor's undo
  // history too.
  removeWhere(predicate) {
    if (typeof predicate !== "function") return;
    this.undo = this.undo.filter((entry) => !predicate(entry));
    this.redo = this.redo.filter((entry) => !predicate(entry));
    this._persist();
  }

  _persist() {
    if (!this.storageKey) {
      return;
    }
    writeSession(this.storageKey, { undo: this.undo, redo: this.redo });
  }
}
