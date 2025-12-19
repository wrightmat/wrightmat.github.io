import { createSortable } from "../../../common/js/lib/dnd.js";

export function createCanvasPlaceholder(text, { variant = "default", classes = [] } = {}) {
  const placeholder = document.createElement("div");
  placeholder.classList.add("workbench-drop-placeholder");
  if (variant === "root") {
    placeholder.classList.add("workbench-drop-placeholder--root");
  } else if (variant === "compact") {
    placeholder.classList.add("workbench-drop-placeholder--compact");
  }
  if (Array.isArray(classes)) {
    classes.forEach((className) => {
      if (className && typeof className === "string") {
        placeholder.classList.add(className);
      }
    });
  }
  placeholder.textContent = text;
  placeholder.setAttribute("aria-hidden", "true");
  return placeholder;
}

export function setupDropzones(root, registry, { groupName, zoneSelector = "[data-dropzone]", sortableOptions = {} } = {}) {
  if (!(registry instanceof Map)) {
    throw new Error("setupDropzones requires a Map to store registry entries");
  }
  registry.forEach((sortable) => {
    if (sortable && typeof sortable.destroy === "function") {
      sortable.destroy();
    }
  });
  registry.clear();
  if (!root) {
    return registry;
  }
  const zones = [root, ...root.querySelectorAll(zoneSelector)];
  zones.forEach((zone) => {
    const sortable = createSortable(zone, {
      group: { name: groupName, pull: true, put: true },
      fallbackOnBody: true,
      swapThreshold: 0.65,
      ...sortableOptions,
    });
    registry.set(zone, sortable);
  });
  return registry;
}

export function initPaletteInteractions(
  paletteElement,
  { groupName, dataAttribute = "data-type", onActivate, sortableOptions = {} } = {}
) {
  if (!paletteElement) {
    return { sortable: null, destroy() {} };
  }
  const sortable = createSortable(paletteElement, {
    group: { name: groupName, pull: "clone", put: false },
    sort: false,
    fallbackOnBody: true,
    ...sortableOptions,
  });

  let lastActivatedAt = 0;
  const handleDoubleClick = (event) => {
    const now = Date.now();
    if (now - lastActivatedAt < 120) {
      return;
    }
    lastActivatedAt = now;

    event.preventDefault();
    const item = event.target.closest(`[${dataAttribute}]`);
    if (!item || !paletteElement.contains(item)) {
      return;
    }
    const value = item.getAttribute(dataAttribute);
    if (!value) {
      return;
    }
    if (typeof onActivate === "function") {
      onActivate({ value, item, originalEvent: event });
    }
  };

  paletteElement.addEventListener("dblclick", handleDoubleClick);

  const destroy = () => {
    paletteElement.removeEventListener("dblclick", handleDoubleClick);
    if (sortable && typeof sortable.destroy === "function") {
      sortable.destroy();
    }
  };

  return { sortable, destroy };
}
