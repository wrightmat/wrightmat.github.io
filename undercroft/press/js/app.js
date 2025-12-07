import { initPaneToggles } from "../../workbench/js/lib/panes.js";
import { initThemeControls } from "../../workbench/js/lib/theme.js";
import { getTemplateById, getTemplates } from "./templates.js";

const templateSelect = document.getElementById("templateSelect");
const templateSummary = document.getElementById("templateSummary");
const overlayToggle = document.getElementById("overlayToggle");
const backToggle = document.getElementById("backToggle");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const sideLabel = document.getElementById("sideLabel");
const swapSideButton = document.getElementById("swapSide");
const printButton = document.getElementById("printButton");

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

function applyOverlays(page) {
  if (!overlayToggle.checked) return;
  const trim = document.createElement("div");
  trim.className = "page-overlay trim-lines";
  const safe = document.createElement("div");
  safe.className = "page-overlay safe-area";
  page.append(trim, safe);
}

function renderPreview() {
  const template = getActiveTemplate();
  updateSummary(template);
  const side = backToggle.checked ? "back" : "front";
  sideLabel.textContent = `${side.charAt(0).toUpperCase()}${side.slice(1)} side`;

  previewStage.innerHTML = "";
  const page = template.createPage(side);
  applyOverlays(page);
  previewStage.appendChild(page);

  buildPrintStack(template);
}

function buildPrintStack(template) {
  printStack.innerHTML = "";
  template.sides.forEach((side) => {
    const page = template.createPage(side);
    applyOverlays(page);
    printStack.appendChild(page);
  });
}

function toggleSide() {
  backToggle.checked = !backToggle.checked;
  renderPreview();
}

function wireEvents() {
  templateSelect.addEventListener("change", renderPreview);
  overlayToggle.addEventListener("change", renderPreview);
  backToggle.addEventListener("change", renderPreview);
  swapSideButton.addEventListener("click", toggleSide);
  printButton.addEventListener("click", () => window.print());
}

initShell();
populateTemplates();
updateSummary(getActiveTemplate());
renderPreview();
wireEvents();
