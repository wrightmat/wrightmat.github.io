import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { refreshTooltips } from "../../common/js/lib/tooltips.js";
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
  selection: { kind: null, id: null },
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
    renderJson();
  },
});

const elements = {
  mapMain: document.querySelector("[data-map-main]"),
  baseMapRadios: Array.from(document.querySelectorAll("[data-base-map-option]")),
  baseMapSettings: Array.from(document.querySelectorAll("[data-base-map-settings]")),
  tileProvider: document.querySelector("#base-map-tile-provider"),
  imageSrc: document.querySelector("[data-base-map-image-src]"),
  imageWidth: document.querySelector("[data-base-map-image-width]"),
  imageHeight: document.querySelector("[data-base-map-image-height]"),
  canvasBackground: document.querySelector("[data-base-map-canvas-background]"),
  baseMapToggle: document.querySelector("[data-base-map-toggle]"),
  baseMapPanel: document.querySelector("[data-base-map-panel]"),
  selectionToggle: document.querySelector("[data-selection-toggle]"),
  selectionPanel: document.querySelector("[data-selection-panel]"),
  undoButton: document.querySelector('[data-action="undo-layout"]'),
  redoButton: document.querySelector('[data-action="redo-layout"]'),
  layerButtons: Array.from(document.querySelectorAll("[data-add-layer]")),
  groupAdd: document.querySelector("[data-add-group]"),
  layerList: document.querySelector("[data-layer-list]"),
  groupList: document.querySelector("[data-group-list]"),
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
    { key: "lineOpacity", label: "Line opacity", type: "range", min: 0, max: 1, step: 0.05 },
  ],
  raster: [
    { key: "src", label: "Image URL", type: "text" },
    { key: "width", label: "Width", type: "number", min: 50, step: 10 },
    { key: "height", label: "Height", type: "number", min: 50, step: 10 },
  ],
  marker: [
    { key: "icon", label: "Icon", type: "text" },
    { key: "size", label: "Size", type: "number", min: 8, step: 1 },
    { key: "color", label: "Color", type: "color" },
  ],
};

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

function applyMapSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  state.map = JSON.parse(snapshot);
  state.selection = { kind: null, id: null };
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

function setSelection(kind, id = null) {
  state.selection = { kind, id };
  renderSelection();
  renderLayerOverlays();
  const shouldExpand = kind === "layer" || kind === "group";
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

  elements.selectionTitle.textContent = "No selection";
  elements.selectionType.textContent = "None";
  if (elements.selectionDetails) {
    elements.selectionDetails.textContent = "Select a layer or group to inspect it.";
  }
  clearSelectionEditor();
}

function clearSelectionEditor() {
  if (elements.selectionEditor) {
    elements.selectionEditor.innerHTML = "";
    const placeholder = document.createElement("p");
    placeholder.className = "text-body-secondary small mb-0";
    placeholder.textContent = "Select a layer to edit its properties.";
    elements.selectionEditor.appendChild(placeholder);
  }
}

