import { evaluateFormula } from "./formula-engine.js";

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
  input.className = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  return input;
}

function createTextarea(id, value) {
  const textarea = document.createElement("textarea");
  textarea.id = id;
  textarea.value = value ?? "";
  textarea.rows = 3;
  textarea.className = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  return textarea;
}

function createSelect(id, options, value) {
  const select = document.createElement("select");
  select.id = id;
  select.className = "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition focus:border-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
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
  const wrapper = document.createElement("label");
  wrapper.className = "flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = id;
  checkbox.checked = Boolean(value);
  checkbox.className = "h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400";
  const indicator = document.createElement("span");
  indicator.textContent = "";
  wrapper.appendChild(checkbox);
  wrapper.appendChild(indicator);
  return wrapper;
}

function createToggle(options, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-wrap gap-2";
  (options || []).forEach((opt) => {
    const button = document.createElement("button");
    button.type = "button";
    const optionValue = opt.value || opt;
    button.textContent = opt.label || optionValue;
    const isActive = value === optionValue;
    button.className = `rounded-full border px-4 py-1 text-sm transition ${
      isActive ? "border-sky-500 bg-sky-500 text-white" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
    }`;
    wrapper.appendChild(button);
  });
  return wrapper;
}

function createTrack(value, max = 100) {
  const wrapper = document.createElement("div");
  wrapper.className = "h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800";
  const fill = document.createElement("div");
  fill.className = "h-full rounded-full bg-sky-500 transition-all";
  const percentage = Math.max(0, Math.min(1, Number(value || 0) / Number(max || 100)));
  fill.style.width = `${percentage * 100}%`;
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
  wrapper.className = "flex h-48 w-full items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400";
  wrapper.textContent = label || "Image";
  return wrapper;
}

function wrapField(node, element) {
  const wrapper = document.createElement("div");
  wrapper.className = "space-y-2";
  if (node.label) {
    const label = document.createElement("label");
    label.setAttribute("for", element.id);
    label.className = "block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
    label.textContent = node.label;
    wrapper.appendChild(label);
  }
  wrapper.appendChild(element);
  if (node.hint) {
    const hint = document.createElement("p");
    hint.className = "text-xs text-slate-500 dark:text-slate-400";
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
      value = evaluateFormula(node.formula, context);
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
      element.className = "rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400";
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
  container.className = "flex flex-col gap-4";
  (node.children || []).forEach((child) => {
    container.appendChild(renderNode(child, context));
  });
  return container;
}

function renderRow(node, context) {
  const container = document.createElement("div");
  container.className = `grid gap-${node.gap || 4} sm:grid-cols-${node.columns?.length || 1}`;
  (node.columns || []).forEach((column) => {
    const col = document.createElement("div");
    col.className = column.span ? `sm:col-span-${column.span}` : "";
    col.appendChild(renderNode(column.node, context));
    container.appendChild(col);
  });
  return container;
}

function renderTabs(node, context) {
  const wrapper = document.createElement("div");
  wrapper.className = "rounded-2xl border border-slate-200 bg-white/70 shadow-theme dark:border-slate-700 dark:bg-slate-900/60";
  const tabList = document.createElement("div");
  tabList.className = "flex gap-2 border-b border-slate-200 px-4 py-2 text-sm dark:border-slate-700";
  const panels = document.createElement("div");
  panels.className = "p-4";
  let activeIndex = 0;
  (node.tabs || []).forEach((tab, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tab.label;
    const isActive = index === activeIndex;
    button.className = `rounded-full px-3 py-1 transition ${
      isActive ? "bg-sky-500 text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
    }`;
    button.addEventListener("click", () => {
      activeIndex = index;
      Array.from(tabList.children).forEach((child, childIndex) => {
        child.className = `rounded-full px-3 py-1 transition ${
          childIndex === activeIndex
            ? "bg-sky-500 text-white"
            : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        }`;
      });
      Array.from(panels.children).forEach((panel, panelIndex) => {
        panel.classList.toggle("hidden", panelIndex !== activeIndex);
      });
    });
    tabList.appendChild(button);

    const panel = document.createElement("div");
    panel.className = index === activeIndex ? "" : "hidden";
    panel.appendChild(renderNode(tab.node, context));
    panels.appendChild(panel);
  });

  wrapper.appendChild(tabList);
  wrapper.appendChild(panels);
  return wrapper;
}

function renderRepeater(node, context) {
  const wrapper = document.createElement("div");
  wrapper.className = "space-y-3";
  const header = document.createElement("div");
  header.className = "flex items-center justify-between";
  const title = document.createElement("span");
  title.className = "text-sm font-medium text-slate-600 dark:text-slate-300";
  title.textContent = node.label || "Repeater";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  button.textContent = node.addLabel || "Add";
  header.appendChild(title);
  header.appendChild(button);
  wrapper.appendChild(header);

  const items = resolveBinding(node.bind, context) || [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400";
    empty.textContent = node.emptyText || "No items";
    wrapper.appendChild(empty);
  } else {
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "rounded-xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60";
      card.appendChild(renderNode(node.template, item));
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
