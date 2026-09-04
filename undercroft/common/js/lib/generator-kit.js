// Shared plumbing for Crucible/Vault/Sanctum's near-identical "generate a
// record from Library reference data, then save/export/note it" flow. Forge
// mostly doesn't participate (no feature/recipe concept), except
// renderRequiredSelectOptions/renderOptionalSelectOptions and
// setGenerateButtonReadiness below, which Forge shares too since those are
// about rendering conventions, not the generate/save/export/note flow itself.
// Each function takes whatever per-tool state it needs explicitly rather than
// closing over module-level state, so one copy works for all callers.

import { setDisabledTooltip, disposeTooltips, refreshTooltips } from "./tooltips.js";
import { resolveFieldRole } from "./field-roles.js";

export async function listAllSystems(dataManager) {
  if (!dataManager) return [];
  try {
    const listing = await dataManager.list("systems");
    const entries = dataManager.collectListEntries(listing.remote, ["items", "owned", "shared", "public"]);
    return entries
      .map((entry) => ({ id: entry.id, title: entry.title || entry.id }))
      .sort((a, b) => a.title.localeCompare(b.title));
  } catch (error) {
    return [];
  }
}

// Renders a "you must pick one of these before anything else works" select
// (System, today) — a disabled placeholder first, so the browser never
// silently defaults to whichever entry sorts first. `entries` need an `id`
// and either a `title` or a `name`. Once a real entry is chosen the
// placeholder can't be reselected (it's `disabled`, not just blank).
export function renderRequiredSelectOptions(select, entries, { placeholder = "Select…", previousValue } = {}) {
  if (!select) return;
  const previous = previousValue !== undefined ? previousValue : select.value;
  select.innerHTML = "";
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  placeholderOption.disabled = true;
  select.appendChild(placeholderOption);
  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.title || entry.name || entry.id;
    select.appendChild(option);
  });
  if (entries.some((entry) => entry.id === previous)) {
    select.value = previous;
  } else if (entries.length === 1) {
    // The placeholder is disabled — never a valid resting state for a
    // required field — so with exactly one real choice, land on it directly.
    // Always on, unlike renderOptionalSelectOptions's opt-in equivalent
    // below, since a required field's blank state is never legitimate.
    select.value = entries[0].id;
  } else {
    placeholderOption.selected = true;
  }
}

// Renders a "pick an existing saved record, or leave this to start fresh"
// select — unlike renderRequiredSelectOptions above, the leading option is a
// real, always-selectable "New / unsaved" choice, not a disabled placeholder.
// `autoSelectSingle` (opt-in, default off): blank is a genuinely valid
// resting state at every call site of this function, so auto-landing on a
// sole option isn't safe as a blanket default the way it is for the required
// picker — it would silently reopen a saved record instead of starting
// fresh. Forge's Location picker opts in: its own blank state is a real
// fallback choice, but landing on the only real Location gives a more
// specific NPC with nothing lost.
export function renderOptionalSelectOptions(select, entries, { blankLabel = "New / unsaved", previousValue, autoSelectSingle = false } = {}) {
  if (!select) return;
  const previous = previousValue !== undefined ? previousValue : select.value;
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = blankLabel;
  select.appendChild(blank);
  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.title || entry.name || entry.id;
    select.appendChild(option);
  });
  if (entries.some((entry) => entry.id === previous)) {
    select.value = previous;
  } else if (autoSelectSingle && entries.length === 1) {
    select.value = entries[0].id;
  }
}

export function findById(list, id) {
  return list.find((entry) => entry.id === id) || null;
}

export function featureLabel(features, id) {
  const feature = findById(features, id);
  return feature ? feature.name || feature.id : id;
}

// `container` is the element createSearchableCheckList's `dataAttr` marks —
// the search input + scrollable checkbox list it wraps, not a bare
// `<select multiple>` (retired suite-wide in favor of this shape).
export function readLockedFeatureIds(container) {
  if (!container) return [];
  const listBox = container.querySelector("[data-checklist-options]");
  if (!listBox) return [];
  return Array.from(listBox.querySelectorAll("input[type=checkbox]:checked")).map((input) => input.value);
}

