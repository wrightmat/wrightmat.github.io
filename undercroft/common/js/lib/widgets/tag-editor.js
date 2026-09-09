// Shared tags/conditions editing UI — badges, an "add a tag" input+datalist
// row, and the vocabulary lookup behind both. Factored out of
// combat-tracker.js so character-sheet.js can use the exact same UI for a
// character's own tags-role binding instead of a hand-copied version —
// every function below is a pure operation on whatever list/vocabulary the
// caller passes in (an `onAdd`/`onRemove` callback instead of a hardcoded
// combatant/character shape), so neither caller's state model leaks in here.
import { findBindingByRole } from "../bindings.js";
import { deriveCombatBindings } from "./combat-bindings.js";
import { el } from "../dom.js";
import { updateTooltipContent } from "../tooltips.js";
import { buildIconPreviewElement } from "../icon-picker.js";

// Bootstrap's `.text-bg-secondary` sets both background-color AND color with
// !important — a plain inline `badge.style.backgroundColor = entry.color`
// was silently overridden by it (confirmed: every condition's authored
// color was a no-op, not just a new one). `!important` on the inline
// declaration itself is what actually wins. Once the background genuinely
// changes, the icon (which renders via `currentColor` for both the ddb-*
// mask technique and a bi-* font glyph) needs a text color that contrasts
// with whatever was authored, not the class's hardcoded white — computed
// from relative luminance rather than hardcoded per known color, so any
// color a GM authors in Loom gets a readable icon automatically.
function contrastTextColor(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return "#fff";
  const num = parseInt(match[1], 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#212529" : "#fff";
}

// The tags-role binding's own `sourceField` names which other array field on
// a System supplies the tag vocabulary (default "conditions") — a generic
// "where do the valid options come from" pointer, not specific to combat
// bindings.
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

// Map markers' own condition-icon lookup — a System's tags vocabulary, each
// entry's optional icon/color, plus the recordField path to read a
// character/combatant's own live conditions off of. Consolidated here from
// three independently-duplicated copies (Orrery's app.js, the Dashboard's
// map.js widget, and this file's own deriveConditionsVocabulary) — one
// resolution, shared by every marker-rendering surface, so a fix or a
// taxonomy rename (recordField, formerly binding) only has to happen once.
export function buildSystemConditions(fields) {
  const bindings = deriveCombatBindings(fields);
  const tagsEntry = findBindingByRole(bindings, "tags");
  const vocabulary = deriveConditionsVocabulary(fields, bindings);
  const iconMap = new Map();
  if (vocabulary && tagsEntry) {
    const vocabularyKey = tagsEntry.sourceField || "conditions";
    const field = (fields || []).find((entry) => entry.type === "array" && entry.key === vocabularyKey);
    (field?.values || []).forEach((raw, index) => {
      const entry = vocabulary[index];
      // iconColor is optional — a GM can author just `color` (the badge/ring
      // background) and let the icon color be computed for contrast, or
      // author both explicitly (e.g. matching a physical condition-ring set
      // with its own independent ring-color/engraving-color pairing).
      if (entry && raw && (raw.icon || raw.color)) {
        iconMap.set(entry.id, { icon: raw.icon || "", color: raw.color || "", iconColor: raw.iconColor || "" });
      }
    });
  }
  return { iconMap, tagsBinding: tagsEntry?.recordField || "" };
}

// `removable` shows a per-badge remove button, calling `onRemove(value)` —
// the caller decides what removing a tag actually does. `isLocked(value)`
// (optional) withholds the remove button for individual tags a caller
// doesn't want removable right now — e.g. Repository's `group:` tag
// inherited from a page's parent, locked for as long as the parent still
// carries it. `isHidden(value)` (optional) marks a tag with a small
// eye-off icon — an informational cue about a tag's hiddenTags membership
// (see buildTagInputRow's visibility toggle and map-viewer.js's
// resolveMarkerConditionIcons), so a GM can tell at a glance which tags
// don't show up on the map.
//
// `vocabulary` entries may carry their own `icon`/`color` (see
// buildSystemConditions above) — when present, shown on the badge the same
// way Orrery/the Map widget already render a condition on a marker.
// `compact: true` (Combat Tracker's own row, vs. its detail panel) renders
// icon-only — full name moves to the tooltip, no remove button — falling
// back to the plain text badge below when a tag has no authored icon (a
// free-text tag, or a System that hasn't set one), same "always show
// something, never a blank chip" rule map-viewer.js's own icon-less
// fallback already follows for the identical case on a marker.
export function renderTagBadges(list, vocabulary, { removable = false, onRemove, isLocked, isHidden, compact = false } = {}) {
  const wrap = el("div", "d-flex flex-wrap gap-1");
  const values = list || [];
  if (!values.length) {
    wrap.appendChild(el("span", "text-body-secondary small", "—"));
    return wrap;
  }
  values.forEach((value) => {
    const entry = (vocabulary || []).find((candidate) => candidate.id === value);
    const label = entry?.label || value;
    const hiddenFromMap = typeof isHidden === "function" && isHidden(value);
    const badge = el("span", "badge text-bg-secondary d-inline-flex align-items-center gap-1");
    if (entry?.color) {
      badge.style.setProperty("background-color", entry.color, "important");
      // An explicit iconColor (e.g. matching a physical condition-ring set's
      // own independent ring/engraving colors) wins; otherwise computed for contrast.
      badge.style.setProperty("color", entry.iconColor || contrastTextColor(entry.color), "important");
    }
    // buildIconPreviewElement (icon-picker.js) handles all three authored
    // icon shapes (ddb-*/bi-*/tabler: iconify) — a plain iconify-only span
    // here would silently render nothing for the ddb-* icons a System's
    // conditions actually use (see ddb-icons.css).
    const iconEl = entry?.icon ? buildIconPreviewElement(entry.icon) : null;
    if (iconEl) {
      iconEl.setAttribute("aria-hidden", "true");
      badge.appendChild(iconEl);
    }
    if (hiddenFromMap) {
      const hiddenIcon = el("span", "iconify");
      hiddenIcon.dataset.icon = "tabler:eye-off";
      hiddenIcon.style.fontSize = "0.7rem";
      hiddenIcon.setAttribute("aria-hidden", "true");
      badge.appendChild(hiddenIcon);
    }
    const tooltipText = hiddenFromMap ? `${label} — hidden from the map` : label;
    if (compact && iconEl) {
      // Icon already carries the meaning — full name only in the tooltip.
      badge.setAttribute("data-bs-toggle", "tooltip");
      badge.setAttribute("data-bs-title", tooltipText);
    } else {
      badge.appendChild(document.createTextNode(label));
      if (hiddenFromMap) {
        badge.setAttribute("data-bs-toggle", "tooltip");
        badge.setAttribute("data-bs-title", tooltipText);
      }
      if (removable && !(typeof isLocked === "function" && isLocked(value))) {
        const removeBtn = el("button", "btn-close btn-close-white");
        removeBtn.type = "button";
        removeBtn.style.fontSize = "0.55rem";
        removeBtn.setAttribute("aria-label", `Remove ${label}`);
        removeBtn.setAttribute("data-bs-toggle", "tooltip");
        removeBtn.setAttribute("data-bs-title", `Remove ${label}`);
        removeBtn.addEventListener("click", () => onRemove?.(value));
        badge.appendChild(removeBtn);
      }
    }
    wrap.appendChild(badge);
  });
  return wrap;
}

// One global datalist element per `datalistId` (appended to <body>, same
// singleton-by-id idiom as spotlight.js/share-modal.js's modals) — pass a
// distinct id per caller so two tag inputs mounted at once on the same
// Dashboard don't fight over one shared list of suggestions.
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
// input, leaving what "adding" means up to the caller.
//
// The visibility toggle (eye/eye-off — whether the tag about to be added
// should be suppressed from map marker badges, see map-viewer.js's
// resolveMarkerConditionIcons filtering against hiddenTags) is a fully
// CONTROLLED sub-component: `hidden` is owned by the caller, and clicking
// it only ever calls `onToggleHidden()`, never mutating its own DOM. This
// matters for a caller whose own DOM persists across renders
// (combat-tracker.js's edit-panel architecture syncs stable inputs in
// place rather than rebuilding them) — it needs to keep THIS button around
// too and just re-sync its icon/label every render, the same way
// visibleButton already does for combatant.hidden; a self-contained
// closure that mutated its own DOM on click didn't survive
// combat-tracker's periodic external re-renders reliably.
// Returns `{ row, input, visibilityButton }` so a caller keeping this DOM
// stable has a direct ref to sync into (via applyTagVisibilityState below);
// a caller that rebuilds this row fresh every render (character-sheet.js)
// can ignore everything but `.row`.
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

// Syncs an existing visibility toggle's icon/label from `hidden` — the
// same operation buildTagInputRow's initial call runs at construction
// time, exposed separately so a caller keeping that button's DOM stable
// across renders (combat-tracker.js) can re-run just this.
//
// Re-queries `.iconify` fresh every call rather than caching the icon
// <span> once — Iconify's runtime REPLACES that placeholder span with a
// rendered <svg> the first time it draws (the span and its data-icon
// attribute are gone afterward), so a cached reference goes stale and
// every later `.dataset.icon =` write on it silently does nothing.
export function applyTagVisibilityState(visibilityButton, hidden) {
  const visibilityIcon = visibilityButton.querySelector(".iconify");
  if (visibilityIcon) visibilityIcon.dataset.icon = hidden ? "tabler:eye-off" : "tabler:eye";
  const label = hidden ? "Hidden from the map — click to show this tag" : "Shown on the map — click to hide this tag";
  updateTooltipContent(visibilityButton, label);
  visibilityButton.setAttribute("aria-label", label);
  // No highlighted/active styling — that visual language stays reserved
  // for "Show to table" (combat-tracker.js's updateVisibilityAction).
}
