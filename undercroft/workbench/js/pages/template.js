import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { initSortableGroup } from "../lib/dnd.js";
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

const select = document.querySelector("[data-template-select]");
if (select) {
  populateSelect(
    select,
    TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.title }))
  );
  select.addEventListener("change", async () => {
    const selected = TEMPLATES.find((tpl) => tpl.id === select.value);
    if (!selected) {
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
  const previewRoot = document.querySelector("[data-preview-root]");
  if (!previewRoot) return;
  renderLayout(previewRoot, template.layout, character.data || {});
}

const sortables = initSortableGroup(document, "template-canvas");
const canvasRoot = document.querySelector("[data-canvas-root]");

function ensureCanvasState() {
  if (!canvasRoot) return;
  const placeholder = canvasRoot.querySelector("[data-canvas-placeholder]");
  const items = Array.from(canvasRoot.children).filter((child) => !child.hasAttribute("data-canvas-placeholder"));
  if (items.length && placeholder) {
    placeholder.remove();
  } else if (!items.length && !placeholder) {
    const empty = document.createElement("div");
    empty.className = "border border-dashed rounded-3 p-4 text-center fs-6 text-body-secondary";
    empty.setAttribute("data-canvas-placeholder", "true");
    empty.textContent = "Drag components from the palette to design your template.";
    canvasRoot.appendChild(empty);
  }
}

if (canvasRoot) {
  canvasRoot.addEventListener("sortable:changed", (event) => {
    if (event.detail.to === "canvas") {
      undoStack.push({ type: "reorder", detail: event.detail });
      status.show("Template canvas updated", { timeout: 1500 });
      ensureCanvasState();
    }
  });
}

const saveButton = document.querySelector('[data-action="save-template"]');
if (saveButton) {
  saveButton.addEventListener("click", () => {
    undoStack.push({ type: "save" });
    status.show("Template draft saved locally", { type: "success", timeout: 2000 });
  });
}

const addBlockButton = document.querySelector('[data-action="add-block"]');
if (addBlockButton && canvasRoot) {
  addBlockButton.addEventListener("click", () => {
    const block = document.createElement("div");
    block.className = "border rounded-3 px-3 py-2 shadow-sm bg-body";
    block.textContent = "New Block";
    block.setAttribute("data-sortable-handle", "true");
    canvasRoot.appendChild(block);
    undoStack.push({ type: "add", label: "New Block" });
    status.show("Added block to canvas", { type: "success", timeout: 2000 });
    ensureCanvasState();
  });
}

ensureCanvasState();

export { sortables };
