import { initAppShell } from "../../../common/js/lib/app-shell.js";
import { populateSelect } from "../lib/dropdown.js";
import { DataManager } from "../../../common/js/lib/data-manager.js";
import { initAuthControls } from "../../../common/js/lib/auth-ui.js";
import { createCanvasPlaceholder } from "../lib/editor-canvas.js";
import {
  createCanvasCardElement,
  createCollapseToggleButton,
  createStandardCardChrome,
} from "../lib/canvas-card.js";
import { createJsonPreviewRenderer } from "../../../common/js/lib/json-preview.js";
import { refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { resolveApiBase } from "../../../common/js/lib/api.js";
import { expandPane } from "../../../common/js/lib/panes.js";
import { initHelpSystem } from "../../../common/js/lib/help.js";
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
import { createLabeledField } from "../lib/component-layout.js";
import { evaluateFormula } from "../lib/formula-engine.js";
import { rollDiceExpression } from "../lib/dice.js";
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
  const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.workbench" });
  initAuthControls({ root: document, status, dataManager });
  initHelpSystem({ root: document });

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
    viewLocked: false,
    shareToken: "",
  };

  let lastSavedCharacterSignature = null;

  const componentRollDirectives = new Map();
  const collapsedComponents = new Map();
  const diceQuickButtons = new Map();
  const QUICK_DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
  const characterGroupCache = new Map();

  const gameLogState = {
    enabled: false,
    groupId: "",
    groupName: "",
    shareToken: "",
    entries: [],
    localEntries: [],
    loading: false,
    sending: false,
    error: "",
    access: "none",
    pollTimer: 0,
  };

  function escapeHtml(value) {
    if (value === undefined || value === null) {
      return "";
    }
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  markCharacterClean();

  let suppressNotesChange = false;
  let currentNotesKey = "";
  let componentCounter = 0;
  const initialRecordParam = parseRecordParam();
  let pendingSharedRecord = initialRecordParam && initialRecordParam.bucket === "characters"
    ? { id: initialRecordParam.id, shareToken: initialRecordParam.shareToken }
    : null;
  let pendingGroupShare = initialRecordParam && initialRecordParam.bucket === "groups"
    ? { id: initialRecordParam.id, shareToken: initialRecordParam.shareToken }
    : null;
  const groupShareState = {
    token: "",
    groupId: "",
    group: null,
    members: [],
    available: [],
    loading: false,
    error: "",
    status: "",
    collapsed: false,
    paneRevealed: false,
    viewOnlyCharacterId: "",
  };

  const notesState = { collapsed: true };
  const jsonPreviewState = { collapsed: true };
  const dicePanelState = { collapsed: false };
  const gameLogPanelState = { collapsed: false };

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

  function characterOwnership(metadata) {
    if (metadata && typeof metadata.ownership === "string" && metadata.ownership) {
      return metadata.ownership.toLowerCase();
    }
    if (state.draft?.ownership && typeof state.draft.ownership === "string") {
      return state.draft.ownership.toLowerCase();
    }
    return "";
  }

  function characterPermissions(metadata) {
    const permissions = metadata?.sharePermissions ?? state.draft?.sharePermissions ?? "";
    if (typeof permissions === "string" && permissions) {
      return permissions.toLowerCase();
    }
    return "";
  }

  function characterAllowsEdits(metadata) {
    if (!state.draft) {
      return false;
    }
    if (!state.draft.id) {
      return true;
    }
    if (!metadata) {
      return true;
    }
    const ownership = characterOwnership(metadata);
    if (ownership === "shared") {
      return characterPermissions(metadata) === "edit";
    }
    if (ownership === "public") {
      return userOwnsCharacter(state.draft.id);
    }
    if (ownership === "owned" || ownership === "local" || ownership === "draft" || ownership === "builtin") {
      return true;
    }
    if (!ownership || ownership === "remote") {
      return userOwnsCharacter(state.draft.id);
    }
    return userOwnsCharacter(state.draft.id);
  }

  function describeCharacterEditRestriction(metadata) {
    const ownership = characterOwnership(metadata);
    const permissions = characterPermissions(metadata);
    if (ownership === "shared" && permissions !== "edit") {
      return "This character was shared with you as view-only.";
    }
    if (ownership === "public") {
      return "Public characters are view-only.";
    }
    const ownerLabel = resolveOwnerLabel(metadata);
    return `Only ${ownerLabel} can save this character.`;
  }

  const elements = {
    characterSelect: document.querySelector("[data-character-select]"),
    canvasRoot: document.querySelector("[data-canvas-root]"),
    undoButton: document.querySelector('[data-action="undo-character"]'),
    redoButton: document.querySelector('[data-action="redo-character"]'),
    importButton: document.querySelector('[data-action="import-character"]'),
    exportButton: document.querySelector('[data-action="export-character"]'),
    newCharacterButton: document.querySelector('[data-action="new-character"]'),
    deleteCharacterButton: document.querySelector('[data-delete-character]'),
    viewToggle: document.querySelector('[data-action="toggle-mode"]'),
    modeIndicator: document.querySelector("[data-mode-indicator]"),
    notesSection: document.querySelector("[data-notes-section]"),
    noteEditor: document.querySelector("[data-note-editor]"),
    notesToggle: document.querySelector("[data-notes-toggle]"),
    notesToggleLabel: document.querySelector("[data-notes-toggle-label]"),
    notesPanel: document.querySelector("[data-notes-panel]"),
    jsonSection: document.querySelector("[data-json-section]"),
    jsonPreview: document.querySelector("[data-json-preview]"),
    jsonToggle: document.querySelector("[data-json-toggle]"),
    jsonToggleLabel: document.querySelector("[data-json-toggle-label]"),
    jsonPanel: document.querySelector("[data-json-panel]"),
    jsonPreviewBytes: document.querySelector("[data-preview-bytes]"),
    diceSection: document.querySelector("[data-dice-section]"),
    diceForm: document.querySelector("[data-dice-form]"),
    diceExpression: document.querySelector("[data-dice-expression]"),
    diceQuickButtons: document.querySelectorAll("[data-dice-button]"),
    diceClearButton: document.querySelector("[data-dice-clear]"),
    dicePanel: document.querySelector("[data-dice-panel]"),
    diceToggle: document.querySelector("[data-dice-toggle]"),
    diceToggleLabel: document.querySelector("[data-dice-toggle-label]"),
    leftPane: document.querySelector('[data-pane="left"]'),
    leftPaneToggle: document.querySelector('[data-pane-toggle="left"]'),
    rightPane: document.querySelector('[data-pane="right"]'),
    rightPaneToggle: document.querySelector('[data-pane-toggle="right"]'),
    characterToolbar: document.querySelector('[data-character-toolbar]'),
    newCharacterForm: document.querySelector("[data-new-character-form]"),
    newCharacterId: document.querySelector("[data-new-character-id]"),
    newCharacterName: document.querySelector("[data-new-character-name]"),
    newCharacterTemplate: document.querySelector("[data-new-character-template]"),
    groupShareSection: document.querySelector("[data-group-share-section]"),
    groupShareToggle: document.querySelector("[data-group-share-toggle]"),
    groupShareToggleLabel: document.querySelector("[data-group-share-toggle-label]"),
    groupSharePanel: document.querySelector("[data-group-share-panel]"),
    groupShareStatus: document.querySelector("[data-group-share-status]"),
    gameLogSection: document.querySelector("[data-game-log-section]"),
    gameLogPanel: document.querySelector("[data-game-log-panel]"),
    gameLogEntries: document.querySelector("[data-game-log-entries]"),
    gameLogForm: document.querySelector("[data-game-log-form]"),
    gameLogInput: document.querySelector("[data-game-log-input]"),
    gameLogRefresh: document.querySelector("[data-game-log-refresh]"),
    gameLogStatus: document.querySelector("[data-game-log-status]"),
    gameLogTitle: document.querySelector("[data-game-log-group]"),
    gameLogToggle: document.querySelector("[data-game-log-toggle]"),
    gameLogToggleLabel: document.querySelector("[data-game-log-toggle-label]"),
  };

  assignSectionAriaConnections();

  const renderPreview = createJsonPreviewRenderer({
    target: elements.jsonPreview,
    bytesTarget: elements.jsonPreviewBytes,
    serialize: () => state.draft || {},
  });

  setNotesCollapsed(true);
  setJsonPreviewCollapsed(true);
  setGroupShareCollapsed(groupShareState.collapsed);
  setDiceCollapsed(false);
  setGameLogCollapsed(false);

  let newCharacterModalInstance = null;
  if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
    const modalElement = document.getElementById("new-character-modal");
    if (modalElement) {
      newCharacterModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
    }
  }

  let groupShareModalInstance = null;
  if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
    const modalElement = elements.groupShareModal;
    if (modalElement) {
      groupShareModalInstance = window.bootstrap.Modal.getOrCreateInstance(modalElement);
      modalElement.addEventListener("hidden.bs.modal", () => {
        groupShareState.status = "";
        if (elements.groupShareStatus) {
          elements.groupShareStatus.textContent = "";
        }
      });
    }
  }

  await initializeBuiltins();
  initNotesEditor();
  initDiceRoller();
  initGameLog();
  bindUiEvents();
  loadTemplateRecords();
  loadCharacterRecords();
  syncModeIndicator();
  renderCanvas();
  renderPreview();
  syncCharacterActions();
  initializeSharedRecordHandling();
  syncCharacterToolbarVisibility();

  function bindUiEvents() {
    if (elements.characterSelect) {
      elements.characterSelect.addEventListener("change", async () => {
        const selectedId = elements.characterSelect.value;
        if (selectedId) {
          await loadCharacter(selectedId);
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
        void deleteCurrentCharacter();
      });
    }

    if (elements.viewToggle) {
      elements.viewToggle.addEventListener("click", async () => {
        if (state.viewLocked) {
          return;
        }
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

    if (elements.notesToggle) {
      elements.notesToggle.addEventListener("click", (event) => {
        event.preventDefault();
        setNotesCollapsed(!notesState.collapsed);
      });
    }

    if (elements.jsonToggle) {
      elements.jsonToggle.addEventListener("click", (event) => {
        event.preventDefault();
        setJsonPreviewCollapsed(!jsonPreviewState.collapsed);
      });
    }

    if (elements.diceToggle) {
      elements.diceToggle.addEventListener("click", (event) => {
        event.preventDefault();
        setDiceCollapsed(!dicePanelState.collapsed);
      });
    }

    if (elements.gameLogToggle) {
      elements.gameLogToggle.addEventListener("click", (event) => {
        event.preventDefault();
        setGameLogCollapsed(!gameLogPanelState.collapsed);
      });
    }

    if (elements.groupShareToggle) {
      elements.groupShareToggle.addEventListener("click", (event) => {
        event.preventDefault();
        if (!groupShareState.token) {
          return;
        }
        const next = !groupShareState.collapsed;
        setGroupShareCollapsed(next);
        if (!next) {
          renderGroupSharePanel();
        }
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

  function updateCollapsibleSection({
    section,
    panel,
    toggle,
    label,
    collapsed,
    expandLabel,
    collapseLabel,
  }) {
    const next = Boolean(collapsed);
    const expanded = !next;
    if (panel) {
      panel.hidden = next;
      panel.classList.toggle("d-none", next);
    }
    if (section) {
      section.classList.toggle("is-collapsed", next);
    }
    const actionLabel = expanded ? collapseLabel : expandLabel;
    if (toggle) {
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (actionLabel) {
        toggle.setAttribute("aria-label", actionLabel);
        toggle.setAttribute("title", actionLabel);
      }
      toggle.classList.toggle("is-collapsed", next);
      toggle.dataset.collapsed = next ? "true" : "false";
    }
    if (label) {
      label.textContent = actionLabel;
    }
  }

  function setNotesCollapsed(collapsed) {
    const next = Boolean(collapsed);
    notesState.collapsed = next;
    updateCollapsibleSection({
      section: elements.notesSection,
      panel: elements.notesPanel,
      toggle: elements.notesToggle,
      label: elements.notesToggleLabel,
      collapsed: next,
      expandLabel: "Expand notes",
      collapseLabel: "Collapse notes",
    });
  }

  function setJsonPreviewCollapsed(collapsed) {
    const next = Boolean(collapsed);
    jsonPreviewState.collapsed = next;
    updateCollapsibleSection({
      section: elements.jsonSection,
      panel: elements.jsonPanel,
      toggle: elements.jsonToggle,
      label: elements.jsonToggleLabel,
      collapsed: next,
      expandLabel: "Expand JSON preview",
      collapseLabel: "Collapse JSON preview",
    });
  }

  function setDiceCollapsed(collapsed) {
    const next = Boolean(collapsed);
    dicePanelState.collapsed = next;
    updateCollapsibleSection({
      section: elements.diceSection,
      panel: elements.dicePanel,
      toggle: elements.diceToggle,
      label: elements.diceToggleLabel,
      collapsed: next,
      expandLabel: "Expand dice roller",
      collapseLabel: "Collapse dice roller",
    });
  }

  function setGameLogCollapsed(collapsed) {
    const next = Boolean(collapsed);
    gameLogPanelState.collapsed = next;
    updateCollapsibleSection({
      section: elements.gameLogSection,
      panel: elements.gameLogPanel,
      toggle: elements.gameLogToggle,
      label: elements.gameLogToggleLabel,
      collapsed: next,
      expandLabel: "Expand game log",
      collapseLabel: "Collapse game log",
    });
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
    const draftHasId = Boolean(state.draft?.id);
    const metadata = draftHasId ? characterCatalog.get(state.draft.id) || null : null;
    const updateToolbarButton = (button, { disabled, disabledTitle, enabledTitle }) => {
      if (!button) {
        return;
      }
      const nextDisabled = Boolean(disabled);
      const defaultTitle =
        button.dataset.defaultTitle || button.getAttribute("data-bs-title") || button.title || "";
      if (!button.dataset.defaultTitle && defaultTitle) {
        button.dataset.defaultTitle = defaultTitle;
      }
      const title = nextDisabled
        ? disabledTitle || button.dataset.disabledTitle || ""
        : enabledTitle || button.dataset.defaultTitle || defaultTitle || "";
      button.disabled = nextDisabled;
      button.classList.toggle("disabled", nextDisabled);
      button.setAttribute("aria-disabled", nextDisabled ? "true" : "false");
      if (title) {
        button.setAttribute("title", title);
        button.setAttribute("data-bs-title", title);
      } else {
        button.removeAttribute("title");
        button.removeAttribute("data-bs-title");
      }
      refreshTooltips(button.parentElement || button);
    };

    const shareViewActive = Boolean(groupShareState.token)
      && Boolean(groupShareState.viewOnlyCharacterId)
      && draftHasId
      && state.draft.id === groupShareState.viewOnlyCharacterId;
    const locked = state.viewLocked || shareViewActive;

    updateToolbarButton(elements.importButton, {
      disabled: !draftHasId || locked,
      disabledTitle: locked
        ? "Group characters must be claimed before importing."
        : "Select a character to import data.",
    });

    updateToolbarButton(elements.exportButton, {
      disabled: !draftHasId || locked,
      disabledTitle: locked
        ? "Group characters must be claimed before exporting."
        : "Select a character to export data.",
    });

    if (!elements.deleteCharacterButton) {
      return;
    }
    const canWrite = dataManager.hasWriteAccess("characters");
    const canEditRecord = draftHasId ? characterAllowsEdits(metadata) : false;
    const showDelete = draftHasId && canEditRecord && canWrite;
    elements.deleteCharacterButton.classList.toggle("d-none", !showDelete);
    if (!showDelete) {
      elements.deleteCharacterButton.disabled = true;
      elements.deleteCharacterButton.setAttribute("aria-disabled", "true");
      elements.deleteCharacterButton.removeAttribute("title");
      return;
    }
    const origin = state.characterOrigin || metadata?.source || metadata?.origin || state.character?.origin || "";
    const isBuiltin = origin === "builtin";
    const deletable = !isBuiltin;
    elements.deleteCharacterButton.disabled = !deletable;
    elements.deleteCharacterButton.classList.toggle("disabled", !deletable);
    elements.deleteCharacterButton.setAttribute("aria-disabled", deletable ? "false" : "true");
    if (!deletable) {
      elements.deleteCharacterButton.title = "Built-in characters cannot be deleted.";
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

  function openToolsPane() {
    if (elements.rightPane) {
      expandPane(elements.rightPane, elements.rightPaneToggle);
    }
  }

  function parseQuickDiceCounts(expression) {
    const counts = Object.fromEntries(QUICK_DICE.map((die) => [die, 0]));
    if (typeof expression !== "string" || !expression) {
      return counts;
    }
    const regex = /(\d*)d(4|6|8|10|12|20|100)(?!\d)/gi;
    let match;
    while ((match = regex.exec(expression)) !== null) {
      const quantity = match[1] ? parseInt(match[1], 10) : 1;
      const die = `d${match[2]}`.toLowerCase();
      if (Number.isFinite(quantity) && counts[die] !== undefined) {
        counts[die] += quantity;
      }
    }
    return counts;
  }

  function syncQuickDiceButtons() {
    if (!elements.diceExpression) {
      return;
    }
    const expression = elements.diceExpression.value || "";
    const counts = parseQuickDiceCounts(expression);
    diceQuickButtons.forEach((button, die) => {
      const count = counts[die] || 0;
      const baseLabel = button.dataset.label || button.textContent.trim();
      if (count > 0) {
        button.textContent = `${baseLabel} × ${count}`;
        button.classList.add("btn-primary", "active");
        button.classList.remove("btn-outline-secondary");
        button.setAttribute("aria-label", `${baseLabel} (${count} in expression)`);
      } else {
        button.textContent = baseLabel;
        button.classList.remove("btn-primary", "active");
        button.classList.add("btn-outline-secondary");
        button.setAttribute("aria-label", `Add ${baseLabel}`);
      }
    });
  }

  function incrementDieInExpression(die, expression = "") {
    const sides = die.slice(1);
    const patternStart = new RegExp(`^(\\s*)(\\d*)d${sides}(?!\\d)`, "i");
    if (patternStart.test(expression)) {
      return expression.replace(patternStart, (match, leading, count) => {
        const base = parseInt(count || "1", 10);
        const next = Number.isFinite(base) ? base + 1 : 2;
        return `${leading}${next}d${sides}`;
      });
    }
    const pattern = new RegExp(`([^A-Za-z0-9_])(\\d*)d${sides}(?!\\d)`, "i");
    let replaced = false;
    const updated = expression.replace(pattern, (match, prefix, count) => {
      if (replaced) {
        return match;
      }
      const base = parseInt(count || "1", 10);
      const next = Number.isFinite(base) ? base + 1 : 2;
      replaced = true;
      return `${prefix}${next}d${sides}`;
    });
    if (replaced) {
      return updated;
    }
    const trimmed = expression.trim();
    if (!trimmed) {
      return `1d${sides}`;
    }
    if (/[+\-*/(]$/.test(trimmed)) {
      return `${expression} 1d${sides}`;
    }
    return `${trimmed} + 1d${sides}`;
  }

  function executeDiceRoll(expression, { label = "", updateInput = true } = {}) {
    const trimmed = typeof expression === "string" ? expression.trim() : "";
    if (!trimmed) {
      status.show("Enter a dice expression like 2d6 + 3.", { type: "info", timeout: 2000 });
      return null;
    }
    if (updateInput && elements.diceExpression) {
      elements.diceExpression.value = trimmed;
      syncQuickDiceButtons();
    }
    openToolsPane();
    try {
      const result = rollDiceExpression(trimmed, { context: state.draft?.data || {} });
      const notation = result.notation || trimmed;
      const prefix = label ? `${label}: ` : "";
      status.show(`${prefix}${notation} → ${result.total}`, { type: "success", timeout: 2200 });
      recordGameLogRoll(result, { expression: trimmed, label });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to roll dice.";
      status.show(message, { type: "danger", timeout: 2400 });
      return null;
    }
  }

  function handleComponentRoll(expression, label) {
    if (!expression) {
      return;
    }
    const text = typeof label === "string" && label.trim() ? label.trim() : "";
    executeDiceRoll(expression, { label: text, updateInput: true });
  }

  function createRollOverlayButton(component, expressions) {
    const container = document.createElement("div");
    container.className = "character-roll-overlay";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-primary btn-sm d-flex align-items-center justify-content-center";
    const label = component.label || component.name || "Roll";
    button.setAttribute("aria-label", `Roll ${label}`);
    if (Array.isArray(expressions) && expressions.length) {
      button.title = expressions.join(" • ");
    }
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.setAttribute("data-icon", "tabler:dice-5");
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    let index = 0;
    button.addEventListener("click", () => {
      if (!Array.isArray(expressions) || !expressions.length) {
        return;
      }
      const expression = expressions[index] || expressions[0];
      index = (index + 1) % expressions.length;
      handleComponentRoll(expression, label);
    });
    container.appendChild(button);
    return container;
  }

  function ensureDicePanelMarkup() {
    if (!elements.dicePanel) {
      return false;
    }
    elements.dicePanel.innerHTML = "";
    const form = document.createElement("form");
    form.className = "d-flex flex-column gap-3";
    form.setAttribute("data-dice-form", "");

    const quickGrid = document.createElement("div");
    quickGrid.className = "dice-quick-grid";
    quickGrid.setAttribute("data-dice-quick", "");
    QUICK_DICE.forEach((die) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-secondary btn-sm";
      button.setAttribute("data-dice-button", die);
      button.textContent = die;
      quickGrid.appendChild(button);
    });
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "btn btn-outline-secondary btn-sm";
    clearButton.setAttribute("data-dice-clear", "");
    clearButton.textContent = "Clear";
    quickGrid.appendChild(clearButton);
    form.appendChild(quickGrid);

    const inputId = "dice-expression";
    const label = document.createElement("label");
    label.className = "visually-hidden";
    label.setAttribute("for", inputId);
    label.textContent = "Dice expression";
    form.appendChild(label);

    const inputGroup = document.createElement("div");
    inputGroup.className = "input-group";
    const input = document.createElement("input");
    input.className = "form-control";
    input.type = "text";
    input.id = inputId;
    input.setAttribute("inputmode", "text");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("data-dice-expression", "");
    input.placeholder = "e.g. 2d6 + 3";
    inputGroup.appendChild(input);

    const rollButton = document.createElement("button");
    rollButton.className = "btn btn-primary";
    rollButton.type = "submit";
    rollButton.textContent = "Roll";
    inputGroup.appendChild(rollButton);

    form.appendChild(inputGroup);
    elements.dicePanel.appendChild(form);

    elements.diceForm = form;
    elements.diceExpression = input;
    elements.diceQuickButtons = form.querySelectorAll("[data-dice-button]");
    elements.diceClearButton = form.querySelector("[data-dice-clear]");
    return true;
  }

  function initDiceRoller() {
    if (!ensureDicePanelMarkup()) {
      return;
    }
    diceQuickButtons.clear();
    Array.from(elements.diceQuickButtons || []).forEach((button) => {
      const die = (button.getAttribute("data-dice-button") || "").toLowerCase();
      if (!die || !QUICK_DICE.includes(die)) {
        return;
      }
      diceQuickButtons.set(die, button);
      const label = button.textContent.trim();
      button.dataset.label = label;
      button.setAttribute("aria-label", `Add ${label}`);
      button.addEventListener("click", () => {
        const next = incrementDieInExpression(die, elements.diceExpression.value || "");
        elements.diceExpression.value = next;
        try {
          elements.diceExpression.focus({ preventScroll: true });
        } catch (focusError) {
          elements.diceExpression.focus();
        }
        syncQuickDiceButtons();
      });
    });

    if (elements.diceClearButton) {
      elements.diceClearButton.setAttribute("aria-label", "Clear dice expression");
      elements.diceClearButton.addEventListener("click", () => {
        if (elements.diceExpression) {
          elements.diceExpression.value = "";
          syncQuickDiceButtons();
          try {
            elements.diceExpression.focus({ preventScroll: true });
          } catch (focusError) {
            elements.diceExpression.focus();
          }
        }
      });
    }

    if (elements.diceExpression) {
      elements.diceExpression.addEventListener("input", () => {
        syncQuickDiceButtons();
      });
    }

    if (elements.diceForm) {
      elements.diceForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const expression = elements.diceExpression ? elements.diceExpression.value || "" : "";
        executeDiceRoll(expression, { updateInput: false });
      });
    }

    syncQuickDiceButtons();
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
      const items = dataManager.collectListEntries(remote);
      items.forEach((item) => {
        if (!item || !item.id) return;
        const shareToken = item.shareToken || item.share_token || "";
        const ownership = item.permissions ? "shared" : item.is_public ? "public" : "remote";
        registerTemplateRecord({
          id: item.id,
          title: item.title || item.id,
          schema: item.schema || "",
          source: "remote",
          shareToken,
          ownership,
          ownerId: item.owner_id ?? item.ownerId ?? null,
          ownerUsername: item.owner_username || item.ownerUsername || "",
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

  function setGroupShareCollapsed(collapsed) {
    const next = Boolean(collapsed);
    groupShareState.collapsed = next;
    updateCollapsibleSection({
      section: elements.groupShareSection,
      panel: elements.groupSharePanel,
      toggle: elements.groupShareToggle,
      label: elements.groupShareToggleLabel,
      collapsed: next,
      expandLabel: "Expand group characters",
      collapseLabel: "Collapse group characters",
    });
    if (elements.groupShareStatus) {
      const shouldHide = next || !groupShareState.token;
      elements.groupShareStatus.hidden = shouldHide;
    }
  }

  function setViewModeLocked(locked) {
    const next = Boolean(locked);
    state.viewLocked = next;
    if (next && state.mode !== "view") {
      state.mode = "view";
      renderCanvas();
      renderPreview();
    }
    syncModeIndicator();
    syncCharacterActions();
  }

  function assignSectionAriaConnections() {
    const notesPanelId = ensureElementId(elements.notesPanel, "character-notes");
    if (notesPanelId && elements.notesToggle) {
      elements.notesToggle.setAttribute("aria-controls", notesPanelId);
    }
    const jsonPanelId = ensureElementId(elements.jsonPanel, "character-json");
    if (jsonPanelId && elements.jsonToggle) {
      elements.jsonToggle.setAttribute("aria-controls", jsonPanelId);
    }
    const sharePanelId = ensureElementId(elements.groupSharePanel, "character-group-share");
    if (sharePanelId && elements.groupShareToggle) {
      elements.groupShareToggle.setAttribute("aria-controls", sharePanelId);
    }
    const dicePanelId = ensureElementId(elements.dicePanel, "character-dice");
    if (dicePanelId && elements.diceToggle) {
      elements.diceToggle.setAttribute("aria-controls", dicePanelId);
    }
    const gameLogPanelId = ensureElementId(elements.gameLogPanel, "character-game-log");
    if (gameLogPanelId && elements.gameLogToggle) {
      elements.gameLogToggle.setAttribute("aria-controls", gameLogPanelId);
    }
  }

  function ensureElementId(element, prefix) {
    if (!element) {
      return "";
    }
    if (element.id) {
      return element.id;
    }
    const base = typeof prefix === "string" && prefix.trim() ? prefix.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") : "element";
    const id = `${base}-${Math.random().toString(36).slice(2, 9)}`;
    element.id = id;
    return id;
  }

  function setGroupShareStatus(message = "") {
    if (!elements.groupShareStatus) {
      return;
    }
    const text = typeof message === "string" ? message.trim() : "";
    elements.groupShareStatus.textContent = text;
    const shouldHide = groupShareState.collapsed || !groupShareState.token || !text;
    elements.groupShareStatus.hidden = shouldHide;
  }

  function initGameLog() {
    if (elements.gameLogForm) {
      elements.gameLogForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitGameLogMessage();
      });
    }
    if (elements.gameLogRefresh) {
      elements.gameLogRefresh.addEventListener("click", () => {
        void refreshGameLog({ force: true });
      });
    }
    updateGameLogVisibility();
    updateGameLogControls();
    updateGameLogStatus();
  }

  function gameLogCanPost() {
    if (!gameLogState.enabled) {
      return false;
    }
    if (!dataManager.isAuthenticated()) {
      return false;
    }
    if (gameLogState.shareToken) {
      return Boolean(gameLogState.groupId);
    }
    if (!gameLogState.groupId) {
      return false;
    }
    if (gameLogState.access === "owner" || gameLogState.access === "member") {
      return true;
    }
    return dataManager.getUserTier() === "admin";
  }

  function updateGameLogControls() {
    const canPost = gameLogCanPost();
    if (elements.gameLogForm) {
      elements.gameLogForm.hidden = !canPost;
    }
    if (elements.gameLogInput) {
      elements.gameLogInput.disabled = !canPost || gameLogState.sending;
    }
    if (elements.gameLogForm) {
      const submit = elements.gameLogForm.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = !canPost || gameLogState.sending;
      }
    }
    if (elements.gameLogRefresh) {
      const refreshDisabled = !gameLogState.enabled || gameLogState.loading;
      elements.gameLogRefresh.disabled = refreshDisabled;
      elements.gameLogRefresh.classList.toggle("disabled", refreshDisabled);
      elements.gameLogRefresh.setAttribute("aria-disabled", refreshDisabled ? "true" : "false");
    }
  }

  function updateGameLogVisibility() {
    if (!elements.gameLogSection) {
      return;
    }
    elements.gameLogSection.hidden = false;
    elements.gameLogSection.classList.remove("d-none");
    setGameLogCollapsed(gameLogPanelState.collapsed);
    renderGameLogEntries();
  }

  function updateGameLogStatus() {
    if (!elements.gameLogStatus) {
      return;
    }
    let message = "";
    elements.gameLogStatus.classList.remove("text-danger");
    if (gameLogState.error) {
      message = gameLogState.error;
      elements.gameLogStatus.classList.add("text-danger");
    } else if (gameLogState.enabled && !gameLogCanPost()) {
      message = dataManager.isAuthenticated()
        ? "You can view the log but cannot post to this group."
        : "Sign in to chat with your group.";
    }
    elements.gameLogStatus.textContent = message;
    elements.gameLogStatus.hidden = !message;
  }

  function createGameLogEntryElement(entry) {
    const container = document.createElement("article");
    container.className = "game-log-entry";

    const summary = document.createElement("div");
    summary.className = "game-log-entry__summary";

    if (entry?.type === "roll") {
      container.classList.add("game-log-entry--roll");
      const payload = entry && typeof entry.payload === "object" && entry.payload ? entry.payload : {};
      const label = typeof payload.label === "string" ? payload.label.trim() : "";
      const notation = typeof payload.expression === "string" && payload.expression.trim()
        ? payload.expression.trim()
        : typeof payload.notation === "string" && payload.notation.trim()
          ? payload.notation.trim()
          : "";
      const total = payload.total !== undefined && payload.total !== null ? payload.total : "";

      const summaryRow = document.createElement("div");
      summaryRow.className = "game-log-roll-summary d-flex flex-wrap align-items-baseline justify-content-between gap-2";

      const expressionEl = document.createElement("span");
      expressionEl.className = "game-log-roll-expression";
      if (label && notation) {
        expressionEl.textContent = `${label} (${notation})`;
      } else if (label) {
        expressionEl.textContent = label;
      } else if (notation) {
        expressionEl.textContent = notation;
      } else {
        expressionEl.textContent = entry?.message || "Roll";
      }
      summaryRow.appendChild(expressionEl);

      if (total || total === 0) {
        const totalEl = document.createElement("span");
        totalEl.className = "game-log-roll-total";
        totalEl.textContent = total;
        summaryRow.appendChild(totalEl);
      }

      summary.appendChild(summaryRow);
    } else {
      container.classList.add("game-log-entry--message");
      summary.textContent = entry?.message || "";
    }

    container.appendChild(summary);

    const meta = document.createElement("div");
    meta.className = "game-log-entry__meta text-body-secondary d-flex justify-content-between align-items-center gap-2 flex-wrap";
    const author = document.createElement("span");
    author.className = "game-log-entry__author";
    author.textContent = entry?.author?.name || "System";
    meta.appendChild(author);

    if (entry?.created_at) {
      const timestamp = document.createElement("time");
      timestamp.className = "game-log-entry__timestamp";
      timestamp.dateTime = entry.created_at;
      timestamp.textContent = formatGameLogTimestamp(entry.created_at);
      meta.appendChild(timestamp);
    }

    container.appendChild(meta);
    return container;
  }

  function formatGameLogTimestamp(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    try {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (error) {
      return date.toISOString();
    }
  }

  function resolveGameLogTimestamp(entry) {
    if (!entry || typeof entry !== "object") {
      return 0;
    }
    if (typeof entry.__timestamp === "number") {
      return entry.__timestamp;
    }
    if (entry.created_at) {
      const created = Date.parse(entry.created_at);
      if (!Number.isNaN(created)) {
        return created;
      }
    }
    if (entry.updated_at) {
      const updated = Date.parse(entry.updated_at);
      if (!Number.isNaN(updated)) {
        return updated;
      }
    }
    if (typeof entry.id === "number") {
      return entry.id;
    }
    const numericId = parseInt(entry.id, 10);
    if (!Number.isNaN(numericId)) {
      return numericId;
    }
    return 0;
  }

  function sortGameLogEntriesDescending(a, b) {
    return resolveGameLogTimestamp(b) - resolveGameLogTimestamp(a);
  }

  function renderGameLogEntries() {
    if (!elements.gameLogEntries) {
      return;
    }
    elements.gameLogEntries.innerHTML = "";
    const combinedEntries = [];
    if (gameLogState.entries.length) {
      combinedEntries.push(...gameLogState.entries);
    }
    if (gameLogState.localEntries.length) {
      combinedEntries.push(...gameLogState.localEntries);
    }
    if (!combinedEntries.length) {
      const placeholder = document.createElement("p");
      placeholder.className = "text-body-secondary small mb-0";
      if (gameLogState.enabled && gameLogState.loading) {
        placeholder.textContent = "Loading log…";
      } else {
        placeholder.textContent = "No log activity yet.";
      }
      elements.gameLogEntries.appendChild(placeholder);
      return;
    }
    const fragment = document.createDocumentFragment();
    combinedEntries.sort(sortGameLogEntriesDescending).forEach((entry) => {
      fragment.appendChild(createGameLogEntryElement(entry));
    });
    elements.gameLogEntries.appendChild(fragment);
  }

  function stopGameLogPolling() {
    if (gameLogState.pollTimer) {
      window.clearInterval(gameLogState.pollTimer);
      gameLogState.pollTimer = 0;
    }
  }

  function startGameLogPolling() {
    stopGameLogPolling();
    if (!gameLogState.enabled) {
      return;
    }
    gameLogState.pollTimer = window.setInterval(() => {
      void refreshGameLog({ silent: true });
    }, 30000);
  }

  function clearGameLogContext() {
    if (!gameLogState.enabled && !gameLogState.groupId && !gameLogState.shareToken) {
      return;
    }
    stopGameLogPolling();
    gameLogState.enabled = false;
    gameLogState.groupId = "";
    gameLogState.groupName = "";
    gameLogState.shareToken = "";
    gameLogState.access = "none";
    gameLogState.entries = [];
    gameLogState.error = "";
    gameLogPanelState.collapsed = false;
    if (elements.gameLogTitle) {
      elements.gameLogTitle.textContent = "";
      elements.gameLogTitle.hidden = true;
    }
    updateGameLogVisibility();
    updateGameLogControls();
    updateGameLogStatus();
  }

  function setGameLogContext({ groupId = "", shareToken = "", groupName = "", access = "none" } = {}) {
    const normalizedId = typeof groupId === "string" ? groupId.trim() : "";
    const normalizedToken = typeof shareToken === "string" ? shareToken.trim() : "";
    const normalizedAccess = typeof access === "string" ? access : "none";
    const changed = normalizedId !== gameLogState.groupId || normalizedToken !== gameLogState.shareToken;
    gameLogState.groupId = normalizedId;
    gameLogState.shareToken = normalizedToken;
    gameLogState.groupName = typeof groupName === "string" ? groupName.trim() : "";
    gameLogState.access = normalizedAccess;
    gameLogState.enabled = Boolean(normalizedId || normalizedToken);
    if (elements.gameLogTitle) {
      elements.gameLogTitle.textContent = gameLogState.groupName;
      elements.gameLogTitle.hidden = !gameLogState.groupName;
    }
    if (!gameLogState.enabled) {
      clearGameLogContext();
      return;
    }
    if (changed) {
      gameLogState.entries = [];
    }
    updateGameLogVisibility();
    updateGameLogControls();
    updateGameLogStatus();
    if (changed) {
      void refreshGameLog({ silent: true });
    }
    startGameLogPolling();
  }

  async function refreshGameLog({ silent = false, force = false } = {}) {
    if (!gameLogState.enabled || (!gameLogState.groupId && !gameLogState.shareToken)) {
      return;
    }
    if (gameLogState.loading && !force) {
      return;
    }
    gameLogState.loading = true;
    updateGameLogControls();
    if (elements.gameLogEntries) {
      elements.gameLogEntries.setAttribute("aria-busy", "true");
    }
    try {
      const payload = await dataManager.getGroupLog({
        groupId: gameLogState.shareToken ? "" : gameLogState.groupId,
        shareToken: gameLogState.shareToken,
      });
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      if (payload?.group?.name) {
        gameLogState.groupName = String(payload.group.name);
        if (elements.gameLogTitle) {
          elements.gameLogTitle.textContent = gameLogState.groupName;
          elements.gameLogTitle.hidden = !gameLogState.groupName;
        }
      }
      gameLogState.entries = entries;
      gameLogState.entries.sort(sortGameLogEntriesDescending);
      gameLogState.error = "";
      renderGameLogEntries();
    } catch (error) {
      console.error("Character editor: failed to load game log", error);
      if (!silent) {
        gameLogState.error = error?.message || "Unable to load the game log.";
      }
      renderGameLogEntries();
    } finally {
      gameLogState.loading = false;
      if (elements.gameLogEntries) {
        elements.gameLogEntries.setAttribute("aria-busy", "false");
      }
      updateGameLogControls();
      updateGameLogStatus();
    }
  }

  async function postGameLogEntry(type, message, payload) {
    if (!gameLogCanPost()) {
      updateGameLogStatus();
      return null;
    }
    if (gameLogState.sending) {
      return null;
    }
    gameLogState.sending = true;
    updateGameLogControls();
    try {
      const entry = await dataManager.createGroupLogEntry({
        groupId: gameLogState.shareToken ? "" : gameLogState.groupId,
        shareToken: gameLogState.shareToken,
        type,
        message,
        payload,
      });
      gameLogState.error = "";
      return entry;
    } catch (error) {
      console.error("Character editor: unable to send game log entry", error);
      gameLogState.error = error?.message || "Unable to send to the game log.";
      updateGameLogStatus();
      if (status) {
        status.show(gameLogState.error, { type: "danger" });
      }
      return null;
    } finally {
      gameLogState.sending = false;
      updateGameLogControls();
    }
  }

  function integrateGameLogEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const existing = gameLogState.entries.findIndex((item) => item && item.id === entry.id);
    if (existing >= 0) {
      gameLogState.entries[existing] = entry;
    } else {
      gameLogState.entries.push(entry);
    }
    gameLogState.entries.sort(sortGameLogEntriesDescending);
    renderGameLogEntries();
    updateGameLogStatus();
  }

  async function submitGameLogMessage() {
    if (!elements.gameLogInput) {
      return;
    }
    const value = elements.gameLogInput.value.trim();
    if (!value) {
      return;
    }
    const context = resolveCurrentCharacterContext();
    const payload = context ? { character: context } : undefined;
    const entry = await postGameLogEntry("message", value, payload);
    if (entry) {
      elements.gameLogInput.value = "";
      integrateGameLogEntry(entry);
      void refreshGameLog({ silent: true, force: true });
    } else {
      updateGameLogStatus();
    }
  }

  function addLocalGameLogEntry({ type = "message", message = "", payload = null } = {}) {
    const timestamp = Date.now();
    const user = sessionUser();
    const displayName =
      (user && typeof user.display_name === "string" && user.display_name.trim())
        ? user.display_name.trim()
        : (user && typeof user.username === "string" && user.username.trim())
          ? user.username.trim()
          : "You";
    const entry = {
      id: `local-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message,
      payload: payload || undefined,
      created_at: new Date(timestamp).toISOString(),
      author: { name: displayName },
      local: true,
      __timestamp: timestamp,
    };
    gameLogState.localEntries.push(entry);
    if (gameLogState.localEntries.length > 100) {
      gameLogState.localEntries.splice(0, gameLogState.localEntries.length - 100);
    }
    renderGameLogEntries();
    updateGameLogStatus();
  }

  function recordGameLogRoll(result, { expression = "", label = "" } = {}) {
    if (!result) {
      return;
    }
    const context = resolveCurrentCharacterContext();
    const payload = {
      expression: expression || result.expression || result.notation || "",
      notation: result.notation || expression || "",
      total: result.total,
      detailHtml: result.detailHtml || undefined,
      detailText: result.detailText || undefined,
      dice: Array.isArray(result.dice) && result.dice.length ? result.dice : undefined,
      label: label || undefined,
      character: context || undefined,
    };
    if (!gameLogCanPost()) {
      addLocalGameLogEntry({ type: "roll", payload });
      return;
    }
    void postGameLogEntry("roll", "", payload).then((entry) => {
      if (entry) {
        integrateGameLogEntry(entry);
        void refreshGameLog({ silent: true, force: true });
      } else if (gameLogState.enabled) {
        void refreshGameLog({ silent: true, force: true });
      }
    });
  }

  function resolveCurrentCharacterContext() {
    if (!state.draft?.id) {
      return null;
    }
    const name = typeof state.draft.data?.name === "string" && state.draft.data.name.trim()
      ? state.draft.data.name.trim()
      : state.draft.id;
    const templateId = state.template?.id || state.draft.template || "";
    const templateTitle = state.template?.title || "";
    return {
      id: state.draft.id,
      name,
      template: templateId,
      template_title: templateTitle,
    };
  }

  async function refreshCharacterGroups(characterId) {
    if (!characterId || !dataManager.isAuthenticated()) {
      characterGroupCache.delete(characterId);
      return [];
    }
    try {
      const payload = await dataManager.listCharacterGroups(characterId);
      const groups = Array.isArray(payload?.groups) ? payload.groups : [];
      characterGroupCache.set(characterId, groups);
      return groups;
    } catch (error) {
      console.warn("Character editor: unable to fetch character groups", error);
      characterGroupCache.set(characterId, []);
      return [];
    }
  }

  async function syncGameLogContext({ force = false } = {}) {
    const shareToken = state.shareToken || groupShareState.token || "";
    const shareGroupId = shareToken ? groupShareState.groupId || "" : "";
    if (shareToken && shareGroupId) {
      const groupName = groupShareState.group?.name || gameLogState.groupName;
      const access = dataManager.isAuthenticated() ? "share" : "viewer";
      setGameLogContext({ groupId: shareGroupId, shareToken, groupName, access });
      return;
    }
    if (!state.draft?.id) {
      clearGameLogContext();
      return;
    }
    if (!dataManager.isAuthenticated()) {
      characterGroupCache.delete(state.draft.id);
      clearGameLogContext();
      return;
    }
    let memberships = characterGroupCache.get(state.draft.id);
    if (force || memberships === undefined) {
      memberships = await refreshCharacterGroups(state.draft.id);
    }
    const groups = Array.isArray(memberships) ? memberships : [];
    const campaign = groups.find((entry) => typeof entry?.type === "string" && entry.type.toLowerCase() === "campaign") || groups[0];
    if (!campaign) {
      clearGameLogContext();
      return;
    }
    const ownerId = campaign.owner_id ?? null;
    const userId = dataManager.session?.user?.id ?? null;
    const access = ownerId === userId ? "owner" : "member";
    setGameLogContext({ groupId: campaign.id, groupName: campaign.name || "", access });
  }

  function applyGroupSharePayload(payload) {
    const group = payload && typeof payload.group === "object" ? payload.group : null;
    groupShareState.group = group;
    groupShareState.groupId = group?.id || groupShareState.groupId;
    const members = Array.isArray(payload?.members) ? payload.members : [];
    groupShareState.members = members;
    const available = Array.isArray(payload?.available)
      ? payload.available
      : members.filter((member) => member.content_type === "character" && !member.is_claimed && !member.missing);
    groupShareState.available = available;
    groupShareState.error = "";
    groupShareState.status = "";
    registerGroupShareRecords();
    void syncGameLogContext();
  }

  function registerGroupShareRecords() {
    const available = Array.isArray(groupShareState.available) ? groupShareState.available : [];
    available.forEach((member) => {
      if (!member || member.content_type !== "character" || !member.content_id) {
        return;
      }
      registerCharacterRecord({
        id: member.content_id,
        title: member.label || member.content_id,
        template: member.template || "",
        templateTitle: member.template_title || "",
        system: member.system || "",
        source: "remote",
        ownership: "shared",
        ownerUsername: member.owner_username || "",
        shareToken: groupShareState.token,
      });
    });
  }

  function syncCharacterToolbarVisibility() {
    if (!elements.characterToolbar) {
      return;
    }
    const currentId = state.draft?.id || "";
    const metadata = currentId ? characterCatalog.get(currentId) : null;
    const viewingShared =
      Boolean(groupShareState.token) &&
      Boolean(groupShareState.viewOnlyCharacterId) &&
      currentId === groupShareState.viewOnlyCharacterId;
    const ownership = (metadata?.ownership || "").toLowerCase();
    const hideToolbar = viewingShared && ownership === "shared";
    elements.characterToolbar.classList.toggle("d-none", hideToolbar);
    const lockViewMode = viewingShared && ownership === "shared";
    setViewModeLocked(lockViewMode);
  }

  function renderGroupSharePanel() {
    if (!elements.groupShareSection) {
      return;
    }
    const hasToken = Boolean(groupShareState.token);
    elements.groupShareSection.hidden = !hasToken;
    if (!hasToken) {
      setGroupShareStatus("");
      syncCharacterToolbarVisibility();
      return;
    }
    if (!groupShareState.paneRevealed) {
      expandPane(elements.leftPane, elements.leftPaneToggle);
      groupShareState.paneRevealed = true;
    }
    setGroupShareCollapsed(groupShareState.collapsed);
    const container = elements.groupSharePanel;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    if (groupShareState.loading) {
      const loading = document.createElement("div");
      loading.className = "text-body-secondary small";
      loading.textContent = "Loading available characters…";
      container.appendChild(loading);
      setGroupShareStatus("");
      return;
    }
    if (groupShareState.error) {
      const alert = document.createElement("div");
      alert.className = "alert alert-danger mb-0";
      alert.textContent = groupShareState.error;
      container.appendChild(alert);
      setGroupShareStatus("");
      return;
    }
    const available = Array.isArray(groupShareState.available) ? groupShareState.available : [];
    if (!available.length) {
      const empty = document.createElement("div");
      empty.className = "text-body-secondary small";
      empty.textContent = "No unclaimed characters are available in this group.";
      container.appendChild(empty);
      const message = dataManager.isAuthenticated() ? "" : "Sign in to claim a character.";
      setGroupShareStatus(message);
      return;
    }
    available.forEach((member) => {
      container.appendChild(renderGroupShareOption(member));
    });
    const message = groupShareState.status || (dataManager.isAuthenticated() ? "" : "Sign in to claim a character.");
    setGroupShareStatus(message);
  }

  function formatGroupMemberLabel(member) {
    if (!member) {
      return "Character";
    }
    const id = typeof member.content_id === "string" && member.content_id
      ? member.content_id
      : typeof member.id === "string" && member.id
        ? member.id
        : "";
    const rawName = member.label || member.name || member.title || id;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : id || "Character";
    const rawTemplate = member.template_title || member.templateTitle || member.template;
    const templateLabel = typeof rawTemplate === "string" && rawTemplate.trim() ? rawTemplate.trim() : "";
    return templateLabel ? `${name} (${templateLabel})` : name;
  }

  function renderGroupShareOption(member) {
    const card = document.createElement("div");
    card.className = "border border-body-tertiary rounded-3 p-3 d-flex flex-column gap-3";
    const header = document.createElement("div");
    header.className = "d-flex flex-column gap-1";
    const title = document.createElement("div");
    title.className = "fw-semibold";
    title.textContent = formatGroupMemberLabel(member);
    header.appendChild(title);
    const systemLabel = member.system_name || member.system;
    if (systemLabel) {
      const system = document.createElement("div");
      system.className = "text-body-secondary small";
      system.textContent = systemLabel;
      header.appendChild(system);
    }
    card.appendChild(header);
    const buttonRow = document.createElement("div");
    buttonRow.className = "d-flex flex-wrap gap-2";
    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "btn btn-outline-secondary btn-sm";
    viewButton.textContent = "View";
    viewButton.addEventListener("click", () => viewGroupCharacter(member, viewButton));
    buttonRow.appendChild(viewButton);
    const claimButton = document.createElement("button");
    claimButton.type = "button";
    claimButton.className = "btn btn-primary btn-sm";
    claimButton.textContent = "Claim";
    claimButton.addEventListener("click", () => claimGroupCharacter(member, claimButton));
    buttonRow.appendChild(claimButton);
    card.appendChild(buttonRow);
    return card;
  }

  async function viewGroupCharacter(member, button) {
    if (!groupShareState.token) {
      return;
    }
    const label = formatGroupMemberLabel(member);
    if (button) {
      button.disabled = true;
    }
    setGroupShareStatus(`Loading ${label}…`);
    try {
      groupShareState.viewOnlyCharacterId = member.content_id;
      registerCharacterRecord({
        id: member.content_id,
        title: member.label || member.content_id,
        template: member.template || "",
        templateTitle: member.template_title || "",
        system: member.system || "",
        source: "remote",
        ownership: "shared",
        ownerUsername: member.owner_username || "",
        shareToken: groupShareState.token,
      });
      await loadCharacter(member.content_id, { shareToken: groupShareState.token });
      groupShareState.status = dataManager.isAuthenticated() ? "" : "Sign in to claim a character.";
    } catch (error) {
      console.error("Character editor: unable to load group character", error);
      const message = error?.message || `Unable to load ${label}.`;
      groupShareState.status = message;
      setGroupShareStatus(message);
      if (status) {
        status.show(message, { type: "danger" });
      }
    } finally {
      if (button) {
        button.disabled = false;
      }
      syncCharacterToolbarVisibility();
      renderGroupSharePanel();
    }
  }
  async function claimGroupCharacter(member, button) {
    if (!groupShareState.token) {
      return;
    }
    const label = formatGroupMemberLabel(member);
    button.disabled = true;
    setGroupShareStatus(`Claiming ${label}…`);
    try {
      await dataManager.claimGroupCharacter({ token: groupShareState.token, characterId: member.content_id });
      groupShareState.status = "";
      setGroupShareStatus("");
      if (status) {
        status.show(`Claimed ${label}.`, { type: "success", timeout: 2000 });
      }
      const url = new URL(window.location.href);
      url.searchParams.set("record", `characters:${member.content_id}`);
      url.searchParams.delete("share");
      window.history.replaceState({}, "", url);
      groupShareState.viewOnlyCharacterId = "";
      syncCharacterToolbarVisibility();
      await refreshRemoteCharacters({ force: true });
      await loadCharacter(member.content_id);
      await refreshGroupShareDetails();
      renderGroupSharePanel();
    } catch (error) {
      console.error("Character editor: unable to claim group character", error);
      const message = error?.message || "Unable to claim this character.";
      groupShareState.status = message;
      setGroupShareStatus(message);
      button.disabled = false;
      if (error?.status === 401) {
        if (status) {
          status.show("Sign in to claim a character.", { type: "warning", timeout: 2000 });
        }
      } else if (status) {
        status.show(message, { type: "danger" });
      }
      await refreshGroupShareDetails();
      renderGroupSharePanel();
    }
  }

  async function refreshGroupShareDetails() {
    if (!groupShareState.token) {
      return;
    }
    groupShareState.loading = true;
    groupShareState.status = "";
    renderGroupSharePanel();
    try {
      const payload = await dataManager.fetchGroupShare(groupShareState.token);
      applyGroupSharePayload(payload);
    } catch (error) {
      console.error("Character editor: unable to refresh group share details", error);
      groupShareState.error = error?.message || "Unable to load available characters.";
    } finally {
      groupShareState.loading = false;
      renderGroupSharePanel();
    }
  }

  async function loadPendingGroupShare() {
    if (!pendingGroupShare) {
      return;
    }
    const { id = "", shareToken = "" } = pendingGroupShare;
    pendingGroupShare = null;
    if (!shareToken) {
      groupShareState.token = "";
      groupShareState.groupId = id;
      groupShareState.group = null;
      groupShareState.members = [];
      groupShareState.available = [];
      groupShareState.error = "";
      groupShareState.status = "";
      groupShareState.loading = false;
      groupShareState.paneRevealed = false;
      groupShareState.viewOnlyCharacterId = "";
      renderGroupSharePanel();
      syncCharacterToolbarVisibility();
      state.shareToken = "";
      clearGameLogContext();
      return;
    }
    groupShareState.token = shareToken;
    groupShareState.groupId = id;
    groupShareState.group = null;
    groupShareState.members = [];
    groupShareState.available = [];
    groupShareState.error = "";
    groupShareState.status = "";
    groupShareState.loading = true;
    groupShareState.collapsed = false;
    groupShareState.paneRevealed = false;
    groupShareState.viewOnlyCharacterId = "";
    renderGroupSharePanel();
    try {
      const payload = await dataManager.fetchGroupShare(shareToken);
      applyGroupSharePayload(payload);
    } catch (error) {
      console.error("Character editor: unable to load group share", error);
      groupShareState.error = error?.message || "Unable to load available characters.";
      if (status) {
        status.show(groupShareState.error, { type: "danger" });
      }
    } finally {
      groupShareState.loading = false;
      renderGroupSharePanel();
      state.shareToken = shareToken;
      void syncGameLogContext({ force: true });
    }
  }

  function initializeSharedRecordHandling() {
    if (pendingGroupShare) {
      void loadPendingGroupShare();
    }
    if (pendingSharedRecord) {
      void loadPendingSharedRecord();
    }
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
    collapsedComponents.clear();
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
    state.shareToken = shareToken || "";
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
      syncCharacterToolbarVisibility();
      status.show(`Loaded ${state.draft.data?.name || metadata.title || state.draft.id}`, {
        type: "success",
        timeout: 2000,
      });
      await syncGameLogContext({ force: true });
    } catch (error) {
      console.error("Character editor: failed to load character", error);
      const pruned = handleCharacterLoadFailure(id, error);
      const message = pruned
        ? "That character is no longer available and was removed from your list."
        : "Unable to load character";
      const type = pruned ? "warning" : "error";
      status.show(message, { type, timeout: 2800 });
      syncCharacterToolbarVisibility();
      await syncGameLogContext({ force: true });
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
      collapsedComponents.clear();
      resetSystemContext();
      markCharacterClean();
      renderCanvas();
      renderPreview();
      syncCharacterActions();
      state.shareToken = "";
      clearGameLogContext();
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
    componentRollDirectives.clear();
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
    const showTypeIcon = state.mode === "edit";
    const collapsibleValue = component?.collapsible;
    const collapsible = typeof collapsibleValue === "string"
      ? collapsibleValue.toLowerCase() === "true"
      : Boolean(collapsibleValue);
    const shouldRenderActions = showTypeIcon;
    const wrapper = createCanvasCardElement({
      classes: ["character-component"],
      dataset: { componentId: component.uid || "" },
      gapClass: "gap-3",
    });
    const { header, actions, ensureActions } = createStandardCardChrome({
      icon: showTypeIcon ? iconName : null,
      iconLabel: component.type,
      headerOptions: { classes: ["character-component-header"], sortableHandle: false },
      actionsOptions: shouldRenderActions ? { classes: ["character-component-actions"] } : false,
      iconOptions: { classes: ["character-component-icon"] },
      removeButtonOptions: false,
    });
    wrapper.appendChild(header);
    const content = renderComponentContent(component);
    const body = content instanceof Element ? content : (() => {
      const container = document.createElement("div");
      container.appendChild(content);
      return container;
    })();
    const bodyId = component?.uid ? `${component.uid}-content` : "";
    if (body instanceof HTMLElement && bodyId) {
      body.id = bodyId;
    }
    wrapper.appendChild(body);

    if (collapsible) {
      const key = component?.uid || null;
      const collapsed = key ? collapsedComponents.get(key) === true : false;
      const labelText = component.label || component.name || "Section";
      const { button: collapseButton, setCollapsed } = createCollapseToggleButton({
        label: labelText,
        collapsed,
        onToggle(next) {
          if (key) {
            if (next) {
              collapsedComponents.set(key, true);
            } else {
              collapsedComponents.delete(key);
            }
          }
          if (body instanceof HTMLElement) {
            body.hidden = next;
          }
          wrapper.classList.toggle("is-collapsed", next);
        },
      });
      if (body instanceof HTMLElement && body.id) {
        collapseButton.setAttribute("aria-controls", body.id);
      }
      header.appendChild(collapseButton);
      if (body instanceof HTMLElement) {
        body.hidden = collapsed;
      }
      wrapper.classList.toggle("is-collapsed", collapsed);
      setCollapsed(collapsed);
    } else {
      if (component?.uid) {
        collapsedComponents.delete(component.uid);
      }
      if (body instanceof HTMLElement) {
        body.hidden = false;
      }
      wrapper.classList.remove("is-collapsed");
    }
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
    const labelText = component.label || component.name || "Field";
    const editable = isEditable(component);
    const resolvedValue = resolveComponentValue(component, component.value ?? "");
    const variant = (component.variant || "text").toLowerCase();
    const componentUid = component?.uid || "";
    const labelClasses = ["form-label", "fw-semibold", "text-body-secondary", "mb-0"];

    if (variant === "select") {
      const select = document.createElement("select");
      select.className = "form-select";
      if (componentUid) {
        select.id = `${componentUid}-select`;
      }
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
      return createLabeledField({
        component,
        control: select,
        labelText,
        labelTag: "label",
        labelFor: select.id || "",
        labelClasses,
        applyFormatting: applyTextFormatting,
      });
    }

    if (variant === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.className = "form-control";
      if (componentUid) {
        textarea.id = `${componentUid}-textarea`;
      }
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
      return createLabeledField({
        component,
        control: textarea,
        labelText,
        labelTag: "label",
        labelFor: textarea.id || "",
        labelClasses,
        applyFormatting: applyTextFormatting,
      });
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
      return createLabeledField({
        component,
        control: group,
        labelText,
        labelTag: "div",
        labelClasses: ["fw-semibold", "text-body-secondary"],
        applyFormatting: applyTextFormatting,
      });
    }

    const input = document.createElement("input");
    input.className = "form-control";
    if (componentUid) {
      input.id = `${componentUid}-input`;
    }
    if (variant === "number") {
      input.type = "number";
      if (component.min !== undefined) input.min = component.min;
      if (component.max !== undefined) input.max = component.max;
      if (component.step !== undefined) input.step = component.step;
      const numericValue = resolvedValue == null ? "" : resolvedValue;
      input.value = numericValue === undefined || numericValue === null ? "" : numericValue;
    } else {
      input.type = component.inputType || "text";
      input.placeholder = component.placeholder || "";
      input.value = resolvedValue ?? "";
    }
    input.disabled = !editable;
    assignBindingMetadata(input, component);
    if (editable) {
      if (variant === "number") {
        input.addEventListener("input", () => {
          const raw = input.value;
          if (raw === "") {
            updateBinding(component.binding, null);
            return;
          }
          const next = Number(raw);
          updateBinding(component.binding, Number.isNaN(next) ? raw : next);
        });
      } else {
        input.addEventListener("input", () => {
          updateBinding(component.binding, input.value);
        });
      }
    }
    const inputContainer = document.createElement("div");
    inputContainer.className = "position-relative";
    const rollExpressions = componentUid ? componentRollDirectives.get(componentUid) : null;
    const showRollOverlay =
      state.mode === "view" && Array.isArray(rollExpressions) && rollExpressions.length > 0;
    if (showRollOverlay) {
      input.classList.add("character-rollable-input");
    }
    inputContainer.appendChild(input);
    if (showRollOverlay) {
      inputContainer.appendChild(createRollOverlayButton(component, rollExpressions));
    }
    return createLabeledField({
      component,
      control: inputContainer,
      labelText,
      labelTag: "label",
      labelFor: input.id || "",
      labelClasses,
      applyFormatting: applyTextFormatting,
    });
  }

  function renderArrayComponent(component) {
    const labelText = component.label || component.name || "List";
    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.rows = component.rows || 4;
    if (component?.uid) {
      textarea.id = `${component.uid}-array`;
    }
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
    return createLabeledField({
      component,
      control: textarea,
      labelText,
      labelTag: "label",
      labelFor: textarea.id || "",
      labelClasses: ["fw-semibold", "text-body-secondary", "mb-0"],
      applyFormatting: applyTextFormatting,
    });
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
    const labelText = component.label || "Progress";
    const input = document.createElement("input");
    input.type = "range";
    input.className = "form-range";
    if (component?.uid) {
      input.id = `${component.uid}-linear-track`;
    }
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
    return createLabeledField({
      component,
      control: input,
      labelText,
      labelTag: "label",
      labelFor: input.id || "",
      labelClasses: ["fw-semibold", "text-body-secondary", "mb-0"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderCircularTrackComponent(component) {
    const labelText = component.label || "Track";
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control";
    if (component?.uid) {
      input.id = `${component.uid}-circular-track`;
    }
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
    return createLabeledField({
      component,
      control: input,
      labelText,
      labelTag: "label",
      labelFor: input.id || "",
      labelClasses: ["fw-semibold", "text-body-secondary", "mb-0"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderSelectGroupComponent(component) {
    const labelText = component.label || "Options";
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
    return createLabeledField({
      component,
      control: group,
      labelText,
      labelTag: "div",
      labelClasses: ["fw-semibold", "text-body-secondary"],
      applyFormatting: applyTextFormatting,
    });
  }

  function renderToggleComponent(component) {
    const labelText = component.label || "Toggle";
    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    if (component?.uid) {
      select.id = `${component.uid}-toggle`;
    }
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
    return createLabeledField({
      component,
      control: select,
      labelText,
      labelTag: "label",
      labelFor: select.id || "",
      labelClasses: ["fw-semibold", "text-body-secondary", "mb-0"],
      applyFormatting: applyTextFormatting,
    });
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
    if (typeof clone.roller !== "string") {
      clone.roller = "";
    }
    clone.roller = clone.roller.trim();
    if (typeof clone.collapsible === "string") {
      clone.collapsible = clone.collapsible.toLowerCase() === "true";
    } else {
      clone.collapsible = Boolean(clone.collapsible);
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
    const componentUid = component?.uid || null;
    const manualRolls = new Set();
    if (typeof component?.roller === "string") {
      const trimmedRoller = component.roller.trim();
      if (trimmedRoller) {
        manualRolls.add(trimmedRoller);
      }
    }
    const applyRollDirectives = (extra) => {
      if (!componentUid) {
        return;
      }
      const combined = new Set(manualRolls);
      if (extra) {
        const values = extra instanceof Set ? Array.from(extra) : Array.isArray(extra) ? extra : [extra];
        values.forEach((value) => {
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) {
              combined.add(trimmed);
            }
          }
        });
      }
      if (combined.size) {
        componentRollDirectives.set(componentUid, Array.from(combined));
      } else {
        componentRollDirectives.delete(componentUid);
      }
    };
    if (componentHasFormula(component)) {
      const collected = new Set();
      try {
        const dataContext = state.draft?.data || {};
        const result = evaluateFormula(component.formula, dataContext, {
          onRoll: (notation) => {
            if (typeof notation === "string") {
              const trimmedNotation = notation.trim();
              if (trimmedNotation) {
                collected.add(trimmedNotation);
              }
            }
          },
          rollContext: dataContext,
        });
        applyRollDirectives(collected);
        return result;
      } catch (error) {
        applyRollDirectives();
        console.warn("Character editor: unable to evaluate formula", error);
      }
    } else {
      applyRollDirectives();
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
    state.shareToken = "";
    clearGameLogContext();
    status.show(`Started ${trimmedName}`, { type: "success", timeout: 2000 });
    return true;
  }

  async function deleteCurrentCharacter() {
    const id = state.draft?.id;
    if (!id) {
      status.show("Select a character before deleting.", { type: "warning", timeout: 2000 });
      return;
    }
    const metadata = characterCatalog.get(id) || {};
    const origin = state.characterOrigin || metadata.source || metadata.origin || state.character?.origin || "";
    if (origin === "builtin") {
      status.show("Built-in characters cannot be deleted.", { type: "info", timeout: 2400 });
      return;
    }
    const label = state.draft.data?.name || metadata.title || id;
    const confirmed = window.confirm(`Delete ${label}? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }
    const button = elements.deleteCharacterButton;
    if (button) {
      button.disabled = true;
      button.classList.add("disabled");
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-busy", "true");
    }
    try {
      await dataManager.delete("characters", id, { mode: "auto" });
    } catch (error) {
      console.error("Character editor: unable to delete character", error);
      if (status) {
        status.show(error.message || "Unable to delete character", { type: "danger" });
      }
      if (button) {
        button.disabled = false;
        button.classList.remove("disabled");
        button.setAttribute("aria-disabled", "false");
        button.removeAttribute("aria-busy");
      }
      return;
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
    collapsedComponents.clear();
    resetSystemContext();
    state.characterOrigin = null;
    state.mode = "view";
    componentCounter = 0;
    currentNotesKey = "";
    if (elements.characterSelect) {
      elements.characterSelect.value = "";
    }
    state.shareToken = "";
    markCharacterClean();
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    syncModeIndicator();
    syncCharacterActions();
    clearGameLogContext();
    status.show(`Deleted ${label}`, { type: "success", timeout: 2200 });
    if (button) {
      button.removeAttribute("aria-busy");
    }
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
      const hasCharacter = Boolean(state.draft?.id);
      const locked = state.viewLocked || !hasCharacter;
      let tooltipTitle = "";
      if (!hasCharacter) {
        tooltipTitle = "Select a character to enable editing.";
      } else if (state.viewLocked) {
        tooltipTitle = "Group characters are view-only until claimed.";
      } else {
        tooltipTitle = state.mode === "edit" ? "Switch to view mode" : "Switch to edit mode";
      }
      const isEditing = hasCharacter && !state.viewLocked && state.mode === "edit";
      elements.viewToggle.disabled = locked;
      elements.viewToggle.classList.toggle("disabled", locked);
      elements.viewToggle.setAttribute("aria-disabled", locked ? "true" : "false");
      elements.viewToggle.setAttribute("title", tooltipTitle);
      elements.viewToggle.setAttribute("data-bs-title", tooltipTitle);
      elements.viewToggle.setAttribute("aria-pressed", isEditing ? "true" : "false");
      if (icon) {
        icon.setAttribute("data-icon", isEditing ? "tabler:edit" : "tabler:eye");
      }
      if (label) {
        label.textContent = isEditing ? "Edit mode" : "View mode";
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

  function parseRecordParam() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const record = params.get("record");
      if (!record) {
        return null;
      }
      const [bucket, ...rest] = record.split(":");
      const id = rest.join(":");
      if (!bucket || !id) {
        return null;
      }
      const shareToken = params.get("share") || "";
      return { bucket, id, shareToken };
    } catch (error) {
      console.warn("Character editor: unable to parse shared record", error);
      return null;
    }
  }

  window.addEventListener("undercroft:auth-changed", () => {
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
