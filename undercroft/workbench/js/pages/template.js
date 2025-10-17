import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { createSortable } from "../lib/dnd.js";
const { status, undoStack } = initAppShell({ namespace: "template" });

const TEMPLATES = [
  {
    id: "tpl.5e.flex-basic",
    title: "5e — Flex Basic",
    path: "data/templates/tpl.5e.flex-basic.json",
  },
];

const COMPONENT_ICONS = {
  input: "tabler:forms",
  array: "tabler:list-details",
  divider: "tabler:separator-horizontal",
  image: "tabler:photo",
  label: "tabler:typography",
  container: "tabler:layout-grid-add",
  "linear-track": "tabler:timeline",
  "circular-track": "tabler:gauge",
  "select-group": "tabler:toggle-right",
  toggle: "tabler:adjustments",
};

const elements = {
  templateSelect: document.querySelector("[data-template-select]"),
  palette: document.querySelector("[data-palette]"),
  canvasRoot: document.querySelector("[data-canvas-root]"),
  inspector: document.querySelector("[data-inspector]"),
  saveButton: document.querySelector('[data-action="save-template"]'),
  undoButton: document.querySelector('[data-action="undo-template"]'),
  redoButton: document.querySelector('[data-action="redo-template"]'),
  clearButton: document.querySelector('[data-action="clear-canvas"]'),
  importButton: document.querySelector('[data-action="import-template"]'),
  exportButton: document.querySelector('[data-action="export-template"]'),
  newTemplateButton: document.querySelector('[data-action="new-template"]'),
  newTemplateForm: document.querySelector("[data-new-template-form]"),
  newTemplateId: document.querySelector("[data-new-template-id]"),
  newTemplateTitle: document.querySelector("[data-new-template-title]"),
  newTemplateVersion: document.querySelector("[data-new-template-version]"),
  rightPane: document.querySelector('[data-pane="right"]'),
  rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
};

let newTemplateModalInstance = null;
if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
  const modalElement = document.getElementById("new-template-modal");
  if (modalElement) {
    newTemplateModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
  }
}

function refreshTooltips(root = document) {
  if (!window.bootstrap || typeof window.bootstrap.Tooltip !== "function") return;
  const tooltipTriggers = root.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggers.forEach((element) => {
    const existing = window.bootstrap.Tooltip.getInstance(element);
    if (existing) {
      existing.dispose();
    }
    // eslint-disable-next-line no-new
    new window.bootstrap.Tooltip(element);
  });
}

refreshTooltips(document);

if (elements.templateSelect) {
  populateSelect(
    elements.templateSelect,
    TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.title })),
    { placeholder: "Select template" }
  );
  elements.templateSelect.addEventListener("change", async () => {
    const selected = TEMPLATES.find((tpl) => tpl.id === elements.templateSelect.value);
    if (!selected) {
      state.template = null;
      state.components = [];
      state.selectedId = null;
      containerActiveTabs.clear();
      renderCanvas();
      renderInspector();
      ensureTemplateSelectValue();
      return;
    }
    try {
      const response = await fetch(selected.path);
      const data = await response.json();
      state.template = {
        id: data.id || selected.id,
        title: data.title || selected.title,
        version: data.version || data.metadata?.version || "",
      };
      containerActiveTabs.clear();
      ensureTemplateOption(state.template.id, state.template.title || selected.title);
      ensureTemplateSelectValue();
      status.show(`Loaded ${state.template.title || selected.title}`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.error("Unable to load template", error);
      status.show("Failed to load template", { type: "error", timeout: 2500 });
    }
  });
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
    textControls: true,
    colorControls: ["foreground", "background", "border"],
  },
  array: {
    label: "Array",
    defaults: {
      name: "Array",
      variant: "list",
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: true,
    textControls: true,
    colorControls: ["foreground", "background", "border"],
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
    textControls: false,
    colorControls: ["foreground"],
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
    textControls: false,
    colorControls: [],
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
    textControls: true,
    colorControls: ["foreground", "background", "border"],
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
      zones: {},
    },
    supportsBinding: false,
    supportsFormula: false,
    supportsReadOnly: false,
    supportsAlignment: true,
    textControls: true,
    colorControls: ["foreground", "background", "border"],
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
    supportsAlignment: true,
    textControls: true,
    colorControls: ["foreground", "background", "border"],
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
    supportsAlignment: true,
    textControls: true,
    colorControls: ["foreground", "background", "border"],
  },
  "select-group": {
    label: "Select Group",
    defaults: {
      name: "Select Group",
      variant: "pills",
      multiple: false,
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: true,
    supportsAlignment: true,
    textControls: true,
    colorControls: ["foreground", "background", "border"],
  },
  toggle: {
    label: "Toggle",
    defaults: {
      name: "Toggle",
      states: ["Novice", "Skilled", "Expert"],
      activeIndex: 1,
      shape: "circle",
    },
    supportsBinding: true,
    supportsFormula: false,
    supportsReadOnly: true,
    supportsAlignment: true,
    textControls: true,
    colorControls: ["foreground", "background", "border"],
  },
};

