// Generic `` `kindId:Name` `` inline code blocks — the same "post-process a
// rendered <code> element" treatment journal-dice.js/journal-encounter.js/
// journal-macro.js already use for their own three special-cased prefixes,
// extended to every OTHER real Library kind (npc, location, monster,
// character, system, map, template, ...) instead of leaving those with no
// reference syntax of their own. `dice`/`encounter`/`macro` keep their
// existing, richer chips (a die roller, a multi-creature combat starter, a
// runnable action) — this module only ever handles what's left over after
// markdown.js's own applyDiceRollers/applyEncounterBlocks/applyMacroBlocks
// have already consumed their own code spans, so there's no risk of double
// handling the same block. `journal`/`kind` are excluded too: a page-to-page
// reference already has its own, richer syntax ([[Wiki Link]]), and `kind`
// is the meta-kind describing kinds themselves, not something an author
// would reference directly.
//
// Unlike wiki-links (resolved eagerly, via a caller-supplied title index, so
// a missing page can render as a red "redlink"), a kind reference is
// resolved LAZILY — the rendered chip is built from the literal typed text
// alone, with no fetch at render time (renderMarkdown itself stays fully
// synchronous, same reasoning journal-macro.js's own buildMacroChip already
// documents) — actually looking the name up against that kind's real saved
// entries only happens once the chip is clicked (findKindReferenceRecord)
// or when extractContentReferences below scans a page's raw body to build
// its Related panel.
import { fetchKindEntriesWithIds, fetchKindEntrySummaries } from "../../../common/js/lib/content-fetch.js";
import { el } from "../../../common/js/lib/dom.js";
import { parseEncounterBlock, findMatch } from "./journal-encounter.js";
import { findMacro } from "./journal-macro.js";

// Kinds this module (and its caller's autocomplete/extraction) never treats
// as a generic `kindId:Name` reference — either because they already have
// their own dedicated syntax/handling (encounter, macro), or because
// referencing them this way wouldn't make sense (journal pages use
// [[Wiki Links]] instead; `kind` describes kinds, it isn't itself
// referenceable content).
export const EXCLUDED_KINDS = new Set(["journal", "kind", "encounter", "macro"]);

const KIND_REF_CODE_PATTERN = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/i;

const KIND_ICON = {
  npc: "tabler:user",
  character: "tabler:user-circle",
  monster: "tabler:paw",
  "monster-archetype": "tabler:paw",
  "monster-role": "tabler:paw",
  location: "tabler:map-pin",
  "location-type": "tabler:map-pin",
  "location-purpose": "tabler:map-pin",
  setting: "tabler:world",
  system: "tabler:settings",
  map: "tabler:map",
  template: "tabler:layout",
  wonder: "tabler:wand",
  resource: "tabler:package",
  class: "tabler:sword",
  subclass: "tabler:sword",
  background: "tabler:book",
  species: "tabler:paw",
  variant: "tabler:adjustments",
  feature: "tabler:star",
};

// Exported for code-block-autocomplete.js's own dropdown, which needs the
// exact same kind->icon mapping — one lookup table, not two that could
// quietly drift apart.
export function iconFor(kindId) {
  return KIND_ICON[kindId] || "tabler:link";
}

// Same "inline styles, not CSS classes" reasoning as journal-dice.js's own
// chip and journal-macro.js's buildMacroChip — this can render inside
// handout.js's Dashboard widget, a page that never loads Repository's own
// stylesheet.
function styleAsChip(button, interactive) {
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.gap = "0.25rem";
  button.style.padding = "0.05rem 0.4rem";
  button.style.border = "1px solid var(--bs-border-color, #dee2e6)";
  button.style.borderRadius = "0.375rem";
  button.style.background = "var(--bs-tertiary-bg, #f8f9fa)";
  button.style.color = "inherit";
  button.style.font = "inherit";
  button.style.lineHeight = "1.4";
  button.style.cursor = interactive ? "pointer" : "default";
}

