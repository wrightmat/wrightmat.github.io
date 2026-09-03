// The shared map-rendering core for a BaseMapManager-driven map — used by
// Orrery's own authoring surface AND the Dashboard's read-only Map widget
// (common/js/lib/widgets/map.js), so there's exactly one implementation of
// every layer type's rendering, the tiered-visibility filter, the marker
// coordinate math, and the pixel-drag mechanics, not two copies that could drift.
//
// Everything caller-specific stays out of this module as callbacks instead:
// undo-stack recording, inspector selection, click-selection semantics,
// "click empty space to place a marker," whole-layer drag — all authoring-
// only concerns that simply never fire when a caller (the Dashboard widget)
// doesn't supply the callback, which is why omitting `selection`/
// `activeGroup` is enough to get a plain, non-interactive render.

import { getIconTokens } from "../../../common/js/lib/icon-picker.js";
import { resolveBinding } from "../../../common/js/lib/bindings.js";
import { evaluateFormula } from "../../../common/js/lib/formula-engine.js";
import { allowsDelete } from "../../../common/js/lib/ownership.js";
import { buildKindToolUrl, kindToolLabel } from "../../../common/js/lib/kind-tool-route.js";
import { resolveImageDimension } from "./base-maps.js";
import { getDefaultView as getTypeDefaultView, createMarkerOverlayIcon } from "./map-model.js";
import { getPresetById } from "../../../common/js/lib/shape-effect-library.js";

// A referenced marker's own "open the real thing" link — shared by both
// restricted-viewer consumers (the Dashboard widget, Orrery's view-mode
// path) so it always resolves the same way. Only needs refId plus, for a
// journal reference, the selected heading/quest anchor (refAnchor) — never
// a fetch of the full referenced record.
export function resolveMarkerLinkTarget(markerElement) {
  if (!markerElement?.refKind || !markerElement?.refId) return null;
  const extraParams =
    markerElement.refKind === "journal" && markerElement.refAnchor?.value
      ? { heading: markerElement.refAnchor.value }
      : undefined;
  const url = buildKindToolUrl(markerElement.refKind, markerElement.refId, { extraParams });
  if (!url) return null;
  return { url, toolLabel: kindToolLabel(markerElement.refKind) };
}

// Returns null when nothing should be filtered (hasFullAccess) — the map's
// owner/admin always sees everything. Otherwise `{ layers: Set, elements: Set }`,
// the union of hiddenLayerIds/hiddenElementIds across every View whose `tiers`
// is empty (applies to everyone) or includes viewerTier. Both are DENY-lists,
// not allow-lists — a map with no authored Views naturally yields two empty
// Sets ("nothing hidden"), and a freshly auto-created View can never
// accidentally hide something nobody unchecked.
export function computeHiddenIds(map, viewerTier, hasFullAccess) {
  if (hasFullAccess) return null;
  const applicableViews = (map.views || []).filter((view) => !view.tiers?.length || view.tiers.includes(viewerTier));
  const layers = new Set();
  const elements = new Set();
  applicableViews.forEach((view) => {
    (view.hiddenLayerIds || []).forEach((id) => layers.add(id));
    (view.hiddenElementIds || []).forEach((id) => elements.add(id));
  });
  return { layers, elements };
}

export function isTileBaseMap(map) {
  return map.baseMap?.type === "tile";
}

// Image/canvas base maps live inside PanZoomController's own CSS
// `scale(zoom)` transform — everything under it is positioned in PRE-scale
// content-space pixels, which the ambient transform renders correctly for
// free. But converting a raw event.clientX/clientY (a POST-scale real
// screen pixel) back into content-space — "where did the user click" —
// has to divide by the current zoom first, or it's off by that factor once
// zoom drifts from 1. Tile maps need no such division — Leaflet's own
// layerPoint space already accounts for zoom internally, which is why
// their call sites below never call this.
function getNonTileZoom(baseMapManager) {
  return baseMapManager?.getView?.()?.zoom || 1;
}

// A marker's stored position shape depends on the base map it was placed on
// (lat/lng for tile, flat x/y for image/canvas). A marker placed before the
// map's base map type later changed carries the OLD shape, which
// markerPositionToLocalPixel can't project and would otherwise fall back to
// a meaningless (0,0) phantom dot — skipped here so a stale marker just
// doesn't render, instead of appearing wrongly-placed.
function hasValidMarkerPosition(map, position) {
  if (isTileBaseMap(map)) {
    return Number.isFinite(position?.lat) && Number.isFinite(position?.lng);
  }
  return Number.isFinite(position?.x) && Number.isFinite(position?.y);
}

// Layer position is a whole-layer pan offset on top of each marker's own
// coordinate. Tile maps don't use this — every marker carries a real
// {lat, lng}, so a manual "drag the whole layer" offset has no coherent
// meaning there.
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
// at the zoom it was placed at, since Leaflet resets its internal pixel
// origin on zoom rather than rescaling existing content. layerPoint stays
// correctly anchored to the map's pixel origin; the enclosing Leaflet
// pane's own transform supplies the pan, like any built-in Leaflet layer.
//
// Image/canvas maps keep the flat {x, y} model: their overlay lives inside
// the same CSS-transformed element PanZoomController pans/scales, so a
// local pixel coordinate already tracks pan/zoom for free.
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

// Converts a raw pointer event into a map-space position (a marker
// element's own `position` shape) — the same tile-vs-flat branching
// createMarkerLayerElement's onEmptyClick does, extracted so a
// layer-independent caller (Orrery's click-to-ping tool) can reuse it.
// `referenceContainer` is baseMapManager's own overlay container, not any
// one layer's.
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

