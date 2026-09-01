import { createCollapseToggleButton, setElementCollapsed } from "../../common/js/lib/collapsible.js";
import { bindCopyButton } from "../../common/js/lib/clipboard.js";
import { COMPONENT_ICONS } from "../../common/js/lib/component-icons.js";
import {
  ensureDdbIconOptionsLoaded,
  ensureBootstrapIconNamesLoaded,
  getAllIconOptions,
  attachIconAutocomplete,
} from "../../common/js/lib/icon-picker.js";
import { attachFontFamilyAutocomplete, validateFontInput } from "../../common/js/lib/font-picker.js";
import {
  CLASS_NAME_SUGGESTIONS,
  splitClassTokens,
  attachClassNameAutocomplete,
} from "../../common/js/lib/class-name-picker.js";
import { TEXT_SIZE_PX, pxToPt, ptToPx } from "../../common/js/lib/text-size.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { DataManager } from "../../common/js/lib/data-manager.js";
import { resolveApiBase } from "../../common/js/lib/api.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import {
  createJsonDataPanel,
  createCollapsibleSection,
  createToolbarButtonGroup,
  createIconButton,
  createFormFloatingField,
  createButtonCheckGroup,
  createCheckField,
  createCompactField,
  createModeToggleGroup,
} from "../../common/js/lib/ui-components.js";
import { createFormulaToggleField, createHalfWidthNumberField, createFieldRow } from "../../common/js/lib/inspector-fields.js";
import { createSortable } from "../../common/js/lib/dnd.js";
import {
  normalizeLegacyLayoutNode,
  applyAutoWidthCaps,
  applyAutoFontSizing,
  applyOverflowIndicators,
} from "./template-renderer.js";
import { expandPane } from "../../common/js/lib/panes.js";
import {
  createTemplate,
  getFormatById,
  getPageSize,
  getStandardFormats,
  getTemplateById,
  getTemplates,
  buildTemplatePreview,
  loadTemplates,
  computeBleedInsets,
  collectTemplateBindingPaths,
  loadCustomPageSizes,
  registerCustomPageSize,
  saveCustomPageSize,
  getRepeatData,
  getCardPageCount,
  getRepeatItemCount,
  resolveTemplateData,
} from "./templates.js";
import { getSourceById, getSources } from "./sources.js";
import { loadSourceData, LIBRARY_KINDS } from "./source-data.js";
import { loadSampleData, setSampleDataText, getSampleDataText, getSampleData, subscribeSampleData } from "./sample-data.js";
import { resolveBinding, createLookupFn } from "../../common/js/lib/bindings.js";
import { createColorPickerField } from "../../common/js/lib/color-picker.js";
import { refreshTooltips, disposeTooltips, updateTooltipContent, setDisabledTooltip } from "../../common/js/lib/tooltips.js";
import { attachFormulaAutocomplete } from "../../common/js/lib/formula-autocomplete.js";
import { listFormulaFunctionMetadata } from "../../common/js/lib/formula-metadata.js";
import { collectDataFields } from "../../common/js/lib/data-fields.js";
import { allowsDeleteForRecord, confirmDelete } from "../../common/js/lib/ownership.js";
import {
  PATTERN_CATEGORIES,
  getPresetsByCategory,
  getPresetDefaultValues,
  svgToDataUri,
  embedPatternMetadata,
  extractPatternMetadata,
} from "../../common/js/lib/pattern-library.js";
import {
  getAllFontOptions,
  findFontOptionByFamily,
  ensureFontLoaded,
  registerCustomFont,
  loadCustomFonts,
  saveCustomFont,
  deleteCustomFont,
  saveCustomFontDeletion,
  isCustomFontId,
  DEFAULT_FONT_FAMILY,
} from "../../common/js/lib/font-library.js";

// Built and mounted before any of the querySelector/getElementById lines
// below query these buttons (by data-action/data-template-*), so every
// existing selector/disabled-state call site elsewhere in this file keeps
// working unchanged. New/Save/Duplicate/Delete Template consolidated here
// (Duplicate/Delete used to live in their own right-pane toolbar row,
// data-template-toolbar-mount — now removed) — same New/Save/Duplicate/
// Delete/Undo/Redo order and single left-pane toolbar cluster every other
// tool uses. Print moved OUT of this cluster entirely — it's Press's own
// one true primary action, not a New/Save/Duplicate/Delete/Undo/Redo slot —
// and is now a standalone static button in the center pane (index.html,
// id="printButton", queried by id below same as before). Import/Export
// moved into the JSON Data panel's own onImport/onExport instead of living
// here as standalone buttons — see jsonDataPanel's own construction below.
createToolbarButtonGroup([
  { action: "new", label: "New Template", attrs: { "data-action": "new-template" } },
  { action: "save", label: "Save", attrs: { "data-action": "save-layout" } },
  { action: "duplicate", label: "Duplicate Template", attrs: { "data-template-duplicate": true } },
  { action: "delete", label: "Delete Template", visible: false, attrs: { "data-template-delete": true } },
]).forEach((button) => document.querySelector("[data-press-toolbar-mount]")?.appendChild(button));
// A small visual break, not a functional one — same convention every other
// tool's toolbar now uses (see forge/js/app.js's own comment).
createToolbarButtonGroup([
  { action: "undo", label: "Undo", attrs: { "data-action": "undo-layout" } },
  { action: "redo", label: "Redo", attrs: { "data-action": "redo-layout" } },
]).forEach((button) => document.querySelector("[data-press-undo-toolbar-mount]")?.appendChild(button));

// The Component/Template Inspector's individually-toggled property fields
// (createFormFloatingField/createButtonCheckGroup/createCheckField/
// createCompactField — common/js/lib/ui-components.js) — built and mounted
// here, before any of the querySelector/getElementById lines below query
// them by id or data-component-*/data-template-* attribute, so every
// existing selector/read/write call site elsewhere in this file keeps
// working unchanged. Each field here is genuinely one-of-a-kind (not
// duplicated across the suite, or even within this file) — this exists to
// turn "one repeated markup shape, many distinct configs" into data, not to
// introduce a new abstraction the content doesn't need. Left as static HTML
// on purpose (not migrated): the icon-field and image-url input-groups, the
// component-type-summary card, and the already JS-generated color fields
// (data-inspector-color-fields, built separately by createColorPickerField)
// — none of those are the same repeated shape, forcing them through would
// be a new abstraction for content that doesn't need one.
//
// replaceWith, not appendChild — the built field becomes the flex item
// itself instead of sitting inside an extra wrapper div. That wrapper used
// to stay in-flow (0 height, but still a real flex child) even when the
// field inside it was conditionally hidden, so every hidden field between
// two visible ones was still spending a full gap-3 on both sides of it —
// stacked across a dozen conditionally-hidden fields, that's what produced
// the large dead space users were seeing in the inspector. Any class the
// static mount div itself carried (grid col-* sizing, mostly) is merged
// onto the built field so removing the wrapper doesn't lose that layout.
function mountInspectorField(key, element) {
  const mount = document.querySelector(`[data-inspector-mount="${key}"]`);
  if (!mount) return;
  if (mount.className) element.classList.add(...mount.classList);
  mount.replaceWith(element);
}

