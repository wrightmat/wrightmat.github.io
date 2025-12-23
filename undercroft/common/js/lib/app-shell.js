import { initThemeControls } from "./theme.js";
import { initPaneToggles } from "./panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";
import { refreshTooltips } from "./tooltips.js";

const TOOL_DEFINITIONS = [
  { id: "workbench", label: "Workbench home", letter: "W", summary: "Launchpad for Undercroft tools and recent work." },
  { id: "system", label: "System Editor", letter: "S", summary: "Define rules, fields, and validations for systems." },
  { id: "template", label: "Template Builder", letter: "T", summary: "Design layout templates for character sheets." },
  { id: "character", label: "Character Sheet", letter: "C", summary: "Play and track characters with live sheets." },
  { id: "admin", label: "Admin Console", letter: "A", summary: "Manage users, permissions, and shared content." },
  { id: "orrery", label: "Orrery", letter: "O", summary: "Build and manage map layers and markers." },
  { id: "press", label: "Press", letter: "P", summary: "Assemble printable layouts and export PDFs." },
];

function resolveToolContextPath() {
  if (typeof window === "undefined") {
    return "workbench";
  }
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "workbench";
  }
  return segments[segments.length - 2];
}

function resolveToolHref(toolId, currentSection) {
  const workbenchPages = {
    workbench: "index.html",
    system: "system.html",
    template: "template.html",
    character: "character.html",
    admin: "admin.html",
  };

  if (workbenchPages[toolId]) {
    const prefix = currentSection === "workbench" ? "" : "../workbench/";
    return `${prefix}${workbenchPages[toolId]}`;
  }

  if (toolId === "orrery") {
    return currentSection === "orrery" ? "index.html" : "../orrery/index.html";
  }

  if (toolId === "press") {
    return currentSection === "press" ? "index.html" : "../press/index.html";
  }

  return "#";
}

function initToolNavigation(root = document) {
  const toolNavs = Array.from(root.querySelectorAll("[data-undercroft-tool-nav]"));
  if (!toolNavs.length) {
    return;
  }
  const [primaryNav, ...extraNavs] = toolNavs;
  extraNavs.forEach((nav) => nav.remove());
  const activeTool = root.body?.dataset?.undercroftTool;
  if (!activeTool) {
    return;
  }
  const currentSection = resolveToolContextPath();
  const orderedTools = TOOL_DEFINITIONS.filter((tool) => tool.id !== activeTool);
  const activeDefinition = TOOL_DEFINITIONS.find((tool) => tool.id === activeTool);
  if (activeDefinition) {
    orderedTools.unshift(activeDefinition);
  }

  primaryNav.innerHTML = "";
  orderedTools.forEach((tool, index) => {
    const isActive = tool.id === activeTool && index === 0;
    const element = isActive ? document.createElement("span") : document.createElement("a");
    element.className = `undercroft-tool-button tool-${tool.id}${isActive ? " is-active" : ""}`;
    if (isActive) {
      element.setAttribute("aria-current", "page");
    } else {
      element.setAttribute("href", resolveToolHref(tool.id, currentSection));
    }
    element.setAttribute("aria-label", tool.label);
    element.dataset.bsToggle = "tooltip";
    element.dataset.bsPlacement = "bottom";
    element.dataset.bsTitle = `${tool.label} — ${tool.summary}`;
    const letter = document.createElement("span");
    letter.className = "undercroft-tool-letter";
    letter.textContent = tool.letter;
    element.appendChild(letter);
    primaryNav.appendChild(element);
  });
  refreshTooltips(root);
}

const TOOL_DEFINITIONS = [
  { id: "workbench", label: "Workbench home", letter: "W" },
  { id: "system", label: "System Editor", letter: "S" },
  { id: "template", label: "Template Builder", letter: "T" },
  { id: "character", label: "Character Sheet", letter: "C" },
  { id: "admin", label: "Admin Console", letter: "A" },
  { id: "orrery", label: "Orrery", letter: "O" },
  { id: "press", label: "Press", letter: "P" },
];

function resolveToolContextPath() {
  if (typeof window === "undefined") {
    return "workbench";
  }
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "workbench";
  }
  return segments[segments.length - 2];
}

function resolveToolHref(toolId, currentSection) {
  const workbenchPages = {
    workbench: "index.html",
    system: "system.html",
    template: "template.html",
    character: "character.html",
    admin: "admin.html",
  };

  if (workbenchPages[toolId]) {
    const prefix = currentSection === "workbench" ? "" : "../workbench/";
    return `${prefix}${workbenchPages[toolId]}`;
  }

  if (toolId === "orrery") {
    return currentSection === "orrery" ? "index.html" : "../orrery/index.html";
  }

  if (toolId === "press") {
    return currentSection === "press" ? "index.html" : "../press/index.html";
  }

  return "#";
}

