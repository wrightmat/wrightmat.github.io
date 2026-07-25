// Thin wrapper around app-shell.js's renderToolGrid, the same tool-card
// rendering the header dropdown uses — front-and-center on the Dashboard
// instead of hidden behind a dropdown, so a fresh install with no
// customization yet is still immediately useful.
import { renderToolGrid, resolveToolContextPath } from "../app-shell.js";

export function initToolGridWidget(container) {
  renderToolGrid(container, { currentSection: resolveToolContextPath() });
  return {
    destroy() {
      container.innerHTML = "";
    },
  };
}
