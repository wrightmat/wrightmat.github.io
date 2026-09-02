// Shared plumbing for Crucible/Vault/Sanctum's near-identical "generate a
// record from Library reference data, then save/export/note it" one-shot
// flow — Forge doesn't participate in most of this (no feature/recipe
// concept, and its own listAllSystems merges in dataManager.listBuiltins()
// for a legacy-builtin-Location case none of these three have, so it stays a
// local function there rather than being forced into this shared shape).
// Each function here takes whatever per-tool state it needs explicitly (a
// list, a DOM element, an export-shaping function) instead of closing over
// module-level state, so one shared copy works for all three tools' own
// module-scoped variables.
//
// renderRequiredSelectOptions/renderOptionalSelectOptions below are the one
// exception — Forge uses those two too, since they're about rendering a
// <select>'s options a specific, now suite-wide way, not about how the
// underlying list gets fetched. setGenerateButtonReadiness further below is
// the same kind of exception — Forge's Generate NPC button needs the exact
// same disabled-but-hoverable mechanism as Crucible/Sanctum/Vault's own
// Generate buttons, even though Forge doesn't share the rest of this file's
// generate/save/export/note flow.

import { setDisabledTooltip, disposeTooltips, refreshTooltips } from "./tooltips.js";

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
// (System, today; any future required picker) — a disabled placeholder first
// so the browser never silently defaults to whichever entry happens to sort
// first (the bug this replaced: every tool used to auto-select the
// alphabetically-first System, e.g. "Blades in the Dark", with no
// indication that was even a default rather than a deliberate choice).
// `entries` need an `id` and either a `title` or a `name`. Once a real entry
// is chosen the placeholder can't be reselected (it's `disabled`, not just
// blank) — the caller only ever gets back to "nothing chosen" by this
// function being called again with no matching `previousValue`.
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
    // required field — so when there's exactly one real choice, there's
    // nothing left to decide; land on it directly instead of making the
    // user click the one option that was always going to be picked anyway.
    // Always on (no opt-in) since this holds for every current caller
    // (System everywhere, Setting in Forge) and any future required
    // picker built on this same primitive — unlike
    // renderOptionalSelectOptions's own equivalent below, a required
    // field's blank state was never a legitimate choice to preserve.
    select.value = entries[0].id;
  } else {
    placeholderOption.selected = true;
  }
}

// Renders a "pick an existing saved record, or leave this to start fresh"
// select (Sanctum's Location picker; Crucible's Monster picker, Vault's
// Wonder picker, Forge's NPC picker) — unlike renderRequiredSelectOptions
// above, the leading option here is a real, always-selectable choice ("New /
// unsaved"), not a disabled placeholder: starting a brand new record is a
// perfectly valid thing to want, not a state to force the user out of.
// `autoSelectSingle` (opt-in, default off) — unlike renderRequiredSelectOptions
// above, blank is a genuinely valid resting state at every existing call site
// of this function (Sanctum's Setting/Location, Crucible's Monster picker,
// Vault's Wonder picker, Forge's own NPC picker all mean "start fresh" when
// blank, not "nothing chosen yet"), so auto-landing on a sole option isn't
// safe as a blanket default the way it is for the required picker — it would
// silently reopen a saved record instead of the fresh one a tool opens on by
// default. Forge's Location picker is the one caller that opts in: its own
// blank state ("No Location") is a real fallback-to-Setting-level-weights
// choice, but landing on the only real Location when one exists gives a more
// specific NPC (its own narrower species mix) with nothing lost, so this
// caller wants the same "nothing left to decide" behavior a required field
// gets automatically.
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

// `container` is the element createSearchableCheckList's `dataAttr` marks
// (e.g. `[data-locked-features]`) — the search input + scrollable checkbox
// list it wraps, not a bare `<select multiple>` (that shape was retired
// suite-wide in favor of this one; see ui-components.js's own comment on
// createSearchableCheckList for why).
export function readLockedFeatureIds(container) {
  if (!container) return [];
  const listBox = container.querySelector("[data-checklist-options]");
  if (!listBox) return [];
  return Array.from(listBox.querySelectorAll("input[type=checkbox]:checked")).map((input) => input.value);
}

