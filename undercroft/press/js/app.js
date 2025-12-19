import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initPaneToggles } from "../../common/js/lib/panes.js";
import { initThemeControls } from "../../common/js/lib/theme.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { createSortable } from "../../workbench/js/lib/dnd.js";
import {
  getFormatById,
  getPageSize,
  getTemplateById,
  getTemplates,
  loadTemplates,
} from "./templates.js";
import { buildSourceSummary, getSourceById, getSources } from "./sources.js";

const templateSelect = document.getElementById("templateSelect");
const formatSelect = document.getElementById("formatSelect");
const orientationSelect = document.getElementById("orientationSelect");
const sourceSelect = document.getElementById("sourceSelect");
const sourceSummary = document.getElementById("sourceSummary");
const sourceInputContainer = document.getElementById("sourceInputContainer");
const selectionSummary = document.getElementById("selectionSummary");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
const printButton = document.getElementById("printButton");
const selectionToggle = document.querySelector("[data-selection-toggle]");
const selectionToggleLabel = selectionToggle?.querySelector("[data-toggle-label]");
const selectionPanel = document.querySelector("[data-selection-panel]");
const jsonToggle = document.querySelector("[data-json-toggle]");
const jsonToggleLabel = document.querySelector("[data-json-toggle-label]");
const jsonPanel = document.querySelector("[data-json-panel]");
const jsonPreview = document.querySelector("[data-json-preview]");
const jsonBytes = document.querySelector("[data-json-bytes]");
const paletteList = document.querySelector("[data-press-palette]");
const layoutList = document.querySelector("[data-layout-list]");
const layoutEmptyState = document.querySelector("[data-layout-empty]");
const inspectorSection = document.querySelector("[data-component-inspector]");
const inspectorTitle = document.querySelector("[data-inspector-title]");
const textEditor = document.querySelector("[data-component-text]");
const fontSizeInput = document.querySelector("[data-component-font-size]");
const fontSizeValue = document.querySelector("[data-component-font-size-value]");
const fontColorInput = document.querySelector("[data-component-font-color]");
const visibilityToggle = document.querySelector("[data-component-visible]");
const headingLevelSelect = document.querySelector("[data-heading-level]");

const sourceValues = {};
let currentSide = "front";
let selectedNodeId = null;
let nodeCounter = 0;
let editablePages = { front: null, back: null };
let paletteSortable = null;
let layoutSortable = null;
let canvasSortable = null;

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
    id: "notes",
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
  initThemeControls(document);
  initPaneToggles(document);
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
    updateSourceSummary();
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

