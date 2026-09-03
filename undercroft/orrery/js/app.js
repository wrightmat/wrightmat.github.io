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
  // Aliased — distinct from inspector-fields.js's positional-args
  // createCollapsibleSection imported below; this is the object-arg
  // (label/content/actions/helpTopic) variant, used only for Selections.
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
// Shared map-rendering core (also used by the Dashboard's Map widget) —
// renderMapLayers is the whole render loop; most other imports are pure
// helpers Orrery calls directly, except the `sharedGet*` aliases, which
// bindLayerDrag wraps with this file's own baseMapManager/state.map.
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

// Unlike Crucible/Forge/Vault, Orrery has no System selector — the only
// relevant System is whichever the active campaign's running Encounter is
// tagged with. Proactively fetches that Encounter rather than relying on
// primeResourceBarCache (which only runs during actual map rendering) —
// Settings is reachable with no map loaded, so nothing may have primed the
// cache yet.
function currentResourceBarSettingsSystemId() {
  const groupId = getActiveCampaignGroupId();
  if (!groupId) return "";
  ensureActiveEncounterCached(groupId, () => {});
  const encounter = getCachedActiveEncounter(groupId);
  return encounter?.systemId || "";
}

// Gear-icon Settings modal — same shared pattern as Crucible's Combat
// Scaling/Creature Type/Ability pickers. Currently one per-System
// preference: which named `resource`-role binding (combat-bindings.js's
// resolveCombatantStats) the Marker Resource Bar represents, for a System
// tracking more than one (e.g. d20 Modern's HP + Action Points). A System
// with only one resource never needs this — the guessed default already
// matches resolveCombatantStats' own "first resource is primary" rule.
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
    // No-op if already cached/in-flight. The modal itself doesn't live-
    // refresh once this resolves (tool-settings.js has no such hook), but
    // an actual map's combatant markers already prime this during normal
    // rendering, well before a GM opens Settings in practice.
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
        // selected value until the GM picks another, "(auto-detected)" on
        // its own option label the only indicator.
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
  // Queried live, not via `elements` — initAppShell() builds the settings
  // slot above, and mountButton fires synchronously right after.
  mountButton: (button) => document.querySelector("[data-orrery-settings-slot]")?.appendChild(button),
});

// Ownership metadata for saved Maps, used only for the Delete button's
// access gate (owner-or-admin, or a local/anonymous entry) — same
// rule and shape as Sanctum's settingCatalog/locationCatalog.
let mapCatalog = new Map();

// Module-scope, not local to setupDrawTool — renderLayerOverlays' own
// onVectorPathClick wiring reads it too: a drawn path stays click-through
// while true, so a new stroke can start anywhere, including atop one.
let drawModeActive = false;

// Same reasoning as drawModeActive — a placed AoE shape stays click-through
// while true, so a new one can drop anywhere, including atop an existing one.
let shapeModeActive = false;

// While the Shape tool is armed, a DRAFT element exists on its eventual
// target layer and renders through the SAME renderVectorShapeSelectionEditor
// a real placed shape uses — so a GM can set type/color before ever
// touching the map, then drag to set Size/Angle/Position with those same
// inputs updating live. Never pushed into layer.elements until the gesture
// commits (sizeCells > 0 on release); edits to the draft before then just
// harmlessly redraw the unaffected real map. lastShapePresetId/
// lastShapeValues remember the last-used type/colors across arm/disarm
// cycles so re-arming picks up where the last placement left off.
let draftShapeElement = null;
let draftShapeLayer = null;
let lastShapePresetId = "circle";
let lastShapeValues = null;

// One shared "pencil color" for the plain Draw tool (fillColor AND
// strokeColor both come from this) — matches the Dashboard Map widget's
// own single drawColor concept, since a player there has no "selected
// vector layer" to read a per-layer default from. Shape no longer uses
// this — its colors are per-colorSlot fields on draftShapeElement.values.
// Persists across gestures within the session.
let drawColor = "#0f172a";

// Same reasoning as drawModeActive — a wall/door being placed stays
// click-through, and precise vertex placement near an existing wall's own
// endpoint (connecting two segments) is a common, expected case.
let wallModeActive = false;
// Same draft-element workflow as draftShapeElement — renderWallSelectionEditor
// renders draftWallElement live the whole time the Wall tool is armed, so
// Type/Stroke/Snap-to-Grid are editable before a wall is actually placed.
// `points` grows as vertices are clicked and is kept as-is by the committed
// element. lastWallType remembers wall-vs-door across arm/disarm cycles.
let draftWallElement = null;
let draftWallLayer = null;
let lastWallType = "wall";
// Whether the NEXT placed wall/door's vertices snap to the grid as they're
// clicked — defaults on (fog is square-grid-cell granular regardless, and
// snapping keeps walls aligned). A toolbar-level toggle, not
// draftWallElement.snapToGrid (a separate per-element inspector field),
// because it governs live placement snapping as vertices are clicked — a
// wall's freeform multi-vertex geometry can want off-grid precision
// mid-placement in a way Shape's single-drag gesture never needed.
let wallSnapEnabled = true;
// { preview, polyline } while a click-to-place-vertex gesture is in
// progress; null otherwise. Module-scope so the capture-phase keydown
// handler and the pointermove/dblclick handlers share it. Vertices
// themselves live on draftWallElement.points, not here.
let wallGesture = null;

// Same reasoning as shapeModeActive, except a placed Light stays
// immediately selectable/draggable even while armed, so this does NOT
// gate click-through the way drawModeActive/wallModeActive do.
let lightModeActive = false;

// Same draft-element workflow as draftShapeElement, for the Light tool —
// Range/Color/Opacity/Attach-to-Token are live-editable before placement.
// No "last used" memory since a Light has no type to remember.
let draftLightElement = null;
let draftLightLayer = null;

// Selecting a Group makes its target grid layer directly clickable (single
// click adds a cell, drag paints a sweep) with no separate toggle needed.
// paintTargetLayerId remembers the GM's "Paint on layer" pick for maps with
// more than one grid layer and no Fog-of-War link to fall back on —
// persists across group switches on purpose. paintDragBefore is the
// pre-gesture snapshot a whole drag batches into one undo entry.
let paintTargetLayerId = null;
let paintDragBefore = null;

// Set by showMapEmptyState/hideMapEmptyState — updateMapToolbarState's
// Delete gate (mapAllowsDelete) checks THIS too, not just ownership, since
// an admin account's "can delete anything" bypass would otherwise re-enable
// Delete for the placeholder map the instant populateMapSelect re-ran
// updateMapToolbarState at startup.
let mapIsLoaded = false;

// True once state.map is a REAL, previously-saved server record — false
// for a brand-new never-saved map. currentUserHasFullMapAccess treats "not
// yet saved anywhere" as full access unconditionally; without this,
// mapAllowsDelete's safe "no catalog entry = restricted" default (correct
// for a map this viewer genuinely lacks access to) also fired for a map
// that simply doesn't exist as a record yet, hiding the whole authoring UI
// — including the Save button needed to create it — on every fresh load.
let mapExistsOnServer = false;

// Set by loadMapById — needed by the restricted-viewer marker-move/door-
// toggle persistence below, the same share-token loadMapById already
// forwards to dataManager.get.
let currentShareToken = "";

// Set true for the duration of a restricted viewer's marker drag —
// watchCurrentMap's onChange below skips an incoming poll/live-stream
// update while true, the same way it skips one whenever state.selection is
// set for a GM's own drag. A restricted viewer has no selection concept,
// so it needed its own signal to avoid a drag popping to its final
// position instead of tracking the cursor.
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

// Two button shapes createIconButton's "compact"/"toolbar" kinds don't
// cleanly cover: a plain-link "About X" help tooltip, and a small
// btn-group-sm "Add X" action with a visually-hidden label.
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

// Built before `elements` below queries these by data-action attribute, so
// every disabled-state call site elsewhere keeps working unchanged.
// Import/Export live in the JSON Data panel instead of as standalone buttons.
createToolbarButtonGroup([
  { action: "new", icon: "tabler:map-plus", label: "New Map", attrs: { "data-action": "new-map" } },
  { action: "save", label: "Save Map", disabled: true, attrs: { "data-action": "save-layout" } },
  { action: "duplicate", label: "Duplicate Map", attrs: { "data-action": "duplicate-map" } },
  { action: "delete", label: "Delete Map", disabled: true, attrs: { "data-action": "delete-map" } },
]).forEach((button) => document.querySelector("[data-map-toolbar-mount]")?.appendChild(button));
// A visual break only, not functional — same convention as other tools.
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

// Builds a collapsible-section chevron toggle for a header whose other
// content stays static HTML — the section-level createCollapsibleSection
// isn't used since it would rebuild the whole header.
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

// replaceWith, not appendChild — an appended-into wrapper stays an
// empty-but-in-flow flex item even while its field is conditionally
// hidden, silently spending a gap-3 on both sides. The mount div's own
// class is merged onto the built field first so its layout isn't lost.
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
// Selections — expanded by default, matching every other tool's left-pane
// Selections section.
{
  const selectionsSection = createFullCollapsibleSection({
    label: "Selections",
    collapsed: false,
    content: document.querySelector("[data-selections-panel]"),
  });
  document.querySelector("[data-selections-mount]")?.appendChild(selectionsSection.section);
}
// Same icon+text+tooltip toggle shape as Press's align-x/align-y groups.
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
// Primary/standalone right-pane fields use the floating-label shape
// (createFormFloatingField), same as Workbench's inspector — not
// createCompactField, reserved for fields condensed into a dense row.
mountField("base-map-image-src", createFormFloatingField({ type: "text", id: "base-map-image-src", label: "Image URL", dataAttr: "data-base-map-image-src", placeholder: " " }));
mountField(
  "map-name",
  createFormFloatingField({
    type: "text", id: "orreryMapName", label: "Map Name",
    dataAttr: "data-map-name", placeholder: "Map name",
  })
);
// One scale/unit for the whole map, not per-grid-layer — a map's grid
// squares always represent the same real-world distance regardless of
// which layer is selected. No default value stamped in; the Measure tool
// checks both are set and disables itself otherwise, rather than silently
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
// The view a map ALWAYS opens to (resolveInitialView, map-model.js) —
// unlike Scale per cell/unit above, these ship a real default (1/0/0)
// matching createMapModel's own initialView, so a fresh map's fields
// already show what it'll open at.
// Position X/Y only means anything for image/canvas maps — a tile map's
// view is addressed by center lat/lng + zoom, so Position X/Y is a true
// no-op there. renderBaseMapSettings hides those two fields for that type
// (honest about the limitation) while Initial Zoom stays functional for
// every type.
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
// Quick-pick options carry their tile URL/zoom payload as dataset attrs
// read by the change handler below — createFormFloatingField's `options`
// only knows {value, label}, so the payload is stamped onto the built
// <option> elements afterward.
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
// level, and these accept blank (native size), a pixel count, or "NN%"
// (see base-maps.js's applyImageDimensions/resolveImageDimension).
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
  // Built below (not queried) — the chevron toggle comes from the shared
  // createIconButton factory; the rest of each header stays hand-authored HTML.
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
  // native `disabled` button doesn't reliably fire hover/focus events, so a
  // tooltip attached directly to it can silently never show. Standard
  // Bootstrap pattern for explaining a disabled control.
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

// Assigned once the hidden file-picker input is built further below —
// onImport just needs a stable closure to call once that's ready, resolved
// at click time like applyMapSnapshot/watchCurrentMap elsewhere.
let importInput = null;
const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  getData: () => state.map,
  // Reuses the same Blob/anchor/download mechanics Crucible/Vault/Sanctum
  // share — an identity shape function, since a map export is a portable
  // copy of itself, not a Press-ingestion shape.
  onExport: () => exportRecordAsJson(state.map, (map) => map),
  onImport: () => importInput?.click(),
});
const renderJsonPreview = jsonDataPanel.render;

