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
//
// Deliberately understated — no fill, no icon (see createReferenceChip
// below), a light dashed outline instead of a solid one — a reference
// chip is meant to read as "this word links to something," close to plain
// inline text, not a filled badge competing for attention against actual
// content. What KIND of thing it links to, and its own Form/sub-category,
// live in the hover/focus preview instead (buildPreviewHeader below), not
// repeated inline on every single chip.
function styleAsChip(button, interactive) {
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.gap = "0.25rem";
  button.style.padding = "0.05rem 0.4rem";
  button.style.border = "1px dashed var(--bs-border-color-translucent, rgba(0, 0, 0, 0.175))";
  button.style.borderRadius = "0.375rem";
  button.style.background = "transparent";
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
  // Name only, no icon — deliberately understated (see styleAsChip's own
  // comment); what kind of thing this is, and its own Form/sub-category,
  // show on hover/focus instead (buildPreviewHeader below), not repeated
  // inline on every chip.
  button.append(el("span", null, name || id));
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
// createTablePickerPopover precedent), showing "what IS this" on hover:
// the record's own icon/Form summary up top, and its Notes text below.
// Deliberately NOT a per-kind grab-bag of identity fields anymore (Forge's
// own Species/Archetype/Alignment, Crucible's own Creature Type/Archetype/
// Role, ...) — those already read as part of each kind's own Notes/prose
// in practice (a magic item's own rarity is always restated in its own
// description, same reasoning the Rarity line itself was dropped for),
// so this popover stays to two things: what kind of thing this is (icon)
// and, for a Wonder specifically, what Form/sub-category it is — its own
// System-defined generator-property data, nothing else duplicated.
// Inline-styled throughout, same cross-tool-reuse reasoning styleAsChip
// already documents.

// One cached {systemId -> fields[]} lookup for the lifetime of the page —
// same reasoning previewRecordCache below has, and the same System record
// a hovered chip's own kind Repository page would otherwise re-fetch on
// every single hover.
const systemFieldsCache = new Map();
function loadSystemFields(dataManager, systemId) {
  if (!systemId) return Promise.resolve([]);
  if (!systemFieldsCache.has(systemId)) {
    const promise = dataManager
      .get("systems", systemId, { preferLocal: true })
      .then((result) => (Array.isArray(result?.payload?.fields) ? result.payload.fields : []))
      .catch(() => []);
    systemFieldsCache.set(systemId, promise);
  }
  return systemFieldsCache.get(systemId);
}

function findFieldValues(fields, key) {
  const field = fields.find((entry) => entry?.type === "array" && entry.key === key);
  return Array.isArray(field?.values) ? field.values : [];
}

function slugifyPropertyValueName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// A property's own STORED value is always a slug (mapping-custom-
// functions.js's own slugifyPropertyValueName, matched here byte-for-
// byte) — resolved back to its real display name either via the value's
// own `shortName` (a System author can add one explicitly, e.g.
// sys.dnd5e.json's own "form" field values) or, failing that, by
// re-slugifying `name` the same way it was stored in the first place.
function resolvePropertyDisplayName(values, storedId) {
  if (!storedId) return "";
  const match = values.find((value) => {
    const shortName = String(value?.shortName || "").toLowerCase();
    if (shortName && shortName === storedId) return true;
    return slugifyPropertyValueName(value?.name) === storedId;
  });
  return match?.name || "";
}

// Which sub-category property (if any) accompanies a Wonder's own Form —
// sys.dnd5e.json's own weaponCategories/armorCategories/equipmentCategories
// fields, one per Form (a Weapon's own Simple/Martial+Melee/Ranged split,
// an Armor's own Light/Medium/Heavy/Shield split, an ordinary Equipment
// item's own Tools/Instrument/Gaming-Set/Mounts-and-Vehicles/Ammunition
// split — see mapping-custom-functions.js's own srdItemProperties). At
// most one is ever set on a real record, so the first present wins.
const SUB_CATEGORY_PROPERTY_FIELDS = {
  weaponCategory: "weaponCategories",
  armorCategory: "armorCategories",
  equipmentCategory: "equipmentCategories",
};

// "Weapon (Martial Melee)" — the record's own Form, with its sub-category
// (if any) in parentheses beside it. Empty for anything without a `form`
// property at all (every non-Wonder kind, and a Wonder whose own
// import/authoring never resolved one) — the header just shows the icon
// alone in that case, nothing invented.
async function resolveFormSummary(dataManager, record) {
  const properties = record?.properties;
  if (!properties?.form) return "";
  const systemId = Array.isArray(record?.systemIds) ? record.systemIds[0] : null;
  const fields = await loadSystemFields(dataManager, systemId);
  const formName = resolvePropertyDisplayName(findFieldValues(fields, "form"), properties.form);
  if (!formName) return "";
  const subCategoryKey = Object.keys(SUB_CATEGORY_PROPERTY_FIELDS).find((key) => properties[key]);
  if (!subCategoryKey) return formName;
  const subCategoryName = resolvePropertyDisplayName(
    findFieldValues(fields, SUB_CATEGORY_PROPERTY_FIELDS[subCategoryKey]),
    properties[subCategoryKey]
  );
  return subCategoryName ? `${formName} (${subCategoryName})` : formName;
}

// Every kind's own "notes/description" field, under whichever name that
// kind actually uses (npc's own LLM-generated character note is `note`,
// singular; everything else observed is `notes` or `description`). Species
// is the one kind whose own "description" is an ARRAY of paragraphs, not a
// plain string (ddb-species.json's own shape, matching ddb-content-parser
// .js's own descLines convention) — joined into real markdown paragraph
// text here rather than handed to renderNotesPreview's own marked.parse
// as-is, which expects a string and silently produces nothing usable from
// an array. Confirmed real, reported bug this fixes: every Species
// reference chip's hover/click preview showed just the name/kind header
// with no content at all, for every species record, not a data problem
// specific to any one of them.
export function resolveNotes(record) {
  const raw = record?.notes || record?.note || record?.description || record?.summary || "";
  return Array.isArray(raw) ? raw.filter(Boolean).join("\n\n") : raw;
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

function renderPreviewLoading(popover, { name, kind, kindLabel }) {
  popover.innerHTML = "";
  popover.appendChild(buildPreviewHeader(name, kind, kindLabel));
  const loading = el("div", null, "Loading…");
  loading.style.color = "var(--bs-secondary-color, #6c757d)";
  popover.appendChild(loading);
}

function renderPreviewMissing(popover, { name, kind, kindLabel }) {
  popover.innerHTML = "";
  popover.appendChild(buildPreviewHeader(name, kind, kindLabel));
  const missing = el("div", null, "No saved record found.");
  missing.style.color = "var(--bs-secondary-color, #6c757d)";
  popover.appendChild(missing);
}

// Name on the left; the record's own Form/sub-category (a Wonder only —
// see resolveFormSummary above, empty string for everything else) and the
// kind icon on the right, form text immediately left of the icon. The
// icon carries the kind itself now (aria-label, not visible text) — the
// chip that opened this popover no longer shows one at all (see
// styleAsChip's own comment), so this is the one place "what kind of
// thing is this" is actually conveyed.
function buildPreviewHeader(name, kind, kindLabel, formSummary = "") {
  const row = el("div", null);
  row.style.display = "flex";
  row.style.alignItems = "flex-start";
  row.style.justifyContent = "space-between";
  row.style.gap = "0.5rem";
  row.style.marginBottom = "0.35rem";
  const title = el("div", null, name);
  title.style.fontWeight = "600";
  row.appendChild(title);
  const meta = el("div", null);
  meta.style.display = "inline-flex";
  meta.style.alignItems = "center";
  meta.style.gap = "0.3rem";
  meta.style.flexShrink = "0";
  if (formSummary) {
    const form = el("span", null, formSummary);
    form.style.fontSize = "0.7rem";
    form.style.textTransform = "uppercase";
    form.style.letterSpacing = "0.03em";
    form.style.color = "var(--bs-secondary-color, #6c757d)";
    meta.appendChild(form);
  }
  const icon = el("span", "iconify");
  icon.dataset.icon = iconFor(kind);
  icon.setAttribute("aria-label", kindLabel || kind);
  icon.style.color = "var(--bs-secondary-color, #6c757d)";
  icon.style.fontSize = "0.9rem";
  meta.appendChild(icon);
  row.appendChild(meta);
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

function renderPreviewContent(popover, { name, kind, kindLabel, formSummary, notes }) {
  popover.innerHTML = "";
  popover.appendChild(buildPreviewHeader(name, kind, kindLabel, formSummary));
  if (notes) {
    const notesEl = renderNotesPreview(notes.length > NOTES_PREVIEW_MAX_CHARS ? `${notes.slice(0, NOTES_PREVIEW_MAX_CHARS).trim()}…` : notes);
    notesEl.style.color = "var(--bs-secondary-color, #6c757d)";
    popover.appendChild(notesEl);
  } else {
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
  // response's own `title` field is enough to find WHICH record(s) match by
  // name; the full payload only needs fetching for those actual name
  // match(es), not every entry of that kind. Confirmed real fix: a kind with
  // hundreds/thousands of saved entries (wonder, feature) made every
  // reference chip's click/hover cost that many individual record fetches
  // just to resolve one name.
  //
  // `filter` runs AFTER the name match, against each candidate's own FULL
  // fetched payload — never against the summary list's own `properties`
  // field. That field is a database-level cache (server/storage.py's own
  // metadataFields), refreshed only when a record is re-saved through the
  // normal save path — a record whose `properties` was set or changed any
  // OTHER way (a direct file edit, a bulk data patch, content seeded
  // outside Loom) can carry a stale or missing cached value indefinitely
  // with no resave to trigger a refresh. Confirmed real, reported bug this
  // fixes: EVERY character's spell references failed to link — isSpellForm's
  // own filter always saw an empty `properties` on the summary, the real
  // Wonder record's own correctly-set `properties.form: "spell"`
  // notwithstanding. Usually exactly one full fetch (a genuine name
  // collision — e.g. the "Shield" spell vs a piece of Shield armor — is
  // rare), never worse than the old design's own single always-fetched
  // match.
  const summaries = await fetchKindEntrySummaries(dataManager, kindId).catch(() => []);
  const normalized = String(name || "").trim().toLowerCase();
  const nameMatches = summaries.filter(
    (entry) => String(entry.id).toLowerCase() === normalized || entry.name.trim().toLowerCase() === normalized
  );
  for (const candidate of nameMatches) {
    let payload;
    try {
      const result = await dataManager.get(kindId, candidate.id, { preferLocal: false });
      payload = result?.payload || {};
    } catch (error) {
      continue; // try the next name-match candidate, if any
    }
    if (typeof filter === "function" && !filter(payload)) continue;
    return { kind: kindId, id: candidate.id, name: candidate.name, payload };
  }
  return null;
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
    renderPreviewLoading(popover, { name: name || id, kind, kindLabel });
    positionPopover(popover, button.getBoundingClientRect());
    const record = await loadPreviewRecord(dataManager, kind, id, name);
    if (token !== requestToken || popover.style.display === "none") return; // superseded or already dismissed
    if (!record) {
      renderPreviewMissing(popover, { name: name || id, kind, kindLabel });
      positionPopover(popover, button.getBoundingClientRect());
      return;
    }
    // Needs the record's own systemIds first (resolveFormSummary reads the
    // Wonder's own Form/sub-category off the ACTUAL System it's assigned
    // to, never a hardcoded one) — a second await, only ever incurred for
    // a Wonder with a `properties.form` at all (empty string, no fetch,
    // for every other kind).
    const formSummary = await resolveFormSummary(dataManager, record.payload);
    if (token !== requestToken || popover.style.display === "none") return; // superseded or dismissed mid-fetch
    renderPreviewContent(popover, {
      name: record.name || name || id,
      kind,
      kindLabel,
      formSummary,
      notes: resolveNotes(record.payload),
    });
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
