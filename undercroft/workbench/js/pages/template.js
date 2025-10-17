import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { createSortable } from "../lib/dnd.js";
import { renderLayout } from "../lib/renderer.js";

const { status, undoStack } = initAppShell({ namespace: "template" });

const TEMPLATES = [
  {
    id: "tpl.5e.flex-basic",
    title: "5e — Flex Basic",
    path: "data/templates/tpl.5e.flex-basic.json",
  },
];

const SAMPLE_CHARACTER = {
  id: "cha-demo",
  path: "data/characters/cha_01k26cm0jxDR5V4R1Q4N56B5RH.json",
};

let sampleData = null;
let activeTemplate = null;

async function ensureSampleData() {
  if (sampleData) return sampleData;
  try {
    const response = await fetch(SAMPLE_CHARACTER.path);
    sampleData = await response.json();
  } catch (error) {
    console.warn("Unable to load sample character", error);
    sampleData = {};
  }
  return sampleData;
}

const elements = {
  templateSelect: document.querySelector("[data-template-select]"),
  palette: document.querySelector("[data-palette]"),
  canvasRoot: document.querySelector("[data-canvas-root]"),
  inspector: document.querySelector("[data-inspector]"),
  previewRoot: document.querySelector("[data-preview-root]"),
  saveButton: document.querySelector('[data-action="save-template"]'),
  clearButton: document.querySelector('[data-action="clear-canvas"]'),
  importButton: document.querySelector('[data-action="import-template"]'),
  exportButton: document.querySelector('[data-action="export-template"]'),
  rightPane: document.querySelector('[data-pane="right"]'),
  rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
};

if (window.bootstrap && typeof window.bootstrap.Tooltip === "function") {
  const tooltipTriggers = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggers.forEach((element) => {
    // eslint-disable-next-line no-new
    new window.bootstrap.Tooltip(element);
  });
}

if (elements.templateSelect) {
  populateSelect(
    elements.templateSelect,
    TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.title }))
  );
  elements.templateSelect.addEventListener("change", async () => {
    const selected = TEMPLATES.find((tpl) => tpl.id === elements.templateSelect.value);
    if (!selected) {
      activeTemplate = null;
      if (elements.previewRoot) {
        elements.previewRoot.innerHTML =
          '<p class="border border-dashed rounded-3 p-4 fs-6 text-body-secondary mb-0">Select a template to see the rendered output.</p>';
      }
      return;
    }
    try {
      const response = await fetch(selected.path);
      activeTemplate = await response.json();
      const character = await ensureSampleData();
      renderPreview(activeTemplate, character);
      status.show(`Loaded ${activeTemplate.title}`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.error("Unable to load template", error);
      status.show("Failed to load template", { type: "error", timeout: 2500 });
    }
  });
}

function renderPreview(template, character) {
  if (!elements.previewRoot) return;
  elements.previewRoot.innerHTML = "";
  if (!template || !template.layout) {
    const placeholder = document.createElement("p");
    placeholder.className = "border border-dashed rounded-3 p-4 fs-6 text-body-secondary mb-0";
    placeholder.textContent = "Select a template to see the rendered output.";
    elements.previewRoot.appendChild(placeholder);
    return;
  }
  renderLayout(elements.previewRoot, template.layout, character.data || {});
}

