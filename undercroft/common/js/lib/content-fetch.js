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
    id: "markdown-effect",
    label: "Markdown (Item/Spell)",
    valueLabel: "Markdown file",
    // Same "value is a File, not typed text" reasoning as fantasy-statblocks
    // above.
    placeholder: "",
    helpTopic: "loom.source.markdown-effect",
    file: true,
    // A whole Obsidian vault folder of item/spell notes, same bulk pattern
    // as fantasy-statblocks — see loadMarkdownEffectDataBulk below.
    bulk: true,
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

export async function fetchDdbCharacter(id) {
  const url = `${CORS_PROXY}${encodeURIComponent(`${DDB_CHARACTER_URL}${id}`)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`D&D Beyond fetch failed (${response.status}).`);
  }
  const payload = await parseJsonResponse(response, url);
  return payload?.data ?? payload;
}

// Unlike fetchDdbCharacter above (public CORS proxy only), this goes through
// fetchDdbContentPage's own local-proxy-first path — monster-service is
// already an allowed host on server/app.py's /ddb-proxy route, and a non-SRD
// monster (per this suite's own loom.source.ddb-monster help topic) may only
// resolve in full with the session cookie that local proxy attaches, same
// reasoning as a gated class/background/species page. Falls back to the
// public CORS proxy exactly like every other content-page fetch when the
// local server isn't available.
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

// Vendored the same way dice-overlay.js already vendors @3d-dice/dice-box —
// a version-pinned dynamic import() straight from unpkg, no build step. No
// YAML parser existed anywhere in this codebase before Fantasy Statblocks
// import needed one. Confirmed js-yaml@4.1.0's own package.json "exports"
// field maps "import" to this exact dist/js-yaml.mjs, a real ESM build.
const FANTASY_STATBLOCK_YAML_MODULE_URL = "https://unpkg.com/js-yaml@4.1.0/dist/js-yaml.mjs";

// Obsidian's Fantasy Statblocks plugin stores 100% of a creature's actual
// data inside a ```statblock fenced YAML block — the YAML frontmatter above
// it (`statblock: inline`) is just a plugin marker, and the `#monster` tag
// line is irrelevant; both are ignored. Everything AFTER the closing fence
// (an optional "### Description" heading + prose, then a "### References"
// heading + source citations — confirmed against undercroft/test/*.md, the
// 3 real reference files this format was reverse-engineered from) is folded
// into one `_postFenceNotes` string on the returned object rather than
// parsed further — heading presence and bullet style both vary between real
// files, with nothing else worth modeling separately.
// fantasy-statblocks-monster.json's own `notes` field binds straight to it.
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
// FileList/array of Files from either bulk file input Loom offers (plain
// multi-select, or a whole folder via `webkitdirectory`; this function
// doesn't care which one produced the list). Runs the exact same per-file
// parser, so a bulk import produces byte-identical per-record shape to a
// single manual import — just looped. `_bulkFileName` is stamped onto each
// result (not something loadFantasyStatblockData itself produces) since
// Fantasy Statblocks data has no `index`-style canonical slug the way SRD
// does — the bulk-import checklist and auto-id derivation both need
// *some* per-item label, and the source filename is the only one
// available. A single file that fails to parse (e.g. a non-statblock .md
// swept up in a folder select) is skipped with its error attached rather
// than aborting the whole batch — same "one bad record doesn't kill the
// import" reasoning the bulk-save loop itself uses.
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
// prose but never inside the 5e API's own desc text: a piped link
// `[label](url)` (Staff of the Gatekeeper's own spell-menu links) collapses
// to its own label, a bare wikilink `[[Page Name]]` collapses to the page
// name, and an inline Dice Roller span `` `dice:8d6` ``/`` `dice:1d4 + 1` ``
// (confirmed live: 6 of the _srd/spells files use this instead of writing
// their own damage dice as plain text — Fireball's own "takes `dice:8d6`
// fire damage" was silently unmatched by every damage-clause regex before
// this) collapses to its own bare formula. All three so downstream regexes
// (spell-menu parsing, clause recognizers, parseMarkdownSpellMechanic) see
// the same plain "cure wounds"/"Nymm, the Crown"/"8d6" text the SRD's own
// desc fields already give them, not markup they were never written to
// expect.
function stripMarkdownNoise(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/`dice:\s*([^`]+)`/gi, "$1");
}

// A `**Label.**`/`**Label**.`/`**_Label._**` bold lead-in at the very START
// of a paragraph — this Obsidian vault's own real convention for a named
// sub-ability (Staff of the Gatekeeper's own "**Druidic Ritual**. After
// successfully...", Orb of Dragonkind's own "**Spells.** The orb has 7
// charges...", Dragon Mask's own "**_Damage Absorption._** You have
// resistance..." — all 3 real shapes confirmed live) — normalized to the
// `***Label.***` triple-star shape vault-feature-matching.js's own
// extractBoldLabel already recognizes (that shape comes from the 5e API's
// own desc text instead, e.g. "***Curse.*** This armor is cursed..."), so a
// markdown-sourced candidate unit's own named lead-in is recognized exactly
// like a JSON-sourced one, with zero changes needed to the shared clause-
// recognizer pipeline. A paragraph with no such lead-in is returned
// unchanged.
function normalizeBoldLeadIn(paragraph) {
  const match = paragraph.match(/^[*_]{2,4}\s*([^*_]+?)\s*[*_]{2,4}\.?\s*/);
  if (!match) return paragraph;
  const label = match[1].replace(/\.$/, "").trim();
  if (!label) return paragraph;
  const rest = paragraph.slice(match[0].length);
  return `***${label}.*** ${rest}`.trim();
}

// The general markdown structural scanner behind the "markdown-effect"
// source: reads an Obsidian vault note (a magic item or spell, one per
// file — confirmed live against ~70 real files under dnd-eberron/other and
// dnd-eberron/_srd/spells) for its own structural markers — a leading
// `#tag` line, an italic type/rarity-or-level line, bold "**Label:**
// value"/"**Label**: value" stat-block lines (both real: a spell's own
// Casting Time/Range/Components/Duration always use the colon-inside form
// and always lead the body; a mundane-equipment item's own Damage/Damage
// Type/Properties/Range/Weight fields use colon-OUTSIDE instead, and — a
// real, confirmed difference — TRAIL the description rather than leading
// it, so these are recognized WHEREVER they appear in the body, not just
// in a fixed leading block), then body paragraphs, tables, and a trailing
// "### References" section — WITHOUT any 5e-specific interpretation of what
// those markers mean. That interpretation (item rarity/attunement/charges,
// spell level/school) is markdownItemStats/markdownSpellStats's own job
// (mapping-custom-functions.js), the same layering loadFantasyStatblockData
// above already establishes (raw structural parse here, meaning built on
// top of it there). Neither of these real files ever states its own
// name inline — the filename is the only name available, so `fileName` is
// threaded through explicitly (mirroring loadFantasyStatblockDataBulk's own
// `_bulkFileName` stamp, but available even for a single-file import here).
export function parseMarkdownEffectSource(text, fileName) {
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

  // 2. Header/type line — the next non-blank line, ONLY when it's entirely
  // wrapped in a single pair of `*…*` or `_..._` markers (an item's own
  // "*Wondrous item, very rare (requires attunement)*", a spell's own
  // "*3rd-level evocation*"). A genuinely mundane/lore item (Cloak of Many
  // Fashions, Speaking Stone — confirmed real, no stat block at all) simply
  // has no line matching this shape, and headerLine correctly stays null
  // rather than misreading its first prose paragraph as one.
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
      // Any OTHER heading (a variant sub-item like Dragon Mask's own
      // "### Black Dragon Mask", or an aside like Orb of Dragonkind's own
      // "#### Destroying an Orb") is folded back into the paragraph stream
      // as its own short paragraph rather than dropped — real mechanical
      // text sometimes follows it, and the heading text itself is at worst
      // an inert extra candidate unit (never classified as a Feature, no
      // clause recognizer matches a bare name).
      paragraphs.push(headingText);
      continue;
    }

    if (inReferences) {
      if (trimmed) references.push(trimmed.replace(/^\*\s*/, ""));
      continue;
    }

    // A bold stat-block field line, either convention (see this function's
    // own module comment). Checked on every line, not just a fixed leading
    // block — Alchemist's Fire's own fields trail its description instead
    // of leading it. Neither shape can ever also match a bold ABILITY
    // lead-in (step 4's own normalizeBoldLeadIn territory below): that
    // shape's own closing `**` is followed by a period or nothing at all,
    // never a bare `:`.
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

    // An Obsidian dice-roller embed ("`dice: [[Page^block]]`", Trinkets of
    // the Planes' own shape) or a standalone image embed — neither is
    // prose, both dropped rather than becoming a nonsense candidate unit.
    if (/^`dice:/i.test(trimmed) || /^!\[.*\]\(.*\)$/.test(trimmed)) {
      continue;
    }

    buffer.push(line);
  }
  flushParagraph();

  const name = String(fileName || "").replace(/\.md$/i, "");
  return { name, tags, headerLine, fields, paragraphs, tables, higherLevel, notesLine, references };
}

// Bulk counterpart to parseMarkdownEffectSource above — same "one bad file
// doesn't kill the batch" contract as loadFantasyStatblockDataBulk (this
// parser essentially never throws, but a future stricter version might).
export async function loadMarkdownEffectDataBulk(files, onProgress) {
  const list = Array.from(files || []);
  const results = [];
  for (const file of list) {
    try {
      const text = await readTextFile(file);
      results.push(parseMarkdownEffectSource(text, file.name));
    } catch (error) {
      results.push({ _bulkFileName: file.name, _bulkError: error.message });
    }
    onProgress?.(results.length, list.length);
  }
  return results;
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
// Lookup-table/custom-function context is only meaningful for D&D-5e-backed
// sources today (loadDdbLookupTables' own dnd5e-specific tables, same as
// loadDdbData's own identical assumption) — "ddb" (characters) and
// "ddb-monster" both resolve against the same sys.dnd5e lookup tables
// (lookup('creatureTypes', ...), lookup('challengeRatings', ...), etc. —
// see ddb-monster.json's own mapping); a future non-DDB mapping would need
// its own equivalent branch here.
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
    // linked item's full detail and return them as one array, so a repeat-based
    // template can print one card per entry.
    const entries = data.results.filter((entry) => entry?.url);
    if (!entries.length) {
      throw new Error("That index listing has no items to fetch.");
    }
    // Per-item failures are caught and tagged (`_bulkError`, same shape
    // loadFantasyStatblockDataBulk already uses — Loom's own checklist
    // already renders these disabled-with-error-text) rather than thrown —
    // confirmed live: a plain 429 partway through a ~330-entry list used to
    // reject mapWithConcurrency's whole Promise.all, silently discarding
    // every already-fetched item with no error surfaced anywhere but the
    // browser console. Once ANY item hits a 429 specifically, `rateLimited`
    // stops dispatching new requests entirely (the API's cooldown applies
    // to the whole client, so retrying the rest immediately would just
    // rack up more 429s) — every not-yet-started entry is tagged
    // accordingly instead of actually re-fetched.
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
// One HTTP request per entry (the /list endpoint only returns metadata —
// the actual body lives in a separate per-id file, see server/storage.py's
// library_items schema) — fine at the scale this was written for, but a
// large kind (the Feature library crossed ~1,500 entries after this
// session's SRD monster import) means firing that many requests through
// Promise.all AT ONCE, fully unthrottled. Confirmed live as the real cause
// of two separate "should have matched an existing Feature but silently
// created a duplicate one-off instead" reports (Unusual Nature, Pack
// Tactics) — convertStatBlockToFeatures' own matching logic was verified
// correct by hand for both (well above its match threshold); the actual
// defect was this function's candidate pool silently missing entries
// because their individual fetch failed under the concurrent load and got
// swallowed here with NO logging at all, so the resulting duplicate gave no
// hint anything had gone wrong. Fixed two ways: batched instead of fully
// concurrent (kinder to the local dev server, matches the deliberate
// sequential-per-monster reasoning already documented in Loom's own bulk
// import loop above this file), and every failure is now logged instead of
// silently discarded, so a REAL recurring gap becomes visible in the
// console immediately instead of manifesting as a mystery duplicate.
const FETCH_KIND_ENTRIES_BATCH_SIZE = 12;
export async function fetchKindEntriesWithIds(dataManager, kind) {
  if (!dataManager) return [];
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
          // preferLocal: false — the id list above is already forced fresh
          // (refresh: true, includeLocal: false), but each entry's own body
          // fetch defaults to preferring a local cache; without this override
          // that default silently served a stale per-entry snapshot even
          // though the list itself was current. Confirmed real bug this
          // fixes: an NPC's locationId, corrected server-side, kept resolving
          // to its old value here (this function backs every "list every X
          // for filtering" helper — Forge's NPCs/Locations, Crucible's
          // Monsters, Vault's Effects, Sanctum's Features/Resources/...),
          // making it disappear from the Setting it now actually belongs to.
          return { id, entity: (await dataManager.get(kind, id, { preferLocal: false }))?.payload };
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

// {id, name}, straight off the /list response — ZERO per-record fetches,
// unlike fetchKindEntriesWithIds above. The list endpoint's own rows already
// carry the record's own title (server/storage.py's library_items table has
// a real `title` column, populated at save time — see _title_from_payload)
// alongside id/ownership, with no separate per-id GET needed at all. Only
// good for callers that need a name-sorted list or a name->id lookup and
// NOTHING else about the record (findKindReferenceRecord below is the
// motivating case) — anything that needs the record's own tags/fields to
// FILTER (matchesSystem, matchesCategory, ...) still has to fall back to
// fetchKindEntriesWithIds, since those fields only exist in each record's
// own full payload, not on its /list row. Confirmed real fix, not a
// micro-optimization: a kind with hundreds of saved entries (`effect`
// crossed 700, `feature` crossed 1,500 after this session's SRD bulk
// imports) made every name lookup against it — a kind-reference chip's
// hover preview, its click-to-navigate, a wiki-link-to-reference
// conversion — cost that many individual HTTP round trips just to check
// one name.
export async function fetchKindEntrySummaries(dataManager, kind) {
  if (!dataManager) return [];
  const { remote } = await dataManager.list(kind, { refresh: true, includeLocal: false });
  return dataManager
    .collectListEntries(remote, ["owned", "shared", "public", "items"])
    .map((entry) => ({ id: entry.id, name: entry.title || entry.id }));
}

// Every Location belonging to `settingId` — shared by Sanctum (its own
// Location editor) and Forge (its Location picker for NPC generation), which
// used to each carry an identical, independently-maintained copy of this
// exact function. `settingIds` is a plural array (same "empty/absent =
// universal, non-empty = restricted" convention as systemIds); unlike a
// Resource's optional scoping, a Location with an EMPTY settingIds
// genuinely belongs to no Setting yet, so this deliberately checks
// `includes` only, not an empty-array-matches-everything shortcut. Falls
// back to a pre-migration scalar `settingId` for any not-yet-resaved record
// — same precedent as the `system` → `systemIds` character migration.
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
    case "markdown-effect": {
      if (!value) {
        throw new Error("Select a markdown item/spell file to load.");
      }
      const text = await readTextFile(value);
      return parseMarkdownEffectSource(text, value.name);
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