// Wraps the raw preview renderer so every renderJson() call site (after
// essentially every edit) also re-evaluates the Save button's dirty-gated
// state, without touching each call site individually. updateMapToolbarState
// is hoisted, so referencing it here before its definition is safe.
function renderJson() {
  renderJsonPreview();
  updateMapToolbarState();
}

const LAYER_SETTINGS_SCHEMA = {
  vector: [
    // Labeled "Outline" to match Marker's outlineColor/outlineWidth
    // vocabulary — a display rename only; underlying keys are unchanged.
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
  // NN%, or px" handling createDimensionField provides, not
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

// Map Properties and Selection share one "what's the GM focused on"
// spotlight — expanding one collapses the other. `selectionExpanded` is
// true when a layer/group/view/marker/grid-cells selection is active
// (Selection open), false when nothing is selected (Map Properties open).
function setPanelFocus(selectionExpanded) {
  setSelectionCollapsed(!selectionExpanded);
  setBaseMapCollapsed(selectionExpanded);
}

document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);

function normalizeTier(tier) {
  return typeof tier === "string" ? tier.trim().toLowerCase() : "";
}

// hiddenLayerIds/hiddenElementIds are deny-lists, so an unset one already
// means "nothing hidden" — no pre-population needed, and nothing here
// depends on state.map.layers/groups existing yet.
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

// Shown at page load and never since — every real load path funnels
// through applyMapSnapshot, which calls hideMapEmptyState() unconditionally.
// A harmless, never-rendered createMapModel() still sits in state.map
// underneath (avoids making every state.map.* read null-safe); this
// overlay's only job is making sure nobody sees that placeholder until
// they've actually picked or created something.
// Add Layer/Group/View mutate state.map directly with no selection step —
// the only gate is a real map existing to add to, so they toggle on the
// same "is a real map loaded" signal the empty-state canvas uses.
function setMapActionsEnabled(enabled) {
  elements.layerButtons.forEach((button) => {
    button.disabled = !enabled;
  });
  if (elements.groupAdd) elements.groupAdd.disabled = !enabled;
  if (elements.viewAdd) elements.viewAdd.disabled = !enabled;
  // Same "gated only by a real map being loaded" reasoning as above —
  // otherwise Export would dump the placeholder createMapModel() as if
  // real, Import would silently overwrite it, and Duplicate would have
  // nothing real to copy.
  if (jsonDataPanel.importButton) jsonDataPanel.importButton.disabled = !enabled;
  if (jsonDataPanel.exportButton) jsonDataPanel.exportButton.disabled = !enabled;
  if (elements.duplicateMapButton) elements.duplicateMapButton.disabled = !enabled;
  // Delete has its own, more specific gate (mapAllowsDelete — ownership),
  // reapplied by updateMapToolbarState once a real map loads — only force
  // OFF here; never force ON and fight that check.
  if (!enabled && elements.deleteMapButton) {
    elements.deleteMapButton.disabled = true;
  }
}

function showMapEmptyState() {
  mapIsLoaded = false;
  elements.mapEmptyState?.classList.remove("d-none");
  elements.viewPanel?.classList.add("d-none");
  // Otherwise Map Properties shows every field blank/at-default with no
  // map to belong to — a blank Name or default Tile radio reads as "this
  // is the map's real state," not "there is no map." Collapsing the
  // section represents "nothing to see"; applyMapSnapshot's own
  // setPanelFocus(false) re-expands it once a real map exists.
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
  // Backward-compatible with maps saved before per-map measurement
  // existed — an older map just has no measurement configured yet.
  if (!state.map.measurement) {
    state.map.measurement = { scale: null, unit: "" };
  }
  state.map.views = state.map.views.map((view) => normalizeView(view));
  // Backward-compatible with maps saved before Initial Zoom/Position
  // existed (resolveInitialView tolerates a missing initialView anyway).
  if (!state.map.initialView) {
    state.map.initialView = { zoom: 1, pan: { x: 0, y: 0 } };
  }
  // Backward-compatible with layers saved before a settings key existed —
  // a merge, not a replace, so anything already configured is untouched;
  // this covers any future new layer setting too, not just today's.
  (state.map.layers || []).forEach((layer) => {
    layer.settings = { ...createLayerSettings(layer.type), ...(layer.settings || {}) };
  });
  state.selection = { kind: null, id: null, layerId: null, cells: [], elements: [], anchor: null };
  hideMapEmptyState();
  // Always opens at the map's own configured Initial Zoom/Position, never
  // wherever a previous session's camera was left — state.map.view still
  // live-syncs during this session (onViewChange), so only what a fresh
  // load starts at changes.
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
// ownership.js's own allowsDelete, which treats a plain share-level "edit"
// permission as sufficient (right for every other kind's delete gate). A
// Map can't follow that: every map share is unconditionally "edit"
// (server/shares.py) purely so a player's own restricted write-back
// (moving their own character's token) is possible at all — it no longer
// signals "trusted co-author of the whole map." Reusing allowsDelete here
// would make it (and currentUserHasFullMapAccess below, which every
// restricted-viewer check branches on) return true for ANY campaign
// member, silently granting full authoring access to a mere player.
function mapAllowsDelete(id) {
  if (dataManager?.getUserTier() === "admin") return true;
  const metadata = mapCatalog.get(id);
  if (!metadata) return false;
  if (metadata.ownership === "local") return true;
  return matchesOwner(metadata, { session: dataManager?.session });
}

// Same shape as Sanctum's refreshSettingCatalog: ownership metadata comes
// from a dedicated dataManager.list() call, and local-only entries are
// always deletable.
async function refreshMapCatalog(ids) {
  mapCatalog = await refreshOwnershipCatalog(dataManager, "map", ids);
}

// Tiered Views (state.map.views) only ever filter what a non-owner sees —
// the owner/editor always gets full, unfiltered access, since Views are a
// presentation concern for viewers, not the author. mapAllowsDelete
// already captures the right "owns this map, or admin" check.
function currentUserHasFullMapAccess() {
  if (!mapExistsOnServer) return true;
  return mapAllowsDelete(state.map.id);
}

// The tier a non-owner viewer's Views filtering resolves against —
// currently just the signed-in account's own tier. A share-link visitor
// counting as the owner's top tier depends on Orrery gaining its own
// share-link surface, which doesn't exist yet.
function getEffectiveViewerTier() {
  return dataManager?.getUserTier() || "free";
}

// The actual filtering logic lives in lib/map-viewer.js, shared with the
// Dashboard's Map widget so there's exactly one implementation — a
// deny-list ("hidden", not "visible") contract.
function getHiddenLayerIds() {
  return computeHiddenIds(state.map, getEffectiveViewerTier(), currentUserHasFullMapAccess())?.layers ?? null;
}

// Snaps a marker's dropped/placed position to the nearest cell center —
// lives in lib/map-viewer.js (as snapMarkerPositionToGridShared, taking
// baseMapManager/map as explicit params) so the Dashboard's Map widget can
// call the identical logic for a player's own token drag, matching
// Orrery's own drag feel exactly. This wrapper just supplies this file's
// closed-over state/baseMapManager.
function snapMarkerPositionToGrid(position, markerLayer) {
  return snapMarkerPositionToGridShared(baseMapManager, state.map, position, markerLayer);
}

// Same "convert to content-space, snap, convert back" shape as
// snapMarkerPositionToGrid, but rounds to the nearest grid LINE
// INTERSECTION (a corner) instead of the nearest cell CENTER — an AoE
// template's origin is where a player would measure range from, so its
// edges land on grid lines instead of cutting cells in half. Skips the
// getGridCoordFromPoint/getGridCellPixelRect round-trip (that finds a
// specific cell; a corner is just rounding each axis to the nearest
// multiple of cell size).
function snapShapeOriginToGrid(position, shapeLayer) {
  const gridLayer = state.map.layers.find((entry) => entry.type === "grid");
  if (!gridLayer) {
    return position;
  }
  // Hex grids have no clean 4-corner analog (6 vertices, shared unevenly
  // with neighbors) — falls back to the same cell-center snap a marker uses.
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
// A just-added/removed condition lives on an "encounter" or "character"
// record, separate from mapWatcher (which only watches the MAP record) —
// without this, a condition only appears once the cache's own staleness
// window lapses. Combat Tracker already subscribes to these two live-
// stream kinds; reusing rather than adding a second mechanism. Shares the
// same pooled EventSource watchMapForChanges opens for this group
// (connectLiveStream pools by dataManager/groupId/shareToken, so this is a
// ref-counted subscribe, not a second connection) — costs nothing extra on
// the wire.
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
    // Orrery has no other group context of its own — this also activates
    // the SSE "wake sooner" half of onChange below.
    groupId: getActiveCampaignGroupId(),
    // No reason to poll a screen nobody's watching more than every 20s.
    pollIntervalMs: 20000,
    onChange: (nextMap) => {
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
// anonymous saves), mirroring Sanctum's populateSettingSelect. Uses
// fetchKindEntriesWithIds so each option shows the map's real name, not
// just its id. Factored out of populateMapSelect so the Move to Map
// modal's own destination picker can reuse the same list.
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
  // Workbench's template/character selector convention. "New Map" is the
  // only way to get a fresh map; the dropdown is purely for loading saved ones.
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
// auto-saved — lets Undo/Redo of these three actions propagate immediately
// to the server, same as the action itself, instead of leaving other
// viewers stale until the next Save.
const MARKER_AUTO_SAVE_FIELD_BY_LABEL = {
  "move marker": "position",
  "marker image": "image",
  "marker outline color": "outlineColor",
};

// Locates which marker element a before/after snapshot pair changed a
// given field on — recordHistory only records label plus full JSON, not
// which element was touched, so undo/redo must work that out first.
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
// own commit) rather than changing an existing field — Undo/Redo of these
// means re-syncing the element's EXISTENCE (create/delete), not one value.
const DRAW_SHAPE_AUTO_SAVE_LABELS = new Set(["draw path", "place shape"]);

// Same diff strategy as findChangedMarkerElement, but for an element ADDED
// to a layer — Draw/Shape only ever add exactly one element per commit, so
// "present in after, absent in before" uniquely identifies it.
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

// Patches just one element into (or out of) mapCleanSnapshot's copy of one
// layer, after a Draw/Shape creation auto-saves — so the Save button only
// reflects genuinely-batched work afterward. Deliberately not a full
// markMapClean(): that would also launder any OTHER pending local edit as
// "clean" just because it happened to be in state.map at the same moment.
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

// Re-persists a marker field, or re-syncs a Draw/Shape creation's
// existence, immediately after Undo/Redo restores it — without this,
// undoing an action would revert the GM's screen but leave other viewers
// looking at the un-undone value until the next unrelated Save.
function autoSaveHistoryEntry(entry) {
  if (!entry || !mapExistsOnServer) return;
  if (DRAW_SHAPE_AUTO_SAVE_LABELS.has(entry.label)) {
    const found = findAddedElement(entry.before, entry.after);
    if (!found) return;
    const layer = state.map.layers?.find((candidate) => candidate.id === found.layerId);
    // Present in the current map: we redid the creation, re-add server-
    // side. Absent: we undid it, delete server-side — state.map's own
    // content tells us the direction without an explicit undo/redo flag.
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

// Which marker layer (if any) is "armed" — its empty-map-space click
// places a new marker there. Deliberately NOT the same as "this layer's
// marker-element is the current selection": explicitly selecting the Layer
// arms it, and clicking a marker while its layer is already armed keeps it
// armed (so rapid placement or nudging stays fluid) — but fallback-
// clicking an existing marker directly does NOT arm its layer, so clicking
// elsewhere afterward falls through to panning instead of silently placing
// a new marker on a layer the user never chose to edit.
let armedMarkerLayerId = null;

// Clears a stale, still-focused field whenever a new selection is picked —
// every pointerdown handler in this file calls event.preventDefault()
// (needed so the click doesn't also trigger drag/text-select), which as a
// side effect suppresses the browser's normal "clicking elsewhere blurs
// whatever was focused" behavior. Without this, a field left focused from
// the previous selection kept the global Delete/Backspace shortcut's
// isEditableTarget guard treating every fresh selection as "still typing."
// Blurring also commits the stale field's value via its own change/blur
// listener. BUTTON is included too — deleting a selected shape rebuilds
// the selection toolbar as part of the same setSelection() call, which
// would otherwise remove the still-focused Delete button from under
// itself and let focus land on a nearby toolbar button instead of the body.
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
    // Multi-selected markers only — {layerId, id} pairs, since a marker's
    // layer isn't necessarily the same for every entry (toggleMarkerMultiSelect).
    elements: extra.elements ?? [],
    anchor: extra.anchor ?? (extra.cells?.[0]?.coord ?? null),
  };
  if (kind === "grid-cells" && state.selection.cells.length) {
    state.lastGridSelection = {
      layerId: state.selection.layerId,
      cells: state.selection.cells.map((cell) => ({ ...cell })),
    };
  }
  // Without this, the left pane's Layers/Groups/Views lists only rebuild
  // as a side effect of mutating actions, never a plain selection change —
  // so a group's .active state would appear once and then stay frozen on
  // that row forever. Cheap enough to always do here: small lists, and
  // explicit selection changes (unlike paint-mode's per-cell drag, which
  // never calls setSelection) are infrequent.
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

// Click-to-select, click-again-to-deselect — used by the left pane's
// Layer/Group/View list rows, where re-clicking the active row means
// "never mind." Not used by every setSelection call (a delete handler
// picking a fallback selection stays a plain setSelection).
function toggleSelection(kind, id, extra = {}) {
  if (state.selection.kind === kind && state.selection.id === id) {
    setSelection(null);
  } else {
    setSelection(kind, id, extra);
  }
}

// Single source of truth for "delete whatever's currently selected" — used
// by the global Delete/Backspace shortcut AND every selection editor's own
// Delete button, instead of duplicating recordHistory/filter/setSelection
// logic. Acts directly on state.selection, not a rendered DOM button — the
// keyboard shortcut used to find-and-click a DOM button, but
// renderMarkerElementSelectionEditor is async, so a keypress landing before
// that button existed silently did nothing ("hit or miss" on a freshly
// placed marker, or after any later async re-render).
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
    // Grouped by layer (a multi-selection can span several marker layers)
    // so every removal lands in one recordHistory entry.
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

// The one View toggleElementHiddenFromPlayers manages — auto-created the
// first time a GM uses the marker's "Hidden from players" convenience
// switch. Only ever returns/creates THIS one View; a hand-authored View a
// GM separately scopes via the View editor's Visible Components checklist
// is a deliberately separate thing this never touches.
function ensureAutoManagedPlayerView() {
  let view = state.map.views.find((entry) => entry.autoManaged);
  if (!view) {
    view = createView({ name: "Player View (auto)", tiers: ["player"], autoManaged: true });
    state.map.views.push(view);
  }
  return view;
}

// Read-only — whether `elementId` is hidden by the auto-managed Player
// View specifically, not the union of every View that might hide it.
// False, not an error, when the auto-managed View doesn't exist yet.
function isElementHiddenFromPlayers(elementId) {
  const view = state.map.views.find((entry) => entry.autoManaged);
  return Boolean(view?.hiddenElementIds?.includes(elementId));
}

// Explicit target `hidden`, not a per-element flip — a bulk toggle over a
// multi-selection that can start in a MIXED state needs every listed id to
// converge on the SAME final state in one recordHistory entry, not flip
// independently. toggleElementHiddenFromPlayers below is just this called
// with a single-element list and the opposite of its current state.
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
  // color — without this the Dashboard's Map widget (polling the server)
  // wouldn't pick it up until the GM hit the batched Save button.
  void autoSaveHiddenFromPlayersView(elementIds, hidden);
}

function toggleElementHiddenFromPlayers(elementId) {
  setElementsHiddenFromPlayers([elementId], !isElementHiddenFromPlayers(elementId));
}

// Narrow read-modify-write against the server's OWN current copy of this
// map, not state.map — which may carry other pending unsaved edits this
// auto-save must never eagerly persist. Applies the SAME explicit `hidden`
// target already applied locally, rather than re-deriving independently,
// so a rapid double-toggle always converges on the GM's own screen state.
// Bulk-capable so a multi-marker change is one round trip, not one per marker.
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
    // Without re-baselining, isMapDirty() (comparing full state.map,
    // views included, against mapCleanSnapshot) would stay permanently
    // true from the first use of this toggle, silently blocking every
    // future onChange merge in watchCurrentMap. Can't exclude views
    // wholesale from normalizeForDirtyCheck the way marker fields are —
    // hiddenElementIds can ALSO be edited manually via the View editor,
    // which does NOT auto-save and must still show dirty. So re-baseline
    // only the views slice, at the moment it's confirmed synced; any later
    // edit via either path correctly diverges again.
    if (mapCleanSnapshot !== null) {
      try {
        const clean = JSON.parse(mapCleanSnapshot);
        clean.views = JSON.parse(JSON.stringify(state.map.views));
        mapCleanSnapshot = JSON.stringify(clean);
        updateMapToolbarState();
      } catch (error) {
        // mapCleanSnapshot is always our own prior JSON.stringify output —
        // not worth surfacing a parse failure over what's still a
        // successful save.
      }
    }
  } catch (error) {
    status?.show(error?.message || "Unable to save that change.", { type: "danger" });
  }
}

// Move to Map's source-side removal needs to persist just as immediately
// as the destination-side add does, or a moved marker briefly exists on
// BOTH maps until the next Save — the marker correctly vanished from the
// current view but reappeared after navigating away and back, since only
// the destination side had reached the server. Same "fetch fresh, mutate,
// save" shape as autoSaveHiddenFromPlayersView, bulk-capable so moving
// several markers is one round trip, not one per marker.
// idsByLayer: Map<layerId, Set<elementId>>.
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
    // Same per-element clean-snapshot patch autoSaveHistoryEntry's
    // Draw/Shape-deletion branch uses — so Save doesn't keep nagging about
    // a removal that already reached the server.
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
  // null (no override, native size) becomes "" here — assigning null
  // directly to a text input's .value stringifies to the literal "null".
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

// Same icon per layer type as the "Add X layer" buttons above, so the
// list row always matches whatever icon the GM clicked to create it.
const LAYER_TYPE_ICONS = {
  vector: "tabler:vector",
  grid: "tabler:grid-dots",
  raster: "tabler:photo",
  marker: "tabler:map-pin",
};

// Icon + short label for one of a layer's placed elements, by kind — used
// by the left pane's per-layer component list (renderLayers below), kept
// independent from renderSelection's own per-kind icon/title logic, which
// needs more context (preset lookup, point counts) this compact list has
// no room for. `cell` elements are never passed in — see renderLayers'
// filter below.
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

// Displayed topmost-first (reverse of state.map.layers' array order, where
// a LATER index renders on top) — matches the Photoshop-style convention
// GMs expect: the layer nearest the top of the list renders nearest the
// front of the map.
// Palette-style row — Visible/Locked and Move up/down live in the right
// pane's Selection panel once a layer is selected, so this list stays
// purely "pick a layer"; the Lock icon here is a read-only glance
// indicator, not its own control (clicking it just selects the layer).
//
// Whichever layer currently owns the selection gets an expanded sub-list
// of its own placed elements underneath, each a small button
// (describeLayerElement) — a second way to reach a component besides
// clicking it on the map, useful when a layer is Locked or buried under
// other layers' hit targets. Grid cells are excluded — a grid layer's
// `elements` can run into the dozens/hundreds, and cell selection is
// already a dedicated multi-select flow this list isn't meant to replace.
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
      // for a "marker-elements" selection — checked separately, or every
      // layer's sub-list would collapse the instant a second marker gets
      // Ctrl-clicked into a multi-selection.
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
            // instead of replacing it, same convention as the map canvas's
            // own marker dots. Only markers support this.
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
  // Also re-renders the right pane's copy of these reorder buttons so
  // their disabled-at-the-boundary state stays correct either way.
  renderSelection();
  renderLayerOverlays();
  renderJson();
}

// Deep-copies a layer through the SAME map-model.js factories that create
// elements fresh, rather than a JSON clone with ids poked out — Groups and
// selection state key off element ids, so sharing them with the source
// layer would make the two layers' elements indistinguishable by id, not
// just visually duplicated.
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
      // Attachment deliberately NOT copied — two elements bound to the
      // same token would render on top of each other with no way to tell
      // them apart via drag; a duplicate always starts freestanding at the
      // original's own (copied) origin.
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
    // `key` is coord-derived, not an identity id — safe to carry over
    // as-is, unlike `id` which createGridCell regenerates fresh below.
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
    // Palette-style row — same icon as the Add group button above,
    // matching Layers' own row convention.
    item.className = "list-group-item list-group-item-action d-flex align-items-center gap-2";
    // .active (Bootstrap's real styled selection state), not aria-current
    // — aria-current alone has no visual effect anywhere in this suite's CSS.
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
    // Palette-style row — same icon as the Add view button above,
    // matching Layers'/Groups' row convention.
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

// A single blue icon, same treatment as the Layers/Groups/Views list rows
// above (and, where the kind IS a layer type, the same icon those rows
// use). null hides it entirely (the "No selection" state).
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
  // Cleared unconditionally, repopulated only by whichever selection
  // kind's render function uses it (every kind except a plain drawn path,
  // which still builds a standalone inline Delete).
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

  // Just one color — a freehand path has no meaningful fill (an open line,
  // not a closed shape), same model the toolbar's drawColor swatch uses.
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

// No post-placement per-vertex editing — a wall's `points` array has no
// single natural "position" field the way a shape's one-point origin does.
// GM-only surface — Secret/Locked only restrict the Dashboard widget's
// player-facing click-to-toggle.
function renderWallSelectionEditor(layer, wallElement) {
  if (!elements.selectionEditor) {
    return;
  }
  // True while showing the Wall tool's not-yet-placed draft rather than a
  // real placed wall — same reasoning as renderVectorShapeSelectionEditor's
  // isDraftShape, applied to Wall.
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
    // "door" — they just go inert. Switching back later picks up where
    // they were left.
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
      // Same "toggling on re-aligns immediately" behavior as Shape's Snap
      // to Grid — a wall has no per-vertex drag, so this is the only way
      // to align an off-grid wall without redrawing it.
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

  // Suppressed entirely for a draft — nothing real to delete/open/close
  // yet, and state.selection doesn't point at the draft either.
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
  // True while showing the Light tool's not-yet-placed draft rather than a
  // real placed light — same reasoning as isDraftShape, applied to Light.
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
  // live position every render (resolveLightOrigin) instead of its own
  // stored origin, moving with it as dragged — a torch a character
  // carries. Lists every marker across every layer, since a light and its
  // carrier don't have to share one.
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

  // Shown only while freestanding; while attached, position derives from
  // the host marker instead of being directly authored.
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

  // Map units (cells), not the map's real-world Scale unit — same
  // "(cells)" vocabulary Shape's own Size/Width fields use.
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
    // point at the draft.
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

// Same "select, then Delete" pattern as a drawn path's editor, plus
// numeric fields to dial in size/direction precisely after the drag-to-
// place gesture gets it roughly right. Size/Width edit directly in map
// units (cells), not through the map's own Scale conversion — that's what
// PRESENTS a cell count as "10 ft" elsewhere, not what this field edits
// in. `step: 1` moves the spinner a whole cell at a time, but typed values
// are never rounded — a drag-placed shape can land on a fractional cell
// count, and forcing it whole here would silently change the shape.
function renderVectorShapeSelectionEditor(layer, shapeElement) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  disposeTooltips(container);
  container.innerHTML = "";

  // True while rendering the Shape tool's own in-progress DRAFT rather
  // than an already-placed selection — suppresses the Delete button and
  // redirects field handlers to renderArmedShapeInspector() instead of
  // renderSelection(), so they keep showing the draft rather than
  // whatever state.selection points to underneath it (typically the layer).
  const isDraftShape = shapeElement === draftShapeElement;

  const selectedPreset = getPresetById(shapeElement.presetId) || getPresetById("circle");
  // Presets whose geometry uses a facing direction/spread beyond plain
  // size. Hardcoded lists, not a new registry field — mirrors this
  // panel's pre-existing style.
  const usesAngle = ["cone", "line", "beam", "cone-blast"].includes(selectedPreset.id);
  const usesSpread = ["cone", "cone-blast"].includes(selectedPreset.id);
  const usesWidth = selectedPreset.id === "line";

  // No renderSelection() — presetId (the only thing deciding which fields
  // show) never changes from editing Size/Angle/Spread/Width, so nothing
  // needs rebuilding, and doing it anyway risks destroying the input being
  // edited. Changing the preset itself, via "Change Shape/Effect" below,
  // DOES call renderSelection() after committing.
  function applyShapeChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
  }

  // Opens the picker modal on this exact element — the only way to change
  // WHICH shape/effect a placed element is; the toolbar's pre-placement
  // type select only affects new placements. Same input+button shape as
  // Press/Workbench's Image component field — a readonly text input
  // showing the current pick, plus a button that opens the modal.
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

  // Attach to Token — same capability/wiring Lights already have — an
  // attached shape/effect tracks that marker's live position every render
  // instead of its own stored origin. Lists every marker across every layer.
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
    // same reasoning the preset modal's own Apply handler follows.
    if (isDraftShape) {
      renderArmedShapeInspector();
    } else {
      renderSelection();
    }
  });
  container.appendChild(attachField);

  // Label — every shape/effect can carry one, letting a GM name any
  // placed element for its own sake, not just for the particle-only
  // re-trigger lookup that originally motivated it.
  const labelField = createFormFloatingField({ label: "Label (optional)" });
  const labelInput = labelField.querySelector("input");
  labelInput.value = shapeElement.label || "";
  labelInput.addEventListener("change", () => {
    applyShapeChange("shape label", () => {
      shapeElement.label = labelInput.value.trim();
    });
  });
  container.appendChild(labelField);

  // Shown only while freestanding; while attached, position derives from
  // the host marker, same as Light's gate above. Edits the same content-
  // space pixel coordinate Layer Position X/Y exposes, not
  // shapeElement.origin's raw stored shape — origin is {x,y} for
  // image/canvas maps but {lat,lng} for tile ones, and this keeps the
  // field meaning "pixels from the map's center" either way.
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

  // dataAttr on Size/Angle only — the two fields the Shape tool's drag
  // gesture updates LIVE by writing straight into these inputs' .value,
  // rather than rebuilding the whole panel on every pointermove tick.
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

  // Outline width — a geometry-only concept — joins the SAME `fields`
  // pool as Size/Angle/Spread/Width rather than its own row: a lone
  // half-width field left alone broke to a new line with an awkward gap.
  // Every geometry preset's field count is odd on its own but becomes
  // even once Outline width joins it, so chunking by twos below always
  // pairs cleanly.
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

  // Fill/Outline/Opacity live in the Shape/Effect picker modal alongside a
  // preset's own colorSlots/params — editing them here too would just
  // duplicate the same values in two places.

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
      // immediately — otherwise the toggle would read "on" while the shape
      // visibly sat off-grid until next moved.
      if (snapInput.checked) {
        shapeElement.origin = snapShapeOriginToGrid(shapeElement.origin, layer);
      }
    });
  });
  container.appendChild(snapField);

  // Loop/Play — only meaningful for a particle preset (Effect); a plain
  // geometry Shape has neither. Loop decides whether it plays continuously
  // (true, "campfire") or holds at rest until replayed (false, "spell
  // blast") — Label is what a re-trigger looks a resting Effect up by.
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
      // same full-rebuild reasoning as other panel-shape-changing controls.
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

  // Same shared icon-toolbar factory/mount point Layer selection uses —
  // renderSelection() clears the mount before every render, so only the
  // current selection kind populates it. Suppressed entirely for a draft —
  // state.selection doesn't point at this element yet, so
  // deleteCurrentSelection would act on whatever it DOES point to
  // (typically the layer) — a real footgun this avoids outright.
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
  // Activates the "Change Shape/Effect" button's own tooltip — createIconButton's
  // `label` sets the attribute, but nothing initializes a live Bootstrap
  // Tooltip off it until this runs.
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
  // A "marker-elements" (plural) multi-selection has no single layerId the
  // way selectedLayerId expects — it can span several layers — but every
  // entry is necessarily a marker, so its mere existence tells us the
  // overlay needs to stay interactive. Without this, forming a multi-
  // selection on a tile base map set the overlay pane non-interactive,
  // silently swallowing every further click, including the Ctrl-click
  // meant to extend the selection.
  const hasMultiMarkerSelection = state.selection.kind === "marker-elements" && (state.selection.elements || []).length > 0;
  // A selected Group also arms its target grid layer's interactivity
  // without the grid layer ever being the current `selection` — this gate
  // has to know that too, or clicking a group's cells would never reach
  // the grid's own pointerdown listener on a tile base map.
  const isInteractive =
    Boolean(layer && (layer.type === "grid" || layer.type === "marker")) || state.selection.kind === "group" || hasMultiMarkerSelection;
  overlay.classList.toggle("is-interactive", isInteractive);
  if (overlay.parentElement && overlay.parentElement.classList.contains("leaflet-pane")) {
    overlay.parentElement.style.pointerEvents = isInteractive ? "auto" : "none";
  }
}