// Drag operates in plain screen-pixel deltas for TILE maps (Leaflet's
// layerPoint space is 1 unit per CSS pixel at the current zoom, so a raw
// mouse delta already IS a layerPoint delta) but divides by zoom first for
// image/canvas maps — dotEl lives inside PanZoomController's scale(zoom)
// transform, so its left/top are content-space pixels, and a raw
// post-scale mouse delta applied there overshoots by the zoom factor.
// Converts the final pixel back to the marker's stored representation
// (lat/lng or x/y) once the gesture ends. `onDragEnd(nextPosition)` only
// fires if the gesture actually moved the marker — a plain click is a
// no-op (callers wanting "select on click" pass `onDragStart` instead,
// called unconditionally before tracking begins).
//
// `isMoveBlocked(fromPixel, toPixel)`, if supplied, is checked on every
// pointermove — if the segment crosses a blocking wall/closed-door, that
// frame's move is skipped (dotEl stays at lastPixel), giving a natural
// "stops at the wall" feel without vector-sliding geometry. Only the
// Dashboard widget's player-token drag passes this; Orrery's own free-drag
// authoring surface never does — a GM must drag tokens through walls
// while setting up a scene.
function beginMarkerDrag(event, baseMapManager, map, layer, markerElement, dotEl, { onDragEnd, isMoveBlocked, onClick } = {}) {
  // Best-effort — some browsers throw InvalidStateError capturing in
  // certain DOM positions; the window-level listeners below track the
  // gesture regardless, capture is just a "stay locked" nicety on top.
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
    } else {
      // The pointer never moved — a plain click/tap, not a drag. Distinct
      // from onDragEnd so a caller can tell "select this marker" apart from
      // "it moved." Passes dotEl so a click-to-edit popover can anchor to
      // the actual on-screen marker.
      onClick?.(dotEl);
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// A transient, self-removing ping dot — appended into baseMapManager's own
// overlay container (pings are layer-independent) at the given map-space
// position, detached automatically after its fade-out animation
// (orrery/css/styles.css's `.orrery-ping` keyframes) finishes. `label`, if
// given, renders as a small "who pinged" caption.
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
  // unrelated to the grid. Falls back to the layer's own Size setting only
  // when there's no grid layer to size against.
  //
  // Deliberately NOT filtered on the grid layer's own visibility — Visible
  // toggles the grid LINES, not the map's real scale/cell size, so markers
  // (and AoE shapes, see resolveShapePixelsPerCell below) must stay the
  // same size whether or not the GM has the grid layer hidden.
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  const cellSize = gridLayer ? getGridCellSize(baseMapManager, map, gridLayer) : layer.settings?.size || 24;
  // sizeCells is a per-marker multiplier on the grid's own cell size — 1
  // (one-square token) by default, a no-op for markers predating this field.
  const sizeCells = Number.isFinite(markerElement.sizeCells) && markerElement.sizeCells > 0 ? markerElement.sizeCells : 1;
  const size = cellSize * sizeCells;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  // Centering comes from the .orrery-layer-marker-overlay CSS rule;
  // dot.style.left/top below overrides its 50%/50% anchor with this
  // element's own pixel position, so the dot's center lands on that pixel.
  const ringColor = layer.settings?.color || "#0ea5e9";
  // "square" (createMarkerElement) fills the cell edge-to-edge with sharp
  // corners instead of the circular clip — applied to both `dot` (border +
  // the CSS class's border-radius: 999px) and `face` below, so an object
  // token's art isn't cropped into a circle it was never drawn for.
  const isSquare = markerElement.shape === "square";
  dot.style.borderRadius = isSquare ? "0" : "999px";
  // Outline reads from the layer's configured settings (always a real
  // value, never unconfigured); markerElement.outlineColor overrides it
  // for THIS marker only. showOutline defaults to true — turning it off
  // (an object token needing a clean edge-to-edge fill) must also zero the
  // CSS class's always-on box-shadow ring, not just the border, or the
  // ring stays visible with nothing overriding it.
  if (markerElement.showOutline === false) {
    dot.style.borderWidth = "0px";
    // The .is-selected rule's own selection ring is also a box-shadow — an
    // inline style always wins over a class selector, so clearing this
    // unconditionally would swallow the selection highlight too.
    // Reproduce that ring's value inline when selected instead.
    dot.style.boxShadow = options.selected ? "0 0 0 3px rgba(14, 165, 233, 0.9)" : "none";
  } else {
    dot.style.borderColor = markerElement.outlineColor || layer.settings?.outlineColor || "#0f172a";
    dot.style.borderWidth = `${Number.isFinite(layer.settings?.outlineWidth) ? layer.settings.outlineWidth : 2}px`;
  }
  // Per-marker only, no layer-wide equivalent — falls back to 1 only for a
  // marker saved before this field existed.
  dot.style.opacity = String(Number.isFinite(markerElement.opacity) ? markerElement.opacity : 1);
  // Off-the-ground visual cue — positive (flying) gets a blurred shadow,
  // negative (burrowing) gets a dashed outline; a floating token and one
  // obscured beneath the map don't read the same way, so this isn't one
  // style with a sign flip.
  //
  // The shadow must sit BEHIND the token's own fill, but a box's own
  // background is always the bottom-most paint layer beneath every child
  // regardless of z-index — so the fill lives on `face`, a separate child
  // appended AFTER the shadow; same-stacking-level children paint in tree
  // order, so face correctly lands on top and the shadow's overflow reads
  // as sitting behind the token.
  const heightCells = Number.isFinite(markerElement.heightCells) ? markerElement.heightCells : 0;
  if (heightCells > 0) {
    const shadowSize = size * 1.05;
    const shadowOffset = Math.min(heightCells * size * 0.05, size * 0.35);
    const shadow = document.createElement("div");
    shadow.className = "orrery-marker-height-shadow";
    shadow.style.position = "absolute";
    shadow.style.width = `${shadowSize}px`;
    shadow.style.height = `${shadowSize}px`;
    shadow.style.left = `${(size - shadowSize) / 2 + shadowOffset}px`;
    shadow.style.top = `${(size - shadowSize) / 2 + shadowOffset}px`;
    shadow.style.borderRadius = isSquare ? "0" : "50%";
    shadow.style.background = "rgba(0, 0, 0, 0.35)";
    shadow.style.filter = `blur(${Math.max(3, size * 0.08)}px)`;
    shadow.style.pointerEvents = "none";
    dot.appendChild(shadow);
  } else if (heightCells < 0) {
    dot.style.borderStyle = "dashed";
  }
  // Per-marker image supersedes the layer's flat color/icon dot entirely —
  // see map-model.js's createMarkerElement for how `image` gets set. A
  // real <img>, not a background-image div, so Square shape can size off
  // the browser's own intrinsic width/height instead of a fixed square box
  // — background-size:cover would otherwise crop a non-square image's
  // longer axis to force it to fill a square.
  let face;
  if (markerElement.image) {
    face = document.createElement("img");
    face.className = "orrery-marker-face";
    face.src = markerElement.image;
    face.alt = "";
    // Browsers make <img> natively draggable by default — a non-draggable
    // marker's own click listener only calls preventDefault() on "click",
    // too late to stop a few pixels of mouse jitter starting a native
    // HTML5 image-drag instead, which then never fires "click" at all. The
    // draggable marker path
    // never hit this (its own pointerdown already calls preventDefault
    // before any native drag could start), which is exactly why only
    // non-draggable, image-having markers (a treasure pile, say) went
    // completely silent on click.
    face.draggable = false;
    face.style.position = "absolute";
    face.style.borderRadius = isSquare ? "0" : "999px";
    if (isSquare) {
      // Centered within `dot`'s own size×size footprint regardless of the
      // image's own final rendered box — its LARGER dimension is capped at
      // `size` (this cell's own pixel size), the smaller one scales down
      // with it, so the whole image stays visible with nothing cropped.
      face.style.top = "50%";
      face.style.left = "50%";
      face.style.transform = "translate(-50%, -50%)";
      face.style.maxWidth = `${size}px`;
      face.style.maxHeight = `${size}px`;
      face.style.width = "auto";
      face.style.height = "auto";
    } else {
      // Circle keeps the original fill-and-crop look — a portrait ringed
      // with the layer's own color, cropped to fill rather than
      // letterboxed, same as this always rendered before Square existed.
      face.style.inset = "0";
      face.style.width = "100%";
      face.style.height = "100%";
      face.style.objectFit = "cover";
      face.style.objectPosition = "center";
    }
  } else {
    face = document.createElement("div");
    face.className = "orrery-marker-face";
    face.style.position = "absolute";
    face.style.inset = "0";
    face.style.borderRadius = isSquare ? "0" : "999px";
    face.style.backgroundColor = ringColor;
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
      face.appendChild(icon);
      face.classList.add("d-flex", "align-items-center", "justify-content-center");
    }
  }
  dot.appendChild(face);
  const draggable = options.draggable !== false;
  // Clickable whenever draggable OR a plain-click handler exists — not
  // draggable alone, or pointer-events would silently eat clicks (never
  // reaching the listener below) on anything a restricted viewer can't drag.
  const clickable = draggable || Boolean(options.onClick);
  dot.style.pointerEvents = clickable ? "auto" : "none";
  dot.style.cursor = clickable ? "pointer" : "default";
  const pixelPosition = getMarkerElementPixelPosition(baseMapManager, map, layer, markerElement);
  dot.style.left = `${pixelPosition.x}px`;
  dot.style.top = `${pixelPosition.y}px`;
  // Live Marker Resource Bar — resolved outside this function, passed via
  // options, same live-data-lookup contract as options.resolveConditionIcons.
  // `resourceBarHeight` is computed here so the label block below can stack
  // further out when both render "above" the same marker. Sized off
  // `cellSize` (one grid cell), NOT `size` (cellSize * sizeCells) — a
  // bigger monster's multi-cell token shouldn't get a proportionally
  // bigger bar, unlike labels/badges which deliberately do scale with footprint.
  const resourceBar = options.resolveResourceBar ? options.resolveResourceBar(markerElement) : null;
  const resourceBarHeight = Math.max(4, Math.round(cellSize * 0.14));
  if (resourceBar && typeof resourceBar.max === "number" && resourceBar.max > 0) {
    const barWidth = Math.max(cellSize * 0.9, 20);
    const bar = document.createElement("div");
    bar.className = "orrery-marker-resource-bar";
    bar.style.width = `${barWidth}px`;
    bar.style.height = `${resourceBarHeight}px`;
    if (resourceBar.label) bar.title = `${resourceBar.label}: ${resourceBar.current} / ${resourceBar.max}`;
    const fraction = Math.max(0, Math.min(1, resourceBar.current / resourceBar.max));
    const fill = document.createElement("div");
    fill.className = "orrery-marker-resource-bar-fill";
    fill.style.width = `${Math.round(fraction * 100)}%`;
    // Green above half, amber above a quarter, red at/below a quarter —
    // the same 3-stop convention Combat Tracker's own HP display already
    // uses, so a GM reads "this token is in trouble" identically whether
    // they're looking at the tracker row or the map.
    fill.style.backgroundColor = fraction > 0.5 ? "#22c55e" : fraction > 0.25 ? "#f59e0b" : "#ef4444";
    bar.appendChild(fill);
    dot.appendChild(bar);
  }
  if (markerElement.label) {
    dot.title = markerElement.label;
    if (layer.settings?.showLabels) {
      // A child of `dot`, riding along with its content-space/ambient-scale
      // positioning — labelSize means content-space pixels, growing/
      // shrinking with zoom like the marker's own size, not fixed on-screen.
      const label = document.createElement("span");
      const labelPosition = layer.settings.labelPosition === "above" || layer.settings.labelPosition === "over" ? layer.settings.labelPosition : "below";
      label.className = `orrery-marker-label orrery-marker-label--${labelPosition}`;
      label.textContent = markerElement.label;
      const labelSize = Number.isFinite(layer.settings.labelSize) && layer.settings.labelSize > 0 ? layer.settings.labelSize : 12;
      label.style.fontSize = `${labelSize}px`;
      // The Marker Resource Bar above already occupies the label's own
      // default "above" spot (.orrery-marker-label--above's bottom:
      // calc(100% + 4px)) — bump the label further out past it so the two
      // stack (label, then bar, then the token) instead of overlapping
      // illegibly.
      if (labelPosition === "above" && resourceBar) {
        label.style.bottom = `calc(100% + ${resourceBarHeight + 8}px)`;
      }
      dot.appendChild(label);
    }
  }
  // Condition/status badges (map-model.js's createMarkerOverlayIcon) — a row
  // along the marker's bottom edge, sized off the same `size` as the dot.
  // Manually-authored overlayIcons and auto-resolved condition icons
  // (options.conditionIcons) render through this same row, concatenated,
  // not merged into markerElement's own stored array — removing a
  // condition badge here would just reappear next render unless the actual
  // condition (Combat Tracker, character-vitals widget) is removed.
  // A synthetic, never-stored badge so a container still holding unclaimed
  // loot reads at a glance through this same row. Gone once contents.length
  // hits 0. GM-only — a bookkeeping cue, not something that should tip
  // players off to a hidden container's contents before they click it.
  const contentsBadge = options.isGMViewer && markerElement.contents?.length
    ? [{ icon: "tabler:package", color: "#92400e", label: "Contains unclaimed loot" }]
    : [];
  const badgeEntries = [...contentsBadge, ...(markerElement.overlayIcons || []), ...(options.conditionIcons || [])];
  if (badgeEntries.length) {
    const badgeRow = document.createElement("div");
    badgeRow.className = "orrery-marker-overlay-icons";
    const badgeSize = Math.max(10, size * 0.32);
    badgeEntries.forEach((entry) => {
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
        const ddbToken = iconTokens.find((token) => token.startsWith("ddb-"));
        icon.style.fontSize = `${badgeSize * 0.65}px`;
        if (entry.isCondition && ddbToken) {
          // Condition icons are genuinely two-tone source art (e.g.
          // Charmed's "C" is a white path over a dark one, both fully
          // opaque) — the shared ddb-icons.css mask only sees alpha, not
          // RGB, so it can't distinguish the two and collapses them into
          // one silhouette. Painting the icon's --ddb-icon SVG as a real
          // multi-color background-image instead preserves the detail —
          // done only here (auto-resolved condition badges), since a GM's
          // manually-picked overlay badge is usually single-tone and meant
          // to be recolored via `color`.
          icon.className = ddbToken;
          icon.style.mask = "none";
          icon.style.webkitMask = "none";
          icon.style.backgroundColor = "transparent";
          icon.style.backgroundImage = "var(--ddb-icon)";
          icon.style.backgroundSize = "contain";
          icon.style.backgroundRepeat = "no-repeat";
          // Explicit pixel width/height, not the shared rule's em-relative
          // `1em` — this is a real box background-size:contain sizes into.
          // 0.86 not 0.65 — these SVGs have breathing room in their own
          // viewBox, so 0.65 didn't fill the circle; ~0.71 of the diameter
          // is the inscribed-square ceiling, and this art stays inside it.
          icon.style.width = `${badgeSize * 0.86}px`;
          icon.style.height = `${badgeSize * 0.86}px`;
          icon.style.backgroundPosition = "center";
          // These SVGs use a square viewBox matching this square icon box,
          // so `contain` fills both dimensions with no letterboxed slack —
          // background-position is a no-op here. A small rightward
          // `transform` shifts the image directly instead, scaling with
          // badgeSize to correct the art's own off-center viewBox content.
          icon.style.transform = `translateX(${badgeSize * 0.06}px)`;
        } else {
          icon.className = bootstrapToken ? `bi ${bootstrapToken}` : iconTokens.join(" ");
        }
        badge.appendChild(icon);
      } else if (entry.isCondition && entry.label) {
        // A free-text tag with no matching System Condition icon (tags are
        // deliberately open-ended) — falls back to the tag's own text so an
        // arbitrary GM-typed tag still shows something. Grows to fit the
        // text (ellipsized past a cap; the full tag is on the badge's hover
        // title) instead of staying the fixed icon-badge circle. Black text
        // on white (set in resolveMarkerConditionIcons) to read as the same
        // family as the authored condition icons' own white badges.
        const textMaxWidth = Math.max(60, badgeSize * 5);
        badge.style.width = "auto";
        badge.style.maxWidth = `${textMaxWidth}px`;
        badge.style.padding = "0 6px";
        const text = document.createElement("span");
        text.textContent = entry.label;
        text.style.display = "inline-block";
        text.style.maxWidth = "100%";
        text.style.overflow = "hidden";
        text.style.textOverflow = "ellipsis";
        text.style.whiteSpace = "nowrap";
        text.style.fontSize = `${badgeSize * 0.5}px`;
        text.style.fontWeight = "600";
        text.style.color = "#000";
        text.style.lineHeight = "1";
        badge.appendChild(text);
      }
      badgeRow.appendChild(badge);
    });
    dot.appendChild(badgeRow);
  }
  // GM-only cue (never set for a restricted viewer — a truly hidden marker
  // isn't in the DOM at all) — a dimmed dot plus a small "eye-off" corner
  // badge, so a GM sees at a glance which tokens are hidden from players.
  // Placed at the top edge so it never collides with the height badge below.
  if (options.hiddenFromPlayers) {
    dot.style.opacity = String((Number.isFinite(markerElement.opacity) ? markerElement.opacity : 1) * 0.5);
    const hiddenBadge = document.createElement("span");
    hiddenBadge.className = "orrery-marker-hidden-badge";
    hiddenBadge.title = "Hidden from players";
    hiddenBadge.style.position = "absolute";
    hiddenBadge.style.top = "-4px";
    hiddenBadge.style.right = "-4px";
    hiddenBadge.style.width = `${Math.max(10, size * 0.32)}px`;
    hiddenBadge.style.height = `${Math.max(10, size * 0.32)}px`;
    hiddenBadge.style.borderRadius = "50%";
    hiddenBadge.style.background = "#1e293b";
    hiddenBadge.style.display = "flex";
    hiddenBadge.style.alignItems = "center";
    hiddenBadge.style.justifyContent = "center";
    hiddenBadge.style.pointerEvents = "none";
    const hiddenIcon = document.createElement("span");
    hiddenIcon.className = "iconify";
    hiddenIcon.dataset.icon = "tabler:eye-off";
    hiddenIcon.setAttribute("aria-hidden", "true");
    hiddenIcon.style.fontSize = `${Math.max(8, size * 0.22)}px`;
    hiddenIcon.style.color = "#fff";
    hiddenBadge.appendChild(hiddenIcon);
    dot.appendChild(hiddenBadge);
  }
  // World-state cue, unlike "hidden from players" above — shown to EVERY
  // viewer, since a flying/burrowing creature should read that way to
  // players too. Opposite corner (top-left) so it never collides with the
  // hidden badge on a marker that's both.
  if (heightCells !== 0) {
    const heightBadge = document.createElement("span");
    heightBadge.className = "orrery-marker-height-badge";
    heightBadge.title = heightCells > 0 ? `${heightCells} cell${heightCells === 1 ? "" : "s"} up` : `${Math.abs(heightCells)} cell${heightCells === -1 ? "" : "s"} down`;
    heightBadge.style.position = "absolute";
    heightBadge.style.top = "-4px";
    heightBadge.style.left = "-4px";
    heightBadge.style.minWidth = `${Math.max(10, size * 0.28)}px`;
    heightBadge.style.height = `${Math.max(10, size * 0.28)}px`;
    heightBadge.style.borderRadius = "999px";
    heightBadge.style.padding = "0 3px";
    heightBadge.style.background = "#1e293b";
    heightBadge.style.display = "flex";
    heightBadge.style.alignItems = "center";
    heightBadge.style.justifyContent = "center";
    heightBadge.style.gap = "1px";
    heightBadge.style.pointerEvents = "none";
    const heightIcon = document.createElement("span");
    heightIcon.className = "iconify";
    heightIcon.dataset.icon = heightCells > 0 ? "tabler:arrow-up" : "tabler:arrow-down";
    heightIcon.setAttribute("aria-hidden", "true");
    heightIcon.style.fontSize = `${Math.max(7, size * 0.19)}px`;
    heightIcon.style.color = "#fff";
    heightBadge.appendChild(heightIcon);
    const heightText = document.createElement("span");
    heightText.textContent = String(Math.abs(heightCells));
    heightText.style.fontSize = `${Math.max(7, size * 0.15)}px`;
    heightText.style.color = "#fff";
    heightText.style.lineHeight = "1";
    heightBadge.appendChild(heightText);
    dot.appendChild(heightBadge);
  }
  if (draggable) {
    dot.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Ctrl/Cmd/Shift-click toggles multi-select instead of the ordinary
      // select-and-maybe-drag flow below — checked before beginMarkerDrag
      // ever runs, so a modifier-held click never starts a drag.
      if ((event.ctrlKey || event.metaKey || event.shiftKey) && options.onMultiSelectToggle) {
        options.onMultiSelectToggle(dot);
        return;
      }
      options.onDragStart?.(dot);
      beginMarkerDrag(event, baseMapManager, map, layer, markerElement, dot, {
        onDragEnd: options.onDragEnd,
        isMoveBlocked: options.isMoveBlocked,
        onClick: options.onClick,
      });
    });
  } else if (options.onClick) {
    // Not draggable, but still worth a plain click — a link-out button or a
    // Contents claim popover. A plain native "click" listener is unreliable
    // here: it requires pointerdown AND pointerup on the SAME element, and
    // with no pointer capture, ordinary hand jitter can land pointerup on a
    // neighboring element, silently killing the click. Pointer capture
    // (same technique beginMarkerDrag uses) redirects every subsequent
    // move/up event back to this element regardless of cursor drift, with
    // no actual movement/redrag logic since this marker never repositions.
    dot.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Same modifier-key multi-select toggle as the draggable branch —
      // not reached by current callers (neither passes onMultiSelectToggle),
      // kept for parity if that ever changes.
      if ((event.ctrlKey || event.metaKey || event.shiftKey) && options.onMultiSelectToggle) {
        options.onMultiSelectToggle(dot);
        return;
      }
      try {
        dot.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignored — see beginMarkerDrag's own matching try/catch for why.
      }
      const onUp = (upEvent) => {
        try {
          dot.releasePointerCapture(upEvent.pointerId);
        } catch (error) {
          // Ignored — capture above may never have actually been acquired.
        }
        dot.removeEventListener("pointerup", onUp);
        dot.removeEventListener("pointercancel", onCancel);
        options.onClick(dot);
      };
      const onCancel = () => {
        dot.removeEventListener("pointerup", onUp);
        dot.removeEventListener("pointercancel", onCancel);
      };
      dot.addEventListener("pointerup", onUp);
      dot.addEventListener("pointercancel", onCancel);
    });
  }
  return dot;
}

