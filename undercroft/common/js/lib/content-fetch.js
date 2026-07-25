// Shared source-fetch plumbing: D&D Beyond (character API + scraped content
// pages) and the 5e API, plus plain JSON upload/paste. Originally lived only in
// press/js/source-data.js; extracted here so Loom's fetch workflow and Press's
// source picker can both use it without duplicating the fetch/parse logic.
// press/js/source-data.js now re-exports from this module unchanged.

import { applyMapping } from "./mapping-engine.js";
import { LOOKUP_TABLES } from "./lookup-tables.js";
import { customFunctions } from "./mapping-custom-functions.js";

const SRD_BASE_URL = "https://www.dnd5eapi.co";
const DDB_CHARACTER_URL = "https://character-service.dndbeyond.com/character/v5/character/";
const CORS_PROXY = "https://corsproxy.io/?url=";

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

// The ddb-character.json mapping definition is the single source of truth
// for how a raw D&D Beyond character normalizes — authored and editable in
// Loom, applied here so Press (and anything else) consumes the exact same
// transformation instead of a separately maintained hand-written parser.
// Fetched once and cached: it doesn't change mid-session, and every
// character fetch would otherwise re-fetch the same definition file.
let characterMappingPromise = null;
function loadCharacterMappingDefinition() {
  if (!characterMappingPromise) {
    const url = new URL("../../../loom/mappings/ddb-character.json", import.meta.url);
    characterMappingPromise = fetch(url, { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load the character mapping definition (${response.status}).`);
      }
      return parseJsonResponse(response, "ddb-character.json mapping");
    });
  }
  return characterMappingPromise;
}

export async function loadDdbData(value) {
  const raw = await loadDdbRawData(value);
  if (detectDdbContentType(value)) {
    return raw;
  }
  const definition = await loadCharacterMappingDefinition();
  return applyMapping(definition, raw, { lookupTables: LOOKUP_TABLES, customFunctions });
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
      return loadDdbData(value);
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
