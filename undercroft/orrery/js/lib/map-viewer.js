// The shared map-rendering core for a BaseMapManager-driven map — used by
// Orrery's own authoring surface (orrery/js/app.js) AND the Dashboard's
// read-only Map widget (common/js/lib/widgets/map.js), so there's exactly
// one implementation of every layer type's rendering, the tiered-visibility
// filter, the marker coordinate math, and the pixel-drag mechanics — not two
// copies that could drift apart. Whatever layers a map has (grid, raster,
// vector, marker), both consumers render through the same functions, so
// they always look the same.
//
// Everything caller-specific stays out of this module and is expressed as
// callbacks instead: Orrery's undo-stack recording, property-inspector
// selection, grid-cell click-selection semantics (ctrl/shift range select),
// "click empty space to place a new marker," and whole-layer drag are all
// authoring-only concerns with no meaning for a read-only viewer — none of
// them are called at all when a caller (the Dashboard widget) doesn't supply
// the corresponding callback, which is also exactly why passing no
// `selection`/`activeGroup` here is enough to get a plain, non-interactive
// render with zero special-casing on the caller's part.

import { getIconTokens } from "../../../common/js/lib/icon-picker.js";
import { resolveBinding } from "../../../common/js/lib/bindings.js";
import { evaluateFormula } from "../../../common/js/lib/formula-engine.js";
import { allowsDelete } from "../../../common/js/lib/ownership.js";
import { resolveImageDimension } from "./base-maps.js";
import { getDefaultView as getTypeDefaultView } from "./map-model.js";

// Returns null when nothing should be filtered (hasFullAccess, or the map
// has no authored Views at all — "no Views configured yet" defaults to
// unfiltered). Otherwise the Set of layer ids visible to `viewerTier` — the
// union of every View whose `tiers` is empty (applies to everyone) or
// includes viewerTier. An empty Set is a legitimate result: Views exist, but
// none match this viewer, so nothing is visible.
export function computeVisibleLayerIds(map, viewerTier, hasFullAccess) {
  if (hasFullAccess) return null;
  const views = map.views || [];
  if (!views.length) return null;
  const applicableViews = views.filter((view) => !view.tiers?.length || view.tiers.includes(viewerTier));
  const visible = new Set();
  applicableViews.forEach((view) => (view.layerIds || []).forEach((id) => visible.add(id)));
  return visible;
}

export function isTileBaseMap(map) {
  return map.baseMap?.type === "tile";
}

// Image/canvas base maps live inside PanZoomController's own CSS
// `scale(zoom)` transform (see pan-zoom.js's applyTransform) — everything
// under it (grid, markers, vector shapes) is positioned in PRE-scale
// content-space pixels, and the ambient transform handles making that look
// right at the current zoom for free... for RENDERING. Any code that goes
// the other direction — converting a raw event.clientX/clientY (a POST-
// scale, real screen pixel) back into content-space, e.g. "where did the
// user click" or "how far did the pointer move during a drag" — has to
// divide by the current zoom first, or it's off by exactly that factor
// (confirmed as the actual cause of "a new marker/shape appears offset
// from the cursor" and "dragging doesn't track the cursor" once zoom
// drifts from the default 1 — which it does the instant a GM zooms in to
// see a newly native-sized image better). Tile maps need no such division —
// Leaflet's own layerPoint space already accounts for zoom internally
// (mouseEventToLayerPoint/latLngToLayerPoint), which is why their own call
// sites below don't call this at all.
function getNonTileZoom(baseMapManager) {
  return baseMapManager?.getView?.()?.zoom || 1;
}

// A marker's stored position shape depends on the base map it was placed on
// (lat/lng for tile, flat x/y for image/canvas — see markerPositionToLocalPixel
// below) — a marker placed before the map's base map type was later changed
// carries the OLD shape, which markerPositionToLocalPixel can't project at
// all and would otherwise silently fall back to a meaningless (0, 0), i.e. a
// phantom dot wherever Leaflet's current pixel origin happens to be. Skipping
// it here (both Orrery and the Dashboard widget render through this same
// function) means a stale marker just doesn't render, instead of appearing
// as an extra, wrongly-placed one.
function hasValidMarkerPosition(map, position) {
  if (isTileBaseMap(map)) {
    return Number.isFinite(position?.lat) && Number.isFinite(position?.lng);
  }
  return Number.isFinite(position?.x) && Number.isFinite(position?.y);
}

// Layer position is a whole-layer pan offset applied on top of each marker
// element's own coordinate. Tile maps don't use this: every marker carries
// a real {lat, lng}, so a separate manual "drag the whole layer" pixel
// offset has no coherent meaning there. The `* 1` layer-position-scale
// factor mirrors orrery/js/app.js's own getLayerPositionScale, currently a
// stub for a not-yet-implemented per-layer scale feature.
export function getMarkerLayerOffset(map, layer) {
  if (isTileBaseMap(map)) {
    return { x: 0, y: 0 };
  }
  return { x: layer.position?.x || 0, y: layer.position?.y || 0 };
}

// Converts a marker's *stored* position into a pixel position relative to
// the marker layer's own overlay container (excluding the whole-layer
// offset — see getMarkerElementPixelPosition below).
//
// Tile maps re-derive the pixel position fresh on every render via
// Leaflet's own layerPoint projection: a flat pixel offset only looks right
// at the zoom level it was placed at, since Leaflet resets its internal
// pixel origin on zoom rather than just visually rescaling existing
// content. layerPoint is the same coordinate space Leaflet's own overlays
// use internally, which is why it stays correctly anchored — relative to
// the map's pixel origin, not the live pan offset (the enclosing Leaflet
// pane's own transform, which the overlay host already lives inside,
// supplies the pan, exactly like every built-in Leaflet layer).
//
// Image/canvas maps keep the original flat {x, y} model: their overlay
// lives inside the same CSS-transformed element PanZoomController pans and
// scales, so a plain local pixel coordinate already tracks pan/zoom for
// free, with no projection reset to worry about.
export function markerPositionToLocalPixel(baseMapManager, map, position) {
  if (isTileBaseMap(map)) {
    const leafletMap = baseMapManager.getMap();
    if (leafletMap && position && Number.isFinite(position.lat) && Number.isFinite(position.lng)) {
      const point = leafletMap.latLngToLayerPoint(window.L.latLng(position.lat, position.lng));
      return { x: point.x, y: point.y };
    }
    return { x: 0, y: 0 };
  }
  return { x: position?.x || 0, y: position?.y || 0 };
}

// The inverse — turns a local pixel position (already excluding
// getMarkerLayerOffset) into whatever this base map type actually stores.
export function localPixelToMarkerPosition(baseMapManager, map, pixel) {
  if (isTileBaseMap(map)) {
    const leafletMap = baseMapManager.getMap();
    if (leafletMap) {
      const latlng = leafletMap.layerPointToLatLng(window.L.point(pixel.x, pixel.y));
      return { lat: latlng.lat, lng: latlng.lng };
    }
    return { lat: 0, lng: 0 };
  }
  return { x: Math.round(pixel.x), y: Math.round(pixel.y) };
}

export function getMarkerElementPixelPosition(baseMapManager, map, layer, markerElement) {
  const offset = getMarkerLayerOffset(map, layer);
  const local = markerPositionToLocalPixel(baseMapManager, map, markerElement.position);
  return { x: offset.x + local.x, y: offset.y + local.y };
}