// Rebuilds a createSearchableCheckList's checkbox rows from `features`,
// preserving whichever were already checked and re-applying whatever search
// query is already typed into the box — the checkbox-list equivalent of the
// old `populateLockedFeaturesSelect` each of Crucible/Vault/Sanctum used to
// hand-roll identically for a `<select multiple>`.
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
    // d-block — a bare <label> is inline by default, which lets a long name
    // just overflow the row instead of wrapping OR truncating; text-truncate
    // (overflow:hidden/ellipsis/nowrap) only actually clips once the element
    // has a real block-level width to clip against. title carries the full
    // name for hover, since the visible text may now be cut off.
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
// Library-feature id/name list to a plain string vocabulary (a System's own
// tag words — behaviors/roles/creatureTypes/recipeSlots) — Loom's structured
// Feature tag editor (Workstream E) uses this for all four of a Feature's
// own `tags.*` arrays. readLockedFeatureIds above already works unchanged
// for this shape too (it just reads checked checkbox `.value`s either way).
//
// `items` is either a plain string array (value === label, the common case
// for a self-descriptive word like "damage"/"control") or a `{value, label}`
// array (needed whenever the stored value and the human-readable label
// genuinely differ — e.g. a Role/Creature Type's own lowercase id vs its
// display name). `selected` is the caller's own authoritative list of
// currently-checked values, passed explicitly rather than inferred from
// whatever's already checked in the DOM — inferring from the DOM conflates
// "the previous entity's checked state" with "this entity's own", and can't
// know which of `items` should start checked on a fresh render. Checked
// items sort to the top (each group alphabetical by label) so a Feature's
// existing tags are immediately visible without scrolling/searching.
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
    // Same d-block/text-truncate/title fix as populateLockedFeaturesCheckList
    // above — see that function's own comment for why plain text-truncate
    // alone doesn't clip a bare (inline) <label>.
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

// `toPressExportShape` is each tool's own record-shaping function (monster/
// wonder/location schema) — the only genuinely tool-specific piece; the
// Blob/anchor/download mechanics around it are what were actually duplicated.
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

// The "generate a note via LLM" flow (spinner swap, call the tool's own
// generate-note endpoint, write name/notes back onto the record and its
// inputs, restore the button) is identical across Crucible/Vault/Sanctum —
// only the request body sent to the LLM genuinely differs per tool, so
// that's the one thing callers provide as a closure. `record` is mutated in
// place (record.name/record.notes) rather than returned, since callers hold
// their own reference to the same object and expect it updated directly,
// matching what each tool's local version already did.
//
// Forge doesn't use this: its own note flow doesn't suggest/overwrite a
// name (Forge's NPCs already have a rolled name), it's a genuinely different
// shape, not just a different request body.
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
// (Forge/Sanctum/Crucible/Vault all have one). Previously each tool started
// its Generate button real-`disabled` and only found out reference data was
// insufficient reactively, inside the click handler, throwing a toast after
// the click. This makes that check run wherever the button's enabled state
// already gets recomputed (System/Setting/Location change, reference-data
// load) and disables it proactively instead, with a tooltip explaining why.
//
// Thin, Generate-specific name over tooltips.js's own canonical
// setDisabledTooltip (the disabled-but-hoverable wrapper mechanism itself
// lives there now, alongside every other tooltip primitive in the suite —
// see that module's header for the full system). Kept as its own export
// rather than inlining the call at every one of the four Generate buttons'
// own call sites purely for the more legible name at each of those sites.
export function setGenerateButtonReadiness(button, reason) {
  setDisabledTooltip(button, reason);
}

// The active System's own ability/stat-block object field's children (key +
// shortName) — read here instead of every caller carrying its own copy.
// Previously duplicated verbatim between Crucible's and Forge's own
// lib/tables.js (both re-export from here now, unchanged call sites);
// Vault imports it directly for its own feature-params-editor ability
// select (see vault/js/app.js). Not one of the three-tool "generate/save/
// export/note" flow functions above (this module's own header comment) —
// it's a narrower, independently reusable helper any tool reading System
// ability data needs, which is why Forge already had its own copy too.
// Falls back to the standard six-ability D&D set if the System defines no
// matching field, so a System with none authored yet still works.
const DEFAULT_ABILITY_FIELD_DEFS = [
  { key: "strength", label: "STR" },
  { key: "dexterity", label: "DEX" },
  { key: "constitution", label: "CON" },
  { key: "intelligence", label: "INT" },
  { key: "wisdom", label: "WIS" },
  { key: "charisma", label: "CHA" },
];

