const GAP_UNIT_REM = 0.25;

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
}

function applyGap(element, gap) {
  if (typeof gap === "number") {
    element.style.gap = `${gap * GAP_UNIT_REM}rem`;
  }
}

function createTextElement(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined && text !== null) {
    el.textContent = text;
  }
  applyClassName(el, className);
  return el;
}

function renderField(node, context) {
  const value = resolveBinding(node.text ?? node.value ?? node.bind, context);
  switch (node.component) {
    case "heading": {
      const el = createTextElement(node.level ?? "h3", value ?? node.label, node.className ?? "fw-semibold");
      applyInlineStyles(el, node.style);
      return el;
    }
    case "text": {
      const el = createTextElement("p", value ?? "", node.className ?? "mb-0");
      if (node.muted) {
        applyClassName(el, "text-body-secondary");
      }
      applyInlineStyles(el, node.style);
      return el;
    }
    case "badge": {
      const el = createTextElement("span", value ?? node.label ?? "Badge", node.className ?? "badge text-bg-primary");
      applyInlineStyles(el, node.style);
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
      return el;
    }
    case "stat": {
      const wrapper = document.createElement("div");
      applyClassName(wrapper, node.className ?? "panel-box");
      const labelValue = resolveBinding(node.label, context) ?? node.label ?? "";
      const label = createTextElement("p", labelValue, "card-meta mb-0");
      const val = createTextElement("p", value ?? "—", "mb-0 fw-semibold");
      applyInlineStyles(label, node.style);
      applyInlineStyles(val, node.style);
      wrapper.append(label, val);
      return wrapper;
    }
    case "noteLines": {
      const el = document.createElement("div");
      applyClassName(el, node.className ?? "note-lines");
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
  applyGap(container, node.gap ?? 4);
  asArray(node.children).forEach((child) => {
    container.appendChild(renderNode(child, context, options));
  });
  return container;
}

function renderRow(node, context, options) {
  const container = document.createElement("div");
  applyClassName(container, node.className ?? "d-grid");
  const columnCount = (node.columns && node.columns.length) || 1;
  if (node.templateColumns) {
    container.style.gridTemplateColumns = node.templateColumns;
  } else if (!node.className) {
    container.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  }
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
  return renderNode(layout, context, options);
}