let componentCounter = 0;

const state = {
  template: null,
  components: [],
  selectedId: null,
};

const dropzones = new Map();
const containerActiveTabs = new Map();

function getActiveTabIndex(component, total = 0) {
  if (!component?.uid) return 0;
  const current = containerActiveTabs.get(component.uid) ?? 0;
  if (!Number.isFinite(total) || total <= 0) {
    return Math.max(0, current);
  }
  const maxIndex = Math.max(0, total - 1);
  return Math.min(Math.max(0, current), maxIndex);
}

function setActiveTabIndex(component, index) {
  if (!component?.uid) return;
  containerActiveTabs.set(component.uid, Math.max(0, index));
}

function clearActiveTab(component) {
  if (!component?.uid) return;
  containerActiveTabs.delete(component.uid);
}

const COLOR_FIELD_MAP = {
  foreground: { label: "Foreground/Text", prop: "textColor" },
  background: { label: "Background", prop: "backgroundColor" },
  border: { label: "Border", prop: "borderColor" },
};

function getComponentLabel(component, fallback = "") {
  if (!component) return fallback || "";
  const { type } = component;

  if (Object.prototype.hasOwnProperty.call(component, "label")) {
    const value = typeof component.label === "string" ? component.label.trim() : "";
    if (value) return value;
    return "";
  }

  const candidates = [component.name, component.text];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  const definition = type ? COMPONENT_DEFINITIONS[type] : null;
  if (definition?.label) {
    return definition.label;
  }

  return fallback || "";
}

function getDefinition(component) {
  if (!component) return {};
  return COMPONENT_DEFINITIONS[component.type] || {};
}

function getColorControls(component) {
  const definition = getDefinition(component);
  if (Array.isArray(definition.colorControls)) {
    return definition.colorControls.filter((key) => COLOR_FIELD_MAP[key]);
  }
  return Object.keys(COLOR_FIELD_MAP);
}

function hasTextControls(component) {
  const definition = getDefinition(component);
  if (definition.textControls === false) {
    return false;
  }
  return true;
}

if (elements.palette) {
  createSortable(elements.palette, {
    group: { name: "template-canvas", pull: "clone", put: false },
    sort: false,
    fallbackOnBody: true,
  });
  elements.palette.addEventListener("dblclick", (event) => {
    const paletteItem = event.target.closest("[data-component-type]");
    if (!paletteItem || !elements.palette.contains(paletteItem)) {
      return;
    }
    const { componentType } = paletteItem.dataset;
    if (!componentType || !COMPONENT_DEFINITIONS[componentType]) {
      return;
    }
    const component = createComponent(componentType);
    const definition = COMPONENT_DEFINITIONS[componentType] || {};
    const parentId = "";
    const zoneKey = "root";
    const index = state.components.length;
    insertComponent(parentId, zoneKey, index, component);
    state.selectedId = component.uid;
    undoStack.push({ type: "add", component: { ...component }, parentId, zoneKey, index });
    const label = typeof definition.label === "string" && definition.label ? definition.label : componentType;
    status.show(`${label} added to canvas`, {
      type: "success",
      timeout: 1800,
    });
    renderCanvas();
    renderInspector();
    expandInspectorPane();
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
    const label = state.template?.title || state.template?.id || "Template";
    status.show(`${label} draft saved (${state.components.length} components)`, {
      type: "success",
      timeout: 2000,
    });
  });
}

if (elements.undoButton) {
  elements.undoButton.addEventListener("click", () => {
    status.show("Undo coming soon", { type: "info", timeout: 1800 });
  });
}

