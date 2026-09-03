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
  bare = false,
} = {}) {
  const element = document.createElement("div");
  // Not Bootstrap's `.border`/`.rounded-3`/`.p-3` utilities — those are
  // `!important`-generated and would block a component's own custom
  // border/padding (applyComponentStyles). The default look lives in
  // workbench/css/styles.css's .workbench-canvas-card rule instead.
  element.classList.add("workbench-canvas-card", "d-flex", "flex-column");
  if (bare) {
    // Nested inside a Container/zone in Play view — the outer Container's
    // card already provides the visual boundary once; a second full card
    // per child made nested content sit indented from a sibling field.
    element.classList.add("workbench-canvas-card--bare");
  } else {
    element.classList.add("bg-body", "shadow-sm");
  }
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

// Canonical implementation now lives in common/js/lib/collapsible.js
// (shared with the new inspector-fields.js collapsible sections) —
// re-exported here so existing call sites in this tool don't need to
// change their import path.
export { createCollapseToggleButton } from "../../../common/js/lib/collapsible.js";
