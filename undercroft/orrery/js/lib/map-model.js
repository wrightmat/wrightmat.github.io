// getPresetById/getPresetDefaultValues only get called from
// createVectorShapeElement below, never at module load — safe to import
// here despite this file otherwise being pure/DOM-free.
import { getPresetById, getPresetDefaultValues } from "../../../common/js/lib/shape-effect-library.js";

export const randomId = () => {
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
        // createFogOverlay. fogOpacity is what a real non-owner viewer sees
        // over a hidden cell; fogPreviewOpacity is the lighter authoring aid
        // the map's owner/GM sees instead, configurable independently since
        // "opaque enough a player can't cheat" and "visible enough a GM can
        // work" are different targets.
        fogOfWar: false,
        revealGroupId: "",
        fogOpacity: 0.92,
        fogPreviewOpacity: 0.6,
        // When on, resolveRevealedCells additionally reveals cells within
        // line-of-sight of any character-linked marker with a nonzero
        // resolved Vision Range, unioned with the manual reveal-Group cells,
        // wall-aware. Off by default so fog can stay purely manual unless
        // the GM opts in. A placed Light always contributes to the reveal
        // union whenever fogOfWar is on — there's no equivalent toggle for it.
        autoRevealFromVision: false,
      };
    case "raster":
      // No default width/height, same "native unless overridden" reasoning
      // as the base map image's own settings — an arbitrary hardcoded
      // default would force-stretch/skew any image not exactly that size.
      return {
        src: "",
        width: null,
        height: null,
      };
    case "marker":
      // No default icon — "pin" isn't a real ddb-*/bi-* token, so a new
      // marker layer already rendered as a plain colored dot regardless;
      // blank makes that the honest default instead of a fake-looking one.
      return {
        icon: "",
        size: 24,
        color: "#0ea5e9",
        // Every marker already draws a ring around its dot/portrait; these
        // make its color/width configurable instead of a fixed CSS default.
        outlineColor: "#0f172a",
        outlineWidth: 2,
        // Off by default — a dense map with every marker's name permanently
        // visible gets cluttered fast.
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
    // No default width/height (unlike canvas's own explicit dimensions,
    // which have nothing else to size against) — an uploaded image renders
    // at its native size unless the GM explicitly overrides one/both.
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
    // Independent of `visible` — a locked layer stays fully rendered but
    // click/drag-through (map-viewer.js's renderMapLayers ANDs every
    // interactivity gate with `!layer.locked`), so a large hit target (a
    // full-map Weather effect) can't steal clicks without also hiding it.
    // Selecting the layer itself is never blocked by its own lock.
    locked: false,
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

// A single placed pin on a marker layer. `refKind`/`refId` optionally point
// at a real Library entity; `label` stands alone with no reference, or
// defaults to the entity's own name once one is picked. Mirrors Sanctum's
// Assets/Needs reference shape but keyed refKind/refId to avoid colliding
// with this element's own `kind: "marker"` discriminator.
export function createMarkerElement({
  refKind = "", refId = "", refAnchor = null, label = "", image = "", outlineColor = "", showOutline = true, shape = "circle", position, sizeCells = 1, heightCells = 0, opacity = 1,
  visionRangeBinding = "", visionRangeFormula = "", visionRangeText = "0", linkedCombatantId = "",
  contents = [], claimTarget = "character",
} = {}) {
  return {
    id: randomId(),
    kind: "marker",
    refKind,
    refId,
    // Meaningful only when refKind === "journal" — null means the whole
    // page (like Handout's own contentRef.anchor); {type: "heading"|"quest",
    // value} narrows to one heading or quest callout.
    refAnchor,
    label,
    // Supersedes the marker layer's own default icon/color dot for THIS
    // marker only — either picked/typed directly, or auto-copied once from
    // the referenced record's own `image` field at pick-time (see app.js's
    // renderMarkerElementSelectionEditor), staying user-editable after.
    image,
    // Supersedes the marker LAYER's own outline color for THIS marker only;
    // blank means "use the layer's own outline," not "no outline." Auto-
    // copied once from the signed-in user's Favorite Color the moment a
    // Library entity is linked, not re-applied on every render.
    outlineColor,
    // `true` (shown) so every marker created before this field existed keeps
    // rendering as it always has. Turned off for a token needing a clean,
    // borderless edge-to-edge fill (a chest, say).
    showOutline: showOutline !== false,
    // "circle" keeps pre-existing markers rendering unchanged; "square"
    // fills the marker's cell edge-to-edge for tokens whose art shouldn't
    // get clipped into a circle. Independent of showOutline.
    shape: shape === "square" ? "square" : "circle",
    position: position || { x: 0, y: 0 },
    // Multiplier on the map's own grid cell size, not raw pixels — 1 is a
    // normal one-square token, 2 a Large creature's 2x2 footprint.
    sizeCells: Number.isFinite(sizeCells) && sizeCells > 0 ? sizeCells : 1,
    // Off-the-ground offset, same grid-cell unit as sizeCells — positive is
    // flying above the surface, negative burrowing/submerged below it.
    // createMarkerDot gives the two directions distinct visual treatments
    // (shadow vs. dashed outline) rather than one style with a sign flip.
    heightCells: Number.isFinite(heightCells) ? heightCells : 0,
    // Per-marker, not per-layer — a token fading in/out (unconscious,
    // hidden) is a property of that ONE placed marker.
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
    // Small status/condition badges — a marker can carry several at once
    // (the normal case in play), each its own createMarkerOverlayIcon
    // entry. Purely visual; a linked Character/Monster/NPC's own LIVE
    // conditions are resolved separately at render time from its own
    // record or active-Encounter combatant, never written in here.
    overlayIcons: [],
    // Binding/Formula/Text resolution order for Vision Range (see
    // map-viewer.js's resolveMarkerVisionRangeCells): formula wins if set,
    // else an "@dotted.path" binding into the linked Character's record (no
    // cross-system standard field for this, e.g. Darkvision — always
    // whatever the GM picks), else the literal text. Starts in literal-Text
    // mode ("0" = off) so a new marker is usable with no Binding setup.
    // Meaningful only when refKind==="character" and Fog's own
    // autoRevealFromVision is on; harmlessly inert otherwise.
    visionRangeBinding,
    visionRangeFormula,
    visionRangeText,
    // Only meaningful for refKind "monster"/"npc" — disambiguates WHICH
    // combatant instance in the active Encounter this marker represents,
    // needed when more than one combatant shares this refId (e.g. three
    // Goblins sharing one Monster record — records are reusable templates,
    // never mutated per-instance). A stale/blank id falls back to "exactly
    // one refId match, if there is one" — self-heals with no manual cleanup.
    linkedCombatantId,
    // Any marker can carry loot — same "layer a capability onto any marker"
    // relationship Light/Shape's own attachedMarkerId has, rather than a
    // separate "Container" marker type. `contents.length === 0` IS "empty,"
    // no separate boolean.
    contents,
    // Which pool a player claiming from this container's contents lands in
    // — "character" (their own inventory) or "party" (the campaign Group's
    // shared Party Inventory). A per-container GM choice.
    claimTarget: claimTarget === "party" ? "party" : "character",
  };
}

// One item, currency amount, or Vault Wonder reference inside a marker's
// `contents`. An "item"/"wonder" entry mirrors a Character's own
// `inventory` entry ({name, quantity, notes, weight?}) almost exactly,
// since claiming one is close to a direct copy into that array; `refId`
// (wonder only) lets a claimed entry stamp refKind/refId onto the new row.
// A "currency" entry claims into a Character's `currencies` object instead
// (never the shared Party Inventory — see marker-contents.js's
// claimMarkerContentEntry), keyed by `denomination` — the active System's
// own `currency` field shortName (e.g. "gp"), resolved at authoring time
// against real System data, never a hardcoded vocabulary.
export function createMarkerContentEntry({ kind = "item", name = "", quantity = 1, notes = "", weight, refId = "", denomination = "" } = {}) {
  const safeKind = kind === "wonder" ? "wonder" : kind === "currency" ? "currency" : "item";
  return {
    id: randomId(),
    kind: safeKind,
    name,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    notes,
    weight: Number.isFinite(weight) ? weight : undefined,
    refId: safeKind === "wonder" ? refId : "",
    denomination: safeKind === "currency" ? denomination : "",
  };
}

// One condition/status badge on a marker. `color` is the badge's own
// background — a dark neutral default reads fine against most token art,
// but a GM can color-code (e.g. red for damage-over-time).
export function createMarkerOverlayIcon({ icon = "", color = "#1e293b", label = "" } = {}) {
  return {
    id: randomId(),
    icon,
    color: color || "#1e293b",
    label,
  };
}

// One freehand-drawn stroke on a vector layer. `points` uses the same
// position shape a marker's own `.position` uses ({x,y} or {lat,lng}), so a
// path pans/zooms exactly like a placed marker. Stroke/fill/width default
// to the layer's own settings at draw time but are captured per-path here,
// so changing the layer's default later doesn't repaint already-drawn strokes.
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

// A placed Shape or Effect (Circle/Square/Cone/Line, or an animated preset
// like Burst/Beam/Cone Blast/Pulse — shape-effect-library.js's
// SHAPE_EFFECT_PRESETS is the source of truth). Lives in the SAME
// layer.elements array a drawn path does, on a vector layer, so it inherits
// that layer's select/delete editor machinery. Only one placement path — a
// `kind: "particles"` preset with `loop: false` is an ordinary saved
// element that plays once per placement/re-trigger, not a temporary object.
//
// `sizeCells`/`widthCells` are grid cells, not raw pixels — same unit the
// Measure tool converts through, so size stays correct across zoom and
// across image/canvas vs. tile base maps. `values` replaces the old fixed
// strokeColor/fillColor pair — one flat object holding whatever the chosen
// preset's colorSlots/params resolve to (getPresetDefaultValues on
// creation). `attachedMarkerId` mirrors createLightElement's own field
// (map-viewer.js's resolveElementOrigin resolves either kind's live
// position the same way). `label`/`loop` only matter for particle presets.
export function createVectorShapeElement({
  presetId,
  origin,
  attachedMarkerId = "",
  label = "",
  loop = true,
  sizeCells = 1,
  angleDeg = 0,
  spreadDeg = 53,
  widthCells = 1,
  values,
  strokeWidth,
  opacity,
  snapToGrid,
} = {}) {
  const preset = getPresetById(presetId) || getPresetById("circle");
  return {
    id: randomId(),
    kind: "shape",
    presetId: preset.id,
    origin: origin || { x: 0, y: 0 },
    attachedMarkerId,
    label,
    loop: loop !== false,
    sizeCells,
    angleDeg,
    spreadDeg,
    widthCells,
    values: values || getPresetDefaultValues(preset),
    strokeWidth: strokeWidth || 2,
    opacity: Number.isFinite(opacity) ? opacity : 0.5,
    snapToGrid: snapToGrid !== false,
  };
}

// A wall OR a door — one element kind, distinguished by wallType, rather
// than two kinds duplicating the same vision/movement-blocking logic (see
// map-viewer.js's resolveBlockingSegments, which treats a closed door like
// a wall and an open one as no obstruction). Lives in the same vector layer
// elements array as a path/shape, for the same editor-reuse reason.
// `points` is an arbitrary-length polyline in the same position shape a
// path uses — deliberately NOT grid-cell-based, since walls trace real map
// geometry at any angle/length. A door is a simple 2-point segment;
// wallType==="wall" ignores doorState/secret/locked but still stores
// harmless defaults for them.
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
    // even before door-specific styling layers on top.
    strokeColor: strokeColor || "#0f172a",
    strokeWidth: strokeWidth || 3,
    // Defaults ON — a wall blocks both light and fog, and fog is only ever
    // square-grid-cell granular anyway, so an off-grid wall buys no real
    // precision while making it harder to keep aligned with neighbors.
    // Toggleable per-wall for the rare off-grid-angle case.
    snapToGrid: snapToGrid !== false,
  };
}