if (elements.redoButton) {
  elements.redoButton.addEventListener("click", () => {
    status.show("Redo coming soon", { type: "info", timeout: 1800 });
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

if (elements.newTemplateButton) {
  elements.newTemplateButton.addEventListener("click", () => {
    if (newTemplateModalInstance && elements.newTemplateForm) {
      elements.newTemplateForm.reset();
      if (elements.newTemplateVersion) {
        const defaultVersion = elements.newTemplateVersion.getAttribute("value") || "0.1";
        elements.newTemplateVersion.value = defaultVersion;
      }
      newTemplateModalInstance.show();
      return;
    }
    const id = window.prompt("Enter a template ID", state.template?.id || "");
    if (id === null) return;
    const title = window.prompt("Enter a template title", state.template?.title || "");
    if (title === null) return;
    const version = window.prompt("Enter a version", state.template?.version || "0.1") || "0.1";
    startNewTemplate({ id: id.trim(), title: title.trim(), version: version.trim() });
  });
}

if (elements.newTemplateForm) {
  elements.newTemplateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = elements.newTemplateForm;
    if (typeof form.reportValidity === "function" && !form.reportValidity()) {
      form.classList.add("was-validated");
      return;
    }
    const id = (elements.newTemplateId?.value || "").trim();
    const title = (elements.newTemplateTitle?.value || "").trim();
    const version = ((elements.newTemplateVersion?.value || "0.1").trim() || "0.1");
    if (!id || !title) {
      form.classList.add("was-validated");
      return;
    }
    startNewTemplate({ id, title, version });
    if (newTemplateModalInstance) {
      newTemplateModalInstance.hide();
    }
    form.reset();
    form.classList.remove("was-validated");
  });
}

renderCanvas();
renderInspector();
ensureTemplateSelectValue();

function renderCanvas() {
  if (!elements.canvasRoot) return;
  dropzones.forEach((sortable) => sortable.destroy());
  dropzones.clear();
  elements.canvasRoot.innerHTML = "";
  elements.canvasRoot.dataset.dropzone = "root";
  elements.canvasRoot.dataset.dropzoneParent = "";
  elements.canvasRoot.dataset.dropzoneKey = "root";
  if (!state.components.length) {
    const placeholder = createDropPlaceholder("Drag components from the palette into the canvas below to design your template.");
    placeholder.classList.add("template-drop-placeholder--root");
    elements.canvasRoot.appendChild(placeholder);
  } else {
    const fragment = document.createDocumentFragment();
    state.components.forEach((component) => {
      fragment.appendChild(createComponentElement(component));
    });
    elements.canvasRoot.appendChild(fragment);
  }
  registerDropzones();
  refreshTooltips(elements.canvasRoot);
}

function createDropPlaceholder(text) {
  const placeholder = document.createElement("div");
  placeholder.className = "template-drop-placeholder";
  placeholder.textContent = text;
  placeholder.setAttribute("aria-hidden", "true");
  return placeholder;
}

function registerDropzones() {
  if (!elements.canvasRoot) return;
  const zones = [elements.canvasRoot, ...elements.canvasRoot.querySelectorAll("[data-dropzone]")];
  zones.forEach((zone) => {
    const sortable = createSortable(zone, {
      group: { name: "template-canvas", pull: true, put: true },
      fallbackOnBody: true,
      swapThreshold: 0.65,
      onAdd(event) {
        handleDrop(event);
      },
      onUpdate(event) {
        handleReorder(event);
      },
    });
    dropzones.set(zone, sortable);
  });
}

function handleDrop(event) {
  const parentId = event.to.dataset.dropzoneParent || "";
  const zoneKey = event.to.dataset.dropzoneKey || "root";
  const index = typeof event.newIndex === "number" ? event.newIndex : 0;
  const type = event.item.dataset.componentType;
  const componentId = event.item.dataset.componentId;

  if (type && COMPONENT_DEFINITIONS[type]) {
    const component = createComponent(type);
    insertComponent(parentId, zoneKey, index, component);
    state.selectedId = component.uid;
    undoStack.push({ type: "add", component: { ...component }, parentId, zoneKey, index });
    status.show(`${COMPONENT_DEFINITIONS[type].label} added to canvas`, { type: "success", timeout: 1800 });
    event.item.remove();
    renderCanvas();
    renderInspector();
    expandInspectorPane();
    return;
  }

  if (componentId) {
    if (parentId && (parentId === componentId || isDescendantOf(parentId, componentId))) {
      status.show("Cannot move a component into itself", { type: "error", timeout: 2000 });
      event.item.remove();
      renderCanvas();
      return;
    }
    const moved = moveComponent(componentId, parentId, zoneKey, index);
    if (moved) {
      undoStack.push({ type: "move", componentId, parentId, zoneKey, index });
      status.show("Moved component", { timeout: 1500 });
    }
  }

  event.item.remove();
  renderCanvas();
  renderInspector();
}

function handleReorder(event) {
  const parentId = event.to.dataset.dropzoneParent || "";
  const zoneKey = event.to.dataset.dropzoneKey || "root";
  const componentId = event.item.dataset.componentId;
  if (!componentId) {
    renderCanvas();
    return;
  }
  const collection = getCollection(parentId, zoneKey);
  if (!collection) {
    renderCanvas();
    return;
  }
  const oldIndex = typeof event.oldIndex === "number" ? event.oldIndex : collection.length - 1;
  const newIndex = typeof event.newIndex === "number" ? event.newIndex : oldIndex;
  if (oldIndex === newIndex) {
    return;
  }
  const found = findComponent(componentId);
  if (!found || found.collection !== collection) {
    renderCanvas();
    return;
  }
  const [item] = collection.splice(oldIndex, 1);
  collection.splice(newIndex, 0, item);
  undoStack.push({ type: "reorder", componentId, parentId, zoneKey, oldIndex, newIndex });
  renderCanvas();
  renderInspector();
}

function insertComponent(parentId, zoneKey, index, component) {
  const collection = getCollection(parentId, zoneKey);
  if (!collection) return;
  const safeIndex = Math.min(Math.max(index, 0), collection.length);
  collection.splice(safeIndex, 0, component);
}

function moveComponent(componentId, targetParentId, zoneKey, index) {
  const found = findComponent(componentId);
  if (!found) return false;
  const targetCollection = getCollection(targetParentId, zoneKey);
  if (!targetCollection) return false;
  const [item] = found.collection.splice(found.index, 1);
  const safeIndex = Math.min(Math.max(index, 0), targetCollection.length);
  targetCollection.splice(safeIndex, 0, item);
  return true;
}

function getCollection(parentId, zoneKey) {
  if (!parentId) {
    return state.components;
  }
  const parent = findComponent(parentId);
  if (!parent) {
    return null;
  }
  const component = parent.component;
  if (component.type !== "container") {
    return parent.collection;
  }
  ensureContainerZones(component);
  if (!component.zones) {
    component.zones = {};
  }
  if (!component.zones[zoneKey]) {
    component.zones[zoneKey] = [];
  }
  return component.zones[zoneKey];
}

function findComponent(uid, components = state.components, parent = null, zoneKey = "root") {
  if (!uid) return null;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component.uid === uid) {
      return { component, collection: components, index, parent, zoneKey };
    }
    if (component.type === "container") {
      const zones = ensureContainerZones(component);
      for (const zone of zones) {
        const found = findComponent(uid, zone.components, component, zone.key);
        if (found) return found;
      }
    }
  }
  return null;
}

