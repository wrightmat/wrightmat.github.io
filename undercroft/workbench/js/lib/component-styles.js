import { TEXT_SIZE_PX, ptToPx } from "../../../common/js/lib/text-size.js";
import { findFontOptionByFamily, ensureFontLoaded } from "../../../common/js/lib/font-library.js";

export const COMPONENT_ICONS = {
  input: "tabler:forms",
  repeater: "tabler:list-details",
  image: "tabler:photo",
  icon: "tabler:icons",
  text: "tabler:typography",
  container: "tabler:layout-grid-add",
  track: "tabler:timeline",
  "select-group": "tabler:toggle-right",
  toggle: "tabler:adjustments",
};

// The four physical sides a border can be independently toggled on/off for
// (component.borderSides), matching Press's own per-side checkboxes exactly.
const BORDER_SIDES = ["top", "right", "bottom", "left"];

export function applyComponentStyles(element, component) {
  if (!element || !component) {
    return;
  }
  element.style.color = component.textColor || "";
  element.style.backgroundColor = component.backgroundColor || "";
  if (component.borderColor) {
    const width = Number.isFinite(Number(component.borderWidth)) ? Number(component.borderWidth) : 1;
    const style = component.borderStyle || "solid";
    const sides = component.borderSides && typeof component.borderSides === "object" ? component.borderSides : null;
    BORDER_SIDES.forEach((side) => {
      const enabled = sides ? sides[side] !== false : true;
      element.style.setProperty(`border-${side}-color`, component.borderColor);
      element.style.setProperty(`border-${side}-width`, enabled ? `${width}px` : "0");
      element.style.setProperty(`border-${side}-style`, enabled ? style : "none");
    });
    // Always set explicitly (even 0px) once a border is active — unlike
    // the "unset" case below, this isn't a "no opinion, inherit the
    // element's own default rounding" state: the Corner Radius field's
    // own default of 0 means "sharp corners", not "don't know/keep
    // whatever the card's default rounding was".
    const radius = Number(component.borderRadius);
    element.style.borderRadius = `${Number.isFinite(radius) && radius > 0 ? radius : 0}px`;
  } else {
    BORDER_SIDES.forEach((side) => {
      element.style.removeProperty(`border-${side}-color`);
      element.style.removeProperty(`border-${side}-width`);
      element.style.removeProperty(`border-${side}-style`);
    });
    element.style.removeProperty("border-radius");
  }
  // Raw CSS shorthand, straight through — see workbench-template-view.js's
  // createSpacingControls. Empty means "no opinion", letting whatever
  // default padding/margin the element's own CSS class provides show
  // through (see workbench/css/styles.css's .workbench-canvas-card rule).
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
  // Freeform "Classes" (Advanced) field — matches Press's own Classes
  // field exactly (common/js/lib/class-name-picker.js's suggestion list,
  // e.g. text-shadow-dark/text-shadow-light for a drop shadow). Diffed
  // against whatever THIS function applied last time (tracked via a data
  // attribute) rather than just classList.add-ing the new tokens, so
  // editing or clearing the field doesn't leave stale tokens behind — the
  // element's other classes (card chrome, Bootstrap utilities) are never
  // touched, since only tokens this function itself previously added are
  // ever removed.
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
}

export function applyTextFormatting(element, component) {
  if (!element || !component) {
    return;
  }
  const classes = [];
  // Precedence matches Press's own resolveTextSizePx exactly: an explicit
  // Font Size (pt) override always wins over the Text Size preset, which
  // wins over the "md" component default. "auto" (no custom size set)
  // means no explicit CSS override at all — the component inherits
  // whatever size is natural for its role/context (e.g. a normal input vs.
  // body text) — Workbench doesn't have Press's own shrink-to-fit
  // measurement pass "auto" otherwise implies there (deliberately: that
  // only makes sense against a fixed-size print box, which Workbench's
  // fluid layouts don't have).
  // component.fontSizeCustom != null first, not just Number.isFinite(Number(...))
  // on its own — Number(null) coerces to 0, a "finite number", which would
  // wrongly treat "explicitly cleared" the same as "set to 0pt".
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
    // Loading a font is otherwise only ever triggered by opening the Font
    // dropdown (see font-picker.js) — a component using a Google Font
    // that's never been re-selected in this session (a freshly loaded
    // template, or the same one rendering in Play/Edit view, which has no
    // Font field at all) would silently fall back to its CSS fallback
    // font without this. ensureFontLoaded no-ops for a plain/non-Google
    // family (findFontOptionByFamily won't match one anyway).
    const matchedOption = findFontOptionByFamily(family);
    if (matchedOption) {
      ensureFontLoaded(matchedOption);
    }
  } else {
    element.style.removeProperty("font-family");
  }
  if (Number.isFinite(Number(component.lineHeight))) {
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