// Rebuilds a createSearchableCheckList's checkbox rows from `features`,
// preserving whichever were already checked and re-applying any typed search.
export function populateLockedFeaturesCheckList(container, features) {
  if (!container) return;
  const listBox = container.querySelector("[data-checklist-options]");
  if (!listBox) return;
  const searchInput = container.querySelector("[data-checklist-search]");
  const previouslyChecked = new Set(
    Array.from(listBox.querySelectorAll("input[type=checkbox]:checked")).map((input) => input.value)
  );
  const query = (searchInput?.value || "").trim().toLowerCase();
  disposeTooltips(listBox);
  listBox.innerHTML = "";
  features.forEach((feature) => {
    const name = feature.name || feature.id;
    const searchLabel = name.toLowerCase();
    const row = document.createElement("div");
    row.className = "form-check mb-0";
    row.dataset.searchLabel = searchLabel;
    if (query && !searchLabel.includes(query)) row.classList.add("d-none");
    const checkboxId = `checklist-${feature.id}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = checkboxId;
    input.value = feature.id;
    input.checked = previouslyChecked.has(feature.id);
    const labelEl = document.createElement("label");
    // d-block — a bare <label> is inline by default, so text-truncate has no
    // block width to clip against without it. Tooltip carries the full name.
    labelEl.className = "form-check-label small text-truncate d-block";
    labelEl.htmlFor = checkboxId;
    labelEl.textContent = name;
    labelEl.setAttribute("data-bs-toggle", "tooltip");
    labelEl.setAttribute("data-bs-title", name);
    row.append(input, labelEl);
    listBox.appendChild(row);
  });
  refreshTooltips(listBox);
}

// Same rebuild as populateLockedFeaturesCheckList above, generalized from a
// Library-feature id/name list to a plain string vocabulary (a System's tag
// words). readLockedFeatureIds above works unchanged for this shape too.
//
// `items` is either a plain string array (value === label) or a
// `{value, label}` array (when the stored value and display label differ,
// e.g. a Role's lowercase id vs its display name). `selected` is passed
// explicitly rather than inferred from the DOM, since the DOM can't
// disambiguate the previous entity's checked state from this one's. Checked
// items sort to the top so a Feature's existing tags are visible immediately.
export function populateStringChecklist(container, items, selected) {
  if (!container) return;
  const listBox = container.querySelector("[data-checklist-options]");
  if (!listBox) return;
  const searchInput = container.querySelector("[data-checklist-search]");
  const selectedSet = new Set(selected || []);
  const query = (searchInput?.value || "").trim().toLowerCase();
  const normalized = items.map((item) => (typeof item === "string" ? { value: item, label: item } : item));
  const ordered = normalized.slice().sort((a, b) => {
    const aChecked = selectedSet.has(a.value);
    const bChecked = selectedSet.has(b.value);
    if (aChecked !== bChecked) return aChecked ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  disposeTooltips(listBox);
  listBox.innerHTML = "";
  ordered.forEach(({ value, label }) => {
    const searchLabel = label.toLowerCase();
    const row = document.createElement("div");
    row.className = "form-check mb-0";
    row.dataset.searchLabel = searchLabel;
    if (query && !searchLabel.includes(query)) row.classList.add("d-none");
    const checkboxId = `checklist-${value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.id = checkboxId;
    input.value = value;
    input.checked = selectedSet.has(value);
    const labelEl = document.createElement("label");
    // Same d-block fix as populateLockedFeaturesCheckList above.
    labelEl.className = "form-check-label small text-truncate d-block";
    labelEl.htmlFor = checkboxId;
    labelEl.textContent = label;
    labelEl.setAttribute("data-bs-toggle", "tooltip");
    labelEl.setAttribute("data-bs-title", label);
    row.append(input, labelEl);
    listBox.appendChild(row);
  });
  refreshTooltips(listBox);
}

// `toPressExportShape` is each tool's own record-shaping function — the only
// tool-specific piece; the Blob/anchor/download mechanics are shared.
export function exportRecordAsJson(record, toPressExportShape) {
  const shaped = toPressExportShape(record);
  const blob = new Blob([JSON.stringify(shaped, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${shaped.name || shaped.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// The "generate a note via LLM" flow (spinner swap, call the endpoint, write
// name/notes back, restore the button) is identical across Crucible/Vault/
// Sanctum — only the request body differs, so callers provide it as a
// closure. `record` is mutated in place since callers hold the same
// reference and expect it updated directly.
//
// Forge doesn't use this — its NPCs already have a rolled name, so its note
// flow is a genuinely different shape, not just a different request body.
export async function generateNoteForRecord({ record, elements, status, generateNote, buildRequestBody }) {
  if (!record) return false;
  record.name = elements.nameInput?.value || "";
  const originalHtml = elements.generateNoteButton?.innerHTML;
  if (elements.generateNoteButton) {
    elements.generateNoteButton.disabled = true;
    elements.generateNoteButton.innerHTML =
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Generating…';
  }
  try {
    const { name, note } = await generateNote(buildRequestBody(record));
    record.name = name;
    record.notes = note;
    if (elements.nameInput) elements.nameInput.value = name;
    if (elements.notesText) elements.notesText.value = note;
    status?.show("Note generated.", { type: "success", timeout: 1500 });
    return true;
  } catch (error) {
    status?.show(`Unable to generate note: ${error.message}`, { type: "error", timeout: 5000 });
    return false;
  } finally {
    if (elements.generateNoteButton) {
      elements.generateNoteButton.disabled = false;
      elements.generateNoteButton.innerHTML = originalHtml;
    }
  }
}

// Proactive "insufficient reference data" state for a Generate button
// (Forge/Sanctum/Crucible/Vault), run wherever the button's enabled state
// already gets recomputed rather than reactively inside the click handler.
// Thin, Generate-specific name over tooltips.js's canonical setDisabledTooltip.
export function setGenerateButtonReadiness(button, reason) {
  setDisabledTooltip(button, reason);
}

// The active System's ability/stat-block object field's children (key +
// shortName) — shared by Crucible, Forge, and Vault's ability selects rather
// than each carrying its own copy. Falls back to the standard six-ability
// D&D set if the System defines no matching field.
const DEFAULT_ABILITY_FIELD_DEFS = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

// Which object field IS the ability/stat block is the System's own explicit
// `fieldRoles` declaration (role "abilityScores") — see field-roles.js.
export async function loadAbilityFieldDefs(dataManager, systemId) {
  if (!dataManager || !systemId) return DEFAULT_ABILITY_FIELD_DEFS;
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const field = resolveFieldRole(result?.payload, "abilityScores")?.fieldDef;
    const fieldKey = field?.key || "";
    const defs = (field?.children || [])
      .map((child) => {
        const raw = String(child.key || "");
        return {
          key: raw.startsWith(`${fieldKey}.`) ? raw.slice(fieldKey.length + 1) : raw,
          // Full name preferred over the abbreviation whenever declared.
          label: child.label || child.shortName || "",
          // Carried separately from `label` — Workbench's Build Character
          // wizard needs the short form specifically (matching a
          // background's short-code candidates), not whichever text `label`
          // displays.
          shortName: child.shortName || "",
          // When authored, lets Forge's independent-roll fallback roll a
          // characteristic directly (e.g. CoC's 15-90 range) instead of only
          // ever coming from an Archetype entry.
          ...(typeof child.minimum === "number" && typeof child.maximum === "number"
            ? { minimum: child.minimum, maximum: child.maximum }
            : {}),
        };
      })
      .filter((entry) => entry.key && entry.label);
    return defs.length ? defs : DEFAULT_ABILITY_FIELD_DEFS;
  } catch (error) {
    return DEFAULT_ABILITY_FIELD_DEFS;
  }
}

// Raw `values` of a single named array-type System field — a generic
// lookup, not skills-specific. Empty for a System with no field by that key,
// same graceful-degradation convention every loader in this file follows.
export async function loadArrayFieldValues(dataManager, systemId, key) {
  if (!dataManager || !systemId || !key) return [];
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const field = fields.find((entry) => entry.type === "array" && entry.key === key);
    return Array.isArray(field?.values) ? field.values : [];
  } catch (error) {
    return [];
  }
}
