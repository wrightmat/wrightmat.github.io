import { createCollapseToggleButton, setElementCollapsed } from "./collapsible.js";
import { createFormFloatingField, createButtonCheckGroup, createCheckField } from "./ui-components.js";

// Re-exported so Workbench's Template-view inspector (and any future
// inspector) only ever needs one import source for "plain field" shapes —
// these three live in ui-components.js because they're generic enough for
// non-inspector callers too (Press's Component Inspector uses them
// directly), not because they belong to some other module.
export { createFormFloatingField, createButtonCheckGroup, createCheckField };

// Shared component-inspector control kit — one canonical "labeled field"
// shape used by every tool, replacing what used to be ~8 independently
// hand-built label+input implementations in Workbench alone (see
// feedback_suite_wide_parity_principle / feedback_workbench_renderer_parity
// memory for the full history of why duplicated UI code is the thing to
// avoid in this codebase). Deliberately NOT built on
// workbench/js/lib/component-layout.js's createLabeledField — that helper
// positions a label relative to a rendered COMPONENT's own content
// (component.labelPosition, component.textColor/font via applyFormatting),
// which is the wrong concern for INSPECTOR chrome: an inspector field's own
// label must always look like a normal, static form label regardless of
// whatever the component being edited happens to be configured to look
// like.

let idCounter = 0;
function nextId(prefix) {
  idCounter += 1;
  const slug = String(prefix || "field")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return `${slug || "field"}-${idCounter}`;
}

const FIELD_LABEL_CLASSES = ["form-label", "fw-semibold", "text-body-secondary"];

