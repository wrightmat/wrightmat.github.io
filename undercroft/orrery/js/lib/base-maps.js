import { PanZoomController } from "./pan-zoom.js";

function clearContainer(container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

class TileBaseMap {
  constructor({ container, settings, view, onViewChange } = {}) {
    this.container = container;
    this.settings = settings;
    this.onViewChange = onViewChange;
    this.view = view;
    this.map = null;
    this.overlayHost = null;
  }

  mount() {
    clearContainer(this.container);
    const leaflet = window.L;
    if (!leaflet) {
      const fallback = document.createElement("div");
      fallback.className = "d-flex flex-column align-items-center justify-content-center h-100 text-body-secondary";
      fallback.innerHTML = "<p class=\"mb-1\">Leaflet failed to load.</p><p class=\"small\">Tile maps require the Leaflet CDN.</p>";
      this.container.appendChild(fallback);
      return;
    }

    this.map = leaflet.map(this.container, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
    });
    leaflet
      .tileLayer(this.settings.urlTemplate, {
        maxZoom: this.settings.maxZoom,
        minZoom: this.settings.minZoom,
        attribution: this.settings.attribution,
      })
      .addTo(this.map);

    this.setView(this.view);

    const overlayPane = this.map.getPanes()?.overlayPane;
    if (overlayPane) {
      overlayPane.style.zIndex = "650";
      overlayPane.style.pointerEvents = "none";
      const domUtil = leaflet?.DomUtil;
      if (domUtil) {
        this.overlayHost = domUtil.create(
          "div",
          "leaflet-layer leaflet-zoom-animated orrery-layer-overlay-host",
          overlayPane
        );
      } else {
        this.overlayHost = document.createElement("div");
        this.overlayHost.className = "leaflet-layer leaflet-zoom-animated orrery-layer-overlay-host";
        overlayPane.appendChild(this.overlayHost);
      }
      this.overlayHost.style.width = "100%";
      this.overlayHost.style.height = "100%";
    }

    this.map.on("moveend", () => this.emitChange());
    this.map.on("zoomend", () => this.emitChange());
  }

  emitChange() {
    if (!this.map || !this.onViewChange) {
      return;
    }
    const center = this.map.getCenter();
    this.onViewChange({
      mode: "geo",
      zoom: this.map.getZoom(),
      center: { lat: center.lat, lng: center.lng },
      pan: { x: 0, y: 0 },
    });
  }

  setView(view) {
    if (!this.map || !view) {
      return;
    }
    this.map.setView([view.center.lat, view.center.lng], view.zoom, { animate: false });
  }

  zoomBy(delta) {
    if (!this.map || !Number.isFinite(delta)) {
      return;
    }
    this.map.setZoom(this.map.getZoom() + delta);
  }

  reset(view) {
    this.setView(view);
  }

  getView() {
    if (!this.map) {
      return this.view;
    }
    const center = this.map.getCenter();
    return {
      mode: "geo",
      zoom: this.map.getZoom(),
      center: { lat: center.lat, lng: center.lng },
      pan: { x: 0, y: 0 },
    };
  }

  getOverlayHost() {
    return this.overlayHost;
  }

  setInteractionEnabled(enabled) {
    if (!this.map?.dragging) {
      return;
    }
    if (enabled) {
      this.map.dragging.enable();
    } else {
      this.map.dragging.disable();
    }
  }

  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
    if (this.overlayHost) {
      this.overlayHost.remove();
      this.overlayHost = null;
    }
    clearContainer(this.container);
  }
}

class ImageBaseMap {
  constructor({ container, settings, view, onViewChange } = {}) {
    this.container = container;
    this.settings = settings;
    this.view = view;
    this.onViewChange = onViewChange;
    this.stage = null;
    this.content = null;
    this.panZoom = null;
    this.overlayHost = null;
  }

  mount() {
    clearContainer(this.container);
    this.stage = document.createElement("div");
    this.stage.className = "orrery-map-stage";
    this.content = document.createElement("div");
    this.content.className = "orrery-map-content";

    const image = document.createElement("img");
    image.className = "orrery-map-image";
    image.alt = "Base map";
    image.src = this.settings.src;
    image.width = this.settings.width;
    image.height = this.settings.height;
    image.draggable = false;
    image.addEventListener("dragstart", (event) => event.preventDefault());

    this.content.appendChild(image);
    this.overlayHost = document.createElement("div");
    this.overlayHost.className = "orrery-layer-overlay-host";
    this.content.appendChild(this.overlayHost);
    this.stage.appendChild(this.content);
    this.container.appendChild(this.stage);

    this.panZoom = new PanZoomController({
      container: this.stage,
      content: this.content,
      view: this.view,
      onChange: (view) => this.emitChange(view),
    });
  }

  emitChange(view) {
    if (!this.onViewChange) {
      return;
    }
    this.onViewChange({
      mode: "cartesian",
      zoom: view.zoom,
      center: { lat: 0, lng: 0 },
      pan: view.pan,
    });
  }

