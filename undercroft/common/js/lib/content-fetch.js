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
// A completely separate D&D Beyond service from the character endpoint above
// — confirmed via a real live fetch during this feature's own research (id
// 16909, Gray Ooze) — undocumented, but already an allowed host on the
// server's own /ddb-proxy route (server/config.py's ddb_proxy_allowed_hosts),
// which is what fetchDdbMonster below actually goes through.
const DDB_MONSTER_URL = "https://monster-service.dndbeyond.com/v1/Monster/";
const CORS_PROXY = "https://corsproxy.io/?url=";
// The DDB-import pipeline is inherently D&D-5e-specific (D&D Beyond only
// has 5e content) — same specificity loadCharacterMappingDefinition below
// has for ddb-character.json.
const DND5E_SYSTEM_ID = "sys.dnd5e";

// The two mapping-driven sources Loom's Import tab (and Workbench's Import
// Character flow) offer a picker for — narrower than loadSourceData's
// dispatch below, which also handles "library"/"json"/"manual" for pickers
// with no mapping/$source concept. Shared with Loom's own SOURCES array so
// both tools use one list instead of two that could drift.
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
    // Fetch All is enabled for this source — loadSrdData already returns an
    // array when the entered value resolves to a list endpoint (e.g.
    // /api/2014/monsters) rather than a single record.
    bulk: true,
  },
  {
    id: "ddb-monster",
    label: "D&D Beyond (Monster)",
    valueLabel: "Monster ID or URL",
    placeholder: "e.g. 16909, or https://www.dndbeyond.com/monsters/16909-gray-ooze",
    helpTopic: "loom.source.ddb-monster",
  },
  {
    id: "fantasy-statblocks",
    label: "Fantasy Statblocks (Markdown)",
    valueLabel: "Markdown file",
    // No placeholder text — this source's own value is a File, not typed
    // text (see loom/index.html's own file-input branch, shown only when
    // this source is selected).
    placeholder: "",
    helpTopic: "loom.source.fantasy-statblocks",
    file: true,
    // Fetch All is enabled for this source too — a whole folder or a
    // multi-select of individual .md files, both feeding
    // loadFantasyStatblockDataBulk below.
    bulk: true,
  },
  {
    id: "markdown-wonder",
    label: "Markdown (Item/Spell)",
    valueLabel: "Markdown file",
    // Same "value is a File, not typed text" reasoning as fantasy-statblocks
    // above.
    placeholder: "",
    helpTopic: "loom.source.markdown-wonder",
    file: true,
    // A whole Obsidian vault folder of item/spell notes, same bulk pattern
    // as fantasy-statblocks — see loadMarkdownWonderDataBulk below.
    bulk: true,
  },
];

// The browser's SyntaxError for malformed JSON only gives a position/line/
// column, never which fetch it came from. Every response.json() call here
// goes through this instead, so that context (a URL, or a kind/id.json
// label) gets attached to the error every consumer ultimately shows.
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

