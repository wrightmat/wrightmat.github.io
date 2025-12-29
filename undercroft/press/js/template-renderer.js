import { resolveBinding } from "./bindings.js";

const GAP_UNIT_REM = 0.25;
const TEXT_SIZE_MAP = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

function shouldHide(node) {
  return Boolean(node?.hidden);
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

function resolveClassName(node, context) {
  const raw = node?.className ?? node?.classNameBind ?? "";
  if (typeof raw === "string" && raw.startsWith("@")) {
    return resolveBinding(raw, context) || null;
  }
  return raw || null;
}

function resolveTextSizePx(node) {
  if (typeof node?.style?.fontSize === "number") {
    return node.style.fontSize;
  }
  if (node?.textSize) {
    return TEXT_SIZE_MAP[node.textSize] ?? null;
  }
  if (node?.component === "text") {
    return TEXT_SIZE_MAP.md;
  }
  return TEXT_SIZE_MAP.md;
}

function applyInlineStyles(element, styles = {}) {
  if (!element || typeof styles !== "object") return;
  const borderEnabled = hasBorderStyles(styles);
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
  } else {
    element.style.removeProperty("border-color");
  }
  if (borderEnabled) {
    applyBorderStyles(element, styles);
  } else {
    resetBorderStyles(element);
  }
}

function hasBorderStyles(styles = {}) {
  return (
    styles.borderColor ||
    typeof styles.borderWidth === "number" ||
    styles.borderStyle ||
    typeof styles.borderRadius === "number" ||
    typeof styles.borderRadius === "string" ||
    styles.borderSides
  );
}

function applyBorderStyles(element, styles = {}) {
  const borderWidth = typeof styles.borderWidth === "number" ? styles.borderWidth : 1;
  const borderStyle = styles.borderStyle || "solid";
  const borderRadius =
    typeof styles.borderRadius === "number"
      ? `${styles.borderRadius}px`
      : typeof styles.borderRadius === "string"
        ? styles.borderRadius
        : null;
  if (borderRadius) {
    element.style.borderRadius = borderRadius;
  } else {
    element.style.removeProperty("border-radius");
  }

  const sides = styles.borderSides;
  if (sides && typeof sides === "object") {
    applyBorderSide(element.style, "Top", sides.top, borderWidth, borderStyle);
    applyBorderSide(element.style, "Right", sides.right, borderWidth, borderStyle);
    applyBorderSide(element.style, "Bottom", sides.bottom, borderWidth, borderStyle);
    applyBorderSide(element.style, "Left", sides.left, borderWidth, borderStyle);
  } else {
    element.style.borderWidth = `${borderWidth}px`;
    element.style.borderStyle = borderStyle;
    element.style.removeProperty("border-top-width");
    element.style.removeProperty("border-right-width");
    element.style.removeProperty("border-bottom-width");
    element.style.removeProperty("border-left-width");
    element.style.removeProperty("border-top-style");
    element.style.removeProperty("border-right-style");
    element.style.removeProperty("border-bottom-style");
    element.style.removeProperty("border-left-style");
  }
}

function applyBorderSide(style, side, enabled, width, borderStyle) {
  const widthValue = enabled === false ? 0 : width;
  const styleValue = enabled === false ? "none" : borderStyle;
  style[`border${side}Width`] = `${widthValue}px`;
  style[`border${side}Style`] = styleValue;
}

