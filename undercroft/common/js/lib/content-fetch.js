// Shared source-fetch plumbing: D&D Beyond (character API + scraped content
// pages) and the 5e API, plus plain JSON upload/paste. Originally lived only in
// press/js/source-data.js; extracted here so Loom's fetch workflow and Press's
// source picker can both use it without duplicating the fetch/parse logic.
// press/js/source-data.js now re-exports from this module unchanged.

import { applyMapping } from "./mapping-engine.js";
import { deriveLookupTables } from "./system-lookup-tables.js";
import { createMappingCustomFunctions } from "./mapping-custom-functions.js";

const SRD_BASE_URL = "https://www.dnd5eapi.co";
const DDB_CHARACTER_URL = "https://character-service.dndbeyond.com/character/v5/character/";
const CORS_PROXY = "https://corsproxy.io/?url=";
// The DDB-import pipeline is inherently D&D-5e-specific (D&D Beyond only ever
// has 5e content) — hardcoding which System record to derive lookup tables
// from is the same degree of specificity loadCharacterMappingDefinition
// below already has for ddb-character.json.
const DND5E_SYSTEM_ID = "sys.dnd5e";

// The two mapping-driven sources Loom's own Import tab (and Workbench's
// player-facing Import Character flow) offer a picker for — narrower than
// loadSourceData/loadSourceDataRaw's own dispatch below, which also handles
// "library"/"json"/"manual" for other pickers (Press's own source picker)
// that have no mapping/$source concept at all. Extracted from Loom's local
// SOURCES array (identical shape/values) so both tools share one list
// instead of two copies that could drift.
export const SOURCES = [
  {
    id: "ddb",
    label: "D&D Beyond",
    valueLabel: "Character ID or URL",
    placeholder: "e.g. 123456789, or https://www.dndbeyond.com/classes/2190875-barbarian",
    helpTopic: "loom.source.ddb",
  },
  {
    id: "srd",
    label: "5e API",
    valueLabel: "API Endpoint or URL",
    placeholder: "e.g. /api/2024/classes/barbarian",
    helpTopic: "loom.source.srd",
  },
];

// The browser's own SyntaxError for malformed JSON only ever gives a
// position/line/column — never which fetch it came from. Every
// response.json() call in this
// file goes through here instead so that context (a URL, or a
// kind/id.json label for library entries — the ones most likely to be
// hand-edited and actually break) gets attached to the error every
// consumer (Press's status toasts, Loom, console) ultimately shows.
async function parseJsonResponse(response, sourceLabel) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${sourceLabel}: ${error.message}`);
  }
}

export async function readJsonFile(file) {
  if (!file) return null;
  if (typeof file === "string") {
    return JSON.parse(file);
  }
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  return JSON.parse(text);
}

export function extractDdbId(value) {
  if (!value) return null;
  const asString = String(value).trim();
  const matches = asString.match(/(\d+)/g);
  if (!matches || !matches.length) return null;
  return matches[matches.length - 1];
}

export async function fetchDdbCharacter(id) {
  const url = `${CORS_PROXY}${encodeURIComponent(`${DDB_CHARACTER_URL}${id}`)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`D&D Beyond fetch failed (${response.status}).`);
  }
  const payload = await parseJsonResponse(response, url);
  return payload?.data ?? payload;
}

// D&D Beyond content pages (classes/backgrounds/species) have no API — unlike
// the character endpoint, this fetches and parses the actual rendered HTML page.
// Parsing lives in a separate classic script (common/ddb-content-parser.js,
// mirroring ddb-parser.js's pattern) so the page-structure-dependent part can be
// swapped out independently if DDB's markup changes or this approach needs to
// change entirely.
export const DDB_CONTENT_TYPES = [
  { type: "class", pattern: /\/classes\/[\w-]+/ },
  { type: "background", pattern: /\/backgrounds\/[\w-]+/ },
  { type: "species", pattern: /\/species\/[\w-]+/ },
];

