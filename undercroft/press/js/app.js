import { initPaneToggles } from "../../workbench/js/lib/panes.js";
import { initThemeControls } from "../../workbench/js/lib/theme.js";
import { getTemplateById, getTemplates } from "./templates.js";

const templateSelect = document.getElementById("templateSelect");
const templateSummary = document.getElementById("templateSummary");
const overlayToggle = document.getElementById("overlayToggle");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
const printButton = document.getElementById("printButton");
let currentSide = "front";

function initShell() {
  initThemeControls(document);
  initPaneToggles(document);
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

function getActiveTemplate() {
  const selected = templateSelect.value;
  return getTemplateById(selected);
}

function updateSummary(template) {
  const { size, card, sides, description } = template;
  const measurement = card
    ? `${card.width}in × ${card.height}in cards, ${size.width}in × ${size.height}in page`
    : `${size.width}in × ${size.height}in page`;
  templateSummary.innerHTML = `
    <div class="fw-semibold">${description}</div>
    <div class="text-body-secondary">${measurement}</div>
    <div class="text-body-secondary">Sides: ${sides.join(" / ")}</div>
  `;
}

function applyOverlays(page, template, { forPrint = false } = {}) {
  if (!overlayToggle.checked) return;

  if (template.type === "card") {
    const guides = document.createElement("div");
    guides.className = "page-overlay trim-lines card-guides";

    const { size, card } = template;
    const gridWidth = card.width * 3 + card.gutter * 2;
    const gridHeight = card.height * 3 + card.gutter * 2;
    const horizontalInset = size.margin + (size.width - size.margin * 2 - gridWidth) / 2;
    const verticalInset = size.margin;

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

    [0, 1, 2, 3].forEach((index) => {
      const x = horizontalInset + index * (card.width + card.gutter);
      addGuide("vertical", x, gridHeight, verticalInset);
    });

    [0, 1, 2, 3].forEach((index) => {
      const y = verticalInset + index * (card.height + card.gutter);
      addGuide("horizontal", y, gridWidth, horizontalInset);
    });

    page.appendChild(guides);
  }

  if (!forPrint) {
    const safe = document.createElement("div");
    safe.className = "page-overlay safe-area";
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
  const template = getActiveTemplate();
  updateSummary(template);
  const side = currentSide;

  previewStage.innerHTML = "";
  const page = template.createPage(side);
  applyOverlays(page, template, { forPrint: false });
  previewStage.appendChild(page);

  buildPrintStack(template);
  updateSideButton();
}

function buildPrintStack(template) {
  printStack.innerHTML = "";
  template.sides.forEach((side) => {
    const page = template.createPage(side);
    applyOverlays(page, template, { forPrint: true });
    printStack.appendChild(page);
  });
}

function toggleSide() {
  currentSide = currentSide === "front" ? "back" : "front";
  renderPreview();
}

function wireEvents() {
  templateSelect.addEventListener("change", () => {
    currentSide = "front";
    renderPreview();
  });
  overlayToggle.addEventListener("change", renderPreview);
  swapSideButton.addEventListener("click", toggleSide);
  printButton.addEventListener("click", () => window.print());
}

initShell();
populateTemplates();
updateSummary(getActiveTemplate());
renderPreview();
wireEvents();