const COMPONENT_DEFINITIONS = {
  input: {
    label: "Input",
    defaults: {
      name: "Input Field",
      variant: "text",
      placeholder: "",
      options: ["Option A", "Option B"],
    },
    supportsBinding: true,
    supportsFormula: true,
    supportsReadOnly: true,
    supportsAlignment: true,
  },
  array: {
    label: "Array",
    defaults: {
      name: "Array",
      variant: "list",
      itemLabel: "Item",
      emptyText: "No entries",
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: false,
  },
  divider: {
    label: "Divider",
    defaults: {
      name: "Divider",
      style: "solid",
      thickness: 2,
    },
    supportsBinding: false,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: false,
  },
  image: {
    label: "Image",
    defaults: {
      name: "Image",
      src: "https://placekitten.com/320/180",
      alt: "Illustration",
      fit: "contain",
      height: 180,
    },
    supportsBinding: false,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: false,
  },
  label: {
    label: "Label",
    defaults: {
      name: "Label",
      text: "Label text",
    },
    supportsBinding: false,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: true,
  },
  container: {
    label: "Container",
    defaults: {
      name: "Container",
      containerType: "columns",
      columns: 2,
      rows: 2,
      tabLabels: ["Tab 1", "Tab 2"],
      gap: 16,
    },
    supportsBinding: false,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: false,
  },
  "linear-track": {
    label: "Linear Track",
    defaults: {
      name: "Linear Track",
      segments: 6,
      activeSegments: [true, true, false, false, false, false],
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: false,
  },
  "circular-track": {
    label: "Circular Track",
    defaults: {
      name: "Circular Track",
      segments: 8,
      activeSegments: [true, true, true, false, false, false, false, false],
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: false,
  },
  "select-group": {
    label: "Select Group",
    defaults: {
      name: "Select Group",
      variant: "pills",
      options: ["Option A", "Option B", "Option C"],
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: true,
    supportsAlignment: true,
  },
  toggle: {
    label: "Toggle",
    defaults: {
      name: "Toggle",
      states: ["Novice", "Skilled", "Expert"],
      activeIndex: 1,
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: true,
    supportsAlignment: false,
  },
};

let componentCounter = 0;

const state = {
  components: [],
  selectedId: null,
};

let canvasSortable = null;

if (elements.palette) {
  createSortable(elements.palette, {
    group: { name: "template-canvas", pull: "clone", put: false },
    sort: false,
    fallbackOnBody: true,
  });
}

if (elements.canvasRoot) {
  elements.canvasRoot.addEventListener("click", (event) => {
    const deleteButton = event.target.closest('[data-action="remove-component"]');
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      removeComponent(deleteButton.dataset.componentId);
      return;
    }
    const target = event.target.closest("[data-component-id]");
    if (!target) return;
    selectComponent(target.dataset.componentId);
  });
}

if (elements.saveButton) {
  elements.saveButton.addEventListener("click", () => {
    undoStack.push({ type: "save", count: state.components.length });
    status.show(`Template draft saved (${state.components.length} components)`, {
      type: "success",
      timeout: 2000,
    });
  });
}

if (elements.clearButton) {
  elements.clearButton.addEventListener("click", () => {
    clearCanvas();
  });
}

if (elements.importButton) {
  elements.importButton.addEventListener("click", () => {
    status.show("Import coming soon", { type: "info", timeout: 2000 });
  });
}

if (elements.exportButton) {
  elements.exportButton.addEventListener("click", () => {
    status.show("Export coming soon", { type: "info", timeout: 2000 });
  });
}

renderCanvas();
renderInspector();

function renderCanvas() {
  if (!elements.canvasRoot) return;
  if (canvasSortable) {
    canvasSortable.destroy();
    canvasSortable = null;
  }
  elements.canvasRoot.innerHTML = "";
  if (!state.components.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "border border-dashed rounded-3 p-4 text-center fs-6 text-body-secondary";
    placeholder.setAttribute("data-canvas-placeholder", "true");
    placeholder.textContent = "Drag components from the library to design your template.";
    elements.canvasRoot.appendChild(placeholder);
  } else {
    const fragment = document.createDocumentFragment();
    state.components.forEach((component) => {
      fragment.appendChild(createComponentElement(component));
    });
    elements.canvasRoot.appendChild(fragment);
  }
  ensureCanvasSortable();
}

function ensureCanvasSortable() {
  if (!elements.canvasRoot) return;
  canvasSortable = createSortable(elements.canvasRoot, {
    group: { name: "template-canvas", pull: true, put: true },
    fallbackOnBody: true,
    onAdd(event) {
      const type = event.item.getAttribute("data-component-type");
      if (type && COMPONENT_DEFINITIONS[type]) {
        const component = createComponent(type);
        const newIndex = typeof event.newIndex === "number" ? event.newIndex : state.components.length;
        state.components.splice(newIndex, 0, component);
        state.selectedId = component.uid;
        undoStack.push({ type: "add", component: { ...component } });
        status.show(`${COMPONENT_DEFINITIONS[type].label} added to canvas`, {
          type: "success",
          timeout: 1800,
        });
        renderCanvas();
        renderInspector();
        expandInspectorPane();
      }
      event.item.remove();
    },
    onUpdate(event) {
      if (event.oldIndex === event.newIndex) return;
      const [moved] = state.components.splice(event.oldIndex, 1);
      state.components.splice(event.newIndex, 0, moved);
      undoStack.push({
        type: "reorder",
        componentId: moved.uid,
        from: event.oldIndex,
        to: event.newIndex,
      });
      status.show("Reordered component", { timeout: 1500 });
      renderCanvas();
    },
  });
}

function createComponent(type) {
  const definition = COMPONENT_DEFINITIONS[type];
  if (!definition) {
    throw new Error(`Unknown component type: ${type}`);
  }
  componentCounter += 1;
  const defaults = cloneDefaults(definition.defaults || {});
  const component = {
    uid: `cmp-${componentCounter}`,
    type,
    id: `cmp-${componentCounter}`,
    name: defaults.name || definition.label,
    textColor: "",
    backgroundColor: "",
    borderColor: "",
    textSize: "md",
    textStyles: { bold: false, italic: false, underline: false },
    align: "start",
    binding: "",
    formula: "",
    readOnly: false,
    ...defaults,
  };
  if (component.activeSegments && Array.isArray(component.activeSegments)) {
    component.activeSegments = component.activeSegments.slice();
  }
  if (component.options && Array.isArray(component.options)) {
    component.options = component.options.slice();
  }
  if (component.tabLabels && Array.isArray(component.tabLabels)) {
    component.tabLabels = component.tabLabels.slice();
  }
  if (component.states && Array.isArray(component.states)) {
    component.states = component.states.slice();
  }
  return component;
}

function createComponentElement(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "template-component border rounded-3 p-3 bg-body shadow-sm d-flex flex-column gap-3";
  wrapper.dataset.componentId = component.uid;
  wrapper.dataset.componentType = component.type;
  wrapper.setAttribute("data-sortable-handle", "true");
  if (state.selectedId === component.uid) {
    wrapper.classList.add("template-component-selected");
  }

  const toolbar = document.createElement("div");
  toolbar.className = "template-component-toolbar";
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm";
  removeButton.dataset.action = "remove-component";
  removeButton.dataset.componentId = component.uid;
  removeButton.setAttribute("aria-label", "Remove component");
  removeButton.innerHTML = '<span class="iconify fs-5" data-icon="tabler:x" aria-hidden="true"></span>';
  toolbar.appendChild(removeButton);
  wrapper.appendChild(toolbar);

  const preview = renderComponentPreview(component);
  wrapper.appendChild(preview);

  if (component.binding || component.formula) {
    const pill = document.createElement("span");
    pill.className = "template-binding-pill badge text-bg-secondary";
    if (component.binding && component.formula) {
      pill.textContent = `${component.binding} • ƒx`;
    } else {
      pill.textContent = component.binding || component.formula;
    }
    wrapper.appendChild(pill);
  }

  applyComponentStyles(wrapper, component);
  return wrapper;
}

function applyComponentStyles(element, component) {
  element.style.color = component.textColor || "";
  element.style.backgroundColor = component.backgroundColor || "";
  if (component.borderColor) {
    element.style.borderColor = component.borderColor;
  } else {
    element.style.removeProperty("border-color");
  }
}

function renderComponentPreview(component) {
  switch (component.type) {
    case "input":
      return renderInputPreview(component);
    case "array":
      return renderArrayPreview(component);
    case "divider":
      return renderDividerPreview(component);
    case "image":
      return renderImagePreview(component);
    case "label":
      return renderLabelPreview(component);
    case "container":
      return renderContainerPreview(component);
    case "linear-track":
      return renderLinearTrackPreview(component);
    case "circular-track":
      return renderCircularTrackPreview(component);
    case "select-group":
      return renderSelectGroupPreview(component);
    case "toggle":
      return renderTogglePreview(component);
    default:
      return document.createTextNode("Unsupported component");
  }
}

function renderInputPreview(component) {
  const container = document.createElement("div");
  container.className = "d-flex flex-column gap-2";
  const label = document.createElement("label");
  label.className = "form-label mb-1";
  label.textContent = component.name || "Input";
  applyTextFormatting(label, component);
  container.appendChild(label);

  let control;
  switch (component.variant) {
    case "number": {
      control = document.createElement("input");
      control.type = "number";
      control.className = "form-control";
      control.placeholder = component.placeholder || "";
      break;
    }
    case "select": {
      control = document.createElement("select");
      control.className = "form-select";
      const options = Array.isArray(component.options) && component.options.length
        ? component.options
        : ["Option A", "Option B"];
      options.forEach((option) => {
        const opt = document.createElement("option");
        opt.textContent = option;
        control.appendChild(opt);
      });
      break;
    }
    case "radio": {
      control = renderChoiceGroup(component, "radio");
      break;
    }
    case "checkbox": {
      control = renderChoiceGroup(component, "checkbox");
      break;
    }
    default: {
      control = document.createElement("input");
      control.type = "text";
      control.className = "form-control";
      control.placeholder = component.placeholder || "";
      break;
    }
  }
  if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
    control.disabled = !!component.readOnly;
  }
  container.appendChild(control);
  return container;
}

function renderChoiceGroup(component, type) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-wrap gap-2";
  const options = Array.isArray(component.options) && component.options.length
    ? component.options
    : ["Option A", "Option B", "Option C"];
  options.forEach((option, index) => {
    const id = toId([component.uid, type, option, index]);
    const formCheck = document.createElement("div");
    formCheck.className = "form-check form-check-inline";
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = type;
    input.name = `${component.uid}-${type}`;
    input.id = id;
    input.disabled = !!component.readOnly;
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = option;
    formCheck.append(input, label);
    wrapper.appendChild(formCheck);
  });
  return wrapper;
}

function renderArrayPreview(component) {
  const container = document.createElement("div");
  container.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = component.name || "Array";
  applyTextFormatting(heading, component);
  container.appendChild(heading);

  if (component.variant === "cards") {
    const grid = document.createElement("div");
    grid.className = "row g-2";
    for (let index = 0; index < 2; index += 1) {
      const col = document.createElement("div");
      col.className = "col-12 col-md-6";
      const card = document.createElement("div");
      card.className = "border rounded-3 p-3 bg-body";
      card.innerHTML = `<div class=\"fw-semibold\">${component.itemLabel || "Item"} ${index + 1}</div><div class=\"text-body-secondary small\">${component.emptyText || "Repeatable entry"}</div>`;
      col.appendChild(card);
      grid.appendChild(col);
    }
    container.appendChild(grid);
  } else {
    const list = document.createElement("ul");
    list.className = "list-group";
    for (let index = 0; index < 3; index += 1) {
      const item = document.createElement("li");
      item.className = "list-group-item d-flex justify-content-between align-items-center";
      item.textContent = `${component.itemLabel || "Item"} ${index + 1}`;
      const badge = document.createElement("span");
      badge.className = "badge text-bg-secondary";
      badge.textContent = "Value";
      item.appendChild(badge);
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  if (component.emptyText) {
    const empty = document.createElement("div");
    empty.className = "text-body-secondary small";
    empty.textContent = component.emptyText;
    container.appendChild(empty);
  }
  return container;
}

function renderDividerPreview(component) {
  const hr = document.createElement("hr");
  hr.className = "my-2";
  hr.style.borderStyle = component.style || "solid";
  hr.style.borderWidth = `${component.thickness || 2}px`;
  if (component.borderColor) {
    hr.style.borderColor = component.borderColor;
  }
  return hr;
}

function renderImagePreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "text-center";
  const img = document.createElement("img");
  img.className = "img-fluid rounded";
  img.src = component.src || "https://placekitten.com/320/180";
  img.alt = component.alt || "Image";
  img.style.objectFit = component.fit === "cover" ? "cover" : "contain";
  img.style.width = "100%";
  if (component.height) {
    img.style.maxHeight = `${component.height}px`;
  }
  wrapper.appendChild(img);
  return wrapper;
}

function renderLabelPreview(component) {
  const text = document.createElement("div");
  text.className = "fw-semibold";
  text.textContent = component.text || component.name || "Label";
  applyTextFormatting(text, component);
  return text;
}

function renderContainerPreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = component.name || "Container";
  applyTextFormatting(heading, component);
  wrapper.appendChild(heading);

  const body = document.createElement("div");
  body.className = "border rounded-3 bg-body-tertiary p-3 text-body-secondary small";
  switch (component.containerType) {
    case "tabs": {
      const tabs = document.createElement("div");
      tabs.className = "d-flex flex-wrap gap-2 mb-3";
      const labels = Array.isArray(component.tabLabels) && component.tabLabels.length
        ? component.tabLabels
        : ["Tab 1", "Tab 2"];
      labels.forEach((labelText, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `btn btn-outline-secondary btn-sm${index === 0 ? " active" : ""}`;
        button.textContent = labelText;
        tabs.appendChild(button);
      });
      body.appendChild(tabs);
      const content = document.createElement("div");
      content.className = "border rounded-3 bg-body p-3";
      content.textContent = "Tab content area";
      body.appendChild(content);
      break;
    }
    case "grid": {
      const grid = document.createElement("div");
      grid.className = "d-grid";
      const columns = clampInteger(component.columns || 2, 1, 4);
      const rows = clampInteger(component.rows || 2, 1, 4);
      grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      grid.style.gap = `${component.gap ?? 12}px`;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const slot = document.createElement("div");
          slot.className = "border border-dashed rounded-2 p-3 text-center";
          slot.textContent = "Slot";
          grid.appendChild(slot);
        }
      }
      body.appendChild(grid);
      break;
    }
    case "rows": {
      const list = document.createElement("div");
      list.className = "d-flex flex-column";
      list.style.gap = `${component.gap ?? 12}px`;
      const rows = clampInteger(component.rows || 3, 1, 6);
      for (let index = 0; index < rows; index += 1) {
        const row = document.createElement("div");
        row.className = "border border-dashed rounded-2 p-3 text-center";
        row.textContent = `Row ${index + 1}`;
        list.appendChild(row);
      }
      body.appendChild(list);
      break;
    }
    default: {
      const columns = clampInteger(component.columns || 2, 1, 4);
      const row = document.createElement("div");
      row.className = "row g-2";
      for (let index = 0; index < columns; index += 1) {
        const col = document.createElement("div");
        col.className = "col";
        const slot = document.createElement("div");
        slot.className = "border border-dashed rounded-2 p-3 text-center";
        slot.textContent = `Column ${index + 1}`;
        col.appendChild(slot);
        row.appendChild(col);
      }
      body.appendChild(row);
      break;
    }
  }
  wrapper.appendChild(body);
  return wrapper;
}

function renderLinearTrackPreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = component.name || "Track";
  applyTextFormatting(heading, component);
  wrapper.appendChild(heading);

  const track = document.createElement("div");
  track.className = "template-linear-track";
  const activeSegments = ensureSegmentArray(component);
  activeSegments.forEach((isActive, index) => {
    const segment = document.createElement("div");
    segment.className = "template-linear-track__segment";
    if (isActive) {
      segment.classList.add("is-active");
    }
    segment.title = `Segment ${index + 1}`;
    track.appendChild(segment);
  });
  wrapper.appendChild(track);
  return wrapper;
}

function renderCircularTrackPreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = component.name || "Clock";
  applyTextFormatting(heading, component);
  wrapper.appendChild(heading);

  const circle = document.createElement("div");
  circle.className = "template-circular-track";
  const activeSegments = ensureSegmentArray(component);
  const segments = activeSegments.length || 1;
  const step = 360 / segments;
  const gradientStops = [];
  activeSegments.forEach((isActive, index) => {
    const start = index * step;
    const end = start + step;
    const color = isActive ? "var(--bs-primary)" : "var(--bs-border-color)";
    gradientStops.push(`${color} ${start}deg ${end}deg`);
  });
  circle.style.background = `conic-gradient(${gradientStops.join(", ")})`;
  const mask = document.createElement("div");
  mask.className = "template-circular-track__mask";
  circle.appendChild(mask);
  const value = document.createElement("div");
  value.className = "template-circular-track__value";
  value.textContent = `${activeSegments.filter(Boolean).length}/${segments}`;
  circle.appendChild(value);
  wrapper.appendChild(circle);
  return wrapper;
}

function renderSelectGroupPreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = component.name || "Select";
  applyTextFormatting(heading, component);
  wrapper.appendChild(heading);

  const options = Array.isArray(component.options) && component.options.length
    ? component.options
    : ["Option A", "Option B", "Option C"];
  let control;
  if (component.variant === "tags") {
    control = document.createElement("div");
    control.className = "d-flex flex-wrap gap-2";
    options.forEach((option) => {
      const badge = document.createElement("span");
      badge.className = "badge rounded-pill text-bg-secondary";
      badge.textContent = option;
      control.appendChild(badge);
    });
  } else if (component.variant === "buttons") {
    control = document.createElement("div");
    control.className = "btn-group";
    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn btn-outline-secondary${index === 0 ? " active" : ""}`;
      if (component.readOnly) {
        button.classList.add("disabled");
      }
      button.textContent = option;
      control.appendChild(button);
    });
  } else {
    control = document.createElement("div");
    control.className = "d-flex flex-wrap gap-2";
    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-secondary btn-sm rounded-pill";
      if (component.readOnly) {
        button.classList.add("disabled");
      }
      button.textContent = option;
      control.appendChild(button);
    });
  }
  wrapper.appendChild(control);
  return wrapper;
}

function renderTogglePreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = component.name || "Toggle";
  applyTextFormatting(heading, component);
  wrapper.appendChild(heading);

  const group = document.createElement("div");
  group.className = "btn-group w-100";
  const states = Array.isArray(component.states) && component.states.length
    ? component.states
    : ["State 1", "State 2"];
  states.forEach((state, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-outline-secondary${index === component.activeIndex ? " active" : ""}`;
    if (component.readOnly) {
      button.classList.add("disabled");
    }
    button.textContent = state;
    group.appendChild(button);
  });
  wrapper.appendChild(group);
  return wrapper;
}

function applyTextFormatting(element, component) {
  if (!element) return;
  const classes = [];
  switch (component.textSize) {
    case "sm":
      classes.push("fs-6");
      break;
    case "lg":
      classes.push("fs-5");
      break;
    case "xl":
      classes.push("fs-4");
      break;
    default:
      classes.push("fs-6");
      break;
  }
  if (component.textStyles?.bold) {
    classes.push("fw-semibold");
  }
  if (component.textStyles?.italic) {
    classes.push("fst-italic");
  }
  if (component.textStyles?.underline) {
    classes.push("text-decoration-underline");
  }
  element.classList.add(...classes);
  if (component.align === "center") {
    element.classList.add("text-center");
  } else if (component.align === "end") {
    element.classList.add("text-end");
  } else if (component.align === "justify") {
    element.style.textAlign = "justify";
  } else {
    element.classList.add("text-start");
  }
}

function selectComponent(uid) {
  if (state.selectedId === uid) {
    expandInspectorPane();
    return;
  }
  state.selectedId = uid;
  renderCanvas();
  renderInspector();
  expandInspectorPane();
}

