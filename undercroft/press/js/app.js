import { initPaneToggles } from "../../common/js/lib/panes.js";
import { initThemeControls } from "../../common/js/lib/theme.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
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
const ddbHelp = document.getElementById("ddbHelp");
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

const sourceValues = {};
let currentSide = "front";

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
  const context = getSelectionContext();
  const { template, source, format, size, orientation, sourceValue, sourceSummary: summary } = context;
  if (!template || !size) return;
  const side = currentSide;

  previewStage.innerHTML = "";
  const page = template.createPage(side, { size, format, source: { ...source, value: sourceValue, summary } });
  applyOverlays(page, template, size, { forPrint: false });
  previewStage.appendChild(page);

  buildPrintStack(template, { size, format, source: { ...source, value: sourceValue, summary } });
  updateSideButton();
  updateSelectionBadges(context);
  renderJsonPreview();
}

function buildPrintStack(template, { size, format, source }) {
  printStack.innerHTML = "";
  template.sides.forEach((side) => {
    const page = template.createPage(side, { size, format, source });
    applyOverlays(page, template, size, { forPrint: true });
    printStack.appendChild(page);
  });
}

function toggleSide() {
  currentSide = currentSide === "front" ? "back" : "front";
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

  if (ddbHelp) {
    ddbHelp.classList.toggle("d-none", source?.id !== "ddb");
  }

  const label = document.createElement("label");
  label.className = "form-label fw-semibold mb-0";
  label.setAttribute("for", `${source.id}-input`);
  label.textContent = inputSpec.label;

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

  const helperText = inputSpec.helper ?? "";
  const helper = helperText
    ? Object.assign(document.createElement("div"), {
        className: "small text-body-secondary",
        textContent: helperText,
      })
    : null;

  sourceInputContainer.append(label, input);
  if (helper) {
    sourceInputContainer.append(helper);
  }
}

function initCollapsibles() {
  bindCollapsible(selectionToggle, selectionPanel, {
    collapsed: false,
    expandLabel: "Expand selections",
    collapseLabel: "Collapse selections",
    labelElement: selectionToggleLabel,
  });
  bindCollapsible(jsonToggle, jsonPanel, {
    collapsed: true,
    expandLabel: "Expand JSON preview",
    collapseLabel: "Collapse JSON preview",
    labelElement: jsonToggleLabel,
  });
}

function initCollapsibles() {
  bindCollapsible(selectionToggle, selectionPanel, {
    collapsed: false,
    expandLabel: "Expand selections",
    collapseLabel: "Collapse selections",
    labelElement: selectionToggleLabel,
  });
  bindCollapsible(jsonToggle, jsonPanel, {
    collapsed: true,
    expandLabel: "Expand JSON preview",
    collapseLabel: "Collapse JSON preview",
    labelElement: jsonToggleLabel,
  });
}

function wireEvents() {
  templateSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    renderFormatOptions(template);
    renderPreview();
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
  initCollapsibles();
  try {
    await loadTemplates();
  } catch (error) {
    console.error("Unable to load templates", error);
    return;
  }

  populateSources();
  populateTemplates();
  renderFormatOptions(getActiveTemplate());
  renderPreview();
  wireEvents();
}

initPress();
