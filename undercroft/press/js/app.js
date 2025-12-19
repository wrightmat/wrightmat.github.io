import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { createSortable } from "../../common/js/lib/dnd.js";
import { expandPane } from "../../common/js/lib/panes.js";
import {
  getFormatById,
  getPageSize,
  getTemplateById,
  getTemplates,
  loadTemplates,
} from "./templates.js";
import { getSourceById, getSources } from "./sources.js";
import { loadSourceData } from "./source-data.js";

const templateSelect = document.getElementById("templateSelect");
const formatSelect = document.getElementById("formatSelect");
const orientationSelect = document.getElementById("orientationSelect");
const sourceSelect = document.getElementById("sourceSelect");
const sourceInputContainer = document.getElementById("sourceInputContainer");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
const generateButton = document.getElementById("generateButton");
const printButton = document.getElementById("printButton");
const selectionToggle = document.querySelector("[data-selection-toggle]");
const selectionToggleLabel = selectionToggle?.querySelector("[data-toggle-label]");
const selectionPanel = document.querySelector("[data-selection-panel]");
const jsonPreview = document.querySelector("[data-json-preview]");
const jsonBytes = document.querySelector("[data-preview-bytes]");
const undoButton = document.querySelector('[data-action="undo-layout"]');
const redoButton = document.querySelector('[data-action="redo-layout"]');
const saveButton = document.querySelector('[data-action="save-layout"]');
const paletteList = document.querySelector("[data-press-palette]");
const layoutList = document.querySelector("[data-layout-list]");
const layoutEmptyState = document.querySelector("[data-layout-empty]");
const inspectorSection = document.querySelector("[data-component-inspector]");
const inspectorTitle = document.querySelector("[data-inspector-title]");
const typeSummary = document.querySelector("[data-component-type-summary]");
const typeIcon = document.querySelector("[data-component-type-icon]");
const typeLabel = document.querySelector("[data-component-type-label]");
const typeDescription = document.querySelector("[data-component-type-description]");
const textEditor = document.querySelector("[data-component-text]");
const textSizeInputs = Array.from(document.querySelectorAll("[data-component-text-size]"));
const colorInputs = Array.from(document.querySelectorAll("[data-component-color]"));
const colorClearButtons = Array.from(document.querySelectorAll("[data-component-color-clear]"));
const textStyleToggles = Array.from(document.querySelectorAll("[data-component-text-style]"));
const alignInputs = Array.from(document.querySelectorAll("[data-component-align]"));
const visibilityToggle = document.querySelector("[data-component-visible]");
const textStyleSelect = document.querySelector("[data-text-style]");
const deleteButton = document.querySelector("[data-component-delete]");
const rightPane = document.querySelector('[data-pane="right"]');
const rightPaneToggle = document.querySelector('[data-pane-toggle="right"]');

const sourceValues = {};
const sourcePayloads = {};
let currentSide = "front";
let selectedNodeId = null;
let nodeCounter = 0;
let editablePages = { front: null, back: null };
let paletteSortable = null;
let layoutSortable = null;
let canvasSortable = null;
let undoStack = null;
let performUndo = null;
let performRedo = null;
let isApplyingHistory = false;
let pendingUndoSnapshot = null;
let pendingUndoTarget = null;
let status = null;
let lastSavedLayout = null;
let isSaving = false;
let isGenerating = false;
let applySelectionCollapse = null;

const COLOR_DEFAULTS = {
  foreground: "#212529",
  background: "#ffffff",
  border: "#dee2e6",
};

const paletteComponents = [
  {
    id: "heading",
    label: "Heading",
    description: "Section headers and callouts",
    icon: "tabler:text-size",
    node: {
      type: "field",
      component: "heading",
      text: "New Heading",
      textStyle: "h2",
      className: "card-title",
    },
  },
  {
    id: "text",
    label: "Body Copy",
    description: "Paragraphs, summaries, or captions",
    icon: "tabler:align-left",
    node: {
      type: "field",
      component: "text",
      text: "Editable body text for this card or sheet.",
      textStyle: "p",
      className: "card-body-text",
    },
  },
  {
    id: "badge",
    label: "Badge",
    description: "Small highlights or tags",
    icon: "tabler:badge",
    node: {
      type: "field",
      component: "badge",
      text: "Badge",
      className: "badge text-bg-primary",
    },
  },
  {
    id: "list",
    label: "List",
    description: "Bulleted stacks of notes",
    icon: "tabler:list-details",
    node: {
      type: "field",
      component: "list",
      items: ["First entry", "Second entry", "Third entry"],
      className: "mb-0 ps-3 d-flex flex-column gap-1",
    },
  },
  {
    id: "stat",
    label: "Stat",
    description: "Label + value blocks",
    icon: "tabler:graph",
    node: {
      type: "field",
      component: "stat",
      label: "Stat",
      text: "0",
      className: "panel-box",
    },
  },
  {
    id: "row",
    label: "Row",
    description: "Side-by-side layout columns",
    icon: "tabler:columns",
    node: {
      type: "row",
      gap: 4,
      columns: [
        {
          node: {
            type: "field",
            component: "text",
            text: "Column text",
            textStyle: "p",
            className: "mb-0",
          },
        },
        {
          node: {
            type: "field",
            component: "text",
            text: "Column text",
            textStyle: "p",
            className: "mb-0",
          },
        },
      ],
    },
  },
  {
    id: "noteLines",
    label: "Note Lines",
    description: "Ruled space for handwriting",
    icon: "tabler:notes",
    node: {
      type: "field",
      component: "noteLines",
      className: "note-lines",
    },
  },
];

