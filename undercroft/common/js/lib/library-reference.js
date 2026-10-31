// Shared "reference a Library record inline, see its full details on
// click" primitive — extracted from journal-kind-reference.js once
// other consumers (board.js, handout.js via markdown.js) needed the same
// thing without reaching across into Repository's own tree. Only what's
// genuinely markdown-specific (the code-span regex/scanning) stayed there.
//
// Every reference is resolved LAZILY — a chip renders from whatever
// {kind, id, name} it's given with no fetch, and only looks up the real
// record once the pointer actually lingers.
import { fetchChatBacklinks, renderChatBacklinkList } from "./chat/backlinks.js";
import { fetchKindEntrySummaries } from "./content-fetch.js";
import { el } from "./dom.js";
import { initTooltip } from "./tooltips.js";

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

// Shared look: shell.css's .inline-ref (an underline in the kind's own color, so the text keeps the surrounding style).
function styleAsChip(button) {
  button.classList.add("inline-ref", "inline-ref--library");
}

// `id` OR `name` identify the target record; passing `id` skips the
// name-matching lookup entirely (see findKindReferenceRecordById below).
// `onOpen` fires with (kindId, id||name) when `interactive` and the chip is
// clicked — the caller decides what "open" means.
export function createReferenceChip({ kind, id, name, dataManager, interactive, onOpen, kindLabel } = {}) {
  const button = el("button", "library-reference-chip");
  button.type = "button";
  styleAsChip(button);
  button.append(el("span", null, name || id));
  button.setAttribute("aria-label", `${name || id} (${kindLabel || kind})`);
  button.addEventListener("click", () => {
    if (interactive && onOpen) {
      onOpen(kind, id || name);
    } else {
      void openReferenceModal({ kind, id, name, dataManager, kindLabel: kindLabel || kind });
    }
  });
  if (dataManager) initTooltip(button, { title: "Click to view details" });
  return button;
}

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

// The whole record in a scrollable modal, opened by clicking a reference chip. Built and torn down per call (like
// image-modal.js), and rendered with a lightweight Markdown pass.
export async function openReferenceModal({ kind, id, name, dataManager, kindLabel } = {}) {
  if (!dataManager || !window.bootstrap || typeof window.bootstrap.Modal !== "function") return;
  const overlay = document.createElement("div");
  overlay.className = "modal fade";
  overlay.tabIndex = -1;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
      <div class="modal-content" style="max-height: 80vh;">
        <div class="modal-header">
          <h2 class="modal-title fs-5"></h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body"></div>
      </div>
    </div>
  `;
  overlay.querySelector(".modal-title").textContent = name || id || "";
  const body = overlay.querySelector(".modal-body");
  body.textContent = "Loading…";
  document.body.appendChild(overlay);
  const instance = window.bootstrap.Modal.getOrCreateInstance(overlay);
  overlay.addEventListener("hidden.bs.modal", () => {
    instance.dispose();
    overlay.remove();
  });
  instance.show();
  const record = await loadPreviewRecord(dataManager, kind, id, name);
  if (!record) {
    body.textContent = "No saved record found.";
    return;
  }
  overlay.querySelector(".modal-title").textContent = record.name || name || id || "";
  const formSummary = await resolveFormSummary(dataManager, record.payload);
  body.textContent = "";
  if (formSummary) {
    const form = el("div", "text-body-secondary small text-uppercase mb-2", formSummary);
    body.appendChild(form);
  }
  const notes = resolveNotes(record.payload);
  body.appendChild(notes ? renderNotesPreview(notes) : el("div", "text-body-secondary", "No additional details."));
  const mentions = await fetchChatBacklinks(dataManager, kind, record.id || id).catch(() => []);
  if (mentions.length) {
    body.append(el("div", "fw-semibold mt-3", "Mentioned in chat"), renderChatBacklinkList(mentions, { limit: 10, interactive: false }));
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
// opening the same chip twice, or two chips referencing the same record,
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

