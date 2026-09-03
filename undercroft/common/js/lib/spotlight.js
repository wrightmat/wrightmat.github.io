// Spotlight resolution — lets Dashboard widgets (Handout/Map/Clock/Browser/
// Calendar/Soundboard/Combat) find out what's currently shown to the active
// campaign group, via the group log's `spotlight`/`spotlight-update`/
// `spotlight-clear` entries (server/groups.py). Each widget posts/clears its
// own spotlight directly through dataManager.spotlightToGroup/clearSpotlight
// — this module only reads that state back.
import { loadLibraryData } from "./content-fetch.js";

// Same "category === print" filter as Press's listPrintTemplateEntries
// (press/js/templates.js) — duplicated here rather than importing across
// tool boundaries, since it's the only Press-specific knowledge this shared
// module needs. Exported so handout.js's template picker reuses it too.
export async function listPrintTemplates(dataManager) {
  const listing = await dataManager.list("templates", { refresh: true });
  const entries = dataManager.collectListEntries(listing.remote, ["owned", "shared", "public", "items"]);
  return entries.filter((entry) => (entry.category || "character") === "print");
}

// Kinds with no print-card rendering of their own — Orrery's maps are a
// spatial canvas, not a single-entity card Press can lay out. Spotlighting
// one is just a link back into the owning tool (workbench-character-view.js's
// refreshNowShowing renders these as an "Open" link), so the template
// picker is skipped entirely.
export const LINK_ONLY_KINDS = new Set(["map", "encounter"]);

// Passed to getGroupLog's `types` filter so the LIMIT-bounded window is
// spent entirely on spotlight-relevant rows — otherwise a chatty inline
// widget's own frequent spotlight-update refreshes (a ticking Clock) can
// crowd an unrelated widget's still-active `spotlight` entry out of the
// window, making resolveIsSpotlighted wrongly report it as no longer shown.
const SPOTLIGHT_LOG_TYPES = ["spotlight", "spotlight-update", "spotlight-clear"];

// "What's the most recently spotlighted thing of this kind, if still
// active" — a SINGLE-SLOT resolution for consumers with no specific id to
// check (Combat Tracker's player-mode poll, Character sheet's initiative
// push — Combat Tracker only ever has one instance per dashboard). NOT for
// a widget type that can have multiple simultaneous instances of the same
// kind — see resolveIsSpotlighted below for that; Handout/Map/Clock use it.
//
// Server entries come back oldest-first, sorted newest-first here. Only
// looks at entries ABOUT this kind: a matching `spotlight`/
// `spotlight-update`/`spotlight-clear`, or a kind-agnostic `spotlight-clear`
// (clearSpotlight can omit kind for "clear whatever's shown, of any kind";
// nothing currently posts one, but it's supported). `spotlight-update` is a
// silent data refresh on an already-shown kind, treated the same as
// `spotlight` here so a Clock tick doesn't read as "no longer shown."
// Returns null if nothing of `kind` is currently spotlighted.
async function resolveActiveSpotlightEntry(dataManager, { groupId, shareToken, kind, limit = 100 } = {}) {
  if (!dataManager || (!groupId && !shareToken)) return null;
  try {
    const log = await dataManager.getGroupLog({ groupId, shareToken, limit, types: SPOTLIGHT_LOG_TYPES });
    const entries = Array.isArray(log?.entries) ? log.entries : [];
    entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const latest = entries.find((entry) => {
      if (entry?.type === "spotlight" || entry?.type === "spotlight-update") return entry.payload?.kind === kind;
      if (entry?.type === "spotlight-clear") return !entry.payload?.kind || entry.payload.kind === kind;
      return false;
    });
    if (!latest || latest.type === "spotlight-clear") {
      return null;
    }
    return latest;
  } catch (error) {
    return null;
  }
}

export async function resolveActiveSpotlightId(dataManager, { groupId, shareToken, kind, limit = 100 } = {}) {
  const entry = await resolveActiveSpotlightEntry(dataManager, { groupId, shareToken, kind, limit });
  return entry?.payload?.id || "";
}