// Template Properties — previously ~30 hand-built label+input pairs across
// this file's Template/Grid Properties panels and Position/Image-size/
// Pan-Zoom/Border fields, none backed by any factory (createCompactField
// didn't exist yet). All read/written externally via the same data-*
// attribute query convention every other field in this file already uses —
// these mount calls only build the markup.
// ID/Name/Description/Type/Base font specifically use createFormFloatingField
// (the condensed "label folded into the box" shape) rather than
// createCompactField — matching the identity/metadata fields in Workbench's
// own Template Properties panel, which made the same switch. The rest of
// this file's Template/Grid Properties fields (grid-packed pairs like
// Width/Height, and the Formats/Sources multi-selects createFormFloatingField
// has no "select-multiple" support for) stay on createCompactField, same as
// Workbench kept those in the "dense grid-packed field" category.
mountInspectorField("template-id", createFormFloatingField({ type: "text", id: "templateId", label: "ID", dataAttr: "data-template-id", placeholder: " " }));
mountInspectorField("template-name", createFormFloatingField({ type: "text", id: "templateName", label: "Name", dataAttr: "data-template-name", placeholder: " " }));
mountInspectorField(
  "template-type",
  createFormFloatingField({
    type: "select",
    id: "templateType",
    label: "Type",
    dataAttr: "data-template-type",
    options: [
      { value: "sheet", label: "Sheet" },
      { value: "card", label: "Card" },
      { value: "chip", label: "Chip" },
    ],
  })
);
mountInspectorField(
  "template-description",
  createFormFloatingField({
    type: "textarea",
    id: "templateDescription",
    label: "Description",
    dataAttr: "data-template-description",
    placeholder: " ",
    // Bootstrap's form-floating needs an explicit height on textareas —
    // same fixed rows*24 formula Workbench's identical field uses.
    style: "min-height: 48px",
  })
);
mountInspectorField(
  "template-base-font",
  createFormFloatingField({ type: "text", id: "templateBaseFont", label: "Base font", dataAttr: "data-template-base-font", autocomplete: "off", placeholder: " " })
);
mountInspectorField(
  "template-formats",
  createCompactField({ type: "select-multiple", id: "templateFormats", label: "Formats", dataAttr: "data-template-formats", size: 6 })
);
mountInspectorField(
  "custom-size-label",
  createCompactField({ type: "text", id: "customSizeLabel", label: "Custom size label", dataAttr: "data-custom-size-label", placeholder: "Postcard" })
);
mountInspectorField(
  "custom-size-width",
  createCompactField({ type: "number", id: "customSizeWidth", label: "Width (in)", dataAttr: "data-custom-size-width", min: 0, step: 0.01 })
);
mountInspectorField(
  "custom-size-height",
  createCompactField({ type: "number", id: "customSizeHeight", label: "Height (in)", dataAttr: "data-custom-size-height", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-sources",
  createCompactField({ type: "select-multiple", id: "templateSources", label: "Supported sources", dataAttr: "data-template-sources", size: 4 })
);
mountInspectorField(
  "template-front-repeat",
  createCompactField({ type: "text", id: "templateFrontRepeat", label: "Front repeat binding", dataAttr: "data-template-front-repeat", placeholder: "@features" })
);
mountInspectorField(
  "template-back-repeat",
  createCompactField({ type: "text", id: "templateBackRepeat", label: "Back repeat binding", dataAttr: "data-template-back-repeat", placeholder: "@features" })
);
mountInspectorField(
  "template-front-data",
  createCompactField({ type: "text", id: "templateFrontData", label: "Front data binding (or global)", dataAttr: "data-template-front-data", placeholder: "@" })
);
mountInspectorField(
  "template-back-data",
  createCompactField({ type: "text", id: "templateBackData", label: "Back data binding (or global)", dataAttr: "data-template-back-data", placeholder: "@" })
);
mountInspectorField(
  "template-card-width",
  createCompactField({ type: "number", id: "templateCardWidth", label: "Cell width (in)", dataAttr: "data-template-card-width", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-card-height",
  createCompactField({ type: "number", id: "templateCardHeight", label: "Cell height (in)", dataAttr: "data-template-card-height", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-card-gutter",
  createCompactField({ type: "number", id: "templateCardGutter", label: "Gutter (in)", dataAttr: "data-template-card-gutter", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-card-safe-inset",
  createCompactField({ type: "number", id: "templateCardSafeInset", label: "Safe inset (in)", dataAttr: "data-template-card-safe-inset", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-card-bleed",
  createCompactField({ type: "number", id: "templateCardBleed", label: "Bleed (in)", dataAttr: "data-template-card-bleed", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-card-corner-radius",
  createCompactField({ type: "number", id: "templateCardCornerRadius", label: "Corner radius (in)", dataAttr: "data-template-card-corner-radius", min: 0, step: 0.01 })
);
mountInspectorField(
  "template-card-columns",
  createCompactField({ type: "number", id: "templateCardColumns", label: "Columns", dataAttr: "data-template-card-columns", min: 1, step: 1 })
);
mountInspectorField(
  "template-card-rows",
  createCompactField({ type: "number", id: "templateCardRows", label: "Rows", dataAttr: "data-template-card-rows", min: 1, step: 1 })
);
mountInspectorField(
  "component-image-width",
  createCompactField({ type: "number", id: "componentImageWidth", label: "Image width (in)", dataAttr: "data-component-image-width", min: 0, step: 0.01 })
);
mountInspectorField(
  "component-image-height",
  createCompactField({ type: "number", id: "componentImageHeight", label: "Image height (in)", dataAttr: "data-component-image-height", min: 0, step: 0.01 })
);
mountInspectorField(
  "component-image-focal-x",
  createCompactField({ type: "number", id: "componentImageFocalX", label: "Pan X (%)", dataAttr: "data-component-image-focal-x", min: 0, max: 100, step: 1, placeholder: 50 })
);
mountInspectorField(
  "component-image-focal-y",
  createCompactField({ type: "number", id: "componentImageFocalY", label: "Pan Y (%)", dataAttr: "data-component-image-focal-y", min: 0, max: 100, step: 1, placeholder: 50 })
);
mountInspectorField(
  "component-image-zoom",
  createCompactField({
    type: "number",
    id: "componentImageZoom",
    label: "Zoom (×)",
    dataAttr: "data-component-image-zoom",
    min: 0.1,
    max: 5,
    step: 0.1,
    placeholder: 1,
    tooltip:
      "Scales past a normal Cover fit, anchored on Pan X/Y — above 1 zooms in on an oversized image, below 1 shrinks it further (may expose empty space around it)",
  })
);
mountInspectorField(
  "component-position-x",
  createCompactField({ type: "number", id: "componentPositionX", label: "X (in)", dataAttr: "data-component-position-x", step: 0.01 })
);
mountInspectorField(
  "component-position-y",
  createCompactField({ type: "number", id: "componentPositionY", label: "Y (in)", dataAttr: "data-component-position-y", step: 0.01 })
);
mountInspectorField(
  "component-position-width",
  createCompactField({ type: "text", id: "componentPositionWidth", label: "Width (in or %)", dataAttr: "data-component-position-width", placeholder: "auto" })
);
mountInspectorField(
  "component-position-height",
  createCompactField({ type: "text", id: "componentPositionHeight", label: "Height (in or %)", dataAttr: "data-component-position-height", placeholder: "auto" })
);
mountInspectorField(
  "component-position-z",
  createCompactField({
    type: "number", id: "componentPositionZ", label: "Z-order", dataAttr: "data-component-position-z", step: 1,
    tooltip: "Stacking order — higher numbers render on top",
  })
);
mountInspectorField(
  "component-position-rotate",
  createCompactField({
    type: "number", id: "componentPositionRotate", label: "Rotate (deg)", dataAttr: "data-component-position-rotate", step: 1,
    tooltip: "Rotation around the element's center",
  })
);
mountInspectorField(
  "component-text-size-line-height",
  createFieldRow(
    [
      createHalfWidthNumberField("Font size (pt)", undefined, undefined, {
        id: "componentTextSizeCustom", dataAttr: "data-component-text-size-custom", step: 0.5, placeholder: "12",
      }),
      createHalfWidthNumberField("Line height", undefined, undefined, {
        id: "componentTextLineHeight", dataAttr: "data-component-text-line-height", min: 0.5, max: 3, step: 0.05, placeholder: "1.3",
        tooltip:
          "Multiplier of the font size, same for every text field by default (1.3) — set explicitly here if you want this one tighter or looser, e.g. to match spacing between inline and non-inline text.",
      }),
    ],
    { columns: 2 }
  )
);
mountInspectorField(
  "component-border-width-radius",
  createFieldRow(
    [
      createHalfWidthNumberField("Thickness (px)", undefined, undefined, {
        id: "componentBorderWidth", dataAttr: "data-component-border-width", min: 0, max: 12, step: 1,
      }),
      createHalfWidthNumberField("Corner radius (px)", undefined, undefined, {
        id: "componentBorderRadius", dataAttr: "data-component-border-radius", min: 0, max: 24, step: 1,
      }),
    ],
    { columns: 2 }
  )
);
mountInspectorField(
  "component-border-style",
  createCompactField({
    type: "select",
    id: "componentBorderStyle",
    label: "Border style",
    dataAttr: "data-component-border-style",
    options: [
      { value: "none", label: "None" },
      { value: "solid", label: "Solid" },
      { value: "dashed", label: "Dashed" },
      { value: "dotted", label: "Dotted" },
      { value: "double", label: "Double" },
      { value: "groove", label: "Groove" },
      { value: "ridge", label: "Ridge" },
      { value: "inset", label: "Inset" },
      { value: "outset", label: "Outset" },
    ],
  })
);
{
  const patternCategoryGroup = createButtonCheckGroup({
    ariaLabel: "Pattern category",
    name: "patternCategory",
    dataAttr: "data-pattern-category",
    options: [
      { id: "patternCategoryFills", value: "fills", text: "Fills" },
      { id: "patternCategoryPatterns", value: "patterns", text: "Patterns" },
      { id: "patternCategoryBanners", value: "banners", text: "Banners" },
      { id: "patternCategoryShapes", value: "shapes", text: "Shapes" },
    ],
  });
  patternCategoryGroup.querySelector("#patternCategoryFills").checked = true;
  mountInspectorField("pattern-category", patternCategoryGroup);
}
mountInspectorField("source-select", createCompactField({ type: "select", id: "sourceSelect", label: "Source", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select" }));
mountInspectorField(
  "template-select",
  createCompactField({
    type: "select", id: "templateSelect", label: "Template", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    helpTopic: "press.templates", helpPlacement: "left",
  })
);
mountInspectorField(
  "format-select",
  createCompactField({
    type: "select", id: "formatSelect", label: "Size", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    helpTopic: "press.size", helpPlacement: "left",
  })
);
mountInspectorField(
  "orientation-select",
  createCompactField({
    type: "select", id: "orientationSelect", label: "Orientation", labelClass: "form-label fw-semibold mb-0", controlClass: "form-select",
    helpTopic: "press.orientation", helpPlacement: "left",
  })
);
mountInspectorField(
  "add-font-value",
  createFormFloatingField({
    type: "text",
    id: "addFontValue",
    label: "Font name or CSS font-family value",
    dataAttr: "data-add-font-value",
    placeholder: "Encode Sans Expanded",
  })
);

mountInspectorField(
  "text",
  createFormFloatingField({
    type: "textarea",
    label: "Binding / Text",
    labelAttr: "data-component-text-label",
    wrapperAttr: "data-inspector-text-field",
    dataAttr: "data-component-text",
    placeholder: "Edit text",
    style: "min-height: 72px",
  })
);
mountInspectorField(
  "repeater-items",
  createFormFloatingField({
    type: "textarea",
    label: "Items",
    dataAttr: "data-component-repeater-items",
    placeholder: "One entry per line, or an @path binding",
    style: "min-height: 72px",
    tooltip:
      "Which array repeats — not what each item shows. Select the actual text/icon/etc. on the canvas and set its own Binding to a key from the item (e.g. @name), same as any other component.",
  })
);
mountInspectorField(
  "repeater-columns",
  createFormFloatingField({
    type: "number",
    id: "componentRepeaterColumns",
    label: "Columns",
    dataAttr: "data-component-repeater-columns",
    min: 1,
    max: 8,
    step: 1,
    placeholder: 1,
  })
);
mountInspectorField(
  "repeater-template-columns",
  createFormFloatingField({
    type: "text",
    label: "Column widths",
    wrapperAttr: "data-inspector-repeater-template-columns",
    hidden: true,
    dataAttr: "data-component-repeater-template-columns",
    placeholder: "30% 70%",
    tooltip: "CSS grid-template-columns-style value for column widths, e.g. 30% 70%",
  })
);
mountInspectorField(
  "repeater-header",
  createCheckField({
    id: "componentRepeaterHeader",
    label: "Header row",
    dataAttr: "data-component-repeater-header",
    switchStyle: true,
  })
);
mountInspectorField(
  "repeater-decorator-type",
  createFormFloatingField({
    type: "select",
    id: "componentRepeaterDecoratorType",
    label: "Item decorator",
    dataAttr: "data-component-repeater-decorator-type",
    tooltip:
      "An optional marker shown before each item — bullet, auto number, or a custom symbol/binding. Doesn't affect what the item itself shows; that's set by binding the item's own content on the canvas.",
    options: [
      { value: "none", label: "None" },
      { value: "bullet", label: "Bullet (•)" },
      { value: "number", label: "Number (1. 2. 3.)" },
      { value: "custom", label: "Custom symbol or binding" },
    ],
  })
);
mountInspectorField(
  "repeater-decorator-text",
  createFormFloatingField({
    type: "text",
    label: "Decorator symbol / binding",
    wrapperAttr: "data-inspector-repeater-decorator-text",
    hidden: true,
    dataAttr: "data-component-repeater-decorator-text",
    placeholder: "→ or @icon",
  })
);
mountInspectorField(
  "image-fit",
  createFormFloatingField({
    type: "select",
    id: "componentImageFit",
    label: "Image fit",
    wrapperAttr: "data-inspector-image-field",
    hidden: true,
    dataAttr: "data-component-image-fit",
    options: [
      { value: "cover", label: "Cover (crop to fill, preserve aspect ratio)" },
      { value: "contain", label: "Contain (fit inside box, preserve aspect ratio)" },
      { value: "fill", label: "Fill (stretch to exactly fill box)" },
    ],
  })
);
mountInspectorField(
  "image-corner-radius",
  createFormFloatingField({
    type: "number",
    id: "componentImageCornerRadius",
    label: "Corner radius (px)",
    wrapperAttr: "data-inspector-image-field",
    hidden: true,
    dataAttr: "data-component-image-corner-radius",
    min: 0,
    step: 1,
    placeholder: 0,
  })
);
mountInspectorField(
  "layer-origin",
  createFormFloatingField({
    type: "select",
    id: "componentLayerOrigin",
    label: "Layer sizes against",
    wrapperAttr: "data-inspector-layer-origin",
    hidden: true,
    dataAttr: "data-component-layer-origin",
    tooltip: "Controls what box this layer (and therefore any 100%-sized placement inside it) sizes against",
    options: [
      { value: "safe", label: "Safe area (inset from the card edge by Safe inset)" },
      { value: "trim", label: "Trim (fills the card exactly)" },
      { value: "bleed", label: "Bleed (extends past the card edge into bleed)" },
    ],
  })
);
mountInspectorField(
  "gap",
  createFormFloatingField({
    type: "number",
    id: "componentGap",
    label: "Gap",
    wrapperAttr: "data-inspector-gap-field",
    hidden: true,
    dataAttr: "data-component-gap",
    min: 0,
    max: 12,
    step: 1,
    placeholder: 4,
  })
);
mountInspectorField(
  "space-after",
  createFormFloatingField({
    type: "number",
    id: "componentSpaceAfter",
    label: "Space after",
    wrapperAttr: "data-inspector-space-after-field",
    hidden: true,
    dataAttr: "data-component-space-after",
    min: 0,
    max: 12,
    step: 1,
    placeholder: 0,
    tooltip:
      "Space after this whole component, before whatever comes next — same scale as Gap, but Gap only affects spacing between this component's own internal items, not its next sibling.",
  })
);
mountInspectorField(
  "row-columns",
  createFormFloatingField({
    type: "number",
    id: "componentColumns",
    label: "Columns",
    wrapperAttr: "data-inspector-row-columns",
    hidden: true,
    dataAttr: "data-component-columns",
    min: 1,
    max: 6,
    step: 1,
    placeholder: 2,
  })
);
mountInspectorField(
  "template-columns",
  createFormFloatingField({
    type: "text",
    label: "Column template",
    wrapperAttr: "data-inspector-template-columns",
    hidden: true,
    dataAttr: "data-component-template-columns",
    placeholder: "1fr 2fr",
    tooltip: "CSS grid-template-columns value, overrides equal-width columns",
  })
);
mountInspectorField(
  "grid-rows",
  createFormFloatingField({
    type: "number",
    id: "componentGridRows",
    label: "Rows",
    wrapperAttr: "data-inspector-grid-rows",
    hidden: true,
    dataAttr: "data-component-grid-rows",
    min: 1,
    max: 24,
    step: 1,
    placeholder: 2,
  })
);
mountInspectorField(
  "template-rows",
  createFormFloatingField({
    type: "text",
    label: "Row template",
    wrapperAttr: "data-inspector-template-rows",
    hidden: true,
    dataAttr: "data-component-template-rows",
    placeholder: "auto auto",
    tooltip: "CSS grid-template-rows value, overrides content-sized rows",
  })
);
mountInspectorField(
  "align-x",
  createButtonCheckGroup({
    ariaLabel: "Horizontal alignment",
    name: "componentAlignX",
    dataAttr: "data-component-align-x",
    options: [
      { id: "componentAlignXStart", value: "start", icon: "tabler:align-left", text: "Left", tooltip: "Align left" },
      { id: "componentAlignXCenter", value: "center", icon: "tabler:align-center", text: "Center", tooltip: "Align center" },
      { id: "componentAlignXEnd", value: "end", icon: "tabler:align-right", text: "Right", tooltip: "Align right" },
      { id: "componentAlignXJustify", value: "justify", icon: "tabler:align-justified", text: "Stretch", tooltip: "Stretch to fill" },
    ],
  })
);
mountInspectorField(
  "align-y",
  createButtonCheckGroup({
    ariaLabel: "Vertical alignment",
    name: "componentAlignY",
    dataAttr: "data-component-align-y",
    options: [
      { id: "componentAlignYStart", value: "start", icon: "tabler:layout-align-top", text: "Top", tooltip: "Align top" },
      { id: "componentAlignYCenter", value: "center", icon: "tabler:layout-align-middle", text: "Middle", tooltip: "Align middle" },
      { id: "componentAlignYEnd", value: "end", icon: "tabler:layout-align-bottom", text: "Bottom", tooltip: "Align bottom" },
      { id: "componentAlignYJustify", value: "justify", icon: "tabler:layout-distribute-vertical", text: "Justified", tooltip: "Space evenly" },
    ],
  })
);
mountInspectorField(
  "font-family",
  createFormFloatingField({
    type: "text",
    id: "componentFontFamily",
    label: "Font",
    dataAttr: "data-component-font-family",
    placeholder: "Search fonts…",
    autocomplete: "off",
  })
);
mountInspectorField(
  "text-size",
  createButtonCheckGroup({
    ariaLabel: "Font size",
    name: "componentTextSize",
    dataAttr: "data-component-text-size",
    options: [
      { id: "componentTextSizeXs", value: "xs", text: "XS", tooltip: "Extra small" },
      { id: "componentTextSizeSm", value: "sm", text: "Sm", tooltip: "Small" },
      { id: "componentTextSizeMd", value: "md", text: "Md", tooltip: "Medium" },
      { id: "componentTextSizeLg", value: "lg", text: "Lg", tooltip: "Large" },
      { id: "componentTextSizeXl", value: "xl", text: "XL", tooltip: "Extra large" },
      {
        id: "componentTextSizeAuto",
        value: "auto",
        text: "Auto",
        tooltip:
          "Shrinks the text to fit its container instead of using a fixed size — only has an effect where the container is actually size-constrained, e.g. a Layer placement with a set width/height.",
      },
    ],
  })
);
mountInspectorField(
  "text-inline",
  createCheckField({
    id: "componentTextInline",
    label: "Inline (flows with the next component)",
    dataAttr: "data-component-text-inline",
    switchStyle: true,
    tooltip:
      "Flows this text inline with whatever comes right after it in the same cell (e.g. a bold heading immediately followed by a plain description) instead of stacking as its own block/line.",
  })
);
mountInspectorField(
  "text-orientation",
  createButtonCheckGroup({
    groupClassName: "btn-group template-radio-group press-text-orientation-group",
    ariaLabel: "Text orientation",
    name: "componentTextOrientation",
    dataAttr: "data-component-text-orientation",
    options: [
      { id: "componentTextOrientationHorizontal", value: "horizontal", text: "Horizontal", tooltip: "Reading left to right" },
      { id: "componentTextOrientationVertical", value: "vertical", text: "Vertical", tooltip: "Rotated 90°" },
      { id: "componentTextOrientationDiagonal", value: "diagonal", text: "Diagonal", tooltip: "Rotated 45°" },
      { id: "componentTextOrientationCurveUp", value: "curve-up", text: "Curved up", tooltip: "Arcs upward" },
      { id: "componentTextOrientationCurveDown", value: "curve-down", text: "Curved down", tooltip: "Arcs downward" },
    ],
  })
);
mountInspectorField(
  "text-decoration",
  createButtonCheckGroup({
    ariaLabel: "Text decoration",
    inputType: "checkbox",
    dataAttr: "data-component-text-style",
    options: [
      { id: "componentTextBold", dataValue: "bold", icon: "tabler:bold", text: "Bold", tooltip: "Bold" },
      { id: "componentTextItalic", dataValue: "italic", icon: "tabler:italic", text: "Italic", tooltip: "Italic" },
      { id: "componentTextUnderline", dataValue: "underline", icon: "tabler:underline", text: "Underline", tooltip: "Underline" },
    ],
  })
);
mountInspectorField(
  "alignment",
  createButtonCheckGroup({
    ariaLabel: "Text alignment",
    name: "componentAlignment",
    dataAttr: "data-component-align",
    options: [
      { id: "componentAlignStart", value: "start", icon: "tabler:align-left", text: "Left", tooltip: "Align left", labelAttr: "data-alignment-label", labelAttrValue: "start" },
      { id: "componentAlignCenter", value: "center", icon: "tabler:align-center", text: "Center", tooltip: "Align center", labelAttr: "data-alignment-label", labelAttrValue: "center" },
      { id: "componentAlignEnd", value: "end", icon: "tabler:align-right", text: "Right", tooltip: "Align right", labelAttr: "data-alignment-label", labelAttrValue: "end" },
      { id: "componentAlignJustify", value: "justify", icon: "tabler:align-justified", text: "Justify", tooltip: "Justify", labelAttr: "data-alignment-label", labelAttrValue: "justify" },
    ],
  })
);
mountInspectorField(
  "border-sides",
  createButtonCheckGroup({
    ariaLabel: "Border sides",
    inputType: "checkbox",
    dataAttr: "data-component-border-side",
    options: [
      { id: "componentBorderSideTop", dataValue: "top", text: "Top" },
      { id: "componentBorderSideRight", dataValue: "right", text: "Right" },
      { id: "componentBorderSideBottom", dataValue: "bottom", text: "Bottom" },
      { id: "componentBorderSideLeft", dataValue: "left", text: "Left" },
    ],
  })
);
// The same unified toggle/formula control Workbench's Template editor uses
// (createFormulaToggleField, common/js/lib/inspector-fields.js) — one
// switch + one inline binding/formula field instead of two visually
// disconnected controls. Press's own visibleWhen storage was already a
// single field supporting both "@binding" and "=formula" syntax
// (resolveBindingWithLookup handles both), so only the control's shape
// changes here, not the data model.
const visibleField = createFormulaToggleField("Visible", {
  placeholder: "@attributes.isSecret or =not(@hideThis)",
  evaluate: (raw) => {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return undefined;
    return Boolean(resolveBindingWithLookup(trimmed, getSampleData()));
  },
  onManualChange: (checked) => {
    // Only fires from a real manual click — the switch is disabled
    // whenever visibleWhen has content (see createFormulaToggleField).
    recordUndoableChange(() => {
      updateSelectedNode((node) => {
        node.hidden = !checked;
      });
      renderPreview();
      renderLayoutList();
    });
  },
  onBindingChange: (raw) => {
    updateSelectedNode((node) => {
      const next = raw.trim();
      if (next) {
        node.visibleWhen = next;
      } else {
        delete node.visibleWhen;
      }
    });
    renderPreview();
    renderLayoutList();
    updateSaveState();
  },
});
visibleField.bindingInput.autocomplete = "off";
visibleField.bindingInput.spellcheck = false;
mountInspectorField("visible", visibleField);
mountInspectorField(
  "aria-label",
  createFormFloatingField({
    type: "text",
    label: "Aria label",
    wrapperAttr: "data-inspector-aria-label-field",
    hidden: true,
    dataAttr: "data-component-aria-label",
    placeholder: "Aria label",
  })
);
mountInspectorField(
  "class-name",
  createFormFloatingField({
    type: "text",
    label: "Classes",
    wrapperAttr: "data-inspector-class-name-field",
    dataAttr: "data-component-class-name",
    placeholder: "Classes",
    autocomplete: "off",
  })
);

const templateSelect = document.getElementById("templateSelect");
const formatSelect = document.getElementById("formatSelect");
const orientationSelect = document.getElementById("orientationSelect");
const sourceSelect = document.getElementById("sourceSelect");
const sourceInputContainer = document.getElementById("sourceInputContainer");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
const cardPageNav = document.querySelector("[data-card-page-nav]");
const cardPagePrevButton = document.querySelector("[data-card-page-prev]");
const cardPageNextButton = document.querySelector("[data-card-page-next]");
const cardPageLabel = document.querySelector("[data-card-page-label]");
// Mode toggle (createModeToggleGroup) replaces the old nav-tabs pair —
// rebuilds fresh on every renderModeToggle() call, so there's no persistent
// "grid tab button" reference the way the old static nav-link was; the
// "disabled while this template has no real grid" state (updateGridViewAvailability)
// is instead re-applied to the freshly-built radio input each render.
const modeToggleMount = document.querySelector("[data-press-mode-toggle-mount]");
const viewControlsPreview = document.querySelector('[data-view-controls="preview"]');
const viewControlsGrid = document.querySelector('[data-view-controls="grid"]');
const viewPanelPreview = document.querySelector('[data-view-panel="preview"]');
const viewPanelGrid = document.querySelector('[data-view-panel="grid"]');
const gridViewPrevButton = document.querySelector("[data-grid-view-prev]");
const gridViewNextButton = document.querySelector("[data-grid-view-next]");
const gridViewLabel = document.querySelector("[data-grid-view-label]");
const gridViewStageFront = document.querySelector('[data-grid-view-stage="front"]');
const gridViewStageBack = document.querySelector('[data-grid-view-stage="back"]');
const canvasZoomOutButton = document.querySelector("[data-canvas-zoom-out]");
const canvasZoomInButton = document.querySelector("[data-canvas-zoom-in]");
const canvasZoomResetButton = document.querySelector("[data-canvas-zoom-reset]");
const canvasZoomLevelLabel = document.querySelector("[data-canvas-zoom-level]");
const guideLegendElement = document.querySelector("[data-canvas-guide-legend]");
const generateButton = document.getElementById("generateButton");
const printButton = document.getElementById("printButton");
// selectionToggle/selectionPanel used to be queried here as static markup;
// the section is now built inside initPressCollapsibles() instead (see
// there), since createCollapsibleSection needs to run after
// applySelectionCollapse's own `let` declaration further down this file.
const newTemplateButton = document.querySelector('[data-action="new-template"]');
const undoButton = document.querySelector('[data-action="undo-layout"]');
const redoButton = document.querySelector('[data-action="redo-layout"]');
const saveButton = document.querySelector('[data-action="save-layout"]');
const paletteList = document.querySelector("[data-press-palette]");
const layoutList = document.querySelector("[data-layout-list]");
const layoutEmptyState = document.querySelector("[data-layout-empty]");

// JSON Data — a plain readonly preview, built via the shared factory (same
// shape as every other tool's JSON Data panel). getSelectionContext/
// resolveBasePreviewData are function declarations (hoisted) and
// buildTemplatePreview is an import, so referencing them here — well before
// their own definitions further down the file — is safe; this closure only
// runs when jsonDataPanel.render() is actually called, always well after
// full module evaluation.
// The old toolbar's own "Import"/"Export" buttons (data-action="import-
// layout"/"export-layout") were confirmed dead code before this pass — no
// click handler existed anywhere for either, in this file or elsewhere.
// Export gets a real implementation here (same Blob/anchor/download shape
// every other tool's own JSON export uses, over this panel's own getData
// output); Import has no well-defined "apply this back" meaning to build
// against — getData below returns a fully RESOLVED preview (template +
// bindings + data already merged), not the editable Template/Component
// source of truth, so there's nothing coherent to round-trip it into. Left
// out rather than fabricated.
const jsonDataPanel = createJsonDataPanel({
  label: "JSON Data",
  id: "press-json",
  getData: () => {
    const context = getSelectionContext();
    if (!context.template) {
      return {};
    }
    const previewData = resolveBasePreviewData();
    return buildTemplatePreview(context.template, previewData);
  },
  onExport: () => {
    const context = getSelectionContext();
    if (!context.template) {
      status?.show("Select a template to export.", { type: "info", timeout: 2000 });
      return;
    }
    const previewData = resolveBasePreviewData();
    const data = buildTemplatePreview(context.template, previewData);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${context.template.id || "press-preview"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },
});

// Sample Data — an editable textarea (readonly only while showing a real
// loaded record's data instead of the placeholder sample), so it's built
// from the lower-level createCollapsibleSection rather than
// createJsonDataPanel, which always renders readonly.
const sampleDataInput = document.createElement("textarea");
sampleDataInput.className = "form-control form-control-sm font-monospace json-preview-text";
sampleDataInput.id = "press-sample-data-input";
sampleDataInput.rows = 10;
sampleDataInput.setAttribute("data-sample-data-input", "");
const sampleDataError = document.createElement("div");
sampleDataError.className = "invalid-feedback d-block mt-2 d-none";
sampleDataError.setAttribute("data-sample-data-error", "");
const sampleDataSection = createCollapsibleSection({
  label: "Sample Data",
  id: "press-sample-data",
  helpTopic: "press.sample-data",
  actions: [{ icon: "tabler:copy", label: "Copy to clipboard" }],
  content: (panel) => panel.append(sampleDataInput, sampleDataError),
});
sampleDataSection.section.setAttribute("data-sample-data-section", "");
const [sampleDataCopyButton] = sampleDataSection.actionButtons;
const sampleDataLabel = sampleDataSection.header.querySelector("h2");
const templateInspector = document.querySelector("[data-template-inspector]");
const templateIdInput = document.querySelector("[data-template-id]");
const templateNameInput = document.querySelector("[data-template-name]");
const templateDescriptionInput = document.querySelector("[data-template-description]");
const templateTypeSelect = document.querySelector("[data-template-type]");
const templateBaseFontInput = document.querySelector("[data-template-base-font]");
const templateFormatsSelect = document.querySelector("[data-template-formats]");
const customSizeLabelInput = document.querySelector("[data-custom-size-label]");
const customSizeWidthInput = document.querySelector("[data-custom-size-width]");
const customSizeHeightInput = document.querySelector("[data-custom-size-height]");
const customSizeAddButton = document.querySelector("[data-custom-size-add]");
const templateSourcesSelect = document.querySelector("[data-template-sources]");
const templateCardGroup = document.querySelector("[data-template-card-group]");
const templateCardWidthInput = document.querySelector("[data-template-card-width]");
const templateCardHeightInput = document.querySelector("[data-template-card-height]");
const templateCardGutterInput = document.querySelector("[data-template-card-gutter]");
const templateCardSafeInsetInput = document.querySelector("[data-template-card-safe-inset]");
const templateCardBleedInput = document.querySelector("[data-template-card-bleed]");
const templateCardCornerRadiusInput = document.querySelector("[data-template-card-corner-radius]");
const templateCardColumnsInput = document.querySelector("[data-template-card-columns]");
const templateCardRowsInput = document.querySelector("[data-template-card-rows]");
const templateFrontDataInput = document.querySelector("[data-template-front-data]");
const templateFrontRepeatInput = document.querySelector("[data-template-front-repeat]");
const templateBackDataInput = document.querySelector("[data-template-back-data]");
const templateBackRepeatInput = document.querySelector("[data-template-back-repeat]");
// templateToggle/templatePanel used to be queried here as static markup;
// the section is now built inside initPressCollapsibles() instead (see
// there), since it needs to run after applyTemplateCollapse's own `let`
// declaration further down this file. Page Bindings/Grid Properties now use
// the same makeInspectorGroupCollapsible mechanism the Component Inspector's
// own groups do (initPressCollapsibles), which builds its own body wrapper
// from static markup directly — no separate panel div to query here anymore.
const templateSaveButton = document.querySelector("[data-template-save]");
// Built and mounted before the querySelector lines just below, so every
// existing selector/disabled-state/title call site elsewhere in this file
// keeps working unchanged. Clear Uniqueness has no ACTION_PRESETS match, so
// its icon/variant are both explicit. Both Duplicate's and (further below)
// Component's tooltip text is longer than their aria-label/visible-hidden
// text — attrs' own data-bs-title, applied after the label-driven one
// inside createIconButton, overrides just the tooltip without touching
// aria-label.
// Clear all uniqueness itself is now built as one of the Template
// Properties collapsible section's own header `actions` (see
// initPressCollapsibles below) rather than a standalone toolbar row — same
// data-template-clear-uniqueness attribute, so the click listener further
// below still finds it unchanged.

const templateDuplicateButton = document.querySelector("[data-template-duplicate]");
const templateClearUniquenessButton = document.querySelector("[data-template-clear-uniqueness]");
const templateDeleteButton = document.querySelector("[data-template-delete]");
// componentToggle/componentPanel (full section migration) are now built
// inside initPressCollapsibles() instead of queried here — see there.
const inspectorSection = document.querySelector("[data-component-inspector]");
const typeSummary = document.querySelector("[data-component-type-summary]");
let typeIcon = document.querySelector("[data-component-type-icon]");
const typeLabel = document.querySelector("[data-component-type-label]");
const typeDescription = document.querySelector("[data-component-type-description]");
const parentIndicator = document.querySelector("[data-component-parent-indicator]");
const parentSelectButton = document.querySelector("[data-component-parent-select]");
const iconField = document.querySelector("[data-inspector-icon-field]");
const iconInput = document.querySelector("[data-component-icon-class]");
const iconPreview = document.querySelector("[data-component-icon-preview]");
const textEditor = document.querySelector("[data-component-text]");
const textEditorLabel = document.querySelector("[data-component-text-label]");
const ariaLabelField = document.querySelector("[data-inspector-aria-label-field]");
const ariaLabelInput = document.querySelector("[data-component-aria-label]");
const classNameField = document.querySelector("[data-inspector-class-name-field]");
const classNameInput = document.querySelector("[data-component-class-name]");

const imageFieldGroups = Array.from(document.querySelectorAll("[data-inspector-image-field]"));
const imageSizeFieldGroup = document.querySelector("[data-inspector-image-size-field]");
const imageUrlInput = document.querySelector("[data-component-image-url]");
const imageWidthInput = document.querySelector("[data-component-image-width]");
const imageHeightInput = document.querySelector("[data-component-image-height]");
const imageFitInput = document.querySelector("[data-component-image-fit]");
const imageCornerRadiusInput = document.querySelector("[data-component-image-corner-radius]");
const imageFocalXInput = document.querySelector("[data-component-image-focal-x]");
const imageFocalYInput = document.querySelector("[data-component-image-focal-y]");
const imageZoomInput = document.querySelector("[data-component-image-zoom]");
const patternPickerOpenButton = document.querySelector("[data-pattern-picker-open]");
const patternModalElement = document.getElementById("press-pattern-modal");
const patternCategoryInputs = Array.from(document.querySelectorAll("[data-pattern-category]"));
const patternThumbnails = document.querySelector("[data-pattern-thumbnails]");
const patternPreviewImg = document.querySelector("[data-pattern-preview]");
const patternPreviewLabel = document.querySelector("[data-pattern-preview-label]");
const patternControls = document.querySelector("[data-pattern-controls]");
const patternInsertButton = document.querySelector("[data-pattern-insert]");
const layerOriginField = document.querySelector("[data-inspector-layer-origin]");
const layerOriginInput = document.querySelector("[data-component-layer-origin]");
const gapInput = document.querySelector("[data-component-gap]");
const gapField = document.querySelector("[data-inspector-gap-field]");
const spaceAfterInput = document.querySelector("[data-component-space-after]");
const spaceAfterField = document.querySelector("[data-inspector-space-after-field]");
const rowColumnsInput = document.querySelector("[data-component-columns]");
const rowColumnsField = document.querySelector("[data-inspector-row-columns]");
const templateColumnsInput = document.querySelector("[data-component-template-columns]");
const templateColumnsField = document.querySelector("[data-inspector-template-columns]");
const gridRowsInput = document.querySelector("[data-component-grid-rows]");
const gridRowsField = document.querySelector("[data-inspector-grid-rows]");
const templateRowsInput = document.querySelector("[data-component-template-rows]");
const templateRowsField = document.querySelector("[data-inspector-template-rows]");
const gridAlignXGroup = document.querySelector("[data-inspector-grid-align-x]");
const gridAlignYGroup = document.querySelector("[data-inspector-grid-align-y]");
const alignXInputs = Array.from(document.querySelectorAll("[data-component-align-x]"));
const alignYInputs = Array.from(document.querySelectorAll("[data-component-align-y]"));
const positionFieldGroups = Array.from(document.querySelectorAll("[data-inspector-position]"));
const positionXInput = document.querySelector("[data-component-position-x]");
const positionYInput = document.querySelector("[data-component-position-y]");
const positionWidthInput = document.querySelector("[data-component-position-width]");
const positionHeightInput = document.querySelector("[data-component-position-height]");
const positionZInput = document.querySelector("[data-component-position-z]");
const positionRotateInput = document.querySelector("[data-component-position-rotate]");
const textFieldGroup = document.querySelector("[data-inspector-text-field]");
const repeaterFieldGroup = document.querySelector("[data-inspector-repeater-fields]");
const textDecorationGroup = document.querySelector("[data-inspector-text-decoration]");
const repeaterItemsInput = document.querySelector("[data-component-repeater-items]");
const repeaterColumnsInput = document.querySelector("[data-component-repeater-columns]");
const repeaterHeaderInput = document.querySelector("[data-component-repeater-header]");
const repeaterTemplateColumnsInput = document.querySelector("[data-component-repeater-template-columns]");
const repeaterTemplateColumnsGroup = document.querySelector("[data-inspector-repeater-template-columns]");
const repeaterDecoratorTypeInput = document.querySelector("[data-component-repeater-decorator-type]");
const repeaterDecoratorTextInput = document.querySelector("[data-component-repeater-decorator-text]");
const repeaterDecoratorTextGroup = document.querySelector("[data-inspector-repeater-decorator-text]");
const textSettingGroups = Array.from(document.querySelectorAll("[data-inspector-text-settings]"));
const textGroupWrapper = document.querySelector("[data-inspector-text-group]");
const fontFamilyInput = document.querySelector("[data-component-font-family]");
const addFontModalElement = document.getElementById("press-add-font-modal");
const addFontValueInput = document.querySelector("[data-add-font-value]");
const addFontSubmitButton = document.querySelector("[data-add-font-submit]");
const addFontWarningElement = document.querySelector("[data-add-font-warning]");
// Registered once here (not inside openAddFontModal, which runs on every
// open) — Bootstrap's own "modal finished appearing" event, the reliable
// point to focus something inside it (focusing earlier can get overridden
// by the modal's own entrance/backdrop focus handling).
if (addFontModalElement) {
  addFontModalElement.addEventListener("shown.bs.modal", () => {
    addFontValueInput?.focus();
  });
}
// The font validated on blur (see attachAddFontValidation), cached so the
// submit handler can reuse it instead of re-verifying — cleared whenever
// the field is edited again, which is also what keeps the Add button
// disabled until a fresh blur-triggered validation succeeds.
let pendingValidatedFont = null;
// Called with the registered {id,label,family,...} once a font is
// confirmed — set by whichever call to openAddFontModal is currently open,
// so the same modal can apply the result either to a node's own Font field
// or to the Template's own base font, without the modal itself needing to
// know which. Mirrors Workbench's identical refactor for the same reason.
let addFontApplyCallback = null;
const colorGroup = document.querySelector("[data-inspector-color-group]");
const alignmentGroup = document.querySelector("[data-inspector-alignment]");
const textSizeInputs = Array.from(document.querySelectorAll("[data-component-text-size]"));
const textSizeCustomInput = document.querySelector("[data-component-text-size-custom]");
const textInlineInput = document.querySelector("[data-component-text-inline]");
const textLineHeightInput = document.querySelector("[data-component-text-line-height]");
const textOrientationInputs = Array.from(document.querySelectorAll("[data-component-text-orientation]"));
const textAngleInput = document.querySelector("[data-component-text-angle]");
const textCurveInput = document.querySelector("[data-component-text-curve]");
// The popover this builds (createColorPickerField) owns its own persistent
// DOM/state (drag square, hue slider, binding box) that a static <input
// type="color"> can't host, so this one part of the otherwise-static
// inspector is rebuilt wholesale on every updateInspector() call instead of
// having its .value synced in place — see renderColorFields.
const colorFieldsContainer = document.querySelector("[data-inspector-color-fields]");
const borderGroup = document.querySelector("[data-inspector-border-group]");
const borderWidthInput = document.querySelector("[data-component-border-width]");
const borderStyleInput = document.querySelector("[data-component-border-style]");
const borderRadiusInput = document.querySelector("[data-component-border-radius]");
const borderSideInputs = Array.from(document.querySelectorAll("[data-component-border-side]"));
const borderSidesField = document.querySelector("[data-inspector-border-sides-field]");
const textStyleToggles = Array.from(document.querySelectorAll("[data-component-text-style]"));
const alignInputs = Array.from(document.querySelectorAll("[data-component-align]"));
const visibilityToggle = visibleField.switchInput;
const visibleWhenInput = visibleField.bindingInput;
// Built and mounted before the querySelector lines just below, so every
// existing selector/state call site elsewhere in this file keeps working
// unchanged. Make Unique has no ACTION_PRESETS match (icon/variant explicit)
// and carries an aria-pressed state the factory doesn't model — set via
// attrs, then flipped directly by this file's own existing
// makeUniqueButton.setAttribute("aria-pressed", ...) calls elsewhere, same
// as before. Delete Component's own visually-hidden label span needs the
// data-component-delete-label marker this file's deleteButtonLabel relies
// on for its own textContent updates — createToolbarButtonGroup builds that
// span internally with no hook to tag it, so it's added as a one-off
// afterward via a plain DOM query on the built button.
const componentToolbarButtons = createToolbarButtonGroup([
  {
    icon: "tabler:fingerprint",
    variant: "outline-secondary",
    label: "Make Unique",
    attrs: {
      "data-component-make-unique": true,
      "aria-pressed": "false",
      "data-bs-title":
        "Make Unique — while on, edits to this component apply only to the card/chip shown in Grid View, not the shared template (only available from the Grid View tab)",
    },
  },
  {
    action: "duplicate",
    label: "Duplicate Component",
    attrs: {
      "data-component-duplicate": true,
      "data-bs-title": "Duplicate — Ctrl+D (also Copy/Cut/Paste with Ctrl+C/Ctrl+X/Ctrl+V on any selected component)",
    },
  },
  { action: "delete", label: "Delete Component", attrs: { "data-component-delete": true } },
]);
componentToolbarButtons[2]?.querySelector(".visually-hidden")?.setAttribute("data-component-delete-label", "");
componentToolbarButtons.forEach((button) => document.querySelector("[data-component-toolbar-mount]")?.appendChild(button));

const deleteButton = document.querySelector("[data-component-delete]");
const deleteButtonLabel = document.querySelector("[data-component-delete-label]");
const duplicateButton = document.querySelector("[data-component-duplicate]");
const makeUniqueButton = document.querySelector("[data-component-make-unique]");

const FORMULA_FUNCTIONS = listFormulaFunctionMetadata();
const MAX_AUTOCOMPLETE_ITEMS = 12;
const bindingAutocompleteInstances = new Set();
const bindingFieldCache = {
  source: null,
  entries: [],
};
// Not a module-top-level const — the <aside> itself is now JS-built by
// buildPaneShell() (common/js/lib/app-shell.js), inside initAppShell(),
// which this file only calls later (from initShell(), invoked from
// initPress()); an eager query here would capture null permanently. Every
// call site below queries it live instead.
function queryRightPane() {
  return document.querySelector('[data-pane="right"]');
}

const sourceValues = {};
const sourcePayloads = {};
let currentSide = "front";
// 0-based index into a card/chip template's physical pages — how many
// pages a side needs depends on its repeated data (getCardPageCount,
// templates.js), so this only ever means anything for those template
// types; renderPreview clamps it every render rather than trusting it to
// always already be in range (switching to a template/side with less data
// than the one currently being viewed, in particular).
let cardPageIndex = 0;
// 0-based index into the full repeat data array (not a physical page —
// see cardPageIndex above for that) for the separate Grid View, which
// always shows exactly one card at a time regardless of the template's
// configured columns/rows. Independent state from cardPageIndex since the
// two views serve different purposes (reviewing the print sheet layout vs.
// targeting one specific card for a "Make Unique" override) and don't need
// to stay in sync.
let gridViewIndex = 0;
// Which of the two Live Preview tabs is currently shown — "Make Unique" is
// only meaningful (and only enabled) while viewing the Grid View, since
// that's the only place a component selection maps unambiguously to one
// specific card (the page-grid view can show several cards per page).
let activeViewTab = "preview";
// Re-applied to the Mode toggle's own "grid" radio input on every
// renderModeToggle() rebuild (see updateGridViewAvailability) — the toggle
// itself has no persistent DOM node the way the old static nav-link did.
let gridViewAvailable = true;
let selectedNodeId = null;
let nodeCounter = 0;
let editablePages = { front: null, back: null };
let paletteSortable = null;
let layoutSortable = null;
let canvasSortables = [];
let undoStack = null;
let performUndo = null;
let performRedo = null;
let isApplyingHistory = false;
let pendingUndoSnapshot = null;
let pendingUndoTarget = null;
let status = null;
// Hoisted from initPress() so tier-gated UI (the font library's
// add/delete controls) can read the current session from the same
// instance initAuthControls manages, not a separate one.
let dataManager = null;
let lastSavedLayout = null;
let isSaving = false;
let isGenerating = false;
let applySelectionCollapse = null;
let applyPaletteCollapse = null;
let applyTemplateCollapse = null;
let applyPageBindingsCollapse = null;
let applyCardCollapse = null;
let applyComponentCollapse = null;
let activeTemplateId = null;
let templateIdAuto = false;
let sampleDataSaveTimer = null;
let sampleDataMode = "sample";

// Placeholder swatch color shown only while the field is unset (covered
// by the X overlay regardless) — never written to the node itself.
const COLOR_DEFAULTS = {
  text: "#212529",
  background: "#ffffff",
  border: "#dee2e6",
};

// One combined field per color (node.style.colorWhen/backgroundColorWhen/
// borderColorWhen) — same "single string, @binding or =formula" shape
// visibleWhen already uses, not Workbench's split Binding+Formula pair
// (Press always has a concrete getSampleData() record to run a formula
// against, so there's no need to distinguish the two the way Workbench's
// preview-only canvas does).
//
// "text" (not "foreground") — matches Workbench's own rename (see that
// tool's COLOR_FIELD_MAP comment): this only ever colors a node's own
// text, so the label said what it does instead of a vaguer, easily
// confused-with-"fill" name. Press has no component with a separate fill
// concept yet (nothing here needs a 4th color the way Workbench's Toggle
// does), so unlike Workbench this stays three entries — the vocabulary
// (prop: "color", same as always) is unaffected, only the key/label.
const COLOR_FIELD_MAP = {
  text: { label: "Text", prop: "color", whenProp: "colorWhen", default: COLOR_DEFAULTS.text },
  background: { label: "Background", prop: "backgroundColor", whenProp: "backgroundColorWhen", default: COLOR_DEFAULTS.background },
  border: { label: "Border", prop: "borderColor", whenProp: "borderColorWhen", default: COLOR_DEFAULTS.border },
};

// Every inspector-side binding/formula preview in this file goes through
// here instead of resolveBinding directly, for the same reason
// template-renderer.js's own identically-named wrapper exists: so
// `lookup(table, key)` (bindings.js's createLookupFn) is available
// everywhere a template author can type a binding/formula, not just
// colors. No System field list is passed here either, matching
// template-renderer.js's own — this inspector's preview should show
// exactly what the real render would, and the real render only ever
// searches `context` (see createLookupFn's own comment on why Press never
// gets a System-schema fallback).
function resolveBindingWithLookup(raw, context) {
  return resolveBinding(raw, context, { functions: { lookup: createLookupFn(context) } });
}

// The picker's own evaluate() hook — mirrors template-renderer.js's
// resolveEffectiveStyles exactly (resolveBindingWithLookup against the same
// sample data everything else in this inspector already previews against),
// so what the swatch shows here always matches what actually renders.
function evaluateColorWhen(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return undefined;
  const resolved = resolveBindingWithLookup(trimmed, getSampleData());
  return typeof resolved === "string" && resolved.trim() ? resolved.trim() : undefined;
}

// Clears and rebuilds the Colors group's three fields for the given node
// (or empties it when node is null) — see colorFieldsContainer's own
// comment on why this section, alone among the inspector, gets rebuilt
// instead of having plain .value assignments synced onto static markup.
function renderColorFields(node) {
  if (!colorFieldsContainer) return;
  colorFieldsContainer.innerHTML = "";
  if (!node) return;
  Object.entries(COLOR_FIELD_MAP).forEach(([key, config]) => {
    const bindingValue = node.style?.[config.whenProp] || "";
    colorFieldsContainer.appendChild(
      createColorPickerField(config.label, {
        // The RAW stored color (node.style.color/backgroundColor/
        // borderColor) — no getComputedStyle, no inferring from what's
        // currently rendered in previewStage (a prior version resolved the
        // "real" rendered color off the live preview node, which broke in
        // practice: previewStage applies its OWN selected-node outline
        // (.press-component--selected) to the same element a node's own
        // borderColor renders on, so a selected border-less node's computed
        // border color was the editor's own selection ring, not the node's
        // actual, nonexistent border). Also no padding to COLOR_DEFAULTS
        // when empty — that used to happen here (a removed
        // resolveEffectiveColor helper) and made a cleared color
        // indistinguishable from a real, explicitly-chosen default: the
        // picker's own committedHex/hasManualValue derive straight from
        // value, so a padded non-empty value always read as "set," and the
        // unset-X overlay never showed after Clear. defaultValue below
        // already covers "what hue to start the popover from when nothing's
        // set" — set means set, empty means unset, full stop.
        value: node.style?.[config.prop] || "",
        defaultValue: config.default,
        bindingValue,
        evaluate: evaluateColorWhen,
        // Fires once per commit (Accept/Enter/closing the popover — see
        // color-picker.js's own commitCurrent), never per drag frame, so
        // wrapping the whole thing in one recordUndoableChange entry is
        // exactly right — same single-snapshot-per-real-edit contract every
        // other inspector field already gets.
        onManualChange: (value) => {
          recordUndoableChange(() => {
            updateSelectedNode((n) => {
              const styles = { ...(n.style ?? {}) };
              styles[config.prop] = value;
              if (key === "border") {
                // Picking a border color is also a valid way to turn the
                // border on, same as typing a literal one already was —
                // matches borderStyleInput's own "turning on for the first
                // time" fill-in (only what's still genuinely unset).
                if (!Number.isFinite(styles.borderWidth)) styles.borderWidth = 1;
                if (!styles.borderStyle) styles.borderStyle = "solid";
                if (!("borderRadius" in styles)) styles.borderRadius = 6;
                if (!styles.borderSides) styles.borderSides = { top: true, right: true, bottom: true, left: true };
              }
              n.style = styles;
            });
            renderPreview();
            updateSaveState();
          });
        },
        // "=formula" or "@binding" both just get written verbatim into the
        // one combined field — resolveBinding (evaluateColorWhen above,
        // template-renderer.js's real render) handles telling them apart.
        onBindingChange: (raw) => {
          const trimmed = raw.trim();
          recordUndoableChange(() => {
            updateSelectedNode((n) => {
              const styles = { ...(n.style ?? {}) };
              if (trimmed) {
                styles[config.whenProp] = trimmed;
              } else {
                delete styles[config.whenProp];
              }
              n.style = styles;
            });
            renderPreview();
            updateSaveState();
          });
        },
        onClear: () => {
          recordUndoableChange(() => {
            updateSelectedNode((n) => {
              const styles = { ...(n.style ?? {}) };
              delete styles[config.whenProp];
              if (key === "text") {
                // Text always renders with a real, visible color — "clear"
                // resets to the real default (white) rather than leaving it
                // genuinely unset, matching createComponent's own seeded
                // default for new components. Explicitly "#ffffff", not
                // COLOR_DEFAULTS.text (that's the muted placeholder shown
                // ONLY while genuinely unset — using it here would have
                // reset to a real, "set" dark grey that just happens to
                // look identical to the unset swatch, a stale mismatch
                // from before this comment's own "white" was written).
                styles.color = "#ffffff";
              } else if (key === "background") {
                delete styles.backgroundColor;
              } else if (key === "border") {
                // borderStyle (not borderColor) is the border on/off switch
                // — clearing just the color here doesn't turn the border
                // off, only clears the color itself.
                delete styles.borderColor;
              }
              if (Object.keys(styles).length) {
                n.style = styles;
              } else {
                delete n.style;
              }
            });
            renderPreview();
            updateInspector();
            updateSaveState();
          });
        },
      })
    );
  });
}
const paletteComponents = [
  {
    id: "grid",
    label: "Grid",
    description: "Rows and columns of layout content",
    icon: COMPONENT_ICONS.grid,
    node: {
      type: "grid",
      columns: 1,
      gap: 4,
      cells: [
        [
          [
            {
              type: "field",
              component: "text",
              text: "Grid heading",
              textSize: "lg",
              textStyles: { bold: true },
              className: "card-title",
            },
          ],
        ],
        [
          [
            {
              type: "field",
              component: "text",
              text: "Grid body text",
              textSize: "md",
              className: "mb-0",
            },
          ],
        ],
      ],
    },
  },
  {
    id: "layer",
    label: "Layer",
    description: "Freely positioned, stacked elements",
    icon: COMPONENT_ICONS.layer,
    node: {
      type: "layer",
      placements: [
        {
          node: {
            type: "field",
            component: "text",
            text: "Positioned text",
            textSize: "md",
            className: "mb-0",
          },
          x: 0.5,
          y: 0.5,
          width: 1.5,
          z: 0,
        },
      ],
    },
  },
  {
    id: "stat",
    label: "Block",
    description: "Label + value blocks",
    icon: COMPONENT_ICONS.stat,
    node: {
      type: "field",
      component: "stat",
      label: "Label",
      text: "Value",
      gap: 2,
      className: "press-block",
      style: {
        borderColor: "#adb5bd",
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: 6,
        borderSides: {
          top: true,
          right: true,
          bottom: true,
          left: true,
        },
      },
    },
  },
  {
    id: "icon",
    label: "Icon",
    description: "CSS class icons and status markers",
    icon: COMPONENT_ICONS.icon,
    node: {
      type: "field",
      component: "icon",
      iconClass: "ddb-advantage",
      ariaLabel: "Status icon",
    },
  },
  {
    id: "image",
    label: "Image",
    description: "Artwork or icon with URL binding",
    icon: COMPONENT_ICONS.image,
    node: {
      type: "field",
      component: "image",
      url: "",
      className: "press-image",
    },
  },
  {
    id: "repeater",
    label: "Repeater",
    description: "Repeating list, paragraphs, or table",
    icon: COMPONENT_ICONS.repeater,
    // A single, unopinionated starting point — one text field bound to
    // @value (works immediately against the sample string array below) in
    // one column, no header, no decorator. There are no other preset
    // "kinds" of repeater: columns, header, decorator, and every cell's own
    // content/binding are independent options the author sets afterward,
    // exactly like grid/table cells already worked.
    node: {
      type: "field",
      component: "repeater",
      columns: 1,
      showHeader: false,
      decorator: { type: "bullet" },
      gap: 1,
      className: "d-flex flex-column",
      items: ["First entry", "Second entry", "Third entry"],
      cells: [[[{ type: "field", component: "text", text: "@value" }]]],
    },
  },
  {
    id: "text",
    label: "Text",
    description: "Paragraphs, summaries, or captions",
    icon: COMPONENT_ICONS.text,
    node: {
      type: "field",
      component: "text",
      text: "Editable body text for this card or sheet.",
      textSize: "md",
      className: "card-body-text",
    },
  },
];

function createDefaultRepeaterHeaderRow(columns) {
  const count = Number.isFinite(columns) && columns > 0 ? columns : 1;
  return [
    Array.from({ length: count }, (_, index) =>
      assignNodeIds([{ type: "field", component: "text", text: `Column ${index + 1}`, textStyles: { bold: true } }])
    ),
  ];
}

const COMPONENT_REQUIRED_CLASS_MAP = {
  image: ["press-image"],
  stat: ["panel-box"],
};

function getComponentRequiredClassTokens(node) {
  if (!node?.component) return [];
  return COMPONENT_REQUIRED_CLASS_MAP[node.component] ?? [];
}

function getClassNameWithoutRequiredTokens(node, value) {
  const tokens = splitClassTokens(value);
  if (!tokens.length) return "";
  const requiredTokens = new Set(getComponentRequiredClassTokens(node));
  return tokens.filter((token) => !requiredTokens.has(token)).join(" ");
}

function mergeRequiredClassTokens(node, value) {
  const requiredTokens = getComponentRequiredClassTokens(node);
  const tokens = splitClassTokens(value);
  const combined = [...requiredTokens, ...tokens];
  return Array.from(new Set(combined)).join(" ");
}

let standardFormats = getStandardFormats();
let standardFormatMap = new Map(standardFormats.map((format) => [format.id, format]));

function refreshStandardFormats() {
  standardFormats = getStandardFormats();
  standardFormatMap = new Map(standardFormats.map((format) => [format.id, format]));
}

function initShell() {
  const { undoStack: stack, undo, redo, status: shellStatus } = initAppShell({
    namespace: "press-layout",
    storagePrefix: "undercroft.press.undo",
    rightPane: { size: "lg", initial: "collapsed" },
    onUndo: (entry) => {
      if (!entry?.before) {
        return { applied: false };
      }
      isApplyingHistory = true;
      try {
        applySnapshot(entry.before);
        updateSaveState();
      } finally {
        isApplyingHistory = false;
      }
      return null;
    },
    onRedo: (entry) => {
      if (!entry?.after) {
        return { applied: false };
      }
      isApplyingHistory = true;
      try {
        applySnapshot(entry.after);
        updateSaveState();
      } finally {
        isApplyingHistory = false;
      }
      return null;
    },
  });
  status = shellStatus;
  undoStack = stack;
  performUndo = undo;
  performRedo = redo;
  if (undoButton) {
    undoButton.addEventListener("click", () => {
      if (performUndo) {
        performUndo();
      }
    });
  }
  if (redoButton) {
    redoButton.addEventListener("click", () => {
      if (performRedo) {
        performRedo();
      }
    });
  }
  if (saveButton) {
    saveButton.addEventListener("click", handleSaveTemplate);
    updateSaveState();
  }
  initHelpSystem({ root: document });
}

function populateSources() {
  renderSourceOptions(getActiveTemplate());
  const active = getActiveSource();
  if (active) {
    renderSourceInput(active);
    updateGenerateButtonState();
  }
}

function populateTemplates() {
  templateSelect.innerHTML = "";
  const templates = getTemplates();
  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    templateSelect.appendChild(option);
  });
  if (templates[0]) {
    templateSelect.value = templates[0].id;
    hydrateEditablePages(templates[0]);
  }
}

function deriveTemplateId(name, { excludeId = "" } = {}) {
  const base = (name || "template").toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "template";
  const prefix = slug;
  const templates = getTemplates();
  let candidate = prefix;
  let counter = 2;
  while (templates.some((template) => template.id === candidate && template.id !== excludeId)) {
    candidate = `${prefix}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function createEmptyLayout() {
  return {
    type: "grid",
    columns: 1,
    gap: 4,
    cells: [],
  };
}

function appendTemplateOption(template) {
  if (!templateSelect || !template) return;
  const option = document.createElement("option");
  option.value = template.id;
  option.textContent = template.name ?? template.id;
  templateSelect.appendChild(option);
  templateSelect.value = template.id;
}

function clearTemplateSelection() {
  activeTemplateId = null;
  templateSelect.value = "";
  editablePages = { front: null, back: null };
  selectedNodeId = null;
  updateTemplateInspector(null);
  renderLayoutList();
  previewStage.innerHTML = "";
  printStack.innerHTML = "";
  renderJsonPreview();
}

function createBlankTemplate() {
  const name = "New Template";
  const id = deriveTemplateId(name);
  const baseFormat = standardFormats[0];
  const formats = baseFormat ? [{ ...baseFormat }] : [];
  return createTemplate({
    id,
    title: name,
    name,
    description: "",
    category: "print",
    // Not on the server yet — deleteActiveTemplate needs this to refuse a
    // delete attempt instead of asking the server to delete a row that
    // doesn't exist. Cleared once saveTemplateChanges actually persists it.
    origin: "draft",
    type: "sheet",
    formats,
    supportedSources: ["ddb", "srd", "json", "manual"],
    sides: ["front", "back"],
    pages: {
      front: { data: "@", layout: createEmptyLayout() },
      back: { data: "@", layout: createEmptyLayout() },
    },
  });
}

function renderTemplateFormatOptions() {
  if (!templateFormatsSelect) return;
  templateFormatsSelect.innerHTML = "";
  standardFormats.forEach((format) => {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = format.label;
    templateFormatsSelect.appendChild(option);
  });
}

function renderTemplateSourceOptions() {
  if (!templateSourcesSelect) return;
  templateSourcesSelect.innerHTML = "";
  getSources().forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    templateSourcesSelect.appendChild(option);
  });
}

function renderFormatOptions(template) {
  formatSelect.innerHTML = "";
  if (!template) return;
  template.formats?.forEach((format) => {
    const option = document.createElement("option");
    option.value = format.id;
    option.textContent = format.label;
    formatSelect.appendChild(option);
  });
  const firstFormat = template.formats?.[0];
  formatSelect.value = firstFormat?.id ?? "";
  renderOrientationOptions(firstFormat);
}

function renderOrientationOptions(format) {
  orientationSelect.innerHTML = "";
  const orientations = format?.orientations ?? ["portrait"];
  orientations.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    orientationSelect.appendChild(option);
  });
  orientationSelect.value = format?.defaultOrientation ?? orientations[0];
}

function renderSourceOptions(template) {
  if (!sourceSelect) return;
  const previous = sourceSelect.value;
  const sources = getSources();
  const supportedIds = template?.supportedSources?.length ? new Set(template.supportedSources) : null;
  const available = supportedIds ? sources.filter((source) => supportedIds.has(source.id)) : sources;
  sourceSelect.innerHTML = "";
  available.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = source.name;
    sourceSelect.appendChild(option);
  });
  const nextValue = available.find((source) => source.id === previous)?.id ?? available[0]?.id ?? "";
  sourceSelect.value = nextValue;
}

function getActiveTemplate() {
  const selected = templateSelect.value;
  return getTemplateById(selected);
}

function getActiveSource() {
  const selected = sourceSelect.value;
  return getSourceById(selected);
}

function getSourcePayload(source, value) {
  if (!source) return null;
  const payload = sourcePayloads[source.id];
  if (!payload) return null;
  if (payload.value !== value) return null;
  return payload;
}

function setSourcePayload(source, payload) {
  if (!source) return;
  if (payload) {
    sourcePayloads[source.id] = payload;
  } else {
    delete sourcePayloads[source.id];
  }
}

function clearSourcePayload(source) {
  if (!source) return;
  delete sourcePayloads[source.id];
}

function updateGenerateButtonState() {
  if (!generateButton) return;
  const source = getActiveSource();
  const value = source ? sourceValues[source.id] : null;
  const requiresInput = source?.input?.type !== "textarea";
  const hasValue = source?.id === "manual" ? true : Boolean(value);
  generateButton.disabled = Boolean(isGenerating || (requiresInput && !hasValue));
  generateButton.setAttribute("aria-disabled", generateButton.disabled ? "true" : "false");
}

function getSelectionContext() {
  const template = getActiveTemplate();
  const source = getActiveSource();
  const format = getFormatById(template, formatSelect.value);
  const orientation = orientationSelect.value || format?.defaultOrientation;
  const size = template && format ? getPageSize(template, format?.id, orientation) : null;
  const value = sourceValues[source?.id];
  const payload = getSourcePayload(source, value);

  return {
    template,
    source,
    format,
    orientation,
    size,
    sourceValue: value,
    sourcePayload: payload,
    sourceData: payload?.data ?? null,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function createItemContext(context, item, index) {
  const base = item && typeof item === "object" ? { ...context, ...item } : { ...context, value: item };
  return { ...base, item, index };
}

function resolveBasePreviewData() {
  const { sourceData } = getSelectionContext();
  if (sourceData && typeof sourceData === "object") {
    return sourceData;
  }
  const sample = getSampleData();
  if (sample && typeof sample === "object") {
    return sample;
  }
  return {};
}

function resolveNodePreviewContext(node, targetId, context) {
  if (!node || !targetId) return null;
  if (node.uid === targetId) return context;
  if (Array.isArray(node.placements)) {
    for (const placement of node.placements) {
      const found = resolveNodePreviewContext(placement?.node, targetId, context);
      if (found) return found;
    }
  }
  if (node.type === "field" && node.component === "repeater") {
    // Unlike the old table, `cells[0]` is always THE item template — no
    // per-row search needed, it's the only row there is — so this just
    // resolves item index 0's context and walks that one row, plus
    // headerCells[0] (if any) walked with the outer context since a header
    // renders once, never per-item.
    const items = resolveBindingWithLookup(node.itemsBind, context) ?? node.items ?? [];
    const itemContext = createItemContext(context, asArray(items)[0], 0);
    const templateRow = Array.isArray(node.cells) ? node.cells[0] : null;
    if (Array.isArray(templateRow)) {
      for (const cell of templateRow) {
        if (Array.isArray(cell)) {
          for (const nested of cell) {
            const found = resolveNodePreviewContext(nested, targetId, itemContext);
            if (found) return found;
          }
          continue;
        }
        const found = resolveNodePreviewContext(cell, targetId, itemContext);
        if (found) return found;
      }
    }
    const headerRow = Array.isArray(node.headerCells) ? node.headerCells[0] : null;
    if (Array.isArray(headerRow)) {
      for (const cell of headerRow) {
        if (Array.isArray(cell)) {
          for (const nested of cell) {
            const found = resolveNodePreviewContext(nested, targetId, context);
            if (found) return found;
          }
          continue;
        }
        const found = resolveNodePreviewContext(cell, targetId, context);
        if (found) return found;
      }
    }
  }
  if (Array.isArray(node.cells)) {
    for (const row of node.cells) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (Array.isArray(cell)) {
          for (const nested of cell) {
            const found = resolveNodePreviewContext(nested, targetId, context);
            if (found) return found;
          }
          continue;
        }
        const found = resolveNodePreviewContext(cell, targetId, context);
        if (found) return found;
      }
    }
  }
  return null;
}

function getInspectorPreviewContext(nodeId) {
  const layout = getLayoutForSide(currentSide);
  const baseContext = resolveBasePreviewData();
  if (!layout || !nodeId) return baseContext;
  return resolveNodePreviewContext(layout, nodeId, baseContext) ?? baseContext;
}

const renderJsonPreview = jsonDataPanel.render;

function removeDuplicateSampleDataSections() {
  const sections = document.querySelectorAll("[data-sample-data-section]");
  sections.forEach((section, index) => {
    if (index > 0) {
      section.remove();
    }
  });
}

function updateSampleDataFeedback(result) {
  if (!sampleDataInput) return;
  if (result?.valid) {
    sampleDataInput.classList.remove("is-invalid");
    if (sampleDataError) {
      sampleDataError.classList.add("d-none");
      sampleDataError.textContent = "";
    }
    return;
  }
  sampleDataInput.classList.add("is-invalid");
  if (sampleDataError) {
    const message = result?.error?.message ? `Invalid JSON: ${result.error.message}` : "Invalid JSON.";
    sampleDataError.textContent = message;
    sampleDataError.classList.remove("d-none");
  }
}

function renderSampleDataSection() {
  if (!sampleDataInput) return;
  const { sourceData } = getSelectionContext();
  const hasLoadedData = sourceData && typeof sourceData === "object";
  if (hasLoadedData) {
    sampleDataMode = "loaded";
    sampleDataInput.readOnly = true;
    sampleDataInput.classList.add("bg-body-secondary");
    sampleDataInput.value = JSON.stringify(sourceData, null, 2);
    if (sampleDataLabel) {
      sampleDataLabel.textContent = "Loaded Data";
    }
    if (sampleDataError) {
      sampleDataError.classList.add("d-none");
      sampleDataError.textContent = "";
    }
    sampleDataInput.classList.remove("is-invalid");
    return;
  }

  if (sampleDataMode !== "sample") {
    sampleDataMode = "sample";
    sampleDataInput.readOnly = false;
    sampleDataInput.classList.remove("bg-body-secondary");
    sampleDataInput.value = getSampleDataText() ?? "";
    if (sampleDataLabel) {
      sampleDataLabel.textContent = "Sample Data";
    }
  }
}

async function initSampleDataEditor() {
  const { text } = await loadSampleData();
  if (!sampleDataInput) return;
  sampleDataInput.value = text ?? getSampleDataText() ?? "";
  renderSampleDataSection();
  updateSampleDataFeedback({ valid: true });
  sampleDataInput.addEventListener("input", () => {
    if (sampleDataInput.readOnly) return;
    const nextValue = sampleDataInput.value;
    if (sampleDataSaveTimer) {
      window.clearTimeout(sampleDataSaveTimer);
    }
    sampleDataSaveTimer = window.setTimeout(() => {
      const result = setSampleDataText(nextValue);
      updateSampleDataFeedback(result);
    }, 400);
  });
  subscribeSampleData(() => {
    renderSampleDataSection();
    renderPreview();
    bindingFieldCache.source = null;
    refreshBindingAutocomplete();
  });
}

function cloneState(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createSnapshot() {
  return {
    pages: cloneState(editablePages),
    currentSide,
    selectedNodeId,
    nodeCounter,
  };
}

function getTemplateProperties(template) {
  if (!template) return null;
  return {
    id: template.id ?? "",
    name: template.name ?? "",
    description: template.description ?? "",
    type: template.type ?? "",
    baseFontFamily: template.baseFontFamily ?? "",
    formats: cloneState(template.formats ?? []),
    supportedSources: cloneState(template.supportedSources ?? []),
    card: template.card ? cloneState(template.card) : null,
  };
}

function createLayoutSnapshot(template = getActiveTemplate()) {
  return {
    pages: cloneState(editablePages),
    template: getTemplateProperties(template),
  };
}

function applySnapshot(snapshot) {
  if (!snapshot) return;
  const next = cloneState(snapshot);
  editablePages = next.pages ?? { front: null, back: null };
  currentSide = next.currentSide ?? "front";
  selectedNodeId = next.selectedNodeId ?? null;
  nodeCounter = typeof next.nodeCounter === "number" ? next.nodeCounter : 0;
  renderLayoutList();
  updateInspector();
  renderPreview();
}

function snapshotsEqual(first, second) {
  try {
    return JSON.stringify(first) === JSON.stringify(second);
  } catch (error) {
    console.warn("Unable to compare undo snapshots", error);
    return false;
  }
}

function pushUndoEntry(before, after) {
  if (!undoStack) return;
  if (snapshotsEqual(before, after)) return;
  undoStack.push({
    type: "layout",
    before,
    after,
  });
}

function recordUndoableChange(action) {
  if (isApplyingHistory || typeof action !== "function") {
    if (typeof action === "function") {
      action();
    }
    return;
  }
  if (!undoStack) {
    action();
    updateSaveState();
    return;
  }
  const before = createSnapshot();
  action();
  const after = createSnapshot();
  pushUndoEntry(before, after);
  updateSaveState();
}

function beginPendingUndo(target) {
  if (!undoStack || isApplyingHistory) return;
  pendingUndoSnapshot = createSnapshot();
  pendingUndoTarget = target ?? null;
}

function commitPendingUndo(target) {
  if (!undoStack || isApplyingHistory) return;
  if (pendingUndoTarget && target && pendingUndoTarget !== target) return;
  const before = pendingUndoSnapshot;
  pendingUndoSnapshot = null;
  pendingUndoTarget = null;
  if (!before) return;
  const after = createSnapshot();
  pushUndoEntry(before, after);
  updateSaveState();
}

function updateSaveState() {
  const hasTemplate = Boolean(getActiveTemplate());
  const hasChanges = hasTemplate && !snapshotsEqual(lastSavedLayout, createLayoutSnapshot());
  const enabled = hasChanges && !isSaving;
  // setDisabledTooltip (tooltips.js) owns real `disabled` + the explanation
  // together — a real `disabled` attribute blocks hover entirely, so a bare
  // `title` set alongside it (the previous approach here) could never
  // actually show; same bug class as every other disabled-button-tooltip
  // fix in the suite, just missed here since it used native `title` instead
  // of a Bootstrap tooltip.
  const reason = !hasTemplate
    ? "Select a template before saving."
    : isSaving
      ? "Saving template..."
      : !hasChanges
        ? "No changes to save."
        : "";
  if (saveButton) {
    setDisabledTooltip(saveButton, reason);
    saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
  }
  if (templateSaveButton) setDisabledTooltip(templateSaveButton, reason);
  updateTemplateDeleteState();
}

// Owner-or-admin, same rule used everywhere else templates/characters/systems
// are deleted from: an admin can delete any template regardless of
// ownership, a non-admin only their own. A "draft" template (created or
// duplicated locally, never saved) has no server-side row to delete at all.
function templateAllowsDelete(template) {
  if (!template || template.origin === "draft") return false;
  return allowsDeleteForRecord(template, { dataManager });
}

function updateTemplateDeleteState() {
  if (!templateDeleteButton) return;
  const template = getActiveTemplate();
  const allowed = Boolean(template) && templateAllowsDelete(template);
  templateDeleteButton.classList.toggle("d-none", !allowed);
  templateDeleteButton.setAttribute("aria-disabled", allowed ? "false" : "true");
  const reason = !template
    ? "Select a template before deleting."
    : template.origin === "draft"
      ? "Save the template before deleting it."
      : !allowed
        ? "You don't have permission to delete this template."
        : "";
  setDisabledTooltip(templateDeleteButton, reason);
}

function markLayoutSaved(snapshot) {
  lastSavedLayout = snapshot ?? createLayoutSnapshot();
  updateSaveState();
}

function stripNodeIds(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((child) => stripNodeIds(child));
  }
  const next = { ...node };
  delete next.uid;
  if (Array.isArray(next.placements)) {
    next.placements = next.placements.map((placement) => ({
      ...placement,
      node: stripNodeIds(placement.node),
    }));
  }
  if (Array.isArray(next.cells)) {
    next.cells = next.cells.map((row) => (Array.isArray(row) ? row.map((cell) => stripNodeIds(cell)) : row));
  }
  // A repeater's headerCells (see renderRepeater/template-renderer.js) is a
  // fully independent cells[row][col]-shaped array, sibling to `cells` —
  // needs the exact same strip pass, or a duplicated repeater's header
  // would keep sharing the original's node uids (and the same array
  // reference) instead of getting its own.
  if (Array.isArray(next.headerCells)) {
    next.headerCells = next.headerCells.map((row) => (Array.isArray(row) ? row.map((cell) => stripNodeIds(cell)) : row));
  }
  return next;
}

function buildTemplatePages() {
  const pages = {};
  Object.entries(editablePages ?? {}).forEach(([side, page]) => {
    // uids are saved as-is now (no stripNodeIds here) so they survive a
    // reload as real persisted identity instead of being regenerated by
    // tree-walk order every time — see hydrateEditablePages's nodeCounter
    // initialization, which is what makes this safe (a freshly-added node
    // can never collide with an already-persisted uid). serializeTemplate's
    // own cloneState() deep-clones the result, so passing `page` through
    // unmodified here doesn't risk the live editable state being mutated.
    pages[side] = page;
  });
  return pages;
}

function serializeTemplate(template) {
  if (!template || typeof template !== "object") return null;
  const { createPage, ...rest } = template;
  return cloneState({ ...rest, pages: buildTemplatePages() });
}

async function saveTemplateToServer(payload) {
  const id = payload?.id;
  if (!id) {
    throw new Error("Missing template id");
  }
  if (!dataManager) {
    throw new Error("Not connected");
  }
  // A template's own id is filename/library_items metadata, never body
  // content (same convention every other Library kind now follows, and the
  // identical fix Workbench's own template save already has) — `id` above
  // is already captured for the actual save call, so omitting it from the
  // spread here can't affect anything else.
  const { id: _omitId, ...bodyWithoutId } = payload;
  return dataManager.save("templates", id, { ...bodyWithoutId, category: payload.category || "print" });
}

async function handleSaveTemplate() {
  return saveTemplateChanges();
}

async function saveTemplateChanges({ template = getActiveTemplate() } = {}) {
  if (!template) {
    return false;
  }
  const hasChanges = !snapshotsEqual(lastSavedLayout, createLayoutSnapshot(template));
  if (!hasChanges) {
    return false;
  }
  const payload = serializeTemplate(template);
  if (!payload) {
    return false;
  }
  isSaving = true;
  updateSaveState();
  try {
    await saveTemplateToServer(payload);
    template.pages = payload.pages;
    // Now genuinely exists server-side — clear the draft guard and attribute
    // it to whoever just saved it, so deleteActiveTemplate's owner-or-admin
    // check passes immediately without waiting on a reload.
    template.origin = "";
    const sessionUser = dataManager?.session?.user;
    if (sessionUser) {
      template.ownerId = sessionUser.id ?? null;
      template.ownerUsername = sessionUser.username || "";
    }
    markLayoutSaved(createLayoutSnapshot(template));
    if (status) {
      status.show("Template saved", { type: "success", timeout: 2000 });
    }
    return true;
  } catch (error) {
    console.error("Failed to save template", error);
    if (status) {
      status.show(error.message || "Unable to save template", { type: "error", timeout: 2500 });
    }
    return false;
  } finally {
    isSaving = false;
    updateSaveState();
  }
}

function nextNodeId() {
  nodeCounter += 1;
  return `node-${nodeCounter}`;
}

function assignNodeIds(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    return node.map((entry) => assignNodeIds(entry));
  }
  const clone = { ...node, uid: node.uid ?? nextNodeId() };
  if (Array.isArray(node.placements)) {
    clone.placements = node.placements.map((placement) => ({ ...placement, node: assignNodeIds(placement.node) }));
  }
  if (Array.isArray(node.cells)) {
    clone.cells = node.cells.map((row) => (Array.isArray(row) ? row.map((cell) => assignNodeIds(cell)) : row));
  }
  // See stripNodeIds' matching comment — headerCells is a repeater's own
  // independent cells[row][col] array and needs the same backfill pass.
  if (Array.isArray(node.headerCells)) {
    clone.headerCells = node.headerCells.map((row) => (Array.isArray(row) ? row.map((cell) => assignNodeIds(cell)) : row));
  }
  return clone;
}

// Standalone version of assignNodeIds' own `.cells` pass, for callers (like
// the repeater Style selector) that build a fresh cells[row][col] array on
// its own, not attached to a node yet.
function assignCellsIds(cellsArray) {
  if (!Array.isArray(cellsArray)) return cellsArray;
  return cellsArray.map((row) => (Array.isArray(row) ? row.map((cell) => assignNodeIds(cell)) : row));
}

function cloneLayoutWithIds(layout) {
  if (!layout) return null;
  const copy = typeof structuredClone === "function" ? structuredClone(layout) : JSON.parse(JSON.stringify(layout));
  return assignNodeIds(normalizeLegacyLayoutNode(copy));
}

// assignNodeIds keeps a node's existing uid if it already has one (it's for
// backfilling ids onto a tree that's missing them, e.g. a freshly loaded
// template) — a real duplicate needs the opposite: every uid in the
// subtree stripped first (stripNodeIds, defined above for template-save
// export, does exactly that), so assignNodeIds is then forced to hand out
// entirely new ones and the copy can never collide with the original.
function cloneNodeWithFreshIds(node) {
  if (!node) return null;
  const copy = typeof structuredClone === "function" ? structuredClone(node) : JSON.parse(JSON.stringify(node));
  return assignNodeIds(stripNodeIds(copy));
}

// A node's style.fontFamily is already a fully-resolved CSS value (e.g.
// "'Cinzel', serif") the moment it's loaded from a saved template — the
// renderer just applies it directly, and the browser silently falls back
// to the CSS fallback (generic sans-serif, usually) unless the actual
// Google Fonts stylesheet has been injected via ensureFontLoaded. That
// injection previously only ever happened as a side effect of the font
// dropdown rendering its own rows (attachFontFamilyAutocomplete) — which
// never runs just from loading a template, only from clicking into that
// specific field — so any font never touched that way stayed on its
// fallback until someone happened to open the dropdown for it. Walking the
// whole tree here (same placements/cells shape as findNodeById) at every
// template (re)hydration fixes it regardless of whether that field is ever
// interacted with.
function ensureTemplateFontsLoaded(node) {
  if (!node) return;
  if (node.style?.fontFamily) {
    const option = findFontOptionByFamily(node.style.fontFamily);
    if (option) ensureFontLoaded(option);
  }
  if (Array.isArray(node.placements)) {
    node.placements.forEach((placement) => ensureTemplateFontsLoaded(placement?.node));
  }
  [node.cells, node.headerCells].forEach((cellRows) => {
    if (!Array.isArray(cellRows)) return;
    cellRows.forEach((row) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell) => {
        if (Array.isArray(cell)) {
          cell.forEach((nested) => ensureTemplateFontsLoaded(nested));
        } else {
          ensureTemplateFontsLoaded(cell);
        }
      });
    });
  });
}

// Now that saved templates actually persist node uids (buildTemplatePages
// no longer strips them — see there for why), nodeCounter can no longer
// just reset to 0 on every load: nextNodeId() would then be free to hand
// out "node-1" again for a brand-new node even though a persisted node
// already owns that uid from a previous save, colliding two nodes onto the
// same id within one tree. Scanning for the highest existing "node-N"
// suffix first (same placements/cells shape as assignNodeIds) and starting
// nodeCounter beyond it guarantees every freshly-minted id is unique,
// while assignNodeIds itself still leaves already-uid'd nodes untouched.
function highestPersistedNodeCounter(node) {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) {
    return node.reduce((max, entry) => Math.max(max, highestPersistedNodeCounter(entry)), 0);
  }
  let max = 0;
  const match = typeof node.uid === "string" ? /^node-(\d+)$/.exec(node.uid) : null;
  if (match) max = Number(match[1]);
  if (Array.isArray(node.placements)) {
    max = node.placements.reduce((acc, placement) => Math.max(acc, highestPersistedNodeCounter(placement?.node)), max);
  }
  [node.cells, node.headerCells].forEach((cellRows) => {
    if (!Array.isArray(cellRows)) return;
    cellRows.forEach((row) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell) => {
        max = Math.max(max, highestPersistedNodeCounter(cell));
      });
    });
  });
  return max;
}

function hydrateEditablePages(template) {
  const pages = template?.pages ?? {};
  nodeCounter = (template?.sides ?? ["front", "back"]).reduce(
    (max, side) => Math.max(max, highestPersistedNodeCounter(pages[side]?.layout)),
    0
  );
  const bySide = {};
  (template?.sides ?? ["front", "back"]).forEach((side) => {
    const pageConfig = pages[side] ?? {};
    bySide[side] = { ...pageConfig, layout: cloneLayoutWithIds(pageConfig.layout) };
    ensureTemplateFontsLoaded(bySide[side].layout);
  });
  editablePages = bySide;
  selectedNodeId = null;
  // Whatever page was being viewed almost certainly doesn't mean the same
  // thing for whatever template/side just got (re)hydrated — always start
  // back at the first page rather than clamping down to some page that
  // just happens to still be in range.
  cardPageIndex = 0;
  gridViewIndex = 0;
}

function updateTemplateSelectOption(template, previousId) {
  if (!templateSelect || !template) return;
  const options = Array.from(templateSelect.options);
  const option = options.find((entry) => entry.value === previousId) || options.find((entry) => entry.value === template.id);
  if (!option) return;
  option.value = template.id;
  option.textContent = template.name ?? option.textContent;
  templateSelect.value = template.id;
}

function startNewTemplate() {
  const template = createBlankTemplate();
  getTemplates().push(template);
  appendTemplateOption(template);
  activeTemplateId = template.id;
  templateIdAuto = true;
  currentSide = "front";
  hydrateEditablePages(template);
  renderFormatOptions(template);
  renderSourceOptions(template);
  updateTemplateInspector(template);
  if (undoStack) {
    undoStack.clear();
  }
  pendingUndoSnapshot = null;
  pendingUndoTarget = null;
  selectedNodeId = null;
  renderLayoutList();
  renderPreview();
  updateGenerateButtonState();
  setInspectorMode("template");
  updateSaveState();
}

function removeTemplateOption(id) {
  if (!templateSelect || !id) return;
  const option = Array.from(templateSelect.options).find((entry) => entry.value === id);
  if (option) {
    option.remove();
  }
}

async function deleteActiveTemplate() {
  const template = getActiveTemplate();
  if (!template) return;
  if (template.origin === "draft") {
    status?.show("Save the template before deleting it.", { type: "info", timeout: 2200 });
    return;
  }
  if (!templateAllowsDelete(template)) {
    status?.show("You don't have permission to delete this template.", { type: "error", timeout: 3000 });
    return;
  }
  if (!confirmDelete({ label: template.name || template.id })) {
    return;
  }
  try {
    await dataManager.delete("templates", template.id, { mode: "remote" });
  } catch (error) {
    console.error("Failed to delete template", error);
    status?.show(error.message || "Unable to delete template", { type: "error", timeout: 3000 });
    return;
  }
  status?.show(`Deleted ${template.name || template.id}`, { type: "success", timeout: 2200 });
  const templates = getTemplates();
  const index = templates.findIndex((entry) => entry.id === template.id);
  if (index >= 0) {
    templates.splice(index, 1);
  }
  removeTemplateOption(template.id);
  templateIdAuto = false;
  if (templates.length) {
    templateSelect.value = templates[0].id;
    activeTemplateId = templates[0].id;
    currentSide = "front";
    hydrateEditablePages(templates[0]);
    renderFormatOptions(templates[0]);
    renderSourceOptions(templates[0]);
    updateTemplateInspector(templates[0]);
    if (undoStack) {
      undoStack.clear();
    }
    pendingUndoSnapshot = null;
    pendingUndoTarget = null;
    selectedNodeId = null;
    renderLayoutList();
    updateInspector();
    renderPreview();
    markLayoutSaved();
    setInspectorMode("template");
    updateSaveState();
    return;
  }
  clearTemplateSelection();
  updateGenerateButtonState();
  setInspectorMode("template");
  updateSaveState();
}

// Copies the template as it currently stands in the editor — including any
// unsaved edits on the canvas, not just what's last persisted to disk —
// since "duplicate" is meant to branch off exactly what's on screen right
// now. serializeTemplate already builds that exact shape (current
// editablePages, uids stripped) for the Save flow, so it's reused here
// rather than re-deriving it. Like a brand-new blank template, the copy
// isn't written to the server until the user explicitly saves it.
function duplicateActiveTemplate() {
  const template = getActiveTemplate();
  if (!template) return;
  const serialized = serializeTemplate(template);
  if (!serialized) return;
  const name = `${serialized.name || serialized.id} Copy`;
  const id = deriveTemplateId(name);
  // origin/ownerId/ownerUsername/permissions are the original's, not this
  // unsaved copy's — clearing them keeps deleteActiveTemplate's draft guard
  // and owner-or-admin check correct for the duplicate rather than
  // inheriting the source template's server state.
  const duplicate = createTemplate({
    ...serialized,
    id,
    title: name,
    name,
    origin: "draft",
    ownerId: null,
    ownerUsername: "",
    permissions: "",
  });
  getTemplates().push(duplicate);
  appendTemplateOption(duplicate);
  activeTemplateId = duplicate.id;
  templateIdAuto = true;
  currentSide = "front";
  hydrateEditablePages(duplicate);
  renderFormatOptions(duplicate);
  renderSourceOptions(duplicate);
  updateTemplateInspector(duplicate);
  if (undoStack) {
    undoStack.clear();
  }
  pendingUndoSnapshot = null;
  pendingUndoTarget = null;
  selectedNodeId = null;
  renderLayoutList();
  updateInspector();
  renderPreview();
  updateGenerateButtonState();
  setInspectorMode("template");
  updateSaveState();
  // The Duplicate button lives at the bottom of Template Properties, so the
  // pane's scroll position is still sitting at the bottom right after the
  // click — without this, the new id/name at the top (the actual proof a
  // duplicate happened) is scrolled out of view and the only sign it worked
  // is a toast that's easy to miss.
  queryRightPane()?.querySelector(".workbench-sticky-pane")?.scrollTo({ top: 0, behavior: "smooth" });
  status?.show(`Duplicated as "${name}"`, { type: "success", timeout: 2000 });
}

function setTemplateFormatSelections(template) {
  if (!templateFormatsSelect) return;
  const selected = new Set((template.formats ?? []).map((format) => format.id ?? format.sizeId));
  Array.from(templateFormatsSelect.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function setTemplateSourceSelections(template) {
  if (!templateSourcesSelect) return;
  const selected = new Set(template.supportedSources ?? []);
  Array.from(templateSourcesSelect.options).forEach((option) => {
    option.selected = selected.has(option.value);
  });
}

function setCardInputsDisabled(isDisabled) {
  [
    templateCardWidthInput,
    templateCardHeightInput,
    templateCardGutterInput,
    templateCardSafeInsetInput,
    templateCardBleedInput,
    templateCardCornerRadiusInput,
    templateCardColumnsInput,
    templateCardRowsInput,
  ].forEach((input) => {
    if (!input) return;
    input.disabled = isDisabled;
  });
}

function updateTemplateInspector(template) {
  if (!templateInspector) return;
  const hasTemplate = Boolean(template);
  templateInspector.classList.toggle("opacity-50", !hasTemplate);
  templateInspector.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = !hasTemplate;
  });
  setCardInputsDisabled(!hasTemplate);
  if (!hasTemplate) return;

  if (templateIdInput) {
    templateIdInput.value = template.id ?? "";
  }
  if (templateNameInput) {
    templateNameInput.value = template.name ?? "";
  }
  if (templateDescriptionInput) {
    templateDescriptionInput.value = template.description ?? "";
  }
  if (templateTypeSelect) {
    templateTypeSelect.value = template.type ?? "sheet";
  }
  if (templateBaseFontInput) {
    // No "Default" entry here (excludeDefault on its autocomplete) — an
    // unset baseFontFamily shows the raw effective fallback, same
    // convention as any other raw CSS font-family value with no matching
    // library entry (see the equivalent Workbench field).
    const currentBaseFamily = typeof template.baseFontFamily === "string" ? template.baseFontFamily.trim() : "";
    const matchedBaseOption = findFontOptionByFamily(currentBaseFamily);
    templateBaseFontInput.value = matchedBaseOption
      ? matchedBaseOption.label
      : currentBaseFamily || DEFAULT_FONT_FAMILY;
  }
  setTemplateFormatSelections(template);
  setTemplateSourceSelections(template);
  const isGrid = template.type === "card" || template.type === "chip" || Boolean(template.card);
  if (templateCardGroup) {
    templateCardGroup.hidden = !isGrid;
    templateCardGroup.classList.toggle("d-none", !isGrid);
  }
  if (templateSaveButton) {
    templateSaveButton.disabled = !hasTemplate;
  }
  setCardInputsDisabled(!isGrid);
  if (isGrid) {
    const card = template.card ?? {};
    if (templateCardWidthInput) templateCardWidthInput.value = card.width ?? "";
    if (templateCardHeightInput) templateCardHeightInput.value = card.height ?? "";
    if (templateCardGutterInput) templateCardGutterInput.value = card.gutter ?? "";
    if (templateCardSafeInsetInput) templateCardSafeInsetInput.value = card.safeInset ?? "";
    if (templateCardBleedInput) templateCardBleedInput.value = card.bleed ?? "";
    if (templateCardCornerRadiusInput) templateCardCornerRadiusInput.value = card.cornerRadius ?? "";
    if (templateCardColumnsInput) templateCardColumnsInput.value = card.columns ?? "";
    if (templateCardRowsInput) templateCardRowsInput.value = card.rows ?? "";
  } else {
    if (templateCardWidthInput) templateCardWidthInput.value = "";
    if (templateCardHeightInput) templateCardHeightInput.value = "";
    if (templateCardGutterInput) templateCardGutterInput.value = "";
    if (templateCardSafeInsetInput) templateCardSafeInsetInput.value = "";
    if (templateCardBleedInput) templateCardBleedInput.value = "";
    if (templateCardCornerRadiusInput) templateCardCornerRadiusInput.value = "";
    if (templateCardColumnsInput) templateCardColumnsInput.value = "";
    if (templateCardRowsInput) templateCardRowsInput.value = "";
  }

  const frontPage = editablePages?.front ?? {};
  const backPage = editablePages?.back ?? {};
  if (templateFrontDataInput) templateFrontDataInput.value = frontPage.data ?? "";
  if (templateFrontRepeatInput) templateFrontRepeatInput.value = frontPage.repeat ?? "";
  if (templateBackDataInput) templateBackDataInput.value = backPage.data ?? "";
  if (templateBackRepeatInput) templateBackRepeatInput.value = backPage.repeat ?? "";
}

function bindTemplateInspectorControls() {
  if (templateIdInput) {
    templateIdInput.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      const nextId = templateIdInput.value.trim();
      if (!nextId) {
        templateIdInput.value = template.id ?? "";
        return;
      }
      const previousId = template.id;
      template.id = nextId;
      updateTemplateSelectOption(template, previousId);
      activeTemplateId = template.id;
      templateIdAuto = false;
      updateSaveState();
      renderJsonPreview();
    });
  }

  if (templateNameInput) {
    templateNameInput.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      const nextName = templateNameInput.value.trim();
      const previousId = template.id;
      template.name = nextName;
      template.title = nextName;
      if (templateIdAuto) {
        template.id = deriveTemplateId(nextName, { excludeId: previousId });
        if (templateIdInput) {
          templateIdInput.value = template.id;
        }
      }
      updateTemplateSelectOption(template, previousId);
      activeTemplateId = template.id;
      updateSaveState();
      renderPreview();
    });
  }

  if (templateDescriptionInput) {
    templateDescriptionInput.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      template.description = templateDescriptionInput.value.trim();
      updateSaveState();
    });
  }

  if (templateBaseFontInput) {
    attachFontFamilyAutocomplete(templateBaseFontInput, {
      onSelect: (option) => {
        const template = getActiveTemplate();
        if (!template) return;
        template.baseFontFamily = option.family || "";
        templateBaseFontInput.value = option.label;
        updateSaveState();
        renderPreview();
      },
      onAddFont: () =>
        openAddFontModal((registered) => {
          const template = getActiveTemplate();
          if (!template) return;
          template.baseFontFamily = registered.family;
          templateBaseFontInput.value = registered.label;
          updateSaveState();
          renderPreview();
        }),
      canAddFont: () => userMeetsTier("creator"),
      onAddDenied: () => status?.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 }),
      onDeleteFont: (option) => handleDeleteCustomFont(option),
      canDeleteFont: () => userMeetsTier("admin"),
      excludeDefault: true,
    });
  }

  if (templateTypeSelect) {
    templateTypeSelect.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      template.type = templateTypeSelect.value;
      if ((template.type === "card" || template.type === "chip") && !template.card) {
        template.card = template.type === "chip"
          ? {
              width: 1,
              height: 1,
              gutter: 0.1,
              safeInset: 0.05,
              columns: 7,
              rows: 9,
            }
          : {
              width: 2.5,
              height: 3.5,
              gutter: 0,
              safeInset: 0.125,
              columns: 3,
              rows: 3,
            };
      }
      if (template.type !== "card" && template.type !== "chip") {
        delete template.card;
      }
      updateTemplateInspector(template);
      renderSourceOptions(template);
      updateSaveState();
      renderPreview();
    });
  }

  if (templateFormatsSelect) {
    templateFormatsSelect.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      const selected = Array.from(templateFormatsSelect.selectedOptions)
        .map((option) => standardFormatMap.get(option.value))
        .filter(Boolean)
        .map((format) => ({ ...format }));
      template.formats = selected;
      renderFormatOptions(template);
      renderSourceOptions(template);
      renderPreview();
      updateSaveState();
    });
  }

  if (customSizeAddButton) {
    customSizeAddButton.addEventListener("click", async () => {
      const label = (customSizeLabelInput?.value || "").trim();
      const width = parseFloat(customSizeWidthInput?.value);
      const height = parseFloat(customSizeHeightInput?.value);
      if (!label || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        if (status) {
          status.show("Enter a label, width, and height for the custom size.", { type: "warning", timeout: 3000 });
        }
        return;
      }
      const id = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${Date.now().toString(36)}`;
      const size = { id, label, width, height };
      registerCustomPageSize(size);
      refreshStandardFormats();
      renderTemplateFormatOptions();
      const template = getActiveTemplate();
      if (template) {
        setTemplateFormatSelections(template);
      }
      if (customSizeLabelInput) customSizeLabelInput.value = "";
      if (customSizeWidthInput) customSizeWidthInput.value = "";
      if (customSizeHeightInput) customSizeHeightInput.value = "";
      try {
        await saveCustomPageSize(size);
        if (status) {
          status.show(`Added custom size "${label}".`, { type: "success", timeout: 2000 });
        }
      } catch (error) {
        if (status) {
          status.show(error.message || "Unable to save custom page size.", { type: "error", timeout: 4000 });
        }
      }
    });
  }

  if (templateSourcesSelect) {
    templateSourcesSelect.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      template.supportedSources = Array.from(templateSourcesSelect.selectedOptions).map((option) => option.value);
      renderSourceOptions(template);
      renderSourceInput(getActiveSource());
      updateGenerateButtonState();
      renderPreview();
      updateSaveState();
    });
  }

  const cardInputs = [
    { input: templateCardWidthInput, key: "width", parse: parseFloat },
    { input: templateCardHeightInput, key: "height", parse: parseFloat },
    { input: templateCardGutterInput, key: "gutter", parse: parseFloat },
    { input: templateCardSafeInsetInput, key: "safeInset", parse: parseFloat },
    { input: templateCardBleedInput, key: "bleed", parse: parseFloat },
    { input: templateCardCornerRadiusInput, key: "cornerRadius", parse: parseFloat },
    { input: templateCardColumnsInput, key: "columns", parse: (value) => parseInt(value, 10) },
    { input: templateCardRowsInput, key: "rows", parse: (value) => parseInt(value, 10) },
  ];

  cardInputs.forEach(({ input, key, parse }) => {
    if (!input) return;
    input.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      if (!template.card) {
        template.card = {};
      }
      const raw = input.value;
      const parsed = raw === "" ? null : parse(raw);
      if (!Number.isNaN(parsed) && parsed !== null) {
        template.card[key] = parsed;
      } else if (raw === "") {
        delete template.card[key];
      }
      updateSaveState();
      renderPreview();
    });
  });

  const pageBindingInputs = [
    { input: templateFrontDataInput, side: "front", key: "data" },
    { input: templateFrontRepeatInput, side: "front", key: "repeat" },
    { input: templateBackDataInput, side: "back", key: "data" },
    { input: templateBackRepeatInput, side: "back", key: "repeat" },
  ];

  pageBindingInputs.forEach(({ input, side, key }) => {
    if (!input) return;
    input.addEventListener("change", () => {
      const template = getActiveTemplate();
      if (!template) return;
      const trimmed = input.value.trim();
      const page = editablePages?.[side] ?? {};
      const next = { ...page };
      if (trimmed) {
        next[key] = trimmed;
      } else {
        delete next[key];
      }
      editablePages = { ...editablePages, [side]: next };
      updateSaveState();
      renderPreview();
      renderJsonPreview();
    });
  });

  if (templateSaveButton) {
    templateSaveButton.addEventListener("click", handleSaveTemplate);
  }
}

function getEditablePage(side) {
  return editablePages?.[side] ?? null;
}

function getLayoutForSide(side) {
  const page = getEditablePage(side);
  return page?.layout ?? null;
}

function findNodeById(node, uid) {
  if (!node || !uid) return null;
  if (node.uid === uid) return node;
  if (Array.isArray(node.placements)) {
    for (const placement of node.placements) {
      const found = findNodeById(placement.node, uid);
      if (found) return found;
    }
  }
  for (const cellRows of [node.cells, node.headerCells]) {
    if (!Array.isArray(cellRows)) continue;
    for (const row of cellRows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (Array.isArray(cell)) {
          for (const nestedCell of cell) {
            const found = findNodeById(nestedCell, uid);
            if (found) return found;
          }
          continue;
        }
        const found = findNodeById(cell, uid);
        if (found) return found;
      }
    }
  }
  return null;
}

function findParentNode(node, uid, parent = null) {
  if (!node || !uid) return null;
  if (node.uid === uid) return parent;
  if (Array.isArray(node.placements)) {
    for (const placement of node.placements) {
      if (placement?.node?.uid === uid) return node;
      const found = findParentNode(placement?.node, uid, node);
      if (found) return found;
    }
  }
  for (const cellRows of [node.cells, node.headerCells]) {
    if (!Array.isArray(cellRows)) continue;
    for (const row of cellRows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (Array.isArray(cell)) {
          for (const nestedCell of cell) {
            if (nestedCell?.uid === uid) return node;
            const found = findParentNode(nestedCell, uid, node);
            if (found) return found;
          }
          continue;
        }
        if (cell?.uid === uid) return node;
        const found = findParentNode(cell, uid, node);
        if (found) return found;
      }
    }
  }
  return null;
}

function removeNodeById(node, uid) {
  if (!node || !uid) return null;
  if (Array.isArray(node.placements)) {
    const index = node.placements.findIndex((placement) => placement?.node?.uid === uid);
    if (index >= 0) {
      const [removedPlacement] = node.placements.splice(index, 1);
      return removedPlacement.node;
    }
    for (const placement of node.placements) {
      const removed = removeNodeById(placement.node, uid);
      if (removed) return removed;
    }
  }
  for (const cellRows of [node.cells, node.headerCells]) {
    if (!Array.isArray(cellRows)) continue;
    for (const row of cellRows) {
      if (!Array.isArray(row)) continue;
      const index = row.findIndex((cell) => cell?.uid === uid);
      if (index >= 0) {
        const [removed] = row.splice(index, 1, null);
        return removed;
      }
      for (const cell of row) {
        if (Array.isArray(cell)) {
          const nestedIndex = cell.findIndex((entry) => entry?.uid === uid);
          if (nestedIndex >= 0) {
            const [removed] = cell.splice(nestedIndex, 1);
            return removed;
          }
          for (const nestedCell of cell) {
            const removed = removeNodeById(nestedCell, uid);
            if (removed) return removed;
          }
          continue;
        }
        const removed = removeNodeById(cell, uid);
        if (removed) return removed;
      }
    }
  }
  return null;
}

// Same recursive shape as findNodeById/assignNodeIds — collects every uid
// in a subtree (the node itself plus every descendant) so a deleted
// component's cardOverrides entries can be swept regardless of how deep it
// (or its own nested children) sat in the tree.
function collectNodeUids(node, uids = new Set()) {
  if (!node || typeof node !== "object") return uids;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectNodeUids(entry, uids));
    return uids;
  }
  if (node.uid) uids.add(node.uid);
  if (Array.isArray(node.placements)) {
    node.placements.forEach((placement) => collectNodeUids(placement?.node, uids));
  }
  [node.cells, node.headerCells].forEach((cellRows) => {
    if (!Array.isArray(cellRows)) return;
    cellRows.forEach((row) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell) => collectNodeUids(cell, uids));
    });
  });
  return uids;
}

// Otherwise-harmless but permanently orphaned cardOverrides entries would
// pile up every time a component with an active override gets deleted —
// this removes them for every card on the given side in one pass.
function sweepCardOverridesForUids(side, uids) {
  const cardOverrides = editablePages?.[side]?.cardOverrides;
  if (!cardOverrides || !uids || uids.size === 0) return;
  Object.keys(cardOverrides).forEach((cardKey) => {
    uids.forEach((uid) => delete cardOverrides[cardKey][uid]);
    if (Object.keys(cardOverrides[cardKey]).length === 0) {
      delete cardOverrides[cardKey];
    }
  });
}

// Whether a node (or anything nested inside it, via collectNodeUids) has
// been made unique for at least one card, on either side — used for the
// Layout list's "this has been customized somewhere" badge, which needs to
// know that at a glance while just browsing the template structure, not
// only while looking at one specific card in Grid View.
function nodeHasAnyCardOverride(node) {
  const uids = collectNodeUids(node);
  if (uids.size === 0) return false;
  return ["front", "back"].some((side) => {
    const cardOverrides = editablePages?.[side]?.cardOverrides;
    if (!cardOverrides) return false;
    return Object.values(cardOverrides).some((entriesForCard) =>
      Object.keys(entriesForCard).some((uid) => uids.has(uid))
    );
  });
}

function removeSelectedNode() {
  const layout = getLayoutForSide(currentSide);
  if (!layout || !selectedNodeId) return;
  // The root layout node has no parent to splice it out of, so "delete"
  // can't mean the same thing it does for any other node — a template
  // always needs a root layout to render. Instead it resets the root to a
  // fresh empty grid (equivalent to clearing every child by hand, just in
  // one step); anything else falls through to the normal splice-out-of-parent
  // removal.
  if (!findParentNode(layout, selectedNodeId)) {
    if (selectedNodeId !== layout.uid) return;
    recordUndoableChange(() => {
      const page = getEditablePage(currentSide);
      if (!page) return;
      // Every existing uid on this side is about to stop existing — no
      // individual sweep needed, the whole map is meaningless now.
      delete page.cardOverrides;
      page.layout = assignNodeIds(createEmptyLayout());
      selectedNodeId = null;
      renderLayoutList();
      updateInspector();
      renderPreview();
    });
    return;
  }
  recordUndoableChange(() => {
    const removed = removeNodeById(layout, selectedNodeId);
    if (!removed) return;
    sweepCardOverridesForUids(currentSide, collectNodeUids(removed));
    selectedNodeId = getRootChildren(currentSide)[0]?.uid ?? null;
    renderLayoutList();
    updateInspector();
    renderPreview();
  });
}

// Same recursive shape as findParentNode's own walk through `cells`, but
// returns the (row, col) location itself rather than the containing node —
// insertNodeAfter needs this to know which specific cell array to splice
// the clone into.
function findCellLocation(node, uid) {
  if (!node) return null;
  // A repeater's headerCells is a second, independent cells[row][col] array
  // (see stripNodeIds/assignNodeIds' matching comments) — searched after
  // `cells` since it's the less common case, flagged via `isHeader` so
  // insertNodeAfter below knows which accessor (getCellNodes vs
  // getRepeaterHeaderCellNodes) owns the location.
  for (const [cellRows, isHeader] of [
    [node.cells, false],
    [node.headerCells, true],
  ]) {
    if (!Array.isArray(cellRows)) continue;
    for (let row = 0; row < cellRows.length; row += 1) {
      const rowCells = cellRows[row];
      if (!Array.isArray(rowCells)) continue;
      for (let col = 0; col < rowCells.length; col += 1) {
        const cell = rowCells[col];
        const entries = Array.isArray(cell) ? cell : cell ? [cell] : [];
        if (entries.some((entry) => entry?.uid === uid)) {
          return { row, col, isHeader };
        }
      }
    }
  }
  return null;
}

// Shared by duplicate/paste — both are "put a cloned node right after an
// existing one, in that existing one's own parent." Returns false (no-op)
// when the target has no parent at all, i.e. it's the layout root, which
// neither operation applies to (mirrors removeSelectedNode's own rootless
// special case).
function insertNodeAfter(layout, targetUid, newNode, placementMeta) {
  const parent = findParentNode(layout, targetUid);
  if (!parent) return false;

  if (parent.type === "layer" && Array.isArray(parent.placements)) {
    const index = parent.placements.findIndex((placement) => placement?.node?.uid === targetUid);
    if (index < 0) return false;
    const targetPlacement = parent.placements[index];
    const baseX = typeof targetPlacement.x === "number" ? targetPlacement.x : 0;
    const baseY = typeof targetPlacement.y === "number" ? targetPlacement.y : 0;
    const placement = {
      x: Math.round((baseX + 0.2) * 100) / 100,
      y: Math.round((baseY + 0.2) * 100) / 100,
      z: parent.placements.length,
      node: newNode,
    };
    if (placementMeta?.width !== undefined) placement.width = placementMeta.width;
    if (placementMeta?.height !== undefined) placement.height = placementMeta.height;
    if (placementMeta?.rotate !== undefined) placement.rotate = placementMeta.rotate;
    parent.placements.splice(index + 1, 0, placement);
    return true;
  }

  if (isCellGridNode(parent)) {
    const location = findCellLocation(parent, targetUid);
    if (!location) return false;
    const cellNodes = location.isHeader
      ? getRepeaterHeaderCellNodes(parent, location.col)
      : getCellNodes(parent, location.row, location.col);
    const index = cellNodes.findIndex((entry) => entry?.uid === targetUid);
    if (index < 0) return false;
    cellNodes.splice(index + 1, 0, newNode);
    return true;
  }

  return false;
}

function getPlacementMetaForSelection(layout, uid) {
  const parent = findParentNode(layout, uid);
  if (parent?.type !== "layer") return null;
  const placement = findLayerPlacement(parent, uid);
  if (!placement) return null;
  return { width: placement.width, height: placement.height, rotate: placement.rotate };
}

// In-memory only (module-level, not the OS clipboard) — same tab/session
// is all this needs to support, and it avoids the Clipboard API's extra
// async permissions dance for what's otherwise a synchronous, same-page
// operation.
let clipboard = null;

function copySelectedNode({ silent = false } = {}) {
  const layout = getLayoutForSide(currentSide);
  if (!layout || !selectedNodeId) return;
  const node = findNodeById(layout, selectedNodeId);
  if (!node || !findParentNode(layout, selectedNodeId)) return;
  clipboard = {
    node: typeof structuredClone === "function" ? structuredClone(node) : JSON.parse(JSON.stringify(node)),
    placementMeta: getPlacementMetaForSelection(layout, selectedNodeId),
  };
  if (!silent) {
    status?.show("Copied.", { type: "info", timeout: 1200 });
  }
}

// Copy then delete, as one keyboard gesture — reuses both functions
// verbatim rather than duplicating their logic. Guarded the same way copy
// itself is (root has no parent, so it's excluded) rather than falling
// through to removeSelectedNode's own special "clear the whole layout"
// root behavior, which would silently cut without anything usable ending
// up on the clipboard. copySelectedNode's own toast is suppressed (silent)
// since this shows its own "Cut." toast right after — otherwise both fire
// in sequence ("Copied." then "Cut.") instead of just the one that
// actually describes what happened.
function cutSelectedNode() {
  const layout = getLayoutForSide(currentSide);
  if (!layout || !selectedNodeId || !findParentNode(layout, selectedNodeId)) return;
  copySelectedNode({ silent: true });
  removeSelectedNode();
  status?.show("Cut.", { type: "info", timeout: 1200 });
}

function pasteClipboard() {
  if (!clipboard) return;
  const layout = getLayoutForSide(currentSide);
  if (!layout) return;
  const clone = cloneNodeWithFreshIds(clipboard.node);
  recordUndoableChange(() => {
    // Prefer inserting right after the current selection (same spot it'd
    // land in the original same-side/same-parent case) — but that only
    // works if something's actually selected here and its parent still
    // resolves on this layout. Paste across sides or across templates
    // (nothing selected here, or a stale selection uid from wherever the
    // copy happened) falls back to appending at this layout's own root
    // instead of silently doing nothing.
    const insertedAfterSelection = Boolean(
      selectedNodeId && findParentNode(layout, selectedNodeId) && insertNodeAfter(layout, selectedNodeId, clone, clipboard.placementMeta)
    );
    if (!insertedAfterSelection) {
      insertNodeAtRoot(currentSide, clone, getRootChildren(currentSide).length, clipboard.placementMeta);
    }
    selectedNodeId = clone.uid;
    renderLayoutList();
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

function duplicateSelectedNode() {
  const layout = getLayoutForSide(currentSide);
  if (!layout || !selectedNodeId) return;
  const node = findNodeById(layout, selectedNodeId);
  if (!node || !findParentNode(layout, selectedNodeId)) return;
  const placementMeta = getPlacementMetaForSelection(layout, selectedNodeId);
  const clone = cloneNodeWithFreshIds(node);
  recordUndoableChange(() => {
    const inserted = insertNodeAfter(layout, selectedNodeId, clone, placementMeta);
    if (!inserted) return;
    selectedNodeId = clone.uid;
    renderLayoutList();
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

// The sidebar "Layout" list is a flat, one-row-per-item view — it treats a
// root grid the same way it used to treat a root stack (one item per row),
// which is exact for the common single-column root (the default, and what
// every migrated stack becomes) and shows only the first column for a
// genuine multi-column root grid — the canvas's per-cell drop slots are the
// real editing surface for those, this list is just a convenience overview.
function getRootChildren(side) {
  const layout = getLayoutForSide(side);
  if (layout?.type === "grid" && Array.isArray(layout.cells)) {
    return layout.cells.map((row) => row?.[0]?.[0]).filter(Boolean);
  }
  if (layout?.type === "layer" && Array.isArray(layout.placements)) {
    return layout.placements.map((placement) => placement?.node).filter(Boolean);
  }
  return [];
}

function insertNodeAtRoot(side, node, index, placementMeta = null) {
  if (!node) return;
  const layout = getLayoutForSide(side);
  if (!layout) return;
  const prepared = node.uid ? node : assignNodeIds(node);
  if (layout.type === "grid") {
    if (!Array.isArray(layout.cells)) layout.cells = [];
    const targetIndex = Math.max(0, Math.min(index, layout.cells.length));
    layout.cells.splice(targetIndex, 0, [[prepared]]);
    selectedNodeId = prepared.uid ?? selectedNodeId;
    return;
  }
  if (layout.type === "layer") {
    insertNodeIntoLayer(layout, prepared, index, placementMeta);
    selectedNodeId = prepared.uid ?? selectedNodeId;
  }
}

function reorderRootChildren(side, fromIndex, toIndex) {
  const layout = getLayoutForSide(side);
  if (!layout) return;
  if (layout.type === "grid" && Array.isArray(layout.cells)) {
    if (!layout.cells[fromIndex]) return;
    const [moved] = layout.cells.splice(fromIndex, 1);
    layout.cells.splice(Math.max(0, toIndex), 0, moved);
    return;
  }
  if (layout.type === "layer") {
    reorderLayerPlacements(layout, fromIndex, toIndex);
  }
}

function removeNodeAtRoot(side, uid) {
  const layout = getLayoutForSide(side);
  if (!layout) return null;
  if (layout.type === "grid" && Array.isArray(layout.cells)) {
    const index = layout.cells.findIndex((row) => row?.[0]?.[0]?.uid === uid);
    if (index >= 0) {
      const [removedRow] = layout.cells.splice(index, 1);
      return removedRow?.[0]?.[0] ?? null;
    }
    return null;
  }
  if (layout.type === "layer" && Array.isArray(layout.placements)) {
    const index = layout.placements.findIndex((placement) => placement?.node?.uid === uid);
    if (index >= 0) {
      const [removed] = layout.placements.splice(index, 1);
      return removed.node;
    }
  }
  return null;
}

function createNodeFromPalette(type) {
  const entry = paletteComponents.find((item) => item.id === type);
  if (!entry?.node) return null;
  const clone = typeof structuredClone === "function" ? structuredClone(entry.node) : JSON.parse(JSON.stringify(entry.node));
  return assignNodeIds(clone);
}

function reorderLayerPlacements(layerNode, fromIndex, toIndex) {
  if (!layerNode || layerNode.type !== "layer" || !Array.isArray(layerNode.placements)) return;
  if (!layerNode.placements[fromIndex]) return;
  const [moved] = layerNode.placements.splice(fromIndex, 1);
  layerNode.placements.splice(Math.max(0, toIndex), 0, moved);
}

function insertNodeIntoLayer(layerNode, node, index, placementMeta = null) {
  if (!layerNode || layerNode.type !== "layer" || !node) return;
  if (!Array.isArray(layerNode.placements)) {
    layerNode.placements = [];
  }
  const targetIndex = Math.max(0, Math.min(index, layerNode.placements.length));
  const placement = { node, x: 0.5, y: 0.5, z: layerNode.placements.length };
  // An image has no size of its own to fall back on (an empty/placeholder
  // image collapses to nothing without an explicit box) — everything else
  // (text, icon, list, etc.) already has real content size, so leaving
  // width/height unset lets the wrapper size to its own content instead
  // of reserving an arbitrary 1in box that then eats into the drag/clamp
  // bounds for no reason.
  if (node.component === "image") {
    placement.width = 1;
    placement.height = 1;
  }
  // Carries over a copied placement's own width/height/rotate (e.g. an
  // image deliberately resized smaller than the default) — pasteClipboard
  // passes this along when a copied node lands on a layer it wasn't
  // originally on, so cross-side/cross-template paste doesn't silently
  // reset a size the user explicitly set.
  if (placementMeta?.width !== undefined) placement.width = placementMeta.width;
  if (placementMeta?.height !== undefined) placement.height = placementMeta.height;
  if (placementMeta?.rotate !== undefined) placement.rotate = placementMeta.rotate;
  layerNode.placements.splice(targetIndex, 0, placement);
}

// Only used for drops onto an otherwise-empty grid (see initCanvasDnd) — a
// grid with at least one row already has per-cell drop slots to target
// instead, so this is specifically the "brand new / emptied-out grid has no
// slots at all to drop onto" recovery path. Appends a new row with the
// dropped node in column 0 and the rest of that row's columns left empty.
function insertRowIntoGrid(gridNode, node, index) {
  if (!gridNode || gridNode.type !== "grid" || !node) return;
  if (!Array.isArray(gridNode.cells)) {
    gridNode.cells = [];
  }
  const columnCount = Number.isFinite(gridNode.columns) && gridNode.columns > 0 ? gridNode.columns : 1;
  const targetIndex = Math.max(0, Math.min(index, gridNode.cells.length));
  const newRow = Array.from({ length: columnCount }, () => []);
  newRow[0] = [node];
  gridNode.cells.splice(targetIndex, 0, newRow);
}

function findLayerPlacement(layerNode, uid) {
  if (!layerNode || layerNode.type !== "layer" || !Array.isArray(layerNode.placements)) return null;
  return layerNode.placements.find((placement) => placement?.node?.uid === uid) ?? null;
}

// Shared 2D-cell-array storage for both `repeater` (component) and `grid`
// (type) nodes — same `cells[row][col]` = array-of-nodes convention for
// both, so one set of get/insert/reorder helpers covers the repeater's
// per-(row,col) drop slots (its item template, always exactly one row —
// see renderRepeater) and the grid container's per-cell drop slots.
function isCellGridNode(node) {
  return Boolean(node) && (node.component === "repeater" || node.type === "grid");
}

function getCellNodes(node, rowIndex, columnIndex) {
  if (!isCellGridNode(node)) return;
  if (!Array.isArray(node.cells)) {
    node.cells = [];
  }
  while (node.cells.length <= rowIndex) {
    node.cells.push([]);
  }
  if (!Array.isArray(node.cells[rowIndex])) {
    node.cells[rowIndex] = [];
  }
  while (node.cells[rowIndex].length <= columnIndex) {
    node.cells[rowIndex].push(null);
  }
  const cellEntry = node.cells[rowIndex][columnIndex];
  if (!Array.isArray(cellEntry)) {
    node.cells[rowIndex][columnIndex] = cellEntry ? [cellEntry] : [];
  }
  return node.cells[rowIndex][columnIndex];
}

function insertCellNode(node, rowIndex, columnIndex, cellNode, index) {
  const cellNodes = getCellNodes(node, rowIndex, columnIndex);
  if (!Array.isArray(cellNodes)) return;
  const targetIndex = Math.max(0, Math.min(index, cellNodes.length));
  cellNodes.splice(targetIndex, 0, cellNode);
}

function reorderCellNodes(node, rowIndex, columnIndex, fromIndex, toIndex) {
  const cellNodes = getCellNodes(node, rowIndex, columnIndex);
  if (!Array.isArray(cellNodes) || !cellNodes[fromIndex]) return;
  const [moved] = cellNodes.splice(fromIndex, 1);
  cellNodes.splice(Math.max(0, toIndex), 0, moved);
}

// A repeater's headerCells is a fully independent cell-array from its own
// `cells` (the item template) — see renderRepeater — so it needs its own
// tiny parallel of getCellNodes/insertCellNode/reorderCellNodes rather than
// reusing those (which always target `node.cells`). Only ever one row.
function getRepeaterHeaderCellNodes(node, columnIndex) {
  if (!node || node.component !== "repeater") return;
  if (!Array.isArray(node.headerCells)) {
    node.headerCells = [];
  }
  if (!Array.isArray(node.headerCells[0])) {
    node.headerCells[0] = [];
  }
  while (node.headerCells[0].length <= columnIndex) {
    node.headerCells[0].push(null);
  }
  const cellEntry = node.headerCells[0][columnIndex];
  if (!Array.isArray(cellEntry)) {
    node.headerCells[0][columnIndex] = cellEntry ? [cellEntry] : [];
  }
  return node.headerCells[0][columnIndex];
}

function insertRepeaterHeaderCellNode(node, columnIndex, cellNode, index) {
  const cellNodes = getRepeaterHeaderCellNodes(node, columnIndex);
  if (!Array.isArray(cellNodes)) return;
  const targetIndex = Math.max(0, Math.min(index, cellNodes.length));
  cellNodes.splice(targetIndex, 0, cellNode);
}

function reorderRepeaterHeaderCellNodes(node, columnIndex, fromIndex, toIndex) {
  const cellNodes = getRepeaterHeaderCellNodes(node, columnIndex);
  if (!Array.isArray(cellNodes) || !cellNodes[fromIndex]) return;
  const [moved] = cellNodes.splice(fromIndex, 1);
  cellNodes.splice(Math.max(0, toIndex), 0, moved);
}

function getDraggedNodeId(item) {
  if (!item) return null;
  if (item.dataset?.nodeId) return item.dataset.nodeId;
  return item.querySelector?.("[data-node-id]")?.dataset?.nodeId ?? null;
}

function createDefaultGridCell() {
  return [
    assignNodeIds({
      type: "field",
      component: "text",
      text: "Cell text",
      textSize: "md",
      className: "mb-0",
    }),
  ];
}

function removeColumnCells(node, index) {
  if (!isCellGridNode(node) || !Array.isArray(node.cells)) return;
  node.cells.forEach((row) => {
    if (!Array.isArray(row)) return;
    row.splice(index, 1);
  });
}

function addColumnCells(node, index) {
  if (!isCellGridNode(node) || !Array.isArray(node.cells)) return;
  node.cells.forEach((row) => {
    if (!Array.isArray(row)) return;
    row.splice(index, 0, null);
  });
}

function describeNode(node) {
  if (!node) return "Component";
  if (node.type === "grid") return "Grid";
  if (node.type === "layer") return "Layer";
  if (node.component === "text") return node.text ? node.text.slice(0, 48) : "Text";
  if (node.component === "icon") return node.ariaLabel || "Icon";
  if (node.component === "image") return node.url || "Image";
  if (node.component === "repeater") return Number(node.columns) > 1 ? "Table" : "List";
  if (node.component === "stat") return node.label || "Block";
  return node.component || node.type || "Component";
}

function getPaletteEntryForNode(node) {
  if (!node) return null;
  if (node.type === "grid") {
    return paletteComponents.find((item) => item.id === "grid") ?? null;
  }
  if (node.type === "layer") {
    return paletteComponents.find((item) => item.id === "layer") ?? null;
  }
  if (node.component) {
    return paletteComponents.find((item) => item.id === node.component) ?? null;
  }
  return null;
}

function replaceTypeIcon(icon) {
  if (!typeSummary) return;
  const parent = typeSummary.querySelector("[data-component-type-icon]")?.parentElement;
  if (!parent) return;
  const fresh = document.createElement("span");
  fresh.className = "iconify fs-4 text-primary";
  fresh.setAttribute("data-component-type-icon", "");
  fresh.setAttribute("data-icon", icon);
  fresh.setAttribute("aria-hidden", "true");
  parent.replaceChild(fresh, parent.querySelector("[data-component-type-icon]"));
  typeIcon = fresh;
}

function mapFontSizeToToken(size) {
  if (typeof size !== "number") return "md";
  if (size <= 12) return "xs";
  if (size <= 14) return "sm";
  if (size >= 22) return "xl";
  if (size >= 19) return "lg";
  return "md";
}

function getDefaultTextSize(node) {
  if (node?.component === "text") return "md";
  return "md";
}

function resolveTextSize(node) {
  if (!node) return "md";
  if (node.textSize && !node.textSizeCustom) return node.textSize;
  const fallback = node.style?.fontSize;
  if (typeof fallback === "number") {
    return mapFontSizeToToken(fallback);
  }
  return getDefaultTextSize(node);
}

function resolveTextStyles(node) {
  const defaults = {
    bold: false,
    italic: false,
    underline: false,
  };
  if (!node?.textStyles) {
    return defaults;
  }
  return {
    bold: typeof node.textStyles.bold === "boolean" ? node.textStyles.bold : defaults.bold,
    italic: Boolean(node.textStyles.italic),
    underline: Boolean(node.textStyles.underline),
  };
}

function resolveTextTransform(node) {
  const orientation = node?.textOrientation ?? "horizontal";
  const defaultCurve = orientation === "curve-up" || orientation === "curve-down" ? 12 : 0;
  return {
    orientation,
    angle: Number.isFinite(node?.textAngle) ? node.textAngle : 0,
    curve: Number.isFinite(node?.textCurve) ? node.textCurve : defaultCurve,
    isCustom: Boolean(node?.textOrientationCustom),
  };
}

// borderStyle is the border on/off switch — not "any of borderColor/
// Width/Style/Radius/Sides happens to be present" (the old OR-based
// check here let a stray borderWidth/Radius with no borderStyle/Color
// masquerade as "there's a border"). borderRadius is deliberately not
// checked — it independently shapes a node's own background/shadow
// rounding even with no border line drawn, so it isn't downstream of
// this switch the way color/width/sides are.
function hasBorderStyles(styles = {}) {
  return Boolean(styles.borderStyle) && styles.borderStyle !== "none";
}


function getNodeIconClass(node) {
  if (!node) return "";
  if (node.iconClass) return node.iconClass;
  const classTokens = (node.className ?? "").split(/\s+/).filter(Boolean);
  const iconTokens = classTokens.filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
  return iconTokens.join(" ");
}

function getIconTokens(value) {
  if (value === undefined || value === null) return [];
  const text = typeof value === "string" ? value : String(value);
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
}

function findIconMatch(value) {
  if (!value) return null;
  const normalized = value.toLowerCase();
  const options = getAllIconOptions();
  return (
    options.find((option) => option.value.toLowerCase() === normalized) ||
    options.find((option) => option.label.toLowerCase() === normalized) ||
    null
  );
}

// Troubleshooting info only (did this resolve to an actual icon or not) —
// moved into the preview's own tooltip rather than an always-visible line
// under the input, so it's there when you go looking but not up front.
function updateIconTooltip(resolvedValue, hasIcon) {
  if (!iconPreview) return;
  let title;
  if (resolvedValue === undefined || resolvedValue === null || resolvedValue === "") {
    title = "Result: —";
  } else if (hasIcon) {
    title = `Result: ${resolvedValue}`;
  } else {
    title = `Result: ${resolvedValue} (no icon found)`;
  }
  updateTooltipContent(iconPreview, title);
}

function resolveIconPreviewValue(value, context) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const resolvedContext =
    context && typeof context === "object" && Object.keys(context).length ? context : resolveBasePreviewData();
  const resolvePathValue = (binding) => {
    if (!binding.startsWith("@")) return undefined;
    const segments = binding.slice(1).split(".");
    return segments.reduce((acc, key) => {
      if (acc == null) {
        return undefined;
      }
      if (Array.isArray(acc) && /^\d+$/.test(key)) {
        return acc[Number(key)];
      }
      if (typeof acc === "object" && key in acc) {
        return acc[key];
      }
      return undefined;
    }, resolvedContext);
  };
  if (trimmed.startsWith("@")) {
    const directValue = resolvePathValue(trimmed);
    if (directValue !== undefined) {
      return directValue;
    }
  }
  const resolved = resolveBindingWithLookup(trimmed, resolvedContext);
  if (resolved === null || resolved === undefined) {
    return "";
  }
  return resolved;
}

function updateIconPreview(value, context) {
  if (!iconPreview) return;
  iconPreview.className = "press-icon-preview";
  iconPreview.innerHTML = "";
  const resolvedValue = resolveIconPreviewValue(value, context);
  if (resolvedValue === undefined || resolvedValue === null || resolvedValue === "") {
    updateIconTooltip("", false);
    return;
  }
  const resolvedText = typeof resolvedValue === "string" ? resolvedValue : String(resolvedValue);
  const matchedIcon = findIconMatch(resolvedText);
  const iconValue = matchedIcon?.value || resolvedText;
  const resolvedIconTokens = getIconTokens(iconValue);
  if (resolvedIconTokens.length) {
    const hasBootstrap = resolvedIconTokens.some((token) => token.startsWith("bi-"));
    if (hasBootstrap) {
      const icon = document.createElement("i");
      icon.className = `bi ${resolvedIconTokens.find((token) => token.startsWith("bi-"))}`;
      iconPreview.appendChild(icon);
    } else {
      const icon = document.createElement("span");
      icon.className = resolvedIconTokens.join(" ");
      iconPreview.appendChild(icon);
    }
  }
  updateIconTooltip(resolvedText, resolvedIconTokens.length > 0);
}

function applyIconSelection(value) {
  if (iconInput) {
    iconInput.value = value;
  }
  updateSelectedNode((node) => {
    const trimmed = value.trim();
    if (trimmed) {
      node.iconClass = trimmed;
    } else {
      delete node.iconClass;
    }
  });
  updateIconPreview(value, getInspectorPreviewContext(selectedNodeId));
  renderPreview();
  updateSaveState();
}

function formatBindingPreviewLabel(value) {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.length ? `Array(${value.length})` : "[]";
  }
  if (typeof value === "object") {
    return "Object";
  }
  const stringified = String(value);
  if (!stringified) return "\"\"";
  if (stringified.length <= 40) return stringified;
  return `${stringified.slice(0, 37)}…`;
}

function getBindingFieldEntries(context) {
  const source = context && typeof context === "object" ? context : resolveBasePreviewData();
  if (source !== bindingFieldCache.source) {
    bindingFieldCache.source = source;
    bindingFieldCache.entries = collectDataFields(source);
  }
  return bindingFieldCache.entries;
}

function getBindingFieldSuggestions(query = "", context) {
  const normalized = query.trim().toLowerCase();
  const entries = getBindingFieldEntries(context);
  const filtered = normalized
    ? entries.filter((entry) => entry.path.toLowerCase().includes(normalized))
    : entries;
  return filtered.slice(0, MAX_AUTOCOMPLETE_ITEMS).map((entry) => ({
    type: "field",
    path: entry.path,
    display: `@${entry.path}`,
    description: formatBindingPreviewLabel(entry.value),
  }));
}

function getFunctionSuggestions(query = "") {
  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? FORMULA_FUNCTIONS.filter((fn) => fn.name.toLowerCase().startsWith(normalized))
    : FORMULA_FUNCTIONS;
  return matches.slice(0, MAX_AUTOCOMPLETE_ITEMS).map((fn) => ({
    type: "function",
    name: fn.name,
    display: fn.signature,
    description: fn.name,
  }));
}

function ensureAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-binding-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.bindingAutocomplete = "true";
    container.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    container.style.zIndex = "1300";
    container.style.fontSize = "0.8125rem";
    container.style.maxHeight = "16rem";
    container.style.overflowY = "auto";
    parent.appendChild(container);
  }
  return container;
}

function applyFontSelection(input, option) {
  recordUndoableChange(() => {
    updateSelectedNode((node) => {
      const styles = { ...(node.style ?? {}) };
      if (option.family) {
        styles.fontFamily = option.family;
        ensureFontLoaded(option);
      } else {
        delete styles.fontFamily;
      }
      if (Object.keys(styles).length) {
        node.style = styles;
      } else {
        delete node.style;
      }
    });
    renderPreview();
  });
  input.value = option.label;
  updateSaveState();
}

// dataManager is assigned once initPress() runs — guarded so this reads
// safely as "not eligible" rather than throwing if ever called earlier.
function userMeetsTier(tier) {
  return Boolean(dataManager?.meetsTier(tier));
}

function resetAddFontValidationState() {
  pendingValidatedFont = null;
  if (addFontSubmitButton) addFontSubmitButton.disabled = true;
  if (addFontWarningElement) {
    addFontWarningElement.textContent = "";
    addFontWarningElement.classList.add("d-none");
  }
}

function openAddFontModal(onApply) {
  if (!window.bootstrap?.Modal || !addFontModalElement || typeof onApply !== "function") return;
  addFontApplyCallback = onApply;
  if (addFontValueInput) addFontValueInput.value = "";
  resetAddFontValidationState();
  // Focus itself happens on the modal's own "shown.bs.modal" event (see
  // where addFontModalElement is declared) — attempting it here, before
  // the modal has finished its entrance transition, can get overridden by
  // Bootstrap's own focus handling.
  window.bootstrap.Modal.getOrCreateInstance(addFontModalElement).show();
}


async function handleAddFontValueBlur() {
  const raw = (addFontValueInput?.value || "").trim();
  if (!raw) {
    resetAddFontValidationState();
    return;
  }
  pendingValidatedFont = null;
  if (addFontSubmitButton) addFontSubmitButton.disabled = true;
  if (addFontWarningElement) {
    addFontWarningElement.className = "small text-body-secondary";
    addFontWarningElement.textContent = "Checking…";
    addFontWarningElement.classList.remove("d-none");
  }
  try {
    const font = await validateFontInput(raw);
    // The field can change while this async check is in flight — only
    // trust the result if it still matches what's actually typed.
    if ((addFontValueInput?.value || "").trim() !== raw) return;
    pendingValidatedFont = font;
    if (addFontWarningElement) addFontWarningElement.classList.add("d-none");
    if (addFontSubmitButton) addFontSubmitButton.disabled = false;
  } catch (error) {
    if ((addFontValueInput?.value || "").trim() !== raw) return;
    if (addFontWarningElement) {
      addFontWarningElement.className = "small text-danger";
      addFontWarningElement.textContent = error.message || "Couldn't validate this font.";
      addFontWarningElement.classList.remove("d-none");
    }
  }
}

// A shared library file, persisted with no in-app undo — unlike this
// app's own undo-backed node deletions, a confirmation here is warranted
// since Ctrl+Z can't get it back.
async function handleDeleteCustomFont(option) {
  if (!window.confirm(`Delete "${option.label}" from the font library? This can't be undone, and removes it for everyone.`)) {
    return;
  }
  deleteCustomFont(option.id);
  try {
    await saveCustomFontDeletion(option.id, dataManager?.session?.token);
    status?.show(`Deleted "${option.label}" from the font library.`, { type: "success", timeout: 2500 });
  } catch (error) {
    status?.show(error.message || "Unable to delete this font.", { type: "error", timeout: 4000 });
  }
}


function attachBindingAutocomplete(input, { supportsFunctions = true, resolveContext = null } = {}) {
  if (!input) return null;
  const container = ensureAutocompleteContainer(input);
  if (!container) return null;
  input.setAttribute("aria-autocomplete", "list");
  const contextResolver = typeof resolveContext === "function" ? resolveContext : () => resolveBasePreviewData();
  const autocomplete = attachFormulaAutocomplete(input, {
    container,
    supportsBinding: true,
    supportsFunctions,
    getFieldItems: (query) => getBindingFieldSuggestions(query, contextResolver()),
    getFunctionItems: (query) => getFunctionSuggestions(query),
    maxItems: MAX_AUTOCOMPLETE_ITEMS,
  });
  bindingAutocompleteInstances.add(autocomplete);
  return autocomplete;
}

function refreshBindingAutocomplete() {
  bindingAutocompleteInstances.forEach((instance) => instance.update());
}

function initBindingAutocompletes() {
  attachBindingAutocomplete(templateFrontRepeatInput, { supportsFunctions: false });
  attachBindingAutocomplete(templateBackRepeatInput, { supportsFunctions: false });
  attachBindingAutocomplete(templateFrontDataInput, { supportsFunctions: false });
  attachBindingAutocomplete(templateBackDataInput, { supportsFunctions: false });
  const resolveInspectorContext = () => getInspectorPreviewContext(selectedNodeId);
  attachBindingAutocomplete(textEditor, { resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(iconInput, { resolveContext: resolveInspectorContext });
  attachIconAutocomplete(iconInput, { onSelect: applyIconSelection });
  attachBindingAutocomplete(repeaterItemsInput, { supportsFunctions: false, resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(repeaterDecoratorTextInput, { supportsFunctions: false, resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(imageUrlInput, { resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(ariaLabelInput, { resolveContext: resolveInspectorContext });
  attachClassNameAutocomplete(classNameInput, { wrapChange: recordUndoableChange });
  attachFontFamilyAutocomplete(fontFamilyInput, {
    onSelect: (option) => applyFontSelection(fontFamilyInput, option),
    onAddFont: () =>
      openAddFontModal((registered) => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            const styles = { ...(node.style ?? {}), fontFamily: registered.family };
            node.style = styles;
          });
          renderPreview();
        });
        if (fontFamilyInput) fontFamilyInput.value = registered.label;
        updateSaveState();
      }),
    canAddFont: () => userMeetsTier("creator"),
    onAddDenied: () => status?.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 }),
    onDeleteFont: (option) => handleDeleteCustomFont(option),
    canDeleteFont: () => userMeetsTier("admin"),
  });
}

function renderPalette() {
  if (!paletteList) return;
  paletteList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  paletteComponents.forEach((item) => {
    const entry = document.createElement("div");
    entry.className =
      "press-palette-item workbench-palette-item border rounded-3 shadow-sm bg-body d-flex align-items-center gap-2 hover-lift";
    entry.dataset.componentType = item.id;
    entry.dataset.sortableId = item.id;
    entry.dataset.sortableHandle = "true";
    entry.innerHTML = `
      <span class="iconify fs-4 text-primary" data-icon="${item.icon}" aria-hidden="true"></span>
      <div class="d-flex flex-column">
        <div class="fw-semibold">${item.label}</div>
        <div class="text-body-secondary extra-small text-truncate">${item.description}</div>
      </div>
    `;
    entry.addEventListener("dblclick", () => {
      const newNode = createNodeFromPalette(item.id);
      if (!newNode) return;
      recordUndoableChange(() => {
        insertNodeAtRoot(currentSide, newNode, getRootChildren(currentSide).length);
        selectNode(newNode.uid);
      });
    });
    fragment.appendChild(entry);
  });
  paletteList.appendChild(fragment);
}

function renderLayoutList() {
  if (!layoutList) return;
  // Disposed before the wipe — the "Make Unique" badge carries a real
  // tooltip now, and this reruns on every component add/remove/reorder/
  // select. See tooltips.js's own BUG CLASS 2.
  disposeTooltips(layoutList);
  layoutList.innerHTML = "";
  const children = getRootChildren(currentSide);
  if (layoutEmptyState) {
    layoutEmptyState.hidden = Boolean(children.length);
  }
  if (!children.length) return;

  const fragment = document.createDocumentFragment();
  children.forEach((node) => {
    const item = document.createElement("li");
    item.className = "list-group-item d-flex align-items-center justify-content-between gap-2";
    if (node.uid === selectedNodeId) {
      item.classList.add("active");
    }
    item.dataset.nodeId = node.uid;
    item.dataset.sortableId = node.uid;

    const handle = document.createElement("span");
    handle.className = "iconify text-body-secondary";
    handle.dataset.icon = "tabler:grip-vertical";
    handle.setAttribute("data-sortable-handle", "");
    handle.setAttribute("aria-hidden", "true");

    const label = document.createElement("div");
    label.className = "flex-grow-1 d-flex flex-column";
    const title = document.createElement("span");
    title.className = "fw-semibold";
    title.textContent = describeNode(node);
    const subtitle = document.createElement("small");
    subtitle.className = "text-body-secondary";
    subtitle.textContent = node.component ? `Component: ${node.component}` : `Type: ${node.type}`;
    label.append(title, subtitle);

    item.append(handle, label);

    if (nodeHasAnyCardOverride(node)) {
      const uniqueBadge = document.createElement("span");
      uniqueBadge.className = "iconify text-warning flex-shrink-0";
      uniqueBadge.dataset.icon = "tabler:fingerprint";
      uniqueBadge.setAttribute("data-bs-toggle", "tooltip");
      uniqueBadge.setAttribute("data-bs-title", "Has per-card overrides (Make Unique)");
      uniqueBadge.setAttribute("aria-label", "Has per-card overrides");
      item.append(uniqueBadge);
    }

    item.addEventListener("click", () => selectNode(node.uid));
    fragment.appendChild(item);
  });

  layoutList.appendChild(fragment);
  refreshTooltips(layoutList);
}

function getNodeText(node) {
  if (!node) return "";
  if (node.component === "icon") {
    return node.ariaLabel ?? "";
  }
  if (typeof node.text === "string") return node.text;
  if (typeof node.label === "string") return node.label;
  return "";
}

// createFormulaToggleField's own internal listener already re-syncs the
// switch's checked/disabled/indeterminate state on every keystroke in the
// binding field (live-evaluating via the `evaluate` callback passed to it
// above — same resolveBinding call template-renderer.js's own shouldHide
// uses for the real render), so selection-change is the only time this
// file needs to push state into the field from the outside.
function syncVisibilityControl(node) {
  visibleField.syncToggleState({
    checked: !node?.hidden,
    bindingValue: node?.visibleWhen || "",
  });
}

function updateInspector() {
  if (!inspectorSection) return;
  const layout = getLayoutForSide(currentSide);
  const node = findNodeById(layout, selectedNodeId);
  const hasSelection = Boolean(node);
  const parentNode = hasSelection ? findParentNode(layout, selectedNodeId) : null;
  const parentIsContainer = Boolean(
    parentNode && (parentNode.type === "grid" || parentNode.type === "layer" || parentNode.component === "repeater")
  );
  const parentIsLayer = Boolean(parentNode && parentNode.type === "layer");
  const placement = parentIsLayer ? findLayerPlacement(parentNode, selectedNodeId) : null;

  inspectorSection.classList.toggle("opacity-50", !hasSelection);
  inspectorSection.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = !hasSelection;
  });

  if (makeUniqueButton) {
    const uniqueAvailable = hasSelection && activeViewTab === "grid";
    // Independent of the general hasSelection disable-sweep above — Make
    // Unique also needs the Grid View tab active (its only unambiguous
    // "which card" context), so it can be re-disabled even with a
    // component selected.
    const overrideEntry = uniqueAvailable ? getCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId) : null;
    const isActive = Boolean(overrideEntry);
    makeUniqueButton.classList.toggle("active", isActive);
    makeUniqueButton.setAttribute("aria-pressed", isActive ? "true" : "false");
    const currentFingerprint = uniqueAvailable ? simpleHash(getGridViewData()) : null;
    const isStale = Boolean(overrideEntry) && overrideEntry.dataFingerprint !== currentFingerprint;
    makeUniqueButton.classList.toggle("btn-outline-warning", isStale);
    makeUniqueButton.classList.toggle("btn-outline-secondary", !isStale);
    // Disabled state and its explanation both go through setDisabledTooltip
    // — a real `disabled` attribute blocks hover, so the "only available
    // from Grid View" explanation has to live on its own wrapper, not this
    // button directly (see tooltips.js's own header). While available, the
    // button stays real-enabled and its own tooltip live-updates in place.
    if (uniqueAvailable) {
      setDisabledTooltip(makeUniqueButton, "");
      const title = isStale
        ? "Make Unique — the data at this card/chip looks different than when this override was set"
        : "Make Unique — while on, edits to this component apply only to the card/chip shown in Grid View, not the shared template";
      updateTooltipContent(makeUniqueButton, title);
    } else {
      setDisabledTooltip(
        makeUniqueButton,
        "Make Unique — only available from the Grid View tab, where a component selection maps to one specific card/chip"
      );
    }
  }

  if (typeSummary) {
    const entry = getPaletteEntryForNode(node);
    typeSummary.classList.toggle("opacity-50", !entry);
    if (entry) {
      if (typeIcon) {
        replaceTypeIcon(entry.icon);
      }
      if (typeLabel) {
        typeLabel.textContent = entry.label;
      }
      if (typeDescription) {
        typeDescription.textContent = entry.description;
      }
    } else {
      if (typeIcon) {
        replaceTypeIcon("tabler:components");
      }
      if (typeLabel) {
        typeLabel.textContent = "Component";
      }
      if (typeDescription) {
        typeDescription.textContent = "Select a component to view details.";
      }
    }
    if (window.Iconify && typeof window.Iconify.scan === "function") {
      window.Iconify.scan(typeSummary);
    }
  }

  if (parentIndicator && parentSelectButton) {
    parentIndicator.hidden = !parentIsContainer;
    parentIndicator.classList.toggle("d-none", !parentIsContainer);
    if (parentIsContainer) {
      parentSelectButton.textContent = describeNode(parentNode);
      parentSelectButton.dataset.parentNodeId = parentNode.uid ?? "";
      parentSelectButton.disabled = false;
    } else {
      parentSelectButton.textContent = "";
      parentSelectButton.dataset.parentNodeId = "";
      parentSelectButton.disabled = true;
    }
  }

  if (deleteButton) {
    deleteButton.disabled = !hasSelection;
    // The root layout has no parent to remove it from, so deleting it
    // means "reset to an empty layout" instead — label it accordingly so
    // that's not a surprise. Now an icon button (no visible text of its
    // own), so this updates the accessible label + tooltip instead of
    // overwriting the button's whole content, which would otherwise wipe
    // out its icon.
    const isRoot = hasSelection && !parentNode;
    const deleteLabel = isRoot ? "Clear Layout" : "Delete Component";
    if (deleteButtonLabel) deleteButtonLabel.textContent = deleteLabel;
    deleteButton.setAttribute("aria-label", deleteLabel);
    updateTooltipContent(deleteButton, deleteLabel);
  }
  if (duplicateButton) {
    // Unlike delete, duplicating the root doesn't have a sensible meaning
    // (there's only ever one layout root) — disabled rather than repurposed.
    duplicateButton.disabled = !hasSelection || !parentNode;
  }

  const setGroupVisibility = (group, isVisible) => {
    if (!group) return;
    group.hidden = !isVisible;
    group.classList.toggle("d-none", !isVisible);
    group.style.display = isVisible ? "" : "none";
  };

  if (!hasSelection) {
    if (textEditor) textEditor.value = "";
    if (iconInput) iconInput.value = "";
    updateIconPreview("", {});
    if (imageUrlInput) imageUrlInput.value = "";
    if (imageWidthInput) imageWidthInput.value = "";
    if (imageHeightInput) imageHeightInput.value = "";
    if (imageFitInput) imageFitInput.value = "cover";
    if (imageCornerRadiusInput) imageCornerRadiusInput.value = "";
    if (layerOriginInput) layerOriginInput.value = "safe";
    if (gapInput) gapInput.value = "";
    if (spaceAfterInput) spaceAfterInput.value = "";
    if (rowColumnsInput) rowColumnsInput.value = "";
    if (templateColumnsInput) templateColumnsInput.value = "";
    if (gridRowsInput) gridRowsInput.value = "";
    if (templateRowsInput) templateRowsInput.value = "";
    if (repeaterItemsInput) repeaterItemsInput.value = "";
    if (repeaterColumnsInput) repeaterColumnsInput.value = "";
    if (repeaterHeaderInput) repeaterHeaderInput.checked = false;
    if (repeaterTemplateColumnsInput) repeaterTemplateColumnsInput.value = "";
    if (repeaterDecoratorTypeInput) repeaterDecoratorTypeInput.value = "none";
    if (repeaterDecoratorTextInput) repeaterDecoratorTextInput.value = "";
    if (ariaLabelInput) ariaLabelInput.value = "";
    if (classNameInput) classNameInput.value = "";
    if (positionXInput) positionXInput.value = "";
    if (positionYInput) positionYInput.value = "";
    if (positionWidthInput) positionWidthInput.value = "";
    if (positionHeightInput) positionHeightInput.value = "";
    if (positionZInput) positionZInput.value = "";
    if (positionRotateInput) positionRotateInput.value = "";
    positionFieldGroups.forEach((group) => setGroupVisibility(group, false));
    setGroupVisibility(textFieldGroup, true);
    setGroupVisibility(iconField, false);
    setGroupVisibility(repeaterFieldGroup, false);
    setGroupVisibility(textDecorationGroup, true);
    setGroupVisibility(ariaLabelField, false);
    setGroupVisibility(classNameField, true);
    imageFieldGroups.forEach((group) => setGroupVisibility(group, false));
    setGroupVisibility(imageSizeFieldGroup, false);
    setGroupVisibility(layerOriginField, false);
    setGroupVisibility(textGroupWrapper, true);
    textSettingGroups.forEach((group) => {
      if (group === textDecorationGroup) return;
      setGroupVisibility(group, true);
    });
    setGroupVisibility(colorGroup, true);
    setGroupVisibility(borderGroup, false);
    setGroupVisibility(alignmentGroup, true);
    setGroupVisibility(gridAlignXGroup, false);
    setGroupVisibility(gridAlignYGroup, false);
    if (gapField) {
      gapField.hidden = true;
    }
    if (spaceAfterField) {
      spaceAfterField.hidden = true;
    }
    if (rowColumnsField) {
      rowColumnsField.hidden = true;
    }
    if (templateColumnsField) {
      templateColumnsField.hidden = true;
    }
    if (gridRowsField) {
      gridRowsField.hidden = true;
    }
    if (templateRowsField) {
      templateRowsField.hidden = true;
    }
    textStyleToggles.forEach((input) => {
      input.disabled = false;
    });
    alignInputs.forEach((input) => {
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.remove("d-none");
      }
    });
    [...alignXInputs, ...alignYInputs].forEach((input) => {
      input.checked = input.value === "start";
    });
    textSizeInputs.forEach((input) => {
      input.checked = input.value === "md";
    });
    if (textSizeCustomInput) {
      textSizeCustomInput.value = pxToPt(TEXT_SIZE_PX.md);
      textSizeCustomInput.disabled = false;
    }
    if (textInlineInput) textInlineInput.checked = false;
    if (textLineHeightInput) textLineHeightInput.value = "";
    if (fontFamilyInput) fontFamilyInput.value = "";
    textOrientationInputs.forEach((input) => {
      input.checked = input.value === "horizontal";
    });
    if (textAngleInput) textAngleInput.value = "0";
    if (textCurveInput) textCurveInput.value = "0";
    renderColorFields(null);
    textStyleToggles.forEach((input) => {
      input.checked = false;
    });
    alignInputs.forEach((input) => {
      input.checked = input.value === "start";
    });
    syncVisibilityControl(null);
    if (textEditorLabel) {
      textEditorLabel.textContent = "Binding / Text";
    }
    return;
  }

  const isGridNode = node?.type === "grid";
  const isLayerNode = node?.type === "layer";
  const isLayoutNode = isGridNode || isLayerNode;
  const isGapNode = isGridNode || ["repeater", "stat"].includes(node?.component);
  const isImageNode = node?.component === "image";
  const isRepeaterNode = node?.component === "repeater";
  const isIconNode = node?.component === "icon";
  const borderVisible = hasBorderStyles(node?.style ?? {});
  positionFieldGroups.forEach((group) => setGroupVisibility(group, parentIsLayer));
  if (parentIsLayer) {
    if (positionXInput) positionXInput.value = typeof placement?.x === "number" ? String(placement.x) : "";
    if (positionYInput) positionYInput.value = typeof placement?.y === "number" ? String(placement.y) : "";
    if (positionWidthInput) positionWidthInput.value = placement?.width ?? "";
    if (positionHeightInput) positionHeightInput.value = placement?.height ?? "";
    if (positionZInput) positionZInput.value = Number.isFinite(placement?.z) ? String(placement.z) : "";
    if (positionRotateInput) positionRotateInput.value = Number.isFinite(placement?.rotate) ? String(placement.rotate) : "";
  }
  setGroupVisibility(textFieldGroup, !isLayoutNode && !isImageNode && !isRepeaterNode && !isIconNode);
  setGroupVisibility(iconField, isIconNode);
  setGroupVisibility(repeaterFieldGroup, isRepeaterNode);
  setGroupVisibility(ariaLabelField, isIconNode);
  setGroupVisibility(classNameField, true);
  imageFieldGroups.forEach((group) => setGroupVisibility(group, isImageNode));
  // A layer child's box comes entirely from the position fields above (see
  // renderLayer/the image field's insideLayer check) — showing these too
  // would look like a second way to size the same image, but they'd have no
  // effect while a placement wrapper owns the sizing.
  setGroupVisibility(imageSizeFieldGroup, isImageNode && !parentIsLayer);
  setGroupVisibility(layerOriginField, isLayerNode);
  if (layerOriginInput) {
    layerOriginInput.value = isLayerNode ? node.origin || "safe" : "safe";
  }
  // Wraps every text-related sub-group (Font/Text size/Orientation/
  // Decoration/Alignment) — hidden only when ALL of them would be, so the
  // collapsible "Text" heading+toggle never shows with nothing underneath
  // it. Grid/Layer/Image are the only types where that happens: Repeater
  // still has Alignment, Icon still has Font/Text size/Decoration.
  setGroupVisibility(textGroupWrapper, !isLayoutNode && !isImageNode);
  textSettingGroups.forEach((group) => {
    if (group === textDecorationGroup) return;
    setGroupVisibility(group, !isLayoutNode && !isImageNode && !isRepeaterNode);
  });
  setGroupVisibility(textDecorationGroup, !isLayoutNode && !isImageNode && !isRepeaterNode && !isIconNode);
  setGroupVisibility(colorGroup, true);
  setGroupVisibility(borderGroup, borderVisible);
  setGroupVisibility(alignmentGroup, node?.type !== "layer" && !isGridNode && !isImageNode && !isIconNode);
  setGroupVisibility(gridAlignXGroup, isGridNode);
  setGroupVisibility(gridAlignYGroup, isGridNode);
  textStyleToggles.forEach((input) => {
    input.disabled = isLayoutNode || isImageNode || isIconNode;
  });
  if (gapField) {
    gapField.hidden = !isGapNode;
  }
  if (spaceAfterField) {
    spaceAfterField.hidden = !isGapNode;
  }
  if (rowColumnsField) {
    rowColumnsField.hidden = !isGridNode;
  }
  if (templateColumnsField) {
    templateColumnsField.hidden = !isGridNode;
  }
  if (gridRowsField) {
    gridRowsField.hidden = !isGridNode;
  }
  if (templateRowsField) {
    templateRowsField.hidden = !isGridNode;
  }

  if (gapInput) {
    const defaultGap = node?.component === "stat" ? 2 : 4;
    const gapValue = Number.isFinite(node?.gap) ? node.gap : defaultGap;
    gapInput.value = isGapNode ? String(gapValue) : "";
  }
  if (spaceAfterInput) {
    // No default fallback like Gap's — unset genuinely means "no extra
    // space," not "assume some component-specific starting value."
    spaceAfterInput.value = isGapNode && Number.isFinite(node?.spaceAfter) ? String(node.spaceAfter) : "";
  }
  if (rowColumnsInput) {
    rowColumnsInput.value = isGridNode ? String(node.columns ?? 1) : "";
  }
  if (templateColumnsInput) {
    templateColumnsInput.value = isGridNode ? node.templateColumns ?? "" : "";
  }
  if (gridRowsInput) {
    gridRowsInput.value = isGridNode ? String(node.cells?.length ?? 0) : "";
  }
  if (templateRowsInput) {
    templateRowsInput.value = isGridNode ? node.templateRows ?? "" : "";
  }
  alignXInputs.forEach((input) => {
    input.checked = isGridNode && (node.alignX || "start") === input.value;
  });
  alignYInputs.forEach((input) => {
    input.checked = isGridNode && (node.alignY || "justify") === input.value;
  });
  alignInputs.forEach((input) => {
    input.disabled = false;
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      label.classList.remove("d-none");
    }
  });

  if (textEditor) {
    if (isIconNode) {
      textEditor.value = "";
      textEditor.placeholder = "";
    } else {
      textEditor.value = isImageNode || isRepeaterNode ? "" : getNodeText(node);
      textEditor.placeholder = "Binding / Text";
    }
  }
  if (textEditorLabel) {
    textEditorLabel.textContent = "Binding / Text";
  }
  if (repeaterItemsInput) {
    repeaterItemsInput.value = isRepeaterNode
      ? node.itemsBind
        ? node.itemsBind
        : Array.isArray(node.items)
          ? node.items.join("\n")
          : ""
      : "";
    repeaterItemsInput.placeholder =
      isRepeaterNode && node.itemsBind ? "Binding (@path)" : "One entry per line, or an @path binding";
  }
  if (repeaterColumnsInput) {
    repeaterColumnsInput.value = isRepeaterNode ? String(node.columns ?? 1) : "";
  }
  if (repeaterHeaderInput) {
    repeaterHeaderInput.checked = isRepeaterNode ? Boolean(node.showHeader) : false;
  }
  if (repeaterTemplateColumnsInput) {
    repeaterTemplateColumnsInput.value = isRepeaterNode ? node.templateColumns ?? "" : "";
  }
  if (repeaterTemplateColumnsGroup) {
    setGroupVisibility(repeaterTemplateColumnsGroup, isRepeaterNode && Number(node.columns) > 1);
  }
  const repeaterDecoratorType = isRepeaterNode ? node.decorator?.type ?? "none" : "none";
  if (repeaterDecoratorTypeInput) {
    repeaterDecoratorTypeInput.value = repeaterDecoratorType;
  }
  if (repeaterDecoratorTextInput) {
    repeaterDecoratorTextInput.value = isRepeaterNode ? node.decorator?.text ?? "" : "";
  }
  if (repeaterDecoratorTextGroup) {
    setGroupVisibility(repeaterDecoratorTextGroup, isRepeaterNode && repeaterDecoratorType === "custom");
  }

  if (imageUrlInput) {
    imageUrlInput.value = isImageNode ? node.url ?? "" : "";
  }
  if (imageWidthInput) {
    imageWidthInput.value = isImageNode && node.width !== undefined ? String(node.width) : "";
  }
  if (imageHeightInput) {
    imageHeightInput.value = isImageNode && node.height !== undefined ? String(node.height) : "";
  }
  if (imageFitInput) {
    imageFitInput.value = isImageNode ? node.fit ?? "cover" : "cover";
  }
  if (imageCornerRadiusInput) {
    imageCornerRadiusInput.value = isImageNode && typeof node.cornerRadius === "number" ? String(node.cornerRadius) : "";
  }
  if (imageFocalXInput) {
    imageFocalXInput.value = isImageNode && typeof node.focalX === "number" ? String(node.focalX) : "";
  }
  if (imageFocalYInput) {
    imageFocalYInput.value = isImageNode && typeof node.focalY === "number" ? String(node.focalY) : "";
  }
  if (imageZoomInput) {
    imageZoomInput.value = isImageNode && typeof node.zoom === "number" ? String(node.zoom) : "";
  }
  if (classNameInput) {
    classNameInput.value = getClassNameWithoutRequiredTokens(node, node.className ?? "");
  }
  if (iconInput) {
    const iconClass = getNodeIconClass(node);
    iconInput.value = iconClass;
    updateIconPreview(iconClass, getInspectorPreviewContext(node?.uid));
  }
  if (ariaLabelInput) {
    ariaLabelInput.value = node.ariaLabel ?? "";
  }

  const textSize = resolveTextSize(node);
  const hasCustomSize =
    (node?.textSizeCustom && Number.isFinite(node?.style?.fontSize)) ||
    (Number.isFinite(node?.style?.fontSize) && !node?.textSize);
  textSizeInputs.forEach((input) => {
    input.checked = !hasCustomSize && input.value === textSize;
  });
  if (textSizeCustomInput) {
    const fontSizePx = Number.isFinite(node?.style?.fontSize) ? node.style.fontSize : TEXT_SIZE_PX[textSize] ?? TEXT_SIZE_PX.md;
    textSizeCustomInput.value = pxToPt(fontSizePx);
    // Auto shrink-to-fit and a fixed pt size are mutually exclusive.
    textSizeCustomInput.disabled = textSize === "auto";
  }
  if (textInlineInput) {
    textInlineInput.checked = node?.textStyle === "span";
  }
  if (textLineHeightInput && document.activeElement !== textLineHeightInput) {
    textLineHeightInput.value = typeof node?.style?.lineHeight === "number" ? String(node.style.lineHeight) : "";
  }

  if (fontFamilyInput && document.activeElement !== fontFamilyInput) {
    // Only synced while the field isn't focused — while the user is
    // actively typing/filtering, updateInspector shouldn't stomp on what
    // they're mid-typing (matches how the icon/class-name autocompletes
    // treat their own inputs).
    const currentFamily = node?.style?.fontFamily;
    const matched = findFontOptionByFamily(currentFamily);
    if (matched) {
      fontFamilyInput.value = matched.label;
    } else if (currentFamily) {
      // Doesn't match any known option — e.g. a raw value saved before
      // this field grew a shared library, or set by hand in JSON. Shown
      // as-is rather than hidden, and re-typing it into "Add a font…"
      // would fold it into the library going forward.
      fontFamilyInput.value = currentFamily;
    } else {
      fontFamilyInput.value = "Default (theme font)";
    }
  }

  const textTransformState = resolveTextTransform(node);
  const resolvedAngle =
    Number.isFinite(node?.textAngle)
      ? node.textAngle
      : textTransformState.orientation === "vertical"
        ? 90
        : textTransformState.orientation === "diagonal"
          ? 45
          : 0;
  textOrientationInputs.forEach((input) => {
    input.checked = !textTransformState.isCustom && input.value === textTransformState.orientation;
  });
  if (textAngleInput) textAngleInput.value = String(resolvedAngle);
  if (textCurveInput) textCurveInput.value = String(textTransformState.curve ?? 0);

  renderColorFields(node);

  if (borderWidthInput) {
    // Shows the raw stored value, blank if it's not a real number — not a
    // fabricated "1" display default. applyBorderStyles' own `typeof
    // styles.borderWidth === "number" ? ... : 1` fallback is a rendering
    // concern (CSS needs some number to draw with), not a display one.
    borderWidthInput.value = Number.isFinite(node?.style?.borderWidth) ? String(node.style.borderWidth) : "";
  }
  if (borderStyleInput) {
    // Reads node.style.borderStyle directly — it's the border on/off
    // switch, not borderColor (a prior version of this had that backwards;
    // see hasBorderStyles' own comment). Matches Workbench's identical fix
    // (createBorderControls).
    borderStyleInput.value = node?.style?.borderStyle || "none";
  }
  if (borderRadiusInput) {
    const rawRadius = node?.style?.borderRadius;
    borderRadiusInput.value =
      borderVisible && rawRadius !== undefined && rawRadius !== null
        ? String(typeof rawRadius === "number" ? rawRadius : parseFloat(rawRadius) || 0)
        : "";
  }
  if (borderSideInputs.length) {
    const sides = node?.style?.borderSides ?? {};
    borderSideInputs.forEach((input) => {
      const key = input.dataset.componentBorderSide;
      if (!key) return;
      input.checked = borderVisible ? sides[key] !== false : false;
    });
  }
  // No Sides field at all with no border — "which sides" isn't a real,
  // applicable choice with the switch off; showing it pre-checked while
  // inert is its own kind of invisible-default confusion (matches
  // Workbench's identical fix, createBorderControls).
  if (borderSidesField) {
    borderSidesField.hidden = !borderVisible;
  }

  textStyleToggles.forEach((input) => {
    const styleKey = input.dataset.componentTextStyle;
    input.checked = Boolean(resolveTextStyles(node)[styleKey]);
  });

  const alignment = node?.align || "start";
  alignInputs.forEach((input) => {
    input.checked = input.value === alignment;
  });

  syncVisibilityControl(node);
}

