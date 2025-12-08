import { initThemeControls } from "../../../common/js/lib/theme.js";
import { initPaneToggles } from "../../../common/js/lib/panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";

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

  const undoStack = new UndoRedoStack({
    storageKey: `undercroft.workbench.undo.${namespace}`,
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
