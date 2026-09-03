import { TEXT_SIZE_PX, ptToPx } from "../../../common/js/lib/text-size.js";
import { findFontOptionByFamily, ensureFontLoaded } from "../../../common/js/lib/font-library.js";

// Canonical implementation now lives in common/js/lib/component-icons.js
// (shared with Press, and with Workbench's own palette markup — see
// workbench/index.html's init-time icon sync) — re-exported here so
// existing call sites in this tool don't need to change their import path.
export { COMPONENT_ICONS } from "../../../common/js/lib/component-icons.js";

// The four physical sides a border can be independently toggled on/off for
// (component.borderSides), matching Press's own per-side checkboxes exactly.
const BORDER_SIDES = ["top", "right", "bottom", "left"];

// component.alignSelf ("start"/"center"/"end"/"stretch", createAlignItemsControl
// in workbench-template-view.js) -> the real CSS align-self value.
const ALIGN_SELF_MAP = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };

// Shared between the Template editor and Play/Edit view's Image renderers
// (see workbench/js/lib/component-renderers.js's renderImageContent) — was
// previously duplicated byte-for-byte in both workbench-template-view.js
// and workbench-character-view.js.
export function applyImageStyles(img, component) {
  img.style.objectFit = component.fit === "fill" ? "fill" : component.fit === "contain" ? "contain" : "cover";
  const width = typeof component.width === "string" ? component.width.trim() : "";
  const height = typeof component.height === "string" ? component.height.trim() : "";
  img.style.width = width || "100%";
  img.style.height = height || "auto";
  const cornerRadius = Number(component.cornerRadius);
  img.style.borderRadius = Number.isFinite(cornerRadius) && cornerRadius > 0 ? `${cornerRadius}px` : "";
  const focalX = Number.isFinite(Number(component.focalX)) ? Number(component.focalX) : 50;
  const focalY = Number.isFinite(Number(component.focalY)) ? Number(component.focalY) : 50;
  img.style.objectPosition = `${focalX}% ${focalY}%`;
  const zoom = Number(component.zoom);
  if (Number.isFinite(zoom) && zoom !== 1) {
    img.style.transform = `scale(${zoom})`;
    img.style.transformOrigin = `${focalX}% ${focalY}%`;
  } else {
    img.style.transform = "";
    img.style.transformOrigin = "";
  }
}

export function applyComponentStyles(element, component) {
  if (!element || !component) {
    return;
  }
  element.style.color = component.textColor || "";
  element.style.backgroundColor = component.backgroundColor || "";
  // Every border property is set unconditionally from its own data field —
  // CSS already treats border-style:none as no visible border regardless of
  // color/width, so nothing here needs an "if borderStyle" branch.
  // setProperty("") == removeProperty, so an unset value clears to default.
  const borderColor = component.borderColor || "";
  const borderStyle = component.borderStyle || "";
  // Fallback so CSS has a real number to draw with; harmless when there's
  // no borderStyle (a width with no style renders nothing).
  const width = Number.isFinite(Number(component.borderWidth)) ? Number(component.borderWidth) : 1;
  const sides = component.borderSides && typeof component.borderSides === "object" ? component.borderSides : null;
  BORDER_SIDES.forEach((side) => {
    const enabled = sides ? sides[side] !== false : true;
    element.style.setProperty(`border-${side}-color`, borderColor);
    element.style.setProperty(`border-${side}-width`, enabled ? `${width}px` : "0");
    element.style.setProperty(`border-${side}-style`, enabled ? borderStyle : "none");
  });
  // Corner rounding also shapes the card's own background/shadow, so it's
  // applied independently of whether a border line renders at all.
  const radius = Number(component.borderRadius);
  element.style.borderRadius = `${Number.isFinite(radius) && radius > 0 ? radius : 0}px`;
  // Raw CSS shorthand (see workbench-template-view.js's createSpacingControls).
  // Empty means "no opinion" — the element's own CSS class default shows through.
  if (typeof component.padding === "string" && component.padding.trim()) {
    element.style.padding = component.padding.trim();
  } else {
    element.style.removeProperty("padding");
  }
  if (typeof component.margin === "string" && component.margin.trim()) {
    element.style.margin = component.margin.trim();
  } else {
    element.style.removeProperty("margin");
  }
  // Freeform "Classes" (Advanced) field — matches Press's Classes field
  // (class-name-picker.js's suggestion list). Diffed against what this
  // function applied last time (tracked via a data attribute), so editing
  // or clearing the field doesn't leave stale tokens on top of the
  // element's other classes (card chrome, Bootstrap utilities).
  const previousClassTokens = (element.dataset.workbenchClassName || "").split(/\s+/).filter(Boolean);
  if (previousClassTokens.length) {
    element.classList.remove(...previousClassTokens);
  }
  const nextClassTokens =
    typeof component.className === "string" ? component.className.trim().split(/\s+/).filter(Boolean) : [];
  if (nextClassTokens.length) {
    element.classList.add(...nextClassTokens);
    element.dataset.workbenchClassName = nextClassTokens.join(" ");
  } else {
    delete element.dataset.workbenchClassName;
  }
  // Align Items — how THIS component positions itself in its parent's
  // cross axis (a Container zone; a no-op outside flex/grid). Deliberately
  // separate from component.align (plain text-align) — a Container's own
  // zone alignment derives both align-items AND text-align from one field,
  // but this is a distinct per-component concept. Blank = CSS default
  // (align-self: auto), same "blank = no override" convention as above.
  const alignSelf = ALIGN_SELF_MAP[component.alignSelf] || "";
  if (alignSelf) {
    element.style.alignSelf = alignSelf;
  } else {
    element.style.removeProperty("align-self");
  }
  // align-self only repositions a flex item narrower than its available
  // space, but every component wrapper is width:100% in its stylesheet
  // rule (needed for the Container-column flex-shrink chain) — with no
  // override there's nothing left for Start/Center/End to visibly move.
  // A real inline width is needed to outrank that class rule; Auto/blank
  // and Stretch clear it back to the default full-width behavior.
  if (alignSelf && alignSelf !== "stretch") {
    element.style.width = "fit-content";
  } else {
    element.style.removeProperty("width");
  }
}