function selectFirstNode() {
  const first = getRootChildren(currentSide)[0];
  selectedNodeId = first?.uid ?? null;
  renderPreview();
  renderLayoutList();
  updateInspector();
}

function selectNode(uid, { fromPreview = false } = {}) {
  selectedNodeId = uid;
  renderPreview();
  renderLayoutList();
  updateInspector();
  setInspectorMode("component");
}

// Not cryptographic — just enough to notice "the data at this card index
// doesn't look like what it did when this override was set" (dataFingerprint,
// stamped on override creation below). A plain string hash is plenty.
function simpleHash(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function valuesEqual(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (error) {
    return false;
  }
}

// Union of both objects' keys, not just `working`'s — a mutator that
// deletes a property (several existing ones do, e.g. clearing image fit
// back to its default) needs that absence to show up as a real diff
// against `base`, not silently vanish because Object.keys(working) never
// had it to begin with.
function diffTopLevelKeys(working, base) {
  const patch = {};
  const keys = new Set([...Object.keys(working ?? {}), ...Object.keys(base ?? {})]);
  keys.forEach((key) => {
    if (!valuesEqual(working?.[key], base?.[key])) {
      patch[key] = working?.[key];
    }
  });
  return patch;
}

// The data item currently shown at gridViewIndex in the Grid View — same
// resolution templates.js's own renderCardGrid/renderChipGrid use
// (resolveTemplateData + getRepeatData), reused here purely to compute a
// dataFingerprint when an override is first created.
function getGridViewData() {
  const template = getActiveTemplate();
  if (!template) return null;
  const { sourceData } = getSelectionContext();
  const pageConfig = getEditablePage(currentSide) ?? template.pages?.[currentSide] ?? {};
  const templateData = resolveTemplateData(template, sourceData);
  const items = getRepeatData(template, pageConfig, templateData);
  return Array.isArray(items) ? items[gridViewIndex] : null;
}

// Looks up (or, with create:true, lazily creates) the override entry for a
// single (side, card, node) triple. Creating one stamps it with a
// dataFingerprint of whatever's currently at that card index — a
// best-effort "does this still look like the same data" signal for the
// Make Unique button's warning state, not a correctness mechanism (see the
// plan's card-index-is-positional-not-a-stable-key note).
function getCardOverrideEntry(side, cardIndex, nodeUid, { create = false } = {}) {
  const page = editablePages?.[side];
  if (!page || !nodeUid) return null;
  if (!page.cardOverrides) {
    if (!create) return null;
    page.cardOverrides = {};
  }
  const cardKey = String(cardIndex);
  if (!page.cardOverrides[cardKey]) {
    if (!create) return null;
    page.cardOverrides[cardKey] = {};
  }
  if (!page.cardOverrides[cardKey][nodeUid]) {
    if (!create) return null;
    page.cardOverrides[cardKey][nodeUid] = { dataFingerprint: simpleHash(getGridViewData()) };
  }
  return page.cardOverrides[cardKey][nodeUid];
}

// Drops an override entry once neither its node nor placement patch has
// anything left in it (every field was dialed back to match the template
// value one at a time, without an explicit "turn Make Unique off") — same
// end state as toggling off, just reached incrementally.
function pruneEmptyCardOverrideEntry(side, cardIndex, nodeUid) {
  const page = editablePages?.[side];
  const cardKey = String(cardIndex);
  const entry = page?.cardOverrides?.[cardKey]?.[nodeUid];
  if (!entry) return;
  const hasNodePatch = entry.node && Object.keys(entry.node).length > 0;
  const hasPlacementPatch = entry.placement && Object.keys(entry.placement).length > 0;
  if (hasNodePatch || hasPlacementPatch) return;
  delete page.cardOverrides[cardKey][nodeUid];
  if (Object.keys(page.cardOverrides[cardKey]).length === 0) {
    delete page.cardOverrides[cardKey];
  }
}

// Unconditional delete (unlike pruneEmptyCardOverrideEntry, which only
// removes an entry once its patches are already empty) — this is the
// explicit "undo uniqueness" action, whether from the Make Unique toggle
// itself or the template-wide Clear all uniqueness button.
function deleteCardOverrideEntry(side, cardIndex, nodeUid) {
  const page = editablePages?.[side];
  const cardKey = String(cardIndex);
  if (!page?.cardOverrides?.[cardKey]) return;
  delete page.cardOverrides[cardKey][nodeUid];
  if (Object.keys(page.cardOverrides[cardKey]).length === 0) {
    delete page.cardOverrides[cardKey];
  }
}

// Make Unique only ever targets the Grid View's one unambiguous card — the
// page-grid Live Preview and the Layout list have no such context (a page
// can show several cards at once), so unique-mode is only active while
// that tab is the one currently shown, and only for a node that already
// has an override entry for the card currently in view there.
function isUniqueEditActive() {
  return activeViewTab === "grid" && Boolean(selectedNodeId) && Boolean(getCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId));
}

