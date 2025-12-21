import { initAppShell } from "../../common/js/lib/app-shell.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import {
  createGroup,
  createLayer,
  createMapModel,
  updateBaseMapType,
  updateMapTimestamp,
} from "./lib/map-model.js";
import { BaseMapManager } from "./lib/base-maps.js";

const state = {
  map: createMapModel(),
  selection: { kind: "baseMap", id: null },
};

const { status } = initAppShell({
  namespace: "orrery",
  storagePrefix: "undercroft.orrery.undo",
});

const mapContainer = document.querySelector("#orrery-map");
const baseMapManager = new BaseMapManager({
  container: mapContainer,
  onViewChange: (view) => {
    state.map.view = { ...state.map.view, ...view };
    updateMapTimestamp(state.map);
    renderView();
    renderJson();
  },
});

const elements = {
  baseMapRadios: Array.from(document.querySelectorAll("[data-base-map-option]")),
  baseMapSettings: Array.from(document.querySelectorAll("[data-base-map-settings]")),
  imageSrc: document.querySelector("[data-base-map-image-src]"),
  imageWidth: document.querySelector("[data-base-map-image-width]"),
  imageHeight: document.querySelector("[data-base-map-image-height]"),
  canvasBackground: document.querySelector("[data-base-map-canvas-background]"),
  canvasGrid: document.querySelector("[data-base-map-canvas-grid]"),
  canvasGridSize: document.querySelector("[data-base-map-canvas-grid-size]"),
  layerTypeSelect: document.querySelector("[data-layer-type-select]"),
  layerAdd: document.querySelector("[data-layer-add]"),
  layerList: document.querySelector("[data-layer-list]"),
  groupAdd: document.querySelector("[data-group-add]"),
  groupList: document.querySelector("[data-group-list]"),
  selectionTitle: document.querySelector("[data-selection-title]"),
  selectionType: document.querySelector("[data-selection-type]"),
  selectionDetails: document.querySelector("[data-selection-details]"),
  zoomIn: document.querySelector("[data-zoom-in]"),
  zoomOut: document.querySelector("[data-zoom-out]"),
  zoomReset: document.querySelector("[data-zoom-reset]"),
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

function setSelection(kind, id = null) {
  state.selection = { kind, id };
  renderSelection();
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
  elements.canvasGrid.checked = canvasSettings.grid.enabled;
  elements.canvasGridSize.value = canvasSettings.grid.size;
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
      layer.visible = visibilityToggle.checked;
      updateMapTimestamp(state.map);
      renderSelection();
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
    empty.className = "text-body-secondary small";
    empty.textContent = "No groups yet. Create a region to collect elements.";
    elements.groupList.appendChild(empty);
    return;
  }
  state.map.groups.forEach((group) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
    item.textContent = group.name;
    const badge = document.createElement("span");
    badge.className = "badge text-bg-secondary";
    badge.textContent = `${group.elementIds.length} items`;
    item.appendChild(badge);
    item.addEventListener("click", () => setSelection("group", group.id));
    elements.groupList.appendChild(item);
  });
}

function renderSelection() {
  const { selection, map } = state;
  if (selection.kind === "layer") {
    const layer = map.layers.find((entry) => entry.id === selection.id);
    if (layer) {
      elements.selectionTitle.textContent = layer.name;
      elements.selectionType.textContent = layer.type;
      elements.selectionDetails.textContent = `Visible: ${layer.visible ? "Yes" : "No"} · Opacity: ${layer.opacity} · Elements: ${layer.elements.length}`;
      return;
    }
  }

  if (selection.kind === "group") {
    const group = map.groups.find((entry) => entry.id === selection.id);
    if (group) {
      elements.selectionTitle.textContent = group.name;
      elements.selectionType.textContent = "Group";
      elements.selectionDetails.textContent = `Members: ${group.elementIds.length}`;
      return;
    }
  }

  elements.selectionTitle.textContent = "Base Map";
  elements.selectionType.textContent = "Base";
  elements.selectionDetails.textContent = `Type: ${map.baseMap.type}`;
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
  renderSelection();
  renderView();
  renderJson();
}

function setupBaseMapEvents() {
  elements.baseMapRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      updateBaseMapType(state.map, radio.value);
      baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
      setSelection("baseMap");
      renderAll();
      status.show(`Switched to ${radio.value} base map`, { type: "info", timeout: 1500 });
    });
  });

  elements.imageSrc.addEventListener("change", () => {
    state.map.baseMap.settings.image.src = elements.imageSrc.value.trim();
    updateMapTimestamp(state.map);
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
      state.map.baseMap.settings.image[key] = value;
      updateMapTimestamp(state.map);
      if (state.map.baseMap.type === "image") {
        baseMapManager.updateSettings(state.map.baseMap.settings.image);
      }
      renderJson();
    });
  };

  updateImageDimension("width", elements.imageWidth);
  updateImageDimension("height", elements.imageHeight);

  elements.canvasBackground.addEventListener("change", () => {
    state.map.baseMap.settings.canvas.background = elements.canvasBackground.value;
    updateMapTimestamp(state.map);
    if (state.map.baseMap.type === "canvas") {
      baseMapManager.updateSettings(state.map.baseMap.settings.canvas);
    }
    renderJson();
  });

  elements.canvasGrid.addEventListener("change", () => {
    state.map.baseMap.settings.canvas.grid.enabled = elements.canvasGrid.checked;
    updateMapTimestamp(state.map);
    if (state.map.baseMap.type === "canvas") {
      baseMapManager.updateSettings(state.map.baseMap.settings.canvas);
    }
    renderJson();
  });

  elements.canvasGridSize.addEventListener("change", () => {
    const value = Number(elements.canvasGridSize.value);
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    state.map.baseMap.settings.canvas.grid.size = value;
    updateMapTimestamp(state.map);
    if (state.map.baseMap.type === "canvas") {
      baseMapManager.updateSettings(state.map.baseMap.settings.canvas);
    }
    renderJson();
  });
}

function setupLayerEvents() {
  elements.layerAdd.addEventListener("click", () => {
    const type = elements.layerTypeSelect.value;
    const layer = createLayer({ type });
    state.map.layers.push(layer);
    updateMapTimestamp(state.map);
    renderLayers();
    renderJson();
    setSelection("layer", layer.id);
    status.show("Layer added", { type: "success", timeout: 1200 });
  });
}

function setupGroupEvents() {
  elements.groupAdd.addEventListener("click", () => {
    const group = createGroup({
      name: `Group ${state.map.groups.length + 1}`,
    });
    state.map.groups.push(group);
    updateMapTimestamp(state.map);
    renderGroups();
    renderJson();
    setSelection("group", group.id);
    status.show("Group created", { type: "success", timeout: 1200 });
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

baseMapManager.setBaseMap(state.map.baseMap, state.map.view);
setupBaseMapEvents();
setupLayerEvents();
setupGroupEvents();
setupViewEvents();
renderAll();
