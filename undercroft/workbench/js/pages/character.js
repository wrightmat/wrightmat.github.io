import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { renderLayout } from "../lib/renderer.js";
import { DataManager } from "../lib/data-manager.js";

const { status, undoStack } = initAppShell({ namespace: "character" });
const manager = new DataManager();

const TEMPLATE_PATHS = {
  "tpl.5e.flex-basic": "data/templates/tpl.5e.flex-basic.json",
};

const CHARACTER_DEFINITIONS = [
  {
    id: "cha_01k26cm0jxDR5V4R1Q4N56B5RH",
    title: "Elandra (Demo)",
    path: "data/characters/cha_01k26cm0jxDR5V4R1Q4N56B5RH.json",
    template: "tpl.5e.flex-basic",
  },
];

const templateCache = new Map();
const characterCache = new Map();
let activeCharacter = null;
let workingCopy = null;

async function fetchTemplate(id) {
  if (templateCache.has(id)) {
    return templateCache.get(id);
  }
  const path = TEMPLATE_PATHS[id];
  if (!path) {
    throw new Error(`Template not registered: ${id}`);
  }
  const response = await fetch(path);
  const template = await response.json();
  templateCache.set(id, template);
  return template;
}

async function fetchCharacter(id) {
  const local = manager.getLocal("characters", id);
  if (local) {
    return JSON.parse(JSON.stringify(local));
  }
  if (characterCache.has(id)) {
    return JSON.parse(JSON.stringify(characterCache.get(id)));
  }
  const def = CHARACTER_DEFINITIONS.find((entry) => entry.id === id);
  if (!def) {
    throw new Error(`Character not registered: ${id}`);
  }
  const response = await fetch(def.path);
  const data = await response.json();
  characterCache.set(id, data);
  return JSON.parse(JSON.stringify(data));
}

const select = document.querySelector("[data-character-select]");
if (select) {
  populateSelect(
    select,
    CHARACTER_DEFINITIONS.map((entry) => ({ value: entry.id, label: entry.title })),
    { placeholder: "Select character" }
  );
  select.addEventListener("change", async () => {
    await loadCharacter(select.value);
  });
}

const list = document.querySelector("[data-character-list]");
if (list) {
  list.innerHTML = "";
  CHARACTER_DEFINITIONS.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm shadow-sm transition hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900/60";
    item.textContent = entry.title;
    item.dataset.characterId = entry.id;
    item.tabIndex = 0;
    item.addEventListener("click", () => {
      if (select) {
        select.value = entry.id;
      }
      loadCharacter(entry.id);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (select) select.value = entry.id;
        loadCharacter(entry.id);
      }
    });
    list.appendChild(item);
  });
}

async function loadCharacter(id) {
  if (!id) return;
  try {
    activeCharacter = await fetchCharacter(id);
    workingCopy = JSON.parse(JSON.stringify(activeCharacter));
    const template = await fetchTemplate(workingCopy.template);
    renderSheet(template, workingCopy);
    status.show(`Loaded ${workingCopy.data?.name || workingCopy.id}`, { type: "success", timeout: 2000 });
  } catch (error) {
    console.error("Failed to load character", error);
    status.show("Unable to load character", { type: "error", timeout: 2500 });
  }
}

function renderSheet(template, character) {
  const root = document.querySelector("[data-sheet-root]");
  if (!root) return;
  renderLayout(root, template.layout, character.data || {});
  attachFieldListeners(root);
}

function attachFieldListeners(root) {
  root.querySelectorAll("[data-bind]").forEach((element) => {
    element.addEventListener("input", handleFieldChange);
    element.addEventListener("change", handleFieldChange);
  });
}

function handleFieldChange(event) {
  if (!workingCopy) return;
  const target = event.currentTarget;
  const bind = target.dataset.bind;
  if (!bind) return;
  const path = bind.slice(1).split(".");
  const value = extractValue(target);
  setByPath(workingCopy.data, path, value);
  undoStack.push({ type: "update", bind, value });
  status.show("Updated field", { timeout: 1200 });
}

function extractValue(element) {
  if (element.type === "number") {
    const parsed = Number(element.value);
    return Number.isNaN(parsed) ? element.value : parsed;
  }
  if (element.type === "checkbox") {
    return element.checked;
  }
  return element.value;
}

function setByPath(target, path, value) {
  let cursor = target;
  path.slice(0, -1).forEach((segment) => {
    if (cursor[segment] === undefined || cursor[segment] === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  });
  cursor[path[path.length - 1]] = value;
}

const saveButton = document.querySelector('[data-action="save-character"]');
if (saveButton) {
  saveButton.addEventListener("click", () => {
    if (!workingCopy) {
      status.show("Select a character first", { type: "info", timeout: 2000 });
      return;
    }
    manager.saveLocal("characters", workingCopy.id, workingCopy);
    status.show("Character saved locally", { type: "success", timeout: 2000 });
  });
}

const resetButton = document.querySelector('[data-action="reset-character"]');
if (resetButton) {
  resetButton.addEventListener("click", () => {
    if (!activeCharacter) return;
    workingCopy = JSON.parse(JSON.stringify(activeCharacter));
    fetchTemplate(workingCopy.template).then((template) => renderSheet(template, workingCopy));
    status.show("Reverted unsaved changes", { timeout: 2000 });
  });
}

const exportButton = document.querySelector('[data-action="export-character"]');
if (exportButton) {
  exportButton.addEventListener("click", () => {
    if (!workingCopy) return;
    const dataStr = JSON.stringify(workingCopy, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workingCopy.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    status.show("Downloaded character JSON", { timeout: 2000 });
  });
}

const newButton = document.querySelector('[data-action="new-character"]');
if (newButton) {
  newButton.addEventListener("click", () => {
    status.show("Character creation coming soon", { timeout: 2000 });
  });
}

const noteButton = document.querySelector('[data-action="append-note"]');
if (noteButton) {
  noteButton.addEventListener("click", () => {
    const textarea = document.querySelector("[data-session-note]");
    const log = document.querySelector("[data-session-log]");
    if (!textarea || !log) return;
    const value = textarea.value.trim();
    if (!value) {
      status.show("Add note text first", { timeout: 1500 });
      return;
    }
    const entry = document.createElement("p");
    entry.className = "rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900/70";
    entry.textContent = value;
    log.appendChild(entry);
    textarea.value = "";
    undoStack.push({ type: "note", value });
    status.show("Added note", { timeout: 1500 });
  });
}

export async function bootstrapDemo() {
  if (CHARACTER_DEFINITIONS.length) {
    await loadCharacter(CHARACTER_DEFINITIONS[0].id);
  }
}

bootstrapDemo();