function toRgba(color, opacity) {
  if (typeof color !== "string" || color.trim() === "") {
    return `rgba(15, 23, 42, ${opacity})`;
  }
  const trimmed = color.trim();
  if (trimmed.startsWith("rgba") || trimmed.startsWith("rgb")) {
    return trimmed;
  }
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const normalized = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    if (normalized.length === 6) {
      const r = parseInt(normalized.slice(0, 2), 16);
      const g = parseInt(normalized.slice(2, 4), 16);
      const b = parseInt(normalized.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
  }
  return trimmed;
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

function createGridLayerElement(layer) {
  const grid = document.createElement("div");
  grid.className = "orrery-layer-grid-overlay";
  const gridScale = 3;
  grid.style.width = `${gridScale * 100}%`;
  grid.style.height = `${gridScale * 100}%`;
  grid.style.left = `-${((gridScale - 1) / 2) * 100}%`;
  grid.style.top = `-${((gridScale - 1) / 2) * 100}%`;
  grid.style.right = "auto";
  grid.style.bottom = "auto";
  const size = layer.settings?.cellSize || 50;
  const gridType = layer.settings?.gridType || "square";
  const lineOpacity = layer.settings?.lineOpacity ?? 0.25;
  const lineColor = toRgba(layer.settings?.lineColor || "#0f172a", lineOpacity);
  if (gridType === "hex") {
    const hexBackground = buildHexGridBackground(size, lineColor);
    grid.style.backgroundImage = hexBackground.image;
    grid.style.backgroundSize = `${hexBackground.width}px ${hexBackground.height}px`;
  } else {
    grid.style.backgroundImage = `linear-gradient(${lineColor} 1px, transparent 1px), linear-gradient(90deg, ${lineColor} 1px, transparent 1px)`;
    grid.style.backgroundSize = `${size}px ${size}px`;
  }
  const offsetX = layer.position?.x || 0;
  const offsetY = layer.position?.y || 0;
  grid.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
  return grid;
}

function createRasterLayerElement(layer) {
  const wrapper = document.createElement("div");
  wrapper.className = "orrery-layer-raster-overlay";
  const src = layer.settings?.src || "";
  const image = document.createElement("img");
  image.src = src || "data/sample-map.svg";
  image.alt = layer.name;
  if (layer.settings?.width) {
    image.width = layer.settings.width;
  }
  if (layer.settings?.height) {
    image.height = layer.settings.height;
  }
  wrapper.appendChild(image);
  return wrapper;
}

function createMarkerLayerElement(layer) {
  const marker = document.createElement("div");
  marker.className = "orrery-layer-marker-overlay";
  const size = layer.settings?.size || 24;
  marker.style.width = `${size}px`;
  marker.style.height = `${size}px`;
  marker.style.backgroundColor = layer.settings?.color || "#0ea5e9";
  return marker;
}

function createVectorLayerElement(layer) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
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
  wrapper.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
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
    layer.position = {
      x: activeLayerDrag.originX + deltaX,
      y: activeLayerDrag.originY + deltaY,
    };
    if (activeLayerDrag.target) {
      activeLayerDrag.target.style.transform = `translate(${layer.position.x}px, ${layer.position.y}px)`;
    }
    if (activeLayerDrag.element?.classList.contains("orrery-layer-grid-overlay")) {
      activeLayerDrag.element.style.backgroundPosition = `${layer.position.x}px ${layer.position.y}px`;
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
  overlay.innerHTML = "";
  state.map.layers.forEach((layer) => {
    if (!layer.visible) {
      return;
    }
    const isSelected = state.selection.kind === "layer" && state.selection.id === layer.id;
    const wrapper = createLayerWrapper(layer, isSelected);
    let element = null;
    if (layer.type === "grid") {
      element = createGridLayerElement(layer);
    } else if (layer.type === "raster") {
      element = createRasterLayerElement(layer);
    } else if (layer.type === "marker") {
      element = createMarkerLayerElement(layer);
    } else {
      element = createVectorLayerElement(layer);
    }
    if (element) {
      element.style.opacity = String(layer.opacity ?? 1);
      wrapper.appendChild(element);
      if (isSelected && layer.visible) {
        wrapper.classList.add("is-draggable");
        bindLayerDrag(wrapper, layer, element);
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
    container.appendChild(createSelectionSectionTitle("Layer Settings"));
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
      propertiesWrapper.appendChild(createPropertyRow(layer, key, value));
    });
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-outline-secondary btn-sm";
  addButton.textContent = "Add property";
  addButton.addEventListener("click", () => {
    const emptyState = propertiesWrapper.querySelector(".text-body-secondary");
    if (emptyState) {
      emptyState.remove();
    }
    propertiesWrapper.appendChild(createPropertyRow(layer, "", ""));
  });

  container.appendChild(propertiesWrapper);
  container.appendChild(addButton);

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

function createPropertyRow(layer, key, value) {
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
  removeButton.className = "btn btn-outline-danger btn-sm";
  removeButton.textContent = "Remove";

  let currentKey = key;

  const updateProperty = () => {
    const nextKey = keyInput.value.trim();
    const nextValue = valueInput.value.trim();
    applyLayerSettingsChange("layer property", () => {
      layer.properties = layer.properties || {};
      if (currentKey && currentKey !== nextKey) {
        delete layer.properties[currentKey];
      }
      if (nextKey) {
        layer.properties[nextKey] = nextValue;
        currentKey = nextKey;
      }
    });
  };

  keyInput.addEventListener("change", updateProperty);
  valueInput.addEventListener("change", updateProperty);
  removeButton.addEventListener("click", () => {
    applyLayerSettingsChange("remove layer property", () => {
      if (currentKey && layer.properties) {
        delete layer.properties[currentKey];
      }
    });
    renderSelection();
  });

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(removeButton);
  return row;
}

function renderGroupSelectionEditor() {
  clearSelectionEditor();
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
  renderLayerOverlays();
  renderView();
  renderJson();
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
setupViewEvents();
setupActionEvents();
setupViewPanelToggle();
setupViewPanelDrag();
renderAll();
refreshTooltips();