function initToolNavigation(root = document) {
  const toolNavs = Array.from(root.querySelectorAll("[data-undercroft-tool-nav]"));
  if (!toolNavs.length) {
    return;
  }
  const [primaryNav, ...extraNavs] = toolNavs;
  extraNavs.forEach((nav) => nav.remove());
  const activeTool = root.body?.dataset?.undercroftTool;
  if (!activeTool) {
    return;
  }
  const currentSection = resolveToolContextPath();
  const orderedTools = TOOL_DEFINITIONS.filter((tool) => tool.id !== activeTool);
  const activeDefinition = TOOL_DEFINITIONS.find((tool) => tool.id === activeTool);
  if (activeDefinition) {
    orderedTools.unshift(activeDefinition);
  }

  primaryNav.innerHTML = "";
  orderedTools.forEach((tool, index) => {
    const isActive = tool.id === activeTool && index === 0;
    const element = isActive ? document.createElement("span") : document.createElement("a");
    element.className = `undercroft-tool-button tool-${tool.id}${isActive ? " is-active" : ""}`;
    if (isActive) {
      element.setAttribute("aria-current", "page");
    } else {
      element.setAttribute("href", resolveToolHref(tool.id, currentSection));
    }
    element.setAttribute("aria-label", tool.label);
    const letter = document.createElement("span");
    letter.className = "undercroft-tool-letter";
    letter.textContent = tool.letter;
    element.appendChild(letter);
    primaryNav.appendChild(element);
  });
}

function showFeedback(status, feedback, fallbackMessage) {
  if (!status || typeof status.show !== "function") {
    return;
  }
  if (!feedback) {
    if (fallbackMessage) {
      status.show(fallbackMessage, { type: "info", timeout: 1500 });
    }
    return;
  }
  if (typeof feedback === "string") {
    status.show(feedback, { timeout: 1500 });
    return;
  }
  if (typeof feedback === "object") {
    const { message, options } = feedback;
    if (message) {
      status.show(message, options);
    }
  }
}

export function initAppShell({
  root = document,
  namespace = "default",
  storagePrefix = "undercroft.workbench.undo",
  onUndo = null,
  onRedo = null,
  undoLimit,
} = {}) {
  const statusRoot = root.querySelector("[data-status-root]") || document.createElement("div");
  const status = new StatusManager(statusRoot);
  if (!statusRoot.parentElement) {
    document.body.appendChild(statusRoot);
  }

  initThemeControls(root);
  initPaneToggles(root);
  initToolNavigation(root);

  const undoStack = new UndoRedoStack({
    storageKey: `${storagePrefix}.${namespace}`,
    limit: typeof undoLimit === "number" ? undoLimit : undefined,
  });
  const keyboard = new KeyboardShortcuts();
  function performUndo({ silent = false } = {}) {
    const entry = undoStack.undoStep();
    if (!entry) {
      if (!silent) {
        status.show("Nothing to undo", { type: "info", timeout: 1200 });
      }
      return null;
    }
    const feedback = typeof onUndo === "function" ? onUndo(entry) : null;
    const applied = !(
      feedback &&
      typeof feedback === "object" &&
      Object.prototype.hasOwnProperty.call(feedback, "applied") &&
      feedback.applied === false
    );
    if (!applied) {
      undoStack.requeueUndo(entry);
    }
    if (!silent) {
      showFeedback(status, feedback, applied ? "Undid last action" : null);
    }
    return applied ? entry : null;
  }

  function performRedo({ silent = false } = {}) {
    const entry = undoStack.redoStep();
    if (!entry) {
      if (!silent) {
        status.show("Nothing to redo", { type: "info", timeout: 1200 });
      }
      return null;
    }
    const feedback = typeof onRedo === "function" ? onRedo(entry) : null;
    const applied = !(
      feedback &&
      typeof feedback === "object" &&
      Object.prototype.hasOwnProperty.call(feedback, "applied") &&
      feedback.applied === false
    );
    if (!applied) {
      undoStack.requeueRedo(entry);
    }
    if (!silent) {
      showFeedback(status, feedback, applied ? "Redid last action" : null);
    }
    return applied ? entry : null;
  }

  keyboard.register("ctrl+z", (event) => {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    performUndo();
  });
  keyboard.register(["ctrl", "shift", "z"], (event) => {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    performRedo();
  });

  return { status, undoStack, keyboard, undo: performUndo, redo: performRedo };
}