// The Make Unique button itself: toggling the override entry's mere
// existence is the on/off state (see isUniqueEditActive) — turning it on
// creates an empty entry ready for the next property edit to populate (via
// updateSelectedNode/updateSelectedPlacement's unique-mode branch); turning
// it off deletes it outright, immediately reverting this one component on
// this one card back to the shared template.
function toggleMakeUnique() {
  if (activeViewTab !== "grid" || !selectedNodeId) return;
  recordUndoableChange(() => {
    if (getCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId)) {
      deleteCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId);
    } else {
      getCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId, { create: true });
    }
    renderPreview();
    updateInspector();
  });
}

// Template-wide "undo everything" for uniqueness — wipes cardOverrides on
// both sides outright. Broader blast radius than any other single undo-able
// edit in this app (every card's uniqueness at once, not just the current
// selection), so it still gets a confirmation despite being on the undo
// stack like everything else here — unlike Delete Template, this genuinely
// can be undone with Ctrl+Z, so the prompt doesn't claim otherwise.
function clearAllUniqueness() {
  const template = getActiveTemplate();
  if (!template) return;
  const hasAnyOverrides = ["front", "back"].some(
    (side) => editablePages?.[side]?.cardOverrides && Object.keys(editablePages[side].cardOverrides).length > 0
  );
  if (!hasAnyOverrides) {
    status?.show("No per-card uniqueness to clear.", { type: "info", timeout: 2000 });
    return;
  }
  const confirmed = window.confirm("Clear all per-card uniqueness on this template?");
  if (!confirmed) return;
  recordUndoableChange(() => {
    ["front", "back"].forEach((side) => {
      if (editablePages?.[side]) {
        delete editablePages[side].cardOverrides;
      }
    });
    renderPreview();
    updateInspector();
  });
  status?.show("Cleared all per-card uniqueness.", { type: "success", timeout: 2000 });
}