// "Everything currently spotlighted, across every kind" — the full active
// set, unlike every resolver above (each scoped to one `kind` or one
// `(kind, id)`). Needed for spotlight-inbox.js's catch-up scan when a
// viewer first starts watching a group: without this, someone joining after
// the GM spotlighted both a Map and an NPC handout would only learn about
// whichever is the single most recent log entry.
//
// Same "latest entry per key wins" reconstruction as the resolvers above,
// applied across every (kind,id) pair at once. `limit` defaults higher
// (200 vs 100) since reconstructing several independent keys needs a wider
// window than settling just one.
export async function resolveActiveSpotlights(dataManager, { groupId, shareToken, limit = 200 } = {}) {
  if (!dataManager || (!groupId && !shareToken)) return [];
  let entries;
  try {
    const log = await dataManager.getGroupLog({ groupId, shareToken, limit, types: SPOTLIGHT_LOG_TYPES });
    entries = Array.isArray(log?.entries) ? log.entries : [];
  } catch (error) {
    return [];
  }
  entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  // Walking newest-first: the FIRST entry seen for a (kind,id) key is the
  // latest, so it alone decides that key's state (`decided.has(key)` skips
  // older entries for the same key). A kind-wide clear (kind, no id)
  // retroactively decides every OLDER same-kind spotlight as cleared
  // (clearedKinds) without touching a NEWER one already resolved active. A
  // global clear (no kind) stops the walk — nothing older survives.
  const decided = new Map(); // "kind:id" -> true (active) | false (cleared)
  const clearedKinds = new Set();
  const active = [];
  for (const entry of entries) {
    if (entry?.type === "spotlight-clear") {
      const clearKind = entry.payload?.kind;
      const clearId = entry.payload?.id;
      if (!clearKind) break; // Global clear — nothing older survives.
      if (!clearId) {
        clearedKinds.add(clearKind);
        continue;
      }
      const key = `${clearKind}:${clearId}`;
      if (!decided.has(key)) decided.set(key, false);
      continue;
    }
    if (entry?.type !== "spotlight" && entry?.type !== "spotlight-update") continue;
    const kind = String(entry.payload?.kind || "").trim();
    const id = String(entry.payload?.id || "").trim();
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    if (decided.has(key)) continue;
    if (clearedKinds.has(kind)) {
      decided.set(key, false);
      continue;
    }
    decided.set(key, true);
    active.push(entry);
  }
  return active;
}

// "Is THIS SPECIFIC (kind, id) currently shown" — what a widget type with
// multiple simultaneous instances of the same kind needs (two Handouts, two
// Maps, two Clocks — Clock's own kind is ALWAYS "clock" regardless of which
// clock, so without this a second clock's spotlight made the first one's
// still-active spotlight invisible via resolveActiveSpotlightId's
// single-slot answer).
//
// An entry is "about" (kind, id) if it's a matching `spotlight`/
// `spotlight-update`, a matching `spotlight-clear` (or one matching kind
// with no id — "clear every instance of this kind," supported but unused),
// or a kind-agnostic `spotlight-clear` (matches everything, same
// global-clear escape hatch as resolveActiveSpotlightId). The latest such
// entry decides; spotlighted only if it's `spotlight`/`spotlight-update`.
async function resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id, limit = 100 } = {}) {
  if (!dataManager || (!groupId && !shareToken) || !kind || !id) return null;
  try {
    const log = await dataManager.getGroupLog({ groupId, shareToken, limit, types: SPOTLIGHT_LOG_TYPES });
    const entries = Array.isArray(log?.entries) ? log.entries : [];
    entries.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const latest = entries.find((entry) => {
      if (entry?.type === "spotlight" || entry?.type === "spotlight-update") {
        return entry.payload?.kind === kind && entry.payload?.id === id;
      }
      if (entry?.type === "spotlight-clear") {
        const clearKind = entry.payload?.kind;
        if (!clearKind) return true; // Global clear — matches every (kind, id).
        if (clearKind !== kind) return false;
        const clearId = entry.payload?.id;
        return !clearId || clearId === id; // Kind-wide clear, or this exact instance.
      }
      return false;
    });
    return latest && latest.type !== "spotlight-clear" ? latest : null;
  } catch (error) {
    return null;
  }
}

export async function resolveIsSpotlighted(dataManager, { groupId, shareToken, kind, id, limit = 100 } = {}) {
  const entry = await resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id, limit });
  return Boolean(entry);
}

// Same per-instance resolution as resolveIsSpotlighted, but hands back the
// entry's `data` payload instead of a boolean — what a follower of an
// _INLINE_SPOTLIGHT_KINDS widget (Clock, Browser — see server/groups.py)
// reads instead of fetching a Library record, since these kinds have none.
export async function resolveSpotlightData(dataManager, { groupId, shareToken, kind, id, limit = 100 } = {}) {
  const entry = await resolveActiveInstanceEntry(dataManager, { groupId, shareToken, kind, id, limit });
  return entry?.payload?.data ?? null;
}

// A spotlight log entry never carries a display title (server/groups.py
// only requires kind+id) — a real name for a Library-backed kind needs a
// separate fetch. Fetch-once, cache, re-render-on-resolve: `ensure(kind,
// id, onLoaded)` kicks off at most one fetch per key; `get(kind, id)` reads
// whatever's cached so far. Shared by dashboard.js's spotlight panel/Game
// Log and Workbench's "Now Showing" panel.
// `getShareToken` is a getter, not a plain value — the active share token
// can change after this cache is created, and every fetch should use
// whatever's current at call time.
export function createSpotlightTitleCache(dataManager, getShareToken) {
  const titleCache = new Map();
  const pendingFetches = new Set();
  function ensure(kind, id, onLoaded) {
    const key = `${kind}:${id}`;
    if (!kind || !id || titleCache.has(key) || pendingFetches.has(key)) return;
    pendingFetches.add(key);
    loadLibraryData(`${kind}/${id}`, dataManager, getShareToken ? getShareToken() : "")
      .then((payload) => {
        titleCache.set(key, payload?.title || payload?.name || "");
        pendingFetches.delete(key);
        onLoaded?.();
      })
      .catch(() => pendingFetches.delete(key));
  }
  function get(kind, id) {
    return titleCache.get(`${kind}:${id}`) || "";
  }
  return { ensure, get };
}

