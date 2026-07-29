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

// Drag always operates in plain screen-pixel deltas (correct regardless of
// base map type — you're never crossing a zoom-driven projection reset
// mid-drag), and only converts the final pixel position back into the
// marker's real stored representation (lat/lng or x/y) once the gesture
// ends. `onDragEnd(nextPosition)` only fires if the gesture actually moved
// the marker — a plain click-no-drag is a no-op here (callers that also
// want "select on click" pass `onDragStart`, called unconditionally before
// tracking begins).
function beginMarkerDrag(event, baseMapManager, map, layer, markerElement, dotEl, onDragEnd) {
  dotEl.setPointerCapture(event.pointerId);
  const startPixel = getMarkerElementPixelPosition(baseMapManager, map, layer, markerElement);
  const startX = event.clientX;
  const startY = event.clientY;
  let lastPixel = null;
  baseMapManager.setInteractionEnabled(false);
  const onMove = (moveEvent) => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    lastPixel = { x: startPixel.x + dx, y: startPixel.y + dy };
    dotEl.style.left = `${lastPixel.x}px`;
    dotEl.style.top = `${lastPixel.y}px`;
  };
  const onUp = (upEvent) => {
    dotEl.releasePointerCapture(upEvent.pointerId);
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
  const size = layer.settings?.size || 24;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  // Centering (top/left 50% + translate(-50%,-50%)) already comes from the
  // .orrery-layer-marker-overlay CSS rule — dot.style.left/top below just
  // overrides that 50%/50% anchor with this element's own pixel position;
  // the transform still applies on top, so the dot's center (not its
  // top-left corner) lands on that pixel.
  dot.style.backgroundColor = layer.settings?.color || "#0ea5e9";
  const draggable = options.draggable !== false;
  dot.style.pointerEvents = draggable ? "auto" : "none";
  dot.style.cursor = draggable ? "pointer" : "default";
  const pixelPosition = getMarkerElementPixelPosition(baseMapManager, map, layer, markerElement);
  dot.style.left = `${pixelPosition.x}px`;
  dot.style.top = `${pixelPosition.y}px`;
  if (markerElement.label) {
    dot.title = markerElement.label;
  }
  if (draggable) {
    dot.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      options.onDragStart?.(dot);
      beginMarkerDrag(event, baseMapManager, map, layer, markerElement, dot, options.onDragEnd);
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
// - `isMarkerDraggable(markerElement)`: per-marker draggability — Orrery
//   omits this (every marker is always draggable there); the widget passes
//   one that's only true for its own claimed character's marker.
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
        const rect = container.getBoundingClientRect();
        const offset = getMarkerLayerOffset(map, layer);
        localPixel = { x: event.clientX - rect.left - offset.x, y: event.clientY - rect.top - offset.y };
      }
      options.onEmptyClick?.(localPixelToMarkerPosition(baseMapManager, map, localPixel), event);
    });
  }
  (layer.elements || []).forEach((markerElement) => {
    if (!hasValidMarkerPosition(map, markerElement.position)) return;
    const draggable = options.isMarkerDraggable ? options.isMarkerDraggable(markerElement) : true;
    container.appendChild(
      createMarkerDot(baseMapManager, map, layer, markerElement, {
        selected: options.selectedElementId === markerElement.id,
        draggable,
        onDragStart: options.onMarkerDragStart ? (dotEl) => options.onMarkerDragStart(layer, markerElement, dotEl) : undefined,
        onDragEnd: options.onMarkerDragEnd ? (nextPosition) => options.onMarkerDragEnd(layer, markerElement, nextPosition) : undefined,
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

function getBaseZoom(baseMapManager) {
  return baseMapManager.getDefaultView?.()?.zoom ?? 1;
}

function getGridZoomScale(baseMapManager, map) {
  const baseZoom = getBaseZoom(baseMapManager);
  const viewZoom = Number.isFinite(map.view?.zoom) ? map.view.zoom : baseZoom;
  if (isTileBaseMap(map)) {
    return Math.pow(2, viewZoom - baseZoom);
  }
  return baseZoom ? viewZoom / baseZoom : 1;
}

export function getGridLayoutScale(baseMapManager, map) {
  return isTileBaseMap(map) ? getGridZoomScale(baseMapManager, map) * 0.1 : 1;
}

function getGridHitTestScale(baseMapManager, map) {
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

function getGridCellPixelRect(baseMapManager, map, layer, coord) {
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

function createGridSelectionOverlay(baseMapManager, map, layer, selectedCells, options = {}) {
  const overlay = document.createElement("div");
  overlay.className = "orrery-layer-grid-selection";
  const variant = options.variant || "selection";
  const gridType = getGridType(layer);
  const offset = getGridOffset(baseMapManager, map, layer);
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

// `selectionState`: { isInteractive, selectedCells, groupCells, onPointerDown(coord, event) }.
// Only Orrery passes isInteractive/onPointerDown — the widget renders the
// same grid appearance with no click handling attached at all.
export function createGridLayerElement(baseMapManager, map, layer, selectionState = {}) {
  const grid = document.createElement("div");
  grid.className = "orrery-layer-grid-overlay";
  if (selectionState.isInteractive) {
    grid.classList.add("is-interactive");
    grid.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      baseMapManager.setInteractionEnabled(false);
      const rect = grid.getBoundingClientRect();
      const offset = getGridOffset(baseMapManager, map, layer);
      const point = { x: event.clientX - rect.left - offset.x, y: event.clientY - rect.top - offset.y };
      const coord = getGridCoordFromPoint(baseMapManager, map, layer, point);
      selectionState.onPointerDown?.(coord, event);
    });
    grid.addEventListener("pointerup", () => baseMapManager.setInteractionEnabled(true));
    grid.addEventListener("pointercancel", () => baseMapManager.setInteractionEnabled(true));
  }
  const gridScale = 3;
  grid.style.width = `${gridScale * 100}%`;
  grid.style.height = `${gridScale * 100}%`;
  grid.style.left = `-${((gridScale - 1) / 2) * 100}%`;
  grid.style.top = `-${((gridScale - 1) / 2) * 100}%`;
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
  const offset = getGridOffset(baseMapManager, map, layer);
  grid.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
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
  if (layer.settings?.width) {
    image.width = Math.max(1, Math.round(layer.settings.width * scale));
  }
  if (layer.settings?.height) {
    image.height = Math.max(1, Math.round(layer.settings.height * scale));
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

export function createVectorLayerElement(layer, renderState = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const baseSize = 200;
  const scale = renderState.sizeScale ?? 1;
  const scaledSize = Math.max(1, Math.round(baseSize * scale));
  svg.setAttribute("viewBox", "0 0 200 200");
  if (renderState.position) {
    svg.style.position = "absolute";
    svg.style.left = `${renderState.position.x}px`;
    svg.style.top = `${renderState.position.y}px`;
    svg.style.right = "auto";
    svg.style.bottom = "auto";
    svg.style.transform = "translate(-50%, -50%)";
    svg.style.width = `${scaledSize}px`;
    svg.style.height = `${scaledSize}px`;
  }
  svg.classList.add("orrery-layer-vector-overlay");
  const stroke = layer.settings?.strokeColor || "#0f172a";
  const fill = layer.settings?.fillColor || "#93c5fd";
  const width = layer.settings?.strokeWidth || 2;
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", "40,160 100,40 160,160");
  poly.setAttribute("fill", fill);
  poly.setAttribute("stroke", stroke);
  poly.setAttribute("stroke-width", width);
  svg.appendChild(poly);
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
  // Marker layers fold layer.position into each element's own pixel position
  // instead (getMarkerLayerOffset/getMarkerElementPixelPosition above) — same
  // "layer position is a pan offset added on top of each element's own
  // coordinate" convention grid cells use via getGridOffset — so the wrapper
  // itself must stay untransformed, or a marker layer's pan would apply
  // twice.
  if (!isTileBaseMap(map) && layer.type !== "marker") {
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
    const isSelected = isLayerSelected || isGridCellsSelected || isMarkerElementSelected;
    const groupCells = options.activeGroup ? getGroupCellsForLayer(options.activeGroup, layer) : [];
    const wrapper = createLayerWrapper(map, layer, isSelected);
    let element = null;
    const layerPosition = getLayerRenderPosition(layer, getLayerPositionScale());
    const renderState = isTileBaseMap(map) ? { position: layerPosition, sizeScale: getLayerSizeScale() } : {};
    if (layer.type === "grid") {
      element = createGridLayerElement(baseMapManager, map, layer, {
        isInteractive: isSelected,
        selectedCells: isGridCellsSelected ? selection.cells : [],
        groupCells,
        onPointerDown: options.onGridCellPointerDown ? (coord, event) => options.onGridCellPointerDown(layer, coord, event) : undefined,
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
      });
    } else {
      element = createVectorLayerElement(layer, renderState);
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
