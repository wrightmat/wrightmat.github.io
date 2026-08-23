// Shared "reference a Library record inline, see its full details on
// hover/click" primitive — extracted from repository/js/lib/journal-kind-
// reference.js, which originally built this only for Journal markdown's own
// `` `kindId:Name` `` code-span syntax. Two consumers outside Repository
// (common/js/lib/widgets/board.js, and repository/js/lib/markdown.js on
// handout.js's behalf) were already reaching across into Repository's own
// tree to get at this — that cross-tool reach was the real signal this
// belonged here instead. journal-kind-reference.js now imports from this
// module rather than defining its own copies; only what's genuinely
// markdown-specific (the code-span regex/scanning) stayed behind there.
//
// Every reference here is resolved LAZILY — a chip renders from whatever
// {kind, id, name} it's given with no fetch, and only looks up the real
// record (for the hover/focus preview) once the pointer actually lingers.
import { fetchKindEntrySummaries } from "./content-fetch.js";
import { el } from "./dom.js";

// Kinds that never make sense as a generic Library reference — either they
// already have their own dedicated syntax/handling elsewhere (encounter,
// macro — Repository's own markdown pipeline gives these richer, special-
// cased chips before this module ever sees their code spans), or
// referencing them this way wouldn't make sense (journal pages use
// [[Wiki Links]] instead; `kind` describes kinds, it isn't itself
// referenceable content).
export const EXCLUDED_KINDS = new Set(["journal", "kind", "encounter", "macro"]);

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
// handout.js's Dashboard widget, or Workbench's own character sheet, pages
// that never load Repository's own stylesheet.
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

// {kind, id, name, dataManager, interactive, onOpen, kindLabel} — `id` OR
// `name` (or both) identify the target record; passing `id` (every
// {refKind, refId, name}-shaped field in the suite already has one) skips
// the name-matching lookup entirely once hovered/clicked, see
// findKindReferenceRecordById below. `onOpen` fires with (kindId, id||name)
// when `interactive` and the chip is clicked — the caller decides what
// "open" means (Repository jumps to the record's own tool via
// kind-tool-route.js; a read-only render just omits `interactive`).
export function createReferenceChip({ kind, id, name, dataManager, interactive, onOpen, kindLabel } = {}) {
  const button = el("button", "library-reference-chip");
  button.type = "button";
  styleAsChip(button, interactive);
  const icon = el("span", "iconify");
  icon.dataset.icon = iconFor(kind);
  icon.setAttribute("aria-hidden", "true");
  // Icon + name only — the kind itself is already conveyed by the icon; the
  // label lives in the hover preview instead (see attachReferencePreview
  // below), not duplicated inline text, same "icon carries the category,
  // text carries the specific thing" split the outline/heading list already
  // uses.
  button.append(icon, el("span", null, name || id));
  button.setAttribute("aria-label", `${name || id} (${kindLabel || kind})`);
  if (interactive) {
    button.style.cursor = "pointer";
    button.addEventListener("click", () => onOpen?.(kind, id || name));
  }
  // Hover/focus preview — works regardless of `interactive` (even a
  // read-only render, e.g. handout.js's own non-interactive wiki-links
  // convention, still benefits from "what IS this" on hover; clicking to
  // navigate away is the separate, GM-only capability `interactive` gates).
  // Only needs a live dataManager to actually fetch anything — omitted (or
  // undefined), the chip just renders with no preview, same "no fetch, no
  // crash, just less" grace period every other optional param in this
  // module already follows.
  attachReferencePreview(button, { kind, id, name, dataManager, kindLabel: kindLabel || kind });
  return button;
}