// getGridLayoutScale/getGridBackgroundPosition delegate to lib/map-viewer.js
// (same math createGridLayerElement uses internally) — kept here only
// because bindLayerDrag's whole-layer drag (Orrery-authoring-only) still
// needs them directly.
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

// getLayerPositionScale/getLayerSizeScale/getLayerRenderPosition are
// called directly by updateTileLayerElementPosition below (whole-layer
// drag, Orrery-authoring-only) — everything else in the render loop lives
// only in lib/map-viewer.js now.
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

// The render loop (renderLayerOverlays below) delegates to the shared
// renderMapLayers orchestrator; selectMarkerElementForDrag stays here since
// it's passed as the onMarkerDragStart callback (Orrery-only — updates
// state.selection and the inspector, which the shared module has no
// concept of).
//
// A lightweight selection update for the moment a marker drag begins:
// updates state.selection and the inspector, but deliberately skips
// renderLayerOverlays() — that would tear down the very dot element the
// drag is about to setPointerCapture on, ending the gesture the instant
// its DOM node gets swapped out.
function selectMarkerElementForDrag(layer, markerElement, dotEl) {
  // Bypasses setSelection, so it needs its own copy of the
  // armedMarkerLayerId logic: stays armed only if this marker's layer was
  // ALREADY the armed one; a fallback click on a never-selected layer does
  // not arm it.
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

// Ctrl/Cmd/Shift-click on a marker — extends the current selection into
// (or shrinks out of) a multi-marker selection, rather than replacing it.
// Uses ordinary setSelection since this never begins a drag, so there's no
// live dotEl to preserve across a renderLayerOverlays() rebuild.
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

// Same reasoning as selectMarkerElementForDrag — skips renderLayerOverlays()
// to avoid tearing down the SVG nodes a shape drag is about to
// setPointerCapture on. Before this split existed, routing a shape's
// pointerdown through the plain setSelection every other vector-path click
// uses rebuilt the overlay on every click, which is why shapes could be
// selected but never actually dragged.
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
    // Best-effort — some browsers throw InvalidStateError capturing in
    // certain DOM positions; the pointermove/pointerup listeners below
    // track the gesture regardless.
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
      // translating the wrapper too would apply the same offset twice.
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

// The whole render loop lives in lib/map-viewer.js's renderMapLayers —
// shared with the Dashboard's Map widget, so every layer type renders
// identically in both places. Everything below is Orrery's own authoring
// behavior, supplied as callbacks; none of it runs when a caller (the
// widget) doesn't pass it.
// Resolves which grid layer a selected Group's cells get painted onto —
// its own Fog of War-linked layer if it has one, else the GM's last
// "Paint on layer" pick if it still exists, else the map's first grid layer.
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
// EVERY character-linked marker, not just whichever inspector happens to
// be open — without this, a marker's Auto-Reveal Vision Range or
// condition-icon badges would never resolve past their fallback until
// clicked. Fire-and-forget, cheap after the first pass.
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
// primeCharacterPayloadCache, for Monster/NPC-linked markers' condition
// icons — fires the active Encounter fetch (once per group) and then its
// System's conditions fetch. No-op with no active group or no such marker.
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

// The Marker Resource Bar shows for ANY combatant with a linked marker —
// character, monster, or NPC alike, unlike condition icons (Character
// conditions read straight off its own payload). So this primes the
// active Encounter whenever the map has ANY referenced marker, not gated
// on Monster/NPC presence the way primeMonsterConditionCache is.
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

// Which characters the current viewer has owner/admin/edit-shared access
// to (allowsDelete's own owner-or-admin-or-edit-shared rule — the right
// rule for a CHARACTER, unlike mapAllowsDelete's narrower ownership-only
// rule for the map itself) — only consulted from the restricted render
// path; the full-access path never reaches this.
// Without a per-marker check of any kind, ANY signed-in visitor reaching
// Orrery's own authoring view — most often a player following the
// Dashboard Map widget's own "Open in Orrery"
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
// fallback click-to-select must stay suppressed or it steals the click
// (e.g. a Measure click lands on a marker and selects it instead of
// measuring). Draw/Shape/Wall/Light each keep a module-level flag;
// Measure/Ping read their own toggle button's class instead.
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
// selecting its owning Layer — click whatever's under the cursor, topmost
// wins via ordinary DOM stacking. Selecting a Layer still narrows this to
// just that layer's own elements (isLayerSelected); this only adds the
// "nothing selected yet" case. Suppressed while a gesture tool is armed.
function isLayerFallbackInteractive(layer) {
  if (isAnyGestureToolActive()) return false;
  if (state.selection.kind === null) return true;
  return isLayerSelected(layer);
}

// Full-access render path only (the restricted path uses map-viewer.js's
// own buildRestrictedMapOptions instead). GM/owner/admin can click-select
// and drag any marker on the selected layer, or any marker at all when
// none is selected — isLayerFallbackInteractive covers both cases.
function isMarkerDraggableForFullAccess(layer) {
  return isLayerFallbackInteractive(layer);
}

// Replays a placed, non-looping particle effect's run() cycle from its
// inspector "Play" button. Not a data change, so no recordHistory — just
// resets its "already played" state, re-renders locally (same mechanism
// triggerElementById in map.js uses for a remote trigger), then broadcasts
// so the rest of the table sees it too. Plays locally first rather than
// waiting on the SSE round-trip, same as the ping tool below.
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
  // cursor via direct style mutation outside this function; it needs
  // nothing from a re-render until the gesture ends. Any render mid-drag
  // would rebuild the marker layer's DOM and tear the dragged dot out from
  // under the pointer capture — including the fire-and-forget re-renders
  // the ownership/payload cache primers below can trigger on first load,
  // not just the remote poll. One guard here covers every trigger.
  if (isDraggingRestrictedMarker) return;
  const hasFullAccess = currentUserHasFullMapAccess();
  // Hides everything below `[data-pane]`/the floating toolbar's authoring
  // buttons (see css/styles.css for the full rule list). Gated on
  // mapIsLoaded too so a fresh page load doesn't flash the restricted
  // class before there's a map to judge access against.
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
    // Whether THIS layer's empty-click-places-a-marker is armed. Kept
    // separate from isMarkerDraggable/isLayerFallbackInteractive: an
    // existing marker can be fallback-clickable on a layer not armed for
    // placing new ones.
    armedMarkerLayerId,
    // Same fallback click-to-select for vector paths/shapes/doors as
    // markers get above (built for the Dashboard Map widget, which has no
    // layer-selection concept). Grid layers don't get this — a grid
    // overlay covers the whole map, so it would swallow every click.
    isVectorLayerInteractive: isLayerFallbackInteractive,
    selection: state.selection,
    activeGroup,
    // Needed for the live fog-preview tint and so the marker inspector's
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
        // VTT-like immediacy: a moved token saves itself instantly, same as
        // a restricted viewer's own marker drag. Doesn't light up the GM's
        // Save button (isMapDirty excludes this field) — that stays
        // reserved for walls/lights/layer settings/map settings.
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
      // Deferred until drag-end, like bindLayerDrag's whole-layer drag: a
      // full renderLayerOverlays() mid-drag would replace dotEl in the DOM
      // out from under the pointer capture driving the gesture.
      renderLayerOverlays();
      // Updates the marker's own Position X/Y fields if its inspector is
      // open — renderLayerOverlays() alone doesn't touch the selection
      // panel. Safe here (post drag-end) unlike during the drag itself.
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
    // Wired only while Draw/Wall mode is off — a drawn path needs to stay
    // click-through while actively drawing, so a new stroke can start
    // anywhere. NOT gated on shapeModeActive/lightModeActive: a placed
    // shape/light must stay immediately selectable even while its own tool
    // is still armed (a placed Marker works the same way). A shape/light
    // uses the lightweight selectShapeElementForDrag (no overlay rebuild)
    // since it might be dragged next; a plain path has no drag to protect,
    // so the regular setSelection is fine. Walls get their own dedicated
    // onWallDragEnd/onWallVertexDragEnd instead of this callback — their
    // placement commits via double-click/Enter, not a drag-release, so
    // there's no "click my own just-placed one" case to preserve.
    onVectorPathClick: drawModeActive || wallModeActive
      ? undefined
      : (layer, elementId, event, kind) => {
          if (kind === "shape" || kind === "light") {
            selectShapeElementForDrag(layer, elementId);
          } else {
            setSelection("vector-path", elementId, { layerId: layer.id });
          }
        },
    // Shared by AoE shapes and Lights — snapMarkerPositionToGrid only uses
    // the layer's generic getMarkerLayerOffset, so it works for either. A
    // Light has no snapToGrid field of its own; `!== false` here means a
    // dragged light always snaps. Gated on wallModeActive too, not just
    // drawModeActive — an already-selected light's drag capability alone
    // (independent of click-to-select) was enough to intercept a pointerdown
    // meant for the Wall tool.
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
    // Whole-wall drag — translates every point by the same delta
    // (map-viewer.js's renderWallElement already computed the shifted
    // points; this re-snaps each one and commits). Gated by every other
    // placement tool too, unlike shape/light: a wall has no "click my own
    // just-placed one" case to preserve, so no reason to stay interactive
    // while placing anything else nearby.
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
    // snap/commit and gating as onWallDragEnd, just for one point.
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
    // Additive only — a click or drag sweep adds cells, never removes one;
    // removal still works via the plain select-then-checkbox path. No
    // recordHistory per cell — paintDragBefore (set on the first cell of a
    // gesture) and onGridCellPaintEnd batch the whole gesture into one
    // undo entry.
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
      // Full rebuild only at drag-end, not per-cell — refreshes the
      // Members list/count in the still-open group editor.
      renderSelection();
    },
  });
}

