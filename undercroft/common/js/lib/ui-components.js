// Shared DOM-building factory functions for the suite's most-repeated UI
// primitives — icon buttons, collapsible sections, the JSON Data panel,
// New/Save/Delete toolbar clusters. Each returns real, already-wired DOM
// nodes (same style as dom.js's el() and collapsible.js's own
// createCollapseToggleButton, which this generalizes) — callers
// `.appendChild()` them into a mount point, exactly like Press's
// dynamically-rendered canvas-layer rows already do today. No new markup
// convention, no custom elements, no attribute-driven auto-init.
//
// Written to replace the same hand-typed HTML block (and matching, separate
// JS wiring call) that used to be duplicated across every tool's own
// index.html/app.js — see undercroft/README.md's Code Conventions section
// for this codebase's established practice of tracking exactly this kind of
// extraction.

import { bindCollapsibleToggle, setCollapsibleState } from "./collapsible.js";
import { attachIconAutocomplete, buildIconPreviewElement } from "./icon-picker.js";
import { bindCopyButton } from "./clipboard.js";
import { createJsonPreviewRenderer } from "./json-preview.js";

// One tooltipped icon button — the single most-repeated primitive in the
// suite (162 hand-written instances measured across all 9 tools' index.html
// files before this module existed). Two established shapes exist suite-wide
// (see undercroft/README.md's UI & Style Conventions section, "Toolbar
// Buttons") — `kind`
// picks between them:
//   - "compact" (default) — small inline actions (JSON copy buttons,
//     collapsible chevron toggles, per-row actions): `btn-sm
//     d-inline-flex align-items-center justify-content-center`, plain icon,
//     tooltip on top, aria-label only (no visible-but-hidden text).
//   - "toolbar" — left-pane action toolbars (New/Save/Export/Delete, ...):
//     `p-2`, `fs-5` icon, tooltip on bottom, PLUS a `visually-hidden` label
//     span alongside aria-label (the established redundant-but-intentional
//     toolbar convention — never mix in a *visible* text label instead).
// `label` drives the tooltip title, the aria-label, and (for "toolbar" kind)
// the visually-hidden span. `includeToggleLabel` is a separate, narrower
// mechanism for the collapsible chevron's own dynamic expand/collapse text
// — see createCollapsibleSection below, which relies on that span's
// [data-toggle-label] marker so bindCollapsibleToggle can keep it in sync.
export function createIconButton({
  icon,
  label,
  variant = "outline-secondary",
  kind = "compact",
  tooltipPlacement,
  className = "",
  attrs = {},
  includeToggleLabel = false,
  onClick,
} = {}) {
  const isToolbar = kind === "toolbar";
  const button = document.createElement("button");
  button.type = "button";
  const classes = ["btn", `btn-${variant}`];
  if (isToolbar) {
    classes.push("p-2");
  } else {
    classes.push("btn-sm", "d-inline-flex", "align-items-center", "justify-content-center");
  }
  if (className) classes.push(className);
  button.className = classes.join(" ");
  const placement = tooltipPlacement || (isToolbar ? "bottom" : "top");
  if (label) {
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-placement", placement);
    button.setAttribute("data-bs-title", label);
    button.setAttribute("aria-label", label);
  }
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === false || value == null) return;
    button.setAttribute(key, value === true ? "" : String(value));
  });
  if (icon) {
    const iconEl = document.createElement("span");
    iconEl.className = isToolbar ? "iconify fs-5" : "iconify";
    iconEl.dataset.icon = icon;
    iconEl.setAttribute("aria-hidden", "true");
    button.appendChild(iconEl);
  }
  if (isToolbar && label) {
    const hiddenLabel = document.createElement("span");
    hiddenLabel.className = "visually-hidden";
    hiddenLabel.textContent = label;
    button.appendChild(hiddenLabel);
  }
  if (includeToggleLabel) {
    const toggleLabel = document.createElement("span");
    toggleLabel.className = "visually-hidden";
    toggleLabel.setAttribute("data-toggle-label", "");
    if (label) toggleLabel.textContent = label;
    button.appendChild(toggleLabel);
  }
  if (typeof onClick === "function") {
    button.addEventListener("click", (event) => onClick(event, button));
  }
  return button;
}

