import { populateSelect } from "../lib/dropdown.js";
import { matchesOwner, confirmDelete } from "../../../common/js/lib/ownership.js";
import {
  createCanvasPlaceholder,
  initPaletteInteractions,
  setupDropzones,
} from "../lib/editor-canvas.js";
import {
  createCanvasCardElement,
  createCollapseToggleButton,
  createStandardCardChrome,
} from "../lib/canvas-card.js";
import { createJsonPreviewRenderer } from "../../../common/js/lib/json-preview.js";
import { createRootInsertionHandler } from "../lib/root-inserter.js";
import { expandPane } from "../../../common/js/lib/panes.js";
import { refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../../common/js/lib/collapsible.js";
import {
  listBuiltinSystems,
  listBuiltinTemplates,
  markBuiltinMissing,
  markBuiltinAvailable,
  applyBuiltinCatalog,
  verifyBuiltinAsset,
} from "../lib/content-registry.js";
import { COMPONENT_ICONS, applyComponentStyles, applyTextFormatting } from "../lib/component-styles.js";
import { collectSystemFields, categorizeFieldType } from "../lib/system-schema.js";
import { attachFormulaAutocomplete } from "../../../common/js/lib/formula-autocomplete.js";
import { resolveFieldTypeMeta } from "../lib/field-type-meta.js";
import { listFormulaFunctionMetadata } from "../../../common/js/lib/formula-metadata.js";
import {
  normalizeBindingValue,
  resolveBindingFromContexts,
  normalizeOptionEntries,
  buildSystemPreviewData,
} from "../lib/component-data.js";
import { createLabeledField, normalizeLabelPosition } from "../lib/component-layout.js";
import {
  PATTERN_CATEGORIES,
  getPresetsByCategory,
  getPresetDefaultValues,
  svgToDataUri,
  embedPatternMetadata,
  extractPatternMetadata,
} from "../../../common/js/lib/pattern-library.js";
import { attachIconAutocomplete, resolveIconClassList } from "../../../common/js/lib/icon-picker.js";
import { attachFontFamilyAutocomplete, validateFontInput } from "../../../common/js/lib/font-picker.js";
import { attachClassNameAutocomplete } from "../../../common/js/lib/class-name-picker.js";
import { TEXT_SIZE_PX, pxToPt, ptToPx } from "../../../common/js/lib/text-size.js";
import {
  findFontOptionByFamily,
  ensureFontLoaded,
  registerCustomFont,
  loadCustomFonts,
  saveCustomFont,
  deleteCustomFont,
  saveCustomFontDeletion,
  DEFAULT_FONT_FAMILY,
} from "../../../common/js/lib/font-library.js";

// Relocated from the old standalone template.html/template.js — now one of
// three views on Workbench's unified page (see js/pages/workbench.js), which
// owns the single initAppShell call (status/undoStack), DataManager, auth,
// help system, and tier gating (Template is gated to "gm" at the tab level
// via data-requires-tier, not a whole-page initTierGate here anymore).
export async function initTemplateView({ status, undoStack, dataManager }) {
  function sessionUser() {
    return dataManager.session?.user || null;
  }

  const templateCatalog = new Map();
  const systemCatalog = new Map();
  const BINDING_FIELDS_EVENT = "template:binding-fields-ready";

  const FORMULA_FUNCTIONS = listFormulaFunctionMetadata();

  function getComponentBindingCategories(component) {
    if (!component || typeof component !== "object") {
      return null;
    }
    switch (component.type) {
      case "input": {
        const variant = component.variant || "text";
        if (variant === "number") {
          return ["number"];
        }
        if (variant === "checkbox" || variant === "radio") {
          return variant === "checkbox" ? ["array", "object"] : ["string", "number"];
        }
        if (variant === "select") {
          return ["string", "number"];
        }
        if (variant === "textarea") {
          return ["string"];
        }
        return ["string", "number"];
      }
      case "track":
      case "linear-track":
      case "circular-track":
        return ["number"];
      case "repeater":
        return ["array", "object"];
      case "select-group":
        return component.multiple ? ["array", "object"] : ["string", "number"];
      case "toggle":
        return ["string", "number"];
      default:
        return null;
    }
  }

  function fieldMatchesCategories(entry, categories) {
    if (!Array.isArray(categories) || !categories.length) {
      return true;
    }
    const entryCategory = entry?.category || categorizeFieldType(entry?.type);
    if (!entryCategory) {
      return categories.includes("string") || categories.includes("any");
    }
    return categories.includes(entryCategory) || categories.includes("any");
  }

  const systemDefinitionCache = new Map();

  const state = {
    template: null,
    components: [],
    selectedId: null,
    systemDefinition: null,
    systemPreviewData: {},
    bindingFields: [],
  };

  let lastSavedTemplateSignature = null;
  let templateIdAuto = false;

  markTemplateClean();

  let pendingSharedTemplate = resolveSharedRecordParam("templates");

  function hasActiveTemplate() {
    return Boolean(state.template && (state.template.id || state.template.title));
  }

  const dropzones = new Map();
  const containerActiveTabs = new Map();
  const componentCollapsedState = new Map();

  // Pattern/shape picker modal state (Image component) — declared here,
  // not down near the picker's own functions, because initPatternModal()
  // runs early during init (before those functions' own section of the
  // file has executed) and a `let` is only initialized once its own
  // statement actually runs, not merely hoisted like a function declaration.
  let selectedPatternPreset = null;
  let currentPatternValues = {};
  let patternPickerComponentUid = null;
  let patternPickerInput = null;

  // Add Font modal state (Font field, see createFontFamilyControl) — same
  // early-declaration reasoning as the pattern picker's own state above.
  // The font validated on blur (see handleAddFontValueBlur), cached so the
  // submit handler can reuse it instead of re-verifying — cleared whenever
  // the field is edited again, which is also what keeps the Add button
  // disabled until a fresh blur-triggered validation succeeds.
  let pendingValidatedFont = null;
  // Called with the registered {id,label,family,...} once a font is
  // confirmed — set by whichever call to openAddFontModal is currently
  // open, so the SAME modal can apply the result either to a component's
  // own Font field or to the Template's own base font, without the modal
  // itself needing to know which.
  let addFontApplyCallback = null;

  function cloneComponentTree(component) {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(component);
      } catch (error) {
        // fall through to JSON clone
      }
    }
    return JSON.parse(JSON.stringify(component));
  }

  function cloneComponentCollection(components) {
    return Array.isArray(components) ? components.map((component) => cloneComponentTree(component)) : [];
  }

  function snapshotContainerTabs() {
    return Array.from(containerActiveTabs.entries());
  }

  function restoreContainerTabsSnapshot(snapshot) {
    containerActiveTabs.clear();
    if (!Array.isArray(snapshot)) {
      return;
    }
    snapshot.forEach(([key, value]) => {
      containerActiveTabs.set(key, value);
    });
  }

  function emitBindingFieldsReady(schemaId = "") {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
      return;
    }
    const detail = {
      schemaId: schemaId || "",
      count: Array.isArray(state.bindingFields) ? state.bindingFields.length : 0,
    };
    window.dispatchEvent(new CustomEvent(BINDING_FIELDS_EVENT, { detail }));
  }

  const elements = {};

  await initializeBuiltins();

  Object.assign(elements, {
    templateSelect: document.querySelector("[data-template-select]"),
    palette: document.querySelector("[data-palette]"),
    canvasRoot: document.querySelector("[data-canvas-root]"),
    inspector: document.querySelector("[data-inspector]"),
    saveButton: document.querySelector('[data-action="save-template"]'),
    undoButton: document.querySelector('[data-action="undo-template"]'),
    redoButton: document.querySelector('[data-action="redo-template"]'),
    clearButton: document.querySelector('[data-action="clear-canvas"]'),
    exportButton: document.querySelector('[data-action="export-template"]'),
    newTemplateButton: document.querySelector('[data-action="new-template"]'),
    duplicateTemplateButton: document.querySelector('[data-action="duplicate-template"]'),
    deleteTemplateButton: document.querySelector('[data-delete-template]'),
    newTemplateForm: document.querySelector("[data-new-template-form]"),
    newTemplateId: document.querySelector("[data-new-template-id]"),
    newTemplateTitle: document.querySelector("[data-new-template-title]"),
    newTemplateVersion: document.querySelector("[data-new-template-version]"),
    newTemplateSystem: document.querySelector("[data-new-template-system]"),
    newTemplateModalTitle: document.querySelector("[data-new-template-modal-title]"),
    templateMeta: document.querySelector("[data-template-meta]"),
    rightPane: document.querySelector('[data-pane="right"]'),
    rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
    jsonPreview: document.querySelector("[data-json-preview]"),
    jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
    templateProperties: document.querySelector("[data-template-properties]"),
    selectionsToggle: document.querySelector("[data-selections-toggle]"),
    selectionsPanel: document.querySelector("[data-selections-panel]"),
    templatePropertiesToggle: document.querySelector("[data-template-properties-toggle]"),
    templatePropertiesPanel: document.querySelector("[data-template-properties-panel]"),
    componentPropertiesToggle: document.querySelector("[data-component-properties-toggle]"),
    componentPropertiesPanel: document.querySelector("[data-component-properties-panel]"),
    patternModal: document.getElementById("workbench-pattern-modal"),
    patternCategoryInputs: Array.from(document.querySelectorAll("[data-pattern-category]")),
    patternThumbnails: document.querySelector("[data-pattern-thumbnails]"),
    patternPreview: document.querySelector("[data-pattern-preview]"),
    patternPreviewLabel: document.querySelector("[data-pattern-preview-label]"),
    patternControls: document.querySelector("[data-pattern-controls]"),
    patternInsert: document.querySelector("[data-pattern-insert]"),
    addFontModal: document.getElementById("workbench-add-font-modal"),
    addFontValueInput: document.querySelector("[data-add-font-value]"),
    addFontSubmitButton: document.querySelector("[data-add-font-submit]"),
    addFontWarningElement: document.querySelector("[data-add-font-warning]"),
  });

  // Same shared collapse mechanism as every other tool (Forge/Loom/Press/
  // Sanctum/Orrery) — these three sections used to be wired as raw Bootstrap
  // `data-bs-toggle="collapse"` without the `.collapsible-toggle` class,
  // which meant their chevron icon never rotated on toggle. Template
  // Properties and Component Properties also need programmatic control
  // (renderInspector swaps which one is expanded based on selection — see
  // expandTemplatePropertiesSection/collapseComponentPropertiesSection
  // below), so their bindCollapsibleToggle() return value is kept.
  const applyTemplatePropertiesCollapse = bindCollapsibleToggle(
    elements.templatePropertiesToggle,
    elements.templatePropertiesPanel,
    { collapsed: false }
  );
  const applyComponentPropertiesCollapse = bindCollapsibleToggle(
    elements.componentPropertiesToggle,
    elements.componentPropertiesPanel,
    { collapsed: true }
  );
  bindCollapsibleToggle(elements.selectionsToggle, elements.selectionsPanel, { collapsed: false });

  const insertComponentAtCanvasRoot = createRootInsertionHandler({
    createItem: (type) => {
      if (!COMPONENT_DEFINITIONS[type]) {
        return null;
      }
      return createComponent(type);
    },
    beforeInsert: (type, component) => {
      const previousSelectedId = state.selectedId || null;
      state.selectedId = component.uid;
      return {
        parentId: "",
        zoneKey: "root",
        index: state.components.length,
        definition: COMPONENT_DEFINITIONS[type],
        previousSelectedId,
      };
    },
    insertItem: (type, component, context) => {
      insertComponent(context.parentId, context.zoneKey, context.index, component);
    },
    createUndoEntry: (type, component, context) => ({
      type: "add",
      templateId: state.template?.id || "",
      component: cloneComponentTree(component),
      parentId: context.parentId,
      zoneKey: context.zoneKey,
      index: context.index,
      previousSelectedId: context.previousSelectedId || null,
    }),
    afterInsert: () => {
      renderCanvas();
      renderInspector();
      expandInspectorPane();
    },
    undoStack,
    status,
    getStatusMessage: (type, component, context) => ({
      message: `${context.definition?.label || type} added to canvas`,
      options: { type: "success", timeout: 1800 },
    }),
  });

  let newTemplateModalInstance = null;
  if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
    const modalElement = document.getElementById("new-template-modal");
    if (modalElement) {
      newTemplateModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
    }
  }

  let templateCreationContext = { mode: "new", duplicateComponents: null, sourceTitle: "" };

  refreshTooltips(document);

  loadSystemRecords();
  loadTemplateRecords();
  initializeSharedTemplateHandling();

  if (elements.templateSelect) {
    const builtinOptions = listBuiltinTemplates().map((tpl) => ({ value: tpl.id, label: tpl.title }));
    populateSelect(elements.templateSelect, builtinOptions, { placeholder: "Select template" });
    elements.templateSelect.addEventListener("change", async () => {
      const selectedId = elements.templateSelect.value;
      if (!selectedId) {
        state.template = null;
        state.components = [];
        state.selectedId = null;
        containerActiveTabs.clear();
        componentCollapsedState.clear();
        componentCounter = 0;
        renderCanvas();
        renderInspector();
        ensureTemplateSelectValue();
        syncTemplateActions();
        return;
      }
      const metadata = templateCatalog.get(selectedId);
      if (!metadata) {
        status.show("Template metadata unavailable.", { type: "warning", timeout: 2200 });
        return;
      }
      if (state.template?.id === selectedId && state.template?.origin === metadata.source) {
        return;
      }
      if (metadata.source === "draft") {
        status.show("Save the template before reloading it.", { type: "info", timeout: 2200 });
        ensureTemplateSelectValue();
        return;
      }
      try {
        let payload = null;
        if (metadata.source === "builtin" && metadata.path) {
          const response = await fetch(metadata.path);
          payload = await response.json();
          markBuiltinAvailable("templates", metadata.id || selectedId);
        } else {
          const shareToken = metadata.shareToken || "";
          // preferLocal: false — same reasoning as workbench-character-
          // view.js's own template fetch: this is a load-then-edit round
          // trip, and a stale local copy would silently shadow anything
          // saved elsewhere (Loom, a direct data fix, another tab).
          const result = await dataManager.get("templates", selectedId, {
            preferLocal: false,
            shareToken,
          });
          payload = result?.payload || null;
        }
        if (!payload) {
          throw new Error("Template payload missing");
        }
        const label = payload.title || metadata.title || selectedId;
        const schema = payload.schema || payload.system || metadata.schema || "";
        registerTemplateRecord(
          {
            id: payload.id || selectedId,
            title: label,
            schema,
            source: metadata.source || "remote",
            path: metadata.path,
            shareToken: metadata.shareToken,
          },
          { syncOption: true }
        );
        applyTemplateData(payload, {
          origin: metadata.source || "remote",
          emitStatus: true,
          statusMessage: `Loaded ${label}`,
          shareToken: metadata.shareToken || "",
        });
      } catch (error) {
        console.error("Unable to load template", error);
        if (metadata.source === "builtin") {
          markBuiltinMissing("templates", metadata.id || selectedId);
        }
        status.show("Failed to load template", { type: "error", timeout: 2500 });
      }
    });
  }

  // Named once, used everywhere a Container's column/row count is clamped
  // (zone-building, the canvas preview, and the inspector's steppers) —
  // previously these were 4 separate magic-number literals (1-4 for
  // columns, 1-6 for rows) that had to be kept in sync by hand.
  const MAX_CONTAINER_COLUMNS = 9;
  const MAX_CONTAINER_ROWS = 9;
  // Matches Press's own Repeater column-count range.
  const MAX_REPEATER_COLUMNS = 8;

  const COMPONENT_DEFINITIONS = {
    input: {
      label: "Input",
      defaults: {
        name: "Input Field",
        variant: "text",
        placeholder: "",
        options: ["Option A", "Option B"],
        rows: 3,
        sourceBinding: "",
        roller: "",
        labelPosition: "top",
      },
      supportsBinding: true,
      supportsFormula: true,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
      supportsLabelPosition: true,
    },
    // Core port of Press's own Repeater — replaces List entirely (a fixed
    // list/cards variant + a raw-JSON textarea at play time) with a real
    // item-template zone: drag in and bind arbitrary components (Text,
    // Image, Icon, ...) exactly like a Container zone, repeated once per
    // resolved array item. See ensureRepeaterZone (this file) and
    // renderRepeaterComponent (workbench-character-view.js). Old saved
    // "array"/List components aren't migrated (their shape has no clean
    // 1:1 mapping to an item template) — same "clean removal, no
    // compatibility shim" call already made for Divider.
    repeater: {
      label: "Repeater",
      defaults: {
        name: "Repeater",
        zones: {},
        // Ported from Press's own Repeater (none/bullet/number/custom —
        // "text" only used for custom, a literal string or an @-bound
        // per-item value). Without this there was no way to build even a
        // simple bulleted list.
        decorator: { type: "none", text: "" },
        // Columns/templateColumns/showHeader — also ported from Press's own
        // Repeater (its "table" mode). See ensureRepeaterZone for the
        // per-column zone keys these drive.
        columns: 1,
        templateColumns: "",
        showHeader: false,
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: [],
    },
    // Full port of Press's own Image component (including its pattern/shape
    // picker — see the brush button in renderImageInspector) — replaces
    // both the old bare-bones Image (just a URL + Fit + a fixed max-height)
    // and the old Divider component entirely (a Divider's whole job — a
    // plain line — is now one of the picker's own Shapes presets,
    // "Horizontal rule", with real color/style/thickness control, so it
    // needed no separate component of its own once Image could do this).
    // `url` is the field name (matching Press exactly); an old saved
    // template's `src` value is still read as a fallback wherever `url` is
    // resolved, so nothing existing breaks — see renderImageInspector/
    // renderImagePreview/renderImageComponent's own comments.
    image: {
      label: "Image",
      defaults: {
        name: "Image",
        url: "https://placekitten.com/320/180",
        alt: "Illustration",
        fit: "cover",
        width: "",
        height: "200px",
        cornerRadius: 0,
        focalX: 50,
        focalY: 50,
        zoom: 1,
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: [],
    },
    // Full port of Press's own Icon component — same ddb-icons.css/
    // Bootstrap Icons search (common/js/lib/icon-picker.js) and the same
    // "iconClass is itself a binding-or-literal string" convention (no
    // separate generic Binding field the way Input/Track/etc. have; typing
    // "@some.path" directly into the Icon field is how a bound icon is
    // authored, exactly like Press).
    icon: {
      label: "Icon",
      defaults: {
        name: "Icon",
        iconClass: "",
        ariaLabel: "",
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: ["foreground"],
    },
    // Renamed from "Label" — a single combined Binding/Text field (its own
    // dedicated inspector control, renderTextInspector, using
    // createBindingFormulaInput's new textKey support) replaces what used
    // to be two separate, redundant controls: the generic Identity
    // section's "Label" field (which specially wrote into draft.text for
    // this type only) and a separate Data-section Binding field. Matches
    // Press's own "Text" component's single "Binding / Text" field exactly.
    // supportsBinding/supportsFormula are false here specifically to
    // suppress the GENERIC Data section (createDataControls) from also
    // rendering its own redundant binding control — resolveComponentValue
    // doesn't consult these flags at all, so formula/binding still resolve
    // normally at render time regardless.
    text: {
      label: "Text",
      defaults: {
        name: "Text",
        text: "Text",
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
    container: {
      label: "Container",
      defaults: {
        name: "Container",
        // Only 2 variants now — Grid (which also covers what used to be
        // separate "Columns"/"Rows" types: a Columns-only layout is a Grid
        // with rows:1, a Rows-only layout is a Grid with columns:1) and
        // Tabs. See normalizeContainerType, which migrates any legacy
        // "columns"/"rows" value on an already-saved template in place.
        containerType: "grid",
        columns: 2,
        rows: 1,
        templateColumns: "",
        templateRows: "",
        tabLabels: ["Tab 1", "Tab 2"],
        gap: 16,
        zones: {},
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
    track: {
      label: "Track",
      defaults: {
        name: "Track",
        // Linear vs. Circular is now a variant of one component (see the
        // "Shape" selector in renderTrackInspector) rather than two
        // separate, byte-for-byte-identical-except-label types.
        trackShape: "linear",
        segments: 6,
        segmentBinding: "6",
        segmentFormula: "",
        value: 3,
        labelPosition: "top",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
      supportsLabelPosition: true,
    },
    "select-group": {
      label: "Select Group",
      defaults: {
        name: "Select Group",
        variant: "pills",
        multiple: false,
        sourceBinding: "",
        labelPosition: "top",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
      supportsLabelPosition: true,
    },
    toggle: {
      label: "Toggle",
      defaults: {
        name: "Toggle",
        states: ["Novice", "Skilled", "Expert"],
        activeIndex: 0,
        shape: "circle",
        statesBinding: "",
        value: "Novice",
        labelPosition: "top",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
      supportsLabelPosition: true,
    },
  };

  let componentCounter = 0;

  const renderPreview = createJsonPreviewRenderer({
    resolvePreviewElement: () => elements.jsonPreview,
    resolveBytesElement: () => elements.jsonPreviewBytes,
    serialize: serializeTemplateState,
  });

  function getActiveTabIndex(component, total = 0) {
    if (!component?.uid) return 0;
    const current = containerActiveTabs.get(component.uid) ?? 0;
    if (!Number.isFinite(total) || total <= 0) {
      return Math.max(0, current);
    }
    const maxIndex = Math.max(0, total - 1);
    return Math.min(Math.max(0, current), maxIndex);
  }

  function setActiveTabIndex(component, index) {
    if (!component?.uid) return;
    containerActiveTabs.set(component.uid, Math.max(0, index));
  }

  function clearActiveTab(component) {
    if (!component?.uid) return;
    containerActiveTabs.delete(component.uid);
  }

  const COLOR_FIELD_MAP = {
    foreground: { label: "Foreground", prop: "textColor" },
    background: { label: "Background", prop: "backgroundColor" },
    border: { label: "Border", prop: "borderColor" },
  };

  // Matches Press's own border-style option list exactly (press/index.html).
  const BORDER_STYLE_OPTIONS = [
    { value: "solid", label: "Solid" },
    { value: "dashed", label: "Dashed" },
    { value: "dotted", label: "Dotted" },
    { value: "double", label: "Double" },
    { value: "groove", label: "Groove" },
    { value: "ridge", label: "Ridge" },
    { value: "inset", label: "Inset" },
    { value: "outset", label: "Outset" },
    { value: "none", label: "None" },
  ];

  const DEFAULT_BORDER_SIDES = { top: true, right: true, bottom: true, left: true };

  function getComponentLabel(component, fallback = "") {
    if (!component) return fallback || "";
    const { type } = component;

    if (Object.prototype.hasOwnProperty.call(component, "label")) {
      const value = typeof component.label === "string" ? component.label.trim() : "";
      if (value) return value;
      return "";
    }

    const candidates = [component.name, component.text];
    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }

    const definition = type ? COMPONENT_DEFINITIONS[type] : null;
    if (definition?.label) {
      return definition.label;
    }

    return fallback || "";
  }

  function componentHasFormula(component, { formulaKey = "formula" } = {}) {
    if (!formulaKey) {
      return false;
    }
    const value = component && typeof component[formulaKey] === "string" ? component[formulaKey] : "";
    return normalizeBindingValue(value).length > 0;
  }

  function getBindingEditorValue(component, { bindingKey = "binding", formulaKey = "formula", textKey = null } = {}) {
    if (!component || typeof component !== "object") {
      return "";
    }
    if (componentHasFormula(component, { formulaKey })) {
      const expression = normalizeBindingValue(component[formulaKey]);
      return expression ? `=${expression}` : "";
    }
    const boundValue = bindingKey ? normalizeBindingValue(component[bindingKey]) : "";
    if (boundValue) {
      return boundValue;
    }
    if (textKey && typeof component[textKey] === "string") {
      return component[textKey];
    }
    return "";
  }

  function getComponentBindingLabel(component) {
    return getBindingEditorValue(component);
  }

  function getComponentRollerLabel(component) {
    if (!component || typeof component.roller !== "string") {
      return "";
    }
    const trimmed = component.roller.trim();
    return trimmed || "";
  }

  function getDefinition(component) {
    if (!component) return {};
    return COMPONENT_DEFINITIONS[component.type] || {};
  }

  function getColorControls(component) {
    const definition = getDefinition(component);
    if (Array.isArray(definition.colorControls)) {
      return definition.colorControls.filter((key) => COLOR_FIELD_MAP[key]);
    }
    return Object.keys(COLOR_FIELD_MAP);
  }

  function componentHasTextControls(component) {
    const definition = getDefinition(component);
    if (definition.textControls === false) {
      return false;
    }
    return true;
  }

  if (elements.palette) {
    initPaletteInteractions(elements.palette, {
      groupName: "template-canvas",
      dataAttribute: "data-component-type",
      onActivate: ({ value }) => {
        if (!value || !COMPONENT_DEFINITIONS[value]) {
          return;
        }
        if (!hasActiveTemplate()) {
          status.show("Create or load a template before adding components.", {
            type: "warning",
            timeout: 2400,
          });
          return;
        }
        const metadata = getTemplateMetadata(state.template?.id);
        if (!templateAllowsEdits(metadata)) {
          const message = describeTemplateEditRestriction(metadata);
          status.show(message, { type: "warning", timeout: 2800 });
          return;
        }
        if (!dataManager.hasWriteAccess("templates")) {
          const required = dataManager.describeRequiredWriteTier("templates");
          const message = required
            ? `Saving templates requires a ${required} tier.`
            : "Your tier cannot save templates.";
          status.show(message, { type: "warning", timeout: 2800 });
          return;
        }
        insertComponentAtCanvasRoot(value);
      },
    });
  }

  if (elements.canvasRoot) {
    elements.canvasRoot.addEventListener("click", (event) => {
      const deleteButton = event.target.closest('[data-action="remove-component"]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        removeComponent(deleteButton.dataset.componentId);
        return;
      }
      const target = event.target.closest("[data-component-id]");
      if (!target) return;
      selectComponent(target.dataset.componentId);
    });
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof HTMLElement)) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    const tagName = target.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
      return true;
    }
    return false;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Delete") {
      return;
    }
    if (event.defaultPrevented) {
      return;
    }
    const active = document.activeElement;
    if (isEditableTarget(active)) {
      return;
    }
    if (!state.selectedId) {
      return;
    }
    removeComponent(state.selectedId);
  });

  if (elements.saveButton) {
    elements.saveButton.addEventListener("click", async () => {
      if (!state.template) {
        return;
      }
      const payload = serializeTemplateState();
      const templateId = (payload.id || "").trim();
      if (!templateId) {
        status.show("Set a template ID before saving.", { type: "warning", timeout: 2400 });
        return;
      }
      if (!payload.schema) {
        status.show("Select a system for this template before saving.", { type: "warning", timeout: 2400 });
        return;
      }
      if (!dataManager.hasWriteAccess("templates")) {
        const required = dataManager.describeRequiredWriteTier("templates");
        const message = required
          ? `Saving templates requires a ${required} tier.`
          : "Your tier cannot save templates.";
        status.show(message, { type: "warning", timeout: 2800 });
        return;
      }
      state.template.id = templateId;
      state.template.title = payload.title || templateId;
      state.template.schema = payload.schema;
      const wantsRemote = dataManager.isAuthenticated();
      if (wantsRemote && !dataManager.baseUrl) {
        status.show("Server connection not configured. Start the Workbench server to save.", {
          type: "error",
          timeout: 3000,
        });
        return;
      }
      const button = elements.saveButton;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      const requireRemote = dataManager.isAuthenticated() && dataManager.hasWriteAccess("templates");
      try {
        const result = await dataManager.save("templates", templateId, payload, {
          mode: wantsRemote ? "remote" : "auto",
        });
        const savedToServer = result?.source === "remote";
        state.template.origin = savedToServer ? "remote" : "local";
        const user = sessionUser();
        const ownership = savedToServer ? "owned" : state.template.origin || "draft";
        state.template.ownership = ownership;
        state.template.permissions = savedToServer ? "edit" : "";
        if (savedToServer && user) {
          state.template.ownerId = user.id ?? null;
          state.template.ownerUsername = user.username || "";
        }
        registerTemplateRecord(
          {
            id: templateId,
            title: payload.title || templateId,
            schema: payload.schema,
            source: state.template.origin,
            shareToken: state.template.shareToken || "",
            ownership,
            permissions: savedToServer ? "edit" : undefined,
            ownerId: savedToServer ? user?.id ?? null : undefined,
            ownerUsername: savedToServer ? user?.username || "" : undefined,
          },
          { syncOption: true }
        );
        ensureTemplateSelectValue();
        undoStack.push({
          type: "save",
          templateId: state.template?.id || "",
          count: state.components.length,
        });
        // Must run before syncTemplateActions() below — it updates
        // lastSavedTemplateSignature, which is exactly what
        // hasUnsavedTemplateChanges() (called from syncTemplateActions)
        // compares against. Calling them in the other order (as this used
        // to) left the Save button looking dirty/enabled right after a
        // successful save, since it evaluated against the pre-save
        // signature a moment too early.
        if (savedToServer || !requireRemote) {
          markTemplateClean();
        }
        syncTemplateActions();
        // The Play/Edit tab loads its own separate copy of a template when
        // a character is loaded and never re-fetches it afterward — saving
        // an edit here used to leave that copy silently stale until a full
        // page reload. workbench.js listens for this and force-reloads the
        // template if the currently-open character actually uses it (see
        // workbench-character-view.js's reloadTemplateIfActive).
        window.dispatchEvent(
          new CustomEvent("workbench:template-saved", { detail: { templateId } })
        );
        const label = payload.title || templateId;
        if (savedToServer) {
          status.show(`Saved ${label} to the server`, { type: "success", timeout: 2500 });
        } else {
          status.show(`Saved ${label} locally. Log in to sync with the server.`, {
            type: "info",
            timeout: 3000,
          });
        }
      } catch (error) {
        console.error("Failed to save template", error);
        const message = error?.message || "Unable to save template";
        status.show(message, { type: "error", timeout: 3000 });
      } finally {
        // Not a blind `button.disabled = false` — syncTemplateActions()
        // (already called above on the success path) is the single source
        // of truth for whether the button should be enabled, and that call
        // correctly disables it once there are no more unsaved changes.
        // Unconditionally re-enabling here overrode that a moment later,
        // which is exactly why Save looked un-dirty-gated: a successful
        // save always left the button clickable again regardless of
        // whether there was anything left to save. Calling it again here
        // (rather than skipping this block) still correctly re-enables the
        // button on a failed save, since the template is still dirty then.
        syncTemplateActions();
        button.removeAttribute("aria-busy");
      }
    });
  }

  if (elements.undoButton) {
    elements.undoButton.addEventListener("click", () => {
      undo();
    });
  }

  if (elements.redoButton) {
    elements.redoButton.addEventListener("click", () => {
      redo();
    });
  }

  if (elements.clearButton) {
    elements.clearButton.addEventListener("click", () => {
      clearCanvas();
    });
  }

  if (elements.exportButton) {
    elements.exportButton.addEventListener("click", () => {
      status.show("Export coming soon", { type: "info", timeout: 2000 });
    });
  }

  async function handleDeleteTemplateRequest() {
    if (!state.template?.id) {
      status.show("Select a template before deleting.", { type: "warning", timeout: 2000 });
      return;
    }
    if (state.template.origin === "builtin") {
      status.show("Built-in templates cannot be deleted.", { type: "info", timeout: 2200 });
      return;
    }
    if (state.template.origin === "draft") {
      status.show("Save the template before deleting it.", { type: "info", timeout: 2200 });
      return;
    }
    const label = state.template.title || state.template.id;
    if (!confirmDelete({ label })) {
      return;
    }
    const wantsRemote = dataManager.isAuthenticated() && Boolean(dataManager.baseUrl);
    try {
      await dataManager.delete("templates", state.template.id, { mode: wantsRemote ? "remote" : "auto" });
      removeTemplateRecord(state.template.id);
      state.template = null;
      state.components = [];
      state.selectedId = null;
      containerActiveTabs.clear();
      componentCollapsedState.clear();
      componentCounter = 0;
      markTemplateClean();
      ensureTemplateSelectValue();
      renderCanvas();
      renderInspector();
      syncTemplateActions();
      status.show(`Deleted ${label}`, { type: "success", timeout: 2200 });
    } catch (error) {
      console.error("Failed to delete template", error);
      const message = error?.message || "Unable to delete template";
      status.show(message, { type: "error", timeout: 3000 });
    }
  }

  if (elements.deleteTemplateButton) {
    elements.deleteTemplateButton.addEventListener("click", () => {
      handleDeleteTemplateRequest();
    });
  }

  if (elements.newTemplateButton) {
    elements.newTemplateButton.addEventListener("click", (event) => {
      if (!elements.newTemplateButton.contains(event.target)) {
        return;
      }
      startBlankTemplateDraft();
    });
  }

  if (elements.duplicateTemplateButton) {
    elements.duplicateTemplateButton.addEventListener("click", () => {
      if (!state.template) {
        return;
      }
      const baseTemplate = state.template;
      const sourceTitle = baseTemplate.title || baseTemplate.id || "template";
      if (newTemplateModalInstance && elements.newTemplateForm) {
        prepareNewTemplateForm({ mode: "duplicate", seedTemplate: baseTemplate });
        newTemplateModalInstance.show();
        return;
      }
      const suggestedId = generateDuplicateTemplateId(baseTemplate.id || baseTemplate.title || "template");
      const idInput = window.prompt("Enter a template ID", suggestedId || baseTemplate.id || "");
      if (!idInput) {
        return;
      }
      const suggestedTitle = generateDuplicateTemplateTitle(baseTemplate.title || baseTemplate.id || "Template");
      const titleInput = window.prompt("Enter a template title", suggestedTitle) || "";
      if (!titleInput) {
        return;
      }
      const versionInput = window.prompt("Enter a version", baseTemplate.version || "0.1") || baseTemplate.version || "0.1";
      const schema = baseTemplate.schema || "";
      if (!schema) {
        status.show("Templates must reference a system.", { type: "warning", timeout: 2400 });
        return;
      }
      const components = cloneComponentCollection(state.components);
      startNewTemplate({
        id: idInput.trim(),
        title: titleInput.trim(),
        version: (versionInput || "0.1").trim() || "0.1",
        schema: schema.trim(),
        description: baseTemplate.description || "",
        type: baseTemplate.type || "sheet",
        origin: "draft",
        components,
        markClean: false,
        statusMessage: `Duplicated ${sourceTitle}`,
      });
    });
  }

  if (elements.newTemplateForm) {
    elements.newTemplateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = elements.newTemplateForm;
      if (typeof form.reportValidity === "function" && !form.reportValidity()) {
        form.classList.add("was-validated");
        return;
      }
      const id = (elements.newTemplateId?.value || "").trim();
      const title = (elements.newTemplateTitle?.value || "").trim();
      const version = ((elements.newTemplateVersion?.value || "0.1").trim() || "0.1");
      const schema = (elements.newTemplateSystem?.value || "").trim();
      if (!id || !title || !schema) {
        form.classList.add("was-validated");
        return;
      }
      const mode = form.dataset.mode || templateCreationContext.mode || "new";
      const isDuplicate = mode === "duplicate" && templateCreationContext.mode === "duplicate";
      const components = isDuplicate && Array.isArray(templateCreationContext.duplicateComponents)
        ? cloneComponentCollection(templateCreationContext.duplicateComponents)
        : [];
      const sourceTitle = templateCreationContext.sourceTitle || state.template?.title || state.template?.id || title;
      startNewTemplate({
        id,
        title,
        version,
        schema,
        description: "",
        type: "sheet",
        origin: "draft",
        components,
        markClean: !isDuplicate,
        statusMessage: isDuplicate ? `Duplicated ${sourceTitle}` : `Started ${title || id}`,
      });
      templateCreationContext = { mode: "new", duplicateComponents: null, sourceTitle: "" };
      form.dataset.mode = "new";
      if (newTemplateModalInstance) {
        newTemplateModalInstance.hide();
      }
      form.reset();
      form.classList.remove("was-validated");
    });
  }

  // Awaited before the first render — a template that already uses a
  // custom/Google font needs the shared library populated (so
  // findFontOptionByFamily/ensureFontLoaded in applyTextFormatting can
  // actually find and load it) before that first paint, not just from
  // whenever the Font field's own dropdown happens to load it lazily.
  await loadCustomFonts();
  renderCanvas();
  renderInspector();
  ensureTemplateSelectValue();
  syncTemplateActions();
  initPatternModal();
  initAddFontModal();

  function renderCanvas() {
    if (!elements.canvasRoot) return;
    // Cascades to every component that leaves its own Font field unset via
    // ordinary CSS inheritance — no per-component rendering code needs to
    // know about this at all (see the base font's own doc comment in
    // font-library.js).
    elements.canvasRoot.style.fontFamily = state.template?.baseFontFamily || DEFAULT_FONT_FAMILY;
    elements.canvasRoot.innerHTML = "";
    elements.canvasRoot.dataset.dropzone = "root";
    elements.canvasRoot.dataset.dropzoneParent = "";
    elements.canvasRoot.dataset.dropzoneKey = "root";
    if (!state.components.length) {
      const placeholderText = hasActiveTemplate()
        ? "Drag components from the palette into the canvas below to design your template."
        : "Create or load a template to start adding components to the canvas.";
      const placeholder = createCanvasPlaceholder(placeholderText, {
        variant: "root",
      });
      elements.canvasRoot.appendChild(placeholder);
    } else {
      const fragment = document.createDocumentFragment();
      state.components.forEach((component) => {
        fragment.appendChild(createComponentElement(component));
      });
      elements.canvasRoot.appendChild(fragment);
    }
    setupDropzones(elements.canvasRoot, dropzones, {
      groupName: "template-canvas",
      sortableOptions: {
        onAdd(event) {
          handleDrop(event);
        },
        onUpdate(event) {
          handleReorder(event);
        },
      },
    });
    refreshTooltips(elements.canvasRoot);
    renderPreview();
    syncTemplateActions();
  }

  function serializeTemplateState() {
    return {
      id: state.template?.id || "",
      title: state.template?.title || "",
      version: state.template?.version || "0.1",
      schema: state.template?.schema || "",
      description: state.template?.description || "",
      type: state.template?.type || "sheet",
      components: state.components.map(serializeComponentForPreview),
    };
  }

  function computeTemplateSignature() {
    try {
      return JSON.stringify(serializeTemplateState());
    } catch (error) {
      console.warn("Template editor: unable to compute template signature", error);
      return null;
    }
  }

  function markTemplateClean() {
    lastSavedTemplateSignature = computeTemplateSignature();
  }

  function hasUnsavedTemplateChanges() {
    const current = computeTemplateSignature();
    if (!lastSavedTemplateSignature) {
      return Boolean(current);
    }
    return current !== lastSavedTemplateSignature;
  }

  function serializeComponentForPreview(component) {
    const clone = JSON.parse(JSON.stringify(component));
    stripComponentMetadata(clone);
    return clone;
  }

  function stripComponentMetadata(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if ("uid" in node) {
      delete node.uid;
    }
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach(stripComponentMetadata);
      } else if (value && typeof value === "object") {
        stripComponentMetadata(value);
      }
    });
  }

  function registerTemplateRecord(record, { syncOption = true } = {}) {
    if (!record || !record.id) {
      return;
    }
    const current = templateCatalog.get(record.id) || {};
    const next = { ...current, ...record };
    next.id = record.id;
    if (record.schema === undefined && current.schema) {
      next.schema = current.schema;
    }
    if (record.ownership === undefined && current.ownership !== undefined) {
      next.ownership = current.ownership;
    }
    if (record.permissions === undefined && current.permissions !== undefined) {
      next.permissions = current.permissions;
    }
    if (record.ownerId === undefined && current.ownerId !== undefined) {
      next.ownerId = current.ownerId;
    }
    if (record.ownerUsername === undefined && current.ownerUsername !== undefined) {
      next.ownerUsername = current.ownerUsername;
    }
    if (!next.ownership) {
      const fallbackOwnership =
        (typeof record.ownership === "string" && record.ownership) ||
        (typeof current.ownership === "string" && current.ownership) ||
        (typeof record.source === "string" && record.source) ||
        (typeof current.source === "string" && current.source) ||
        "";
      next.ownership = fallbackOwnership;
    }
    templateCatalog.set(record.id, next);
    if (syncOption) {
      ensureTemplateOption(record.id);
    }
  }

  function verifyBuiltinTemplateAvailability(template) {
    if (!template || !template.id || !template.path) {
      return;
    }
    if (builtinIsTemporarilyMissing("templates", template.id)) {
      removeTemplateRecord(template.id);
      return;
    }
    if (dataManager.baseUrl) {
      // The API exposes builtin availability so avoid issuing redundant
      // fetch requests that would result in console 404s when an asset is
      // missing on the server.
      return;
    }
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return;
    }
    window
      .fetch(template.path, { method: "GET", cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          markBuiltinMissing("templates", template.id);
          removeTemplateRecord(template.id);
          return;
        }
        markBuiltinAvailable("templates", template.id);
        try {
          response.body?.cancel?.();
        } catch (error) {
          console.warn("Template editor: unable to cancel builtin template fetch", error);
        }
      })
      .catch((error) => {
        console.warn("Template editor: failed to verify builtin template", template.id, error);
        markBuiltinMissing("templates", template.id);
        removeTemplateRecord(template.id);
      });
  }

  function removeTemplateRecord(id) {
    if (!id) {
      return;
    }
    templateCatalog.delete(id);
    removeTemplateOption(id);
  }

  function removeTemplateOption(id) {
    if (!elements.templateSelect || !id) {
      return;
    }
    const escaped = escapeCss(id);
    const option = escaped ? elements.templateSelect.querySelector(`option[value="${escaped}"]`) : null;
    if (option) {
      option.remove();
    }
  }

  function verifyBuiltinSystemAvailability(system) {
    if (!system || !system.id || !system.path) {
      return;
    }
    if (builtinIsTemporarilyMissing("systems", system.id)) {
      removeSystemRecord(system.id);
      return;
    }
    if (dataManager.baseUrl) {
      // Trust the server catalog when available to avoid noisy 404
      // requests for builtin systems that have been removed.
      return;
    }
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return;
    }
    window
      .fetch(system.path, { method: "GET", cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          markBuiltinMissing("systems", system.id);
          removeSystemRecord(system.id);
          return;
        }
        markBuiltinAvailable("systems", system.id);
        try {
          response.body?.cancel?.();
        } catch (error) {
          console.warn("Template editor: unable to cancel builtin system fetch", error);
        }
      })
      .catch((error) => {
        console.warn("Template editor: failed to verify builtin system", system.id, error);
        markBuiltinMissing("systems", system.id);
        removeSystemRecord(system.id);
      });
  }

  function registerSystemRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const current = systemCatalog.get(record.id) || {};
    const next = { ...current, ...record };
    if (record.ownership === undefined && current.ownership !== undefined) {
      next.ownership = current.ownership;
    }
    if (record.permissions === undefined && current.permissions !== undefined) {
      next.permissions = current.permissions;
    }
    if (record.ownerId === undefined && current.ownerId !== undefined) {
      next.ownerId = current.ownerId;
    }
    if (record.ownerUsername === undefined && current.ownerUsername !== undefined) {
      next.ownerUsername = current.ownerUsername;
    }
    if (!next.ownership) {
      const fallbackOwnership =
        (typeof record.ownership === "string" && record.ownership) ||
        (typeof current.ownership === "string" && current.ownership) ||
        (typeof record.source === "string" && record.source) ||
        (typeof current.source === "string" && current.source) ||
        "";
      next.ownership = fallbackOwnership;
    }
    if (record.payload) {
      next.payload = record.payload;
      systemDefinitionCache.set(record.id, record.payload);
    }
    systemCatalog.set(record.id, next);
    refreshTemplateOptionsForSystem(record.id);
  }

  function removeSystemRecord(id) {
    if (!id) {
      return;
    }
    systemCatalog.delete(id);
    systemDefinitionCache.delete(id);
    refreshNewTemplateSystemOptions(elements.newTemplateSystem?.value || "");
    refreshTemplateOptionsForSystem(id);
  }

  function refreshNewTemplateSystemOptions(selectedValue = "") {
    if (!elements.newTemplateSystem) {
      return;
    }
    const options = Array.from(systemCatalog.values())
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }))
      .filter((option) => option.value)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    populateSelect(elements.newTemplateSystem, options, { placeholder: "Select system" });
    if (selectedValue) {
      elements.newTemplateSystem.value = selectedValue;
    }
  }

  async function fetchSystemDefinition(schemaId) {
    if (!schemaId) {
      return null;
    }
    if (systemDefinitionCache.has(schemaId)) {
      return systemDefinitionCache.get(schemaId);
    }
    const metadata = systemCatalog.get(schemaId) || {};
    if (metadata.payload) {
      systemDefinitionCache.set(schemaId, metadata.payload);
      return metadata.payload;
    }
    if (metadata.path) {
      try {
        const response = await fetch(metadata.path);
        if (!response.ok) {
          throw new Error(`Failed to fetch system: ${response.status}`);
        }
        const payload = await response.json();
        systemDefinitionCache.set(schemaId, payload);
        registerSystemRecord({ id: schemaId, title: payload.title || schemaId, source: metadata.source, payload });
        return payload;
      } catch (error) {
        console.warn("Template editor: unable to load builtin system", error);
        return null;
      }
    }
    // Network first, local cache only as an offline fallback — see the
    // matching fetchSystemDefinition in workbench-character-view.js for why
    // a System definition specifically shouldn't ever let a stale local
    // cache silently win over a reachable server.
    if (dataManager.baseUrl) {
      try {
        const result = await dataManager.get("systems", schemaId, { preferLocal: false });
        const payload = result?.payload || null;
        if (payload) {
          systemDefinitionCache.set(schemaId, payload);
          registerSystemRecord({ id: schemaId, title: payload.title || schemaId, source: result?.source || "remote", payload });
          return payload;
        }
      } catch (error) {
        console.warn("Template editor: unable to fetch system, trying local cache", error);
      }
    }
    try {
      const local = dataManager.getLocal("systems", schemaId);
      if (local) {
        systemDefinitionCache.set(schemaId, local);
        registerSystemRecord({ id: schemaId, title: local.title || schemaId, source: "local", payload: local });
        return local;
      }
    } catch (error) {
      console.warn("Template editor: unable to read local system", error);
    }
    return null;
  }

  async function updateSystemContext(schemaId) {
    state.systemDefinition = null;
    state.systemPreviewData = {};
    state.bindingFields = [];

    if (!schemaId) {
      emitBindingFieldsReady("");
      renderInspector();
      renderCanvas();
      return;
    }

    try {
      const definition = await fetchSystemDefinition(schemaId);
      if (definition) {
        state.systemDefinition = definition;
        state.systemPreviewData = buildSystemPreviewData(definition);
        state.bindingFields = collectSystemFields(definition);
      } else {
        state.systemPreviewData = {};
      }
    } catch (error) {
      console.warn("Template editor: unable to prepare system bindings", error);
    }

    emitBindingFieldsReady(schemaId);
    renderInspector();
    renderCanvas();
  }

  function resolveDefaultTemplateSchema() {
    if (state.template?.schema) {
      return state.template.schema;
    }
    const systemEntries = Array.from(systemCatalog.values());
    const firstSystem = systemEntries.find((entry) => entry?.id);
    return firstSystem?.id || "";
  }

  function deriveTemplateIdFromTitle(title, { excludeId = "" } = {}) {
    const base = (title || "template").toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "template";
    const prefix = `tpl.${slug}`;
    let candidate = prefix;
    let counter = 2;
    while (templateCatalog.has(candidate) && candidate !== excludeId) {
      candidate = `${prefix}-${counter}`;
      counter += 1;
    }
    return candidate;
  }

  function syncTemplateRecord({ previousId = "" } = {}) {
    if (!state.template?.id) {
      return;
    }
    if (previousId && previousId !== state.template.id) {
      removeTemplateRecord(previousId);
    }
    registerTemplateRecord(
      {
        id: state.template.id,
        title: state.template.title || state.template.id,
        schema: state.template.schema || "",
        source: state.template.origin || "",
        ownership: state.template.ownership || state.template.origin || "",
        permissions: state.template.permissions || "edit",
      },
      { syncOption: true }
    );
    ensureTemplateSelectValue();
    updateTemplateMeta();
  }

  function expandTemplatePropertiesSection() {
    applyTemplatePropertiesCollapse(false);
  }

  function collapseTemplatePropertiesSection() {
    applyTemplatePropertiesCollapse(true);
  }

  function expandComponentPropertiesSection() {
    applyComponentPropertiesCollapse(false);
  }

  function collapseComponentPropertiesSection() {
    applyComponentPropertiesCollapse(true);
  }

  function prepareNewTemplateForm({ mode = "new", seedTemplate = null } = {}) {
    if (!elements.newTemplateForm) {
      return;
    }
    const isDuplicate = mode === "duplicate" && seedTemplate;
    templateCreationContext = {
      mode: isDuplicate ? "duplicate" : "new",
      duplicateComponents: isDuplicate ? cloneComponentCollection(state.components) : null,
      sourceTitle: isDuplicate ? seedTemplate?.title || seedTemplate?.id || "" : "",
    };
    elements.newTemplateForm.reset();
    elements.newTemplateForm.classList.remove("was-validated");
    elements.newTemplateForm.dataset.mode = templateCreationContext.mode;
    if (elements.newTemplateModalTitle) {
      elements.newTemplateModalTitle.textContent = isDuplicate ? "Duplicate Template" : "Create New Template";
    }
    const defaultVersion = elements.newTemplateVersion?.getAttribute("value") || "0.1";
    if (elements.newTemplateVersion) {
      elements.newTemplateVersion.value = isDuplicate
        ? seedTemplate?.version || defaultVersion
        : defaultVersion;
    }
    const selectedSchema = isDuplicate ? seedTemplate?.schema || "" : "";
    refreshNewTemplateSystemOptions(selectedSchema);
    if (elements.newTemplateSystem) {
      elements.newTemplateSystem.value = selectedSchema;
    }
    if (elements.newTemplateTitle) {
      elements.newTemplateTitle.value = isDuplicate
        ? generateDuplicateTemplateTitle(seedTemplate?.title || seedTemplate?.id || "Template")
        : "";
      if (isDuplicate) {
        elements.newTemplateTitle.select();
      }
    }
    if (elements.newTemplateId) {
      elements.newTemplateId.setCustomValidity("");
      let generatedId = "";
      if (isDuplicate) {
        generatedId = generateDuplicateTemplateId(seedTemplate?.id || seedTemplate?.title || "template");
      } else {
        const seed =
          elements.newTemplateSystem?.value ||
          state.template?.schema ||
          state.template?.title ||
          state.template?.id ||
          "template";
        do {
          generatedId = generateTemplateId(seed || "template");
        } while (generatedId && templateCatalog.has(generatedId));
      }
      elements.newTemplateId.value = generatedId;
      elements.newTemplateId.focus();
      elements.newTemplateId.select();
    }
  }

  function getTemplateMetadata(templateId) {
    if (!templateId) {
      return null;
    }
    return templateCatalog.get(templateId) || null;
  }

  function templateOwnership(metadata) {
    const metaOwnership = metadata?.ownership;
    if (typeof metaOwnership === "string" && metaOwnership) {
      return metaOwnership.toLowerCase();
    }
    const stateOwnership = state.template?.ownership;
    if (typeof stateOwnership === "string" && stateOwnership) {
      return stateOwnership.toLowerCase();
    }
    const origin = state.template?.origin;
    return typeof origin === "string" && origin ? origin.toLowerCase() : "";
  }

  function templatePermissions(metadata) {
    if (metadata && typeof metadata.permissions === "string" && metadata.permissions) {
      return metadata.permissions.toLowerCase();
    }
    if (typeof state.template?.permissions === "string" && state.template.permissions) {
      return state.template.permissions.toLowerCase();
    }
    return "";
  }

  function templateOwnerMatchesCurrentUser(metadata) {
    const ownership = templateOwnership(metadata);
    if (ownership === "local" || ownership === "draft" || ownership === "owned") {
      return true;
    }
    if (!sessionUser() || !dataManager.isAuthenticated()) {
      return false;
    }
    // Fall back to state.template's own owner fields when metadata (a
    // catalog lookup, possibly stale/absent) doesn't carry them — the same
    // reasoning templateOwnership/templatePermissions above already apply.
    const merged = {
      ownerId: metadata?.ownerId ?? metadata?.owner_id ?? state.template?.ownerId ?? null,
      ownerUsername: metadata?.ownerUsername || metadata?.owner_username || state.template?.ownerUsername || "",
    };
    return matchesOwner(merged, { session: dataManager.session });
  }

  function templateAllowsEdits(metadata) {
    if (!state.template?.id) {
      return true;
    }
    const ownership = templateOwnership(metadata);
    if (ownership === "shared") {
      return templatePermissions(metadata) === "edit";
    }
    if (ownership === "public") {
      return templateOwnerMatchesCurrentUser(metadata);
    }
    if (ownership === "owned" || ownership === "local" || ownership === "draft" || ownership === "builtin") {
      return true;
    }
    if (!ownership || ownership === "remote") {
      return templateOwnerMatchesCurrentUser(metadata);
    }
    return templateOwnerMatchesCurrentUser(metadata);
  }

  function describeTemplateEditRestriction(metadata) {
    const ownership = templateOwnership(metadata);
    const permissions = templatePermissions(metadata);
    if (ownership === "shared" && permissions !== "edit") {
      return "This template was shared with you as view-only. Duplicate it to make changes.";
    }
    if (ownership === "public") {
      return "Public templates are view-only. Duplicate it to customize.";
    }
    const ownerLabel = resolveTemplateOwnerLabel(metadata);
    return `Only ${ownerLabel} can save this template.`;
  }

  function resolveTemplateOwnerLabel(metadata) {
    const username =
      metadata?.ownerUsername ||
      metadata?.owner_username ||
      state.template?.ownerUsername ||
      "";
    return username || "the owner";
  }

  function syncTemplateActions() {
    const hasTemplate = Boolean(state.template);
    if (elements.saveButton) {
      const canWrite = dataManager.hasWriteAccess("templates");
      const metadata = getTemplateMetadata(state.template?.id);
      // Same admin bypass resolveDeleteTemplateState already applies to the
      // toolbar Delete button — an admin can edit/save any template
      // regardless of ownership, not just delete it.
      const canEditRecord = dataManager.getUserTier() === "admin" || templateAllowsEdits(metadata);
      const hasChanges = hasTemplate && hasUnsavedTemplateChanges();
      const enabled = hasTemplate && hasChanges && canWrite && canEditRecord;
      elements.saveButton.disabled = !enabled;
      elements.saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
      if (!hasTemplate) {
        elements.saveButton.title = "Create or load a template to save.";
      } else if (!state.template.id || !state.template.schema) {
        elements.saveButton.title = "Add an ID and system before saving.";
      } else if (!canWrite) {
        const required = dataManager.describeRequiredWriteTier("templates");
        elements.saveButton.title = required
          ? `Saving templates requires a ${required} tier.`
          : "Your tier cannot save templates.";
      } else if (!canEditRecord) {
        elements.saveButton.title = describeTemplateEditRestriction(metadata);
      } else if (!hasChanges) {
        elements.saveButton.title = "No changes to save.";
      } else {
        elements.saveButton.removeAttribute("title");
      }
    }

    if (elements.clearButton) {
      const isEmpty = !Array.isArray(state.components) || state.components.length === 0;
      elements.clearButton.disabled = isEmpty;
      elements.clearButton.setAttribute("aria-disabled", isEmpty ? "true" : "false");
      if (isEmpty) {
        elements.clearButton.title = "Canvas is already empty.";
      } else {
        elements.clearButton.removeAttribute("title");
      }
    }

    if (elements.duplicateTemplateButton) {
      const canDuplicate = hasTemplate;
      elements.duplicateTemplateButton.classList.toggle("d-none", !canDuplicate);
      elements.duplicateTemplateButton.disabled = !canDuplicate;
      elements.duplicateTemplateButton.setAttribute("aria-disabled", canDuplicate ? "false" : "true");
    }

    updateTemplateMeta();

    if (elements.deleteTemplateButton) {
      applyDeleteTemplateButtonState(elements.deleteTemplateButton);
    }
  }

  function resolveDeleteTemplateState() {
    const metadata = getTemplateMetadata(state.template?.id);
    const canWrite = dataManager.hasWriteAccess("templates");
    // Deleting is deliberately narrower than editing: an admin can delete any
    // template regardless of ownership, but non-admin gm/creator tiers only
    // get the button for templates they actually own (templateAllowsEdits'
    // usual ownership check) — sharing/public visibility isn't delete access.
    const isAdmin = dataManager.getUserTier() === "admin";
    const canEditRecord = isAdmin || templateAllowsEdits(metadata);
    const hasIdentifier = Boolean(state.template?.id);
    const showDelete = hasIdentifier && canEditRecord && canWrite;
    const origin = state.template?.origin || "";
    const isBuiltin = origin === "builtin";
    const isDraft = origin === "draft";
    const deletable = showDelete && !isBuiltin && !isDraft;
    let title = "";
    if (isBuiltin) {
      title = "Built-in templates cannot be deleted.";
    } else if (isDraft) {
      title = "Save the template before deleting it.";
    }
    return {
      showDelete,
      deletable,
      title,
    };
  }

  function applyDeleteTemplateButtonState(button) {
    if (!button) {
      return;
    }
    const { showDelete, deletable, title } = resolveDeleteTemplateState();
    button.classList.toggle("d-none", !showDelete);
    button.disabled = !deletable;
    button.setAttribute("aria-disabled", deletable ? "false" : "true");
    if (title) {
      button.title = title;
    } else {
      button.removeAttribute("title");
    }
  }

  async function initializeBuiltins() {
    if (dataManager.baseUrl) {
      try {
        const catalog = await dataManager.listBuiltins();
        if (catalog) {
          applyBuiltinCatalog(catalog);
        }
      } catch (error) {
        console.warn("Template editor: unable to load builtin catalog", error);
      }
    }
    registerBuiltinContent();
  }

  function registerBuiltinContent() {
    listBuiltinTemplates().forEach((template) => {
      registerTemplateRecord({
        id: template.id,
        title: template.title,
        path: template.path,
        source: "builtin",
        schema: template.schema || template.system || "",
        ownership: "builtin",
      });
      verifyBuiltinAsset("templates", template, {
        skipProbe: Boolean(dataManager.baseUrl),
        onMissing: () => removeTemplateRecord(template.id),
        onError: (error) => {
          console.warn("Template editor: failed to verify builtin template", template.id, error);
        },
      });
    });
    listBuiltinSystems().forEach((system) => {
      registerSystemRecord({
        id: system.id,
        title: system.title,
        path: system.path,
        source: "builtin",
        ownership: "builtin",
      });
      verifyBuiltinAsset("systems", system, {
        skipProbe: Boolean(dataManager.baseUrl),
        onMissing: () => removeSystemRecord(system.id),
        onError: (error) => {
          console.warn("Template editor: failed to verify builtin system", system.id, error);
        },
      });
    });
  }

  async function loadSystemRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("systems");
      localEntries.forEach((entry) => {
        const { id, payload } = entry;
        if (!id) return;
        if (!dataManager.localEntryBelongsToCurrentUser(entry)) {
          return;
        }
        registerSystemRecord({
          id,
          title: payload?.title || id,
          source: "local",
          payload,
          ownership: "local",
          permissions: "edit",
        });
      });
    } catch (error) {
      console.warn("Template editor: unable to read local systems", error);
    }
    if (!dataManager.baseUrl) {
      refreshNewTemplateSystemOptions(elements.newTemplateSystem?.value || "");
      return;
    }
    try {
      const { remote } = await dataManager.list("systems", { refresh: true, includeLocal: false });
      const owned = Array.isArray(remote?.owned) ? remote.owned : [];
      const adopted = dataManager.adoptLegacyRecords(
        "systems",
        owned.map((entry) => entry?.id).filter(Boolean)
      );
      const session = sessionUser();
      const sessionId = session?.id;
      const sessionUsername = typeof session?.username === "string" ? session.username.toLowerCase() : "";
      adopted.forEach(({ id, payload }) => {
        if (!id) return;
        registerSystemRecord({
          id,
          title: payload?.title || id,
          source: "remote",
          payload,
          ownership: "owned",
          permissions: "edit",
          ownerId: sessionId ?? null,
          ownerUsername: session?.username || "",
        });
      });
      const items = dataManager.collectListEntries(remote);
      items.forEach((item) => {
        if (!item || !item.id) {
          return;
        }
        const rawOwnerId = item.owner_id ?? item.ownerId ?? null;
        const ownerId = rawOwnerId === undefined ? null : rawOwnerId;
        const ownerUsername = item.owner_username || item.ownerUsername || "";
        const permissions = typeof item.permissions === "string" ? item.permissions.toLowerCase() : "";
        const isPublic = Boolean(item.is_public);
        const ownerMatches = (() => {
          if (!session) {
            return false;
          }
          if (ownerId !== null && sessionId !== undefined && sessionId !== null) {
            if (String(ownerId) === String(sessionId)) {
              return true;
            }
          }
          if (ownerUsername && sessionUsername) {
            return ownerUsername.toLowerCase() === sessionUsername;
          }
          return false;
        })();
        const ownership = permissions
          ? "shared"
          : isPublic
          ? "public"
          : ownerMatches
          ? "owned"
          : "remote";
        registerSystemRecord({
          id: item.id,
          title: item.title || item.id,
          source: "remote",
          shareToken: item.shareToken || item.share_token || "",
          ownership,
          permissions: permissions || (ownerMatches ? "edit" : ""),
          ownerId,
          ownerUsername,
        });
      });
    } catch (error) {
      console.warn("Template editor: unable to list systems", error);
    } finally {
      refreshNewTemplateSystemOptions(elements.newTemplateSystem?.value || "");
    }
  }

  async function loadTemplateRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("templates");
      localEntries.forEach((entry) => {
        const { id, payload } = entry;
        if (!id) return;
        if (!dataManager.localEntryBelongsToCurrentUser(entry)) {
          return;
        }
        registerTemplateRecord(
          {
            id,
            title: payload?.title || id,
            schema: payload?.schema || "",
            source: "local",
            ownership: "local",
            permissions: "edit",
          },
          { syncOption: true }
        );
      });
    } catch (error) {
      console.warn("Template editor: unable to read local templates", error);
    }
    if (!dataManager.baseUrl) {
      ensureTemplateSelectValue();
      return;
    }
    try {
      const { remote } = await dataManager.list("templates", { refresh: true, includeLocal: false });
      // The templates bucket also holds Press's print templates now — Workbench's
      // Template editor only ever authors character templates, so anything tagged
      // otherwise (missing category defaults to "character" for legacy records) is
      // filtered out here rather than at the server, matching Loom's Assigned
      // Template picker (populateLibraryTemplateSelect).
      const owned = (Array.isArray(remote?.owned) ? remote.owned : []).filter(
        (entry) => (entry?.category || "character") === "character"
      );
      const adopted = dataManager.adoptLegacyRecords(
        "templates",
        owned.map((entry) => entry?.id).filter(Boolean)
      );
      const session = sessionUser();
      const sessionId = session?.id;
      const sessionUsername = typeof session?.username === "string" ? session.username.toLowerCase() : "";
      adopted.forEach(({ id, payload }) => {
        if (!id) return;
        registerTemplateRecord(
          {
            id,
            title: payload?.title || id,
            schema: payload?.schema || "",
            source: "remote",
            ownership: "owned",
            permissions: "edit",
            ownerId: sessionId ?? null,
            ownerUsername: session?.username || "",
          },
          { syncOption: true }
        );
      });
      const items = dataManager.collectListEntries(remote);
      items.forEach((item) => {
        if (!item || !item.id) {
          return;
        }
        if ((item.category || "character") !== "character") {
          return;
        }
        const rawOwnerId = item.owner_id ?? item.ownerId ?? null;
        const ownerId = rawOwnerId === undefined ? null : rawOwnerId;
        const ownerUsername = item.owner_username || item.ownerUsername || "";
        const permissions = typeof item.permissions === "string" ? item.permissions.toLowerCase() : "";
        const isPublic = Boolean(item.is_public);
        const ownerMatches = (() => {
          if (!session) {
            return false;
          }
          if (ownerId !== null && sessionId !== undefined && sessionId !== null) {
            if (String(ownerId) === String(sessionId)) {
              return true;
            }
          }
          if (ownerUsername && sessionUsername) {
            return ownerUsername.toLowerCase() === sessionUsername;
          }
          return false;
        })();
        const ownership = permissions
          ? "shared"
          : isPublic
          ? "public"
          : ownerMatches
          ? "owned"
          : "remote";
        registerTemplateRecord(
          {
            id: item.id,
            title: item.title || item.id,
            schema: item.schema || "",
            source: "remote",
            shareToken: item.shareToken || item.share_token || "",
            ownership,
            permissions: permissions || (ownerMatches ? "edit" : ""),
            ownerId,
            ownerUsername,
          },
          { syncOption: true }
        );
      });
    } catch (error) {
      console.warn("Template editor: unable to list templates", error);
    } finally {
      ensureTemplateSelectValue();
    }
  }

  function initializeSharedTemplateHandling() {
    if (!pendingSharedTemplate) {
      return;
    }
    void loadPendingSharedTemplate();
  }

  async function loadPendingSharedTemplate() {
    if (!pendingSharedTemplate) {
      return;
    }
    const { id: targetId, shareToken = "" } = pendingSharedTemplate;
    pendingSharedTemplate = null;
    registerTemplateRecord(
      {
        id: targetId,
        title: targetId,
        schema: "",
        source: "remote",
        shareToken,
        ownership: "shared",
        permissions: "view",
      },
      { syncOption: true }
    );
    if (elements.templateSelect) {
      elements.templateSelect.value = targetId;
    }
    try {
      // preferLocal: false — see the other dataManager.get("templates", ...)
      // call in this file for why.
      const result = await dataManager.get("templates", targetId, {
        preferLocal: false,
        shareToken,
      });
      const payload = result?.payload;
      if (!payload) {
        throw new Error("Template payload missing");
      }
      const label = payload.title || templateCatalog.get(targetId)?.title || targetId;
      const schema = payload.schema || payload.system || templateCatalog.get(targetId)?.schema || "";
      registerTemplateRecord(
        { id: payload.id || targetId, title: label, schema, source: "remote", shareToken },
        { syncOption: true },
      );
      applyTemplateData(payload, {
        origin: "remote",
        emitStatus: true,
        statusMessage: `Loaded ${label}`,
        shareToken,
      });
    } catch (error) {
      console.error("Template editor: unable to load shared template", error);
      if (status) {
        status.show(error.message || "Unable to load shared template", { type: "danger" });
      }
    }
  }

  function handleDrop(event) {
    if (!hasActiveTemplate()) {
      status.show("Create or load a template before adding components.", {
        type: "warning",
        timeout: 2400,
      });
      event.item.remove();
      renderCanvas();
      return;
    }
    const metadata = getTemplateMetadata(state.template?.id);
    if (!templateAllowsEdits(metadata)) {
      const message = describeTemplateEditRestriction(metadata);
      status.show(message, { type: "warning", timeout: 2800 });
      event.item.remove();
      renderCanvas();
      return;
    }
    if (!dataManager.hasWriteAccess("templates")) {
      const required = dataManager.describeRequiredWriteTier("templates");
      const message = required
        ? `Saving templates requires a ${required} tier.`
        : "Your tier cannot save templates.";
      status.show(message, { type: "warning", timeout: 2800 });
      event.item.remove();
      renderCanvas();
      return;
    }
    const parentId = event.to.dataset.dropzoneParent || "";
    const zoneKey = event.to.dataset.dropzoneKey || "root";
    const index = typeof event.newIndex === "number" ? event.newIndex : 0;
    const type = event.item.dataset.componentType;
    const componentId = event.item.dataset.componentId;

    if (type && COMPONENT_DEFINITIONS[type]) {
      const component = createComponent(type);
      const previousSelectedId = state.selectedId || null;
      insertComponent(parentId, zoneKey, index, component);
      state.selectedId = component.uid;
      undoStack.push({
        type: "add",
        templateId: state.template?.id || "",
        component: cloneComponentTree(component),
        parentId,
        zoneKey,
        index,
        previousSelectedId,
      });
      status.show(`${COMPONENT_DEFINITIONS[type].label} added to canvas`, { type: "success", timeout: 1800 });
      event.item.remove();
      renderCanvas();
      renderInspector();
      expandInspectorPane();
      return;
    }

    if (componentId) {
      if (parentId && (parentId === componentId || isDescendantOf(parentId, componentId))) {
        status.show("Cannot move a component into itself", { type: "error", timeout: 2000 });
        event.item.remove();
        renderCanvas();
        return;
      }
      const moveResult = moveComponent(componentId, parentId, zoneKey, index);
      if (moveResult.success) {
        undoStack.push({
          type: "move",
          templateId: state.template?.id || "",
          componentId,
          from: moveResult.from,
          to: moveResult.to,
        });
        status.show("Moved component", { timeout: 1500 });
      }
    }

    event.item.remove();
    renderCanvas();
    renderInspector();
  }

  function handleReorder(event) {
    const parentId = event.to.dataset.dropzoneParent || "";
    const zoneKey = event.to.dataset.dropzoneKey || "root";
    const componentId = event.item.dataset.componentId;
    if (!componentId) {
      renderCanvas();
      return;
    }
    const collection = getCollection(parentId, zoneKey);
    if (!collection) {
      renderCanvas();
      return;
    }
    const oldIndex = typeof event.oldIndex === "number" ? event.oldIndex : collection.length - 1;
    const newIndex = typeof event.newIndex === "number" ? event.newIndex : oldIndex;
    if (oldIndex === newIndex) {
      return;
    }
    const found = findComponent(componentId);
    if (!found || found.collection !== collection) {
      renderCanvas();
      return;
    }
    const [item] = collection.splice(oldIndex, 1);
    collection.splice(newIndex, 0, item);
    const finalPosition = findComponent(componentId);
    undoStack.push({
      type: "reorder",
      templateId: state.template?.id || "",
      componentId,
      parentId,
      zoneKey,
      from: { index: oldIndex },
      to: { index: finalPosition ? finalPosition.index : newIndex },
    });
    renderCanvas();
    renderInspector();
  }

  function insertComponent(parentId, zoneKey, index, component) {
    const collection = getCollection(parentId, zoneKey);
    if (!collection) return;
    const safeIndex = Math.min(Math.max(index, 0), collection.length);
    collection.splice(safeIndex, 0, component);
  }

  function moveComponent(componentId, targetParentId, zoneKey, index) {
    const found = findComponent(componentId);
    if (!found) return { success: false };
    const targetCollection = getCollection(targetParentId, zoneKey);
    if (!targetCollection) return { success: false };
    const fromParentId = found.parent?.uid || "";
    const fromZoneKey = found.zoneKey;
    const fromIndex = found.index;
    const [item] = found.collection.splice(found.index, 1);
    let safeIndex = Math.min(Math.max(index, 0), targetCollection.length);
    if (found.collection === targetCollection && fromIndex < safeIndex) {
      safeIndex -= 1;
    }
    targetCollection.splice(safeIndex, 0, item);
    return {
      success: true,
      from: { parentId: fromParentId, zoneKey: fromZoneKey, index: fromIndex },
      to: { parentId: targetParentId, zoneKey, index: safeIndex },
    };
  }

  // Container (Grid/Tabs, N zones) and Repeater (always exactly one zone,
  // its item template — see ensureRepeaterZone below) are the two
  // zone-bearing component types — every zone-aware traversal (drag-drop,
  // selection lookup, pruning, rendering) goes through isZoneContainer/
  // ensureComponentZones rather than checking component.type directly, so
  // a third zone-bearing type later needs no changes at any of these call
  // sites.
  function isZoneContainer(component) {
    return Boolean(component) && (component.type === "container" || component.type === "repeater");
  }

  function ensureComponentZones(component) {
    if (!component) return [];
    if (component.type === "container") return ensureContainerZones(component);
    if (component.type === "repeater") return ensureRepeaterZone(component);
    return [];
  }

  function getCollection(parentId, zoneKey) {
    if (!parentId) {
      return state.components;
    }
    const parent = findComponent(parentId);
    if (!parent) {
      return null;
    }
    const component = parent.component;
    if (!isZoneContainer(component)) {
      return parent.collection;
    }
    ensureComponentZones(component);
    if (!component.zones) {
      component.zones = {};
    }
    if (!component.zones[zoneKey]) {
      component.zones[zoneKey] = [];
    }
    return component.zones[zoneKey];
  }

  function findComponent(uid, components = state.components, parent = null, zoneKey = "root") {
    if (!uid) return null;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component.uid === uid) {
        return { component, collection: components, index, parent, zoneKey };
      }
      if (isZoneContainer(component)) {
        const zones = ensureComponentZones(component);
        for (const zone of zones) {
          const found = findComponent(uid, zone.components, component, zone.key);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function isDescendantOf(targetId, ancestorId) {
    if (!targetId || !ancestorId || targetId === ancestorId) {
      return false;
    }
    const ancestor = findComponent(ancestorId);
    if (!ancestor) return false;
    return containsComponent(ancestor.component, targetId);
  }

  function containsComponent(component, targetId) {
    if (!isZoneContainer(component)) return false;
    const zones = ensureComponentZones(component);
    for (const zone of zones) {
      for (const child of zone.components) {
        if (child.uid === targetId) {
          return true;
        }
        if (isZoneContainer(child) && containsComponent(child, targetId)) {
          return true;
        }
      }
    }
    return false;
  }

  function createComponent(type) {
    const definition = COMPONENT_DEFINITIONS[type];
    if (!definition) {
      throw new Error(`Unknown component type: ${type}`);
    }
    componentCounter += 1;
    const defaults = cloneDefaults(definition.defaults || {});
    const component = {
      uid: `cmp-${componentCounter}`,
      type,
      id: `cmp-${componentCounter}`,
      label: (defaults.label || defaults.name || definition.label || type).trim(),
      name: undefined,
      textColor: "",
      backgroundColor: "",
      borderColor: "",
      borderWidth: 1,
      borderStyle: "solid",
      borderRadius: 0,
      borderSides: { ...DEFAULT_BORDER_SIDES },
      // Raw CSS shorthand strings (e.g. "8px" or "4px 8px 12px 16px"),
      // passed straight through to the real padding/margin CSS properties
      // — no Workbench-specific parsing. Empty means no override, letting
      // the default (see workbench/css/styles.css's .workbench-canvas-card
      // rule) show through.
      padding: "",
      margin: "",
      visibilityBinding: "",
      visibilityFormula: "",
      textSize: "md",
      // Matches Press's own Font/Text Size/Font Size/Line Height system
      // exactly (common/js/lib/font-picker.js, common/js/lib/text-size.js)
      // — fontFamily/lineHeight empty/null means "no override, inherit the
      // natural default"; fontSizeCustom (a pt value), when set, wins over
      // the textSize preset above, same precedence Press uses.
      fontFamily: "",
      fontSizeCustom: null,
      lineHeight: null,
      // Freeform CSS class names (Advanced section) — see
      // common/js/lib/class-name-picker.js's suggestion list.
      className: "",
      textStyles: { bold: false, italic: false, underline: false },
      align: "start",
      binding: "",
      readOnly: false,
      collapsible: false,
      ...defaults,
    };
    if (!Object.prototype.hasOwnProperty.call(component, "binding") || typeof component.binding !== "string") {
      component.binding = typeof component.binding === "string" ? component.binding : "";
    }
    if (definition.supportsFormula !== false && !Object.prototype.hasOwnProperty.call(component, "formula")) {
      component.formula = "";
    }
    if (component.label && typeof component.label === "string") {
      component.label = component.label.trim();
    }
    if (!component.label) {
      component.label = definition.label || type;
    }
    if (component.name === undefined) {
      component.name = component.label;
    }
    if (component.options && Array.isArray(component.options)) {
      component.options = component.options.slice();
    }
    if (component.tabLabels && Array.isArray(component.tabLabels)) {
      component.tabLabels = component.tabLabels.slice();
    }
    if (component.states && Array.isArray(component.states)) {
      component.states = component.states.slice();
    }
    if (typeof component.sourceBinding !== "string") {
      component.sourceBinding = component.sourceBinding != null ? String(component.sourceBinding) : "";
    }
    component.sourceBinding = component.sourceBinding.trim();
    if (typeof component.segmentBinding !== "string") {
      component.segmentBinding = component.segmentBinding != null ? String(component.segmentBinding) : "";
    }
    component.segmentBinding = component.segmentBinding.trim();
    if (typeof component.segmentFormula !== "string") {
      component.segmentFormula = "";
    }
    if (typeof component.statesBinding !== "string") {
      component.statesBinding = component.statesBinding != null ? String(component.statesBinding) : "";
    }
    component.statesBinding = component.statesBinding.trim();
    if (typeof component.roller !== "string") {
      component.roller = "";
    }
    component.roller = component.roller.trim();
    component.collapsible = Boolean(component.collapsible);
    if (definition.supportsLabelPosition) {
      const basePosition =
        typeof component.labelPosition === "string" && component.labelPosition
          ? component.labelPosition
          : defaults.labelPosition || "top";
      component.labelPosition = normalizeLabelPosition(basePosition, "top");
    } else if (Object.prototype.hasOwnProperty.call(component, "labelPosition")) {
      delete component.labelPosition;
    }
    if (component.type === "track") {
      if (!component.segmentBinding) {
        const fallbackSegments = Number.isFinite(Number(component.segments)) ? Number(component.segments) : 6;
        component.segmentBinding = String(fallbackSegments);
      }
      const parsedSegments = Number(component.segmentBinding);
      if (Number.isFinite(parsedSegments)) {
        component.segments = clampInteger(parsedSegments, 1, 16);
      } else if (Number.isFinite(Number(component.segments))) {
        component.segments = clampInteger(component.segments, 1, 16);
      } else {
        component.segments = 6;
      }
      if (component.value === undefined || component.value === null || Number.isNaN(Number(component.value))) {
        component.value = Math.min(component.segments, Math.max(0, Math.ceil(component.segments / 2)));
      }
    }
    if (component.zones && typeof component.zones === "object") {
      component.zones = { ...component.zones };
    }
    if (isZoneContainer(component)) {
      ensureComponentZones(component);
    }
    return component;
  }

  function createComponentElement(component) {
    const definition = COMPONENT_DEFINITIONS[component.type] || {};
    const iconName = COMPONENT_ICONS[component.type] || "tabler:app-window";
    const typeLabel = definition.label || component.type;

    const wrapper = createCanvasCardElement({
      classes: ["template-component"],
      dataset: { componentId: component.uid },
      gapClass: "gap-2",
      selected: state.selectedId === component.uid,
    });
    if (state.selectedId === component.uid) {
      wrapper.classList.add("template-component-selected");
    }

    const { header, actions, iconElement, ensureActions } = createStandardCardChrome({
      icon: iconName,
      iconLabel: typeLabel,
      headerOptions: { classes: ["template-component-header"] },
      actionsOptions: { classes: ["template-component-actions"] },
      iconOptions: {
        classes: ["template-component-icon"],
        attributes: { tabindex: "0" },
      },
      removeButtonOptions: {
        srLabel: "Remove component",
        dataset: { action: "remove-component", componentId: component.uid },
        attributes: { "aria-label": "Remove component" },
      },
    });

    const bindingLabel = getComponentBindingLabel(component);
    let bindingPill = null;
    if (bindingLabel) {
      bindingPill = document.createElement("span");
      bindingPill.className = "template-binding-pill badge text-bg-secondary";
      bindingPill.textContent = bindingLabel;
      if (iconElement && actions.contains(iconElement)) {
        actions.insertBefore(bindingPill, iconElement);
      } else {
        actions.appendChild(bindingPill);
      }
    }

    const rollerLabel = getComponentRollerLabel(component);
    if (rollerLabel) {
      const rollerPill = document.createElement("span");
      rollerPill.className = "template-roller-pill badge text-bg-secondary";
      rollerPill.textContent = `🎲 ${rollerLabel}`;
      const insertBefore = bindingPill && actions.contains(bindingPill) ? bindingPill : iconElement;
      if (insertBefore && actions.contains(insertBefore)) {
        actions.insertBefore(rollerPill, insertBefore);
      } else {
        actions.appendChild(rollerPill);
      }
    }

    if (iconElement) {
      iconElement.tabIndex = 0;
    }

    wrapper.appendChild(header);

    const preview = renderComponentPreview(component);
    const bodyElement = preview instanceof Element ? preview : (() => {
      const container = document.createElement("div");
      container.appendChild(preview);
      return container;
    })();
    const bodyId = toId([component.uid, "content"]);
    if (bodyElement instanceof HTMLElement && bodyId) {
      bodyElement.id = bodyId;
    }
    wrapper.appendChild(bodyElement);

    const collapsible = Boolean(component.collapsible);
    if (collapsible) {
      const key = component.uid || null;
      const collapsed = key ? componentCollapsedState.get(key) === true : false;
      const labelText = getComponentLabel(component, typeLabel) || typeLabel;
      const { button: collapseButton, setCollapsed } = createCollapseToggleButton({
        label: labelText,
        collapsed,
        onToggle(next) {
          if (key) {
            if (next) {
              componentCollapsedState.set(key, true);
            } else {
              componentCollapsedState.delete(key);
            }
          }
          if (bodyElement instanceof HTMLElement) {
            bodyElement.hidden = next;
          }
          wrapper.classList.toggle("is-collapsed", next);
        },
      });
      if (bodyElement instanceof HTMLElement && bodyElement.id) {
        collapseButton.setAttribute("aria-controls", bodyElement.id);
      }
      header.appendChild(collapseButton);
      if (bodyElement instanceof HTMLElement) {
        bodyElement.hidden = collapsed;
      }
      wrapper.classList.toggle("is-collapsed", collapsed);
      setCollapsed(collapsed);
    } else {
      if (component.uid) {
        componentCollapsedState.delete(component.uid);
      }
      if (bodyElement instanceof HTMLElement) {
        bodyElement.hidden = false;
      }
      wrapper.classList.remove("is-collapsed");
    }

    applyComponentStyles(wrapper, component);
    return wrapper;
  }

  function renderComponentPreview(component) {
    switch (component.type) {
      case "input":
        return renderInputPreview(component);
      case "repeater":
        return renderRepeaterPreview(component);
      case "image":
        return renderImagePreview(component);
      case "icon":
        return renderIconPreview(component);
      case "text":
        return renderTextPreview(component);
      case "container":
        return renderContainerPreview(component);
      case "track":
        return renderTrackPreview(component);
      case "select-group":
        return renderSelectGroupComponentPreview(component);
      case "toggle":
        return renderTogglePreview(component);
      default:
        return document.createTextNode("Unsupported component");
    }
  }

  function resolvePreviewBindingValue(binding) {
    const normalized = normalizeBindingValue(binding);
    if (!normalized) {
      return undefined;
    }
    const contexts = [];

    function registerContext(value, { prefixes = [], allowDirect = false } = {}) {
      if (!value || typeof value !== "object") {
        return;
      }
      const normalizedPrefixes = Array.isArray(prefixes)
        ? prefixes
            .map((prefix) => (typeof prefix === "string" ? prefix.trim() : ""))
            .filter((prefix) => prefix.length > 0)
        : [];
      contexts.push({ value, prefixes: normalizedPrefixes, allowDirect: Boolean(allowDirect) });
    }

    const template = state.template && typeof state.template === "object" ? state.template : null;
    if (template) {
      registerContext(template, { allowDirect: true, prefixes: ["template"] });
      registerContext(template.metadata, { prefixes: ["metadata"] });
      registerContext(template.data, { prefixes: ["data"], allowDirect: true });
      registerContext(template.sources, { prefixes: ["sources"], allowDirect: true });
    }

    const systemPreviewData =
      state.systemPreviewData && typeof state.systemPreviewData === "object" ? state.systemPreviewData : null;
    if (systemPreviewData) {
      registerContext(systemPreviewData, {
        allowDirect: true,
        prefixes: ["system", "data", "preview", "sources"],
      });
    }

    const definition = state.systemDefinition && typeof state.systemDefinition === "object" ? state.systemDefinition : null;
    if (definition) {
      registerContext(definition, { allowDirect: true, prefixes: ["system"] });
      registerContext(definition.metadata, { prefixes: ["metadata"] });
      registerContext(definition.definition, { prefixes: ["definition"], allowDirect: true });
      registerContext(definition.schema, { prefixes: ["schema"] });
      registerContext(definition.data, { prefixes: ["data"], allowDirect: true });
      registerContext(definition.sources, { prefixes: ["sources"], allowDirect: true });
      registerContext(definition.preview, { prefixes: ["preview"], allowDirect: true });
      registerContext(definition.samples, { prefixes: ["samples"], allowDirect: true });
      registerContext(definition.sample, { prefixes: ["sample"], allowDirect: true });
      registerContext(definition.values, { prefixes: ["values"], allowDirect: true });
      registerContext(definition.lists, { prefixes: ["lists"], allowDirect: true });
      registerContext(definition.collections, { prefixes: ["collections"], allowDirect: true });
    }

    return resolveBindingFromContexts(normalized, contexts);
  }

  function resolveSelectPreviewOptions(component) {
    const binding = normalizeBindingValue(component?.sourceBinding);
    if (!binding) {
      return [];
    }
    const bound = resolvePreviewBindingValue(binding);
    return normalizeOptionEntries(bound);
  }

  function resolveSelectGroupPreviewOptions(component) {
    const binding = normalizeBindingValue(component?.sourceBinding);
    if (!binding) {
      return [];
    }
    const bound = resolvePreviewBindingValue(binding);
    return normalizeOptionEntries(bound);
  }

  function resolveTogglePreviewStates(component) {
    const binding = normalizeBindingValue(component?.statesBinding);
    if (!binding) {
      return [];
    }
    const bound = resolvePreviewBindingValue(binding);
    return normalizeOptionEntries(bound)
      .map((entry) => entry.label || entry.value)
      .filter((value) => value != null && value !== "");
  }

  function createPreviewEmptyState(message = "Select a source to preview values.") {
    const placeholder = document.createElement("div");
    placeholder.className = "text-body-secondary small fst-italic";
    placeholder.textContent = message;
    return placeholder;
  }

  // Legacy "columns"/"rows" containerType values collapse into "grid" in
  // place — a Columns-only layout is just a Grid with rows:1, a Rows-only
  // layout is just a Grid with columns:1 — so an already-saved template
  // self-heals the first time its container is touched, no separate
  // migration pass needed. Idempotent; safe to call on every render.
  function normalizeContainerType(component) {
    if (!component || component.type !== "container") return;
    const raw = component.containerType;
    if (raw === "columns") {
      component.rows = 1;
      component.containerType = "grid";
    } else if (raw === "rows") {
      component.columns = 1;
      component.containerType = "grid";
    } else if (raw !== "tabs" && raw !== "grid") {
      component.containerType = "grid";
    }
  }

  function ensureContainerZones(component) {
    if (!component || component.type !== "container") return [];
    normalizeContainerType(component);
    if (!component.zones || typeof component.zones !== "object") {
      component.zones = {};
    }
    const zones = [];
    const validKeys = new Set();

    const registerZone = (key, label) => {
      if (!Array.isArray(component.zones[key])) {
        component.zones[key] = [];
      }
      validKeys.add(key);
      zones.push({ key, label, components: component.zones[key] });
    };

    if (component.containerType === "tabs") {
      const labels = Array.isArray(component.tabLabels) && component.tabLabels.length
        ? component.tabLabels
        : ["Tab 1", "Tab 2"];
      labels.forEach((labelText, index) => {
        registerZone(`tab-${index}`, (labelText || `Tab ${index + 1}`).trim() || `Tab ${index + 1}`);
      });
      setActiveTabIndex(component, getActiveTabIndex(component, labels.length));
    } else {
      // "grid" — the only other variant. Rows-major zone order (outer loop
      // rows, inner loop columns) matches CSS Grid's own auto-placement
      // order, so the flat zones list below can just be appended in order
      // with no explicit grid-row/grid-column needed per cell.
      clearActiveTab(component);
      const columns = clampInteger(component.columns || 2, 1, MAX_CONTAINER_COLUMNS);
      const rows = clampInteger(component.rows || 1, 1, MAX_CONTAINER_ROWS);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const label = rows > 1 && columns > 1 ? `Row ${row + 1}, Column ${col + 1}` : rows > 1 ? `Row ${row + 1}` : `Column ${col + 1}`;
          registerZone(`grid-${row}-${col}`, label);
        }
      }
    }

    // Any zone key that's no longer valid (e.g. a legacy "col-N"/"row-N" key
    // from before normalizeContainerType ran, or a shrunk column/row count)
    // has its children salvaged into the first remaining zone rather than
    // discarded — same convention already used when a user shrinks a grid's
    // own column count.
    Object.keys(component.zones).forEach((key) => {
      if (!validKeys.has(key)) {
        const items = component.zones[key];
        if (Array.isArray(items) && items.length && zones.length) {
          zones[0].components.push(...items);
        }
        delete component.zones[key];
      }
    });

    return zones;
  }

  function createDefaultRepeaterHeaderCell(text) {
    const cell = createComponent("text");
    cell.text = text;
    cell.textStyles = { ...(cell.textStyles || {}), bold: true };
    return cell;
  }

  // Repeater's item template and (optional) header row are both authored
  // on canvas exactly like a Container's grid zones — one zone per column,
  // per row-kind, reusing the exact same zones:{key:[]} storage shape and
  // createContainerDropzone/drag-drop machinery Container already has.
  // "item-{col}" zones repeat once per bound array item at render time
  // (workbench-character-view.js's renderRepeaterComponent); "header-{col}"
  // zones (only present when showHeader is on) are authored once and never
  // repeat — this is what makes a real, non-repeating table header
  // possible, which a Container can't do (everything in a Container's
  // zones repeats).
  //
  // Backward compat, self-healing (same pattern as every other legacy
  // normalization in this file): an old saved Repeater has a single flat
  // zones.item array (from before columns/header existed) — migrated here,
  // the first time it's encountered, into zones["item-0"] rather than
  // discarded, so an existing single-column Repeater keeps its exact item
  // template with zero visible change.
  function ensureRepeaterZone(component) {
    if (!component.zones || typeof component.zones !== "object") {
      component.zones = {};
    }
    const columns = clampInteger(component.columns || 1, 1, MAX_REPEATER_COLUMNS);
    component.columns = columns;
    if (Array.isArray(component.zones.item) && !Array.isArray(component.zones["item-0"])) {
      component.zones["item-0"] = component.zones.item;
    }
    delete component.zones.item;

    const zones = [];
    const validKeys = new Set();

    const registerZone = (key, label, { seedText = null } = {}) => {
      if (!Array.isArray(component.zones[key])) {
        component.zones[key] = seedText ? [createDefaultRepeaterHeaderCell(seedText)] : [];
      }
      validKeys.add(key);
      zones.push({ key, label, components: component.zones[key] });
    };

    if (component.showHeader) {
      for (let col = 0; col < columns; col += 1) {
        const label = columns > 1 ? `Header — Column ${col + 1}` : "Header";
        registerZone(`header-${col}`, label, { seedText: `Column ${col + 1}` });
      }
    }
    for (let col = 0; col < columns; col += 1) {
      const label = columns > 1 ? `Item — Column ${col + 1}` : "Item template";
      registerZone(`item-${col}`, label);
    }

    // Shrinking columns salvages the overflow columns' contents into the
    // first remaining zone of the SAME row-kind (header content into the
    // first header zone, item content into the first item zone) rather
    // than discarding them — mirrors ensureContainerZones' own
    // shrink-salvage behavior. Turning the header off specifically does
    // NOT delete its zones' data (left untouched below) so re-enabling it
    // later restores exactly what was there instead of regenerating
    // defaults or losing it.
    Object.keys(component.zones).forEach((key) => {
      if (validKeys.has(key)) return;
      const items = component.zones[key];
      if (!Array.isArray(items) || !items.length) {
        delete component.zones[key];
        return;
      }
      const isHeaderKey = key.startsWith("header-");
      if (!component.showHeader && isHeaderKey) {
        return;
      }
      const salvageTarget = isHeaderKey
        ? zones.find((zone) => zone.key.startsWith("header-"))
        : zones.find((zone) => zone.key.startsWith("item-"));
      if (salvageTarget) {
        salvageTarget.components.push(...items);
      }
      delete component.zones[key];
    });

    return zones;
  }

  function createContainerDropzone(component, zone, { label, hint } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "template-container-zone d-flex flex-column gap-2";
    if (label) {
      const badge = document.createElement("div");
      badge.className = "template-dropzone-label workbench-dropzone-label text-body-secondary text-uppercase extra-small";
      badge.textContent = label;
      wrapper.appendChild(badge);
    }
    const drop = document.createElement("div");
    drop.className = "template-dropzone workbench-dropzone";
    drop.dataset.dropzone = "true";
    drop.dataset.dropzoneParent = component.uid;
    drop.dataset.dropzoneKey = zone.key;
    if (Array.isArray(zone.components) && zone.components.length) {
      zone.components.forEach((child) => {
        drop.appendChild(createComponentElement(child));
      });
    } else {
      const placeholder = createCanvasPlaceholder(hint || "Drag components here", {
        variant: "compact",
      });
      drop.appendChild(placeholder);
    }
    wrapper.appendChild(drop);
    return wrapper;
  }

  function pruneContainerState(component) {
    if (!component) {
      return;
    }
    if (component.uid) {
      componentCollapsedState.delete(component.uid);
    }
    if (!isZoneContainer(component)) {
      return;
    }
    if (component.type === "container") {
      clearActiveTab(component);
    }
    const zoneEntries = component.zones && typeof component.zones === "object"
      ? Object.values(component.zones)
      : [];
    zoneEntries.forEach((items) => {
      if (!Array.isArray(items)) return;
      items.forEach((child) => {
        if (isZoneContainer(child)) {
          pruneContainerState(child);
        } else if (child?.uid) {
          componentCollapsedState.delete(child.uid);
        }
      });
    });
  }

  function renderInputPreview(component) {
    const labelText = getComponentLabel(component, "Input");
    const variant = (component.variant || "text").toLowerCase();
    const previewOptions = resolveSelectPreviewOptions(component);
    let control;
    let labelTag = "label";
    let labelFor = "";
    if (variant === "radio" || variant === "checkbox") {
      control = renderChoiceGroup(component, variant);
      labelTag = "div";
    } else if (variant === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.className = "form-control";
      textarea.rows = clampInteger(component.rows ?? 3, 2, 12);
      textarea.placeholder = component.placeholder || "";
      textarea.disabled = !!component.readOnly;
      labelFor = toId([component.uid, "preview", "textarea"]);
      if (labelFor) {
        textarea.id = labelFor;
      }
      control = textarea;
    } else if (variant === "select") {
      const select = document.createElement("select");
      select.className = "form-select";
      previewOptions.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label || option.value;
        select.appendChild(opt);
      });
      select.disabled = !!component.readOnly;
      labelFor = toId([component.uid, "preview", "select"]);
      if (labelFor) {
        select.id = labelFor;
      }
      control = select;
    } else {
      const input = document.createElement("input");
      input.className = "form-control";
      if (variant === "number") {
        input.type = "number";
      } else {
        input.type = "text";
      }
      input.placeholder = component.placeholder || "";
      input.disabled = !!component.readOnly;
      labelFor = toId([component.uid, "preview", "input"]);
      if (labelFor) {
        input.id = labelFor;
      }
      control = input;
    }
    const field = createLabeledField({
      component,
      control,
      labelText,
      labelTag,
      labelFor,
      labelClasses: ["form-label", "mb-1"],
      applyFormatting: applyTextFormatting,
    });
    if (variant === "select" && !previewOptions.length) {
      const container = document.createElement("div");
      container.className = "d-flex flex-column gap-2";
      container.appendChild(field);
      container.appendChild(createPreviewEmptyState());
      return container;
    }
    return field;
  }

  function renderChoiceGroup(component, type) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-wrap gap-2";
    const options = Array.isArray(component.options) && component.options.length
      ? component.options
      : ["Option A", "Option B", "Option C"];
    options.forEach((option, index) => {
      const id = toId([component.uid, type, option, index]);
      const formCheck = document.createElement("div");
      formCheck.className = "form-check form-check-inline";
      const input = document.createElement("input");
      input.className = "form-check-input";
      input.type = type;
      input.name = `${component.uid}-${type}`;
      input.id = id;
      input.disabled = !!component.readOnly;
      const label = document.createElement("label");
      label.className = "form-check-label";
      label.setAttribute("for", id);
      label.textContent = option;
      formCheck.append(input, label);
      wrapper.appendChild(formCheck);
    });
    return wrapper;
  }

  // The canvas shows the item template ONCE, as a real editable dropzone
  // (exactly like a Container zone) — not multiplied per resolved sample
  // item the way old List's preview was, since the copies would only ever
  // differ by data, not by structure, and multiplying editable dropzones
  // would make it ambiguous which one a drag/drop edit is even targeting.
  // The real per-item repetition happens at play time
  // (workbench-character-view.js's own renderRepeaterComponent).
  function renderRepeaterPreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const labelText = getComponentLabel(component, "Repeater");
    if (labelText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = labelText;
      applyTextFormatting(heading, component);
      wrapper.appendChild(heading);
    }
    const binding = normalizeBindingValue(component.binding);
    const hint = document.createElement("div");
    hint.className = "extra-small text-body-secondary";
    hint.textContent = binding
      ? `Repeats once per item in ${binding} — build the item's own layout below.`
      : "Bind this to an array field (Data section below), then build the item's own layout here.";
    wrapper.appendChild(hint);
    const decoratorPreview = previewRepeaterDecorator(component);
    if (decoratorPreview) {
      const decoratorRow = document.createElement("div");
      decoratorRow.className = "d-flex align-items-center gap-2 extra-small text-body-secondary";
      const marker = document.createElement("span");
      marker.className = "fw-semibold";
      marker.textContent = decoratorPreview;
      decoratorRow.append("Decorator:", marker);
      wrapper.appendChild(decoratorRow);
    }
    const zones = ensureRepeaterZone(component);
    const headerZones = zones.filter((zone) => zone.key.startsWith("header-"));
    const itemZones = zones.filter((zone) => zone.key.startsWith("item-"));
    if (headerZones.length) {
      const headerRow = document.createElement("div");
      headerRow.className = "d-flex gap-2 align-items-stretch";
      headerZones.forEach((zone) => {
        headerRow.appendChild(
          createContainerDropzone(component, zone, {
            label: zone.label,
            hint: "Drop header content here",
          })
        );
      });
      wrapper.appendChild(headerRow);
    }
    const itemRow = document.createElement("div");
    itemRow.className = "d-flex gap-2 align-items-stretch";
    itemZones.forEach((zone) => {
      itemRow.appendChild(
        createContainerDropzone(component, zone, {
          label: itemZones.length > 1 ? zone.label : null,
          hint: "Drag components here to build one item's layout",
        })
      );
    });
    wrapper.appendChild(itemRow);
    return wrapper;
  }

  // A representative first-item decorator, for the canvas hint only — the
  // real per-item resolution (including a custom @-bound decorator's actual
  // value) happens at play time (workbench-character-view.js's own
  // resolveRepeaterDecorator).
  function previewRepeaterDecorator(component) {
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : null;
    const type = decorator?.type || "none";
    if (type === "bullet") return "•";
    if (type === "number") return "1.";
    if (type === "custom") return (decorator.text || "").trim() || "(empty)";
    return "";
  }

  // An old saved template may still have `component.src` (the old, sole
  // field before this port) instead of `component.url` — read as a
  // fallback everywhere a URL is needed, written to `.url` on every edit
  // going forward (never `.src` again), so existing Image components keep
  // showing their picture with no migration step and self-heal on first edit.
  function resolveImageUrl(component) {
    return component.url || component.src || "";
  }

  // Shared by the canvas preview and (a duplicate small copy of the same
  // logic, since that's a separate file) the real character-sheet render —
  // matches Press's own template-renderer.js image case exactly, minus the
  // inches/Layer-sizing branch, which has no equivalent here (Workbench
  // components always fill their own container zone/cell, never a
  // free-positioned print Layer).
  function applyImageStyles(img, component) {
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

  function renderImagePreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "text-center";
    wrapper.style.overflow = "hidden";
    const img = document.createElement("img");
    img.src = resolveImageUrl(component) || "https://placekitten.com/320/180";
    img.alt = component.alt || "Image";
    applyImageStyles(img, component);
    wrapper.appendChild(img);
    return wrapper;
  }

  // iconClass is itself the binding-or-literal string (see the icon
  // registry entry's own comment) — for the canvas preview specifically, an
  // "@path" value resolves against the template's sample/preview data
  // (resolvePreviewBindingValue, the same helper every other bound field's
  // preview uses) rather than a live character record.
  function resolveIconPreviewClassList(component) {
    const raw = typeof component.iconClass === "string" ? component.iconClass.trim() : "";
    if (raw.startsWith("@")) {
      return resolveIconClassList(resolvePreviewBindingValue(raw));
    }
    return resolveIconClassList(raw);
  }

  function renderIconPreview(component) {
    const wrapper = document.createElement("span");
    wrapper.className = "d-inline-flex align-items-center";
    const classes = resolveIconPreviewClassList(component);
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
    return wrapper;
  }

  function renderTextPreview(component) {
    // Binding/formula take priority over the static text fallback here too,
    // matching resolveComponentValue's own precedence at play time — same
    // reasoning as every other bound field's own canvas preview. But sample
    // data can't always resolve a binding — most notably, a Text living
    // inside a Repeater's item template has an @-path that's relative to
    // the ITEM (see resolveRepeaterItemValue in workbench-character-view.js),
    // not the top-level sample data resolvePreviewBindingValue resolves
    // against, so it will always come back empty here. A formula can never
    // be evaluated in the canvas at all (no live record to evaluate it
    // against). In both cases, show the binding/formula itself instead of
    // silently falling through to the generic "Text" type label, which
    // looked exactly like the binding/formula hadn't been captured at all.
    const binding = normalizeBindingValue(component.binding);
    const formula = typeof component.formula === "string" ? component.formula.trim() : "";
    let value = "";
    if (formula) {
      value = `=${formula}`;
    } else if (binding) {
      const resolved = resolvePreviewBindingValue(binding);
      value = resolved !== undefined && resolved !== null && String(resolved).trim()
        ? String(resolved).trim()
        : binding;
    }
    if (!value) {
      value = (component.text || "").trim() || getComponentLabel(component, "");
    }
    if (!value) {
      return document.createDocumentFragment();
    }
    const text = document.createElement("div");
    text.className = "fw-semibold";
    text.textContent = value;
    applyTextFormatting(text, component);
    return text;
  }

  function renderContainerPreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-3";
    const labelText = getComponentLabel(component, "Container");
    if (labelText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = labelText;
      applyTextFormatting(heading, component);
      wrapper.appendChild(heading);
    }

    const zones = ensureContainerZones(component);
    const gap = clampInteger(component.gap ?? 16, 0, 64);

    switch (component.containerType) {
      case "tabs": {
        const labels = zones.map((zone) => zone.label);
        const activeIndex = getActiveTabIndex(component, labels.length);
        const nav = document.createElement("div");
        nav.className = "d-flex flex-wrap gap-2";
        labels.forEach((label, index) => {
          const button = document.createElement("button");
          button.type = "button";
          const isActive = index === activeIndex;
          button.className = `btn btn-outline-secondary btn-sm${isActive ? " active" : ""}`;
          button.textContent = label;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isActive) return;
            setActiveTabIndex(component, index);
            renderCanvas();
          });
          nav.appendChild(button);
        });
        wrapper.appendChild(nav);

        const zone = zones[activeIndex] || zones[0];
        if (zone) {
          const dropzone = createContainerDropzone(component, zone, {
            label: labels[activeIndex] || zone.label,
            hint: `Drop components for ${labels[activeIndex] || zone.label || "this tab"}`,
          });
          wrapper.appendChild(dropzone);
        }
        break;
      }
      case "grid":
      default: {
        // "grid" is the only remaining non-tabs variant (ensureContainerZones
        // has already normalized any legacy "columns"/"rows" value above).
        const grid = document.createElement("div");
        grid.className = "template-container-grid";
        const columns = clampInteger(component.columns || 2, 1, MAX_CONTAINER_COLUMNS);
        const templateColumns = typeof component.templateColumns === "string" ? component.templateColumns.trim() : "";
        const templateRows = typeof component.templateRows === "string" ? component.templateRows.trim() : "";
        grid.style.gridTemplateColumns = templateColumns || `repeat(${columns}, minmax(0, 1fr))`;
        if (templateRows) {
          grid.style.gridTemplateRows = templateRows;
        }
        grid.style.gap = `${gap}px`;
        zones.forEach((zone) => {
          grid.appendChild(
            createContainerDropzone(component, zone, {
              label: zone.label,
              hint: `Drop components into ${zone.label}`,
            })
          );
        });
        wrapper.appendChild(grid);
        break;
      }
    }
    return wrapper;
  }

  function resolveTrackSegmentCount(component) {
    const maxSegments = 16;
    const minSegments = 1;
    if (componentHasFormula(component, { formulaKey: "segmentFormula" })) {
      const fallback = Number(component.segments);
      return Number.isFinite(fallback)
        ? clampInteger(fallback, minSegments, maxSegments)
        : 6;
    }
    const bindingValue = typeof component.segmentBinding === "string"
      ? component.segmentBinding.trim()
      : "";
    if (bindingValue && !bindingValue.startsWith("@")) {
      const parsed = Number(bindingValue);
      if (Number.isFinite(parsed)) {
        return clampInteger(parsed, minSegments, maxSegments);
      }
    }
    const segments = Number(component.segments);
    if (Number.isFinite(segments)) {
      return clampInteger(segments, minSegments, maxSegments);
    }
    return 6;
  }

  function resolveTrackActiveCount(component, segmentCount) {
    const numericValue = Number(component.value);
    if (Number.isFinite(numericValue)) {
      return clampInteger(numericValue, 0, segmentCount);
    }
    const bindingValue = typeof component.binding === "string" ? component.binding.trim() : "";
    if (bindingValue && !bindingValue.startsWith("@")) {
      const parsed = Number(bindingValue);
      if (Number.isFinite(parsed)) {
        return clampInteger(parsed, 0, segmentCount);
      }
    }
    return Math.min(segmentCount, Math.max(0, Math.ceil(segmentCount / 2)));
  }

  function getTrackPreviewState(component) {
    const segments = resolveTrackSegmentCount(component);
    const active = resolveTrackActiveCount(component, segments);
    return { segments, active };
  }

  // The one dispatch point Track's canvas preview goes through — Linear and
  // Circular differ only in which of these two shape-specific renderers
  // gets called, not in any of the data/segment math above (shared by both
  // via resolveTrackSegmentCount/resolveTrackActiveCount/getTrackPreviewState).
  function renderTrackPreview(component) {
    return component.trackShape === "circular" ? renderCircularTrackPreview(component) : renderLinearTrackPreview(component);
  }

  function renderLinearTrackPreview(component) {
    const labelText = getComponentLabel(component, "Track");
    const track = document.createElement("div");
    track.className = "template-linear-track";
    const { segments, active } = getTrackPreviewState(component);
    const total = Math.max(segments, 1);
    for (let index = 0; index < total; index += 1) {
      const segment = document.createElement("div");
      segment.className = "template-linear-track__segment";
      if (index < active) {
        segment.classList.add("is-active");
      }
      segment.title = `Segment ${index + 1}`;
      track.appendChild(segment);
    }
    return createLabeledField({
      component,
      control: track,
      labelText,
      labelTag: "div",
      labelClasses: ["fw-semibold", "text-body-secondary"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderCircularTrackPreview(component) {
    const labelText = getComponentLabel(component, "Clock");
    const circle = document.createElement("div");
    circle.className = "template-circular-track";
    const { segments, active } = getTrackPreviewState(component);
    const total = Math.max(segments, 1);
    const step = 360 / total;
    const gradientStops = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * step;
      const end = start + step;
      const color = index < active ? "var(--bs-primary)" : "var(--bs-border-color)";
      gradientStops.push(`${color} ${start}deg ${end}deg`);
    }
    circle.style.background = `conic-gradient(${gradientStops.join(", ")})`;
    const mask = document.createElement("div");
    mask.className = "template-circular-track__mask";
    circle.appendChild(mask);
    const value = document.createElement("div");
    value.className = "template-circular-track__value";
    value.textContent = `${Math.min(active, total)}/${total}`;
    circle.appendChild(value);
    return createLabeledField({
      component,
      control: circle,
      labelText,
      labelTag: "div",
      labelClasses: ["fw-semibold", "text-body-secondary"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderSelectGroupComponentPreview(component) {
    const labelText = getComponentLabel(component, "Select");
    const options = resolveSelectGroupPreviewOptions(component);
    if (!options.length) {
      const container = document.createElement("div");
      container.className = "d-flex flex-column gap-2";
      if (labelText) {
        container.appendChild(
          createLabeledField({
            component,
            control: document.createDocumentFragment(),
            labelText,
            labelTag: "div",
            labelClasses: ["fw-semibold"],
            applyFormatting: applyTextFormatting,
          })
        );
      }
      container.appendChild(createPreviewEmptyState());
      return container;
    }
    let control;
    if (component.variant === "tags") {
      control = document.createElement("div");
      control.className = "template-select-tags d-flex flex-wrap gap-2";
      options.forEach((option, index) => {
        const tag = document.createElement("span");
        tag.className = "template-select-tag";
        const label = option.label || option.value || "";
        const slug = label.trim().toLowerCase().replace(/\s+/g, "-");
        tag.textContent = `#${slug || "tag"}`;
        if (component.multiple !== false && index < 2) {
          tag.classList.add("is-active");
        } else if (!component.multiple && index === 0) {
          tag.classList.add("is-active");
        }
        control.appendChild(tag);
      });
    } else if (component.variant === "buttons") {
      control = document.createElement("div");
      control.className = "btn-group";
      options.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        const isActive = component.multiple ? index < 2 : index === 0;
        button.className = `btn btn-outline-secondary${isActive ? " active" : ""}`;
        if (component.readOnly) {
          button.classList.add("disabled");
        }
        button.textContent = option.label || option.value;
        control.appendChild(button);
      });
    } else {
      control = document.createElement("div");
      control.className = "d-flex flex-wrap gap-2";
      options.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        const isActive = component.multiple ? index < 2 : index === 0;
        button.className = `btn btn-outline-secondary btn-sm rounded-pill${isActive ? " active" : ""}`;
        if (component.readOnly) {
          button.classList.add("disabled");
        }
        button.textContent = option.label || option.value;
        control.appendChild(button);
      });
    }
    return createLabeledField({
      component,
      control,
      labelText,
      labelTag: "div",
      labelClasses: ["fw-semibold"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderTogglePreview(component) {
    const labelText = getComponentLabel(component, "Toggle");
    const states = resolveTogglePreviewStates(component);
    const shape = component.shape || "circle";
    const fallbackState = typeof component.value === "string" ? component.value.trim() : "";
    const hasStates = states.length > 0;
    let activeIndex = hasStates && fallbackState ? states.findIndex((state) => String(state) === fallbackState) : -1;
    if (activeIndex < 0) {
      activeIndex = clampInteger(component.activeIndex ?? 0, 0, Math.max(states.length - 1, 0));
    }
    if (activeIndex < 0) {
      activeIndex = 0;
    }
    const maxIndex = Math.max(states.length - 1, 1);
    const progress = maxIndex > 0 ? activeIndex / maxIndex : 0;
    const preview = document.createElement("div");
    preview.className = `template-toggle-shape template-toggle-shape--${shape}`;
    if (progress > 0) {
      preview.classList.add("is-active");
    }
    preview.style.setProperty("--template-toggle-level", progress.toFixed(3));
    const opacity = 0.25 + progress * 0.55;
    preview.style.setProperty("--template-toggle-opacity", opacity.toFixed(3));
    if (hasStates) {
      preview.setAttribute("aria-label", states[Math.min(activeIndex, states.length - 1)] || "Toggle state");
    } else {
      preview.setAttribute("aria-label", "Toggle preview");
    }
    const field = createLabeledField({
      component,
      control: preview,
      labelText,
      labelTag: "div",
      labelClasses: ["fw-semibold", "text-body-secondary"],
      applyFormatting: applyTextFormatting,
    });
    if (!hasStates) {
      const container = document.createElement("div");
      container.className = "d-flex flex-column gap-2";
      container.appendChild(field);
      container.appendChild(createPreviewEmptyState("Select a source to preview toggle states."));
      return container;
    }
    return field;
  }

  function selectComponent(uid) {
    if (state.selectedId === uid) {
      expandInspectorPane();
      return;
    }
    state.selectedId = uid;
    renderCanvas();
    renderInspector();
    expandInspectorPane();
  }

  function expandInspectorPane() {
    expandPane(elements.rightPane, elements.rightPaneToggle);
  }

  function clearCanvas({ skipHistory = false, silent = false, suppressRender = false } = {}) {
    if (!state.components.length) {
      status.show("Canvas is already empty", { timeout: 1200 });
      return;
    }
    const previousComponents = cloneComponentCollection(state.components);
    const previousTabs = snapshotContainerTabs();
    const previousSelectedId = state.selectedId || null;
    state.components = [];
    state.selectedId = null;
    containerActiveTabs.clear();
    componentCollapsedState.clear();
    if (!skipHistory) {
      undoStack.push({
        type: "clear",
        templateId: state.template?.id || "",
        components: previousComponents,
        containerTabs: previousTabs,
        previousSelectedId,
      });
    }
    if (!silent) {
      status.show("Cleared template canvas", { type: "info", timeout: 1500 });
    }
    if (!suppressRender) {
      renderCanvas();
      renderInspector();
    }
  }

  function removeComponent(uid, { skipHistory = false, silent = false, suppressRender = false } = {}) {
    const found = findComponent(uid);
    if (!found) return;
    const previousSelectedId = state.selectedId || null;
    const parentId = found.parent?.uid || "";
    const zoneKey = found.zoneKey;
    const index = found.index;
    const [removed] = found.collection.splice(found.index, 1);
    pruneContainerState(removed);
    if (!skipHistory) {
      undoStack.push({
        type: "remove",
        templateId: state.template?.id || "",
        componentId: removed.uid,
        component: cloneComponentTree(removed),
        parentId,
        zoneKey,
        index,
        previousSelectedId,
      });
    }
    if (!silent) {
      status.show("Removed component", { type: "info", timeout: 1500 });
    }
    if (state.selectedId === uid) {
      state.selectedId = parentId || null;
    }
    if (!suppressRender) {
      renderCanvas();
      renderInspector();
    }
  }

  function ensureTemplateContext(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const targetId = entry.templateId ?? "";
    const currentId = state.template?.id || "";
    if (targetId && targetId !== currentId) {
      return false;
    }
    return true;
  }

  function applyTemplateUndo(entry) {
    if (!ensureTemplateContext(entry)) {
      return { message: "Undo unavailable for this template", options: { type: "warning", timeout: 2200 } };
    }
    switch (entry.type) {
      case "add": {
        const componentId = entry.component?.uid;
        if (!componentId) {
          return { message: "Nothing to undo", options: { timeout: 1200 } };
        }
        removeComponent(componentId, { skipHistory: true, silent: true, suppressRender: true });
        state.selectedId = entry.previousSelectedId || null;
        renderCanvas();
        renderInspector();
        return { message: "Removed added component", options: { type: "info", timeout: 1600 } };
      }
      case "move": {
        if (!entry.componentId || !entry.from) {
          return { message: "Nothing to undo", options: { timeout: 1200 } };
        }
        moveComponent(entry.componentId, entry.from.parentId, entry.from.zoneKey, entry.from.index);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Moved component back", options: { type: "info", timeout: 1500 } };
      }
      case "reorder": {
        if (!entry.componentId || !entry.parentId || !entry.zoneKey || !entry.from) {
          return { message: "Nothing to undo", options: { timeout: 1200 } };
        }
        moveComponent(entry.componentId, entry.parentId, entry.zoneKey, entry.from.index);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Restored component order", options: { type: "info", timeout: 1500 } };
      }
      case "remove": {
        if (!entry.component || entry.componentId == null) {
          return { message: "Nothing to undo", options: { timeout: 1200 } };
        }
        const componentClone = cloneComponentTree(entry.component);
        insertComponent(entry.parentId, entry.zoneKey, entry.index, componentClone);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Restored removed component", options: { type: "info", timeout: 1600 } };
      }
      case "clear": {
        state.components = cloneComponentCollection(entry.components);
        restoreContainerTabsSnapshot(entry.containerTabs);
        componentCollapsedState.clear();
        state.selectedId = entry.previousSelectedId || null;
        renderCanvas();
        renderInspector();
        return { message: "Restored template canvas", options: { type: "info", timeout: 1600 } };
      }
      case "save": {
        return { message: "Saved template state noted", options: { type: "info", timeout: 1500 } };
      }
      default:
        return { message: "Nothing to undo", options: { timeout: 1200 } };
    }
  }

  function applyTemplateRedo(entry) {
    if (!ensureTemplateContext(entry)) {
      return { message: "Redo unavailable for this template", options: { type: "warning", timeout: 2200 } };
    }
    switch (entry.type) {
      case "add": {
        if (!entry.component) {
          return { message: "Nothing to redo", options: { timeout: 1200 } };
        }
        const componentClone = cloneComponentTree(entry.component);
        insertComponent(entry.parentId, entry.zoneKey, entry.index, componentClone);
        state.selectedId = componentClone.uid;
        renderCanvas();
        renderInspector();
        return { message: "Reapplied component addition", options: { type: "info", timeout: 1600 } };
      }
      case "move": {
        if (!entry.componentId || !entry.to) {
          return { message: "Nothing to redo", options: { timeout: 1200 } };
        }
        moveComponent(entry.componentId, entry.to.parentId, entry.to.zoneKey, entry.to.index);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Reapplied component move", options: { type: "info", timeout: 1500 } };
      }
      case "reorder": {
        if (!entry.componentId || !entry.parentId || !entry.zoneKey || !entry.to) {
          return { message: "Nothing to redo", options: { timeout: 1200 } };
        }
        moveComponent(entry.componentId, entry.parentId, entry.zoneKey, entry.to.index);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Reapplied ordering", options: { type: "info", timeout: 1500 } };
      }
      case "remove": {
        if (!entry.componentId) {
          return { message: "Nothing to redo", options: { timeout: 1200 } };
        }
        removeComponent(entry.componentId, {
          skipHistory: true,
          silent: true,
          suppressRender: true,
        });
        state.selectedId = entry.parentId || null;
        renderCanvas();
        renderInspector();
        return { message: "Reapplied component removal", options: { type: "info", timeout: 1600 } };
      }
      case "clear": {
        clearCanvas({ skipHistory: true, silent: true, suppressRender: true });
        renderCanvas();
        renderInspector();
        return { message: "Cleared template canvas", options: { type: "info", timeout: 1500 } };
      }
      case "save": {
        return { message: "Save action noted", options: { type: "info", timeout: 1500 } };
      }
      default:
        return { message: "Nothing to redo", options: { timeout: 1200 } };
    }
  }

  function handleUndoEntry(entry) {
    return applyTemplateUndo(entry);
  }

  function handleRedoEntry(entry) {
    return applyTemplateRedo(entry);
  }

  function applyTemplateData(
    data = {},
    {
      origin = "draft",
      emitStatus = false,
      statusMessage = "",
      markClean = origin !== "draft",
      shareToken = "",
    } = {}
  ) {
    templateIdAuto = false;
    const effectiveShareToken = typeof shareToken === "string" && shareToken ? shareToken : data.shareToken || "";
    const template = createBlankTemplate({
      id: data.id || "",
      title: data.title || "",
      version: data.version || data.metadata?.version || "0.1",
      schema: data.schema || data.system || "",
      description: data.description || "",
      type: data.type || "",
      origin,
      shareToken: effectiveShareToken,
    });
    componentCounter = 0;
    const components = Array.isArray(data.components)
      ? data.components.map((component) => hydrateComponent(component)).filter(Boolean)
      : [];
    state.template = template;
    state.template.shareToken = effectiveShareToken;
    const metadata = template.id ? templateCatalog.get(template.id) || null : null;
    if (metadata) {
      const ownership = templateOwnership(metadata) || template.origin || "";
      state.template.ownership = ownership;
      state.template.permissions = metadata.permissions || state.template.permissions || "";
      state.template.ownerId = metadata.ownerId ?? metadata.owner_id ?? null;
      state.template.ownerUsername = metadata.ownerUsername || metadata.owner_username || "";
    } else {
      state.template.ownership = template.origin || state.template.ownership || "";
      state.template.permissions = state.template.permissions || "";
      state.template.ownerId = null;
      state.template.ownerUsername = "";
    }
    state.components = components;
    state.selectedId = null;
    containerActiveTabs.clear();
    componentCollapsedState.clear();
    if (markClean) {
      markTemplateClean();
    }
    renderCanvas();
    renderInspector();
    ensureTemplateSelectValue();
    updateSystemContext(template.schema).catch(() => {});
    if (emitStatus && statusMessage) {
      status.show(statusMessage, { type: "success", timeout: 2000 });
    }
  }

  function startBlankTemplateDraft() {
    const title = "New Template";
    const schema = resolveDefaultTemplateSchema();
    const id = deriveTemplateIdFromTitle(title);
    const version = "0.1";
    const description = "";
    const type = "sheet";
    registerTemplateRecord(
      {
        id,
        title,
        schema,
        source: "draft",
        ownership: "draft",
        permissions: "edit",
      },
      { syncOption: true }
    );
    applyTemplateData(
      { id, title, version, schema, description, type, components: [] },
      {
        origin: "draft",
        emitStatus: true,
        statusMessage: `Started ${title}`,
        markClean: false,
      }
    );
    templateIdAuto = true;
    templateCreationContext = { mode: "new", duplicateComponents: null, sourceTitle: "" };
    renderTemplateProperties();
    expandInspectorPane();
    expandTemplatePropertiesSection();
  }

  function startNewTemplate({
    id = "",
    title = "",
    version = "0.1",
    schema = "",
    description = "",
    type = "sheet",
    origin = "draft",
    components = [],
    markClean = true,
    statusMessage = "",
  } = {}) {
    const trimmedId = (id || "").trim();
    const trimmedTitle = (title || "").trim();
    const trimmedSchema = (schema || "").trim();
    if (!trimmedId || !trimmedTitle || !trimmedSchema) {
      status.show("Provide an ID, title, and system for the template.", { type: "warning", timeout: 2200 });
      return;
    }
    const componentClones = Array.isArray(components) ? cloneComponentCollection(components) : [];
    registerTemplateRecord(
      {
        id: trimmedId,
        title: trimmedTitle,
        schema: trimmedSchema,
        source: origin,
        ownership: origin,
        permissions: "edit",
      },
      { syncOption: true }
    );
    applyTemplateData(
      {
        id: trimmedId,
        title: trimmedTitle,
        version,
        schema: trimmedSchema,
        description,
        type,
        components: componentClones,
      },
      {
        origin,
        emitStatus: true,
        statusMessage: statusMessage || `Started ${trimmedTitle || trimmedId}`,
        markClean,
      }
    );
    templateCreationContext = { mode: "new", duplicateComponents: null, sourceTitle: "" };
  }

  function createTemplateField({ labelText, control, id }) {
    const wrapper = document.createElement("div");
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = labelText;
    const fieldId = id || toId(["template", labelText]);
    if (fieldId) {
      control.id = fieldId;
      control.dataset.templateField = fieldId;
      label.setAttribute("for", fieldId);
    }
    wrapper.appendChild(label);
    wrapper.appendChild(control);
    return wrapper;
  }

  function renderTemplateProperties() {
    if (!elements.templateProperties) {
      return;
    }
    const focusSnapshot = captureTemplatePropertiesFocus();
    elements.templateProperties.innerHTML = "";
    if (!state.template) {
      const placeholder = document.createElement("p");
      placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
      placeholder.textContent = "Select or create a template to edit its properties.";
      elements.templateProperties.appendChild(placeholder);
      return;
    }

    const metadata = getTemplateMetadata(state.template.id);
    // Same admin bypass resolveDeleteTemplateState already applies to the
    // toolbar Delete button — an admin can edit any template regardless of
    // ownership, not just delete it.
    const canEdit = dataManager.getUserTier() === "admin" || templateAllowsEdits(metadata);
    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-3";
    form.addEventListener("submit", (event) => event.preventDefault());

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-control";
    nameInput.placeholder = "Template name";
    nameInput.value = state.template.title || "";
    nameInput.disabled = !canEdit;

    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.className = "form-control";
    idInput.value = state.template.id || "";
    idInput.readOnly = true;
    idInput.disabled = !canEdit;

    nameInput.addEventListener("input", (event) => {
      const nextTitle = event.target.value || "";
      const previousId = state.template?.id || "";
      state.template.title = nextTitle.trim();
      if (templateIdAuto) {
        const nextId = deriveTemplateIdFromTitle(state.template.title || "template", { excludeId: previousId });
        state.template.id = nextId;
        idInput.value = nextId;
      }
      syncTemplateRecord({ previousId });
      syncTemplateActions();
    });

    form.appendChild(createTemplateField({ labelText: "ID", control: idInput, id: "template-id" }));
    form.appendChild(createTemplateField({ labelText: "Name", control: nameInput, id: "template-title" }));

    const typeSelect = document.createElement("select");
    typeSelect.className = "form-select";
    typeSelect.disabled = !canEdit;
    const typeOptions = [
      { value: "sheet", label: "Sheet" },
      { value: "reference", label: "Reference" },
    ];
    typeOptions.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      typeSelect.appendChild(opt);
    });
    const currentTypeRaw = state.template.type || "sheet";
    const currentType = currentTypeRaw.toLowerCase();
    if (!typeOptions.some((option) => option.value === currentType)) {
      const opt = document.createElement("option");
      opt.value = currentType;
      opt.textContent = currentTypeRaw;
      typeSelect.appendChild(opt);
    }
    typeSelect.value = typeOptions.find((option) => option.value === currentType)?.value || currentType || "sheet";
    typeSelect.addEventListener("change", (event) => {
      state.template.type = event.target.value;
      syncTemplateActions();
    });
    form.appendChild(createTemplateField({ labelText: "Type", control: typeSelect, id: "template-type" }));

    const descriptionInput = document.createElement("textarea");
    descriptionInput.className = "form-control";
    descriptionInput.rows = 3;
    descriptionInput.placeholder = "Add a short description";
    descriptionInput.value = state.template.description || "";
    descriptionInput.disabled = !canEdit;
    descriptionInput.addEventListener("input", (event) => {
      state.template.description = event.target.value || "";
      syncTemplateActions();
    });
    form.appendChild(createTemplateField({ labelText: "Description", control: descriptionInput, id: "template-description" }));

    // The Template-level "base font" — has no "Default" option of its own
    // (excludeDefault: true — a template can't inherit from itself) and, if
    // left unset, shows the raw effective fallback (DEFAULT_FONT_FAMILY)
    // rather than a labeled option, same convention as any other raw CSS
    // font-family value neither tool has a matching library entry for.
    const baseFontInput = document.createElement("input");
    baseFontInput.type = "text";
    baseFontInput.className = "form-control";
    baseFontInput.autocomplete = "off";
    baseFontInput.disabled = !canEdit;
    const currentBaseFamily =
      typeof state.template.baseFontFamily === "string" ? state.template.baseFontFamily.trim() : "";
    const matchedBaseOption = findFontOptionByFamily(currentBaseFamily);
    baseFontInput.value = matchedBaseOption ? matchedBaseOption.label : currentBaseFamily || DEFAULT_FONT_FAMILY;
    const baseFontField = createTemplateField({
      labelText: "Base font",
      control: baseFontInput,
      id: "template-base-font",
    });
    form.appendChild(baseFontField);
    // Runs AFTER baseFontInput has a DOM parent (baseFontField, above) —
    // same requirement as createFontFamilyControl's own note.
    attachFontFamilyAutocomplete(baseFontInput, {
      onSelect: (option) => {
        state.template.baseFontFamily = option.family || "";
        baseFontInput.value = option.label;
        renderCanvas();
      },
      onAddFont: () =>
        openAddFontModal((registered) => {
          state.template.baseFontFamily = registered.family;
          baseFontInput.value = registered.label;
          renderCanvas();
        }),
      canAddFont: () => dataManager.meetsTier("creator"),
      onAddDenied: () => status.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 }),
      onDeleteFont: (option) => handleDeleteCustomFont(option),
      canDeleteFont: () => dataManager.meetsTier("admin"),
      excludeDefault: true,
    });

    const systemSelect = document.createElement("select");
    systemSelect.className = "form-select";
    systemSelect.disabled = !canEdit;
    const systemOptions = Array.from(systemCatalog.values())
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }))
      .filter((option) => option.value)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    populateSelect(systemSelect, systemOptions, { placeholder: "Select system" });
    systemSelect.value = state.template.schema || "";
    systemSelect.addEventListener("change", (event) => {
      const nextSchema = (event.target.value || "").trim();
      state.template.schema = nextSchema;
      syncTemplateRecord({ previousId: state.template.id });
      updateSystemContext(nextSchema).catch(() => {});
      syncTemplateActions();
    });
    form.appendChild(createTemplateField({ labelText: "System", control: systemSelect, id: "template-system" }));

    elements.templateProperties.appendChild(form);
    restoreTemplatePropertiesFocus(focusSnapshot);
  }

  function renderInspector() {
    renderTemplateProperties();
    if (!elements.inspector) return;
    const focusSnapshot = captureInspectorFocus();
    elements.inspector.innerHTML = "";
    const selection = findComponent(state.selectedId);
    const component = selection?.component;
    if (!component) {
      expandTemplatePropertiesSection();
      collapseComponentPropertiesSection();
      const placeholder = document.createElement("p");
      placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
      placeholder.textContent = "Select a component on the canvas to edit its settings.";
      elements.inspector.appendChild(placeholder);
      return;
    }
    collapseTemplatePropertiesSection();
    expandComponentPropertiesSection();
    const definition = COMPONENT_DEFINITIONS[component.type] || {};
    if (isZoneContainer(component)) {
      ensureComponentZones(component);
    }
    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-4";
    form.addEventListener("submit", (event) => event.preventDefault());

    const identityControls = [
      createTextInput(component, "ID", component.id || "", (value) => {
        updateComponent(component.uid, (draft) => {
          draft.id = value.trim();
        }, { rerenderCanvas: true });
      }, { placeholder: "Unique identifier" }),
      // Text has no separate "caption" concept the way Input/Toggle/etc.
      // do — its own dedicated Binding/Text field (see renderTextInspector)
      // IS its whole content. A generic Label field here would just be a
      // second, redundant place to set text, exactly the "two fields for
      // one concept" problem Text was created to eliminate in the first
      // place — so it's omitted for this type only.
      component.type === "text"
        ? null
        : createTextInput(component, "Label", getComponentLabel(component), (value) => {
            updateComponent(component.uid, (draft) => {
              const next = value.trim();
              draft.label = next;
              draft.name = next;
            }, { rerenderCanvas: true });
          }, { placeholder: "Displayed label" }),
    ].filter(Boolean);
    if (identityControls.length) {
      const identityGroup = document.createElement("div");
      identityGroup.className = "d-flex flex-column gap-3";
      identityControls.forEach((control) => identityGroup.appendChild(control));
      form.appendChild(identityGroup);
    }

    const componentSpecificControls = renderComponentSpecificInspector(component).filter(Boolean);
    if (componentSpecificControls.length) {
      const componentSection = document.createElement("section");
      componentSection.className = "d-flex flex-column gap-3";
      componentSpecificControls.forEach((control) => componentSection.appendChild(control));
      form.appendChild(componentSection);
    }

    const dataControls = createDataControls(component, definition);
    const dataSection = createSection("Data", dataControls);
    if (dataSection) {
      form.appendChild(dataSection);
    }

    const appearanceControls = [];
    const colorControls = getColorControls(component);
    if (colorControls.length) {
      appearanceControls.push(createColorRow(component, colorControls));
      if (colorControls.includes("border")) {
        appearanceControls.push(createBorderControls(component));
      }
    }
    if (componentSupportsLabelPosition(component)) {
      appearanceControls.push(createLabelPositionControl(component));
    }
    if (componentHasTextControls(component)) {
      appearanceControls.push(...createTextFormattingControls(component));
      appearanceControls.push(createTextStyleControls(component));
    }
    if (definition.supportsAlignment !== false && componentHasTextControls(component)) {
      appearanceControls.push(createAlignmentControls(component));
    }
    appearanceControls.push(...createSpacingControls(component));
    const appearanceSection = createSection("Appearance", appearanceControls);
    if (appearanceSection) {
      form.appendChild(appearanceSection);
    }

    const behaviorControls = [createCollapsibleToggle(component)];
    if (definition.supportsReadOnly) {
      behaviorControls.push(createReadOnlyToggle(component));
    }
    behaviorControls.push(createVisibilityControl(component));
    const behaviorSection = createSection("Behavior", behaviorControls);
    if (behaviorSection) {
      form.appendChild(behaviorSection);
    }

    // Available unconditionally, every type — matches Press's own Classes
    // field being ungated (unlike everything else in this inspector, which
    // is gated by registry flags/component type).
    const advancedSection = createSection("Advanced", [createClassNameControl(component)]);
    if (advancedSection) {
      form.appendChild(advancedSection);
    }

    elements.inspector.appendChild(form);
    refreshTooltips(elements.inspector);
    restoreInspectorFocus(focusSnapshot);
  }

  function componentSupportsRoller(component) {
    if (!component || typeof component !== "object") {
      return false;
    }
    return component.type === "input" && (component.variant || "text") === "number";
  }

  function componentSupportsLabelPosition(component) {
    if (!component || typeof component !== "object") {
      return false;
    }
    const definition = COMPONENT_DEFINITIONS[component.type] || {};
    return Boolean(definition.supportsLabelPosition);
  }

  function createLabelPositionControl(component) {
    const options = [
      { value: "top", icon: "tabler:layout-align-top", label: "Top" },
      { value: "right", icon: "tabler:layout-align-right", label: "Right" },
      { value: "bottom", icon: "tabler:layout-align-bottom", label: "Bottom" },
      { value: "left", icon: "tabler:layout-align-left", label: "Left" },
    ];
    const current = normalizeLabelPosition(component.labelPosition, "top");
    return createRadioButtonGroup(component, "Label position", options, current, (value) => {
      const next = normalizeLabelPosition(value, current);
      updateComponent(
        component.uid,
        (draft) => {
          draft.labelPosition = next;
        },
        { rerenderCanvas: true, rerenderInspector: true }
      );
    }, { forceSingleRow: true });
  }

  function createRollerInputControl(component) {
    return createBindingFormulaInput(component, {
      labelText: "Roller",
      placeholder: "1d20 + @abilities.strength",
      bindingKey: "roller",
      formulaKey: null,
      supportsBinding: true,
      supportsFormula: false,
      allowedFieldCategories: ["number"],
      helperText: "Roll20 dice expression. Supports @field references.",
    });
  }

  function appendRollerControl(list, component) {
    if (!Array.isArray(list)) {
      return;
    }
    if (!componentSupportsRoller(component)) {
      return;
    }
    const control = createRollerInputControl(component);
    if (control) {
      list.push(control);
    }
  }

  function createDataControls(component, definition = {}) {
    const supportsBinding = definition.supportsBinding !== false;
    const supportsFormula = definition.supportsFormula !== false;
    if (
      !component ||
      (!supportsBinding && !supportsFormula && component.type !== "toggle" && !componentSupportsRoller(component))
    ) {
      return [];
    }
    if (component.type === "input" && (component.variant || "text") === "select") {
      const controls = [
        createBindingFormulaInput(component, {
          labelText: "Source",
          placeholder: "@data.options",
          bindingKey: "sourceBinding",
          formulaKey: null,
          supportsFormula: false,
          allowedFieldCategories: ["array", "object"],
          afterCommit: ({ draft, result }) => {
            if (!result || result.type === "empty") {
              draft.sourceBinding = "";
            }
          },
        }),
        createBindingFormulaInput(component, {
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: ["string", "number"],
        }),
      ];
      appendRollerControl(controls, component);
      return controls;
    }
    if (component.type === "select-group") {
      const controls = [
        createBindingFormulaInput(component, {
          labelText: "Source",
          placeholder: "@metadata.options",
          bindingKey: "sourceBinding",
          formulaKey: null,
          supportsFormula: false,
          allowedFieldCategories: ["array", "object"],
          afterCommit: ({ draft, result }) => {
            if (!result || result.type === "empty") {
              draft.sourceBinding = "";
            }
          },
        }),
      ];
      controls.push(
        createBindingFormulaInput(component, {
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: component.multiple ? ["array", "object"] : ["string", "number"],
        })
      );
      appendRollerControl(controls, component);
      return controls;
    }
    if (component.type === "toggle") {
      const controls = [
        createBindingFormulaInput(component, {
          labelText: "Source",
          placeholder: "@metadata.states",
          bindingKey: "statesBinding",
          formulaKey: null,
          allowedFieldCategories: ["array"],
          supportsFormula: false,
          afterCommit: ({ draft, result }) => {
            if (!result || result.type === "empty") {
              draft.statesBinding = "";
            }
          },
        }),
        createBindingFormulaInput(component, {
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: ["string", "number"],
        }),
      ];
      appendRollerControl(controls, component);
      return controls;
    }
    const controls = [];
    if (supportsBinding || supportsFormula) {
      controls.push(
        createBindingFormulaInput(component, {
          supportsBinding,
          supportsFormula,
        })
      );
    }
    appendRollerControl(controls, component);
    return controls;
  }

  function captureFocusSnapshot(container, dataAttribute) {
    if (!container) {
      return null;
    }
    const active = document.activeElement;
    if (!active || !container.contains(active)) {
      return null;
    }
    const id = active.id || active.getAttribute(dataAttribute);
    if (!id) {
      return null;
    }
    const snapshot = { id };
    if (typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
    }
    return snapshot;
  }

  function restoreFocusSnapshot(container, snapshot, dataAttribute) {
    if (!snapshot || !snapshot.id || !container) {
      return;
    }
    const escaped = escapeCss(snapshot.id);
    if (!escaped) {
      return;
    }
    const target =
      container.querySelector(`#${escaped}`) ||
      container.querySelector(`[${dataAttribute}="${escaped}"]`);
    if (!target || typeof target.focus !== "function") {
      return;
    }
    try {
      target.focus({ preventScroll: true });
      if (
        typeof snapshot.selectionStart === "number" &&
        typeof snapshot.selectionEnd === "number" &&
        typeof target.setSelectionRange === "function"
      ) {
        target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      }
    } catch (error) {
      // ignore focus restoration errors
    }
  }

  function captureInspectorFocus() {
    return captureFocusSnapshot(elements.inspector, "data-inspector-field");
  }

  function restoreInspectorFocus(snapshot) {
    restoreFocusSnapshot(elements.inspector, snapshot, "data-inspector-field");
  }

  function captureTemplatePropertiesFocus() {
    return captureFocusSnapshot(elements.templateProperties, "data-template-field");
  }

  function restoreTemplatePropertiesFocus(snapshot) {
    restoreFocusSnapshot(elements.templateProperties, snapshot, "data-template-field");
  }

  function createSection(title, controls = []) {
    const filtered = controls.filter(Boolean);
    if (!filtered.length) return null;
    const section = document.createElement("section");
    section.className = "d-flex flex-column gap-3";
    if (title) {
      const heading = document.createElement("div");
      heading.className = "text-uppercase fs-6 fw-semibold text-body-secondary";
      heading.textContent = title;
      section.appendChild(heading);
    }
    filtered.forEach((control) => section.appendChild(control));
    return section;
  }

  function createColorRow(component, keys = []) {
    const controls = keys.filter((key) => COLOR_FIELD_MAP[key]);
    if (!controls.length) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = "Colors";
    wrapper.appendChild(label);
    const grid = document.createElement("div");
    grid.className = "template-color-grid";
    if (controls.length >= 3) {
      grid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    } else if (controls.length > 0) {
      grid.style.gridTemplateColumns = `repeat(${controls.length}, minmax(0, 1fr))`;
    }
    controls.forEach((key) => {
      const config = COLOR_FIELD_MAP[key];
      grid.appendChild(
        createColorInput(component, config.label, component[config.prop], (value) => {
          updateComponent(component.uid, (draft) => {
            draft[config.prop] = value;
          }, { rerenderCanvas: true, rerenderInspector: true });
        })
      );
    });
    wrapper.appendChild(grid);
    return wrapper;
  }

  // Ported from Press's own border fields (press/index.html:1528-1572) —
  // shown alongside the Border color swatch whenever a component supports
  // "border" in its colorControls, same gating the swatch itself already
  // uses. Without width/style, a border color alone renders nothing (a
  // 0-width border is invisible regardless of color).
  function createBorderControls(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = "Border";
    wrapper.appendChild(heading);

    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2 flex-wrap";
    row.appendChild(
      createNumberInput(component, "Thickness (px)", component.borderWidth ?? 1, (value) => {
        updateComponent(component.uid, (draft) => {
          draft.borderWidth = value === null ? 1 : value;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 12, step: 1 })
    );
    row.appendChild(
      createNumberInput(component, "Corner radius (px)", component.borderRadius ?? 0, (value) => {
        updateComponent(component.uid, (draft) => {
          draft.borderRadius = value === null ? 0 : value;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 24, step: 1 })
    );
    wrapper.appendChild(row);

    const styleWrapper = document.createElement("div");
    styleWrapper.className = "d-flex flex-column";
    const styleId = toId([component.uid, "border-style"]);
    const styleLabel = document.createElement("label");
    styleLabel.className = "form-label fw-semibold text-body-secondary";
    styleLabel.setAttribute("for", styleId);
    styleLabel.textContent = "Style";
    const styleSelect = document.createElement("select");
    styleSelect.className = "form-select";
    styleSelect.id = styleId;
    BORDER_STYLE_OPTIONS.forEach(({ value, label: optionLabel }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      if ((component.borderStyle || "solid") === value) {
        option.selected = true;
      }
      styleSelect.appendChild(option);
    });
    styleSelect.addEventListener("change", () => {
      updateComponent(component.uid, (draft) => {
        draft.borderStyle = styleSelect.value;
      }, { rerenderCanvas: true });
    });
    styleWrapper.append(styleLabel, styleSelect);
    wrapper.appendChild(styleWrapper);

    wrapper.appendChild(
      createInspectorToggleGroup(
        component,
        "Sides",
        [
          { value: "top", label: "Top" },
          { value: "right", label: "Right" },
          { value: "bottom", label: "Bottom" },
          { value: "left", label: "Left" },
        ],
        component.borderSides || DEFAULT_BORDER_SIDES,
        (key, checked) => {
          updateComponent(component.uid, (draft) => {
            draft.borderSides = { ...(draft.borderSides || DEFAULT_BORDER_SIDES) };
            draft.borderSides[key] = checked;
          }, { rerenderCanvas: true });
        }
      )
    );

    return wrapper;
  }

  function createColorInput(component, labelText, value, onChange) {
    const container = document.createElement("div");
    container.className = "template-color-control";
    const id = toId([component.uid, labelText, "color"]);
    const label = document.createElement("label");
    label.className = "form-label small text-body-secondary mb-0";
    label.setAttribute("for", id);
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "color";
    input.className = "form-control form-control-color";
    input.id = id;
    input.value = value || "#000000";
    input.addEventListener("input", () => {
      onChange(input.value);
    });
    const controls = document.createElement("div");
    controls.className = "d-flex align-items-center gap-2";
    controls.appendChild(input);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn btn-outline-secondary btn-sm";
    clear.innerHTML = '<span class="iconify" data-icon="tabler:circle-off" aria-hidden="true"></span>';
    clear.setAttribute("aria-label", `Clear ${labelText.toLowerCase()} color`);
    clear.setAttribute("data-bs-toggle", "tooltip");
    clear.setAttribute("data-bs-placement", "top");
    clear.setAttribute("data-bs-title", "Reset to default");
    clear.addEventListener("click", () => {
      input.value = "#000000";
      onChange("");
    });
    controls.appendChild(clear);
    container.append(label, controls);
    if (window.bootstrap && typeof window.bootstrap.Tooltip === "function") {
      // eslint-disable-next-line no-new
      new window.bootstrap.Tooltip(clear);
    }
    return container;
  }

  // Replaces the old single Text Size radio group with Press's own fuller
  // system (common/js/lib/font-picker.js, common/js/lib/text-size.js) —
  // Font, a 5-step Text Size preset + Auto, a custom Font Size (pt)
  // override, and Line Height. Same call site/gating
  // (componentHasTextControls) the old control used.
  function createTextFormattingControls(component) {
    const controls = [createFontFamilyControl(component)];

    const sizeOptions = [
      { value: "xs", label: "Xs" },
      { value: "sm", label: "Sm" },
      { value: "md", label: "Md" },
      { value: "lg", label: "Lg" },
      { value: "xl", label: "Xl" },
      { value: "auto", label: "Auto" },
    ];
    // component.fontSizeCustom != null first, not just Number.isFinite(Number(...))
    // on its own — Number(null) coerces to 0, a "finite number", which
    // wrongly made a just-cleared custom size (set back to null when a
    // preset is clicked) look like it was still "custom, and set to 0pt":
    // the radio group would show nothing checked, and the pt field would
    // display 0 — even though the preset click itself worked correctly.
    const hasCustomSize = component.fontSizeCustom != null && Number.isFinite(Number(component.fontSizeCustom));
    controls.push(
      createRadioButtonGroup(
        component,
        "Text size",
        sizeOptions,
        hasCustomSize ? null : component.textSize || "md",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.textSize = value;
            // Preset and custom size are mutually exclusive — same
            // precedence Press's own textSizeInputs click handler uses.
            draft.fontSizeCustom = null;
          }, { rerenderCanvas: true, rerenderInspector: true });
        }
      )
    );

    // Always shows the pt-equivalent of whatever size is currently
    // effective (custom if set, else the preset's own px value converted),
    // matching Press's own textSizeCustomInput populate behavior — not
    // just "empty unless a custom value was explicitly typed".
    const effectivePx = hasCustomSize
      ? ptToPx(Number(component.fontSizeCustom))
      : TEXT_SIZE_PX[component.textSize] ?? TEXT_SIZE_PX.md;
    controls.push(
      createNumberInput(
        component,
        "Font size (pt)",
        hasCustomSize ? Number(component.fontSizeCustom) : Number(pxToPt(effectivePx)),
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.fontSizeCustom = value;
          }, { rerenderCanvas: true, rerenderInspector: true });
        },
        { min: 4, max: 144, step: 0.5 }
      )
    );

    controls.push(
      createNumberInput(
        component,
        "Line height",
        Number.isFinite(Number(component.lineHeight)) ? Number(component.lineHeight) : null,
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.lineHeight = value;
          }, { rerenderCanvas: true });
        },
        { min: 0.5, max: 3, step: 0.05 }
      )
    );

    return controls;
  }

  // Font input, searchable via the shared font library (common/js/lib/
  // font-picker.js/font-library.js) — same "Add a font…" modal/Google
  // Fonts flow as Press, sharing the exact same server-persisted list.
  function createFontFamilyControl(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, "Font", "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = "Font";
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.autocomplete = "off";
    input.placeholder = "Default (template font)";
    const currentFamily = typeof component.fontFamily === "string" ? component.fontFamily.trim() : "";
    const matchedOption = findFontOptionByFamily(currentFamily);
    input.value = matchedOption ? matchedOption.label : currentFamily || "Default (template font)";
    // Must run AFTER the input has a local DOM parent (append below) —
    // attachFontFamilyAutocomplete checks input.parentElement to find where
    // to attach its dropdown, same lesson learned from the Icon field
    // earlier this session.
    wrapper.append(label, input);
    attachFontFamilyAutocomplete(input, {
      onSelect: (option) => {
        updateComponent(component.uid, (draft) => {
          draft.fontFamily = option.family || "";
        }, { rerenderCanvas: true });
        input.value = option.label;
        if (option.family) {
          ensureFontLoaded(option);
        }
      },
      onAddFont: () =>
        openAddFontModal((registered) => {
          updateComponent(component.uid, (draft) => {
            draft.fontFamily = registered.family;
          }, { rerenderCanvas: true, rerenderInspector: true });
        }),
      canAddFont: () => dataManager.meetsTier("creator"),
      onAddDenied: () => status.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 }),
      onDeleteFont: (option) => handleDeleteCustomFont(option),
      canDeleteFont: () => dataManager.meetsTier("admin"),
    });
    return wrapper;
  }

  // Freeform CSS class names — same suggestion list/autocomplete as Press
  // (common/js/lib/class-name-picker.js), e.g. text-shadow-dark for a drop
  // shadow. Applied via applyComponentStyles (component-styles.js).
  function createClassNameControl(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, "Classes", "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = "Classes";
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.autocomplete = "off";
    input.placeholder = "shadow-sm text-shadow-dark";
    input.value = component.className || "";
    input.addEventListener("input", () => {
      const next = input.value.trim();
      updateComponent(component.uid, (draft) => {
        draft.className = next;
      }, { rerenderCanvas: true });
    });
    wrapper.append(label, input);
    attachClassNameAutocomplete(input);
    return wrapper;
  }

  function createTextStyleControls(component) {
    const options = [
      { value: "bold", icon: "tabler:bold" },
      { value: "italic", icon: "tabler:italic" },
      { value: "underline", icon: "tabler:underline" },
    ];
    return createInspectorToggleGroup(component, "Text decoration", options, component.textStyles || {}, (key, checked) => {
      updateComponent(component.uid, (draft) => {
        draft.textStyles = { ...(draft.textStyles || {}) };
        draft.textStyles[key] = checked;
      }, { rerenderCanvas: true });
    });
  }

  function createAlignmentControls(component) {
    const options = [
      { value: "start", icon: "tabler:align-left", label: "Left" },
      { value: "center", icon: "tabler:align-center", label: "Center" },
      { value: "end", icon: "tabler:align-right", label: "Right" },
      { value: "justify", icon: "tabler:align-justified", label: "Justify" },
    ];
    return createRadioButtonGroup(component, "Alignment", options, component.align || "start", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.align = value;
      }, { rerenderCanvas: true });
    });
  }

  function createCollapsibleToggle(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check form-switch";
    const id = toId([component.uid, "collapsible"]);
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = id;
    input.checked = !!component.collapsible;
    input.addEventListener("change", () => {
      updateComponent(component.uid, (draft) => {
        draft.collapsible = input.checked;
      }, { rerenderCanvas: true });
    });
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = "Collapsible";
    wrapper.append(input, label);
    return wrapper;
  }

  function createReadOnlyToggle(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check form-switch";
    const id = toId([component.uid, "read-only"]);
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = id;
    input.checked = !!component.readOnly;
    input.addEventListener("change", () => {
      updateComponent(component.uid, (draft) => {
        draft.readOnly = input.checked;
      }, { rerenderCanvas: true });
    });
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = "Read only";
    wrapper.append(input, label);
    return wrapper;
  }

  // Available on every component type (not gated by the registry) — a
  // genuinely new capability neither Workbench nor Press had before (Press
  // only has a static, author-set hide toggle). Left blank, the component
  // always shows; a bound value or formula is evaluated at real character-
  // view render time, never in the Template editor's own canvas preview
  // (see renderComponentCard in workbench-character-view.js) — the canvas
  // only has synthesized sample data, so hiding components there based on
  // it could make them un-selectable/un-editable for reasons the author
  // can't see.
  function createVisibilityControl(component) {
    return createBindingFormulaInput(component, {
      labelText: "Visible when",
      placeholder: "@conditions.prone or =@hitPoints.current > 0",
      bindingKey: "visibilityBinding",
      formulaKey: "visibilityFormula",
      supportsFormula: true,
      helperText: "Leave blank to always show.",
    });
  }

  // Available on every component type, same as Visible when above — real
  // CSS shorthand (1-4 space-separated values), not a Workbench-specific
  // spacing concept. Margin is also what replaces every hardcoded
  // stacking "gap" this codebase used to have (dropzones, canvas roots,
  // Container cells) — a component's own Margin is now the one thing that
  // controls its spacing from its siblings, the ordinary CSS way.
  function createSpacingControls(component) {
    return [
      createTextInput(component, "Padding", component.padding || "", (value) => {
        const next = value.trim();
        updateComponent(component.uid, (draft) => {
          if (next) draft.padding = next;
          else delete draft.padding;
        }, { rerenderCanvas: true });
      }, { placeholder: "8px or 4px 8px 12px 16px" }),
      createTextInput(component, "Margin", component.margin || "", (value) => {
        const next = value.trim();
        updateComponent(component.uid, (draft) => {
          if (next) draft.margin = next;
          else delete draft.margin;
        }, { rerenderCanvas: true });
      }, { placeholder: "8px or 4px 8px 12px 16px" }),
    ];
  }

  function createBindingFormulaInput(
    component,
    {
      supportsBinding = true,
      supportsFormula = true,
      labelText = "Binding / Formula",
      placeholder = null,
      bindingKey = "binding",
      formulaKey = "formula",
      // When set, a value that's neither "@..." nor "=..." is treated as
      // literal text and written here instead of bindingKey — this is what
      // makes the field a true combined Binding/Text control (Text's own
      // inspector uses this; every other existing caller leaves it unset,
      // which preserves their exact previous behavior: a bare non-@ value
      // still goes into bindingKey as before, e.g. Track's Segments field
      // storing a plain "6").
      textKey = null,
      allowedFieldCategories: categoryOverride = null,
      helperText = null,
      afterCommit = null,
    } = {}
  ) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-1";
    const id = toId([component.uid, "binding-formula"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = labelText;

    const allowedFieldCategories = Array.isArray(categoryOverride) && categoryOverride.length
      ? categoryOverride.map((category) => String(category).toLowerCase())
      : getComponentBindingCategories(component);

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "position-relative";

    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    const resolvedPlaceholder =
      placeholder !== null && placeholder !== undefined
        ? placeholder
        : supportsFormula
        ? "@attributes.score or =sum(@attributes.strength, @attributes.dexterity)"
        : "@attributes.score";
    input.placeholder = resolvedPlaceholder || "";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = getBindingEditorValue(component, { bindingKey, formulaKey, textKey });
    input.setAttribute("aria-autocomplete", "list");

    const suggestions = document.createElement("div");
    suggestions.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    suggestions.id = `${id}-suggestions`;
    suggestions.setAttribute("role", "listbox");
    suggestions.style.zIndex = "1300";
    suggestions.style.fontSize = "0.8125rem";
    suggestions.style.maxHeight = "16rem";
    suggestions.style.overflowY = "auto";
    input.setAttribute("aria-controls", suggestions.id);

    inputWrapper.append(input, suggestions);
    wrapper.append(label, inputWrapper);

    const MAX_SUGGESTIONS = 12;
    let listeningForUpdates = false;

    const handleBindingFieldsReady = () => {
      if (document.activeElement === input) {
        autocomplete.update();
      }
    };

    function getFieldSuggestions(query = "") {
      if (!supportsBinding) {
        return [];
      }
      const normalized = query.trim().toLowerCase();
      const entries = Array.isArray(state.bindingFields) ? state.bindingFields : [];
      const typed = entries.filter((entry) => fieldMatchesCategories(entry, allowedFieldCategories));
      const filtered = normalized
        ? typed.filter((entry) => {
            const path = entry.path?.toLowerCase?.() || "";
            const labelText = entry.label?.toLowerCase?.() || "";
            return path.includes(normalized) || labelText.includes(normalized);
          })
        : typed;
      return filtered.slice(0, MAX_SUGGESTIONS).map((entry) => {
        const category = entry.category || categorizeFieldType(entry.type);
        return {
          type: "field",
          path: entry.path,
          display: `@${entry.path}`,
          description: entry.label && entry.label !== entry.path ? entry.label : "",
          fieldType: entry.type || "",
          fieldCategory: category || "",
        };
      });
    }

    function getFunctionSuggestions(query = "") {
      if (!supportsFormula) {
        return [];
      }
      const normalized = query.trim().toLowerCase();
      const entries = normalized
        ? FORMULA_FUNCTIONS.filter((fn) => fn.name.toLowerCase().startsWith(normalized))
        : FORMULA_FUNCTIONS;
      return entries.slice(0, MAX_SUGGESTIONS).map((fn) => ({
        type: "function",
        name: fn.name,
        display: fn.signature,
        description: fn.name,
      }));
    }

    function commitValue(raw) {
      const source = typeof raw === "string" ? raw : "";
      const trimmed = source.trim();
      let result = { type: "empty", value: "" };
      updateComponent(
        component.uid,
        (draft) => {
          if (!trimmed) {
            if (bindingKey) {
              draft[bindingKey] = "";
            }
            if (supportsFormula && formulaKey) {
              draft[formulaKey] = "";
            }
            if (textKey) {
              draft[textKey] = "";
            }
            result = { type: "empty", value: "" };
          } else if (supportsFormula && trimmed.startsWith("=")) {
            const expression = trimmed.slice(1).trim();
            if (formulaKey) {
              draft[formulaKey] = expression;
            }
            if (bindingKey) {
              draft[bindingKey] = "";
            }
            if (textKey) {
              draft[textKey] = "";
            }
            result = { type: "formula", value: expression };
          } else if (textKey && !trimmed.startsWith("@")) {
            // Plain literal text (textKey configured, and this isn't a
            // binding path either) — the case createBindingFormulaInput
            // never handled before: everyone else's field is purely a
            // binding-path selector, where a bare value like a number is
            // still meant for bindingKey (see Track's Segments), not a
            // literal-text concept at all.
            draft[textKey] = trimmed;
            if (bindingKey) {
              draft[bindingKey] = "";
            }
            if (supportsFormula && formulaKey) {
              draft[formulaKey] = "";
            }
            result = { type: "text", value: trimmed };
          } else {
            if (bindingKey) {
              draft[bindingKey] = supportsBinding ? trimmed : "";
            }
            if (supportsFormula && formulaKey) {
              draft[formulaKey] = "";
            }
            if (textKey) {
              draft[textKey] = "";
            }
            result = { type: "binding", value: trimmed };
          }
          if (typeof afterCommit === "function") {
            afterCommit({ draft, raw: source, trimmed, result });
          }
        },
        { rerenderCanvas: true }
      );
    }

    const autocomplete = attachFormulaAutocomplete(input, {
      container: suggestions,
      supportsBinding,
      supportsFunctions: supportsFormula,
      getFieldItems: (query) => getFieldSuggestions(query),
      getFunctionItems: (query) => getFunctionSuggestions(query),
      resolveFieldMeta: resolveFieldTypeMeta,
      maxItems: MAX_SUGGESTIONS,
      applySuggestion: ({ applyDefault }) => {
        applyDefault();
        commitValue(input.value);
      },
    });

    input.addEventListener("input", () => {
      commitValue(input.value);
      autocomplete.update();
    });

    input.addEventListener("focus", () => {
      if (!listeningForUpdates) {
        window.addEventListener(BINDING_FIELDS_EVENT, handleBindingFieldsReady);
        listeningForUpdates = true;
      }
      autocomplete.update();
    });

    input.addEventListener("click", () => {
      autocomplete.update();
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        autocomplete.close();
        if (listeningForUpdates) {
          window.removeEventListener(BINDING_FIELDS_EVENT, handleBindingFieldsReady);
          listeningForUpdates = false;
        }
      }, 120);
    });

    if (helperText) {
      const helper = document.createElement("div");
      helper.className = "form-text text-body-secondary";
      helper.textContent = helperText;
      wrapper.appendChild(helper);
    }

    if (supportsBinding && !state.bindingFields.length) {
      const helper = document.createElement("div");
      helper.className = "form-text text-body-secondary";
      helper.textContent = state.template?.schema
        ? "No fields available for this system yet."
        : "Select a system to enable bindings.";
      wrapper.appendChild(helper);
    }

    return wrapper;
  }

  function createTextInput(component, labelText, value, onInput, { placeholder = "", type = "text" } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, labelText, "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = labelText;
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = type;
    input.id = id;
    if (placeholder) input.placeholder = placeholder;
    input.value = value ?? "";
    input.addEventListener("input", () => {
      onInput(input.value);
    });
    wrapper.append(label, input);
    return wrapper;
  }

  function createTextarea(component, labelText, value, onInput, { rows = 3, placeholder = "" } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, labelText, "textarea"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = labelText;
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.id = id;
    textarea.rows = rows;
    if (placeholder) textarea.placeholder = placeholder;
    textarea.value = value ?? "";
    textarea.addEventListener("input", () => {
      onInput(textarea.value);
    });
    wrapper.append(label, textarea);
    return wrapper;
  }

  function createNumberInput(component, labelText, value, onChange, { min, max, step = 1 } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, labelText, "number"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = labelText;
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "number";
    input.id = id;
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.step = String(step);
    if (value !== undefined && value !== null) {
      input.value = value;
    }
    input.addEventListener("input", () => {
      const next = input.value === "" ? null : Number(input.value);
      if (next !== null && Number.isNaN(next)) {
        return;
      }
      onChange(next);
    });
    wrapper.append(label, input);
    return wrapper;
  }

  function createRadioButtonGroup(
    component,
    labelText,
    options,
    currentValue,
    onChange,
    config = {}
  ) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = labelText;
    wrapper.appendChild(heading);
    const group = document.createElement("div");
    group.className = "btn-group template-radio-group";
    if (config.forceSingleRow) {
      group.classList.add("template-radio-group--single-row");
    }
    const name = toId([component.uid, labelText, "radio"]);
    options.forEach((option, index) => {
      const id = toId([component.uid, labelText, option.value, index]);
      const input = document.createElement("input");
      input.type = "radio";
      input.className = "btn-check";
      input.name = name;
      input.id = id;
      input.value = option.value;
      input.checked = option.value === currentValue;
      input.addEventListener("change", () => {
        if (input.checked) {
          onChange(option.value);
        }
      });
      const label = document.createElement("label");
      label.className = "btn btn-outline-secondary btn-sm";
      label.setAttribute("for", id);

      if (option.icon) {
        const icon = document.createElement("span");
        icon.className = "iconify";
        icon.dataset.icon = option.icon;
        icon.setAttribute("aria-hidden", "true");
        label.appendChild(icon);
      }

      const labelTextNode = option.label ?? option.value;
      if (labelTextNode) {
        const text = document.createElement("span");
        text.className = "template-radio-label";
        text.textContent = labelTextNode;
        label.appendChild(text);
      }

      group.append(input, label);
    });
    wrapper.appendChild(group);
    return wrapper;
  }

  function createInspectorToggleGroup(component, labelText, options, values, onToggle) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = labelText;
    wrapper.appendChild(heading);
    const group = document.createElement("div");
    group.className = "btn-group";
    options.forEach((option, index) => {
      const id = toId([component.uid, labelText, option.value, index]);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "btn-check";
      input.id = id;
      input.autocomplete = "off";
      input.checked = !!values[option.value];
      input.addEventListener("change", () => {
        onToggle(option.value, input.checked);
      });
      const label = document.createElement("label");
      label.className = "btn btn-outline-secondary btn-sm";
      label.setAttribute("for", id);
      if (option.icon) {
        label.innerHTML = `<span class="iconify" data-icon="${option.icon}" aria-hidden="true"></span>`;
      }
      if (option.label) {
        label.innerHTML += `<span class="ms-1">${option.label}</span>`;
      }
      group.append(input, label);
    });
    wrapper.appendChild(group);
    return wrapper;
  }

  function renderComponentSpecificInspector(component) {
    switch (component.type) {
      case "input":
        return renderInputInspector(component);
      case "repeater":
        return renderRepeaterInspector(component);
      case "image":
        return renderImageInspector(component);
      case "icon":
        return renderIconInspector(component);
      case "text":
        return renderTextInspector(component);
      case "container":
        return renderContainerInspector(component);
      case "track":
        return renderTrackInspector(component);
      case "select-group":
        return renderSelectGroupInspector(component);
      case "toggle":
        return renderToggleInspector(component);
      default:
        return [];
    }
  }

  function renderInputInspector(component) {
    const controls = [];
    const options = [
      { value: "text", icon: "tabler:letter-case", label: "Text" },
      { value: "textarea", icon: "tabler:notes", label: "Text area" },
      { value: "number", icon: "tabler:123", label: "Number" },
      { value: "select", icon: "tabler:list-details", label: "Select" },
      { value: "radio", icon: "tabler:circle-dot", label: "Radio" },
      { value: "checkbox", icon: "tabler:checkbox", label: "Checkbox" },
    ];
    controls.push(
      createRadioButtonGroup(
        component,
        "Type",
        options,
        component.variant || "text",
        (value) => {
          updateComponent(
            component.uid,
            (draft) => {
              draft.variant = value;
              if (value === "textarea" && !Number.isFinite(Number(draft.rows))) {
                draft.rows = 3;
              }
              if (
                (value === "select" || value === "radio" || value === "checkbox") &&
                (!Array.isArray(draft.options) || !draft.options.length)
              ) {
                draft.options = ["Option A", "Option B"];
              }
            },
            { rerenderCanvas: true, rerenderInspector: true }
          );
        },
        { forceSingleRow: true }
      )
    );
    controls.push(
      createTextInput(component, "Placeholder", component.placeholder || "", (value) => {
        updateComponent(component.uid, (draft) => {
          draft.placeholder = value;
        }, { rerenderCanvas: true });
      }, { placeholder: "Shown inside the field" })
    );
    if ((component.variant || "text") === "textarea") {
      controls.push(
        createNumberInput(component, "Rows", component.rows ?? 3, (value) => {
          const next = clampInteger(value ?? 3, 2, 12);
          updateComponent(component.uid, (draft) => {
            draft.rows = next;
          }, { rerenderCanvas: true });
        }, { min: 2, max: 12 })
      );
    }
    return controls;
  }

  // No component-specific controls beyond the generic Data section's own
  // Binding field (which array repeats) — the item's own layout is authored
  // directly on canvas (see renderRepeaterPreview), the same way a
  // Container's zones have no inspector fields of their own either.
  // Ported from Press's own Repeater decorator (none/bullet/number/custom)
  // — the item's own layout is still authored on canvas (no controls for
  // that here, same as before), but the decorator is a small enough,
  // structural-not-content knob that it belongs in the inspector like
  // everything else's Type/Shape selectors.
  function createRepeaterHeaderToggle(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check form-switch";
    const id = toId([component.uid, "repeater-header"]);
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "checkbox";
    input.id = id;
    input.checked = !!component.showHeader;
    input.addEventListener("change", () => {
      updateComponent(component.uid, (draft) => {
        draft.showHeader = input.checked;
        ensureRepeaterZone(draft);
      }, { rerenderCanvas: true, rerenderInspector: true });
    });
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = "Header row";
    wrapper.append(input, label);
    return wrapper;
  }

  function renderRepeaterInspector(component) {
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : { type: "none" };
    const columns = clampInteger(component.columns || 1, 1, MAX_REPEATER_COLUMNS);
    const controls = [];
    controls.push(
      createNumberInput(component, "Columns", columns, (value) => {
        updateComponent(component.uid, (draft) => {
          draft.columns = value === null ? 1 : clampInteger(value, 1, MAX_REPEATER_COLUMNS);
          ensureRepeaterZone(draft);
        }, { rerenderCanvas: true, rerenderInspector: true });
      }, { min: 1, max: MAX_REPEATER_COLUMNS, step: 1 })
    );
    if (columns > 1) {
      controls.push(
        createTextInput(component, "Column widths", component.templateColumns || "", (value) => {
          const next = value.trim();
          updateComponent(component.uid, (draft) => {
            if (next) draft.templateColumns = next;
            else delete draft.templateColumns;
          }, { rerenderCanvas: true });
        }, { placeholder: "30% 70%" })
      );
    }
    controls.push(createRepeaterHeaderToggle(component));
    controls.push(
      createRadioButtonGroup(
        component,
        "Item decorator",
        [
          { value: "none", icon: "tabler:minus", label: "None" },
          { value: "bullet", icon: "tabler:point-filled", label: "Bullet" },
          { value: "number", icon: "tabler:list-numbers", label: "Number" },
          { value: "custom", icon: "tabler:pencil", label: "Custom" },
        ],
        decorator.type || "none",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.decorator = value === "custom" ? { type: "custom", text: draft.decorator?.text || "" } : { type: value };
          }, { rerenderCanvas: true, rerenderInspector: true });
        }
      )
    );
    if (decorator.type === "custom") {
      controls.push(
        createTextInput(component, "Decorator text", decorator.text || "", (value) => {
          updateComponent(component.uid, (draft) => {
            draft.decorator = { type: "custom", text: value };
          }, { rerenderCanvas: true });
        }, { placeholder: "→ or @icon" })
      );
    }
    return controls;
  }

  // URL text input + the pattern/shape picker's own "brush" trigger button
  // alongside it — the one piece of the Image inspector that isn't a plain
  // createTextInput, since it needs a second control in the same row.
  function createImageUrlControl(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, "Image URL", "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = "Image URL";
    const row = document.createElement("div");
    row.className = "d-flex gap-1";
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.placeholder = "https://";
    input.value = resolveImageUrl(component);
    input.addEventListener("input", () => {
      updateComponent(component.uid, (draft) => {
        draft.url = input.value;
      }, { rerenderCanvas: true });
    });
    const patternButton = document.createElement("button");
    patternButton.type = "button";
    patternButton.className = "btn btn-outline-secondary";
    patternButton.title = "Insert a pattern or shape";
    patternButton.setAttribute("aria-label", "Insert a pattern or shape");
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = "tabler:brush";
    icon.setAttribute("aria-hidden", "true");
    patternButton.appendChild(icon);
    patternButton.addEventListener("click", () => openPatternPicker(component, input));
    row.append(input, patternButton);
    wrapper.append(label, row);
    return wrapper;
  }

  function renderImageInspector(component) {
    const controls = [];
    controls.push(createImageUrlControl(component));
    controls.push(
      createTextInput(component, "Alt text", component.alt || "", (value) => {
        updateComponent(component.uid, (draft) => {
          draft.alt = value;
        }, { rerenderCanvas: true });
      }, { placeholder: "Describe the image" })
    );
    controls.push(
      createRadioButtonGroup(
        component,
        "Fit",
        [
          { value: "cover", label: "Cover" },
          { value: "contain", label: "Contain" },
          { value: "fill", label: "Fill" },
        ],
        component.fit || "cover",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.fit = value;
          }, { rerenderCanvas: true });
        }
      )
    );
    controls.push(
      createTextInput(component, "Width", component.width || "", (value) => {
        const next = value.trim();
        updateComponent(component.uid, (draft) => {
          draft.width = next;
        }, { rerenderCanvas: true });
      }, { placeholder: "100% or 320px" })
    );
    controls.push(
      createTextInput(component, "Height", component.height || "", (value) => {
        const next = value.trim();
        updateComponent(component.uid, (draft) => {
          draft.height = next;
        }, { rerenderCanvas: true });
      }, { placeholder: "auto or 200px" })
    );
    controls.push(
      createNumberInput(component, "Corner radius (px)", component.cornerRadius ?? 0, (value) => {
        const next = clampInteger(value ?? 0, 0, 200);
        updateComponent(component.uid, (draft) => {
          draft.cornerRadius = next;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 200 })
    );
    controls.push(
      createNumberInput(component, "Pan X (%)", component.focalX ?? 50, (value) => {
        const next = clampInteger(value ?? 50, 0, 100);
        updateComponent(component.uid, (draft) => {
          draft.focalX = next;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 100 })
    );
    controls.push(
      createNumberInput(component, "Pan Y (%)", component.focalY ?? 50, (value) => {
        const next = clampInteger(value ?? 50, 0, 100);
        updateComponent(component.uid, (draft) => {
          draft.focalY = next;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 100 })
    );
    controls.push(
      createNumberInput(component, "Zoom", component.zoom ?? 1, (value) => {
        const next = Math.max(0.5, Math.min(3, Number(value) || 1));
        updateComponent(component.uid, (draft) => {
          draft.zoom = next;
        }, { rerenderCanvas: true });
      }, { min: 0.5, max: 3, step: 0.1 })
    );
    return controls;
  }

  // Pattern/shape picker modal (Image component) — full port of Press's own
  // implementation (press/js/app.js), adapted from Press's "write onto
  // whatever the selected node is" model to Workbench's own
  // updateComponent(uid, ...) write path. The generator functions
  // themselves (getPresetsByCategory/svgToDataUri/embedPatternMetadata/
  // extractPatternMetadata) come from the shared common/js/lib/
  // pattern-library.js — Press imports the exact same module, so both
  // tools' pickers stay identical. State (selectedPatternPreset etc.) lives
  // near the top of this file, not here, since initPatternModal() runs
  // early during init — a `let` declared this far down wouldn't be
  // initialized yet (TDZ) the first time these functions run.

  function renderPatternThumbnails(categoryId) {
    if (!elements.patternThumbnails) return;
    elements.patternThumbnails.innerHTML = "";
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
    elements.patternThumbnails.appendChild(fragment);
  }

  function updatePatternPreview() {
    if (!selectedPatternPreset || !elements.patternPreview) return;
    elements.patternPreview.src = svgToDataUri(selectedPatternPreset.buildSvg(currentPatternValues));
  }

  // Splits a pattern color value (6-digit hex, 8-digit hex-with-alpha, the
  // legacy "transparent" keyword, or anything unrecognized) into a real hex
  // swatch plus a 0-100 opacity percentage — the pairing <input type="color">
  // + <input type="range"> below uses to represent one combined value as
  // two separate widgets, since color inputs only ever accept opaque
  // 6-digit hex.
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
  // encoding needed; full opacity collapses back to plain 6-digit hex to
  // keep the common (fully opaque) case as a normal-looking color.
  function combineColorAlpha(hex, alphaPercent) {
    const clamped = Math.max(0, Math.min(100, Number(alphaPercent) || 0));
    if (clamped >= 100) return hex;
    const alphaHex = Math.round((clamped / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${hex}${alphaHex}`;
  }

  function renderPatternControls(preset) {
    if (!elements.patternControls) return;
    elements.patternControls.innerHTML = "";
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
    elements.patternControls.appendChild(fragment);
  }

  function selectPatternPreset(preset, initialValues) {
    selectedPatternPreset = preset;
    currentPatternValues = initialValues ?? getPresetDefaultValues(preset);
    if (elements.patternPreviewLabel) elements.patternPreviewLabel.textContent = preset.label;
    if (elements.patternInsert) elements.patternInsert.disabled = false;
    renderPatternControls(preset);
    updatePatternPreview();
    elements.patternThumbnails?.querySelectorAll("[data-pattern-id]").forEach((button) => {
      button.classList.toggle("active", button.dataset.patternId === preset.id);
    });
  }

  // Mirrors the modal's own default (unselected) markup exactly — used when
  // the picker opens on a field that isn't a pattern this picker generated
  // (a plain image, a hand-pasted URL, or nothing), so a stale selection
  // from a previously-edited component can't be mistaken for the current one.
  function resetPatternSelection() {
    selectedPatternPreset = null;
    currentPatternValues = {};
    if (elements.patternPreviewLabel) elements.patternPreviewLabel.textContent = "Select a pattern";
    if (elements.patternInsert) elements.patternInsert.disabled = true;
    if (elements.patternControls) elements.patternControls.innerHTML = "";
    if (elements.patternPreview) elements.patternPreview.removeAttribute("src");
    elements.patternThumbnails?.querySelectorAll("[data-pattern-id]").forEach((button) => {
      button.classList.remove("active");
    });
  }

  function openPatternPicker(component, input) {
    if (!window.bootstrap?.Modal || !elements.patternModal) return;
    patternPickerComponentUid = component.uid;
    patternPickerInput = input;
    // Re-detect on every open (not just once) — the field can belong to a
    // different component than the last time the modal was open, so its
    // current value is the only thing that should drive this, not whatever
    // was left selected before.
    const detected = extractPatternMetadata(input?.value ?? "");
    if (detected) {
      const categoryInput = elements.patternCategoryInputs.find((entry) => entry.value === detected.preset.category);
      if (categoryInput) {
        categoryInput.checked = true;
        renderPatternThumbnails(detected.preset.category);
      }
      selectPatternPreset(detected.preset, detected.values);
    } else {
      resetPatternSelection();
    }
    window.bootstrap.Modal.getOrCreateInstance(elements.patternModal).show();
  }

  function initPatternModal() {
    if (!elements.patternModal) return;
    renderPatternThumbnails(PATTERN_CATEGORIES[0]?.id ?? "fills");
    // Switching category tabs only changes which thumbnails are shown — the
    // current selection (preview, controls, Insert button) stays exactly as
    // it was, even if the selected preset belongs to a different category,
    // until the user actually clicks a new thumbnail.
    elements.patternCategoryInputs.forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        renderPatternThumbnails(input.value);
      });
    });
    if (elements.patternInsert) {
      elements.patternInsert.addEventListener("click", () => {
        if (!selectedPatternPreset || !patternPickerComponentUid) return;
        const svg = embedPatternMetadata(
          selectedPatternPreset.buildSvg(currentPatternValues),
          selectedPatternPreset.id,
          currentPatternValues
        );
        const dataUri = svgToDataUri(svg);
        if (patternPickerInput) patternPickerInput.value = dataUri;
        updateComponent(patternPickerComponentUid, (draft) => {
          draft.url = dataUri;
        }, { rerenderCanvas: true, rerenderInspector: true });
        window.bootstrap?.Modal?.getInstance(elements.patternModal)?.hide();
      });
    }
  }

  function resetAddFontValidationState() {
    pendingValidatedFont = null;
    if (elements.addFontSubmitButton) elements.addFontSubmitButton.disabled = true;
    if (elements.addFontWarningElement) {
      elements.addFontWarningElement.textContent = "";
      elements.addFontWarningElement.classList.add("d-none");
    }
  }

  // Opens the shared Add Font modal — `onApply(registeredFont)` is called
  // once a font is validated and confirmed (see initAddFontModal's submit
  // handler), so the same modal serves both a component's own Font field
  // and the Template's own base font, each owning what "apply" means for
  // itself.
  function openAddFontModal(onApply) {
    if (!window.bootstrap?.Modal || !elements.addFontModal || typeof onApply !== "function") return;
    addFontApplyCallback = onApply;
    if (elements.addFontValueInput) elements.addFontValueInput.value = "";
    resetAddFontValidationState();
    window.bootstrap.Modal.getOrCreateInstance(elements.addFontModal).show();
  }

  async function handleAddFontValueBlur() {
    const raw = (elements.addFontValueInput?.value || "").trim();
    if (!raw) {
      resetAddFontValidationState();
      return;
    }
    pendingValidatedFont = null;
    if (elements.addFontSubmitButton) elements.addFontSubmitButton.disabled = true;
    if (elements.addFontWarningElement) {
      elements.addFontWarningElement.className = "small text-body-secondary";
      elements.addFontWarningElement.textContent = "Checking…";
      elements.addFontWarningElement.classList.remove("d-none");
    }
    try {
      const font = await validateFontInput(raw);
      // The field can change while this async check is in flight — only
      // trust the result if it still matches what's actually typed.
      if ((elements.addFontValueInput?.value || "").trim() !== raw) return;
      pendingValidatedFont = font;
      if (elements.addFontWarningElement) elements.addFontWarningElement.classList.add("d-none");
      if (elements.addFontSubmitButton) elements.addFontSubmitButton.disabled = false;
    } catch (error) {
      if ((elements.addFontValueInput?.value || "").trim() !== raw) return;
      if (elements.addFontWarningElement) {
        elements.addFontWarningElement.className = "small text-danger";
        elements.addFontWarningElement.textContent = error.message || "Couldn't validate this font.";
        elements.addFontWarningElement.classList.remove("d-none");
      }
    }
  }

  // A shared library file, persisted with no in-app undo — unlike this
  // app's own undo-backed component edits, a confirmation here is
  // warranted since there's no Ctrl+Z to get it back.
  async function handleDeleteCustomFont(option) {
    if (!window.confirm(`Delete "${option.label}" from the font library? This can't be undone, and removes it for everyone.`)) {
      return;
    }
    deleteCustomFont(option.id);
    try {
      await saveCustomFontDeletion(option.id, dataManager?.session?.token);
      status.show(`Deleted "${option.label}" from the font library.`, { type: "success", timeout: 2500 });
    } catch (error) {
      status.show(error.message || "Unable to delete this font.", { type: "error", timeout: 4000 });
    }
    renderInspector();
  }

  function initAddFontModal() {
    if (!elements.addFontModal) return;
    // Bootstrap's own "modal finished appearing" event, the reliable point
    // to focus something inside it (focusing earlier can get overridden by
    // the modal's own entrance/backdrop focus handling).
    elements.addFontModal.addEventListener("shown.bs.modal", () => {
      elements.addFontValueInput?.focus();
    });
    if (elements.addFontValueInput) {
      // Validation (format + Google Fonts existence + category lookup)
      // happens once, here, on blur — not at submit time — so the Add
      // button can stay disabled until it actually succeeds, and any
      // problem shows up as an inline warning in the modal instead of only
      // a toast after clicking Add.
      elements.addFontValueInput.addEventListener("blur", handleAddFontValueBlur);
      elements.addFontValueInput.addEventListener("input", () => {
        // Typing again invalidates whatever was last checked — back to
        // disabled until the next blur re-validates the new value.
        pendingValidatedFont = null;
        if (elements.addFontSubmitButton) elements.addFontSubmitButton.disabled = true;
        if (elements.addFontWarningElement) elements.addFontWarningElement.classList.add("d-none");
      });
    }
    if (elements.addFontSubmitButton) {
      elements.addFontSubmitButton.addEventListener("click", async () => {
        // The autocomplete's "Add a font…" row already blocks opening this
        // modal for ineligible users — checked again here too, in case the
        // modal is ever reachable another way (defense in depth; the real
        // enforcement is server-side regardless).
        if (!dataManager.meetsTier("creator")) {
          status.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 });
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
        window.bootstrap?.Modal?.getInstance(elements.addFontModal)?.hide();
        try {
          await saveCustomFont(registered, dataManager?.session?.token);
          status.show(`Added "${registered.label}" to the font library.`, { type: "success", timeout: 2500 });
        } catch (error) {
          status.show(error.message || "Unable to save the new font.", { type: "error", timeout: 4000 });
        }
      });
    }
  }

  // Icon field row: a live glyph-preview swatch + a searchable text input
  // (common/js/lib/icon-picker.js's attachIconAutocomplete, the same
  // ddb-icons.css/Bootstrap Icons search Press's own Icon field uses) —
  // typing "@some.path" directly into this same field is how a bound icon
  // is authored (see the icon registry entry's own comment), so there's no
  // separate generic Binding control below it the way most other types have.
  function renderIconInspector(component) {
    const controls = [];
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, "Icon", "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = "Icon";
    const row = document.createElement("div");
    row.className = "input-group";
    // Two nested spans, matching Press's own markup exactly (press/index.html's
    // icon field): an outer .input-group-text (Bootstrap's own padding
    // wrapper) containing an inner, fixed-size .press-icon-preview that
    // actually holds the glyph. Combining both classes onto one element (an
    // earlier version of this) breaks the swatch's sizing — the wrapper's
    // padding and the swatch's fixed 1.25rem box fight each other and the
    // icon ends up with ~0 visible room.
    const previewWrap = document.createElement("span");
    previewWrap.className = "input-group-text";
    const previewSpan = document.createElement("span");
    previewSpan.className = "press-icon-preview";
    previewSpan.setAttribute("aria-hidden", "true");
    previewWrap.appendChild(previewSpan);
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.placeholder = "ddb-fire, bi-star, or @some.path";
    input.value = component.iconClass || "";

    const refreshPreview = () => {
      previewSpan.innerHTML = "";
      const classes = resolveIconClassList(input.value.trim().startsWith("@") ? "" : input.value);
      if (classes.length) {
        const icon = document.createElement("span");
        icon.className = classes.join(" ");
        previewSpan.appendChild(icon);
      }
    };
    refreshPreview();

    const commit = (value) => {
      updateComponent(component.uid, (draft) => {
        draft.iconClass = value;
      }, { rerenderCanvas: true });
      refreshPreview();
    };
    input.addEventListener("input", () => commit(input.value));
    // Must run AFTER the input has a parent — attachIconAutocomplete checks
    // input.parentElement (via ensureIconAutocompleteContainer) to find
    // where to attach the dropdown, and silently no-ops if it's still
    // detached. Press's own icon field is static, always-in-the-DOM markup,
    // so it never hit this; this one is built fresh on every inspector
    // render and has to be appended first.
    row.append(previewWrap, input);
    wrapper.append(label, row);
    attachIconAutocomplete(input, {
      onSelect: (value) => {
        input.value = value;
        commit(value);
      },
    });
    controls.push(wrapper);

    controls.push(
      createTextInput(component, "Aria label", component.ariaLabel || "", (value) => {
        updateComponent(component.uid, (draft) => {
          draft.ariaLabel = value;
        }, { rerenderCanvas: true });
      }, { placeholder: "Describes this icon for screen readers" })
    );
    return controls;
  }

  function renderTextInspector(component) {
    return [
      createBindingFormulaInput(component, {
        labelText: "Binding / Text",
        placeholder: "Static text, @path, or =formula",
        textKey: "text",
        supportsBinding: true,
        supportsFormula: true,
      }),
    ];
  }

  function renderContainerInspector(component) {
    normalizeContainerType(component);
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Type",
        [
          { value: "grid", icon: "tabler:layout-grid", label: "Grid" },
          { value: "tabs", icon: "tabler:layout-navbar", label: "Tabs" },
        ],
        component.containerType || "grid",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.containerType = value;
            ensureContainerZones(draft);
          }, { rerenderCanvas: true, rerenderInspector: true });
        }
      )
    );
    if (component.containerType === "tabs") {
      controls.push(
        createTextarea(component, "Tab labels (one per line)", (component.tabLabels || []).join("\n"), (value) => {
          updateComponent(component.uid, (draft) => {
            draft.tabLabels = parseLines(value);
            ensureContainerZones(draft);
          }, { rerenderCanvas: true });
        }, { rows: 3, placeholder: "Details\nInventory" })
      );
    } else {
      controls.push(
        createNumberInput(component, "Columns", component.columns || 2, (value) => {
          const next = clampInteger(value ?? 2, 1, MAX_CONTAINER_COLUMNS);
          updateComponent(component.uid, (draft) => {
            draft.columns = next;
            ensureContainerZones(draft);
          }, { rerenderCanvas: true, rerenderInspector: true });
        }, { min: 1, max: MAX_CONTAINER_COLUMNS })
      );
      controls.push(
        createNumberInput(component, "Rows", component.rows || 1, (value) => {
          const next = clampInteger(value ?? 1, 1, MAX_CONTAINER_ROWS);
          updateComponent(component.uid, (draft) => {
            draft.rows = next;
            ensureContainerZones(draft);
          }, { rerenderCanvas: true, rerenderInspector: true });
        }, { min: 1, max: MAX_CONTAINER_ROWS })
      );
      controls.push(
        createTextInput(component, "Column template", component.templateColumns || "", (value) => {
          const next = value.trim();
          updateComponent(component.uid, (draft) => {
            if (next) draft.templateColumns = next;
            else delete draft.templateColumns;
          }, { rerenderCanvas: true });
        }, { placeholder: "1fr 2fr" })
      );
      controls.push(
        createTextInput(component, "Row template", component.templateRows || "", (value) => {
          const next = value.trim();
          updateComponent(component.uid, (draft) => {
            if (next) draft.templateRows = next;
            else delete draft.templateRows;
          }, { rerenderCanvas: true });
        }, { placeholder: "auto auto" })
      );
    }
    controls.push(
      createNumberInput(component, "Column/row gap (px)", component.gap ?? 16, (value) => {
        const next = clampInteger(value ?? 16, 0, 64);
        updateComponent(component.uid, (draft) => {
          draft.gap = next;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 64, step: 4 })
    );
    return controls;
  }

  function renderTrackInspector(component) {
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Shape",
        [
          { value: "linear", icon: "tabler:timeline", label: "Linear" },
          { value: "circular", icon: "tabler:gauge", label: "Circular" },
        ],
        component.trackShape || "linear",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.trackShape = value;
          }, { rerenderCanvas: true });
        }
      )
    );
    controls.push(
      createBindingFormulaInput(component, {
        labelText: "Segments",
        placeholder: "6 or @resources.clock.max",
        bindingKey: "segmentBinding",
        formulaKey: "segmentFormula",
        allowedFieldCategories: ["number"],
        afterCommit: ({ draft, result }) => {
          if (!result || result.type === "empty") {
            draft.segmentBinding = "";
            draft.segmentFormula = draft.segmentFormula || "";
            draft.segments = 6;
            return;
          }
          if (result.type === "binding") {
            const numeric = Number(result.value);
            if (Number.isFinite(numeric)) {
              draft.segments = clampInteger(numeric, 1, 16);
            }
          }
        },
      })
    );
    return controls;
  }

  function renderSelectGroupInspector(component) {
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Type",
        [
          { value: "pills", icon: "tabler:toggle-right", label: "Pills" },
          { value: "tags", icon: "tabler:tags", label: "Tags" },
          { value: "buttons", icon: "tabler:switch-3", label: "Buttons" },
        ],
        component.variant || "pills",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.variant = value;
          }, { rerenderCanvas: true });
        }
      )
    );
    controls.push(
      createRadioButtonGroup(
        component,
        "Selection",
        [
          { value: "single", label: "Single" },
          { value: "multi", label: "Multi" },
        ],
        component.multiple ? "multi" : "single",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.multiple = value === "multi";
          }, { rerenderCanvas: true, rerenderInspector: true });
        }
      )
    );
    return controls;
  }

  function renderToggleInspector(component) {
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Shape",
        [
          { value: "circle", icon: "tabler:circle", label: "Circle" },
          { value: "square", icon: "tabler:square", label: "Square" },
          { value: "diamond", icon: "tabler:diamond", label: "Diamond" },
          { value: "star", icon: "tabler:star", label: "Star" },
        ],
        component.shape || "circle",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.shape = value;
          }, { rerenderCanvas: true });
        }
      )
    );
    return controls;
  }

  function updateComponent(uid, mutate, { rerenderCanvas = false, rerenderInspector = false } = {}) {
    const found = findComponent(uid);
    if (!found) return;
    mutate(found.component);
    if (rerenderCanvas) {
      renderCanvas();
    }
    if (rerenderInspector) {
      renderInspector();
    }
  }

  function parseLines(value) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function clampInteger(value, min, max) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return min;
    }
    return Math.min(Math.max(Math.round(numeric), min), max);
  }

  function cloneDefaults(defaults = {}) {
    return JSON.parse(JSON.stringify(defaults));
  }

  function hydrateComponent(component) {
    if (!component || typeof component !== "object") {
      return null;
    }
    // Legacy component type strings from before Track was consolidated
    // into one "track" type with a Shape selector — rewritten here, before
    // createComponent/cloning below, so an old saved template's track
    // components still load with their data intact and the correct shape
    // pre-selected, instead of silently becoming a blank Input the way an
    // unrecognized type falls back today.
    if (component.type === "linear-track" || component.type === "circular-track") {
      if (!component.trackShape) {
        component.trackShape = component.type === "circular-track" ? "circular" : "linear";
      }
      component.type = "track";
    }
    // Legacy "label" type string from before it was renamed to "text" with a
    // single combined Binding/Text field — rewritten here so an old saved
    // template's label components still load with their data intact.
    if (component.type === "label") {
      component.type = "text";
    }
    const type = component.type || "input";
    const definition = COMPONENT_DEFINITIONS[type] || {};
    let base;
    try {
      base = createComponent(type);
    } catch (error) {
      base = createComponent("input");
    }
    const copy = cloneDefaults(component);
    const merged = Object.assign(base, copy);
    merged.uid = base.uid;
    if (!merged.id) {
      merged.id = merged.uid;
    }
    if (merged.type === "track") {
      if (Array.isArray(copy.activeSegments)) {
        const total = copy.activeSegments.length || 0;
        const active = copy.activeSegments.filter(Boolean).length;
        if (!merged.segmentBinding) {
          merged.segmentBinding = String(total || merged.segments || 6);
        }
        if ((merged.value === undefined || merged.value === null) && active > 0) {
          merged.value = active;
        }
      }
      if (typeof merged.segmentBinding !== "string") {
        merged.segmentBinding = "";
      }
      merged.segmentBinding = merged.segmentBinding.trim();
      if (!merged.segmentBinding) {
        const fallbackSegments = Number.isFinite(Number(merged.segments)) ? Number(merged.segments) : 6;
        merged.segmentBinding = String(fallbackSegments);
      }
      if (typeof merged.segmentFormula !== "string") {
        merged.segmentFormula = "";
      }
      const parsedSegments = Number(merged.segmentBinding);
      if (Number.isFinite(parsedSegments)) {
        merged.segments = clampInteger(parsedSegments, 1, 16);
      } else if (Number.isFinite(Number(merged.segments))) {
        merged.segments = clampInteger(merged.segments, 1, 16);
      } else {
        merged.segments = 6;
      }
      if (merged.value === undefined || merged.value === null || Number.isNaN(Number(merged.value))) {
        merged.value = Math.min(merged.segments, Math.max(0, Math.ceil(merged.segments / 2)));
      }
      delete merged.activeSegments;
    }
    if (merged.type === "toggle") {
      if (typeof merged.statesBinding !== "string") {
        merged.statesBinding = "";
      }
      merged.statesBinding = merged.statesBinding.trim();
      if ((merged.value === undefined || merged.value === null || merged.value === "") && Array.isArray(merged.states) && merged.states.length) {
        merged.value = merged.states[0];
      }
    }
    if (merged.type === "input") {
      if (typeof merged.sourceBinding !== "string") {
        merged.sourceBinding = "";
      }
      merged.sourceBinding = merged.sourceBinding.trim();
      if (merged.variant === "textarea") {
        const numericRows = Number(merged.rows);
        merged.rows = Number.isFinite(numericRows) ? clampInteger(numericRows, 2, 12) : base.rows ?? 3;
      }
    }
    if (merged.type === "select-group") {
      if (typeof merged.sourceBinding !== "string") {
        merged.sourceBinding = "";
      }
      merged.sourceBinding = merged.sourceBinding.trim();
    }
    if (typeof merged.roller !== "string") {
      merged.roller = "";
    }
    merged.roller = merged.roller.trim();
    if (isZoneContainer(merged)) {
      const zones = merged.zones && typeof merged.zones === "object" ? merged.zones : {};
      Object.keys(zones).forEach((key) => {
        const entries = Array.isArray(zones[key]) ? zones[key].map(hydrateComponent).filter(Boolean) : [];
        zones[key] = entries;
      });
      merged.zones = zones;
      ensureComponentZones(merged);
    }
    merged.collapsible = Boolean(merged.collapsible);
    if (definition.supportsLabelPosition) {
      const basePosition = base?.labelPosition || "top";
      merged.labelPosition = normalizeLabelPosition(merged.labelPosition || basePosition, basePosition);
    } else if (Object.prototype.hasOwnProperty.call(merged, "labelPosition")) {
      delete merged.labelPosition;
    }
    return merged;
  }

  function toId(parts = []) {
    return parts
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
  }

  function createBlankTemplate({
    id = "",
    title = "",
    version = "0.1",
    schema = "",
    description = "",
    type = "sheet",
    origin = "draft",
    shareToken = "",
  } = {}) {
    return {
      id: id || "",
      title: title || "",
      version: version || "0.1",
      schema: schema || "",
      description: description || "",
      type: type || "sheet",
      origin,
      shareToken: shareToken || "",
      ownership: origin || "",
      permissions: "",
      ownerId: null,
      ownerUsername: "",
    };
  }

  function ensureTemplateOption(id) {
    if (!elements.templateSelect || !id) {
      return;
    }
    const metadata = templateCatalog.get(id) || { id, title: id };
    const label = formatTemplateOptionLabel(metadata) || metadata.title || id;
    const escaped = escapeCss(id);
    let option = escaped ? elements.templateSelect.querySelector(`option[value="${escaped}"]`) : null;
    if (!option) {
      option = document.createElement("option");
      option.value = id;
      elements.templateSelect.appendChild(option);
    }
    option.textContent = label;
  }

  function formatTemplateOptionLabel(metadata = {}) {
    const templateTitle = metadata.title || metadata.id || "";
    const schemaId = metadata.schema || "";
    const systemLabel = resolveSystemLabel(schemaId);
    if (templateTitle && systemLabel) {
      return `${templateTitle} (${systemLabel})`;
    }
    return templateTitle || schemaId || metadata.id || "";
  }

  function resolveSystemLabel(schemaId) {
    if (!schemaId) {
      return "";
    }
    const metadata = systemCatalog.get(schemaId) || {};
    return metadata.title || schemaId;
  }

  function refreshTemplateOptionsForSystem(schemaId) {
    templateCatalog.forEach((metadata, templateId) => {
      if (!schemaId || (metadata?.schema || "") === schemaId) {
        ensureTemplateOption(templateId);
      }
    });
  }

  function updateTemplateMeta() {
    if (!elements.templateMeta) {
      return;
    }
    if (!hasActiveTemplate()) {
      elements.templateMeta.textContent = "No template selected";
      return;
    }
    const templateId = state.template?.id || "—";
    const version = state.template?.version || "—";
    elements.templateMeta.textContent = `ID: ${templateId || "—"} • Version: ${version || "—"}`;
  }

  function ensureTemplateSelectValue() {
    if (!elements.templateSelect) return;
    const id = state.template?.id || "";
    if (!id) {
      elements.templateSelect.value = "";
      return;
    }
    const escaped = escapeCss(id);
    const option = escaped ? elements.templateSelect.querySelector(`option[value="${escaped}"]`) : null;
    if (option) {
      elements.templateSelect.value = id;
    } else {
      elements.templateSelect.value = "";
    }
  }

  function escapeCss(value) {
    if (typeof value !== "string" || !value) {
      return value;
    }
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function generateTemplateId(name) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `tpl.${crypto.randomUUID()}`;
    }
    const base = (name || "template").toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    return `tpl.${slug || "template"}.${rand}`;
  }

  function generateDuplicateTemplateId(baseId) {
    const raw = (baseId || "").trim();
    if (!raw) {
      return generateTemplateId("template");
    }
    const normalized = raw.replace(/(\.copy\d*)$/i, "");
    const root = normalized || raw;
    let candidate = `${root}.copy`;
    let counter = 2;
    while (candidate && templateCatalog.has(candidate)) {
      candidate = `${root}.copy${counter}`;
      counter += 1;
    }
    return candidate;
  }

  function generateDuplicateTemplateTitle(baseTitle) {
    const raw = (baseTitle || "").trim();
    const base = raw.replace(/\(Copy(?: \d+)?\)$/i, "").trim() || raw || "Template";
    const existing = new Set(
      Array.from(templateCatalog.values()).map((entry) => (entry?.title || "").trim()).filter(Boolean)
    );
    let candidate = `${base} (Copy)`;
    let counter = 2;
    while (existing.has(candidate)) {
      candidate = `${base} (Copy ${counter})`;
      counter += 1;
    }
    return candidate;
  }

  function resolveSharedRecordParam(expectedBucket) {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const record = params.get("record");
      if (!record) {
        return null;
      }
      const [bucket, ...rest] = record.split(":");
      const id = rest.join(":");
      if (bucket !== expectedBucket || !id) {
        return null;
      }
      const shareToken = params.get("share") || "";
      return { id, shareToken };
    } catch (error) {
      console.warn("Template editor: unable to parse shared record", error);
      return null;
    }
  }

  window.addEventListener("undercroft:auth-changed", () => {
    if (dataManager.isAuthenticated()) {
      loadTemplateRecords();
      if (pendingSharedTemplate) {
        void loadPendingSharedTemplate();
      }
    }
  });

  window.addEventListener("workbench:content-saved", (event) => {
    const detail = event.detail || {};
    if (detail.bucket === "templates" && detail.source === "remote") {
      loadTemplateRecords();
    }
  });

  window.addEventListener("workbench:content-deleted", (event) => {
    const detail = event.detail || {};
    if (detail.bucket === "templates" && detail.source === "remote") {
      loadTemplateRecords();
    }
  });

  return {
    applyUndoEntry: handleUndoEntry,
    applyRedoEntry: handleRedoEntry,
    hasUnsavedChanges: hasUnsavedTemplateChanges,
    markClean: markTemplateClean,
  };
}