export function detectDdbContentType(value) {
  const trimmed = String(value || "").trim();
  const match = DDB_CONTENT_TYPES.find(({ pattern }) => pattern.test(trimmed));
  return match?.type ?? null;
}

export function resolveDdbContentUrl(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http")) return trimmed;
  return `https://www.dndbeyond.com${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

export async function fetchDdbContentPage(url) {
  // Prefer the shared server's local proxy (server/app.py's /ddb-proxy): it can
  // attach a session cookie read from a local, gitignored file so gated content
  // (e.g. non-free subclasses) resolves fully, and never routes that cookie
  // through a third party. Falls back to the public CORS proxy (same one used
  // for characters) if the local proxy route isn't available at all — e.g.
  // Press hosted without the Python backend.
  const localResponse = await fetch(`/ddb-proxy?url=${encodeURIComponent(url)}`).catch(() => null);
  if (localResponse) {
    if (localResponse.ok) {
      return localResponse.text();
    }
    if (localResponse.status !== 404) {
      throw new Error(`D&D Beyond page fetch failed (${localResponse.status}).`);
    }
  }
  const proxied = `${CORS_PROXY}${encodeURIComponent(url)}`;
  const response = await fetch(proxied);
  if (!response.ok) {
    throw new Error(`D&D Beyond page fetch failed (${response.status}).`);
  }
  return response.text();
}

export const DDB_CONTENT_PARSERS = {
  class: "ddbParseClassPage",
  background: "ddbParseBackgroundPage",
  species: "ddbParseSpeciesPage",
};

export async function loadDdbContentData(value, contentType) {
  const parserName = DDB_CONTENT_PARSERS[contentType];
  if (typeof window === "undefined" || typeof window[parserName] !== "function") {
    throw new Error("D&D Beyond content parser is not available.");
  }
  const url = resolveDdbContentUrl(value);
  const html = await fetchDdbContentPage(url);
  return window[parserName](html, url);
}

// Same dispatch loadDdbData uses, but a character fetch stops at the raw
// character-service response instead of also normalizing it — Loom's own
// mapping editor needs the un-parsed object to build/edit mappings against.
export async function loadDdbRawData(value) {
  const contentType = detectDdbContentType(value);
  if (contentType) {
    return loadDdbContentData(value, contentType);
  }
  const id = extractDdbId(value);
  if (!id) {
    throw new Error("Enter a valid D&D Beyond character ID/URL, or a classes/backgrounds/species page URL.");
  }
  return fetchDdbCharacter(id);
}

// Any named mapping definition (undercroft/loom/mappings/{id}.json), fetched
// once per id and cached — a mapping doesn't change mid-session, and both
// loadCharacterMappingDefinition below and reimportViaMapping (the "url"/
// "mapping" re-import path — see that function's own comment) would
// otherwise each re-fetch the same file repeatedly. A failed fetch is NOT
// cached — a transient network blip shouldn't permanently poison every
// later attempt for the rest of the page's lifetime.
const mappingDefinitionCache = new Map();
export function loadMappingDefinition(mappingId) {
  const id = String(mappingId || "").trim();
  if (!id) return Promise.reject(new Error("No mapping id given."));
  if (!mappingDefinitionCache.has(id)) {
    const url = new URL(`../../../loom/mappings/${id}.json`, import.meta.url);
    const promise = fetch(url, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Mapping "${id}" not found (${response.status}).`);
        }
        return parseJsonResponse(response, `${id}.json mapping`);
      })
      .catch((error) => {
        mappingDefinitionCache.delete(id);
        throw error;
      });
    mappingDefinitionCache.set(id, promise);
  }
  return mappingDefinitionCache.get(id);
}

