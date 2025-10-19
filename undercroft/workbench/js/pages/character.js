import { initAppShell } from "../lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../lib/data-manager.js";
import { initAuthControls } from "../lib/auth-ui.js";
import { createCanvasPlaceholder } from "../lib/editor-canvas.js";
import { createCanvasCardElement, createStandardCardChrome } from "../lib/canvas-card.js";
import { createJsonPreviewRenderer } from "../lib/json-preview.js";
import { refreshTooltips } from "../lib/tooltips.js";
import { resolveApiBase } from "../lib/api.js";
import {
  listBuiltinTemplates,
  listBuiltinCharacters,
  listBuiltinSystems,
  markBuiltinMissing,
  markBuiltinAvailable,
  builtinIsTemporarilyMissing,
  applyBuiltinCatalog,
  verifyBuiltinAsset,
} from "../lib/content-registry.js";
import { COMPONENT_ICONS, applyComponentStyles, applyTextFormatting } from "../lib/component-styles.js";
import { evaluateFormula } from "../lib/formula-engine.js";
import {
  normalizeOptionEntries,
  resolveBindingFromContexts,
  buildSystemPreviewData,
} from "../lib/component-data.js";

(async () => {
  const { status, undoStack, undo, redo } = initAppShell({
    namespace: "character",
    onUndo: handleUndoEntry,
    onRedo: handleRedoEntry,
  });
  const dataManager = new DataManager({ baseUrl: resolveApiBase() });
  initAuthControls({ root: document, status, dataManager });

  const templateCatalog = new Map();
  const characterCatalog = new Map();
  const systemCatalog = new Map();
  const systemDefinitionCache = new Map();

  function sessionUser() {
    return dataManager.session?.user || null;
  }

  const state = {
    mode: "view",
    template: null,
    components: [],
    character: null,
    draft: null,
    characterOrigin: null,
    systemDefinition: null,
    systemPreviewData: {},
  };

  let lastSavedCharacterSignature = null;

  markCharacterClean();

  let suppressNotesChange = false;
  let currentNotesKey = "";
  let componentCounter = 0;
  let pendingSharedRecord = resolveSharedRecordParam("characters");

  function cloneValue(value) {
    if (value === undefined) {
      return undefined;
    }
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch (error) {
        // fall through to JSON clone
      }
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function valuesEqual(a, b) {
    if (a === b) {
      return true;
    }
    if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
      return true;
    }
    if (a === undefined || b === undefined) {
      return a === b;
    }
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (error) {
      return false;
    }
  }

  function resolveBindingPath(binding) {
    const normalized = normalizeBinding(binding);
    if (!normalized || typeof normalized !== "string" || !normalized.startsWith("@")) {
      return null;
    }
    const segments = normalized
      .slice(1)
      .split(".")
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments.length ? segments : null;
  }

  function getValueAtPath(pathSegments) {
    if (!Array.isArray(pathSegments) || !pathSegments.length) {
      return undefined;
    }
    let cursor = state.draft?.data;
    for (const segment of pathSegments) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
        return undefined;
      }
      cursor = cursor[segment];
    }
    return cursor;
  }

  function setValueAtPath(pathSegments, value) {
    if (!Array.isArray(pathSegments) || !pathSegments.length) {
      return false;
    }
    if (!state.draft) {
      return false;
    }
    if (!state.draft.data || typeof state.draft.data !== "object") {
      if (value === undefined) {
        return false;
      }
      state.draft.data = {};
    }
    let cursor = state.draft.data;
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
      const key = pathSegments[index];
      if (!cursor[key] || typeof cursor[key] !== "object") {
        if (value === undefined) {
          return false;
        }
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    const lastKey = pathSegments[pathSegments.length - 1];
    if (value === undefined) {
      if (cursor && typeof cursor === "object" && Object.prototype.hasOwnProperty.call(cursor, lastKey)) {
        delete cursor[lastKey];
        return true;
      }
      return false;
    }
    cursor[lastKey] = value;
    return true;
  }

  function applyBindingValue(pathSegments, value, { focusSnapshot = null } = {}) {
    const applied = setValueAtPath(pathSegments, cloneValue(value));
    renderCanvas();
    if (focusSnapshot) {
      restoreActiveField(focusSnapshot);
    }
    void persistDraft({ silent: true });
    renderPreview();
    return applied;
  }

  function userOwnsCharacter(id) {
    if (!id) {
      return false;
    }
    const metadata = characterCatalog.get(id);
    if (!metadata) {
      return true;
    }
    const ownership = (metadata.ownership || "").toLowerCase();
    if (ownership === "shared") {
      return false;
    }
    if (ownership === "local" || ownership === "draft") {
      return true;
    }
    const user = sessionUser();
    if (!user || !dataManager.isAuthenticated()) {
      return false;
    }
    if (typeof metadata.ownerId === "number" && typeof user.id === "number") {
      return metadata.ownerId === user.id;
    }
    if (metadata.ownerUsername && user.username) {
      return metadata.ownerUsername === user.username;
    }
    return ownership !== "shared";
  }

  function resolveOwnerLabel(metadata) {
    if (!metadata) {
      return "the owner";
    }
    if (metadata.ownerUsername) {
      return metadata.ownerUsername;
    }
    return "the owner";
  }

  const elements = {
    characterSelect: document.querySelector("[data-character-select]"),
    canvasRoot: document.querySelector("[data-canvas-root]"),
    saveButton: document.querySelector('[data-action="save-character"]'),
    undoButton: document.querySelector('[data-action="undo-character"]'),
    redoButton: document.querySelector('[data-action="redo-character"]'),
    importButton: document.querySelector('[data-action="import-character"]'),
    exportButton: document.querySelector('[data-action="export-character"]'),
    newCharacterButton: document.querySelector('[data-action="new-character"]'),
    deleteCharacterButton: document.querySelector('[data-delete-character]'),
    viewToggle: document.querySelector('[data-action="toggle-mode"]'),
    modeIndicator: document.querySelector("[data-mode-indicator]"),
    noteEditor: document.querySelector("[data-note-editor]"),
    jsonPreview: document.querySelector("[data-json-preview]"),
    jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
    diceForm: document.querySelector("[data-dice-form]"),
    diceExpression: document.querySelector("[data-dice-expression]"),
    diceResult: document.querySelector("[data-dice-result]"),
    newCharacterForm: document.querySelector("[data-new-character-form]"),
    newCharacterId: document.querySelector("[data-new-character-id]"),
    newCharacterName: document.querySelector("[data-new-character-name]"),
    newCharacterTemplate: document.querySelector("[data-new-character-template]"),
  };

  const renderPreview = createJsonPreviewRenderer({
    target: elements.jsonPreview,
    bytesTarget: elements.jsonPreviewBytes,
    serialize: () => state.draft || {},
  });

  let newCharacterModalInstance = null;
  if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
    const modalElement = document.getElementById("new-character-modal");
    if (modalElement) {
      newCharacterModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
    }
  }

  await initializeBuiltins();
  initNotesEditor();
  initDiceRoller();
  bindUiEvents();
  loadTemplateRecords();
  loadCharacterRecords();
  syncModeIndicator();
  renderCanvas();
  renderPreview();
  syncCharacterActions();
  initializeSharedRecordHandling();

  function bindUiEvents() {
    if (elements.characterSelect) {
      elements.characterSelect.addEventListener("change", async () => {
        const selectedId = elements.characterSelect.value;
        if (selectedId) {
          await loadCharacter(selectedId);
        }
      });
    }

    if (elements.saveButton) {
      elements.saveButton.addEventListener("click", async () => {
        if (!state.draft?.id) {
          status.show("Create or load a character first.", { type: "info", timeout: 2000 });
          return;
        }
        if (!dataManager.isAuthenticated()) {
          status.show("Sign in to save characters to the server.", { type: "warning", timeout: 2600 });
          return;
        }
        if (!userOwnsCharacter(state.draft.id)) {
          const metadata = characterCatalog.get(state.draft.id) || {};
          const ownerLabel = resolveOwnerLabel(metadata);
          status.show(`Only ${ownerLabel} can save this character.`, { type: "warning", timeout: 2600 });
          return;
        }
        if (!dataManager.hasWriteAccess("characters")) {
          const required = dataManager.describeRequiredWriteTier("characters");
          const message = required
            ? `Saving characters requires a ${required} tier.`
            : "Your tier cannot save characters.";
          status.show(message, { type: "warning", timeout: 2600 });
          return;
        }
        const button = elements.saveButton;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        try {
          await persistDraft({ silent: false });
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

    if (elements.importButton) {
      elements.importButton.addEventListener("click", () => {
        status.show("Import coming soon", { type: "info", timeout: 2000 });
      });
    }

    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", () => {
        if (!state.draft) {
          status.show("Nothing to export yet.", { type: "info", timeout: 2000 });
          return;
        }
        exportDraft();
      });
    }

    if (elements.newCharacterButton) {
      elements.newCharacterButton.addEventListener("click", () => {
        openNewCharacterDialog();
      });
    }

    if (elements.newCharacterId) {
      elements.newCharacterId.addEventListener("input", () => {
        elements.newCharacterId.setCustomValidity("");
      });
    }

    if (elements.deleteCharacterButton) {
      elements.deleteCharacterButton.addEventListener("click", () => {
        deleteCurrentCharacter();
      });
    }

    if (elements.viewToggle) {
      elements.viewToggle.addEventListener("click", async () => {
        const nextMode = state.mode === "edit" ? "view" : "edit";
        if (state.mode === "edit" && state.draft?.id) {
          await persistDraft({ silent: true });
          renderPreview();
        }
        state.mode = nextMode;
        syncModeIndicator();
        renderCanvas();
        status.show(state.mode === "edit" ? "Edit mode enabled" : "View mode enabled", {
          type: "info",
          timeout: 1500,
        });
      });
    }

    if (elements.newCharacterForm) {
      elements.newCharacterForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = elements.newCharacterForm;
        if (typeof form.reportValidity === "function" && !form.reportValidity()) {
          form.classList.add("was-validated");
          return;
        }
        await createNewCharacterFromForm();
      });
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
        console.warn("Character sheet: unable to load builtin catalog", error);
      }
    }
    registerBuiltinContent();
  }

  function registerBuiltinContent() {
    listBuiltinTemplates().forEach((template) => {
      if (builtinIsTemporarilyMissing("templates", template.id)) {
        return;
      }
      registerTemplateRecord({
        id: template.id,
        title: template.title,
        path: template.path,
        source: "builtin",
      });
    });
    listBuiltinCharacters().forEach((character) => {
      if (builtinIsTemporarilyMissing("characters", character.id)) {
        return;
      }
      registerCharacterRecord({
        id: character.id,
        title: character.title,
        path: character.path,
        template: character.template,
        source: "builtin",
      });
      verifyBuiltinAsset("characters", character, {
        skipProbe: Boolean(dataManager.baseUrl),
        onMissing: () => removeCharacterRecord(character.id),
        onError: (error) => {
          console.warn("Character editor: failed to verify builtin character", character.id, error);
        },
      });
    });
    listBuiltinSystems().forEach((system) => {
      if (builtinIsTemporarilyMissing("systems", system.id)) {
        return;
      }
      registerSystemRecord({
        id: system.id,
        title: system.title,
        path: system.path,
        source: "builtin",
      });
      verifyBuiltinAsset("systems", system, {
        skipProbe: Boolean(dataManager.baseUrl),
        onMissing: () => removeSystemRecord(system.id),
        onError: (error) => {
          console.warn("Character editor: failed to verify builtin system", system.id, error);
        },
      });
    });
  }

  function registerTemplateRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const current = templateCatalog.get(record.id) || {};
    templateCatalog.set(record.id, { ...current, ...record });
    const selected = elements.newCharacterTemplate?.value || "";
    refreshNewCharacterTemplateOptions(selected);
    syncCharacterOptions();
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

  function removeTemplateRecord(id) {
    if (!id) {
      return;
    }
    if (!templateCatalog.has(id)) {
      return;
    }
    templateCatalog.delete(id);
    const selected = elements.newCharacterTemplate?.value || "";
    refreshNewCharacterTemplateOptions(selected);
    syncCharacterOptions();
  }

  function removeSystemRecord(id) {
    if (!id) {
      return;
    }
    systemCatalog.delete(id);
    systemDefinitionCache.delete(id);
  }

  function resetSystemContext() {
    state.systemDefinition = null;
    state.systemPreviewData = {};
  }

  async function fetchSystemDefinition(systemId) {
    if (!systemId) {
      return null;
    }
    if (systemDefinitionCache.has(systemId)) {
      return systemDefinitionCache.get(systemId);
    }
    const metadata = systemCatalog.get(systemId) || {};
    if (metadata.payload) {
      systemDefinitionCache.set(systemId, metadata.payload);
      return metadata.payload;
    }
    if (metadata.path) {
      try {
        if (metadata.source === "builtin" && builtinIsTemporarilyMissing("systems", systemId)) {
          return null;
        }
        const response = await fetch(metadata.path, { cache: "no-store" });
        if (!response.ok) {
          markBuiltinMissing("systems", systemId);
          removeSystemRecord(systemId);
          throw new Error(`Failed to fetch system: ${response.status}`);
        }
        const payload = await response.json();
        markBuiltinAvailable("systems", systemId);
        systemDefinitionCache.set(systemId, payload);
        registerSystemRecord({
          id: systemId,
          title: payload.title || systemId,
          source: metadata.source || "builtin",
          payload,
        });
        return payload;
      } catch (error) {
        console.warn("Character editor: unable to load builtin system", error);
        return null;
      }
    }
    try {
      const local = dataManager.getLocal("systems", systemId);
      if (local) {
        systemDefinitionCache.set(systemId, local);
        registerSystemRecord({ id: systemId, title: local.title || systemId, source: "local", payload: local });
        return local;
      }
    } catch (error) {
      console.warn("Character editor: unable to read local system", error);
    }
    if (!dataManager.baseUrl) {
      return null;
    }
    try {
      const shareToken = metadata.shareToken || "";
      const result = await dataManager.get("systems", systemId, {
        preferLocal: !shareToken,
        shareToken,
      });
      const payload = result?.payload || null;
      if (payload) {
        systemDefinitionCache.set(systemId, payload);
        registerSystemRecord({
          id: systemId,
          title: payload.title || systemId,
          source: result?.source || "remote",
          shareToken,
          payload,
        });
      }
      return payload;
    } catch (error) {
      console.warn("Character editor: unable to fetch system", error);
      return null;
    }
  }

  async function updateSystemContext(systemId) {
    resetSystemContext();
    if (!systemId) {
      renderCanvas();
      return;
    }
    try {
      const definition = await fetchSystemDefinition(systemId);
      if (definition) {
        state.systemDefinition = definition;
        state.systemPreviewData = buildSystemPreviewData(definition);
      }
    } catch (error) {
      console.warn("Character editor: unable to prepare system context", error);
    }
    renderCanvas();
  }

  function normalizeCharacterRecord(record = {}, current = {}) {
    const next = { ...record };
    if (next.owner_id !== undefined && next.ownerId === undefined) {
      next.ownerId = next.owner_id;
    }
    if (next.owner_username !== undefined && next.ownerUsername === undefined) {
      next.ownerUsername = next.owner_username;
    }
    if (next.owner_tier !== undefined && next.ownerTier === undefined) {
      next.ownerTier = next.owner_tier;
    }
    if (next.permissions !== undefined && next.sharePermissions === undefined) {
      next.sharePermissions = next.permissions;
    }
    if (next.share_token !== undefined && next.shareToken === undefined) {
      next.shareToken = next.share_token;
    }
    if (next.template_title !== undefined && next.templateTitle === undefined) {
      next.templateTitle = next.template_title;
    }
    delete next.owner_id;
    delete next.owner_username;
    delete next.owner_tier;
    delete next.permissions;
    delete next.share_token;
    delete next.template_title;

    if (!next.ownership && current.ownership) {
      next.ownership = current.ownership;
    }
    if (!next.ownerId && current.ownerId) {
      next.ownerId = current.ownerId;
    }
    if (!next.ownerUsername && current.ownerUsername) {
      next.ownerUsername = current.ownerUsername;
    }
    if (!next.ownerTier && current.ownerTier) {
      next.ownerTier = current.ownerTier;
    }
    if (!next.sharePermissions && current.sharePermissions) {
      next.sharePermissions = current.sharePermissions;
    }
    if (!next.shareToken && current.shareToken) {
      next.shareToken = current.shareToken;
    }
    if (!next.templateTitle && current.templateTitle) {
      next.templateTitle = current.templateTitle;
    }
    Object.keys(next).forEach((key) => {
      if (next[key] === undefined) {
        delete next[key];
      }
    });
    return next;
  }

  function registerCharacterRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const current = characterCatalog.get(record.id) || {};
    const normalized = normalizeCharacterRecord(record, current);
    const merged = { ...current, ...normalized };
    characterCatalog.set(record.id, merged);

    const templateId = merged.template || "";
    if (templateId && !templateCatalog.has(templateId)) {
      const inferredSource = merged.source === "local" ? "local" : merged.source === "builtin" ? "builtin" : "remote";
      registerTemplateRecord({ id: templateId, title: merged.templateTitle || templateId, source: inferredSource });
    }
    syncCharacterOptions();
    syncCharacterActions();
  }

  function syncCharacterOptions() {
    if (!elements.characterSelect) {
      return;
    }
    const options = Array.from(characterCatalog.values())
      .filter((entry) => entry.id)
      .map((entry) => {
        const templateId = entry.template || "";
        const templateLabel = templateId
          ? templateCatalog.get(templateId)?.title || templateId
          : "";
        const baseLabel = entry.title || entry.id;
        const label = templateLabel ? `${baseLabel} (${templateLabel})` : baseLabel;
        return { value: entry.id, label, sortLabel: label.toLowerCase() };
      })
      .sort((a, b) => a.sortLabel.localeCompare(b.sortLabel, undefined, { sensitivity: "base" }));
    populateSelect(
      elements.characterSelect,
      options.map(({ value, label }) => ({ value, label })),
      { placeholder: "Select character" }
    );
    const value = state.draft?.id || "";
    elements.characterSelect.value = value;
  }

  function refreshNewCharacterTemplateOptions(selectedValue = "") {
    if (!elements.newCharacterTemplate) {
      return;
    }
    const options = Array.from(templateCatalog.values())
      .filter((entry) => entry.id)
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    populateSelect(elements.newCharacterTemplate, options, { placeholder: "Select template" });
    if (selectedValue) {
      elements.newCharacterTemplate.value = selectedValue;
    }
  }

  function removeCharacterRecord(id) {
    if (!id) {
      return;
    }
    characterCatalog.delete(id);
    syncCharacterOptions();
    syncCharacterActions();
  }

  function syncCharacterActions() {
    const hasDraft = Boolean(state.draft);
    if (elements.saveButton) {
      const hasChanges = hasDraft && hasUnsavedCharacterChanges();
      const isAuthenticated = dataManager.isAuthenticated();
      const canWrite = dataManager.hasWriteAccess("characters");
      const ownsRecord = hasDraft ? userOwnsCharacter(state.draft.id) : false;
      const enabled = hasDraft && hasChanges && isAuthenticated && canWrite && ownsRecord;
      elements.saveButton.disabled = !enabled;
      elements.saveButton.setAttribute("aria-disabled", enabled ? "false" : "true");
      if (!hasDraft) {
        elements.saveButton.title = "Create or load a character to save.";
      } else if (!isAuthenticated) {
        elements.saveButton.title = "Sign in to save characters to the server.";
      } else if (!canWrite) {
        const required = dataManager.describeRequiredWriteTier("characters");
        elements.saveButton.title = required
          ? `Saving characters requires a ${required} tier.`
          : "Your tier cannot save characters.";
      } else if (!ownsRecord) {
        const metadata = characterCatalog.get(state.draft.id) || {};
        const ownerLabel = resolveOwnerLabel(metadata);
        elements.saveButton.title = `Only ${ownerLabel} can save this character.`;
      } else if (!hasChanges) {
        elements.saveButton.title = "No changes to save.";
      } else {
        elements.saveButton.removeAttribute("title");
      }
    }

    if (!elements.deleteCharacterButton) {
      return;
    }
    const hasCharacter = Boolean(state.draft?.id);
    elements.deleteCharacterButton.classList.toggle("d-none", !hasCharacter);
    if (!hasCharacter) {
      elements.deleteCharacterButton.disabled = true;
      elements.deleteCharacterButton.setAttribute("aria-disabled", "true");
      elements.deleteCharacterButton.removeAttribute("title");
      return;
    }
    const metadata = state.draft?.id ? characterCatalog.get(state.draft.id) : null;
    let origin = state.characterOrigin || metadata?.source || metadata?.origin || state.character?.origin || "";
    let deletable = origin === "local";
    if (!deletable && state.draft?.id) {
      try {
        const localSnapshot = dataManager.getLocal("characters", state.draft.id);
        if (localSnapshot) {
          deletable = true;
          origin = "local";
          state.characterOrigin = "local";
        }
      } catch (error) {
        console.warn("Character editor: unable to inspect local character entry", error);
      }
    }
    const isBuiltin = origin === "builtin";
    elements.deleteCharacterButton.disabled = !deletable;
    elements.deleteCharacterButton.classList.toggle("disabled", !deletable);
    elements.deleteCharacterButton.setAttribute("aria-disabled", deletable ? "false" : "true");
    if (!deletable) {
      const message = isBuiltin
        ? "Built-in characters cannot be deleted."
        : "Only local characters can be deleted right now.";
      elements.deleteCharacterButton.title = message;
    } else {
      elements.deleteCharacterButton.removeAttribute("title");
    }
  }

  function initNotesEditor() {
    if (!elements.noteEditor) {
      return;
    }
    elements.noteEditor.addEventListener("input", () => {
      if (suppressNotesChange) {
        return;
      }
      persistNotes(elements.noteEditor.value);
    });
    syncNotesEditor(true);
  }

  function initDiceRoller() {
    if (!elements.diceForm || !elements.diceExpression || !elements.diceResult) {
      return;
    }
    elements.diceForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const expression = elements.diceExpression.value.trim();
      if (!expression) {
        elements.diceResult.textContent = "Enter a dice expression like 2d6 + 3.";
        return;
      }
      const result = rollDiceExpression(expression);
      if (!result) {
        elements.diceResult.textContent = "Unsupported expression. Try NdM ± K.";
        return;
      }
      const { total, rolls, modifier } = result;
      const breakdown = `${rolls.join(" + ")}${modifier ? (modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`) : ""}`;
      elements.diceResult.innerHTML = `<strong>Total:</strong> ${total}<br /><span class="text-body-secondary">${breakdown}</span>`;
    });
  }

  function rollDiceExpression(input) {
    const trimmed = input.replace(/\s+/g, "").toLowerCase();
    const match = trimmed.match(/^(\d*)d(\d+)([+-]\d+)?$/);
    if (!match) {
      return null;
    }
    const count = Math.min(Math.max(parseInt(match[1] || "1", 10), 1), 100);
    const sides = Math.min(Math.max(parseInt(match[2], 10), 2), 1000);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;
    const rolls = [];
    for (let index = 0; index < count; index += 1) {
      rolls.push(1 + Math.floor(Math.random() * sides));
    }
    const total = rolls.reduce((sum, value) => sum + value, 0) + modifier;
    return { total, rolls, modifier };
  }

  async function loadTemplateRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("templates");
      localEntries.forEach(({ id, payload }) => {
        if (!id) return;
        registerTemplateRecord({
          id,
          title: payload?.title || id,
          schema: payload?.schema || payload?.system || "",
          source: "local",
        });
      });
    } catch (error) {
      console.warn("Character editor: unable to read local templates", error);
    }
    const selected = elements.newCharacterTemplate?.value || "";
    if (!dataManager.baseUrl) {
      refreshNewCharacterTemplateOptions(selected);
      return;
    }
    try {
      const { remote } = await dataManager.list("templates", { refresh: true, includeLocal: false });
      const items = Array.isArray(remote?.items) ? remote.items : [];
      items.forEach((item) => {
        if (!item || !item.id) return;
        const shareToken = item.shareToken || item.share_token || "";
        registerTemplateRecord({
          id: item.id,
          title: item.title || item.id,
          schema: item.schema || "",
          source: "remote",
          shareToken,
        });
      });
    } catch (error) {
      console.warn("Character editor: unable to list templates", error);
    } finally {
      refreshNewCharacterTemplateOptions(selected);
    }
  }

  async function loadCharacterRecords() {
    try {
      const localEntries = dataManager.listLocalEntries("characters");
      const user = sessionUser();
      localEntries.forEach((entry) => {
        const { id, payload, owner } = entry;
        if (!id) return;
        if (!dataManager.localEntryBelongsToCurrentUser(entry)) {
          return;
        }
        const isOwner = dataManager.isAuthenticated();
        const ownerSnapshot =
          owner ||
          (isOwner && user
            ? { id: user.id ?? null, username: user.username || "", tier: dataManager.getUserTier() }
            : null);
        registerCharacterRecord({
          id,
          title: payload?.data?.name || payload?.title || id,
          template: payload?.template || "",
          templateTitle: payload?.templateTitle || "",
          source: "local",
          ownership: isOwner ? "owned" : "local",
          ownerId: ownerSnapshot?.id ?? null,
          ownerUsername: ownerSnapshot?.username || "",
          ownerTier: ownerSnapshot?.tier || "",
        });
      });
    } catch (error) {
      console.warn("Character editor: unable to read local characters", error);
    }
    syncCharacterOptions();
    if (dataManager.isAuthenticated()) {
      await refreshRemoteCharacters({ force: true });
    }
  }

  async function refreshRemoteCharacters({ force = false } = {}) {
    if (!dataManager.isAuthenticated()) {
      return;
    }
    try {
      const { remote } = await dataManager.list("characters", { refresh: force, includeLocal: false });
      const session = sessionUser();
      const owned = Array.isArray(remote?.owned) ? remote.owned : [];
      const ownedIds = [];
      owned.forEach((entry) => {
        if (!entry || !entry.id) return;
        ownedIds.push(entry.id);
        registerCharacterRecord({
          id: entry.id,
          title: entry.name || entry.title || entry.id,
          template: entry.template || "",
          templateTitle: entry.template_title || "",
          source: "remote",
          ownership: "owned",
          ownerId: entry.owner_id ?? session?.id ?? null,
          ownerUsername: entry.owner_username || session?.username || "",
          ownerTier: entry.owner_tier || session?.tier || "",
        });
      });
      const adopted = dataManager.adoptLegacyRecords("characters", ownedIds);
      adopted.forEach(({ id, payload, owner }) => {
        if (!id) return;
        registerCharacterRecord({
          id,
          title: payload?.data?.name || payload?.title || id,
          template: payload?.template || "",
          templateTitle: payload?.templateTitle || "",
          source: "remote",
          ownership: "owned",
          ownerId: owner?.id ?? session?.id ?? null,
          ownerUsername: owner?.username || session?.username || "",
          ownerTier: owner?.tier || session?.tier || "",
        });
      });
      const shared = Array.isArray(remote?.shared) ? remote.shared : [];
      shared.forEach((entry) => {
        if (!entry || !entry.id) return;
        registerCharacterRecord({
          id: entry.id,
          title: entry.name || entry.title || entry.id,
          template: entry.template || "",
          templateTitle: entry.template_title || "",
          source: "remote",
          ownership: "shared",
          ownerId: entry.owner_id ?? null,
          ownerUsername: entry.owner_username || "",
          ownerTier: entry.owner_tier || "",
          sharePermissions: entry.permissions || "",
        });
      });
      syncCharacterOptions();
    } catch (error) {
      console.warn("Character editor: unable to refresh remote characters", error);
    }
  }

  function initializeSharedRecordHandling() {
    if (!pendingSharedRecord) {
      return;
    }
    void loadPendingSharedRecord();
  }

  async function loadPendingSharedRecord() {
    if (!pendingSharedRecord) {
      return;
    }
    const { id: targetId, shareToken = "" } = pendingSharedRecord;
    pendingSharedRecord = null;
    registerCharacterRecord({
      id: targetId,
      title: targetId,
      template: "",
      source: "remote",
      ownership: "shared",
      shareToken,
    });
    syncCharacterOptions();
    try {
      await loadCharacter(targetId, { shareToken });
    } catch (error) {
      console.error("Character editor: unable to load shared character", error);
      if (status) {
        status.show(error.message || "Unable to load shared character", { type: "danger" });
      }
    }
  }

  async function loadTemplateById(id, { announce = false } = {}) {
    if (!id) {
      return;
    }
    try {
      const metadata = templateCatalog.get(id);
      if (!metadata) {
        throw new Error("Template metadata unavailable");
      }
      const payload = await fetchTemplatePayload(metadata);
      if (!payload) {
        throw new Error("Template payload missing");
      }
      applyTemplateData(payload, { origin: metadata.source || "remote" });
      if (announce) {
        status.show(`Loaded template ${payload.title || id}`, { type: "success", timeout: 1800 });
      }
    } catch (error) {
      console.error("Character editor: failed to load template", error);
      status.show("Unable to load template", { type: "error", timeout: 2500 });
    }
  }

  async function fetchTemplatePayload(metadata) {
    if (!metadata) {
      return null;
    }
    if (metadata.source === "builtin") {
      const templateId = metadata.id || "";
      if (builtinIsTemporarilyMissing("templates", templateId)) {
        removeTemplateRecord(templateId);
        throw new Error("Builtin template unavailable");
      }
    }
    if (metadata.source === "local") {
      const local = dataManager.getLocal("templates", metadata.id);
      if (local) {
        return JSON.parse(JSON.stringify(local));
      }
    }
    if (metadata.source === "builtin" && metadata.path) {
      const response = await fetch(metadata.path);
      const templateId = metadata.id || "";
      if (!response.ok) {
        markBuiltinMissing("templates", templateId);
        removeTemplateRecord(templateId);
        throw new Error(`Failed to fetch template: ${response.status}`);
      }
      markBuiltinAvailable("templates", templateId);
      return await response.json();
    }
    if (metadata.source === "remote" && dataManager.baseUrl) {
      const result = await dataManager.get("templates", metadata.id, { preferLocal: true });
      return result?.payload || null;
    }
    return null;
  }

  function applyTemplateData(payload, { origin = "remote" } = {}) {
    const template = {
      id: payload.id || payload.template || "",
      title: payload.title || payload.name || payload.id || "",
      schema: payload.schema || payload.system || "",
      origin,
      metadata: cloneValue(payload.metadata) || undefined,
      data: cloneValue(payload.data) || undefined,
      sources: cloneValue(payload.sources) || undefined,
      preview: cloneValue(payload.preview) || undefined,
      sample: cloneValue(payload.sample) || undefined,
      samples: cloneValue(payload.samples) || undefined,
    };
    componentCounter = 0;
    const components = Array.isArray(payload.components)
      ? payload.components.map((component) => hydrateComponent(component)).filter(Boolean)
      : [];
    resetSystemContext();
    state.template = template;
    state.components = components;
    if (template.id) {
      registerTemplateRecord({
        id: template.id,
        title: template.title || template.id,
        schema: template.schema || "",
        source: origin,
      });
    }
    if (state.draft) {
      state.draft.template = template.id;
    }
    void updateSystemContext(template.schema);
    renderCanvas();
    renderPreview();
  }

  async function loadCharacter(id, { shareToken = "" } = {}) {
    if (!id) {
      return;
    }
    try {
      const metadata = characterCatalog.get(id);
      if (!metadata) {
        throw new Error("Character metadata missing");
      }
      const token = shareToken || metadata.shareToken || "";
      const payload = await fetchCharacterPayload(metadata, { shareToken: token });
      if (!payload) {
        throw new Error("Character payload missing");
      }
      state.character = cloneCharacter(payload);
      state.draft = cloneCharacter(payload);
      state.characterOrigin = metadata.source || payload.origin || "";
      registerCharacterRecord({
        id: state.draft.id,
        title: state.draft.data?.name || metadata.title || state.draft.id,
        template: state.draft.template || metadata.template || "",
        source: metadata.source,
        ownership: metadata.ownership,
        ownerId: metadata.ownerId,
        ownerUsername: metadata.ownerUsername,
        ownerTier: metadata.ownerTier,
        sharePermissions: metadata.sharePermissions,
        shareToken: token,
      });
      if (state.draft.template) {
        await loadTemplateById(state.draft.template);
      }
      if (!state.draft.data || typeof state.draft.data !== "object") {
        state.draft.data = {};
      }
      markCharacterClean();
      syncNotesEditor();
      renderCanvas();
      renderPreview();
      syncCharacterOptions();
      syncCharacterActions();
      status.show(`Loaded ${state.draft.data?.name || metadata.title || state.draft.id}`, {
        type: "success",
        timeout: 2000,
      });
    } catch (error) {
      console.error("Character editor: failed to load character", error);
      const pruned = handleCharacterLoadFailure(id, error);
      const message = pruned
        ? "That character is no longer available and was removed from your list."
        : "Unable to load character";
      const type = pruned ? "warning" : "error";
      status.show(message, { type, timeout: 2800 });
    }

    return true;
  }

  function handleCharacterLoadFailure(id, error) {
    const metadata = characterCatalog.get(id);
    if (!metadata) {
      return false;
    }
    const source = (metadata.source || "").toLowerCase();
    const statusCode = typeof error?.status === "number" ? error.status : null;
    const message = error?.message || "";
    const isMissingCharacter =
      statusCode === 404 ||
      statusCode === 410 ||
      message === "Character metadata missing" ||
      message === "Character payload missing" ||
      message.startsWith("Failed to fetch character");
    const isTemplateFailure =
      message === "Template metadata unavailable" || message === "Template payload missing";
    if (source === "builtin" && isMissingCharacter) {
      markBuiltinMissing("characters", id);
    }
    const isRemovable = isMissingCharacter || (source !== "builtin" && isTemplateFailure);

    if (!isRemovable) {
      return false;
    }

    try {
      dataManager.removeLocal("characters", id);
    } catch (storageError) {
      console.warn("Character editor: unable to clear local cache for", id, storageError);
    }

    removeCharacterRecord(id);

    if (state.draft && state.draft.id === id) {
      state.character = null;
      state.draft = null;
      state.characterOrigin = null;
      state.template = null;
      state.components = [];
      resetSystemContext();
      markCharacterClean();
      renderCanvas();
      renderPreview();
      syncCharacterActions();
    }

    if (elements.characterSelect && elements.characterSelect.value === id) {
      elements.characterSelect.value = "";
    }

    return true;
  }

  async function fetchCharacterPayload(metadata, { shareToken = "" } = {}) {
    if (!metadata) {
      return null;
    }
    if (metadata.source === "local") {
      const local = dataManager.getLocal("characters", metadata.id);
      if (local) {
        return JSON.parse(JSON.stringify(local));
      }
    }
    if (metadata.source === "builtin") {
      const characterId = metadata.id || "";
      if (characterId && builtinIsTemporarilyMissing("characters", characterId)) {
        removeCharacterRecord(characterId);
        const error = new Error("Failed to fetch character: 404");
        error.status = 404;
        throw error;
      }
    }
    if (metadata.source === "builtin" && metadata.path) {
      const characterId = metadata.id || "";
      try {
        const response = await fetch(metadata.path, { cache: "no-store" });
        if (!response.ok) {
          markBuiltinMissing("characters", characterId);
          removeCharacterRecord(characterId);
          const error = new Error(`Failed to fetch character: ${response.status}`);
          error.status = response.status;
          throw error;
        }
        markBuiltinAvailable("characters", characterId);
        return await response.json();
      } catch (fetchError) {
        markBuiltinMissing("characters", characterId);
        removeCharacterRecord(characterId);
        const error =
          fetchError instanceof Error ? fetchError : new Error("Failed to fetch character");
        if (typeof error.status !== "number") {
          error.status = 500;
        }
        if (!error.message || error.message === fetchError?.message) {
          error.message = `Failed to fetch character: ${error.status}`;
        }
        throw error;
      }
    }
    if (metadata.source === "remote" && dataManager.baseUrl) {
      const result = await dataManager.get("characters", metadata.id, {
        preferLocal: !shareToken,
        shareToken,
      });
      return result?.payload || null;
    }
    return null;
  }

  function renderCanvas() {
    if (!elements.canvasRoot) {
      return;
    }
    elements.canvasRoot.dataset.canvasMode = state.mode;
    elements.canvasRoot.innerHTML = "";
    if (!state.draft?.id) {
      elements.canvasRoot.appendChild(
        createCanvasPlaceholder("Select a character to view the sheet.", { variant: "root" })
      );
      refreshTooltips(elements.canvasRoot);
      syncModeIndicator();
      return;
    }
    if (!state.template?.id) {
      elements.canvasRoot.appendChild(
        createCanvasPlaceholder("The linked template could not be loaded.", { variant: "root" })
      );
      refreshTooltips(elements.canvasRoot);
      syncModeIndicator();
      return;
    }
    if (!state.components.length) {
      elements.canvasRoot.appendChild(
        createCanvasPlaceholder("This template has no components yet.", { variant: "root" })
      );
      refreshTooltips(elements.canvasRoot);
      syncModeIndicator();
      return;
    }
    const fragment = document.createDocumentFragment();
    state.components.forEach((component) => {
      fragment.appendChild(renderComponentCard(component));
    });
    elements.canvasRoot.appendChild(fragment);
    refreshTooltips(elements.canvasRoot);
    syncModeIndicator();
  }

  function renderComponentCard(component) {
    const iconName = COMPONENT_ICONS[component.type] || "tabler:app-window";
    const wrapper = createCanvasCardElement({
      classes: ["character-component"],
      dataset: { componentId: component.uid || "" },
      gapClass: "gap-3",
    });
    const { header } = createStandardCardChrome({
      icon: iconName,
      iconLabel: component.type,
      headerOptions: { classes: ["character-component-header"], sortableHandle: false },
      actionsOptions: { classes: ["character-component-actions"] },
      iconOptions: { classes: ["character-component-icon"] },
      removeButtonOptions: false,
    });
    wrapper.appendChild(header);
    const body = renderComponentContent(component);
    wrapper.appendChild(body);
    applyComponentStyles(wrapper, component);
    return wrapper;
  }

  function renderComponentContent(component) {
    switch (component.type) {
      case "input":
        return renderInputComponent(component);
      case "array":
        return renderArrayComponent(component);
      case "divider":
        return renderDividerComponent(component);
      case "image":
        return renderImageComponent(component);
      case "label":
        return renderLabelComponent(component);
      case "container":
        return renderContainerComponent(component);
      case "linear-track":
        return renderLinearTrackComponent(component);
      case "circular-track":
        return renderCircularTrackComponent(component);
      case "select-group":
        return renderSelectGroupComponent(component);
      case "toggle":
        return renderToggleComponent(component);
      default: {
        const unsupported = document.createElement("p");
        unsupported.className = "text-body-secondary mb-0";
        unsupported.textContent = `Unsupported component: ${component.type}`;
        return unsupported;
      }
    }
  }

  function renderInputComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const labelText = component.label || component.name || "Field";
    if (labelText) {
      const label = document.createElement("label");
      label.className = "form-label fw-semibold text-body-secondary mb-0";
      label.textContent = labelText;
      applyTextFormatting(label, component);
      wrapper.appendChild(label);
    }
    const editable = isEditable(component);
    const resolvedValue = resolveComponentValue(component, component.value ?? "");
    const variant = component.variant || "text";

    if (variant === "select") {
      const select = document.createElement("select");
      select.className = "form-select";
      const currentValue = resolvedValue == null ? "" : String(resolvedValue);
      const options = resolveSelectionOptions(component);
      options.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (opt.value === currentValue) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      select.disabled = !editable;
      assignBindingMetadata(select, component);
      if (editable) {
        select.addEventListener("change", () => {
          updateBinding(component.binding, select.value);
        });
      }
      wrapper.appendChild(select);
      return wrapper;
    }

    if (variant === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.className = "form-control";
      const rows = Number.isFinite(Number(component.rows)) ? Number(component.rows) : 3;
      textarea.rows = Math.min(Math.max(Math.round(rows), 2), 12);
      textarea.placeholder = component.placeholder || "";
      textarea.value = resolvedValue != null ? String(resolvedValue) : "";
      textarea.disabled = !editable;
      assignBindingMetadata(textarea, component);
      if (editable) {
        textarea.addEventListener("input", () => {
          updateBinding(component.binding, textarea.value);
        });
      }
      wrapper.appendChild(textarea);
      return wrapper;
    }

    if (variant === "radio" || variant === "checkbox") {
      const group = document.createElement("div");
      group.className = "d-flex flex-wrap gap-2";
      const options = Array.isArray(component.options) ? component.options : [];
      const currentValue = variant === "checkbox"
        ? Array.isArray(resolvedValue)
          ? resolvedValue.map(String)
          : []
        : resolvedValue == null
        ? ""
        : String(resolvedValue);
      options.forEach((option, index) => {
        const optionValue = typeof option === "string" ? option : option.value;
        const optionLabel = typeof option === "string" ? option : option.label;
        const id = `${component.uid}-${variant}-${index}`;
        const formCheck = document.createElement("div");
        formCheck.className = "form-check form-check-inline";
        const input = document.createElement("input");
        input.className = "form-check-input";
        input.type = variant;
        input.name = `${component.uid}-${variant}`;
        input.id = id;
        input.disabled = !editable;
        if (variant === "radio") {
          input.value = optionValue;
          input.checked = optionValue === currentValue;
        } else {
          input.value = optionValue;
          input.checked = currentValue.includes(String(optionValue));
        }
        assignBindingMetadata(input, component, { value: optionValue });
        if (editable) {
          input.addEventListener("change", () => {
            if (variant === "radio") {
              updateBinding(component.binding, input.value);
            } else {
              const checkedValues = Array.from(group.querySelectorAll("input[type=checkbox]"))
                .filter((node) => node.checked)
                .map((node) => node.value);
              updateBinding(component.binding, checkedValues);
            }
          });
        }
        const optionLabelEl = document.createElement("label");
        optionLabelEl.className = "form-check-label";
        optionLabelEl.setAttribute("for", id);
        optionLabelEl.textContent = optionLabel;
        formCheck.append(input, optionLabelEl);
        group.appendChild(formCheck);
      });
      wrapper.appendChild(group);
      return wrapper;
    }

    const input = document.createElement("input");
    input.className = "form-control";
    if (variant === "number") {
      input.type = "number";
      if (component.min !== undefined) input.min = component.min;
      if (component.max !== undefined) input.max = component.max;
      if (component.step !== undefined) input.step = component.step;
      const numericValue = resolvedValue == null ? "" : resolvedValue;
      input.value = numericValue === undefined ? "" : numericValue;
      input.disabled = !editable;
      assignBindingMetadata(input, component);
      if (editable) {
        input.addEventListener("input", () => {
          const raw = input.value;
          if (raw === "") {
            updateBinding(component.binding, null);
            return;
          }
          const next = Number(raw);
          updateBinding(component.binding, Number.isNaN(next) ? raw : next);
        });
      }
    } else {
      input.type = component.inputType || "text";
      input.placeholder = component.placeholder || "";
      input.value = resolvedValue ?? "";
      input.disabled = !editable;
      assignBindingMetadata(input, component);
      if (editable) {
        input.addEventListener("input", () => {
          updateBinding(component.binding, input.value);
        });
      }
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderArrayComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary";
    heading.textContent = component.label || component.name || "List";
    applyTextFormatting(heading, component);
    wrapper.appendChild(heading);
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.rows = component.rows || 4;
    const value = resolveComponentValue(component);
    const serialized = Array.isArray(value)
      ? JSON.stringify(value, null, 2)
      : value != null
      ? String(value)
      : "";
    textarea.value = serialized;
    const editable = isEditable(component);
    textarea.readOnly = !editable;
    assignBindingMetadata(textarea, component);
    if (editable) {
      textarea.addEventListener("blur", async () => {
        const text = textarea.value.trim();
        if (!text) {
          updateBinding(component.binding, []);
          await persistDraft({ silent: true });
          return;
        }
        try {
          const parsed = JSON.parse(text);
          updateBinding(component.binding, parsed);
          await persistDraft({ silent: true });
        } catch (error) {
          status.show("Enter valid JSON for this list.", { type: "warning", timeout: 2000 });
        }
      });
    }
    wrapper.appendChild(textarea);
    return wrapper;
  }

  function renderDividerComponent(component) {
    const divider = document.createElement("hr");
    divider.className = "my-2";
    if (component.thickness) {
      divider.style.borderWidth = `${component.thickness}px`;
    }
    if (component.borderColor) {
      divider.style.borderColor = component.borderColor;
    }
    return divider;
  }

  function renderImageComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = component.label || component.name;
    if (label) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold text-body-secondary";
      heading.textContent = label;
      wrapper.appendChild(heading);
    }
    const image = document.createElement("img");
    image.className = "img-fluid rounded";
    image.alt = component.alt || label || "Image";
    image.src = component.src || "https://placehold.co/640x360?text=Image";
    wrapper.appendChild(image);
    return wrapper;
  }

  function renderLabelComponent(component) {
    const text = document.createElement("div");
    text.className = "text-body";
    const resolved = resolveComponentValue(component, component.text || component.label || "Label");
    text.textContent = resolved != null ? String(resolved) : "";
    applyTextFormatting(text, component);
    return text;
  }

  function renderContainerComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-3";
    const zones = normalizeZones(component);
    if (!zones.length) {
      wrapper.appendChild(createCanvasPlaceholder("No components in this container yet.", { variant: "compact" }));
      return wrapper;
    }
    zones.forEach((zone, index) => {
      if (zones.length > 1) {
        const badge = document.createElement("div");
        badge.className = "text-uppercase extra-small text-body-secondary";
        badge.textContent = zone.label || `Zone ${index + 1}`;
        wrapper.appendChild(badge);
      }
      const group = document.createElement("div");
      group.className = "d-flex flex-column gap-3";
      zone.components.forEach((child) => {
        group.appendChild(renderComponentCard(child));
      });
      wrapper.appendChild(group);
    });
    return wrapper;
  }

  function renderLinearTrackComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Progress";
    wrapper.appendChild(label);
    const input = document.createElement("input");
    input.type = "range";
    input.className = "form-range";
    input.min = component.min ?? 0;
    input.max = component.max ?? 100;
    const resolved = resolveComponentValue(component, component.value ?? 0);
    const value = Number(resolved ?? 0);
    input.value = Number.isNaN(value) ? 0 : value;
    const editable = isEditable(component);
    input.disabled = !editable;
    assignBindingMetadata(input, component);
    if (editable) {
      input.addEventListener("input", () => {
        updateBinding(component.binding, Number(input.value));
      });
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderCircularTrackComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Track";
    wrapper.appendChild(label);
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control";
    input.min = 0;
    const max = component.max ?? 100;
    input.max = max;
    const resolved = resolveComponentValue(component, component.value ?? 0);
    const value = Number(resolved ?? 0);
    input.value = Number.isNaN(value) ? 0 : value;
    const editable = isEditable(component);
    input.disabled = !editable;
    assignBindingMetadata(input, component);
    if (editable) {
      input.addEventListener("input", () => {
        const next = Number(input.value);
        updateBinding(component.binding, Number.isNaN(next) ? 0 : Math.max(0, Math.min(max, next)));
      });
    }
    wrapper.appendChild(input);
    return wrapper;
  }

  function renderSelectGroupComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Options";
    wrapper.appendChild(label);
    const editable = isEditable(component);
    const value = resolveComponentValue(component, component.value ?? (component.multiple ? [] : ""));
    const activeValues = component.multiple
      ? Array.isArray(value)
        ? value.map(String)
        : value != null
        ? [String(value)]
        : []
      : value != null
      ? String(value)
      : "";
    const options = resolveSelectionOptions(component);
    const group = document.createElement("div");
    group.className = "btn-group flex-wrap";
    group.setAttribute("role", "group");
    options.forEach(({ value: optionValue, label: optionLabel }) => {
      const normalizedOption = String(optionValue);
      const button = document.createElement("button");
      button.type = "button";
      const isActive = component.multiple
        ? activeValues.includes(normalizedOption)
        : normalizedOption === activeValues;
      button.className = isActive ? "btn btn-primary btn-sm" : "btn btn-outline-secondary btn-sm";
      button.textContent = optionLabel;
      button.disabled = !editable;
      assignBindingMetadata(button, component, { value: optionValue });
      if (editable) {
        button.addEventListener("click", () => {
          if (component.multiple) {
            const current = resolveComponentValue(component, component.value ?? []);
            const normalizedCurrent = Array.isArray(current)
              ? current.map(String)
              : current != null
              ? [String(current)]
              : [];
            const exists = normalizedCurrent.includes(normalizedOption);
            const next = exists
              ? normalizedCurrent.filter((entry) => entry !== normalizedOption)
              : [...normalizedCurrent, normalizedOption];
            updateBinding(component.binding, next);
          } else {
            updateBinding(component.binding, optionValue);
          }
        });
      }
      group.appendChild(button);
    });
    wrapper.appendChild(group);
    return wrapper;
  }

  function renderToggleComponent(component) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const label = document.createElement("div");
    label.className = "fw-semibold text-body-secondary";
    label.textContent = component.label || "Toggle";
    wrapper.appendChild(label);
    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    const states = resolveToggleStates(component);
    const resolvedState = resolveComponentValue(component);
    const normalizedState = resolvedState != null ? String(resolvedState) : null;
    states.forEach((state, index) => {
      const label = state != null ? String(state) : `State ${index + 1}`;
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      const shouldSelect = normalizedState !== null
        ? normalizedState === String(state)
        : component.activeIndex === index;
      if (shouldSelect) {
        option.selected = true;
      }
      select.appendChild(option);
    });
    const editable = isEditable(component);
    select.disabled = !editable;
    assignBindingMetadata(select, component);
    if (editable) {
      select.addEventListener("change", () => {
        updateBinding(component.binding, select.value);
      });
    }
    wrapper.appendChild(select);
    return wrapper;
  }

  function normalizeZones(component) {
    if (!component || !component.zones || typeof component.zones !== "object") {
      return [];
    }
    return Object.keys(component.zones).map((key, index) => ({
      key,
      label:
        component.zoneLabels?.[key] ||
        (Array.isArray(component.tabLabels) ? component.tabLabels[index] : null) ||
        formatZoneLabel(key, index),
      components: Array.isArray(component.zones[key]) ? component.zones[key].map((child) => child) : [],
    }));
  }

  function formatZoneLabel(key, index) {
    if (!key) {
      return `Zone ${index + 1}`;
    }
    const cleaned = key.replace(/[-_]+/g, " ").trim();
    if (!cleaned) {
      return `Zone ${index + 1}`;
    }
    return cleaned
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function hydrateComponent(component) {
    if (!component || typeof component !== "object") {
      return null;
    }
    const clone = JSON.parse(JSON.stringify(component));
    const normalizedBinding = normalizeBinding(clone.binding ?? clone.bind ?? "");
    if (normalizedBinding) {
      clone.binding = normalizedBinding;
    }
    if (!clone.uid) {
      componentCounter += 1;
      clone.uid = `cmp-${componentCounter}`;
    }
    if (clone.zones && typeof clone.zones === "object") {
      Object.keys(clone.zones).forEach((key) => {
        const items = Array.isArray(clone.zones[key]) ? clone.zones[key] : [];
        clone.zones[key] = items.map((child) => hydrateComponent(child)).filter(Boolean);
      });
    }
    return clone;
  }

  function normalizeBinding(bindingOrComponent) {
    if (typeof bindingOrComponent === "string") {
      return bindingOrComponent.trim();
    }
    if (bindingOrComponent && typeof bindingOrComponent === "object") {
      if (typeof bindingOrComponent.binding === "string") {
        return bindingOrComponent.binding.trim();
      }
      if (typeof bindingOrComponent.bind === "string") {
        return bindingOrComponent.bind.trim();
      }
    }
    return "";
  }

  function resolveSourceBindingValue(bindingOrComponent) {
    const normalized = normalizeBinding(bindingOrComponent);
    if (!normalized) {
      return undefined;
    }
    const contexts = [];
    if (state.draft?.data && typeof state.draft.data === "object") {
      contexts.push({ value: state.draft.data, prefixes: ["data"], allowDirect: true });
    }
    if (state.draft && typeof state.draft === "object") {
      contexts.push({ value: state.draft, prefixes: ["character"], allowDirect: true });
    }
    const template = state.template && typeof state.template === "object" ? state.template : null;
    if (template) {
      contexts.push({ value: template, prefixes: ["template"], allowDirect: true });
      if (template.metadata && typeof template.metadata === "object") {
        contexts.push({ value: template.metadata, prefixes: ["metadata"] });
      }
      if (template.data && typeof template.data === "object") {
        contexts.push({ value: template.data, prefixes: ["data"], allowDirect: true });
      }
      if (template.sources && typeof template.sources === "object") {
        contexts.push({ value: template.sources, prefixes: ["sources"], allowDirect: true });
      }
      if (template.preview && typeof template.preview === "object") {
        contexts.push({ value: template.preview, prefixes: ["preview"], allowDirect: true });
      }
      if (template.sample && typeof template.sample === "object") {
        contexts.push({ value: template.sample, prefixes: ["sample"], allowDirect: true });
      }
      if (template.samples && typeof template.samples === "object") {
        contexts.push({ value: template.samples, prefixes: ["samples"], allowDirect: true });
      }
    }
    const systemPreviewData =
      state.systemPreviewData && typeof state.systemPreviewData === "object" ? state.systemPreviewData : null;
    if (systemPreviewData) {
      contexts.push({
        value: systemPreviewData,
        allowDirect: true,
        prefixes: ["system", "data", "preview", "sources"],
      });
    }
    const definition = state.systemDefinition && typeof state.systemDefinition === "object" ? state.systemDefinition : null;
    if (definition) {
      contexts.push({ value: definition, prefixes: ["system"], allowDirect: true });
      if (definition.metadata && typeof definition.metadata === "object") {
        contexts.push({ value: definition.metadata, prefixes: ["metadata"] });
      }
      if (definition.definition && typeof definition.definition === "object") {
        contexts.push({ value: definition.definition, prefixes: ["definition"], allowDirect: true });
      }
      if (definition.schema && typeof definition.schema === "object") {
        contexts.push({ value: definition.schema, prefixes: ["schema"] });
      }
      if (definition.data && typeof definition.data === "object") {
        contexts.push({ value: definition.data, prefixes: ["data"], allowDirect: true });
      }
      if (definition.sources && typeof definition.sources === "object") {
        contexts.push({ value: definition.sources, prefixes: ["sources"], allowDirect: true });
      }
      if (definition.preview && typeof definition.preview === "object") {
        contexts.push({ value: definition.preview, prefixes: ["preview"], allowDirect: true });
      }
      if (definition.samples && typeof definition.samples === "object") {
        contexts.push({ value: definition.samples, prefixes: ["samples"], allowDirect: true });
      }
      if (definition.sample && typeof definition.sample === "object") {
        contexts.push({ value: definition.sample, prefixes: ["sample"], allowDirect: true });
      }
      if (definition.values && typeof definition.values === "object") {
        contexts.push({ value: definition.values, prefixes: ["values"], allowDirect: true });
      }
      if (definition.lists && typeof definition.lists === "object") {
        contexts.push({ value: definition.lists, prefixes: ["lists"], allowDirect: true });
      }
      if (definition.collections && typeof definition.collections === "object") {
        contexts.push({ value: definition.collections, prefixes: ["collections"], allowDirect: true });
      }
    }
    return resolveBindingFromContexts(normalized, contexts);
  }

  function componentHasFormula(component) {
    return typeof component?.formula === "string" && component.formula.trim().length > 0;
  }

  function isEditable(component) {
    if (!component) {
      return false;
    }
    if (componentHasFormula(component)) {
      return false;
    }
    return state.mode === "edit" && !component.readOnly;
  }

  function resolveComponentValue(component, fallback = undefined) {
    if (componentHasFormula(component)) {
      try {
        const result = evaluateFormula(component.formula, state.draft?.data || {});
        return result;
      } catch (error) {
        console.warn("Character editor: unable to evaluate formula", error);
      }
    }
    const bound = getBindingValue(component?.binding);
    if (bound !== undefined) {
      return bound;
    }
    return fallback;
  }

  function ensureLeadingBlankOption(options) {
    const entries = Array.isArray(options) ? options.filter(Boolean).map((entry) => ({ ...entry })) : [];
    const blankIndex = entries.findIndex((entry) => entry && entry.value === "");
    if (blankIndex === 0) {
      return entries;
    }
    if (blankIndex > 0) {
      const [blank] = entries.splice(blankIndex, 1);
      return [blank, ...entries];
    }
    return [{ value: "", label: "" }, ...entries];
  }

  function resolveSelectionOptions(component) {
    const expectsSource = Boolean(component?.sourceBinding);
    const boundOptions = normalizeOptionEntries(resolveSourceBindingValue(component?.sourceBinding));
    if (boundOptions.length || expectsSource) {
      return expectsSource ? ensureLeadingBlankOption(boundOptions) : boundOptions;
    }
    const componentOptions = normalizeOptionEntries(component?.options);
    if (componentOptions.length) {
      return expectsSource ? ensureLeadingBlankOption(componentOptions) : componentOptions;
    }
    return expectsSource ? ensureLeadingBlankOption([]) : [];
  }

  function resolveToggleStates(component) {
    const boundStates = normalizeOptionEntries(resolveSourceBindingValue(component?.statesBinding));
    if (boundStates.length) {
      return boundStates.map((entry) => entry.label || entry.value).filter((value) => value != null);
    }
    if (Array.isArray(component?.states) && component.states.length) {
      return component.states.map((state) => (state != null ? String(state) : state)).filter((state) => state != null);
    }
    return [];
  }

  function assignBindingMetadata(element, component, { binding = null, value = null } = {}) {
    if (!element || !element.dataset) {
      return;
    }
    if (component?.uid) {
      element.dataset.componentUid = component.uid;
    }
    const normalized = binding !== null ? binding : normalizeBinding(component?.binding);
    if (normalized) {
      element.dataset.bindingPath = normalized;
    }
    if (value !== null && value !== undefined) {
      element.dataset.bindingValue = String(value);
    }
  }

  function escapeSelector(value) {
    if (typeof value !== "string") {
      return "";
    }
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/"/g, '\\"');
  }

  function captureActiveField() {
    const active = document.activeElement;
    if (!active || !elements.canvasRoot?.contains(active)) {
      return null;
    }
    const container = active.closest("[data-component-id]");
    if (!container) {
      return null;
    }
    return {
      componentId: container.dataset.componentId || "",
      bindingPath: active.dataset?.bindingPath || "",
      bindingValue: active.dataset?.bindingValue || "",
      tagName: active.tagName || "",
      type: active.type || "",
      name: active.name || "",
      selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
    };
  }

  function restoreActiveField(snapshot) {
    if (!snapshot || !snapshot.componentId || !elements.canvasRoot) {
      return;
    }
    const selector = `[data-component-id="${escapeSelector(snapshot.componentId)}"]`;
    const container = elements.canvasRoot.querySelector(selector);
    if (!container) {
      return;
    }
    let target = null;
    if (snapshot.bindingPath) {
      const bindingSelector = `[data-binding-path="${escapeSelector(snapshot.bindingPath)}"]`;
      if (snapshot.bindingValue) {
        target = container.querySelector(`${bindingSelector}[data-binding-value="${escapeSelector(snapshot.bindingValue)}"]`);
      }
      if (!target) {
        target = container.querySelector(bindingSelector);
      }
    }
    if (!target && snapshot.name) {
      target = container.querySelector(`[name="${escapeSelector(snapshot.name)}"]`);
    }
    if (!target && snapshot.tagName) {
      target = container.querySelector(snapshot.tagName.toLowerCase());
    }
    if (!target) {
      target = container.querySelector("input, select, textarea");
    }
    if (target && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
      if (
        snapshot.selectionStart !== null &&
        snapshot.selectionEnd !== null &&
        typeof target.setSelectionRange === "function"
      ) {
        try {
          target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
        } catch (error) {
          // ignore selection errors
        }
      }
    }
  }

  function getBindingValue(binding) {
    const normalizedBinding = normalizeBinding(binding);
    if (!normalizedBinding) {
      return undefined;
    }
    const trimmed = normalizedBinding.trim();
    if (!trimmed.startsWith("@")) {
      return undefined;
    }
    const path = trimmed.slice(1).split(".").filter(Boolean);
    if (!path.length) {
      return undefined;
    }
    let cursor = state.draft?.data;
    for (const segment of path) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
        return undefined;
      }
      cursor = cursor[segment];
    }
    return cursor;
  }

  function updateBinding(binding, value) {
    const pathSegments = resolveBindingPath(binding);
    if (!pathSegments) {
      return;
    }
    const previousValue = cloneValue(getValueAtPath(pathSegments));
    const nextValue = cloneValue(value);
    if (valuesEqual(previousValue, nextValue)) {
      return;
    }
    const focusSnapshot = captureActiveField();
    const applied = applyBindingValue(pathSegments, nextValue, { focusSnapshot });
    if (applied && undoStack) {
      const previousValueDefined = previousValue !== undefined;
      const nextValueDefined = nextValue !== undefined;
      undoStack.push({
        type: "binding",
        characterId: state.draft?.id || "",
        path: pathSegments,
        previousValue: previousValueDefined ? previousValue : null,
        previousValueDefined,
        nextValue: nextValueDefined ? nextValue : null,
        nextValueDefined,
      });
    }
  }

  function ensureCharacterContext(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const entryId = entry.characterId ?? "";
    const currentId = state.draft?.id || "";
    if (entryId && entryId !== currentId) {
      return false;
    }
    return true;
  }

  function applyCharacterUndo(entry) {
    if (!ensureCharacterContext(entry)) {
      return { message: "Undo unavailable for this character", options: { type: "warning", timeout: 2200 } };
    }
    if (entry.type === "binding" && Array.isArray(entry.path)) {
      const focusSnapshot = captureActiveField();
      const previousValue = entry.previousValueDefined ? entry.previousValue : undefined;
      applyBindingValue(entry.path, cloneValue(previousValue), { focusSnapshot });
      return { message: "Reverted field change", options: { type: "info", timeout: 1500 } };
    }
    return { message: "Nothing to undo", options: { timeout: 1200 } };
  }

  function applyCharacterRedo(entry) {
    if (!ensureCharacterContext(entry)) {
      return { message: "Redo unavailable for this character", options: { type: "warning", timeout: 2200 } };
    }
    if (entry.type === "binding" && Array.isArray(entry.path)) {
      const focusSnapshot = captureActiveField();
      const nextValue = entry.nextValueDefined ? entry.nextValue : undefined;
      applyBindingValue(entry.path, cloneValue(nextValue), { focusSnapshot });
      return { message: "Reapplied field change", options: { type: "info", timeout: 1500 } };
    }
    return { message: "Nothing to redo", options: { timeout: 1200 } };
  }

  function handleUndoEntry(entry) {
    return applyCharacterUndo(entry);
  }

  function handleRedoEntry(entry) {
    return applyCharacterRedo(entry);
  }

  function openNewCharacterDialog() {
    if (elements.newCharacterForm && elements.newCharacterName && elements.newCharacterTemplate) {
      const defaultTemplate = state.template?.id || elements.newCharacterTemplate.value || "";
      prepareNewCharacterForm(defaultTemplate);
      if (newCharacterModalInstance) {
        newCharacterModalInstance.show();
        return;
      }
      createNewCharacterPromptFallback();
      return;
    }
    createNewCharacterPromptFallback();
  }

  function prepareNewCharacterForm(defaultTemplate = "") {
    if (!elements.newCharacterForm) {
      return;
    }
    elements.newCharacterForm.reset();
    elements.newCharacterForm.classList.remove("was-validated");
    if (elements.newCharacterId) {
      elements.newCharacterId.setCustomValidity("");
      let generatedId = "";
      do {
        generatedId = generateCharacterId("character");
      } while (generatedId && characterCatalog.has(generatedId));
      elements.newCharacterId.value = generatedId;
    }
    refreshNewCharacterTemplateOptions(defaultTemplate);
    if (elements.newCharacterTemplate && defaultTemplate) {
      elements.newCharacterTemplate.value = defaultTemplate;
    }
    if (elements.newCharacterName) {
      elements.newCharacterName.value = "";
      elements.newCharacterName.focus();
      elements.newCharacterName.select();
    }
  }

  async function createNewCharacterFromForm() {
    if (!elements.newCharacterName || !elements.newCharacterTemplate) {
      await createNewCharacterPromptFallback();
      return;
    }
    const idInput = elements.newCharacterId;
    const id = (idInput?.value || "").trim();
    if (idInput) {
      idInput.setCustomValidity("");
    }
    const name = (elements.newCharacterName.value || "").trim();
    const templateId = (elements.newCharacterTemplate.value || "").trim();
    if (!id) {
      elements.newCharacterForm?.classList.add("was-validated");
      status.show("Provide an ID for the new character.", { type: "warning", timeout: 2000 });
      idInput?.focus();
      idInput?.select();
      return;
    }
    if (characterCatalog.has(id)) {
      if (idInput) {
        idInput.setCustomValidity("Character ID already exists.");
        idInput.reportValidity();
      }
      status.show("Character ID already exists. Choose another one.", { type: "warning", timeout: 2400 });
      return;
    }
    if (!name) {
      elements.newCharacterForm?.classList.add("was-validated");
      status.show("Provide a name for the new character.", { type: "warning", timeout: 2000 });
      return;
    }
    if (!templateId) {
      elements.newCharacterForm?.classList.add("was-validated");
      status.show("Select a template for the new character.", { type: "warning", timeout: 2000 });
      return;
    }
    const created = await startNewCharacter({ id, name, templateId });
    if (!created) {
      return;
    }
    if (newCharacterModalInstance) {
      newCharacterModalInstance.hide();
    }
    if (elements.newCharacterForm) {
      elements.newCharacterForm.reset();
      elements.newCharacterForm.classList.remove("was-validated");
    }
  }

  async function createNewCharacterPromptFallback() {
    const name = window.prompt("Name your character", "New Hero");
    if (name === null) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      status.show("Provide a name for the new character.", { type: "warning", timeout: 2000 });
      return;
    }
    const templateOptions = Array.from(templateCatalog.values()).filter((entry) => entry.id);
    const templatePrompt = templateOptions.length
      ? `Enter a template ID (e.g. ${templateOptions[0].id})`
      : "Enter a template ID";
    const templateId = window.prompt(templatePrompt, state.template?.id || templateOptions[0]?.id || "");
    if (templateId === null) {
      return;
    }
    const trimmedTemplate = templateId.trim();
    if (!trimmedTemplate) {
      status.show("Select a template for the new character.", { type: "warning", timeout: 2000 });
      return;
    }
    const suggestedId = (() => {
      let candidate = "";
      do {
        candidate = generateCharacterId(trimmedName || "character");
      } while (candidate && characterCatalog.has(candidate));
      return candidate;
    })();
    const idInput = window.prompt("Enter a character ID", suggestedId);
    if (idInput === null) {
      return;
    }
    const trimmedId = idInput.trim();
    if (!trimmedId) {
      status.show("Provide an ID for the new character.", { type: "warning", timeout: 2000 });
      return;
    }
    await startNewCharacter({ id: trimmedId, name: trimmedName, templateId: trimmedTemplate });
  }

  async function startNewCharacter({ id, name, templateId }) {
    const trimmedName = (name || "").trim();
    const trimmedTemplate = (templateId || "").trim();
    const trimmedId = (id || "").trim();
    if (!trimmedId) {
      status.show("Provide an ID for the new character.", { type: "warning", timeout: 2000 });
      return false;
    }
    if (!trimmedName) {
      status.show("Provide a name for the new character.", { type: "warning", timeout: 2000 });
      return false;
    }
    if (!trimmedTemplate) {
      status.show("Select a template for the new character.", { type: "warning", timeout: 2000 });
      return false;
    }
    const templateMetadata = templateCatalog.get(trimmedTemplate);
    if (!templateMetadata) {
      status.show("Template metadata unavailable.", { type: "warning", timeout: 2200 });
      return false;
    }
    if (state.template?.id !== trimmedTemplate) {
      await loadTemplateById(trimmedTemplate);
      if (state.template?.id !== trimmedTemplate) {
        return false;
      }
    }
    if (characterCatalog.has(trimmedId)) {
      status.show("Character ID already exists. Choose another one.", { type: "warning", timeout: 2400 });
      return false;
    }
    const draft = {
      id: trimmedId,
      title: trimmedName,
      template: trimmedTemplate,
      system: state.template?.schema || templateMetadata?.schema || "",
      data: { name: trimmedName },
      state: { timers: {}, log: [] },
    };
    state.character = cloneCharacter(draft);
    state.draft = cloneCharacter(draft);
    state.characterOrigin = "local";
    state.mode = "edit";
    const user = sessionUser();
    registerCharacterRecord({
      id: trimmedId,
      title: trimmedName,
      template: trimmedTemplate,
      source: "local",
      ownership: user ? "owned" : "local",
      ownerId: user?.id ?? null,
      ownerUsername: user?.username ?? "",
      ownerTier: user?.tier ?? "",
    });
    if (elements.characterSelect) {
      elements.characterSelect.value = trimmedId;
    }
    await persistDraft({ silent: true });
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    syncModeIndicator();
    syncCharacterActions();
    status.show(`Started ${trimmedName}`, { type: "success", timeout: 2000 });
    return true;
  }

  function deleteCurrentCharacter() {
    const id = state.draft?.id;
    if (!id) {
      status.show("Select a character before deleting.", { type: "warning", timeout: 2000 });
      return;
    }
    const metadata = characterCatalog.get(id) || {};
    const origin = state.characterOrigin || metadata.source || metadata.origin || state.character?.origin || "";
    if (origin !== "local") {
      const message = origin === "builtin"
        ? "Built-in characters cannot be deleted."
        : "Only local characters can be deleted right now.";
      status.show(message, { type: origin === "builtin" ? "info" : "warning", timeout: 2400 });
      return;
    }
    const label = state.draft.data?.name || metadata.title || id;
    const confirmed = window.confirm(`Delete ${label}? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }
    try {
      dataManager.removeLocal("characters", id);
    } catch (error) {
      console.warn("Character editor: unable to remove character", error);
    }
    const notesKey = `undercroft.workbench.character.notes.${id}`;
    try {
      localStorage.removeItem(notesKey);
    } catch (error) {
      console.warn("Character editor: unable to remove notes", error);
    }
    removeCharacterRecord(id);
    state.character = null;
    state.draft = null;
    state.template = null;
    state.components = [];
    resetSystemContext();
    state.characterOrigin = null;
    state.mode = "view";
    componentCounter = 0;
    currentNotesKey = "";
    if (elements.characterSelect) {
      elements.characterSelect.value = "";
    }
    markCharacterClean();
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    syncModeIndicator();
    syncCharacterActions();
    status.show(`Deleted ${label}`, { type: "success", timeout: 2200 });
  }

  function exportDraft() {
    const dataStr = JSON.stringify(state.draft, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.draft.id || "character"}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    status.show("Downloaded character JSON", { timeout: 2000 });
  }

  async function persistDraft({ silent = true } = {}) {
    if (!state.draft?.id) {
      return false;
    }
    const payload = cloneCharacter(state.draft);
    const id = state.draft.id;
    const label = payload?.data?.name || payload?.title || id;
    const metadata = characterCatalog.get(id) || {};
    const session = sessionUser();
    const wantsRemote = dataManager.isAuthenticated() && Boolean(dataManager.baseUrl);
    const requireRemote = dataManager.isAuthenticated() && dataManager.hasWriteAccess("characters");
    let remoteSucceeded = false;
    let remoteError = null;
    if (wantsRemote) {
      try {
        const result = await dataManager.save("characters", id, payload, { mode: "remote" });
        remoteSucceeded = result?.source === "remote";
      } catch (error) {
        remoteError = error;
        console.error("Character editor: failed to sync character", error);
      }
    } else if (dataManager.isAuthenticated() && !dataManager.baseUrl && !silent && status) {
      status.show("Server connection not configured. Start the Workbench server to sync.", {
        type: "warning",
        timeout: 3000,
      });
    }

    if (!remoteSucceeded) {
      try {
        dataManager.saveLocal("characters", id, payload);
      } catch (error) {
        console.warn("Character editor: unable to save character locally", error);
        if (status) {
          status.show("Failed to save character locally", { type: "danger", timeout: 2200 });
        }
        return false;
      }
    }

    registerCharacterRecord({
      id,
      title: label,
      template: payload.template || state.template?.id || "",
      source: remoteSucceeded ? "remote" : "local",
      ownership: remoteSucceeded
        ? "owned"
        : metadata.ownership || (session ? "owned" : "local"),
      ownerId: remoteSucceeded
        ? session?.id ?? metadata.ownerId ?? null
        : metadata.ownerId ?? session?.id ?? null,
      ownerUsername: remoteSucceeded
        ? session?.username || metadata.ownerUsername || ""
        : metadata.ownerUsername || session?.username || "",
      ownerTier: remoteSucceeded
        ? session?.tier || metadata.ownerTier || ""
        : metadata.ownerTier || session?.tier || "",
      sharePermissions: metadata.sharePermissions,
    });
    state.character = cloneCharacter(payload);
    state.characterOrigin = remoteSucceeded ? "remote" : "local";

    if (remoteSucceeded || !requireRemote) {
      markCharacterClean();
    }

    if (remoteError && status) {
      const message = remoteError.message || "Unable to sync character with the server";
      status.show(message, { type: "danger" });
    } else if (!silent) {
      if (remoteSucceeded) {
        status.show(`Saved ${label} to the server`, { type: "success", timeout: 2200 });
      } else {
        status.show("Character saved locally", { type: "success", timeout: 2000 });
      }
    }

    syncCharacterActions();
    return remoteSucceeded;
  }

  function syncModeIndicator() {
    if (elements.modeIndicator) {
      elements.modeIndicator.textContent = state.mode === "edit" ? "Editing" : "Viewing";
    }
    if (elements.viewToggle) {
      const icon = elements.viewToggle.querySelector("[data-mode-icon]");
      const label = elements.viewToggle.querySelector("[data-mode-label]");
      const tooltipTitle = state.mode === "edit" ? "Switch to view mode" : "Switch to edit mode";
      elements.viewToggle.setAttribute("data-bs-title", tooltipTitle);
      elements.viewToggle.setAttribute("aria-pressed", state.mode === "edit" ? "true" : "false");
      if (icon) {
        icon.setAttribute("data-icon", state.mode === "edit" ? "tabler:edit" : "tabler:eye");
      }
      if (label) {
        label.textContent = state.mode === "edit" ? "Edit mode" : "View mode";
      }
      refreshTooltips(elements.viewToggle.parentElement || elements.viewToggle);
    }
  }

  function syncNotesEditor(force = false) {
    if (!elements.noteEditor) {
      return;
    }
    const key = getNotesStorageKey();
    if (!force && key === currentNotesKey) {
      return;
    }
    currentNotesKey = key;
    suppressNotesChange = true;
    try {
      const stored = localStorage.getItem(key);
      elements.noteEditor.value = stored || "";
    } catch (error) {
      console.warn("Character editor: unable to load notes", error);
      elements.noteEditor.value = "";
    } finally {
      suppressNotesChange = false;
    }
  }

  function persistNotes(value) {
    const key = getNotesStorageKey();
    const payload = value ?? elements.noteEditor?.value ?? "";
    try {
      localStorage.setItem(key, payload);
    } catch (error) {
      console.warn("Character editor: unable to save notes", error);
    }
  }

  function getNotesStorageKey() {
    const id = state.draft?.id || "session";
    return `undercroft.workbench.character.notes.${id}`;
  }

  function cloneCharacter(payload) {
    return payload ? JSON.parse(JSON.stringify(payload)) : null;
  }

  function computeCharacterSignature() {
    if (!state.draft) {
      return null;
    }
    try {
      return JSON.stringify(state.draft);
    } catch (error) {
      console.warn("Character editor: unable to compute character signature", error);
      return null;
    }
  }

  function markCharacterClean() {
    lastSavedCharacterSignature = computeCharacterSignature();
  }

  function hasUnsavedCharacterChanges() {
    if (!state.draft) {
      return false;
    }
    const current = computeCharacterSignature();
    if (!lastSavedCharacterSignature) {
      return Boolean(current);
    }
    return current !== lastSavedCharacterSignature;
  }

  function generateCharacterId(name) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `cha_${crypto.randomUUID()}`;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    return `cha_${slug || "character"}_${rand}`;
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
      console.warn("Character editor: unable to parse shared record", error);
      return null;
    }
  }

  window.addEventListener("workbench:auth-changed", () => {
    if (dataManager.isAuthenticated()) {
      refreshRemoteCharacters({ force: true });
      if (pendingSharedRecord) {
        void loadPendingSharedRecord();
      }
    }
    syncCharacterActions();
  });

  window.addEventListener("workbench:content-saved", (event) => {
    const detail = event.detail || {};
    if (detail.bucket === "characters" && detail.source === "remote") {
      refreshRemoteCharacters({ force: true });
    }
  });

  window.addEventListener("workbench:content-deleted", (event) => {
    const detail = event.detail || {};
    if (detail.bucket === "characters" && detail.source === "remote") {
      refreshRemoteCharacters({ force: true });
    }
  });
})();
