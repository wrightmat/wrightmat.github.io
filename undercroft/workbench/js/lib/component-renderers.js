import { applyTextFormatting, applyImageStyles } from "./component-styles.js";
import { resolveIconClassList } from "../../../common/js/lib/icon-picker.js";
import { createLabeledField } from "./component-layout.js";
import { createReferenceChip } from "../../../common/js/lib/library-reference.js";
// Repository's own renderMarkdown, reused as-is (same precedent as
// Crucible's Notes preview). Called with no options — no resolveWikiLink,
// no interactive dice/encounter/macro/checkbox handlers — since a
// Feature/Spell description has no legitimate use for Journal-specific
// extensions; they just stay inert if the text happens to contain that syntax.
import { renderMarkdown } from "../../../repository/js/lib/markdown.js";

// Once a component has a real `label` property (every component created
// since that field existed does, default ""), an explicitly-cleared label
// must stay cleared, not fall through to `name` just because "" is falsy.
// `name` is only a fallback for pre-`label`-field saved data. Mirrors
// workbench-template-view.js's own getComponentLabel (duplicated here —
// this module has no import path to that page-level function).
function resolveFieldLabel(component) {
  if (!component) return "";
  if (Object.prototype.hasOwnProperty.call(component, "label")) {
    return typeof component.label === "string" ? component.label.trim() : "";
  }
  return typeof component.name === "string" ? component.name.trim() : "";
}

// Shared per-component-type content renderers used by BOTH
// workbench-template-view.js (Template editor canvas) and
// workbench-character-view.js (Play/Edit view) — reconsolidating what used
// to be a single renderer that got split apart and drifted (missing
// formatting calls, mismatched CSS classes, fields wired up in only one
// file). One function per component type, taking the component plus a
// small `ctx` object holding only what legitimately differs between an
// authoring preview and a live bound view (value resolution, repeater-item
// context, child recursion, editability/onChange). Chrome
// (type-icon/binding-pill/delete button) and the dropzone-vs-static-children
// recursion boundary stay in each page's own card-wrapper function.

// component.align mapped to a real flex align-items value for a Container
// zone's content. Only repositions a child narrower than its available
// space — Text's own content stays width:100% (so ellipsis truncation has
// a box to truncate against), making align-items a no-op for it;
// resolveContainerZoneTextAlign below is what moves TEXT specifically.
export function resolveContainerZoneAlignItems(component) {
  const align = component.align || "start";
  if (align === "center") return "center";
  if (align === "end") return "flex-end";
  if (align === "justify") return "stretch";
  return "";
}

// text-align is INHERITED — set once here it cascades through every
// descendant regardless of nested flex/grid levels or width, unlike
// align-items above (which needs a box narrower than width:100%). This is
// what actually centers/right-aligns Text content, since Text's own box
// deliberately stays full-width.
export function resolveContainerZoneTextAlign(component) {
  const align = component.align || "start";
  if (align === "center") return "center";
  if (align === "end") return "right";
  if (align === "justify") return "justify";
  return "";
}

// Column count for CSS grid-template-columns — NOT how many zones exist (a
// Container can have multiple rows AND columns; the browser auto-wraps
// into however many rows the zone count needs). "rows" is a legacy
// containerType value meaning "single column"; 9 matches
// workbench-template-view.js's own MAX_CONTAINER_COLUMNS constant.
export function resolveContainerColumns(component) {
  if (component.containerType === "rows") return 1;
  const raw = Number(component.columns);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 9) : 2;
}

