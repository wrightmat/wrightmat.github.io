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

// A record whose own before/after snapshots are large (Orrery's own map
// JSON, especially with embedded image data) can blow sessionStorage's
// ~5-10MB per-origin quota well before the in-memory stack even reaches its
// own `limit` — confirmed real bug (a QuotaExceededError logged on every
// single edit once a map's history grew past that point, permanently, not
// a one-time hiccup). Rather than just catching and logging that forever,
// retry with progressively less history persisted (oldest half of whichever
// stack still has entries first) until a write actually fits or there's
// nothing left to drop — self-adapts to whatever this particular record's
// own snapshot size allows instead of hardcoding a fixed entry count that's
// still too big for some records and needlessly small for others. Only
// ever trims what's WRITTEN here — the caller's own in-memory undo/redo
// arrays are never touched, so undo/redo within the current session stays
// fully intact regardless; a page reload just restores however much of the
// tail end actually made it into storage.
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
