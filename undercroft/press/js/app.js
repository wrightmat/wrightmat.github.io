import { initPaneToggles } from "../../workbench/js/lib/panes.js";
import { initThemeControls } from "../../workbench/js/lib/theme.js";
import {
  getFormatById,
  getPageSize,
  getSupportedSources,
  getTemplateById,
  getTemplates,
} from "./templates.js";
import { buildSourceSummary, getSourceById, getSources } from "./sources.js";

const templateSelect = document.getElementById("templateSelect");
const formatSelect = document.getElementById("formatSelect");
const orientationSelect = document.getElementById("orientationSelect");
const templateSummary = document.getElementById("templateSummary");
const sourceSelect = document.getElementById("sourceSelect");
const sourceSummary = document.getElementById("sourceSummary");
const sourceInputContainer = document.getElementById("sourceInputContainer");
const overlayToggle = document.getElementById("overlayToggle");
const selectionSummary = document.getElementById("selectionSummary");
const compatibilityList = document.getElementById("compatibilityList");
const formatList = document.getElementById("formatList");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
const printButton = document.getElementById("printButton");

const sourceValues = {};
let currentSide = "front";

function initShell() {
  initThemeControls(document);
  initPaneToggles(document);
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
  renderSourceInput(active);
  updateSourceSummary();
}

function populateTemplates() {
  const templates = getTemplates();
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    templateSelect.appendChild(option);
  });
}

function populateFormats(template) {
  formatSelect.innerHTML = "";
  template.formats?.forEach((format) => {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = format.label;
    formatSelect.appendChild(option);
  });
  const firstFormat = template.formats?.[0];
  formatSelect.value = firstFormat?.id ?? "";
  populateOrientations(firstFormat);
}

function populateOrientations(format) {
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
  const size = getPageSize(template, format?.id, orientation);
  const value = sourceValues[source.id];
  const summary = buildSourceSummary(source, value);

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

function measurementCopy(size) {
  return `${size.width}in × ${size.height}in page`;
}

function updateTemplateSummary(context) {
  const { template, size, orientation, sourceSummary: summary } = context;
  const sides = template.sides.join(" / ");
  templateSummary.innerHTML = `
    <div class="fw-semibold">${template.description}</div>
    <div class="text-body-secondary">${measurementCopy(size)} (${orientation})</div>
    <div class="text-body-secondary">Sides: ${sides}</div>
    <div class="text-body-secondary">Source: ${summary}</div>
  `;
}

function updateCompatibility(template, format) {
  if (compatibilityList) {
    compatibilityList.innerHTML = "";
    const supported = getSupportedSources(template);
    supported.forEach((source) => {
      const li = document.createElement("li");
      li.textContent = source === "srd" ? "5e API (SRD)" : source.toUpperCase();
      compatibilityList.appendChild(li);
    });
  }

  if (formatList) {
    formatList.innerHTML = "";
    template.formats?.forEach((entry) => {
      const li = document.createElement("li");
      const orientations = entry.orientations?.join(" / ") ?? "Portrait";
      li.textContent = `${entry.label} — ${orientations}`;
      if (format && entry.id === format.id) {
        li.className = "fw-semibold";
      }
      formatList.appendChild(li);
    });
  }
}

function applyOverlays(page, template, size, { forPrint = false } = {}) {
  if (!overlayToggle.checked) return;

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
  updateTemplateSummary({ template, size, orientation, sourceSummary: summary });
  updateCompatibility(template, format);
  const side = currentSide;

  previewStage.innerHTML = "";
  const page = template.createPage(side, { size, format, source: { ...source, value: sourceValue, summary } });
  applyOverlays(page, template, size, { forPrint: false });
  previewStage.appendChild(page);

  buildPrintStack(template, { size, format, source: { ...source, value: sourceValue, summary } });
  updateSideButton();
  updateSelectionBadges(context);
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
  const value = sourceValues[source.id];
  sourceSummary.textContent = buildSourceSummary(source, value);
}

function renderSourceInput(source) {
  sourceInputContainer.innerHTML = "";
  const inputSpec = source.input;
  if (!inputSpec) return;

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

  const helper = document.createElement("div");
  helper.className = "small text-body-secondary";
  helper.textContent = inputSpec.helper ?? "";

  sourceInputContainer.append(label, input, helper);
}

function wireEvents() {
  templateSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    populateFormats(template);
    renderPreview();
  });
  formatSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    const format = getFormatById(template, formatSelect.value);
    populateOrientations(format);
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
  overlayToggle.addEventListener("change", renderPreview);
  swapSideButton.addEventListener("click", toggleSide);
  printButton.addEventListener("click", () => window.print());
}

initShell();
populateSources();
populateTemplates();
populateFormats(getActiveTemplate());
updateTemplateSummary(getSelectionContext());
renderPreview();
wireEvents();