function isDescendantOf(targetId, ancestorId) {
  if (!targetId || !ancestorId || targetId === ancestorId) {
    return false;
  }
  const ancestor = findComponent(ancestorId);
  if (!ancestor) return false;
  return containsComponent(ancestor.component, targetId);
}

function containsComponent(component, targetId) {
  if (!component || component.type !== "container") return false;
  const zones = ensureContainerZones(component);
  for (const zone of zones) {
    for (const child of zone.components) {
      if (child.uid === targetId) {
        return true;
      }
      if (child.type === "container" && containsComponent(child, targetId)) {
        return true;
      }
    }
  }
  return false;
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
    label: (defaults.label || defaults.name || definition.label || type).trim(),
    name: undefined,
    textColor: "",
    backgroundColor: "",
    borderColor: "",
    textSize: "md",
    textStyles: { bold: false, italic: false, underline: false },
    align: "start",
    binding: "",
    readOnly: false,
    ...defaults,
  };
  if (component.label && typeof component.label === "string") {
    component.label = component.label.trim();
  }
  if (!component.label) {
    component.label = definition.label || type;
  }
  if (component.name === undefined) {
    component.name = component.label;
  }
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
  if (component.zones && typeof component.zones === "object") {
    component.zones = { ...component.zones };
  }
  if (component.type === "container") {
    ensureContainerZones(component);
  }
  return component;
}

function createComponentElement(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "template-component border rounded-3 p-3 bg-body shadow-sm d-flex flex-column gap-2";
  wrapper.dataset.componentId = component.uid;
  wrapper.dataset.componentType = component.type;
  if (state.selectedId === component.uid) {
    wrapper.classList.add("template-component-selected");
  }

  const definition = COMPONENT_DEFINITIONS[component.type] || {};
  const iconName = COMPONENT_ICONS[component.type] || "tabler:app-window";
  const typeLabel = definition.label || component.type;

  const header = document.createElement("div");
  header.className = "template-component-header";
  header.dataset.sortableHandle = "true";

  const actions = document.createElement("div");
  actions.className = "template-component-actions";

  const bindingLabel = (component.binding || component.formula || "").trim();
  if (bindingLabel) {
    const pill = document.createElement("span");
    pill.className = "template-binding-pill badge text-bg-secondary";
    pill.textContent = bindingLabel;
    actions.appendChild(pill);
  }

  const iconButton = document.createElement("span");
  iconButton.className = "template-component-icon d-inline-flex align-items-center justify-content-center";
  iconButton.dataset.bsToggle = "tooltip";
  iconButton.dataset.bsPlacement = "bottom";
  iconButton.dataset.bsTitle = typeLabel;
  iconButton.setAttribute("aria-label", typeLabel);
  iconButton.tabIndex = 0;
  iconButton.innerHTML = `<span class="iconify" data-icon="${iconName}" aria-hidden="true"></span>`;
  actions.appendChild(iconButton);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm";
  removeButton.dataset.action = "remove-component";
  removeButton.dataset.componentId = component.uid;
  removeButton.setAttribute("aria-label", "Remove component");
  removeButton.innerHTML =
    '<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span><span class="visually-hidden">Remove component</span>';
  actions.appendChild(removeButton);

  header.appendChild(actions);
  wrapper.appendChild(header);

  const preview = renderComponentPreview(component);
  wrapper.appendChild(preview);

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

function ensureContainerZones(component) {
  if (!component || component.type !== "container") return [];
  if (!component.zones || typeof component.zones !== "object") {
    component.zones = {};
  }
  const zones = [];
  const validKeys = new Set();

  const registerZone = (key, label) => {
    if (!Array.isArray(component.zones[key])) {
      component.zones[key] = [];
    }
    validKeys.add(key);
    zones.push({ key, label, components: component.zones[key] });
  };

  const type = component.containerType || "columns";
  if (type === "tabs") {
    const labels = Array.isArray(component.tabLabels) && component.tabLabels.length
      ? component.tabLabels
      : ["Tab 1", "Tab 2"];
    labels.forEach((labelText, index) => {
      registerZone(`tab-${index}`, (labelText || `Tab ${index + 1}`).trim() || `Tab ${index + 1}`);
    });
    setActiveTabIndex(component, getActiveTabIndex(component, labels.length));
  } else if (type === "rows") {
    clearActiveTab(component);
    const rows = clampInteger(component.rows || 2, 1, 6);
    for (let index = 0; index < rows; index += 1) {
      registerZone(`row-${index}`, `Row ${index + 1}`);
    }
  } else if (type === "grid") {
    clearActiveTab(component);
    const columns = clampInteger(component.columns || 2, 1, 4);
    const rows = clampInteger(component.rows || 2, 1, 6);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        registerZone(`grid-${row}-${col}`, `Row ${row + 1}, Column ${col + 1}`);
      }
    }
  } else {
    clearActiveTab(component);
    const columns = clampInteger(component.columns || 2, 1, 4);
    for (let index = 0; index < columns; index += 1) {
      registerZone(`col-${index}`, `Column ${index + 1}`);
    }
  }

  Object.keys(component.zones).forEach((key) => {
    if (!validKeys.has(key)) {
      const items = component.zones[key];
      if (Array.isArray(items) && items.length && zones.length) {
        zones[0].components.push(...items);
      }
      delete component.zones[key];
    }
  });

  return zones;
}

