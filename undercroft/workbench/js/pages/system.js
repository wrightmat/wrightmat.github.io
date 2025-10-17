import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../lib/data-manager.js";
import { createCanvasPlaceholder, initPaletteInteractions, setupDropzones } from "../lib/editor-canvas.js";
import { refreshTooltips } from "../lib/tooltips.js";

function resolveApiBase() {
  if (typeof window === "undefined") {
    return "";
  }
  if (window.__WORKBENCH_API_BASE__ && typeof window.__WORKBENCH_API_BASE__ === "string") {
    return window.__WORKBENCH_API_BASE__;
  }
  const { origin, protocol, host } = window.location || {};
  if (origin && origin !== "null") {
    return origin;
  }
  if (protocol && protocol.startsWith("http") && host) {
    return `${protocol}//${host}`;
  }
  return "";
}

const { status, undoStack } = initAppShell({ namespace: "system" });
const dataManager = new DataManager({ baseUrl: resolveApiBase() });

const SYSTEMS = [
  {
    id: "sys.dnd5e",
    title: "D&D 5e (Basic)",
    path: "data/systems/sys.dnd5e.json",
  },
];

const TYPE_DEFS = {
  string: {
    label: "String",
    icon: "tabler:forms",
    description: "Free-form text value",
    palette: true,
  },
  number: {
    label: "Number",
    icon: "tabler:hash",
    description: "Numeric value with limits",
    palette: true,
  },
  boolean: {
    label: "Boolean",
    icon: "tabler:toggle-left",
    description: "True or false value",
    palette: true,
  },
  object: {
    label: "Object",
    icon: "tabler:braces",
    description: "Keyed set of fields",
    palette: true,
  },
  array: {
    label: "Array",
    icon: "tabler:brackets",
    description: "Repeatable entries",
    palette: true,
  },
  group: {
    label: "Group",
    icon: "tabler:stack-2",
    description: "Nest related fields",
  },
  list: {
    label: "List",
    icon: "tabler:list-check",
    description: "Pick from options",
  },
};

const TYPE_ALIASES = {
  integer: "number",
};

function normalizeType(type) {
  if (!type) return "string";
  const raw = String(type).trim().toLowerCase();
  const key = raw in TYPE_DEFS ? raw : TYPE_ALIASES[raw] || raw;
  if (TYPE_DEFS[key]) {
    return key;
  }
  return "string";
}

function isNumericType(type) {
  return normalizeType(type) === "number";
}

function supportsChoices(type) {
  const normalized = normalizeType(type);
  return normalized === "string" || normalized === "list";
}

const elements = {
  select: document.querySelector("[data-system-select]"),
  canvasRoot: document.querySelector("[data-canvas-root]"),
  palette: document.querySelector("[data-palette]"),
  inspector: document.querySelector("[data-inspector]"),
  saveButton: document.querySelector('[data-action="save-system"]'),
  newButton: document.querySelector('[data-action="new-system"]'),
  importButton: document.querySelector('[data-action="import-system"]'),
  exportButton: document.querySelector('[data-action="export-system"]'),
  jsonPreview: document.querySelector("[data-json-preview]"),
  jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
  rightPane: document.querySelector('[data-pane="right"]'),
  rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
  newSystemModal: document.getElementById("new-system-modal"),
  newSystemForm: document.querySelector("[data-new-system-form]"),
  newSystemId: document.querySelector("[data-new-system-id]"),
  newSystemTitle: document.querySelector("[data-new-system-title]"),
  newSystemVersion: document.querySelector("[data-new-system-version]"),
};

refreshTooltips(document);

const state = {
  system: createBlankSystem(),
  selectedNodeId: null,
};

const drafts = new Map();

const dropzones = new Map();
if (elements.palette) {
  initPaletteInteractions(elements.palette, {
    groupName: "system-canvas",
    dataAttribute: "data-palette-type",
    onActivate: ({ value }) => {
      if (!value) {
        return;
      }
      addFieldToRoot(value);
    },
  });
}

