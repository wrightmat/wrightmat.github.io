import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import {
  createJsonDataPanel,
  createIconButton,
  createToolbarButtonGroup,
  createCompactField,
  createButtonCheckGroup,
  createCheckField,
  createIconPickerField,
  createFormFloatingField,
  createEmptyStateCard,
  // Aliased — inspector-fields.js's own createCollapsibleSection (positional
  // title/fields/{defaultCollapsed} form) is already imported under the bare
  // name below; this is the OTHER, object-arg createCollapsibleSection
  // (label/content/actions/helpTopic), needed here only for the new
  // Selections section.
  createCollapsibleSection as createFullCollapsibleSection,
  createSearchableCheckList,
  createListRow,
} from "../../common/js/lib/ui-components.js";
import { openContentPicker } from "../../common/js/lib/widgets/content-picker.js";
import { claimMarkerContentEntry, describeMarkerContentEntry, resolveGiveToOptions } from "../../common/js/lib/marker-contents.js";
import { resolveGroupContext } from "../../common/js/lib/widgets/group-context.js";
import { createFieldRow, createHalfWidthNumberField, createCollapsibleSection } from "../../common/js/lib/inspector-fields.js";
import { exportRecordAsJson, populateStringChecklist, readLockedFeatureIds } from "../../common/js/lib/generator-kit.js";
import {
  watchMapForChanges,
  persistMarkerMove as persistMarkerMoveShared,
  persistElementUpdate,
  persistNewElement,
  removeElement,
} from "../../common/js/lib/map-live-sync.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { refreshTooltips, disposeTooltips, initTooltip, setDisabledTooltip } from "../../common/js/lib/tooltips.js";
import { createColorPickerField } from "../../common/js/lib/color-picker.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { fetchKindEntriesWithIds } from "../../common/js/lib/content-fetch.js";
import { extractOutline } from "../../repository/js/lib/journal-outline.js";
import { extractQuests } from "../../repository/js/lib/journal-quests.js";
import { createTokenImageField } from "../../common/js/lib/token-picker.js";
import { getIconTokens } from "../../common/js/lib/icon-picker.js";
import { refreshOwnershipCatalog, createCharacterOwnershipPrimer, confirmDelete, matchesOwner } from "../../common/js/lib/ownership.js";
import { collectSystemFields } from "../../common/js/lib/system-schema.js";
import { createBindingFormulaInput } from "../../common/js/lib/binding-field.js";
import { findBindingByRole, findBindingsByRole } from "../../common/js/lib/bindings.js";
import { deriveCombatBindings, guessBarResourceName } from "../../common/js/lib/widgets/combat-bindings.js";
import { initToolSettings } from "../../common/js/lib/tool-settings.js";
import { deriveConditionsVocabulary } from "../../common/js/lib/widgets/tag-editor.js";
import { resolveActiveSpotlightId } from "../../common/js/lib/spotlight.js";
import { connectLiveStream } from "../../common/js/lib/live.js";
import { getPresetById, getPresetsByCategory, getPresetDefaultValues, SHAPE_EFFECT_CATEGORIES } from "../../common/js/lib/shape-effect-library.js";
import {
  createGroup,
  createGridCell,
  createLayer,
  createLayerSettings,
  createMapModel,
  createMarkerElement,
  createMarkerOverlayIcon,
  createMarkerContentEntry,
  createVectorPathElement,
  createVectorShapeElement,
  createWallElement,
  createLightElement,
  WALL_TYPES,
  createView,
  updateBaseMapType,
  updateMapTimestamp,
  resolveInitialView,
  randomId,
} from "./lib/map-model.js";
import { BaseMapManager } from "./lib/base-maps.js";
// The shared map-rendering core (also used by the Dashboard's Map widget —
// see its own header comment) — renderMapLayers is the whole render loop;
// everything else here is either a pure helper Orrery's own authoring code
// still calls directly (getGridType, getGridCellKey,
// createGridCellSelectionEntry, findGridCellById, normalizeGroupMembers,
// getLayerPositionScale, getLayerSizeScale, getLayerRenderPosition — all
// identical signatures, no wrapper needed), or one bindLayerDrag's
// whole-layer drag needs with baseMapManager/state.map injected (the
// `sharedGet*` aliases, wrapped just below).
import {
  computeHiddenIds,
  renderMapLayers,
  getGridType,
  getGridCellKey,
  createGridCellSelectionEntry,
  findGridCellById,
  normalizeGroupMembers,
  getLayerPositionScale,
  getLayerSizeScale,
  getLayerRenderPosition,
  getGridLayoutScale as sharedGetGridLayoutScale,
  getGridBackgroundPosition as sharedGetGridBackgroundPosition,
  getGridOffset,
  getGridHitTestScale,
  markerPositionToLocalPixel,
  localPixelToMarkerPosition,
  getGridCoordFromPoint,
  getGridCellPixelRect,
  getGridCellSize,
  resolveClickPosition,
  createPingMarker,
  getMarkerLayerOffset,
  renderShapeElement,
  resetParticleEffectPlayState,
  resolveMarkerVisionRangeCells,
  resolveMarkerConditionIcons,
  resolveMarkerResourceBar,
  resolveVisibleCells,
  renderLightElement,
  resolveLightOrigin,
  snapMarkerPositionToGrid as snapMarkerPositionToGridShared,
  buildRestrictedMapOptions,
  resolveMarkerLinkTarget,
  findPrimaryGridLayer,
  hasMapMeasurementConfigured,
  pixelsToCells,
  snapCellsToWholeUnit,
  formatMeasuredDistance,
} from "./lib/map-viewer.js";

const state = {
  map: createMapModel(),
  selection: {
    kind: null,
    id: null,
    layerId: null,
    cells: [],
    anchor: null,
  },
  lastGridSelection: null,
  propertyClipboard: null,
};

const { status, undoStack, undo, redo } = initAppShell({
  namespace: "orrery",
  storagePrefix: "undercroft.orrery.undo",
  leftPaneLabel: "Toggle palette pane",
  settingsSlotAttr: "data-orrery-settings-slot",
  onUndo: (entry) => {
    if (!entry) {
      return null;
    }
    applyMapSnapshot(entry.before);
    autoSaveHistoryEntry(entry);
    return { message: entry.label ? `Undid ${entry.label}` : "Undid last action" };
  },
  onRedo: (entry) => {
    if (!entry) {
      return null;
    }
    applyMapSnapshot(entry.after);
    autoSaveHistoryEntry(entry);
    return { message: entry.label ? `Redid ${entry.label}` : "Redid last action" };
  },
});

const auth = initAuthControls({ status });
const dataManager = auth.dataManager;

// Which System the Settings modal's Marker Resource Bar picker is
// currently configuring — unlike Crucible/Forge/Vault (each authoring
// against one explicitly-selected System), Orrery has no System selector
// at all; the only System that's ever actually relevant here is whichever
// one the active campaign's own running Encounter is tagged with, the
// exact same systemId resolveMarkerResourceBarForMarker itself resolves
// the preference against at render time. Proactively kicks off the active-
// Encounter fetch itself (not just relying on primeResourceBarCache, which
// only ever runs as part of rendering an actual map) — Settings is reachable
// from the header with no map loaded at all, and an active Encounter can
// exist perfectly well with nothing on-screen to have primed this cache yet
// (confirmed real bug: this returned "" — "No active encounter" — for a
// genuinely running Encounter, purely because no map had rendered since
// page load). No active encounter at all still means there's nothing this
// setting could apply to yet.
function currentResourceBarSettingsSystemId() {
  const groupId = getActiveCampaignGroupId();
  if (!groupId) return "";
  ensureActiveEncounterCached(groupId, () => {});
  const encounter = getCachedActiveEncounter(groupId);
  return encounter?.systemId || "";
}

// Gear-icon Settings modal (upper-left header, settingsSlotAttr above) —
// same shared module/visual pattern Crucible's own Combat Scaling/Creature
// Type/Ability field pickers use. Just the one per-System preference so
// far: which named `resource`-role binding (see combat-bindings.js's own
// resolveCombatantStats) the Marker Resource Bar represents, for a System
// that tracks more than one (d20 Modern's Hit Points + Action Points,
// Daggerheart's Hope alongside HP, ...) — a System with only one resource
// never needs this touched at all, since the guessed default already
// matches resolveCombatantStats' own "first resource is the primary"
// convention.
initToolSettings({
  toolId: "orrery",
  dataManager,
  status,
  title: "Orrery Settings",
  definitions: () => {
    const systemId = currentResourceBarSettingsSystemId();
    if (!systemId) {
      return [
        {
          key: "barResourceName",
          type: "select",
          label: "Marker resource bar",
          helpTopic: "orrery.barResourceName",
          options: [{ value: "", label: "No active encounter" }],
          getValue: () => "",
          setValue: () => {},
        },
      ];
    }
    // Kicks off the fetch if nothing's cached yet (e.g. Settings opened
    // before any combatant-linked marker triggered primeResourceBarCache) — a
    // no-op when already cached/in-flight. The modal itself doesn't
    // live-refresh once this resolves (tool-settings.js has no such hook),
    // but every combatant marker on the actual map already primes this
    // during ordinary rendering, well before a GM would reach for Settings
    // in practice.
    ensureSystemResourceBarConfigCached(systemId, () => {});
    const resourceNames = getCachedSystemResourceBarConfig(systemId)?.resourceNames || [];
    if (!resourceNames.length) {
      return [
        {
          key: "barResourceName",
          type: "select",
          label: "Marker resource bar",
          helpTopic: "orrery.barResourceName",
          options: [{ value: "", label: "This System has no resource fields" }],
          getValue: () => "",
          setValue: () => {},
        },
      ];
    }
    const guessed = guessBarResourceName(resourceNames.map((name) => ({ name })));
    return [
      {
        key: "barResourceName",
        type: "select",
        label: "Marker resource bar",
        helpTopic: "orrery.barResourceName",
        // No separate "Auto-detect" option — the guessed resource IS the
        // selected value until the GM picks a different one, with " (auto-
        // detected)" on its own option label as the only indicator (see
        // feedback_settings_preference_with_guessed_default).
        options: resourceNames.map((name) => ({
          value: name,
          label: name === guessed && !getBarResourceNamePreference(systemId) ? `${name} (auto-detected)` : name,
        })),
        getValue: () => getBarResourceNamePreference(systemId) || guessed,
        setValue: (value) => {
          setBarResourceNamePreference(systemId, value);
          renderLayerOverlays();
        },
      },
    ];
  },
  // Queried live, not via `elements` — the settings slot is built by
  // initAppShell() itself, above; mountButton fires synchronously right
  // after that, so the slot already exists in the DOM by then.
  mountButton: (button) => document.querySelector("[data-orrery-settings-slot]")?.appendChild(button),
});

// Ownership metadata for saved Maps, used only for the Delete button's
// access gate (owner-or-admin, or a local/anonymous entry) — same
// rule and shape as Sanctum's settingCatalog/locationCatalog.
let mapCatalog = new Map();

// Whether the Draw tool (setupDrawTool) is currently armed — module-scope
// (not local to setupDrawTool) because renderLayerOverlays' own
// onVectorPathClick wiring needs to read it too: a drawn path must stay
// click-through while this is true, so a new stroke can start anywhere,
// including on top of an existing one.
let drawModeActive = false;

// Same reasoning as drawModeActive just above — a placed AoE shape must
// stay click-through while this is true, so a new one can be dropped
// anywhere, including on top of an existing shape/path.
let shapeModeActive = false;

// The Shape/Effect tool's own placement workflow: while armed, a DRAFT
// element (draftShapeElement) exists on the SAME layer (draftShapeLayer)
// it'll eventually be placed on, and the right-pane Inspector renders it
// through the exact same renderVectorShapeSelectionEditor a real, already-
// placed shape uses — not a separate simplified view. That's what lets a
// GM open the panel the instant the tool arms, change type/color there
// BEFORE ever touching the map, then drag on the map to set Size/Angle/
// Position, watching the SAME Size/Angle inputs update live as they do —
// confirmed as the actual ask after two earlier, more limited attempts
// (a standalone toolbar readout, then a separate simplified "armed"
// summary) both fell short of "the exact same fields, live." Never pushed
// into layer.elements until the gesture actually commits (sizeCells > 0 on
// release) — recordHistory/renderLayerOverlays calls that fire from
// editing the draft harmlessly no-op/redundantly redraw the REAL,
// unaffected map in the meantime, since nothing in state.map itself has
// changed yet. lastShapePresetId/lastShapeValues remember the most
// recently used type/colors across arm/disarm cycles (captured right
// before the draft is cleared), so re-arming the tool picks up where the
// last placement left off, the same continuity a toolbar dropdown's own
// persisted value used to give for free.
let draftShapeElement = null;
let draftShapeLayer = null;
let lastShapePresetId = "circle";
let lastShapeValues = null;

// One shared "pencil color" for the plain Draw tool (a drawn path's
// fillColor AND strokeColor both come from this single value) — matching
// the Dashboard Map widget's identical single drawColor concept
// (common/js/lib/widgets/map.js) rather than reading a per-layer default
// from layer.settings — a player placing a drawing via the widget has no
// "selected vector layer" to read defaults from at all, so a shared
// toolbar swatch is the only model that works the same in both places.
// Shape no longer uses this — colors are now per-colorSlot fields on
// draftShapeElement.values, picked from the right pane, not one shared
// swatch.
// Persists across gestures within the session, same "sticky preference"
// shape as wallSnapEnabled above.
let drawColor = "#0f172a";

// Same reasoning as drawModeActive — walls/doors need to stay click-through
// while a new one is being placed (setupWallTool), same "start anywhere,
// including on top of an existing one" precedent, and precise vertex
// placement near an existing wall's own endpoint is a common, expected case
// (connecting two wall segments).
let wallModeActive = false;
// Same draft-element workflow as draftShapeElement/draftShapeLayer —
// renderWallSelectionEditor renders draftWallElement directly the whole
// time the Wall tool is armed, so Type (wall/door — replaces the old
// standalone toolbar dropdown), Stroke color/width, and Snap to Grid are
// all live-editable from the moment the tool arms, not just after a wall
// is actually placed. `points` starts empty and grows as vertices are
// clicked (setupWallTool's own pointerdown), same array the committed
// element keeps as-is. lastWallType remembers wall-vs-door across
// arm/disarm cycles, same continuity lastShapePresetId gives Shape.
let draftWallElement = null;
let draftWallLayer = null;
let lastWallType = "wall";
// Whether the NEXT placed wall/door's own vertices snap to the grid as
// they're clicked — defaults on (see createWallElement's own comment for
// why: fog is only ever square-grid-cell granular anyway, and snapping
// keeps walls straight/aligned to each other). Persists across gestures
// within the session, same "sticky preference" shape as lastWallType. A
// toolbar-level toggle (not draftWallElement.snapToGrid, which is a
// separate per-element field editable via the inspector's own Snap to Grid
// switch) because it governs LIVE placement snapping as vertices are
// clicked — a wall's freeform, multi-vertex geometry can genuinely want
// off-grid precision mid-placement in a way Shape's single-drag-to-size
// gesture never needed a toggle for.
let wallSnapEnabled = true;
// { preview, polyline } while a click-to-place-vertex gesture is in
// progress; null otherwise. Module-scope (not local to setupWallTool) so
// the capture-phase keydown handler and the pointermove/dblclick handlers
// can all read/mutate the same in-progress state. The vertices themselves
// live on draftWallElement.points directly, not here.
let wallGesture = null;

// Same reasoning as shapeModeActive — a placed Light must stay immediately
// selectable/draggable even while the Light tool is still armed (matching
// how a placed shape already works), so this does NOT gate the
// click-through wiring the way drawModeActive/wallModeActive do.
let lightModeActive = false;

// Same draft-element workflow as draftShapeElement/draftShapeLayer above,
// for the Light tool — renderLightSelectionEditor renders it directly, so
// Range/Color/Opacity/Attach-to-Token are all live-editable from the moment
// the tool arms, not just after a light is actually placed. No "last used"
// memory the way Shape has one (a Light has no type to remember, and its
// own color/opacity defaults are already fixed, sensible values from
// createLightElement).
let draftLightElement = null;
let draftLightLayer = null;

// Selecting a Group makes its target grid layer directly clickable —
// single click adds one cell, click-and-drag paints a sweep — with no
// separate toggle needed, same immediacy the OLD "select a layer, click a
// cell" flow already had before Groups existed as their own selection kind.
// paintTargetLayerId remembers the GM's own "Paint on layer" pick for maps
// with more than one grid layer and no Fog-of-War link to fall back on
// (resolvePaintTargetLayer's own priority order) — persists across
// switching between groups on purpose, not reset on every selection change.
// paintDragBefore is the pre-gesture snapshot a whole drag batches into ONE
// undo entry, same "commit once at drag-end" pattern shape/marker dragging
// already use.
let paintTargetLayerId = null;
let paintDragBefore = null;

// Set by showMapEmptyState/hideMapEmptyState — updateMapToolbarState's own
// Delete gate (mapAllowsDelete) checks THIS too, not just ownership.
// Without it, an admin account's own "admins can delete anything" bypass in
// ownerOrAdminAllows made Delete re-enable itself the instant
// populateMapSelect (called right after showMapEmptyState at startup) ran
// updateMapToolbarState again — the exact "two mechanisms fighting over one
// element's disabled state" bug this suite keeps tripping over, just for
// an admin session specifically (any other tier correctly saw the
// placeholder's random, never-saved id fail ownership and stayed
// disabled, which is why this was easy to miss testing as a non-admin).
let mapIsLoaded = false;

// True once state.map is a REAL, previously-saved server record (loaded via
// loadMapById with a real id, or just successfully saved for the first
// time) — false for a brand-new, never-saved map (createMapModel's own
// randomId(), which never appears in mapCatalog at all since nothing was
// ever fetched for it). currentUserHasFullMapAccess treats "not yet saved
// anywhere" as full access unconditionally — confirmed real bug this fixes:
// mapAllowsDelete's own safe "no catalog entry = restricted" default (dead
// right for an existing map this viewer genuinely has no access to) also
// fired for a map that simply doesn't exist as a record YET, hiding the
// entire authoring UI — including the Save button needed to create it at
// all — the instant anyone opened Orrery fresh or clicked New Map.
let mapExistsOnServer = false;

// Set by loadMapById — needed by the restricted-viewer marker-move/door-
// toggle persistence below (persistRestrictedMarkerMove/onDoorClickRestricted),
// the same anonymous share-link auth loadMapById itself already forwards to
// dataManager.get.
let currentShareToken = "";

// Set true for the duration of a restricted viewer's marker drag
// (buildRestrictedMapOptions' own onDragStateChange) — watchCurrentMap's
// own onChange below skips an incoming poll/live-stream update while this
// is true, the same way it already skips one whenever state.selection is
// set (a GM must select the Marker Layer before dragging, which already
// protects THEIR drag) — a restricted viewer has no selection concept at
// all, so it needed its own signal. See buildRestrictedMapOptions' own
// comment for the confirmed "drag pops straight to the final position
// instead of tracking the cursor" bug this fixes.
let isDraggingRestrictedMarker = false;

const mapContainer = document.querySelector("#orrery-map");
const baseMapManager = new BaseMapManager({
  container: mapContainer,
  onViewChange: (view) => {
    state.map.view = { ...state.map.view, ...view };
    updateMapTimestamp(state.map);
    renderView();
    renderLayerOverlays();
    renderJson();
  },
});

// Small local helpers for two button shapes this file uses that don't map
// cleanly onto createIconButton's "compact"/"toolbar" kinds: a plain-link
// "About X" help tooltip (used for the Layers/Groups/Map Properties/
// Selection section headers below — JSON Data's own equivalent was removed,
// see jsonDataPanel's own construction) and a small btn-group-sm "Add X"
// action with a visually-hidden label (compact sizing, but WITH a hidden
// label span, unlike every other compact-kind button in the suite).
function createHelpButton(title, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-link p-0 text-body-secondary";
  button.setAttribute("data-bs-toggle", "tooltip");
  button.setAttribute("data-bs-placement", "top");
  button.setAttribute("data-bs-title", title);
  button.setAttribute("aria-label", label);
  button.innerHTML = '<span class="iconify" data-icon="tabler:help" aria-hidden="true"></span>';
  return button;
}
function withHiddenLabel(button, label) {
  const span = document.createElement("span");
  span.className = "visually-hidden";
  span.textContent = label;
  button.appendChild(span);
  return button;
}

// Built and mounted before `elements` below queries for these buttons by
// their data-action/data-add-*/data-selection-clear attribute, so every
// existing selector/disabled-state call site elsewhere in this file keeps
// working unchanged. New/Save/Duplicate/Delete/Undo/Redo, in that order —
// Import/Export moved into the JSON Data panel's own onImport/onExport
// (see jsonDataPanel's own construction below) instead of living here as
// standalone buttons.
createToolbarButtonGroup([
  { action: "new", icon: "tabler:map-plus", label: "New Map", attrs: { "data-action": "new-map" } },
  { action: "save", label: "Save Map", disabled: true, attrs: { "data-action": "save-layout" } },
  { action: "duplicate", label: "Duplicate Map", attrs: { "data-action": "duplicate-map" } },
  { action: "delete", label: "Delete Map", disabled: true, attrs: { "data-action": "delete-map" } },
]).forEach((button) => document.querySelector("[data-map-toolbar-mount]")?.appendChild(button));
// A small visual break, not a functional one — same convention every other
// tool's toolbar now uses (see forge/js/app.js's own comment).
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-action": "undo-layout" } },
  { action: "redo", label: "Redo", attrs: { "data-action": "redo-layout" } },
]).forEach((button) => document.querySelector("[data-map-undo-toolbar-mount]")?.appendChild(button));

document.querySelector("[data-add-layer-mount]")?.append(
  withHiddenLabel(
    createIconButton({ icon: "tabler:vector", variant: "outline-primary", label: "Add vector layer", attrs: { "data-add-layer": "vector" } }),
    "Add vector layer"
  ),
  withHiddenLabel(
    createIconButton({ icon: "tabler:grid-dots", variant: "outline-primary", label: "Add grid layer", attrs: { "data-add-layer": "grid" } }),
    "Add grid layer"
  ),
  withHiddenLabel(
    createIconButton({ icon: "tabler:photo", variant: "outline-primary", label: "Add raster layer", attrs: { "data-add-layer": "raster" } }),
    "Add raster layer"
  ),
  withHiddenLabel(
    createIconButton({ icon: "tabler:map-pin", variant: "outline-primary", label: "Add marker layer", attrs: { "data-add-layer": "marker" } }),
    "Add marker layer"
  )
);
document.querySelector("[data-add-group-mount]")?.appendChild(
  withHiddenLabel(
    createIconButton({ icon: "tabler:folder-plus", variant: "outline-primary", label: "Add group", attrs: { "data-add-group": true } }),
    "Add group"
  )
);
document.querySelector("[data-add-view-mount]")?.appendChild(
  withHiddenLabel(
    createIconButton({ icon: "tabler:eye-plus", variant: "outline-primary", label: "Add view", attrs: { "data-add-view": true } }),
    "Add view"
  )
);

document
  .querySelector("[data-layers-help-mount]")
  ?.appendChild(
    createHelpButton(
      "Layers hold vector shapes, grids, rasters, or markers. Add a layer to start placing content on the map.",
      "About layers"
    )
  );
document
  .querySelector("[data-groups-help-mount]")
  ?.appendChild(
    createHelpButton("Groups organize layers or grid cells so you can manage related content together.", "About groups")
  );
document
  .querySelector("[data-basemap-help-mount]")
  ?.appendChild(
    createHelpButton("Choose and configure the background tiles, image, or canvas for the map.", "About base map settings")
  );
document
  .querySelector("[data-selection-help-mount]")
  ?.appendChild(
    createHelpButton("Inspect and edit the currently selected layer, view, group, or grid cells.", "About selection details")
  );

document.querySelector("[data-selection-clear-mount]")?.appendChild(
  createIconButton({
    icon: "tabler:x",
    variant: "outline-danger",
    label: "Clear selection",
    tooltipPlacement: "bottom",
    attrs: { "data-selection-clear": true },
  })
);

// Builds and mounts a collapsible-section chevron toggle via the shared
// factory, for a header whose other content (label, help/clear buttons)
// stays static HTML — the section-level createCollapsibleSection isn't used
// here since it would rebuild the whole header, conflicting with those
// already-mounted siblings.
function createCollapsibleToggleButton(mountSelector, collapsed) {
  const button = createIconButton({
    icon: "tabler:chevron-right",
    className: "collapsible-toggle",
    includeToggleLabel: true,
  });
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  document.querySelector(mountSelector)?.appendChild(button);
  return button;
}

// replaceWith, not appendChild — see press/js/app.js's mountInspectorField
// for why: an appended-into wrapper stays an empty-but-in-flow flex item
// even while its field is conditionally hidden, silently spending a full
// gap-3 on both sides of it. Any class the static mount div itself carried
// is merged onto the built field first so removing the wrapper doesn't
// lose that layout.
function mountField(key, element) {
  const mount = document.querySelector(`[data-field-mount="${key}"]`);
  if (!mount) return;
  if (mount.className) element.classList.add(...mount.classList);
  mount.replaceWith(element);
}
mountField(
  "map-select",
  createCompactField({
    type: "select", id: "orreryMapSelect", label: "Map", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    dataAttr: "data-map-select", helpTopic: "orrery.maps",
  })
);
// Selections — expanded by default, matching every other tool's own
// left-pane Selections section. Just the one Map select here, but wrapped
// in the same collapsible shape for suite-wide consistency.
{
  const selectionsSection = createFullCollapsibleSection({
    label: "Selections",
    collapsed: false,
    content: document.querySelector("[data-selections-panel]"),
  });
  document.querySelector("[data-selections-mount]")?.appendChild(selectionsSection.section);
}
// Same icon+text+tooltip toggle shape Press's own align-x/align-y groups
// use (createButtonCheckGroup already supports it natively) — was plain
// text-only buttons before, the one field in this panel not matching the
// suite's standard icon-toggle convention.
mountField(
  "base-map-type",
  createButtonCheckGroup({
    ariaLabel: "Base map type",
    name: "base-map-type",
    dataAttr: "data-base-map-option",
    options: [
      { id: "base-map-tile", value: "tile", icon: "tabler:map", text: "Tile", tooltip: "Tile map (Leaflet-based)" },
      { id: "base-map-image", value: "image", icon: "tabler:photo", text: "Image", tooltip: "Uploaded image" },
      { id: "base-map-canvas", value: "canvas", icon: "tabler:artboard", text: "Canvas", tooltip: "Blank canvas" },
    ],
  })
);
// Primary/standalone right-pane fields all use the floating-label shape
// (createFormFloatingField) — the same convention Workbench's own inspector
// uses for a single full-width field — not createCompactField, which is
// reserved for fields condensed into a dense paired row (Image Width/Height
// just below).
mountField("base-map-image-src", createFormFloatingField({ type: "text", id: "base-map-image-src", label: "Image URL", dataAttr: "data-base-map-image-src", placeholder: " " }));
mountField(
  "map-name",
  createFormFloatingField({
    type: "text", id: "orreryMapName", label: "Map Name",
    dataAttr: "data-map-name", placeholder: "Map name",
  })
);
// One scale/unit for the whole map (not per-grid-layer — a map's grid
// squares always represent the same real-world distance no matter which
// layer happens to be selected). Deliberately no default value stamped in
// here — see createMapModel's own comment; the Measure tool checks both are
// actually set and disables itself otherwise, rather than silently
// measuring against an invented number.
mountField(
  "map-measurement",
  createFieldRow(
    [
      createCompactField({ type: "number", id: "map-measurement-scale", label: "Scale per cell", dataAttr: "data-map-measurement-scale", min: 0, step: 1 }),
      createCompactField({ type: "text", id: "map-measurement-unit", label: "Scale unit", dataAttr: "data-map-measurement-unit" }),
    ],
    { columns: 2 }
  )
);
// The view a map ALWAYS opens to (see resolveInitialView, map-model.js) —
// unlike Scale per cell/unit just above, these DO ship a real default (1 /
// 0 / 0) rather than starting unset, matching createMapModel's own
// initialView default exactly, so a brand-new map's fields already show
// the values it'll actually open at.
// Position X/Y only means anything for image/canvas maps — a tile map's
// view is addressed by center lat/lng + zoom (TileBaseMap.setView never
// even reads pan), so Position X/Y is currently a true no-op there.
// Confirmed as the actual cause of "the Initial X/Y settings don't seem to
// do anything": on a tile map, they genuinely don't yet. Hiding them for
// that type (renderBaseMapSettings toggles .orrery-initial-position-field,
// same "show/hide by baseMap.type" convention data-base-map-settings
// already uses just above) is honest about the current limitation instead
// of leaving two fields that quietly do nothing. Initial Zoom stays
// visible/functional for every type.
const initialViewRow = createFieldRow(
  [
    createCompactField({ type: "number", id: "map-initial-zoom", label: "Initial Zoom", dataAttr: "data-map-initial-zoom", min: 0.1, step: 0.1 }),
    createCompactField({ type: "number", id: "map-initial-position-x", label: "Initial Position X", dataAttr: "data-map-initial-position-x", step: 1 }),
    createCompactField({ type: "number", id: "map-initial-position-y", label: "Initial Position Y", dataAttr: "data-map-initial-position-y", step: 1 }),
  ],
  { columns: 3 }
);
Array.from(initialViewRow.children)
  .slice(1)
  .forEach((col) => col.classList.add("orrery-initial-position-field"));
mountField("map-initial-view", initialViewRow);
const tileProviderField = createFormFloatingField({
  type: "text", id: "base-map-tile-provider", label: "Tile Provider", placeholder: " ",
  value: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
});
tileProviderField.classList.add("orrery-provider-input");
mountField("base-map-tile-provider", tileProviderField);
// Quick-pick options carry their tile URL/zoom payload as dataset attrs read
// by the change handler below (~L2650) — createFormFloatingField's `options`
// param only knows {value, label}, so the payload is stamped onto the built
// <option> elements afterward rather than hand-writing this select in HTML.
const TILE_QUICK_PICKS = {
  "forgotten-realms": { url: "https://loremaps.github.io/LoreMaps-Faerun-Tiles/Tiles/{z}/{x}/{y}.png", maxZoom: "6", initialZoom: "3" },
  eberron: { url: "https://eberronmap.johnarcadian.com/worldbin/eberron/{z}/{x}/{y}.jpg", maxZoom: "7", initialZoom: "2.75" },
  sharn: { url: "https://eberronmap.johnarcadian.com/worldbin/sharncityoftowers/{z}/{x}/{y}.jpg", maxZoom: "6", initialZoom: "2" },
  "real-world": { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: "19", initialZoom: "2" },
};
const tileQuickPickField = createFormFloatingField({
  type: "select", id: "base-map-tile-quick-pick", label: "Quick picks",
  dataAttr: "data-base-map-tile-quick-pick",
  options: [
    { value: "", label: "Select a tile provider" },
    { value: "forgotten-realms", label: "Forgotten Realms" },
    { value: "eberron", label: "Eberron" },
    { value: "sharn", label: "Sharn: City of Towers" },
    { value: "real-world", label: "Real World" },
  ],
});
tileQuickPickField.querySelectorAll("option").forEach((option) => {
  const preset = TILE_QUICK_PICKS[option.value];
  if (!preset) return;
  option.dataset.tileUrl = preset.url;
  option.dataset.tileMaxZoom = preset.maxZoom;
  option.dataset.tileInitialZoom = preset.initialZoom;
});
mountField("base-map-tile-quick-pick", tileQuickPickField);
// Free text, not type="number" — a number input rejects "%" at the browser
// level, and these need to accept blank (native size), a literal pixel
// count, or a "NN%" scale-of-native value (see base-maps.js's own
// applyImageDimensions/resolveImageDimension for how each is resolved).
mountField(
  "base-map-image-size",
  createFieldRow(
    [
      createCompactField({ type: "text", id: "base-map-image-width", label: "Width", dataAttr: "data-base-map-image-width", placeholder: "Native, 150%, or 1200" }),
      createCompactField({ type: "text", id: "base-map-image-height", label: "Height", dataAttr: "data-base-map-image-height", placeholder: "Native, 150%, or 800" }),
    ],
    { columns: 2 }
  )
);
mountField(
  "base-map-canvas-background",
  createFormFloatingField({
    type: "color", id: "base-map-canvas-background", label: "Canvas Background", dataAttr: "data-base-map-canvas-background",
  })
);

const elements = {
  mapSelect: document.querySelector("[data-map-select]"),
  mapNameInput: document.querySelector("[data-map-name]"),
  measurementScale: document.querySelector("[data-map-measurement-scale]"),
  measurementUnit: document.querySelector("[data-map-measurement-unit]"),
  initialZoom: document.querySelector("[data-map-initial-zoom]"),
  initialPositionX: document.querySelector("[data-map-initial-position-x]"),
  initialPositionY: document.querySelector("[data-map-initial-position-y]"),
  newMapButton: document.querySelector('[data-action="new-map"]'),
  saveMapButton: document.querySelector('[data-action="save-layout"]'),
  duplicateMapButton: document.querySelector('[data-action="duplicate-map"]'),
  deleteMapButton: document.querySelector('[data-action="delete-map"]'),
  mapMain: document.querySelector("[data-map-main]"),
  baseMapRadios: Array.from(document.querySelectorAll("[data-base-map-option]")),
  baseMapSettings: Array.from(document.querySelectorAll("[data-base-map-settings]")),
  tileProvider: document.querySelector("#base-map-tile-provider"),
  tileQuickPick: document.querySelector("[data-base-map-tile-quick-pick]"),
  imageSrc: document.querySelector("[data-base-map-image-src]"),
  imageWidth: document.querySelector("[data-base-map-image-width]"),
  imageHeight: document.querySelector("[data-base-map-image-height]"),
  canvasBackground: document.querySelector("[data-base-map-canvas-background]"),
  // Built below (not queried) — the collapsible-toggle chevron button now
  // comes from the shared createIconButton factory instead of static
  // markup; everything else in each section's header (label, help mount,
  // clear-selection mount) stays hand-authored HTML since it predates and
  // is unrelated to the toggle itself.
  baseMapToggle: createCollapsibleToggleButton("[data-base-map-toggle-mount]", true),
  baseMapPanel: document.querySelector("[data-base-map-panel]"),
  selectionToggle: createCollapsibleToggleButton("[data-selection-toggle-mount]", true),
  selectionPanel: document.querySelector("[data-selection-panel]"),
  selectionClear: document.querySelector("[data-selection-clear]"),
  undoButton: document.querySelector('[data-action="undo-layout"]'),
  redoButton: document.querySelector('[data-action="redo-layout"]'),
  layerButtons: Array.from(document.querySelectorAll("[data-add-layer]")),
  groupAdd: document.querySelector("[data-add-group]"),
  layerList: document.querySelector("[data-layer-list]"),
  groupList: document.querySelector("[data-group-list]"),
  viewAdd: document.querySelector("[data-add-view]"),
  viewList: document.querySelector("[data-view-list]"),
  selectionTitle: document.querySelector("[data-selection-title]"),
  selectionTypeIcon: document.querySelector("[data-selection-type-icon]"),
  selectionDetails: document.querySelector("[data-selection-details]"),
  selectionToolbar: document.querySelector("[data-selection-toolbar-mount]"),
  selectionEditor: document.querySelector("[data-selection-editor]"),
  zoomIn: document.querySelector("[data-zoom-in]"),
  zoomOut: document.querySelector("[data-zoom-out]"),
  zoomReset: document.querySelector("[data-zoom-reset]"),
  measureToggle: document.querySelector("[data-measure-toggle]"),
  // Tooltip trigger lives on this wrapping span, not the button itself — a
  // native `disabled` button doesn't reliably fire the hover/focus events
  // Bootstrap's tooltip listens for in every browser, so a tooltip attached
  // directly to the button can silently never show while it's disabled
  // (confirmed: exactly what happened here). Standard Bootstrap pattern for
  // "explain why this is disabled" — see their own docs' disabled-button
  // tooltip example.
  measureToggleWrap: document.querySelector("[data-measure-toggle-wrap]"),
  measureReadout: document.querySelector("[data-measure-readout]"),
  drawToggle: document.querySelector("[data-draw-toggle]"),
  drawToggleWrap: document.querySelector("[data-draw-toggle-wrap]"),
  shapeToggle: document.querySelector("[data-shape-toggle]"),
  shapeToggleWrap: document.querySelector("[data-shape-toggle-wrap]"),
  shapeEffectModal: document.getElementById("orrery-shape-effect-modal"),
  shapeEffectThumbnails: document.querySelector("[data-shape-effect-thumbnails]"),
  shapeEffectPreview: document.querySelector("[data-shape-effect-preview]"),
  shapeEffectPreviewLabel: document.querySelector("[data-shape-effect-preview-label]"),
  shapeEffectControls: document.querySelector("[data-shape-effect-controls]"),
  shapeEffectApply: document.querySelector("[data-shape-effect-apply]"),
  moveMarkerModal: document.getElementById("orrery-move-marker-modal"),
  moveMarkerTitle: document.querySelector("[data-move-marker-title]"),
  moveMarkerMapSelect: document.querySelector("[data-move-marker-map-select]"),
  moveMarkerLayerField: document.querySelector("[data-move-marker-layer-field]"),
  moveMarkerLayerSelect: document.querySelector("[data-move-marker-layer-select]"),
  moveMarkerNewLayerNote: document.querySelector("[data-move-marker-new-layer-note]"),
  moveMarkerApply: document.querySelector("[data-move-marker-apply]"),
  drawColor: document.querySelector("[data-draw-color]"),
  drawColorWrap: document.querySelector("[data-draw-color-wrap]"),
  wallToggle: document.querySelector("[data-wall-toggle]"),
  wallToggleWrap: document.querySelector("[data-wall-toggle-wrap]"),
  wallSnapToggle: document.querySelector("[data-wall-snap-toggle]"),
  wallSnapToggleWrap: document.querySelector("[data-wall-snap-toggle-wrap]"),
  lightToggle: document.querySelector("[data-light-toggle]"),
  lightToggleWrap: document.querySelector("[data-light-toggle-wrap]"),
  pingToggle: document.querySelector("[data-ping-toggle]"),
  pingToggleWrap: document.querySelector("[data-ping-toggle-wrap]"),
  viewToggle: document.querySelector("[data-view-toggle]"),
  viewDetails: document.querySelector("[data-view-details]"),
  viewPanel: document.querySelector("[data-view-panel]"),
  mapEmptyState: document.querySelector("[data-map-empty-state]"),
  viewHandle: document.querySelector("[data-view-handle]"),
  viewMode: document.querySelector("[data-view-mode]"),
  viewZoom: document.querySelector("[data-view-zoom]"),
  viewCenter: document.querySelector("[data-view-center]"),
  viewPan: document.querySelector("[data-view-pan]"),
};

// Assigned once the hidden file-picker input is actually built (see the
// Import/Export wiring further below, in the same place it always lived) —
// onImport just needs a stable closure to call into once that's ready,
// same reasoning applyMapSnapshot/watchCurrentMap etc. below are also only
// resolved at click time, well after every declaration in this module has
// run.
let importInput = null;
const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  getData: () => state.map,
  // Reuses the same Blob/anchor/download mechanics Crucible/Vault/Sanctum
  // already share for "download this record as a .json file" — an identity
  // shape function, since a map export is a portable copy of itself, not a
  // Press-ingestion shape like those tools' own records.
  onExport: () => exportRecordAsJson(state.map, (map) => map),
  onImport: () => importInput?.click(),
});
const renderJsonPreview = jsonDataPanel.render;

// Wraps the raw preview renderer so every one of this file's many renderJson()
// call sites (already sitting after essentially every edit — layer/marker/
// view/property changes, drag-end, etc.) also re-evaluates the Save button's
// dirty-gated disabled state, without having to hunt down and touch each one
// individually. updateMapToolbarState is a function declaration (hoisted), so
// this is safe to reference here even though it's defined later in the file.
function renderJson() {
  renderJsonPreview();
  updateMapToolbarState();
}

const LAYER_SETTINGS_SCHEMA = {
  vector: [
    // Labeled "Outline" (not "Stroke") to match Marker's own outlineColor/
    // outlineWidth vocabulary — same underlying key (strokeColor/
    // strokeWidth, unchanged — a display rename only, no data migration).
    { key: "strokeColor", label: "Outline color", type: "color" },
    { key: "fillColor", label: "Fill color", type: "color" },
    { key: "strokeWidth", label: "Outline width", type: "number", min: 1, step: 1 },
  ],
  grid: [
    {
      key: "gridType",
      label: "Grid type",
      type: "select",
      options: [
        { value: "square", label: "Square" },
        { value: "hex", label: "Hex" },
      ],
    },
    { key: "cellSize", label: "Cell size", type: "number", min: 1, step: 1 },
    { key: "lineColor", label: "Line color", type: "color" },
  ],
  // Width/Height aren't schema-driven — they need the free-text "blank,
  // NN%, or px" handling createDimensionField provides (see
  // renderLayerSelectionEditor's own raster branch), not
  // buildLayerSettingField's plain numeric field.
  raster: [{ key: "src", label: "Image URL", type: "text" }],
  marker: [
    { key: "icon", label: "Icon", type: "text" },
    { key: "size", label: "Size", type: "number", min: 2, step: 1 },
    { key: "color", label: "Color", type: "color" },
    { key: "outlineColor", label: "Outline color", type: "color" },
    { key: "outlineWidth", label: "Outline width", type: "number", min: 0, step: 1 },
  ],
};

const VIEW_TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "player", label: "Player" },
  { value: "gm", label: "GM" },
  { value: "creator", label: "Creator" },
  { value: "admin", label: "Admin" },
];
const VIEW_TIER_VALUES = new Set(VIEW_TIER_OPTIONS.map((option) => option.value));

const setBaseMapCollapsed = bindCollapsibleToggle(elements.baseMapToggle, elements.baseMapPanel, {
  collapsed: true,
  expandLabel: "Expand base map",
  collapseLabel: "Collapse base map",
});

const setSelectionCollapsed = bindCollapsibleToggle(elements.selectionToggle, elements.selectionPanel, {
  collapsed: true,
  expandLabel: "Expand selection",
  collapseLabel: "Collapse selection",
});

// Map Properties and Selection share one "what's the GM focused on right
// now" spotlight — expanding one collapses the other, rather than letting
// both sit open (or both collapsed) at once. `selectionExpanded` drives
// both: true when a layer/group/view/marker/grid-cells selection is active
// (Selection open, Map Properties closed), false when there's nothing
// selected (a freshly loaded/new map — Map Properties open, Selection
// closed).
function setPanelFocus(selectionExpanded) {
  setSelectionCollapsed(!selectionExpanded);
  setBaseMapCollapsed(selectionExpanded);
}

document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);

function normalizeTier(tier) {
  return typeof tier === "string" ? tier.trim().toLowerCase() : "";
}

// No second "default to every current layer/group id" argument anymore — that used
// to exist ONLY because layerIds was an allow-list (an unset one had to be filled
// with every id that existed at normalize time, or the view would show nothing).
// hiddenLayerIds/hiddenElementIds are deny-lists, so an unset one already means
// "nothing hidden" on its own; no pre-population needed, and nothing here depends
// on state.map.layers/groups existing yet.
function normalizeView(view) {
  const safeView = view && typeof view === "object" ? view : {};
  const name = typeof safeView.name === "string" && safeView.name.trim() ? safeView.name.trim() : "New View";
  const description = typeof safeView.description === "string" ? safeView.description.trim() : "";
  const tiers = Array.isArray(safeView.tiers)
    ? safeView.tiers.map(normalizeTier).filter((tier) => VIEW_TIER_VALUES.has(tier))
    : [];
  const hiddenLayerIds = Array.isArray(safeView.hiddenLayerIds) ? safeView.hiddenLayerIds.filter(Boolean) : [];
  const hiddenElementIds = Array.isArray(safeView.hiddenElementIds) ? safeView.hiddenElementIds.filter(Boolean) : [];
  const autoManaged = Boolean(safeView.autoManaged);
  const settings = safeView.settings && typeof safeView.settings === "object" ? safeView.settings : {};
  return {
    ...safeView,
    name,
    description,
    tiers,
    hiddenLayerIds,
    hiddenElementIds,
    autoManaged,
    settings,
  };
}

// Shown at page load and never since — every real load path (New Map,
// picking a saved map, an undo/redo landing on real map data, a
// spotlighted ?map= link) funnels through applyMapSnapshot, which calls
// hideMapEmptyState() unconditionally. There's still a harmless, never-
// rendered createMapModel() sitting in state.map underneath this the whole
// time (avoids having to make every single one of this file's many
// state.map.* reads null-safe) — this overlay's only job is making sure
// nobody ever SEES that placeholder or the raw tile map it'd otherwise
// mount, until they've actually picked or created something.
// Add Layer/Add Group/Add View all mutate state.map directly with no
// selection step first (unlike every other mutating action, which needs
// something already selected/loaded to act on) — the only thing gating
// them is a real map existing to add to at all, so they toggle on exactly
// the same "is a real map loaded" signal the empty-state canvas itself
// uses, not a separate flag.
function setMapActionsEnabled(enabled) {
  elements.layerButtons.forEach((button) => {
    button.disabled = !enabled;
  });
  if (elements.groupAdd) elements.groupAdd.disabled = !enabled;
  if (elements.viewAdd) elements.viewAdd.disabled = !enabled;
  // Import/Export/Duplicate all act on state.map directly with no
  // map-existence check of their own (same "nothing gates them but a real
  // map being loaded" reasoning as Add Layer/Group/View above) — Export
  // would otherwise happily dump the harmless placeholder createMapModel()
  // as if it were real map data, Import would silently overwrite it
  // instead of visibly failing, and Duplicate would have nothing real to
  // copy.
  if (jsonDataPanel.importButton) jsonDataPanel.importButton.disabled = !enabled;
  if (jsonDataPanel.exportButton) jsonDataPanel.exportButton.disabled = !enabled;
  if (elements.duplicateMapButton) elements.duplicateMapButton.disabled = !enabled;
  // Delete has its own, more specific gate (mapAllowsDelete — ownership,
  // not just "is a map loaded"), reapplied by updateMapToolbarState once a
  // real map is actually loaded — only force it OFF here when there's no
  // map to even consider deleting; never force it ON and fight that check.
  if (!enabled && elements.deleteMapButton) {
    elements.deleteMapButton.disabled = true;
  }
}

function showMapEmptyState() {
  mapIsLoaded = false;
  elements.mapEmptyState?.classList.remove("d-none");
  elements.viewPanel?.classList.add("d-none");
  // Map Properties otherwise showed every field (Name, Base Map settings,
  // Measurement, Initial View) sitting there blank/at-default with no map
  // to actually belong to — confusing, since a blank Name field or a
  // default Tile/OSM radio reads as "this is the map's real state," not
  // "there is no map." Collapsing the section itself (same mechanism the
  // toggle button drives — setBaseMapCollapsed already defaults to
  // collapsed) represents "nothing to see" instead of a separate
  // placeholder line of text; hideMapEmptyState's own caller
  // (applyMapSnapshot -> setPanelFocus(false)) re-expands it once a real
  // map exists.
  setBaseMapCollapsed(true);
  setMapActionsEnabled(false);
}

function hideMapEmptyState() {
  mapIsLoaded = true;
  elements.mapEmptyState?.classList.add("d-none");
  elements.viewPanel?.classList.remove("d-none");
  setMapActionsEnabled(true);
}

function applyMapSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  state.map = JSON.parse(snapshot);
  if (!state.map.views) {
    state.map.views = [];
  }
  // Backward-compatible with maps saved before the Measure tool's scale/unit
  // moved to the map level (see createMapModel's own comment) — an older
  // saved map just has no measurement configured yet, same as a brand-new
  // one, not a crash.
  if (!state.map.measurement) {
    state.map.measurement = { scale: null, unit: "" };
  }
  state.map.views = state.map.views.map((view) => normalizeView(view));
  // Backward-compatible with maps saved before Initial Zoom/Position
  // existed — gives the new Map Properties fields something concrete to
  // read/edit (resolveInitialView below tolerates a missing initialView
  // fine either way).
  if (!state.map.initialView) {
    state.map.initialView = { zoom: 1, pan: { x: 0, y: 0 } };
  }
  // Backward-compatible with layers saved before a settings key existed
  // (e.g. Marker's outlineWidth/outlineColor/showLabels) — a merge, not a
  // replace, so anything the GM already configured is untouched; this is
  // what makes "the input shows blank instead of the real 2px default"
  // impossible going forward, for this or any future new layer setting,
  // rather than special-casing each one's own field-building code to guess
  // a fallback the underlying data never actually had.
  (state.map.layers || []).forEach((layer) => {
    layer.settings = { ...createLayerSettings(layer.type), ...(layer.settings || {}) };
  });
  state.selection = { kind: null, id: null, layerId: null, cells: [], elements: [], anchor: null };
  hideMapEmptyState();
  // Always opens at the map's OWN configured Initial Zoom/Position, never
  // wherever a previous editing session's camera happened to be left —
  // state.map.view keeps live-syncing during THIS session same as before
  // (see onViewChange), so Reset/the floating view details panel keep
  // working exactly as before; only what a FRESH load starts at changes.
  state.map.view = resolveInitialView(state.map);
  baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
  if (elements.mapNameInput) {
    elements.mapNameInput.value = state.map.name || "";
  }
  if (elements.measurementScale) {
    elements.measurementScale.value = state.map.measurement.scale ?? "";
  }
  if (elements.measurementUnit) {
    elements.measurementUnit.value = state.map.measurement.unit || "";
  }
  if (elements.initialZoom) {
    elements.initialZoom.value = state.map.initialView.zoom;
  }
  if (elements.initialPositionX) {
    elements.initialPositionX.value = state.map.initialView.pan.x;
  }
  if (elements.initialPositionY) {
    elements.initialPositionY.value = state.map.initialView.pan.y;
  }
  updateMeasureAvailability();
  updateDrawAvailability();
  updateShapeAvailability();
  updateWallAvailability();
  updateLightAvailability();
  renderAll();
  setPanelFocus(false);
}

// Owner-or-admin, or a local/anonymous entry — deliberately NOT
// ownership.js's own allowsDelete (which also treats a plain share-level
// "edit" permission as sufficient, the right call for every other kind's
// delete gate — Sanctum's settingAllowsDelete/locationAllowsDelete, Loom's
// systemAllowsDelete, etc). A Map can no longer follow that pattern: every
// map share is now unconditionally "edit" (server/shares.py's own
// _normalize_permissions), purely so a player's own narrow, client-
// restricted write-back (moving their own owned character's token — this
// file's own isMarkerDraggableRestricted) is even possible at all — it no
// longer signals "this person is a trusted co-author of the whole map."
// Reusing allowsDelete here regressed exactly the bug this file's own
// restricted marker-drag gate was built to fix: with every map share now
// "edit," `allowsDelete` (and therefore currentUserHasFullMapAccess below,
// which every restricted-viewer check branches on) returned true for ANY
// campaign member, silently granting full authoring access — move any
// marker, see the Delete Map button, everything — to a mere player.
function mapAllowsDelete(id) {
  if (dataManager?.getUserTier() === "admin") return true;
  const metadata = mapCatalog.get(id);
  if (!metadata) return false;
  if (metadata.ownership === "local") return true;
  return matchesOwner(metadata, { session: dataManager?.session });
}

// Same shape/reasoning as Sanctum's refreshSettingCatalog: ownership
// metadata comes from a dedicated dataManager.list() call (not the full
// fetched body), and local-only entries are always deletable.
async function refreshMapCatalog(ids) {
  mapCatalog = await refreshOwnershipCatalog(dataManager, "map", ids);
}

// Tiered Views (state.map.views) only ever filter what a non-owner sees —
// the map's own owner/editor always gets full, unfiltered access (they're
// authoring it; Views are a presentation concern for viewers). mapAllowsDelete
// already captures exactly this "does the current user actually own this
// map (or is admin)" check — see its own comment for why that's ownership-
// only now, not the broader owner-or-edit-shared rule most other kinds use.
function currentUserHasFullMapAccess() {
  if (!mapExistsOnServer) return true;
  return mapAllowsDelete(state.map.id);
}

// The tier a non-owner viewer's Views filtering resolves against. Currently
// just the signed-in account's own tier — the architecture plan's other
// resolution path (a campaign group's share-link visitor counting as the
// owner's top tier, everyone else as "player") depends on Orrery gaining a
// share-link surface of its own, which doesn't exist yet; that bridge is a
// documented follow-up, not faked here.
function getEffectiveViewerTier() {
  return dataManager?.getUserTier() || "free";
}

// The actual filtering logic lives in lib/map-viewer.js now — shared with
// the Dashboard's Map widget so there's exactly one implementation. See its
// own doc comment for the deny-list ("hidden", not "visible") contract.
function getHiddenLayerIds() {
  return computeHiddenIds(state.map, getEffectiveViewerTier(), currentUserHasFullMapAccess())?.layers ?? null;
}

// Snaps a marker's dropped/placed position to the nearest cell center —
// relocated to lib/map-viewer.js (imported below as
// snapMarkerPositionToGridShared, taking baseMapManager/map as explicit
// parameters instead of this file's own closed-over state) so the
// Dashboard's Map widget can call the exact same logic for a player's own
// token drag, instead of saving an unsnapped raw position (confirmed real
// bug — a visibly different, and per this suite's own top-priority parity
// rule, wrong feel from Orrery's own drag). This thin wrapper just supplies
// this file's own state/baseMapManager so the existing call sites below
// don't all need editing.
function snapMarkerPositionToGrid(position, markerLayer) {
  return snapMarkerPositionToGridShared(baseMapManager, state.map, position, markerLayer);
}

// Same "convert to true container-relative content-space, snap, convert
// back" shape as snapMarkerPositionToGrid just above, but rounds to the
// nearest grid LINE INTERSECTION (a corner) instead of the nearest cell
// CENTER. A token filling a whole cell belongs centered on it; an AoE
// template's origin is where a player would actually measure range from —
// the corner between cells — so the shape's own edges land on grid lines
// instead of cutting cells in half. Skips the getGridCoordFromPoint/
// getGridCellPixelRect round-trip snapMarkerPositionToGrid needs (that
// machinery finds a specific CELL; a corner is just "round each axis to
// the nearest multiple of cell size" directly in the same content-space
// gridOffset/getGridCellSize already share — no hitScale conversion
// needed since neither input here is ever a real screen-pixel point).
function snapShapeOriginToGrid(position, shapeLayer) {
  const gridLayer = state.map.layers.find((entry) => entry.type === "grid");
  if (!gridLayer) {
    return position;
  }
  // Hex grids have no clean 4-corner analog (each cell has 6 vertices,
  // shared unevenly with neighbors) — falls back to the same cell-center
  // snap a marker uses rather than inventing an ambiguous hex rule nothing
  // else here establishes.
  if (getGridType(gridLayer) === "hex") {
    return snapMarkerPositionToGrid(position, shapeLayer);
  }
  const shapeOffset = shapeLayer ? getMarkerLayerOffset(state.map, shapeLayer) : { x: 0, y: 0 };
  const localPixel = markerPositionToLocalPixel(baseMapManager, state.map, position);
  const containerRelative = { x: localPixel.x + shapeOffset.x, y: localPixel.y + shapeOffset.y };
  const gridOffset = getGridOffset(baseMapManager, state.map, gridLayer);
  const cellSize = getGridCellSize(baseMapManager, state.map, gridLayer);
  const relativeX = containerRelative.x - gridOffset.x;
  const relativeY = containerRelative.y - gridOffset.y;
  const snapped = {
    x: Math.round(relativeX / cellSize) * cellSize + gridOffset.x - shapeOffset.x,
    y: Math.round(relativeY / cellSize) * cellSize + gridOffset.y - shapeOffset.y,
  };
  return localPixelToMarkerPosition(baseMapManager, state.map, snapped);
}

// "Clean" baseline for the whole map (a JSON snapshot at last load/save) —
// Save only lights up once the live map actually differs from it, the same
// isDirty/markClean convention Loom/Sanctum already use for their own
// records (there just isn't a single "name" field to diff here, so this
// diffs the whole serialized map instead). Re-established by
// applyMapSnapshot — the one function New/Load/Undo/Redo all already funnel
// through — and again right after a successful save.
let mapCleanSnapshot = null;

// Marker position/image/outlineColor are auto-saved independently and
// immediately (see onMarkerDragEnd/applyMarkerElementChange below) — this
// strips those three fields from every marker element before comparing, so
// the Save button/beforeunload warning only ever reflects genuinely-unsaved
// wall/map-setting/layer-design work, never a marker field that's already
// persisted. `null` passes through unchanged (preserves the existing
// "no clean snapshot yet = dirty" behavior below). updatedAt is ALSO
// stripped at the top level — it's derived metadata, not authored content,
// and every recordHistory-driven mutation bumps it via updateMapTimestamp
// regardless of whether that specific mutation is one of the auto-saved
// ones above (applyMarkerElementChange, autoSaveHiddenFromPlayersView) or a
// genuinely-pending manual edit. Confirmed real bug this fixes: an
// auto-saved change (a marker drag, a quick "hidden from players" toggle)
// left state.map.updatedAt permanently ahead of mapCleanSnapshot's own
// value with nothing to ever reconcile it — isMapDirty() then stayed true
// for the rest of the session even once the auto-saved field itself was
// back in sync, silently blocking every future onChange remote merge in
// watchCurrentMap below (isMapDirty() is one of its guards). A genuinely
// pending manual edit is still caught here regardless — it's the actual
// field content (a layer name, a wall point, a map setting) that differs
// from the snapshot, never updatedAt alone. view (pan/zoom/center/mode) is
// stripped too, for the same class of reason applyRemoteMapLayers already
// documents on its own end ("this session's own live camera position — a
// purely local concern, not something a remote poll should ever
// overwrite"): onViewChange (baseMapManager's pan/zoom callback, above)
// writes state.map.view directly, completely outside recordHistory, with
// nothing ever reconciling it back into mapCleanSnapshot. Confirmed real
// bug this fixes: simply looking around a freshly-loaded map — unavoidable,
// completely passive GM behavior — left isMapDirty() permanently true from
// the very first pan/zoom onward, blocking every future onChange remote
// merge in watchCurrentMap below regardless of selection, dwarfing the
// other two exclusions above in how reliably it triggered.
function normalizeForDirtyCheck(mapJson) {
  if (mapJson === null) return null;
  let map;
  try {
    map = JSON.parse(mapJson);
  } catch (error) {
    return mapJson;
  }
  delete map.updatedAt;
  delete map.view;
  (map.layers || []).forEach((layer) => {
    if (layer.type !== "marker") return;
    (layer.elements || []).forEach((element) => {
      delete element.position;
      delete element.image;
      delete element.outlineColor;
    });
  });
  return JSON.stringify(map);
}

function isMapDirty() {
  return normalizeForDirtyCheck(mapCleanSnapshot) !== normalizeForDirtyCheck(JSON.stringify(state.map));
}

function markMapClean() {
  mapCleanSnapshot = JSON.stringify(state.map);
  updateMapToolbarState();
}

// Whether the pointer's currently in one of the Map Properties inputs —
// isMapDirty()/selection alone don't catch someone mid-keystroke in a text
// field they haven't blurred yet (Map Name, Scale/Unit, Tile Provider,
// Image URL/Width/Height, Canvas Background): state.map itself hasn't
// changed yet at that point (only the raw input value has), so isMapDirty()
// is still false and a poll landing right then would overwrite the field's
// on-screen value with whatever the server has, discarding the keystrokes —
// confirmed as the actual mechanism behind "changes get thrown out if not
// saved by the time the map refreshes."
function isEditingMapProperties() {
  const active = document.activeElement;
  if (!active) return false;
  return [
    elements.mapNameInput,
    elements.measurementScale,
    elements.measurementUnit,
    elements.tileProvider,
    elements.tileQuickPick,
    elements.imageSrc,
    elements.imageWidth,
    elements.imageHeight,
    elements.canvasBackground,
  ].includes(active);
}

// Folds a remote map's layers/groups/base map into the live in-memory map
// WITHOUT touching anything else — no applyMapSnapshot (which also resets
// selection, collapses/expands panels, and re-renders every pane), no
// baseMapManager.setBaseMap() unless the base map itself actually changed
// (that call tears down and rebuilds the whole Leaflet/image/canvas stage,
// which is what was actually causing the reported "frequent flashing" on
// every single poll tick, base map change or not). Only renderLayerOverlays()
// runs afterward — the map canvas itself — never renderLayers()/
// renderGroups()/renderViewsList()/renderBaseMapSettings()/renderJson(), so
// the left/right pane UI (and anything the GM has open/mid-editing there)
// stays completely undisturbed, per the explicit ask that only the map
// itself should refresh. state.map.view is DELIBERATELY excluded from this
// merge — it's this session's own live camera position (pan/zoom), a purely
// local concern, not something a remote poll should ever overwrite.
// Confirmed as a real, significant bug before this: overwriting it here
// (without also calling setBaseMap, since only the base map TYPE/settings
// gate that, not the view) desynced state.map.view.zoom from what
// PanZoomController had actually rendered — grid-cell click math (which
// reads state.map.view.zoom) then disagreed with the real on-screen scale
// by a growing amount the further from the map's origin you clicked, until
// a real pan/zoom forced both back into sync. A poll landing between the
// map's own load and a GM's first interaction (very likely, given how
// often this fires) made it look like it happened on every fresh load.
function applyRemoteMapLayers(nextMap) {
  const baseMapChanged = JSON.stringify(nextMap.baseMap) !== JSON.stringify(state.map.baseMap);
  state.map.layers = nextMap.layers || [];
  state.map.groups = nextMap.groups || [];
  // Confirmed real bug this fixes: this function never touched views at
  // all, so a remote View change (Combat Tracker's own toggleCombatantHiddenFromPlayers
  // write-through, or a GM editing the same map from another tab) never
  // reached Orrery's own in-memory state.map no matter how long the poll
  // ran — every hidden-from-players computation here reads state.map.views
  // directly (computeHiddenIds), with no independent resolver of its own to
  // fall back on now that one used to exist and was removed in favor of
  // this exact mechanism.
  state.map.views = nextMap.views || [];
  state.map.baseMap = nextMap.baseMap || state.map.baseMap;
  state.map.updatedAt = nextMap.updatedAt;
  if (baseMapChanged) {
    baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
  }
  // The left-pane layer LIST, not just the map's own overlay rendering —
  // confirmed real bug this fixes: a remote change that adds a brand-new
  // layer (a player's first Draw/Shape auto-creating a vector layer via
  // persistPlayerDrawing) rendered its contents on the map fine via
  // renderLayerOverlays() alone, but never appeared as a pickable entry in
  // this list until something else (selecting a different layer) happened
  // to trigger a render of it.
  renderLayers();
  renderLayerOverlays();
  // Re-baseline "clean" against the map as it now stands (this function is
  // only ever called from behind an !isMapDirty() check, so state.map
  // exactly matched mapCleanSnapshot before this merge) — otherwise Save
  // would light up right after a poll the GM never touched, since the
  // in-memory map now legitimately differs from the old snapshot.
  mapCleanSnapshot = JSON.stringify(state.map);
  updateMapToolbarState();
}

// Picks up a saved map's own remote changes (a player dragging their token
// via the Dashboard's Map widget, a GM editing the same map from another
// tab) into Orrery's own authoring view, via the same poll+live-stream
// mechanism that widget already uses (common/js/lib/map-live-sync.js) — see
// its own header for why the live-stream half is a no-op here (Orrery has
// no campaign-group context for a map, unlike a Dashboard widget) while the
// plain poll still works regardless. Deliberately conservative about when
// to actually apply an incoming change: never while there's an unsaved
// local edit (isMapDirty()), an active selection, or a Map Properties field
// mid-edit — any of those would mean silently discarding or disrupting
// whatever the GM is doing right now — a remote change just waits for the
// next poll once they're idle again instead.
let mapWatcher = null;
// A just-added/removed condition only actually lives on an "encounter" or
// "character" record — separate from mapWatcher above (which only watches
// the MAP record itself) — so waiting on THAT poll alone means a condition
// only appears once CHARACTER_PAYLOAD_STALE_MS/ACTIVE_ENCOUNTER_STALE_MS's
// own staleness window happens to lapse. Combat Tracker already subscribes
// to exactly these two live-stream kinds for the same reason (per the
// "check for existing transport before inventing a new mechanism"
// principle) — reusing it here rather than adding a second mechanism. Shares
// the SAME pooled EventSource mapWatcher's own watchMapForChanges opens for
// this group (connectLiveStream's own pool is keyed by (dataManager,
// groupId, shareToken), so this is a ref-counted subscribe, not a second
// connection) — this costs nothing extra on the wire, it just adds two more
// listeners that collapse the relevant cache entry and re-render
// immediately instead of waiting out the staleness window.
let conditionLiveStream = null;
function watchCurrentMap(id, shareToken = "") {
  mapWatcher?.stop();
  mapWatcher = null;
  conditionLiveStream?.close();
  conditionLiveStream = null;
  if (!id || !dataManager) {
    return;
  }
  mapWatcher = watchMapForChanges({
    dataManager,
    mapId: id,
    shareToken,
    // The account's active campaign (see getActiveCampaignGroupId) — also
    // what activates the SSE "wake sooner" half of onChange below, since
    // Orrery has no other group context of its own (see this module's own
    // map-live-sync.js header comment).
    groupId: getActiveCampaignGroupId(),
    // 20s, was 10s — less pressure on the "don't land mid-edit" guards
    // below now that a routine tick is a lot cheaper (applyRemoteMapLayers,
    // not a full applyMapSnapshot), but there's no reason to poll a screen
    // nobody's actively watching for changes twice as often as needed.
    pollIntervalMs: 20000,
    onChange: (nextMap) => {
      // No nextMap.id/state.map.id comparison here — a map's own id is
      // filename/library_items metadata, never body content (every Library
      // kind follows this convention now), so nextMap.id was always
      // undefined and this check was UNCONDITIONALLY true, on every single
      // poll and every live-stream tick. Confirmed the actual root cause
      // behind "Orrery never picks up a remote change no matter how long I
      // wait, regardless of selection": applyRemoteMapLayers below never
      // ran at all, full stop — not gated by isMapDirty()/selection like it
      // looked, those guards never even got evaluated on a normal path
      // (short-circuited by this one first). Matches the Dashboard Map
      // widget's own onMapChanged (widgets/map.js) — which never had this
      // check and works correctly — no need for it anyway: watchCurrentMap
      // fully stops the old watcher (mapWatcher?.stop(), which sets its own
      // `destroyed` flag so any in-flight fetch is dropped) before ever
      // creating a new one for a different map, so there's no path for a
      // stale watcher's callback to fire against the wrong map to guard
      // against here.
      if (
        !nextMap ||
        isMapDirty() ||
        state.selection.kind !== null ||
        isEditingMapProperties() ||
        isDraggingRestrictedMarker
      ) {
        return;
      }
      applyRemoteMapLayers(nextMap);
    },
    onPing: renderIncomingPing,
  });
  const groupId = getActiveCampaignGroupId();
  if (groupId) {
    conditionLiveStream = connectLiveStream({ dataManager, groupId, kinds: ["encounter", "character"], shareToken });
    conditionLiveStream.subscribe("encounter", () => {
      activeEncounterCache.delete(groupId);
      activeEncounterFetchedAt.delete(groupId);
      renderLayerOverlays();
    });
    conditionLiveStream.subscribe("character", (payload) => {
      if (payload?.id) {
        characterPayloadCache.delete(payload.id);
        characterPayloadFetchedAt.delete(payload.id);
      }
      renderLayerOverlays();
    });
  }
}

function updateMapToolbarState() {
  if (elements.deleteMapButton) {
    elements.deleteMapButton.disabled = !mapIsLoaded || !mapAllowsDelete(state.map.id);
  }
  if (elements.saveMapButton) {
    elements.saveMapButton.disabled = !isMapDirty();
  }
}

// Lists every Map this user can see (owned/shared/public, plus local/
// anonymous saves) in the picker, mirroring Sanctum's populateSettingSelect.
// Uses fetchKindEntriesWithIds (common/js/lib/content-fetch.js) for remote
// entries so each option's label can show the map's real name, not just its
// id — the same list-then-fetch-each helper Forge/Loom/Crucible already share.
// The combined remote+local map listing — every real map this signed-in
// user (or this anonymous browser's own local saves) can see — factored
// out of populateMapSelect so the Move to Map modal's own destination
// picker (openMoveMarkerModal below) can reuse the exact same list
// instead of a second, drifting copy of this remote-fetch-plus-local-
// merge logic.
async function fetchMapPickerEntries() {
  if (!dataManager) return [];
  let remoteEntries = [];
  try {
    remoteEntries = await fetchKindEntriesWithIds(dataManager, "map");
  } catch (error) {
    remoteEntries = [];
  }
  const remoteIds = new Set(remoteEntries.map((entry) => entry.id));
  const localEntries = dataManager.listLocalEntries("map").filter((entry) => !remoteIds.has(entry.id));
  return [
    ...remoteEntries.map((entry) => ({ id: entry.id, name: entry.entity?.name || entry.id })),
    ...localEntries.map((entry) => ({ id: entry.id, name: entry.payload?.name || entry.id })),
  ];
}

async function populateMapSelect() {
  if (!elements.mapSelect || !dataManager) return;
  const previousId = state.map.id;
  const combined = await fetchMapPickerEntries();
  elements.mapSelect.innerHTML = "";
  // An inert placeholder, not a selectable "new/unsaved" state — matching
  // Workbench's own template/character selector convention (disabled
  // option, unselectable again once a real map's chosen). "New Map" is now
  // the only way to get a fresh map; the dropdown is purely for loading
  // saved ones.
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = "Select Map";
  elements.mapSelect.appendChild(placeholder);
  combined
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.name;
      elements.mapSelect.appendChild(option);
    });
  elements.mapSelect.value = combined.some((entry) => entry.id === previousId) ? previousId : "";
  await refreshMapCatalog(combined.map((entry) => entry.id));
  updateMapToolbarState();
}

function recordHistory(label, applyChange) {
  const before = JSON.stringify(state.map);
  applyChange();
  const after = JSON.stringify(state.map);
  if (before !== after) {
    undoStack.push({ label, before, after });
  }
}

// Which recordHistory label corresponds to which per-marker field being
// auto-saved (see onMarkerDragEnd/applyMarkerElementChange below) — used
// only to make a GM's own Undo/Redo of one of these three specific actions
// also propagate immediately to the server, same as the action itself
// already does, rather than leaving other viewers looking at a stale value
// until the GM happens to click Save.
const MARKER_AUTO_SAVE_FIELD_BY_LABEL = {
  "move marker": "position",
  "marker image": "image",
  "marker outline color": "outlineColor",
};

// Locates WHICH marker element a before/after snapshot pair changed a given
// field on — recordHistory only records the label plus full before/after
// map JSON, not which element was touched, so undo/redo has to work that out
// itself before it can know what to re-persist.
function findChangedMarkerElement(beforeJson, afterJson, field) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeJson);
    after = JSON.parse(afterJson);
  } catch (error) {
    return null;
  }
  for (const layer of after.layers || []) {
    if (layer.type !== "marker") continue;
    const beforeLayer = (before.layers || []).find((entry) => entry.id === layer.id);
    for (const element of layer.elements || []) {
      const beforeElement = beforeLayer?.elements?.find((entry) => entry.id === element.id);
      if (JSON.stringify(beforeElement?.[field]) !== JSON.stringify(element[field])) {
        return { layerId: layer.id, elementId: element.id };
      }
    }
  }
  return null;
}

// recordHistory labels whose action ADDS a brand-new element (Draw/Shape's
// own commit, see setupDrawTool/setupShapeTool below) rather than changing
// an existing one's field — same auto-save-this-specific-action idea as
// MARKER_AUTO_SAVE_FIELD_BY_LABEL just above, but Undo/Redo of these means
// re-syncing the element's very EXISTENCE on the server (create it back /
// delete it again), not re-sending one field's value.
const DRAW_SHAPE_AUTO_SAVE_LABELS = new Set(["draw path", "place shape"]);

// Same "diff before/after to find what changed" strategy as
// findChangedMarkerElement just above, but for an element ADDED to a
// layer's own elements array instead of an existing element's field
// changing — Draw/Shape only ever add exactly one element per commit, so
// "present in after, absent from that same layer in before" uniquely
// identifies it.
function findAddedElement(beforeJson, afterJson) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeJson);
    after = JSON.parse(afterJson);
  } catch (error) {
    return null;
  }
  for (const layer of after.layers || []) {
    const beforeLayer = (before.layers || []).find((entry) => entry.id === layer.id);
    const beforeIds = new Set((beforeLayer?.elements || []).map((entry) => entry.id));
    const added = (layer.elements || []).find((entry) => !beforeIds.has(entry.id));
    if (added) return { layerId: layer.id, elementId: added.id };
  }
  return null;
}

// Patches JUST one element into (or out of) mapCleanSnapshot's own copy of
// one layer — called right after a Draw/Shape creation is auto-saved (or
// after Undo/Redo re-syncs that same creation the other way), so the Save
// button only ever reflects genuinely-batched wall/light/layer-settings
// work afterward, same reasoning normalizeForDirtyCheck's marker-field
// stripping already follows. Deliberately NOT a full markMapClean() here:
// that snapshots the WHOLE map, which would also launder any OTHER already-
// pending local edit (an unsaved wall, say) as "clean" just because it
// happened to be sitting in state.map at this same moment — patching only
// the one synced element avoids that.
function syncCleanSnapshotForElement(layerId, elementId, element) {
  if (!mapCleanSnapshot) return;
  let clean;
  try {
    clean = JSON.parse(mapCleanSnapshot);
  } catch (error) {
    return;
  }
  const layer = clean.layers?.find((entry) => entry.id === layerId);
  if (!layer) return;
  layer.elements = (layer.elements || []).filter((entry) => entry.id !== elementId);
  if (element) layer.elements.push(element);
  mapCleanSnapshot = JSON.stringify(clean);
  updateMapToolbarState();
}

// Re-persists a marker field, or re-syncs a Draw/Shape creation's very
// existence, immediately after Undo/Redo restores it — the action itself
// (drag-end/icon-and-color field commits, or a freshly-drawn stroke/shape's
// own commit) already auto-saves the moment it happens; without this,
// undoing one of those actions would revert the GM's own screen but leave
// every other viewer looking at the un-undone value/element until the next
// unrelated Save.
function autoSaveHistoryEntry(entry) {
  if (!entry || !mapExistsOnServer) return;
  if (DRAW_SHAPE_AUTO_SAVE_LABELS.has(entry.label)) {
    const found = findAddedElement(entry.before, entry.after);
    if (!found) return;
    const layer = state.map.layers?.find((candidate) => candidate.id === found.layerId);
    // Present in the CURRENT (post-applyMapSnapshot) map: we just redid the
    // creation, so re-add it server-side. Absent: we just undid it, so
    // delete it server-side instead — the map's own state already tells us
    // which direction this was without needing an explicit undo/redo flag.
    const element = layer?.elements?.find((candidate) => candidate.id === found.elementId);
    const persistCall = element
      ? persistNewElement({ dataManager, mapId: state.map.id, shareToken: currentShareToken, layerId: found.layerId, element })
      : removeElement({ dataManager, mapId: state.map.id, shareToken: currentShareToken, layerId: found.layerId, elementId: found.elementId });
    void persistCall
      .then(() => {
        syncCleanSnapshotForElement(found.layerId, found.elementId, element || null);
        mapWatcher?.noteLocalWrite();
      })
      .catch((error) => {
        status?.show(error?.message || "Unable to save that change.", { type: "danger" });
      });
    return;
  }
  const field = MARKER_AUTO_SAVE_FIELD_BY_LABEL[entry.label];
  if (!field) return;
  const found = findChangedMarkerElement(entry.before, entry.after, field);
  if (!found) return;
  const layer = state.map.layers?.find((candidate) => candidate.id === found.layerId);
  const element = layer?.elements?.find((candidate) => candidate.id === found.elementId);
  if (!element) return;
  void persistElementUpdate({
    dataManager,
    mapId: state.map.id,
    shareToken: currentShareToken,
    layerId: found.layerId,
    elementId: found.elementId,
    patch: { [field]: element[field] },
  })
    .then(() => mapWatcher?.noteLocalWrite())
    .catch((error) => {
      status?.show(error?.message || "Unable to save that change.", { type: "danger" });
    });
}

// Which marker layer (if any) is "armed" — its own empty-map-space click
// places a new marker there (createMarkerLayerElement's onEmptyClick,
// map-viewer.js). Deliberately NOT the same thing as "this layer's own
// marker-element is the current selection": explicitly selecting the Layer
// itself arms it (below), and placing/clicking a marker WHILE its layer is
// already armed keeps it armed (so rapid "click empty space, click empty
// space, ..." placement, or nudging an existing marker mid-session, both
// stay fluid) — but fallback-clicking an existing marker directly (see
// isLayerFallbackInteractive) does NOT arm its layer, so clicking elsewhere
// afterward falls through to panning/deselecting instead of silently
// placing a brand new marker. Confirmed real bug this fixes: a
// fallback-selected marker's own layer looked "selected" (isSelected,
// map-viewer.js's renderMapLayers, since isMarkerElementSelected is one of
// its own OR'd branches) purely from having clicked one marker, arming
// empty-click placement for a layer the user never actually chose to edit.
let armedMarkerLayerId = null;

// Clears a stale, still-focused field (Label input, Position X/Y, Name,
// ...) whenever the user picks a NEW selection on the map or in a list —
// every marker/shape/empty-space pointerdown handler in this file calls
// event.preventDefault() (needed so the click doesn't ALSO trigger the
// browser's own drag-select/text-select behavior), which as a side effect
// suppresses the browser's normal "clicking elsewhere blurs whatever was
// focused" behavior too. Confirmed real bug this fixes: a field left
// focused from editing the PREVIOUS selection (or the map's own Name
// field) silently survived clicking a brand new marker, so the global
// Delete/Backspace shortcut's own isEditableTarget guard (correctly
// designed to never delete while the user is mid-edit in a field) kept
// treating every fresh selection as "still typing" until an unrelated
// later click happened to blur it — reported as "the first delete on a
// token never works, but reselecting it does." Blurring here also commits
// whatever was in that stale field, via its own existing change/blur
// listener, exactly as if the user had clicked away from it normally.
// BUTTON included alongside the form fields — confirmed real bug this
// fixes: deleting a selected shape (via the selection toolbar's own
// focused "Delete shape" button) rebuilds that toolbar as part of the same
// setSelection() call, removing the still-focused button from the DOM out
// from under itself. Left unblurred first, the browser's own "focused
// element just vanished" fallback could land focus on a NEARBY toolbar
// button (Draw a Shape/Effect) instead of cleanly resetting to the body —
// visually indistinguishable from that button's own `.active` toggled
// state, reading as "still in draw mode" even though shapeModeActive is
// correctly false. Blurring here, BEFORE that removal happens, sends focus
// to the body in a predictable way instead.
function blurStaleActiveField() {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.tagName === "BUTTON" ||
      active.isContentEditable)
  ) {
    active.blur();
  }
}

function setSelection(kind, id = null, extra = {}) {
  blurStaleActiveField();
  if (kind === "layer") {
    armedMarkerLayerId = id;
  } else if (!(kind === "marker-element" && extra.layerId === armedMarkerLayerId)) {
    armedMarkerLayerId = null;
  }
  state.selection = {
    kind,
    id,
    layerId: extra.layerId ?? null,
    cells: extra.cells ?? [],
    // Multi-selected markers only — {layerId, id} pairs (a marker's own
    // layer isn't necessarily the same for every entry, unlike the
    // single-select `layerId` field above), see toggleMarkerMultiSelect.
    elements: extra.elements ?? [],
    anchor: extra.anchor ?? (extra.cells?.[0]?.coord ?? null),
  };
  if (kind === "grid-cells" && state.selection.cells.length) {
    state.lastGridSelection = {
      layerId: state.selection.layerId,
      cells: state.selection.cells.map((cell) => ({ ...cell })),
    };
  }
  // The left pane's own Layers/Groups/Views lists only ever got rebuilt as
  // a side effect of MUTATING actions (applyGroupChange, add/delete
  // layer/group/view, ...) — never from a plain selection change on its
  // own. Confirmed as a real bug before this: a group's blue .active state
  // only ever appeared via one of those mutation-triggered rebuilds, and
  // then stayed frozen on that same row forever after — every later
  // selection change (clicking a different group, a layer, anything)
  // updates state.selection just fine, but with nothing left to
  // re-render these three lists, the DOM's own stale .active classes
  // never move or clear. Cheap enough to just always do here — these are
  // small lists, and explicit selection changes (unlike paint-mode's own
  // per-cell drag updates, which never call setSelection at all) are
  // infrequent.
  renderLayers();
  renderGroups();
  renderViewsList();
  renderSelection();
  renderLayerOverlays();
  syncOverlayInteractivity();
  updateDrawAvailability();
  updateShapeAvailability();
  updateWallAvailability();
  updateLightAvailability();
  const shouldExpand =
    kind === "layer" ||
    kind === "group" ||
    kind === "grid-cells" ||
    kind === "view" ||
    kind === "marker-element" ||
    kind === "marker-elements" ||
    kind === "vector-path";
  setPanelFocus(shouldExpand);
}

// Click-to-select, click-again-to-deselect — used by the left pane's own
// Layer/Group/View list rows (their whole reason to exist is picking one
// thing at a time; re-clicking the one already active most naturally means
// "never mind"), not by every setSelection call in this file (a delete
// handler picking a fallback selection, say, isn't a row the GM clicked
// twice — a plain setSelection there stays a plain setSelection).
function toggleSelection(kind, id, extra = {}) {
  if (state.selection.kind === kind && state.selection.id === id) {
    setSelection(null);
  } else {
    setSelection(kind, id, extra);
  }
}

// Single source of truth for "delete whatever's currently selected" — used
// by the global Delete/Backspace keyboard shortcut AND every selection
// editor's own Delete button (each just calls this instead of duplicating
// the same recordHistory/filter/setSelection logic a second time). Acts
// directly on state.selection, never on any rendered DOM button — so it
// works correctly regardless of whether the selection editor panel has
// actually finished building yet. Confirmed real bug this fixes: the
// keyboard shortcut used to find-and-click a
// `[data-action="delete-selected"]` button in the DOM, but
// renderMarkerElementSelectionEditor is async (a freshly placed or
// freshly (re)selected marker takes a render pass before its own Delete
// button exists at all — see that function's own markerSelectionEditorRenderId
// comment on why it can't just build synchronously) — any keypress landing
// in that window silently did nothing: "hit or miss," matching the reported
// behavior exactly, not just right after creating a marker (ANY later
// re-render of the panel — e.g. a remote map update landing while this
// marker is selected — reopens the same window).
// Returns true if something was actually deleted, so the keydown handler
// knows whether to consume the key.
function deleteCurrentSelection() {
  const { selection, map } = state;
  if (selection.kind === "layer") {
    const index = map.layers.findIndex((entry) => entry.id === selection.id);
    if (index === -1) return false;
    recordHistory("delete layer", () => {
      map.layers.splice(index, 1);
      updateMapTimestamp(map);
    });
    setSelection(null);
    renderLayers();
    renderLayerOverlays();
    renderJson();
    return true;
  }
  if (selection.kind === "group") {
    const index = map.groups.findIndex((entry) => entry.id === selection.id);
    if (index === -1) return false;
    recordHistory("delete group", () => {
      map.groups.splice(index, 1);
      updateMapTimestamp(map);
    });
    setSelection(null);
    renderGroups();
    renderLayerOverlays();
    renderJson();
    return true;
  }
  if (selection.kind === "view") {
    const index = map.views.findIndex((entry) => entry.id === selection.id);
    if (index === -1) return false;
    recordHistory("delete view", () => {
      map.views.splice(index, 1);
      updateMapTimestamp(map);
    });
    setSelection(null);
    renderViewsList();
    renderJson();
    return true;
  }
  if (selection.kind === "marker-element") {
    const layer = map.layers.find((entry) => entry.id === selection.layerId);
    const markerElement = layer?.elements?.find((entry) => entry.id === selection.id);
    if (!layer || !markerElement) return false;
    recordHistory("delete marker", () => {
      layer.elements = (layer.elements || []).filter((entry) => entry.id !== markerElement.id);
      updateMapTimestamp(map);
    });
    setSelection("layer", layer.id);
    return true;
  }
  if (selection.kind === "marker-elements") {
    const resolved = resolveSelectedMarkerElements(selection);
    if (!resolved.length) return false;
    // Grouped by layer (a multi-selection can span several marker
    // layers) so every removal lands in one recordHistory entry, same
    // "one undo step per user action" convention every other bulk
    // mutation in this file already follows.
    const idsByLayer = new Map();
    resolved.forEach(({ layer, markerElement }) => {
      if (!idsByLayer.has(layer.id)) idsByLayer.set(layer.id, new Set());
      idsByLayer.get(layer.id).add(markerElement.id);
    });
    recordHistory("delete markers", () => {
      idsByLayer.forEach((ids, layerId) => {
        const layer = map.layers.find((entry) => entry.id === layerId);
        if (!layer) return;
        layer.elements = (layer.elements || []).filter((entry) => !ids.has(entry.id));
      });
      updateMapTimestamp(map);
    });
    setSelection(null);
    return true;
  }
  if (selection.kind === "vector-path") {
    const layer = map.layers.find((entry) => entry.id === selection.layerId);
    const element = layer?.elements?.find((entry) => entry.id === selection.id);
    if (!layer || !element) return false;
    const label =
      element.kind === "wall" ? "delete wall" : element.kind === "light" ? "delete light" : element.kind === "shape" ? "delete shape" : "delete path";
    recordHistory(label, () => {
      layer.elements = (layer.elements || []).filter((entry) => entry.id !== element.id);
      updateMapTimestamp(map);
    });
    setSelection("layer", layer.id);
    return true;
  }
  return false;
}

// The one View toggleElementHiddenFromPlayers manages for itself
// (View.autoManaged, createView's own comment) — auto-created the first
// time a GM uses the marker's own "Hidden from players" convenience switch,
// same "auto-create the first time you need it" precedent the fog-of-war
// reveal-group (`revealGroupId`) already sets. Only ever returns/creates
// THIS one View; a hand-authored View a GM separately scopes to "player"
// tier via the View editor's own Visible Components checklist is a
// deliberately SEPARATE, independent thing this never touches.
function ensureAutoManagedPlayerView() {
  let view = state.map.views.find((entry) => entry.autoManaged);
  if (!view) {
    view = createView({ name: "Player View (auto)", tiers: ["player"], autoManaged: true });
    state.map.views.push(view);
  }
  return view;
}

// Read-only — whether `elementId` is currently hidden by the auto-managed
// Player View specifically (not the union of every View that might also
// hide it — see this function's own toggle below for why that's the right
// scope for a single convenience switch). False, not an error, when the
// auto-managed View doesn't exist yet at all.
function isElementHiddenFromPlayers(elementId) {
  const view = state.map.views.find((entry) => entry.autoManaged);
  return Boolean(view?.hiddenElementIds?.includes(elementId));
}

// Explicit target `hidden`, not a per-element flip — the right shape for
// a bulk toggle over a multi-selection that can start in a MIXED state
// (some already hidden, some not): one recordHistory entry sets every
// listed id to the SAME final state, converging the whole group in one
// action rather than each marker flipping independently of the others.
// toggleElementHiddenFromPlayers (below) is just this called with a
// single-element list and the opposite of its own current state — same
// mechanism, not a second copy of it.
function setElementsHiddenFromPlayers(elementIds, hidden) {
  if (!elementIds.length) return;
  recordHistory(hidden ? "hide from players" : "show to players", () => {
    const view = ensureAutoManagedPlayerView();
    const hiddenSet = new Set(view.hiddenElementIds || []);
    elementIds.forEach((elementId) => {
      if (hidden) hiddenSet.add(elementId);
      else hiddenSet.delete(elementId);
    });
    view.hiddenElementIds = Array.from(hiddenSet);
    updateMapTimestamp(state.map);
  });
  renderSelection();
  renderLayerOverlays();
  renderViewsList();
  renderJson();
  // Saves itself instantly, like a marker's own position/image/outline
  // color (MARKER_AUTO_SAVE_FIELD_BY_LABEL) — confirmed real bug without
  // this: the toggle only ever updated state.map in memory, so the
  // Dashboard's Map widget (reading the server, via its own poll) never
  // picked it up until the GM happened to hit the map's own batched Save
  // button. void — best-effort, same as the marker-field auto-saves.
  void autoSaveHiddenFromPlayersView(elementIds, hidden);
}

function toggleElementHiddenFromPlayers(elementId) {
  setElementsHiddenFromPlayers([elementId], !isElementHiddenFromPlayers(elementId));
}

// Narrow read-modify-write against the server's OWN current copy of this
// map (not state.map — same reasoning as persistElementUpdate,
// map-live-sync.js: state.map may carry OTHER pending, not-yet-saved edits
// the GM hasn't hit Save for yet, and this auto-save must never eagerly
// persist those as a side effect of a quick visibility toggle). Applies
// the SAME explicit `hidden` target setElementsHiddenFromPlayers already
// applied LOCALLY onto the fresh server copy's own auto-managed View,
// rather than re-deriving/re-toggling independently — a rapid double-
// toggle before this resolves must always converge on the same final
// state the GM's own screen already shows, not whatever order two
// competing toggles happen to land on the server in. Bulk-capable
// (elementIds is always an array, one or many) so a multi-marker
// visibility change is one fetch-modify-save round trip, not one per
// marker.
async function autoSaveHiddenFromPlayersView(elementIds, hidden) {
  if (!mapExistsOnServer || !dataManager) return;
  try {
    const result = await dataManager.get("map", state.map.id, { shareToken: currentShareToken, preferLocal: false });
    const freshMap = result.payload;
    freshMap.views = Array.isArray(freshMap.views) ? freshMap.views : [];
    let view = freshMap.views.find((entry) => entry.autoManaged);
    if (!view) {
      view = createView({ name: "Player View (auto)", tiers: ["player"], autoManaged: true });
      freshMap.views.push(view);
    }
    const hiddenSet = new Set(view.hiddenElementIds || []);
    elementIds.forEach((elementId) => {
      if (hidden) hiddenSet.add(elementId);
      else hiddenSet.delete(elementId);
    });
    view.hiddenElementIds = Array.from(hiddenSet);
    await dataManager.save("map", state.map.id, freshMap);
    mapWatcher?.noteLocalWrite();
    // Confirmed real bug this fixes: this auto-save never re-baselined
    // mapCleanSnapshot, so isMapDirty() (which compares the FULL state.map,
    // views included, against that snapshot) stayed permanently true from
    // the very first use of this toggle onward — silently blocking every
    // future onChange merge in watchCurrentMap above (isMapDirty() is one
    // of its guards), no matter what was or wasn't selected. Can't just
    // exclude views wholesale from normalizeForDirtyCheck the way marker
    // position/image/outlineColor are excluded — hiddenElementIds on any
    // view, including this auto-managed one, can ALSO be edited manually
    // through the View editor's own checklist (applyViewChange), which does
    // NOT auto-save and must still show as dirty. So re-baseline only the
    // views slice, at the moment it's confirmed synced with the server —
    // any later edit (either path) will correctly diverge from THIS
    // snapshot and show dirty again. (updatedAt itself needs no special
    // handling here — normalizeForDirtyCheck excludes it from the
    // comparison entirely, see its own comment.)
    if (mapCleanSnapshot !== null) {
      try {
        const clean = JSON.parse(mapCleanSnapshot);
        clean.views = JSON.parse(JSON.stringify(state.map.views));
        mapCleanSnapshot = JSON.stringify(clean);
        updateMapToolbarState();
      } catch (error) {
        // mapCleanSnapshot is always our own prior JSON.stringify output —
        // parse failure isn't expected, but isn't worth surfacing to the GM
        // over what's still a successful save.
      }
    }
  } catch (error) {
    status?.show(error?.message || "Unable to save that change.", { type: "danger" });
  }
}

// Move to Map's own source-side removal (openMoveMarkerModal's Apply
// handler) needs to persist just as immediately as the destination-side
// add already does (dataManager.save, right in that same handler) — or a
// moved marker briefly exists on BOTH maps until the GM remembers to hit
// THIS map's own Save button. Confirmed real bug this fixes: the marker
// correctly vanished from the current view (state.map itself was
// mutated right away) but reappeared after navigating away and back,
// because only the destination side had actually reached the server.
// Same "fetch fresh, mutate, save" shape as autoSaveHiddenFromPlayersView
// just above and removeElement (common/js/lib/map-live-sync.js) — a
// local, bulk-capable version rather than looping that shared
// single-element helper once per marker, so removing several markers in
// one move is still one fetch-modify-save round trip against the source
// map, not one per marker. idsByLayer: Map<layerId, Set<elementId>>.
async function autoSaveRemovedMarkerElements(idsByLayer) {
  if (!mapExistsOnServer || !dataManager) return;
  try {
    const result = await dataManager.get("map", state.map.id, { shareToken: currentShareToken, preferLocal: false });
    const freshMap = result.payload;
    idsByLayer.forEach((ids, layerId) => {
      const layer = freshMap.layers?.find((entry) => entry.id === layerId);
      if (!layer) return;
      layer.elements = (layer.elements || []).filter((entry) => !ids.has(entry.id));
    });
    await dataManager.save("map", state.map.id, freshMap);
    mapWatcher?.noteLocalWrite();
    // Same per-element clean-snapshot patch autoSaveHistoryEntry's own
    // Draw/Shape-deletion branch uses (syncCleanSnapshotForElement,
    // element: null means "remove it") — so the Save button doesn't keep
    // nagging the GM about a removal that's already reached the server.
    idsByLayer.forEach((ids, layerId) => {
      ids.forEach((elementId) => syncCleanSnapshotForElement(layerId, elementId, null));
    });
  } catch (error) {
    status?.show(error?.message || "Unable to save that change.", { type: "danger" });
  }
}

function renderBaseMapSettings() {
  const { baseMap } = state.map;
  elements.baseMapRadios.forEach((radio) => {
    radio.checked = radio.value === baseMap.type;
  });

  elements.baseMapSettings.forEach((section) => {
    const type = section.dataset.baseMapSettings;
    section.classList.toggle("d-none", type !== baseMap.type);
  });
  document.querySelectorAll(".orrery-initial-position-field").forEach((field) => {
    field.classList.toggle("d-none", baseMap.type === "tile");
  });

  const imageSettings = baseMap.settings.image;
  elements.imageSrc.value = imageSettings.src;
  // null (no override, native size) has to become "" here — assigning null
  // directly to a text input's .value stringifies to the literal text
  // "null".
  elements.imageWidth.value = imageSettings.width ?? "";
  elements.imageHeight.value = imageSettings.height ?? "";

  const canvasSettings = baseMap.settings.canvas;
  elements.canvasBackground.value = canvasSettings.background;

  if (elements.tileProvider) {
    elements.tileProvider.value = baseMap.settings.tile.urlTemplate;
  }
  if (elements.tileQuickPick) {
    elements.tileQuickPick.value = "";
  }
}

// Same icon per layer type as the "Add X layer" buttons just above this
// list (data-add-layer-mount) — literally the same string, so the list row
// always matches whatever icon a GM just clicked to create it.
const LAYER_TYPE_ICONS = {
  vector: "tabler:vector",
  grid: "tabler:grid-dots",
  raster: "tabler:photo",
  marker: "tabler:map-pin",
};

// Icon + short label for one of a layer's own placed elements, by kind —
// shared by the left pane's own per-layer component list (renderLayers,
// just below) and kept deliberately independent from renderSelection's own
// (pre-existing, unchanged) per-kind icon/title logic, which additionally
// needs full context (preset lookup for a shape's category, point counts,
// ...) this compact list has no room to show. `cell` (a grid layer's own
// sparse, lazily-created touched-cell elements — ensureGridCell) is
// deliberately never passed in here at all — see renderLayers' own filter
// just below for why.
function describeLayerElement(element) {
  if (element.kind === "marker") {
    return { icon: "tabler:map-pin", label: element.label || "Marker" };
  }
  if (element.kind === "shape") {
    const preset = getPresetById(element.presetId) || getPresetById("circle");
    return { icon: preset.kind === "particles" ? "tabler:sparkles" : "tabler:target", label: element.label || preset.label };
  }
  if (element.kind === "wall") {
    return { icon: element.wallType === "door" ? "tabler:door" : "tabler:wall", label: element.wallType === "door" ? "Door" : "Wall" };
  }
  if (element.kind === "light") {
    return { icon: "tabler:bulb", label: element.label || "Light" };
  }
  return { icon: "tabler:pencil", label: "Drawn Path" };
}

// Displayed topmost-first (reverse of state.map.layers' own array order,
// where a LATER array index renders on top — see renderMapLayers in
// lib/map-viewer.js, which appends in plain array order and lets normal DOM
// stacking put later siblings in front) — matches the Photoshop-style
// convention GMs already expect: the layer nearest the top of the list is
// the one rendered nearest the front of the map.
// Palette-style row (icon left, larger, matching Press/Workbench's own
// component palette) — Visible/Locked and Move up/down all live in the
// right pane's Selection panel once a layer is actually selected (the
// "Visible"/"Locked" switches in renderLayerSelectionEditor, the
// move-up/move-down toolbar buttons), so this list stays purely "pick a
// layer" for those, not a second place those same controls live and can
// drift out of sync — the Lock icon shown here is a read-only glance
// indicator, not a control of its own (clicking it does the same thing
// clicking anywhere else on the row does: select the layer).
//
// Whichever layer currently owns the selection (the layer itself, OR one
// of its own elements — a marker/shape/wall/light/grid-cells selection all
// carry layerId) gets an expanded sub-list of its own placed elements
// underneath it, each a small button in the same icon+label shape as the
// layer row above it (describeLayerElement) — a second, always-available
// way to reach a specific component besides clicking it on the map, which
// a Locked layer (or one simply buried under other layers' own hit
// targets) can make awkward. Grid cells are deliberately excluded — a grid
// layer's own `elements` only holds whichever cells have actually been
// touched (ensureGridCell), a set that's typically sparse but can still run
// into the dozens/hundreds on a well-used map, and cell selection is
// already a dedicated multi-select flow (click/shift/ctrl on the grid
// itself, or a Group) this per-element button list isn't meant to replace.
function renderLayers() {
  disposeTooltips(elements.layerList);
  elements.layerList.innerHTML = "";
  const hiddenLayerIds = getHiddenLayerIds();
  state.map.layers
    .slice()
    .reverse()
    .forEach((layer) => {
      if (hiddenLayerIds?.has(layer.id)) {
        return;
      }
      // state.selection.layerId (the single-select field) is always null
      // for a "marker-elements" selection — checked separately here, or
      // every layer's own sub-list would collapse the instant a second
      // marker gets Ctrl-clicked into a multi-selection, hiding the very
      // list this feature needs to keep extending/shrinking that
      // selection from. Confirmed real bug this avoids, caught alongside
      // isLayerSelected's own matching fix just above.
      const isLayerActive =
        (state.selection.kind === "layer" && state.selection.id === layer.id) ||
        state.selection.layerId === layer.id ||
        (state.selection.kind === "marker-elements" && (state.selection.elements || []).some((entry) => entry.layerId === layer.id));
      const item = document.createElement("button");
      item.type = "button";
      item.className = "list-group-item list-group-item-action d-flex align-items-center gap-2";
      if (state.selection.kind === "layer" && state.selection.id === layer.id) {
        item.classList.add("active");
      }
      const icon = document.createElement("span");
      icon.className = "iconify fs-4 text-primary flex-shrink-0";
      icon.dataset.icon = LAYER_TYPE_ICONS[layer.type] || "tabler:layers-intersect";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "text-truncate";
      label.textContent = layer.name;
      item.append(icon, label);
      if (layer.locked) {
        const lockIcon = document.createElement("span");
        lockIcon.className = "iconify text-body-secondary flex-shrink-0 ms-auto";
        lockIcon.dataset.icon = "tabler:lock";
        lockIcon.setAttribute("aria-hidden", "true");
        item.appendChild(lockIcon);
      }
      item.addEventListener("click", () => toggleSelection("layer", layer.id));
      elements.layerList.appendChild(item);

      if (!isLayerActive || layer.type === "grid" || layer.type === "raster") {
        return;
      }
      const componentList = (layer.elements || []).filter((element) => element.kind !== "cell");
      const sublist = document.createElement("div");
      sublist.className = "d-flex flex-column gap-1 ps-4 py-1";
      if (componentList.length === 0) {
        const empty = document.createElement("div");
        empty.className = "small text-body-secondary";
        empty.textContent = "No components yet.";
        sublist.appendChild(empty);
      } else {
        componentList.forEach((element) => {
          const { icon: componentIcon, label: componentLabel } = describeLayerElement(element);
          const isSelected =
            ((state.selection.kind === "vector-path" || state.selection.kind === "marker-element") &&
              state.selection.id === element.id) ||
            (state.selection.kind === "marker-elements" && state.selection.elements.some((entry) => entry.id === element.id));
          const componentButton = document.createElement("button");
          componentButton.type = "button";
          componentButton.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1 small";
          if (isSelected) {
            componentButton.classList.add("active");
          }
          const componentIconEl = document.createElement("span");
          componentIconEl.className = "iconify flex-shrink-0";
          componentIconEl.dataset.icon = componentIcon;
          componentIconEl.setAttribute("aria-hidden", "true");
          const componentLabelEl = document.createElement("span");
          componentLabelEl.className = "text-truncate";
          componentLabelEl.textContent = componentLabel;
          componentButton.append(componentIconEl, componentLabelEl);
          componentButton.addEventListener("click", (event) => {
            // Ctrl/Cmd/Shift-click extends/shrinks a marker multi-selection
            // instead of replacing it — same modifier-key convention as the
            // map canvas's own marker dots (createMarkerDot, map-viewer.js).
            // Only markers support this; a vector-path element (wall,
            // light, shape) click is unchanged regardless of modifier keys.
            if (element.kind === "marker" && (event.ctrlKey || event.metaKey || event.shiftKey)) {
              toggleMarkerMultiSelect(layer, element);
              return;
            }
            toggleSelection(element.kind === "marker" ? "marker-element" : "vector-path", element.id, { layerId: layer.id });
          });
          sublist.appendChild(componentButton);
        });
      }
      elements.layerList.appendChild(sublist);
    });
}

function moveLayer(layer, delta) {
  const layers = state.map.layers;
  const index = layers.indexOf(layer);
  const nextIndex = index + delta;
  if (index === -1 || nextIndex < 0 || nextIndex >= layers.length) {
    return;
  }
  recordHistory("reorder layer", () => {
    layers.splice(index, 1);
    layers.splice(nextIndex, 0, layer);
    updateMapTimestamp(state.map);
  });
  renderLayers();
  // Also re-renders the right pane's own copy of these same reorder
  // buttons (renderLayerSelectionEditor) so their disabled-at-the-boundary
  // state stays correct regardless of which copy (left list or right
  // panel) was actually clicked.
  renderSelection();
  renderLayerOverlays();
  renderJson();
}

// Deep-copies a layer — settings/position/opacity/properties, plus every
// one of its own elements — through the SAME map-model.js factories that
// create them fresh, rather than hand-rolling a JSON clone with the
// original's own ids poked out. Marker/path/shape/grid-cell ids are what
// Groups and selection state key off of; sharing them with the source
// layer would make the two layers' own elements indistinguishable to
// anything that looks one up by id, not just visually duplicated.
function duplicateLayer(sourceLayer) {
  const layer = createLayer({ type: sourceLayer.type, name: `${sourceLayer.name} (copy)` });
  layer.visible = sourceLayer.visible;
  layer.locked = Boolean(sourceLayer.locked);
  layer.opacity = sourceLayer.opacity;
  layer.position = { ...(sourceLayer.position || { x: 0, y: 0 }) };
  layer.settings = JSON.parse(JSON.stringify(sourceLayer.settings || {}));
  layer.properties = JSON.parse(JSON.stringify(sourceLayer.properties || {}));
  layer.elements = (sourceLayer.elements || []).map((element) => duplicateLayerElement(element));
  return layer;
}

function duplicateLayerElement(element) {
  if (element.kind === "marker") {
    return createMarkerElement({
      refKind: element.refKind,
      refId: element.refId,
      label: element.label,
      image: element.image,
      position: element.position ? { ...element.position } : undefined,
    });
  }
  if (element.kind === "path") {
    return createVectorPathElement({
      points: (element.points || []).map((point) => ({ ...point })),
      strokeColor: element.strokeColor,
      fillColor: element.fillColor,
      strokeWidth: element.strokeWidth,
    });
  }
  if (element.kind === "shape") {
    return createVectorShapeElement({
      presetId: element.presetId,
      origin: element.origin ? { ...element.origin } : undefined,
      // Attachment deliberately NOT copied — two elements bound to the same
      // token would render on top of each other with no way to tell them
      // apart via drag; a duplicate always starts freestanding at the
      // original's own (copied) origin, same as how a duplicated Light
      // would need the identical treatment if it ever gained this same
      // Duplicate action (it doesn't yet, so there's nothing to keep
      // consistent with today — this is just the correct default on its
      // own merits).
      label: element.label,
      loop: element.loop,
      sizeCells: element.sizeCells,
      angleDeg: element.angleDeg,
      spreadDeg: element.spreadDeg,
      widthCells: element.widthCells,
      values: element.values ? { ...element.values } : undefined,
      strokeWidth: element.strokeWidth,
      opacity: element.opacity,
      snapToGrid: element.snapToGrid,
    });
  }
  if (element.kind === "wall") {
    return createWallElement({
      points: (element.points || []).map((point) => ({ ...point })),
      wallType: element.wallType,
      doorState: element.doorState,
      secret: element.secret,
      locked: element.locked,
      strokeColor: element.strokeColor,
      strokeWidth: element.strokeWidth,
    });
  }
  if (element.kind === "light") {
    return createLightElement({
      origin: element.origin ? { ...element.origin } : undefined,
      attachedMarkerId: element.attachedMarkerId,
      rangeCells: element.rangeCells,
      color: element.color,
      opacity: element.opacity,
    });
  }
  if (element.kind === "cell") {
    // `key` is coord-derived (getGridCellKey), not an identity id — safe
    // (and correct) to carry over as-is, unlike `id` which createGridCell
    // regenerates fresh below.
    const cell = createGridCell({ key: element.key, coord: element.coord ? { ...element.coord } : undefined, gridType: element.gridType });
    cell.properties = JSON.parse(JSON.stringify(element.properties || {}));
    return cell;
  }
  // Unknown element kind — shouldn't happen, but fall back to a raw clone
  // rather than silently dropping it.
  return JSON.parse(JSON.stringify(element));
}

function renderGroups() {
  disposeTooltips(elements.groupList);
  elements.groupList.innerHTML = "";
  if (state.map.groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-group-item text-body-secondary small";
    empty.textContent = "No groups yet.";
    elements.groupList.appendChild(empty);
    return;
  }
  state.map.groups.forEach((group) => {
    const item = document.createElement("button");
    item.type = "button";
    // Palette-style row (icon left, larger) — same icon as the Add group
    // button just above this list (data-add-group-mount), matching Layers'
    // own row convention just above.
    item.className = "list-group-item list-group-item-action d-flex align-items-center gap-2";
    // .active (Bootstrap's real styled selection state), not aria-current —
    // matches Views below and Combat Tracker's own selected-row convention;
    // aria-current alone has no visual effect anywhere in this suite's CSS.
    if (state.selection.kind === "group" && state.selection.id === group.id) {
      item.classList.add("active");
    }
    const icon = document.createElement("span");
    icon.className = "iconify fs-4 text-primary flex-shrink-0";
    icon.dataset.icon = "tabler:folder-plus";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "text-truncate";
    label.textContent = group.name;
    item.append(icon, label);
    item.addEventListener("click", () => toggleSelection("group", group.id));
    elements.groupList.appendChild(item);
  });
}

function renderViewsList() {
  if (!elements.viewList) {
    return;
  }
  disposeTooltips(elements.viewList);
  elements.viewList.innerHTML = "";
  if (!state.map.views || state.map.views.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-group-item text-body-secondary small";
    empty.textContent = "No views yet.";
    elements.viewList.appendChild(empty);
    return;
  }
  state.map.views.forEach((view) => {
    const isSelected = state.selection.kind === "view" && state.selection.id === view.id;
    const item = document.createElement("button");
    item.type = "button";
    // Palette-style row (icon left, larger) — same icon as the Add view
    // button just above this list (data-add-view-mount), matching
    // Layers'/Groups' own row convention just above.
    item.className = "list-group-item list-group-item-action d-flex align-items-center gap-2";
    if (isSelected) {
      item.classList.add("active");
    }
    const icon = document.createElement("span");
    icon.className = "iconify fs-4 text-primary flex-shrink-0";
    icon.dataset.icon = "tabler:eye-plus";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "text-truncate";
    label.textContent = view.name;
    item.append(icon, label);
    item.addEventListener("click", () => toggleSelection("view", view.id));
    elements.viewList.appendChild(item);
  });
}

// Replaces the old text badge/pill (data-selection-type) — a single blue
// icon, same "consistent blue icon instead of a pill" treatment the
// Layers/Groups/Views list rows just above already use, and (where the
// kind IS a layer type) literally the same icon those rows/the Add-layer
// buttons use. null hides it entirely (the "No selection" state).
function setSelectionTypeIcon(icon) {
  if (!elements.selectionTypeIcon) {
    return;
  }
  if (icon) {
    elements.selectionTypeIcon.dataset.icon = icon;
    elements.selectionTypeIcon.classList.remove("d-none");
  } else {
    elements.selectionTypeIcon.classList.add("d-none");
  }
}

function renderSelection() {
  const { selection, map } = state;
  if (elements.selectionClear) {
    elements.selectionClear.classList.toggle("d-none", selection.kind === null);
  }
  // Cleared unconditionally, then repopulated only by whichever selection
  // kind's own render function actually uses it (every kind now except a
  // plain drawn path, which still builds a standalone inline Delete —
  // renderVectorPathSelectionEditor's own delete-and-redraw-only shape has
  // no other buttons to group it with).
  if (elements.selectionToolbar) {
    disposeTooltips(elements.selectionToolbar);
    elements.selectionToolbar.innerHTML = "";
  }
  if (selection.kind === "layer") {
    const layer = map.layers.find((entry) => entry.id === selection.id);
    if (layer) {
      elements.selectionTitle.textContent = layer.name;
      setSelectionTypeIcon(LAYER_TYPE_ICONS[layer.type] || "tabler:layers-intersect");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = layer.locked
          ? `Visible: ${layer.visible ? "Yes" : "No"} · Locked`
          : `Visible: ${layer.visible ? "Yes" : "No"}`;
      }
      renderLayerSelectionEditor(layer);
      return;
    }
  }

  if (selection.kind === "group") {
    const group = map.groups.find((entry) => entry.id === selection.id);
    if (group) {
      elements.selectionTitle.textContent = group.name;
      setSelectionTypeIcon("tabler:folder-plus");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `Members: ${group.elementIds.length}`;
      }
      renderGroupSelectionEditor(group);
      return;
    }
  }

  if (selection.kind === "view") {
    const view = map.views?.find((entry) => entry.id === selection.id);
    if (view) {
      elements.selectionTitle.textContent = view.name;
      setSelectionTypeIcon("tabler:eye-plus");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = view.description ? "Custom view" : "No description yet.";
      }
      renderViewSelectionEditor(view);
      return;
    }
  }

  if (selection.kind === "grid-cells") {
    const layer = map.layers.find((entry) => entry.id === selection.layerId);
    if (layer) {
      const cellCount = selection.cells.length;
      elements.selectionTitle.textContent = "Cell Selection";
      setSelectionTypeIcon("tabler:square-check");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `${layer.name} · ${cellCount} ${cellCount === 1 ? "cell" : "cells"}`;
      }
      renderGridCellSelectionEditor(layer, selection.cells);
      return;
    }
  }

  if (selection.kind === "marker-element") {
    const layer = map.layers.find((entry) => entry.id === selection.layerId);
    const markerElement = layer?.elements?.find((entry) => entry.id === selection.id);
    if (layer && markerElement) {
      elements.selectionTitle.textContent = markerElement.label || "Marker";
      setSelectionTypeIcon("tabler:map-pin");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = markerElement.refKind
          ? `${layer.name} · references ${markerElement.refKind}/${markerElement.refId || "(none picked)"}`
          : `${layer.name} · no reference set`;
      }
      void renderMarkerElementSelectionEditor(layer, markerElement);
      return;
    }
  }

  if (selection.kind === "marker-elements") {
    const resolved = resolveSelectedMarkerElements(selection);
    if (resolved.length) {
      elements.selectionTitle.textContent = `${resolved.length} Markers Selected`;
      setSelectionTypeIcon("tabler:map-pins");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = resolved
          .map((entry) => entry.markerElement.label || entry.markerElement.refKind || "Marker")
          .join(", ");
      }
      renderMarkerElementsSelectionEditor(resolved);
      return;
    }
  }

  if (selection.kind === "vector-path") {
    const layer = map.layers.find((entry) => entry.id === selection.layerId);
    const pathElement = layer?.elements?.find((entry) => entry.id === selection.id);
    if (layer && pathElement && pathElement.kind === "shape") {
      const selectedPreset = getPresetById(pathElement.presetId) || getPresetById("circle");
      // kind, not category — "effects" and "weather" are both animated
      // (kind: "particles") and share the same "Effect" title/icon; only a
      // static geometry preset (kind: "geometry", the "shapes" category) is
      // a plain "Shape".
      const isEffect = selectedPreset.kind === "particles";
      elements.selectionTitle.textContent = isEffect ? "Effect" : "Shape";
      setSelectionTypeIcon(isEffect ? "tabler:sparkles" : "tabler:target");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `${layer.name} · ${selectedPreset.label}`;
      }
      renderVectorShapeSelectionEditor(layer, pathElement);
      return;
    }
    if (layer && pathElement && pathElement.kind === "wall") {
      elements.selectionTitle.textContent = pathElement.wallType === "door" ? "Door" : "Wall";
      setSelectionTypeIcon(pathElement.wallType === "door" ? "tabler:door" : "tabler:wall");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `${layer.name} · ${pathElement.points?.length || 0} points`;
      }
      renderWallSelectionEditor(layer, pathElement);
      return;
    }
    if (layer && pathElement && pathElement.kind === "light") {
      elements.selectionTitle.textContent = "Light";
      setSelectionTypeIcon("tabler:bulb");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `${layer.name} · ${pathElement.rangeCells} cell range`;
      }
      renderLightSelectionEditor(layer, pathElement);
      return;
    }
    if (layer && pathElement) {
      elements.selectionTitle.textContent = "Drawn Path";
      setSelectionTypeIcon("tabler:pencil");
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `${layer.name} · ${pathElement.points?.length || 0} points`;
      }
      renderVectorPathSelectionEditor(layer, pathElement);
      return;
    }
  }

  elements.selectionTitle.textContent = "No selection";
  setSelectionTypeIcon(null);
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = "Select a layer, group, view, grid cell, or marker to inspect it.";
  }
  clearSelectionEditor();
}

// Turn-off-draw-mode-to-erase editor for one freehand path drawn on a
// vector layer — only reachable via clicking an existing path while both
// Draw and Shape mode are off (see setupDrawTool/setupShapeTool's shared
// onVectorPathClick gating), same "select a placed thing, then Delete"
// pattern as a marker element's own editor.
function renderVectorPathSelectionEditor(layer, pathElement) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  const hint = document.createElement("p");
  hint.className = "text-body-secondary small mb-0";
  hint.textContent = "Delete this stroke, or turn Draw mode back on to add more.";
  container.appendChild(hint);

  // Just one color — a freehand path has no meaningful fill (it's an open
  // line, not a closed shape), same "one primary color" model the toolbar's
  // own drawColor swatch and the Dashboard Map widget's drawing popover
  // both already use (no separate "outline" concept for a plain stroke).
  const colorField = createCompactField({
    type: "color",
    label: "Color",
    controlClass: "form-control form-control-color",
  });
  colorField.querySelector("input").value = pathElement.strokeColor || "#0f172a";
  colorField.querySelector("input").addEventListener("change", (event) => {
    recordHistory("path color", () => {
      pathElement.strokeColor = event.target.value;
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
  });
  container.appendChild(colorField);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-outline-danger btn-sm";
  deleteButton.textContent = "Delete Path";
  deleteButton.dataset.action = "delete-selected";
  deleteButton.addEventListener("click", () => deleteCurrentSelection());
  container.appendChild(deleteButton);
}

// No post-placement per-vertex editing (matches the plain-path editor's own
// delete-and-redraw precedent just above — a wall's `points` array has no
// single natural "position" field to expose the way a shape's one-point
// origin does). GM-only surface — the GM always has full control regardless
// of Secret/Locked, which only ever restrict the Dashboard widget's
// player-facing click-to-toggle (see map.js's own onDoorClick).
function renderWallSelectionEditor(layer, wallElement) {
  if (!elements.selectionEditor) {
    return;
  }
  // True while this panel is showing the Wall tool's own not-yet-placed
  // draft (renderArmedWallInspector) rather than a real, already-placed
  // wall — see renderVectorShapeSelectionEditor's own isDraftShape for the
  // identical reasoning, applied here to Wall instead of Shape.
  const isDraftWall = wallElement === draftWallElement;
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  function applyWallChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    if (isDraftWall) {
      renderArmedWallInspector();
    } else {
      renderSelection();
    }
    renderLayerOverlays();
    renderJson();
  }

  const wallHelp = document.createElement("span");
  wallHelp.className = "align-middle";
  wallHelp.dataset.helpTopic = "orrery.walls";
  wallHelp.dataset.helpInsert = "replace";
  container.appendChild(wallHelp);
  initHelpSystem({ root: container });

  const typeField = createFormFloatingField({ type: "select", label: "Type" });
  const typeSelect = typeField.querySelector("select");
  [
    { value: "wall", label: "Wall" },
    { value: "door", label: "Door" },
  ].forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    typeSelect.appendChild(option);
  });
  typeSelect.value = WALL_TYPES.includes(wallElement.wallType) ? wallElement.wallType : "wall";
  typeSelect.addEventListener("change", () => {
    // doorState/secret/locked are never cleared when switching away from
    // "door" — they just go inert, same "harmless defaults, never stripped"
    // convention createWallElement itself establishes. Switching back to
    // "door" later picks up wherever they were left.
    applyWallChange("wall type", () => {
      wallElement.wallType = typeSelect.value === "door" ? "door" : "wall";
    });
  });
  container.appendChild(typeField);

  const strokeColorField = createCompactField({
    type: "color",
    label: "Stroke color",
    controlClass: "form-control form-control-color",
  });
  strokeColorField.querySelector("input").value = wallElement.strokeColor || layer.settings?.strokeColor || "#0f172a";
  strokeColorField.querySelector("input").addEventListener("change", (event) => {
    applyWallChange("wall stroke color", () => {
      wallElement.strokeColor = event.target.value;
    });
  });

  const strokeWidthField = createCommitOnBlurNumberField(
    "Stroke width",
    wallElement.strokeWidth || 3,
    (value) => {
      if (value === null) return;
      applyWallChange("wall stroke width", () => {
        wallElement.strokeWidth = Math.max(0, value);
      });
    },
    { min: 0, step: 1 }
  );
  container.appendChild(createFieldRow([strokeColorField, strokeWidthField], { columns: 2 }));

  const snapField = createCheckField({
    id: `wall-snap-${wallElement.id}`,
    label: "Snap to Grid",
    switchStyle: true,
  });
  const snapInput = snapField.querySelector("input");
  snapInput.checked = wallElement.snapToGrid !== false;
  snapInput.addEventListener("change", () => {
    applyWallChange("wall snap to grid", () => {
      wallElement.snapToGrid = snapInput.checked;
      // Same "toggling on re-aligns immediately" behavior as a shape's own
      // Snap to Grid — a wall has no post-placement per-vertex drag, so this
      // is the only way to align an already-drawn off-grid wall afterward
      // without deleting and redrawing it.
      if (snapInput.checked) {
        wallElement.points = (wallElement.points || []).map((point) => snapShapeOriginToGrid(point, layer));
      }
    });
  });
  container.appendChild(snapField);

  if (wallElement.wallType === "door") {
    const secretField = createCheckField({ id: `wall-secret-${wallElement.id}`, label: "Secret", switchStyle: true });
    const secretInput = secretField.querySelector("input");
    secretInput.checked = Boolean(wallElement.secret);
    secretInput.addEventListener("change", () => {
      applyWallChange("door secret", () => {
        wallElement.secret = secretInput.checked;
      });
    });
    container.appendChild(secretField);

    const lockedField = createCheckField({ id: `wall-locked-${wallElement.id}`, label: "Locked", switchStyle: true });
    const lockedInput = lockedField.querySelector("input");
    lockedInput.checked = Boolean(wallElement.locked);
    lockedInput.addEventListener("change", () => {
      applyWallChange("door locked", () => {
        wallElement.locked = lockedInput.checked;
      });
    });
    container.appendChild(lockedField);

    const doorHelp = document.createElement("span");
    doorHelp.className = "align-middle";
    doorHelp.dataset.helpTopic = "orrery.doors";
    doorHelp.dataset.helpInsert = "replace";
    container.appendChild(doorHelp);
    initHelpSystem({ root: container });
  }

  // Suppressed entirely for a draft — see renderVectorShapeSelectionEditor's
  // own identical Delete-button guard for the full reasoning (nothing real
  // to delete/open/close yet, and state.selection doesn't point at the
  // draft either).
  if (elements.selectionToolbar && !isDraftWall) {
    const buttons = [];
    if (wallElement.wallType === "door") {
      buttons.push({
        action: wallElement.doorState === "open" ? "close-door" : "open-door",
        label: wallElement.doorState === "open" ? "Close Door" : "Open Door",
        icon: wallElement.doorState === "open" ? "tabler:door-off" : "tabler:door",
        onClick: () => {
          applyWallChange("toggle door", () => {
            wallElement.doorState = wallElement.doorState === "open" ? "closed" : "open";
          });
        },
      });
    }
    buttons.push({
      action: "delete",
      label: wallElement.wallType === "door" ? "Delete Door" : "Delete Wall",
      attrs: { "data-action": "delete-selected" },
      onClick: () => deleteCurrentSelection(),
    });
    createToolbarButtonGroup(buttons).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
}

function renderLightSelectionEditor(layer, lightElement) {
  if (!elements.selectionEditor) {
    return;
  }
  // True while this panel is showing the Light tool's own not-yet-placed
  // draft (renderArmedLightInspector) rather than a real, already-placed
  // light — see renderVectorShapeSelectionEditor's own isDraftShape for the
  // identical reasoning, applied here to Light instead of Shape.
  const isDraftLight = lightElement === draftLightElement;
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  function applyLightChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
  }

  const lightHelp = document.createElement("span");
  lightHelp.className = "align-middle";
  lightHelp.dataset.helpTopic = "orrery.lights";
  lightHelp.dataset.helpInsert = "replace";
  container.appendChild(lightHelp);
  initHelpSystem({ root: container });

  // Attach to Token — a light attached to a marker tracks that marker's
  // live position every render instead of its own stored origin (see
  // map-viewer.js's own resolveLightOrigin), moving with it as it's dragged
  // — a torch a character carries. Lists every marker across every marker
  // layer on the map, not just this one layer's own (a light and its
  // carrier don't have to share a layer).
  const attachField = createFormFloatingField({ type: "select", label: "Attach to Token" });
  const attachSelect = attachField.querySelector("select");
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None (freestanding)";
  attachSelect.appendChild(noneOption);
  (state.map.layers || []).forEach((markerLayer) => {
    if (markerLayer.type !== "marker") return;
    (markerLayer.elements || []).forEach((marker) => {
      if (marker.kind !== "marker") return;
      const option = document.createElement("option");
      option.value = marker.id;
      option.textContent = marker.label || marker.refKind || "Marker";
      attachSelect.appendChild(option);
    });
  });
  attachSelect.value = lightElement.attachedMarkerId || "";
  attachSelect.addEventListener("change", () => {
    applyLightChange("light attach to token", () => {
      lightElement.attachedMarkerId = attachSelect.value;
    });
  });
  container.appendChild(attachField);

  // Position X/Y — shown only while freestanding; while attached, position
  // is derived from the host marker, not directly authored (mirrors how a
  // live-Bound Workbench field's value display becomes read-only/derived
  // rather than independently editable).
  if (!lightElement.attachedMarkerId) {
    const originPixel = markerPositionToLocalPixel(baseMapManager, state.map, lightElement.origin);
    const positionRow = createFieldRow(
      [
        createCommitOnBlurNumberField("Position X", Math.round(originPixel.x), (value) => {
          if (value === null) return;
          applyLightChange("light position", () => {
            const next = markerPositionToLocalPixel(baseMapManager, state.map, lightElement.origin);
            lightElement.origin = localPixelToMarkerPosition(baseMapManager, state.map, { x: value, y: next.y });
          });
        }),
        createCommitOnBlurNumberField("Position Y", Math.round(originPixel.y), (value) => {
          if (value === null) return;
          applyLightChange("light position", () => {
            const next = markerPositionToLocalPixel(baseMapManager, state.map, lightElement.origin);
            lightElement.origin = localPixelToMarkerPosition(baseMapManager, state.map, { x: next.x, y: value });
          });
        }),
      ],
      { columns: 2 }
    );
    container.appendChild(positionRow);
  }

  // Map units (cells), not the map's own real-world Scale unit — same
  // "(cells)" vocabulary and decimal-friendly, step-1 shape Shape's own
  // Size/Width fields use now (renderVectorShapeSelectionEditor's own
  // header comment has the full reasoning).
  const rangeField = createCommitOnBlurNumberField(
    "Range (cells)",
    lightElement.rangeCells || 0,
    (value) => {
      if (value === null) return;
      applyLightChange("light range", () => {
        lightElement.rangeCells = Math.max(0, value);
      });
    },
    { min: 0, step: 1, dataAttr: "data-light-range-input" }
  );
  container.appendChild(createFieldRow([rangeField], { columns: 2 }));

  const colorField = createCompactField({
    type: "color",
    label: "Color",
    controlClass: "form-control form-control-color",
  });
  colorField.querySelector("input").value = lightElement.color || "#fbbf24";
  colorField.querySelector("input").addEventListener("change", (event) => {
    applyLightChange("light color", () => {
      lightElement.color = event.target.value;
    });
  });

  const opacityField = createCompactField({ type: "range", label: "Opacity", controlClass: "form-range", min: 0, max: 1, step: 0.05 });
  const opacityInput = opacityField.querySelector("input");
  opacityInput.value = Number.isFinite(lightElement.opacity) ? lightElement.opacity : 0.5;
  opacityInput.addEventListener("change", () => {
    const value = Number(opacityInput.value);
    if (!Number.isFinite(value)) return;
    applyLightChange("light opacity", () => {
      lightElement.opacity = value;
    });
  });
  container.appendChild(createFieldRow([colorField, opacityField], { columns: 2 }));

  if (elements.selectionToolbar && !isDraftLight) {
    // Nothing real to delete yet while drafting — state.selection doesn't
    // point at the draft (see renderVectorShapeSelectionEditor's own
    // identical Delete-button guard for the full reasoning).
    createToolbarButtonGroup([
      {
        action: "delete",
        label: "Delete light",
        attrs: { "data-action": "delete-selected" },
        onClick: () => deleteCurrentSelection(),
      },
    ]).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
}

// Same "select a placed thing, then Delete" pattern as a drawn path's own
// editor just above, plus numeric fields (createHalfWidthNumberField,
// same factory every other inspector field in this file uses) to dial in
// the shape's size/direction precisely after the drag-to-place gesture —
// click-drag (setupShapeTool) gets it roughly right with live feedback,
// these fields nudge it exactly. Size/Width are edited directly in map
// units (cells, same "(cells)" vocabulary Marker's own Size/Height fields
// already use) rather than converted through the map's own Scale per
// cell/Scale unit — that conversion is what PRESENTS a cell count as "10
// ft" elsewhere (the drag-to-place readout, Position's own real-world
// context), not what this field is edited in. `step: 1` moves the native
// up/down spinner by a whole cell at a time (what's most common to want),
// but typed/committed values are never rounded — a shape placed via drag
// can easily land on a fractional cell count, and forcing it to the
// nearest whole cell here would silently change the shape out from under
// a GM who only meant to blur the field.
function renderVectorShapeSelectionEditor(layer, shapeElement) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  // True while this call is rendering the Shape tool's own in-progress
  // DRAFT (draftShapeElement's own header comment) rather than an already-
  // placed, real selection — suppresses the Delete button (there's nothing
  // real to delete yet) and redirects the couple of field handlers below
  // that would otherwise call the general renderSelection() to
  // renderArmedShapeInspector() instead, so they keep showing the draft
  // instead of whatever state.selection happens to point to underneath it
  // (typically the layer, from ensureDrawableVectorLayer).
  const isDraftShape = shapeElement === draftShapeElement;

  const selectedPreset = getPresetById(shapeElement.presetId) || getPresetById("circle");
  // Presets whose geometry uses a facing direction/spread beyond plain
  // size — Angle: cone/line (existing geometry) plus beam/cone-blast (the
  // new particle presets that are also directional); Spread: cone plus
  // cone-blast. Width: line only, no particle preset uses widthCells.
  // Hardcoded lists, not a new registry field — mirrors this panel's own
  // pre-existing style (it already hardcoded shapeType checks the same way
  // before presets existed at all).
  const usesAngle = ["cone", "line", "beam", "cone-blast"].includes(selectedPreset.id);
  const usesSpread = ["cone", "cone-blast"].includes(selectedPreset.id);
  const usesWidth = selectedPreset.id === "line";

  // No renderSelection() — same reasoning as Layer's own
  // applyLayerPositionChange (see createCommitOnBlurNumberField's comment):
  // presetId (the only thing that decides which of these fields even show)
  // never changes from editing Size/Angle/Spread/Width, so there's nothing
  // in this panel that needs rebuilding in response, and doing it anyway
  // only risked destroying the very input being edited. (Changing the
  // preset ITSELF, via the new "Change Shape/Effect" button below, DOES
  // need a full rebuild — that button explicitly calls renderSelection()
  // itself after committing, rather than trying to patch this panel in
  // place.)
  function applyShapeChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
  }

  // Opens the picker modal (Part 3) on this exact element — the only way to
  // change WHICH shape/effect a placed element is; the toolbar's own
  // pre-placement type select only ever affects new placements. Same
  // input+button shape as Press/Workbench's own Image component field
  // (press/index.html's `data-inspector-image-field`) — a readonly text
  // input showing the current pick, plus a button that opens the modal,
  // rather than a standalone button with no indication of what's selected.
  const presetGroup = document.createElement("div");
  presetGroup.className = "input-group";
  const presetField = createFormFloatingField({ label: "Shape/Effect", readonly: true });
  const presetInput = presetField.querySelector("input");
  presetInput.value = selectedPreset.label;
  presetGroup.appendChild(presetField);
  const changePresetButton = createIconButton({
    icon: "tabler:replace",
    variant: "outline-secondary",
    label: "Choose a different shape or effect, and edit its colors",
    onClick: () => openShapeEffectModal(layer, shapeElement),
  });
  presetGroup.appendChild(changePresetButton);
  container.appendChild(presetGroup);

  // Attach to Token — same exact capability/wiring Lights already have
  // (renderLightSelectionEditor's own identical block just above in this
  // file, map-viewer.js's resolveElementOrigin) — an attached shape/effect
  // tracks that marker's live position every render instead of its own
  // stored origin, moving with it as it's dragged. Lists every marker
  // across every marker layer on the map, not just this one layer's own.
  const attachField = createFormFloatingField({ type: "select", label: "Attach to Token" });
  const attachSelect = attachField.querySelector("select");
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None (freestanding)";
  attachSelect.appendChild(noneOption);
  (state.map.layers || []).forEach((markerLayer) => {
    if (markerLayer.type !== "marker") return;
    (markerLayer.elements || []).forEach((marker) => {
      if (marker.kind !== "marker") return;
      const option = document.createElement("option");
      option.value = marker.id;
      option.textContent = marker.label || marker.refKind || "Marker";
      attachSelect.appendChild(option);
    });
  });
  attachSelect.value = shapeElement.attachedMarkerId || "";
  attachSelect.addEventListener("change", () => {
    applyShapeChange("shape attach to token", () => {
      shapeElement.attachedMarkerId = attachSelect.value;
    });
    // Position (shown/hidden based on attachment) needs a full rebuild,
    // same "changing what this panel even shows" reasoning the preset
    // modal's own Apply handler already follows. isDraftShape's own comment
    // has the full reasoning for why this isn't always renderSelection().
    if (isDraftShape) {
      renderArmedShapeInspector();
    } else {
      renderSelection();
    }
  });
  container.appendChild(attachField);

  // Label — every shape/effect can carry one now (previously particles
  // only), letting a GM name ANY placed element ("North Trap Zone," not
  // just "Boss Burst") for its own sake, not just for the particle-only
  // re-trigger lookup (findEffectElementByLabel, map.js) that originally
  // motivated it. Sits right below Attach to Token — identifying/organizing
  // fields, ahead of the geometry/color fields below.
  const labelField = createFormFloatingField({ label: "Label (optional)" });
  const labelInput = labelField.querySelector("input");
  labelInput.value = shapeElement.label || "";
  labelInput.addEventListener("change", () => {
    applyShapeChange("shape label", () => {
      shapeElement.label = labelInput.value.trim();
    });
  });
  container.appendChild(labelField);

  // Position X/Y — shown only while freestanding; while attached, position
  // is derived from the host marker, not directly authored, same as
  // Light's own identical gate just above in this file. Edits the same
  // content-space pixel coordinate Layer Position X/Y already exposes
  // (markerPositionToLocalPixel/localPixelToMarkerPosition — the exact
  // conversion drag-to-place and drag-to-move already round-trip through),
  // not shapeElement.origin's raw stored shape directly — origin is {x,y}
  // for image/canvas maps but {lat,lng} for tile ones, and this keeps the
  // field meaning "pixels from the map's own center" either way, same as
  // every other on-map position in this panel.
  if (!shapeElement.attachedMarkerId) {
    const originPixel = markerPositionToLocalPixel(baseMapManager, state.map, shapeElement.origin);
    const positionRow = createFieldRow(
      [
        createCommitOnBlurNumberField("Position X", Math.round(originPixel.x), (value) => {
          if (value === null) return;
          applyShapeChange("shape position", () => {
            const next = markerPositionToLocalPixel(baseMapManager, state.map, shapeElement.origin);
            shapeElement.origin = localPixelToMarkerPosition(baseMapManager, state.map, { x: value, y: next.y });
          });
        }),
        createCommitOnBlurNumberField("Position Y", Math.round(originPixel.y), (value) => {
          if (value === null) return;
          applyShapeChange("shape position", () => {
            const next = markerPositionToLocalPixel(baseMapManager, state.map, shapeElement.origin);
            shapeElement.origin = localPixelToMarkerPosition(baseMapManager, state.map, { x: next.x, y: value });
          });
        }),
      ],
      { columns: 2 }
    );
    container.appendChild(positionRow);
  }

  // dataAttr on Size/Angle only — the two fields the Shape tool's own
  // drag gesture updates LIVE (setupShapeTool's own onMove), by writing
  // straight into these inputs' own .value via this same attribute rather
  // than rebuilding the whole panel on every pointermove tick. Harmless,
  // unused attribute on an already-placed shape's own identical fields.
  const fields = [
    createCommitOnBlurNumberField(
      selectedPreset.id === "square" ? "Side (cells)" : "Size (cells)",
      shapeElement.sizeCells || 0,
      (value) => {
        if (value === null) return;
        applyShapeChange("shape size", () => {
          shapeElement.sizeCells = Math.max(0, value);
        });
      },
      { min: 0, step: 1, dataAttr: "data-shape-size-input" }
    ),
  ];

  if (usesAngle) {
    fields.push(
      createCommitOnBlurNumberField(
        "Angle (degrees)",
        Math.round(shapeElement.angleDeg || 0),
        (value) => {
          if (value === null) return;
          applyShapeChange("shape angle", () => {
            shapeElement.angleDeg = value;
          });
        },
        { dataAttr: "data-shape-angle-input" }
      )
    );
  }
  if (usesSpread) {
    fields.push(
      createCommitOnBlurNumberField("Spread (degrees)", Math.round(shapeElement.spreadDeg ?? 53), (value) => {
        if (value === null) return;
        applyShapeChange("shape spread", () => {
          shapeElement.spreadDeg = value;
        });
      }, { min: 1, max: 360 })
    );
  }
  if (usesWidth) {
    fields.push(
      createCommitOnBlurNumberField(
        "Width (cells)",
        shapeElement.widthCells || 0,
        (value) => {
          if (value === null) return;
          applyShapeChange("shape width", () => {
            shapeElement.widthCells = Math.max(0, value);
          });
        },
        { min: 0, step: 1 }
      )
    );
  }

  // Outline width — a geometry-only concept (a particle preset draws its
  // own internal styling, not a generic stroke around a shape) — joins the
  // SAME `fields` pool as Size/Angle/Spread/Width rather than getting its
  // own separate single-field row: a lone half-width field left by itself
  // (an odd-length `fields` array — Circle/Square's own Size-alone case
  // most visibly) broke to a new line with an awkward empty gap next to it.
  // Every geometry preset's own field count (Size, +Angle/Spread/Width as
  // usesAngle/usesSpread/usesWidth apply) is odd on its own but becomes
  // EVEN once Outline width joins it — Circle/Square: 1+1=2, Cone: 3+1=4,
  // Line: 3+1=4 — so chunking the whole pool by twos below always pairs
  // cleanly for every existing geometry preset.
  if (selectedPreset.kind === "geometry") {
    fields.push(
      createCommitOnBlurNumberField(
        "Outline width",
        shapeElement.strokeWidth || 2,
        (value) => {
          if (value === null) return;
          applyShapeChange("shape outline width", () => {
            shapeElement.strokeWidth = Math.max(0, value);
          });
        },
        { min: 0, step: 1 }
      )
    );
  }
  while (fields.length) {
    container.appendChild(createFieldRow(fields.splice(0, 2), { columns: 2 }));
  }

  // Fill/Outline/Opacity moved into the Shape/Effect picker modal (Part 3)
  // alongside the rest of a preset's own colorSlots/params — editing them
  // here too would just be the same three values duplicated in two places.
  // The "Change Shape/Effect" input+button above is the one place a preset's
  // colors/opacity are set now, whether or not the preset itself is also
  // being changed.

  const snapField = createCheckField({
    id: `shape-snap-${shapeElement.id}`,
    label: "Snap to Grid",
    switchStyle: true,
  });
  const snapInput = snapField.querySelector("input");
  snapInput.checked = shapeElement.snapToGrid !== false;
  snapInput.addEventListener("change", () => {
    applyShapeChange("shape snap to grid", () => {
      shapeElement.snapToGrid = snapInput.checked;
      // Snapping ON right now (not just future drags) re-aligns the shape
      // to the grid immediately, the same instant-feedback expectation
      // toggling a setting usually carries — otherwise the toggle would
      // read "on" while the shape visibly sat off-grid until next moved.
      if (snapInput.checked) {
        shapeElement.origin = snapShapeOriginToGrid(shapeElement.origin, layer);
      }
    });
  });
  container.appendChild(snapField);

  // Loop/Play — only meaningful for a particle preset (Effect); a plain
  // geometry Shape has neither concept. Loop decides whether it just plays
  // continuously (true, the "campfire" case, nothing to trigger) or holds
  // at rest after each cycle until explicitly replayed (false, the "spell
  // blast" case) — Label (now shared by every shape/effect, set right below
  // Attach to Token above) is what a re-trigger looks a resting Effect up
  // by, on top of just being generally useful for naming any placed thing.
  if (selectedPreset.kind === "particles") {
    const loopField = createCheckField({
      id: `shape-loop-${shapeElement.id}`,
      label: "Loop continuously",
      switchStyle: true,
    });
    const loopInput = loopField.querySelector("input");
    loopInput.checked = shapeElement.loop !== false;
    loopInput.addEventListener("change", () => {
      applyShapeChange("effect loop", () => {
        shapeElement.loop = loopInput.checked;
      });
      // Loop on/off changes whether the Play button below even applies —
      // same full-rebuild reasoning every other panel-shape-changing
      // control here already follows.
      if (isDraftShape) {
        renderArmedShapeInspector();
      } else {
        renderSelection();
      }
    });
    container.appendChild(loopField);

    if (!shapeElement.loop) {
      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.className = "btn btn-outline-primary btn-sm align-self-start";
      playButton.textContent = "Play";
      playButton.addEventListener("click", () => triggerShapeEffectElement(layer, shapeElement));
      container.appendChild(playButton);
    }
  }

  // Same shared icon-toolbar factory/mount point Layer selection uses
  // (renderLayerSelectionEditor) instead of a standalone inline button —
  // renderSelection() already clears data-selection-toolbar-mount before
  // every render, so only whichever selection kind is current populates it.
  // Suppressed entirely for a draft (isDraftShape) — there's nothing real
  // to delete yet, and state.selection doesn't even point at this element
  // (deleteCurrentSelection would act on whatever it DOES point to instead,
  // typically the layer — a real, confirmed-by-inspection footgun this
  // avoids outright rather than hoping nobody clicks it).
  if (elements.selectionToolbar && !isDraftShape) {
    createToolbarButtonGroup([
      {
        action: "delete",
        label: "Delete shape",
        attrs: { "data-action": "delete-selected" },
        onClick: () => deleteCurrentSelection(),
      },
    ]).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
  // Activates the "Change Shape/Effect" button's own data-bs-title tooltip
  // (createIconButton's `label` sets the attribute, but nothing initializes
  // a live Bootstrap Tooltip off it until this runs) — was previously only
  // called for the toolbar above, never for this panel's own content.
  refreshTooltips(container);
}

function clearSelectionEditor() {
  if (elements.selectionEditor) {
    disposeTooltips(elements.selectionEditor);
    elements.selectionEditor.innerHTML = "";
    const placeholder = document.createElement("p");
    placeholder.className = "text-body-secondary small mb-0";
    placeholder.textContent = "Select a layer, view, group, grid cell, or marker to edit its properties.";
    elements.selectionEditor.appendChild(placeholder);
  }
}

function syncOverlayInteractivity() {
  const overlay = baseMapManager.getOverlayContainer();
  if (!overlay) {
    return;
  }
  const selectedLayerId =
    state.selection.kind === "layer"
      ? state.selection.id
      : state.selection.kind === "grid-cells" || state.selection.kind === "marker-element"
        ? state.selection.layerId
        : null;
  const layer = selectedLayerId ? state.map.layers.find((entry) => entry.id === selectedLayerId) : null;
  // A "marker-elements" (plural) multi-selection has no single layerId of
  // its own the way selectedLayerId above expects — it can span several
  // layers at once — but every one of its entries is necessarily a
  // marker, so its mere existence already tells us the overlay needs to
  // stay interactive, same conclusion the single-marker branch above
  // reaches via `layer.type === "marker"`. Without this, forming a
  // multi-selection on a TILE base map (this whole pointer-events gate is
  // Leaflet-pane-only, per the comment below) set the overlay pane
  // non-interactive, silently swallowing every further click — including
  // the very Ctrl-click meant to extend/shrink that same selection.
  // Confirmed real bug this avoids, caught alongside isLayerSelected's/
  // renderLayers' own matching fixes.
  const hasMultiMarkerSelection = state.selection.kind === "marker-elements" && (state.selection.elements || []).length > 0;
  // A selected Group also arms its own target grid layer's interactivity
  // without the grid layer itself ever being the current `selection` — this
  // pointer-events gate (tile maps only, via the Leaflet pane below) has to
  // know about that too, or clicking/painting a group's cells would never
  // even reach the grid's own pointerdown listener on a tile base map.
  const isInteractive =
    Boolean(layer && (layer.type === "grid" || layer.type === "marker")) || state.selection.kind === "group" || hasMultiMarkerSelection;
  overlay.classList.toggle("is-interactive", isInteractive);
  if (overlay.parentElement && overlay.parentElement.classList.contains("leaflet-pane")) {
    overlay.parentElement.style.pointerEvents = isInteractive ? "auto" : "none";
  }
}

// getGridLayoutScale/getGridBackgroundPosition delegate to lib/map-viewer.js
// now (same coordinate math the shared createGridLayerElement uses
// internally) — kept here only because bindLayerDrag's whole-layer drag
// (Orrery-authoring-only) still needs them directly. getGridType/
// getGridCellKey/createGridCellSelectionEntry/findGridCellById/
// normalizeGroupMembers are imported straight from the shared module below
// (identical signatures, no wrapper needed) since findGridCell/
// ensureGridCell/buildGridRangeSelection/formatGridCellLabel/
// summarizeGridSelection and the group-editing UI still call them directly.
function getGridLayoutScale() {
  return sharedGetGridLayoutScale(baseMapManager, state.map);
}

function getGridBackgroundPosition(layer) {
  return sharedGetGridBackgroundPosition(baseMapManager, state.map, layer);
}

function getGroupMemberKey(member) {
  return `${member.layerId || "unknown"}:${member.elementId || "unknown"}`;
}

function buildGridRangeSelection(layer, start, end) {
  const selections = [];
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    const minQ = Math.min(start.q, end.q);
    const maxQ = Math.max(start.q, end.q);
    const minR = Math.min(start.r, end.r);
    const maxR = Math.max(start.r, end.r);
    for (let q = minQ; q <= maxQ; q += 1) {
      for (let r = minR; r <= maxR; r += 1) {
        selections.push(createGridCellSelectionEntry(layer, { q, r }));
      }
    }
    return selections;
  }
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  for (let col = minCol; col <= maxCol; col += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      selections.push(createGridCellSelectionEntry(layer, { col, row }));
    }
  }
  return selections;
}

function findGridCell(layer, coord) {
  const key = getGridCellKey(layer, coord);
  return layer.elements?.find((element) => element.kind === "cell" && element.key === key) || null;
}

function ensureGridCell(layer, coord) {
  const key = getGridCellKey(layer, coord);
  let cell = findGridCell(layer, coord);
  if (!cell) {
    cell = createGridCell({
      key,
      coord,
      gridType: getGridType(layer),
    });
    layer.elements = layer.elements || [];
    layer.elements.push(cell);
  }
  return cell;
}

function formatGridCellLabel(layer, coord) {
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    return `Q${coord.q}, R${coord.r}`;
  }
  return `Col ${coord.col}, Row ${coord.row}`;
}

function summarizeGridSelection(layer, selectedCells) {
  if (!selectedCells.length) {
    return "";
  }
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    const qs = selectedCells.map((cell) => cell.coord.q);
    const rs = selectedCells.map((cell) => cell.coord.r);
    const minQ = Math.min(...qs);
    const maxQ = Math.max(...qs);
    const minR = Math.min(...rs);
    const maxR = Math.max(...rs);
    return `Q${minQ}, R${minR} → Q${maxQ}, R${maxR} · ${selectedCells.length} cells`;
  }
  const cols = selectedCells.map((cell) => cell.coord.col);
  const rows = selectedCells.map((cell) => cell.coord.row);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  return `Col ${minCol}, Row ${minRow} → Col ${maxCol}, Row ${maxRow} · ${selectedCells.length} cells`;
}

// createGridLayerElement/buildHexGridBackground/createRasterLayerElement/
// createGridSelectionOverlay now live only in lib/map-viewer.js — the shared
// renderMapLayers orchestrator calls them internally, so nothing here needs
// to call them directly anymore. getLayerPositionScale/getLayerSizeScale/
// getLayerRenderPosition ARE still called directly, though — by
// updateTileLayerElementPosition below (whole-layer drag,
// Orrery-authoring-only) — imported from the same module (see the import
// block at the top of this file), identical signatures, no wrapper needed.
function updateTileLayerElementPosition(layer, element) {
  if (!element || state.map.baseMap.type !== "tile") {
    return;
  }
  const positionScale = getLayerPositionScale();
  const sizeScale = getLayerSizeScale();
  const position = getLayerRenderPosition(layer, positionScale);
  if (element.classList.contains("orrery-layer-marker-overlay")) {
    const size = (layer.settings?.size || 24) * sizeScale;
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    return;
  }
  if (element.classList.contains("orrery-layer-vector-overlay")) {
    const baseSize = 200;
    const scaledSize = Math.max(1, Math.round(baseSize * sizeScale));
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.style.width = `${scaledSize}px`;
    element.style.height = `${scaledSize}px`;
    return;
  }
  if (element.classList.contains("orrery-layer-raster-overlay")) {
    const image = element.querySelector("img");
    if (image) {
      if (layer.settings?.width) {
        image.width = Math.max(1, Math.round(layer.settings.width * sizeScale));
      }
      if (layer.settings?.height) {
        image.height = Math.max(1, Math.round(layer.settings.height * sizeScale));
      }
      image.style.left = `${position.x}px`;
      image.style.top = `${position.y}px`;
    }
  }
}

// isTileBaseMap/getMarkerLayerOffset/localPixelToMarkerPosition/
// createMarkerDot/createMarkerLayerElement/createVectorLayerElement/
// createLayerWrapper now live only in lib/map-viewer.js — the entire render
// loop (renderLayerOverlays below) delegates to the shared renderMapLayers
// orchestrator, which calls all of these internally, so nothing here needs
// to call them directly anymore. selectMarkerElementForDrag stays: it's
// passed to renderMapLayers as the onMarkerDragStart callback (Orrery-only —
// updates state.selection and the property inspector, which the shared
// module has no concept of).
//
// A lightweight selection update for the moment a marker drag begins: updates
// state.selection and the inspector panel, but deliberately skips
// renderLayerOverlays() — that would tear down and replace the very dot
// element (dotEl) the drag is about to setPointerCapture on and drive via
// onMove/onUp, silently ending the gesture the instant the DOM node it
// targets gets swapped out.
function selectMarkerElementForDrag(layer, markerElement, dotEl) {
  // Bypasses setSelection (see this function's own header comment on why),
  // so it needs its own copy of setSelection's armedMarkerLayerId logic:
  // stays armed only if this marker's layer was ALREADY the armed one
  // (clicking/dragging a marker mid-placement-session); a fresh fallback
  // click on a marker whose layer was never explicitly selected does not
  // arm it. See armedMarkerLayerId's own comment for the full reasoning.
  if (armedMarkerLayerId !== layer.id) {
    armedMarkerLayerId = null;
  }
  blurStaleActiveField();
  state.selection = { kind: "marker-element", id: markerElement.id, layerId: layer.id, cells: [], elements: [], anchor: null };
  renderSelection();
  setPanelFocus(true);
  const container = dotEl.parentElement;
  if (container) {
    container
      .querySelectorAll(".orrery-layer-marker-overlay.is-selected")
      .forEach((node) => node.classList.remove("is-selected"));
  }
  dotEl.classList.add("is-selected");
}

// Ctrl/Cmd/Shift-click on a marker (map canvas dot, or the left-pane
// component list — see renderLayers' own click handler and
// createMarkerDot's pointerdown branch in map-viewer.js) — extends the
// current selection into (or shrinks/collapses out of) a multi-marker
// selection, rather than replacing it the way a plain click does. Uses
// the ordinary setSelection (not selectMarkerElementForDrag's own
// bypass) since this never begins a drag, so there's no live dotEl to
// preserve across a renderLayerOverlays() rebuild.
function toggleMarkerMultiSelect(layer, markerElement) {
  const current = state.selection;
  let entries;
  if (current.kind === "marker-elements") {
    entries = current.elements.slice();
  } else if (current.kind === "marker-element") {
    entries = [{ layerId: current.layerId, id: current.id }];
  } else {
    entries = [];
  }
  const index = entries.findIndex((entry) => entry.id === markerElement.id);
  if (index === -1) {
    entries.push({ layerId: layer.id, id: markerElement.id });
  } else {
    entries.splice(index, 1);
  }
  if (entries.length === 0) {
    setSelection(null);
  } else if (entries.length === 1) {
    // Collapses back to the ordinary single-marker editor the moment
    // only one marker remains — the ONLY entry point into the full
    // label/image/position/contents panel, so shrinking a multi-select
    // down to one shouldn't strand the GM on the bulk-only panel.
    setSelection("marker-element", entries[0].id, { layerId: entries[0].layerId });
  } else {
    setSelection("marker-elements", null, { elements: entries });
  }
}

// Same reasoning as selectMarkerElementForDrag just above — updates
// state.selection and the inspector panel only, deliberately skipping
// renderLayerOverlays(): that would tear down and replace the very
// hit-target/visible SVG nodes a shape drag is about to setPointerCapture
// on and drive via onMove/onUp (map-viewer.js's own renderShapeElement),
// ending the gesture before it even starts. Confirmed as a real bug before
// this split existed: routing a shape's pointerdown through the plain
// setSelection("vector-path", ...) every OTHER vector-path click uses (see
// onVectorPathClick below) rebuilt the overlay on every click, which is
// exactly why shapes could be selected but never actually dragged.
function selectShapeElementForDrag(layer, elementId) {
  blurStaleActiveField();
  state.selection = { kind: "vector-path", id: elementId, layerId: layer.id, cells: [], elements: [], anchor: null };
  renderSelection();
  setPanelFocus(true);
}

let activeLayerDrag = null;

function bindLayerDrag(target, layer, element) {
  if (!target || !layer) {
    return;
  }
  target.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Best-effort — see map-viewer.js's renderShapeElement/beginMarkerDrag
    // for why (some browsers throw InvalidStateError capturing in certain
    // DOM positions); the window-level pointermove/pointerup listeners
    // below track the gesture regardless.
    try {
      target.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignored — see comment above.
    }
    activeLayerDrag = {
      id: layer.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: layer.position?.x || 0,
      originY: layer.position?.y || 0,
      target,
      element,
      before: JSON.stringify(state.map),
    };
    target.classList.add("is-dragging");
    baseMapManager.setInteractionEnabled(false);
  });

  target.addEventListener("pointermove", (event) => {
    if (!activeLayerDrag || activeLayerDrag.id !== layer.id) {
      return;
    }
    const deltaX = event.clientX - activeLayerDrag.startX;
    const deltaY = event.clientY - activeLayerDrag.startY;
    const scale =
      state.map.baseMap.type === "tile"
        ? layer.type === "grid"
          ? getGridLayoutScale()
          : getLayerPositionScale()
        : 1;
    const adjustedDeltaX = scale ? deltaX / scale : deltaX;
    const adjustedDeltaY = scale ? deltaY / scale : deltaY;
    layer.position = {
      x: activeLayerDrag.originX + adjustedDeltaX,
      y: activeLayerDrag.originY + adjustedDeltaY,
    };
    if (activeLayerDrag.target) {
      // Grid folds position into its own backgroundPosition below instead —
      // translating the wrapper too would apply the same offset twice (see
      // createLayerWrapper's own matching exclusion, map-viewer.js).
      if (state.map.baseMap.type !== "tile" && layer.type !== "grid") {
        activeLayerDrag.target.style.transform = `translate(${layer.position.x}px, ${layer.position.y}px)`;
      }
    }
    if (activeLayerDrag.element?.classList.contains("orrery-layer-grid-overlay")) {
      const offset = getGridBackgroundPosition(layer);
      activeLayerDrag.element.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
    } else {
      updateTileLayerElementPosition(layer, activeLayerDrag.element);
    }
  });

  const stopDrag = (event) => {
    if (!activeLayerDrag || activeLayerDrag.id !== layer.id) {
      return;
    }
    try {
      target.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignored — capture above may never have actually been acquired.
    }
    target.classList.remove("is-dragging");
    updateMapTimestamp(state.map);
    const after = JSON.stringify(state.map);
    if (activeLayerDrag.before && activeLayerDrag.before !== after) {
      undoStack.push({ label: "move layer", before: activeLayerDrag.before, after });
    }
    renderLayerOverlays();
    renderSelection();
    renderJson();
    activeLayerDrag = null;
    baseMapManager.setInteractionEnabled(true);
  };

  target.addEventListener("pointerup", stopDrag);
  target.addEventListener("pointercancel", stopDrag);
}

// The whole render loop lives in lib/map-viewer.js's renderMapLayers now —
// shared with the Dashboard's Map widget, so every layer type (grid, raster,
// vector, marker) renders identically in both places. Everything below is
// just Orrery's own authoring behavior, supplied as callbacks: grid-cell
// click-selection (ctrl/shift range semantics), "click empty space to place
// a new marker," per-marker drag→undo-stack recording, and the whole-layer
// drag handle. None of these run at all when a caller (the widget) doesn't
// pass them.
// Resolves which grid layer a selected Group's cells get painted onto —
// its own Fog of War-linked layer if it has one (the common case this
// exists for), else the GM's own last explicit "Paint on layer" pick if
// that layer still exists, else the map's first grid layer.
function resolvePaintTargetLayer(group) {
  if (!group) {
    return null;
  }
  const gridLayers = state.map.layers.filter((entry) => entry.type === "grid");
  const fogLinked = gridLayers.find((entry) => entry.settings?.revealGroupId === group.id);
  if (fogLinked) {
    return fogLinked;
  }
  const remembered = paintTargetLayerId ? gridLayers.find((entry) => entry.id === paintTargetLayerId) : null;
  return remembered || gridLayers[0] || null;
}

// Fires the character-payload (and System-fields/conditions) fetch for
// EVERY character-linked marker, not just whichever one's own inspector
// panel happens to be open right now — without this, a GM who never
// happens to click a given marker's own inspector would silently never see
// that marker's Auto-Reveal Vision Range OR its condition-icon badges
// (resolveMarkerConditionIconsForMarker) resolve past their empty/literal
// fallback. No longer gated on Vision Range being configured — condition
// icons need the same two fetches for every character-linked marker
// regardless. Fire-and-forget, cheap after the first pass
// (ensureCharacterPayloadCached/ensureCharacterSystemFieldsCached are both
// no-ops once cached/in-flight/already-resolved).
function primeCharacterPayloadCache() {
  (state.map.layers || []).forEach((layer) => {
    if (layer.type !== "marker") return;
    (layer.elements || []).forEach((marker) => {
      if (marker.kind !== "marker" || marker.refKind !== "character" || !marker.refId) return;
      ensureCharacterPayloadCached(marker.refId, () => renderLayerOverlays());
      ensureCharacterSystemFieldsCached(marker.refId, getCachedCharacterPayload(marker.refId), () => renderLayerOverlays());
    });
  });
}

// Same "prime for every marker, not just the selected one" reasoning as
// primeCharacterPayloadCache above, for Monster/NPC-linked markers'
// condition icons (resolveMarkerConditionIconsForMarker) — fires the active
// Encounter fetch (once per campaign group, not per marker) and, once that
// resolves, its own System's conditions fetch. A no-op with nothing to do
// when there's no active campaign group, or no Monster/NPC-linked marker on
// the map at all.
function primeMonsterConditionCache() {
  const groupId = getActiveCampaignGroupId();
  if (!groupId) return;
  const hasMonsterMarker = (state.map.layers || []).some(
    (layer) =>
      layer.type === "marker" &&
      (layer.elements || []).some(
        (marker) => marker.kind === "marker" && (marker.refKind === "monster" || marker.refKind === "npc") && marker.refId
      )
  );
  if (!hasMonsterMarker) return;
  ensureActiveEncounterCached(groupId, () => renderLayerOverlays());
  const encounter = getCachedActiveEncounter(groupId);
  if (encounter?.systemId) {
    ensureSystemConditionsCached(encounter.systemId, () => renderLayerOverlays());
  }
}

// The Marker Resource Bar (resolveMarkerResourceBarForMarker) shows for ANY combatant
// with a linked marker — character, monster, or NPC alike, per the GM's own
// explicit choice for this feature (unlike condition icons, which only ever
// needed the active Encounter fetch for Monster/NPC markers, since a
// Character's own conditions read straight off its own payload instead —
// see resolveMarkerConditionIcons' own header comment). So this primes the
// active Encounter (and, once its systemId is known, that System's own
// resource-name config) whenever the map has ANY referenced marker at all,
// not gated on Monster/NPC presence the way primeMonsterConditionCache is.
function primeResourceBarCache() {
  const groupId = getActiveCampaignGroupId();
  if (!groupId) return;
  const hasCombatantMarker = (state.map.layers || []).some(
    (layer) =>
      layer.type === "marker" &&
      (layer.elements || []).some(
        (marker) =>
          marker.kind === "marker" &&
          (marker.refKind === "character" || marker.refKind === "monster" || marker.refKind === "npc") &&
          marker.refId
      )
  );
  if (!hasCombatantMarker) return;
  ensureActiveEncounterCached(groupId, () => renderLayerOverlays());
  const encounter = getCachedActiveEncounter(groupId);
  if (encounter?.systemId) {
    ensureSystemResourceBarConfigCached(encounter.systemId, () => renderLayerOverlays());
  }
}

// Which characters the current viewer has owner/admin/edit-shared access to
// (allowsDelete's own established owner-or-admin-or-edit-shared rule — the
// right rule for a CHARACTER, unlike mapAllowsDelete's own narrower
// ownership-only rule for the map itself, see that function's own comment
// for why those two had to diverge) — only ever consulted from the
// restricted render path (see isMarkerDraggableRestricted/
// renderRestrictedLayerOverlays below); the full-access path never reaches
// this at all.
// Confirmed real bug this fixes: with no per-marker check of any kind at
// all, ANY signed-in visitor reaching Orrery's own authoring view — most
// often a player following the Dashboard Map widget's own "Open in Orrery"
// link, a surface this tool was never built assuming a non-owner would use
// — could drag EVERY marker on the map, including characters they don't
// own. Shared fetch-once-per-id-set primer (ownership.js's own
// createCharacterOwnershipPrimer) — same lifecycle the Dashboard's own
// map.js uses (the two used to each carry an independent, buggy copy of
// this; see that shared helper's own comment for the infinite-loop bug this
// replaced). The `currentUserHasFullMapAccess()` skip stays here, not in the
// shared primer — a full-access GM never needs restricted-ownership data at
// all, which is an Orrery-specific concern the Dashboard's own map.js
// (always the restricted view) has no equivalent of.
const characterOwnershipPrimer = createCharacterOwnershipPrimer(dataManager);
function primeCharacterOwnershipCatalog() {
  if (currentUserHasFullMapAccess()) return;
  const ids = new Set();
  (state.map.layers || []).forEach((layer) => {
    if (layer.type !== "marker") return;
    (layer.elements || []).forEach((marker) => {
      if (marker.kind === "marker" && marker.refKind === "character" && marker.refId) {
        ids.add(marker.refId);
      }
    });
  });
  characterOwnershipPrimer.prime(ids, () => renderLayerOverlays());
}

// Generic despite the narrow-sounding original name (was
// isMarkerLayerSelected — renamed since isLayerFallbackInteractive below
// reuses it for grid/vector layers too, not just markers): is THIS layer
// the effective current selection, whether that's the layer itself or one
// of the four selection kinds that scope to a specific layer's own child
// (a grid-cells range, a single marker element, a single vector path).
function isLayerSelected(layer) {
  return (
    (state.selection.kind === "layer" && state.selection.id === layer.id) ||
    (state.selection.kind === "grid-cells" && state.selection.layerId === layer.id) ||
    (state.selection.kind === "marker-element" && state.selection.layerId === layer.id) ||
    // A layer stays "selected" (and therefore its markers stay
    // draggable/clickable, see isMarkerDraggableForFullAccess below) if
    // the current multi-selection includes ANY marker from it — without
    // this, selecting a second marker anywhere flips state.selection.kind
    // to "marker-elements", which matched none of this function's other
    // branches, making every marker on every layer undraggable and
    // silently breaking the Ctrl-click gesture that's supposed to extend
    // the very selection that just formed. Confirmed real bug this
    // avoids, not a hypothetical — caught while wiring
    // toggleMarkerMultiSelect. A GM extending a multi-selection onto a
    // layer with NO currently-selected markers still has to use the
    // left-pane list (renderLayers), same as ordinary single-select
    // already requires for a different, unselected layer today.
    (state.selection.kind === "marker-elements" && (state.selection.elements || []).some((entry) => entry.layerId === layer.id)) ||
    (state.selection.kind === "vector-path" && state.selection.layerId === layer.id)
  );
}

// True while any click-based gesture tool (Draw/Shape/Wall/Light/Measure/
// Ping) is armed — these all claim map clicks for their own purpose, and
// letting fallback click-to-select also respond to the same click was
// confirmed as a real bug once already (see map-viewer.js's own comment on
// createMarkerLayerElement for the "every marker always clickable" version
// of this same mistake): a Measure click landing on a marker underneath
// selected the marker instead of taking a measurement. Draw/Shape/Wall/
// Light each keep a dedicated module-level flag; Measure/Ping don't (no
// equivalent state to read besides their own toggle button's own class).
function isAnyGestureToolActive() {
  return Boolean(
    drawModeActive ||
      shapeModeActive ||
      wallModeActive ||
      lightModeActive ||
      elements.measureToggle?.classList.contains("active") ||
      elements.pingToggle?.classList.contains("active")
  );
}

// Lets a marker/grid-cell/vector element be clicked directly without first
// selecting its owning Layer from the left pane — the fallback hit-testing
// the user asked for: click whatever's actually under the cursor, topmost
// wins (ordinary DOM stacking already resolves that for markers/vectors,
// same as an already-selected layer's own elements do today; a grid
// layer's overlay is one full-map-covering element per layer, so the same
// "later in map.layers paints on top and wins" stacking applies there too).
// Selecting a Layer still narrows this down to just that layer (the
// isLayerSelected branch), matching the existing "select the layer, then
// its own elements become clickable" behavior exactly — this only ADDS the
// "nothing selected yet" case, it doesn't change what happens once
// something is. Suppressed entirely while a gesture tool is armed, so this
// can never reopen the bug isMarkerDraggableForFullAccess originally fixed.
function isLayerFallbackInteractive(layer) {
  if (isAnyGestureToolActive()) return false;
  if (state.selection.kind === null) return true;
  return isLayerSelected(layer);
}

// Only ever used from the full-access render path now (renderLayerOverlays
// below branches to a completely separate, restricted render for anyone
// without full map access — see renderRestrictedLayerOverlays, which pulls
// its own equivalent marker-drag policy from map-viewer.js's shared
// buildRestrictedMapOptions instead of a second copy here) — so this only
// has one job left: the GM/owner/admin can click-select (and, on the same
// gesture, drag) any marker on the currently-selected layer, OR — now —
// any marker at all when no layer is selected yet (isLayerFallbackInteractive
// already covers the selected-layer case as one of its own branches).
function isMarkerDraggableForFullAccess(layer) {
  return isLayerFallbackInteractive(layer);
}

// Shapes & Effects plan, Part 5 — replays a placed, non-looping particle
// effect's run() cycle from its own inspector "Play" button. Not a data
// change (nothing about the element itself is different after this), so no
// recordHistory/applyShapeChange — just resets its "already played" state
// and forces a re-render, same mechanism triggerElementById (map.js) uses
// for a remote-delivered trigger, then broadcasts so the rest of the table
// sees it too. Plays locally first, same "don't make your own feedback
// depend on the full SSE round-trip" reasoning the ping tool's own
// pointerdown handler already follows just below.
function triggerShapeEffectElement(layer, shapeElement) {
  resetParticleEffectPlayState(shapeElement.id);
  renderLayerOverlays();
  const groupId = getActiveCampaignGroupId();
  if (!groupId || !dataManager) return;
  void dataManager
    .postEffectBroadcast({ groupId, mapId: state.map.id, elementId: shapeElement.id })
    .catch((error) => {
      status.show(error.message || "Unable to broadcast this effect.", { type: "error", timeout: 3000 });
    });
}

function renderLayerOverlays() {
  const overlay = baseMapManager.getOverlayContainer();
  if (!overlay) {
    return;
  }
  // A restricted viewer's drag (beginMarkerDrag, map-viewer.js) tracks the
  // cursor via direct style mutation on its own dot element, entirely
  // outside this function — it needs nothing from a re-render until the
  // gesture actually ends (onMarkerDragEnd handles that explicitly). ANY
  // render triggered while a drag is in flight would rebuild the marker
  // layer's DOM and tear out that exact dot out from under the pointer-
  // capture driving the gesture — confirmed real bug, and more common than
  // it sounds: the ownership-catalog/vision-payload caches below
  // (primeCharacterOwnershipCatalog/primeCharacterPayloadCache) each kick
  // off their own fire-and-forget fetch-then-render-again the FIRST time
  // this runs after a fresh page load, i.e. almost exactly when a first,
  // freshly-loaded test drag is most likely to be in progress — not just
  // the remote poll (which isDraggingRestrictedMarker already guarded
  // separately, but wasn't the only trigger). One guard here covers every
  // trigger uniformly instead of chasing each one individually.
  if (isDraggingRestrictedMarker) return;
  const hasFullAccess = currentUserHasFullMapAccess();
  // Everything below `[data-pane]`/the floating toolbar's authoring
  // buttons (css/styles.css) is hidden by this class alone — see its own
  // rules for the full list. Keyed off mapIsLoaded too so a fresh page load
  // (mapCatalog not populated yet, hasFullAccess defaults false — see
  // mapAllowsDelete) doesn't flash the restricted class before there's even
  // a map to judge access against.
  document.body.classList.toggle("orrery-restricted-viewer", mapIsLoaded && !hasFullAccess);
  if (!hasFullAccess) {
    renderRestrictedLayerOverlays(overlay);
    return;
  }
  primeCharacterPayloadCache();
  primeMonsterConditionCache();
  primeResourceBarCache();
  primeCharacterOwnershipCatalog();
  syncOverlayInteractivity();
  const activeGroup =
    state.selection.kind === "group" ? state.map.groups.find((group) => group.id === state.selection.id) : null;
  const paintLayer = resolvePaintTargetLayer(activeGroup);
  renderMapLayers(overlay, baseMapManager, state.map, {
    viewerTier: getEffectiveViewerTier(),
    hasFullAccess: true,
    isMarkerDraggable: isMarkerDraggableForFullAccess,
    // Whether THIS layer's own empty-click-places-a-marker should be armed
    // — see armedMarkerLayerId's own comment. Kept separate from
    // isMarkerDraggable/isLayerFallbackInteractive on purpose: an existing
    // marker can be fallback-clickable (select/drag it) on a layer that
    // ISN'T armed for placing new ones.
    armedMarkerLayerId,
    // Same fallback click-to-select for vector paths/shapes/doors (already
    // has this exact escape hatch — built for the Dashboard Map widget,
    // which has no layer-selection concept at all) as markers get above.
    // Grid layers deliberately don't get this — see the grid branch's own
    // comment in map-viewer.js for why (a grid overlay covers the whole
    // map, so fallback-interactive there would swallow every click).
    isVectorLayerInteractive: isLayerFallbackInteractive,
    selection: state.selection,
    activeGroup,
    // Orrery's own authoring view needs to resolve vision Bindings too —
    // both for its own live fog-preview tint and so the marker inspector's
    // Binding field can display a resolved value once the record loads.
    getCharacterPayload: getCachedCharacterPayload,
    resolveConditionIcons: resolveMarkerConditionIconsForMarker,
    resolveResourceBar: resolveMarkerResourceBarForMarker,
    onGridCellPointerDown: (layer, coord, event) => {
      const entry = createGridCellSelectionEntry(layer, coord);
      const isCtrl = event.metaKey || event.ctrlKey;
      const isShift = event.shiftKey;
      const existing =
        state.selection.kind === "grid-cells" && state.selection.layerId === layer.id ? state.selection.cells : [];
      const selectionMap = new Map(existing.map((cell) => [cell.key, cell]));
      let nextAnchor = coord;
      if (isShift && (state.selection.anchor || existing.length)) {
        const anchor = state.selection.anchor || existing[0]?.coord || coord;
        const range = buildGridRangeSelection(layer, anchor, coord);
        selectionMap.clear();
        range.forEach((cell) => selectionMap.set(cell.key, cell));
        nextAnchor = anchor;
      } else if (isCtrl) {
        if (selectionMap.has(entry.key)) {
          selectionMap.delete(entry.key);
        } else {
          selectionMap.set(entry.key, entry);
        }
      } else {
        selectionMap.clear();
        selectionMap.set(entry.key, entry);
      }
      const nextCells = Array.from(selectionMap.values());
      if (nextCells.length === 0) {
        setSelection("layer", layer.id);
      } else {
        setSelection("grid-cells", null, { layerId: layer.id, cells: nextCells, anchor: nextAnchor });
      }
    },
    onMarkerLayerEmptyClick: (layer, position, event) => {
      const newElement = createMarkerElement({ position: snapMarkerPositionToGrid(position, layer) });
      recordHistory("place marker", () => {
        layer.elements = layer.elements || [];
        layer.elements.push(newElement);
        updateMapTimestamp(state.map);
      });
      setSelection("marker-element", newElement.id, { layerId: layer.id });
      renderJson();
    },
    onMarkerDragStart: (layer, markerElement, dotEl) => selectMarkerElementForDrag(layer, markerElement, dotEl),
    onMarkerMultiSelectToggle: (layer, markerElement) => toggleMarkerMultiSelect(layer, markerElement),
    onMarkerDragEnd: (layer, markerElement, nextPosition) => {
      const before = JSON.stringify(state.map);
      markerElement.position = snapMarkerPositionToGrid(nextPosition, layer);
      updateMapTimestamp(state.map);
      const after = JSON.stringify(state.map);
      if (before !== after) {
        undoStack.push({ label: "move marker", before, after });
        // VTT-like immediacy: a moved token saves itself the instant the
        // drag ends, same as a restricted (non-owner) viewer's own marker
        // drag already does via this exact helper — no need to wait for the
        // GM's own separate Save button, which stays reserved for walls/
        // lights/layer settings/map settings (see isMapDirty's own field
        // exclusion for why this doesn't also light up Save).
        if (mapExistsOnServer) {
          void persistElementUpdate({
            dataManager,
            mapId: state.map.id,
            shareToken: currentShareToken,
            layerId: layer.id,
            elementId: markerElement.id,
            patch: { position: markerElement.position },
          })
            .then(() => mapWatcher?.noteLocalWrite())
            .catch((error) => {
              status?.show(error?.message || "Unable to save that move.", { type: "danger" });
            });
        }
      }
      // Deferred until drag-end, same as bindLayerDrag's whole-layer drag: a
      // full renderLayerOverlays() mid-drag would replace dotEl in the DOM
      // out from under the pointer capture driving the gesture.
      renderLayerOverlays();
      // The marker's own Position X/Y fields (if this marker's inspector is
      // still open) need this to pick up where the drag actually landed —
      // renderLayerOverlays() alone doesn't touch the selection panel.
      // Safe here specifically because it's AFTER the deferred-until-drag-
      // end point above (dotEl isn't mid-gesture anymore), unlike a
      // renderSelection() during the drag itself, which would tear out the
      // very node the pointer capture is driving.
      renderSelection();
      syncOverlayInteractivity();
      renderJson();
    },
    renderLayerHandle: (wrapper, layer, element) => {
      const handle = document.createElement("div");
      handle.className = "orrery-layer-handle";
      wrapper.appendChild(handle);
      wrapper.classList.add("is-draggable");
      bindLayerDrag(handle, layer, element);
    },
    // Only wired while Draw/Shape mode is off (see setupDrawTool/
    // setupShapeTool) — a drawn path or placed shape needs to stay
    // click-through while actively drawing, so a new stroke can start
    // anywhere, including on top of an existing one — but NOT gated on
    // shapeModeActive: a placed shape should always be immediately
    // selectable/draggable, matching how a placed Marker already works
    // (click it to select, click empty space to place a new one), even
    // while the Shape tool is still armed. Confirmed as a real bug before
    // this: with shapes ALSO click-through while shapeModeActive, clicking
    // a just-placed shape didn't select it — it fell through and stamped a
    // brand new shape on top of it instead. A shape uses the lightweight
    // selectShapeElementForDrag (no overlay rebuild — see its own comment)
    // since it might be about to be dragged; a plain path has no drag to
    // protect, so the regular setSelection is fine.
    // "shape" or "light" — both use the lightweight selectShapeElementForDrag
    // (no overlay rebuild) since either might be about to be dragged; a
    // plain path has no drag to protect, so the regular setSelection is fine
    // for that (walls get their own dedicated onWallDragEnd/
    // onWallVertexDragEnd below instead of this callback).
    //
    // Gated by drawModeActive || wallModeActive (NOT shapeModeActive/
    // lightModeActive — a placed shape/light must stay immediately
    // selectable even while ITS OWN tool is still armed, see this block's
    // own history a few lines up) — walls have no equivalent "click my own
    // just-placed one" nuance (their own placement commits via double-
    // click/Enter, not a drag-release), so there's no reason to keep other
    // elements interactive while Wall mode is active.
    onVectorPathClick: drawModeActive || wallModeActive
      ? undefined
      : (layer, elementId, event, kind) => {
          if (kind === "shape" || kind === "light") {
            selectShapeElementForDrag(layer, elementId);
          } else {
            setSelection("vector-path", elementId, { layerId: layer.id });
          }
        },
    // Shared by both AoE shapes and Lights — snapMarkerPositionToGrid isn't
    // actually shape-specific, it only ever uses the layer's own generic
    // getMarkerLayerOffset, so it snaps any layer's element position. A
    // Light has no snapToGrid field of its own (unlike a shape) — the
    // `!== false` default here means a dragged light always snaps, which is
    // a reasonable default for a grid-based placement and not worth a
    // dedicated per-light toggle.
    //
    // wallModeActive added to this gate (previously only drawModeActive) —
    // confirmed as the actual cause of "a light gets selected instead of
    // the wall being drawn": onVectorPathClick above was already correctly
    // gated by wallModeActive, but this callback wasn't, so an
    // already-selected light's own DRAG capability alone (independent of
    // click-to-select) was still enough for its hit-target to intercept the
    // pointerdown and call stopPropagation() before the Wall tool's own
    // mapContainer handler ever saw it.
    onShapeDragEnd: drawModeActive || wallModeActive
      ? undefined
      : (layer, elementId, nextOrigin) => {
          const draggedElement = layer.elements?.find((entry) => entry.id === elementId);
          if (!draggedElement) return;
          const before = JSON.stringify(state.map);
          draggedElement.origin = draggedElement.snapToGrid !== false ? snapShapeOriginToGrid(nextOrigin, layer) : nextOrigin;
          updateMapTimestamp(state.map);
          const after = JSON.stringify(state.map);
          if (before !== after) {
            undoStack.push({ label: draggedElement.kind === "light" ? "move light" : "move shape", before, after });
          }
          renderLayerOverlays();
          renderJson();
        },
    // Whole-wall drag — translates every point of the wall by the same
    // delta (map-viewer.js's renderWallElement already computed the shifted
    // points; this just re-snaps each one if the wall's own snapToGrid is
    // on and commits). Gated by every OTHER placement tool too (not just
    // wallModeActive/drawModeActive) — unlike a shape/light, a wall has no
    // "click my own just-placed one" convenience to preserve (its own
    // placement never commits via a single click the way a shape/light's
    // does), so there's no reason to leave an existing wall interactive
    // while placing a brand new shape or light near/over it either.
    onWallDragEnd: drawModeActive || wallModeActive || shapeModeActive || lightModeActive
      ? undefined
      : (layer, elementId, nextPoints) => {
          const wallElement = layer.elements?.find((entry) => entry.id === elementId);
          if (!wallElement) return;
          const before = JSON.stringify(state.map);
          wallElement.points = wallElement.snapToGrid !== false ? nextPoints.map((point) => snapShapeOriginToGrid(point, layer)) : nextPoints;
          updateMapTimestamp(state.map);
          const after = JSON.stringify(state.map);
          if (before !== after) {
            undoStack.push({ label: "move wall", before, after });
          }
          renderLayerOverlays();
          renderJson();
        },
    // Single-vertex drag (the handles shown when a wall is selected) — same
    // snap/commit shape (and same gating reasoning) as onWallDragEnd, just
    // for one point.
    onWallVertexDragEnd: drawModeActive || wallModeActive || shapeModeActive || lightModeActive
      ? undefined
      : (layer, elementId, vertexIndex, nextPoint) => {
          const wallElement = layer.elements?.find((entry) => entry.id === elementId);
          if (!wallElement || !Array.isArray(wallElement.points) || !wallElement.points[vertexIndex]) return;
          const before = JSON.stringify(state.map);
          wallElement.points[vertexIndex] = wallElement.snapToGrid !== false ? snapShapeOriginToGrid(nextPoint, layer) : nextPoint;
          updateMapTimestamp(state.map);
          const after = JSON.stringify(state.map);
          if (before !== after) {
            undoStack.push({ label: "reshape wall", before, after });
          }
          renderLayerOverlays();
          renderJson();
        },
    paintModeActive: Boolean(activeGroup && paintLayer),
    paintTargetLayerId: paintLayer?.id ?? null,
    // Additive only (never removes a cell already a member) — a single
    // click or a whole drag sweep both just add cells in, not a toggle/
    // erase tool; removing individual cells still works fine through the
    // plain select-then-checkbox path this doesn't replace. No
    // recordHistory per cell — paintDragBefore (captured on the FIRST cell
    // of a gesture) and onGridCellPaintEnd below batch the whole gesture
    // (single click included) into one undo entry.
    onGridCellPaint: (layer, coord) => {
      const group = activeGroup;
      if (!group) return;
      if (paintDragBefore === null) {
        paintDragBefore = JSON.stringify(state.map);
      }
      const resolved = findGridCell(layer, coord) || ensureGridCell(layer, coord);
      const member = { layerId: layer.id, elementId: resolved.id, kind: "grid-cell" };
      const key = getGroupMemberKey(member);
      const alreadyMember = normalizeGroupMembers(group).some((entry) => getGroupMemberKey(entry) === key);
      if (alreadyMember) return;
      group.elementIds = [...normalizeGroupMembers(group), member];
      updateMapTimestamp(state.map);
      renderLayerOverlays();
      renderJson();
    },
    onGridCellPaintEnd: () => {
      if (paintDragBefore !== null) {
        const after = JSON.stringify(state.map);
        if (paintDragBefore !== after) {
          undoStack.push({ label: "paint group cells", before: paintDragBefore, after });
        }
        paintDragBefore = null;
      }
      // Full rebuild only at drag-end (not per-cell, see onGridCellPaint's
      // own comment) — refreshes the Members list/count in the still-open
      // group editor.
      renderSelection();
    },
  });
}

// Restricted (non-owner, non-admin) viewer — no Layers/Groups/Views panel,
// no toolbar tools, no click-to-select of anything at all (css/styles.css's
// own .orrery-restricted-viewer rules hide every one of those UI surfaces —
// see renderLayerOverlays' own toggle above). The interactive POLICY this
// render path wires up (drag a character marker you own, open/close a
// non-secret unlocked door, wall-aware blocking, grid-snap on drop) comes
// straight from map-viewer.js's own buildRestrictedMapOptions — the SAME
// function the Dashboard's own Map widget uses, not a second, independently
// -written copy of the same rules (confirmed real complaint: the two used
// to drift — dragging felt "totally different" between the widget and
// Orrery precisely because each had its own bespoke implementation).
// Deliberately a SEPARATE renderMapLayers call from the full-access one
// above (not a conditionally-neutered version of it) — same "supply no
// callback at all to opt a feature out" convention the widget's own map.js
// already established, rather than scattering `restricted ? undefined :
// ...` through every closure above.
// A minimal popover for a restricted viewer's marker click — a marker they
// can't drag (not their own character token) but that references a real
// Library record, the same "used to do nothing at all on click" gap fixed
// for the Dashboard's own Map widget (see that file's own
// openMarkerLinkPopover, which this mirrors — Orrery's restricted view has
// no shared DOM-building module with the widget beyond map-viewer.js's pure
// resolveMarkerLinkTarget, so each builds its own small popover using its
// own existing host/lifecycle conventions).
let restrictedMarkerLinkPopover = null;
function closeRestrictedMarkerLinkPopover() {
  restrictedMarkerLinkPopover?.remove();
  restrictedMarkerLinkPopover = null;
  document.removeEventListener("pointerdown", onOutsideRestrictedMarkerLinkPointerDown, true);
}
function onOutsideRestrictedMarkerLinkPointerDown(event) {
  if (restrictedMarkerLinkPopover && !restrictedMarkerLinkPopover.contains(event.target)) {
    closeRestrictedMarkerLinkPopover();
  }
}
function openRestrictedMarkerLinkPopover(layer, markerElement, dotEl) {
  const target = resolveMarkerLinkTarget(markerElement);
  const contents = markerElement.contents || [];
  // Opens for a real reference (the pre-existing "Open in <Tool>" case)
  // OR a marker carrying unclaimed Contents — a plain token with nothing
  // linked but loot sitting on it is exactly the new case this adds.
  if (!target && !contents.length) return;
  closeRestrictedMarkerLinkPopover();
  const popover = document.createElement("div");
  popover.className = "orrery-floating-panel d-flex flex-column gap-1 p-2";
  popover.style.position = "fixed";
  popover.style.width = "12rem";
  popover.style.zIndex = "1040";
  const rect = dotEl?.getBoundingClientRect?.();
  const hostRect = mapContainer.getBoundingClientRect();
  const top = rect ? rect.bottom + 4 : hostRect.top + 4;
  const left = rect ? Math.min(rect.left, hostRect.right - 200) : hostRect.left + 4;
  popover.style.top = `${top}px`;
  popover.style.left = `${Math.max(hostRect.left + 4, left)}px`;

  if (markerElement.label) {
    const title = document.createElement("div");
    title.className = "small fw-semibold text-truncate";
    title.textContent = markerElement.label;
    popover.appendChild(title);
  }
  if (target) {
    const link = document.createElement("a");
    link.className = "btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1";
    link.href = target.url;
    link.innerHTML = `<span class="iconify" data-icon="tabler:external-link" aria-hidden="true"></span> Open in ${target.toolLabel}`;
    popover.appendChild(link);
  }

  // Contents claim rows — one Claim button per remaining item, calling the
  // SAME shared claimMarkerContentEntry (marker-contents.js) the Dashboard's
  // own Map widget calls too, so the two never grow independently-diverging
  // claim logic even though each still builds its own popover DOM.
  contents.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center justify-content-between gap-2";
    const label = document.createElement("span");
    label.className = "small text-truncate";
    label.textContent = describeMarkerContentEntry(entry);
    const claimButton = document.createElement("button");
    claimButton.type = "button";
    claimButton.className = "btn btn-outline-primary btn-sm flex-shrink-0";
    claimButton.textContent = "Claim";
    claimButton.addEventListener("click", async () => {
      claimButton.disabled = true;
      try {
        const groupId = getActiveCampaignGroupId();
        const result = await claimMarkerContentEntry({
          dataManager,
          groupId,
          shareToken: currentShareToken,
          mapId: state.map.id,
          layerId: layer.id,
          elementId: markerElement.id,
          contentId: entry.id,
        });
        closeRestrictedMarkerLinkPopover();
        if (!result) {
          status?.show("That's already been claimed.", { type: "info", timeout: 2500 });
          return;
        }
        applyRemoteMapLayers(result.map);
        status?.show(`Claimed ${result.label} for ${result.destinationLabel}.`, { type: "success", timeout: 2500 });
      } catch (error) {
        claimButton.disabled = false;
        status?.show(error?.message || "Unable to claim that item.", { type: "error", timeout: 4000 });
      }
    });
    row.append(label, claimButton);
    popover.appendChild(row);
  });

  mapContainer.appendChild(popover);
  restrictedMarkerLinkPopover = popover;
  document.addEventListener("pointerdown", onOutsideRestrictedMarkerLinkPointerDown, true);
}

function renderRestrictedLayerOverlays(overlay) {
  primeCharacterPayloadCache();
  primeMonsterConditionCache();
  primeResourceBarCache();
  primeCharacterOwnershipCatalog();
  renderMapLayers(overlay, baseMapManager, state.map, {
    viewerTier: getEffectiveViewerTier(),
    ...buildRestrictedMapOptions({
      dataManager,
      baseMapManager,
      map: state.map,
      characterOwnershipCatalog: characterOwnershipPrimer.getCatalog(),
      getCharacterPayload: getCachedCharacterPayload,
      resolveConditionIcons: resolveMarkerConditionIconsForMarker,
      resolveResourceBar: resolveMarkerResourceBarForMarker,
        status,
      onMarkerMoved: (layer, markerElement, snappedPosition) =>
        void persistRestrictedMarkerMove(layer, markerElement, snappedPosition),
      onDoorToggled: (layer, elementId) => void toggleDoorRestricted(layer.id, elementId),
      onMarkerClicked: (layer, markerElement, dotEl, draggable) => {
        if (!draggable) openRestrictedMarkerLinkPopover(layer, markerElement, dotEl);
      },
      onDragStateChange: (dragging) => {
        isDraggingRestrictedMarker = dragging;
      },
    }),
  });
}

// A restricted viewer's own writes need an IMMEDIATE, single-element persist
// (map-live-sync.js's persistElementUpdate/persistMarkerMove: fresh fetch,
// patch just this one element, save) — not this file's usual "mutate
// state.map locally, wait for the GM to click Save" convention every other
// edit here uses, since a restricted viewer never sees a Save button at all
// (data-pane-content is hidden entirely, see css/styles.css). Both merge the
// server's fresh response back in via applyRemoteMapLayers — the same "pick
// up someone else's change" path this file's own poll (watchCurrentMap)
// already uses.
async function toggleDoorRestricted(layerId, elementId) {
  try {
    const freshMap = await persistElementUpdate({
      dataManager,
      mapId: state.map.id,
      shareToken: currentShareToken,
      layerId,
      elementId,
      patch: (freshElement) => {
        freshElement.doorState = freshElement.doorState === "open" ? "closed" : "open";
      },
    });
    if (freshMap) applyRemoteMapLayers(freshMap);
  } catch (error) {
    status.show(error.message || "Unable to open the door.", { type: "error" });
  }
}

async function persistRestrictedMarkerMove(layer, markerElement, nextPosition) {
  try {
    const freshMap = await persistMarkerMoveShared({
      dataManager,
      mapId: state.map.id,
      shareToken: currentShareToken,
      layerId: layer.id,
      elementId: markerElement.id,
      nextPosition,
    });
    if (freshMap) applyRemoteMapLayers(freshMap);
  } catch (error) {
    status.show(error.message || "Unable to save your marker's new position.", { type: "error" });
  }
}

function createSelectionSectionTitle(text) {
  const title = document.createElement("div");
  title.className = "text-uppercase fs-6 fw-semibold text-body-secondary";
  title.textContent = text;
  return title;
}

// createHalfWidthNumberField (common/js/lib/inspector-fields.js) commits on
// every "input" event — every keystroke — which is fine for its OTHER
// callers (e.g. Workbench's Template editor, whose rerender only touches a
// separate canvas preview) but was actively dangerous here: Position X/Y's
// own apply function used to call renderSelection(), rebuilding this whole
// panel — including the very input being typed into — on every single
// keystroke. That destroys the focused input and drops focus (often back to
// nothing/<body>) without restoring it; the NEXT keystroke then lands
// wherever focus fell instead of the input, and if that keystroke happened
// to be Delete/Backspace, the global keydown handler's "click whatever
// delete-selected button is showing" shortcut fired — deleting the entire
// selected layer. Confirmed as the actual cause of "typing in Position X/Y
// sometimes deletes the whole layer," and (since a blur-triggered rebuild
// mid-Tab-transition has the same focus-loss problem) of Tab no longer
// landing on the expected next field either. This wrapper builds the same
// field but commits on "change" (blur/Enter) instead — matching how every
// OTHER numeric field in this file (buildLayerSettingField's non-"half"
// branch) already behaves — and is paired everywhere below with an apply
// function that does NOT call renderSelection() for exactly the fields
// (Position X/Y, AoE shape Size/Angle/Spread/Width) where nothing else in
// the panel depends on the new value, so there's nothing left to rebuild
// mid-edit at all.
function createCommitOnBlurNumberField(label, value, onChange, options = {}) {
  const field = createHalfWidthNumberField(label, value, undefined, options);
  if (typeof onChange !== "function") {
    return field;
  }
  const input = field.querySelector("input");
  input.addEventListener("change", () => {
    const next = input.value === "" ? null : Number(input.value);
    if (next !== null && Number.isNaN(next)) {
      return;
    }
    onChange(next);
  });
  return field;
}

// Shared by the base map's own Image Width/Height (setupMapEvents) and a
// Raster layer's Width/Height (buildLayerSettingField calls this instead
// for those two keys) — three valid forms, matching
// base-maps.js's own resolveImageDimension exactly: blank means "clear the
// override, render at native size" (null — NOT rejected the way
// Number("") <= 0 used to silently reject it, which meant these fields
// could never actually be cleared before), "NN%" scales the image's own
// native size, anything else must be a literal positive pixel number.
function parseImageDimension(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, value: null };
  }
  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed);
    return Number.isFinite(pct) && pct > 0 ? { valid: true, value: trimmed } : { valid: false };
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? { valid: true, value: numeric } : { valid: false };
}

// Free text, not type="number" — a number input rejects "%" at the browser
// level. Tracks the last successfully-committed display value itself
// (rather than re-reading whatever prop it was built with) so reverting an
// invalid edit doesn't regress to a stale value once the field has already
// committed at least one real change — this field is never rebuilt after
// mount (see applyLayerSettingsFieldChange's own no-renderSelection()
// reasoning), so nothing else keeps that tracking for it.
function createDimensionField(label, value, onChange, options = {}) {
  const field = createCompactField({ type: "text", label, ...options });
  const input = field.querySelector("input");
  let lastGoodDisplay = value ?? "";
  input.value = lastGoodDisplay;
  input.addEventListener("change", () => {
    const parsed = parseImageDimension(input.value);
    if (!parsed.valid) {
      input.value = lastGoodDisplay;
      return;
    }
    lastGoodDisplay = input.value.trim();
    onChange(parsed.value);
  });
  return field;
}

// Position X/Y both on a Layer's whole-layer pan offset and (separately) a
// Marker element's own {x,y} share this exact shape. Recorded via
// applyLayerPositionChange (NOT applyLayerChange — see
// createCommitOnBlurNumberField's own comment for why this specific field
// must not rebuild the panel it lives in). Marker elements use their own
// inline updater instead (see renderMarkerElementSelectionEditor).
function applyLayerPositionChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayerOverlays();
  renderJson();
}

function buildLayerPositionField(layer, axis, label) {
  return createCommitOnBlurNumberField(label, layer.position?.[axis] ?? 0, (value) => {
    if (value === null) {
      return;
    }
    applyLayerPositionChange(`layer position ${axis}`, () => {
      layer.position = { ...(layer.position || { x: 0, y: 0 }), [axis]: value };
    });
  });
}

function buildLayerOpacityField(layer) {
  const field = createCompactField({ type: "range", label: "Opacity", controlClass: "form-range", min: 0, max: 1, step: 0.05 });
  const input = field.querySelector("input");
  input.value = layer.opacity;
  input.addEventListener("change", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) {
      return;
    }
    applyLayerChange("layer opacity", () => {
      layer.opacity = value;
    });
  });
  return field;
}

// One field per LAYER_SETTINGS_SCHEMA[layer.type] entry (Stroke/Fill color,
// Grid type, Cell size, Marker size/color, ...), same change/undo wiring
// throughout (recordHistory via applyLayerSettingsChange, plus the
// gridType-changes-invalidate-cell-selection special case) regardless of
// shape. `variant` picks the shape to match how the field sits in the
// layout:
// - "floating" (default) — createFormFloatingField, the suite-wide shape
//   for a standalone single-column field (Grid type, Cell size, Stroke
//   width, Raster's Image URL) — matches Workbench's own inspector
//   convention for primary right-pane controls.
// - "compact" — createCompactField's small-label-above-input shape, for a
//   field condensed into a dense paired row (a color swatch next to
//   Opacity, Scale next to Scale unit).
// - "half" — createHalfWidthNumberField, for a numeric field condensed
//   alongside Position X/Y (Marker's own Size) — same shape as Position
//   itself, so labels in that row match instead of one being visibly
//   larger than the others.
function buildLayerSettingField(layer, field, { variant = "floating" } = {}) {
  if (!field) {
    return document.createDocumentFragment();
  }
  if (variant === "half") {
    return createCommitOnBlurNumberField(field.label, layer.settings?.[field.key], (value) => {
      if (value === null) {
        return;
      }
      applyLayerSettingsFieldChange(`layer ${field.key}`, () => {
        layer.settings = layer.settings || {};
        layer.settings[field.key] = value;
      });
    }, { min: field.min, max: field.max, step: field.step });
  }
  const factory = variant === "compact" ? createCompactField : createFormFloatingField;
  const built = factory({
    type: field.type === "select" ? "select" : field.type,
    label: field.label,
    controlClass: field.type === "color" ? "form-control form-control-color" : undefined,
    // form-floating's label-float behavior needs a placeholder attribute to
    // key off of (Bootstrap's :placeholder-shown check) — a single space
    // when there's no real placeholder text, same convention Workbench's
    // own createTextInput/createNumberInput already follow.
    placeholder: variant === "floating" && field.type !== "select" ? " " : undefined,
    options: field.options || [],
    min: field.min,
    max: field.max,
    step: field.step,
  });
  const input = built.querySelector("input, select");
  const currentValue = layer.settings?.[field.key];
  if (currentValue !== undefined) {
    input.value = String(currentValue);
  }
  input.addEventListener("change", () => {
    let nextValue = input.value;
    if (field.type === "number") {
      const numeric = Number(nextValue);
      if (!Number.isFinite(numeric)) {
        return;
      }
      nextValue = numeric;
    }
    applyLayerSettingsFieldChange(`layer ${field.key}`, () => {
      layer.settings = layer.settings || {};
      layer.settings[field.key] = nextValue;
    });
    if (field.key === "gridType" && state.selection.kind === "grid-cells" && state.selection.layerId === layer.id) {
      setSelection("layer", layer.id);
    }
  });
  return built;
}

// The Marker Layer's Icon setting — a free-text field until now with no
// visual effect (createMarkerDot never read layer.settings.icon; fixed
// alongside this to actually render the chosen icon). Uses the same
// autocomplete+preview picker as Press/Workbench's icon fields.
function buildMarkerIconField(layer) {
  const field = createIconPickerField({
    label: "Icon",
    value: layer.settings?.icon || "",
    onSelect: (value) => {
      applyLayerSettingsChange("layer icon", () => {
        layer.settings = layer.settings || {};
        layer.settings.icon = value;
      });
    },
  });
  return field;
}

// Show Labels toggle + Position/Size — same "toggle, then conditionally
// show the fields it gates" shape buildFogOfWarFields already uses, not a
// LAYER_SETTINGS_SCHEMA entry since Position/Size only make sense to show
// once labels are actually on.
function buildMarkerLabelFields(layer) {
  const wrapper = document.createDocumentFragment();
  const toggleField = createCheckField({ id: `layer-labels-${layer.id}`, label: "Show Labels", switchStyle: true });
  const toggleInput = toggleField.querySelector("input");
  toggleInput.checked = Boolean(layer.settings?.showLabels);
  toggleInput.addEventListener("change", () => {
    applyLayerSettingsChange("layer show labels", () => {
      layer.settings = layer.settings || {};
      layer.settings.showLabels = toggleInput.checked;
    });
  });
  wrapper.appendChild(toggleField);
  if (layer.settings?.showLabels) {
    const positionField = createFormFloatingField({
      type: "select",
      label: "Label position",
      options: [
        { value: "above", label: "Above marker" },
        { value: "below", label: "Below marker" },
        { value: "over", label: "Over marker" },
      ],
    });
    const positionSelect = positionField.querySelector("select");
    positionSelect.value = layer.settings.labelPosition || "below";
    positionSelect.addEventListener("change", () => {
      applyLayerSettingsFieldChange("layer label position", () => {
        layer.settings.labelPosition = positionSelect.value;
      });
    });
    const sizeField = createCommitOnBlurNumberField(
      "Label size",
      Number.isFinite(layer.settings.labelSize) ? layer.settings.labelSize : 12,
      (value) => {
        if (value === null) return;
        applyLayerSettingsFieldChange("layer label size", () => {
          layer.settings.labelSize = Math.max(1, value);
        });
      },
      { min: 1, step: 1 }
    );
    wrapper.appendChild(createFieldRow([positionField, sizeField], { columns: 2 }));
  }
  return wrapper;
}

// Fog of War toggle + reveal-group picker for a grid layer. Deliberately not
// a LAYER_SETTINGS_SCHEMA entry like the rest of the grid fields — the
// reveal-group select needs live options from state.map.groups, which the
// schema-driven buildLayerSettingField (static options only) can't supply,
// same reasoning as buildMarkerIconField's own special-casing.
function buildFogOfWarFields(layer) {
  const wrapper = document.createDocumentFragment();
  const toggleRow = document.createElement("div");
  toggleRow.className = "d-flex align-items-center justify-content-between gap-2";
  const toggleField = createCheckField({ id: `layer-fog-${layer.id}`, label: "Fog of War", switchStyle: true });
  const toggleInput = toggleField.querySelector("input");
  toggleInput.checked = Boolean(layer.settings?.fogOfWar);
  toggleInput.addEventListener("change", () => {
    applyLayerSettingsChange("layer fog of war", () => {
      layer.settings = layer.settings || {};
      layer.settings.fogOfWar = toggleInput.checked;
      // Auto-create a dedicated reveal group the first time fog is turned
      // on, so there's immediately somewhere to add cells via the existing
      // Groups UI instead of a dead "fog on, nothing configured yet" state.
      if (toggleInput.checked && !layer.settings.revealGroupId) {
        const group = createGroup({ name: `${layer.name} — Revealed` });
        state.map.groups.push(group);
        layer.settings.revealGroupId = group.id;
      }
    });
    // applyLayerSettingsChange doesn't re-render the left pane's Groups
    // list (most settings changes have nothing to do with it) — the new
    // reveal group created above needs it explicitly, or it exists in
    // state.map.groups but never appears anywhere for the GM to find.
    renderGroups();
  });
  const fogHelp = document.createElement("span");
  fogHelp.className = "align-middle";
  fogHelp.dataset.helpTopic = "orrery.fogOfWar";
  fogHelp.dataset.helpInsert = "replace";
  toggleRow.append(toggleField, fogHelp);
  wrapper.appendChild(toggleRow);
  initHelpSystem({ root: toggleRow });
  if (layer.settings?.fogOfWar) {
    const groupField = createFormFloatingField({ type: "select", label: "Reveal group" });
    const select = groupField.querySelector("select");
    state.map.groups.forEach((group) => {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      select.appendChild(option);
    });
    select.value = layer.settings.revealGroupId || "";
    select.addEventListener("change", () => {
      applyLayerSettingsChange("layer reveal group", () => {
        layer.settings.revealGroupId = select.value;
      });
    });
    wrapper.appendChild(groupField);

    const autoRevealField = createCheckField({ id: `layer-auto-reveal-${layer.id}`, label: "Auto-Reveal from Character Vision", switchStyle: true });
    const autoRevealInput = autoRevealField.querySelector("input");
    autoRevealInput.checked = Boolean(layer.settings.autoRevealFromVision);
    autoRevealInput.addEventListener("change", () => {
      applyLayerSettingsChange("layer auto reveal from vision", () => {
        layer.settings.autoRevealFromVision = autoRevealInput.checked;
      });
    });
    const autoRevealRow = document.createElement("div");
    autoRevealRow.className = "d-flex align-items-center justify-content-between gap-2";
    const autoRevealHelp = document.createElement("span");
    autoRevealHelp.className = "align-middle";
    autoRevealHelp.dataset.helpTopic = "orrery.autoRevealVision";
    autoRevealHelp.dataset.helpInsert = "replace";
    autoRevealRow.append(autoRevealField, autoRevealHelp);
    wrapper.appendChild(autoRevealRow);
    initHelpSystem({ root: autoRevealRow });

    // Same range-slider shape as every other Opacity in this suite
    // (buildLayerOpacityField's own). Two independent sliders, not one —
    // "opaque enough a player can't cheat" and "visible enough a GM can
    // actually see it while working" are different targets (see
    // createLayerSettings's own comment on these two keys).
    const playerOpacityField = createCompactField({ type: "range", label: "Player Fog Opacity", controlClass: "form-range", min: 0, max: 1, step: 0.05 });
    const playerOpacityInput = playerOpacityField.querySelector("input");
    playerOpacityInput.value = Number.isFinite(layer.settings.fogOpacity) ? layer.settings.fogOpacity : 0.92;
    playerOpacityInput.addEventListener("change", () => {
      const value = Number(playerOpacityInput.value);
      if (!Number.isFinite(value)) return;
      applyLayerSettingsFieldChange("layer fog opacity", () => {
        layer.settings.fogOpacity = value;
      });
    });

    const previewOpacityField = createCompactField({ type: "range", label: "GM Preview Opacity", controlClass: "form-range", min: 0, max: 1, step: 0.05 });
    const previewOpacityInput = previewOpacityField.querySelector("input");
    previewOpacityInput.value = Number.isFinite(layer.settings.fogPreviewOpacity) ? layer.settings.fogPreviewOpacity : 0.6;
    previewOpacityInput.addEventListener("change", () => {
      const value = Number(previewOpacityInput.value);
      if (!Number.isFinite(value)) return;
      applyLayerSettingsFieldChange("layer fog preview opacity", () => {
        layer.settings.fogPreviewOpacity = value;
      });
    });

    wrapper.appendChild(createFieldRow([playerOpacityField, previewOpacityField], { columns: 2 }));
  }
  return wrapper;
}

function applyLayerChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayers();
  renderSelection();
  renderLayerOverlays();
  renderJson();
}

function applyLayerSettingsChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderSelection();
  renderLayerOverlays();
  renderJson();
}

// Same reasoning as applyLayerPositionChange/createCommitOnBlurNumberField
// — used by buildLayerSettingField for every schema-driven setting (Grid
// Type, Cell Size, Line/Stroke/Fill color, Stroke Width, Image URL/Width/
// Height, Marker Size — none of which show/hide any OTHER field in this
// panel based on their own value, unlike Fog of War's own Reveal Group
// field, which still goes through applyLayerSettingsChange above for
// exactly that reason). Skipping renderSelection() here is what actually
// lets Tab move Name → Position X → Position Y → Grid Type → Cell Size
// without a mid-transition rebuild stealing focus at every stop along the
// way, not just the Position fields.
function applyLayerSettingsFieldChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayerOverlays();
  renderJson();
}

// Same reasoning as applyLayerSettingsFieldChange just above, for the
// Layer's own Name field — renderLayers() still runs (the left-hand layer
// list shows each layer's name), but renderSelection() doesn't, since
// nothing else in THIS panel depends on the name, and Name is the first
// stop in the Name → Position X → Position Y → Grid Type → Cell Size tab
// sequence, so a rebuild on committing it would derail every field after.
function applyLayerNameChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayers();
  renderJson();
}

function applyLayerPropertyChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayerOverlays();
  renderJson();
}

function applyGroupChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderGroups();
  renderSelection();
  renderLayerOverlays();
  renderJson();
}

function applyGroupPropertyChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayerOverlays();
  renderJson();
}

function applyViewChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderViewsList();
  renderSelection();
  renderJson();
}

function applyCellPropertiesChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderSelection();
  renderLayerOverlays();
  renderJson();
}

function applyCellPropertyFieldChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayerOverlays();
  renderJson();
}

function renderLayerSelectionEditor(layer) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  const nameField = createFormFloatingField({ type: "text", label: "Name" });
  const nameInput = nameField.querySelector("input");
  nameInput.value = layer.name;
  nameInput.addEventListener("change", () => {
    const value = nameInput.value.trim();
    if (!value) {
      nameInput.value = layer.name;
      return;
    }
    applyLayerNameChange("layer name", () => {
      layer.name = value;
    });
  });
  container.appendChild(nameField);

  const isMarkerLayer = layer.type === "marker";
  const isGridLayer = layer.type === "grid";

  // Every layer type keeps Position as its own row EXCEPT marker (folded
  // into its own condensed Size+Position row below).
  if (!isMarkerLayer) {
    container.appendChild(
      createFieldRow([buildLayerPositionField(layer, "x", "Position X"), buildLayerPositionField(layer, "y", "Position Y")], { columns: 2 })
    );
  }

  // Opacity stays its own row for raster layers only (nothing to pair it
  // with there) — every other layer type condenses it into a shared row
  // with Color (marker) / Line color (grid) / Fill color (vector) below
  // instead.
  if (layer.type === "raster") {
    container.appendChild(buildLayerOpacityField(layer));
  }

  const settingsSchema = LAYER_SETTINGS_SCHEMA[layer.type] || [];
  const schemaField = (key) => settingsSchema.find((field) => field.key === key);
  if (isMarkerLayer) {
    const sizeField = buildLayerSettingField(layer, schemaField("size"), { variant: "half" });
    container.appendChild(
      createFieldRow(
        [sizeField, buildLayerPositionField(layer, "x", "Position X"), buildLayerPositionField(layer, "y", "Position Y")],
        { columns: 3 }
      )
    );
    container.appendChild(buildMarkerIconField(layer));
    const colorField = buildLayerSettingField(layer, schemaField("color"), { variant: "compact" });
    container.appendChild(createFieldRow([colorField, buildLayerOpacityField(layer)], { columns: 2 }));
    const outlineColorField = buildLayerSettingField(layer, schemaField("outlineColor"), { variant: "compact" });
    const outlineWidthField = buildLayerSettingField(layer, schemaField("outlineWidth"), { variant: "half" });
    container.appendChild(createFieldRow([outlineColorField, outlineWidthField], { columns: 2 }));
    container.appendChild(buildMarkerLabelFields(layer));
  } else if (isGridLayer) {
    container.appendChild(buildLayerSettingField(layer, schemaField("gridType"), { variant: "floating" }));
    container.appendChild(buildLayerSettingField(layer, schemaField("cellSize"), { variant: "floating" }));
    const lineColorField = buildLayerSettingField(layer, schemaField("lineColor"), { variant: "compact" });
    container.appendChild(createFieldRow([lineColorField, buildLayerOpacityField(layer)], { columns: 2 }));
    container.appendChild(buildFogOfWarFields(layer));
  } else if (layer.type === "vector") {
    const fillColorField = buildLayerSettingField(layer, schemaField("fillColor"), { variant: "compact" });
    container.appendChild(createFieldRow([fillColorField, buildLayerOpacityField(layer)], { columns: 2 }));
    const outlineColorField = buildLayerSettingField(layer, schemaField("strokeColor"), { variant: "compact" });
    const outlineWidthField = buildLayerSettingField(layer, schemaField("strokeWidth"), { variant: "half" });
    container.appendChild(createFieldRow([outlineColorField, outlineWidthField], { columns: 2 }));
  } else if (layer.type === "raster") {
    container.appendChild(buildLayerSettingField(layer, schemaField("src"), { variant: "floating" }));
    const widthField = createDimensionField("Width", layer.settings?.width, (value) => {
      applyLayerSettingsFieldChange("layer width", () => {
        layer.settings = layer.settings || {};
        layer.settings.width = value;
      });
    }, { placeholder: "Native, 150%, or 800" });
    const heightField = createDimensionField("Height", layer.settings?.height, (value) => {
      applyLayerSettingsFieldChange("layer height", () => {
        layer.settings = layer.settings || {};
        layer.settings.height = value;
      });
    }, { placeholder: "Native, 150%, or 600" });
    container.appendChild(createFieldRow([widthField, heightField], { columns: 2 }));
  }

  const propertiesWrapper = document.createElement("div");
  propertiesWrapper.className = "d-flex flex-column gap-2";
  const entries = Object.entries(layer.properties || {});

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small text-body-secondary";
    empty.textContent = "No custom properties yet.";
    propertiesWrapper.appendChild(empty);
  } else {
    entries.forEach(([key, value]) => {
      propertiesWrapper.appendChild(createLayerPropertyRow(layer, key, value));
    });
  }

  const actionRow = document.createElement("div");
  actionRow.className = "btn-toolbar";
  actionRow.setAttribute("role", "toolbar");
  actionRow.setAttribute("aria-label", "Layer property actions");
  const actionGroup = document.createElement("div");
  actionGroup.className = "btn-group btn-group-sm";
  actionGroup.setAttribute("role", "group");

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  addButton.setAttribute("aria-label", "Add property");
  addButton.setAttribute("data-bs-toggle", "tooltip");
  addButton.setAttribute("data-bs-placement", "bottom");
  addButton.setAttribute("data-bs-title", "Add property");
  addButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:plus\" aria-hidden=\"true\"></span>";
  addButton.addEventListener("click", () => {
    const emptyState = propertiesWrapper.querySelector(".text-body-secondary");
    if (emptyState) {
      emptyState.remove();
    }
    const row = createLayerPropertyRow(layer, "", "");
    propertiesWrapper.appendChild(row);
    row.querySelector("[data-property-key]")?.focus();
    refreshTooltips();
  });

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  copyButton.setAttribute("aria-label", "Copy properties");
  copyButton.setAttribute("data-bs-toggle", "tooltip");
  copyButton.setAttribute("data-bs-placement", "bottom");
  copyButton.setAttribute("data-bs-title", "Copy properties");
  copyButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:copy\" aria-hidden=\"true\"></span>";
  copyButton.addEventListener("click", () => {
    state.propertyClipboard = JSON.parse(JSON.stringify(layer.properties || {}));
    renderSelection();
    status.show("Copied layer properties", { type: "info", timeout: 1200 });
  });

  const pasteButton = document.createElement("button");
  pasteButton.type = "button";
  pasteButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  pasteButton.setAttribute("aria-label", "Paste properties");
  pasteButton.setAttribute("data-bs-toggle", "tooltip");
  pasteButton.setAttribute("data-bs-placement", "bottom");
  pasteButton.setAttribute("data-bs-title", "Paste properties");
  pasteButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:clipboard\" aria-hidden=\"true\"></span>";
  pasteButton.addEventListener("click", () => {
    if (!state.propertyClipboard) {
      return;
    }
    applyLayerSettingsChange("paste layer properties", () => {
      layer.properties = JSON.parse(JSON.stringify(state.propertyClipboard));
    });
    status.show("Pasted layer properties", { type: "success", timeout: 1200 });
  });

  actionGroup.appendChild(addButton);
  actionGroup.appendChild(copyButton);
  actionGroup.appendChild(pasteButton);
  actionRow.appendChild(actionGroup);

  container.appendChild(
    createCollapsibleSection("Custom Properties", [actionRow, propertiesWrapper], { defaultCollapsed: entries.length === 0 })
  );
  // setDisabledTooltip (not a bare `.disabled = ...`) — pasteButton already
  // carries its own permanent "Paste properties" tooltip (set above); a real
  // `disabled` attribute would block that tooltip from ever showing (see
  // tooltips.js's own header), so the disabled-state explanation has to go
  // on setDisabledTooltip's own separate wrapper instead. Must run AFTER
  // the button is in its final DOM position (the appendChild calls above),
  // since the wrapper needs a real parent to insert into.
  setDisabledTooltip(pasteButton, state.propertyClipboard ? "" : "Nothing copied yet.");
  refreshTooltips();

  // Visible + reorder, together at the bottom — the same two controls the
  // left-pane layer list itself shows inline (the checkbox and the
  // up/down buttons), mirrored here since neither was represented in this
  // panel at all before. Visible is routed through the exact same
  // applyLayerChange the left-pane checkbox now also uses (see renderLayers'
  // own comment) so the two can never drift out of sync with each other.
  const bottomVisibilityField = createCheckField({ id: `layer-visible-${layer.id}`, label: "Visible", switchStyle: true });
  const bottomVisibilityInput = bottomVisibilityField.querySelector("input");
  bottomVisibilityInput.checked = layer.visible;
  bottomVisibilityInput.addEventListener("change", () => {
    applyLayerChange("layer visibility", () => {
      layer.visible = bottomVisibilityInput.checked;
    });
  });
  container.appendChild(bottomVisibilityField);

  // Independent of Visible — a locked layer keeps rendering (and, for a
  // looping Effect, keeps animating) exactly as before; it just stops
  // eating clicks/drags aimed at it (map-viewer.js's own renderMapLayers,
  // createLayer's own `locked` field comment has the motivating case: a
  // full-map Weather effect's own hit target sitting on top of every
  // marker/shape underneath it). Selecting THIS layer — including to flip
  // this switch back off — is never itself blocked by its own lock; only
  // clicking its contents on the map is.
  const lockedField = createCheckField({ id: `layer-locked-${layer.id}`, label: "Locked", switchStyle: true });
  const lockedInput = lockedField.querySelector("input");
  lockedInput.checked = Boolean(layer.locked);
  lockedInput.addEventListener("change", () => {
    applyLayerChange("layer locked", () => {
      layer.locked = lockedInput.checked;
    });
  });
  container.appendChild(lockedField);

  // Same icon-toolbar factory Press's own Component Inspector uses for
  // this exact "move up/down, duplicate, delete the selected thing" set —
  // mounted in the shared data-selection-toolbar-mount slot above the
  // editor fields (renderSelection() clears it before every render; only
  // this function, the one selection kind these four actions apply to,
  // repopulates it). `delete`'s onClick calls the shared
  // deleteCurrentSelection() (see its own comment near setSelection above)
  // rather than duplicating this logic inline — the global Delete/Backspace
  // keyboard shortcut calls the exact same function directly, not via any
  // DOM lookup, so data-action="delete-selected" here is just a marker for
  // humans reading the markup now, nothing functional depends on it.
  if (elements.selectionToolbar) {
    const layerIndex = state.map.layers.indexOf(layer);
    createToolbarButtonGroup([
      {
        action: "move-up",
        label: "Move layer up",
        icon: "tabler:arrow-up",
        disabled: layerIndex >= state.map.layers.length - 1,
        onClick: () => moveLayer(layer, 1),
      },
      {
        action: "move-down",
        label: "Move layer down",
        icon: "tabler:arrow-down",
        disabled: layerIndex <= 0,
        onClick: () => moveLayer(layer, -1),
      },
      {
        action: "duplicate",
        label: "Duplicate layer",
        onClick: () => {
          const copy = duplicateLayer(layer);
          recordHistory("duplicate layer", () => {
            state.map.layers.splice(layerIndex + 1, 0, copy);
            updateMapTimestamp(state.map);
          });
          setSelection("layer", copy.id);
          renderLayers();
          renderLayerOverlays();
          renderJson();
        },
      },
      {
        action: "delete",
        label: "Delete layer",
        attrs: { "data-action": "delete-selected" },
        onClick: () => deleteCurrentSelection(),
      },
    ]).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
}

function createPropertyRow({ key, value, onUpdate, onRemove }) {
  const row = document.createElement("div");
  row.className = "d-flex gap-2 align-items-center";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "form-control form-control-sm";
  keyInput.placeholder = "Key";
  keyInput.value = key;
  keyInput.dataset.propertyKey = "true";

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "form-control form-control-sm";
  valueInput.placeholder = "Value";
  valueInput.value = value;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center";
  removeButton.setAttribute("aria-label", "Remove property");
  removeButton.setAttribute("data-bs-toggle", "tooltip");
  removeButton.setAttribute("data-bs-placement", "bottom");
  removeButton.setAttribute("data-bs-title", "Remove property");
  removeButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:trash\" aria-hidden=\"true\"></span>";

  let currentKey = key;

  const updateProperty = () => {
    const nextKey = keyInput.value.trim();
    const nextValue = valueInput.value.trim();
    onUpdate?.({ currentKey, nextKey, nextValue });
    currentKey = nextKey;
  };

  keyInput.addEventListener("change", updateProperty);
  valueInput.addEventListener("change", updateProperty);
  removeButton.addEventListener("click", () => {
    onRemove?.({ currentKey });
  });

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(removeButton);
  return row;
}

function createLayerPropertyRow(layer, key, value) {
  return createPropertyRow({
    key,
    value,
    onUpdate: ({ currentKey, nextKey, nextValue }) => {
      applyLayerPropertyChange("layer property", () => {
        layer.properties = layer.properties || {};
        if (currentKey && currentKey !== nextKey) {
          delete layer.properties[currentKey];
        }
        if (nextKey) {
          layer.properties[nextKey] = nextValue;
        }
      });
    },
    onRemove: ({ currentKey }) => {
      applyLayerSettingsChange("remove layer property", () => {
        if (currentKey && layer.properties) {
          delete layer.properties[currentKey];
        }
      });
      renderSelection();
    },
  });
}

function createGridCellPropertyRow(layer, selectionCoords, key, value) {
  const row = document.createElement("div");
  row.className = "d-flex gap-2 align-items-center";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "form-control form-control-sm";
  keyInput.placeholder = "Key";
  keyInput.value = key;
  keyInput.dataset.propertyKey = "true";

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "form-control form-control-sm";
  valueInput.placeholder = "Value";
  valueInput.value = value;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center";
  removeButton.setAttribute("aria-label", "Remove property");
  removeButton.setAttribute("data-bs-toggle", "tooltip");
  removeButton.setAttribute("data-bs-placement", "bottom");
  removeButton.setAttribute("data-bs-title", "Remove property");
  removeButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:trash\" aria-hidden=\"true\"></span>";

  let currentKey = key;

  const applyToSelection = (apply) => {
    applyCellPropertiesChange("grid cell property", () => {
      selectionCoords.forEach((coord) => {
        const cell = ensureGridCell(layer, coord);
        apply(cell);
      });
    });
  };

  const updateProperty = () => {
    const nextKey = keyInput.value.trim();
    const nextValue = valueInput.value.trim();
    if (!nextKey && !currentKey) {
      return;
    }
    applyCellPropertyFieldChange("grid cell property", () => {
      selectionCoords.forEach((coord) => {
        const cell = ensureGridCell(layer, coord);
        cell.properties = cell.properties || {};
        if (currentKey && currentKey !== nextKey) {
          delete cell.properties[currentKey];
        }
        if (nextKey) {
          cell.properties[nextKey] = nextValue;
        }
      });
    });
    currentKey = nextKey;
  };

  keyInput.addEventListener("change", updateProperty);
  valueInput.addEventListener("change", updateProperty);
  removeButton.addEventListener("click", () => {
    applyToSelection((cell) => {
      if (currentKey && cell.properties) {
        delete cell.properties[currentKey];
      }
    });
    renderSelection();
  });

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(removeButton);
  return row;
}

// A marker's own target-kind whitelist for the References picker below —
// same restricted, alphabetized-by-label shape as the suite's own
// RELATIONSHIP_TARGET_KINDS (Forge/Crucible/Vault/Sanctum/Workbench's
// app.js each define one for the shared relationship-editor.js), not the
// full live Library kind registry: a marker only ever sensibly points at
// something with a physical presence on the map (or a Macro to trigger from
// it), not every authoring kind Loom manages (Template, System, Journal
// page, ...).
const MARKER_REFERENCE_KINDS = [
  { id: "character", label: "Character" },
  { id: "location", label: "Location" },
  { id: "macro", label: "Macro" },
  { id: "monster", label: "Monster" },
  { id: "npc", label: "NPC" },
  { id: "wonder", label: "Wonder" },
];

// A marker's own Vision Range can be Bound to a field on its linked
// Character record (see createMarkerElement's own header comment) —
// resolving a live Binding needs that record's real payload, which means a
// fetch, but resolveRevealedCells/renderMapLayers are all synchronous
// (called directly during DOM construction). Rather than making the whole
// render pipeline async, this is a small synchronous, cache-backed lookup
// (getCachedCharacterPayload) threaded through as a plain callback —
// map-viewer.js's own resolveMarkerVisionRangeCells never fetches anything
// itself, matching that module's own "everything caller-specific is a
// callback" architecture. `ensureCharacterPayloadCached` is fire-and-forget:
// call it during a render pass, it populates the cache and re-renders once
// the fetch resolves.
//
// This same cache also backs a Character marker's condition icons
// (resolveMarkerConditionIconsForMarker below) — unlike Vision Range's own
// original "fetch once, reselecting the marker or reloading the page is
// what picks up a change" tradeoff, a condition is expected to update
// automatically the moment it's added via Combat Tracker (the whole point
// of that feature) while the GM is still looking at the very same page.
// Confirmed real bug this fixes: a permanently-cached-forever payload never
// re-fetched at all once set, so a condition added after the marker's first
// render never appeared — even re-placing the marker didn't help, since
// this cache is keyed by the CHARACTER's own refId, not any particular
// marker instance. Re-fetches in the background once the cached copy is
// older than CHARACTER_PAYLOAD_STALE_MS, still returning the last-known
// value synchronously in the meantime (no flicker while the fresh copy is
// in flight) — cadence loosely matches watchMapForChanges' own ~10s map
// poll, so a GM sees a just-added condition within about one poll tick
// without needing to touch anything.
const CHARACTER_PAYLOAD_STALE_MS = 8000;
const characterPayloadCache = new Map();
const characterPayloadFetchedAt = new Map();
const pendingCharacterFetches = new Set();
function getCachedCharacterPayload(refId) {
  return characterPayloadCache.get(refId);
}
function ensureCharacterPayloadCached(refId, onLoaded) {
  if (!refId || !dataManager || pendingCharacterFetches.has(refId)) return;
  const fetchedAt = characterPayloadFetchedAt.get(refId) || 0;
  if (characterPayloadCache.has(refId) && Date.now() - fetchedAt < CHARACTER_PAYLOAD_STALE_MS) return;
  pendingCharacterFetches.add(refId);
  dataManager
    .get("character", refId, { preferLocal: false })
    .then((result) => {
      characterPayloadCache.set(refId, result?.payload || {});
      characterPayloadFetchedAt.set(refId, Date.now());
      pendingCharacterFetches.delete(refId);
      onLoaded?.();
    })
    .catch(() => {
      // See map.js's own ensureCharacterPayloadCached comment — stamping the
      // timestamp on failure too is what makes the staleness window apply to
      // a permanently-inaccessible/deleted reference, not just a successful
      // fetch, preventing a retry-every-render loop.
      characterPayloadFetchedAt.set(refId, Date.now());
      pendingCharacterFetches.delete(refId);
    });
}

// The GM-facing "@field" autocomplete list for a marker's own Vision Range
// Binding — walks refId's own linked Character -> its Template's own
// `.schema` field -> that System's own field tree (collectSystemFields),
// the same two-hop chain Workbench's character editor itself resolves a
// loaded character's System through (character.template -> template.schema
// -> system). Cached per Character refId (not recomputed every render) —
// empty (never an error) when any hop is missing/unresolvable, so the
// field just degrades to a plain literal-number/formula input with no
// suggestions, same graceful-degradation contract as the payload cache
// above.
const characterSystemFieldsCache = new Map();
const pendingCharacterSystemFieldsFetches = new Set();
function getCachedCharacterSystemFields(refId) {
  return characterSystemFieldsCache.get(refId) || [];
}

// Which System a Character resolves to (refId -> systemId), cached
// alongside characterSystemFieldsCache below by the same fetch — kept
// separate (rather than folded into that cache's own value shape) so
// getCachedCharacterSystemFields' existing callers (the Vision Range
// @-autocomplete) don't need to change what they get back.
const characterSystemIdCache = new Map();
function getCachedCharacterSystemId(refId) {
  return characterSystemIdCache.get(refId) || "";
}

// A System's own Conditions vocabulary, resolved to id -> {icon, color} and
// cached by systemId (not refId) — genuinely System-level, so this is
// fetched at most once regardless of how many characters/markers reference
// that System. icon/color live in each Condition value's own "Extra
// Properties" JSON (Loom's property-schema-editor.js), the same generic
// per-value catch-all resolveMonsterSizeCells already reads `sizeValue`
// through — no dedicated UI column for these. Also carries the resolved
// `tags`-role binding path (e.g. "@conditions") a Character's own live
// conditions array is read from — see map-viewer.js's own shared
// resolveMarkerConditionIcons, called via resolveMarkerConditionIconsForMarker
// below.
const systemConditionsCache = new Map();
function getCachedSystemConditions(systemId) {
  return systemConditionsCache.get(systemId) || null;
}
function buildSystemConditions(fields) {
  const bindings = deriveCombatBindings(fields);
  const tagsEntry = findBindingByRole(bindings, "tags");
  const vocabulary = deriveConditionsVocabulary(fields, bindings);
  const iconMap = new Map();
  if (vocabulary && tagsEntry) {
    const vocabularyKey = tagsEntry.sourceField || "conditions";
    const field = fields.find((entry) => entry.type === "array" && entry.key === vocabularyKey);
    (field?.values || []).forEach((raw, index) => {
      const entry = vocabulary[index];
      if (entry && raw && (raw.icon || raw.color)) {
        iconMap.set(entry.id, { icon: raw.icon || "", color: raw.color || "" });
      }
    });
  }
  return { iconMap, tagsBinding: tagsEntry?.binding || "" };
}

// Fetches a System's own `fields` directly (by systemId) and populates
// systemConditionsCache from it — ensureCharacterSystemFieldsCached below
// already has a System's fields in hand from its own Character->Template
// hop and populates this cache straight from that instead of calling this a
// second time; this is for a caller that only knows the systemId already,
// with no Character/Template hop of its own to reuse (Monster/NPC condition
// resolution, via the active Encounter's own systemId).
const pendingSystemConditionsFetches = new Set();
function ensureSystemConditionsCached(systemId, onLoaded) {
  if (!systemId || !dataManager) return;
  if (systemConditionsCache.has(systemId) || pendingSystemConditionsFetches.has(systemId)) return;
  pendingSystemConditionsFetches.add(systemId);
  (async () => {
    try {
      const systemResult = await dataManager.get("systems", systemId, { preferLocal: false });
      systemConditionsCache.set(systemId, buildSystemConditions(systemResult?.payload?.fields || []));
    } catch (error) {
      systemConditionsCache.set(systemId, { iconMap: new Map(), tagsBinding: "" });
    } finally {
      pendingSystemConditionsFetches.delete(systemId);
      onLoaded?.();
    }
  })();
}

function ensureCharacterSystemFieldsCached(refId, characterPayload, onLoaded) {
  if (!refId || !dataManager || !characterPayload) return;
  if (characterSystemFieldsCache.has(refId) || pendingCharacterSystemFieldsFetches.has(refId)) return;
  const templateId = characterPayload.template || "";
  if (!templateId) {
    characterSystemFieldsCache.set(refId, []);
    return;
  }
  pendingCharacterSystemFieldsFetches.add(refId);
  (async () => {
    try {
      // preferLocal: false on both fetches — a Template's own schema and a
      // System's own field tree are exactly the kind of content edited
      // directly in Workbench/Loom out from under whatever this browser
      // last cached; a stale local copy here would silently starve the
      // @-autocomplete of fields with no visible sign anything was wrong.
      const templateResult = await dataManager.get("templates", templateId, { preferLocal: false });
      const systemId = templateResult?.payload?.schema || "";
      if (!systemId) {
        characterSystemFieldsCache.set(refId, []);
        return;
      }
      characterSystemIdCache.set(refId, systemId);
      const systemResult = await dataManager.get("systems", systemId, { preferLocal: false });
      const fields = systemResult?.payload?.fields || [];
      characterSystemFieldsCache.set(refId, collectSystemFields(systemResult?.payload || {}));
      if (!systemConditionsCache.has(systemId)) {
        systemConditionsCache.set(systemId, buildSystemConditions(fields));
      }
    } catch (error) {
      characterSystemFieldsCache.set(refId, []);
    } finally {
      pendingCharacterSystemFieldsFetches.delete(refId);
      onLoaded?.();
    }
  })();
}

// The campaign's currently active/spotlighted Encounter, cached by groupId
// (a GM could switch active campaigns mid-session, so this isn't a single
// global slot) — map-viewer.js's own shared resolveMarkerConditionIcons
// reads a Monster/NPC combatant's own LIVE conditions from here, the only
// place they actually exist: Monster/NPC records are deliberately reusable
// templates, never
// mutated per-combat-instance (writeThroughToCharacter's own comment,
// combat-tracker.js — the same reason a marker can't just read a Monster's
// own record the way it reads a Character's). Fetched once per groupId,
// same "cache once, no live-poll" tradeoff getCachedCharacterPayload
// already accepts for Vision Range — a GM re-selecting the marker, or
// reloading the map, is what picks up a combat state change since. No
// active encounter, or a fetch failure, caches an empty combatants list
// rather than erroring — "not currently in combat" is a normal state, not
// a problem to surface.
// See CHARACTER_PAYLOAD_STALE_MS's own comment just above — a combatant's
// `conditions` here is exactly as live as a Character record's own, and was
// suffering the identical "cached forever, never actually re-fetched" bug
// before this staleness check existed.
const ACTIVE_ENCOUNTER_STALE_MS = 8000;
const activeEncounterCache = new Map();
const activeEncounterFetchedAt = new Map();
const pendingActiveEncounterFetches = new Set();
function getCachedActiveEncounter(groupId) {
  return activeEncounterCache.get(groupId) || null;
}
function ensureActiveEncounterCached(groupId, onLoaded) {
  if (!groupId || !dataManager || pendingActiveEncounterFetches.has(groupId)) return;
  const fetchedAt = activeEncounterFetchedAt.get(groupId) || 0;
  if (activeEncounterCache.has(groupId) && Date.now() - fetchedAt < ACTIVE_ENCOUNTER_STALE_MS) return;
  pendingActiveEncounterFetches.add(groupId);
  (async () => {
    try {
      const encounterId = await resolveActiveSpotlightId(dataManager, { groupId, kind: "encounter" });
      if (!encounterId) {
        activeEncounterCache.set(groupId, { systemId: "", combatants: [] });
        return;
      }
      const result = await dataManager.get("encounter", encounterId, { preferLocal: false });
      const payload = result?.payload || {};
      activeEncounterCache.set(groupId, {
        systemId: payload.systemId || "",
        combatants: Array.isArray(payload.combatants) ? payload.combatants : [],
      });
    } catch (error) {
      activeEncounterCache.set(groupId, { systemId: "", combatants: [] });
    } finally {
      activeEncounterFetchedAt.set(groupId, Date.now());
      pendingActiveEncounterFetches.delete(groupId);
      onLoaded?.();
    }
  })();
}

// Every combatant in the active encounter that shares this marker's own
// refKind/refId — the candidate set markerElement.linkedCombatantId (see
// map-model.js's own createMarkerElement) disambiguates between when there
// is more than one (three Goblins sharing one Monster record). Used by the
// "Linked Combatant" picker (renderMarkerElementSelectionEditor) to decide
// whether it has anything to show, and to populate its own options — a
// plain array filter, not the risky part of condition-icon resolution, so
// this stays a small local helper rather than living in map-viewer.js's own
// shared resolveMarkerConditionIcons alongside the icon-mapping logic that
// actually needed to be kept in sync between callers.
function findMatchingCombatants(markerElement, groupId) {
  const encounter = getCachedActiveEncounter(groupId);
  if (!encounter) return [];
  return encounter.combatants.filter(
    (combatant) => combatant.refKind === markerElement.refKind && combatant.refId === markerElement.refId
  );
}

// Thin wrapper around map-viewer.js's own shared resolveMarkerConditionIcons
// — Orrery only supplies its own cache-backed getters here (see this
// file's own caches just above); the actual resolution ALGORITHM (which
// path a Character vs. Monster/NPC marker takes, how a condition id maps to
// an icon) lives in that one shared place instead, so this file and the
// Dashboard's map.js widget — which keeps its own independent copies of
// these same caches, same "two cache instances, one shared algorithm"
// precedent resolveMarkerVisionRangeCells already establishes — can't
// quietly drift apart on what a marker's condition badges actually show.
function resolveMarkerConditionIconsForMarker(markerElement) {
  return resolveMarkerConditionIcons(markerElement, {
    getCharacterPayload: getCachedCharacterPayload,
    getCharacterSystemId: getCachedCharacterSystemId,
    getSystemConditions: getCachedSystemConditions,
    getActiveEncounter: () => {
      const groupId = getActiveCampaignGroupId();
      return groupId ? getCachedActiveEncounter(groupId) : null;
    },
  });
}

// A System's own `resource`-role combatBindings entries (name only — that's
// all guessBarResourceName and the Settings dropdown below actually need)
// — same "own cache, populated by a dedicated fetch, keyed by systemId"
// shape as systemConditionsCache just above, for the same reason: the
// Marker Resource Bar setting needs to know every candidate resource NAME a System
// offers before it can either guess a default or list Settings options,
// and that's a second, independent thing to know about a System's fields
// from the tags-role vocabulary systemConditionsCache already tracks.
const systemResourceBarConfigCache = new Map();
function getCachedSystemResourceBarConfig(systemId) {
  return systemResourceBarConfigCache.get(systemId) || null;
}
const pendingSystemResourceBarConfigFetches = new Set();
function ensureSystemResourceBarConfigCached(systemId, onLoaded) {
  if (!systemId || !dataManager) return;
  if (systemResourceBarConfigCache.has(systemId) || pendingSystemResourceBarConfigFetches.has(systemId)) return;
  pendingSystemResourceBarConfigFetches.add(systemId);
  (async () => {
    try {
      // preferLocal: false — same staleness reasoning as every other direct
      // System fields fetch in this file (ensureSystemConditionsCached,
      // ensureCharacterSystemFieldsCached, resolveMonsterSizeCells).
      const systemResult = await dataManager.get("systems", systemId, { preferLocal: false });
      const fields = Array.isArray(systemResult?.payload?.fields) ? systemResult.payload.fields : [];
      const resourceBindings = findBindingsByRole(deriveCombatBindings(fields), "resource");
      systemResourceBarConfigCache.set(systemId, { resourceNames: resourceBindings.map((entry) => entry.name).filter(Boolean) });
    } catch (error) {
      systemResourceBarConfigCache.set(systemId, { resourceNames: [] });
    } finally {
      pendingSystemResourceBarConfigFetches.delete(systemId);
      onLoaded?.();
    }
  })();
}

// Which named `resource`-role binding the Marker Resource Bar represents for a
// given System — per-System, per-browser, same storage shape Crucible's own
// combatScalingField/creatureTypeField preferences use (see that file's own
// getCrucibleSystemSettings comment for why one bucket per System, not a
// flat key, and why writes go through this pair of helpers rather than
// dataManager.saveLocal directly).
const ORRERY_SETTINGS_BUCKET = "orrery-settings";
function getOrrerySystemSettings(systemId) {
  if (!dataManager || !systemId) return {};
  return dataManager.getLocal(ORRERY_SETTINGS_BUCKET, systemId) || {};
}
function setOrrerySystemSetting(systemId, key, value) {
  if (!dataManager || !systemId) return;
  const next = { ...getOrrerySystemSettings(systemId), [key]: value };
  if (!next.barResourceName) {
    dataManager.removeLocal(ORRERY_SETTINGS_BUCKET, systemId);
  } else {
    dataManager.saveLocal(ORRERY_SETTINGS_BUCKET, systemId, next);
  }
}
function getBarResourceNamePreference(systemId) {
  return getOrrerySystemSettings(systemId).barResourceName || "";
}
function setBarResourceNamePreference(systemId, resourceName) {
  setOrrerySystemSetting(systemId, "barResourceName", resourceName || "");
}

// explicit preference || guessed default — see
// feedback_settings_preference_with_guessed_default. A System with only one
// `resource`-role binding (the common case — plain HP) never needs this to
// disagree with resolveCombatantStats' own "first resource is the primary"
// convention, since guessBarResourceName falls back to the first entry
// too; this only ever changes anything for a System with more than one
// (d20 Modern's Hit Points + Action Points, Daggerheart's Hope alongside
// HP, ...).
function resolveEffectiveBarResourceName(systemId) {
  if (!systemId) return "";
  const explicit = getBarResourceNamePreference(systemId);
  if (explicit) return explicit;
  const config = getCachedSystemResourceBarConfig(systemId);
  return config ? guessBarResourceName(config.resourceNames.map((name) => ({ name }))) : "";
}

// Thin wrapper around map-viewer.js's own shared resolveMarkerResourceBar — same
// "this file only supplies its own cache-backed getters, the actual
// resolution algorithm lives in the one shared place" shape
// resolveMarkerConditionIconsForMarker just above already uses, so Orrery
// and the Dashboard's map.js widget can't quietly drift apart on what a
// marker's Marker Resource Bar actually shows.
function resolveMarkerResourceBarForMarker(markerElement) {
  const groupId = getActiveCampaignGroupId();
  const encounter = groupId ? getCachedActiveEncounter(groupId) : null;
  if (!encounter?.systemId) return null;
  return resolveMarkerResourceBar(markerElement, encounter, resolveEffectiveBarResourceName(encounter.systemId));
}

// A Monster's own token footprint, read straight off its System's own
// "sizes" vocabulary (common/data/system/*.json's `sizes` array field) — no
// hardcoded size table here (see undercroft/README.md's own "avoid
// hardcoding" stance): a monster's `stats.size` ("Large") is matched against
// that System's `sizes[].name`, and whatever numeric `sizeValue` that size
// value carries (an ordinary "Extra properties" entry, same generic
// per-value catch-all Loom's Properties editor already exposes for any
// array field's values — see property-schema-editor.js's own
// collectValueRow) becomes the marker's sizeCells. A System with no
// `sizeValue` authored on its sizes yet (or a monster whose size doesn't
// match any of them) resolves to null — the caller leaves sizeCells
// untouched rather than guessing.
async function resolveMonsterSizeCells(monsterPayload) {
  const sizeName = monsterPayload?.stats?.size;
  const systemId = Array.isArray(monsterPayload?.systemIds) ? monsterPayload.systemIds[0] : "";
  if (!sizeName || !systemId || !dataManager) return null;
  try {
    // preferLocal: false — a System's own field vocabulary (sizes, in
    // particular) is exactly the kind of content that gets edited directly
    // in Loom out from under whatever this browser last cached; a stale
    // local copy here would silently resolve every size to null forever,
    // with no visible sign anything was wrong. Same reasoning as this
    // file's own ensureCharacterSystemFieldsCached just above.
    const systemResult = await dataManager.get("systems", systemId, { preferLocal: false });
    const fields = Array.isArray(systemResult?.payload?.fields) ? systemResult.payload.fields : [];
    const sizesField = fields.find((entry) => entry.type === "array" && entry.key === "sizes");
    const match = (sizesField?.values || []).find((entry) => entry.name === sizeName);
    const sizeValue = Number(match?.sizeValue);
    return Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : null;
  } catch (error) {
    return null;
  }
}

// A marker element optionally references a real Library entity of any kind
// — the {refKind, refId, label} shape the architecture plan settled on so
// Orrery maps can point at Sanctum Locations, Forge/Crucible NPCs and
// Monsters, Vault Effects, etc. without either tool needing to know about
// the other. Mirrors Sanctum's Assets/Needs "kind + entity" picker.
//
// This function is async (it awaits populateEntitySelect/refreshPreview
// before its final DOM appends), and a character-linked
// marker's own ensureCharacterPayloadCached/ensureCharacterSystemFieldsCached
// calls (below) each re-invoke renderSelection() — and therefore this whole
// function again — once their own fetch resolves. Without a staleness guard,
// two or three overlapping invocations each independently append their own
// Position X/Y row and toolbar Delete button once their awaits resolve,
// producing duplicates (confirmed bug: referencing a character produced
// three Position X/Y rows and two extra Delete buttons — one invocation per
// cache fetch). markerSelectionEditorRenderId lets only the most recent
// invocation's tail actually mutate the live container/toolbar.
// Resolves a "marker-elements" selection's own {layerId, id} pairs back
// into real {layer, markerElement} pairs — silently dropping any entry
// whose marker or layer no longer exists (deleted from underneath an
// open multi-selection by an undo, a remote map update, etc.), the same
// defensive-lookup shape the single-select branches above already use.
function resolveSelectedMarkerElements(selection) {
  return (selection.elements || [])
    .map((entry) => {
      const layer = state.map.layers.find((candidate) => candidate.id === entry.layerId);
      const markerElement = layer?.elements?.find((candidate) => candidate.id === entry.id);
      return layer && markerElement ? { layer, markerElement } : null;
    })
    .filter(Boolean);
}

// The bulk counterpart to renderMarkerElementSelectionEditor — deliberately
// lightweight: a read-only roster (label/image don't have one shared value
// across N different markers, so there's no per-field editor here the way
// the single-marker panel has) plus the shared selectionToolbar mount with
// whatever bulk actions apply to a group of markers (Delete, Move to Map).
function renderMarkerElementsSelectionEditor(resolved) {
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  const list = document.createElement("div");
  list.className = "d-flex flex-column gap-1";
  resolved.forEach(({ markerElement }) => {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2 small";
    const icon = document.createElement("span");
    icon.className = "iconify text-body-secondary flex-shrink-0";
    icon.dataset.icon = "tabler:map-pin";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "text-truncate";
    label.textContent = markerElement.label || markerElement.refKind || "Marker";
    row.append(icon, label);
    list.appendChild(row);
  });
  container.appendChild(list);

  if (elements.selectionToolbar) {
    const elementIds = resolved.map(({ markerElement }) => markerElement.id);
    // Aggregate, not per-marker: a mixed-state selection (some already
    // hidden, some not) reads as "visible" here — same tri-state
    // "select all" convention a checkbox header row uses — so the next
    // click always converges the WHOLE group to one state (hide
    // everything not already hidden) rather than leaving it mixed.
    // Clicking again once every selected marker IS hidden shows them
    // all. setElementsHiddenFromPlayers (shared with the single-marker
    // toggle below) takes that explicit target rather than flipping each
    // marker independently, which is exactly what makes this converge.
    const allHidden = resolved.length > 0 && resolved.every(({ markerElement }) => isElementHiddenFromPlayers(markerElement.id));
    const buttons = [
      {
        action: "toggle-hidden-from-players",
        label: allHidden ? "Hidden from players — click to show" : "Visible to players — click to hide",
        icon: allHidden ? "tabler:eye-off" : "tabler:eye",
        attrs: { "data-action": "toggle-hidden-from-players" },
        onClick: () => setElementsHiddenFromPlayers(elementIds, !allHidden),
      },
      {
        action: "delete",
        label: "Delete markers",
        attrs: { "data-action": "delete-selected" },
        onClick: () => deleteCurrentSelection(),
      },
    ];
    // Gated on currentUserHasFullMapAccess() specifically — a cross-map
    // write, unlike everything else this toolbar can do, so it gets its
    // own explicit check rather than relying on this panel only ever
    // being reachable by an owner/admin in the first place (see
    // openMoveMarkerModal's own header comment for the fuller reasoning).
    if (currentUserHasFullMapAccess()) {
      buttons.splice(1, 0, {
        action: "move-to-map",
        label: "Move to another map",
        icon: "tabler:map-share",
        attrs: { "data-action": "move-to-map" },
        onClick: () => openMoveMarkerModal(),
      });
    }
    createToolbarButtonGroup(buttons).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
}

let markerSelectionEditorRenderId = 0;
async function renderMarkerElementSelectionEditor(layer, markerElement) {
  if (!elements.selectionEditor) {
    return;
  }
  const renderId = ++markerSelectionEditorRenderId;
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  // Same shape as applyLayerChange/applyLayerSettingsChange: snapshot for
  // undo, then refresh the inspector (title/details reflect the new label
  // or reference), the overlay (dot tooltip), and the JSON preview.
  function applyMarkerElementChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderSelection();
    renderLayerOverlays();
    renderJson();
    // Icon/color, like a marker's own position, save themselves the instant
    // they're changed — see MARKER_AUTO_SAVE_FIELD_BY_LABEL's own comment.
    // Every other marker field this function handles (label, opacity, vision
    // range, overlay icons) stays on the regular batched Save flow.
    const autoSaveField = MARKER_AUTO_SAVE_FIELD_BY_LABEL[label];
    if (autoSaveField && mapExistsOnServer) {
      void persistElementUpdate({
        dataManager,
        mapId: state.map.id,
        shareToken: currentShareToken,
        layerId: layer.id,
        elementId: markerElement.id,
        patch: { [autoSaveField]: markerElement[autoSaveField] },
      })
        .then(() => mapWatcher?.noteLocalWrite())
        .catch((error) => {
          status?.show(error?.message || "Unable to save that change.", { type: "danger" });
        });
    }
  }

  const labelField = createFormFloatingField({ type: "text", label: "Label", placeholder: "Label" });
  const labelInput = labelField.querySelector("input");
  labelInput.value = markerElement.label || "";
  labelInput.addEventListener("change", () => {
    const value = labelInput.value.trim();
    applyMarkerElementChange("marker label", () => {
      markerElement.label = value;
    });
  });
  container.appendChild(labelField);

  // Multiplier on the grid's own cell size (createMarkerElement/
  // createMarkerDot) — 1 is a normal one-square token; a Large creature
  // (D&D 5e) is 2, Huge is 3, etc. `step: 1` moves the native up/down
  // spinner by a whole cell (what's most common — most tokens really are
  // whole-cell sizes), but a typed/committed value is never rounded — a
  // fractional token size is unusual but real (a Tiny creature sharing a
  // square, say), and rounding it away here would silently change the
  // marker just from blurring the field.
  const sizeField = createCommitOnBlurNumberField(
    "Size (cells)",
    Number.isFinite(markerElement.sizeCells) && markerElement.sizeCells > 0 ? markerElement.sizeCells : 1,
    (value) => {
      if (value === null) return;
      applyMarkerElementChange("marker size", () => {
        markerElement.sizeCells = Math.max(1, value);
      });
    },
    { min: 1, step: 1 }
  );

  // Off-the-ground offset (map-model.js's own createMarkerElement) — positive
  // is flying above the surface, negative is burrowing/submerged below it.
  // No `min` (unlike Size, which can't go below 1) — negative is a real,
  // meaningful value here, not an error. See createMarkerDot's own comment
  // for the two directions' distinct visual treatment (shadow vs. dashed
  // outline). Same decimal-friendly, step-1 shape as Size just above.
  const heightField = createCommitOnBlurNumberField(
    "Height (cells)",
    Number.isFinite(markerElement.heightCells) ? markerElement.heightCells : 0,
    (value) => {
      if (value === null) return;
      applyMarkerElementChange("marker height", () => {
        markerElement.heightCells = value;
      });
    },
    { step: 1 }
  );

  // Vision Range — Binding/Formula/Text, the same shared control (and the
  // same "no invisible defaults, starts as an immediately-usable literal"
  // convention) every other bindable field in this suite uses. Meaningful
  // only when refKind==="character" and the grid layer's own Auto-Reveal
  // toggle is on, but shown regardless — an inert field on a non-character
  // marker is harmless, matching how a wall's own doorState stays
  // harmlessly inert on a plain (non-door) wall. `@`-suggestions are
  // restricted to numeric fields on the linked Character's own System
  // (empty, not an error, when no character is linked or its System can't
  // be resolved).
  if (markerElement.refKind === "character" && markerElement.refId) {
    ensureCharacterPayloadCached(markerElement.refId, () => renderSelection());
    ensureCharacterSystemFieldsCached(markerElement.refId, getCachedCharacterPayload(markerElement.refId), () => renderSelection());
  }
  const visionRangeField = createBindingFormulaInput(markerElement, {
    labelText: "Vision Range (cells)",
    // Same compact "label above, form-control-sm" markup Size (its own
    // row-mate, right above) already uses — the field looked like two
    // different Bootstrap control conventions sitting side by side without
    // this.
    compact: true,
    placeholder: "0, @senses.darkvision, or =@senses.darkvision + 1",
    bindingKey: "visionRangeBinding",
    formulaKey: "visionRangeFormula",
    textKey: "visionRangeText",
    allowedFieldCategories: ["number"],
    systemFields: markerElement.refKind === "character" ? getCachedCharacterSystemFields(markerElement.refId) : [],
    hasSchemaSelected: Boolean(markerElement.refKind === "character" && markerElement.refId),
    // No helperText, and showEmptyFieldsHint off — a marker has no "select
    // a system" step of its own anywhere nearby (unlike Workbench's
    // template editor, where that hint's default wording makes sense), so
    // both the explicit helper text and the shared control's own auto
    // "Select a system to enable bindings." fallback read as out-of-place
    // noise here.
    showEmptyFieldsHint: false,
    // Deliberately NOT applyMarkerElementChange — createBindingFormulaInput
    // commits on every keystroke ("input", not blur/change — its own live
    // Preview line and @-autocomplete need to update as you type), and
    // applyMarkerElementChange's renderSelection() rebuilds this entire
    // editor's DOM, which would steal focus out of this very input on every
    // character typed. Same recordHistory+re-render shape, just without the
    // inspector-panel rebuild (this field's own value display is already
    // self-managing; the title/details text above doesn't depend on vision
    // range).
    onCommit: (mutator) => {
      recordHistory("marker vision range", () => {
        mutator(markerElement);
        updateMapTimestamp(state.map);
      });
      renderLayerOverlays();
      renderJson();
    },
  });
  container.appendChild(createFieldRow([sizeField, heightField, visionRangeField], { columns: 3 }));

  // Which clip createMarkerDot cuts the marker into — "circle" (the real,
  // concrete default, matches every marker placed before this field
  // existed) or "square", which fills the cell edge-to-edge with sharp
  // corners instead. Independent of Show outline just below: a square
  // token can still carry a border ring, a circular one can still go
  // borderless.
  const shapeField = createCompactField({
    type: "select",
    label: "Shape",
    controlClass: "form-select form-select-sm",
    options: [
      { value: "circle", label: "Circle" },
      { value: "square", label: "Square" },
    ],
  });
  const shapeSelect = shapeField.querySelector("select");
  shapeSelect.value = markerElement.shape === "square" ? "square" : "circle";
  shapeSelect.addEventListener("change", () => {
    applyMarkerElementChange("marker shape", () => {
      markerElement.shape = shapeSelect.value === "square" ? "square" : "circle";
    });
  });

  // Whether the marker's own outline ring renders at all (createMarkerDot's
  // border + its always-on box-shadow ring) — on by default so every
  // existing marker keeps its current look; the one case for turning it off
  // is an object token (a chest, say) that needs a clean, borderless
  // edge-to-edge fill rather than a circular ring around it.
  const showOutlineField = createCheckField({
    id: `marker-show-outline-${markerElement.id}`,
    label: "Show outline",
    switchStyle: true,
  });
  const showOutlineInput = showOutlineField.querySelector("input");
  showOutlineInput.checked = markerElement.showOutline !== false;
  showOutlineInput.addEventListener("change", () => {
    applyMarkerElementChange("marker show outline", () => {
      markerElement.showOutline = showOutlineInput.checked;
    });
  });
  container.appendChild(createFieldRow([shapeField, showOutlineField], { columns: 2 }));

  // Per-marker override of the layer's own outline color (createMarkerDot
  // reads markerElement.outlineColor first, falling back to the layer
  // default) — shows whichever's currently EFFECTIVE (this marker's own if
  // set, else the layer's), but always commits as this marker's own once
  // touched, same "copy once, stays user-editable after" shape image/label
  // already follow.
  const outlineColorField = createCompactField({
    type: "color",
    label: "Outline color",
    controlClass: "form-control form-control-color",
  });
  outlineColorField.querySelector("input").value = markerElement.outlineColor || layer.settings?.outlineColor || "#0f172a";
  outlineColorField.querySelector("input").addEventListener("change", (event) => {
    applyMarkerElementChange("marker outline color", () => {
      markerElement.outlineColor = event.target.value;
    });
  });

  // Same range-slider shape every other Opacity in this suite uses (0-1,
  // step 0.05, form-range) — see the shape/light editors' own identical
  // fields. Per-marker only, no layer-wide equivalent (createMarkerElement's
  // own comment) — a token fading in/out (unconscious, hidden, ...) is a
  // property of that one placed marker.
  const opacityField = createCompactField({ type: "range", label: "Opacity", controlClass: "form-range", min: 0, max: 1, step: 0.05 });
  const opacityInput = opacityField.querySelector("input");
  opacityInput.value = Number.isFinite(markerElement.opacity) ? markerElement.opacity : 1;
  opacityInput.addEventListener("change", () => {
    const value = Number(opacityInput.value);
    if (!Number.isFinite(value)) return;
    applyMarkerElementChange("marker opacity", () => {
      markerElement.opacity = value;
    });
  });

  container.appendChild(createFieldRow([outlineColorField, opacityField], { columns: 2 }));

  const referencesField = createFormFloatingField({ type: "select", label: "References" });
  const kindSelect = referencesField.querySelector("select");
  const noReferenceOption = document.createElement("option");
  noReferenceOption.value = "";
  noReferenceOption.textContent = "No reference";
  kindSelect.appendChild(noReferenceOption);
  container.appendChild(referencesField);

  const entityField = createFormFloatingField({ type: "select", label: "Entity" });
  const entitySelect = entityField.querySelector("select");
  entitySelect.disabled = true;
  container.appendChild(entityField);

  // Only meaningful for a journal-kind reference — matches
  // common/js/lib/widgets/handout.js's own picker exactly: Whole Page, or
  // one of the selected page's own headings/quests, so a marker can point
  // at a specific quest the same granularity a Handout can already show.
  // Hidden (not just disabled) whenever the kind isn't journal, same
  // "irrelevant field stays out of the way" convention every other
  // kind-specific field in this panel already follows.
  const anchorField = createFormFloatingField({ type: "select", label: "Show" });
  const anchorSelect = anchorField.querySelector("select");
  anchorField.classList.add("d-none");
  container.appendChild(anchorField);

  // Below Entity, not above — Image is very often auto-inherited FROM
  // whichever entity gets picked (entitySelect's own "change" handler,
  // below), so grouping it visually right after the picker it depends on
  // reads more naturally than before it.
  const imageField = createTokenImageField({
    label: "Image",
    value: markerElement.image || "",
    dataManager,
    status,
    onSelect: (url) => {
      applyMarkerElementChange("marker image", () => {
        markerElement.image = url;
      });
    },
  });
  container.appendChild(imageField);

  // Icon overlays (map-model.js's own createMarkerOverlayIcon, rendered by
  // map-viewer.js's own createMarkerDot) — purely visual, no mechanical
  // effect. Useful for any small indicator a GM wants to pin to a token
  // (a condition, a quest marker, a turn-order cue, anything) — not
  // conditions specifically, so nothing in this UI names them that. A
  // marker can carry several at once, each independently removable/
  // re-colorable. Picking an icon from the search field below adds it
  // immediately (a fresh entry, default badge color) — no separate confirm
  // step, matching how placing a marker/shape itself already has no
  // confirm step either; color is set AFTER adding, per-chip, rather than
  // as an upfront "choose a color, then pick an icon" two-step flow.
  // Placed below Image, near the bottom of the panel — it's the least
  // frequently touched marker field, so it doesn't need to sit above
  // fields edited far more often.
  //
  // labelClass matches createTokenImageField's own Image label exactly
  // ("form-label small text-body-secondary fw-semibold", overriding this
  // field's own default "form-label mb-0") — the two sit right next to
  // each other in this panel and should read as the same kind of label.
  const addOverlayIconField = createIconPickerField({
    label: "Icons",
    labelClass: "form-label small text-body-secondary fw-semibold",
    value: "",
    onSelect: (value) => {
      if (!value) return;
      applyMarkerElementChange("marker add icon", () => {
        markerElement.overlayIcons = [...(markerElement.overlayIcons || []), createMarkerOverlayIcon({ icon: value, label: value })];
      });
    },
  });
  container.appendChild(addOverlayIconField);

  // Scrollable (not just a plain flex-wrap row) so a marker stacking many
  // icons doesn't push Position X/Y and the toolbar further down the panel
  // every time one's added — and collapsible (createCollapsibleSection, the
  // same "Custom Properties" pattern used elsewhere in this file) since
  // most markers carry zero or few icons most of the time.
  const overlayIconsList = document.createElement("div");
  overlayIconsList.className = "orrery-marker-icons-list d-flex flex-wrap gap-2";
  if ((markerElement.overlayIcons || []).length) {
    markerElement.overlayIcons.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "d-inline-flex align-items-center gap-1 border rounded-pill ps-1 pe-1 py-1 small";
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = entry.color || "#1e293b";
      colorInput.className = "border-0 p-0";
      colorInput.style.width = "1.1rem";
      colorInput.style.height = "1.1rem";
      colorInput.setAttribute("aria-label", "Badge color");
      colorInput.addEventListener("change", (event) => {
        applyMarkerElementChange("marker icon color", () => {
          const target = (markerElement.overlayIcons || []).find((e) => e.id === entry.id);
          if (target) target.color = event.target.value;
        });
      });
      chip.appendChild(colorInput);
      const iconTokens = getIconTokens(entry.icon);
      if (iconTokens.length) {
        const icon = document.createElement("span");
        const bootstrapToken = iconTokens.find((token) => token.startsWith("bi-"));
        icon.className = bootstrapToken ? `bi ${bootstrapToken}` : iconTokens.join(" ");
        chip.appendChild(icon);
      }
      chip.appendChild(document.createTextNode(entry.label || entry.icon || "icon"));
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn-close";
      removeButton.style.fontSize = "0.5rem";
      removeButton.setAttribute("aria-label", "Remove icon");
      removeButton.setAttribute("data-bs-toggle", "tooltip");
      removeButton.setAttribute("data-bs-title", "Remove icon");
      removeButton.addEventListener("click", () => {
        applyMarkerElementChange("marker remove icon", () => {
          markerElement.overlayIcons = (markerElement.overlayIcons || []).filter((e) => e.id !== entry.id);
        });
      });
      chip.appendChild(removeButton);
      overlayIconsList.appendChild(chip);
    });
  } else {
    const emptyState = document.createElement("div");
    emptyState.className = "small text-body-secondary";
    emptyState.textContent = "No icons yet.";
    overlayIconsList.appendChild(emptyState);
  }
  const activeIconsSection = createCollapsibleSection("Active Icons", [overlayIconsList], {
    defaultCollapsed: !(markerElement.overlayIcons || []).length,
  });
  // createCollapsibleSection's own heading always uses "fs-6" (this
  // panel's normal section-heading size) — smaller here since "Active
  // Icons" is a lightweight, glance-only list, not a peer of the panel's
  // real named sections like Custom Properties. Below even .extra-small
  // (0.75rem, common/css/shell.css's own smallest text utility) — a plain
  // inline size since nothing in the shared utility scale goes smaller.
  const activeIconsHeading = activeIconsSection.querySelector(".fs-6");
  if (activeIconsHeading) {
    activeIconsHeading.classList.remove("fs-6");
    activeIconsHeading.style.fontSize = "0.7rem";
  }
  container.appendChild(activeIconsSection);

  async function refreshPreview() {
    if (!markerElement.refKind || !markerElement.refId || !dataManager) {
      return;
    }
    try {
      // preferLocal: false — this function's own whole point is picking up
      // a change to the referenced record made SINCE it was linked (its own
      // comment just below); a locally cached copy would defeat that the
      // same way loadMapById's own missing preferLocal:false once did.
      const result = await dataManager.get(markerElement.refKind, markerElement.refId, { preferLocal: false });
      // A marker linked before its reference had an image (e.g. a Character
      // imported before the DDB mapping picked up `image`, or re-imported
      // later to add one) never gets a second chance at the entitySelect
      // "change" handler's own inheritance below — that only fires once, at
      // link time. Every render of an already-linked marker re-checks here
      // too, so a referenced record gaining an image later is picked up the
      // next time this panel opens, without ever overwriting an image the
      // GM set (or intentionally cleared) by hand — same `!markerElement.image`
      // guard as the link-time path.
      if (!markerElement.image && result?.payload?.image) {
        applyMarkerElementChange("marker image", () => {
          markerElement.image = result.payload.image;
        });
      }
      // Same "every panel open re-checks, not just link time" reasoning as
      // image just above — a marker linked before Favorite Color existed
      // (or before the signed-in user had one saved) never gets a second
      // chance at the entitySelect "change" handler's own inheritance.
      if (!markerElement.outlineColor && dataManager.isAuthenticated?.()) {
        const settings = await dataManager.getUserSettings();
        if (typeof settings?.favoriteColor === "string" && settings.favoriteColor) {
          applyMarkerElementChange("marker outline color", () => {
            markerElement.outlineColor = settings.favoriteColor;
          });
        }
      }
    } catch (error) {
      // No preview box to report into anymore — a failed fetch here just
      // means this pass skips the image/outline inheritance checks above,
      // same as any other transient fetch failure elsewhere in this panel.
    }
  }

  // Kept across calls so updateAnchorSelect (below) can look up the
  // currently-selected journal entity's own body without a second fetch —
  // fetchKindEntriesWithIds' own {id, entity} entries already carry the
  // full payload, not just a summary.
  let entitySelectEntries = [];

  async function populateEntitySelect(kind, selectedId) {
    entitySelect.innerHTML = "";
    entitySelectEntries = [];
    if (!kind || !dataManager) {
      entitySelect.disabled = true;
      return;
    }
    entitySelect.disabled = false;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Select...";
    entitySelect.appendChild(blank);
    let entries = [];
    try {
      entries = await fetchKindEntriesWithIds(dataManager, kind);
    } catch (error) {
      entries = [];
    }
    entitySelectEntries = entries;
    // `.title` fallback — a journal page's own payload has no `.name` field
    // at all (its display field is `.title`), so this fell through straight
    // to the raw record id ("journal_4ai1dhb4...") for every journal
    // reference, both in the option label AND the sort order. Confirmed
    // real bug, not a naming preference.
    const displayName = (entry) => entry.entity?.name || entry.entity?.title || entry.id;
    entries
      .slice()
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = displayName(entry);
        entitySelect.appendChild(option);
      });
    if (selectedId && entries.some((entry) => entry.id === selectedId)) {
      entitySelect.value = selectedId;
    }
  }

  // Populates the "Show" select from whichever journal entity is currently
  // chosen — Whole Page plus every heading/quest on that page, same shape
  // handout.js's own picker builds. `savedAnchor` (only used the FIRST time
  // this panel opens for an already-linked marker) restores whatever anchor
  // was previously picked, once its own option actually exists in the list.
  function updateAnchorSelect(savedAnchor) {
    const isJournal = kindSelect.value === "journal";
    anchorField.classList.toggle("d-none", !isJournal);
    anchorSelect.innerHTML = "";
    anchorSelect.appendChild(new Option("Whole page", ""));
    if (!isJournal) return;
    const entry = entitySelectEntries.find((candidate) => candidate.id === entitySelect.value);
    const body = entry?.entity?.body || "";
    extractOutline(body).forEach((heading) => {
      anchorSelect.appendChild(new Option(`${"— ".repeat(heading.depth)}${heading.text}`, `heading:${heading.text}`));
    });
    extractQuests(body).forEach((quest) => {
      anchorSelect.appendChild(new Option(`Quest: ${quest.title}`, `quest:${quest.title}`));
    });
    if (savedAnchor?.type && savedAnchor?.value) {
      const savedValue = `${savedAnchor.type}:${savedAnchor.value}`;
      if (Array.from(anchorSelect.options).some((option) => option.value === savedValue)) {
        anchorSelect.value = savedValue;
      }
    }
  }

  // The label a specific anchor (heading/quest) would inherit — plain text,
  // no leading dashes/"Quest:" prefix (those are just the Show select's own
  // display formatting), since this feeds the marker's actual Label field.
  function anchorDisplayLabel(anchor) {
    return anchor?.value || "";
  }

  MARKER_REFERENCE_KINDS.forEach((kind) => {
    const option = document.createElement("option");
    option.value = kind.id;
    option.textContent = kind.label;
    kindSelect.appendChild(option);
  });
  kindSelect.value = markerElement.refKind || "";
  await populateEntitySelect(markerElement.refKind, markerElement.refId);
  updateAnchorSelect(markerElement.refAnchor);
  // Baseline for the anchor AND entity handlers' own "still looks
  // auto-inherited, safe to refine further" checks below — whatever the
  // label would currently read as from the MOST specific thing already
  // selected (the anchor if one's picked, otherwise the entity's own
  // name). lastAutoImage is the same idea for Image — whatever's
  // currently set is treated as "still looks auto" until a GM picks
  // something that doesn't match it (a manual upload, say). Both
  // recomputed fresh on every render, since a kind/entity change tears
  // this whole panel down and rebuilds it (see kindSelect/entitySelect's
  // own change handlers) — so the entity handler below never needs to
  // update these itself, the next render already will.
  let lastAutoLabel = markerElement.refAnchor
    ? anchorDisplayLabel(markerElement.refAnchor)
    : entitySelect.selectedOptions[0]?.textContent || "";
  let lastAutoImage = markerElement.image || "";
  await refreshPreview();

  // A newer invocation (triggered by one of the character-data cache
  // fetches above resolving, or by a fresh selection change) already
  // cleared and rebuilt the container while this one was awaiting — bail
  // out rather than appending this stale invocation's own Position X/Y row
  // and toolbar Delete button on top of the current one's.
  if (renderId !== markerSelectionEditorRenderId) {
    return;
  }

  // Both handlers call renderSelection() (via applyMarkerElementChange)
  // rather than manually re-running populateEntitySelect/refreshPreview —
  // renderSelection() re-invokes this whole function fresh, which already
  // does exactly that at the top using the just-updated refKind/refId. Safe
  // to tear this DOM down here (unlike the marker-drag case): a plain
  // <select> "change" event has no pointer capture depending on the element
  // surviving the handler.
  kindSelect.addEventListener("change", () => {
    const kind = kindSelect.value;
    applyMarkerElementChange("marker reference kind", () => {
      markerElement.refKind = kind;
      markerElement.refId = "";
      markerElement.refAnchor = null;
      // label/image are "copy once at pick-time, stays user-editable after"
      // (see entitySelect's own change handler just below) — once set, a
      // LATER entity pick never overwrites them again, which is correct
      // within the same kind but left a stale Character's own portrait/name
      // permanently attached to a marker after switching its reference kind
      // to something else entirely (a Journal Page, say) — confirmed real
      // bug, not by design. A kind change means whatever was inherited from
      // the OLD kind's own entity no longer applies, so both reset here,
      // clearing the way for the new kind's own entity pick to inherit
      // fresh. outlineColor is deliberately NOT reset — it's inherited from
      // the signed-in user's own Favorite Color account setting, not from
      // the referenced entity, so it stays valid regardless of what kind
      // this marker points at.
      markerElement.label = "";
      markerElement.image = "";
    });
  });

  entitySelect.addEventListener("change", () => {
    const refId = entitySelect.value;
    const option = entitySelect.selectedOptions[0];
    const kind = kindSelect.value;
    // Image inheritance and a Monster's own auto-sized footprint both need
    // the full record payload (unlike label, which reads straight off the
    // <option> text) — fetch it once here, before applyMarkerElementChange's
    // renderSelection() tears this whole editor down and rebuilds it, rather
    // than re-fetching inside refreshPreview on every render (which would
    // re-trigger the auto-fill and a spurious undo entry each time the panel
    // simply redraws).
    (async () => {
      let inheritedImage = "";
      // A Monster's own size (auto-fill below) needs the full payload too —
      // fetched here regardless of whether an image is already set, unlike
      // the image-only condition this used to be, so a monster pick always
      // resolves its footprint even on a marker that already has a custom
      // image.
      let payload = null;
      const imageLooksAutoInherited = !markerElement.image || markerElement.image === lastAutoImage;
      if (refId && kind && dataManager && (imageLooksAutoInherited || kind === "monster")) {
        try {
          // preferLocal: false — a Monster's own size (or image) is exactly
          // the kind of content edited directly in Loom/Crucible out from
          // under whatever this browser last cached; same reasoning as
          // resolveMonsterSizeCells' own systems fetch just below.
          const result = await dataManager.get(kind, refId, { preferLocal: false });
          payload = result?.payload || null;
        } catch (error) {
          payload = null;
        }
      }
      if (imageLooksAutoInherited) {
        inheritedImage = payload?.image || "";
      }
      // Re-resolved on every Monster pick (not gated behind a "still looks
      // untouched" check the way image/label/outlineColor are just below) —
      // sizeCells always defaults to a real number (createMarkerElement's
      // own `sizeCells = 1`), so there's no empty-string-style sentinel to
      // tell "never touched" apart from "a GM deliberately set this Large
      // creature's own token to 1". Picking a monster is itself the
      // deliberate action that should set its footprint; a GM who then wants
      // a non-standard size still edits the Size field afterward exactly as
      // before, same as always.
      let inheritedSizeCells = null;
      if (kind === "monster" && payload) {
        inheritedSizeCells = await resolveMonsterSizeCells(payload);
      }
      // Doesn't verify THIS specific record belongs to the signed-in user
      // (that needs a dedicated ownership lookup — dataManager.get's own
      // payload carries no owner info, only a full kind-wide list() call
      // does) — simplified to "whoever's linking an entity, while signed
      // in, hasn't set an outline yet" instead, same "copy once, stays
      // user-editable after" precedent as image/label just above.
      let inheritedOutlineColor = "";
      if (!markerElement.outlineColor && refId && dataManager?.isAuthenticated?.()) {
        try {
          const settings = await dataManager.getUserSettings();
          inheritedOutlineColor = typeof settings?.favoriteColor === "string" ? settings.favoriteColor : "";
        } catch (error) {
          inheritedOutlineColor = "";
        }
      }
      applyMarkerElementChange("marker reference entity", () => {
        markerElement.refId = refId;
        // A different entity (even the same kind) has its own headings/
        // quests — whatever anchor was picked for the PREVIOUS one almost
        // certainly doesn't mean the same thing (or exist at all) here.
        markerElement.refAnchor = null;
        // "Still looks auto-inherited, safe to refine further" — same
        // lastAutoLabel/lastAutoImage check the anchor handler below
        // already uses, not just a blank check. A blank-only check
        // (the original shape here) only ever populated Label/Image on
        // a marker's very FIRST entity pick — switching an
        // already-linked marker to a DIFFERENT entity left the prior
        // entity's own name/portrait stuck, since neither field was
        // blank anymore. Confirmed real bug, not by design — the
        // deliberate "copy once, stays user-editable" protection this
        // was built on only needs to block overwriting a GM's own
        // hand-typed label or hand-picked image, which lastAutoLabel/
        // lastAutoImage already distinguish from "still exactly what
        // the last entity pick set."
        if ((!markerElement.label || markerElement.label === lastAutoLabel) && option && option.value) {
          markerElement.label = option.textContent;
        }
        if (imageLooksAutoInherited && inheritedImage) {
          markerElement.image = inheritedImage;
        }
        if (!markerElement.outlineColor && inheritedOutlineColor) {
          markerElement.outlineColor = inheritedOutlineColor;
        }
        if (inheritedSizeCells !== null) {
          markerElement.sizeCells = Math.max(1, Math.round(inheritedSizeCells));
        }
      });
    })();
  });

  anchorSelect.addEventListener("change", () => {
    const value = anchorSelect.value;
    let anchor = null;
    if (value) {
      const separatorIndex = value.indexOf(":");
      anchor = { type: value.slice(0, separatorIndex), value: value.slice(separatorIndex + 1) };
    }
    // The label should follow the MOST specific thing selected — picking a
    // heading/quest within a Journal Page is more specific than the page
    // itself, so it becomes the new label the same way picking the entity
    // itself already does. Only when the current label still looks
    // auto-inherited (matches lastAutoLabel, computed above from whatever
    // was most-specific BEFORE this change) — a label the GM typed in by
    // hand is never overwritten.
    const nextAutoLabel = anchor ? anchorDisplayLabel(anchor) : entitySelect.selectedOptions[0]?.textContent || "";
    applyMarkerElementChange("marker reference anchor", () => {
      markerElement.refAnchor = anchor;
      if (nextAutoLabel && (!markerElement.label || markerElement.label === lastAutoLabel)) {
        markerElement.label = nextAutoLabel;
      }
    });
  });

  // Deliberately NOT applyMarkerElementChange — same reasoning as Layer's
  // own applyLayerPositionChange (see createCommitOnBlurNumberField's
  // comment): nothing else in this panel depends on the marker's position,
  // so renderSelection() rebuilding it mid-edit only risked destroying the
  // focused input for no benefit.
  function applyMarkerPositionChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
  }
  // Reads/wrote markerElement.position.x/.y directly before this — correct
  // for an image/canvas map (where position genuinely IS {x,y}) but always
  // silently 0 for a tile map, whose position is {lat,lng} instead (.x/.y
  // are just undefined on that shape). Confirmed as the actual cause of
  // "I'd expect an initial position, not zero, for all Markers": every
  // marker on a tile map showed 0/0 here regardless of where it actually
  // was. Same markerPositionToLocalPixel/localPixelToMarkerPosition
  // round-trip the shape origin's own Position X/Y already uses fixes it
  // for both map types uniformly — "pixels from the map's own center,"
  // not the raw stored shape.
  const markerOriginPixel = markerPositionToLocalPixel(baseMapManager, state.map, markerElement.position);
  function updateMarkerPosition(axis, value) {
    if (value === null) {
      return;
    }
    applyMarkerPositionChange(`marker position ${axis}`, () => {
      const next = markerPositionToLocalPixel(baseMapManager, state.map, markerElement.position);
      next[axis] = value;
      markerElement.position = localPixelToMarkerPosition(baseMapManager, state.map, next);
    });
  }
  container.appendChild(
    createFieldRow(
      [
        createCommitOnBlurNumberField("Position X", Math.round(markerOriginPixel.x), (value) => updateMarkerPosition("x", value)),
        createCommitOnBlurNumberField("Position Y", Math.round(markerOriginPixel.y), (value) => updateMarkerPosition("y", value)),
      ],
      { columns: 2 }
    )
  );

  // "Linked Combatant" — only relevant, and only shown, when there's a real
  // ambiguity to resolve: more than one combatant in the campaign's active
  // Encounter shares this marker's own refKind/refId (e.g. three Goblins
  // sharing one Monster record — see map-model.js's own linkedCombatantId
  // comment for why Monster/NPC records can't just answer "which one's
  // conditions" the way a Character's own record can). Absent entirely
  // outside combat, or when there's zero or exactly one match — the common
  // case resolves automatically with no picker at all.
  if (markerElement.refKind === "monster" || markerElement.refKind === "npc") {
    const groupId = getActiveCampaignGroupId();
    if (groupId) {
      ensureActiveEncounterCached(groupId, () => renderSelection());
      const activeEncounter = getCachedActiveEncounter(groupId);
      if (activeEncounter?.systemId) {
        ensureSystemConditionsCached(activeEncounter.systemId, () => renderSelection());
      }
      const matchingCombatants = findMatchingCombatants(markerElement, groupId);
      if (matchingCombatants.length > 1) {
        const combatantField = createFormFloatingField({ type: "select", label: "Linked Combatant" });
        const combatantSelect = combatantField.querySelector("select");
        const autoOption = document.createElement("option");
        autoOption.value = "";
        autoOption.textContent = "(ambiguous — pick one)";
        combatantSelect.appendChild(autoOption);
        matchingCombatants.forEach((combatant) => {
          const option = document.createElement("option");
          option.value = combatant.id;
          option.textContent = combatant.name || combatant.id;
          combatantSelect.appendChild(option);
        });
        combatantSelect.value = matchingCombatants.some((entry) => entry.id === markerElement.linkedCombatantId)
          ? markerElement.linkedCombatantId
          : "";
        combatantSelect.addEventListener("change", () => {
          applyMarkerElementChange("marker linked combatant", () => {
            markerElement.linkedCombatantId = combatantSelect.value;
          });
        });
        container.appendChild(combatantField);
      }
    }
  }

  // Contents — createMarkerContentEntry (map-model.js) items a player can
  // later claim into their own Character inventory or the campaign's
  // shared Party Inventory (see marker-contents.js's own header for the
  // full claim mechanism). Any marker can carry this — a plain token, an
  // NPC, a Monster, a Wonder-referencing marker — same layered-capability
  // relationship Light/Shape already have with attachedMarkerId, not a
  // separate "Container" marker type.
  const contentsList = document.createElement("div");
  contentsList.className = "d-flex flex-column gap-2";
  function renderContentsList() {
    contentsList.innerHTML = "";
    const contents = markerElement.contents || [];
    if (!contents.length) {
      const emptyState = document.createElement("div");
      emptyState.className = "small text-body-secondary";
      emptyState.textContent = "No contents yet.";
      contentsList.appendChild(emptyState);
      return;
    }
    contents.forEach((entry) => {
      const description = [
        entry.kind === "wonder" ? "Wonder" : entry.kind === "currency" ? "Currency" : "",
        entry.notes || "",
      ]
        .filter(Boolean)
        .join(" · ");
      const row = createListRow({
        title: describeMarkerContentEntry(entry) || "Unnamed item",
        description,
        removeLabel: "Remove from contents",
        onRemove: () => {
          applyMarkerElementChange("marker remove content", () => {
            markerElement.contents = (markerElement.contents || []).filter((item) => item.id !== entry.id);
          });
        },
      });
      contentsList.appendChild(row);

      // "Give to" — the GM delivering an entry directly to a specific
      // player's Character (or the Party), without that player needing to
      // be present to claim it themselves. Not every player has a
      // dashboard open, and the GM should always be able to complete this
      // regardless — same claimMarkerContentEntry the player-facing Claim
      // button (openRestrictedMarkerLinkPopover above) calls, just with an
      // explicit recipient instead of "whoever's clicking." A REAL
      // transaction (server round-trip, actual currency/inventory
      // delivery, Group Log entry) — deliberately NOT routed through
      // applyMarkerElementChange/recordHistory's own local-edit-with-undo
      // path, matching that the player-facing Claim button has no undo
      // either.
      const giveToSelect = document.createElement("select");
      giveToSelect.className = "form-select form-select-sm mt-1";
      giveToSelect.setAttribute("aria-label", `Give ${describeMarkerContentEntry(entry) || "item"} to`);
      const placeholderOption = document.createElement("option");
      placeholderOption.value = "";
      placeholderOption.textContent = "Give to…";
      giveToSelect.appendChild(placeholderOption);
      const partyOption = document.createElement("option");
      partyOption.value = "party";
      partyOption.textContent = "The Party";
      giveToSelect.appendChild(partyOption);
      loadGiveToRoster().then((roster) => {
        roster.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.characterId;
          opt.textContent = option.label;
          giveToSelect.appendChild(opt);
        });
      });
      giveToSelect.addEventListener("change", async () => {
        const value = giveToSelect.value;
        if (!value) return;
        giveToSelect.disabled = true;
        try {
          const groupId = getActiveCampaignGroupId();
          const roster = await loadGiveToRoster();
          const recipient =
            value === "party"
              ? { type: "party" }
              : { type: "character", characterId: value, label: roster.find((option) => option.characterId === value)?.label || value };
          const result = await claimMarkerContentEntry({
            dataManager,
            groupId,
            shareToken: currentShareToken,
            mapId: state.map.id,
            layerId: layer.id,
            elementId: markerElement.id,
            contentId: entry.id,
            recipient,
          });
          if (!result) {
            status?.show("That's already been claimed.", { type: "info", timeout: 2500 });
            return;
          }
          markerElement.contents = (markerElement.contents || []).filter((item) => item.id !== entry.id);
          renderContentsList();
          status?.show(`Gave ${result.label} to ${result.destinationLabel}.`, { type: "success", timeout: 2500 });
        } catch (error) {
          status?.show(error?.message || "Unable to give that item.", { type: "error", timeout: 4000 });
          giveToSelect.disabled = false;
          giveToSelect.value = "";
        }
      });
      row.appendChild(giveToSelect);
    });
  }
  // One shared roster fetch for the whole Contents panel (not one per
  // entry) — cached for the lifetime of this render, same reasoning
  // resolveGiveToOptions' own header comment gives for keeping roster
  // lookups infrequent.
  let giveToRosterPromise = null;
  function loadGiveToRoster() {
    if (!giveToRosterPromise) {
      const groupId = getActiveCampaignGroupId();
      giveToRosterPromise = groupId ? resolveGiveToOptions(dataManager, groupId, currentShareToken).catch(() => []) : Promise.resolve([]);
    }
    return giveToRosterPromise;
  }
  renderContentsList();

  const addItemNameInput = document.createElement("input");
  addItemNameInput.type = "text";
  addItemNameInput.className = "form-control form-control-sm";
  addItemNameInput.placeholder = "Item name";
  const addItemQuantityInput = document.createElement("input");
  addItemQuantityInput.type = "number";
  addItemQuantityInput.className = "form-control form-control-sm";
  addItemQuantityInput.min = "1";
  addItemQuantityInput.value = "1";
  addItemQuantityInput.style.width = "4.5rem";
  addItemQuantityInput.setAttribute("aria-label", "Quantity");
  const addItemButton = createIconButton({
    icon: "tabler:plus",
    label: "Add item to contents",
    onClick: () => {
      const name = addItemNameInput.value.trim();
      if (!name) return;
      const quantity = Number(addItemQuantityInput.value) || 1;
      applyMarkerElementChange("marker add content", () => {
        markerElement.contents = [...(markerElement.contents || []), createMarkerContentEntry({ kind: "item", name, quantity })];
      });
    },
  });
  const addItemRow = document.createElement("div");
  addItemRow.className = "d-flex gap-2 align-items-center";
  addItemRow.append(addItemNameInput, addItemQuantityInput, addItemButton);

  // Picks an existing Vault Wonder record instead of typing a freeform
  // name — openContentPicker (content-picker.js) is the suite's real
  // shared "pick one record of a kind" component (already used by
  // relationship-editor.js/dashboard.js/repository/js/app.js), lazily
  // fetching summaries rather than eagerly preloading every Wonder up
  // front, which matters once that kind is in the thousands.
  const addWonderButton = createIconButton({
    icon: "tabler:wand",
    label: "Add a Wonder to contents",
    onClick: async () => {
      if (!dataManager) return;
      const id = await openContentPicker({ dataManager, kind: "wonder", title: "Choose a Wonder" });
      if (!id) return;
      let name = id;
      try {
        const result = await dataManager.get("wonder", id, { preferLocal: true });
        name = result?.payload?.name || id;
      } catch (error) {
        // Falls back to the raw id as the display name — still a valid,
        // if less friendly, entry; editable afterward like any other.
      }
      applyMarkerElementChange("marker add content", () => {
        markerElement.contents = [...(markerElement.contents || []), createMarkerContentEntry({ kind: "wonder", name, refId: id })];
      });
    },
  });

  // System-defined currency, resolved fresh against whichever campaign is
  // currently active — never a hardcoded denomination vocabulary (5e's own
  // cp/sp/ep/gp/pp is just one System's choice among many; a different
  // System defines its own currency field entirely, or none at all — same
  // reasoning inventory-weight.js's own extractCurrencyWeight already
  // follows for reading it). No "Add Currency" row at all for a System
  // with no currency field of its own — same "no error/hidden state for an
  // inapplicable field" precedent a wall's own doorState already follows,
  // rather than showing a picker with nothing real to pick from.
  let currencyDenominations = [];
  try {
    const groupContext = await resolveGroupContext(dataManager).catch(() => null);
    if (groupContext?.systemId) {
      const systemResult = await dataManager.get("system", groupContext.systemId, { preferLocal: true }).catch(() => null);
      const fields = Array.isArray(systemResult?.payload?.fields) ? systemResult.payload.fields : [];
      const currencyField = fields.find((field) => field?.type === "array" && field.key === "currency");
      currencyDenominations = Array.isArray(currencyField?.values) ? currencyField.values : [];
    }
  } catch (error) {
    currencyDenominations = [];
  }
  let addCurrencyRow = null;
  if (currencyDenominations.length) {
    const currencyDenominationSelect = document.createElement("select");
    currencyDenominationSelect.className = "form-select form-select-sm";
    currencyDenominations.forEach((denomination) => {
      const option = document.createElement("option");
      option.value = denomination.shortName;
      option.textContent = denomination.name || denomination.shortName;
      currencyDenominationSelect.appendChild(option);
    });
    const currencyAmountInput = document.createElement("input");
    currencyAmountInput.type = "number";
    currencyAmountInput.className = "form-control form-control-sm";
    currencyAmountInput.min = "1";
    currencyAmountInput.value = "1";
    currencyAmountInput.style.width = "5rem";
    currencyAmountInput.setAttribute("aria-label", "Amount");
    const addCurrencyButton = createIconButton({
      icon: "tabler:coin",
      label: "Add currency to contents",
      onClick: () => {
        const amount = Number(currencyAmountInput.value) || 0;
        if (amount <= 0) return;
        const denomination = currencyDenominations.find((entry) => entry.shortName === currencyDenominationSelect.value);
        if (!denomination) return;
        applyMarkerElementChange("marker add content", () => {
          markerElement.contents = [
            ...(markerElement.contents || []),
            createMarkerContentEntry({
              kind: "currency",
              name: denomination.name || denomination.shortName,
              quantity: amount,
              denomination: denomination.shortName,
            }),
          ];
        });
      },
    });
    addCurrencyRow = document.createElement("div");
    addCurrencyRow.className = "d-flex gap-2 align-items-center";
    addCurrencyRow.append(currencyDenominationSelect, currencyAmountInput, addCurrencyButton);
  }

  const claimTargetField = createFormFloatingField({ type: "select", label: "Claim Target" });
  const claimTargetSelect = claimTargetField.querySelector("select");
  [
    { value: "character", label: "Character (clicking player's own)" },
    { value: "party", label: "Party Inventory (shared)" },
  ].forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    claimTargetSelect.appendChild(option);
  });
  claimTargetSelect.value = markerElement.claimTarget === "party" ? "party" : "character";
  claimTargetSelect.addEventListener("change", () => {
    applyMarkerElementChange("marker claim target", () => {
      markerElement.claimTarget = claimTargetSelect.value === "party" ? "party" : "character";
    });
  });

  // The object-arg createCollapsibleSection (imported as
  // createFullCollapsibleSection — see this file's own import comment),
  // not the positional one "Active Icons" above uses — this is the variant
  // whose own header row places the help icon directly beside the "Contents"
  // label itself, rather than as a separate line inside the body.
  const contentsBody = document.createElement("div");
  contentsBody.className = "d-flex flex-column gap-2";
  contentsBody.append(contentsList, addItemRow, addWonderButton, ...(addCurrencyRow ? [addCurrencyRow] : []), claimTargetField);
  const contentsSection = createFullCollapsibleSection({
    label: "Contents",
    helpTopic: "orrery.markerContents",
    collapsed: !(markerElement.contents || []).length,
    content: contentsBody,
  }).section;
  container.appendChild(contentsSection);
  initHelpSystem({ root: contentsSection });

  // Same shared icon-toolbar mount every other selection kind (wall, shape,
  // light) already uses, not a standalone inline button — renderSelection()
  // clears data-selection-toolbar-mount before every render, so only
  // whichever selection kind is current populates it.
  if (elements.selectionToolbar) {
    // A shortcut, not a second visibility mechanism of its own — flips this
    // one marker's id in/out of the auto-managed "Player View" (see
    // toggleElementHiddenFromPlayers's own comment). The View editor's own
    // Visible Components checklist (renderViewSelectionEditor) is the same
    // underlying state, just viewed/edited a whole-View-at-a-time instead of
    // one marker at a time — the two always agree. Same eye/eye-off toggle
    // button convention Combat Tracker's own per-combatant "visible to
    // players" switch uses (constant outline-secondary styling, only the
    // icon/tooltip change — see that file's own visibleButton/
    // toggleSelectedHidden) rather than the checkbox this replaced, so a
    // hidden marker reads identically regardless of which tool a GM
    // happens to be toggling it from. This whole toolbar rebuilds fresh on
    // every renderSelection() call (see this function's own header
    // comment), so — unlike Combat Tracker's persistent edit panel — there's
    // no stale-cached-icon-reference risk here to guard against; the
    // current state is just read fresh into the descriptor below.
    const hiddenFromPlayers = isElementHiddenFromPlayers(markerElement.id);
    const markerToolbarButtons = [
      {
        action: "toggle-hidden-from-players",
        label: hiddenFromPlayers ? "Hidden from players — click to show" : "Visible to players — click to hide",
        icon: hiddenFromPlayers ? "tabler:eye-off" : "tabler:eye",
        attrs: { "data-action": "toggle-hidden-from-players" },
        onClick: () => toggleElementHiddenFromPlayers(markerElement.id),
      },
    ];
    // See renderMarkerElementsSelectionEditor's own matching comment —
    // same explicit currentUserHasFullMapAccess() gate on this one
    // cross-map-write action.
    if (currentUserHasFullMapAccess()) {
      markerToolbarButtons.push({
        action: "move-to-map",
        label: "Move to another map",
        icon: "tabler:map-share",
        attrs: { "data-action": "move-to-map" },
        onClick: () => openMoveMarkerModal(),
      });
    }
    markerToolbarButtons.push({
      action: "delete",
      label: "Delete marker",
      attrs: { "data-action": "delete-selected" },
      onClick: () => deleteCurrentSelection(),
    });
    createToolbarButtonGroup(markerToolbarButtons).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
  // The toolbar above gets its own scoped sweep since it lives outside
  // `container` (elements.selectionToolbar is a separate mount) — this one
  // covers everything actually built INTO container itself (marker icon
  // chips' own remove buttons, ...), which was missing entirely before.
  refreshTooltips(container);
}

function renderGridCellSelectionEditor(layer, selectedCells) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  const selectionSummary = document.createElement("div");
  selectionSummary.className = "d-flex flex-column gap-2";
  const badgeRow = document.createElement("div");
  badgeRow.className = "d-flex align-items-center flex-wrap gap-2";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center";
  clearButton.setAttribute("aria-label", "Clear selection");
  clearButton.setAttribute("data-bs-toggle", "tooltip");
  clearButton.setAttribute("data-bs-placement", "bottom");
  clearButton.setAttribute("data-bs-title", "Clear cell selection");
  clearButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:x\" aria-hidden=\"true\"></span>";
  clearButton.addEventListener("click", () => setSelection("layer", layer.id));
  badgeRow.appendChild(clearButton);
  selectedCells.slice(0, 8).forEach((cell) => {
    const badge = document.createElement("span");
    badge.className = "badge text-bg-light border";
    badge.textContent = formatGridCellLabel(layer, cell.coord);
    badgeRow.appendChild(badge);
  });
  if (selectedCells.length > 12) {
    disposeTooltips(badgeRow);
    badgeRow.innerHTML = "";
    const summary = document.createElement("span");
    summary.className = "badge text-bg-secondary";
    summary.textContent = summarizeGridSelection(layer, selectedCells);
    badgeRow.appendChild(clearButton);
    badgeRow.appendChild(summary);
  } else if (selectedCells.length > 8) {
    const more = document.createElement("span");
    more.className = "badge text-bg-secondary";
    more.textContent = `+${selectedCells.length - 8} more`;
    badgeRow.appendChild(more);
  }
  selectionSummary.appendChild(badgeRow);
  refreshTooltips();
  container.appendChild(selectionSummary);

  const selectionCoords = selectedCells.map((cell) => cell.coord);
  const primaryCoord = selectedCells[0]?.coord;
  const primaryCell = primaryCoord ? findGridCell(layer, primaryCoord) : null;

  container.appendChild(createSelectionSectionTitle("Groups"));

  const groupSection = document.createElement("div");
  groupSection.className = "d-flex flex-column gap-2";

  if (!state.map.groups.length) {
    const empty = document.createElement("div");
    empty.className = "small text-body-secondary";
    empty.textContent = "No groups yet. Create a group to assign these cells.";
    groupSection.appendChild(empty);
  } else {
    state.map.groups.forEach((group) => {
      const groupMembers = normalizeGroupMembers(group).filter(
        (member) => member.kind === "grid-cell" && member.layerId === layer.id,
      );
      const memberIds = new Set(groupMembers.map((member) => member.elementId));
      const existingCells = selectionCoords
        .map((coord) => findGridCell(layer, coord))
        .filter(Boolean)
        .map((cell) => cell.id);
      const matched = existingCells.filter((id) => memberIds.has(id)).length;
      const total = selectionCoords.length;

      const wrapper = document.createElement("div");
      wrapper.className = "form-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input";
      checkbox.id = `group-assign-${group.id}`;
      checkbox.checked = total > 0 && matched === total;
      checkbox.indeterminate = matched > 0 && matched < total;
      const label = document.createElement("label");
      label.className = "form-check-label small";
      label.setAttribute("for", checkbox.id);
      label.textContent = group.name;

      checkbox.addEventListener("change", () => {
        applyGroupChange("update group members", () => {
          if (checkbox.checked) {
            const nextMembers = new Map(
              normalizeGroupMembers(group).map((member) => [getGroupMemberKey(member), member]),
            );
            selectionCoords.forEach((coord) => {
              const cell = ensureGridCell(layer, coord);
              const member = { layerId: layer.id, elementId: cell.id, kind: "grid-cell" };
              nextMembers.set(getGroupMemberKey(member), member);
            });
            group.elementIds = Array.from(nextMembers.values());
          } else {
            const selectedIds = new Set(
              selectionCoords
                .map((coord) => findGridCell(layer, coord))
                .filter(Boolean)
                .map((cell) => cell.id),
            );
            group.elementIds = normalizeGroupMembers(group).filter((member) => {
              if (member.kind !== "grid-cell" || member.layerId !== layer.id) {
                return true;
              }
              return !selectedIds.has(member.elementId);
            });
          }
        });
      });

      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      groupSection.appendChild(wrapper);
    });
  }

  container.appendChild(groupSection);

  let bulkNotice = null;
  if (selectedCells.length > 1) {
    bulkNotice = document.createElement("div");
    bulkNotice.className = "d-flex align-items-center gap-2";
    const noticeLabel = document.createElement("span");
    noticeLabel.className = "small text-body-secondary";
    noticeLabel.textContent = "Editing properties applies to all selected cells.";
    bulkNotice.appendChild(noticeLabel);
    const help = document.createElement("span");
    help.className = "align-middle";
    help.dataset.helpTopic = "orrery.bulkEdit";
    help.dataset.helpInsert = "replace";
    bulkNotice.appendChild(help);
  }

  const propertiesWrapper = document.createElement("div");
  propertiesWrapper.className = "d-flex flex-column gap-2";
  const entries = Object.entries(primaryCell?.properties || {});

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small text-body-secondary";
    empty.textContent = "No custom properties yet.";
    propertiesWrapper.appendChild(empty);
  } else {
    entries.forEach(([key, value]) => {
      propertiesWrapper.appendChild(createGridCellPropertyRow(layer, selectionCoords, key, value));
    });
  }

  const actionRow = document.createElement("div");
  actionRow.className = "btn-toolbar";
  actionRow.setAttribute("role", "toolbar");
  actionRow.setAttribute("aria-label", "Cell property actions");
  const actionGroup = document.createElement("div");
  actionGroup.className = "btn-group btn-group-sm";
  actionGroup.setAttribute("role", "group");

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  addButton.setAttribute("aria-label", "Add property");
  addButton.setAttribute("data-bs-toggle", "tooltip");
  addButton.setAttribute("data-bs-placement", "bottom");
  addButton.setAttribute("data-bs-title", "Add property");
  addButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:plus\" aria-hidden=\"true\"></span>";
  addButton.addEventListener("click", () => {
    const emptyState = propertiesWrapper.querySelector(".text-body-secondary");
    if (emptyState) {
      emptyState.remove();
    }
    const row = createGridCellPropertyRow(layer, selectionCoords, "", "");
    propertiesWrapper.appendChild(row);
    row.querySelector("[data-property-key]")?.focus();
    refreshTooltips();
  });

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  copyButton.setAttribute("aria-label", "Copy properties");
  copyButton.setAttribute("data-bs-toggle", "tooltip");
  copyButton.setAttribute("data-bs-placement", "bottom");
  copyButton.setAttribute("data-bs-title", "Copy properties");
  copyButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:copy\" aria-hidden=\"true\"></span>";
  copyButton.addEventListener("click", () => {
    const props = primaryCell?.properties || {};
    state.propertyClipboard = JSON.parse(JSON.stringify(props));
    renderSelection();
    status.show("Copied cell properties", { type: "info", timeout: 1200 });
  });

  const pasteButton = document.createElement("button");
  pasteButton.type = "button";
  pasteButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  pasteButton.setAttribute("aria-label", "Paste properties");
  pasteButton.setAttribute("data-bs-toggle", "tooltip");
  pasteButton.setAttribute("data-bs-placement", "bottom");
  pasteButton.setAttribute("data-bs-title", "Paste properties");
  pasteButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:clipboard\" aria-hidden=\"true\"></span>";
  pasteButton.addEventListener("click", () => {
    if (!state.propertyClipboard) {
      return;
    }
    applyCellPropertiesChange("paste cell properties", () => {
      selectionCoords.forEach((coord) => {
        const cell = ensureGridCell(layer, coord);
        cell.properties = JSON.parse(JSON.stringify(state.propertyClipboard));
      });
    });
    status.show("Pasted cell properties", { type: "success", timeout: 1200 });
  });

  actionGroup.appendChild(addButton);
  actionGroup.appendChild(copyButton);
  actionGroup.appendChild(pasteButton);
  actionRow.appendChild(actionGroup);
  // setDisabledTooltip (not bare `.disabled = ...`) for both — each button
  // already carries its own permanent tooltip (set above); a real `disabled`
  // attribute would block that tooltip from showing at all (see
  // tooltips.js's own header), so the disabled-state explanation has to go
  // on setDisabledTooltip's own separate wrapper instead. Must run AFTER
  // the appendChild calls above, since the wrapper needs a real parent.
  setDisabledTooltip(copyButton, primaryCoord ? "" : "Select a cell first.");
  setDisabledTooltip(pasteButton, state.propertyClipboard ? "" : "Nothing copied yet.");
  const customPropertiesFields = bulkNotice ? [bulkNotice, actionRow, propertiesWrapper] : [actionRow, propertiesWrapper];
  container.appendChild(
    createCollapsibleSection("Custom Properties", customPropertiesFields, { defaultCollapsed: entries.length === 0 })
  );
  refreshTooltips();
  if (bulkNotice) {
    initHelpSystem({ root: bulkNotice });
  }

  if (selectedCells.length > 1) {
    container.appendChild(createSelectionSectionTitle("Bulk Add/Update"));
    const bulkRow = document.createElement("div");
    bulkRow.className = "d-flex flex-column gap-2";
    const bulkKey = document.createElement("input");
    bulkKey.type = "text";
    bulkKey.className = "form-control form-control-sm";
    bulkKey.placeholder = "Property key";
    const bulkValue = document.createElement("input");
    bulkValue.type = "text";
    bulkValue.className = "form-control form-control-sm";
    bulkValue.placeholder = "Property value";
    const bulkButton = document.createElement("button");
    bulkButton.type = "button";
    bulkButton.className = "btn btn-outline-primary btn-sm align-self-start";
    bulkButton.textContent = "Apply to selection";
    bulkButton.addEventListener("click", () => {
      const key = bulkKey.value.trim();
      if (!key) {
        return;
      }
      applyCellPropertiesChange("bulk cell property", () => {
        selectionCoords.forEach((coord) => {
          const cell = ensureGridCell(layer, coord);
          cell.properties = cell.properties || {};
          cell.properties[key] = bulkValue.value.trim();
        });
      });
    });
    bulkRow.appendChild(bulkKey);
    bulkRow.appendChild(bulkValue);
    bulkRow.appendChild(bulkButton);
    container.appendChild(bulkRow);
  }
}

function createGroupPropertyRow(group, key, value) {
  return createPropertyRow({
    key,
    value,
    onUpdate: ({ currentKey, nextKey, nextValue }) => {
      applyGroupPropertyChange("group property", () => {
        group.properties = group.properties || {};
        if (currentKey && currentKey !== nextKey) {
          delete group.properties[currentKey];
        }
        if (nextKey) {
          group.properties[nextKey] = nextValue;
        }
      });
    },
    onRemove: ({ currentKey }) => {
      applyGroupChange("remove group property", () => {
        if (currentKey && group.properties) {
          delete group.properties[currentKey];
        }
      });
      renderSelection();
    },
  });
}

function resolveGroupMemberLabel(member) {
  const layer = state.map.layers.find((entry) => entry.id === member.layerId);
  if (member.kind === "grid-cell" && layer) {
    const cell = findGridCellById(layer, member.elementId);
    if (cell) {
      return `${layer.name} · ${formatGridCellLabel(layer, cell.coord)}`;
    }
  }
  if (layer) {
    return `${layer.name} · ${member.kind || "element"}`;
  }
  return member.label || "Missing element";
}

function renderGroupSelectionEditor(group) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  const nameField = createFormFloatingField({ type: "text", label: "Name", placeholder: " " });
  const nameInput = nameField.querySelector("input");
  nameInput.value = group.name;
  nameInput.addEventListener("change", () => {
    const value = nameInput.value.trim();
    if (!value) {
      nameInput.value = group.name;
      return;
    }
    applyGroupChange("group name", () => {
      group.name = value;
    });
  });
  container.appendChild(nameField);

  // Selecting this group already arms its target grid layer for direct
  // click/drag cell-adding with no separate toggle (renderLayerOverlays'
  // own resolvePaintTargetLayer + isInteractive check) — this panel only
  // needs to expose WHICH layer that is when it's ambiguous.
  const gridLayers = state.map.layers.filter((entry) => entry.type === "grid");
  const fogLinkedLayer = gridLayers.find((entry) => entry.settings?.revealGroupId === group.id);
  const resolvedPaintLayer = resolvePaintTargetLayer(group);
  const lastSelection = state.lastGridSelection;
  const selectionLayer = lastSelection?.layerId
    ? state.map.layers.find((layer) => layer.id === lastSelection.layerId)
    : null;
  const canAddSelectedCells = Boolean(lastSelection?.cells?.length && selectionLayer);
  const members = normalizeGroupMembers(group);

  function addSelectedCellsToGroup() {
    if (!canAddSelectedCells) {
      return;
    }
    applyGroupChange("add group members", () => {
      const nextMembers = new Map(normalizeGroupMembers(group).map((member) => [getGroupMemberKey(member), member]));
      lastSelection.cells.forEach((cell) => {
        const resolved = findGridCell(selectionLayer, cell.coord) || ensureGridCell(selectionLayer, cell.coord);
        const member = { layerId: selectionLayer.id, elementId: resolved.id, kind: "grid-cell" };
        nextMembers.set(getGroupMemberKey(member), member);
      });
      group.elementIds = Array.from(nextMembers.values());
    });
  }

  // Same shared icon-toolbar factory/mount point Layer and AoE Shape
  // selection already use (data-selection-toolbar-mount) — renderSelection()
  // clears it before every render, so only whichever selection kind is
  // current repopulates it.
  if (elements.selectionToolbar) {
    createToolbarButtonGroup([
      {
        action: "add-selected-cells",
        label: canAddSelectedCells ? `Add selected cells (${lastSelection.cells.length})` : "Add selected cells",
        icon: "tabler:square-plus",
        disabled: !canAddSelectedCells,
        onClick: addSelectedCellsToGroup,
      },
      {
        action: "delete",
        label: "Delete group",
        attrs: { "data-action": "delete-selected" },
        onClick: () => deleteCurrentSelection(),
      },
    ]).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }

  const membersBody = [];

  // Only shown when it's actually ambiguous which layer clicking/painting
  // targets — a Fog of War link already resolves it unambiguously
  // (resolvePaintTargetLayer's own priority order), same as a single grid
  // layer does.
  if (!fogLinkedLayer && gridLayers.length > 1) {
    const paintLayerField = createCompactField({
      type: "select",
      label: "Paint on layer",
      options: gridLayers.map((entry) => ({ value: entry.id, label: entry.name })),
    });
    const paintLayerSelect = paintLayerField.querySelector("select");
    paintLayerSelect.value = resolvedPaintLayer?.id || "";
    paintLayerSelect.addEventListener("change", () => {
      paintTargetLayerId = paintLayerSelect.value;
      renderLayerOverlays();
    });
    membersBody.push(paintLayerField);
  }

  const summaryRow = document.createElement("div");
  summaryRow.className = "d-flex align-items-center justify-content-between gap-2";
  const summary = document.createElement("div");
  summary.className = "small text-body-secondary";
  summary.textContent = members.length ? `${members.length} ${members.length === 1 ? "cell" : "cells"}` : "No members yet.";
  const summaryActions = document.createElement("div");
  summaryActions.className = "d-flex align-items-center gap-2";
  const membersHelp = document.createElement("span");
  membersHelp.className = "align-middle";
  membersHelp.dataset.helpTopic = "orrery.gridSelection";
  membersHelp.dataset.helpInsert = "replace";
  summaryActions.appendChild(membersHelp);
  if (members.length) {
    // Distinct icon from the per-member remove buttons below (trash-x vs
    // plain trash) so "clear everything" reads differently at a glance
    // from "remove this one cell."
    const removeAllButton = document.createElement("button");
    removeAllButton.type = "button";
    removeAllButton.className = "btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center";
    removeAllButton.setAttribute("aria-label", "Remove all members");
    removeAllButton.setAttribute("data-bs-toggle", "tooltip");
    removeAllButton.setAttribute("data-bs-placement", "bottom");
    removeAllButton.setAttribute("data-bs-title", "Remove all members");
    removeAllButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:trash-x\" aria-hidden=\"true\"></span>";
    removeAllButton.addEventListener("click", () => {
      applyGroupChange("clear group members", () => {
        group.elementIds = [];
      });
    });
    summaryActions.appendChild(removeAllButton);
  }
  summaryRow.append(summary, summaryActions);
  membersBody.push(summaryRow);
  initHelpSystem({ root: summaryRow });

  // Its own scrollable box (orrery-pane-list — the same class the left
  // pane's Layers/Groups/Views lists already use for exactly this) so a
  // group with dozens of painted cells doesn't balloon the whole right
  // pane — separate from the Members section's own collapse/expand, which
  // hides the whole thing away instead.
  const memberList = document.createElement("div");
  memberList.className = "orrery-pane-list d-flex flex-column gap-2 p-2 border rounded";

  if (!members.length) {
    const emptyMembers = document.createElement("div");
    emptyMembers.className = "small text-body-secondary";
    emptyMembers.textContent = "No members assigned yet.";
    memberList.appendChild(emptyMembers);
  } else {
    members.forEach((member) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center justify-content-between gap-2";
      const label = document.createElement("span");
      label.className = "small";
      label.textContent = resolveGroupMemberLabel(member);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center";
      removeButton.setAttribute("aria-label", "Remove member");
      removeButton.setAttribute("data-bs-toggle", "tooltip");
      removeButton.setAttribute("data-bs-placement", "bottom");
      removeButton.setAttribute("data-bs-title", "Remove member");
      removeButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:trash\" aria-hidden=\"true\"></span>";
      removeButton.addEventListener("click", () => {
        applyGroupChange("remove group member", () => {
          const memberKey = getGroupMemberKey(member);
          group.elementIds = normalizeGroupMembers(group).filter((entry) => getGroupMemberKey(entry) !== memberKey);
        });
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      memberList.appendChild(row);
    });
  }
  membersBody.push(memberList);

  container.appendChild(createCollapsibleSection("Members", membersBody));
  refreshTooltips();

  const propertiesWrapper = document.createElement("div");
  propertiesWrapper.className = "d-flex flex-column gap-2";
  const entries = Object.entries(group.properties || {});

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "small text-body-secondary";
    empty.textContent = "No custom properties yet.";
    propertiesWrapper.appendChild(empty);
  } else {
    entries.forEach(([key, value]) => {
      propertiesWrapper.appendChild(createGroupPropertyRow(group, key, value));
    });
  }

  const actionRow = document.createElement("div");
  actionRow.className = "btn-toolbar";
  actionRow.setAttribute("role", "toolbar");
  actionRow.setAttribute("aria-label", "Group property actions");
  const actionGroup = document.createElement("div");
  actionGroup.className = "btn-group btn-group-sm";
  actionGroup.setAttribute("role", "group");

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  addButton.setAttribute("aria-label", "Add property");
  addButton.setAttribute("data-bs-toggle", "tooltip");
  addButton.setAttribute("data-bs-placement", "bottom");
  addButton.setAttribute("data-bs-title", "Add property");
  addButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:plus\" aria-hidden=\"true\"></span>";
  addButton.addEventListener("click", () => {
    const emptyState = propertiesWrapper.querySelector(".text-body-secondary");
    if (emptyState) {
      emptyState.remove();
    }
    const row = createGroupPropertyRow(group, "", "");
    propertiesWrapper.appendChild(row);
    row.querySelector("[data-property-key]")?.focus();
    refreshTooltips();
  });

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  copyButton.setAttribute("aria-label", "Copy properties");
  copyButton.setAttribute("data-bs-toggle", "tooltip");
  copyButton.setAttribute("data-bs-placement", "bottom");
  copyButton.setAttribute("data-bs-title", "Copy properties");
  copyButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:copy\" aria-hidden=\"true\"></span>";
  copyButton.addEventListener("click", () => {
    state.propertyClipboard = JSON.parse(JSON.stringify(group.properties || {}));
    renderSelection();
    status.show("Copied group properties", { type: "info", timeout: 1200 });
  });

  const pasteButton = document.createElement("button");
  pasteButton.type = "button";
  pasteButton.className = "btn btn-outline-secondary d-inline-flex align-items-center justify-content-center";
  pasteButton.setAttribute("aria-label", "Paste properties");
  pasteButton.setAttribute("data-bs-toggle", "tooltip");
  pasteButton.setAttribute("data-bs-placement", "bottom");
  pasteButton.setAttribute("data-bs-title", "Paste properties");
  pasteButton.innerHTML = "<span class=\"iconify\" data-icon=\"tabler:clipboard\" aria-hidden=\"true\"></span>";
  pasteButton.addEventListener("click", () => {
    if (!state.propertyClipboard) {
      return;
    }
    applyGroupChange("paste group properties", () => {
      group.properties = JSON.parse(JSON.stringify(state.propertyClipboard));
    });
    status.show("Pasted group properties", { type: "success", timeout: 1200 });
  });

  actionGroup.appendChild(addButton);
  actionGroup.appendChild(copyButton);
  actionGroup.appendChild(pasteButton);
  actionRow.appendChild(actionGroup);
  container.appendChild(
    createCollapsibleSection("Custom Properties", [actionRow, propertiesWrapper], { defaultCollapsed: !entries.length })
  );
  // setDisabledTooltip, not bare `.disabled = ...` — see the Layer/Cell
  // panels' own identical fix just above for the full reasoning. Must run
  // AFTER the appendChild calls above.
  setDisabledTooltip(pasteButton, state.propertyClipboard ? "" : "Nothing copied yet.");
  refreshTooltips();
}

// A short, human-readable label for any placed element — shared by the View
// editor's own "Visible Components" checklist below (the only current
// caller). Mirrors the exact labels renderSelection already uses for each
// kind's own inspector title (marker: its own label, shape/effect: its own
// label or preset name, wall/door, light, plain path: "Drawn Path" — see
// that function's own per-kind branches), so a GM sees the same names here
// as everywhere else in this tool.
function describeMapElementKind(element) {
  if (element.kind === "marker") return element.label || "Marker";
  if (element.kind === "shape") {
    const preset = getPresetById(element.presetId) || getPresetById("circle");
    // A named Effect shows its own label (mirrors the marker branch just
    // above) — a GM's own "Boss Burst" is far more useful in this checklist
    // than the generic preset name every OTHER instance of the same preset
    // would otherwise show identically. Falls back to the preset's own
    // label for a plain Shape (which has no label concept) or an unlabeled
    // Effect.
    return element.label || preset.label;
  }
  if (element.kind === "wall") return element.wallType === "door" ? "Door" : "Wall";
  if (element.kind === "light") return "Light";
  return "Drawn Path";
}

function renderViewSelectionEditor(view) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  const nameField = createFormFloatingField({ type: "text", label: "Name", placeholder: " " });
  const nameInput = nameField.querySelector("input");
  nameInput.value = view.name;
  nameInput.addEventListener("change", () => {
    const value = nameInput.value.trim();
    if (!value) {
      nameInput.value = view.name;
      return;
    }
    applyViewChange("view name", () => {
      view.name = value;
    });
  });
  container.appendChild(nameField);

  const descriptionField = createFormFloatingField({
    // form-floating textareas need an explicit height (the `rows` attribute
    // fights the padding it adds for the label) — same fix Workbench's own
    // createTextarea/Press's text field already apply.
    type: "textarea", label: "Description", placeholder: "Describe what this view shows or hides.", style: "min-height: 72px",
  });
  const descriptionInput = descriptionField.querySelector("textarea");
  descriptionInput.value = view.description || "";
  descriptionInput.addEventListener("change", () => {
    applyViewChange("view description", () => {
      view.description = descriptionInput.value.trim();
    });
  });
  container.appendChild(descriptionField);

  // Both lists below are the same shared "search box + scrollable checkbox
  // list" the generator tools' own Locked Features picker uses
  // (createSearchableCheckList, ui-components.js; populateStringChecklist/
  // readLockedFeatureIds, generator-kit.js) rather than the hand-rolled
  // `<div class="form-check">` rows this used to build per row — that old
  // shape didn't scale past a handful of items and had no search, fine for
  // a few layers but not for "every marker/path/shape/wall/light on the
  // map" below. Checked = visible in the UI either way; under the hood
  // view.hiddenLayerIds/hiddenElementIds are DENY-lists (see createView's
  // own comment for why), so what's actually written back is the
  // COMPLEMENT of whatever's checked, not the checked set itself.
  const layerChecklist = createSearchableCheckList({
    id: `view-${view.id}-layers`,
    label: "Visible Layers",
    labelClass: "fw-semibold small mb-0",
    dataAttr: "data-view-layers-checklist",
    searchPlaceholder: "Search layers…",
  });
  container.appendChild(layerChecklist);
  const allLayerIds = state.map.layers.map((layer) => layer.id);
  populateStringChecklist(
    layerChecklist,
    state.map.layers.map((layer) => ({ value: layer.id, label: layer.name })),
    allLayerIds.filter((id) => !(view.hiddenLayerIds || []).includes(id))
  );
  layerChecklist.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    applyViewChange("view layer visibility", () => {
      const visible = new Set(readLockedFeatureIds(layerChecklist));
      view.hiddenLayerIds = allLayerIds.filter((id) => !visible.has(id));
    });
  });

  const allElements = [];
  state.map.layers.forEach((layer) => {
    (layer.elements || []).forEach((element) => {
      allElements.push({ id: element.id, label: `${describeMapElementKind(element)} (${layer.name})` });
    });
  });
  const componentChecklist = createSearchableCheckList({
    id: `view-${view.id}-components`,
    label: "Visible Components",
    labelClass: "fw-semibold small mb-0",
    dataAttr: "data-view-components-checklist",
    searchPlaceholder: "Search components…",
  });
  container.appendChild(componentChecklist);
  const allElementIds = allElements.map((entry) => entry.id);
  populateStringChecklist(
    componentChecklist,
    allElements.map((entry) => ({ value: entry.id, label: entry.label })),
    allElementIds.filter((id) => !(view.hiddenElementIds || []).includes(id))
  );
  componentChecklist.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    applyViewChange("view component visibility", () => {
      const visible = new Set(readLockedFeatureIds(componentChecklist));
      view.hiddenElementIds = allElementIds.filter((id) => !visible.has(id));
    });
  });

  container.appendChild(createSelectionSectionTitle("Access Tiers"));
  const tierWrapper = document.createElement("div");
  tierWrapper.className = "d-flex flex-column gap-2";
  const selectedTiers = new Set(view.tiers || []);
  VIEW_TIER_OPTIONS.forEach((tier) => {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "form-check-input";
    checkbox.id = `view-${view.id}-tier-${tier.value}`;
    checkbox.checked = selectedTiers.has(tier.value);
    const label = document.createElement("label");
    label.className = "form-check-label small";
    label.setAttribute("for", checkbox.id);
    label.textContent = tier.label;
    checkbox.addEventListener("change", () => {
      applyViewChange("view tier access", () => {
        const next = new Set(view.tiers || []);
        if (checkbox.checked) {
          next.add(tier.value);
        } else {
          next.delete(tier.value);
        }
        view.tiers = Array.from(next);
      });
    });
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    tierWrapper.appendChild(wrapper);
  });
  container.appendChild(tierWrapper);

  // Same shared icon-toolbar factory/mount point Layer/Shape/Group
  // selection already use (data-selection-toolbar-mount) instead of a
  // standalone inline button — renderSelection() clears it before every
  // render, so only whichever selection kind is current repopulates it.
  if (elements.selectionToolbar) {
    createToolbarButtonGroup([
      {
        action: "delete",
        label: "Delete view",
        attrs: { "data-action": "delete-selected" },
        onClick: () => deleteCurrentSelection(),
      },
    ]).forEach((button) => elements.selectionToolbar.appendChild(button));
    refreshTooltips(elements.selectionToolbar);
  }
}

function renderView() {
  const view = state.map.view;
  elements.viewMode.textContent = view.mode;
  elements.viewZoom.textContent = view.zoom.toFixed(2);
  elements.viewCenter.textContent = `${view.center.lat.toFixed(2)}, ${view.center.lng.toFixed(2)}`;
  elements.viewPan.textContent = `${Math.round(view.pan.x)}, ${Math.round(view.pan.y)}`;
}

function renderAll() {
  renderBaseMapSettings();
  renderLayers();
  renderGroups();
  renderViewsList();
  renderSelection();
  renderLayerOverlays();
  renderView();
  renderJson();
}

function centerTileView(zoom) {
  const nextZoom = Number.isFinite(zoom) ? zoom : state.map.view.zoom;
  state.map.view = {
    ...state.map.view,
    zoom: nextZoom,
    center: { lat: 0, lng: 0 },
    pan: { x: 0, y: 0 },
  };
  baseMapManager.setView(state.map.view);
}

function setupBaseMapEvents() {
  elements.baseMapRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      recordHistory(`base map to ${radio.value}`, () => {
        updateBaseMapType(state.map, radio.value);
      });
      baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
      setSelection(null);
      renderAll();
      status.show(`Switched to ${radio.value} base map`, { type: "info", timeout: 1500 });
    });
  });

  if (elements.tileProvider) {
    elements.tileProvider.addEventListener("change", () => {
      const value = elements.tileProvider.value.trim();
      if (!value) {
        elements.tileProvider.value = state.map.baseMap.settings.tile.urlTemplate;
        return;
      }
      recordHistory("tile provider", () => {
        state.map.baseMap.settings.tile.urlTemplate = value;
        updateMapTimestamp(state.map);
      });
      if (state.map.baseMap.type === "tile") {
        baseMapManager.updateSettings(state.map.baseMap.settings.tile);
        centerTileView(state.map.baseMap.settings.tile.initialZoom);
      }
      renderJson();
    });
  }

  if (elements.tileQuickPick) {
    elements.tileQuickPick.addEventListener("change", () => {
      const selection = elements.tileQuickPick.selectedOptions[0];
      if (!selection || !selection.dataset.tileUrl) {
        return;
      }
      const urlTemplate = selection.dataset.tileUrl;
      const maxZoom = Number(selection.dataset.tileMaxZoom);
      const initialZoom = Number(selection.dataset.tileInitialZoom);
      recordHistory("tile quick pick", () => {
        state.map.baseMap.settings.tile.urlTemplate = urlTemplate;
        if (Number.isFinite(maxZoom)) {
          state.map.baseMap.settings.tile.maxZoom = maxZoom;
        }
        if (Number.isFinite(initialZoom)) {
          state.map.baseMap.settings.tile.initialZoom = initialZoom;
        }
        updateMapTimestamp(state.map);
      });
      if (elements.tileProvider) {
        elements.tileProvider.value = urlTemplate;
      }
      if (state.map.baseMap.type === "tile") {
        baseMapManager.updateSettings(state.map.baseMap.settings.tile);
        centerTileView(state.map.baseMap.settings.tile.initialZoom);
      }
      renderJson();
    });
  }

  elements.imageSrc.addEventListener("change", () => {
    recordHistory("image source", () => {
      state.map.baseMap.settings.image.src = elements.imageSrc.value.trim();
      updateMapTimestamp(state.map);
    });
    if (state.map.baseMap.type === "image") {
      baseMapManager.updateSettings(state.map.baseMap.settings.image);
    }
    renderJson();
  });

  const updateImageDimension = (key, element) => {
    element.addEventListener("change", () => {
      const parsed = parseImageDimension(element.value);
      if (!parsed.valid) {
        // Same "revert to whatever's actually stored" pattern the Name
        // field's own empty-value guard uses, rather than leaving text in
        // the field the model never actually accepted.
        element.value = state.map.baseMap.settings.image[key] ?? "";
        return;
      }
      recordHistory(`image ${key}`, () => {
        state.map.baseMap.settings.image[key] = parsed.value;
        updateMapTimestamp(state.map);
      });
      if (state.map.baseMap.type === "image") {
        baseMapManager.updateSettings(state.map.baseMap.settings.image);
      }
      renderJson();
    });
  };

  updateImageDimension("width", elements.imageWidth);
  updateImageDimension("height", elements.imageHeight);

  elements.canvasBackground.addEventListener("change", () => {
    recordHistory("canvas background", () => {
      state.map.baseMap.settings.canvas.background = elements.canvasBackground.value;
      updateMapTimestamp(state.map);
    });
    if (state.map.baseMap.type === "canvas") {
      baseMapManager.updateSettings(state.map.baseMap.settings.canvas);
    }
    renderJson();
  });
}

function setupLayerEvents() {
  elements.layerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.addLayer;
      let layer = null;
      recordHistory(`add ${type} layer`, () => {
        layer = createLayer({ type });
        if (type === "marker") {
          const overlay = baseMapManager.getOverlayContainer();
          if (overlay) {
            const rect = overlay.getBoundingClientRect();
            layer.position = {
              x: rect.width / 2,
              y: rect.height / 2,
            };
          }
        }
        state.map.layers.push(layer);
        updateMapTimestamp(state.map);
      });
      renderLayers();
      renderLayerOverlays();
      renderJson();
      if (layer) {
        setSelection("layer", layer.id);
      }
      status.show("Layer added", { type: "success", timeout: 1200 });
    });
  });
}

function setupGroupEvents() {
  elements.groupAdd.addEventListener("click", () => {
    let group = null;
    recordHistory("add group", () => {
      group = createGroup({
        name: `Group ${state.map.groups.length + 1}`,
      });
      state.map.groups.push(group);
      updateMapTimestamp(state.map);
    });
    renderGroups();
    renderLayerOverlays();
    renderJson();
    if (group) {
      setSelection("group", group.id);
    }
    status.show("Group created", { type: "success", timeout: 1200 });
  });
}

function setupViewsListEvents() {
  if (!elements.viewAdd) {
    return;
  }
  elements.viewAdd.addEventListener("click", () => {
    let view = null;
    recordHistory("add view", () => {
      view = createView({
        name: `View ${state.map.views.length + 1}`,
        layerIds: state.map.layers.map((layer) => layer.id),
        groupIds: state.map.groups.map((group) => group.id),
      });
      state.map.views.push(view);
      updateMapTimestamp(state.map);
    });
    renderViewsList();
    renderJson();
    if (view) {
      setSelection("view", view.id);
    }
    status.show("View created", { type: "success", timeout: 1200 });
  });
}

function setupViewEvents() {
  elements.zoomIn.addEventListener("click", () => baseMapManager.zoomBy(0.25));
  elements.zoomOut.addEventListener("click", () => baseMapManager.zoomBy(-0.25));
  elements.zoomReset.addEventListener("click", () => {
    baseMapManager.reset();
    state.map.view = baseMapManager.getView();
    renderView();
  });
  setupMeasureTool();
  setupDrawTool();
  setupShapeTool();
  initShapeEffectModal();
  initMoveMarkerModal();
  setupWallTool();
  setupLightTool();
  setupPingTool();
}

// Module-scope (not local to setupDrawTool) — updateDrawAvailability needs
// to run from setSelection/applyMapSnapshot too, not just the toggle's own
// click handler, so the button's enabled state and tooltip stay correct the
// moment the selection changes, not only when the user next tries the
// toggle.
function getSelectedVectorLayer() {
  if (state.selection.kind !== "layer") return null;
  const layer = state.map.layers.find((entry) => entry.id === state.selection.id);
  return layer?.type === "vector" ? layer : null;
}

// Draw no longer requires a vector layer to already be selected — see
// ensureDrawableVectorLayer's own comment below — so this has nothing left
// to disable/explain. Kept (rather than deleting every call site) since
// selection changes/map loads already call it unconditionally; a no-op
// here is simpler than pruning those call sites for a toggle that's always
// enabled anyway.
function updateDrawAvailability() {
  if (!elements.drawToggle) return;
  elements.drawToggle.disabled = false;
  // Single-element, not a broad refreshTooltips(document/toolbar) sweep —
  // this only ever needs to touch its own tooltip trigger, never any
  // other tooltip that happens to be open elsewhere at that moment.
  initTooltip(elements.drawToggleWrap || elements.drawToggle, { title: "Draw on the map" });
}

// Returns the currently-selected vector layer, auto-creating (and
// selecting) a new one first if none is selected — matching the Dashboard
// Map widget's own findOrCreateVectorLayer (map-live-sync.js), which
// likewise never requires a caller to have picked a layer first.
// Same create-and-select shape as the "Add vector layer" toolbar button
// itself (setupLayerEvents) — reusing that exact pattern rather than a
// bespoke lighter-weight insert, so a layer created this way looks and
// behaves identically to one the GM added on purpose.
function ensureDrawableVectorLayer() {
  const existing = getSelectedVectorLayer();
  if (existing) return existing;
  let layer = null;
  recordHistory("add vector layer", () => {
    layer = createLayer({ type: "vector" });
    state.map.layers.push(layer);
    updateMapTimestamp(state.map);
  });
  renderLayers();
  renderLayerOverlays();
  renderJson();
  setSelection("layer", layer.id);
  return layer;
}

// Toggles Draw mode plus every piece of UI that tracks it (button state,
// cursor class, the shared drawColor swatch's visibility, re-rendering so
// onVectorPathClick's own drawModeActive gate picks up the change) — used
// both by the toggle button's own click handler and by setupDrawTool's
// single-shot auto-disarm after a stroke completes, so the two never drift
// out of sync with each other the way separately hand-toggling each piece
// twice already almost did.
function setDrawModeActive(active) {
  drawModeActive = active;
  elements.drawToggle?.classList.toggle("active", drawModeActive);
  elements.drawToggle?.setAttribute("aria-pressed", drawModeActive ? "true" : "false");
  mapContainer?.classList.toggle("orrery-drawing", drawModeActive);
  updateDrawColorVisibility();
  renderLayerOverlays();
}

// The shared drawColor swatch only makes sense while Draw is actually
// armed — Shape no longer uses it (drawColor's own declaration comment has
// the full reasoning; its own colors live in the right-pane Inspector now,
// not this toolbar swatch).
function updateDrawColorVisibility() {
  elements.drawColorWrap?.classList.toggle("d-none", !drawModeActive);
}

// Freehand drawing on the currently-selected vector layer — replaces the
// old fixed placeholder triangle every vector layer used to render
// regardless of content (see createVectorLayerElement's own header). A
// click-drag on the map accumulates points into a live preview polyline
// (a throwaway SVG appended directly to the overlay, not run through the
// normal layer.elements render pipeline until the gesture ends, same
// "don't tear down the DOM mid-gesture" reasoning bindLayerDrag/
// beginMarkerDrag already follow), then commits the finished stroke as one
// createVectorPathElement on release.
function setupDrawTool() {
  if (!elements.drawToggle || !mapContainer) {
    return;
  }
  updateDrawAvailability();

  elements.drawToggle.addEventListener("click", () => {
    if (elements.drawToggle.disabled) return;
    // Re-renders so onVectorPathClick's own drawModeActive gate (see
    // renderLayerOverlays) picks up the change immediately — otherwise a
    // layer selected before toggling Draw would keep its stale
    // click-to-select/click-through wiring until the next unrelated
    // re-render.
    setDrawModeActive(!drawModeActive);
  });

  elements.drawColor?.addEventListener("input", () => {
    drawColor = elements.drawColor.value;
  });

  mapContainer.addEventListener("pointerdown", (event) => {
    if (!drawModeActive || event.button !== 0) return;
    const layer = ensureDrawableVectorLayer();
    event.preventDefault();
    baseMapManager.setInteractionEnabled(false);
    const overlay = baseMapManager.getOverlayContainer();
    const points = [];

    const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    preview.style.position = "absolute";
    preview.style.inset = "0";
    preview.style.width = "100%";
    preview.style.height = "100%";
    preview.style.overflow = "visible";
    preview.style.pointerEvents = "none";
    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", drawColor);
    polyline.setAttribute("stroke-width", String(layer.settings?.strokeWidth || 2));
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    preview.appendChild(polyline);
    overlay.appendChild(preview);

    function addPoint(pointerEvent) {
      const position = resolveClickPosition(baseMapManager, state.map, pointerEvent, overlay);
      if (!position) return;
      points.push(position);
      const pixelPoints = points.map((point) => markerPositionToLocalPixel(baseMapManager, state.map, point));
      polyline.setAttribute("points", pixelPoints.map((point) => `${point.x},${point.y}`).join(" "));
    }
    addPoint(event);

    const onMove = (moveEvent) => addPoint(moveEvent);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      baseMapManager.setInteractionEnabled(true);
      preview.remove();
      if (points.length > 1) {
        let createdElement = null;
        recordHistory("draw path", () => {
          layer.elements = layer.elements || [];
          // Stroke-only (no fillColor passed through) — an open freehand
          // polyline's implicit closing segment (last point back to
          // first) almost never produces a sensible fill shape, unlike
          // the old single hardcoded closed triangle this replaced.
          createdElement = createVectorPathElement({
            points,
            strokeColor: drawColor,
            strokeWidth: layer.settings?.strokeWidth,
          });
          layer.elements.push(createdElement);
          updateMapTimestamp(state.map);
        });
        renderJson();
        // Single-shot — placing one stroke disarms the tool, matching the
        // Dashboard Map widget's identical behavior (setActiveTool's own
        // re-toggle in handleToolPointerDown) rather than staying armed for
        // another click to immediately start a second one with no way to
        // just stop. setDrawModeActive already re-renders.
        setDrawModeActive(false);
        // VTT-like immediacy, same as a marker move (onMarkerDragEnd) — a
        // freshly-drawn stroke saves itself immediately rather than waiting
        // for the GM's own Save button, matching the Dashboard Map widget's
        // own Draw tool (which has no Save button at all). Undo/Redo of
        // this same action re-syncs the server the other way — see
        // DRAW_SHAPE_AUTO_SAVE_LABELS/autoSaveHistoryEntry's own comment.
        if (mapExistsOnServer && createdElement) {
          const savedElement = createdElement;
          void persistNewElement({
            dataManager,
            mapId: state.map.id,
            shareToken: currentShareToken,
            layerId: layer.id,
            element: savedElement,
          })
            .then(() => {
              syncCleanSnapshotForElement(layer.id, savedElement.id, savedElement);
              mapWatcher?.noteLocalWrite();
            })
            .catch((error) => {
              status?.show(error?.message || "Unable to save your drawing.", { type: "danger" });
            });
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// No longer requires a selected vector layer — see ensureDrawableVectorLayer's
// own comment, same as Draw/Shape. No measurement-scale requirement either
// (unlike Shape/Light) — a wall's length isn't authored in cells, it traces
// real map geometry at whatever points the GM clicks.
function updateWallAvailability() {
  if (!elements.wallToggle) return;
  elements.wallToggle.disabled = false;
  const tooltipTarget = elements.wallToggleWrap || elements.wallToggle;
  tooltipTarget.setAttribute("data-bs-title", "Draw a wall or door");
  refreshTooltips(tooltipTarget.parentElement || document);
}

// Same reasoning as setDrawModeActive/setShapeModeActive — plus, like Shape/
// Light, Wall has a right-pane Inspector view of its own now
// (renderArmedWallInspector) that has to take over/hand back the panel
// exactly when arming/disarming does. Creates/discards draftWallElement
// here — the ONE place its whole lifecycle is owned (see its own
// declaration comment). No longer takes the standalone toolbar dropdown
// (removed — Type is now edited straight from the armed inspector, the
// exact same field an already-placed wall's own editor already had).
function setWallModeActive(active) {
  wallModeActive = active;
  elements.wallToggle?.classList.toggle("active", wallModeActive);
  elements.wallToggle?.setAttribute("aria-pressed", wallModeActive ? "true" : "false");
  mapContainer?.classList.toggle("orrery-walling", wallModeActive);
  elements.wallSnapToggleWrap?.classList.toggle("d-none", !wallModeActive);
  if (!wallModeActive) teardownWallGesture();
  // Re-render so onVectorPathClick's own wallModeActive gate (see
  // renderLayerOverlays) picks up the change immediately — same reasoning
  // setupDrawTool's own toggle handler already documents.
  renderLayerOverlays();
  if (wallModeActive) {
    draftWallLayer = ensureDrawableVectorLayer();
    draftWallElement = createWallElement({
      wallType: lastWallType,
      strokeColor: draftWallLayer.settings?.strokeColor,
      strokeWidth: draftWallLayer.settings?.strokeWidth,
      snapToGrid: wallSnapEnabled,
    });
    renderArmedWallInspector();
  } else {
    if (draftWallElement) {
      lastWallType = draftWallElement.wallType;
    }
    draftWallElement = null;
    draftWallLayer = null;
    renderSelection();
  }
}

// The right-pane Inspector view shown for the ENTIRE time the Wall tool is
// armed — draftWallElement's own declaration comment has the full
// reasoning for why this renders through the EXACT SAME
// renderWallSelectionEditor an already-placed wall uses (Type, Stroke
// color/width, Snap to Grid, and — once Type is switched to Door — Secret/
// Locked), rather than a separate simplified view. Only this wrapper's own
// title/details/icon (and clearing the toolbar first, which
// renderSelection() normally does but this bypasses) are specific to the
// "drawing" state; the editor body itself is 100% the shared function.
function renderArmedWallInspector() {
  if (!draftWallElement || !draftWallLayer) return;
  if (elements.selectionToolbar) {
    disposeTooltips(elements.selectionToolbar);
    elements.selectionToolbar.innerHTML = "";
  }
  if (elements.selectionTitle) {
    elements.selectionTitle.textContent = draftWallElement.wallType === "door" ? "Door" : "Wall";
  }
  setSelectionTypeIcon(draftWallElement.wallType === "door" ? "tabler:door" : "tabler:wall");
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = `${draftWallLayer.name} · Drawing…`;
  }
  renderWallSelectionEditor(draftWallLayer, draftWallElement);
  setPanelFocus(true);
}

// Tears down whatever's currently in progress (removes the live preview,
// re-enables map pan/zoom) and clears wallGesture — used both for an
// explicit cancel (Escape, turning the tool off) and a successful commit
// (see commitWallGesture, which calls this after pushing the finished
// element). Deliberately does NOT touch draftWallElement.points itself —
// see its own two cancel-path callers for why (Escape resets it explicitly;
// Backspace-to-zero already emptied it before calling this); resetting it
// unconditionally here would also wipe out a just-committed element, since
// commitWallGesture's own placedElement is the SAME object as
// draftWallElement at the moment this runs.
function teardownWallGesture() {
  wallGesture?.preview?.remove();
  if (wallGesture) {
    baseMapManager.setInteractionEnabled(true);
  }
  wallGesture = null;
}

function buildWallGesturePreview() {
  const overlay = baseMapManager.getOverlayContainer();
  const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  preview.style.position = "absolute";
  preview.style.inset = "0";
  preview.style.width = "100%";
  preview.style.height = "100%";
  preview.style.overflow = "visible";
  preview.style.pointerEvents = "none";
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", draftWallElement.strokeColor || draftWallLayer.settings?.strokeColor || "#0f172a");
  polyline.setAttribute("stroke-width", String(draftWallElement.strokeWidth || draftWallLayer.settings?.strokeWidth || 3));
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("stroke-dasharray", "6 4");
  preview.appendChild(polyline);
  overlay.appendChild(preview);
  wallGesture.preview = preview;
  wallGesture.polyline = polyline;
}

// Redraws the rubber-band preview — every already-placed vertex plus the
// live cursor position (omitted when called from a non-pointer source, e.g.
// Backspace, which just re-shows the committed vertices as they now stand).
// The live cursor position is ALSO snapped when wallSnapEnabled (not just
// the committed vertices resolveWallVertex already snaps) — this is what
// makes snapping actually visible WHILE drawing, not just discoverable
// after the fact by noticing a click landed on-grid: the rubber-band line's
// own live endpoint visibly jumps to the nearest grid corner as the cursor
// approaches it, the same live-snap feedback most polygon/wall tools give.
// No layer-offset applied, matching setupDrawTool's own addPoint — same
// (pre-existing, not introduced here) minor imprecision if the layer's own
// manual position has been dragged off {0,0}; the final committed element
// still renders correctly either way (createVectorLayerElement's own
// rendering does apply the offset), only the live preview during placement
// would be very slightly off in that specific case.
function updateWallGesturePreview(pointerEvent) {
  if (!wallGesture) return;
  const overlay = baseMapManager.getOverlayContainer();
  let cursorPosition = pointerEvent ? resolveClickPosition(baseMapManager, state.map, pointerEvent, overlay) : null;
  if (cursorPosition && wallSnapEnabled) {
    cursorPosition = snapShapeOriginToGrid(cursorPosition, draftWallLayer);
  }
  const allPoints = cursorPosition ? [...draftWallElement.points, cursorPosition] : draftWallElement.points;
  const pixelPoints = allPoints.map((point) => markerPositionToLocalPixel(baseMapManager, state.map, point));
  wallGesture.polyline.setAttribute("points", pixelPoints.map((point) => `${point.x},${point.y}`).join(" "));
}

function commitWallGesture() {
  if (!wallGesture || draftWallElement.points.length < 2) {
    teardownWallGesture();
    return;
  }
  const placedElement = draftWallElement;
  const layer = draftWallLayer;
  recordHistory("draw wall", () => {
    layer.elements = layer.elements || [];
    layer.elements.push(placedElement);
    updateMapTimestamp(state.map);
  });
  teardownWallGesture();
  renderJson();
  // Single-shot, and selects the just-placed wall immediately — matches
  // Shape/Light's own identical behavior (setupShapeTool's own onUp).
  // Clears draftWallElement, but placedElement still references the same
  // (now-committed) object.
  setWallModeActive(false);
  setSelection("vector-path", placedElement.id, { layerId: layer.id });
}

// Click-to-place-vertex wall/door placement — deliberately NOT Draw's own
// continuous-drag-paint gesture (that samples a point on every pointermove,
// producing a jittery many-point polyline from ordinary hand tremor — fine
// for a decorative freehand annotation, actively bad for something that now
// drives a real gameplay mechanic). Click adds a vertex, a dashed rubber-
// band previews the next segment, double-click or Enter commits, Escape
// cancels, Backspace undoes the last vertex. Door type auto-commits the
// instant a 2nd vertex is placed — a door is always exactly one straight
// segment, there's no reason to make the GM double-click for that case.
function setupWallTool() {
  if (!elements.wallToggle || !mapContainer) {
    return;
  }
  updateWallAvailability();
  // Syncs the button's visual .active state with wallSnapEnabled's own
  // default (true) — the HTML's own aria-pressed="true" default has no
  // matching .active class until this runs once.
  elements.wallSnapToggle?.classList.toggle("active", wallSnapEnabled);

  elements.wallToggle.addEventListener("click", () => {
    if (elements.wallToggle.disabled) return;
    setWallModeActive(!wallModeActive);
  });

  elements.wallSnapToggle?.addEventListener("click", () => {
    wallSnapEnabled = !wallSnapEnabled;
    elements.wallSnapToggle.classList.toggle("active", wallSnapEnabled);
    elements.wallSnapToggle.setAttribute("aria-pressed", wallSnapEnabled ? "true" : "false");
  });

  // Resolves a raw click into a wall-vertex position — snapped to the
  // nearest grid corner (snapShapeOriginToGrid, genuinely generic despite
  // its own name — see createWallElement's own comment) when wallSnapEnabled,
  // else the raw clicked point.
  function resolveWallVertex(layer, event) {
    const position = resolveClickPosition(baseMapManager, state.map, event, baseMapManager.getOverlayContainer());
    if (!position) return null;
    return wallSnapEnabled ? snapShapeOriginToGrid(position, layer) : position;
  }

  mapContainer.addEventListener("pointerdown", (event) => {
    if (!wallModeActive || event.button !== 0 || !draftWallElement || !draftWallLayer) return;
    const layer = draftWallLayer;
    event.preventDefault();
    if (!wallGesture) {
      const position = resolveWallVertex(layer, event);
      if (!position) return;
      baseMapManager.setInteractionEnabled(false);
      draftWallElement.points = [position];
      wallGesture = {};
      buildWallGesturePreview();
      updateWallGesturePreview(event);
      return;
    }
    // The second press of a native double-click (event.detail is the
    // browser's own rapid-click counter, standard on pointerdown/mousedown)
    // is treated purely as "finish" — it doesn't add a redundant vertex at
    // essentially the same spot the first press of that same double-click
    // already placed. The paired native "dblclick" listener below then
    // fires and commits whatever's already there.
    if (event.detail >= 2) {
      commitWallGesture();
      return;
    }
    const position = resolveWallVertex(layer, event);
    if (!position) return;
    draftWallElement.points.push(position);
    updateWallGesturePreview(event);
    if (draftWallElement.wallType === "door" && draftWallElement.points.length >= 2) {
      commitWallGesture();
    }
  });

  mapContainer.addEventListener("pointermove", (event) => {
    if (!wallGesture) return;
    updateWallGesturePreview(event);
  });

  mapContainer.addEventListener("dblclick", (event) => {
    if (!wallGesture) return;
    event.preventDefault();
    commitWallGesture();
  });

  // Capture phase, not the default bubble phase — this needs to run BEFORE
  // (and be able to pre-empt, via stopImmediatePropagation) the global
  // Escape/Backspace handler registered later in this file's own init
  // sequence, regardless of which one happens to be registered first in
  // source order. When no gesture is active, every key here is a no-op and
  // the event falls through untouched to that global handler exactly as
  // before this tool existed.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!wallGesture) return;
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        teardownWallGesture();
        if (draftWallElement) draftWallElement.points = [];
        return;
      }
      if (event.key === "Enter") {
        event.stopImmediatePropagation();
        event.preventDefault();
        commitWallGesture();
        return;
      }
      if (event.key === "Backspace") {
        event.stopImmediatePropagation();
        event.preventDefault();
        draftWallElement.points.pop();
        if (!draftWallElement.points.length) {
          teardownWallGesture();
        } else {
          updateWallGesturePreview(null);
        }
      }
    },
    true
  );
}

// Keeps the Shape toggle's enabled state and tooltip in sync with there
// being a grid layer to size against — a shape's Size/Width fields are
// authored directly in cells now (renderVectorShapeSelectionEditor's own
// header comment), not converted through the map's own Scale per cell/
// Scale unit, so those no longer need to be configured just to place a
// shape at all; only the DRAG gesture's own pixelsToCells conversion
// (which needs a grid layer's cell size, nothing about real-world scale)
// still has a real prerequisite. Previously required full Scale/Unit
// configuration too — confirmed stricter than necessary now that Size
// isn't feet-based, so a GM could no longer place ANY shape at all before
// setting up a real-world scale, even though nothing about placing/sizing
// one actually depends on it anymore. No longer requires a selected vector
// layer either — see ensureDrawableVectorLayer's own comment, same as Draw.
function updateShapeAvailability() {
  if (!elements.shapeToggle) return;
  const available = Boolean(findPrimaryGridLayer(state.map));
  elements.shapeToggle.disabled = !available;
  const tooltipTarget = elements.shapeToggleWrap || elements.shapeToggle;
  tooltipTarget.setAttribute(
    "data-bs-title",
    available ? "Draw a Shape/Effect" : "Add a grid layer to enable Shapes/Effects"
  );
  refreshTooltips(tooltipTarget.parentElement || document);
  if (!available && shapeModeActive) {
    setShapeModeActive(false);
  }
}

// --- Shape/Effect picker modal — ported from Press's own #press-pattern-
// modal (initPatternModal/renderPatternThumbnails/renderPatternControls/
// selectPatternPreset, press/js/app.js), reading from shape-effect-
// library.js's own registry instead of pattern-library.js's. Opened only
// from the selection inspector's "Change Shape/Effect" button
// (renderVectorShapeSelectionEditor) for an ALREADY-placed element — the
// toolbar's own pre-placement type select (populateShapeTypeSelect, above)
// is unrelated and stays a plain dropdown, confirmed unchanged with the
// user. Simpler than Press's own controls in one way: a plain color input
// per colorSlot, no alpha-blended hex encoding. Opacity lives here too
// (currentShapeEffectOpacity, alongside the color/param controls) rather
// than as its own separate inspector field — it's a per-preset display
// property just like Fill/Outline, and keeping all three together avoids
// the same value being editable from two different places at once.
let selectedShapeEffectPreset = null;
let currentShapeEffectValues = {};
let currentShapeEffectOpacity = 0.5;
let shapeEffectModalTarget = null; // { layer, shapeElement } being edited

// Shared by both the thumbnail grid (small) and the larger live preview
// pane (same container, different size) — a `kind: "geometry"` preset gets
// a small SVG built from its own `draw()`; a `kind: "particles"` preset
// gets a single representative static frame (40% through its own
// duration) drawn into a small canvas via `seed()`+`run()`, not a live
// animation — avoids running N simultaneous animated thumbnails for no
// real benefit in a picker grid.
function renderShapeEffectPreview(container, preset, values) {
  container.innerHTML = "";
  if (!preset) return;
  // A representative angle/spread for directional presets (cone, line,
  // beam, cone-blast) — pointing up reads clearest in a small square
  // preview. Not the real element being edited; previews never need it.
  const fakeElement = { angleDeg: -90, spreadDeg: 53, widthCells: 1 };
  if (preset.kind === "geometry") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const shapeEl = preset.draw(50, 50, 35, fakeElement, 20);
    const fill = values.fill;
    shapeEl.setAttribute("fill", fill && fill !== "none" ? fill : "none");
    shapeEl.setAttribute("stroke", values.stroke || "#0f172a");
    shapeEl.setAttribute("stroke-width", "3");
    svg.appendChild(shapeEl);
    container.appendChild(svg);
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const particles = preset.seed(35);
  preset.run(ctx, 50, 50, 35, preset.duration * 0.4, values, particles, fakeElement);
}

function renderShapeEffectThumbnails(categoryId) {
  if (!elements.shapeEffectThumbnails) return;
  elements.shapeEffectThumbnails.innerHTML = "";
  const fragment = document.createDocumentFragment();
  getPresetsByCategory(categoryId).forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary p-1 d-flex flex-column align-items-center gap-1";
    button.dataset.shapeEffectId = preset.id;
    button.classList.toggle("active", preset.id === selectedShapeEffectPreset?.id);
    const previewHost = document.createElement("div");
    previewHost.style.width = "48px";
    previewHost.style.height = "48px";
    renderShapeEffectPreview(previewHost, preset, getPresetDefaultValues(preset));
    const label = document.createElement("span");
    label.className = "extra-small";
    label.textContent = preset.label;
    button.append(previewHost, label);
    button.addEventListener("click", () => selectShapeEffectPreset(preset));
    fragment.appendChild(button);
  });
  elements.shapeEffectThumbnails.appendChild(fragment);
}

function updateShapeEffectPreview() {
  if (!selectedShapeEffectPreset || !elements.shapeEffectPreview) return;
  renderShapeEffectPreview(elements.shapeEffectPreview, selectedShapeEffectPreset, currentShapeEffectValues);
  elements.shapeEffectPreview.style.opacity = String(currentShapeEffectOpacity);
}

function renderShapeEffectControls(preset) {
  if (!elements.shapeEffectControls) return;
  elements.shapeEffectControls.innerHTML = "";
  const fragment = document.createDocumentFragment();
  (preset.colorSlots ?? []).forEach((slot) => {
    const raw = String(currentShapeEffectValues[slot.key] ?? slot.default ?? "");
    // A "@"/"=" prefixed value is a binding/formula, not a literal hex —
    // createColorPickerField expects the caller to already know which of
    // its two params a stored string represents (same split its own
    // committedRawText logic works from), rather than guessing itself.
    const isBindingLike = raw.startsWith("@") || raw.startsWith("=");
    const field = createColorPickerField(slot.label, {
      value: isBindingLike ? "" : raw,
      bindingValue: isBindingLike ? raw : "",
      defaultValue: slot.default,
      onManualChange: (hex) => {
        currentShapeEffectValues = { ...currentShapeEffectValues, [slot.key]: hex };
        updateShapeEffectPreview();
      },
      onBindingChange: (text) => {
        currentShapeEffectValues = { ...currentShapeEffectValues, [slot.key]: text };
        updateShapeEffectPreview();
      },
      onClear: () => {
        currentShapeEffectValues = { ...currentShapeEffectValues, [slot.key]: slot.default };
        updateShapeEffectPreview();
      },
      // No evaluate — a map shape/effect has no Character-bound context to
      // resolve a "@..." reference against (unlike Press/Workbench's own
      // template canvas), so a typed binding/formula stores and displays
      // as entered but previews as indeterminate, same as Workbench's own
      // Template editor canvas already does for "=formula" text (this
      // module's own header comment).
    });
    fragment.appendChild(field);
  });
  // Opacity — same range-slider vocabulary every other Opacity in this
  // suite uses (0-1, step 0.05, form-range), applies to every preset,
  // geometry or particle alike, so it's rendered here unconditionally
  // rather than as one more colorSlot-driven entry.
  const opacityWrap = document.createElement("div");
  opacityWrap.className = "d-flex align-items-center justify-content-between gap-2";
  const opacityId = "shapeEffectOpacity";
  const opacityLabel = document.createElement("label");
  opacityLabel.className = "form-label small text-body-secondary mb-0";
  opacityLabel.setAttribute("for", opacityId);
  opacityLabel.textContent = "Opacity";
  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.id = opacityId;
  opacityInput.className = "form-range";
  opacityInput.style.width = "auto";
  opacityInput.min = "0";
  opacityInput.max = "1";
  opacityInput.step = "0.05";
  opacityInput.value = String(currentShapeEffectOpacity);
  opacityInput.addEventListener("input", () => {
    currentShapeEffectOpacity = Number(opacityInput.value);
    updateShapeEffectPreview();
  });
  opacityWrap.append(opacityLabel, opacityInput);
  fragment.appendChild(opacityWrap);
  (preset.params ?? []).forEach((param, index) => {
    const wrap = document.createElement("div");
    wrap.className = "d-flex align-items-center justify-content-between gap-2";
    const id = `shapeEffectParam-${param.key}-${index}`;
    const label = document.createElement("label");
    label.className = "form-label small text-body-secondary mb-0 flex-grow-1";
    label.setAttribute("for", id);
    label.textContent = param.label;
    let input;
    if (param.type === "select") {
      input = document.createElement("select");
      input.className = "form-select form-select-sm";
      input.style.width = "auto";
      (param.options ?? []).forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        input.appendChild(optionEl);
      });
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.className = "form-control form-control-sm";
      input.style.width = "5.5rem";
      if (Number.isFinite(param.min)) input.min = String(param.min);
      if (Number.isFinite(param.max)) input.max = String(param.max);
      if (Number.isFinite(param.step)) input.step = String(param.step);
    }
    input.id = id;
    input.value = currentShapeEffectValues[param.key];
    input.addEventListener("input", () => {
      currentShapeEffectValues = { ...currentShapeEffectValues, [param.key]: input.value };
      updateShapeEffectPreview();
    });
    wrap.append(label, input);
    fragment.appendChild(wrap);
  });
  elements.shapeEffectControls.appendChild(fragment);
}

function selectShapeEffectPreset(preset, initialValues) {
  selectedShapeEffectPreset = preset;
  currentShapeEffectValues = initialValues ?? getPresetDefaultValues(preset);
  if (elements.shapeEffectPreviewLabel) elements.shapeEffectPreviewLabel.textContent = preset.label;
  if (elements.shapeEffectApply) elements.shapeEffectApply.disabled = false;
  renderShapeEffectControls(preset);
  updateShapeEffectPreview();
  elements.shapeEffectThumbnails?.querySelectorAll("[data-shape-effect-id]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shapeEffectId === preset.id);
  });
}

// Called by the selection inspector's own "Change Shape/Effect" button
// (renderVectorShapeSelectionEditor) — opens on the CURRENTLY selected
// element's own preset/category/values pre-populated, not a blank slate.
function openShapeEffectModal(layer, shapeElement) {
  if (!elements.shapeEffectModal || !window.bootstrap?.Modal) return;
  shapeEffectModalTarget = { layer, shapeElement };
  const preset = getPresetById(shapeElement.presetId) || getPresetById("circle");
  const categoryInputs = Array.from(document.querySelectorAll('[name="shape-effect-category"]'));
  const categoryInput = categoryInputs.find((input) => input.value === preset.category);
  if (categoryInput) {
    categoryInput.checked = true;
    renderShapeEffectThumbnails(preset.category);
  }
  currentShapeEffectOpacity = Number.isFinite(shapeElement.opacity) ? shapeElement.opacity : 0.5;
  selectShapeEffectPreset(preset, { ...shapeElement.values });
  window.bootstrap.Modal.getOrCreateInstance(elements.shapeEffectModal).show();
}

function initShapeEffectModal() {
  if (!elements.shapeEffectModal) return;
  renderShapeEffectThumbnails("shapes");
  document.querySelectorAll('[name="shape-effect-category"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      renderShapeEffectThumbnails(input.value);
    });
  });
  elements.shapeEffectApply?.addEventListener("click", () => {
    if (!selectedShapeEffectPreset || !shapeEffectModalTarget) return;
    const { shapeElement } = shapeEffectModalTarget;
    // Same recordHistory + updateMapTimestamp + renderLayerOverlays +
    // renderJson shape renderVectorShapeSelectionEditor's own (closure-
    // scoped, unreachable from here) applyShapeChange uses — inlined
    // rather than shared, since this handler lives outside that function's
    // scope. Followed by a full renderSelection() rebuild (unlike every
    // OTHER field in that panel, which patches in place) — changing the
    // preset itself changes which fields even apply.
    recordHistory("change shape/effect", () => {
      shapeElement.presetId = selectedShapeEffectPreset.id;
      shapeElement.values = { ...currentShapeEffectValues };
      shapeElement.opacity = currentShapeEffectOpacity;
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
    // draftShapeElement's own declaration comment — the modal can be opened
    // on the Shape tool's own in-progress draft now (not just an already-
    // placed shape), so this has to hand back to the SAME draft view
    // instead of the general renderSelection(), or Applying here would
    // silently drop back to whatever state.selection points to underneath
    // it (typically the layer) instead of the draft the GM was still
    // configuring.
    if (shapeElement === draftShapeElement) {
      renderArmedShapeInspector();
    } else {
      renderSelection();
    }
    window.bootstrap?.Modal?.getInstance(elements.shapeEffectModal)?.hide();
  });
}

// Carries everything about a marker that isn't tied to WHERE it sits —
// same intent as duplicateLayerElement's own marker branch, but broader:
// a moved marker should read as "the same token, relocated," not a fresh
// second copy a GM might expect to look different. Two fields
// deliberately excluded: `position` (the caller — the Apply handler
// below — overwrites it with computeMoveMarkerPositions' own output right
// after cloning; the destination map's coordinate system has nothing in
// common with the source's, so createMarkerElement's own {x:0,y:0}
// default here is only ever a placeholder, never what actually lands)
// and `linkedCombatantId` (scoped to the SOURCE map's own active
// Encounter, meaningless anywhere else). overlayIcons isn't a
// createMarkerElement constructor argument at all (always starts `[]`
// there) so it's copied onto the clone afterward.
function cloneMarkerElementForMove(element) {
  const clone = createMarkerElement({
    refKind: element.refKind,
    refId: element.refId,
    refAnchor: element.refAnchor ? { ...element.refAnchor } : null,
    label: element.label,
    image: element.image,
    outlineColor: element.outlineColor,
    showOutline: element.showOutline,
    shape: element.shape,
    sizeCells: element.sizeCells,
    heightCells: element.heightCells,
    opacity: element.opacity,
    contents: (element.contents || []).map((entry) => ({ ...entry })),
    claimTarget: element.claimTarget,
  });
  clone.overlayIcons = (element.overlayIcons || []).map((icon) => ({ ...icon }));
  return clone;
}

// Per-marker "reset near origin" targets for a batch of moved markers,
// aware of the DESTINATION map's own base map type (unknowable at clone
// time — cloneMarkerElementForMove has no map context of its own) — two
// real correctness needs, not just cosmetic ones:
// - A tile base map stores position as {lat, lng}, never {x, y}
//   (hasValidMarkerPosition, map-viewer.js); createMarkerElement's own
//   {x:0,y:0} default fails that check entirely, so every moved marker
//   would silently NOT RENDER at all on a tile destination map. Basing
//   it on the destination's own current view center (falling back to
//   getDefaultView("tile")'s {lat:20,lng:0} if the map has no `view` of
//   its own yet) at least lands markers somewhere near what's actually
//   on screen, matching "reset near origin" in spirit for a coordinate
//   system that doesn't have a literal (0,0) worth using.
// - Every marker in the batch landing on the EXACT same point stacked
//   them directly on top of one another, functionally invisible/
//   unclickable as separate tokens the moment there's more than one.
//   Staggered by a small, fixed per-axis step (pixels for image/canvas,
//   degrees for tile) so they're visibly and clickably distinct — not
//   meant to be precise placement, the GM repositions from here same as
//   a single moved marker always has.
const MOVE_MARKER_OFFSET_PX = 32;
const MOVE_MARKER_OFFSET_DEG = 0.0004;
function computeMoveMarkerPositions(destPayload, count) {
  const isTile = destPayload?.baseMap?.type === "tile";
  const base = isTile ? destPayload?.view?.center || { lat: 20, lng: 0 } : { x: 0, y: 0 };
  return Array.from({ length: count }, (_, index) =>
    isTile
      ? { lat: base.lat - index * MOVE_MARKER_OFFSET_DEG, lng: base.lng + index * MOVE_MARKER_OFFSET_DEG }
      : { x: base.x + index * MOVE_MARKER_OFFSET_PX, y: base.y + index * MOVE_MARKER_OFFSET_PX }
  );
}

// Captured at open time (not re-resolved from state.selection at Apply
// time) — same reasoning as shapeEffectModalTarget just above: the modal
// stays open across an await (populating the layer picker), and nothing
// should change WHICH markers move if a stray render happens to touch
// state.selection in that window.
let moveMarkerModalEntries = [];

// Opened from either selection toolbar (single marker or the bulk
// "marker-elements" panel — both call this the same way, this function
// itself resolves which one is current). Deliberately re-checks
// currentUserHasFullMapAccess() here too, not just at the button's own
// render-time gate — belt-and-suspenders against a stale toolbar button
// surviving a permission change without a re-render in between.
function openMoveMarkerModal() {
  if (!elements.moveMarkerModal || !window.bootstrap?.Modal || !currentUserHasFullMapAccess()) return;
  const selection = state.selection;
  let entries = [];
  if (selection.kind === "marker-element") {
    const layer = state.map.layers.find((entry) => entry.id === selection.layerId);
    const markerElement = layer?.elements?.find((entry) => entry.id === selection.id);
    if (layer && markerElement) entries = [{ layer, markerElement }];
  } else if (selection.kind === "marker-elements") {
    entries = resolveSelectedMarkerElements(selection);
  }
  if (!entries.length) return;
  moveMarkerModalEntries = entries;
  if (elements.moveMarkerTitle) {
    elements.moveMarkerTitle.textContent = entries.length === 1 ? "Move Marker" : `Move ${entries.length} Markers`;
  }
  if (elements.moveMarkerMapSelect) {
    elements.moveMarkerMapSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = "Select a map";
    elements.moveMarkerMapSelect.appendChild(placeholder);
  }
  if (elements.moveMarkerLayerField) elements.moveMarkerLayerField.classList.add("d-none");
  if (elements.moveMarkerNewLayerNote) elements.moveMarkerNewLayerNote.classList.add("d-none");
  if (elements.moveMarkerApply) elements.moveMarkerApply.disabled = true;
  fetchMapPickerEntries().then((mapEntries) => {
    if (!elements.moveMarkerMapSelect) return;
    // Can't move a marker to the map it's already on.
    mapEntries
      .filter((entry) => entry.id !== state.map.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.name;
        elements.moveMarkerMapSelect.appendChild(option);
      });
  });
  window.bootstrap.Modal.getOrCreateInstance(elements.moveMarkerModal).show();
}

function initMoveMarkerModal() {
  if (!elements.moveMarkerModal) return;

  function updateApplyEnabled() {
    if (!elements.moveMarkerApply) return;
    const hasMap = Boolean(elements.moveMarkerMapSelect?.value);
    const layerFieldHidden = elements.moveMarkerLayerField?.classList.contains("d-none");
    const hasLayer = layerFieldHidden || Boolean(elements.moveMarkerLayerSelect?.value);
    elements.moveMarkerApply.disabled = !(hasMap && hasLayer);
  }

  elements.moveMarkerMapSelect?.addEventListener("change", async () => {
    const destId = elements.moveMarkerMapSelect.value;
    if (elements.moveMarkerLayerSelect) elements.moveMarkerLayerSelect.innerHTML = "";
    if (!destId || !dataManager) {
      elements.moveMarkerLayerField?.classList.add("d-none");
      elements.moveMarkerNewLayerNote?.classList.add("d-none");
      updateApplyEnabled();
      return;
    }
    let payload = null;
    try {
      const result = await dataManager.get("map", destId, { preferLocal: false });
      payload = result?.payload || null;
    } catch (error) {
      payload = null;
    }
    // Stale response — the GM picked a DIFFERENT map while this fetch was
    // in flight. Discard rather than populate the layer picker for a map
    // that's no longer selected.
    if (elements.moveMarkerMapSelect.value !== destId) return;
    const markerLayers = (payload?.layers || []).filter((layer) => layer.type === "marker");
    if (!markerLayers.length) {
      elements.moveMarkerLayerField?.classList.add("d-none");
      elements.moveMarkerNewLayerNote?.classList.remove("d-none");
    } else {
      elements.moveMarkerNewLayerNote?.classList.add("d-none");
      elements.moveMarkerLayerField?.classList.remove("d-none");
      if (elements.moveMarkerLayerSelect) {
        markerLayers.forEach((layer) => {
          const option = document.createElement("option");
          option.value = layer.id;
          option.textContent = layer.name;
          elements.moveMarkerLayerSelect.appendChild(option);
        });
      }
    }
    updateApplyEnabled();
  });
  elements.moveMarkerLayerSelect?.addEventListener("change", updateApplyEnabled);

  elements.moveMarkerApply?.addEventListener("click", async () => {
    const destId = elements.moveMarkerMapSelect?.value;
    const entries = moveMarkerModalEntries;
    if (!destId || !entries.length || !dataManager) return;
    elements.moveMarkerApply.disabled = true;
    let destPayload = null;
    try {
      const result = await dataManager.get("map", destId, { preferLocal: false });
      destPayload = result?.payload || createMapModel();
      let destLayer = (destPayload.layers || []).find(
        (layer) => layer.type === "marker" && layer.id === elements.moveMarkerLayerSelect?.value
      );
      if (!destLayer) {
        destLayer = createLayer({ type: "marker" });
        destPayload.layers = [...(destPayload.layers || []), destLayer];
      }
      const positions = computeMoveMarkerPositions(destPayload, entries.length);
      const movedClones = entries.map(({ markerElement }, index) => {
        const clone = cloneMarkerElementForMove(markerElement);
        clone.position = positions[index];
        return clone;
      });
      destLayer.elements = [...(destLayer.elements || []), ...movedClones];
      updateMapTimestamp(destPayload);
      await dataManager.save("map", destId, destPayload);
    } catch (error) {
      status.show(`Unable to move marker(s): ${error.message}`, { type: "error", timeout: 4000 });
      elements.moveMarkerApply.disabled = false;
      return;
    }
    // Only remove the originals from the CURRENTLY open map once the
    // destination write above has actually succeeded — a failed cross-map
    // save must never lose the source marker.
    const idsByLayer = new Map();
    entries.forEach(({ layer, markerElement }) => {
      if (!idsByLayer.has(layer.id)) idsByLayer.set(layer.id, new Set());
      idsByLayer.get(layer.id).add(markerElement.id);
    });
    recordHistory("move marker to another map", () => {
      idsByLayer.forEach((ids, layerId) => {
        const layer = state.map.layers.find((entry) => entry.id === layerId);
        if (!layer) return;
        layer.elements = (layer.elements || []).filter((entry) => !ids.has(entry.id));
      });
      updateMapTimestamp(state.map);
    });
    // Persists that same removal to the server right away — see this
    // function's own header comment for why a move can't leave it as an
    // ordinary batched, Save-button-pending edit the way a plain Delete
    // does.
    void autoSaveRemovedMarkerElements(idsByLayer);
    setSelection(null);
    const destName = elements.moveMarkerMapSelect?.selectedOptions?.[0]?.textContent || "the destination map";
    status.show(`Moved ${entries.length} marker${entries.length === 1 ? "" : "s"} to ${destName}.`, {
      type: "success",
      timeout: 2500,
    });
    window.bootstrap?.Modal?.getInstance(elements.moveMarkerModal)?.hide();
    moveMarkerModalEntries = [];
  });
}

// Same reasoning as setDrawModeActive just above — plus, unlike Draw, Shape
// has a right-pane Inspector view of its own now (renderArmedShapeInspector)
// that has to take over/hand back the panel exactly when arming/disarming
// does. Creates/discards draftShapeElement here — the ONE place its whole
// lifecycle is owned (see its own declaration comment).
function setShapeModeActive(active) {
  shapeModeActive = active;
  elements.shapeToggle?.classList.toggle("active", shapeModeActive);
  elements.shapeToggle?.setAttribute("aria-pressed", shapeModeActive ? "true" : "false");
  mapContainer?.classList.toggle("orrery-shaping", shapeModeActive);
  updateDrawColorVisibility();
  renderLayerOverlays();
  if (shapeModeActive) {
    draftShapeLayer = ensureDrawableVectorLayer();
    draftShapeElement = createVectorShapeElement({
      presetId: lastShapePresetId,
      origin: { x: 0, y: 0 },
      values: lastShapeValues ? { ...lastShapeValues } : undefined,
    });
    renderArmedShapeInspector();
  } else {
    if (draftShapeElement) {
      lastShapePresetId = draftShapeElement.presetId;
      lastShapeValues = { ...draftShapeElement.values };
    }
    draftShapeElement = null;
    draftShapeLayer = null;
    // Hands the panel back to whatever setSelection/renderSelection would
    // otherwise be showing.
    renderSelection();
  }
}

// The right-pane Inspector view shown for the ENTIRE time the Shape/Effect
// tool is armed — draftShapeElement's own declaration comment has the full
// reasoning for why this renders through the EXACT SAME
// renderVectorShapeSelectionEditor an already-placed shape uses (Type,
// Attach to Token, Label, Position, Size/Angle/Spread/Width, Outline width,
// Snap to Grid, Loop/Play — everything), rather than a separate simplified
// view. Only this wrapper's own title/details/icon (and clearing the
// toolbar first, which renderSelection() normally does but this bypasses)
// are specific to the "drawing" state; the editor body itself is 100% the
// shared function.
function renderArmedShapeInspector() {
  if (!draftShapeElement || !draftShapeLayer) return;
  const preset = getPresetById(draftShapeElement.presetId) || getPresetById("circle");
  if (elements.selectionToolbar) {
    disposeTooltips(elements.selectionToolbar);
    elements.selectionToolbar.innerHTML = "";
  }
  if (elements.selectionTitle) {
    elements.selectionTitle.textContent = preset.kind === "particles" ? "Effect" : "Shape";
  }
  setSelectionTypeIcon(preset.kind === "particles" ? "tabler:sparkles" : "tabler:target");
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = `${draftShapeLayer.name} · Drawing…`;
  }
  renderVectorShapeSelectionEditor(draftShapeLayer, draftShapeElement);
  setPanelFocus(true);
}

// Shapes (Circle/Cone/Line/Square) or Effects (Burst/Beam/Cone Blast/Pulse)
// onto the selected vector layer — the SAME click-drag-commit gesture
// Draw's own freehand stroke uses (a live preview appended straight to the
// overlay, torn down on release, committed as one element via
// recordHistory), sized through the exact same screen-pixel-distance-to-
// cells conversion Measure's own readout uses (pixelsToCells) instead of
// any new coordinate math. The live preview reuses map-viewer.js's own
// renderShapeElement — the same function that renders a COMMITTED geometry
// shape — against a throwaway element object, so there's exactly one place
// in the whole codebase that knows how to turn a shape's fields into an SVG
// primitive. Placement behavior is unchanged from before this preset
// catalog existed — only the TYPE list got longer.
function setupShapeTool() {
  if (!elements.shapeToggle || !mapContainer) {
    return;
  }
  updateShapeAvailability();

  elements.shapeToggle.addEventListener("click", () => {
    if (elements.shapeToggle.disabled) return;
    // Same reasoning as setupDrawTool's own click handler — a re-render
    // picks up the orrery-shaping cursor class immediately. Existing shapes
    // stay selectable/draggable regardless of this toggle now (see
    // onVectorPathClick/onShapeDragEnd's own comment) — only NEW placement
    // gates on it.
    setShapeModeActive(!shapeModeActive);
  });

  mapContainer.addEventListener("pointerdown", (event) => {
    if (!shapeModeActive || event.button !== 0 || !draftShapeElement || !draftShapeLayer) return;
    const layer = draftShapeLayer;
    event.preventDefault();
    baseMapManager.setInteractionEnabled(false);
    const overlay = baseMapManager.getOverlayContainer();
    const origin = resolveClickPosition(baseMapManager, state.map, event, overlay);
    if (!origin) {
      baseMapManager.setInteractionEnabled(true);
      return;
    }
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const offset = getMarkerLayerOffset(state.map, layer);

    const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    preview.style.position = "absolute";
    preview.style.inset = "0";
    preview.style.width = "100%";
    preview.style.height = "100%";
    preview.style.overflow = "visible";
    preview.style.pointerEvents = "none";
    overlay.appendChild(preview);

    // Type/colors were already picked from the right-pane Inspector before
    // this gesture even started (renderArmedShapeInspector) and live on
    // draftShapeElement already — this gesture only ever decides
    // Size/Angle/Position, so it mutates the SAME draft object rather than
    // tracking its own local copies. A full rebuild here (not just the
    // live dataAttr update onMove uses) is correct exactly once, so
    // Position X/Y reflect the real click point.
    draftShapeElement.origin = origin;
    draftShapeElement.sizeCells = 0;
    draftShapeElement.angleDeg = 0;
    renderArmedShapeInspector();

    function drawPreview() {
      preview.innerHTML = "";
      // A "particles" preset (an Effect) has no live drag preview here —
      // renderShapeElement stays scoped to static geometry (see its own
      // header comment); its own animated rendering is a separate,
      // canvas-based system. A known, temporary-in-implementation-order gap
      // only (no visual feedback while dragging to size an Effect), not a
      // functional one — the placed/committed element is real either way.
      const preset = getPresetById(draftShapeElement.presetId) || getPresetById("circle");
      if (preset.kind !== "geometry") return;
      renderShapeElement(
        preview,
        baseMapManager,
        state.map,
        layer,
        { ...draftShapeElement, id: "shape-preview" },
        offset,
        {}
      );
    }
    drawPreview();

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      const cells = pixelsToCells(baseMapManager, state.map, Math.hypot(dx, dy));
      draftShapeElement.sizeCells = cells === null ? 0 : snapCellsToWholeUnit(state.map, cells);
      draftShapeElement.angleDeg = cells === null ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
      drawPreview();
      // Live-updates ONLY the Size/Angle inputs already showing in the
      // right pane (the same fields renderArmedShapeInspector rendered via
      // the normal post-placement editor) — no full rebuild mid-drag, which
      // would be wasteful and could disrupt an open color-picker popover.
      const sizeInput = elements.selectionEditor?.querySelector("[data-shape-size-input]");
      if (sizeInput) sizeInput.value = draftShapeElement.sizeCells.toFixed(1);
      const angleInput = elements.selectionEditor?.querySelector("[data-shape-angle-input]");
      if (angleInput) angleInput.value = Math.round(draftShapeElement.angleDeg);
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      baseMapManager.setInteractionEnabled(true);
      preview.remove();
      if (draftShapeElement.sizeCells > 0) {
        const placedElement = draftShapeElement;
        // Snap to Grid defaults on (createVectorShapeElement's own
        // snapToGrid default) — new shapes land pre-snapped so the toggle's
        // initial checked state actually matches what just happened, not a
        // stale claim about an unsnapped placement.
        placedElement.origin = snapShapeOriginToGrid(placedElement.origin, layer);
        recordHistory("place shape", () => {
          layer.elements = layer.elements || [];
          layer.elements.push(placedElement);
          updateMapTimestamp(state.map);
        });
        renderJson();
        // Single-shot — see the Draw tool's own identical comment above.
        // Clears draftShapeElement, but placedElement still references the
        // same (now-committed) object, so nothing below is affected by it.
        setShapeModeActive(false);
        // Selects the just-placed shape/effect immediately, rather than
        // leaving whatever was selected before drawing (typically the
        // layer) — a GM's very next move after placing one is almost always
        // adjusting its color/size/attachment in the inspector, so landing
        // there without an extra click matters more here than it does for a
        // plain drawn path (no per-placement fields of its own to jump to).
        // setSelection's own full render (renderLayerOverlays included)
        // already covers what setShapeModeActive's call above did, so this
        // isn't a wasted duplicate — it's the render that actually reflects
        // the new selection.
        setSelection("vector-path", placedElement.id, { layerId: layer.id });
        // VTT-like immediacy — see the Draw tool's own identical comment
        // above.
        if (mapExistsOnServer) {
          void persistNewElement({
            dataManager,
            mapId: state.map.id,
            shareToken: currentShareToken,
            layerId: layer.id,
            element: placedElement,
          })
            .then(() => {
              syncCleanSnapshotForElement(layer.id, placedElement.id, placedElement);
              mapWatcher?.noteLocalWrite();
            })
            .catch((error) => {
              status?.show(error?.message || "Unable to save that shape.", { type: "danger" });
            });
        }
      } else {
        // Too small to commit (a click with no real drag) — nothing got
        // placed, and the tool is still armed (this doesn't disarm it), so
        // back to the "ready to place" view, not renderSelection() — the
        // Inspector should keep showing the armed Type/color editor, not
        // whatever was selected before the tool was ever armed.
        renderArmedShapeInspector();
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// Same disabled-with-explanatory-tooltip pattern as updateShapeAvailability
// — a light's Range field is authored directly in cells too, same as
// Shape's own Size/Width, so it needs only a grid layer to size against,
// not a fully configured Scale per cell/Scale unit (see that function's own
// comment for the full reasoning). lightModeActive does NOT gate existing
// lights' own click-through the way drawModeActive/wallModeActive do (see
// that variable's own declaration comment) — a placed light stays
// immediately selectable/draggable even while the tool is still armed,
// matching how a placed shape already works.
// No longer requires a selected vector layer — see ensureDrawableVectorLayer's
// own comment, same as Draw/Shape/Wall.
// Same reasoning as setShapeModeActive/setDrawModeActive — one place that
// owns lightModeActive's own toggle-button/cursor-class/re-render side
// effects, called from every place that changes it (the toolbar click, the
// single-shot auto-off after placing, and this function's own disable
// path) instead of each duplicating the same four lines.
function setLightModeActive(active) {
  lightModeActive = active;
  elements.lightToggle?.classList.toggle("active", lightModeActive);
  elements.lightToggle?.setAttribute("aria-pressed", lightModeActive ? "true" : "false");
  mapContainer?.classList.toggle("orrery-lighting", lightModeActive);
  renderLayerOverlays();
  if (lightModeActive) {
    draftLightLayer = ensureDrawableVectorLayer();
    // Light has no "last used" memory concept to seed from (see this
    // module's own declaration comment) — every armed Light starts at the
    // same rest state (createLightElement's own defaults), unlike Shape's
    // lastShapePresetId/lastShapeValues.
    draftLightElement = createLightElement({ origin: { x: 0, y: 0 }, rangeCells: 0 });
    renderArmedLightInspector();
  } else {
    draftLightElement = null;
    draftLightLayer = null;
    renderSelection();
  }
}

function renderArmedLightInspector() {
  if (!draftLightElement || !draftLightLayer) return;
  if (elements.selectionToolbar) {
    disposeTooltips(elements.selectionToolbar);
    elements.selectionToolbar.innerHTML = "";
  }
  if (elements.selectionTitle) {
    elements.selectionTitle.textContent = "Light";
  }
  setSelectionTypeIcon("tabler:bulb");
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = `${draftLightLayer.name} · Drawing…`;
  }
  renderLightSelectionEditor(draftLightLayer, draftLightElement);
  setPanelFocus(true);
}

function updateLightAvailability() {
  if (!elements.lightToggle) return;
  const available = Boolean(findPrimaryGridLayer(state.map));
  elements.lightToggle.disabled = !available;
  const tooltipTarget = elements.lightToggleWrap || elements.lightToggle;
  tooltipTarget.setAttribute(
    "data-bs-title",
    available ? "Place a dynamic light" : "Add a grid layer to enable dynamic lights"
  );
  refreshTooltips(tooltipTarget.parentElement || document);
  if (!available && lightModeActive) {
    setLightModeActive(false);
  }
}

// Reuses the Shape tool's own click-drag-commit gesture almost verbatim — a
// light is geometrically a circle (origin + range), so there's no shape-type
// picker, but the live preview reuses map-viewer.js's own renderLightElement
// against a throwaway element, same "one place in the codebase that knows
// how to turn this element's fields into an SVG primitive" reasoning
// setupShapeTool's own preview already follows.
function setupLightTool() {
  if (!elements.lightToggle || !mapContainer) {
    return;
  }
  updateLightAvailability();

  elements.lightToggle.addEventListener("click", () => {
    if (elements.lightToggle.disabled) return;
    setLightModeActive(!lightModeActive);
  });

  mapContainer.addEventListener("pointerdown", (event) => {
    if (!lightModeActive || event.button !== 0 || !draftLightElement || !draftLightLayer) return;
    const layer = draftLightLayer;
    event.preventDefault();
    baseMapManager.setInteractionEnabled(false);
    const overlay = baseMapManager.getOverlayContainer();
    const origin = resolveClickPosition(baseMapManager, state.map, event, overlay);
    if (!origin) {
      baseMapManager.setInteractionEnabled(true);
      return;
    }
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const offset = getMarkerLayerOffset(state.map, layer);

    const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    preview.style.position = "absolute";
    preview.style.inset = "0";
    preview.style.width = "100%";
    preview.style.height = "100%";
    preview.style.overflow = "visible";
    preview.style.pointerEvents = "none";
    overlay.appendChild(preview);

    // Color/opacity were already picked from the right-pane Inspector
    // before this gesture even started (renderArmedLightInspector) and live
    // on draftLightElement already — see setupShapeTool's own identical
    // reasoning for why this gesture mutates the SAME draft object rather
    // than tracking local copies. A full rebuild here (not just the live
    // dataAttr update onMove uses) is correct exactly once, so Position X/Y
    // reflect the real click point.
    draftLightElement.origin = origin;
    draftLightElement.rangeCells = 0;
    renderArmedLightInspector();

    function drawPreview() {
      preview.innerHTML = "";
      renderLightElement(preview, baseMapManager, state.map, layer, { ...draftLightElement, id: "light-preview" }, offset, {});
    }
    drawPreview();

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      const cells = pixelsToCells(baseMapManager, state.map, Math.hypot(dx, dy));
      draftLightElement.rangeCells = cells === null ? 0 : snapCellsToWholeUnit(state.map, cells);
      drawPreview();
      // Live-updates ONLY the Range input already showing in the right pane
      // (the same field renderArmedLightInspector rendered via the normal
      // post-placement editor) — see setupShapeTool's own identical
      // reasoning for why this skips a full rebuild mid-drag.
      const rangeInput = elements.selectionEditor?.querySelector("[data-light-range-input]");
      if (rangeInput) rangeInput.value = draftLightElement.rangeCells.toFixed(1);
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      baseMapManager.setInteractionEnabled(true);
      preview.remove();
      if (draftLightElement.rangeCells > 0) {
        const placedElement = draftLightElement;
        recordHistory("place light", () => {
          layer.elements = layer.elements || [];
          layer.elements.push(placedElement);
          updateMapTimestamp(state.map);
        });
        renderJson();
        // Single-shot, and selects the just-placed light immediately —
        // matches Shape's own identical behavior (setupShapeTool's own
        // onUp). Clears draftLightElement, but placedElement still
        // references the same (now-committed) object.
        setLightModeActive(false);
        setSelection("vector-path", placedElement.id, { layerId: layer.id });
      } else {
        // Too small to commit — see setupShapeTool's own identical branch.
        renderArmedLightInspector();
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

// The account's own single "active campaign" (set from the header's user
// menu — see auth-ui.js's renderUserMenu/data-campaign-select, and
// dataManager.getActiveGroup/setActiveGroup) — reused here rather than
// giving Orrery its own separate campaign picker, which would just be a
// second, easy-to-desync place to pick the same thing the header already
// asks for once, shared across every tool.
function getActiveCampaignGroupId() {
  return dataManager?.getActiveGroup?.()?.groupId || "";
}

// A dedicated overlay for ping dots, lazily created as a SIBLING of the
// regular layer overlay (baseMapManager.getOverlayContainer()'s own
// parent — the pan/zoom-transformed element either base map type already
// positions its overlay host inside, so a sibling there still lands in the
// same coordinate space) rather than a child of the overlay host itself.
// Necessary because renderMapLayers does `overlay.innerHTML = ""` on every
// single re-render (any selection change, any edit, every ~10s poll tick)
// — a ping appended directly into that container could get wiped out well
// before its own fade animation finished, or even before painting a single
// frame, which is exactly why pings were never visibly showing up at all.
function getPingOverlayHost() {
  const overlay = baseMapManager.getOverlayContainer();
  const parent = overlay?.parentElement;
  if (!parent) return null;
  let host = parent.querySelector("[data-ping-overlay-host]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.pingOverlayHost = "";
    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.width = "100%";
    host.style.height = "100%";
    host.style.pointerEvents = "none";
    parent.appendChild(host);
  }
  return host;
}

// Renders someone's ping (a click-to-ping broadcast — see
// setupPingTool below and server/state.py's ServerState.pending_pings) as a
// transient dot on the map. Called for BOTH remote pings (via the live
// watcher's onPing) and the local GM's own — there's no separate optimistic
// render path (see setupPingTool's own comment on why); every ping, including
// your own, arrives back through the same live-stream echo.
function renderIncomingPing({ position, by }) {
  if (!position) return;
  const host = getPingOverlayHost();
  if (!host) return;
  host.appendChild(createPingMarker(baseMapManager, state.map, position, by || ""));
}

// Click-to-ping — a transient pointer broadcast to a campaign group's table
// (NOT one of Orrery's own map "Groups," the grid-cell-organizing concept
// used elsewhere in this file — this is the account's real campaign/session
// group, the same concept the Dashboard/spotlight system uses). Requires an
// active campaign (see getActiveCampaignGroupId), both because the
// server-side ping endpoint requires one and because that's what activates
// the live-stream subscription this whole feature rides on (see
// watchCurrentMap/map-live-sync.js's own onPing wiring) — no active
// campaign means no live connection to echo the ping back through at all,
// so the toggle stays disabled until one's set from the header menu.
function setupPingTool() {
  if (!elements.pingToggle || !mapContainer) {
    return;
  }
  let active = false;

  function updateToggleAvailability() {
    const hasGroup = Boolean(getActiveCampaignGroupId());
    elements.pingToggle.disabled = !hasGroup;
    // A disabled button with no explanation just looks broken — the
    // tooltip is the only visible signal here, so it has to say WHY, not
    // just repeat what the icon already implies. Set on the WRAPPING span
    // (data-ping-toggle-wrap), not the button — a native `disabled` button
    // doesn't reliably fire the hover/focus events Bootstrap's tooltip
    // listens for, so a tooltip on the button itself can silently never
    // show while disabled (confirmed: exactly what happened here). Standard
    // Bootstrap pattern for this — see their own disabled-button-tooltip
    // docs example.
    const tooltipTarget = elements.pingToggleWrap || elements.pingToggle;
    tooltipTarget.setAttribute(
      "data-bs-title",
      hasGroup ? "Click the map to ping" : "Select a campaign from the account menu (top right) to enable pinging"
    );
    refreshTooltips(tooltipTarget.parentElement || document);
    if (!hasGroup && active) {
      active = false;
      elements.pingToggle.classList.remove("active");
      elements.pingToggle.setAttribute("aria-pressed", "false");
      mapContainer.classList.remove("orrery-pinging");
    }
  }

  updateToggleAvailability();

  // The header's own campaign switcher (auth-ui.js) fires this on every
  // change, from any tool's page — picking up on it here means switching
  // campaigns from the header takes effect immediately without a reload,
  // same as every other "active campaign"-aware surface in the suite.
  window.addEventListener("workbench:active-group-changed", () => {
    updateToggleAvailability();
    if (state.map.id) {
      watchCurrentMap(state.map.id);
    }
  });

  elements.pingToggle.addEventListener("click", () => {
    if (elements.pingToggle.disabled) return;
    active = !active;
    elements.pingToggle.classList.toggle("active", active);
    elements.pingToggle.setAttribute("aria-pressed", active ? "true" : "false");
    mapContainer.classList.toggle("orrery-pinging", active);
  });

  mapContainer.addEventListener("pointerdown", (event) => {
    if (!active || event.button !== 0 || !dataManager) return;
    const groupId = getActiveCampaignGroupId();
    if (!groupId) return;
    const overlay = baseMapManager.getOverlayContainer();
    if (!overlay) return;
    const position = resolveClickPosition(baseMapManager, state.map, event, overlay);
    if (!position) return;
    // Render locally right away rather than relying purely on the
    // live-stream echo to send it back — the whole SSE round-trip (server
    // record, next 1s poll tick, connection delivery, client dispatch) is a
    // lot of links for feedback on your OWN click to depend on end to end,
    // and any single one having trouble (a slow/stalled connection, a
    // reconnect in progress) meant the pinger saw literally nothing happen.
    // Every OTHER viewer's copy still only ever arrives via the real echo.
    renderIncomingPing({ position, by: dataManager.session?.user?.username || "You" });
    void dataManager.postMapPing({ groupId, position }).catch((error) => {
      status.show(error.message || "Unable to send ping.", { type: "error", timeout: 3000 });
    });
  });
}

// Keeps the Measure toggle's enabled state and tooltip in sync with
// state.map.measurement — called on map load/switch (applyMapSnapshot) and
// whenever the Scale per cell/Scale unit fields change (setupMapEvents), not
// just once at startup, since either can change mid-session.
function updateMeasureAvailability() {
  if (!elements.measureToggle) return;
  const configured = hasMapMeasurementConfigured(state.map);
  elements.measureToggle.disabled = !configured;
  const tooltipTarget = elements.measureToggleWrap || elements.measureToggle;
  tooltipTarget.setAttribute(
    "data-bs-title",
    configured ? "Measure distance" : "Set Scale per cell and Scale unit (bottom of Map Properties) to enable measuring"
  );
  refreshTooltips(tooltipTarget.parentElement || document);
  if (!configured) {
    elements.measureToggle.classList.remove("active");
    elements.measureToggle.setAttribute("aria-pressed", "false");
    mapContainer?.classList.remove("orrery-measuring");
  }
}

// Click-drag anywhere on the map measures the straight-line distance
// between the two points, converted through the primary grid layer's own
// on-screen cell size and the map's own configured scale/unit. Deliberately
// a pure SCREEN-PIXEL-DELTA measurement (start/end clientX/clientY, divided
// by the grid's own on-screen cell size from getGridCellSize, which already
// bakes in the current zoom) rather than converting either point through a
// specific layer's own local coordinate space — a relative distance needs
// no absolute position at all, which sidesteps the same base-map-type/
// layer-offset coordinate reconciliation snapMarkerPositionToGrid has to
// account for.
function setupMeasureTool() {
  if (!elements.measureToggle || !mapContainer) {
    return;
  }
  let active = false;
  let dragging = false;
  updateMeasureAvailability();

  function setReadout(text) {
    if (!elements.measureReadout) return;
    elements.measureReadout.textContent = text || "";
    elements.measureReadout.classList.toggle("d-none", !text);
  }

  function formatDistance(pixelDistance) {
    return formatMeasuredDistance(baseMapManager, state.map, pixelDistance);
  }

  // Drawn in plain screen (clientX/clientY) space, same as the distance math
  // above — a straight line from the pointerdown point to the live cursor
  // position needs no map-local coordinate conversion at all, it's already
  // exactly what's being measured. Appended to <body> (position: fixed, so
  // it tracks the viewport regardless of any scroll/layout underneath it),
  // not the map overlay, since it's a screen-space UI affordance, not map
  // content.
  function createMeasureLine(startX, startY) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "orrery-measure-line-overlay");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(startX));
    line.setAttribute("y1", String(startY));
    line.setAttribute("x2", String(startX));
    line.setAttribute("y2", String(startY));
    svg.appendChild(line);
    const startDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    startDot.setAttribute("cx", String(startX));
    startDot.setAttribute("cy", String(startY));
    startDot.setAttribute("r", "4");
    svg.appendChild(startDot);
    document.body.appendChild(svg);
    return {
      update(endX, endY) {
        line.setAttribute("x2", String(endX));
        line.setAttribute("y2", String(endY));
      },
      remove() {
        svg.remove();
      },
    };
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    baseMapManager.setInteractionEnabled(false);
    const startX = event.clientX;
    const startY = event.clientY;
    const measureLine = createMeasureLine(startX, startY);
    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      measureLine.update(moveEvent.clientX, moveEvent.clientY);
      setReadout(formatDistance(Math.hypot(dx, dy)));
    };
    const onUp = () => {
      dragging = false;
      baseMapManager.setInteractionEnabled(true);
      measureLine.remove();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  mapContainer.addEventListener("pointerdown", onPointerDown);

  elements.measureToggle.addEventListener("click", () => {
    active = !active;
    elements.measureToggle.classList.toggle("active", active);
    elements.measureToggle.setAttribute("aria-pressed", active ? "true" : "false");
    mapContainer.classList.toggle("orrery-measuring", active);
    if (!active && !dragging) {
      setReadout("");
    }
  });
}

function setupActionEvents() {
  if (elements.undoButton) {
    elements.undoButton.addEventListener("click", () => undo());
  }
  if (elements.redoButton) {
    elements.redoButton.addEventListener("click", () => redo());
  }
  if (elements.selectionClear) {
    elements.selectionClear.addEventListener("click", () => setSelection(null));
  }

  // "Click off" any selected layer/group/view — the X button was the only
  // way to deselect before this, which isn't discoverable and doesn't match
  // how clicking empty space deselects in basically every other editor.
  // Excludes clicks landing on any actual control (button/input/select/
  // textarea/link) AND anywhere inside a .list-group-item row — otherwise
  // an imprecise click near a layer's own badge/padding (not its name
  // button) would deselect it instead of doing nothing, which would feel
  // like a misclick trap rather than "clicking elsewhere."
  const leftPane = document.querySelector('[data-pane-content="left"]');
  if (leftPane) {
    leftPane.addEventListener("click", (event) => {
      if (state.selection.kind === null) return;
      if (event.target.closest("button, input, select, textarea, a, .list-group-item")) return;
      setSelection(null);
    });
  }

  // Same "click off to deselect" convenience for the map canvas itself —
  // previously there was none: every actual interactive element
  // (marker/grid-cell/vector-path/layer-handle) already stops propagation
  // on its own pointerdown, so a click on genuinely empty map space always
  // reaches this listener untouched, but nothing here ever acted on it.
  // Confirmed real gap once isLayerFallbackInteractive shipped: clicking
  // off a fallback-selected marker (no longer adding a stray new marker,
  // see armedMarkerLayerId) still just did nothing instead of deselecting
  // it. A plain "click" listener won't work here the way it does for the
  // left pane above — panning is a real pointerdown-drag-pointerup gesture
  // over this same element, and browsers still fire a native "click" at
  // the end of one regardless of how far the pointer traveled — so this
  // tracks movement itself and only deselects a genuine no-movement click,
  // same convention beginMarkerDrag/bindLayerDrag already use elsewhere in
  // this file (onDragEnd only fires once real movement happened; a
  // never-moved gesture calls onClick instead).
  mapContainer.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      state.selection.kind === null ||
      isAnyGestureToolActive() ||
      event.target.closest("button, input, select, textarea, a")
    ) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const onMove = (moveEvent) => {
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) {
        moved = true;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) {
        setSelection(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function setupMapEvents() {
  if (elements.mapNameInput) {
    elements.mapNameInput.addEventListener("change", () => {
      const name = elements.mapNameInput.value.trim() || "New Orrery Map";
      recordHistory("map name", () => {
        state.map.name = name;
        updateMapTimestamp(state.map);
      });
      elements.mapNameInput.value = name;
      renderJson();
    });
  }

  if (elements.measurementScale && elements.measurementUnit) {
    const applyMeasurementChange = () => {
      const scaleValue = elements.measurementScale.value === "" ? null : Number(elements.measurementScale.value);
      const unitValue = elements.measurementUnit.value.trim();
      recordHistory("map measurement", () => {
        state.map.measurement = {
          scale: Number.isFinite(scaleValue) ? scaleValue : null,
          unit: unitValue,
        };
        updateMapTimestamp(state.map);
      });
      updateMeasureAvailability();
      updateShapeAvailability();
      renderJson();
    };
    elements.measurementScale.addEventListener("change", applyMeasurementChange);
    elements.measurementUnit.addEventListener("change", applyMeasurementChange);
  }

  // Only commits the SETTING — deliberately does not re-mount the base map
  // live (that would jerk the camera around mid-edit); it takes effect the
  // next time this map is actually loaded (applyMapSnapshot's own
  // resolveInitialView call).
  if (elements.initialZoom && elements.initialPositionX && elements.initialPositionY) {
    const applyInitialViewChange = () => {
      const zoomValue = Number(elements.initialZoom.value);
      const xValue = Number(elements.initialPositionX.value);
      const yValue = Number(elements.initialPositionY.value);
      const zoom = Number.isFinite(zoomValue) && zoomValue > 0 ? zoomValue : 1;
      const x = Number.isFinite(xValue) ? xValue : 0;
      const y = Number.isFinite(yValue) ? yValue : 0;
      recordHistory("map initial view", () => {
        state.map.initialView = { zoom, pan: { x, y } };
        updateMapTimestamp(state.map);
      });
      // Reflect back in case an invalid/empty entry got reverted to the
      // default (1 / 0 / 0), same "don't leave text the model never
      // actually accepted" pattern the Name field's own guard uses.
      elements.initialZoom.value = zoom;
      elements.initialPositionX.value = x;
      elements.initialPositionY.value = y;
      renderJson();
    };
    elements.initialZoom.addEventListener("change", applyInitialViewChange);
    elements.initialPositionX.addEventListener("change", applyInitialViewChange);
    elements.initialPositionY.addEventListener("change", applyInitialViewChange);
  }

  if (elements.newMapButton) {
    elements.newMapButton.addEventListener("click", () => {
      mapExistsOnServer = false;
      applyMapSnapshot(JSON.stringify(createMapModel()));
      if (elements.mapSelect) elements.mapSelect.value = "";
      // A brand-new, never-edited map has nothing worth saving yet — same
      // "clean until you actually change something" convention Sanctum's
      // New Setting/Location already follows.
      markMapClean();
      watchCurrentMap(null);
      status.show("Started a new map.", { type: "info", timeout: 1500 });
    });
  }

  if (elements.duplicateMapButton) {
    elements.duplicateMapButton.addEventListener("click", () => {
      // Clones the CURRENT map (not a blank createMapModel() the way New
      // Map does) — same recipe as Repository's own handleDuplicate: fresh
      // id so it saves as new rather than overwriting, " Copy" suffix on
      // the name, left dirty (an unsaved copy until explicitly saved).
      const duplicate = JSON.parse(JSON.stringify(state.map));
      duplicate.id = randomId();
      duplicate.name = `${state.map.name || "Map"} Copy`;
      mapExistsOnServer = false;
      applyMapSnapshot(JSON.stringify(duplicate));
      if (elements.mapSelect) elements.mapSelect.value = "";
      watchCurrentMap(null);
      status.show(`Duplicated as "${duplicate.name}".`, { type: "success", timeout: 2000 });
    });
  }

  // Same dirty check updateMapToolbarState already uses for the Save
  // button — Orrery had no guard at all against navigating/closing away
  // from unsaved edits (unlike Workbench, which already had this).
  window.addEventListener("beforeunload", (event) => {
    if (!isMapDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // Delete/Backspace deletes whatever's currently selected (layer, group,
  // view, marker, drawn path, shape) — delegates to deleteCurrentSelection()
  // (defined near setSelection above), which acts on state.selection
  // directly rather than finding-and-clicking a
  // `[data-action="delete-selected"]` DOM button. Confirmed real bug this
  // fixes: that DOM-query approach depended on whichever selection editor's
  // Delete button having actually finished rendering — fine for every kind
  // except marker (renderMarkerElementSelectionEditor is async), where a
  // keypress landing before/during a re-render just silently did nothing.
  // See deleteCurrentSelection's own comment for the full explanation.
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditableTarget =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    if (event.key === "Escape") {
      // Escape always deselects, even from inside a field (blurring it
      // first) — matches the left-pane click-off behavior above, just from
      // the keyboard.
      if (isEditableTarget) target.blur();
      if (state.selection.kind !== null) setSelection(null);
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (isEditableTarget) return;
    if (deleteCurrentSelection()) {
      event.preventDefault();
    }
  });

  if (elements.saveMapButton) {
    elements.saveMapButton.addEventListener("click", async () => {
      if (!dataManager) return;
      const name = elements.mapNameInput?.value.trim() || state.map.name || "New Orrery Map";
      state.map.name = name;
      updateMapTimestamp(state.map);
      // This is otherwise a BLIND full-body overwrite of state.map — unlike
      // every other write path on this map (marker position/image/color
      // auto-save, the "hidden from players" toggle, Combat Tracker's own
      // write-through), none of which ever save a stale, un-refetched
      // copy. views specifically can now be changed by tools OTHER than
      // this one (Combat Tracker's own toggleCombatantHiddenFromPlayers)
      // while this GM's own Orrery tab has no local edit of its own to
      // views at all — its poll is slower than the rest of the suite
      // (pollIntervalMs above) AND skips every incoming update entirely
      // while anything's selected, so state.map.views can easily still be
      // stale at the moment Save is clicked. Confirmed real bug this
      // fixes: a GM un-hid a marker from Combat Tracker, then (unrelated)
      // hit Save in Orrery moments later — silently restored the marker to
      // hidden, since Orrery's own copy of views hadn't caught up yet.
      // Only refetch-and-take-the-server's-copy when this GM hasn't
      // ALSO hand-edited a View locally since the last known-clean sync
      // (comparing against mapCleanSnapshot, not just "is anything
      // selected") — a genuine pending local View edit (the View editor's
      // own checklist, a rename) still wins and saves as typed; this only
      // ever protects the common case of views being untouched locally.
      try {
        const cleanViews = mapCleanSnapshot ? JSON.parse(mapCleanSnapshot).views : undefined;
        const hasLocalViewEdit = JSON.stringify(state.map.views) !== JSON.stringify(cleanViews);
        if (!hasLocalViewEdit && mapExistsOnServer) {
          const fresh = await dataManager.get("map", state.map.id, { shareToken: currentShareToken, preferLocal: false });
          if (Array.isArray(fresh?.payload?.views)) {
            state.map.views = fresh.payload.views;
          }
        }
      } catch (error) {
        // Best-effort — fall through and save with whatever's already in
        // memory rather than blocking the whole Save on this refetch.
      }
      try {
        // A map's own id is filename/library_items metadata, never body
        // content (every Library kind now follows this convention) —
        // stripped from a shallow CLONE only, so state.map.id itself stays
        // populated for every other in-memory read in this file (same
        // pattern workbench-character-view.js's persistDraft already uses).
        const { id: _mapId, ...bodyWithoutId } = state.map;
        await dataManager.save("map", state.map.id, bodyWithoutId);
        status.show(`Saved "${name}".`, { type: "success", timeout: 2000 });
        // Now a real record — currentUserHasFullMapAccess stops giving this
        // map an unconditional pass and starts checking its real ownership
        // (mapCatalog, refreshed below) instead, same as any other loaded
        // map. Harmless either way for THIS save (the saver is the real
        // owner per server/storage.py's own is_new_record ownership rule),
        // but correct going forward if this same tab later reloads or polls.
        mapExistsOnServer = true;
        // The in-memory map now exactly matches what's persisted — reset the
        // dirty baseline before populateMapSelect's own updateMapToolbarState
        // call (via refreshMapCatalog) re-evaluates Delete too.
        markMapClean();
        // A brand-new map now has a real backing record — start watching it
        // (idempotent for an already-loaded map, just restarts the poll).
        watchCurrentMap(state.map.id);
        await populateMapSelect();
      } catch (error) {
        status.show(`Unable to save map: ${error.message}`, { type: "error", timeout: 4000 });
      }
    });
  }

  if (elements.deleteMapButton) {
    elements.deleteMapButton.addEventListener("click", async () => {
      if (!dataManager || !mapAllowsDelete(state.map.id)) return;
      if (!confirmDelete({ label: `map "${state.map.name}"` })) return;
      try {
        await dataManager.delete("map", state.map.id);
        status.show("Deleted.", { type: "success", timeout: 2000 });
        applyMapSnapshot(JSON.stringify(createMapModel()));
        markMapClean();
        watchCurrentMap(null);
        await populateMapSelect();
      } catch (error) {
        status.show(`Unable to delete map: ${error.message}`, { type: "error", timeout: 4000 });
      }
    });
  }

  // Export's own click handling is wired directly at construction
  // (jsonDataPanel's own onExport, above) — no separate listener needed
  // here. Import's own button click is wired the same way (onImport), but
  // the hidden file-picker input itself still needs building — assigned to
  // the module-level `importInput` onImport already closes over.
  importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json";
  importInput.className = "d-none";
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      status.show("That file isn't valid JSON.", { type: "error", timeout: 3000 });
      return;
    }
    if (!parsed || !Array.isArray(parsed.layers) || !parsed.baseMap || typeof parsed.baseMap !== "object") {
      status.show("That file doesn't look like an Orrery map.", { type: "error", timeout: 3000 });
      return;
    }
    // Funnels through the same snapshot path New/Load/Undo/Redo already
    // use, so history/dirty-state/JSON-preview stay consistent — left
    // dirty (not markMapClean()) since an imported file is unsaved
    // content until the user explicitly hits Save.
    applyMapSnapshot(JSON.stringify(parsed));
    if (elements.mapSelect) elements.mapSelect.value = "";
    watchCurrentMap(null);
    status.show(`Imported "${state.map.name || "map"}".`, { type: "success", timeout: 2000 });
  });
  document.body.appendChild(importInput);

  if (elements.mapSelect) {
    elements.mapSelect.addEventListener("change", () => {
      void loadMapById(elements.mapSelect.value);
    });
  }
}

// Shared by the Map picker's own change handler and the ?map=<id> deep link
// (see loadMapFromUrlParam) — the Dashboard's own Map widget spotlights a
// map by posting exactly this same "map" kind (common/js/lib/widgets/map.js),
// and this is where that link points, since a map has no print-card
// rendering of its own, just a direct link into Orrery itself. shareToken is
// only ever set by the ?map=<id>&share= deep link (an anonymous group
// share-link visitor has no session at all — see loadMapFromUrlParam) and
// forwarded straight to dataManager.get, which is what lets get_item's
// narrow spotlight exception (server/storage.py) grant read access to
// exactly this map with no account.
async function loadMapById(id, shareToken = "") {
  currentShareToken = shareToken || "";
  if (!id) {
    mapExistsOnServer = false;
    applyMapSnapshot(JSON.stringify(createMapModel()));
    markMapClean();
    watchCurrentMap(null);
    return;
  }
  if (!dataManager) return;
  try {
    // preferLocal: false (now redundant for a signed-in user — get()'s
    // default is itself auth-aware — kept explicit for clarity/resilience
    // regardless of sign-in state) — a map is exactly the kind of record
    // OTHER tools (Combat Tracker's own write-through, the Dashboard's Map
    // widget, a GM's own second Orrery tab) can change out from under this
    // browser's own local mirror. Under the old flat `preferLocal: true`
    // default, that mirror was checked BEFORE ever reaching the server
    // whenever no shareToken was present — true for a signed-in GM's own
    // normal Orrery use, not just anonymous saves, since a signed-in save
    // also writes a "read-acceleration" local copy (data-manager.js's own
    // save()). A hard refresh clears the HTTP cache but never localStorage,
    // so this loaded whatever THIS browser last saved, forever, regardless
    // of anything that changed on the server since — confirmed real bug
    // this fixed: a marker's "hidden from players" state fixed directly in
    // the server's own data file still showed stale after a full page
    // reload, because this call never actually reached the server to see it.
    const result = await dataManager.get("map", id, { shareToken, preferLocal: false });
    mapExistsOnServer = true;
    applyMapSnapshot(JSON.stringify(result?.payload || createMapModel()));
    // A map's own id is filename/library_items metadata, never body content
    // (every Library kind now follows this convention) — the loaded payload
    // may not carry one at all, so state.map.id is re-stamped from the
    // KNOWN id (the argument this function was actually called with), not
    // trusted from the body. Confirmed real bug this fixes: watchCurrentMap
    // just below reads state.map.id immediately after this.
    state.map.id = id;
    if (elements.mapSelect) elements.mapSelect.value = id;
    // Just-loaded state matches the stored record exactly — nothing to save
    // until an edit actually happens. NOT called from onUndo/onRedo (which
    // also route through applyMapSnapshot): navigating undo history can land
    // on a state that still legitimately differs from the last save, and
    // Save needs to reflect that.
    markMapClean();
    watchCurrentMap(state.map.id, shareToken);
  } catch (error) {
    status.show(`Unable to load map: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

// A spotlighted map is just a link (see workbench-character-view.js's
// refreshNowShowing) — clicking it lands here with ?map=<id>[&share=token]
// in the URL, and this loads that map the same way picking it from the
// dropdown would. Runs after populateMapSelect so the id is already in
// mapCatalog/the picker's own option list by the time it's selected.
async function loadMapFromUrlParam() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("map");
  if (!id) return;
  await loadMapById(id, params.get("share") || "");
}

function setupViewPanelToggle() {
  if (!elements.viewToggle || !elements.viewDetails) {
    return;
  }
  elements.viewToggle.addEventListener("click", () => {
    const isExpanded = !elements.viewDetails.classList.contains("d-none");
    elements.viewDetails.classList.toggle("d-none", isExpanded);
    elements.viewToggle.setAttribute("aria-expanded", isExpanded ? "false" : "true");
    const icon = elements.viewToggle.querySelector(".iconify");
    if (icon) {
      icon.dataset.icon = isExpanded ? "tabler:chevron-left" : "tabler:chevron-down";
    }
  });
}

function setupViewPanelDrag() {
  const panel = elements.viewPanel;
  const handle = elements.viewHandle;
  const container = elements.mapMain;
  if (!panel || !handle || !container) {
    return;
  }

  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let dragging = false;

  const onMove = (event) => {
    if (!dragging) {
      return;
    }
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const containerRect = container.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const nextLeft = originLeft + deltaX;
    const nextTop = originTop + deltaY;
    const maxLeft = containerRect.width - panelRect.width;
    const maxTop = containerRect.height - panelRect.height;
    const clampedLeft = Math.min(Math.max(nextLeft, 0), Math.max(maxLeft, 0));
    const clampedTop = Math.min(Math.max(nextTop, 0), Math.max(maxTop, 0));
    panel.style.left = `${clampedLeft}px`;
    panel.style.top = `${clampedTop}px`;
    panel.style.right = "auto";
  };

  const onEnd = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    panel.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
  };

  handle.addEventListener("pointerdown", (event) => {
    // Same "don't hijack an actual control" guard the left-pane click-off
    // handler already uses — this bar also holds the zoom buttons and the
    // Measure/Draw/Shape toggles plus the Shape Type <select>. Buttons
    // tolerated the unconditional preventDefault() below (their own click
    // still fires regardless of what a prior pointerdown prevented), but a
    // native <select>'s dropdown-opening IS exactly what browsers tie to
    // that default action — confirmed as the actual cause of the Shape
    // Type dropdown never opening, since every pointerdown on it, anywhere
    // in this handle, got preventDefault()'d before the browser could show
    // its options.
    if (event.target.closest("button, select, input, textarea, a")) {
      return;
    }
    event.preventDefault();
    const panelRect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originLeft = panelRect.left - containerRect.left;
    originTop = panelRect.top - containerRect.top;
    panel.classList.add("is-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
  });
}

// Deliberately does NOT mount state.map's own base map or call renderAll()
// here — state.map is still just the harmless placeholder createMapModel()
// built at module load (see its own comment), and mounting/rendering it
// would paint a real, functioning default Tile/OSM map (plus its Primary
// Grid Layer, Name field, etc.) behind/around the empty-state card below,
// completely defeating the point of it. The various setup*Events calls
// just below only wire listeners onto STATIC toolbar buttons (Add Layer,
// Add Group, zoom controls, base map type radios) that exist in the HTML
// regardless of state.map's content, not onto anything renderAll() would
// have produced — safe to call before a real map is ever loaded.
// applyMapSnapshot (New Map / picking a saved map / the ?map= deep link)
// is what actually calls setBaseMap + renderAll for the first time.
setupBaseMapEvents();
setupLayerEvents();
setupGroupEvents();
setupViewsListEvents();
setupViewEvents();
setupActionEvents();
setupMapEvents();
setupViewPanelToggle();
setupViewPanelDrag();
refreshTooltips();
initHelpSystem({ root: document });
// The freshly created, never-edited map at page load has nothing to save
// yet — without this, mapCleanSnapshot starts null and Save would show
// enabled from the very first render.
markMapClean();
if (elements.mapEmptyState) {
  elements.mapEmptyState.appendChild(
    createEmptyStateCard({
      message: "Select a map from the list, or click New Map to start one.",
      variant: "inline",
    })
  );
}
// Hides everything renderAll() above just painted (the harmless, never-
// saved default map createMapModel() built at module load) until the GM
// actually picks or creates one — see showMapEmptyState's own comment.
// loadMapFromUrlParam below, if there's a real ?map= to load, calls
// loadMapById -> applyMapSnapshot -> hideMapEmptyState() and reveals it
// immediately.
showMapEmptyState();
void populateMapSelect().then(() => loadMapFromUrlParam());
