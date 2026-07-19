import { resolveBinding } from "../../common/js/lib/bindings.js";

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

function resolveListItemText(item) {
  if (item && typeof item === "object") {
    if (Object.hasOwn(item, "name") && item.name !== undefined && item.name !== null) {
      return item.name;
    }
    const [firstKey] = Object.keys(item);
    if (firstKey) {
      return item[firstKey];
    }
    return "";
  }
  return item ?? "";
}

function applyClassName(element, className) {
  if (className) {
    element.className = [element.className, className].filter(Boolean).join(" ");
  }
}

// Callers do `resolveClassName(node, context) ?? "some-default-class"` to
// fall back to a required base class (e.g. "press-image") when a node
// doesn't specify its own — that only works if this returns null/undefined
// for "nothing to apply", not "" (which resolveBinding("", ...) legitimately
// returns for a className-less node), or the ?? never triggers and the
// element silently ends up with no class — and therefore none of that base
// class's CSS — at all.
function resolveClassName(node, context) {
  const raw = node?.className ?? node?.classNameBind ?? "";
  if (typeof raw === "string") {
    const resolved = resolveBinding(raw, context);
    return resolved || null;
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
  if (styles.fontFamily) {
    element.style.fontFamily = styles.fontFamily;
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

// Horizontal (per-cell, CSS justify-items) and vertical (row distribution,
// CSS align-content) axes for the unified grid node — same four-value
// vocabulary (start/center/end/justify) and same per-axis defaults the old
// row.align ("start") and stack.align ("justify") used, so a normalized
// legacy stack/row keeps its exact prior look with no explicit alignX/alignY
// set at all (see normalizeLegacyLayoutNode).
function resolveGridAlignX(node) {
  const alignment = node?.alignX || "start";
  if (alignment === "center") return "center";
  if (alignment === "end") return "end";
  if (alignment === "justify") return "stretch";
  return "start";
}

function resolveGridAlignY(node) {
  const alignment = node?.alignY || "justify";
  if (alignment === "center") return "center";
  if (alignment === "end") return "end";
  if (alignment === "justify") return "space-between";
  return "start";
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

// Shared by text's textAngle and any layer child's rotate — a plain
// rotate-degrees-around-center transform with no other node-specific
// knowledge, so it works on any wrapper element regardless of node type.
function applyRotate(element, degrees) {
  if (!element) return;
  const rotation = Number.isFinite(degrees) ? degrees : 0;
  if (rotation) {
    element.style.transform = `rotate(${rotation}deg)`;
    element.style.transformOrigin = "center";
  } else {
    element.style.removeProperty("transform");
    element.style.removeProperty("transform-origin");
  }
}

function applyTextTransform(element, node) {
  if (!element || !node) return;
  const { rotation } = resolveTextTransform(node);
  applyRotate(element, rotation);
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
  const bindingExpr = node.text ?? node.value ?? node.bind;
  const resolved = resolveBinding(bindingExpr, context);
  // A real "@path"/"=formula" binding that has nothing to resolve against
  // (no data loaded, or this field is genuinely blank in the loaded data)
  // falls back to showing the binding expression itself rather than nothing
  // — an empty text node has no height, which collapses any stack relying on
  // it for sizing, making the template unbuildable/uneditable without data
  // loaded. Plain static text (not a binding at all) is unaffected: for that,
  // resolveBinding already just returns the literal string unchanged.
  const isEmptyBindingResult =
    (resolved === undefined || resolved === null || resolved === "") &&
    typeof bindingExpr === "string" &&
    bindingExpr.trim().length > 0;
  const value = isEmptyBindingResult ? bindingExpr : resolved;
  switch (node.component) {
    case "text": {
      const tag = node.textStyle ?? "p";
      const useCurved = node.textOrientation === "curve-up" || node.textOrientation === "curve-down";
      if (useCurved) {
        const el = createCurvedTextElement(node, value ?? "", resolveClassName(node, context) ?? "mb-0");
        if (isEmptyBindingResult) applyClassName(el, "press-binding-placeholder");
        return el;
      }
      const el = createTextElement(tag, value ?? "", resolveClassName(node, context) ?? "mb-0");
      if (node.muted) {
        applyClassName(el, "text-body-secondary");
      }
      if (isEmptyBindingResult) {
        applyClassName(el, "press-binding-placeholder");
      }
      applyInlineStyles(el, node.style);
      applyTextFormatting(el, node);
      applyTextTransform(el, node);
      return el;
    }
    case "list": {
      const itemsBindExpr = node.itemsBind;
      const resolvedItems = resolveBinding(itemsBindExpr, context);
      // Same "show the binding expression itself" fallback as text's
      // isEmptyBindingResult above — an empty <ul> has no content and no
      // height, which made the list collapse to nothing (and become
      // unclickable/unselectable in the editor) whenever data isn't
      // loaded yet, unlike text fields which already had this fallback.
      // Only kicks in for a real, non-empty itemsBind string with nothing
      // resolved AND no static node.items to fall back on instead — a
      // genuinely empty static list is a real "no items" state, not an
      // unbound one.
      const isEmptyItemsBinding =
        (resolvedItems === undefined || resolvedItems === null || (Array.isArray(resolvedItems) && resolvedItems.length === 0)) &&
        typeof itemsBindExpr === "string" &&
        itemsBindExpr.trim().length > 0 &&
        !(Array.isArray(node.items) && node.items.length);
      const items = isEmptyItemsBinding ? [] : resolvedItems ?? node.items ?? [];
      const listTag = node.listTag ?? "ul";
      const itemTag = node.itemTag ?? "li";
      const el = document.createElement(listTag);
      applyClassName(el, resolveClassName(node, context) ?? "mb-0 ps-3 d-flex flex-column");
      if (Number.isFinite(node?.gap)) {
        el.style.display = "flex";
        el.style.flexDirection = "column";
        applyGap(el, node.gap);
      }
      if (isEmptyItemsBinding) {
        const placeholder = document.createElement(itemTag);
        placeholder.textContent = itemsBindExpr;
        applyClassName(placeholder, "press-binding-placeholder");
        applyTextFormatting(placeholder, node);
        el.appendChild(placeholder);
      }
      asArray(items).forEach((item, index) => {
        const li = document.createElement(itemTag);
        const itemContext = typeof item === "object" && item !== null ? { ...context, ...item } : { ...context, value: item };
        itemContext.item = item;
        itemContext.index = index;
        const itemClassRaw = node.itemClassNameBind ?? node.itemClassName ?? "";
        const resolvedClass =
          typeof itemClassRaw === "string" ? resolveBinding(itemClassRaw, itemContext) : itemClassRaw;
        const itemClass = resolvedClass ?? "";
        applyClassName(li, itemClass);
        applyTextFormatting(li, node);
        li.textContent = resolveListItemText(item);
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
      const iconClassText = typeof iconClassRaw === "string" ? iconClassRaw : String(iconClassRaw ?? "");
      const iconTokens = iconClassText.split(/\s+/).filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
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
      if (isEmptyBindingResult) {
        applyClassName(val, "press-binding-placeholder");
      }
      applyInlineStyles(wrapper, node.style);
      applyTextColor(label, node.style);
      applyTextColor(val, node.style);
      applyTextFormatting(label, node);
      applyTextFormatting(val, node);
      applyTextTransform(wrapper, node);
      wrapper.append(label, val);
      return wrapper;
    }
    case "image": {
      const src = resolveBinding(node.url ?? node.src ?? node.text ?? node.value ?? node.bind, context);
      const el = document.createElement("div");
      applyClassName(el, resolveClassName(node, context) ?? "press-image");
      applyInlineStyles(el, node.style);
      // Independent of the general border-color/width/style system (which
      // would also draw a visible 1px border just from setting a radius) —
      // this is purely a corner-rounding knob, defaulting to square corners
      // (matching .press-image's own CSS default) unless set.
      if (typeof node.cornerRadius === "number") {
        el.style.borderRadius = `${node.cornerRadius}px`;
      }
      // A layer child's box comes entirely from its placement wrapper (see
      // renderLayer) — applying the field's own width/height here too would
      // fix the image at a stale inch value no matter how the wrapper (and
      // therefore the visibly resized container) gets sized.
      if (!options?.insideLayer) {
        if (typeof node.width === "number") {
          el.style.width = `${node.width}in`;
        }
        if (typeof node.height === "number") {
          el.style.height = `${node.height}in`;
        }
      }
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = node.alt ?? "";
        img.className = "press-image__img";
        // .press-image__img already fills its wrapper (width/height:100% by
        // default in CSS) — only object-fit needs an explicit override here,
        // since "contain"/"fill" matter once an image is a positioned layer
        // child with its own box (e.g. a frame image that shouldn't crop).
        img.style.objectFit = ["cover", "contain", "fill"].includes(node.fit) ? node.fit : "cover";
        // focalX/focalY ("Pan X/Y") pick which part of the source image
        // object-fit anchors on — plain object-position, so "50 50"
        // (unset) matches the previous always-centered behavior exactly.
        // zoom scales past a normal Cover fit around that same point via
        // transform: above 1 crops into a specific part of an oversized
        // image instead of always seeing its center; below 1 deliberately
        // shrinks it further, e.g. for an image that's still too big even
        // after Cover — that can expose empty space around it, which is
        // the point (not guarded against) rather than a mistake.
        // .press-image's own overflow:hidden (styles.css) clips anything
        // that still overflows on the zoomed-in side.
        const hasFocalPoint = typeof node.focalX === "number" || typeof node.focalY === "number";
        const focalX = typeof node.focalX === "number" ? node.focalX : 50;
        const focalY = typeof node.focalY === "number" ? node.focalY : 50;
        if (hasFocalPoint) {
          img.style.objectPosition = `${focalX}% ${focalY}%`;
        }
        if (typeof node.zoom === "number" && node.zoom !== 1) {
          img.style.transform = `scale(${node.zoom})`;
          img.style.transformOrigin = `${focalX}% ${focalY}%`;
        }
        el.appendChild(img);
      } else {
        // The empty-state placeholder tint (.press-image--empty in CSS)
        // only belongs here, not on every image box unconditionally — a
        // loaded image with transparent areas (e.g. a pattern-library SVG)
        // would otherwise show that tint bleeding through, in both editor
        // and print.
        el.classList.add("press-image--empty");
        const placeholder = document.createElement("div");
        placeholder.className = "press-image__placeholder";
        placeholder.textContent = node.label ?? "Image";
        el.appendChild(placeholder);
      }
      return el;
    }
    case "table": {
      const rowsBindExpr = node.rowsBind ?? node.itemsBind;
      const resolvedRows = resolveBinding(rowsBindExpr, context);
      // Same "show the binding expression itself" fallback as list's
      // isEmptyItemsBinding above — an empty tbody left the table
      // effectively invisible (no rows means no height beyond the
      // header) whenever data isn't loaded yet. Only kicks in for a real,
      // non-empty rowsBind/itemsBind string with nothing resolved AND no
      // static node.rows to fall back on instead.
      const isEmptyRowsBinding =
        (resolvedRows === undefined || resolvedRows === null || (Array.isArray(resolvedRows) && resolvedRows.length === 0)) &&
        typeof rowsBindExpr === "string" &&
        rowsBindExpr.trim().length > 0 &&
        !(Array.isArray(node.rows) && node.rows.length);
      const rows = isEmptyRowsBinding ? [] : resolvedRows ?? node.rows ?? [];
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
      if (isEmptyRowsBinding) {
        const placeholderRow = document.createElement("tr");
        const placeholderCell = document.createElement("td");
        placeholderCell.colSpan = Math.max(1, columns.length);
        placeholderCell.textContent = rowsBindExpr;
        applyClassName(placeholderCell, "press-binding-placeholder");
        placeholderRow.appendChild(placeholderCell);
        tbody.appendChild(placeholderRow);
      }
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

// Unifies the old `stack` (flex column) and `row` (single-row CSS grid)
// container types into one N-rows x M-columns CSS Grid, with independent
// horizontal (alignX -> justify-items) and vertical (alignY -> align-content)
// alignment axes. `cells` is row-major: cells[row][col] is an array of raw
// nodes (0, 1, or more) — the same convention the table field component
// already uses for its own cell storage, which is why the editor's
// tree-walking helpers (findNodeById, stripNodeIds, etc.) need no changes
// to support this node type. A cell node may carry `colSpan` (> 1) to widen
// its grid column, mirroring the old row column's `span` property.
function renderGrid(node, context, options) {
  const container = document.createElement("div");
  container.dataset.pressContainer = "grid";
  applyClassName(container, "d-grid");
  applyClassName(container, resolveClassName(node, context));
  applyInlineStyles(container, node.style);
  // A migrated stack/row's className may still carry a stray "d-flex" (or
  // similar) left over from the old renderer's own base class — inline
  // display always wins over any class regardless of source order, so it
  // can't lose a cascade tie-break to a legacy class the template author
  // never meant to conflict with grid.
  container.style.display = "grid";
  const columnCount = Number.isFinite(node.columns) && node.columns > 0 ? node.columns : 1;
  container.style.gridTemplateColumns = node.templateColumns
    ? node.templateColumns
    : `repeat(${columnCount}, minmax(0, 1fr))`;
  if (node.templateRows) {
    container.style.gridTemplateRows = node.templateRows;
  }
  container.style.justifyItems = resolveGridAlignX(node);
  container.style.alignContent = resolveGridAlignY(node);
  applyGap(container, node.gap ?? 4);
  asArray(node.cells).forEach((rowCells, rowIndex) => {
    asArray(rowCells).forEach((cellNodes, columnIndex) => {
      const cell = document.createElement("div");
      applyClassName(cell, "w-100");
      // Grid items default to min-width:auto, which lets a cell's
      // content-driven intrinsic width (e.g. a long word in bound text)
      // override the track's minmax(0, 1fr) and push the cell — and
      // whatever text is inside it — past the track's actual boundary
      // instead of wrapping. Short static/placeholder text rarely hits
      // this; real bound content (a description field, say) easily does.
      cell.style.minWidth = "0";
      const firstNode = Array.isArray(cellNodes) ? cellNodes[0] : cellNodes;
      if (Number.isFinite(firstNode?.colSpan) && firstNode.colSpan > 1) {
        cell.style.gridColumn = `span ${firstNode.colSpan}`;
      }
      if (options?.editable) {
        const slot = document.createElement("div");
        slot.className = "press-drop-slot d-flex flex-column h-100 w-100";
        slot.dataset.pressSlot = "grid";
        slot.dataset.parentNodeId = node.uid ?? "";
        slot.dataset.rowIndex = String(rowIndex);
        slot.dataset.columnIndex = String(columnIndex);
        // slot is a flex column (for the editor's own drop-target sizing),
        // so its children are flex items — same min-width:auto default as
        // the grid cell above, same fix, one level deeper for the editable
        // canvas specifically.
        asArray(cellNodes).forEach((cellNode) => {
          const rendered = renderNode(cellNode, context, options);
          if (rendered?.style) rendered.style.minWidth = "0";
          slot.appendChild(rendered);
        });
        cell.appendChild(slot);
      } else {
        asArray(cellNodes).forEach((cellNode) => {
          cell.appendChild(renderNode(cellNode, context, options));
        });
      }
      container.appendChild(cell);
    });
  });
  return container;
}

// Backward compatibility for pre-grid templates: converts a legacy `stack`
// or `row` node into the equivalent `grid` shape, recursively, without
// mutating the input. Non-container nodes (field, already-grid contents'
// leaves) pass through by the same object reference — this matters because
// the table field component mutates its own `node.cells` in place in
// editable mode to persist newly-added cells back into the caller's
// (editor-owned) tree, and that only keeps working if normalization never
// clones nodes it doesn't need to convert. `align` becomes `alignX` (row) or
// `alignY` (stack) only when explicitly set — left unset otherwise so
// resolveGridAlignX/Y's own defaults reproduce the old per-type default.
// The one exception is a converted stack's alignX: a flex column's children
// stretch to fill the cross axis (CSS's flex default) unconditionally,
// completely independent of the stack's own `align` property (which only
// ever drove the main-axis justify-content) — grid's equivalent default
// ("start", matching row) would instead shrink each child to its own content
// width, silently breaking anything that relied on that full-width box (e.g.
// a centered text-align with nothing to center within), so it has to be set
// explicitly here rather than left to resolveGridAlignX's shared default.
export function normalizeLegacyLayoutNode(node) {
  if (!node || typeof node !== "object") return node;

  if (node.type === "stack") {
    const { children, align, type, ...rest } = node;
    return {
      ...rest,
      type: "grid",
      columns: 1,
      alignX: "justify",
      ...(align ? { alignY: align } : null),
      cells: asArray(children).map((child) => [[normalizeLegacyLayoutNode(child)]]),
    };
  }

  if (node.type === "row") {
    const { columns, align, type, ...rest } = node;
    const columnList = asArray(columns);
    return {
      ...rest,
      type: "grid",
      columns: columnList.length || 1,
      ...(align ? { alignX: align } : null),
      cells: [
        columnList.map((column) => {
          if (!column?.node) return [];
          const normalizedChild = normalizeLegacyLayoutNode(column.node);
          if (Number.isFinite(column.span) && column.span > 1) {
            return [{ ...normalizedChild, colSpan: column.span }];
          }
          return [normalizedChild];
        }),
      ],
    };
  }

  if (node.type === "grid" && Array.isArray(node.cells)) {
    return {
      ...node,
      cells: node.cells.map((rowCells) =>
        asArray(rowCells).map((cellNodes) => asArray(cellNodes).map((cellNode) => normalizeLegacyLayoutNode(cellNode)))
      ),
    };
  }

  if (node.type === "layer" && Array.isArray(node.placements)) {
    return {
      ...node,
      placements: node.placements.map((placement) =>
        placement?.node ? { ...placement, node: normalizeLegacyLayoutNode(placement.node) } : placement
      ),
    };
  }

  return node;
}

// Free/absolute positioning + z-stacking, additive alongside stack (flow
// column) and row (grid flow) — every child is a {node, x, y, width, height,
// z, rotate} wrapper (position metadata owned by the layer, mirroring row's
// {node, span, className} column convention) rather than living on the
// child node itself, so any node type — field, nested stack, nested layer —
// can be positioned without needing to know it's positioned.
function renderLayer(node, context, options) {
  const container = document.createElement("div");
  container.dataset.pressContainer = "layer";
  // Only meaningful when this layer turns out to be the root (checked via
  // data-press-root, set by renderLayout below) — applyAutoWidthCaps needs
  // to know whether this box's own right edge already IS the safe line
  // (origin "safe", the default — applyRootLayoutOrigin already padded the
  // root by safeInset) or is the trim/bleed edge instead, which sits
  // further out than the safe line and needs an explicit pull-in.
  container.dataset.pressOrigin = node.origin || "safe";
  applyClassName(container, "press-layer position-relative w-100 h-100");
  applyClassName(container, resolveClassName(node, context));
  applyInlineStyles(container, node.style);
  asArray(node.placements).forEach((placement, index) => {
    if (!placement?.node || shouldHide(placement.node)) return;
    const wrapper = document.createElement("div");
    applyClassName(wrapper, "position-absolute press-layer-item");
    wrapper.style.left = typeof placement.x === "number" ? `${placement.x}in` : "0";
    wrapper.style.top = typeof placement.y === "number" ? `${placement.y}in` : "0";
    // width/height take a number (inches) or a raw CSS size string (e.g.
    // "100%" to fill the layer, useful for a full-bleed background image
    // whose exact box varies by origin/insets) — omit either for intrinsic,
    // content-sized dimensions.
    if (typeof placement.width === "number") {
      wrapper.style.width = `${placement.width}in`;
    } else if (typeof placement.width === "string" && placement.width) {
      wrapper.style.width = placement.width;
    } else {
      // Auto width (no explicit size): flagged here so applyAutoWidthCaps
      // (below) can cap it once this element is actually laid out. A
      // percentage max-width (e.g. calc(100% - Xin)) looked right on paper
      // but didn't reliably resolve against this wrapper's real containing
      // block in practice, so the cap is computed from real measured
      // geometry instead, after the DOM is attached — see
      // applyAutoWidthCaps for why.
      wrapper.dataset.autoWidth = "true";
    }
    if (typeof placement.height === "number") {
      wrapper.style.height = `${placement.height}in`;
    } else if (typeof placement.height === "string" && placement.height) {
      wrapper.style.height = placement.height;
    }
    wrapper.style.zIndex = String(Number.isFinite(placement.z) ? placement.z : index);
    applyRotate(wrapper, placement.rotate);
    // Sortable's draggable selector matches direct children of the
    // press-layer container carrying [data-node-id] — the wrapper needs its
    // own copy since the actual rendered node (which also carries this via
    // attachEditorHooks) is nested one level deeper, inside this wrapper.
    if (options?.editable) {
      wrapper.dataset.nodeId = placement.node.uid ?? "";
    }
    // A layer child's box is owned by its placement wrapper (x/y/width/
    // height above) — flagging this so the image field case below skips its
    // own width/height inline override, which would otherwise fix the
    // image's own box at a stale inch value regardless of how the wrapper
    // (and therefore the visible container) gets resized.
    wrapper.appendChild(renderNode(placement.node, context, { ...options, insideLayer: true }));
    container.appendChild(wrapper);
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
    case "grid":
      return attachEditorHooks(renderGrid(node, context, options), node, options);
    case "layer":
      return attachEditorHooks(renderLayer(node, context, options), node, options);
    case "field":
      return attachEditorHooks(renderField(node, context, options), node, options);
    default:
      return document.createComment(`unsupported node: ${node.type}`);
  }
}

export function renderLayout(layout, context = {}, options = {}) {
  const normalizedLayout = normalizeLegacyLayoutNode(layout);
  const rendered = renderNode(normalizedLayout, context, options);
  // The root layout is always a flex item of .card-tile-content
  // (display:flex; flex-direction:column) — without an explicit
  // flex-basis/min-height override, a root whose own content is all
  // absolutely positioned (a root `layer`, whose placements contribute no
  // intrinsic height) hits the classic flexbox `min-height:auto`
  // content-collapse and renders far shorter than the card, even though
  // its CSS class already declares height:100%. Applies to every root
  // type, not just grid, since renderLayout only ever runs once per page
  // for the outermost node (nested containers render via renderNode
  // directly and never revisit this function).
  if (rendered?.style) {
    rendered.style.flex = "1 1 auto";
    rendered.style.minHeight = "100%";
    rendered.style.height = "100%";
  }
  if (rendered?.dataset) {
    rendered.dataset.pressRoot = "true";
  }
  if (typeof options?.onRootReady === "function") {
    options.onRootReady(rendered);
  }
  return rendered;
}

// Caps every auto-width layer placement (flagged with data-auto-width
// during renderLayer, above) at the right edge of whichever layer box it
// actually sits in — real measured geometry, not a CSS percentage, since a
// percentage max-width on an absolutely positioned, width:auto box didn't
// reliably resolve against the right containing block here in practice.
// Must run after `rootElement` is attached somewhere in the document with
// real layout (visible, or at least not display:none) — getBoundingClientRect
// on a detached or display:none tree returns all zeros, which would clamp
// every auto-width box down to nothing.
//
// safeInsetIn (inches) only applies to the ROOT layer (data-press-root) when
// its origin isn't "safe": with origin "trim"/"bleed", applyRootLayoutOrigin
// gives that box zero padding, so its own right edge is the trim (or bleed)
// edge, not the safe line — sitting further out than where text should
// actually stop. Pulling the cap in by safeInsetIn there is exact for
// "trim". For "bleed" it's an approximation (the true safe line is also
// past the per-edge bleed inset, which varies by row/col in a multi-card
// sheet and isn't available here) — better than no correction at all, but
// not pixel-exact for that origin. A root layer with origin "safe" (the
// default) needs no adjustment: applyRootLayoutOrigin already padded that
// box by safeInset, so its own edge already IS the safe line. Nested
// (non-root) layers have no card-level safe/trim/bleed concept at all, so
// they're always capped at their own box's edge, unadjusted.
export function applyAutoWidthCaps(rootElement, { safeInsetIn = 0 } = {}) {
  if (!rootElement?.querySelectorAll) return;
  const safeInsetPx = safeInsetIn * 96;
  rootElement.querySelectorAll('[data-press-container="layer"]').forEach((layerEl) => {
    const layerRect = layerEl.getBoundingClientRect();
    const needsSafeInsetPullIn =
      layerEl.dataset.pressRoot === "true" &&
      layerEl.dataset.pressOrigin !== "safe" &&
      Boolean(layerEl.dataset.pressOrigin);
    const rightEdge = layerRect.right - (needsSafeInsetPullIn ? safeInsetPx : 0);
    Array.from(layerEl.children).forEach((item) => {
      if (item.dataset.autoWidth !== "true") return;
      const itemRect = item.getBoundingClientRect();
      const maxWidthPx = rightEdge - itemRect.left;
      item.style.maxWidth = `${Math.max(0, maxWidthPx)}px`;
    });
  });
}
