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
        // When on, resolveRevealedCells (map-viewer.js) additionally reveals
        // cells within line-of-sight of any character-linked marker that has
        // a nonzero resolved Vision Range (see createMarkerElement's own
        // visionRangeBinding/visionRangeFormula/visionRangeText) — unioned
        // with the manual reveal-Group cells above, wall-aware. Off by
        // default: a map's fog can stay purely manual, same as it always
        // has, unless the GM opts into auto-reveal. Light-based reveal has
        // no equivalent toggle — a placed Light element always contributes
        // to the reveal union whenever fogOfWar itself is on, since a
        // light's whole purpose is to reveal; there'd be nothing left for it
        // to do with this off.
        autoRevealFromVision: false,
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
// Vision range — the same "Binding / Formula / Text" shape every other
// bindable field in this suite uses (see common/js/lib/binding-field.js's
// own createBindingFormulaInput, and undercroft/common/docs/code-
// conventions.md's Component Inspector standards): visionRangeFormula wins
// if set, else visionRangeBinding (an "@dotted.path" into the linked
// Character's own record — there is no cross-system standard field for
// this, e.g. Darkvision, so it's always "whatever numeric field the GM
// picks from that Character's own System," never a hardcoded name), else
// the literal visionRangeText — see map-viewer.js's
// resolveMarkerVisionRangeCells for the actual resolution order. Starts in
// literal-Text mode ("0" = off) so a brand-new marker's Vision Range field
// is immediately usable with no Binding setup required first, exactly like
// a new Text component starts at a plain literal value in Workbench.
// Meaningful only when refKind==="character" and Fog of War's own
// autoRevealFromVision is on, but harmlessly inert otherwise — same "no
// error/hidden state for an inapplicable field" precedent a wall's own
// doorState follows on a plain (non-door) wall.
export function createMarkerElement({
  refKind = "", refId = "", refAnchor = null, label = "", image = "", outlineColor = "", position, sizeCells = 1, opacity = 1,
  visionRangeBinding = "", visionRangeFormula = "", visionRangeText = "0",
} = {}) {
  return {
    id: randomId(),
    kind: "marker",
    refKind,
    refId,
    // Meaningful only when refKind === "journal" — `null` (the default)
    // means the whole page, same as Handout's own contentRef.anchor;
    // `{type: "heading"|"quest", value}` narrows it to one heading's own
    // section or one quest's own callout, matching the exact same
    // reference-target granularity common/js/lib/widgets/handout.js's own
    // picker offers for a journal-kind selection — see
    // orrery/js/app.js's own renderMarkerElementSelectionEditor for where
    // it's populated/read.
    refAnchor,
    label,
    image,
    outlineColor,
    position: position || { x: 0, y: 0 },
    sizeCells: Number.isFinite(sizeCells) && sizeCells > 0 ? sizeCells : 1,
    // Per-marker, not per-layer — a token fading in/out (an unconscious or
    // hidden creature, say) is a property of that ONE placed marker, not
    // every marker on the layer, same "override, not a layer-wide setting"
    // relationship outlineColor already has. 1 (fully opaque) is the real,
    // concrete default — never left unset (createFieldRow's own opacity
    // sliders throughout this file all follow the same "no invisible
    // defaults" rule).
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
    // Small status/condition badges (poisoned, prone, concentrating, ...) —
    // a marker can carry several at once, the normal case in actual play
    // (a creature is often more than one condition simultaneously), each
    // its own createMarkerOverlayIcon entry (icon token + a badge color).
    // Purely visual, map-viewer.js's own createMarkerDot renders them; no
    // mechanical effect on vision/movement the way a wall/door's own state
    // has.
    overlayIcons: [],
    visionRangeBinding,
    visionRangeFormula,
    visionRangeText,
  };
}