// Restricted (non-owner, non-admin) viewer — no Layers/Groups/Views panel,
// no toolbar tools, no click-to-select at all (css/styles.css's
// .orrery-restricted-viewer rules hide those UI surfaces). The interactive
// policy (drag your own character marker, toggle a non-secret unlocked
// door, wall-aware blocking, grid-snap on drop) comes from map-viewer.js's
// shared buildRestrictedMapOptions — the same function the Dashboard's Map
// widget uses, so the two never drift into different-feeling drag behavior.
// A deliberately separate renderMapLayers call from the full-access one
// above, not a conditionally-neutered version of it — same "supply no
// callback to opt a feature out" convention the widget's map.js uses.
// A minimal popover for a restricted viewer clicking a marker they can't
// drag but that references a real Library record — mirrors the Dashboard
// Map widget's own openMarkerLinkPopover; each builds its own small
// popover since the two share no DOM-building module beyond map-viewer.js's
// pure resolveMarkerLinkTarget.
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

  // One Claim button per remaining item, calling the same shared
  // claimMarkerContentEntry (marker-contents.js) the Dashboard's Map widget
  // uses, so claim logic never diverges even though each builds its own
  // popover DOM.
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

// A restricted viewer's writes need an immediate, single-element persist
// (map-live-sync.js's persistElementUpdate: fresh fetch, patch, save) —
// not the usual "mutate state.map, wait for GM Save" convention, since a
// restricted viewer never sees a Save button. Merges the server's response
// back in via applyRemoteMapLayers, same as the poll (watchCurrentMap).
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
// level. Tracks its own last-committed display value (rather than
// re-reading its build-time prop) since this field is never rebuilt after
// mount, so nothing else keeps that state for it.
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

