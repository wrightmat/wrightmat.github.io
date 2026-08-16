// A small, generic Promise-based wrapper around one IndexedDB object store —
// not audio-specific, even though the Audio Recorder widget is its first
// consumer. IndexedDB's own native API is callback/event-based and verbose
// for what this suite needs (open once, put/getAll/clear against one
// store); this exists so a future consumer with the same shape of need
// doesn't hand-roll the same open/onupgradeneeded/transaction boilerplate
// again. Reach for this before writing a second copy of it.

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
  };
}
