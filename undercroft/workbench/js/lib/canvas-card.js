function appendClasses(element, classes = []) {
  if (!element) return;
  const list = Array.isArray(classes)
    ? classes.filter((className) => typeof className === "string" && className.trim())
    : typeof classes === "string"
    ? classes.split(" ")
    : [];
  list.forEach((className) => {
    element.classList.add(className.trim());
  });
}

function assignDataset(element, dataset = {}) {
  if (!element || !dataset || typeof dataset !== "object") {
    return;
  }
  Object.entries(dataset).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    element.dataset[key] = String(value);
  });
}

function assignAttributes(element, attributes = {}) {
  if (!element || !attributes || typeof attributes !== "object") {
    return;
  }
  Object.entries(attributes).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    element.setAttribute(key, value);
  });
}

export function createCanvasCardElement({
  classes = [],
  dataset = {},
  attributes = {},
  gapClass = "gap-3",
  selected = false,
} = {}) {
  const element = document.createElement("div");
  element.classList.add(
    "workbench-canvas-card",
    "border",
    "rounded-3",
    "bg-body",
    "shadow-sm",
    "p-3",
    "d-flex",
    "flex-column"
  );
  if (gapClass) {
    element.classList.add(gapClass);
  }
  appendClasses(element, classes);
  assignDataset(element, dataset);
  assignAttributes(element, attributes);
  if (selected) {
    element.classList.add("is-selected");
  }
  return element;
}

export function createCardHeaderElement({ classes = [], dataset = {}, attributes = {}, sortableHandle = true } = {}) {
  const header = document.createElement("div");
  header.classList.add("workbench-canvas-card__header");
  appendClasses(header, classes);
  if (sortableHandle) {
    header.dataset.sortableHandle = "true";
  }
  assignDataset(header, dataset);
  assignAttributes(header, attributes);
  return header;
}

export function createCardActionsElement({ classes = [], dataset = {}, attributes = {} } = {}) {
  const actions = document.createElement("div");
  actions.classList.add("workbench-canvas-card__actions");
  appendClasses(actions, classes);
  assignDataset(actions, dataset);
  assignAttributes(actions, attributes);
  return actions;
}

export function createTypeIconElement({
  icon = "",
  label = "",
  placement = "bottom",
  classes = [],
  dataset = {},
  attributes = {},
} = {}) {
  const iconElement = document.createElement("span");
  iconElement.classList.add("workbench-canvas-card__type-icon", "d-inline-flex", "align-items-center", "justify-content-center");
  appendClasses(iconElement, classes);
  if (label) {
    iconElement.dataset.bsToggle = "tooltip";
    iconElement.dataset.bsPlacement = placement;
    iconElement.dataset.bsTitle = label;
    iconElement.setAttribute("aria-label", label);
  }
  if (icon) {
    iconElement.innerHTML = `<span class="iconify" data-icon="${icon}" aria-hidden="true"></span>`;
  }
  assignDataset(iconElement, dataset);
  assignAttributes(iconElement, attributes);
  return iconElement;
}

export function createDeleteButton({
  srLabel = "Remove item",
  tooltip,
  placement = "bottom",
  icon = "tabler:trash",
  classes = "btn btn-outline-danger btn-sm",
  dataset = {},
  attributes = {},
  onClick,
} = {}) {
  const button = document.createElement("button");
  button.type = "button";
  if (Array.isArray(classes)) {
    button.className = "";
    appendClasses(button, classes);
  } else {
    button.className = classes;
  }
  if (tooltip) {
    button.dataset.bsToggle = "tooltip";
    button.dataset.bsPlacement = placement;
    button.dataset.bsTitle = tooltip;
  }
  button.innerHTML = `<span class="iconify" data-icon="${icon}" aria-hidden="true"></span><span class="visually-hidden">${srLabel}</span>`;
  assignDataset(button, dataset);
  assignAttributes(button, attributes);
  if (typeof onClick === "function") {
    button.addEventListener("click", onClick);
  }
  return button;
}

export function createStandardCardChrome({
  icon,
  iconLabel,
  headerOptions = {},
  actionsOptions = {},
  iconOptions = {},
  removeButtonOptions = {},
} = {}) {
  const header = createCardHeaderElement(headerOptions);

  let actions = null;

  function ensureActions() {
    if (actions) {
      return actions;
    }
    const options = actionsOptions === false ? {} : actionsOptions;
    actions = createCardActionsElement(options);
    header.appendChild(actions);
    return actions;
  }

  if (actionsOptions !== false) {
    ensureActions();
  }

  let iconElement = null;
  if (icon) {
    const target = ensureActions();
    iconElement = createTypeIconElement({
      icon,
      label: iconLabel,
      ...iconOptions,
    });
    target.appendChild(iconElement);
  }

  let deleteButton = null;
  if (removeButtonOptions !== false) {
    const target = ensureActions();
    deleteButton = createDeleteButton(removeButtonOptions);
    target.appendChild(deleteButton);
  }

  if (actions) {
    header.appendChild(actions);
  }

  return { header, actions, iconElement, deleteButton, ensureActions };
}

export function createCollapseToggleButton({ label = "section", collapsed = false, onToggle } = {}) {
  let isCollapsed = Boolean(collapsed);
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("canvas-collapse-toggle", "d-inline-flex", "align-items-center", "justify-content-center");

  const icon = document.createElement("span");
  icon.className = "iconify";
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);

  function update(nextState) {
    isCollapsed = Boolean(nextState);
    const expandedLabel = label ? ` ${label}` : "";
    const actionLabel = isCollapsed ? `Expand${expandedLabel}` : `Collapse${expandedLabel}`;
    icon.setAttribute("data-icon", isCollapsed ? "tabler:chevron-right" : "tabler:chevron-down");
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.setAttribute("aria-label", actionLabel);
    button.setAttribute("title", actionLabel);
  }

  update(isCollapsed);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !isCollapsed;
    update(next);
    if (typeof onToggle === "function") {
      onToggle(next);
    }
  });

  return {
    button,
    setCollapsed: update,
  };
}
