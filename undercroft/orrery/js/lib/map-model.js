const randomId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(16).slice(2)}-${Date.now()}`;
};

export const BASE_MAP_TYPES = ["tile", "image", "canvas"];
export const LAYER_TYPES = ["vector", "grid", "raster", "marker"];

export function createLayerSettings(type) {
  switch (type) {
    case "grid":
      return {
        gridType: "square",
        cellSize: 50,
        lineColor: "#0f172a",
        // Fog of War — see map-viewer.js's resolveRevealedCells/
        // createFogOverlay for how these drive rendering. fogOpacity is
        // what a real non-owner viewer sees over a hidden cell; fogPreviewOpacity
        // is the much-lighter authoring aid the map's own owner/GM sees
        // instead (createGridLayerElement's ownerPreview branch) so fog
        // stays visible while editing without actually hiding the map.
        // Both configurable independently since "opaque enough a player
        // can't cheat" and "visible enough a GM can actually see it while
        // working" are different, unrelated targets.
        fogOfWar: false,
        revealGroupId: "",
        fogOpacity: 0.92,
        fogPreviewOpacity: 0.6,
      };
    case "raster":
      // No default width/height — same "native size unless overridden"
      // reasoning as the base map image's own settings just above
      // (createBaseMapSettings), for the same reason: an arbitrary
      // hardcoded default force-stretched/skewed every raster image that
      // wasn't exactly that size.
      return {
        src: "",
        width: null,
        height: null,
      };
    case "marker":
      // No default icon — "pin" isn't a real ddb-*/bi-* token (createMarkerDot's
      // own getIconTokens lookup just silently found nothing for it), so
      // every new marker layer rendered as a plain colored dot anyway; blank
      // makes that the actual, honest default instead of a fake-looking
      // configured icon that never did anything.
      return {
        icon: "",
        size: 24,
        color: "#0ea5e9",
        // Outline — every marker already draws a ring (border) around its
        // dot/portrait; these just make its color/width configurable
        // instead of a fixed, uneditable CSS default (2px, theme body-bg).
        outlineColor: "#0f172a",
        outlineWidth: 2,
        // Label — off by default (a dense map with every marker's name
        // permanently visible gets cluttered fast); explicit values here
        // rather than left unset, same "no invisible defaults" rule the
        // rest of this settings object already follows.
        showLabels: false,
        labelPosition: "below",
        labelSize: 12,
      };
    case "vector":
    default:
      return {
        strokeColor: "#0f172a",
        fillColor: "#93c5fd",
        strokeWidth: 2,
      };
  }
}

export function createBaseMapSettings() {
  return {
    tile: {
      provider: "OpenStreetMap Standard",
      urlTemplate: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors",
      minZoom: 1,
      maxZoom: 19,
      initialZoom: 2,
    },
    // Deliberately no default width/height (unlike canvas's own explicit
    // dimensions below, which have nothing else to size against) — an
    // uploaded image renders at its own native size unless the GM
    // explicitly overrides one/both (see base-maps.js's own
    // applyImageDimensions), rather than always being force-stretched to
    // whatever a stale hardcoded default happened to be.
    image: {
      src: "data/sample-map.svg",
      width: null,
      height: null,
    },
    canvas: {
      width: 1600,
      height: 1000,
      background: "#f8f9fa",
    },
  };
}

export function getDefaultView(type) {
  if (type === "tile") {
    return {
      mode: "geo",
      zoom: 2,
      center: { lat: 20, lng: 0 },
      pan: { x: 0, y: 0 },
    };
  }
  return {
    mode: "cartesian",
    zoom: 1,
    center: { lat: 0, lng: 0 },
    pan: { x: 0, y: 0 },
  };
}

export function createLayer({ type = "vector", name } = {}) {
  const safeType = LAYER_TYPES.includes(type) ? type : "vector";
  return {
    id: randomId(),
    type: safeType,
    name: name || `${safeType.charAt(0).toUpperCase()}${safeType.slice(1)} Layer`,
    visible: true,
    opacity: safeType === "grid" ? 0.35 : 1,
    position: { x: 0, y: 0 },
    elements: [],
    settings: createLayerSettings(safeType),
    properties: {},
  };
}

export function createGridCell({ key, coord, gridType = "square" } = {}) {
  return {
    id: randomId(),
    kind: "cell",
    key: key || randomId(),
    gridType,
    coord: coord || { col: 0, row: 0 },
    properties: {},
  };
}

// A single placed pin on a marker layer. `refKind`/`refId` optionally point at
// a real Library entity (any kind — location, npc, monster, ...); `label`
// stands alone if there's no reference yet, or defaults to the entity's own
// name once one is picked. Mirrors Sanctum's Assets/Needs reference shape
// ({ kind, refId, label }) but keyed refKind/refId to avoid colliding with
// this element's own `kind: "marker"` discriminator (the same convention
// createGridCell's `kind: "cell"` already establishes for layer elements).
// `image`, when set, supersedes the marker layer's own default icon/color
// dot for THIS marker only (see map-viewer.js's createMarkerDot) — either
// picked/typed directly, or auto-copied once from the referenced record's
// own `image` field the moment refKind/refId is picked (see
// orrery/js/app.js's renderMarkerElementSelectionEditor), same "copy once at
// pick-time, stays user-editable after" precedent `label` already follows
// just below. `sizeCells` is a multiplier on the map's own grid cell size
// (createMarkerDot), not raw pixels — same "the number means the same
// thing the ruler already shows" reasoning a shape's own sizeCells follows
// — 1 is a normal one-square token, 2 a Large creature's 2x2 footprint, etc.
// `outlineColor`, when set, supersedes the marker LAYER's own outline
// color default for THIS marker only (same override relationship `image`
// already has with the layer's icon/color) — blank means "use the layer's
// own outline," not "no outline." Auto-copied once from the signed-in
// user's own Favorite Color account setting the moment a Library entity is
// linked (same copy-once-at-pick-time precedent as `image`/`label`), not
// re-applied on every render.
export function createMarkerElement({ refKind = "", refId = "", label = "", image = "", outlineColor = "", position, sizeCells = 1 } = {}) {
  return {
    id: randomId(),
    kind: "marker",
    refKind,
    refId,
    label,
    image,
    outlineColor,
    position: position || { x: 0, y: 0 },
    sizeCells: Number.isFinite(sizeCells) && sizeCells > 0 ? sizeCells : 1,
  };
}

// One freehand-drawn stroke on a vector layer. `points` is an array of
// positions in the SAME shape a marker element's own `.position` uses
// ({x,y} for image/canvas, {lat,lng} for tile — see map-viewer.js's
// markerPositionToLocalPixel), so a drawn path pans/zooms exactly like a
// placed marker does, point by point. Stroke/fill/width default to the
// layer's own settings at draw time (layer.settings.strokeColor/fillColor/
// strokeWidth) but are captured per-path here rather than always read live
// off the layer, so changing the layer's default color later doesn't
// retroactively repaint every already-drawn stroke.
export function createVectorPathElement({ points = [], strokeColor, fillColor, strokeWidth } = {}) {
  return {
    id: randomId(),
    kind: "path",
    points,
    strokeColor: strokeColor || "#0f172a",
    fillColor: fillColor || "none",
    strokeWidth: strokeWidth || 2,
  };
}

export const AOE_SHAPE_TYPES = ["circle", "cone", "line", "square"];

// An AoE measurement template (Circle/Cone/Line/Square) — lives in the SAME
// layer.elements array a drawn path does, on a vector layer, so it inherits
// that layer's own stroke/fill color settings and the exact same select/
// delete editor a path already has (see app.js's renderVectorPathSelection
// Editor and map-viewer.js's createVectorLayerElement dispatch), rather than
// a parallel data shape only some of that machinery understands.
//
// `sizeCells`/`widthCells` are in GRID CELLS, not raw pixels — the same unit
// the Measure tool already converts through (getGridCellSize +
// state.map.measurement.scale/unit, see app.js's formatDistance) — so a
// shape's rendered size stays correct across zoom and across image/canvas
// vs. tile base maps with no new coordinate math, and the number a GM types
// means the same thing the ruler already shows them.
// `opacity`/`snapToGrid` both always land on the element with a real,
// concrete value at creation time (0.5 / true) — never left unset for a
// "falls back to some default at render time" branch to paper over later,
// same "no invisible defaults" rule strokeColor/fillColor/strokeWidth just
// below already follow. That's what makes them safe to show as ordinary,
// already-populated inspector fields the instant a shape is placed, not
// fields that mysteriously start blank.
export function createVectorShapeElement({
  shapeType,
  origin,
  sizeCells = 1,
  angleDeg = 0,
  spreadDeg = 53,
  widthCells = 1,
  strokeColor,
  fillColor,
  strokeWidth,
  opacity,
  snapToGrid,
} = {}) {
  return {
    id: randomId(),
    kind: "shape",
    shapeType: AOE_SHAPE_TYPES.includes(shapeType) ? shapeType : "circle",
    origin: origin || { x: 0, y: 0 },
    sizeCells,
    angleDeg,
    spreadDeg,
    widthCells,
    strokeColor: strokeColor || "#0f172a",
    fillColor: fillColor || "#93c5fd",
    strokeWidth: strokeWidth || 2,
    opacity: Number.isFinite(opacity) ? opacity : 0.5,
    snapToGrid: snapToGrid !== false,
  };
}

export function createGroup({ name } = {}) {
  return {
    id: randomId(),
    name: name || "New Group",
    elementIds: [],
    properties: {},
  };
}

export function createView({ name, description, layerIds = [], groupIds = [], tiers = [] } = {}) {
  return {
    id: randomId(),
    name: name || "New View",
    description: description || "",
    layerIds: Array.isArray(layerIds) ? layerIds.filter(Boolean) : [],
    groupIds: Array.isArray(groupIds) ? groupIds.filter(Boolean) : [],
    tiers: Array.isArray(tiers) ? tiers.filter(Boolean) : [],
    settings: {},
  };
}

export function createMapModel({ name = "New Orrery Map", baseMapType = "tile" } = {}) {
  const baseSettings = createBaseMapSettings();
  const type = BASE_MAP_TYPES.includes(baseMapType) ? baseMapType : "tile";
  return {
    id: randomId(),
    name,
    baseMap: {
      type,
      settings: baseSettings,
      properties: {},
    },
    view: getDefaultView(type),
    // The view a map ALWAYS opens to (see resolveInitialView below and
    // app.js's own applyMapSnapshot), independent of `view` above — that
    // one keeps live-syncing with wherever the camera actually is during
    // an editing session (pan/zoom/Reset all write through it), so it's
    // NOT a stable "start here" value on its own; a map reopened later
    // would otherwise just resume wherever a previous session's camera
    // happened to be left. Deliberately DOES default to real values (zoom
    // 1, pan {0,0}), unlike measurement's own "stays unset until
    // configured" convention just below — these specific numbers are meant
    // to be the out-of-the-box default the GM sees, not an unset "don't
    // use this yet" case the way an unconfigured scale is.
    initialView: { zoom: 1, pan: { x: 0, y: 0 } },
    layers: [createLayer({ type: "grid", name: "Primary Grid Layer" })],
    groups: [],
    views: [],
    properties: {},
    // Deliberately no default scale/unit (unlike the rest of this model,
    // which mostly ships opinionated defaults) — the Measure tool reads
    // this and stays disabled until the GM sets both, rather than silently
    // measuring against an invented number nobody configured. One value for
    // the whole map (not per-grid-layer) since a map's grid squares always
    // represent the same real-world distance regardless of which layer
    // happens to be selected.
    measurement: { scale: null, unit: "" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Resolves the ACTUAL view a map should open at — getDefaultView(type)'s
// own per-type baseline (mode/center included, for tile maps' own geo
// mode), with the map's own configured Initial Zoom/Position applied on
// top. Tolerant of a map saved before this field existed (no `initialView`
// at all, or a partial one) — falls back to the type's own default
// zoom/pan exactly as before this feature existed, so opening an older
// saved map doesn't suddenly jump to a different starting view than it
// always has.
export function resolveInitialView(map) {
  const defaultView = getDefaultView(map.baseMap?.type);
  const initialView = map.initialView || {};
  return {
    ...defaultView,
    zoom: Number.isFinite(initialView.zoom) ? initialView.zoom : defaultView.zoom,
    pan: {
      x: Number.isFinite(initialView.pan?.x) ? initialView.pan.x : defaultView.pan.x,
      y: Number.isFinite(initialView.pan?.y) ? initialView.pan.y : defaultView.pan.y,
    },
  };
}

export function updateBaseMapType(model, type) {
  const safeType = BASE_MAP_TYPES.includes(type) ? type : "tile";
  model.baseMap.type = safeType;
  model.view = getDefaultView(safeType);
  model.updatedAt = new Date().toISOString();
}

export function updateMapTimestamp(model) {
  model.updatedAt = new Date().toISOString();
}
