import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../lib/data-manager.js";
import { initAuthControls } from "../lib/auth-ui.js";
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
import { initHelpSystem } from "../lib/help.js";
import {
  listBuiltinSystems,
  markBuiltinMissing,
  markBuiltinAvailable,
  applyBuiltinCatalog,
  verifyBuiltinAsset,
} from "../lib/content-registry.js";
import { initTierGate, initTierVisibility } from "../lib/access.js";
import { collectSystemFields } from "../lib/system-schema.js";
import { attachFormulaAutocomplete } from "../lib/formula-autocomplete.js";
import { listFormulaFunctionMetadata } from "../lib/formula-metadata.js";
import { resolveFieldTypeMeta } from "../lib/field-type-meta.js";

(async () => {
  const { status, undoStack, undo, redo } = initAppShell({
    namespace: "system",
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
    requiredTier: "creator",
    gateSelector: "[data-tier-gate]",
    contentSelector: "[data-tier-content]",
    onGranted: () => window.location.reload(),
    onRevoked: () => window.location.reload(),
  });

  if (!gate.allowed) {
    return;
  }

  const systemCatalog = new Map();

  await initializeBuiltins();

  const TYPE_DEFS = {
    string: {
      label: "String",
      icon: "tabler:forms",
      description: "Free-form text value",
      palette: true,
    },
    number: {
      label: "Number",
      icon: "tabler:hash",
      description: "Numeric value with limits",
      palette: true,
    },
    boolean: {
      label: "Boolean",
      icon: "tabler:toggle-left",
      description: "True or false value",
      palette: true,
    },
    object: {
      label: "Object",
      icon: "tabler:braces",
      description: "Keyed set of fields",
      palette: true,
    },
    array: {
      label: "Array",
      icon: "tabler:brackets",
      description: "Repeatable entries",
      palette: true,
    },
  };

  const TYPE_ALIASES = {
    integer: "number",
  };

  const TYPE_OPTIONS = ["string", "number", "boolean", "object", "array"];

  const MAX_FORMULA_SUGGESTIONS = 12;
  const FORMULA_FUNCTIONS = listFormulaFunctionMetadata();

  function normalizeType(type) {
    if (!type) return "string";
    const raw = String(type).trim().toLowerCase();
    const key = raw in TYPE_DEFS ? raw : TYPE_ALIASES[raw] || raw;
    if (TYPE_DEFS[key]) {
      return key;
    }
    return "string";
  }

  function isNumericType(type) {
    return normalizeType(type) === "number";
  }

  const elements = {
    select: document.querySelector("[data-system-select]"),
    canvasRoot: document.querySelector("[data-canvas-root]"),
    palette: document.querySelector("[data-palette]"),
    inspector: document.querySelector("[data-inspector]"),
    saveButton: document.querySelector('[data-action="save-system"]'),
    undoButton: document.querySelector('[data-action="undo-system"]'),
    redoButton: document.querySelector('[data-action="redo-system"]'),
    newButton: document.querySelector('[data-action="new-system"]'),
    duplicateButton: document.querySelector('[data-action="duplicate-system"]'),
    deleteButton: document.querySelector('[data-delete-system]'),
    clearButton: document.querySelector('[data-action="clear-canvas"]'),
    importButton: document.querySelector('[data-action="import-system"]'),
    exportButton: document.querySelector('[data-action="export-system"]'),
    jsonPreview: document.querySelector("[data-json-preview]"),
    jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
    rightPane: document.querySelector('[data-pane="right"]'),
    rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
    newSystemModal: document.getElementById("new-system-modal"),
    newSystemForm: document.querySelector("[data-new-system-form]"),
    newSystemId: document.querySelector("[data-new-system-id]"),
    newSystemTitle: document.querySelector("[data-new-system-title]"),
    newSystemVersion: document.querySelector("[data-new-system-version]"),
    newSystemModalTitle: document.querySelector("[data-new-system-modal-title]"),
    systemMeta: document.querySelector("[data-system-meta]"),
  };

  refreshTooltips(document);

  let pendingSharedSystemId = resolveSharedRecordParam("systems");

  loadSystemRecords();
  initializeSharedSystemHandling();

  const state = {
    system: createBlankSystem(),
    selectedNodeId: null,
    selectedDefinitionId: null,
  };

  let lastSavedSystemSignature = null;

  markSystemClean(state.system);

  function hasActiveSystem() {
    return Boolean(state.system && (state.system.id || state.system.title));
  }

  const insertFieldAtCanvasRoot = createRootInsertionHandler({
    createItem: (type) => {
      const normalized = normalizeType(type);
      return applyFieldIdentity(createFieldNode(normalized));
    },
    beforeInsert: (type, node) => {
      const parentId = "root";
      const collection = getCollection(parentId);
      const index = collection ? collection.length : 0;
      const previousSelectedId = state.selectedNodeId || null;
      state.selectedNodeId = node.id;
      return { parentId, index, type: normalizeType(type), previousSelectedId };
    },
    insertItem: (type, node, context) => {
      insertNode(context.parentId, context.index, node);
    },
    createUndoEntry: (type, node, context) => ({
      type: "add",
      systemId: state.system?.id || "",
      node: cloneNode(node),
      parentId: context.parentId,
      index: context.index,
      previousSelectedId: context.previousSelectedId || null,
    }),
    afterInsert: () => {
      renderAll();
      expandInspectorPane();
    },
    undoStack,
    status,
    getStatusMessage: (type, node, context) => ({
      message: `Added ${TYPE_DEFS[context.type]?.label || context.type} field`,
      options: { timeout: 1500 },
    }),
  });

  const drafts = new Map();

  const dropzones = new Map();
  const typeCounters = new Map();

  function cloneNode(node) {
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(node);
      } catch (error) {
        // ignore structuredClone errors and fall back
      }
    }
    return JSON.parse(JSON.stringify(node));
  }

  function cloneNodeCollection(nodes) {
    return Array.isArray(nodes) ? nodes.map((node) => cloneNode(node)) : [];
  }

  function cloneValue(value) {
    if (value === undefined || value === null) {
      return value;
    }
    if (typeof value !== "object") {
      return value;
    }
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (error) {
        // ignore structuredClone errors and fall back
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      if (Array.isArray(value)) {
        return value.slice();
      }
      return { ...value };
    }
  }

  function cloneDefinition(definition) {
    if (!definition) {
      return null;
    }
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(definition);
      } catch (error) {
        // ignore structuredClone errors
      }
    }
    try {
      return JSON.parse(JSON.stringify(definition));
    } catch (error) {
      const copy = { ...definition };
      if (Array.isArray(definition.children)) {
        copy.children = definition.children.map((child) => cloneNode(child));
      }
      return copy;
    }
  }

  function cloneDefinitionMap(definitions) {
    if (!definitions || typeof definitions !== "object") {
      return {};
    }
    const output = {};
    Object.entries(definitions).forEach(([key, definition]) => {
      if (!key) {
        return;
      }
      output[key] = cloneDefinition(definition);
    });
    return output;
  }

  function areValuesEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (Number.isNaN(a) && Number.isNaN(b)) {
      return true;
    }
    if (a == null || b == null) {
      return a === b;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) {
        return false;
      }
      if (a.length !== b.length) {
        return false;
      }
      for (let index = 0; index < a.length; index += 1) {
        if (!areValuesEqual(a[index], b[index])) {
          return false;
        }
      }
      return true;
    }
    if (typeof a === "object" && typeof b === "object") {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) {
        return false;
      }
      for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) {
          return false;
        }
        if (!areValuesEqual(a[key], b[key])) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  const renderPreview = createJsonPreviewRenderer({
    resolvePreviewElement: () => elements.jsonPreview,
    resolveBytesElement: () => elements.jsonPreviewBytes,
    serialize: () => serializeSystem(state.system),
    onAfterRender: () => {
      rememberDraft(state.system);
    },
  });

  rebuildFieldIdentities(state.system);
  if (elements.palette) {
    initPaletteInteractions(elements.palette, {
      groupName: "system-canvas",
      dataAttribute: "data-palette-type",
      onActivate: ({ value }) => {
        if (!value) {
          return;
        }
        if (!hasActiveSystem()) {
          status.show("Create or load a system before adding fields.", {
            type: "warning",
            timeout: 2400,
          });
          return;
        }
        const metadata = getSystemMetadata(state.system?.id);
        if (!systemAllowsEdits(metadata)) {
          const message = describeSystemEditRestriction(metadata);
          status.show(message, { type: "warning", timeout: 2800 });
          return;
        }
        if (!dataManager.hasWriteAccess("systems")) {
          const required = dataManager.describeRequiredWriteTier("systems");
          const message = required
            ? `Saving systems requires a ${required} tier.`
            : "Your tier cannot save systems.";
          status.show(message, { type: "warning", timeout: 2800 });
          return;
        }
        insertFieldAtCanvasRoot(value);
      },
    });
  }

  let newSystemModalInstance = null;
  if (elements.newSystemModal && window.bootstrap && typeof window.bootstrap.Modal === "function") {
    newSystemModalInstance = new window.bootstrap.Modal(elements.newSystemModal);
    elements.newSystemModal.addEventListener("shown.bs.modal", () => {
      if (elements.newSystemId) {
        elements.newSystemId.focus();
        elements.newSystemId.select();
      }
    });
  }

  let systemCreationContext = { mode: "new", duplicateSystem: null, sourceTitle: "" };

  if (elements.select) {
    populateSelect(
      elements.select,
      listBuiltinSystems().map((system) => ({ value: system.id, label: system.title })),
      { placeholder: "Select system" }
    );
    elements.select.addEventListener("change", async () => {
      persistCurrentDraft();
      const selectedId = elements.select.value;
      if (!selectedId) {
        return;
      }
      if (state.system.id === selectedId && state.system.origin !== "draft") {
        return;
      }

      const draft = restoreDraft(selectedId);
      if (draft) {
        applySystemState(draft, { emitStatus: true, statusMessage: `Restored ${draft.title || selectedId}` });
        return;
      }

      const metadata = systemCatalog.get(selectedId);
      if (!metadata) {
        const fallback = createBlankSystem({ id: selectedId, title: selectedId, origin: "draft" });
        registerSystemRecord({ id: fallback.id, title: fallback.title, source: "draft" }, { syncOption: true });
        applySystemState(fallback, { emitStatus: true, statusMessage: `Loaded ${fallback.title}` });
        return;
      }
      if (metadata.source === "draft") {
        const fallback = createBlankSystem({ id: metadata.id, title: metadata.title, origin: "draft" });
        applySystemState(fallback, { emitStatus: true, statusMessage: `Loaded ${fallback.title}` });
        return;
      }
      try {
        let payload = null;
        if (metadata.source === "builtin" && metadata.path) {
          const response = await fetch(metadata.path);
          payload = await response.json();
          markBuiltinAvailable("systems", metadata.id || selectedId);
        } else {
          const shareToken = metadata.shareToken || "";
          const result = await dataManager.get("systems", selectedId, {
            preferLocal: !shareToken,
            shareToken,
          });
          payload = result?.payload || null;
        }
        if (!payload) {
          throw new Error("System payload missing");
        }
        const label = payload.title || metadata.title || selectedId;
        registerSystemRecord(
          {
            id: payload.id || selectedId,
            title: label,
            source: metadata.source || "remote",
            path: metadata.path,
            shareToken: metadata.shareToken,
          },
          { syncOption: true }
        );
        applySystemData(payload, {
          origin: metadata.source || "remote",
          emitStatus: true,
          statusMessage: `Loaded ${label}`,
          shareToken: metadata.shareToken || "",
        });
      } catch (error) {
        console.error("Unable to load system", error);
        if (metadata.source === "builtin") {
          markBuiltinMissing("systems", metadata.id || selectedId);
        }
        status.show("Failed to load system", { type: "error", timeout: 2500 });
        ensureSelectValue();
      }
    });
  }

  if (elements.newButton) {
    elements.newButton.addEventListener("click", () => {
      if (newSystemModalInstance && elements.newSystemForm) {
        prepareNewSystemForm({ mode: "new" });
        newSystemModalInstance.show();
        return;
      }

      const id = window.prompt("Enter a system ID", state.system.id || "");
      if (id === null) {
        return;
      }
      const title = window.prompt("Enter a system title", state.system.title || "");
      if (title === null) {
        return;
      }
      const version = window.prompt("Enter a version", state.system.version || "0.1") || "0.1";
      startNewSystem({
        id: id.trim(),
        title: title.trim(),
        version: (version || "0.1").trim() || "0.1",
        origin: "draft",
      });
    });
  }

  if (elements.duplicateButton) {
    elements.duplicateButton.addEventListener("click", () => {
      if (!hasActiveSystem()) {
        return;
      }
      const sourceSystem = cloneSystem(state.system);
      sourceSystem.shareToken = "";
      const sourceTitle = state.system.title || state.system.id || "system";
      if (newSystemModalInstance && elements.newSystemForm) {
        prepareNewSystemForm({ mode: "duplicate", seedSystem: state.system });
        newSystemModalInstance.show();
        return;
      }
      const suggestedId = generateDuplicateSystemId(state.system.id || state.system.title || "system");
      const idInput = window.prompt("Enter a system ID", suggestedId || state.system.id || "");
      if (!idInput) {
        return;
      }
      const suggestedTitle = generateDuplicateSystemTitle(state.system.title || state.system.id || "System");
      const titleInput = window.prompt("Enter a system title", suggestedTitle) || "";
      if (!titleInput) {
        return;
      }
      const versionInput = window.prompt("Enter a version", state.system.version || "0.1") || state.system.version || "0.1";
      startNewSystem({
        id: idInput.trim(),
        title: titleInput.trim(),
        version: (versionInput || "0.1").trim() || "0.1",
        origin: "draft",
        sourceSystem,
        markClean: false,
        statusMessage: `Duplicated ${sourceTitle}`,
      });
    });
  }

  if (elements.newSystemForm) {
    elements.newSystemForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = elements.newSystemForm;
      if (typeof form.reportValidity === "function" && !form.reportValidity()) {
        form.classList.add("was-validated");
        return;
      }

      const id = (elements.newSystemId?.value || "").trim();
      const title = (elements.newSystemTitle?.value || "").trim();
      const version = ((elements.newSystemVersion?.value || "0.1").trim() || "0.1");

      if (!id || !title) {
        form.classList.add("was-validated");
        return;
      }

      const mode = form.dataset.mode || systemCreationContext.mode || "new";
      const isDuplicate = mode === "duplicate" && systemCreationContext.mode === "duplicate";
      const sourceSystem = isDuplicate && systemCreationContext.duplicateSystem
        ? cloneSystem(systemCreationContext.duplicateSystem)
        : null;
      const sourceTitle = systemCreationContext.sourceTitle || state.system.title || state.system.id || title;
      startNewSystem({
        id,
        title,
        version,
        origin: "draft",
        sourceSystem,
        markClean: !isDuplicate,
        statusMessage: isDuplicate ? `Duplicated ${sourceTitle}` : `Started ${title || id}`,
      });
      systemCreationContext = { mode: "new", duplicateSystem: null, sourceTitle: "" };
      form.dataset.mode = "new";
      if (newSystemModalInstance) {
        newSystemModalInstance.hide();
      }
      form.reset();
      form.classList.remove("was-validated");
    });
  }

  function prepareNewSystemForm({ mode = "new", seedSystem = null } = {}) {
    if (!elements.newSystemForm) {
      return;
    }
    const isDuplicate = mode === "duplicate" && seedSystem;
    systemCreationContext = {
      mode: isDuplicate ? "duplicate" : "new",
      duplicateSystem: isDuplicate ? cloneSystem(seedSystem) : null,
      sourceTitle: isDuplicate ? seedSystem?.title || seedSystem?.id || "" : "",
    };
    elements.newSystemForm.reset();
    elements.newSystemForm.classList.remove("was-validated");
    elements.newSystemForm.dataset.mode = systemCreationContext.mode;
    if (elements.newSystemModalTitle) {
      elements.newSystemModalTitle.textContent = isDuplicate ? "Duplicate System" : "Create New System";
    }
    const defaultVersion = elements.newSystemVersion?.getAttribute("value") || "0.1";
    if (elements.newSystemVersion) {
      elements.newSystemVersion.value = isDuplicate
        ? seedSystem?.version || defaultVersion
        : defaultVersion;
    }
    if (elements.newSystemTitle) {
      elements.newSystemTitle.value = isDuplicate
        ? generateDuplicateSystemTitle(seedSystem?.title || seedSystem?.id || "System")
        : "";
      if (isDuplicate) {
        elements.newSystemTitle.select();
      }
    }
    if (elements.newSystemId) {
      elements.newSystemId.setCustomValidity("");
      let generatedId = "";
      if (isDuplicate) {
        generatedId = generateDuplicateSystemId(seedSystem?.id || seedSystem?.title || "system");
      } else {
        const seed = state.system?.title || state.system?.id || "system";
        do {
          generatedId = generateSystemId(seed || "system");
        } while (generatedId && systemCatalog.has(generatedId));
      }
      elements.newSystemId.value = generatedId;
      elements.newSystemId.focus();
      elements.newSystemId.select();
    }
  }

  if (elements.saveButton) {
    elements.saveButton.addEventListener("click", async () => {
      if (!state.system) {
        return;
      }
      const payload = serializeSystem(state.system);
      const systemId = (payload.id || "").trim();
      if (!systemId) {
        status.show("Set a system ID before saving.", { type: "warning", timeout: 2500 });
        return;
      }
      if (!dataManager.hasWriteAccess("systems")) {
        const required = dataManager.describeRequiredWriteTier("systems");
        const message = required
          ? `Saving systems requires a ${required} tier.`
          : "Your tier cannot save systems.";
        status.show(message, { type: "warning", timeout: 2800 });
        return;
      }
      payload.id = systemId;
      if (state.system.id !== systemId) {
        state.system.id = systemId;
        registerSystemRecord(
          {
            id: systemId,
            title: payload.title || systemId,
            source: state.system.origin || "draft",
            shareToken: state.system.shareToken || "",
          },
          { syncOption: true }
        );
        ensureSelectValue();
      }
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
      const requireRemote = dataManager.isAuthenticated() && dataManager.hasWriteAccess("systems");
      try {
        const result = await dataManager.save("systems", systemId, payload, {
          mode: wantsRemote ? "remote" : "auto",
        });
        undoStack.push({ type: "save", systemId, timestamp: Date.now() });
        rememberDraft(state.system);
        const savedToServer = result?.source === "remote";
        const label = payload.title || systemId;
        state.system.origin = savedToServer ? "remote" : "local";
        const user = sessionUser();
        const ownership = savedToServer ? "owned" : state.system.origin || "draft";
        state.system.ownership = ownership;
        state.system.permissions = "edit";
        if (savedToServer && user) {
          state.system.ownerId = user.id ?? null;
          state.system.ownerUsername = user.username || "";
        }
        registerSystemRecord(
          {
            id: systemId,
            title: label,
            source: state.system.origin,
            shareToken: state.system.shareToken || "",
            ownership,
            permissions: "edit",
            ownerId: savedToServer ? user?.id ?? null : undefined,
            ownerUsername: savedToServer ? user?.username || "" : undefined,
          },
          { syncOption: true }
        );
        ensureSelectValue();
        if (savedToServer || !requireRemote) {
          markSystemClean(state.system);
        }
        if (savedToServer) {
          status.show(`Saved ${label} to the server`, { type: "success", timeout: 2500 });
        } else {
          status.show(`Saved ${label} locally. Log in to sync with the server.`, {
            type: "info",
            timeout: 3000,
          });
        }
      } catch (error) {
        console.error("Failed to save system", error);
        const message = error?.message || "Unable to save system";
        status.show(message, { type: "error", timeout: 3000 });
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }

  if (elements.deleteButton) {
    elements.deleteButton.addEventListener("click", async () => {
      if (!state.system?.id) {
        status.show("Select a system before deleting.", { type: "warning", timeout: 2000 });
        return;
      }
      if (state.system.origin === "builtin") {
        status.show("Built-in systems cannot be deleted.", { type: "info", timeout: 2200 });
        return;
      }
      if (state.system.origin === "draft") {
        status.show("Save the system before deleting it.", { type: "info", timeout: 2200 });
        return;
      }
      const label = state.system.title || state.system.id;
      const confirmed = window.confirm(`Delete ${label}? This action cannot be undone.`);
      if (!confirmed) {
        return;
      }
      const wantsRemote = dataManager.isAuthenticated() && Boolean(dataManager.baseUrl);
      try {
        await dataManager.delete("systems", state.system.id, { mode: wantsRemote ? "remote" : "auto" });
        drafts.delete(getDraftKey(state.system.id));
        removeSystemRecord(state.system.id);
        state.system = createBlankSystem();
        state.selectedNodeId = null;
        markSystemClean(state.system);
        renderAll();
        ensureSelectValue();
        status.show(`Deleted ${label}`, { type: "success", timeout: 2200 });
      } catch (error) {
        console.error("Failed to delete system", error);
        const message = error?.message || "Unable to delete system";
        status.show(message, { type: "error", timeout: 3000 });
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

  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json";
  importInput.className = "visually-hidden";
  importInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      persistCurrentDraft();
      applySystemData(data, {
        origin: "draft",
        emitStatus: true,
        statusMessage: `Imported ${data.title || state.system.id || "system"}`,
        markClean: false,
      });
      registerSystemRecord(
        {
          id: state.system.id,
          title: state.system.title,
          source: state.system.origin,
          shareToken: state.system.shareToken || "",
        },
        { syncOption: true }
      );
      if (elements.select) {
        elements.select.value = state.system.id || "";
      }
      status.show(`Imported ${state.system.title || "system"}`, { type: "success", timeout: 2500 });
    } catch (error) {
      console.error("Failed to import system", error);
      status.show("Import failed. Check the JSON and try again.", { type: "error", timeout: 3000 });
    } finally {
      event.target.value = "";
    }
  });
  document.body.appendChild(importInput);

  if (elements.importButton) {
    elements.importButton.addEventListener("click", () => {
      importInput.click();
    });
  }

  if (elements.exportButton) {
    elements.exportButton.addEventListener("click", () => {
      const serialized = serializeSystem(state.system);
      const text = JSON.stringify(serialized, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const filename = `${serialized.id || "system"}.json`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      status.show(`Exported ${serialized.title || "system"}`, { type: "success", timeout: 2000 });
    });
  }

  renderAll();

  function createBlankSystem({ id = "", title = "", version = "0.1", origin = "draft", shareToken = "" } = {}) {
    return {
      id,
      title,
      version,
      fields: [],
      definitions: {},
      importers: [],
      origin,
      shareToken: shareToken || "",
      ownership: origin || "",
      permissions: "",
      ownerId: null,
      ownerUsername: "",
    };
  }

  function createFieldNode(type = "string", overrides = {}) {
    const normalizedType = normalizeType(type);
    const node = {
      id: generateId(),
      type: normalizedType,
      key: "",
      label: "",
      required: false,
      formula: "",
      minimum: null,
      maximum: null,
      values: [],
      children: [],
      itemMode: normalizedType === "array" ? "inline" : "inline",
      itemRef: "",
      displayField: "",
    };
    node.children = Array.isArray(node.children) ? node.children : [];
    return Object.assign(node, overrides);
  }

  function createDefinitionNode(key = "") {
    const trimmedKey = typeof key === "string" ? key.trim() : "";
    const identifier = trimmedKey || generateDefinitionKey("Definition");
    return {
      uid: generateId(),
      id: identifier,
      label: "",
      type: "object",
      displayField: "",
      children: [],
    };
  }

  function generateDefinitionKey(seed = "Definition") {
    const base = toCamelCase(seed || "definition") || "definition";
    const definitions = state.system?.definitions || {};
    if (!definitions[base]) {
      return base;
    }
    let counter = 2;
    let candidate = `${base}${counter}`;
    while (definitions[candidate]) {
      counter += 1;
      candidate = `${base}${counter}`;
    }
    return candidate;
  }

  function applySystemData(
    data = {},
    {
      origin = "remote",
      emitStatus = false,
      statusMessage = "",
      markClean = origin !== "draft",
      shareToken = "",
    } = {}
  ) {
    const effectiveShareToken = typeof shareToken === "string" && shareToken ? shareToken : data.shareToken || "";
    const hydrated = createBlankSystem({
      id: data.id || "",
      title: data.title || "",
      version: data.version || "0.1",
      origin,
      shareToken: effectiveShareToken,
    });
    hydrated.fields = Array.isArray(data.fields) ? data.fields.map(hydrateFieldNode) : [];
    hydrated.definitions = hydrateSystemDefinitions(data.definitions);
    hydrated.importers = Array.isArray(data.importers) ? data.importers : [];
    applySystemState(hydrated, { emitStatus, statusMessage, markClean });
    state.system.shareToken = effectiveShareToken;
  }

  function applySystemState(system, { emitStatus = false, statusMessage = "", markClean = true } = {}) {
    state.system = cloneSystem(system);
    state.system.origin = system.origin || state.system.origin || "draft";
    state.system.shareToken = system.shareToken || state.system.shareToken || "";
    const metadata = state.system.id ? systemCatalog.get(state.system.id) || null : null;
    if (metadata) {
      const ownership = typeof metadata.ownership === "string" && metadata.ownership
        ? metadata.ownership.toLowerCase()
        : state.system.origin || "";
      state.system.ownership = ownership;
      state.system.permissions = metadata.permissions || state.system.permissions || "";
      state.system.ownerId = metadata.ownerId ?? metadata.owner_id ?? null;
      state.system.ownerUsername = metadata.ownerUsername || metadata.owner_username || "";
    } else {
      state.system.ownership = state.system.origin || state.system.ownership || "";
      state.system.permissions = state.system.permissions || "";
      state.system.ownerId = state.system.ownerId ?? null;
      state.system.ownerUsername = state.system.ownerUsername || "";
    }
    if (state.system.id) {
      registerSystemRecord(
        {
          id: state.system.id,
          title: state.system.title,
          source: state.system.origin,
          shareToken: state.system.shareToken,
          ownership: state.system.ownership,
          permissions: state.system.permissions,
          ownerId: state.system.ownerId ?? null,
          ownerUsername: state.system.ownerUsername || "",
        },
        { syncOption: true }
      );
    }
    rebuildFieldIdentities(state.system);
    state.selectedNodeId = null;
    if (markClean) {
      markSystemClean(state.system);
    }
    renderAll();
    ensureSelectValue();
    if (emitStatus && statusMessage) {
      status.show(statusMessage, { type: "success", timeout: 2000 });
    }
  }

  function startNewSystem({
    id = "",
    title = "",
    version = "0.1",
    origin = "draft",
    sourceSystem = null,
    markClean = true,
    statusMessage = "",
  } = {}) {
    const trimmedId = (id || "").trim();
    const trimmedTitle = (title || "").trim();
    const trimmedVersion = (version || "0.1").trim() || "0.1";
    if (!trimmedId || !trimmedTitle) {
      status.show("Provide a system ID and title.", { type: "warning", timeout: 2200 });
      return;
    }
    persistCurrentDraft();
    let nextSystem;
    if (sourceSystem) {
      nextSystem = cloneSystem(sourceSystem);
    } else {
      nextSystem = createBlankSystem({ id: trimmedId, title: trimmedTitle, version: trimmedVersion, origin });
      nextSystem.fields = [];
      nextSystem.importers = [];
    }
    nextSystem.id = trimmedId;
    nextSystem.title = trimmedTitle;
    nextSystem.version = trimmedVersion;
    nextSystem.origin = origin;
    nextSystem.shareToken = "";
    applySystemState(nextSystem, {
      emitStatus: true,
      statusMessage: statusMessage || `Started ${trimmedTitle || trimmedId}`,
      markClean,
    });
    if (elements.select) {
      elements.select.value = trimmedId;
    }
    systemCreationContext = { mode: "new", duplicateSystem: null, sourceTitle: "" };
  }

  function hydrateSystemDefinitions(source) {
    const output = {};
    if (!source || typeof source !== "object") {
      return output;
    }
    Object.entries(source).forEach(([key, value]) => {
      if (typeof key !== "string" || !key.trim()) {
        return;
      }
      const definition = createDefinitionNode(key.trim());
      if (value && typeof value === "object") {
        const normalizedType = normalizeType(value.type) || "object";
        definition.type = normalizedType === "object" ? "object" : normalizedType;
        if (typeof value.label === "string") {
          definition.label = value.label.trim();
        }
        if (typeof value.displayField === "string") {
          definition.displayField = value.displayField.trim();
        }
        if (Array.isArray(value.children) && value.children.length) {
          definition.children = value.children.map(hydrateFieldNode);
        } else if (value.item && Array.isArray(value.item.children)) {
          definition.children = value.item.children.map(hydrateFieldNode);
        }
      }
      output[definition.id] = definition;
    });
    return output;
  }

  function hydrateFieldNode(field) {
    const node = createFieldNode(field.type || "string", {
      key: field.key || "",
      label: field.label || "",
      required: Boolean(field.required),
      formula: field.formula || field.expr || "",
      minimum: field.minimum ?? null,
      maximum: field.maximum ?? null,
      values: Array.isArray(field.values)
        ? [...field.values]
        : Array.isArray(field.enum)
        ? [...field.enum]
        : [],
    });
    const normalized = normalizeType(field.type);
    if (normalized === "object" && Array.isArray(field.children) && field.children.length) {
      node.children = field.children.map(hydrateFieldNode);
    }
    if (normalized === "array") {
      if (field.item && typeof field.item === "object") {
        if (typeof field.item.ref === "string" && field.item.ref.trim()) {
          node.itemMode = "definition";
          node.itemRef = field.item.ref.trim();
          node.children = [];
        } else if (normalizeType(field.item.type) === "object" && Array.isArray(field.item.children)) {
          node.itemMode = "inline";
          node.children = field.item.children.map(hydrateFieldNode);
        }
      } else if (Array.isArray(field.children) && field.children.length) {
        node.itemMode = "inline";
        node.children = field.children.map(hydrateFieldNode);
      }
      if (typeof field.displayField === "string") {
        node.displayField = field.displayField.trim();
      }
    }
    return node;
  }

  function renderAll() {
    renderCanvas();
    renderInspector();
    renderPreview();
    syncSystemActions();
  }

  function renderCanvas() {
    const root = elements.canvasRoot;
    if (!root) return;
    root.innerHTML = "";
    root.dataset.dropzone = "root";
    root.dataset.dropzoneParent = "";
    root.dataset.dropzoneKey = "root";
    const fields = state.system.fields || [];
    if (!fields.length) {
      const placeholderText = hasActiveSystem()
        ? "Drag fields from the palette into the canvas below to design your system."
        : "Create or load a system to start adding fields to the canvas.";
      root.appendChild(
        createCanvasPlaceholder(placeholderText, {
          variant: "root",
        })
      );
    } else {
      fields.forEach((field) => {
        root.appendChild(renderFieldCard(field));
      });
    }
    setupDropzones(root, dropzones, {
      groupName: "system-canvas",
      sortableOptions: {
        onAdd(event) {
          handleDrop(event);
        },
        onUpdate(event) {
          handleReorder(event);
        },
      },
    });
    refreshTooltips(root);
  }

  function clearCanvas({ skipHistory = false, silent = false, suppressRender = false } = {}) {
    const fields = state.system.fields || [];
    if (!fields.length) {
      status.show("Canvas is already empty", { timeout: 1200 });
      return;
    }
    const previousFields = cloneNodeCollection(fields);
    const previousSelectedId = state.selectedNodeId || null;
    state.system.fields = [];
    state.selectedNodeId = null;
    resetTypeCounters();
    if (!skipHistory) {
      undoStack.push({
        type: "clear",
        systemId: state.system?.id || "",
        fields: previousFields,
        previousSelectedId,
      });
    }
    if (!silent) {
      status.show("Cleared system canvas", { type: "info", timeout: 1500 });
    }
    if (!suppressRender) {
      renderAll();
    }
  }

  function renderFieldCard(node) {
    const normalizedType = normalizeType(node.type);
    const typeMeta = TYPE_DEFS[normalizedType] || TYPE_DEFS.string;

    const card = createCanvasCardElement({
      dataset: { nodeId: node.id },
      selected: state.selectedNodeId === node.id,
    });
    card.tabIndex = 0;
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node.id);
    });

    const { header, ensureActions, deleteButton } = createStandardCardChrome({
      icon: typeMeta.icon || TYPE_DEFS.string.icon,
      iconLabel: typeMeta.label || normalizedType,
      removeButtonOptions: {
        srLabel: "Remove field",
        onClick: (event) => {
          event.stopPropagation();
          deleteNode(node.id);
        },
      },
    });
    if (node.required) {
      const indicatorContainer = document.createElement("span");
      indicatorContainer.className = "d-inline-flex align-items-center justify-content-center";
      indicatorContainer.dataset.bsToggle = "tooltip";
      indicatorContainer.dataset.bsPlacement = "bottom";
      indicatorContainer.dataset.bsTitle = "Required field";

      const indicatorSymbol = document.createElement("span");
      indicatorSymbol.className = "text-danger fw-semibold small";
      indicatorSymbol.setAttribute("aria-hidden", "true");
      indicatorSymbol.textContent = "*";

      const indicatorSr = document.createElement("span");
      indicatorSr.className = "visually-hidden";
      indicatorSr.textContent = "Required field";

      indicatorContainer.append(indicatorSymbol, indicatorSr);
      const actionsContainer = ensureActions();
      actionsContainer.prepend(indicatorContainer);
    }

    const duplicateButton = document.createElement("button");
    duplicateButton.type = "button";
    duplicateButton.className = "btn btn-outline-secondary btn-sm";
    duplicateButton.innerHTML =
      '<span class="iconify" data-icon="tabler:copy" aria-hidden="true"></span><span class="visually-hidden">Duplicate field</span>';
    duplicateButton.dataset.bsToggle = "tooltip";
    duplicateButton.dataset.bsPlacement = "bottom";
    duplicateButton.dataset.bsTitle = "Duplicate field";
    duplicateButton.addEventListener("click", (event) => {
      event.stopPropagation();
      duplicateNode(node.id);
    });
    const actionHost = ensureActions();
    if (deleteButton && deleteButton.parentElement === actionHost) {
      actionHost.insertBefore(duplicateButton, deleteButton);
    } else {
      actionHost.appendChild(duplicateButton);
    }

    card.appendChild(header);

    const cardBody = document.createElement("div");
    cardBody.className = "d-flex flex-column gap-2";

    const titleRow = document.createElement("div");
    titleRow.className = "d-flex flex-wrap align-items-baseline gap-2";

    const heading = document.createElement("span");
    heading.className = "fw-semibold";
    heading.textContent = node.label || node.key || typeMeta.label || normalizedType;
    titleRow.appendChild(heading);

    const subtitleText = formatNodeSubtitle(node);
    if (subtitleText) {
      const subtitle = document.createElement("span");
      subtitle.className = "text-body-secondary small";
      subtitle.textContent = subtitleText;
      titleRow.appendChild(subtitle);
    }

    cardBody.appendChild(titleRow);

    card.appendChild(cardBody);

    if (supportsChildren(node)) {
      const wrapper = document.createElement("div");
      wrapper.className = "d-flex flex-column gap-2";

      const container = document.createElement("div");
      container.className = "workbench-dropzone";
      container.dataset.dropzone = node.id;
      if (!node.children || !node.children.length) {
        container.appendChild(
          createCanvasPlaceholder("Drag fields here to nest them", { variant: "compact" })
        );
      } else {
        node.children.forEach((child) => {
          container.appendChild(renderFieldCard(child));
        });
      }
      wrapper.appendChild(container);
      card.appendChild(wrapper);
    } else if (normalizedType === "array" && node.itemMode === "definition" && node.itemRef) {
      const info = document.createElement("div");
      info.className = "text-body-secondary small fst-italic";
      const definition = state.system.definitions?.[node.itemRef] || null;
      if (definition) {
        const count = Array.isArray(definition.children) ? definition.children.length : 0;
        const label = definition.label || definition.id || node.itemRef;
        info.textContent = `${label} definition (${count} column${count === 1 ? "" : "s"})`;
      } else {
        info.textContent = `Definition ${node.itemRef} is missing.`;
      }
      card.appendChild(info);
    }

    return card;
  }

  function formatNodeSubtitle(node) {
    const parts = [];
    if (node.key) parts.push(`(${node.key})`);
    if (node.minimum != null || node.maximum != null) {
      const range = [node.minimum ?? "", node.maximum ?? ""].filter((value) => value !== "").join(" – ");
      if (range) {
        parts.push(`range ${range}`);
      }
    }
    if (Array.isArray(node.values) && node.values.length) {
      parts.push(`${node.values.length} value${node.values.length === 1 ? "" : "s"}`);
    }
    const normalizedType = normalizeType(node.type);
    if (supportsChildren(node) && Array.isArray(node.children) && node.children.length) {
      const count = node.children.length;
      if (normalizedType === "array") {
        parts.push(`${count} column${count === 1 ? "" : "s"}`);
      } else {
        parts.push(`${count} nested ${count === 1 ? "field" : "fields"}`);
      }
    } else if (normalizedType === "array" && node.itemMode === "definition" && node.itemRef) {
      const definition = state.system.definitions?.[node.itemRef] || null;
      const count = definition && Array.isArray(definition.children) ? definition.children.length : 0;
      const label = definition ? definition.label || definition.id || node.itemRef : node.itemRef;
      parts.push(`${count} column${count === 1 ? "" : "s"} via ${label}`);
    }
    return parts.join(" · ") || TYPE_DEFS[normalizedType]?.description || "";
  }

  function supportsChildren(node) {
    if (!node || typeof node !== "object") {
      return false;
    }
    const normalized = normalizeType(node.type);
    if (normalized === "object") {
      return true;
    }
    if (normalized === "array") {
      return (node.itemMode || "inline") !== "definition";
    }
    return false;
  }

  function handleDrop(event) {
    if (!hasActiveSystem()) {
      status.show("Create or load a system before adding fields.", {
        type: "warning",
        timeout: 2400,
      });
      event.item.remove();
      renderCanvas();
      return;
    }
    const metadata = getSystemMetadata(state.system?.id);
    if (!systemAllowsEdits(metadata)) {
      const message = describeSystemEditRestriction(metadata);
      status.show(message, { type: "warning", timeout: 2800 });
      event.item.remove();
      renderCanvas();
      return;
    }
    if (!dataManager.hasWriteAccess("systems")) {
      const required = dataManager.describeRequiredWriteTier("systems");
      const message = required
        ? `Saving systems requires a ${required} tier.`
        : "Your tier cannot save systems.";
      status.show(message, { type: "warning", timeout: 2800 });
      event.item.remove();
      renderCanvas();
      return;
    }
    const parentId = event.to.dataset.dropzone || "root";
    const index = event.newIndex;
    const paletteType = event.item.dataset.paletteType;
    const nodeId = event.item.dataset.nodeId;

    if (paletteType) {
      const node = applyFieldIdentity(createFieldNode(paletteType));
      const previousSelectedId = state.selectedNodeId || null;
      insertNode(parentId, index, node);
      undoStack.push({
        type: "add",
        systemId: state.system?.id || "",
        node: cloneNode(node),
        parentId,
        index,
        previousSelectedId,
      });
      status.show(`Added ${TYPE_DEFS[paletteType]?.label || paletteType} field`, { timeout: 1500 });
      selectNode(node.id);
    } else if (nodeId) {
      if (nodeId === parentId || isDescendant(parentId, nodeId)) {
        status.show("Cannot move a field into itself", { type: "error", timeout: 2000 });
        renderAll();
        return;
      }
      const moveResult = moveNode(nodeId, parentId, index);
      if (moveResult.success) {
        undoStack.push({
          type: "move",
          systemId: state.system?.id || "",
          nodeId,
          from: moveResult.from,
          to: moveResult.to,
        });
      }
      status.show("Reordered field", { timeout: 1200 });
    }

    event.item.remove();
    renderAll();
  }

  function handleReorder(event) {
    const parentId = event.to.dataset.dropzone || "root";
    const nodeId = event.item.dataset.nodeId;
    if (!nodeId) {
      renderAll();
      return;
    }
    const collection = getCollection(parentId);
    if (!collection) {
      renderAll();
      return;
    }
    const oldIndex = event.oldIndex;
    const newIndex = event.newIndex;
    if (oldIndex === newIndex) {
      return;
    }
    const [item] = collection.splice(oldIndex, 1);
    collection.splice(newIndex, 0, item);
    const finalPosition = findNode(nodeId);
    undoStack.push({
      type: "reorder",
      systemId: state.system?.id || "",
      nodeId,
      parentId,
      from: { index: oldIndex },
      to: { index: finalPosition ? finalPosition.index : newIndex },
    });
    renderAll();
  }

  function insertNode(parentId, index, node) {
    const collection = getCollection(parentId);
    if (!collection) {
      return;
    }
    collection.splice(index, 0, node);
  }

  function moveNode(nodeId, targetParentId, index) {
    const found = findNode(nodeId);
    if (!found) {
      return { success: false };
    }
    const targetCollection = getCollection(targetParentId);
    if (!targetCollection) {
      return { success: false };
    }
    const fromParentId = found.parentId;
    const fromIndex = found.index;
    const [item] = found.collection.splice(found.index, 1);
    let safeIndex = Math.min(Math.max(index, 0), targetCollection.length);
    if (found.collection === targetCollection && fromIndex < safeIndex) {
      safeIndex -= 1;
    }
    targetCollection.splice(safeIndex, 0, item);
    return {
      success: true,
      from: { parentId: fromParentId, index: fromIndex },
      to: { parentId: targetParentId, index: safeIndex },
    };
  }

  function duplicateNode(nodeId) {
    const found = findNode(nodeId);
    if (!found) {
      return;
    }

    const metadata = getSystemMetadata(state.system?.id);
    if (!systemAllowsEdits(metadata)) {
      const message = describeSystemEditRestriction(metadata);
      status.show(message, { type: "warning", timeout: 2800 });
      return;
    }
    if (!dataManager.hasWriteAccess("systems")) {
      const required = dataManager.describeRequiredWriteTier("systems");
      const message = required
        ? `Saving systems requires a ${required} tier.`
        : "Your tier cannot save systems.";
      status.show(message, { type: "warning", timeout: 2800 });
      return;
    }

    const { node, collection, index, parentId } = found;
    if (!collection) {
      return;
    }

    const duplicate = cloneNode(node);
    regenerateFieldIdentifiers(duplicate);
    ensureDuplicateFieldKey(duplicate, collection);

    const previousSelectedId = state.selectedNodeId || null;
    collection.splice(index + 1, 0, duplicate);
    rebuildFieldIdentities(state.system);
    undoStack.push({
      type: "add",
      systemId: state.system?.id || "",
      node: cloneNode(duplicate),
      parentId,
      index: index + 1,
      previousSelectedId,
    });
    state.selectedNodeId = duplicate.id;
    renderAll();
    status.show("Duplicated field", { timeout: 1500 });
  }

  function regenerateFieldIdentifiers(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    node.id = generateId();
    if (Array.isArray(node.children) && node.children.length) {
      node.children.forEach((child) => {
        regenerateFieldIdentifiers(child);
      });
    } else if (!Array.isArray(node.children)) {
      node.children = [];
    }
  }

  function ensureDuplicateFieldKey(node, siblings) {
    if (!node || !Array.isArray(siblings)) {
      return;
    }
    const normalizedType = normalizeType(node.type);
    const siblingKeys = new Set(
      siblings
        .map((sibling) => (typeof sibling.key === "string" ? sibling.key.trim() : ""))
        .filter(Boolean)
    );
    const rawBase = typeof node.key === "string" ? node.key.trim() : "";
    const sanitizedBase = rawBase.replace(/[^A-Za-z0-9_-]/g, "");
    const fallbackBase = toCamelCase(node.label || TYPE_DEFS[normalizedType]?.label || "Field");
    const keyBase = sanitizedBase || fallbackBase || "field";
    let candidate = `${keyBase}Copy`;
    let counter = 2;
    while (siblingKeys.has(candidate)) {
      candidate = `${keyBase}Copy${counter}`;
      counter += 1;
    }
    node.key = candidate;
  }

  function deleteNode(nodeId, { skipHistory = false, silent = false, suppressRender = false } = {}) {
    const found = findNode(nodeId);
    if (!found) {
      return;
    }
    const { collection, index } = found;
    const [removed] = collection.splice(index, 1);
    const previousSelectedId = state.selectedNodeId || null;
    if (state.selectedNodeId === nodeId) {
      state.selectedNodeId = found.parentId && found.parentId !== "root" ? found.parentId : null;
    }
    if (!skipHistory) {
      undoStack.push({
        type: "delete",
        systemId: state.system?.id || "",
        nodeId,
        node: cloneNode(removed),
        parentId: found.parentId,
        index,
        previousSelectedId,
      });
    }
    if (!silent) {
      status.show("Removed field", { type: "info", timeout: 1500 });
    }
    if (!suppressRender) {
      renderAll();
    }
  }

  function ensureSystemContext(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const entryId = entry.systemId ?? "";
    const currentId = state.system?.id || "";
    if (entryId && entryId !== currentId) {
      return false;
    }
    return true;
  }

  function applySystemUndo(entry) {
    if (!ensureSystemContext(entry)) {
      return {
        message: "Undo unavailable for this system",
        options: { type: "warning", timeout: 2200 },
        applied: false,
      };
    }
    switch (entry.type) {
      case "add": {
        const nodeId = entry.node?.id;
        if (!nodeId) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        deleteNode(nodeId, { skipHistory: true, silent: true, suppressRender: true });
        state.selectedNodeId = entry.previousSelectedId || null;
        renderAll();
        return {
          message: "Removed added field",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "move": {
        if (!entry.nodeId || !entry.from) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        moveNode(entry.nodeId, entry.from.parentId, entry.from.index);
        state.selectedNodeId = entry.nodeId;
        renderAll();
        return {
          message: "Moved field back",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "reorder": {
        if (!entry.nodeId || !entry.parentId || !entry.from) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        moveNode(entry.nodeId, entry.parentId, entry.from.index);
        state.selectedNodeId = entry.nodeId;
        renderAll();
        return {
          message: "Restored field order",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "delete": {
        if (!entry.node) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        const nodeClone = cloneNode(entry.node);
        insertNode(entry.parentId || "root", entry.index ?? 0, nodeClone);
        state.selectedNodeId = nodeClone.id;
        renderAll();
        return {
          message: "Restored removed field",
          options: { type: "info", timeout: 1600 },
          applied: true,
        };
      }
      case "update": {
        if (!entry.nodeId || !entry.property) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        state.selectedNodeId = entry.nodeId;
        updateNodeProperty(entry.nodeId, entry.property, entry.previous, {
          skipHistory: true,
          defined: entry.previousDefined !== false,
        });
        return {
          message: "Reverted field change",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "definition-add": {
        if (!entry.definitionId) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        const next = cloneDefinitionMap(state.system.definitions);
        if (next && Object.prototype.hasOwnProperty.call(next, entry.definitionId)) {
          delete next[entry.definitionId];
          state.system.definitions = next;
          if (state.selectedDefinitionId === entry.definitionId) {
            state.selectedDefinitionId = null;
          }
          renderCanvas();
          renderInspector();
          renderPreview();
          return {
            message: "Removed definition",
            options: { type: "info", timeout: 1500 },
            applied: true,
          };
        }
        return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
      }
      case "definition-remove": {
        if (!entry.definitionId || !entry.definition) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        const next = cloneDefinitionMap(state.system.definitions);
        next[entry.definitionId] = cloneDefinition(entry.definition);
        state.system.definitions = next;
        state.selectedDefinitionId = entry.definitionId;
        renderCanvas();
        renderInspector();
        renderPreview();
        return {
          message: "Restored definition",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "definition-update": {
        if (!entry.definitionId || !entry.previous) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        const next = cloneDefinitionMap(state.system.definitions);
        next[entry.definitionId] = cloneDefinition(entry.previous);
        state.system.definitions = next;
        state.selectedDefinitionId = entry.definitionId;
        renderCanvas();
        renderInspector();
        renderPreview();
        return {
          message: "Reverted definition change",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "type": {
        if (!entry.nodeId || !entry.previous) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        const location = findNode(entry.nodeId);
        if (!location || !location.collection) {
          return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
        }
        location.collection[location.index] = cloneNode(entry.previous);
        state.selectedNodeId = entry.nodeId;
        rebuildFieldIdentities(state.system);
        renderAll();
        return {
          message: "Reverted field type",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "clear": {
        state.system.fields = cloneNodeCollection(entry.fields);
        state.selectedNodeId = entry.previousSelectedId || null;
        rebuildFieldIdentities(state.system);
        renderAll();
        return {
          message: "Restored system canvas",
          options: { type: "info", timeout: 1600 },
          applied: true,
        };
      }
      case "save": {
        return {
          message: "Saved system state noted",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      default:
        return { message: "Nothing to undo", options: { timeout: 1200 }, applied: false };
    }
  }

  function applySystemRedo(entry) {
    if (!ensureSystemContext(entry)) {
      return {
        message: "Redo unavailable for this system",
        options: { type: "warning", timeout: 2200 },
        applied: false,
      };
    }
    switch (entry.type) {
      case "add": {
        if (!entry.node) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        const nodeClone = cloneNode(entry.node);
        insertNode(entry.parentId || "root", entry.index ?? 0, nodeClone);
        state.selectedNodeId = nodeClone.id;
        renderAll();
        return {
          message: "Reapplied field addition",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "move": {
        if (!entry.nodeId || !entry.to) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        moveNode(entry.nodeId, entry.to.parentId, entry.to.index);
        state.selectedNodeId = entry.nodeId;
        renderAll();
        return {
          message: "Reapplied field move",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "reorder": {
        if (!entry.nodeId || !entry.parentId || !entry.to) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        moveNode(entry.nodeId, entry.parentId, entry.to.index);
        state.selectedNodeId = entry.nodeId;
        renderAll();
        return {
          message: "Reapplied ordering",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "delete": {
        if (!entry.nodeId) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        deleteNode(entry.nodeId, { skipHistory: true, silent: true, suppressRender: true });
        state.selectedNodeId = entry.parentId && entry.parentId !== "root" ? entry.parentId : null;
        renderAll();
        return {
          message: "Reapplied field removal",
          options: { type: "info", timeout: 1600 },
          applied: true,
        };
      }
      case "update": {
        if (!entry.nodeId || !entry.property) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        state.selectedNodeId = entry.nodeId;
        updateNodeProperty(entry.nodeId, entry.property, entry.next, {
          skipHistory: true,
          defined: entry.nextDefined !== false,
        });
        return {
          message: "Reapplied field change",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "definition-add": {
        if (!entry.definitionId || !entry.definition) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        const next = cloneDefinitionMap(state.system.definitions);
        next[entry.definitionId] = cloneDefinition(entry.definition);
        state.system.definitions = next;
        state.selectedDefinitionId = entry.definitionId;
        renderCanvas();
        renderInspector();
        renderPreview();
        return {
          message: "Reapplied definition",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "definition-remove": {
        if (!entry.definitionId) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        const next = cloneDefinitionMap(state.system.definitions);
        if (Object.prototype.hasOwnProperty.call(next, entry.definitionId)) {
          delete next[entry.definitionId];
          state.system.definitions = next;
          if (state.selectedDefinitionId === entry.definitionId) {
            state.selectedDefinitionId = null;
          }
          renderCanvas();
          renderInspector();
          renderPreview();
          return {
            message: "Reapplied definition removal",
            options: { type: "info", timeout: 1500 },
            applied: true,
          };
        }
        return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
      }
      case "definition-update": {
        if (!entry.definitionId || !entry.next) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        const next = cloneDefinitionMap(state.system.definitions);
        next[entry.definitionId] = cloneDefinition(entry.next);
        state.system.definitions = next;
        state.selectedDefinitionId = entry.definitionId;
        renderCanvas();
        renderInspector();
        renderPreview();
        return {
          message: "Reapplied definition change",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "type": {
        if (!entry.nodeId || !entry.next) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        const location = findNode(entry.nodeId);
        if (!location || !location.collection) {
          return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
        }
        location.collection[location.index] = cloneNode(entry.next);
        state.selectedNodeId = entry.nodeId;
        rebuildFieldIdentities(state.system);
        renderAll();
        return {
          message: "Reapplied field type",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "clear": {
        clearCanvas({ skipHistory: true, silent: true, suppressRender: true });
        renderAll();
        return {
          message: "Cleared system canvas",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      case "save": {
        return {
          message: "Save action noted",
          options: { type: "info", timeout: 1500 },
          applied: true,
        };
      }
      default:
        return { message: "Nothing to redo", options: { timeout: 1200 }, applied: false };
    }
  }

  function handleUndoEntry(entry) {
    return applySystemUndo(entry);
  }

  function handleRedoEntry(entry) {
    return applySystemRedo(entry);
  }

  function selectNode(nodeId) {
    if (state.selectedNodeId === nodeId) {
      expandInspectorPane();
      return;
    }
    state.selectedNodeId = nodeId;
    state.selectedDefinitionId = null;
    renderCanvas();
    renderInspector();
    expandInspectorPane();
  }

  function selectDefinition(definitionId) {
    if (state.selectedDefinitionId === definitionId) {
      expandInspectorPane();
      return;
    }
    state.selectedDefinitionId = definitionId;
    state.selectedNodeId = null;
    renderInspector();
    expandInspectorPane();
  }

  function addDefinition({ seedLabel = "" } = {}) {
    const definition = createDefinitionNode();
    if (seedLabel) {
      definition.label = seedLabel;
    }
    if (!state.system.definitions || typeof state.system.definitions !== "object") {
      state.system.definitions = {};
    }
    const key = definition.id;
    state.system.definitions = {
      ...state.system.definitions,
      [key]: definition,
    };
    undoStack.push({
      type: "definition-add",
      systemId: state.system?.id || "",
      definitionId: key,
      definition: cloneDefinition(definition),
    });
    selectDefinition(key);
    renderCanvas();
    renderPreview();
  }

  function definitionInUse(definitionId, nodes = state.system.fields) {
    if (!definitionId) {
      return false;
    }
    if (!Array.isArray(nodes)) {
      return false;
    }
    for (const node of nodes) {
      if (!node || typeof node !== "object") {
        continue;
      }
      if (normalizeType(node.type) === "array" && node.itemMode === "definition" && node.itemRef === definitionId) {
        return true;
      }
      if (Array.isArray(node.children) && node.children.length) {
        if (definitionInUse(definitionId, node.children)) {
          return true;
        }
      }
    }
    return false;
  }

  function removeDefinition(definitionId) {
    if (!definitionId || !state.system.definitions || !state.system.definitions[definitionId]) {
      return;
    }
    if (definitionInUse(definitionId)) {
      status.show("Lists are still referencing this definition. Update them before deleting it.", {
        type: "warning",
        timeout: 2600,
      });
      return;
    }
    const previous = cloneDefinition(state.system.definitions[definitionId]);
    const next = cloneDefinitionMap(state.system.definitions);
    delete next[definitionId];
    state.system.definitions = next;
    undoStack.push({
      type: "definition-remove",
      systemId: state.system?.id || "",
      definitionId,
      definition: previous,
    });
    if (state.selectedDefinitionId === definitionId) {
      state.selectedDefinitionId = null;
    }
    renderInspector();
    renderPreview();
  }

  function updateDefinition(definitionId, mutate, { skipHistory = false } = {}) {
    if (!definitionId || typeof mutate !== "function") {
      return;
    }
    const existing = state.system.definitions?.[definitionId];
    if (!existing) {
      return;
    }
    const previous = cloneDefinition(existing);
    mutate(existing);
    const next = cloneDefinition(existing);
    if (!skipHistory && !areValuesEqual(previous, next)) {
      undoStack.push({
        type: "definition-update",
        systemId: state.system?.id || "",
        definitionId,
        previous,
        next,
      });
    }
    renderInspector();
    renderCanvas();
    renderPreview();
  }

  function addDefinitionColumn(definitionId, type = "string") {
    updateDefinition(definitionId, (draft) => {
      draft.children = Array.isArray(draft.children) ? draft.children : [];
      const column = applyFieldIdentity(createFieldNode(type));
      draft.children.push(column);
      if (!draft.displayField) {
        draft.displayField = column.key || "";
      }
    });
  }

  function removeDefinitionColumn(definitionId, columnId) {
    updateDefinition(definitionId, (draft) => {
      draft.children = Array.isArray(draft.children) ? draft.children : [];
      const index = draft.children.findIndex((child) => child.id === columnId);
      if (index === -1) {
        return;
      }
      draft.children.splice(index, 1);
      if (draft.displayField) {
        const match = draft.children.find((child) => child.key === draft.displayField);
        if (!match) {
          draft.displayField = draft.children[0]?.key || "";
        }
      }
    });
  }

  function moveDefinitionColumn(definitionId, columnId, direction) {
    const offset = direction === "up" ? -1 : 1;
    if (offset === 0) {
      return;
    }
    updateDefinition(definitionId, (draft) => {
      draft.children = Array.isArray(draft.children) ? draft.children : [];
      const index = draft.children.findIndex((child) => child.id === columnId);
      if (index === -1) {
        return;
      }
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= draft.children.length) {
        return;
      }
      const [entry] = draft.children.splice(index, 1);
      draft.children.splice(nextIndex, 0, entry);
    });
  }

  function expandInspectorPane() {
    expandPane(elements.rightPane, elements.rightPaneToggle);
  }

  function getCollection(parentId) {
    if (parentId === "root") {
      return state.system.fields;
    }
    const parent = findNode(parentId)?.node;
    if (!parent) {
      return null;
    }
    parent.children = Array.isArray(parent.children) ? parent.children : [];
    return parent.children;
  }

  function findNode(nodeId, nodes = state.system.fields, parentId = "root") {
    if (!Array.isArray(nodes)) return null;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) {
        return { node, parentId, collection: nodes, index, relation: "children" };
      }
      if (node.children && node.children.length) {
        const childResult = findNode(nodeId, node.children, node.id);
        if (childResult) {
          return childResult;
        }
      }
    }
    return null;
  }

  function renderInspector() {
    if (!elements.inspector) return;
    const focusSnapshot = captureInspectorFocus();
    const node = state.selectedNodeId ? findNode(state.selectedNodeId)?.node : null;
    const definition = state.selectedDefinitionId
      ? state.system.definitions?.[state.selectedDefinitionId] || null
      : null;
    elements.inspector.innerHTML = "";
    if (definition) {
      renderDefinitionInspector(definition);
      restoreInspectorFocus(focusSnapshot);
      return;
    }
    if (!node) {
      renderDefinitionOverview();
      restoreInspectorFocus(focusSnapshot);
      return;
    }
    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-3";
    form.addEventListener("submit", (event) => event.preventDefault());

    const normalizedType = normalizeType(node.type);

    form.appendChild(createTextInput(node, "ID", "key"));
    form.appendChild(createTextInput(node, "Label", "label"));
    form.appendChild(createTypeSelect(node));
    form.appendChild(createFormulaInput(node));
    form.appendChild(createCheckbox(node, "Required", "required"));

    if (isNumericType(normalizedType)) {
      form.appendChild(createNumberInput(node, "Minimum", "minimum"));
      form.appendChild(createNumberInput(node, "Maximum", "maximum"));
    }

    if (normalizedType === "array") {
      form.appendChild(createArrayModeControl(node));
      if (node.itemMode === "definition") {
        form.appendChild(createArrayDefinitionSelect(node));
      }
      const displayControl = createArrayDisplaySelect(node);
      if (displayControl) {
        form.appendChild(displayControl);
      }
      if (node.itemMode !== "definition") {
        form.appendChild(createArrayInlineHint());
        if (!Array.isArray(node.children) || !node.children.length) {
          form.appendChild(createTextarea(node, "Values (one per line)", "values"));
        }
      }
    }

    elements.inspector.appendChild(form);
    restoreInspectorFocus(focusSnapshot);
  }

  function renderDefinitionOverview() {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-3";

    const placeholder = document.createElement("p");
    placeholder.className = "border border-dashed rounded-3 p-4 text-body-secondary";
    placeholder.textContent = "Select a field on the canvas to edit its configuration.";
    wrapper.appendChild(placeholder);

    const hint = document.createElement("p");
    hint.className = "text-body-secondary small mb-0";
    hint.textContent = "Need reusable column sets? Create definitions below and reference them from array fields.";
    wrapper.appendChild(hint);

    const list = createDefinitionListSection();
    if (list) {
      wrapper.appendChild(list);
    }

    elements.inspector.appendChild(wrapper);
  }

  function createDefinitionListSection() {
    const definitions = state.system.definitions && typeof state.system.definitions === "object"
      ? Object.values(state.system.definitions)
      : [];
    const entries = Array.isArray(definitions)
      ? definitions
          .filter((entry) => entry && typeof entry === "object")
          .sort((a, b) => {
            const aLabel = (a.label || a.id || "").toLowerCase();
            const bLabel = (b.label || b.id || "").toLowerCase();
            return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
          })
      : [];

    const section = document.createElement("section");
    section.className = "d-flex flex-column gap-2";

    const headerRow = document.createElement("div");
    headerRow.className = "d-flex justify-content-between align-items-center";

    const heading = document.createElement("h6");
    heading.className = "mb-0";
    heading.textContent = "Reusable column definitions";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-sm btn-outline-primary";
    addButton.textContent = "New definition";
    addButton.addEventListener("click", () => {
      addDefinition();
    });

    headerRow.append(heading, addButton);
    section.appendChild(headerRow);

    const list = document.createElement("div");
    list.className = "d-flex flex-column gap-2";

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "text-body-secondary small mb-0";
      empty.textContent = "No reusable definitions yet.";
      list.appendChild(empty);
    } else {
      entries.forEach((definition) => {
        list.appendChild(renderDefinitionListItem(definition));
      });
    }

    section.appendChild(list);
    return section;
  }

  function renderDefinitionListItem(definition) {
    const card = document.createElement("div");
    card.className = "border rounded-3 p-3 d-flex flex-column gap-2";

    const header = document.createElement("div");
    header.className = "d-flex justify-content-between align-items-start gap-2";

    const title = document.createElement("div");
    title.className = "fw-semibold";
    title.textContent = definition.label || definition.id || "Definition";

    const actions = document.createElement("div");
    actions.className = "d-flex gap-2";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "btn btn-sm btn-outline-primary";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      selectDefinition(definition.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-sm btn-outline-danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      removeDefinition(definition.id);
    });

    actions.append(editButton, deleteButton);

    header.append(title, actions);
    card.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "text-body-secondary small";
    const columnCount = Array.isArray(definition.children) ? definition.children.length : 0;
    const displayKey = definition.displayField ? ` · display ${definition.displayField}` : "";
    meta.textContent = `${columnCount} column${columnCount === 1 ? "" : "s"}${displayKey}`;
    card.appendChild(meta);

    return card;
  }

  function renderDefinitionInspector(definition) {
    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-3";
    form.addEventListener("submit", (event) => event.preventDefault());

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "btn btn-link btn-sm ps-0";
    backButton.textContent = "← Back to definitions";
    backButton.addEventListener("click", () => {
      state.selectedDefinitionId = null;
      renderInspector();
    });
    form.appendChild(backButton);

    const heading = document.createElement("h5");
    heading.className = "mb-0";
    heading.textContent = definition.label || definition.id || "Definition";
    form.appendChild(heading);

    const idGroup = document.createElement("div");
    idGroup.className = "d-flex flex-column";
    const idLabel = document.createElement("label");
    idLabel.className = "form-label fw-semibold text-body-secondary";
    idLabel.textContent = "Definition ID";
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.className = "form-control";
    idInput.readOnly = true;
    idInput.value = definition.id || "";
    idGroup.append(idLabel, idInput);
    form.appendChild(idGroup);

    const labelGroup = document.createElement("div");
    labelGroup.className = "d-flex flex-column";
    const labelLabel = document.createElement("label");
    labelLabel.className = "form-label fw-semibold text-body-secondary";
    labelLabel.textContent = "Display label";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "form-control";
    const labelFieldId = createInspectorFieldId(definition.id, "label", "definition-label");
    labelInput.id = labelFieldId;
    labelInput.dataset.inspectorField = labelFieldId;
    labelLabel.setAttribute("for", labelFieldId);
    labelInput.placeholder = "Inventory Item";
    labelInput.value = definition.label || "";
    labelInput.addEventListener("change", () => {
      const value = labelInput.value.trim();
      updateDefinition(definition.id, (draft) => {
        draft.label = value;
      });
    });
    labelGroup.append(labelLabel, labelInput);
    form.appendChild(labelGroup);

    const displayFieldControl = createDefinitionDisplaySelect(definition);
    if (displayFieldControl) {
      form.appendChild(displayFieldControl);
    }

    const columnsSection = createDefinitionColumnsSection(definition);
    if (columnsSection) {
      form.appendChild(columnsSection);
    }

    elements.inspector.appendChild(form);
  }

  function createDefinitionDisplaySelect(definition) {
    const options = Array.isArray(definition.children)
      ? definition.children.filter((child) => child && typeof child === "object" && child.key)
      : [];
    if (!options.length) {
      return null;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = "Display column";
    const select = document.createElement("select");
    select.className = "form-select";
    const fieldId = createInspectorFieldId(definition.id, "displayField", "definition-display");
    select.id = fieldId;
    select.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Auto";
    select.appendChild(placeholderOption);

    options.forEach((child) => {
      const option = document.createElement("option");
      option.value = child.key;
      option.textContent = child.label || child.key;
      if (definition.displayField && definition.displayField === child.key) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      updateDefinition(definition.id, (draft) => {
        draft.displayField = select.value || "";
      });
    });

    wrapper.append(label, select);
    return wrapper;
  }

  function createDefinitionColumnsSection(definition) {
    const section = document.createElement("section");
    section.className = "d-flex flex-column gap-2";

    const header = document.createElement("div");
    header.className = "d-flex justify-content-between align-items-center";

    const heading = document.createElement("h6");
    heading.className = "mb-0";
    heading.textContent = "Columns";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-sm btn-outline-primary";
    addButton.textContent = "Add column";
    addButton.addEventListener("click", () => {
      addDefinitionColumn(definition.id);
    });

    header.append(heading, addButton);
    section.appendChild(header);

    const list = document.createElement("div");
    list.className = "d-flex flex-column gap-2";

    if (!Array.isArray(definition.children) || !definition.children.length) {
      const empty = document.createElement("p");
      empty.className = "text-body-secondary small mb-0";
      empty.textContent = "No columns yet.";
      list.appendChild(empty);
    } else {
      definition.children.forEach((child, index) => {
        list.appendChild(renderDefinitionColumn(definition, child, index));
      });
    }

    section.appendChild(list);
    return section;
  }

  function renderDefinitionColumn(definition, column, index) {
    const card = document.createElement("div");
    card.className = "border rounded-3 p-3 d-flex flex-column gap-2";

    const header = document.createElement("div");
    header.className = "d-flex justify-content-between align-items-center gap-2";

    const title = document.createElement("div");
    title.className = "fw-semibold";
    title.textContent = column.label || column.key || `Column ${index + 1}`;

    const controls = document.createElement("div");
    controls.className = "d-flex gap-1";

    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "btn btn-sm btn-outline-secondary";
    upButton.textContent = "↑";
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => {
      moveDefinitionColumn(definition.id, column.id, "up");
    });

    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "btn btn-sm btn-outline-secondary";
    downButton.textContent = "↓";
    downButton.disabled = !definition.children || index === definition.children.length - 1;
    downButton.addEventListener("click", () => {
      moveDefinitionColumn(definition.id, column.id, "down");
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn btn-sm btn-outline-danger";
    deleteButton.textContent = "Remove";
    deleteButton.addEventListener("click", () => {
      removeDefinitionColumn(definition.id, column.id);
    });

    controls.append(upButton, downButton, deleteButton);
    header.append(title, controls);
    card.appendChild(header);

    const fields = document.createElement("div");
    fields.className = "row g-3";

    const keyControl = createDefinitionColumnTextInput(definition, column, "key", "ID", "quantity");
    keyControl.classList.add("col-12", "col-md-3");
    fields.appendChild(keyControl);

    const labelControl = createDefinitionColumnTextInput(definition, column, "label", "Label", "Quantity");
    labelControl.classList.add("col-12", "col-md-3");
    fields.appendChild(labelControl);

    const typeControl = createDefinitionColumnTypeSelect(definition, column);
    typeControl.classList.add("col-12", "col-md-3");
    fields.appendChild(typeControl);

    const requiredControl = createDefinitionColumnRequiredToggle(definition, column);
    requiredControl.classList.add("col-12", "col-md-3", "align-self-center");
    fields.appendChild(requiredControl);

    card.appendChild(fields);

    return card;
  }

  function createDefinitionColumnTextInput(definition, column, property, labelText, placeholder = "") {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    const fieldId = createInspectorFieldId(column.id, property, "definition" + property);
    input.id = fieldId;
    input.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);
    input.placeholder = placeholder;
    input.value = column[property] || "";
    input.addEventListener("change", () => {
      const value = input.value.trim();
      updateDefinition(definition.id, (draft) => {
        const target = draft.children?.find((child) => child.id === column.id);
        if (!target) {
          return;
        }
        target[property] = value;
        if (property === "key" && draft.displayField && draft.displayField === column.key) {
          draft.displayField = value || draft.children.find((child) => child.key)?.key || "";
        }
      });
    });
    wrapper.append(label, input);
    return wrapper;
  }

  function createDefinitionColumnTypeSelect(definition, column) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = "Type";
    const select = document.createElement("select");
    select.className = "form-select";
    const fieldId = createInspectorFieldId(column.id, "type", "definition-type");
    select.id = fieldId;
    select.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);

    const allowedTypes = ["string", "number", "boolean"];
    const current = normalizeType(column.type) || "string";
    allowedTypes.forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = TYPE_DEFS[type]?.label || type;
      if (type === current) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      updateDefinition(definition.id, (draft) => {
        const target = draft.children?.find((child) => child.id === column.id);
        if (!target) {
          return;
        }
        target.type = select.value;
      });
    });

    wrapper.append(label, select);
    return wrapper;
  }

  function createDefinitionColumnRequiredToggle(definition, column) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    const fieldId = createInspectorFieldId(column.id, "required", "definition-required");
    input.id = fieldId;
    input.dataset.inspectorField = fieldId;
    input.checked = Boolean(column.required);
    input.addEventListener("change", () => {
      updateDefinition(definition.id, (draft) => {
        const target = draft.children?.find((child) => child.id === column.id);
        if (!target) {
          return;
        }
        target.required = input.checked;
      });
    });
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", fieldId);
    label.textContent = "Required";
    wrapper.append(input, label);
    return wrapper;
  }

  function captureInspectorFocus() {
    if (!elements.inspector) {
      return null;
    }
    const active = document.activeElement;
    if (!active || !elements.inspector.contains(active)) {
      return null;
    }
    const id = active.id || active.getAttribute("data-inspector-field");
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

  function restoreInspectorFocus(snapshot) {
    if (!snapshot || !snapshot.id || !elements.inspector) {
      return;
    }
    const escaped = escapeCss(snapshot.id);
    if (!escaped) {
      return;
    }
    const target =
      elements.inspector.querySelector(`#${escaped}`) ||
      elements.inspector.querySelector(`[data-inspector-field="${escaped}"]`);
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

  function createInspectorFieldId(nodeId, property, suffix = "field") {
    const base = nodeId ? String(nodeId) : "field";
    const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, "-");
    return `system-inspector-${safeBase}-${property}-${suffix}`;
  }

  function createTypeSelect(node) {
    const fieldset = document.createElement("div");
    fieldset.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = "Type";
    const select = document.createElement("select");
    select.className = "form-select";
    const fieldId = createInspectorFieldId(node.id, "type", "select");
    select.id = fieldId;
    select.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);
    const normalized = normalizeType(node.type);
    const options = TYPE_OPTIONS.slice();
    if (normalized && !options.includes(normalized)) {
      options.push(normalized);
    }
    options.forEach((value) => {
      const meta = TYPE_DEFS[value] || { label: value };
      const option = document.createElement("option");
      option.value = value;
      option.textContent = meta.label;
      if (value === normalized) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      changeNodeType(node.id, select.value);
    });
    fieldset.appendChild(label);
    fieldset.appendChild(select);
    return fieldset;
  }

  function createFormulaInput(node) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-1";

    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = "Formula";

    const fieldId = createInspectorFieldId(node.id, "formula", "input");
    label.setAttribute("for", fieldId);

    const inputWrapper = document.createElement("div");
    inputWrapper.className = "position-relative";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    input.id = fieldId;
    input.dataset.inspectorField = fieldId;
    input.placeholder = "=sum(@attributes.strength, @attributes.dexterity)";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = node.formula ?? "";
    input.setAttribute("aria-autocomplete", "list");

    const suggestions = document.createElement("div");
    suggestions.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    suggestions.id = `${fieldId}-suggestions`;
    suggestions.setAttribute("role", "listbox");
    suggestions.style.zIndex = "1300";
    suggestions.style.fontSize = "0.8125rem";
    suggestions.style.maxHeight = "16rem";
    suggestions.style.overflowY = "auto";
    input.setAttribute("aria-controls", suggestions.id);

    inputWrapper.append(input, suggestions);
    wrapper.append(label, inputWrapper);

    const commitValue = (raw) => {
      const value = typeof raw === "string" ? raw.trim() : "";
      updateNodeProperty(node.id, "formula", value);
    };

    const autocomplete = attachFormulaAutocomplete(input, {
      container: suggestions,
      supportsBinding: true,
      supportsFunctions: true,
      getFieldItems: (query) => getSystemFormulaFieldSuggestions(query),
      getFunctionItems: (query) => getSystemFormulaFunctionSuggestions(query),
      resolveFieldMeta: resolveFieldTypeMeta,
      maxItems: MAX_FORMULA_SUGGESTIONS,
      applySuggestion: ({ applyDefault }) => {
        applyDefault();
        commitValue(input.value);
      },
    });

    input.addEventListener("input", () => {
      commitValue(input.value);
      autocomplete.update();
    });

    input.addEventListener("change", () => {
      commitValue(input.value);
      autocomplete.update();
    });

    input.addEventListener("focus", () => {
      autocomplete.update();
    });

    input.addEventListener("click", () => {
      autocomplete.update();
    });

    return wrapper;
  }

  function createTextInput(node, labelText, property, { placeholder = "" } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control";
    const fieldId = createInspectorFieldId(node.id, property, "input");
    input.id = fieldId;
    input.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);
    input.placeholder = placeholder;
    input.value = node[property] ?? "";
    input.addEventListener("change", () => {
      updateNodeProperty(node.id, property, input.value);
    });
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }

  function createNumberInput(node, labelText, property) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control";
    const fieldId = createInspectorFieldId(node.id, property, "number");
    input.id = fieldId;
    input.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);
    input.value = node[property] ?? "";
    input.addEventListener("change", () => {
      const value = input.value === "" ? null : Number(input.value);
      updateNodeProperty(node.id, property, Number.isNaN(value) ? null : value);
    });
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }

  function createCheckbox(node, labelText, property) {
    const wrapper = document.createElement("div");
    wrapper.className = "form-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    const fieldId = createInspectorFieldId(node.id, property, "toggle");
    input.id = fieldId;
    input.dataset.inspectorField = fieldId;
    input.checked = Boolean(node[property]);
    input.addEventListener("change", () => {
      updateNodeProperty(node.id, property, input.checked);
    });
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", input.id);
    label.textContent = labelText;
    wrapper.appendChild(input);
    wrapper.appendChild(label);
    return wrapper;
  }

  function createTextarea(node, labelText, property) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = labelText;
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    const fieldId = createInspectorFieldId(node.id, property, "textarea");
    textarea.id = fieldId;
    textarea.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);
    textarea.rows = 4;
    textarea.value = Array.isArray(node[property]) ? node[property].join("\n") : node[property] || "";
    textarea.addEventListener("change", () => {
      const value = textarea.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      updateNodeProperty(node.id, property, value);
    });
    wrapper.appendChild(label);
    wrapper.appendChild(textarea);
    return wrapper;
  }

  function createArrayModeControl(node) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = "Column mode";
    const select = document.createElement("select");
    select.className = "form-select";
    const fieldId = createInspectorFieldId(node.id, "itemMode", "array-mode");
    select.id = fieldId;
    select.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);
    const mode = node.itemMode === "definition" ? "definition" : "inline";
    const options = [
      { value: "inline", label: "Inline (custom columns)" },
      { value: "definition", label: "Reusable definition" },
    ];
    options.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      if (option.value === mode) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      const value = select.value === "definition" ? "definition" : "inline";
      if (value === "definition") {
        const keys = Object.keys(state.system.definitions || {});
        if (!keys.length) {
          status.show("Create a definition before using this mode.", { type: "warning", timeout: 2400 });
          select.value = "inline";
          return;
        }
        if (!node.itemRef || !keys.includes(node.itemRef)) {
          updateNodeProperty(node.id, "itemRef", keys[0]);
        }
      } else if (node.itemMode === "definition" && node.itemRef) {
        updateNodeProperty(node.id, "itemRef", "");
      }
      updateNodeProperty(node.id, "itemMode", value);
    });
    wrapper.append(label, select);
    return wrapper;
  }

  function createArrayDefinitionSelect(node) {
    const definitions = state.system.definitions && typeof state.system.definitions === "object"
      ? Object.entries(state.system.definitions)
      : [];
    if (!definitions.length) {
      const warning = document.createElement("div");
      warning.className = "alert alert-warning mb-0";
      warning.textContent = "No definitions available. Create one in the list above.";
      return warning;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-1";

    const labelRow = document.createElement("div");
    labelRow.className = "d-flex justify-content-between align-items-center gap-2";

    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary mb-0";
    const fieldId = createInspectorFieldId(node.id, "itemRef", "array-definition");
    label.setAttribute("for", fieldId);
    label.textContent = "Definition";

    const manageButton = document.createElement("button");
    manageButton.type = "button";
    manageButton.className = "btn btn-sm btn-outline-secondary";
    manageButton.textContent = "Manage";
    manageButton.addEventListener("click", () => {
      if (node.itemRef) {
        selectDefinition(node.itemRef);
      } else if (definitions.length) {
        selectDefinition(definitions[0][0]);
      }
    });

    labelRow.append(label, manageButton);

    const select = document.createElement("select");
    select.className = "form-select";
    select.id = fieldId;
    select.dataset.inspectorField = fieldId;
    definitions
      .sort((a, b) => {
        const aLabel = (a[1].label || a[0]).toLowerCase();
        const bLabel = (b[1].label || b[0]).toLowerCase();
        return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
      })
      .forEach(([key, definition]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = definition.label || key;
        if (node.itemRef === key) {
          option.selected = true;
        }
        select.appendChild(option);
    });
    select.addEventListener("change", () => {
      const value = select.value;
      updateNodeProperty(node.id, "itemRef", value);
      const definition = state.system.definitions?.[value] || null;
      if (definition) {
        const fallback = definition.displayField || (definition.children?.[0]?.key ?? "");
        const nextDisplay = fallback || "";
        if ((node.displayField || "") !== nextDisplay) {
          updateNodeProperty(node.id, "displayField", nextDisplay);
        }
      } else if (node.displayField) {
        updateNodeProperty(node.id, "displayField", "");
      }
    });

    wrapper.append(labelRow, select);
    return wrapper;
  }

  function getArrayColumnCandidates(node) {
    if (!node || typeof node !== "object") {
      return [];
    }
    if (node.itemMode === "definition" && node.itemRef) {
      const definition = state.system.definitions?.[node.itemRef] || null;
      return Array.isArray(definition?.children) ? definition.children : [];
    }
    return Array.isArray(node.children) ? node.children : [];
  }

  function createArrayDisplaySelect(node) {
    const columns = getArrayColumnCandidates(node);
    if (!columns.length) {
      return null;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    const label = document.createElement("label");
    label.className = "form-label fw-semibold text-body-secondary";
    label.textContent = "Display column";
    const select = document.createElement("select");
    select.className = "form-select";
    const fieldId = createInspectorFieldId(node.id, "displayField", "array-display");
    select.id = fieldId;
    select.dataset.inspectorField = fieldId;
    label.setAttribute("for", fieldId);

    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Auto";
    select.appendChild(blank);

    columns.forEach((column) => {
      if (!column || !column.key) {
        return;
      }
      const option = document.createElement("option");
      option.value = column.key;
      option.textContent = column.label || column.key;
      if (node.displayField && node.displayField === column.key) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    select.addEventListener("change", () => {
      updateNodeProperty(node.id, "displayField", select.value);
    });

    wrapper.append(label, select);
    return wrapper;
  }

  function createArrayInlineHint() {
    const hint = document.createElement("p");
    hint.className = "text-body-secondary small mb-0";
    hint.textContent = "Drag fields onto the array card to add columns.";
    return hint;
  }

  function getSystemFormulaFieldSuggestions(query = "") {
    const normalized = query.trim().toLowerCase();
    const entries = collectSystemFields(state.system);
    const results = [];
    entries.forEach((entry) => {
      const path = entry?.path || "";
      if (!path) {
        return;
      }
      const label = entry.label || "";
      if (normalized) {
        const pathMatch = path.toLowerCase().includes(normalized);
        const labelMatch = label.toLowerCase().includes(normalized);
        if (!pathMatch && !labelMatch) {
          return;
        }
      }
      results.push({
        type: "field",
        path,
        display: `@${path}`,
        description: label && label !== path ? label : "",
        fieldType: entry.type || "",
        fieldCategory: entry.category || "",
      });
    });
    return results.slice(0, MAX_FORMULA_SUGGESTIONS);
  }

  function getSystemFormulaFunctionSuggestions(query = "") {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? FORMULA_FUNCTIONS.filter((fn) => fn.name.toLowerCase().startsWith(normalized))
      : FORMULA_FUNCTIONS;
    return matches.slice(0, MAX_FORMULA_SUGGESTIONS).map((fn) => ({
      type: "function",
      name: fn.name,
      display: fn.signature,
      description: fn.name,
    }));
  }

  function updateNodeProperty(
    nodeId,
    property,
    value,
    { skipHistory = false, defined = value !== undefined } = {}
  ) {
    const found = findNode(nodeId);
    if (!found) {
      return;
    }
    const hasCurrent = Object.prototype.hasOwnProperty.call(found.node, property);
    const currentValue = hasCurrent ? found.node[property] : undefined;
    if (!defined && !hasCurrent) {
      return;
    }
    if (defined && hasCurrent && areValuesEqual(currentValue, value)) {
      return;
    }
    if (!skipHistory) {
      undoStack.push({
        type: "update",
        systemId: state.system?.id || "",
        nodeId,
        property,
        previous: cloneValue(currentValue),
        previousDefined: hasCurrent,
        next: cloneValue(value),
        nextDefined: defined,
      });
    }
    applyNodePropertyChange(found.node, property, value, { defined });
    renderCanvas();
    renderPreview();
    renderInspector();
  }

  function applyNodePropertyChange(targetNode, property, value, { defined = value !== undefined } = {}) {
    if (!targetNode) {
      return;
    }
    if (!defined) {
      delete targetNode[property];
      return;
    }
    targetNode[property] = cloneValue(value);
  }

  function changeNodeType(nodeId, nextType) {
    const found = findNode(nodeId);
    if (!found) {
      return;
    }
    const current = found.node;
    const normalizedNextType = normalizeType(nextType);
    if (normalizeType(current.type) === normalizedNextType) {
      return;
    }
    const previousNode = cloneNode(current);
    const preserved = {
      id: current.id,
      key: current.key,
      label: current.label,
      required: current.required,
    };
    const replacement = applyFieldIdentity(createFieldNode(normalizedNextType, preserved));
    if (found.collection) {
      found.collection[found.index] = replacement;
    }
    undoStack.push({
      type: "type",
      systemId: state.system?.id || "",
      nodeId,
      previous: previousNode,
      next: cloneNode(replacement),
    });
    state.selectedNodeId = preserved.id;
    rebuildFieldIdentities(state.system);
    renderAll();
  }

  function serializeSystem(system) {
    const payload = {
      id: system.id || "",
      title: system.title || "",
      version: system.version || "0.1",
      fields: Array.isArray(system.fields) ? system.fields.map(serializeFieldNode) : [],
      importers: Array.isArray(system.importers) ? system.importers : [],
    };
    const definitions = serializeSystemDefinitions(system.definitions);
    if (Object.keys(definitions).length) {
      payload.definitions = definitions;
    }
    return payload;
  }

  function computeSystemSignature(system = state.system) {
    if (!system) {
      return null;
    }
    try {
      return JSON.stringify(serializeSystem(system));
    } catch (error) {
      console.warn("System editor: unable to compute system signature", error);
      return null;
    }
  }

  function markSystemClean(system = state.system) {
    lastSavedSystemSignature = computeSystemSignature(system);
  }

  function hasUnsavedSystemChanges() {
    if (!state.system) {
      return false;
    }
    const current = computeSystemSignature(state.system);
    if (!lastSavedSystemSignature) {
      return Boolean(current);
    }
    return current !== lastSavedSystemSignature;
  }

  function serializeFieldNode(node) {
    const normalizedType = normalizeType(node.type);
    const output = {
      type: normalizedType,
    };
    if (node.key) output.key = node.key;
    if (node.label) output.label = node.label;
    if (node.required) output.required = true;
    if (node.formula) output.formula = node.formula;
    if (node.minimum != null) output.minimum = node.minimum;
    if (node.maximum != null) output.maximum = node.maximum;
    if (Array.isArray(node.values) && node.values.length) {
      output.values = [...node.values];
    }

    if (normalizedType === "object" && Array.isArray(node.children) && node.children.length) {
      output.children = node.children.map(serializeFieldNode);
    }

    if (normalizedType === "array") {
      if (node.itemMode === "definition" && node.itemRef) {
        output.item = { ref: node.itemRef };
      } else if (Array.isArray(node.children) && node.children.length) {
        output.item = {
          type: "object",
          children: node.children.map(serializeFieldNode),
        };
      }
      if (node.displayField) {
        output.displayField = node.displayField;
      }
    }

    return output;
  }

  function serializeSystemDefinitions(definitions) {
    if (!definitions || typeof definitions !== "object") {
      return {};
    }
    const entries = {};
    Object.entries(definitions).forEach(([key, definition]) => {
      if (!definition || typeof key !== "string") {
        return;
      }
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        return;
      }
      const normalizedType = normalizeType(definition.type) || "object";
      const payload = { type: normalizedType || "object" };
      if (definition.label) {
        payload.label = definition.label;
      }
      if (definition.displayField) {
        payload.displayField = definition.displayField;
      }
      if (normalizedType === "object" && Array.isArray(definition.children) && definition.children.length) {
        payload.children = definition.children.map(serializeFieldNode);
      }
      entries[trimmedKey] = payload;
    });
    return entries;
  }

  function rebuildFieldIdentities(system) {
    resetTypeCounters();
    const fields = Array.isArray(system?.fields) ? system.fields : [];
    fields.forEach((field) => {
      traverseField(field);
    });
  }

  function traverseField(node) {
    if (!node) {
      return;
    }
    applyFieldIdentity(node);
    if (Array.isArray(node.children) && node.children.length) {
      node.children.forEach((child) => {
        traverseField(child);
      });
    }
  }

  function applyFieldIdentity(node) {
    if (!node) {
      return node;
    }
    const normalized = normalizeType(node.type);
    const count = incrementTypeCounter(normalized);
    const typeLabel = TYPE_DEFS[normalized]?.label || normalized;
    const baseLabel = `${typeLabel} Field`;
    const label = count > 1 ? `${baseLabel} ${count}` : baseLabel;
    const keySource = count > 1 ? `${typeLabel} Field ${count}` : `${typeLabel} Field`;
    const fallbackKey = toCamelCase(keySource);
    const trimmedLabel = typeof node.label === "string" ? node.label.trim() : "";
    const trimmedKey = typeof node.key === "string" ? node.key.trim() : "";
    node.label = trimmedLabel || label;
    node.key = trimmedKey || fallbackKey;
    return node;
  }

  function incrementTypeCounter(type) {
    const current = typeCounters.get(type) || 0;
    const next = current + 1;
    typeCounters.set(type, next);
    return next;
  }

  function resetTypeCounters() {
    typeCounters.clear();
  }

  function toCamelCase(value) {
    if (!value) {
      return "";
    }
    const segments = String(value)
      .trim()
      .match(/[a-zA-Z0-9]+/g);
    if (!segments || !segments.length) {
      return "";
    }
    return segments
      .map((segment, index) => {
        const lower = segment.toLowerCase();
        if (index === 0) {
          return lower;
        }
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join("");
  }

  function registerSystemRecord(record, { syncOption = true } = {}) {
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
    systemCatalog.set(record.id, next);
    if (syncOption) {
      ensureSelectOption(record.id, next.title || record.id);
    }
  }

  function removeSystemRecord(id) {
    if (!id) {
      return;
    }
    systemCatalog.delete(id);
    removeSelectOption(id);
  }

  function removeSelectOption(id) {
    if (!elements.select || !id) {
      return;
    }
    const escaped = escapeCss(id);
    const option = escaped ? elements.select.querySelector(`option[value="${escaped}"]`) : null;
    if (option) {
      option.remove();
    }
  }

  function getSystemMetadata(systemId) {
    if (!systemId) {
      return null;
    }
    return systemCatalog.get(systemId) || null;
  }

  function systemOwnership(metadata) {
    const metaOwnership = metadata?.ownership;
    if (typeof metaOwnership === "string" && metaOwnership) {
      return metaOwnership.toLowerCase();
    }
    const stateOwnership = state.system?.ownership;
    if (typeof stateOwnership === "string" && stateOwnership) {
      return stateOwnership.toLowerCase();
    }
    const origin = state.system?.origin;
    return typeof origin === "string" && origin ? origin.toLowerCase() : "";
  }

  function systemPermissions(metadata) {
    if (metadata && typeof metadata.permissions === "string" && metadata.permissions) {
      return metadata.permissions.toLowerCase();
    }
    if (typeof state.system?.permissions === "string" && state.system.permissions) {
      return state.system.permissions.toLowerCase();
    }
    return "";
  }

  function systemOwnerMatchesCurrentUser(metadata) {
    const ownership = systemOwnership(metadata);
    if (ownership === "local" || ownership === "draft" || ownership === "owned") {
      return true;
    }
    const user = sessionUser();
    if (!user || !dataManager.isAuthenticated()) {
      return false;
    }
    const ownerId = metadata?.ownerId ?? metadata?.owner_id ?? state.system?.ownerId ?? null;
    if (ownerId !== null && ownerId !== undefined && user.id !== undefined && user.id !== null) {
      if (String(ownerId) === String(user.id)) {
        return true;
      }
    }
    const ownerUsername =
      metadata?.ownerUsername ||
      metadata?.owner_username ||
      state.system?.ownerUsername ||
      "";
    if (ownerUsername && user.username) {
      if (ownerUsername.toLowerCase() === user.username.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  function systemAllowsEdits(metadata) {
    if (!state.system?.id) {
      return true;
    }
    const ownership = systemOwnership(metadata);
    if (ownership === "shared") {
      return systemPermissions(metadata) === "edit";
    }
    if (ownership === "public") {
      return systemOwnerMatchesCurrentUser(metadata);
    }
    if (ownership === "owned" || ownership === "local" || ownership === "draft" || ownership === "builtin") {
      return true;
    }
    if (!ownership || ownership === "remote") {
      return systemOwnerMatchesCurrentUser(metadata);
    }
    return systemOwnerMatchesCurrentUser(metadata);
  }

  function describeSystemEditRestriction(metadata) {
    const ownership = systemOwnership(metadata);
    const permissions = systemPermissions(metadata);
    if (ownership === "shared" && permissions !== "edit") {
      return "This system was shared with you as view-only. Duplicate it to make changes.";
    }
    if (ownership === "public") {
      return "Public systems are view-only. Duplicate it to customize.";
    }
    const ownerLabel = resolveSystemOwnerLabel(metadata);
    return `Only ${ownerLabel} can save this system.`;
  }

  function resolveSystemOwnerLabel(metadata) {
    const username =
      metadata?.ownerUsername ||
      metadata?.owner_username ||
      state.system?.ownerUsername ||
      "";
    return username || "the owner";
  }

  function syncSystemActions() {
    const hasSystem = Boolean(state.system);
    if (elements.saveButton) {
      const canWrite = dataManager.hasWriteAccess("systems");
      const metadata = getSystemMetadata(state.system?.id);
      const canEditRecord = systemAllowsEdits(metadata);
      const hasChanges = hasSystem && hasUnsavedSystemChanges();
      const enabled = hasSystem && hasChanges && canWrite && canEditRecord;
      elements.saveButton.disabled = !enabled;
      elements.saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
      if (!hasSystem || (!state.system.id && !state.system.title)) {
        elements.saveButton.title = "Create or load a system to save.";
      } else if (!canWrite) {
        const required = dataManager.describeRequiredWriteTier("systems");
        elements.saveButton.title = required
          ? `Saving systems requires a ${required} tier.`
          : "Your tier cannot save systems.";
      } else if (!canEditRecord) {
        elements.saveButton.title = describeSystemEditRestriction(metadata);
      } else if (!hasChanges) {
        elements.saveButton.title = "No changes to save.";
      } else {
        elements.saveButton.removeAttribute("title");
      }
    }

    if (elements.clearButton) {
      const isEmpty = !hasActiveSystem() || !(Array.isArray(state.system.fields) && state.system.fields.length);
      elements.clearButton.disabled = isEmpty;
      elements.clearButton.setAttribute("aria-disabled", isEmpty ? "true" : "false");
      if (isEmpty) {
        elements.clearButton.title = "Canvas is already empty.";
      } else {
        elements.clearButton.removeAttribute("title");
      }
    }

    if (elements.duplicateButton) {
      const canDuplicate = hasActiveSystem();
      elements.duplicateButton.classList.toggle("d-none", !canDuplicate);
      elements.duplicateButton.disabled = !canDuplicate;
      elements.duplicateButton.setAttribute("aria-disabled", canDuplicate ? "false" : "true");
    }

    updateSystemMeta();

    if (!elements.deleteButton) {
      return;
    }
    const metadata = getSystemMetadata(state.system?.id);
    const canWrite = dataManager.hasWriteAccess("systems");
    const canEditRecord = systemAllowsEdits(metadata);
    const hasIdentifier = Boolean(state.system?.id);
    const showDelete = hasIdentifier && canEditRecord && canWrite;
    elements.deleteButton.classList.toggle("d-none", !showDelete);
    if (!showDelete) {
      elements.deleteButton.disabled = true;
      elements.deleteButton.setAttribute("aria-disabled", "true");
      elements.deleteButton.removeAttribute("title");
      return;
    }
    const origin = state.system?.origin || "";
    const isBuiltin = origin === "builtin";
    const isDraft = origin === "draft";
    const deletable = !isBuiltin && !isDraft;
    elements.deleteButton.disabled = !deletable;
    elements.deleteButton.setAttribute("aria-disabled", deletable ? "false" : "true");
    if (isBuiltin) {
      elements.deleteButton.title = "Built-in systems cannot be deleted.";
    } else if (isDraft) {
      elements.deleteButton.title = "Save the system before deleting it.";
    } else {
      elements.deleteButton.removeAttribute("title");
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
        console.warn("System editor: unable to load builtin catalog", error);
      }
    }
    registerBuiltinContent();
  }

  function registerBuiltinContent() {
    listBuiltinSystems().forEach((system) => {
      registerSystemRecord(
        { id: system.id, title: system.title, path: system.path, source: "builtin", ownership: "builtin" },
        { syncOption: false }
      );
      verifyBuiltinAsset("systems", system, {
        skipProbe: Boolean(dataManager.baseUrl),
        onMissing: () => removeSystemRecord(system.id),
        onError: (error) => {
          console.warn("System editor: failed to verify builtin system", system.id, error);
        },
      });
    });
  }

  function verifyBuiltinAvailability(system) {
    if (!system || !system.id || !system.path) {
      return;
    }
    if (builtinIsTemporarilyMissing("systems", system.id)) {
      removeSystemRecord(system.id);
      return;
    }
    if (dataManager.baseUrl) {
      // When connected to the API the server-supplied catalog already
      // reflects which builtin assets exist, so avoid probing the
      // filesystem with fetch requests that would surface 404 errors in
      // the console when an asset has been removed.
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
          console.warn("System editor: unable to cancel builtin fetch", error);
        }
      })
      .catch((error) => {
        console.warn("System editor: failed to verify builtin system", system.id, error);
        markBuiltinMissing("systems", system.id);
        removeSystemRecord(system.id);
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
        registerSystemRecord(
          {
            id,
            title: payload?.title || id,
            source: "local",
            ownership: "local",
            permissions: "edit",
          },
          { syncOption: true }
        );
      });
    } catch (error) {
      console.warn("System editor: unable to read local systems", error);
    }
    if (!dataManager.baseUrl) {
      ensureSelectValue();
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
        registerSystemRecord(
          {
            id,
            title: payload?.title || id,
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
        registerSystemRecord(
          {
            id: item.id,
            title: item.title || item.id,
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
      ensureSelectValue();
    } catch (error) {
      console.warn("System editor: unable to list systems", error);
    }
  }

  function initializeSharedSystemHandling() {
    if (!pendingSharedSystemId) {
      return;
    }
    void loadPendingSharedSystem();
  }

  async function loadPendingSharedSystem() {
    if (!pendingSharedSystemId) {
      return;
    }
    const { id: targetId, shareToken = "" } = pendingSharedSystemId;
    pendingSharedSystemId = null;
    registerSystemRecord(
      {
        id: targetId,
        title: targetId,
        source: "remote",
        shareToken,
        ownership: "shared",
        permissions: "view",
      },
      { syncOption: true }
    );
    if (elements.select) {
      elements.select.value = targetId;
    }
    try {
      const result = await dataManager.get("systems", targetId, {
        preferLocal: !shareToken,
        shareToken,
      });
      const payload = result?.payload;
      if (!payload) {
        throw new Error("System payload missing");
      }
      const label = payload.title || systemCatalog.get(targetId)?.title || targetId;
      registerSystemRecord(
        { id: payload.id || targetId, title: label, source: "remote", shareToken },
        { syncOption: true }
      );
      applySystemData(payload, {
        origin: "remote",
        emitStatus: true,
        statusMessage: `Loaded ${label}`,
        shareToken,
      });
    } catch (error) {
      console.error("System editor: unable to load shared system", error);
      if (status) {
        status.show(error.message || "Unable to load shared system", { type: "danger" });
      }
    }
  }

  function ensureSelectOption(id, label) {
    if (!elements.select || !id) return;
    const escaped = escapeCss(id);
    if (!elements.select.querySelector(`option[value="${escaped}"]`)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label || id;
      elements.select.appendChild(option);
    } else {
      const option = elements.select.querySelector(`option[value="${escaped}"]`);
      if (option) {
        option.textContent = label || id;
      }
    }
  }

  function ensureSelectValue() {
    if (!elements.select) return;
    const currentId = state.system.id || "";
    const escaped = escapeCss(currentId);
    if (currentId) {
      const option = escaped ? elements.select.querySelector(`option[value="${escaped}"]`) : null;
      if (option) {
        elements.select.value = currentId;
        return;
      }
    }
    elements.select.value = "";
    const placeholder = elements.select.querySelector('option[value=""][disabled]');
    if (placeholder) {
      placeholder.selected = true;
    }
  }

  ensureSelectValue();

  function updateSystemMeta() {
    if (!elements.systemMeta) {
      return;
    }
    if (!hasActiveSystem()) {
      elements.systemMeta.textContent = "No system selected";
      return;
    }
    const systemId = state.system?.id || "—";
    const version = state.system?.version || "—";
    elements.systemMeta.textContent = `ID: ${systemId || "—"} • Version: ${version || "—"}`;
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

  function generateSystemId(name) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `sys.${crypto.randomUUID()}`;
    }
    const base = (name || "system").toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    return `sys.${slug || "system"}.${rand}`;
  }

  function generateDuplicateSystemId(baseId) {
    const raw = (baseId || "").trim();
    if (!raw) {
      return generateSystemId("system");
    }
    const normalized = raw.replace(/(\.copy\d*)$/i, "");
    const root = normalized || raw;
    let candidate = `${root}.copy`;
    let counter = 2;
    while (candidate && systemCatalog.has(candidate)) {
      candidate = `${root}.copy${counter}`;
      counter += 1;
    }
    return candidate;
  }

  function generateDuplicateSystemTitle(baseTitle) {
    const raw = (baseTitle || "").trim();
    const base = raw.replace(/\(Copy(?: \d+)?\)$/i, "").trim() || raw || "System";
    const existing = new Set(
      Array.from(systemCatalog.values()).map((entry) => (entry?.title || "").trim()).filter(Boolean)
    );
    let candidate = `${base} (Copy)`;
    let counter = 2;
    while (existing.has(candidate)) {
      candidate = `${base} (Copy ${counter})`;
      counter += 1;
    }
    return candidate;
  }

  function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `field-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  }

  function isDescendant(targetParentId, nodeId) {
    if (!targetParentId || targetParentId === "root") {
      return false;
    }
    if (targetParentId === nodeId) {
      return true;
    }
    const target = findNode(targetParentId);
    if (!target) {
      return false;
    }
    return isDescendant(target.parentId, nodeId);
  }

  function rememberDraft(system) {
    if (!system) {
      return;
    }
    drafts.set(getDraftKey(system.id), cloneSystem(system));
  }

  function persistCurrentDraft() {
    if (!state.system) {
      return;
    }
    drafts.set(getDraftKey(state.system.id), cloneSystem(state.system));
  }

  function restoreDraft(id) {
    const draft = drafts.get(getDraftKey(id));
    if (!draft) {
      return null;
    }
    return cloneSystem(draft);
  }

  function cloneSystem(system) {
    if (!system) {
      return createBlankSystem();
    }
    if (typeof structuredClone === "function") {
      return structuredClone(system);
    }
    return JSON.parse(JSON.stringify(system));
  }

  function getDraftKey(id) {
    return id && String(id).trim() ? String(id).trim() : "__blank__";
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
      console.warn("System editor: unable to parse shared record", error);
      return null;
    }
  }

  window.addEventListener("workbench:auth-changed", () => {
    if (dataManager.isAuthenticated()) {
      loadSystemRecords();
      if (pendingSharedSystemId) {
        void loadPendingSharedSystem();
      }
    }
  });

  window.addEventListener("workbench:content-saved", (event) => {
    const detail = event.detail || {};
    if (detail.bucket === "systems" && detail.source === "remote") {
      loadSystemRecords();
    }
  });

  window.addEventListener("workbench:content-deleted", (event) => {
    const detail = event.detail || {};
    if (detail.bucket === "systems" && detail.source === "remote") {
      loadSystemRecords();
    }
  });
})();