let newSystemModalInstance = null;
if (elements.newSystemModal && window.bootstrap && typeof window.bootstrap.Modal === "function") {
  newSystemModalInstance = new window.bootstrap.Modal(elements.newSystemModal);
  elements.newSystemModal.addEventListener("shown.bs.modal", () => {
    if (elements.newSystemId) {
      elements.newSystemId.focus();
      elements.newSystemId.select();
    }
  });
}

if (elements.select) {
  populateSelect(
    elements.select,
    SYSTEMS.map((system) => ({ value: system.id, label: system.title }))
  );
  elements.select.addEventListener("change", async () => {
    persistCurrentDraft();
    const selectedId = elements.select.value;
    if (!selectedId) {
      return;
    }
    if (state.system.id === selectedId) {
      return;
    }

    const draft = restoreDraft(selectedId);
    if (draft) {
      applySystemState(draft, { emitStatus: true, statusMessage: `Restored ${draft.title || selectedId}` });
      return;
    }

    const selected = SYSTEMS.find((system) => system.id === selectedId);
    if (!selected) {
      const fallback = createBlankSystem({ id: selectedId, title: selectedId });
      applySystemState(fallback, { emitStatus: true, statusMessage: `Loaded ${fallback.title}` });
      return;
    }
    try {
      const response = await fetch(selected.path);
      const data = await response.json();
      applySystemData(data, { source: "select" });
      status.show(`Loaded ${data.title}`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.error("Unable to load system", error);
      status.show("Failed to load system", { type: "error", timeout: 2500 });
      ensureSelectValue();
    }
  });
}

if (elements.newButton) {
  elements.newButton.addEventListener("click", () => {
    if (newSystemModalInstance && elements.newSystemForm) {
      elements.newSystemForm.reset();
      elements.newSystemForm.classList.remove("was-validated");
      if (elements.newSystemVersion) {
        const defaultVersion = elements.newSystemVersion.getAttribute("value") || "0.1";
        elements.newSystemVersion.value = defaultVersion;
      }
      newSystemModalInstance.show();
      return;
    }

    const id = window.prompt("Enter a system ID", state.system.id || "");
    if (id === null) {
      return;
    }
    const title = window.prompt("Enter a system title", state.system.title || "");
    if (title === null) {
      return;
    }
    const version = window.prompt("Enter a version", state.system.version || "0.1") || "0.1";
    persistCurrentDraft();
    const blank = createBlankSystem({ id: id.trim(), title: title.trim(), version: version.trim() });
    applySystemState(blank, { emitStatus: true, statusMessage: "Started a new system" });
    ensureSelectOption(blank.id, blank.title);
    if (elements.select) {
      elements.select.value = blank.id || "";
    }
  });
}

if (elements.newSystemForm) {
  elements.newSystemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = elements.newSystemForm;
    if (typeof form.reportValidity === "function" && !form.reportValidity()) {
      form.classList.add("was-validated");
      return;
    }

    const id = (elements.newSystemId?.value || "").trim();
    const title = (elements.newSystemTitle?.value || "").trim();
    const version = ((elements.newSystemVersion?.value || "0.1").trim() || "0.1");

    if (!id || !title) {
      form.classList.add("was-validated");
      return;
    }

    persistCurrentDraft();
    const blank = createBlankSystem({ id, title, version });
    applySystemState(blank, { emitStatus: true, statusMessage: "Started a new system" });
    ensureSelectOption(blank.id, blank.title);
    if (elements.select) {
      elements.select.value = blank.id || "";
    }
    if (newSystemModalInstance) {
      newSystemModalInstance.hide();
    }
    form.reset();
    form.classList.remove("was-validated");
  });
}