function setCollapsibleState(toggle, panel, { collapsed, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return;
  const icon = toggle.querySelector(".iconify");
  const label = labelElement || toggle.querySelector("[data-toggle-label]");
  const isCollapsed = Boolean(collapsed);
  panel.hidden = isCollapsed;
  toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  if (label) {
    label.textContent = isCollapsed ? expandLabel : collapseLabel;
  }
  if (icon) {
    icon.dataset.icon = isCollapsed ? "tabler:chevron-right" : "tabler:chevron-down";
  }
}

function bindCollapsible(toggle, panel, { collapsed = false, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return () => {};
  const apply = (next) => setCollapsibleState(toggle, panel, { collapsed: next, expandLabel, collapseLabel, labelElement });
  apply(collapsed);
  toggle.addEventListener("click", () => apply(!panel.hidden));
  return apply;
}

function initShell() {
  const { undoStack: stack, undo, redo, status: shellStatus } = initAppShell({
    namespace: "press-layout",
    storagePrefix: "undercroft.press.undo",
    onUndo: (entry) => {
      if (!entry?.before) {
        return { applied: false };
      }
      isApplyingHistory = true;
      try {
        applySnapshot(entry.before);
        updateSaveState();
      } finally {
        isApplyingHistory = false;
      }
      return null;
    },
    onRedo: (entry) => {
      if (!entry?.after) {
        return { applied: false };
      }
      isApplyingHistory = true;
      try {
        applySnapshot(entry.after);
        updateSaveState();
      } finally {
        isApplyingHistory = false;
      }
      return null;
    },
  });
  status = shellStatus;
  undoStack = stack;
  performUndo = undo;
  performRedo = redo;
  if (undoButton) {
    undoButton.addEventListener("click", () => {
      if (performUndo) {
        performUndo();
      }
    });
  }
  if (redoButton) {
    redoButton.addEventListener("click", () => {
      if (performRedo) {
        performRedo();
      }
    });
  }
  if (saveButton) {
    saveButton.addEventListener("click", handleSaveTemplate);
    updateSaveState();
  }
  initHelpSystem({ root: document });
}

function populateSources() {
  const sources = getSources();
  sources.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    sourceSelect.appendChild(option);
  });
  const active = getActiveSource();
  if (active) {
    renderSourceInput(active);
    updateGenerateButtonState();
  }
}

function populateTemplates() {
  templateSelect.innerHTML = "";
  const templates = getTemplates();
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    templateSelect.appendChild(option);
  });
  if (templates[0]) {
    templateSelect.value = templates[0].id;
    hydrateEditablePages(templates[0]);
  }
}

function renderFormatOptions(template) {
  formatSelect.innerHTML = "";
  if (!template) return;
  template.formats?.forEach((format) => {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = format.label;
    formatSelect.appendChild(option);
  });
  const firstFormat = template.formats?.[0];
  formatSelect.value = firstFormat?.id ?? "";
  renderOrientationOptions(firstFormat);
}

function renderOrientationOptions(format) {
  orientationSelect.innerHTML = "";
  const orientations = format?.orientations ?? ["portrait"];
  orientations.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    orientationSelect.appendChild(option);
  });
  orientationSelect.value = format?.defaultOrientation ?? orientations[0];
}

function getActiveTemplate() {
  const selected = templateSelect.value;
  return getTemplateById(selected);
}

function getActiveSource() {
  const selected = sourceSelect.value;
  return getSourceById(selected);
}

function getSourcePayload(source, value) {
  if (!source) return null;
  const payload = sourcePayloads[source.id];
  if (!payload) return null;
  if (payload.value !== value) return null;
  return payload;
}

function setSourcePayload(source, payload) {
  if (!source) return;
  if (payload) {
    sourcePayloads[source.id] = payload;
  } else {
    delete sourcePayloads[source.id];
  }
}

function clearSourcePayload(source) {
  if (!source) return;
  delete sourcePayloads[source.id];
}

function updateGenerateButtonState() {
  if (!generateButton) return;
  const source = getActiveSource();
  const value = source ? sourceValues[source.id] : null;
  const requiresInput = source?.input?.type !== "textarea";
  const hasValue = source?.id === "manual" ? true : Boolean(value);
  generateButton.disabled = Boolean(isGenerating || (requiresInput && !hasValue));
  generateButton.setAttribute("aria-disabled", generateButton.disabled ? "true" : "false");
}

function getSelectionContext() {
  const template = getActiveTemplate();
  const source = getActiveSource();
  const format = getFormatById(template, formatSelect.value);
  const orientation = orientationSelect.value || format?.defaultOrientation;
  const size = template && format ? getPageSize(template, format?.id, orientation) : null;
  const value = sourceValues[source?.id];
  const payload = getSourcePayload(source, value);

  return {
    template,
    source,
    format,
    orientation,
    size,
    sourceValue: value,
    sourcePayload: payload,
    sourceData: payload?.data ?? null,
  };
}

const renderJsonPreview = createJsonPreviewRenderer({
  resolvePreviewElement: () => jsonPreview,
  resolveBytesElement: () => jsonBytes,
  serialize: () => {
    const context = getSelectionContext();
    return {
      source: {
        id: context.source?.id ?? null,
        value: context.sourceValue,
        data: context.sourceData ?? null,
      },
      template: {
        id: context.template?.id ?? null,
        format: context.format?.id ?? null,
        orientation: context.orientation,
        size: context.size,
      },
      view: {
        side: currentSide,
        overlays: true,
      },
    };
  },
});