function buildKindReferenceChip(kindId, name, { kindLabel, interactive, onOpenReference, dataManager } = {}) {
  const button = el("button", "repository-kind-reference-chip");
  button.type = "button";
  styleAsChip(button, interactive);
  const icon = el("span", "iconify");
  icon.dataset.icon = iconFor(kindId);
  icon.setAttribute("aria-hidden", "true");
  // Icon + name only — the kind itself is already conveyed by the icon; the
  // label lives in the hover preview instead (see attachPreview below), not
  // duplicated inline text, same "icon carries the category, text carries
  // the specific thing" split the outline/heading list already uses.
  button.append(icon, el("span", null, name));
  button.setAttribute("aria-label", `${name} (${kindLabel || kindId})`);
  if (interactive) {
    button.style.cursor = "pointer";
    button.addEventListener("click", () => onOpenReference?.(kindId, name));
  }
  // Hover/focus preview — works regardless of `interactive` (even a
  // read-only render, e.g. handout.js's own non-interactive wiki-links
  // convention, still benefits from "what IS this" on hover; clicking to
  // navigate away is the separate, GM-only capability `interactive` gates).
  // Only needs a live dataManager to actually fetch anything — omitted (or
  // undefined), the chip just renders with no preview, same "no fetch, no
  // crash, just less" grace period every other optional param in this
  // module already follows.
  attachPreview(button, kindId, name, { dataManager, kindLabel: kindLabel || kindId });
  return button;
}

// --- Hover preview popover ---------------------------------------------
// A single shared floating panel (not one per chip — this suite's own
// createTablePickerPopover precedent), showing "what IS this" on hover: the
// record's own Notes plus whichever fields that kind's own tool shows in
// its Identity box (Forge's Species/Archetype/Alignment/..., Crucible's
// Creature Type/Archetype/Role, Sanctum's Type/Purpose/Environment, Vault's
// own System-defined Properties). Inline-styled throughout, same
// cross-tool-reuse reasoning styleAsChip already documents — this renders
// inside handout.js's Dashboard widget too, a page that never loads
// Repository's own stylesheet.

// kindId -> ordered {label, path} fields to pull from the record, mirroring
// each kind's own tool's Identity box — not exhaustive of every field that
// tool shows, just the same "who/what is this at a glance" summary. `path`
// is a dotted lookup; a missing value is skipped, never shown blank.
const IDENTITY_FIELDS = {
  npc: [
    { label: "Species", path: "identity.species" },
    { label: "Archetype", path: "identity.archetype" },
    { label: "Alignment", path: "identity.alignment" },
    { label: "Gender", path: "identity.gender" },
    { label: "Age", path: "identity.age" },
  ],
  monster: [
    { label: "Type", path: "creatureType" },
    { label: "Archetype", path: "archetype" },
    { label: "Role", path: "role" },
  ],
  location: [
    { label: "Type", path: "typeId" },
    { label: "Purpose", path: "purposeId" },
    { label: "Environment", path: "environment" },
  ],
  // wonder's own Identity fields are a dynamic {propertyKey: value} bag
  // (System-defined — Rarity/Activation/Item Form for sys.dnd5e, something
  // else entirely for another System) — handled directly in
  // buildIdentityLines below via `entity.properties`, not a fixed path list.
};

function getPath(record, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), record);
}

function formatFieldValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "";
  return String(value);
}

function buildIdentityLines(kindId, record) {
  const lines = [];
  (IDENTITY_FIELDS[kindId] || []).forEach(({ label, path }) => {
    const value = formatFieldValue(getPath(record, path));
    if (value) lines.push(`${label}: ${value}`);
  });
  if (kindId === "wonder" && record?.properties && typeof record.properties === "object") {
    Object.entries(record.properties).forEach(([key, value]) => {
      const formatted = formatFieldValue(value);
      if (formatted) lines.push(`${key.charAt(0).toUpperCase()}${key.slice(1)}: ${formatted}`);
    });
  }
  return lines;
}

// Every kind's own "notes/description" field, under whichever name that
// kind actually uses (npc's own LLM-generated character note is `note`,
// singular; everything else observed is `notes` or `description`).
function resolveNotes(record) {
  return record?.notes || record?.note || record?.description || record?.summary || "";
}

