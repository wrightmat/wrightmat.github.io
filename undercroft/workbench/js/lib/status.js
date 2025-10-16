const DEFAULT_TIMEOUT = 4000;
let counter = 0;

export class StatusManager {
  constructor(root) {
    this.root = root || document.createElement("div");
    this.root.classList.add("pointer-events-none", "flex", "w-full", "max-w-xl", "justify-center");
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
    wrapper.className = [
      "pointer-events-auto",
      "status-toast-enter",
      "rounded-full",
      "border",
      "px-4",
      "py-2.5",
      "text-sm",
      "font-medium",
      "shadow-theme",
      "backdrop-blur",
      "transition",
      "status-toast",
      item.type === "error" ? "border-rose-400 bg-rose-500/10 text-rose-700 dark:border-rose-500 dark:text-rose-200" : "",
      item.type === "success" ? "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500 dark:text-emerald-200" : "",
      item.type === "info" ? "border-slate-200 bg-white/90 text-slate-700 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200" : "",
    ]
      .filter(Boolean)
      .join(" ");

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
