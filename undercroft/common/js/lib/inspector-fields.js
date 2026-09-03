import { createCollapseToggleButton, setElementCollapsed } from "./collapsible.js";
import { createFormFloatingField, createButtonCheckGroup, createCheckField } from "./ui-components.js";

// Re-exported so every inspector (Workbench Template-view, Press) needs
// only one import source for "plain field" shapes, even though these three
// live in ui-components.js for generic non-inspector callers too.
export { createFormFloatingField, createButtonCheckGroup, createCheckField };

// Shared component-inspector control kit — one canonical "labeled field"
// shape for every tool. Deliberately NOT built on component-layout.js's
// createLabeledField: that helper positions a label relative to a rendered
// COMPONENT's own formatting (labelPosition, textColor/font), which is the
// wrong concern for inspector chrome — an inspector field's label must
// always look like a plain static form label regardless of how the
// component being edited is configured to look.

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

// Responsive compaction for numeric/short-value fields on one row (Position,
// Pan X/Y/Zoom) — matches Press's row g-2/col-* convention. Pass `columns`
// for an even N-up grid; omit for a flex-wrap row of variable widths.
// Selects/textareas/choice groups stay full-width, never passed here.
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

// A stacked small-label-above-input field, paired two-up via
// createFieldRow(fields, { columns: 2 }) — fills the row rather than a
// fixed narrow box, since dense pairs like Thickness/Corner radius need
// full width. Label uses .extra-small (0.75rem) rather than Bootstrap's
// .small, since these are secondary fields.
export function createHalfWidthNumberField(labelText, value, onChange, {
  min, max, step = 1, placeholder = "",
  // Workbench's Template editor rebuilds this fresh per selection, so a
  // self-generated id is fine. Press mounts it once and re-queries it later
  // by a stable caller-chosen id/dataAttr, and wires its own "input"
  // listener externally rather than through `onChange`.
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

// The unified toggle/formula control for boolean-ish properties that
// plausibly vary by character (Visible, Collapsible, Locked): a switch plus
// a binding/formula input. The switch is manually clickable only while the
// field is empty; typing "@binding"/"=formula" evaluates live via the
// injected `evaluate(raw)` callback, and the switch becomes disabled and
// shows that result instead (a formula always wins over manual control).
// `evaluate` is injected, not imported, so each caller supplies its own
// resolution against its own data (e.g. Workbench evaluates against preview
// data via resolvePreviewBindingValue).
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
      // undefined means the caller genuinely can't preview this (e.g.
      // Template editor never evaluates "=formula", only bindings, since
      // there's no live record) — shown as native indeterminate, not a guess.
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

  // For callers (Press's static-DOM inspector) that mount this field once
  // and resync it to a different record's state on each selection change,
  // rather than rebuilding fresh like Workbench does. Bypasses the change/
  // input listeners — this is a resync FROM a node, not a user edit.
  field.switchInput = input;
  field.bindingInput = bindingInput;
  field.syncToggleState = ({ checked: nextChecked = false, bindingValue: nextBindingValue = "" } = {}) => {
    bindingInput.value = nextBindingValue;
    input.checked = Boolean(nextChecked);
    syncFromBinding();
  };

  return field;
}

// Every *named* inspector section is collapsible (createCollapseToggleButton)
// — there's no non-collapsible variant. `defaultCollapsed` is the section's
// resting state; `forceOpen` overrides it when the component already has
// non-default values in that section. Fields before the first named section
// (Type/ID/Label/etc.) are left unheaded rather than forced into a section.
//
// The heading class string ("text-uppercase fs-6 fw-semibold
// text-body-secondary") deliberately matches Press's static per-group
// headings (press/index.html's data-inspector-*-group divs) literally —
// Press's inspector is static HTML, a different architecture kept as-is, so
// it can't call this function, but shares this exact class string and the
// same createCollapseToggleButton primitive (see press/js/app.js's
// makeInspectorGroupCollapsible). Change both together or they drift.
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

// Press-style type-summary header: icon + type label + description + an
// optional "In [parent]" breadcrumb for a component nested in a
// Container/Repeater. Markup matches Press's own exactly.
export function createTypeSummaryHeader({ icon, label, description, parentLabel, onSelectParent } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "border rounded-3 shadow-sm bg-body d-flex align-items-center gap-2 p-3";
  const iconEl = document.createElement("span");
  iconEl.className = "iconify fs-4 text-primary";
  iconEl.setAttribute("aria-hidden", "true");
  if (icon) iconEl.dataset.icon = icon;
  const textWrap = document.createElement("div");
  // min-width:0 overrides a flex item's default `auto`, which would
  // otherwise defeat descEl's text-truncate and widen the whole card.
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