// Position X/Y on a Layer's whole-layer pan offset and a Marker's own
// {x,y} share this shape. Uses applyLayerPositionChange, not
// applyLayerChange, so committing doesn't rebuild the panel it lives in.
// Marker elements use their own inline updater instead.
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
// throughout regardless of shape. `variant` picks the layout shape:
// "floating" (default) — standalone single-column field, matching
// Workbench's inspector convention; "compact" — small-label-above-input,
// for a field paired in a dense row; "half" — condensed alongside Position
// X/Y so labels in that row match instead of one looking larger.
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

// The Marker Layer's Icon setting — uses the same autocomplete+preview
// picker as Press/Workbench's icon fields.
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
// show the fields it gates" shape as buildFogOfWarFields, not a
// LAYER_SETTINGS_SCHEMA entry since these only make sense once labels are on.
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

// Fog of War toggle + reveal-group picker for a grid layer. Not a
// LAYER_SETTINGS_SCHEMA entry — the reveal-group select needs live options
// from state.map.groups, which the schema-driven buildLayerSettingField
// (static options only) can't supply.
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
      // Auto-create a reveal group the first time fog is turned on, so
      // there's somewhere to add cells instead of a dead unconfigured state.
      if (toggleInput.checked && !layer.settings.revealGroupId) {
        const group = createGroup({ name: `${layer.name} — Revealed` });
        state.map.groups.push(group);
        layer.settings.revealGroupId = group.id;
      }
    });
    // applyLayerSettingsChange doesn't re-render the left pane's Groups
    // list — the new reveal group needs it explicitly or it never appears.
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

    // Two independent sliders, not one — "opaque enough a player can't
    // cheat" and "visible enough a GM can work" are different targets.
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

// Used by buildLayerSettingField for every schema-driven setting that
// doesn't show/hide another field based on its own value (unlike Fog of
// War's Reveal Group, which goes through applyLayerSettingsChange
// instead). Skipping renderSelection() is what lets Tab move through
// Name → Position X → Position Y → Grid Type → Cell Size without a
// mid-transition rebuild stealing focus at every stop.
function applyLayerSettingsFieldChange(label, apply) {
  recordHistory(label, () => {
    apply();
    updateMapTimestamp(state.map);
  });
  renderLayerOverlays();
  renderJson();
}

// Same reasoning as applyLayerSettingsFieldChange, for the Layer's own
// Name field — renderLayers() still runs (left-hand list shows the name),
// but renderSelection() doesn't, since Name is the first stop in the tab
// sequence and a rebuild on committing it would derail every field after.
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

// A marker's own target-kind whitelist for the References picker — same
// restricted, alphabetized shape as the suite's own RELATIONSHIP_TARGET_KINDS,
// not the full Library kind registry: a marker only sensibly points at
// something with a physical presence on the map, or a Macro to trigger.
const MARKER_REFERENCE_KINDS = [
  { id: "character", label: "Character" },
  { id: "location", label: "Location" },
  { id: "macro", label: "Macro" },
  { id: "monster", label: "Monster" },
  { id: "npc", label: "NPC" },
  { id: "wonder", label: "Wonder" },
];

// A marker's Vision Range can be Bound to a field on its linked Character
// record — resolving a live Binding needs a real fetch, but
// resolveRevealedCells/renderMapLayers are synchronous. Rather than making
// the render pipeline async, this is a synchronous cache-backed lookup
// threaded through as a plain callback; `ensureCharacterPayloadCached` is
// fire-and-forget — populates the cache and triggers a re-render once the
// fetch resolves.
//
// Also backs a Character marker's condition icons, which need to update
// live as Combat Tracker adds them (unlike Vision Range's original
// fetch-once tradeoff) — keyed by the character's refId, not any one
// marker instance, so it re-fetches in the background once the cached
// copy passes CHARACTER_PAYLOAD_STALE_MS, still returning the last-known
// value synchronously (no flicker) until the fresh copy lands.
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
      // Stamping the timestamp on failure too applies the staleness window
      // to a permanently-inaccessible reference, preventing a retry-every-render loop.
      characterPayloadFetchedAt.set(refId, Date.now());
      pendingCharacterFetches.delete(refId);
    });
}

// The GM-facing "@field" autocomplete list for a marker's Vision Range
// Binding — walks refId's Character -> Template's `.schema` -> System's
// field tree, same two-hop chain Workbench's character editor resolves a
// System through. Cached per refId; empty (never an error) when any hop
// is missing, degrading to a plain literal/formula input with no suggestions.
const characterSystemFieldsCache = new Map();
const pendingCharacterSystemFieldsFetches = new Set();
function getCachedCharacterSystemFields(refId) {
  return characterSystemFieldsCache.get(refId) || [];
}

// Which System a Character resolves to (refId -> systemId), cached
// alongside characterSystemFieldsCache by the same fetch — kept separate
// so existing callers of getCachedCharacterSystemFields don't change shape.
const characterSystemIdCache = new Map();
function getCachedCharacterSystemId(refId) {
  return characterSystemIdCache.get(refId) || "";
}

// A System's Conditions vocabulary, resolved to id -> {icon, color} and
// cached by systemId — fetched at most once regardless of how many
// characters/markers reference that System. icon/color live in each
// Condition value's "Extra Properties" JSON (Loom's
// property-schema-editor.js), same generic per-value pattern
// resolveMonsterSizeCells reads `sizeValue` through. Also carries the
// resolved `tags`-role binding path (e.g. "@conditions") a Character's
// live conditions array is read from.
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

// Fetches a System's `fields` directly by systemId and populates
// systemConditionsCache — for a caller that only knows the systemId
// (Monster/NPC condition resolution via the active Encounter). A caller
// with a Character->Template hop already in hand
// (ensureCharacterSystemFieldsCached) populates this cache directly instead.
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
      // preferLocal: false — a Template's schema and System's fields are
      // edited directly in Workbench/Loom; a stale local copy would
      // silently starve the @-autocomplete with no visible sign of why.
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

// The campaign's active/spotlighted Encounter, cached by groupId (a GM
// could switch campaigns mid-session, so not a single global slot) —
// map-viewer.js's shared resolveMarkerConditionIcons reads a Monster/NPC
// combatant's live conditions from here, since Monster/NPC records are
// reusable templates never mutated per-combat-instance. No active
// encounter, or a fetch failure, caches an empty combatants list rather
// than erroring — "not in combat" is a normal state. Re-fetches past
// ACTIVE_ENCOUNTER_STALE_MS, same staleness pattern as the character
// payload cache above, for the same reason: conditions need to stay live.
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