// One collapsible section — the ~15-25-line hand-written header+panel block
// every "Selections"/"Inspector"/"Notes"/"JSON Data"/... section in the
// suite used to duplicate, plus the separate bindCollapsibleToggle() call
// each one needed alongside it. `content` is either an existing DOM node or
// a builder function `(panel) => Node|void` (for callers that want to
// append directly rather than build first). `actions` are extra
// createIconButton-shaped configs rendered in the header, before the
// chevron toggle (e.g. JSON Data's own Copy button) — their built button
// nodes come back as `actionButtons`, in the same order, so a caller can
// wire up behavior (like bindCopyButton) on the exact node it needs.
export function createCollapsibleSection({
  label,
  id,
  collapsed = true,
  actions = [],
  helpTopic,
  content,
  className = "d-flex flex-column gap-3",
  panelClassName = "d-flex flex-column gap-3",
  // Set false when the caller needs fully custom click behavior (e.g. a
  // toggle that's conditionally gated, or that triggers a re-render on
  // expand) — bindCollapsibleToggle's own click handler can't express that,
  // and stacking a second listener on the same toggle to intercept/veto it
  // does NOT work: per the DOM spec, listeners on the event's own target
  // fire in registration order regardless of the capture flag (the
  // capture-vs-bubble skip only applies on ancestor nodes during the
  // capturing/bubbling phases), so a later "block this click" listener can
  // never pre-empt an earlier one on the identical element. With this
  // false, only the toggle's initial visual state is set here (via
  // setCollapsibleState) — the caller registers its own click listener and
  // calls the returned `setCollapsed` from inside it.
  autoBindToggle = true,
} = {}) {
  const section = document.createElement("section");
  section.className = className;
  if (id) section.id = id;

  const header = document.createElement("div");
  header.className = "d-flex align-items-center justify-content-between gap-2";

  const labelWrap = document.createElement("div");
  labelWrap.className = "d-flex align-items-center gap-2";
  const heading = document.createElement("h2");
  heading.className = "text-uppercase fs-6 fw-semibold text-body-secondary mb-0";
  heading.textContent = label;
  labelWrap.appendChild(heading);
  if (helpTopic) {
    const helpSpan = document.createElement("span");
    helpSpan.className = "align-middle";
    helpSpan.setAttribute("data-help-topic", helpTopic);
    helpSpan.setAttribute("data-help-insert", "replace");
    labelWrap.appendChild(helpSpan);
  }

  const actionsWrap = document.createElement("div");
  actionsWrap.className = "d-flex align-items-center gap-2";
  const actionButtons = actions.map((actionConfig) => {
    const actionButton = createIconButton(actionConfig);
    actionsWrap.appendChild(actionButton);
    return actionButton;
  });

  const toggle = createIconButton({
    icon: "tabler:chevron-right",
    className: "collapsible-toggle",
    includeToggleLabel: true,
  });
  toggle.removeAttribute("data-bs-toggle");
  toggle.removeAttribute("data-bs-placement");
  toggle.removeAttribute("data-bs-title");
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  actionsWrap.appendChild(toggle);

  header.append(labelWrap, actionsWrap);

  const panel = document.createElement("div");
  panel.className = panelClassName;
  if (content instanceof Node) {
    panel.appendChild(content);
  } else if (typeof content === "function") {
    const built = content(panel);
    if (built instanceof Node) panel.appendChild(built);
  }

  section.append(header, panel);

  let setCollapsed;
  if (autoBindToggle) {
    setCollapsed = bindCollapsibleToggle(toggle, panel, {
      collapsed,
      expandLabel: `Expand ${label}`,
      collapseLabel: `Collapse ${label}`,
    });
  } else {
    setCollapsed = (next) =>
      setCollapsibleState(toggle, panel, {
        collapsed: next,
        expandLabel: `Expand ${label}`,
        collapseLabel: `Collapse ${label}`,
      });
    setCollapsed(collapsed);
  }

  return { section, header, panel, toggle, actionButtons, setCollapsed };
}

// The exact panel rebuilt by hand in 8 different tools before this module
// existed — a read-only textarea (for easy copy-out) inside a
// createCollapsibleSection, with a Copy button (size shown in its own
// tooltip, not a separate badge — see json-preview.js's
// updateCopyButtonSize) wired via bindCopyButton, and a `render()` that's
// the same createJsonPreviewRenderer every tool already used individually.
// `getData` is the same "() => value to serialize" contract
// createJsonPreviewRenderer's own `serialize` option already expects.
export function createJsonDataPanel({
  label = "JSON Data",
  rows = 10,
  collapsed = true,
  getData,
  id,
  className,
  helpTopic,
} = {}) {
  const textarea = document.createElement("textarea");
  textarea.className = "form-control form-control-sm font-monospace json-preview-text";
  textarea.rows = rows;
  textarea.readOnly = true;

  const { section, header, panel, toggle, actionButtons, setCollapsed } = createCollapsibleSection({
    label,
    id,
    collapsed,
    className,
    helpTopic,
    actions: [{ icon: "tabler:copy", label: "Copy to clipboard" }],
    content: textarea,
  });
  const [copyButton] = actionButtons;

  bindCopyButton(copyButton, textarea);

  const render = createJsonPreviewRenderer({
    resolvePreviewElement: () => textarea,
    resolveBytesElement: () => copyButton,
    serialize: typeof getData === "function" ? getData : () => getData,
  });

  return { section, header, panel, toggle, textarea, copyButton, render, setCollapsed };
}

