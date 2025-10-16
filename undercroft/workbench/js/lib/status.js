const DEFAULT_TIMEOUT = 4000;
let counter = 0;

export class StatusManager {
  constructor(root) {
    this.root = root || document.createElement("div");
    if (!this.root.classList.contains("status-root")) {
      this.root.classList.add("status-root");
    }
    this.queue = [];
    this.active = null;
  }

  show(message, { type = "info", timeout = DEFAULT_TIMEOUT } = {}) {
    const id = `status-${counter++}`;
    const item = { id, message, type, timeout };
    this.queue.push(item);
    if (!this.active) {
      this._dequeue();
    }
    return id;
  }

  remove(id) {
    if (this.active && this.active.id === id) {
      this._clearActive();
      this._dequeue();
      return;
    }
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  _render(item) {
    const wrapper = document.createElement("div");
    wrapper.dataset.statusId = item.id;
    const classes = [
      "status-toast",
      "status-toast-enter",
      "rounded-pill",
      "border",
      "px-4",
      "py-2",
      "fw-medium",
      "fs-6",
      "shadow-theme",
      "bg-body",
      "text-body",
    ];

    if (item.type === "error") {
      classes.push("border-danger-subtle", "bg-danger-subtle", "text-danger-emphasis");
    } else if (item.type === "success") {
      classes.push("border-success-subtle", "bg-success-subtle", "text-success-emphasis");
    } else {
      classes.push("border-body-tertiary", "bg-body-tertiary");
    }

    wrapper.className = classes.join(" ");
    
    wrapper.textContent = item.message;
    return wrapper;
  }

  _dequeue() {
    if (this.active || !this.queue.length) {
      return;
    }
    const next = this.queue.shift();
    this.active = next;
    const element = this._render(next);
    this.root.innerHTML = "";
    this.root.appendChild(element);
    requestAnimationFrame(() => {
      element.classList.add("status-toast-enter-active");
      element.classList.remove("status-toast-enter");
    });
    if (next.timeout > 0) {
      this.timeoutId = window.setTimeout(() => {
        this._clearActive();
        this._dequeue();
      }, next.timeout);
    }
  }

  _clearActive() {
    if (!this.active) {
      return;
    }
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    const element = this.root.querySelector("[data-status-id]");
    if (element) {
      element.classList.remove("status-toast-enter-active");
      element.classList.add("status-toast-exit", "status-toast-exit-active");
      const removeLater = () => {
        element.removeEventListener("transitionend", removeLater);
        if (element.parentElement === this.root) {
          this.root.removeChild(element);
        }
      };
      element.addEventListener("transitionend", removeLater);
    }
    this.active = null;
  }
}