function resetBorderStyles(element) {
  element.style.removeProperty("border-width");
  element.style.removeProperty("border-style");
  element.style.removeProperty("border-radius");
  element.style.removeProperty("border-top-width");
  element.style.removeProperty("border-right-width");
  element.style.removeProperty("border-bottom-width");
  element.style.removeProperty("border-left-width");
  element.style.removeProperty("border-top-style");
  element.style.removeProperty("border-right-style");
  element.style.removeProperty("border-bottom-style");
  element.style.removeProperty("border-left-style");
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

function resolveTextTransform(node) {
  return {
    orientation: node?.textOrientation ?? "horizontal",
    rotation: Number.isFinite(node?.textAngle) ? node.textAngle : 0,
  };
}

function applyTextTransform(element, node) {
  if (!element || !node) return;
  const { rotation } = resolveTextTransform(node);
  const transforms = [];
  if (rotation) transforms.push(`rotate(${rotation}deg)`);
  if (transforms.length) {
    element.style.transform = transforms.join(" ");
    element.style.transformOrigin = "center";
  } else {
    element.style.removeProperty("transform");
    element.style.removeProperty("transform-origin");
  }
}

function applyTextFormatting(element, node) {
  if (!element || !node) return;
  const size = resolveTextSizePx(node);
  if (size) {
    element.style.fontSize = `${size}px`;
  }
  if (node?.component !== "icon") {
    const isBold = typeof node?.textStyles?.bold === "boolean" ? node.textStyles.bold : false;
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
  } else {
    element.style.removeProperty("font-weight");
    element.style.removeProperty("font-style");
    element.style.removeProperty("text-decoration");
    element.style.removeProperty("text-align");
  }
}

function applySvgTextColor(element, styles = {}, { muted = false } = {}) {
  if (!element) return;
  if (styles.color) {
    element.setAttribute("fill", styles.color);
    return;
  }
  if (muted) {
    element.setAttribute("fill", "var(--bs-secondary-color)");
    return;
  }
  element.removeAttribute("fill");
}

function createCurvedTextElement(node, text, className) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("press-curved-text");
  applyClassName(wrapper, className);
  applyInlineStyles(wrapper, node.style);
  applyTextTransform(wrapper, node);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.classList.add("press-curved-text__svg");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const curveDirection = node.textOrientation === "curve-down" ? "down" : "up";
  wrapper.classList.add(`press-curved-text--${curveDirection}`);
  const pathId = `curve-${node.uid ?? Math.random().toString(36).slice(2)}`;
  const rawCurve = Number.isFinite(node.textCurve) ? node.textCurve : 12;
  const curveAmount = Math.max(0, Math.min(rawCurve * 1.6, 40));
  const fontSize = resolveTextSizePx(node) ?? TEXT_SIZE_MAP.md;
  const curvedFontScale = 1.12;
  const lineHeight = Math.max(18, fontSize * 1.1);
  const svgHeight = Math.max(42, fontSize * 2.4);
  svg.setAttribute("viewBox", `0 0 120 ${svgHeight}`);
  const startX = 6;
  const endX = 114;
  const centerX = 60;
  const baselineY = curveDirection === "down" ? svgHeight * 0.42 : svgHeight * 0.58;
  const controlY = curveDirection === "down" ? baselineY + curveAmount : baselineY - curveAmount;
  path.setAttribute("id", pathId);
  path.setAttribute("fill", "none");
  path.setAttribute("d", `M${startX},${baselineY} Q${centerX},${controlY} ${endX},${baselineY}`);

  const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
  textPath.setAttribute("href", `#${pathId}`);
  textPath.textContent = text ?? "";

  const alignment = node.align || "center";
  if (alignment === "center") {
    textEl.setAttribute("text-anchor", "middle");
    textPath.setAttribute("startOffset", "50%");
  } else if (alignment === "end") {
    textEl.setAttribute("text-anchor", "end");
    textPath.setAttribute("startOffset", "100%");
  } else {
    textEl.setAttribute("text-anchor", "start");
    textPath.setAttribute("startOffset", "0%");
  }

  wrapper.style.minHeight = `${lineHeight}px`;
  wrapper.style.height = `${lineHeight}px`;
  svg.style.height = `${svgHeight}px`;
  svg.style.width = "120%";

  applyTextFormatting(textEl, node);
  textEl.style.fontSize = `${fontSize * curvedFontScale}px`;
  applySvgTextColor(textEl, node.style ?? {}, { muted: node.muted });
  textEl.appendChild(textPath);

  svg.append(path, textEl);
  wrapper.appendChild(svg);
  return wrapper;
}

function applyTextColor(element, styles = {}) {
  if (!element || typeof styles !== "object") return;
  if (styles.color) {
    element.style.color = styles.color;
  } else {
    element.style.removeProperty("color");
  }
}