if (elements.saveButton) {
  elements.saveButton.addEventListener("click", async () => {
    if (!state.system) {
      return;
    }
    const payload = serializeSystem(state.system);
    const systemId = (payload.id || "").trim();
    if (!systemId) {
      status.show("Set a system ID before saving.", { type: "warning", timeout: 2500 });
      return;
    }
    payload.id = systemId;
    if (state.system.id !== systemId) {
      state.system.id = systemId;
      ensureSelectOption(systemId, payload.title || systemId);
      ensureSelectValue();
    }
    const wantsRemote = dataManager.isAuthenticated();
    if (wantsRemote && !dataManager.baseUrl) {
      status.show("Server connection not configured. Start the Workbench server to save.", {
        type: "error",
        timeout: 3000,
      });
      return;
    }
    const button = elements.saveButton;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const result = await dataManager.save("systems", systemId, payload, {
        mode: wantsRemote ? "remote" : "auto",
      });
      undoStack.push({ type: "save", id: systemId });
      rememberDraft(state.system);
      const savedToServer = result?.source === "remote";
      const label = payload.title || systemId;
      if (savedToServer) {
        status.show(`Saved ${label} to the server`, { type: "success", timeout: 2500 });
      } else {
        status.show(`Saved ${label} locally. Log in to sync with the server.`, {
          type: "info",
          timeout: 3000,
        });
      }
    } catch (error) {
      console.error("Failed to save system", error);
      const message = error?.message || "Unable to save system";
      status.show(message, { type: "error", timeout: 3000 });
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
}

const importInput = document.createElement("input");
importInput.type = "file";
importInput.accept = "application/json";
importInput.className = "visually-hidden";
importInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    persistCurrentDraft();
    applySystemData(data, { source: "import" });
    ensureSelectOption(state.system.id, state.system.title);
    if (elements.select) {
      elements.select.value = state.system.id || "";
    }
    status.show(`Imported ${state.system.title || "system"}`, { type: "success", timeout: 2500 });
  } catch (error) {
    console.error("Failed to import system", error);
    status.show("Import failed. Check the JSON and try again.", { type: "error", timeout: 3000 });
  } finally {
    event.target.value = "";
  }
});
document.body.appendChild(importInput);

if (elements.importButton) {
  elements.importButton.addEventListener("click", () => {
    importInput.click();
  });
}

