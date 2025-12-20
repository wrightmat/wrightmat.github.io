import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { createSortable } from "../../common/js/lib/dnd.js";
import { expandPane } from "../../common/js/lib/panes.js";
import {
  getFormatById,
  getPageSize,
  getStandardFormats,
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
const templateInspector = document.querySelector("[data-template-inspector]");
const templateIdInput = document.querySelector("[data-template-id]");
const templateNameInput = document.querySelector("[data-template-name]");
const templateDescriptionInput = document.querySelector("[data-template-description]");
const templateTypeSelect = document.querySelector("[data-template-type]");
const templateFormatsGroup = document.querySelector("[data-template-formats]");
const templateSourcesGroup = document.querySelector("[data-template-sources]");
const templateCardGroup = document.querySelector("[data-template-card-group]");
const templateCardWidthInput = document.querySelector("[data-template-card-width]");
const templateCardHeightInput = document.querySelector("[data-template-card-height]");
const templateCardGutterInput = document.querySelector("[data-template-card-gutter]");
const templateCardSafeInsetInput = document.querySelector("[data-template-card-safe-inset]");
const templateCardColumnsInput = document.querySelector("[data-template-card-columns]");
const templateCardRowsInput = document.querySelector("[data-template-card-rows]");
const templateToggle = document.querySelector("[data-template-toggle]");
const templateToggleLabel = templateToggle?.querySelector("[data-template-toggle-label]");
const templatePanel = document.querySelector("[data-template-panel]");
const cardToggle = document.querySelector("[data-card-toggle]");
const cardToggleLabel = cardToggle?.querySelector("[data-card-toggle-label]");
const cardPanel = document.querySelector("[data-card-panel]");
const componentToggle = document.querySelector("[data-component-toggle]");
const componentToggleLabel = componentToggle?.querySelector("[data-component-toggle-label]");
const componentPanel = document.querySelector("[data-component-panel]");
const inspectorSection = document.querySelector("[data-component-inspector]");
const inspectorTitle = document.querySelector("[data-inspector-title]");
const typeSummary = document.querySelector("[data-component-type-summary]");
let typeIcon = document.querySelector("[data-component-type-icon]");
const typeLabel = document.querySelector("[data-component-type-label]");
const typeDescription = document.querySelector("[data-component-type-description]");
const textEditor = document.querySelector("[data-component-text]");
const gapInput = document.querySelector("[data-component-gap]");
const gapField = document.querySelector("[data-inspector-gap-field]");
const textFieldGroup = document.querySelector("[data-inspector-text-field]");
const textSettingGroups = Array.from(document.querySelectorAll("[data-inspector-text-settings]"));
const colorGroup = document.querySelector("[data-inspector-color-group]");
const alignmentTitle = document.querySelector("[data-alignment-title]");
const alignmentLabels = {
  start: document.querySelector('[data-alignment-label="start"]'),
  center: document.querySelector('[data-alignment-label="center"]'),
  end: document.querySelector('[data-alignment-label="end"]'),
  justify: document.querySelector('[data-alignment-label="justify"]'),
};
const textSizeInputs = Array.from(document.querySelectorAll("[data-component-text-size]"));
const colorInputs = Array.from(document.querySelectorAll("[data-component-color]"));
const colorClearButtons = Array.from(document.querySelectorAll("[data-component-color-clear]"));
const textStyleToggles = Array.from(document.querySelectorAll("[data-component-text-style]"));
const alignInputs = Array.from(document.querySelectorAll("[data-component-align]"));
const visibilityToggle = document.querySelector("[data-component-visible]");
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
let applyTemplateCollapse = null;
let applyCardCollapse = null;
let applyComponentCollapse = null;
let activeTemplateId = null;

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
      textSize: "lg",
      textStyles: { bold: true },
      className: "card-title",
    },
  },
  {
    id: "text",
    label: "Text",
    description: "Paragraphs, summaries, or captions",
    icon: "tabler:align-left",
    node: {
      type: "field",
      component: "text",
      text: "Editable body text for this card or sheet.",
      textSize: "md",
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
    label: "Block",
    description: "Label + value blocks",
    icon: "tabler:graph",
    node: {
      type: "field",
      component: "stat",
      label: "Label",
      text: "Value",
      className: "panel-box",
    },
  },
  {
    id: "stack",
    label: "Stack",
    description: "Vertical layout groups",
    icon: "tabler:layout-list",
    node: {
      type: "stack",
      gap: 4,
      align: "justify",
      children: [
        {
          type: "field",
          component: "heading",
          text: "Stack heading",
          textSize: "md",
          textStyles: { bold: true },
          className: "card-title",
        },
        {
          type: "field",
          component: "text",
          text: "Stack body text",
          textSize: "md",
          className: "mb-0",
        },
      ],
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
            textSize: "md",
            className: "mb-0",
          },
        },
        {
          node: {
            type: "field",
            component: "text",
            text: "Column text",
            textSize: "md",
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

const standardFormats = getStandardFormats();
const standardFormatMap = new Map(standardFormats.map((format) => [format.id, format]));
let templateFormatInputs = [];
let templateSourceInputs = [];

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

function renderTemplateFormatOptions() {
  if (!templateFormatsGroup) return;
  templateFormatsGroup.innerHTML = "";
  templateFormatInputs = standardFormats.map((format) => {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = `template-format-${format.id}`;
    input.value = format.id;
    input.dataset.templateFormatOption = format.id;
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", input.id);
    label.textContent = format.label;
    wrapper.append(input, label);
    templateFormatsGroup.appendChild(wrapper);
    return input;
  });
}

function renderTemplateSourceOptions() {
  if (!templateSourcesGroup) return;
  templateSourcesGroup.innerHTML = "";
  templateSourceInputs = getSources().map((source) => {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = `template-source-${source.id}`;
    input.value = source.id;
    input.dataset.templateSourceOption = source.id;
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", input.id);
    label.textContent = source.name;
    wrapper.append(input, label);
    templateSourcesGroup.appendChild(wrapper);
    return input;
  });
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

function getTemplateProperties(template) {
  if (!template) return null;
  return {
    id: template.id ?? "",
    name: template.name ?? "",
    description: template.description ?? "",
    type: template.type ?? "",
    formats: cloneState(template.formats ?? []),
    supportedSources: cloneState(template.supportedSources ?? []),
    card: template.card ? cloneState(template.card) : null,
  };
}

function createLayoutSnapshot(template = getActiveTemplate()) {
  return {
    pages: cloneState(editablePages),
    template: getTemplateProperties(template),
  };
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

function markLayoutSaved(snapshot) {
  lastSavedLayout = snapshot ?? createLayoutSnapshot();
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
  return saveTemplateChanges({ confirm: true });
}

async function saveTemplateChanges({ template = getActiveTemplate(), confirm = true } = {}) {
  if (!template) {
    return false;
  }
  const hasChanges = !snapshotsEqual(lastSavedLayout, createLayoutSnapshot(template));
  if (!hasChanges) {
    return false;
  }
  if (confirm) {
    const confirmed = window.confirm("Save template changes?");
    if (!confirmed) {
      if (status) {
        status.show("Save cancelled", { type: "info", timeout: 1500 });
      }
      return false;
    }
  }
  const payload = serializeTemplate(template);
  if (!payload) {
    return false;
  }
  isSaving = true;
  updateSaveState();
  try {
    await saveTemplateToServer(payload);
    template.pages = payload.pages;
    markLayoutSaved(createLayoutSnapshot(template));
    if (status) {
      status.show("Template saved", { type: "success", timeout: 2000 });
    }
    return true;
  } catch (error) {
    console.error("Failed to save template", error);
    if (status) {
      status.show(error.message || "Unable to save template", { type: "error", timeout: 2500 });
    }
    return false;
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

function updateTemplateSelectOption(template, previousId) {
  if (!templateSelect || !template) return;
  const options = Array.from(templateSelect.options);
  const option = options.find((entry) => entry.value === previousId) || options.find((entry) => entry.value === template.id);
  if (!option) return;
  option.value = template.id;
  option.textContent = template.name ?? option.textContent;
  templateSelect.value = template.id;
}

function setTemplateFormatSelections(template) {
  if (!templateFormatsGroup) return;
  const selected = new Set((template.formats ?? []).map((format) => format.id ?? format.sizeId));
  templateFormatInputs.forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function setTemplateSourceSelections(template) {
  if (!templateSourcesGroup) return;
  const selected = new Set(template.supportedSources ?? []);
  templateSourceInputs.forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function setCardInputsDisabled(isDisabled) {
  [
    templateCardWidthInput,
    templateCardHeightInput,
    templateCardGutterInput,
    templateCardSafeInsetInput,
    templateCardColumnsInput,
    templateCardRowsInput,
  ].forEach((input) => {
    if (!input) return;
    input.disabled = isDisabled;
  });
}

function updateTemplateInspector(template) {
  if (!templateInspector) return;
  const hasTemplate = Boolean(template);
  templateInspector.classList.toggle("opacity-50", !hasTemplate);
  templateInspector.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = !hasTemplate;
  });
  setCardInputsDisabled(!hasTemplate);
  if (!hasTemplate) return;

  if (templateIdInput) {
    templateIdInput.value = template.id ?? "";
  }
  if (templateNameInput) {
    templateNameInput.value = template.name ?? "";
  }
  if (templateDescriptionInput) {
    templateDescriptionInput.value = template.description ?? "";
  }
  if (templateTypeSelect) {
    templateTypeSelect.value = template.type ?? "sheet";
  }
  setTemplateFormatSelections(template);
  setTemplateSourceSelections(template);
  const isCard = template.type === "card" || Boolean(template.card);
  if (templateCardGroup) {
    templateCardGroup.hidden = !isCard;
    templateCardGroup.classList.toggle("d-none", !isCard);
  }
  setCardInputsDisabled(!isCard);
  if (isCard) {
    const card = template.card ?? {};
    if (templateCardWidthInput) templateCardWidthInput.value = card.width ?? "";
    if (templateCardHeightInput) templateCardHeightInput.value = card.height ?? "";
    if (templateCardGutterInput) templateCardGutterInput.value = card.gutter ?? "";
    if (templateCardSafeInsetInput) templateCardSafeInsetInput.value = card.safeInset ?? "";
    if (templateCardColumnsInput) templateCardColumnsInput.value = card.columns ?? "";
    if (templateCardRowsInput) templateCardRowsInput.value = card.rows ?? "";
  } else {
    if (templateCardWidthInput) templateCardWidthInput.value = "";
    if (templateCardHeightInput) templateCardHeightInput.value = "";
    if (templateCardGutterInput) templateCardGutterInput.value = "";
    if (templateCardSafeInsetInput) templateCardSafeInsetInput.value = "";
    if (templateCardColumnsInput) templateCardColumnsInput.value = "";
    if (templateCardRowsInput) templateCardRowsInput.value = "";
  }
}

function bindTemplateInspectorControls() {
  if (templateIdInput) {
    templateIdInput.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      const nextId = templateIdInput.value.trim();
      if (!nextId) {
        templateIdInput.value = template.id ?? "";
        return;
      }
      const previousId = template.id;
      template.id = nextId;
      updateTemplateSelectOption(template, previousId);
      activeTemplateId = template.id;
      updateSaveState();
      renderJsonPreview();
    });
  }

  if (templateNameInput) {
    templateNameInput.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      const nextName = templateNameInput.value.trim();
      template.name = nextName;
      template.title = nextName;
      updateTemplateSelectOption(template, template.id);
      updateSaveState();
      renderPreview();
    });
  }

  if (templateDescriptionInput) {
    templateDescriptionInput.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      template.description = templateDescriptionInput.value.trim();
      updateSaveState();
    });
  }

  if (templateTypeSelect) {
    templateTypeSelect.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      template.type = templateTypeSelect.value;
      if (template.type === "card" && !template.card) {
        template.card = {
          width: 2.5,
          height: 3.5,
          gutter: 0,
          safeInset: 0.125,
          columns: 3,
          rows: 3,
        };
      }
      if (template.type !== "card") {
        delete template.card;
      }
      updateTemplateInspector(template);
      updateSaveState();
      renderPreview();
    });
  }

  if (templateFormatInputs.length) {
    templateFormatInputs.forEach((input) => {
      input.addEventListener("change", () => {
        const template = getActiveTemplate();
        if (!template) return;
        const selected = templateFormatInputs
          .filter((item) => item.checked)
          .map((item) => standardFormatMap.get(item.value))
          .filter(Boolean)
          .map((format) => ({ ...format }));
        template.formats = selected;
        renderFormatOptions(template);
        renderPreview();
        updateSaveState();
      });
    });
  }

  if (templateSourceInputs.length) {
    templateSourceInputs.forEach((input) => {
      input.addEventListener("change", () => {
        const template = getActiveTemplate();
        if (!template) return;
        template.supportedSources = templateSourceInputs.filter((item) => item.checked).map((item) => item.value);
        updateSaveState();
      });
    });
  }

  const cardInputs = [
    { input: templateCardWidthInput, key: "width", parse: parseFloat },
    { input: templateCardHeightInput, key: "height", parse: parseFloat },
    { input: templateCardGutterInput, key: "gutter", parse: parseFloat },
    { input: templateCardSafeInsetInput, key: "safeInset", parse: parseFloat },
    { input: templateCardColumnsInput, key: "columns", parse: (value) => parseInt(value, 10) },
    { input: templateCardRowsInput, key: "rows", parse: (value) => parseInt(value, 10) },
  ];

  cardInputs.forEach(({ input, key, parse }) => {
    if (!input) return;
    input.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      if (!template.card) {
        template.card = {};
      }
      const raw = input.value;
      const parsed = raw === "" ? null : parse(raw);
      if (!Number.isNaN(parsed) && parsed !== null) {
        template.card[key] = parsed;
      } else if (raw === "") {
        delete template.card[key];
      }
      updateSaveState();
      renderPreview();
    });
  });
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
  if (node.type === "stack") return "Stack";
  if (node.component === "heading") return node.text || "Heading";
  if (node.component === "text") return node.text ? node.text.slice(0, 48) : "Text";
  if (node.component === "badge") return node.text || node.label || "Badge";
  if (node.component === "list") return "List";
  if (node.component === "noteLines") return "Notes";
  if (node.component === "stat") return node.label || "Block";
  return node.component || node.type || "Component";
}

