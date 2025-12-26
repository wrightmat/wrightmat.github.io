import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
import {
  createGroup,
  createGridCell,
  createLayer,
  createMapModel,
  createView,
  updateBaseMapType,
  updateMapTimestamp,
} from "./lib/map-model.js";
import { BaseMapManager } from "./lib/base-maps.js";

const state = {
  map: createMapModel(),
  selection: {
    kind: null,
    id: null,
    layerId: null,
    cells: [],
    anchor: null,
  },
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

initAuthControls({ status });

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

const renderJson = createJsonPreviewRenderer({
  resolvePreviewElement: () => elements.jsonPreview,
  resolveBytesElement: () => elements.jsonSize,
  serialize: () => state.map,
});

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

function bindPropertyRowTabOrder(keyInput, valueInput) {
  if (!keyInput || !valueInput) {
    return;
  }
  keyInput.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    valueInput.focus();
  });
  valueInput.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !event.shiftKey) {
      return;
    }
    event.preventDefault();
    keyInput.focus();
  });
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
  renderAll();
  setSelectionCollapsed(true);
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
  renderSelection();
  renderLayerOverlays();
  syncOverlayInteractivity();
  const shouldExpand = kind === "layer" || kind === "group" || kind === "grid-cells" || kind === "view";
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
  state.map.layers.forEach((layer) => {
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
    const isSelected = state.selection.kind === "group" && state.selection.id === group.id;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
    if (isSelected) {
      item.classList.add("active");
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

  elements.selectionTitle.textContent = "No selection";
  elements.selectionType.textContent = "None";
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = "Select a layer, group, view, or grid cell to inspect it.";
  }
  clearSelectionEditor();
}

function clearSelectionEditor() {
  if (elements.selectionEditor) {
    elements.selectionEditor.innerHTML = "";
    const placeholder = document.createElement("p");
    placeholder.className = "text-body-secondary small mb-0";
    placeholder.textContent = "Select a layer, view, group, or grid cell to edit its properties.";
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
      : state.selection.kind === "grid-cells"
        ? state.selection.layerId
        : null;
  const layer = selectedLayerId ? state.map.layers.find((entry) => entry.id === selectedLayerId) : null;
  const isInteractive = Boolean(layer && layer.type === "grid");
  overlay.classList.toggle("is-interactive", isInteractive);
  if (overlay.parentElement && overlay.parentElement.classList.contains("leaflet-pane")) {
    overlay.parentElement.style.pointerEvents = isInteractive ? "auto" : "none";
  }
}

function getBaseZoom() {
  return baseMapManager.getDefaultView?.()?.zoom ?? 1;
}

function getGridZoomScale() {
  const baseZoom = getBaseZoom();
  const viewZoom = Number.isFinite(state.map.view?.zoom) ? state.map.view.zoom : baseZoom;
  if (state.map.baseMap.type === "tile") {
    return Math.pow(2, viewZoom - baseZoom);
  }
  return baseZoom ? viewZoom / baseZoom : 1;
}

function getGridLayoutScale() {
  return state.map.baseMap.type === "tile" ? getGridZoomScale() * 0.1 : 1;
}

function getGridHitTestScale() {
  return state.map.baseMap.type === "tile" ? 1 : getGridZoomScale();
}

function getGridOffset(layer) {
  const offsetScale = getGridLayoutScale();
  return {
    x: (layer.position?.x || 0) * offsetScale,
    y: (layer.position?.y || 0) * offsetScale,
  };
}

function getGridCellSize(layer) {
  const baseSize = layer.settings?.cellSize || 50;
  return baseSize * getGridLayoutScale();
}

function getGridType(layer) {
  return layer.settings?.gridType || "square";
}

function getGridCellKey(layer, coord) {
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    return `hex:${coord.q},${coord.r}`;
  }
  return `square:${coord.col},${coord.row}`;
}

function createGridCellSelectionEntry(layer, coord) {
  return {
    key: getGridCellKey(layer, coord),
    coord,
  };
}

function normalizeGroupMembers(group) {
  return (group.elementIds || []).map((entry) => {
    if (typeof entry === "string") {
      return { elementId: entry };
    }
    return entry || {};
  });
}

function getGroupMemberKey(member) {
  return `${member.layerId || "unknown"}:${member.elementId || "unknown"}`;
}

function findGridCellById(layer, elementId) {
  return layer.elements?.find((element) => element.kind === "cell" && element.id === elementId) || null;
}

function getGroupCellsForLayer(group, layer) {
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

function getHexMetrics(cellSize) {
  const size = cellSize / 2;
  const height = Math.sqrt(3) * size;
  return {
    size,
    height,
    width: cellSize,
    offsetX: size,
    offsetY: height / 2,
  };
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

function getGridCoordFromPoint(layer, point) {
  const hitScale = getGridHitTestScale();
  const scaledPoint = hitScale ? { x: point.x / hitScale, y: point.y / hitScale } : point;
  const cellSize = getGridCellSize(layer);
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

function getGridCellPixelRect(layer, coord) {
  const cellSize = getGridCellSize(layer);
  const gridType = getGridType(layer);
  if (gridType === "hex") {
    const { size, height, width, offsetX, offsetY } = getHexMetrics(cellSize);
    const centerX = size * 1.5 * coord.q + offsetX;
    const centerY = size * Math.sqrt(3) * (coord.r + coord.q / 2) + offsetY;
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
  }
  return {
    x: coord.col * cellSize,
    y: coord.row * cellSize,
    width: cellSize,
    height: cellSize,
  };
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
  return {
    image: `url("data:image/svg+xml,${encoded}")`,
    width: tileWidth,
    height: tileHeight,
  };
}

function createGridLayerElement(layer, selectionState) {
  const grid = document.createElement("div");
  grid.className = "orrery-layer-grid-overlay";
  if (selectionState?.isInteractive) {
    grid.classList.add("is-interactive");
    grid.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      baseMapManager.setInteractionEnabled(false);
      const rect = grid.getBoundingClientRect();
      const offset = getGridOffset(layer);
      const point = {
        x: event.clientX - rect.left - offset.x,
        y: event.clientY - rect.top - offset.y,
      };
      const coord = getGridCoordFromPoint(layer, point);
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
    });
    grid.addEventListener("pointerup", () => {
      baseMapManager.setInteractionEnabled(true);
    });
    grid.addEventListener("pointercancel", () => {
      baseMapManager.setInteractionEnabled(true);
    });
  }
  const gridScale = 3;
  grid.style.width = `${gridScale * 100}%`;
  grid.style.height = `${gridScale * 100}%`;
  grid.style.left = `-${((gridScale - 1) / 2) * 100}%`;
  grid.style.top = `-${((gridScale - 1) / 2) * 100}%`;
  grid.style.right = "auto";
  grid.style.bottom = "auto";
  const size = getGridCellSize(layer);
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
  const offset = getGridOffset(layer);
  grid.style.backgroundPosition = `${offset.x}px ${offset.y}px`;
  if (selectionState?.groupCells?.length) {
    grid.appendChild(createGridSelectionOverlay(layer, selectionState.groupCells, { variant: "group" }));
  }
  if (selectionState?.selectedCells?.length) {
    grid.appendChild(createGridSelectionOverlay(layer, selectionState.selectedCells));
  }
  return grid;
}

function getLayerPositionScale() {
  return 1;
}

function getLayerSizeScale() {
  return 1;
}

function getLayerRenderPosition(layer, scale) {
  return {
    x: (layer.position?.x || 0) * scale,
    y: (layer.position?.y || 0) * scale,
  };
}

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

function createRasterLayerElement(layer, renderState = {}) {
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

function createGridSelectionOverlay(layer, selectedCells, options = {}) {
  const overlay = document.createElement("div");
  overlay.className = "orrery-layer-grid-selection";
  const variant = options.variant || "selection";
  const gridType = getGridType(layer);
  const offset = getGridOffset(layer);
  selectedCells.forEach((cell) => {
    const rect = getGridCellPixelRect(layer, cell.coord);
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

function createMarkerLayerElement(layer, renderState = {}) {
  const marker = document.createElement("div");
  marker.className = "orrery-layer-marker-overlay";
  const scale = renderState.sizeScale ?? 1;
  const size = (layer.settings?.size || 24) * scale;
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.style.backgroundColor = layer.settings?.color || "#0ea5e9";
  if (renderState.position) {
    marker.style.left = `${renderState.position.x}px`;
    marker.style.top = `${renderState.position.y}px`;
  }
  return marker;
}

function createVectorLayerElement(layer, renderState = {}) {
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

function createLayerWrapper(layer, isSelected) {
  const wrapper = document.createElement("div");
  wrapper.className = "orrery-layer-item";
  if (isSelected) {
    wrapper.classList.add("is-selected");
  }
  const offsetX = layer.position?.x || 0;
  const offsetY = layer.position?.y || 0;
  if (state.map.baseMap.type !== "tile") {
    wrapper.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }
  wrapper.dataset.layerId = layer.id;
  return wrapper;
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

function renderLayerOverlays() {
  const overlay = baseMapManager.getOverlayContainer();
  if (!overlay) {
    return;
  }
  syncOverlayInteractivity();
  overlay.innerHTML = "";
  const activeGroup =
    state.selection.kind === "group" ? state.map.groups.find((group) => group.id === state.selection.id) : null;
  state.map.layers.forEach((layer) => {
    if (!layer.visible) {
      return;
    }
    const isLayerSelected = state.selection.kind === "layer" && state.selection.id === layer.id;
    const isGridCellsSelected = state.selection.kind === "grid-cells" && state.selection.layerId === layer.id;
    const isSelected = isLayerSelected || isGridCellsSelected;
    const groupCells = activeGroup ? getGroupCellsForLayer(activeGroup, layer) : [];
    const wrapper = createLayerWrapper(layer, isSelected);
    let element = null;
    const layerPositionScale = getLayerPositionScale();
    const layerSizeScale = getLayerSizeScale();
    const layerPosition = getLayerRenderPosition(layer, layerPositionScale);
    const renderState =
      state.map.baseMap.type === "tile"
        ? { position: layerPosition, sizeScale: layerSizeScale }
        : {};
    if (layer.type === "grid") {
      element = createGridLayerElement(layer, {
        isInteractive: isSelected,
        selectedCells: isGridCellsSelected ? state.selection.cells : [],
        groupCells,
      });
    } else if (layer.type === "raster") {
      element = createRasterLayerElement(layer, renderState);
    } else if (layer.type === "marker") {
      element = createMarkerLayerElement(layer, renderState);
    } else {
      element = createVectorLayerElement(layer, renderState);
    }
    if (element) {
      element.style.opacity = String(layer.opacity ?? 1);
      wrapper.appendChild(element);
      if (isLayerSelected && layer.visible) {
        const handle = document.createElement("div");
        handle.className = "orrery-layer-handle";
        wrapper.appendChild(handle);
        wrapper.classList.add("is-draggable");
        bindLayerDrag(handle, layer, element);
      }
      overlay.appendChild(wrapper);
    }
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
    propertiesWrapper.appendChild(createLayerPropertyRow(layer, "", ""));
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
  bindPropertyRowTabOrder(keyInput, valueInput);

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
      applyLayerSettingsChange("layer property", () => {
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
  bindPropertyRowTabOrder(keyInput, valueInput);

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
    applyToSelection((cell) => {
      cell.properties = cell.properties || {};
      if (currentKey && currentKey !== nextKey) {
        delete cell.properties[currentKey];
      }
      if (nextKey) {
        cell.properties[nextKey] = nextValue;
      }
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
    const notice = document.createElement("p");
    notice.className = "small text-body-secondary";
    notice.textContent = "Editing properties applies to all selected cells.";
    container.appendChild(notice);
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
    propertiesWrapper.appendChild(createGridCellPropertyRow(layer, selectionCoords, "", ""));
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
      applyGroupChange("group property", () => {
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
    propertiesWrapper.appendChild(createGroupPropertyRow(group, "", ""));
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

  container.appendChild(createSelectionSectionTitle("Members"));
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
setupBaseMapEvents();
setupLayerEvents();
setupGroupEvents();
setupViewsListEvents();
setupViewEvents();
setupActionEvents();
setupViewPanelToggle();
setupViewPanelDrag();
renderAll();
refreshTooltips();
