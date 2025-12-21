const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export class PanZoomController {
  constructor({ container, content, view, onChange, minZoom = 0.25, maxZoom = 4 } = {}) {
    if (!container || !content) {
      throw new Error("PanZoomController requires container and content elements");
    }
    this.container = container;
    this.content = content;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
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
    this.applyTransform();
    this.bindEvents();
  }

  bindEvents() {
    this.handleWheel = (event) => {
      event.preventDefault();
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextZoom = clamp(this.view.zoom * zoomFactor, this.minZoom, this.maxZoom);
      if (nextZoom === this.view.zoom) {
        return;
      }
      this.view.zoom = nextZoom;
      this.applyTransform();
      this.emitChange();
    };

    this.handlePointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.container.setPointerCapture) {
        this.container.setPointerCapture(event.pointerId);
      }
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
    this.content.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
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
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("pointerdown", this.handlePointerDown);
    this.container.removeEventListener("pointermove", this.handlePointerMove);
    this.container.removeEventListener("pointerup", this.handlePointerUp);
    this.container.removeEventListener("pointercancel", this.handlePointerUp);
    this.container.removeEventListener("pointerleave", this.handlePointerUp);
  }
}
