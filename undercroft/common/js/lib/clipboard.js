// Shared "copy this textarea's contents" button behavior, used by every
// tool's JSON Preview panel and Press's Sample Data panel — otherwise each
// duplicated the same writeText + "Copied" icon-swap pattern.
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

// `source` is a textarea/input element (`.value` read at click time, not
// captured up front) or a function returning the text. Falls back to
// `document.execCommand("copy")` when the Clipboard API isn't available.
export function bindCopyButton(button, source, { onCopied } = {}) {
  if (!button) return () => {};
  const icon = button.querySelector(".iconify");
  const originalIcon = icon?.dataset.icon || "tabler:copy";
  let resetTimer = null;

  // The tooltip flash-then-revert is flashTooltipMessage's job (tooltips.js)
  // — it reads the resting title fresh at call time, so the revert lands on
  // the current title (e.g. json-preview.js's live byte count), not a stale
  // copy. Only the icon swap is left here.
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