// Every combatant in the active encounter sharing this marker's
// refKind/refId — the candidate set markerElement.linkedCombatantId
// disambiguates when there's more than one (three Goblins, one Monster
// record). Used by the "Linked Combatant" picker to populate its options —
// a plain array filter, so it stays local rather than living in
// map-viewer.js's shared resolveMarkerConditionIcons.
function findMatchingCombatants(markerElement, groupId) {
  const encounter = getCachedActiveEncounter(groupId);
  if (!encounter) return [];
  return encounter.combatants.filter(
    (combatant) => combatant.refKind === markerElement.refKind && combatant.refId === markerElement.refId
  );
}

// Thin wrapper around map-viewer.js's shared resolveMarkerConditionIcons —
// Orrery only supplies its own cache-backed getters; the resolution
// algorithm itself lives in that one shared place, so this file and the
// Dashboard's map.js widget (which keep independent copies of the same
// caches) can't drift apart on what a marker's condition badges show.
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

// A System's `resource`-role combatBindings entries (name only — all
// guessBarResourceName and the Settings dropdown need) — same
// cache-by-systemId shape as systemConditionsCache, since the Marker
// Resource Bar setting needs every candidate resource name independently
// of the tags-role vocabulary that cache tracks.
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
      // System fields fetch in this file.
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

// Which named `resource`-role binding the Marker Resource Bar represents
// for a given System — per-System, per-browser, same storage shape
// Crucible's combatScalingField/creatureTypeField preferences use.
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
    // preferLocal: false — a stale local copy would silently resolve
    // every size to null forever with no visible sign anything was wrong.
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
// — the {refKind, refId, label} shape so Orrery maps can point at Sanctum
// Locations, Forge/Crucible NPCs and Monsters, Vault Effects, etc. without
// either tool knowing about the other. Mirrors Sanctum's "kind + entity" picker.
//
// This function is async, and a character-linked marker's own cache-fetch
// calls below each re-invoke renderSelection() — and therefore this whole
// function — once their fetch resolves. Without a staleness guard, two or
// three overlapping invocations each append their own Position X/Y row and
// Delete button, producing duplicates. markerSelectionEditorRenderId lets
// only the most recent invocation's tail mutate the live container/toolbar.
// Resolves a "marker-elements" selection's {layerId, id} pairs back into
// real {layer, markerElement} pairs, silently dropping any entry whose
// marker/layer no longer exists (deleted by an undo, a remote update, etc.).
function resolveSelectedMarkerElements(selection) {
  return (selection.elements || [])
    .map((entry) => {
      const layer = state.map.layers.find((candidate) => candidate.id === entry.layerId);
      const markerElement = layer?.elements?.find((candidate) => candidate.id === entry.id);
      return layer && markerElement ? { layer, markerElement } : null;
    })
    .filter(Boolean);
}

