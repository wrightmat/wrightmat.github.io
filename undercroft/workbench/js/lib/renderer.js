import { evaluateFormula } from "../../../common/js/lib/formula-engine.js";
import { rollDiceExpression } from "./dice.js";

function resolveBinding(binding, context) {
  if (typeof binding !== "string" || !binding.startsWith("@")) {
    return undefined;
  }
  const path = binding.slice(1).split(".");
  return path.reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}

function createInput(id, type, value) {
  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.value = value ?? "";
  input.className = "form-control";
  return input;
}

function createTextarea(id, value) {
  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.value = value ?? "";
  textarea.rows = 3;
  textarea.className = "form-control";
  return textarea;
}

function createSelect(id, options, value) {
  const select = document.createElement("select");
  select.id = id;
  select.className = "form-select";
  (options || []).forEach((opt) => {
    const option = document.createElement("option");
    if (typeof opt === "string") {
      option.value = opt;
      option.textContent = opt;
    } else {
      option.value = opt.value;
      option.textContent = opt.label;
    }
    if (option.value === value) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  return select;
}

function createCheckbox(id, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-check form-switch d-flex align-items-center gap-2";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = id;
  checkbox.checked = Boolean(value);
  checkbox.className = "form-check-input";
  wrapper.appendChild(checkbox);
  return wrapper;
}

function createToggle(options, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "btn-group flex-wrap";
  wrapper.setAttribute("role", "group");
  (options || []).forEach((opt) => {
    const button = document.createElement("button");
    button.type = "button";
    const optionValue = opt.value || opt;
    button.textContent = opt.label || optionValue;
    const isActive = value === optionValue;
    button.className = isActive
      ? "btn btn-primary btn-sm active"
      : "btn btn-outline-secondary btn-sm";
    wrapper.appendChild(button);
  });
  return wrapper;
}

function createTrack(value, max = 100) {
  const wrapper = document.createElement("div");
  wrapper.className = "progress";
  const fill = document.createElement("div");
  fill.className = "progress-bar bg-info";
  const percentage = Math.max(0, Math.min(1, Number(value || 0) / Number(max || 100)));
  const percentValue = Math.round(percentage * 100);
  fill.style.width = `${percentValue}%`;
  fill.setAttribute("role", "progressbar");
  fill.setAttribute("aria-valuenow", String(percentValue));
  fill.setAttribute("aria-valuemin", "0");
  fill.setAttribute("aria-valuemax", "100");
  wrapper.appendChild(fill);
  return wrapper;
}

function createCircularTrack(value, max = 100, size = 96, color = "#0ea5e9") {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);

  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  track.setAttribute("cx", size / 2);
  track.setAttribute("cy", size / 2);
  track.setAttribute("r", radius);
  track.setAttribute("fill", "transparent");
  track.setAttribute("stroke", "currentColor");
  track.setAttribute("stroke-width", strokeWidth);
  svg.appendChild(track);

  const fill = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fill.setAttribute("cx", size / 2);
  fill.setAttribute("cy", size / 2);
  fill.setAttribute("r", radius);
  fill.setAttribute("fill", "transparent");
  fill.setAttribute("stroke", color);
  fill.setAttribute("stroke-width", strokeWidth);
  const percentage = Math.max(0, Math.min(1, Number(value || 0) / Number(max || 100)));
  fill.setAttribute("stroke-dasharray", `${circumference} ${circumference}`);
  fill.setAttribute("stroke-dashoffset", `${circumference * (1 - percentage)}`);
  fill.setAttribute("stroke-linecap", "round");
  svg.appendChild(fill);

  return svg;
}

function createImagePlaceholder(label) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex align-items-center justify-content-center border border-dashed rounded-4 bg-body-tertiary text-body-secondary fs-6";
  wrapper.style.height = "12rem";
  wrapper.textContent = label || "Image";
  return wrapper;
}

function wrapField(node, element) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const control = element.matches?.("input, select, textarea") ? element : element.querySelector?.("input, select, textarea");
  if (node.label) {
    const label = document.createElement("label");
    if (control && control.id) {
      label.setAttribute("for", control.id);
    }
    label.className = "form-label text-uppercase fw-semibold text-body-secondary mb-0";
    label.textContent = node.label;
    wrapper.appendChild(label);
  }
  wrapper.appendChild(element);
  if (node.hint) {
    const hint = document.createElement("small");
    hint.className = "text-body-secondary";
    hint.textContent = node.hint;
    wrapper.appendChild(hint);
  }
  return wrapper;
}