// Container — the grid/tabs skeleton, label, alignment, and gap are
// shared; zone COMPUTATION (ctx.getZones — Template editor derives zones
// from rows/columns and migrates legacy keys; Play/Edit just reads
// existing saved zones) and per-zone CHILD RENDERING (ctx.renderZone —
// drag-and-drop dropzone chrome vs. a plain static cell) stay injected,
// since those genuinely differ. Tab-state
// (ctx.getActiveTabIndex/setActiveTabIndex) also stays injected — each
// page persists it differently, but the shared function owns the DOM
// swap-on-click.
export function renderContainerContent(component, ctx) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-3";
  // No `|| component.name` fallback — `name` is only the internal
  // layer-panel identifier, not a display default; falling back to it made
  // clearing the Label field impossible (it kept showing "Container").
  const fallbackLabel = component.label || "";
  const labelText = ctx.resolveValue(component, fallbackLabel);
  if (labelText) {
    const heading = document.createElement("div");
    // No text-body-secondary — !important, silently overrode
    // applyTextFormatting's component.textColor. This heading IS the whole
    // text Container ever shows, so it has to respect textColor.
    heading.className = "fw-semibold";
    heading.textContent = String(labelText);
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }

  const zones = ctx.getZones(component);
  if (!zones.length) {
    if (typeof ctx.renderEmptyPlaceholder === "function") {
      wrapper.appendChild(ctx.renderEmptyPlaceholder());
    }
    return wrapper;
  }

  const alignItems = resolveContainerZoneAlignItems(component);
  const textAlign = resolveContainerZoneTextAlign(component);
  const gap = Number.isFinite(Number(component.gap)) ? Number(component.gap) : 16;

  if (component.containerType === "tabs") {
    const tabsWrapper = document.createElement("div");
    tabsWrapper.className = "d-flex flex-column gap-3";
    const nav = document.createElement("div");
    // template-container-tabs-nav (styles.css) gives this a higher stacking
    // position than the Template editor's absolutely-positioned card
    // header, which can otherwise swallow clicks meant for these buttons.
    nav.className = "d-flex flex-wrap gap-2 template-container-tabs-nav";
    const body = document.createElement("div");
    body.className = "d-flex flex-column";
    if (alignItems) body.style.alignItems = alignItems;
    if (textAlign) body.style.textAlign = textAlign;

    // A Source-driven tabs container authored with an `activeTabBinding`
    // locks to exactly one tab in Play view — every OTHER tab button
    // removed, not just disabled. The locked tab's label still shows as a
    // static button in the same nav row, so there's a visible indication
    // of which tab's content is showing. Only workbench-character-view.js's
    // ctx implements this hook — the Template editor's preview ctx has no
    // such function, so every tab stays switchable while authoring.
    const lockedIndex =
      typeof ctx.resolveLockedTabIndex === "function" ? ctx.resolveLockedTabIndex(component, zones) : null;
    if (Number.isInteger(lockedIndex) && lockedIndex >= 0 && lockedIndex < zones.length) {
      const zone = zones[lockedIndex];
      const lockedButton = document.createElement("button");
      lockedButton.type = "button";
      // Not `.active` — that fills with Bootstrap's grey secondary
      // background, implying a pressed/selected control. Plain outline
      // reads as a static label instead.
      lockedButton.className = "btn btn-outline-secondary btn-sm";
      // Not `.disabled = true` — Bootstrap's disabled style forces reduced
      // opacity. `pointer-events: none` blocks interaction without that.
      lockedButton.style.pointerEvents = "none";
      lockedButton.tabIndex = -1;
      lockedButton.setAttribute("aria-disabled", "true");
      // A <button> has Bootstrap's own non-inherited outline-button color,
      // which would otherwise win over the component's resolved textColor.
      lockedButton.style.color = component.textColor || "";
      lockedButton.textContent = zone.label || `Tab ${lockedIndex + 1}`;
      nav.appendChild(lockedButton);
      body.appendChild(
        ctx.renderZone(component, zone, {
          label: zone.label,
          hint: `Drop components for ${zone.label || "this tab"}`,
          alignItems,
          textAlign,
          zoneIndex: lockedIndex,
        })
      );
      tabsWrapper.append(nav, body);
      wrapper.appendChild(tabsWrapper);
      return wrapper;
    }

    const renderBody = (index) => {
      body.innerHTML = "";
      const zone = zones[index] || zones[0];
      if (!zone) return;
      body.appendChild(
        ctx.renderZone(component, zone, {
          label: zone.label,
          hint: `Drop components for ${zone.label || "this tab"}`,
          alignItems,
          textAlign,
          // Only meaningful for tabs — which resolved Source entry (if any,
          // tabLabelsSourceBinding) this tab corresponds to, so
          // ctx.renderZone can give its children a per-tab item context.
          zoneIndex: index,
        })
      );
    };

    let currentIndex = Math.min(Math.max(ctx.getActiveTabIndex(component, zones.length), 0), zones.length - 1);
    zones.forEach((zone, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn btn-outline-secondary btn-sm${index === currentIndex ? " active" : ""}`;
      button.textContent = zone.label || `Tab ${index + 1}`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (index === currentIndex) return;
        currentIndex = index;
        ctx.setActiveTabIndex(component, index);
        Array.from(nav.children).forEach((btn, i) => btn.classList.toggle("active", i === index));
        renderBody(index);
      });
      nav.appendChild(button);
    });
    renderBody(currentIndex);
    tabsWrapper.append(nav, body);
    wrapper.appendChild(tabsWrapper);
    return wrapper;
  }

  // "grid" — the only remaining variant.
  const grid = document.createElement("div");
  grid.className = "template-container-grid";
  const templateColumns = typeof component.templateColumns === "string" ? component.templateColumns.trim() : "";
  const templateRows = typeof component.templateRows === "string" ? component.templateRows.trim() : "";
  grid.style.gridTemplateColumns = templateColumns || `repeat(${resolveContainerColumns(component)}, minmax(0, 1fr))`;
  if (templateRows) {
    grid.style.gridTemplateRows = templateRows;
  }
  grid.style.gap = `${gap}px`;
  zones.forEach((zone) => {
    grid.appendChild(
      ctx.renderZone(component, zone, {
        label: zone.label,
        hint: `Drop components into ${zone.label}`,
        alignItems,
        textAlign,
      })
    );
  });
  wrapper.appendChild(grid);
  return wrapper;
}

// Text — the first type migrated onto the shared ctx pattern. `ctx` carries
// only what legitimately differs between preview and live view:
// `resolveValue(component, fallback)` wraps each page's own resolver
// (character-view.js's live/formula/roll-tracking path;
// template-view.js's sample-data path plus its "show the raw
// binding/formula text when unresolved" authoring behavior) behind one
// shared shape.
//
// Base class is unconditionally "workbench-text-content", never
// "fw-semibold"/"text-body" — both used to be hardcoded here, forcing
// every Text component bold regardless of its own Bold toggle and
// overriding component.textColor via !important.
//
// Fallback text (component.text || label || name || "Text") is
// unconditional — template-view.js used to render nothing for an unbound
// Text component; character-view.js already showed a placeholder. Unified
// on the more informative behavior.
//
// A bound value carrying literal markup (e.g. Notes imported as HTML) used
// to show up as visible "<p>...</p>" — .textContent has no notion of
// markup. Text is a generic "show me this scalar" component, not a
// rich-text editor, so stripping tags is the safe universal fix — switching
// to innerHTML would start interpreting an ordinary "<3 HP remaining>" as
// markup instead of literal text.
function stripHtmlTags(value) {
  if (typeof value !== "string" || !/<[a-z][\s\S]*>/i.test(value)) {
    return value;
  }
  const scratch = document.createElement("div");
  scratch.innerHTML = value;
  return (scratch.textContent || "").replace(/\s+/g, " ").trim();
}

// A bound value shaped {refKind, refId, name} (Character.subclass, a
// promoted Feature/Spell repeater row, or any future reference field) —
// refId empty means nothing to link to yet, falling back to plain text
// like any other unlinked reference in this suite.
export function isReferenceValue(value) {
  return Boolean(value && typeof value === "object" && value.refKind && value.refId && value.name);
}

// Recognizes a reference-shaped bound value and renders it as a
// hover-preview chip automatically — a value-shape check at render time,
// not a template-authoring flag, the same way Repository's markdown
// pipeline recognizes a `` `kind:name` `` code span. Works for a
// top-level Text component and, for free, any Text component inside a
// Repeater item whose item resolves to a reference-shaped value.
// `ctx.dataManager` is optional: absent (Template editor's preview, no
// live record to look up) falls back to the bare name as plain text.
export function renderTextContent(component, ctx) {
  const fallback = component.text || component.label || component.name || "Text";
  const resolved = ctx.resolveValue(component, fallback);
  const text = document.createElement("div");
  text.className = "workbench-text-content";
  // Two ways a Text component ends up reference-shaped: bound directly to
  // the reference object (resolved is already {refKind,refId,name}), or —
  // far more common, since most Text cells bind to one sub-field like
  // "@name" — a plain string whose SIBLING refKind/refId live on the same
  // parent object (a Features/Spells repeater row's name cell).
  // ctx.resolveReference (optional) covers the second case.
  const reference = isReferenceValue(resolved)
    ? resolved
    : typeof ctx.resolveReference === "function"
      ? ctx.resolveReference(component)
      : null;
  if (reference) {
    applyTextFormatting(text, component);
    // Always `reference.name` (the real catalog name), never a
    // `customName` override — showing one thing in View mode and a
    // different thing in Edit was confirmed real, confusing UX. A custom
    // nickname gets its own dedicated field/column instead (see
    // tpl.5e.flex-basic.json's Inventory Repeater), shown consistently.
    if (ctx.dataManager) {
      text.appendChild(
        createReferenceChip({ kind: reference.refKind, id: reference.refId, name: reference.name, dataManager: ctx.dataManager })
      );
    } else {
      text.textContent = reference.name;
    }
    return text;
  }
  // Opt-in per component (component.richText, off by default). stripHtmlTags
  // is skipped here — markdown syntax isn't HTML, so it'd never fire, but
  // running it first would risk mangling a literal "<" in prose (e.g. "<5
  // feet") before marked ever sees it.
  if (component.richText) {
    applyTextFormatting(text, component);
    text.appendChild(renderMarkdown(resolved != null ? String(resolved) : ""));
    return text;
  }
  text.textContent = resolved != null ? stripHtmlTags(String(resolved)) : "";
  applyTextFormatting(text, component);
  return text;
}

// An old saved template may still have `component.src` instead of
// `component.url` — read as a fallback, written to `.url` on every edit
// going forward, so an existing Image keeps showing with no migration step.
export function resolveImageUrl(component) {
  return component.url || component.src || "";
}

// Image — url/src, like Icon's iconClass, is itself the binding-or-literal
// string, plus a `formula` field for the "=" case, checked first via
// ctx.evaluateFormula. ctx.resolveBindableString resolves an "@path"
// against whichever data source the calling page provides (live record,
// preview sample data, or — with itemContext set — one repeater item).
export function renderImageContent(component, ctx) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  wrapper.style.overflow = "hidden";
  const label = component.label || component.name;
  if (label) {
    const heading = document.createElement("div");
    // Same fix as Container's heading — no text-body-secondary (!important,
    // overrides component.textColor).
    heading.className = "fw-semibold";
    heading.textContent = label;
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
  }
  const formula = typeof component.formula === "string" ? component.formula.trim() : "";
  let resolvedUrl;
  if (formula) {
    resolvedUrl = typeof ctx.evaluateFormula === "function" ? ctx.evaluateFormula(formula) : undefined;
  } else {
    const rawUrl = resolveImageUrl(component);
    resolvedUrl = rawUrl.startsWith("@") ? ctx.resolveBindableString(rawUrl) : rawUrl;
  }
  if (resolvedUrl) {
    const image = document.createElement("img");
    image.alt = component.alt || label || "Image";
    image.src = resolvedUrl;
    applyImageStyles(image, component);
    wrapper.appendChild(image);
  } else {
    // No URL at all — Press's own CSS-only empty-state placeholder
    // (press/css/styles.css's .press-image--empty/.press-image__placeholder,
    // already loaded here via workbench/index.html), not a fake image
    // fetched from an external service.
    const placeholderBox = document.createElement("div");
    placeholderBox.className = "press-image press-image--empty";
    applyImageStyles(placeholderBox, component);
    const placeholderText = document.createElement("div");
    placeholderText.className = "press-image__placeholder";
    placeholderText.textContent = label || "Image";
    placeholderBox.appendChild(placeholderText);
    wrapper.appendChild(placeholderBox);
  }
  return wrapper;
}

// Icon — iconClass is itself the binding-or-literal string (no separate
// generic Binding field). A `formula` field (same convention Text/Input
// use) takes priority when set, letting a template author compute the
// icon class dynamically (e.g. ="ddb-"+@type), since iconClass's own
// binding mode only resolves a single bare @path. `ctx.evaluateFormula` is
// optional — the Template editor's preview doesn't provide it, so a
// formula-driven icon there falls through to the empty-state placeholder.
// role="img"/aria-label (or aria-hidden) is now shared — previously only
// applied in the live renderer.
export function renderIconContent(component, ctx) {
  const wrapper = document.createElement("span");
  wrapper.className = "d-inline-flex align-items-center";
  const formula = typeof component.formula === "string" ? component.formula.trim() : "";
  let resolvedClass;
  if (formula) {
    resolvedClass = typeof ctx.evaluateFormula === "function" ? ctx.evaluateFormula(formula) : undefined;
  } else {
    const raw = typeof component.iconClass === "string" ? component.iconClass.trim() : "";
    resolvedClass = raw.startsWith("@") ? ctx.resolveBindableString(raw) : raw;
  }
  const classes = resolveIconClassList(resolvedClass);
  if (classes.length) {
    const icon = document.createElement("span");
    icon.className = classes.join(" ");
    if (component.textColor) icon.style.color = component.textColor;
    wrapper.appendChild(icon);
  } else {
    wrapper.classList.add("press-icon--empty");
    const placeholder = document.createElement("span");
    placeholder.className = "press-icon__placeholder";
    placeholder.textContent = component.label || "Icon";
    wrapper.appendChild(placeholder);
  }
  const ariaLabel = component.ariaLabel || "";
  if (ariaLabel) {
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", ariaLabel);
  } else {
    wrapper.setAttribute("aria-hidden", "true");
  }
  return wrapper;
}

// One shared canonical labelClasses array for every Input variant, in both
// pages — previously each page (and character-view.js's radio/checkbox
// branch) used a different set. No text-body-secondary — it's !important,
// so it silently overrode component.textColor.
const INPUT_LABEL_CLASSES = ["form-label", "fw-semibold", "mb-0"];

// Input — the DOM shape is identical between preview and live view; only
// editability, value resolution/write-back, and combat-binding decoration
// differ, via `ctx`:
//   resolveValue(component, fallback) — live: resolveComponentValue's
//     formula/binding resolution; preview: passes fallback through.
//   editable(component) — live: the real isEditable/itemContext check;
//     preview: always false.
//   onChange(component, value) — live: updateBinding/setRepeaterItemValue;
//     preview: no-op.
//   resolveOptions(component) — Select's option list (live:
//     resolveSelectionOptions; preview: resolveSelectPreviewOptions).
//   resolveChoiceOptions(component) — Radio/Checkbox's option list (live:
//     as-authored; preview: falls back to 3 sample options).
//   decorate(el, component, meta) — live: assignBindingMetadata; preview: no-op.
//   wrapControl(input, component, { labelText, editable }) — final control
//     node passed to createLabeledField; live: combat-binding
//     spinner/roll-overlay wrapping; preview: identity.
//   wrapEmptyOptions(field) — optional, preview only: "no options
//     configured" hint on an empty Select.
//   plainReadOnly(component) — optional, only true when !editable; live:
//     Play view's "not Editable in Play reads as plain text, not a
//     grayed-out disabled control" rule; preview: absent (no "Play view"
//     concept there). Centralized here since Textarea/Select never went
//     through the page-specific wrapControl this used to live in.
export function renderInputContent(component, ctx) {
  const labelText = resolveFieldLabel(component);
  const variant = (component.variant || "text").toLowerCase();
  const componentUid = component?.uid || "";
  const editable = ctx.editable(component);
  const plain = !editable && typeof ctx.plainReadOnly === "function" && ctx.plainReadOnly(component);
  const resolvedValue = ctx.resolveValue(component, component.value ?? "");
  const setValue = (value) => ctx.onChange(component, value);
  const decorate = (el, meta) => {
    if (typeof ctx.decorate === "function") ctx.decorate(el, component, meta);
  };

  // A reference-shaped SIBLING value — a plain-text Input bound to
  // `something.name` alongside `something.refKind`/`something.refId` —
  // shows the same hover-preview chip Text gets, when not editable.
  // Deliberately NOT resolvedValue itself: that stays the plain bound
  // string, so editing keeps targeting it through the ordinary text-input
  // branch, unaffected — purely a read-mode display swap, opt-in via
  // ctx.resolveReference. `variant === "text"` or `"select"` only — a
  // Select (e.g. Character's own Class field) still renders as plain
  // read-only text when not editable, so the same swap applies there too.
  if (!editable && (variant === "text" || variant === "select") && typeof ctx.resolveReference === "function") {
    const reference = ctx.resolveReference(component);
    if (reference && ctx.dataManager) {
      const wrapper = document.createElement("div");
      // Always reference.name, never customName — same reasoning as
      // renderTextContent's identical reference-chip branch.
      wrapper.appendChild(
        createReferenceChip({ kind: reference.refKind, id: reference.refId, name: reference.name, dataManager: ctx.dataManager })
      );
      decorate(wrapper);
      return createLabeledField({
        component,
        control: wrapper,
        labelText,
        labelTag: "label",
        labelClasses: INPUT_LABEL_CLASSES,
        applyFormatting: applyTextFormatting,
      });
    }
  }

  // Guard against binding this Input to array/object-shaped data. Confirmed
  // real data-loss bug: every variant below eventually turns resolvedValue
  // into a single string — an array of objects silently became the literal
  // text "[object Object],[object Object]", and the next keystroke wrote
  // that back over the real array. Checkbox is the one exception — it
  // already expects and round-trips an array of selected values.
  if (variant !== "checkbox" && resolvedValue !== null && typeof resolvedValue === "object") {
    const warning = document.createElement("div");
    warning.className = "text-danger small fst-italic";
    warning.textContent = "This field is bound to list/object data — use a Repeater instead of an Input for this binding.";
    decorate(warning);
    return createLabeledField({
      component,
      control: warning,
      labelText,
      labelTag: "label",
      labelClasses: INPUT_LABEL_CLASSES,
      applyFormatting: applyTextFormatting,
    });
  }

  // Bootstrap's .form-control/.form-select/.form-check-label set their own
  // non-inherited color/background — an ancestor's inline color never
  // reaches these elements through inheritance. applyComponentStyles only
  // colors the outer wrapper card, so the actual control needs its own
  // direct application of the same already-resolved fields.
  const applyControlColors = (el) => {
    el.style.color = component.textColor || "";
    el.style.backgroundColor = component.backgroundColor || "";
  };

  // A Button doesn't bind/display a value like other variants —
  // `ctx.runButtonAction` (inert in the Template preview, real in
  // Play/Edit) runs on click instead. No createLabeledField wrapper —
  // self-labeled, same precedent as Toggle. Face content prefers an icon,
  // then an image, then Label text, then a bare "Button" fallback — an
  // icon-only roll button needs at least one to render even with no Label.
  if (variant === "button") {
    const button = document.createElement("button");
    button.type = "button";
    // Bare .btn — Border section fields (borderStyle/Color/Width/Radius,
    // read generically by applyComponentStyles) give it its outline the
    // same authored way any other component type does.
    button.className = "btn btn-sm d-inline-flex align-items-center justify-content-center gap-1";
    applyControlColors(button);
    // Applied to the button itself, not a separate label span — the
    // button's face text IS this component's content.
    applyTextFormatting(button, component);
    const width = typeof component.width === "string" ? component.width.trim() : "";
    const height = typeof component.height === "string" ? component.height.trim() : "";
    if (width) button.style.width = width;
    if (height) button.style.height = height;
    // .btn-sm's padding is sized for a text label alongside the glyph — an
    // icon/image-only face (no Label) only needs enough room to keep the
    // glyph off the border.
    if (!labelText) {
      button.style.padding = "2px";
    }
    // A bare icon glyph just inherits .btn-sm's ~14px text size, cramped
    // against the button's box — scaled here off Width/Height instead so
    // the glyph fills the box; a floor keeps it legible on a small button.
    // px/rem/em only — a %, or anything unparsed, falls back to no-size-set.
    const parseBoxPx = (raw) => {
      const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(raw);
      if (!match) return null;
      const num = Number(match[1]);
      const unit = match[2] || "px";
      return unit === "px" ? num : num * 16;
    };
    const boxDimensPx = [parseBoxPx(width), parseBoxPx(height)].filter((n) => Number.isFinite(n) && n > 0);
    // Icon-only face: sized to fill the box, independent of Text Size.
    // Icon+label face: sits next to real text, so it scales WITH that text
    // via an em value tracking the button's own resolved font-size.
    const iconFontSize = labelText
      ? "1.15em"
      : `${boxDimensPx.length ? Math.max(16, Math.min(Math.min(...boxDimensPx) - 6, 44)) : 22}px`;
    // Same formula/binding/literal precedence renderIconContent's iconClass
    // and renderImageContent's url resolve with — Button's Icon/Image
    // fields ARE those exact fields, so "=formula"/"@path" must resolve
    // the same way here.
    const componentFormula = typeof component.formula === "string" ? component.formula.trim() : "";
    let resolvedIconClass;
    if (componentFormula) {
      resolvedIconClass = typeof ctx.evaluateFormula === "function" ? ctx.evaluateFormula(componentFormula) : undefined;
    } else {
      const rawIconClass = typeof component.iconClass === "string" ? component.iconClass.trim() : "";
      resolvedIconClass = rawIconClass.startsWith("@") && typeof ctx.resolveBindableString === "function" ? ctx.resolveBindableString(rawIconClass) : rawIconClass;
    }
    let hasVisual = false;
    const classes = resolveIconClassList(resolvedIconClass);
    if (classes.length) {
      const icon = document.createElement("span");
      icon.className = classes.join(" ");
      icon.style.fontSize = iconFontSize;
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
      hasVisual = true;
    }
    if (!hasVisual) {
      let resolvedUrl;
      if (componentFormula) {
        resolvedUrl = typeof ctx.evaluateFormula === "function" ? ctx.evaluateFormula(componentFormula) : undefined;
      } else {
        const rawUrl = typeof component.url === "string" ? component.url.trim() : "";
        resolvedUrl = rawUrl.startsWith("@") && typeof ctx.resolveBindableString === "function" ? ctx.resolveBindableString(rawUrl) : rawUrl;
      }
      if (resolvedUrl) {
        const img = document.createElement("img");
        img.src = resolvedUrl;
        img.alt = "";
        img.className = "template-button-image";
        button.appendChild(img);
        hasVisual = true;
      }
    }
    if (labelText) {
      const text = document.createElement("span");
      text.textContent = labelText;
      button.appendChild(text);
    } else if (!hasVisual) {
      button.textContent = "Button";
    }
    if (!labelText) {
      // No visible label — same "aria-label carries what the visible text
      // can't" pattern every icon-only toolbar button follows.
      button.setAttribute("aria-label", (component.name || "Button").trim() || "Button");
    }
    button.disabled = !editable;
    button.addEventListener("click", () => {
      if (!editable) return;
      ctx.runButtonAction?.(component);
    });
    decorate(button);
    // Returned wrapped, not bare — applyComponentStyles's width handling
    // unconditionally sets/clears inline width based on alignSelf alone,
    // with no "leave it alone" case, which would stomp Button's own
    // explicit width/height above. Toggle avoids this the same way
    // (returns a wrapping `field`, sizes its inner glyph directly).
    // Confirmed real bug: a Button as a bare Repeater-item node had its own
    // Width/Height silently cleared on every render.
    const wrapper = document.createElement("span");
    wrapper.className = "d-inline-flex";
    wrapper.appendChild(button);
    return wrapper;
  }

  if (variant === "select") {
    const currentValue = resolvedValue == null ? "" : String(resolvedValue);
    const options = ctx.resolveOptions(component);
    // Play view, not Editable — a disabled <select> still looks like an
    // inert dropdown (native arrow, boxed border), so this reads the
    // CHOSEN option's label as plain text instead.
    if (plain) {
      const selected = options.find((option) => option.value === currentValue);
      const text = document.createElement("div");
      text.className = "form-control-plaintext";
      applyControlColors(text);
      text.textContent = selected ? selected.label || selected.value : "";
      decorate(text);
      return createLabeledField({
        component,
        control: text,
        labelText,
        labelTag: "label",
        labelClasses: INPUT_LABEL_CLASSES,
        applyFormatting: applyTextFormatting,
      });
    }
    const select = document.createElement("select");
    select.className = "form-select";
    applyControlColors(select);
    if (componentUid) select.id = `${componentUid}-select`;
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label || option.value;
      if (opt.value === currentValue) opt.selected = true;
      select.appendChild(opt);
    });
    select.disabled = !editable;
    decorate(select);
    if (editable) {
      select.addEventListener("change", () => setValue(select.value));
    }
    const field = createLabeledField({
      component,
      control: select,
      labelText,
      labelTag: "label",
      labelFor: select.id || "",
      labelClasses: INPUT_LABEL_CLASSES,
      applyFormatting: applyTextFormatting,
    });
    if (!options.length && typeof ctx.wrapEmptyOptions === "function") {
      return ctx.wrapEmptyOptions(field);
    }
    return field;
  }

  if (variant === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.className = plain ? "form-control-plaintext" : "form-control";
    applyControlColors(textarea);
    if (componentUid) textarea.id = `${componentUid}-textarea`;
    const rows = Number.isFinite(Number(component.rows)) ? Number(component.rows) : 3;
    textarea.rows = Math.min(Math.max(Math.round(rows), 2), 12);
    textarea.placeholder = component.placeholder || "";
    // Same tag-stripping as Text/Input's own "text" variant just below —
    // see that one's own comment for why.
    textarea.value = resolvedValue != null ? stripHtmlTags(String(resolvedValue)) : "";
    textarea.disabled = !editable;
    decorate(textarea);
    if (editable) {
      textarea.addEventListener("input", () => setValue(textarea.value));
    }
    return createLabeledField({
      component,
      control: textarea,
      labelText,
      labelTag: "label",
      labelFor: textarea.id || "",
      labelClasses: INPUT_LABEL_CLASSES,
      applyFormatting: applyTextFormatting,
    });
  }

  if (variant === "radio" || variant === "checkbox") {
    const options = ctx.resolveChoiceOptions(component);
    // A Source option can carry its own flavor/rules text —
    // normalizeOptionEntries already threads it through as `description`,
    // previously dropped here. Shown only when at least one option has one
    // — an inline row of short pills with no description still reads
    // better as a flowing group than a padded vertical list.
    const hasDescriptions = options.some((option) => typeof option === "object" && option.description);
    const group = document.createElement("div");
    group.className = hasDescriptions ? "d-flex flex-column gap-2" : "d-flex flex-wrap gap-2";
    const currentValue = variant === "checkbox"
      ? Array.isArray(resolvedValue) ? resolvedValue.map(String) : []
      : resolvedValue == null ? "" : String(resolvedValue);
    options.forEach((option, index) => {
      const optionValue = typeof option === "string" ? option : option.value;
      const optionLabel = typeof option === "string" ? option : option.label;
      const optionDescription = typeof option === "object" ? option.description : "";
      const id = `${component.uid}-${variant}-${index}`;
      const formCheck = document.createElement("div");
      formCheck.className = hasDescriptions ? "form-check" : "form-check form-check-inline";
      const input = document.createElement("input");
      input.className = "form-check-input";
      input.type = variant;
      input.name = `${component.uid}-${variant}`;
      input.id = id;
      input.disabled = !editable;
      input.value = optionValue;
      input.checked = variant === "radio" ? optionValue === currentValue : currentValue.includes(String(optionValue));
      decorate(input, { value: optionValue });
      if (editable) {
        input.addEventListener("change", () => {
          if (variant === "radio") {
            setValue(input.value);
          } else {
            const checkedValues = Array.from(group.querySelectorAll("input[type=checkbox]"))
              .filter((node) => node.checked)
              .map((node) => node.value);
            setValue(checkedValues);
          }
        });
      }
      const optionLabelEl = document.createElement("label");
      optionLabelEl.className = "form-check-label";
      optionLabelEl.style.color = component.textColor || "";
      optionLabelEl.setAttribute("for", id);
      optionLabelEl.textContent = optionLabel;
      formCheck.append(input, optionLabelEl);
      if (optionDescription) {
        const descriptionEl = document.createElement("div");
        descriptionEl.className = "small text-body-secondary";
        descriptionEl.style.marginLeft = "1.5rem";
        descriptionEl.textContent = optionDescription;
        formCheck.appendChild(descriptionEl);
      }
      group.appendChild(formCheck);
    });
    return createLabeledField({
      component,
      control: group,
      labelText,
      labelTag: "div",
      labelClasses: INPUT_LABEL_CLASSES,
      applyFormatting: applyTextFormatting,
    });
  }

  const input = document.createElement("input");
  input.className = plain ? "form-control-plaintext" : "form-control";
  applyControlColors(input);
  if (componentUid) input.id = `${componentUid}-input`;
  if (variant === "number") {
    input.type = "number";
    if (component.min !== undefined) input.min = component.min;
    if (component.max !== undefined) input.max = component.max;
    if (component.step !== undefined) input.step = component.step;
    const numericValue = resolvedValue == null ? "" : resolvedValue;
    input.value = numericValue === undefined || numericValue === null ? "" : numericValue;
  } else {
    input.type = component.inputType || "text";
    input.placeholder = component.placeholder || "";
    // Same tag-stripping as Text — purely about not showing literal
    // "<p>...</p>" characters (e.g. Notes imported as HTML).
    input.value = resolvedValue != null ? stripHtmlTags(String(resolvedValue)) : "";
  }
  input.disabled = !editable;
  decorate(input);
  if (editable) {
    if (variant === "number") {
      input.addEventListener("input", () => {
        const raw = input.value;
        if (raw === "") {
          setValue(null);
          return;
        }
        const next = Number(raw);
        setValue(Number.isNaN(next) ? raw : next);
      });
    } else {
      input.addEventListener("input", () => {
        setValue(input.value);
      });
    }
  }
  const finalControl = ctx.wrapControl(input, component, { labelText, editable });
  return createLabeledField({
    component,
    control: finalControl,
    labelText,
    labelTag: "label",
    labelFor: input.id || "",
    labelClasses: INPUT_LABEL_CLASSES,
    applyFormatting: applyTextFormatting,
  });
}

// Clicking the segment that's currently the LAST active one un-fills it
// (steps back by one); clicking any other segment fills up to and
// including it — one click always sets a clear, predictable fill level
// rather than needing a drag gesture.
export function nextTrackValue(clickedIndex, active) {
  return clickedIndex + 1 === active ? clickedIndex : clickedIndex + 1;
}

// No text-body-secondary — !important, silently overrode component.textColor.
const TRACK_LABEL_CLASSES = ["fw-semibold"];

// Track (linear + circular) — DOM shape is identical between preview and
// live view except interactivity, keyed off ctx.editable. `ctx`:
//   resolveTrackState(component) — { segments, active }. Live: real
//     segment-count/value resolution; preview: a representative static state.
//   editable(component) / onChange(component, value) — same shape as
//     every other interactive type.
//   decorate(el, component) — optional; live: assignBindingMetadata.
export function renderLinearTrackContent(component, ctx) {
  const labelText = resolveFieldLabel(component);
  const { segments, active } = ctx.resolveTrackState(component);
  const total = Math.max(segments, 1);
  const editable = ctx.editable(component);
  const track = document.createElement("div");
  track.className = "template-linear-track";
  if (typeof ctx.decorate === "function") ctx.decorate(track, component);
  for (let index = 0; index < total; index += 1) {
    const segment = document.createElement(editable ? "button" : "div");
    segment.className = "template-linear-track__segment";
    // Filled = Foreground, resting/unfilled = Background — same split
    // Toggle uses. Previously hardcoded via .is-active in shell.css,
    // ignoring this component's own color data; still falls back to the
    // same defaults when the author hasn't overridden them.
    segment.style.backgroundColor =
      (index < active ? component.foregroundColor : component.backgroundColor) ||
      (index < active ? "var(--bs-primary)" : "var(--bs-border-color)");
    segment.setAttribute("data-bs-toggle", "tooltip");
    segment.setAttribute("data-bs-title", `Segment ${index + 1}`);
    if (editable) {
      segment.type = "button";
      // A plain <button> reset — strips browser chrome so an interactive
      // segment looks identical to a static preview one.
      segment.style.border = "none";
      segment.style.padding = "0";
      segment.style.cursor = "pointer";
      segment.addEventListener("click", () => {
        ctx.onChange(component, nextTrackValue(index, active));
      });
    }
    track.appendChild(segment);
  }
  return createLabeledField({
    component,
    control: track,
    labelText,
    labelTag: "div",
    labelClasses: TRACK_LABEL_CLASSES,
    applyFormatting: applyTextFormatting,
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

// (x, y) on a circle of radius `r` at `angleDeg`, measured clockwise from
// straight up (12 o'clock) — matches a Blades clock's fill direction, so
// segment 0 starts at 12 and fills clockwise.
function pointOnCircle(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

// One donut wedge (an annulus sector) as an SVG path — outer arc, straight
// step in to the inner radius, inner arc back, straight step out to close.
// `total === 1` (a degenerate one-segment track) needs its own two-arc
// path: a single <A> command can't describe a full 360deg sweep, since its
// start and end points would coincide.
function describeDonutWedge(cx, cy, outerR, innerR, startAngle, endAngle) {
  if (endAngle - startAngle >= 360) {
    const outerTop = pointOnCircle(cx, cy, outerR, 0);
    const outerBottom = pointOnCircle(cx, cy, outerR, 180);
    const innerTop = pointOnCircle(cx, cy, innerR, 0);
    const innerBottom = pointOnCircle(cx, cy, innerR, 180);
    return [
      `M ${outerTop.x} ${outerTop.y}`,
      `A ${outerR} ${outerR} 0 1 1 ${outerBottom.x} ${outerBottom.y}`,
      `A ${outerR} ${outerR} 0 1 1 ${outerTop.x} ${outerTop.y}`,
      `L ${innerTop.x} ${innerTop.y}`,
      `A ${innerR} ${innerR} 0 1 0 ${innerBottom.x} ${innerBottom.y}`,
      `A ${innerR} ${innerR} 0 1 0 ${innerTop.x} ${innerTop.y}`,
      "Z",
    ].join(" ");
  }
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = pointOnCircle(cx, cy, outerR, startAngle);
  const outerEnd = pointOnCircle(cx, cy, outerR, endAngle);
  const innerEnd = pointOnCircle(cx, cy, innerR, endAngle);
  const innerStart = pointOnCircle(cx, cy, innerR, startAngle);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

// A real Blades-style clock — one circle divided into `segments` wedges,
// each a distinct clickable slice with a visible divider. Confirmed real
// bug in the previous version (a conic-gradient div + an inset "hole" div):
// the gradient renders relative to the element's own box, which only stays
// circular if that box is a perfect square — any ancestor sizing disturbs
// that and warps wedges into a lens shape. SVG's `viewBox="0 0 100 100"` is
// a fixed, aspect-ratio-locked coordinate space regardless of CSS sizing,
// so the wedge math below is always drawn against a true circle.
export function renderCircularTrackContent(component, ctx) {
  const labelText = resolveFieldLabel(component);
  const { segments, active } = ctx.resolveTrackState(component);
  const total = Math.max(segments, 1);
  const editable = ctx.editable(component);
  const step = 360 / total;
  const wrap = document.createElement("div");
  wrap.className = "template-circular-track";
  if (typeof ctx.decorate === "function") ctx.decorate(wrap, component);

  // Filled = Foreground, resting/unfilled = Background, same split as the
  // linear track — falls back to the suite's defaults, never an empty
  // string (an empty SVG fill/stroke attribute is invalid).
  const filledColor = component.foregroundColor || "var(--bs-primary)";
  const restingColor = component.backgroundColor || "var(--bs-secondary-bg)";
  const strokeColor = component.borderColor || "var(--bs-border-color)";
  const borderWidthValue = Number.isFinite(Number(component.borderWidth)) ? Number(component.borderWidth) : 1;
  const dashArray = component.borderStyle === "dashed" ? "4 2" : component.borderStyle === "dotted" ? "1 2" : "";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.classList.add("template-circular-track__svg");
  const cx = 50;
  const cy = 50;
  const outerR = 47;
  const innerR = 27;
  for (let index = 0; index < total; index += 1) {
    const start = index * step;
    const end = start + step;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", describeDonutWedge(cx, cy, outerR, innerR, start, end));
    path.setAttribute("fill", index < active ? filledColor : restingColor);
    path.setAttribute("stroke", strokeColor);
    path.setAttribute("stroke-width", String(Math.max(borderWidthValue, 0.5)));
    if (dashArray) path.setAttribute("stroke-dasharray", dashArray);
    if (editable) {
      path.style.cursor = "pointer";
      // One wedge, one click target — sets the value directly rather than
      // reverse-computing a click angle against the element's bounding box.
      path.addEventListener("click", () => {
        ctx.onChange(component, nextTrackValue(index, active));
      });
    }
    svg.appendChild(path);
  }
  wrap.appendChild(svg);

  if (editable) {
    wrap.style.cursor = "pointer";
    wrap.setAttribute("role", "slider");
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("aria-valuemin", "0");
    wrap.setAttribute("aria-valuemax", String(total));
    wrap.setAttribute("aria-valuenow", String(active));
  }

  const value = document.createElement("div");
  value.className = "template-circular-track__value";
  value.textContent = `${Math.min(active, total)}/${total}`;
  wrap.appendChild(value);

  return createLabeledField({
    component,
    control: wrap,
    labelText,
    labelTag: "div",
    labelClasses: TRACK_LABEL_CLASSES,
    applyFormatting: applyTextFormatting,
  });
}

// No text-body-secondary — !important, silently overrode component.textColor.
const SELECT_GROUP_LABEL_CLASSES = ["fw-semibold"];

// Select Group — character-view.js's live renderer previously ignored
// component.variant entirely (always a plain btn-group) even though the
// Template editor's preview already supported three visual variants
// ("tags", "buttons", pill-button default) — a "tags" group showed
// hashtag-style tags in the editor, then silently rendered as a plain
// button group in Play/Edit. All three are shared here now, real and
// interactive in both views. `ctx`:
//   resolveOptions(component) — live: resolveSelectionOptions; preview:
//     resolveSelectGroupPreviewOptions (sample data).
//   isActive(component, option, index) — live: real value comparison;
//     preview: a representative index-based selected state.
//   editable(component) / onSelect(component, optionValue) — same shape
//     as every other interactive type.
//   decorate(el, component, meta) — optional; live: assignBindingMetadata.
//   wrapEmptyOptions(component, labelText) — optional; preview only.
export function renderSelectGroupContent(component, ctx) {
  const labelText = resolveFieldLabel(component);
  const options = ctx.resolveOptions(component);
  if (!options.length && typeof ctx.wrapEmptyOptions === "function") {
    return ctx.wrapEmptyOptions(component, labelText);
  }
  const editable = ctx.editable(component);
  const variant = component.variant;

  // Active = Foreground, resting text = Text, resting background/border =
  // Background/Border — same split Track uses. Previously hardcoded CSS
  // for tags and Bootstrap's .btn-outline-secondary for buttons/pills,
  // ignoring this component's own color data.
  let control;
  if (variant === "tags") {
    control = document.createElement("div");
    control.className = "template-select-tags d-flex flex-wrap gap-2";
    options.forEach((option, index) => {
      const optionValue = option.value;
      const optionLabel = option.label || option.value || "";
      const tag = document.createElement(editable ? "button" : "span");
      if (editable) tag.type = "button";
      tag.className = "template-select-tag";
      const active = ctx.isActive(component, option, index);
      tag.style.color = (active ? component.foregroundColor : component.textColor) || "";
      const slug = String(optionLabel).trim().toLowerCase().replace(/\s+/g, "-");
      tag.textContent = `#${slug || "tag"}`;
      tag.disabled = !editable;
      if (typeof ctx.decorate === "function") ctx.decorate(tag, component, { value: optionValue });
      if (editable) {
        tag.addEventListener("click", () => ctx.onSelect(component, optionValue));
      }
      control.appendChild(tag);
    });
  } else if (variant === "buttons") {
    control = document.createElement("div");
    control.className = "btn-group";
    control.setAttribute("role", "group");
    options.forEach((option, index) => {
      const optionValue = option.value;
      const button = document.createElement("button");
      button.type = "button";
      const active = ctx.isActive(component, option, index);
      // "active" class kept for Bootstrap's own pressed-state box-shadow —
      // just not its color/background/border-color, which the inline
      // styles below always win over regardless.
      button.className = `btn btn-outline-secondary${active ? " active" : ""}`;
      button.style.color = component.textColor || "";
      button.style.backgroundColor = (active ? component.foregroundColor : component.backgroundColor) || "";
      button.style.borderColor = (active ? component.foregroundColor : component.borderColor) || "";
      button.textContent = option.label || option.value;
      button.disabled = !editable;
      if (typeof ctx.decorate === "function") ctx.decorate(button, component, { value: optionValue });
      if (editable) button.addEventListener("click", () => ctx.onSelect(component, optionValue));
      control.appendChild(button);
    });
  } else {
    control = document.createElement("div");
    control.className = "d-flex flex-wrap gap-2";
    control.setAttribute("role", "group");
    options.forEach((option, index) => {
      const optionValue = option.value;
      const button = document.createElement("button");
      button.type = "button";
      const active = ctx.isActive(component, option, index);
      button.className = `btn btn-outline-secondary btn-sm rounded-pill${active ? " active" : ""}`;
      button.style.color = component.textColor || "";
      button.style.backgroundColor = (active ? component.foregroundColor : component.backgroundColor) || "";
      button.style.borderColor = (active ? component.foregroundColor : component.borderColor) || "";
      button.textContent = option.label || option.value;
      button.disabled = !editable;
      if (typeof ctx.decorate === "function") ctx.decorate(button, component, { value: optionValue });
      if (editable) button.addEventListener("click", () => ctx.onSelect(component, optionValue));
      control.appendChild(button);
    });
  }
  return createLabeledField({
    component,
    control,
    labelText,
    labelTag: "div",
    labelClasses: SELECT_GROUP_LABEL_CLASSES,
    applyFormatting: applyTextFormatting,
  });
}