// Converts a raw pointer event into a map-space position (the same {x,y}/
// {lat,lng} shape a marker element's own `position` uses) — the same
// tile-vs-flat branching createMarkerLayerElement's own onEmptyClick already
// does (Leaflet's mouseEventToLayerPoint for a tile map, a plain
// container-relative rect subtraction for image/canvas), extracted here so
// a layer-independent caller (Orrery's click-to-ping tool) can reuse it
// without a marker layer's own container/offset in the picture at all —
// `referenceContainer` is just baseMapManager's own overlay container, not
// any one layer's.
export function resolveClickPosition(baseMapManager, map, event, referenceContainer) {
  let localPixel;
  if (isTileBaseMap(map)) {
    const leafletMap = baseMapManager.getMap();
    if (!leafletMap) return null;
    const layerPoint = leafletMap.mouseEventToLayerPoint(event);
    localPixel = { x: layerPoint.x, y: layerPoint.y };
  } else {
    const rect = referenceContainer.getBoundingClientRect();
    const zoom = getNonTileZoom(baseMapManager);
    localPixel = { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }
  return localPixelToMarkerPosition(baseMapManager, map, localPixel);
}

// Drag operates in plain screen-pixel deltas for TILE maps (correct as-is —
// you're never crossing a zoom-driven projection reset mid-drag, and
// Leaflet's own layerPoint space, which startPixel/dotEl's left/top are
// already in, is defined as 1 unit per CSS pixel at the current zoom, so a
// raw mouse delta already IS a layerPoint delta) but needs dividing by the
// current zoom for image/canvas maps first — dotEl lives inside
// PanZoomController's own scale(zoom) transform, so its left/top are
// CONTENT-space pixels, and a raw (post-scale) screen-pixel mouse delta
// applied there directly overshoots by exactly the zoom factor (see
// getNonTileZoom's own comment). Converts the final pixel position back
// into the marker's real stored representation (lat/lng or x/y) once the
// gesture ends. `onDragEnd(nextPosition)` only fires if the gesture
// actually moved the marker — a plain click-no-drag is a no-op here
// (callers that also want "select on click" pass `onDragStart`, called
// unconditionally before tracking begins).
//
// `isMoveBlocked(fromPixel, toPixel)`, if supplied, is checked on EVERY
// pointermove (not just at gesture end) — if the segment from the marker's
// last unblocked position to the proposed next one crosses a blocking wall/
// closed-door, that frame's move is simply skipped (dotEl stays at
// lastPixel), producing a natural "stops at the wall" feel without full
// vector-sliding geometry. Only ever passed by the Dashboard widget's own
// player-token drag path (map.js's own resolveMarkerMoveBlocked) — Orrery's
// own free-drag authoring surface never passes this, a GM must be able to
// drag any token through walls while setting up a scene.
function beginMarkerDrag(event, baseMapManager, map, layer, markerElement, dotEl, { onDragEnd, isMoveBlocked } = {}) {
  // Best-effort — see renderShapeElement's own matching try/catch for why
  // (some browsers throw InvalidStateError capturing in certain DOM
  // positions); the window-level pointermove/pointerup listeners below
  // track the gesture regardless, capture is just a "stay locked to this
  // element" nicety on top.
  try {
    dotEl.setPointerCapture(event.pointerId);
  } catch (error) {
    // Ignored — see comment above.
  }
  const startPixel = getMarkerElementPixelPosition(baseMapManager, map, layer, markerElement);
  const startX = event.clientX;
  const startY = event.clientY;
  const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
  let lastPixel = null;
  baseMapManager.setInteractionEnabled(false);
  const onMove = (moveEvent) => {
    const dx = (moveEvent.clientX - startX) / zoom;
    const dy = (moveEvent.clientY - startY) / zoom;
    const candidatePixel = { x: startPixel.x + dx, y: startPixel.y + dy };
    if (typeof isMoveBlocked === "function" && isMoveBlocked(lastPixel || startPixel, candidatePixel)) {
      return;
    }
    lastPixel = candidatePixel;
    dotEl.style.left = `${lastPixel.x}px`;
    dotEl.style.top = `${lastPixel.y}px`;
  };
  const onUp = (upEvent) => {
    try {
      dotEl.releasePointerCapture(upEvent.pointerId);
    } catch (error) {
      // Ignored — capture above may never have actually been acquired.
    }
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    baseMapManager.setInteractionEnabled(true);
    if (lastPixel) {
      const offset = getMarkerLayerOffset(map, layer);
      const localPixel = { x: lastPixel.x - offset.x, y: lastPixel.y - offset.y };
      const nextPosition = localPixelToMarkerPosition(baseMapManager, map, localPixel);
      onDragEnd?.(nextPosition);
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// A transient, self-removing ping dot — appended by the caller into
// baseMapManager's own overlay container (not a specific layer's, pings are
// layer-independent) at the given map-space position, and automatically
// detached after its fade-out animation (orrery/css/styles.css's own
// `.orrery-ping` keyframes) finishes. `label`, if given, renders as a small
// "who pinged" caption next to the dot.
export function createPingMarker(baseMapManager, map, position, label = "") {
  const pixel = markerPositionToLocalPixel(baseMapManager, map, position);
  const dot = document.createElement("div");
  dot.className = "orrery-ping";
  dot.style.left = `${pixel.x}px`;
  dot.style.top = `${pixel.y}px`;
  if (label) {
    const caption = document.createElement("span");
    caption.className = "orrery-ping-label";
    caption.textContent = label;
    dot.appendChild(caption);
  }
  dot.addEventListener("animationend", () => dot.remove());
  return dot;
}

// Builds one marker dot, positioned for the current pan/zoom.
// - `draggable: false` renders a plain, non-interactive dot (pointer-events
//   off) — the Dashboard widget's default for every marker except the
//   viewer's own claimed character.
// - `onDragStart(dotEl)` fires on pointerdown, before drag tracking begins
//   — Orrery uses this to update its selection state; the widget doesn't
//   need it.
// - `onDragEnd(nextPosition)` fires once a drag gesture that actually moved
//   the marker completes.
export function createMarkerDot(baseMapManager, map, layer, markerElement, options = {}) {
  const dot = document.createElement("div");
  dot.className = "orrery-layer-marker-overlay";
  if (options.selected) {
    dot.classList.add("is-selected");
  }
  dot.dataset.elementId = markerElement.id;
  // Sized to the map's own primary grid cell — a token fills its whole
  // square, the standard VTT convention — rather than a fixed pixel size
  // that had no relationship to the grid at all (confirmed as the actual
  // cause of a marker looking "smaller than a square, off to one side":
  // a small fixed-size dot centered correctly on a much bigger cell just
  // looks adrift relative to the cell's own edges). Falls back to the
  // layer's own Size setting only when there's no grid layer to size
  // against at all.
  //
  // Deliberately NOT filtered on the grid layer's own visibility — Visible
  // is a display toggle for the grid LINES, not a statement that the grid
  // stops being the map's real scale/cell size while hidden. Confirmed as
  // a real bug before this: markers (and AoE shapes, see
  // resolveShapePixelsPerCell below) visibly changed size the instant the
  // GM hid the grid layer, even though nothing about the map's actual
  // scale changed.
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  const cellSize = gridLayer ? getGridCellSize(baseMapManager, map, gridLayer) : layer.settings?.size || 24;
  // sizeCells is a per-marker multiplier on top of the grid's own cell size
  // (createMarkerElement) — 1 (a normal one-square token) by default, so
  // this is a no-op for every marker placed before the field existed.
  const sizeCells = Number.isFinite(markerElement.sizeCells) && markerElement.sizeCells > 0 ? markerElement.sizeCells : 1;
  const size = cellSize * sizeCells;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  // Centering (top/left 50% + translate(-50%,-50%)) already comes from the
  // .orrery-layer-marker-overlay CSS rule — dot.style.left/top below just
  // overrides that 50%/50% anchor with this element's own pixel position;
  // the transform still applies on top, so the dot's center (not its
  // top-left corner) lands on that pixel.
  const ringColor = layer.settings?.color || "#0ea5e9";
  // Outline — was a fixed, uneditable CSS default (2px, theme body-bg,
  // image markers only) before; now applies to every marker (plain dot
  // included) and reads from the layer's own configured settings, always
  // present with a real value (createLayerSettings' own "no invisible
  // defaults" rule) so this never falls back to something unconfigured.
  // markerElement.outlineColor, when set, overrides the layer default for
  // THIS marker only (createMarkerElement's own comment — e.g. auto-copied
  // from a linked user's Favorite Color).
  dot.style.borderColor = markerElement.outlineColor || layer.settings?.outlineColor || "#0f172a";
  dot.style.borderWidth = `${Number.isFinite(layer.settings?.outlineWidth) ? layer.settings.outlineWidth : 2}px`;
  // Per-marker only (no layer-wide equivalent, unlike outline color/width) —
  // see createMarkerElement's own comment. Falls back to 1 only for a
  // marker saved before this field existed; every marker placed since
  // always stamps a real number here.
  dot.style.opacity = String(Number.isFinite(markerElement.opacity) ? markerElement.opacity : 1);
  if (markerElement.image) {
    // Per-marker image supersedes the layer's flat color/icon dot entirely —
    // a portrait token, ringed with the layer's own color so it still reads
    // as belonging to this layer at a glance. See map-model.js's
    // createMarkerElement for how `image` gets set (manual pick, or
    // auto-inherited once from a referenced Library record).
    dot.style.backgroundImage = `url("${markerElement.image}")`;
    dot.style.backgroundSize = "cover";
    dot.style.backgroundPosition = "center";
  } else {
    dot.style.backgroundColor = ringColor;
    // Falls back to the plain solid-color dot when no icon is set (or the
    // stored value doesn't resolve to a known ddb-*/bi-* class) — same
    // vocabulary as Press's Icon component field, see createIconPickerField.
    const iconTokens = getIconTokens(layer.settings?.icon);
    if (iconTokens.length) {
      const icon = document.createElement("span");
      const bootstrapToken = iconTokens.find((token) => token.startsWith("bi-"));
      icon.className = bootstrapToken ? `bi ${bootstrapToken}` : iconTokens.join(" ");
      icon.style.fontSize = `${Math.max(8, size * 0.6)}px`;
      icon.style.color = "#fff";
      icon.style.lineHeight = "1";
      dot.appendChild(icon);
      dot.classList.add("d-flex", "align-items-center", "justify-content-center");
    }
  }
  const draggable = options.draggable !== false;
  dot.style.pointerEvents = draggable ? "auto" : "none";
  dot.style.cursor = draggable ? "pointer" : "default";
  const pixelPosition = getMarkerElementPixelPosition(baseMapManager, map, layer, markerElement);
  dot.style.left = `${pixelPosition.x}px`;
  dot.style.top = `${pixelPosition.y}px`;
  if (markerElement.label) {
    dot.title = markerElement.label;
    if (layer.settings?.showLabels) {
      // A child of `dot`, so it rides along with the SAME content-space/
      // ambient-scale positioning `dot` itself already uses (see this
      // function's own opening comment) — labelSize means "content-space
      // pixels," growing/shrinking with zoom exactly like the marker's own
      // size does, not a fixed on-screen size.
      const label = document.createElement("span");
      label.className = `orrery-marker-label orrery-marker-label--${layer.settings.labelPosition === "above" || layer.settings.labelPosition === "over" ? layer.settings.labelPosition : "below"}`;
      label.textContent = markerElement.label;
      const labelSize = Number.isFinite(layer.settings.labelSize) && layer.settings.labelSize > 0 ? layer.settings.labelSize : 12;
      label.style.fontSize = `${labelSize}px`;
      dot.appendChild(label);
    }
  }
  // Condition/status badges — see map-model.js's own createMarkerOverlayIcon.
  // A row along the marker's own bottom edge (see .orrery-marker-overlay-icons'
  // own CSS), sized off the SAME `size` this marker's own dot already
  // computed above, so badges scale with the token/grid cell size instead
  // of staying a fixed on-screen size regardless of zoom.
  if (Array.isArray(markerElement.overlayIcons) && markerElement.overlayIcons.length) {
    const badgeRow = document.createElement("div");
    badgeRow.className = "orrery-marker-overlay-icons";
    const badgeSize = Math.max(10, size * 0.32);
    markerElement.overlayIcons.forEach((entry) => {
      const badge = document.createElement("span");
      badge.className = "orrery-marker-overlay-icon";
      badge.style.width = `${badgeSize}px`;
      badge.style.height = `${badgeSize}px`;
      badge.style.background = entry.color || "#1e293b";
      if (entry.label) badge.title = entry.label;
      const iconTokens = getIconTokens(entry.icon);
      if (iconTokens.length) {
        const icon = document.createElement("span");
        const bootstrapToken = iconTokens.find((token) => token.startsWith("bi-"));
        icon.className = bootstrapToken ? `bi ${bootstrapToken}` : iconTokens.join(" ");
        icon.style.fontSize = `${badgeSize * 0.65}px`;
        badge.appendChild(icon);
      }
      badgeRow.appendChild(badge);
    });
    dot.appendChild(badgeRow);
  }
  if (draggable) {
    dot.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      options.onDragStart?.(dot);
      beginMarkerDrag(event, baseMapManager, map, layer, markerElement, dot, {
        onDragEnd: options.onDragEnd,
        isMoveBlocked: options.isMoveBlocked,
      });
    });
  }
  return dot;
}

// Marker layers render a full-size, absolutely-positioned container (not a
// single centered dot) so each placed pin can carry its own position.
// - `isInteractive` + `onEmptyClick(position, event)`: clicking empty space
//   inside the container (Orrery-only — the widget never passes this)
//   reports the click's map-space position, already converted from screen
//   pixels the same way every marker's own position is.
// - `isMarkerDraggable(markerElement)`: per-marker draggability — the
//   widget passes one that's only true for its own claimed character's
//   marker. Orrery omits this and instead defaults every marker's own
//   click-to-select/drag to `isInteractive` (i.e. only when this layer is
//   the one currently selected) — same "select the layer from the left
//   pane list first, then its individual placed things become clickable on
//   the map" convention grid cells and drawn vector paths already follow.
//   Confirmed as a real bug before this: every marker was always clickable
//   regardless of layer selection, which meant tools that click the map for
//   an unrelated reason (Measure) kept accidentally selecting markers
//   underneath the cursor instead.
export function createMarkerLayerElement(baseMapManager, map, layer, options = {}) {
  const container = document.createElement("div");
  container.className = "orrery-layer-marker-container";
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.pointerEvents = options.isInteractive ? "auto" : "none";
  if (options.isInteractive) {
    container.classList.add("is-interactive");
    container.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target !== container) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      let localPixel;
      if (isTileBaseMap(map)) {
        // mouseEventToLayerPoint handles the container-relative math itself
        // (robust regardless of how deeply nested this container is inside
        // Leaflet's own panned panes) and returns coordinates already in the
        // same layerPoint space every marker position uses.
        const leafletMap = baseMapManager.getMap();
        if (!leafletMap) return;
        const layerPoint = leafletMap.mouseEventToLayerPoint(event);
        localPixel = { x: layerPoint.x, y: layerPoint.y };
      } else {
        // container.getBoundingClientRect() is POST-scale (real screen
        // pixels at the current zoom); offset is content-space (raw
        // layer.position, un-scaled) — dividing the screen-relative part by
        // zoom BEFORE subtracting offset keeps both terms in the same
        // units. Confirmed as the actual cause of a newly-placed marker
        // landing down-and-right of the actual click the instant zoom
        // drifted from the default 1 (see getNonTileZoom's own comment).
        const rect = container.getBoundingClientRect();
        const offset = getMarkerLayerOffset(map, layer);
        const zoom = getNonTileZoom(baseMapManager);
        localPixel = { x: (event.clientX - rect.left) / zoom - offset.x, y: (event.clientY - rect.top) / zoom - offset.y };
      }
      options.onEmptyClick?.(localPixelToMarkerPosition(baseMapManager, map, localPixel), event);
    });
  }
  (layer.elements || []).forEach((markerElement) => {
    if (!hasValidMarkerPosition(map, markerElement.position)) return;
    const draggable = options.isMarkerDraggable ? options.isMarkerDraggable(markerElement) : Boolean(options.isInteractive);
    container.appendChild(
      createMarkerDot(baseMapManager, map, layer, markerElement, {
        selected: options.selectedElementId === markerElement.id,
        draggable,
        onDragStart: options.onMarkerDragStart ? (dotEl) => options.onMarkerDragStart(layer, markerElement, dotEl) : undefined,
        onDragEnd: options.onMarkerDragEnd ? (nextPosition) => options.onMarkerDragEnd(layer, markerElement, nextPosition) : undefined,
        isMoveBlocked: options.resolveMarkerMoveBlocked
          ? (fromPixel, toPixel) => options.resolveMarkerMoveBlocked(layer, markerElement, fromPixel, toPixel)
          : undefined,
      })
    );
  });
  return container;
}

// --- Grid layers -------------------------------------------------------
// Square and hex grid rendering + coordinate math. The click-to-select-cells
// UX (ctrl/shift range selection) is Orrery-only and lives in app.js, which
// gets just the resolved `coord` via `onPointerDown` — this module only
// knows how to turn a point into a grid coordinate and back, not what
// selecting one means.

// createGridLayerElement's own grid div is oversized by this many pixels in
// every direction (a FIXED pixel amount, not a percentage of the container)
// so its own local origin sits a distance from the container's real corner
// that's a plain constant — see getGridBackgroundPosition's own comment for
// why a percentage-based oversize (the previous approach) actively broke
// alignment: `left: -100%` resolves against the container's LAYOUT size,
// which is NOT the same number `getBoundingClientRect()` reports once any
// CSS scale transform is applied (i.e. any zoom level other than exactly
// 1) — confirmed as the actual cause of the grid staying misaligned/jumpy
// even after correcting for it with that (zoom-variable) measurement. A
// fixed pixel constant sidesteps needing to measure the container's real
// size at all: as long as the SAME constant is used both to size/shift this
// div and to correct backgroundPosition, they exactly cancel by
// construction, for every base map type, at every zoom level. The div's own
// width/height still grow from that fixed-pixel origin via `calc(100% +
// 2*extent)`, so it always fully covers the container regardless of the
// container's own size — 4000px only needs to be a comfortable PAN margin
// beyond that, same "oversized enough to survive pan" reasoning as the fog
// overlay's own EXTENT=20000 (createFogOverlay).
const GRID_OVERLAY_EXTENT = 4000;

// A FIXED per-type reference zoom (map-model.js's own getDefaultView, e.g.
// zoom 2 for every tile map) — deliberately NOT baseMapManager.getDefaultView()
// (a same-named but different thing: that one returns whatever view object
// was last passed to setBaseMap, which since Initial Zoom/Position existed
// is the map's own configured Initial Zoom, defaulting to 1). Grid cell/
// marker sizing needs a STABLE reference point that never moves just
// because a GM tweaks their map's Initial Zoom — confirmed as the actual
// cause of a real regression: cellSize's zoom formula below is exponential
// (2^(viewZoom-baseZoom)), so baseZoom silently shifting from 2 to 1 after
// Initial Zoom shipped doubled every marker/grid cell's rendered size at
// every zoom level, compounding worse the further a GM zoomed in.
function getBaseZoom(map) {
  return getTypeDefaultView(map?.baseMap?.type)?.zoom ?? 1;
}

function getGridZoomScale(baseMapManager, map) {
  const baseZoom = getBaseZoom(map);
  const viewZoom = Number.isFinite(map.view?.zoom) ? map.view.zoom : baseZoom;
  if (isTileBaseMap(map)) {
    return Math.pow(2, viewZoom - baseZoom);
  }
  return baseZoom ? viewZoom / baseZoom : 1;
}

export function getGridLayoutScale(baseMapManager, map) {
  return isTileBaseMap(map) ? getGridZoomScale(baseMapManager, map) * 0.1 : 1;
}

// Exported for app.js's own snapMarkerPositionToGrid — getGridCoordFromPoint
// (below) expects its `point` argument already in this same "hit-test"
// scale (screen-pixel-equivalent for non-tile maps, since it internally
// divides by this factor to get back to content-space before applying cell
// math), not plain content-space — a caller starting from a content-space
// point (markerPositionToLocalPixel/getGridOffset are both zoom-independent
// for non-tile maps) has to multiply by this same factor first, or the
// function's own internal division effectively double-divides by zoom.
export function getGridHitTestScale(baseMapManager, map) {
  return isTileBaseMap(map) ? 1 : getGridZoomScale(baseMapManager, map);
}

export function getGridType(layer) {
  return layer.settings?.gridType || "square";
}

export function getGridOffset(baseMapManager, map, layer) {
  const offsetScale = getGridLayoutScale(baseMapManager, map);
  return {
    x: (layer.position?.x || 0) * offsetScale,
    y: (layer.position?.y || 0) * offsetScale,
  };
}

// createGridLayerElement's own grid div is shifted by GRID_OVERLAY_EXTENT
// pixels up/left of the container's real corner (see that constant's own
// comment) so the tiled background survives panning without a visible edge.
// That shift means the div's own local origin — what `background-position`
// is actually relative to — sits GRID_OVERLAY_EXTENT pixels away from the
// container's true top-left corner, not AT it. `getGridOffset` alone never
// accounts for that, so `background-position: offset.x` would visually
// anchor GRID_OVERLAY_EXTENT pixels off from where offset.x actually means.
// Adding the same fixed constant back cancels that shift exactly, so offset
// {0,0} anchors at the container's real corner — for every base map type,
// at every zoom level, with no per-cellSize residual at all.
export function getGridBackgroundPosition(baseMapManager, map, layer) {
  const offset = getGridOffset(baseMapManager, map, layer);
  return {
    x: offset.x + GRID_OVERLAY_EXTENT,
    y: offset.y + GRID_OVERLAY_EXTENT,
  };
}

export function getGridCellSize(baseMapManager, map, layer) {
  const baseSize = layer.settings?.cellSize || 50;
  return baseSize * getGridLayoutScale(baseMapManager, map);
}

export function getGridCellKey(layer, coord) {
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    return `hex:${coord.q},${coord.r}`;
  }
  return `square:${coord.col},${coord.row}`;
}

export function createGridCellSelectionEntry(layer, coord) {
  return { key: getGridCellKey(layer, coord), coord };
}

function getHexMetrics(cellSize) {
  const size = cellSize / 2;
  const height = Math.sqrt(3) * size;
  return { size, height, width: cellSize, offsetX: size, offsetY: height / 2 };
}

function axialRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

