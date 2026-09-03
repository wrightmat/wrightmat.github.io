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
import { createRootInsertionHandler } from "../lib/root-inserter.js";
import { expandPane } from "../../../common/js/lib/panes.js";
import { disposeTooltips, refreshTooltips, refreshTooltip, setDisabledTooltip } from "../../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../../common/js/lib/collapsible.js";
import {
  createJsonDataPanel,
  createIconButton,
  createCompactField,
  // Aliased — the bare name below is inspector-fields.js's positional-args
  // createCollapsibleSection (Inspector groups); this is ui-components.js's
  // object-arg version (label/content/actions/helpTopic), used only for the
  // Palette section's collapsible + Clear-canvas action button.
  createCollapsibleSection as createFullCollapsibleSection,
} from "../../../common/js/lib/ui-components.js";
import {
  listBuiltinSystems,
  listBuiltinTemplates,
  markBuiltinMissing,
  markBuiltinAvailable,
  applyBuiltinCatalog,
  verifyBuiltinAsset,
} from "../lib/content-registry.js";
import { COMPONENT_ICONS, applyComponentStyles, applyTextFormatting, applyImageStyles } from "../lib/component-styles.js";
import {
  createFormulaToggleField,
  createCollapsibleSection,
  createTypeSummaryHeader,
  createFieldRow,
  createSwitchField,
  createHalfWidthNumberField,
  createFormFloatingField,
  createButtonCheckGroup,
} from "../../../common/js/lib/inspector-fields.js";
import { createColorPickerField } from "../../../common/js/lib/color-picker.js";
import { renderTextContent, resolveImageUrl, renderImageContent, renderIconContent, renderContainerContent, renderInputContent, renderLinearTrackContent, renderCircularTrackContent, renderSelectGroupContent, renderToggleContent, toggleStateEntryFromRaw, excludeToggleWrapperColors } from "../lib/component-renderers.js";
import { collectSystemFields, categorizeFieldType } from "../../../common/js/lib/system-schema.js";
import { evaluateFormula } from "../../../common/js/lib/formula-engine.js";
import { createLookupFn, createLookupFieldFn } from "../../../common/js/lib/bindings.js";
import {
  createBindingFormulaInput as createSharedBindingFormulaInput,
  notifyBindingFieldsReady,
} from "../../../common/js/lib/binding-field.js";
import {
  normalizeBindingValue,
  resolveBindingFromContexts,
  normalizeOptionEntries,
  resolveTabEntries,
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

// The Template mode of Workbench's unified page (see js/pages/workbench.js),
// which owns the single initAppShell call (status/undoStack), DataManager,
// auth, help system, and tier gating (Template is gated to "gm" at the Mode
// toggle level — see workbench.js's own renderModeToggle).
export async function initTemplateView({ status, undoStack, dataManager, onStateChange }) {
  function sessionUser() {
    return dataManager.session?.user || null;
  }

  const templateCatalog = new Map();
  const systemCatalog = new Map();

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

  // markTemplateClean() itself moved to the end of this function's own init
  // sequence — NOT called here — see that call site's own comment for why.

  let pendingSharedTemplate = resolveSharedRecordParam("templates");

  function hasActiveTemplate() {
    return Boolean(state.template && (state.template.id || state.template.title));
  }

  // Single source of truth for the insert gate + messaging — handleDrop,
  // the palette's onActivate, and Paste all call this rather than each
  // duplicating the same checks.
  function canInsertComponent() {
    if (!hasActiveTemplate()) {
      return {
        ok: false,
        message: "Create or load a template before adding components.",
        options: { type: "warning", timeout: 2400 },
      };
    }
    const metadata = getTemplateMetadata(state.template?.id);
    if (!templateAllowsEdits(metadata)) {
      return { ok: false, message: describeTemplateEditRestriction(metadata), options: { type: "warning", timeout: 2800 } };
    }
    if (!dataManager.hasWriteAccess("templates")) {
      const required = dataManager.describeRequiredWriteTier("templates");
      const message = required
        ? `Saving templates requires a ${required} tier.`
        : "Your tier cannot save templates.";
      return { ok: false, message, options: { type: "warning", timeout: 2800 } };
    }
    return { ok: true };
  }

  const dropzones = new Map();
  const containerActiveTabs = new Map();
  // The last Copy/Cut'd component — module-level scratch, not part of
  // `state`, since it's session-only and never serialized/undone.
  // regenerateComponentUids assigns fresh uids at Paste time.
  let componentClipboard = null;
  const componentCollapsedState = new Map();

  // Pattern/shape picker modal state (Image component) — declared here
  // rather than near the picker's own functions because initPatternModal()
  // runs early during init, before those functions exist as `let`s.
  let selectedPatternPreset = null;
  let currentPatternValues = {};
  let patternPickerComponentUid = null;
  let patternPickerInput = null;

  // Add Font modal state — same early-declaration reasoning as above.
  // pendingValidatedFont caches the blur-validated font (see
  // handleAddFontValueBlur) so submit can reuse it instead of re-verifying;
  // cleared on every edit, keeping Add disabled until the next successful blur.
  let pendingValidatedFont = null;
  // Set by whichever openAddFontModal call is open, so one modal can apply
  // its result to either a component's Font field or the Template's base
  // font without needing to know which.
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

  // A pasted copy needs a fresh cmp-N uid (never the source's stale one) —
  // uid is the key every selection/collapse/active-tab Map is keyed by, so
  // reusing one would alias the paste to an unrelated component. Recurses
  // into zones so every descendant of a pasted subtree gets its own uid too.
  function regenerateComponentUids(component) {
    if (!component || typeof component !== "object") return component;
    componentCounter += 1;
    component.uid = `cmp-${componentCounter}`;
    if (component.zones && typeof component.zones === "object") {
      Object.values(component.zones).forEach((items) => {
        if (Array.isArray(items)) {
          items.forEach((child) => regenerateComponentUids(child));
        }
      });
    }
    return component;
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
    notifyBindingFieldsReady({
      schemaId: schemaId || "",
      count: Array.isArray(state.bindingFields) ? state.bindingFields.length : 0,
    });
  }

  const elements = {};

  await initializeBuiltins();

  // New/Save/Duplicate/Delete Template live in workbench.js's own left-pane
  // toolbar cluster — this file just queries them by their data-action/
  // data-delete-template attributes.

  // replaceWith, not appendChild — see press/js/app.js's mountInspectorField:
  // an appended-into wrapper stays an empty-but-in-flow flex item even while
  // its field is conditionally hidden, silently spending a full gap-3 on
  // both sides. The mount div's own class is merged onto the built field
  // first so removing the wrapper doesn't lose that layout.
  function mountField(key, element) {
    const mount = document.querySelector(`[data-field-mount="${key}"]`);
    if (!mount) return;
    if (mount.className) element.classList.add(...mount.classList);
    mount.replaceWith(element);
  }
  mountField(
    "template-select",
    createCompactField({ type: "select", id: "template-select", label: "Template", labelClass: "form-label fw-semibold text-body-secondary", controlClass: "form-select", dataAttr: "data-template-select" })
  );
  mountField("new-template-id", createCompactField({ type: "text", id: "new-template-id", label: "Template ID", dataAttr: "data-new-template-id", name: "id", required: true, placeholder: "e.g. tpl.custom" }));
  mountField("new-template-title", createCompactField({ type: "text", id: "new-template-title", label: "Template Title", dataAttr: "data-new-template-title", name: "title", required: true, placeholder: "e.g. Hero Sheet" }));
  mountField("new-template-version", createCompactField({ type: "text", id: "new-template-version", label: "Starting Version", dataAttr: "data-new-template-version", name: "version", value: "0.1" }));
  mountField(
    "new-template-system",
    createCompactField({ type: "select", id: "new-template-system", label: "System", controlClass: "form-select", dataAttr: "data-new-template-system", name: "schema", required: true })
  );
  mountField(
    "pattern-category",
    createButtonCheckGroup({
      ariaLabel: "Pattern category",
      name: "workbenchPatternCategory",
      dataAttr: "data-pattern-category",
      options: [
        { id: "workbenchPatternCategoryFills", value: "fills", text: "Fills" },
        { id: "workbenchPatternCategoryPatterns", value: "patterns", text: "Patterns" },
        { id: "workbenchPatternCategoryBanners", value: "banners", text: "Banners" },
        { id: "workbenchPatternCategoryShapes", value: "shapes", text: "Shapes" },
      ],
    })
  );
  document.getElementById("workbenchPatternCategoryFills").checked = true;
  mountField(
    "add-font-value",
    createFormFloatingField({ type: "text", id: "workbenchAddFontValue", label: "Font name or CSS font-family value", dataAttr: "data-add-font-value", placeholder: "Encode Sans Expanded" })
  );

  Object.assign(elements, {
    templateSelect: document.querySelector("[data-template-select]"),
    palette: document.querySelector("[data-palette]"),
    canvasRoot: document.querySelector("[data-canvas-root]"),
    inspector: document.querySelector("[data-inspector]"),
    saveButton: document.querySelector('[data-action="save-template"]'),
    undoButton: document.querySelector('[data-action="undo-template"]'),
    redoButton: document.querySelector('[data-action="redo-template"]'),
    newTemplateButton: document.querySelector('[data-action="new-template"]'),
    duplicateTemplateButton: document.querySelector('[data-action="duplicate-template"]'),
    deleteTemplateButton: document.querySelector('[data-delete-template]'),
    newTemplateForm: document.querySelector("[data-new-template-form]"),
    newTemplateId: document.querySelector("[data-new-template-id]"),
    newTemplateTitle: document.querySelector("[data-new-template-title]"),
    newTemplateVersion: document.querySelector("[data-new-template-version]"),
    newTemplateSystem: document.querySelector("[data-new-template-system]"),
    newTemplateModalTitle: document.querySelector("[data-new-template-modal-title]"),
    rightPane: document.querySelector('[data-pane="right"]'),
    rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
    templateProperties: document.querySelector("[data-template-properties]"),
    palettePanel: document.querySelector("[data-palette-panel]"),
    templatePropertiesPanel: document.querySelector("[data-template-properties-panel]"),
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

  // Builds/mounts just the collapsible-toggle chevron — these sections' own
  // headers keep other hand-authored content a full createCollapsibleSection
  // would clobber if it rebuilt the whole header.
  function createSectionToggleButton(mountSelector, collapsed) {
    const button = createIconButton({
      icon: "tabler:chevron-right",
      className: "collapsible-toggle",
      includeToggleLabel: true,
    });
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    document.querySelector(mountSelector)?.appendChild(button);
    return button;
  }

  // Same shared collapse mechanism every tool uses. Template Properties and
  // Component Properties also need programmatic control (renderInspector
  // swaps which one is expanded based on selection), so their
  // bindCollapsibleToggle() return value is kept.
  const applyTemplatePropertiesCollapse = bindCollapsibleToggle(
    createSectionToggleButton("[data-template-properties-toggle-mount]", true),
    elements.templatePropertiesPanel,
    { collapsed: true }
  );
  const applyComponentPropertiesCollapse = bindCollapsibleToggle(
    createSectionToggleButton("[data-component-properties-toggle-mount]", true),
    elements.componentPropertiesPanel,
    { collapsed: true }
  );
  // Palette — collapsed by default, auto-expanded once a template is
  // selected (see setPaletteCollapsed's call sites). Clear canvas lives in
  // this section's own header as one of createFullCollapsibleSection's
  // `actions`.
  const paletteSection = createFullCollapsibleSection({
    label: "Palette",
    helpTopic: "template.library",
    collapsed: true,
    actions: [{ icon: "tabler:eraser", label: "Clear canvas", variant: "outline-danger", onClick: () => clearCanvas() }],
    content: elements.palettePanel,
  });
  document.querySelector("[data-palette-mount]")?.appendChild(paletteSection.section);
  const [clearCanvasButton] = paletteSection.actionButtons;
  elements.clearButton = clearCanvasButton;

  function setPaletteCollapsed(collapsed) {
    paletteSection.setCollapsed(collapsed);
  }

  function handleExportTemplate() {
    const data = serializeTemplateState();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.id || "template"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const templateJsonPanel = createJsonDataPanel({
    label: "JSON Data",
    getData: () => serializeTemplateState(),
    onExport: handleExportTemplate,
  });
  document.querySelector("[data-template-json-mount]")?.appendChild(templateJsonPanel.section);

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

  // Extracted from the <select>'s change handler so workbench.js can also
  // drive it programmatically (auto-loading a character's template when
  // switching modes) via the same load path.
  async function selectTemplateById(selectedId) {
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
        // preferLocal: false — this is a load-then-edit round trip; a stale
        // local copy would silently shadow anything saved elsewhere.
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
        id: selectedId,
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
  }

  if (elements.templateSelect) {
    const builtinOptions = listBuiltinTemplates().map((tpl) => ({ value: tpl.id, label: tpl.title }));
    populateSelect(elements.templateSelect, builtinOptions, { placeholder: "Select template" });
    elements.templateSelect.addEventListener("change", () => {
      void selectTemplateById(elements.templateSelect.value);
    });
  }

  // Named once, used everywhere a Container's column/row count is clamped
  // (zone-building, canvas preview, inspector steppers).
  const MAX_CONTAINER_COLUMNS = 9;
  const MAX_CONTAINER_ROWS = 9;
  // Matches Press's own Repeater column-count range.
  const MAX_REPEATER_COLUMNS = 8;

  const COMPONENT_DEFINITIONS = {
    input: {
      label: "Input",
      // Matches the palette's own text (workbench/index.html) exactly — one
      // canonical description per type, not two strings that can drift.
      description: "Text, number, select, radio, checkbox, button",
      defaults: {
        name: "Input Field",
        variant: "text",
        placeholder: "",
        options: ["Option A", "Option B"],
        rows: 3,
        sourceBinding: "",
        labelPosition: "top",
        // Button variant only — a small icon-only roll button needs a face
        // with no text. iconClass/url/formula are the EXACT SAME field
        // names/picker controls (createIconFieldControl/createImageUrlControl)
        // the real Icon/Image components use, so a formula or "@" binding
        // resolves identically (renderInputContent's button branch,
        // component-renderers.js). Precedence: iconClass, then url, then
        // label text, then a bare "Button" fallback.
        iconClass: "",
        url: "",
        // Free CSS-value text, same convention as Image's/Toggle's own
        // width/height — applied as inline styles only when set.
        width: "",
        height: "",
        // "rollDice" is by far the most common case — a fresh Button
        // defaults to something immediately useful, not an inert no-op.
        action: {
          type: "rollDice",
          expression: "",
          macroRef: "",
          binding: "",
          lookupBinding: "",
          matchField: "",
          matchValue: "",
          targetField: "",
          mode: "delta",
          amount: "-1",
        },
      },
      supportsBinding: true,
      supportsFormula: true,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["text", "background", "border"],
      supportsLabelPosition: true,
    },
    // Port of Press's own Repeater — a real item-template zone: drag in and
    // bind arbitrary components (Text, Image, Icon, ...) exactly like a
    // Container zone, repeated once per resolved array item. See
    // ensureRepeaterZone (this file) and renderRepeaterComponent
    // (workbench-character-view.js).
    repeater: {
      label: "Repeater",
      description: "Inventory and item lists",
      defaults: {
        name: "Repeater",
        zones: {},
        // none/bullet/number/custom — "text" only used for custom, a
        // literal string or an @-bound per-item value.
        decorator: { type: "none", text: "" },
        // Ported from Press's own Repeater "table" mode — see
        // ensureRepeaterZone for the per-column zone keys these drive.
        columns: 1,
        templateColumns: "",
        showHeader: false,
        // Vertical stacks items top-to-bottom (`columns` = field templates
        // per row). Horizontal transposes the model: `columns` = field
        // templates per ITEM's own column, and the header becomes a header
        // COLUMN instead of a row. Same zone keys either way — see
        // ensureRepeaterZone/renderRepeaterComponent.
        orientation: "vertical",
        // Spacing between items in Horizontal orientation (flex row when
        // rows===1, CSS grid otherwise) — same "Grid gap" concept as
        // Container's own gap field.
        gap: 16,
        // Horizontal-only — see createRepeaterFillToggle.
        fill: false,
        // Vertical list mode only, off by default — a forced divider on
        // every row reads as a stray blank line once a row is hidden by
        // its own Visibility formula (e.g. a 0-value stat). Authors who
        // want a visual separator can still turn it on per-Repeater.
        itemDivider: false,
        // Bare item-relative field name (never an "@" path) a Repeater
        // sorts its resolved items by before rendering — needed for
        // computed lists (e.g. multiclass spell-slot pools populated
        // out of numeric order) that have no other way to reorder.
        // Blank means unsorted/stored order.
        sortBinding: "",
        sortDirection: "asc",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: [],
    },
    // Full port of Press's own Image component, including its pattern/shape
    // picker (see the brush button in renderImageInspector) — a Divider is
    // just one of the picker's own Shapes presets ("Horizontal rule") now,
    // so it needed no separate component once Image could do this. `url`
    // matches Press's field name; an old template's `src` is still read as
    // a fallback wherever `url` is resolved.
    image: {
      label: "Image",
      description: "Portraits, logos, or patterns",
      defaults: {
        name: "Image",
        url: "https://placekitten.com/320/180",
        // Same generic "literal, @binding, or =formula" field Icon/Text/
        // Container use — see createImageUrlControl. Takes priority over
        // `url` when set.
        formula: "",
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
    // Full port of Press's own Icon component — same Bootstrap Icons search
    // (common/js/lib/icon-picker.js). iconClass is itself a binding-or-
    // literal string (typing "@some.path" directly into the field is how a
    // bound icon is authored) — no separate generic Binding field.
    icon: {
      label: "Icon",
      description: "A single icon glyph",
      defaults: {
        name: "Icon",
        iconClass: "",
        formula: "",
        ariaLabel: "",
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: ["text"],
    },
    // Single combined Binding/Text field (renderTextInspector, via
    // createBindingFormulaInput's textKey support) — matches Press's own
    // "Text" component exactly. supportsBinding/supportsFormula are false
    // here specifically to suppress the GENERIC Data section from also
    // rendering a redundant binding control; resolveComponentValue ignores
    // these flags, so formula/binding still resolve normally at render time.
    text: {
      label: "Text",
      description: "Static text or headings",
      defaults: {
        name: "Text",
        text: "Text",
        // Opt-in, not automatic — see createRichTextControl.
        richText: false,
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["text", "background", "border"],
    },
    container: {
      label: "Container",
      description: "Grids and tabs",
      defaults: {
        name: "Container",
        // Same generic "literal, @binding, or =formula" field Icon/Image/
        // Text use — see createContainerLabelControl. Takes priority over
        // `label` when set.
        formula: "",
        // Two variants: Grid (a Columns-only layout is rows:1, a Rows-only
        // layout is columns:1) and Tabs. normalizeContainerType migrates any
        // legacy "columns"/"rows" value on an already-saved template.
        containerType: "grid",
        columns: 2,
        rows: 1,
        templateColumns: "",
        templateRows: "",
        tabLabels: ["Tab 1", "Tab 2"],
        // Play-view-only tab lock (Source-driven tabs only) — see
        // resolveLockedTabIndex, workbench-character-view.js. Blank means
        // no lock, every tab switchable.
        activeTabBinding: "",
        gap: 16,
        zones: {},
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["text", "background", "border"],
    },
    track: {
      label: "Track",
      description: "Progress bars or clocks",
      defaults: {
        name: "Track",
        // Linear vs. Circular is a variant of one component (the "Shape"
        // selector in renderTrackInspector), not two separate types.
        trackShape: "linear",
        segments: 6,
        segmentBinding: "6",
        segmentFormula: "",
        value: 3,
        labelPosition: "top",
        // The active/filled segment color (linear segments, the circular
        // gauge's conic-gradient) — same Text/Foreground split as Toggle:
        // Text colors the label only, Foreground is the shape's own fill.
        // Matches Bootstrap's default --bs-primary, so existing Tracks look
        // unchanged until an author customizes it.
        foregroundColor: "#0d6efd",
        foregroundColorBinding: "",
        foregroundColorFormula: "",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["text", "foreground", "background", "border"],
      supportsLabelPosition: true,
    },
    "select-group": {
      label: "Select Group",
      description: "Pills, tags, or segmented toggles",
      defaults: {
        name: "Select Group",
        variant: "pills",
        multiple: false,
        sourceBinding: "",
        labelPosition: "top",
        // The selected/active option's own color (tags' active text,
        // buttons'/pills' active state) — same Text/Foreground split as
        // Track above.
        foregroundColor: "#0d6efd",
        foregroundColorBinding: "",
        foregroundColorFormula: "",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["text", "foreground", "background", "border"],
      supportsLabelPosition: true,
    },
    toggle: {
      label: "Toggle",
      description: "Multi-state proficiencies",
      defaults: {
        name: "Toggle",
        states: ["Novice", "Skilled", "Expert"],
        activeIndex: 0,
        statesBinding: "",
        value: "Novice",
        shape: "circle",
        // textColor blank — inherits the template's Font Default when unset
        // (see createComponent's textColor comment) and colors the label
        // ONLY. foregroundColor/backgroundColor are real, explicit hex —
        // never left blank for CSS to invent a color behind the scenes —
        // since unlike textColor they have no template-wide default to fall
        // back to. backgroundColor is dark specifically so a white
        // foregroundColor fill stays visible against it.
        textColor: "",
        foregroundColor: "#ffffff",
        foregroundColorBinding: "",
        foregroundColorFormula: "",
        backgroundColor: "#495057",
        // Unlike most types, Toggle's outline is on by default — the shape
        // is the whole point of this component, so borderless is the
        // unusual case.
        borderStyle: "solid",
        borderColor: "#343a40",
        borderWidth: 1,
        // Per-state visual mapping (fillLevel/ring), keyed by each state's
        // own string value — component/template data, never read off the
        // Source/System. Empty by default; an unconfigured state falls back
        // to position-based fill (resolveToggleStateStyle, component-renderers.js).
        stateStyles: {},
        // Blank — the glyph stretches to fill its container's width. Set
        // explicitly to override (see renderToggleContent).
        width: "",
        height: "",
        labelPosition: "top",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["text", "foreground", "background", "border"],
      supportsLabelPosition: true,
    },
  };

  let componentCounter = 0;

  const renderPreview = templateJsonPanel.render;

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

  // `default` matches Press's own COLOR_DEFAULTS (Bootstrap's body-color/
  // body-bg/border-color) — a placeholder swatch color shown only while the
  // field is unset, never written to the component. "text" (not
  // "foreground") matches the underlying field name (textColor) and avoids
  // confusion with Foreground: a component's real fill/accent color,
  // distinct from its literal text color — only declared in colorControls
  // for types that genuinely need a fill separate from text (Toggle).
  // fontColor is the template-wide fallback for any component's blank Text
  // — always a real value, never clearable. Background/Border have no such
  // fallback: a cleared value means "none," a legitimate per-component
  // choice (color-picker.js's --unset support), distinct from the
  // template's own literal sheet-wide Background/Border
  // (state.template.backgroundColor/etc.), applied once to the canvas root.
  // White, not Bootstrap's light-mode default, to match this app's
  // dark-card aesthetic (e.g. Toggle's own textColor: "#ffffff").
  const DEFAULT_TEMPLATE_COLORS = { fontColor: "#ffffff" };

  function normalizeTemplateDefaults(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      fontColor: typeof source.fontColor === "string" && source.fontColor.trim() ? source.fontColor.trim() : DEFAULT_TEMPLATE_COLORS.fontColor,
      // Same Binding/Formula pair every color field has — Font Default uses
      // the shared createColorPickerField, so it needs somewhere to hold a
      // non-literal value. Non-empty only when actively overriding fontColor.
      fontColorBinding: typeof source.fontColorBinding === "string" ? source.fontColorBinding.trim() : "",
      fontColorFormula: typeof source.fontColorFormula === "string" ? source.fontColorFormula.trim() : "",
    };
  }

  const COLOR_FIELD_MAP = {
    text: { label: "Text", prop: "textColor", bindingProp: "textColorBinding", formulaProp: "textColorFormula", default: "#212529" },
    foreground: { label: "Foreground", prop: "foregroundColor", bindingProp: "foregroundColorBinding", formulaProp: "foregroundColorFormula", default: "#ffffff" },
    background: { label: "Background", prop: "backgroundColor", bindingProp: "backgroundColorBinding", formulaProp: "backgroundColorFormula", default: "#ffffff" },
    border: { label: "Border", prop: "borderColor", bindingProp: "borderColorBinding", formulaProp: "borderColorFormula", default: "#dee2e6" },
  };

  // Reads the actual JSON property only — no getComputedStyle, no inferring
  // from the rendered canvas. The canvas applies its own selection-outline
  // border to the same element a component's borderColor targets, so a
  // computed-style read on a selected, border-less component would return
  // the editor's blue selection ring instead of "no border." Data is the
  // only trustworthy source: set means set, empty means unset.
  // Every key a color-field commit (manual pick, binding/formula, or Clear)
  // can touch — the three colors, their Binding/Formula pairs, and the
  // border side-effect fields a first pick or Clear can also flip (see
  // createColorRow). Undo/redo for a color change snapshots/restores just
  // these keys on the one component, not a whole-tree clone.
  const COLOR_UNDO_KEYS = [
    "textColor",
    "textColorBinding",
    "textColorFormula",
    "backgroundColor",
    "backgroundColorBinding",
    "backgroundColorFormula",
    "borderColor",
    "borderColorBinding",
    "borderColorFormula",
    "borderStyle",
    "borderWidth",
    "borderRadius",
    "borderSides",
  ];

  function snapshotColorKeys(component) {
    const snapshot = {};
    COLOR_UNDO_KEYS.forEach((key) => {
      snapshot[key] = component[key];
    });
    return cloneComponentTree(snapshot);
  }

  function applyColorKeys(component, snapshot) {
    if (!snapshot) return;
    COLOR_UNDO_KEYS.forEach((key) => {
      component[key] = snapshot[key];
    });
  }

  // Wraps updateComponent for color-field handlers only — same options/
  // rerender contract, plus a before/after snapshot pushed as a single
  // "componentColor" undo entry. Skips pushing when the snapshot didn't
  // actually change, matching color-picker.js's own no-op guard.
  function updateComponentColor(uid, mutate, options) {
    const found = findComponent(uid);
    if (!found) return;
    const before = snapshotColorKeys(found.component);
    updateComponent(uid, mutate, options);
    const after = snapshotColorKeys(found.component);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    undoStack.push({
      type: "componentColor",
      templateId: state.template?.id || "",
      componentId: uid,
      before,
      after,
    });
  }

  // "None" first — the default for a component with no border chosen yet
  // (createBorderControls); rest matches Press's border-style list exactly.
  const BORDER_STYLE_OPTIONS = [
    { value: "none", label: "None" },
    { value: "solid", label: "Solid" },
    { value: "dashed", label: "Dashed" },
    { value: "dotted", label: "Dotted" },
    { value: "double", label: "Double" },
    { value: "groove", label: "Groove" },
    { value: "ridge", label: "Ridge" },
    { value: "inset", label: "Inset" },
    { value: "outset", label: "Outset" },
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

  // Palette markup hardcodes each item's icon in workbench/index.html —
  // synced here from the shared COMPONENT_ICONS registry at init time, so
  // there's one source of truth rather than a copy that can drift.
  if (elements.palette) {
    elements.palette.querySelectorAll("[data-component-type]").forEach((item) => {
      const type = item.dataset.componentType;
      const icon = COMPONENT_ICONS[type];
      const iconElement = item.querySelector(".iconify[data-icon]");
      if (icon && iconElement) {
        iconElement.dataset.icon = icon;
      }
    });
  }

  if (elements.palette) {
    initPaletteInteractions(elements.palette, {
      groupName: "template-canvas",
      dataAttribute: "data-component-type",
      onActivate: ({ value }) => {
        if (!value || !COMPONENT_DEFINITIONS[value]) {
          return;
        }
        const gate = canInsertComponent();
        if (!gate.ok) {
          status.show(gate.message, gate.options);
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

  // Delete/Copy/Cut/Paste act on the current canvas selection — no
  // dedicated buttons (per-card icons ate too much room on small
  // components). Guarded on isEditableTarget so typing/copying text in a
  // focused field is never hijacked — native browser behavior wins there.
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || isEditableTarget(document.activeElement)) {
      return;
    }
    if (event.key === "Delete") {
      if (!state.selectedId) return;
      removeComponent(state.selectedId);
      return;
    }
    // metaKey too — Cmd+C/X/V on macOS.
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "c") {
      if (!state.selectedId) return;
      event.preventDefault();
      copySelectedComponent();
    } else if (key === "x") {
      if (!state.selectedId) return;
      event.preventDefault();
      cutSelectedComponent();
    } else if (key === "v") {
      if (!componentClipboard?.component) return;
      event.preventDefault();
      pasteClipboardComponent();
    }
  });

  if (elements.saveButton) {
    elements.saveButton.addEventListener("click", async () => {
      if (!state.template) {
        return;
      }
      const payload = serializeTemplateState();
      const templateId = (payload.id || "").trim();
      // A template's id is filename/library_items metadata, never body
      // content — same convention every Library kind follows. Already
      // captured above, so deleting it here can't affect anything below.
      delete payload.id;
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
        // Must run before syncTemplateActions() — it updates
        // lastSavedTemplateSignature, which hasUnsavedTemplateChanges()
        // compares against; calling them in the other order leaves Save
        // looking dirty right after a successful save.
        if (savedToServer || !requireRemote) {
          markTemplateClean();
        }
        syncTemplateActions();
        // Play/Edit loads its own separate template copy and never
        // re-fetches it — this lets workbench.js force-reload it if the
        // open character actually uses this template (see
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
        // Not a blind `button.disabled = false` — syncTemplateActions() is
        // the single source of truth for whether Save should be enabled,
        // and re-running it here still correctly re-enables the button on
        // a failed save (the template is still dirty then).
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

  // Clear canvas's own click handler is wired directly on construction
  // (paletteSection's own `actions` config above) — no separate listener
  // needed here. Export moved into the JSON Data panel's own onExport
  // (handleExportTemplate, same place) — no standalone toolbar button left.

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

  // Awaited before the first render — a template using a custom/Google
  // font needs the shared library populated (so findFontOptionByFamily/
  // ensureFontLoaded in applyTextFormatting can find and load it) before
  // that first paint.
  await loadCustomFonts();
  // Deliberately not called at the top of this function (see the comment
  // near this function's own start) — computeTemplateSignature reads the
  // module's DEFAULT_TEMPLATE_COLORS const via serializeTemplateState, and
  // calling this before that const's declaration line runs hits the
  // temporal-dead-zone, silently swallowed into a `null` baseline that
  // never self-corrects.
  markTemplateClean();
  renderCanvas();
  renderInspector();
  ensureTemplateSelectValue();
  syncTemplateActions();
  initPatternModal();
  initAddFontModal();

  function renderCanvas() {
    if (!elements.canvasRoot) return;
    // Cascades to every component that leaves its Font field unset via
    // ordinary CSS inheritance — no per-component rendering code needs to
    // know about this (see font-library.js).
    elements.canvasRoot.style.fontFamily = state.template?.baseFontFamily || DEFAULT_FONT_FAMILY;
    // The sheet's own literal background/border — reuses applyComponentStyles
    // directly, fed a component-shaped object standing in for the template.
    // textColor deliberately blank — Font stays a per-component fallback
    // only, never a literal root color.
    applyComponentStyles(elements.canvasRoot, {
      textColor: "",
      backgroundColor: resolveTemplateColorForPreview("backgroundColor"),
      borderStyle: state.template?.borderStyle || "",
      borderColor: resolveTemplateColorForPreview("borderColor"),
      borderWidth: state.template?.borderWidth,
      borderSides: state.template?.borderSides,
      borderRadius: 0,
      padding: "",
      margin: "",
      className: "",
    });
    // Dispose every tooltip under the canvas BEFORE wiping it — a stale
    // Bootstrap tooltip instance otherwise outlives the DOM node it was
    // bound to.
    disposeTooltips(elements.canvasRoot);
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
      baseFontFamily: state.template?.baseFontFamily || "",
      defaults: normalizeTemplateDefaults(state.template?.defaults),
      // The sheet's own literal background/border — see createBlankTemplate
      // for why this is separate from `defaults` above.
      backgroundColor: state.template?.backgroundColor || "",
      backgroundColorBinding: state.template?.backgroundColorBinding || "",
      backgroundColorFormula: state.template?.backgroundColorFormula || "",
      borderStyle: state.template?.borderStyle || "",
      borderColor: state.template?.borderColor || "",
      borderColorBinding: state.template?.borderColorBinding || "",
      borderColorFormula: state.template?.borderColorFormula || "",
      borderWidth: state.template?.borderWidth ?? null,
      borderSides: state.template?.borderSides || null,
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
    // Network first, local cache only as an offline fallback — a System
    // definition should never let a stale local cache silently win over a
    // reachable server.
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
    // catalog lookup, possibly stale/absent) doesn't carry them.
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
    // Universal choke point, called after every field edit/load/New/
    // Duplicate/Delete/Save — also where workbench.js's inline empty-state
    // message learns a template became active/inactive.
    if (typeof onStateChange === "function") onStateChange();
    const hasTemplate = Boolean(state.template);
    if (elements.saveButton) {
      const canWrite = dataManager.hasWriteAccess("templates");
      const metadata = getTemplateMetadata(state.template?.id);
      // Same admin bypass resolveDeleteTemplateState applies to Delete — an
      // admin can edit/save any template regardless of ownership.
      const canEditRecord = dataManager.getUserTier() === "admin" || templateAllowsEdits(metadata);
      const hasChanges = hasTemplate && hasUnsavedTemplateChanges();
      const enabled = hasTemplate && hasChanges && canWrite && canEditRecord;
      // setDisabledTooltip owns real `disabled` + the explanation together —
      // a real `disabled` attribute blocks hover entirely, so a bare
      // `title` alongside it could never actually show.
      const reason = !hasTemplate
        ? "Create or load a template to save."
        : !state.template.id || !state.template.schema
          ? "Add an ID and system before saving."
          : !canWrite
            ? dataManager.describeRequiredWriteTier("templates")
              ? `Saving templates requires a ${dataManager.describeRequiredWriteTier("templates")} tier.`
              : "Your tier cannot save templates."
            : !canEditRecord
              ? describeTemplateEditRestriction(metadata)
              : !hasChanges
                ? "No changes to save."
                : "";
      setDisabledTooltip(elements.saveButton, reason);
      elements.saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
    }

    if (elements.clearButton) {
      const isEmpty = !Array.isArray(state.components) || state.components.length === 0;
      elements.clearButton.setAttribute("aria-disabled", isEmpty ? "true" : "false");
      setDisabledTooltip(elements.clearButton, isEmpty ? "Canvas is already empty." : "");
    }

    if (elements.duplicateTemplateButton) {
      const canDuplicate = hasTemplate;
      elements.duplicateTemplateButton.classList.toggle("d-none", !canDuplicate);
      elements.duplicateTemplateButton.disabled = !canDuplicate;
      elements.duplicateTemplateButton.setAttribute("aria-disabled", canDuplicate ? "false" : "true");
    }

    if (elements.deleteTemplateButton) {
      applyDeleteTemplateButtonState(elements.deleteTemplateButton);
    }
  }

  function resolveDeleteTemplateState() {
    const metadata = getTemplateMetadata(state.template?.id);
    const canWrite = dataManager.hasWriteAccess("templates");
    // Deleting is narrower than editing: an admin can delete any template,
    // but non-admin tiers only get the button for templates they actually
    // own — sharing/public visibility isn't delete access.
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
    button.setAttribute("aria-disabled", deletable ? "false" : "true");
    setDisabledTooltip(button, deletable ? "" : title);
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
      // The templates bucket also holds Press's print templates — this
      // editor only authors character templates, so anything else tagged
      // (missing category defaults to "character" for legacy records) is
      // filtered out here, matching Loom's Assigned Template picker.
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
        id: targetId,
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
    const gate = canInsertComponent();
    if (!gate.ok) {
      status.show(gate.message, gate.options);
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

  // Container and Repeater are the two zone-bearing component types — every
  // zone-aware traversal goes through isZoneContainer/ensureComponentZones
  // rather than checking component.type directly, so a third zone-bearing
  // type later needs no changes at any call site.
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
      // Blank — a new component inherits the template's own Font Default
      // (state.template.defaults.fontColor) until textColor is explicitly
      // set, via resolveComponentColors' TEMPLATE_DEFAULT_COLOR_MAP fallback.
      textColor: "",
      // Same plain-value-plus-binding/formula shape as visible/
      // visibilityBinding/visibilityFormula — a color's binding/formula
      // pair overrides the literal hex when non-empty (createColorPickerField
      // in the inspector, resolveComponentColors at render time).
      textColorBinding: "",
      textColorFormula: "",
      backgroundColor: "",
      backgroundColorBinding: "",
      backgroundColorFormula: "",
      // borderStyle is the border on/off switch — color/width/radius/sides
      // only mean anything once borderStyle is a real value, not "none".
      // See createBorderControls' Style select handler for where
      // color/width get written once a style is actually chosen.
      borderStyle: "",
      borderColor: "",
      borderColorBinding: "",
      borderColorFormula: "",
      borderWidth: null,
      borderRadius: 0,
      borderSides: null,
      // Raw CSS shorthand strings passed straight through to the real
      // padding/margin CSS properties — no Workbench-specific parsing.
      // Empty means no override (workbench/css/styles.css's default rule).
      padding: "",
      margin: "",
      // Manual fallback for the unified Visible toggle, used only when
      // neither visibilityBinding nor visibilityFormula is set — same
      // plain-boolean + binding/formula shape as Collapsible/Locked.
      visible: true,
      visibilityBinding: "",
      visibilityFormula: "",
      // Storage key stays "readOnly" (not renamed to "locked") to avoid a
      // wider migration of every read site — only the inspector's own
      // displayed label changed to "Locked".
      collapsibleBinding: "",
      collapsibleFormula: "",
      readOnlyBinding: "",
      readOnlyFormula: "",
      textSize: "md",
      // Matches Press's own Font/Text Size/Font Size/Line Height system
      // exactly (common/js/lib/font-picker.js, common/js/lib/text-size.js)
      // — fontFamily/fontSizeCustom empty/null means "no override, inherit
      // the natural default"; fontSizeCustom (a pt value), when set, wins
      // over the textSize preset above, same precedence Press uses.
      // Line Height is seeded with a real, visible 1.3 (Press's own
      // DEFAULT_LINE_HEIGHT — template-renderer.js) rather than left
      // null/hidden: whatever the Line Height field shows is exactly what
      // gets applied, no separate invisible fallback layer (component-
      // styles.js's applyTextFormatting reads this value as-is). null stays
      // reachable only on templates saved before this field existed.
      fontFamily: "",
      fontSizeCustom: null,
      lineHeight: 1.3,
      // Freeform CSS class names (Advanced section) — see
      // common/js/lib/class-name-picker.js's suggestion list.
      className: "",
      textStyles: { bold: false, italic: false, underline: false },
      align: "start",
      // Align Items (align-self) — genuinely separate from `align` (Text
      // Align, text-align) above; see applyComponentStyles' own comment
      // (component-styles.js) for why they're two fields, not one. Blank
      // means no override (align-self: auto) — same "blank = no override"
      // convention as fontFamily.
      alignSelf: "",
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

  function createComponentElement(component, itemContext = null) {
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
        tooltip: "Remove component",
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

    // The Visible toggle/formula's actual truthiness is never evaluated
    // here (see the CSS comment on .template-component--hidden for why —
    // same "don't hide based on synthesized preview data" reasoning
    // documented for the Behavior section itself), but a plain manual
    // "Visible" off IS an unconditional authoring choice, safe to reflect
    // directly: dim the card and badge it so it doesn't read as merely
    // unselected. A binding/formula-driven Visible gets its own, non-
    // dimmed badge instead — flagging "this depends on a condition" without
    // claiming to know which way that condition will actually go for any
    // given character.
    const manuallyHidden = component.visible === false;
    const hasVisibilityCondition = Boolean(component.visibilityBinding || component.visibilityFormula);
    wrapper.classList.toggle("template-component--hidden", manuallyHidden);
    if (manuallyHidden || hasVisibilityCondition) {
      const visibilityPill = document.createElement("span");
      visibilityPill.className = `template-visibility-pill badge ${manuallyHidden ? "text-bg-warning" : "text-bg-secondary"}`;
      const visibilityIcon = document.createElement("span");
      visibilityIcon.className = "iconify";
      visibilityIcon.dataset.icon = manuallyHidden ? "tabler:eye-off" : "tabler:variable";
      visibilityIcon.setAttribute("aria-hidden", "true");
      visibilityPill.appendChild(visibilityIcon);
      visibilityPill.setAttribute("data-bs-toggle", "tooltip");
      visibilityPill.setAttribute("data-bs-placement", "top");
      visibilityPill.setAttribute(
        "data-bs-title",
        manuallyHidden ? "Hidden — Visible is turned off" : "Visible depends on a binding/formula"
      );
      const insertBefore = iconElement && actions.contains(iconElement) ? iconElement : null;
      if (insertBefore) {
        actions.insertBefore(visibilityPill, insertBefore);
      } else {
        actions.appendChild(visibilityPill);
      }
      refreshTooltip(visibilityPill);
    }

    if (iconElement) {
      iconElement.tabIndex = 0;
    }

    wrapper.appendChild(header);

    // Resolved ONCE, used for both the content below and the wrapper's own
    // applyComponentStyles call — so a heading's applyTextFormatting call
    // sees the same binding/formula/template-default-resolved color the
    // wrapper does.
    const resolvedComponent = resolveComponentColorsForPreview(component);
    const preview = renderComponentPreview(resolvedComponent, itemContext);
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

    applyComponentStyles(wrapper, excludeToggleWrapperColors(resolvedComponent));
    return wrapper;
  }

  // itemContext (preview-only — see resolvePreviewItemValue) only matters
  // for option-resolving types (a Source-driven tab's own checkbox group
  // needs its OWN tab's item, not the template-wide preview data) and
  // Container (passes context through to plain children, computes its own
  // tab item contexts — see renderContainerPreview). Every other type
  // ignores the extra argument.
  function renderComponentPreview(component, itemContext = null) {
    switch (component.type) {
      case "input":
        return renderInputPreview(component, itemContext);
      case "repeater":
        return renderRepeaterPreview(component);
      case "image":
        return renderImagePreview(component);
      case "icon":
        return renderIconPreview(component);
      case "text":
        return renderTextPreview(component);
      case "container":
        return renderContainerPreview(component, itemContext);
      case "track":
        return renderTrackPreview(component);
      case "select-group":
        return renderSelectGroupComponentPreview(component, itemContext);
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

  // Preview-only counterpart to workbench-character-view.js's
  // resolveRepeaterItemValue, for a Source-driven tab's own item. Same
  // "@value means the item itself" precedence; a deeper "@foo.bar" path
  // walks the item when it's a plain object. Returns undefined when `raw`
  // isn't an "@..." binding, so callers can fall back to the ordinary,
  // non-item-relative preview path.
  function resolvePreviewItemValue(item, raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text.startsWith("@")) return undefined;
    const path = text.slice(1).split(".").map((segment) => segment.trim()).filter(Boolean);
    if (path.length === 1 && path[0] === "value") return item;
    if (!path.length || item === null || typeof item !== "object") return undefined;
    let cursor = item;
    for (const segment of path) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) return undefined;
      cursor = cursor[segment];
    }
    return cursor;
  }

  // Prefers resolveSystemFieldValues (a direct System-field lookup) over
  // the generic resolvePreviewBindingValue path, which can't recover an
  // option's own `description`/sourceId once buildSystemPreviewData has
  // stripped it. Falls back to the generic path when the binding isn't a
  // plain top-level System field key. `itemContext` (set only inside a
  // Source-driven tab's zone) is tried FIRST — a checkbox group bound to
  // "@value" means "this tab's own item," which a top-level field lookup
  // could never resolve alone.
  function resolveSelectPreviewOptions(component, itemContext = null) {
    const binding = normalizeBindingValue(component?.sourceBinding);
    if (!binding) {
      return [];
    }
    if (itemContext) {
      const itemValues = resolvePreviewItemValue(itemContext.item, binding);
      if (itemValues !== undefined) return normalizeOptionEntries(itemValues);
    }
    const systemValues = resolveSystemFieldValues(component?.sourceBinding);
    if (systemValues) return normalizeOptionEntries(systemValues);
    const bound = resolvePreviewBindingValue(binding);
    return normalizeOptionEntries(bound);
  }

  function resolveSelectGroupPreviewOptions(component, itemContext = null) {
    const binding = normalizeBindingValue(component?.sourceBinding);
    if (!binding) {
      return [];
    }
    if (itemContext) {
      const itemValues = resolvePreviewItemValue(itemContext.item, binding);
      if (itemValues !== undefined) return normalizeOptionEntries(itemValues);
    }
    const systemValues = resolveSystemFieldValues(component?.sourceBinding);
    if (systemValues) return normalizeOptionEntries(systemValues);
    const bound = resolvePreviewBindingValue(binding);
    return normalizeOptionEntries(bound);
  }

  // A Source binding means "a choices list from the System record,"
  // resolved DIRECTLY against the System's own field schema
  // (state.systemDefinition.fields) — see the identical twin in
  // workbench-character-view.js. buildSystemPreviewData strips everything
  // but each entry's own .name off a choices field, so the generic
  // resolvePreviewBindingValue path alone could never recover a dropped
  // sourceId or `description`. Only a plain, single-segment field key is
  // supported — no Source binding in this suite needs anything nested.
  function resolveSystemFieldValues(statesBinding) {
    const trimmed = typeof statesBinding === "string" ? statesBinding.trim() : "";
    const key = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
    if (!key || key.includes(".")) return null;
    const fields = state.systemDefinition?.fields;
    if (!Array.isArray(fields)) return null;
    const field = fields.find((entry) => entry && entry.key === key);
    if (!field) return null;
    if (Array.isArray(field.values) && field.values.length) return field.values;
    if (Array.isArray(field.children) && field.children.length) return field.children;
    return null;
  }

  // Source (statesBinding) first, falling back to the literal `states` list
  // — matches resolveToggleStates' fallback in workbench-character-view.js,
  // so a Toggle authored with only a literal states list still previews
  // correctly. Deliberately NOT normalizeOptionEntries — that discards a
  // Source entry's own sourceId, which real bound data (e.g. a proficiency
  // rank) is plausibly stored against. Resolves the RAW Source array via
  // toggleStateEntryFromRaw instead, matching the real render.
  function resolveTogglePreviewStates(component) {
    let rawList = resolveSystemFieldValues(component?.statesBinding);
    if (!rawList) {
      const binding = normalizeBindingValue(component?.statesBinding);
      if (binding) {
        const bound = resolvePreviewBindingValue(binding);
        rawList = Array.isArray(bound) ? bound : bound && typeof bound === "object" ? Object.values(bound) : null;
      }
    }
    if (rawList && rawList.length) {
      const entries = rawList.map(toggleStateEntryFromRaw).filter(Boolean);
      if (entries.length) return entries;
    }
    if (Array.isArray(component?.states) && component.states.length) {
      return component.states
        .filter((s) => s != null)
        .map((s) => ({ value: s, label: String(s) }));
    }
    return [];
  }

  function createPreviewEmptyState(message = "Select a source to preview values.") {
    const placeholder = document.createElement("div");
    placeholder.className = "text-body-secondary small fst-italic";
    placeholder.textContent = message;
    return placeholder;
  }

  // Legacy "columns"/"rows" containerType values collapse into "grid" in
  // place (rows:1 or columns:1 respectively) — self-heals on first touch,
  // no separate migration pass. Idempotent; safe on every render.
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
      // Source-driven tabs (tabLabelsSourceBinding) take priority over the
      // static tabLabels list when set — one tab per resolved entry, using
      // its derived label (see resolveTabEntries). Falls through to the
      // static-list behavior when no Source is set.
      const sourceValues = resolveSystemFieldValues(component.tabLabelsSourceBinding);
      const sourceEntries = sourceValues ? resolveTabEntries(sourceValues) : null;
      const labels =
        sourceEntries && sourceEntries.length
          ? sourceEntries.map((entry) => entry.label)
          : Array.isArray(component.tabLabels) && component.tabLabels.length
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

    // Any zone key that's no longer valid (a legacy key, or a shrunk
    // column/row count) has its children salvaged into the first remaining
    // zone rather than discarded. Skipped entirely for Source-driven tabs:
    // the Template editor's load sequence calls renderCanvas() once
    // synchronously before state.systemDefinition finishes its async fetch,
    // so resolveSystemFieldValues transiently resolves to nothing and falls
    // back to the 2-tab default — without this guard, that one render would
    // permanently delete every "extra" zone and dump every other tab's
    // content onto the first tab. A stale key here is always safe to leave
    // alone; never safe to guess-delete off a resolve that could be transient.
    const isSourceDrivenTabs =
      component.containerType === "tabs" && Boolean(normalizeBindingValue(component.tabLabelsSourceBinding));
    if (!isSourceDrivenTabs) {
      Object.keys(component.zones).forEach((key) => {
        if (!validKeys.has(key)) {
          const items = component.zones[key];
          if (Array.isArray(items) && items.length && zones.length) {
            zones[0].components.push(...items);
          }
          delete component.zones[key];
        }
      });
    }

    return zones;
  }

  function createDefaultRepeaterHeaderCell(text) {
    const cell = createComponent("text");
    cell.text = text;
    cell.textStyles = { ...(cell.textStyles || {}), bold: true };
    return cell;
  }

  // Repeater's item template and optional header row are authored on
  // canvas exactly like a Container's grid zones — one zone per column, per
  // row-kind, reusing the same zones:{key:[]} storage. "item-{col}" zones
  // repeat once per bound array item at render time
  // (workbench-character-view.js's renderRepeaterComponent); "header-{col}"
  // zones (showHeader only) are authored once and never repeat.
  //
  // Self-healing: an old saved Repeater's single flat zones.item array
  // (from before columns/header existed) migrates into zones["item-0"] on
  // first encounter, so an existing single-column Repeater keeps its exact
  // item template unchanged.
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

    // Purely cosmetic below (same zone-{n} keys/storage regardless) —
    // Horizontal transposes what "columns" means, so the axis word in every
    // zone label/seed flips from "Column" to "Row" to match.
    const isHorizontal = component.orientation === "horizontal";
    const axisWord = isHorizontal ? "Row" : "Column";
    if (component.showHeader) {
      for (let col = 0; col < columns; col += 1) {
        const label = columns > 1 ? `Header — ${axisWord} ${col + 1}` : "Header";
        registerZone(`header-${col}`, label, { seedText: `${axisWord} ${col + 1}` });
      }
    }
    for (let col = 0; col < columns; col += 1) {
      const label = columns > 1 ? `Item — ${axisWord} ${col + 1}` : "Item template";
      registerZone(`item-${col}`, label);
    }

    // Shrinking columns salvages overflow columns into the first remaining
    // zone of the SAME row-kind (header into header, item into item) rather
    // than discarding them. Turning the header off does NOT delete its
    // zone data, so re-enabling it restores exactly what was there.
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

  function createContainerDropzone(component, zone, { label, hint, alignItems, textAlign, itemContext = null } = {}) {
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
    // Applied to `drop` (the flex container dropped cards become children
    // of), not `wrapper` — setting these on `wrapper` was a no-op for card
    // positioning.
    if (alignItems) drop.style.alignItems = alignItems;
    if (textAlign) drop.style.textAlign = textAlign;
    if (Array.isArray(zone.components) && zone.components.length) {
      zone.components.forEach((child) => {
        drop.appendChild(createComponentElement(child, itemContext));
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

  function renderInputPreview(component, itemContext = null) {
    return renderInputContent(component, {
      // Same shape renderImagePreview/renderIconPreview use — Button's
      // Icon/Image fields ARE those exact fields, so preview resolution
      // must match, not approximate it.
      resolveBindableString(raw) {
        return resolvePreviewBindingValue(raw);
      },
      evaluateFormula: evaluatePreviewFormula,
      resolveValue(comp, fallback) {
        return fallback;
      },
      // Visual disabled-state only — onChange is a no-op regardless, since
      // there's no live data to write to in the canvas.
      editable(comp) {
        return !comp.readOnly;
      },
      onChange() {},
      resolveOptions(comp) {
        return resolveSelectPreviewOptions(comp, itemContext);
      },
      // A Checkbox/Radio group with a Source configured trusts its
      // resolution exactly like Select does (resolveSelectPreviewOptions),
      // including showing genuinely empty when the bound System field has
      // nothing yet — more honest than sample placeholders that look
      // configured. Falls back to 3 sample options only when there's no
      // Source at all.
      resolveChoiceOptions(comp) {
        if (comp?.sourceBinding) {
          return resolveSelectPreviewOptions(comp, itemContext);
        }
        return Array.isArray(comp.options) && comp.options.length ? comp.options : ["Option A", "Option B", "Option C"];
      },
      wrapControl(input) {
        return input;
      },
      wrapEmptyOptions(field) {
        const container = document.createElement("div");
        container.className = "d-flex flex-column gap-2";
        container.appendChild(field);
        container.appendChild(createPreviewEmptyState());
        return container;
      },
      // Always inert — the canvas preview shouldn't invite a click that
      // silently does nothing real (same convention as renderTogglePreview's
      // editable:()=>false). Stays clickable-looking, but does nothing.
      runButtonAction() {},
    });
  }

  // The canvas shows the item template ONCE, as a real editable dropzone —
  // not multiplied per resolved sample item, since multiplying editable
  // dropzones would make it ambiguous which one a drag/drop edit targets.
  // Real per-item repetition happens at play time
  // (workbench-character-view.js's renderRepeaterComponent).
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
    if (type === "custom") {
      const formula = typeof decorator.formula === "string" ? decorator.formula.trim() : "";
      return formula ? `=${formula}` : (decorator.text || "").trim() || "(empty)";
    }
    return "";
  }

  // An old saved template may still have `component.src` instead of
  // `component.url` — read as a fallback everywhere a URL is needed, so
  // existing Image components self-heal on first edit with no migration step.
  function renderImagePreview(component) {
    return renderImageContent(component, {
      resolveBindableString(raw) {
        return resolvePreviewBindingValue(raw);
      },
      evaluateFormula: evaluatePreviewFormula,
    });
  }

  // iconClass, for the canvas preview specifically, an "@path" value
  // resolves against the template's sample/preview data
  // (resolvePreviewBindingValue, the same helper every other bound field's
  // preview uses) rather than a live character record.
  function renderIconPreview(component) {
    return renderIconContent(component, {
      resolveBindableString(raw) {
        return resolvePreviewBindingValue(raw);
      },
      evaluateFormula: evaluatePreviewFormula,
    });
  }

  function renderTextPreview(component) {
    // Binding/formula take priority over the static text fallback, matching
    // resolveComponentValue's precedence at play time. Sample data can't
    // always resolve a binding (e.g. a Repeater item-relative @-path always
    // comes back empty here) and a formula can never evaluate in the canvas
    // at all — in both cases, show the binding/formula text itself rather
    // than silently falling through to the generic "Text" label.
    return renderTextContent(component, {
      resolveValue(comp, fallback) {
        const binding = normalizeBindingValue(comp.binding);
        const formula = typeof comp.formula === "string" ? comp.formula.trim() : "";
        if (formula) {
          return `=${formula}`;
        }
        if (binding) {
          const resolved = resolvePreviewBindingValue(binding);
          return resolved !== undefined && resolved !== null && String(resolved).trim()
            ? String(resolved).trim()
            : binding;
        }
        return fallback;
      },
    });
  }

  // resolveContainerZoneAlignItems/resolveContainerZoneTextAlign now live in
  // ../lib/component-renderers.js, shared with workbench-character-view.js.

  // itemContext here is the context this Container ITSELF was rendered
  // with — nested inside an OUTER Source-driven tab's zone — passed through
  // unchanged to plain children. Independent of whether this Container
  // ALSO has its own tabLabelsSourceBinding (computed fresh per zone below)
  // — mirrors workbench-character-view.js's renderContainerComponent.
  function renderContainerPreview(component, itemContext = null) {
    return renderContainerContent(component, {
      // Container's Label field accepts a literal "@path", same as Icon's
      // iconClass/Image's url, plus a separate `formula` field for "=".
      // Evaluated first; binding/literal resolve against the template's
      // sample/preview data.
      resolveValue(comp, fallback) {
        const formula = typeof comp.formula === "string" ? comp.formula.trim() : "";
        if (formula) {
          const result = evaluatePreviewFormula(formula);
          if (result !== undefined && result !== null && String(result).trim()) {
            return String(result).trim();
          }
          return `=${formula}`;
        }
        const raw = typeof comp.label === "string" ? comp.label.trim() : "";
        if (!raw.startsWith("@")) return fallback;
        const resolved = resolvePreviewBindingValue(raw);
        return resolved !== undefined && resolved !== null && String(resolved).trim()
          ? String(resolved).trim()
          : raw;
      },
      getZones(comp) {
        return ensureContainerZones(comp);
      },
      renderZone(comp, zone, { label, hint, alignItems, textAlign, zoneIndex }) {
        // Preview-only twin of the live view's own tabEntry lookup — a
        // Source-driven tab's zone gets a { kind: "tab", item, key } context
        // from that tab's real System-sourced entry, so an authored
        // checkbox group inside it can preview real options while still
        // being authored just once.
        const sourceValues = resolveSystemFieldValues(comp.tabLabelsSourceBinding);
        const tabEntries = sourceValues ? resolveTabEntries(sourceValues) : null;
        const tabEntry = tabEntries && Number.isInteger(zoneIndex) ? tabEntries[zoneIndex] : null;
        const zoneItemContext = tabEntry ? { kind: "tab", item: tabEntry.item, key: tabEntry.key } : itemContext;
        return createContainerDropzone(comp, zone, { label, hint, alignItems, textAlign, itemContext: zoneItemContext });
      },
      getActiveTabIndex(comp, total) {
        return getActiveTabIndex(comp, total);
      },
      setActiveTabIndex(comp, index) {
        setActiveTabIndex(comp, index);
      },
    });
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

  const previewTrackCtx = {
    resolveTrackState(comp) {
      return getTrackPreviewState(comp);
    },
    editable() {
      return false;
    },
    onChange() {},
  };

  function renderLinearTrackPreview(component) {
    return renderLinearTrackContent(component, previewTrackCtx);
  }

  function renderCircularTrackPreview(component) {
    return renderCircularTrackContent(component, previewTrackCtx);
  }

  function renderSelectGroupComponentPreview(component, itemContext = null) {
    return renderSelectGroupContent(component, {
      resolveOptions(comp) {
        return resolveSelectGroupPreviewOptions(comp, itemContext);
      },
      // No live record to compare against — a representative "first
      // option(s) look selected" state instead (tags treats `multiple`
      // slightly more leniently than buttons/default, preserved as-is).
      isActive(comp, option, index) {
        if (comp.variant === "tags") {
          return comp.multiple !== false ? index < 2 : index === 0;
        }
        return comp.multiple ? index < 2 : index === 0;
      },
      editable(comp) {
        return !comp.readOnly;
      },
      onSelect() {},
      wrapEmptyOptions(comp, labelText) {
        const container = document.createElement("div");
        container.className = "d-flex flex-column gap-2";
        if (labelText) {
          container.appendChild(
            createLabeledField({
              component: comp,
              control: document.createDocumentFragment(),
              labelText,
              labelTag: "div",
              labelClasses: ["fw-semibold", "text-body-secondary"],
              applyFormatting: applyTextFormatting,
            })
          );
        }
        container.appendChild(createPreviewEmptyState());
        return container;
      },
    });
  }

  function renderTogglePreview(component) {
    return renderToggleContent(component, {
      resolveStates(comp) {
        return resolveTogglePreviewStates(comp);
      },
      resolveActiveIndex(comp, states) {
        const fallbackState = typeof comp.value === "string" ? comp.value.trim() : "";
        let activeIndex = states.length && fallbackState
          ? states.findIndex((s) => String(s.value) === fallbackState)
          : -1;
        if (activeIndex < 0) {
          activeIndex = clampInteger(comp.activeIndex ?? 0, 0, Math.max(states.length - 1, 0));
        }
        return activeIndex < 0 ? 0 : activeIndex;
      },
      // Always inert — same as Track's own canvas preview. Toggle is a
      // clickable shape, not a native form control, so the canvas preview
      // shouldn't invite a click that silently does nothing.
      editable() {
        return false;
      },
      onChange() {},
      wrapEmptyStates(field) {
        const container = document.createElement("div");
        container.className = "d-flex flex-column gap-2";
        container.appendChild(field);
        container.appendChild(createPreviewEmptyState("Select a source to preview toggle states."));
        return container;
      },
      // Forces a half-filled look regardless of the component's real active
      // state — lets an author judge Background/Foreground together without
      // one color being hidden by whatever the default active state is.
      // Real Play/Edit is unaffected.
      previewFillLevel: 0.5,
    });
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

  // Copy/Cut/Paste (Ctrl/Cmd+C/X/V, wired up alongside Delete near the top
  // of this file) — the only way to move a component across a Tab
  // Container's tabs. Drag-drop can't do this: only the ACTIVE tab's zone
  // is ever in the DOM, so there's nothing for SortableJS to drag into on
  // another tab. Clipboard state sidesteps that: Cut/Copy record the
  // selected component, then Paste inserts wherever the CURRENT selection
  // says to.
  function copySelectedComponent() {
    const found = findComponent(state.selectedId);
    if (!found) return;
    componentClipboard = { component: cloneComponentTree(found.component) };
    const label = COMPONENT_DEFINITIONS[found.component.type]?.label || "component";
    status.show(`Copied ${label} — select a target, then Ctrl+V to paste`, { timeout: 2200 });
  }

  function cutSelectedComponent() {
    const uid = state.selectedId;
    const found = findComponent(uid);
    if (!found) return;
    componentClipboard = { component: cloneComponentTree(found.component) };
    const label = COMPONENT_DEFINITIONS[found.component.type]?.label || "component";
    // silent: true — removeComponent's own "Removed component" toast would
    // otherwise immediately replace this more specific one.
    removeComponent(uid, { silent: true });
    status.show(`Cut ${label} — select a target, then Ctrl+V to paste`, { type: "info", timeout: 2600 });
  }

  // Where Paste lands: no selection -> end of the root canvas. A
  // zone-bearing component selected -> INTO it, at the end of its
  // currently active zone (for Tabs, whichever tab is on screen — the one
  // case drag-drop can never reach). Any other selection -> right after it,
  // as a new sibling.
  function getPasteTarget() {
    const selection = findComponent(state.selectedId);
    if (!selection) {
      return { parentId: "", zoneKey: "root", index: state.components.length };
    }
    const { component, parent, zoneKey, index } = selection;
    if (isZoneContainer(component)) {
      const zones = ensureComponentZones(component);
      if (zones.length) {
        let targetZone = zones[0];
        if (component.type === "container" && component.containerType === "tabs") {
          const activeIndex = getActiveTabIndex(component, zones.length);
          targetZone = zones[activeIndex] || zones[0];
        }
        return { parentId: component.uid, zoneKey: targetZone.key, index: targetZone.components.length };
      }
    }
    return { parentId: parent?.uid || "", zoneKey, index: index + 1 };
  }

  function pasteClipboardComponent() {
    if (!componentClipboard?.component) {
      status.show("Nothing to paste — Copy or Cut a component first", { type: "warning", timeout: 2000 });
      return;
    }
    const gate = canInsertComponent();
    if (!gate.ok) {
      status.show(gate.message, gate.options);
      return;
    }
    const target = getPasteTarget();
    const component = regenerateComponentUids(cloneComponentTree(componentClipboard.component));
    const previousSelectedId = state.selectedId || null;
    insertComponent(target.parentId, target.zoneKey, target.index, component);
    state.selectedId = component.uid;
    undoStack.push({
      type: "add",
      templateId: state.template?.id || "",
      component: cloneComponentTree(component),
      parentId: target.parentId,
      zoneKey: target.zoneKey,
      index: target.index,
      previousSelectedId,
    });
    const label = COMPONENT_DEFINITIONS[component.type]?.label || "component";
    status.show(`Pasted ${label}`, { type: "success", timeout: 1800 });
    renderCanvas();
    renderInspector();
    expandInspectorPane();
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
      case "componentColor": {
        if (!entry.componentId || !entry.before) {
          return { message: "Nothing to undo", options: { timeout: 1200 } };
        }
        const found = findComponent(entry.componentId);
        if (!found) {
          return { message: "Component no longer exists", options: { type: "warning", timeout: 1800 } };
        }
        applyColorKeys(found.component, entry.before);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Reverted color change", options: { type: "info", timeout: 1500 } };
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
      case "componentColor": {
        if (!entry.componentId || !entry.after) {
          return { message: "Nothing to redo", options: { timeout: 1200 } };
        }
        const found = findComponent(entry.componentId);
        if (!found) {
          return { message: "Component no longer exists", options: { type: "warning", timeout: 1800 } };
        }
        applyColorKeys(found.component, entry.after);
        state.selectedId = entry.componentId;
        renderCanvas();
        renderInspector();
        return { message: "Reapplied color change", options: { type: "info", timeout: 1500 } };
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
      // The caller's own known id — Template bodies never persist their own
      // id (id is filename/library_items metadata, not editable content),
      // so `data.id` alone can't be trusted as a fallback.
      id = "",
    } = {}
  ) {
    templateIdAuto = false;
    const effectiveShareToken = typeof shareToken === "string" && shareToken ? shareToken : data.shareToken || "";
    const template = createBlankTemplate({
      id: data.id || id,
      title: data.title || "",
      version: data.version || data.metadata?.version || "0.1",
      schema: data.schema || data.system || "",
      description: data.description || "",
      type: data.type || "",
      origin,
      shareToken: effectiveShareToken,
      baseFontFamily: data.baseFontFamily || "",
      defaults: data.defaults || null,
      backgroundColor: data.backgroundColor || "",
      backgroundColorBinding: data.backgroundColorBinding || "",
      backgroundColorFormula: data.backgroundColorFormula || "",
      borderStyle: data.borderStyle || "",
      borderColor: data.borderColor || "",
      borderColorBinding: data.borderColorBinding || "",
      borderColorFormula: data.borderColorFormula || "",
      borderWidth: data.borderWidth,
      borderSides: data.borderSides || null,
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
    // Expand the palette once a template is active — applyTemplateData is
    // the one funnel both load and create paths go through.
    setPaletteCollapsed(false);
    if (typeof onStateChange === "function") onStateChange();
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
        // A brand-new, still-empty template has nothing unsaved to lose —
        // without this the beforeunload warning fired the instant this
        // button was clicked, before any real edit.
        markClean: true,
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

  function renderTemplateProperties() {
    if (!elements.templateProperties) {
      return;
    }
    const focusSnapshot = captureTemplatePropertiesFocus();
    elements.templateProperties.innerHTML = "";
    if (!state.template) {
      // No placeholder box — the section just stays collapsed until a real
      // template load calls expandTemplatePropertiesSection().
      collapseTemplatePropertiesSection();
      return;
    }

    const metadata = getTemplateMetadata(state.template.id);
    // An admin can edit any template regardless of ownership, not just
    // delete it (same bypass resolveDeleteTemplateState applies).
    const canEdit = dataManager.getUserTier() === "admin" || templateAllowsEdits(metadata);
    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-3";
    form.addEventListener("submit", (event) => event.preventDefault());

    // ID/Name/System/Type/Version/Description: the fixed identity block
    // every template has, always visible (unlike Text/Colors/Border below).
    const idField = createFormFloatingField({ id: "template-id", label: "ID", placeholder: " ", disabled: !canEdit, readonly: true });
    const idInput = idField.querySelector("input");
    idInput.value = state.template.id || "";
    idInput.dataset.templateField = "template-id";
    form.appendChild(idField);

    const nameField = createFormFloatingField({ id: "template-title", label: "Name", placeholder: "Template name", disabled: !canEdit });
    const nameInput = nameField.querySelector("input");
    nameInput.value = state.template.title || "";
    nameInput.dataset.templateField = "template-title";
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
    form.appendChild(nameField);

    const systemOptions = Array.from(systemCatalog.values())
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }))
      .filter((option) => option.value)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    const systemField = createFormFloatingField({ type: "select", id: "template-system", label: "System", options: [], disabled: !canEdit });
    const systemSelect = systemField.querySelector("select");
    systemSelect.dataset.templateField = "template-system";
    // populateSelect's own disabled placeholder option can't be re-selected
    // once a real system is chosen — system is a one-way choice.
    populateSelect(systemSelect, systemOptions, { placeholder: "Select system" });
    systemSelect.value = state.template.schema || "";
    systemSelect.addEventListener("change", (event) => {
      const nextSchema = (event.target.value || "").trim();
      state.template.schema = nextSchema;
      syncTemplateRecord({ previousId: state.template.id });
      updateSystemContext(nextSchema).catch(() => {});
      syncTemplateActions();
    });
    form.appendChild(systemField);

    const currentTypeRaw = state.template.type || "sheet";
    const currentType = currentTypeRaw.toLowerCase();
    const typeOptions = [
      { value: "sheet", label: "Sheet" },
      { value: "reference", label: "Reference" },
    ];
    if (!typeOptions.some((option) => option.value === currentType)) {
      typeOptions.push({ value: currentType, label: currentTypeRaw });
    }
    const typeField = createFormFloatingField({ type: "select", id: "template-type", label: "Type", options: typeOptions, disabled: !canEdit });
    const typeSelect = typeField.querySelector("select");
    typeSelect.dataset.templateField = "template-type";
    typeSelect.value = typeOptions.find((option) => option.value === currentType)?.value || currentType || "sheet";
    typeSelect.addEventListener("change", (event) => {
      state.template.type = event.target.value;
      syncTemplateActions();
    });
    form.appendChild(typeField);

    // Same `state.template.version` the New Template modal's own
    // new-template-version field seeds on creation.
    const versionField = createFormFloatingField({ id: "template-version", label: "Version", placeholder: "0.1", disabled: !canEdit });
    const versionInput = versionField.querySelector("input");
    versionInput.value = state.template.version || "";
    versionInput.dataset.templateField = "template-version";
    versionInput.addEventListener("input", (event) => {
      state.template.version = event.target.value || "";
      syncTemplateActions();
    });
    form.appendChild(versionField);

    const descriptionField = createFormFloatingField({
      type: "textarea",
      id: "template-description",
      label: "Description",
      placeholder: "Add a short description",
      disabled: !canEdit,
      // Bootstrap's form-floating needs an explicit height on textareas —
      // same fixed formula createTextarea (Component Properties) uses.
      style: "min-height: 72px",
    });
    const descriptionInput = descriptionField.querySelector("textarea");
    descriptionInput.value = state.template.description || "";
    descriptionInput.dataset.templateField = "template-description";
    descriptionInput.addEventListener("input", (event) => {
      state.template.description = event.target.value || "";
      syncTemplateActions();
    });
    form.appendChild(descriptionField);

    // Text / Colors / Border: the same three collapsible sections Component
    // Properties gives a component, holding the template-wide equivalents —
    // Base Font, the Text-default/Background swatch row, and sheet Border.

    // Template-level base font: excludeDefault (a template can't inherit
    // from itself), falls back to the raw DEFAULT_FONT_FAMILY when unset.
    // Built by hand, not createFormFloatingField — attachFontFamilyAutocomplete
    // needs the input already inside its real .form-floating parent.
    const baseFontWrapper = document.createElement("div");
    baseFontWrapper.className = "form-floating";
    const baseFontInput = document.createElement("input");
    baseFontInput.type = "text";
    baseFontInput.className = "form-control";
    baseFontInput.id = "template-base-font";
    baseFontInput.autocomplete = "off";
    baseFontInput.disabled = !canEdit;
    baseFontInput.dataset.templateField = "template-base-font";
    const currentBaseFamily =
      typeof state.template.baseFontFamily === "string" ? state.template.baseFontFamily.trim() : "";
    const matchedBaseOption = findFontOptionByFamily(currentBaseFamily);
    baseFontInput.value = matchedBaseOption ? matchedBaseOption.label : currentBaseFamily || DEFAULT_FONT_FAMILY;
    baseFontInput.placeholder = DEFAULT_FONT_FAMILY;
    const baseFontLabel = document.createElement("label");
    baseFontLabel.className = "fw-semibold";
    baseFontLabel.setAttribute("for", "template-base-font");
    baseFontLabel.textContent = "Base font";
    baseFontWrapper.append(baseFontInput, baseFontLabel);
    // Runs after baseFontInput has a DOM parent (baseFontWrapper, above).
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

    state.template.defaults = normalizeTemplateDefaults(state.template.defaults);

    // Text/Background — same two-up `.template-color-grid` createColorRow
    // uses for a component. Text (Font Default) is the only true
    // per-component fallback (resolveComponentColorsForPreview here,
    // resolveComponentColors in workbench-character-view.js) — a component's
    // own blank Text falls back to this, so its onClear resets to a real
    // literal rather than truly emptying it. Background is NOT a fallback
    // for anything, just the sheet's own literal visible appearance —
    // paired here purely because it's the sheet's other single color.
    const defaultsColorGrid = document.createElement("div");
    defaultsColorGrid.className = "template-color-grid";
    defaultsColorGrid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    defaultsColorGrid.append(
      createColorPickerField("Text", {
        value: state.template.defaults.fontColor || "",
        defaultValue: DEFAULT_TEMPLATE_COLORS.fontColor,
        bindingValue: state.template.defaults.fontColorFormula
          ? `=${state.template.defaults.fontColorFormula}`
          : state.template.defaults.fontColorBinding || "",
        evaluate: evaluateTemplateColorPreview,
        onManualChange: (value) => {
          state.template.defaults.fontColor = value || DEFAULT_TEMPLATE_COLORS.fontColor;
          syncTemplateActions();
          renderCanvas();
        },
        onBindingChange: (raw) => {
          const trimmed = raw.trim();
          if (trimmed.startsWith("=")) {
            state.template.defaults.fontColorFormula = trimmed.slice(1).trim();
            state.template.defaults.fontColorBinding = "";
          } else {
            state.template.defaults.fontColorBinding = trimmed;
            state.template.defaults.fontColorFormula = "";
          }
          syncTemplateActions();
          renderCanvas();
        },
        onClear: () => {
          state.template.defaults.fontColor = DEFAULT_TEMPLATE_COLORS.fontColor;
          state.template.defaults.fontColorBinding = "";
          state.template.defaults.fontColorFormula = "";
          syncTemplateActions();
          renderCanvas();
        },
      }),
      // Same createColorPickerField every component's own Colors section
      // uses, with real Clear/unset (checkered-X) and Binding/Formula
      // support — a plain <input type="color"> can never represent
      // "cleared" (it always shows a solid color).
      createColorPickerField("Background", {
        value: state.template.backgroundColor || "",
        defaultValue: COLOR_FIELD_MAP.background.default,
        bindingValue: state.template.backgroundColorFormula
          ? `=${state.template.backgroundColorFormula}`
          : state.template.backgroundColorBinding || "",
        evaluate: evaluateTemplateColorPreview,
        onManualChange: (value) => {
          state.template.backgroundColor = value;
          syncTemplateActions();
          renderCanvas();
        },
        onBindingChange: (raw) => {
          const trimmed = raw.trim();
          if (trimmed.startsWith("=")) {
            state.template.backgroundColorFormula = trimmed.slice(1).trim();
            state.template.backgroundColorBinding = "";
          } else {
            state.template.backgroundColorBinding = trimmed;
            state.template.backgroundColorFormula = "";
          }
          syncTemplateActions();
          renderCanvas();
        },
        onClear: () => {
          state.template.backgroundColor = "";
          state.template.backgroundColorBinding = "";
          state.template.backgroundColorFormula = "";
          syncTemplateActions();
          renderCanvas();
        },
      })
    );

    form.appendChild(
      createCollapsibleSection("Text", [baseFontWrapper], {
        defaultCollapsed: true,
        forceOpen: Boolean(currentBaseFamily),
      })
    );

    const colorsForceOpen =
      Boolean(state.template.backgroundColor || state.template.backgroundColorBinding || state.template.backgroundColorFormula) ||
      Boolean(
        (state.template.defaults.fontColor && state.template.defaults.fontColor !== DEFAULT_TEMPLATE_COLORS.fontColor) ||
          state.template.defaults.fontColorBinding ||
          state.template.defaults.fontColorFormula
      );
    form.appendChild(
      createCollapsibleSection("Colors", [defaultsColorGrid], {
        defaultCollapsed: true,
        forceOpen: colorsForceOpen,
      })
    );

    form.appendChild(
      createCollapsibleSection("Border", [createTemplateBorderControls(canEdit)], {
        defaultCollapsed: true,
        forceOpen: Boolean(state.template.borderStyle),
      })
    );

    elements.templateProperties.appendChild(form);
    restoreTemplatePropertiesFocus(focusSnapshot);
  }

  // Whether any of the given keys differ from a pristine, freshly-created
  // component of the same type — forces a collapsed-by-default section
  // (Text/Colors/Border/etc.) open when it already has non-default values.
  // Builds a real throwaway instance via createComponent so this can never
  // drift from the actual defaults logic; saves/restores componentCounter
  // around the call so the comparison instance doesn't steal a uid.
  function hasNonDefaultValues(component, keys) {
    if (!component?.type || !Array.isArray(keys) || !keys.length) {
      return false;
    }
    const savedCounter = componentCounter;
    let pristine;
    try {
      pristine = createComponent(component.type);
    } catch (error) {
      return false;
    } finally {
      componentCounter = savedCounter;
    }
    return keys.some((key) => {
      const current = component[key];
      const defaultValue = pristine[key];
      if ((typeof current === "object" && current !== null) || (typeof defaultValue === "object" && defaultValue !== null)) {
        return JSON.stringify(current) !== JSON.stringify(defaultValue);
      }
      return current !== defaultValue;
    });
  }

  // Matches the canonical section list both Press and Workbench share:
  // General, Text, Colors, Border, Behavior, Advanced. Colors vs. Border:
  // the three swatches are a "Colors" concern; a border's own geometry
  // (width/style/radius/sides) is its own separate "Border" section.
  const TEXT_KEYS = ["labelPosition", "fontFamily", "textSize", "fontSizeCustom", "lineHeight", "textStyles", "align", "richText"];
  const COLOR_KEYS = ["textColor", "foregroundColor", "backgroundColor", "borderColor"];
  const BORDER_KEYS = ["borderWidth", "borderStyle", "borderRadius", "borderSides"];
  const BEHAVIOR_KEYS = [
    "collapsible", "collapsibleBinding", "collapsibleFormula",
    "readOnly", "readOnlyBinding", "readOnlyFormula",
    "editableInPlay", "editableInPlayBinding", "editableInPlayFormula",
    "visible", "visibilityBinding", "visibilityFormula",
  ];
  const ADVANCED_KEYS = ["padding", "margin", "className"];

  // Every field builder marks its own label/heading with the shared
  // ".fw-semibold" class, textContent set to the exact labelText — enough
  // to find a named field (Type, Placeholder, Source / Options, Binding /
  // Text) inside an already-built controls array and reposition it,
  // without every builder needing its own tagging convention.
  function pluckControlByLabel(controls, labelText) {
    const index = controls.findIndex((el) => el?.querySelector?.(".fw-semibold")?.textContent === labelText);
    if (index === -1) return null;
    return controls.splice(index, 1)[0];
  }

  function renderInspector() {
    renderTemplateProperties();
    if (!elements.inspector) return;
    const focusSnapshot = captureInspectorFocus();
    // Disposed before the wipe, not left to be garbage-collected (see
    // tooltips.js) — this reruns on every selection change.
    disposeTooltips(elements.inspector);
    elements.inspector.innerHTML = "";
    const selection = findComponent(state.selectedId);
    const component = selection?.component;
    if (!component) {
      // Only steals focus back to Template Properties when there's a real
      // template to show — otherwise this would re-expand an empty section
      // renderTemplateProperties() just collapsed.
      if (state.template) {
        expandTemplatePropertiesSection();
      }
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
    const wrapper = document.createElement("div");
    // gap-3, not gap-4 — the one gap between the Type Summary card and
    // everything below it is deliberately tighter than the rest.
    wrapper.className = "d-flex flex-column gap-3";

    // Section 1 — Type Summary, never collapsible.
    const parentLabel = selection.parent ? (selection.parent.label || selection.parent.name || COMPONENT_DEFINITIONS[selection.parent.type]?.label) : null;
    wrapper.appendChild(
      createTypeSummaryHeader({
        icon: COMPONENT_ICONS[component.type] || "tabler:app-window",
        label: definition.label || component.type,
        description: definition.description || "",
        parentLabel,
        onSelectParent: parentLabel ? () => selectComponent(selection.parent.uid) : null,
      })
    );

    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-4";
    form.addEventListener("submit", (event) => event.preventDefault());

    // Field order within the unlabeled General section follows one fixed
    // rule regardless of type: Type, ID, Label, Placeholder, Source /
    // Options, Binding / Text, then the type's own remaining controls.
    // Each render*Inspector authors these alongside the type's other
    // fields, so they're plucked out by label text and reinserted at the
    // front so the fixed order holds no matter which type built them.
    const componentSpecificControls = renderComponentSpecificInspector(component).filter(Boolean);
    const dataControls = createDataControls(component, definition).filter(Boolean);
    const remainingComponentControls = [...componentSpecificControls, ...dataControls];
    const typeControl = pluckControlByLabel(remainingComponentControls, "Type");
    const placeholderControl = pluckControlByLabel(remainingComponentControls, "Placeholder");
    const sourceOptionsControl = pluckControlByLabel(remainingComponentControls, "Source / Options");
    const bindingTextControl = pluckControlByLabel(remainingComponentControls, "Binding / Text");

    // Unlabeled, never collapsible — just the fields that come before the
    // first real named (collapsible-with-a-heading) section, Text.
    const generalControls = [
      typeControl,
      createTextInput(component, "ID", component.id || "", (value) => {
        updateComponent(component.uid, (draft) => {
          draft.id = value.trim();
        }, { rerenderCanvas: true });
      }, { placeholder: "Unique identifier" }),
      // Text has no separate "caption" — its own Binding/Text field IS its
      // whole content, so a generic Label here would be redundant.
      // Container gets its own Label control (createContainerLabelControl)
      // since it needs to accept a literal/`@path`/`=formula` in one field,
      // which the generic Label input below doesn't support.
      component.type === "text"
        ? null
        : component.type === "container"
          ? createContainerLabelControl(component)
          : createTextInput(component, "Label", getComponentLabel(component), (value) => {
              updateComponent(component.uid, (draft) => {
                const next = value.trim();
                draft.label = next;
                draft.name = next;
              }, { rerenderCanvas: true });
            }, { placeholder: "Displayed label" }),
      placeholderControl,
      sourceOptionsControl,
      bindingTextControl,
      ...remainingComponentControls,
      // Every type, unconditionally — lives here rather than in Text
      // alongside Text Align (see createAlignItemsControl).
      createAlignItemsControl(component),
    ].filter(Boolean);
    if (generalControls.length) {
      const generalGroup = document.createElement("div");
      generalGroup.className = "d-flex flex-column gap-3";
      generalControls.forEach((control) => generalGroup.appendChild(control));
      form.appendChild(generalGroup);
    }

    // Section 3 — Text (collapsed unless non-default values are set):
    // Font/Text size/Label position/Text style/Alignment, matching Press's
    // own separate "Text" group. Label position goes last — it's a
    // structural placement choice, not a text-formatting property.
    const textControls = [];
    if (componentHasTextControls(component)) {
      textControls.push(...createTextFormattingControls(component));
      textControls.push(createTextStyleControls(component));
      // Text-type only — markdown rendering is renderTextContent's own
      // concern, not shared by other text-having types this section covers.
      if (component.type === "text") {
        textControls.push(createRichTextControl(component));
      }
    }
    if (definition.supportsAlignment !== false && componentHasTextControls(component)) {
      textControls.push(createAlignmentControls(component));
    }
    if (componentSupportsLabelPosition(component)) {
      textControls.push(createLabelPositionControl(component));
    }
    if (textControls.filter(Boolean).length) {
      form.appendChild(
        createCollapsibleSection("Text", textControls, {
          defaultCollapsed: true,
          forceOpen: hasNonDefaultValues(component, TEXT_KEYS),
        })
      );
    }

    // Section 4 — Colors (collapsed unless non-default): the three
    // swatches only — border geometry is its own "Border" section below.
    const colorControls = getColorControls(component);
    if (colorControls.length) {
      form.appendChild(
        createCollapsibleSection("Colors", [createColorRow(component, colorControls)], {
          defaultCollapsed: true,
          forceOpen: hasNonDefaultValues(component, COLOR_KEYS),
        })
      );
    }

    // Section 5 — Border (collapsed unless non-default): only for types
    // whose Colors section includes a border swatch. Toggle's own
    // renderToggleContent draws a genuine per-side border, so Style/Width/
    // Sides are real for it; Corner radius only does something for the
    // "square" shape (every other shape has its own silhouette a radius
    // would conflict with), but is shown unconditionally to avoid forking
    // this section just for Toggle.
    if (colorControls.includes("border")) {
      form.appendChild(
        createCollapsibleSection("Border", [createBorderControls(component)], {
          defaultCollapsed: true,
          forceOpen: hasNonDefaultValues(component, BORDER_KEYS),
        })
      );
    }

    // Section 6 — Behavior (collapsed unless non-default values are set).
    const behaviorControls = [createCollapsibleToggle(component)];
    if (definition.supportsReadOnly) {
      behaviorControls.push(createReadOnlyToggle(component));
    }
    if (definition.supportsBinding) {
      behaviorControls.push(createEditableInPlayToggle(component));
    }
    behaviorControls.push(createVisibilityControl(component));
    form.appendChild(
      createCollapsibleSection("Behavior", behaviorControls, {
        defaultCollapsed: true,
        forceOpen: hasNonDefaultValues(component, BEHAVIOR_KEYS),
      })
    );

    // Section 7 — Advanced (collapsed unless non-default). Available
    // unconditionally, every type — unlike everything else in this
    // inspector, which is gated by registry flags/component type.
    form.appendChild(
      createCollapsibleSection(
        "Advanced",
        [...createSpacingControls(component), createClassNameControl(component)],
        {
          defaultCollapsed: true,
          forceOpen: hasNonDefaultValues(component, ADVANCED_KEYS),
        }
      )
    );

    wrapper.appendChild(form);
    elements.inspector.appendChild(wrapper);
    refreshTooltips(elements.inspector);
    restoreInspectorFocus(focusSnapshot);
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

  // Only two field concepts exist across this whole inspector: "Binding /
  // Text" (what populates this component from the Character record) and
  // "Source / Options" (what populates a choices list from the System
  // record — only for types that genuinely have one). This is the one
  // Source/Options shape that supports both a plain System-field binding
  // ("@armorCategories") and a Library-search formula
  // ("=libraryEntries('feature', 'tags.categories', 'character')") — used
  // wherever a component might serve as a Repeater's own pickable Add-cell
  // (see hasConfiguredSource/findPickableCell, workbench-character-view.js).
  // Not context-gated to "only inside a Repeater item template" — same as
  // Container's tabs Source field, the field is simply inert where unread.
  function createSourceOptionsInput(component) {
    return createBindingFormulaInput(component, {
      labelText: "Source / Options",
      placeholder: "@fieldKey or =libraryEntries('kind', 'path', 'value')",
      bindingKey: "sourceBinding",
      formulaKey: "sourceFormula",
      allowedFieldCategories: ["array", "object"],
      afterCommit: ({ draft, result }) => {
        if (!result || result.type === "empty") {
          draft.sourceBinding = "";
          draft.sourceFormula = "";
        }
      },
    });
  }

  // Only meaningful on the one cell within a grouped Repeater's item
  // template whose own Binding matches that Repeater's Group by field (see
  // renderGenericAddControls, workbench-character-view.js) — offered
  // unconditionally, same as Source/Options above, since an Inspector can't
  // detect that ancestry from a single component alone. Tells a grouped Add
  // pick where to read its matching group key from the candidate's own
  // record, since the two schemas don't necessarily share a path name.
  function createCandidateBindingInput(component) {
    return createTextInput(
      component,
      "Group key source (optional)",
      component.candidateBinding || "",
      (value) => {
        const trimmed = value.trim();
        updateComponent(component.uid, (draft) => {
          if (trimmed) draft.candidateBinding = trimmed;
          else delete draft.candidateBinding;
        }, { rerenderCanvas: true });
      },
      { placeholder: "@stats.level — read from a picked item, when this is a group key" }
    );
  }

  function createDataControls(component, definition = {}) {
    const supportsBinding = definition.supportsBinding !== false;
    const supportsFormula = definition.supportsFormula !== false;
    if (!component || (!supportsBinding && !supportsFormula && component.type !== "toggle")) {
      return [];
    }
    if (component.type === "input") {
      // Offered for every variant, not just Select — a plain Text/Number
      // input can equally serve as a Repeater's pickable Add-cell (see
      // createSourceOptionsInput above), telling the Add mechanism where a
      // candidate list comes from even with no dropdown of its own.
      const controls = [
        createSourceOptionsInput(component),
        createBindingFormulaInput(component, {
          labelText: "Binding / Text",
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: ["string", "number"],
        }),
        createCandidateBindingInput(component),
      ];
      return controls;
    }
    if (component.type === "select-group") {
      const controls = [
        createBindingFormulaInput(component, {
          labelText: "Source / Options",
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
          labelText: "Binding / Text",
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: component.multiple ? ["array", "object"] : ["string", "number"],
        })
      );
      return controls;
    }
    if (component.type === "toggle") {
      const controls = [
        createBindingFormulaInput(component, {
          labelText: "Source / Options",
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
          labelText: "Binding / Text",
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: ["string", "number"],
        }),
      ];
      return controls;
    }
    const controls = [];
    if (supportsBinding || supportsFormula) {
      controls.push(
        createBindingFormulaInput(component, {
          labelText: "Binding / Text",
          supportsBinding,
          supportsFormula,
        })
      );
    }
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

  function createColorRow(component, keys = []) {
    const controls = keys.filter((key) => COLOR_FIELD_MAP[key]);
    if (!controls.length) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    // No "Colors" heading here — the outer section heading already says
    // what this is.
    const grid = document.createElement("div");
    grid.className = "template-color-grid";
    if (controls.length > 0) {
      // Caps at 4 per row — Toggle is the first type with all four
      // concepts (Text/Foreground/Background/Border) at once.
      grid.style.gridTemplateColumns = `repeat(${Math.min(controls.length, 4)}, minmax(0, 1fr))`;
    }
    controls.forEach((key) => {
      const config = COLOR_FIELD_MAP[key];
      const bindingValue = component[config.formulaProp]
        ? `=${component[config.formulaProp]}`
        : component[config.bindingProp] || "";
      grid.appendChild(
        createColorPickerField(config.label, {
          // The raw stored color, not padded to config.default when empty —
          // createColorPickerField's own defaultValue param already covers
          // "what hue to start the popover from." Padding value itself made
          // a cleared color indistinguishable from a real chosen default,
          // since the picker's committedHex/hasManualValue derive straight
          // from value.
          value: component[config.prop] || "",
          defaultValue: config.default,
          bindingValue,
          evaluate: evaluatePreviewColor,
          // updateComponentColor, not updateComponent — adds the before/
          // after snapshot that makes this undoable. Fires once per commit
          // (see color-picker.js's commitCurrent), never per drag frame.
          onManualChange: (value) => {
            updateComponentColor(component.uid, (draft) => {
              draft[config.prop] = value;
              // Picking a border color also turns the border on (same as
              // the Style select) — only when a real color is chosen;
              // clearing the swatch doesn't touch style.
              if (key === "border" && value && (!draft.borderStyle || draft.borderStyle === "none")) {
                draft.borderStyle = "solid";
                if (draft.borderWidth === null || draft.borderWidth === undefined) draft.borderWidth = 1;
              }
            }, { rerenderCanvas: true, rerenderInspector: true });
          },
          // Same "=formula writes the Formula key, anything else writes the
          // Binding key" split every other Binding/Formula pair here uses.
          onBindingChange: (raw) => {
            const trimmed = raw.trim();
            updateComponentColor(component.uid, (draft) => {
              if (trimmed.startsWith("=")) {
                draft[config.formulaProp] = trimmed.slice(1).trim();
                draft[config.bindingProp] = "";
              } else {
                draft[config.bindingProp] = trimmed;
                draft[config.formulaProp] = "";
              }
            }, { rerenderCanvas: true, rerenderInspector: true });
          },
          onClear: () => {
            updateComponentColor(component.uid, (draft) => {
              draft[config.bindingProp] = "";
              draft[config.formulaProp] = "";
              // Also resets the literal to unset — a blank textColor isn't
              // "invisible text," it means inherit the template's own Font
              // Default (see resolveComponentColorsForPreview), same as a
              // blank background/border inherits the sheet's own.
              draft[config.prop] = "";
            }, { rerenderCanvas: true, rerenderInspector: true });
          },
        })
      );
    });
    wrapper.appendChild(grid);
    return wrapper;
  }

  // Shown alongside the Border color swatch whenever a component supports
  // "border" in its colorControls — without width/style, a border color
  // alone renders nothing (a 0-width border is invisible regardless).
  function createBorderControls(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";

    // Style select comes first, no separate label (the outer section
    // heading already says "Border"); an aria-label keeps it accessible.
    // currentStyle reads component.borderStyle directly, no cross-property
    // inference — borderStyle IS the border on/off switch; borderColor/
    // borderWidth/borderSides are downstream of it, not the other way
    // around. The change handler below writes real borderColor/borderWidth
    // the moment a real style is chosen, so nothing downstream needs its
    // own invented rendering fallback.
    const styleWrapper = document.createElement("div");
    styleWrapper.className = "d-flex flex-column";
    const styleId = toId([component.uid, "border-style"]);
    const styleSelect = document.createElement("select");
    styleSelect.className = "form-select";
    styleSelect.id = styleId;
    styleSelect.setAttribute("aria-label", "Border style");
    const currentStyle = component.borderStyle || "none";
    BORDER_STYLE_OPTIONS.forEach(({ value, label: optionLabel }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      if (currentStyle === value) {
        option.selected = true;
      }
      styleSelect.appendChild(option);
    });
    styleSelect.addEventListener("change", () => {
      updateComponent(component.uid, (draft) => {
        const nextStyle = styleSelect.value;
        if (nextStyle === "none") {
          // Turning the border off — style is the switch, so everything
          // downstream goes back to genuinely unset too, not left behind
          // as stale data with no effect.
          draft.borderStyle = "";
          draft.borderColor = "";
          draft.borderWidth = null;
          draft.borderSides = null;
        } else {
          draft.borderStyle = nextStyle;
          // Turning the border on for the first time — write real values
          // now rather than letting the renderer invent an unchosen
          // fallback. Only fills what's still genuinely unset — an
          // already-configured color/width isn't overwritten.
          if (!draft.borderColor) draft.borderColor = COLOR_FIELD_MAP.border.default;
          if (draft.borderWidth === null || draft.borderWidth === undefined) draft.borderWidth = 1;
        }
      }, { rerenderCanvas: true, rerenderInspector: true });
    });
    styleWrapper.appendChild(styleSelect);
    wrapper.appendChild(styleWrapper);

    // Corner radius is a no-op for every Toggle shape except "square" (see
    // renderToggleContent, component-renderers.js) — circle already has
    // its own fixed radius, diamond/star/diamond-quarters their own
    // clip-path, so an independently authored radius there would do
    // nothing. Left out entirely rather than shown-but-inert, same
    // reasoning the Sides group below already applies when there's no
    // border at all — showing a live-looking control that quietly does
    // nothing is its own kind of invisible-default confusion.
    const showCornerRadius = component.type !== "toggle" || component.shape === "square";
    const thicknessRadiusFields = [
      createHalfWidthNumberField("Thickness (px)", component.borderWidth, (value) => {
        updateComponent(component.uid, (draft) => {
          draft.borderWidth = value === null ? 1 : value;
        }, { rerenderCanvas: true });
      }, { min: 0, max: 12, step: 1 }),
    ];
    if (showCornerRadius) {
      thicknessRadiusFields.push(
        createHalfWidthNumberField("Corner radius (px)", component.borderRadius ?? 0, (value) => {
          updateComponent(component.uid, (draft) => {
            draft.borderRadius = value === null ? 0 : value;
          }, { rerenderCanvas: true });
        }, { min: 0, max: 24, step: 1 })
      );
    }
    wrapper.appendChild(createFieldRow(thicknessRadiusFields, showCornerRadius ? { columns: 2 } : {}));

    // No Sides toggle group at all when there's no border — with the
    // switch off, "which sides" isn't a real, applicable choice; showing
    // it pre-checked while inert is its own kind of invisible-default
    // confusion (looks like a live setting, does nothing). No "Sides"
    // heading either when it IS shown — the button group's own icon-less
    // Top/Right/Bottom/Left labels are self-explanatory directly under
    // Border's other controls.
    if (currentStyle !== "none") {
      wrapper.appendChild(
        createInspectorToggleGroup(
          component,
          "",
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
    }

    return wrapper;
  }

  // The sheet's own literal border — same Style/Color/Width/Sides shape
  // createBorderControls above gives every component, but writing to
  // state.template directly (renderCanvas/syncTemplateActions) instead of
  // updateComponent(component.uid, ...), since the template itself isn't a
  // component in state.components. Reuses BORDER_STYLE_OPTIONS/
  // DEFAULT_BORDER_SIDES/createHalfWidthNumberField/createFieldRow/
  // createInspectorToggleGroup as-is (all already generic, not coupled to
  // updateComponent) — only the Style-select/Width/Sides change handlers
  // are template-specific rewrites of createBorderControls' own.
  function createTemplateBorderControls(canEdit) {
    // No "Border" heading of its own — the outer "Border" SECTION heading
    // (createCollapsibleSection, renderTemplateProperties) already says
    // what this is, same as createBorderControls' own identical note for
    // a component's Border section.
    const wrapper = document.createElement("div");
    const body = document.createElement("div");
    body.className = "d-flex flex-column gap-2";

    const styleWrapper = document.createElement("div");
    styleWrapper.className = "d-flex flex-column";
    const styleSelect = document.createElement("select");
    styleSelect.className = "form-select";
    styleSelect.id = toId(["template", "border-style"]);
    styleSelect.disabled = !canEdit;
    styleSelect.setAttribute("aria-label", "Border style");
    const currentStyle = state.template.borderStyle || "none";
    BORDER_STYLE_OPTIONS.forEach(({ value, label: optionLabel }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionLabel;
      if (currentStyle === value) option.selected = true;
      styleSelect.appendChild(option);
    });
    styleSelect.addEventListener("change", () => {
      const nextStyle = styleSelect.value;
      if (nextStyle === "none") {
        state.template.borderStyle = "";
        state.template.borderColor = "";
        state.template.borderWidth = null;
        state.template.borderSides = null;
      } else {
        state.template.borderStyle = nextStyle;
        if (!state.template.borderColor) state.template.borderColor = COLOR_FIELD_MAP.border.default;
        if (state.template.borderWidth === null || state.template.borderWidth === undefined) state.template.borderWidth = 1;
      }
      syncTemplateActions();
      renderCanvas();
      renderTemplateProperties();
    });
    styleWrapper.appendChild(styleSelect);
    body.appendChild(styleWrapper);

    if (currentStyle !== "none") {
      // Same createColorPickerField as Background above — real Clear/unset
      // handling and Binding/Formula, not a plain <input type="color">.
      body.appendChild(
        createColorPickerField("Color", {
          value: state.template.borderColor || "",
          defaultValue: COLOR_FIELD_MAP.border.default,
          bindingValue: state.template.borderColorFormula
            ? `=${state.template.borderColorFormula}`
            : state.template.borderColorBinding || "",
          evaluate: evaluateTemplateColorPreview,
          onManualChange: (value) => {
            state.template.borderColor = value;
            syncTemplateActions();
            renderCanvas();
          },
          onBindingChange: (raw) => {
            const trimmed = raw.trim();
            if (trimmed.startsWith("=")) {
              state.template.borderColorFormula = trimmed.slice(1).trim();
              state.template.borderColorBinding = "";
            } else {
              state.template.borderColorBinding = trimmed;
              state.template.borderColorFormula = "";
            }
            syncTemplateActions();
            renderCanvas();
          },
          onClear: () => {
            state.template.borderColor = "";
            state.template.borderColorBinding = "";
            state.template.borderColorFormula = "";
            syncTemplateActions();
            renderCanvas();
          },
        })
      );

      body.appendChild(
        createHalfWidthNumberField("Thickness (px)", state.template.borderWidth, (value) => {
          state.template.borderWidth = value === null ? 1 : value;
          syncTemplateActions();
          renderCanvas();
        }, { min: 0, max: 12, step: 1 })
      );

      body.appendChild(
        createInspectorToggleGroup(
          { uid: "template" },
          "",
          [
            { value: "top", label: "Top" },
            { value: "right", label: "Right" },
            { value: "bottom", label: "Bottom" },
            { value: "left", label: "Left" },
          ],
          state.template.borderSides || DEFAULT_BORDER_SIDES,
          (key, checked) => {
            state.template.borderSides = { ...(state.template.borderSides || DEFAULT_BORDER_SIDES) };
            state.template.borderSides[key] = checked;
            syncTemplateActions();
            renderCanvas();
          }
        )
      );
    }

    wrapper.appendChild(body);
    return wrapper;
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
    // Font size (pt) + Line height, one row, each filling half of it —
    // same createHalfWidthNumberField pair as Border's Thickness/Corner
    // radius row.
    controls.push(
      createFieldRow(
        [
          createHalfWidthNumberField(
            "Font size (pt)",
            hasCustomSize ? Number(component.fontSizeCustom) : Number(pxToPt(effectivePx)),
            (value) => {
              updateComponent(component.uid, (draft) => {
                draft.fontSizeCustom = value;
              }, { rerenderCanvas: true, rerenderInspector: true });
            },
            { min: 4, max: 144, step: 0.5 }
          ),
          createHalfWidthNumberField(
            "Line height",
            // != null check first — Number(null) coerces to 0, a "finite
            // number", which would wrongly display 0 for a never-set field.
            component.lineHeight != null && Number.isFinite(Number(component.lineHeight))
              ? Number(component.lineHeight)
              : null,
            (value) => {
              updateComponent(component.uid, (draft) => {
                draft.lineHeight = value;
              }, { rerenderCanvas: true });
            },
            { min: 0.5, max: 3, step: 0.05 }
          ),
        ],
        { columns: 2 }
      )
    );

    return controls;
  }

  // Font input, searchable via the shared font library (common/js/lib/
  // font-picker.js/font-library.js) — same "Add a font…" modal/Google
  // Fonts flow as Press, sharing the exact same server-persisted list.
  function createFontFamilyControl(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-floating";
    const id = toId([component.uid, "Font", "input"]);
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.autocomplete = "off";
    input.placeholder = "Default (template font)";
    const currentFamily = typeof component.fontFamily === "string" ? component.fontFamily.trim() : "";
    const matchedOption = findFontOptionByFamily(currentFamily);
    input.value = matchedOption ? matchedOption.label : currentFamily || "Default (template font)";
    const label = document.createElement("label");
    label.className = "fw-semibold";
    label.setAttribute("for", id);
    label.textContent = "Font";
    // Must run after the input has a local DOM parent — attachFontFamilyAutocomplete
    // checks input.closest(".form-floating") (falling back to
    // input.parentElement) to find where to attach its dropdown.
    wrapper.append(input, label);
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
    wrapper.className = "form-floating";
    const id = toId([component.uid, "Classes", "input"]);
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
    const label = document.createElement("label");
    label.className = "fw-semibold";
    label.setAttribute("for", id);
    label.textContent = "Classes";
    wrapper.append(input, label);
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

  // Off by default — a plain-text field (or one whose bound value
  // legitimately contains a literal "*"/"_") keeps rendering exactly as it
  // always has; markdown parsing only runs where a template author opts a
  // Text component in. Needed so a promoted Feature's own imported
  // description (converted to **bold**/*italic*/table markdown by Loom's
  // HTML→text cleanup) can actually render that way — see
  // renderTextContent's richText branch, which reuses Repository's own
  // renderMarkdown.
  function createRichTextControl(component) {
    const options = [{ value: "richText", icon: "tabler:markdown", label: "Markdown" }];
    return createInspectorToggleGroup(component, "Rich text", options, { richText: !!component.richText }, (key, checked) => {
      updateComponent(component.uid, (draft) => {
        draft.richText = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Text Align — plain CSS text-align (component.align), applied by
  // applyTextFormatting. Only affects how this component's own text
  // content is aligned, never how the component is positioned within its
  // parent (that's Align Items, createAlignItemsControl below).
  function createAlignmentControls(component) {
    const options = [
      { value: "start", icon: "tabler:align-left", label: "Left" },
      { value: "center", icon: "tabler:align-center", label: "Center" },
      { value: "end", icon: "tabler:align-right", label: "Right" },
      { value: "justify", icon: "tabler:align-justified", label: "Justify" },
    ];
    return createRadioButtonGroup(component, "Text Align", options, component.align || "start", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.align = value;
      }, { rerenderCanvas: true });
    });
  }

  // Align Items — CSS align-self (component.alignSelf), applied to the
  // component's own outer wrapper. Lives in the unlabeled top section for
  // every type, deliberately not inside "Text" — this positions the
  // component within its own parent (a layout concern), not its text.
  function createAlignItemsControl(component) {
    // "Auto" (blank) first — the real default (inherit the parent's own
    // align-items) isn't the same as "Start," so defaulting the radio to
    // Start would misrepresent an unset value as an explicit choice.
    const options = [
      { value: "", label: "Auto" },
      { value: "start", icon: "tabler:layout-align-top", label: "Start" },
      { value: "center", icon: "tabler:layout-align-middle", label: "Center" },
      { value: "end", icon: "tabler:layout-align-bottom", label: "End" },
      { value: "stretch", icon: "tabler:arrows-vertical", label: "Stretch" },
    ];
    return createRadioButtonGroup(component, "Align Items", options, component.alignSelf || "", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.alignSelf = value;
      }, { rerenderCanvas: true });
    });
  }

  // Resolves a "@binding"/"=formula" condition string against the Template
  // editor's own sample/preview data, for createFormulaToggleField's live
  // preview. An "@path" resolves against sample data; a "=formula" can't
  // be evaluated here (no live formula engine wired into this canvas), so
  // it returns undefined (the toggle's native indeterminate state) rather
  // than guessing true or false. Two real limits: systemPreviewData is
  // synthesized purely from the System's declared field schema, so a
  // formula referencing an ad-hoc DDB-mapping-computed key has no sample
  // value; and this only ever sees top-level preview data, never a
  // Repeater item's own data (the canvas doesn't preview real per-item
  // data, just the item template as an editable dropzone).
  function previewFormulaOptions() {
    return {
      functions: {
        lookup: createLookupFn(state.systemPreviewData || {}, state.systemDefinition?.fields),
        // Registered so a formula using lookupField doesn't throw "not
        // defined" while authoring, even though the canvas never actually
        // previews per-item data where it would matter.
        lookupField: createLookupFieldFn(state.systemPreviewData || {}),
      },
    };
  }

  function evaluatePreviewFormula(formula) {
    const trimmed = typeof formula === "string" ? formula.trim() : "";
    if (!trimmed) return undefined;
    try {
      const result = evaluateFormula(trimmed, state.systemPreviewData || {}, previewFormulaOptions());
      return result === null ? undefined : result;
    } catch (error) {
      return undefined;
    }
  }

  // Same evaluation as evaluatePreviewFormula, but for the inspector's own
  // live feedback (createFieldPreviewFeedback below), which needs the
  // actual ok/error distinction — a real syntax/runtime error is worth
  // interrupting the author for, an unresolved-but-valid formula isn't.
  function evaluatePreviewFormulaDetailed(formula) {
    try {
      const result = evaluateFormula(formula, state.systemPreviewData || {}, previewFormulaOptions());
      return { ok: true, value: result === null ? undefined : result };
    } catch (error) {
      return { ok: false, error: error?.message || "Invalid formula" };
    }
  }

  // Shared live feedback line for every literal/@binding/=formula field —
  // surfaces a formula's actual syntax/runtime error, and previews what a
  // binding/formula currently resolves to against the template's sample
  // data, so an author isn't flying blind until testing on a real
  // character. Plain literal text shows nothing — it's already visible in
  // the input itself.
  function createFieldPreviewFeedback() {
    const element = document.createElement("div");
    element.className = "extra-small d-none";

    function update(raw, { supportsBinding = true, supportsFormula = true } = {}) {
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (supportsFormula && trimmed.startsWith("=")) {
        const outcome = evaluatePreviewFormulaDetailed(trimmed.slice(1).trim());
        element.classList.remove("d-none");
        if (!outcome.ok) {
          element.classList.add("text-danger");
          element.classList.remove("text-body-secondary");
          element.textContent = `Formula error: ${outcome.error}`;
        } else {
          element.classList.remove("text-danger");
          element.classList.add("text-body-secondary");
          const preview =
            outcome.value === undefined || outcome.value === null || outcome.value === ""
              ? "(no value)"
              : String(outcome.value);
          element.textContent = `Preview: ${preview}`;
        }
        return;
      }
      if (supportsBinding && trimmed.startsWith("@")) {
        const resolved = resolvePreviewBindingValue(trimmed);
        element.classList.remove("d-none", "text-danger");
        element.classList.add("text-body-secondary");
        const preview =
          resolved === undefined || resolved === null || String(resolved).trim() === ""
            ? "(no sample data for this field)"
            : String(resolved);
        element.textContent = `Preview: ${preview}`;
        return;
      }
      element.classList.add("d-none");
    }

    return { element, update };
  }

  // The template's own sheet-wide Background/Border color — same
  // Formula-then-Binding-then-literal precedence a component's own colors
  // resolve with (resolveComponentColors, workbench-character-view.js),
  // just read off state.template instead of a component.
  function resolveTemplateColorForPreview(prop) {
    const template = state.template || {};
    const formula = typeof template[`${prop}Formula`] === "string" ? template[`${prop}Formula`].trim() : "";
    if (formula) {
      const result = evaluatePreviewFormula(formula);
      if (typeof result === "string" && result.trim()) return result.trim();
    }
    const binding = typeof template[`${prop}Binding`] === "string" ? template[`${prop}Binding`].trim() : "";
    if (binding) {
      const resolved = resolvePreviewBindingValue(binding);
      if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
    }
    return template[prop] || "";
  }

  // The color picker's own live-typed preview for the template's own
  // Background/Border — unlike evaluatePreviewColor (every component's own
  // color fields), this one does evaluate "=formula".
  function evaluateTemplateColorPreview(raw) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return undefined;
    if (trimmed.startsWith("=")) {
      const result = evaluatePreviewFormula(trimmed.slice(1).trim());
      return typeof result === "string" && result.trim() ? result.trim() : undefined;
    }
    if (trimmed.startsWith("@")) {
      const resolved = resolvePreviewBindingValue(trimmed);
      return typeof resolved === "string" && resolved.trim() ? resolved.trim() : undefined;
    }
    return undefined;
  }

  function evaluatePreviewCondition(raw) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return undefined;
    if (trimmed.startsWith("=")) return undefined;
    if (trimmed.startsWith("@")) {
      const resolved = resolvePreviewBindingValue(trimmed);
      return resolved === undefined ? undefined : Boolean(resolved);
    }
    return Boolean(trimmed);
  }

  // Same "@binding previews, =formula doesn't" limit as
  // evaluatePreviewCondition above, but returns a hex string (or undefined,
  // the swatch's indeterminate stripe state) rather than a boolean.
  function evaluatePreviewColor(raw) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed) return undefined;
    if (trimmed.startsWith("=")) return undefined;
    if (trimmed.startsWith("@")) {
      const resolved = resolvePreviewBindingValue(trimmed);
      return typeof resolved === "string" && resolved.trim() ? resolved.trim() : undefined;
    }
    return undefined;
  }

  // Editor-canvas rendering only — resolves each color's @binding against
  // the same sample/preview data the swatch's own live preview uses; a
  // formula falls back to the literal color instead (the canvas never
  // evaluates "=formula"), same "best-effort, never invents a color" rule
  // real Play/Edit's resolveComponentColors follows. Text only —
  // Background/Border aren't per-component fallbacks at all.
  const TEMPLATE_DEFAULT_COLOR_MAP = { text: "fontColor" };

  // Font Default's own Formula-then-Binding-then-literal precedence — same
  // shape resolveTemplateColorForPreview gives Background/Border, read off
  // state.template.defaults instead of state.template directly.
  function resolveTemplateDefaultColorForPreview(defaultKey, templateDefaults) {
    const formula = templateDefaults[`${defaultKey}Formula`];
    if (formula) {
      const result = evaluatePreviewFormula(formula);
      if (typeof result === "string" && result.trim()) return result.trim();
    }
    const binding = templateDefaults[`${defaultKey}Binding`];
    if (binding) {
      const resolved = resolvePreviewBindingValue(binding);
      if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
    }
    return templateDefaults[defaultKey] || "";
  }

  function resolveComponentColorsForPreview(component) {
    let overridden = null;
    Object.values(COLOR_FIELD_MAP).forEach(({ prop, bindingProp }) => {
      const binding = typeof component[bindingProp] === "string" ? component[bindingProp].trim() : "";
      if (!binding || !binding.startsWith("@")) return;
      const resolved = resolvePreviewBindingValue(binding);
      const normalized = typeof resolved === "string" ? resolved.trim() : "";
      if (!normalized) return;
      if (!overridden) overridden = { ...component };
      overridden[prop] = normalized;
    });
    // Still blank after binding resolution? Fall back to the template's
    // own default — the only fallback any color field reaches, same as
    // real Play/Edit's resolveComponentColors.
    const templateDefaults = normalizeTemplateDefaults(state.template?.defaults);
    Object.entries(TEMPLATE_DEFAULT_COLOR_MAP).forEach(([key, defaultKey]) => {
      const prop = COLOR_FIELD_MAP[key].prop;
      const current = (overridden || component)[prop];
      if (typeof current !== "string" || !current.trim()) {
        if (!overridden) overridden = { ...component };
        overridden[prop] = resolveTemplateDefaultColorForPreview(defaultKey, templateDefaults);
      }
    });
    return overridden || component;
  }

  // The unified toggle/formula control backs Collapsible/Locked/Visible
  // identically — a plain manual switch when the condition field is empty,
  // or a live (binding) / indeterminate (formula) preview when it's not.
  function createCollapsibleToggle(component) {
    return createFormulaToggleField("Collapsible", {
      checked: !!component.collapsible,
      bindingValue: component.collapsibleFormula ? `=${component.collapsibleFormula}` : component.collapsibleBinding || "",
      evaluate: evaluatePreviewCondition,
      onManualChange: (checked) => {
        updateComponent(component.uid, (draft) => {
          draft.collapsible = checked;
        }, { rerenderCanvas: true });
      },
      onBindingChange: (raw) => {
        const trimmed = raw.trim();
        updateComponent(component.uid, (draft) => {
          if (trimmed.startsWith("=")) {
            draft.collapsibleFormula = trimmed.slice(1).trim();
            draft.collapsibleBinding = "";
          } else {
            draft.collapsibleBinding = trimmed;
            draft.collapsibleFormula = "";
          }
        }, { rerenderCanvas: true });
      },
    });
  }

  // "Locked" — storage key stays "readOnly".
  function createReadOnlyToggle(component) {
    return createFormulaToggleField("Locked", {
      checked: !!component.readOnly,
      bindingValue: component.readOnlyFormula ? `=${component.readOnlyFormula}` : component.readOnlyBinding || "",
      evaluate: evaluatePreviewCondition,
      onManualChange: (checked) => {
        updateComponent(component.uid, (draft) => {
          draft.readOnly = checked;
        }, { rerenderCanvas: true });
      },
      onBindingChange: (raw) => {
        const trimmed = raw.trim();
        updateComponent(component.uid, (draft) => {
          if (trimmed.startsWith("=")) {
            draft.readOnlyFormula = trimmed.slice(1).trim();
            draft.readOnlyBinding = "";
          } else {
            draft.readOnlyBinding = trimmed;
            draft.readOnlyFormula = "";
          }
        }, { rerenderCanvas: true });
      },
    });
  }

  // "Editable in Play" — same unified toggle/formula shape as Collapsible/
  // Locked above, gated to the types that have anything for a Repeater's
  // own add-row UI to act on (Input, Repeater, Track, Select Group,
  // Toggle). This is a genuine authored per-component choice to stay
  // live-adjustable in Play view instead of gated behind Edit mode.
  // Marking a Repeater itself Editable in Play is also what enables its
  // Add/Remove-row controls in Play view (see renderRepeaterComponent,
  // workbench-character-view.js).
  function createEditableInPlayToggle(component) {
    return createFormulaToggleField("Editable in Play", {
      checked: !!component.editableInPlay,
      bindingValue: component.editableInPlayFormula
        ? `=${component.editableInPlayFormula}`
        : component.editableInPlayBinding || "",
      evaluate: evaluatePreviewCondition,
      onManualChange: (checked) => {
        updateComponent(component.uid, (draft) => {
          draft.editableInPlay = checked;
        }, { rerenderCanvas: true });
      },
      onBindingChange: (raw) => {
        const trimmed = raw.trim();
        updateComponent(component.uid, (draft) => {
          if (trimmed.startsWith("=")) {
            draft.editableInPlayFormula = trimmed.slice(1).trim();
            draft.editableInPlayBinding = "";
          } else {
            draft.editableInPlayBinding = trimmed;
            draft.editableInPlayFormula = "";
          }
        }, { rerenderCanvas: true });
      },
    });
  }

  // Available on every component type, not gated by the registry. Left
  // blank, the component always shows; a bound value/formula is evaluated
  // at real character-view render time, never in the Template editor's own
  // canvas preview — the canvas only has synthesized sample data, so
  // hiding components there could make them un-selectable for reasons the
  // author can't see. The unified toggle's own live-preview evaluation
  // above only drives the toggle's visual state, never actual visibility.
  function createVisibilityControl(component) {
    return createFormulaToggleField("Visible", {
      checked: component.visible !== false,
      bindingValue: component.visibilityFormula ? `=${component.visibilityFormula}` : component.visibilityBinding || "",
      evaluate: evaluatePreviewCondition,
      onManualChange: (checked) => {
        updateComponent(component.uid, (draft) => {
          draft.visible = checked;
        }, { rerenderCanvas: true });
      },
      onBindingChange: (raw) => {
        const trimmed = raw.trim();
        updateComponent(component.uid, (draft) => {
          if (trimmed.startsWith("=")) {
            draft.visibilityFormula = trimmed.slice(1).trim();
            draft.visibilityBinding = "";
          } else {
            draft.visibilityBinding = trimmed;
            draft.visibilityFormula = "";
          }
        }, { rerenderCanvas: true });
      },
    });
  }

  // Real CSS shorthand (1-4 space-separated values), not a Workbench-
  // specific concept. Margin is the one thing that controls a component's
  // spacing from its siblings, the ordinary CSS way.
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

  // Thin adapter over the shared common/js/lib/binding-field.js control —
  // injects this page's own change-commit path (updateComponent), live
  // field list (state.bindingFields, read fresh via a callback so a field
  // left open while the System selection changes still sees the new
  // list), and sample-data preview evaluators.
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
      // literal text and written here instead of bindingKey — makes the
      // field a true combined Binding/Text control (used by Text's own
      // inspector; other callers leave it unset, so a bare non-@ value
      // still goes into bindingKey, e.g. Track's Segments field storing
      // a plain "6").
      textKey = null,
      allowedFieldCategories: categoryOverride = null,
      helperText = null,
      afterCommit = null,
    } = {}
  ) {
    const allowedFieldCategories =
      Array.isArray(categoryOverride) && categoryOverride.length
        ? categoryOverride.map((category) => String(category).toLowerCase())
        : getComponentBindingCategories(component);
    return createSharedBindingFormulaInput(component, {
      supportsBinding,
      supportsFormula,
      labelText,
      placeholder,
      bindingKey,
      formulaKey,
      textKey,
      allowedFieldCategories,
      helperText,
      afterCommit,
      idSeed: toId([component.uid, "binding-formula"]),
      getSystemFields: () => state.bindingFields,
      hasSchemaSelected: Boolean(state.template?.schema),
      onCommit: (mutator) => updateComponent(component.uid, mutator, { rerenderCanvas: true }),
      evaluateFormulaPreview: (expression) => evaluatePreviewFormulaDetailed(expression),
      resolveBindingPreview: (binding) => resolvePreviewBindingValue(binding),
    });
  }

  // Thin adapters over the shared inspector-fields.js/ui-components.js
  // factories, kept as local functions so none of this file's ~45 call
  // sites need to change, but the actual markup is the one shared
  // implementation Press's Component Inspector also uses. A placeholder is
  // required for Bootstrap's empty-vs-filled floating behavior to engage —
  // a single space keeps the label floated-small when none is supplied.
  function createTextInput(component, labelText, value, onInput, { placeholder = "", type = "text" } = {}) {
    const id = toId([component.uid, labelText, "input"]);
    const field = createFormFloatingField({ type, id, label: labelText, placeholder: placeholder || " " });
    const input = field.querySelector("input");
    input.value = value ?? "";
    input.addEventListener("input", () => {
      onInput(input.value);
    });
    return field;
  }

  function createTextarea(component, labelText, value, onInput, { rows = 3, placeholder = "" } = {}) {
    const id = toId([component.uid, labelText, "textarea"]);
    const field = createFormFloatingField({
      type: "textarea",
      id,
      label: labelText,
      placeholder: placeholder || " ",
      // form-floating needs an explicit height on textareas — the `rows`
      // attribute doesn't play well with the label's own padding.
      style: `min-height: ${rows * 24}px`,
    });
    const textarea = field.querySelector("textarea");
    textarea.value = value ?? "";
    textarea.addEventListener("input", () => {
      onInput(textarea.value);
    });
    return field;
  }

  function createNumberInput(component, labelText, value, onChange, { min, max, step = 1 } = {}) {
    const id = toId([component.uid, labelText, "number"]);
    const field = createFormFloatingField({ type: "number", id, label: labelText, placeholder: " ", min, max, step });
    const input = field.querySelector("input");
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
    return field;
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
    // Kept in the DOM (not skipped) even when hidden — pluckControlByLabel
    // (renderInspector) finds the Type selector by this exact element/text,
    // and a screen-reader-only label is still better than none. visually-
    // hidden takes the element out of layout entirely (position: absolute),
    // so it costs zero visible space in this flex column regardless.
    if (config.hideLabel) {
      heading.classList.add("visually-hidden");
    }
    heading.textContent = labelText;
    wrapper.appendChild(heading);
    const name = toId([component.uid, labelText, "radio"]);
    const group = createButtonCheckGroup({
      ariaLabel: labelText,
      name,
      // Forwarded straight to createButtonCheckGroup's own `wrap` param
      // (ui-components.js) — its real single-row/wrapping driver, not the
      // `forceSingleRow` config key some callers here still pass (dead —
      // never read by this function at all; left alone at those call
      // sites rather than renamed everywhere, since they're all still
      // correctly single-row via this same param's own `false` default).
      wrap: Boolean(config.wrap),
      options: options.map((option, index) => ({
        id: toId([component.uid, labelText, option.value, index]),
        value: option.value,
        icon: option.icon,
        text: option.label ?? option.value,
      })),
    });
    // A fixed column count, when given — flex-wrap alone (the `wrap:true`
    // case above) breaks onto a new row wherever the CONTAINER'S width
    // happens to run out, which for 7 Type options landed as 5+2 in the
    // inspector's own actual width, not the even 4+3 a 7-item group reads
    // best as. CSS Grid with a fixed track count wraps predictably
    // regardless of container width, so this overrides the flex/wrap
    // styling entirely rather than fighting it with a min-width guess.
    if (Number.isFinite(config.columns) && config.columns > 0) {
      group.style.display = "grid";
      group.style.gridTemplateColumns = `repeat(${config.columns}, 1fr)`;
    }
    group.querySelectorAll("input").forEach((input, index) => {
      const option = options[index];
      input.checked = option.value === currentValue;
      input.addEventListener("change", () => {
        if (input.checked) {
          onChange(option.value);
        }
      });
    });
    wrapper.appendChild(group);
    return wrapper;
  }

  // Unified with createRadioButtonGroup's own button-group styling
  // (template-radio-group, single-row by default) — this used to render as
  // a bare, larger `.btn-group` with no visual relation to the radio-group
  // controls right next to it in the same inspector, even though it's the
  // same segmented-button-group widget (radio vs. checkbox selection is
  // the only real difference). Matches Press's own already-shared
  // "Text decoration" checkbox group, which is this exact same field.
  function createInspectorToggleGroup(component, labelText, options, values, onToggle) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    if (labelText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold text-body-secondary";
      heading.textContent = labelText;
      wrapper.appendChild(heading);
    }
    const group = createButtonCheckGroup({
      ariaLabel: labelText || undefined,
      inputType: "checkbox",
      options: options.map((option, index) => ({
        id: toId([component.uid, labelText, option.value, index]),
        icon: option.icon,
        text: option.label,
      })),
    });
    group.querySelectorAll("input").forEach((input, index) => {
      const option = options[index];
      input.autocomplete = "off";
      input.checked = !!values[option.value];
      input.addEventListener("change", () => {
        onToggle(option.value, input.checked);
      });
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
      { value: "button", icon: "tabler:click", label: "Button" },
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
              // A Button that's never clickable outside Edit mode is
              // useless for its whole reason to exist — unlike a data
              // field (locked-by-default is the safer call there), a
              // fresh Button defaults to Play-clickable so switching a
              // field to Button "just works" without a second trip to
              // the Behavior section to also flip Editable in Play.
              // Only seeded once, switching TO Button — never overrides
              // an author who already explicitly turned it off.
              if (value === "button" && draft.editableInPlay !== true && draft.editableInPlay !== false) {
                draft.editableInPlay = true;
              }
            },
            { rerenderCanvas: true, rerenderInspector: true }
          );
        },
        // 7 options no longer fit one row legibly — columns:4 forces an
        // even 4-then-3 grid regardless of the inspector's own width.
        { wrap: true, hideLabel: true, columns: 4 }
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
    if ((component.variant || "text") === "button") {
      controls.push(...createButtonInspectorControls(component));
    }
    return controls;
  }

  // A Button's own face (Label is generic like every other component's)
  // plus its Action. Icon/Image are optional and mutually meaningful even
  // with a blank Label (a small icon-only roll button) — renderInputContent's
  // own precedence is icon, then image, then Label text, then a bare
  // "Button" fallback. Both reuse the same picker controls the real Icon/
  // Image components use, called plain — not a narrowed-down copy — so a
  // formula/"@" binding authored here resolves identically on render.
  function createButtonInspectorControls(component) {
    // labelText overrides only — Button shows both fields side by side, so
    // the standalone components' own default "Binding / Text" reads
    // ambiguous here.
    const controls = [
      createIconFieldControl(component, { labelText: "Icon" }),
      createImageUrlControl(component, { labelText: "Image" }),
    ];
    // Same single-row, half-width-each layout Toggle's own Width/Height
    // pair uses — not two full-width stacked fields.
    controls.push(
      createFieldRow(
        [
          createTextInput(component, "Width", component.width || "", (value) => {
            const next = value.trim();
            updateComponent(component.uid, (draft) => {
              draft.width = next;
            }, { rerenderCanvas: true });
          }, { placeholder: "Fits its content" }),
          createTextInput(component, "Height", component.height || "", (value) => {
            const next = value.trim();
            updateComponent(component.uid, (draft) => {
              draft.height = next;
            }, { rerenderCanvas: true });
          }, { placeholder: "2rem" }),
        ],
        { columns: 2 }
      )
    );
    const action = component.action && typeof component.action === "object" ? component.action : {};
    const actionType = action.type === "runMacro" || action.type === "adjustField" ? action.type : "rollDice";
    controls.push(
      createRadioButtonGroup(
        component,
        "Action",
        [
          { value: "rollDice", icon: "tabler:dice-5", label: "Roll Dice" },
          { value: "runMacro", icon: "tabler:wand", label: "Run a Macro" },
          { value: "adjustField", icon: "tabler:adjustments", label: "Adjust a Field" },
        ],
        actionType,
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.action = { ...(draft.action || {}), type: value };
          }, { rerenderCanvas: true, rerenderInspector: true });
        },
        { wrap: true }
      )
    );
    const updateAction = (patch) => {
      updateComponent(component.uid, (draft) => {
        draft.action = { ...(draft.action || {}), ...patch };
      }, { rerenderCanvas: true });
    };
    if (actionType === "rollDice") {
      controls.push(
        createTextInput(component, "Expression", action.expression || "", (value) => {
          updateAction({ expression: value });
        }, { placeholder: "1d20 + @abilities.strength.modifier" })
      );
    } else if (actionType === "runMacro") {
      controls.push(
        createTextInput(component, "Macro Name", action.macroRef || "", (value) => {
          updateAction({ macroRef: value });
        }, { placeholder: "Haunted Forest" })
      );
    } else {
      const hasLookup = Boolean((action.lookupBinding || "").trim());
      controls.push(
        createTextInput(component, "Binding", action.binding || "", (value) => {
          updateAction({ binding: value });
        }, { placeholder: "@available" })
      );
      controls.push(
        createSwitchField("Look up an entry first", hasLookup, (checked) => {
          updateComponent(
            component.uid,
            (draft) => {
              draft.action = { ...(draft.action || {}), lookupBinding: checked ? draft.action?.lookupBinding || "@" : "" };
            },
            { rerenderCanvas: true, rerenderInspector: true }
          );
        })
      );
      if (hasLookup) {
        controls.push(
          createTextInput(component, "Source Binding", action.lookupBinding || "", (value) => {
            updateAction({ lookupBinding: value });
          }, { placeholder: "@limitedUses" })
        );
        controls.push(
          createTextInput(component, "Match Field", action.matchField || "", (value) => {
            updateAction({ matchField: value });
          }, { placeholder: "level" })
        );
        controls.push(
          createTextInput(component, "Match Value", action.matchValue || "", (value) => {
            updateAction({ matchValue: value });
          }, { placeholder: "@level" })
        );
        controls.push(
          createTextInput(component, "Target Field", action.targetField || "", (value) => {
            updateAction({ targetField: value });
          }, { placeholder: "available" })
        );
      }
      controls.push(
        createRadioButtonGroup(
          component,
          "Mode",
          [
            { value: "delta", icon: "tabler:plus-minus", label: "Adjust" },
            { value: "set", icon: "tabler:equal", label: "Set" },
          ],
          action.mode === "set" ? "set" : "delta",
          (value) => {
            updateAction({ mode: value });
          },
          { hideLabel: false }
        )
      );
      controls.push(
        createTextInput(component, "Amount", action.amount ?? "-1", (value) => {
          updateAction({ amount: value });
        }, { placeholder: "-1" })
      );
    }
    return controls;
  }

  // Purely structural/authoring-time choice, not state that plausibly
  // varies by character — plain switch, not the unified toggle/formula
  // control (see createFormulaToggleField's own usage for Visible/
  // Collapsible/Locked, which do vary by character).
  function createRepeaterHeaderToggle(component, { isHorizontal = false } = {}) {
    return createSwitchField(isHorizontal ? "Header column" : "Header row", !!component.showHeader, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.showHeader = checked;
        ensureRepeaterZone(draft);
      }, { rerenderCanvas: true, rerenderInspector: true });
    });
  }

  // Horizontal-only — Vertical items already fill their single stacking
  // column naturally. Off by default: items sit at their own natural
  // width, left-packed, wrapping once they run out of row space (a real
  // design choice — a long open-ended list often looks better left-packed
  // than stretched). On, item cells/columns grow equally to consume the
  // full available width instead (see renderRepeaterHorizontalList/Grid).
  function createRepeaterFillToggle(component) {
    return createSwitchField("Fill available width", !!component.fill, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.fill = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Vertical list mode only (columns===1, non-Horizontal) — whether each
  // row gets a border-bottom separator. Off by default: a row hidden by
  // its own item template's Visibility formula still occupies a row slot,
  // and forcing a divider on every row unconditionally left a bare visible
  // line with nothing in it. An author can still turn this back on
  // per-Repeater for a denser/longer list.
  function createRepeaterItemDividerToggle(component) {
    return createSwitchField("Divider between rows", !!component.itemDivider, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.itemDivider = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Two independent switches, not one combined "Add/remove items" — most
  // Repeaters (ability scores, a fixed defenses list) want neither, most
  // open-ended lists (Inventory, Features) want both, but a nested Repeater
  // whose own Add flow is delegated to an ancestor (Spells' inner
  // per-level Repeater) needs Remove without Add. Plain switches, not the
  // unified toggle/formula control — whether a list is open-ended isn't
  // state that plausibly varies by character.
  function createRepeaterAllowAddToggle(component) {
    return createSwitchField("Allow adding items", !!component.allowAdd, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.allowAdd = checked;
      }, { rerenderCanvas: true, rerenderInspector: true });
    });
  }

  function createRepeaterAllowRemoveToggle(component) {
    return createSwitchField("Allow removing items", !!component.allowRemove, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.allowRemove = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Meaningless with Add off — only rendered when that's on, same gating
  // as createRepeaterSourceControls' own fields.
  function createRepeaterAllowCustomAddToggle(component) {
    return createSwitchField("Also allow a custom/blank item", !!component.allowCustomAdd, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.allowCustomAdd = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Blank (default) shows items in whatever order the bound array is
  // stored in. `sortBinding` is a bare field name within each item, never
  // an "@" path — resolved purely at render time; it also self-heals the
  // stored order to match once, the first time it finds them different,
  // so index-based writes (setRepeaterItemValue, Remove) stay correct
  // without separate index bookkeeping. Meaningless on a grouped
  // Repeater's outer level — offered unconditionally anyway, same as
  // every other field here.
  function createRepeaterSortControls(component) {
    return [
      createFieldRow(
        [
          createTextInput(component, "Sort by field", component.sortBinding || "", (value) => {
            const next = value.trim();
            updateComponent(component.uid, (draft) => {
              draft.sortBinding = next;
            }, { rerenderCanvas: true });
          }, { placeholder: "e.g. level" }),
          createRadioButtonGroup(
            component,
            "Direction",
            [
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ],
            component.sortDirection === "desc" ? "desc" : "asc",
            (value) => {
              updateComponent(component.uid, (draft) => {
                draft.sortDirection = value;
              }, { rerenderCanvas: true });
            },
            { forceSingleRow: true, hideLabel: true }
          ),
        ],
        { columns: 2 }
      ),
    ];
  }

  // A Repeater's own Add picker never sources from the Repeater component
  // itself — it's discovered generically from whichever cell(s) inside its
  // item template carry their own Source/Options (see hasConfiguredSource/
  // findPickableCell, workbench-character-view.js). What's offered here is
  // the handful of concerns that genuinely belong to the Repeater as a
  // whole rather than to any one cell.
  function createRepeaterSourceControls(component) {
    const controls = [
      // Off by default — the item's own binding directly holds the array.
      // Set when this Repeater's own top-level items are actually groups
      // keyed by some shared field on each pick (Spells, grouped by
      // @level) — a pick then routes into the matching group instead of
      // appending to the Repeater's array directly (see the grouped
      // branch of renderGenericAddControls).
      createTextInput(
        component,
        "Group by (optional)",
        component.groupByBinding || "",
        (value) => {
          const trimmed = value.trim();
          updateComponent(component.uid, (draft) => {
            if (trimmed) draft.groupByBinding = trimmed;
            else delete draft.groupByBinding;
          }, { rerenderCanvas: true, rerenderInspector: true });
        },
        { placeholder: "@level — groups items by this field instead of a flat list" }
      ),
      // Off by default — a Repeater's array normally holds full item
      // objects. On, it holds bare Library-kind ids instead, expanded for
      // display against the matching kind (see expandIdStorageItems);
      // picking one writes just the id, not a copy of its fields.
      createSwitchField("Store items as ids, not objects", component.itemStorage === "id", (checked) => {
        updateComponent(component.uid, (draft) => {
          if (checked) draft.itemStorage = "id";
          else delete draft.itemStorage;
        }, { rerenderCanvas: true });
      }),
    ];
    return controls;
  }

  // Vertical (default) stacks repeated items top-to-bottom; Horizontal
  // flows them left-to-right — a real pivot of the whole authoring model,
  // not just a CSS direction flip (see renderRepeaterComponent).
  function createRepeaterOrientationControl(component) {
    return createRadioButtonGroup(
      component,
      "Layout direction",
      [
        { value: "vertical", icon: "tabler:arrow-down", label: "Vertical" },
        { value: "horizontal", icon: "tabler:arrow-right", label: "Horizontal" },
      ],
      component.orientation === "horizontal" ? "horizontal" : "vertical",
      (value) => {
        updateComponent(component.uid, (draft) => {
          draft.orientation = value;
          ensureRepeaterZone(draft);
        }, { rerenderCanvas: true, rerenderInspector: true });
      }
    );
  }

  function renderRepeaterInspector(component) {
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : { type: "none" };
    const columns = clampInteger(component.columns || 1, 1, MAX_REPEATER_COLUMNS);
    const isHorizontal = component.orientation === "horizontal";
    const controls = [];
    controls.push(createRepeaterOrientationControl(component));
    controls.push(
      createNumberInput(component, isHorizontal ? "Rows" : "Columns", columns, (value) => {
        updateComponent(component.uid, (draft) => {
          draft.columns = value === null ? 1 : clampInteger(value, 1, MAX_REPEATER_COLUMNS);
          ensureRepeaterZone(draft);
        }, { rerenderCanvas: true, rerenderInspector: true });
      }, { min: 1, max: MAX_REPEATER_COLUMNS, step: 1 })
    );
    // "Column widths" sizes the N fixed field-columns of Vertical table
    // mode via a <colgroup> — Horizontal's repeating axis is the items
    // themselves (rendered as a CSS Grid, unknown count until render),
    // which this can't meaningfully describe, so it's hidden there.
    if (columns > 1 && !isHorizontal) {
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
    controls.push(createRepeaterHeaderToggle(component, { isHorizontal }));
    controls.push(createRepeaterAllowAddToggle(component));
    if (component.allowAdd) {
      controls.push(createRepeaterAllowCustomAddToggle(component));
    }
    controls.push(createRepeaterAllowRemoveToggle(component));
    controls.push(...createRepeaterSortControls(component));
    if (component.allowAdd) {
      controls.push(...createRepeaterSourceControls(component));
    }
    // Only meaningful for Vertical list mode — Table mode has its own real
    // <table> row borders, and Horizontal has no per-row divider concept.
    if (columns === 1 && !isHorizontal) {
      controls.push(createRepeaterItemDividerToggle(component));
    }
    // Only meaningful for Horizontal — Vertical already stacks items with
    // each component's own Margin. Same field as Container's "Grid gap".
    if (isHorizontal) {
      controls.push(createRepeaterFillToggle(component));
      controls.push(
        createNumberInput(component, "Grid gap (px)", component.gap ?? 16, (value) => {
          const next = clampInteger(value ?? 16, 0, 64);
          updateComponent(component.uid, (draft) => {
            draft.gap = next;
          }, { rerenderCanvas: true });
        }, { min: 0, max: 64, step: 4 })
      );
    }
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
      // Same literal/@binding/=formula field as Container's Label — a
      // decorator's custom text is always resolved per-row
      // (resolveRepeaterDecorator), never against the top-level draft, so
      // "=formula" here means "computed from this row's own fields."
      // Hand-rolled instead of createTextInput to make room for the live
      // feedback line below.
      const decoratorWrapper = document.createElement("div");
      decoratorWrapper.className = "form-floating";
      const decoratorId = toId([component.uid, "Decorator text", "input"]);
      const decoratorInput = document.createElement("input");
      decoratorInput.className = "form-control";
      decoratorInput.type = "text";
      decoratorInput.id = decoratorId;
      decoratorInput.placeholder = "→, @icon, or =formula";
      decoratorInput.value = decorator.formula ? `=${decorator.formula}` : decorator.text || "";
      const decoratorLabel = document.createElement("label");
      decoratorLabel.className = "fw-semibold";
      decoratorLabel.setAttribute("for", decoratorId);
      decoratorLabel.textContent = "Decorator text";
      const decoratorFeedback = createFieldPreviewFeedback();
      decoratorFeedback.update(decoratorInput.value);
      decoratorInput.addEventListener("input", () => {
        const trimmed = decoratorInput.value.trim();
        updateComponent(component.uid, (draft) => {
          if (trimmed.startsWith("=")) {
            draft.decorator = { type: "custom", text: "", formula: trimmed.slice(1).trim() };
          } else {
            draft.decorator = { type: "custom", text: decoratorInput.value, formula: "" };
          }
        }, { rerenderCanvas: true });
        decoratorFeedback.update(decoratorInput.value);
      });
      decoratorWrapper.append(decoratorInput, decoratorLabel, decoratorFeedback.element);
      controls.push(decoratorWrapper);
    }
    return controls;
  }

  // URL text input + the pattern/shape picker's "brush" trigger button
  // alongside it — needs a second control in the same row, so it's
  // hand-rolled rather than createBindingFormulaInput. Labeled "Binding /
  // Text", matching every other component's data-population field name —
  // a literal URL, "@path", or "=formula" (component.formula, same key
  // Icon/Text/Container use) resolved against the Character record at
  // render time (see renderImageContent). Shared by renderImageInspector
  // and Button's own Image field (createButtonInspectorControls) — one
  // picker/preview implementation, not a second copy. fieldKey ("url" for
  // Image, "image" for Button) decides which draft property gets written;
  // showPatternPicker/supportsFormula are both off for Button — a small
  // inline face image doesn't need the full pattern library, and
  // component.formula already means something else for other Input
  // variants (their own bound display value).
  function createImageUrlControl(component, { fieldKey = "url", showPatternPicker = true, supportsFormula = true, labelText = "Binding / Text" } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, labelText, "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = labelText;
    const row = document.createElement("div");
    row.className = "d-flex gap-1";
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.placeholder = supportsFormula ? "https://..., @portrait.url, or =formula" : "https://... or @portrait.url";
    input.value = supportsFormula && component.formula ? `=${component.formula}` : fieldKey === "url" ? resolveImageUrl(component) : component[fieldKey] || "";
    const feedback = createFieldPreviewFeedback();
    feedback.update(input.value);
    input.addEventListener("input", () => {
      const trimmed = input.value.trim();
      updateComponent(component.uid, (draft) => {
        if (supportsFormula && trimmed.startsWith("=")) {
          draft.formula = trimmed.slice(1).trim();
          draft[fieldKey] = "";
        } else {
          draft[fieldKey] = input.value;
          if (supportsFormula) draft.formula = "";
        }
      }, { rerenderCanvas: true });
      feedback.update(input.value);
    });
    row.append(input);
    if (showPatternPicker) {
      const patternButton = document.createElement("button");
      patternButton.type = "button";
      patternButton.className = "btn btn-outline-secondary";
      patternButton.setAttribute("data-bs-toggle", "tooltip");
      patternButton.setAttribute("data-bs-title", "Insert a pattern or shape");
      patternButton.setAttribute("aria-label", "Insert a pattern or shape");
      const icon = document.createElement("span");
      icon.className = "iconify";
      icon.dataset.icon = "tabler:brush";
      icon.setAttribute("aria-hidden", "true");
      patternButton.appendChild(icon);
      patternButton.addEventListener("click", () => openPatternPicker(component, input));
      row.append(patternButton);
    }
    wrapper.append(label, row, feedback.element);
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

  // Pattern/shape picker modal (Image component) — adapted from Press's
  // "write onto whatever the selected node is" model to Workbench's own
  // updateComponent(uid, ...) write path. The generator functions come
  // from the shared common/js/lib/pattern-library.js, so both tools'
  // pickers stay identical. State lives near the top of this file, not
  // here, since initPatternModal() runs early during init.

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

  // Mirrors the modal's own default (unselected) markup — used when the
  // picker opens on a field that isn't a pattern this picker generated, so
  // a stale selection from a previous component can't be mistaken for the
  // current one.
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
    // Re-detect on every open — the field can belong to a different
    // component than last time, so its current value drives this.
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
    // Switching category tabs only changes which thumbnails are shown —
    // the current selection stays exactly as it was until a new thumbnail
    // is actually clicked.
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
  // once a font is validated and confirmed, so the same modal serves both
  // a component's own Font field and the Template's own base font.
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

  // A shared library file, persisted with no in-app undo — a confirmation
  // is warranted since there's no Ctrl+Z to get it back.
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
    // Bootstrap's "modal finished appearing" event — focusing earlier can
    // get overridden by the modal's own entrance/backdrop focus handling.
    elements.addFontModal.addEventListener("shown.bs.modal", () => {
      elements.addFontValueInput?.focus();
    });
    if (elements.addFontValueInput) {
      // Validation happens once, here, on blur, not at submit time — the
      // Add button stays disabled until it succeeds, and any problem shows
      // as an inline warning instead of only a toast after clicking Add.
      elements.addFontValueInput.addEventListener("blur", handleAddFontValueBlur);
      elements.addFontValueInput.addEventListener("input", () => {
        // Typing again invalidates whatever was last checked.
        pendingValidatedFont = null;
        if (elements.addFontSubmitButton) elements.addFontSubmitButton.disabled = true;
        if (elements.addFontWarningElement) elements.addFontWarningElement.classList.add("d-none");
      });
    }
    if (elements.addFontSubmitButton) {
      elements.addFontSubmitButton.addEventListener("click", async () => {
        // Defense in depth — the autocomplete already blocks opening this
        // modal for ineligible users; real enforcement is server-side.
        if (!dataManager.meetsTier("creator")) {
          status.show("Creator tier or higher required to add fonts.", { type: "warning", timeout: 3000 });
          return;
        }
        if (!pendingValidatedFont || !addFontApplyCallback) return;
        const font = pendingValidatedFont;
        const applyCallback = addFontApplyCallback;
        // No-ops (returns the existing entry) if this id is already
        // registered — adding the same font twice resolves to one entry.
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

  // The Icon component's own field row: a live glyph-preview swatch + a
  // searchable text input (attachIconAutocomplete, same search Press's own
  // Icon field uses) — shared by renderIconInspector below and Button's
  // own Icon field, so an author gets the same picker/preview/validation
  // wherever an iconClass gets authored. supportsFormula:false (Button's
  // call) drops "=formula" — component.formula already means something
  // else for other Input variants (their own bound display value).
  function createIconFieldControl(component, { labelText = "Binding / Text", supportsFormula = true } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, labelText, "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = labelText;
    const row = document.createElement("div");
    row.className = "input-group";
    // Two nested spans, matching Press's own icon field markup: an outer
    // .input-group-text (Bootstrap's padding wrapper) containing an inner,
    // fixed-size .press-icon-preview that holds the glyph. Combining both
    // classes onto one element breaks the swatch's sizing — the wrapper's
    // padding and the swatch's fixed box fight each other.
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
    input.placeholder = supportsFormula ? "ddb-fire, bi-star, @some.path, or =formula" : "ddb-fire, bi-star, or @some.path";
    input.value = supportsFormula && component.formula ? `=${component.formula}` : component.iconClass || "";
    const feedback = createFieldPreviewFeedback();

    const refreshPreview = () => {
      previewSpan.innerHTML = "";
      const trimmed = input.value.trim();
      // Same resolution renderIconPreview's canvas swatch uses, so this
      // preview and the canvas agree on what a bound/computed icon looks
      // like.
      let resolved = input.value;
      if (supportsFormula && trimmed.startsWith("=")) {
        resolved = evaluatePreviewFormula(trimmed.slice(1).trim());
      } else if (trimmed.startsWith("@")) {
        resolved = resolvePreviewBindingValue(trimmed);
      }
      const classes = resolveIconClassList(resolved);
      if (classes.length) {
        const icon = document.createElement("span");
        icon.className = classes.join(" ");
        previewSpan.appendChild(icon);
      }
      // The swatch above can't distinguish a bad formula from one that
      // just hasn't resolved against this system's sample data yet — this
      // line can.
      feedback.update(input.value);
    };
    refreshPreview();

    const commit = (value) => {
      const trimmed = value.trim();
      updateComponent(component.uid, (draft) => {
        if (supportsFormula && trimmed.startsWith("=")) {
          draft.formula = trimmed.slice(1).trim();
          draft.iconClass = "";
        } else {
          draft.iconClass = value;
          if (supportsFormula) draft.formula = "";
        }
      }, { rerenderCanvas: true });
      refreshPreview();
    };
    input.addEventListener("input", () => commit(input.value));
    // Must run after the input has a parent — attachIconAutocomplete
    // checks input.parentElement to find where to attach the dropdown, and
    // silently no-ops if it's still detached.
    row.append(previewWrap, input);
    wrapper.append(label, row, feedback.element);
    attachIconAutocomplete(input, {
      onSelect: (value) => {
        input.value = value;
        commit(value);
      },
    });
    return wrapper;
  }

  // "Binding / Text" — not "Icon" — matching every other component's
  // data-population field name; typing "@some.path" is how a bound icon is
  // authored. "=formula" is a third mode on the same field, for a computed
  // icon class (e.g. ="ddb-"+@type) a single bound @path can't express.
  function renderIconInspector(component) {
    const controls = [createIconFieldControl(component)];
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
      createSourceOptionsInput(component),
      createBindingFormulaInput(component, {
        labelText: "Binding / Text",
        placeholder: "Static text, @path, or =formula",
        textKey: "text",
        supportsBinding: true,
        supportsFormula: true,
      }),
      createCandidateBindingInput(component),
    ];
  }

  // "Label" — Identity-section position, same as every other type's
  // generic Label field, just not binding-blind: accepts a literal
  // heading, an "@path", or an "=formula" in one field. Called directly
  // from generalControls' own Identity-section ternary, not plucked out —
  // Container has no real `binding` field of its own.
  function createContainerLabelControl(component) {
    const id = toId([component.uid, "Container", "label-input"]);
    const field = createFormFloatingField({
      type: "text",
      id,
      label: "Label",
      placeholder: "Displayed label, @path, or =formula",
    });
    const input = field.querySelector("input");
    input.value = component.formula ? `=${component.formula}` : component.label || "";
    const feedback = createFieldPreviewFeedback();
    feedback.update(input.value);
    input.addEventListener("input", () => {
      const trimmed = input.value.trim();
      updateComponent(component.uid, (draft) => {
        if (trimmed.startsWith("=")) {
          draft.formula = trimmed.slice(1).trim();
          draft.label = "";
        } else {
          draft.label = trimmed;
          draft.formula = "";
        }
      }, { rerenderCanvas: true });
      feedback.update(input.value);
    });
    field.appendChild(feedback.element);
    return field;
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
        },
        { hideLabel: true }
      )
    );
    if (component.containerType === "tabs") {
      // Source-driven tabs — an addition to the static list below, not a
      // replacement: when set, one tab is generated per resolved Source
      // entry instead of the literal tabLabels list. Same shared control
      // every other Source field uses, labeled "Source" since this one
      // drives which/how-many tabs exist.
      controls.push(
        createBindingFormulaInput(component, {
          labelText: "Source",
          placeholder: "@playbooks",
          bindingKey: "tabLabelsSourceBinding",
          formulaKey: null,
          supportsFormula: false,
          allowedFieldCategories: ["object", "array"],
          afterCommit: ({ draft, result }) => {
            if (!result || result.type === "empty") {
              draft.tabLabelsSourceBinding = "";
            }
            ensureContainerZones(draft);
          },
        })
      );
      controls.push(
        createTextarea(component, "Tab labels (one per line)", (component.tabLabels || []).join("\n"), (value) => {
          updateComponent(component.uid, (draft) => {
            draft.tabLabels = parseLines(value);
            ensureContainerZones(draft);
          }, { rerenderCanvas: true });
        }, { rows: 3, placeholder: "Details\nInventory" })
      );
      // Play-view-only lock (Source-driven tabs only — see
      // resolveLockedTabIndex): when set to the character's own selection
      // field, Play view shows only the one tab matching that value, no
      // nav bar — Edit view is unaffected, every tab stays switchable
      // there. Blank leaves every tab always switchable in both modes.
      controls.push(
        createTextInput(component, "Locked tab (Play)", component.activeTabBinding || "", (value) => {
          const next = value.trim();
          updateComponent(component.uid, (draft) => {
            if (next) draft.activeTabBinding = next;
            else delete draft.activeTabBinding;
          }, { rerenderCanvas: true });
        }, { placeholder: "@class" })
      );
    } else {
      controls.push(
        createFieldRow(
          [
            createNumberInput(component, "Columns", component.columns || 2, (value) => {
              const next = clampInteger(value ?? 2, 1, MAX_CONTAINER_COLUMNS);
              updateComponent(component.uid, (draft) => {
                draft.columns = next;
                ensureContainerZones(draft);
              }, { rerenderCanvas: true, rerenderInspector: true });
            }, { min: 1, max: MAX_CONTAINER_COLUMNS }),
            createNumberInput(component, "Rows", component.rows || 1, (value) => {
              const next = clampInteger(value ?? 1, 1, MAX_CONTAINER_ROWS);
              updateComponent(component.uid, (draft) => {
                draft.rows = next;
                ensureContainerZones(draft);
              }, { rerenderCanvas: true, rerenderInspector: true });
            }, { min: 1, max: MAX_CONTAINER_ROWS }),
          ],
          { columns: 2 }
        )
      );
      controls.push(
        createFieldRow(
          [
            createTextInput(component, "Column template", component.templateColumns || "", (value) => {
              const next = value.trim();
              updateComponent(component.uid, (draft) => {
                if (next) draft.templateColumns = next;
                else delete draft.templateColumns;
              }, { rerenderCanvas: true });
            }, { placeholder: "1fr 2fr" }),
            createTextInput(component, "Row template", component.templateRows || "", (value) => {
              const next = value.trim();
              updateComponent(component.uid, (draft) => {
                if (next) draft.templateRows = next;
                else delete draft.templateRows;
              }, { rerenderCanvas: true });
            }, { placeholder: "auto auto" }),
          ],
          { columns: 2 }
        )
      );
    }
    controls.push(
      createNumberInput(component, "Grid gap (px)", component.gap ?? 16, (value) => {
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
        },
        { hideLabel: true }
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

  // Shape is labeled "Type" (no visible heading) on purpose — same UX role
  // Input's and Select Group's own variant selectors fill, both also
  // labeled "Type". Naming it that way is what makes pluckControlByLabel
  // front-load it below the Type Summary card for free.
  function renderToggleInspector(component) {
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Type",
        [
          { value: "circle", icon: "tabler:circle", label: "Circle" },
          { value: "square", icon: "tabler:square", label: "Square" },
          { value: "diamond", icon: "tabler:diamond", label: "Diamond" },
          { value: "star", icon: "tabler:star", label: "Star" },
          { value: "diamond-quarters", icon: "tabler:layout-grid", label: "Quartered" },
        ],
        component.shape || "circle",
        (value) => {
          // rerenderInspector too — the Border section's Corner radius
          // field is only shown for shape "square", so switching shape has
          // to redraw the inspector, not just the canvas.
          updateComponent(component.uid, (draft) => {
            draft.shape = value;
          }, { rerenderCanvas: true, rerenderInspector: true });
        },
        { forceSingleRow: true, hideLabel: true }
      )
    );
    // Optional — blank keeps the shape stretching to fill its container's
    // width, which can distort a circle into an oval in a narrow repeater
    // column. Set as an inline style on the glyph itself, outranking that
    // stretch rule without CSS specificity work.
    controls.push(
      createFieldRow(
        [
          createTextInput(component, "Width", component.width || "", (value) => {
            const next = value.trim();
            updateComponent(component.uid, (draft) => {
              draft.width = next;
            }, { rerenderCanvas: true });
          }, { placeholder: "Fills available width" }),
          createTextInput(component, "Height", component.height || "", (value) => {
            const next = value.trim();
            updateComponent(component.uid, (draft) => {
              draft.height = next;
            }, { rerenderCanvas: true });
          }, { placeholder: "2.5rem" }),
        ],
        { columns: 2 }
      )
    );
    controls.push(createToggleStateStylesEditor(component));
    return controls;
  }

  // One row per currently-resolved state (Source binding, falling back to
  // the literal `states` list — resolveTogglePreviewStates' own fallback),
  // each with a fill percentage and a Ring checkbox writing into
  // component.stateStyles[stateValue]. This is component/template data on
  // purpose, not anything read off the Source/System — see
  // feedback_visual_data_never_on_system memory: the same semantic states
  // (e.g. "Half"/"Half Round Up"/"Proficiency"/"Expertise") need to render
  // differently per template and even per System, so the mapping can't live
  // upstream of the component that's actually doing the drawing. A state
  // with no configured entry shows its position-based fallback value
  // pre-filled (not blank) — matches resolveToggleStateStyle's own
  // fallback in component-renderers.js, so what's shown here always equals
  // what actually renders before the author touches anything.
  function createToggleStateStylesEditor(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = "State visuals";
    wrapper.appendChild(heading);

    const states = resolveTogglePreviewStates(component);
    if (!states.length) {
      wrapper.appendChild(
        createPreviewEmptyState("Select a source (or add literal states) to configure how each state looks.")
      );
      return wrapper;
    }

    const stateStyles =
      component.stateStyles && typeof component.stateStyles === "object" ? component.stateStyles : {};
    const maxIndex = Math.max(states.length - 1, 1);

    states.forEach((entry, index) => {
      const key = String(entry.value);
      const displayLabel = entry.label || key;
      const configured = stateStyles[key] || {};
      const positionFallback = states.length <= 1 ? 1 : index / maxIndex;
      const currentFill = typeof configured.fillLevel === "number" ? configured.fillLevel : positionFallback;

      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2";

      const label = document.createElement("span");
      label.className = "small text-body-secondary flex-grow-1 text-truncate";
      label.textContent = displayLabel;
      label.setAttribute("data-bs-toggle", "tooltip");
      label.setAttribute("data-bs-title", displayLabel);

      const fillInput = document.createElement("input");
      fillInput.type = "number";
      fillInput.className = "form-control form-control-sm";
      fillInput.style.width = "5rem";
      fillInput.min = "0";
      fillInput.max = "100";
      fillInput.step = "5";
      fillInput.value = String(Math.round(currentFill * 100));
      fillInput.setAttribute("aria-label", `${displayLabel} fill percent`);
      fillInput.addEventListener("change", () => {
        const parsed = Number(fillInput.value);
        const clamped = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) / 100 : positionFallback;
        fillInput.value = String(Math.round(clamped * 100));
        updateComponent(component.uid, (draft) => {
          const nextStyles = {
            ...(draft.stateStyles && typeof draft.stateStyles === "object" ? draft.stateStyles : {}),
          };
          nextStyles[key] = { ...(nextStyles[key] || {}), fillLevel: clamped };
          draft.stateStyles = nextStyles;
        }, { rerenderCanvas: true });
      });

      const ringId = toId([component.uid, "toggleRing", key, index]);
      const ringWrap = document.createElement("div");
      ringWrap.className = "form-check form-check-sm mb-0";
      const ringInput = document.createElement("input");
      ringInput.type = "checkbox";
      ringInput.className = "form-check-input";
      ringInput.id = ringId;
      ringInput.checked = Boolean(configured.ring);
      ringInput.addEventListener("change", () => {
        updateComponent(component.uid, (draft) => {
          const nextStyles = {
            ...(draft.stateStyles && typeof draft.stateStyles === "object" ? draft.stateStyles : {}),
          };
          nextStyles[key] = { ...(nextStyles[key] || {}), ring: ringInput.checked };
          draft.stateStyles = nextStyles;
        }, { rerenderCanvas: true });
      });
      const ringLabel = document.createElement("label");
      ringLabel.className = "form-check-label small text-body-secondary";
      ringLabel.setAttribute("for", ringId);
      ringLabel.textContent = "Ring";
      ringWrap.append(ringInput, ringLabel);

      row.append(label, fillInput, ringWrap);
      wrapper.appendChild(row);
    });

    return wrapper;
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
    // into one "track" type with a Shape selector — rewritten here so an
    // old saved template's track components still load with the correct
    // shape pre-selected instead of falling back to a blank Input.
    if (component.type === "linear-track" || component.type === "circular-track") {
      if (!component.trackShape) {
        component.trackShape = component.type === "circular-track" ? "circular" : "linear";
      }
      component.type = "track";
    }
    // Legacy "label" type string from before it was renamed to "text".
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
      // Background no longer gets a backfilled grey default here — once
      // Background got real unset/X-overlay support, "no background" (show
      // through to whatever's behind the shape) became a legitimate choice
      // this hydration step shouldn't silently overwrite. Border keeps its
      // own backfill: Toggle's border is meant to always be on by default,
      // the one type where that's true.
      if (!merged.borderStyle || merged.borderStyle === "none") {
        merged.borderStyle = "solid";
      }
      if (!merged.borderColor) {
        merged.borderColor = "#343a40";
      }
      if (merged.borderWidth === null || merged.borderWidth === undefined) {
        merged.borderWidth = 1;
      }
      // foregroundColor (the shape's own fill) used to just be textColor —
      // anything saved before the Text/Foreground split has no
      // foregroundColor at all, so inherit whatever textColor is now
      // rather than silently changing how an old template renders.
      if (!merged.foregroundColor) {
        merged.foregroundColor = merged.textColor || "#ffffff";
      }
      if (typeof merged.foregroundColorBinding !== "string") {
        merged.foregroundColorBinding = "";
      }
      if (typeof merged.foregroundColorFormula !== "string") {
        merged.foregroundColorFormula = "";
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
    // borderStyle is the border on/off switch, not borderColor — a
    // component with no style has no border, full stop, and everything
    // downstream (color/width/sides, but not radius, which independently
    // shapes the card's own rounding) is stale leftover data whenever
    // style says there's nothing here. Strips it back to empty on every
    // load so old saved templates (once seeded with borderStyle:"solid"
    // regardless of borderColor) get cleaned up too, not just new ones.
    if (!merged.borderStyle || merged.borderStyle === "none") {
      merged.borderStyle = "";
      merged.borderColor = "";
      merged.borderWidth = null;
      merged.borderSides = null;
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
    baseFontFamily = "",
    defaults = null,
    backgroundColor = "",
    backgroundColorBinding = "",
    backgroundColorFormula = "",
    borderStyle = "",
    borderColor = "",
    borderColorBinding = "",
    borderColorFormula = "",
    borderWidth = null,
    borderSides = null,
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
      baseFontFamily: baseFontFamily || "",
      // A brand-new template and an already-saved one predating this field
      // both land here — normalizeTemplateDefaults always returns a real
      // fontColor either way.
      defaults: normalizeTemplateDefaults(defaults),
      // The sheet's own literal, visible background/border — blank by
      // default (a real "no background"/"no border" choice), not a
      // per-component fallback. Same Binding/Formula-capable shape a
      // component's own Colors section uses.
      backgroundColor: backgroundColor || "",
      backgroundColorBinding: backgroundColorBinding || "",
      backgroundColorFormula: backgroundColorFormula || "",
      borderStyle: borderStyle || "",
      borderColor: borderColor || "",
      borderColorBinding: borderColorBinding || "",
      borderColorFormula: borderColorFormula || "",
      borderWidth: borderWidth === null || borderWidth === undefined ? null : borderWidth,
      borderSides: borderSides && typeof borderSides === "object" ? { ...borderSides } : null,
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
    // Read by workbench.js's renderEmptyState — the inline empty-state
    // message shows only while Mode=Template and no template is active.
    hasActiveTemplate,
    // Called by workbench.js's setMode when switching from Character to
    // Template mode with a character loaded, to auto-load that character's
    // own template — same function the <select>'s change handler calls.
    selectTemplateById,
  };
}