if (elements.exportButton) {
  elements.exportButton.addEventListener("click", () => {
    const serialized = serializeSystem(state.system);
    const text = JSON.stringify(serialized, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const filename = `${serialized.id || "system"}.json`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    status.show(`Exported ${serialized.title || "system"}`, { type: "success", timeout: 2000 });
  });
}

renderAll();

function createBlankSystem({ id = "", title = "", version = "0.1" } = {}) {
  return {
    id,
    title,
    version,
    fields: [],
    fragments: [],
    metadata: [],
    formulas: [],
    importers: [],
  };
}

function createFieldNode(type = "string", overrides = {}) {
  const normalizedType = normalizeType(type);
  const node = {
    id: generateId(),
    type: normalizedType,
    key: "",
    label: "",
    required: false,
    formula: "",
    minimum: null,
    maximum: null,
    minItems: null,
    maxItems: null,
    optionsFrom: "",
    enum: [],
    itemFragment: "",
    itemKey: "",
    itemLabel: "",
    children: [],
    additional: null,
  };
  node.children = Array.isArray(node.children) ? node.children : [];
  return Object.assign(node, overrides);
}

function applySystemData(data = {}) {
  const hydrated = createBlankSystem({
    id: data.id || "",
    title: data.title || "",
    version: data.version || "0.1",
  });
  hydrated.fields = Array.isArray(data.fields) ? data.fields.map(hydrateFieldNode) : [];
  hydrated.fragments = Array.isArray(data.fragments) ? data.fragments : [];
  hydrated.metadata = Array.isArray(data.metadata) ? data.metadata : [];
  hydrated.formulas = Array.isArray(data.formulas) ? data.formulas : [];
  hydrated.importers = Array.isArray(data.importers) ? data.importers : [];
  applySystemState(hydrated);
}

function applySystemState(system, { emitStatus = false, statusMessage = "" } = {}) {
  state.system = cloneSystem(system);
  state.selectedNodeId = null;
  renderAll();
  ensureSelectValue();
  if (emitStatus && statusMessage) {
    status.show(statusMessage, { type: "success", timeout: 2000 });
  }
}

function hydrateFieldNode(field) {
  const node = createFieldNode(field.type || "string", {
    key: field.key || "",
    label: field.label || "",
    required: Boolean(field.required),
    formula: field.formula || field.expr || "",
    minimum: field.minimum ?? null,
    maximum: field.maximum ?? null,
    minItems: field.minItems ?? null,
    maxItems: field.maxItems ?? null,
    optionsFrom: field.optionsFrom || "",
    enum: Array.isArray(field.enum) ? [...field.enum] : [],
    itemFragment: field.itemFragment || "",
    itemKey: field.item?.key || "",
    itemLabel: field.item?.label || "",
  });
  if (field.type === "array" && field.item) {
    node.children = [hydrateFieldNode(field.item)];
  } else if (Array.isArray(field.children) && field.children.length) {
    node.children = field.children.map(hydrateFieldNode);
  }
  if (field.additional) {
    node.additional = hydrateFieldNode(field.additional);
  }
  return node;
}

function renderAll() {
  renderCanvas();
  renderInspector();
  renderPreview();
}

function renderCanvas() {
  const root = elements.canvasRoot;
  if (!root) return;
  root.innerHTML = "";
  root.dataset.dropzone = "root";
  const fields = state.system.fields || [];
  if (!fields.length) {
    root.appendChild(
      createCanvasPlaceholder("Drag fields from the palette into the canvas below to design your system.", {
        variant: "root",
      })
    );
  } else {
    fields.forEach((field) => {
      root.appendChild(renderFieldCard(field));
    });
  }
  setupDropzones(root, dropzones, {
    groupName: "system-canvas",
    sortableOptions: {
      onAdd(event) {
        handleDrop(event);
      },
      onUpdate(event) {
        handleReorder(event);
      },
    },
  });
  refreshTooltips(root);
}

function addFieldToRoot(type) {
  const normalized = normalizeType(type);
  const node = createFieldNode(normalized);
  const parentId = "root";
  const collection = getCollection(parentId);
  const index = collection ? collection.length : 0;
  insertNode(parentId, index, node);
  undoStack.push({ type: "add", nodeId: node.id, parentId, index });
  status.show(`Added ${TYPE_DEFS[normalized]?.label || normalized} field`, { timeout: 1500 });
  selectNode(node.id);
  renderAll();
  expandInspectorPane();
  return node;
}

function renderFieldCard(node) {
  const card = document.createElement("div");
  card.className = "workbench-canvas-card border rounded-3 bg-body shadow-sm p-3 d-flex flex-column gap-3";
  card.dataset.nodeId = node.id;
  card.dataset.sortableHandle = "true";
  card.tabIndex = 0;
  if (state.selectedNodeId === node.id) {
    card.classList.add("is-selected");
  }

  const normalizedType = normalizeType(node.type);
  const typeMeta = TYPE_DEFS[normalizedType] || TYPE_DEFS.string;

  card.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(node.id);
  });

  const header = document.createElement("div");
  header.className = "workbench-canvas-card__header";
  header.dataset.sortableHandle = "true";

  const actions = document.createElement("div");
  actions.className = "workbench-canvas-card__actions d-flex align-items-center gap-2";

  const typeBadge = document.createElement("span");
  typeBadge.className = "badge text-bg-secondary text-uppercase extra-small";
  typeBadge.textContent = typeMeta.label || normalizedType;
  actions.appendChild(typeBadge);

  const typeIcon = document.createElement("span");
  typeIcon.className = "workbench-canvas-card__type-icon d-inline-flex align-items-center justify-content-center";
  typeIcon.dataset.bsToggle = "tooltip";
  typeIcon.dataset.bsPlacement = "bottom";
  typeIcon.dataset.bsTitle = typeMeta.description || typeMeta.label || normalizedType;
  typeIcon.innerHTML = `<span class="iconify" data-icon="${typeMeta.icon || TYPE_DEFS.string.icon}" aria-hidden="true"></span>`;
  actions.appendChild(typeIcon);

  const removeButton = document.createElement("button");
  removeButton.className = "btn btn-outline-danger btn-sm";
  removeButton.type = "button";
  removeButton.innerHTML =
    '<span class="iconify" data-icon="tabler:trash" aria-hidden="true"></span><span class="visually-hidden">Remove field</span>';
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    deleteNode(node.id);
  });
  actions.appendChild(removeButton);

  header.appendChild(actions);
  card.appendChild(header);

  const content = document.createElement("div");
  content.className = "d-flex flex-column gap-1";

  const heading = document.createElement("div");
  heading.className = "fw-semibold";
  heading.textContent = node.label || node.key || typeMeta.label || normalizedType;
  content.appendChild(heading);

  const subtitle = document.createElement("div");
  subtitle.className = "text-body-secondary small";
  subtitle.textContent = formatNodeSubtitle(node);
  content.appendChild(subtitle);

  if (node.children && node.children.length) {
    const summary = document.createElement("div");
    summary.className = "text-body-secondary extra-small";
    summary.textContent = `${node.children.length} nested ${node.children.length === 1 ? "field" : "fields"}`;
    content.appendChild(summary);
  }

  card.appendChild(content);

  if (supportsChildren(node.type)) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";

    const label = document.createElement("div");
    label.className = "workbench-dropzone-label text-body-secondary text-uppercase extra-small";
    label.textContent = "Nested Fields";
    wrapper.appendChild(label);

    const container = document.createElement("div");
    container.className = "workbench-dropzone";
    container.dataset.dropzone = node.id;
    if (!node.children || !node.children.length) {
      container.appendChild(
        createCanvasPlaceholder("Drag fields here to nest them", { variant: "compact" })
      );
    } else {
      node.children.forEach((child) => {
        container.appendChild(renderFieldCard(child));
      });
    }
    wrapper.appendChild(container);
    card.appendChild(wrapper);
  }

  return card;
}