// Twin of readJsonFile above, minus the JSON.parse — for a source whose file
// isn't JSON at all (Fantasy Statblocks' own markdown export, see
// loadFantasyStatblockData below).
export async function readTextFile(file) {
  if (!file) return "";
  if (typeof file === "string") {
    return file;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function extractDdbId(value) {
  if (!value) return null;
  const asString = String(value).trim();
  const matches = asString.match(/(\d+)/g);
  if (!matches || !matches.length) return null;
  return matches[matches.length - 1];
}

// Same local-proxy-first, public-CORS-proxy-fallback shape as
// fetchDdbContentPage below — character-service.dndbeyond.com is an allowed
// /ddb-proxy host, since corsproxy.io rejects this endpoint outright even
// for a character reachable directly. The local route also lets a
// private/gated character resolve via the same session-cookie mechanism
// monster-service/class pages use, not just a public one.
export async function fetchDdbCharacter(id) {
  const url = `${DDB_CHARACTER_URL}${id}`;
  const localResponse = await fetch(`/ddb-proxy?url=${encodeURIComponent(url)}`).catch(() => null);
  if (localResponse) {
    if (localResponse.ok) {
      const payload = await parseJsonResponse(localResponse, url);
      return payload?.data ?? payload;
    }
    if (localResponse.status !== 404) {
      throw new Error(`D&D Beyond fetch failed (${localResponse.status}).`);
    }
  }
  const proxied = `${CORS_PROXY}${encodeURIComponent(url)}`;
  const response = await fetch(proxied);
  if (!response.ok) {
    throw new Error(`D&D Beyond fetch failed (${response.status}).`);
  }
  const payload = await parseJsonResponse(response, proxied);
  return payload?.data ?? payload;
}

// Goes through fetchDdbContentPage's local-proxy-first path — monster-
// service is an allowed /ddb-proxy host, and a non-SRD monster may only
// resolve in full with the session cookie that local proxy attaches, same
// reasoning as a gated class/background/species page. Falls back to the
// public CORS proxy when the local server isn't available.
export async function fetchDdbMonster(id) {
  const text = await fetchDdbContentPage(`${DDB_MONSTER_URL}${id}`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error("D&D Beyond monster fetch returned an unexpected (non-JSON) response.");
  }
  return payload?.data ?? payload;
}

// Same "extract the trailing numeric id, whether it's a bare number or a
// full monster-page URL" resolution extractDdbId already does for
// characters — reused as-is, no monster-specific parsing needed.
export async function loadDdbMonsterRawData(value) {
  const id = extractDdbId(value);
  if (!id) {
    throw new Error("Enter a valid D&D Beyond monster ID/URL.");
  }
  return fetchDdbMonster(id);
}

// Vendored the same way dice-overlay.js vendors @3d-dice/dice-box — a
// version-pinned dynamic import() straight from unpkg, no build step.
const FANTASY_STATBLOCK_YAML_MODULE_URL = "https://unpkg.com/js-yaml@4.1.0/dist/js-yaml.mjs";

// Obsidian's Fantasy Statblocks plugin stores 100% of a creature's actual
// data inside a ```statblock fenced YAML block — the frontmatter above it
// and the `#monster` tag line are both ignored. Everything AFTER the
// closing fence (an optional Description + References section) is folded
// into one `_postFenceNotes` string rather than parsed further — heading
// presence and bullet style vary between real files, nothing else worth
// modeling separately. fantasy-statblocks-monster.json's `notes` field
// binds straight to it.
export async function loadFantasyStatblockData(text) {
  const source = String(text || "");
  const fenceMatch = source.match(/```statblock\r?\n([\s\S]*?)```/);
  if (!fenceMatch) {
    throw new Error("No ```statblock block found in this file.");
  }
  const { load } = await import(/* @vite-ignore */ FANTASY_STATBLOCK_YAML_MODULE_URL);
  let parsed;
  try {
    parsed = load(fenceMatch[1]);
  } catch (error) {
    throw new Error(`Invalid YAML in the \`\`\`statblock block: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The ```statblock block didn't parse to a usable object.");
  }
  const postFence = source.slice(fenceMatch.index + fenceMatch[0].length).trim();
  return { ...parsed, _postFenceNotes: postFence };
}

// Bulk counterpart to loadFantasyStatblockData above — `files` is a
// FileList/array of Files from either bulk file input Loom offers. Runs
// the same per-file parser, so a bulk import produces byte-identical
// per-record shape to a single manual import, just looped. `_bulkFileName`
// is stamped on each result since Fantasy Statblocks data has no
// canonical slug the way SRD does. A file that fails to parse is skipped
// with its error attached rather than aborting the whole batch.
export async function loadFantasyStatblockDataBulk(files, onProgress) {
  const list = Array.from(files || []);
  const results = [];
  for (const file of list) {
    try {
      const text = await readTextFile(file);
      const parsed = await loadFantasyStatblockData(text);
      results.push({ ...parsed, _bulkFileName: file.name });
    } catch (error) {
      results.push({ _bulkFileName: file.name, _bulkError: error.message });
    }
    onProgress?.(results.length, list.length);
  }
  return results;
}

// Strips the three markdown-noise shapes that show up inside Obsidian vault
// prose but never in the 5e API's own desc text: a piped link
// `[label](url)` collapses to its label, a bare wikilink `[[Page Name]]`
// collapses to the page name, and an inline Dice Roller span `` `dice:8d6` ``
// collapses to its bare formula. All three so downstream regexes (spell-
// menu parsing, clause recognizers) see the same plain text the SRD's own
// desc fields already give them.
function stripMarkdownNoise(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/`dice:\s*([^`]+)`/gi, "$1");
}

// A `**Label.**`/`**Label**.`/`**_Label._**` bold lead-in at the very START
// of a paragraph — this Obsidian vault's own convention for a named
// sub-ability. Normalized to the `***Label.***` triple-star shape
// vault-feature-matching.js's extractBoldLabel already recognizes (from
// the 5e API's own desc text), so a markdown-sourced lead-in is recognized
// exactly like a JSON-sourced one with zero changes to the shared
// clause-recognizer pipeline. A paragraph with no such lead-in is
// returned unchanged.
function normalizeBoldLeadIn(paragraph) {
  const match = paragraph.match(/^[*_]{2,4}\s*([^*_]+?)\s*[*_]{2,4}\.?\s*/);
  if (!match) return paragraph;
  const label = match[1].replace(/\.$/, "").trim();
  if (!label) return paragraph;
  const rest = paragraph.slice(match[0].length);
  return `***${label}.*** ${rest}`.trim();
}

// The general markdown structural scanner behind the "markdown-wonder"
// source: reads an Obsidian vault note (a magic item or spell, one per
// file) for its structural markers — a leading `#tag` line, an italic
// type/rarity-or-level line, bold "**Label:** value"/"**Label**: value"
// stat-block lines (a spell's Casting Time/Range/etc. lead the body; a
// mundane item's Damage/Weight fields use colon-outside and TRAIL the
// description instead, so these are recognized WHEREVER they appear), then
// body paragraphs, tables, and a trailing "### References" section —
// WITHOUT any 5e-specific interpretation of what those markers mean. That
// interpretation is markdownItemStats/markdownSpellStats's own job
// (mapping-custom-functions.js), the same layering loadFantasyStatblockData
// establishes. Neither file type states its own name inline, so `fileName`
// is threaded through explicitly.
export function parseMarkdownWonderSource(text, fileName) {
  const rawLines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const nextNonBlank = (from) => {
    let j = from;
    while (j < rawLines.length && rawLines[j].trim() === "") j++;
    return j;
  };

  // 1. Tag line — the first non-blank line, when it carries at least one
  // "#tag" token (every real file does: "#item", or "#srd #spell #school").
  let tags = [];
  i = nextNonBlank(i);
  if (i < rawLines.length && /(^|\s)#[\w-]+/.test(rawLines[i])) {
    tags = [...rawLines[i].matchAll(/#([\w-]+)/g)].map((m) => m[1].toLowerCase());
    i++;
  }

  // 2. Header/type line — the next non-blank line, ONLY when entirely
  // wrapped in a single pair of `*…*` or `_..._` markers (an item's
  // "*Wondrous item, very rare (requires attunement)*", a spell's
  // "*3rd-level evocation*"). A mundane/lore item with no stat block has
  // no line matching this shape, and headerLine correctly stays null.
  let headerLine = null;
  i = nextNonBlank(i);
  if (i < rawLines.length) {
    const trimmed = rawLines[i].trim();
    const wrapped = trimmed.match(/^(\*|_)([^*_]+)\1$/);
    if (wrapped) {
      headerLine = stripMarkdownNoise(wrapped[2]).trim();
      i++;
    }
  }

  // 3. Body: paragraphs (bullet lines kept intact, one candidate unit each
  // — see srdSplitBullets, mapping-custom-functions.js), bold stat-block
  // fields, tables, headings, and the trailing References section.
  const paragraphs = [];
  const fields = {};
  const tables = [];
  const references = [];
  let higherLevel = "";
  let notesLine = "";
  let buffer = [];
  let inReferences = false;

  const flushParagraph = () => {
    if (!buffer.length) return;
    const para = stripMarkdownNoise(buffer.join("\n")).trim();
    buffer = [];
    if (!para) return;
    if (/^\*{3}At Higher Levels\*{3}\.?/i.test(para)) {
      higherLevel = para.replace(/^\*{3}At Higher Levels\*{3}\.?\s*/i, "").trim();
      return;
    }
    const notesMatch = para.match(/^_?Notes:\s*(.+?)_?$/i);
    if (notesMatch) {
      notesLine = notesMatch[1].trim();
      return;
    }
    paragraphs.push(normalizeBoldLeadIn(para));
  };

  for (; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{2,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      const headingText = stripMarkdownNoise(headingMatch[2]).trim();
      if (/^references$/i.test(headingText)) {
        inReferences = true;
        continue;
      }
      inReferences = false;
      // Any OTHER heading (a variant sub-item, or an aside) is folded back
      // into the paragraph stream as its own short paragraph rather than
      // dropped — real mechanical text sometimes follows it, and the
      // heading text itself is at worst an inert extra candidate unit.
      paragraphs.push(headingText);
      continue;
    }

    if (inReferences) {
      if (trimmed) references.push(trimmed.replace(/^\*\s*/, ""));
      continue;
    }

    // A bold stat-block field line, either convention (see this function's
    // module comment). Checked on every line, not just a leading block —
    // some items' fields trail the description instead. Neither shape can
    // match a bold ABILITY lead-in (normalizeBoldLeadIn): that shape's
    // closing `**` is followed by a period or nothing, never a bare `:`.
    const fieldMatch = trimmed.match(/^\*\*([^*:]+):\*\*\s*(.+)$/) || trimmed.match(/^\*\*([^*:]+)\*\*:\s*(.+)$/);
    if (fieldMatch) {
      flushParagraph();
      fields[fieldMatch[1].trim()] = stripMarkdownNoise(fieldMatch[2]).trim();
      continue;
    }

    if (trimmed.startsWith("|")) {
      flushParagraph();
      const tableLines = [trimmed];
      while (i + 1 < rawLines.length && rawLines[i + 1].trim().startsWith("|")) {
        i++;
        tableLines.push(rawLines[i].trim());
      }
      // Obsidian's own block-reference line ("^some-id") immediately after
      // a table — not part of the table itself, consumed and discarded.
      if (i + 1 < rawLines.length && /^\^[\w-]+$/.test(rawLines[i + 1].trim())) {
        i++;
      }
      tables.push(tableLines.join("\n"));
      continue;
    }

    // An Obsidian dice-roller embed or a standalone image embed — neither
    // is prose, both dropped rather than becoming a nonsense candidate unit.
    if (/^`dice:/i.test(trimmed) || /^!\[.*\]\(.*\)$/.test(trimmed)) {
      continue;
    }

    buffer.push(line);
  }
  flushParagraph();

  const name = String(fileName || "").replace(/\.md$/i, "");
  return { name, tags, headerLine, fields, paragraphs, tables, higherLevel, notesLine, references };
}

// Bulk counterpart to parseMarkdownWonderSource above — same "one bad file
// doesn't kill the batch" contract as loadFantasyStatblockDataBulk (this
// parser essentially never throws, but a future stricter version might).
export async function loadMarkdownWonderDataBulk(files, onProgress) {
  const list = Array.from(files || []);
  const results = [];
  for (const file of list) {
    try {
      const text = await readTextFile(file);
      results.push(parseMarkdownWonderSource(text, file.name));
    } catch (error) {
      results.push({ _bulkFileName: file.name, _bulkError: error.message });
    }
    onProgress?.(results.length, list.length);
  }
  return results;
}

// D&D Beyond content pages (classes/backgrounds/species) have no API — unlike
// the character endpoint, this fetches and parses the actual rendered HTML
// page. Parsing lives in a separate classic script
// (common/ddb-content-parser.js) so the page-structure-dependent part can
// be swapped out independently if DDB's markup changes.
export const DDB_CONTENT_TYPES = [
  { type: "class", pattern: /\/classes\/[\w-]+/ },
  { type: "background", pattern: /\/backgrounds\/[\w-]+/ },
  { type: "species", pattern: /\/species\/[\w-]+/ },
  { type: "equipment", pattern: /\/equipment\/[\w-]+/ },
  { type: "magic-item", pattern: /\/magic-items\/[\w-]+/ },
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
  // Prefer the shared server's local proxy: it can attach a session cookie
  // read from a local, gitignored file so gated content (e.g. non-free
  // subclasses) resolves fully, never routing that cookie through a third
  // party. Falls back to the public CORS proxy when the local route isn't
  // available — e.g. Press hosted without the Python backend.
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
  equipment: "ddbParseEquipmentPage",
  "magic-item": "ddbParseMagicItemPage",
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
    throw new Error("Enter a valid D&D Beyond character ID/URL, or a classes/backgrounds/species/equipment/magic-items page URL.");
  }
  return fetchDdbCharacter(id);
}

// Any named mapping definition, fetched once per id and cached — a mapping
// doesn't change mid-session, and both loadCharacterMappingDefinition below
// and reimportViaMapping would otherwise each re-fetch the same file
// repeatedly. A failed fetch is NOT cached — a transient network blip
// shouldn't permanently poison every later attempt.
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

// Every saved mapping's filename (sans extension) — mappings are served as
// a plain static directory listing, not a Library kind, so this is a bare
// GET rather than dataManager.list(...). Shared with Loom's own
// listMappings() so Workbench's Import Character flow
// (listCharacterMappings below) doesn't duplicate this fetch.
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

// Every mapping a GM has tagged "Character" in Loom's Import tab
// ($dataType) — what Workbench's "Import Character" picker offers, so a
// player only sees mappings meant to produce a standalone character, never
// the sub-entity ones Loom's multi-entity Import tab consumes.
// loadMappingDefinition's promise cache means a mapping fetched here to
// check its $dataType costs nothing extra when loaded again to run the
// import.
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
// Loom, applied here so Press (and anything else) consumes the same
// transformation instead of a separately maintained parser.
function loadCharacterMappingDefinition() {
  return loadMappingDefinition("ddb-character");
}

// The System's fields don't change mid-session, so — same reasoning as
// loadCharacterMappingDefinition above — fetched once and cached rather
// than re-fetched on every import. `{ preferLocal: false }`: a Loom edit
// to sys.dnd5e's fields must be visible immediately, not hidden behind a
// stale local cache.
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
// Backs the "Re-import" affordance on a character record originally saved
// with top-level `url`/`mapping` fields: re-running the exact same
// fetch+transform without reopening Loom. Which fetch mechanism to use
// isn't stored separately — the mapping's own top-level `$source` (e.g.
// "ddb") already declares that.
// Lookup-table/custom-function context is only meaningful for D&D-5e-backed
// sources today — "ddb" and "ddb-monster" both resolve against the same
// sys.dnd5e lookup tables; a future non-DDB mapping needs its own
// equivalent branch here.
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
  const lookupTables = sourceId === "ddb" || sourceId === "ddb-monster" ? await loadDdbLookupTables(dataManager) : {};
  const customFunctions = createMappingCustomFunctions(lookupTables);
  return applyMapping(definition, raw, { lookupTables, customFunctions });
}

// A character mapping only ever produces character *content* (identity,
// stats, abilities, ...) — it has no concept of which Workbench
// template/system(s) a character is assigned to, the `data` bucket
// Workbench's own sheet fields write into, or which source/mapping this
// character came from. A plain overwrite would silently wipe all of that.
// Preserves whatever the existing record already had for these keys; the
// fresh mapped content still wins for everything the mapping actually
// produces. Shared by loom/js/app.js's saveEntity (which then explicitly
// re-sets url/mapping to whatever's loaded in Loom's UI) and Workbench's
// "Re-import" handler (which doesn't — a refresh keeps coming from the
// same place).
export function mergeImportedCharacterData(freshData, priorPayload) {
  const prior = priorPayload || {};
  return {
    // No `id` in this preserve list — a record's id is filename/
    // library_items metadata, never body content (persistDraft strips
    // `.id` off the save payload unconditionally before writing).
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
// `onProgress(completed, total)`, when given, fires after each item
// resolves — a ~330-entry list (e.g. every SRD monster) takes long enough
// that Loom's own Fetch All flow needs live feedback, not just a spinner
// with no numbers.
export async function mapWithConcurrency(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
      completed += 1;
      onProgress?.(completed, items.length);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function loadSrdData(value, onProgress) {
  const url = normalizeSrdInput(value);
  if (!url) {
    throw new Error("Enter a 5e API endpoint or slug.");
  }
  const data = await fetchSrdJson(url);
  if (Array.isArray(data?.results)) {
    // An index listing (e.g. /api/2024/classes) — recursively fetch every
    // linked item's full detail and return them as one array, so a
    // repeat-based template can print one card per entry.
    const entries = data.results.filter((entry) => entry?.url);
    if (!entries.length) {
      throw new Error("That index listing has no items to fetch.");
    }
    // Per-item failures are caught and tagged (`_bulkError`) rather than
    // thrown — a 429 partway through a large list used to reject
    // mapWithConcurrency's whole Promise.all, silently discarding every
    // already-fetched item. Once ANY item hits a 429, `rateLimited` stops
    // dispatching new requests entirely (the API's cooldown applies to the
    // whole client) — every not-yet-started entry is tagged instead of
    // re-fetched.
    let rateLimited = false;
    const results = await mapWithConcurrency(
      entries,
      LIST_FETCH_CONCURRENCY,
      async (entry) => {
        if (rateLimited) return { name: entry.name, _bulkFileName: entry.name, _bulkError: "Skipped — rate limited by the 5e API." };
        try {
          return await fetchSrdJson(`${SRD_BASE_URL}${entry.url}`);
        } catch (error) {
          if (/\(429\)/.test(error.message)) rateLimited = true;
          return { name: entry.name, _bulkFileName: entry.name, _bulkError: error.message };
        }
      },
      onProgress
    );
    if (rateLimited) {
      // A dedicated marker (not just scanning `results` for `_bulkError`)
      // so the caller can tell "rate limited" apart from "a few unrelated
      // items failed to parse" and word its own summary accordingly.
      results.rateLimited = true;
    }
    return results;
  }
  return data;
}

// The original, fixed set of kinds — kept as Press's synchronous default
// for its Library source picker (can't wait on a fetch at page load). Loom
// itself no longer treats this as authoritative: see loadLibraryKinds()
// below, which reads the real, extensible registry
// (common/data/kind/*.json). A creator-defined kind beyond this list still
// needs loadLibraryKinds() to resolve for its picker to appear.
export const LIBRARY_KINDS = [
  "class",
  "background",
  "species",
  "variant",
  "character",
  "npc",
  "setting",
  "location",
  "monster",
];

// Every Library kind is DB-backed (ownership, sharing, is_public) via the
// same /content/{kind}/{id} and /list/{kind} routes the other buckets use.
// These two helpers stay deliberately anonymous (no session token) —
// callers needing their own private/shared entries too (Loom) should go
// through their own DataManager instance; Forge and Press's read-only
// consumption is exactly "public content only," what an unauthenticated
// fetch naturally returns.
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
// JSON body. Shared after being independently duplicated in Forge, Loom,
// and Crucible.
//
// Takes `dataManager` rather than the anonymous fetchLibraryEntry/
// listLibraryKind above so a signed-in creator sees their own
// private/shared entries, not just published ones. DataManager degrades
// gracefully for an unauthenticated caller (Forge has no login gate) —
// list()/get() just return public-only content when there's no session.
// One HTTP request per entry (the /list endpoint only returns metadata) —
// fine at moderate scale, but a large kind firing that many requests
// through Promise.all AT ONCE, fully unthrottled, silently dropped entries
// whose individual fetch failed under load with NO logging — the real
// cause of a Feature matcher silently creating duplicate one-offs instead
// of matching existing ones. Fixed two ways: batched instead of fully
// concurrent, and every failure is now logged instead of silently
// discarded.
const FETCH_KIND_ENTRIES_BATCH_SIZE = 12;

// `{ id, entity }[]` — the exact shape every existing caller expects
// (Vault/Crucible/Sanctum's tables.js), regardless of which path fetched
// the body. Kept as its own helper so both the bulk and fallback paths
// below produce identical output.
function toKindEntry(kind, id, body) {
  if (!body) return null;
  return { id, entity: body };
}

// Cross-visit cache for the bulk fetch below — a tool re-opened, or a
// System re-selected, in the SAME tab within one session no longer repeats
// the request. Keyed by kind + systemId, caching the in-flight PROMISE (not
// just the resolved value) so two callers racing for the same kind within
// one tick (Vault's Feature and Wonder pickers both load on the same page)
// share one request. Invalidated on DataManager's own save/delete events —
// whole-kind, not just the touched id, since a save can change which
// entries match a systemId filter.
const bulkFetchCache = new Map();

function bulkCacheKey(kind, systemId) {
  return `${kind}::${systemId || ""}`;
}

function invalidateBulkCacheForKind(kind) {
  if (!kind) return;
  const prefix = `${kind}::`;
  Array.from(bulkFetchCache.keys())
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => bulkFetchCache.delete(key));
}

if (typeof window !== "undefined") {
  window.addEventListener("workbench:content-saved", (event) => invalidateBulkCacheForKind(event.detail?.bucket));
  window.addEventListener("workbench:content-deleted", (event) => invalidateBulkCacheForKind(event.detail?.bucket));
}

// Shared by fetchKindEntriesWithIds/fetchKindEntriesForSystem below — runs
// `fetchFn` at most once per kind+systemId combination until the cache is
// invalidated. A rejected fetch is NOT cached (deleted immediately so the
// next call retries against the server rather than replaying a failure for
// the rest of the session).
function cachedBulkFetch(kind, systemId, fetchFn) {
  const key = bulkCacheKey(kind, systemId);
  const cached = bulkFetchCache.get(key);
  if (cached) return cached;
  const promise = fetchFn().catch((error) => {
    bulkFetchCache.delete(key);
    throw error;
  });
  bulkFetchCache.set(key, promise);
  return promise;
}

// One request instead of N (DataManager's getBulk) — this used to fetch a
// kind's id list, then fire one full HTTP GET per entry (batched 12 at a
// time; see the fallback path below, kept only for when the bulk endpoint
// errors). At Vault's real scale that was ~120 sequential request batches
// just to open the tool; this is one. This function's own contract (fetch
// EVERY accessible entry) is unchanged, so every caller keeps working with
// zero call-site changes.
export async function fetchKindEntriesWithIds(dataManager, kind) {
  if (!dataManager) return [];
  return cachedBulkFetch(kind, "", () => fetchKindEntriesWithIdsUncached(dataManager, kind));
}

async function fetchKindEntriesWithIdsUncached(dataManager, kind) {
  try {
    const { items } = await dataManager.getBulk(kind);
    // Each item is `{id, body}` — the id is the LIST ROW's authoritative
    // one, not assumed to be embedded in the body itself. Plenty of kinds
    // never duplicate their own id inside the JSON (it's the
    // filename/library_items row instead). An earlier version that read
    // `body?.id` directly broke on any record without a self-embedded id
    // (`{id: undefined, ...}`), crashing consumers that read `.id`.
    return items.map((item) => toKindEntry(kind, item?.id, item?.body)).filter(Boolean);
  } catch (error) {
    console.warn(`fetchKindEntriesWithIds: bulk fetch failed for ${kind}, falling back to per-item fetch`, error);
  }
  const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
  const ids = dataManager
    .collectListEntries(remote, ["owned", "shared", "public", "items"])
    .map((entry) => entry.id);
  const entries = [];
  for (let start = 0; start < ids.length; start += FETCH_KIND_ENTRIES_BATCH_SIZE) {
    const batch = ids.slice(start, start + FETCH_KIND_ENTRIES_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          // preferLocal: false — the id list above is already forced fresh,
          // but each entry's own body fetch defaults to preferring a local
          // cache; without this override that default silently served a
          // stale per-entry snapshot even though the list itself was
          // current (an NPC's locationId, corrected server-side, kept
          // resolving to its old value).
          return toKindEntry(kind, id, (await dataManager.get(kind, id, { preferLocal: false }))?.payload);
        } catch (error) {
          console.warn(`fetchKindEntriesWithIds: failed to fetch ${kind}/${id}`, error);
          return null;
        }
      })
    );
    entries.push(...results);
  }
  return entries.filter(Boolean);
}

// Same output shape as fetchKindEntriesWithIds, but asks the server to
// filter by systemIds BEFORE reading any file instead of fetching a kind's
// entire cross-tool library and filtering client-side — keeps Vault/
// Crucible/Sanctum's tables.js fast as more Systems get built, since the
// fetched set shrinks instead of growing with total library size. Falls
// back to the unfiltered fetch if the bulk endpoint errors.
export async function fetchKindEntriesForSystem(dataManager, kind, systemId) {
  if (!dataManager) return [];
  if (!systemId) return fetchKindEntriesWithIds(dataManager, kind);
  return cachedBulkFetch(kind, systemId, () => fetchKindEntriesForSystemUncached(dataManager, kind, systemId));
}

async function fetchKindEntriesForSystemUncached(dataManager, kind, systemId) {
  try {
    const { items } = await dataManager.getBulk(kind, { systemIds: [systemId] });
    // {id, body} per item — see fetchKindEntriesWithIdsUncached's comment
    // on why the id has to come from the item wrapper, not body?.id.
    return items.map((item) => toKindEntry(kind, item?.id, item?.body)).filter(Boolean);
  } catch (error) {
    console.warn(`fetchKindEntriesForSystem: bulk fetch failed for ${kind}, falling back to unfiltered fetch`, error);
    return fetchKindEntriesWithIds(dataManager, kind);
  }
}

// {id, name}, straight off the /list response — ZERO per-record fetches,
// unlike fetchKindEntriesWithIds above. The list endpoint's rows already
// carry the record's title alongside id/ownership, no separate per-id GET
// needed. Only good for callers that need a name-sorted list or a
// name->id lookup and NOTHING else (findKindReferenceRecord below is the
// motivating case) — anything that needs the record's tags/fields to
// FILTER still has to fall back to fetchKindEntriesWithIds. A kind with
// hundreds of saved entries made every name lookup against it (a
// kind-reference chip's hover preview, click-to-navigate) cost that many
// individual HTTP round trips just to check one name.
// `properties` (populated for a kind whose kind.json declares it in
// metadataFields — today just "wonder") rides along for free —
// findKindReferenceRecord's optional `filter` uses it to tell a
// same-named spell and piece of equipment apart.
export async function fetchKindEntrySummaries(dataManager, kind) {
  if (!dataManager) return [];
  const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
  return dataManager
    .collectListEntries(remote, ["owned", "shared", "public", "items"])
    .map((entry) => ({ id: entry.id, name: entry.title || entry.id, properties: entry.properties }));
}

// Every Location belonging to `settingId` — shared by Sanctum's Location
// editor and Forge's Location picker, which used to each carry an
// identical, independently-maintained copy. `settingIds` is a plural array;
// unlike a Resource's optional scoping, a Location with an EMPTY
// settingIds genuinely belongs to no Setting yet, so this checks
// `includes` only, not an empty-array-matches-everything shortcut. Falls
// back to a pre-migration scalar `settingId` for any not-yet-resaved
// record.
export async function listLocationsForSetting(dataManager, settingId) {
  if (!settingId) return [];
  const entries = await fetchKindEntriesWithIds(dataManager, "location");
  return entries
    .filter((entry) => {
      const ids = Array.isArray(entry.entity.settingIds)
        ? entry.entity.settingIds
        : entry.entity.settingId
          ? [entry.entity.settingId]
          : [];
      return ids.includes(settingId);
    })
    .map((entry) => ({
      id: entry.id,
      name: entry.entity.name || entry.id,
      // parentId/connectedTo — read by Sanctum's own
      // migrateLegacyLocationRelationships, a one-time pass converting any
      // still-legacy scalar values into real `relationship` records; free
      // to include regardless, the full record's already in memory from
      // fetchKindEntriesWithIds above. Forge's own consumer of this same
      // shared helper only reads id/name, so it's unaffected by the wider
      // shape.
      parentId: entry.entity.parentId || null,
      connectedTo: Array.isArray(entry.entity.connectedTo) ? entry.entity.connectedTo : [],
    }));
}

// `value` is "kind/id" for a single saved entry, or "kind/*" (or bare
// "kind") for every entry of that kind — mirroring loadSrdData's
// list-endpoint expansion so a "whole directory" selection produces one
// array, letting Press's repeat-template handling print one card per entry.
//
// `dataManager` is optional: when given, listing/fetching goes through it
// instead of the anonymous listLibraryKind/fetchLibraryEntry pair above,
// so a signed-in user's own private/shared entries are included, not just
// public ones. Falls back to the anonymous path when no dataManager is
// passed.
// `shareToken` is optional and only meaningful for the single kind/id case
// — it lets an unauthenticated visitor read a private record via a share
// link, forwarded to dataManager.get(kind, id, { shareToken }) so the
// server's narrower share-token-scoped access checks can grant it.
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
    case "ddb-monster":
      // No parsed/raw distinction the way "ddb" has (loadDdbData vs
      // loadDdbRawData) — there's no hardcoded "always run this one mapping"
      // convenience for monsters the way loadCharacterMappingDefinition is
      // for characters, so both loadSourceData and loadSourceDataRaw always
      // want the same raw payload here; loadSourceDataRaw's own fallthrough
      // to this function already gets that for free.
      return loadDdbMonsterRawData(value);
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
    case "fantasy-statblocks": {
      if (!value) {
        throw new Error("Select a Fantasy Statblocks markdown file to load.");
      }
      const text = await readTextFile(value);
      return loadFantasyStatblockData(text);
    }
    case "markdown-wonder": {
      if (!value) {
        throw new Error("Select a markdown item/spell file to load.");
      }
      const text = await readTextFile(value);
      return parseMarkdownWonderSource(text, value.name);
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