// One condition/status badge on a marker (createMarkerElement's own
// overlayIcons array) — same small-sub-record-with-its-own-id shape
// createGridCell/createGroup already establish for this file's other
// nested records, so each entry can be individually removed by id. `color`
// is the badge's own background (a dark neutral default reads fine against
// most token art without needing per-condition color-coding, but the GM
// can still color-code if they want — e.g. red for damage-over-time).
export function createMarkerOverlayIcon({ icon = "", color = "#1e293b", label = "" } = {}) {
  return {
    id: randomId(),
    icon,
    color: color || "#1e293b",
    label,
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

// A wall OR a door — same element kind, distinguished by wallType, rather
// than two parallel kinds duplicating the same vision/movement-blocking
// logic (see map-viewer.js's resolveBlockingSegments, which treats a closed
// door exactly like a wall and an open one as no obstruction at all). Lives
// in the SAME layer.elements array a path/shape does, on a vector layer —
// same reasoning createVectorShapeElement's own header comment already
// gives for shapes: it inherits that layer's own stroke color/width
// settings and the general select/delete editor machinery, no parallel data
// shape needed. `points` is an arbitrary-length polyline in the SAME
// position shape a path's own points use ({x,y}/{lat,lng}) — deliberately
// NOT grid-cell-based (unlike a shape's sizeCells) since walls trace real
// map geometry at any angle/length, not measured distances. A door is
// authored as a simple 2-point segment; wallType==="wall" ignores
// doorState/secret/locked entirely but still stores real, harmless
// defaults for them rather than leaving them unset — same "no invisible
// defaults" rule this file already follows throughout.
export const WALL_TYPES = ["wall", "door"];

export function createWallElement({
  points = [], wallType = "wall", doorState = "closed", secret = false, locked = false,
  strokeColor, strokeWidth, snapToGrid,
} = {}) {
  return {
    id: randomId(),
    kind: "wall",
    points,
    wallType: WALL_TYPES.includes(wallType) ? wallType : "wall",
    doorState: doorState === "open" ? "open" : "closed",
    secret: Boolean(secret),
    locked: Boolean(locked),
    // Heavier than a plain path's own 2px default — reads as structural
    // even before any door-specific styling is layered on top.
    strokeColor: strokeColor || "#0f172a",
    strokeWidth: strokeWidth || 3,
    // Defaults ON (unlike a shape's own snapToGrid, which also defaults on
    // but for a softer reason) — a wall blocks both light and fog, and fog
    // is only ever square-grid-cell granular anyway, so an off-grid wall
    // buys no real precision while making it harder to keep straight/
    // aligned with neighboring walls. setupWallTool's own placement gesture
    // snaps each vertex through this same flag (reusing
    // snapShapeOriginToGrid — genuinely generic, not shape-specific,
    // despite the name); toggleable per-wall afterward via the inspector
    // for the rare case an off-grid angle is actually wanted.
    snapToGrid: snapToGrid !== false,
  };
}

// A freestanding OR token-attached placed light — same element kind either
// way, distinguished by attachedMarkerId. Freestanding: `origin` is the
// light's own authored position, exactly like a shape's own origin.
// Attached: origin is still stored (last-known position, a graceful
// fallback if the host marker is later deleted so the light doesn't
// vanish/error, just stops moving) but map-viewer.js's resolveLightOrigin
// resolves the light's LIVE position from that marker instead every render
// — e.g. a torch a player's character is carrying. rangeCells is grid
// cells, same unit convention as a shape's own sizeCells. A light always
// both glows AND reveals fog within its own wall-aware line-of-sight (see
// resolveRevealedCells/renderLightElement) — there's no separate "cosmetic
// only" mode, matching the user's own confirmed "dynamic lighting" scope.
export function createLightElement({
  origin, attachedMarkerId = "", rangeCells = 4, color = "#fbbf24", opacity = 0.5,
} = {}) {
  return {
    id: randomId(),
    kind: "light",
    origin: origin || { x: 0, y: 0 },
    attachedMarkerId,
    rangeCells: Number.isFinite(rangeCells) && rangeCells > 0 ? rangeCells : 4,
    // A warm amber/yellow (Tailwind's amber-400) — the default "torch"
    // color, not a themed accent blue. Never falls back to the containing
    // vector layer's own fillColor default (which IS blue,
    // createLayerSettings("vector")'s own #93c5fd) — that's a shape-fill
    // convention, not a sensible light-source default.
    color: color || "#fbbf24",
    opacity: Number.isFinite(opacity) ? opacity : 0.5,
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