function expandInspectorPane() {
  if (!elements.rightPane) return;
  const collapsedClass = elements.rightPane.getAttribute("data-pane-collapsed-class") || "hidden";
  const expandedClass = elements.rightPane.getAttribute("data-pane-expanded-class") || "flex";
  elements.rightPane.dataset.state = "expanded";
  elements.rightPane.classList.remove(collapsedClass);
  elements.rightPane.classList.add(expandedClass);
  if (elements.rightPaneToggle) {
    elements.rightPaneToggle.setAttribute("aria-expanded", "true");
    elements.rightPaneToggle.dataset.active = "true";
  }
}

function clearCanvas() {
  if (!state.components.length) {
    status.show("Canvas is already empty", { timeout: 1200 });
    return;
  }
  state.components = [];
  state.selectedId = null;
  undoStack.push({ type: "clear" });
  status.show("Cleared template canvas", { type: "info", timeout: 1500 });
  renderCanvas();
  renderInspector();
}

function removeComponent(uid) {
  const index = state.components.findIndex((component) => component.uid === uid);
  if (index === -1) return;
  const [removed] = state.components.splice(index, 1);
  undoStack.push({ type: "remove", componentId: removed.uid });
  status.show("Removed component", { type: "info", timeout: 1500 });
  if (state.selectedId === uid) {
    state.selectedId = null;
  }
  renderCanvas();
  renderInspector();
}

function renderInspector() {
  if (!elements.inspector) return;
  elements.inspector.innerHTML = "";
  const component = state.components.find((item) => item.uid === state.selectedId);
  if (!component) {
    const placeholder = document.createElement("p");
    placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
    placeholder.textContent = "Select a component on the canvas to edit its settings.";
    elements.inspector.appendChild(placeholder);
    return;
  }
  const definition = COMPONENT_DEFINITIONS[component.type] || {};
  const form = document.createElement("form");
  form.className = "d-flex flex-column gap-4";
  form.addEventListener("submit", (event) => event.preventDefault());

  const basicsSection = createSection("Basics", [
    createTextInput(component, "Component ID", component.id || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.id = value.trim();
      }, { rerenderCanvas: true });
    }, { placeholder: "Unique identifier" }),
    createTextInput(component, "Name", component.name || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.name = value;
        if (draft.text !== undefined && draft.type === "label") {
          draft.text = value;
        }
      }, { rerenderCanvas: true });
    }, { placeholder: "Displayed label" }),
  ]);
  if (basicsSection) {
    form.appendChild(basicsSection);
  }

  const appearanceControls = [
    createColorRow(component),
    createTextSizeControls(component),
    createTextStyleControls(component),
  ];
  if (definition.supportsAlignment !== false) {
    appearanceControls.push(createAlignmentControls(component));
  }
  const appearanceSection = createSection("Appearance", appearanceControls);
  if (appearanceSection) {
    form.appendChild(appearanceSection);
  }

  const dataControls = [];
  if (definition.supportsBinding !== false) {
    dataControls.push(
      createTextInput(
        component,
        "Binding / Scope",
        component.binding || "",
        (value) => {
          updateComponent(
            component.uid,
            (draft) => {
              draft.binding = value.trim();
            },
            { rerenderCanvas: true }
          );
        },
        { placeholder: "@attributes.score" }
      )
    );
  }
  if (definition.supportsFormula !== false) {
    dataControls.push(
      createTextInput(
        component,
        "Formula",
        component.formula || "",
        (value) => {
          updateComponent(
            component.uid,
            (draft) => {
              draft.formula = value.trim();
            },
            { rerenderCanvas: true }
          );
        },
        { placeholder: "Optional formula" }
      )
    );
  }
  const dataSection = createSection("Data", dataControls);
  if (dataSection) {
    form.appendChild(dataSection);
  }

  if (definition.supportsReadOnly) {
    const behaviorSection = createSection("Behavior", [createReadOnlyToggle(component)]);
    if (behaviorSection) {
      form.appendChild(behaviorSection);
    }
  }

  const componentSpecific = createSection(
    "Component Settings",
    renderComponentSpecificInspector(component)
  );
  if (componentSpecific) {
    form.appendChild(componentSpecific);
  }

  elements.inspector.appendChild(form);
}

function createSection(title, controls = []) {
  const filtered = controls.filter(Boolean);
  if (!filtered.length) return null;
  const section = document.createElement("section");
  section.className = "d-flex flex-column gap-3";
  if (title) {
    const heading = document.createElement("div");
    heading.className = "text-uppercase fs-6 fw-semibold text-body-secondary";
    heading.textContent = title;
    section.appendChild(heading);
  }
  filtered.forEach((control) => section.appendChild(control));
  return section;
}

function createColorRow(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const label = document.createElement("div");
  label.className = "fw-semibold text-body-secondary";
  label.textContent = "Colors";
  wrapper.appendChild(label);
  const row = document.createElement("div");
  row.className = "d-flex flex-wrap gap-3 align-items-center";
  row.appendChild(
    createColorInput(component, "Text", component.textColor, (value) => {
      updateComponent(component.uid, (draft) => {
        draft.textColor = value;
      }, { rerenderCanvas: true, rerenderInspector: true });
    })
  );
  row.appendChild(
    createColorInput(component, "Background", component.backgroundColor, (value) => {
      updateComponent(component.uid, (draft) => {
        draft.backgroundColor = value;
      }, { rerenderCanvas: true, rerenderInspector: true });
    })
  );
  row.appendChild(
    createColorInput(component, "Border", component.borderColor, (value) => {
      updateComponent(component.uid, (draft) => {
        draft.borderColor = value;
      }, { rerenderCanvas: true, rerenderInspector: true });
    })
  );
  wrapper.appendChild(row);
  return wrapper;
}

