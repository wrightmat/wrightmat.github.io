// Persistent "what's currently shown to the table" icon strip — replaces
// the old one-at-a-time accept-prompt toast (widgets/spotlight-prompt.js,
// deleted) with a live status display: every currently-active spotlight
// gets its own icon, pinned bottom-right (same slot the toast used —
// see common/css/shell.css's own .spotlight-panel rule), independent of
// which widgets happen to be on this dashboard. A dashboard-level UI
// element, not a widget itself — no WIDGET_CATALOG entry, self-mounts here
// the same way the old toast self-mounted to document.body.
//
// Pure renderer — no polling, no state of its own beyond the one DOM node
// it owns. The caller (dashboard.js) is the one that knows what's active
// (spotlight-inbox.js's watchActiveSpotlights), what's on THIS viewer's own
// dashboard, and what counts as "new since last render" — this module just
// draws whatever it's told, every time it's told to. Same "everything
// caller-specific is a callback, this module just renders" split
// orrery/js/lib/map-viewer.js already establishes for its own shared
// rendering.
import { el } from "../dom.js";
import { refreshTooltips, disposeTooltips } from "../tooltips.js";

let panelEl = null;

function ensureMounted() {
  if (panelEl) return panelEl;
  panelEl = el("div", "spotlight-panel d-none");
  document.body.appendChild(panelEl);
  return panelEl;
}

// items: [{ key, kind, id, templateId, icon, title, isOnDashboard, isNew }]
// `onToggle({kind, id, templateId})` fires on the icon itself — the caller
// decides whether that means "accept" or "remove," this module doesn't
// care which. `onClear({kind,id})`, shown only while `editing` is true (a
// small "x" badge in the icon's own corner), force-clears the underlying
// spotlight directly — the escape hatch for a stale/orphaned entry (e.g.
// left behind by a widget type whose own cleanup has a gap, or one this
// dashboard's normal add/remove machinery can't resolve to any live widget
// at all) that the ordinary toggle can't clean up on its own.
export function renderSpotlightPanel(items, { onToggle, onClear, editing = false } = {}) {
  const panel = ensureMounted();
  disposeTooltips(panel);
  panel.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  panel.classList.toggle("d-none", list.length === 0);
  if (!list.length) return;
  list.forEach((item) => {
    const wrap = el("div", "spotlight-panel-item");

    const button = el("button", "spotlight-panel-icon");
    button.type = "button";
    button.classList.add(item.isOnDashboard ? "spotlight-panel-icon--mine" : "spotlight-panel-icon--available");
    button.dataset.bsToggle = "tooltip";
    button.dataset.bsPlacement = "top";
    button.dataset.bsTitle = item.isOnDashboard
      ? `${item.title} — on your dashboard (tap to remove)`
      : `${item.title} — shown to the table (tap to add)`;
    const icon = el("span", "iconify");
    icon.dataset.icon = item.icon || "tabler:sparkles";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    const srLabel = el("span", "visually-hidden", item.title);
    button.appendChild(srLabel);
    if (item.isNew) {
      button.classList.add("is-new");
      // Self-cleans once the flourish keyframe finishes — same
      // append-then-animationend-cleanup shape orrery/js/lib/map-viewer.js's
      // own createPingMarker already uses, just clearing a class here
      // instead of removing the (persistent, not transient) element itself.
      button.addEventListener(
        "animationend",
        () => button.classList.remove("is-new"),
        { once: true }
      );
    }
    button.addEventListener("click", () => onToggle?.({ kind: item.kind, id: item.id, templateId: item.templateId }));
    wrap.appendChild(button);

    if (editing) {
      const clearButton = el("button", "spotlight-panel-clear");
      clearButton.type = "button";
      clearButton.dataset.bsToggle = "tooltip";
      clearButton.dataset.bsPlacement = "top";
      clearButton.dataset.bsTitle = "Clear this — removes it from everyone's table, not just yours";
      const clearIcon = el("span", "iconify");
      clearIcon.dataset.icon = "tabler:circle-x-filled";
      clearIcon.setAttribute("aria-hidden", "true");
      clearButton.appendChild(clearIcon);
      // stopPropagation — this sits directly on top of the icon button
      // above; without it, a click here would also fire the toggle click
      // underneath.
      clearButton.addEventListener("click", (event) => {
        event.stopPropagation();
        onClear?.({ kind: item.kind, id: item.id });
      });
      wrap.appendChild(clearButton);
    }

    panel.appendChild(wrap);
  });
  refreshTooltips(panel);
}
