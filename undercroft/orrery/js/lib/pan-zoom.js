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
    this.startPoint = null;
    this.startPan = null;
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
      if (event.button !== 0) {
        return;
      }
      this.isPanning = true;
      this.startPoint = { x: event.clientX, y: event.clientY };
      this.startPan = { ...this.view.pan };
      this.container.classList.add("is-panning");
      if (this.container.setPointerCapture) {
        this.container.setPointerCapture(event.pointerId);
      }
    };

    this.handlePointerMove = (event) => {
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

    this.handlePointerUp = () => {
      if (!this.isPanning) {
        return;
      }
      this.isPanning = false;
      this.container.classList.remove("is-panning");
    };

    this.container.addEventListener("wheel", this.handleWheel, { passive: false });
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    this.container.addEventListener("pointermove", this.handlePointerMove);
    this.container.addEventListener("pointerup", this.handlePointerUp);
    this.container.addEventListener("pointerleave", this.handlePointerUp);
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
    this.container.removeEventListener("pointerleave", this.handlePointerUp);
  }
}
