import { resolveBinding } from "../../common/js/lib/bindings.js";
import { TEXT_SIZE_PX as TEXT_SIZE_MAP } from "../../common/js/lib/text-size.js";

const GAP_UNIT_REM = 0.25;
// Explicit fallback line-height for every text-bearing element (see
// applyTextFormatting) — a unitless multiplier of the element's own
// font-size, same convention CSS itself uses for line-height.
const DEFAULT_LINE_HEIGHT = 1.3;

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
  if (node?.textSize === "auto") {
    return null;
  }
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

// Same numeric spacer scale as Gap (node.gap), but for the space AFTER the
// whole component instead of the space it puts between its own internal
// items — Gap doesn't affect a sibling that comes next in normal flow at
// all, which is exactly the gap (no pun intended) this fills, the same
// role node.style.lineHeight fills for a single text field's own vertical
// rhythm, just one level up (between components, not between lines).
function applySpaceAfter(element, node) {
  if (Number.isFinite(node?.spaceAfter)) {
    element.style.marginBottom = `${node.spaceAfter * GAP_UNIT_REM}rem`;
  } else {
    element.style.removeProperty("margin-bottom");
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
  if (node?.textSize === "auto") {
    // Flagged for applyAutoFontSizing (a post-render measurement pass, same
    // pattern as applyAutoWidthCaps) to shrink-to-fit once real layout
    // exists — nothing meaningful can be measured yet at build time. height
    // 100%/overflow hidden only actually constrains anything when a real
    // ancestor (e.g. a Layer placement's sized wrapper) bounds this
    // element; against an ordinary auto-height parent, height:100%
    // resolves to auto per CSS and this is a no-op, so it's always safe to
    // set unconditionally.
    element.dataset.pressAutofit = "true";
    element.style.height = "100%";
    element.style.overflow = "hidden";
    element.style.removeProperty("font-size");
  } else {
    delete element.dataset.pressAutofit;
    element.style.removeProperty("height");
    element.style.removeProperty("overflow");
    const size = resolveTextSizePx(node);
    if (size) {
      element.style.fontSize = `${size}px`;
    }
  }
  if (node?.component !== "icon") {
    // Explicit on every text-bearing element, block or inline alike,
    // rather than left to the inherited cascade — a <span> (Inline toggle
    // on) and a <p> (off) otherwise compute line-height from whatever
    // ancestor context each happens to inherit through, which don't
    // necessarily match depth-for-depth (e.g. the first repeater item's
    // extra drop-slot wrapper vs later items with none). Setting it here
    // unconditionally, on every node.component !== "icon" text formatting
    // pass, guarantees inline and block text always compute the exact same
    // way. DEFAULT_LINE_HEIGHT is only the fallback — node.style.lineHeight
    // (the inspector's "Line height" field) always wins when set.
    element.style.lineHeight = String(
      typeof node?.style?.lineHeight === "number" ? node.style.lineHeight : DEFAULT_LINE_HEIGHT
    );
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
    element.style.removeProperty("line-height");
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

// Renders a `repeater` field: a fully author-built "item template"
// (node.cells, always exactly one row, one node[] per column — populated by
// dragging ordinary components into it and binding each one individually,
// exactly like grid/table cells already work) cloned once per item
// resolved from node.itemsBind/node.items, plus a fully independent,
// literal header row (node.headerCells — never inferred from cells'
// position). columns<=1 stacks items vertically; columns>1 renders a real
// <table>. The only built-in convenience beyond that is an optional
// per-item `decorator` (bullet/number/custom symbol-or-binding) — there is
// no other preset "kind" of repeater; everything else about what an item
// shows is ordinary cell content the author builds and binds themselves.
function renderRepeaterCells(cellNodes, itemContext, options, container) {
  asArray(cellNodes).forEach((cellNode) => {
    container.appendChild(renderNode(cellNode, itemContext, options));
  });
}

function renderRepeaterDecorator(node, itemContext, index) {
  const decorator = node?.decorator;
  if (!decorator || !decorator.type || decorator.type === "none") return null;
  const el = document.createElement("span");
  applyClassName(el, "press-repeater-decorator");
  if (decorator.type === "bullet") {
    el.textContent = "•";
  } else if (decorator.type === "number") {
    el.textContent = `${index + 1}.`;
  } else {
    // "custom" — same literal-or-@binding duality every other text-ish
    // field in Press already uses, resolved per-item so it can pull from
    // the item's own data (e.g. an icon/rank field) just as easily as a
    // fixed symbol like "→".
    const raw = decorator.text ?? "";
    const resolved = typeof raw === "string" && raw.trim().startsWith("@") ? resolveBinding(raw, itemContext) : raw;
    el.textContent = resolved ?? "";
  }
  return el;
}

function renderRepeater(node, context, options) {
  const itemsBindExpr = node.itemsBind;
  const resolvedItems = resolveBinding(itemsBindExpr, context);
  // Same "show the binding expression itself" fallback list/table used —
  // an unresolved binding renders as a visible placeholder row rather than
  // silently collapsing to nothing when no data is loaded yet. A genuinely
  // empty static array (no binding at all) is a real "no items" state, not
  // an unbound one, so it does NOT get this placeholder treatment.
  const isEmptyItemsBinding =
    (resolvedItems === undefined || resolvedItems === null || (Array.isArray(resolvedItems) && resolvedItems.length === 0)) &&
    typeof itemsBindExpr === "string" &&
    itemsBindExpr.trim().length > 0 &&
    !(Array.isArray(node.items) && node.items.length);
  const items = isEmptyItemsBinding ? [] : resolvedItems ?? node.items ?? [];
  const columns = Number.isFinite(node.columns) && node.columns > 0 ? node.columns : 1;
  const templateRow = Array.isArray(node.cells) && Array.isArray(node.cells[0]) ? node.cells[0] : [];
  const headerRow =
    node.showHeader && Array.isArray(node.headerCells) && Array.isArray(node.headerCells[0]) ? node.headerCells[0] : null;
  const hasDecorator = Boolean(node.decorator?.type && node.decorator.type !== "none");
  // Editable mode always shows at least one representative item, even with
  // nothing resolved — items now render as real node trees (not flattened
  // text), so there's no separate placeholder string to attach to the way
  // list/table used to; item 0 of the template itself, rendered unbound
  // (each field falling back to its own binding-expression placeholder), IS
  // the visible placeholder that keeps the template editable on an empty
  // canvas.
  const resolvedList = items.length ? asArray(items) : options?.editable ? [undefined] : [];
  const itemContextFor = (item, index) =>
    item && typeof item === "object" ? { ...context, ...item, item, index } : { ...context, value: item, item, index };
  const buildSlot = (rowLabel, columnIndex) => {
    const slot = document.createElement("div");
    // Plain block flow, not d-flex/flex-column: grid/table cell slots use
    // flex-column so stacked children default to a vertical stack, but
    // that forces every child onto its own flex "row" regardless of the
    // child's own display — which silently overrides an inline text
    // field's span back into block-like stacking. Ordinary block flow
    // already stacks block-level children vertically on its own (that's
    // just what block layout does), while still letting inline children
    // (text fields with the Inline toggle on) flow together on one line —
    // exactly the behavior an item's cell content needs.
    slot.className = "press-drop-slot w-100";
    // A block element wrapping inline content contributes its own
    // inherited line-height as an invisible "strut" that the line box's
    // actual height can never fall below (CSS2.1 §10.8) — since this slot
    // just inherits Bootstrap's ~1.5 default from its ancestors, that strut
    // silently won over any SMALLER line-height set on an inline (span)
    // text child, making the Line height field look like it did nothing.
    // Zeroing it here means the strut never competes; the actual text
    // element's own line-height (set in applyTextFormatting) is always
    // what governs, same as it already does for a plain block <p> (which
    // has no separate wrapper contributing a competing strut at all).
    slot.style.lineHeight = "0";
    slot.dataset.pressSlot = "repeater";
    slot.dataset.slotRow = rowLabel;
    slot.dataset.parentNodeId = node.uid ?? "";
    slot.dataset.columnIndex = String(columnIndex);
    return slot;
  };

  if (columns <= 1) {
    const listEl = document.createElement("div");
    applyClassName(listEl, headerRow ? "d-flex flex-column" : resolveClassName(node, context) ?? "d-flex flex-column");
    if (Number.isFinite(node?.gap)) {
      applyGap(listEl, node.gap);
    } else {
      listEl.style.gap = "0.25rem";
    }
    if (isEmptyItemsBinding && !options?.editable) {
      const placeholder = document.createElement("div");
      placeholder.textContent = itemsBindExpr;
      applyClassName(placeholder, "press-binding-placeholder");
      listEl.appendChild(placeholder);
    }
    resolvedList.forEach((item, index) => {
      const itemContext = itemContextFor(item, index);
      const row = document.createElement("div");
      applyClassName(row, "d-flex align-items-start gap-2");
      const itemClassRaw = node.itemClassNameBind ?? node.itemClassName ?? "";
      const resolvedClass = typeof itemClassRaw === "string" ? resolveBinding(itemClassRaw, itemContext) : itemClassRaw;
      applyClassName(row, resolvedClass ?? "");
      const decoratorEl = renderRepeaterDecorator(node, itemContext, index);
      if (decoratorEl) row.appendChild(decoratorEl);
      const content = document.createElement("div");
      applyClassName(content, "flex-grow-1");
      // Same strut-neutralizing reason as buildSlot's own line-height:0 —
      // this is the direct wrapper for non-first items' cell content (no
      // slot in between for those), so it's the one contributing a
      // competing strut in that case.
      content.style.lineHeight = "0";
      if (options?.editable && index === 0) {
        const slot = buildSlot("item", 0);
        renderRepeaterCells(templateRow.flat(), itemContext, options, slot);
        content.appendChild(slot);
      } else {
        renderRepeaterCells(templateRow.flat(), itemContext, options, content);
      }
      row.appendChild(content);
      listEl.appendChild(row);
    });
    applyInlineStyles(listEl, node.style);
    applyTextTransform(listEl, node);
    if (!headerRow) {
      applySpaceAfter(listEl, node);
      return listEl;
    }
    const wrapper = document.createElement("div");
    applyClassName(wrapper, resolveClassName(node, context) ?? "d-flex flex-column gap-1");
    applySpaceAfter(wrapper, node);
    const headerBlock = document.createElement("div");
    applyClassName(headerBlock, "press-repeater-header fw-semibold");
    if (options?.editable) {
      const slot = buildSlot("header", 0);
      renderRepeaterCells(headerRow.flat(), context, options, slot);
      headerBlock.appendChild(slot);
    } else {
      // Not editable mode -> no buildSlot wrapper in between, so this is
      // the direct wrapper here too — same strut fix.
      headerBlock.style.lineHeight = "0";
      renderRepeaterCells(headerRow.flat(), context, options, headerBlock);
    }
    wrapper.append(headerBlock, listEl);
    return wrapper;
  }

  // columns > 1: a real <table>. An active decorator adds one extra
  // leading column (its own <td>/<th>) ahead of the author's own columns;
  // the header row's leading cell is always empty since headers aren't
  // items and don't get a decorator.
  const table = document.createElement("table");
  applyClassName(table, resolveClassName(node, context) ?? "press-table");
  if (Number.isFinite(node?.gap) && node.gap > 0) {
    table.style.borderCollapse = "separate";
    table.style.borderSpacing = `0 ${node.gap * GAP_UNIT_REM}rem`;
  }
  if (node.templateColumns) {
    const colgroup = document.createElement("colgroup");
    if (hasDecorator) colgroup.appendChild(document.createElement("col"));
    node.templateColumns
      .split(/\s+/)
      .filter(Boolean)
      .forEach((width) => {
        const col = document.createElement("col");
        col.style.width = width;
        colgroup.appendChild(col);
      });
    table.appendChild(colgroup);
  }
  if (headerRow) {
    const thead = document.createElement("thead");
    const headerTr = document.createElement("tr");
    applyClassName(headerTr, "table-header");
    if (hasDecorator) headerTr.appendChild(document.createElement("th"));
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const th = document.createElement("th");
      const cellNodes = headerRow[columnIndex];
      if (options?.editable) {
        const slot = buildSlot("header", columnIndex);
        renderRepeaterCells(cellNodes, context, options, slot);
        th.appendChild(slot);
      } else {
        th.style.lineHeight = "0";
        renderRepeaterCells(cellNodes, context, options, th);
      }
      headerTr.appendChild(th);
    }
    thead.appendChild(headerTr);
    table.appendChild(thead);
  }
  const tbody = document.createElement("tbody");
  if (isEmptyItemsBinding && !options?.editable) {
    const placeholderRow = document.createElement("tr");
    const placeholderCell = document.createElement("td");
    placeholderCell.colSpan = Math.max(1, columns + (hasDecorator ? 1 : 0));
    placeholderCell.textContent = itemsBindExpr;
    applyClassName(placeholderCell, "press-binding-placeholder");
    placeholderRow.appendChild(placeholderCell);
    tbody.appendChild(placeholderRow);
  }
  resolvedList.forEach((item, index) => {
    const itemContext = itemContextFor(item, index);
    const tr = document.createElement("tr");
    applyClassName(tr, node.rowClassName ?? "table-item");
    if (hasDecorator) {
      const decoratorCell = document.createElement("td");
      const decoratorEl = renderRepeaterDecorator(node, itemContext, index);
      if (decoratorEl) decoratorCell.appendChild(decoratorEl);
      tr.appendChild(decoratorCell);
    }
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const td = document.createElement("td");
      const cellNodes = templateRow[columnIndex];
      if (options?.editable && index === 0) {
        const slot = buildSlot("item", columnIndex);
        renderRepeaterCells(cellNodes, itemContext, options, slot);
        td.appendChild(slot);
      } else {
        td.style.lineHeight = "0";
        renderRepeaterCells(cellNodes, itemContext, options, td);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  applyInlineStyles(table, node.style);
  applySpaceAfter(table, node);
  return table;
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
    case "repeater":
      return renderRepeater(node, context, options);
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
      const ariaLabel = resolveBinding(node.ariaLabel, context) ?? node.ariaLabel ?? node.label;
      if (resolvedIconTokens.length) {
        const icon = document.createElement("span");
        const needsBootstrapBase = resolvedIconTokens.some((token) => token.startsWith("bi-"));
        const iconClasses = needsBootstrapBase ? ["bi", ...resolvedIconTokens] : resolvedIconTokens;
        applyClassName(icon, iconClasses.join(" "));
        if (node?.style?.color) {
          icon.style.color = node.style.color;
        }
        wrapper.appendChild(icon);
      } else {
        // Same reasoning as the image field's own empty state: with no
        // glyph at all, a bare inline <span> has zero content and
        // collapses to nothing, making it permanently unselectable on
        // canvas the moment its icon class gets cleared — there's no
        // other handle left to click. This keeps a visible, clickable box
        // regardless of whether an icon is actually set.
        applyClassName(wrapper, "press-icon--empty");
        const placeholder = document.createElement("span");
        placeholder.className = "press-icon__placeholder";
        placeholder.textContent = node.label ?? "Icon";
        wrapper.appendChild(placeholder);
      }
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
      applySpaceAfter(wrapper, node);
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
  applySpaceAfter(container, node);
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
      // A block element wrapping inline content contributes its own
      // inherited line-height as an invisible "strut" the line box's
      // actual height can never fall below (CSS2.1 §10.8) — cell/slot just
      // inherit Bootstrap's ~1.5 default from their ancestors, which
      // otherwise wins over anything smaller set on an inline (Inline
      // toggle on) text child and makes cells with the same explicit
      // line-height still render with subtly different spacing depending
      // on exactly what's nested how deep inside them. Zeroing it here
      // means each text node's own line-height is always what governs.
      cell.style.lineHeight = "0";
      const firstNode = Array.isArray(cellNodes) ? cellNodes[0] : cellNodes;
      if (Number.isFinite(firstNode?.colSpan) && firstNode.colSpan > 1) {
        cell.style.gridColumn = `span ${firstNode.colSpan}`;
      }
      if (options?.editable) {
        const slot = document.createElement("div");
        // Plain block flow, not d-flex/flex-column: that forced every
        // child onto its own flex "row" regardless of the child's own
        // display, silently overriding an inline text field's span back
        // into block-like stacking. Ordinary block flow already stacks
        // block-level children vertically on its own — that's just what
        // block layout does — while still letting inline children (Inline
        // toggle on) flow together on one line.
        slot.className = "press-drop-slot h-100 w-100";
        slot.style.lineHeight = "0";
        slot.dataset.pressSlot = "grid";
        slot.dataset.parentNodeId = node.uid ?? "";
        slot.dataset.rowIndex = String(rowIndex);
        slot.dataset.columnIndex = String(columnIndex);
        // Same min-width:auto default as the grid cell above, same fix,
        // one level deeper for the editable canvas specifically.
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

  // Legacy `list`/`table` field components -> the unified `repeater`
  // component (see renderRepeater above). Both collapse onto the same
  // cells[row][col]/headerCells[row][col] convention grid already uses, so
  // this is a data reshape, not a new rendering concept.
  if (node.type === "field" && node.component === "list") {
    const { component, items, itemsBind, listTag, itemTag, itemClassNameBind, itemClassName, ...rest } = node;
    // Old list markers came from the HTML tag (<ul> default = bulleted,
    // <ol> = numbered, anything else — e.g. templates that used "div" to
    // strip markers entirely — meant no marker). The new repeater has no
    // list-tag concept at all; a `decorator` carries the same visual
    // forward instead, as an independent per-item convenience rather than
    // a tag choice baked into the whole component.
    const decoratorType = !listTag || listTag === "ul" ? "bullet" : listTag === "ol" ? "number" : "none";
    return {
      ...rest,
      type: "field",
      component: "repeater",
      columns: 1,
      showHeader: false,
      decorator: { type: decoratorType },
      ...(itemsBind ? { itemsBind } : null),
      ...(Array.isArray(items) ? { items } : null),
      ...(itemClassNameBind ? { itemClassNameBind } : null),
      ...(itemClassName ? { itemClassName } : null),
      // Old list items were flattened via a "show item.name for objects,
      // the raw value otherwise" rule. The new per-item binding context
      // already distinguishes these the same way (primitives land at
      // @value, objects get their own keys spread directly into scope),
      // but one binding string can't express both — @value is the default
      // here since every palette default (and the overwhelmingly common
      // real case) is a plain string array; a list that was bound to an
      // array of objects needs its migrated cell binding changed to
      // whichever key it wants (e.g. @name) once opened.
      cells: [[[{ type: "field", component: "text", text: "@value" }]]],
    };
  }

  if (node.type === "field" && node.component === "table") {
    const {
      component,
      rowsBind,
      itemsBind,
      rows,
      columns: columnDefs,
      cells,
      showHeadings,
      headerCells: legacyHeaderCells,
      rowClassName,
      ...rest
    } = node;
    const columnList = Array.isArray(columnDefs) ? columnDefs : [];
    return {
      ...rest,
      type: "field",
      component: "repeater",
      columns: columnList.length || 1,
      showHeader: showHeadings !== false,
      ...(rowsBind ?? itemsBind ? { itemsBind: rowsBind ?? itemsBind } : null),
      ...(Array.isArray(rows) ? { items: rows } : null),
      ...(rowClassName ? { rowClassName } : null),
      headerCells: [
        columnList.map((column) => [
          {
            type: "field",
            component: "text",
            text: column?.header ?? column?.label ?? "",
            textStyles: { bold: true },
          },
        ]),
      ],
      // The item template is a single row, built from column 0's already-
      // materialized cell content when present (row-major cells[0][col]),
      // falling back to a fresh node synthesized from the column's own
      // bind/text/value alias otherwise. Any per-row divergence a user may
      // have built up in the old table (independently customizing row 3's
      // cell but not row 1's, since old table materialized a real node per
      // (row, col) pair the first time the editor rendered it) collapses
      // to this single shared template — the new model has exactly one
      // item template for every row, by design.
      cells: [
        columnList.map((column, columnIndex) => {
          const existing = Array.isArray(cells) && Array.isArray(cells[0]) ? cells[0][columnIndex] : null;
          if (Array.isArray(existing) && existing.length) {
            return existing.map((cellNode) => normalizeLegacyLayoutNode(cellNode));
          }
          const textBinding = column?.bind ?? column?.text ?? column?.value ?? "";
          return [{ type: "field", component: column?.component ?? "text", text: textBinding }];
        }),
      ],
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
    if (!placement?.node) return;
    // Same per-card override merge as renderNode's node-level one, one
    // level up: a placement's own x/y/width/height/rotate/z can be
    // overridden independently of (and in addition to) its node's
    // properties. shouldHide is checked against the *node* override here
    // (not just the base node) so "hide this on just this card" — a
    // node-level override — also skips creating the wrapper entirely,
    // matching renderNode's own hidden check for the non-layer case.
    const nodeOverride = options?.nodeOverrides?.[placement.node.uid]?.node;
    const effectiveChildNode = nodeOverride ? { ...placement.node, ...nodeOverride } : placement.node;
    if (shouldHide(effectiveChildNode)) return;
    const placementOverride = options?.nodeOverrides?.[placement.node.uid]?.placement;
    const effectivePlacement = placementOverride ? { ...placement, ...placementOverride } : placement;
    const wrapper = document.createElement("div");
    applyClassName(wrapper, "position-absolute press-layer-item");
    wrapper.style.left = typeof effectivePlacement.x === "number" ? `${effectivePlacement.x}in` : "0";
    wrapper.style.top = typeof effectivePlacement.y === "number" ? `${effectivePlacement.y}in` : "0";
    // width/height take a number (inches) or a raw CSS size string (e.g.
    // "100%" to fill the layer, useful for a full-bleed background image
    // whose exact box varies by origin/insets) — omit either for intrinsic,
    // content-sized dimensions.
    if (typeof effectivePlacement.width === "number") {
      wrapper.style.width = `${effectivePlacement.width}in`;
    } else if (typeof effectivePlacement.width === "string" && effectivePlacement.width) {
      wrapper.style.width = effectivePlacement.width;
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
    if (typeof effectivePlacement.height === "number") {
      wrapper.style.height = `${effectivePlacement.height}in`;
    } else if (typeof effectivePlacement.height === "string" && effectivePlacement.height) {
      wrapper.style.height = effectivePlacement.height;
    }
    wrapper.style.zIndex = String(Number.isFinite(effectivePlacement.z) ? effectivePlacement.z : index);
    applyRotate(wrapper, effectivePlacement.rotate);
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
  if (options.nodeOverrides?.[node.uid]) {
    element.classList.add("press-component--unique");
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
  if (!node) return document.createComment("empty");
  // Single merge point for a per-card "Make Unique" override (options.
  // nodeOverrides, threaded down from renderCardGrid/renderChipGrid) — any
  // node property (text, style, className, fit, hidden, ...) can be
  // overridden here without the type-specific renderers below needing to
  // know overrides exist at all; they just receive `effective` in place
  // of `node`. Dispatch itself (the switch below) and attachEditorHooks'
  // identity attributes (uid/type/component) always use the real `node`,
  // never the merged one — overriding what KIND of thing a component is
  // isn't a real use case, only its properties.
  const override = options?.nodeOverrides?.[node.uid]?.node;
  const effective = override ? { ...node, ...override } : node;
  if (shouldHide(effective)) return document.createComment("empty");
  switch (node.type) {
    case "grid":
      return attachEditorHooks(renderGrid(effective, context, options), node, options);
    case "layer":
      return attachEditorHooks(renderLayer(effective, context, options), node, options);
    case "field":
      return attachEditorHooks(renderField(effective, context, options), node, options);
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

const AUTO_FIT_MIN_PX = 6;
const AUTO_FIT_MAX_PX = 72;

// Post-render measurement pass (same pattern as applyAutoWidthCaps above,
// called right after it — a text field's width needs to already be final
// before shrink-to-fit measures against it) for any text field with
// textSize:"auto" (flagged data-press-autofit by applyTextFormatting).
// Binary-searches the largest font size that doesn't overflow the
// element's own box — which only bounds anything when a real ancestor
// (typically a Layer placement's sized wrapper) constrains it; run
// unconditionally otherwise, it's a no-op against an auto-height parent.
export function applyAutoFontSizing(rootElement) {
  if (!rootElement?.querySelectorAll) return;
  rootElement.querySelectorAll('[data-press-autofit="true"]').forEach((el) => {
    const fits = (sizePx) => {
      el.style.fontSize = `${sizePx}px`;
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    if (!fits(AUTO_FIT_MIN_PX)) {
      el.style.fontSize = `${AUTO_FIT_MIN_PX}px`;
      return;
    }
    let low = AUTO_FIT_MIN_PX;
    let high = AUTO_FIT_MAX_PX;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (fits(mid)) {
        low = mid;
      } else {
        high = mid;
      }
    }
    el.style.fontSize = `${low}px`;
  });
}

// Editor-only warning badge (never called for the print stack — clipping
// itself is unconditional, from card-tile-content's own overflow:hidden in
// templates.js, and applies regardless of whether this ever runs) for a
// card/chip whose content overflows its own box, usually a bound text
// field that's too long for the space. Run after applyAutoWidthCaps/
// applyAutoFontSizing so it measures against their already-finalized
// layout, not pre-shrink/pre-cap sizes. scrollHeight/scrollWidth report
// the true (untruncated) content size regardless of the element's own
// overflow:hidden, so this still detects overflow even though it's
// already being visually clipped.
export function applyOverflowIndicators(rootElement) {
  if (!rootElement?.querySelectorAll) return;
  rootElement.querySelectorAll(".card-tile, .chip-tile").forEach((tile) => {
    const content = tile.querySelector(".card-tile-content, .chip-circle");
    const isOverflowing = Boolean(
      content && (content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1)
    );
    tile.classList.toggle("press-tile--overflowing", isOverflowing);
    if (isOverflowing) {
      tile.title = "Content overflows this card — some of it is clipped and won't print.";
    } else {
      tile.removeAttribute("title");
    }
  });
}