function formatNodeSubtitle(node) {
  const parts = [];
  if (node.key) parts.push(node.key);
  if (node.required) parts.push("required");
  if (node.minimum != null || node.maximum != null) {
    const range = [node.minimum ?? "", node.maximum ?? ""].filter((value) => value !== "").join(" – ");
    if (range) {
      parts.push(`range ${range}`);
    }
  }
  if (node.enum && node.enum.length) {
    parts.push(`${node.enum.length} option${node.enum.length === 1 ? "" : "s"}`);
  }
  if (node.children && node.children.length && !supportsChildren(node.type)) {
    parts.push(`${node.children.length} nested`);
  }
  const normalizedType = normalizeType(node.type);
  return parts.join(" · ") || TYPE_DEFS[normalizedType]?.description || "";
}

function supportsChildren(type) {
  const normalized = normalizeType(type);
  return normalized === "group" || normalized === "object" || normalized === "array";
}

function handleDrop(event) {
  const parentId = event.to.dataset.dropzone || "root";
  const index = event.newIndex;
  const paletteType = event.item.dataset.paletteType;
  const nodeId = event.item.dataset.nodeId;

  if (paletteType) {
    const node = createFieldNode(paletteType);
    insertNode(parentId, index, node);
    undoStack.push({ type: "add", nodeId: node.id, parentId });
    status.show(`Added ${TYPE_DEFS[paletteType]?.label || paletteType} field`, { timeout: 1500 });
    selectNode(node.id);
  } else if (nodeId) {
    if (nodeId === parentId || isDescendant(parentId, nodeId)) {
      status.show("Cannot move a field into itself", { type: "error", timeout: 2000 });
      renderAll();
      return;
    }
    moveNode(nodeId, parentId, index);
    undoStack.push({ type: "move", nodeId, parentId, index });
    status.show("Reordered field", { timeout: 1200 });
  }

  event.item.remove();
  renderAll();
}

function handleReorder(event) {
  const parentId = event.to.dataset.dropzone || "root";
  const nodeId = event.item.dataset.nodeId;
  if (!nodeId) {
    renderAll();
    return;
  }
  const collection = getCollection(parentId);
  if (!collection) {
    renderAll();
    return;
  }
  const oldIndex = event.oldIndex;
  const newIndex = event.newIndex;
  if (oldIndex === newIndex) {
    return;
  }
  const [item] = collection.splice(oldIndex, 1);
  collection.splice(newIndex, 0, item);
  undoStack.push({ type: "reorder", nodeId, parentId, oldIndex, newIndex });
  renderAll();
}

function insertNode(parentId, index, node) {
  const collection = getCollection(parentId);
  if (!collection) {
    return;
  }
  collection.splice(index, 0, node);
}