// A freestanding OR token-attached placed light — one element kind,
// distinguished by attachedMarkerId. Freestanding: `origin` is the light's
// authored position. Attached: origin is still stored (a graceful fallback
// if the host marker is later deleted) but resolveLightOrigin resolves the
// LIVE position from that marker each render instead — e.g. a torch a
// character carries. rangeCells is grid cells, same convention as a
// shape's sizeCells. A light always both glows AND reveals fog within its
// own wall-aware line-of-sight — no separate "cosmetic only" mode.
export function createLightElement({
  origin, attachedMarkerId = "", rangeCells = 4, color = "#fbbf24", opacity = 0.5,
} = {}) {
  return {
    id: randomId(),
    kind: "light",
    origin: origin || { x: 0, y: 0 },
    attachedMarkerId,
    rangeCells: Number.isFinite(rangeCells) && rangeCells > 0 ? rangeCells : 4,
    // A warm amber (Tailwind's amber-400) — the default "torch" color, never
    // the containing vector layer's own blue fillColor default.
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

// A View's visibility fields are DENY-lists (empty = nothing hidden), not
// allow-lists — so a brand new layer/marker/path/shape/wall/light is
// visible everywhere by default with zero per-View bookkeeping, and a
// freshly auto-created View (app.js's toggleElementHiddenFromPlayers) can
// never accidentally hide something nobody unchecked.
export function createView({ name, description, hiddenLayerIds = [], hiddenElementIds = [], tiers = [], autoManaged = false } = {}) {
  return {
    id: randomId(),
    name: name || "New View",
    description: description || "",
    hiddenLayerIds: Array.isArray(hiddenLayerIds) ? hiddenLayerIds.filter(Boolean) : [],
    hiddenElementIds: Array.isArray(hiddenElementIds) ? hiddenElementIds.filter(Boolean) : [],
    tiers: Array.isArray(tiers) ? tiers.filter(Boolean) : [],
    // True only for the one View toggleElementHiddenFromPlayers manages for
    // itself — lets that convenience toggle reuse its own View by a stable
    // marker rather than guessing off name/tiers.
    autoManaged: Boolean(autoManaged),
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
    // The view a map ALWAYS opens to (see resolveInitialView), independent
    // of `view` above — that one keeps live-syncing with the camera during
    // an editing session, so it's not a stable "start here" value on its
    // own. Defaults to real values (zoom 1, pan {0,0}) as the out-of-the-box
    // default, unlike measurement's own deliberately-unset convention below.
    initialView: { zoom: 1, pan: { x: 0, y: 0 } },
    layers: [createLayer({ type: "grid", name: "Primary Grid Layer" })],
    groups: [],
    views: [],
    properties: {},
    // No default scale/unit — the Measure tool stays disabled until the GM
    // sets both, rather than silently measuring against an invented number.
    // One value for the whole map, since grid squares always represent the
    // same real-world distance regardless of which layer is selected.
    measurement: { scale: null, unit: "" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Resolves the ACTUAL view a map should open at — getDefaultView(type)'s
// per-type baseline with the map's configured Initial Zoom/Position applied
// on top. Tolerant of a map saved before this field existed (no
// `initialView`, or a partial one) — falls back to the type's own default
// so an older saved map doesn't jump to a different starting view.
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