export function applyTextFormatting(element, component) {
  if (!element || !component) {
    return;
  }
  const classes = [];
  // Precedence matches Press's resolveTextSizePx: explicit Font Size (pt)
  // wins over Text Size preset, which wins over the "md" default. "auto"
  // means no CSS override — Workbench has no Press-style shrink-to-fit
  // pass, since that only makes sense against a fixed-size print box.
  // `!= null` first — Number(null) coerces to 0 (a "finite number"), which
  // would wrongly treat "explicitly cleared" as "set to 0pt".
  const customPx =
    component.fontSizeCustom != null && Number.isFinite(Number(component.fontSizeCustom))
      ? ptToPx(Number(component.fontSizeCustom))
      : null;
  if (customPx) {
    element.style.fontSize = `${customPx}px`;
  } else if (component.textSize === "auto") {
    element.style.removeProperty("font-size");
  } else {
    const size = component.textSize || "md";
    element.style.fontSize = `${TEXT_SIZE_PX[size] ?? TEXT_SIZE_PX.md}px`;
  }
  if (typeof component.fontFamily === "string" && component.fontFamily.trim()) {
    const family = component.fontFamily.trim();
    element.style.fontFamily = family;
    // Loading a font is otherwise only triggered by opening the Font
    // dropdown (font-picker.js) — a Google Font never re-selected this
    // session (a freshly loaded template, or Play/Edit view with no Font
    // field) would silently fall back to its CSS fallback without this.
    const matchedOption = findFontOptionByFamily(family);
    if (matchedOption) {
      ensureFontLoaded(matchedOption);
    }
  } else {
    element.style.removeProperty("font-family");
  }
  // Same `!= null` bug shape/fix as fontSizeCustom above — Number(null)
  // coercing to 0 would set line-height:0 (collapsing text to zero height)
  // by default. No hidden fallback constant: Line Height is seeded
  // explicitly (workbench-template-view.js's createComponent, 1.3); an
  // unset value (only on pre-existing templates) means "no override" and
  // falls back to the browser default, not an inspector-invisible constant.
  if (component.lineHeight != null && Number.isFinite(Number(component.lineHeight))) {
    element.style.lineHeight = String(Number(component.lineHeight));
  } else {
    element.style.removeProperty("line-height");
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
  // "start" (every component's own default) deliberately adds no class —
  // Bootstrap's .text-start/.text-center/.text-end are !important, so
  // forcing .text-start unconditionally would defeat a Container's own
  // inherited Alignment (resolveContainerZoneTextAlign in
  // workbench-template-view.js) for every nested Text component.
  if (component.align === "center") {
    element.classList.add("text-center");
  } else if (component.align === "end") {
    element.classList.add("text-end");
  } else if (component.align === "justify") {
    element.style.textAlign = "justify";
  }
}
