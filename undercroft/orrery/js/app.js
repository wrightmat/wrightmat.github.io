import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { fetchKindEntriesWithIds, loadLibraryKinds } from "../../common/js/lib/content-fetch.js";
import { allowsDelete, refreshOwnershipCatalog, confirmDelete } from "../../common/js/lib/ownership.js";
import {
  createGroup,
  createGridCell,
  createLayer,
  createMapModel,
  createMarkerElement,
  createView,
  updateBaseMapType,
  updateMapTimestamp,
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
  computeVisibleLayerIds,
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
  getGridOffset as sharedGetGridOffset,
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
  onUndo: (entry) => {
    if (!entry) {
      return null;
    }
    applyMapSnapshot(entry.before);
    return { message: entry.label ? `Undid ${entry.label}` : "Undid last action" };
  },
  onRedo: (entry) => {
    if (!entry) {
      return null;
    }
    applyMapSnapshot(entry.after);
    return { message: entry.label ? `Redid ${entry.label}` : "Redid last action" };
  },
});

const auth = initAuthControls({ status });
const dataManager = auth.dataManager;

// Ownership metadata for saved Maps, used only for the Delete button's
// access gate (owner-or-admin, or a local/anonymous entry) — same
// rule and shape as Sanctum's settingCatalog/locationCatalog.
let mapCatalog = new Map();

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

const elements = {
  mapSelect: document.querySelector("[data-map-select]"),
  mapNameInput: document.querySelector("[data-map-name]"),
  newMapButton: document.querySelector('[data-action="new-map"]'),
  saveMapButton: document.querySelector('[data-action="save-layout"]'),
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
  baseMapToggle: document.querySelector("[data-base-map-toggle]"),
  baseMapPanel: document.querySelector("[data-base-map-panel]"),
  selectionToggle: document.querySelector("[data-selection-toggle]"),
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
  selectionType: document.querySelector("[data-selection-type]"),
  selectionDetails: document.querySelector("[data-selection-details]"),
  selectionEditor: document.querySelector("[data-selection-editor]"),
  zoomIn: document.querySelector("[data-zoom-in]"),
  zoomOut: document.querySelector("[data-zoom-out]"),
  zoomReset: document.querySelector("[data-zoom-reset]"),
  viewToggle: document.querySelector("[data-view-toggle]"),
  viewDetails: document.querySelector("[data-view-details]"),
  viewPanel: document.querySelector("[data-view-panel]"),
  viewHandle: document.querySelector("[data-view-handle]"),
  viewMode: document.querySelector("[data-view-mode]"),
  viewZoom: document.querySelector("[data-view-zoom]"),
  viewCenter: document.querySelector("[data-view-center]"),
  viewPan: document.querySelector("[data-view-pan]"),
  jsonPreview: document.querySelector("[data-json-preview]"),
  jsonSize: document.querySelector("[data-json-size]"),
};

const renderJsonPreview = createJsonPreviewRenderer({
  resolvePreviewElement: () => elements.jsonPreview,
  resolveBytesElement: () => elements.jsonSize,
  serialize: () => state.map,
});

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
    { key: "strokeColor", label: "Stroke color", type: "color" },
    { key: "fillColor", label: "Fill color", type: "color" },
    { key: "strokeWidth", label: "Stroke width", type: "number", min: 1, step: 1 },
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
    { key: "cellSize", label: "Cell size", type: "number", min: 5, step: 5 },
    { key: "lineColor", label: "Line color", type: "color" },
  ],
  raster: [
    { key: "src", label: "Image URL", type: "text" },
    { key: "width", label: "Width", type: "number", min: 50, step: 10 },
    { key: "height", label: "Height", type: "number", min: 50, step: 10 },
  ],
  marker: [
    { key: "icon", label: "Icon", type: "text" },
    { key: "size", label: "Size", type: "number", min: 2, step: 1 },
    { key: "color", label: "Color", type: "color" },
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

bindCollapsibleToggle(elements.baseMapToggle, elements.baseMapPanel, {
  collapsed: false,
  expandLabel: "Expand base map",
  collapseLabel: "Collapse base map",
});

const setSelectionCollapsed = bindCollapsibleToggle(elements.selectionToggle, elements.selectionPanel, {
  collapsed: true,
  expandLabel: "Expand selection",
  collapseLabel: "Collapse selection",
});

function normalizeTier(tier) {
  return typeof tier === "string" ? tier.trim().toLowerCase() : "";
}

function normalizeView(view, { layerIds = [], groupIds = [] } = {}) {
  const safeView = view && typeof view === "object" ? view : {};
  const name = typeof safeView.name === "string" && safeView.name.trim() ? safeView.name.trim() : "New View";
  const description = typeof safeView.description === "string" ? safeView.description.trim() : "";
  const tiers = Array.isArray(safeView.tiers)
    ? safeView.tiers.map(normalizeTier).filter((tier) => VIEW_TIER_VALUES.has(tier))
    : [];
  const normalizedLayerIds = Array.isArray(safeView.layerIds) ? safeView.layerIds.filter(Boolean) : null;
  const normalizedGroupIds = Array.isArray(safeView.groupIds) ? safeView.groupIds.filter(Boolean) : null;
  const nextLayerIds = normalizedLayerIds ?? layerIds.filter(Boolean);
  const nextGroupIds = normalizedGroupIds ?? groupIds.filter(Boolean);
  const settings = safeView.settings && typeof safeView.settings === "object" ? safeView.settings : {};
  return {
    ...safeView,
    name,
    description,
    tiers,
    layerIds: nextLayerIds,
    groupIds: nextGroupIds,
    settings,
  };
}

function applyMapSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  state.map = JSON.parse(snapshot);
  if (!state.map.views) {
    state.map.views = [];
  }
  state.map.views = state.map.views.map((view) =>
    normalizeView(view, {
      layerIds: state.map.layers?.map((layer) => layer.id) || [],
      groupIds: state.map.groups?.map((group) => group.id) || [],
    }),
  );
  state.selection = { kind: null, id: null, layerId: null, cells: [], anchor: null };
  baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
  if (elements.mapNameInput) {
    elements.mapNameInput.value = state.map.name || "";
  }
  renderAll();
  setSelectionCollapsed(true);
}

