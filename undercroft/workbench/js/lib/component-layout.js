const LABEL_POSITIONS = new Set(["top", "right", "bottom", "left"]);

export function normalizeLabelPosition(value, fallback = "top") {
  const basis = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (basis && LABEL_POSITIONS.has(basis)) {
    return basis;
  }
  const normalizedFallback = typeof fallback === "string" ? fallback.trim().toLowerCase() : "";
  return LABEL_POSITIONS.has(normalizedFallback) ? normalizedFallback : "top";
}

export function resolveComponentLabelPosition(component, fallback = "top") {
  if (!component || typeof component !== "object") {
    return normalizeLabelPosition("", fallback);
  }
  if (typeof component.labelPosition === "string" && component.labelPosition.trim()) {
    return normalizeLabelPosition(component.labelPosition, fallback);
  }
  if (typeof component.label_position === "string" && component.label_position.trim()) {
    return normalizeLabelPosition(component.label_position, fallback);
  }
  return normalizeLabelPosition("", fallback);
}

export function createLabeledField({
  component = null,
  control,
  labelText = "",
  labelTag = "label",
  labelFor = "",
  labelClasses = [],
  applyFormatting,
  fallbackPosition = "top",
} = {}) {
  const position = resolveComponentLabelPosition(component, fallbackPosition);
  const wrapper = document.createElement("div");
  wrapper.classList.add("component-field", `component-field--label-${position}`);
  wrapper.dataset.labelPosition = position;
  if (!(control instanceof Node)) {
    return wrapper;
  }
  if (labelText) {
    const labelElement = document.createElement(labelTag);
    labelElement.classList.add("component-field__label");
    if (Array.isArray(labelClasses) && labelClasses.length) {
      labelClasses.forEach((className) => {
        if (typeof className === "string" && className.trim()) {
          labelElement.classList.add(className.trim());
        }
      });
    }
    if (labelTag === "label" && labelFor) {
      labelElement.setAttribute("for", labelFor);
    }
    if (typeof applyFormatting === "function") {
      applyFormatting(labelElement, component || {});
    }
    labelElement.textContent = labelText;
    if (position === "bottom" || position === "right") {
      wrapper.append(control, labelElement);
    } else {
      wrapper.append(labelElement, control);
    }
  } else {
    wrapper.append(control);
  }
  return wrapper;
}
