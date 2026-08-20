// Suite-wide header search — one box, every tool, searching every Library
// kind (npc/monster/location/feature/... including Repository's own
// `journal` kind, which is just another Library kind by this point) at
// once, plus the current user's own local-only (not-yet-synced or genuinely
// anonymous) saved content. Wikipedia-style rich results: icon, title, a
// short "{Kind} · {Tool}" detail line underneath. Click/Enter navigates
// straight into the right tool via kind-tool-route.js's own routing table —
// the same one relationship-editor.js's "Open in X" action and Orrery's
// marker link-out already use, so a kind that isn't deep-linkable there
// isn't searchable here either (nothing to navigate to).
//
// Fully self-contained: builds its own DataManager instance(s) rather than
// taking one as a parameter, so app-shell.js can wire this in once, for
// every page, with no per-tool app.js changes needed. Session state is
// shared across every DataManager instance regardless of storagePrefix (see
// data-manager.js's own DEFAULT_SESSION_KEY comment), so "am I signed in"
// resolves correctly here without needing the page's own already-constructed
// instance.
import { DataManager } from "./data-manager.js";
import { resolveApiBase } from "./api.js";
import { buildKindToolUrl, kindToolLabel } from "./kind-tool-route.js";

// Icon/label per kind — deliberately NOT loaded from common/data/kind/*.json
// (loadLibraryKinds(), content-fetch.js) to keep this header widget light on
// every single page load; content-fetch.js pulls in the whole D&D Beyond/
// mapping-engine import chain for a feature this doesn't need. Restricted to
// exactly the kinds KIND_TOOL_ROUTE can actually navigate to — a kind with
// no route (group, encounter, kind, relationship) has nothing to click
// through to, so it's not offered as a search result either.
const KIND_META = {
  npc: { label: "NPC", icon: "tabler:users" },
  monster: { label: "Monster", icon: "tabler:skull" },
  wonder: { label: "Wonder", icon: "tabler:wand" },
  location: { label: "Location", icon: "tabler:map-pin" },
  setting: { label: "Setting", icon: "tabler:map" },
  system: { label: "System", icon: "tabler:settings" },
  feature: { label: "Feature", icon: "tabler:puzzle" },
  macro: { label: "Macro", icon: "tabler:bolt" },
  map: { label: "Map", icon: "tabler:map-2" },
  journal: { label: "Journal Page", icon: "tabler:notebook" },
  character: { label: "Character", icon: "tabler:user" },
  template: { label: "Template", icon: "tabler:layout" },
  "monster-archetype": { label: "Monster Archetype", icon: "tabler:chess-knight" },
  "monster-role": { label: "Monster Role", icon: "tabler:sword" },
  "location-type": { label: "Location Type", icon: "tabler:category" },
  "location-purpose": { label: "Location Purpose", icon: "tabler:target-arrow" },
  resource: { label: "Resource", icon: "tabler:package" },
  class: { label: "Class", icon: "tabler:sword" },
  subclass: { label: "Subclass", icon: "tabler:sword" },
  background: { label: "Background", icon: "tabler:book" },
  species: { label: "Species", icon: "tabler:paw" },
  variant: { label: "Variant", icon: "tabler:copy" },
};

// Every kind's LOCAL (browser-only, not-yet-synced-or-genuinely-anonymous)
// content lives in whichever tool's own DataManager first saved it — most
// share the one default "undercroft" prefix (see data-manager.js's own
// `initAuthControls` default), but Repository's journal and Workbench's
// character/template each use their own tool-specific prefix instead. Not a
// guess: matches exactly what each tool's own `new DataManager({...})` call
// passes as `storagePrefix` today.
const LOCAL_PREFIX_BY_KIND = {
  journal: "undercroft.repository",
  character: "undercroft.workbench",
  template: "undercroft.workbench",
};
const DEFAULT_LOCAL_PREFIX = "undercroft";

const MIN_QUERY_LENGTH = 2;
const SERVER_DEBOUNCE_MS = 250;
const MAX_RESULTS = 20;

function resolveLocalTitle(payload, id) {
  return payload?.title || payload?.name || payload?.data?.name || id;
}

// Client-side mirror of storage.py's own _collect_searchable_strings/
// _collect_reference_ids/_build_snippet — same deep-search treatment for a
// user's own LOCAL (not-yet-synced or genuinely anonymous) content as the
// server gives everything else, same length/key thresholds so the two
// halves of this feature behave identically regardless of which one a
// given record happens to be found through.
const SEARCH_MIN_BODY_STRING_LENGTH = 12;
const SEARCH_REFERENCE_KEYS = ["featureIds", "synergizesWith", "conflictsWith", "dependsOn"];

