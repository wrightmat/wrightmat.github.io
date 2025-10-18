const BUILTIN_CACHE_KEY = "workbench:missing-builtins";
const BUILTIN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_BUILTIN_STATE = {
  systems: {},
  templates: {},
};

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
    return { ...DEFAULT_BUILTIN_STATE };
  }
  try {
    const raw = window.localStorage.getItem(BUILTIN_CACHE_KEY);
    if (!raw) {
      return { ...DEFAULT_BUILTIN_STATE };
    }
    const parsed = JSON.parse(raw);
    return {
      systems: parsed?.systems && typeof parsed.systems === "object" ? { ...parsed.systems } : {},
      templates: parsed?.templates && typeof parsed.templates === "object" ? { ...parsed.templates } : {},
    };
  } catch (error) {
    console.warn("content-registry: failed to parse builtin cache", error);
    return { ...DEFAULT_BUILTIN_STATE };
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
  const next = { systems: {}, templates: {} };
  ["systems", "templates"].forEach((bucket) => {
    const entries = state[bucket] || {};
    next[bucket] = {};
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

export function applyBuiltinCatalog(catalog = {}) {
  ["systems", "templates"].forEach((bucket) => {
    const entries = Array.isArray(catalog[bucket]) ? catalog[bucket] : [];
    entries.forEach((entry) => {
      if (!entry || !entry.id) {
        return;
      }
      if (entry.available) {
        markBuiltinAvailable(bucket, entry.id);
      } else {
        markBuiltinMissing(bucket, entry.id);
      }
    });
  });
}

export const BUILTIN_SYSTEMS = [
  {
    id: "sys.dnd5e",
    title: "D&D 5e (Basic)",
    path: "data/systems/sys.dnd5e.json",
  },
];

export const BUILTIN_TEMPLATES = [
  {
    id: "tpl.5e.flex-basic",
    title: "5e — Flex Basic",
    path: "data/templates/tpl.5e.flex-basic.json",
  },
];

export function listBuiltinSystems() {
  return filterAvailableBuiltins("systems", BUILTIN_SYSTEMS);
}

export function listBuiltinTemplates() {
  return filterAvailableBuiltins("templates", BUILTIN_TEMPLATES);
}
