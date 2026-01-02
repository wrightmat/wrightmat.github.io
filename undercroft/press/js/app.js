import { bindCollapsibleToggle } from "../../common/js/lib/collapsible.js";
import { initAppShell } from "../../common/js/lib/app-shell.js";
import { DataManager } from "../../common/js/lib/data-manager.js";
import { resolveApiBase } from "../../common/js/lib/api.js";
import { initAuthControls } from "../../common/js/lib/auth-ui.js";
import { initHelpSystem } from "../../common/js/lib/help.js";
import { createJsonPreviewRenderer } from "../../common/js/lib/json-preview.js";
import { createSortable } from "../../common/js/lib/dnd.js";
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
} from "./templates.js";
import { getSourceById, getSources } from "./sources.js";
import { loadSourceData } from "./source-data.js";
import { loadSampleData, setSampleDataText, getSampleDataText, getSampleData, subscribeSampleData } from "./sample-data.js";
import { resolveBinding } from "./bindings.js";
import { attachFormulaAutocomplete } from "../../common/js/lib/formula-autocomplete.js";
import { listFormulaFunctionMetadata } from "../../common/js/lib/formula-metadata.js";
import { collectDataFields } from "../../common/js/lib/data-fields.js";

const templateSelect = document.getElementById("templateSelect");
const formatSelect = document.getElementById("formatSelect");
const orientationSelect = document.getElementById("orientationSelect");
const sourceSelect = document.getElementById("sourceSelect");
const sourceInputContainer = document.getElementById("sourceInputContainer");
const previewStage = document.getElementById("previewStage");
const printStack = document.getElementById("printStack");
const swapSideButton = document.getElementById("swapSide");
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
const templateSourcesSelect = document.querySelector("[data-template-sources]");
const templateCardGroup = document.querySelector("[data-template-card-group]");
const templateCardWidthInput = document.querySelector("[data-template-card-width]");
const templateCardHeightInput = document.querySelector("[data-template-card-height]");
const templateCardGutterInput = document.querySelector("[data-template-card-gutter]");
const templateCardSafeInsetInput = document.querySelector("[data-template-card-safe-inset]");
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
const imageFieldGroups = Array.from(document.querySelectorAll("[data-inspector-image-field]"));
const imageUrlInput = document.querySelector("[data-component-image-url]");
const imageWidthInput = document.querySelector("[data-component-image-width]");
const imageHeightInput = document.querySelector("[data-component-image-height]");
const gapInput = document.querySelector("[data-component-gap]");
const gapField = document.querySelector("[data-inspector-gap-field]");
const rowColumnsInput = document.querySelector("[data-component-columns]");
const rowColumnsField = document.querySelector("[data-inspector-row-columns]");
const templateColumnsInput = document.querySelector("[data-component-template-columns]");
const templateColumnsField = document.querySelector("[data-inspector-template-columns]");
const textFieldGroup = document.querySelector("[data-inspector-text-field]");
const tableFieldGroup = document.querySelector("[data-inspector-table-fields]");
const textDecorationGroup = document.querySelector("[data-inspector-text-decoration]");
const tableRowsInput = document.querySelector("[data-component-table-rows]");
const tableColumnsList = document.querySelector("[data-component-table-columns-list]");
const tableColumnsAddButton = document.querySelector("[data-component-table-columns-add]");
const textSettingGroups = Array.from(document.querySelectorAll("[data-inspector-text-settings]"));
const colorGroup = document.querySelector("[data-inspector-color-group]");
const alignmentGroup = document.querySelector("[data-inspector-alignment]");
const alignmentTitle = document.querySelector("[data-alignment-title]");
const alignmentLabels = {
  start: document.querySelector('[data-alignment-label="start"]'),
  center: document.querySelector('[data-alignment-label="center"]'),
  end: document.querySelector('[data-alignment-label="end"]'),
  justify: document.querySelector('[data-alignment-label="justify"]'),
};
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
    id: "row",
    label: "Row",
    description: "Side-by-side layout columns",
    icon: "tabler:columns",
    node: {
      type: "row",
      gap: 4,
      columns: [
        {
          node: {
            type: "field",
            component: "text",
            text: "Column text",
            textSize: "md",
            className: "mb-0",
          },
        },
        {
          node: {
            type: "field",
            component: "text",
            text: "Column text",
            textSize: "md",
            className: "mb-0",
          },
        },
      ],
    },
  },
  {
    id: "stack",
    label: "Stack",
    description: "Vertical layout groups",
    icon: "tabler:layout-list",
    node: {
      type: "stack",
      gap: 4,
      align: "justify",
      children: [
        {
          type: "field",
          component: "text",
          text: "Stack heading",
          textSize: "lg",
          textStyles: { bold: true },
          className: "card-title",
        },
        {
          type: "field",
          component: "text",
          text: "Stack body text",
          textSize: "md",
          className: "mb-0",
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
    id: "noteLines",
    label: "Note Lines",
    description: "Ruled space for handwriting",
    icon: "tabler:notes",
    node: {
      type: "field",
      component: "noteLines",
      className: "note-lines",
    },
  },
];

const COMPONENT_REQUIRED_CLASS_MAP = {
  image: ["press-image"],
  table: ["press-table"],
  noteLines: ["note-lines"],
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

const standardFormats = getStandardFormats();
const standardFormatMap = new Map(standardFormats.map((format) => [format.id, format]));

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
    type: "stack",
    gap: 4,
    children: [],
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
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = resolveNodePreviewContext(child, targetId, context);
      if (found) return found;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      const found = resolveNodePreviewContext(column?.node, targetId, context);
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
  if (Array.isArray(next.children)) {
    next.children = next.children.map((child) => stripNodeIds(child));
  }
  if (Array.isArray(next.columns)) {
    next.columns = next.columns.map((column) => ({
      ...column,
      node: stripNodeIds(column.node),
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
  return saveTemplateChanges({ confirm: true });
}

async function saveTemplateChanges({ template = getActiveTemplate(), confirm = true } = {}) {
  if (!template) {
    return false;
  }
  const hasChanges = !snapshotsEqual(lastSavedLayout, createLayoutSnapshot(template));
  if (!hasChanges) {
    return false;
  }
  if (confirm) {
    const confirmed = window.confirm("Save template changes?");
    if (!confirmed) {
      if (status) {
        status.show("Save cancelled", { type: "info", timeout: 1500 });
      }
      return false;
    }
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
  const clone = { ...node, uid: node.uid ?? nextNodeId() };
  if (Array.isArray(node.children)) {
    clone.children = node.children.map((child) => assignNodeIds(child));
  }
  if (Array.isArray(node.columns)) {
    clone.columns = node.columns.map((column) => ({ ...column, node: assignNodeIds(column.node) }));
  }
  if (Array.isArray(node.cells)) {
    clone.cells = node.cells.map((row) => (Array.isArray(row) ? row.map((cell) => assignNodeIds(cell)) : row));
  }
  return clone;
}

function cloneLayoutWithIds(layout) {
  if (!layout) return null;
  const copy = typeof structuredClone === "function" ? structuredClone(layout) : JSON.parse(JSON.stringify(layout));
  return assignNodeIds(copy);
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
    if (templateCardColumnsInput) templateCardColumnsInput.value = card.columns ?? "";
    if (templateCardRowsInput) templateCardRowsInput.value = card.rows ?? "";
  } else {
    if (templateCardWidthInput) templateCardWidthInput.value = "";
    if (templateCardHeightInput) templateCardHeightInput.value = "";
    if (templateCardGutterInput) templateCardGutterInput.value = "";
    if (templateCardSafeInsetInput) templateCardSafeInsetInput.value = "";
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
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findNodeById(child, uid);
      if (found) return found;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      const found = findNodeById(column.node, uid);
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
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (child?.uid === uid) return node;
      const found = findParentNode(child, uid, node);
      if (found) return found;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      if (column?.node?.uid === uid) return node;
      const found = findParentNode(column?.node, uid, node);
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
  if (Array.isArray(node.children)) {
    const index = node.children.findIndex((child) => child.uid === uid);
    if (index >= 0) {
      const [removed] = node.children.splice(index, 1);
      return removed;
    }
    for (const child of node.children) {
      const removed = removeNodeById(child, uid);
      if (removed) return removed;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      if (column?.node?.uid === uid) {
        const removed = column.node;
        column.node = null;
        return removed;
      }
      const removed = removeNodeById(column.node, uid);
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
  recordUndoableChange(() => {
    const layout = getLayoutForSide(currentSide);
    if (!layout || !selectedNodeId) return;
    removeNodeById(layout, selectedNodeId);
    selectedNodeId = getRootChildren(currentSide)[0]?.uid ?? null;
    renderLayoutList();
    updateInspector();
    renderPreview();
  });
}

function getRootChildren(side) {
  const layout = getLayoutForSide(side);
  if (layout?.type === "stack" && Array.isArray(layout.children)) {
    return layout.children;
  }
  return [];
}

function insertNodeAtRoot(side, node, index) {
  if (!node) return;
  const layout = getLayoutForSide(side);
  if (!layout || layout.type !== "stack") return;
  const children = getRootChildren(side);
  const targetIndex = Math.max(0, Math.min(index, children.length));
  const prepared = node.uid ? node : assignNodeIds(node);
  children.splice(targetIndex, 0, prepared);
  selectedNodeId = prepared.uid ?? children[targetIndex]?.uid ?? null;
}

function reorderRootChildren(side, fromIndex, toIndex) {
  const layout = getLayoutForSide(side);
  if (!layout || layout.type !== "stack") return;
  const children = getRootChildren(side);
  if (!children[fromIndex]) return;
  const [moved] = children.splice(fromIndex, 1);
  children.splice(Math.max(0, toIndex), 0, moved);
}

function removeNodeAtRoot(side, uid) {
  const layout = getLayoutForSide(side);
  if (!layout || layout.type !== "stack") return null;
  const children = getRootChildren(side);
  const index = children.findIndex((child) => child.uid === uid);
  if (index >= 0) {
    const [removed] = children.splice(index, 1);
    return removed;
  }
  return null;
}

function createNodeFromPalette(type) {
  const entry = paletteComponents.find((item) => item.id === type);
  if (!entry?.node) return null;
  const clone = typeof structuredClone === "function" ? structuredClone(entry.node) : JSON.parse(JSON.stringify(entry.node));
  return assignNodeIds(clone);
}

function reorderStackChildren(stackNode, fromIndex, toIndex) {
  if (!stackNode || stackNode.type !== "stack" || !Array.isArray(stackNode.children)) return;
  if (!stackNode.children[fromIndex]) return;
  const [moved] = stackNode.children.splice(fromIndex, 1);
  stackNode.children.splice(Math.max(0, toIndex), 0, moved);
}

function insertNodeIntoStack(stackNode, node, index) {
  if (!stackNode || stackNode.type !== "stack") return;
  if (!Array.isArray(stackNode.children)) {
    stackNode.children = [];
  }
  const targetIndex = Math.max(0, Math.min(index, stackNode.children.length));
  stackNode.children.splice(targetIndex, 0, node);
}

function setRowColumnNode(rowNode, columnIndex, node) {
  if (!rowNode || rowNode.type !== "row") return;
  if (!Array.isArray(rowNode.columns)) {
    rowNode.columns = [];
  }
  while (rowNode.columns.length <= columnIndex) {
    rowNode.columns.push({ node: null });
  }
  rowNode.columns[columnIndex].node = node;
}

function getTableCellNodes(tableNode, rowIndex, columnIndex) {
  if (!tableNode || tableNode.component !== "table") return;
  if (!Array.isArray(tableNode.cells)) {
    tableNode.cells = [];
  }
  while (tableNode.cells.length <= rowIndex) {
    tableNode.cells.push([]);
  }
  if (!Array.isArray(tableNode.cells[rowIndex])) {
    tableNode.cells[rowIndex] = [];
  }
  while (tableNode.cells[rowIndex].length <= columnIndex) {
    tableNode.cells[rowIndex].push(null);
  }
  const cellEntry = tableNode.cells[rowIndex][columnIndex];
  if (!Array.isArray(cellEntry)) {
    tableNode.cells[rowIndex][columnIndex] = cellEntry ? [cellEntry] : [];
  }
  return tableNode.cells[rowIndex][columnIndex];
}

function insertTableCellNode(tableNode, rowIndex, columnIndex, node, index) {
  const cellNodes = getTableCellNodes(tableNode, rowIndex, columnIndex);
  if (!Array.isArray(cellNodes)) return;
  const targetIndex = Math.max(0, Math.min(index, cellNodes.length));
  cellNodes.splice(targetIndex, 0, node);
}

function reorderTableCellNodes(tableNode, rowIndex, columnIndex, fromIndex, toIndex) {
  const cellNodes = getTableCellNodes(tableNode, rowIndex, columnIndex);
  if (!Array.isArray(cellNodes) || !cellNodes[fromIndex]) return;
  const [moved] = cellNodes.splice(fromIndex, 1);
  cellNodes.splice(Math.max(0, toIndex), 0, moved);
}

function getDraggedNodeId(item) {
  if (!item) return null;
  if (item.dataset?.nodeId) return item.dataset.nodeId;
  return item.querySelector?.("[data-node-id]")?.dataset?.nodeId ?? null;
}

function createDefaultRowColumn() {
  return {
    node: assignNodeIds({
      type: "field",
      component: "text",
      text: "Column text",
      textSize: "md",
      className: "mb-0",
    }),
  };
}

function removeTableColumnCells(node, index) {
  if (!node || node.component !== "table" || !Array.isArray(node.cells)) return;
  node.cells.forEach((row) => {
    if (!Array.isArray(row)) return;
    row.splice(index, 1);
  });
}

function moveTableColumnCells(node, fromIndex, toIndex) {
  if (!node || node.component !== "table" || !Array.isArray(node.cells)) return;
  node.cells.forEach((row) => {
    if (!Array.isArray(row)) return;
    const [moved] = row.splice(fromIndex, 1);
    row.splice(toIndex, 0, moved ?? null);
  });
}

function addTableColumnCells(node, index) {
  if (!node || node.component !== "table" || !Array.isArray(node.cells)) return;
  node.cells.forEach((row) => {
    if (!Array.isArray(row)) return;
    row.splice(index, 0, null);
  });
}

function describeNode(node) {
  if (!node) return "Component";
  if (node.type === "row") return "Row";
  if (node.type === "stack") return "Stack";
  if (node.component === "text") return node.text ? node.text.slice(0, 48) : "Text";
  if (node.component === "icon") return node.ariaLabel || "Icon";
  if (node.component === "badge") return node.text || node.label || "Badge";
  if (node.component === "image") return node.url || "Image";
  if (node.component === "list") return "List";
  if (node.component === "table") return "Table";
  if (node.component === "noteLines") return "Notes";
  if (node.component === "stat") return node.label || "Block";
  return node.component || node.type || "Component";
}

function getPaletteEntryForNode(node) {
  if (!node) return null;
  if (node.type === "stack") {
    return paletteComponents.find((item) => item.id === "stack") ?? null;
  }
  if (node.type === "row") {
    return paletteComponents.find((item) => item.id === "row") ?? null;
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
          removeTableColumnCells(nodeToUpdate, index);
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
          moveTableColumnCells(nodeToUpdate, event.oldIndex ?? 0, event.newIndex ?? 0);
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
  if (!value) return [];
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith("ddb-") || token.startsWith("bi-"));
}

function updateIconResult(resolvedValue, tokens) {
  if (!iconResult) return;
  if (!resolvedValue) {
    iconResult.textContent = "Result: —";
    return;
  }
  if (tokens.length) {
    iconResult.textContent = `Result: ${resolvedValue}`;
    return;
  }
  iconResult.textContent = `Result: ${resolvedValue} (no icon found)`;
}

function resolveIconPreviewValue(value, context) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const resolved = resolveBinding(trimmed, context);
  if (typeof resolved === "string") {
    return resolved.trim();
  }
  if (resolved === null || resolved === undefined) {
    return "";
  }
  return String(resolved).trim();
}

function updateIconPreview(value, context) {
  if (!iconPreview) return;
  iconPreview.className = "press-icon-preview";
  iconPreview.innerHTML = "";
  const resolvedValue = resolveIconPreviewValue(value, context);
  const iconTokens = getIconTokens(resolvedValue);
  if (!resolvedValue) {
    updateIconResult("", []);
    return;
  }
  const resolvedIconTokens = getIconTokens(resolvedValue);
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
  updateIconResult(resolvedValue, resolvedIconTokens);
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

function formatBindingPreviewValue(value) {
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
    description: formatBindingPreviewValue(entry.value),
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
  attachBindingAutocomplete(tableRowsInput, { supportsFunctions: false, resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(imageUrlInput, { resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(ariaLabelInput, { resolveContext: resolveInspectorContext });
}

function formatBindingPreviewValue(value) {
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
    description: formatBindingPreviewValue(entry.value),
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
  attachBindingAutocomplete(tableRowsInput, { supportsFunctions: false, resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(imageUrlInput, { resolveContext: resolveInspectorContext });
  attachBindingAutocomplete(ariaLabelInput, { resolveContext: resolveInspectorContext });
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
    parentNode && (parentNode.type === "stack" || parentNode.type === "row" || parentNode.component === "table")
  );

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
    if (gapInput) gapInput.value = "";
    if (rowColumnsInput) rowColumnsInput.value = "";
    if (templateColumnsInput) templateColumnsInput.value = "";
    if (tableRowsInput) tableRowsInput.value = "";
    if (ariaLabelInput) ariaLabelInput.value = "";
    if (classNameInput) classNameInput.value = "";
    renderTableColumnsList(null);
    setGroupVisibility(textFieldGroup, true);
    setGroupVisibility(iconField, false);
    setGroupVisibility(tableFieldGroup, false);
    setGroupVisibility(textDecorationGroup, true);
    setGroupVisibility(ariaLabelField, false);
    setGroupVisibility(classNameField, true);
    imageFieldGroups.forEach((group) => setGroupVisibility(group, false));
    textSettingGroups.forEach((group) => {
      if (group === textDecorationGroup) return;
      setGroupVisibility(group, true);
    });
    setGroupVisibility(colorGroup, true);
    setGroupVisibility(borderGroup, false);
    setGroupVisibility(alignmentGroup, true);
    if (gapField) {
      gapField.hidden = true;
    }
    if (rowColumnsField) {
      rowColumnsField.hidden = true;
    }
    if (templateColumnsField) {
      templateColumnsField.hidden = true;
    }
    textStyleToggles.forEach((input) => {
      input.disabled = false;
    });
    if (alignmentTitle) {
      alignmentTitle.textContent = "Alignment";
    }
    if (alignmentLabels.start) alignmentLabels.start.textContent = "Left";
    if (alignmentLabels.center) alignmentLabels.center.textContent = "Center";
    if (alignmentLabels.end) alignmentLabels.end.textContent = "Right";
    if (alignmentLabels.justify) alignmentLabels.justify.textContent = "Justify";
    alignInputs.forEach((input) => {
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.remove("d-none");
      }
    });
    textSizeInputs.forEach((input) => {
      input.checked = input.value === "md";
    });
    if (textSizeCustomInput) textSizeCustomInput.value = pxToPt(TEXT_SIZE_PX.md);
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

  const isLayoutNode = node?.type === "row" || node?.type === "stack";
  const isGapNode = isLayoutNode || ["list", "stat", "table"].includes(node?.component);
  const isStackNode = node?.type === "stack";
  const isImageNode = node?.component === "image";
  const isTableNode = node?.component === "table";
  const isIconNode = node?.component === "icon";
  const borderVisible = hasBorderStyles(node?.style ?? {});
  setGroupVisibility(textFieldGroup, !isLayoutNode && !isImageNode && !isTableNode && !isIconNode);
  setGroupVisibility(iconField, isIconNode);
  setGroupVisibility(tableFieldGroup, isTableNode);
  setGroupVisibility(ariaLabelField, isIconNode);
  setGroupVisibility(classNameField, true);
  imageFieldGroups.forEach((group) => setGroupVisibility(group, isImageNode));
  textSettingGroups.forEach((group) => {
    if (group === textDecorationGroup) return;
    setGroupVisibility(group, !isLayoutNode && !isImageNode && !isTableNode);
  });
  setGroupVisibility(textDecorationGroup, !isLayoutNode && !isImageNode && !isTableNode && !isIconNode);
  setGroupVisibility(colorGroup, true);
  setGroupVisibility(borderGroup, borderVisible);
  setGroupVisibility(alignmentGroup, !isImageNode && !isIconNode);
  textStyleToggles.forEach((input) => {
    input.disabled = isLayoutNode || isImageNode || isIconNode;
  });
  if (gapField) {
    gapField.hidden = !isGapNode;
  }
  if (rowColumnsField) {
    rowColumnsField.hidden = node?.type !== "row";
  }
  if (templateColumnsField) {
    templateColumnsField.hidden = node?.type !== "row";
  }

  if (gapInput) {
    const defaultGap = node?.component === "stat" ? 2 : 4;
    const gapValue = Number.isFinite(node?.gap) ? node.gap : defaultGap;
    gapInput.value = isGapNode ? String(gapValue) : "";
  }
  if (rowColumnsInput) {
    rowColumnsInput.value = node?.type === "row" ? String(node.columns?.length ?? 0) : "";
  }
  if (templateColumnsInput) {
    templateColumnsInput.value = node?.type === "row" ? node.templateColumns ?? "" : "";
  }

  if (alignmentTitle) {
    if (isStackNode) {
      alignmentTitle.textContent = "Vertical alignment";
    } else if (isLayoutNode) {
      alignmentTitle.textContent = "Horizontal alignment";
    } else {
      alignmentTitle.textContent = "Alignment";
    }
  }
  if (isStackNode) {
    if (alignmentLabels.start) alignmentLabels.start.textContent = "Top";
    if (alignmentLabels.center) alignmentLabels.center.textContent = "Middle";
    if (alignmentLabels.end) alignmentLabels.end.textContent = "Bottom";
    if (alignmentLabels.justify) alignmentLabels.justify.textContent = "Justified";
    alignInputs.forEach((input) => {
      const shouldHide = false;
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.toggle("d-none", shouldHide);
      }
    });
  } else {
    if (alignmentLabels.start) alignmentLabels.start.textContent = "Left";
    if (alignmentLabels.center) alignmentLabels.center.textContent = "Center";
    if (alignmentLabels.end) alignmentLabels.end.textContent = "Right";
    if (alignmentLabels.justify) {
      alignmentLabels.justify.textContent = isLayoutNode ? "Stretch" : "Justify";
    }
    alignInputs.forEach((input) => {
      input.disabled = false;
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.classList.remove("d-none");
      }
    });
  }

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

  const alignment = node?.align || (isStackNode ? "justify" : "start");
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

function applyOverlays(page, template, size, { forPrint = false } = {}) {
  if (template.type === "card" || template.type === "chip") {
    const guides = document.createElement("div");
    guides.className = "page-overlay trim-lines card-guides";

    const { card } = template;
    const columns = card.columns ?? 3;
    const rows = card.rows ?? 3;
    const cellWidth = card.width ?? 2.5;
    const cellHeight = template.type === "chip" ? cellWidth : card.height ?? 3.5;
    const gridWidth = cellWidth * columns + card.gutter * (columns - 1);
    const gridHeight = cellHeight * rows + card.gutter * (rows - 1);
    const availableWidth = size.width - size.margin * 2;
    const availableHeight = size.height - size.margin * 2;
    const horizontalInset = size.margin + Math.max(0, (availableWidth - gridWidth) / 2);
    const verticalInset = size.margin + Math.max(0, (availableHeight - gridHeight) / 2);

    const addGuide = (orientation, position, length, start) => {
      const guide = document.createElement("div");
      guide.className = `guide-line guide-${orientation}`;
      if (orientation === "vertical") {
        guide.style.left = `${position}in`;
        guide.style.top = `${start}in`;
        guide.style.height = `${length}in`;
      } else {
        guide.style.top = `${position}in`;
        guide.style.left = `${start}in`;
        guide.style.width = `${length}in`;
      }
      guides.appendChild(guide);
    };

    Array.from({ length: columns + 1 }).forEach((_, index) => {
      const x = horizontalInset + index * (cellWidth + template.card.gutter);
      addGuide("vertical", x, gridHeight, verticalInset);
    });

    Array.from({ length: rows + 1 }).forEach((_, index) => {
      const y = verticalInset + index * (cellHeight + template.card.gutter);
      addGuide("horizontal", y, gridWidth, horizontalInset);
    });

    page.appendChild(guides);
  }

  if (!forPrint) {
    const safe = document.createElement("div");
    const inset = Math.max(0.2, size.margin ?? 0.25);
    safe.className = "page-overlay safe-area";
    safe.style.inset = `${inset}in`;
    page.appendChild(safe);
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
  initCanvasDnd(layoutRoot);

  buildPrintStack(template, { size, format, data: sourceData, source: sourceContext });
  updateSideButton();
  renderSampleDataSection();
  renderJsonPreview();
}

function buildPrintStack(template, { size, format, data, source }) {
  printStack.innerHTML = "";
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
  });
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
    if (status) {
      status.show("Source data loaded for printing.", { type: "success", timeout: 2000 });
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

function handleStackAdd(event, stackId) {
  const type = event.item?.dataset?.componentType;
  const layout = getLayoutForSide(currentSide);
  if (!layout) {
    event.item?.remove();
    return;
  }
  const stackNode = findNodeById(layout, stackId);
  if (!stackNode || stackNode.type !== "stack") {
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
    const index = typeof event.newIndex === "number" ? event.newIndex : stackNode.children?.length ?? 0;
    insertNodeIntoStack(stackNode, node, index);
    selectedNodeId = node.uid ?? selectedNodeId;
    renderLayoutList();
    updateInspector();
    renderPreview();
  });
  updateSaveState();
}

function handleStackReorder(event, stackId) {
  const layout = getLayoutForSide(currentSide);
  if (!layout) return;
  const stackNode = findNodeById(layout, stackId);
  if (!stackNode || stackNode.type !== "stack") return;
  recordUndoableChange(() => {
    reorderStackChildren(stackNode, event.oldIndex ?? 0, event.newIndex ?? 0);
    renderLayoutList();
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
  event.item?.remove();
  recordUndoableChange(() => {
    let node = null;
    if (type) {
      node = createNodeFromPalette(type);
    } else if (draggedId) {
      node = removeNodeById(layout, draggedId);
    }
    if (!node) return;
    if (slotType === "row") {
      const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
      setRowColumnNode(parentNode, columnIndex, node);
    } else if (slotType === "table") {
      const rowIndex = Number.parseInt(slotElement.dataset.rowIndex ?? "0", 10);
      const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
      const targetIndex = typeof event.newIndex === "number" ? event.newIndex : Number.MAX_SAFE_INTEGER;
      insertTableCellNode(parentNode, rowIndex, columnIndex, node, targetIndex);
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
  if (slotType !== "table") return;
  const layout = getLayoutForSide(currentSide);
  if (!layout || !slotElement) return;
  const parentId = slotElement.dataset.parentNodeId;
  if (!parentId) return;
  const parentNode = findNodeById(layout, parentId);
  if (!parentNode) return;
  const rowIndex = Number.parseInt(slotElement.dataset.rowIndex ?? "0", 10);
  const columnIndex = Number.parseInt(slotElement.dataset.columnIndex ?? "0", 10);
  recordUndoableChange(() => {
    reorderTableCellNodes(parentNode, rowIndex, columnIndex, event.oldIndex ?? 0, event.newIndex ?? 0);
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
  const stackContainers = [];
  if (rootElement.dataset.pressContainer === "stack") {
    stackContainers.push(rootElement);
  }
  stackContainers.push(...rootElement.querySelectorAll('[data-press-container="stack"]'));
  stackContainers.forEach((container) => {
    const stackId = container.dataset.nodeId;
    if (!stackId) return;
    const sortable = createSortable(container, {
      group: { name: "press-layout", pull: true, put: true },
      animation: 150,
      fallbackOnBody: true,
      handle: null,
      draggable: "[data-node-id], [data-component-type]",
      onAdd: (event) => handleStackAdd(event, stackId),
      onUpdate: (event) => handleStackReorder(event, stackId),
    });
    if (sortable) canvasSortables.push(sortable);
  });

  const slotTargets = Array.from(rootElement.querySelectorAll("[data-press-slot]"));
  slotTargets.forEach((slot) => {
    const isTableSlot = slot.dataset.pressSlot === "table";
    const sortable = createSortable(slot, {
      group: { name: "press-layout", pull: true, put: true },
      animation: 150,
      fallbackOnBody: true,
      handle: null,
      sort: isTableSlot,
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

  if (gapInput) {
    gapInput.addEventListener("focus", () => beginPendingUndo(gapInput));
    gapInput.addEventListener("blur", () => commitPendingUndo(gapInput));
    gapInput.addEventListener("change", () => commitPendingUndo(gapInput));
    gapInput.addEventListener("input", () => {
      const parsed = Number(gapInput.value);
      const next = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 12)) : 0;
      updateSelectedNode((node) => {
        const isLayoutNode = node.type === "row" || node.type === "stack";
        const isGapComponent = ["list", "stat", "table"].includes(node.component);
        if (!isLayoutNode && !isGapComponent) return;
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
        if (node.type !== "row") return;
        const columns = Array.isArray(node.columns) ? node.columns : [];
        if (next > columns.length) {
          const additions = Array.from({ length: next - columns.length }, () => createDefaultRowColumn());
          node.columns = [...columns, ...additions];
        } else {
          node.columns = columns.slice(0, next);
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
        if (node.type !== "row") return;
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
          addTableColumnCells(node, nextColumns.length - 1);
        });
        renderTableColumnsList(findNodeById(getLayoutForSide(currentSide), selectedNodeId));
        renderPreview();
      });
      updateSaveState();
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
}

function wireEvents() {
  if (newTemplateButton) {
    newTemplateButton.addEventListener("click", () => {
      startNewTemplate();
    });
  }
  if (templateDeleteButton) {
    templateDeleteButton.addEventListener("click", () => {
      deleteActiveTemplate();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Delete") {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    const active = document.activeElement;
    if (
      active &&
      active instanceof HTMLElement &&
      (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))
    ) {
      return;
    }
    if (!selectedNodeId) {
      return;
    }
    removeSelectedNode();
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
          const saved = await saveTemplateChanges({ template: previousTemplate, confirm: false });
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
  if (generateButton) {
    generateButton.addEventListener("click", handleGeneratePrint);
  }
  printButton.addEventListener("click", () => window.print());
}

async function initPress() {
  initShell();
  const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.press" });
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