// Owner-or-admin, or a local/anonymous entry — same rule as Sanctum's
// settingAllowsDelete/locationAllowsDelete and Loom's systemAllowsDelete.
function mapAllowsDelete(id) {
  return allowsDelete(mapCatalog, id, { dataManager });
}

// Same shape/reasoning as Sanctum's refreshSettingCatalog: ownership
// metadata comes from a dedicated dataManager.list() call (not the full
// fetched body), and local-only entries are always deletable.
async function refreshMapCatalog(ids) {
  mapCatalog = await refreshOwnershipCatalog(dataManager, "map", ids);
}

// Tiered Views (state.map.views) only ever filter what a non-owner sees —
// the map's own owner/editor always gets full, unfiltered access (they're
// authoring it; Views are a presentation concern for viewers, same framing
// as readTier/writeTier elsewhere). mapAllowsDelete already captures exactly
// this "does the current user have full access to this map" check
// (owner/admin/local/edit-shared), so it doubles as the edit-access gate
// here too — this codebase already treats "edit" share permission as
// full-access, same as every other kind's Delete-button gating.
function currentUserHasFullMapAccess() {
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
// own doc comment for the "empty tiers = universal, empty Set = legitimate
// all-hidden result" contract this preserves unchanged.
function getVisibleLayerIds() {
  return computeVisibleLayerIds(state.map, getEffectiveViewerTier(), currentUserHasFullMapAccess());
}

// "Clean" baseline for the whole map (a JSON snapshot at last load/save) —
// Save only lights up once the live map actually differs from it, the same
// isDirty/markClean convention Loom/Sanctum already use for their own
// records (there just isn't a single "name" field to diff here, so this
// diffs the whole serialized map instead). Re-established by
// applyMapSnapshot — the one function New/Load/Undo/Redo all already funnel
// through — and again right after a successful save.
let mapCleanSnapshot = null;

function isMapDirty() {
  return mapCleanSnapshot !== JSON.stringify(state.map);
}

function markMapClean() {
  mapCleanSnapshot = JSON.stringify(state.map);
  updateMapToolbarState();
}

function updateMapToolbarState() {
  if (elements.deleteMapButton) {
    elements.deleteMapButton.disabled = !mapAllowsDelete(state.map.id);
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
async function populateMapSelect() {
  if (!elements.mapSelect || !dataManager) return;
  const previousId = state.map.id;
  let remoteEntries = [];
  try {
    remoteEntries = await fetchKindEntriesWithIds(dataManager, "map");
  } catch (error) {
    remoteEntries = [];
  }
  const remoteIds = new Set(remoteEntries.map((entry) => entry.id));
  const localEntries = dataManager.listLocalEntries("map").filter((entry) => !remoteIds.has(entry.id));
  const combined = [
    ...remoteEntries.map((entry) => ({ id: entry.id, name: entry.entity?.name || entry.id })),
    ...localEntries.map((entry) => ({ id: entry.id, name: entry.payload?.name || entry.id })),
  ];
  elements.mapSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "New / unsaved";
  elements.mapSelect.appendChild(blank);
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

function setSelection(kind, id = null, extra = {}) {
  state.selection = {
    kind,
    id,
    layerId: extra.layerId ?? null,
    cells: extra.cells ?? [],
    anchor: extra.anchor ?? (extra.cells?.[0]?.coord ?? null),
  };
  if (kind === "grid-cells" && state.selection.cells.length) {
    state.lastGridSelection = {
      layerId: state.selection.layerId,
      cells: state.selection.cells.map((cell) => ({ ...cell })),
    };
  }
  renderSelection();
  renderLayerOverlays();
  syncOverlayInteractivity();
  const shouldExpand =
    kind === "layer" || kind === "group" || kind === "grid-cells" || kind === "view" || kind === "marker-element";
  setSelectionCollapsed(!shouldExpand);
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

  const imageSettings = baseMap.settings.image;
  elements.imageSrc.value = imageSettings.src;
  elements.imageWidth.value = imageSettings.width;
  elements.imageHeight.value = imageSettings.height;

  const canvasSettings = baseMap.settings.canvas;
  elements.canvasBackground.value = canvasSettings.background;

  if (elements.tileProvider) {
    elements.tileProvider.value = baseMap.settings.tile.urlTemplate;
  }
  if (elements.tileQuickPick) {
    elements.tileQuickPick.value = "";
  }
}

function renderLayers() {
  elements.layerList.innerHTML = "";
  const visibleLayerIds = getVisibleLayerIds();
  state.map.layers.forEach((layer) => {
    if (visibleLayerIds && !visibleLayerIds.has(layer.id)) {
      return;
    }
    const item = document.createElement("div");
    item.className = "list-group-item d-flex justify-content-between align-items-center";

    const labelButton = document.createElement("button");
    labelButton.type = "button";
    labelButton.className = "btn btn-link p-0 text-decoration-none text-start flex-grow-1";
    labelButton.textContent = layer.name;
    labelButton.addEventListener("click", () => setSelection("layer", layer.id));

    const meta = document.createElement("div");
    meta.className = "d-flex align-items-center gap-2";

    const visibilityToggle = document.createElement("input");
    visibilityToggle.type = "checkbox";
    visibilityToggle.className = "form-check-input";
    visibilityToggle.checked = layer.visible;
    visibilityToggle.addEventListener("change", () => {
      recordHistory("layer visibility", () => {
        layer.visible = visibilityToggle.checked;
        updateMapTimestamp(state.map);
      });
      renderSelection();
      renderLayerOverlays();
      renderJson();
    });

    const typeBadge = document.createElement("span");
    typeBadge.className = "badge text-bg-secondary text-uppercase";
    typeBadge.textContent = layer.type;

    meta.appendChild(visibilityToggle);
    meta.appendChild(typeBadge);

    item.appendChild(labelButton);
    item.appendChild(meta);
    elements.layerList.appendChild(item);
  });
}

function renderGroups() {
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
    item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
    if (state.selection.kind === "group" && state.selection.id === group.id) {
      item.setAttribute("aria-current", "true");
    }
    item.textContent = group.name;
    const badge = document.createElement("span");
    badge.className = "badge text-bg-secondary";
    badge.textContent = `${group.elementIds.length} items`;
    item.appendChild(badge);
    item.addEventListener("click", () => setSelection("group", group.id));
    elements.groupList.appendChild(item);
  });
}

function renderViewsList() {
  if (!elements.viewList) {
    return;
  }
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
    item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
    if (isSelected) {
      item.classList.add("active");
    }
    item.textContent = view.name;
    const badge = document.createElement("span");
    badge.className = "badge text-bg-secondary";
    badge.textContent = "View";
    item.appendChild(badge);
    item.addEventListener("click", () => setSelection("view", view.id));
    elements.viewList.appendChild(item);
  });
}

