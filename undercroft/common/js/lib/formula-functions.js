// The single place every tool assembles its `=formula`/`@binding` function
// set from — before this existed, Press, Workbench, Loom's mapping engine,
// and Orrery each wired their own `functions` object into evaluateFormula by
// hand, and drifted: Workbench had a real, useful `libraryEntries(kind, path,
// value)` (fetch/filter an entire Library kind) that nothing else could use,
// even though every one of those tools has the same `dataManager` it needs.
// Not in bindings.js itself — `fetchKindEntriesWithIds` (content-fetch.js)
// transitively imports mapping-engine.js, which imports FROM bindings.js
// (`resolveBinding`), so bindings.js importing content-fetch.js back would
// be a real circular import. This module sits one layer above both instead:
// imports bindings.js's lookup primitives AND content-fetch.js's fetch
// helper, isn't imported by either of them, so nothing cycles.
import { createLookupFn, createLookupFieldFn } from "./bindings.js";
import { resolveDottedPath } from "./dotted-path.js";
import { fetchKindEntriesWithIds } from "./content-fetch.js";
import { pendingLibraryKinds } from "./library-pending.js";

// Module-level (not per-caller) — Press can have several Handouts/inspector
// previews alive at once; they share one fetch/cache per kind instead of
// each keeping an isolated copy. fetchKindEntriesWithIds is already
// internally cached (content-fetch.js's own cachedBulkFetch), so this is
// only about avoiding a redundant empty-then-reload flash per caller, not
// about avoiding duplicate network calls.
const libraryEntriesCache = new Map(); // kind -> entries[] ({id, entity} pairs)

// The three cache primitives, exported separately from the formula function
// itself — Workbench's own Repeater Add-picker and id-storage-Repeater
// display code (workbench-character-view.js) need the exact same "has this
// kind loaded yet / trigger a fetch / read what's cached" operations
// OUTSIDE of a formula evaluation (to decide whether to show "Loading…"
// before ever calling a formula), and used to keep a second, parallel cache
// of their own for it. One shared cache now, so a kind fetched for a
// Source/Options formula and a kind fetched for an id-storage Repeater are
// never two separate network round-trips for the same data.
export function isLibraryKindCached(kind) {
  return libraryEntriesCache.has(kind);
}

export function getCachedLibraryEntries(kind) {
  return libraryEntriesCache.get(kind) || [];
}

export function ensureLibraryKindCached(dataManager, kind, onDataReady) {
  if (!kind || libraryEntriesCache.has(kind) || pendingLibraryKinds.has(kind) || !dataManager) return;
  pendingLibraryKinds.add(kind);
  fetchKindEntriesWithIds(dataManager, kind)
    .then((entries) => {
      libraryEntriesCache.set(kind, entries);
      pendingLibraryKinds.delete(kind);
      onDataReady?.();
    })
    .catch(() => {
      libraryEntriesCache.set(kind, []);
      pendingLibraryKinds.delete(kind);
      onDataReady?.();
    });
}

// The generic `libraryEntries(kind, path, value)` formula function — given a
// Library `kind`, lazily fetches every entry of it and returns them,
// optionally filtered by a literal `path`/`value` match (a leading "!" on
// `value` negates it; an array-valued field at `path` matches by
// `.includes`). Returns `[]` on the very first call for an unseen kind
// (fires the fetch, calls `onDataReady()` once it resolves so the caller
// re-renders with real data) — moved from workbench-character-view.js's own
// local `libraryEntries`/`sourceKindCache`/`ensureSourceKindCached`
// (formerly the only place this existed) verbatim in behavior, just with the
// cache promoted to module scope and the fetch/re-render trigger passed in
// instead of closed over one page's own dataManager/renderCanvas.
// `path`/`value` are always plain literal arguments, never a nested "@..."
// formula — evaluateFormula's "@path" substitution runs blindly across the
// whole formula before any call is parsed, so a per-candidate formula-as-
// string would get mangled.
//
// `path === "id"` is special-cased to match against the ENTRY's own id
// (fetchKindEntriesWithIds' `{id, entity}` wrapper), never `entity.id` —
// confirmed (content-fetch.js's own toKindEntry comment) that plenty of
// kinds never duplicate their id inside the JSON body at all (Feature
// records: only name/description/mechanics/..., no `id` field), so filtering
// `'id'` against `entity` the same way as any other field silently matched
// nothing for those kinds.
export function createLibraryEntriesFn(dataManager, onDataReady) {
  return (kind, path, value) => {
    if (!kind || typeof kind !== "string") return [];
    if (!isLibraryKindCached(kind)) {
      ensureLibraryKindCached(dataManager, kind, onDataReady);
      return [];
    }
    const entries = getCachedLibraryEntries(kind);
    if (!path) return entries;
    const negate = typeof value === "string" && value.startsWith("!");
    const target = negate ? value.slice(1) : value;
    return entries.filter((entry) => {
      const raw = path === "id" ? entry.id : resolveDottedPath(entry.entity, path);
      const matches = Array.isArray(raw) ? raw.includes(target) : raw === target;
      return negate ? !matches : matches;
    });
  };
}

// The one call every tool should make instead of hand-rolling its own
// `functions` object. Every dependency is optional except `context` — a
// caller with no System (Press), no dataManager (derived-formulas.js's pure
// scalar contexts), or no re-render hook just gets that capability omitted,
// never a thrown "missing argument". `extraTables` is for mapping-engine.js's
// own import-time lookup tables, which live outside any bound record (so
// neither `fieldDefinitions` nor a `context` path could ever reach them).
export function createFormulaFunctions({
  context,
  fieldDefinitions,
  rootContext,
  dataManager,
  onDataReady,
  extraTables,
} = {}) {
  const functions = {
    lookup: createLookupFn(context, fieldDefinitions, extraTables),
    lookupField: createLookupFieldFn(rootContext ?? context),
  };
  if (dataManager) {
    functions.libraryEntries = createLibraryEntriesFn(dataManager, onDataReady);
  }
  return functions;
}
