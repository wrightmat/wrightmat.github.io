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

export function updateJsonPreview(previewElement, bytesElement, data) {
  if (!previewElement) {
    return;
  }
  const text = toPrettyJson(data);
  previewElement.textContent = text;
  if (bytesElement) {
    const size = new Blob([text]).size;
    bytesElement.textContent = formatSize(size);
  }
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
