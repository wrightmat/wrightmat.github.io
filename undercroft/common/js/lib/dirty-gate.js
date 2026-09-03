// Shared Save-button dirty-gating: disables Save once there's nothing new to
// save. `buildSnapshot` must return the exact post-export-transform shape
// that will actually be saved, synced from live input fields, not the last-
// loaded record. Callers still gate on "is a record even loaded" themselves.
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