function renderSelection() {
  const { selection, map } = state;
  if (elements.selectionClear) {
    elements.selectionClear.classList.toggle("d-none", selection.kind === null);
  }
  if (selection.kind === "layer") {
    const layer = map.layers.find((entry) => entry.id === selection.id);
    if (layer) {
      elements.selectionTitle.textContent = layer.name;
      elements.selectionType.textContent = layer.type;
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = `Visible: ${layer.visible ? "Yes" : "No"}`;
      }
      renderLayerSelectionEditor(layer);
      return;
    }
  }

  if (selection.kind === "group") {
    const group = map.groups.find((entry) => entry.id === selection.id);
    if (group) {
      elements.selectionTitle.textContent = group.name;
      elements.selectionType.textContent = "Group";
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
      elements.selectionType.textContent = "View";
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
      const label = cellCount === 1 ? "Grid Cell" : "Grid Cells";
      elements.selectionTitle.textContent = cellCount === 1 ? "Cell Selection" : "Cell Selection";
      elements.selectionType.textContent = label;
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
      elements.selectionType.textContent = "Marker";
      if (elements.selectionDetails) {
        elements.selectionDetails.textContent = markerElement.refKind
          ? `${layer.name} · references ${markerElement.refKind}/${markerElement.refId || "(none picked)"}`
          : `${layer.name} · no reference set`;
      }
      void renderMarkerElementSelectionEditor(layer, markerElement);
      return;
    }
  }

  elements.selectionTitle.textContent = "No selection";
  elements.selectionType.textContent = "None";
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = "Select a layer, group, view, grid cell, or marker to inspect it.";
  }
  clearSelectionEditor();
}