export function getGridCoordFromPoint(baseMapManager, map, layer, point) {
  const hitScale = getGridHitTestScale(baseMapManager, map);
  const scaledPoint = hitScale ? { x: point.x / hitScale, y: point.y / hitScale } : point;
  const cellSize = getGridCellSize(baseMapManager, map, layer);
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    const { size, offsetX, offsetY } = getHexMetrics(cellSize);
    const x = scaledPoint.x - offsetX;
    const y = scaledPoint.y - offsetY;
    const q = (2 / 3) * (x / size);
    const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size;
    return axialRound(q, r);
  }
  return {
    col: Math.floor(scaledPoint.x / cellSize),
    row: Math.floor(scaledPoint.y / cellSize),
  };
}

export function getGridCellPixelRect(baseMapManager, map, layer, coord) {
  const cellSize = getGridCellSize(baseMapManager, map, layer);
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    const { size, height, width, offsetX, offsetY } = getHexMetrics(cellSize);
    const centerX = size * 1.5 * coord.q + offsetX;
    const centerY = size * Math.sqrt(3) * (coord.r + coord.q / 2) + offsetY;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
  }
  return { x: coord.col * cellSize, y: coord.row * cellSize, width: cellSize, height: cellSize };
}

function buildHexGridBackground(size, lineColor) {
  const side = Math.max(size / 2, 1);
  const hexHeight = Math.sqrt(3) * side;
  const tileWidth = side * 3;
  const tileHeight = hexHeight * 2;
  const hexPoints = (centerX, centerY) =>
    [
      [centerX - side, centerY],
      [centerX - side / 2, centerY - hexHeight / 2],
      [centerX + side / 2, centerY - hexHeight / 2],
      [centerX + side, centerY],
      [centerX + side / 2, centerY + hexHeight / 2],
      [centerX - side / 2, centerY + hexHeight / 2],
    ]
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
  const hexes = [
    [side, hexHeight / 2],
    [side, hexHeight * 1.5],
    [side * 2.5, 0],
    [side * 2.5, hexHeight],
  ];
  const polygons = hexes
    .map(([centerX, centerY]) => `<polygon points="${hexPoints(centerX, centerY)}" fill="none" stroke="${lineColor}" stroke-width="1" />`)
    .join("");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}" viewBox="0 0 ${tileWidth} ${tileHeight}">
      ${polygons}
    </svg>
  `;
  const encoded = encodeURIComponent(svg.trim());
  return { image: `url("data:image/svg+xml,${encoded}")`, width: tileWidth, height: tileHeight };
}

// Appended as a CHILD of createGridLayerElement's own `grid` div, which is
// itself shifted GRID_OVERLAY_EXTENT pixels up/left of the container's true
// corner (see that constant's own comment) — this overlay's `inset:0` (CSS)
// fills THAT shifted box exactly, so a highlight positioned with the plain,
// uncompensated getGridOffset (container-relative) lands GRID_OVERLAY_EXTENT
// pixels away from the grid cell it's supposed to sit on, not on top of it.
// getGridBackgroundPosition already computes exactly this same correction
// for the grid lines' own background-position — reused here rather than a
// second copy of the same "+ GRID_OVERLAY_EXTENT" arithmetic. Confirmed as
// a real, previously-unnoticed bug: with cell highlights invisible/off-
// screen (they still exist, just GRID_OVERLAY_EXTENT away), selecting cells
// still worked at the data level, so it went uncaught until Fog of War's
// own reveal holes (same bug, same appended-to-`grid` mistake, see
// createFogOverlay below) made the missing highlight impossible to miss —
// a fogged cell that's supposedly revealed staying visibly grey.
function createGridSelectionOverlay(baseMapManager, map, layer, selectedCells, options = {}) {
  const overlay = document.createElement("div");
  overlay.className = "orrery-layer-grid-selection";
  const variant = options.variant || "selection";
  const gridType = getGridType(layer);
  const offset = getGridBackgroundPosition(baseMapManager, map, layer);
  selectedCells.forEach((cell) => {
    const rect = getGridCellPixelRect(baseMapManager, map, layer, cell.coord);
    const highlight = document.createElement("div");
    highlight.className = "orrery-grid-cell-highlight";
    if (variant === "group") {
      highlight.classList.add("is-group");
    }
    if (gridType === "hex") {
      highlight.classList.add("is-hex");
    }
    highlight.style.left = `${rect.x + offset.x}px`;
    highlight.style.top = `${rect.y + offset.y}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    overlay.appendChild(highlight);
  });
  return overlay;
}

// --- Walls / vision geometry ----------------------------------------------
// The one genuinely novel piece of geometry code the walls/fog/doors/lights
// feature needs — everything else in that feature is UI wiring around these
// two primitives (plus resolveVisibleCells, defined further below once the
// grid-coordinate helpers it needs are in scope).

const VISION_EPSILON = 1e-6;

// Standard parametric segment-vs-segment intersection test. p1p2 is the ray
// under test (a vision ray to a cell center, or a proposed movement step);
// p3p4 is one wall/closed-door segment (from resolveBlockingSegments below).
// Returns true only for a genuine interior crossing — t and u both strictly
// inside (0,1) with a small epsilon, so a ray that only touches a wall's own
// endpoint (e.g. two wall segments sharing a vertex) doesn't count as
// blocked.
export function segmentsIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < VISION_EPSILON) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t > VISION_EPSILON && t < 1 - VISION_EPSILON && u > VISION_EPSILON && u < 1 - VISION_EPSILON;
}

// Gathers every closed wall/door segment on the map, in true-container-space
// local pixels (the SAME coordinate space markerPositionToLocalPixel +
// getMarkerLayerOffset already produces for paths/shapes/markers — NOT the
// grid div's own EXTENT-shifted space, see getGridBackgroundPosition's own
// comment for that distinction). An open door contributes zero segments —
// it's simply not a wall while open, not a special case downstream callers
// need to know about. Deliberately NOT filtered by layer.visible — a hidden
// "Walls" layer still blocks vision/movement, matching the existing
// precedent that hiding grid LINES doesn't mean the grid stops being the
// map's real scale reference (findPrimaryGridLayer/resolveShapePixelsPerCell
// both ignore visibility for the same reason). Gathered once per caller
// (vision computation, light-clipping, movement-blocking all call this once
// and reuse the returned array) — never recomputed per-cell/per-frame.
export function resolveBlockingSegments(baseMapManager, map) {
  const segments = [];
  (map.layers || []).forEach((layer) => {
    if (layer.type !== "vector") return;
    const offset = getMarkerLayerOffset(map, layer);
    (layer.elements || []).forEach((element) => {
      if (element.kind !== "wall") return;
      if (element.wallType === "door" && element.doorState === "open") return;
      const points = (element.points || []).map((point) => {
        const local = markerPositionToLocalPixel(baseMapManager, map, point);
        return { x: local.x + offset.x, y: local.y + offset.y };
      });
      for (let i = 0; i < points.length - 1; i += 1) {
        segments.push({ a: points[i], b: points[i + 1] });
      }
    });
  });
  return segments;
}

// Which grid cells (on `layer`) are unobstructed and within `rangeCells` of
// `origin` — the vision-source resolution both character auto-reveal and
// light-reveal/light-clipping ultimately call. `origin` and
// `blockingSegments` must already be in the SAME true-container-space local
// pixels resolveBlockingSegments' own points use.
//
// Cell-CENTER-only ray testing (one ray per candidate cell), not full
// shadowcasting/visibility-polygon construction — a deliberate simplicity
// tradeoff: fog is already cell-granular (a binary revealed/not per cell,
// not sub-cell precise), so this doesn't introduce a new class of
// imprecision, just extends the existing one. Accepted caveat: a wall that
// clips a cell's own corner without crossing the line to that cell's
// CENTER can leave that one cell's classification "wrong" by this
// algorithm's own definition — worst case, one row of cells immediately
// adjacent to a wall. A cheap upgrade path if that ever proves visible in
// play: sample 5 points per cell (center + 4 inset corners), "visible if
// any sample is unobstructed" — not built now, not needed unless it's
// actually a problem.
//
// Coordinate math verified directly against this codebase's OWN existing
// working pattern for the exact same "true-container-space point <->
// this-grid-layer's-own-cell-math-space" conversion — see app.js's own
// snapMarkerPositionToGrid, the one other place in this file's ecosystem
// that does this conversion. getGridOffset (NOT getGridBackgroundPosition —
// that adds the grid DIV's own GRID_OVERLAY_EXTENT shift, which only
// applies inside that div's own child coordinate space, not here) is
// subtracted before calling getGridCoordFromPoint (which itself expects its
// point pre-scaled by getGridHitTestScale — see that function's own
// comment), and added back to each candidate cell's own pixel rect before
// computing its center, or the whole thing silently breaks the moment a GM
// manually drags this grid layer's own position away from {0,0}.
export function resolveVisibleCells(baseMapManager, map, layer, { origin, rangeCells, blockingSegments } = {}) {
  if (!origin || !Number.isFinite(rangeCells) || rangeCells <= 0) return [];
  const cellSizePx = getGridCellSize(baseMapManager, map, layer);
  if (!cellSizePx) return [];
  const rangePx = rangeCells * cellSizePx;
  const gridOffset = getGridOffset(baseMapManager, map, layer);
  const hitScale = getGridHitTestScale(baseMapManager, map);
  const relativeOrigin = {
    x: (origin.x - gridOffset.x) * hitScale,
    y: (origin.y - gridOffset.y) * hitScale,
  };
  const originCoord = getGridCoordFromPoint(baseMapManager, map, layer, relativeOrigin);
  const cellRadius = Math.ceil(rangeCells) + 1;
  const candidates = [];
  if (getGridType(layer) === "hex") {
    for (let q = -cellRadius; q <= cellRadius; q += 1) {
      const rMin = Math.max(-cellRadius, -q - cellRadius);
      const rMax = Math.min(cellRadius, -q + cellRadius);
      for (let r = rMin; r <= rMax; r += 1) {
        candidates.push({ q: originCoord.q + q, r: originCoord.r + r });
      }
    }
  } else {
    for (let col = originCoord.col - cellRadius; col <= originCoord.col + cellRadius; col += 1) {
      for (let row = originCoord.row - cellRadius; row <= originCoord.row + cellRadius; row += 1) {
        candidates.push({ col, row });
      }
    }
  }
  const segments = blockingSegments || [];
  const results = [];
  candidates.forEach((coord) => {
    const rect = getGridCellPixelRect(baseMapManager, map, layer, coord);
    const center = { x: rect.x + gridOffset.x + rect.width / 2, y: rect.y + gridOffset.y + rect.height / 2 };
    const distance = Math.hypot(center.x - origin.x, center.y - origin.y);
    if (distance > rangePx + cellSizePx / 2) return;
    if (distance > 1 && segments.some((segment) => segmentsIntersect(origin, center, segment.a, segment.b))) return;
    results.push(createGridCellSelectionEntry(layer, coord));
  });
  return results;
}

// Relocated from app.js (was module-private, reading a closed-over
// `state.map`) so the Dashboard widget's own player-driven marker drag
// (map.js) snaps to the grid exactly the same way Orrery's own authoring
// drag always has — confirmed real bug: the widget saved a token's raw
// drop position with no snapping at all, a visibly different (and, per this
// suite's own top-priority parity rule, wrong) feel from Orrery's. Same
// "convert to true container-relative content-space, find the cell, convert
// back" logic as resolveVisibleCells above, unchanged except `map` is now a
// parameter instead of a closure.
//
// `position` (and therefore markerPositionToLocalPixel(position)) is
// relative to the MARKER layer's own pan offset, not the container's true
// corner (see getMarkerElementPixelPosition's own "offset.x + local.x" —
// the marker layer's offset gets added back at RENDER time, meaning
// whatever's stored here has to exclude it). The grid math below works in
// true container-relative space (matching getGridOffset's own meaning), so
// the marker layer's own offset has to be added back in before doing that
// math, and subtracted back out before returning.
export function snapMarkerPositionToGrid(baseMapManager, map, position, markerLayer) {
  // Not filtered on visibility — hiding the grid's lines isn't a statement
  // that it stops being the map's real cell size/scale (see
  // findPrimaryGridLayer's own matching comment).
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  if (!gridLayer) {
    return position;
  }
  const markerOffset = markerLayer ? getMarkerLayerOffset(map, markerLayer) : { x: 0, y: 0 };
  const localPixel = markerPositionToLocalPixel(baseMapManager, map, position);
  const containerRelative = { x: localPixel.x + markerOffset.x, y: localPixel.y + markerOffset.y };
  const gridOffset = getGridOffset(baseMapManager, map, gridLayer);
  // containerRelative and gridOffset are both pure content-space
  // (zoom-independent for non-tile maps), but getGridCoordFromPoint expects
  // its point in the "hit-test" scale (see getGridHitTestScale's own
  // comment) — multiplying by that same factor first is what makes its
  // internal /hitScale step round-trip back to the right cell instead of
  // double-dividing by zoom. getGridCellPixelRect's own OUTPUT needs no such
  // adjustment — its cellSize is already content-space for non-tile maps
  // (getGridLayoutScale is a flat 1 there), same as `rect`/`gridOffset`.
  const hitScale = getGridHitTestScale(baseMapManager, map);
  const relativePoint = { x: (containerRelative.x - gridOffset.x) * hitScale, y: (containerRelative.y - gridOffset.y) * hitScale };
  const coord = getGridCoordFromPoint(baseMapManager, map, gridLayer, relativePoint);
  const rect = getGridCellPixelRect(baseMapManager, map, gridLayer, coord);
  const containerCenter = { x: rect.x + gridOffset.x + rect.width / 2, y: rect.y + gridOffset.y + rect.height / 2 };
  const center = { x: containerCenter.x - markerOffset.x, y: containerCenter.y - markerOffset.y };
  return localPixelToMarkerPosition(baseMapManager, map, center);
}