function updateSelectedNode(updater) {
  if (typeof updater !== "function") return;
  const layout = getLayoutForSide(currentSide);
  const node = findNodeById(layout, selectedNodeId);
  if (!node) return;
  if (isUniqueEditActive()) {
    const entry = getCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId, { create: true });
    const working = { ...node, ...(entry.node ?? {}) };
    updater(working);
    const patch = diffTopLevelKeys(working, node);
    if (Object.keys(patch).length) {
      entry.node = patch;
    } else {
      delete entry.node;
    }
    pruneEmptyCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId);
    return;
  }
  updater(node);
}

function updateSelectedPlacement(updater) {
  if (typeof updater !== "function") return;
  const layout = getLayoutForSide(currentSide);
  const parentNode = findParentNode(layout, selectedNodeId);
  if (!parentNode || parentNode.type !== "layer") return;
  const placement = findLayerPlacement(parentNode, selectedNodeId);
  if (!placement) return;
  if (isUniqueEditActive()) {
    const entry = getCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId, { create: true });
    const working = { ...placement, ...(entry.placement ?? {}) };
    updater(working);
    const patch = diffTopLevelKeys(working, placement);
    // `node` is the child node reference living on the placement object —
    // never something a placement-field mutator legitimately touches, but
    // excluded defensively so a full node object can never end up
    // duplicated into the override.
    delete patch.node;
    if (Object.keys(patch).length) {
      entry.placement = patch;
    } else {
      delete entry.placement;
    }
    pruneEmptyCardOverrideEntry(currentSide, gridViewIndex, selectedNodeId);
    return;
  }
  updater(placement);
}

