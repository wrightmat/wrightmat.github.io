// Shared tags/conditions editing UI — badges, an "add a tag" input+datalist
// row, and the vocabulary lookup behind both. Originally combat-tracker.js's
// own private renderTagBadges/renderTagDatalist/deriveConditionsPropertyType,
// factored out here so character-sheet.js can use the exact same UI for a
// character's own tags-role binding instead of a second, hand-copied version
// — every function below is a pure operation on whatever list/vocabulary the
// caller passes in (an `onAdd`/`onRemove` callback instead of a hardcoded
// combatant/character shape), so neither caller's own state model leaks in
// here.
import { findBindingByRole } from "../bindings.js";
import { el } from "../dom.js";

// The tags-role binding's own `sourceField` names which other array field on
// a System supplies the tag vocabulary (default "conditions") — a generic
// "where do the valid options come from" pointer (see loom/js/app.js's
// VALUE_COLUMNS), not specific to combat bindings.
export function deriveConditionsVocabulary(fields, bindings) {
  if (!fields) return null;
  const tagsEntry = findBindingByRole(bindings, "tags");
  const vocabularyKey = tagsEntry?.sourceField || "conditions";
  const field = fields.find((entry) => entry.type === "array" && entry.key === vocabularyKey);
  if (!field) return null;
  return (field.values || []).map((value, index) => ({
    id: value.id || value.name || `condition-${index}`,
    label: value.name || value.label || String(value.id || index),
  }));
}

export function conditionLabel(vocabulary, id) {
  return vocabulary?.find((entry) => entry.id === id)?.label || id;
}

// `removable` shows a per-badge remove button, calling `onRemove(value)` —
// the caller decides what removing a tag actually does (mutate a combatant's
// conditions + write through, vs. setAtBinding on a character record).
// `isLocked(value)` (optional) withholds the remove button for individual
// tags a caller doesn't want removable right now — e.g. Repository's own
// group: tag inherited from a page's parent, locked for as long as the
// parent still carries it. Omitted by every other caller, so `removable`
// alone still governs every badge exactly as before.
export function renderTagBadges(list, vocabulary, { removable = false, onRemove, isLocked } = {}) {
  const wrap = el("div", "d-flex flex-wrap gap-1");
  const values = list || [];
  if (!values.length) {
    wrap.appendChild(el("span", "text-body-secondary small", "—"));
    return wrap;
  }
  values.forEach((value) => {
    const label = conditionLabel(vocabulary, value);
    const badge = el("span", "badge text-bg-secondary d-inline-flex align-items-center gap-1", label);
    if (removable && !(typeof isLocked === "function" && isLocked(value))) {
      const removeBtn = el("button", "btn-close btn-close-white");
      removeBtn.type = "button";
      removeBtn.style.fontSize = "0.55rem";
      removeBtn.setAttribute("aria-label", `Remove ${label}`);
      removeBtn.addEventListener("click", () => onRemove?.(value));
      badge.appendChild(removeBtn);
    }
    wrap.appendChild(badge);
  });
  return wrap;
}

// One global datalist element per `datalistId` (appended to <body>, same
// singleton-by-id idiom as spotlight.js/share-modal.js's own modals) — pass a
// distinct id per caller (combat-tracker.js and character-sheet.js each use
// their own) so two tag inputs mounted at once on the same Dashboard don't
// fight over one shared list of suggestions.
export function renderTagDatalist(datalistId, vocabulary) {
  let datalist = document.getElementById(datalistId);
  if (!datalist) {
    datalist = document.createElement("datalist");
    datalist.id = datalistId;
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = "";
  (vocabulary || []).forEach((condition) => {
    const option = document.createElement("option");
    option.value = condition.label;
    datalist.appendChild(option);
  });
}

// The "add a tag" row itself (text input + datalist + Add button, Enter-to-
// commit) — calls `onAdd(trimmedValue)` and clears the input, leaving what
// "adding" means (mutate + markDirty + write-through, vs. setAtBinding) up to
// the caller.
export function buildTagInputRow(datalistId, { placeholder = "Add a tag…", onAdd } = {}) {
  const row = el("div", "d-flex gap-1");
  const input = el("input", "form-control form-control-sm");
  input.placeholder = placeholder;
  input.setAttribute("list", datalistId);
  const commit = () => {
    const value = input.value.trim();
    if (!value) return;
    onAdd?.(value);
    input.value = "";
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });
  const addButton = el("button", "btn btn-outline-secondary btn-sm", "Add");
  addButton.type = "button";
  addButton.addEventListener("click", commit);
  row.append(input, addButton);
  return row;
}