// Every saved mapping's own filename (sans extension) — mappings are served
// as a plain static directory listing (server.config.json's own
// "loom-mappings" mount), not a Library kind, so this is a bare GET rather
// than dataManager.list(...). Extracted from Loom's own local listMappings()
// (identical implementation) so Workbench's player-facing Import Character
// flow (listCharacterMappings below) can share it instead of duplicating
// this fetch.
export async function listAvailableMappings() {
  try {
    const response = await fetch("/list/loom-mappings");
    if (!response.ok) return [];
    const payload = await response.json();
    return (payload.files || []).map((entry) => entry.filename).filter(Boolean);
  } catch (error) {
    return [];
  }
}

// Every mapping a GM has tagged "Character" in Loom's own Import tab
// ($dataType — see enterMappingMode/the Save handler in loom/js/app.js) —
// what Workbench's player-facing "Import Character" picker offers, so a
// player only ever sees mappings meant to produce a standalone character,
// never the sub-entity ones (backgrounds/classes/species/...) Loom's own
// multi-entity Import tab consumes. loadMappingDefinition's own promise
// cache means a mapping fetched here to check its $dataType costs nothing
// extra when the same mapping gets loaded again moments later to actually
// run the import.
export async function listCharacterMappings() {
  const ids = await listAvailableMappings();
  const definitions = await Promise.all(
    ids.map((id) => loadMappingDefinition(id).catch(() => null))
  );
  return ids
    .map((id, index) => ({ id, definition: definitions[index] }))
    .filter((entry) => entry.definition?.$dataType === "character")
    .map((entry) => ({ id: entry.id, description: entry.definition.$description || "" }));
}

// The ddb-character.json mapping definition is the single source of truth
// for how a raw D&D Beyond character normalizes — authored and editable in
// Loom, applied here so Press (and anything else) consumes the exact same
// transformation instead of a separately maintained hand-written parser.
function loadCharacterMappingDefinition() {
  return loadMappingDefinition("ddb-character");
}

// The System's fields don't change mid-session, so — same reasoning as
// loadCharacterMappingDefinition above — fetched once and cached rather than
// re-fetched on every character/monster import. `{ preferLocal: false }`:
// a Loom edit to sys.dnd5e's fields (adding/renaming a condition, alignment,
// skill, ...) must be visible immediately, not hidden behind a stale local
// cache — same convention as combat-tracker.js's System reads.
let ddbLookupTablesPromise = null;
function loadDdbLookupTables(dataManager) {
  if (!dataManager) return Promise.resolve(deriveLookupTables(null));
  if (!ddbLookupTablesPromise) {
    ddbLookupTablesPromise = dataManager
      .get("system", DND5E_SYSTEM_ID, { preferLocal: false })
      .then((result) => deriveLookupTables(result?.payload));
  }
  return ddbLookupTablesPromise;
}

export async function loadDdbData(value, dataManager) {
  const raw = await loadDdbRawData(value);
  if (detectDdbContentType(value)) {
    return raw;
  }
  const [definition, lookupTables] = await Promise.all([loadCharacterMappingDefinition(), loadDdbLookupTables(dataManager)]);
  return applyMapping(definition, raw, { lookupTables, customFunctions: createMappingCustomFunctions(lookupTables) });
}

// The general form of loadDdbData above — re-fetches `value` and re-applies
// a mapping identified by id, rather than hardcoding ddb-character.json.
// Backs the "Re-import" affordance on a character record that was originally
// saved with top-level `url`/`mapping` fields (see loom/js/app.js's own
// saveEntity, which is what sets them): re-running the exact same
// fetch+transform this character was originally imported with, without
// having to reopen Loom at all. Which underlying fetch mechanism to use
// isn't stored separately — the mapping definition's own top-level
// `$source` (e.g. "ddb") already declares that, so a mapping and the source
// it expects can never drift apart from what's actually stored.
// Lookup-table/custom-function context is only meaningful for the "ddb"
// source today (loadDdbLookupTables' own dnd5e-specific tables, same as
// loadDdbData's own identical assumption) — a future non-DDB character
// mapping would need its own equivalent branch here.
export async function reimportViaMapping(mappingId, value, dataManager) {
  const trimmedId = String(mappingId || "").trim();
  const trimmedValue = String(value || "").trim();
  if (!trimmedId) throw new Error("No mapping recorded for this character.");
  if (!trimmedValue) throw new Error("No source URL recorded for this character.");
  const definition = await loadMappingDefinition(trimmedId);
  const sourceId = definition?.$source;
  if (!sourceId) {
    throw new Error(`Mapping "${trimmedId}" has no declared source to fetch from.`);
  }
  const raw = await loadSourceDataRaw({ id: sourceId }, trimmedValue, dataManager);
  const lookupTables = sourceId === "ddb" ? await loadDdbLookupTables(dataManager) : {};
  const customFunctions = createMappingCustomFunctions(lookupTables);
  return applyMapping(definition, raw, { lookupTables, customFunctions });
}