function getPaletteEntryForNode(node) {
  if (!node) return null;
  if (node.type === "stack") {
    return paletteComponents.find((item) => item.id === "stack") ?? null;
  }
  if (node.type === "row") {
    return paletteComponents.find((item) => item.id === "row") ?? null;
  }
  if (node.component) {
    return paletteComponents.find((item) => item.id === node.component) ?? null;
  }
  return null;
}

function replaceTypeIcon(icon) {
  if (!typeSummary) return;
  const parent = typeSummary.querySelector("[data-component-type-icon]")?.parentElement;
  if (!parent) return;
  const fresh = document.createElement("span");
  fresh.className = "iconify fs-4 text-primary";
  fresh.setAttribute("data-component-type-icon", "");
  fresh.setAttribute("data-icon", icon);
  fresh.setAttribute("aria-hidden", "true");
  parent.replaceChild(fresh, parent.querySelector("[data-component-type-icon]"));
  typeIcon = fresh;
}

function mapFontSizeToToken(size) {
  if (typeof size !== "number") return "md";
  if (size <= 14) return "sm";
  if (size >= 22) return "xl";
  if (size >= 19) return "lg";
  return "md";
}

function getDefaultTextSize(node) {
  if (node?.component === "heading") return "lg";
  if (node?.component === "text") return "md";
  return "md";
}

