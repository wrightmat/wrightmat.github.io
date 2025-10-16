import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { initSortableGroup } from "../lib/dnd.js";
import { DataManager } from "../lib/data-manager.js";

const { status, undoStack } = initAppShell({ namespace: "system" });
const manager = new DataManager();

const SYSTEMS = [
  {
    id: "sys.dnd5e",
    title: "D&D 5e (Basic)",
    path: "data/systems/sys.dnd5e.json",
  },
];

const select = document.querySelector("[data-system-select]");
if (select) {
  populateSelect(
    select,
    SYSTEMS.map((system) => ({ value: system.id, label: system.title }))
  );
  select.addEventListener("change", async () => {
    const selected = SYSTEMS.find((system) => system.id === select.value);
    if (!selected) {
      return;
    }
    try {
      const response = await fetch(selected.path);
      const data = await response.json();
      renderOutline(data);
      status.show(`Loaded ${data.title}`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.error("Unable to load system", error);
      status.show("Failed to load system", { type: "error", timeout: 2500 });
    }
  });
}

const sortables = initSortableGroup(document, "system-canvas");
const canvasRoot = document.querySelector("[data-canvas-root]");

function ensureCanvasState() {
  if (!canvasRoot) return;
  const placeholder = canvasRoot.querySelector("[data-canvas-placeholder]");
  const items = Array.from(canvasRoot.children).filter((child) => !child.hasAttribute("data-canvas-placeholder"));
  if (items.length && placeholder) {
    placeholder.remove();
  } else if (!items.length && !placeholder) {
    const empty = document.createElement("div");
    empty.className = "rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400";
    empty.setAttribute("data-canvas-placeholder", "true");
    empty.textContent = "Drag fields from the palette to begin building your system.";
    canvasRoot.appendChild(empty);
  }
}

if (canvasRoot) {
  canvasRoot.addEventListener("sortable:changed", (event) => {
    if (event.detail.to === "canvas") {
      undoStack.push({ type: "reorder", detail: event.detail });
      status.show("Canvas updated", { timeout: 1500 });
      ensureCanvasState();
    }
  });
}

const saveButton = document.querySelector('[data-action="save-system"]');
if (saveButton) {
  saveButton.addEventListener("click", () => {
    undoStack.push({ type: "save" });
    status.show("System draft saved locally", { type: "success", timeout: 2000 });
  });
}

const addFieldButton = document.querySelector('[data-action="add-field"]');
if (addFieldButton && canvasRoot) {
  addFieldButton.addEventListener("click", () => {
    const field = document.createElement("div");
    field.className = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm transition hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800";
    field.textContent = "New Field";
    field.setAttribute("data-sortable-handle", "true");
    canvasRoot.appendChild(field);
    undoStack.push({ type: "add", label: "New Field" });
    status.show("Added field to canvas", { type: "success", timeout: 2000 });
    ensureCanvasState();
  });
}

const outlineButton = document.querySelector('[data-action="expand-outline"]');
if (outlineButton) {
  outlineButton.addEventListener("click", () => {
    const outline = document.querySelector("[data-system-outline]");
    if (outline) {
      outline.classList.toggle("max-h-64");
      outline.classList.toggle("overflow-auto");
      status.show("Toggled outline view", { timeout: 1500 });
    }
  });
}

function renderOutline(system) {
  const outline = document.querySelector("[data-system-outline]");
  if (!outline) return;
  outline.innerHTML = "";
  system.fields.forEach((field) => {
    outline.appendChild(renderFieldNode(field));
  });
}

function renderFieldNode(field, depth = 0) {
  const item = document.createElement("li");
  item.className = "rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900/60";
  item.style.marginLeft = depth ? `${depth * 12}px` : "0";
  item.textContent = `${field.label || field.key} (${field.type})`;
  if (Array.isArray(field.children) && field.children.length) {
    field.children.forEach((child) => {
      outlineInsert(item, child, depth + 1);
    });
  }
  return item;
}

function outlineInsert(parentItem, field, depth) {
  const list = parentItem.querySelector("ul") || (() => {
    const ul = document.createElement("ul");
    ul.className = "mt-2 space-y-2";
    parentItem.appendChild(ul);
    return ul;
  })();
  list.appendChild(renderFieldNode(field, depth));
}

ensureCanvasState();

manager; // keep reference for future enhancements

export { sortables };