function cloneState(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createSnapshot() {
  return {
    pages: cloneState(editablePages),
    currentSide,
    selectedNodeId,
    nodeCounter,
  };
}

function createLayoutSnapshot() {
  return cloneState(editablePages);
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  const next = cloneState(snapshot);
  editablePages = next.pages ?? { front: null, back: null };
  currentSide = next.currentSide ?? "front";
  selectedNodeId = next.selectedNodeId ?? null;
  nodeCounter = typeof next.nodeCounter === "number" ? next.nodeCounter : 0;
  renderLayoutList();
  updateInspector();
  renderPreview();
}

function snapshotsEqual(first, second) {
  try {
    return JSON.stringify(first) === JSON.stringify(second);
  } catch (error) {
    console.warn("Unable to compare undo snapshots", error);
    return false;
  }
}

function pushUndoEntry(before, after) {
  if (!undoStack) return;
  if (snapshotsEqual(before, after)) return;
  undoStack.push({
    type: "layout",
    before,
    after,
  });
}

function recordUndoableChange(action) {
  if (isApplyingHistory || typeof action !== "function") {
    if (typeof action === "function") {
      action();
    }
    return;
  }
  if (!undoStack) {
    action();
    updateSaveState();
    return;
  }
  const before = createSnapshot();
  action();
  const after = createSnapshot();
  pushUndoEntry(before, after);
  updateSaveState();
}

function beginPendingUndo(target) {
  if (!undoStack || isApplyingHistory) return;
  pendingUndoSnapshot = createSnapshot();
  pendingUndoTarget = target ?? null;
}

function commitPendingUndo(target) {
  if (!undoStack || isApplyingHistory) return;
  if (pendingUndoTarget && target && pendingUndoTarget !== target) return;
  const before = pendingUndoSnapshot;
  pendingUndoSnapshot = null;
  pendingUndoTarget = null;
  if (!before) return;
  const after = createSnapshot();
  pushUndoEntry(before, after);
  updateSaveState();
}

function updateSaveState() {
  if (!saveButton) return;
  const hasTemplate = Boolean(getActiveTemplate());
  const hasChanges = hasTemplate && !snapshotsEqual(lastSavedLayout, createLayoutSnapshot());
  const enabled = hasChanges && !isSaving;
  saveButton.disabled = !enabled;
  saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  if (!hasTemplate) {
    saveButton.title = "Select a template before saving.";
  } else if (isSaving) {
    saveButton.title = "Saving template...";
  } else if (!hasChanges) {
    saveButton.title = "No changes to save.";
  } else {
    saveButton.removeAttribute("title");
  }
}

function markLayoutSaved() {
  lastSavedLayout = createLayoutSnapshot();
  updateSaveState();
}

function stripNodeIds(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((child) => stripNodeIds(child));
  }
  const next = { ...node };
  delete next.uid;
  if (Array.isArray(next.children)) {
    next.children = next.children.map((child) => stripNodeIds(child));
  }
  if (Array.isArray(next.columns)) {
    next.columns = next.columns.map((column) => ({
      ...column,
      node: stripNodeIds(column.node),
    }));
  }
  return next;
}

function buildTemplatePages() {
  const pages = {};
  Object.entries(editablePages ?? {}).forEach(([side, page]) => {
    if (!page || typeof page !== "object") {
      pages[side] = page;
      return;
    }
    const { layout, ...rest } = page;
    pages[side] = {
      ...rest,
      layout: layout ? stripNodeIds(layout) : layout,
    };
  });
  return pages;
}

function serializeTemplate(template) {
  if (!template || typeof template !== "object") return null;
  const { createPage, ...rest } = template;
  return cloneState({ ...rest, pages: buildTemplatePages() });
}

async function saveTemplateToServer(payload) {
  const id = payload?.id;
  if (!id) {
    throw new Error("Missing template id");
  }
  const response = await fetch(`/press/templates/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = `Unable to save template (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch (error) {
      console.warn("Unable to parse save response", error);
    }
    throw new Error(message);
  }
  return response.json();
}

async function handleSaveTemplate() {
  const template = getActiveTemplate();
  if (!template) {
    return;
  }
  const hasChanges = !snapshotsEqual(lastSavedLayout, createLayoutSnapshot());
  if (!hasChanges) {
    return;
  }
  const confirmed = window.confirm("Save layout changes to this template?");
  if (!confirmed) {
    if (status) {
      status.show("Save cancelled", { type: "info", timeout: 1500 });
    }
    return;
  }
  const payload = serializeTemplate(template);
  if (!payload) {
    return;
  }
  isSaving = true;
  updateSaveState();
  try {
    await saveTemplateToServer(payload);
    template.pages = payload.pages;
    markLayoutSaved();
    if (status) {
      status.show("Template layout saved", { type: "success", timeout: 2000 });
    }
  } catch (error) {
    console.error("Failed to save template", error);
    if (status) {
      status.show(error.message || "Unable to save template", { type: "error", timeout: 2500 });
    }
  } finally {
    isSaving = false;
    updateSaveState();
  }
}

function nextNodeId() {
  nodeCounter += 1;
  return `node-${nodeCounter}`;
}

function assignNodeIds(node) {
  if (!node || typeof node !== "object") return null;
  const clone = { ...node, uid: node.uid ?? nextNodeId() };
  if (Array.isArray(node.children)) {
    clone.children = node.children.map((child) => assignNodeIds(child));
  }
  if (Array.isArray(node.columns)) {
    clone.columns = node.columns.map((column) => ({ ...column, node: assignNodeIds(column.node) }));
  }
  return clone;
}

function cloneLayoutWithIds(layout) {
  if (!layout) return null;
  const copy = typeof structuredClone === "function" ? structuredClone(layout) : JSON.parse(JSON.stringify(layout));
  return assignNodeIds(copy);
}

function hydrateEditablePages(template) {
  nodeCounter = 0;
  const pages = template?.pages ?? {};
  const bySide = {};
  (template?.sides ?? ["front", "back"]).forEach((side) => {
    const pageConfig = pages[side] ?? {};
    bySide[side] = { ...pageConfig, layout: cloneLayoutWithIds(pageConfig.layout) };
  });
  editablePages = bySide;
  selectedNodeId = null;
}

function getEditablePage(side) {
  return editablePages?.[side] ?? null;
}

function getLayoutForSide(side) {
  const page = getEditablePage(side);
  return page?.layout ?? null;
}

function findNodeById(node, uid) {
  if (!node || !uid) return null;
  if (node.uid === uid) return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findNodeById(child, uid);
      if (found) return found;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      const found = findNodeById(column.node, uid);
      if (found) return found;
    }
  }
  return null;
}