function clearSelectionEditor() {
  if (elements.selectionEditor) {
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
  const isInteractive = Boolean(layer && (layer.type === "grid" || layer.type === "marker"));
  overlay.classList.toggle("is-interactive", isInteractive);
  if (overlay.parentElement && overlay.parentElement.classList.contains("leaflet-pane")) {
    overlay.parentElement.style.pointerEvents = isInteractive ? "auto" : "none";
  }
}

// getGridLayoutScale/getGridOffset delegate to lib/map-viewer.js now (same
// coordinate math the shared createGridLayerElement uses internally) — kept
// here only because bindLayerDrag's whole-layer drag (Orrery-authoring-only)
// still needs them directly. getGridType/getGridCellKey/
// createGridCellSelectionEntry/findGridCellById/normalizeGroupMembers are
// imported straight from the shared module below (identical signatures, no
// wrapper needed) since findGridCell/ensureGridCell/buildGridRangeSelection/
// formatGridCellLabel/summarizeGridSelection and the group-editing UI still
// call them directly.
function getGridLayoutScale() {
  return sharedGetGridLayoutScale(baseMapManager, state.map);
}

function getGridOffset(layer) {
  return sharedGetGridOffset(baseMapManager, state.map, layer);
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
  state.selection = { kind: "marker-element", id: markerElement.id, layerId: layer.id, cells: [], anchor: null };
  renderSelection();
  setSelectionCollapsed(false);
  const container = dotEl.parentElement;
  if (container) {
    container
      .querySelectorAll(".orrery-layer-marker-overlay.is-selected")
      .forEach((node) => node.classList.remove("is-selected"));
  }
  dotEl.classList.add("is-selected");
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
    target.setPointerCapture(event.pointerId);
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
      if (state.map.baseMap.type !== "tile") {
        activeLayerDrag.target.style.transform = `translate(${layer.position.x}px, ${layer.position.y}px)`;
      }
    }
    if (activeLayerDrag.element?.classList.contains("orrery-layer-grid-overlay")) {
      const offset = getGridOffset(layer);
      activeLayerDrag.element.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
    } else {
      updateTileLayerElementPosition(layer, activeLayerDrag.element);
    }
  });

  const stopDrag = (event) => {
    if (!activeLayerDrag || activeLayerDrag.id !== layer.id) {
      return;
    }
    target.releasePointerCapture(event.pointerId);
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
function renderLayerOverlays() {
  const overlay = baseMapManager.getOverlayContainer();
  if (!overlay) {
    return;
  }
  syncOverlayInteractivity();
  const activeGroup =
    state.selection.kind === "group" ? state.map.groups.find((group) => group.id === state.selection.id) : null;
  renderMapLayers(overlay, baseMapManager, state.map, {
    viewerTier: getEffectiveViewerTier(),
    hasFullAccess: currentUserHasFullMapAccess(),
    selection: state.selection,
    activeGroup,
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
      const newElement = createMarkerElement({ position });
      recordHistory("place marker", () => {
        layer.elements = layer.elements || [];
        layer.elements.push(newElement);
        updateMapTimestamp(state.map);
      });
      setSelection("marker-element", newElement.id, { layerId: layer.id });
      renderJson();
    },
    onMarkerDragStart: (layer, markerElement, dotEl) => selectMarkerElementForDrag(layer, markerElement, dotEl),
    onMarkerDragEnd: (layer, markerElement, nextPosition) => {
      const before = JSON.stringify(state.map);
      markerElement.position = nextPosition;
      updateMapTimestamp(state.map);
      const after = JSON.stringify(state.map);
      if (before !== after) {
        undoStack.push({ label: "move marker", before, after });
      }
      // Deferred until drag-end, same as bindLayerDrag's whole-layer drag: a
      // full renderLayerOverlays() mid-drag would replace dotEl in the DOM
      // out from under the pointer capture driving the gesture.
      renderLayerOverlays();
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
  });
}

function createSelectionSectionTitle(text) {
  const title = document.createElement("div");
  title.className = "text-uppercase fs-6 fw-semibold text-body-secondary";
  title.textContent = text;
  return title;
}

function createFieldWrapper(labelText, input) {
  const wrapper = document.createElement("label");
  wrapper.className = "d-flex flex-column gap-1 small";
  const label = document.createElement("span");
  label.className = "text-body-secondary";
  label.textContent = labelText;
  wrapper.appendChild(label);
  wrapper.appendChild(input);
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
  container.innerHTML = "";

  container.appendChild(createSelectionSectionTitle("Layer Properties"));

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "form-control form-control-sm";
  nameInput.value = layer.name;
  nameInput.addEventListener("change", () => {
    const value = nameInput.value.trim();
    if (!value) {
      nameInput.value = layer.name;
      return;
    }
    applyLayerChange("layer name", () => {
      layer.name = value;
    });
  });
  container.appendChild(createFieldWrapper("Name", nameInput));

  const positionGrid = document.createElement("div");
  positionGrid.className = "d-grid gap-2";
  positionGrid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";

  const positionX = document.createElement("input");
  positionX.type = "number";
  positionX.className = "form-control form-control-sm";
  positionX.value = layer.position?.x ?? 0;
  positionX.addEventListener("change", () => {
    const value = Number(positionX.value);
    if (!Number.isFinite(value)) {
      return;
    }
    applyLayerChange("layer position x", () => {
      layer.position = { ...(layer.position || { x: 0, y: 0 }), x: value };
    });
  });

  const positionY = document.createElement("input");
  positionY.type = "number";
  positionY.className = "form-control form-control-sm";
  positionY.value = layer.position?.y ?? 0;
  positionY.addEventListener("change", () => {
    const value = Number(positionY.value);
    if (!Number.isFinite(value)) {
      return;
    }
    applyLayerChange("layer position y", () => {
      layer.position = { ...(layer.position || { x: 0, y: 0 }), y: value };
    });
  });

  positionGrid.appendChild(createFieldWrapper("Position X", positionX));
  positionGrid.appendChild(createFieldWrapper("Position Y", positionY));
  container.appendChild(positionGrid);

  const visibilityWrapper = document.createElement("div");
  visibilityWrapper.className = "form-check";
  const visibilityInput = document.createElement("input");
  visibilityInput.className = "form-check-input";
  visibilityInput.type = "checkbox";
  visibilityInput.id = `layer-visible-${layer.id}`;
  visibilityInput.checked = layer.visible;
  visibilityInput.addEventListener("change", () => {
    applyLayerChange("layer visibility", () => {
      layer.visible = visibilityInput.checked;
    });
  });
  const visibilityLabel = document.createElement("label");
  visibilityLabel.className = "form-check-label small";
  visibilityLabel.setAttribute("for", visibilityInput.id);
  visibilityLabel.textContent = "Visible";
  visibilityWrapper.appendChild(visibilityInput);
  visibilityWrapper.appendChild(visibilityLabel);
  container.appendChild(visibilityWrapper);

  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.className = "form-range";
  opacityInput.min = "0";
  opacityInput.max = "1";
  opacityInput.step = "0.05";
  opacityInput.value = layer.opacity;
  opacityInput.addEventListener("change", () => {
    const value = Number(opacityInput.value);
    if (!Number.isFinite(value)) {
      return;
    }
    applyLayerChange("layer opacity", () => {
      layer.opacity = value;
    });
  });
  container.appendChild(createFieldWrapper("Opacity", opacityInput));

  const settingsSchema = LAYER_SETTINGS_SCHEMA[layer.type] || [];
  if (settingsSchema.length) {
    settingsSchema.forEach((field) => {
      const input = document.createElement(field.type === "select" ? "select" : "input");
      if (field.type !== "select") {
        input.type = field.type;
      }
      input.className = field.type === "select" ? "form-select form-select-sm" : "form-control form-control-sm";
      if (field.type === "range") {
        input.className = "form-range";
      }
      if (field.min !== undefined) {
        input.min = String(field.min);
      }
      if (field.max !== undefined) {
        input.max = String(field.max);
      }
      if (field.step !== undefined) {
        input.step = String(field.step);
      }
      if (field.type === "select") {
        (field.options || []).forEach((option) => {
          const optionElement = document.createElement("option");
          optionElement.value = option.value;
          optionElement.textContent = option.label;
          input.appendChild(optionElement);
        });
      }
      const currentValue = layer.settings?.[field.key];
      if (currentValue !== undefined) {
        input.value = String(currentValue);
      }
      input.addEventListener("change", () => {
        let nextValue = input.value;
        if (field.type === "number" || field.type === "range") {
          const numeric = Number(nextValue);
          if (!Number.isFinite(numeric)) {
            return;
          }
          nextValue = numeric;
        }
        applyLayerSettingsChange(`layer ${field.key}`, () => {
          layer.settings = layer.settings || {};
          layer.settings[field.key] = nextValue;
        });
        if (
          field.key === "gridType" &&
          state.selection.kind === "grid-cells" &&
          state.selection.layerId === layer.id
        ) {
          setSelection("layer", layer.id);
        }
      });
      container.appendChild(createFieldWrapper(field.label, input));
    });
  }

  container.appendChild(createSelectionSectionTitle("Custom Properties"));
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
  pasteButton.disabled = !state.propertyClipboard;
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

  container.appendChild(actionRow);
  container.appendChild(propertiesWrapper);
  refreshTooltips();

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-danger btn-sm mt-3";
  deleteButton.textContent = "Delete layer";
  deleteButton.addEventListener("click", () => {
    const index = state.map.layers.findIndex((entry) => entry.id === layer.id);
    if (index === -1) {
      return;
    }
    recordHistory("delete layer", () => {
      state.map.layers.splice(index, 1);
      updateMapTimestamp(state.map);
    });
    setSelection(null);
    renderLayers();
    renderLayerOverlays();
    renderJson();
  });
  container.appendChild(deleteButton);
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

// The live, extensible kind registry (undercroft/common/data/kind/*.json) —
// fetched once and cached, same reasoning as content-fetch.js's own
// characterMappingPromise cache: it doesn't change mid-session, and every
// marker selection would otherwise re-fetch it.
let libraryKindsPromise = null;
function getLibraryKinds() {
  if (!libraryKindsPromise) {
    libraryKindsPromise = loadLibraryKinds();
  }
  return libraryKindsPromise;
}

// A marker element optionally references a real Library entity of any kind
// — the {refKind, refId, label} shape the architecture plan settled on so
// Orrery maps can point at Sanctum Locations, Forge/Crucible NPCs and
// Monsters, Vault Effects, etc. without either tool needing to know about
// the other. Mirrors Sanctum's Assets/Needs "kind + entity" picker.
async function renderMarkerElementSelectionEditor(layer, markerElement) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  container.innerHTML = "";
  container.appendChild(createSelectionSectionTitle("Marker Properties"));

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
  }

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "form-control form-control-sm";
  labelInput.value = markerElement.label || "";
  labelInput.placeholder = "Label";
  labelInput.addEventListener("change", () => {
    const value = labelInput.value.trim();
    applyMarkerElementChange("marker label", () => {
      markerElement.label = value;
    });
  });
  container.appendChild(createFieldWrapper("Label", labelInput));

  const kindSelect = document.createElement("select");
  kindSelect.className = "form-select form-select-sm";
  const noReferenceOption = document.createElement("option");
  noReferenceOption.value = "";
  noReferenceOption.textContent = "No reference";
  kindSelect.appendChild(noReferenceOption);
  container.appendChild(createFieldWrapper("References", kindSelect));

  const entitySelect = document.createElement("select");
  entitySelect.className = "form-select form-select-sm";
  entitySelect.disabled = true;
  container.appendChild(createFieldWrapper("Entity", entitySelect));

  const previewBox = document.createElement("div");
  previewBox.className = "small text-body-secondary border rounded p-2";
  previewBox.textContent = "No entity selected.";
  container.appendChild(previewBox);

  async function refreshPreview() {
    if (!markerElement.refKind || !markerElement.refId || !dataManager) {
      previewBox.textContent = "No entity selected.";
      return;
    }
    try {
      const result = await dataManager.get(markerElement.refKind, markerElement.refId);
      const name = result?.payload?.name || markerElement.refId;
      const description = result?.payload?.description || "";
      previewBox.textContent = description ? `${name} — ${description}` : name;
    } catch (error) {
      previewBox.textContent = "Unable to load entity.";
    }
  }

  async function populateEntitySelect(kind, selectedId) {
    entitySelect.innerHTML = "";
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
    entries
      .slice()
      .sort((a, b) => (a.entity?.name || a.id).localeCompare(b.entity?.name || b.id))
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.entity?.name || entry.id;
        entitySelect.appendChild(option);
      });
    if (selectedId && entries.some((entry) => entry.id === selectedId)) {
      entitySelect.value = selectedId;
    }
  }

  const kinds = await getLibraryKinds();
  kinds.forEach((kind) => {
    const option = document.createElement("option");
    option.value = kind.id;
    option.textContent = kind.label || kind.id;
    kindSelect.appendChild(option);
  });
  kindSelect.value = markerElement.refKind || "";
  await populateEntitySelect(markerElement.refKind, markerElement.refId);
  await refreshPreview();

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
    });
  });

  entitySelect.addEventListener("change", () => {
    const refId = entitySelect.value;
    const option = entitySelect.selectedOptions[0];
    applyMarkerElementChange("marker reference entity", () => {
      markerElement.refId = refId;
      if (!markerElement.label && option && option.value) {
        markerElement.label = option.textContent;
      }
    });
  });

  const positionGrid = document.createElement("div");
  positionGrid.className = "d-grid gap-2";
  positionGrid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";

  const positionX = document.createElement("input");
  positionX.type = "number";
  positionX.className = "form-control form-control-sm";
  positionX.value = markerElement.position?.x ?? 0;
  positionX.addEventListener("change", () => {
    const value = Number(positionX.value);
    if (!Number.isFinite(value)) {
      return;
    }
    applyMarkerElementChange("marker position x", () => {
      markerElement.position = { ...(markerElement.position || { x: 0, y: 0 }), x: value };
    });
  });

  const positionY = document.createElement("input");
  positionY.type = "number";
  positionY.className = "form-control form-control-sm";
  positionY.value = markerElement.position?.y ?? 0;
  positionY.addEventListener("change", () => {
    const value = Number(positionY.value);
    if (!Number.isFinite(value)) {
      return;
    }
    applyMarkerElementChange("marker position y", () => {
      markerElement.position = { ...(markerElement.position || { x: 0, y: 0 }), y: value };
    });
  });

  positionGrid.appendChild(createFieldWrapper("Position X", positionX));
  positionGrid.appendChild(createFieldWrapper("Position Y", positionY));
  container.appendChild(positionGrid);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-outline-danger btn-sm";
  deleteButton.textContent = "Delete Marker";
  deleteButton.addEventListener("click", () => {
    recordHistory("delete marker", () => {
      layer.elements = (layer.elements || []).filter((entry) => entry.id !== markerElement.id);
      updateMapTimestamp(state.map);
    });
    setSelection("layer", layer.id);
  });
  container.appendChild(deleteButton);
}

