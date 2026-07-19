import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { DataManager } from "../../common/js/lib/data-manager.js";
import { resolveApiBase } from "../../common/js/lib/api.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { createSortable } from "../../common/js/lib/dnd.js";
import { normalizeLegacyLayoutNode, applyAutoWidthCaps } from "./template-renderer.js";
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
} from "./templates.js";
import { getSourceById, getSources } from "./sources.js";
import { loadSourceData, LIBRARY_KINDS } from "./source-data.js";
import { loadSampleData, setSampleDataText, getSampleDataText, getSampleData, subscribeSampleData } from "./sample-data.js";
import { resolveBinding } from "../../common/js/lib/bindings.js";
import { attachFormulaAutocomplete } from "../../common/js/lib/formula-autocomplete.js";
import { listFormulaFunctionMetadata } from "../../common/js/lib/formula-metadata.js";
import { collectDataFields } from "../../common/js/lib/data-fields.js";
import {
  PATTERN_CATEGORIES,
  getPresetsByCategory,
  getPresetDefaultValues,
  svgToDataUri,
  embedPatternMetadata,
  extractPatternMetadata,
} from "./pattern-library.js";
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
  verifyGoogleFontExists,
  lookupGoogleFontCategory,
} from "./font-library.js";

const templateSelect = document.getElementById("templateSelect");
const formatSelect = document.getElementById("formatSelect");
const orientationSelect = document.getElementById("orientationSelect");
const sourceSelect = document.getElementById("sourceSelect");
const sourceInputContainer = document.getElementById("sourceInputContainer");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
const canvasZoomOutButton = document.querySelector("[data-canvas-zoom-out]");
const canvasZoomInButton = document.querySelector("[data-canvas-zoom-in]");
const canvasZoomResetButton = document.querySelector("[data-canvas-zoom-reset]");
const canvasZoomLevelLabel = document.querySelector("[data-canvas-zoom-level]");
const guideLegendElement = document.querySelector("[data-canvas-guide-legend]");
const generateButton = document.getElementById("generateButton");
const printButton = document.getElementById("printButton");
const selectionToggle = document.querySelector("[data-selection-toggle]");
const selectionToggleLabel = selectionToggle?.querySelector("[data-toggle-label]");
const selectionPanel = document.querySelector("[data-selection-panel]");
const newTemplateButton = document.querySelector('[data-action="new-template"]');
const jsonPreview = document.querySelector("[data-json-preview]");
const jsonBytes = document.querySelector("[data-preview-bytes]");
const undoButton = document.querySelector('[data-action="undo-layout"]');
const redoButton = document.querySelector('[data-action="redo-layout"]');
const saveButton = document.querySelector('[data-action="save-layout"]');
const paletteList = document.querySelector("[data-press-palette]");
const layoutList = document.querySelector("[data-layout-list]");
const layoutEmptyState = document.querySelector("[data-layout-empty]");
const sampleDataInput = document.querySelector("[data-sample-data-input]");
const sampleDataError = document.querySelector("[data-sample-data-error]");
const sampleDataLabel = document.querySelector("[data-sample-data-label]");
const templateInspector = document.querySelector("[data-template-inspector]");
const templateIdInput = document.querySelector("[data-template-id]");
const templateNameInput = document.querySelector("[data-template-name]");
const templateDescriptionInput = document.querySelector("[data-template-description]");
const templateTypeSelect = document.querySelector("[data-template-type]");
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
const templateToggle = document.querySelector("[data-template-toggle]");
const templateToggleLabel = templateToggle?.querySelector("[data-template-toggle-label]");
const templatePanel = document.querySelector("[data-template-panel]");
const pageBindingsToggle = document.querySelector("[data-page-bindings-toggle]");
const pageBindingsToggleLabel = pageBindingsToggle?.querySelector("[data-page-bindings-toggle-label]");
const pageBindingsPanel = document.querySelector("[data-page-bindings-panel]");
const templateSaveButton = document.querySelector("[data-template-save]");
const templateDuplicateButton = document.querySelector("[data-template-duplicate]");
const templateDeleteButton = document.querySelector("[data-template-delete]");
const cardToggle = document.querySelector("[data-card-toggle]");
const cardToggleLabel = cardToggle?.querySelector("[data-card-toggle-label]");
const cardPanel = document.querySelector("[data-card-panel]");
const componentToggle = document.querySelector("[data-component-toggle]");
const componentToggleLabel = componentToggle?.querySelector("[data-component-toggle-label]");
const componentPanel = document.querySelector("[data-component-panel]");
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
const iconResult = document.querySelector("[data-component-icon-result]");
const textEditor = document.querySelector("[data-component-text]");
const textEditorLabel = document.querySelector("[data-component-text-label]");
const ariaLabelField = document.querySelector("[data-inspector-aria-label-field]");
const ariaLabelInput = document.querySelector("[data-component-aria-label]");
const classNameField = document.querySelector("[data-inspector-class-name-field]");
const classNameInput = document.querySelector("[data-component-class-name]");

// A short, deliberately non-overlapping reference list — nothing here
// duplicates a control the inspector already has a dedicated field for
// (alignment, bold/italic, text size, color, border, corner radius, etc.),
// so this is only ever the fastest way to reach for something that has no
// other home. "badge text-bg-primary" specifically replaces what used to
// be its own dedicated "Badge" field component, which was really always
// just Text with this class combo.
const CLASS_NAME_SUGGESTIONS = [
  { classes: "badge text-bg-primary", label: "Badge", description: "Pill-style badge background" },
  { classes: "text-body-secondary", label: "Muted", description: "Theme-aware secondary text color (adapts to light/dark)" },
  { classes: "flex-grow-1", label: "Fill space", description: "Expands to fill remaining space in a Layer or Grid" },
  { classes: "text-truncate", label: "Truncate", description: "Cuts off overflowing text with an ellipsis, single line" },
  { classes: "text-nowrap", label: "No wrap", description: "Keeps text on one line, never wraps" },
  { classes: "shadow-sm", label: "Shadow", description: "Soft drop shadow (box, not text)" },
  { classes: "text-shadow-dark", label: "Dark text shadow", description: "Dark shadow behind text — for light text over a busy/photo background" },
  { classes: "text-shadow-light", label: "Light text shadow", description: "Light shadow behind text — for dark text over a busy/photo background" },
];
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
const tableFieldGroup = document.querySelector("[data-inspector-table-fields]");
const textDecorationGroup = document.querySelector("[data-inspector-text-decoration]");
const tableRowsInput = document.querySelector("[data-component-table-rows]");
const tableColumnsList = document.querySelector("[data-component-table-columns-list]");
const tableColumnsAddButton = document.querySelector("[data-component-table-columns-add]");
const textSettingGroups = Array.from(document.querySelectorAll("[data-inspector-text-settings]"));
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
const colorGroup = document.querySelector("[data-inspector-color-group]");
const alignmentGroup = document.querySelector("[data-inspector-alignment]");
const textSizeInputs = Array.from(document.querySelectorAll("[data-component-text-size]"));
const textSizeCustomInput = document.querySelector("[data-component-text-size-custom]");
const textOrientationInputs = Array.from(document.querySelectorAll("[data-component-text-orientation]"));
const textAngleInput = document.querySelector("[data-component-text-angle]");
const textCurveInput = document.querySelector("[data-component-text-curve]");
const colorInputs = Array.from(document.querySelectorAll("[data-component-color]"));
const colorClearButtons = Array.from(document.querySelectorAll("[data-component-color-clear]"));
const borderGroup = document.querySelector("[data-inspector-border-group]");
const borderWidthInput = document.querySelector("[data-component-border-width]");
const borderStyleInput = document.querySelector("[data-component-border-style]");
const borderRadiusInput = document.querySelector("[data-component-border-radius]");
const borderSideInputs = Array.from(document.querySelectorAll("[data-component-border-side]"));
const textStyleToggles = Array.from(document.querySelectorAll("[data-component-text-style]"));
const alignInputs = Array.from(document.querySelectorAll("[data-component-align]"));
const visibilityToggle = document.querySelector("[data-component-visible]");
const deleteButton = document.querySelector("[data-component-delete]");
const duplicateButton = document.querySelector("[data-component-duplicate]");