function createColorInput(component, labelText, value, onChange) {
  const container = document.createElement("div");
  container.className = "d-flex align-items-center gap-2";
  const id = toId([component.uid, labelText, "color"]);
  const label = document.createElement("label");
  label.className = "form-label small text-body-secondary mb-0";
  label.setAttribute("for", id);
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "color";
  input.className = "form-control form-control-color";
  input.id = id;
  input.value = value || "#000000";
  input.addEventListener("input", () => {
    onChange(input.value);
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn-outline-secondary btn-sm";
  clear.innerHTML = '<span class="iconify" data-icon="tabler:circle-off" aria-hidden="true"></span>';
  clear.setAttribute("aria-label", `Clear ${labelText.toLowerCase()} color`);
  clear.addEventListener("click", () => {
    onChange("");
  });
  container.append(label, input, clear);
  return container;
}

function createTextSizeControls(component) {
  const options = [
    { value: "sm", label: "Sm" },
    { value: "md", label: "Md" },
    { value: "lg", label: "Lg" },
    { value: "xl", label: "Xl" },
  ];
  return createRadioButtonGroup(component, "Text size", options, component.textSize || "md", (value) => {
    updateComponent(component.uid, (draft) => {
      draft.textSize = value;
    }, { rerenderCanvas: true });
  });
}

function createTextStyleControls(component) {
  const options = [
    { value: "bold", icon: "tabler:bold" },
    { value: "italic", icon: "tabler:italic" },
    { value: "underline", icon: "tabler:underline" },
  ];
  return createToggleButtonGroup(component, "Text style", options, component.textStyles || {}, (key, checked) => {
    updateComponent(component.uid, (draft) => {
      draft.textStyles = { ...(draft.textStyles || {}) };
      draft.textStyles[key] = checked;
    }, { rerenderCanvas: true });
  });
}

function createAlignmentControls(component) {
  const options = [
    { value: "start", icon: "tabler:align-left", label: "Left" },
    { value: "center", icon: "tabler:align-center", label: "Center" },
    { value: "end", icon: "tabler:align-right", label: "Right" },
    { value: "justify", icon: "tabler:align-justified", label: "Justify" },
  ];
  return createRadioButtonGroup(component, "Alignment", options, component.align || "start", (value) => {
    updateComponent(component.uid, (draft) => {
      draft.align = value;
    }, { rerenderCanvas: true });
  });
}

function createReadOnlyToggle(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-check form-switch";
  const id = toId([component.uid, "read-only"]);
  const input = document.createElement("input");
  input.className = "form-check-input";
  input.type = "checkbox";
  input.id = id;
  input.checked = !!component.readOnly;
  input.addEventListener("change", () => {
    updateComponent(component.uid, (draft) => {
      draft.readOnly = input.checked;
    }, { rerenderCanvas: true });
  });
  const label = document.createElement("label");
  label.className = "form-check-label";
  label.setAttribute("for", id);
  label.textContent = "Read only";
  wrapper.append(input, label);
  return wrapper;
}

function createTextInput(component, labelText, value, onInput, { placeholder = "", type = "text" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const id = toId([component.uid, labelText, "input"]);
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.setAttribute("for", id);
  label.textContent = labelText;
  const input = document.createElement("input");
  input.className = "form-control";
  input.type = type;
  input.id = id;
  if (placeholder) input.placeholder = placeholder;
  input.value = value ?? "";
  input.addEventListener("input", () => {
    onInput(input.value);
  });
  wrapper.append(label, input);
  return wrapper;
}

function createTextarea(component, labelText, value, onInput, { rows = 3, placeholder = "" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const id = toId([component.uid, labelText, "textarea"]);
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.setAttribute("for", id);
  label.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.className = "form-control";
  textarea.id = id;
  textarea.rows = rows;
  if (placeholder) textarea.placeholder = placeholder;
  textarea.value = value ?? "";
  textarea.addEventListener("input", () => {
    onInput(textarea.value);
  });
  wrapper.append(label, textarea);
  return wrapper;
}

function createNumberInput(component, labelText, value, onChange, { min, max, step = 1 } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const id = toId([component.uid, labelText, "number"]);
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.setAttribute("for", id);
  label.textContent = labelText;
  const input = document.createElement("input");
  input.className = "form-control";
  input.type = "number";
  input.id = id;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = String(step);
  if (value !== undefined && value !== null) {
    input.value = value;
  }
  input.addEventListener("input", () => {
    const next = input.value === "" ? null : Number(input.value);
    if (next !== null && Number.isNaN(next)) {
      return;
    }
    onChange(next);
  });
  wrapper.append(label, input);
  return wrapper;
}

function createSelect(component, labelText, options, currentIndex, onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const id = toId([component.uid, labelText, "select"]);
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.setAttribute("for", id);
  label.textContent = labelText;
  const select = document.createElement("select");
  select.className = "form-select";
  select.id = id;
  options.forEach((option, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = option;
    if (index === currentIndex) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    onChange(Number(select.value));
  });
  wrapper.append(label, select);
  return wrapper;
}

function createRadioButtonGroup(component, labelText, options, currentValue, onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold text-body-secondary";
  heading.textContent = labelText;
  wrapper.appendChild(heading);
  const group = document.createElement("div");
  group.className = "btn-group";
  const name = toId([component.uid, labelText, "radio"]);
  options.forEach((option, index) => {
    const id = toId([component.uid, labelText, option.value, index]);
    const input = document.createElement("input");
    input.type = "radio";
    input.className = "btn-check";
    input.name = name;
    input.id = id;
    input.value = option.value;
    input.checked = option.value === currentValue;
    input.addEventListener("change", () => {
      if (input.checked) {
        onChange(option.value);
      }
    });
    const label = document.createElement("label");
    label.className = "btn btn-outline-secondary btn-sm";
    label.setAttribute("for", id);
    if (option.icon) {
      label.innerHTML = `<span class="iconify" data-icon="${option.icon}" aria-hidden="true"></span>`;
      if (option.label) {
        label.innerHTML += `<span class="ms-1">${option.label}</span>`;
      }
    } else {
      label.textContent = option.label;
    }
    group.append(input, label);
  });
  wrapper.appendChild(group);
  return wrapper;
}

function createToggleButtonGroup(component, labelText, options, values, onToggle) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold text-body-secondary";
  heading.textContent = labelText;
  wrapper.appendChild(heading);
  const group = document.createElement("div");
  group.className = "btn-group";
  options.forEach((option, index) => {
    const id = toId([component.uid, labelText, option.value, index]);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "btn-check";
    input.id = id;
    input.autocomplete = "off";
    input.checked = !!values[option.value];
    input.addEventListener("change", () => {
      onToggle(option.value, input.checked);
    });
    const label = document.createElement("label");
    label.className = "btn btn-outline-secondary btn-sm";
    label.setAttribute("for", id);
    if (option.icon) {
      label.innerHTML = `<span class="iconify" data-icon="${option.icon}" aria-hidden="true"></span>`;
    }
    if (option.label) {
      label.innerHTML += `<span class="ms-1">${option.label}</span>`;
    }
    group.append(input, label);
  });
  wrapper.appendChild(group);
  return wrapper;
}

function renderComponentSpecificInspector(component) {
  switch (component.type) {
    case "input":
      return renderInputInspector(component);
    case "array":
      return renderArrayInspector(component);
    case "divider":
      return renderDividerInspector(component);
    case "image":
      return renderImageInspector(component);
    case "label":
      return renderLabelInspector(component);
    case "container":
      return renderContainerInspector(component);
    case "linear-track":
    case "circular-track":
      return renderTrackInspector(component);
    case "select-group":
      return renderSelectGroupInspector(component);
    case "toggle":
      return renderToggleInspector(component);
    default:
      return [];
  }
}

function renderInputInspector(component) {
  const controls = [];
  const options = [
    { value: "text", icon: "tabler:letter-case", label: "Text" },
    { value: "number", icon: "tabler:123", label: "Number" },
    { value: "select", icon: "tabler:list-details", label: "Select" },
    { value: "radio", icon: "tabler:circle-dot", label: "Radio" },
    { value: "checkbox", icon: "tabler:checkbox", label: "Checkbox" },
  ];
  controls.push(
    createRadioButtonGroup(component, "Input type", options, component.variant || "text", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.variant = value;
        if ((value === "select" || value === "radio" || value === "checkbox") && (!Array.isArray(draft.options) || !draft.options.length)) {
          draft.options = ["Option A", "Option B"];
        }
      }, { rerenderCanvas: true, rerenderInspector: true });
    })
  );
  controls.push(
    createTextInput(component, "Placeholder", component.placeholder || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.placeholder = value;
      }, { rerenderCanvas: true });
    }, { placeholder: "Shown inside the field" })
  );
  if (["select", "radio", "checkbox"].includes(component.variant)) {
    controls.push(
      createTextarea(component, "Options (one per line)", (component.options || []).join("\n"), (value) => {
        updateComponent(component.uid, (draft) => {
          draft.options = parseLines(value);
        }, { rerenderCanvas: true });
      }, { rows: 3, placeholder: "Choice A\nChoice B" })
    );
  }
  return controls;
}