// --- Hover preview popover ---------------------------------------------
// A single shared floating panel (not one per chip — this suite's own
// createTablePickerPopover precedent), showing "what IS this" on hover: the
// record's own Notes plus whichever fields that kind's own tool shows in
// its Identity box (Forge's Species/Archetype/Alignment/..., Crucible's
// Creature Type/Archetype/Role, Sanctum's Type/Purpose/Environment, Vault's
// own System-defined Properties). Inline-styled throughout, same
// cross-tool-reuse reasoning styleAsChip already documents.

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
  // class's own Primary Ability/Hit Die are handled directly in
  // buildIdentityLines below, not a fixed path list — DDB's own
  // `primary_ability` is `{desc, ability_scores}`, not a plain string.
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
  if (kindId === "class") {
    // DDB's own `primary_ability` is `{desc, ability_scores}`; the 5e API's
    // own shape (5e-api-class.json, unused by any import so far) is an
    // array of `{name}` objects instead — handled defensively rather than
    // assuming one specific shape, since both mappings feed this same kind.
    const primaryAbility = record?.primary_ability;
    const abilityText =
      typeof primaryAbility === "string"
        ? primaryAbility
        : primaryAbility?.desc ||
          (Array.isArray(primaryAbility) ? primaryAbility.map((a) => a?.name || a?.desc || a).filter(Boolean).join(", ") : "");
    if (abilityText) lines.push(`Primary Ability: ${abilityText}`);
    if (record?.hit_die) lines.push(`Hit Die: d${record.hit_die}`);
  }
  return lines;
}

// Every kind's own "notes/description" field, under whichever name that
// kind actually uses (npc's own LLM-generated character note is `note`,
// singular; everything else observed is `notes` or `description`).
export function resolveNotes(record) {
  return record?.notes || record?.note || record?.description || record?.summary || "";
}

let previewPopoverEl = null;
function ensurePreviewPopover() {
  if (previewPopoverEl) return previewPopoverEl;
  const popover = document.createElement("div");
  popover.style.position = "fixed";
  popover.style.zIndex = "1200";
  // Wide enough to actually read a full spell/notes entry at a glance, not
  // just a name — the whole point of this preview. No maxHeight/overflow
  // here — the popover is pointer-events: none (see attachReferencePreview
  // below), so a scrollbar would be unusable dead weight; NOTES_PREVIEW_MAX
  // _CHARS below is the real (extreme-only) safety valve for content long
  // enough to matter.
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

// A minimal, Journal-extension-free markdown render for the preview's own
// notes text — resolveNotes' record (a Feature/Spell/...) may now carry
// real CommonMark (Workbench's own htmlBlocksToText/ddb-content-parser.js
// preserve **bold**/*italic*/tables instead of throwing them away — see
// createRichTextControl's own comment, workbench-template-view.js), and
// this preview is the OTHER place that same source text shows up, so it
// needs the same rendering, not literal asterisks. Deliberately NOT
// repository/js/lib/markdown.js's own renderMarkdown — that module already
// imports journal-kind-reference.js, which imports THIS file, so importing
// it back here would be a circular dependency; a chip preview also has no
// legitimate use for any of that module's Journal-specific extensions
// (wiki-links, dice/macro/encounter blocks, callouts, task checkboxes)
// anyway. Same window.marked/window.DOMPurify globals, checked at call
// time not module load, so this degrades to plain text in any tool that
// hasn't loaded those CDN scripts — same graceful fallback renderMarkdown
// itself has. `breaks: true` matches renderMarkdown's own setting exactly,
// so the identical source text renders identically in both places.
function renderNotesPreview(text) {
  const container = document.createElement("div");
  const marked = window.marked;
  const DOMPurify = window.DOMPurify;
  if (!marked || !DOMPurify) {
    container.textContent = text || "";
    container.style.whiteSpace = "pre-line";
    return container;
  }
  container.innerHTML = DOMPurify.sanitize(marked.parse(text || "", { async: false, breaks: true }));
  return container;
}

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
    const notesEl = renderNotesPreview(notes.length > NOTES_PREVIEW_MAX_CHARS ? `${notes.slice(0, NOTES_PREVIEW_MAX_CHARS).trim()}…` : notes);
    notesEl.style.color = "var(--bs-secondary-color, #6c757d)";
    popover.appendChild(notesEl);
  }
  if (!lines.length && !notes) {
    const empty = el("div", null, "No additional details.");
    empty.style.color = "var(--bs-secondary-color, #6c757d)";
    popover.appendChild(empty);
  }
}