function resolveTextSize(node) {
  if (!node) return "md";
  if (node.textSize) return node.textSize;
  const fallback = node.style?.fontSize;
  if (typeof fallback === "number") {
    return mapFontSizeToToken(fallback);
  }
  return getDefaultTextSize(node);
}

function resolveTextStyles(node) {
  const defaults = {
    bold: node?.component === "heading",
    italic: false,
    underline: false,
  };
  if (!node?.textStyles) {
    return defaults;
  }
  return {
    bold: typeof node.textStyles.bold === "boolean" ? node.textStyles.bold : defaults.bold,
    italic: Boolean(node.textStyles.italic),
    underline: Boolean(node.textStyles.underline),
  };
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
        replaceTypeIcon(entry.icon);
      }
      if (typeLabel) {
        typeLabel.textContent = entry.label;
      }
      if (typeDescription) {
        typeDescription.textContent = entry.description;
      }
    } else {
      if (typeIcon) {
        replaceTypeIcon("tabler:components");
      }
      if (typeLabel) {
        typeLabel.textContent = "Component";
      }
      if (typeDescription) {
        typeDescription.textContent = "Select a component to view details.";
      }
    }
    if (window.Iconify && typeof window.Iconify.scan === "function") {
      window.Iconify.scan(typeSummary);
    }
  }

  const setGroupVisibility = (group, isVisible) => {
    if (!group) return;
    group.hidden = !isVisible;
    group.classList.toggle("d-none", !isVisible);
    group.style.display = isVisible ? "" : "none";
  };

  if (!hasSelection) {
    if (textEditor) textEditor.value = "";
    if (gapInput) gapInput.value = "";
    setGroupVisibility(textFieldGroup, true);
    textSettingGroups.forEach((group) => setGroupVisibility(group, true));
    setGroupVisibility(colorGroup, true);
    if (gapField) {
      gapField.hidden = true;
    }
    textStyleToggles.forEach((input) => {
      input.disabled = false;
    });
    if (alignmentTitle) {
      alignmentTitle.textContent = "Alignment";
    }
    if (alignmentLabels.start) alignmentLabels.start.textContent = "Left";
    if (alignmentLabels.center) alignmentLabels.center.textContent = "Center";
    if (alignmentLabels.end) alignmentLabels.end.textContent = "Right";
    if (alignmentLabels.justify) alignmentLabels.justify.textContent = "Justify";
    alignInputs.forEach((input) => {
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.remove("d-none");
      }
    });
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
    return;
  }

  const isLayoutNode = node?.type === "row" || node?.type === "stack";
  const isStackNode = node?.type === "stack";
  setGroupVisibility(textFieldGroup, !isLayoutNode);
  textSettingGroups.forEach((group) => setGroupVisibility(group, !isLayoutNode));
  setGroupVisibility(colorGroup, true);
  textStyleToggles.forEach((input) => {
    input.disabled = isLayoutNode;
  });
  if (gapField) {
    gapField.hidden = !isLayoutNode;
  }

  if (gapInput) {
    const gapValue = Number.isFinite(node?.gap) ? node.gap : 4;
    gapInput.value = isLayoutNode ? String(gapValue) : "";
  }

  if (alignmentTitle) {
    if (isStackNode) {
      alignmentTitle.textContent = "Vertical alignment";
    } else if (isLayoutNode) {
      alignmentTitle.textContent = "Horizontal alignment";
    } else {
      alignmentTitle.textContent = "Alignment";
    }
  }
  if (isStackNode) {
    if (alignmentLabels.start) alignmentLabels.start.textContent = "Top";
    if (alignmentLabels.center) alignmentLabels.center.textContent = "Middle";
    if (alignmentLabels.end) alignmentLabels.end.textContent = "Bottom";
    if (alignmentLabels.justify) alignmentLabels.justify.textContent = "Justified";
    alignInputs.forEach((input) => {
      const shouldHide = false;
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.toggle("d-none", shouldHide);
      }
    });
  } else {
    if (alignmentLabels.start) alignmentLabels.start.textContent = "Left";
    if (alignmentLabels.center) alignmentLabels.center.textContent = "Center";
    if (alignmentLabels.end) alignmentLabels.end.textContent = "Right";
    if (alignmentLabels.justify) {
      alignmentLabels.justify.textContent = isLayoutNode ? "Stretch" : "Justify";
    }
    alignInputs.forEach((input) => {
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.remove("d-none");
      }
    });
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
      input.value = styles.color || COLOR_DEFAULTS.foreground;
    } else if (key === "background") {
      input.value = styles.backgroundColor || COLOR_DEFAULTS.background;
    } else if (key === "border") {
      input.value = styles.borderColor || COLOR_DEFAULTS.border;
    }
  });

  textStyleToggles.forEach((input) => {
    const styleKey = input.dataset.componentTextStyle;
    input.checked = Boolean(resolveTextStyles(node)[styleKey]);
  });

  const alignment = node?.align || (isStackNode ? "justify" : "start");
  alignInputs.forEach((input) => {
    input.checked = input.value === alignment;
  });

  if (visibilityToggle) {
    visibilityToggle.checked = !node.hidden;
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
  setInspectorMode("component");
  renderPreview();
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
    selectedNodeId = null;
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
  applyTemplateCollapse = bindCollapsibleToggle(templateToggle, templatePanel, {
    collapsed: false,
    expandLabel: "Expand template properties",
    collapseLabel: "Collapse template properties",
    labelElement: templateToggleLabel,
  });
  applyCardCollapse = bindCollapsibleToggle(cardToggle, cardPanel, {
    collapsed: false,
    expandLabel: "Expand card properties",
    collapseLabel: "Collapse card properties",
    labelElement: cardToggleLabel,
  });
  applyComponentCollapse = bindCollapsibleToggle(componentToggle, componentPanel, {
    collapsed: true,
    expandLabel: "Expand component properties",
    collapseLabel: "Collapse component properties",
    labelElement: componentToggleLabel,
  });
}