function removeNodeById(node, uid) {
  if (!node || !uid) return null;
  if (Array.isArray(node.children)) {
    const index = node.children.findIndex((child) => child.uid === uid);
    if (index >= 0) {
      const [removed] = node.children.splice(index, 1);
      return removed;
    }
    for (const child of node.children) {
      const removed = removeNodeById(child, uid);
      if (removed) return removed;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      if (column?.node?.uid === uid) {
        const removed = column.node;
        column.node = null;
        return removed;
      }
      const removed = removeNodeById(column.node, uid);
      if (removed) return removed;
    }
  }
  return null;
}

function getRootChildren(side) {
  const layout = getLayoutForSide(side);
  if (layout?.type === "stack" && Array.isArray(layout.children)) {
    return layout.children;
  }
  return [];
}

function insertNodeAtRoot(side, node, index) {
  if (!node) return;
  const layout = getLayoutForSide(side);
  if (!layout || layout.type !== "stack") return;
  const children = getRootChildren(side);
  const targetIndex = Math.max(0, Math.min(index, children.length));
  const prepared = node.uid ? node : assignNodeIds(node);
  children.splice(targetIndex, 0, prepared);
  selectedNodeId = prepared.uid ?? children[targetIndex]?.uid ?? null;
}

function reorderRootChildren(side, fromIndex, toIndex) {
  const layout = getLayoutForSide(side);
  if (!layout || layout.type !== "stack") return;
  const children = getRootChildren(side);
  if (!children[fromIndex]) return;
  const [moved] = children.splice(fromIndex, 1);
  children.splice(Math.max(0, toIndex), 0, moved);
}

function removeNodeAtRoot(side, uid) {
  const layout = getLayoutForSide(side);
  if (!layout || layout.type !== "stack") return null;
  const children = getRootChildren(side);
  const index = children.findIndex((child) => child.uid === uid);
  if (index >= 0) {
    const [removed] = children.splice(index, 1);
    return removed;
  }
  return null;
}

function createNodeFromPalette(type) {
  const entry = paletteComponents.find((item) => item.id === type);
  if (!entry?.node) return null;
  const clone = typeof structuredClone === "function" ? structuredClone(entry.node) : JSON.parse(JSON.stringify(entry.node));
  return assignNodeIds(clone);
}

function describeNode(node) {
  if (!node) return "Component";
  if (node.type === "row") return "Row";
  if (node.component === "heading") return node.text || "Heading";
  if (node.component === "text") return node.text ? node.text.slice(0, 48) : "Text";
  if (node.component === "badge") return node.text || node.label || "Badge";
  if (node.component === "list") return "List";
  if (node.component === "noteLines") return "Notes";
  if (node.component === "stat") return node.label || "Stat";
  return node.component || node.type || "Component";
}

function getPaletteEntryForNode(node) {
  if (!node) return null;
  if (node.type === "row") {
    return paletteComponents.find((item) => item.id === "row") ?? null;
  }
  if (node.component) {
    return paletteComponents.find((item) => item.id === node.component) ?? null;
  }
  return null;
}

function mapFontSizeToToken(size) {
  if (typeof size !== "number") return "md";
  if (size <= 14) return "sm";
  if (size >= 22) return "xl";
  if (size >= 19) return "lg";
  return "md";
}

function resolveTextSize(node) {
  if (!node) return "md";
  if (node.textSize) return node.textSize;
  const fallback = node.style?.fontSize;
  return mapFontSizeToToken(fallback);
}

function supportsTextStyleSelection(node) {
  return node?.component === "heading" || node?.component === "text";
}

function resolveTextStyle(node) {
  if (!node) return "p";
  if (node.textStyle) return node.textStyle;
  if (node.component === "heading") {
    return node.level ?? "h2";
  }
  return "p";
}

