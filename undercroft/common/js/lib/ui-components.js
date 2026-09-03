// Shared DOM-building factory functions for the suite's most-repeated UI
// primitives — icon buttons, collapsible sections, the JSON Data panel,
// New/Save/Delete toolbar clusters. Each returns real, already-wired DOM
// nodes (same style as dom.js's el() and collapsible.js's own
// createCollapseToggleButton, which this generalizes) — callers
// `.appendChild()` them into a mount point. No new markup convention, no
// custom elements, no attribute-driven auto-init.

import { bindCollapsibleToggle, setCollapsibleState } from "./collapsible.js";
import { attachIconAutocomplete, buildIconPreviewElement } from "./icon-picker.js";
import { bindCopyButton } from "./clipboard.js";
import { createJsonPreviewRenderer } from "./json-preview.js";
import { disposeTooltips, refreshTooltips, initTooltip } from "./tooltips.js";

// One tooltipped icon button — the most-repeated primitive in the suite.
// Two established shapes (see README's "Toolbar Buttons" convention) —
// `kind` picks between them:
//   - "compact" (default) — small inline actions (JSON copy, collapsible
//     chevrons, per-row actions): `btn-sm`, plain icon, tooltip on top,
//     aria-label only.
//   - "toolbar" — left-pane toolbars (New/Save/Export/Delete): `p-2`,
//     `fs-5` icon, tooltip on bottom, PLUS a `visually-hidden` label span
//     alongside aria-label (the redundant-but-intentional convention —
//     never a *visible* text label instead).
// `label` drives the tooltip title, aria-label, and (for "toolbar") the
// hidden span. `includeToggleLabel` is a separate mechanism for the
// collapsible chevron's dynamic expand/collapse text — see
// createCollapsibleSection below, which relies on the [data-toggle-label]
// marker so bindCollapsibleToggle can keep it in sync.
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