function applyOverlays(page, template, size, { forPrint = false, singleCard = false, updateLegend = true } = {}) {
  const legendItems = [];
  const isCardOrChip = template.type === "card" || template.type === "chip";

  if (isCardOrChip) {
    const { card } = template;
    // Grid View forces a single-tile render (see renderGridView/
    // singleCardIndex) regardless of the template's real columns/rows —
    // the guides need the same 1x1 treatment, or they'd keep drawing the
    // full multi-card sheet layout (cut/safe lines for cards that aren't
    // even on screen) around the one card actually shown.
    const columns = singleCard ? 1 : card.columns ?? 3;
    const rows = singleCard ? 1 : card.rows ?? 3;
    const cellWidth = card.width ?? 2.5;
    const cellHeight = template.type === "chip" ? cellWidth : card.height ?? 3.5;
    // Chips are always circular (matches .chip-circle's border-radius:50%)
    // — cellWidth/2 on a square box renders identically to 50%. Cards use
    // their own configurable, real cornerRadius (default 0, sharp).
    const cornerRadius = template.type === "chip" ? cellWidth / 2 : Math.max(0, card.cornerRadius ?? 0);
    const gridWidth = cellWidth * columns + card.gutter * (columns - 1);
    const gridHeight = cellHeight * rows + card.gutter * (rows - 1);
    const availableWidth = size.width - size.margin * 2;
    const availableHeight = size.height - size.margin * 2;
    const horizontalInset = size.margin + Math.max(0, (availableWidth - gridWidth) / 2);
    const verticalInset = size.margin + Math.max(0, (availableHeight - gridHeight) / 2);
    const cellLeft = (col) => horizontalInset + col * (cellWidth + card.gutter);
    const cellTop = (row) => verticalInset + row * (cellHeight + card.gutter);

    // Trim/cut line — always shown (editor + print). One outline per card
    // cell rather than a shared grid of straight segments, since that's
    // what lets it show rounded corners and generalizes cleanly to a
    // non-zero gutter (each card gets its own complete boundary).
    const trimGuides = document.createElement("div");
    trimGuides.className = "page-overlay trim-lines card-guides";
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const box = document.createElement("div");
        box.className = "guide-trim-box";
        box.style.left = `${cellLeft(col)}in`;
        box.style.top = `${cellTop(row)}in`;
        box.style.width = `${cellWidth}in`;
        box.style.height = `${cellHeight}in`;
        box.style.borderRadius = `${cornerRadius}in`;
        trimGuides.appendChild(box);
      }
    }
    page.appendChild(trimGuides);
    legendItems.push({ modifier: "trim", label: "Trim / cut line" });

    if (!forPrint && card.bleed) {
      const bleedGuides = document.createElement("div");
      bleedGuides.className = "page-overlay bleed-lines card-guides";
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const insets = computeBleedInsets(card.bleed, {
            row,
            col,
            rows,
            columns,
            gutter: card.gutter ?? 0,
            margin: size.margin ?? 0,
          });
          if (!insets.top && !insets.right && !insets.bottom && !insets.left) continue;
          const box = document.createElement("div");
          box.className = template.type === "chip" ? "guide-bleed-box guide-bleed-box--circle" : "guide-bleed-box";
          box.style.left = `${cellLeft(col) - insets.left}in`;
          box.style.top = `${cellTop(row) - insets.top}in`;
          box.style.width = `${cellWidth + insets.left + insets.right}in`;
          box.style.height = `${cellHeight + insets.top + insets.bottom}in`;
          // A visual approximation, not a true offset curve — good enough
          // for "here's roughly how far bleed extends," not a
          // manufacturing spec.
          if (template.type !== "chip") {
            box.style.borderRadius = `${cornerRadius}in`;
          }
          bleedGuides.appendChild(box);
        }
      }
      page.appendChild(bleedGuides);
      legendItems.push({ modifier: "bleed", label: "Bleed" });
    }

    if (!forPrint) {
      // Per-card, inset from that card's own edges by card.safeInset —
      // the same value applyRootLayoutOrigin (templates.js) actually pads
      // root-layer content by. Previously this drew a single box inset
      // from the whole page by the page margin, unrelated to safeInset
      // and wrong on any sheet with more than one card.
      const safeGuides = document.createElement("div");
      // Deliberately not the "safe-area" class — that carries CSS
      // (inset: 0.25in + a border) meant only for the single-box sheet
      // fallback below, which would shift this whole wrapper (and every
      // per-card box positioned relative to it) inward before the
      // per-card left/top offsets are even applied.
      safeGuides.className = "page-overlay safe-area-grid card-guides";
      const safeInset = Math.max(0, card.safeInset ?? 0);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const box = document.createElement("div");
          box.className = "guide-safe-box";
          box.style.left = `${cellLeft(col) + safeInset}in`;
          box.style.top = `${cellTop(row) + safeInset}in`;
          box.style.width = `${Math.max(0, cellWidth - safeInset * 2)}in`;
          box.style.height = `${Math.max(0, cellHeight - safeInset * 2)}in`;
          box.style.borderRadius = `${Math.max(0, cornerRadius - safeInset)}in`;
          safeGuides.appendChild(box);
        }
      }
      page.appendChild(safeGuides);
      legendItems.push({ modifier: "safe", label: "Safe area" });
    }
  } else if (!forPrint) {
    // Sheet-type templates have no per-card concept to anchor a safe
    // guide to — the page's own margin is the only meaningful "safe"
    // boundary here, so this fallback is unchanged from before.
    const safe = document.createElement("div");
    const inset = Math.max(0.2, size.margin ?? 0.25);
    safe.className = "page-overlay safe-area";
    safe.style.inset = `${inset}in`;
    page.appendChild(safe);
  }

  // Lives in the Live Preview card header (index.html), not inside `page`
  // — a fixed toolbar element rather than an overlay on the card itself,
  // so it never sits on top of card content and isn't affected by canvas
  // zoom/scroll. Only ever touched for the editable canvas's own
  // applyOverlays call (forPrint: false) — the print stack's calls skip
  // this branch entirely, so they can't stomp on it. updateLegend further
  // restricts this to whichever view (Live Preview vs. Grid View) is
  // actually the one currently visible — both call applyOverlays now, and
  // without this the last one to run would silently win regardless of
  // which is on screen.
  if (!forPrint && updateLegend && guideLegendElement) {
    guideLegendElement.innerHTML = "";
    // Plain `.hidden` doesn't reliably work here — .press-guide-legend has
    // its own `display: flex` (styles.css), which as an author-origin rule
    // beats the `[hidden]` UA rule regardless of !important. See
    // setElementVisible.
    setElementVisible(guideLegendElement, legendItems.length > 0);
    legendItems.forEach(({ modifier, label }) => {
      const item = document.createElement("div");
      item.className = "press-guide-legend__item";
      const swatch = document.createElement("span");
      swatch.className = `press-guide-legend__swatch press-guide-legend__swatch--${modifier}`;
      const text = document.createElement("span");
      text.textContent = label;
      item.append(swatch, text);
      guideLegendElement.appendChild(item);
    });
  }
}

function updateSideButton() {
  const viewingFront = currentSide === "front";
  const currentLabel = viewingFront ? "Front" : "Back";
  const nextLabel = viewingFront ? "Back" : "Front";
  swapSideButton.textContent = `Showing ${currentLabel} (switch to ${nextLabel})`;
  swapSideButton.setAttribute("aria-pressed", viewingFront ? "false" : "true");
}

// Hidden entirely for sheet templates and any card/chip template whose data
// fits on one page — cardPageIndex still exists in that case (always 0),
// there's just nothing to navigate to.
function updateCardPageNav(totalCardPages) {
  if (!cardPageNav) return;
  cardPageNav.hidden = totalCardPages <= 1;
  if (cardPageLabel) {
    cardPageLabel.textContent = `Page ${cardPageIndex + 1} of ${totalCardPages}`;
  }
  if (cardPagePrevButton) {
    cardPagePrevButton.disabled = cardPageIndex <= 0;
  }
  if (cardPageNextButton) {
    cardPageNextButton.disabled = cardPageIndex >= totalCardPages - 1;
  }
}

// Unlike updateCardPageNav, this never hides itself even when there's only
// one card — the Grid View's whole point is targeting one specific card
// for Make Unique, and that's just as true (if less useful to navigate)
// when there's only one.
function updateGridViewNav(totalCards, templateType) {
  if (gridViewLabel) {
    const noun = templateType === "chip" ? "Chip" : templateType === "card" ? "Card" : "Item";
    gridViewLabel.textContent = `${noun} ${gridViewIndex + 1} of ${totalCards}`;
  }
  if (gridViewPrevButton) {
    gridViewPrevButton.disabled = gridViewIndex <= 0;
  }
  if (gridViewNextButton) {
    gridViewNextButton.disabled = gridViewIndex >= totalCards - 1;
  }
}

// template.createPage always builds a full physical-page-sized element
// (the printed sheet a card would actually sit on), even in singleCardIndex
// mode — there's no separate "just render the tile" path, since the guide
// overlays (applyOverlays) position themselves in page-relative coordinates
// that assume that full page exists. Rather than teach the render pipeline
// a second output shape, this crops the already-correct full page down to
// just its one card/chip tile after the fact: shift the page by a negative
// offset so the tile's own top-left lands at the wrapper's origin, then let
// the wrapper's own overflow:hidden (.press-grid-tile, styles.css) clip
// away everything else. Needs real layout to measure, so it's a no-op
// while Grid View isn't actually the visible tab — see setActiveViewTab,
// which re-renders once it just became visible specifically to make this
// measurement valid.
function cropPageToSingleTile(page, stage) {
  if (!page || !stage) return;
  const tile = page.querySelector(".card-tile, .chip-tile");
  if (!tile) return;
  // Offset must be computed against the STAGE's rect, not the page's own
  // rect, and applied as an increment on top of whatever left/top this page
  // already has (rather than a flat replacement) — page itself carries the
  // zoom transform (see renderGridView/setCanvasZoom), and transform-origin
  // "top center" means the page's own rendered left edge shifts inward as
  // it scales, so it stops being a valid stand-in for "the reference point
  // that should land at 0". Using the page's own rect as that reference
  // worked by coincidence at 100% zoom (no scaling → no shift) but produced
  // an increasingly wrong offset at any other zoom level, since the
  // required correction is a straight function of the *current* left/top
  // (each px of left moves the rendered tile by exactly one px, regardless
  // of scale) rather than of the page's own scaled position.
  const stageRect = stage.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  const currentLeft = parseFloat(page.style.left) || 0;
  const currentTop = parseFloat(page.style.top) || 0;
  page.style.position = "absolute";
  page.style.left = `${currentLeft - (tileRect.left - stageRect.left)}px`;
  page.style.top = `${currentTop - (tileRect.top - stageRect.top)}px`;
  stage.style.width = `${tileRect.width}px`;
  stage.style.height = `${tileRect.height}px`;
}

// Renders exactly one card's front and back side by side (singleCardIndex
// forces renderCardGrid/renderChipGrid to a 1x1 layout regardless of the
// template's real columns/rows — see templates.js). Reuses the same
// editable/selection wiring as the main Live Preview so click-to-select
// already just works here; the only new behavior is that onSelect also
// fixes up currentSide to whichever side was actually clicked, since a
// selection made here can come from either front or back independent of
// which one previewStage/currentSide currently shows.
function renderGridView() {
  if (!gridViewStageFront && !gridViewStageBack) return;
  const context = getSelectionContext();
  const { template, source, format, size, sourceValue, sourceData } = context;
  if (!template || !size) {
    if (gridViewStageFront) gridViewStageFront.innerHTML = "";
    if (gridViewStageBack) gridViewStageBack.innerHTML = "";
    return;
  }
  // Cascades to every node that leaves its own Font field unset via
  // ordinary CSS inheritance — see the base font's own doc comment in
  // font-library.js. Set here (not just in renderPreview) since Grid View
  // has its own independent call sites that don't always go through it.
  if (viewPanelGrid) viewPanelGrid.style.fontFamily = template.baseFontFamily || DEFAULT_FONT_FAMILY;

  const sourceContext = { ...source, value: sourceValue, data: sourceData };

  const frontCount = getRepeatItemCount(template, "front", { data: sourceData, page: getEditablePage("front") });
  const backCount = getRepeatItemCount(template, "back", { data: sourceData, page: getEditablePage("back") });
  const totalCards = Math.max(frontCount, backCount);
  gridViewIndex = Math.min(Math.max(0, gridViewIndex), totalCards - 1);
  updateGridViewNav(totalCards, template.type);

  [
    { side: "front", stage: gridViewStageFront },
    { side: "back", stage: gridViewStageBack },
  ].forEach(({ side, stage }) => {
    if (!stage) return;
    stage.innerHTML = "";
    const page = template.createPage(side, {
      size,
      format,
      source: sourceContext,
      data: sourceData,
      page: getEditablePage(side),
      singleCardIndex: gridViewIndex,
      renderOptions: {
        editable: true,
        selectedId: selectedNodeId,
        onSelect: (uid) => {
          currentSide = side;
          selectNode(uid, { fromPreview: true });
        },
      },
    });
    // singleCard forces the trim/bleed/safe guides to the same 1x1
    // treatment the render itself got — otherwise they'd keep drawing the
    // full multi-card sheet layout around the one card actually shown.
    // updateLegend is always false here — the legend is Live-Preview-only
    // by design (it explains the trim/bleed/safe guide colors, which only
    // Live Preview's own overlay actually needs decoding at a glance);
    // Grid View never shows it regardless of which tab is active.
    applyOverlays(page, template, size, { forPrint: false, singleCard: true, updateLegend: false });
    stage.appendChild(page);
    withPanelVisibleForMeasurement(viewPanelGrid, activeViewTab === "grid", () => {
      // Same ordering constraint as renderPreview's own call: caps must be
      // measured before the zoom transform (unscaled CSS-pixel space), and
      // the crop (below) must measure the tile AFTER zoom is applied, since
      // it needs the tile's actual on-screen (scaled) size to crop the
      // stage to — otherwise zooming in Grid View would resize the visible
      // content but leave the surrounding tile box at its old, unscaled size.
      applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
      applyAutoFontSizing(page);
      applyOverflowIndicators(page);
      applyCanvasZoom(page);
      cropPageToSingleTile(page, stage);
    });
  });
}

// Plain `element.hidden = true` silently does nothing on an element that
// also carries an explicit CSS `display` (Bootstrap's `.d-flex` — declared
// `!important` — or even a plain, non-important custom class like
// `.press-guide-legend`'s own `display: flex`): the `[hidden]` UA rule is
// either out-`!important`-ed or simply loses to any author-origin rule
// regardless of `!important`, so it never actually collapses. Setting
// `display` inline with `!important` is the one thing guaranteed to win
// over both cases.
function setElementVisible(element, visible, displayValue = "flex") {
  if (!element) return;
  element.style.setProperty("display", visible ? displayValue : "none", "important");
}

// applyAutoWidthCaps (template-renderer.js) measures real layout via
// getBoundingClientRect(), which returns all zeros for anything inside a
// display:none subtree — and Live Preview / Grid View each keep re-rendering
// the other's panel in the background to stay in sync (renderPreview() always
// calls renderGridView(), see below) even while that other panel is hidden
// behind setElementVisible. Left unguarded, that corrupts the hidden panel's
// auto-width caps (visible as components cut off / misplaced) until
// something re-renders it again while actually visible. Force the panel
// visible for the duration of the synchronous measure-and-cap pass, then put
// it back exactly as setActiveViewTab last left it.
function withPanelVisibleForMeasurement(panel, wasVisible, fn) {
  if (!panel || wasVisible) {
    fn();
    return;
  }
  setElementVisible(panel, true, "block");
  fn();
  setElementVisible(panel, false);
}

// Grid View's whole point is paging through individual grid slots and
// pairing Make Unique to one of them — with columns=1/rows=1 (or no card/
// chip grid at all, e.g. a sheet template) there's no actual grid to view
// items of individually beyond what Live Preview's own page navigator
// already does, so the tab is disabled rather than offering a view that's
// redundant at best.
function templateHasGrid(template) {
  if (!template || (template.type !== "card" && template.type !== "chip")) return false;
  const columns = template.card?.columns ?? 1;
  const rows = template.card?.rows ?? 1;
  return columns > 1 || rows > 1;
}

// The suite-wide Mode control (createModeToggleGroup) — Live Preview/Grid
// View replace the old nav-tabs pair, mounted upper-right of the print
// surface's own header row same as every other tool's own Mode toggle. No
// View toggle alongside it — these two options ARE the mode, there's no
// secondary axis within either.
function renderModeToggle() {
  if (!modeToggleMount) return;
  const gridTooltip = gridViewAvailable
    ? "Front and back of one specific card/chip at a time — where Make Unique targets a per-item override"
    : "Not available — this template's grid is 1×1 (Template Properties → Columns/Rows), so there's nothing to page through beyond a single card/chip";
  createModeToggleGroup({
    container: modeToggleMount,
    ariaLabel: "Press view",
    options: [
      { value: "preview", icon: "tabler:eye", label: "Live Preview" },
      { value: "grid", icon: "tabler:layout-grid", label: "Grid View", tooltip: gridTooltip },
    ],
    value: activeViewTab,
    onChange: (next) => setActiveViewTab(next),
  });
  // createModeToggleGroup has no per-option `disabled` passthrough (same
  // reasoning Workbench's own Template-tier gating already worked around) —
  // a native disabled radio input is the simplest equivalent: the browser
  // itself refuses to check it, so onChange never fires for it.
  const gridInput = modeToggleMount.querySelector('input[value="grid"]');
  if (gridInput) gridInput.disabled = !gridViewAvailable;
}

function updateGridViewAvailability(template) {
  const available = templateHasGrid(template);
  gridViewAvailable = available;
  renderModeToggle();
  // Don't strand the user on a view that just became unavailable (e.g.
  // columns/rows edited down to 1x1 while Grid View was already open).
  if (!available && activeViewTab === "grid") {
    setActiveViewTab("preview");
  }
}

function setActiveViewTab(tab) {
  if (tab === "grid" && !gridViewAvailable) return;
  activeViewTab = tab === "grid" ? "grid" : "preview";
  renderModeToggle();
  setElementVisible(viewControlsPreview, activeViewTab === "preview");
  setElementVisible(viewControlsGrid, activeViewTab === "grid");
  setElementVisible(viewPanelPreview, activeViewTab === "preview", "block");
  setElementVisible(viewPanelGrid, activeViewTab === "grid", "block");
  // The guide legend only ever gets (re)populated by a Live Preview render
  // (applyOverlays's updateLegend is gated the same way) — force it out of
  // view immediately on switching away rather than leaving whatever it last
  // showed on screen until the next unrelated re-render happens to touch it.
  if (guideLegendElement && activeViewTab !== "preview") {
    setElementVisible(guideLegendElement, false);
  }
  // Grid View's page-cropping (see renderGridView) needs real layout
  // geometry, which getBoundingClientRect() can't provide while the panel
  // itself was just display:none — re-render now that it's actually on
  // screen so the crop measurement is correct immediately, not just after
  // some unrelated future re-render.
  if (activeViewTab === "grid") {
    renderGridView();
  }
  // Make Unique's availability depends on which tab is active (see
  // isUniqueEditActive) — the inspector needs to reflect that immediately
  // on switching, not just on the next unrelated re-render.
  updateInspector();
}

function renderPreview() {
  destroyCanvasDnd();
  const context = getSelectionContext();
  const { template, source, format, size, orientation, sourceValue, sourceData } = context;
  if (!template || !size) return;
  const side = currentSide;
  const pageOverride = getEditablePage(side);
  let layoutRoot = null;

  const totalCardPages = getCardPageCount(template, side, { data: sourceData, page: pageOverride });
  cardPageIndex = Math.min(Math.max(0, cardPageIndex), totalCardPages - 1);
  updateCardPageNav(totalCardPages);
  updateGridViewAvailability(template);

  // Cascades to every node that leaves its own Font field unset via
  // ordinary CSS inheritance — see the base font's own doc comment in
  // font-library.js.
  if (viewPanelPreview) viewPanelPreview.style.fontFamily = template.baseFontFamily || DEFAULT_FONT_FAMILY;

  previewStage.innerHTML = "";
  const sourceContext = { ...source, value: sourceValue, data: sourceData };
  const page = template.createPage(side, {
    size,
    format,
    source: sourceContext,
    data: sourceData,
    page: pageOverride,
    cardPageIndex,
    renderOptions: {
      editable: true,
      selectedId: selectedNodeId,
      onSelect: (uid) => selectNode(uid, { fromPreview: true }),
      onRootReady: (element) => {
        if (element?.nodeType === Node.ELEMENT_NODE) {
          element.dataset.layoutRoot = "true";
          element.dataset.layoutSide = side;
          layoutRoot = element;
        }
      },
    },
  });
  // updateLegend gated the same way as Grid View's own calls — whichever
  // tab is actually visible owns the shared legend element.
  applyOverlays(page, template, size, { forPrint: false, updateLegend: activeViewTab === "preview" });
  previewStage.appendChild(page);
  // Measured before the zoom transform below — getBoundingClientRect()
  // would otherwise return scaled (visual) pixels while max-width is set in
  // the page's own untransformed CSS pixel space, throwing the cap off by
  // whatever the current zoom level is.
  withPanelVisibleForMeasurement(viewPanelPreview, activeViewTab === "preview", () => {
    applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
    applyAutoFontSizing(page);
    applyOverflowIndicators(page);
  });
  applyCanvasZoom(page);
  initCanvasDnd(layoutRoot);
  initLayerPlacementDrag(layoutRoot);

  buildPrintStack(template, { size, format, data: sourceData, source: sourceContext });
  // Kept in sync on every renderPreview() call regardless of which tab is
  // currently visible, rather than hunting down every renderPreview() call
  // site to also call this — cheap enough (one extra single-card render)
  // and guarantees the Grid View is never stale by the time someone
  // switches to it.
  renderGridView();
  updateSideButton();
  renderSampleDataSection();
  renderJsonPreview();
}

function buildPrintStack(template, { size, format, data, source }) {
  printStack.style.fontFamily = template.baseFontFamily || DEFAULT_FONT_FAMILY;
  printStack.innerHTML = "";
  // #printStack is display:none outside of an actual print (see styles.css)
  // so it never clutters the normal UI — but that also means
  // getBoundingClientRect() returns all zeros for anything inside it, which
  // applyAutoWidthCaps needs to be real. Swapping to visibility:hidden for
  // the duration of the build keeps it laid out (and measurable) without
  // ever actually becoming visible, then restores display:none — no
  // perceptible flicker, since nothing paints in between within this one
  // synchronous pass.
  printStack.classList.remove("d-none");
  printStack.style.visibility = "hidden";
  // Each side can need a different number of physical pages (independent
  // repeat bindings, unless the back uses repeat:"same" to mirror the
  // front) — sidePageCounts is computed once per side up front so a
  // shorter side just runs out early instead of guessing a shared count.
  // Grouped page-by-page (front page 1, back page 1, front page 2, back
  // page 2, ...) rather than all fronts then all backs, so each physical
  // sheet's two sides land next to each other in print order — matches
  // the existing single-page case's front-then-back order exactly when
  // there's only one page.
  const sidePageCounts = template.sides.map((side) => getCardPageCount(template, side, { data, page: getEditablePage(side) }));
  const totalPrintPages = Math.max(1, ...sidePageCounts);
  for (let pageIndex = 0; pageIndex < totalPrintPages; pageIndex += 1) {
    template.sides.forEach((side, sideIndex) => {
      if (pageIndex >= sidePageCounts[sideIndex]) return;
      const page = template.createPage(side, {
        size,
        format,
        source,
        data,
        page: getEditablePage(side),
        cardPageIndex: pageIndex,
      });
      applyOverlays(page, template, size, { forPrint: true });
      printStack.appendChild(page);
      applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
      applyAutoFontSizing(page);
    });
  }
  printStack.classList.add("d-none");
  printStack.style.visibility = "";
}

function toggleSide() {
  currentSide = currentSide === "front" ? "back" : "front";
  const layout = getLayoutForSide(currentSide);
  const existing = findNodeById(layout, selectedNodeId);
  if (!existing) {
    selectedNodeId = null;
  }
  renderLayoutList();
  updateInspector();
  renderPreview();
}

function renderSourceInput(source) {
  sourceInputContainer.innerHTML = "";
  const inputSpec = source.input;
  if (!inputSpec) return;

  const labelRow = document.createElement("div");
  labelRow.className = "d-flex justify-content-between align-items-center gap-2 flex-wrap";

  const label = document.createElement("label");
  label.className = "form-label fw-semibold mb-0";
  label.setAttribute("for", `${source.id}-input`);
  label.textContent = inputSpec.label;
  labelRow.appendChild(label);

  if (inputSpec.helpTopic) {
    const sourceHelp = document.createElement("span");
    sourceHelp.className = "align-middle";
    sourceHelp.dataset.helpTopic = inputSpec.helpTopic;
    sourceHelp.dataset.helpInsert = "replace";
    sourceHelp.dataset.helpPlacement = "left";
    labelRow.appendChild(sourceHelp);
    initHelpSystem({ root: labelRow });
  }

  if (inputSpec.type === "library") {
    sourceInputContainer.append(labelRow);
    renderLibrarySourceInput(source, labelRow);
    return;
  }

  let input;
  if (inputSpec.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = inputSpec.rows ?? 3;
    input.className = "form-control";
  } else {
    input = document.createElement("input");
    input.type = inputSpec.type;
    input.className = "form-control";
    if (inputSpec.accept) {
      input.accept = inputSpec.accept;
    }
  }

  input.id = `${source.id}-input`;
  input.placeholder = inputSpec.placeholder ?? "";
  const savedValue = sourceValues[source.id];
  if (inputSpec.type === "file") {
    input.value = "";
  } else if (savedValue) {
    input.value = savedValue;
  }

  input.addEventListener("change", (event) => {
    if (inputSpec.type === "file") {
      sourceValues[source.id] = event.target.files?.[0] ?? null;
    } else {
      sourceValues[source.id] = event.target.value;
    }
    clearSourcePayload(source);
    updateGenerateButtonState();
    renderPreview();
  });

  sourceInputContainer.append(labelRow, input);
}

// "species" is already plural (singular and plural are the same word); the
// rest just need "es" after s/x/z/ch/sh ("class" -> "classes") vs. a plain
// "s" otherwise ("variant" -> "variants").
function pluralizeKind(kind) {
  if (kind === "species") return "species";
  if (/(s|x|z|ch|sh)$/i.test(kind)) return `${kind}es`;
  return `${kind}s`;
}

// Kind + item selects instead of free text — the whole point is not having
// to remember directory/file names. Selecting "All" fetches every saved
// entry of that kind as one array, matching how a 5e API list endpoint
// (e.g. /api/2024/classes) already expands into one card per entry.
async function renderLibrarySourceInput(source, labelRow) {
  const wrap = document.createElement("div");
  wrap.className = "d-flex flex-row gap-2";

  const kindSelect = document.createElement("select");
  kindSelect.className = "form-select flex-fill";
  kindSelect.id = `${source.id}-input`;
  LIBRARY_KINDS.forEach((kind) => {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind === "npc" ? "NPC" : kind.charAt(0).toUpperCase() + kind.slice(1);
    kindSelect.appendChild(option);
  });

  const itemSelect = document.createElement("select");
  itemSelect.className = "form-select flex-fill";

  const [savedKind, savedId] = String(sourceValues[source.id] || "").split("/");
  if (savedKind && LIBRARY_KINDS.includes(savedKind)) {
    kindSelect.value = savedKind;
  }

  function commitValue() {
    sourceValues[source.id] = `${kindSelect.value}/${itemSelect.value}`;
    clearSourcePayload(source);
    updateGenerateButtonState();
    renderPreview();
  }

  async function populateItems() {
    itemSelect.innerHTML = "";
    let names = [];
    try {
      // Every Library kind is DB-backed now (ownership/is_public — see
      // server/storage.py's library_items table), served via the same
      // /list/{kind} route the characters/templates/systems buckets already
      // used, instead of a hand-declared library-{kind} static mount per
      // kind (which never covered every kind — setting/location/kind itself
      // had none). An anonymous fetch here only ever sees public entries,
      // which is exactly what Press's read-only print-data picker needs.
      const { remote } = await dataManager.list(kindSelect.value, { refresh: true, includeLocal: false });
      names = dataManager
        .collectListEntries(remote, ["owned", "shared", "public"])
        .map((entry) => entry.id)
        .filter(Boolean)
        .sort();
    } catch (error) {
      // Leave names empty — the "All (0)" option below makes the empty
      // result visible rather than silently offering nothing.
    }
    const allOption = document.createElement("option");
    allOption.value = "*";
    allOption.textContent = `All ${pluralizeKind(kindSelect.value)} (${names.length})`;
    itemSelect.appendChild(allOption);
    names.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      itemSelect.appendChild(option);
    });
    itemSelect.value = names.includes(savedId) ? savedId : "*";
    commitValue();
  }

  kindSelect.addEventListener("change", populateItems);
  itemSelect.addEventListener("change", commitValue);

  wrap.append(kindSelect, itemSelect);
  sourceInputContainer.appendChild(wrap);
  await populateItems();
}

function describeBindingMismatch(template, data) {
  const bindingPaths = collectTemplateBindingPaths(template);
  if (bindingPaths.size) {
    const dataFieldPaths = new Set(collectDataFields(data).map((field) => field.path));
    const unresolved = [...bindingPaths].filter((path) => !dataFieldPaths.has(path));
    if (unresolved.length && unresolved.length / bindingPaths.size >= 0.5) {
      return `Loaded data doesn't match this template's bindings (missing: ${unresolved.join(", ")}) — the preview may render blank.`;
    }
  }
  if (template?.type === "card" || template?.type === "chip") {
    const frontRepeat = template.pages?.front?.repeat;
    const backRepeat = template.pages?.back?.repeat;
    if (typeof frontRepeat === "string" && typeof backRepeat === "string" && backRepeat !== "same" && frontRepeat !== backRepeat) {
      const frontCount = getRepeatData(template, template.pages.front, data).length;
      const backCount = getRepeatData(template, template.pages.back, data).length;
      if (frontCount && backCount && frontCount !== backCount) {
        return `Front has ${frontCount} card${frontCount === 1 ? "" : "s"}, back has ${backCount} — fronts and backs won't line up 1:1.`;
      }
    }
  }
  return null;
}

async function handleGeneratePrint() {
  const context = getSelectionContext();
  const { source, sourceValue } = context;
  if (!source) {
    if (status) {
      status.show("Select a source before generating.", { type: "warning", timeout: 2000 });
    }
    return;
  }
  const requiresInput = source?.input?.type !== "textarea";
  if (requiresInput && !sourceValue) {
    if (status) {
      status.show("Enter a source value before generating.", { type: "warning", timeout: 2000 });
    }
    return;
  }
  isGenerating = true;
  if (generateButton) {
    generateButton.textContent = "Generating...";
  }
  updateGenerateButtonState();
  try {
    const data = await loadSourceData(source, sourceValue, dataManager);
    setSourcePayload(source, {
      value: sourceValue,
      data,
      fetchedAt: new Date().toISOString(),
    });
    // Freshly loaded data almost certainly has a different item count than
    // whatever was being paged through before (sample data vs. a real,
    // much larger dataset, in particular) — start back at page 1 rather
    // than clamping to wherever cardPageIndex/gridViewIndex happened to be.
    cardPageIndex = 0;
    gridViewIndex = 0;
    renderPreview();
    bindingFieldCache.source = null;
    refreshBindingAutocomplete();
    if (applySelectionCollapse) {
      applySelectionCollapse(true);
    }
    if (applyPaletteCollapse) {
      applyPaletteCollapse(false);
    }
    const mismatchWarning = describeBindingMismatch(context.template, data);
    if (status) {
      if (mismatchWarning) {
        status.show(mismatchWarning, { type: "warning", timeout: 5000 });
      } else {
        status.show("Source data loaded for printing.", { type: "success", timeout: 2000 });
      }
    }
  } catch (error) {
    console.error("Unable to generate print data", error);
    if (status) {
      status.show(error.message || "Unable to load source data.", { type: "error", timeout: 4000 });
    }
  } finally {
    isGenerating = false;
    if (generateButton) {
      generateButton.textContent = "Generate Print";
    }
    updateGenerateButtonState();
  }
}

