// A locked-down, sidebar-free viewer for a saved Map — the "player/table"
// half of Orrery's own pan/zoom/layer-rendering surface. Reuses
// BaseMapManager (orrery/js/lib/base-maps.js) for the actual base map +
// pan/zoom, and orrery/js/lib/map-viewer.js's renderMapLayers — the exact
// same top-level render loop Orrery's own app.js now also calls — so every
// layer type (grid, raster, vector, marker) a map has renders identically
// here, not just markers. Nothing in this file is a parallel reimplementation
// of Orrery's own rendering.
//
// This widget passes no `selection`/`activeGroup`/interactive callbacks to
// renderMapLayers, which is the whole opt-out mechanism — Orrery-only
// concerns (grid-cell click-selection, "click empty space to place a new
// marker," whole-layer drag, undo-stack recording) simply never run when
// those options are absent. The one interactive affordance this widget does
// supply is `isMarkerDraggable`, restricted to the viewer's own claimed
// character's marker, per the confirmed permission model.
import { BaseMapManager } from "../../../../orrery/js/lib/base-maps.js";
import { renderMapLayers, createPingMarker } from "../../../../orrery/js/lib/map-viewer.js";
import { resolveToolHref, resolveToolContextPath } from "../app-shell.js";
import { resolveIsSpotlighted } from "../spotlight.js";
import { el } from "../dom.js";
import { watchMapForChanges, persistMarkerMove as persistMarkerMoveShared } from "../map-live-sync.js";

// 10s (was 30s) — same reasoning as combat-tracker.js's own
// POLL_INTERVAL_MS, kept a bit more conservative here since a map's own
// content (layers/markers) typically changes less often mid-session than
// combat or a clock does.
const POLL_INTERVAL_MS = 10000;