const FORMULA_FUNCTIONS = listFormulaFunctionMetadata();
const MAX_AUTOCOMPLETE_ITEMS = 12;
const bindingAutocompleteInstances = new Set();
const bindingFieldCache = {
  source: null,
  entries: [],
};
const rightPane = document.querySelector('[data-pane="right"]');
const rightPaneToggle = document.querySelector('[data-pane-toggle="right"]');

const sourceValues = {};
const sourcePayloads = {};
let currentSide = "front";
let selectedNodeId = null;
let nodeCounter = 0;
let editablePages = { front: null, back: null };
let paletteSortable = null;
let layoutSortable = null;
let canvasSortables = [];
let tableColumnsSortable = null;
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
let applyTemplateCollapse = null;
let applyPageBindingsCollapse = null;
let applyCardCollapse = null;
let applyComponentCollapse = null;
let activeTemplateId = null;
let templateIdAuto = false;
let sampleDataSaveTimer = null;
let sampleDataMode = "sample";

const COLOR_DEFAULTS = {
  foreground: "#212529",
  background: "#ffffff",
  border: "#dee2e6",
};
const TEXT_SIZE_PX = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};
const PRESS_ICON_OPTIONS = [
  { group: "Damage", label: "Bludgeoning", value: "ddb-bludgeoning" },
  { group: "Damage", label: "Piercing", value: "ddb-piercing" },
  { group: "Damage", label: "Slashing", value: "ddb-slashing" },
  { group: "Damage", label: "Acid", value: "ddb-acid" },
  { group: "Damage", label: "Cold", value: "ddb-cold" },
  { group: "Damage", label: "Fire", value: "ddb-fire" },
  { group: "Damage", label: "Force", value: "ddb-force" },
  { group: "Damage", label: "Lightning", value: "ddb-lightning" },
  { group: "Damage", label: "Necrotic", value: "ddb-necrotic" },
  { group: "Damage", label: "Poison", value: "ddb-poison" },
  { group: "Damage", label: "Psychic", value: "ddb-psychic" },
  { group: "Damage", label: "Radiant", value: "ddb-radiant" },
  { group: "Damage", label: "Thunder", value: "ddb-thunder" },
  { group: "Magic School", label: "Abjuration", value: "ddb-abjuration" },
  { group: "Magic School", label: "Conjuration", value: "ddb-conjuration" },
  { group: "Magic School", label: "Divination", value: "ddb-divination" },
  { group: "Magic School", label: "Enchantment", value: "ddb-enchantment" },
  { group: "Magic School", label: "Evocation", value: "ddb-evocation" },
  { group: "Magic School", label: "Illusion", value: "ddb-illusion" },
  { group: "Magic School", label: "Necromancy", value: "ddb-necromancy" },
  { group: "Magic School", label: "Transmutation", value: "ddb-transmutation" },
  { group: "Inner Circle", label: "Artifice", value: "ddb-artifice" },
  { group: "Inner Circle", label: "Dunamancy", value: "ddb-dunamancy" },
  { group: "Inner Circle", label: "Psionics", value: "ddb-psionics" },
  { group: "Inner Circle", label: "Entropomancy", value: "ddb-entropomancy" },
  { group: "Inner Circle", label: "Sangromancy", value: "ddb-sangromancy" },
  { group: "Attack", label: "Melee Attack", value: "ddb-melee-attack" },
  { group: "Attack", label: "Melee Weapon", value: "ddb-melee-weapon" },
  { group: "Attack", label: "Ranged Attack", value: "ddb-ranged-attack" },
  { group: "Attack", label: "Ranged Weapon", value: "ddb-ranged-weapon" },
  { group: "Defense", label: "Immunity", value: "ddb-immunity" },
  { group: "Defense", label: "Resistance", value: "ddb-resistance" },
  { group: "Defense", label: "Vulnerability", value: "ddb-vulnerability" },
  { group: "Area", label: "Cone", value: "ddb-cone" },
  { group: "Area", label: "Cube", value: "ddb-cube" },
  { group: "Area", label: "Cylinder", value: "ddb-cylinder" },
  { group: "Area", label: "Sphere", value: "ddb-sphere" },
  { group: "Area", label: "Square", value: "ddb-square" },
  { group: "Class", label: "Artificer", value: "ddb-artificer" },
  { group: "Class", label: "Barbarian", value: "ddb-barbarian" },
  { group: "Class", label: "Bard", value: "ddb-bard" },
  { group: "Class", label: "Cleric", value: "ddb-cleric" },
  { group: "Class", label: "Druid", value: "ddb-druid" },
  { group: "Class", label: "Fighter", value: "ddb-fighter" },
  { group: "Class", label: "Monk", value: "ddb-monk" },
  { group: "Class", label: "Paladin", value: "ddb-paladin" },
  { group: "Class", label: "Ranger", value: "ddb-ranger" },
  { group: "Class", label: "Rogue", value: "ddb-rogue" },
  { group: "Class", label: "Sorcerer", value: "ddb-sorcerer" },
  { group: "Class", label: "Warlock", value: "ddb-warlock" },
  { group: "Class", label: "Wizard", value: "ddb-wizard" },
  { group: "Misc", label: "Advantage", value: "ddb-advantage" },
  { group: "Misc", label: "Attunement", value: "ddb-attunement" },
  { group: "Misc", label: "Concentration", value: "ddb-concentration" },
  { group: "Misc", label: "Disadvantage", value: "ddb-disadvantage" },
  { group: "Misc", label: "Healing", value: "ddb-healing" },
  { group: "Misc", label: "Ritual", value: "ddb-ritual" },
];

const paletteComponents = [
  {
    id: "grid",
    label: "Grid",
    description: "Rows and columns of layout content",
    icon: "tabler:layout-grid",
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
    icon: "tabler:stack-2",
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
    icon: "tabler:graph",
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
    icon: "tabler:star",
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
    icon: "tabler:photo",
    node: {
      type: "field",
      component: "image",
      url: "",
      className: "press-image",
    },
  },
  {
    id: "list",
    label: "List",
    description: "Bulleted stacks of notes",
    icon: "tabler:list-details",
    node: {
      type: "field",
      component: "list",
      items: ["First entry", "Second entry", "Third entry"],
      gap: 1,
      className: "mb-0 ps-3 d-flex flex-column",
    },
  },
  {
    id: "table",
    label: "Table",
    description: "Column-based data tables",
    icon: "tabler:table",
    node: {
      type: "field",
      component: "table",
      rowsBind: "@rows",
      className: "press-table",
      columns: [
        { header: "Column 1", bind: "@value" },
        { header: "Column 2", bind: "@detail" },
      ],
    },
  },
  {
    id: "text",
    label: "Text",
    description: "Paragraphs, summaries, or captions",
    icon: "tabler:align-left",
    node: {
      type: "field",
      component: "text",
      text: "Editable body text for this card or sheet.",
      textSize: "md",
      className: "card-body-text",
    },
  },
];

const COMPONENT_REQUIRED_CLASS_MAP = {
  image: ["press-image"],
  table: ["press-table"],
  stat: ["panel-box"],
};

function getComponentRequiredClassTokens(node) {
  if (!node?.component) return [];
  return COMPONENT_REQUIRED_CLASS_MAP[node.component] ?? [];
}

