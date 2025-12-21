import { initAppShell } from "../../../common/js/lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../lib/data-manager.js";
import { initAuthControls } from "../lib/auth-ui.js";
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
import { resolveApiBase } from "../lib/api.js";
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
import { attachFormulaAutocomplete } from "../lib/formula-autocomplete.js";
import { resolveFieldTypeMeta } from "../lib/field-type-meta.js";
import { listFormulaFunctionMetadata } from "../lib/formula-metadata.js";
import { initTierGate, initTierVisibility } from "../lib/access.js";
import {
  normalizeBindingValue,
  resolveBindingFromContexts,
  normalizeOptionEntries,
  buildSystemPreviewData,
  parseBindingPathSegments,
} from "../lib/component-data.js";
import { createLabeledField, normalizeLabelPosition } from "../lib/component-layout.js";
import { initHelpSystem } from "../../../common/js/lib/help.js";

(async () => {
  const { status, undoStack, undo, redo } = initAppShell({
    namespace: "template",
    onUndo: handleUndoEntry,
    onRedo: handleRedoEntry,
  });

  const dataManager = new DataManager({ baseUrl: resolveApiBase() });
  const auth = initAuthControls({ root: document, status, dataManager });
  initTierVisibility({ root: document, dataManager, status, auth });
  initHelpSystem({ root: document });

  function sessionUser() {
    return dataManager.session?.user || null;
  }

  const gate = initTierGate({
    root: document,
    dataManager,
    status,
    auth,
    requiredTier: "gm",
    gateSelector: "[data-tier-gate]",
    contentSelector: "[data-tier-content]",
    onGranted: () => window.location.reload(),
    onRevoked: () => window.location.reload(),
  });

  if (!gate.allowed) {
    return;
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
      case "linear-track":
      case "circular-track":
        return ["number"];
      case "array":
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

  function normalizeBindingPath(binding) {
    const normalized = normalizeBindingValue(binding);
    if (!normalized || normalized.startsWith("=")) {
      return "";
    }
    if (normalized.startsWith("@")) {
      return normalized.slice(1).trim();
    }
    return normalized;
  }

  function findBindingFieldEntry(binding, allowedCategories = null) {
    const path = normalizeBindingPath(binding);
    if (!path) {
      return null;
    }
    const entry = state.bindingFields.find((field) => field?.path === path) || null;
    if (!entry) {
      return null;
    }
    if (!fieldMatchesCategories(entry, allowedCategories)) {
      return null;
    }
    return entry;
  }

  function formatSegmentLabel(segment) {
    if (!segment) {
      return "";
    }
    const cleaned = segment.replace(/\[\]/g, "").replace(/[-_]+/g, " ").trim();
    if (!cleaned) {
      return "";
    }
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  function formatBindingLabel(binding) {
    const path = normalizeBindingPath(binding);
    if (!path) {
      return "";
    }
    const parts = path.split(/[.\[\]]/).filter(Boolean);
    if (!parts.length) {
      return "";
    }
    return formatSegmentLabel(parts[parts.length - 1]);
  }

  function resolveRelativeSegments(sourceBinding, targetBinding) {
    const sourceSegments = parseBindingPathSegments(sourceBinding) || [];
    const targetSegments = parseBindingPathSegments(targetBinding) || [];
    if (!sourceSegments.length || !targetSegments.length) {
      return [];
    }
    const sourceRoot = sourceSegments[0];
    if (targetSegments[0] !== sourceRoot) {
      return [];
    }
    if (targetSegments.length > sourceSegments.length && sourceSegments.every((segment, index) => segment === targetSegments[index])) {
      return targetSegments.slice(sourceSegments.length);
    }
    if (targetSegments.length > 1) {
      return targetSegments.slice(1);
    }
    return [];
  }

  function getValueFromSegments(target, segments = []) {
    if (!segments.length) {
      return undefined;
    }
    let cursor = target;
    for (const segment of segments) {
      if (!segment) {
        return undefined;
      }
      if (Array.isArray(cursor)) {
        const index = Number(segment);
        if (Number.isFinite(index) && index >= 0 && index < cursor.length) {
          cursor = cursor[index];
        } else {
          return undefined;
        }
      } else if (cursor && typeof cursor === "object" && segment in cursor) {
        cursor = cursor[segment];
      } else {
        return undefined;
      }
    }
    return cursor;
  }

  function fallbackItemLabel(baseLabel, item, index) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    if (typeof item === "number") {
      return String(item);
    }
    if (item && typeof item === "object") {
      const candidates = ["name", "title", "label", "id"];
      for (const key of candidates) {
        const value = item[key];
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      }
    }
    return `${baseLabel} ${index + 1}`;
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
    importButton: document.querySelector('[data-action="import-template"]'),
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
    templatePropertiesCollapse: document.getElementById("template-properties-collapse"),
    componentPropertiesCollapse: document.getElementById("component-properties-collapse"),
    templateDeleteButton: null,
  });

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
          const result = await dataManager.get("templates", selectedId, {
            preferLocal: !shareToken,
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
    array: {
      label: "List",
      defaults: {
        name: "List",
        variant: "list",
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
    divider: {
      label: "Divider",
      defaults: {
        name: "Divider",
        style: "solid",
        thickness: 2,
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: ["foreground"],
    },
    image: {
      label: "Image",
      defaults: {
        name: "Image",
        src: "https://placekitten.com/320/180",
        alt: "Illustration",
        fit: "contain",
        height: 180,
      },
      supportsBinding: false,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: false,
      textControls: false,
      colorControls: [],
    },
    label: {
      label: "Label",
      defaults: {
        name: "Label",
        text: "Label text",
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
        containerType: "columns",
        columns: 2,
        rows: 2,
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
    "linear-track": {
      label: "Linear Track",
      defaults: {
        name: "Linear Track",
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
    "circular-track": {
      label: "Circular Track",
      defaults: {
        name: "Circular Track",
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

  function getBindingEditorValue(component, { bindingKey = "binding", formulaKey = "formula" } = {}) {
    if (!component || typeof component !== "object") {
      return "";
    }
    if (componentHasFormula(component, { formulaKey })) {
      const expression = normalizeBindingValue(component[formulaKey]);
      return expression ? `=${expression}` : "";
    }
    if (!bindingKey) {
      return "";
    }
    return normalizeBindingValue(component[bindingKey]);
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
        syncTemplateActions();
        undoStack.push({
          type: "save",
          templateId: state.template?.id || "",
          count: state.components.length,
        });
        if (savedToServer || !requireRemote) {
          markTemplateClean();
        }
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
        button.disabled = false;
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

  if (elements.importButton) {
    elements.importButton.addEventListener("click", () => {
      status.show("Import coming soon", { type: "info", timeout: 2000 });
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
    const confirmed = window.confirm(`Delete ${label}? This action cannot be undone.`);
    if (!confirmed) {
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

  renderCanvas();
  renderInspector();
  ensureTemplateSelectValue();
  syncTemplateActions();

  function renderCanvas() {
    if (!elements.canvasRoot) return;
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
    if (!dataManager.baseUrl) {
      return null;
    }
    try {
      const result = await dataManager.get("systems", schemaId, { preferLocal: true });
      const payload = result?.payload || null;
      if (payload) {
        systemDefinitionCache.set(schemaId, payload);
        registerSystemRecord({ id: schemaId, title: payload.title || schemaId, source: result?.source || "remote", payload });
      }
      return payload;
    } catch (error) {
      console.warn("Template editor: unable to fetch system", error);
      return null;
    }
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
    if (!elements.templatePropertiesCollapse) {
      return;
    }
    if (window.bootstrap && typeof window.bootstrap.Collapse === "function") {
      const instance = window.bootstrap.Collapse.getOrCreateInstance(elements.templatePropertiesCollapse, {
        toggle: false,
      });
      instance.show();
      return;
    }
    elements.templatePropertiesCollapse.classList.add("show");
  }

  function collapseTemplatePropertiesSection() {
    if (!elements.templatePropertiesCollapse) {
      return;
    }
    if (window.bootstrap && typeof window.bootstrap.Collapse === "function") {
      const instance = window.bootstrap.Collapse.getOrCreateInstance(elements.templatePropertiesCollapse, {
        toggle: false,
      });
      instance.hide();
      return;
    }
    elements.templatePropertiesCollapse.classList.remove("show");
  }

  function expandComponentPropertiesSection() {
    if (!elements.componentPropertiesCollapse) {
      return;
    }
    if (window.bootstrap && typeof window.bootstrap.Collapse === "function") {
      const instance = window.bootstrap.Collapse.getOrCreateInstance(elements.componentPropertiesCollapse, {
        toggle: false,
      });
      instance.show();
      return;
    }
    elements.componentPropertiesCollapse.classList.add("show");
  }

  function collapseComponentPropertiesSection() {
    if (!elements.componentPropertiesCollapse) {
      return;
    }
    if (window.bootstrap && typeof window.bootstrap.Collapse === "function") {
      const instance = window.bootstrap.Collapse.getOrCreateInstance(elements.componentPropertiesCollapse, {
        toggle: false,
      });
      instance.hide();
      return;
    }
    elements.componentPropertiesCollapse.classList.remove("show");
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
    const user = sessionUser();
    if (!user || !dataManager.isAuthenticated()) {
      return false;
    }
    const ownerId =
      metadata?.ownerId ?? metadata?.owner_id ?? state.template?.ownerId ?? null;
    if (ownerId !== null && ownerId !== undefined && user.id !== undefined && user.id !== null) {
      if (String(ownerId) === String(user.id)) {
        return true;
      }
    }
    const ownerUsername =
      metadata?.ownerUsername ||
      metadata?.owner_username ||
      state.template?.ownerUsername ||
      "";
    if (ownerUsername && user.username) {
      if (ownerUsername.toLowerCase() === user.username.toLowerCase()) {
        return true;
      }
    }
    return false;
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
      const canEditRecord = templateAllowsEdits(metadata);
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
    if (elements.templateDeleteButton) {
      applyDeleteTemplateButtonState(elements.templateDeleteButton);
    }
  }

  function resolveDeleteTemplateState() {
    const metadata = getTemplateMetadata(state.template?.id);
    const canWrite = dataManager.hasWriteAccess("templates");
    const canEditRecord = templateAllowsEdits(metadata);
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
      const owned = Array.isArray(remote?.owned) ? remote.owned : [];
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
      const result = await dataManager.get("templates", targetId, {
        preferLocal: !shareToken,
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

  function getCollection(parentId, zoneKey) {
    if (!parentId) {
      return state.components;
    }
    const parent = findComponent(parentId);
    if (!parent) {
      return null;
    }
    const component = parent.component;
    if (component.type !== "container") {
      return parent.collection;
    }
    ensureContainerZones(component);
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
      if (component.type === "container") {
        const zones = ensureContainerZones(component);
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
    if (!component || component.type !== "container") return false;
    const zones = ensureContainerZones(component);
    for (const zone of zones) {
      for (const child of zone.components) {
        if (child.uid === targetId) {
          return true;
        }
        if (child.type === "container" && containsComponent(child, targetId)) {
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
      textSize: "md",
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
    if (component.type === "linear-track" || component.type === "circular-track") {
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
    if (component.type === "container") {
      ensureContainerZones(component);
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
      case "array":
        return renderArrayPreview(component);
      case "divider":
        return renderDividerPreview(component);
      case "image":
        return renderImagePreview(component);
      case "label":
        return renderLabelPreview(component);
      case "container":
        return renderContainerPreview(component);
      case "linear-track":
        return renderLinearTrackPreview(component);
      case "circular-track":
        return renderCircularTrackPreview(component);
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

  function ensureContainerZones(component) {
    if (!component || component.type !== "container") return [];
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

    const type = component.containerType || "columns";
    if (type === "tabs") {
      const labels = Array.isArray(component.tabLabels) && component.tabLabels.length
        ? component.tabLabels
        : ["Tab 1", "Tab 2"];
      labels.forEach((labelText, index) => {
        registerZone(`tab-${index}`, (labelText || `Tab ${index + 1}`).trim() || `Tab ${index + 1}`);
      });
      setActiveTabIndex(component, getActiveTabIndex(component, labels.length));
    } else if (type === "rows") {
      clearActiveTab(component);
      const rows = clampInteger(component.rows || 2, 1, 6);
      for (let index = 0; index < rows; index += 1) {
        registerZone(`row-${index}`, `Row ${index + 1}`);
      }
    } else if (type === "grid") {
      clearActiveTab(component);
      const columns = clampInteger(component.columns || 2, 1, 4);
      const rows = clampInteger(component.rows || 2, 1, 6);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          registerZone(`grid-${row}-${col}`, `Row ${row + 1}, Column ${col + 1}`);
        }
      }
    } else {
      clearActiveTab(component);
      const columns = clampInteger(component.columns || 2, 1, 4);
      for (let index = 0; index < columns; index += 1) {
        registerZone(`col-${index}`, `Column ${index + 1}`);
      }
    }

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
    if (component.type !== "container") {
      return;
    }
    clearActiveTab(component);
    const zoneEntries = component.zones && typeof component.zones === "object"
      ? Object.values(component.zones)
      : [];
    zoneEntries.forEach((items) => {
      if (!Array.isArray(items)) return;
      items.forEach((child) => {
        if (child && child.type === "container") {
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

  function renderArrayPreview(component) {
    const labelText = getComponentLabel(component, "List");
    const control = document.createElement("div");
    control.className = "d-flex flex-column gap-2";

    const previewModel = (() => {
      const sourceBinding = normalizeBindingValue(component?.sourceBinding);
      const fallbackBinding = normalizeBindingValue(component?.binding);
      const activeBinding = sourceBinding || fallbackBinding;
      const sourceField = findBindingFieldEntry(activeBinding, ["array", "object"]);
      const hasValidSource = Boolean(sourceField);
      const baseLabel = hasValidSource
        ? sourceField?.label?.trim() || formatBindingLabel(activeBinding) || "Item"
        : "Item";
      const bindingForPreview = hasValidSource ? activeBinding : "";
      const bindingWithSource = hasValidSource ? sourceBinding || fallbackBinding : "";
      let resolvedItems = [];
      if (bindingWithSource) {
        const boundItems = resolvePreviewBindingValue(bindingWithSource);
        if (Array.isArray(boundItems)) {
          resolvedItems = boundItems;
        }
      }
      const displayBinding =
        hasValidSource && typeof sourceField?.displayField === "string" && sourceField.displayField.trim()
          ? sourceField.displayField.trim()
          : "";
      const displaySegments =
        bindingForPreview && displayBinding
          ? resolveRelativeSegments(
              bindingForPreview,
              displayBinding.startsWith("@") ? displayBinding : `@${displayBinding}`
            )
          : [];
      const valueBinding = normalizeBindingValue(component?.binding);
      const valueSegments =
        bindingForPreview && valueBinding
          ? resolveRelativeSegments(bindingForPreview, valueBinding)
          : [];
      const hasValueBinding = valueSegments.length > 0;
      const valueLabel = hasValueBinding ? formatSegmentLabel(valueSegments[valueSegments.length - 1]) : "";
      const entryCount = component.variant === "cards" ? 2 : 3;
      const itemsToRender = [];
      for (let index = 0; index < entryCount; index += 1) {
        if (resolvedItems[index] !== undefined) {
          itemsToRender.push(resolvedItems[index]);
        } else {
          itemsToRender.push(null);
        }
      }
      const entries = itemsToRender.map((item, index) => {
        const isPlaceholder = item === null || item === undefined;
        const fallbackLabel = fallbackItemLabel(baseLabel, item, index);
        let text = fallbackLabel;
        if (!isPlaceholder && displaySegments.length) {
          const raw = getValueFromSegments(item, displaySegments);
          if (raw !== undefined && raw !== null) {
            const stringValue = String(raw).trim();
            if (stringValue) {
              text = stringValue;
            }
          }
        } else if (!isPlaceholder && typeof item === "string") {
          const trimmed = item.trim();
          if (trimmed) {
            text = trimmed;
          }
        }
        let badgeText = "";
        let showBadge = false;
        if (hasValueBinding) {
          showBadge = true;
          if (!isPlaceholder) {
            const rawBadge = getValueFromSegments(item, valueSegments);
            if (rawBadge !== undefined && rawBadge !== null) {
              const badgeString = String(rawBadge).trim();
              badgeText = badgeString || "—";
            } else {
              badgeText = "—";
            }
          } else {
            badgeText = "—";
          }
        } else if (isPlaceholder) {
          showBadge = true;
          badgeText = "Value";
        }
        return {
          text,
          badgeText,
          showBadge,
          isPlaceholder,
          hasValueBinding,
          valueLabel,
        };
      });

      return {
        label: baseLabel,
        items: entries,
      };
    })();

    if (component.variant === "cards") {
      const grid = document.createElement("div");
      grid.className = "row g-2";
      previewModel.items.forEach((entry) => {
        const col = document.createElement("div");
        col.className = "col-12 col-md-6";
        const card = document.createElement("div");
        card.className = "border rounded-3 p-3 bg-body";
        const heading = document.createElement("div");
        heading.className = "fw-semibold";
        heading.textContent = entry.text;
        card.appendChild(heading);
        const detail = document.createElement("div");
        detail.className = "text-body-secondary small";
        if (entry.hasValueBinding) {
          const label = entry.valueLabel || "Value";
          detail.textContent = `${label}: ${entry.badgeText || "—"}`;
        } else {
          detail.textContent = entry.isPlaceholder ? "Repeatable entry" : "Repeatable entry";
        }
        card.appendChild(detail);
        col.appendChild(card);
        grid.appendChild(col);
      });
      control.appendChild(grid);
    } else {
      const list = document.createElement("ul");
      list.className = "list-group";
      previewModel.items.forEach((entry) => {
        const item = document.createElement("li");
        item.className = "list-group-item d-flex justify-content-between align-items-center";
        const labelSpan = document.createElement("span");
        labelSpan.textContent = entry.text;
        item.appendChild(labelSpan);
        if (entry.showBadge) {
          const badge = document.createElement("span");
          badge.className = "badge text-bg-secondary";
          badge.textContent = entry.badgeText || "";
          item.appendChild(badge);
        }
        list.appendChild(item);
      });
      control.appendChild(list);
    }
    return createLabeledField({
      component,
      control,
      labelText,
      labelTag: "div",
      labelClasses: ["fw-semibold", "text-body-secondary"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderDividerPreview(component) {
    const hr = document.createElement("hr");
    hr.className = "my-2";
    hr.style.borderStyle = component.style || "solid";
    hr.style.borderWidth = `${component.thickness || 2}px`;
    const color = component.textColor || component.borderColor || "";
    if (color) {
      hr.style.borderColor = color;
    }
    return hr;
  }

  function renderImagePreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "text-center";
    const img = document.createElement("img");
    img.className = "img-fluid rounded";
    img.src = component.src || "https://placekitten.com/320/180";
    img.alt = component.alt || "Image";
    img.style.objectFit = component.fit === "cover" ? "cover" : "contain";
    img.style.width = "100%";
    if (component.height) {
      img.style.maxHeight = `${component.height}px`;
    }
    wrapper.appendChild(img);
    return wrapper;
  }

  function renderLabelPreview(component) {
    const value = (component.text || "").trim() || getComponentLabel(component, "");
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
      case "grid": {
        const grid = document.createElement("div");
        grid.className = "template-container-grid";
        const columns = clampInteger(component.columns || 2, 1, 4);
        grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
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
      case "rows": {
        const list = document.createElement("div");
        list.className = "d-flex flex-column";
        list.style.gap = `${gap}px`;
        zones.forEach((zone) => {
          list.appendChild(
            createContainerDropzone(component, zone, {
              label: zone.label,
              hint: `Drop components into ${zone.label}`,
            })
          );
        });
        wrapper.appendChild(list);
        break;
      }
      default: {
        const grid = document.createElement("div");
        grid.className = "template-container-grid";
        grid.style.gridTemplateColumns = `repeat(${zones.length || 1}, minmax(0, 1fr))`;
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
    elements.templateDeleteButton = null;
    if (!state.template) {
      const placeholder = document.createElement("p");
      placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
      placeholder.textContent = "Select or create a template to edit its properties.";
      elements.templateProperties.appendChild(placeholder);
      return;
    }

    const metadata = getTemplateMetadata(state.template.id);
    const canEdit = templateAllowsEdits(metadata);
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

    form.appendChild(createTemplateField({ labelText: "Name", control: nameInput, id: "template-title" }));
    form.appendChild(createTemplateField({ labelText: "ID", control: idInput, id: "template-id" }));

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

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-outline-danger w-100";
    deleteButton.textContent = "Delete Template";
    deleteButton.addEventListener("click", () => {
      handleDeleteTemplateRequest();
    });
    applyDeleteTemplateButtonState(deleteButton);

    elements.templateProperties.appendChild(form);
    elements.templateProperties.appendChild(deleteButton);
    elements.templateDeleteButton = deleteButton;
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
    if (component.type === "container") {
      ensureContainerZones(component);
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
      createTextInput(component, "Label", getComponentLabel(component), (value) => {
        updateComponent(component.uid, (draft) => {
          const next = value.trim();
          draft.label = next;
          draft.name = next;
          if (draft.text !== undefined && draft.type === "label") {
            draft.text = next;
          }
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
    }
    if (componentSupportsLabelPosition(component)) {
      appearanceControls.push(createLabelPositionControl(component));
    }
    if (componentHasTextControls(component)) {
      appearanceControls.push(createTextSizeControls(component));
      appearanceControls.push(createTextStyleControls(component));
    }
    if (definition.supportsAlignment !== false && componentHasTextControls(component)) {
      appearanceControls.push(createAlignmentControls(component));
    }
    const appearanceSection = createSection("Appearance", appearanceControls);
    if (appearanceSection) {
      form.appendChild(appearanceSection);
    }

    const behaviorControls = [createCollapsibleToggle(component)];
    if (definition.supportsReadOnly) {
      behaviorControls.push(createReadOnlyToggle(component));
    }
    const behaviorSection = createSection("Behavior", behaviorControls);
    if (behaviorSection) {
      form.appendChild(behaviorSection);
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
    if (component.type === "array") {
      const controls = [
        createBindingFormulaInput(component, {
          labelText: "Source",
          placeholder: "@inventory",
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
          labelText: supportsFormula ? "Binding / Formula" : "Binding",
          supportsBinding,
          supportsFormula,
          allowedFieldCategories: ["array", "object", "string", "number", "boolean"],
        })
      );
      appendRollerControl(controls, component);
      return controls;
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

  function createTextSizeControls(component) {
    const options = [
      { value: "sm", label: "Sm" },
      { value: "md", label: "Md" },
      { value: "lg", label: "Lg" },
      { value: "xl", label: "Xl" },
    ];
    return createRadioButtonGroup(component, "Text size", options, component.textSize || "md", (value) => {
      updateComponent(component.uid, (draft) => {
        draft.textSize = value;
      }, { rerenderCanvas: true });
    });
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

  function createBindingFormulaInput(
    component,
    {
      supportsBinding = true,
      supportsFormula = true,
      labelText = "Binding / Formula",
      placeholder = null,
      bindingKey = "binding",
      formulaKey = "formula",
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
    input.value = getBindingEditorValue(component, { bindingKey, formulaKey });
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
            result = { type: "empty", value: "" };
          } else if (supportsFormula && trimmed.startsWith("=")) {
            const expression = trimmed.slice(1).trim();
            if (formulaKey) {
              draft[formulaKey] = expression;
            }
            if (bindingKey) {
              draft[bindingKey] = "";
            }
            result = { type: "formula", value: expression };
          } else {
            if (bindingKey) {
              draft[bindingKey] = supportsBinding ? trimmed : "";
            }
            if (supportsFormula && formulaKey) {
              draft[formulaKey] = "";
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
      case "array":
        return renderArrayInspector(component);
      case "divider":
        return renderDividerInspector(component);
      case "image":
        return renderImageInspector(component);
      case "label":
        return renderLabelInspector(component);
      case "container":
        return renderContainerInspector(component);
      case "linear-track":
      case "circular-track":
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

  function renderArrayInspector(component) {
    return [
      createRadioButtonGroup(
        component,
        "Layout",
        [
          { value: "list", icon: "tabler:list", label: "List" },
          { value: "cards", icon: "tabler:layout-cards", label: "Cards" },
        ],
        component.variant || "list",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.variant = value;
          }, { rerenderCanvas: true });
        }
      ),
    ];
  }

  function renderDividerInspector(component) {
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Style",
        [
          { value: "solid", label: "Solid" },
          { value: "dashed", label: "Dashed" },
          { value: "dotted", label: "Dotted" },
        ],
        component.style || "solid",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.style = value;
          }, { rerenderCanvas: true });
        }
      )
    );
    controls.push(
      createNumberInput(component, "Thickness", component.thickness || 2, (value) => {
        const next = clampInteger(value ?? 1, 1, 6);
        updateComponent(component.uid, (draft) => {
          draft.thickness = next;
        }, { rerenderCanvas: true, rerenderInspector: true });
      }, { min: 1, max: 6 })
    );
    return controls;
  }

  function renderImageInspector(component) {
    const controls = [];
    controls.push(
      createTextInput(component, "Image URL", component.src || "", (value) => {
        updateComponent(component.uid, (draft) => {
          draft.src = value;
        }, { rerenderCanvas: true });
      }, { placeholder: "https://" })
    );
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
          { value: "contain", label: "Contain" },
          { value: "cover", label: "Cover" },
        ],
        component.fit || "contain",
        (value) => {
          updateComponent(component.uid, (draft) => {
            draft.fit = value;
          }, { rerenderCanvas: true });
        }
      )
    );
    controls.push(
      createNumberInput(component, "Max height (px)", component.height || 180, (value) => {
        const next = clampInteger(value ?? 180, 80, 600);
        updateComponent(component.uid, (draft) => {
          draft.height = next;
        }, { rerenderCanvas: true });
      }, { min: 80, max: 600, step: 10 })
    );
    return controls;
  }

  function renderLabelInspector(component) {
    return [];
  }

  function renderContainerInspector(component) {
    const controls = [];
    controls.push(
      createRadioButtonGroup(
        component,
        "Type",
        [
          { value: "columns", icon: "tabler:columns-3", label: "Columns" },
          { value: "rows", icon: "tabler:layout-rows", label: "Rows" },
          { value: "tabs", icon: "tabler:layout-navbar", label: "Tabs" },
          { value: "grid", icon: "tabler:layout-grid", label: "Grid" },
        ],
        component.containerType || "columns",
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
    }
    if (component.containerType === "columns" || component.containerType === "grid") {
      controls.push(
        createNumberInput(component, "Columns", component.columns || 2, (value) => {
          const next = clampInteger(value ?? 2, 1, 4);
          updateComponent(component.uid, (draft) => {
            draft.columns = next;
            ensureContainerZones(draft);
          }, { rerenderCanvas: true, rerenderInspector: true });
        }, { min: 1, max: 4 })
      );
    }
    if (component.containerType === "rows" || component.containerType === "grid") {
      controls.push(
        createNumberInput(component, "Rows", component.rows || 2, (value) => {
          const next = clampInteger(value ?? 2, 1, 6);
          updateComponent(component.uid, (draft) => {
            draft.rows = next;
            ensureContainerZones(draft);
          }, { rerenderCanvas: true, rerenderInspector: true });
        }, { min: 1, max: 6 })
      );
    }
    controls.push(
      createNumberInput(component, "Gap (px)", component.gap ?? 16, (value) => {
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
    if (merged.type === "linear-track" || merged.type === "circular-track") {
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
    if (merged.type === "container") {
      const zones = merged.zones && typeof merged.zones === "object" ? merged.zones : {};
      Object.keys(zones).forEach((key) => {
        const entries = Array.isArray(zones[key]) ? zones[key].map(hydrateComponent).filter(Boolean) : [];
        zones[key] = entries;
      });
      merged.zones = zones;
      ensureContainerZones(merged);
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

  window.addEventListener("workbench:auth-changed", () => {
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
})();