// A left-pane action toolbar cluster (~20 instances suite-wide — New/Save/
// Export/Delete and friends). `action` picks the icon/color preset per
// undercroft/README.md's UI & Style Conventions section, "Toolbar Buttons"
// color table; anything not
// in ACTION_PRESETS falls back to a plain secondary-outline button, so this
// still works for a toolbar with an odd one out. Pass `icon`/`variant` to
// override a preset's default icon/color for a tool-specific case (e.g.
// Vault's Generate uses "tabler:sparkles" instead of the "generate" preset's
// own "tabler:flask"; Repository's Duplicate Page is `outline-secondary`
// rather than the "duplicate" preset's usual `outline-success`, an existing
// exception being preserved here, not introduced). Pass `primary: true` for
// the "New/Generate is this tool's one true primary activity" case (e.g.
// Crucible/Forge/Vault/Sanctum's "Generate", Press's "Print") — swaps that
// one button to filled `btn-primary` per the style guide, no icon/label
// change. Returns the button nodes in order — caller appends them into
// whatever wrapper (btn-toolbar, btn-group, ...) it already uses.
const ACTION_PRESETS = {
  undo: { icon: "tabler:arrow-back-up", variant: "outline-secondary" },
  redo: { icon: "tabler:arrow-forward-up", variant: "outline-secondary" },
  new: { icon: "tabler:file-plus", variant: "outline-primary" },
  generate: { icon: "tabler:flask", variant: "outline-primary" },
  import: { icon: "tabler:file-import", variant: "outline-secondary" },
  save: { icon: "tabler:device-floppy", variant: "outline-success" },
  export: { icon: "tabler:file-export", variant: "outline-secondary" },
  print: { icon: "tabler:printer", variant: "outline-primary" },
  rename: { icon: "tabler:edit", variant: "outline-secondary" },
  duplicate: { icon: "tabler:copy", variant: "outline-success" },
  delete: { icon: "tabler:trash", variant: "outline-danger" },
};

