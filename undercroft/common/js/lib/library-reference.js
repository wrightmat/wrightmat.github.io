// Shared "reference a Library record inline, see its full details on
// hover/click" primitive — extracted from journal-kind-reference.js once
// other consumers (board.js, handout.js via markdown.js) needed the same
// thing without reaching across into Repository's own tree. Only what's
// genuinely markdown-specific (the code-span regex/scanning) stayed there.
//
// Every reference is resolved LAZILY — a chip renders from whatever
// {kind, id, name} it's given with no fetch, and only looks up the real
// record once the pointer actually lingers.
import { fetchKindEntrySummaries } from "./content-fetch.js";
import { el } from "./dom.js";

// Kinds that never make sense as a generic Library reference: encounter/macro
// already get richer special-cased chips in Repository's markdown pipeline,
// journal pages use [[Wiki Links]] instead, and `kind` describes kinds
// rather than being referenceable content itself.
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

// Exported for code-block-autocomplete.js's own dropdown — one lookup
// table, not two that could drift apart.
export function iconFor(kindId) {
  return KIND_ICON[kindId] || "tabler:link";
}

// Inline styles, not CSS classes — this can render inside pages (Dashboard
// widgets, Workbench's character sheet) that never load Repository's
// stylesheet. Deliberately understated (no fill, no icon, dashed outline) —
// a reference chip should read as "this links to something," not a filled
// badge competing with real content. What kind of thing it links to shows
// on hover/focus instead (buildPreviewHeader below).
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

// `id` OR `name` identify the target record; passing `id` skips the
// name-matching lookup entirely (see findKindReferenceRecordById below).
// `onOpen` fires with (kindId, id||name) when `interactive` and the chip is
// clicked — the caller decides what "open" means.
export function createReferenceChip({ kind, id, name, dataManager, interactive, onOpen, kindLabel } = {}) {
  const button = el("button", "library-reference-chip");
  button.type = "button";
  styleAsChip(button, interactive);
  button.append(el("span", null, name || id));
  button.setAttribute("aria-label", `${name || id} (${kindLabel || kind})`);
  if (interactive) {
    button.style.cursor = "pointer";
    button.addEventListener("click", () => onOpen?.(kind, id || name));
  }
  // Hover/focus preview works regardless of `interactive` — a read-only
  // render still benefits from "what IS this" on hover; navigating away is
  // the separate capability `interactive` gates. No dataManager, no preview.
  attachReferencePreview(button, { kind, id, name, dataManager, kindLabel: kindLabel || kind });
  return button;
}

// --- Hover preview popover ---------------------------------------------
// A single shared floating panel (not one per chip), showing "what IS this"
// on hover: icon/Form summary up top, Notes text below. Deliberately NOT a
// per-kind grab-bag of identity fields — those already read as part of each
// kind's own Notes/prose in practice, so this stays to two things: what
// kind of thing this is, and (Wonder only) its Form/sub-category.

// One cached {systemId -> fields[]} lookup for the page's lifetime, so a
// hovered chip's System record isn't re-fetched on every hover.
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

// A property's stored value is always a slug (matches mapping-custom-
// functions.js's slugifyPropertyValueName byte-for-byte), resolved back to
// its display name via the value's own `shortName` if a System author added
// one, else by re-slugifying `name` the same way it was stored.
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
// one field per Form (Weapon's Simple/Martial split, Armor's
// Light/Medium/Heavy/Shield split, ...). At most one is ever set on a real
// record, so the first present wins.
const SUB_CATEGORY_PROPERTY_FIELDS = {
  weaponCategory: "weaponCategories",
  armorCategory: "armorCategories",
  equipmentCategory: "equipmentCategories",
};

// "Weapon (Martial Melee)" — the record's Form with its sub-category (if
// any) in parentheses. Empty for anything without a `form` property.
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

// Every kind's own "notes/description" field, under whichever name it
// actually uses (npc's is `note`, singular; most others are `notes` or
// `description`). Species' own "description" is an ARRAY of paragraphs, not
// a plain string — joined into real markdown text here, since
// renderNotesPreview's marked.parse expects a string and silently produces
// nothing usable from an array.
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
  // Wide enough to read a full notes entry at a glance. No maxHeight/overflow
  // — the popover is pointer-events: none, so a scrollbar would be unusable;
  // NOTES_PREVIEW_MAX_CHARS below is the real safety valve instead.
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
// above the chip when below would overflow the viewport, clamped to the
// left/right edges too.
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

// Name on the left; Form/sub-category (Wonder only) and the kind icon on
// the right. The icon (aria-label, not visible text) is the one place "what
// kind of thing is this" is conveyed, since the chip itself doesn't show one.
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

// A high, effectively-never-hit safety cap — the point of this preview is
// reading the full text without opening the real record, so it should show
// everything short of something pathological.
const NOTES_PREVIEW_MAX_CHARS = 6000;

// A minimal, Journal-extension-free markdown render for the preview's notes
// text, since resolveNotes' source may carry real CommonMark
// (**bold**/*italic*/tables). Deliberately NOT markdown.js's renderMarkdown
// — that module imports journal-kind-reference.js, which imports this file,
// so importing it back here would be circular, and a chip preview has no
// use for Journal-specific extensions (wiki-links, dice/macro blocks,
// callouts) anyway. Globals checked at call time, not module load, so this
// degrades to plain text if the CDN scripts haven't loaded. `breaks: true`
// matches renderMarkdown's own setting so identical source renders
// identically in both places.
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

// Case-insensitive match against either the record's own id or display
// name — no fuzzy matching, same convention as journal-encounter.js's
// findMatch. `filter` (optional, `(summaryEntry) => boolean`) narrows the
// candidate pool BEFORE matching — for a kind like "wonder" that models more
// than one real-world concept under one name (a spell and an item can
// legitimately share a name), the caller decides what "the right kind of
// candidate" means (content-feature-matching.js's isSpellForm), not this
// generic utility.
export async function findKindReferenceRecord(dataManager, kindId, name, { filter } = {}) {
  if (!dataManager) return null;
  // fetchKindEntrySummaries, not a bulk per-record fetch — the /list
  // response's `title` is enough to find which record(s) match by name; the
  // full payload only needs fetching for those actual matches, not every
  // entry of that kind.
  //
  // `filter` runs AFTER the name match, against each candidate's FULL
  // fetched payload — never against the summary list's own `properties`
  // field. That field is a database-level cache, refreshed only on a normal
  // save, so a record whose `properties` changed any other way (a direct
  // file edit, seeded content) can carry a stale value indefinitely with no
  // resave to trigger a refresh. Usually exactly one full fetch — a genuine
  // name collision is rare.
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

// The id-based counterpart to findKindReferenceRecord — every
// {refKind, refId, name}-shaped field already has an id, so this skips the
// name-matching summary-list scan and goes straight to the record needed.
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

// One cached lookup per (kind, id-or-name) for the page's lifetime —
// hovering the same chip twice, or two chips referencing the same record,
// never re-fetches.
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

// A short delay before showing (avoids a flash on a quick pointer pass) and
// before hiding (avoids flicker if the pointer briefly leaves and re-enters).
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
    // A second await, only incurred for a Wonder with a `properties.form`
    // at all — empty string, no fetch, for every other kind.
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
