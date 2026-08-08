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
import { refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { bindCollapsibleToggle } from "../../../common/js/lib/collapsible.js";
import { createJsonDataPanel, createToolbarButtonGroup, createIconButton, createCompactField } from "../../../common/js/lib/ui-components.js";
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
import { createLookupFn } from "../../../common/js/lib/bindings.js";
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

  // Same three checks handleDrop and the palette's own onActivate already
  // ran independently before either would insert a component — Paste is a
  // third insertion path, so this is the single source of truth for the
  // gate + its messaging rather than a fourth hand-copied block.
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
  // The last Copy/Cut'd component (component-shaped object, its own uid
  // stale/irrelevant — regenerateComponentUids assigns fresh ones at Paste
  // time, same as every other insertion path). Deliberately module-level
  // like containerActiveTabs/componentCollapsedState above, not part of
  // `state` — it's editor session scratch space, never serialized/undone.
  let componentClipboard = null;
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

  // Same cmp-N counter createComponent/hydrateComponent already use for
  // every new-to-this-session component — a pasted copy needs a uid this
  // session has never handed out before (never the source's own uid,
  // stale from a Copy or already freed by a Cut) since uid is the key
  // every selection/collapse/active-tab Map in this file is keyed by;
  // reusing one would silently alias the paste to an unrelated component.
  // Recurses into zones (Container/Repeater) so a pasted subtree's every
  // descendant gets its own fresh uid too, not just the root.
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

  // Built and mounted before Object.assign(elements, {...}) below queries
  // these buttons by their data-action/data-delete-template attribute, so
  // every existing selector/disabled-state call site elsewhere in this file
  // keeps working unchanged. Unlike the shell-level toolbar in workbench.js,
  // this cluster maps cleanly onto createToolbarButtonGroup's own
  // New/Save/Duplicate/Delete presets with no icon/variant overrides needed.
  createToolbarButtonGroup([
    { action: "new", label: "New Template", attrs: { "data-action": "new-template" } },
    {
      action: "save",
      label: "Save",
      visible: false,
      attrs: { "data-action": "save-template", "data-workbench-view-panel": "template" },
    },
    {
      action: "duplicate",
      label: "Duplicate Template",
      visible: false,
      attrs: { "data-action": "duplicate-template", "data-duplicate-template": true },
    },
    { action: "delete", label: "Delete Template", visible: false, attrs: { "data-delete-template": true } },
  ]).forEach((button) => document.querySelector("[data-template-toolbar-mount]")?.appendChild(button));

  // replaceWith, not appendChild — see press/js/app.js's mountInspectorField
  // for why: an appended-into wrapper stays an empty-but-in-flow flex item
  // even while its field is conditionally hidden, silently spending a full
  // gap-3 on both sides of it. Any class the static mount div itself carried
  // is merged onto the built field first so removing the wrapper doesn't
  // lose that layout.
  function mountField(key, element) {
    const mount = document.querySelector(`[data-field-mount="${key}"]`);
    if (!mount) return;
    if (mount.className) element.classList.add(...mount.classList);
    mount.replaceWith(element);
  }
  mountField(
    "template-select",
    createCompactField({ type: "select", id: "template-select", label: "Active template", labelClass: "form-label fw-semibold text-body-secondary", controlClass: "form-select", dataAttr: "data-template-select" })
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
    templateProperties: document.querySelector("[data-template-properties]"),
    selectionsPanel: document.querySelector("[data-selections-panel]"),
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

  // Builds and mounts just the collapsible-toggle chevron button via the
  // shared factory — these three sections' headers each keep other
  // hand-authored content (a toolbar, a card layout) that a full
  // createCollapsibleSection would clobber if it rebuilt the whole header,
  // so only the toggle button itself is JS-built (same shape as Orrery's
  // own createCollapsibleToggleButton helper).
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

  // Same shared collapse mechanism as every other tool (Forge/Loom/Press/
  // Sanctum/Orrery). Template Properties and Component Properties also need
  // programmatic control (renderInspector swaps which one is expanded based
  // on selection — see expandTemplatePropertiesSection/
  // collapseComponentPropertiesSection below), so their
  // bindCollapsibleToggle() return value is kept.
  const applyTemplatePropertiesCollapse = bindCollapsibleToggle(
    createSectionToggleButton("[data-template-properties-toggle-mount]", false),
    elements.templatePropertiesPanel,
    { collapsed: false }
  );
  const applyComponentPropertiesCollapse = bindCollapsibleToggle(
    createSectionToggleButton("[data-component-properties-toggle-mount]", true),
    elements.componentPropertiesPanel,
    { collapsed: true }
  );
  bindCollapsibleToggle(
    createSectionToggleButton("[data-selections-toggle-mount]", false),
    elements.selectionsPanel,
    { collapsed: false }
  );

  const templateJsonPanel = createJsonDataPanel({
    label: "JSON Data",
    getData: () => serializeTemplateState(),
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
      // Matches the palette's own text (workbench/index.html) exactly —
      // one canonical description per type, not two independently-written
      // strings that drift apart (see createTypeSummaryHeader's own note).
      description: "Text, number, select, radio, checkbox",
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
      colorControls: ["text", "background", "border"],
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
      description: "Inventory and item lists",
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
        // Vertical (default, unchanged from before this existed) stacks
        // repeated items top-to-bottom, with `columns` meaning "how many
        // distinct field templates does each row have" (table mode).
        // Horizontal flows items left-to-right instead — the whole model
        // is transposed: `columns` means "how many distinct field
        // templates does each ITEM's own column have" (stacked within
        // it), and the header becomes a header COLUMN instead of a header
        // ROW. Same zone keys/storage either way (item-{n}/header-{n}) —
        // see ensureRepeaterZone and renderRepeaterComponent
        // (workbench-character-view.js) for what actually changes.
        orientation: "vertical",
        // Spacing BETWEEN repeated items in Horizontal orientation (the
        // rows===1 flex row and rows>1 CSS grid — see renderRepeaterInspector
        // and renderRepeaterHorizontalList/Grid in workbench-character-
        // view.js), same "Grid gap" concept and field as Container's own —
        // was previously a fixed, non-configurable CSS/utility-class value.
        gap: 16,
        // Horizontal-only — see createRepeaterFillToggle's own comment.
        fill: false,
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
      description: "Portraits, logos, or patterns",
      defaults: {
        name: "Image",
        url: "https://placekitten.com/320/180",
        // Same generic key Icon/Text/Container use for their own single
        // "literal, @binding, or =formula" field — see createImageUrlControl
        // and renderImageContent's own comment. Takes priority over `url`
        // when set (="ddb-"+@type, an expression a bare @path can't
        // express), same precedence as those.
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
    // Full port of Press's own Icon component — same ddb-icons.css/
    // Bootstrap Icons search (common/js/lib/icon-picker.js) and the same
    // "iconClass is itself a binding-or-literal string" convention (no
    // separate generic Binding field the way Input/Track/etc. have; typing
    // "@some.path" directly into the Icon field is how a bound icon is
    // authored, exactly like Press).
    icon: {
      label: "Icon",
      description: "A single icon glyph",
      defaults: {
        name: "Icon",
        iconClass: "",
        // Was implicit (undefined, not an invisible-default problem since
        // every read site already treats non-string as "no formula" —
        // just not explicitly seeded like Image/Container's own copy of
        // this same field). Seeded now for consistency with those.
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
      description: "Static text or headings",
      defaults: {
        name: "Text",
        text: "Text",
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
        // Same generic key Icon/Image/Text use for their own single
        // "literal, @binding, or =formula" field — see
        // createContainerLabelControl. Takes priority over `label` when
        // set, same precedence as those.
        formula: "",
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
        // Play-view-only tab lock (Source-driven tabs only) — see
        // resolveLockedTabIndex, workbench-character-view.js. Blank means
        // "no lock, every tab always switchable," same as every Container
        // that existed before this field did.
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
        // Linear vs. Circular is now a variant of one component (see the
        // "Shape" selector in renderTrackInspector) rather than two
        // separate, byte-for-byte-identical-except-label types.
        trackShape: "linear",
        segments: 6,
        segmentBinding: "6",
        segmentFormula: "",
        value: 3,
        labelPosition: "top",
        // The active/filled segment color (linear segments, the circular
        // gauge's own conic-gradient) — previously hardcoded to
        // var(--bs-primary) in both CSS and JS, ignoring this component's
        // own data entirely despite Colors already showing a picker for
        // it. Same Text/Foreground split Toggle already has: Text colors
        // the label only, Foreground is the shape's own fill. Matches
        // Bootstrap's own default --bs-primary exactly (this project has
        // no theme override), so existing/new Tracks look unchanged until
        // an author actually customizes it.
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
        // buttons'/pills' active state) — previously hardcoded CSS
        // (.template-select-tag/.is-active, var(--bs-tertiary-color)/
        // var(--bs-body-color)) and Bootstrap's own .btn-outline-secondary
        // for buttons/pills, ignoring this component's data entirely. Same
        // Text/Foreground split as Track above.
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
        // textColor blank, same as every other type now — inherits the
        // template's own Font Default when unset (see createComponent's
        // own textColor comment). Colors the field's own label ONLY —
        // foregroundColor below is the separate concept that drives the
        // shape's own fill (see renderToggleContent, component-renderers.js);
        // they used to be the same field, which is exactly the "Foreground
        // controls text AND fill" confusion this split exists to remove.
        //
        // foregroundColor/backgroundColor below ARE still real, explicit
        // hex — not left blank for CSS to invent a Bootstrap-theme color
        // behind the scenes (see feedback_inspector_reads_json_only / this
        // session's whole "no invisible defaults" standard, and shell.css's
        // own comment on .template-toggle-shape). Unlike textColor, these
        // have no template-wide default to fall back to (Template
        // Properties only defines a Font default, deliberately — see
        // createBlankTemplate's own comment on why Background/Border are a
        // separate literal-sheet-appearance concept instead), so a Toggle
        // with both left blank would have no visible fill/backdrop at all.
        // backgroundColor is dark specifically so a white foregroundColor
        // fill is actually visible against it — not an arbitrary pick.
        textColor: "",
        foregroundColor: "#ffffff",
        foregroundColorBinding: "",
        foregroundColorFormula: "",
        backgroundColor: "#495057",
        // Unlike most types (border off by default, turned on by picking a
        // style or color), Toggle's own outline is meant to always be on
        // — the shape is the whole point of this component, so a
        // borderless one is the unusual case, not the default.
        borderStyle: "solid",
        borderColor: "#343a40",
        borderWidth: 1,
        // Per-state visual mapping (fillLevel/ring), keyed by each state's
        // own string value — component/template data, deliberately NOT
        // anything read off the Source/System (see
        // feedback_visual_data_never_on_system memory). Empty by default;
        // an unconfigured state falls back to position-based fill — see
        // resolveToggleStateStyle in component-renderers.js.
        stateStyles: {},
        // Blank by default — the glyph stretches to fill its container's
        // width (see .component-field--label-top's own stretch rule),
        // matching the behavior that already existed before these fields
        // did. Set explicitly to override — see renderToggleContent.
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

  // `default` matches Press's own COLOR_DEFAULTS exactly (Bootstrap's own
  // body-color/body-bg/border-color) — a placeholder swatch color shown
  // only while the field is unset (covered by the X overlay regardless),
  // never written to the component itself.
  // "text" (not "foreground") — the label was renamed from Foreground to
  // Text to match the underlying field name (textColor) and, more
  // importantly, to stop it being confused with the actual Foreground
  // concept below: a component's real fill/accent color, distinct from
  // whatever colors its own literal text (most types don't have anything
  // that would use Foreground at all — it's only declared in colorControls
  // for the types that genuinely need a fill separate from their text,
  // Toggle being the first).
  // The template-wide fallback for any component's own Text when that
  // component's field is blank — always a real value, never clearable (see
  // normalizeTemplateDefaults). Text only: there's always a text color to
  // fall back to, but "no background"/"no border" are themselves
  // legitimate, meaningful per-component choices (color-picker.js's own
  // --unset support), so a cleared Background/Border must actually mean
  // "none," not silently inherit whatever the template's own sheet-wide
  // Background/Border happen to be. The template's own Background/Border
  // (state.template.backgroundColor/borderStyle/etc.) are a separate,
  // literal concept — the sheet's own visible appearance, applied once to
  // the canvas root, never resolved per-component.
  // White, not Bootstrap's own light-mode default (#212529) — matches the
  // dark-card aesthetic every component's own seeded defaults already
  // assume elsewhere in this app (e.g. Toggle's own textColor: "#ffffff").
  const DEFAULT_TEMPLATE_COLORS = { fontColor: "#ffffff" };

  function normalizeTemplateDefaults(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      fontColor: typeof source.fontColor === "string" && source.fontColor.trim() ? source.fontColor.trim() : DEFAULT_TEMPLATE_COLORS.fontColor,
    };
  }

  const COLOR_FIELD_MAP = {
    text: { label: "Text", prop: "textColor", bindingProp: "textColorBinding", formulaProp: "textColorFormula", default: "#212529" },
    foreground: { label: "Foreground", prop: "foregroundColor", bindingProp: "foregroundColorBinding", formulaProp: "foregroundColorFormula", default: "#ffffff" },
    background: { label: "Background", prop: "backgroundColor", bindingProp: "backgroundColorBinding", formulaProp: "backgroundColorFormula", default: "#ffffff" },
    border: { label: "Border", prop: "borderColor", bindingProp: "borderColorBinding", formulaProp: "borderColorFormula", default: "#dee2e6" },
  };

  // Reads the actual JSON property and nothing else — no getComputedStyle,
  // no inferring from what's currently rendered in the canvas. A prior
  // version of this resolved the "real" rendered color off the live canvas
  // node, which sounded right in the abstract but broke in practice: the
  // canvas applies its OWN selection-outline border (.template-component-
  // selected — border: 1px solid var(--bs-primary) !important) to the same
  // element a component's own borderColor is applied to, so a selected,
  // border-less component's computed border color was the editor's blue
  // selection ring, not the component's own (nonexistent) border. The only
  // trustworthy source is the data itself: set means set, empty means
  // unset, full stop.
  // Every key a color-field commit (manual pick, binding/formula, or
  // Clear) can touch — the three colors themselves, their Binding/Formula
  // pairs, and the border side-effect fields a first color pick or Clear
  // can also flip (see createColorRow's own comments on both). Undo/redo
  // for a color change is a snapshot-and-restore of exactly these keys on
  // the one component involved, not a whole-tree clone (unlike add/remove/
  // clear's own undo entries) — nothing here ever touches children, so
  // there's no tree structure to preserve.
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

  // Wraps updateComponent for the three color-field handlers only — same
  // options/rerender contract, plus a before/after snapshot of the color
  // keys pushed as a single undo entry (case "componentColor" below), the
  // same "one entry per real commit" granularity Press's own
  // recordUndoableChange already gives every one of its fields. Skips
  // pushing anything when the snapshot didn't actually change (e.g. Accept
  // clicked with nothing touched), matching color-picker.js's own `dirty`
  // guard against no-op commits.
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

  // "None" first — the natural default for a component with no border
  // color chosen yet (see createBorderControls' own default-style logic);
  // the rest match Press's own border-style option list exactly
  // (press/index.html).
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

  // Palette markup hardcodes each item's icon in workbench/index.html —
  // synced here from the shared COMPONENT_ICONS registry (now itself
  // re-exported from common/js/lib/component-icons.js, shared with Press)
  // at init time, so there's one source of truth instead of a second,
  // hand-maintained copy that can silently drift from the canvas card's
  // own icon.
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

  // Delete/Copy/Cut/Paste all act on the current canvas selection — no
  // dedicated buttons (per-card icons for these ate too much room on
  // small components; standard OS-level shortcuts don't). Guarded on
  // isEditableTarget the same way Delete already was, so typing/copying
  // text in a focused field (an inspector text input, a contenteditable)
  // is never hijacked — the browser's own native behavior wins there.
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
  // Deliberately here, not at the top of this function — computeTemplateSignature()
  // (via serializeTemplateState -> normalizeTemplateDefaults) reads
  // DEFAULT_TEMPLATE_COLORS, a `const` declared later in this same function
  // body. Calling this before that declaration's own line has actually run
  // hits the temporal-dead-zone and throws, which computeTemplateSignature's
  // try/catch swallows into a silent `null` — a `null` baseline that then
  // never gets corrected unless a real template loads, so a later, real
  // signature (once everything IS initialized) always reads as "changed"
  // against it. Confirmed exactly this behavior via added debug logging:
  // the very first bare-page beforeunload always fired, without the user
  // touching anything. By this point in init every module-level `const`
  // this call chain depends on has already executed.
  markTemplateClean();
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
    // The sheet's own literal background/border (Template Properties) —
    // reuses applyComponentStyles directly (component-styles.js) rather
    // than a second hand-written border/background application: the
    // canvas root just needs the exact same "reflect whatever's actually
    // stored, per side" treatment every component's own wrapper already
    // gets, fed a component-shaped object standing in for the template.
    // textColor deliberately blank — Font stays a per-component fallback
    // only (see TEMPLATE_DEFAULT_COLOR_MAP), never a literal root color.
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
      // Neither of these was ever actually saved before — Base font
      // affected the live canvas (elements.canvasRoot.style.fontFamily)
      // while editing but silently reset on every reload, and Play/Edit
      // never received it at all. Found while wiring up the same "template-
      // wide fallback" mechanism for colors — fixed alongside it since it's
      // the same gap.
      baseFontFamily: state.template?.baseFontFamily || "",
      defaults: normalizeTemplateDefaults(state.template?.defaults),
      // The sheet's own literal background/border — see createBlankTemplate's
      // own comment on why this is separate from `defaults` above.
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
      // Blank, same as background/border/foreground — a new component
      // inherits the template's own Font Default (state.template.defaults.
      // fontColor) until textColor is explicitly set, via
      // resolveComponentColors/resolveComponentColorsForPreview's
      // TEMPLATE_DEFAULT_COLOR_KEYS/MAP fallback. Used to be a hardcoded
      // "#ffffff" here (and force-filled onto already-saved components in
      // hydrateComponent) — that pinned every component to white
      // regardless of the template's own default, and made Clear on the
      // Text swatch a no-op (see createColorRow's own onClear).
      textColor: "",
      // Same plain-value-plus-binding/formula shape as visible/
      // visibilityBinding/visibilityFormula (createFormulaToggleField) —
      // a color's own binding/formula pair overrides the literal hex above
      // when non-empty, resolved via common/js/lib/color-picker.js's
      // createColorPickerField in the inspector and (for real, at render
      // time) resolveEffectiveComponentColors/resolveComponentColors in
      // workbench-template-view.js/workbench-character-view.js.
      textColorBinding: "",
      textColorFormula: "",
      backgroundColor: "",
      backgroundColorBinding: "",
      backgroundColorFormula: "",
      // borderStyle is the border on/off switch — everything below it
      // (color/width/radius/sides) is downstream and only means anything
      // once borderStyle is a real value, not "none"/empty. Border color
      // is NOT the determinant (a prior version of this comment/logic had
      // that backwards); see createBorderControls' Style select change
      // handler for where color/width get written for real the moment a
      // style is actually chosen, and hydrateComponent for the matching
      // cleanup on load.
      borderStyle: "",
      borderColor: "",
      borderColorBinding: "",
      borderColorFormula: "",
      borderWidth: null,
      borderRadius: 0,
      borderSides: null,
      // Raw CSS shorthand strings (e.g. "8px" or "4px 8px 12px 16px"),
      // passed straight through to the real padding/margin CSS properties
      // — no Workbench-specific parsing. Empty means no override, letting
      // the default (see workbench/css/styles.css's .workbench-canvas-card
      // rule) show through.
      padding: "",
      margin: "",
      // Plain manual fallback for the unified Visible toggle — used only
      // when neither visibilityBinding nor visibilityFormula is set (same
      // "leave blank to always show" contract as before, just now backed
      // by a real field the manual switch can actually flip, matching
      // Collapsible/Locked's own plain-boolean + binding/formula shape).
      visible: true,
      visibilityBinding: "",
      visibilityFormula: "",
      // Collapsible/Locked (readOnly) each keep their existing plain
      // boolean AND gain a binding/formula pair, same "unified toggle/
      // formula" control as Visible above (see createFormulaToggleField) —
      // storage key stays "readOnly" (not renamed to "locked") to avoid a
      // wider migration across every existing read site of this field;
      // only the inspector's own displayed label changes to "Locked".
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
      if (window.bootstrap && typeof window.bootstrap.Tooltip === "function") {
        // eslint-disable-next-line no-new
        new window.bootstrap.Tooltip(visibilityPill);
      }
    }

    if (iconElement) {
      iconElement.tabIndex = 0;
    }

    wrapper.appendChild(header);

    // Resolved ONCE, used for both the content below AND the wrapper's own
    // applyComponentStyles call further down — previously computed twice,
    // redundantly, with content getting the RAW component (so a heading's
    // own applyTextFormatting call, e.g. Container/Image, never saw a
    // binding/formula/template-default-resolved color, only the wrapper
    // did).
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

  // itemContext (preview-only — see resolvePreviewItemValue) only ever
  // matters for the option-resolving types (a Source-driven tab's own
  // Special-Abilities-style checkbox group needs its OWN tab's real
  // System-sourced item, not the template-wide preview data every other
  // bound field's preview resolves against) and Container (so it can pass
  // its incoming context through to plain children, and compute its own
  // tab item contexts for its own tab zones independently — see
  // renderContainerPreview). Every other type ignores the extra argument
  // exactly as it did before this parameter existed.
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
  // resolveRepeaterItemValue, for a Source-driven tab's own item (available
  // while authoring — System data, not a live character record). Same
  // "@value means the item itself, unconditionally" precedence; a deeper
  // "@foo.bar" path walks the item itself when it's a plain object. Returns
  // undefined (not the item, not a bound value) when `raw` isn't an "@..."
  // binding at all, so callers can tell "this component isn't item-relative"
  // apart from "it resolved to nothing" and fall back to the ordinary,
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

  // Prefers resolveSystemFieldValues (below — the same direct System-field
  // lookup Toggle's own preview has always used) over the generic
  // resolvePreviewBindingValue path — see that function's own comment for
  // the confirmed bug this fixes (a Source option's own `description`
  // silently discarded upstream by buildSystemPreviewData before this ever
  // saw it, same as Toggle's original sourceId problem). Falls back to the
  // old path when the binding isn't a plain top-level System field key.
  // `itemContext` (set only inside a Source-driven tab's own zone — see
  // renderContainerPreview) is tried FIRST, ahead of both: a Special-
  // Abilities-style checkbox group bound to "@value" means "this tab's own
  // item", which resolveSystemFieldValues (a top-level System field lookup)
  // could never resolve on its own.
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

  // A Source binding means specifically "a choices list from the System
  // record", resolved DIRECTLY against the System's own field schema
  // (state.systemDefinition.fields) — see resolveSystemFieldValues'
  // identical twin in workbench-character-view.js for the full reasoning
  // (buildSystemPreviewData strips everything but each entry's own .name
  // off an array-of-choices field before the generic
  // resolvePreviewBindingValue path ever sees them, so that path alone
  // could never recover a dropped sourceId OR a dropped `description` —
  // confirmed as two separate real bugs from the same root cause, not
  // just Toggle's original one). Used by resolveSelectPreviewOptions/
  // resolveSelectGroupPreviewOptions above now too. Only a plain,
  // single-segment field key is supported — no Source binding in this
  // suite has ever needed anything nested.
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
  // — matching resolveToggleStates' own fallback in workbench-character-view.js
  // exactly (a Toggle authored with only a literal states list, no Source,
  // previously showed the canvas's "select a source" empty-state message
  // even though it would render its literal states fine in real Play/Edit —
  // a preview/real-render parity gap, fixed here rather than left as-is).
  // Deliberately NOT normalizeOptionEntries — see resolveToggleStates' own
  // identical comment in workbench-character-view.js: it discards a Source
  // entry's own sourceId, which is what real bound data keying off a
  // proficiency rank (etc.) is very plausibly stored against. Resolves the
  // RAW Source array via toggleStateEntryFromRaw instead, same as the real
  // render, so preview and real render agree on what a state's identity
  // actually is.
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
      // Source-driven tabs (tabLabelsSourceBinding) take priority over the
      // static tabLabels list when set — one tab per resolved entry, using
      // its own derived label (resolveTabEntries — see that function's own
      // comment for why an object-of-arrays Source, like Blades in the
      // Dark's restructured `playbooks`, uses each key as its tab's own
      // label rather than a nested field definition's own dotted key).
      // Falls straight through to the existing static-list behavior when no
      // Source is set, so every other tabs Container in the suite is
      // unaffected.
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

    // Any zone key that's no longer valid (e.g. a legacy "col-N"/"row-N" key
    // from before normalizeContainerType ran, or a shrunk column/row count)
    // has its children salvaged into the first remaining zone rather than
    // discarded — same convention already used when a user shrinks a grid's
    // own column count. Skipped entirely for Source-driven tabs
    // (tabLabelsSourceBinding set): confirmed to actually happen (not just
    // theoretical) — the Template editor's own load sequence calls
    // renderCanvas() once synchronously BEFORE state.systemDefinition has
    // finished its async fetch (updateSystemContext nulls it first, fetches
    // after — see that function). That render sees resolveSystemFieldValues
    // resolve to nothing, falls back to the (now-empty, since Source took
    // over) static tabLabels, then the 2-tab default — a transient
    // mis-resolve, not a real "these tabs no longer exist." Without this
    // guard, that one render permanently deletes every "extra" zone key
    // (beyond the 2-tab fallback) and merges its authored content into
    // zone 0 — every OTHER tab's own content, dumped onto the first tab,
    // forever, the instant the page loads once. A stale key here is always
    // safe to just leave alone (worst case: dead, unused zone data sitting
    // around) — never safe to guess-delete off a single resolve that could
    // easily be transient.
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

    // Purely cosmetic below (same zone-{n} keys/storage regardless) —
    // Horizontal transposes what "columns" means (see the orientation
    // field's own comment in COMPONENT_DEFINITIONS), so the axis word in
    // every zone label/seed flips from "Column" to "Row" to match.
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
    // Applied directly to `drop` — the actual flex container the dropped
    // component cards become children of — not `wrapper`, which only ever
    // has the label badge and `drop` itself as its own two children.
    // alignItems/textAlign set on `wrapper` was a no-op for card
    // positioning even when a real value was resolved.
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
      resolveValue(comp, fallback) {
        return fallback;
      },
      // Visual disabled-state only (matches component.readOnly exactly, as
      // before) — onChange is a no-op regardless, so a listener firing in
      // the canvas never actually does anything; there's no live data to
      // write to here.
      editable(comp) {
        return !comp.readOnly;
      },
      onChange() {},
      resolveOptions(comp) {
        return resolveSelectPreviewOptions(comp, itemContext);
      },
      // Same real bug fixed on the live view's own resolveChoiceOptions
      // (workbench-character-view.js): a Checkbox/Radio group never
      // consulted its Source binding at all, only Select did. A Source IS
      // configured (sourceBinding set) trusts its resolution exactly like
      // Select does just above (resolveSelectPreviewOptions), including
      // showing genuinely empty if the bound System field has nothing yet
      // — a Source you can SEE resolving to nothing while authoring is more
      // honest than silently swapping in sample placeholders that look
      // like real, configured choices. Falls back to 3 sample options only
      // when there's no Source at all — an empty, never-configured group
      // still shows its shape while authoring, unlike the live view.
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
    });
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
    if (type === "custom") {
      const formula = typeof decorator.formula === "string" ? decorator.formula.trim() : "";
      return formula ? `=${formula}` : (decorator.text || "").trim() || "(empty)";
    }
    return "";
  }

  // An old saved template may still have `component.src` (the old, sole
  // field before this port) instead of `component.url` — read as a
  // fallback everywhere a URL is needed, written to `.url` on every edit
  // going forward (never `.src` again), so existing Image components keep
  // showing their picture with no migration step and self-heal on first edit.
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
  // with — i.e. this Container is nested inside an OUTER Source-driven
  // tab's zone — passed through unchanged to plain (non-tab) children.
  // Orthogonal to, and checked independently of, whether this Container
  // ALSO has its OWN tabLabelsSourceBinding (computed fresh per zone,
  // below) — mirrors workbench-character-view.js's renderContainerComponent
  // exactly (see its own renderZone for the live-view twin of this split).
  function renderContainerPreview(component, itemContext = null) {
    return renderContainerContent(component, {
      // Container's own Label field accepts a literal "@path" the same way
      // Icon's iconClass/Image's url do, plus a separate `formula` field
      // for the "=" case (createContainerLabelControl) — evaluated first,
      // same as Icon's/Image's own canvas preview. Binding/literal resolve
      // against the template's sample/preview data — previously this
      // canvas preview never attempted binding resolution for Label at
      // all, unlike every other bound field's own preview.
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
        // Preview-only twin of the live view's own tabEntry lookup
        // (workbench-character-view.js's renderContainerComponent) — a
        // Source-driven tab's own zone gets a { kind: "tab", item, key }
        // context built from that SAME tab's real System-sourced entry, so
        // an authored Special-Abilities-style checkbox group inside it can
        // preview that tab's own real options (resolveSelectPreviewOptions,
        // resolvePreviewItemValue) while still being authored just once.
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
      // option(s) look selected" state instead, matching each variant's
      // own original preview logic (tags treats `multiple` slightly more
      // leniently than buttons/default — preserved as-is, not a bug this
      // pass is fixing).
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
      // Always inert — same as Track's own canvas preview (previewTrackCtx
      // above). Toggle isn't a native form control anymore (a select that
      // could plausibly stay focusable-but-inert); it's a clickable shape,
      // and the canvas preview shouldn't invite a click that silently does
      // nothing (onChange below is a no-op either way).
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
      // Forces a half-filled look regardless of the component's own real
      // active state — the canvas preview is for judging how Background
      // (the unfilled portion) and Foreground (the filled portion) look
      // together while authoring them, not for showing what the default
      // active state happens to be (which could easily be fully empty or
      // fully filled, hiding one of the two colors entirely). Real
      // Play/Edit is unaffected — this ctx only ever backs the canvas.
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
  // Container's tabs (or into an empty one). Drag-drop can't do this: only
  // the ACTIVE tab's zone is ever in the DOM at once (see
  // renderContainerContent in component-renderers.js), so there's nothing
  // for SortableJS to drag a card into on any other tab. Clipboard state
  // (componentClipboard) sidesteps that entirely — Cut/Copy record the
  // selected component, the author switches tabs (or selects a different
  // target) however they like, then Paste inserts wherever the CURRENT
  // selection says to, same as a fresh drop from the palette would.
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

  // Where Paste lands: no selection -> end of the root canvas (matches a
  // fresh palette drop with nothing selected). A zone-bearing component
  // selected (Container/Repeater) -> INTO that container, at the end of
  // its currently active zone — for a Tabs container specifically, that's
  // whichever tab is on screen right now, empty or not, which is the one
  // case drag-drop can never reach. Any other component selected -> right
  // after it, as a new sibling in its own zone (a plain reorder-by-paste).
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
        // same reasoning the "New Template" modal's own draft creation
        // already uses (markClean: !isDuplicate, true for a genuinely new
        // one). This was the one path left saying otherwise, which made
        // the beforeunload warning (hasUnsavedTemplateChanges) fire the
        // instant this button was clicked, before any real edit.
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

    // Font Default — the ONLY true template-wide fallback (resolveComponentColorsForPreview
    // here, resolveComponentColors in workbench-character-view.js): every
    // component's own Text falls back to this when blank. Native
    // <input type="color"> on purpose — this one is meant to always hold a
    // real, simple literal color, never clearable, and a color input can't
    // be empty by construction, which is exactly the guarantee needed here.
    state.template.defaults = normalizeTemplateDefaults(state.template.defaults);
    const fontDefaultInput = document.createElement("input");
    fontDefaultInput.type = "color";
    fontDefaultInput.className = "form-control form-control-color";
    fontDefaultInput.value = state.template.defaults.fontColor;
    fontDefaultInput.disabled = !canEdit;
    fontDefaultInput.title = "Default font color";
    fontDefaultInput.addEventListener("input", () => {
      state.template.defaults.fontColor = fontDefaultInput.value;
      syncTemplateActions();
      renderCanvas();
    });
    form.appendChild(createTemplateField({ labelText: "Font Default", control: fontDefaultInput, id: "template-font-default" }));

    // Background/Border below are NOT fallbacks for anything — they're the
    // sheet's own literal, visible appearance (applied to the canvas root
    // above). Same createColorPickerField every component's own Colors
    // section already uses (common/js/lib/color-picker.js) — the same
    // Clear/unset (checkered-X) handling and the same Binding/Formula
    // capability, not a simplified one-off; a plain <input type="color">
    // can never actually represent "cleared" (it always shows a solid
    // color), which is exactly why Clear looked broken with the previous
    // version of this control even though the underlying data really was
    // being cleared.
    form.appendChild(
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

    form.appendChild(createTemplateBorderControls(canEdit));

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

  // Whether ANY of the given keys currently differ from a pristine,
  // freshly-created component of the same type — used to force a
  // collapsed-by-default section (Appearance/Behavior/Advanced) open when
  // the component already has non-default values set there, per the
  // standard section-order spec (see common/docs/inspector-standards.md).
  // Builds a real throwaway instance via createComponent (not a hand-
  // reconstructed defaults guess) so this can never drift from the actual
  // defaults logic — but saves/restores componentCounter around the call
  // so a comparison-only instance never steals a uid number a real new
  // component would otherwise get.
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

  // Split to match the canonical section list both tools now share —
  // General, Text, Colors, Border, Behavior, Advanced (see
  // createCollapsibleSection's own note in common/js/lib/inspector-fields.js
  // for why Press can't literally run this same code, and what it does
  // share instead). Colors vs. Border: the three swatches (text/background/
  // border color) are a "Colors" concern; a border's geometry (width/style/
  // radius/sides) is its own separate "Border" section, exactly mirroring
  // Press's own Colors-group-has-the-border-swatch / Borders-group-has-the-
  // geometry split.
  const TEXT_KEYS = ["labelPosition", "fontFamily", "textSize", "fontSizeCustom", "lineHeight", "textStyles", "align"];
  const COLOR_KEYS = ["textColor", "foregroundColor", "backgroundColor", "borderColor"];
  const BORDER_KEYS = ["borderWidth", "borderStyle", "borderRadius", "borderSides"];
  const BEHAVIOR_KEYS = [
    "collapsible", "collapsibleBinding", "collapsibleFormula",
    "readOnly", "readOnlyBinding", "readOnlyFormula",
    "editableInPlay", "editableInPlayBinding", "editableInPlayFormula",
    "visible", "visibilityBinding", "visibilityFormula",
  ];
  const ADVANCED_KEYS = ["padding", "margin", "className"];

  // Every field builder used in the inspector (createTextInput,
  // createRadioButtonGroup, createBindingFormulaInput, and the Image/Icon
  // one-off Binding/Text controls) marks its own label/heading with the
  // shared ".fw-semibold" class, its textContent set to the exact labelText
  // passed in — regardless of whether that label sits directly in the
  // control's wrapper or nested inside a ".form-floating" wrapper a level
  // down. That's enough to find a specific named field (Type, Placeholder,
  // Source / Options, Binding / Text) inside an already-built controls
  // array and pull it out to reposition, without every builder needing its
  // own tagging convention.
  function pluckControlByLabel(controls, labelText) {
    const index = controls.findIndex((el) => el?.querySelector?.(".fw-semibold")?.textContent === labelText);
    if (index === -1) return null;
    return controls.splice(index, 1)[0];
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
    const wrapper = document.createElement("div");
    // gap-3 (not gap-4) — tighter than the rest of the form's own section
    // spacing on purpose: this is the one gap between the Type Summary card
    // and everything below it, and a Type selector (when the type has one)
    // is the very next thing after it — no reason for more air here than
    // between any other two adjacent fields.
    wrapper.className = "d-flex flex-column gap-3";

    // Standard section 1 — Type Summary (never collapsible; see
    // common/docs/inspector-standards.md for the fixed section order every
    // component type follows in both Press and Workbench).
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

    // Field order within section 2 (General) follows one fixed rule
    // regardless of type: Type (if the type has one), ID, Label, Placeholder
    // (if the type has one), Source / Options (if applicable), Binding /
    // Text, then whatever remains of the type's own controls. Type/
    // Placeholder/Source-Options/Binding-Text are authored inside each
    // render*Inspector (or createDataControls) alongside the type's other
    // fields, so they're plucked out here by their label text and
    // re-inserted at the front so the fixed order holds no matter which
    // type built them.
    const componentSpecificControls = renderComponentSpecificInspector(component).filter(Boolean);
    const dataControls = createDataControls(component, definition).filter(Boolean);
    const remainingComponentControls = [...componentSpecificControls, ...dataControls];
    const typeControl = pluckControlByLabel(remainingComponentControls, "Type");
    const placeholderControl = pluckControlByLabel(remainingComponentControls, "Placeholder");
    const sourceOptionsControl = pluckControlByLabel(remainingComponentControls, "Source / Options");
    const bindingTextControl = pluckControlByLabel(remainingComponentControls, "Binding / Text");

    // Standard section 2 (unlabeled — never collapsible, always expanded,
    // this is why the inspector was opened). Type/ID/Label/Placeholder/
    // Source-Options/Binding-Text/rest all live here as one flat, unheaded
    // group. Not a "General" section: a named section in this inspector
    // means collapsible-with-a-heading (see createCollapsibleSection), and
    // this one is neither — it's just the fields that come before the
    // first real named section (Text).
    const generalControls = [
      typeControl,
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
      // Container gets its own Label control here too (createContainerLabelControl)
      // instead of the plain binding-blind one — it still needs to accept a
      // literal/`@path`/`=formula` in one field, which the generic Label
      // input below doesn't support. Called directly in this Identity-
      // section slot (not plucked from remainingComponentControls the way
      // Type/Source-Options/Binding-Text are) since it was never really a
      // "Binding / Text" field to begin with — that label was a mislabel
      // this same fix retired, along with the `draft.name` side effect the
      // generic Label field below still has.
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
      // Every type, unconditionally — see createAlignItemsControl's own
      // comment for why this lives here (top/unlabeled section) rather
      // than in "Text" alongside Text Align.
      createAlignItemsControl(component),
    ].filter(Boolean);
    if (generalControls.length) {
      const generalGroup = document.createElement("div");
      generalGroup.className = "d-flex flex-column gap-3";
      generalControls.forEach((control) => generalGroup.appendChild(control));
      form.appendChild(generalGroup);
    }

    // Standard section 3 — Text (collapsed by default unless non-default
    // values are already set). Font/Text size/Label position/Text style
    // (bold/italic/underline)/Alignment — every text-formatting concern,
    // as its own section, matching Press's own separate "Text" group
    // rather than folding it into a single catch-all "Appearance" section.
    // Font is always first (createTextFormattingControls' own first entry)
    // — Label position goes last, after Alignment, not first: it's a
    // structural placement choice (where the label sits relative to the
    // component), not a text-formatting property, so it reads better as
    // the last thing in this section rather than leading it.
    const textControls = [];
    if (componentHasTextControls(component)) {
      textControls.push(...createTextFormattingControls(component));
      textControls.push(createTextStyleControls(component));
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

    // Standard section 4 — Colors (collapsed by default unless non-default
    // values are already set). The three swatches only — border geometry
    // (width/style/radius/sides) is its own "Border" section below,
    // matching Press's own Colors-group-has-the-swatch/Border-group-has-
    // the-geometry split exactly.
    const colorControls = getColorControls(component);
    if (colorControls.length) {
      form.appendChild(
        createCollapsibleSection("Colors", [createColorRow(component, colorControls)], {
          defaultCollapsed: true,
          forceOpen: hasNonDefaultValues(component, COLOR_KEYS),
        })
      );
    }

    // Standard section 5 — Border (collapsed by default unless non-default
    // values are already set). Only for types whose Colors section includes
    // a border swatch at all — same gating this used to apply when Border
    // was folded into Appearance. Toggle included — Style/Width/Sides are
    // real for it now (component-renderers.js's renderToggleContent draws
    // a genuine per-side border, not a fixed 1px line); Corner radius is
    // the one field here that only actually does something for the
    // "square" shape (every other shape already has its own silhouette —
    // circle's border-radius:999px, diamond/star/diamond-quarters' own
    // clip-path — that an independently authored radius would conflict
    // with, not compose with), but showing it unconditionally reuses this
    // section as-is rather than forking it just for Toggle.
    if (colorControls.includes("border")) {
      form.appendChild(
        createCollapsibleSection("Border", [createBorderControls(component)], {
          defaultCollapsed: true,
          forceOpen: hasNonDefaultValues(component, BORDER_KEYS),
        })
      );
    }

    // Standard section 6 — Behavior (collapsed by default unless
    // non-default values are already set).
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

    // Standard section 7 — Advanced (collapsed by default unless non-
    // default values are already set). Available unconditionally, every
    // type — matches Press's own Classes field being ungated (unlike
    // everything else in this inspector, which is gated by registry
    // flags/component type).
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

  // Only two field concepts exist across this whole inspector (see
  // feedback_suite_wide_parity_principle / project_binding_text_vs_source
  // memory): "Binding / Text" (what populates this component from the
  // Character record — the field written to on selection) and
  // "Source / Options" (what populates a CHOICES LIST from the System
  // record — only present at all for the types that genuinely have one).
  // Previously the second, generic field here was left with no labelText
  // override at all, defaulting to createBindingFormulaInput's own generic
  // "Binding / Formula" — identical to the Source field's OWN generic
  // fallback would have been, making the two indistinguishable. This
  // output is merged directly into each type's own Component section now
  // (renderInspector), not a separate generic "Data" section.
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
          labelText: "Source / Options",
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
          labelText: "Binding / Text",
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
      appendRollerControl(controls, component);
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
      appendRollerControl(controls, component);
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

  function createColorRow(component, keys = []) {
    const controls = keys.filter((key) => COLOR_FIELD_MAP[key]);
    if (!controls.length) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    // No "Colors" heading here — the outer "Colors" SECTION heading
    // (createCollapsibleSection) already says what this is; a second one
    // in here too was a duplicate.
    const grid = document.createElement("div");
    grid.className = "template-color-grid";
    if (controls.length > 0) {
      // Caps at 4 per row, not just 3 — Toggle is the first type with all
      // four concepts (Text/Foreground/Background/Border) at once.
      grid.style.gridTemplateColumns = `repeat(${Math.min(controls.length, 4)}, minmax(0, 1fr))`;
    }
    controls.forEach((key) => {
      const config = COLOR_FIELD_MAP[key];
      const bindingValue = component[config.formulaProp]
        ? `=${component[config.formulaProp]}`
        : component[config.bindingProp] || "";
      grid.appendChild(
        createColorPickerField(config.label, {
          // The RAW stored color, not padded to config.default when empty
          // — createColorPickerField already has its own defaultValue param
          // for "what hue to start the popover from when nothing's set."
          // Padding value itself (the old resolveEffectiveColor helper) made
          // a cleared color indistinguishable from a real, explicitly-chosen
          // default: the picker's own committedHex/hasManualValue derive
          // straight from value, so a padded non-empty value always read as
          // "set," and the unset-X overlay never showed after Clear.
          value: component[config.prop] || "",
          defaultValue: config.default,
          bindingValue,
          evaluate: evaluatePreviewColor,
          // updateComponentColor (not updateComponent directly) — same
          // rerender contract, plus the before/after snapshot that makes
          // this undoable (case "componentColor" in applyTemplateUndo/
          // Redo). Fires once per commit (Accept/Enter/closing the popover
          // — see color-picker.js's own commitCurrent), never per drag
          // frame, so one undo entry per real edit is exactly right.
          onManualChange: (value) => {
            updateComponentColor(component.uid, (draft) => {
              draft[config.prop] = value;
              // Picking a border color is also a valid way to turn the
              // border on — not just the Style select (createBorderControls)
              // — so this needs the same "turning on for the first time,
              // write real values" treatment that select's own change
              // handler does, or the color swatch alone does nothing
              // visible. Only when a real color is actually chosen; clearing
              // the swatch still doesn't touch style (that's the select's
              // job alone, matching createBorderControls' own comment).
              if (key === "border" && value && (!draft.borderStyle || draft.borderStyle === "none")) {
                draft.borderStyle = "solid";
                if (draft.borderWidth === null || draft.borderWidth === undefined) draft.borderWidth = 1;
              }
            }, { rerenderCanvas: true, rerenderInspector: true });
          },
          // Same "=formula writes the Formula key, anything else writes the
          // Binding key" split every other Binding/Formula pair in this file
          // uses (Visible/Collapsible/Locked, Track's segments).
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
              // Also resets the literal itself back to unset — same as
              // every other color field (background/border/foreground).
              // A blank textColor isn't "invisible text": it means inherit
              // the template's own Font Default (resolveComponentColors/
              // resolveComponentColorsForPreview's TEMPLATE_DEFAULT_COLOR_
              // KEYS/MAP fallback, the one color fallback this app still
              // has, by design), same as a blank background/border means
              // inherit the template's own literal sheet background/border.
              draft[config.prop] = "";
            }, { rerenderCanvas: true, rerenderInspector: true });
          },
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

    // Style select comes first — no separate "Style" label of its own (the
    // outer "Border" SECTION heading — createCollapsibleSection's own —
    // already says what this is; a second "Border" heading in here too was
    // a duplicate, now removed). An aria-label keeps the select accessible
    // without a visible second label.
    //
    // currentStyle reads component.borderStyle directly — no cross-
    // property inference. borderStyle IS the border on/off switch;
    // borderColor/borderWidth/borderSides are downstream of it, not the
    // other way around (a component can't have "a border color" without
    // "a border" — style is what makes it a border at all). See the Style
    // select's own change handler below for the write-time half of this:
    // choosing a real style writes real borderColor/borderWidth values
    // into the data right then, so nothing downstream ever needs its own
    // invented rendering fallback.
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
          // downstream of it goes back to genuinely unset too, not left
          // behind as stale data with no effect (see hydrateComponent's
          // identical cleanup for data loaded from before this existed).
          draft.borderStyle = "";
          draft.borderColor = "";
          draft.borderWidth = null;
          draft.borderSides = null;
        } else {
          draft.borderStyle = nextStyle;
          // Turning the border ON for the first time — write real,
          // explicit values right now rather than leaving borderColor/
          // borderWidth blank and letting the renderer invent a fallback
          // no one actually chose. Only fills in what's still genuinely
          // unset — an already-configured color/width from a previous
          // border isn't overwritten just because style changed again.
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
    const wrapper = document.createElement("div");
    const heading = document.createElement("div");
    heading.className = "form-label fw-semibold text-body-secondary";
    heading.textContent = "Border";
    wrapper.appendChild(heading);
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
            // component.lineHeight != null first, not just Number.isFinite(Number(...))
            // on its own — Number(null) coerces to 0, a "finite number", which
            // wrongly displayed 0 (a real, explicit "collapse to zero height"
            // value) for a component that had never had a Line Height set at
            // all. Same bug shape as fontSizeCustom above.
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
    // form-floating, matching Press's own Font field exactly (and
    // createBindingFormulaInput's identical treatment above) — input
    // before label as direct children of the .form-floating wrapper.
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
    // Must run AFTER the input has a local DOM parent (append below) —
    // attachFontFamilyAutocomplete checks input.closest(".form-floating")
    // (falling back to input.parentElement) to find where to attach its
    // dropdown, same lesson learned from the Icon field earlier this
    // session.
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
  // form-floating, matching Font (createFontFamilyControl) exactly — same
  // "look and act like the other top fields" style, and the dropdown
  // (attachClassNameAutocomplete/ensureClassNameAutocompleteContainer)
  // already targets input.closest(".form-floating") ?? input.parentElement,
  // same as the font/icon pickers, so it needs no changes to work here.
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

  // Text Align — plain CSS text-align (component.align), applied by
  // applyTextFormatting (component-styles.js). Renamed from the bare
  // "Alignment" it used to share with Align Items below (createAlignItemsControl)
  // now that they're two distinct fields/controls — this one only ever
  // affects how THIS component's own text content is aligned, never how
  // the component itself is positioned within its parent.
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

  // Align Items — CSS align-self (component.alignSelf), applied by
  // applyComponentStyles (component-styles.js) to the component's own
  // outer wrapper. Lives in the unlabeled "top" section (generalControls,
  // renderInspector) for every type, deliberately NOT inside the "Text"
  // section alongside Text Align above — this positions the component
  // itself within its own parent (a Container zone, most commonly; a
  // no-op wherever the parent isn't flex/grid), a layout concern, not a
  // text-formatting one. "Stretch" (align-self: stretch) is the one value
  // with no equivalent in Text Align's own four options, so this isn't
  // just a relabeled copy of that control.
  function createAlignItemsControl(component) {
    // "Auto" (blank) first, same reasoning as BORDER_STYLE_OPTIONS' own
    // "None" — the real default (align-self: auto, inherit the parent's
    // align-items) isn't the same thing as "Start," so defaulting the
    // radio selection to Start would misrepresent an unset value as an
    // explicit choice.
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
  // preview — mirrors resolvePreviewBindingValue's own "no live record"
  // limits exactly: an "@path" resolves against sample data same as every
  // other bound field's preview; a "=formula" can't be evaluated here at
  // all (no formula engine wired into this canvas — see renderTextPreview's
  // own identical comment), so it returns undefined (shown as the toggle's
  // native indeterminate state) rather than guessing true or false.
  // The one place the Template editor actually evaluates a "=formula"
  // (see evaluatePreviewCondition/evaluatePreviewColor's own comments below
  // — everything else here treats "=" as unresolvable, an established
  // limit, not a technical one: evaluateFormula only ever needs a single
  // plain object to resolve @paths against, and state.systemPreviewData
  // (buildSystemPreviewData) already exists as exactly that "pretend
  // record" for the canvas). Two real limits worth knowing before relying
  // on this for a specific formula: systemPreviewData is synthesized purely
  // from the System's own declared field schema, so a formula referencing
  // an ad-hoc key that only exists in a DDB-mapping-computed field's output
  // shape (nothing in Loom's field editor declares it) has no sample value
  // to resolve — and this is called with the top-level preview data only,
  // never a Repeater item's own data (see renderRepeaterPreview's own
  // comment: the canvas doesn't iterate/preview real per-item data at all
  // today, it just shows the item template as an editable dropzone).
  // lookup(table, key) is real-evaluation-only in character-view.js
  // (evaluateFormulaWithLookup) — without this, any formula using it would
  // throw "lookup is not defined" here, even though it's perfectly valid
  // and will work fine once played. Same createLookupFn every other tool
  // uses, just resolved against the template's own sample data
  // (state.systemPreviewData) instead of a live character record.
  function previewFormulaOptions() {
    return { functions: { lookup: createLookupFn(state.systemPreviewData || {}, state.systemDefinition?.fields) } };
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
  // live feedback (createFieldPreviewFeedback below) — that one fails
  // closed to "nothing shown" on purpose (render time can't tell a broken
  // formula apart from one that simply hasn't resolved against this
  // system's sample data yet, and shouldn't try). The inspector needs the
  // actual distinction: a real syntax/runtime error is worth interrupting
  // the author for, an unresolved-but-valid formula isn't.
  function evaluatePreviewFormulaDetailed(formula) {
    try {
      const result = evaluateFormula(formula, state.systemPreviewData || {}, previewFormulaOptions());
      return { ok: true, value: result === null ? undefined : result };
    } catch (error) {
      return { ok: false, error: error?.message || "Invalid formula" };
    }
  }

  // Shared live feedback line for every literal/@binding/=formula field
  // (createBindingFormulaInput below, plus Icon/Image/Container/Repeater
  // decorator's own hand-rolled equivalents) — a formula's syntax/runtime
  // errors were previously silent everywhere; this surfaces the actual
  // error, and previews what a binding/formula currently resolves to
  // against the template's own sample data, so an author isn't flying
  // blind until they load a real character to test on. Plain literal text
  // shows nothing — it's already fully visible in the input itself, a
  // preview of it would just repeat the field back.
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
  // just read off state.template instead of a component. `prop` is
  // "backgroundColor" or "borderColor"; *Formula/*Binding are the sibling
  // fields createColorPickerField (Template Properties) writes into.
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

  // The color picker's own live-typed-value preview (createColorPickerField's
  // `evaluate` hook, called with whatever's currently in the Binding/Formula
  // box, not yet committed) for the template's own Background/Border —
  // unlike evaluatePreviewColor (used for every component's own color
  // fields), this DOES evaluate "=formula" — see evaluatePreviewFormula's
  // own comment on why the template-level fields specifically support that
  // now.
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

  // Same "@binding previews, =formula doesn't" limit as evaluatePreviewCondition
  // above, for a color's own binding/formula box (createColorPickerField,
  // common/js/lib/color-picker.js) — returns a hex string (or undefined,
  // shown as the swatch's own indeterminate stripe state) rather than a
  // boolean.
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

  // Editor-canvas rendering only (createComponentElement) — resolves each
  // color's @binding against the same sample/preview data the swatch's own
  // live preview uses; a formula falls back to the literal color instead
  // (the canvas never evaluates "=formula" at all — see
  // evaluatePreviewColor's own comment), same "best-effort, never invents
  // a color" rule real Play/Edit's own resolveComponentColors follows.
  // Text only — see normalizeTemplateDefaults' own comment on why
  // Background/Border aren't per-component fallbacks at all.
  const TEMPLATE_DEFAULT_COLOR_MAP = { text: "fontColor" };

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
    // own default — the ONLY fallback any color field should reach now,
    // in the canvas same as real Play/Edit (resolveComponentColors,
    // workbench-character-view.js).
    const templateDefaults = normalizeTemplateDefaults(state.template?.defaults);
    Object.entries(TEMPLATE_DEFAULT_COLOR_MAP).forEach(([key, defaultKey]) => {
      const prop = COLOR_FIELD_MAP[key].prop;
      const current = (overridden || component)[prop];
      if (typeof current !== "string" || !current.trim()) {
        if (!overridden) overridden = { ...component };
        overridden[prop] = templateDefaults[defaultKey];
      }
    });
    return overridden || component;
  }

  // The unified toggle/formula control (createFormulaToggleField) backs
  // Collapsible/Locked/Visible identically — a plain manual switch when
  // the condition field is empty, or a live (binding) / indeterminate
  // (formula) preview of the condition when it's not. Storage keeps its
  // existing boolean field (component.collapsible/readOnly) plus a new
  // *Binding/*Formula pair — see createComponent's own defaults comment.
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

  // "Locked" — storage key stays "readOnly" (see createComponent's own
  // defaults comment for why the field itself wasn't renamed).
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
  // Locked above, gated by supportsBinding (the same set of types that
  // have anything for isEditable/a Repeater's own add-row UI to act on:
  // Input, Repeater, Track, Select Group, Toggle). Storage:
  // component.editableInPlay + editableInPlayBinding/Formula. This is
  // what a component (or a Repeater item-template node — same field
  // names, read by isRepeaterItemNodeEditableInPlay instead — the
  // inspector doesn't distinguish nesting) opts into to stay live-
  // adjustable in Play view instead of gated behind Edit mode like
  // everything else — a genuine authored choice per component now,
  // replacing the old hardcoded "matches a System combatBindings path"
  // guess (isCombatBindingComponent, removed from workbench-character-
  // view.js). Marking a Repeater itself Editable in Play is also what
  // enables its Add/Remove-row controls in Play view, not just Edit mode
  // (see renderRepeaterComponent, workbench-character-view.js).
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

  // Available on every component type (not gated by the registry) — a
  // genuinely new capability neither Workbench nor Press had before (Press
  // only has a static, author-set hide toggle). Left blank, the component
  // always shows; a bound value or formula is evaluated at real character-
  // view render time, never in the Template editor's own canvas preview
  // (see renderComponentCard in workbench-character-view.js) — the canvas
  // only has synthesized sample data, so hiding components there based on
  // it could make them un-selectable/un-editable for reasons the author
  // can't see. The unified toggle's own live-preview evaluation (above)
  // doesn't conflict with this: it only drives the toggle's own visual
  // state in the inspector, never the canvas's actual visibility.
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

  // Thin adapter over the shared common/js/lib/binding-field.js control
  // (relocated there so Orrery's own marker Vision Range field could reuse
  // the exact same Binding/Formula/Text input instead of a smaller
  // duplicate) — same signature as before this relocation, so none of this
  // file's own ~11 call sites need to change. Injects this page's own
  // change-commit path (updateComponent), live field list (state.
  // bindingFields — read fresh via a callback, not a snapshot, so a field
  // left open while the System selection changes elsewhere still sees the
  // new list), and sample-data preview evaluators.
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

  // form-floating for all three — matching Press's own compact "small
  // label integrated into the control" look (and createBindingFormulaInput/
  // createFontFamilyControl's identical treatment above), rather than the
  // old stacked label-above-input style. A placeholder is required for
  // Bootstrap's empty-vs-filled floating behavior to engage at all; where
  // the caller doesn't supply real placeholder text, a single space keeps
  // the label floated-small and out of the way instead of overlapping the
  // (still-empty) value.
  // Thin adapters over the shared inspector-fields.js/ui-components.js
  // factories — kept as local functions (same signatures as before) so
  // none of this file's ~45 call sites need to change, but the actual
  // markup construction is now the one shared implementation Press's
  // Component Inspector also uses, instead of a second hand-built copy.
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
      // Bootstrap's form-floating needs an explicit height on textareas
      // (the `rows` attribute doesn't play well with the padding it adds
      // for the label) — matches Press's own text field, which sets this
      // directly instead of using `rows` at all.
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
      options: options.map((option, index) => ({
        id: toId([component.uid, labelText, option.value, index]),
        value: option.value,
        icon: option.icon,
        text: option.label ?? option.value,
      })),
    });
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
        { forceSingleRow: true, hideLabel: true }
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
  // Purely structural/authoring-time choice, not state that plausibly
  // varies by character — plain switch, not the unified toggle/formula
  // control (see createFormulaToggleField's own usage for Visible/
  // Collapsible/Locked, which DO vary by character).
  function createRepeaterHeaderToggle(component, { isHorizontal = false } = {}) {
    return createSwitchField(isHorizontal ? "Header column" : "Header row", !!component.showHeader, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.showHeader = checked;
        ensureRepeaterZone(draft);
      }, { rerenderCanvas: true, rerenderInspector: true });
    });
  }

  // Horizontal-only — Vertical items already fill the full width of their
  // single stacking column naturally (block-level, width:100%), so there's
  // nothing to "fill" there. Off by default (unchanged existing behavior:
  // items sit at their own natural content width, left-packed, wrapping
  // once they run out of row space) — a real design choice, not always
  // wanted (e.g. a long, open-ended list of items looks better left-packed
  // than stretched to fill one row). See renderRepeaterHorizontalList/Grid
  // (workbench-character-view.js) for what actually changes: item cells/
  // columns grow equally to consume the full available width instead of
  // sizing to their own content, while any header column/decorator stays
  // its own natural size.
  function createRepeaterFillToggle(component) {
    return createSwitchField("Fill available width", !!component.fill, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.fill = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Off by default — most Repeaters (ability scores, skills, a fixed
  // defenses/senses list, ...) have a fixed, System-defined cardinality
  // where an Add/Remove control would be actively wrong to offer. Turned on
  // per-Repeater for the genuinely open-ended lists (Inventory, a crew's
  // Upgrades/Claims/Cohorts, ...) — see renderRepeaterComponent
  // (workbench-character-view.js) for what this actually gates: its own
  // Add-item button and each row's own Remove button, still further gated
  // by mode/Editable in Play the same as everything else there. Same
  // "purely structural/authoring-time choice" reasoning as
  // createRepeaterHeaderToggle above — a plain switch, not the unified
  // toggle/formula control, since whether a list is open-ended at all
  // isn't state that plausibly varies by character.
  function createRepeaterAllowAddRemoveToggle(component) {
    return createSwitchField("Add/remove items", !!component.allowAddRemove, (checked) => {
      updateComponent(component.uid, (draft) => {
        draft.allowAddRemove = checked;
      }, { rerenderCanvas: true });
    });
  }

  // Vertical (default) stacks repeated items top-to-bottom; Horizontal
  // flows them left-to-right — a real pivot of the whole authoring model,
  // not just a CSS direction flip (see the orientation field's own comment
  // in COMPONENT_DEFINITIONS, and renderRepeaterComponent in
  // workbench-character-view.js for what actually renders differently).
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
    // "Column widths" sizes the N *fixed* field-columns of Vertical table
    // mode via a <colgroup> — Horizontal's repeating axis is the items
    // themselves (unknown count until render, rendered as a CSS Grid, not
    // a <table> — see renderRepeaterComponent), which a fixed-width list
    // like this can't meaningfully describe, so it's hidden there instead
    // of offered with no effect.
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
    controls.push(createRepeaterAllowAddRemoveToggle(component));
    // Spacing between repeated items — only meaningful for Horizontal (the
    // items sit side-by-side; Vertical already stacks them with each
    // component's own Margin, same as everywhere else). Same field/control
    // as Container's own "Grid gap (px)".
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
      // Same literal/@binding/=formula field as Container's Label, Image's
      // URL, Icon's iconClass, and Text's own Binding/Text — a decorator's
      // custom text is always resolved per-row (resolveRepeaterDecorator,
      // workbench-character-view.js), never against the top-level draft,
      // so "=formula" here means "computed from THIS row's own fields."
      // Hand-rolled instead of createTextInput (which every OTHER field on
      // this control list uses) specifically to make room for the live
      // feedback line below — createTextInput itself stays plain, since
      // adding this to every one of its many non-binding uses (Height,
      // Column widths, ...) would just be noise there.
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

  // URL text input + the pattern/shape picker's own "brush" trigger button
  // alongside it — the one piece of the Image inspector that isn't a plain
  // createTextInput, since it needs a second control in the same row (so
  // it can't just be createBindingFormulaInput with textKey:"url" the way
  // Container's own equivalent field is — this one still needs Icon-style
  // hand-rolled commit logic to make room for that button).
  // "Binding / Text" — not "Image URL" — matching every other component's
  // data-population field name exactly (see project_binding_text_vs_source
  // memory). A literal URL, an "@path", or "=formula" (component.formula,
  // same generic key Icon/Text/Container use) resolved against the
  // Character record at render time (see renderImageContent's
  // ctx.resolveBindableString/ctx.evaluateFormula in component-renderers.js
  // — Image previously had no binding OR formula support at all here, a
  // real functional gap, not just a naming one).
  function createImageUrlControl(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const id = toId([component.uid, "Image URL", "input"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = "Binding / Text";
    const row = document.createElement("div");
    row.className = "d-flex gap-1";
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.placeholder = "https://..., @portrait.url, or =formula";
    input.value = component.formula ? `=${component.formula}` : resolveImageUrl(component);
    const feedback = createFieldPreviewFeedback();
    feedback.update(input.value);
    input.addEventListener("input", () => {
      const trimmed = input.value.trim();
      updateComponent(component.uid, (draft) => {
        if (trimmed.startsWith("=")) {
          draft.formula = trimmed.slice(1).trim();
          draft.url = "";
        } else {
          draft.url = input.value;
          draft.formula = "";
        }
      }, { rerenderCanvas: true });
      feedback.update(input.value);
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
    // "Binding / Text" — not "Icon" — matching every other component's
    // data-population field name exactly (see
    // project_binding_text_vs_source memory): typing "@some.path" directly
    // into this same field is how a bound icon is authored, same
    // literal-or-binding convention as Text's own field. "=formula" is a
    // third mode on the same field (component.formula, the same generic
    // key Text/Input use) rather than a second input — takes priority over
    // iconClass when set, for a computed icon class (e.g. ="ddb-"+@type)
    // that a single bound @path can't express.
    label.textContent = "Binding / Text";
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
    input.placeholder = "ddb-fire, bi-star, @some.path, or =formula";
    input.value = component.formula ? `=${component.formula}` : component.iconClass || "";
    const feedback = createFieldPreviewFeedback();

    const refreshPreview = () => {
      previewSpan.innerHTML = "";
      const trimmed = input.value.trim();
      // Same resolution renderIconPreview's canvas swatch uses (both read
      // from state.systemPreviewData) — a literal name resolves as-is, an
      // "@" binding and a "=" formula both resolve against sample data, so
      // this little preview and the canvas agree on what a bound/computed
      // icon will actually look like.
      let resolved = input.value;
      if (trimmed.startsWith("=")) {
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
      // The swatch above only ever shows "some glyph" or "nothing" — it
      // can't distinguish a bad formula from one that just hasn't resolved
      // against this system's sample data yet. This line can.
      feedback.update(input.value);
    };
    refreshPreview();

    const commit = (value) => {
      const trimmed = value.trim();
      updateComponent(component.uid, (draft) => {
        if (trimmed.startsWith("=")) {
          draft.formula = trimmed.slice(1).trim();
          draft.iconClass = "";
        } else {
          draft.iconClass = value;
          draft.formula = "";
        }
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
    wrapper.append(label, row, feedback.element);
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

  // "Label" — Identity-section position, same as every other type's own
  // generic Label field, just not binding-blind: this one still accepts a
  // literal heading, an "@path", or an "=formula" (component.formula, same
  // generic key Icon/Image/Text use) in one field, matching the "any text
  // field takes a binding, formula, or literal" convention. Previously
  // labeled "Binding / Text" and plucked into the Component-section slot
  // (pluckControlByLabel) — that was a genuine mislabel (Container has no
  // real `binding` field at all; this was always just its own Label field
  // wearing the Binding/Text vocabulary's name) — now called directly from
  // generalControls' own Identity-section ternary instead, so it doesn't
  // need to be plucked out of anything.
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
      // entry (see resolveSystemFieldValues/ensureContainerZones) instead
      // of the literal tabLabels list. Same shared control every other
      // Source field uses (Select's/Toggle's own "Source / Options"), just
      // labeled "Source" here since this one drives which/how-many tabs
      // exist, not a single field's own choices list.
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
      // resolveLockedTabIndex, workbench-character-view.js): when set to
      // the character's own selection field (e.g. "@class", "@playbook"),
      // Play view shows ONLY the one tab matching that value, no nav bar —
      // Edit view is completely unaffected, every tab stays switchable
      // there regardless (that's the character-creation surface). Blank
      // (the default) leaves every tab always switchable in both modes,
      // same as before this field existed.
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

  // Shape is labeled "Type" (not "Shape", no visible heading) on purpose —
  // it's the same UX role Input's variant selector (text/textarea/select/
  // etc.) and Select Group's variant selector (pills/tags/buttons) already
  // fill for their own types, both literally labeled "Type" too
  // (renderInputInspector/renderSelectGroupInspector) — the one control
  // that picks how this component's core control fundamentally renders.
  // Naming it "Type" (not a separate, novel label) is what makes
  // pluckControlByLabel (renderInspector) front-load it right below the
  // Type Summary card for free, matching every other type's own Type
  // selector placement, instead of writing bespoke placement logic here.
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
          // field is only shown for shape "square" (see createBorderControls'
          // own comment), so switching shape has to redraw the inspector,
          // not just the canvas, or that field's visibility goes stale
          // until something else happens to re-render it.
          updateComponent(component.uid, (draft) => {
            draft.shape = value;
          }, { rerenderCanvas: true, rerenderInspector: true });
        },
        { forceSingleRow: true, hideLabel: true }
      )
    );
    // Optional — blank keeps today's default (the shape stretches to fill
    // its container's width via .component-field--label-top's own
    // stretch rule, fixed at the CSS-default height, which can distort a
    // circle into an oval in a narrow repeater column). Same free-CSS-value
    // convention as Image's own Width/Height fields; set as an inline
    // style on the glyph itself (see renderToggleContent), which naturally
    // outranks that stretch rule without needing any CSS specificity work.
    // Side by side, same row — same createFieldRow(..., {columns:2}) split
    // Border's own Thickness/Corner-radius pair already uses.
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
      label.title = displayLabel;

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
      // Background used to get an unconditional "#495057, since an empty
      // value isn't a real 'no background' choice for this type" backfill
      // here, same as borderStyle/borderColor below. That stopped being
      // true once Background got real unset/X-overlay support in the color
      // picker (see color-picker.js's --unset handling) — "no background"
      // (show through to whatever's behind the shape) became a legitimate,
      // intentional choice, and this hydration step (which runs once, every
      // time a template's saved JSON loads fresh) silently overwrote it
      // right back to grey on every load even when the JSON itself stayed
      // correctly empty (see workbench-character-view.js's own identical
      // fix — this file has its own separate hydrateComponent). Border
      // keeps its own backfill below since that wasn't the reported
      // problem: borderStyle has to be filled in here (not left to the
      // generic "no style = no border" rule further down to just clear
      // borderColor right back out) — Toggle's border is meant to always be
      // on by default, the one type where that's true.
      if (!merged.borderStyle || merged.borderStyle === "none") {
        merged.borderStyle = "solid";
      }
      if (!merged.borderColor) {
        merged.borderColor = "#343a40";
      }
      if (merged.borderWidth === null || merged.borderWidth === undefined) {
        merged.borderWidth = 1;
      }
      // foregroundColor (the shape's own fill) used to just BE textColor —
      // one field doing two jobs, which is exactly the confusion the
      // Text/Foreground split exists to remove (see COLOR_FIELD_MAP's own
      // comment). Anything saved before the split has no foregroundColor
      // at all, so inherit whatever textColor currently is (preserving
      // the fill's existing look) rather than falling back to the generic
      // new-component default and silently changing how an old template
      // renders.
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
    // borderStyle is the border on/off switch, not borderColor — a
    // component with no style (or style: "none") has no border, full
    // stop, and everything downstream of that (color/width/sides — but
    // NOT radius, which independently shapes the card's own background/
    // shadow rounding even with no border line drawn) is stale leftover
    // data, not a real, current choice, whenever style says there's
    // nothing here. Strips it back to empty on every load so the stored
    // data itself matches "nothing set" — this exact shape existed in
    // practice (every component used to be seeded with borderStyle:
    // "solid" and a full borderSides object regardless of borderColor,
    // before those seeds were removed — see createComponent's own
    // comment), so old saved templates need this cleanup, not just new
    // ones going forward. Applies to Toggle too now that it has real
    // Style/Width/Sides support (component-renderers.js's
    // renderToggleContent) — see createComponent's own toggle defaults for
    // why its OWN seeded borderStyle is "solid", not "" like most types.
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
      // A brand-new template (defaults === null) and an already-saved one
      // predating this field both land here — normalizeTemplateDefaults
      // always returns a real fontColor either way, matching "New
      // templates should seed simple default template values like we do
      // with the font."
      defaults: normalizeTemplateDefaults(defaults),
      // The sheet's own literal, visible background/border — blank by
      // default (a real, meaningful "no background"/"no border" choice,
      // same as any component's own field), NOT a per-component fallback.
      // Applied once to the canvas/sheet root (renderCanvas here,
      // applyTemplateData in workbench-character-view.js), same
      // Binding/Formula-capable shape a component's own Colors section
      // uses (createColorPickerField) — same picker, same Clear/unset
      // handling, not a simplified one-off.
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
