// Shared Save-button dirty-gating: Save should disable once there's nothing
// new to save (right after a save, or before anything's been generated/
// loaded). Extracted from Crucible's original inline lastSavedSnapshot/
// buildRecordForSave/isRecordDirty pattern — the one place this was actually
// implemented; Forge and Vault never got it and their Save buttons stayed
// enabled indefinitely. See undercroft/README.md's Code Conventions section.
//
// `buildSnapshot` should return the exact JSON-serializable shape that will
// actually be saved (post any export-shape transform), synced from live
// input fields — not the last-loaded record, which wouldn't reflect an
// in-progress name/notes edit until the next save. Callers still gate on
// "is a record even loaded" themselves (e.g. `!hasRecord || !gate.isDirty()`)
// — this only tracks dirtiness relative to the last save.
export function createDirtyGate({ buildSnapshot }) {
  let lastSavedSnapshot = null;

  return {
    isDirty() {
      if (lastSavedSnapshot === null) return true;
      return JSON.stringify(buildSnapshot()) !== lastSavedSnapshot;
    },
    // True once something has actually been saved — the usual Delete-button
    // gate alongside ownership.js's allowsDelete (nothing to delete before a
    // first save).
    hasSaved() {
      return lastSavedSnapshot !== null;
    },
    // Called right after a successful save, with the exact payload that was
    // saved (falls back to buildSnapshot() if omitted).
    markClean(snapshot) {
      lastSavedSnapshot = JSON.stringify(snapshot !== undefined ? snapshot : buildSnapshot());
    },
    // Called after generating fresh content or deleting — there's no saved
    // baseline to compare against until the next save.
    markDirty() {
      lastSavedSnapshot = null;
    },
  };
}