function renderGridCellSelectionEditor(layer, selectedCells) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
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

  container.appendChild(createSelectionSectionTitle("Custom Properties"));

  if (selectedCells.length > 1) {
    const notice = document.createElement("div");
    notice.className = "d-flex align-items-center gap-2";
    const noticeLabel = document.createElement("span");
    noticeLabel.className = "small text-body-secondary";
    noticeLabel.textContent = "Editing properties applies to all selected cells.";
    notice.appendChild(noticeLabel);
    const help = document.createElement("span");
    help.className = "align-middle";
    help.dataset.helpTopic = "orrery.bulkEdit";
    help.dataset.helpInsert = "replace";
    notice.appendChild(help);
    container.appendChild(notice);
    initHelpSystem({ root: notice });
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
  copyButton.disabled = !primaryCoord;
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
  pasteButton.disabled = !state.propertyClipboard;
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
  container.appendChild(actionRow);
  refreshTooltips();

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

  container.appendChild(propertiesWrapper);
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
  container.innerHTML = "";

  container.appendChild(createSelectionSectionTitle("Group Properties"));

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "form-control form-control-sm";
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
  container.appendChild(createFieldWrapper("Name", nameInput));

  container.appendChild(createSelectionSectionTitle("Custom Properties"));
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
  pasteButton.disabled = !state.propertyClipboard;
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
  container.appendChild(actionRow);
  container.appendChild(propertiesWrapper);
  refreshTooltips();

  const membersHeader = document.createElement("div");
  membersHeader.className = "d-flex align-items-center justify-content-between gap-2";
  const membersTitle = createSelectionSectionTitle("Members");
  const membersHelp = document.createElement("span");
  membersHelp.className = "align-middle";
  membersHelp.dataset.helpTopic = "orrery.gridSelection";
  membersHelp.dataset.helpInsert = "replace";
  membersHeader.appendChild(membersTitle);
  membersHeader.appendChild(membersHelp);
  container.appendChild(membersHeader);
  initHelpSystem({ root: membersHeader });

  const memberActions = document.createElement("div");
  memberActions.className = "d-flex flex-column gap-2";
  const lastSelection = state.lastGridSelection;
  const selectionLayer = lastSelection?.layerId
    ? state.map.layers.find((layer) => layer.id === lastSelection.layerId)
    : null;
  const summary = document.createElement("div");
  summary.className = "small text-body-secondary";
  if (lastSelection?.cells?.length && selectionLayer) {
    summary.textContent = `Last selection: ${selectionLayer.name} • ${lastSelection.cells.length} cells`;
  } else {
    summary.textContent = "Select grid cells on the map, then click Add selected cells.";
  }
  const addMembersButton = document.createElement("button");
  addMembersButton.type = "button";
  addMembersButton.className = "btn btn-outline-primary btn-sm align-self-start";
  addMembersButton.textContent = `Add selected cells${lastSelection?.cells?.length ? ` (${lastSelection.cells.length})` : ""}`;
  addMembersButton.disabled = !(lastSelection?.cells?.length && selectionLayer);
  addMembersButton.addEventListener("click", () => {
    if (!lastSelection?.cells?.length || !selectionLayer) {
      return;
    }
    applyGroupChange("add group members", () => {
      const nextMembers = new Map(
        normalizeGroupMembers(group).map((member) => [getGroupMemberKey(member), member]),
      );
      lastSelection.cells.forEach((cell) => {
        const resolved = findGridCell(selectionLayer, cell.coord) || ensureGridCell(selectionLayer, cell.coord);
        const member = { layerId: selectionLayer.id, elementId: resolved.id, kind: "grid-cell" };
        nextMembers.set(getGroupMemberKey(member), member);
      });
      group.elementIds = Array.from(nextMembers.values());
    });
  });
  memberActions.appendChild(summary);
  memberActions.appendChild(addMembersButton);
  container.appendChild(memberActions);
  const memberList = document.createElement("div");
  memberList.className = "d-flex flex-column gap-2";
  const members = normalizeGroupMembers(group);

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

  if (members.length) {
    const removeAllButton = document.createElement("button");
    removeAllButton.type = "button";
    removeAllButton.className = "btn btn-outline-danger btn-sm align-self-start";
    removeAllButton.textContent = "Remove all members";
    removeAllButton.addEventListener("click", () => {
      applyGroupChange("clear group members", () => {
        group.elementIds = [];
      });
    });
    memberList.appendChild(removeAllButton);
  }

  container.appendChild(memberList);
  refreshTooltips();

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-danger btn-sm mt-3";
  deleteButton.textContent = "Delete group";
  deleteButton.addEventListener("click", () => {
    const index = state.map.groups.findIndex((entry) => entry.id === group.id);
    if (index === -1) {
      return;
    }
    recordHistory("delete group", () => {
      state.map.groups.splice(index, 1);
      updateMapTimestamp(state.map);
    });
    setSelection(null);
    renderGroups();
    renderLayerOverlays();
    renderJson();
  });
  container.appendChild(deleteButton);
}