export function initMapWidget(
  container,
  {
    dataManager,
    status,
    contentRef,
    groupId = "",
    shareToken = "",
    viewerTier = "free",
    pinnedCharacterId = "",
    onTitleChange,
    setHeaderAction,
    setRightAction,
    canToggleVisibility = false,
    editing = false,
  } = {}
) {
  const mapId = contentRef?.id;
  if (!container || !dataManager || !mapId) {
    return { destroy() {} };
  }

  // mapId/shareToken are fixed for this widget instance's whole lifetime (a
  // new map means a new instance, not a change to this one — see Card's own
  // comment on contentRef), so unlike the map's own name (only known once
  // `load()` fetches it, see onTitleChange below) this can be set once, right
  // away, rather than re-derived on every poll.
  const orreryParams = new URLSearchParams({ map: mapId });
  if (shareToken) orreryParams.set("share", shareToken);
  setHeaderAction?.({
    icon: "tabler:external-link",
    tooltip: "Open in Orrery",
    href: `${resolveToolHref("orrery", resolveToolContextPath())}?${orreryParams.toString()}`,
  });

  let destroyed = false;
  let map = null;
  let baseMapSignature = "";
  let baseMapManager = null;
  let zoomPanel = null;
  let watcher = null;
  let visible = false;

  // Same direct spotlightToGroup/clearSpotlight toggle Handout's own
  // visibility button uses — no modal, just an eye icon. `LINK_ONLY_KINDS`
  // already covers "map" (spotlight.js) since a map is a link back into
  // Orrery, not a rendered card, but the visibility CONCEPT — "is this
  // currently the thing shown to the table" — is identical either way.
  function updateVisibilityAction() {
    if (!canToggleVisibility) return;
    setRightAction?.({
      icon: visible ? "tabler:eye" : "tabler:eye-off",
      tooltip: visible ? "Showing to table — click to hide" : "Hidden from table — click to show",
      active: visible,
      onClick: () => void toggleVisibility(),
    });
  }

  async function refreshVisibility() {
    if (!canToggleVisibility || !groupId) {
      visible = false;
      return;
    }
    // Per-instance, not just per-kind — a second Map must stay
    // independently toggleable, see resolveIsSpotlighted's own comment.
    visible = await resolveIsSpotlighted(dataManager, { groupId, shareToken, kind: "map", id: mapId });
    updateVisibilityAction();
  }

  async function toggleVisibility() {
    if (!groupId) {
      status?.show("No active campaign to show this to.", { type: "warning", timeout: 2500 });
      return;
    }
    try {
      if (visible) {
        await dataManager.clearSpotlight({ groupId, kind: "map", id: mapId });
        status?.show("Stopped showing to the table.", { type: "success", timeout: 2000 });
      } else {
        await dataManager.spotlightToGroup({ groupId, contentType: "map", contentId: mapId });
        status?.show("Showing to the table.", { type: "success", timeout: 2000 });
      }
    } catch (error) {
      status?.show(error.message || "Unable to update visibility.", { type: "error" });
    }
    await refreshVisibility();
  }

  void refreshVisibility();

  // Same zoom in/out/reset controls as Orrery's own floating panel
  // (orrery/index.html's data-zoom-in/-out/-reset, wired in orrery/js/app.js
  // to these exact BaseMapManager methods) — just the zoom cluster itself,
  // not Orrery's draggable/collapsible panel chrome, which has no room to
  // mean anything in an 18rem-tall widget. Hidden while the Dashboard is in
  // edit mode (data-map-zoom-panel — see dashboard.js's own
  // applyEditingState) so it doesn't clutter the layout-editing view.
  function buildZoomPanel() {
    // Reuses Orrery's own `.orrery-floating-panel` class (orrery/css/styles.css,
    // already loaded on this page) rather than a bare `.btn-group` — that
    // class is what actually gives Orrery's real zoom panel its opaque
    // background/border/padding, which a plain outline btn-group doesn't
    // have on its own (nothing but thin button borders, easy to lose against
    // map tiles). It also sets z-index: 1035, comfortably above Leaflet's own
    // panes (base-maps.js forces overlayPane to 650, and others climb from
    // there) — those are siblings in this same viewerHost stacking context,
    // so anything lower gets painted over regardless of DOM order.
    const panel = el("div", "orrery-floating-panel");
    panel.dataset.mapZoomPanel = "";
    // Tighter inset than Orrery's own 1.5rem default — this panel floats
    // over an 18rem-tall widget, not a full-page map.
    panel.style.top = "0.5rem";
    panel.style.right = "0.5rem";
    panel.style.padding = "0.375rem";
    panel.classList.toggle("d-none", editing);
    const buttonGroup = el("div", "btn-group btn-group-sm");
    buttonGroup.setAttribute("role", "group");
    buttonGroup.setAttribute("aria-label", "Map zoom controls");
    panel.appendChild(buttonGroup);
    const zoomOutButton = el("button", "btn btn-outline-secondary");
    zoomOutButton.type = "button";
    zoomOutButton.setAttribute("aria-label", "Zoom out");
    const zoomOutIcon = el("span", "iconify");
    zoomOutIcon.dataset.icon = "tabler:zoom-out";
    zoomOutIcon.setAttribute("aria-hidden", "true");
    zoomOutButton.appendChild(zoomOutIcon);
    zoomOutButton.addEventListener("click", () => baseMapManager?.zoomBy(-0.25));
    const zoomResetButton = el("button", "btn btn-outline-secondary", "Reset");
    zoomResetButton.type = "button";
    zoomResetButton.addEventListener("click", () => baseMapManager?.reset());
    const zoomInButton = el("button", "btn btn-outline-secondary");
    zoomInButton.type = "button";
    zoomInButton.setAttribute("aria-label", "Zoom in");
    const zoomInIcon = el("span", "iconify");
    zoomInIcon.dataset.icon = "tabler:zoom-in";
    zoomInIcon.setAttribute("aria-hidden", "true");
    zoomInButton.appendChild(zoomInIcon);
    zoomInButton.addEventListener("click", () => baseMapManager?.zoomBy(0.25));
    buttonGroup.append(zoomOutButton, zoomResetButton, zoomInButton);
    return panel;
  }

  // Deliberately NOT the `.orrery-map` class — that rule is
  // `position: fixed; inset: 0`, meant for Orrery's own full-page host
  // element, and would blow this widget out to cover the whole viewport.
  // BaseMapManager only needs a normal positioned container with real
  // dimensions; it builds its own `.orrery-map-stage`/`.orrery-map-content`
  // children inside whatever's passed in (orrery/css/styles.css, loaded on
  // this page too, styles those).
  const viewerHost = el("div");
  viewerHost.style.position = "relative";
  viewerHost.style.width = "100%";
  // Always fills the widget's own mount point (a flex column sized to this
  // grid cell's own colSpan/rowSpan-driven footprint) in both dimensions,
  // not just in forcePlayerView — every card gets a real, resizable grid
  // cell now (dashboard.js's renderWidgetGrid), GM view included, so there's
  // no longer a context where a fixed fallback height makes sense; a fixed
  // 18rem here previously meant resizing a Map widget's grid cell taller
  // never actually grew the visible map (confirmed directly). Tracks live on
  // resize via plain CSS (the ResizeObserver below is still needed
  // separately, for Leaflet's own internal canvas — see its own comment).
  viewerHost.style.flex = "1 1 0";
  viewerHost.style.minHeight = "0";
  viewerHost.style.borderRadius = "0.5rem";
  viewerHost.style.overflow = "hidden";
  // Leaflet caches its container's pixel size at mount and doesn't notice a
  // CSS-only size change on its own (a well-known Leaflet gotcha) — without
  // this, resizing the grid cell (via the width/height steppers, or the
  // Widget Inspector pane narrowing/widening this same column in normal use)
  // would leave the map canvas at its stale original size, cut off or with
  // dead space around it.
  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => baseMapManager?.getMap?.()?.invalidateSize?.())
      : null;
  resizeObserver?.observe(viewerHost);

  function renderError(message) {
    container.innerHTML = "";
    container.appendChild(el("p", "text-danger small mb-0", message));
  }

  // Only this viewer's own claimed character's marker is draggable —
  // everything else (NPCs, other players' characters) stays locked, per the
  // confirmed permission model for this widget.
  function isMarkerDraggable(layer, markerElement) {
    return Boolean(
      pinnedCharacterId && markerElement.refKind === "character" && markerElement.refId === pinnedCharacterId
    );
  }

  function renderLayers() {
    const overlay = baseMapManager?.getOverlayContainer();
    if (!overlay || !map) return;
    renderMapLayers(overlay, baseMapManager, map, {
      viewerTier,
      hasFullAccess: false,
      isMarkerDraggable,
      onMarkerDragEnd: (layer, markerElement, nextPosition) =>
        void persistMarkerMove(layer.id, markerElement.id, nextPosition),
    });
  }

  // Read-modify-write against a *fresh* fetch (preferLocal: false), not the
  // in-memory `map` this widget last loaded — the GM could have changed the
  // map (new marker, layer visibility, ...) in the moments since, and a
  // stale full-object save would silently clobber that. Same reasoning as
  // combat-tracker.js's writeThroughToCharacter. Delegates to
  // map-live-sync.js's shared helper — Orrery's own authoring surface uses
  // the exact same one for the same reason.
  async function persistMarkerMove(layerId, elementId, nextPosition) {
    try {
      const freshMap = await persistMarkerMoveShared({ dataManager, mapId, shareToken, layerId, elementId, nextPosition });
      if (!freshMap) return;
      map = freshMap;
      renderLayers();
    } catch (error) {
      status?.show(error.message || "Unable to save your marker's new position.", { type: "error" });
    }
  }

  // onMapChanged has two independent triggers (the poll timer and the live
  // stream) that can overlap — watchMapForChanges single-flights its own
  // underlying fetch, but this handler itself still isn't reentrant-safe
  // once inside the `!baseMapManager` branch: a second trigger arriving
  // mid-construction could build a SECOND BaseMapManager (a second Leaflet
  // map instance) on top of the first, whose own overlay would silently
  // keep rendering its own copy of every marker underneath/alongside the
  // one from whichever instance won last — a real "second marker" a viewer
  // would see, with no code path that ever cleans up the orphaned instance.
  // watchMapForChanges' own single-flighting is enough here since this
  // handler has no further `await` inside it (unlike the old inline
  // doLoad, which awaited its own fetch) — nothing can interleave partway
  // through a single call.
  function onMapChanged(nextMap) {
    if (destroyed || !nextMap) return;
    map = nextMap;
    onTitleChange?.(map.name || "");
    if (!baseMapManager) {
      container.innerHTML = "";
      container.appendChild(viewerHost);
      // onViewChange re-renders layers on every Leaflet moveend/zoomend (see
      // base-maps.js's TileBaseMap.emitChange) — exactly what Orrery's own
      // app.js does with its own render function. Without this, a marker's
      // on-screen position (computed via leafletMap.latLngToLayerPoint —
      // see map-viewer.js's own comment on why that's zoom-relative) is only
      // ever correct as of whenever renderLayers() last ran; zooming without
      // it left every marker's pixel position stale until the next 30s poll.
      baseMapManager = new BaseMapManager({ container: viewerHost, onViewChange: () => renderLayers() });
    }
    // Only resets pan/zoom (setBaseMap) when the base map itself actually
    // changed — a live-triggered reload from an unrelated edit (a moved
    // marker, a renamed layer) shouldn't yank a player's view back to the
    // default every 30 seconds.
    const signature = JSON.stringify(map.baseMap);
    if (signature !== baseMapSignature) {
      baseMapSignature = signature;
      baseMapManager.setBaseMap(map.baseMap, map.view);
      // setBaseMap()'s own mount() clears `viewerHost` entirely (see
      // base-maps.js's clearContainer) — the zoom panel has to be (re)built
      // AFTER that, never before, or it's wiped out the instant this runs.
      zoomPanel = null;
    }
    if (!zoomPanel) {
      zoomPanel = buildZoomPanel();
      viewerHost.appendChild(zoomPanel);
    }
    renderLayers();
  }

  // watchMapForChanges owns the poll (createReliableInterval, not plain
  // window.setInterval — a Map popped out onto a physical second screen
  // sits unfocused for the whole session; plain setInterval was confirmed
  // to stall there until the window was manually refocused, see
  // reliable-interval.js's own header) plus the live-stream "wake sooner"
  // subscription.
  watcher = watchMapForChanges({
    dataManager,
    mapId,
    shareToken,
    groupId,
    pollIntervalMs: POLL_INTERVAL_MS,
    onChange: onMapChanged,
    onError: () => {
      if (!destroyed) renderError("Unable to load this map.");
    },
    // Orrery's click-to-ping tool — this widget IS the "table" a GM pings,
    // so it only ever needs to render one, never send one.
    onPing: ({ position, by }) => {
      const overlay = baseMapManager?.getOverlayContainer();
      if (!overlay || !map || !position) return;
      overlay.appendChild(createPingMarker(baseMapManager, map, position, by || ""));
    },
  });

  return {
    refresh: () => {
      watcher.refresh();
      void refreshVisibility();
    },
    destroy() {
      destroyed = true;
      watcher.stop();
      resizeObserver?.disconnect();
      baseMapManager?.current?.destroy?.();
      container.innerHTML = "";
    },
  };
}
