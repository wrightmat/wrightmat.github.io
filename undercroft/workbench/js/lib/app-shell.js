import { initThemeControls } from "./theme.js";
import { initPaneToggles } from "./panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";

export function initAppShell({ root = document, namespace = "default" } = {}) {
  const statusRoot = root.querySelector("[data-status-root]") || document.createElement("div");
  const status = new StatusManager(statusRoot);
  if (!statusRoot.parentElement) {
    document.body.appendChild(statusRoot);
  }

  initThemeControls(root);
  initPaneToggles(root);

  const undoStack = new UndoRedoStack({ storageKey: `undercroft.workbench.undo.${namespace}` });
  const keyboard = new KeyboardShortcuts();
  keyboard.register("ctrl+z", () => {
    const entry = undoStack.undoStep();
    if (entry) {
      status.show("Undid last action", { type: "info", timeout: 1500 });
    }
  });
  keyboard.register(["ctrl", "shift", "z"], () => {
    const entry = undoStack.redoStep();
    if (entry) {
      status.show("Redid action", { type: "info", timeout: 1500 });
    }
  });

  return { status, undoStack, keyboard };
}