function renderArrayInspector(component) {
  const controls = [];
  controls.push(
    createRadioButtonGroup(
      component,
      "Layout",
      [
        { value: "list", icon: "tabler:list", label: "List" },
        { value: "cards", icon: "tabler:layout-cards", label: "Cards" },
      ],
      component.variant || "list",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.variant = value;
        }, { rerenderCanvas: true });
      }
    )
  );
  controls.push(
    createTextInput(component, "Item label", component.itemLabel || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.itemLabel = value;
      }, { rerenderCanvas: true });
    })
  );
  controls.push(
    createTextInput(component, "Empty text", component.emptyText || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.emptyText = value;
      }, { rerenderCanvas: true });
    }, { placeholder: "Shown when no items" })
  );
  return controls;
}

function renderDividerInspector(component) {
  const controls = [];
  controls.push(
    createRadioButtonGroup(
      component,
      "Style",
      [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" },
      ],
      component.style || "solid",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.style = value;
        }, { rerenderCanvas: true });
      }
    )
  );
  controls.push(
    createNumberInput(component, "Thickness", component.thickness || 2, (value) => {
      const next = clampInteger(value ?? 1, 1, 6);
      updateComponent(component.uid, (draft) => {
        draft.thickness = next;
      }, { rerenderCanvas: true, rerenderInspector: true });
    }, { min: 1, max: 6 })
  );
  return controls;
}

function renderImageInspector(component) {
  const controls = [];
  controls.push(
    createTextInput(component, "Image URL", component.src || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.src = value;
      }, { rerenderCanvas: true });
    }, { placeholder: "https://" })
  );
  controls.push(
    createTextInput(component, "Alt text", component.alt || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.alt = value;
      }, { rerenderCanvas: true });
    }, { placeholder: "Describe the image" })
  );
  controls.push(
    createRadioButtonGroup(
      component,
      "Fit",
      [
        { value: "contain", label: "Contain" },
        { value: "cover", label: "Cover" },
      ],
      component.fit || "contain",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.fit = value;
        }, { rerenderCanvas: true });
      }
    )
  );
  controls.push(
    createNumberInput(component, "Max height (px)", component.height || 180, (value) => {
      const next = clampInteger(value ?? 180, 80, 600);
      updateComponent(component.uid, (draft) => {
        draft.height = next;
      }, { rerenderCanvas: true });
    }, { min: 80, max: 600, step: 10 })
  );
  return controls;
}

function renderLabelInspector(component) {
  const controls = [];
  controls.push(
    createTextarea(component, "Text", component.text || component.name || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.text = value;
        draft.name = value;
      }, { rerenderCanvas: true });
    }, { rows: 3, placeholder: "Label text" })
  );
  return controls;
}