function renderPalette() {
  if (!paletteList) return;
  paletteList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  paletteComponents.forEach((item) => {
    const entry = document.createElement("div");
    entry.className =
      "press-palette-item workbench-palette-item border rounded-3 shadow-sm bg-body d-flex align-items-center gap-2 hover-lift";
    entry.dataset.componentType = item.id;
    entry.dataset.sortableId = item.id;
    entry.dataset.sortableHandle = "true";
    entry.innerHTML = `
      <span class="iconify fs-4 text-primary" data-icon="${item.icon}" aria-hidden="true"></span>
      <div class="d-flex flex-column">
        <div class="fw-semibold">${item.label}</div>
        <div class="text-body-secondary extra-small text-truncate">${item.description}</div>
      </div>
    `;
    entry.addEventListener("dblclick", () => {
      const newNode = createNodeFromPalette(item.id);
      if (!newNode) return;
      recordUndoableChange(() => {
        insertNodeAtRoot(currentSide, newNode, getRootChildren(currentSide).length);
        selectNode(newNode.uid);
      });
    });
    fragment.appendChild(entry);
  });
  paletteList.appendChild(fragment);
}

function renderLayoutList() {
  if (!layoutList) return;
  layoutList.innerHTML = "";
  const children = getRootChildren(currentSide);
  if (layoutEmptyState) {
    layoutEmptyState.hidden = Boolean(children.length);
  }
  if (!children.length) return;

  const fragment = document.createDocumentFragment();
  children.forEach((node) => {
    const item = document.createElement("li");
    item.className = "list-group-item d-flex align-items-center justify-content-between gap-2";
    if (node.uid === selectedNodeId) {
      item.classList.add("active");
    }
    item.dataset.nodeId = node.uid;
    item.dataset.sortableId = node.uid;

    const handle = document.createElement("span");
    handle.className = "iconify text-body-secondary";
    handle.dataset.icon = "tabler:grip-vertical";
    handle.setAttribute("data-sortable-handle", "");
    handle.setAttribute("aria-hidden", "true");

    const label = document.createElement("div");
    label.className = "flex-grow-1 d-flex flex-column";
    const title = document.createElement("span");
    title.className = "fw-semibold";
    title.textContent = describeNode(node);
    const subtitle = document.createElement("small");
    subtitle.className = "text-body-secondary";
    subtitle.textContent = node.component ? `Component: ${node.component}` : `Type: ${node.type}`;
    label.append(title, subtitle);

    item.append(handle, label);
    item.addEventListener("click", () => selectNode(node.uid));
    fragment.appendChild(item);
  });

  layoutList.appendChild(fragment);
}

function getNodeText(node) {
  if (!node) return "";
  if (node.component === "list") {
    return Array.isArray(node.items) ? node.items.join("\n") : "";
  }
  if (typeof node.text === "string") return node.text;
  if (typeof node.label === "string") return node.label;
  return "";
}

function updateInspector() {
  if (!inspectorSection) return;
  const layout = getLayoutForSide(currentSide);
  const node = findNodeById(layout, selectedNodeId);
  const hasSelection = Boolean(node);

  inspectorSection.classList.toggle("opacity-50", !hasSelection);
  inspectorSection.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = !hasSelection;
  });

  inspectorTitle.textContent = hasSelection ? describeNode(node) : "Select a component";

  if (typeSummary) {
    const entry = getPaletteEntryForNode(node);
    typeSummary.classList.toggle("opacity-50", !entry);
    if (entry) {
      if (typeIcon) {
        typeIcon.dataset.icon = entry.icon;
      }
      if (typeLabel) {
        typeLabel.textContent = entry.label;
      }
      if (typeDescription) {
        typeDescription.textContent = entry.description;
      }
    } else {
      if (typeIcon) {
        typeIcon.dataset.icon = "tabler:components";
      }
      if (typeLabel) {
        typeLabel.textContent = "Component";
      }
      if (typeDescription) {
        typeDescription.textContent = "Select a component to view details.";
      }
    }
  }

  if (!hasSelection) {
    if (textEditor) textEditor.value = "";
    textSizeInputs.forEach((input) => {
      input.checked = input.value === "md";
    });
    colorInputs.forEach((input) => {
      const key = input.dataset.componentColor;
      input.value = COLOR_DEFAULTS[key] || "#000000";
    });
    textStyleToggles.forEach((input) => {
      input.checked = false;
    });
    alignInputs.forEach((input) => {
      input.checked = input.value === "start";
    });
    if (visibilityToggle) visibilityToggle.checked = true;
    if (textStyleSelect) {
      textStyleSelect.value = "p";
      textStyleSelect.disabled = true;
    }
    return;
  }

  if (textEditor) {
    textEditor.value = getNodeText(node);
    textEditor.placeholder = node.component === "list" ? "One entry per line" : "Binding / Text";
  }

  const textSize = resolveTextSize(node);
  textSizeInputs.forEach((input) => {
    input.checked = input.value === textSize;
  });

  colorInputs.forEach((input) => {
    const key = input.dataset.componentColor;
    const styles = node?.style ?? {};
    if (key === "foreground") {
      input.value = styles.color ?? COLOR_DEFAULTS.foreground;
    } else if (key === "background") {
      input.value = styles.backgroundColor ?? COLOR_DEFAULTS.background;
    } else if (key === "border") {
      input.value = styles.borderColor ?? COLOR_DEFAULTS.border;
    }
  });

  textStyleToggles.forEach((input) => {
    const styleKey = input.dataset.componentTextStyle;
    input.checked = Boolean(node?.textStyles?.[styleKey]);
  });

  const alignment = node?.align || "start";
  alignInputs.forEach((input) => {
    input.checked = input.value === alignment;
  });

  if (visibilityToggle) {
    visibilityToggle.checked = !node.hidden;
  }

  if (textStyleSelect) {
    textStyleSelect.value = resolveTextStyle(node);
    textStyleSelect.disabled = !supportsTextStyleSelection(node);
  }
}