// A character mapping (ddb-character.json, or any future one) only ever
// produces character *content* (identity, stats, abilities, ...) — it has
// no concept of which Workbench template/system(s) a character is assigned
// to, the `data` bucket Workbench's own sheet fields write into (see
// workbench-character-view.js's persistDraft), or which source/mapping this
// character itself came from. A plain overwrite — on first import, or a
// later re-import refreshing an existing character's mapped fields — would
// silently wipe all of that. Preserves whatever the existing record already
// had for these keys; the fresh mapped content still wins for everything
// the mapping actually produces. Shared by loom/js/app.js's own saveEntity
// (which then explicitly re-sets url/mapping to whatever's currently loaded
// in Loom's own UI, since those two are the one pair a fresh import DOES
// mean to change) and Workbench's own "Re-import" handler (which doesn't —
// a refresh keeps coming from the same place, so leaving them preserved
// here is exactly right for that caller with no extra step needed).
export function mergeImportedCharacterData(freshData, priorPayload) {
  const prior = priorPayload || {};
  return {
    // Confirmed real bug this fixes: a Workbench-created (or otherwise
    // already-embedding-its-own-id) character's top-level `id` field was
    // never in this preserve list at all, and no mapping has ever produced
    // one either (a mapping only ever sees the raw external source, which
    // has no idea what filename/key this record is even saved under) — so
    // any re-import silently DROPPED it outright, not just left it stale.
    // Most Library-sourced characters never embed one in the first place
    // (id is the filename/key they're fetched by — see
    // workbench-character-view.js's own loadCharacter comment), in which
    // case `prior.id` is simply undefined here and this is a no-op, exactly
    // as before.
    id: prior.id,
    template: prior.template,
    systemIds: prior.systemIds,
    data: prior.data,
    url: prior.url,
    mapping: prior.mapping,
    ...freshData,
  };
}

export function normalizeSrdInput(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http")) return trimmed;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const path = withSlash.startsWith("/api/") ? withSlash : `/api${withSlash}`;
  return `${SRD_BASE_URL}${path}`;
}

export async function fetchSrdJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`5e API request failed (${response.status}).`);
  }
  return parseJsonResponse(response, url);
}

const LIST_FETCH_CONCURRENCY = 6;

// Runs `fn` over `items` with at most `limit` requests in flight at once, so a
// large list endpoint (e.g. ~500 spells) doesn't fire off hundreds of parallel
// fetches at once.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function loadSrdData(value) {
  const url = normalizeSrdInput(value);
  if (!url) {
    throw new Error("Enter a 5e API endpoint or slug.");
  }
  const data = await fetchSrdJson(url);
  if (Array.isArray(data?.results)) {
    // An index listing (e.g. /api/2024/classes) — recursively fetch every
    // linked item's full detail and return them as one array, so a repeat-based
    // template can print one card per entry.
    const entries = data.results.filter((entry) => entry?.url);
    if (!entries.length) {
      throw new Error("That index listing has no items to fetch.");
    }
    return mapWithConcurrency(entries, LIST_FETCH_CONCURRENCY, (entry) => fetchSrdJson(`${SRD_BASE_URL}${entry.url}`));
  }
  return data;
}