function moveNode(nodeId, targetParentId, index) {
  const found = findNode(nodeId);
  if (!found) {
    return;
  }
  const targetCollection = getCollection(targetParentId);
  if (!targetCollection) {
    return;
  }
  if (found.collection === targetCollection) {
    const [item] = found.collection.splice(found.index, 1);
    targetCollection.splice(index, 0, item);
    return;
  }
  const [item] = found.collection.splice(found.index, 1);
  targetCollection.splice(index, 0, item);
}

function deleteNode(nodeId) {
  const found = findNode(nodeId);
  if (!found) {
    return;
  }
  const { collection, index } = found;
  collection.splice(index, 1);
  if (state.selectedNodeId === nodeId) {
    state.selectedNodeId = null;
  }
  undoStack.push({ type: "delete", nodeId });
  status.show("Removed field", { type: "info", timeout: 1500 });
  renderAll();
}

function selectNode(nodeId) {
  if (state.selectedNodeId === nodeId) {
    expandInspectorPane();
    return;
  }
  state.selectedNodeId = nodeId;
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

function getCollection(parentId) {
  if (parentId === "root") {
    return state.system.fields;
  }
  const parent = findNode(parentId)?.node;
  if (!parent) {
    return null;
  }
  parent.children = Array.isArray(parent.children) ? parent.children : [];
  return parent.children;
}

function findNode(nodeId, nodes = state.system.fields, parentId = "root") {
  if (!Array.isArray(nodes)) return null;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.id === nodeId) {
      return { node, parentId, collection: nodes, index, relation: "children" };
    }
    if (node.additional && node.additional.id === nodeId) {
      return { node: node.additional, parentId: node.id, collection: node, index: "additional", relation: "additional" };
    }
    if (node.children && node.children.length) {
      const childResult = findNode(nodeId, node.children, node.id);
      if (childResult) {
        return childResult;
      }
    }
  }
  return null;
}

function renderInspector() {
  if (!elements.inspector) return;
  const node = state.selectedNodeId ? findNode(state.selectedNodeId)?.node : null;
  elements.inspector.innerHTML = "";
  if (!node) {
    const placeholder = document.createElement("p");
    placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
    placeholder.textContent = "Select a field on the canvas to edit its configuration.";
    elements.inspector.appendChild(placeholder);
    return;
  }
  const form = document.createElement("form");
  form.className = "d-flex flex-column gap-3";
  form.addEventListener("submit", (event) => event.preventDefault());

  const normalizedType = normalizeType(node.type);

  form.appendChild(createTextInput(node, "Label", "label"));
  form.appendChild(createTextInput(node, "Key", "key"));
  form.appendChild(createTypeSelect(node));
  form.appendChild(createCheckbox(node, "Required", "required"));
  form.appendChild(createTextInput(node, "Formula", "formula", { placeholder: "Optional formula expression" }));

  if (isNumericType(normalizedType)) {
    form.appendChild(createNumberInput(node, "Minimum", "minimum"));
    form.appendChild(createNumberInput(node, "Maximum", "maximum"));
  }

  if (normalizedType === "array") {
    form.appendChild(createNumberInput(node, "Minimum items", "minItems"));
    form.appendChild(createNumberInput(node, "Maximum items", "maxItems"));
    form.appendChild(createTextInput(node, "Item key", "itemKey"));
    form.appendChild(createTextInput(node, "Item label", "itemLabel"));
    form.appendChild(createTextInput(node, "Item fragment", "itemFragment"));
    form.appendChild(createTextInput(node, "Options from", "optionsFrom"));
  }

  if (supportsChoices(normalizedType)) {
    form.appendChild(createTextarea(node, "Allowed values (one per line)", "enum"));
    form.appendChild(createTextInput(node, "Options from", "optionsFrom"));
  }

  if (normalizedType === "object") {
    form.appendChild(renderAdditionalFieldGroup(node));
  }

  elements.inspector.appendChild(form);
}