function selectFirstNode() {
  const first = getRootChildren(currentSide)[0];
  selectedNodeId = first?.uid ?? null;
  renderLayoutList();
  updateInspector();
  renderPreview();
}

function selectNode(uid, { fromPreview = false } = {}) {
  selectedNodeId = uid;
  renderLayoutList();
  updateInspector();
  if (fromPreview) {
    expandPane(rightPane, rightPaneToggle);
  }
  if (!fromPreview) {
    renderPreview();
  }
}

function updateSelectedNode(updater) {
  if (typeof updater !== "function") return;
  const layout = getLayoutForSide(currentSide);
  const node = findNodeById(layout, selectedNodeId);
  if (!node) return;
  updater(node);
}

function applyOverlays(page, template, size, { forPrint = false } = {}) {
  if (template.type === "card") {
    const guides = document.createElement("div");
    guides.className = "page-overlay trim-lines card-guides";

    const { card } = template;
    const columns = card.columns ?? 3;
    const rows = card.rows ?? 3;
    const gridWidth = card.width * columns + card.gutter * (columns - 1);
    const gridHeight = card.height * rows + card.gutter * (rows - 1);
    const availableWidth = size.width - size.margin * 2;
    const availableHeight = size.height - size.margin * 2;
    const horizontalInset = size.margin + Math.max(0, (availableWidth - gridWidth) / 2);
    const verticalInset = size.margin + Math.max(0, (availableHeight - gridHeight) / 2);

    const addGuide = (orientation, position, length, start) => {
      const guide = document.createElement("div");
      guide.className = `guide-line guide-${orientation}`;
      if (orientation === "vertical") {
        guide.style.left = `${position}in`;
        guide.style.top = `${start}in`;
        guide.style.height = `${length}in`;
      } else {
        guide.style.top = `${position}in`;
        guide.style.left = `${start}in`;
        guide.style.width = `${length}in`;
      }
      guides.appendChild(guide);
    };

    Array.from({ length: columns + 1 }).forEach((_, index) => {
      const x = horizontalInset + index * (template.card.width + template.card.gutter);
      addGuide("vertical", x, gridHeight, verticalInset);
    });

    Array.from({ length: rows + 1 }).forEach((_, index) => {
      const y = verticalInset + index * (template.card.height + template.card.gutter);
      addGuide("horizontal", y, gridWidth, horizontalInset);
    });

    page.appendChild(guides);
  }

  if (!forPrint) {
    const safe = document.createElement("div");
    const inset = Math.max(0.2, size.margin ?? 0.25);
    safe.className = "page-overlay safe-area";
    safe.style.inset = `${inset}in`;
    page.appendChild(safe);
  }
}

function updateSideButton() {
  const viewingFront = currentSide === "front";
  const currentLabel = viewingFront ? "Front" : "Back";
  const nextLabel = viewingFront ? "Back" : "Front";
  swapSideButton.textContent = `Showing ${currentLabel} (switch to ${nextLabel})`;
  swapSideButton.setAttribute("aria-pressed", viewingFront ? "false" : "true");
}

function renderPreview() {
  destroyCanvasDnd();
  const context = getSelectionContext();
  const { template, source, format, size, orientation, sourceValue, sourceData } = context;
  if (!template || !size) return;
  const side = currentSide;
  const pageOverride = getEditablePage(side);
  let layoutRoot = null;

  previewStage.innerHTML = "";
  const sourceContext = { ...source, value: sourceValue, data: sourceData };
  const page = template.createPage(side, {
    size,
    format,
    source: sourceContext,
    data: sourceData,
    page: pageOverride,
    renderOptions: {
      editable: true,
      selectedId: selectedNodeId,
      onSelect: (uid) => selectNode(uid, { fromPreview: true }),
      onRootReady: (element) => {
        if (element?.nodeType === Node.ELEMENT_NODE) {
          element.dataset.layoutRoot = "true";
          element.dataset.layoutSide = side;
          layoutRoot = element;
        }
      },
    },
  });
  applyOverlays(page, template, size, { forPrint: false });
  previewStage.appendChild(page);
  initCanvasDnd(layoutRoot);

  buildPrintStack(template, { size, format, data: sourceData, source: sourceContext });
  updateSideButton();
  renderJsonPreview();
}

function buildPrintStack(template, { size, format, data, source }) {
  printStack.innerHTML = "";
  template.sides.forEach((side) => {
    const page = template.createPage(side, {
      size,
      format,
      source,
      data,
      page: getEditablePage(side),
    });
    applyOverlays(page, template, size, { forPrint: true });
    printStack.appendChild(page);
  });
}

function toggleSide() {
  currentSide = currentSide === "front" ? "back" : "front";
  const layout = getLayoutForSide(currentSide);
  const existing = findNodeById(layout, selectedNodeId);
  if (!existing) {
    selectFirstNode();
    return;
  }
  renderLayoutList();
  updateInspector();
  renderPreview();
}