let previewPopoverEl = null;
function ensurePreviewPopover() {
  if (previewPopoverEl) return previewPopoverEl;
  const popover = document.createElement("div");
  popover.style.position = "fixed";
  popover.style.zIndex = "1200";
  // Wide enough to actually read a full spell/notes entry at a glance, not
  // just a name — the whole point of this preview (per the user's own
  // framing: "I want to be able to read the whole spell text or whatever").
  // No maxHeight/overflow here — the popover is pointer-events: none (see
  // attachPreview below), so a scrollbar would be unusable dead weight;
  // NOTES_PREVIEW_MAX_CHARS below is the real (extreme-only) safety valve
  // for content long enough to matter.
  popover.style.width = "min(28rem, calc(100vw - 2rem))";
  popover.style.padding = "0.6rem 0.75rem";
  popover.style.borderRadius = "0.5rem";
  popover.style.border = "1px solid var(--bs-border-color, #dee2e6)";
  popover.style.background = "var(--bs-body-bg, #fff)";
  popover.style.color = "var(--bs-body-color, #212529)";
  popover.style.boxShadow = "var(--bs-box-shadow, 0 0.5rem 1rem rgba(0, 0, 0, 0.15))";
  popover.style.fontSize = "0.8rem";
  popover.style.lineHeight = "1.4";
  popover.style.display = "none";
  // Purely informational — never intercepts its own hover/click, so it
  // can't ever fight the chip that opened it for pointer events.
  popover.style.pointerEvents = "none";
  document.body.appendChild(popover);
  previewPopoverEl = popover;
  return popover;
}

function hidePreviewPopover() {
  if (previewPopoverEl) previewPopoverEl.style.display = "none";
}