// No text-body-secondary — that's a Bootstrap utility class (`!important`),
// which would permanently pin the label to a muted grey regardless of
// component.textColor, no matter what inline color renderToggleContent
// sets afterward. Every other type's own *_LABEL_CLASSES also includes
// text-body-secondary, which is fine for them — their field label is just
// UI chrome, separate from whatever their own bound CONTENT renders in
// (an Input's typed value, a Text component's own body). Toggle has no
// such separate content element — the field label IS the only text this
// component ever shows — so Text has to reach it directly.
const TOGGLE_LABEL_CLASSES = ["fw-semibold", "mb-0"];
const TOGGLE_BORDER_SIDES = ["top", "right", "bottom", "left"];

// A Toggle's own glyph (renderToggleContent below) already reads
// Text/Foreground/Background/Border directly and paints its own compact
// shape — applying the SAME colors to the component's outer wrapper too
// (every other type's normal applyComponentStyles treatment) would color
// the whole field, label area included, not just the shape. Used by each
// tool's wrapper-coloring call site to exclude just Toggle.
//
// Clearing borderStyle (not just borderColor) matters — borderStyle is the
// border on/off switch everywhere else in this app, so leaving it on this
// stripped copy while only blanking borderColor left the wrapper drawing a
// real 1px solid border with no explicit color, which the browser resolves
// to currentColor, not "no border."
export function excludeToggleWrapperColors(component) {
  if (!component || component.type !== "toggle") return component;
  return {
    ...component,
    textColor: "",
    backgroundColor: "",
    borderStyle: "",
    borderColor: "",
    borderWidth: null,
    borderSides: null,
  };
}