function renderSourceInput(source) {
  sourceInputContainer.innerHTML = "";
  const inputSpec = source.input;
  if (!inputSpec) return;

  const labelRow = document.createElement("div");
  labelRow.className = "d-flex justify-content-between align-items-center gap-2 flex-wrap";

  const label = document.createElement("label");
  label.className = "form-label fw-semibold mb-0";
  label.setAttribute("for", `${source.id}-input`);
  label.textContent = inputSpec.label;
  labelRow.appendChild(label);

  if (inputSpec.helpTopic) {
    const sourceHelp = document.createElement("span");
    sourceHelp.className = "align-middle";
    sourceHelp.dataset.helpTopic = inputSpec.helpTopic;
    sourceHelp.dataset.helpInsert = "replace";
    sourceHelp.dataset.helpPlacement = "left";
    labelRow.appendChild(sourceHelp);
    initHelpSystem({ root: labelRow });
  }

  let input;
  if (inputSpec.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = inputSpec.rows ?? 3;
    input.className = "form-control";
  } else {
    input = document.createElement("input");
    input.type = inputSpec.type;
    input.className = "form-control";
    if (inputSpec.accept) {
      input.accept = inputSpec.accept;
    }
  }

  input.id = `${source.id}-input`;
  input.placeholder = inputSpec.placeholder ?? "";
  const savedValue = sourceValues[source.id];
  if (inputSpec.type === "file") {
    input.value = "";
  } else if (savedValue) {
    input.value = savedValue;
  }

  input.addEventListener("change", (event) => {
    if (inputSpec.type === "file") {
      sourceValues[source.id] = event.target.files?.[0] ?? null;
    } else {
      sourceValues[source.id] = event.target.value;
    }
    clearSourcePayload(source);
    updateGenerateButtonState();
    renderPreview();
  });

  sourceInputContainer.append(labelRow, input);
}

async function handleGeneratePrint() {
  const context = getSelectionContext();
  const { source, sourceValue } = context;
  if (!source) {
    if (status) {
      status.show("Select a source before generating.", { type: "warning", timeout: 2000 });
    }
    return;
  }
  const requiresInput = source?.input?.type !== "textarea";
  if (requiresInput && !sourceValue) {
    if (status) {
      status.show("Enter a source value before generating.", { type: "warning", timeout: 2000 });
    }
    return;
  }
  isGenerating = true;
  if (generateButton) {
    generateButton.textContent = "Generating...";
  }
  updateGenerateButtonState();
  try {
    const data = await loadSourceData(source, sourceValue);
    setSourcePayload(source, {
      value: sourceValue,
      data,
      fetchedAt: new Date().toISOString(),
    });
    renderPreview();
    if (applySelectionCollapse) {
      applySelectionCollapse(true);
    }
    if (status) {
      status.show("Source data loaded for printing.", { type: "success", timeout: 2000 });
    }
  } catch (error) {
    console.error("Unable to generate print data", error);
    if (status) {
      status.show(error.message || "Unable to load source data.", { type: "error", timeout: 4000 });
    }
  } finally {
    isGenerating = false;
    if (generateButton) {
      generateButton.textContent = "Generate Print";
    }
    updateGenerateButtonState();
  }
}

function initPressCollapsibles() {
  applySelectionCollapse = bindCollapsibleToggle(selectionToggle, selectionPanel, {
    collapsed: false,
    expandLabel: "Expand selections",
    collapseLabel: "Collapse selections",
    labelElement: selectionToggleLabel,
  });
}

function initPaletteDnd() {
  renderPalette();
  if (!paletteList) return;
  if (paletteSortable?.destroy) {
    paletteSortable.destroy();
  }
  paletteSortable = createSortable(paletteList, {
    group: { name: "press-layout", pull: "clone", put: false },
    sort: false,
    fallbackOnBody: true,
    handle: null,
  });
}

function handleLayoutAdd(event) {
  const type = event.item?.dataset?.componentType;
  const newNode = createNodeFromPalette(type);
  event.item?.remove();
  if (!newNode) return;
  recordUndoableChange(() => {
    const index = typeof event.newIndex === "number" ? event.newIndex : getRootChildren(currentSide).length;
    insertNodeAtRoot(currentSide, newNode, index);
    selectNode(newNode.uid);
  });
}

function handleLayoutReorder(event) {
  recordUndoableChange(() => {
    reorderRootChildren(currentSide, event.oldIndex ?? 0, event.newIndex ?? 0);
    renderLayoutList();
    renderPreview();
  });
}

function initLayoutDnd() {
  if (!layoutList) return;
  if (layoutSortable?.destroy) {
    layoutSortable.destroy();
  }
  layoutSortable = createSortable(layoutList, {
    group: { name: "press-layout", pull: true, put: true },
    animation: 150,
    handle: "[data-sortable-handle]",
    onAdd: handleLayoutAdd,
    onUpdate: handleLayoutReorder,
  });
}

function destroyCanvasDnd() {
  if (canvasSortable?.destroy) {
    canvasSortable.destroy();
  }
  canvasSortable = null;
}

function handleCanvasAdd(event) {
  const type = event.item?.dataset?.componentType;
  const newNode = createNodeFromPalette(type);
  event.item?.remove();
  if (!newNode) return;
  recordUndoableChange(() => {
    const index = typeof event.newIndex === "number" ? event.newIndex : getRootChildren(currentSide).length;
    insertNodeAtRoot(currentSide, newNode, index);
    selectNode(newNode.uid);
  });
}

function handleCanvasReorder(event) {
  recordUndoableChange(() => {
    reorderRootChildren(currentSide, event.oldIndex ?? 0, event.newIndex ?? 0);
    renderLayoutList();
    renderPreview();
  });
}