function createField({ labelText = "", control, labelFor = "", labelTag = "label" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-1";
  if (!(control instanceof Node)) {
    return wrapper;
  }
  if (labelText) {
    const label = document.createElement(labelTag);
    label.classList.add(...FIELD_LABEL_CLASSES);
    if (labelTag === "label" && labelFor) {
      label.setAttribute("for", labelFor);
    }
    label.textContent = labelText;
    wrapper.append(label, control);
  } else {
    wrapper.append(control);
  }
  return wrapper;
}

// Responsive compaction for numeric/short-value fields that belong on one
// row — matches Press's own row g-2/col-* convention exactly (Position,
// Image size, Pan X/Y/Zoom). Pass `columns` for an even N-up grid; omit it
// for a flex-wrap row of variable-width fields. Selects/textareas/choice
// groups should NOT be passed here — they stay full-width, matching
// Press's own rule.
export function createFieldRow(fields, { columns } = {}) {
  const validFields = (fields || []).filter((field) => field instanceof Node);
  if (!validFields.length) {
    return document.createDocumentFragment();
  }
  if (columns) {
    const row = document.createElement("div");
    row.className = "row g-2";
    const colClass = `col-${Math.max(1, Math.min(12, Math.floor(12 / columns)))}`;
    validFields.forEach((field) => {
      const col = document.createElement("div");
      col.className = colClass;
      col.appendChild(field);
      row.appendChild(col);
    });
    return row;
  }
  const row = document.createElement("div");
  row.className = "d-flex gap-2 flex-wrap align-items-start";
  validFields.forEach((field) => {
    field.classList.add("flex-grow-1");
    row.appendChild(field);
  });
  return row;
}

// A stacked small-label-above-input field meant to be paired two-up in a
// createFieldRow(fields, { columns: 2 }) — half the row's width each, not
// the old fixed 4.5rem .inline-compact-input box (too narrow once you're
// actually looking at Thickness/Corner radius or Font size/Line height side
// by side; they should fill the row, same field width Press's own Position
// row uses). Label is .extra-small (0.75rem, common/css/shell.css) rather
// than Bootstrap's .small (0.875em) — a bit smaller again, since these are
// secondary/dense fields, not primary ones. Border's Thickness/Corner
// radius and Text's Font size/Line height both use this pair.
export function createHalfWidthNumberField(labelText, value, onChange, {
  min, max, step = 1, placeholder = "",
  // Workbench's Template editor rebuilds this field fresh per selection and
  // never needs to find it again afterward, so it's fine self-generating an
  // id via nextId(). Press mounts it once and reads/writes it later through
  // its own external data-attribute query (its whole inspector's
  // convention — see mountInspectorField), so it needs a stable, caller-
  // chosen id/dataAttr instead. `onChange` is optional for exactly that
  // reason too: Press wires its own "input" listener externally rather than
  // through this callback.
  id: explicitId, dataAttr, tooltip, tooltipPlacement = "top",
} = {}) {
  const id = explicitId || nextId(labelText);
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-1";
  const label = document.createElement("label");
  label.className = "form-label extra-small text-body-secondary mb-0";
  label.setAttribute("for", id);
  label.textContent = labelText;
  const input = document.createElement("input");
  input.className = "form-control form-control-sm";
  input.type = "number";
  input.id = id;
  if (dataAttr) input.setAttribute(dataAttr, "");
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = String(step);
  if (placeholder) input.placeholder = placeholder;
  if (value !== undefined && value !== null) {
    input.value = value;
  }
  if (tooltip) {
    input.setAttribute("data-bs-toggle", "tooltip");
    input.setAttribute("data-bs-placement", tooltipPlacement);
    input.setAttribute("data-bs-title", tooltip);
  }
  if (typeof onChange === "function") {
    input.addEventListener("input", () => {
      const next = input.value === "" ? null : Number(input.value);
      if (next !== null && Number.isNaN(next)) {
        return;
      }
      onChange(next);
    });
  }
  wrapper.append(label, input);
  return wrapper;
}

// Plain switch — for purely structural/authoring-time booleans with no
// plausible per-character variation (e.g. Repeater's "Header row/column",
// "Fill available width"). For state that plausibly varies by character,
// use createFormulaToggleField instead.
export function createSwitchField(labelText, checked, onChange) {
  const id = nextId(labelText);
  const wrapper = document.createElement("div");
  wrapper.className = "form-check form-switch";
  const input = document.createElement("input");
  input.className = "form-check-input";
  input.type = "checkbox";
  input.id = id;
  input.checked = Boolean(checked);
  input.addEventListener("change", () => onChange(input.checked));
  const label = document.createElement("label");
  label.className = "form-check-label";
  label.setAttribute("for", id);
  label.textContent = labelText;
  wrapper.append(input, label);
  return wrapper;
}

// The unified toggle/formula control — a label, a real toggle switch, and
// a binding/formula input, for boolean-ish properties that plausibly vary
// by character (Visible, Collapsible, Locked). Manually clicking the
// switch works when the binding/formula field is EMPTY. Typing a
// "@binding" or "=formula" into the field is evaluated live (on every
// keystroke) via the injected `evaluate(raw)` callback — the switch
// immediately reflects the truthy/falsy result and becomes disabled
// (visually shows state, isn't manually clickable) while the field has
// content, mirroring the existing componentHasFormula()/isEditable()
// precedent already in this codebase (a formula, when present, always
// wins over manual control). Clearing the field returns manual control.
// `evaluate` is injected rather than imported so this module stays
// dependency-free of any one tool's binding/formula-resolution internals —
// each caller supplies its own (e.g. Workbench's Template editor evaluates
// against sample/preview data via resolvePreviewBindingValue).
export function createFormulaToggleField(labelText, {
  checked = false,
  bindingValue = "",
  onManualChange,
  onBindingChange,
  evaluate,
  placeholder = "@condition or =formula",
} = {}) {
  const id = nextId(labelText);
  const row = document.createElement("div");
  row.className = "d-flex align-items-center gap-2";

  const switchWrapper = document.createElement("div");
  switchWrapper.className = "form-check form-switch mb-0";
  const input = document.createElement("input");
  input.className = "form-check-input";
  input.type = "checkbox";
  input.id = id;
  input.checked = Boolean(checked);
  switchWrapper.appendChild(input);

  const bindingInput = document.createElement("input");
  bindingInput.type = "text";
  bindingInput.className = "form-control form-control-sm flex-grow-1";
  bindingInput.placeholder = placeholder;
  bindingInput.value = bindingValue || "";
  bindingInput.setAttribute("aria-label", `${labelText} condition`);

  function hasBindingContent() {
    return bindingInput.value.trim().length > 0;
  }

  function syncFromBinding() {
    if (!hasBindingContent()) {
      input.disabled = false;
      input.indeterminate = false;
      return;
    }
    input.disabled = true;
    if (typeof evaluate === "function") {
      // `evaluate` may return true/false (a real preview result, e.g. an
      // "@path" resolved against sample data) or undefined (a case the
      // caller genuinely can't preview — e.g. Workbench's Template editor
      // never evaluates "=formula" expressions at all, only bindings, since
      // there's no live record to run a formula against). undefined shows
      // as the checkbox's own native indeterminate (dash) state instead of
      // guessing true or false.
      const result = evaluate(bindingInput.value.trim());
      if (result === undefined) {
        input.indeterminate = true;
      } else {
        input.indeterminate = false;
        input.checked = Boolean(result);
      }
    }
  }

  input.addEventListener("change", () => {
    if (hasBindingContent()) return;
    if (typeof onManualChange === "function") onManualChange(input.checked);
  });

  bindingInput.addEventListener("input", () => {
    if (typeof onBindingChange === "function") onBindingChange(bindingInput.value);
    syncFromBinding();
  });

  syncFromBinding();

  row.append(switchWrapper, bindingInput);
  const field = createField({ labelText, control: row, labelFor: id });

  // For callers that mount this field ONCE and need to push a *different*
  // record's state into it later (Press's static-DOM inspector: one
  // Visible field, re-synced on every canvas selection change) rather than
  // rebuilding it fresh per selection the way Workbench's Template editor
  // does. Bypasses the change/input listeners above (no onManualChange/
  // onBindingChange echo) — this is a resync FROM a node, not a user edit.
  field.switchInput = input;
  field.bindingInput = bindingInput;
  field.syncToggleState = ({ checked: nextChecked = false, bindingValue: nextBindingValue = "" } = {}) => {
    bindingInput.value = nextBindingValue;
    input.checked = Boolean(nextChecked);
    syncFromBinding();
  };

  return field;
}

// Replaces the old, non-collapsible createSection — same visual heading,
// now with a real chevron toggle (createCollapseToggleButton, shared with
// canvas-card.js's collapse-toggle-button usage elsewhere). `defaultCollapsed`
// is the section's normal resting state; `forceOpen` overrides it (e.g. the
// component already has non-default values set for this section — see
// each render*Inspector's own default-open logic). Every *named* section in
// this inspector is collapsible — there's no non-collapsible variant; fields
// that come before the first named section (Type/ID/Label/Binding-Text/etc.)
// are just left unheaded rather than forced into a section that can't
// collapse.
//
// The heading's own class ("text-uppercase fs-6 fw-semibold
// text-body-secondary") is deliberately the exact literal string Press's
// static per-group headings use (press/index.html's data-inspector-*-group
// divs). Press can't call this function — its inspector is static HTML +
// imperative JS show/hide, a different architecture kept as-is on purpose
// (see undercroft/README.md's Code Conventions section, Component Inspector
// standards) — so the two
// tools can't share one runtime code path here. What they DO share: this
// exact class string, the section name list and order (Text, Colors, Border,
// Behavior, Advanced), and the same createCollapseToggleButton primitive
// (common/js/lib/collapsible.js) building the header row's toggle in both
// places (see press/js/app.js's makeInspectorGroupCollapsible). If you
// change this heading's classes, change press/index.html's matching divs
// in the same commit, or the two will drift again.
export function createCollapsibleSection(title, fields, { defaultCollapsed = false, forceOpen = false } = {}) {
  const collapsed = forceOpen ? false : defaultCollapsed;
  const section = document.createElement("section");
  section.className = "d-flex flex-column gap-3";
  const header = document.createElement("div");
  header.className = "d-flex align-items-center justify-content-between gap-2";
  const heading = document.createElement("div");
  heading.className = "text-uppercase fs-6 fw-semibold text-body-secondary";
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "d-flex flex-column gap-3";
  (fields || []).forEach((field) => {
    if (field instanceof Node) body.appendChild(field);
  });
  const { button } = createCollapseToggleButton({
    label: title,
    collapsed,
    onToggle: (isCollapsed) => {
      setElementCollapsed(body, isCollapsed);
    },
  });
  setElementCollapsed(body, collapsed);
  header.append(heading, button);
  section.append(header, body);
  return section;
}

// The Press-style type-summary header: icon + type label + description +
// an optional "In [parent]" breadcrumb when the component is nested inside
// a Container/Repeater. Matches Press's own markup exactly
// (border rounded-3 shadow-sm bg-body d-flex align-items-center gap-2 p-3).
export function createTypeSummaryHeader({ icon, label, description, parentLabel, onSelectParent } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "border rounded-3 shadow-sm bg-body d-flex align-items-center gap-2 p-3";
  const iconEl = document.createElement("span");
  iconEl.className = "iconify fs-4 text-primary";
  iconEl.setAttribute("aria-hidden", "true");
  if (icon) iconEl.dataset.icon = icon;
  const textWrap = document.createElement("div");
  // flex-grow-1 + min-width:0 — a flex item's default min-width is `auto`
  // (sizes to fit its content), which silently defeats descEl's own
  // text-truncate below: without this, a long description (e.g. Toggle's)
  // just widens the whole card instead of ellipsizing, forcing the entire
  // right pane into horizontal scroll.
  textWrap.className = "d-flex flex-column flex-grow-1";
  textWrap.style.minWidth = "0";
  const labelEl = document.createElement("div");
  labelEl.className = "fw-semibold";
  labelEl.textContent = label || "Component";
  textWrap.appendChild(labelEl);
  if (description) {
    const descEl = document.createElement("div");
    descEl.className = "text-body-secondary extra-small text-truncate";
    descEl.textContent = description;
    textWrap.appendChild(descEl);
  }
  if (parentLabel) {
    const parentRow = document.createElement("div");
    parentRow.className = "d-flex align-items-center gap-2 small text-body-secondary";
    const inText = document.createElement("span");
    inText.textContent = "In";
    const parentButton = document.createElement("button");
    parentButton.type = "button";
    parentButton.className = "btn btn-link p-0 align-baseline text-body-secondary";
    parentButton.textContent = parentLabel;
    if (typeof onSelectParent === "function") {
      parentButton.addEventListener("click", onSelectParent);
    }
    parentRow.append(inText, parentButton);
    textWrap.appendChild(parentRow);
  }
  wrapper.append(iconEl, textWrap);
  return wrapper;
}
