// Shared "copy this textarea's current contents" button behavior — used by
// every tool's JSON Preview panel and Press's own Sample Data panel, all of
// which otherwise duplicated the same navigator.clipboard.writeText + brief
// "Copied" icon-swap feedback pattern.

const COPIED_RESET_MS = 1500;

function getSourceText(source) {
  if (typeof source === "function") {
    return String(source() ?? "");
  }
  if (source && "value" in source) {
    return String(source.value ?? "");
  }
  return String(source ?? "");
}

// `source` is either a textarea/input element (its live `.value` is read at
// click time, not captured up front — so this stays correct even as the
// preview updates after this call), or a function returning the text to
// copy. Falls back to a hidden-textarea `document.execCommand("copy")` when
// the Clipboard API isn't available (an insecure/non-HTTPS context, or an
// older browser) rather than silently doing nothing.
export function bindCopyButton(button, source, { onCopied } = {}) {
  if (!button) return () => {};
  const icon = button.querySelector(".iconify");
  const originalIcon = icon?.dataset.icon || "tabler:copy";
  let resetTimer = null;

  // Read fresh on every call (not captured once at bind time) — the title
  // carries a live byte count (see json-preview.js's updateCopyButtonSize),
  // which changes as the underlying data changes. Capturing it once here
  // would mean the "Copied!" flash always reverted to whatever size was
  // current the moment the page loaded, not the size that was actually
  // just copied.
  const showCopied = () => {
    const restoreTitle = button.getAttribute("data-bs-title") || button.getAttribute("title") || "Copy to clipboard";
    if (icon) icon.dataset.icon = "tabler:check";
    button.setAttribute("data-bs-title", "Copied!");
    button.setAttribute("title", "Copied!");
    button.setAttribute("aria-label", "Copied!");
    if (window.bootstrap?.Tooltip) {
      const instance = window.bootstrap.Tooltip.getInstance(button) || new window.bootstrap.Tooltip(button);
      instance.setContent?.({ ".tooltip-inner": "Copied!" });
      instance.show?.();
    }
    if (resetTimer) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      if (icon) icon.dataset.icon = originalIcon;
      button.setAttribute("data-bs-title", restoreTitle);
      button.setAttribute("title", restoreTitle);
      button.setAttribute("aria-label", restoreTitle);
      if (window.bootstrap?.Tooltip) {
        const instance = window.bootstrap.Tooltip.getInstance(button);
        instance?.setContent?.({ ".tooltip-inner": restoreTitle });
      }
    }, COPIED_RESET_MS);
  };

  const copyViaFallback = (text) => {
    const temp = document.createElement("textarea");
    temp.value = text;
    temp.style.position = "fixed";
    temp.style.opacity = "0";
    document.body.appendChild(temp);
    temp.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      console.warn("Copy to clipboard failed", error);
    }
    document.body.removeChild(temp);
  };

  const handler = async (event) => {
    event.preventDefault();
    const text = getSourceText(source);
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyViaFallback(text);
      }
      showCopied();
      if (typeof onCopied === "function") onCopied(text);
    } catch (error) {
      console.warn("Copy to clipboard failed, using fallback", error);
      copyViaFallback(text);
      showCopied();
    }
  };

  button.addEventListener("click", handler);
  return () => button.removeEventListener("click", handler);
}
