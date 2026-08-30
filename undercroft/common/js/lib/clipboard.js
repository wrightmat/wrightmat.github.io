// Shared "copy this textarea's current contents" button behavior — used by
// every tool's JSON Preview panel and Press's own Sample Data panel, all of
// which otherwise duplicated the same navigator.clipboard.writeText + brief
// "Copied" icon-swap feedback pattern.
import { flashTooltipMessage } from "./tooltips.js";

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

  // The tooltip/title/aria-label flash-then-revert is flashTooltipMessage's
  // own job (tooltips.js) — it already reads the resting title fresh at
  // call time (not a value cached once at bind time), which is what makes
  // the revert land on whatever the title actually is right now, not a
  // stale copy — e.g. json-preview.js's own live byte count, which changes
  // as the underlying data changes. Only the icon swap is left here, since
  // that's not a tooltip concern.
  const showCopied = () => {
    if (icon) icon.dataset.icon = "tabler:check";
    flashTooltipMessage(button, "Copied!", { duration: COPIED_RESET_MS });
    if (resetTimer) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      if (icon) icon.dataset.icon = originalIcon;
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
