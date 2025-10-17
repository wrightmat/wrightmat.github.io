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

export { formatSize };
