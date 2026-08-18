const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// See handleWheel's own comment for why this needs to be magnitude-based
// rather than a flat per-event step. Bumped up from the initial 0.001, then
// doubled again to 0.0028 — confirmed as the preferred trackpad feel across
// this module's own consumers (Orrery's map, every tool's Relationships
// graph via graph-view.js).
const WHEEL_ZOOM_SENSITIVITY = 0.0028;

export class PanZoomController {
  constructor({
    container,
    content,
    view,
    onChange,
    minZoom = 0.25,
    maxZoom = 4,
    // Per-instance override, for a future consumer that wants different
    // trackpad/wheel-zoom feel than the shared default above.
    wheelZoomSensitivity = WHEEL_ZOOM_SENSITIVITY,
  } = {}) {
    if (!container || !content) {
      throw new Error("PanZoomController requires container and content elements");
    }
    this.container = container;
    this.content = content;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.wheelZoomSensitivity = wheelZoomSensitivity;
    this.view = {
      zoom: 1,
      pan: { x: 0, y: 0 },
      ...(view || {}),
      pan: {
        x: view?.pan?.x ?? 0,
        y: view?.pan?.y ?? 0,
      },
    };
    this.isPanning = false;
    this.isPinching = false;
    this.startPoint = null;
    this.startPan = null;
    this.pinchStartDistance = 0;
    this.pinchStartZoom = 1;
    this.pinchStartCenter = null;
    this.activePointers = new Map();
    this.enabled = true;
    this.settleTimeout = null;
    this.applyTransform();
    this.bindEvents();
  }

  // See styles.css's own comment on .orrery-map-content.is-interacting —
  // GPU-layer promotion (will-change: transform) is only wanted WHILE a
  // gesture is actively moving the map; leaving it on permanently trades
  // away crisp final rendering for a smoothness benefit that's only
  // needed mid-gesture. beginInteraction is idempotent (safe to call on
  // every wheel/pointermove event, not just the first).
  beginInteraction() {
    if (this.settleTimeout) {
      clearTimeout(this.settleTimeout);
      this.settleTimeout = null;
    }
    this.content.classList.add("is-interacting");
  }

  // Debounced rather than fired immediately on gesture-end — a wheel
  // gesture has no discrete "end" event of its own (just a burst of
  // individual wheel events), so this gets called after EVERY wheel event
  // too, each call pushing the actual removal back out until the events
  // stop arriving.
  scheduleSettle(delay = 200) {
    if (this.settleTimeout) {
      clearTimeout(this.settleTimeout);
    }
    this.settleTimeout = setTimeout(() => {
      this.settleTimeout = null;
      this.content.classList.remove("is-interacting");
    }, delay);
  }

  bindEvents() {
    this.handleWheel = (event) => {
      if (!this.enabled) {
        return;
      }
      event.preventDefault();
      this.beginInteraction();
      this.scheduleSettle();
      // Scaled by the event's own deltaY magnitude rather than a flat
      // per-event factor. A real mouse wheel fires a few large-delta events
      // per physical click/notch (deltaY ~100), but a trackpad's pinch/
      // scroll gesture — delivered to the browser as wheel events (ctrl+
      // wheel on Windows precision touchpads, fractional deltaY on Mac) —
      // fires many small-delta events in rapid succession as the fingers
      // move. A flat ±10% PER EVENT compounds across dozens of those events
      // into a very fast zoom, while a mouse's few discrete notches stay
      // reasonable — exactly the reported "pinch zooms very fast, the
      // buttons zoom slowly" mismatch. Exponential scaling by deltaY keeps
      // the perceived zoom RATE tied to actual scroll/gesture distance,
      // consistent regardless of how many events the browser splits a
      // gesture into. The default WHEEL_ZOOM_SENSITIVITY is tuned so a
      // single mouse-wheel notch (deltaY ~100) still zooms by ~10%,
      // matching the old flat-factor feel for that case; this.
      // wheelZoomSensitivity is the per-instance override of that default.
      const zoomFactor = Math.exp(-event.deltaY * this.wheelZoomSensitivity);
      const nextZoom = clamp(this.view.zoom * zoomFactor, this.minZoom, this.maxZoom);
      if (nextZoom === this.view.zoom) {
        return;
      }
      this.view.zoom = nextZoom;
      this.applyTransform();
      this.emitChange();
    };

    this.handlePointerDown = (event) => {
      if (!this.enabled) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.container.setPointerCapture) {
        this.container.setPointerCapture(event.pointerId);
      }
      this.beginInteraction();
      if (this.activePointers.size === 1) {
        this.isPanning = true;
        this.isPinching = false;
        this.startPoint = { x: event.clientX, y: event.clientY };
        this.startPan = { ...this.view.pan };
        this.container.classList.add("is-panning");
      } else if (this.activePointers.size === 2) {
        this.beginPinch();
      }
    };

