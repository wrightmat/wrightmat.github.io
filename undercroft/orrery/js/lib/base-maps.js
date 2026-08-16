import { PanZoomController } from "../../../common/js/lib/pan-zoom.js";

function clearContainer(container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

// Image base map Width/Height (and, via map-viewer.js's own
// createRasterLayerElement, a Raster LAYER's Width/Height too — same three
// forms apply to both) — matching Workbench's own free-text Image
// component width/height field convention (see workbench-template-view.js's
// own "100% or 320px" placeholder) as closely as this map's own coordinate
// system allows: empty/null means "native size" (no width/height attribute
// forced at all, so the browser just uses the loaded image's own intrinsic
// pixel dimensions — setting ONLY one axis this way lets the browser
// auto-preserve aspect ratio for the other), a plain number is a literal
// pixel override (the old behavior, just no longer defaulted), and a "NN%"
// string scales the image's own NATIVE size by that percentage. Not a CSS
// percentage (which would resolve against .orrery-map-content's own width
// — but that div has none of its own, it shrink-wraps to fit the BASE
// MAP's image, an unresolvable circular dependency for that one case) —
// computed here in JS against naturalWidth/naturalHeight instead, once
// actually known, so it's a stable, deterministic pixel size independent
// of viewport/container size (for the base map specifically, the whole
// grid/marker/path/shape coordinate space is its rendered box — see
// ImageBaseMap.mount()'s own comment — so an unstable size there would
// silently reflow every already-placed thing on top of it; a Raster
// layer's own size has no such coordinate-space stake, but the same "no
// bad forced default, native unless overridden" reasoning still applies).
export function resolveImageDimension(rawValue, naturalSize) {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }
  if (typeof rawValue === "string" && rawValue.trim().endsWith("%")) {
    const pct = parseFloat(rawValue);
    if (!Number.isFinite(pct) || !naturalSize) {
      return null;
    }
    return Math.round(naturalSize * (pct / 100));
  }
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function applyImageDimensions(image, settings) {
  function apply() {
    const width = resolveImageDimension(settings?.width, image.naturalWidth);
    const height = resolveImageDimension(settings?.height, image.naturalHeight);
    if (width) {
      image.width = width;
    } else {
      image.removeAttribute("width");
    }
    if (height) {
      image.height = height;
    } else {
      image.removeAttribute("height");
    }
  }
  // A percentage needs the image's own natural size, which isn't known
  // until it's actually loaded — `complete` is already true for a
  // browser-cached image (no further "load" event coming), so apply
  // immediately in that case rather than waiting on an event that already
  // fired.
  if (image.complete && image.naturalWidth) {
    apply();
  } else {
    image.addEventListener("load", apply, { once: true });
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
    this.overlaySizer = null;
    this.overlayResizeHandler = null;
    this.tileLayer = null;
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
    // Registered BEFORE setView below (not after, where this used to sit) —
    // confirmed as the actual cause of "grid cells are offset right after
    // the map loads, but self-corrects the moment I zoom": setView's own
    // initial 'moveend'/'zoomend' (settling on the map's real starting
    // center/zoom — possibly snapped to zoomSnap's 0.25 grid, or clamped by
    // setMinZoom/setMaxZoom below, either of which can differ from the
    // raw Initial Zoom value requested) fired and was gone before a
    // listener registered afterward could ever catch it, leaving
    // state.map.view.zoom stuck at the UNSNAPPED/UNCLAMPED requested value
    // — mismatched against Leaflet's own real, live zoom that
    // markerPositionToLocalPixel's latLngToLayerPoint always uses, which is
    // what every grid-cell/marker/shape position on screen is actually
    // measured against. The very next real zoom interaction fires
    // 'zoomend' again — this time WITH a listener attached — which is why
    // it "fixes itself" after that.
    this.map.on("moveend", () => this.emitChange());
    this.map.on("zoomend", () => this.emitChange());
    this.tileLayer = leaflet
      .tileLayer(this.settings.urlTemplate, {
        maxZoom: this.settings.maxZoom,
        minZoom: this.settings.minZoom,
        attribution: this.settings.attribution,
      })
      .addTo(this.map);
    if (Number.isFinite(this.settings.minZoom)) {
      this.map.setMinZoom(this.settings.minZoom);
    }
    if (Number.isFinite(this.settings.maxZoom)) {
      this.map.setMaxZoom(this.settings.maxZoom);
    }

    this.setView(this.view);
    // Explicit, synchronous sync — not relying on the 'moveend'/'zoomend'
    // listeners above alone. Confirmed as the actual REMAINING cause of
    // "grid cells still offset until I zoom OR pan": moving the listener
    // registration earlier (so it's attached before setView) wasn't
    // sufficient on its own — Leaflet's FIRST-EVER setView on a map that's
    // never had a view before doesn't reliably fire 'moveend'/'zoomend' the
    // same way a later, real pan/zoom does (both of which DO reach the
    // listeners above, which is why either one "fixes" it). This call
    // forces state.map.view to match Leaflet's real settled center/zoom
    // (post zoomSnap/minZoom/maxZoom) immediately, synchronously, before
    // mount() returns — so the very first renderLayerOverlays() call
    // (applyMapSnapshot's own renderAll(), right after setBaseMap returns)
    // already has the correct value instead of the raw, potentially
    // snapped/clamped-away Initial Zoom that was only ever a request, not
    // a guarantee.
    this.emitChange();

    const overlayPane = this.map.getPane("overlayPane");
    if (overlayPane) {
      overlayPane.style.zIndex = "650";
      overlayPane.style.pointerEvents = "none";
      overlayPane.style.position = "absolute";
      overlayPane.style.left = "0";
      overlayPane.style.top = "0";
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
      this.overlayHost.style.position = "absolute";
      this.overlayHost.style.inset = "0";
      this.overlayHost.style.width = "100%";
      this.overlayHost.style.height = "100%";
      this.overlaySizer = (size) => {
        const targetSize = size || this.map?.getSize?.();
        if (!targetSize) {
          return;
        }
        overlayPane.style.width = `${targetSize.x}px`;
        overlayPane.style.height = `${targetSize.y}px`;
      };
      this.overlaySizer();
      this.overlayResizeHandler = (event) => this.overlaySizer?.(event?.newSize);
      this.map?.on?.("resize", this.overlayResizeHandler);
    }
    if (!this.overlayHost) {
      this.overlayHost = document.createElement("div");
      this.overlayHost.className = "orrery-layer-overlay-host";
      this.overlayHost.style.position = "absolute";
      this.overlayHost.style.inset = "0";
      this.overlayHost.style.width = "100%";
      this.overlayHost.style.height = "100%";
      this.container.appendChild(this.overlayHost);
    }
    this.map?.invalidateSize?.();

    if (!this.overlayHost) {
      this.overlayHost = document.createElement("div");
      this.overlayHost.className = "orrery-layer-overlay-host";
      this.overlayHost.style.position = "absolute";
      this.overlayHost.style.inset = "0";
      this.overlayHost.style.width = "100%";
      this.overlayHost.style.height = "100%";
      this.container.appendChild(this.overlayHost);
    }
    this.map?.invalidateSize?.();
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

  updateSettings(settings) {
    if (!this.tileLayer || !settings) {
      return;
    }
    this.settings = settings;
    if (settings.urlTemplate) {
      this.tileLayer.setUrl(settings.urlTemplate);
    }
    if (Number.isFinite(settings.minZoom)) {
      this.tileLayer.options.minZoom = settings.minZoom;
      this.map?.setMinZoom?.(settings.minZoom);
    }
    if (Number.isFinite(settings.maxZoom)) {
      this.tileLayer.options.maxZoom = settings.maxZoom;
      this.map?.setMaxZoom?.(settings.maxZoom);
    }
    if (settings.attribution !== undefined) {
      this.tileLayer.options.attribution = settings.attribution;
    }
    if (this.map) {
      const currentZoom = this.map.getZoom();
      if (Number.isFinite(settings.maxZoom) && currentZoom > settings.maxZoom) {
        this.map.setZoom(settings.maxZoom);
      }
      if (Number.isFinite(settings.minZoom) && currentZoom < settings.minZoom) {
        this.map.setZoom(settings.minZoom);
      }
      if (Number.isFinite(settings.initialZoom)) {
        this.map.setZoom(settings.initialZoom);
      }
    }
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

  // Real Leaflet map instance — needed by marker rendering (app.js) to
  // convert a marker's stored {lat, lng} into a pixel position via
  // latLngToLayerPoint, and to convert a click event into {lat, lng} via
  // mouseEventToLayerPoint/layerPointToLatLng. null for image/canvas maps,
  // which have no such projection (and don't need one — their overlay lives
  // inside the same CSS-transformed element pan-zoom already handles).
  getMap() {
    return this.map;
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
      if (this.overlayResizeHandler) {
        this.map.off?.("resize", this.overlayResizeHandler);
      }
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
    applyImageDimensions(image, this.settings);
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
      applyImageDimensions(image, settings);
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

  setView(view) {
    this.current?.setView?.(view);
  }

  getView() {
    return this.current?.getView();
  }

  getOverlayContainer() {
    return this.current?.getOverlayHost?.() || null;
  }

  getMap() {
    return this.current?.getMap?.() || null;
  }

  getDefaultView() {
    return this.defaultView;
  }

  setInteractionEnabled(enabled) {
    this.current?.setInteractionEnabled?.(enabled);
  }
}