// A single form-floating field (Bootstrap's `.form-floating` label-over-
// input pattern) — the single most-repeated shape inside Press's Component
// Inspector (~20 instances, one per component property: Gap, Space after,
// Column template, Layer sizing, Aria label, Classes, ...). Each of those
// fields is genuinely one-of-a-kind (different id/label/tooltip/attrs), not
// duplicated content — this factory exists to turn "one repeated shape,
// many distinct configs" into data instead of hand-typed markup, the same
// win createIconButton gives the suite's icon buttons.
// `wrapperAttr` is the field's own `data-inspector-*` marker (present on
// EVERY field, whether or not it's currently hidden — some fields keep
// theirs always visible, e.g. Classes) — `hidden: true` additionally sets
// the `hidden` attribute AND `.hidden = true`, matching how these fields
// get toggled by the inspector's own show/hide logic. `wrapperAttr` may
// repeat across several fields that all show/hide together as one group
// (e.g. Press's five different `data-inspector-image-field` elements) —
// that's fine, it's just an attribute value, not a unique key.
export function createFormFloatingField({
  type = "text",
  id,
  label,
  labelAttr,
  wrapperAttr,
  hidden = false,
  options = [],
  dataAttr,
  tooltip,
  tooltipPlacement = "top",
  style,
  ...inputAttrs
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-floating";
  if (wrapperAttr) {
    wrapper.setAttribute(wrapperAttr, "");
    if (hidden) {
      wrapper.hidden = true;
    }
  }

  let input;
  if (type === "select") {
    input = document.createElement("select");
    input.className = "form-select";
    options.forEach(({ value, label: optionLabel }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      input.appendChild(option);
    });
  } else if (type === "textarea") {
    input = document.createElement("textarea");
    input.className = "form-control";
  } else {
    input = document.createElement("input");
    input.type = type;
    input.className = "form-control";
  }
  if (id) input.id = id;
  if (dataAttr) input.setAttribute(dataAttr, "");
  if (style) input.style.cssText = style;
  Object.entries(inputAttrs).forEach(([key, value]) => {
    if (value === false || value == null) return;
    input.setAttribute(key, value === true ? "" : String(value));
  });
  if (tooltip) {
    input.setAttribute("data-bs-toggle", "tooltip");
    input.setAttribute("data-bs-placement", tooltipPlacement);
    input.setAttribute("data-bs-title", tooltip);
  }

  const labelEl = document.createElement("label");
  labelEl.className = "fw-semibold";
  if (id) labelEl.htmlFor = id;
  if (labelAttr) labelEl.setAttribute(labelAttr, "");
  labelEl.textContent = label;

  wrapper.append(input, labelEl);
  return wrapper;
}

// The `btn-check` button-group shape (radio OR checkbox, styled as a
// segmented control) — shared by Press's and Workbench's Component
// Inspectors (Horizontal/Vertical alignment, Text size, Text orientation,
// Text decoration, Border sides, Label position, Text Align, Align Items,
// ...). Returns just the inner `.btn-group` — each instance's own outer
// `<label>` + wrapper stays hand-written at the call site (2-3 lines, not
// worth a second layer of factory for).
// Two option shapes, matching what's actually in the markup:
//   - `value` (+ a shared `dataAttr` set as a bare boolean on every option)
//     — the radio-group convention (e.g. Horizontal alignment: `value`
//     differs, `data-component-align-x` is present on all four).
//   - `dataValue` (the shared `dataAttr` gets THIS option's own value,
//     instead of being a bare boolean) — the checkbox-group convention
//     (Text decoration: `data-component-text-style="bold"`/`"italic"`/
//     `"underline"`, no `name`/`value` at all).
// Single-row (no wrap, buttons shrink to fit) is the default layout — pass
// `wrap: true` for the rare group that should wrap to multiple rows
// instead. `size: "sm"` opts into smaller (`btn-sm`) buttons; default is
// full-size.
export function createButtonCheckGroup({
  groupClassName = "btn-group template-radio-group",
  ariaLabel,
  inputType = "radio",
  name,
  dataAttr,
  size,
  wrap = false,
  options = [],
} = {}) {
  const group = document.createElement("div");
  group.className = wrap ? groupClassName : `${groupClassName} template-radio-group--single-row`;
  group.setAttribute("role", "group");
  if (ariaLabel) group.setAttribute("aria-label", ariaLabel);

  options.forEach((opt) => {
    const input = document.createElement("input");
    input.type = inputType;
    input.className = "btn-check";
    if (name) input.name = name;
    if (opt.id) input.id = opt.id;
    if (opt.value !== undefined) input.value = opt.value;
    if (opt.dataValue !== undefined) {
      input.setAttribute(dataAttr, opt.dataValue);
    } else if (dataAttr) {
      input.setAttribute(dataAttr, "");
    }

    const label = document.createElement("label");
    label.className = size === "sm" ? "btn btn-outline-secondary btn-sm" : "btn btn-outline-secondary";
    if (opt.id) label.htmlFor = opt.id;
    if (opt.tooltip) {
      label.setAttribute("data-bs-toggle", "tooltip");
      label.setAttribute("data-bs-placement", opt.tooltipPlacement || "top");
      label.setAttribute("data-bs-title", opt.tooltip);
    }
    if (opt.labelAttr && opt.labelAttrValue !== undefined) {
      label.setAttribute(opt.labelAttr, opt.labelAttrValue);
    }
    if (opt.icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "iconify";
      iconEl.dataset.icon = opt.icon;
      iconEl.setAttribute("aria-hidden", "true");
      const textSpan = document.createElement("span");
      textSpan.className = "template-radio-label";
      if (opt.spanAttr && opt.spanAttrValue !== undefined) {
        textSpan.setAttribute(opt.spanAttr, opt.spanAttrValue);
      }
      textSpan.textContent = opt.text;
      label.append(iconEl, textSpan);
    } else {
      label.textContent = opt.text;
    }
    group.append(input, label);
  });

  return group;
}

// A single form-check checkbox (optionally styled as a switch) — 7
// instances in Press's Component Inspector (Header row, Visible, Inline,
// four Border-side toggles). `tooltip` goes on the LABEL (every observed
// instance that has one puts it there, not on the input).
export function createCheckField({
  id,
  label,
  dataAttr,
  dataValue,
  switchStyle = false,
  tooltip,
  tooltipPlacement = "top",
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = switchStyle ? "form-check form-switch" : "form-check";

  const input = document.createElement("input");
  input.className = "form-check-input";
  input.type = "checkbox";
  if (switchStyle) input.setAttribute("role", "switch");
  if (id) input.id = id;
  if (dataAttr) {
    input.setAttribute(dataAttr, dataValue !== undefined ? dataValue : "");
  }

  const labelEl = document.createElement("label");
  labelEl.className = "form-check-label";
  if (id) labelEl.htmlFor = id;
  if (tooltip) {
    labelEl.setAttribute("data-bs-toggle", "tooltip");
    labelEl.setAttribute("data-bs-placement", tooltipPlacement);
    labelEl.setAttribute("data-bs-title", tooltip);
  }
  labelEl.textContent = label;

  wrapper.append(input, labelEl);
  return wrapper;
}

export function createToolbarButtonGroup(items = []) {
  return items.map(
    ({ action, label, icon, variant: variantOverride, onClick, visible = true, disabled = false, primary = false, attrs = {} }) => {
      const preset = ACTION_PRESETS[action] || {};
      const variant = primary ? "primary" : variantOverride || preset.variant || "outline-secondary";
      const button = createIconButton({
        icon: icon || preset.icon,
        variant,
        kind: "toolbar",
        label,
        attrs,
        onClick,
      });
      button.disabled = Boolean(disabled);
      button.classList.toggle("d-none", !visible);
      if (action) button.dataset.toolbarAction = action;
      return button;
    }
  );
}

// The generator tools' "nothing yet" placeholder — a centered icon
// (optional — Repository's own instance has none, just a message) inside a
// plain `card shadow-theme`, shown until something's been generated or
// selected. Five near-identical hand-typed copies of this (Vault, Crucible,
// Sanctum, Forge, Repository) used to exist across the suite, differing
// only in icon and message text.
// The small "label above, form-control-sm/form-select-sm control" field —
// the shape used throughout Template/Grid Properties panels and
// grid-packed inspector fields (Position, Image size, Pan/Zoom, Border
// width/radius) that sit dense multiple-to-a-row, as opposed to
// createFormFloatingField's floating-label shape for single-column
// inspector fields. Pair with createFieldRow (common/js/lib/
// inspector-fields.js) for the row/col grid wrapper. Was previously ~30
// independently hand-built label+input pairs across Press alone, with one
// real drift already found and fixed here: three of them (Custom size
// label/width/height) were missing `fw-semibold` that every other instance
// had — this factory bakes in the majority shape rather than the outlier.
export function createCompactField({
  type = "text",
  id,
  label,
  labelClass = "form-label small text-body-secondary fw-semibold",
  dataAttr,
  placeholder,
  tooltip,
  tooltipPlacement = "top",
  options = [],
  size,
  rows,
  controlClass,
  helpTopic,
  helpPlacement,
  ...inputAttrs
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-1";

  const labelEl = document.createElement("label");
  labelEl.className = labelClass;
  if (id) labelEl.htmlFor = id;
  labelEl.textContent = label;

  // A help-icon tooltip sits beside (not inside) the label — matches the
  // "label + help span" row every other help-bearing field in this suite
  // uses (createCollapsibleSection's own header, Press's Template/Format/
  // Orientation selects).
  let labelRow = labelEl;
  if (helpTopic) {
    labelRow = document.createElement("div");
    labelRow.className = "d-flex align-items-center justify-content-between gap-2";
    const helpSpan = document.createElement("span");
    helpSpan.className = "align-middle";
    helpSpan.setAttribute("data-help-topic", helpTopic);
    helpSpan.setAttribute("data-help-insert", "replace");
    if (helpPlacement) helpSpan.setAttribute("data-help-placement", helpPlacement);
    labelRow.append(labelEl, helpSpan);
  }

  let input;
  if (type === "select" || type === "select-multiple") {
    input = document.createElement("select");
    input.className = controlClass || "form-select form-select-sm";
    if (type === "select-multiple") {
      input.multiple = true;
      if (size) input.size = size;
    }
    options.forEach(({ value, label: optionLabel }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      input.appendChild(option);
    });
  } else if (type === "textarea") {
    input = document.createElement("textarea");
    input.className = controlClass || "form-control form-control-sm";
    if (rows) input.rows = rows;
  } else {
    input = document.createElement("input");
    input.type = type;
    input.className = controlClass || "form-control form-control-sm";
  }
  if (id) input.id = id;
  if (dataAttr) input.setAttribute(dataAttr, "");
  if (placeholder) input.placeholder = placeholder;
  Object.entries(inputAttrs).forEach(([key, value]) => {
    if (value === false || value == null) return;
    input.setAttribute(key, value === true ? "" : String(value));
  });
  if (tooltip) {
    input.setAttribute("data-bs-toggle", "tooltip");
    input.setAttribute("data-bs-placement", tooltipPlacement);
    input.setAttribute("data-bs-title", tooltip);
  }

  wrapper.append(labelRow, input);
  return wrapper;
}

// A compact "search box + scrollable checkbox list" — the Locked Features
// picker's replacement for a bare `<select multiple>` (Crucible/Vault/
// Sanctum all had one). A native multi-select forces ctrl/cmd-click to pick
// more than one option, gives no way to search a long list, and its
// "selected" rows are barely distinguishable from unselected ones at a
// glance — checkboxes fix all three with a single click per item and an
// obvious checked state. `maxHeight` caps the scrollable list so the whole
// control (search input + list) stays about the same footprint as the
// multi-select it replaces rather than growing with the option count.
// Callers populate/read it via populateLockedFeaturesCheckList/
// readLockedFeatureIds (common/js/lib/generator-kit.js), which look inside
// this control for the fixed `data-checklist-search`/`data-checklist-options`
// markers below — `dataAttr` (like every other field factory here) marks the
// whole control so a caller's usual `document.querySelector("[data-x]")`
// still finds it.
export function createSearchableCheckList({
  id,
  label,
  labelClass = "form-label fw-semibold mb-0",
  dataAttr,
  helpTopic,
  helpPlacement,
  searchPlaceholder = "Search…",
  maxHeight = "5rem",
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-1";

  const labelEl = document.createElement("label");
  labelEl.className = labelClass;
  if (id) labelEl.htmlFor = `${id}Search`;
  labelEl.textContent = label;

  let labelRow = labelEl;
  if (helpTopic) {
    labelRow = document.createElement("div");
    labelRow.className = "d-flex align-items-center justify-content-between gap-2";
    const helpSpan = document.createElement("span");
    helpSpan.className = "align-middle";
    helpSpan.setAttribute("data-help-topic", helpTopic);
    helpSpan.setAttribute("data-help-insert", "replace");
    if (helpPlacement) helpSpan.setAttribute("data-help-placement", helpPlacement);
    labelRow.append(labelEl, helpSpan);
  }

  const container = document.createElement("div");
  container.className = "d-flex flex-column gap-1";
  if (dataAttr) container.setAttribute(dataAttr, "");

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "form-control form-control-sm";
  searchInput.placeholder = searchPlaceholder;
  if (id) searchInput.id = `${id}Search`;
  searchInput.setAttribute("data-checklist-search", "");

  const listBox = document.createElement("div");
  listBox.className = "border rounded-2 overflow-auto p-1 d-flex flex-column";
  listBox.style.maxHeight = maxHeight;
  listBox.setAttribute("data-checklist-options", "");

  // Filters existing rows on every keystroke — populateLockedFeaturesCheckList
  // (generator-kit.js) stamps each row with its own lowercased
  // `data-search-label` and re-applies whatever query is already in this box
  // whenever it rebuilds the list, so a search survives a System/Setting
  // change that repopulates the options underneath it.
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.trim().toLowerCase();
    Array.from(listBox.children).forEach((row) => {
      row.classList.toggle("d-none", Boolean(query) && !row.dataset.searchLabel?.includes(query));
    });
  });

  container.append(searchInput, listBox);
  wrapper.append(labelRow, container);
  return wrapper;
}

// A bordered "field box" — label above, editable value below, an optional
// trailing action button (Forge's per-attribute reroll) — the shared
// generator-tool property/stat card. Originally Forge's own buildFieldCard
// (its Identity/4D/Stats fields), independently reinvented near-identically
// as Crucible's buildStatCard (its own Stats fields); consolidated here so
// Crucible's Identity fields and Vault's Identity fields can adopt the exact
// same look instead of a fourth hand-rolled variant, per explicit user
// feedback that Forge's box style — "it basically matches the Stats boxes
// and Features boxes in the other tools" — should be the one shared look
// across every tool's center-pane properties. `.field-inline-edit` (see
// common/css/shell.css) is the "blend in until hovered/focused" idiom that
// keeps an editable value from visually standing out among read-only ones;
// works for both an <input> and a <select>.
//
// type: "text" (a free-typed value, e.g. Forge's Name/Stats, Crucible's
// Stats/an imported monster's Size-Type-Alignment-Speed) or "select" (a
// fixed-vocabulary pick, e.g. Crucible's Creature Type/Archetype/Role,
// Vault's Rarity/Activation/Item Form) — `options` is required for "select"
// (`[{value, label}]`). `editable: false` renders a plain read-only value
// line instead (no border/background at all — the pre-existing "static"
// look every tool already used before any field here was editable).
//
// `rerollable` adds a trailing reroll button carrying `data-reroll-attribute`
// (Forge's own per-attribute-reroll delegated listener reads this) —
// harmless to any tool that doesn't wire up that listener, since the button
// simply wouldn't do anything without it; only Forge currently sets this.
// `selectable` adds `data-select-field` (Forge's click-a-field-to-inspect-it
// convention) — also Forge-only today, for the same reason.
//
// `colClass` wraps the box in a Bootstrap grid column (the default,
// matching every field-box grid in the suite); pass `colClass: null` for a
// caller that wants the bare box itself instead — for a flex-row mount like
// Name/Image (not laid out via `.row`/`.col-*`), the caller supplies its own
// wrapping/sizing.
export function createFieldBox({
  key,
  label,
  value = "",
  type = "text",
  options = [],
  suffix = "",
  compact = false,
  editable = false,
  rerollable = false,
  selectable = false,
  colClass = "col-12 col-md-6 col-lg-4",
  dataAttr = "data-editable-field",
  suffixDataAttr = "data-editable-suffix",
  ariaLabelPrefix = "Edit",
  rows = 3,
} = {}) {
  function buildControl(controlClass) {
    if (type === "select") {
      const select = document.createElement("select");
      select.className = controlClass;
      options.forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        select.appendChild(optionEl);
      });
      if (options.some((option) => option.value === value)) select.value = value;
      return select;
    }
    if (type === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.className = controlClass;
      textarea.rows = rows;
      textarea.value = value ?? "";
      return textarea;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = controlClass;
    input.value = value ?? "";
    return input;
  }

  const box = document.createElement("div");
  if (selectable && key) box.dataset.selectField = key;

  const labelEl = document.createElement("div");
  labelEl.textContent = label;

  let control = null;
  let suffixEl = null;
  if (editable) {
    // .field-inline-edit already sets font-weight: 600 on its own (see
    // common/css/shell.css) — no fw-semibold utility class needed on top.
    // Compact boxes size the INPUT to the box's own width (flex-grow-1 on a
    // w-100 valueRow below), not a fixed rem value — colClass can make a
    // compact box anywhere from 1x an ability-score box up to several times
    // wider (e.g. Crucible/Forge's own 2x/3x stat boxes), and a fixed-width
    // input left most of a wider box empty instead of actually using it.
    control = buildControl(compact ? "field-inline-edit small text-center flex-grow-1" : "field-inline-edit");
    if (key) control.setAttribute(dataAttr, key);
    control.setAttribute("aria-label", `${ariaLabelPrefix} ${label}`);
    if (compact) control.style.minWidth = "0";
  }

  if (compact) {
    box.className = "d-flex flex-column align-items-center justify-content-center text-center border rounded-3 p-1 h-100";
    labelEl.className = "text-uppercase text-body-secondary";
    labelEl.style.fontSize = "0.65rem";
    box.appendChild(labelEl);
    if (editable) {
      const valueRow = document.createElement("div");
      valueRow.className = "d-flex align-items-center justify-content-center gap-1 w-100";
      valueRow.appendChild(control);
      if (suffix) {
        suffixEl = document.createElement("span");
        suffixEl.className = "small text-body-secondary";
        if (key) suffixEl.setAttribute(suffixDataAttr, key);
        suffixEl.textContent = suffix;
        valueRow.appendChild(suffixEl);
      }
      box.appendChild(valueRow);
    } else {
      const valueEl = document.createElement("div");
      valueEl.className = "fw-semibold small";
      valueEl.textContent = value;
      box.appendChild(valueEl);
    }
  } else {
    box.className = "d-flex align-items-center justify-content-between gap-2 border rounded-3 p-2 h-100";
    const text = document.createElement("div");
    text.className = "flex-grow-1";
    labelEl.className = "small text-uppercase text-body-secondary";
    text.appendChild(labelEl);
    if (editable) {
      if (suffix) {
        control.classList.add("flex-grow-1");
        const valueRow = document.createElement("div");
        valueRow.className = "d-flex align-items-center gap-1";
        valueRow.appendChild(control);
        suffixEl = document.createElement("span");
        suffixEl.className = "small text-body-secondary";
        if (key) suffixEl.setAttribute(suffixDataAttr, key);
        suffixEl.textContent = suffix;
        valueRow.appendChild(suffixEl);
        text.appendChild(valueRow);
      } else {
        text.appendChild(control);
      }
    } else {
      const valueEl = document.createElement("div");
      valueEl.className = "fw-semibold";
      valueEl.textContent = value;
      text.appendChild(valueEl);
    }
    box.appendChild(text);
    if (rerollable) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-secondary btn-sm flex-shrink-0";
      if (key) button.dataset.rerollAttribute = key;
      button.setAttribute("aria-label", `Reroll ${label}`);
      button.innerHTML = `<span class="iconify" data-icon="tabler:refresh" aria-hidden="true"></span>`;
      box.appendChild(button);
    }
  }

  if (!colClass) return box;
  const col = document.createElement("div");
  col.className = colClass;
  col.appendChild(box);
  return col;
}