// The original, fixed set of kinds Loom's one-to-many save workflow wrote to
// undercroft/common/data/<kind>/ — kept as Press's synchronous default for
// its Library source picker (building that list can't wait on a fetch at
// page load). Loom itself no longer treats this as the authoritative kind
// list: see loadLibraryKinds() below, which reads the real, extensible
// registry (undercroft/common/data/kind/*.json — a kind is just another
// library entity, editable the same way as everything else). Named
// LIBRARY_KINDS (not DATA_KINDS) because "library" is still the user-facing
// concept — Loom's Entities pane, Press's Library source — even though the
// files themselves live under common/data/ alongside help-topics.json rather
// than a dedicated common/library/ directory. Kept in sync with every kind
// registered under undercroft/common/data/kind/*.json as of this writing —
// a creator-defined 13th kind still needs loadLibraryKinds() to actually
// resolve for its picker to appear, same as before.
export const LIBRARY_KINDS = [
  "class",
  "subclass",
  "background",
  "species",
  "variant",
  "character",
  "npc",
  "setting",
  "location",
  "monster",
];

// Every Library kind is DB-backed now (ownership, sharing, is_public — see
// server/storage.py's library_items table) via the same /content/{kind}/{id}
// and /list/{kind} routes the characters/templates/systems buckets already
// used, instead of the old wide-open, unauthenticated /library/{kind}
// routes. These two helpers stay deliberately anonymous (no session token) —
// callers needing to see their own private/shared entries too (Loom, which
// is always signed in behind its own creator-tier gate) should go through
// their own DataManager instance instead; Forge and Press's read-only
// reference-data consumption is exactly "public content only," which is
// what an unauthenticated fetch naturally returns.
export async function fetchLibraryEntry(kind, id) {
  const response = await fetch(`/content/${kind}/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${kind}/${id} (${response.status}).`);
  }
  return parseJsonResponse(response, `${kind}/${id}.json`);
}

// Generic listing for any library kind. Exported (not just used internally
// by loadLibraryData) so Loom's Library/Places editors and Forge/Press can
// populate a kind's entry picker with just ids, without fetching every
// entry's full body.
export async function listLibraryKind(kind) {
  const response = await fetch(`/list/${kind}`);
  if (!response.ok) {
    throw new Error(`Failed to list ${kind} (${response.status}).`);
  }
  const payload = await parseJsonResponse(response, `${kind} listing`);
  const entries = [...(payload.owned || []), ...(payload.shared || []), ...(payload.public || [])];
  const seen = new Set();
  const ids = [];
  entries.forEach((entry) => {
    const id = entry?.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

// List-then-fetch-each-entry-by-id — pairs a kind's ids (the generic listing
// route only returns ids/filenames, not full bodies) with each entry's full
// JSON body. Promoted here after being independently duplicated in both
// Forge's tables.js and Loom's app.js's Places panel; Crucible needed the
// exact same helper a third time, which is what surfaced the duplication.
//
// Takes `dataManager` rather than using the anonymous fetchLibraryEntry/
// listLibraryKind above: Loom's original copy of this helper deliberately
// used DataManager so a signed-in creator sees their own private/shared
// entries while building out Places, not just published ones — collapsing
// onto the anonymous-only path would have been a real regression for Loom.
// DataManager degrades gracefully for an unauthenticated caller (Forge has
// no whole-tool login gate) — list()/get() just return public-only content
// when there's no session, so this one implementation is correct for every
// caller regardless of whether they're signed in.
export async function fetchKindEntriesWithIds(dataManager, kind) {
  if (!dataManager) return [];
  const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
  const ids = dataManager
    .collectListEntries(remote, ["owned", "shared", "public", "items"])
    .map((entry) => entry.id);
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return { id, entity: (await dataManager.get(kind, id))?.payload };
      } catch (error) {
        return null;
      }
    })
  );
  return entries.filter(Boolean);
}

