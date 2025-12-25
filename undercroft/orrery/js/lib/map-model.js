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
      };
    case "raster":
      return {
        src: "",
        width: 800,
        height: 600,
      };
    case "marker":
      return {
        icon: "pin",
        size: 24,
        color: "#0ea5e9",
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
    image: {
      src: "data/sample-map.svg",
      width: 1200,
      height: 800,
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

export function createGroup({ name } = {}) {
  return {
    id: randomId(),
    name: name || "New Group",
    elementIds: [],
    properties: {},
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
    layers: [createLayer({ type: "grid", name: "Primary Grid Layer" })],
    groups: [],
    properties: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