// A label + searchable icon input with a live preview swatch, wired to
// icon-picker.js's attachIconAutocomplete — defaults to the ddb-*/bi-*
// class vocabulary and dropdown Press's own Icon component field uses (see
// press/index.html's `data-inspector-icon-field` for the markup this
// mirrors); pass `sources: ["tabler"]` (or any subset icon-picker.js's own
// getAllIconOptions understands) to search a different vocabulary instead —
// board.js's card icon field does this, since its own `icon` value is a
// `tabler:*` Iconify identifier, not a CSS class. Deliberately NOT the same
// factory as Press's own field: that one resolves @binding/=formula preview
// values through the template's live data context, which callers like
// Orrery's marker icon (a literal class/icon string, no binding concept)
// don't need. Commits on "change" (blur/Enter), not every keystroke, since
// callers whose selection editor rebuilds its whole DOM per change (Orrery,
// board.js) would lose focus on a live-keystroke commit.
export function createIconPickerField({
  id,
  label = "Icon",
  labelClass = "form-label mb-0",
  value = "",
  placeholder = "Search icons",
  sources,
  onSelect,
} = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";

  const labelEl = document.createElement("label");
  labelEl.className = labelClass;
  if (id) labelEl.htmlFor = id;
  labelEl.textContent = label;

  const group = document.createElement("div");
  group.className = "input-group";
  const previewWrap = document.createElement("span");
  previewWrap.className = "input-group-text";
  const preview = document.createElement("span");
  preview.className = "press-icon-preview";
  preview.setAttribute("aria-hidden", "true");
  previewWrap.appendChild(preview);

  const input = document.createElement("input");
  input.className = "form-control";
  input.type = "search";
  input.placeholder = placeholder;
  if (id) input.id = id;
  input.value = value;

  group.append(previewWrap, input);
  wrapper.append(labelEl, group);

  // buildIconPreviewElement (icon-picker.js's own) handles all three value
  // shapes ddb-*/bi-*/tabler: — getIconTokens alone (the old body here)
  // only ever recognized bi-*/ddb-*, so a tabler:* value silently rendered
  // nothing at all.
  function updatePreview(nextValue) {
    preview.innerHTML = "";
    const icon = buildIconPreviewElement(nextValue);
    if (icon) preview.appendChild(icon);
  }
  updatePreview(value);

  // Guards against firing onSelect twice for one selection: clicking a
  // dropdown row commits via attachIconAutocomplete's own onSelect below,
  // but if the input still has focus with a dirty value (the user typed a
  // search term before clicking a row — its native change-on-blur "dirty"
  // flag is only set by real user edits, never by the input.value=selected
  // assignment just below), and the caller's own onSelect synchronously
  // tears down/rebuilds this field's container (as Orrery's marker overlay-
  // icon picker does), removing the still-focused input from the DOM fires
  // a native blur, which then fires a native "change" event on the same
  // already-committed value — re-invoking the "change" listener further
  // down for a value that was never actually re-typed. Tracking the last
  // committed value and skipping a repeat no-op commit fixes this without
  // suppressing any genuine reselection (a real new pick always differs
  // from whatever was last committed).
  let committedValue = value;
  function commit(nextValue) {
    if (nextValue === committedValue) return;
    committedValue = nextValue;
    updatePreview(nextValue);
    onSelect?.(nextValue);
  }

  attachIconAutocomplete(input, {
    sources,
    onSelect: (selected) => {
      input.value = selected;
      commit(selected);
    },
  });
  input.addEventListener("change", () => commit(input.value));

  return wrapper;
}

export function createEmptyStateCard({ icon, message }) {
  const card = document.createElement("div");
  card.className = "card shadow-theme";
  const body = document.createElement("div");
  body.className = "card-body text-center text-body-secondary py-5";
  if (icon) {
    const iconEl = document.createElement("span");
    iconEl.className = "iconify fs-1 d-block mb-2";
    iconEl.dataset.icon = icon;
    iconEl.setAttribute("aria-hidden", "true");
    body.appendChild(iconEl);
  }
  body.appendChild(document.createTextNode(message));
  card.appendChild(body);
  return card;
}
