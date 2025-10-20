const BUILTIN_CACHE_KEY = "workbench:missing-builtins";
const BUILTIN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const SUPPORTED_BUCKETS = ["systems", "templates", "characters"];

function createEmptyCatalog() {
  return SUPPORTED_BUCKETS.reduce((catalog, bucket) => {
    catalog[bucket] = [];
    return catalog;
  }, {});
}

let builtinCatalog = createEmptyCatalog();

function createEmptyState() {
  return SUPPORTED_BUCKETS.reduce((state, bucket) => {
    state[bucket] = {};
    return state;
  }, {});
}

let cachedBuiltinState = null;

function supportsStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch (error) {
    console.warn("content-registry: localStorage unavailable", error);
    return false;
  }
}

function loadBuiltinState() {
  if (!supportsStorage()) {
    return createEmptyState();
  }
  try {
    const raw = window.localStorage.getItem(BUILTIN_CACHE_KEY);
    if (!raw) {
      return createEmptyState();
    }
    const parsed = JSON.parse(raw);
    const state = createEmptyState();
    SUPPORTED_BUCKETS.forEach((bucket) => {
      if (parsed?.[bucket] && typeof parsed[bucket] === "object") {
        state[bucket] = { ...parsed[bucket] };
      }
    });
    return state;
  } catch (error) {
    console.warn("content-registry: failed to parse builtin cache", error);
    return createEmptyState();
  }
}

function saveBuiltinState(state) {
  if (!supportsStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(BUILTIN_CACHE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("content-registry: failed to persist builtin cache", error);
  }
}

function getBuiltinState() {
  if (!cachedBuiltinState) {
    cachedBuiltinState = pruneExpiredEntries(loadBuiltinState());
  }
  return cachedBuiltinState;
}

function commitBuiltinState() {
  if (!cachedBuiltinState) {
    return;
  }
  saveBuiltinState(cachedBuiltinState);
}

function pruneExpiredEntries(state) {
  const now = Date.now();
  const next = createEmptyState();
  SUPPORTED_BUCKETS.forEach((bucket) => {
    const entries = state[bucket] || {};
    Object.entries(entries).forEach(([id, timestamp]) => {
      if (typeof timestamp !== "number") {
        return;
      }
      if (now - timestamp < BUILTIN_CACHE_TTL_MS) {
        next[bucket][id] = timestamp;
      }
    });
  });
  if (supportsStorage()) {
    saveBuiltinState(next);
  }
  return next;
}

function markBuiltinState(bucket, id, present) {
  if (!id || !bucket) {
    return;
  }
  const state = getBuiltinState();
  if (!state[bucket]) {
    state[bucket] = {};
  }
  if (present) {
    if (state[bucket][id]) {
      delete state[bucket][id];
      commitBuiltinState();
    }
    return;
  }
  state[bucket][id] = Date.now();
  commitBuiltinState();
}

function isBuiltinMarkedMissing(bucket, id) {
  if (!id || !bucket) {
    return false;
  }
  const state = getBuiltinState();
  const timestamp = state[bucket]?.[id];
  if (typeof timestamp !== "number") {
    return false;
  }
  if (Date.now() - timestamp >= BUILTIN_CACHE_TTL_MS) {
    delete state[bucket][id];
    commitBuiltinState();
    return false;
  }
  return true;
}

function filterAvailableBuiltins(bucket, entries) {
  return entries.filter((entry) => !isBuiltinMarkedMissing(bucket, entry.id));
}

export function markBuiltinMissing(bucket, id) {
  markBuiltinState(bucket, id, false);
}

export function markBuiltinAvailable(bucket, id) {
  markBuiltinState(bucket, id, true);
}

export function builtinIsTemporarilyMissing(bucket, id) {
  return isBuiltinMarkedMissing(bucket, id);
}

function normalizeCatalogEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!id) {
        return null;
      }
      return { ...entry, id };
    })
    .filter(Boolean);
}

export function applyBuiltinCatalog(catalog = {}) {
  const nextCatalog = createEmptyCatalog();
  SUPPORTED_BUCKETS.forEach((bucket) => {
    const entries = normalizeCatalogEntries(catalog[bucket]);
    nextCatalog[bucket] = entries;
    entries.forEach((entry) => {
      if (entry.available === false) {
        markBuiltinMissing(bucket, entry.id);
      } else {
        markBuiltinAvailable(bucket, entry.id);
      }
    });
  });
  builtinCatalog = nextCatalog;
}

export function listBuiltinContent(bucket) {
  const entries = Array.isArray(builtinCatalog[bucket]) ? builtinCatalog[bucket] : [];
  return filterAvailableBuiltins(bucket, entries);
}

export function listBuiltinSystems() {
  return listBuiltinContent("systems");
}

export function listBuiltinTemplates() {
  return listBuiltinContent("templates");
}

export function listBuiltinCharacters() {
  return listBuiltinContent("characters");
}

export function verifyBuiltinAsset(
  bucket,
  entry,
  { skipProbe = false, onMissing, onAvailable, onError } = {}
) {
  if (!entry || !entry.id || !entry.path) {
    return;
  }
  if (builtinIsTemporarilyMissing(bucket, entry.id)) {
    if (typeof onMissing === "function") {
      onMissing(entry);
    }
    return;
  }
  if (skipProbe || typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  window
    .fetch(entry.path, { method: "GET", cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        markBuiltinMissing(bucket, entry.id);
        if (typeof onMissing === "function") {
          onMissing(entry);
        }
        return;
      }
      markBuiltinAvailable(bucket, entry.id);
      if (typeof onAvailable === "function") {
        onAvailable(entry);
      }
      try {
        response.body?.cancel?.();
      } catch (error) {
        console.warn(
          `content-registry: unable to cancel builtin fetch for ${bucket}:${entry.id}`,
          error
        );
      }
    })
    .catch((error) => {
      if (typeof onError === "function") {
        onError(error, entry);
      } else {
        console.warn(
          `content-registry: failed to verify builtin ${bucket}:${entry.id}`,
          error
        );
      }
      markBuiltinMissing(bucket, entry.id);
      if (typeof onMissing === "function") {
        onMissing(entry);
      }
    });
}