// Marker layers render a full-size, absolutely-positioned container (not a
// single centered dot) so each placed pin can carry its own position.
// - `isInteractive` + `onEmptyClick(position, event)`: clicking empty space
//   (Orrery-only) reports the click's map-space position.
// - `isMarkerDraggable(markerElement)`: per-marker draggability — the
//   widget passes one true only for its own claimed character's marker.
//   Orrery omits this and defaults every marker's click-to-select/drag to
//   `isInteractive` (only when this layer is selected) — same "select the
//   layer first, then its contents become clickable" convention grid cells
//   and vector paths follow, so a click-driven tool (Measure) doesn't
//   accidentally select markers underneath the cursor regardless of layer.
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
        // and returns coordinates already in the layerPoint space every
        // marker position uses.
        const leafletMap = baseMapManager.getMap();
        if (!leafletMap) return;
        const layerPoint = leafletMap.mouseEventToLayerPoint(event);
        localPixel = { x: layerPoint.x, y: layerPoint.y };
      } else {
        // getBoundingClientRect() is POST-scale (real screen pixels);
        // offset is content-space (raw, un-scaled) — dividing the
        // screen-relative part by zoom BEFORE subtracting offset keeps both
        // terms in the same units, or a newly-placed marker lands
        // down-and-right of the actual click once zoom drifts from 1.
        const rect = container.getBoundingClientRect();
        const offset = getMarkerLayerOffset(map, layer);
        const zoom = getNonTileZoom(baseMapManager);
        localPixel = { x: (event.clientX - rect.left) / zoom - offset.x, y: (event.clientY - rect.top) / zoom - offset.y };
      }
      options.onEmptyClick?.(localPixelToMarkerPosition(baseMapManager, map, localPixel), event);
    });
  }
  // Each .orrery-layer-item wrapper's own `transform` makes it a stacking
  // context root regardless of z-index, so paint order between markers on
  // one layer is decided purely by DOM append order. Draggable markers are
  // appended LAST (on top), after every non-draggable one, regardless of
  // their order in layer.elements — otherwise once a non-draggable marker
  // (a treasure container) became a real pointer-events:auto hit target,
  // whichever marker happened to sit later in `layer.elements` silently WON every
  // click/drag at any pixel the two overlapped — which, in practice, is
  // exactly where a player parks their own character token to claim a
  // treasure pile. Depending on array order that read as either "clicking
  // the treasure does nothing" (the character's own re-icon popover ate
  // the click instead) or "I can't drag my character near it" (the
  // treasure ate the drag's own pointerdown instead). Sorting the
  // draggable one to the top guarantees a viewer's own token always wins
  // pointer priority over a merely-clickable marker it's standing on.
  // Array.prototype.sort is spec-guaranteed stable, so elements within
  // each group (draggable / not) keep their original relative order.
  const visibleElements = (layer.elements || [])
    .filter((markerElement) => {
      // Skipped entirely for a viewer this marker is hidden from
      // (View-based, options.hiddenElementIds — see renderMapLayers' own
      // markerHiddenElementIds/isPrivilegedMarkerViewer for who's exempt: a
      // full-access GM in Orrery, or a map owner/admin viewing the
      // restricted widget for their own map). Combat Tracker's own
      // "visible to players" toggle writes THROUGH to this exact same View
      // data now (combat-tracker.js's own toggleCombatantHiddenFromPlayers)
      // rather than keeping a second, independent combatant.hidden flag
      // that needed its own parallel resolution here — one mechanism, one
      // place it's read.
      if (options.hiddenElementIds?.has(markerElement.id)) return false;
      if (!hasValidMarkerPosition(map, markerElement.position)) return false;
      return true;
    })
    .map((markerElement) => ({
      markerElement,
      draggable: options.isMarkerDraggable ? options.isMarkerDraggable(markerElement) : Boolean(options.isInteractive),
    }));
  visibleElements.sort((a, b) => Number(a.draggable) - Number(b.draggable));
  visibleElements.forEach(({ markerElement, draggable }) => {
    container.appendChild(
      createMarkerDot(baseMapManager, map, layer, markerElement, {
        // selectedElementIds (a Set) is the multi-select counterpart to
        // selectedElementId — Orrery's own marker-elements selection kind
        // populates it; every other caller (the widget, single-select)
        // leaves it unset, so `?.has` is simply never true for them.
        selected: options.selectedElementId === markerElement.id || Boolean(options.selectedElementIds?.has(markerElement.id)),
        draggable,
        onMultiSelectToggle: options.onMarkerMultiSelectToggle ? (dotEl) => options.onMarkerMultiSelectToggle(layer, markerElement, dotEl) : undefined,
        onDragStart: options.onMarkerDragStart ? (dotEl) => options.onMarkerDragStart(layer, markerElement, dotEl) : undefined,
        onDragEnd: options.onMarkerDragEnd ? (nextPosition) => options.onMarkerDragEnd(layer, markerElement, nextPosition) : undefined,
        isMoveBlocked: options.resolveMarkerMoveBlocked
          ? (fromPixel, toPixel) => options.resolveMarkerMoveBlocked(layer, markerElement, fromPixel, toPixel)
          : undefined,
        onClick: options.onMarkerClicked ? (dotEl) => options.onMarkerClicked(layer, markerElement, dotEl) : undefined,
        // Privileged-viewer-only informational cue (a full-access GM in
        // Orrery, or a map owner/admin in the restricted widget — see
        // isPrivilegedMarkerViewer) — never set for anyone else, since that
        // marker simply isn't in the DOM at all for them, per the guards
        // just above.
        hiddenFromPlayers: Boolean(options.hiddenFromPlayerElementIds?.has(markerElement.id)),
        // Same privileged-viewer test, forwarded so createMarkerDot's own
        // Contents badge only ever renders for a GM (or a map owner/admin
        // in the restricted widget) — a player shouldn't get a free
        // "there's still loot here" tell for a container they haven't
        // opened yet.
        isGMViewer: Boolean(options.isPrivilegedMarkerViewer),
        conditionIcons: options.resolveConditionIcons ? options.resolveConditionIcons(markerElement) : [],
        // Forwarded as the resolver function itself, not pre-resolved here —
        // createMarkerDot needs `markerElement` in scope to call it, same as
        // options.resolveConditionIcons is called above rather than
        // pre-computed in this .map() loop.
        resolveResourceBar: options.resolveResourceBar,
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
// which is NOT what `getBoundingClientRect()` reports once any CSS scale
// transform applies (any zoom other than 1) — a fixed pixel constant
// sidesteps measuring the container's real size at all, since using the
// SAME constant to size/shift this div and to correct backgroundPosition
// makes them cancel by construction, at every zoom level. The div's own
// width/height still grow from that origin via `calc(100% + 2*extent)`, so
// it always covers the container — 4000px is a comfortable pan margin
// beyond that, same reasoning as the fog overlay's own EXTENT=20000.
const GRID_OVERLAY_EXTENT = 4000;

// A FIXED per-type reference zoom (map-model.js's getDefaultView, e.g. zoom
// 2 for tile maps) — deliberately NOT baseMapManager.getDefaultView() (a
// same-named but different thing: whatever view was last passed to
// setBaseMap, i.e. the map's configured Initial Zoom). Grid cell/marker
// sizing needs a STABLE reference point that never moves when a GM tweaks
// Initial Zoom — cellSize's zoom formula below is exponential
// (2^(viewZoom-baseZoom)), so a shifting baseZoom would double every
// marker/grid cell's size at every zoom level.
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
// below expects its `point` already in this "hit-test" scale (it internally
// divides by this factor to get back to content-space), not plain
// content-space — a caller starting from a content-space point has to
// multiply by this factor first, or the internal division double-divides by zoom.
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

// createGridLayerElement's own grid div is shifted GRID_OVERLAY_EXTENT
// pixels up/left of the container's real corner so the tiled background
// survives panning without a visible edge — meaning the div's own local
// origin (what `background-position` is relative to) sits that far from
// the container's true corner. `getGridOffset` alone doesn't account for
// that; adding the same constant back cancels the shift exactly.
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

// --- Grid/measurement helpers shared by Orrery's own toolbar (app.js) and
// the Dashboard's Map widget (widgets/map.js) — previously two separate,
// independently-maintained copies of the exact same math in each ("app.js
// isn't a shared lib module" was the original reasoning; confirmed wrong
// call once a real inconsistency between the two actually showed up).
// Consolidated here since map-viewer.js is already the one module both
// consumers import from for everything else.

// The map's first grid layer supplies the cell size a measurement converts
// through — same "first grid layer, if any" convention as
// snapMarkerPositionToGrid. Deliberately NOT filtered on the layer's own
// visibility — hiding the grid's lines isn't a statement that it stops
// being the map's real scale.
export function findPrimaryGridLayer(map) {
  return (map?.layers || []).find((entry) => entry.type === "grid") || null;
}

// Whether the map's own real-world Scale per cell/Scale unit are BOTH set —
// only meaningful for something that needs to CONVERT cells to a real-world
// distance (the Measure tool's own readout); placing/sizing a shape or
// light no longer depends on this at all, now that Size/Range are authored
// directly in cells (see Orrery's own renderVectorShapeSelectionEditor).
export function hasMapMeasurementConfigured(map) {
  return Number.isFinite(map?.measurement?.scale) && map.measurement.scale > 0 && Boolean(map?.measurement?.unit);
}

// Screen-pixel distance -> grid cells, via the primary grid layer's own
// on-screen cell size (already bakes in the current zoom). Returns null
// when there's no grid layer to convert against.
export function pixelsToCells(baseMapManager, map, pixelDistance) {
  const gridLayer = findPrimaryGridLayer(map);
  if (!gridLayer) return null;
  const cellSizePx = getGridCellSize(baseMapManager, map, gridLayer);
  if (!cellSizePx) return null;
  return pixelDistance / cellSizePx;
}

// AoE shape/light sizes generally fall in whole real-world-unit increments
// (5ft steps in most D&D-style systems) during the live drag-to-place
// gesture — rounding the CELLS value so cells*scale lands on a whole unit
// avoids fiddly decimals like "13.3 ft" while still landing on any concrete
// size, not hardcoded to multiples of 5 specifically. No-op (returns cells
// unchanged) if the map has no usable scale to round against — the
// placement gesture still works fine on cells alone, no real-world scale
// required.
export function snapCellsToWholeUnit(map, cells) {
  const scale = map?.measurement?.scale;
  if (!Number.isFinite(scale) || scale <= 0) return cells;
  return Math.round(cells * scale) / scale;
}

// Screen-pixel distance -> "13.3 ft (2.7 cells)" — the Measure tool's own
// ruler readout, in both Orrery and the Dashboard widget.
export function formatMeasuredDistance(baseMapManager, map, pixelDistance) {
  const cells = pixelsToCells(baseMapManager, map, pixelDistance);
  if (cells === null) return "No grid layer to measure against.";
  const distance = cells * map.measurement.scale;
  return `${distance.toFixed(1)} ${map.measurement.unit} (${cells.toFixed(1)} cells)`;
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

// Appended as a CHILD of createGridLayerElement's own `grid` div, itself
// shifted GRID_OVERLAY_EXTENT pixels up/left of the container's true corner
// — this overlay's `inset:0` fills that shifted box exactly, so a highlight
// positioned with the plain, uncompensated getGridOffset lands
// GRID_OVERLAY_EXTENT pixels off the cell it's supposed to sit on.
// getGridBackgroundPosition already computes this same correction for the
// grid lines — reused here rather than a second copy of the arithmetic.
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
// local pixels (the same space markerPositionToLocalPixel +
// getMarkerLayerOffset produce for paths/shapes/markers — NOT the grid
// div's own EXTENT-shifted space). An open door contributes zero segments —
// simply not a wall while open. Deliberately NOT filtered by layer.visible
// — a hidden "Walls" layer still blocks vision/movement, same as hiding
// grid lines doesn't stop the grid being the map's scale reference. Called
// once per caller and reused, never recomputed per-cell/per-frame.
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
// `blockingSegments` must already be in the same true-container-space
// local pixels resolveBlockingSegments' points use.
//
// Cell-CENTER-only ray testing (one ray per candidate cell), not full
// shadowcasting — a deliberate simplicity tradeoff: fog is already
// cell-granular, so this doesn't introduce a new class of imprecision.
// Accepted caveat: a wall clipping a cell's corner without crossing the
// line to its center can leave that one cell misclassified, worst case one
// row adjacent to a wall. Upgrade path if that ever matters: sample 5
// points per cell instead of 1 — not built until actually needed.
//
// getGridOffset (NOT getGridBackgroundPosition, whose EXTENT shift only
// applies inside the grid div's own child space) is subtracted before
// calling getGridCoordFromPoint (pre-scaled by getGridHitTestScale), and
// added back to each candidate cell's pixel rect before computing its
// center — or this breaks the moment a GM drags the grid layer off {0,0}.
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

// Relocated from app.js (was module-private) so the Dashboard widget's own
// player-driven marker drag (map.js) snaps to the grid exactly the way
// Orrery's authoring drag always has — the widget used to save a token's
// raw drop position with no snapping, a parity gap with Orrery's feel.
// Same "convert to true container-relative content-space, find the cell,
// convert back" logic as resolveVisibleCells above, `map` now a parameter.
//
// `position` is relative to the MARKER layer's own pan offset, not the
// container's true corner (that offset gets added back at RENDER time), so
// it has to be added back in before the grid math below (which works in
// true container-relative space) and subtracted back out before returning.
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
  // containerRelative and gridOffset are both pure content-space, but
  // getGridCoordFromPoint expects its point in "hit-test" scale —
  // multiplying by that factor first makes its internal /hitScale step
  // round-trip to the right cell instead of double-dividing by zoom.
  // getGridCellPixelRect's OUTPUT needs no such adjustment — its cellSize
  // is already content-space for non-tile maps.
  const hitScale = getGridHitTestScale(baseMapManager, map);
  const relativePoint = { x: (containerRelative.x - gridOffset.x) * hitScale, y: (containerRelative.y - gridOffset.y) * hitScale };
  const coord = getGridCoordFromPoint(baseMapManager, map, gridLayer, relativePoint);
  const rect = getGridCellPixelRect(baseMapManager, map, gridLayer, coord);
  const containerCenter = { x: rect.x + gridOffset.x + rect.width / 2, y: rect.y + gridOffset.y + rect.height / 2 };
  const center = { x: containerCenter.x - markerOffset.x, y: containerCenter.y - markerOffset.y };
  return localPixelToMarkerPosition(baseMapManager, map, center);
}

// Builds the interaction option set for a viewer WITHOUT full map access —
// used identically by the Dashboard's Map widget (always this restricted
// view) and by Orrery's own app.js (for a non-owner/non-admin viewer
// reaching Orrery directly). ONE implementation, not two independently-
// written copies that could drift — dragging used to feel "totally
// different" between the widget and Orrery when map.js carried its own
// bespoke copy of this policy.
//
// Only builds POLICY — what's draggable, what's wall-blocked, grid-snapping
// on drop, the locked-door check — never persistence. The two callers
// differ there (the widget relays through a campaign groupId's live-sync;
// Orrery's view doesn't), so `onMarkerMoved`/`onDoorToggled` only fire once
// this policy approves the action; the caller's own job is to persist it
// (both already use map-live-sync.js's persistMarkerMove/persistElementUpdate)
// and refresh its view. `characterOwnershipCatalog` is a caller-refreshed
// Map<characterId, {ownerId, ownerUsername, permissions}> — this module
// never fetches anything itself.
export function buildRestrictedMapOptions({
  dataManager,
  baseMapManager,
  map,
  characterOwnershipCatalog,
  getCharacterPayload,
  // (marker) => overlayIcon[] — passed through to renderMapLayers/
  // createMarkerDot; this function never calls it itself.
  resolveConditionIcons,
  // (marker) => {current,max,label}|null — same passthrough treatment; the
  // restricted map widget builds this itself (active-encounter cache +
  // orrery-settings preference lookup) and hands it in.
  resolveResourceBar,
  status,
  onMarkerMoved,
  onDoorToggled,
  // (layer, markerElement) => void — fired for a plain click (no movement)
  // on a marker this viewer is allowed to drag (same isMarkerDraggable gate,
  // checked here too so a marker the viewer doesn't control does nothing on
  // click). Lets a restricted viewer open an icon/color editor for their own
  // token, without granting anything for a marker that isn't theirs.
  onMarkerClicked,
  // (isDragging: boolean) => void — fired at marker-drag start/end. Lets
  // the caller's remote poll (watchMapForChanges) skip an incoming update
  // mid-drag instead of rebuilding the marker layer's DOM out from under
  // the pointer-capture driving the gesture — otherwise a drag "pops"
  // straight to its final position with no visible tracking, since a poll
  // landing mid-drag (the 10-20s interval easily overlaps one) tears out
  // and rebuilds the dot being dragged. Orrery's own full-access drag never
  // hits this (its own poll guard already skips updates while a layer is
  // selected); a restricted viewer has no selection concept, so it needs
  // its own signal.
  onDragStateChange,
  // () => boolean — true if the current viewer is this MAP's own owner/admin
  // (map.js's own isMapOwnerOrAdmin, which already backs canManageDrawing
  // for player-authored shapes — see that function's own comment for why
  // this is deliberately ownership-only, not allowsDelete()'s broader
  // "or an edit-permission share" rule, given every campaign member already
  // holds an edit share on a spotlighted map). Extends full drag/click-to-
  // edit parity to every OTHER reference kind (monster, npc, ...) for that
  // one viewer — a plain player has no ownership concept over GM-authored
  // content like a Monster/NPC record at all, so character ownership stays
  // the only path for everyone else. Optional; omitted (the only caller
  // besides map.js — Orrery's own app.js, for its non-owner-viewer branch —
  // doesn't pass this) keeps the original character-only restricted
  // behavior unchanged.
  hasMapOwnerAccess,
}) {
  const blockingSegments = resolveBlockingSegments(baseMapManager, map);
  // Resolved once per render pass (hasMapOwnerAccess is a caller-supplied
  // check, not a static flag) — reused below both for drag permission
  // (isMarkerDraggable, its original purpose) and for marker hidden-from-
  // players parity (renderMapLayers' own isPrivilegedViewer — see that
  // function's own comment): this map's own owner/admin viewing it through
  // this restricted widget should see the exact same dim+badge treatment
  // for a hidden marker a GM gets in Orrery itself, not the real-removal a
  // genuine player gets, and not (the confirmed bug this fixes) no
  // indication at all.
  const isOwner = typeof hasMapOwnerAccess === "function" ? Boolean(hasMapOwnerAccess()) : false;
  function isMarkerDraggable(layer, markerElement) {
    if (!markerElement.refId) return false;
    if (markerElement.refKind === "character") {
      return allowsDelete(characterOwnershipCatalog, markerElement.refId, { dataManager });
    }
    return isOwner;
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
    onMarkerClicked: (layer, markerElement, dotEl) => {
      // Confirmed critical bug this fixes: onMarkerDragStart (above) fires
      // unconditionally on every pointerdown, including a plain click that
      // never actually moves — only onMarkerDragEnd used to clear it back
      // to false. A click-to-open (the icon/color popover) therefore left
      // onDragStateChange's own isDraggingMarker permanently stuck true,
      // which silently disables EVERY future render for the rest of the
      // page's life (renderLayers' own `if (isDraggingMarker) return`
      // guard, map.js) — not just for this marker: polling/live-stream
      // updates, other players' moves, everything, until a hard refresh
      // reset the flag. Exactly why a whole map widget could look
      // "completely stopped updating" after nothing more than clicking a
      // token once.
      onDragStateChange?.(false);
      // Fires for EVERY marker click now, not just a draggable one — a
      // restricted viewer clicking a marker they don't own used to do
      // nothing at all, silently, even when it referenced a real NPC/
      // location/spell/journal page they'd want to open. The 4th arg tells
      // the caller which popover fits: their own draggable token gets the
      // existing icon/color editor, anything else with a reference gets a
      // link-out button instead (see resolveMarkerLinkTarget above).
      onMarkerClicked?.(layer, markerElement, dotEl, isMarkerDraggable(layer, markerElement));
    },
    onDoorClick,
    // Never passed for a full-access viewer — the GM must be able to freely
    // drag any token through walls. Only a restricted viewer's own-token
    // drag is blocked. `blockingSegments` is computed once above, not
    // recomputed on every pointermove.
    resolveMarkerMoveBlocked: (layer, markerElement, fromPixel, toPixel) =>
      blockingSegments.some((segment) => segmentsIntersect(fromPixel, toPixel, segment.a, segment.b)),
    getCharacterPayload,
    resolveConditionIcons,
    resolveResourceBar,
    hasMapOwnerAccess: isOwner,
  };
}

// A marker's own Vision Range — the same Binding/Formula/Text precedence
// every bindable field in this suite uses (there's no cross-system standard
// "Darkvision" field, hence a Binding rather than a hardcoded name).
// `getCharacterPayload` is a SYNCHRONOUS, caller-supplied, cache-backed
// lookup (marker.refId) -> payload|undefined — this module never fetches
// anything itself; Orrery's app.js and the Dashboard's map.js widget each
// keep their own fetch-and-cache pair backing this parameter.
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

// A marker's own CURRENT condition icons — same "caller-specific fetch,
// shared resolution algorithm" shape as resolveMarkerVisionRangeCells, so
// Orrery and the Dashboard widget's independent fetch-and-cache instances
// can't drift apart on how a condition resolves.
//
// A Character-linked marker resolves conditions straight off its cached
// payload via the System's `tags`-role binding (no combat-instance
// ambiguity — a Character is never more than one combatant). A Monster/NPC
// marker has no such record of its own — it resolves from
// `getActiveEncounter()`'s combatants, matched by refKind+refId,
// disambiguated by `marker.linkedCombatantId` when more than one combatant
// shares a refId. Either path maps each condition id to an icon/color via
// `getSystemConditions(systemId).iconMap`. Returns createMarkerOverlayIcon-
// shaped entries so createMarkerDot's badge row treats these identically
// to a marker's manually-authored overlayIcons.
export function resolveMarkerConditionIcons(
  marker,
  { getCharacterPayload, getCharacterSystemId, getSystemConditions, getActiveEncounter } = {}
) {
  const toIcons = (conditionIds, systemConditions) =>
    conditionIds.map((conditionId) => {
      const entry = systemConditions.iconMap.get(conditionId);
      // isCondition marks this entry for createMarkerDot's badge renderer —
      // a two-tone ddb-* condition icon needs different treatment than an
      // ordinary single-color manually-picked overlayIcon.
      if (entry) {
        return { ...createMarkerOverlayIcon({ icon: entry.icon, color: entry.color, label: conditionId }), isCondition: true };
      }
      // Tags are free-text, not limited to the System's own Condition
      // vocabulary — every tag now gets SOME badge; createMarkerDot falls
      // back to the tag's own text (ellipsized) whenever `icon` is blank,
      // rather than silently dropping anything outside the authored list.
      // White background (not the "#1e293b" default) to match the
      // authored condition icons' own white badge.
      return { ...createMarkerOverlayIcon({ icon: "", color: "#ffffff", label: conditionId }), isCondition: true };
    });
  // A tag in the same combatant/character's hiddenTags list is intentionally
  // GM-only reference — filtered out before toIcons ever runs.
  const visibleTags = (tags, hiddenTags) =>
    Array.isArray(hiddenTags) && hiddenTags.length ? tags.filter((tag) => !hiddenTags.includes(tag)) : tags;
  if (marker.refKind === "character" && marker.refId) {
    const payload = getCharacterPayload?.(marker.refId);
    const systemId = getCharacterSystemId?.(marker.refId);
    if (!payload || !systemId) return [];
    const systemConditions = getSystemConditions?.(systemId);
    if (!systemConditions?.tagsBinding) return [];
    const conditions = resolveBinding(systemConditions.tagsBinding, payload);
    return Array.isArray(conditions) ? toIcons(visibleTags(conditions, payload.hiddenTags), systemConditions) : [];
  }
  if ((marker.refKind === "monster" || marker.refKind === "npc") && marker.refId) {
    const encounter = getActiveEncounter?.();
    if (!encounter?.systemId) return [];
    const combatant = resolveMarkerLinkedCombatant(marker, encounter);
    if (!combatant?.conditions?.length) return [];
    const systemConditions = getSystemConditions?.(encounter.systemId);
    return systemConditions ? toIcons(visibleTags(combatant.conditions, combatant.hiddenTags), systemConditions) : [];
  }
  return [];
}

// The active Encounter's own combatant entry this marker currently
// represents — refKind+refId matched, disambiguated by
// marker.linkedCombatantId when more than one combatant shares that pair.
// Used only by resolveMarkerConditionIcons' Monster/NPC path.
function resolveMarkerLinkedCombatant(marker, encounter) {
  if (!encounter || !marker.refId) return null;
  const matches = (encounter.combatants || []).filter(
    (combatant) => combatant.refKind === marker.refKind && combatant.refId === marker.refId
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && marker.linkedCombatantId) {
    return matches.find((entry) => entry.id === marker.linkedCombatantId) || null;
  }
  return null;
}

// A marker's own Marker Resource Bar data — same resolveMarkerLinkedCombatant
// lookup as resolveMarkerConditionIcons' Monster/NPC branch, but
// unconditionally, for ANY refKind — the bar always reflects Combat
// Tracker's own live combatant.hp/maxHp, never a Character record's
// hitPoints read directly, since the two are only kept in sync THROUGH an
// active encounter. Returns null when there's nothing to show: no active
// encounter, marker isn't a current combatant, or no resolvable max.
//
// `preferredResourceName` is Orrery's per-System "which resource backs the
// bar" setting — when it names something other than the combatant's
// PRIMARY resource, this looks for a matching entry in
// combatant.resources instead, falling through to primary hp/maxHp if no
// match exists.
export function resolveMarkerResourceBar(marker, encounter, preferredResourceName) {
  if (!encounter?.systemId) return null;
  const combatant = resolveMarkerLinkedCombatant(marker, encounter);
  if (!combatant) return null;
  if (preferredResourceName && preferredResourceName !== combatant.hpResourceName) {
    const secondary = (combatant.resources || []).find((entry) => entry.name === preferredResourceName);
    if (secondary && typeof secondary.max === "number" && secondary.max > 0) {
      return { current: secondary.current, max: secondary.max, label: secondary.name };
    }
  }
  if (typeof combatant.maxHp !== "number" || combatant.maxHp <= 0) return null;
  return { current: combatant.hp, max: combatant.maxHp, label: combatant.hpResourceName || "HP" };
}

// A light's EFFECTIVE position — its own stored `origin` for a freestanding
// light, or (when `attachedMarkerId` is set) the live position of whichever
// marker it's attached to, resolved fresh every call so a token-carried
// torch tracks its host with zero extra sync work. Falls back to the
// light's own last-known `origin` if the attached marker can't be found — a
// dangling attachment degrades to "stopped moving," never an error. Used by
// both resolveRevealedCells' light-reveal loop and renderLightElement's
// glow positioning, so a light's visible glow and its fog-reveal
// contribution can never independently drift apart.
//
// `containingLayer` is caller-supplied rather than independently searched
// for — a THROWAWAY preview element not yet in `layer.elements`
// (setupLightTool's live placement preview) still needs the correct
// offset, which a self-search by element id would miss.
//
// Shared by any vector element with an attachedMarkerId (a shape/effect
// gets the same "follow a token" capability as Lights) via this
// same-shaped function as resolveLightOrigin below — resolves all the way
// to a LOCAL PIXEL position with offset already included. An ATTACHED
// element must use the attached MARKER's own layer offset, not its
// containing layer's — the two are only the same layer by coincidence, so
// using the wrong one renders a shape attached to a token on a manually-
// repositioned layer at the wrong spot, potentially looking vanished.
export function resolveElementOrigin(baseMapManager, map, containingLayer, element) {
  if (element.attachedMarkerId) {
    for (const layer of map.layers || []) {
      if (layer.type !== "marker") continue;
      const marker = (layer.elements || []).find((entry) => entry.id === element.attachedMarkerId);
      if (!marker) continue;
      const offset = getMarkerLayerOffset(map, layer);
      const local = markerPositionToLocalPixel(baseMapManager, map, marker.position);
      return { x: local.x + offset.x, y: local.y + offset.y };
    }
  }
  const offset = getMarkerLayerOffset(map, containingLayer || {});
  const local = markerPositionToLocalPixel(baseMapManager, map, element.origin);
  return { x: local.x + offset.x, y: local.y + offset.y };
}

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
// up to three independent sources, null when fog isn't enabled:
//   1. Manual — the configured revealGroupId Group's own members
//      (getGroupCellsForLayer), unchanged from before walls/vision existed.
//   2. Character auto-reveal — gated by layer.settings.autoRevealFromVision;
//      every character-linked marker with a nonzero
//      resolveMarkerVisionRangeCells contributes its own wall-aware set.
//   3. Lights — unconditional whenever fogOfWar is on (no separate toggle);
//      every `kind:"light"` element contributes its own wall-aware
//      visible-cell set from its live position (resolveLightOrigin).
// `getCharacterPayload` is threaded straight through — this function never
// fetches anything itself.
function resolveRevealedCells(baseMapManager, map, layer, { getCharacterPayload } = {}) {
  if (!layer.settings?.fogOfWar) {
    return null;
  }
  const manualGroup = (map.groups || []).find((entry) => entry.id === layer.settings.revealGroupId);
  const manualCells = manualGroup ? getGroupCellsForLayer(manualGroup, layer) : [];
  const byKey = new Map(manualCells.map((cell) => [cell.key, cell]));

  // The manual reveal-Group cells above are the ORIGINAL, pre-vision-engine
  // behavior — guaranteed to keep working even if the newer wall/vision
  // code throws for an unanticipated data shape. Without this try/catch, an
  // exception in the auto-reveal/light loops below would abort the whole
  // grid layer's render (createFogOverlay never called) — the fog overlay
  // just not appearing, a much harder regression to notice than a wrong cell set.
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

// Shared by buildRevealedCellsMask AND createFogOverlay below — its base/
// hole rects must match the SAME extent the caller's fill rect covers, or
// the mask's coordinate space and the thing it's masking disagree on how
// big "everywhere" is. Module-level, not local to either function.
const FOG_MASK_EXTENT = 20000;

// Builds a <mask> — shared between the grid layer's own fog overlay
// (createFogOverlay below, offset = getGridBackgroundPosition, since that
// mask lives inside the grid div's EXTENT-shifted space) and a Light
// element's wall-aware glow clip (renderLightElement, offset = plain
// getGridOffset — its SVG is a sibling of the grid div, true-container-space,
// NOT shifted). Passing the offset in explicitly makes this one
// implementation correct for both coordinate spaces.
//
// `invert` (default false): fog's polarity — white base with a BLACK hole
// punched at each revealed cell (fog absent there). `invert: true` (a
// light's glow clip) is the opposite — black base, WHITE holes — since the
// glow should show ONLY within its visible-cell set. Using the non-inverted
// polarity for a light was wrong: in the ordinary no-obstruction case,
// nearly every cell under the light counts as "visible," so a fog-style
// mask punched hidden holes across nearly the whole glow.
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
// covers a large fixed pixel extent (not the container's own percentage
// size, not knowable here since this builds a detached element before
// mounting) with `overflow: visible` on the outer <svg>, so the extent
// only has to be "generously larger than any realistic pan/zoom range."
// `ownerPreview`: a much lighter tint for the map's own owner/editor, who
// otherwise never sees fog at all — a pure authoring aid so the GM can see
// the map underneath while knowing which cells a real viewer has hidden.
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
  // CHILD of createGridLayerElement's `grid` div (shifted GRID_OVERLAY_EXTENT
  // pixels off the container's true corner), so an uncompensated offset
  // would punch the mask hole that same distance away from the actual
  // visible cell, while the giant ±EXTENT base/fill rects below still fully
  // covered the viewport regardless — masking the bug from view.
  const offset = getGridBackgroundPosition(baseMapManager, map, layer);
  const mask = buildRevealedCellsMask(baseMapManager, map, layer, revealedCells, maskId, offset);
  defs.appendChild(mask);
  svg.appendChild(defs);
  const fill = document.createElementNS(svgNS, "rect");
  fill.setAttribute("x", String(-FOG_MASK_EXTENT));
  fill.setAttribute("y", String(-FOG_MASK_EXTENT));
  fill.setAttribute("width", String(FOG_MASK_EXTENT * 2));
  fill.setAttribute("height", String(FOG_MASK_EXTENT * 2));
  // Independently configurable — real fog (non-owner viewers) defaults
  // near-opaque; the owner's own preview defaults lighter but still clearly
  // visible.
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
// renders the same grid with no click handling attached. `paintMode`
// (Groups' "paint cells" tool) swaps the single-click/shift-range/
// ctrl-toggle gesture for click-AND-DRAG: onPointerPaint fires once per
// cell newly entered while the button stays down (held on `lastKey` so
// lingering in a cell doesn't refire), letting a GM sweep an area in one
// drag. onPointerPaintEnd fires once on release so the caller closes out
// one undo entry for the whole drag, matching every other drag gesture here.
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
      // The real container's rect, not grid's own (oversized/shifted by
      // GRID_OVERLAY_EXTENT) — matches getGridOffset's "pixels from the
      // container's true corner" meaning, so a click lands on the cell it
      // visually landed on.
      //
      // getGridCoordFromPoint divides its point by getGridHitTestScale (the
      // current zoom) — so `offset` (content-space/unscaled) must be scaled
      // UP by that factor before subtracting it from the raw (post-scale)
      // rect-relative point, or the two terms are in mismatched units.
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
  // A fixed PIXEL extent (not a container percentage) sized via calc()
  // against the normal inset:0 100%/100% box every other layer overlay
  // uses, so this div's local origin sits exactly GRID_OVERLAY_EXTENT
  // pixels from the container's real corner, always.
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
// Pixels-per-cell from the map's first grid layer (same convention as
// app.js's findPrimaryGridLayer), falling back to createLayerSettings's
// default of 50 so a shape never collapses to size 0 with no grid. Not
// filtered on the grid layer's own visibility — hiding its lines doesn't
// change the map's real scale.
function resolveShapePixelsPerCell(baseMapManager, map) {
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  return gridLayer ? getGridCellSize(baseMapManager, map, gridLayer) : 50;
}

// One AoE measurement shape (see createVectorShapeElement, map-model.js).
// Geometry is computed in already-converted LOCAL PIXEL space (origin via
// markerPositionToLocalPixel + offset, size via resolveShapePixelsPerCell)
// so a shape pans/zooms exactly like a drawn path, with no per-base-map-type
// math of its own. "line"/"cone" are plain trig polygons (origin +
// angleDeg) — no existing wedge geometry elsewhere to reuse.
export function renderShapeElement(svg, baseMapManager, map, layer, element, offset, options) {
  const preset = getPresetById(element.presetId) || getPresetById("circle");
  // A "particles" element (an Effect) has no static geometry — its
  // animated canvas rendering is a separate system entirely.
  if (preset.kind !== "geometry") return;
  const { x: cx, y: cy } = resolveElementOrigin(baseMapManager, map, layer, element);
  // The drag gesture below works in PRE-offset local-pixel space (it
  // round-trips through markerPositionToLocalPixel/localPixelToMarkerPosition,
  // which don't know about a layer offset) — subtract `offset` back out.
  // Always valid: dragging only applies to a freestanding shape, so cx/cy
  // came from resolveElementOrigin's freestanding branch.
  const local = { x: cx - offset.x, y: cy - offset.y };
  const pixelsPerCell = resolveShapePixelsPerCell(baseMapManager, map);
  const sizePx = Math.max(0, (element.sizeCells || 0) * pixelsPerCell);
  const isSelected = options.selectedElementId === element.id;

  const visible = preset.draw(cx, cy, sizePx, element, pixelsPerCell);
  // Selection is shown as a cloned outer glow ring, never by overriding
  // `visible`'s own stroke/fill — same approach as markers' box-shadow ring
  // (.is-selected). Overriding stroke directly used to hide the shape's
  // real configured color exactly while it was being edited.
  if (isSelected) {
    const selectionRing = visible.cloneNode();
    selectionRing.setAttribute("fill", "none");
    selectionRing.setAttribute("stroke", "#0ea5e9");
    selectionRing.setAttribute("stroke-width", String((element.strokeWidth || 2) + 4));
    selectionRing.setAttribute("opacity", "0.6");
    selectionRing.style.pointerEvents = "none";
    svg.appendChild(selectionRing);
  }
  const fillColor = element.values?.fill;
  visible.setAttribute("fill", fillColor && fillColor !== "none" ? fillColor : "none");
  visible.setAttribute("stroke", element.values?.stroke || "#0f172a");
  visible.setAttribute("stroke-width", String(element.strokeWidth || 2));
  // 0.5 fallback only for a shape saved before this field existed —
  // createVectorShapeElement always stamps a real number now.
  visible.setAttribute("opacity", String(Number.isFinite(element.opacity) ? element.opacity : 0.5));
  svg.appendChild(visible);

  // An attached shape/effect's position derives from its host marker, not
  // independently draggable (same gate as renderLightElement's canDrag) —
  // move the marker, or detach via the inspector's Attach to Token picker.
  const canDrag = !element.attachedMarkerId && typeof options.onShapeDragEnd === "function";
  if (typeof options.onPathClick === "function" || canDrag) {
    // Clone reuses the geometry attributes just set; fill:"transparent"
    // (not "none") is what makes the whole shape area register pointer hits.
    const hit = visible.cloneNode();
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("stroke", "transparent");
    hit.style.pointerEvents = "fill";
    hit.style.cursor = canDrag ? "move" : "pointer";
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // element.kind lets the shared caller (this hit-target is shared with
      // drag-less plain paths) decide whether a rebuild-on-select is safe or
      // would tear out nodes a drag is about to setPointerCapture on (see
      // app.js's selectShapeElementForDrag).
      options.onPathClick?.(element.id, event, element.kind);
      if (!canDrag) {
        return;
      }
      // Same "select on pointerdown, drag is optional" gesture as
      // beginMarkerDrag. Capture can throw InvalidStateError on a
      // freshly-cloned SVG element in some browsers — best-effort only,
      // since the drag itself is tracked via window-level listeners anyway.
      try {
        hit.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignored — see comment above.
      }
      const startX = event.clientX;
      const startY = event.clientY;
      // Delta is POST-scale screen pixels; visible/hit live inside
      // PanZoomController's scale(zoom) transform, so dividing by zoom
      // keeps the shape tracking the cursor 1:1 (see getNonTileZoom).
      const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
      let lastDelta = null;
      baseMapManager.setInteractionEnabled(false);
      // A temporary preview, redrawn per move and torn down on release,
      // rather than mutating visible/hit in place — in-place mutation
      // (transform or direct geometry attrs) never actually repainted
      // mid-drag. Reuses this same function against a throwaway
      // element+svg, same technique as setupShapeTool's placement preview.
      // `hit` is left untouched (already invisible, holds the active
      // pointer capture); only `visible` needs to disappear, via removal
      // rather than display:none for a stronger guarantee.
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
        // Restored unconditionally — harmless when a real move triggers a
        // full re-render, and necessary for the click-without-drag case
        // where no re-render happens and this is the only copy left.
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
  // A secret door renders exactly like a plain wall for a non-full-access
  // viewer — same GM-only "owner preview" asymmetry as Fog of War elsewhere
  // in this file.
  const revealDoorStyling = isDoor && (!isSecret || options.hasFullAccess);

  // Visible line + door decorations live in one <g>, hidden as a unit
  // during a drag — simpler than tracking each decoration node separately.
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
    // Short perpendicular "leaf" tick at the door's midpoint, using its
    // first segment for direction (doors are normally a single 2-point
    // segment; a multi-point door still gets a reasonable tick off leg 1).
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
    // Dashed for a secret door so the GM (this only runs when
    // hasFullAccess) can tell it apart from an ordinary one while authoring.
    if (isSecret) {
      tick.setAttribute("stroke-dasharray", "3 2");
    }
    wrapper.appendChild(tick);

    // Padlock glyph centered on the door's midpoint, deliberately
    // overlapping the tick — the one persistent locked-door indicator,
    // rather than something only discovered by clicking. Same visibility
    // rule as the tick, so a secret+locked door stays invisible to players.
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
  // all, matching "a player doesn't even know it's there."
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

  // Per-vertex reshape handles, only while this wall is selected. Appended
  // as siblings of `wrapper` (not children) so hiding wrapper during a
  // whole-wall drag doesn't hide these too.
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
          // No onWallVertexDragEnd here — passing even a no-op would make
          // renderWallElement build real handle circles with real listeners
          // on top of this throwaway preview, risking a second conflicting
          // drag if the cursor passes over one mid-gesture.
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

// A freestanding or token-attached placed light. Position always resolves
// via resolveLightOrigin (tracks an attached marker's live position); the
// `offset` param is deliberately unused here since re-adding it would
// double-apply what resolveLightOrigin already resolves.
//
// The glow is masked to THIS light's own wall-aware line-of-sight cell set,
// never the grid layer's whole unioned reveal set — clipping against the
// shared union would let a light leak into a cell revealed by an unrelated
// source even with a wall between them. Applies unconditionally regardless
// of Fog of War being toggled: wall-shaping is a physical-correctness
// question, not a hidden-information one, so every viewer sees the same
// clipped shape.
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

  // findPrimaryGridLayer's inline equivalent — the map's scale reference
  // for element.rangeCells regardless of the grid layer's own visibility.
  // No grid layer: nothing to clip against, glow renders unclipped.
  const gridLayer = (map.layers || []).find((entry) => entry.type === "grid");
  if (gridLayer) {
    const blockingSegments = resolveBlockingSegments(baseMapManager, map);
    const visibleCells = resolveVisibleCells(baseMapManager, map, gridLayer, {
      origin,
      rangeCells: element.rangeCells,
      blockingSegments,
    });
    const maskId = `orrery-light-mask-${element.id}`;
    // getGridOffset, not getGridBackgroundPosition — this light's SVG is a
    // sibling of the grid div (true-container-space like any path/shape/
    // marker), not a child of its GRID_OVERLAY_EXTENT-shifted space (see
    // buildRevealedCellsMask's header for why the two callers differ).
    const maskOffset = getGridOffset(baseMapManager, map, gridLayer);
    // invert: true — buildRevealedCellsMask's default polarity punches
    // black holes at revealed cells (fog shows everywhere except those). A
    // light needs the opposite: visible ONLY within its own visible cells.
    // Without invert, the common no-obstruction case (nearly every cell
    // under the glow is "visible") punched holes across almost the entire
    // circle, hiding nearly all of it.
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
    // The light's own color, not a fixed accent (unlike a shape's ring,
    // whose stroke is a separate configurable field) — a light has no
    // separate "outline" concept.
    ring.setAttribute("stroke", element.color || "#fbbf24");
    ring.setAttribute("stroke-width", "2");
    ring.setAttribute("stroke-dasharray", "6 4");
    ring.style.pointerEvents = "none";
    svg.appendChild(ring);
  }
  svg.appendChild(visible);

  // An attached light's position derives from its host marker, not
  // independently draggable — gated here (not on whether the caller passes
  // onShapeDragEnd) since renderLayerOverlays wires that callback
  // identically for every shape/light regardless of attachment.
  const canDrag = !element.attachedMarkerId && typeof options.onShapeDragEnd === "function";
  if (typeof options.onPathClick === "function" || canDrag) {
    // A plain circle, not a clone of `visible` — the glow's radial gradient
    // (fading to 0 opacity, possibly wall-masked) isn't a reliable
    // hit-target the way a flat fill is.
    //
    // Deliberately its own drag implementation rather than a shared
    // extraction with renderShapeElement's near-identical block, to avoid
    // refactoring that already-working gesture code. Same overall shape:
    // select-on-pointerdown, drag optional, commit only on real movement,
    // temp preview redrawn per move via this function calling itself.
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

// Module-level: tracks which loop:false particle elements already
// completed their one-shot cycle, so a routine poll/pan/zoom rebuild
// doesn't replay them from scratch. Cleared per-element by
// resetParticleEffectPlayState on an explicit re-trigger (Play button,
// macro, remote broadcast) so that element plays again.
const particleEffectPlayedOnce = new Set();

export function resetParticleEffectPlayState(elementId) {
  particleEffectPlayedOnce.delete(elementId);
}

// Renders a `kind: "particles"` element (an Effect) as a canvas appended
// to the shared overlay container, not the per-layer SVG — particles need
// their own requestAnimationFrame redraw every frame, not a one-shot SVG
// primitive. Plays continuously if element.loop, else once per trigger.
//
// Self-terminates once its canvas leaves the DOM (`canvas.isConnected`) —
// the same rebuild that wipes the overlay container on every poll/pan/zoom
// tick stops any running loop this way, no separate cancellation registry
// needed.
//
// Supports click-to-select and drag-to-move, matching renderShapeElement's
// hit-target (a real prior parity gap). Simpler than the SVG shape's drag
// though: since this canvas repositions itself every frame via `frame()`
// below, a live drag preview is just `dragOffset` nudging that same
// per-frame position — no separate temp preview node needed (unlike an SVG
// shape, a canvas's style.left/top repaints fine mid-drag). An attached
// effect still isn't draggable — same gate as renderShapeElement.
export function renderParticleEffectElement(overlayHost, baseMapManager, map, layer, element, offset, options = {}) {
  if (!element.loop && particleEffectPlayedOnce.has(element.id)) return;
  const preset = getPresetById(element.presetId);
  if (!preset || preset.kind !== "particles") return;
  const pixelsPerCell = resolveShapePixelsPerCell(baseMapManager, map);
  const sizePx = Math.max(0, (element.sizeCells || 0) * pixelsPerCell);
  // Padded well past sizePx (radiating presets like Burst/Cone Blast throw
  // particles to ~1.1x sizePx) so they don't clip. `hit` below is a
  // separate, purpose-sized element for interaction, decoupled from this —
  // a "10 ft" effect used to be selectable across this whole padded area.
  const canvasSize = Math.max(120, sizePx * 3);
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  canvas.style.position = "absolute";
  canvas.style.pointerEvents = "none";
  // This canvas lands in `overlay` ahead of its own layer's wrapper — an
  // explicit z-index keeps later-painted layers/markers from covering it.
  canvas.style.zIndex = "5";
  overlayHost.appendChild(canvas);

  // Weather presets fill the whole canvas edge to edge, so their hit
  // target matches canvasSize; every other preset radiates from a center
  // point, so its hit target is a circle sized to sizePx instead.
  const hitDiameter = preset.category === "weather" ? canvasSize : Math.max(24, sizePx * 2);
  const hit = document.createElement("div");
  hit.style.position = "absolute";
  hit.style.width = `${hitDiameter}px`;
  hit.style.height = `${hitDiameter}px`;
  hit.style.borderRadius = "50%";
  // Lands in `overlay` before its own layer's wrapper, so plain DOM order
  // would let later markers/shapes/walls steal its pointer events — an
  // explicit z-index (nothing else in this stack sets one) guarantees this
  // always wins hit-testing for its footprint regardless of DOM position.
  hit.style.zIndex = "5";
  const canDrag = !element.attachedMarkerId && typeof options.onShapeDragEnd === "function";
  const canInteract = typeof options.onPathClick === "function" || canDrag;
  hit.style.pointerEvents = canInteract ? "auto" : "none";
  hit.style.cursor = canInteract ? (canDrag ? "move" : "pointer") : "";
  // Drives the boundary ring drawn in frame() below — unlike a geometry
  // shape's always-visible fill, a particle effect's painted particles can
  // be too sparse (a Weather patch especially) to show where it is. Hover
  // shows the ring transiently; selection keeps it up persistently.
  let hovered = false;
  if (canInteract) {
    hit.addEventListener("pointerenter", () => {
      hovered = true;
    });
    hit.addEventListener("pointerleave", () => {
      hovered = false;
    });
  }
  // Nudges the per-frame resolved position below during a live drag —
  // cleared once the gesture ends, whether committed or just a click.
  let dragOffset = null;
  if (canInteract) {
    hit.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      options.onPathClick?.(element.id, event, element.kind);
      if (!canDrag) return;
      try {
        hit.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignored — see renderShapeElement's own identical comment.
      }
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = isTileBaseMap(map) ? 1 : getNonTileZoom(baseMapManager);
      let lastDelta = null;
      baseMapManager.setInteractionEnabled(false);
      const onMove = (moveEvent) => {
        lastDelta = { x: (moveEvent.clientX - startX) / zoom, y: (moveEvent.clientY - startY) / zoom };
        dragOffset = lastDelta;
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
        dragOffset = null;
        if (lastDelta) {
          // Same pre-offset-local-pixel reconstruction as renderShapeElement's
          // drag commit — valid here since drag only runs for a freestanding effect.
          const { x: cx, y: cy } = resolveElementOrigin(baseMapManager, map, layer, element);
          const local = { x: cx - offset.x, y: cy - offset.y };
          const nextLocalPixel = { x: local.x + lastDelta.x, y: local.y + lastDelta.y };
          const nextOrigin = localPixelToMarkerPosition(baseMapManager, map, nextLocalPixel);
          options.onShapeDragEnd(element.id, nextOrigin);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  overlayHost.appendChild(hit);
  const ctx = canvas.getContext("2d");
  // `let`, re-seeded on every loop restart below — without it, a loop:true
  // effect's `start = null` reset only rewound `elapsed`, replaying the
  // exact same random pattern every cycle (an obviously mechanical loop).
  let particles = preset.seed(sizePx);
  let start = null;
  function frame(now) {
    if (!canvas.isConnected) return;
    if (start === null) start = now;
    const elapsed = now - start;
    // Recomputed every frame so an attached Effect tracks its host token
    // live, same freshness as resolveLightOrigin for Lights.
    const { x: baseCx, y: baseCy } = resolveElementOrigin(baseMapManager, map, layer, element);
    const cx = baseCx + (dragOffset?.x || 0);
    const cy = baseCy + (dragOffset?.y || 0);
    canvas.style.left = `${cx - canvasSize / 2}px`;
    canvas.style.top = `${cy - canvasSize / 2}px`;
    hit.style.left = `${cx - hitDiameter / 2}px`;
    hit.style.top = `${cy - hitDiameter / 2}px`;
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    const stillGoing = preset.run(ctx, canvasSize / 2, canvasSize / 2, sizePx, elapsed, element.values, particles, element);
    // Subtle boundary ring, matching the hit-target's own radius (hovered)
    // — see hit's own "hovered" comment above for why this exists at all.
    // Same accent color renderShapeElement's own selection ring uses, kept
    // dashed/soft here (vs. that one's solid glow) since this is meant to
    // read as "here's where to click," not compete with the effect's own
    // painted particles for attention.
    if (hovered || options.selectedElementId === element.id) {
      ctx.save();
      ctx.strokeStyle = "#0ea5e9";
      ctx.globalAlpha = options.selectedElementId === element.id ? 0.7 : 0.4;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(canvasSize / 2, canvasSize / 2, hitDiameter / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (stillGoing) {
      requestAnimationFrame(frame);
      return;
    }
    if (element.loop) {
      start = null;
      particles = preset.seed(sizePx);
      requestAnimationFrame(frame);
      return;
    }
    particleEffectPlayedOnce.add(element.id);
    canvas.remove();
    hit.remove();
  }
  requestAnimationFrame(frame);
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
    // Same "not in the DOM at all for a restricted viewer" treatment as
    // createMarkerLayerElement's marker guard, covering path/shape/wall/
    // light uniformly through this one loop.
    if (options.hiddenElementIds?.has(element.id)) return;
    if (element.kind === "shape") {
      const preset = getPresetById(element.presetId);
      if (preset?.kind === "particles") {
        // Appended to the shared overlay container, not this per-layer SVG
        // — see renderParticleEffectElement's header for why.
        const overlayContainer = baseMapManager.getOverlayContainer?.();
        if (overlayContainer) {
          renderParticleEffectElement(overlayContainer, baseMapManager, map, layer, element, offset, options);
        }
        return;
      }
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
      // A single-point "path" (click with no drag) renders as a dot — a
      // polyline needs at least two points to draw a visible line.
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
// Orrery-authoring concept (a named set of cells, e.g. "the goblin camp"),
// rendering-relevant only when a caller passes `activeGroup` (Orrery only;
// the widget never does).

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
  // Marker, vector, and grid layers each fold layer.position into their own
  // elements/points/backgroundPosition instead (getMarkerLayerOffset,
  // getGridOffset) — the wrapper must stay untransformed for those or the
  // offset applies twice, which used to double-move a grid layer's own
  // translate+background-position together.
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
// - `viewerTier`, `hasFullAccess` — tiered-visibility filter (computeHiddenIds).
// - `selection` — Orrery-only: `{kind: "layer"|"grid-cells"|"marker-element"|"group", id, layerId, cells}`.
//   Omitted/null: nothing renders selected, no whole-layer drag handle (the widget's case).
// - `activeGroup` — Orrery-only: selected group record, for its cells' highlight overlay on grid layers.
// - `onGridCellPointerDown(layer, coord, event)` — Orrery-only.
// - `onMarkerLayerEmptyClick(layer, position, event)` — Orrery-only, "place a new marker here".
// - `isMarkerDraggable(layer, markerElement)` — omitted means every marker is draggable
//   (Orrery's default); the widget only allows the viewer's own claimed character's marker.
// - `onMarkerDragStart(layer, markerElement, dotEl)`, `onMarkerDragEnd(layer, markerElement, nextPosition)`.
// - `onVectorPathClick(layer, elementId, event)` — Orrery-only, select a path/shape (only wired
//   once its layer is selection-selected — see createVectorLayerElement's isSelected gate).
// - `onShapeDragEnd(layer, elementId, nextOrigin)` — Orrery-only, AoE shapes only (paths have no
//   drag); same isSelected gate as onVectorPathClick.
// - `renderLayerHandle(wrapper, layer, element)` — Orrery-only: whole-layer drag handle for the
//   `selection`-selected layer.
export function renderMapLayers(overlay, baseMapManager, map, options = {}) {
  if (!overlay) return;
  overlay.innerHTML = "";
  const hasFullAccess = options.hasFullAccess ?? false;
  const hidden = computeHiddenIds(map, options.viewerTier ?? "free", hasFullAccess);
  // A restricted widget viewer who still owns/admins this map
  // (options.hasMapOwnerAccess) gets the same "dim + badge, not real
  // removal" treatment as full GM access for a hidden marker — previously
  // gated on hasFullAccess alone, which the widget never sets, so a map
  // owner using the Dashboard widget saw a hidden marker vanish or show no
  // indication at all. Scoped to markers only; hidden layers/shapes/secret
  // doors keep their existing hasFullAccess-only behavior.
  const isPrivilegedMarkerViewer = hasFullAccess || Boolean(options.hasMapOwnerAccess);
  // GM-only informational cue (createMarkerDot's own dim/badge treatment below) —
  // "what's hidden from the player tier specifically," independent of whichever
  // tier is actually viewing right now. Only computed for a privileged viewer;
  // anyone else already has matching elements filtered out entirely by
  // `hidden`/markerHiddenElementIds below, so there's nothing left to badge.
  const hiddenFromPlayerElementIds = isPrivilegedMarkerViewer ? computeHiddenIds(map, "player", false).elements : null;
  // A privileged viewer never has a View-hidden MARKER actually removed
  // from the DOM (badge instead, via hiddenFromPlayerElementIds above) —
  // `hidden.elements` still governs everything else (vector paths, doors)
  // exactly as before.
  const markerHiddenElementIds = isPrivilegedMarkerViewer ? undefined : hidden?.elements;
  const selection = options.selection || null;
  (map.layers || []).forEach((layer) => {
    if (!layer.visible) return;
    if (hidden?.layers.has(layer.id)) return;
    // A locked layer stays fully visible but every interactivity gate below
    // is ANDed with `!locked`, so clicks/drags fall through to whatever's
    // behind it. Motivating case: a Weather effect's full-map hit target
    // used to swallow every click aimed at markers/shapes underneath it —
    // locking that layer fixes it without touching the effect itself.
    const locked = Boolean(layer.locked);
    const isLayerSelected = selection?.kind === "layer" && selection.id === layer.id;
    const isGridCellsSelected = selection?.kind === "grid-cells" && selection.layerId === layer.id;
    const isMarkerElementSelected = selection?.kind === "marker-element" && selection.layerId === layer.id;
    // Multi-select counterpart: true whenever ANY of this layer's markers
    // are part of the current multi-selection (which can span layers).
    const isMarkerElementsSelected =
      selection?.kind === "marker-elements" && (selection.elements || []).some((entry) => entry.layerId === layer.id);
    const isVectorPathSelected = selection?.kind === "vector-path" && selection.layerId === layer.id;
    const isSelected = isLayerSelected || isGridCellsSelected || isMarkerElementSelected || isMarkerElementsSelected || isVectorPathSelected;
    const groupCells = options.activeGroup ? getGroupCellsForLayer(options.activeGroup, layer) : [];
    const wrapper = createLayerWrapper(map, layer, isSelected);
    let element = null;
    const layerPosition = getLayerRenderPosition(layer, getLayerPositionScale());
    const renderState = isTileBaseMap(map) ? { position: layerPosition, sizeScale: getLayerSizeScale() } : {};
    if (layer.type === "grid") {
      // The Paint Cells tool arms exactly one layer at a time
      // (paintTargetLayerId) — every other grid layer renders normally.
      const isPaintTarget = Boolean(options.paintModeActive) && options.paintTargetLayerId === layer.id;
      // No fallback-without-selecting-a-layer escape hatch here (unlike
      // markers/vectors below) — a grid layer's hit target is one element
      // covering the entire map, so fallback-interactive-when-nothing-
      // selected would swallow every click and block panning entirely.
      // Reachable only via explicit layer selection or the paint tool.
      element = createGridLayerElement(baseMapManager, map, layer, {
        isInteractive: !locked && (isSelected || isPaintTarget),
        selectedCells: isGridCellsSelected ? selection.cells : [],
        groupCells,
        hasFullAccess: options.hasFullAccess ?? false,
        onPointerDown: options.onGridCellPointerDown ? (coord, event) => options.onGridCellPointerDown(layer, coord, event) : undefined,
        paintMode: isPaintTarget,
        onPointerPaint: isPaintTarget && options.onGridCellPaint ? (coord, event) => options.onGridCellPaint(layer, coord, event) : undefined,
        onPointerPaintEnd: isPaintTarget ? options.onGridCellPaintEnd : undefined,
        // Threaded through to resolveRevealedCells' character-vision
        // auto-reveal loop — see resolveMarkerVisionRangeCells for why this
        // must be a synchronous, cache-backed callback, not a fetch here.
        getCharacterPayload: options.getCharacterPayload,
      });
    } else if (layer.type === "raster") {
      element = createRasterLayerElement(layer, renderState);
    } else if (layer.type === "marker") {
      element = createMarkerLayerElement(baseMapManager, map, layer, {
        // isLayerSelected OR this layer is "armed" (armedMarkerLayerId) —
        // not the wider isSelected. Gates only the empty-space
        // click/crosshair ("place a new marker here"), not whether existing
        // markers are clickable (isMarkerDraggable below). Using isSelected
        // here used to mean fallback-selecting a single marker also armed
        // "click elsewhere places a new marker" — clicking off a marker to
        // deselect it silently placed a new one. armedMarkerLayerId keeps
        // "select layer, then rapidly place/nudge markers" fluid (unlike
        // isLayerSelected, which goes false the instant a marker is
        // selected) while excluding a fresh click that never armed the layer.
        isInteractive: !locked && (isLayerSelected || options.armedMarkerLayerId === layer.id),
        selectedElementId: isMarkerElementSelected ? selection.id : null,
        selectedElementIds: isMarkerElementsSelected
          ? new Set(selection.elements.filter((entry) => entry.layerId === layer.id).map((entry) => entry.id))
          : null,
        isMarkerDraggable:
          !locked && options.isMarkerDraggable ? (markerElement) => options.isMarkerDraggable(layer, markerElement) : undefined,
        onEmptyClick: options.onMarkerLayerEmptyClick ? (position, event) => options.onMarkerLayerEmptyClick(layer, position, event) : undefined,
        onMarkerDragStart: options.onMarkerDragStart,
        onMarkerDragEnd: options.onMarkerDragEnd,
        onMarkerClicked: options.onMarkerClicked,
        onMarkerMultiSelectToggle: options.onMarkerMultiSelectToggle,
        // Never passed from Orrery's own app.js — free GM authoring must
        // stay unrestricted (see beginMarkerDrag).
        resolveMarkerMoveBlocked: options.resolveMarkerMoveBlocked,
        hiddenElementIds: markerHiddenElementIds,
        hiddenFromPlayerElementIds,
        isPrivilegedMarkerViewer,
        resolveConditionIcons: options.resolveConditionIcons,
        resolveResourceBar: options.resolveResourceBar,
      });
    } else {
      element = createVectorLayerElement(baseMapManager, map, layer, {
        selectedElementId: isVectorPathSelected ? selection.id : null,
        hiddenElementIds: hidden?.elements,
        // isSelected, not isLayerSelected alone — once a path is selected,
        // selection.kind becomes "vector-path", so isLayerSelected alone
        // would go false and never recover without re-clicking the layer.
        // isSelected stays true across path-to-path reselection instead.
        //
        // `kind` ("shape" vs "path") must be forwarded through onPathClick
        // too — dropping it silently made a shape click take the full
        // rebuilding setSelection() path instead of the lightweight
        // selectShapeElementForDrag(), which ran mid-gesture and orphaned
        // the svg/visible/hit nodes renderShapeElement's own drag code was
        // still operating on (the visible symptom: the original shape
        // stayed on screen until the drag was dropped).
        //
        // isSelected OR isVectorLayerInteractive(layer) — the second half
        // lets a caller with no layer-selection concept (the Dashboard
        // widget) opt one specific layer into clickability without
        // Orrery's "select the layer first" flow. Per-element ownership is
        // left to the callback itself.
        onPathClick:
          !locked && (isSelected || options.isVectorLayerInteractive?.(layer)) && options.onVectorPathClick
            ? (elementId, event, kind) => options.onVectorPathClick(layer, elementId, event, kind)
            : undefined,
        // AoE shapes only — drawn paths (terrain annotations) have no
        // drag-to-move; shapes are transient tactical indicators. Same gate
        // as onPathClick.
        onShapeDragEnd:
          !locked && (isSelected || options.isVectorLayerInteractive?.(layer)) && options.onShapeDragEnd
            ? (elementId, nextOrigin) => options.onShapeDragEnd(layer, elementId, nextOrigin)
            : undefined,
        // Doors only, never gated on isSelected — the Dashboard widget (the
        // only real caller) has no layer-selection concept, so gating here
        // would mean door-click-to-open never fires for a player.
        onDoorClick: options.onDoorClick ? (elementId, event) => options.onDoorClick(layer, elementId, event) : undefined,
        // So renderWallElement can decide whether to reveal a secret door's
        // tick (GM/owner only — same asymmetry as createFogOverlay).
        hasFullAccess: options.hasFullAccess ?? false,
        // Whole-wall drag + per-vertex handles, same isSelected gate as
        // onShapeDragEnd; handles are additionally gated on this specific
        // wall being selected (renderWallElement's own check).
        onWallDragEnd:
          !locked && isSelected && options.onWallDragEnd ? (elementId, nextPoints) => options.onWallDragEnd(layer, elementId, nextPoints) : undefined,
        onWallVertexDragEnd:
          !locked && isSelected && options.onWallVertexDragEnd
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