function setInspectorMode(mode) {
  if (rightPane && rightPaneToggle) {
    expandPane(rightPane, rightPaneToggle);
  }
  if (mode === "template") {
    if (applyTemplateCollapse) applyTemplateCollapse(false);
    if (applyCardCollapse) applyCardCollapse(false);
    if (applyComponentCollapse) applyComponentCollapse(true);
  }
  if (mode === "component") {
    if (applyTemplateCollapse) applyTemplateCollapse(true);
    if (applyCardCollapse) applyCardCollapse(true);
    if (applyComponentCollapse) applyComponentCollapse(false);
  }
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

  if (gapInput) {
    gapInput.addEventListener("focus", () => beginPendingUndo(gapInput));
    gapInput.addEventListener("blur", () => commitPendingUndo(gapInput));
    gapInput.addEventListener("change", () => commitPendingUndo(gapInput));
    gapInput.addEventListener("input", () => {
      const parsed = Number(gapInput.value);
      const next = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 12)) : 0;
      updateSelectedNode((node) => {
        if (node.type !== "row" && node.type !== "stack") return;
        node.gap = next;
      });
      renderPreview();
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
  templateSelect.addEventListener("change", async () => {
    const nextTemplateId = templateSelect.value;
    const previousTemplateId = activeTemplateId;
    const previousTemplate = previousTemplateId ? getTemplateById(previousTemplateId) : null;
    if (previousTemplate) {
      const hasChanges = !snapshotsEqual(lastSavedLayout, createLayoutSnapshot(previousTemplate));
      if (hasChanges) {
        const confirmed = window.confirm("Save changes to the current template before switching?");
        if (confirmed) {
          templateSelect.value = previousTemplateId;
          const saved = await saveTemplateChanges({ template: previousTemplate, confirm: false });
          if (!saved) {
            templateSelect.value = previousTemplateId;
            return;
          }
          templateSelect.value = nextTemplateId;
        }
      }
    }
    currentSide = "front";
    const template = getActiveTemplate();
    hydrateEditablePages(template);
    renderFormatOptions(template);
    updateTemplateInspector(template);
    if (undoStack) {
      undoStack.clear();
    }
    pendingUndoSnapshot = null;
    pendingUndoTarget = null;
    selectedNodeId = null;
    renderLayoutList();
    updateInspector();
    renderPreview();
    markLayoutSaved();
    activeTemplateId = template?.id ?? null;
    setInspectorMode("template");
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
  renderTemplateSourceOptions();
  populateTemplates();
  renderTemplateFormatOptions();
  renderFormatOptions(getActiveTemplate());
  updateTemplateInspector(getActiveTemplate());
  bindTemplateInspectorControls();
  initDragAndDrop();
  bindInspectorControls();
  renderLayoutList();
  selectedNodeId = null;
  updateInspector();
  renderPreview();
  markLayoutSaved();
  updateGenerateButtonState();
  wireEvents();
  activeTemplateId = getActiveTemplate()?.id ?? null;
  setInspectorMode("template");
}

initPress();
