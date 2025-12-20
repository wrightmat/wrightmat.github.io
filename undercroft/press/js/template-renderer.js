const GAP_UNIT_REM = 0.25;
const TEXT_SIZE_MAP = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

function shouldHide(node) {
  return Boolean(node?.hidden);
}

function resolveBinding(binding, context) {
  if (typeof binding !== "string" || !binding.startsWith("@")) {
    return binding;
  }
  const path = binding.slice(1).split(".");
  return path.reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return undefined;
  }, context);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function applyClassName(element, className) {
  if (className) {
    element.className = [element.className, className].filter(Boolean).join(" ");
  }
}

function applyInlineStyles(element, styles = {}) {
  if (!element || typeof styles !== "object") return;
  if (typeof styles.fontSize === "number") {
    element.style.fontSize = `${styles.fontSize}px`;
  }
  if (typeof styles.lineHeight === "number") {
    element.style.lineHeight = `${styles.lineHeight}`;
  }
  if (styles.color) {
    element.style.color = styles.color;
  }
  if (styles.backgroundColor) {
    element.style.backgroundColor = styles.backgroundColor;
  }
  if (styles.borderColor) {
    element.style.borderColor = styles.borderColor;
    element.style.borderStyle = "solid";
    element.style.borderWidth = "1px";
  } else {
    element.style.removeProperty("border-color");
    element.style.removeProperty("border-style");
    element.style.removeProperty("border-width");
  }
}

function applyGap(element, gap) {
  if (typeof gap === "number") {
    element.style.gap = `${gap * GAP_UNIT_REM}rem`;
  }
}

function resolveLayoutAlignment(node) {
  const alignment = node?.align || "start";
  if (alignment === "center") return "center";
  if (alignment === "end") return "end";
  if (alignment === "justify") return "stretch";
  return "start";
}

function resolveStackAlignment(node) {
  const alignment = node?.align || "justify";
  if (alignment === "center") return "center";
  if (alignment === "end") return "flex-end";
  if (alignment === "justify") return "space-between";
  return "flex-start";
}

function createTextElement(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined && text !== null) {
    el.textContent = text;
  }
  applyClassName(el, className);
  return el;
}

function applyTextFormatting(element, node) {
  if (!element || !node) return;
  const size = (() => {
    if (typeof node?.style?.fontSize === "number") {
      return node.style.fontSize;
    }
    if (node?.textSize) {
      return TEXT_SIZE_MAP[node.textSize] ?? null;
    }
    if (node?.component === "heading") {
      return TEXT_SIZE_MAP.lg;
    }
    if (node?.component === "text") {
      return TEXT_SIZE_MAP.md;
    }
    return TEXT_SIZE_MAP.md;
  })();
  if (size) {
    element.style.fontSize = `${size}px`;
  }
  const defaultBold = node?.component === "heading";
  const isBold = typeof node?.textStyles?.bold === "boolean" ? node.textStyles.bold : defaultBold;
  if (isBold) {
    element.style.fontWeight = "600";
  } else {
    element.style.removeProperty("font-weight");
  }
  if (node.textStyles?.italic) {
    element.style.fontStyle = "italic";
  } else {
    element.style.removeProperty("font-style");
  }
  if (node.textStyles?.underline) {
    element.style.textDecoration = "underline";
  } else {
    element.style.removeProperty("text-decoration");
  }
  const alignment = node.align || "start";
  if (alignment === "center") {
    element.style.textAlign = "center";
  } else if (alignment === "end") {
    element.style.textAlign = "right";
  } else if (alignment === "justify") {
    element.style.textAlign = "justify";
  } else {
    element.style.textAlign = "left";
  }
}

function applyTextColor(element, styles = {}) {
  if (!element || typeof styles !== "object") return;
  if (styles.color) {
    element.style.color = styles.color;
  } else {
    element.style.removeProperty("color");
  }
}