function renderField(node, context, options = {}) {
  const value = resolveBinding(node.text ?? node.value ?? node.bind, context);
  switch (node.component) {
    case "text": {
      const tag = node.textStyle ?? "p";
      const useCurved = node.textOrientation === "curve-up" || node.textOrientation === "curve-down";
      if (useCurved) {
        return createCurvedTextElement(node, value ?? "", resolveClassName(node, context) ?? "mb-0");
      }
      const el = createTextElement(tag, value ?? "", resolveClassName(node, context) ?? "mb-0");
      if (node.muted) {
        applyClassName(el, "text-body-secondary");
      }
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      applyTextTransform(el, node);
      return el;
    }
    case "badge": {
      const useCurved = node.textOrientation === "curve-up" || node.textOrientation === "curve-down";
      if (useCurved) {
        return createCurvedTextElement(
          node,
          value ?? node.label ?? "Badge",
          resolveClassName(node, context) ?? "badge text-bg-primary",
        );
      }
      const el = createTextElement(
        "span",
        value ?? node.label ?? "Badge",
        resolveClassName(node, context) ?? "badge text-bg-primary",
      );
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      applyTextTransform(el, node);
      return el;
    }
    case "list": {
      const items = resolveBinding(node.itemsBind, context) ?? node.items ?? [];
      const listTag = node.listTag ?? "ul";
      const itemTag = node.itemTag ?? "li";
      const el = document.createElement(listTag);
      applyClassName(el, resolveClassName(node, context) ?? "mb-0 ps-3 d-flex flex-column");
      if (Number.isFinite(node?.gap)) {
        el.style.display = "flex";
        el.style.flexDirection = "column";
        applyGap(el, node.gap);
      }
      const itemLayout = node.itemLayout ?? null;
      asArray(items).forEach((item, index) => {
        const li = document.createElement(itemTag);
        const itemContext = typeof item === "object" && item !== null ? { ...context, ...item } : { ...context, value: item };
        itemContext.item = item;
        itemContext.index = index;
        const itemClassRaw = node.itemClassNameBind ?? node.itemClassName ?? "";
        const itemClass =
          typeof itemClassRaw === "string" && itemClassRaw.startsWith("@")
            ? resolveBinding(itemClassRaw, itemContext) ?? ""
            : itemClassRaw;
        applyClassName(li, itemClass);
        applyTextFormatting(li, node);
        if (itemLayout) {
          li.appendChild(renderNode(itemLayout, itemContext));
        } else {
          li.textContent = item;
        }
        el.appendChild(li);
      });
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      applyTextTransform(el, node);
      return el;
    }
    case "icon": {
      const resolvedClass = resolveClassName(node, context) ?? "";
      const classTokens = resolvedClass.split(/\s+/).filter(Boolean);
      const wrapperTokens = classTokens.filter((token) => !token.startsWith("ddb-") && !token.startsWith("bi-") && token !== "bi");
      const fallbackIconTokens = classTokens.filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
      const iconClassRaw = resolveBinding(node.iconClass, context) ?? node.iconClass ?? "";
      const iconTokens = iconClassRaw.split(/\s+/).filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
      const resolvedIconTokens = iconTokens.length ? iconTokens : fallbackIconTokens;
      const wrapper = document.createElement("span");
      applyClassName(wrapper, wrapperTokens.join(" "));
      applyInlineStyles(wrapper, node.style);
      applyTextFormatting(wrapper, node);
      applyTextTransform(wrapper, node);
      if (resolvedIconTokens.length) {
        const icon = document.createElement("span");
        const needsBootstrapBase = resolvedIconTokens.some((token) => token.startsWith("bi-"));
        const iconClasses = needsBootstrapBase ? ["bi", ...resolvedIconTokens] : resolvedIconTokens;
        applyClassName(icon, iconClasses.join(" "));
        if (node?.style?.color) {
          icon.style.color = node.style.color;
        }
        wrapper.appendChild(icon);
      }
      const ariaLabel = resolveBinding(node.ariaLabel, context) ?? node.ariaLabel ?? node.label;
      if (ariaLabel) {
        wrapper.setAttribute("role", "img");
        wrapper.setAttribute("aria-label", ariaLabel);
      } else {
        wrapper.setAttribute("aria-hidden", "true");
      }
      return wrapper;
    }
    case "stat": {
      const wrapper = document.createElement("div");
      applyClassName(wrapper, resolveClassName(node, context) ?? "press-block");
      if (Number.isFinite(node?.gap)) {
        applyGap(wrapper, node.gap);
      }
      const labelValue = resolveBinding(node.label, context) ?? node.label ?? "";
      const label = createTextElement("p", labelValue, "card-meta mb-0");
      const val = createTextElement("p", value ?? "—", "mb-0 fw-semibold");
      applyInlineStyles(wrapper, node.style);
      applyTextColor(label, node.style);
      applyTextColor(val, node.style);
      applyTextFormatting(label, node);
      applyTextFormatting(val, node);
      applyTextTransform(wrapper, node);
      wrapper.append(label, val);
      return wrapper;
    }
    case "noteLines": {
      const el = document.createElement("div");
      applyClassName(el, resolveClassName(node, context) ?? "note-lines");
      applyInlineStyles(el, node.style);
      return el;
    }
    case "image": {
      const src = resolveBinding(node.url ?? node.src ?? node.text ?? node.value ?? node.bind, context);
      const el = document.createElement("div");
      applyClassName(el, resolveClassName(node, context) ?? "press-image");
      applyInlineStyles(el, node.style);
      if (typeof node.width === "number") {
        el.style.width = `${node.width}in`;
      }
      if (typeof node.height === "number") {
        el.style.height = `${node.height}in`;
      }
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = node.alt ?? "";
        img.className = "press-image__img";
        if (typeof node.width === "number") {
          img.style.width = "100%";
        }
        if (typeof node.height === "number") {
          img.style.height = "100%";
        }
        el.appendChild(img);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "press-image__placeholder";
        placeholder.textContent = node.label ?? "Image";
        el.appendChild(placeholder);
      }
      return el;
    }
    case "table": {
      const rows = resolveBinding(node.rowsBind ?? node.itemsBind, context) ?? node.rows ?? [];
      const columns = node.columns ?? [];
      const table = document.createElement("table");
      applyClassName(table, resolveClassName(node, context) ?? "press-table");
      if (Number.isFinite(node?.gap) && node.gap > 0) {
        table.style.borderCollapse = "separate";
        table.style.borderSpacing = `0 ${node.gap * GAP_UNIT_REM}rem`;
      }
      const baseText = {
        textSize: node.textSize,
        textSizeCustom: node.textSizeCustom,
        textStyles: node.textStyles,
        textOrientation: node.textOrientation,
        textAngle: node.textAngle,
        textCurve: node.textCurve,
        align: node.align,
        style: node.style ? { ...node.style } : undefined,
      };
      const headerCells = Array.isArray(node.headerCells) ? node.headerCells : [];
      if (node.showHeadings !== false && columns.length) {
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        applyClassName(headerRow, node.headerRowClassName ?? "table-header");
        if (options?.editable) {
          headerCells.length = columns.length;
          headerCells.forEach((headerCell, index) => {
            const fallbackText = columns[index]?.header ?? columns[index]?.label ?? "";
            if (!headerCell) {
              headerCells[index] = {
                type: "field",
                component: "text",
                text: fallbackText,
                ...baseText,
                textStyles: { ...(baseText.textStyles ?? {}), bold: true },
                uid: node.uid ? `${node.uid}-header-${index}` : undefined,
              };
              return;
            }
            headerCell.type = "field";
            headerCell.component = "text";
            if (headerCell.text === undefined || headerCell.text === null || headerCell.text === "") {
              headerCell.text = fallbackText;
            }
            headerCell.textStyles = { ...(baseText.textStyles ?? {}), ...(headerCell.textStyles ?? {}), bold: true };
            if (!headerCell.uid) {
              headerCell.uid = node.uid ? `${node.uid}-header-${index}` : headerCell.uid;
            }
          });
        }
        columns.forEach((column, columnIndex) => {
          const th = document.createElement("th");
          if (column.width) {
            th.style.width = typeof column.width === "number" ? `${column.width}%` : column.width;
          }
          applyClassName(th, column.className);
          const headerStyles = column.textStyle ?? {};
          const headerNode = {
            type: "field",
            component: "text",
            text: column.header ?? column.label ?? "",
            ...baseText,
            textStyles: {
              bold: typeof headerStyles.bold === "boolean" ? headerStyles.bold : true,
              italic: Boolean(headerStyles.italic),
              underline: Boolean(headerStyles.underline),
            },
            ...(column.textSize ? { textSize: column.textSize } : null),
            ...(column.textOrientation ? { textOrientation: column.textOrientation } : null),
            ...(column.textAngle ? { textAngle: column.textAngle } : null),
            ...(column.textCurve ? { textCurve: column.textCurve } : null),
            ...(column.align ? { align: column.align } : null),
            ...(column.style ? { style: { ...(baseText.style ?? {}), ...column.style } } : null),
          };
          th.appendChild(renderField(headerNode, context, options));
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
      }
      const tbody = document.createElement("tbody");
      const tableCells = Array.isArray(node.cells) ? node.cells : [];
      const getCellNodeId = (rowIndex, colIndex) => (node.uid ? `${node.uid}-cell-${rowIndex}-${colIndex}` : null);
      const createCellNode = (rowIndex, column, columnIndex) => {
        const textBinding = column.bind ?? column.text ?? column.value ?? "";
        const cellNode = {
          type: "field",
          component: column.component ?? "text",
          text: textBinding,
          ...baseText,
        };
        const uid = getCellNodeId(rowIndex, columnIndex);
        if (uid) {
          cellNode.uid = uid;
        }
        if (cellNode.component === "icon") {
          cellNode.iconClass = textBinding;
          cellNode.text = "";
          const ariaLabel = resolveBinding(column.ariaLabel, context) ?? column.ariaLabel ?? context?.name;
          cellNode.ariaLabel = ariaLabel;
        }
        return cellNode;
      };
      if (options?.editable) {
        const rowCount = asArray(rows).length;
        tableCells.length = rowCount;
        tableCells.forEach((rowCells, rowIndex) => {
          if (!Array.isArray(rowCells)) {
            tableCells[rowIndex] = [];
          }
        });
      }
      asArray(rows).forEach((row, index) => {
        const rowContext = typeof row === "object" && row !== null ? { ...context, ...row } : { ...context, value: row };
        rowContext.item = row;
        rowContext.index = index;
        const tr = document.createElement("tr");
        applyClassName(tr, node.rowClassName ?? "table-item");
        columns.forEach((column, columnIndex) => {
          const td = document.createElement("td");
          const cellContext = { ...rowContext };
          if (column.className) {
            const rawClass = column.className;
            const resolved =
              typeof rawClass === "string" && rawClass.startsWith("@")
                ? resolveBinding(rawClass, cellContext) ?? ""
                : rawClass;
            applyClassName(td, resolved);
          }
          const rowCells = Array.isArray(tableCells[index]) ? tableCells[index] : [];
          if (options?.editable && !Array.isArray(tableCells[index])) {
            tableCells[index] = rowCells;
          }
          let cellNodes = rowCells[columnIndex];
          if (!Array.isArray(cellNodes)) {
            const baseNode = cellNodes || createCellNode(index, column, columnIndex);
            cellNodes = baseNode ? [baseNode] : [];
            if (options?.editable) {
              rowCells[columnIndex] = cellNodes;
            }
          }
          if (options?.editable) {
            rowCells.length = columns.length;
          }
          if (options?.editable) {
            const slot = document.createElement("div");
            slot.className = "press-drop-slot d-flex flex-column h-100 w-100";
            slot.dataset.pressSlot = "table";
            slot.dataset.parentNodeId = node.uid ?? "";
            slot.dataset.rowIndex = String(index);
            slot.dataset.columnIndex = String(columnIndex);
            cellNodes.forEach((cellNode) => {
              slot.appendChild(renderNode(cellNode, cellContext, options));
            });
            td.appendChild(slot);
          } else {
            if (Array.isArray(cellNodes)) {
              cellNodes.forEach((cellNode) => {
                td.appendChild(renderNode(cellNode, cellContext, options));
              });
            } else {
              td.appendChild(renderNode(cellNodes, cellContext, options));
            }
          }
          if (column.width) {
            td.style.width = typeof column.width === "number" ? `${column.width}%` : column.width;
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      if (options?.editable) {
        node.cells = tableCells;
      }
      table.appendChild(tbody);
      applyInlineStyles(table, node.style);
      return table;
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
  container.dataset.pressContainer = "stack";
  applyClassName(container, "d-flex flex-column");
  applyClassName(container, resolveClassName(node, context));
  applyInlineStyles(container, node.style);
  container.style.alignSelf = "stretch";
  container.style.width = "100%";
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
  applyClassName(container, "d-grid");
  applyClassName(container, resolveClassName(node, context));
  applyInlineStyles(container, node.style);
  const columnCount = (node.columns && node.columns.length) || 1;
  if (node.templateColumns) {
    container.style.gridTemplateColumns = node.templateColumns;
  } else {
    container.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  }
  container.style.justifyItems = resolveLayoutAlignment(node);
  applyGap(container, node.gap ?? 4);
  (node.columns || []).forEach((column, columnIndex) => {
    const col = document.createElement("div");
    applyClassName(col, "w-100");
    if (column.span) {
      col.style.gridColumn = `span ${column.span}`;
    }
    if (options?.editable) {
      const slot = document.createElement("div");
      slot.className = "press-drop-slot d-flex flex-column h-100 w-100";
      slot.dataset.pressSlot = "row";
      slot.dataset.parentNodeId = node.uid ?? "";
      slot.dataset.columnIndex = String(columnIndex);
      if (column.node) {
        slot.appendChild(renderNode(column.node, context, options));
      }
      col.appendChild(slot);
    } else if (column.node) {
      col.appendChild(renderNode(column.node, context, options));
    }
    container.appendChild(col);
  });
  return container;
}

function attachEditorHooks(element, node, options) {
  if (!element || !options?.editable || !node?.uid) return element;
  element.dataset.nodeId = node.uid;
  element.dataset.nodeType = node.type;
  if (node.component) {
    element.dataset.nodeComponent = node.component;
  } else {
    delete element.dataset.nodeComponent;
  }
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
      return attachEditorHooks(renderField(node, context, options), node, options);
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