function createTypeSelect(node) {
  const fieldset = document.createElement("div");
  fieldset.className = "d-flex flex-column";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.textContent = "Type";
  const select = document.createElement("select");
  select.className = "form-select";
  Object.entries(TYPE_DEFS).forEach(([value, meta]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = meta.label;
    if (value === node.type) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  select.addEventListener("change", () => {
    changeNodeType(node.id, select.value);
  });
  fieldset.appendChild(label);
  fieldset.appendChild(select);
  return fieldset;
}

function createTextInput(node, labelText, property, { placeholder = "" } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-control";
  input.placeholder = placeholder;
  input.value = node[property] ?? "";
  input.addEventListener("change", () => {
    updateNodeProperty(node.id, property, input.value);
  });
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

function createNumberInput(node, labelText, property) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control";
  input.value = node[property] ?? "";
  input.addEventListener("change", () => {
    const value = input.value === "" ? null : Number(input.value);
    updateNodeProperty(node.id, property, Number.isNaN(value) ? null : value);
  });
  wrapper.appendChild(label);
  wrapper.appendChild(input);
  return wrapper;
}

function createCheckbox(node, labelText, property) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = `${node.id}-${property}`;
  input.checked = Boolean(node[property]);
  input.addEventListener("change", () => {
    updateNodeProperty(node.id, property, input.checked);
  });
  const label = document.createElement("label");
  label.className = "form-check-label";
  label.setAttribute("for", input.id);
  label.textContent = labelText;
  wrapper.appendChild(input);
  wrapper.appendChild(label);
  return wrapper;
}

function createTextarea(node, labelText, property) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column";
  const label = document.createElement("label");
  label.className = "form-label fw-semibold text-body-secondary";
  label.textContent = labelText;
  const textarea = document.createElement("textarea");
  textarea.className = "form-control";
  textarea.rows = 4;
  textarea.value = Array.isArray(node[property]) ? node[property].join("\n") : node[property] || "";
  textarea.addEventListener("change", () => {
    const value = textarea.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    updateNodeProperty(node.id, property, value);
  });
  wrapper.appendChild(label);
  wrapper.appendChild(textarea);
  return wrapper;
}

function renderAdditionalFieldGroup(node) {
  const wrapper = document.createElement("fieldset");
  wrapper.className = "border rounded-3 p-3";
  const legend = document.createElement("legend");
  legend.className = "float-none w-auto px-2 text-body-secondary small text-uppercase";
  legend.textContent = "Additional entries";
  wrapper.appendChild(legend);
  const additional = node.additional || createFieldNode("string", { id: `${node.id}-additional` });
  if (!node.additional) {
    node.additional = additional;
  }
  const normalizedAdditionalType = normalizeType(additional.type);
  wrapper.appendChild(createTextInput(additional, "Key", "key"));
  wrapper.appendChild(createTextInput(additional, "Label", "label"));
  wrapper.appendChild(createTypeSelect(additional));
  wrapper.appendChild(createCheckbox(additional, "Required", "required"));
  if (isNumericType(normalizedAdditionalType)) {
    wrapper.appendChild(createNumberInput(additional, "Minimum", "minimum"));
    wrapper.appendChild(createNumberInput(additional, "Maximum", "maximum"));
  }
  if (supportsChoices(normalizedAdditionalType)) {
    wrapper.appendChild(createTextarea(additional, "Allowed values", "enum"));
  }
  return wrapper;
}

function updateNodeProperty(nodeId, property, value) {
  const found = findNode(nodeId);
  if (!found) {
    return;
  }
  found.node[property] = value;
  renderCanvas();
  renderPreview();
  renderInspector();
}

function changeNodeType(nodeId, nextType) {
  const found = findNode(nodeId);
  if (!found) {
    return;
  }
  const current = found.node;
  const preserved = {
    id: current.id,
    key: current.key,
    label: current.label,
    required: current.required,
  };
  const replacement = createFieldNode(nextType, preserved);
  if (found.relation === "additional" && found.collection) {
    found.collection.additional = replacement;
  } else {
    found.collection[found.index] = replacement;
  }
  state.selectedNodeId = preserved.id;
  renderAll();
}

