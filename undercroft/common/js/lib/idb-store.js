// Generic Promise-based wrapper around one IndexedDB object store — not
// audio-specific despite the Audio Recorder widget being its first
// consumer. Reach for this before hand-rolling IndexedDB's own callback API.

const dbCache = new Map(); // `${dbName}::${storeName}` -> Promise<IDBDatabase>, so opening twice reuses one connection

function openDb(dbName, storeName, { keyPath } = {}) {
  const cacheKey = `${dbName}::${storeName}`;
  if (dbCache.has(cacheKey)) return dbCache.get(cacheKey);
  const promise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB isn't available in this browser."));
      return;
    }
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, keyPath ? { keyPath } : { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB."));
  });
  dbCache.set(cacheKey, promise);
  return promise;
}

// createIdbStore(dbName, storeName, {keyPath}) -> {put, getAll, clear}.
// `keyPath` omitted means an auto-incrementing key; given, the record
// itself carries its own key field (e.g. {sessionId, index, ...}).
export function createIdbStore(dbName, storeName, { keyPath } = {}) {
  async function withStore(mode, run) {
    const db = await openDb(dbName, storeName, { keyPath });
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = run(store);
      tx.oncomplete = () => resolve(request?.result);
      // An unhandled request error aborts its transaction, which fires
      // this too — no separate per-request error handler needed for this
      // simple a use case.
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
    });
  }

  return {
    async put(value) {
      return withStore("readwrite", (store) => store.put(value));
    },
    async getAll() {
      return withStore("readonly", (store) => store.getAll());
    },
    async clear() {
      return withStore("readwrite", (store) => store.clear());
    },
    // Deletes one record by store key — for a caller (e.g. audio-recorder.js)
    // that must remove only its own entries, since `clear()` wipes the whole
    // shared store even when multiple logical "sessions" share it.
    async delete(key) {
      return withStore("readwrite", (store) => store.delete(key));
    },
  };
}