function createContainerDropzone(component, zone, { label, hint } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "template-container-zone d-flex flex-column gap-2";
  if (label) {
    const badge = document.createElement("div");
    badge.className = "template-dropzone-label text-body-secondary text-uppercase extra-small";
    badge.textContent = label;
    wrapper.appendChild(badge);
  }
  const drop = document.createElement("div");
  drop.className = "template-dropzone";
  drop.dataset.dropzone = "true";
  drop.dataset.dropzoneParent = component.uid;
  drop.dataset.dropzoneKey = zone.key;
  if (Array.isArray(zone.components) && zone.components.length) {
    zone.components.forEach((child) => {
      drop.appendChild(createComponentElement(child));
    });
  } else {
    const placeholder = createDropPlaceholder(hint || "Drag components here");
    placeholder.classList.add("template-drop-placeholder--compact");
    drop.appendChild(placeholder);
  }
  wrapper.appendChild(drop);
  return wrapper;
}

function pruneContainerState(component) {
  if (!component || component.type !== "container") {
    return;
  }
  clearActiveTab(component);
  const zoneEntries = component.zones && typeof component.zones === "object"
    ? Object.values(component.zones)
    : [];
  zoneEntries.forEach((items) => {
    if (!Array.isArray(items)) return;
    items.forEach((child) => {
      if (child && child.type === "container") {
        pruneContainerState(child);
      }
    });
  });
}

function renderInputPreview(component) {
  const container = document.createElement("div");
  container.className = "d-flex flex-column gap-2";
  const labelText = getComponentLabel(component, "Input");
  if (labelText) {
    const label = document.createElement("label");
    label.className = "form-label mb-1";
    label.textContent = labelText;
    applyTextFormatting(label, component);
    container.appendChild(label);
  }

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
  const headingText = getComponentLabel(component, "Array");
  if (headingText) {
    const heading = document.createElement("div");
    heading.className = "fw-semibold";
    heading.textContent = headingText;
    applyTextFormatting(heading, component);
    container.appendChild(heading);
  }

  const labelFromBinding = (() => {
    const source = (component.binding || "").replace(/^[=@]/, "");
    if (!source) return "Item";
    const parts = source.split(/[.\[\]]/).filter(Boolean);
    if (!parts.length) return "Item";
    const raw = parts[parts.length - 1].replace(/[-_]+/g, " ").trim();
    if (!raw) return "Item";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  })();

  if (component.variant === "cards") {
    const grid = document.createElement("div");
    grid.className = "row g-2";
    for (let index = 0; index < 2; index += 1) {
      const col = document.createElement("div");
      col.className = "col-12 col-md-6";
      const card = document.createElement("div");
      card.className = "border rounded-3 p-3 bg-body";
      const itemLabel = `${labelFromBinding} ${index + 1}`;
      card.innerHTML = `<div class=\"fw-semibold\">${itemLabel}</div><div class=\"text-body-secondary small\">Repeatable entry</div>`;
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
      item.textContent = `${labelFromBinding} ${index + 1}`;
      const badge = document.createElement("span");
      badge.className = "badge text-bg-secondary";
      badge.textContent = "Value";
      item.appendChild(badge);
      list.appendChild(item);
    }
    container.appendChild(list);
  }
  return container;
}