    this.handlePointerMove = (event) => {
      if (!this.enabled) {
        return;
      }
      if (!this.activePointers.has(event.pointerId)) {
        return;
      }
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.isPinching && this.activePointers.size >= 2) {
        this.updatePinch();
        return;
      }
      if (!this.isPanning || !this.startPoint || !this.startPan) {
        return;
      }
      const deltaX = event.clientX - this.startPoint.x;
      const deltaY = event.clientY - this.startPoint.y;
      this.view.pan = {
        x: this.startPan.x + deltaX,
        y: this.startPan.y + deltaY,
      };
      this.applyTransform();
      this.emitChange();
    };

    this.handlePointerUp = (event) => {
      if (!this.enabled) {
        return;
      }
      if (event && this.activePointers.has(event.pointerId)) {
        this.activePointers.delete(event.pointerId);
      }
      if (this.activePointers.size < 2) {
        this.isPinching = false;
      }
      if (this.activePointers.size === 1) {
        const remaining = Array.from(this.activePointers.values())[0];
        this.isPanning = true;
        this.startPoint = { ...remaining };
        this.startPan = { ...this.view.pan };
        this.container.classList.add("is-panning");
        return;
      }
      if (this.activePointers.size === 0) {
        this.isPanning = false;
        this.container.classList.remove("is-panning");
        this.scheduleSettle();
      }
    };

    this.container.addEventListener("wheel", this.handleWheel, { passive: false });
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerup", this.handlePointerUp);
    this.container.addEventListener("pointercancel", this.handlePointerUp);
    this.container.addEventListener("pointerleave", this.handlePointerUp);
  }

  beginPinch() {
    const points = Array.from(this.activePointers.values());
    if (points.length < 2) {
      return;
    }
    this.isPinching = true;
    this.isPanning = false;
    this.container.classList.remove("is-panning");
    this.pinchStartDistance = this.distance(points[0], points[1]);
    this.pinchStartZoom = this.view.zoom;
    this.pinchStartCenter = this.midpoint(points[0], points[1]);
    this.startPan = { ...this.view.pan };
  }

  updatePinch() {
    const points = Array.from(this.activePointers.values());
    if (points.length < 2) {
      return;
    }
    const distance = this.distance(points[0], points[1]);
    const center = this.midpoint(points[0], points[1]);
    const ratio = distance / (this.pinchStartDistance || distance);
    const nextZoom = clamp(this.pinchStartZoom * ratio, this.minZoom, this.maxZoom);
    const deltaX = center.x - (this.pinchStartCenter?.x ?? center.x);
    const deltaY = center.y - (this.pinchStartCenter?.y ?? center.y);
    this.view.zoom = nextZoom;
    this.view.pan = {
      x: (this.startPan?.x ?? 0) + deltaX,
      y: (this.startPan?.y ?? 0) + deltaY,
    };
    this.applyTransform();
    this.emitChange();
  }

  distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  emitChange() {
    if (this.onChange) {
      this.onChange(this.getView());
    }
  }

  applyTransform() {
    const { zoom, pan } = this.view;
    this.content.style.transform = `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.activePointers.clear();
      this.isPanning = false;
      this.isPinching = false;
      this.startPoint = null;
      this.startPan = null;
      this.container.classList.remove("is-panning");
      if (this.settleTimeout) {
        clearTimeout(this.settleTimeout);
        this.settleTimeout = null;
      }
      this.content.classList.remove("is-interacting");
    }
  }

  getView() {
    return {
      zoom: this.view.zoom,
      pan: { ...this.view.pan },
    };
  }

  setView(view) {
    if (!view) {
      return;
    }
    this.view.zoom = view.zoom ?? this.view.zoom;
    if (view.pan) {
      this.view.pan = {
        x: view.pan.x ?? this.view.pan.x,
        y: view.pan.y ?? this.view.pan.y,
      };
    }
    this.applyTransform();
    this.emitChange();
  }

  zoomBy(delta) {
    if (!Number.isFinite(delta)) {
      return;
    }
    const nextZoom = clamp(this.view.zoom + delta, this.minZoom, this.maxZoom);
    if (nextZoom === this.view.zoom) {
      return;
    }
    this.view.zoom = nextZoom;
    this.applyTransform();
    this.emitChange();
  }

  reset(view) {
    this.view = {
      zoom: view?.zoom ?? 1,
      pan: {
        x: view?.pan?.x ?? 0,
        y: view?.pan?.y ?? 0,
      },
    };
    this.applyTransform();
    this.emitChange();
  }

  destroy() {
    if (this.settleTimeout) {
      clearTimeout(this.settleTimeout);
      this.settleTimeout = null;
    }
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerup", this.handlePointerUp);
    this.container.removeEventListener("pointercancel", this.handlePointerUp);
    this.container.removeEventListener("pointerleave", this.handlePointerUp);
  }
}