// The bulk counterpart to renderMarkerElementSelectionEditor — a read-only
// roster (no per-field editor since label/image have no shared value
// across N markers) plus the shared selectionToolbar with bulk actions
// (Delete, Move to Map).
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
    // Aggregate, not per-marker: a mixed-state selection reads as
    // "visible" (tri-state "select all" convention), so the next click
    // converges the whole group to one state instead of leaving it mixed.
    // setElementsHiddenFromPlayers takes that explicit target rather than
    // flipping each marker independently.
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
    // A cross-map write, unlike everything else this toolbar can do, so
    // it gets its own explicit access check.
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
  // undo, then refresh the inspector, overlay, and JSON preview.
  function applyMarkerElementChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderSelection();
    renderLayerOverlays();
    renderJson();
    // Icon/color save themselves instantly, like position; every other
    // marker field stays on the regular batched Save flow.
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

  // Multiplier on the grid's own cell size — 1 is a normal one-square
  // token; a Large creature (D&D 5e) is 2, Huge is 3. `step: 1` moves the
  // spinner by a whole cell, but a typed value is never rounded — a
  // fractional size is unusual but real (a Tiny creature sharing a square).
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

  // Off-the-ground offset — positive is flying above the surface, negative
  // is burrowing/submerged below it. No `min` (unlike Size) — negative is
  // meaningful here, not an error. createMarkerDot renders the two
  // directions with distinct visuals (shadow vs. dashed outline).
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

  // Vision Range — same shared Binding/Formula/Text control every other
  // bindable field uses. Meaningful only when refKind==="character" and
  // the grid layer's Auto-Reveal toggle is on, but shown regardless — an
  // inert field on a non-character marker is harmless. `@`-suggestions are
  // restricted to numeric fields on the linked Character's System (empty
  // when none is linked/resolvable).
  if (markerElement.refKind === "character" && markerElement.refId) {
    ensureCharacterPayloadCached(markerElement.refId, () => renderSelection());
    ensureCharacterSystemFieldsCached(markerElement.refId, getCachedCharacterPayload(markerElement.refId), () => renderSelection());
  }
  const visionRangeField = createBindingFormulaInput(markerElement, {
    labelText: "Vision Range (cells)",
    // Same compact "label above, form-control-sm" markup as Size right above.
    compact: true,
    placeholder: "0, @senses.darkvision, or =@senses.darkvision + 1",
    bindingKey: "visionRangeBinding",
    formulaKey: "visionRangeFormula",
    textKey: "visionRangeText",
    allowedFieldCategories: ["number"],
    systemFields: markerElement.refKind === "character" ? getCachedCharacterSystemFields(markerElement.refId) : [],
    hasSchemaSelected: Boolean(markerElement.refKind === "character" && markerElement.refId),
    // A marker has no "select a system" step nearby, so the shared
    // control's default helper/hint text would read as out-of-place noise.
    showEmptyFieldsHint: false,
    // NOT applyMarkerElementChange — this control commits on every
    // keystroke (its live Preview/@-autocomplete needs to update as you
    // type), and applyMarkerElementChange's renderSelection() would rebuild
    // this editor's DOM and steal focus out of the input on every character.
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

  // Which clip createMarkerDot cuts the marker into — "circle" (default,
  // matches every marker placed before this field existed) or "square",
  // edge-to-edge with sharp corners. Independent of Show outline below.
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

  // Whether the marker's outline ring renders at all — on by default so
  // existing markers keep their look; off for an object token (a chest)
  // that needs a clean, borderless fill.
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

  // Per-marker override of the layer's outline color — shows whichever's
  // currently effective, but always commits as this marker's own once touched.
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

  // Same range-slider shape every Opacity in this suite uses. Per-marker
  // only, no layer-wide equivalent — a token fading in/out (unconscious,
  // hidden) is a property of that one placed marker.
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
  // common/js/lib/widgets/handout.js's own picker: Whole Page, or one of
  // the page's own headings/quests. Hidden (not disabled) when the kind
  // isn't journal.
  const anchorField = createFormFloatingField({ type: "select", label: "Show" });
  const anchorSelect = anchorField.querySelector("select");
  anchorField.classList.add("d-none");
  container.appendChild(anchorField);

  // Below Entity, not above — Image is often auto-inherited from whichever
  // entity gets picked, so grouping it right after that picker reads
  // more naturally.
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

  // Icon overlays — purely visual, no mechanical effect. Useful for any
  // small indicator a GM wants to pin to a token (condition, quest, turn
  // order), not conditions specifically. A marker can carry several,
  // independently removable/re-colorable. Picking an icon adds it
  // immediately with a default badge color, no confirm step; color is set
  // after, per-chip. Placed near the bottom — least frequently touched field.
  //
  // labelClass matches createTokenImageField's Image label exactly, since
  // the two sit next to each other and should read as the same kind of label.
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

  // Scrollable so a marker stacking many icons doesn't push the rest of
  // the panel down, and collapsible (same "Custom Properties" pattern
  // used elsewhere) since most markers carry zero or few icons.
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
  // Smaller than createCollapsibleSection's default "fs-6" — "Active
  // Icons" is a lightweight glance-only list, not a peer of a real section
  // like Custom Properties. Below .extra-small (shell.css's own smallest
  // utility), so a plain inline size since nothing smaller exists.
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
      // preferLocal: false — this exists to pick up a change to the
      // referenced record made since it was linked; a cached copy defeats that.
      const result = await dataManager.get(markerElement.refKind, markerElement.refId, { preferLocal: false });
      // A marker linked before its reference had an image never gets a
      // second chance at entitySelect's own inheritance (that only fires
      // once, at link time). Every render re-checks here too, so a record
      // gaining an image later is picked up on next open, without ever
      // overwriting an image the GM set or cleared by hand.
      if (!markerElement.image && result?.payload?.image) {
        applyMarkerElementChange("marker image", () => {
          markerElement.image = result.payload.image;
        });
      }
      // Same "every panel open re-checks" reasoning as image, for Favorite
      // Color — a marker linked before it existed never got a first chance.
      if (!markerElement.outlineColor && dataManager.isAuthenticated?.()) {
        const settings = await dataManager.getUserSettings();
        if (typeof settings?.favoriteColor === "string" && settings.favoriteColor) {
          applyMarkerElementChange("marker outline color", () => {
            markerElement.outlineColor = settings.favoriteColor;
          });
        }
      }
    } catch (error) {
      // A failed fetch just means this pass skips the inheritance checks above.
    }
  }

  // Kept across calls so updateAnchorSelect can look up the currently-
  // selected journal entity's body without a second fetch —
  // fetchKindEntriesWithIds' entries already carry the full payload.
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
    // `.title` fallback — a journal page's payload has no `.name` field
    // (its display field is `.title`), so without this every journal
    // reference fell through to its raw record id, in both the label and
    // sort order.
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

  // Populates the "Show" select from the currently chosen journal entity —
  // Whole Page plus every heading/quest, same shape handout.js's picker
  // builds. `savedAnchor` (only used the first time this panel opens)
  // restores whatever anchor was previously picked, if its option exists.
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

  // The label a specific anchor would inherit — plain text, no dashes/
  // "Quest:" prefix (that's just the Show select's display formatting),
  // since this feeds the marker's actual Label field.
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
  // Baseline for the anchor and entity handlers' own "still looks
  // auto-inherited, safe to refine further" checks — the label from the
  // most specific thing already selected (anchor, else entity name).
  // lastAutoImage is the same idea for Image. Both recomputed fresh on
  // every render, since a kind/entity change tears this panel down and
  // rebuilds it — the entity handler never needs to update these itself.
  let lastAutoLabel = markerElement.refAnchor
    ? anchorDisplayLabel(markerElement.refAnchor)
    : entitySelect.selectedOptions[0]?.textContent || "";
  let lastAutoImage = markerElement.image || "";
  await refreshPreview();

  // A newer invocation already cleared and rebuilt the container while
  // this one was awaiting — bail out rather than appending a stale
  // Position X/Y row and Delete button on top of the current one's.
  if (renderId !== markerSelectionEditorRenderId) {
    return;
  }

  // Both handlers call renderSelection() rather than manually re-running
  // populateEntitySelect/refreshPreview — renderSelection() re-invokes
  // this whole function, which already does that using the updated
  // refKind/refId. Safe to tear this DOM down: a <select> "change" has no
  // pointer capture depending on the element surviving.
  kindSelect.addEventListener("change", () => {
    const kind = kindSelect.value;
    applyMarkerElementChange("marker reference kind", () => {
      markerElement.refKind = kind;
      markerElement.refId = "";
      markerElement.refAnchor = null;
      // label/image are "copy once at pick-time, stays editable after" —
      // correct within the same kind, but without resetting them here a
      // switched reference kind (Character -> Journal Page) left a stale
      // portrait/name permanently attached. outlineColor is NOT reset — it's
      // inherited from the user's Favorite Color, not the referenced entity.
      markerElement.label = "";
      markerElement.image = "";
    });
  });

  entitySelect.addEventListener("change", () => {
    const refId = entitySelect.value;
    const option = entitySelect.selectedOptions[0];
    const kind = kindSelect.value;
    // Image inheritance and a Monster's auto-sized footprint both need the
    // full record payload — fetched once here, before renderSelection()
    // tears this editor down, rather than re-fetching inside refreshPreview
    // on every render (which would re-trigger auto-fill on every redraw).
    (async () => {
      let inheritedImage = "";
      // Fetched regardless of whether an image is already set, so a
      // monster pick always resolves its footprint even with a custom image.
      let payload = null;
      const imageLooksAutoInherited = !markerElement.image || markerElement.image === lastAutoImage;
      if (refId && kind && dataManager && (imageLooksAutoInherited || kind === "monster")) {
        try {
          // preferLocal: false — a Monster's size/image is edited directly
          // in Loom/Crucible; same reasoning as resolveMonsterSizeCells.
          const result = await dataManager.get(kind, refId, { preferLocal: false });
          payload = result?.payload || null;
        } catch (error) {
          payload = null;
        }
      }
      if (imageLooksAutoInherited) {
        inheritedImage = payload?.image || "";
      }
      // Re-resolved on every Monster pick, not gated behind a "still
      // untouched" check — sizeCells always defaults to 1, so there's no
      // sentinel to distinguish "never touched" from "deliberately set to
      // 1". Picking a monster is itself the action that sets its footprint.
      let inheritedSizeCells = null;
      if (kind === "monster" && payload) {
        inheritedSizeCells = await resolveMonsterSizeCells(payload);
      }
      // Doesn't verify this record belongs to the signed-in user (needs a
      // dedicated ownership lookup) — simplified to "whoever's linking,
      // while signed in, hasn't set an outline yet."
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
        // A different entity has its own headings/quests — whatever anchor
        // was picked for the previous one likely doesn't apply here.
        markerElement.refAnchor = null;
        // Checks lastAutoLabel/lastAutoImage, not just blank — a blank-only
        // check only populated Label/Image on the marker's first entity
        // pick, leaving a prior entity's name/portrait stuck on a later
        // switch. This distinguishes "still exactly what the last pick
        // set" from a GM's own hand-typed/picked value.
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
    // The label follows the most specific thing selected — a heading/quest
    // is more specific than its page. Only when the label still looks
    // auto-inherited (matches lastAutoLabel) — a hand-typed label is never
    // overwritten.
    const nextAutoLabel = anchor ? anchorDisplayLabel(anchor) : entitySelect.selectedOptions[0]?.textContent || "";
    applyMarkerElementChange("marker reference anchor", () => {
      markerElement.refAnchor = anchor;
      if (nextAutoLabel && (!markerElement.label || markerElement.label === lastAutoLabel)) {
        markerElement.label = nextAutoLabel;
      }
    });
  });

  // NOT applyMarkerElementChange — nothing else in this panel depends on
  // the marker's position, so a rebuild mid-edit would only risk
  // destroying the focused input for no benefit.
  function applyMarkerPositionChange(label, apply) {
    recordHistory(label, () => {
      apply();
      updateMapTimestamp(state.map);
    });
    renderLayerOverlays();
    renderJson();
  }
  // Reading position.x/.y directly is correct for an image/canvas map but
  // always 0 for a tile map, whose position is {lat,lng} instead. The same
  // markerPositionToLocalPixel/localPixelToMarkerPosition round-trip the
  // shape origin's own Position X/Y uses fixes it for both map types.
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

  // "Linked Combatant" — only shown when there's real ambiguity: more than
  // one combatant in the active Encounter shares this marker's refKind/
  // refId (three Goblins, one Monster record). Absent outside combat or
  // with zero/one match — the common case resolves automatically.
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

  // Contents — createMarkerContentEntry items a player can later claim
  // into their Character inventory or the campaign's Party Inventory (see
  // marker-contents.js's header for the claim mechanism). Any marker can
  // carry this, not a separate "Container" marker type.
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

      // "Give to" — the GM delivers an entry directly to a specific
      // player's Character (or the Party) without them needing to be
      // present to claim it. Same claimMarkerContentEntry the player-facing
      // Claim button calls, just with an explicit recipient. A real
      // transaction (server round-trip, Group Log entry) — NOT routed
      // through applyMarkerElementChange/recordHistory's undo path, same as
      // the Claim button has no undo either.
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
  // One shared roster fetch for the whole Contents panel, not one per
  // entry — cached for the lifetime of this render.
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
  // currently active — never a hardcoded denomination vocabulary (5e's
  // cp/sp/ep/gp/pp is just one System's choice; a different System defines
  // its own or none at all). No "Add Currency" row for a System with no
  // currency field, rather than showing a picker with nothing to pick from.
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
  // createFullCollapsibleSection), not the positional one "Active Icons"
  // uses — its header row places the help icon beside the "Contents" label.
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

  // Same shared icon-toolbar mount every other selection kind uses, not a
  // standalone inline button — renderSelection() clears it before every
  // render, so only the current selection kind populates it.
  if (elements.selectionToolbar) {
    // A shortcut, not a second visibility mechanism — flips this marker's
    // id in/out of the auto-managed "Player View." The View editor's own
    // Visible Components checklist is the same underlying state, viewed
    // a whole-View-at-a-time instead of one marker at a time — always agree.
    // Same eye/eye-off toggle convention as Combat Tracker's per-combatant
    // switch. Rebuilds fresh on every renderSelection(), so no
    // stale-icon-reference risk to guard against.
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
    // Same explicit currentUserHasFullMapAccess() gate as
    // renderMarkerElementsSelectionEditor — a cross-map write.
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
  // `container` — this covers everything built into container itself
  // (marker icon chips' remove buttons, ...).
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
  // setDisabledTooltip, not bare `.disabled = ...` — each button already
  // has a permanent tooltip, and a real `disabled` attribute would block
  // it from showing. Must run after the appendChild calls, since the
  // wrapper needs a real parent.
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

  // Selecting this group already arms its target grid layer for click/drag
  // cell-adding (resolvePaintTargetLayer) — this panel only exposes WHICH
  // layer when it's ambiguous.
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

  // Shared icon-toolbar mount (data-selection-toolbar-mount) — renderSelection()
  // clears it each render, so only the current selection kind repopulates it.
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

  // Only shown when it's ambiguous which layer painting targets — a Fog of
  // War link or a single grid layer already resolves it unambiguously.
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
    // trash-x (vs. plain trash below) so "clear everything" reads
    // differently at a glance from "remove this one cell."
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

  // Own scrollable box (orrery-pane-list, shared with the left pane's own
  // lists) so a group with dozens of cells doesn't balloon the right pane.
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
  // setDisabledTooltip, not bare `.disabled`, and must run AFTER appendChild.
  setDisabledTooltip(pasteButton, state.propertyClipboard ? "" : "Nothing copied yet.");
  refreshTooltips();
}

// Mirrors renderSelection's own per-kind inspector titles, so the View
// editor's "Visible Components" checklist below shows the same names.
function describeMapElementKind(element) {
  if (element.kind === "marker") return element.label || "Marker";
  if (element.kind === "shape") {
    const preset = getPresetById(element.presetId) || getPresetById("circle");
    // A named Effect's own label beats the generic preset name (e.g. "Boss
    // Burst" vs. every other instance of the same preset); falls back to
    // the preset label for a plain/unlabeled Shape.
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
    // form-floating textareas need an explicit height — `rows` fights the label's own padding.
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

  // Shared searchable-checklist widget (createSearchableCheckList/
  // populateStringChecklist, generator-kit.js) — needed once lists cover
  // every element on the map, not just a few layers. Checked = visible;
  // hiddenLayerIds/hiddenElementIds are DENY-lists under the hood, so what's
  // written back is the COMPLEMENT of the checked set, not the set itself.
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

  // Shared icon-toolbar mount (data-selection-toolbar-mount) — renderSelection()
  // clears it each render, so only the current selection kind repopulates it.
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
    // A "@"/"=" prefix is a binding/formula, not a literal hex — createColorPickerField
    // needs the caller to pre-classify which of its two params the value is.
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
      // No evaluate — a map shape/effect has no Character context to resolve
      // a "@..." reference against, so a binding stores/displays as typed
      // but previews as indeterminate (same as Workbench's Template canvas).
    });
    fragment.appendChild(field);
  });
  // Opacity applies to every preset (geometry or particle), so it's
  // rendered unconditionally rather than as a colorSlot-driven entry.
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
    // Modal can open on an in-progress draft, not just a placed shape — hand
    // back to the draft view, or Applying would fall back to state.selection.
    if (shapeElement === draftShapeElement) {
      renderArmedShapeInspector();
    } else {
      renderSelection();
    }
    window.bootstrap?.Modal?.getInstance(elements.shapeEffectModal)?.hide();
  });
}

// Carries everything about a marker except WHERE it sits, so a moved marker
// reads as "the same token, relocated." `position` is overwritten by the
// Apply handler via computeMoveMarkerPositions (source/dest coordinate
// systems don't match); `linkedCombatantId` is scoped to the source map's
// Encounter and dropped. overlayIcons isn't a constructor arg, so it's
// copied onto the clone afterward.
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

// "Reset near origin" targets for a batch of moved markers, aware of the
// DESTINATION map's base type (unknowable at clone time): a tile map stores
// {lat,lng} not {x,y}, so createMarkerElement's {x:0,y:0} default would
// leave a moved marker unrendered — base it on the dest view center instead.
// Markers are also staggered by a small per-axis step so a batch doesn't
// land stacked and unclickable; the GM repositions precisely from there.
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

// Captured at open time, not re-resolved from state.selection at Apply —
// the modal stays open across an await, and a stray render touching
// state.selection in that window shouldn't change WHICH markers move.
let moveMarkerModalEntries = [];

// Opened from either the single-marker or bulk "marker-elements" toolbar.
// Re-checks currentUserHasFullMapAccess() here too (not just at the
// button's render-time gate) in case permissions changed without a re-render.
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
    // Only remove originals after the destination write succeeds — a failed
    // cross-map save must never lose the source marker.
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
    // Persists the removal right away — a move can't sit as an ordinary
    // batched, Save-button-pending edit the way a plain Delete does.
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

// Unlike Draw, Shape has its own right-pane Inspector (renderArmedShapeInspector)
// that must take over/hand back the panel on arm/disarm. Creates/discards
// draftShapeElement here — the one place its lifecycle is owned.
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

// Right-pane Inspector shown while the Shape/Effect tool is armed. Renders
// through the SAME renderVectorShapeSelectionEditor an already-placed shape
// uses, rather than a separate simplified view — only this wrapper's own
// title/details/icon (and the toolbar clear renderSelection() normally does)
// are specific to the "drawing" state.
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