function renderField(node, context) {
  const value = resolveBinding(node.text ?? node.value ?? node.bind, context);
  switch (node.component) {
    case "heading": {
      const el = createTextElement(node.level ?? "h2", value ?? node.label, node.className ?? "fw-semibold");
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      return el;
    }
    case "text": {
      const tag = node.textStyle ?? "p";
      const el = createTextElement(tag, value ?? "", node.className ?? "mb-0");
      if (node.muted) {
        applyClassName(el, "text-body-secondary");
      }
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      return el;
    }
    case "badge": {
      const el = createTextElement("span", value ?? node.label ?? "Badge", node.className ?? "badge text-bg-primary");
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      return el;
    }
    case "list": {
      const items = resolveBinding(node.itemsBind, context) ?? node.items ?? [];
      const el = document.createElement("ul");
      applyClassName(el, node.className ?? "mb-0 ps-3 d-flex flex-column gap-1");
      asArray(items).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        el.appendChild(li);
      });
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      return el;
    }
    case "stat": {
      const wrapper = document.createElement("div");
      applyClassName(wrapper, node.className ?? "panel-box");
      const labelValue = resolveBinding(node.label, context) ?? node.label ?? "";
      const label = createTextElement("p", labelValue, "card-meta mb-0");
      const val = createTextElement("p", value ?? "—", "mb-0 fw-semibold");
      applyInlineStyles(wrapper, node.style);
      applyTextColor(label, node.style);
      applyTextColor(val, node.style);
      applyTextFormatting(label, node);
      applyTextFormatting(val, node);
      wrapper.append(label, val);
      return wrapper;
    }
    case "noteLines": {
      const el = document.createElement("div");
      applyClassName(el, node.className ?? "note-lines");
      applyInlineStyles(el, node.style);
      return el;
    }
    case "image": {
      const src = resolveBinding(node.url ?? node.src ?? node.text ?? node.value ?? node.bind, context);
      const el = document.createElement("div");
      applyClassName(el, node.className ?? "press-image");
      applyInlineStyles(el, node.style);
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = node.alt ?? "";
        img.className = "press-image__img";
        el.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "press-image__placeholder";
        placeholder.textContent = node.label ?? "Image";
        el.appendChild(placeholder);
      }
      return el;
    }
    default: {
      const el = document.createElement("div");
      el.className = "border border-dashed rounded-3 p-3 fs-6 text-body-secondary";
      el.textContent = `Unsupported component: ${node.component ?? "unknown"}`;
      return el;
    }
  }
}

function renderStack(node, context, options) {
  const container = document.createElement("div");
  applyClassName(container, node.className ?? "d-flex flex-column");
  applyInlineStyles(container, node.style);
  container.style.justifyContent = resolveStackAlignment(node);
  const hasAlignment = typeof node?.align === "string" && node.align.trim() !== "";
  applyGap(container, node.gap ?? 4);
  asArray(node.children).forEach((child) => {
    const renderedChild = renderNode(child, context, options);
    if (hasAlignment && renderedChild?.style) {
      renderedChild.style.flex = "0 0 auto";
    }
    container.appendChild(renderedChild);
  });
  return container;
}

function renderRow(node, context, options) {
  const container = document.createElement("div");
  applyClassName(container, node.className ?? "d-grid");
  applyInlineStyles(container, node.style);
  const columnCount = (node.columns && node.columns.length) || 1;
  if (node.templateColumns) {
    container.style.gridTemplateColumns = node.templateColumns;
  } else if (!node.className) {
    container.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  }
  container.style.justifyItems = resolveLayoutAlignment(node);
  applyGap(container, node.gap ?? 4);
  (node.columns || []).forEach((column) => {
    const col = document.createElement("div");
    if (column.span) {
      col.style.gridColumn = `span ${column.span}`;
    }
    col.appendChild(renderNode(column.node, context, options));
    container.appendChild(col);
  });
  return container;
}

function attachEditorHooks(element, node, options) {
  if (!element || !options?.editable || !node?.uid) return element;
  element.dataset.nodeId = node.uid;
  element.classList.add("press-component");
  if (options.selectedId && options.selectedId === node.uid) {
    element.classList.add("press-component--selected");
  }
  if (typeof options.onSelect === "function") {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onSelect(node.uid);
    });
  }
  return element;
}

export function renderNode(node, context = {}, options = {}) {
  if (!node || shouldHide(node)) return document.createComment("empty");
  switch (node.type) {
    case "stack":
      return attachEditorHooks(renderStack(node, context, options), node, options);
    case "row":
      return attachEditorHooks(renderRow(node, context, options), node, options);
    case "field":
      return attachEditorHooks(renderField(node, context), node, options);
    default:
      return document.createComment(`unsupported node: ${node.type}`);
  }
}

export function renderLayout(layout, context = {}, options = {}) {
  const rendered = renderNode(layout, context, options);
  if (layout?.type === "stack" && rendered?.style) {
    rendered.style.flex = "1 1 auto";
    rendered.style.minHeight = "100%";
    rendered.style.height = "100%";
  }
  if (typeof options?.onRootReady === "function") {
    options.onRootReady(rendered);
  }
  return rendered;
}
