export function setCollapsibleState(toggle, panel, { collapsed, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return;
  const icon = toggle.querySelector(".iconify");
  const label = labelElement || toggle.querySelector("[data-toggle-label]");
  const isCollapsed = Boolean(collapsed);
  panel.hidden = isCollapsed;
  toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  if (label) {
    label.textContent = isCollapsed ? expandLabel : collapseLabel;
  }
  if (icon) {
    icon.dataset.icon = isCollapsed ? "tabler:chevron-right" : "tabler:chevron-down";
  }
}

export function bindCollapsibleToggle(toggle, panel, { collapsed = false, expandLabel, collapseLabel, labelElement } = {}) {
  if (!toggle || !panel) return () => {};
  const apply = (next) => setCollapsibleState(toggle, panel, { collapsed: next, expandLabel, collapseLabel, labelElement });
  apply(collapsed);
  toggle.addEventListener("click", () => apply(!panel.hidden));
  return apply;
}
