import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../lib/data-manager.js";
import {
  createCanvasPlaceholder,
  initPaletteInteractions,
  setupDropzones,
} from "../lib/editor-canvas.js";
import { createCanvasCardElement, createStandardCardChrome } from "../lib/canvas-card.js";
import { createJsonPreviewRenderer } from "../lib/json-preview.js";
import { createRootInsertionHandler } from "../lib/root-inserter.js";
import { expandPane } from "../lib/panes.js";
import { refreshTooltips } from "../lib/tooltips.js";
import { resolveApiBase } from "../lib/api.js";
import { BUILTIN_SYSTEMS, BUILTIN_TEMPLATES } from "../lib/content-registry.js";
import { COMPONENT_ICONS, applyComponentStyles, applyTextFormatting } from "../lib/component-styles.js";
import { collectSystemFields } from "../lib/system-schema.js";
import { listFormulaFunctions } from "../lib/formula-engine.js";

(() => {
  const { status, undoStack } = initAppShell({ namespace: "template" });

  const dataManager = new DataManager({ baseUrl: resolveApiBase() });

  const templateCatalog = new Map();
  const systemCatalog = new Map();

  const FORMULA_FUNCTION_HINTS = {
    abs: "abs(value)",
    avg: "avg(...values)",
    ceil: "ceil(value)",
    clamp: "clamp(value, min, max)",
    floor: "floor(value)",
    if: "if(condition, whenTrue, whenFalse)",
    max: "max(...values)",
    min: "min(...values)",
    mod: "mod(dividend, divisor)",
    not: "not(value)",
    or: "or(...values)",
    and: "and(...values)",
    pow: "pow(base, exponent)",
    round: "round(value)",
    sqrt: "sqrt(value)",
    sum: "sum(...values)",
  };

  const FORMULA_FUNCTIONS = listFormulaFunctions().map((name) => ({
    name,
    signature: FORMULA_FUNCTION_HINTS[name] || `${name}(...)`,
  }));

  registerBuiltinContent();

  const elements = {
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
    deleteTemplateButton: document.querySelector('[data-delete-template]'),
    newTemplateForm: document.querySelector("[data-new-template-form]"),
    newTemplateId: document.querySelector("[data-new-template-id]"),
    newTemplateTitle: document.querySelector("[data-new-template-title]"),
    newTemplateVersion: document.querySelector("[data-new-template-version]"),
    newTemplateSystem: document.querySelector("[data-new-template-system]"),
    rightPane: document.querySelector('[data-pane="right"]'),
    rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
    jsonPreview: document.querySelector("[data-json-preview]"),
    jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
  };

  const insertComponentAtCanvasRoot = createRootInsertionHandler({
    createItem: (type) => {
      if (!COMPONENT_DEFINITIONS[type]) {
        return null;
      }
      return createComponent(type);
    },
    beforeInsert: (type, component) => {
      state.selectedId = component.uid;
      return {
        parentId: "",
        zoneKey: "root",
        index: state.components.length,
        definition: COMPONENT_DEFINITIONS[type],
      };
    },
    insertItem: (type, component, context) => {
      insertComponent(context.parentId, context.zoneKey, context.index, component);
    },
    createUndoEntry: (type, component, context) => ({
      type: "add",
      component: { ...component },
      parentId: context.parentId,
      zoneKey: context.zoneKey,
      index: context.index,
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

  refreshTooltips(document);

  loadSystemRecords();
  loadTemplateRecords();

  if (elements.templateSelect) {
    const builtinOptions = BUILTIN_TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.title }));
    populateSelect(elements.templateSelect, builtinOptions, { placeholder: "Select template" });
    elements.templateSelect.addEventListener("change", async () => {
      const selectedId = elements.templateSelect.value;
      if (!selectedId) {
        state.template = null;
        state.components = [];
        state.selectedId = null;
        containerActiveTabs.clear();
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
        } else {
          const result = await dataManager.get("templates", selectedId, { preferLocal: true });
          payload = result?.payload || null;
        }
        if (!payload) {
          throw new Error("Template payload missing");
        }
        const label = payload.title || metadata.title || selectedId;
        const schema = payload.schema || payload.system || metadata.schema || "";
        registerTemplateRecord(
          { id: payload.id || selectedId, title: label, schema, source: metadata.source || "remote", path: metadata.path },
          { syncOption: true }
        );
        applyTemplateData(payload, { origin: metadata.source || "remote", emitStatus: true, statusMessage: `Loaded ${label}` });
      } catch (error) {
        console.error("Unable to load template", error);
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
      },
      supportsBinding: true,
      supportsFormula: true,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
    array: {
      label: "Array",
      defaults: {
        name: "Array",
        variant: "list",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
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
        activeSegments: [true, true, false, false, false, false],
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
    "circular-track": {
      label: "Circular Track",
      defaults: {
        name: "Circular Track",
        segments: 6,
        activeSegments: [true, true, true, false, false, false],
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: false,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
    "select-group": {
      label: "Select Group",
      defaults: {
        name: "Select Group",
        variant: "pills",
        multiple: false,
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
    toggle: {
      label: "Toggle",
      defaults: {
        name: "Toggle",
        states: ["Novice", "Skilled", "Expert"],
        activeIndex: 1,
        shape: "circle",
      },
      supportsBinding: true,
      supportsFormula: false,
      supportsReadOnly: true,
      supportsAlignment: true,
      textControls: true,
      colorControls: ["foreground", "background", "border"],
    },
  };

  let componentCounter = 0;

  const systemDefinitionCache = new Map();

  const state = {
    template: null,
    components: [],
    selectedId: null,
    systemDefinition: null,
    bindingFields: [],
  };

  const dropzones = new Map();
  const containerActiveTabs = new Map();

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

  function normalizeBindingValue(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }

  function componentHasFormula(component) {
    return typeof component?.formula === "string" && component.formula.trim().length > 0;
  }

  function getBindingEditorValue(component) {
    if (!component) {
      return "";
    }
    if (componentHasFormula(component)) {
      const expression = normalizeBindingValue(component.formula);
      return expression ? `=${expression}` : "";
    }
    return normalizeBindingValue(component.binding);
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

  if (elements.palette) {
    initPaletteInteractions(elements.palette, {
      groupName: "template-canvas",
      dataAttribute: "data-component-type",
      onActivate: ({ value }) => {
        if (!value || !COMPONENT_DEFINITIONS[value]) {
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
      try {
        const result = await dataManager.save("templates", templateId, payload, {
          mode: wantsRemote ? "remote" : "auto",
        });
        const savedToServer = result?.source === "remote";
        state.template.origin = savedToServer ? "remote" : "local";
        registerTemplateRecord(
          {
            id: templateId,
            title: payload.title || templateId,
            schema: payload.schema,
            source: state.template.origin,
          },
          { syncOption: true }
        );
        ensureTemplateSelectValue();
        syncTemplateActions();
        undoStack.push({ type: "save", count: state.components.length });
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
      status.show("Undo coming soon", { type: "info", timeout: 1800 });
    });
  }

  if (elements.redoButton) {
    elements.redoButton.addEventListener("click", () => {
      status.show("Redo coming soon", { type: "info", timeout: 1800 });
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

  if (elements.deleteTemplateButton) {
    elements.deleteTemplateButton.addEventListener("click", async () => {
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
        componentCounter = 0;
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
    });
  }

  if (elements.newTemplateButton) {
    elements.newTemplateButton.addEventListener("click", (event) => {
      if (!elements.newTemplateButton.contains(event.target)) {
        return;
      }
      if (!elements.newTemplateForm) {
        status.show("New template dialog is unavailable right now.", { type: "warning", timeout: 2200 });
        return;
      }
      prepareNewTemplateForm();
      if (newTemplateModalInstance) {
        newTemplateModalInstance.show();
        return;
      }
      const id = window.prompt("Enter a template ID", state.template?.id || "");
      if (!id) {
        return;
      }
      const title = window.prompt("Enter a template title", state.template?.title || "");
      if (!title) {
        return;
      }
      const version = window.prompt("Enter a version", state.template?.version || "0.1") || "0.1";
      const schema = window.prompt("Enter the system ID for this template", state.template?.schema || "");
      if (!schema) {
        status.show("Templates must reference a system.", { type: "warning", timeout: 2400 });
        return;
      }
      startNewTemplate({ id: id.trim(), title: title.trim(), version: version.trim(), schema: schema.trim(), origin: "draft" });
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
      startNewTemplate({ id, title, version, schema, origin: "draft" });
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
      const placeholder = createCanvasPlaceholder(
        "Drag components from the palette into the canvas below to design your template.",
        {
          variant: "root",
        }
      );
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
      components: state.components.map(serializeComponentForPreview),
    };
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
    templateCatalog.set(record.id, next);
    if (syncOption) {
      ensureTemplateOption(record.id, next.title || record.id);
    }
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

  function registerSystemRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const current = systemCatalog.get(record.id) || {};
    const next = { ...current, ...record };
    if (record.payload) {
      next.payload = record.payload;
      systemDefinitionCache.set(record.id, record.payload);
    }
    systemCatalog.set(record.id, next);
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
    state.bindingFields = [];
    if (!schemaId) {
      renderInspector();
      return;
    }
    try {
      const definition = await fetchSystemDefinition(schemaId);
      if (definition) {
        state.systemDefinition = definition;
        state.bindingFields = collectSystemFields(definition);
      }
    } catch (error) {
      console.warn("Template editor: unable to prepare system bindings", error);
    }
    renderInspector();
  }

  function prepareNewTemplateForm() {
    if (!elements.newTemplateForm) {
      return;
    }
    elements.newTemplateForm.reset();
    elements.newTemplateForm.classList.remove("was-validated");
    if (elements.newTemplateVersion) {
      const defaultVersion = elements.newTemplateVersion.getAttribute("value") || "0.1";
      elements.newTemplateVersion.value = defaultVersion;
    }
    refreshNewTemplateSystemOptions();
    if (elements.newTemplateSystem) {
      elements.newTemplateSystem.value = "";
    }
    if (elements.newTemplateId) {
      elements.newTemplateId.focus();
      elements.newTemplateId.select();
    }
  }

  function syncTemplateActions() {
    if (!elements.deleteTemplateButton) {
      return;
    }
    const hasTemplate = Boolean(state.template?.id);
    elements.deleteTemplateButton.classList.toggle("d-none", !hasTemplate);
    if (!hasTemplate) {
      elements.deleteTemplateButton.disabled = true;
      elements.deleteTemplateButton.setAttribute("aria-disabled", "true");
      elements.deleteTemplateButton.removeAttribute("title");
      return;
    }
    const origin = state.template?.origin || "";
    const isBuiltin = origin === "builtin";
    const isDraft = origin === "draft";
    const deletable = !isBuiltin && !isDraft;
    elements.deleteTemplateButton.disabled = !deletable;
    elements.deleteTemplateButton.setAttribute("aria-disabled", deletable ? "false" : "true");
    if (isBuiltin) {
      elements.deleteTemplateButton.title = "Built-in templates cannot be deleted.";
    } else if (isDraft) {
      elements.deleteTemplateButton.title = "Save the template before deleting it.";
    } else {
      elements.deleteTemplateButton.removeAttribute("title");
    }
  }

  function registerBuiltinContent() {
    BUILTIN_TEMPLATES.forEach((template) => {
      registerTemplateRecord(
        { id: template.id, title: template.title, path: template.path, source: "builtin" },
        { syncOption: false }
      );
    });
    BUILTIN_SYSTEMS.forEach((system) => {
      registerSystemRecord({ id: system.id, title: system.title, path: system.path, source: "builtin" });
    });
  }

  async function loadSystemRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("systems");
      localEntries.forEach(({ id, payload }) => {
        registerSystemRecord({ id, title: payload?.title || id, source: "local", payload });
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
      const items = remote?.items || [];
      items.forEach((item) => {
        registerSystemRecord({ id: item.id, title: item.title || item.id, source: "remote" });
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
      localEntries.forEach(({ id, payload }) => {
        registerTemplateRecord(
          { id, title: payload?.title || id, schema: payload?.schema || "", source: "local" },
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
      const items = remote?.items || [];
      items.forEach((item) => {
        registerTemplateRecord(
          { id: item.id, title: item.title || item.id, schema: item.schema || "", source: "remote" },
          { syncOption: true }
        );
      });
    } catch (error) {
      console.warn("Template editor: unable to list templates", error);
    } finally {
      ensureTemplateSelectValue();
    }
  }

  function handleDrop(event) {
    const parentId = event.to.dataset.dropzoneParent || "";
    const zoneKey = event.to.dataset.dropzoneKey || "root";
    const index = typeof event.newIndex === "number" ? event.newIndex : 0;
    const type = event.item.dataset.componentType;
    const componentId = event.item.dataset.componentId;

    if (type && COMPONENT_DEFINITIONS[type]) {
      const component = createComponent(type);
      insertComponent(parentId, zoneKey, index, component);
      state.selectedId = component.uid;
      undoStack.push({ type: "add", component: { ...component }, parentId, zoneKey, index });
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
      const moved = moveComponent(componentId, parentId, zoneKey, index);
      if (moved) {
        undoStack.push({ type: "move", componentId, parentId, zoneKey, index });
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
    undoStack.push({ type: "reorder", componentId, parentId, zoneKey, oldIndex, newIndex });
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
    if (!found) return false;
    const targetCollection = getCollection(targetParentId, zoneKey);
    if (!targetCollection) return false;
    const [item] = found.collection.splice(found.index, 1);
    const safeIndex = Math.min(Math.max(index, 0), targetCollection.length);
    targetCollection.splice(safeIndex, 0, item);
    return true;
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
    if (component.activeSegments && Array.isArray(component.activeSegments)) {
      component.activeSegments = component.activeSegments.slice();
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

    const { header, actions, iconElement } = createStandardCardChrome({
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
    if (bindingLabel) {
      const pill = document.createElement("span");
      pill.className = "template-binding-pill badge text-bg-secondary";
      pill.textContent = bindingLabel;
      if (iconElement && actions.contains(iconElement)) {
        actions.insertBefore(pill, iconElement);
      } else {
        actions.appendChild(pill);
      }
    }

    if (iconElement) {
      iconElement.tabIndex = 0;
    }

    wrapper.appendChild(header);

    const preview = renderComponentPreview(component);
    wrapper.appendChild(preview);

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
    if (!component || component.type !== "container") {
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
        }
      });
    });
  }

  function renderInputPreview(component) {
    const container = document.createElement("div");
    container.className = "d-flex flex-column gap-2";
    const labelText = getComponentLabel(component, "Input");
    if (labelText) {
      const label = document.createElement("label");
      label.className = "form-label mb-1";
      label.textContent = labelText;
      applyTextFormatting(label, component);
      container.appendChild(label);
    }

    let control;
    switch (component.variant) {
      case "number": {
        control = document.createElement("input");
        control.type = "number";
        control.className = "form-control";
        control.placeholder = component.placeholder || "";
        break;
      }
      case "select": {
        control = document.createElement("select");
        control.className = "form-select";
        const options = Array.isArray(component.options) && component.options.length
          ? component.options
          : ["Option A", "Option B"];
        options.forEach((option) => {
          const opt = document.createElement("option");
          opt.textContent = option;
          control.appendChild(opt);
        });
        break;
      }
      case "radio": {
        control = renderChoiceGroup(component, "radio");
        break;
      }
      case "checkbox": {
        control = renderChoiceGroup(component, "checkbox");
        break;
      }
      default: {
        control = document.createElement("input");
        control.type = "text";
        control.className = "form-control";
        control.placeholder = component.placeholder || "";
        break;
      }
    }
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.disabled = !!component.readOnly;
    }
    container.appendChild(control);
    return container;
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
    const container = document.createElement("div");
    container.className = "d-flex flex-column gap-2";
    const headingText = getComponentLabel(component, "Array");
    if (headingText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = headingText;
      applyTextFormatting(heading, component);
      container.appendChild(heading);
    }

    const labelFromBinding = (() => {
      const source = (component.binding || "").replace(/^[=@]/, "");
      if (!source) return "Item";
      const parts = source.split(/[.\[\]]/).filter(Boolean);
      if (!parts.length) return "Item";
      const raw = parts[parts.length - 1].replace(/[-_]+/g, " ").trim();
      if (!raw) return "Item";
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    })();

    if (component.variant === "cards") {
      const grid = document.createElement("div");
      grid.className = "row g-2";
      for (let index = 0; index < 2; index += 1) {
        const col = document.createElement("div");
        col.className = "col-12 col-md-6";
        const card = document.createElement("div");
        card.className = "border rounded-3 p-3 bg-body";
        const itemLabel = `${labelFromBinding} ${index + 1}`;
        card.innerHTML = `<div class=\"fw-semibold\">${itemLabel}</div><div class=\"text-body-secondary small\">Repeatable entry</div>`;
        col.appendChild(card);
        grid.appendChild(col);
      }
      container.appendChild(grid);
    } else {
      const list = document.createElement("ul");
      list.className = "list-group";
      for (let index = 0; index < 3; index += 1) {
        const item = document.createElement("li");
        item.className = "list-group-item d-flex justify-content-between align-items-center";
        item.textContent = `${labelFromBinding} ${index + 1}`;
        const badge = document.createElement("span");
        badge.className = "badge text-bg-secondary";
        badge.textContent = "Value";
        item.appendChild(badge);
        list.appendChild(item);
      }
      container.appendChild(list);
    }
    return container;
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

  function renderLinearTrackPreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const headingText = getComponentLabel(component, "Track");
    if (headingText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = headingText;
      applyTextFormatting(heading, component);
      wrapper.appendChild(heading);
    }

    const track = document.createElement("div");
    track.className = "template-linear-track";
    const activeSegments = ensureSegmentArray(component);
    activeSegments.forEach((isActive, index) => {
      const segment = document.createElement("div");
      segment.className = "template-linear-track__segment";
      if (isActive) {
        segment.classList.add("is-active");
      }
      segment.title = `Segment ${index + 1}`;
      track.appendChild(segment);
    });
    wrapper.appendChild(track);
    return wrapper;
  }

  function renderCircularTrackPreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const headingText = getComponentLabel(component, "Clock");
    if (headingText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = headingText;
      applyTextFormatting(heading, component);
      wrapper.appendChild(heading);
    }

    const circle = document.createElement("div");
    circle.className = "template-circular-track";
    const activeSegments = ensureSegmentArray(component);
    const segments = activeSegments.length || 1;
    const step = 360 / segments;
    const gradientStops = [];
    activeSegments.forEach((isActive, index) => {
      const start = index * step;
      const end = start + step;
      const color = isActive ? "var(--bs-primary)" : "var(--bs-border-color)";
      gradientStops.push(`${color} ${start}deg ${end}deg`);
    });
    circle.style.background = `conic-gradient(${gradientStops.join(", ")})`;
    const mask = document.createElement("div");
    mask.className = "template-circular-track__mask";
    circle.appendChild(mask);
    const value = document.createElement("div");
    value.className = "template-circular-track__value";
    value.textContent = `${activeSegments.filter(Boolean).length}/${segments}`;
    circle.appendChild(value);
    wrapper.appendChild(circle);
    return wrapper;
  }

  function renderSelectGroupComponentPreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const headingText = getComponentLabel(component, "Select");
    if (headingText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = headingText;
      applyTextFormatting(heading, component);
      wrapper.appendChild(heading);
    }

    const sampleOptions = ["Option A", "Option B", "Option C"];
    let control;
    if (component.variant === "tags") {
      control = document.createElement("div");
      control.className = "template-select-tags d-flex flex-wrap gap-2";
      sampleOptions.forEach((option, index) => {
        const tag = document.createElement("span");
        tag.className = "template-select-tag";
        const slug = option.trim().toLowerCase().replace(/\s+/g, "-");
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
      sampleOptions.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        const isActive = component.multiple ? index < 2 : index === 0;
        button.className = `btn btn-outline-secondary${isActive ? " active" : ""}`;
        if (component.readOnly) {
          button.classList.add("disabled");
        }
        button.textContent = option;
        control.appendChild(button);
      });
    } else {
      control = document.createElement("div");
      control.className = "d-flex flex-wrap gap-2";
      sampleOptions.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        const isActive = component.multiple ? index < 2 : index === 0;
        button.className = `btn btn-outline-secondary btn-sm rounded-pill${isActive ? " active" : ""}`;
        if (component.readOnly) {
          button.classList.add("disabled");
        }
        button.textContent = option;
        control.appendChild(button);
      });
    }
    wrapper.appendChild(control);
    return wrapper;
  }

  function renderTogglePreview(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const headingText = getComponentLabel(component, "Toggle");
    if (headingText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold";
      heading.textContent = headingText;
      applyTextFormatting(heading, component);
      wrapper.appendChild(heading);
    }

    const states = Array.isArray(component.states) && component.states.length
      ? component.states
      : ["State 1", "State 2"];
    const shape = component.shape || "circle";
    const activeIndex = Math.max(0, Math.min(component.activeIndex ?? 0, states.length - 1));
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
    preview.setAttribute("aria-label", states[activeIndex] || "Toggle state");
    wrapper.appendChild(preview);

    return wrapper;
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

  function clearCanvas() {
    if (!state.components.length) {
      status.show("Canvas is already empty", { timeout: 1200 });
      return;
    }
    state.components = [];
    state.selectedId = null;
    containerActiveTabs.clear();
    undoStack.push({ type: "clear" });
    status.show("Cleared template canvas", { type: "info", timeout: 1500 });
    renderCanvas();
    renderInspector();
  }

  function removeComponent(uid) {
    const found = findComponent(uid);
    if (!found) return;
    const [removed] = found.collection.splice(found.index, 1);
    pruneContainerState(removed);
    undoStack.push({ type: "remove", componentId: removed.uid, parentId: found.parent?.uid || "", zoneKey: found.zoneKey });
    status.show("Removed component", { type: "info", timeout: 1500 });
    if (state.selectedId === uid) {
      state.selectedId = found.parent?.uid || null;
    }
    renderCanvas();
    renderInspector();
  }

  function applyTemplateData(data = {}, { origin = "draft", emitStatus = false, statusMessage = "" } = {}) {
    const template = createBlankTemplate({
      id: data.id || "",
      title: data.title || "",
      version: data.version || data.metadata?.version || "0.1",
      schema: data.schema || data.system || "",
      origin,
    });
    componentCounter = 0;
    const components = Array.isArray(data.components)
      ? data.components.map((component) => hydrateComponent(component)).filter(Boolean)
      : [];
    state.template = template;
    state.components = components;
    state.selectedId = null;
    containerActiveTabs.clear();
    renderCanvas();
    renderInspector();
    ensureTemplateSelectValue();
    updateSystemContext(template.schema).catch(() => {});
    if (emitStatus && statusMessage) {
      status.show(statusMessage, { type: "success", timeout: 2000 });
    }
  }

  function startNewTemplate({ id = "", title = "", version = "0.1", schema = "", origin = "draft" } = {}) {
    const trimmedId = (id || "").trim();
    const trimmedTitle = (title || "").trim();
    const trimmedSchema = (schema || "").trim();
    if (!trimmedId || !trimmedTitle || !trimmedSchema) {
      status.show("Provide an ID, title, and system for the template.", { type: "warning", timeout: 2200 });
      return;
    }
    registerTemplateRecord(
      { id: trimmedId, title: trimmedTitle, schema: trimmedSchema, source: origin },
      { syncOption: true }
    );
    applyTemplateData(
      { id: trimmedId, title: trimmedTitle, version, schema: trimmedSchema, components: [] },
      { origin, emitStatus: true, statusMessage: `Started ${trimmedTitle || trimmedId}` }
    );
  }

  function renderInspector() {
    if (!elements.inspector) return;
    elements.inspector.innerHTML = "";
    const selection = findComponent(state.selectedId);
    const component = selection?.component;
    if (!component) {
      const placeholder = document.createElement("p");
      placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
      placeholder.textContent = "Select a component on the canvas to edit its settings.";
      elements.inspector.appendChild(placeholder);
      return;
    }
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

    const dataControls = [];
    if (definition.supportsBinding !== false || definition.supportsFormula !== false) {
      dataControls.push(
        createBindingFormulaInput(component, {
          supportsBinding: definition.supportsBinding !== false,
          supportsFormula: definition.supportsFormula !== false,
        })
      );
    }
    const dataSection = createSection("Data", dataControls);
    if (dataSection) {
      form.appendChild(dataSection);
    }

    const appearanceControls = [];
    const colorControls = getColorControls(component);
    if (colorControls.length) {
      appearanceControls.push(createColorRow(component, colorControls));
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

    if (definition.supportsReadOnly) {
      const behaviorSection = createSection("Behavior", [createReadOnlyToggle(component)]);
      if (behaviorSection) {
        form.appendChild(behaviorSection);
      }
    }

    elements.inspector.appendChild(form);
    refreshTooltips(elements.inspector);
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
    return createInspectorToggleGroup(component, "Text style", options, component.textStyles || {}, (key, checked) => {
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

  function createBindingFormulaInput(component, { supportsBinding = true, supportsFormula = true } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-1";
    const id = toId([component.uid, "binding-formula"]);
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.setAttribute("for", id);
    label.textContent = "Binding / Formula";

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "position-relative";

    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = id;
    input.placeholder = supportsFormula
      ? "@attributes.score or =sum(@attributes.strength, @attributes.dexterity)"
      : "@attributes.score";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = getBindingEditorValue(component);
    input.setAttribute("aria-autocomplete", "list");

    const suggestions = document.createElement("div");
    suggestions.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    suggestions.id = `${id}-suggestions`;
    suggestions.setAttribute("role", "listbox");
    input.setAttribute("aria-controls", suggestions.id);

    inputWrapper.append(input, suggestions);
    wrapper.append(label, inputWrapper);

    const MAX_SUGGESTIONS = 12;
    let suggestionItems = [];
    let activeIndex = -1;
    let currentContext = null;

    function closeSuggestions() {
      suggestionItems = [];
      activeIndex = -1;
      currentContext = null;
      suggestions.innerHTML = "";
      suggestions.classList.add("d-none");
      input.removeAttribute("aria-activedescendant");
    }

    function setActive(index) {
      if (!suggestionItems.length) {
        return;
      }
      const clamped = Math.max(0, Math.min(index, suggestionItems.length - 1));
      activeIndex = clamped;
      const options = Array.from(suggestions.querySelectorAll("[data-suggestion-index]"));
      options.forEach((option) => {
        const optionIndex = Number(option.dataset.suggestionIndex);
        if (optionIndex === activeIndex) {
          option.classList.add("active");
          input.setAttribute("aria-activedescendant", option.id);
        } else {
          option.classList.remove("active");
        }
      });
    }

    function moveActive(delta) {
      if (!suggestionItems.length) {
        return;
      }
      const nextIndex = activeIndex < 0 ? 0 : activeIndex + delta;
      setActive(nextIndex);
    }

    function getFieldSuggestions(query = "") {
      if (!supportsBinding) {
        return [];
      }
      const normalized = query.trim().toLowerCase();
      const entries = Array.isArray(state.bindingFields) ? state.bindingFields : [];
      const filtered = normalized
        ? entries.filter((entry) => {
            const path = entry.path?.toLowerCase?.() || "";
            const labelText = entry.label?.toLowerCase?.() || "";
            return path.includes(normalized) || labelText.includes(normalized);
          })
        : entries;
      return filtered.slice(0, MAX_SUGGESTIONS).map((entry) => ({
        type: "field",
        path: entry.path,
        display: `@${entry.path}`,
        description: entry.label && entry.label !== entry.path ? entry.label : "",
      }));
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

    function renderSuggestions(items, context) {
      suggestionItems = items;
      currentContext = context;
      suggestions.innerHTML = "";
      if (!items.length) {
        closeSuggestions();
        return;
      }
      items.forEach((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
        option.dataset.suggestionIndex = String(index);
        option.id = `${suggestions.id}-option-${index}`;
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => {
          applySuggestion(index);
        });

        const title = document.createElement("span");
        title.textContent = item.display;
        option.appendChild(title);
        if (item.description) {
          const hint = document.createElement("small");
          hint.className = "text-body-secondary ms-2";
          hint.textContent = item.description;
          option.appendChild(hint);
        }
        suggestions.appendChild(option);
      });
      suggestions.classList.remove("d-none");
      setActive(0);
    }

    function updateSuggestions() {
      const value = input.value;
      const caret = typeof input.selectionStart === "number" ? input.selectionStart : value.length;
      const beforeCaret = value.slice(0, caret);

      if (supportsBinding) {
        const atIndex = beforeCaret.lastIndexOf("@");
        if (atIndex !== -1) {
          const query = beforeCaret.slice(atIndex + 1);
          const items = getFieldSuggestions(query);
          if (items.length) {
            renderSuggestions(items, { type: "field", startIndex: atIndex + 1, endIndex: caret });
            return;
          }
        }
      }

      if (supportsFormula && value.trim().startsWith("=")) {
        const equalsIndex = value.indexOf("=");
        if (equalsIndex !== -1 && caret >= equalsIndex + 1) {
          const rawQuery = value.slice(equalsIndex + 1, caret);
          const items = getFunctionSuggestions(rawQuery);
          if (items.length) {
            renderSuggestions(items, { type: "function", startIndex: equalsIndex + 1, endIndex: caret });
            return;
          }
        }
      }

      closeSuggestions();
    }

    function applySuggestion(index) {
      if (index < 0 || index >= suggestionItems.length || !currentContext) {
        return;
      }
      const item = suggestionItems[index];
      const value = input.value;
      const start = currentContext.startIndex;
      const end = currentContext.endIndex;
      const before = value.slice(0, start);
      const after = value.slice(end);
      if (item.type === "field") {
        const inserted = item.path;
        const nextValue = `${before}${inserted}${after}`;
        input.value = nextValue;
        const caret = before.length + inserted.length;
        input.setSelectionRange(caret, caret);
      } else if (item.type === "function") {
        const prefix = value.slice(0, start);
        const suffix = value.slice(end);
        const nextValue = `${prefix}${item.name}()${suffix}`;
        input.value = nextValue;
        const caret = prefix.length + item.name.length + 1;
        input.setSelectionRange(caret, caret);
      }
      commitValue(input.value);
      closeSuggestions();
    }

    function commitValue(raw) {
      const next = typeof raw === "string" ? raw : "";
      updateComponent(
        component.uid,
        (draft) => {
          const trimmed = next.trim();
          if (!trimmed) {
            draft.binding = "";
            if (supportsFormula && Object.prototype.hasOwnProperty.call(draft, "formula")) {
              draft.formula = "";
            }
            return;
          }
          if (supportsFormula && trimmed.startsWith("=")) {
            const expression = trimmed.slice(1).trim();
            if (Object.prototype.hasOwnProperty.call(draft, "formula")) {
              draft.formula = expression;
            } else if (supportsFormula) {
              draft.formula = expression;
            }
            draft.binding = "";
            return;
          }
          if (supportsBinding) {
            draft.binding = trimmed;
          } else {
            draft.binding = "";
          }
          if (supportsFormula && Object.prototype.hasOwnProperty.call(draft, "formula")) {
            draft.formula = "";
          }
        },
        { rerenderCanvas: true }
      );
    }

    input.addEventListener("input", () => {
      commitValue(input.value);
      updateSuggestions();
    });

    input.addEventListener("focus", () => {
      updateSuggestions();
    });

    input.addEventListener("click", () => {
      updateSuggestions();
    });

    input.addEventListener("keydown", (event) => {
      if (!suggestionItems.length) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeIndex >= 0) {
          applySuggestion(activeIndex);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSuggestions();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        closeSuggestions();
      }, 120);
    });

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
      createNumberInput(component, "Segments", component.segments ?? 6, (value) => {
        const next = clampInteger(value ?? 6, 1, 16);
        updateComponent(component.uid, (draft) => {
          setSegmentCount(draft, next);
        }, { rerenderCanvas: true, rerenderInspector: true });
      }, { min: 1, max: 16 })
    );
    controls.push(createSegmentControls(component));
    return controls;
  }

  function createSegmentControls(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = "Active segments";
    wrapper.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "template-segment-grid";
    const segments = ensureSegmentArray(component);
    const columnCount = Math.max(1, Math.min(segments.length, 8));
    grid.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
    segments.forEach((isActive, index) => {
      const id = toId([component.uid, "segment", index]);
      const cell = document.createElement("div");
      cell.className = "template-segment-grid__item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "btn-check";
      input.id = id;
      input.checked = isActive;
      input.addEventListener("change", () => {
        updateComponent(component.uid, (draft) => {
          const target = ensureSegmentArray(draft);
          target[index] = input.checked;
        }, { rerenderCanvas: true });
      });
      const label = document.createElement("label");
      label.className = "btn btn-outline-secondary btn-sm";
      label.setAttribute("for", id);
      label.textContent = index + 1;
      cell.append(input, label);
      grid.appendChild(cell);
    });
    wrapper.appendChild(grid);
    return wrapper;
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
          }, { rerenderCanvas: true });
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
    controls.push(...createToggleStateEditors(component));
    return controls;
  }

  function createToggleStateEditors(component) {
    const controls = [];
    const textareaId = toId([component.uid, "toggle", "states"]);
    const textareaWrapper = document.createElement("div");
    textareaWrapper.className = "d-flex flex-column";
    const textareaLabel = document.createElement("label");
    textareaLabel.className = "form-label fw-semibold text-body-secondary";
    textareaLabel.setAttribute("for", textareaId);
    textareaLabel.textContent = "States (one per line)";
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.id = textareaId;
    textarea.rows = 3;
    textarea.placeholder = "Novice\nSkilled\nExpert";
    const initialStates = Array.isArray(component.states) && component.states.length
      ? component.states
      : ["State 1", "State 2"];
    textarea.value = initialStates.join("\n");
    textareaWrapper.append(textareaLabel, textarea);
    controls.push(textareaWrapper);

    const selectId = toId([component.uid, "toggle", "active-state"]);
    const selectWrapper = document.createElement("div");
    selectWrapper.className = "d-flex flex-column";
    const selectLabel = document.createElement("label");
    selectLabel.className = "form-label fw-semibold text-body-secondary";
    selectLabel.setAttribute("for", selectId);
    selectLabel.textContent = "Active state";
    const select = document.createElement("select");
    select.className = "form-select";
    select.id = selectId;
    selectWrapper.append(selectLabel, select);
    controls.push(selectWrapper);

    const syncStateOptions = () => {
      const states = Array.isArray(component.states) && component.states.length
        ? component.states
        : ["State 1", "State 2"];
      select.innerHTML = "";
      states.forEach((state, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = state;
        select.appendChild(option);
      });
      const safeIndex = clampInteger(component.activeIndex ?? 0, 0, states.length - 1);
      select.value = String(safeIndex);
    };

    textarea.addEventListener("input", () => {
      updateComponent(component.uid, (draft) => {
        draft.states = parseLines(textarea.value);
        if (!Array.isArray(draft.states) || !draft.states.length) {
          draft.states = ["State 1", "State 2"];
        }
        if (draft.activeIndex === undefined || draft.activeIndex === null) {
          draft.activeIndex = 0;
        }
        draft.activeIndex = clampInteger(draft.activeIndex, 0, draft.states.length - 1);
      }, { rerenderCanvas: true });
      syncStateOptions();
    });

    select.addEventListener("change", () => {
      const nextIndex = Number(select.value);
      updateComponent(component.uid, (draft) => {
        draft.activeIndex = clampInteger(nextIndex, 0, (draft.states?.length || 1) - 1);
      }, { rerenderCanvas: true });
      syncStateOptions();
    });

    syncStateOptions();
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

  function ensureSegmentArray(component) {
    const baseLength = Array.isArray(component.activeSegments) ? component.activeSegments.length : 0;
    const desired = clampInteger(
      component.segments ?? (baseLength || 6),
      1,
      16
    );
    if (!Array.isArray(component.activeSegments)) {
      component.activeSegments = Array.from({ length: desired }, (_, index) => index === 0);
    }
    if (component.activeSegments.length < desired) {
      const needed = desired - component.activeSegments.length;
      component.activeSegments.push(...Array.from({ length: needed }, () => false));
    } else if (component.activeSegments.length > desired) {
      component.activeSegments = component.activeSegments.slice(0, desired);
    }
    return component.activeSegments;
  }

  function setSegmentCount(component, next) {
    component.segments = next;
    ensureSegmentArray(component);
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
    if (merged.type === "container") {
      const zones = merged.zones && typeof merged.zones === "object" ? merged.zones : {};
      Object.keys(zones).forEach((key) => {
        const entries = Array.isArray(zones[key]) ? zones[key].map(hydrateComponent).filter(Boolean) : [];
        zones[key] = entries;
      });
      merged.zones = zones;
      ensureContainerZones(merged);
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

  function createBlankTemplate({ id = "", title = "", version = "0.1", schema = "", origin = "draft" } = {}) {
    return {
      id: id || "",
      title: title || "",
      version: version || "0.1",
      schema: schema || "",
      origin,
    };
  }

  function ensureTemplateOption(id, label) {
    if (!elements.templateSelect || !id) {
      return;
    }
    const escaped = escapeCss(id);
    let option = escaped ? elements.templateSelect.querySelector(`option[value="${escaped}"]`) : null;
    if (!option) {
      option = document.createElement("option");
      option.value = id;
      elements.templateSelect.appendChild(option);
    }
    option.textContent = label || id;
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
})();