// Places Shapes/Effects onto the selected vector layer via the same
// click-drag-commit gesture Draw's freehand stroke uses, sized through the
// same pixelsToCells conversion Measure uses. The live preview reuses
// map-viewer.js's own renderShapeElement (the committed-geometry renderer)
// against a throwaway element, so only one function turns a shape's fields
// into an SVG primitive.
function setupShapeTool() {
  if (!elements.shapeToggle || !mapContainer) {
    return;
  }
  updateShapeAvailability();

  elements.shapeToggle.addEventListener("click", () => {
    if (elements.shapeToggle.disabled) return;
    // Re-render picks up the orrery-shaping cursor class immediately.
    // Existing shapes stay selectable/draggable regardless — only NEW
    // placement gates on this toggle.
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

    // Type/colors were already picked in the Inspector and live on
    // draftShapeElement — this gesture only decides Size/Angle/Position, so
    // it mutates the same draft object rather than tracking a local copy.
    draftShapeElement.origin = origin;
    draftShapeElement.sizeCells = 0;
    draftShapeElement.angleDeg = 0;
    renderArmedShapeInspector();

    function drawPreview() {
      preview.innerHTML = "";
      // A "particles" preset (an Effect) has no live drag preview —
      // renderShapeElement stays scoped to static geometry; Effects animate
      // via a separate canvas system. No visual feedback while dragging to
      // size one, but the placed/committed element is real either way.
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
      // Live-updates only the Size/Angle inputs already in the right pane —
      // no full rebuild mid-drag, which could disrupt an open color popover.
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
        // Snap to Grid defaults on, so new shapes land pre-snapped and the
        // toggle's initial checked state matches what just happened.
        placedElement.origin = snapShapeOriginToGrid(placedElement.origin, layer);
        recordHistory("place shape", () => {
          layer.elements = layer.elements || [];
          layer.elements.push(placedElement);
          updateMapTimestamp(state.map);
        });
        renderJson();
        // Single-shot — see the Draw tool's own identical comment above.
        // Clears draftShapeElement, but placedElement still references the
        // committed object, so nothing below is affected.
        setShapeModeActive(false);
        // Selects the just-placed shape/effect immediately rather than
        // whatever was selected before — a GM's next move is almost always
        // adjusting its color/size/attachment in the inspector.
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

// Reuses the Shape tool's click-drag-commit gesture — a light is
// geometrically a circle (origin + range), so no shape-type picker, but the
// live preview reuses map-viewer.js's own renderLightElement, same as
// setupShapeTool's preview does for its own element type.
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

    // Color/opacity were already picked in the Inspector and live on
    // draftLightElement — mutates the same draft object rather than
    // tracking a local copy (see setupShapeTool's identical reasoning).
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
      // Live-updates only the Range input already in the right pane —
      // skips a full rebuild mid-drag (see setupShapeTool's identical logic).
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
        // Single-shot; selects the just-placed light immediately, matching
        // Shape's identical onUp behavior.
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

// The account's single "active campaign" (header user menu, auth-ui.js) —
// reused here rather than a second Orrery-local picker that could desync.
function getActiveCampaignGroupId() {
  return dataManager?.getActiveGroup?.()?.groupId || "";
}

// A dedicated overlay for ping dots, a sibling of the regular layer
// overlay rather than its child — renderMapLayers does
// `overlay.innerHTML = ""` on every re-render, which would wipe a ping
// before its fade animation finished.
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

// Renders a click-to-ping broadcast as a transient dot. Called for both
// remote pings and the local GM's own — every ping arrives back through
// the same live-stream echo, no separate optimistic render path.
function renderIncomingPing({ position, by }) {
  if (!position) return;
  const host = getPingOverlayHost();
  if (!host) return;
  host.appendChild(createPingMarker(baseMapManager, state.map, position, by || ""));
}

// Click-to-ping — a transient broadcast to a campaign group's table (not
// Orrery's own map "Groups"). Requires an active campaign: the ping
// endpoint needs one, and it's what activates the live-stream subscription
// the echo rides on — so the toggle stays disabled without one.
function setupPingTool() {
  if (!elements.pingToggle || !mapContainer) {
    return;
  }
  let active = false;

  function updateToggleAvailability() {
    const hasGroup = Boolean(getActiveCampaignGroupId());
    elements.pingToggle.disabled = !hasGroup;
    // Tooltip must say why it's disabled. Set on the wrapping span, not the
    // button — a native `disabled` button doesn't reliably fire the
    // hover/focus events Bootstrap's tooltip listens for.
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

  // The header's campaign switcher fires this from any tool's page, so
  // switching campaigns takes effect immediately without a reload.
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
    // Render locally right away rather than relying solely on the live-
    // stream echo — too many links in that round-trip for feedback on your
    // own click to depend on. Every other viewer still gets it via the echo.
    renderIncomingPing({ position, by: dataManager.session?.user?.username || "You" });
    void dataManager.postMapPing({ groupId, position }).catch((error) => {
      status.show(error.message || "Unable to send ping.", { type: "error", timeout: 3000 });
    });
  });
}

// Keeps the Measure toggle's enabled state and tooltip in sync with
// state.map.measurement — called on map load/switch and whenever Scale
// per cell/Scale unit change, not just once at startup.
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
// between two points, converted through the grid's on-screen cell size and
// the map's configured scale/unit. A pure screen-pixel-delta measurement
// (clientX/clientY divided by getGridCellSize, which bakes in zoom) rather
// than converting through a layer's local coordinate space — a relative
// distance needs no absolute position, sidestepping the coordinate
// reconciliation snapMarkerPositionToGrid has to do.
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

  // Drawn in plain screen space, same as the distance math above — needs
  // no map-local coordinate conversion, it's already what's being measured.
  // Appended to <body> (position: fixed, tracks the viewport), not the map
  // overlay, since it's a screen-space UI affordance, not map content.
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

  // "Click off" any selected layer/group/view — matches how clicking empty
  // space deselects in most other editors. Excludes clicks on any control
  // or inside a .list-group-item row — otherwise an imprecise click near a
  // layer's badge/padding would deselect it, feeling like a misclick trap.
  const leftPane = document.querySelector('[data-pane-content="left"]');
  if (leftPane) {
    leftPane.addEventListener("click", (event) => {
      if (state.selection.kind === null) return;
      if (event.target.closest("button, input, select, textarea, a, .list-group-item")) return;
      setSelection(null);
    });
  }

  // Same "click off to deselect" convenience for the map canvas — every
  // interactive element already stops propagation on its own pointerdown,
  // so a click on empty map space reaches this listener untouched. A plain
  // "click" listener won't work here like it does for the left pane —
  // panning is a real pointerdown-drag-pointerup gesture, and browsers
  // still fire a native "click" at the end regardless of distance moved —
  // so this tracks movement itself and only deselects a genuine
  // no-movement click, same convention beginMarkerDrag/bindLayerDrag use.
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

  // Only commits the setting — does not re-mount the base map live (that
  // would jerk the camera mid-edit); takes effect next time this map loads.
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
      // default (1 / 0 / 0) — don't leave text the model never accepted.
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
      // A brand-new, never-edited map has nothing worth saving yet.
      markMapClean();
      watchCurrentMap(null);
      status.show("Started a new map.", { type: "info", timeout: 1500 });
    });
  }

  if (elements.duplicateMapButton) {
    elements.duplicateMapButton.addEventListener("click", () => {
      // Clones the current map (not a blank createMapModel()) — fresh id
      // so it saves as new, " Copy" suffix, left dirty until saved.
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

  // Same dirty check updateMapToolbarState uses for the Save button —
  // guards against navigating/closing away from unsaved edits.
  window.addEventListener("beforeunload", (event) => {
    if (!isMapDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // Delete/Backspace deletes whatever's selected (layer, group, view,
  // marker, path, shape) — delegates to deleteCurrentSelection(), which
  // acts on state.selection directly rather than finding-and-clicking a
  // `[data-action="delete-selected"]` DOM button (that approach depended on
  // the selection editor's Delete button having finished rendering — broke
  // for marker specifically, since renderMarkerElementSelectionEditor is async).
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditableTarget =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    if (event.key === "Escape") {
      // Escape always deselects, even from inside a field (blurring it
      // first) — same behavior as the left-pane click-off, from the keyboard.
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
      // Otherwise a blind full-body overwrite of state.map — but `views`
      // can be changed by tools other than this one (Combat Tracker's
      // toggleCombatantHiddenFromPlayers), while Orrery's own poll is
      // slower and skips updates entirely while anything's selected, so
      // state.map.views can easily be stale at the moment Save is clicked
      // (a GM un-hiding a marker from Combat Tracker, then saving in Orrery
      // moments later, would silently re-hide it). Only refetch-and-take-
      // the-server's-copy when this GM hasn't
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
        // Now a real record — currentUserHasFullMapAccess stops giving it
        // an unconditional pass and starts checking real ownership instead.
        mapExistsOnServer = true;
        // The in-memory map now matches what's persisted — reset the dirty
        // baseline before populateMapSelect re-evaluates Delete too.
        markMapClean();
        // A brand-new map now has a real backing record — start watching
        // it (idempotent for an already-loaded map, just restarts the poll).
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

  // Export's click handling is wired at construction (jsonDataPanel's
  // onExport) — no listener needed here. Import's button is wired the
  // same way, but the hidden file-picker input still needs building.
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
    // Funnels through the same snapshot path New/Load/Undo/Redo use, so
    // history/dirty-state/JSON-preview stay consistent — left dirty since
    // an imported file is unsaved until the user hits Save.
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

// Shared by the Map picker's change handler and the ?map=<id> deep link —
// the Dashboard's Map widget spotlights a map by posting this "map" kind,
// and this is where that link points, since a map has no print-card
// rendering of its own. shareToken is only ever set by the ?map=<id>&share=
// deep link (an anonymous share-link visitor has no session) and forwarded
// straight to dataManager.get, letting get_item's spotlight exception grant
// read access to exactly this map with no account.
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
    // preferLocal: false — a map is exactly the kind of record other tools
    // (Combat Tracker's write-through, the Dashboard's Map widget, a GM's
    // second Orrery tab) can change out from under this browser's local
    // mirror. A signed-in save also writes a "read-acceleration" local
    // copy, and a hard refresh clears the HTTP cache but never
    // localStorage — without this, a load would keep returning whatever
    // this browser last saved regardless of server changes since.
    const result = await dataManager.get("map", id, { shareToken, preferLocal: false });
    mapExistsOnServer = true;
    applyMapSnapshot(JSON.stringify(result?.payload || createMapModel()));
    // A map's id is filename/library_items metadata, never body content —
    // the loaded payload may not carry one, so state.map.id is re-stamped
    // from the known argument, not trusted from the body (watchCurrentMap
    // just below reads state.map.id immediately after this).
    state.map.id = id;
    if (elements.mapSelect) elements.mapSelect.value = id;
    // Just-loaded state matches the stored record — nothing to save until
    // an edit happens. NOT called from onUndo/onRedo: navigating undo
    // history can land on a state that legitimately differs from the last
    // save, and Save needs to reflect that.
    markMapClean();
    watchCurrentMap(state.map.id, shareToken);
  } catch (error) {
    status.show(`Unable to load map: ${error.message}`, { type: "error", timeout: 4000 });
  }
}

// A spotlighted map is just a link — clicking it lands here with
// ?map=<id>[&share=token] in the URL, loading it the same way the picker
// would. Runs after populateMapSelect so the id is already in mapCatalog.
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
    // Same "don't hijack an actual control" guard as the left-pane
    // click-off handler — this bar also holds zoom buttons, Measure/Draw/
    // Shape toggles, and the Shape Type <select>. Buttons tolerate the
    // preventDefault() below, but a native <select>'s dropdown-opening is
    // tied to that same default action — without this guard, every
    // pointerdown on Shape Type got preventDefault()'d before the browser
    // could show its options.
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

// Does NOT mount state.map's base map or call renderAll() here —
// state.map is still the harmless placeholder createMapModel() built at
// module load, and rendering it would paint a real default map behind the
// empty-state card below. The setup*Events calls just wire listeners onto
// static toolbar buttons that exist in the HTML regardless of state.map's
// content. applyMapSnapshot (New Map / picking a saved map / ?map= deep
// link) is what calls setBaseMap + renderAll for the first time.
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
// Hides everything just painted (the harmless never-saved default map)
// until the GM picks or creates one. loadMapFromUrlParam below, if there's
// a real ?map= to load, calls loadMapById -> applyMapSnapshot ->
// hideMapEmptyState() and reveals it immediately.
showMapEmptyState();
void populateMapSelect().then(() => loadMapFromUrlParam());