function splitClassTokens(value = "") {
  return value.split(/\s+/).filter(Boolean);
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

// Toggles the whole class combo as one unit (e.g. "badge" and
// "text-bg-primary" together) rather than each token independently — that
// matches how these are actually used, and avoids leaving a half-applied
// combo behind.
function toggleClassNameSuggestion(input, suggestion) {
  const current = splitClassTokens(input.value);
  const toggleTokens = splitClassTokens(suggestion.classes);
  const hasAll = toggleTokens.every((token) => current.includes(token));
  const next = hasAll
    ? current.filter((token) => !toggleTokens.includes(token))
    : [...current, ...toggleTokens.filter((token) => !current.includes(token))];
  // One-shot programmatic write (a suggestion click), not a batched typing
  // session, so it records its own undo entry here rather than relying on
  // the field's focus/blur-based pending-undo — same reasoning, and the
  // same dispatch-a-real-input-event trick to reuse the field's existing
  // write path, as the pattern picker's own Insert button.
  recordUndoableChange(() => {
    input.value = next.join(" ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderClassNameSuggestionRow(suggestion, isApplied) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "list-group-item list-group-item-action d-flex align-items-start gap-2 py-1";
  const check = document.createElement("span");
  check.className = "flex-shrink-0";
  check.style.width = "1rem";
  check.setAttribute("aria-hidden", "true");
  check.textContent = isApplied ? "✓" : "";
  const textWrap = document.createElement("span");
  textWrap.className = "d-flex flex-column";
  const label = document.createElement("span");
  label.className = "fw-semibold";
  label.textContent = suggestion.label;
  const description = document.createElement("small");
  description.className = "text-body-secondary";
  description.textContent = suggestion.description;
  textWrap.append(label, description);
  row.append(check, textWrap);
  return row;
}

// Mirrors attachIconAutocomplete's own structure closely (same container
// helper shape, same open-on-focus/click, arrow-key nav, blur-closes-after-
// a-short-delay-so-clicks-land pattern) — the one real difference is that
// this list is fixed (a short, curated reference, not a filtered search)
// and a click toggles rather than replaces the field's value, so the
// dropdown stays open afterward for toggling more than one suggestion in
// a row.
function ensureClassNameAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-classname-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.classnameAutocomplete = "true";
    container.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    container.style.zIndex = "1300";
    container.style.fontSize = "0.8125rem";
    container.style.maxHeight = "16rem";
    container.style.overflowY = "auto";
    parent.appendChild(container);
  }
  return container;
}

function attachClassNameAutocomplete(input) {
  if (!input) return null;
  const container = ensureClassNameAutocompleteContainer(input);
  if (!container) return null;
  let activeIndex = -1;

  const close = () => {
    activeIndex = -1;
    container.innerHTML = "";
    container.classList.add("d-none");
  };

  const render = () => {
    activeIndex = -1;
    const current = splitClassTokens(input.value);
    container.innerHTML = "";
    CLASS_NAME_SUGGESTIONS.forEach((suggestion, index) => {
      const tokens = splitClassTokens(suggestion.classes);
      const isApplied = tokens.length > 0 && tokens.every((token) => current.includes(token));
      const row = renderClassNameSuggestionRow(suggestion, isApplied);
      row.dataset.classnameIndex = String(index);
      row.setAttribute("role", "option");
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        toggleClassNameSuggestion(input, suggestion);
        render();
      });
      container.appendChild(row);
    });
    container.classList.remove("d-none");
  };

  const onKeyDown = (event) => {
    if (container.classList.contains("d-none")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, CLASS_NAME_SUGGESTIONS.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      if (activeIndex < 0 || !CLASS_NAME_SUGGESTIONS[activeIndex]) return;
      event.preventDefault();
      toggleClassNameSuggestion(input, CLASS_NAME_SUGGESTIONS[activeIndex]);
      render();
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    } else {
      return;
    }
    Array.from(container.querySelectorAll("[data-classname-index]")).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.classnameIndex) === activeIndex);
    });
  };

  input.addEventListener("focus", render);
  input.addEventListener("click", render);
  input.addEventListener("input", render);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { render, close };
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
  if (node.type === "field" && node.component === "table") {
    const rows = resolveBinding(node.rowsBind ?? node.itemsBind, context) ?? node.rows ?? [];
    const rowContext = createItemContext(context, asArray(rows)[0], 0);
    if (Array.isArray(node.cells)) {
      const row = node.cells[0];
      if (Array.isArray(row)) {
        for (const cell of row) {
          if (Array.isArray(cell)) {
            for (const nested of cell) {
              const found = resolveNodePreviewContext(nested, targetId, rowContext);
              if (found) return found;
            }
            continue;
          }
          const found = resolveNodePreviewContext(cell, targetId, rowContext);
          if (found) return found;
        }
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

const renderJsonPreview = createJsonPreviewRenderer({
  resolvePreviewElement: () => jsonPreview,
  resolveBytesElement: () => jsonBytes,
  serialize: () => {
    const context = getSelectionContext();
    if (!context.template) {
      return {};
    }
    const previewData = resolveBasePreviewData();
    return buildTemplatePreview(context.template, previewData);
  },
});

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
  if (saveButton) {
    saveButton.disabled = !enabled;
    saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
    if (!hasTemplate) {
      saveButton.title = "Select a template before saving.";
    } else if (isSaving) {
      saveButton.title = "Saving template...";
    } else if (!hasChanges) {
      saveButton.title = "No changes to save.";
    } else {
      saveButton.removeAttribute("title");
    }
  }
  if (templateSaveButton) {
    templateSaveButton.disabled = !enabled;
    if (!hasTemplate) {
      templateSaveButton.title = "Select a template before saving.";
    } else if (isSaving) {
      templateSaveButton.title = "Saving template...";
    } else if (!hasChanges) {
      templateSaveButton.title = "No changes to save.";
    } else {
      templateSaveButton.removeAttribute("title");
    }
  }
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
  return next;
}

function buildTemplatePages() {
  const pages = {};
  Object.entries(editablePages ?? {}).forEach(([side, page]) => {
    if (!page || typeof page !== "object") {
      pages[side] = page;
      return;
    }
    const { layout, ...rest } = page;
    pages[side] = {
      ...rest,
      layout: layout ? stripNodeIds(layout) : layout,
    };
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
  const response = await fetch(`/press/templates/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = `Unable to save template (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error) {
        message = data.error;
      }
    } catch (error) {
      console.warn("Unable to parse save response", error);
    }
    throw new Error(message);
  }
  return response.json();
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
  return clone;
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

function hydrateEditablePages(template) {
  nodeCounter = 0;
  const pages = template?.pages ?? {};
  const bySide = {};
  (template?.sides ?? ["front", "back"]).forEach((side) => {
    const pageConfig = pages[side] ?? {};
    bySide[side] = { ...pageConfig, layout: cloneLayoutWithIds(pageConfig.layout) };
  });
  editablePages = bySide;
  selectedNodeId = null;
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

function deleteActiveTemplate() {
  const template = getActiveTemplate();
  if (!template) return;
  const confirmed = window.confirm(`Delete ${template.name || template.id}? This action cannot be undone.`);
  if (!confirmed) {
    return;
  }
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
  const duplicate = createTemplate({ ...serialized, id, title: name, name });
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
  rightPane?.querySelector(".workbench-sticky-pane")?.scrollTo({ top: 0, behavior: "smooth" });
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
  if (Array.isArray(node.cells)) {
    for (const row of node.cells) {
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
  if (Array.isArray(node.cells)) {
    for (const row of node.cells) {
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
  if (Array.isArray(node.cells)) {
    for (const row of node.cells) {
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
  if (!node || !Array.isArray(node.cells)) return null;
  for (let row = 0; row < node.cells.length; row += 1) {
    const rowCells = node.cells[row];
    if (!Array.isArray(rowCells)) continue;
    for (let col = 0; col < rowCells.length; col += 1) {
      const cell = rowCells[col];
      const entries = Array.isArray(cell) ? cell : cell ? [cell] : [];
      if (entries.some((entry) => entry?.uid === uid)) {
        return { row, col };
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
    const cellNodes = getCellNodes(parent, location.row, location.col);
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

function copySelectedNode() {
  const layout = getLayoutForSide(currentSide);
  if (!layout || !selectedNodeId) return;
  const node = findNodeById(layout, selectedNodeId);
  if (!node || !findParentNode(layout, selectedNodeId)) return;
  clipboard = {
    node: typeof structuredClone === "function" ? structuredClone(node) : JSON.parse(JSON.stringify(node)),
    placementMeta: getPlacementMetaForSelection(layout, selectedNodeId),
  };
  status?.show("Copied.", { type: "info", timeout: 1200 });
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

// Shared 2D-cell-array storage for both `table` (component) and `grid`
// (type) nodes — same `cells[row][col]` = array-of-nodes convention for
// both, so one set of get/insert/reorder helpers covers the table field's
// per-(row,col) drop slots and the grid container's per-cell drop slots.
function isCellGridNode(node) {
  return Boolean(node) && (node.component === "table" || node.type === "grid");
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

function moveColumnCells(node, fromIndex, toIndex) {
  if (!isCellGridNode(node) || !Array.isArray(node.cells)) return;
  node.cells.forEach((row) => {
    if (!Array.isArray(row)) return;
    const [moved] = row.splice(fromIndex, 1);
    row.splice(toIndex, 0, moved ?? null);
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
  if (node.component === "list") return "List";
  if (node.component === "table") return "Table";
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

function destroyTableColumnsSortable() {
  if (tableColumnsSortable && typeof tableColumnsSortable.destroy === "function") {
    tableColumnsSortable.destroy();
  }
  tableColumnsSortable = null;
}

function renderTableColumnsList(node) {
  if (!tableColumnsList) return;
  tableColumnsList.innerHTML = "";
  destroyTableColumnsSortable();
  if (!node || node.component !== "table") return;
  const columns = Array.isArray(node.columns) ? node.columns : [];
  columns.forEach((column, index) => {
    const item = document.createElement("div");
    item.className = "list-group-item d-flex flex-column gap-2";
    item.dataset.columnIndex = String(index);

    const header = document.createElement("div");
    header.className = "d-flex align-items-center gap-2";

    const handle = document.createElement("span");
    handle.className = "iconify text-body-secondary";
    handle.dataset.icon = "tabler:grip-vertical";
    handle.setAttribute("data-sortable-handle", "");
    handle.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "fw-semibold";
    title.textContent = column?.header || `Column ${index + 1}`;

    const removeButton = document.createElement("button");
    removeButton.className = "btn btn-sm btn-outline-danger ms-auto";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      recordUndoableChange(() => {
        updateSelectedNode((nodeToUpdate) => {
          if (nodeToUpdate.component !== "table") return;
          const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
          nextColumns.splice(index, 1);
          nodeToUpdate.columns = nextColumns;
          removeColumnCells(nodeToUpdate, index);
        });
        renderTableColumnsList(findNodeById(getLayoutForSide(currentSide), selectedNodeId));
        renderPreview();
      });
      updateSaveState();
    });

    header.append(handle, title, removeButton);
    item.appendChild(header);

    const formRow = document.createElement("div");
    formRow.className = "row g-2";

    const headerField = document.createElement("div");
    headerField.className = "col-12 col-md-4";
    const headerInput = document.createElement("input");
    headerInput.type = "text";
    headerInput.className = "form-control form-control-sm";
    headerInput.placeholder = "Header";
    headerInput.value = column?.header ?? "";
    headerInput.addEventListener("focus", () => beginPendingUndo(headerInput));
    headerInput.addEventListener("blur", () => commitPendingUndo(headerInput));
    headerInput.addEventListener("input", () => {
      updateSelectedNode((nodeToUpdate) => {
        if (nodeToUpdate.component !== "table") return;
        const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
        const target = { ...(nextColumns[index] ?? {}) };
        target.header = headerInput.value;
        nextColumns[index] = target;
        nodeToUpdate.columns = nextColumns;
        updateTableHeaderCellText(nodeToUpdate, index, headerInput.value);
      });
      title.textContent = headerInput.value || `Column ${index + 1}`;
      renderPreview();
      updateSaveState();
    });
    headerField.appendChild(headerInput);

    const bindField = document.createElement("div");
    bindField.className = "col-12 col-md-4";
    const bindInput = document.createElement("input");
    bindInput.type = "text";
    bindInput.className = "form-control form-control-sm";
    bindInput.placeholder = "@value";
    bindInput.value = column?.bind ?? "";
    attachBindingAutocomplete(bindInput, { resolveContext: () => getInspectorPreviewContext(selectedNodeId) });
    bindInput.addEventListener("focus", () => beginPendingUndo(bindInput));
    bindInput.addEventListener("blur", () => commitPendingUndo(bindInput));
    bindInput.addEventListener("input", () => {
      updateSelectedNode((nodeToUpdate) => {
        if (nodeToUpdate.component !== "table") return;
        const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
        const target = { ...(nextColumns[index] ?? {}) };
        target.bind = bindInput.value;
        nextColumns[index] = target;
        nodeToUpdate.columns = nextColumns;
        updateTableColumnCells(nodeToUpdate, index, (cell) => {
          cell.text = bindInput.value;
        });
      });
      renderPreview();
      updateSaveState();
    });
    bindField.appendChild(bindInput);

    const widthField = document.createElement("div");
    widthField.className = "col-12 col-md-4";
    const widthInput = document.createElement("input");
    widthInput.type = "text";
    widthInput.className = "form-control form-control-sm";
    widthInput.placeholder = "Width (%, in, etc.)";
    widthInput.value = column?.width ?? "";
    widthInput.addEventListener("focus", () => beginPendingUndo(widthInput));
    widthInput.addEventListener("blur", () => commitPendingUndo(widthInput));
    widthInput.addEventListener("input", () => {
      updateSelectedNode((nodeToUpdate) => {
        if (nodeToUpdate.component !== "table") return;
        const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
        const target = { ...(nextColumns[index] ?? {}) };
        target.width = widthInput.value;
        nextColumns[index] = target;
        nodeToUpdate.columns = nextColumns;
      });
      renderPreview();
      updateSaveState();
    });
    widthField.appendChild(widthInput);

    const textSizeField = document.createElement("div");
    textSizeField.className = "col-12 col-md-4";
    const textSizeSelect = document.createElement("select");
    textSizeSelect.className = "form-select form-select-sm";
    [
      { label: "Text size (inherit)", value: "" },
      { label: "XS", value: "xs" },
      { label: "Sm", value: "sm" },
      { label: "Md", value: "md" },
      { label: "Lg", value: "lg" },
      { label: "XL", value: "xl" },
    ].forEach((option) => {
      const entry = document.createElement("option");
      entry.value = option.value;
      entry.textContent = option.label;
      textSizeSelect.appendChild(entry);
    });
    textSizeSelect.value = column?.textSize ?? "";
    textSizeSelect.addEventListener("focus", () => beginPendingUndo(textSizeSelect));
    textSizeSelect.addEventListener("blur", () => commitPendingUndo(textSizeSelect));
    textSizeSelect.addEventListener("change", () => commitPendingUndo(textSizeSelect));
    textSizeSelect.addEventListener("input", () => {
      updateSelectedNode((nodeToUpdate) => {
        if (nodeToUpdate.component !== "table") return;
        const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
        const target = { ...(nextColumns[index] ?? {}) };
        if (textSizeSelect.value) {
          target.textSize = textSizeSelect.value;
        } else {
          delete target.textSize;
        }
        nextColumns[index] = target;
        nodeToUpdate.columns = nextColumns;
      });
      renderPreview();
      updateSaveState();
    });
    textSizeField.appendChild(textSizeSelect);

    const textStyleField = document.createElement("div");
    textStyleField.className = "col-12 col-md-4 d-flex align-items-center gap-2 flex-wrap";
    const textStyleOptions = [
      { key: "bold", label: "Bold" },
      { key: "italic", label: "Italic" },
      { key: "underline", label: "Underline" },
    ];
    const currentStyles = column?.textStyle ?? { bold: true };
    textStyleOptions.forEach((styleOption) => {
      const wrapper = document.createElement("label");
      wrapper.className = "form-check form-check-inline small mb-0";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "form-check-input";
      checkbox.checked =
        styleOption.key === "bold" ? currentStyles?.bold !== false : Boolean(currentStyles?.[styleOption.key]);
      checkbox.addEventListener("change", () => {
        recordUndoableChange(() => {
          updateSelectedNode((nodeToUpdate) => {
            if (nodeToUpdate.component !== "table") return;
            const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
            const target = { ...(nextColumns[index] ?? {}) };
            const nextStyles = { ...(target.textStyle ?? {}) };
            nextStyles[styleOption.key] = checkbox.checked;
            if (Object.values(nextStyles).some((value) => value !== undefined)) {
              target.textStyle = nextStyles;
            } else {
              delete target.textStyle;
            }
            nextColumns[index] = target;
            nodeToUpdate.columns = nextColumns;
          });
          renderPreview();
        });
        updateSaveState();
      });
      const label = document.createElement("span");
      label.className = "form-check-label";
      label.textContent = styleOption.label;
      wrapper.append(checkbox, label);
      textStyleField.appendChild(wrapper);
    });

    const alignField = document.createElement("div");
    alignField.className = "col-12 col-md-4";
    const alignSelect = document.createElement("select");
    alignSelect.className = "form-select form-select-sm";
    [
      { label: "Alignment (inherit)", value: "" },
      { label: "Left", value: "start" },
      { label: "Center", value: "center" },
      { label: "Right", value: "end" },
      { label: "Justify", value: "justify" },
    ].forEach((option) => {
      const entry = document.createElement("option");
      entry.value = option.value;
      entry.textContent = option.label;
      alignSelect.appendChild(entry);
    });
    alignSelect.value = column?.align ?? "";
    alignSelect.addEventListener("focus", () => beginPendingUndo(alignSelect));
    alignSelect.addEventListener("blur", () => commitPendingUndo(alignSelect));
    alignSelect.addEventListener("change", () => commitPendingUndo(alignSelect));
    alignSelect.addEventListener("input", () => {
      updateSelectedNode((nodeToUpdate) => {
        if (nodeToUpdate.component !== "table") return;
        const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
        const target = { ...(nextColumns[index] ?? {}) };
        if (alignSelect.value) {
          target.align = alignSelect.value;
        } else {
          delete target.align;
        }
        nextColumns[index] = target;
        nodeToUpdate.columns = nextColumns;
      });
      renderPreview();
      updateSaveState();
    });
    alignField.appendChild(alignSelect);

    formRow.append(headerField, bindField, widthField, textSizeField, textStyleField, alignField);
    item.appendChild(formRow);
    tableColumnsList.appendChild(item);
  });

  tableColumnsSortable = createSortable(tableColumnsList, {
    animation: 150,
    handle: "[data-sortable-handle]",
    draggable: ".list-group-item",
    onUpdate: (event) => {
      recordUndoableChange(() => {
        updateSelectedNode((nodeToUpdate) => {
          if (nodeToUpdate.component !== "table") return;
          const nextColumns = Array.isArray(nodeToUpdate.columns) ? [...nodeToUpdate.columns] : [];
          const [moved] = nextColumns.splice(event.oldIndex ?? 0, 1);
          nextColumns.splice(event.newIndex ?? 0, 0, moved);
          nodeToUpdate.columns = nextColumns;
          moveColumnCells(nodeToUpdate, event.oldIndex ?? 0, event.newIndex ?? 0);
        });
        renderTableColumnsList(findNodeById(getLayoutForSide(currentSide), selectedNodeId));
        renderPreview();
      });
      updateSaveState();
    },
  });
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

function pxToPt(value) {
  if (!Number.isFinite(value)) return "";
  return (value * 0.75).toFixed(1).replace(/\.0$/, "");
}

function ptToPx(value) {
  if (!Number.isFinite(value)) return null;
  return value * (4 / 3);
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
  return (
    PRESS_ICON_OPTIONS.find((option) => option.value.toLowerCase() === normalized) ||
    PRESS_ICON_OPTIONS.find((option) => option.label.toLowerCase() === normalized) ||
    null
  );
}

function updateIconResult(resolvedValue, hasIcon) {
  if (!iconResult) return;
  if (resolvedValue === undefined || resolvedValue === null || resolvedValue === "") {
    iconResult.textContent = "Result: —";
    return;
  }
  if (hasIcon) {
    iconResult.textContent = `Result: ${resolvedValue}`;
    return;
  }
  iconResult.textContent = `Result: ${resolvedValue} (no icon found)`;
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
  const resolved = resolveBinding(trimmed, resolvedContext);
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
    updateIconResult("", false);
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
  updateIconResult(resolvedText, resolvedIconTokens.length > 0);
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

function ensureIconAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-icon-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.iconAutocomplete = "true";
    container.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    container.style.zIndex = "1300";
    container.style.fontSize = "0.8125rem";
    container.style.maxHeight = "16rem";
    container.style.overflowY = "auto";
    parent.appendChild(container);
  }
  return container;
}

function renderIconAutocompleteOption(option) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1";
  const preview = document.createElement("span");
  preview.className = "press-icon-option__preview";
  const icon = document.createElement("span");
  icon.className = option.value;
  preview.appendChild(icon);
  const label = document.createElement("span");
  label.className = "text-truncate";
  label.textContent = option.label;
  const group = document.createElement("small");
  group.className = "text-body-secondary text-nowrap ms-auto";
  group.textContent = option.group;
  row.append(preview, label, group);
  return row;
}

function attachIconAutocomplete(input) {
  if (!input) return null;
  const container = ensureIconAutocompleteContainer(input);
  if (!container) return null;
  const MAX_ITEMS = 12;
  let items = [];
  let activeIndex = -1;

  const close = () => {
    items = [];
    activeIndex = -1;
    container.innerHTML = "";
    container.classList.add("d-none");
  };

  const render = (nextItems) => {
    items = nextItems;
    activeIndex = -1;
    container.innerHTML = "";
    if (!items.length) {
      close();
      return;
    }
    items.forEach((option, index) => {
      const row = renderIconAutocompleteOption(option);
      row.dataset.iconIndex = String(index);
      row.setAttribute("role", "option");
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        applyIconSelection(option.value);
        close();
      });
      container.appendChild(row);
    });
    container.classList.remove("d-none");
  };

  const update = () => {
    const value = input.value.trim();
    if (!value || value.startsWith("@") || value.startsWith("=")) {
      close();
      return;
    }
    const normalized = value.toLowerCase();
    const filtered = PRESS_ICON_OPTIONS.filter((option) => {
      return (
        option.label.toLowerCase().includes(normalized) ||
        option.value.toLowerCase().includes(normalized)
      );
    }).slice(0, MAX_ITEMS);
    render(filtered);
  };

  const onKeyDown = (event) => {
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        applyIconSelection(items[activeIndex].value);
        close();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    Array.from(container.querySelectorAll("[data-icon-index]")).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.iconIndex) === activeIndex);
    });
  };

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("click", update);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { update, close };
}

function ensureFontFamilyAutocompleteContainer(input) {
  if (!input || !input.parentElement) return null;
  const parent = input.closest(".form-floating") ?? input.parentElement;
  parent.classList.add("position-relative");
  let container = parent.querySelector("[data-font-family-autocomplete]");
  if (!container) {
    container = document.createElement("div");
    container.dataset.fontFamilyAutocomplete = "true";
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

function openAddFontModal() {
  if (!window.bootstrap?.Modal || !addFontModalElement) return;
  if (addFontValueInput) addFontValueInput.value = "";
  resetAddFontValidationState();
  // Focus itself happens on the modal's own "shown.bs.modal" event (see
  // where addFontModalElement is declared) — attempting it here, before
  // the modal has finished its entrance transition, can get overridden by
  // Bootstrap's own focus handling.
  window.bootstrap.Modal.getOrCreateInstance(addFontModalElement).show();
}

// Shared by the blur-triggered check and (indirectly, via
// pendingValidatedFont) the submit button — a comma means it's already a
// full CSS font-family declaration (e.g. "Georgia, serif" or "'My Font',
// sans-serif") — used verbatim, nothing to load or verify. No comma means
// a bare name (e.g. "Roboto Condensed") — treated as a Google Font:
// existence-checked, wrapped with a generic fallback for `family`, and
// space-to-"+" encoded for `googleFont`. Throws with a user-facing
// message on any validation failure.
async function validateFontInput(raw) {
  if (!raw) {
    throw new Error("Enter a font name or CSS font-family value.");
  }
  const isRawCss = raw.includes(",");
  // Different allowlists since the two shapes have different valid
  // characters — catches obviously-wrong/junk input before any network
  // activity, independent of the real-existence check below (which only
  // applies to the bare-name path; a raw CSS stack can't be verified
  // against anything).
  const isValidFormat = isRawCss ? /^[a-zA-Z0-9 ,'"-]{1,150}$/.test(raw) : /^[a-zA-Z0-9 '-]{1,60}$/.test(raw);
  if (!isValidFormat) {
    throw new Error("That doesn't look like a valid font name or font-family value.");
  }
  const baseLabel = isRawCss ? raw.replace(/['"]/g, "").split(",")[0].trim() || raw : raw;
  const id = baseLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Enter a valid font name or font-family value.");
  }
  let label = baseLabel;
  let googleFont;
  if (!isRawCss) {
    googleFont = raw.replace(/\s+/g, "+");
    // Confirms the name actually resolves to something Google Fonts
    // serves before it's added to the shared library — throws with a
    // user-facing message if not.
    await verifyGoogleFontExists(raw, googleFont);
    // Best-effort labeling, "if known" — the same style the old
    // hand-curated list used (e.g. "Georgia (serif)"). Any lookup problem
    // (including this specific metadata endpoint being unreachable or
    // CORS-blocked from this origin, which is unconfirmed) just means no
    // suffix, never blocks validation — logged so it's diagnosable if it
    // keeps not showing up.
    const { category } = await lookupGoogleFontCategory(raw);
    if (category) {
      label = `${raw} (${category})`;
    } else {
      console.warn(`No Google Fonts category found for "${raw}" — the metadata lookup may be unavailable from this origin.`);
    }
  }
  return isRawCss ? { id, label, family: raw } : { id, label, family: `'${raw}', sans-serif`, googleFont };
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

// Same shape as attachIconAutocomplete (open on focus/click, filter as you
// type, arrow-key nav, close on blur after a short delay so clicks land
// first) — the two differences are a pinned "Add a font…" row always
// appended after the filtered results (opens the add-font modal instead
// of applying a selection), and each rendered row previews its own font
// live via inline style, loading Google Fonts progressively as they
// scroll into view so the preview isn't just the fallback.
function attachFontFamilyAutocomplete(input) {
  if (!input) return null;
  const container = ensureFontFamilyAutocompleteContainer(input);
  if (!container) return null;
  const MAX_ITEMS = 20;
  let items = [];
  let activeIndex = -1;

  const close = () => {
    items = [];
    activeIndex = -1;
    container.innerHTML = "";
    container.classList.add("d-none");
  };

  const activateItem = (item) => {
    close();
    if (item.type === "add") {
      if (userMeetsTier("creator")) {
        openAddFontModal();
      } else {
        status?.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 });
      }
    } else {
      applyFontSelection(input, item.option);
    }
  };

  const render = () => {
    const value = input.value.trim().toLowerCase();
    const matches = getAllFontOptions()
      .filter((option) => {
        if (!value) return true;
        return option.label.toLowerCase().includes(value) || (option.family ?? "").toLowerCase().includes(value);
      })
      .slice(0, MAX_ITEMS);
    items = [...matches.map((option) => ({ type: "font", option })), { type: "add" }];
    activeIndex = -1;
    container.innerHTML = "";
    items.forEach((item, index) => {
      // A <div>, not a <button> — the optional delete button below needs
      // to nest inside a clickable row, and a <button> can't contain
      // another <button> (invalid HTML). Click handling on the row itself
      // does the same job a <button> would.
      const row = document.createElement("div");
      row.className = "list-group-item list-group-item-action d-flex align-items-center gap-2 py-1";
      row.dataset.fontIndex = String(index);
      row.setAttribute("role", "option");

      const label = document.createElement("span");
      label.className = "flex-grow-1 text-truncate";
      if (item.type === "add") {
        label.textContent = "Add a font…";
        row.classList.add("fw-semibold");
      } else {
        label.textContent = item.option.label;
        if (item.option.family) {
          label.style.fontFamily = item.option.family;
          ensureFontLoaded(item.option);
        }
      }
      row.appendChild(label);

      if (item.type === "font" && isCustomFontId(item.option.id) && userMeetsTier("admin")) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "btn btn-sm btn-outline-danger py-0 px-1 flex-shrink-0";
        deleteButton.textContent = "×";
        deleteButton.setAttribute("aria-label", `Delete ${item.option.label} from the font library`);
        deleteButton.addEventListener("mousedown", (event) => event.preventDefault());
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          close();
          handleDeleteCustomFont(item.option);
        });
        row.appendChild(deleteButton);
      }

      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => activateItem(item));
      container.appendChild(row);
    });
    container.classList.remove("d-none");
  };

  const onKeyDown = (event) => {
    if (container.classList.contains("d-none")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      if (activeIndex < 0 || !items[activeIndex]) return;
      event.preventDefault();
      activateItem(items[activeIndex]);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    } else {
      return;
    }
    Array.from(container.querySelectorAll("[data-font-index]")).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.fontIndex) === activeIndex);
    });
  };

  input.addEventListener("focus", () => {
    // Select-all on focus: the common case is replacing one font with
    // another, not editing the name in place, so this saves a
    // select-all-then-type step every time (matches how a lot of native
    // "pick one of these" text fields behave).
    input.select();
    render();
  });
  input.addEventListener("click", render);
  input.addEventListener("input", render);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", () => setTimeout(close, 120));

  return { render, close };
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
  attachIconAutocomplete(iconInput);
  attachBindingAutocomplete(tableRowsInput, { supportsFunctions: false, resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(imageUrlInput, { resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(ariaLabelInput, { resolveContext: resolveInspectorContext });
  attachClassNameAutocomplete(classNameInput);
  attachFontFamilyAutocomplete(fontFamilyInput);
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
    item.addEventListener("click", () => selectNode(node.uid));
    fragment.appendChild(item);
  });

  layoutList.appendChild(fragment);
}

function getNodeText(node) {
  if (!node) return "";
  if (node.component === "list") {
    if (node.itemsBind) {
      return node.itemsBind;
    }
    return Array.isArray(node.items) ? node.items.join("\n") : "";
  }
  if (node.component === "icon") {
    return node.ariaLabel ?? "";
  }
  if (typeof node.text === "string") return node.text;
  if (typeof node.label === "string") return node.label;
  return "";
}

function updateInspector() {
  if (!inspectorSection) return;
  const layout = getLayoutForSide(currentSide);
  const node = findNodeById(layout, selectedNodeId);
  const hasSelection = Boolean(node);
  const parentNode = hasSelection ? findParentNode(layout, selectedNodeId) : null;
  const parentIsContainer = Boolean(
    parentNode && (parentNode.type === "grid" || parentNode.type === "layer" || parentNode.component === "table")
  );
  const parentIsLayer = Boolean(parentNode && parentNode.type === "layer");
  const placement = parentIsLayer ? findLayerPlacement(parentNode, selectedNodeId) : null;

  inspectorSection.classList.toggle("opacity-50", !hasSelection);
  inspectorSection.querySelectorAll("input, select, textarea, button").forEach((el) => {
    el.disabled = !hasSelection;
  });

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
    // that's not a surprise.
    const isRoot = hasSelection && !parentNode;
    deleteButton.textContent = isRoot ? "Clear Layout" : "Delete Component";
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
    if (rowColumnsInput) rowColumnsInput.value = "";
    if (templateColumnsInput) templateColumnsInput.value = "";
    if (gridRowsInput) gridRowsInput.value = "";
    if (templateRowsInput) templateRowsInput.value = "";
    if (tableRowsInput) tableRowsInput.value = "";
    if (ariaLabelInput) ariaLabelInput.value = "";
    if (classNameInput) classNameInput.value = "";
    if (positionXInput) positionXInput.value = "";
    if (positionYInput) positionYInput.value = "";
    if (positionWidthInput) positionWidthInput.value = "";
    if (positionHeightInput) positionHeightInput.value = "";
    if (positionZInput) positionZInput.value = "";
    if (positionRotateInput) positionRotateInput.value = "";
    renderTableColumnsList(null);
    positionFieldGroups.forEach((group) => setGroupVisibility(group, false));
    setGroupVisibility(textFieldGroup, true);
    setGroupVisibility(iconField, false);
    setGroupVisibility(tableFieldGroup, false);
    setGroupVisibility(textDecorationGroup, true);
    setGroupVisibility(ariaLabelField, false);
    setGroupVisibility(classNameField, true);
    imageFieldGroups.forEach((group) => setGroupVisibility(group, false));
    setGroupVisibility(imageSizeFieldGroup, false);
    setGroupVisibility(layerOriginField, false);
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
    if (textSizeCustomInput) textSizeCustomInput.value = pxToPt(TEXT_SIZE_PX.md);
    if (fontFamilyInput) fontFamilyInput.value = "";
    textOrientationInputs.forEach((input) => {
      input.checked = input.value === "horizontal";
    });
    if (textAngleInput) textAngleInput.value = "0";
    if (textCurveInput) textCurveInput.value = "0";
    colorInputs.forEach((input) => {
      const key = input.dataset.componentColor;
      input.value = COLOR_DEFAULTS[key] || "#000000";
    });
    textStyleToggles.forEach((input) => {
      input.checked = false;
    });
    alignInputs.forEach((input) => {
      input.checked = input.value === "start";
    });
    if (visibilityToggle) visibilityToggle.checked = true;
    if (textEditorLabel) {
      textEditorLabel.textContent = "Binding / Text";
    }
    return;
  }

  const isGridNode = node?.type === "grid";
  const isLayerNode = node?.type === "layer";
  const isLayoutNode = isGridNode || isLayerNode;
  const isGapNode = isGridNode || ["list", "stat", "table"].includes(node?.component);
  const isImageNode = node?.component === "image";
  const isTableNode = node?.component === "table";
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
  setGroupVisibility(textFieldGroup, !isLayoutNode && !isImageNode && !isTableNode && !isIconNode);
  setGroupVisibility(iconField, isIconNode);
  setGroupVisibility(tableFieldGroup, isTableNode);
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
  textSettingGroups.forEach((group) => {
    if (group === textDecorationGroup) return;
    setGroupVisibility(group, !isLayoutNode && !isImageNode && !isTableNode);
  });
  setGroupVisibility(textDecorationGroup, !isLayoutNode && !isImageNode && !isTableNode && !isIconNode);
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
      textEditor.value = isImageNode ? "" : getNodeText(node);
      if (node.component === "list") {
        textEditor.placeholder = node.itemsBind ? "Binding (@path)" : "One entry per line";
      } else {
        textEditor.placeholder = "Binding / Text";
      }
    }
  }
  if (textEditorLabel) {
    if (node.component === "list") {
      textEditorLabel.textContent = node.itemsBind ? "List binding" : "List items";
    } else {
      textEditorLabel.textContent = "Binding / Text";
    }
  }
  if (tableRowsInput) {
    tableRowsInput.value = isTableNode ? node.rowsBind ?? node.itemsBind ?? "" : "";
  }
  renderTableColumnsList(isTableNode ? node : null);

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

  colorInputs.forEach((input) => {
    const key = input.dataset.componentColor;
    const styles = node?.style ?? {};
    if (key === "foreground") {
      input.value = styles.color || COLOR_DEFAULTS.foreground;
    } else if (key === "background") {
      input.value = styles.backgroundColor || COLOR_DEFAULTS.background;
    } else if (key === "border") {
      input.value = styles.borderColor || COLOR_DEFAULTS.border;
    }
  });

  if (borderWidthInput) {
    borderWidthInput.value = borderVisible
      ? String(Number.isFinite(node?.style?.borderWidth) ? node.style.borderWidth : 1)
      : "";
  }
  if (borderStyleInput) {
    borderStyleInput.value = borderVisible ? node?.style?.borderStyle ?? "solid" : "solid";
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

  textStyleToggles.forEach((input) => {
    const styleKey = input.dataset.componentTextStyle;
    input.checked = Boolean(resolveTextStyles(node)[styleKey]);
  });

  const alignment = node?.align || "start";
  alignInputs.forEach((input) => {
    input.checked = input.value === alignment;
  });

  if (visibilityToggle) {
    visibilityToggle.checked = !node.hidden;
  }

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

function updateSelectedNode(updater) {
  if (typeof updater !== "function") return;
  const layout = getLayoutForSide(currentSide);
  const node = findNodeById(layout, selectedNodeId);
  if (!node) return;
  updater(node);
}

function updateSelectedPlacement(updater) {
  if (typeof updater !== "function") return;
  const layout = getLayoutForSide(currentSide);
  const parentNode = findParentNode(layout, selectedNodeId);
  if (!parentNode || parentNode.type !== "layer") return;
  const placement = findLayerPlacement(parentNode, selectedNodeId);
  if (!placement) return;
  updater(placement);
}

function applyOverlays(page, template, size, { forPrint = false } = {}) {
  const legendItems = [];
  const isCardOrChip = template.type === "card" || template.type === "chip";

  if (isCardOrChip) {
    const { card } = template;
    const columns = card.columns ?? 3;
    const rows = card.rows ?? 3;
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
  // this branch entirely, so they can't stomp on it.
  if (!forPrint && guideLegendElement) {
    guideLegendElement.innerHTML = "";
    guideLegendElement.hidden = legendItems.length === 0;
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

function renderPreview() {
  destroyCanvasDnd();
  const context = getSelectionContext();
  const { template, source, format, size, orientation, sourceValue, sourceData } = context;
  if (!template || !size) return;
  const side = currentSide;
  const pageOverride = getEditablePage(side);
  let layoutRoot = null;

  previewStage.innerHTML = "";
  const sourceContext = { ...source, value: sourceValue, data: sourceData };
  const page = template.createPage(side, {
    size,
    format,
    source: sourceContext,
    data: sourceData,
    page: pageOverride,
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
  applyOverlays(page, template, size, { forPrint: false });
  previewStage.appendChild(page);
  // Measured before the zoom transform below — getBoundingClientRect()
  // would otherwise return scaled (visual) pixels while max-width is set in
  // the page's own untransformed CSS pixel space, throwing the cap off by
  // whatever the current zoom level is.
  applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
  applyCanvasZoom(page);
  initCanvasDnd(layoutRoot);
  initLayerPlacementDrag(layoutRoot);

  buildPrintStack(template, { size, format, data: sourceData, source: sourceContext });
  updateSideButton();
  renderSampleDataSection();
  renderJsonPreview();
}

function buildPrintStack(template, { size, format, data, source }) {
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
  template.sides.forEach((side) => {
    const page = template.createPage(side, {
      size,
      format,
      source,
      data,
      page: getEditablePage(side),
    });
    applyOverlays(page, template, size, { forPrint: true });
    printStack.appendChild(page);
    applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
  });
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
    option.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
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
      const response = await fetch(`/list/library-${kindSelect.value}`);
      if (response.ok) {
        const payload = await response.json();
        names = (payload.files || []).map((entry) => entry.filename).filter(Boolean).sort();
      }
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
    const data = await loadSourceData(source, sourceValue);
    setSourcePayload(source, {
      value: sourceValue,
      data,
      fetchedAt: new Date().toISOString(),
    });
    renderPreview();
    bindingFieldCache.source = null;
    refreshBindingAutocomplete();
    if (applySelectionCollapse) {
      applySelectionCollapse(true);
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

function initPressCollapsibles() {
  applySelectionCollapse = bindCollapsibleToggle(selectionToggle, selectionPanel, {
    collapsed: false,
    expandLabel: "Expand selections",
    collapseLabel: "Collapse selections",
    labelElement: selectionToggleLabel,
  });
  applyTemplateCollapse = bindCollapsibleToggle(templateToggle, templatePanel, {
    collapsed: false,
    expandLabel: "Expand template properties",
    collapseLabel: "Collapse template properties",
    labelElement: templateToggleLabel,
  });
  applyPageBindingsCollapse = bindCollapsibleToggle(pageBindingsToggle, pageBindingsPanel, {
    collapsed: false,
    expandLabel: "Expand page bindings",
    collapseLabel: "Collapse page bindings",
    labelElement: pageBindingsToggleLabel,
  });
  applyCardCollapse = bindCollapsibleToggle(cardToggle, cardPanel, {
    collapsed: false,
    expandLabel: "Expand card properties",
    collapseLabel: "Collapse card properties",
    labelElement: cardToggleLabel,
  });
  applyComponentCollapse = bindCollapsibleToggle(componentToggle, componentPanel, {
    collapsed: true,
    expandLabel: "Expand component properties",
    collapseLabel: "Collapse component properties",
    labelElement: componentToggleLabel,
  });
}

function setInspectorMode(mode) {
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
  const page = previewStage.firstElementChild;
  applyCanvasZoom(page);
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
    if (slotType === "table" || slotType === "grid") {
      const rowIndex = Number.parseInt(slotElement.dataset.rowIndex ?? "0", 10);
      const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
      const targetIndex = typeof event.newIndex === "number" ? event.newIndex : Number.MAX_SAFE_INTEGER;
      insertCellNode(parentNode, rowIndex, columnIndex, node, targetIndex);
    }
    selectedNodeId = node.uid ?? selectedNodeId;
    renderLayoutList();
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

function handleSlotReorder(event, slotElement) {
  const slotType = slotElement?.dataset?.pressSlot;
  if (slotType !== "table" && slotType !== "grid") return;
  const layout = getLayoutForSide(currentSide);
  if (!layout || !slotElement) return;
  const parentId = slotElement.dataset.parentNodeId;
  if (!parentId) return;
  const parentNode = findNodeById(layout, parentId);
  if (!parentNode) return;
  const rowIndex = Number.parseInt(slotElement.dataset.rowIndex ?? "0", 10);
  const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
  recordUndoableChange(() => {
    reorderCellNodes(parentNode, rowIndex, columnIndex, event.oldIndex ?? 0, event.newIndex ?? 0);
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
    const isCellSlot = slot.dataset.pressSlot === "table" || slot.dataset.pressSlot === "grid";
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
      const listBinding = textEditor.value.trim().startsWith("@");
      let isListNode = false;
      updateSelectedNode((node) => {
        if (node.component === "image") {
          return;
        }
        if (node.component === "table") {
          return;
        }
        if (node.component === "list") {
          isListNode = true;
          const trimmed = textEditor.value.trim();
          if (trimmed.startsWith("@")) {
            node.itemsBind = trimmed;
            node.items = [];
          } else {
            node.items = textEditor.value
              .split("\n")
              .map((entry) => entry.trim())
              .filter(Boolean);
            delete node.itemsBind;
          }
        } else {
          node.text = textEditor.value;
          node.label = textEditor.value;
        }
      });
      if (isListNode) {
        if (textEditorLabel) {
          textEditorLabel.textContent = listBinding ? "List binding" : "List items";
        }
        if (textEditor) {
          textEditor.placeholder = listBinding ? "Binding (@path)" : "One entry per line";
        }
      }
      renderPreview();
      renderLayoutList();
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
        const isGapComponent = ["list", "stat", "table"].includes(node.component);
        if (node.type !== "grid" && !isGapComponent) return;
        node.gap = next;
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

  if (tableRowsInput) {
    tableRowsInput.addEventListener("focus", () => beginPendingUndo(tableRowsInput));
    tableRowsInput.addEventListener("blur", () => commitPendingUndo(tableRowsInput));
    tableRowsInput.addEventListener("change", () => commitPendingUndo(tableRowsInput));
    tableRowsInput.addEventListener("input", () => {
      updateSelectedNode((node) => {
        if (node.component !== "table") return;
        const value = tableRowsInput.value.trim();
        if (value) {
          node.rowsBind = value;
        } else {
          delete node.rowsBind;
        }
      });
      renderPreview();
      updateSaveState();
    });
  }

  if (tableColumnsAddButton) {
    tableColumnsAddButton.addEventListener("click", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          if (node.component !== "table") return;
          const nextColumns = Array.isArray(node.columns) ? [...node.columns] : [];
          nextColumns.push({ header: "New Column", bind: "@value", width: "" });
          node.columns = nextColumns;
          addColumnCells(node, nextColumns.length - 1);
        });
        renderTableColumnsList(findNodeById(getLayoutForSide(currentSide), selectedNodeId));
        renderPreview();
      });
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
      if (!pendingValidatedFont) return;
      const font = pendingValidatedFont;
      // registerCustomFont no-ops (returns the existing entry) if this id
      // is already registered — adding the same font twice just resolves
      // to the one shared entry rather than duplicating the list.
      const registered = registerCustomFont(font);
      ensureFontLoaded(registered);
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          const styles = { ...(node.style ?? {}), fontFamily: registered.family };
          node.style = styles;
        });
        renderPreview();
      });
      if (fontFamilyInput) fontFamilyInput.value = registered.label;
      updateSaveState();
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
          }
          renderPreview();
        });
      });
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

  if (colorInputs.length) {
    colorInputs.forEach((input) => {
      input.addEventListener("focus", () => beginPendingUndo(input));
      input.addEventListener("blur", () => commitPendingUndo(input));
      input.addEventListener("change", () => commitPendingUndo(input));
      input.addEventListener("input", () => {
        const key = input.dataset.componentColor;
        const value = input.value;
        updateSelectedNode((node) => {
          const styles = { ...(node.style ?? {}) };
          if (key === "foreground") {
            styles.color = value;
          } else if (key === "background") {
            styles.backgroundColor = value;
          } else if (key === "border") {
            styles.borderColor = value;
            if (!Number.isFinite(styles.borderWidth)) {
              styles.borderWidth = 1;
            }
            if (!styles.borderStyle) {
              styles.borderStyle = "solid";
            }
            if (!("borderRadius" in styles)) {
              styles.borderRadius = 6;
            }
            if (!styles.borderSides) {
              styles.borderSides = { top: true, right: true, bottom: true, left: true };
            }
          }
          node.style = styles;
        });
        renderPreview();
        updateInspector();
        updateSaveState();
      });
    });
  }

  if (colorClearButtons.length) {
    colorClearButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.componentColorClear;
        recordUndoableChange(() => {
          updateSelectedNode((node) => {
            const styles = { ...(node.style ?? {}) };
            if (key === "foreground") {
              delete styles.color;
            } else if (key === "background") {
              delete styles.backgroundColor;
            } else if (key === "border") {
              delete styles.borderColor;
              delete styles.borderWidth;
              delete styles.borderStyle;
              delete styles.borderRadius;
              delete styles.borderSides;
            }
            if (Object.keys(styles).length) {
              node.style = styles;
            } else {
              delete node.style;
            }
          });
          const input = colorInputs.find((entry) => entry.dataset.componentColor === key);
          if (input) {
            input.value = COLOR_DEFAULTS[key] || "#000000";
          }
          renderPreview();
          updateInspector();
          updateSaveState();
        });
      });
    });
  }

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
        if (!value) {
          delete styles.borderStyle;
        } else {
          styles.borderStyle = value;
        }
        node.style = styles;
      });
      renderPreview();
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

  if (visibilityToggle) {
    visibilityToggle.addEventListener("change", () => {
      recordUndoableChange(() => {
        updateSelectedNode((node) => {
          node.hidden = !visibilityToggle.checked;
        });
        renderPreview();
        renderLayoutList();
      });
    });
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
}

function wireEvents() {
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
    if (key !== "c" && key !== "v" && key !== "d") return;
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
  dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.press" });
  initAuthControls({ root: document, status, dataManager, settingsHref: "../workbench/admin.html" });
  initPressCollapsibles();
  removeDuplicateSampleDataSections();
  await initSampleDataEditor();
  try {
    await loadTemplates();
  } catch (error) {
    console.error("Unable to load templates", error);
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
  renderPreview();
  markLayoutSaved();
  updateGenerateButtonState();
  wireEvents();
  activeTemplateId = getActiveTemplate()?.id ?? null;
  setInspectorMode("template");
}

initPress();