function renderContainerInspector(component) {
  const controls = [];
  controls.push(
    createRadioButtonGroup(
      component,
      "Layout type",
      [
        { value: "columns", icon: "tabler:columns-3", label: "Columns" },
        { value: "rows", icon: "tabler:layout-rows", label: "Rows" },
        { value: "tabs", icon: "tabler:layout-navbar", label: "Tabs" },
        { value: "grid", icon: "tabler:layout-grid", label: "Grid" },
      ],
      component.containerType || "columns",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.containerType = value;
        }, { rerenderCanvas: true, rerenderInspector: true });
      }
    )
  );
  if (component.containerType === "tabs") {
    controls.push(
      createTextarea(component, "Tab labels (one per line)", (component.tabLabels || []).join("\n"), (value) => {
        updateComponent(component.uid, (draft) => {
          draft.tabLabels = parseLines(value);
        }, { rerenderCanvas: true });
      }, { rows: 3, placeholder: "Details\nInventory" })
    );
  }
  if (component.containerType === "columns" || component.containerType === "grid") {
    controls.push(
      createNumberInput(component, "Columns", component.columns || 2, (value) => {
        const next = clampInteger(value ?? 2, 1, 4);
        updateComponent(component.uid, (draft) => {
          draft.columns = next;
        }, { rerenderCanvas: true, rerenderInspector: true });
      }, { min: 1, max: 4 })
    );
  }
  if (component.containerType === "rows" || component.containerType === "grid") {
    controls.push(
      createNumberInput(component, "Rows", component.rows || 2, (value) => {
        const next = clampInteger(value ?? 2, 1, 6);
        updateComponent(component.uid, (draft) => {
          draft.rows = next;
        }, { rerenderCanvas: true, rerenderInspector: true });
      }, { min: 1, max: 6 })
    );
  }
  controls.push(
    createNumberInput(component, "Gap (px)", component.gap ?? 16, (value) => {
      const next = clampInteger(value ?? 16, 0, 64);
      updateComponent(component.uid, (draft) => {
        draft.gap = next;
      }, { rerenderCanvas: true });
    }, { min: 0, max: 64, step: 4 })
  );
  return controls;
}

function renderTrackInspector(component) {
  const controls = [];
  controls.push(
    createNumberInput(component, "Segments", component.segments || 1, (value) => {
      const next = clampInteger(value ?? 1, 1, 12);
      updateComponent(component.uid, (draft) => {
        setSegmentCount(draft, next);
      }, { rerenderCanvas: true, rerenderInspector: true });
    }, { min: 1, max: 12 })
  );
  controls.push(createSegmentControls(component));
  return controls;
}

function createSegmentControls(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const heading = document.createElement("div");
  heading.className = "fw-semibold text-body-secondary";
  heading.textContent = "Active segments";
  wrapper.appendChild(heading);
  const grid = document.createElement("div");
  grid.className = "d-flex flex-wrap gap-2";
  const segments = ensureSegmentArray(component);
  segments.forEach((isActive, index) => {
    const id = toId([component.uid, "segment", index]);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "btn-check";
    input.id = id;
    input.checked = isActive;
    input.addEventListener("change", () => {
      updateComponent(component.uid, (draft) => {
        const target = ensureSegmentArray(draft);
        target[index] = input.checked;
      }, { rerenderCanvas: true });
    });
    const label = document.createElement("label");
    label.className = "btn btn-outline-secondary btn-sm";
    label.setAttribute("for", id);
    label.textContent = index + 1;
    grid.append(input, label);
  });
  wrapper.appendChild(grid);
  return wrapper;
}

function renderSelectGroupInspector(component) {
  const controls = [];
  controls.push(
    createRadioButtonGroup(
      component,
      "Display",
      [
        { value: "pills", icon: "tabler:toggle-right", label: "Pills" },
        { value: "tags", icon: "tabler:tags", label: "Tags" },
        { value: "buttons", icon: "tabler:switch-3", label: "Buttons" },
      ],
      component.variant || "pills",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.variant = value;
        }, { rerenderCanvas: true });
      }
    )
  );
  controls.push(
    createTextarea(component, "Options (one per line)", (component.options || []).join("\n"), (value) => {
      updateComponent(component.uid, (draft) => {
        draft.options = parseLines(value);
      }, { rerenderCanvas: true });
    }, { rows: 3, placeholder: "Option A\nOption B" })
  );
  return controls;
}

function renderToggleInspector(component) {
  const controls = [];
  controls.push(
    createTextarea(component, "States (one per line)", (component.states || []).join("\n"), (value) => {
      updateComponent(component.uid, (draft) => {
        draft.states = parseLines(value);
        if (!Array.isArray(draft.states) || !draft.states.length) {
          draft.states = ["State 1", "State 2"];
        }
        if (draft.activeIndex >= draft.states.length) {
          draft.activeIndex = draft.states.length - 1;
        }
      }, { rerenderCanvas: true, rerenderInspector: true });
    }, { rows: 3, placeholder: "Novice\nSkilled\nExpert" })
  );
  const states = Array.isArray(component.states) && component.states.length
    ? component.states
    : ["State 1", "State 2"];
  controls.push(
    createSelect(component, "Active state", states, Math.min(component.activeIndex ?? 0, states.length - 1), (index) => {
      updateComponent(component.uid, (draft) => {
        draft.activeIndex = clampInteger(index, 0, states.length - 1);
      }, { rerenderCanvas: true });
    })
  );
  return controls;
}

function updateComponent(uid, mutate, { rerenderCanvas = false, rerenderInspector = false } = {}) {
  const component = state.components.find((item) => item.uid === uid);
  if (!component) return;
  mutate(component);
  if (rerenderCanvas) {
    renderCanvas();
  }
  if (rerenderInspector) {
    renderInspector();
  }
}

function ensureSegmentArray(component) {
  const count = clampInteger(component.segments || (component.activeSegments ? component.activeSegments.length : 1), 1, 12);
  if (!Array.isArray(component.activeSegments)) {
    component.activeSegments = Array.from({ length: count }, (_, index) => index === 0);
  }
  if (component.activeSegments.length < count) {
    const needed = count - component.activeSegments.length;
    component.activeSegments.push(...Array.from({ length: needed }, () => false));
  } else if (component.activeSegments.length > count) {
    component.activeSegments = component.activeSegments.slice(0, count);
  }
  return component.activeSegments;
}

function setSegmentCount(component, next) {
  component.segments = next;
  ensureSegmentArray(component);
}

function parseLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function clampInteger(value, min, max) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return min;
  }
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function cloneDefaults(defaults = {}) {
  return JSON.parse(JSON.stringify(defaults));
}

function toId(parts = []) {
  return parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}