function initCanvasDnd(rootElement) {
  if (!rootElement) {
    destroyCanvasDnd();
    return;
  }

  destroyCanvasDnd();
  canvasSortable = createSortable(rootElement, {
    group: { name: "press-layout", pull: true, put: true },
    animation: 150,
    fallbackOnBody: true,
    handle: null,
    draggable: "[data-node-id], [data-component-type]",
    onAdd: handleCanvasAdd,
    onUpdate: handleCanvasReorder,
  });
}

function initDragAndDrop() {
  initPaletteDnd();
  initLayoutDnd();
}

function bindInspectorControls() {
  if (textEditor) {
    textEditor.addEventListener("focus", () => beginPendingUndo(textEditor));
    textEditor.addEventListener("blur", () => commitPendingUndo(textEditor));
    textEditor.addEventListener("change", () => commitPendingUndo(textEditor));
    textEditor.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component === "list") {
          node.items = textEditor.value
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean);
        } else {
          node.text = textEditor.value;
          node.label = textEditor.value;
        }
      });
      renderPreview();
      renderLayoutList();
      updateSaveState();
    });
  }

  if (textSizeInputs.length) {
    textSizeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.textSize = input.value;
            if (node.style?.fontSize) {
              const styles = { ...(node.style ?? {}) };
              delete styles.fontSize;
              if (Object.keys(styles).length) {
                node.style = styles;
              } else {
                delete node.style;
              }
            }
          });
          renderPreview();
        });
      });
    });
  }

  if (colorInputs.length) {
    colorInputs.forEach((input) => {
      input.addEventListener("focus", () => beginPendingUndo(input));
      input.addEventListener("blur", () => commitPendingUndo(input));
      input.addEventListener("change", () => commitPendingUndo(input));
      input.addEventListener("input", () => {
        const key = input.dataset.componentColor;
        const value = input.value;
        updateSelectedNode((node) => {
          const styles = { ...(node.style ?? {}) };
          if (key === "foreground") {
            styles.color = value;
          } else if (key === "background") {
            styles.backgroundColor = value;
          } else if (key === "border") {
            styles.borderColor = value;
          }
          node.style = styles;
        });
        renderPreview();
        updateSaveState();
      });
    });
  }

  if (colorClearButtons.length) {
    colorClearButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.componentColorClear;
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            const styles = { ...(node.style ?? {}) };
            if (key === "foreground") {
              delete styles.color;
            } else if (key === "background") {
              delete styles.backgroundColor;
            } else if (key === "border") {
              delete styles.borderColor;
            }
            if (Object.keys(styles).length) {
              node.style = styles;
            } else {
              delete node.style;
            }
          });
          const input = colorInputs.find((entry) => entry.dataset.componentColor === key);
          if (input) {
            input.value = COLOR_DEFAULTS[key] || "#000000";
          }
          renderPreview();
          updateSaveState();
        });
      });
    });
  }

  if (textStyleToggles.length) {
    textStyleToggles.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.textStyles = { ...(node.textStyles ?? {}) };
            node.textStyles[input.dataset.componentTextStyle] = input.checked;
          });
          renderPreview();
        });
      });
    });
  }

  if (alignInputs.length) {
    alignInputs.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.align = input.value;
          });
          renderPreview();
        });
      });
    });
  }

  if (visibilityToggle) {
    visibilityToggle.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          node.hidden = !visibilityToggle.checked;
        });
        renderPreview();
        renderLayoutList();
      });
    });
  }

  if (textStyleSelect) {
    textStyleSelect.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (!supportsTextStyleSelection(node)) {
            return;
          }
          node.textStyle = textStyleSelect.value;
          if (node.component === "heading") {
            node.level = textStyleSelect.value;
          }
        });
        renderPreview();
        renderLayoutList();
      });
    });
  }

  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      recordUndoableChange(() => {
        const layout = getLayoutForSide(currentSide);
        if (!layout || !selectedNodeId) return;
        removeNodeById(layout, selectedNodeId);
        selectedNodeId = getRootChildren(currentSide)[0]?.uid ?? null;
        renderLayoutList();
        updateInspector();
        renderPreview();
      });
    });
  }
}

function wireEvents() {
  templateSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    hydrateEditablePages(template);
    renderFormatOptions(template);
    if (undoStack) {
      undoStack.clear();
    }
    pendingUndoSnapshot = null;
    pendingUndoTarget = null;
    selectFirstNode();
    markLayoutSaved();
  });
  formatSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    const format = getFormatById(template, formatSelect.value);
    renderOrientationOptions(format);
    renderPreview();
  });
  orientationSelect.addEventListener("change", () => {
    currentSide = "front";
    renderPreview();
  });
  sourceSelect.addEventListener("change", () => {
    const source = getActiveSource();
    clearSourcePayload(source);
    renderSourceInput(source);
    updateGenerateButtonState();
    renderPreview();
  });
  swapSideButton.addEventListener("click", toggleSide);
  if (generateButton) {
    generateButton.addEventListener("click", handleGeneratePrint);
  }
  printButton.addEventListener("click", () => window.print());
}

async function initPress() {
  initShell();
  initPressCollapsibles();
  try {
    await loadTemplates();
  } catch (error) {
    console.error("Unable to load templates", error);
    return;
  }

  populateSources();
  populateTemplates();
  renderFormatOptions(getActiveTemplate());
  initDragAndDrop();
  bindInspectorControls();
  renderLayoutList();
  selectFirstNode();
  markLayoutSaved();
  updateGenerateButtonState();
  wireEvents();
}

initPress();