function renderPreview() {
  if (!elements.jsonPreview) return;
  const serialized = serializeSystem(state.system);
  const text = JSON.stringify(serialized, null, 2);
  elements.jsonPreview.textContent = text;
  if (elements.jsonPreviewBytes) {
    const size = new Blob([text]).size;
    elements.jsonPreviewBytes.textContent = formatSize(size);
  }
  rememberDraft(state.system);
}

function serializeSystem(system) {
  return {
    id: system.id || "",
    title: system.title || "",
    version: system.version || "0.1",
    fields: Array.isArray(system.fields) ? system.fields.map(serializeFieldNode) : [],
    fragments: Array.isArray(system.fragments) ? system.fragments : [],
    metadata: Array.isArray(system.metadata) ? system.metadata : [],
    formulas: Array.isArray(system.formulas) ? system.formulas : [],
    importers: Array.isArray(system.importers) ? system.importers : [],
  };
}

function serializeFieldNode(node) {
  const normalizedType = normalizeType(node.type);
  const output = {
    type: normalizedType,
  };
  if (node.key) output.key = node.key;
  if (node.label) output.label = node.label;
  if (node.required) output.required = true;
  if (node.formula) output.formula = node.formula;
  if (node.minimum != null) output.minimum = node.minimum;
  if (node.maximum != null) output.maximum = node.maximum;
  if (node.minItems != null) output.minItems = node.minItems;
  if (node.maxItems != null) output.maxItems = node.maxItems;
  if (node.optionsFrom) output.optionsFrom = node.optionsFrom;
  if (node.itemFragment) output.itemFragment = node.itemFragment;
  if (Array.isArray(node.enum) && node.enum.length) output.enum = [...node.enum];

  if (normalizedType === "object") {
    if (node.additional) {
      output.additional = serializeFieldNode(node.additional);
    }
  }

  if (supportsChildren(normalizedType) && Array.isArray(node.children) && node.children.length) {
    if (normalizedType === "array") {
      if (node.children.length === 1) {
        output.item = serializeFieldNode(node.children[0]);
        if (node.itemKey) output.item.key = node.itemKey;
        if (node.itemLabel) output.item.label = node.itemLabel;
      } else {
        output.item = {
          key: node.itemKey || node.key || "item",
          label: node.itemLabel || node.label || "Item",
          type: "group",
          children: node.children.map(serializeFieldNode),
        };
      }
    } else {
      output.children = node.children.map(serializeFieldNode);
    }
  }

  return output;
}

function ensureSelectOption(id, label) {
  if (!elements.select || !id) return;
  const escaped = escapeCss(id);
  if (!elements.select.querySelector(`option[value="${escaped}"]`)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = label || id;
    elements.select.appendChild(option);
  } else {
    const option = elements.select.querySelector(`option[value="${escaped}"]`);
    if (option) {
      option.textContent = label || id;
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ensureSelectValue() {
  if (!elements.select) return;
  const escaped = escapeCss(state.system.id || "");
  const option = escaped ? elements.select.querySelector(`option[value="${escaped}"]`) : null;
  if (option) {
    elements.select.value = state.system.id;
  } else {
    elements.select.value = "";
  }
}

ensureSelectValue();

function escapeCss(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `field-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function isDescendant(targetParentId, nodeId) {
  if (!targetParentId || targetParentId === "root") {
    return false;
  }
  if (targetParentId === nodeId) {
    return true;
  }
  const target = findNode(targetParentId);
  if (!target) {
    return false;
  }
  return isDescendant(target.parentId, nodeId);
}

function rememberDraft(system) {
  if (!system) {
    return;
  }
  drafts.set(getDraftKey(system.id), cloneSystem(system));
}

function persistCurrentDraft() {
  if (!state.system) {
    return;
  }
  drafts.set(getDraftKey(state.system.id), cloneSystem(state.system));
}

function restoreDraft(id) {
  const draft = drafts.get(getDraftKey(id));
  if (!draft) {
    return null;
  }
  return cloneSystem(draft);
}

function cloneSystem(system) {
  if (!system) {
    return createBlankSystem();
  }
  if (typeof structuredClone === "function") {
    return structuredClone(system);
  }
  return JSON.parse(JSON.stringify(system));
}

function getDraftKey(id) {
  return id && String(id).trim() ? String(id).trim() : "__blank__";
}