// A state entry's WRITE/MATCH identity (`value`) and its DISPLAY text
// (`label`) are kept separate — collapsing both into one string meant
// click-to-cycle only ever wrote/matched a state's display NAME, silently
// failing to match real bound data keyed by a Source entry's own
// `sourceId` (this app's canonical identifier — see
// system-lookup-tables.js/bindings.js's createLookupFn). A Toggle bound to
// `@proficiencies` storing a numeric rank never matched any state by name.
export function toggleStateEntryFromRaw(entry) {
  if (entry === undefined || entry === null) return null;
  if (typeof entry !== "object") {
    const text = String(entry);
    return { value: entry, label: text };
  }
  const rawValue = entry.sourceId ?? entry.value ?? entry.id ?? entry.key ?? entry.slug ?? entry.name ?? entry.label;
  if (rawValue === undefined || rawValue === null) return null;
  const rawLabel = entry.label ?? entry.name ?? entry.title ?? entry.text ?? rawValue;
  return { value: rawValue, label: rawLabel !== undefined && rawLabel !== null ? String(rawLabel) : String(rawValue) };
}

// Resolves how "full" (0-1) and whether to show the emphasis ring for one
// state, from component.stateStyles — component/template-authored data,
// deliberately NOT derived from the System/Source, since the same semantic
// states render differently per template and per System (D&D 5e vs.
// Pathfinder proficiency scales don't agree on how many levels exist).
// Keyed by the state entry's own `value` (String()'d, see
// toggleStateEntryFromRaw above), so it survives reordering the Source
// list. A state with no configured entry falls back to its position in the
// list — a template author only needs to override where that's wrong.
function resolveToggleStateStyle(component, entryValue, index, total) {
  const key = entryValue != null ? String(entryValue) : "";
  const configured =
    component?.stateStyles && typeof component.stateStyles === "object" ? component.stateStyles[key] : null;
  const maxIndex = Math.max(total - 1, 1);
  const positionFallback = total <= 1 ? (total === 1 ? 1 : 0) : index / maxIndex;
  const fillLevel =
    configured && typeof configured.fillLevel === "number"
      ? Math.max(0, Math.min(1, configured.fillLevel))
      : positionFallback;
  return { fillLevel, ring: Boolean(configured?.ring) };
}

