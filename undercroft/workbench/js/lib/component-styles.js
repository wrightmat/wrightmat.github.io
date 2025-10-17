export const COMPONENT_ICONS = {
  input: "tabler:forms",
  array: "tabler:list-details",
  divider: "tabler:separator-horizontal",
  image: "tabler:photo",
  label: "tabler:typography",
  container: "tabler:layout-grid-add",
  "linear-track": "tabler:timeline",
  "circular-track": "tabler:gauge",
  "select-group": "tabler:toggle-right",
  toggle: "tabler:adjustments",
};

export function applyComponentStyles(element, component) {
  if (!element || !component) {
    return;
  }
  element.style.color = component.textColor || "";
  element.style.backgroundColor = component.backgroundColor || "";
  if (component.borderColor) {
    element.style.borderColor = component.borderColor;
  } else {
    element.style.removeProperty("border-color");
  }
}

export function applyTextFormatting(element, component) {
  if (!element || !component) {
    return;
  }
  const classes = [];
  switch (component.textSize) {
    case "sm":
      classes.push("fs-6");
      break;
    case "lg":
      classes.push("fs-5");
      break;
    case "xl":
      classes.push("fs-4");
      break;
    default:
      classes.push("fs-6");
      break;
  }
  if (component.textStyles?.bold) {
    classes.push("fw-semibold");
  }
  if (component.textStyles?.italic) {
    classes.push("fst-italic");
  }
  if (component.textStyles?.underline) {
    classes.push("text-decoration-underline");
  }
  element.classList.add(...classes);
  if (component.align === "center") {
    element.classList.add("text-center");
  } else if (component.align === "end") {
    element.classList.add("text-end");
  } else if (component.align === "justify") {
    element.style.textAlign = "justify";
  } else {
    element.classList.add("text-start");
  }
}
