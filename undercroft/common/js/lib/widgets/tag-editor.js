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
// alone still governs every badge exactly as before. `isHidden(value)`
// (optional) marks a tag with a small eye-off icon — this is purely an
// informational cue about a tag's own hiddenTags membership (see
// buildTagInputRow's own visibility toggle and map-viewer.js's
// resolveMarkerConditionIcons), so a GM can tell at a glance which of their
// tags don't show up on the map, without a separate place to check.
export function renderTagBadges(list, vocabulary, { removable = false, onRemove, isLocked, isHidden } = {}) {
  const wrap = el("div", "d-flex flex-wrap gap-1");
  const values = list || [];
  if (!values.length) {
    wrap.appendChild(el("span", "text-body-secondary small", "—"));
    return wrap;
  }
  values.forEach((value) => {
    const label = conditionLabel(vocabulary, value);
    const badge = el("span", "badge text-bg-secondary d-inline-flex align-items-center gap-1");
    if (typeof isHidden === "function" && isHidden(value)) {
      const hiddenIcon = el("span", "iconify");
      hiddenIcon.dataset.icon = "tabler:eye-off";
      hiddenIcon.style.fontSize = "0.7rem";
      hiddenIcon.setAttribute("aria-hidden", "true");
      badge.appendChild(hiddenIcon);
      badge.title = `${label} — hidden from the map`;
    }
    badge.appendChild(document.createTextNode(label));
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

// The "add a tag" row itself (text input + datalist + a visibility toggle +
// Add button, Enter-to-commit) — calls `onAdd(trimmedValue)` and clears the
// input, leaving what "adding" means (mutate + markDirty + write-through,
// vs. setAtBinding) up to the caller.
//
// The visibility toggle (eye/eye-off — whether the tag about to be added
// should be suppressed from map marker badges, see map-viewer.js's own
// resolveMarkerConditionIcons filtering against hiddenTags) is a fully
// CONTROLLED sub-component: `hidden` is the current state (owned by the
// caller, not tracked in here), and clicking it only ever calls
// `onToggleHidden()` — it never mutates its own DOM. This is a deliberate
// change from an earlier, self-managing version of this toggle: a caller
// whose own DOM persists across renders (combat-tracker.js's whole
// edit-panel architecture — see its own buildEditPanel/syncEditPanelValues,
// which sync stable inputs like nameInput/visibleButton in place rather
// than rebuilding them) needs to be able to keep THIS button around too and
// just re-sync its icon/label every render, exactly like visibleButton
// already does for combatant.hidden — that reliably works today; a
// self-contained closure here that only updated its OWN DOM on click did
// not survive combat-tracker's periodic external re-renders reliably.
// Returns `{ row, input, visibilityButton }` (not just the row) so a caller
// keeping this DOM stable has a direct ref to sync into (via
// applyTagVisibilityState below, which re-queries the icon itself — see its
// own comment for why THAT isn't cached anywhere), the same shape
// nameInput/hpInput/etc. already are; a caller that just rebuilds this
// whole row fresh every render (character-sheet.js) can ignore everything
// but `.row`.
export function buildTagInputRow(datalistId, { placeholder = "Add a tag…", onAdd, hidden = false, onToggleHidden } = {}) {
  const row = el("div", "d-flex gap-1 align-items-center");
  const input = el("input", "form-control form-control-sm");
  input.placeholder = placeholder;
  input.setAttribute("list", datalistId);

  const visibilityButton = el("button", "btn btn-outline-secondary btn-sm");
  visibilityButton.type = "button";
  const visibilityIcon = el("span", "iconify");
  visibilityIcon.setAttribute("aria-hidden", "true");
  visibilityButton.appendChild(visibilityIcon);
  applyTagVisibilityState(visibilityButton, hidden);
  visibilityButton.addEventListener("click", () => onToggleHidden?.());

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
  row.append(input, visibilityButton, addButton);
  return { row, input, visibilityButton };
}

// Syncs an existing visibility toggle's icon/label from `hidden` — the same
// operation buildTagInputRow's own initial call runs at construction time,
// exposed separately so a caller keeping that button's DOM stable across
// renders (combat-tracker.js) can re-run just this, exactly the way
// syncEditPanelValues already updates visibleButton's own icon in place on
// every render without rebuilding visibleButton itself.
//
// Re-queries `.iconify` fresh every call, exactly like that visibleButton
// code does (`refs.visibleButton.querySelector(".iconify")`) — confirmed
// (via DevTools, on this exact button) real bug from an earlier version
// that instead cached the icon <span> once at construction time: Iconify's
// runtime REPLACES that placeholder span with a rendered <svg> the first
// time it draws it (the span, and its data-icon attribute, are gone
// afterward — only an <svg> remains under the button). A cached reference
// to the original span is therefore stale/detached from that point on;
// every later `.dataset.icon =` write on it visibly did nothing, since it
// no longer has anything to do with what's on screen. Re-querying finds
// whatever's CURRENTLY there (the <svg>, or a fresh placeholder span the
// next time this runs before Iconify gets to it) instead of trusting a
// reference captured before Iconify ever touched the DOM.
export function applyTagVisibilityState(visibilityButton, hidden) {
  const visibilityIcon = visibilityButton.querySelector(".iconify");
  if (visibilityIcon) visibilityIcon.dataset.icon = hidden ? "tabler:eye-off" : "tabler:eye";
  const label = hidden ? "Hidden from the map — click to show this tag" : "Shown on the map — click to hide this tag";
  visibilityButton.title = label;
  visibilityButton.setAttribute("aria-label", label);
  // No highlighted/active styling — that visual language stays reserved for
  // "Show to table" (combat-tracker.js's own updateVisibilityAction).
}