function renderDividerPreview(component) {
  const hr = document.createElement("hr");
  hr.className = "my-2";
  hr.style.borderStyle = component.style || "solid";
  hr.style.borderWidth = `${component.thickness || 2}px`;
  const color = component.textColor || component.borderColor || "";
  if (color) {
    hr.style.borderColor = color;
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
  const value = (component.text || "").trim() || getComponentLabel(component, "");
  if (!value) {
    return document.createDocumentFragment();
  }
  const text = document.createElement("div");
  text.className = "fw-semibold";
  text.textContent = value;
  applyTextFormatting(text, component);
  return text;
}

function renderContainerPreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-3";
  const labelText = getComponentLabel(component, "Container");
  if (labelText) {
    const heading = document.createElement("div");
    heading.className = "fw-semibold";
    heading.textContent = labelText;
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }

  const zones = ensureContainerZones(component);
  const gap = clampInteger(component.gap ?? 16, 0, 64);

  switch (component.containerType) {
    case "tabs": {
      const labels = zones.map((zone) => zone.label);
      const activeIndex = getActiveTabIndex(component, labels.length);
      const nav = document.createElement("div");
      nav.className = "d-flex flex-wrap gap-2";
      labels.forEach((label, index) => {
        const button = document.createElement("button");
        button.type = "button";
        const isActive = index === activeIndex;
        button.className = `btn btn-outline-secondary btn-sm${isActive ? " active" : ""}`;
        button.textContent = label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isActive) return;
          setActiveTabIndex(component, index);
          renderCanvas();
        });
        nav.appendChild(button);
      });
      wrapper.appendChild(nav);

      const zone = zones[activeIndex] || zones[0];
      if (zone) {
        const dropzone = createContainerDropzone(component, zone, {
          label: labels[activeIndex] || zone.label,
          hint: `Drop components for ${labels[activeIndex] || zone.label || "this tab"}`,
        });
        wrapper.appendChild(dropzone);
      }
      break;
    }
    case "grid": {
      const grid = document.createElement("div");
      grid.className = "template-container-grid";
      const columns = clampInteger(component.columns || 2, 1, 4);
      grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      grid.style.gap = `${gap}px`;
      zones.forEach((zone) => {
        grid.appendChild(
          createContainerDropzone(component, zone, {
            label: zone.label,
            hint: `Drop components into ${zone.label}`,
          })
        );
      });
      wrapper.appendChild(grid);
      break;
    }
    case "rows": {
      const list = document.createElement("div");
      list.className = "d-flex flex-column";
      list.style.gap = `${gap}px`;
      zones.forEach((zone) => {
        list.appendChild(
          createContainerDropzone(component, zone, {
            label: zone.label,
            hint: `Drop components into ${zone.label}`,
          })
        );
      });
      wrapper.appendChild(list);
      break;
    }
    default: {
      const grid = document.createElement("div");
      grid.className = "template-container-grid";
      grid.style.gridTemplateColumns = `repeat(${zones.length || 1}, minmax(0, 1fr))`;
      grid.style.gap = `${gap}px`;
      zones.forEach((zone) => {
        grid.appendChild(
          createContainerDropzone(component, zone, {
            label: zone.label,
            hint: `Drop components into ${zone.label}`,
          })
        );
      });
      wrapper.appendChild(grid);
      break;
    }
  }
  return wrapper;
}

function renderLinearTrackPreview(component) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const headingText = getComponentLabel(component, "Track");
  if (headingText) {
    const heading = document.createElement("div");
    heading.className = "fw-semibold";
    heading.textContent = headingText;
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }

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
  const headingText = getComponentLabel(component, "Clock");
  if (headingText) {
    const heading = document.createElement("div");
    heading.className = "fw-semibold";
    heading.textContent = headingText;
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }

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
  const headingText = getComponentLabel(component, "Select");
  if (headingText) {
    const heading = document.createElement("div");
    heading.className = "fw-semibold";
    heading.textContent = headingText;
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }

  const sampleOptions = ["Option A", "Option B", "Option C"];
  let control;
  if (component.variant === "tags") {
    control = document.createElement("div");
    control.className = "template-select-tags d-flex flex-wrap gap-2";
    sampleOptions.forEach((option, index) => {
      const tag = document.createElement("span");
      tag.className = "template-select-tag";
      const slug = option.trim().toLowerCase().replace(/\s+/g, "-");
      tag.textContent = `#${slug || "tag"}`;
      if (component.multiple !== false && index < 2) {
        tag.classList.add("is-active");
      } else if (!component.multiple && index === 0) {
        tag.classList.add("is-active");
      }
      control.appendChild(tag);
    });
  } else if (component.variant === "buttons") {
    control = document.createElement("div");
    control.className = "btn-group";
    sampleOptions.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      const isActive = component.multiple ? index < 2 : index === 0;
      button.className = `btn btn-outline-secondary${isActive ? " active" : ""}`;
      if (component.readOnly) {
        button.classList.add("disabled");
      }
      button.textContent = option;
      control.appendChild(button);
    });
  } else {
    control = document.createElement("div");
    control.className = "d-flex flex-wrap gap-2";
    sampleOptions.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      const isActive = component.multiple ? index < 2 : index === 0;
      button.className = `btn btn-outline-secondary btn-sm rounded-pill${isActive ? " active" : ""}`;
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
  const headingText = getComponentLabel(component, "Toggle");
  if (headingText) {
    const heading = document.createElement("div");
    heading.className = "fw-semibold";
    heading.textContent = headingText;
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }

  const states = Array.isArray(component.states) && component.states.length
    ? component.states
    : ["State 1", "State 2"];
  const shape = component.shape || "circle";
  const activeIndex = Math.max(0, Math.min(component.activeIndex ?? 0, states.length - 1));
  const maxIndex = Math.max(states.length - 1, 1);
  const progress = maxIndex > 0 ? activeIndex / maxIndex : 0;
  const preview = document.createElement("div");
  preview.className = `template-toggle-shape template-toggle-shape--${shape}`;
  if (progress > 0) {
    preview.classList.add("is-active");
  }
  preview.style.setProperty("--template-toggle-level", progress.toFixed(3));
  const opacity = 0.25 + progress * 0.55;
  preview.style.setProperty("--template-toggle-opacity", opacity.toFixed(3));
  preview.setAttribute("aria-label", states[activeIndex] || "Toggle state");
  wrapper.appendChild(preview);

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
  containerActiveTabs.clear();
  undoStack.push({ type: "clear" });
  status.show("Cleared template canvas", { type: "info", timeout: 1500 });
  renderCanvas();
  renderInspector();
}