// Builds the interaction option set for a viewer WITHOUT full map access —
// used identically by the Dashboard's Map widget (common/js/lib/widgets/
// map.js, which is ALWAYS this restricted view — a player's dashboard never
// gets full authoring) and by Orrery's own app.js (for a non-owner,
// non-admin viewer reaching Orrery directly — see that file's own
// currentUserHasFullMapAccess). ONE implementation, not two independently-
// written copies that could (and did) drift apart — confirmed real
// complaint: dragging felt "totally different" between the widget and
// Orrery specifically because map.js used to carry its own bespoke copy of
// this exact policy instead of sharing Orrery's.
//
// Only builds POLICY — what's draggable (a character-linked marker this
// viewer owns or has edit access to, via characterOwnershipCatalog/
// allowsDelete), what's wall-blocked, grid-snapping on drop, and the
// locked-door check — never persistence. The two callers genuinely differ
// there (the widget relays through a campaign groupId's live-sync; Orrery's
// own view doesn't), so `onMarkerMoved(layer, markerElement,
// snappedPosition)`/`onDoorToggled(layer, elementId)` only fire once this
// policy has already approved the action — the caller's own job from there
// is just to persist it (both already use the SAME map-live-sync.js
// persistMarkerMove/persistElementUpdate under the hood) and refresh its
// own view. `characterOwnershipCatalog` is a caller-refreshed
// Map<characterId, {ownerId, ownerUsername, permissions}> (ownership.js's
// refreshOwnershipCatalog) — this module never fetches anything itself, per
// this file's own "everything caller-specific is a callback" philosophy.
export function buildRestrictedMapOptions({
  dataManager,
  baseMapManager,
  map,
  characterOwnershipCatalog,
  getCharacterPayload,
  status,
  onMarkerMoved,
  onDoorToggled,
  // (isDragging: boolean) => void — fired at marker-drag start/end. Lets
  // the caller's own remote poll (watchMapForChanges) skip an incoming
  // update while a drag is in progress, instead of applying it mid-gesture
  // and rebuilding the marker layer's DOM out from under the pointer-
  // capture driving that gesture. Confirmed real bug this fixes: a
  // restricted viewer's drag would "pop" straight to the final position
  // with no visible tracking during the gesture — because a poll landing
  // mid-drag (the map's 10-20s poll interval easily overlaps an unhurried
  // drag) tore out and rebuilt the very dot element being dragged; only its
  // FINAL, post-poll position ever painted. Orrery's own full-access drag
  // never hits this because a GM must already have `state.selection` set
  // (the Marker Layer selected) to drag at all, and that same state already
  // makes app.js's own poll guard skip incoming updates — a restricted
  // viewer has no selection concept at all, so it needed its own signal.
  onDragStateChange,
}) {
  const blockingSegments = resolveBlockingSegments(baseMapManager, map);
  function isMarkerDraggable(layer, markerElement) {
    if (markerElement.refKind !== "character" || !markerElement.refId) return false;
    return allowsDelete(characterOwnershipCatalog, markerElement.refId, { dataManager });
  }
  // Doors only — never gated on anything selection-related, since a
  // restricted viewer has no selection concept at all (renderMapLayers
  // itself already only wires this hit-target for a door whose
  // element.secret isn't set at all — see renderWallElement).
  function onDoorClick(layer, elementId) {
    const element = layer.elements?.find((entry) => entry.id === elementId);
    if (!element) return;
    if (element.locked) {
      status?.show?.("This door is locked.", { type: "warning", timeout: 2000 });
      return;
    }
    onDoorToggled?.(layer, elementId);
  }
  return {
    hasFullAccess: false,
    isMarkerDraggable,
    onMarkerDragStart: () => onDragStateChange?.(true),
    onMarkerDragEnd: (layer, markerElement, nextPosition) => {
      onDragStateChange?.(false);
      onMarkerMoved?.(layer, markerElement, snapMarkerPositionToGrid(baseMapManager, map, nextPosition, layer));
    },
    onDoorClick,
    // Never passed for a full-access viewer — the GM must be able to freely
    // drag any token through walls while setting up a scene. Only a
    // restricted viewer's own-token drag is ever blocked. `blockingSegments`
    // is computed once above (per renderMapLayers pass this options object
    // backs), not recomputed on every pointermove — a confirmed real
    // perf bug before this was fixed once, here, for both callers at once.
    resolveMarkerMoveBlocked: (layer, markerElement, fromPixel, toPixel) =>
      blockingSegments.some((segment) => segmentsIntersect(fromPixel, toPixel, segment.a, segment.b)),
    getCharacterPayload,
  };
}

// A marker's own Vision Range — the same Binding/Formula/Text precedence
// every other bindable field in this suite uses (common/js/lib/binding-
// field.js's own createBindingFormulaInput; see createMarkerElement's own
// header comment for why this is a Binding, not a hardcoded field name —
// there's no cross-system standard "Darkvision" field). `getCharacterPayload`
// is a SYNCHRONOUS, caller-supplied, cache-backed lookup (marker.refId) ->
// payload|undefined — this module never fetches anything itself (see this
// file's own top-of-file "everything caller-specific is a callback"
// philosophy); Orrery's own app.js and the Dashboard's map.js widget each
// keep their own small fetch-and-cache pair backing this parameter.
export function resolveMarkerVisionRangeCells(marker, getCharacterPayload) {
  const payload = typeof getCharacterPayload === "function" ? getCharacterPayload(marker.refId) : undefined;
  if (payload) {
    const formula = (marker.visionRangeFormula || "").trim();
    if (formula) {
      try {
        const numeric = Number(evaluateFormula(formula, payload));
        if (Number.isFinite(numeric)) return Math.max(0, numeric);
      } catch (error) {
        // Falls through to binding/text, same as Workbench's own
        // resolveComponentValue — a broken formula degrades to the next
        // precedence tier rather than breaking the fog render.
      }
    }
    const binding = (marker.visionRangeBinding || "").trim();
    if (binding.startsWith("@")) {
      const numeric = Number(resolveBinding(binding, payload));
      if (Number.isFinite(numeric)) return Math.max(0, numeric);
    }
  }
  const literal = Number(marker.visionRangeText);
  return Number.isFinite(literal) ? Math.max(0, literal) : 0;
}

// A light's EFFECTIVE position — its own stored `origin` for a freestanding
// light, or (when `attachedMarkerId` is set) the live position of whichever
// marker it's attached to, resolved fresh every call so a token-carried
// torch tracks its host as it's dragged with zero extra sync/persistence
// work (the marker's own position is already kept in sync by the ordinary
// map poll/live-sync — this just reads it). Falls back to the light's own
// last-known stored `origin` if the attached marker can't be found (e.g. it
// was deleted) — a dangling attachment degrades to "stopped moving," never
// an error/vanished light. Used by BOTH resolveRevealedCells' own
// light-reveal loop and renderLightElement's own glow positioning, so a
// light's visible glow and its actual fog-reveal contribution can never
// independently drift apart.
//
// `containingLayer` (the light's own vector layer, for the freestanding
// branch's own manual-position offset) is a caller-supplied parameter
// rather than independently searched for — every real caller already has
// it in scope (resolveRevealedCells' own light loop is iterating vector
// layers; renderLightElement already receives `layer`), and a caller
// building a THROWAWAY preview element not yet actually in `layer.elements`
// (setupLightTool's own live placement preview) still needs the correct
// offset — a self-search by element id would come up empty for exactly that
// element and silently fall back to {0,0}, offsetting the live preview from
// where the committed light will actually land on any layer with a
// nonzero manual position.
export function resolveLightOrigin(baseMapManager, map, containingLayer, light) {
  if (light.attachedMarkerId) {
    for (const layer of map.layers || []) {
      if (layer.type !== "marker") continue;
      const marker = (layer.elements || []).find((entry) => entry.id === light.attachedMarkerId);
      if (!marker) continue;
      const offset = getMarkerLayerOffset(map, layer);
      const local = markerPositionToLocalPixel(baseMapManager, map, marker.position);
      return { x: local.x + offset.x, y: local.y + offset.y };
    }
  }
  const offset = getMarkerLayerOffset(map, containingLayer || {});
  const local = markerPositionToLocalPixel(baseMapManager, map, light.origin);
  return { x: local.x + offset.x, y: local.y + offset.y };
}

// Resolves a fog-of-war-enabled grid layer's revealed cells — the UNION of
// up to three independent sources, null when fog isn't enabled at all (no
// filtering):
//   1. Manual — the configured revealGroupId Group's own members, reusing
//      the exact same Group membership/cell-rect machinery Groups already
//      use for their own highlight overlay (getGroupCellsForLayer). Always
//      present, unchanged from before walls/vision existed.
//   2. Character auto-reveal — gated by layer.settings.autoRevealFromVision;
//      every character-linked marker (any marker layer, anywhere on the
//      map) with a nonzero resolveMarkerVisionRangeCells contributes its
//      own wall-aware visible-cell set.
//   3. Lights — unconditional whenever fogOfWar is on (no separate toggle —
//      a placed Light's whole purpose is to reveal); every `kind:"light"`
//      element on any vector layer contributes its own wall-aware
//      visible-cell set, resolved from its live position (resolveLightOrigin
//      — tracks an attached marker if any).
// `getCharacterPayload` (see this file's own resolveMarkerVisionRangeCells)
// is threaded straight through from the caller — this function never
// fetches anything itself.
function resolveRevealedCells(baseMapManager, map, layer, { getCharacterPayload } = {}) {
  if (!layer.settings?.fogOfWar) {
    return null;
  }
  const manualGroup = (map.groups || []).find((entry) => entry.id === layer.settings.revealGroupId);
  const manualCells = manualGroup ? getGroupCellsForLayer(manualGroup, layer) : [];
  const byKey = new Map(manualCells.map((cell) => [cell.key, cell]));

  // The manual reveal-Group cells above are the ORIGINAL, pre-vision-engine
  // behavior — guaranteed to keep working (fog toggles on, shows/hides
  // exactly what the GM painted) even if something in the newer wall/vision
  // code throws for a data shape it didn't anticipate (a malformed wall's
  // points, an unusual base map/zoom combination, ...). Without this, an
  // exception anywhere in the auto-reveal/light loops below would propagate
  // out of resolveRevealedCells entirely, aborting the whole grid layer's
  // render (including createFogOverlay never being called at all) — the fog
  // overlay simply not appearing, not a visibly "broken" error state, which
  // is a much harder regression to notice/report than a wrong cell set
  // would be.
  try {
    const blockingSegments = resolveBlockingSegments(baseMapManager, map);

    if (layer.settings.autoRevealFromVision) {
      (map.layers || []).forEach((markerLayer) => {
        if (markerLayer.type !== "marker") return;
        const markerOffset = getMarkerLayerOffset(map, markerLayer);
        (markerLayer.elements || []).forEach((marker) => {
          if (marker.kind !== "marker" || marker.refKind !== "character") return;
          const rangeCells = resolveMarkerVisionRangeCells(marker, getCharacterPayload);
          if (rangeCells <= 0) return;
          const local = markerPositionToLocalPixel(baseMapManager, map, marker.position);
          const origin = { x: local.x + markerOffset.x, y: local.y + markerOffset.y };
          resolveVisibleCells(baseMapManager, map, layer, { origin, rangeCells, blockingSegments }).forEach((cell) =>
            byKey.set(cell.key, cell)
          );
        });
      });
    }

    (map.layers || []).forEach((vectorLayer) => {
      if (vectorLayer.type !== "vector") return;
      (vectorLayer.elements || []).forEach((element) => {
        if (element.kind !== "light") return;
        const origin = resolveLightOrigin(baseMapManager, map, vectorLayer, element);
        resolveVisibleCells(baseMapManager, map, layer, { origin, rangeCells: element.rangeCells, blockingSegments }).forEach(
          (cell) => byKey.set(cell.key, cell)
        );
      });
    });
  } catch (error) {
    // Falls through to whatever manual cells were already collected above —
    // see this try block's own header comment.
  }

  return Array.from(byKey.values());
}

// Shared by buildRevealedCellsMask AND createFogOverlay below (its own base/
// hole rects need to match the SAME extent its caller's own fill rect
// covers, or the mask's coordinate space and the thing it's masking
// disagree on how big "everywhere" is). Module-level, not local to either
// function — confirmed as a real bug otherwise: buildRevealedCellsMask's
// own extraction originally left this declared ONLY inside itself, while
// createFogOverlay (which also references it directly for its own `fill`
// rect, unchanged since before that extraction) was left with no local
// definition at all — a ReferenceError thrown on every fog-of-war render,
// which (uncaught, inside renderMapLayers' own per-layer forEach) aborted
// that whole render pass, silently skipping every layer after the grid one
// in map.layers' own order — the actual cause of walls/lights also
// disappearing the instant Fog of War was turned on, not just the fog
// overlay itself never appearing.
const FOG_MASK_EXTENT = 20000;

// Builds a <mask> — shared between the grid layer's own fog overlay
// (createFogOverlay below, offset = getGridBackgroundPosition, since that
// mask lives inside the grid div's own GRID_OVERLAY_EXTENT-shifted
// coordinate space) and a Light element's own wall-aware glow clip
// (renderLightElement, offset = plain getGridOffset — its own SVG is a
// sibling of the grid div, at true-container-space, NOT EXTENT-shifted,
// same space createVectorLayerElement's path/shape rendering already uses).
// Passing the offset in explicitly (rather than each caller recomputing it
// inline) is what makes this one implementation correct for both coordinate
// spaces instead of hardcoding the grid-only case.
//
// `invert` (default false): fog's own polarity — white base ("shows" by
// default) with a BLACK hole punched at each given cell (that cell's fog is
// ABSENT there, i.e. the real map shows through). `invert: true` (a light's
// own glow clip) is the opposite — the glow should show ONLY within its own
// visible-cell set, hidden everywhere else — so the base is black and the
// given cells are punched WHITE instead. Using the non-inverted polarity for
// a light was a confirmed real bug: in the ordinary no-obstruction case,
// virtually every cell under the light's own circle counts as "visible," so
// the fog-style mask punched black (hidden) holes across nearly the whole
// glow, leaving almost nothing showing.
function buildRevealedCellsMask(baseMapManager, map, layer, revealedCells, maskId, offset, { invert = false } = {}) {
  const svgNS = "http://www.w3.org/2000/svg";
  const mask = document.createElementNS(svgNS, "mask");
  mask.setAttribute("id", maskId);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  const base = document.createElementNS(svgNS, "rect");
  base.setAttribute("x", String(-FOG_MASK_EXTENT));
  base.setAttribute("y", String(-FOG_MASK_EXTENT));
  base.setAttribute("width", String(FOG_MASK_EXTENT * 2));
  base.setAttribute("height", String(FOG_MASK_EXTENT * 2));
  base.setAttribute("fill", invert ? "black" : "white");
  mask.appendChild(base);
  (revealedCells || []).forEach((cell) => {
    const rect = getGridCellPixelRect(baseMapManager, map, layer, cell.coord);
    const hole = document.createElementNS(svgNS, "rect");
    hole.setAttribute("x", String(rect.x + offset.x));
    hole.setAttribute("y", String(rect.y + offset.y));
    hole.setAttribute("width", String(rect.width));
    hole.setAttribute("height", String(rect.height));
    hole.setAttribute("fill", invert ? "white" : "black");
    mask.appendChild(hole);
  });
  return mask;
}

