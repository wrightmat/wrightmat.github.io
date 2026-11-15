import { disposeTooltips, initTooltip, flashTooltipMessage } from "./tooltips.js";

// How long each type stays; an error stays until dismissed.
const TIMEOUTS = { info: 10000, success: 10000, warning: 20000, error: 0 };
// Past this many, the oldest timed toast makes way, so a burst of messages can't fill the screen.
const MAX_VISIBLE = 5;
const TYPE_CLASSES = {
  error: ["border-danger-subtle", "bg-danger-subtle", "text-danger-emphasis"],
  warning: ["border-warning-subtle", "bg-warning-subtle", "text-warning-emphasis"],
  success: ["border-success-subtle", "bg-success-subtle", "text-success-emphasis"],
  info: ["border-body-tertiary", "bg-body-tertiary"],
};
const PROGRESS_CLASSES = { warning: "bg-warning", success: "bg-success", info: "bg-secondary" };
let counter = 0;

export class StatusManager {
  constructor(root) {
    this.root = root || document.createElement("div");
    if (!this.root.classList.contains("status-root")) {
      this.root.classList.add("status-root");
    }
    this.toasts = new Map();
  }

  show(message, { type = "info" } = {}) {
    const id = `status-${counter++}`;
    const kind = TYPE_CLASSES[type] ? type : "info";
    const timeout = TIMEOUTS[kind];
    const element = this._render({ id, message, type: kind, timeout });
    this.root.appendChild(element);
    const toast = { element, timeout, countdown: null };
    this.toasts.set(id, toast);
    requestAnimationFrame(() => {
      element.classList.add("status-toast-enter-active");
      element.classList.remove("status-toast-enter");
    });
    if (timeout > 0) {
      toast.countdown = element
        .querySelector(".status-toast-progress")
        .animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: timeout, easing: "linear", fill: "forwards" });
      toast.countdown.onfinish = () => this.remove(id);
      element.addEventListener("mouseenter", () => toast.countdown.pause());
      element.addEventListener("mouseleave", () => toast.countdown.play());
    }
    const timed = [...this.toasts].filter(([, entry]) => entry.timeout > 0);
    while (this.toasts.size > MAX_VISIBLE && timed.length) {
      this.remove(timed.shift()[0]);
    }
    return id;
  }

  remove(id) {
    const toast = this.toasts.get(id);
    if (!toast) return;
    this.toasts.delete(id);
    toast.countdown?.cancel();
    const { element } = toast;
    element.classList.remove("status-toast-enter-active");
    element.classList.add("status-toast-exit", "status-toast-exit-active");
    // A timer rather than transitionend: a toast removed before it finished entering has no opacity change to end.
    // Its tooltips go with it, once a clicked button's own tooltip has finished hiding.
    window.setTimeout(() => {
      disposeTooltips(element);
      element.remove();
    }, 200);
  }

  _render(item) {
    const wrapper = document.createElement("div");
    wrapper.dataset.statusId = item.id;
    wrapper.className = ["status-toast", "status-toast-enter", "rounded", "overflow-hidden", "border", "fw-medium", "fs-6", "shadow-theme", "bg-body", "text-body", ...TYPE_CLASSES[item.type]].join(" ");

    const row = document.createElement("div");
    row.className = "d-flex align-items-center px-4 py-2";
    wrapper.appendChild(row);

    const text = document.createElement("span");
    text.className = "status-toast-message";
    text.textContent = item.message;
    row.appendChild(text);

    // Iconify only renders icons when an element is added to the DOM — it
    // doesn't watch data-icon changes — so swapping copy->check replaces the
    // whole <span> rather than mutating its attribute.
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
    row.appendChild(copyButton);

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
    row.appendChild(closeButton);

    if (item.timeout > 0) {
      const progress = document.createElement("div");
      progress.className = `status-toast-progress ${PROGRESS_CLASSES[item.type]}`;
      wrapper.appendChild(progress);
    }

    return wrapper;
  }
}