// Case-insensitive match against either the record's own id or its display
// name — same "no fuzzy matching" convention journal-encounter.js's own
// findMatch/journal-macro.js's own findMacro establish. `filter` (optional,
// `(summaryEntry) => boolean`) narrows the candidate pool BEFORE matching —
// for a kind like "wonder" that models more than one real-world concept
// under one name (a spell and a piece of equipment can share a name, e.g.
// the "Shield" spell vs a suit of armor's own shield — confirmed real
// collision: a Character's own Shield equipment linked to the Shield SPELL
// Wonder instead), the caller decides what "the right kind of candidate"
// means (content-feature-matching.js's own isSpellForm), not this generic
// utility.
export async function findKindReferenceRecord(dataManager, kindId, name, { filter } = {}) {
  if (!dataManager) return null;
  // fetchKindEntrySummaries — NOT the bulk per-record fetch — the /list
  // response's own `title` field is enough to find WHICH record matches by
  // name; the full payload only needs fetching for the ONE match actually
  // found, not every entry of that kind. Confirmed real fix: a kind with
  // hundreds/thousands of saved entries (wonder, feature) made every
  // reference chip's click/hover cost that many individual record fetches
  // just to resolve one name.
  const summaries = await fetchKindEntrySummaries(dataManager, kindId).catch(() => []);
  const candidates = typeof filter === "function" ? summaries.filter(filter) : summaries;
  const normalized = String(name || "").trim().toLowerCase();
  const match = candidates.find(
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

// The id-based counterpart to findKindReferenceRecord — every new
// {refKind, refId, name}-shaped field this suite adds already has an id, so
// skips the name-matching summary-list scan entirely and goes straight to
// the one record that's actually needed.
export async function findKindReferenceRecordById(dataManager, kindId, id) {
  if (!dataManager || !id) return null;
  try {
    const result = await dataManager.get(kindId, id, { preferLocal: false });
    if (!result?.payload) return null;
    return { kind: kindId, id, name: result.payload.name || id, payload: result.payload };
  } catch (error) {
    return null;
  }
}

// One cached lookup per (kind, id-or-name) for the lifetime of the page —
// hovering the same chip twice (or two chips referencing the same record)
// never re-fetches. Cleared implicitly on a full page reload; this module
// has no long-lived state otherwise.
const previewRecordCache = new Map();
function loadPreviewRecord(dataManager, kindId, id, name) {
  const key = id ? `id:${kindId}:${id}` : `name:${kindId}:${String(name || "").trim().toLowerCase()}`;
  if (!previewRecordCache.has(key)) {
    const promise = id
      ? findKindReferenceRecordById(dataManager, kindId, id)
      : findKindReferenceRecord(dataManager, kindId, name);
    previewRecordCache.set(key, promise.catch(() => null));
  }
  return previewRecordCache.get(key);
}

// A short delay before showing (avoids a flash while the pointer just
// passes over a chip) and before hiding (a small gap letting the pointer
// cross from the chip onto the popover itself doesn't matter here, since
// the popover has pointer-events: none, but keeping the same delay pattern
// avoids flicker when the pointer briefly leaves and re-enters the chip).
export function attachReferencePreview(button, { kind, id, name, dataManager, kindLabel }) {
  if (!dataManager) return;
  let showTimer = 0;
  let hideTimer = 0;
  let requestToken = 0;

  async function show() {
    const token = (requestToken += 1);
    const popover = ensurePreviewPopover();
    renderPreviewLoading(popover, { name: name || id, kindLabel });
    positionPopover(popover, button.getBoundingClientRect());
    const record = await loadPreviewRecord(dataManager, kind, id, name);
    if (token !== requestToken || popover.style.display === "none") return; // superseded or already dismissed
    if (!record) {
      renderPreviewMissing(popover, { name: name || id, kindLabel });
    } else {
      renderPreviewContent(popover, {
        name: record.name || name || id,
        kindLabel,
        lines: buildIdentityLines(kind, record.payload),
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