function removeComponent(uid) {
  const found = findComponent(uid);
  if (!found) return;
  const [removed] = found.collection.splice(found.index, 1);
  pruneContainerState(removed);
  undoStack.push({ type: "remove", componentId: removed.uid, parentId: found.parent?.uid || "", zoneKey: found.zoneKey });
  status.show("Removed component", { type: "info", timeout: 1500 });
  if (state.selectedId === uid) {
    state.selectedId = found.parent?.uid || null;
  }
  renderCanvas();
  renderInspector();
}

function startNewTemplate({ id = "", title = "", version = "0.1" } = {}) {
  const template = createBlankTemplate({ id, title, version });
  if (!template.id || !template.title) {
    status.show("Provide both an ID and title for the template.", { type: "warning", timeout: 2000 });
    return;
  }
  state.template = template;
  state.components = [];
  state.selectedId = null;
  containerActiveTabs.clear();
  componentCounter = 0;
  ensureTemplateOption(template.id, template.title || template.id);
  ensureTemplateSelectValue();
  renderCanvas();
  renderInspector();
  const label = template.title || template.id || "template";
  status.show(`Started ${label}`, { type: "success", timeout: 1800 });
}

function renderInspector() {
  if (!elements.inspector) return;
  elements.inspector.innerHTML = "";
  const selection = findComponent(state.selectedId);
  const component = selection?.component;
  if (!component) {
    const placeholder = document.createElement("p");
    placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
    placeholder.textContent = "Select a component on the canvas to edit its settings.";
    elements.inspector.appendChild(placeholder);
    return;
  }
  const definition = COMPONENT_DEFINITIONS[component.type] || {};
  if (component.type === "container") {
    ensureContainerZones(component);
  }
  const form = document.createElement("form");
  form.className = "d-flex flex-column gap-4";
  form.addEventListener("submit", (event) => event.preventDefault());

  const identityControls = [
    createTextInput(component, "Component ID", component.id || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.id = value.trim();
      }, { rerenderCanvas: true });
    }, { placeholder: "Unique identifier" }),
    createTextInput(component, "Label", getComponentLabel(component), (value) => {
      updateComponent(component.uid, (draft) => {
        const next = value.trim();
        draft.label = next;
        draft.name = next;
        if (draft.text !== undefined && draft.type === "label") {
          draft.text = next;
        }
      }, { rerenderCanvas: true });
    }, { placeholder: "Displayed label" }),
  ].filter(Boolean);
  if (identityControls.length) {
    const identityGroup = document.createElement("div");
    identityGroup.className = "d-flex flex-column gap-3";
    identityControls.forEach((control) => identityGroup.appendChild(control));
    form.appendChild(identityGroup);
  }

  const componentSpecific = createSection(
    "Component Settings",
    renderComponentSpecificInspector(component)
  );
  if (componentSpecific) {
    form.appendChild(componentSpecific);
  }

  const dataControls = [];
  if (definition.supportsBinding !== false || definition.supportsFormula !== false) {
    dataControls.push(
      createTextInput(
        component,
        "Binding / Formula",
        component.binding || component.formula || "",
        (value) => {
          updateComponent(
            component.uid,
            (draft) => {
              draft.binding = value.trim();
              if (Object.prototype.hasOwnProperty.call(draft, "formula")) {
                draft.formula = "";
              }
            },
            { rerenderCanvas: true, rerenderInspector: true }
          );
        },
        { placeholder: "@attributes.score or =SUM(values)" }
      )
    );
  }
  const dataSection = createSection("Data", dataControls);
  if (dataSection) {
    form.appendChild(dataSection);
  }

  const appearanceControls = [];
  const colorControls = getColorControls(component);
  if (colorControls.length) {
    appearanceControls.push(createColorRow(component, colorControls));
  }
  if (hasTextControls(component)) {
    appearanceControls.push(createTextSizeControls(component));
    appearanceControls.push(createTextStyleControls(component));
  }
  if (definition.supportsAlignment !== false && hasTextControls(component)) {
    appearanceControls.push(createAlignmentControls(component));
  }
  const appearanceSection = createSection("Appearance", appearanceControls);
  if (appearanceSection) {
    form.appendChild(appearanceSection);
  }

  if (definition.supportsReadOnly) {
    const behaviorSection = createSection("Behavior", [createReadOnlyToggle(component)]);
    if (behaviorSection) {
      form.appendChild(behaviorSection);
    }
  }

  elements.inspector.appendChild(form);
  refreshTooltips(elements.inspector);
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

