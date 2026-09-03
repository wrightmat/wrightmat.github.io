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

// A record with large before/after snapshots (Orrery's map JSON with
// embedded images) can blow sessionStorage's ~5-10MB quota well before the
// in-memory stack reaches its own `limit`. On overflow, retry with
// progressively less history persisted (oldest half first) until it fits —
// self-adapts to the record's own snapshot size. Only trims what's WRITTEN
// here; the caller's in-memory undo/redo arrays stay untouched, so undo/redo
// within the session is unaffected — a reload just restores less history.
function writeSession(key, payload) {
  let { undo, redo } = payload;
  for (;;) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ undo, redo }));
      return;
    } catch (error) {
      if (!undo.length && !redo.length) {
        console.warn("UndoStack: unable to persist session storage", error);
        try {
          sessionStorage.removeItem(key);
        } catch (removeError) {
          // Ignored — nothing more to do.
        }
        return;
      }
      if (undo.length) {
        undo = undo.slice(Math.ceil(undo.length / 2));
      } else {
        redo = redo.slice(Math.ceil(redo.length / 2));
      }
    }
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

  // For a consumer sharing one stack across several independent editors
  // (tagged by `type`) — resets one editor's history without wiping others'.
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
