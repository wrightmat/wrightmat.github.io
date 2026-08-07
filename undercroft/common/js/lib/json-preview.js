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

// The size badge that used to sit in the header row was folded into the
// Copy button's own tooltip instead (one less element competing for the
// same row's horizontal space — see workbench/index.html's own JSON Data
// section for the shape every tool now matches). `copyButton`, if given,
// gets its tooltip title updated to read "Copy to clipboard (1.2 KB)" —
// both the attribute (so a not-yet-initialized Bootstrap Tooltip picks it
// up at construction) and, if a Tooltip instance already exists, its live
// content too (Bootstrap caches title at construction, it does not
// re-read the attribute on its own). bindCopyButton (clipboard.js) reads
// this same attribute fresh at each click, not once at bind time, so its
// own "Copied!" flash always restores to the current size, never a stale
// one captured before this ran.
function updateCopyButtonSize(copyButton, byteCount) {
  if (!copyButton) return;
  const title = `Copy to clipboard (${formatSize(byteCount)})`;
  copyButton.setAttribute("data-bs-title", title);
  copyButton.setAttribute("title", title);
  copyButton.setAttribute("aria-label", title);
  const instance = window.bootstrap?.Tooltip?.getInstance?.(copyButton);
  instance?.setContent?.({ ".tooltip-inner": title });
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

  // Still named for the size info it resolves, not the element type — every
  // call site now points this at the Copy button (see updateCopyButtonSize
  // above) rather than the removed badge span.
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
