const DEFAULT_DELAY_MS = 120;
const DEFAULT_MIN_VISIBLE_MS = 320;

function resolveDocument(root) {
  if (root && typeof root === "object" && "nodeType" in root) {
    const node = /** @type {Node} */ (root);
    if (node.nodeType === Node.DOCUMENT_NODE) {
      return /** @type {Document} */ (node);
    }
  }
  return document;
}

function ensureOverlay({ root, message }) {
  const doc = resolveDocument(root);
  const existing = doc.querySelector("[data-page-loading-overlay]");
  if (existing instanceof HTMLElement) {
    if (message) {
      const messageNode = existing.querySelector("[data-page-loading-message]");
      if (messageNode) {
        messageNode.textContent = message;
      }
    }
    return existing;
  }
  const overlay = doc.createElement("div");
  overlay.className = "workbench-loading-overlay";
  overlay.dataset.pageLoadingOverlay = "";
  const dialog = doc.createElement("div");
  dialog.className = "workbench-loading-dialog card border-0 shadow-lg bg-body";
  const body = doc.createElement("div");
  body.className = "card-body d-flex flex-column align-items-center gap-3";
  const spinner = doc.createElement("div");
  spinner.className = "spinner-border text-primary";
  spinner.setAttribute("role", "status");
  const spinnerLabel = doc.createElement("span");
  spinnerLabel.className = "visually-hidden";
  spinnerLabel.textContent = "Loading…";
  spinner.appendChild(spinnerLabel);
  body.appendChild(spinner);
  const messageNode = doc.createElement("p");
  messageNode.className = "mb-0 text-body-secondary small text-center";
  messageNode.dataset.pageLoadingMessage = "";
  messageNode.textContent = message || "Loading…";
  body.appendChild(messageNode);
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  (doc.body || document.body || document.documentElement).appendChild(overlay);
  return overlay;
}

export function initPageLoadingOverlay({
  root = document,
  message = "Loading…",
  delayMs = DEFAULT_DELAY_MS,
  minVisibleMs = DEFAULT_MIN_VISIBLE_MS,
} = {}) {
  const overlay = ensureOverlay({ root, message });
  const messageNode = overlay.querySelector("[data-page-loading-message]");
  let holdCount = 0;
  let visible = false;
  let showTimer = 0;
  let hideTimer = 0;
  let visibleAt = 0;

  function clearTimer(id) {
    if (id) {
      window.clearTimeout(id);
    }
    return 0;
  }

  function setVisible(nextVisible) {
    if (nextVisible) {
      if (!visible) {
        overlay.classList.add("is-visible");
        visible = true;
        visibleAt = Date.now();
      }
      return;
    }
    if (!visible) {
      return;
    }
    overlay.classList.remove("is-visible");
    visible = false;
  }

  function scheduleShow() {
    hideTimer = clearTimer(hideTimer);
    if (visible || showTimer) {
      return;
    }
    showTimer = window.setTimeout(() => {
      showTimer = 0;
      if (holdCount > 0) {
        setVisible(true);
      }
    }, Math.max(0, delayMs));
  }

  function scheduleHide() {
    showTimer = clearTimer(showTimer);
    if (!visible) {
      return;
    }
    const elapsed = Date.now() - visibleAt;
    const wait = Math.max(0, minVisibleMs - elapsed);
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (holdCount === 0) {
        setVisible(false);
      }
    }, wait);
  }

  function hold() {
    holdCount += 1;
    if (holdCount === 1) {
      scheduleShow();
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      holdCount = Math.max(0, holdCount - 1);
      if (holdCount === 0) {
        scheduleHide();
      }
    };
  }

  function track(promiseLike) {
    if (!promiseLike || typeof promiseLike.then !== "function") {
      return Promise.resolve(promiseLike);
    }
    const release = hold();
    return Promise.resolve(promiseLike)
      .catch((error) => {
        release();
        throw error;
      })
      .then((result) => {
        release();
        return result;
      });
  }

  function setMessage(nextMessage) {
    if (!messageNode || typeof nextMessage !== "string") {
      return;
    }
    messageNode.textContent = nextMessage.trim() || "Loading…";
  }

  function done() {
    holdCount = 0;
    showTimer = clearTimer(showTimer);
    hideTimer = clearTimer(hideTimer);
    setVisible(false);
  }

  function nextFrame() {
    return new Promise((resolve) => {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
        return;
      }
      window.setTimeout(() => resolve(), 16);
    });
  }

  return { element: overlay, hold, track, setMessage, done, nextFrame };
}