function collectSearchableStrings(value, acc) {
  if (typeof value === "string") {
    if (value.length >= SEARCH_MIN_BODY_STRING_LENGTH) acc.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((child) => collectSearchableStrings(child, acc));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((child) => collectSearchableStrings(child, acc));
  }
}

function collectReferenceIds(payload) {
  const ids = new Set();
  if (payload && typeof payload === "object") {
    SEARCH_REFERENCE_KEYS.forEach((key) => {
      if (Array.isArray(payload[key])) {
        payload[key].forEach((entry) => {
          if (typeof entry === "string") ids.add(entry);
        });
      }
    });
  }
  return ids;
}

function buildSnippet(text, query, context = 50) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - context);
  const end = Math.min(text.length, idx + query.length + context);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

// One DataManager per distinct local storage prefix, built lazily and
// reused across searches (cheap — no network I/O in the constructor, see
// data-manager.js — but no reason to rebuild on every keystroke either).
function createLocalManagerPool() {
  const pool = new Map();
  return (prefix) => {
    if (!pool.has(prefix)) {
      pool.set(prefix, new DataManager({ baseUrl: resolveApiBase(), storagePrefix: prefix }));
    }
    return pool.get(prefix);
  };
}

function searchLocal(query, getLocalManager) {
  const needle = query.toLowerCase();
  const titleResults = [];
  const bodyResults = [];
  const referenceCandidates = []; // {kind, id, title, referenceIds}
  const matchedEntities = new Map(); // id -> {kind, title}

  Object.keys(KIND_META).forEach((kind) => {
    const prefix = LOCAL_PREFIX_BY_KIND[kind] || DEFAULT_LOCAL_PREFIX;
    let entries;
    try {
      entries = getLocalManager(prefix).listLocalEntries(kind);
    } catch (error) {
      entries = [];
    }
    entries.forEach(({ id, payload }) => {
      const title = String(resolveLocalTitle(payload, id));
      const isTitleMatch = title.toLowerCase().includes(needle);
      if (isTitleMatch) {
        titleResults.push({ kind, id, title, source: "local", matchType: "title" });
        matchedEntities.set(id, { kind, title });
      } else {
        const strings = [];
        collectSearchableStrings(payload, strings);
        for (const text of strings) {
          if (text.toLowerCase().includes(needle)) {
            const snippet = buildSnippet(text, query);
            if (snippet) bodyResults.push({ kind, id, title, source: "local", matchType: "body", snippet });
            break;
          }
        }
      }
      const referenceIds = collectReferenceIds(payload);
      if (referenceIds.size) referenceCandidates.push({ kind, id, title, referenceIds });
    });
  });

  const referenceResults = [];
  referenceCandidates.forEach(({ kind, id, title, referenceIds }) => {
    for (const refId of referenceIds) {
      const matched = matchedEntities.get(refId);
      if (matched) {
        referenceResults.push({
          kind,
          id,
          title,
          source: "local",
          matchType: "reference",
          snippet: `References ${KIND_META[matched.kind]?.label || matched.kind}: ${matched.title}`,
        });
        break;
      }
    }
  });

  return [...titleResults, ...bodyResults, ...referenceResults];
}

async function searchServer(query, dataManager) {
  try {
    const rows = await dataManager.searchContent(query);
    return rows
      .filter((row) => KIND_META[row.kind])
      .map((row) => ({
        kind: row.kind,
        id: row.id,
        title: row.title || row.id,
        ownerUsername: row.owner_username || "",
        source: "server",
        matchType: row.match_type || "title",
        snippet: row.snippet || null,
      }));
  } catch (error) {
    // A signed-out session, an offline/dev server with no /content/search
    // route yet, or a genuine network hiccup — none of these should ever
    // break the search box; local results still stand on their own.
    console.warn("Suite search: server search failed", error);
    return [];
  }
}

const MATCH_TYPE_RANK = { title: 0, body: 1, reference: 2 };