// A single opaque SVG rect, masked transparent over each revealed cell —
// covers a large fixed pixel extent (not the container's own 100%/percentage
// size, which isn't knowable here since this builds a detached element
// before it's mounted) with `overflow: visible` on the outer <svg>, so the
// fixed extent's exact size only has to be "generously larger than any
// realistic pan/zoom range," not exact.
// `ownerPreview`: renders a much lighter tint (see the fill alpha below) for
// the map's own owner/editor, who otherwise never sees fog at all (real fog
// only renders for `!hasFullAccess`, see createGridLayerElement) — this is
// purely an authoring aid, so the GM can still see the map underneath while
// knowing which cells a real viewer currently has hidden.
function createFogOverlay(baseMapManager, map, layer, revealedCells, { ownerPreview = false } = {}) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", ownerPreview ? "orrery-layer-fog-overlay orrery-layer-fog-overlay--owner-preview" : "orrery-layer-fog-overlay");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";
  const maskId = ownerPreview ? `orrery-fog-mask-${layer.id}-owner` : `orrery-fog-mask-${layer.id}`;
  const defs = document.createElementNS(svgNS, "defs");
  // getGridBackgroundPosition, not plain getGridOffset — this svg is a
  // CHILD of createGridLayerElement's own `grid` div (shifted
  // GRID_OVERLAY_EXTENT pixels off the container's true corner, see that
  // constant's own comment), so a hole positioned with the uncompensated
  // container-relative offset punches through the mask GRID_OVERLAY_EXTENT
  // pixels away from the actual visible cell — confirmed as the actual
  // cause of "revealed cells still show grey": the hole existed, just off
  // in empty space nowhere near the cell it was supposed to uncover, while
  // the giant ±EXTENT base/fill rects below still fully covered the
  // visible viewport regardless (their own span dwarfs a 4000px error, so
  // they never looked broken the way a small, precisely-placed hole did).
  const offset = getGridBackgroundPosition(baseMapManager, map, layer);
  const mask = buildRevealedCellsMask(baseMapManager, map, layer, revealedCells, maskId, offset);
  defs.appendChild(mask);
  svg.appendChild(defs);
  const fill = document.createElementNS(svgNS, "rect");
  fill.setAttribute("x", String(-FOG_MASK_EXTENT));
  fill.setAttribute("y", String(-FOG_MASK_EXTENT));
  fill.setAttribute("width", String(FOG_MASK_EXTENT * 2));
  fill.setAttribute("height", String(FOG_MASK_EXTENT * 2));
  // Both independently configurable (layer.settings.fogOpacity/
  // fogPreviewOpacity, see createLayerSettings's own comment) — real fog
  // (non-owner viewers) defaults near-opaque; the owner's own preview
  // defaults lighter but still clearly visible, not so faint it reads as
  // "nothing changed" the way a much fainter first attempt did.
  const opacity = ownerPreview
    ? (Number.isFinite(layer.settings?.fogPreviewOpacity) ? layer.settings.fogPreviewOpacity : 0.6)
    : (Number.isFinite(layer.settings?.fogOpacity) ? layer.settings.fogOpacity : 0.92);
  fill.setAttribute("fill", ownerPreview ? `rgba(100, 116, 139, ${opacity})` : `rgba(15, 23, 42, ${opacity})`);
  fill.setAttribute("mask", `url(#${maskId})`);
  svg.appendChild(fill);
  return svg;
}

// `selectionState`: { isInteractive, selectedCells, groupCells, hasFullAccess,
// onPointerDown(coord, event), paintMode, onPointerPaint(coord, event),
// onPointerPaintEnd() }. Only Orrery passes any of these — the widget
// renders the same grid appearance with no click handling attached at all.
// `paintMode` (Groups' own "paint cells" tool, app.js) swaps the single-
// click/shift-range/ctrl-toggle gesture below for a click-AND-DRAG one:
// onPointerPaint fires once per cell the pointer newly enters while the
// button stays down (not per pointermove event — held on `lastKey` below so
// lingering inside the same cell doesn't refire), letting a GM sweep a
// whole revealed area in one drag instead of clicking every cell one at a
// time. onPointerPaintEnd fires once on release so the caller can close out
// a single undo entry covering the whole drag, matching how every other
// drag gesture in this file (shape/marker move) batches to one commit.
export function createGridLayerElement(baseMapManager, map, layer, selectionState = {}) {
  const grid = document.createElement("div");
  grid.className = "orrery-layer-grid-overlay";
  if (selectionState.isInteractive) {
    grid.classList.add("is-interactive");
    if (selectionState.paintMode) {
      grid.classList.add("is-painting");
    }
    grid.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      baseMapManager.setInteractionEnabled(false);
      // The real container's rect, not grid's own (oversized by
      // GRID_OVERLAY_EXTENT, shifted up/left by it) rect below — matches
      // getGridOffset's own "pixels from the container's true corner"
      // meaning now that backgroundPosition uses getGridBackgroundPosition's
      // corrected anchor instead of this raw offset, so a click still lands
      // on the cell it visually landed on.
      //
      // getGridCoordFromPoint divides whatever point it's given by
      // getGridHitTestScale (the current zoom, for non-tile maps) — so
      // `offset` (already content-space/unscaled) has to be scaled UP by
      // that same factor before subtracting it from the raw (POST-scale,
      // real screen pixel) rect-relative point, or the two terms are in
      // mismatched units and the division below only partially corrects
      // for zoom. See getNonTileZoom's own comment (map-viewer.js) for the
      // general version of this same bug.
      const rect = baseMapManager.getOverlayContainer()?.getBoundingClientRect() || grid.getBoundingClientRect();
      const offset = getGridOffset(baseMapManager, map, layer);
      const hitScale = getGridHitTestScale(baseMapManager, map);
      const resolveCoord = (clientX, clientY) => {
        const point = { x: clientX - rect.left - offset.x * hitScale, y: clientY - rect.top - offset.y * hitScale };
        return getGridCoordFromPoint(baseMapManager, map, layer, point);
      };
      if (selectionState.paintMode && selectionState.onPointerPaint) {
        let lastKey = null;
        const paintAt = (clientX, clientY, evt) => {
          const coord = resolveCoord(clientX, clientY);
          const key = getGridCellKey(layer, coord);
          if (key === lastKey) {
            return;
          }
          lastKey = key;
          selectionState.onPointerPaint(coord, evt);
        };
        paintAt(event.clientX, event.clientY, event);
        const onMove = (moveEvent) => paintAt(moveEvent.clientX, moveEvent.clientY, moveEvent);
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          baseMapManager.setInteractionEnabled(true);
          selectionState.onPointerPaintEnd?.();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return;
      }
      const coord = resolveCoord(event.clientX, event.clientY);
      selectionState.onPointerDown?.(coord, event);
    });
    grid.addEventListener("pointerup", () => baseMapManager.setInteractionEnabled(true));
    grid.addEventListener("pointercancel", () => baseMapManager.setInteractionEnabled(true));
  }
  // A fixed PIXEL extent (not a percentage of the container — see
  // GRID_OVERLAY_EXTENT's own comment for why that broke alignment) sized
  // via calc() against the normal inset:0 100%/100% box every other layer
  // overlay uses, so this div's own local origin sits exactly
  // GRID_OVERLAY_EXTENT pixels from the container's real corner, always.
  grid.style.width = `calc(100% + ${GRID_OVERLAY_EXTENT * 2}px)`;
  grid.style.height = `calc(100% + ${GRID_OVERLAY_EXTENT * 2}px)`;
  grid.style.left = `-${GRID_OVERLAY_EXTENT}px`;
  grid.style.top = `-${GRID_OVERLAY_EXTENT}px`;
  grid.style.right = "auto";
  grid.style.bottom = "auto";
  const size = getGridCellSize(baseMapManager, map, layer);
  const gridType = layer.settings?.gridType || "square";
  const lineColor = layer.settings?.lineColor || "#0f172a";
  if (gridType === "hex") {
    const hexBackground = buildHexGridBackground(size, lineColor);
    grid.style.backgroundImage = hexBackground.image;
    grid.style.backgroundSize = `${hexBackground.width}px ${hexBackground.height}px`;
  } else {
    grid.style.backgroundImage = `linear-gradient(${lineColor} 1px, transparent 1px), linear-gradient(90deg, ${lineColor} 1px, transparent 1px)`;
    grid.style.backgroundSize = `${size}px ${size}px`;
  }
  const backgroundOffset = getGridBackgroundPosition(baseMapManager, map, layer);
  grid.style.backgroundPosition = `${backgroundOffset.x}px ${backgroundOffset.y}px`;
  // Real (opaque) fog only ever renders for a viewer WITHOUT full access —
  // the map's own owner/editor always sees the actual map unfiltered, same
  // rule every other View/tier visibility check in this file already
  // follows. The owner instead gets a much lighter preview tint of the
  // exact same mask (below) so fog stays visible as an authoring aid
  // without hiding anything real from them.
  if (!selectionState.hasFullAccess) {
    const revealedCells = resolveRevealedCells(baseMapManager, map, layer, { getCharacterPayload: selectionState.getCharacterPayload });
    if (revealedCells !== null) {
      grid.appendChild(createFogOverlay(baseMapManager, map, layer, revealedCells));
    }
  } else {
    const revealedCells = resolveRevealedCells(baseMapManager, map, layer, { getCharacterPayload: selectionState.getCharacterPayload });
    if (revealedCells !== null) {
      grid.appendChild(createFogOverlay(baseMapManager, map, layer, revealedCells, { ownerPreview: true }));
    }
  }
  if (selectionState.groupCells?.length) {
    grid.appendChild(createGridSelectionOverlay(baseMapManager, map, layer, selectionState.groupCells, { variant: "group" }));
  }
  if (selectionState.selectedCells?.length) {
    grid.appendChild(createGridSelectionOverlay(baseMapManager, map, layer, selectionState.selectedCells));
  }
  return grid;
}

// --- Raster / vector layers ---------------------------------------------
// Pure — no base-map-type branching needed beyond the renderState the
// orchestrator (renderMapLayers) already computes once per layer.

export function createRasterLayerElement(layer, renderState = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "orrery-layer-raster-overlay";
  const src = layer.settings?.src || "";
  const image = document.createElement("img");
  image.src = src || "data/sample-map.svg";
  image.alt = layer.name;
  const scale = renderState.sizeScale ?? 1;
  // Same three Width/Height forms (blank/native, literal px, "NN%" of
  // native) as the base map's own image — see base-maps.js's
  // resolveImageDimension. A percentage needs the image's own natural
  // size, not known until it's actually loaded — apply immediately for an
  // already-cached image (no further "load" event coming), else once it
  // arrives.
  function applyDimensions() {
    const width = resolveImageDimension(layer.settings?.width, image.naturalWidth);
    const height = resolveImageDimension(layer.settings?.height, image.naturalHeight);
    if (width) {
      image.width = Math.max(1, Math.round(width * scale));
    } else {
      image.removeAttribute("width");
    }
    if (height) {
      image.height = Math.max(1, Math.round(height * scale));
    } else {
      image.removeAttribute("height");
    }
  }
  if (image.complete && image.naturalWidth) {
    applyDimensions();
  } else {
    image.addEventListener("load", applyDimensions, { once: true });
  }
  if (renderState.position) {
    wrapper.style.display = "block";
    image.style.position = "absolute";
    image.style.left = `${renderState.position.x}px`;
    image.style.top = `${renderState.position.y}px`;
    image.style.transform = "translate(-50%, -50%)";
  }
  wrapper.appendChild(image);
  return wrapper;
}

// Renders every freehand stroke drawn on this vector layer (layer.elements,
// each a createVectorPathElement — see map-model.js). Each point converts
// through the SAME markerPositionToLocalPixel math a marker's own position
// uses, so a drawn line pans/zooms correctly point-by-point rather than as
// one rigid pre-rendered shape — this replaced a single hardcoded decorative
// triangle a vector layer used to always render regardless of any actual
// content. `overflow: visible` + no viewBox (same reasoning as
// createFogOverlay) means this doesn't need to know its own container's
// real pixel size to draw at arbitrary local-pixel coordinates, including
// ones outside its own nominal 100%x100% box.
// `options.onPathClick(elementId, event)`, when supplied, makes every drawn
// path individually clickable (a much wider invisible "hit" copy of the
// same polyline/dot sits on top of the visible one, since a raw 2px stroke
// is too thin to reliably click) — Orrery only ever supplies this while its
// own Draw tool is OFF (see setupDrawTool's drawModeActive gate in app.js):
// while actively drawing, paths need to stay click-through so a new stroke
// can be started anywhere, including on top of an existing one.
// `options.selectedElementId` highlights the currently-selected path (the
// vector-path selection kind's own "Delete Path" editor).
// The map's first grid layer supplies pixels-per-cell for AoE shape sizing
// — same "first grid layer, if any" convention app.js's own
// findPrimaryGridLayer uses for the Measure tool — falling back to the
// layer-settings default (createLayerSettings's own 50) rather than 0 so a
// shape never silently collapses to nothing on a map with no grid layer.
// Deliberately not filtered on the layer's own visibility — see
// createMarkerDot's matching comment just above: hiding the grid's lines
// isn't a statement that it stops being the map's real scale, and shapes
// visibly resizing the instant the grid layer got hidden was a real bug.
function resolveShapePixelsPerCell(baseMapManager, map) {
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  return gridLayer ? getGridCellSize(baseMapManager, map, gridLayer) : 50;
}