// Adds a real collapse/expand toggle to the Component Inspector's own
// named field groups (Text, Colors, Border, Behavior, Advanced) —
// previously always-expanded, only ever visibility-TOGGLED (shown/hidden
// entirely depending on the selected node's type via setGroupVisibility,
// never individually collapsed). Purely additive: wraps each group's
// existing content (after its own heading) into a collapsible body and
// injects a chevron toggle, reusing createCollapseToggleButton — the same
// shared primitive (common/js/lib/collapsible.js) Workbench's own
// createCollapsibleSection (common/js/lib/inspector-fields.js) is built
// on, so both tools' inspectors behave identically. Scoped to groups
// confirmed to have a clean single "heading div, then content" shape —
// several OTHER groups in this same panel mix multiple concerns in one
// visibility-gated container (e.g. the text orientation/decoration div
// carries both data-inspector-text-settings and data-inspector-text-
// decoration) and aren't safe to make collapsible sections in their own
// right without deeper restructuring; that's exactly why data-inspector-
// text-group exists as an outer wrapper instead of collapsing each text
// sub-group individually — it only ever touches its own heading + direct
// children, never reaches into what's mixed together inside them.
// Orthogonal to setGroupVisibility, which
// only ever toggles the outer group's own `hidden` — a group hidden as
// "not applicable to this node type" still hides in full (heading, toggle,
// and body together); this collapse state only governs the body's
// visibility while the group itself is shown.
// Returns a `setCollapsed(next)` the caller can use to drive this group's
// state programmatically (button chrome + body visibility together) — e.g.
// setInspectorMode below force-expands/collapses Page Bindings and Grid
// Properties when switching between Template/Component edit modes. The
// original 5 Component Inspector groups (Text/Colors/Border/Behavior/
// Advanced) have no such external driver and simply ignore the return
// value, same as before this existed.
function makeInspectorGroupCollapsible(selector, { defaultCollapsed = true } = {}) {
  const group = document.querySelector(selector);
  if (!group) return null;
  const heading = group.firstElementChild;
  if (!heading) return null;
  const bodyChildren = Array.from(group.children).slice(1);
  if (!bodyChildren.length) return null;
  const body = document.createElement("div");
  body.className = "d-flex flex-column gap-2";
  bodyChildren.forEach((child) => body.appendChild(child));
  const headerRow = document.createElement("div");
  headerRow.className = "d-flex align-items-center justify-content-between gap-2";
  group.insertBefore(headerRow, heading);
  headerRow.appendChild(heading);
  const { button, setCollapsed } = createCollapseToggleButton({
    label: heading.textContent || "section",
    collapsed: defaultCollapsed,
    onToggle: (collapsed) => {
      setElementCollapsed(body, collapsed);
    },
  });
  headerRow.appendChild(button);
  setElementCollapsed(body, defaultCollapsed);
  group.appendChild(body);
  return {
    setCollapsed: (next) => {
      setCollapsed(next);
      setElementCollapsed(body, next);
    },
  };
}

function initInspectorGroupCollapsibles() {
  makeInspectorGroupCollapsible("[data-inspector-text-group]");
  makeInspectorGroupCollapsible("[data-inspector-color-group]");
  makeInspectorGroupCollapsible("[data-inspector-border-group]");
  makeInspectorGroupCollapsible("[data-inspector-behavior-group]");
  makeInspectorGroupCollapsible("[data-inspector-advanced]");
}

function initPressCollapsibles() {
  initInspectorGroupCollapsibles();
  // Each of these five adopts its existing static `[data-xxx-panel]`
  // markup (own content stays hand-authored HTML — only the header+chevron
  // wrapper is JS-built) as its section's content.
  const selectionsSection = createCollapsibleSection({
    label: "Selections",
    helpTopic: "press.selection",
    collapsed: false,
    content: document.querySelector("[data-selection-panel]"),
  });
  selectionsSection.section.id = "press-selection";
  document.querySelector("[data-selection-mount]")?.appendChild(selectionsSection.section);
  applySelectionCollapse = selectionsSection.setCollapsed;

  // Palette — collapsed by default, expanded the moment Selections itself
  // collapses (same trigger point as applySelectionCollapse(true) below —
  // the reciprocal Selections-collapses/Palette-expands behavior the user
  // asked for), rather than staying always-expanded like the old
  // always-visible left-pane section did.
  const paletteSection = createCollapsibleSection({
    label: "Palette",
    helpTopic: "press.palette",
    collapsed: true,
    content: document.querySelector("[data-palette-panel]"),
  });
  document.querySelector("[data-palette-mount]")?.appendChild(paletteSection.section);
  applyPaletteCollapse = paletteSection.setCollapsed;

  const templateSection = createCollapsibleSection({
    label: "Template Properties",
    collapsed: false,
    className: "d-flex flex-column gap-4",
    // Formerly its own toolbar row (data-template-toolbar-mount, removed
    // now that New/Save/Duplicate/Delete Template live in the left-pane
    // toolbar) — Clear Uniqueness is template-scoped, not part of that
    // six-button set, so it stays here as a header action instead.
    actions: [
      {
        icon: "tabler:eraser",
        variant: "outline-secondary",
        label: "Clear all uniqueness",
        attrs: {
          "data-template-clear-uniqueness": true,
          "data-bs-title": "Clear all per-card uniqueness on this template",
        },
      },
    ],
    content: document.querySelector("[data-template-panel]"),
  });
  templateSection.section.setAttribute("data-template-properties", "");
  document.querySelector("[data-template-properties-mount]")?.appendChild(templateSection.section);
  applyTemplateCollapse = templateSection.setCollapsed;

  // Template Properties' own sub-groups — same makeInspectorGroupCollapsible
  // mechanism (and same visual result: no border box, plain uppercase
  // heading, chevron toggle) the Component Inspector's Text/Colors/Border/
  // Behavior/Advanced groups already use just below
  // (initInspectorGroupCollapsibles), rather than the old bordered-box +
  // <h3> shape Page Bindings/Grid Properties used to have. Text/Formats/
  // Supported Sources are new groupings (previously always-visible, flat
  // fields) so they default collapsed, matching that same precedent; Page
  // Bindings/Grid Properties keep their own prior default of starting
  // expanded — only their styling changed, not that behavior.
  makeInspectorGroupCollapsible("[data-inspector-template-text-group]");
  makeInspectorGroupCollapsible("[data-inspector-template-formats-group]");
  makeInspectorGroupCollapsible("[data-inspector-template-sources-group]");
  const pageBindingsGroup = makeInspectorGroupCollapsible("[data-inspector-page-bindings-group]", { defaultCollapsed: false });
  applyPageBindingsCollapse = pageBindingsGroup?.setCollapsed || (() => {});
  const gridPropertiesGroup = makeInspectorGroupCollapsible("[data-inspector-grid-properties-group]", { defaultCollapsed: false });
  applyCardCollapse = gridPropertiesGroup?.setCollapsed || (() => {});

  const componentSection = createCollapsibleSection({
    label: "Inspector",
    helpTopic: "press.inspector",
    collapsed: true,
    className: "d-flex flex-column gap-4",
    content: document.querySelector("[data-component-panel]"),
  });
  componentSection.section.setAttribute("data-component-properties", "");
  // The original help span also carried data-help-placement="left"
  // (tooltip renders to the left, since this section sits in the narrower
  // right-hand inspector pane) — createCollapsibleSection's own helpTopic
  // option doesn't expose that, so it's set directly on the built span.
  componentSection.section
    .querySelector("[data-help-topic]")
    ?.setAttribute("data-help-placement", "left");
  document.querySelector("[data-component-properties-mount]")?.appendChild(componentSection.section);
  applyComponentCollapse = componentSection.setCollapsed;

  // jsonDataPanel/sampleDataSection already wire their own collapse
  // behavior at construction (ui-components.js) — mounting is all that's
  // left here. Sample Data order matters: it comes before JSON Data (which
  // carries mt-auto to stay last in the pane).
  document.querySelector("[data-sample-data-mount]")?.appendChild(sampleDataSection.section);
  document.querySelector("[data-json-mount]")?.appendChild(jsonDataPanel.section);
  bindCopyButton(sampleDataCopyButton, sampleDataInput);
}

function setInspectorMode(mode) {
  // Both queried live, not as module-top-level consts — the toggle button
  // lives inside the header and the pane itself is the <aside> buildPaneShell
  // builds, both only existing once initAppShell() has run, which is later
  // than this module's own top-level code; an eager query here would have
  // captured null permanently.
  const rightPaneToggle = document.querySelector('[data-pane-toggle="right"]');
  const rightPane = queryRightPane();
  if (rightPane && rightPaneToggle) {
    expandPane(rightPane, rightPaneToggle);
  }
  if (mode === "template") {
    if (applyTemplateCollapse) applyTemplateCollapse(false);
    if (applyPageBindingsCollapse) applyPageBindingsCollapse(false);
    if (applyCardCollapse) applyCardCollapse(false);
    if (applyComponentCollapse) applyComponentCollapse(true);
  }
  if (mode === "component") {
    if (applyTemplateCollapse) applyTemplateCollapse(true);
    if (applyPageBindingsCollapse) applyPageBindingsCollapse(true);
    if (applyCardCollapse) applyCardCollapse(true);
    if (applyComponentCollapse) applyComponentCollapse(false);
  }
}

function initPaletteDnd() {
  renderPalette();
  if (!paletteList) return;
  if (paletteSortable?.destroy) {
    paletteSortable.destroy();
  }
  paletteSortable = createSortable(paletteList, {
    group: { name: "press-layout", pull: "clone", put: false },
    sort: false,
    fallbackOnBody: true,
    handle: null,
  });
}

function handleLayoutAdd(event) {
  const type = event.item?.dataset?.componentType;
  const newNode = createNodeFromPalette(type);
  event.item?.remove();
  if (!newNode) return;
  recordUndoableChange(() => {
    const index = typeof event.newIndex === "number" ? event.newIndex : getRootChildren(currentSide).length;
    insertNodeAtRoot(currentSide, newNode, index);
    selectNode(newNode.uid);
  });
}

function handleLayoutReorder(event) {
  recordUndoableChange(() => {
    reorderRootChildren(currentSide, event.oldIndex ?? 0, event.newIndex ?? 0);
    renderLayoutList();
    renderPreview();
  });
}

function initLayoutDnd() {
  if (!layoutList) return;
  if (layoutSortable?.destroy) {
    layoutSortable.destroy();
  }
  layoutSortable = createSortable(layoutList, {
    group: { name: "press-layout", pull: true, put: true },
    animation: 150,
    handle: "[data-sortable-handle]",
    onAdd: handleLayoutAdd,
    onUpdate: handleLayoutReorder,
  });
}

function destroyCanvasDnd() {
  canvasSortables.forEach((sortable) => {
    if (sortable?.destroy) {
      sortable.destroy();
    }
  });
  canvasSortables = [];
}

function handleLayerAdd(event, layerId) {
  const type = event.item?.dataset?.componentType;
  const layout = getLayoutForSide(currentSide);
  if (!layout) {
    event.item?.remove();
    return;
  }
  const layerNode = findNodeById(layout, layerId);
  if (!layerNode || layerNode.type !== "layer") {
    event.item?.remove();
    return;
  }
  const draggedId = getDraggedNodeId(event.item);
  event.item?.remove();
  recordUndoableChange(() => {
    let node = null;
    if (type) {
      node = createNodeFromPalette(type);
    } else if (draggedId) {
      node = removeNodeById(layout, draggedId);
    }
    if (!node) return;
    const index = typeof event.newIndex === "number" ? event.newIndex : layerNode.placements?.length ?? 0;
    insertNodeIntoLayer(layerNode, node, index);
    selectedNodeId = node.uid ?? selectedNodeId;
    renderLayoutList();
    setInspectorMode("component");
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

// CSS defines 1in as exactly 96 reference pixels, independent of physical
// display DPI, and getBoundingClientRect() values already reflect this
// ratio consistently under browser zoom — so drag deltas convert with this
// flat constant rather than measuring a card's rendered box each time.
const PX_PER_INCH = 96;
const PLACEMENT_DRAG_THRESHOLD_IN = 0.02;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
let zoomLevel = 1;

function applyCanvasZoom(page) {
  if (!page) return;
  page.style.transform = `scale(${zoomLevel})`;
  page.style.transformOrigin = "top center";
  if (canvasZoomLevelLabel) {
    canvasZoomLevelLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
}

function setCanvasZoom(nextZoom) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(nextZoom * 100) / 100));
  applyCanvasZoom(previewStage.firstElementChild);
  // Zoom is a single shared control now (visible in both tabs, see index.html),
  // so a zoom click needs to update whichever view isn't currently on screen
  // too, not just the visible one — otherwise switching tabs would show a
  // stale zoom level until the next unrelated re-render. Grid View's crop
  // also depends on the post-zoom tile size (see renderGridView), so it has
  // to be recomputed here, not just re-scaled.
  withPanelVisibleForMeasurement(viewPanelGrid, activeViewTab === "grid", () => {
    [gridViewStageFront, gridViewStageBack].forEach((stage) => {
      const page = stage?.firstElementChild;
      if (!page) return;
      applyCanvasZoom(page);
      cropPageToSingleTile(page, stage);
    });
  });
}

function initLayerPlacementDrag(rootElement) {
  if (!rootElement) return;
  const wrappers = rootElement.querySelectorAll('[data-press-container="layer"] > .press-layer-item[data-node-id]');
  wrappers.forEach((wrapper) => {
    wrapper.addEventListener("pointerdown", handlePlacementPointerDown);
  });
}

function handlePlacementPointerDown(event) {
  if (event.button !== 0) return;
  let wrapper = event.currentTarget;
  const nodeId = wrapper.dataset.nodeId;
  if (!nodeId) return;

  const layout = getLayoutForSide(currentSide);
  const layerNode = layout ? findParentNode(layout, nodeId) : null;
  if (!layerNode || layerNode.type !== "layer") return;
  const placement = findLayerPlacement(layerNode, nodeId);
  if (!placement) return;

  event.preventDefault();
  if (selectedNodeId !== nodeId) {
    // selectNode() runs a full renderPreview(), which tears down and
    // rebuilds the entire canvas DOM — the wrapper captured above is now
    // detached, so re-acquire the live one for this node before using it
    // for any further style/class mutation.
    selectNode(nodeId, { fromPreview: true });
    const refreshed = Array.from(
      document.querySelectorAll('[data-press-container="layer"] > .press-layer-item[data-node-id]')
    ).find((el) => el.dataset.nodeId === nodeId);
    if (!refreshed) return;
    wrapper = refreshed;
  }

  const layerContainer = wrapper.closest('[data-press-container="layer"]');
  if (!layerContainer) return;

  // A root layer's own rendered box is inset from the card's true trim
  // edge by safeInset (applyRootLayoutOrigin, templates.js) unless its
  // origin is explicitly "trim"/"bleed" — clamping to just the rendered
  // box (as measured) would then stop noticeably short of the actual card
  // edge for the common default case, so the bounds are widened by that
  // same inset here to reach the real edge, matching what "outer bounds of
  // the card" means for the layer's own configured origin.
  const isRootLayer = layout?.uid === layerNode.uid;
  const origin = layerNode.origin || "safe";
  const safeInset = isRootLayer && origin === "safe" ? getActiveTemplate()?.card?.safeInset ?? 0 : 0;

  // getBoundingClientRect() already reflects the canvas's current CSS
  // zoom transform (applyCanvasZoom) — a scaled element's rect comes back
  // scaled — but event.clientX/clientY deltas are real, untransformed
  // viewport pixels that don't scale with zoom. Both need dividing by the
  // same effective ratio so the rect-derived clamp bounds and the
  // pointer-derived movement stay in the same (inch) units as each other.
  const effectivePxPerInch = PX_PER_INCH * zoomLevel;

  const startClientX = event.clientX;
  const startClientY = event.clientY;
  const startX = typeof placement.x === "number" ? placement.x : 0;
  const startY = typeof placement.y === "number" ? placement.y : 0;
  const layerRect = layerContainer.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const minX = -safeInset;
  const minY = -safeInset;
  const maxX = Math.max(minX, layerRect.width / effectivePxPerInch + safeInset - wrapperRect.width / effectivePxPerInch);
  const maxY = Math.max(minY, layerRect.height / effectivePxPerInch + safeInset - wrapperRect.height / effectivePxPerInch);

  let moved = false;
  let finalX = startX;
  let finalY = startY;

  const handlePointerMove = (moveEvent) => {
    const deltaXIn = (moveEvent.clientX - startClientX) / effectivePxPerInch;
    const deltaYIn = (moveEvent.clientY - startClientY) / effectivePxPerInch;
    if (!moved && Math.hypot(deltaXIn, deltaYIn) < PLACEMENT_DRAG_THRESHOLD_IN) return;
    if (!moved) {
      moved = true;
      beginPendingUndo(wrapper);
      wrapper.classList.add("press-layer-item--dragging");
    }
    finalX = Math.min(maxX, Math.max(minX, startX + deltaXIn));
    finalY = Math.min(maxY, Math.max(minY, startY + deltaYIn));
    // Cheap, direct visual feedback during the drag — the data model and a
    // full renderPreview() only happen once, on pointerup, since
    // renderPreview() rebuilds the entire card DOM and would be far too
    // expensive to call on every pointermove.
    wrapper.style.left = `${finalX}in`;
    wrapper.style.top = `${finalY}in`;
  };

  const handlePointerUp = () => {
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    if (!moved) return;
    wrapper.classList.remove("press-layer-item--dragging");
    updateSelectedPlacement((current) => {
      current.x = Math.round(finalX * 100) / 100;
      current.y = Math.round(finalY * 100) / 100;
    });
    commitPendingUndo(wrapper);
    renderLayoutList();
    updateInspector();
    renderPreview();
    updateSaveState();
  };

  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp, { once: true });
}

// Only registered (see initCanvasDnd) on a grid container with zero
// existing rows — a grid with rows already has per-cell slots to drop into,
// so this is purely the recovery path for a brand-new or emptied-out grid
// that otherwise has no droppable surface at all.
// A Layer's placements are absolutely positioned, contributing no
// intrinsic height of their own — the Layer's box only ever gets a real
// height when it's sized directly against the card (applyRootLayoutOrigin,
// templates.js), which only happens when the Layer IS the page's
// top-level layout. Nested one level into a grid cell (an auto-sized row
// with no explicit height to give it), it collapses to a sliver instead.
// So swapping the page root's own type in place is the only place a Layer
// is accepted; everywhere else it's rejected outright rather than
// silently producing a broken, unmovable layer.
function replaceRootWithLayer(layout, layerTemplateNode) {
  const preservedUid = layout.uid;
  Object.keys(layout).forEach((key) => {
    if (key !== "uid") delete layout[key];
  });
  Object.assign(layout, layerTemplateNode);
  layout.uid = preservedUid;
}