function renderViewSelectionEditor(view) {
  if (!elements.selectionEditor) {
    return;
  }
  const container = elements.selectionEditor;
  container.innerHTML = "";

  container.appendChild(createSelectionSectionTitle("View Details"));

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "form-control form-control-sm";
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
  container.appendChild(createFieldWrapper("Name", nameInput));

  const descriptionInput = document.createElement("textarea");
  descriptionInput.className = "form-control form-control-sm";
  descriptionInput.rows = 3;
  descriptionInput.value = view.description || "";
  descriptionInput.placeholder = "Describe what this view shows or hides.";
  descriptionInput.addEventListener("change", () => {
    applyViewChange("view description", () => {
      view.description = descriptionInput.value.trim();
    });
  });
  container.appendChild(createFieldWrapper("Description", descriptionInput));

  container.appendChild(createSelectionSectionTitle("Visible Layers"));
  const layerVisibility = document.createElement("div");
  layerVisibility.className = "d-flex flex-column gap-2";
  if (!state.map.layers.length) {
    const empty = document.createElement("div");
    empty.className = "small text-body-secondary";
    empty.textContent = "No layers yet.";
    layerVisibility.appendChild(empty);
  } else {
    const selectedLayers = new Set(view.layerIds || []);
    state.map.layers.forEach((layer) => {
      const wrapper = document.createElement("div");
      wrapper.className = "form-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input";
      checkbox.id = `view-${view.id}-layer-${layer.id}`;
      checkbox.checked = selectedLayers.has(layer.id);
      const label = document.createElement("label");
      label.className = "form-check-label small";
      label.setAttribute("for", checkbox.id);
      label.textContent = layer.name;
      checkbox.addEventListener("change", () => {
        applyViewChange("view layer visibility", () => {
          const next = new Set(view.layerIds || []);
          if (checkbox.checked) {
            next.add(layer.id);
          } else {
            next.delete(layer.id);
          }
          view.layerIds = Array.from(next);
        });
      });
      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      layerVisibility.appendChild(wrapper);
    });
  }
  container.appendChild(layerVisibility);

  container.appendChild(createSelectionSectionTitle("Visible Groups"));
  const groupVisibility = document.createElement("div");
  groupVisibility.className = "d-flex flex-column gap-2";
  if (!state.map.groups.length) {
    const empty = document.createElement("div");
    empty.className = "small text-body-secondary";
    empty.textContent = "No groups yet.";
    groupVisibility.appendChild(empty);
  } else {
    const selectedGroups = new Set(view.groupIds || []);
    state.map.groups.forEach((group) => {
      const wrapper = document.createElement("div");
      wrapper.className = "form-check";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input";
      checkbox.id = `view-${view.id}-group-${group.id}`;
      checkbox.checked = selectedGroups.has(group.id);
      const label = document.createElement("label");
      label.className = "form-check-label small";
      label.setAttribute("for", checkbox.id);
      label.textContent = group.name;
      checkbox.addEventListener("change", () => {
        applyViewChange("view group visibility", () => {
          const next = new Set(view.groupIds || []);
          if (checkbox.checked) {
            next.add(group.id);
          } else {
            next.delete(group.id);
          }
          view.groupIds = Array.from(next);
        });
      });
      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      groupVisibility.appendChild(wrapper);
    });
  }
  container.appendChild(groupVisibility);

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

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-danger btn-sm mt-3";
  deleteButton.textContent = "Delete view";
  deleteButton.addEventListener("click", () => {
    const index = state.map.views.findIndex((entry) => entry.id === view.id);
    if (index === -1) {
      return;
    }
    recordHistory("delete view", () => {
      state.map.views.splice(index, 1);
      updateMapTimestamp(state.map);
    });
    setSelection(null);
    renderViewsList();
    renderJson();
  });
  container.appendChild(deleteButton);
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
      const value = Number(element.value);
      if (!Number.isFinite(value) || value <= 0) {
        return;
      }
      recordHistory(`image ${key}`, () => {
        state.map.baseMap.settings.image[key] = value;
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

  if (elements.newMapButton) {
    elements.newMapButton.addEventListener("click", () => {
      applyMapSnapshot(JSON.stringify(createMapModel()));
      if (elements.mapSelect) elements.mapSelect.value = "";
      // A brand-new, never-edited map has nothing worth saving yet — same
      // "clean until you actually change something" convention Sanctum's
      // New Setting/Location already follows.
      markMapClean();
      status.show("Started a new map.", { type: "info", timeout: 1500 });
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

  if (elements.saveMapButton) {
    elements.saveMapButton.addEventListener("click", async () => {
      if (!dataManager) return;
      const name = elements.mapNameInput?.value.trim() || state.map.name || "New Orrery Map";
      state.map.name = name;
      updateMapTimestamp(state.map);
      try {
        await dataManager.save("map", state.map.id, state.map);
        status.show(`Saved "${name}".`, { type: "success", timeout: 2000 });
        // The in-memory map now exactly matches what's persisted — reset the
        // dirty baseline before populateMapSelect's own updateMapToolbarState
        // call (via refreshMapCatalog) re-evaluates Delete too.
        markMapClean();
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
        await populateMapSelect();
      } catch (error) {
        status.show(`Unable to delete map: ${error.message}`, { type: "error", timeout: 4000 });
      }
    });
  }

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
  if (!id) {
    applyMapSnapshot(JSON.stringify(createMapModel()));
    markMapClean();
    return;
  }
  if (!dataManager) return;
  try {
    const result = await dataManager.get("map", id, { shareToken });
    applyMapSnapshot(JSON.stringify(result?.payload || createMapModel()));
    if (elements.mapSelect) elements.mapSelect.value = id;
    // Just-loaded state matches the stored record exactly — nothing to save
    // until an edit actually happens. NOT called from onUndo/onRedo (which
    // also route through applyMapSnapshot): navigating undo history can land
    // on a state that still legitimately differs from the last save, and
    // Save needs to reflect that.
    markMapClean();
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

baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
if (elements.mapNameInput) {
  elements.mapNameInput.value = state.map.name || "";
}
setupBaseMapEvents();
setupLayerEvents();
setupGroupEvents();
setupViewsListEvents();
setupViewEvents();
setupActionEvents();
setupMapEvents();
setupViewPanelToggle();
setupViewPanelDrag();
renderAll();
refreshTooltips();
initHelpSystem({ root: document });
// The freshly created, never-edited map at page load has nothing to save
// yet — without this, mapCleanSnapshot starts null and Save would show
// enabled from the very first render.
markMapClean();
void populateMapSelect().then(() => loadMapFromUrlParam());
