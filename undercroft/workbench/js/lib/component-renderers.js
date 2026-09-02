import { applyTextFormatting, applyImageStyles } from "./component-styles.js";
import { resolveIconClassList } from "../../../common/js/lib/icon-picker.js";
import { createLabeledField } from "./component-layout.js";
import { createReferenceChip } from "../../../common/js/lib/library-reference.js";
// Repository's own renderMarkdown, reused as-is — same cross-tool precedent
// Crucible's own Notes preview already established (see crucible/index.html's
// own comment on why loading marked/DOMPurify `defer`red is safe: renderMarkdown
// only touches window.marked/window.DOMPurify at call time, never at module
// load). Called here with no options at all (no resolveWikiLink, no
// interactive dice/encounter/macro/checkbox handlers) — a Feature/Spell
// description has no legitimate use for any of those Journal-specific
// extensions, so they simply stay inert if the text ever happens to contain
// that syntax, rather than wiring up handlers nothing here needs.
import { renderMarkdown } from "../../../repository/js/lib/markdown.js";

// Once a component has ever had a real `label` property (every component
// created since this field existed does, set to "" by default — see
// createComponent in workbench-template-view.js), an explicitly-cleared
// label must stay cleared — no falling through to `name` just because the
// empty string is falsy. `name` is only a real fallback for saved data
// from before the `label` field existed at all (no own `label` property).
// Mirrors workbench-template-view.js's own getComponentLabel exactly; this
// module has no import path to that page-level function, so the same
// logic is duplicated here rather than left inconsistent.
function resolveFieldLabel(component) {
  if (!component) return "";
  if (Object.prototype.hasOwnProperty.call(component, "label")) {
    return typeof component.label === "string" ? component.label.trim() : "";
  }
  return typeof component.name === "string" ? component.name.trim() : "";
}

// Shared per-component-type content renderers used by BOTH
// workbench-template-view.js (Template editor canvas) and
// workbench-character-view.js (Play/Edit view). These two pages used to
// share a single renderer (workbench/js/lib/renderer.js's renderLayout,
// from the project's very first commit) until it was split apart on
// 2025-10-17 as an incidental side effect of unrelated feature work — since
// then every per-type render function was duplicated per page and drifted
// (missing formatting calls, mismatched CSS classes, fields only wired up
// in one file). This module is the reconsolidation: one function per
// component type, taking the component plus a small `ctx` object holding
// only the things that legitimately differ between an authoring preview
// and a live, bound view (value resolution, repeater-item context, child
// recursion, editability/onChange for interactive controls). Chrome
// (type-icon/binding-pill/delete button) and the dropzone-vs-static-children
// recursion boundary are NOT unified here — those still belong to each
// page's own top-level card-wrapper function, exactly where they already
// correctly live.

// component.align (start/center/end/justify — the shared Alignment radio
// group's own text-align-shaped vocabulary) mapped to a real flex
// align-items value for a Container zone's own content. Only ever
// repositions a child that's actually narrower than its own available
// space — a Text component's own content stays width:100% (so ellipsis
// truncation has a real box to truncate against), which makes align-items
// alone a no-op for it; resolveContainerZoneTextAlign below is what
// actually moves TEXT specifically.
export function resolveContainerZoneAlignItems(component) {
  const align = component.align || "start";
  if (align === "center") return "center";
  if (align === "end") return "flex-end";
  if (align === "justify") return "stretch";
  return "";
}

// text-align is an INHERITED CSS property — set once here, on the zone, it
// cascades down through every descendant (dropzone, card, the text element
// itself) regardless of how many nested flex/grid levels sit in between or
// what width any of them happen to be — unlike align-items above, which
// only repositions a child box that isn't already width:100%. This is what
// actually centers/right-aligns Text content specifically, since Text's
// own box deliberately stays full-width.
export function resolveContainerZoneTextAlign(component) {
  const align = component.align || "start";
  if (align === "center") return "center";
  if (align === "end") return "right";
  if (align === "justify") return "justify";
  return "";
}

// Column count for the grid's own CSS grid-template-columns — NOT the same
// thing as how many zones actually exist (a Container can have both
// multiple rows AND columns; row count doesn't need resolving separately
// here since, with grid-template-columns set, the browser auto-wraps into
// however many rows the zone count needs, matching the Template editor's
// own row-major zone order). "rows" is a legacy pre-Grid/Tabs-consolidation
// containerType value meaning "single column"; 9 matches
// workbench-template-view.js's own MAX_CONTAINER_COLUMNS constant.
export function resolveContainerColumns(component) {
  if (component.containerType === "rows") return 1;
  const raw = Number(component.columns);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 9) : 2;
}