// `value` is "kind/id" for a single saved entry, or "kind/*" (or bare "kind")
// for every entry of that kind — mirroring loadSrdData's list-endpoint
// expansion so a "whole directory" selection produces one array, letting
// Press's existing repeat-template handling print one card per entry exactly
// like it already does for a 5e API list endpoint.
//
// `dataManager` is optional: when given (Press always has one), listing/
// fetching goes through it instead of the anonymous listLibraryKind/
// fetchLibraryEntry pair above, so a signed-in user's own private/shared
// entries are included, not just public ones — the same "an owned but
// not-yet-public record shouldn't just vanish from this exact same tool"
// reasoning that fetchKindEntriesWithIds already applies elsewhere. Falls
// back to the anonymous path when no dataManager is passed, so this stays a
// non-breaking addition for any other caller.
// `shareToken` is optional and only meaningful for the single kind/id case —
// it lets an anonymous (unauthenticated) visitor read a private record via a
// share link (e.g. a campaign group's public share page fetching whatever's
// currently spotlighted): forwarded straight through to
// dataManager.get(kind, id, { shareToken }), which turns into ?share=token
// on the request so the server's narrower share-token-scoped access checks
// (server/storage.py's get_item) can grant it.
export async function loadLibraryData(value, dataManager, shareToken = "") {
  const [kind, id] = String(value || "").split("/");
  if (!kind) {
    throw new Error("Select a library kind.");
  }
  if (!id || id === "*") {
    let ids;
    if (dataManager) {
      const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
      ids = dataManager.collectListEntries(remote, ["owned", "shared", "public", "items"]).map((entry) => entry.id);
    } else {
      ids = await listLibraryKind(kind);
    }
    if (!ids.length) {
      throw new Error(`No saved ${kind} entries to load.`);
    }
    return mapWithConcurrency(ids, LIST_FETCH_CONCURRENCY, (id_) =>
      dataManager ? dataManager.get(kind, id_).then((result) => result.payload) : fetchLibraryEntry(kind, id_)
    );
  }
  if (dataManager) {
    return (await dataManager.get(kind, id, { shareToken })).payload;
  }
  return fetchLibraryEntry(kind, id);
}

// The live, extensible kind registry — every undercroft/common/data/kind/*
// entity, each {id, label, plural, icon}. Falls back to synthesizing entries
// from LIBRARY_KINDS if the registry can't be read (e.g. before it's been
// seeded), so Loom's Entities/Systems UI always has something to show.
export async function loadLibraryKinds() {
  try {
    const kinds = await loadLibraryData("kind/*");
    if (Array.isArray(kinds) && kinds.length) {
      return kinds;
    }
  } catch (error) {
    // fall through to the static fallback below
  }
  return LIBRARY_KINDS.map((id) => ({ id, label: id, plural: id }));
}

export async function loadSourceData(source, value, dataManager) {
  if (!source) {
    throw new Error("No source selected.");
  }
  switch (source.id) {
    case "ddb":
      return loadDdbData(value, dataManager);
    case "srd":
      return loadSrdData(value);
    case "library":
      return loadLibraryData(value, dataManager);
    case "json": {
      if (!value) {
        throw new Error("Select a JSON file to load.");
      }
      const raw = await readJsonFile(value);
      return raw;
    }
    case "manual": {
      const trimmed = (value || "").trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        throw new Error("Manual entry isn't valid JSON.");
      }
    }
    default:
      throw new Error("Unsupported source.");
  }
}

// Loom's variant of loadSourceData: identical except a "ddb" source resolves
// through loadDdbRawData instead of loadDdbData, so a character fetch stays
// raw for Loom's own mapping to transform, instead of arriving pre-parsed.
export async function loadSourceDataRaw(source, value, dataManager) {
  if (!source) {
    throw new Error("No source selected.");
  }
  if (source.id === "ddb") {
    return loadDdbRawData(value);
  }
  return loadSourceData(source, value, dataManager);
}