// Measured AFTER `display: block` (so offsetWidth/Height are real), flipped
// above the chip instead of below whenever below would run off the bottom
// of the viewport, clamped to the left/right edges too — same "measure,
// then flip if it'd overflow" convention wiki-link-autocomplete.js's own
// positionDropdown already uses.
function positionPopover(popover, anchorRect) {
  const margin = 8;
  popover.style.left = "0px";
  popover.style.top = "0px";
  popover.style.display = "block";
  const popRect = popover.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  if (top + popRect.height > window.innerHeight - margin) {
    top = anchorRect.top - popRect.height - margin;
  }
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function renderPreviewLoading(popover, { name, kindLabel }) {
  popover.innerHTML = "";
  popover.appendChild(buildPreviewHeader(name, kindLabel));
  const loading = el("div", null, "Loading…");
  loading.style.color = "var(--bs-secondary-color, #6c757d)";
  popover.appendChild(loading);
}

function renderPreviewMissing(popover, { name, kindLabel }) {
  popover.innerHTML = "";
  popover.appendChild(buildPreviewHeader(name, kindLabel));
  const missing = el("div", null, "No saved record found.");
  missing.style.color = "var(--bs-secondary-color, #6c757d)";
  popover.appendChild(missing);
}

function buildPreviewHeader(name, kindLabel) {
  const row = el("div", null);
  row.style.display = "flex";
  row.style.alignItems = "flex-start";
  row.style.justifyContent = "space-between";
  row.style.gap = "0.5rem";
  row.style.marginBottom = "0.35rem";
  const title = el("div", null, name);
  title.style.fontWeight = "600";
  row.appendChild(title);
  const badge = el("div", null, kindLabel);
  badge.style.flexShrink = "0";
  badge.style.fontSize = "0.7rem";
  badge.style.textTransform = "uppercase";
  badge.style.letterSpacing = "0.03em";
  badge.style.color = "var(--bs-secondary-color, #6c757d)";
  row.appendChild(badge);
  return row;
}

// A high, effectively-never-hit safety cap, not a real truncation limit —
// the whole point of this preview is reading the full spell/item/notes
// text without needing to open the real record, so it should show
// everything short of something pathological (a full journal page's worth
// of text accidentally living in a notes field).
const NOTES_PREVIEW_MAX_CHARS = 6000;

function renderPreviewContent(popover, { name, kindLabel, lines, notes }) {
  popover.innerHTML = "";
  popover.appendChild(buildPreviewHeader(name, kindLabel));
  if (lines.length) {
    const list = el("div", null);
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "0.05rem";
    list.style.marginBottom = notes ? "0.4rem" : "0";
    lines.forEach((line) => list.appendChild(el("div", null, line)));
    popover.appendChild(list);
  }
  if (notes) {
    const notesEl = el(
      "div",
      null,
      notes.length > NOTES_PREVIEW_MAX_CHARS ? `${notes.slice(0, NOTES_PREVIEW_MAX_CHARS).trim()}…` : notes
    );
    notesEl.style.color = "var(--bs-secondary-color, #6c757d)";
    popover.appendChild(notesEl);
  }
  if (!lines.length && !notes) {
    const empty = el("div", null, "No additional details.");
    empty.style.color = "var(--bs-secondary-color, #6c757d)";
    popover.appendChild(empty);
  }
}

// One cached lookup per (kind, name) for the lifetime of the page — hovering
// the same chip twice (or two chips referencing the same record) never
// re-fetches. Cleared implicitly on a full page reload; this module has no
// long-lived state otherwise.
const previewRecordCache = new Map();
function loadPreviewRecord(dataManager, kindId, name) {
  const key = `${kindId}:${name.trim().toLowerCase()}`;
  if (!previewRecordCache.has(key)) {
    previewRecordCache.set(key, findKindReferenceRecord(dataManager, kindId, name).catch(() => null));
  }
  return previewRecordCache.get(key);
}

// A short delay before showing (avoids a flash while the pointer just
// passes over a chip) and before hiding (a small gap letting the pointer
// cross from the chip onto the popover itself doesn't matter here, since
// the popover has pointer-events: none, but keeping the same delay pattern
// avoids flicker when the pointer briefly leaves and re-enters the chip).
function attachPreview(button, kindId, name, { dataManager, kindLabel }) {
  if (!dataManager) return;
  let showTimer = 0;
  let hideTimer = 0;
  let requestToken = 0;

  async function show() {
    const token = (requestToken += 1);
    const popover = ensurePreviewPopover();
    renderPreviewLoading(popover, { name, kindLabel });
    positionPopover(popover, button.getBoundingClientRect());
    const record = await loadPreviewRecord(dataManager, kindId, name);
    if (token !== requestToken || popover.style.display === "none") return; // superseded or already dismissed
    if (!record) {
      renderPreviewMissing(popover, { name, kindLabel });
    } else {
      renderPreviewContent(popover, {
        name: record.name || name,
        kindLabel,
        lines: buildIdentityLines(kindId, record.payload),
        notes: resolveNotes(record.payload),
      });
    }
    positionPopover(popover, button.getBoundingClientRect());
  }

  function scheduleShow() {
    window.clearTimeout(hideTimer);
    showTimer = window.setTimeout(() => void show(), 250);
  }
  function scheduleHide() {
    window.clearTimeout(showTimer);
    requestToken += 1; // invalidate any in-flight fetch's own late render
    hideTimer = window.setTimeout(hidePreviewPopover, 100);
  }

  button.addEventListener("mouseenter", scheduleShow);
  button.addEventListener("mouseleave", scheduleHide);
  button.addEventListener("focus", scheduleShow);
  button.addEventListener("blur", scheduleHide);
}

// Runs after applyDiceRollers/applyEncounterBlocks/applyMacroBlocks —
// CommonMark's own backtick syntax already turned every `` `kindId:Name` ``
// span into a plain <code>...</code>; those three passes already replaced
// (removed) their own dice/encounter/macro spans, so this only ever sees
// whatever's left. `kindLabels` is a {id: label} map (loadLibraryKinds'
// own display labels) — falls back to the raw kindId when a caller hasn't
// loaded it yet, same "never block rendering on a fetch" reasoning as the
// lazy-resolution comment up top.
export function applyKindReferenceBlocks(container, { validKindIds, kindLabels = {}, interactive = false, onOpenReference, dataManager } = {}) {
  if (!validKindIds || !validKindIds.size) return;
  container.querySelectorAll("code").forEach((codeEl) => {
    const match = KIND_REF_CODE_PATTERN.exec(codeEl.textContent.trim());
    if (!match) return;
    const kindId = match[1].toLowerCase();
    if (EXCLUDED_KINDS.has(kindId) || !validKindIds.has(kindId)) return;
    const name = match[2].trim();
    if (!name) return;
    codeEl.replaceWith(buildKindReferenceChip(kindId, name, { kindLabel: kindLabels[kindId], interactive, onOpenReference, dataManager }));
  });
}

// Case-insensitive match against either the record's own id or its display
// name — same "no fuzzy matching" convention journal-encounter.js's own
// findMatch/journal-macro.js's own findMacro establish.
export async function findKindReferenceRecord(dataManager, kindId, name) {
  if (!dataManager) return null;
  // fetchKindEntrySummaries — NOT fetchKindEntriesWithIds — the /list
  // response's own `title` field is enough to find WHICH record matches by
  // name; the full payload only needs fetching for the ONE match actually
  // found, not every entry of that kind. Confirmed real fix: a kind with
  // hundreds/thousands of saved entries (wonder, feature — both crossed
  // hundreds after this session's SRD bulk imports) made every reference
  // chip's click/hover cost that many individual record fetches just to
  // resolve one name.
  const summaries = await fetchKindEntrySummaries(dataManager, kindId).catch(() => []);
  const normalized = String(name || "").trim().toLowerCase();
  const match = summaries.find(
    (entry) => String(entry.id).toLowerCase() === normalized || entry.name.trim().toLowerCase() === normalized
  );
  if (!match) return null;
  try {
    const result = await dataManager.get(kindId, match.id, { preferLocal: false });
    return { kind: kindId, id: match.id, name: match.name, payload: result?.payload || {} };
  } catch (error) {
    return null;
  }
}

const CODE_SPAN_PATTERN = /`([^`\n]+)`/g;
const DICE_CODE_PATTERN = /^dice:\s*(.+)$/i;
const ENCOUNTER_CODE_PATTERN = /^encounter:\s*(.+)$/i;
const MACRO_CODE_PATTERN = /^macro:\s*(.+)$/i;

// Scans raw markdown text (not rendered HTML — same "no dependency on
// marked/DOMPurify" reasoning journal-links.js's own findBacklinks
// documents) for every code-span reference this page's body actually
// makes, resolves each against the real Library record it names, and
// returns the deduped result — what Repository's own Related panel renders
// directly (app.js's renderRelated), instead of a manually maintained
// `refs` list. An `encounter:` block resolves to one ref per matched
// creature (exactly what journal-encounter.js's own findMatch would use to
// build a real encounter from it); dice blocks are skipped entirely (a die
// roll references nothing). Unmatched/unresolvable text is silently
// dropped, same "an unmatched reference just doesn't do anything" spirit
// every chip in this file already follows — Related only ever shows real,
// resolved links, never a guess.
export async function extractContentReferences(body, dataManager, validKindIds) {
  const text = String(body || "");
  const spans = [];
  let spanMatch;
  while ((spanMatch = CODE_SPAN_PATTERN.exec(text))) {
    spans.push(spanMatch[1].trim());
  }
  if (!spans.length || !dataManager) return [];

  // Fetched at most once per kind actually referenced on this page, shared
  // across every span that needs it — not once per span. Two separate
  // caches, not one: findMatch's own encounter-matching (below) genuinely
  // needs each candidate's FULL payload (real stats, to actually start a
  // combat from), but the generic `kindId:Name` matching further down only
  // ever needs id+name to build a Related-panel ref — fetchKindEntrySummaries
  // (no per-record fetch at all) covers that one for free.
  const kindEntriesCache = new Map();
  const loadKind = (kindId) => {
    if (!kindEntriesCache.has(kindId)) {
      kindEntriesCache.set(kindId, fetchKindEntriesWithIds(dataManager, kindId).catch(() => []));
    }
    return kindEntriesCache.get(kindId);
  };
  const kindSummaryCache = new Map();
  const loadKindSummaries = (kindId) => {
    if (!kindSummaryCache.has(kindId)) {
      kindSummaryCache.set(kindId, fetchKindEntrySummaries(dataManager, kindId).catch(() => []));
    }
    return kindSummaryCache.get(kindId);
  };

  const refs = [];
  const seen = new Set();
  const addRef = (kind, id, name) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ kind, id, name });
  };

  for (const span of spans) {
    if (DICE_CODE_PATTERN.test(span)) continue;

    const encounterMatch = ENCOUNTER_CODE_PATTERN.exec(span);
    if (encounterMatch) {
      const creatures = parseEncounterBlock(encounterMatch[1]);
      if (!creatures.length) continue;
      const [monsters, npcs] = await Promise.all([loadKind("monster"), loadKind("npc")]);
      creatures.forEach((creature) => {
        const found = findMatch(creature.name, monsters, npcs);
        if (found) addRef(found.kind, found.id, creature.name);
      });
      continue;
    }

    const macroMatch = MACRO_CODE_PATTERN.exec(span);
    if (macroMatch) {
      const ref = macroMatch[1].trim();
      if (!ref) continue;
      const macro = await findMacro(dataManager, ref);
      if (macro) addRef("macro", macro.id, macro.name || ref);
      continue;
    }

    const genericMatch = KIND_REF_CODE_PATTERN.exec(span);
    if (!genericMatch) continue;
    const kindId = genericMatch[1].toLowerCase();
    if (EXCLUDED_KINDS.has(kindId) || !validKindIds?.has(kindId)) continue;
    const name = genericMatch[2].trim();
    if (!name) continue;
    const entries = await loadKindSummaries(kindId);
    const normalized = name.toLowerCase();
    const found = entries.find((entry) => String(entry.id).toLowerCase() === normalized || entry.name.trim().toLowerCase() === normalized);
    if (found) addRef(kindId, found.id, found.name || name);
  }
  return refs;
}
