// Hides/shows an arbitrary element regardless of Bootstrap display
// utilities (.d-flex, .d-grid, ...), which are ALL generated with
// !important — `element.hidden` and a plain `style.display = "none"` are
// both silently no-ops against one of those classes. An inline style set
// WITH !important is the one thing that reliably beats it.
import { updateTooltipContent } from "./tooltips.js";

export function setElementCollapsed(element, isCollapsed) {
  if (!element) return;
  if (isCollapsed) {
    element.style.setProperty("display", "none", "important");
  } else {
    element.style.removeProperty("display");
  }
  // Kept for semantics/assistive tech even though it has no visual effect
  // of its own here.
  element.hidden = isCollapsed;
}

// The toggle's chevron is a single, static "tabler:chevron-right" icon —
// the down/right pivot is done entirely by shell.css's
// ".collapsible-toggle[aria-expanded] .iconify" rotate rule, driven off
// the aria-expanded attribute set below. Never also swap data-icon here —
// that doubled up with the CSS rotate (a rotated chevron-down points
// sideways, not down).
export function setCollapsibleState(toggle, panel, { collapsed, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return;
  const label = labelElement || toggle.querySelector("[data-toggle-label]");
  const isCollapsed = Boolean(collapsed);
  panel.hidden = isCollapsed;
  panel.classList.toggle("d-none", isCollapsed);
  panel.setAttribute("aria-hidden", isCollapsed ? "true" : "false");
  // !important, same reasoning as setElementCollapsed above — a panel
  // carrying a Bootstrap display utility never hides with a plain
  // `style.display = "none"`.
  if (isCollapsed) {
    panel.style.setProperty("display", "none", "important");
  } else {
    panel.style.removeProperty("display");
  }
  toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  toggle.dataset.collapsed = isCollapsed ? "true" : "false";
  if (label) {
    label.textContent = isCollapsed ? expandLabel : collapseLabel;
  }
}

export function bindCollapsibleToggle(toggle, panel, { collapsed = false, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return () => {};
  const apply = (next) => setCollapsibleState(toggle, panel, { collapsed: next, expandLabel, collapseLabel, labelElement });
  apply(collapsed);
  toggle.addEventListener("click", () => apply(!panel.hidden));
  return apply;
}

// A self-contained collapse/expand chevron button that manages its own
// icon/aria state and calls back on toggle, rather than assuming a
// pre-built toggle+panel pair the way bindCollapsibleToggle above does —
// useful when the caller builds its own panel show/hide logic (e.g. a
// section that also needs to recompute contents).
export function createCollapseToggleButton({ label = "section", collapsed = false, onToggle } = {}) {
  let isCollapsed = Boolean(collapsed);
  const button = document.createElement("button");
  button.type = "button";
  // "collapsible-toggle" (not just "canvas-collapse-toggle") shares the
  // same rotate CSS as every other collapse button in the suite.
  button.classList.add(
    "canvas-collapse-toggle",
    "collapsible-toggle",
    "d-inline-flex",
    "align-items-center",
    "justify-content-center"
  );

  const icon = document.createElement("span");
  icon.className = "iconify";
  icon.dataset.icon = "tabler:chevron-right";
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);

  function update(nextState) {
    isCollapsed = Boolean(nextState);
    const expandedLabel = label ? ` ${label}` : "";
    const actionLabel = isCollapsed ? `Expand${expandedLabel}` : `Collapse${expandedLabel}`;
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.setAttribute("aria-label", actionLabel);
    updateTooltipContent(button, actionLabel);
  }

  update(isCollapsed);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !isCollapsed;
    update(next);
    if (typeof onToggle === "function") {
      onToggle(next);
    }
  });

  return {
    button,
    setCollapsed: update,
  };
}