  updateSettings(settings) {
    if (!this.content || !settings) {
      return;
    }
    const image = this.content.querySelector("img");
    if (image) {
      image.src = settings.src;
      image.width = settings.width;
      image.height = settings.height;
    }
  }

  setView(view) {
    this.panZoom?.setView(view);
  }

  zoomBy(delta) {
    this.panZoom?.zoomBy(delta);
  }

  reset(view) {
    this.panZoom?.reset(view);
  }

  getView() {
    const view = this.panZoom?.getView() || this.view;
    return {
      mode: "cartesian",
      zoom: view.zoom ?? 1,
      center: { lat: 0, lng: 0 },
      pan: view.pan ?? { x: 0, y: 0 },
    };
  }

  getOverlayHost() {
    return this.overlayHost;
  }

  setInteractionEnabled(enabled) {
    this.panZoom?.setEnabled?.(enabled);
  }

  destroy() {
    this.panZoom?.destroy();
    this.panZoom = null;
    if (this.overlayHost) {
      this.overlayHost.remove();
      this.overlayHost = null;
    }
    clearContainer(this.container);
  }
}

class CanvasBaseMap {
  constructor({ container, settings, view, onViewChange } = {}) {
    this.container = container;
    this.settings = settings;
    this.view = view;
    this.onViewChange = onViewChange;
    this.stage = null;
    this.content = null;
    this.panZoom = null;
    this.overlayHost = null;
  }

  mount() {
    clearContainer(this.container);
    this.stage = document.createElement("div");
    this.stage.className = "orrery-map-stage";
    this.content = document.createElement("div");
    this.content.className = "orrery-map-content";

    const surface = document.createElement("div");
    surface.className = "orrery-canvas-surface";
    surface.style.width = `${this.settings.width}px`;
    surface.style.height = `${this.settings.height}px`;
    surface.style.backgroundColor = this.settings.background;

    this.content.appendChild(surface);
    this.overlayHost = document.createElement("div");
    this.overlayHost.className = "orrery-layer-overlay-host";
    this.content.appendChild(this.overlayHost);
    this.stage.appendChild(this.content);
    this.container.appendChild(this.stage);

    this.panZoom = new PanZoomController({
      container: this.stage,
      content: this.content,
      view: this.view,
      onChange: (view) => this.emitChange(view),
    });
  }

  emitChange(view) {
    if (!this.onViewChange) {
      return;
    }
    this.onViewChange({
      mode: "cartesian",
      zoom: view.zoom,
      center: { lat: 0, lng: 0 },
      pan: view.pan,
    });
  }

  updateSettings(settings) {
    if (!this.content || !settings) {
      return;
    }
    const surface = this.content.querySelector(".orrery-canvas-surface");
    if (!surface) {
      return;
    }
    surface.style.width = `${settings.width}px`;
    surface.style.height = `${settings.height}px`;
    surface.style.backgroundColor = settings.background;
  }

  setView(view) {
    this.panZoom?.setView(view);
  }

  zoomBy(delta) {
    this.panZoom?.zoomBy(delta);
  }

  reset(view) {
    this.panZoom?.reset(view);
  }

  getView() {
    const view = this.panZoom?.getView() || this.view;
    return {
      mode: "cartesian",
      zoom: view.zoom ?? 1,
      center: { lat: 0, lng: 0 },
      pan: view.pan ?? { x: 0, y: 0 },
    };
  }

  getOverlayHost() {
    return this.overlayHost;
  }

  setInteractionEnabled(enabled) {
    this.panZoom?.setEnabled?.(enabled);
  }

  destroy() {
    this.panZoom?.destroy();
    this.panZoom = null;
    if (this.overlayHost) {
      this.overlayHost.remove();
      this.overlayHost = null;
    }
    clearContainer(this.container);
  }
}

export class BaseMapManager {
  constructor({ container, onViewChange } = {}) {
    if (!container) {
      throw new Error("BaseMapManager requires a container element");
    }
    this.container = container;
    this.onViewChange = onViewChange;
    this.current = null;
    this.defaultView = null;
  }

  setBaseMap({ type, settings }, view) {
    this.current?.destroy();
    this.defaultView = view;
    if (type === "tile") {
      this.current = new TileBaseMap({
        container: this.container,
        settings: settings.tile,
        view,
        onViewChange: this.onViewChange,
      });
    } else if (type === "image") {
      this.current = new ImageBaseMap({
        container: this.container,
        settings: settings.image,
        view,
        onViewChange: this.onViewChange,
      });
    } else {
      this.current = new CanvasBaseMap({
        container: this.container,
        settings: settings.canvas,
        view,
        onViewChange: this.onViewChange,
      });
    }
    this.current.mount();
  }

  updateSettings(settings) {
    this.current?.updateSettings?.(settings);
  }

  zoomBy(delta) {
    this.current?.zoomBy(delta);
  }

  reset() {
    if (this.defaultView) {
      this.current?.reset(this.defaultView);
    }
  }

  getView() {
    return this.current?.getView();
  }

  getOverlayContainer() {
    return this.current?.getOverlayHost?.() || null;
  }

  setInteractionEnabled(enabled) {
    this.current?.setInteractionEnabled?.(enabled);
  }
}