// Container — the grid/tabs skeleton, label, alignment, and gap (where
// every Container bug this session actually was) are shared; zone
// COMPUTATION (ctx.getZones — the Template editor derives zones from
// rows/columns fields and mutates the draft, migrating legacy keys; Play/
// Edit just reads whatever zones already exist in the saved template data)
// and per-zone CHILD RENDERING (ctx.renderZone — drag-and-drop dropzone
// chrome vs. a plain static cell) stay injected, since those two
// genuinely differ for good reason (see this module's own file-level
// comment). Tab-state (ctx.getActiveTabIndex/setActiveTabIndex) also stays
// injected — each page persists it through different storage, but the
// shared function owns the actual DOM swap-on-click, so neither page needs
// its own click-handling logic anymore.
export function renderContainerContent(component, ctx) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-3";
  // No `|| component.name` fallback — `name` is only the internal layer-panel
  // identifier set at creation time (COMPONENT_DEFINITIONS.container.defaults.
  // name), not a display default; falling back to it made clearing the Label
  // field impossible to actually achieve (it kept showing "Container").
  const fallbackLabel = component.label || "";
  const labelText = ctx.resolveValue(component, fallbackLabel);
  if (labelText) {
    const heading = document.createElement("div");
    // No text-body-secondary — that Bootstrap utility class carries
    // !important, which silently overrode whatever applyTextFormatting set
    // from component.textColor right below it. Container has no separate
    // bound "content" the way Input/Toggle do (see TOGGLE_LABEL_CLASSES'
    // own comment on that distinction) — this heading IS the whole text
    // this component ever shows, so it has to actually respect textColor.
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
    // template-container-tabs-nav (styles.css) gives this a higher
    // stacking position than the Template editor's own absolutely-
    // positioned card header, which can otherwise sit on top of this row
    // and swallow clicks meant for these buttons — harmless in Play/Edit,
    // whose own card header is always empty.
    nav.className = "d-flex flex-wrap gap-2 template-container-tabs-nav";
    const body = document.createElement("div");
    body.className = "d-flex flex-column";
    if (alignItems) body.style.alignItems = alignItems;
    if (textAlign) body.style.textAlign = textAlign;

    // A Source-driven tabs container authored with an `activeTabBinding`
    // (see workbench-character-view.js's own resolveLockedTabIndex) locks
    // to exactly one tab in Play view — the one matching the character's
    // own current selection — with every OTHER tab button removed, not
    // just disabled. The locked tab's own label still shows, as a single
    // static (non-clickable) button in the same nav row — otherwise
    // there'd be no visible indication of which tab's content is even
    // showing (confirmed real: the first version of this dropped the nav
    // row entirely, silently losing the "Bard"/"Cutter" label along with
    // it). Only workbench-character-view.js's ctx implements this hook
    // (Play/Edit distinction only exists there); the Template editor's own
    // preview ctx has no such function, so `typeof ... === "function"`
    // is false there and this is always skipped, leaving every tab
    // switchable while authoring, same as before this existed.
    const lockedIndex =
      typeof ctx.resolveLockedTabIndex === "function" ? ctx.resolveLockedTabIndex(component, zones) : null;
    if (Number.isInteger(lockedIndex) && lockedIndex >= 0 && lockedIndex < zones.length) {
      const zone = zones[lockedIndex];
      const lockedButton = document.createElement("button");
      lockedButton.type = "button";
      // Not `.active` — that's what fills the button with Bootstrap's own
      // grey secondary background; this isn't a pressed/selected control
      // anymore, just the one remaining tab's own label. Plain outline
      // styling (border + text only) reads as a static label without
      // looking like a live, clickable pill.
      lockedButton.className = "btn btn-outline-secondary btn-sm";
      // Not `.disabled = true` — Bootstrap's own disabled-button style
      // forces a reduced opacity that washes out whatever color gets set
      // below, regardless of what it is. `pointer-events: none` blocks
      // interaction just as completely without touching opacity.
      lockedButton.style.pointerEvents = "none";
      lockedButton.tabIndex = -1;
      lockedButton.setAttribute("aria-disabled", "true");
      // Same resolved text color (component's own, already carrying the
      // template-default fallback by the time it reaches this shared
      // render function — see resolveComponentColors[ForPreview]) every
      // other piece of this component's own text uses — a plain <div>
      // heading inherits it for free from the wrapper's own
      // applyComponentStyles color, but a <button> has Bootstrap's own
      // explicit (non-inherited) outline-button color that would otherwise
      // win over it.
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
          // Only meaningful for tabs (the grid branch below never passes
          // it) — which resolved-Source entry (if any — tabLabelsSourceBinding)
          // this particular tab corresponds to, so ctx.renderZone can give
          // its own children a per-tab item context. See renderContainerComponent's
          // own renderZone in workbench-character-view.js.
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
// only what legitimately differs between an authoring preview and a live
// view: `resolveValue(component, fallback)` wraps each page's own existing
// resolver (resolveComponentValue's live/formula/roll-tracking path in
// character-view.js; resolvePreviewBindingValue's sample-data path plus its
// "show the raw binding/formula text when unresolved" authoring-legibility
// behavior in template-view.js) behind one shared shape, so this function
// itself has zero awareness of which view it's rendering for.
//
// Base class is unconditionally "workbench-text-content" now —
// template-view.js previously hardcoded "fw-semibold" here, which forced
// EVERY Text component to render bold in the canvas regardless of its own
// Bold toggle (applyTextFormatting only ever ADDS fw-semibold conditionally
// — it never had a chance to, since the class was already present). No
// text-body either (!important, silently overrode component.textColor —
// see TOGGLE_LABEL_CLASSES' own comment) — this is Text's own bound
// CONTENT, not UI chrome, so it needs the same fix Toggle's content got.
//
// Fallback text (component.text || label || name || "Text") is also now
// unconditional — template-view.js previously rendered nothing at all
// (an empty DocumentFragment) for a Text component with no binding/formula/
// text/label set; character-view.js already showed a "Text" placeholder.
// Unified on the more informative behavior.
// A bound value carrying literal markup (e.g. an inventory item's own Notes,
// imported from a source that stored rich text as HTML) used to show up as
// visible "<p>...</p>" tag characters — .textContent below has no notion of
// markup, it always prints exactly what it's given. Text is a fully generic
// "show me this scalar" component used for every kind of bound field across
// every template, not a rich-text editor of its own, so the safe universal
// fix is to strip tags down to plain text rather than switching to innerHTML
// (which would start interpreting a stray "<" in perfectly ordinary bound
// text — a monster's own "<3 HP remaining>" note, say — as markup instead of
// literal characters, a much worse regression than the tags it would fix).
function stripHtmlTags(value) {
  if (typeof value !== "string" || !/<[a-z][\s\S]*>/i.test(value)) {
    return value;
  }
  const scratch = document.createElement("div");
  scratch.innerHTML = value;
  return (scratch.textContent || "").replace(/\s+/g, " ").trim();
}

// A bound value shaped {refKind, refId, name} (Character.subclass, a
// promoted Feature/Spell repeater row, or any future reference field —
// the same shape established for Character's own subclass this session)
// — refId empty means nothing to link to yet (an unpromoted/unimported
// reference), same "falls back to plain text" grace every other unlinked
// reference in this suite already gets.
export function isReferenceValue(value) {
  return Boolean(value && typeof value === "object" && value.refKind && value.refId && value.name);
}

// Recognizes a reference-shaped bound value and renders it as a hover-
// preview chip automatically — a value-shape check at render time, not a
// template-authoring flag, the same way Repository's own markdown pipeline
// recognizes a `` `kind:name` `` code span with no per-instance
// configuration (see feedback_reference_display_no_new_mechanism). Works
// for a top-level Text component (Character.subclass) and, for free, any
// Text component inside a Repeater's own item template whose item resolves
// to a reference-shaped value (a Features/Spells row) — both go through
// this same function. `ctx.dataManager` is optional: absent (the Template
// editor's own canvas preview, which has no live record to look anything up
// against) falls back to the bare name as plain text, same grace every
// other optional ctx hook in this file already gets.
export function renderTextContent(component, ctx) {
  const fallback = component.text || component.label || component.name || "Text";
  const resolved = ctx.resolveValue(component, fallback);
  const text = document.createElement("div");
  text.className = "workbench-text-content";
  // Two ways a Text component ends up reference-shaped: bound directly to
  // the reference object itself (resolved is already {refKind,refId,name}
  // — Character.subclass), or — far more common in practice, since most
  // Text cells bind to one specific sub-field like "@name" rather than the
  // whole item — a plain string whose SIBLING refKind/refId live on the
  // same parent object (a Features/Spells repeater row's own name cell).
  // ctx.resolveReference (optional, same as every other ctx hook here)
  // covers the second case; see workbench-character-view.js's own
  // implementation for exactly how it resolves that sibling lookup.
  const reference = isReferenceValue(resolved)
    ? resolved
    : typeof ctx.resolveReference === "function"
      ? ctx.resolveReference(component)
      : null;
  if (reference) {
    applyTextFormatting(text, component);
    // Deliberately always `reference.name` (the real catalog name), never
    // an optional `customName` override — a Text cell showing one thing in
    // View mode and a DIFFERENT thing in Edit mode (Edit's own plain-input
    // branch below has no equivalent override at all) was confirmed real,
    // reported confusing UX. A custom nickname (e.g. DDB's own item-
    // customization "Hookshot" for a Grappling Hook) gets its own
    // dedicated field/column instead (see tpl.5e.flex-basic.json's own
    // Inventory Repeater), shown consistently either way.
    if (ctx.dataManager) {
      text.appendChild(
        createReferenceChip({ kind: reference.refKind, id: reference.refId, name: reference.name, dataManager: ctx.dataManager })
      );
    } else {
      text.textContent = reference.name;
    }
    return text;
  }
  // Opt-in per component (component.richText, off by default — see
  // createRichTextControl's own comment, workbench-template-view.js).
  // stripHtmlTags is skipped entirely here on purpose: markdown syntax
  // ("**bold**", a `| A | B |` table row) isn't HTML, so that regex-based
  // guard would never fire on it anyway, and running it first would risk
  // mangling a literal "<" a description's own prose happens to contain
  // (a damage-comparison "<5 feet", say) before marked ever sees it.
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
// `component.url` — read as a fallback everywhere a URL is needed, written
// to `.url` on every edit going forward (never `.src` again), so an
// existing Image component keeps showing its picture with no migration
// step required.
export function resolveImageUrl(component) {
  return component.url || component.src || "";
}

// Image — url/src, like Icon's iconClass, is itself the binding-or-literal
// string, plus a separate `formula` field for the "=" case (same generic
// key Icon/Text/Container use) — checked first via ctx.evaluateFormula,
// same precedence as those. ctx.resolveBindableString resolves an "@path"
// value against whichever data source (live record, preview sample data,
// or — when itemContext is set — one repeater item) the calling page
// provides, matching resolveRepeaterItemNode's existing per-item Image
// handling exactly, so an Image bound inside a Repeater item keeps working
// once that switch collapses onto this shared function (see the Repeater
// item-node dispatch migration).
//
// The Label heading (with real applyTextFormatting — previously missing in
// character-view.js) and the "@"-bound URL capability at the TOP level are
// both new here: template-view.js's canvas preview previously had no Label
// heading at all, and neither file resolved an "@"-bound top-level Image
// URL (only the Repeater-item case did).
export function renderImageContent(component, ctx) {
  const wrapper = document.createElement("div");
  wrapper.className = "d-flex flex-column gap-2";
  wrapper.style.overflow = "hidden";
  const label = component.label || component.name;
  if (label) {
    const heading = document.createElement("div");
    // Same fix as Container's own heading — no text-body-secondary (!important,
    // silently overrides component.textColor).
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
// generic Binding field). A separate `formula` field (same generic
// convention Text/Input already use) takes priority over iconClass when
// set — lets a template author compute the icon class dynamically (e.g.
// ="ddb-"+@type for a Repeater row showing a defense's icon by its own
// type), rather than iconClass's own binding mode, which only ever
// resolves a single bare @path with no expression support. `ctx.
// evaluateFormula` is optional — the Template editor's canvas preview
// deliberately doesn't provide it (see renderTextPreview's own comment:
// formulas can't be evaluated against sample data / with no live record),
// so a formula-driven icon there just falls through to the empty-state
// placeholder below, same as an unresolved binding already does.
// role="img"/aria-label (or aria-hidden when no ariaLabel is set) were
// previously only applied in character-view.js's live renderer — an
// authoring-canvas-only accessibility gap, now shared.
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

// One shared canonical labelClasses array for EVERY Input variant, in both
// pages — previously template-view.js used ["form-label", "mb-1"]
// uniformly while character-view.js used ["form-label", "fw-semibold",
// "text-body-secondary", "mb-0"] for most variants but a THIRD, different
// set (no "form-label", no "mb-0") specifically for its own radio/checkbox
// branch. Same label CSS everywhere now. No text-body-secondary (see
// TOGGLE_LABEL_CLASSES' own comment) — it's !important, so it silently
// overrode whatever applyTextFormatting set from component.textColor.
const INPUT_LABEL_CLASSES = ["form-label", "fw-semibold", "mb-0"];

// Input — the DOM shape (which HTML control, which classes, which options)
// is identical between an authoring preview and a live view; only
// editability, value resolution/write-back, and the combat-binding
// spinner/roll-overlay decoration genuinely differ. `ctx`:
//   resolveValue(component, fallback) — live: resolveComponentValue's
//     formula/binding resolution; preview: just passes fallback through
//     (Input's preview was never bound to sample data, only Text/Icon/
//     Image show a resolved preview value — preserved as-is here).
//   editable(component) — live: the real isEditable/itemContext check;
//     preview: always false.
//   onChange(component, value) — live: updateBinding/setRepeaterItemValue;
//     preview: no-op.
//   resolveOptions(component) — Select's own option list (live:
//     resolveSelectionOptions; preview: resolveSelectPreviewOptions).
//   resolveChoiceOptions(component) — Radio/Checkbox's own option list
//     (live: as-authored, no fallback; preview: falls back to 3 sample
//     options so an unconfigured group still shows its shape).
//   decorate(el, component, meta) — live: assignBindingMetadata; preview:
//     no-op.
//   wrapControl(input, component, { labelText, editable }) — returns the
//     final control node passed to createLabeledField; live: the combat-
//     binding spinner group / roll-overlay wrapping (unchanged logic, just
//     invoked through this hook instead of inline); preview: identity.
//   wrapEmptyOptions(field) — optional; preview only, wraps an empty
//     Select's field with the canvas "no options configured" hint.
//   plainReadOnly(component) — optional, only ever true when !editable;
//     live: Play view's own "this field isn't Editable in Play, so read it
//     like plain text instead of a grayed-out disabled control" rule (see
//     feedback_play_mode_never_editable_by_default); preview: absent
//     (Template editor's canvas always shows the normal boxed authoring
//     look, there's no "Play view" concept there at all). Select/Number/
//     Textarea/plain-text Input all honor this the same way Text alone
//     used to (a page-specific className swap in workbench-character-
//     view.js's own wrapControl) — centralized here since Textarea and
//     Select never went through wrapControl at all, so that page-specific
//     approach could only ever have covered Input's own variants.
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
  // `something.name` right alongside a `something.refKind`/`something.
  // refId` (Character.subclass, e.g.) — shows as the same hover-preview
  // chip Text gets, whenever this field isn't actively editable. Deliberately
  // NOT resolvedValue itself (unlike Text): resolvedValue here stays the
  // plain bound string always, so editing (when editable) keeps targeting
  // that string directly through the ordinary text-input branch below,
  // completely unaffected — this is purely a read-mode display swap, opt-in
  // per-ctx (ctx.resolveReference), not a change to what's actually bound
  // or how it's written back. `variant === "text"` or `"select"` only — a
  // Select still renders as plain read-only text when not editable (same
  // as Text), so the same swap applies there too (Character's own Class
  // field is deliberately authored as a Select — System-scoped choices in
  // Edit mode — and still wants its hover chip in View mode). A reference-
  // shaped sibling has no meaning for Number/Checkbox/etc., which render
  // as themselves either way.
  if (!editable && (variant === "text" || variant === "select") && typeof ctx.resolveReference === "function") {
    const reference = ctx.resolveReference(component);
    if (reference && ctx.dataManager) {
      const wrapper = document.createElement("div");
      // Always reference.name (never a customName override) — same
      // "consistent between View and Edit" reasoning as renderTextContent's
      // own identical reference-chip branch.
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

  // Guard against binding this Input to array/object-shaped data (e.g. a
  // System's own "inventory" field with no Repeater built for it yet).
  // Confirmed real data-loss bug, not hypothetical: every variant below
  // eventually turns resolvedValue into a single string (explicit
  // String(resolvedValue), or handing it straight to input.value, which the
  // DOM itself coerces via toString()) — an array of objects silently
  // became the literal text "[object Object],[object Object]", and the next
  // keystroke's input handler wrote that string straight back over the real
  // array. Checkbox is the one legitimate exception — its own variant
  // branch below already expects, and correctly round-trips, an array of
  // selected values.
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
  // explicit (non-inherited) color/background — an ancestor's inline
  // color/background-color, even a real one, never reaches these elements
  // through inheritance the way it does for a plain <div>. applyComponentStyles
  // (component-styles.js) only ever colors the outer wrapper card, so the
  // actual control — the text a user actually reads/types — needs its own
  // direct application, same fields, no separate fallback logic (the
  // component passed in here is already fully resolved: binding/formula/
  // template-default, see resolveComponentColors[ForPreview]).
  const applyControlColors = (el) => {
    el.style.color = component.textColor || "";
    el.style.backgroundColor = component.backgroundColor || "";
  };

  // A Button doesn't bind/display a value the way every other variant
  // does — `ctx.runButtonAction` (the only genuinely different thing
  // between the Template editor's inert preview and Play/Edit's real
  // executor, see those two callers' own comments) is called on click
  // instead. No createLabeledField wrapper — self-labeled, same "bare
  // shape, no floating label above it" precedent Toggle's own return
  // already sets. Face content prefers an icon, then an image, then the
  // Label text, then a bare "Button" fallback — a small icon-only roll
  // button (see the Roller-field migration this ships alongside) needs
  // a face with no visible text at all, so at least one of the three
  // has to render even when Label is empty.
  if (variant === "button") {
    const button = document.createElement("button");
    button.type = "button";
    // Bare .btn — no hardcoded outline-color class of our own. Border/
    // radius are real, per-component fields the Border section already
    // exposes to every component type (borderStyle/borderColor/
    // borderWidth/borderRadius, read generically by applyComponentStyles,
    // component-styles.js) — a Button gets its outline the exact same
    // authored way anything else does, never a CSS default standing in
    // for that.
    button.className = "btn btn-sm d-inline-flex align-items-center justify-content-center gap-1";
    applyControlColors(button);
    // Font/Text Size (the same generic Text section every component
    // exposes) previously did nothing at all here — a Button never called
    // this, so its Text Size control was a silent no-op. Applied to the
    // button itself (not just a label span, the way Toggle's own
    // createLabeledField call formats a SEPARATE label above a
    // fixed-shape glyph) since the button's own face text IS this
    // component's content, same as Text's own applyTextFormatting call.
    applyTextFormatting(button, component);
    const width = typeof component.width === "string" ? component.width.trim() : "";
    const height = typeof component.height === "string" ? component.height.trim() : "";
    if (width) button.style.width = width;
    if (height) button.style.height = height;
    // .btn-sm's own padding (0.25rem/0.5rem — sized for a text label
    // alongside the glyph) eats most of a small button's box before the
    // icon even gets a chance to fill it — a labeled button (Cast) keeps
    // that normal padding, but an icon/image-only face (no Label — the
    // small roll-button case this shipped alongside) only needs enough
    // room to keep the glyph off the border.
    if (!labelText) {
      button.style.padding = "2px";
    }
    // A bare icon glyph has no sizing of its own — it just inherits
    // .btn-sm's own ~14px text size, which reads cramped against the
    // button's own box even at its default (unset) size. Scaled here off
    // the button's own Width/Height (minus the padding above) instead of a
    // fixed rem value, so the glyph actually fills the box rather than
    // shrinking proportionally with it — a floor keeps it legible even on
    // a very small button. px/rem/em only (this suite's own Width/Height
    // convention, see the placeholder text below) — a %, or anything else
    // unparsed, falls back to the no-size-set default rather than guessing.
    const parseBoxPx = (raw) => {
      const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(raw);
      if (!match) return null;
      const num = Number(match[1]);
      const unit = match[2] || "px";
      return unit === "px" ? num : num * 16;
    };
    const boxDimensPx = [parseBoxPx(width), parseBoxPx(height)].filter((n) => Number.isFinite(n) && n > 0);
    // Icon-only face: sized to fill the box (see above), independent of
    // Text Size — there's no visible text for that control to size.
    // Icon+label face: the icon sits next to real text now (applyTextFormatting
    // above), so it needs to scale WITH that text — an em value tracks
    // whatever font-size Text Size/Font Size just resolved to on the
    // button itself, exactly like an inline icon next to any other text.
    const iconFontSize = labelText
      ? "1.15em"
      : `${boxDimensPx.length ? Math.max(16, Math.min(Math.min(...boxDimensPx) - 6, 44)) : 22}px`;
    // Same formula/binding/literal precedence renderIconContent's own
    // iconClass and renderImageContent's own url resolve with — Button's
    // Icon/Image fields ARE those exact fields (iconClass/url/formula),
    // authored through those exact same picker controls
    // (createIconFieldControl/createImageUrlControl), so a "=formula" or
    // "@path" typed into either one has to resolve the same way here too,
    // not just look the same in the inspector.
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
      // No visible label — the icon/image alone isn't accessible text,
      // same "aria-label carries what the visible text can't" pattern
      // every icon-only toolbar button in this suite already follows.
      button.setAttribute("aria-label", (component.name || "Button").trim() || "Button");
    }
    button.disabled = !editable;
    button.addEventListener("click", () => {
      if (!editable) return;
      ctx.runButtonAction?.(component);
    });
    decorate(button);
    // Returned wrapped, not bare — applyComponentStyles (component-styles.js)
    // is always called on whatever render*Component returns, and its own
    // border/padding/margin fields correctly clear back to CSS when unset,
    // but its width handling doesn't: it unconditionally sets a real inline
    // width (or clears any inline width entirely) based on alignSelf alone,
    // with no "unset means leave it alone" case. Toggle avoids this the
    // same way (renderToggleContent returns a wrapping `field`, sizing its
    // own inner glyph directly) — Button's own explicit width/height,
    // above, needs the identical separation: sized on the actual button,
    // wrapped in a plain inert span so applyComponentStyles's width
    // handling lands on THAT instead and never touches it. Confirmed real
    // bug this fixes: a Button rendered as a bare Repeater-item node
    // (dispatchItemContextNode calls applyComponentStyles directly on
    // whatever's returned, no wrapper of its own) had its own Width/Height
    // silently cleared on every render, regardless of what was authored.
    const wrapper = document.createElement("span");
    wrapper.className = "d-inline-flex";
    wrapper.appendChild(button);
    return wrapper;
  }

  if (variant === "select") {
    const currentValue = resolvedValue == null ? "" : String(resolvedValue);
    const options = ctx.resolveOptions(component);
    // Play view, not Editable in Play — a disabled <select> still looks
    // like an inert dropdown (native arrow, boxed border in most browsers;
    // .form-control-plaintext isn't documented/reliable for <select> the
    // way it is for input/textarea), so this reads the CHOSEN option's own
    // label as plain text instead, rather than a control that can't
    // actually be opened.
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
    // A Source option can carry its own flavor/rules text (a Blades in the
    // Dark special ability's rules text, an armor type's own blurb, ...) —
    // normalizeOptionEntries (component-data.js) already threads it
    // through as `description`, previously dropped here entirely. Shown
    // only when at least one option actually has one — an inline row of
    // short pills (Trauma, Armor, Load — no description text today) still
    // reads better as a flowing group than a padded vertical list with
    // nothing under each item.
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
    // Same tag-stripping as Text (renderTextContent's own stripHtmlTags,
    // reused here) — an <input>'s own value attribute never interprets
    // markup either way, so this is purely about not showing the literal
    // "<p>...</p>" characters (an Inventory item's own Notes, imported from
    // a source that stored rich text as HTML, was the confirmed real case).
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

// No text-body-secondary (!important, silently overrode component.textColor
// — see TOGGLE_LABEL_CLASSES' own comment).
const TRACK_LABEL_CLASSES = ["fw-semibold"];

// Track (linear + circular) — DOM shape is identical between an authoring
// preview and a live view except for interactivity (button vs div
// segment; role="slider"/click listener on the circular gauge), keyed
// directly off ctx.editable — no extra "decorate"-style wrapping hook
// needed the way Input's spinner/roll-overlay did. `ctx`:
//   resolveTrackState(component) — { segments, active }. Live: real
//     segment-count/value resolution (formulas, live bindings, via
//     resolveTrackSegments/resolveComponentValue). Preview: a
//     representative static state (no live record to resolve against).
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
    // Toggle already established for its own shape fill. Previously
    // hardcoded to var(--bs-primary)/var(--bs-border-color) via
    // .is-active in shell.css, ignoring this component's own color data
    // entirely — now real component data, but still falls back to those
    // exact same defaults when the author hasn't overridden them (an empty
    // string here is a real, visible bug for the circular variant just
    // below, whose fill is one combined conic-gradient value rather than
    // one independent background-color per segment — see that function's
    // own fix for the confirmed failure mode).
    segment.style.backgroundColor =
      (index < active ? component.foregroundColor : component.backgroundColor) ||
      (index < active ? "var(--bs-primary)" : "var(--bs-border-color)");
    segment.setAttribute("data-bs-toggle", "tooltip");
    segment.setAttribute("data-bs-title", `Segment ${index + 1}`);
    if (editable) {
      segment.type = "button";
      // A plain <button> reset — .template-linear-track__segment supplies
      // the actual sizing/color/shape, this just strips the browser's own
      // button chrome so an interactive segment looks identical to a
      // static preview one.
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
// straight up (12 o'clock) — matches a Blades clock's own fill direction
// and the old conic-gradient version's angle convention (0deg = top), so
// segment 0 still starts at 12 o'clock and fills clockwise.
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
// each a distinct clickable slice with a visible divider between it and
// its neighbors, not a text label pretending to be one. Confirmed real
// bug in the previous version (a `conic-gradient` div + an absolutely-
// positioned inset "hole" div layered on top): the gradient renders
// relative to the ELEMENT'S OWN box, which only stays circular if that
// box is reliably a perfect square — anything that even slightly disturbs
// that (a flex/grid ancestor's own sizing, a browser's own rounding) warps
// the "circle" into an ellipse, and warped conic-gradient wedges read as a
// lens/parabola shape rather than pie slices. SVG's `viewBox` sidesteps
// this entirely — "0 0 100 100" is a fixed, aspect-ratio-locked internal
// coordinate space no matter how the <svg> element itself gets sized by
// CSS, so the wedge math below is always drawn against a true circle.
export function renderCircularTrackContent(component, ctx) {
  const labelText = resolveFieldLabel(component);
  const { segments, active } = ctx.resolveTrackState(component);
  const total = Math.max(segments, 1);
  const editable = ctx.editable(component);
  const step = 360 / total;
  const wrap = document.createElement("div");
  wrap.className = "template-circular-track";
  if (typeof ctx.decorate === "function") ctx.decorate(wrap, component);

  // Filled = Foreground, resting/unfilled = Background — same split as the
  // linear track above, with the same "fall back to the suite's own
  // defaults, never an empty string" fix (see this file's history) since
  // an empty SVG `fill`/`stroke` attribute is just as invalid as an empty
  // conic-gradient stop was.
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
      // reverse-computing a click angle against the whole element's
      // bounding box (the old version's approach, needed there because a
      // single div had no per-wedge elements to attach a listener to).
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

// No text-body-secondary (!important, silently overrode component.textColor
// — see TOGGLE_LABEL_CLASSES' own comment).
const SELECT_GROUP_LABEL_CLASSES = ["fw-semibold"];

// Select Group — character-view.js's live renderer previously ignored
// component.variant entirely (always a plain btn-group), even though the
// Template editor's own preview already supported three real visual
// variants ("tags", "buttons", the pill-button default) — a Select Group
// set to "tags" in the Template editor showed hashtag-style tags there,
// then silently rendered as a plain button group in Play/Edit. All three
// variants are shared here now, each real and interactive (not just a
// preview shape) in both views. `ctx`:
//   resolveOptions(component) — live: resolveSelectionOptions; preview:
//     resolveSelectGroupPreviewOptions (sample data).
//   isActive(component, option, index) — live: real value comparison
//     against the resolved bound value; preview: a representative index-
//     based "first option(s) look selected" state (no live record to
//     compare against) — same per-variant logic the preview always used.
//   editable(component) / onSelect(component, optionValue) — same shape
//     as every other interactive type.
//   decorate(el, component, meta) — optional; live: assignBindingMetadata.
//   wrapEmptyOptions(component, labelText) — optional; preview only, the
//     canvas "no options configured" hint.
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
  // (.template-select-tag/.is-active) for tags and Bootstrap's own
  // .btn-outline-secondary for buttons/pills, ignoring this component's
  // own color data entirely despite Colors already showing pickers for it.
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
// Text/Foreground/Background/Border directly and paints its own compact shape
// — applying the SAME colors to the component's outer wrapper too (every
// other type's normal treatment, via applyComponentStyles) would color
// the whole field, label area included, not just the shape. Used by each
// tool's own top-level/repeater-item wrapper-coloring call site to
// exclude just Toggle from that generic treatment; every other type is
// returned untouched.
//
// Clearing borderStyle (not just borderColor) is the part that actually
// matters — borderStyle is the border on/off switch everywhere else in
// this app (applyComponentStyles' own border-per-side loop only draws
// `enabled ? borderStyle : "none"`), so leaving Toggle's real
// borderStyle/borderWidth ("solid"/1, its own seeded defaults) on this
// stripped copy while only blanking borderColor left the wrapper drawing
// a real 1px solid border with no explicit color — which the browser
// resolves to currentColor, not "no border." Blanking borderStyle too
// (borderWidth/borderSides along with it, matching the exact cleanup
// hydrateComponent's own "style is the switch" rule already does
// elsewhere) makes the wrapper's border generically off, the same way an
// author leaving Style at "None" would for any other type.
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
// (`label`) are kept separate — collapsing both into one string (the
// original design, and every version of Toggle before this fix) meant
// click-to-cycle only ever wrote/matched a state's display NAME, which
// silently fails to match real bound data keyed by a Source entry's own
// `sourceId` (the established canonical identifier throughout this app —
// see common/js/lib/system-lookup-tables.js/bindings.js's createLookupFn).
// A Toggle bound to `@proficiencies` with data storing a numeric
// proficiency rank never matched any state by name, so every repeater row
// fell back to the same static component.activeIndex, and clicking wrote
// a name string that could never match back on the next read either.
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
// deliberately NOT anything derived from the System/Source (see
// feedback_visual_data_never_on_system memory: the same semantic states
// need to render differently per template, and even per System — D&D 5e
// proficiency vs. Pathfinder's own scale don't agree on how many levels
// exist or how they should look). Keyed by the state entry's own `value`
// (String()'d — see toggleStateEntryFromRaw above), so it survives
// reordering the Source list and matches the same identity everything else
// uses. A state with no configured entry falls back to its position in the
// list — the original algorithm, kept as a reasonable zero-authoring
// default that a template author only needs to override where it's
// actually wrong (e.g. D&D's Half vs. Half Round Up, which sit at
// different positions but should look the same).
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
// wrapping around, and the shape's fill level/ring reflect the active
// state via resolveToggleStateStyle above. `component.shape` picks which
// CSS shape variant renders (circle/square/diamond/star/...; see
// common/css/shell.css's .template-toggle-shape family) — one choice per
// component, not per state. `component.width`/`height` (free CSS-value
// text, same convention as Image's own fields) are optional and applied
// as inline styles only when set — blank leaves the glyph's normal
// stretch-to-fill sizing untouched. Toggle is the one type with all four
// color concepts at once (colorControls: ["text","foreground","background",
// "border"]): `component.textColor` colors the field's own label ONLY;
// `component.foregroundColor` drives the shape's own fill (Text and
// Foreground used to be the same field — exactly the confusion the split
// exists to remove, see COLOR_FIELD_MAP's own comment,
// workbench-template-view.js); `backgroundColor`/`borderColor` are the
// shape's resting background/outline. The fill and outline reach the
// glyph via CSS custom-property hooks (a pseudo-element can only be
// styled through CSS) rather than inheriting from an outer wrapper
// applyComponentStyles might color instead. `ctx`:
//   resolveStates(component) — {value, label}[]; live: resolveToggleStates
//     (as-authored); preview: resolveTogglePreviewStates (sample data).
//   resolveActiveIndex(component, states) — which state index is active;
//     each side's own existing resolution logic, unchanged (matches
//     against `states[i].value`, not `.label`).
//   editable(component) — whether clicking should do anything. NOT every
//     caller should reuse a general "isEditable" helper as-is here — see
//     feedback_play_mode_never_editable_by_default memory; Toggle-like
//     indicators are Edit-mode-only, never clickable in Play view
//     regardless of other rights.
//   onChange(component, value) — same shape as every other interactive
//     type; called with the NEXT state's `value` (its real identity, not
//     its display label) on click.
//   decorate(el, component) — optional; live: assignBindingMetadata.
//   wrapEmptyStates(field) — optional; preview only, the canvas "select a
//     source" hint when no states are configured yet.
//   previewFillLevel — optional number; preview only, forces this fill
//     level (and no ring) regardless of the real active state — see this
//     function's own comment on why, right where it's read.
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
  // ctx.previewFillLevel — optional, preview-only override (see
  // renderTogglePreview, workbench-template-view.js): forces a half-filled
  // look regardless of the component's own real active state, so an
  // author configuring Background/Foreground can actually see both colors
  // at once in the canvas instead of whatever fill the default active
  // state happens to have (easily 0 or 1, hiding one color entirely).
  // Real Play/Edit never sets this — the actual active state's real fill
  // always renders there.
  const hasPreviewOverride = typeof ctx.previewFillLevel === "number";
  const fillLevel = hasPreviewOverride ? ctx.previewFillLevel : resolvedStyle.fillLevel;
  const ring = hasPreviewOverride ? false : resolvedStyle.ring;
  glyph.classList.toggle("has-ring", ring);
  // Solid fillLevel (0-1) reveal, bottom-up — Background is the color
  // behind the shape (what shows in the unfilled portion), Foreground is
  // the shape itself (what shows in the filled portion). No opacity
  // blending: a fade that never reaches full opacity made Foreground look
  // like it wasn't doing anything except at the very top of the scale,
  // since Background was always showing through underneath regardless of
  // how full the state was — a clean two-tone split (like the classic 5e
  // half-filled proficiency dot) makes both colors independently and
  // fully visible at any fill level, matching the wording actually used
  // for them (Background=behind, Foreground=the shape).
  glyph.style.setProperty("--template-toggle-level", fillLevel.toFixed(3));
  // --template-toggle-fill-color feeds the ::before fill layer (a pseudo-
  // element can only ever be styled via CSS, never a direct inline style)
  // and --template-toggle-border-color feeds .has-ring's own outline (see
  // shell.css) — everything else below is a real border/background,
  // applied directly, the same unconditional "reflect whatever's actually
  // stored" way applyComponentStyles (component-styles.js) already applies
  // borders to every other type's own outer wrapper. This glyph is a
  // separate element from that wrapper (which Toggle is deliberately
  // excluded from having ITS OWN border/background applied to — see
  // excludeToggleWrapperColors — so there's exactly one place these
  // render, not two).
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
  // Corner radius only applies to the "square" shape — every other shape
  // already has its own silhouette (circle's border-radius:999px,
  // diamond/star/diamond-quarters' clip-path) that an independently
  // authored radius would conflict with rather than compose with, not
  // something a plain number field can resolve sanely on its own.
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
  // Set directly, not left to inherit from an outer wrapper's own `color`
  // — Toggle's outer wrapper is deliberately excluded from getting any of
  // its own color styling (see excludeToggleWrapperColors, used by each
  // tool's wrapper-coloring call site), so there's nothing to inherit from
  // even if TOGGLE_LABEL_CLASSES' own !important-free classes allowed it.
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
