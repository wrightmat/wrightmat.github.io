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
// underlying list gets fetched.

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
  } else {
    placeholderOption.selected = true;
  }
}

// Renders a "pick an existing saved record, or leave this to start fresh"
// select (Sanctum's Location picker; Crucible's Monster picker, Vault's
// Effect picker, Forge's NPC picker) — unlike renderRequiredSelectOptions
// above, the leading option here is a real, always-selectable choice ("New /
// unsaved"), not a disabled placeholder: starting a brand new record is a
// perfectly valid thing to want, not a state to force the user out of.
export function renderOptionalSelectOptions(select, entries, { blankLabel = "New / unsaved", previousValue } = {}) {
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
    labelEl.className = "form-check-label small";
    labelEl.htmlFor = checkboxId;
    labelEl.textContent = name;
    row.append(input, labelEl);
    listBox.appendChild(row);
  });
}

// `toPressExportShape` is each tool's own record-shaping function (monster/
// effect/location schema) — the only genuinely tool-specific piece; the
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