// One collapsible section — the header+panel block every "Selections"/
// "Inspector"/"Notes"/"JSON Data" section in the suite used to duplicate by
// hand, plus the separate bindCollapsibleToggle() call each needed. `content`
// is either an existing DOM node or a builder function `(panel) => Node|void`.
// `actions` are extra createIconButton-shaped configs rendered in the
// header before the chevron toggle (e.g. JSON Data's Copy button) — their
// built nodes come back as `actionButtons`, in order, so a caller can wire
// behavior (like bindCopyButton) on the exact node it needs.
export function createCollapsibleSection({
  label,
  id,
  collapsed = true,
  actions = [],
  helpTopic,
  content,
  className = "d-flex flex-column gap-3",
  panelClassName = "d-flex flex-column gap-3",
  // Overridable per caller — the standard uppercase/fs-6 treatment reads
  // too heavy in a small, already-compact context (a dashboard widget card).
  headingClassName = "text-uppercase fs-6 fw-semibold text-body-secondary mb-0",
  // Set false when the caller needs fully custom click behavior (a
  // conditionally-gated toggle, a re-render on expand) that
  // bindCollapsibleToggle's own handler can't express. Stacking a second
  // listener on the same toggle to intercept/veto it does NOT work — DOM
  // listeners on the event's own target fire in registration order
  // regardless of capture flag, so a later "block this click" listener can
  // never pre-empt an earlier one. With this false, only the toggle's
  // initial visual state is set here — the caller registers its own click
  // listener and calls the returned `setCollapsed` from inside it.
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
  heading.className = headingClassName;
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

// The JSON Data panel — a read-only textarea inside a
// createCollapsibleSection, with a Copy button (size shown in its own
// tooltip, not a separate badge — see json-preview.js's
// updateCopyButtonSize) wired via bindCopyButton, and a `render()` that's
// the same createJsonPreviewRenderer every tool already used individually.
// `getData` is the "() => value to serialize" contract
// createJsonPreviewRenderer's `serialize` option expects.
// `onImport`/`onExport` — optional. When given, prepend Import/Export icon
// buttons before Copy (Import -> Export -> Copy -> collapse toggle, the
// suite's canonical toolbar-action order) so a tool's file round-trip lives
// next to the preview it corresponds to. `exportIcon`/`importIcon` override
// the defaults for a tool with an established icon choice (Orrery's own
// Import/Export use tabler:upload/tabler:download).
export function createJsonDataPanel({
  label = "JSON Data",
  rows = 10,
  collapsed = true,
  getData,
  id,
  className,
  helpTopic,
  onImport,
  onExport,
  importIcon = "tabler:file-import",
  exportIcon = "tabler:file-export",
} = {}) {
  const textarea = document.createElement("textarea");
  textarea.className = "form-control form-control-sm font-monospace json-preview-text";
  textarea.rows = rows;
  textarea.readOnly = true;

  const actions = [];
  if (onImport) actions.push({ icon: importIcon, label: "Import JSON", onClick: onImport });
  if (onExport) actions.push({ icon: exportIcon, label: "Export JSON", onClick: onExport });
  actions.push({ icon: "tabler:copy", label: "Copy to clipboard" });

  const { section, header, panel, toggle, actionButtons, setCollapsed } = createCollapsibleSection({
    label,
    id,
    collapsed,
    className,
    helpTopic,
    actions,
    content: textarea,
  });
  // Copy is always the LAST built action button regardless of whether
  // Import/Export precede it, so indexing from the end stays correct
  // whichever optional buttons are present.
  const copyButton = actionButtons[actionButtons.length - 1];
  const importButton = onImport ? actionButtons[0] : null;
  const exportButton = onExport ? actionButtons[onImport ? 1 : 0] : null;

  bindCopyButton(copyButton, textarea);

  const render = createJsonPreviewRenderer({
    resolvePreviewElement: () => textarea,
    resolveBytesElement: () => copyButton,
    serialize: typeof getData === "function" ? getData : () => getData,
  });

  return { section, header, panel, toggle, textarea, copyButton, importButton, exportButton, render, setCollapsed };
}

// A left-pane action toolbar cluster (New/Save/Export/Delete and friends).
// `action` picks the icon/color preset per README's "Toolbar Buttons" color
// table; anything not in ACTION_PRESETS falls back to a plain
// secondary-outline button. Pass `icon`/`variant` to override a preset's
// default for a tool-specific case (Vault's Generate uses "tabler:sparkles"
// instead of "generate"'s own "tabler:flask"; Repository's Duplicate Page
// is `outline-secondary` rather than the usual `outline-success` — existing
// exceptions preserved, not introduced). Pass `primary: true` for the
// "New/Generate is this tool's one true primary activity" case (Crucible/
// Forge/Vault/Sanctum's "Generate", Press's "Print") — swaps that button to
// filled `btn-primary`, no icon/label change. Returns the button nodes in
// order — caller appends them into whatever wrapper it already uses.
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
// input pattern) — the most-repeated shape inside Press's Component
// Inspector. Each field is genuinely one-of-a-kind (different
// id/label/tooltip/attrs), not duplicated content — this factory turns "one
// repeated shape, many distinct configs" into data instead of hand-typed markup.
// `wrapperAttr` is the field's `data-inspector-*` marker (present on EVERY
// field, hidden or not — some stay always visible, e.g. Classes) —
// `hidden: true` additionally sets the `hidden` attribute AND `.hidden =
// true`, matching how the inspector's show/hide logic toggles these.
// `wrapperAttr` may repeat across several fields that show/hide together as
// one group (Press's five `data-inspector-image-field` elements) — that's
// fine, it's just an attribute value, not a unique key.
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
    if (opt.disabled) {
      // disabled on the input actually stops it (a <label> for a disabled
      // input is inert to click/keyboard per the HTML spec); .disabled on
      // the label is purely visual — .btn-check has no other way to dim
      // the label, since it isn't the form control.
      input.disabled = true;
    }

    const label = document.createElement("label");
    label.className = size === "sm" ? "btn btn-outline-secondary btn-sm" : "btn btn-outline-secondary";
    if (opt.disabled) {
      // Bootstrap's documented pattern: .disabled on the label dims it and
      // blocks pointer events (.btn.disabled in Bootstrap's base styling).
      label.classList.add("disabled");
      label.setAttribute("aria-disabled", "true");
    }
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

// The suite-wide "Mode" control — which top-level thing a center pane is
// showing (Repository's Page/Relationships/Timeline, Workbench's Template
// vs. Character). A real button GROUP built on createButtonCheckGroup —
// every option always visible, one marked active, ALWAYS labeled (icon +
// visible text, never icon-only) — deliberately a different shape from
// createCycleToggleButton below (the "View" control): the two axes need to
// look different at a glance, not be the same control reused at two scales.
// Rebuilds `container` fresh on every call (this suite's "no diffing"
// convention); the caller re-invokes this after any value change.
export function createModeToggleGroup({ container, options = [], value, onChange, ariaLabel } = {}) {
  if (!container) return;
  // Disposed before the wipe — a Bootstrap tooltip's popup is a <body>
  // sibling (via Popper), so clearing via innerHTML = "" without disposing
  // first leaves it orphaned on <body> forever. Centralized here so every
  // Mode/View toggle gets it for free.
  disposeTooltips(container);
  container.innerHTML = "";
  const groupName = `mode-toggle-${Math.random().toString(16).slice(2)}`;
  const group = createButtonCheckGroup({
    ariaLabel,
    name: groupName,
    // Deliberately NOT the default groupClassName ("template-radio-group")
    // — that class stacks icon-above-text in a tiny caption, visibly
    // different size/shape than createCycleToggleButton's icon button
    // beside it. mode-toggle-group (shell.css) is icon-LEFT-text-RIGHT at
    // btn-sm instead, so the two controls' heights actually match.
    groupClassName: "btn-group mode-toggle-group",
    size: "sm",
    options: options.map((option) => ({
      id: `${groupName}-${option.value}`,
      value: option.value,
      text: option.label,
      icon: option.icon,
      tooltip: option.tooltip,
      disabled: option.disabled,
    })),
  });
  group.querySelectorAll("input").forEach((input) => {
    input.checked = input.value === value;
    input.addEventListener("change", () => {
      if (input.checked) onChange?.(input.value);
    });
  });
  container.appendChild(group);
  refreshTooltips(container);
}

// The suite-wide "View" control — a secondary axis only meaningful under
// whichever Mode has more than one way to look at it (View/Edit, List/
// Graph, Corkboard/Swimlane). ONE button that cycles through `states` —
// icon-only, sized (`cycle-toggle-btn`, shell.css) to match
// createModeToggleGroup's height. The tooltip names BOTH the current state
// and what clicking switches to ("View — click to change to Edit"), not
// just the destination — a bare "Edit" tooltip on a button showing the
// pencil icon told you what you'd get, not what you're looking at now.
// Deliberately NOT a button group (see createModeToggleGroup above).
// `value` not found in `states` defaults to the first entry.
//
// `container` is optional — when given, this owns the full "dispose old
// tooltip, clear, mount, refresh" lifecycle itself, so a caller rebuilding
// this fresh on every state change can't forget the dispose step and leak a
// stuck tooltip. Omit `container` (Story Board's layout toggle) when the
// caller needs to place the returned button itself.
// Each state is `{value, icon, label, tooltip?}` — `label` is a SHORT name
// ("View", "Swimlane"), used for the default compound tooltip and as the
// fallback if `tooltip` is omitted. `tooltip`, when given, completely
// overrides the auto-generated phrase — for a caller wanting richer
// destination detail than a bare name (Story Board's Corkboard/Swimlane
// toggle keeps its own full descriptions this way).
export function createCycleToggleButton({ container, states = [], value, onSelect } = {}) {
  const currentIndex = Math.max(
    0,
    states.findIndex((state) => state.value === value)
  );
  const currentState = states[currentIndex] || states[0];
  const nextState = states[(currentIndex + 1) % states.length] || states[0];
  const tooltip =
    nextState?.tooltip ||
    (currentState && nextState && currentState !== nextState
      ? `${currentState.label} — click to change to ${nextState.label}`
      : nextState?.label);
  const button = createIconButton({
    icon: nextState?.icon,
    label: tooltip,
    className: "cycle-toggle-btn",
    onClick: () => onSelect?.(nextState?.value),
  });
  if (container) {
    disposeTooltips(container);
    container.innerHTML = "";
    container.appendChild(button);
    refreshTooltips(container);
  }
  return button;
}

// A single form-check checkbox (optionally styled as a switch). `tooltip`
// goes on the LABEL, not the input.
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

// Fixed order: New -> Save -> Duplicate -> Delete -> Undo -> Redo, using
// only the slots a toolbar actually needs. New is always outline-primary,
// never filled — including a generator tool's own "Generate X" button,
// which fills the New slot conceptually. Import/Export live in the JSON
// Data section instead (createJsonDataPanel's own Import -> Export -> Copy
// order); Print and Rename are tool-specific placements outside this
// cluster (Press's standalone Print button, Loom's Rename Mapping), not
// part of the fixed six. Keep a single cluster to 6 buttons or fewer —
// Workbench's left-pane toolbar started wrapping past that point twice.
// Hitting the limit means designing an alternative WITH the user (a
// secondary toolbar, a dropdown of less-common actions), never letting the
// cluster keep growing.
// `disabled: true` only sets the initial state — a REAL `disabled`
// attribute blocks hover entirely, so `label`'s tooltip can't show while
// disabled. A caller needing a working tooltip on a disabled toolbar button
// (Forge/Sanctum/Crucible/Vault's Generate buttons) must call
// setDisabledTooltip(button, reason) itself once the button is in the DOM
// (its wrapper needs a real parent, not yet available here). `label`'s
// attributes are left in place, not stripped, so once setDisabledTooltip's
// wrapper is gone the button's own original tooltip is immediately usable
// again with no extra work.
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
// (optional — Repository's own instance has none) inside a plain `card
// shadow-theme`, shown until something's been generated or selected.
// The small "label above, form-control-sm/form-select-sm control" field —
// used throughout Template/Grid Properties panels and grid-packed
// inspector fields (Position, Image size, Pan/Zoom, Border width/radius)
// that sit dense multiple-to-a-row, as opposed to createFormFloatingField's
// floating-label shape for single-column fields. Pair with createFieldRow
// (inspector-fields.js) for the row/col grid wrapper.
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
  // "label + help span" row every other help-bearing field uses.
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
// picker's replacement for a bare `<select multiple>`. A native multi-
// select forces ctrl/cmd-click to pick more than one option, gives no way
// to search, and its "selected" rows are barely distinguishable at a
// glance — checkboxes fix all three. `maxHeight` caps the scrollable list
// so the whole control stays about the multi-select's footprint rather than
// growing with the option count. Callers populate/read it via
// populateLockedFeaturesCheckList/readLockedFeatureIds (generator-kit.js),
// which look inside for the fixed `data-checklist-search`/
// `data-checklist-options` markers below.
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
// generator-tool property/stat card. Consolidated from Forge's own
// buildFieldCard and Crucible's independently-reinvented buildStatCard so
// every tool's center-pane properties share one look. `.field-inline-edit`
// (shell.css) is the "blend in until hovered/focused" idiom keeping an
// editable value from standing out among read-only ones; works for both
// <input> and <select>.
//
// type: "text" (a free-typed value) or "select" (a fixed-vocabulary pick,
// e.g. Crucible's Creature Type, Vault's Rarity) — `options` is required
// for "select" (`[{value, label}]`). `editable: false` renders a plain
// read-only value line instead (no border/background).
//
// `rerollable` adds a trailing reroll button carrying `data-reroll-attribute`
// (Forge's per-attribute-reroll delegated listener reads this; harmless
// elsewhere). `selectable` adds `data-select-field` (Forge's click-to-
// inspect convention, also Forge-only today).
//
// `colClass` wraps the box in a Bootstrap grid column (the default); pass
// `colClass: null` for the bare box — a flex-row mount like Name/Image
// supplies its own wrapping/sizing.
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
    // .field-inline-edit already sets font-weight: 600 (shell.css) — no
    // fw-semibold needed on top. Compact boxes size the INPUT to the box's
    // own width (flex-grow-1 on a w-100 valueRow), not a fixed rem value —
    // colClass can make a compact box several times wider (Crucible/Forge's
    // 2x/3x stat boxes), and a fixed-width input would leave it mostly empty.
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
      initTooltip(button, { title: `Reroll ${label}` });
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
// class vocabulary Press's own Icon component field uses; pass `sources:
// ["tabler"]` (or any subset getAllIconOptions understands) to search a
// different vocabulary — board.js's card icon field does this, since its
// `icon` value is a `tabler:*` Iconify identifier, not a CSS class.
// Deliberately NOT the same factory as Press's own field: that one resolves
// @binding/=formula preview values through the template's live data
// context, which callers like Orrery's marker icon (a literal string, no
// binding concept) don't need. Commits on "change" (blur/Enter), not every
// keystroke, since callers that rebuild their whole DOM per change (Orrery,
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

  // buildIconPreviewElement handles all three value shapes ddb-*/bi-*/
  // tabler: — getIconTokens alone only recognized bi-*/ddb-*, so a
  // tabler:* value would silently render nothing.
  function updatePreview(nextValue) {
    preview.innerHTML = "";
    const icon = buildIconPreviewElement(nextValue);
    if (icon) preview.appendChild(icon);
  }
  updatePreview(value);

  // Guards against firing onSelect twice for one selection: if the input
  // still has a dirty value when a dropdown row is clicked, and the
  // caller's onSelect synchronously tears down/rebuilds this field's
  // container (Orrery's marker overlay-icon picker does), removing the
  // still-focused input fires a native blur then "change" on the same
  // already-committed value. Tracking the last committed value and
  // skipping a repeat no-op fixes this without suppressing a genuine reselect.
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

// One row in a reference/entity list — a title, an optional description, an
// optional click-to-select (onSelect), optional extra icon-button actions
// before Remove (e.g. an "Open in <Tool>" link-out), and Remove itself.
// Promoted from Sanctum's own local createListRow (Assets/Needs/Features
// rows), which stays as-is rather than migrating; this exists for NEW
// callers (relationship-editor.js first) so a third near-identical
// implementation doesn't get hand-rolled. `actions` are rendered via
// createIconButton, so each gets the same tooltip/sizing suite-wide.
export function createListRow({ title, description, onRemove, removeLabel = "Remove", onSelect, actions = [] }) {
  const row = document.createElement("div");
  row.className = "border rounded-3 p-2 d-flex align-items-start justify-content-between gap-2";

  const info = document.createElement("div");
  info.className = "flex-grow-1";
  const titleEl = document.createElement("div");
  titleEl.className = "fw-semibold";
  // `title` is usually a plain string, but a caller with something inline-
  // referenceable to show (library-reference.js's createReferenceChip) can
  // pass a real DOM node instead.
  if (title instanceof Node) titleEl.appendChild(title);
  else titleEl.textContent = title;
  info.appendChild(titleEl);
  if (description) {
    const descriptionEl = document.createElement("div");
    descriptionEl.className = "small text-body-secondary";
    descriptionEl.textContent = description;
    info.appendChild(descriptionEl);
  }

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "d-flex gap-1 flex-shrink-0";
  actions.forEach(({ icon, label, onClick }) => {
    const button = createIconButton({
      icon,
      label,
      onClick: (event) => {
        event.stopPropagation();
        onClick();
      },
    });
    buttonGroup.appendChild(button);
  });

  if (onRemove) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn btn-outline-danger btn-sm flex-shrink-0";
    removeButton.setAttribute("aria-label", removeLabel);
    removeButton.innerHTML = '<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span>';
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      onRemove();
    });
    buttonGroup.appendChild(removeButton);
    initTooltip(removeButton, { title: removeLabel });
  }

  row.append(info, buttonGroup);
  if (onSelect) {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => onSelect(row));
  }
  return row;
}

// `variant: "inline"` — a condensed, left-aligned, card-free rendering used
// by the generator tools' Mode/View header row, where the "Nothing selected
// yet" message sits flush in-line instead of as a separate full-width card.
// Default (no variant) stays the original full card — Repository/Orrery/
// graph-view.js still want that.
export function createEmptyStateCard({ icon, message, variant } = {}) {
  if (variant === "inline") {
    const wrap = document.createElement("div");
    wrap.className = "d-inline-flex align-items-center gap-2 text-body-secondary small";
    if (icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "iconify";
      iconEl.dataset.icon = icon;
      iconEl.setAttribute("aria-hidden", "true");
      wrap.appendChild(iconEl);
    }
    wrap.appendChild(document.createTextNode(message));
    return wrap;
  }
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
