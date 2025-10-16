const DEFAULT_COLLAPSED_CLASS = "hidden";
const DEFAULT_EXPANDED_CLASS = "flex";

function getPaneConfig(pane) {
  const collapsed = pane.getAttribute("data-pane-collapsed-class") || DEFAULT_COLLAPSED_CLASS;
  const expanded = pane.getAttribute("data-pane-expanded-class") || DEFAULT_EXPANDED_CLASS;
  const initial = pane.getAttribute("data-pane-initial") || "collapsed";
  return { collapsed, expanded, initial };
}

function setPaneState(pane, config, state) {
  const isExpanded = state === "expanded";
  pane.dataset.state = state;
  pane.classList.toggle(config.collapsed, !isExpanded);
  pane.classList.toggle(config.expanded, isExpanded);
}

function togglePane(pane, config) {
  const current = pane.dataset.state || config.initial;
  const next = current === "expanded" ? "collapsed" : "expanded";
  setPaneState(pane, config, next);
  return next;
}

export function initPaneToggles(root = document, { onChange } = {}) {
  const panes = new Map();
  root.querySelectorAll("[data-pane]").forEach((pane) => {
    const config = getPaneConfig(pane);
    panes.set(pane.getAttribute("data-pane"), { pane, config });
    setPaneState(pane, config, config.initial);
  });

  root.querySelectorAll("[data-pane-toggle]").forEach((button) => {
    const key = button.getAttribute("data-pane-toggle");
    const target = panes.get(key);
    if (!target) {
      return;
    }
    const isExpanded = target.pane.dataset.state === "expanded";
    button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    button.dataset.active = isExpanded ? "true" : "false";
    button.addEventListener("click", () => {
      const state = togglePane(target.pane, target.config);
      const expanded = state === "expanded";
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.dataset.active = expanded ? "true" : "false";
      if (typeof onChange === "function") {
        onChange({ key, state });
      }
    });
  });
}
