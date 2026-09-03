import { updateTooltipContent } from "./tooltips.js";

function toPrettyJson(data) {
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data ?? {}, null, 2);
  } catch (error) {
    console.warn("Unable to serialise preview data", error);
    return "{}";
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The size badge lives in the Copy button's own tooltip ("Copy to clipboard
// (1.2 KB)") rather than a separate header element. Updates both the
// attribute (for a not-yet-initialized Tooltip) and, if one already exists,
// its live content — Bootstrap caches title at construction and won't
// re-read the attribute on its own.
function updateCopyButtonSize(copyButton, byteCount) {
  if (!copyButton) return;
  const title = `Copy to clipboard (${formatSize(byteCount)})`;
  copyButton.setAttribute("aria-label", title);
  updateTooltipContent(copyButton, title);
}

export function updateJsonPreview(previewElement, copyButton, data) {
  if (!previewElement) {
    return;
  }
  const text = toPrettyJson(data);
  if ("value" in previewElement) {
    previewElement.value = text;
  } else {
    previewElement.textContent = text;
  }
  updateCopyButtonSize(copyButton, new Blob([text]).size);
}

export function createJsonPreviewRenderer({
  resolvePreviewElement,
  resolveBytesElement,
  serialize,
  onAfterRender,
} = {}) {
  if (typeof serialize !== "function") {
    throw new Error("createJsonPreviewRenderer requires a serialize function");
  }

  const previewResolver =
    typeof resolvePreviewElement === "function"
      ? resolvePreviewElement
      : () => resolvePreviewElement;

  // Named for the size info it resolves, not the element type — call sites
  // point this at the Copy button (see updateCopyButtonSize).
  const bytesResolver =
    typeof resolveBytesElement === "function"
      ? resolveBytesElement
      : () => resolveBytesElement;

  return () => {
    const previewElement = previewResolver();
    if (!previewElement) {
      return;
    }
    const bytesElement = bytesResolver();
    const payload = serialize();
    updateJsonPreview(previewElement, bytesElement, payload);
    if (typeof onAfterRender === "function") {
      onAfterRender(payload);
    }
  };
}

export { formatSize };
