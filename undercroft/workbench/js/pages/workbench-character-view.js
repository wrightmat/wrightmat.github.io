import { populateSelect } from "../lib/dropdown.js";
import { createCanvasPlaceholder } from "../lib/editor-canvas.js";
import {
  createCanvasCardElement,
  createCollapseToggleButton,
  createStandardCardChrome,
} from "../lib/canvas-card.js";
import { setElementCollapsed, bindCollapsibleToggle } from "../../../common/js/lib/collapsible.js";
import { createJsonDataPanel, createCollapsibleSection, createIconButton, createCompactField } from "../../../common/js/lib/ui-components.js";
import { escapeHtml } from "../../../common/js/lib/auth-ui.js";
import { refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { confirmDelete } from "../../../common/js/lib/ownership.js";
import { expandPane } from "../../../common/js/lib/panes.js";
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
import { applyComponentStyles, applyTextFormatting } from "../lib/component-styles.js";
import { renderTextContent, renderImageContent, renderIconContent, renderContainerContent, renderInputContent, renderLinearTrackContent, renderCircularTrackContent, renderSelectGroupContent, renderToggleContent, toggleStateEntryFromRaw, excludeToggleWrapperColors } from "../lib/component-renderers.js";
import { loadCustomFonts, DEFAULT_FONT_FAMILY } from "../../../common/js/lib/font-library.js";
import { evaluateFormula } from "../../../common/js/lib/formula-engine.js";
import { resolveBinding, createLookupFn } from "../../../common/js/lib/bindings.js";
import { rollDiceExpression } from "../lib/dice.js";
import { QUICK_DICE, parseQuickDiceCounts, incrementDieInExpression } from "../../../common/js/lib/widgets/dice-roll.js";
import {
  normalizeOptionEntries,
  resolveTabEntries,
  resolveBindingFromContexts,
  buildSystemPreviewData,
} from "../lib/component-data.js";
import { loadLibraryData } from "../../../common/js/lib/content-fetch.js";
import { resolveToolHref, resolveToolContextPath } from "../../../common/js/lib/app-shell.js";
import { createTemplate, getFormatById, getPageSize } from "../../../press/js/templates.js";
import {
  applyAutoWidthCaps,
  applyAutoFontSizing,
  applyOverflowIndicators,
} from "../../../press/js/template-renderer.js";

// Relocated from the old standalone character.html/character.js — now one of
// three views on Workbench's unified page (see js/pages/workbench.js), which
// owns the single initAppShell call (status/undoStack), DataManager, auth,
// and help system. The Play/Edit distinction is still state.mode ("view"/
// "edit") exactly as before, just now driven by the outer view-tab switcher
// via the returned setMode() instead of an in-page toggle-mode button.
export async function initCharacterView({ status, undoStack, dataManager }) {
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
  const characterGroupCache = new Map();
  // Which tab is showing per Tabs-type Container, keyed by component.uid —
  // components are re-hydrated (deep-cloned) on every data change, so this
  // has to live outside the component object itself to survive re-renders.
  const containerActiveTabs = new Map();

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

  // Tracks the last spotlight log entry actually rendered, so the 30s game
  // log poll (refreshGameLog) doesn't re-fetch and re-render the same
  // entity/template on every tick — only when a genuinely new spotlight
  // entry shows up.
  let lastRenderedSpotlightEntryId = null;

  markCharacterClean();

  let suppressNotesChange = false;
  let currentNotesKey = "";
  let componentCounter = 0;
  const initialRecordParam = parseRecordParam();
  // Accepts both the legacy plural bucket this file's own save/load calls use
  // ("characters") and the canonical singular one every other UI in the suite
  // builds deep links with (character-summary.js, share-modal.js's
  // buildShareUrl, combat-tracker.js's write-through, ...) — a `record=
  // character:<id>` link (e.g. the Dashboard's "Open in Workbench" button)
  // was silently falling through here and landing on whatever character (or
  // none) was already selected, never pre-selecting the one the link named.
  let pendingSharedRecord =
    initialRecordParam && (initialRecordParam.bucket === "characters" || initialRecordParam.bucket === "character")
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
  const dicePanelState = { collapsed: false };
  const gameLogPanelState = { collapsed: false };
  const nowShowingPanelState = { collapsed: false };
  // Assigned once the corresponding section is built below (createCollapsibleSection's
  // own setCollapsed / bindCollapsibleToggle's own apply) — captured here so
  // setNotesCollapsed/setDiceCollapsed/setGameLogCollapsed/setNowShowingCollapsed/
  // setGroupShareCollapsed (further below) can drive them programmatically,
  // replacing the old bespoke updateCollapsibleSection() helper.
  let applyNotesCollapse = () => {};
  let applyDiceCollapse = () => {};
  let applyGameLogCollapse = () => {};
  let applyNowShowingCollapse = () => {};
  let applyGroupShareCollapse = () => {};

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

  // Rooted against the full draft record, not a `.data` sub-bucket — a
  // record's real fields (identity, abilities, stats, conditions, ...) and a
  // template author's own freeform fields (@data.whatever) are both just
  // paths into the same record now. This used to hard-root every binding at
  // `state.draft.data`, which silently sandboxed every template-bound field
  // away from the character's actual imported/computed data (e.g. a field
  // bound to "@name" wrote to a phantom data.name instead of the record's
  // real top-level name) — confirmed safe to change: the one real character
  // record's `data` bucket was empty, so nothing was actually relying on
  // the old scoping.
  function getValueAtPath(pathSegments) {
    if (!Array.isArray(pathSegments) || !pathSegments.length) {
      return undefined;
    }
    let cursor = state.draft;
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
    let cursor = state.draft;
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

  // No longer autosaves on every change — Edit view is dirty-gated like
  // Template view and Loom, via an explicit Save button (see
  // syncCharacterActions/hasUnsavedCharacterChanges). Leaving Edit mode (see
  // setMode) still force-persists as a safety net so work is never silently
  // lost switching views.
  function applyBindingValue(pathSegments, value, { focusSnapshot = null } = {}) {
    const applied = setValueAtPath(pathSegments, cloneValue(value));
    renderCanvas();
    if (focusSnapshot) {
      restoreActiveField(focusSnapshot);
    }
    syncCharacterActions();
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
    "character-select",
    createCompactField({
      type: "select", id: "character-select", label: "Character", labelClass: "form-label fw-semibold text-body-secondary", controlClass: "form-select",
      dataAttr: "data-character-select", helpTopic: "character.records", helpPlacement: "right",
    })
  );
  mountField("new-character-id", createCompactField({ type: "text", id: "new-character-id", label: "Character ID", dataAttr: "data-new-character-id", name: "id", required: true, placeholder: "e.g. cha.my-hero" }));
  mountField("new-character-name", createCompactField({ type: "text", id: "new-character-name", label: "Character Name", dataAttr: "data-new-character-name", name: "name", required: true, placeholder: "e.g. Elandra" }));
  mountField(
    "new-character-template",
    createCompactField({ type: "select", id: "new-character-template", label: "Template", controlClass: "form-select", dataAttr: "data-new-character-template", name: "template", required: true })
  );

  const elements = {
    characterSelect: document.querySelector("[data-character-select]"),
    canvasRoot: document.querySelector("[data-character-canvas-root]"),
    undoButton: document.querySelector('[data-action="undo-character"]'),
    redoButton: document.querySelector('[data-action="redo-character"]'),
    exportButton: document.querySelector('[data-action="export-character"]'),
    newCharacterButton: document.querySelector('[data-action="new-character"]'),
    saveButton: document.querySelector('[data-action="save-character"]'),
    deleteCharacterButton: document.querySelector('[data-delete-character]'),
    viewToggle: document.querySelector('[data-action="toggle-mode"]'),
    modeIndicator: document.querySelector("[data-mode-indicator]"),
    notesSection: document.querySelector("[data-notes-section]"),
    noteEditor: document.querySelector("[data-note-editor]"),
    notesPanel: document.querySelector("[data-notes-panel]"),
    diceSection: document.querySelector("[data-dice-section]"),
    diceForm: document.querySelector("[data-dice-form]"),
    diceExpression: document.querySelector("[data-dice-expression]"),
    diceQuickButtons: document.querySelectorAll("[data-dice-button]"),
    diceClearButton: document.querySelector("[data-dice-clear]"),
    dicePanel: document.querySelector("[data-dice-panel]"),
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
    nowShowingSection: document.querySelector("[data-now-showing-section]"),
    nowShowingPanel: document.querySelector("[data-now-showing-panel]"),
    nowShowingContent: document.querySelector("[data-now-showing-content]"),
  };

  // Builds and mounts each section's chevron toggle via the shared
  // ui-components.js factories, replacing the old bespoke
  // updateCollapsibleSection() helper (removed below) with the same
  // mechanism every other tool in the suite already uses. Notes/Dice/Now
  // Showing/Group Share each get a full createCollapsibleSection (their
  // headers had nothing else in them); Game Log keeps its existing
  // Refresh-button sibling and static content, so only its toggle button is
  // built via createIconButton + a direct bindCollapsibleToggle call.
  // Keeps a state object's own `.collapsed` in sync after a direct click on
  // a factory-built toggle (which handles the actual show/hide itself,
  // internally, with no hook to observe from outside) — registered after
  // the toggle already exists, so it fires after bindCollapsibleToggle's own
  // click listener on the same element (same-element listeners run in
  // registration order), reading the just-applied result rather than racing
  // it. Without this, external code that reads e.g. gameLogPanelState.collapsed
  // (see setGameLogCollapsed's other call sites) would see a stale value
  // after any manual click.
  function syncCollapsedStateOnClick(toggle, stateObj) {
    toggle?.addEventListener("click", () => {
      stateObj.collapsed = toggle.getAttribute("aria-expanded") !== "true";
    });
  }

  {
    const notesSection = createCollapsibleSection({
      label: "Notes",
      collapsed: notesState.collapsed,
      content: elements.notesPanel,
    });
    document.querySelector("[data-notes-mount]")?.appendChild(notesSection.section);
    elements.notesToggle = notesSection.toggle;
    applyNotesCollapse = notesSection.setCollapsed;
    syncCollapsedStateOnClick(notesSection.toggle, notesState);
  }
  {
    const diceSectionBuilt = createCollapsibleSection({
      label: "Dice Roller",
      helpTopic: "character.dice",
      collapsed: dicePanelState.collapsed,
      content: elements.dicePanel,
    });
    document.querySelector("[data-dice-mount]")?.appendChild(diceSectionBuilt.section);
    elements.diceToggle = diceSectionBuilt.toggle;
    applyDiceCollapse = diceSectionBuilt.setCollapsed;
    syncCollapsedStateOnClick(diceSectionBuilt.toggle, dicePanelState);
  }
  {
    const nowShowingSectionBuilt = createCollapsibleSection({
      label: "Now Showing",
      collapsed: nowShowingPanelState.collapsed,
      content: elements.nowShowingPanel,
    });
    document.querySelector("[data-now-showing-mount]")?.appendChild(nowShowingSectionBuilt.section);
    elements.nowShowingToggle = nowShowingSectionBuilt.toggle;
    applyNowShowingCollapse = nowShowingSectionBuilt.setCollapsed;
    syncCollapsedStateOnClick(nowShowingSectionBuilt.toggle, nowShowingPanelState);
  }
  {
    const groupShareSectionBuilt = createCollapsibleSection({
      label: "Group characters",
      collapsed: groupShareState.collapsed,
      content: elements.groupSharePanel,
      // Group Share's click needs bespoke gating (blocked entirely without
      // an active share token) and a post-expand re-render — behavior the
      // factory's own auto-toggle-on-click can't express. autoBindToggle
      // only sets the toggle's initial visual state here; the actual click
      // listener is the explicit handler registered further below,
      // alongside the other toggles' click wiring.
      autoBindToggle: false,
    });
    document.querySelector("[data-group-share-mount]")?.appendChild(groupShareSectionBuilt.section);
    elements.groupShareToggle = groupShareSectionBuilt.toggle;
    applyGroupShareCollapse = groupShareSectionBuilt.setCollapsed;
  }
  {
    const gameLogToggleButton = createIconButton({
      icon: "tabler:chevron-right",
      className: "collapsible-toggle",
      includeToggleLabel: true,
    });
    gameLogToggleButton.setAttribute("aria-expanded", gameLogPanelState.collapsed ? "false" : "true");
    document.querySelector("[data-game-log-toggle-mount]")?.appendChild(gameLogToggleButton);
    elements.gameLogToggle = gameLogToggleButton;
    applyGameLogCollapse = bindCollapsibleToggle(gameLogToggleButton, elements.gameLogPanel, {
      collapsed: gameLogPanelState.collapsed,
      expandLabel: "Expand game log",
      collapseLabel: "Collapse game log",
    });
    syncCollapsedStateOnClick(gameLogToggleButton, gameLogPanelState);
  }

  assignSectionAriaConnections();

  const characterJsonPanel = createJsonDataPanel({
    label: "JSON Data",
    getData: () => state.draft || {},
  });
  document.querySelector("[data-character-json-mount]")?.appendChild(characterJsonPanel.section);
  const renderPreview = characterJsonPanel.render;

  setNotesCollapsed(true);
  setGroupShareCollapsed(groupShareState.collapsed);
  setDiceCollapsed(false);
  setNowShowingCollapsed(false);
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
  // Awaited before the first render — this view has no Font field of its
  // own to lazily load a custom/Google font the way the Template editor's
  // does, so a character whose template uses one needs the shared library
  // populated up front (see applyTextFormatting/findFontOptionByFamily in
  // component-styles.js) or that font would never actually load here.
  await loadCustomFonts();
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
  // Every other path into the game log (loading a character, opening a
  // share link) already calls this itself once it resolves — this covers
  // the one case none of them do: an authenticated GM/admin who opens
  // Workbench with no character loaded and no share link at all, relying
  // solely on their own active-campaign selection (see syncGameLogContext's
  // fallback) to see the table they're running.
  void syncGameLogContext();

  function bindUiEvents() {
    if (elements.characterSelect) {
      elements.characterSelect.addEventListener("change", async () => {
        const selectedId = elements.characterSelect.value;
        if (selectedId) {
          await loadCharacter(selectedId);
        }
      });
    }

    // Field edits only ever touched state.draft in memory — nothing called
    // persistDraft() until the player hit Save or left Edit mode, so a long
    // edit session could sit unsaved indefinitely (and a GM's concurrent
    // change elsewhere, e.g. the combat tracker, risked being clobbered by
    // that eventual full-draft overwrite). One delegated listener here
    // (canvasRoot persists across renderCanvas()'s innerHTML rebuilds, so
    // this only needs wiring once) auto-saves as soon as a bound field is
    // committed by leaving it — not on every keystroke (the existing
    // per-keystroke `input` listeners still just update state.draft; this
    // only adds when that draft gets persisted). `focusout` bubbles, unlike
    // `blur`, which is what makes one container-level listener work at all.
    if (elements.canvasRoot) {
      elements.canvasRoot.addEventListener("focusout", (event) => {
        const target = event.target.closest?.("[data-binding-path]");
        if (!target) return;
        // A disabled/read-only control can't receive focus/input in the
        // first place (see renderInputContent etc. setting
        // `input.disabled = !editable`), so reaching this listener at all
        // already means the current mode+component allow editing — Edit
        // mode, or a component explicitly authored "Editable in Play" (see
        // isEditable/isComponentEditableInPlay). No need to separately
        // re-derive that here.
        if (target.disabled || target.readOnly) return;
        // renderCanvas() fully rebuilds the DOM on every keystroke
        // (applyBindingValue), destroying and recreating the very field
        // being typed into, then synchronously restoring focus onto its
        // replacement (restoreActiveField) — a transient, app-internal
        // blur, not the user actually leaving the field. Deferred one
        // tick so document.activeElement reflects where focus lands once
        // that whole synchronous rebuild+refocus cycle finishes; only a
        // real "left the field" (focus now outside the canvas, or on a
        // non-bound element) triggers a save.
        window.setTimeout(() => {
          const active = document.activeElement;
          if (active && elements.canvasRoot.contains(active) && active.closest?.("[data-binding-path]")) {
            return;
          }
          void persistDraft({ silent: true });
        }, 0);
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

    if (elements.saveButton) {
      elements.saveButton.addEventListener("click", async () => {
        await persistDraft({ silent: false });
        syncCharacterActions();
      });
    }

    if (elements.viewToggle) {
      elements.viewToggle.addEventListener("click", () => {
        void setMode(state.mode === "edit" ? "view" : "edit");
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

    // Notes/Dice/Game Log/Now Showing no longer need a click handler here —
    // their factory-built toggles already flip on click internally
    // (createCollapsibleSection/bindCollapsibleToggle), with
    // syncCollapsedStateOnClick (above) keeping each state object's
    // `.collapsed` in sync for any code that reads it afterward. Group
    // Share keeps its own explicit handler below since its click needs
    // bespoke gating a plain toggle can't express.
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

  function setNotesCollapsed(collapsed) {
    const next = Boolean(collapsed);
    notesState.collapsed = next;
    applyNotesCollapse(next);
  }

  function setDiceCollapsed(collapsed) {
    const next = Boolean(collapsed);
    dicePanelState.collapsed = next;
    applyDiceCollapse(next);
  }

  function setGameLogCollapsed(collapsed) {
    const next = Boolean(collapsed);
    gameLogPanelState.collapsed = next;
    applyGameLogCollapse(next);
  }

  // Independent of setNowShowingVisible (further below) — that toggles the
  // whole *section's* d-none based on whether there's an active spotlight
  // to show at all, while this toggles just the *panel* inside it, same as
  // Dice/Game Log's own manual collapse. The two are orthogonal: a
  // spotlight can arrive while the panel is manually collapsed (it stays
  // collapsed until the player opens it), and collapsing the panel never
  // hides the section itself while a spotlight is active.
  function setNowShowingCollapsed(collapsed) {
    const next = Boolean(collapsed);
    nowShowingPanelState.collapsed = next;
    applyNowShowingCollapse(next);
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
    // A System definition (abilities, saves, combatBindings, generator
    // properties, ...) is exactly the kind of content that gets edited
    // directly and often — trusting a local cache as the first choice here
    // (as this used to) meant any such edit could silently never reach an
    // already-visited browser. Network first, local only as an offline
    // fallback if the fetch itself fails — not a stale-but-present cache
    // winning over a reachable server. Same reasoning as fetchTemplate/
    // fetchCharacterPayload elsewhere in this file.
    if (dataManager.baseUrl) {
      try {
        const shareToken = metadata.shareToken || "";
        const result = await dataManager.get("systems", systemId, {
          preferLocal: false,
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
          return payload;
        }
      } catch (error) {
        console.warn("Character editor: unable to fetch system, trying local cache", error);
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
    return null;
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
      // A raw/imported Library character (Loom's DDB import, most often)
      // with no Template assigned used to stay hidden here entirely —
      // "there's nothing to bind fields against" was true, but it also
      // meant an imported character silently never showed up anywhere in
      // Workbench, with no explanation. Now included, labeled "(No
      // template)" — selecting one loads it straight into the "assign a
      // template" prompt (renderCanvas's own createUntemplatedCharacterPrompt)
      // instead of a sheet.
      .filter((entry) => entry.id)
      .map((entry) => {
        const templateId = entry.template || "";
        const templateLabel = templateId ? templateCatalog.get(templateId)?.title || templateId : "No template";
        const baseLabel = entry.title || entry.id;
        const label = `${baseLabel} (${templateLabel})`;
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

    updateToolbarButton(elements.exportButton, {
      disabled: !draftHasId || locked,
      disabledTitle: locked
        ? "Group characters must be claimed before exporting."
        : "Select a character to export data.",
    });

    const canWrite = dataManager.hasWriteAccess("characters");
    const canEditRecord = draftHasId ? characterAllowsEdits(metadata) : false;

    updateToolbarButton(elements.saveButton, {
      disabled:
        !draftHasId ||
        locked ||
        !canEditRecord ||
        !canWrite ||
        state.mode !== "edit" ||
        !hasUnsavedCharacterChanges(),
      disabledTitle: !draftHasId
        ? "Select a character first."
        : locked
        ? "Group characters must be claimed before saving."
        : !canEditRecord || !canWrite
        ? "You don't have permission to save this character."
        : "No changes to save.",
    });

    if (!elements.deleteCharacterButton) {
      return;
    }
    // Delete Character now lives in the shared left-pane toolbar rather than
    // a standalone button with its own data-workbench-view-panel tag — it
    // already has this classList.toggle("d-none", ...) below, and tagging it
    // for view-switching too would just fight over the same class (the
    // generic panel-toggle in workbench.js's setWorkbenchView always runs
    // LAST on a tab click, so it would win over whatever this function
    // decided about permissions the last time a character loaded). Folding
    // "only in Edit view" into THIS check instead — reading
    // document.body.dataset.workbenchView directly, the same shared signal
    // setNowShowingVisible's own comment already established — is the one
    // owner. That still needs this function to actually re-run on every
    // view switch, not just the edit/play ones setMode itself covers —
    // confirmed real gap: switching from Edit to the Template tab never
    // called setMode at all (only "edit"/"play" do), so this never re-ran,
    // and the button — visible from Edit — simply stayed visible. Fixed by
    // exporting this function so workbench.js's setWorkbenchView can call
    // it on every tab click, not just edit/play ones (see its own comment).
    //
    // Delete is deliberately wider than canEditRecord: an admin can delete
    // any character regardless of ownership (server's is_owner() already
    // grants this), but only the actual owner gets to edit/save it — so this
    // doesn't fold the admin bypass into canEditRecord itself.
    const isAdmin = dataManager.getUserTier() === "admin";
    const canDeleteRecord = draftHasId && (isAdmin || canEditRecord);
    const showDelete =
      canDeleteRecord && canWrite && state.mode === "edit" && document.body.dataset.workbenchView === "edit";
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
      const result = rollDiceExpression(trimmed, { context: state.draft || {} });
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

  // Unlike refreshNowShowing() (a single-slot "show whichever thing was
  // broadcast most recently, of any kind" panel — deliberately kind-agnostic,
  // same as spotlight-inbox.js's own "notify about anything new"), this
  // needs the CURRENT state of specifically the "encounter" kind, same
  // as common/js/lib/spotlight.js's own resolveActiveSpotlightEntry (that
  // module isn't imported on this page, or this would just call it directly)
  // — an encounter spotlighted earlier is still active even if the GM
  // later ALSO shows an unrelated NPC/map card; only an encounter-kind
  // spotlight/clear (or a kind-agnostic global clear) actually changes
  // whether combat is still "on". Confirmed bug this fixes: taking the
  // single latest entry across every kind meant showing any OTHER kind of
  // card mid-combat silently broke "push initiative to active encounter"
  // for every player, with no encounter-related action having happened at
  // all. Returns "" if nothing's currently spotlighted, or the spotlighted
  // thing isn't an encounter.
  function resolveActiveEncounterId() {
    const latest = gameLogState.entries.find((entry) => {
      if (entry?.type === "spotlight") return entry.payload?.kind === "encounter";
      if (entry?.type === "spotlight-clear") return !entry.payload?.kind || entry.payload.kind === "encounter";
      return false;
    });
    if (!latest || latest.type === "spotlight-clear") {
      return "";
    }
    return String(latest.payload?.id || "").trim();
  }

  // Initiative is a one-way push, not a synced field (see the Initiative
  // component's own comment in the template) — a rolled result updates
  // whatever active encounter this character is currently in, not the
  // character record itself, since initiative isn't persistent state.
  async function pushInitiativeToActiveEncounter(value) {
    const encounterId = resolveActiveEncounterId();
    if (!encounterId || !state.draft?.id) {
      return;
    }
    try {
      const { payload: encounter } = await dataManager.get("encounter", encounterId);
      const combatant = (encounter.combatants || []).find(
        (entry) => entry.refKind === "character" && entry.refId === state.draft.id
      );
      if (!combatant) {
        return;
      }
      combatant.initiative = value;
      await dataManager.save("encounter", encounterId, encounter);
      status.show(`Initiative ${value} sent to the encounter.`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.warn("Character editor: unable to push initiative to the active encounter", error);
    }
  }

  function handleComponentRoll(expression, label, component) {
    if (!expression) {
      return;
    }
    const text = typeof label === "string" && label.trim() ? label.trim() : "";
    const result = executeDiceRoll(expression, { label: text, updateInput: true });
    if (result && component?.id === "initiative") {
      void pushInitiativeToActiveEncounter(result.total);
    }
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
      handleComponentRoll(expression, label, component);
    });
    container.appendChild(button);
    return container;
  }

  function createSpinnerButton(iconName, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary";
    button.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = iconName;
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", onClick);
    return button;
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
        // Same "print templates share this bucket now" filter as the Template
        // view's loadTemplateRecords — a character can only open with a
        // character template.
        if ((item.category || "character") !== "character") return;
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
      const sharedIds = [];
      shared.forEach((entry) => {
        if (!entry || !entry.id) return;
        sharedIds.push(entry.id);
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
      // Public library characters (e.g. Rook/The Red Lanterns — is_public=1
      // DB rows seeded from common/data/character/*.json, owned by whoever
      // authored them, not the current session) were silently dropped here
      // before — this block only ever read remote.owned/remote.shared, never
      // remote.public, unlike loadTemplateRecords' own
      // dataManager.collectListEntries(remote), which already defaults to
      // ["items","owned","shared","public"]. ownership:"public" is already
      // fully handled downstream (view-only gating, "Public characters are
      // view-only" messaging — see characterOwnership/describeCharacterEditRestriction),
      // so this was purely a missing catalog entry, not a missing capability.
      const publicChars = Array.isArray(remote?.public) ? remote.public : [];
      const publicIds = [];
      publicChars.forEach((entry) => {
        if (!entry || !entry.id) return;
        publicIds.push(entry.id);
        registerCharacterRecord({
          id: entry.id,
          title: entry.name || entry.title || entry.id,
          template: entry.template || "",
          templateTitle: entry.template_title || "",
          source: "remote",
          ownership: "public",
          ownerId: entry.owner_id ?? null,
          ownerUsername: entry.owner_username || "",
          ownerTier: entry.owner_tier || "",
        });
      });

      // Local storage mirrors every remote save (see DataManager.save), so a
      // character deleted elsewhere (e.g. via Loom, a separate DataManager
      // instance/tab) leaves a stale local copy behind that would otherwise
      // linger in this dropdown forever. This fresh, authoritative owned/
      // shared/public listing is the source of truth for what this account
      // still has — any catalog entry previously believed owned/shared/
      // public but now missing from it is confirmed gone, so it's pruned the
      // same way handleCharacterLoadFailure does for a 404'd load. Builtin/
      // local-only (anonymous) entries are never touched here.
      const confirmedOwnedIds = new Set(ownedIds);
      const confirmedSharedIds = new Set(sharedIds);
      const confirmedPublicIds = new Set(publicIds);
      Array.from(characterCatalog.entries()).forEach(([id, metadata]) => {
        if (metadata.source === "builtin") return;
        const isStaleOwned = metadata.ownership === "owned" && !confirmedOwnedIds.has(id);
        const isStaleShared = metadata.ownership === "shared" && !confirmedSharedIds.has(id);
        const isStalePublic = metadata.ownership === "public" && !confirmedPublicIds.has(id);
        if (!isStaleOwned && !isStaleShared && !isStalePublic) return;
        try {
          dataManager.removeLocal("characters", id);
        } catch (storageError) {
          console.warn("Character editor: unable to clear local cache for", id, storageError);
        }
        removeCharacterRecord(id);
      });

      syncCharacterOptions();
    } catch (error) {
      console.warn("Character editor: unable to refresh remote characters", error);
    }
  }

  function setGroupShareCollapsed(collapsed) {
    const next = Boolean(collapsed);
    groupShareState.collapsed = next;
    applyGroupShareCollapse(next);
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
    const nowShowingPanelId = ensureElementId(elements.nowShowingPanel, "character-now-showing");
    if (nowShowingPanelId && elements.nowShowingToggle) {
      elements.nowShowingToggle.setAttribute("aria-controls", nowShowingPanelId);
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

  const SPOTLIGHT_KIND_LABELS = {
    npc: "an NPC",
    location: "a Location",
    monster: "a Monster",
    effect: "an Effect",
    map: "a Map",
    encounter: "an Encounter",
  };

  function describeSpotlightPayload(payload) {
    const kind = typeof payload?.kind === "string" ? payload.kind.trim() : "";
    const article = SPOTLIGHT_KIND_LABELS[kind] || (kind ? `a "${kind}"` : "something");
    return `Showed ${article} to the table`;
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
    } else if (entry?.type === "spotlight") {
      // A spotlight entry's own message is always empty (see
      // server/groups.py's create_group_log_entry) — the payload
      // ({kind, id, templateId}) is all there is, and the entity's real
      // name/description already renders richly right next to the log in
      // the Now-showing panel, so this line just needs to say something
      // happened, not repeat that lookup here too.
      container.classList.add("game-log-entry--spotlight");
      const payload = entry && typeof entry.payload === "object" && entry.payload ? entry.payload : {};
      summary.textContent = describeSpotlightPayload(payload);
    } else if (entry?.type === "spotlight-clear") {
      container.classList.add("game-log-entry--spotlight");
      summary.textContent = "Stopped showing to the table";
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

  // "Now showing" — renders the latest `spotlight` game log entry (posted by
  // common/js/lib/spotlight.js's "Show to table" modal, from Sanctum/Forge/
  // Crucible/Vault) via Press's own template.createPage rendering, reused
  // as-is rather than reimplemented here. Runs after every refreshGameLog
  // poll (same 30s cadence the game log itself uses) since spotlight entries
  // are just another entry type in the same log.
  // Bootstrap's .d-flex/.d-none utility classes are both declared
  // `!important`, so toggling between them (never the plain `hidden`
  // attribute, which a `!important` `display` class silently defeats — the
  // same landmine Press's own app.js documents for setElementVisible)
  // avoids any display-property specificity conflict.
  // Two independent conditions decide whether this section shows: an
  // active spotlight (this function's own `visible` argument, computed
  // from gameLogState) AND the current top-level view being Play/Edit —
  // Now Showing has no place in the Template editor, where there's no
  // "now" being played. workbench.js sets document.body.dataset.
  // workbenchView on every view switch; this section no longer carries
  // data-workbench-view-panel itself (removed from index.html), so this is
  // the only thing gating it — one source of truth instead of two
  // separate d-none togglers fighting over the same element.
  function setNowShowingVisible(visible) {
    if (!elements.nowShowingSection) {
      return;
    }
    const viewAllows = document.body.dataset.workbenchView !== "template";
    const shouldShow = Boolean(visible) && viewAllows;
    elements.nowShowingSection.classList.toggle("d-none", !shouldShow);
    elements.nowShowingSection.classList.toggle("d-flex", shouldShow);
  }

  function hideNowShowing() {
    setNowShowingVisible(false);
    if (elements.nowShowingContent) {
      elements.nowShowingContent.innerHTML = "";
    }
  }

  function renderNowShowingPlain(entity, label) {
    if (!elements.nowShowingContent) {
      return;
    }
    const card = document.createElement("div");
    card.className = "border rounded-3 bg-body p-3 w-100";
    const name = document.createElement("div");
    name.className = "fw-semibold";
    name.textContent = entity?.name || label || "Untitled";
    card.appendChild(name);
    if (entity?.description) {
      const description = document.createElement("p");
      description.className = "small text-body-secondary mb-0 mt-2";
      description.textContent = entity.description;
      card.appendChild(description);
    }
    elements.nowShowingContent.innerHTML = "";
    elements.nowShowingContent.appendChild(card);
  }

  // Orrery maps have no print-card rendering of their own (see spotlight.js's
  // LINK_ONLY_KINDS) — a map is a pannable spatial canvas, not a single-entity
  // card Press can lay out. Spotlighting one just links back into Orrery
  // itself with ?map=<id> (Orrery's own loadMapFromUrlParam loads it,
  // read-only for anyone but its owner — see Orrery's getVisibleLayerIds/
  // tiered Views). Opens in a new tab so the game log/Now-showing panel
  // stays visible alongside the map.
  function renderNowShowingMapLink(entity, id) {
    if (!elements.nowShowingContent) {
      return;
    }
    const card = document.createElement("div");
    card.className = "border rounded-3 bg-body p-3 w-100 d-flex flex-column gap-2";
    const name = document.createElement("div");
    name.className = "fw-semibold";
    name.textContent = entity?.name || "Map";
    const link = document.createElement("a");
    link.className = "btn btn-outline-primary btn-sm align-self-start";
    const params = new URLSearchParams({ map: id });
    // An authenticated group member already has real "shared with group"
    // access to a spotlighted map (spotlightToGroup shares it, not just logs
    // it) and needs nothing extra. An anonymous share-link visitor has no
    // session at all, so the same share token this page itself was opened
    // with has to travel along too — it's what get_item's narrow spotlight
    // exception (server/storage.py) checks to grant read access to exactly
    // the currently-spotlighted map, for someone with no account.
    if (gameLogState.shareToken) {
      params.set("share", gameLogState.shareToken);
    }
    link.href = `${resolveToolHref("orrery", resolveToolContextPath())}?${params.toString()}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open map";
    card.append(name, link);
    elements.nowShowingContent.innerHTML = "";
    elements.nowShowingContent.appendChild(card);
  }

  // An Encounter is a live, constantly-changing combat state, not a
  // single-entity card Press can lay out — same reasoning as the map-link
  // case above (see spotlight.js's LINK_ONLY_KINDS). Spotlighting one links
  // to the suite Dashboard's Combat Tracker widget (?encounter=<id>) rather
  // than fetching+rendering a static card; the widget itself re-polls the
  // encounter record on its own interval once open.
  function renderNowShowingEncounterLink(entity, id) {
    if (!elements.nowShowingContent) {
      return;
    }
    const card = document.createElement("div");
    card.className = "border rounded-3 bg-body p-3 w-100 d-flex flex-column gap-2";
    const name = document.createElement("div");
    name.className = "fw-semibold";
    name.textContent = entity?.name || "Encounter";
    const link = document.createElement("a");
    link.className = "btn btn-outline-primary btn-sm align-self-start";
    const params = new URLSearchParams({ encounter: id });
    if (gameLogState.shareToken) {
      params.set("share", gameLogState.shareToken);
    }
    link.href = `${resolveToolHref("home", resolveToolContextPath())}?${params.toString()}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open combat tracker";
    card.append(name, link);
    elements.nowShowingContent.innerHTML = "";
    elements.nowShowingContent.appendChild(card);
  }

  // Renders one card through Press's real template.createPage — the exact
  // function Press's own Grid View uses for a single-card render
  // (singleCardIndex), so this gets identical output to what the GM sees in
  // Press, not a second reimplementation. Card dimensions are authored in
  // real inches (a print concept), so the result is wrapped and scaled down
  // to fit this sidebar rather than shown at literal print size.
  function renderNowShowingCard(templateRecord, entity) {
    if (!elements.nowShowingContent) {
      return;
    }
    const template = createTemplate(templateRecord);
    const format = getFormatById(template);
    const orientation = format?.defaultOrientation || "portrait";
    const size = getPageSize(template, format?.id, orientation);
    const side = template.sides?.[0] || "front";
    const page = template.createPage(side, {
      size,
      format,
      data: entity,
      page: template.pages?.[side] || {},
      singleCardIndex: 0,
    });
    const scaleWrapper = document.createElement("div");
    scaleWrapper.style.transformOrigin = "top center";
    scaleWrapper.style.overflow = "hidden";
    scaleWrapper.appendChild(page);
    elements.nowShowingContent.innerHTML = "";
    elements.nowShowingContent.appendChild(scaleWrapper);
    // Auto-width/font-size/overflow passes need real measured layout, so
    // they only run once the page is actually attached and visible — same
    // ordering constraint Press's own renderPreview/renderGridView follow.
    applyAutoWidthCaps(page, { safeInsetIn: template.card?.safeInset ?? 0 });
    applyAutoFontSizing(page);
    applyOverflowIndicators(page);
    const cardWidthPx = page.getBoundingClientRect().width;
    const cardHeightPx = page.getBoundingClientRect().height;
    const availableWidth = elements.nowShowingContent.clientWidth || cardWidthPx;
    const scale = cardWidthPx > 0 ? Math.min(1, availableWidth / cardWidthPx) : 1;
    if (scale < 1) {
      scaleWrapper.style.transform = `scale(${scale})`;
      scaleWrapper.style.width = `${cardWidthPx}px`;
      scaleWrapper.style.height = `${cardHeightPx * scale}px`;
    }
  }

  async function refreshNowShowing() {
    if (!elements.nowShowingSection) {
      return;
    }
    // gameLogState.entries is already sorted newest-first (see
    // refreshGameLog) — the first spotlight-or-clear entry found here is
    // whichever happened most recently, so a `spotlight-clear` posted after
    // the last `spotlight` correctly wins and hides the panel instead of
    // this re-showing a stale broadcast.
    const latest = gameLogState.entries.find((entry) => entry?.type === "spotlight" || entry?.type === "spotlight-clear");
    if (!latest || latest.type === "spotlight-clear") {
      lastRenderedSpotlightEntryId = null;
      hideNowShowing();
      return;
    }
    if (latest.id === lastRenderedSpotlightEntryId) {
      return;
    }
    lastRenderedSpotlightEntryId = latest.id;
    const spotlight = latest.payload || {};
    const kind = String(spotlight.kind || "").trim();
    const id = String(spotlight.id || "").trim();
    const templateId = String(spotlight.templateId || "").trim();
    if (!kind || !id) {
      hideNowShowing();
      return;
    }
    setNowShowingVisible(true);
    if (elements.nowShowingContent) {
      elements.nowShowingContent.innerHTML = '<p class="text-body-secondary small mb-0">Loading…</p>';
    }
    let entity = null;
    try {
      // The share token matters here too, not just for the map-link case
      // below: an anonymous share-link visitor has no session at all, so
      // fetching even a plain-card/print-card spotlighted entity needs it to
      // read anything the group doesn't also own publicly.
      entity = await loadLibraryData(`${kind}/${id}`, dataManager, gameLogState.shareToken);
    } catch (error) {
      if (elements.nowShowingContent) {
        elements.nowShowingContent.innerHTML =
          '<p class="text-body-secondary small mb-0">Unable to load the spotlighted card.</p>';
      }
      return;
    }
    if (kind === "map") {
      renderNowShowingMapLink(entity, id);
      return;
    }
    if (!templateId) {
      renderNowShowingPlain(entity, spotlight.label);
      return;
    }
    try {
      const { payload: templateRecord } = await dataManager.get("templates", templateId, {
        shareToken: gameLogState.shareToken,
      });
      renderNowShowingCard(templateRecord, entity);
    } catch (error) {
      // A private/unshared template (or one that's since been deleted)
      // shouldn't block showing the entity itself — fall back to plain.
      renderNowShowingPlain(entity, spotlight.label);
    }
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
      void refreshNowShowing();
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
    const name = typeof state.draft.name === "string" && state.draft.name.trim()
      ? state.draft.name.trim()
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
    if (!dataManager.isAuthenticated()) {
      characterGroupCache.delete(state.draft?.id);
      clearGameLogContext();
      return;
    }
    // A loaded character's own campaign membership takes priority — playing
    // a specific PC should always follow that PC's table. Only falls
    // through to the active-campaign selector below when there's no
    // character-derived campaign to use (no character loaded at all, or one
    // that isn't in any campaign group) — the common GM/admin case: running
    // a table (and, per this session's spotlight feature, showing things to
    // it) without necessarily having any one PC loaded in Workbench.
    let campaign = null;
    if (state.draft?.id) {
      let memberships = characterGroupCache.get(state.draft.id);
      if (force || memberships === undefined) {
        memberships = await refreshCharacterGroups(state.draft.id);
      }
      const groups = Array.isArray(memberships) ? memberships : [];
      campaign =
        groups.find((entry) => typeof entry?.type === "string" && entry.type.toLowerCase() === "campaign") ||
        groups[0] ||
        null;
    }
    if (campaign) {
      const ownerId = campaign.owner_id ?? null;
      const userId = dataManager.session?.user?.id ?? null;
      const access = ownerId === userId ? "owner" : "member";
      setGameLogContext({ groupId: campaign.id, groupName: campaign.name || "", access });
      return;
    }
    // The same shared, cross-tool selection every other tool's header
    // exposes via its own Campaign dropdown (auth-ui.js/data-manager.js's
    // getActiveGroup/setActiveGroup) — listGroups() (and so this) only ever
    // includes groups the current user owns, so "owner" is always correct
    // here, not just an assumption.
    const active = dataManager.getActiveGroup();
    if (active?.groupId) {
      setGameLogContext({ groupId: active.groupId, groupName: active.name || "", access: "owner" });
      return;
    }
    clearGameLogContext();
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
        systemIds: Array.isArray(member.system_ids) ? member.system_ids : member.system ? [member.system] : [],
        systemNames: Array.isArray(member.system_names) ? member.system_names : member.system_name ? [member.system_name] : [],
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
    const systemLabel = Array.isArray(member.system_names) && member.system_names.length
      ? member.system_names.join(", ")
      : member.system_name || member.system;
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
        systemIds: Array.isArray(member.system_ids) ? member.system_ids : member.system ? [member.system] : [],
        systemNames: Array.isArray(member.system_names) ? member.system_names : member.system_name ? [member.system_name] : [],
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

  // Called from workbench.js when the Template editor tab saves — this
  // file loads its own separate copy of a template once, when a character
  // is loaded, and otherwise never re-fetches it, so an edit saved in the
  // other tab used to sit stale here until a full page reload. Only
  // reloads if the currently-open character actually uses the template
  // that was just saved; a no-op otherwise. Doesn't touch character
  // data/unsaved edits — applyTemplateData only ever replaces
  // state.template/state.components.
  async function reloadTemplateIfActive(templateId) {
    if (!templateId || !state.draft || state.draft.template !== templateId) {
      return;
    }
    await loadTemplateById(templateId);
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
      // preferLocal: false — the template a character's sheet renders
      // against is exactly the kind of content that gets edited directly
      // (Loom, a template-editor save, a direct data fix) out from under
      // whatever this browser last cached. A stale local copy here would
      // silently keep rendering an old sheet layout with no visible sign
      // anything was wrong — same reasoning as this file's own character
      // loader (fetchCharacterPayload) and Loom's editor.
      const result = await dataManager.get("templates", metadata.id, { preferLocal: false });
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
      // Neither was previously carried through from the saved template at
      // all — Base font silently fell back to DEFAULT_FONT_FAMILY here
      // regardless of what the Template editor showed (that page never
      // saved it either — see serializeTemplateState's own comment); this
      // file has its own separate template object, so it needs its own
      // copy of the same normalization workbench-template-view.js uses.
      baseFontFamily: typeof payload.baseFontFamily === "string" ? payload.baseFontFamily : "",
      defaults: normalizeTemplateDefaults(payload.defaults),
      // The sheet's own literal background/border — same "this file has
      // its own separate template object" reasoning as baseFontFamily/
      // defaults above.
      backgroundColor: typeof payload.backgroundColor === "string" ? payload.backgroundColor : "",
      backgroundColorBinding: typeof payload.backgroundColorBinding === "string" ? payload.backgroundColorBinding : "",
      backgroundColorFormula: typeof payload.backgroundColorFormula === "string" ? payload.backgroundColorFormula : "",
      borderStyle: typeof payload.borderStyle === "string" ? payload.borderStyle : "",
      borderColor: typeof payload.borderColor === "string" ? payload.borderColor : "",
      borderColorBinding: typeof payload.borderColorBinding === "string" ? payload.borderColorBinding : "",
      borderColorFormula: typeof payload.borderColorFormula === "string" ? payload.borderColorFormula : "",
      borderWidth: payload.borderWidth ?? null,
      borderSides: payload.borderSides && typeof payload.borderSides === "object" ? payload.borderSides : null,
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
      // Library-sourced characters (Loom's convention, matching every other
      // Library kind) never embed their own id in the JSON body — id is the
      // filename/key it was fetched by, not a field inside it. Workbench-
      // created characters do embed it, but relying on that would silently
      // leave state.draft.id undefined for anything Loom manages, which
      // then breaks both the canvas placeholder check and the character
      // <select>'s value.
      state.character.id = id;
      state.draft.id = id;
      state.characterOrigin = metadata.source || payload.origin || "";
      registerCharacterRecord({
        id: state.draft.id,
        title: state.draft.name || metadata.title || state.draft.id,
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
      status.show(`Loaded ${state.draft.name || metadata.title || state.draft.id}`, {
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
      // preferLocal: false — a "remote" character is a real, server-synced
      // record (unlike the "local" branch above, a genuinely local-only
      // anonymous draft with no server counterpart, which SHOULD trust its
      // local copy since that's the only copy that exists). DataManager's
      // localStorage cache is keyed by the literal bucket string passed in,
      // with no awareness that "characters" (used everywhere in Workbench)
      // and "character" (used by Loom's Library editor for the same kind)
      // are the same server-side record — so this cache can silently drift
      // arbitrarily far from what Loom, or any other client, has since
      // saved to the server, with no visible sign anything is stale. Same
      // reasoning as Loom's own loadLibraryEntry (see its comment).
      const result = await dataManager.get("characters", metadata.id, {
        preferLocal: false,
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
    // Same cascade-via-inheritance the Template editor's own canvas uses —
    // see font-library.js's own doc comment on DEFAULT_FONT_FAMILY.
    elements.canvasRoot.style.fontFamily = state.template?.baseFontFamily || DEFAULT_FONT_FAMILY;
    // Same sheet-wide literal background/border as the Template editor's
    // own canvas (workbench-template-view.js's identical call) — reuses
    // applyComponentStyles directly rather than a second hand-written
    // border/background application.
    applyComponentStyles(elements.canvasRoot, {
      textColor: "",
      backgroundColor: resolveTemplateColor("backgroundColor"),
      borderStyle: state.template?.borderStyle || "",
      borderColor: resolveTemplateColor("borderColor"),
      borderWidth: state.template?.borderWidth,
      borderSides: state.template?.borderSides,
      borderRadius: 0,
      padding: "",
      margin: "",
      className: "",
    });
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
      // Two different reasons land here, worth telling apart: a character
      // that has never had a template assigned at all (most often a raw
      // Loom/DDB import — see syncCharacterOptions's own comment) gets an
      // actionable prompt instead of the generic failure message, which
      // otherwise reads as "something's broken" rather than "pick one".
      elements.canvasRoot.appendChild(
        state.draft.template
          ? createCanvasPlaceholder("The linked template could not be loaded.", { variant: "root" })
          : createUntemplatedCharacterPrompt()
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
      const card = renderComponentCard(component);
      if (card) {
        fragment.appendChild(card);
      }
    });
    elements.canvasRoot.appendChild(fragment);
    refreshTooltips(elements.canvasRoot);
    syncModeIndicator();
  }

  // renderCanvas's own placeholder for a character with no `template` at
  // all (as opposed to one whose linked template failed to load) — an
  // actionable inline template picker, not just createCanvasPlaceholder's
  // plain (and aria-hidden, deliberately non-interactive) text message.
  // Most often reached for a raw Loom/DDB import, which has no concept of
  // Workbench templates at all — see syncCharacterOptions's own comment.
  function createUntemplatedCharacterPrompt() {
    const wrap = document.createElement("div");
    wrap.className = "workbench-drop-placeholder workbench-drop-placeholder--root d-flex flex-column align-items-center gap-2";
    const message = document.createElement("div");
    message.textContent = "This character has no template assigned yet — pick one to start its sheet.";
    wrap.appendChild(message);

    const row = document.createElement("div");
    row.className = "d-flex gap-2 align-items-center";
    // .workbench-drop-placeholder (the wrapper's own class, above) sets
    // pointer-events: none suite-wide — correct for its usual job (a plain,
    // decorative, aria-hidden empty-dropzone label), but it also silently
    // disables the select/button below unless re-enabled here. Confirmed
    // real bug otherwise: the dropdown never opened at all, since nothing
    // inside a pointer-events:none ancestor receives pointer events
    // regardless of its own styling.
    row.style.pointerEvents = "auto";
    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    select.style.maxWidth = "16rem";
    select.setAttribute("aria-label", "Template");
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Select template";
    select.appendChild(blank);
    Array.from(templateCatalog.values())
      .filter((entry) => entry.id)
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id, undefined, { sensitivity: "base" }))
      .forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.title || entry.id;
        select.appendChild(option);
      });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-primary";
    button.textContent = "Assign Template";
    button.addEventListener("click", () => void assignTemplateToCharacter(select.value));
    row.append(select, button);
    wrap.appendChild(row);
    return wrap;
  }

  // Wires an already-existing character (most often a template-less Loom/
  // DDB import) up to a Workbench template — the one-time assignment
  // startNewCharacter's own flow does for a brand-new character, just for a
  // record that already exists. Loads the template, sets `draft.template`,
  // and folds the template's own schema into `draft.systemIds` (union, not
  // replace — an imported character may already carry its own Assigned
  // Systems, e.g. Loom's DDB import tagging `sys.dnd5e`; this only ever
  // ADDS to that set, matching Loom's own populateLibraryTemplateSelect
  // behavior, never silently drops what's already there), then persists.
  async function assignTemplateToCharacter(templateId) {
    const trimmedTemplate = (templateId || "").trim();
    if (!trimmedTemplate) {
      status.show("Select a template first.", { type: "warning", timeout: 2000 });
      return;
    }
    if (!state.draft?.id) {
      return;
    }
    const templateMetadata = templateCatalog.get(trimmedTemplate);
    if (!templateMetadata) {
      status.show("Template metadata unavailable.", { type: "warning", timeout: 2200 });
      return;
    }
    await loadTemplateById(trimmedTemplate);
    if (state.template?.id !== trimmedTemplate) {
      return;
    }
    state.draft.template = trimmedTemplate;
    const schema = state.template?.schema || templateMetadata?.schema || "";
    if (schema) {
      const ids = new Set(Array.isArray(state.draft.systemIds) ? state.draft.systemIds : []);
      ids.add(schema);
      state.draft.systemIds = Array.from(ids);
    }
    await persistDraft({ silent: false });
    renderCanvas();
    renderPreview();
    syncCharacterOptions();
  }

  // `nested: true` is passed for a Container zone child (see
  // renderContainerComponent) — goes "bare" (see createCanvasCardElement),
  // same as every top-level card here: this file never shows the type-icon
  // badge/actions row at all, in either Edit or Play mode — that's a
  // Template-editor-only authoring affordance (see
  // workbench-template-view.js's own createComponentElement, which is a
  // genuinely separate function, not shared with this one). Edit and Play
  // are meant to render identically here except for which fields
  // isEditable() actually allows typing into — showing the badge only in
  // Edit mode (as this used to) was an unintended, unrequested divergence.
  function renderComponentCard(component, { nested = false } = {}) {
    if (!isComponentVisible(component)) {
      return null;
    }
    const bare = nested;
    const collapsible = isComponentCollapsible(component);
    // `bare` (nested children only) drops the whole card box (background/
    // shadow/corner-rounding) — the outer Container's own card already
    // provides that boundary once, so a nested child sits flush with its
    // cell instead of stacking a second one. No padding to reconcile here
    // either way — the base .workbench-canvas-card rule has none of its
    // own by default (a real per-component Padding setting owns that now).
    const wrapper = createCanvasCardElement({
      classes: ["character-component"],
      dataset: { componentId: component.uid || "" },
      gapClass: "gap-3",
      bare,
    });
    const { header } = createStandardCardChrome({
      icon: null,
      iconLabel: component.type,
      headerOptions: { classes: ["character-component-header"], sortableHandle: false },
      actionsOptions: false,
      iconOptions: { classes: ["character-component-icon"] },
      removeButtonOptions: false,
    });
    wrapper.appendChild(header);
    // Resolved ONCE, used for both the content below AND the wrapper's own
    // applyComponentStyles call further down — previously computed twice,
    // redundantly, with content getting the RAW component (so a heading's
    // own applyTextFormatting call, e.g. Container/Image, never saw a
    // binding/formula/template-default-resolved color, only the wrapper
    // did). Safe to pass into every interactive renderer too — write-back
    // (onChange/updateBinding) keys off component.uid/binding, never the
    // object reference itself, and this is always a shallow copy with
    // every other field untouched.
    const resolvedComponent = resolveComponentColors(component);
    const content = renderComponentContent(resolvedComponent);
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
            setElementCollapsed(body, next);
          }
          wrapper.classList.toggle("is-collapsed", next);
        },
      });
      if (body instanceof HTMLElement && body.id) {
        collapseButton.setAttribute("aria-controls", body.id);
      }
      header.appendChild(collapseButton);
      if (body instanceof HTMLElement) {
        setElementCollapsed(body, collapsed);
      }
      wrapper.classList.toggle("is-collapsed", collapsed);
      setCollapsed(collapsed);
    } else {
      if (component?.uid) {
        collapsedComponents.delete(component.uid);
      }
      if (body instanceof HTMLElement) {
        setElementCollapsed(body, false);
      }
      wrapper.classList.remove("is-collapsed");
    }
    applyComponentStyles(wrapper, excludeToggleWrapperColors(resolvedComponent));
    return wrapper;
  }

  function renderComponentContent(component) {
    switch (component.type) {
      case "input":
        return renderInputComponent(component);
      case "repeater":
        return renderRepeaterComponent(component);
      case "image":
        return renderImageComponent(component);
      case "icon":
        return renderIconComponent(component);
      case "text":
        return renderTextComponent(component);
      case "container":
        return renderContainerComponent(component);
      case "track":
        return renderTrackComponent(component);
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

  // itemContext ({ repeaterComponent, index, item }), when set, means this
  // control is being rendered inside a Repeater item template rather than
  // at the top level — reads/writes are scoped to that one array item's own
  // field instead of the top-level draft (see resolveRepeaterItemValue /
  // setRepeaterItemValue). Every other component type below that supports
  // real editing (Toggle, Select Group, Track) follows this same pattern,
  // so Repeater items get the exact same interactive control as everywhere
  // else instead of a separate, narrower hand-written copy.
  function renderInputComponent(component, itemContext = null) {
    const writeValue = (comp, value) => {
      if (itemContext) {
        setItemContextValue(itemContext, comp.binding, value);
      } else {
        updateBinding(comp.binding, value);
      }
    };
    return renderInputContent(component, {
      resolveValue(comp, fallback) {
        if (itemContext) {
          const resolved = resolveItemContextValue(itemContext, comp.binding);
          return resolved != null ? resolved : fallback;
        }
        return resolveComponentValue(comp, fallback);
      },
      editable(comp) {
        return itemContext
          ? Boolean(comp.binding) && (state.mode === "edit" || isRepeaterItemNodeEditableInPlay(comp, itemContext.item))
          : isEditable(comp);
      },
      onChange(comp, value) {
        writeValue(comp, value);
      },
      resolveOptions(comp) {
        return resolveSelectionOptions(comp, { itemContext });
      },
      // Confirmed real bug: an Input's Checkbox/Radio group variant never
      // consulted its own Source binding at all — only Select did (via
      // resolveOptions above) — so a checkbox-group field with a Source set
      // (e.g. Blades in the Dark's Trauma/Armor/Load, sourceBinding
      // "@traumaConditions"/"@armorTypes"/"@loadTiers") silently fell all
      // the way back to whatever static `options` a freshly-added component
      // ships with ("Option A"/"Option B") instead of the System's real
      // vocabulary. resolveSelectionOptions already does exactly the right
      // thing (Source first, static `options` only when no Source is set)
      // — reused here rather than a second, narrower copy of that fallback
      // logic. allowBlank: false — a blank "nothing chosen" pill makes
      // sense for a single-select dropdown, not a multi-select checkbox/
      // radio group (see resolveSelectionOptions's own comment).
      resolveChoiceOptions(comp) {
        return resolveSelectionOptions(comp, { allowBlank: false, itemContext });
      },
      // Play view, not Editable in Play (renderInputContent only ever
      // calls this when !editable already) — Select/Number/Textarea/
      // plain-text Input all read like plain text there instead of a
      // grayed-out disabled control. Edit view keeps the normal boxed
      // look regardless — that's the authoring context, a locked/formula-
      // driven field there is still meant to read as "a real field, just
      // not touchable right now," not blend into plain prose. Doesn't
      // depend on itemContext — `editable` (checked by the caller before
      // this even runs) already accounts for a Repeater item's own
      // editability, so this applies the same way inside a Repeater cell.
      plainReadOnly() {
        return state.mode !== "edit";
      },
      decorate(el, comp, meta) {
        assignBindingMetadata(el, comp, meta);
      },
      // Number fields authored "Editable in Play" (HP, AC, ...) get +/-
      // stepper buttons instead of the plain input — they're adjusted
      // repeatedly and quickly mid-combat, and a spinner is faster/more
      // reliable than selecting and retyping a value each time, in both
      // Play and Edit view. A `roller` takes priority over this:
      // Initiative is both Play-editable (combat-tracker.js needs a
      // generic path to its modifier for the "Roll Initiative" toolbar
      // button) and a rollable field on the sheet — for the sheet itself,
      // rolling is the more useful action than nudging the value by 1, so
      // the roll button wins for any component that has both.
      wrapControl(input, comp, { labelText, editable }) {
        const variant = (comp.variant || "text").toLowerCase();
        const hasRoller = typeof comp.roller === "string" && comp.roller.trim().length > 0;
        if (!itemContext && editable && variant === "number" && !hasRoller && isComponentEditableInPlay(comp)) {
          const step = Number(comp.step) || 1;
          const applyDelta = (delta) => {
            const current = Number(input.value) || 0;
            const next = current + delta;
            input.value = next;
            writeValue(comp, next);
            void persistDraft({ silent: true });
          };
          const spinnerGroup = document.createElement("div");
          spinnerGroup.className = "input-group input-group-sm";
          input.classList.add("text-center");
          spinnerGroup.appendChild(createSpinnerButton("tabler:minus", `Decrease ${labelText}`, () => applyDelta(-step)));
          spinnerGroup.appendChild(input);
          spinnerGroup.appendChild(createSpinnerButton("tabler:plus", `Increase ${labelText}`, () => applyDelta(step)));
          return spinnerGroup;
        }
        const inputContainer = document.createElement("div");
        inputContainer.className = "position-relative";
        const componentUid = comp?.uid || "";
        const rollExpressions = componentUid ? componentRollDirectives.get(componentUid) : null;
        // Shown in both Play and Edit view — a rollable field (Initiative,
        // any formula-driven check/save) is just as useful to roll while
        // editing the sheet as while playing.
        const showRollOverlay = Array.isArray(rollExpressions) && rollExpressions.length > 0;
        if (showRollOverlay) {
          input.classList.add("character-rollable-input");
        }
        inputContainer.appendChild(input);
        if (showRollOverlay) {
          inputContainer.appendChild(createRollOverlayButton(comp, rollExpressions));
        }
        return inputContainer;
      },
    });
  }

  // Resolves ONE item-template node's own value against a single repeater
  // item's data — Press's own per-item context convention: an object
  // item's fields are spread directly into scope ("@name" means item.name,
  // not "@arrayField[].name"), a primitive item binds via "@value" — rather
  // than the live draft record. See resolveRepeaterItemPath/
  // setRepeaterItemValue below for the write-back counterpart, used by
  // Input/Toggle/Select Group/Track item nodes to make them real, editable
  // controls instead of read-only text.
  //
  // "@value" always means "this item itself," checked before the object/
  // primitive branch below — previously only reachable for a primitive item
  // (`typeof item !== "object"`), since a Repeater item is normally either a
  // primitive or a field-shaped object where `@value` would otherwise try
  // to walk a literal `.value` property. Source-driven Tabs (Container's own
  // tabLabelsSourceBinding) need this to also work when the item genuinely
  // **is** an array or object — e.g. Blades in the Dark's restructured
  // `playbooks.Cutter`, a bare abilities array with no wrapping object at
  // all — "@value" there has to mean the array itself, not a nonexistent
  // `.value` property on it.
  function resolveRepeaterItemValue(item, raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text.startsWith("@")) return raw;
    const path = text.slice(1).split(".").map((segment) => segment.trim()).filter(Boolean);
    if (!path.length) return undefined;
    if (path.length === 1 && path[0] === "value") {
      return item;
    }
    if (item === null || typeof item !== "object") {
      return undefined;
    }
    let cursor = item;
    for (const segment of path) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) return undefined;
      cursor = cursor[segment];
    }
    return cursor;
  }

  // Full write-target path for one item-template node's own field: the
  // repeater's own top-level binding path (e.g. ["inventory"]), then the
  // array index, then the item-relative binding's own path segments (same
  // parsing resolveRepeaterItemValue uses) — except the primitive-array
  // "@value" case, which IS the item itself, so it resolves to just
  // [...repeaterPath, index] with no further segment.
  function resolveRepeaterItemPath(component, index, raw) {
    const repeaterPath = resolveBindingPath(component?.binding);
    if (!repeaterPath) return null;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text.startsWith("@")) return null;
    const itemPath = text.slice(1).split(".").map((segment) => segment.trim()).filter(Boolean);
    if (!itemPath.length) return null;
    if (itemPath.length === 1 && itemPath[0] === "value") {
      return [...repeaterPath, String(index)];
    }
    return [...repeaterPath, String(index), ...itemPath];
  }

  // The write-back counterpart to resolveRepeaterItemValue — lets an Input/
  // Toggle/Select Group/Track dropped into a Repeater's item template be a
  // real, editable control whose changes land on that specific array item's
  // own field, using the same setValueAtPath/rerender/undo-push machinery
  // updateBinding itself uses, just rooted at the computed item path.
  function setRepeaterItemValue(component, index, raw, value) {
    const pathSegments = resolveRepeaterItemPath(component, index, raw);
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

  // Lowercase, collapse non-alphanumeric runs to "_", trim — used only for
  // a Source-driven Tab's own write-path key (resolveTabItemPath below),
  // matching the slugs Blades in the Dark's character data already used
  // before this session's own migration (`specialAbilitiesPurchased.cutter`,
  // `.not_to_be_trifled_with`).
  function slugify(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  // The write-path counterpart to a Source-driven Tab's own item context —
  // resolveRepeaterItemPath's equivalent for `kind: "tab"`. A Repeater's
  // items live in a character-owned array, so "item N" naturally maps to a
  // write path rooted at that array. A tab's own "item" comes from SYSTEM
  // data (no character-owned array to index into at all) — the write path
  // instead keys off the tab's own stable identity (its playbook name),
  // via a literal `{item}` placeholder token inside the binding string
  // (e.g. `@specialAbilitiesPurchased.{item}`), substituted with the
  // slugified tab key before segment-walking. A binding with no `{item}`
  // token at all falls back to an ordinary top-level path (rare — a tab's
  // own child binding straight to top-level character data, not scoped to
  // "this tab" at all).
  function resolveTabItemPath(rawBinding, tabKey) {
    const text = typeof rawBinding === "string" ? rawBinding.trim() : "";
    if (!text.startsWith("@")) return null;
    const substituted = text.slice(1).replace(/\{item\}/g, slugify(tabKey));
    return resolveBindingPath(`@${substituted}`);
  }

  // setRepeaterItemValue's counterpart for `kind: "tab"` — same
  // getValueAtPath/applyBindingValue/undo-stack reuse, only the path
  // resolution differs.
  function setTabItemValue(rawBinding, tabKey, value) {
    const pathSegments = resolveTabItemPath(rawBinding, tabKey);
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

  // Single write dispatch every item-template node's own writeValue closure
  // calls now, instead of calling setRepeaterItemValue directly — picks the
  // right path-resolution strategy for itemContext.kind ("repeater", the
  // default/original shape, vs "tab", see setTabItemValue above); every
  // caller stays agnostic to which kind of item it's actually inside.
  function setItemContextValue(itemContext, raw, value) {
    if (itemContext?.kind === "tab") {
      setTabItemValue(raw, itemContext.key, value);
    } else {
      setRepeaterItemValue(itemContext?.repeaterComponent, itemContext?.index, raw, value);
    }
  }

  // Read counterpart to setItemContextValue, same dispatch. Confirmed real
  // bug this fixes: every per-type renderer's own resolveValue used to call
  // resolveRepeaterItemValue(itemContext.item, raw) unconditionally — for
  // `kind: "tab"`, itemContext.item is the tab's own SYSTEM-sourced item
  // (e.g. a playbook's bare abilities array), which has no
  // `specialAbilitiesPurchased` property on it at all, so a tab child's own
  // `@specialAbilitiesPurchased.{item}` binding always resolved to
  // undefined on READ — even though setItemContextValue's WRITE side
  // already correctly wrote the value into the live character draft. A
  // checkbox toggled inside a tab looked like it worked (its own DOM
  // checked state flips immediately, no rerender needed) but reading it
  // back — switching tabs away and back, which tears down and rebuilds
  // that zone's DOM — always came back empty, since the read path was
  // never actually looking in the draft at all.
  function resolveItemContextValue(itemContext, raw) {
    if (itemContext?.kind === "tab") {
      const pathSegments = resolveTabItemPath(raw, itemContext.key);
      return pathSegments ? getValueAtPath(pathSegments) : undefined;
    }
    return resolveRepeaterItemValue(itemContext?.item, raw);
  }

  // One item-template node, rendered against one item. Input/Toggle/Select
  // Group/Track delegate to their own real top-level renderers (with an
  // itemContext override so reads/writes scope to this item — see those
  // functions' own comments) instead of a separate, narrower hand-written
  // copy, so an item control is guaranteed identical to its top-level
  // counterpart. Text/Icon/Image aren't interactive at the top level either
  // (they never call updateBinding there), so they keep their existing
  // display-only handling. Container/Repeater nested inside an item
  // template remain unsupported — falls back to a plain resolved-value text
  // line rather than reproducing every type's own full layout model here.
  // repeaterComponent is omitted for a header cell (see renderRepeaterTable/
  // renderRepeaterListHeader) — a header row is authored once, not per
  // item, so there's no specific array item to write an edit back to.
  // Without itemContext, Input/Toggle/Select Group/Track just fall back to
  // their own ordinary top-level rendering (editable against the header
  // node's own binding into the top-level draft, same as any other
  // component outside a Repeater) rather than being force-disabled —
  // matching Press's own "headers render with the outer context, not item
  // context."
  // Every type here now accepts (component, itemContext) uniformly (see
  // component-renderers.js's shared ctx pattern), so this dispatch is just
  // a thin delegate into the SAME functions the top-level
  // renderComponentContent switch uses — not a separate hand-rolled
  // implementation per type. This is what retired the previous per-type
  // duplicate bodies here (which had drifted: no aria-label/empty-state on
  // Icon, no Label heading on Image, a different placeholder image URL) and
  // the one-off renderRepeaterContainerNode (Container gets itemContext
  // support the same way every other type does now).
  // Shared by renderRepeaterItemNode and renderTabItemNode below — the
  // switch itself doesn't care which kind of item context it's rendering
  // against (every render*Component function already just forwards
  // itemContext through, agnostic to its own shape), only how each one's
  // own writeValue/resolveOptions resolve underneath (setItemContextValue,
  // resolveSelectionOptions's own itemContext branch). `item` stays a
  // separate parameter, not derived from `itemContext.item` — a header-row
  // call (itemContext null) still needs it for resolveRepeaterItemNodeColors/
  // the plain-text default branch below.
  function dispatchItemContextNode(node, item, itemContext) {
    // Resolved ONCE — used for the content dispatch below AND the final
    // applyComponentStyles call, same reasoning as renderComponentCard's
    // own identical fix (a Container/Image item-template node's own
    // heading needs the resolved color too, not just the outer element).
    const resolvedNode = resolveRepeaterItemNodeColors(node, item);
    let element;
    switch (resolvedNode.type) {
      case "input":
        element = renderInputComponent(resolvedNode, itemContext);
        break;
      case "toggle":
        element = renderToggleComponent(resolvedNode, itemContext);
        break;
      case "select-group":
        element = renderSelectGroupComponent(resolvedNode, itemContext);
        break;
      case "track":
        element = renderTrackComponent(resolvedNode, itemContext);
        break;
      case "text":
        element = renderTextComponent(resolvedNode, itemContext);
        break;
      case "icon":
        element = renderIconComponent(resolvedNode, itemContext);
        break;
      case "image":
        element = renderImageComponent(resolvedNode, itemContext);
        break;
      case "container":
        element = renderContainerComponent(resolvedNode, itemContext);
        break;
      case "repeater":
        // A Repeater dropped inside another Repeater's item template — the
        // Template editor's own canvas already accepted this drop (its
        // zone/dropzone machinery is generic, no type restriction), but
        // Play/Edit had no case for it here, so it silently fell through
        // to the plain-text default below instead of actually repeating.
        // itemContext (this OUTER repeater's own item/index) is what makes
        // the nested Repeater's binding resolve relative to THIS row
        // rather than the top-level draft — see renderRepeaterComponent's
        // own comment.
        element = renderRepeaterComponent(resolvedNode, itemContext);
        break;
      default: {
        const value = resolveRepeaterItemValue(item, resolvedNode.binding);
        const text = document.createElement("div");
        text.className = "text-body small";
        text.textContent = value != null && value !== "" ? String(value) : resolvedNode.label || resolvedNode.name || "";
        element = text;
      }
    }
    // Every top-level component gets its border/colors/padding/margin from
    // renderComponentCard's own applyComponentStyles call — but an item-
    // template node rendered here deliberately skips renderComponentCard
    // entirely (no header/chrome/drag-handle belongs on a repeater row
    // cell), which meant it ALSO skipped the only place those styles ever
    // get applied. Not just Container — every type above returned bare,
    // unstyled content. Applied here, once, after the dispatch, rather than
    // inside each individual render*Component function, so it can't be
    // missed again by a future type added to this switch.
    if (element instanceof HTMLElement) {
      applyComponentStyles(element, excludeToggleWrapperColors(resolvedNode));
    }
    return element;
  }

  function renderRepeaterItemNode(node, item, repeaterComponent, index) {
    const itemContext = repeaterComponent
      ? { kind: "repeater", repeaterComponent, ownerComponent: repeaterComponent, index, item }
      : null;
    return dispatchItemContextNode(node, item, itemContext);
  }

  // Source-driven Tabs' own entry point (Container's tabLabelsSourceBinding
  // — see renderContainerComponent's own renderZone) — same dispatch as a
  // Repeater item, a different itemContext shape: no character-owned array
  // to index into (the tab's own "item" comes from System data, e.g. one
  // playbook's own bare abilities array), so writes key off `key` (the
  // tab's own stable identity, its playbook name) via resolveTabItemPath/
  // setTabItemValue instead of a numeric index.
  function renderTabItemNode(node, item, containerComponent, index, key) {
    const itemContext = { kind: "tab", item, key, index, ownerComponent: containerComponent };
    return dispatchItemContextNode(node, item, itemContext);
  }

  // Ported from Press's own Repeater decorator (none/bullet/number/custom)
  // — bullet is a literal "•", number is "N.", custom is either a literal
  // string or (if it starts with "@") resolved per-item the same way an
  // item-template node's own binding would be, via resolveRepeaterItemValue.
  function resolveRepeaterDecorator(component, item, index) {
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : null;
    const type = decorator?.type || "none";
    if (type === "bullet") return "•";
    if (type === "number") return `${index + 1}.`;
    if (type === "custom") {
      // formula first, same precedence as every other single-field content
      // control (Text/Icon/Image/Container) — a decorator's own custom
      // text is always per-row already (a decorator has no "top-level, no
      // itemContext" mode to begin with), so this always resolves against
      // the current item, no dataContext branch needed.
      const formula = typeof decorator.formula === "string" ? decorator.formula.trim() : "";
      if (formula) {
        const result = resolveContextFormula(formula, { item });
        if (result != null && result !== "") return String(result);
      }
      const raw = typeof decorator.text === "string" ? decorator.text : "";
      const trimmed = raw.trim();
      if (trimmed.startsWith("@")) {
        const resolved = resolveRepeaterItemValue(item, trimmed);
        return resolved != null && resolved !== "" ? String(resolved) : "";
      }
      return raw;
    }
    return "";
  }

  // Reads one column's zone nodes for a given row-kind ("item"/"header"),
  // falling back to the legacy single `zones.item` array (from before
  // columns/header existed) for item-column 0 — an old saved template's
  // Repeater keeps this shape until it's next opened and re-saved in the
  // Template editor (see workbench-template-view.js's own ensureRepeaterZone
  // migration), and this file has no equivalent zone-normalizing hydrate
  // pass of its own to rely on instead.
  function getRepeaterColumnZoneNodes(component, prefix, col) {
    const zones = component.zones && typeof component.zones === "object" ? component.zones : {};
    const key = `${prefix}-${col}`;
    if (Array.isArray(zones[key])) {
      return zones[key];
    }
    if (prefix === "item" && col === 0 && Array.isArray(zones.item)) {
      return zones.item;
    }
    return [];
  }

  function getRepeaterColumnCount(component) {
    const raw = Number(component.columns);
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 8) : 1;
  }

  function renderRepeaterItemRow(component, templateNodes, item, index, onRemoveItem = null) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2 border-bottom pb-2";
    row.dataset.repeaterIndex = String(index);
    const decoratorText = resolveRepeaterDecorator(component, item, index);
    if (decoratorText) {
      const marker = document.createElement("span");
      marker.className = "text-body-secondary flex-shrink-0";
      marker.textContent = decoratorText;
      row.appendChild(marker);
    }
    const body = document.createElement("div");
    body.className = "d-flex flex-column gap-1 flex-grow-1";
    templateNodes.forEach((node) => {
      if (!isRepeaterItemNodeVisible(node, item)) {
        return;
      }
      body.appendChild(renderRepeaterItemNode(node, item, component, index));
    });
    row.appendChild(body);
    if (onRemoveItem) {
      row.appendChild(createRepeaterRemoveButton(() => onRemoveItem(index)));
    }
    return row;
  }

  // The non-repeating header block for list mode (columns <= 1) — rendered
  // once, outside the per-item loop, from the "header-0" zone. Table mode's
  // own header (renderRepeaterTable) is the columns > 1 counterpart.
  function renderRepeaterListHeader(headerNodes) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-start gap-2 border-bottom pb-2 fw-semibold";
    headerNodes.forEach((node) => {
      if (!isRepeaterItemNodeVisible(node, null)) {
        return;
      }
      row.appendChild(renderRepeaterItemNode(node, null));
    });
    return row;
  }

  // A real <table>/<colgroup>/<thead>/<tbody> for a multi-column Repeater —
  // ported from Press's own Repeater "table" mode (see the plan doc), not a
  // CSS Grid, since this is genuinely tabular data: the header row must
  // render exactly once regardless of how many items repeat, which a
  // Container's zones (everything in them repeats) can't do at all.
  function renderRepeaterTable(component, columns, itemColumns, items, onRemoveItem = null) {
    const table = document.createElement("table");
    table.className = "workbench-repeater-table";
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : null;
    const hasDecorator = Boolean(decorator && decorator.type && decorator.type !== "none");
    const templateColumns = typeof component.templateColumns === "string" ? component.templateColumns.trim() : "";
    if (templateColumns) {
      const colgroup = document.createElement("colgroup");
      if (hasDecorator) {
        colgroup.appendChild(document.createElement("col"));
      }
      templateColumns
        .split(/\s+/)
        .filter(Boolean)
        .forEach((width) => {
          const col = document.createElement("col");
          col.style.width = width;
          colgroup.appendChild(col);
        });
      if (onRemoveItem) {
        colgroup.appendChild(document.createElement("col"));
      }
      table.appendChild(colgroup);
    }
    if (component.showHeader) {
      const headerColumns = Array.from({ length: columns }, (_, col) =>
        getRepeaterColumnZoneNodes(component, "header", col)
      );
      const thead = document.createElement("thead");
      const headerTr = document.createElement("tr");
      if (hasDecorator) {
        headerTr.appendChild(document.createElement("th"));
      }
      headerColumns.forEach((nodes) => {
        const th = document.createElement("th");
        nodes.forEach((node) => {
          if (!isRepeaterItemNodeVisible(node, null)) return;
          th.appendChild(renderRepeaterItemNode(node, null));
        });
        headerTr.appendChild(th);
      });
      if (onRemoveItem) {
        headerTr.appendChild(document.createElement("th"));
      }
      thead.appendChild(headerTr);
      table.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    items.forEach((item, index) => {
      const tr = document.createElement("tr");
      if (hasDecorator) {
        const decoratorTd = document.createElement("td");
        decoratorTd.className = "text-body-secondary";
        decoratorTd.textContent = resolveRepeaterDecorator(component, item, index);
        tr.appendChild(decoratorTd);
      }
      itemColumns.forEach((nodes) => {
        const td = document.createElement("td");
        nodes.forEach((node) => {
          if (!isRepeaterItemNodeVisible(node, item)) return;
          td.appendChild(renderRepeaterItemNode(node, item, component, index));
        });
        tr.appendChild(td);
      });
      if (onRemoveItem) {
        const actionTd = document.createElement("td");
        actionTd.appendChild(createRepeaterRemoveButton(() => onRemoveItem(index)));
        tr.appendChild(actionTd);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  // Horizontal's own single-item-template case (rows === 1 — the ability-
  // score box case: one item template, repeated per array item, flowing
  // left-to-right instead of stacking top-to-bottom). Mirrors
  // renderRepeaterItemRow, but as a self-contained column-of-content cell
  // (decorator above its own content, not beside it) meant to sit in a
  // flex ROW of siblings rather than a flex COLUMN of stacked rows.
  function renderRepeaterHorizontalItemCell(component, templateNodes, item, index, onRemoveItem = null) {
    const cell = document.createElement("div");
    cell.className = "d-flex flex-column gap-1";
    cell.dataset.repeaterIndex = String(index);
    // "Fill available width" (Horizontal-only — see createRepeaterFillToggle)
    // — grows every item cell equally to consume the row's full width
    // instead of each sizing to its own content and leaving the remainder
    // empty. min-width:0 lets a cell actually shrink below its content's
    // own width once it's a flex-grow item sharing space with siblings —
    // same reasoning as every other flex-shrink fix in this codebase.
    if (component.fill) {
      cell.style.flex = "1 1 0";
      cell.style.minWidth = "0";
    }
    const decoratorText = resolveRepeaterDecorator(component, item, index);
    if (decoratorText) {
      const marker = document.createElement("div");
      marker.className = "text-body-secondary small";
      marker.textContent = decoratorText;
      cell.appendChild(marker);
    }
    templateNodes.forEach((node) => {
      if (!isRepeaterItemNodeVisible(node, item)) return;
      cell.appendChild(renderRepeaterItemNode(node, item, component, index));
    });
    if (onRemoveItem) {
      cell.appendChild(createRepeaterRemoveButton(() => onRemoveItem(index)));
    }
    return cell;
  }

  // The non-repeating header CELL for Horizontal's rows===1 case — rendered
  // once, placed before the repeated items, from the "header-0" zone.
  // Horizontal's rows>1 counterpart (a full header COLUMN, one label per
  // field-row) is renderRepeaterHorizontalGrid's own header column below.
  function renderRepeaterHorizontalHeaderCell(headerNodes) {
    const cell = document.createElement("div");
    cell.className = "d-flex flex-column gap-1 fw-semibold text-body-secondary flex-shrink-0 border-end pe-3";
    headerNodes.forEach((node) => {
      if (!isRepeaterItemNodeVisible(node, null)) return;
      cell.appendChild(renderRepeaterItemNode(node, null));
    });
    return cell;
  }

  function renderRepeaterHorizontalList(component, templateNodes, items, onRemoveItem = null) {
    const row = document.createElement("div");
    row.className = "d-flex flex-row flex-wrap align-items-start";
    // Matches Container's own "Grid gap (px)" field exactly (see
    // renderRepeaterInspector, Horizontal-only) — was previously a fixed
    // Bootstrap gap-3 utility class with no way to change it.
    const gapPx = Number.isFinite(Number(component.gap)) ? Number(component.gap) : 16;
    row.style.gap = `${gapPx}px`;
    if (component.showHeader) {
      const headerNodes = getRepeaterColumnZoneNodes(component, "header", 0);
      if (headerNodes.length) {
        row.appendChild(renderRepeaterHorizontalHeaderCell(headerNodes));
      }
    }
    items.forEach((item, index) => {
      row.appendChild(renderRepeaterHorizontalItemCell(component, templateNodes, item, index, onRemoveItem));
    });
    return row;
  }

  // Horizontal's own multi-row case (rows > 1) — the full transpose of
  // Vertical table mode: array items become GRID COLUMNS (one per item,
  // auto-generated — there's no fixed count until render) instead of table
  // ROWS, and the `rows` field templates become fixed GRID ROWS within
  // each item's own column instead of table columns within each item's own
  // row. CSS Grid (`grid-auto-flow: column`), not a <table>, specifically
  // because the repeating axis (items) has no fixed count for a
  // <colgroup>-style width list to describe the way Vertical table mode's
  // fixed field-columns do (see renderRepeaterTable/"Column widths" — that
  // field is hidden for Horizontal in the inspector for the same reason).
  // Decorator, when set, becomes an extra grid ROW of per-item markers
  // (transposed from Vertical table mode's own per-item COLUMN) rather
  // than a per-row marker, since "rows" here are now shared FIELD
  // templates, not individual items.
  function renderRepeaterHorizontalGrid(component, rows, itemColumns, items, onRemoveItem = null) {
    const grid = document.createElement("div");
    grid.className = "workbench-repeater-grid";
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : null;
    const hasDecorator = Boolean(decorator && decorator.type && decorator.type !== "none");
    const totalGridRows = rows + (hasDecorator ? 1 : 0) + (onRemoveItem ? 1 : 0);
    grid.style.gridTemplateRows = `repeat(${totalGridRows}, auto)`;
    // Matches Container's own "Grid gap (px)" field exactly (see
    // renderRepeaterInspector, Horizontal-only) — overrides
    // .workbench-repeater-grid's own fixed CSS gap (shell.css), which had
    // no way to change it. Uniform row+column gap, same as Container's own
    // single-value field.
    const gapPx = Number.isFinite(Number(component.gap)) ? Number(component.gap) : 16;
    grid.style.gap = `${gapPx}px`;
    // "Fill available width" (Horizontal-only — see createRepeaterFillToggle)
    // — unlike the rows===1 list case, .workbench-repeater-grid's own
    // grid-auto-columns (shell.css) applies uniformly to every
    // auto-generated column, header included, so a plain CSS override
    // would stretch the header column too. items.length IS known here (at
    // render time, unlike template-authoring time — see this function's
    // own comment above on why "Column widths" is hidden instead), so an
    // explicit grid-template-columns is used instead: the header column
    // (if shown) keeps its own natural width, and only the N item columns
    // share the remaining space equally.
    if (component.fill) {
      const itemTrack = `repeat(${items.length}, minmax(0, 1fr))`;
      grid.style.gridTemplateColumns = component.showHeader ? `auto ${itemTrack}` : itemTrack;
    }

    if (component.showHeader) {
      if (hasDecorator) {
        grid.appendChild(document.createElement("div"));
      }
      const headerRows = Array.from({ length: rows }, (_, row) => getRepeaterColumnZoneNodes(component, "header", row));
      headerRows.forEach((nodes) => {
        const cell = document.createElement("div");
        cell.className = "fw-semibold text-body-secondary small pe-3 border-end";
        nodes.forEach((node) => {
          if (!isRepeaterItemNodeVisible(node, null)) return;
          cell.appendChild(renderRepeaterItemNode(node, null));
        });
        grid.appendChild(cell);
      });
      if (onRemoveItem) {
        grid.appendChild(document.createElement("div"));
      }
    }

    items.forEach((item, index) => {
      if (hasDecorator) {
        const marker = document.createElement("div");
        marker.className = "text-body-secondary small text-center";
        marker.textContent = resolveRepeaterDecorator(component, item, index);
        grid.appendChild(marker);
      }
      itemColumns.forEach((nodes) => {
        const cell = document.createElement("div");
        nodes.forEach((node) => {
          if (!isRepeaterItemNodeVisible(node, item)) return;
          cell.appendChild(renderRepeaterItemNode(node, item, component, index));
        });
        grid.appendChild(cell);
      });
      if (onRemoveItem) {
        const actionCell = document.createElement("div");
        actionCell.className = "text-center";
        actionCell.appendChild(createRepeaterRemoveButton(() => onRemoveItem(index)));
        grid.appendChild(actionCell);
      }
    });
    return grid;
  }

  // Small icon-only button for a Repeater row's own "Remove" control — same
  // iconify/tabler pattern as createSpinnerButton above, just danger-styled
  // and sized down to fit inline with a row's own content.
  function createRepeaterRemoveButton(onRemove) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-danger flex-shrink-0";
    button.setAttribute("aria-label", "Remove item");
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = "tabler:trash";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onRemove();
    });
    return button;
  }

  // Trailing "Add item" control, appended once below the repeated rows
  // (not per-row, unlike Remove) — same iconify/tabler pattern, label text
  // included since a bare icon here would be too easy to miss below a long
  // list.
  function createRepeaterAddButton(onAdd) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-secondary align-self-start d-inline-flex align-items-center gap-1";
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = "tabler:plus";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.appendChild(document.createTextNode("Add item"));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onAdd();
    });
    return button;
  }

  // Whole-array write-back for a Repeater's own Add/Remove-row controls —
  // same top-level-vs-nested distinction updateBinding/setRepeaterItemValue
  // already draw for a single field: a nested Repeater (itemContext set)
  // writes the new array back into the OUTER item's own field via
  // setRepeaterItemValue, exactly like any other item-template node's own
  // binding; a top-level Repeater writes the draft directly via
  // updateBinding. Both already handle undo/rerender/autosave-trigger, so
  // nothing extra is needed here.
  function writeRepeaterItems(component, itemContext, nextItems) {
    if (itemContext) {
      setItemContextValue(itemContext, component.binding, nextItems);
    } else {
      updateBinding(component.binding, nextItems);
    }
  }

  // A freshly added row starts as an empty object — exactly the shape
  // renderRepeaterItemNode already renders correctly for a HEADER row
  // (item=null: resolveRepeaterItemValue returns undefined, and every
  // node type's own existing empty/zero fallback takes it from there), so
  // no new per-type default logic is needed for the common case. The one
  // exception is a primitive-array Repeater — an item-template node bound
  // to the literal "@value" rather than an object field, where the item
  // itself IS the value (see resolveRepeaterItemValue) — there a blank
  // entry has to be the right primitive instead of "{}".
  function createBlankRepeaterItem(itemColumns) {
    const valueNode = itemColumns.flat().find((node) => {
      const binding = typeof node?.binding === "string" ? node.binding.trim() : "";
      return binding === "@value";
    });
    if (valueNode) {
      if (valueNode.type === "input" && valueNode.variant === "number") return 0;
      if (valueNode.type === "input" && valueNode.variant === "checkbox") return [];
      return "";
    }
    return {};
  }

  // itemContext (same shape every other item-template node's own
  // render*Component takes — see renderImageComponent/renderIconComponent/
  // renderTextComponent/renderContainerComponent above) makes THIS repeater
  // a nested one: its own binding resolves relative to the OUTER item
  // (resolveRepeaterItemValue), not the top-level draft — a Repeater bound
  // to "@spells" one level down (the array field on each {level, spells}
  // group) means the group object, not state.draft.spells. Everything
  // below this line stays the same regardless of nesting depth: rendering
  // one row hands its own item down to renderRepeaterItemNode, which
  // dispatches type "repeater" straight back into this function with ITS
  // OWN itemContext, so arbitrarily deep nesting falls out for free.
  function renderRepeaterComponent(component, itemContext = null) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const labelText = component.label || component.name;
    if (labelText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold text-body-secondary";
      heading.textContent = labelText;
      wrapper.appendChild(heading);
    }
    const columns = getRepeaterColumnCount(component);
    const itemColumns = Array.from({ length: columns }, (_, col) => getRepeaterColumnZoneNodes(component, "item", col));
    const hasTemplate = itemColumns.some((nodes) => nodes.length);
    if (!hasTemplate) {
      wrapper.appendChild(
        createCanvasPlaceholder("This repeater has no item template yet — add one in the Template editor.", {
          variant: "compact",
        })
      );
      return wrapper;
    }
    // Repeater has no formula/roller support (supportsFormula: false,
    // workbench-template-view.js) — a plain @path is all its own binding
    // ever holds, so the item-relative resolver every other nested node
    // uses is enough here too, no need for resolveComponentValue's fuller
    // formula/roller machinery.
    const value = itemContext
      ? resolveItemContextValue(itemContext, component.binding)
      : resolveComponentValue(component);
    const items = Array.isArray(value) ? value : [];
    // Add/Remove-row controls — first gated by component.allowAddRemove
    // (createRepeaterAllowAddRemoveToggle, workbench-template-view.js): an
    // explicit per-Repeater authoring choice, off by default, since most
    // Repeaters (ability scores, skills, a fixed defenses list, ...) have a
    // fixed cardinality where Add/Remove would be actively wrong to offer —
    // only a genuinely open-ended list (Inventory, Upgrades, ...) turns it
    // on. Once on, WHEN it's usable follows the same authored "Editable in
    // Play" setting every other component uses (isComponentEditableInPlay),
    // checked on the Repeater ITSELF rather than a per-node condition,
    // since adding/removing a whole row isn't one field's own concern. Edit
    // mode always allows it, same as every other field's own gating; a
    // Repeater with no binding at all has nothing to write to, so it's
    // excluded regardless of mode.
    const canManage =
      Boolean(component.allowAddRemove) &&
      Boolean(component.binding) &&
      (state.mode === "edit" || isComponentEditableInPlay(component));
    const handleAddItem = () => {
      writeRepeaterItems(component, itemContext, [...items, createBlankRepeaterItem(itemColumns)]);
    };
    const handleRemoveItem = (index) => {
      writeRepeaterItems(component, itemContext, items.filter((_, i) => i !== index));
    };
    const onRemoveItem = canManage ? handleRemoveItem : null;
    if (!items.length) {
      wrapper.appendChild(createCanvasPlaceholder("No items.", { variant: "compact" }));
      if (canManage) {
        wrapper.appendChild(createRepeaterAddButton(handleAddItem));
      }
      return wrapper;
    }
    if (component.orientation === "horizontal") {
      wrapper.appendChild(
        columns > 1
          ? renderRepeaterHorizontalGrid(component, columns, itemColumns, items, onRemoveItem)
          : renderRepeaterHorizontalList(component, itemColumns[0], items, onRemoveItem)
      );
      if (canManage) {
        wrapper.appendChild(createRepeaterAddButton(handleAddItem));
      }
      return wrapper;
    }
    if (columns > 1) {
      wrapper.appendChild(renderRepeaterTable(component, columns, itemColumns, items, onRemoveItem));
      if (canManage) {
        wrapper.appendChild(createRepeaterAddButton(handleAddItem));
      }
      return wrapper;
    }
    if (component.showHeader) {
      const headerNodes = getRepeaterColumnZoneNodes(component, "header", 0);
      if (headerNodes.length) {
        wrapper.appendChild(renderRepeaterListHeader(headerNodes));
      }
    }
    items.forEach((item, index) => {
      wrapper.appendChild(renderRepeaterItemRow(component, itemColumns[0], item, index, onRemoveItem));
    });
    if (canManage) {
      wrapper.appendChild(createRepeaterAddButton(handleAddItem));
    }
    return wrapper;
  }

  // Shared by every "single field, three modes" content field (Icon's
  // iconClass+formula, Image's url+formula, Container's label+formula, a
  // Repeater's own item-template Text) — evaluates a formula against the
  // live draft record, or (when itemContext is set) against that one
  // repeater item instead, same "resolve relative to the current row"
  // scoping every other item-template node's own binding resolution
  // already uses. Originally Icon-only (renderIconComponent); factored out
  // once Text/Image/Container needed the identical logic rather than each
  // re-implementing the same dataContext switch.
  function resolveContextFormula(formula, itemContext) {
    const dataContext = itemContext ? (itemContext.item && typeof itemContext.item === "object" ? itemContext.item : {}) : state.draft || {};
    try {
      return evaluateFormulaWithLookup(formula, dataContext, itemContext ? {} : { rollDice: rollDiceExpression });
    } catch (error) {
      console.warn("Character editor: unable to evaluate formula", error);
      return undefined;
    }
  }

  // url — like Icon's iconClass, itself the binding-or-literal string, plus
  // a separate `formula` field for the "=" case (see createImageUrlControl,
  // workbench-template-view.js) — checked first, same precedence
  // resolveComponentValue's own formula-before-binding order uses for every
  // generic-Data-section-driven type.
  function renderImageComponent(component, itemContext = null) {
    return renderImageContent(component, {
      resolveBindableString(raw) {
        if (itemContext) {
          return resolveItemContextValue(itemContext, raw);
        }
        const path = resolveBindingPath(raw);
        return path ? getValueAtPath(path) : undefined;
      },
      evaluateFormula(formula) {
        return resolveContextFormula(formula, itemContext);
      },
    });
  }

  // iconClass, An "@path" value resolves against the live draft record
  // (same mechanism Track's segmentBinding uses), or — when itemContext is
  // set — against that one repeater item, same as every other item-template
  // node's own per-item binding resolution.
  function renderIconComponent(component, itemContext = null) {
    return renderIconContent(component, {
      resolveBindableString(raw) {
        if (itemContext) {
          return resolveItemContextValue(itemContext, raw);
        }
        const path = resolveBindingPath(raw);
        return path ? getValueAtPath(path) : undefined;
      },
      evaluateFormula(formula) {
        return resolveContextFormula(formula, itemContext);
      },
    });
  }

  function renderTextComponent(component, itemContext = null) {
    return renderTextContent(component, {
      resolveValue(comp, fallback) {
        if (itemContext) {
          // Formula first, same precedence as the non-item branch below
          // (resolveComponentValue's own formula-before-binding order) —
          // previously only comp.binding was ever checked here, so a Text
          // dropped into a Repeater's item template silently ignored its
          // own Formula field.
          const formula = typeof comp.formula === "string" ? comp.formula.trim() : "";
          if (formula) {
            const result = resolveContextFormula(formula, itemContext);
            if (result != null) return result;
          }
          const resolved = comp.binding ? resolveItemContextValue(itemContext, comp.binding) : undefined;
          return resolved != null ? resolved : fallback;
        }
        return resolveComponentValue(comp, fallback);
      },
    });
  }

  // resolveContainerColumns/resolveContainerZoneAlignItems/
  // resolveContainerZoneTextAlign now live in ../lib/component-renderers.js,
  // shared with workbench-template-view.js.
  function renderContainerComponent(component, itemContext = null) {
    return renderContainerContent(component, {
      // Container's own Label field accepts a literal "@path" the same way
      // Icon's iconClass does, plus a separate `formula` field for the "="
      // case (see createContainerLabelControl, workbench-template-view.js)
      // — checked first, same precedence as every other single-field
      // content control. Binding/literal resolve against the live draft
      // record, or (when itemContext is set) against that one repeater
      // item, same as every other item-template node's own per-item
      // resolution.
      resolveValue(comp, fallback) {
        const formula = typeof comp.formula === "string" ? comp.formula.trim() : "";
        if (formula) {
          const result = resolveContextFormula(formula, itemContext);
          if (result != null) return result;
        }
        const trimmed = typeof fallback === "string" ? fallback.trim() : "";
        if (!trimmed.startsWith("@")) return fallback;
        if (itemContext) {
          const resolved = resolveItemContextValue(itemContext, trimmed);
          return resolved != null ? resolved : "";
        }
        const path = resolveBindingPath(trimmed);
        const resolved = path ? getValueAtPath(path) : undefined;
        return resolved != null ? resolved : "";
      },
      getZones(comp) {
        return normalizeZones(comp);
      },
      renderZone(comp, zone, { alignItems, textAlign, zoneIndex }) {
        const cell = document.createElement("div");
        cell.className = "d-flex flex-column";
        if (alignItems) cell.style.alignItems = alignItems;
        if (textAlign) cell.style.textAlign = textAlign;
        // A container whose tabs are Source-generated (tabLabelsSourceBinding
        // resolved — see normalizeZones, which builds the same tab list)
        // gives each tab's own children an item-relative context rooted at
        // that tab's own System-sourced item (e.g. one playbook's own
        // abilities array). This is orthogonal to — and checked ahead of —
        // whether this Container is ALSO nested inside an outer Repeater
        // (itemContext, below): a Container can be either, both, or neither.
        const sourceValues = resolveSystemFieldValues(comp.tabLabelsSourceBinding);
        const tabEntries = sourceValues ? resolveTabEntries(sourceValues) : null;
        const tabEntry = tabEntries && Number.isInteger(zoneIndex) ? tabEntries[zoneIndex] : null;
        (zone.components || []).forEach((child) => {
          if (tabEntry) {
            const node = renderTabItemNode(child, tabEntry.item, comp, zoneIndex, tabEntry.key);
            if (node) cell.appendChild(node);
            return;
          }
          // A Container nested inside a Repeater item renders its own
          // zone children the same bare, chrome-less way every other
          // item-template node does — via renderRepeaterItemNode, which
          // threads itemContext through — not renderComponentCard, which
          // has no itemContext concept at all. Without this, a Text (or
          // any other) component nested inside such a Container silently
          // fell back to resolving against the live draft record (or its
          // own placeholder), instead of this one repeater item.
          if (itemContext) {
            const node = renderRepeaterItemNode(child, itemContext.item, itemContext.repeaterComponent, itemContext.index);
            if (node) cell.appendChild(node);
            return;
          }
          const card = renderComponentCard(child, { nested: true });
          if (card) {
            cell.appendChild(card);
          }
        });
        return cell;
      },
      // Keyed by component.uid + item index, not just component.uid — the
      // same Container template renders once per array item, so a shared
      // key would make switching tabs on one item's copy switch every
      // other item's copy too.
      getActiveTabIndex(comp, total) {
        const key = itemContext ? `${comp.uid}:${itemContext.index}` : comp.uid;
        const current = containerActiveTabs.get(key) ?? 0;
        if (!Number.isFinite(total) || total <= 0) return Math.max(0, current);
        return Math.min(Math.max(0, current), Math.max(0, total - 1));
      },
      setActiveTabIndex(comp, index) {
        const key = itemContext ? `${comp.uid}:${itemContext.index}` : comp.uid;
        containerActiveTabs.set(key, Math.max(0, index));
      },
      // Play view only (Edit always shows every tab, switchable — that's
      // the authoring/character-creation surface where picking a different
      // class/playbook is the whole point). A Source-driven tabs container
      // with an authored `activeTabBinding` (e.g. "@class", "@playbook")
      // locks to whichever ONE tab matches the character's own current
      // value there — every other tab is hidden entirely (not just
      // disabled), same as any other field that isn't editable in Play:
      // Play shows who this character IS, not a browsable menu of who they
      // could have been. No `activeTabBinding` authored at all (every
      // template that existed before this feature) is completely
      // unaffected — falls straight through to null, normal switchable
      // tabs, same as today.
      resolveLockedTabIndex(comp) {
        if (state.mode === "edit") return null;
        const binding = typeof comp.activeTabBinding === "string" ? comp.activeTabBinding.trim() : "";
        if (!binding) return null;
        const currentValue = getBindingValue(binding);
        if (currentValue == null) return null;
        const sourceValues = resolveSystemFieldValues(comp.tabLabelsSourceBinding);
        const tabEntries = sourceValues ? resolveTabEntries(sourceValues) : null;
        if (!tabEntries) return null;
        const index = tabEntries.findIndex(
          (entry) => entry.key === currentValue || entry.label === currentValue
        );
        return index >= 0 ? index : null;
      },
      renderEmptyPlaceholder() {
        return createCanvasPlaceholder("No components in this container yet.", { variant: "compact" });
      },
    });
  }

  // Every real (non-preview) formula evaluation in this file goes through
  // here instead of evaluateFormula directly, so `lookup(table, key)`
  // (bindings.js's createLookupFn) is available in every one of them for
  // free — a template author writing `=lookup("abilities","str").color`
  // shouldn't need each call site to specifically wire it in. The System's
  // own field list (state.systemDefinition?.fields) is passed as
  // createLookupFn's fallback source regardless of which `context` this
  // particular call is evaluating against (the active System doesn't
  // change just because this is a repeater-item context instead of the
  // main draft) — Press's own identically-purposed wrapper
  // (resolveBindingWithLookup, template-renderer.js) omits this argument
  // entirely instead, since Press has no System of its own; see
  // createLookupFn's own comment for why that's deliberate.
  function evaluateFormulaWithLookup(formula, context, options = {}) {
    return evaluateFormula(formula, context, {
      ...options,
      functions: { ...(options.functions || {}), lookup: createLookupFn(context, state.systemDefinition?.fields) },
    });
  }

  // Resolves the track's own segment COUNT (not its active value — that's
  // still the ordinary component.binding, via resolveComponentValue like
  // every other bound component) from segmentFormula/segmentBinding, same
  // precedence the Template editor's own resolveTrackSegmentCount uses:
  // formula first, then a binding (either a literal number or an @path into
  // the live draft), then the component's own static `segments`, then 6.
  // Previously nothing in this file read any of these three fields at all —
  // the segmented-track concept authored in the editor didn't exist here.
  function resolveTrackSegments(component) {
    const formula = typeof component.segmentFormula === "string" ? component.segmentFormula.trim() : "";
    if (formula) {
      try {
        const result = evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression });
        const numeric = Number(result);
        if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
      } catch (error) {
        console.warn("Character view: unable to evaluate track segment formula", error);
      }
    }
    const binding = typeof component.segmentBinding === "string" ? component.segmentBinding.trim() : "";
    if (binding) {
      const path = resolveBindingPath(binding);
      if (path) {
        const resolved = Number(getValueAtPath(path));
        if (Number.isFinite(resolved) && resolved > 0) return Math.round(resolved);
      } else {
        const numeric = Number(binding);
        if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
      }
    }
    const fallback = Number(component.segments);
    return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 6;
  }

  function renderTrackComponent(component, itemContext = null) {
    const ctx = {
      resolveTrackState(comp) {
        const segments = Math.max(1, resolveTrackSegments(comp));
        const resolvedValue = Number(
          itemContext
            ? resolveItemContextValue(itemContext, comp.binding) ?? (comp.value ?? 0)
            : resolveComponentValue(comp, comp.value ?? 0)
        );
        const active = Number.isFinite(resolvedValue) ? Math.max(0, Math.min(segments, Math.round(resolvedValue))) : 0;
        return { segments, active };
      },
      editable(comp) {
        return itemContext
          ? Boolean(comp.binding) && (state.mode === "edit" || isRepeaterItemNodeEditableInPlay(comp, itemContext.item))
          : isEditable(comp);
      },
      onChange(comp, value) {
        if (itemContext) {
          setItemContextValue(itemContext, comp.binding, value);
        } else {
          updateBinding(comp.binding, value);
        }
      },
      decorate(el, comp) {
        assignBindingMetadata(el, comp);
      },
    };
    return component.trackShape === "circular"
      ? renderCircularTrackContent(component, ctx)
      : renderLinearTrackContent(component, ctx);
  }

  function renderSelectGroupComponent(component, itemContext = null) {
    const readCurrentValue = (comp) =>
      itemContext
        ? resolveItemContextValue(itemContext, comp.binding) ?? (comp.multiple ? [] : "")
        : resolveComponentValue(comp, comp.value ?? (comp.multiple ? [] : ""));
    const value = readCurrentValue(component);
    const activeValues = component.multiple
      ? Array.isArray(value)
        ? value.map(String)
        : value != null
        ? [String(value)]
        : []
      : value != null
      ? String(value)
      : "";
    return renderSelectGroupContent(component, {
      resolveOptions(comp) {
        return resolveSelectionOptions(comp, { allowBlank: !comp.multiple, itemContext });
      },
      isActive(comp, option) {
        const normalizedOption = String(option.value);
        return comp.multiple ? activeValues.includes(normalizedOption) : normalizedOption === activeValues;
      },
      editable(comp) {
        return itemContext
          ? Boolean(comp.binding) && (state.mode === "edit" || isRepeaterItemNodeEditableInPlay(comp, itemContext.item))
          : isEditable(comp);
      },
      onSelect(comp, optionValue) {
        const setValue = (next) => {
          if (itemContext) {
            setItemContextValue(itemContext, comp.binding, next);
          } else {
            updateBinding(comp.binding, next);
          }
        };
        if (comp.multiple) {
          const current = readCurrentValue(comp);
          const normalizedCurrent = Array.isArray(current)
            ? current.map(String)
            : current != null
            ? [String(current)]
            : [];
          const normalizedOption = String(optionValue);
          const exists = normalizedCurrent.includes(normalizedOption);
          const next = exists
            ? normalizedCurrent.filter((entry) => entry !== normalizedOption)
            : [...normalizedCurrent, normalizedOption];
          setValue(next);
        } else {
          setValue(optionValue);
        }
        // A button click is already a single, discrete action — unlike
        // free-typed text/number input, there's no keystroke-batching
        // reason to wait for a blur event before saving (and, in Play
        // mode, no reliable blur to wait for anyway — see the focusout
        // listener's own comment). Same immediate-persist approach as the
        // HP/AC spinner buttons.
        void persistDraft({ silent: true });
      },
      decorate(el, comp, meta) {
        assignBindingMetadata(el, comp, meta);
      },
    });
  }

  function renderToggleComponent(component, itemContext = null) {
    return renderToggleContent(component, {
      resolveStates(comp) {
        return resolveToggleStates(comp);
      },
      resolveActiveIndex(comp, states) {
        const resolvedState = itemContext
          ? resolveItemContextValue(itemContext, comp.binding)
          : resolveComponentValue(comp);
        const normalizedState = resolvedState != null ? String(resolvedState) : null;
        if (normalizedState !== null) {
          return states.findIndex((s) => String(s.value) === normalizedState);
        }
        return typeof comp.activeIndex === "number" ? comp.activeIndex : -1;
      },
      // Driven by the same authored "Editable in Play" setting every other
      // type uses (isComponentEditableInPlay/isRepeaterItemNodeEditableInPlay)
      // — an explicit per-component choice an author opts into, not a
      // hardcoded Play-mode carve-out inferred from whatever the binding
      // happens to match. feedback_play_mode_never_editable_by_default's
      // original concern was specifically about silently inheriting THAT
      // guess for a type it was never meant for (a proficiency-style
      // indicator toggled mid-combat by accident); an authored, per-
      // component opt-in doesn't have that problem — nothing changes for a
      // Toggle unless someone deliberately turns it on.
      editable(comp) {
        if (componentHasFormula(comp) || isComponentLocked(comp)) {
          return false;
        }
        if (state.mode === "edit") {
          return itemContext ? Boolean(comp.binding) : true;
        }
        return itemContext
          ? Boolean(comp.binding) && isRepeaterItemNodeEditableInPlay(comp, itemContext.item)
          : isComponentEditableInPlay(comp);
      },
      onChange(comp, value) {
        if (itemContext) {
          setItemContextValue(itemContext, comp.binding, value);
        } else {
          updateBinding(comp.binding, value);
        }
      },
      decorate(el, comp) {
        assignBindingMetadata(el, comp);
      },
    });
  }

  function normalizeZones(component) {
    if (!component || !component.zones || typeof component.zones !== "object") {
      return [];
    }
    // Source-driven tabs (tabLabelsSourceBinding) take priority over the
    // static tabLabels list, same resolution ensureContainerZones uses in
    // workbench-template-view.js — see resolveTabEntries' own comment.
    const sourceValues = resolveSystemFieldValues(component.tabLabelsSourceBinding);
    const sourceEntries = sourceValues ? resolveTabEntries(sourceValues) : null;
    return Object.keys(component.zones).map((key, index) => ({
      key,
      label:
        component.zoneLabels?.[key] ||
        (sourceEntries ? sourceEntries[index]?.label : null) ||
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
    // Legacy component type strings from before Track was consolidated
    // into one "track" type with a Shape selector (see
    // workbench-template-view.js's own identical normalization) — rewritten
    // here too since this file has its own separate render dispatch, not a
    // shared one, and would otherwise show "Unsupported component" for an
    // old saved template's track components.
    if (clone.type === "linear-track" || clone.type === "circular-track") {
      if (!clone.trackShape) {
        clone.trackShape = clone.type === "circular-track" ? "circular" : "linear";
      }
      clone.type = "track";
    }
    // Legacy "label" type string from before it was renamed to "text" with a
    // single combined Binding/Text field (see workbench-template-view.js's
    // own identical normalization) — rewritten here too since this file has
    // its own separate render dispatch, not a shared one.
    if (clone.type === "label") {
      clone.type = "text";
    }
    // Toggle's Background used to get an unconditional "#495057, since an
    // empty value isn't a real 'no background' choice for this type" backfill
    // here. That was wrong the moment Background got real unset/X-overlay
    // support in the color picker (see color-picker.js's --unset handling) —
    // "no background" (show through to whatever's behind the shape) became
    // a legitimate, intentional choice, and this hydration step (which runs
    // once, every time a template's saved JSON loads fresh — exactly what
    // Play/Edit does) silently overwrote it right back to grey on every
    // load, even though the JSON itself stayed correctly empty. Toggle is
    // the only component type this ever applied to, and Border keeps its
    // own separate backfill below since that wasn't the reported problem.
    if (clone.type === "toggle") {
      // borderStyle/borderWidth need the same backfill as borderColor —
      // renderToggleContent (component-renderers.js) reads borderStyle
      // directly to decide whether to draw a border at all (it's the
      // switch, same as everywhere else in this app), so old saved data
      // with no borderStyle would render borderless even with a real
      // borderColor sitting right there unused. Matches
      // workbench-template-view.js's own identical fill-in; this file has
      // its own separate hydrateComponent, so it needs its own copy.
      if (!clone.borderStyle || clone.borderStyle === "none") {
        clone.borderStyle = "solid";
      }
      if (!clone.borderColor) {
        clone.borderColor = "#343a40";
      }
      if (clone.borderWidth === null || clone.borderWidth === undefined) {
        clone.borderWidth = 1;
      }
      // foregroundColor (the shape's own fill) used to just BE textColor
      // — see workbench-template-view.js's identical comment for the full
      // reasoning. Inherits whatever textColor currently is so an already-
      // saved Toggle's fill doesn't silently change appearance.
      if (!clone.foregroundColor) {
        clone.foregroundColor = clone.textColor || "#ffffff";
      }
      if (typeof clone.foregroundColorBinding !== "string") {
        clone.foregroundColorBinding = "";
      }
      if (typeof clone.foregroundColorFormula !== "string") {
        clone.foregroundColorFormula = "";
      }
    }
    // Track's active/filled segment color and Select Group's active
    // option color — previously hardcoded CSS (var(--bs-primary)/
    // .btn-outline-secondary/etc.), never a real component field. Matches
    // Bootstrap's own default --bs-primary (#0d6efd) so already-saved
    // components keep their current look until an author customizes it.
    // Matches workbench-template-view.js's own identical fill-in; this
    // file has its own separate hydrateComponent, so it needs its own
    // copy.
    if (clone.type === "track" || clone.type === "select-group") {
      if (!clone.foregroundColor) {
        clone.foregroundColor = "#0d6efd";
      }
      if (typeof clone.foregroundColorBinding !== "string") {
        clone.foregroundColorBinding = "";
      }
      if (typeof clone.foregroundColorFormula !== "string") {
        clone.foregroundColorFormula = "";
      }
    }
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

  // A genuinely new capability (see workbench-template-view.js's
  // createVisibilityControl) — real-time hide, evaluated against the actual
  // character draft. Left blank on both fields, a component always shows.
  // Fails open (visible) on a bad formula rather than silently disappearing
  // UI a template author can't see the cause of.
  function isComponentVisible(component) {
    if (!component) return true;
    const formula = typeof component.visibilityFormula === "string" ? component.visibilityFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression }));
      } catch (error) {
        console.warn("Character editor: unable to evaluate visibility formula", error);
        return true;
      }
    }
    const binding = typeof component.visibilityBinding === "string" ? component.visibilityBinding.trim() : "";
    if (binding) {
      return Boolean(getBindingValue(binding));
    }
    // No condition set — falls back to the unified toggle's own plain
    // manual switch (component.visible, default true) rather than
    // unconditionally always-true, matching Collapsible/Locked's identical
    // plain-boolean-plus-binding/formula shape (see createFormulaToggleField
    // in workbench-template-view.js).
    return component.visible !== false;
  }

  // Same shape as isComponentVisible — a plain boolean (component.collapsible)
  // overridable by a binding/formula pair, driven by the same unified
  // toggle/formula control in the Template editor's Inspector.
  function isComponentCollapsible(component) {
    if (!component) return false;
    const formula = typeof component.collapsibleFormula === "string" ? component.collapsibleFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression }));
      } catch (error) {
        console.warn("Character editor: unable to evaluate collapsible formula", error);
        return false;
      }
    }
    const binding = typeof component.collapsibleBinding === "string" ? component.collapsibleBinding.trim() : "";
    if (binding) {
      return Boolean(getBindingValue(binding));
    }
    const value = component?.collapsible;
    return typeof value === "string" ? value.toLowerCase() === "true" : Boolean(value);
  }

  // Same shape again — "Locked" in the Inspector, component.readOnly in
  // storage (kept as-is to avoid renaming every existing read site of this
  // field — see createComponent's own defaults comment).
  function isComponentLocked(component) {
    if (!component) return false;
    const formula = typeof component.readOnlyFormula === "string" ? component.readOnlyFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression }));
      } catch (error) {
        console.warn("Character editor: unable to evaluate locked formula", error);
        return false;
      }
    }
    const binding = typeof component.readOnlyBinding === "string" ? component.readOnlyBinding.trim() : "";
    if (binding) {
      return Boolean(getBindingValue(binding));
    }
    return Boolean(component.readOnly);
  }

  // Foreground/Background/Border each have a binding/formula pair
  // (textColorBinding/textColorFormula, etc. — see createComponent's own
  // comment, workbench-template-view.js) that overrides the literal hex
  // when non-empty, same fallback chain as isComponentVisible/
  // isComponentCollapsible/isComponentLocked above: formula first
  // (evaluateFormula against the live draft), then binding
  // (getBindingValue), else the plain stored color. Returns a shallow-
  // cloned component with textColor/backgroundColor/borderColor
  // overridden where a real resolved value exists — applyComponentStyles
  // itself stays completely unaware any of this exists, reading whatever
  // it's handed exactly as before (see component-styles.js). An
  // unresolvable/invalid result always falls back to the literal value,
  // never a JS-invented color.
  const COLOR_BINDING_KEYS = {
    textColor: { binding: "textColorBinding", formula: "textColorFormula" },
    foregroundColor: { binding: "foregroundColorBinding", formula: "foregroundColorFormula" },
    backgroundColor: { binding: "backgroundColorBinding", formula: "backgroundColorFormula" },
    borderColor: { binding: "borderColorBinding", formula: "borderColorFormula" },
  };

  // This file has its own separate template object (applyTemplateData
  // above), so it needs its own copy of workbench-template-view.js's
  // identical normalization. Font only, always a real value — Background/
  // Border are NOT per-component fallbacks (see TEMPLATE_DEFAULT_COLOR_KEYS'
  // own comment below): a component with its own field cleared should stay
  // genuinely transparent/borderless, not silently pick up whatever color
  // the template's sheet-wide Background/Border happen to be.
  function normalizeTemplateDefaults(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      fontColor: typeof source.fontColor === "string" && source.fontColor.trim() ? source.fontColor.trim() : "#ffffff",
    };
  }

  // Text only. There's always a text color to fall back to (some real
  // color has to render), which isn't true for Background/Border — "no
  // background"/"no border" are themselves legitimate, meaningful choices
  // a component can make (see color-picker.js's own --unset support), so
  // clearing one must actually mean "none," not "quietly inherit the
  // template's own sheet-wide setting." The template's own Background/
  // Border (state.template.backgroundColor/borderStyle/etc.) are a
  // completely separate, literal concept — the sheet's own visible
  // appearance, applied once to the canvas/sheet root, not resolved
  // per-component here at all.
  const TEMPLATE_DEFAULT_COLOR_KEYS = { textColor: "fontColor" };

  // The template's own sheet-wide Background/Border color — same
  // Formula-then-Binding-then-literal precedence resolveComponentColors
  // uses for a component's own colors, just read off state.template (and
  // resolved against the live draft, not sample data — this file has no
  // canvas-preview concept, only the real character record). `prop` is
  // "backgroundColor" or "borderColor".
  function resolveTemplateColor(prop) {
    const template = state.template || {};
    const formula = typeof template[`${prop}Formula`] === "string" ? template[`${prop}Formula`].trim() : "";
    if (formula) {
      try {
        const result = evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression });
        if (typeof result === "string" && result.trim()) return result.trim();
      } catch (error) {
        console.warn(`Character editor: unable to evaluate template ${prop} formula`, error);
      }
    }
    const binding = typeof template[`${prop}Binding`] === "string" ? template[`${prop}Binding`].trim() : "";
    if (binding) {
      const resolved = getBindingValue(binding);
      if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
    }
    return template[prop] || "";
  }

  function resolveComponentColors(component) {
    if (!component) return component;
    let overridden = null;
    Object.entries(COLOR_BINDING_KEYS).forEach(([colorProp, keys]) => {
      const formula = typeof component[keys.formula] === "string" ? component[keys.formula].trim() : "";
      if (formula) {
        try {
          const result = evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression });
          if (typeof result === "string" && result.trim()) {
            if (!overridden) overridden = { ...component };
            overridden[colorProp] = result.trim();
            return;
          }
        } catch (error) {
          console.warn(`Character editor: unable to evaluate ${colorProp} formula`, error);
        }
      }
      const binding = typeof component[keys.binding] === "string" ? component[keys.binding].trim() : "";
      if (binding) {
        const resolved = getBindingValue(binding);
        if (typeof resolved === "string" && resolved.trim()) {
          if (!overridden) overridden = { ...component };
          overridden[colorProp] = resolved.trim();
        }
      }
    });
    // Still blank after binding/formula? Fall back to the template's own
    // default — this is the ONLY fallback any color field should ever
    // reach now; no more hardcoded Bootstrap theme colors standing in for
    // "nobody chose anything."
    const templateDefaults = normalizeTemplateDefaults(state.template?.defaults);
    Object.entries(TEMPLATE_DEFAULT_COLOR_KEYS).forEach(([colorProp, defaultKey]) => {
      const current = (overridden || component)[colorProp];
      if (typeof current !== "string" || !current.trim()) {
        if (!overridden) overridden = { ...component };
        overridden[colorProp] = templateDefaults[defaultKey];
      }
    });
    return overridden || component;
  }

  // Same idea as isComponentVisible, but for a Repeater item-template node
  // — evaluated against the current item as the data context (consistent
  // with how an item node's own ordinary binding already resolves relative
  // to the item, not the top-level draft — see resolveRepeaterItemValue).
  function isRepeaterItemNodeVisible(node, item) {
    if (!node) return true;
    const formula = typeof node.visibilityFormula === "string" ? node.visibilityFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, item && typeof item === "object" ? item : {}, {}));
      } catch (error) {
        console.warn("Character editor: unable to evaluate item visibility formula", error);
        return true;
      }
    }
    const binding = typeof node.visibilityBinding === "string" ? node.visibilityBinding.trim() : "";
    if (binding) {
      return Boolean(resolveRepeaterItemValue(item, binding));
    }
    return true;
  }

  // Same idea as isRepeaterItemNodeVisible, but for whether a Repeater
  // item-template node's own field (e.g. an Inventory row's "Carried"
  // checkbox) stays live-adjustable in Play view — same formula/binding/
  // plain-boolean precedence as isComponentEditableInPlay below, just
  // evaluated against the current item instead of the top-level draft
  // (same item-relative scoping every other per-node condition here uses).
  function isRepeaterItemNodeEditableInPlay(node, item) {
    if (!node) return false;
    const formula = typeof node.editableInPlayFormula === "string" ? node.editableInPlayFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, item && typeof item === "object" ? item : {}, {}));
      } catch (error) {
        console.warn("Character editor: unable to evaluate item editable-in-play formula", error);
        return false;
      }
    }
    const binding = typeof node.editableInPlayBinding === "string" ? node.editableInPlayBinding.trim() : "";
    if (binding) {
      return Boolean(resolveRepeaterItemValue(item, binding));
    }
    return Boolean(node.editableInPlay);
  }

  // Same idea as resolveComponentColors, but for a Repeater item-template
  // node — evaluated against the current item as the data context (same
  // "relative to the item, not the top-level draft" distinction
  // isRepeaterItemNodeVisible makes above).
  function resolveRepeaterItemNodeColors(node, item) {
    if (!node) return node;
    let overridden = null;
    Object.entries(COLOR_BINDING_KEYS).forEach(([colorProp, keys]) => {
      const formula = typeof node[keys.formula] === "string" ? node[keys.formula].trim() : "";
      if (formula) {
        try {
          const result = evaluateFormulaWithLookup(formula, item && typeof item === "object" ? item : {}, {});
          if (typeof result === "string" && result.trim()) {
            if (!overridden) overridden = { ...node };
            overridden[colorProp] = result.trim();
            return;
          }
        } catch (error) {
          console.warn(`Character editor: unable to evaluate item ${colorProp} formula`, error);
        }
      }
      const binding = typeof node[keys.binding] === "string" ? node[keys.binding].trim() : "";
      if (binding) {
        const resolved = resolveRepeaterItemValue(item, binding);
        if (typeof resolved === "string" && resolved.trim()) {
          if (!overridden) overridden = { ...node };
          overridden[colorProp] = resolved.trim();
        }
      }
    });
    // Same template-default fallback as resolveComponentColors above — a
    // Repeater item's own row is still part of the same template.
    const templateDefaults = normalizeTemplateDefaults(state.template?.defaults);
    Object.entries(TEMPLATE_DEFAULT_COLOR_KEYS).forEach(([colorProp, defaultKey]) => {
      const current = (overridden || node)[colorProp];
      if (typeof current !== "string" || !current.trim()) {
        if (!overridden) overridden = { ...node };
        overridden[colorProp] = templateDefaults[defaultKey];
      }
    });
    return overridden || node;
  }

  // Same shape as isComponentLocked/isComponentCollapsible above — "Editable
  // in Play" in the Inspector, a genuine per-component authored setting
  // (plain boolean + Binding + Formula) for whether a component stays
  // live-adjustable in Play view instead of gated behind Edit mode like
  // everything else. HP/AC/Conditions/Initiative get adjusted mid-session,
  // not during sheet editing, so an author opts those in explicitly —
  // replacing the old isCombatBindingComponent mechanism, which inferred
  // Play-editability from whether a component's binding happened to match
  // one of the active System's own Role-tagged combatBindings paths: a
  // hardcoded, System-shape-dependent guess rather than something an
  // author actually chose on the component itself. See
  // feedback_play_mode_never_editable_by_default.
  function isComponentEditableInPlay(component) {
    if (!component) return false;
    const formula = typeof component.editableInPlayFormula === "string" ? component.editableInPlayFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, state.draft || {}, { rollDice: rollDiceExpression }));
      } catch (error) {
        console.warn("Character editor: unable to evaluate editable-in-play formula", error);
        return false;
      }
    }
    const binding = typeof component.editableInPlayBinding === "string" ? component.editableInPlayBinding.trim() : "";
    if (binding) {
      return Boolean(getBindingValue(binding));
    }
    return Boolean(component.editableInPlay);
  }

  function isEditable(component) {
    if (!component) {
      return false;
    }
    if (componentHasFormula(component)) {
      return false;
    }
    if (isComponentLocked(component)) {
      return false;
    }
    if (state.mode === "edit") {
      return true;
    }
    return isComponentEditableInPlay(component);
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
        const dataContext = state.draft || {};
        const result = evaluateFormulaWithLookup(component.formula, dataContext, {
          onRoll: (notation) => {
            if (typeof notation === "string") {
              const trimmedNotation = notation.trim();
              if (trimmedNotation) {
                collected.add(trimmedNotation);
              }
            }
          },
          rollContext: dataContext,
          rollDice: rollDiceExpression,
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

  // A leading blank option makes sense for a single-select dropdown (an
  // explicit "nothing chosen" state) but not for a multi-select toggle
  // group — there's no such thing as a blank "pill," and clicking one
  // would be a meaningless no-op. `allowBlank` lets multi-select callers
  // (renderSelectGroupComponent with multiple: true) opt out.
  function resolveSelectionOptions(component, { allowBlank = true, itemContext = null } = {}) {
    const expectsSource = Boolean(component?.sourceBinding);
    const addBlank = expectsSource && allowBlank;
    // Item-relative first — confirmed real, pre-existing gap: a Source-
    // bound Checkbox/Radio/Select dropped inside a Repeater's own item
    // template (or, now, a Source-driven Tab) never had its own Source
    // resolved relative to that item at all, always falling straight to
    // the global System-field lookup below even when sourceBinding was
    // meant as "look this up on the item itself" (e.g. a Tab's own
    // `sourceBinding: "@value"` — the tab's own bare abilities array, per
    // resolveRepeaterItemValue's own "@value" fix). resolveRepeaterItemValue
    // returns `undefined` for anything it can't resolve against the item,
    // which correctly falls through to the unchanged global path below —
    // this is purely additive, not a behavior change for any Source field
    // with no itemContext at all.
    const itemValues = itemContext ? resolveRepeaterItemValue(itemContext.item, component?.sourceBinding) : undefined;
    // Prefer resolving straight against the System's own field definition
    // (resolveSystemFieldValues, below — the same direct lookup Toggle's
    // own Source has always used) over the generic, lossy
    // resolveSourceBindingValue/systemPreviewData path — see that
    // function's own comment for the confirmed bug this fixes (a Source
    // option's own `description` silently discarded upstream, even though
    // normalizeOptionEntries already knows how to carry it through once it
    // actually receives it). Falls back to the old path only when the
    // binding isn't a plain top-level System field key resolveSystemFieldValues
    // can handle (or systemDefinition isn't loaded yet) — unchanged
    // behavior for anything that isn't a straightforward Source binding.
    const resolvedValues =
      itemValues !== undefined
        ? itemValues
        : resolveSystemFieldValues(component?.sourceBinding) ?? resolveSourceBindingValue(component?.sourceBinding);
    const boundOptions = normalizeOptionEntries(resolvedValues);
    if (boundOptions.length || expectsSource) {
      return addBlank ? ensureLeadingBlankOption(boundOptions) : boundOptions;
    }
    const componentOptions = normalizeOptionEntries(component?.options);
    if (componentOptions.length) {
      return addBlank ? ensureLeadingBlankOption(componentOptions) : componentOptions;
    }
    return addBlank ? ensureLeadingBlankOption([]) : [];
  }

  // A Source binding means specifically "a choices list from the System
  // record" (Binding/Text vs Source vocabulary — code-conventions.md), so
  // this resolves DIRECTLY against the System's own field schema
  // (state.systemDefinition.fields), not through the generic
  // resolveSourceBindingValue/systemPreviewData machinery every plain
  // Binding field uses. That machinery is for INSTANCE-data preview
  // purposes and is lossy for anything richer than a bare display name:
  // buildSystemPreviewData (workbench/js/lib/component-data.js) reduces
  // an array-of-choices field down to just each entry's own .name before
  // this code ever runs — confirmed two real bugs from that, not just
  // Toggle's own original one (a plain @proficiencies binding always
  // resolving against that stripped copy meant toggleStateEntryFromRaw
  // never had a real sourceId to find): a Checkbox/Radio group's own
  // Source options (Blades in the Dark's Trauma/Armor/Load/Special
  // Abilities) silently lost each option's own `description` the exact
  // same way, even after normalizeOptionEntries (component-data.js) was
  // taught to carry it through — the field it was reading from had
  // already thrown it away upstream. Used by resolveSelectionOptions
  // below now too, not just Toggle's own resolveToggleStates. Only a
  // plain, single-segment field key is supported (e.g.
  // "specialAbilitiesCutter", not "abilities.strength") — no Source
  // binding in this suite has ever needed anything nested.
  function resolveSystemFieldValues(sourceBinding) {
    const trimmed = typeof sourceBinding === "string" ? sourceBinding.trim() : "";
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

  // Deliberately NOT normalizeOptionEntries — that shared helper collapses
  // every entry to a bare {value: <derived string>, label} without ever
  // checking `sourceId`, which discards a Source entry's own canonical
  // identity (see toggleStateEntryFromRaw's own comment, component-renderers.js).
  function resolveToggleStates(component) {
    let rawList = resolveSystemFieldValues(component?.statesBinding);
    if (!rawList) {
      const raw = resolveSourceBindingValue(component?.statesBinding);
      rawList = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : null;
    }
    if (rawList && rawList.length) {
      const entries = rawList.map(toggleStateEntryFromRaw).filter(Boolean);
      if (entries.length) return entries;
    }
    if (Array.isArray(component?.states) && component.states.length) {
      return component.states
        .filter((state) => state != null)
        .map((state) => ({ value: state, label: String(state) }));
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

  // A plain-path read against the full draft record — same job as
  // resolveBinding() from the shared bindings.js, just without formula
  // evaluation (formulas are handled separately in resolveComponentValue,
  // above). Delegates to the shared implementation instead of re-walking
  // the path locally.
  function getBindingValue(binding) {
    const normalizedBinding = normalizeBinding(binding);
    if (!normalizedBinding || typeof normalizedBinding !== "string" || !normalizedBinding.trim().startsWith("@")) {
      return undefined;
    }
    return resolveBinding(normalizedBinding, state.draft || {});
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
    // Assigned Systems (systemIds — the same array every other Library kind
    // uses for its own "Assigned Systems" checkboxes in Loom) replaces the
    // old singular `system` field; a character can have more than one
    // System assigned, but a freshly created one starts with just the
    // Template's own schema, same single value the legacy field used to
    // carry — just in array form now.
    const initialSchema = state.template?.schema || templateMetadata?.schema || "";
    const draft = {
      id: trimmedId,
      title: trimmedName,
      template: trimmedTemplate,
      systemIds: initialSchema ? [initialSchema] : [],
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
    const label = state.draft.name || metadata.title || id;
    if (!confirmDelete({ label })) {
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

  // Driven by the outer Play/Edit view-tab switcher (see workbench.js) as
  // well as the (now-vestigial, only present if the old markup is reused
  // somewhere) in-page toggle button above.
  async function setMode(nextMode) {
    if (state.viewLocked) return;
    if (nextMode !== "view" && nextMode !== "edit") return;
    if (state.mode === nextMode) return;
    if (state.mode === "edit" && state.draft?.id) {
      await persistDraft({ silent: true });
      renderPreview();
    }
    state.mode = nextMode;
    syncModeIndicator();
    renderCanvas();
    syncCharacterActions();
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

  // Picking a different campaign from the header's Campaign dropdown while
  // Workbench is already open (not just landing here fresh after switching
  // it elsewhere) should immediately follow it — same fallback
  // syncGameLogContext already applies when there's no character-derived
  // campaign to use.
  window.addEventListener("workbench:active-group-changed", () => {
    void syncGameLogContext({ force: true });
  });

  return {
    applyUndoEntry: handleUndoEntry,
    applyRedoEntry: handleRedoEntry,
    hasUnsavedChanges: hasUnsavedCharacterChanges,
    markClean: markCharacterClean,
    setMode,
    reloadTemplateIfActive,
    // Lets workbench.js's setWorkbenchView re-check toolbar-button
    // visibility (Delete Character) on every tab click, not just the
    // edit/play ones setMode itself already covers — see
    // syncCharacterActions' own showDelete comment for the gap this closes.
    refreshToolbar: syncCharacterActions,
  };
}