function handleGridAdd(event, gridId) {
  const type = event.item?.dataset?.componentType;
  const layout = getLayoutForSide(currentSide);
  if (!layout) {
    event.item?.remove();
    return;
  }
  const gridNode = findNodeById(layout, gridId);
  if (!gridNode || gridNode.type !== "grid") {
    event.item?.remove();
    return;
  }
  const draggedId = getDraggedNodeId(event.item);
  const isRootGrid = gridId === layout.uid;
  const isLayerType = type === "layer" || findNodeById(layout, draggedId ?? "")?.type === "layer";
  if (isLayerType && !isRootGrid) {
    event.item?.remove();
    status.show("A Layer can only be used as the top-level layout, not nested inside a Grid.", {
      type: "warning",
      timeout: 4000,
    });
    return;
  }
  event.item?.remove();
  recordUndoableChange(() => {
    let node = null;
    if (type) {
      node = createNodeFromPalette(type);
    } else if (draggedId) {
      node = removeNodeById(layout, draggedId);
    }
    if (!node) return;
    if (node.type === "layer") {
      replaceRootWithLayer(layout, node);
      selectedNodeId = layout.uid;
    } else {
      const index = typeof event.newIndex === "number" ? event.newIndex : gridNode.cells?.length ?? 0;
      insertRowIntoGrid(gridNode, node, index);
      selectedNodeId = node.uid ?? selectedNodeId;
    }
    renderLayoutList();
    setInspectorMode("component");
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

function handleSlotAdd(event, slotElement) {
  const slotType = slotElement?.dataset?.pressSlot;
  const layout = getLayoutForSide(currentSide);
  if (!layout || !slotElement) {
    event.item?.remove();
    return;
  }
  const parentId = slotElement.dataset.parentNodeId;
  if (!parentId) {
    event.item?.remove();
    return;
  }
  const parentNode = findNodeById(layout, parentId);
  if (!parentNode) {
    event.item?.remove();
    return;
  }
  const type = event.item?.dataset?.componentType;
  const draggedId = getDraggedNodeId(event.item);
  const isLayerType = type === "layer" || findNodeById(layout, draggedId ?? "")?.type === "layer";
  if (isLayerType) {
    event.item?.remove();
    status.show("A Layer can only be used as the top-level layout, not nested inside a cell.", {
      type: "warning",
      timeout: 4000,
    });
    return;
  }
  event.item?.remove();
  recordUndoableChange(() => {
    let node = null;
    if (type) {
      node = createNodeFromPalette(type);
    } else if (draggedId) {
      node = removeNodeById(layout, draggedId);
    }
    if (!node) return;
    if (slotType === "repeater" || slotType === "grid") {
      const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
      const targetIndex = typeof event.newIndex === "number" ? event.newIndex : Number.MAX_SAFE_INTEGER;
      if (slotType === "repeater" && slotElement.dataset.slotRow === "header") {
        insertRepeaterHeaderCellNode(parentNode, columnIndex, node, targetIndex);
      } else {
        const rowIndex = slotType === "repeater" ? 0 : Number.parseInt(slotElement.dataset.rowIndex ?? "0", 10);
        insertCellNode(parentNode, rowIndex, columnIndex, node, targetIndex);
      }
    }
    selectedNodeId = node.uid ?? selectedNodeId;
    renderLayoutList();
    setInspectorMode("component");
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

function handleSlotReorder(event, slotElement) {
  const slotType = slotElement?.dataset?.pressSlot;
  if (slotType !== "repeater" && slotType !== "grid") return;
  const layout = getLayoutForSide(currentSide);
  if (!layout || !slotElement) return;
  const parentId = slotElement.dataset.parentNodeId;
  if (!parentId) return;
  const parentNode = findNodeById(layout, parentId);
  if (!parentNode) return;
  const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
  recordUndoableChange(() => {
    if (slotType === "repeater" && slotElement.dataset.slotRow === "header") {
      reorderRepeaterHeaderCellNodes(parentNode, columnIndex, event.oldIndex ?? 0, event.newIndex ?? 0);
    } else {
      const rowIndex = slotType === "repeater" ? 0 : Number.parseInt(slotElement.dataset.rowIndex ?? "0", 10);
      reorderCellNodes(parentNode, rowIndex, columnIndex, event.oldIndex ?? 0, event.newIndex ?? 0);
    }
    renderLayoutList();
    renderPreview();
  });
  updateSaveState();
}

function initCanvasDnd(rootElement) {
  if (!rootElement) {
    destroyCanvasDnd();
    return;
  }

  destroyCanvasDnd();
  const layerContainers = [];
  if (rootElement.dataset.pressContainer === "layer") {
    layerContainers.push(rootElement);
  }
  layerContainers.push(...rootElement.querySelectorAll('[data-press-container="layer"]'));
  layerContainers.forEach((container) => {
    const layerId = container.dataset.nodeId;
    if (!layerId) return;
    const sortable = createSortable(container, {
      group: { name: "press-layout", pull: true, put: true },
      animation: 150,
      fallbackOnBody: true,
      handle: null,
      // Existing layer children are excluded from this list's own draggable
      // set (only incoming [data-component-type] palette items match) so a
      // mousedown on a placed child is free for the free-drag reposition
      // gesture (initLayerPlacementDrag) instead of triggering a
      // SortableJS reorder.
      draggable: "[data-component-type]",
      onAdd: (event) => handleLayerAdd(event, layerId),
    });
    if (sortable) canvasSortables.push(sortable);
  });

  // A grid with at least one row already has per-cell [data-press-slot]
  // targets to drop into (registered below) — this only covers a grid with
  // zero rows (a brand-new template's default empty layout, or a grid
  // emptied out via deletion), which otherwise has no droppable surface at
  // all. Scoping to childless containers avoids two nested sortables both
  // claiming the same drop.
  const emptyGridContainers = [];
  if (rootElement.dataset.pressContainer === "grid" && rootElement.children.length === 0) {
    emptyGridContainers.push(rootElement);
  }
  emptyGridContainers.push(
    ...Array.from(rootElement.querySelectorAll('[data-press-container="grid"]')).filter(
      (container) => container.children.length === 0
    )
  );
  emptyGridContainers.forEach((container) => {
    const gridId = container.dataset.nodeId;
    if (!gridId) return;
    const sortable = createSortable(container, {
      group: { name: "press-layout", pull: true, put: true },
      animation: 150,
      fallbackOnBody: true,
      handle: null,
      draggable: "[data-node-id], [data-component-type]",
      onAdd: (event) => handleGridAdd(event, gridId),
    });
    if (sortable) canvasSortables.push(sortable);
  });

  const slotTargets = Array.from(rootElement.querySelectorAll("[data-press-slot]"));
  slotTargets.forEach((slot) => {
    const isCellSlot = slot.dataset.pressSlot === "repeater" || slot.dataset.pressSlot === "grid";
    const sortable = createSortable(slot, {
      group: { name: "press-layout", pull: true, put: true },
      animation: 150,
      fallbackOnBody: true,
      handle: null,
      sort: isCellSlot,
      draggable: "[data-node-id], [data-component-type]",
      onAdd: (event) => handleSlotAdd(event, slot),
      onUpdate: (event) => handleSlotReorder(event, slot),
    });
    if (sortable) canvasSortables.push(sortable);
  });
}

function initDragAndDrop() {
  initPaletteDnd();
  initLayoutDnd();
}

function bindInspectorControls() {
  if (parentSelectButton) {
    parentSelectButton.addEventListener("click", () => {
      const parentId = parentSelectButton.dataset.parentNodeId;
      if (parentId) {
        selectNode(parentId);
      }
    });
  }

  if (textEditor) {
    textEditor.addEventListener("focus", () => beginPendingUndo(textEditor));
    textEditor.addEventListener("blur", () => commitPendingUndo(textEditor));
    textEditor.addEventListener("change", () => commitPendingUndo(textEditor));
    textEditor.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component === "image" || node.component === "repeater") {
          return;
        }
        node.text = textEditor.value;
        node.label = textEditor.value;
      });
      renderPreview();
      renderLayoutList();
      updateSaveState();
    });
  }

  if (repeaterDecoratorTypeInput) {
    repeaterDecoratorTypeInput.addEventListener("focus", () => beginPendingUndo(repeaterDecoratorTypeInput));
    repeaterDecoratorTypeInput.addEventListener("blur", () => commitPendingUndo(repeaterDecoratorTypeInput));
    repeaterDecoratorTypeInput.addEventListener("change", () => commitPendingUndo(repeaterDecoratorTypeInput));
    repeaterDecoratorTypeInput.addEventListener("input", () => {
      const type = repeaterDecoratorTypeInput.value || "none";
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.component !== "repeater") return;
          node.decorator = type === "none" ? null : { ...(node.decorator ?? {}), type };
        });
        updateInspector();
        renderPreview();
      });
      updateSaveState();
    });
  }

  if (repeaterDecoratorTextInput) {
    repeaterDecoratorTextInput.addEventListener("focus", () => beginPendingUndo(repeaterDecoratorTextInput));
    repeaterDecoratorTextInput.addEventListener("blur", () => commitPendingUndo(repeaterDecoratorTextInput));
    repeaterDecoratorTextInput.addEventListener("change", () => commitPendingUndo(repeaterDecoratorTextInput));
    repeaterDecoratorTextInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "repeater" || node.decorator?.type !== "custom") return;
        node.decorator = { ...node.decorator, text: repeaterDecoratorTextInput.value };
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (repeaterItemsInput) {
    repeaterItemsInput.addEventListener("focus", () => beginPendingUndo(repeaterItemsInput));
    repeaterItemsInput.addEventListener("blur", () => commitPendingUndo(repeaterItemsInput));
    repeaterItemsInput.addEventListener("change", () => commitPendingUndo(repeaterItemsInput));
    repeaterItemsInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "repeater") return;
        const trimmed = repeaterItemsInput.value.trim();
        if (trimmed.startsWith("@")) {
          node.itemsBind = trimmed;
          node.items = [];
        } else {
          node.items = repeaterItemsInput.value
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean);
          delete node.itemsBind;
        }
      });
      renderPreview();
      renderLayoutList();
      updateSaveState();
    });
  }

  if (repeaterColumnsInput) {
    repeaterColumnsInput.addEventListener("focus", () => beginPendingUndo(repeaterColumnsInput));
    repeaterColumnsInput.addEventListener("blur", () => commitPendingUndo(repeaterColumnsInput));
    repeaterColumnsInput.addEventListener("change", () => commitPendingUndo(repeaterColumnsInput));
    repeaterColumnsInput.addEventListener("input", () => {
      const nextColumns = Math.max(1, Math.min(8, Number.parseInt(repeaterColumnsInput.value, 10) || 1));
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.component !== "repeater") return;
          const currentColumns = Array.isArray(node.cells?.[0]) ? node.cells[0].length : node.columns ?? 1;
          node.columns = nextColumns;
          if (nextColumns > currentColumns) {
            for (let index = currentColumns; index < nextColumns; index += 1) {
              addColumnCells(node, index);
              if (node.showHeader) {
                const headerCell = assignNodeIds({
                  type: "field",
                  component: "text",
                  text: `Column ${index + 1}`,
                  textStyles: { bold: true },
                });
                insertRepeaterHeaderCellNode(node, index, headerCell, 0);
              }
            }
          } else if (nextColumns < currentColumns) {
            for (let index = currentColumns - 1; index >= nextColumns; index -= 1) {
              removeColumnCells(node, index);
              if (Array.isArray(node.headerCells?.[0])) {
                node.headerCells[0].splice(index, 1);
              }
            }
          }
        });
        renderLayoutList();
        updateInspector();
        renderPreview();
      });
      updateSaveState();
    });
  }

  if (repeaterHeaderInput) {
    repeaterHeaderInput.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.component !== "repeater") return;
          node.showHeader = repeaterHeaderInput.checked;
          if (node.showHeader && !Array.isArray(node.headerCells?.[0])) {
            node.headerCells = createDefaultRepeaterHeaderRow(node.columns ?? 1);
          }
        });
        renderLayoutList();
        updateInspector();
        renderPreview();
      });
      updateSaveState();
    });
  }

  if (repeaterTemplateColumnsInput) {
    repeaterTemplateColumnsInput.addEventListener("focus", () => beginPendingUndo(repeaterTemplateColumnsInput));
    repeaterTemplateColumnsInput.addEventListener("blur", () => commitPendingUndo(repeaterTemplateColumnsInput));
    repeaterTemplateColumnsInput.addEventListener("change", () => commitPendingUndo(repeaterTemplateColumnsInput));
    repeaterTemplateColumnsInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "repeater") return;
        if (repeaterTemplateColumnsInput.value.trim()) {
          node.templateColumns = repeaterTemplateColumnsInput.value.trim();
        } else {
          delete node.templateColumns;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (imageUrlInput) {
    imageUrlInput.addEventListener("focus", () => beginPendingUndo(imageUrlInput));
    imageUrlInput.addEventListener("blur", () => commitPendingUndo(imageUrlInput));
    imageUrlInput.addEventListener("change", () => commitPendingUndo(imageUrlInput));
    imageUrlInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "image") return;
        node.url = imageUrlInput.value;
      });
      renderPreview();
      renderLayoutList();
      updateSaveState();
    });
  }

  const imageSizeInputs = [
    { input: imageWidthInput, key: "width" },
    { input: imageHeightInput, key: "height" },
    { input: imageFocalXInput, key: "focalX" },
    { input: imageFocalYInput, key: "focalY" },
    { input: imageZoomInput, key: "zoom" },
  ];

  imageSizeInputs.forEach(({ input, key }) => {
    if (!input) return;
    input.addEventListener("focus", () => beginPendingUndo(input));
    input.addEventListener("blur", () => commitPendingUndo(input));
    input.addEventListener("change", () => commitPendingUndo(input));
    input.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "image") return;
        const raw = input.value;
        const parsed = raw === "" ? null : parseFloat(raw);
        if (!Number.isNaN(parsed) && parsed !== null) {
          node[key] = parsed;
        } else if (raw === "") {
          delete node[key];
        }
      });
      renderPreview();
      renderLayoutList();
      updateSaveState();
    });
  });

  if (imageFitInput) {
    imageFitInput.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.component !== "image") return;
          if (imageFitInput.value === "cover") {
            delete node.fit;
          } else {
            node.fit = imageFitInput.value;
          }
        });
        renderPreview();
        renderLayoutList();
      });
    });
  }

  if (layerOriginInput) {
    layerOriginInput.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.type !== "layer") return;
          if (layerOriginInput.value === "safe") {
            delete node.origin;
          } else {
            node.origin = layerOriginInput.value;
          }
        });
        renderPreview();
        renderLayoutList();
      });
    });
  }

  if (imageCornerRadiusInput) {
    imageCornerRadiusInput.addEventListener("focus", () => beginPendingUndo(imageCornerRadiusInput));
    imageCornerRadiusInput.addEventListener("blur", () => commitPendingUndo(imageCornerRadiusInput));
    imageCornerRadiusInput.addEventListener("change", () => commitPendingUndo(imageCornerRadiusInput));
    imageCornerRadiusInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "image") return;
        const raw = imageCornerRadiusInput.value;
        const parsed = raw === "" ? null : parseFloat(raw);
        if (!Number.isNaN(parsed) && parsed !== null) {
          node.cornerRadius = parsed;
        } else if (raw === "") {
          delete node.cornerRadius;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  const positionNumberInputs = [
    { input: positionXInput, key: "x" },
    { input: positionYInput, key: "y" },
    { input: positionZInput, key: "z" },
    { input: positionRotateInput, key: "rotate" },
  ];

  positionNumberInputs.forEach(({ input, key }) => {
    if (!input) return;
    input.addEventListener("focus", () => beginPendingUndo(input));
    input.addEventListener("blur", () => commitPendingUndo(input));
    input.addEventListener("change", () => commitPendingUndo(input));
    input.addEventListener("input", () => {
      updateSelectedPlacement((placement) => {
        const raw = input.value;
        const parsed = raw === "" ? null : parseFloat(raw);
        if (!Number.isNaN(parsed) && parsed !== null) {
          placement[key] = parsed;
        } else if (raw === "") {
          delete placement[key];
        }
      });
      renderPreview();
      updateSaveState();
    });
  });

  // width/height take either a bare number (inches) or a raw CSS size
  // string (e.g. "100%"), mirroring renderLayer's own type dispatch.
  const positionSizeInputs = [
    { input: positionWidthInput, key: "width" },
    { input: positionHeightInput, key: "height" },
  ];

  positionSizeInputs.forEach(({ input, key }) => {
    if (!input) return;
    input.addEventListener("focus", () => beginPendingUndo(input));
    input.addEventListener("blur", () => commitPendingUndo(input));
    input.addEventListener("change", () => commitPendingUndo(input));
    input.addEventListener("input", () => {
      updateSelectedPlacement((placement) => {
        const raw = input.value.trim();
        if (raw === "") {
          delete placement[key];
          return;
        }
        const parsed = Number(raw);
        placement[key] = Number.isFinite(parsed) ? parsed : raw;
      });
      renderPreview();
      updateSaveState();
    });
  });

  if (gapInput) {
    gapInput.addEventListener("focus", () => beginPendingUndo(gapInput));
    gapInput.addEventListener("blur", () => commitPendingUndo(gapInput));
    gapInput.addEventListener("change", () => commitPendingUndo(gapInput));
    gapInput.addEventListener("input", () => {
      const parsed = Number(gapInput.value);
      const next = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 12)) : 0;
      updateSelectedNode((node) => {
        const isGapComponent = ["repeater", "stat"].includes(node.component);
        if (node.type !== "grid" && !isGapComponent) return;
        node.gap = next;
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (spaceAfterInput) {
    spaceAfterInput.addEventListener("focus", () => beginPendingUndo(spaceAfterInput));
    spaceAfterInput.addEventListener("blur", () => commitPendingUndo(spaceAfterInput));
    spaceAfterInput.addEventListener("change", () => commitPendingUndo(spaceAfterInput));
    spaceAfterInput.addEventListener("input", () => {
      const raw = spaceAfterInput.value;
      updateSelectedNode((node) => {
        const isGapComponent = ["repeater", "stat"].includes(node.component);
        if (node.type !== "grid" && !isGapComponent) return;
        if (raw === "") {
          delete node.spaceAfter;
          return;
        }
        const parsed = Number(raw);
        node.spaceAfter = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 12)) : 0;
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (rowColumnsInput) {
    rowColumnsInput.addEventListener("focus", () => beginPendingUndo(rowColumnsInput));
    rowColumnsInput.addEventListener("blur", () => commitPendingUndo(rowColumnsInput));
    rowColumnsInput.addEventListener("change", () => commitPendingUndo(rowColumnsInput));
    rowColumnsInput.addEventListener("input", () => {
      const parsed = Number(rowColumnsInput.value);
      const next = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 6)) : 1;
      updateSelectedNode((node) => {
        if (node.type !== "grid") return;
        const current = Number.isFinite(node.columns) ? node.columns : 1;
        if (next > current) {
          const additions = next - current;
          asArray(node.cells).forEach((row) => {
            for (let i = 0; i < additions; i += 1) {
              row.push(createDefaultGridCell());
            }
          });
        } else if (next < current) {
          asArray(node.cells).forEach((row) => {
            row.length = next;
          });
        }
        node.columns = next;
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (gridRowsInput) {
    gridRowsInput.addEventListener("focus", () => beginPendingUndo(gridRowsInput));
    gridRowsInput.addEventListener("blur", () => commitPendingUndo(gridRowsInput));
    gridRowsInput.addEventListener("change", () => commitPendingUndo(gridRowsInput));
    gridRowsInput.addEventListener("input", () => {
      const parsed = Number(gridRowsInput.value);
      const next = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 24)) : 1;
      updateSelectedNode((node) => {
        if (node.type !== "grid") return;
        const rows = Array.isArray(node.cells) ? node.cells : [];
        const columnCount = Number.isFinite(node.columns) ? node.columns : 1;
        if (next > rows.length) {
          const additions = Array.from({ length: next - rows.length }, () =>
            Array.from({ length: columnCount }, () => createDefaultGridCell())
          );
          node.cells = [...rows, ...additions];
        } else {
          node.cells = rows.slice(0, next);
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (templateColumnsInput) {
    templateColumnsInput.addEventListener("focus", () => beginPendingUndo(templateColumnsInput));
    templateColumnsInput.addEventListener("blur", () => commitPendingUndo(templateColumnsInput));
    templateColumnsInput.addEventListener("change", () => commitPendingUndo(templateColumnsInput));
    templateColumnsInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.type !== "grid") return;
        const value = templateColumnsInput.value.trim();
        if (value) {
          node.templateColumns = value;
        } else {
          delete node.templateColumns;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (templateRowsInput) {
    templateRowsInput.addEventListener("focus", () => beginPendingUndo(templateRowsInput));
    templateRowsInput.addEventListener("blur", () => commitPendingUndo(templateRowsInput));
    templateRowsInput.addEventListener("change", () => commitPendingUndo(templateRowsInput));
    templateRowsInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.type !== "grid") return;
        const value = templateRowsInput.value.trim();
        if (value) {
          node.templateRows = value;
        } else {
          delete node.templateRows;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  const gridAlignInputs = [
    { inputs: alignXInputs, key: "alignX" },
    { inputs: alignYInputs, key: "alignY" },
  ];

  gridAlignInputs.forEach(({ inputs, key }) => {
    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            if (node.type !== "grid") return;
            node[key] = input.value;
          });
          renderPreview();
        });
      });
    });
  });

  if (iconInput) {
    iconInput.addEventListener("focus", () => beginPendingUndo(iconInput));
    iconInput.addEventListener("blur", () => commitPendingUndo(iconInput));
    iconInput.addEventListener("change", () => commitPendingUndo(iconInput));
    iconInput.addEventListener("input", () => {
      applyIconSelection(iconInput.value);
    });
  }

  if (ariaLabelInput) {
    ariaLabelInput.addEventListener("focus", () => beginPendingUndo(ariaLabelInput));
    ariaLabelInput.addEventListener("blur", () => commitPendingUndo(ariaLabelInput));
    ariaLabelInput.addEventListener("change", () => commitPendingUndo(ariaLabelInput));
    ariaLabelInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        const value = ariaLabelInput.value.trim();
        if (value) {
          node.ariaLabel = value;
        } else {
          delete node.ariaLabel;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (classNameInput) {
    classNameInput.addEventListener("focus", () => beginPendingUndo(classNameInput));
    classNameInput.addEventListener("blur", () => commitPendingUndo(classNameInput));
    classNameInput.addEventListener("change", () => commitPendingUndo(classNameInput));
    classNameInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        const value = classNameInput.value.trim();
        const merged = mergeRequiredClassTokens(node, value);
        if (merged) {
          node.className = merged;
        } else {
          delete node.className;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (addFontValueInput) {
    // Validation (format + Google Fonts existence + category lookup)
    // happens once, here, on blur — not at submit time — so the Add
    // button can stay disabled until it actually succeeds, and any
    // problem shows up as an inline warning in the modal instead of only
    // a toast after clicking Add.
    addFontValueInput.addEventListener("blur", handleAddFontValueBlur);
    addFontValueInput.addEventListener("input", () => {
      // Typing again invalidates whatever was last checked — back to
      // disabled until the next blur re-validates the new value.
      pendingValidatedFont = null;
      if (addFontSubmitButton) addFontSubmitButton.disabled = true;
      if (addFontWarningElement) addFontWarningElement.classList.add("d-none");
    });
  }

  if (addFontSubmitButton) {
    addFontSubmitButton.addEventListener("click", async () => {
      // The autocomplete's "Add a font…" row already blocks opening this
      // modal for ineligible users — checked again here too, in case the
      // modal is ever reachable another way (defense in depth; the real
      // enforcement is server-side regardless).
      if (!userMeetsTier("creator")) {
        status?.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 });
        return;
      }
      // The button is only ever enabled once handleAddFontValueBlur has
      // successfully validated the current value, so this should always
      // be set — guarded anyway rather than trusting the disabled state
      // alone.
      if (!pendingValidatedFont || !addFontApplyCallback) return;
      const font = pendingValidatedFont;
      const applyCallback = addFontApplyCallback;
      // registerCustomFont no-ops (returns the existing entry) if this id
      // is already registered — adding the same font twice just resolves
      // to the one shared entry rather than duplicating the list.
      const registered = registerCustomFont(font);
      ensureFontLoaded(registered);
      applyCallback(registered);
      window.bootstrap?.Modal?.getInstance(addFontModalElement)?.hide();
      try {
        await saveCustomFont(registered, dataManager?.session?.token);
        status?.show(`Added "${registered.label}" to the font library.`, { type: "success", timeout: 2500 });
      } catch (error) {
        status?.show(error.message || "Unable to save the new font.", { type: "error", timeout: 4000 });
      }
    });
  }

  if (textSizeInputs.length) {
    textSizeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.textSize = input.value;
            node.textSizeCustom = false;
            if (node.style?.fontSize) {
              const styles = { ...(node.style ?? {}) };
              delete styles.fontSize;
              if (Object.keys(styles).length) {
                node.style = styles;
              } else {
                delete node.style;
              }
            }
          });
          if (textSizeCustomInput) {
            textSizeCustomInput.value = pxToPt(TEXT_SIZE_PX[input.value] ?? TEXT_SIZE_PX.md);
            textSizeCustomInput.disabled = input.value === "auto";
          }
          renderPreview();
        });
      });
    });
  }

  if (textInlineInput) {
    textInlineInput.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.component !== "text") return;
          if (textInlineInput.checked) {
            node.textStyle = "span";
          } else {
            delete node.textStyle;
          }
        });
        renderPreview();
      });
      updateSaveState();
    });
  }

  if (textLineHeightInput) {
    textLineHeightInput.addEventListener("focus", () => beginPendingUndo(textLineHeightInput));
    textLineHeightInput.addEventListener("blur", () => commitPendingUndo(textLineHeightInput));
    textLineHeightInput.addEventListener("change", () => commitPendingUndo(textLineHeightInput));
    textLineHeightInput.addEventListener("input", () => {
      const rawValue = textLineHeightInput.value;
      updateSelectedNode((node) => {
        const parsed = rawValue === "" ? null : parseFloat(rawValue);
        if (!Number.isNaN(parsed) && parsed !== null) {
          node.style = { ...(node.style ?? {}), lineHeight: parsed };
        } else if (node.style?.lineHeight !== undefined) {
          const styles = { ...node.style };
          delete styles.lineHeight;
          if (Object.keys(styles).length) {
            node.style = styles;
          } else {
            delete node.style;
          }
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (textSizeCustomInput) {
    textSizeCustomInput.addEventListener("focus", () => beginPendingUndo(textSizeCustomInput));
    textSizeCustomInput.addEventListener("blur", () => commitPendingUndo(textSizeCustomInput));
    textSizeCustomInput.addEventListener("change", () => commitPendingUndo(textSizeCustomInput));
    textSizeCustomInput.addEventListener("input", () => {
      const rawValue = textSizeCustomInput.value;
      updateSelectedNode((node) => {
        const parsed = rawValue === "" ? null : parseFloat(rawValue);
        if (!Number.isNaN(parsed) && parsed !== null) {
          node.style = { ...(node.style ?? {}), fontSize: ptToPx(parsed) };
          node.textSizeCustom = true;
        } else if (rawValue === "") {
          if (node.style?.fontSize) {
            const styles = { ...(node.style ?? {}) };
            delete styles.fontSize;
            if (Object.keys(styles).length) {
              node.style = styles;
            } else {
              delete node.style;
            }
          }
          node.textSizeCustom = false;
        }
      });
      if (rawValue === "") {
        updateInspector();
      } else {
        textSizeInputs.forEach((input) => {
          input.checked = false;
        });
      }
      renderPreview();
      updateSaveState();
    });
  }

  if (textOrientationInputs.length) {
    textOrientationInputs.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.textOrientation = input.value;
            node.textOrientationCustom = false;
            if (node.textOrientation === "vertical") {
              node.textAngle = 90;
            } else if (node.textOrientation === "diagonal") {
              node.textAngle = 45;
            } else {
              node.textAngle = 0;
            }
            const isCurved = node.textOrientation === "curve-up" || node.textOrientation === "curve-down";
            node.textCurve = isCurved ? 12 : 0;
          });
          if (textAngleInput) {
            textAngleInput.value = input.value === "vertical" ? "90" : input.value === "diagonal" ? "45" : "0";
          }
          if (textCurveInput) {
            textCurveInput.value = input.value === "curve-up" || input.value === "curve-down" ? "12" : "0";
          }
          renderPreview();
        });
      });
    });
  }

  const textTransformInputs = [
    { input: textAngleInput, key: "textAngle" },
    { input: textCurveInput, key: "textCurve" },
  ];

  textTransformInputs.forEach(({ input, key }) => {
    if (!input) return;
    input.addEventListener("focus", () => beginPendingUndo(input));
    input.addEventListener("blur", () => commitPendingUndo(input));
    input.addEventListener("change", () => commitPendingUndo(input));
    input.addEventListener("input", () => {
      updateSelectedNode((node) => {
        const raw = input.value;
        const parsed = raw === "" ? null : parseFloat(raw);
        if (!Number.isNaN(parsed) && parsed !== null) {
          node[key] = parsed;
        } else if (raw === "") {
          delete node[key];
        }
        node.textOrientationCustom = true;
      });
      textOrientationInputs.forEach((entry) => {
        entry.checked = false;
      });
      renderPreview();
      updateSaveState();
    });
  });

  if (borderWidthInput) {
    borderWidthInput.addEventListener("focus", () => beginPendingUndo(borderWidthInput));
    borderWidthInput.addEventListener("blur", () => commitPendingUndo(borderWidthInput));
    borderWidthInput.addEventListener("change", () => commitPendingUndo(borderWidthInput));
    borderWidthInput.addEventListener("input", () => {
      const parsed = borderWidthInput.value === "" ? null : Number(borderWidthInput.value);
      updateSelectedNode((node) => {
        const styles = { ...(node.style ?? {}) };
        if (parsed === null || Number.isNaN(parsed)) {
          delete styles.borderWidth;
        } else {
          styles.borderWidth = Math.max(0, Math.min(parsed, 12));
        }
        node.style = styles;
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (borderStyleInput) {
    borderStyleInput.addEventListener("focus", () => beginPendingUndo(borderStyleInput));
    borderStyleInput.addEventListener("blur", () => commitPendingUndo(borderStyleInput));
    borderStyleInput.addEventListener("change", () => commitPendingUndo(borderStyleInput));
    borderStyleInput.addEventListener("input", () => {
      const value = borderStyleInput.value;
      updateSelectedNode((node) => {
        const styles = { ...(node.style ?? {}) };
        if (!value || value === "none") {
          // Turning the border off — style is the switch, so everything
          // downstream of it goes back to genuinely unset too, not left
          // behind as stale data with no effect.
          delete styles.borderStyle;
          delete styles.borderColor;
          delete styles.borderWidth;
          delete styles.borderSides;
        } else {
          styles.borderStyle = value;
          // Turning the border ON for the first time — write real,
          // explicit values right now rather than leaving borderColor/
          // borderWidth unset and letting the renderer invent a fallback
          // no one actually chose. Only fills in what's still genuinely
          // unset — an already-configured color/width isn't overwritten
          // just because style changed again.
          if (!styles.borderColor) styles.borderColor = COLOR_DEFAULTS.border;
          if (typeof styles.borderWidth !== "number") styles.borderWidth = 1;
        }
        node.style = styles;
      });
      renderPreview();
      updateInspector();
      updateSaveState();
    });
  }

  if (borderRadiusInput) {
    borderRadiusInput.addEventListener("focus", () => beginPendingUndo(borderRadiusInput));
    borderRadiusInput.addEventListener("blur", () => commitPendingUndo(borderRadiusInput));
    borderRadiusInput.addEventListener("change", () => commitPendingUndo(borderRadiusInput));
    borderRadiusInput.addEventListener("input", () => {
      const parsed = borderRadiusInput.value === "" ? null : Number(borderRadiusInput.value);
      updateSelectedNode((node) => {
        const styles = { ...(node.style ?? {}) };
        if (parsed === null || Number.isNaN(parsed)) {
          delete styles.borderRadius;
        } else {
          styles.borderRadius = Math.max(0, Math.min(parsed, 24));
        }
        node.style = styles;
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (borderSideInputs.length) {
    borderSideInputs.forEach((input) => {
      input.addEventListener("change", () => {
        const side = input.dataset.componentBorderSide;
        if (!side) return;
        updateSelectedNode((node) => {
          const styles = { ...(node.style ?? {}) };
          const sides = { ...(styles.borderSides ?? {}) };
          sides[side] = input.checked;
          styles.borderSides = sides;
          node.style = styles;
        });
        renderPreview();
        updateSaveState();
      });
    });
  }

  if (textStyleToggles.length) {
    textStyleToggles.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.textStyles = { ...(node.textStyles ?? {}) };
            node.textStyles[input.dataset.componentTextStyle] = input.checked;
          });
          renderPreview();
        });
      });
    });
  }

  if (alignInputs.length) {
    alignInputs.forEach((input) => {
      input.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            node.align = input.value;
          });
          renderPreview();
        });
      });
    });
  }

  // The actual node mutation + re-render (both the switch's manual click
  // and the binding field's live typing) is wired via onManualChange/
  // onBindingChange on createFormulaToggleField itself, above — only the
  // pending-undo focus/blur pattern (one undo step per typing session,
  // not one per keystroke) needs its own listeners here, same as every
  // other free-text field in this inspector.
  if (visibleWhenInput) {
    visibleWhenInput.addEventListener("focus", () => beginPendingUndo(visibleWhenInput));
    visibleWhenInput.addEventListener("blur", () => commitPendingUndo(visibleWhenInput));
    visibleWhenInput.addEventListener("change", () => commitPendingUndo(visibleWhenInput));
  }

  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      removeSelectedNode();
    });
  }

  if (duplicateButton) {
    duplicateButton.addEventListener("click", () => {
      duplicateSelectedNode();
    });
  }

  if (makeUniqueButton) {
    makeUniqueButton.addEventListener("click", () => {
      toggleMakeUnique();
    });
  }
}

function wireEvents() {
  // Same dirty check updateSaveState already uses for the Save button —
  // Press had no guard at all against navigating/closing away from
  // unsaved edits (unlike Workbench, which already had this).
  window.addEventListener("beforeunload", (event) => {
    const hasTemplate = Boolean(getActiveTemplate());
    const dirty = hasTemplate && !snapshotsEqual(lastSavedLayout, createLayoutSnapshot());
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  if (newTemplateButton) {
    newTemplateButton.addEventListener("click", () => {
      startNewTemplate();
    });
  }
  if (templateDuplicateButton) {
    templateDuplicateButton.addEventListener("click", () => {
      duplicateActiveTemplate();
    });
  }
  if (templateClearUniquenessButton) {
    templateClearUniquenessButton.addEventListener("click", () => {
      clearAllUniqueness();
    });
  }
  if (templateDeleteButton) {
    templateDeleteButton.addEventListener("click", () => {
      deleteActiveTemplate();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const active = document.activeElement;
    const isEditingField =
      active &&
      active instanceof HTMLElement &&
      (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName));
    if (isEditingField) {
      // Leave native copy/paste/select-all and Ctrl+D-for-bookmark alone
      // while actually typing somewhere.
      return;
    }
    if (event.key === "Delete") {
      if (!selectedNodeId) return;
      removeSelectedNode();
      return;
    }
    const isShortcutModifier = event.ctrlKey || event.metaKey;
    if (!isShortcutModifier) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "v" && key !== "d" && key !== "x") return;
    // Copy/duplicate act on the current selection, so they need one — but
    // paste doesn't: it's meant to work even after switching side/template
    // with nothing selected there yet (pasteClipboard falls back to
    // appending at that layout's root in that case).
    if (key !== "v" && !selectedNodeId) return;
    if (key === "v" && !clipboard) return;
    event.preventDefault();
    if (key === "c") copySelectedNode();
    else if (key === "v") pasteClipboard();
    else if (key === "d") duplicateSelectedNode();
    else if (key === "x") cutSelectedNode();
  });

  templateSelect.addEventListener("change", async () => {
    templateIdAuto = false;
    const nextTemplateId = templateSelect.value;
    const previousTemplateId = activeTemplateId;
    const previousTemplate = previousTemplateId ? getTemplateById(previousTemplateId) : null;
    if (previousTemplate) {
      const hasChanges = !snapshotsEqual(lastSavedLayout, createLayoutSnapshot(previousTemplate));
      if (hasChanges) {
        const confirmed = window.confirm("Save changes to the current template before switching?");
        if (confirmed) {
          templateSelect.value = previousTemplateId;
          const saved = await saveTemplateChanges({ template: previousTemplate });
          if (!saved) {
            templateSelect.value = previousTemplateId;
            return;
          }
          templateSelect.value = nextTemplateId;
        }
      }
    }
    currentSide = "front";
    const template = getActiveTemplate();
    hydrateEditablePages(template);
    renderFormatOptions(template);
    renderSourceOptions(template);
    updateTemplateInspector(template);
    if (undoStack) {
      undoStack.clear();
    }
    pendingUndoSnapshot = null;
    pendingUndoTarget = null;
    selectedNodeId = null;
    renderLayoutList();
    updateInspector();
    renderPreview();
    markLayoutSaved();
    activeTemplateId = template?.id ?? null;
    setInspectorMode("template");
  });
  formatSelect.addEventListener("change", () => {
    currentSide = "front";
    const template = getActiveTemplate();
    const format = getFormatById(template, formatSelect.value);
    renderOrientationOptions(format);
    renderPreview();
  });
  orientationSelect.addEventListener("change", () => {
    currentSide = "front";
    renderPreview();
  });
  sourceSelect.addEventListener("change", () => {
    const source = getActiveSource();
    clearSourcePayload(source);
    renderSourceInput(source);
    updateGenerateButtonState();
    renderPreview();
  });
  swapSideButton.addEventListener("click", toggleSide);
  if (cardPagePrevButton) {
    cardPagePrevButton.addEventListener("click", () => {
      if (cardPageIndex <= 0) return;
      cardPageIndex -= 1;
      renderPreview();
    });
  }
  if (cardPageNextButton) {
    cardPageNextButton.addEventListener("click", () => {
      cardPageIndex += 1;
      renderPreview();
    });
  }
  // Mode toggle's own click handling lives inside renderModeToggle itself
  // (createModeToggleGroup's own onChange) — it rebuilds fresh on every
  // call, so there's no persistent listener to wire here the way the old
  // static nav-tab buttons needed.
  renderModeToggle();
  if (gridViewPrevButton) {
    gridViewPrevButton.addEventListener("click", () => {
      if (gridViewIndex <= 0) return;
      gridViewIndex -= 1;
      renderGridView();
    });
  }
  if (gridViewNextButton) {
    gridViewNextButton.addEventListener("click", () => {
      gridViewIndex += 1;
      renderGridView();
    });
  }
  if (canvasZoomOutButton) {
    canvasZoomOutButton.addEventListener("click", () => setCanvasZoom(zoomLevel - ZOOM_STEP));
  }
  if (canvasZoomInButton) {
    canvasZoomInButton.addEventListener("click", () => setCanvasZoom(zoomLevel + ZOOM_STEP));
  }
  if (canvasZoomResetButton) {
    canvasZoomResetButton.addEventListener("click", () => setCanvasZoom(1));
  }
  if (previewStage) {
    // Trackpad pinch and Ctrl+mouse-wheel both arrive as a "wheel" event
    // with ctrlKey set (the standard synthetic signal browsers use for
    // pinch-to-zoom intent) — same handler covers both. preventDefault()
    // is required here (and { passive: false } is required for
    // preventDefault() to have any effect at all) so the browser's own
    // page-zoom doesn't also fire; without ctrlKey, this falls through
    // untouched so normal wheel-scrolling/panning keeps working.
    previewStage.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const zoomFactor = 1 - event.deltaY * 0.01;
        setCanvasZoom(zoomLevel * zoomFactor);
      },
      { passive: false }
    );
  }
  if (generateButton) {
    generateButton.addEventListener("click", handleGeneratePrint);
  }
  printButton.addEventListener("click", () => {
    window.bootstrap?.Tooltip?.getInstance(printButton)?.hide();
    window.print();
  });
}

let selectedPatternPreset = null;
let currentPatternValues = {};

function renderPatternThumbnails(categoryId) {
  if (!patternThumbnails) return;
  patternThumbnails.innerHTML = "";
  const fragment = document.createDocumentFragment();
  getPresetsByCategory(categoryId).forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary p-1 d-flex flex-column align-items-center gap-1";
    button.dataset.patternId = preset.id;
    button.classList.toggle("active", preset.id === selectedPatternPreset?.id);
    const img = document.createElement("img");
    img.src = svgToDataUri(preset.buildSvg(getPresetDefaultValues(preset)));
    img.alt = preset.label;
    img.style.width = "56px";
    img.style.height = "56px";
    img.style.objectFit = "contain";
    const label = document.createElement("span");
    label.className = "extra-small";
    label.textContent = preset.label;
    button.append(img, label);
    button.addEventListener("click", () => selectPatternPreset(preset));
    fragment.appendChild(button);
  });
  patternThumbnails.appendChild(fragment);
}

function updatePatternPreview() {
  if (!selectedPatternPreset || !patternPreviewImg) return;
  patternPreviewImg.src = svgToDataUri(selectedPatternPreset.buildSvg(currentPatternValues));
}

// Splits a pattern color value (6-digit hex, 8-digit hex-with-alpha, the
// legacy "transparent" keyword, or anything unrecognized) into a real hex
// swatch plus a 0-100 opacity percentage — the pairing <input type="color">
// + <input type="range"> in renderPatternControls uses to represent one
// combined value as two separate widgets, since color inputs only ever
// accept opaque 6-digit hex.
function splitColorAlpha(value) {
  if (typeof value === "string" && /^#[0-9a-fA-F]{8}$/.test(value)) {
    const hex = value.slice(0, 7);
    const alphaPercent = Math.round((parseInt(value.slice(7, 9), 16) / 255) * 100);
    return { hex, alphaPercent };
  }
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return { hex: value, alphaPercent: 100 };
  }
  if (value === "transparent") {
    return { hex: "#000000", alphaPercent: 0 };
  }
  return { hex: "#000000", alphaPercent: 100 };
}

// Inverse of splitColorAlpha — SVG fill/stroke both accept 8-digit hex
// (#RRGGBBAA) directly in every modern browser, so this is the only
// encoding needed; full opacity collapses back to plain 6-digit hex to keep
// the common (fully opaque) case as a normal-looking color.
function combineColorAlpha(hex, alphaPercent) {
  const clamped = Math.max(0, Math.min(100, Number(alphaPercent) || 0));
  if (clamped >= 100) return hex;
  const alphaHex = Math.round((clamped / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${alphaHex}`;
}

function renderPatternControls(preset) {
  if (!patternControls) return;
  patternControls.innerHTML = "";
  const fragment = document.createDocumentFragment();
  (preset.colorSlots ?? []).forEach((slot, index) => {
    const wrap = document.createElement("div");
    wrap.className = "d-flex align-items-center justify-content-between gap-2";
    const id = `patternColor-${slot.key}-${index}`;
    const label = document.createElement("label");
    label.className = "form-label small text-body-secondary mb-0";
    label.setAttribute("for", id);
    label.textContent = slot.label;

    const { hex, alphaPercent } = splitColorAlpha(currentPatternValues[slot.key] ?? slot.default);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.id = id;
    colorInput.className = "form-control form-control-color";
    colorInput.value = hex;

    const alphaId = `${id}-alpha`;
    const alphaInput = document.createElement("input");
    alphaInput.type = "range";
    alphaInput.id = alphaId;
    alphaInput.className = "form-range";
    alphaInput.min = "0";
    alphaInput.max = "100";
    alphaInput.step = "1";
    alphaInput.value = String(alphaPercent);
    alphaInput.style.width = "4.5rem";
    alphaInput.setAttribute("aria-label", `${slot.label} opacity`);

    const alphaReadout = document.createElement("span");
    alphaReadout.className = "extra-small text-body-secondary";
    alphaReadout.style.width = "2.5rem";
    alphaReadout.textContent = `${alphaPercent}%`;

    const updateValue = () => {
      alphaReadout.textContent = `${alphaInput.value}%`;
      currentPatternValues[slot.key] = combineColorAlpha(colorInput.value, Number(alphaInput.value));
      updatePatternPreview();
    };
    colorInput.addEventListener("input", updateValue);
    alphaInput.addEventListener("input", updateValue);

    const controlsWrap = document.createElement("div");
    controlsWrap.className = "d-flex align-items-center gap-2";
    controlsWrap.append(colorInput, alphaInput, alphaReadout);

    wrap.append(label, controlsWrap);
    fragment.appendChild(wrap);
  });
  (preset.params ?? []).forEach((param, index) => {
    const wrap = document.createElement("div");
    wrap.className = "d-flex align-items-center justify-content-between gap-2";
    const id = `patternParam-${param.key}-${index}`;
    const label = document.createElement("label");
    label.className = "form-label small text-body-secondary mb-0 flex-grow-1";
    label.setAttribute("for", id);
    label.textContent = param.label;
    let input;
    if (param.type === "select") {
      input = document.createElement("select");
      input.className = "form-select form-select-sm";
      input.style.width = "auto";
      (param.options ?? []).forEach((option) => {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        input.appendChild(optionEl);
      });
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.className = "form-control form-control-sm";
      input.style.width = "5.5rem";
      if (Number.isFinite(param.min)) input.min = String(param.min);
      if (Number.isFinite(param.max)) input.max = String(param.max);
      if (Number.isFinite(param.step)) input.step = String(param.step);
    }
    input.id = id;
    input.value = currentPatternValues[param.key];
    input.addEventListener("input", () => {
      currentPatternValues[param.key] = input.value;
      updatePatternPreview();
    });
    wrap.append(label, input);
    fragment.appendChild(wrap);
  });
  patternControls.appendChild(fragment);
}

function selectPatternPreset(preset, initialValues) {
  selectedPatternPreset = preset;
  currentPatternValues = initialValues ?? getPresetDefaultValues(preset);
  if (patternPreviewLabel) patternPreviewLabel.textContent = preset.label;
  if (patternInsertButton) patternInsertButton.disabled = false;
  renderPatternControls(preset);
  updatePatternPreview();
  patternThumbnails?.querySelectorAll("[data-pattern-id]").forEach((button) => {
    button.classList.toggle("active", button.dataset.patternId === preset.id);
  });
}

// Mirrors the modal's own default (unselected) markup exactly — used when
// the picker opens on a field that isn't a pattern this picker generated
// (a plain image, a hand-pasted URL, or nothing), so a stale selection
// from a previously-edited node can't be mistaken for the current one.
function resetPatternSelection() {
  selectedPatternPreset = null;
  currentPatternValues = {};
  if (patternPreviewLabel) patternPreviewLabel.textContent = "Select a pattern";
  if (patternInsertButton) patternInsertButton.disabled = true;
  if (patternControls) patternControls.innerHTML = "";
  if (patternPreviewImg) patternPreviewImg.removeAttribute("src");
  patternThumbnails?.querySelectorAll("[data-pattern-id]").forEach((button) => {
    button.classList.remove("active");
  });
}

function initPatternModal() {
  if (!patternModalElement) return;
  renderPatternThumbnails(PATTERN_CATEGORIES[0]?.id ?? "fills");

  // Switching category tabs only changes which thumbnails are shown — the
  // current selection (preview, controls, Insert button) stays exactly as
  // it was, even if the selected preset belongs to a different category,
  // until the user actually clicks a new thumbnail.
  patternCategoryInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      renderPatternThumbnails(input.value);
    });
  });

  if (patternPickerOpenButton) {
    patternPickerOpenButton.addEventListener("click", () => {
      if (!window.bootstrap?.Modal) return;
      // Re-detect on every open (not just once) — the field can belong to
      // a different node than the last time the modal was open, so its
      // current value is the only thing that should drive this, not
      // whatever was left selected before.
      const detected = extractPatternMetadata(imageUrlInput?.value ?? "");
      if (detected) {
        const categoryInput = patternCategoryInputs.find((input) => input.value === detected.preset.category);
        if (categoryInput) {
          categoryInput.checked = true;
          renderPatternThumbnails(detected.preset.category);
        }
        selectPatternPreset(detected.preset, detected.values);
      } else {
        resetPatternSelection();
      }
      window.bootstrap.Modal.getOrCreateInstance(patternModalElement).show();
    });
  }

  if (patternInsertButton) {
    patternInsertButton.addEventListener("click", () => {
      if (!selectedPatternPreset || !imageUrlInput) return;
      // Insert is a one-shot programmatic write, not a batched typing
      // session, so it records its own undo entry here rather than relying
      // on imageUrlInput's focus/blur-based pending-undo (which never fires
      // since this never focuses the field). Reuses the field's own
      // existing input handler (updateSelectedNode + renderPreview) for the
      // actual write instead of duplicating that path here.
      recordUndoableChange(() => {
        const svg = embedPatternMetadata(
          selectedPatternPreset.buildSvg(currentPatternValues),
          selectedPatternPreset.id,
          currentPatternValues
        );
        imageUrlInput.value = svgToDataUri(svg);
        imageUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      window.bootstrap?.Modal?.getInstance(patternModalElement)?.hide();
    });
  }
}

async function initPress() {
  initShell();
  // Unified onto the shared "undercroft" local-storage prefix every other
  // tool already uses by default (DataManager's own DEFAULT_STORAGE_PREFIX)
  // — Press's own bucket names already fully disambiguate its content, so a
  // second, tool-specific prefix layer on top was pure redundant
  // fragmentation (the whole reason suite-search.js needed its own per-kind
  // local-prefix lookup just to search across tools).
  dataManager = new DataManager({ baseUrl: resolveApiBase() });
  initAuthControls({ root: document, status, dataManager });
  initPressCollapsibles();
  removeDuplicateSampleDataSections();
  await initSampleDataEditor();
  try {
    await loadTemplates(dataManager);
  } catch (error) {
    console.error("Unable to load templates", error);
    // Previously silent beyond the console — the whole app is unusable
    // from here (no templates loaded at all), so this needs to actually
    // tell the person looking at the page, not just whoever happens to
    // have devtools open. loadJson (templates.js) already prefixes the
    // error with which file failed to parse.
    status?.show(error?.message || "Unable to load templates.", { type: "error", timeout: 0 });
    return;
  }

  await loadCustomPageSizes();
  refreshStandardFormats();
  await loadCustomFonts();

  populateSources();
  renderTemplateSourceOptions();
  populateTemplates();
  renderTemplateFormatOptions();
  renderFormatOptions(getActiveTemplate());
  renderSourceOptions(getActiveTemplate());
  updateTemplateInspector(getActiveTemplate());
  bindTemplateInspectorControls();
  initDragAndDrop();
  bindInspectorControls();
  initPatternModal();
  initBindingAutocompletes();
  renderLayoutList();
  selectedNodeId = null;
  updateInspector();
  // Establishes the correct inline-style visibility state for the two view
  // panels/control groups up front (see setElementVisible) — the HTML's
  // static `hidden` attributes on the Grid View elements aren't reliable on
  // their own, since those elements also carry a competing `display`
  // utility class.
  setActiveViewTab("preview");
  renderPreview();
  markLayoutSaved();
  updateGenerateButtonState();
  wireEvents();
  activeTemplateId = getActiveTemplate()?.id ?? null;
  setInspectorMode("template");
  // Press never had this — every other tool in the suite calls it, but
  // Press's static data-bs-toggle="tooltip" markup (Border thickness/Grid
  // gap/the new Visible-binding field/etc.) was silently inert with no
  // Bootstrap Tooltip instance ever attached. One-time init is enough:
  // these elements are only ever shown/hidden (hidden attribute/display),
  // never destroyed and recreated, so the listeners this attaches stay
  // valid for the life of the page.
  refreshTooltips(document);
}

initPress();
