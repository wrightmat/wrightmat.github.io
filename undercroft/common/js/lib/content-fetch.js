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
  const payload = await response.json();
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
      return response.json();
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
  return response.json();
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

// The set of kinds Loom's one-to-many save workflow writes to
// undercroft/common/library/<kind>/ — the single source of truth both Loom's
// entity picker and Press's Library source select from, so they can't drift.
export const LIBRARY_KINDS = ["class", "subclass", "background", "species", "variant", "character"];

// Library files are served as plain static files (like Loom's own mapping
// definitions), not through the /list/library-* mount name — that mount only
// powers directory-listing discovery, matching the press-templates/
// loom-mappings pattern already established.
async function fetchLibraryEntry(kind, id) {
  const url = new URL(`../../library/${kind}/${id}.json`, import.meta.url);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${kind}/${id} (${response.status}).`);
  }
  return response.json();
}

// `value` is "kind/id" for a single saved entry, or "kind/*" (or bare "kind")
// for every entry of that kind — mirroring loadSrdData's list-endpoint
// expansion so a "whole directory" selection produces one array, letting
// Press's existing repeat-template handling print one card per entry exactly
// like it already does for a 5e API list endpoint.
export async function loadLibraryData(value) {
  const [kind, id] = String(value || "").split("/");
  if (!kind) {
    throw new Error("Select a library kind.");
  }
  if (!id || id === "*") {
    const response = await fetch(`/list/library-${kind}`);
    if (!response.ok) {
      throw new Error(`Failed to list library-${kind} (${response.status}).`);
    }
    const payload = await response.json();
    const names = (payload.files || []).map((entry) => entry.filename).filter(Boolean);
    if (!names.length) {
      throw new Error(`No saved ${kind} entries to load.`);
    }
    return mapWithConcurrency(names, LIST_FETCH_CONCURRENCY, (name) => fetchLibraryEntry(kind, name));
  }
  return fetchLibraryEntry(kind, id);
}

export async function loadSourceData(source, value) {
  if (!source) {
    throw new Error("No source selected.");
  }
  switch (source.id) {
    case "ddb":
      return loadDdbData(value);
    case "srd":
      return loadSrdData(value);
    case "library":
      return loadLibraryData(value);
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
export async function loadSourceDataRaw(source, value) {
  if (!source) {
    throw new Error("No source selected.");
  }
  if (source.id === "ddb") {
    return loadDdbRawData(value);
  }
  return loadSourceData(source, value);
}