function createColorRow(component, keys = []) {
  const controls = keys.filter((key) => COLOR_FIELD_MAP[key]);
  if (!controls.length) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  const label = document.createElement("div");
  label.className = "fw-semibold text-body-secondary";
  label.textContent = "Colors";
  wrapper.appendChild(label);
  const grid = document.createElement("div");
  grid.className = "template-color-grid";
  controls.forEach((key) => {
    const config = COLOR_FIELD_MAP[key];
    grid.appendChild(
      createColorInput(component, config.label, component[config.prop], (value) => {
        updateComponent(component.uid, (draft) => {
          draft[config.prop] = value;
        }, { rerenderCanvas: true, rerenderInspector: true });
      })
    );
  });
  wrapper.appendChild(grid);
  return wrapper;
}

function createColorInput(component, labelText, value, onChange) {
  const container = document.createElement("div");
  container.className = "template-color-control";
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
  const controls = document.createElement("div");
  controls.className = "d-flex align-items-center gap-2";
  controls.appendChild(input);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn-outline-secondary btn-sm";
  clear.innerHTML = '<span class="iconify" data-icon="tabler:circle-off" aria-hidden="true"></span>';
  clear.setAttribute("aria-label", `Clear ${labelText.toLowerCase()} color`);
  clear.setAttribute("data-bs-toggle", "tooltip");
  clear.setAttribute("data-bs-placement", "top");
  clear.setAttribute("data-bs-title", "Reset to default");
  clear.addEventListener("click", () => {
    input.value = "#000000";
    onChange("");
  });
  controls.appendChild(clear);
  container.append(label, controls);
  if (window.bootstrap && typeof window.bootstrap.Tooltip === "function") {
    // eslint-disable-next-line no-new
    new window.bootstrap.Tooltip(clear);
  }
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
  return createInspectorToggleGroup(component, "Text style", options, component.textStyles || {}, (key, checked) => {
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

function createInspectorToggleGroup(component, labelText, options, values, onToggle) {
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
    createRadioButtonGroup(component, "Type", options, component.variant || "text", (value) => {
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
  return [
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
    ),
  ];
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
  return [];
}

function renderContainerInspector(component) {
  const controls = [];
  controls.push(
    createRadioButtonGroup(
      component,
      "Type",
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
          ensureContainerZones(draft);
        }, { rerenderCanvas: true, rerenderInspector: true });
      }
    )
  );
  if (component.containerType === "tabs") {
    controls.push(
    createTextarea(component, "Tab labels (one per line)", (component.tabLabels || []).join("\n"), (value) => {
      updateComponent(component.uid, (draft) => {
        draft.tabLabels = parseLines(value);
        ensureContainerZones(draft);
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
          ensureContainerZones(draft);
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
          ensureContainerZones(draft);
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
      "Type",
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
    createRadioButtonGroup(
      component,
      "Selection",
      [
        { value: "single", label: "Single" },
        { value: "multi", label: "Multi" },
      ],
      component.multiple ? "multi" : "single",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.multiple = value === "multi";
        }, { rerenderCanvas: true });
      }
    )
  );
  return controls;
}

function renderToggleInspector(component) {
  const controls = [];
  controls.push(
    createRadioButtonGroup(
      component,
      "Shape",
      [
        { value: "circle", icon: "tabler:circle", label: "Circle" },
        { value: "square", icon: "tabler:square", label: "Square" },
        { value: "diamond", icon: "tabler:diamond", label: "Diamond" },
        { value: "star", icon: "tabler:star", label: "Star" },
      ],
      component.shape || "circle",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.shape = value;
        }, { rerenderCanvas: true });
      }
    )
  );
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
  const found = findComponent(uid);
  if (!found) return;
  mutate(found.component);
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

function createBlankTemplate({ id = "", title = "", version = "0.1" } = {}) {
  return {
    id: id || "",
    title: title || "",
    version: version || "0.1",
  };
}

function ensureTemplateOption(id, label) {
  if (!elements.templateSelect || !id) {
    return;
  }
  const escaped = escapeCss(id);
  let option = escaped ? elements.templateSelect.querySelector(`option[value="${escaped}"]`) : null;
  if (!option) {
    option = document.createElement("option");
    option.value = id;
    elements.templateSelect.appendChild(option);
  }
  option.textContent = label || id;
}

function ensureTemplateSelectValue() {
  if (!elements.templateSelect) return;
  const id = state.template?.id || "";
  if (!id) {
    elements.templateSelect.value = "";
    return;
  }
  const escaped = escapeCss(id);
  const option = escaped ? elements.templateSelect.querySelector(`option[value="${escaped}"]`) : null;
  if (option) {
    elements.templateSelect.value = id;
  } else {
    elements.templateSelect.value = "";
  }
}

function escapeCss(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}