// One AoE measurement shape (see createVectorShapeElement, map-model.js).
// Geometry is computed in already-converted LOCAL PIXEL space — the origin
// via the exact same markerPositionToLocalPixel + offset a path point uses,
// size/width via resolveShapePixelsPerCell — so a shape pans/zooms exactly
// like a drawn path does, with no separate per-base-map-type math of its
// own. "line" and "cone" are plain polygons built from basic trig (origin +
// angleDeg direction); no existing line-with-width/wedge geometry elsewhere
// in the codebase to reuse instead (confirmed before writing this).
export function renderShapeElement(svg, baseMapManager, map, layer, element, offset, options) {
  const local = markerPositionToLocalPixel(baseMapManager, map, element.origin);
  const cx = local.x + offset.x;
  const cy = local.y + offset.y;
  const pixelsPerCell = resolveShapePixelsPerCell(baseMapManager, map);
  const sizePx = Math.max(0, (element.sizeCells || 0) * pixelsPerCell);
  const isSelected = options.selectedElementId === element.id;

  let visible;
  if (element.shapeType === "circle") {
    visible = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    visible.setAttribute("cx", String(cx));
    visible.setAttribute("cy", String(cy));
    visible.setAttribute("r", String(sizePx));
  } else if (element.shapeType === "square") {
    visible = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    visible.setAttribute("x", String(cx - sizePx / 2));
    visible.setAttribute("y", String(cy - sizePx / 2));
    visible.setAttribute("width", String(sizePx));
    visible.setAttribute("height", String(sizePx));
  } else {
    const angleRad = ((element.angleDeg || 0) * Math.PI) / 180;
    let points;
    if (element.shapeType === "cone") {
      const spreadRad = ((element.spreadDeg ?? 53) * Math.PI) / 180;
      const leftRad = angleRad - spreadRad / 2;
      const rightRad = angleRad + spreadRad / 2;
      points = [
        { x: cx, y: cy },
        { x: cx + sizePx * Math.cos(leftRad), y: cy + sizePx * Math.sin(leftRad) },
        { x: cx + sizePx * Math.cos(rightRad), y: cy + sizePx * Math.sin(rightRad) },
      ];
    } else {
      // "line" — a rectangle: origin ± half-width along the perpendicular,
      // extended `sizePx` along the facing direction.
      const dirX = Math.cos(angleRad);
      const dirY = Math.sin(angleRad);
      const perpX = -dirY;
      const perpY = dirX;
      const halfWidthPx = ((element.widthCells || 1) * pixelsPerCell) / 2;
      const farX = cx + dirX * sizePx;
      const farY = cy + dirY * sizePx;
      points = [
        { x: cx + perpX * halfWidthPx, y: cy + perpY * halfWidthPx },
        { x: farX + perpX * halfWidthPx, y: farY + perpY * halfWidthPx },
        { x: farX - perpX * halfWidthPx, y: farY - perpY * halfWidthPx },
        { x: cx - perpX * halfWidthPx, y: cy - perpY * halfWidthPx },
      ];
    }
    visible = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    visible.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  }
  // Selection used to override stroke to a fixed orange instead of adding a
  // separate indicator — confirmed as the actual cause of "outline color
  // isn't honored, always shows orange": the ONLY way to reach this editor
  // at all is by selecting the shape first, so the real configured color
  // was never visible while it was actually being edited. Markers already
  // solve this correctly (a separate box-shadow ring, .is-selected in
  // styles.css, never touching the marker's own color) — this clones the
  // same geometry as an outer glow ring instead, leaving `visible`'s own
  // stroke/fill always exactly what's configured, selected or not.
  if (isSelected) {
    const selectionRing = visible.cloneNode();
    selectionRing.setAttribute("fill", "none");
    selectionRing.setAttribute("stroke", "#0ea5e9");
    selectionRing.setAttribute("stroke-width", String((element.strokeWidth || 2) + 4));
    selectionRing.setAttribute("opacity", "0.6");
    selectionRing.style.pointerEvents = "none";
    svg.appendChild(selectionRing);
  }
  visible.setAttribute("fill", element.fillColor && element.fillColor !== "none" ? element.fillColor : "none");
  visible.setAttribute("stroke", element.strokeColor || "#0f172a");
  visible.setAttribute("stroke-width", String(element.strokeWidth || 2));
  // Falls back to 0.5 only for a shape saved before this field existed —
  // every shape placed since createVectorShapeElement always stamps a real
  // number here (see its own comment), this isn't a "normal" default path.
  visible.setAttribute("opacity", String(Number.isFinite(element.opacity) ? element.opacity : 0.5));
  svg.appendChild(visible);

  if (typeof options.onPathClick === "function" || typeof options.onShapeDragEnd === "function") {
    // A clone reuses whichever shape's own geometry attributes were just
    // set (cx/cy/r, x/y/width/height, or points) without re-deriving them —
    // fill:"transparent" (not "none") is what actually makes the WHOLE
    // shape area register pointer-events:"fill" hits, same reasoning the
    // path hit-target below already relies on.
    const hit = visible.cloneNode();
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("stroke", "transparent");
    hit.style.pointerEvents = "fill";
    hit.style.cursor = options.onShapeDragEnd ? "move" : "pointer";
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // element.kind ("shape") passed as a 3rd arg — this hit-target is
      // shared with plain drawn paths (which have no drag), so the caller
      // needs to know which kind of selection this actually is to decide
      // whether a full rebuild-on-select is safe (paths, nothing dragging
      // yet) or would tear out the very nodes a drag is about to
      // setPointerCapture on (shapes — see app.js's own
      // selectShapeElementForDrag).
      options.onPathClick?.(element.id, event, element.kind);
      if (typeof options.onShapeDragEnd !== "function") {
        return;
      }
      // Same "select immediately on pointerdown, drag is optional, commit
      // only if the pointer actually moved" gesture beginMarkerDrag uses —
      // see drawDragPreview below for how the live movement itself is shown.
      // Best-effort — some browsers throw InvalidStateError capturing on a
      // freshly-cloned SVG element in this DOM position (confirmed as the
      // actual cause of "the cursor shows move, but dragging a shape does
      // nothing at all": an uncaught throw here aborted the rest of this
      // handler before the pointermove/pointerup listeners below ever got
      // attached). Capture is a nicety (keeps the cursor/hover locked to
      // this element) — the drag itself is tracked via window-level
      // listeners regardless, so it works fine without it.
      try {
        hit.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignored — see comment above.
      }
      const startX = event.clientX;
      const startY = event.clientY;
      // The mouse delta is POST-scale (real screen pixels); `visible`/`hit`
      // live inside PanZoomController's own scale(zoom) transform — dividing
      // the raw delta by zoom first is what keeps the shape tracking the
      // cursor 1:1 on screen regardless of zoom (see getNonTileZoom's own
      // comment; same reasoning beginMarkerDrag's own fix uses).
      const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
      let lastDelta = null;
      baseMapManager.setInteractionEnabled(false);
      // A separate, temporary preview — appended fresh to the overlay on
      // every move, removed on release — instead of mutating the PERMANENT
      // visible/hit nodes in place. Confirmed necessary: mutating them
      // in-place (tried both a CSS `transform` and direct geometry
      // attribute updates) never actually repainted mid-drag — the shape
      // only ever visually updated once, at the very end, via the full
      // re-render onShapeDragEnd triggers on commit. This instead reuses
      // this exact function (renderShapeElement calling itself, with a
      // shifted origin and no onPathClick/onShapeDragEnd so it doesn't try
      // to build its own hit-target/drag handlers) against a throwaway
      // element+svg — the SAME "temporary overlay SVG, redrawn per move,
      // torn down on release" technique setupShapeTool's own new-shape
      // placement preview already uses successfully (app.js).
      // Removed outright, not just display:none — `hit` stays exactly as
      // it is (it's already invisible: fill/stroke transparent, and it's
      // what's holding the active pointerdown listener/capture, safer left
      // untouched mid-gesture). Only `visible` is what's actually painted,
      // so only it needs to disappear, and removing it from the DOM is a
      // stronger guarantee than a style property that a stray CSS rule or
      // browser quirk could otherwise still be overriding.
      visible.remove();
      const overlayHost = baseMapManager.getOverlayContainer();
      let preview = null;
      function drawDragPreview(dx, dy) {
        preview?.remove();
        preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        preview.style.position = "absolute";
        preview.style.inset = "0";
        preview.style.width = "100%";
        preview.style.height = "100%";
        preview.style.overflow = "visible";
        preview.style.pointerEvents = "none";
        const previewOrigin = localPixelToMarkerPosition(baseMapManager, map, { x: local.x + dx, y: local.y + dy });
        renderShapeElement(preview, baseMapManager, map, layer, { ...element, origin: previewOrigin }, offset, {
          selectedElementId: element.id,
        });
        overlayHost.appendChild(preview);
      }
      drawDragPreview(0, 0);
      const onMove = (moveEvent) => {
        lastDelta = { x: (moveEvent.clientX - startX) / zoom, y: (moveEvent.clientY - startY) / zoom };
        drawDragPreview(lastDelta.x, lastDelta.y);
      };
      const onUp = (upEvent) => {
        try {
          hit.releasePointerCapture(upEvent.pointerId);
        } catch (error) {
          // Ignored — capture above may never have actually been acquired.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        baseMapManager.setInteractionEnabled(true);
        preview?.remove();
        // Restored unconditionally — harmless even when a real move is
        // about to trigger a full re-render below (that rebuild discards
        // this whole svg/wrapper anyway), and necessary for the "clicked
        // without actually dragging" case, where no re-render happens at
        // all and this is the only copy of the shape left.
        svg.appendChild(visible);
        if (lastDelta) {
          const nextLocalPixel = { x: local.x + lastDelta.x, y: local.y + lastDelta.y };
          const nextOrigin = localPixelToMarkerPosition(baseMapManager, map, nextLocalPixel);
          options.onShapeDragEnd(element.id, nextOrigin);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    svg.appendChild(hit);
  }
}

// A wall OR a door (same element, distinguished by wallType — see
// map-model.js's own createWallElement). Whole-wall drag-to-move
// (options.onWallDragEnd) and per-vertex drag-to-reshape handles
// (options.onWallVertexDragEnd, shown only while selected) — same
// temp-preview-redraw-per-move technique renderShapeElement's own drag
// already uses (this function calling itself against a throwaway
// shifted-points element), just duplicated rather than extracted into a
// shared helper (see that function's own "deliberately its own drag
// implementation" reasoning, same tradeoff here).
//
// THREE independent hit-targets:
//   1. Authoring select + whole-wall drag (GM, Orrery's own app.js) — same
//      wide invisible-stroke convention every other vector element uses,
//      gated on `isSelected`/layer-selection via options.onPathClick/
//      onWallDragEnd.
//   2. Per-vertex handles — small circles at each point, shown only when
//      THIS wall is the current selection (not just its layer), each
//      independently draggable. Appended AFTER the whole-wall hit-target so
//      they sit on top in paint order and win the pointer hit-test for
//      clicks landing near a vertex.
//   3. Player click-to-toggle (the Dashboard widget) — a genuinely separate
//      callback (options.onDoorClick), NOT gated on layer selection at all,
//      since the widget has no selection/layer-selection concept
//      whatsoever (map.js never passes one) — wiring this through the
//      selection-gated onPathClick would mean it silently never fires for
//      players.
function renderWallElement(svg, baseMapManager, map, layer, element, offset, options) {
  const svgNS = "http://www.w3.org/2000/svg";
  const pixelPoints = (element.points || []).map((point) => {
    const local = markerPositionToLocalPixel(baseMapManager, map, point);
    return { x: local.x + offset.x, y: local.y + offset.y };
  });
  if (pixelPoints.length < 2) return;
  const isSelected = options.selectedElementId === element.id;
  const pointsAttr = pixelPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const isDoor = element.wallType === "door";
  const isSecret = isDoor && element.secret;
  // A secret door renders EXACTLY like a plain wall for a non-full-access
  // viewer (no tick, no distinguishing anything) — the GM alone sees the
  // truth, same "owner preview" asymmetry Fog of War's own real-vs-preview
  // opacity split already establishes elsewhere in this file.
  const revealDoorStyling = isDoor && (!isSecret || options.hasFullAccess);

  // Everything static (visible line + door decorations) lives in one <g>,
  // hidden as a single unit during a drag (see the hit-target's own
  // drawDragPreview below) rather than removing/re-adding individual pieces
  // — a wall can have several decoration nodes (tick, lock glyph), and
  // toggling one wrapper's display is simpler and less error-prone than
  // tracking each piece separately the way a shape (with only ever one
  // `visible` node) gets away with.
  const wrapper = document.createElementNS(svgNS, "g");

  const visible = document.createElementNS(svgNS, "polyline");
  visible.setAttribute("points", pointsAttr);
  visible.setAttribute("fill", "none");
  visible.setAttribute("stroke", isSelected ? "#f97316" : element.strokeColor || "#0f172a");
  visible.setAttribute("stroke-width", String(element.strokeWidth || 3));
  visible.setAttribute("stroke-linecap", "round");
  visible.setAttribute("stroke-linejoin", "round");
  visible.classList.add("orrery-layer-wall");
  wrapper.appendChild(visible);

  if (revealDoorStyling) {
    // A short perpendicular "leaf" tick at the door's own midpoint — reads
    // as a door regardless of exact stroke color/length. Uses the door's
    // FIRST segment for direction (a door is normally authored as a single
    // 2-point segment; a multi-point "door" — unusual, not disallowed —
    // still gets a reasonable tick off its first leg).
    const a = pixelPoints[0];
    const b = pixelPoints[1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const perpX = (-dy / length) * 10;
    const perpY = (dx / length) * 10;
    const tick = document.createElementNS(svgNS, "line");
    tick.setAttribute("x1", String(midX - perpX));
    tick.setAttribute("y1", String(midY - perpY));
    tick.setAttribute("x2", String(midX + perpX));
    tick.setAttribute("y2", String(midY + perpY));
    tick.setAttribute("stroke", "#92400e");
    tick.setAttribute("stroke-width", "3");
    tick.style.pointerEvents = "none";
    // Secret (GM-only view) gets an additional dash pattern so the GM can
    // tell "secret door" apart from "ordinary door" while authoring — this
    // branch only ever runs when options.hasFullAccess is already true (see
    // revealDoorStyling above), never for a player.
    if (isSecret) {
      tick.setAttribute("stroke-dasharray", "3 2");
    }
    wrapper.appendChild(tick);

    // A small padlock glyph, centered directly ON the door's own midpoint
    // (overlapping the tick — deliberate, this is the primary "this door is
    // locked" indicator, not a secondary decoration off to the side) — the
    // one persistent, always-on-the-map indicator that a door is locked,
    // rather than something a player only discovers by clicking it and
    // getting a toast. Shown under the exact same visibility rule as the
    // tick itself (revealDoorStyling) — a secret+locked door still shows
    // nothing at all to a non-GM viewer.
    if (element.locked) {
      const lockGroup = document.createElementNS(svgNS, "g");
      lockGroup.style.pointerEvents = "none";
      const shackle = document.createElementNS(svgNS, "path");
      shackle.setAttribute("d", `M ${midX - 2.5} ${midY - 1} A 2.5 3 0 0 1 ${midX + 2.5} ${midY - 1}`);
      shackle.setAttribute("fill", "none");
      shackle.setAttribute("stroke", "#dc2626");
      shackle.setAttribute("stroke-width", "1.5");
      const body = document.createElementNS(svgNS, "rect");
      body.setAttribute("x", String(midX - 4));
      body.setAttribute("y", String(midY - 1));
      body.setAttribute("width", "8");
      body.setAttribute("height", "6");
      body.setAttribute("rx", "1");
      body.setAttribute("fill", "#dc2626");
      lockGroup.append(shackle, body);
      wrapper.appendChild(lockGroup);
    }
  }

  // Player click-to-toggle — a secret door never gets this hit-target at
  // all (not just "clicking does nothing," it genuinely never registers a
  // handler), matching "a player doesn't even know it's there." Lives in
  // the wrapper too (never interactive during a GM-side drag anyway, since
  // onDoorClick and onWallDragEnd are never both supplied by the same
  // caller — see this function's own header comment).
  if (isDoor && !isSecret && typeof options.onDoorClick === "function") {
    const doorHit = document.createElementNS(svgNS, "polyline");
    doorHit.setAttribute("points", pointsAttr);
    doorHit.setAttribute("fill", "none");
    doorHit.setAttribute("stroke", "transparent");
    doorHit.setAttribute("stroke-width", String((element.strokeWidth || 3) + 14));
    doorHit.setAttribute("stroke-linecap", "round");
    doorHit.setAttribute("stroke-linejoin", "round");
    doorHit.style.pointerEvents = "stroke";
    doorHit.style.cursor = "pointer";
    doorHit.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onDoorClick(element.id, event);
    });
    wrapper.appendChild(doorHit);
  }

  // Authoring select + whole-wall drag — same wide invisible-stroke
  // convention every other vector element's hit-target uses.
  const canDragWall = typeof options.onWallDragEnd === "function";
  if (typeof options.onPathClick === "function" || canDragWall) {
    const hit = document.createElementNS(svgNS, "polyline");
    hit.setAttribute("points", pointsAttr);
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", String((element.strokeWidth || 3) + 14));
    hit.setAttribute("stroke-linecap", "round");
    hit.setAttribute("stroke-linejoin", "round");
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = canDragWall ? "move" : "pointer";
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      options.onPathClick?.(element.id, event, element.kind);
      if (!canDragWall) return;
      try {
        hit.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignored — see renderShapeElement's own matching try/catch.
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
      let lastDelta = null;
      baseMapManager.setInteractionEnabled(false);
      wrapper.style.display = "none";
      const overlayHost = baseMapManager.getOverlayContainer();
      let preview = null;
      function drawDragPreview(dx, dy) {
        preview?.remove();
        preview = document.createElementNS(svgNS, "svg");
        preview.style.position = "absolute";
        preview.style.inset = "0";
        preview.style.width = "100%";
        preview.style.height = "100%";
        preview.style.overflow = "visible";
        preview.style.pointerEvents = "none";
        const shiftedPoints = element.points.map((point) => {
          const local = markerPositionToLocalPixel(baseMapManager, map, point);
          return localPixelToMarkerPosition(baseMapManager, map, { x: local.x + dx, y: local.y + dy });
        });
        renderWallElement(preview, baseMapManager, map, layer, { ...element, points: shiftedPoints }, offset, {
          selectedElementId: element.id,
        });
        overlayHost.appendChild(preview);
      }
      drawDragPreview(0, 0);
      const onMove = (moveEvent) => {
        lastDelta = { x: (moveEvent.clientX - startX) / zoom, y: (moveEvent.clientY - startY) / zoom };
        drawDragPreview(lastDelta.x, lastDelta.y);
      };
      const onUp = (upEvent) => {
        try {
          hit.releasePointerCapture(upEvent.pointerId);
        } catch (error) {
          // Ignored — capture above may never have actually been acquired.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        baseMapManager.setInteractionEnabled(true);
        preview?.remove();
        wrapper.style.display = "";
        if (lastDelta) {
          const nextPoints = element.points.map((point) => {
            const local = markerPositionToLocalPixel(baseMapManager, map, point);
            return localPixelToMarkerPosition(baseMapManager, map, { x: local.x + lastDelta.x, y: local.y + lastDelta.y });
          });
          options.onWallDragEnd(element.id, nextPoints);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    wrapper.appendChild(hit);
  }

  svg.appendChild(wrapper);

  // Per-vertex reshape handles — only while THIS wall is the current
  // selection (not just its layer), same "you have to actually select it
  // first" convention every other post-placement editing affordance in this
  // suite already follows. Appended directly to `svg` (siblings of
  // `wrapper`, not children of it) so hiding `wrapper` during the WHOLE-wall
  // drag above doesn't also hide these — each handle manages its own
  // visibility during ITS OWN drag instead.
  if (isSelected && typeof options.onWallVertexDragEnd === "function") {
    pixelPoints.forEach((point, index) => {
      const handle = document.createElementNS(svgNS, "circle");
      handle.setAttribute("cx", String(point.x));
      handle.setAttribute("cy", String(point.y));
      handle.setAttribute("r", "6");
      handle.setAttribute("fill", "#f97316");
      handle.setAttribute("stroke", "#fff");
      handle.setAttribute("stroke-width", "1.5");
      handle.style.pointerEvents = "fill";
      handle.style.cursor = "grab";
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        try {
          handle.setPointerCapture(event.pointerId);
        } catch (error) {
          // Ignored — see renderShapeElement's own matching try/catch.
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
        let lastDelta = null;
        baseMapManager.setInteractionEnabled(false);
        handle.style.cursor = "grabbing";
        wrapper.style.display = "none";
        const overlayHost = baseMapManager.getOverlayContainer();
        let preview = null;
        function drawVertexDragPreview(dx, dy) {
          preview?.remove();
          preview = document.createElementNS(svgNS, "svg");
          preview.style.position = "absolute";
          preview.style.inset = "0";
          preview.style.width = "100%";
          preview.style.height = "100%";
          preview.style.overflow = "visible";
          preview.style.pointerEvents = "none";
          const nextPoints = element.points.map((originalPoint, i) => {
            if (i !== index) return originalPoint;
            const local = markerPositionToLocalPixel(baseMapManager, map, originalPoint);
            return localPixelToMarkerPosition(baseMapManager, map, { x: local.x + dx, y: local.y + dy });
          });
          // No onWallVertexDragEnd passed here — this is a throwaway,
          // non-interactive preview (pointer-events:none on the whole svg
          // already), and passing even a no-op would make renderWallElement
          // build REAL handle circles with their own real pointerdown
          // listeners on top of it, which could pick up and start a SECOND,
          // conflicting drag gesture if the cursor happens to pass over one
          // while THIS drag is already in progress. Just the moving vertex
          // itself is enough visual feedback.
          renderWallElement(preview, baseMapManager, map, layer, { ...element, points: nextPoints }, offset, {
            selectedElementId: element.id,
          });
          overlayHost.appendChild(preview);
        }
        drawVertexDragPreview(0, 0);
        const onMove = (moveEvent) => {
          lastDelta = { x: (moveEvent.clientX - startX) / zoom, y: (moveEvent.clientY - startY) / zoom };
          drawVertexDragPreview(lastDelta.x, lastDelta.y);
        };
        const onUp = (upEvent) => {
          try {
            handle.releasePointerCapture(upEvent.pointerId);
          } catch (error) {
            // Ignored — capture above may never have actually been acquired.
          }
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          baseMapManager.setInteractionEnabled(true);
          preview?.remove();
          wrapper.style.display = "";
          handle.style.cursor = "grab";
          if (lastDelta) {
            const originalPoint = element.points[index];
            const local = markerPositionToLocalPixel(baseMapManager, map, originalPoint);
            const nextPoint = localPixelToMarkerPosition(baseMapManager, map, { x: local.x + lastDelta.x, y: local.y + lastDelta.y });
            options.onWallVertexDragEnd(element.id, index, nextPoint);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      svg.appendChild(handle);
    });
  }
}

// A freestanding OR token-attached placed light. Position is always
// resolved via resolveLightOrigin (tracks an attached marker's live
// position when set; the passed-in `offset` — this layer's own manual
// position, same as every other vector element uses — is deliberately
// unused here, since resolveLightOrigin already resolves the correct final
// position itself either way, and re-adding this parameter's offset on top
// would double-apply it).
//
// The glow is masked to THIS LIGHT'S OWN wall-aware line-of-sight cell set
// — never the grid layer's whole unioned reveal set. If it clipped against
// the shared union, a light would visibly leak into a cell revealed by an
// unrelated source (e.g. a character standing in the next room) even with a
// wall directly between them. Applies unconditionally, whether or not Fog
// of War is even toggled on for the grid layer — a light's wall-shaping is
// a physical-correctness question ("does the glow pass through a wall"),
// not a hidden-information one, so every viewer (including the GM) sees
// the same clipped shape.
export function renderLightElement(svg, baseMapManager, map, layer, element, offset, options) {
  const origin = resolveLightOrigin(baseMapManager, map, layer, element);
  const { x: cx, y: cy } = origin;
  const pixelsPerCell = resolveShapePixelsPerCell(baseMapManager, map);
  const radiusPx = Math.max(0, (element.rangeCells || 0) * pixelsPerCell);
  const isSelected = options.selectedElementId === element.id;
  const svgNS = "http://www.w3.org/2000/svg";

  const defs = document.createElementNS(svgNS, "defs");
  const gradientId = `orrery-light-gradient-${element.id}`;
  const gradient = document.createElementNS(svgNS, "radialGradient");
  gradient.setAttribute("id", gradientId);
  const near = document.createElementNS(svgNS, "stop");
  near.setAttribute("offset", "0%");
  near.setAttribute("stop-color", element.color || "#fbbf24");
  near.setAttribute("stop-opacity", String(Number.isFinite(element.opacity) ? element.opacity : 0.5));
  const far = document.createElementNS(svgNS, "stop");
  far.setAttribute("offset", "100%");
  far.setAttribute("stop-color", element.color || "#fbbf24");
  far.setAttribute("stop-opacity", "0");
  gradient.append(near, far);
  defs.appendChild(gradient);

  const visible = document.createElementNS(svgNS, "circle");
  visible.setAttribute("cx", String(cx));
  visible.setAttribute("cy", String(cy));
  visible.setAttribute("r", String(radiusPx));
  visible.setAttribute("fill", `url(#${gradientId})`);
  visible.style.pointerEvents = "none";

  // findPrimaryGridLayer's own inline equivalent (map.layers.find(l =>
  // l.type==="grid")) — this map's scale reference for converting
  // element.rangeCells into a real segment-intersection test, regardless of
  // whether Fog of War is on for that layer or it's even visible (same "a
  // grid's own visibility doesn't affect whether it's still the map's real
  // scale reference" precedent resolveShapePixelsPerCell/findPrimaryGridLayer
  // already establish elsewhere). No grid layer at all: nothing to clip
  // against or measure cells in, so the glow just renders unclipped.
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  if (gridLayer) {
    const blockingSegments = resolveBlockingSegments(baseMapManager, map);
    const visibleCells = resolveVisibleCells(baseMapManager, map, gridLayer, {
      origin,
      rangeCells: element.rangeCells,
      blockingSegments,
    });
    const maskId = `orrery-light-mask-${element.id}`;
    // getGridOffset, NOT getGridBackgroundPosition — this light's own SVG
    // is a sibling of the grid div (part of its own vector layer's overlay,
    // true-container-space, same as every path/shape/marker), NOT a child
    // of the grid div's own GRID_OVERLAY_EXTENT-shifted coordinate space
    // (see buildRevealedCellsMask's own header comment for why the two
    // callers need different offsets despite sharing the same hole-punching
    // logic).
    const maskOffset = getGridOffset(baseMapManager, map, gridLayer);
    // invert: true — buildRevealedCellsMask's own DEFAULT polarity (white
    // base, black holes at the given cells) is built for FOG's use: fog
    // SHOWS everywhere except the given (revealed) cells. A light's own
    // glow needs the OPPOSITE — it should show ONLY within its own visible
    // cells, hidden everywhere else. Using the uninverted mask here was a
    // confirmed real bug: in the common no-obstruction case, virtually
    // every cell under the glow's own circle is "visible," so the
    // (uninverted) mask punched black holes across nearly the ENTIRE
    // circle, hiding almost all of it — "the light shows while dragging
    // (before this mask is even attached to anything) but disappears the
    // instant it's dropped and actually rendered through this path."
    const mask = buildRevealedCellsMask(baseMapManager, map, gridLayer, visibleCells, maskId, maskOffset, { invert: true });
    defs.appendChild(mask);
    visible.setAttribute("mask", `url(#${maskId})`);
  }
  svg.appendChild(defs);

  if (isSelected) {
    const ring = document.createElementNS(svgNS, "circle");
    ring.setAttribute("cx", String(cx));
    ring.setAttribute("cy", String(cy));
    ring.setAttribute("r", String(radiusPx));
    ring.setAttribute("fill", "none");
    // The light's own color, not a fixed accent blue (unlike a selected
    // shape's own ring, which deliberately stays a fixed color since a
    // shape's stroke is a separate, independently-configured field) — a
    // light has no separate "outline" concept, so the selection indicator
    // reads more naturally in the same hue as the light itself.
    ring.setAttribute("stroke", element.color || "#fbbf24");
    ring.setAttribute("stroke-width", "2");
    ring.setAttribute("stroke-dasharray", "6 4");
    ring.style.pointerEvents = "none";
    svg.appendChild(ring);
  }
  svg.appendChild(visible);

  // An attached light's position is derived from its host marker, not
  // independently draggable — the only way to move it is to move the
  // marker (or detach it via the inspector's own Attach to Token picker
  // first). Gated here, not by whether the caller happens to pass
  // onShapeDragEnd, since app.js's own renderLayerOverlays wires that
  // callback identically for every shape/light regardless of attachment.
  const canDrag = !element.attachedMarkerId && typeof options.onShapeDragEnd === "function";
  if (typeof options.onPathClick === "function" || canDrag) {
    // A plain (unmasked, ungraded) circle — the light's own glow shape
    // above isn't a reliable hit-target (a radial gradient fading to 0
    // opacity, and potentially wall-masked with real holes cut out of it,
    // both mean parts of the visible glow don't register pointer events
    // the way a flat-filled shape does). Same "clone geometry, make it
    // transparent-but-hit-testable" idea renderShapeElement's own hit-target
    // uses, just built fresh rather than cloning `visible` (which carries
    // the mask/gradient fill this hit-target deliberately doesn't want).
    //
    // Deliberately its OWN drag implementation, not a shared extraction
    // with renderShapeElement's nearly-identical block — duplicated here
    // rather than risking a refactor of that already-working, delicate
    // gesture code (setPointerCapture, zoom correction, temp-preview-
    // redraw-per-move) under this feature's own time constraints. Same
    // overall shape: select-on-pointerdown, drag optional, commit only if
    // the pointer actually moved, temporary preview redrawn per move via
    // this exact function calling itself.
    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("cx", String(cx));
    hit.setAttribute("cy", String(cy));
    hit.setAttribute("r", String(radiusPx));
    hit.setAttribute("fill", "transparent");
    hit.style.pointerEvents = "fill";
    hit.style.cursor = canDrag ? "move" : "pointer";
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      options.onPathClick?.(element.id, event, element.kind);
      if (!canDrag) return;
      try {
        hit.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignored — see renderShapeElement's own matching try/catch.
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
      let lastDelta = null;
      baseMapManager.setInteractionEnabled(false);
      visible.remove();
      const overlayHost = baseMapManager.getOverlayContainer();
      let preview = null;
      function drawDragPreview(dx, dy) {
        preview?.remove();
        preview = document.createElementNS(svgNS, "svg");
        preview.style.position = "absolute";
        preview.style.inset = "0";
        preview.style.width = "100%";
        preview.style.height = "100%";
        preview.style.overflow = "visible";
        preview.style.pointerEvents = "none";
        const previewOrigin = localPixelToMarkerPosition(baseMapManager, map, { x: cx + dx, y: cy + dy });
        renderLightElement(preview, baseMapManager, map, layer, { ...element, attachedMarkerId: "", origin: previewOrigin }, offset, {
          selectedElementId: element.id,
        });
        overlayHost.appendChild(preview);
      }
      drawDragPreview(0, 0);
      const onMove = (moveEvent) => {
        lastDelta = { x: (moveEvent.clientX - startX) / zoom, y: (moveEvent.clientY - startY) / zoom };
        drawDragPreview(lastDelta.x, lastDelta.y);
      };
      const onUp = (upEvent) => {
        try {
          hit.releasePointerCapture(upEvent.pointerId);
        } catch (error) {
          // Ignored — capture above may never have actually been acquired.
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        baseMapManager.setInteractionEnabled(true);
        preview?.remove();
        svg.appendChild(visible);
        if (lastDelta) {
          const nextLocalPixel = { x: cx + lastDelta.x, y: cy + lastDelta.y };
          const nextOrigin = localPixelToMarkerPosition(baseMapManager, map, nextLocalPixel);
          options.onShapeDragEnd(element.id, nextOrigin);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    svg.appendChild(hit);
  }
}

export function createVectorLayerElement(baseMapManager, map, layer, options = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("orrery-layer-vector-overlay");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.overflow = "visible";
  svg.style.pointerEvents = "none";
  const offset = getMarkerLayerOffset(map, layer);
  (layer.elements || []).forEach((element) => {
    if (element.kind === "shape") {
      renderShapeElement(svg, baseMapManager, map, layer, element, offset, options);
      return;
    }
    if (element.kind === "wall") {
      renderWallElement(svg, baseMapManager, map, layer, element, offset, options);
      return;
    }
    if (element.kind === "light") {
      renderLightElement(svg, baseMapManager, map, layer, element, offset, options);
      return;
    }
    if (element.kind !== "path" || !Array.isArray(element.points) || !element.points.length) {
      return;
    }
    const pixelPoints = element.points.map((point) => {
      const local = markerPositionToLocalPixel(baseMapManager, map, point);
      return { x: local.x + offset.x, y: local.y + offset.y };
    });
    const isSelected = options.selectedElementId === element.id;
    const pointsAttr = pixelPoints.map((point) => `${point.x},${point.y}`).join(" ");
    let visible;
    if (pixelPoints.length === 1) {
      // A single-point "path" (a click with no drag) — render as a dot
      // rather than nothing, since a polyline needs at least two points to
      // draw a visible line.
      visible = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      visible.setAttribute("cx", String(pixelPoints[0].x));
      visible.setAttribute("cy", String(pixelPoints[0].y));
      visible.setAttribute("r", String(Math.max(1, (element.strokeWidth || 2) / 2)));
      visible.setAttribute("fill", isSelected ? "#f97316" : element.strokeColor || "#0f172a");
    } else {
      visible = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      visible.setAttribute("points", pointsAttr);
      visible.setAttribute("fill", element.fillColor && element.fillColor !== "none" ? element.fillColor : "none");
      visible.setAttribute("stroke", isSelected ? "#f97316" : element.strokeColor || "#0f172a");
      visible.setAttribute("stroke-width", String(element.strokeWidth || 2));
      visible.setAttribute("stroke-linecap", "round");
      visible.setAttribute("stroke-linejoin", "round");
    }
    svg.appendChild(visible);
    if (typeof options.onPathClick === "function") {
      const hit =
        pixelPoints.length === 1
          ? document.createElementNS("http://www.w3.org/2000/svg", "circle")
          : document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      if (pixelPoints.length === 1) {
        hit.setAttribute("cx", String(pixelPoints[0].x));
        hit.setAttribute("cy", String(pixelPoints[0].y));
        hit.setAttribute("r", String(Math.max(8, (element.strokeWidth || 2) / 2 + 6)));
      } else {
        hit.setAttribute("points", pointsAttr);
        hit.setAttribute("fill", "none");
        hit.setAttribute("stroke-width", String((element.strokeWidth || 2) + 14));
        hit.setAttribute("stroke-linecap", "round");
        hit.setAttribute("stroke-linejoin", "round");
      }
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("fill", hit.getAttribute("fill") || "transparent");
      hit.style.pointerEvents = pixelPoints.length === 1 ? "fill" : "stroke";
      hit.style.cursor = "pointer";
      hit.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onPathClick(element.id, event, element.kind);
      });
      svg.appendChild(hit);
    }
  });
  return svg;
}

// --- Groups (grid-cell highlight sets) -----------------------------------
// Orrery-authoring concept (a named set of cells, e.g. "the goblin camp") —
// rendering-relevant only for the group-cell highlight overlay above, which
// only ever draws when a caller passes an `activeGroup` (Orrery only; the
// widget has no group-selection concept and never does).

export function normalizeGroupMembers(group) {
  return (group.elementIds || []).map((entry) => {
    if (typeof entry === "string") {
      return { elementId: entry };
    }
    return entry || {};
  });
}

export function findGridCellById(layer, elementId) {
  return layer.elements?.find((element) => element.kind === "cell" && element.id === elementId) || null;
}

export function getGroupCellsForLayer(group, layer) {
  const members = normalizeGroupMembers(group);
  const selections = [];
  members.forEach((member) => {
    if (member.kind !== "grid-cell" || member.layerId !== layer.id) {
      return;
    }
    const cell = findGridCellById(layer, member.elementId);
    if (!cell) {
      return;
    }
    selections.push(createGridCellSelectionEntry(layer, cell.coord));
  });
  return selections;
}

// --- Layer wrapper + top-level orchestrator -------------------------------

export function getLayerPositionScale() {
  return 1;
}

export function getLayerSizeScale() {
  return 1;
}

export function getLayerRenderPosition(layer, scale) {
  return { x: (layer.position?.x || 0) * scale, y: (layer.position?.y || 0) * scale };
}

function createLayerWrapper(map, layer, isSelected) {
  const wrapper = document.createElement("div");
  wrapper.className = "orrery-layer-item";
  if (isSelected) {
    wrapper.classList.add("is-selected");
  }
  const offsetX = layer.position?.x || 0;
  const offsetY = layer.position?.y || 0;
  // Marker and vector layers both fold layer.position into each of their
  // own elements'/points' pixel positions instead (getMarkerLayerOffset,
  // used by both getMarkerElementPixelPosition above and
  // createVectorLayerElement's own per-point offset) — same "layer position
  // is a pan offset added on top of each element's own coordinate"
  // convention grid cells use via getGridOffset — so the wrapper itself must
  // stay untransformed for either, or the offset would apply twice.
  // Grid also folds layer.position into itself (backgroundPosition, via
  // getGridOffset/getGridBackgroundPosition below) — excluded here for the
  // same "or the offset would apply twice" reason marker/vector already
  // are. Confirmed as a real bug before this: a grid layer on an image/
  // canvas base map got layer.position applied to BOTH this wrapper's own
  // translate AND its background-position, so the visible grid moved 2x
  // whatever Position X/Y actually said.
  if (!isTileBaseMap(map) && layer.type !== "marker" && layer.type !== "vector" && layer.type !== "grid") {
    wrapper.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }
  wrapper.dataset.layerId = layer.id;
  return wrapper;
}

// The single "render every visible layer" entry point both Orrery and the
// Dashboard Map widget call.
//
// `options`:
// - `viewerTier`, `hasFullAccess` — tiered-visibility filter (computeVisibleLayerIds).
// - `selection` — Orrery-only: `{kind: "layer"|"grid-cells"|"marker-element"|"group", id, layerId, cells}`.
//   Omitted (or null) means nothing renders as selected and no layer gets
//   the whole-layer drag handle — exactly the widget's case.
// - `activeGroup` — Orrery-only: the currently-selected group record, for
//   its cells' highlight overlay on grid layers.
// - `onGridCellPointerDown(layer, coord, event)` — Orrery-only.
// - `onMarkerLayerEmptyClick(layer, position, event)` — Orrery-only ("place
//   a new marker here").
// - `isMarkerDraggable(layer, markerElement)` — which markers can be
//   dragged; omitted means every marker is draggable (Orrery's authoring
//   default). The widget passes one that's only true for the viewer's own
//   claimed character's marker.
// - `onMarkerDragStart(layer, markerElement, dotEl)`, `onMarkerDragEnd(layer, markerElement, nextPosition)`.
// - `onVectorPathClick(layer, elementId, event)` — Orrery-only, select a
//   drawn path or AoE shape (only wired once that path/shape's own layer is
//   selection-selected — see createVectorLayerElement's own isSelected gate).
// - `onShapeDragEnd(layer, elementId, nextOrigin)` — Orrery-only, AoE shapes
//   only (drawn paths have no drag-to-move): reposition a shape after a
//   drag gesture ends. Same isSelected gate as onVectorPathClick.
// - `renderLayerHandle(wrapper, layer, element)` — Orrery-only: append +
//   wire the whole-layer drag handle for whichever layer is `selection`-selected.
export function renderMapLayers(overlay, baseMapManager, map, options = {}) {
  if (!overlay) return;
  overlay.innerHTML = "";
  const visibleLayerIds = computeVisibleLayerIds(map, options.viewerTier ?? "free", options.hasFullAccess ?? false);
  const selection = options.selection || null;
  (map.layers || []).forEach((layer) => {
    if (!layer.visible) return;
    if (visibleLayerIds && !visibleLayerIds.has(layer.id)) return;
    const isLayerSelected = selection?.kind === "layer" && selection.id === layer.id;
    const isGridCellsSelected = selection?.kind === "grid-cells" && selection.layerId === layer.id;
    const isMarkerElementSelected = selection?.kind === "marker-element" && selection.layerId === layer.id;
    const isVectorPathSelected = selection?.kind === "vector-path" && selection.layerId === layer.id;
    const isSelected = isLayerSelected || isGridCellsSelected || isMarkerElementSelected || isVectorPathSelected;
    const groupCells = options.activeGroup ? getGroupCellsForLayer(options.activeGroup, layer) : [];
    const wrapper = createLayerWrapper(map, layer, isSelected);
    let element = null;
    const layerPosition = getLayerRenderPosition(layer, getLayerPositionScale());
    const renderState = isTileBaseMap(map) ? { position: layerPosition, sizeScale: getLayerSizeScale() } : {};
    if (layer.type === "grid") {
      // Group's own "paint cells" tool (app.js) arms exactly ONE layer at a
      // time (options.paintTargetLayerId) — every other grid layer renders
      // completely normally regardless, same "only the thing you actually
      // armed responds" precedent Draw/Shape/Measure already follow.
      const isPaintTarget = Boolean(options.paintModeActive) && options.paintTargetLayerId === layer.id;
      element = createGridLayerElement(baseMapManager, map, layer, {
        isInteractive: isSelected || isPaintTarget,
        selectedCells: isGridCellsSelected ? selection.cells : [],
        groupCells,
        hasFullAccess: options.hasFullAccess ?? false,
        onPointerDown: options.onGridCellPointerDown ? (coord, event) => options.onGridCellPointerDown(layer, coord, event) : undefined,
        paintMode: isPaintTarget,
        onPointerPaint: isPaintTarget && options.onGridCellPaint ? (coord, event) => options.onGridCellPaint(layer, coord, event) : undefined,
        onPointerPaintEnd: isPaintTarget ? options.onGridCellPaintEnd : undefined,
        // Threaded straight through to resolveRevealedCells' own
        // character-vision auto-reveal loop — see resolveMarkerVisionRangeCells's
        // own header comment for why this has to be a synchronous,
        // cache-backed callback rather than a fetch this module does itself.
        getCharacterPayload: options.getCharacterPayload,
      });
    } else if (layer.type === "raster") {
      element = createRasterLayerElement(layer, renderState);
    } else if (layer.type === "marker") {
      element = createMarkerLayerElement(baseMapManager, map, layer, {
        isInteractive: isSelected,
        selectedElementId: isMarkerElementSelected ? selection.id : null,
        isMarkerDraggable: options.isMarkerDraggable ? (markerElement) => options.isMarkerDraggable(layer, markerElement) : undefined,
        onEmptyClick: options.onMarkerLayerEmptyClick ? (position, event) => options.onMarkerLayerEmptyClick(layer, position, event) : undefined,
        onMarkerDragStart: options.onMarkerDragStart,
        onMarkerDragEnd: options.onMarkerDragEnd,
        // Never passed from Orrery's own app.js — see beginMarkerDrag's own
        // header comment for why free GM authoring must stay unrestricted.
        resolveMarkerMoveBlocked: options.resolveMarkerMoveBlocked,
      });
    } else {
      element = createVectorLayerElement(baseMapManager, map, layer, {
        selectedElementId: isVectorPathSelected ? selection.id : null,
        // isSelected, not isLayerSelected alone — once a path IS selected,
        // selection.kind becomes "vector-path", not "layer" anymore, so
        // isLayerSelected alone would go false the instant you select a
        // path and never come back true without re-clicking the layer in
        // the left pane first. Confirmed as a real bug: every path but the
        // first became unclickable after selecting one. isSelected (which
        // isVectorPathSelected already feeds into) stays true across a
        // path-to-path reselection the same way marker-to-marker
        // reselection already works via isMarkerElementSelected.
        // `kind` ("shape" vs "path", from renderShapeElement's own 3rd arg
        // to options.onPathClick) has to be forwarded through here too —
        // dropping it silently meant app.js's own onVectorPathClick always
        // saw kind===undefined for a shape click, took its "else" branch
        // (the full, rebuilding setSelection()) instead of the lightweight
        // selectShapeElementForDrag() meant for exactly this case. That
        // rebuild ran INSIDE the still-executing pointerdown handler,
        // before any of renderShapeElement's own drag-hiding code — every
        // later line in that handler (setPointerCapture, visible.remove(),
        // the live preview, svg.appendChild(visible) on release) then
        // operated on the now-orphaned OLD svg/visible/hit the rebuild had
        // already replaced. Confirmed as the actual cause of "the original
        // shape stays visible until the drag is dropped" — the thing on
        // screen the whole time was the freshly re-rendered copy, which
        // none of that drag-hiding code ever touched.
        onPathClick: isSelected && options.onVectorPathClick ? (elementId, event, kind) => options.onVectorPathClick(layer, elementId, event, kind) : undefined,
        // AoE shapes only — drawn paths have no drag-to-move (they're
        // terrain-style annotations, rarely repositioned after drawing;
        // shapes are transient tactical indicators, meant to move as combat
        // does). Same isSelected gate as onPathClick — a shape only becomes
        // draggable once its own layer is selected from the left pane.
        onShapeDragEnd: isSelected && options.onShapeDragEnd ? (elementId, nextOrigin) => options.onShapeDragEnd(layer, elementId, nextOrigin) : undefined,
        // Doors only, and NEVER gated on isSelected — the Dashboard widget
        // (the only real caller of this) has no layer-selection concept at
        // all (it never passes `selection`), so an isSelected gate here
        // would mean door-click-to-open silently never fires for a player.
        onDoorClick: options.onDoorClick ? (elementId, event) => options.onDoorClick(layer, elementId, event) : undefined,
        // Threaded through so renderWallElement can decide whether to
        // reveal a secret door's own distinguishing tick (GM/owner only —
        // see createFogOverlay's own identical ownerPreview asymmetry).
        hasFullAccess: options.hasFullAccess ?? false,
        // Whole-wall drag + per-vertex handles — same isSelected gate as
        // onShapeDragEnd (a wall only becomes draggable/reshapeable once its
        // own layer is selected from the left pane); handles themselves are
        // additionally gated on THIS wall being the current selection
        // (renderWallElement's own isSelected check), not just the layer.
        onWallDragEnd: isSelected && options.onWallDragEnd ? (elementId, nextPoints) => options.onWallDragEnd(layer, elementId, nextPoints) : undefined,
        onWallVertexDragEnd:
          isSelected && options.onWallVertexDragEnd
            ? (elementId, vertexIndex, nextPoint) => options.onWallVertexDragEnd(layer, elementId, vertexIndex, nextPoint)
            : undefined,
      });
    }
    if (element) {
      element.style.opacity = String(layer.opacity ?? 1);
      wrapper.appendChild(element);
      if (isLayerSelected && layer.visible && typeof options.renderLayerHandle === "function") {
        options.renderLayerHandle(wrapper, layer, element);
      }
      overlay.appendChild(wrapper);
    }
  });
}
