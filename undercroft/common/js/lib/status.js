import { disposeTooltips, initTooltip, flashTooltipMessage } from "./tooltips.js";

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
    // Errors always persist until manually dismissed (see the close button
    // in _render), regardless of a caller-passed timeout.
    const resolvedTimeout = type === "error" ? 0 : timeout;
    const item = { id, message, type, timeout: resolvedTimeout };
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

    const text = document.createElement("span");
    text.className = "status-toast-message";
    text.textContent = item.message;
    wrapper.appendChild(text);

    // Iconify only renders icons when an element is added to the DOM — it
    // doesn't watch data-icon changes — so swapping copy->check replaces the
    // whole <span> rather than mutating its attribute (same as app.js's
    // replaceTypeIcon).
    const setCopyIcon = (iconName) => {
      const fresh = document.createElement("span");
      fresh.className = "iconify";
      fresh.dataset.icon = iconName;
      fresh.setAttribute("aria-hidden", "true");
      const existing = copyButton.querySelector(".iconify");
      if (existing) {
        copyButton.replaceChild(fresh, existing);
      } else {
        copyButton.appendChild(fresh);
      }
    };
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "btn btn-sm btn-link status-toast-copy p-0 ms-2 align-baseline lh-1";
    setCopyIcon("tabler:copy");
    copyButton.setAttribute("aria-label", "Copy message text");
    initTooltip(copyButton, { title: "Copy message text" });
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!navigator.clipboard?.writeText) return;
      navigator.clipboard.writeText(item.message).then(() => {
        setCopyIcon("tabler:check");
        flashTooltipMessage(copyButton, "Copied!", { duration: 1200 });
        window.setTimeout(() => {
          setCopyIcon("tabler:copy");
        }, 1200);
      }, () => {});
    });
    wrapper.appendChild(copyButton);

    // Errors don't auto-dismiss (see show()'s resolvedTimeout), so they need
    // an explicit close.
    if (item.type === "error") {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "btn btn-sm btn-link status-toast-close p-0 ms-2 align-baseline lh-1";
      const closeIcon = document.createElement("span");
      closeIcon.className = "iconify";
      closeIcon.dataset.icon = "tabler:x";
      closeIcon.setAttribute("aria-hidden", "true");
      closeButton.appendChild(closeIcon);
      closeButton.setAttribute("aria-label", "Dismiss");
      initTooltip(closeButton, { title: "Dismiss" });
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.remove(item.id);
      });
      wrapper.appendChild(closeButton);
    }

    return wrapper;
  }

  _dequeue() {
    if (this.active || !this.queue.length) {
      return;
    }
    const next = this.queue.shift();
    this.active = next;
    const element = this._render(next);
    disposeTooltips(this.root);
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