// Best-effort guess for which object field IS the ability/stat block, used
// only to pre-fill the abilityField settings preference below when a GM
// hasn't explicitly chosen one yet for this System — never the sole source
// of truth (see feedback_settings_preference_with_guessed_default). Shape-
// detects an object field whose children are uniformly number-typed (the
// actual stat-block shape — a field like "hitPoints" with {current, max}
// children wouldn't qualify), preferring one of the conventional names below
// when more than one candidate happens to qualify.
const ABILITY_FIELD_NAME_PREFERENCE = ["abilities", "characteristics", "attributes", "stats"];

function isStatBlockShaped(field) {
  return (
    field?.type === "object" &&
    Array.isArray(field.children) &&
    field.children.length > 0 &&
    field.children.every((child) => child.type === "number")
  );
}

export function guessAbilityFieldKey(fields) {
  const candidates = (Array.isArray(fields) ? fields : []).filter(isStatBlockShaped);
  if (!candidates.length) return "";
  const preferred = ABILITY_FIELD_NAME_PREFERENCE.map((name) => candidates.find((field) => field.key === name)).find(Boolean);
  return (preferred || candidates[0]).key;
}

// Every top-level object-type field the active System defines — the
// candidate list for the abilityField settings preference below. An
// ability/stat block is always authored as an object field (e.g.
// sys.dnd5e's "abilities" — {strength, dexterity, ...}, sys.coc7e's
// "characteristics"), unlike Combat Scaling/Archetype/Budget Ceiling, which
// are always array fields (see listArrayFieldOptions in Forge's/Crucible's
// own lib/tables.js) — a separate list, not a shared one. `guessedKey`
// (guessAbilityFieldKey's own result, computed here in the same fetch
// rather than a second round trip) rides along so the settings dropdown can
// pre-select it and label it as auto-detected, instead of the field list
// alone.
export async function listObjectFieldOptions(dataManager, systemId) {
  if (!dataManager || !systemId) return { options: [], guessedKey: "" };
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const options = fields.filter((entry) => entry.type === "object").map((entry) => ({ key: entry.key, label: entry.label || entry.key }));
    return { options, guessedKey: guessAbilityFieldKey(fields) };
  } catch (error) {
    return { options: [], guessedKey: "" };
  }
}

// `preferredKey` — the GM's own configured ability-field preference (each
// tool's own per-System settings bucket, mirroring archetypeField/
// combatScalingField/budgetCeilingField exactly). Falls back to
// guessAbilityFieldKey's own shape-based guess, then the literal
// "abilities" key (the pre-existing hardcoded assumption, kept as the very
// last resort for a System with no better candidate at all) — never
// hardcoded as the only option, since a System like CoC authors its stat
// block under a completely different key ("characteristics").
export async function loadAbilityFieldDefs(dataManager, systemId, preferredKey = "") {
  if (!dataManager || !systemId) return DEFAULT_ABILITY_FIELD_DEFS;
  try {
    const result = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(result?.payload?.fields) ? result.payload.fields : [];
    const key = preferredKey || guessAbilityFieldKey(fields) || "abilities";
    const field = fields.find((entry) => entry.type === "object" && entry.key === key);
    const defs = (field?.children || [])
      .map((child) => {
        const raw = String(child.key || "");
        return {
          key: raw.startsWith(`${key}.`) ? raw.slice(key.length + 1) : raw,
          // Full name preferred over the abbreviation whenever the System
          // declares one — "Strength," not "STR," same for every System,
          // not just the ones that happen to only have a short form.
          label: child.label || child.shortName || "",
          // The abbreviation itself, carried through SEPARATELY (not just
          // folded into `label`'s own fallback above) — some consumers
          // (Workbench's Build Character wizard matching a D&D background's
          // own short-code `ability_scores` candidates) need the short form
          // specifically, not whichever text `label` prefers to display.
          shortName: child.shortName || "",
          // Carried through (when authored) for Forge's own independent-roll
          // fallback (loadIndependentStatRanges in forge/js/lib/tables.js) —
          // a System whose ability children define a real range (e.g.
          // sys.coc7e.json's characteristics, 15-90) can have them rolled
          // directly instead of only ever coming from an Archetype entry.
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

// Raw `values` of a single named array-type System field (e.g. sys.dnd5e's
// own "skills" list — {name, ability, sourceId} entries) — a generic
// lookup, not a skills-specific one, since nothing here depends on what the
// entries look like. Empty for a System with no field by that key (a
// System with no Skills concept at all, e.g. Blades in the Dark), same
// graceful-degradation convention every other loader in this file follows.
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