function getSelectionContext() {
  const template = getActiveTemplate();
  const source = getActiveSource();
  const format = getFormatById(template, formatSelect.value);
  const orientation = orientationSelect.value || format?.defaultOrientation;
  const size = template && format ? getPageSize(template, format?.id, orientation) : null;
  const value = sourceValues[source?.id];
  const summary = source ? buildSourceSummary(source, value) : "";

  return {
    template,
    source,
    format,
    orientation,
    size,
    sourceValue: value,
    sourceSummary: summary,
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
        summary: context.sourceSummary,
        value: context.sourceValue,
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
  if (node.component === "heading") return node.text || "Heading";
  if (node.component === "text") return node.text ? node.text.slice(0, 48) : "Text";
  if (node.component === "badge") return node.text || node.label || "Badge";
  if (node.component === "list") return "List";
  if (node.component === "noteLines") return "Notes";
  return node.component || node.type || "Component";
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
      insertNodeAtRoot(currentSide, newNode, getRootChildren(currentSide).length);
      renderLayoutList();
      selectNode(newNode.uid);
      renderPreview();
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

  if (!hasSelection) {
    if (textEditor) textEditor.value = "";
    if (fontSizeInput) fontSizeInput.value = 16;
    if (fontSizeValue) fontSizeValue.textContent = "16px";
    if (fontColorInput) fontColorInput.value = "#212529";
    if (visibilityToggle) visibilityToggle.checked = true;
    if (headingLevelSelect) headingLevelSelect.value = "h3";
    return;
  }

  if (textEditor) {
    textEditor.value = getNodeText(node);
    textEditor.placeholder = node.component === "list" ? "One entry per line" : "Text or label";
  }

  if (fontSizeInput) {
    const size = typeof node?.style?.fontSize === "number" ? node.style.fontSize : 16;
    fontSizeInput.value = size;
    if (fontSizeValue) {
      fontSizeValue.textContent = `${size}px`;
    }
  }

  if (fontColorInput) {
    fontColorInput.value = node?.style?.color ?? "#212529";
  }

  if (visibilityToggle) {
    visibilityToggle.checked = !node.hidden;
  }

  if (headingLevelSelect) {
    headingLevelSelect.value = node.component === "heading" ? node.level ?? "h3" : "h3";
    headingLevelSelect.disabled = node.component !== "heading";
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

function updateSelectionBadges(context) {
  selectionSummary.innerHTML = "";
  if (!context.source || !context.template || !context.size) {
    return;
  }
  const badges = [
    { label: "Source", value: context.source.name },
    { label: "Template", value: context.template.name },
    { label: "Size", value: `${context.size.label} (${context.orientation})` },
    { label: "Side", value: currentSide === "front" ? "Front" : "Back" },
  ];

  badges.forEach((item) => {
    const badge = document.createElement("span");
    badge.className = "badge text-bg-secondary";
    badge.textContent = `${item.label}: ${item.value}`;
    selectionSummary.appendChild(badge);
  });
}

function renderPreview() {
  destroyCanvasDnd();
  const context = getSelectionContext();
  const { template, source, format, size, orientation, sourceValue, sourceSummary: summary } = context;
  if (!template || !size) return;
  const side = currentSide;
  const pageOverride = getEditablePage(side);
  let layoutRoot = null;

  previewStage.innerHTML = "";
  const page = template.createPage(side, {
    size,
    format,
    source: { ...source, value: sourceValue, summary },
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

  buildPrintStack(template, { size, format, source: { ...source, value: sourceValue, summary } });
  updateSideButton();
  updateSelectionBadges(context);
  renderJsonPreview();
}

function buildPrintStack(template, { size, format, source }) {
  printStack.innerHTML = "";
  template.sides.forEach((side) => {
    const page = template.createPage(side, {
      size,
      format,
      source,
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

function updateSourceSummary() {
  const source = getActiveSource();
  if (!source) {
    sourceSummary.textContent = "";
    return;
  }
  const value = sourceValues[source.id];
  sourceSummary.textContent = buildSourceSummary(source, value);
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
    updateSourceSummary();
    renderPreview();
  });

  sourceInputContainer.append(labelRow, input);
}

function initPressCollapsibles() {
  bindCollapsibleToggle(selectionToggle, selectionPanel, {
    collapsed: false,
    expandLabel: "Expand selections",
    collapseLabel: "Collapse selections",
    labelElement: selectionToggleLabel,
  });
  bindCollapsibleToggle(jsonToggle, jsonPanel, {
    collapsed: true,
    expandLabel: "Expand JSON preview",
    collapseLabel: "Collapse JSON preview",
    labelElement: jsonToggleLabel,
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
  const index = typeof event.newIndex === "number" ? event.newIndex : getRootChildren(currentSide).length;
  insertNodeAtRoot(currentSide, newNode, index);
  renderLayoutList();
  selectNode(newNode.uid);
}

function handleLayoutReorder(event) {
  reorderRootChildren(currentSide, event.oldIndex ?? 0, event.newIndex ?? 0);
  renderLayoutList();
  renderPreview();
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
  const index = typeof event.newIndex === "number" ? event.newIndex : getRootChildren(currentSide).length;
  insertNodeAtRoot(currentSide, newNode, index);
  renderLayoutList();
  selectNode(newNode.uid);
}

function handleCanvasReorder(event) {
  reorderRootChildren(currentSide, event.oldIndex ?? 0, event.newIndex ?? 0);
  renderLayoutList();
  renderPreview();
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
    });
  }

  if (fontSizeInput) {
    fontSizeInput.addEventListener("input", () => {
      const size = Number(fontSizeInput.value) || 16;
      updateSelectedNode((node) => {
        const styles = { ...(node.style ?? {}) };
        styles.fontSize = size;
        node.style = styles;
      });
      if (fontSizeValue) {
        fontSizeValue.textContent = `${size}px`;
      }
      renderPreview();
    });
  }

  if (fontColorInput) {
    fontColorInput.addEventListener("input", () => {
      const color = fontColorInput.value || "#212529";
      updateSelectedNode((node) => {
        const styles = { ...(node.style ?? {}) };
        styles.color = color;
        node.style = styles;
      });
      renderPreview();
    });
  }

  if (visibilityToggle) {
    visibilityToggle.addEventListener("change", () => {
      updateSelectedNode((node) => {
        node.hidden = !visibilityToggle.checked;
      });
      renderPreview();
      renderLayoutList();
    });
  }

  if (headingLevelSelect) {
    headingLevelSelect.addEventListener("change", () => {
      updateSelectedNode((node) => {
        if (node.component === "heading") {
          node.level = headingLevelSelect.value;
        }
      });
      renderPreview();
      renderLayoutList();
    });
  }
}

function wireEvents() {
  templateSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    hydrateEditablePages(template);
    renderFormatOptions(template);
    selectFirstNode();
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
    renderSourceInput(source);
    updateSourceSummary();
    renderPreview();
  });
  swapSideButton.addEventListener("click", toggleSide);
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
  wireEvents();
}

initPress();
