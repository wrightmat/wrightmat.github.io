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
  // Every border property is set directly, unconditionally, from its own
  // data field — no "if borderStyle then apply the rest" branch. CSS
  // itself already treats border-style: none/unset as no visible border
  // regardless of what border-color/border-width say, so there's no need
  // for JS to separately decide whether these should apply — just reflect
  // whatever's stored, on every property, independently. (setProperty with
  // an empty string is equivalent to removeProperty, so an unset
  // borderColor/borderStyle correctly clears back to the browser's own
  // default here, not "".)
  const borderColor = component.borderColor || "";
  const borderStyle = component.borderStyle || "";
  // Safety fallback, not a business default — CSS needs a real number to
  // draw a border with at all. Only visible once borderStyle is actually a
  // real value; harmless otherwise (a width with no style renders nothing).
  const width = Number.isFinite(Number(component.borderWidth)) ? Number(component.borderWidth) : 1;
  const sides = component.borderSides && typeof component.borderSides === "object" ? component.borderSides : null;
  BORDER_SIDES.forEach((side) => {
    const enabled = sides ? sides[side] !== false : true;
    element.style.setProperty(`border-${side}-color`, borderColor);
    element.style.setProperty(`border-${side}-width`, enabled ? `${width}px` : "0");
    element.style.setProperty(`border-${side}-style`, enabled ? borderStyle : "none");
  });
  // Corner rounding is independent of whether a border line renders at all
  // — it also shapes the card's own background/shadow (see
  // workbench/css/styles.css's .workbench-canvas-card comment) — so it's
  // read directly here too, not gated on border state.
  const radius = Number(component.borderRadius);
  element.style.borderRadius = `${Number.isFinite(radius) && radius > 0 ? radius : 0}px`;
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
  // Align Items — CSS align-self, how THIS component positions itself
  // within its own parent's cross axis (a Container zone, most commonly;
  // a no-op wherever the parent isn't flex/grid). Deliberately a separate
  // field/property from component.align (Text Align, plain text-align,
  // "Text" section) — the two used to be easy to conflate for Container
  // specifically, whose own zone-level alignment derives align-items AND
  // text-align from that one field; this is a distinct per-component
  // concept, not a replacement for that. Blank means CSS's own real
  // default (align-self: auto, i.e. inherit the parent's align-items) —
  // no inline style at all, same "blank = no override" convention as
  // fontFamily/padding/margin above.
  const alignSelf = ALIGN_SELF_MAP[component.alignSelf] || "";
  if (alignSelf) {
    element.style.alignSelf = alignSelf;
  } else {
    element.style.removeProperty("align-self");
  }
  // align-self only ever repositions a flex item that's narrower than its
  // available space — but every component's own wrapper (.template-component/
  // .workbench-canvas-card, workbench/css/styles.css) is unconditionally
  // width:100% *in that stylesheet rule* (needed there for the Container-
  // column flex-shrink chain, see that rule's own comment), so with no
  // override the wrapper always fills its cell and there's nothing left
  // for Start/Center/End to visibly move. removeProperty alone can't touch
  // this — nothing here has ever set an inline width, so there's nothing
  // to remove; a real inline value is needed to actually outrank the class
  // rule. Only overridden for a real, non-stretch alignSelf choice —
  // Auto/blank and Stretch both still want the default full-width
  // behavior, so their branch clears any previously-set inline override
  // instead (this component's OWN past selection, not the stylesheet's).
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
  // component.lineHeight != null first, not just Number.isFinite(Number(...))
  // on its own — Number(null) coerces to 0, a "finite number", which set
  // line-height:0 (collapsing the text to zero height, effectively
  // invisible) on every component by default, since lineHeight was null
  // until a component explicitly set one. Same bug shape, same fix, as
  // fontSizeCustom above. No hidden fallback constant here on purpose: the
  // Line Height field is the one source of truth (createComponent now
  // seeds new components with an explicit, visible 1.3 — see
  // workbench-template-view.js) — an unset/null value (only reachable on
  // templates saved before that field existed) means "no override", same
  // as fontFamily above, and genuinely falls back to the browser's own
  // default rather than a value invisible in the inspector.
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
  // "start" (the default — every component's own align field is seeded
  // with "start", so there's no way to tell "explicitly chosen" apart from
  // "never touched") deliberately adds no class at all, rather than
  // Bootstrap's .text-start. .text-start/.text-center/.text-end are all
  // generated with !important, so forcing .text-start here unconditionally
  // defeated a Container's own Alignment setting (an inherited text-align
  // on an ancestor zone — see workbench-template-view.js's
  // resolveContainerZoneTextAlign) for every Text component nested inside
  // it, since "start" is also every component's default. Leaving it unset
  // is a no-op outside a Container (browser's own default text-align is
  // already "start"/left) and correctly lets the inherited value through
  // when nested.
  if (component.align === "center") {
    element.classList.add("text-center");
  } else if (component.align === "end") {
    element.classList.add("text-end");
  } else if (component.align === "justify") {
    element.style.textAlign = "justify";
  }
}