// Server results win over a local mirror of the same record (richer —
// owner info the local copy never carries). Ranked title matches first,
// then body matches, then reference matches (mirrors storage.py's own
// search_content sort so server and local results interleave sensibly);
// within "title", prefix matches ("Fire" -> "Fire Elemental") sort ahead of
// mid-string ones ("Fire" -> "Adult Fire Giant"), then alphabetically.
function mergeResults(localResults, serverResults, query) {
  const merged = new Map();
  [...localResults, ...serverResults].forEach((entry) => {
    const key = `${entry.kind}:${entry.id}`;
    const existing = merged.get(key);
    if (!existing || (entry.source === "server" && existing.source !== "server")) {
      merged.set(key, entry);
    }
  });
  const needle = query.toLowerCase();
  return Array.from(merged.values())
    .sort((a, b) => {
      const rankDiff = (MATCH_TYPE_RANK[a.matchType] ?? 3) - (MATCH_TYPE_RANK[b.matchType] ?? 3);
      if (rankDiff !== 0) return rankDiff;
      if (a.matchType === "title") {
        const aStarts = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
        const bStarts = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, MAX_RESULTS);
}

// Wraps the (case-insensitive) query substring in <mark> within a snippet —
// same "bold the matched term" treatment Wikipedia's own search dropdown
// uses — via textContent-built fragments, never innerHTML, so a note's own
// body text can never inject markup here.
function appendHighlighted(el, text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    el.appendChild(document.createTextNode(text));
    return;
  }
  el.appendChild(document.createTextNode(text.slice(0, idx)));
  const mark = document.createElement("mark");
  mark.className = "suite-search-result-mark";
  mark.textContent = text.slice(idx, idx + query.length);
  el.appendChild(mark);
  el.appendChild(document.createTextNode(text.slice(idx + query.length)));
}

function buildResultRow(entry, currentUsername, query) {
  const meta = KIND_META[entry.kind] || { label: entry.kind, icon: "tabler:file" };
  // A journal body match carries the query along as `?q=` — Repository's
  // own deep-link handling (see repository/js/app.js's own jumpToSearchQuery)
  // uses it to scroll/highlight the actual match, the same experience its
  // own in-page search already gives, rather than just landing at the top
  // of the note. Title matches and other kinds don't need this — there's
  // nothing buried in the body to scroll to.
  const extraParams = entry.kind === "journal" && entry.matchType === "body" ? { q: query } : undefined;
  const href = buildKindToolUrl(entry.kind, entry.id, { extraParams });
  const row = document.createElement(href ? "a" : "div");
  row.className = "suite-search-result";
  row.setAttribute("role", "option");
  if (href) row.href = href;

  const iconEl = document.createElement("span");
  iconEl.className = "iconify suite-search-result-icon";
  iconEl.dataset.icon = meta.icon;
  iconEl.setAttribute("aria-hidden", "true");
  row.appendChild(iconEl);

  const textWrap = document.createElement("span");
  textWrap.className = "suite-search-result-text";

  const titleEl = document.createElement("span");
  titleEl.className = "suite-search-result-title";
  titleEl.textContent = entry.title;
  textWrap.appendChild(titleEl);

  const subtitleParts = [meta.label, kindToolLabel(entry.kind)].filter(Boolean);
  if (entry.ownerUsername && entry.ownerUsername !== currentUsername) {
    subtitleParts.push(`shared by ${entry.ownerUsername}`);
  } else if (entry.source === "local") {
    subtitleParts.push("saved locally");
  }
  const subtitleEl = document.createElement("span");
  subtitleEl.className = "suite-search-result-subtitle";
  subtitleEl.textContent = subtitleParts.join(" · ");
  textWrap.appendChild(subtitleEl);

  // Wikipedia-style context line — only for a body/reference match, where
  // the title itself doesn't already explain why this result showed up.
  // A reference match's snippet ("References Feature: Void Body") has no
  // literal query substring to highlight, so it renders as plain text.
  if (entry.snippet) {
    const snippetEl = document.createElement("span");
    snippetEl.className = "suite-search-result-snippet";
    if (entry.matchType === "body") {
      appendHighlighted(snippetEl, entry.snippet, query);
    } else {
      snippetEl.textContent = entry.snippet;
    }
    textWrap.appendChild(snippetEl);
  }

  row.appendChild(textWrap);
  return row;
}

export function initSuiteSearch({ container } = {}) {
  if (!container) return;

  const dataManager = new DataManager({ baseUrl: resolveApiBase() });
  const getLocalManager = createLocalManagerPool();

  const wrap = document.createElement("div");
  wrap.className = "suite-search";

  // When .workbench-header-middle doesn't have room to spare (see shell.
  // css's container-query rules), the persistent input would eat into the
  // header's limited width for no benefit most of the time search isn't in
  // active use — this icon-only trigger reveals the same input+icon inline
  // instead. Search is deliberately the FIRST control to give up its full
  // form as space tightens (the widest container-query threshold of the
  // three staged controls) — it's the single widest piece of header
  // content, and losing it first buys the most room back per pixel.
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn btn-outline-secondary suite-search-trigger undercroft-header-icon-btn";
  trigger.setAttribute("aria-label", "Search Undercroft");
  trigger.setAttribute("aria-expanded", "false");
  const triggerIcon = document.createElement("span");
  triggerIcon.className = "iconify fs-5";
  triggerIcon.dataset.icon = "tabler:search";
  triggerIcon.setAttribute("aria-hidden", "true");
  trigger.appendChild(triggerIcon);

  const inputWrap = document.createElement("div");
  // Hidden until either the container query in common/css/shell.css
  // reveals it (enough room in .workbench-header-middle) or the trigger
  // opens it (see openCompact/closeCompact below) — display rules live in
  // shell.css, not here.
  inputWrap.className = "suite-search-input-wrap";
  const searchIcon = document.createElement("span");
  searchIcon.className = "iconify suite-search-icon";
  searchIcon.dataset.icon = "tabler:search";
  searchIcon.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "search";
  input.className = "form-control form-control-sm suite-search-input";
  input.placeholder = "Search Undercroft…";
  input.setAttribute("aria-label", "Search Undercroft");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  inputWrap.append(searchIcon, input);

  const results = document.createElement("div");
  results.className = "suite-search-results d-none";
  results.setAttribute("role", "listbox");

  wrap.append(trigger, inputWrap, results);
  container.innerHTML = "";
  container.appendChild(wrap);

  // Whether the trigger is currently the way to reach the input at all —
  // read off its own rendered state (shell.css's container query is what
  // actually governs this) rather than re-declaring the threshold here,
  // one source of truth for it.
  function isCompactViewport() {
    return getComputedStyle(trigger).display !== "none";
  }

  function openCompact() {
    inputWrap.classList.add("suite-search-input-wrap--open");
    trigger.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closeCompact() {
    if (!isCompactViewport()) return;
    inputWrap.classList.remove("suite-search-input-wrap--open");
    trigger.setAttribute("aria-expanded", "false");
  }

  trigger.addEventListener("click", () => {
    if (trigger.getAttribute("aria-expanded") === "true") {
      closeCompact();
    } else {
      openCompact();
    }
  });

  let activeIndex = -1;
  let serverDebounceTimer = 0;
  let requestId = 0;

  function closeResults() {
    results.classList.add("d-none");
    results.innerHTML = "";
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
  }

  function setActive(index) {
    const rows = Array.from(results.children);
    rows.forEach((row) => row.classList.remove("suite-search-result-active"));
    if (index >= 0 && index < rows.length) {
      rows[index].classList.add("suite-search-result-active");
      rows[index].scrollIntoView({ block: "nearest" });
    }
    activeIndex = index;
  }

  function renderRows(entries, query) {
    results.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "suite-search-empty";
      empty.textContent = "No matches.";
      results.appendChild(empty);
    } else {
      const currentUsername = dataManager.session?.user?.username || "";
      entries.forEach((entry) => results.appendChild(buildResultRow(entry, currentUsername, query)));
    }
    results.classList.remove("d-none");
    input.setAttribute("aria-expanded", "true");
    activeIndex = -1;
  }

  async function runSearch(query) {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      closeResults();
      return;
    }
    const thisRequest = ++requestId;
    const localEntries = searchLocal(trimmed, getLocalManager);
    renderRows(mergeResults(localEntries, [], trimmed), trimmed);

    window.clearTimeout(serverDebounceTimer);
    serverDebounceTimer = window.setTimeout(async () => {
      const serverEntries = await searchServer(trimmed, dataManager);
      if (thisRequest !== requestId) return; // a newer keystroke already superseded this
      renderRows(mergeResults(localEntries, serverEntries, trimmed), trimmed);
    }, SERVER_DEBOUNCE_MS);
  }

  input.addEventListener("input", () => {
    void runSearch(input.value);
  });

  input.addEventListener("keydown", (event) => {
    const rows = Array.from(results.children).filter((row) => row.matches(".suite-search-result"));
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rows.length) setActive(Math.min(activeIndex + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length) setActive(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && rows[activeIndex]) {
        event.preventDefault();
        rows[activeIndex].click();
      }
    } else if (event.key === "Escape") {
      closeResults();
      input.blur();
      closeCompact();
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) {
      closeResults();
      closeCompact();
    }
  });

  input.addEventListener("focus", () => {
    if (input.value.trim().length >= MIN_QUERY_LENGTH && results.children.length) {
      results.classList.remove("d-none");
      input.setAttribute("aria-expanded", "true");
    }
  });
}