// Toggle — a compact clickable shape (not a <select>), for multi-state
// indicators like skill/save proficiency: click cycles to the next state,
// wrapping around; fill level/ring reflect the active state via
// resolveToggleStateStyle above. `component.shape` picks the CSS shape
// variant (circle/square/diamond/star/...), one per component, not per
// state. `component.width`/`height` are optional inline-style overrides,
// same convention as Image. Toggle carries all four color concepts at
// once: `textColor` colors the label ONLY; `foregroundColor` drives the
// shape's fill; `backgroundColor`/`borderColor` are the shape's resting
// background/outline. Fill/outline reach the glyph via CSS custom-property
// hooks (a pseudo-element can only be styled through CSS). `ctx`:
//   resolveStates(component) — {value, label}[]; live: resolveToggleStates
//     (as-authored); preview: resolveTogglePreviewStates (sample data).
//   resolveActiveIndex(component, states) — which state index is active
//     (matches against `states[i].value`, not `.label`).
//   editable(component) — Toggle-like indicators are Edit-mode-only, never
//     clickable in Play view regardless of other rights.
//   onChange(component, value) — called with the NEXT state's `value` on click.
//   decorate(el, component) — optional; live: assignBindingMetadata.
//   wrapEmptyStates(field) — optional; preview only, "select a source" hint.
//   previewFillLevel — optional number; preview only, forces this fill
//     level (no ring) regardless of the real active state.
export function renderToggleContent(component, ctx) {
  const labelText = resolveFieldLabel(component);
  const states = ctx.resolveStates(component);
  const hasStates = states.length > 0;
  const rawActiveIndex = hasStates ? ctx.resolveActiveIndex(component, states) : -1;
  const activeIndex = hasStates ? Math.max(0, Math.min(rawActiveIndex, states.length - 1)) : -1;
  const shape = component?.shape || "circle";
  const editable = ctx.editable(component) && hasStates;
  const glyph = document.createElement(editable ? "button" : "span");
  if (editable) glyph.type = "button";
  if (component?.uid) glyph.id = `${component.uid}-toggle`;
  glyph.className = `template-toggle-shape template-toggle-shape--${shape}`;
  const activeEntry = hasStates ? states[activeIndex] : null;
  const resolvedStyle = activeEntry
    ? resolveToggleStateStyle(component, activeEntry.value, activeIndex, states.length)
    : { fillLevel: 0, ring: false };
  // ctx.previewFillLevel — preview-only override: forces a half-filled look
  // regardless of the real active state, so an author configuring
  // Background/Foreground can see both colors at once in the canvas.
  // Real Play/Edit never sets this.
  const hasPreviewOverride = typeof ctx.previewFillLevel === "number";
  const fillLevel = hasPreviewOverride ? ctx.previewFillLevel : resolvedStyle.fillLevel;
  const ring = hasPreviewOverride ? false : resolvedStyle.ring;
  glyph.classList.toggle("has-ring", ring);
  // Solid fillLevel (0-1) reveal, bottom-up — Background is the color
  // behind the shape, Foreground is the shape itself. No opacity blending:
  // a fade never reaching full opacity made Foreground look inert except
  // at the top of the scale, since Background always showed through — a
  // clean two-tone split (the classic 5e half-filled dot) keeps both
  // colors fully visible at any fill level.
  glyph.style.setProperty("--template-toggle-level", fillLevel.toFixed(3));
  // --template-toggle-fill-color feeds the ::before fill layer (a
  // pseudo-element can only be styled via CSS) and
  // --template-toggle-border-color feeds .has-ring's outline. This glyph
  // is separate from the outer wrapper, which excludeToggleWrapperColors
  // deliberately excludes from its own border/background.
  glyph.style.setProperty("--template-toggle-fill-color", component?.foregroundColor || "");
  glyph.style.setProperty("--template-toggle-border-color", component?.borderColor || "");
  glyph.style.backgroundColor = component?.backgroundColor || "";
  const borderColor = component?.borderColor || "";
  const borderStyle = component?.borderStyle || "";
  const borderWidthValue = Number.isFinite(Number(component?.borderWidth)) ? Number(component.borderWidth) : 1;
  const borderSidesConfig =
    component?.borderSides && typeof component.borderSides === "object" ? component.borderSides : null;
  TOGGLE_BORDER_SIDES.forEach((side) => {
    const enabled = borderSidesConfig ? borderSidesConfig[side] !== false : true;
    glyph.style.setProperty(`border-${side}-color`, borderColor);
    glyph.style.setProperty(`border-${side}-width`, enabled ? `${borderWidthValue}px` : "0");
    glyph.style.setProperty(`border-${side}-style`, enabled ? borderStyle : "none");
  });
  // Corner radius only applies to "square" — every other shape already
  // has its own silhouette (circle's border-radius:999px,
  // diamond/star's clip-path) that an authored radius would conflict with.
  if (shape === "square") {
    const radius = Number(component?.borderRadius);
    glyph.style.borderRadius = Number.isFinite(radius) && radius > 0 ? `${radius}px` : "";
  }
  const width = typeof component?.width === "string" ? component.width.trim() : "";
  const height = typeof component?.height === "string" ? component.height.trim() : "";
  if (width) glyph.style.width = width;
  if (height) glyph.style.height = height;
  const stateLabel = activeEntry ? activeEntry.label || "Toggle state" : "Toggle preview";
  glyph.setAttribute("aria-label", stateLabel);
  glyph.setAttribute("data-bs-toggle", "tooltip");
  glyph.setAttribute("data-bs-title", stateLabel);
  if (typeof ctx.decorate === "function") ctx.decorate(glyph, component);
  if (editable) {
    glyph.addEventListener("click", () => {
      const nextIndex = (activeIndex + 1) % states.length;
      ctx.onChange(component, states[nextIndex].value);
    });
  }
  const field = createLabeledField({
    component,
    control: glyph,
    labelText,
    labelTag: "div",
    labelClasses: TOGGLE_LABEL_CLASSES,
    applyFormatting: applyTextFormatting,
  });
  // Set directly, not left to inherit — Toggle's outer wrapper is
  // deliberately excluded from its own color styling (excludeToggleWrapperColors),
  // so there's nothing to inherit from.
  if (labelText) {
    const labelElement = field.querySelector(".component-field__label");
    if (labelElement && component?.textColor) {
      labelElement.style.color = component.textColor;
    }
  }
  if (!hasStates && typeof ctx.wrapEmptyStates === "function") {
    return ctx.wrapEmptyStates(field);
  }
  return field;
}