function generateId(prefix = "field") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function renderField(node, context) {
  const id = node.id || generateId();
  let value = node.bind ? resolveBinding(node.bind, context) : node.value;
  if (node.formula) {
    try {
      value = evaluateFormula(node.formula, context, { rollDice: rollDiceExpression });
    } catch (error) {
      console.warn("Renderer: unable to evaluate formula", error);
    }
  }

  let element;
  switch (node.component) {
    case "input":
      element = createInput(id, node.inputType || "text", value);
      if (node.min !== undefined) element.min = node.min;
      if (node.max !== undefined) element.max = node.max;
      if (node.step !== undefined) element.step = node.step;
      break;
    case "textarea":
      element = createTextarea(id, value);
      if (node.rows) element.rows = node.rows;
      break;
    case "select":
      element = createSelect(id, node.options, value);
      break;
    case "checkbox":
      element = createCheckbox(id, value);
      break;
    case "toggle":
    case "multiStateToggle":
      element = createToggle(node.options, value);
      break;
    case "linearTrack":
      element = createTrack(value, node.max);
      break;
    case "circularTrack":
      element = createCircularTrack(value, node.max, node.size, node.color);
      break;
    case "image":
      element = createImagePlaceholder(node.label);
      break;
    default:
      element = document.createElement("div");
      element.className = "border border-dashed rounded-3 p-3 fs-6 text-body-secondary";
      element.textContent = `Unsupported component: ${node.component}`;
  }

  element.dataset.componentType = node.component;
  element.dataset.sortableHandle = "true";
  if (node.bind) {
    element.dataset.bind = node.bind;
  }
  return wrapField(node, element);
}

function renderStack(node, context) {
  const container = document.createElement("div");
  container.className = "d-flex flex-column";
  const gap = typeof node.gap === "number" ? node.gap : 4;
  container.style.gap = `${gap * 0.25}rem`;
  (node.children || []).forEach((child) => {
    container.appendChild(renderNode(child, context));
  });
  return container;
}

function renderRow(node, context) {
  const container = document.createElement("div");
  container.className = "d-grid";
  const columnCount = (node.columns && node.columns.length) || 1;
  container.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  const gap = typeof node.gap === "number" ? node.gap : 4;
  container.style.gap = `${gap * 0.25}rem`;
  (node.columns || []).forEach((column) => {
    const col = document.createElement("div");
    if (column.span) {
      col.style.gridColumn = `span ${column.span}`;
    }
    col.appendChild(renderNode(column.node, context));
    container.appendChild(col);
  });
  return container;
}

function renderTabs(node, context) {
  const wrapper = document.createElement("div");
  wrapper.className = "card border-0 shadow-theme";
  const tabList = document.createElement("div");
  tabList.className = "nav nav-pills gap-2 px-3 pt-3";
  const panels = document.createElement("div");
  panels.className = "card-body";
  let activeIndex = 0;
  (node.tabs || []).forEach((tab, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tab.label;
    button.className = index === activeIndex ? "btn btn-primary btn-sm active" : "btn btn-outline-secondary btn-sm";
    button.addEventListener("click", () => {
      activeIndex = index;
      Array.from(tabList.children).forEach((child, childIndex) => {
        child.className = childIndex === activeIndex ? "btn btn-primary btn-sm active" : "btn btn-outline-secondary btn-sm";
      });
      Array.from(panels.children).forEach((panel, panelIndex) => {
        panel.classList.toggle("d-none", panelIndex !== activeIndex);
      });
    });
    tabList.appendChild(button);

    const panel = document.createElement("div");
    panel.className = index === activeIndex ? "" : "d-none";
    panel.appendChild(renderNode(tab.node, context));
    panels.appendChild(panel);
  });

  wrapper.appendChild(tabList);
  wrapper.appendChild(panels);
  return wrapper;
}

function renderRepeater(node, context) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-3";
  const header = document.createElement("div");
  header.className = "d-flex align-items-center justify-content-between";
  const title = document.createElement("span");
  title.className = "fs-6 fw-semibold text-body-secondary";
  title.textContent = node.label || "Repeater";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-secondary btn-sm";
  button.textContent = node.addLabel || "Add";
  header.appendChild(title);
  header.appendChild(button);
  wrapper.appendChild(header);

  const items = resolveBinding(node.bind, context) || [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "border border-dashed rounded-3 p-3 fs-6 text-body-secondary";
    empty.textContent = node.emptyText || "No items";
    wrapper.appendChild(empty);
  } else {
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "card border-0 shadow-sm";
      const body = document.createElement("div");
      body.className = "card-body";
      body.appendChild(renderNode(node.template, item));
      card.appendChild(body);
      wrapper.appendChild(card);
    });
  }
  return wrapper;
}

export function renderNode(node, context = {}) {
  if (!node) {
    return document.createComment("empty");
  }
  switch (node.type) {
    case "stack":
      return renderStack(node, context);
    case "row":
      return renderRow(node, context);
    case "tabs":
      return renderTabs(node, context);
    case "repeater":
      return renderRepeater(node, context);
    case "field":
      return renderField(node, context);
    case "group":
      return renderStack(node, context);
    default:
      return document.createComment(`unsupported node: ${node.type}`);
  }
}

export function renderLayout(container, layout, context = {}) {
  container.innerHTML = "";
  container.appendChild(renderNode(layout, context));
}
