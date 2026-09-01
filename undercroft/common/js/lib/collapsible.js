// Hides/shows an arbitrary element regardless of what CSS classes it
// carries — critically, regardless of Bootstrap 5 display utilities
// (.d-flex, .d-grid, ...), which are ALL generated with !important.
// `element.hidden = true` (the native [hidden] { display: none } UA rule,
// which carries no !important) and a plain `element.style.display = "none"`
// (no !important either) are BOTH silently no-ops on any element that also
// carries one of those utility classes — the !important rule always wins
// regardless of the hidden attribute or a same-priority inline style. An
// inline style set WITH !important is the one thing that reliably beats a
// class's own !important rule (inline beats a class selector at equal
// importance), so that's what this uses instead — no need to know or
// enumerate the element's own classes.
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

// The toggle's chevron is a single, static "tabler:chevron-right" icon
// (set once, in markup or at creation) — the down/right pivot is done
// entirely by common/css/shell.css's ".collapsible-toggle[aria-expanded]
// .iconify" rotate rule, driven off the aria-expanded attribute this
// function sets below. Deliberately NOT also swapping the icon's own
// data-icon between chevron-right/chevron-down here: that used to run
// alongside the CSS rotate, which doubled up (a chevron-down rotated
// another 90° reads as pointing sideways, not down) — one mechanism, not
// two. See createCollapseToggleButton's own version of this same note.
export function setCollapsibleState(toggle, panel, { collapsed, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return;
  const label = labelElement || toggle.querySelector("[data-toggle-label]");
  const isCollapsed = Boolean(collapsed);
  panel.hidden = isCollapsed;
  panel.classList.toggle("d-none", isCollapsed);
  panel.setAttribute("aria-hidden", isCollapsed ? "true" : "false");
  // !important, same reasoning as setElementCollapsed above — a panel that
  // also carries a Bootstrap display utility (.d-flex, .d-grid, ...), which
  // several real collapsible panels in this suite do, silently never hides
  // with a plain `panel.style.display = "none"` (confirmed real: Orrery's
  // own Map Properties panel, `class="d-flex flex-column gap-3"`, toggled
  // through this exact function).
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
// useful when the caller wants to build the panel's own show/hide logic
// itself (e.g. a section that also needs to recompute its contents).
// Canonical shared home for what used to be duplicated in
// workbench/js/lib/canvas-card.js (which now re-exports this).
export function createCollapseToggleButton({ label = "section", collapsed = false, onToggle } = {}) {
  let isCollapsed = Boolean(collapsed);
  const button = document.createElement("button");
  button.type = "button";
  // "collapsible-toggle" (not just "canvas-collapse-toggle") so this
  // shares the exact same down/right rotate CSS as every other collapse
  // button in the suite (common/css/shell.css) — see setCollapsibleState's
  // own note on why the icon itself is never swapped, just rotated.
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
