// "What's currently shown to the table" icon strip — the Dashboard mounts
// one floating instance (bottom-right, self-appended to document.body,
// interactive: tap an icon to add/remove it from your own dashboard), and
// Workbench's own "Now Showing" collapsible section mounts a second,
// independent, non-floating, read-only instance inline in its own layout
// (see workbench-character-view.js) — same renderer, same visual language,
// two different hosts. Originally a bare module-level singleton hardcoded to
// float on document.body; generalized into this factory specifically so
// Workbench could reuse the real rendering code instead of a second,
// independently-drifting copy (per this suite's own top-priority parity
// rule) — every instance still shares the exact same item shape, CSS
// classes, and flourish animation.
//
// Pure renderer — no polling, no state of its own beyond the one DOM node
// each instance owns. The caller (dashboard.js, workbench-character-view.js)
// is the one that knows what's active (spotlight-inbox.js's own
// watchActiveSpotlights), what's on THIS viewer's own dashboard (dashboard.js
// only — Workbench has no such concept, see `interactive` below), and what
// counts as "new since last render" — this module just draws whatever it's
// told, every time it's told to. Same "everything caller-specific is a
// callback, this module just renders" split orrery/js/lib/map-viewer.js
// already establishes for its own shared rendering.
import { el } from "../dom.js";
import { refreshTooltips, disposeTooltips } from "../tooltips.js";

// `container` is required when `floating` is false — the panel mounts
// itself there instead of document.body, and is laid out by the caller's own
// surrounding markup (Workbench wraps it in a centered flex row) rather than
// a fixed corner overlay.
export function createSpotlightPanel({ container = null, floating = true } = {}) {
  const panelEl = el("div", `spotlight-panel${floating ? "" : " spotlight-panel--inline"} d-none`);
  if (floating) {
    document.body.appendChild(panelEl);
  } else {
    container?.appendChild(panelEl);
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
  // `interactive` (default true) — false renders every icon disabled, with
  // no click handler and no mine/available distinction (a single neutral
  // "currently shown" style) — for a read-only host with no per-viewer
  // "dashboard" of its own to toggle membership in (Workbench's Now
  // Showing), where a clickable-looking icon that does nothing would read as
  // broken, not informational. `editing` is meaningless when `interactive`
  // is false and is ignored in that case.
  function render(items, { onToggle, onClear, editing = false, interactive = true } = {}) {
    disposeTooltips(panelEl);
    panelEl.innerHTML = "";
    const list = Array.isArray(items) ? items : [];
    panelEl.classList.toggle("d-none", list.length === 0);
    if (!list.length) return;
    list.forEach((item) => {
      const wrap = el("div", "spotlight-panel-item");

      const button = el("button", "spotlight-panel-icon");
      button.type = "button";
      if (interactive) {
        button.classList.add(item.isOnDashboard ? "spotlight-panel-icon--mine" : "spotlight-panel-icon--available");
        button.dataset.bsToggle = "tooltip";
        button.dataset.bsPlacement = "top";
        button.dataset.bsTitle = item.isOnDashboard
          ? `${item.title} — on your dashboard (tap to remove)`
          : `${item.title} — shown to the table (tap to add)`;
        button.addEventListener("click", () => onToggle?.({ kind: item.kind, id: item.id, templateId: item.templateId }));
      } else {
        button.classList.add("spotlight-panel-icon--shown");
        button.disabled = true;
        button.dataset.bsToggle = "tooltip";
        button.dataset.bsPlacement = "top";
        button.dataset.bsTitle = `${item.title} — shown to the table`;
      }
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
      wrap.appendChild(button);

      if (interactive && editing) {
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

      panelEl.appendChild(wrap);
    });
    refreshTooltips(panelEl);
  }

  function destroy() {
    disposeTooltips(panelEl);
    panelEl.remove();
  }

  return { render, destroy };
}
