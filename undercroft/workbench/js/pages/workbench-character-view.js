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
import { rollExpression, resolveQuickDice, parseQuickDiceCounts, incrementDieInExpression, extractSystemRolls, rollSystemMove, extractSystemSymbolDice, rollSymbolPoolExpression } from "../../../common/js/lib/widgets/dice-roll.js";
import { formatSymbolPoolResult } from "../lib/symbol-dice.js";
import { preloadDiceOverlay } from "../../../common/js/lib/widgets/dice-overlay.js";
import { setElementVisible } from "../../../common/js/lib/dom.js";
import {
  normalizeOptionEntries,
  resolveTabEntries,
  resolveBindingFromContexts,
  buildSystemPreviewData,
} from "../lib/component-data.js";
import { initGameLogWidget, SPOTLIGHT_KIND_LABELS, SPOTLIGHT_KIND_ICONS, SPOTLIGHT_INLINE_KINDS } from "../../../common/js/lib/widgets/game-log.js";
import { renderRelationshipEditor } from "../../../common/js/lib/relationship-editor.js";
import { buildRelationshipGraph } from "../../../common/js/lib/relationship-graph.js";
import { createForceGraph } from "../../../common/js/lib/graph-view.js";
import { createSpotlightPanel } from "../../../common/js/lib/widgets/spotlight-panel.js";
import { watchActiveSpotlights } from "../../../common/js/lib/spotlight-inbox.js";
import { createSpotlightTitleCache, resolveActiveSpotlightId } from "../../../common/js/lib/spotlight.js";
import {
  reimportViaMapping,
  mergeImportedCharacterData,
  listCharacterMappings,
  loadMappingDefinition,
  SOURCES,
} from "../../../common/js/lib/content-fetch.js";
import { showConfirmModal } from "../../../common/js/lib/confirm-modal.js";
import { watchGroupForChanges, persistGroupPropertyValue } from "../../../common/js/lib/group-live-sync.js";
import { collectSystemFields } from "../../../common/js/lib/system-schema.js";

// Relocated from the old standalone character.html/character.js — now the
// Character mode of Workbench's unified page (see js/pages/workbench.js),
// which owns the single initAppShell call (status/undoStack), DataManager,
// auth, and help system. The View/Edit distinction is still state.mode
// ("view"/"edit") exactly as before, just now driven by the outer suite-wide
// View toggle (createCycleToggleButton) via the returned setMode() instead
// of an in-page toggle-mode button.
export async function initCharacterView({ status, undoStack, dataManager, onStateChange }) {
  // This page's own Dice tool pane (see the quick-dice wiring below) can
  // roll at any time once it's open — warm up the 3D overlay (and the
  // user's chosen theme) now instead of on the first roll click.
  preloadDiceOverlay(dataManager);

  const templateCatalog = new Map();
  const characterCatalog = new Map();
  // Accessible campaigns (owned + member, same scope the header's own
  // active-campaign selector and syncGameLogContext already use) — offered
  // in the character picker's own "Campaigns" optgroup (see
  // syncCharacterOptions) for Party Data mode (loadGroupPartyView).
  const groupCatalog = new Map();
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
    // {} rather than null when nothing's loaded (Party Data mode — see
    // loadGroupPartyView — leaves this at {} too, never a real character) —
    // standardizing on one "empty" sentinel avoids the one place `null` vs
    // `{}` actually changed behavior (characterAllowsEdits).
    draft: {},
    characterOrigin: null,
    systemDefinition: null,
    systemPreviewData: {},
    viewLocked: false,
    shareToken: "",
    // The active campaign's own Group Properties (party inventory, etc.) —
    // { groupId, isOwner, schema, values } — merged into the binding
    // context under a "group" key (see getBindingContext) so a template
    // field bound to e.g. "group.partyInventory" resolves exactly like an
    // ordinary "@inventory" binding does. null whenever no campaign is
    // active, same as gameLogContext's own "none" case. Never written into
    // `draft` itself — that's what gets persisted as the Character's own
    // saved JSON, and group data has no business being part of it.
    groupContext: null,
    // True only when loadGroupPartyView explicitly set up this session — NOT
    // the same thing as "groupContext is populated", which happens ambiently
    // for ANY active campaign (e.g. right after page load, purely so Game
    // Log/Now Showing can follow it) whether or not the user ever asked to
    // see that campaign's own Party Data. Anything that means "are we
    // showing Party Data right now" (the canvas placeholder copy, the
    // character picker's own selected value, the Notes storage key) has to
    // check this, not groupContext, or it flashes/restores Party Data state
    // no one actually chose this session.
    partyMode: false,
  };

  let lastSavedCharacterSignature = null;

  const componentRollDirectives = new Map();
  const collapsedComponents = new Map();
  const diceQuickButtons = new Map();
  // Section 5's quick-dice source for this page's Dice pane — the active
  // campaign Group's own System wins over this character's own Assigned
  // Systems (Section 2), else the standard 7. Starts at the standard-7
  // default so the panel has buttons immediately; refreshDiceAndMoveButtons()
  // (called at the end of updateSystemContext, once group/System context is
  // actually known) resolves the real answer and rebuilds them.
  let activeQuickDice = resolveQuickDice({});
  const moveButtons = new Map();
  // Section 1.3/4's named Rolls/Moves for this page's Dice pane — same
  // active-System resolution as activeQuickDice above (both come from the
  // same resolved systemDefinition, see refreshDiceAndMoveButtons), empty
  // until that resolves. A System with no "rolls" array field at all (most
  // Systems, still, even after this phase) just never shows this row.
  let activeSystemRolls = [];
  // Section 1.4/3.4's Tier-3 symbol dice (Phase 5) — mutually exclusive with
  // the standard quick-dice/expression/Moves UI above: a System that deals
  // in narrative dice pools (Genesys) has no numeric expression worth typing
  // at all, so its presence swaps the whole panel over to the stepper below
  // rather than just adding to it. Same "starts empty, resolved alongside
  // activeQuickDice/activeSystemRolls in refreshDiceAndMoveButtons" pattern.
  let activeSymbolDice = [];
  const symbolPoolCounts = new Map();
  // Which tab is showing per Tabs-type Container, keyed by component.uid —
  // components are re-hydrated (deep-cloned) on every data change, so this
  // has to live outside the component object itself to survive re-renders.
  const containerActiveTabs = new Map();

  // Lightweight replacement for what used to be a much richer gameLogState —
  // the actual render/poll state now lives entirely inside the shared widget
  // instances mounted below (gameLogWidget; nowShowingWatcher/
  // nowShowingPanel), which are the Dashboard's own Game Log widget and
  // spotlight panel, reused here rather than reimplemented (see this file's
  // own setGameLogContext/clearGameLogContext for the (re)mount logic). This
  // is just "which campaign, if any, is currently in view" — the one thing
  // both need, resolved in exactly one place.
  const gameLogContext = {
    groupId: "",
    groupName: "",
    shareToken: "",
    systemId: "",
    access: "none",
    members: [],
    ownerId: null,
  };
  // initGameLogWidget's own {refresh,destroy} instance — neither widget has
  // an "update groupId" method, so a campaign change destroys and recreates
  // it rather than mutating it in place.
  let gameLogWidget = null;
  // watchGroupForChanges' own {refresh,stop,noteLocalWrite} instance driving
  // state.groupContext's live data — same (re)creation reasoning as
  // gameLogWidget, remounted alongside it in setGameLogContext/
  // clearGameLogContext whenever the active campaign actually changes.
  let groupWatcher = null;
  // watchActiveSpotlights' own {refresh,destroy} instance driving the Now
  // Showing panel's data; same (re)creation reasoning as gameLogWidget.
  let nowShowingWatcher = null;
  // Built once `elements.nowShowingContent` exists (a few lines below) —
  // createSpotlightPanel needs a real container to mount into.
  let nowShowingPanel = null;
  let lastActiveNowShowingEntries = [];
  let knownNowShowingKeys = new Set();
  // The exact same fetch-once-cache-then-rerender title lookup dashboard.js's
  // own spotlight panel/Game Log share — see spotlight.js's own
  // createSpotlightTitleCache.
  const spotlightTitleCache = createSpotlightTitleCache(dataManager, () => gameLogContext.shareToken);

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
  // Generic, context-agnostic versions of what used to be hard-rooted
  // directly against state.draft — getValueAtPath/setValueAtPath below are
  // now thin wrappers around these for the (still default, still by far the
  // most common) Character case; group.* bindings (see getBindingContext/
  // updateGroupBinding) read/write against state.groupContext.values
  // through these exact same two functions instead, so there's one
  // implementation of "walk/write a dotted path into a plain object," not
  // two.
  function getValueAtContext(context, pathSegments) {
    if (!Array.isArray(pathSegments) || !pathSegments.length) {
      return undefined;
    }
    let cursor = context;
    for (const segment of pathSegments) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
        return undefined;
      }
      cursor = cursor[segment];
    }
    return cursor;
  }

  function setValueAtContext(context, pathSegments, value) {
    if (!Array.isArray(pathSegments) || !pathSegments.length || !context) {
      return false;
    }
    let cursor = context;
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

  function getValueAtPath(pathSegments) {
    return getValueAtContext(state.draft, pathSegments);
  }

  function setValueAtPath(pathSegments, value) {
    if (!state.draft) {
      return false;
    }
    return setValueAtContext(state.draft, pathSegments, value);
  }

  // Merges the active campaign's own Group Properties into the SAME
  // context a plain "@inventory"-style binding already resolves against,
  // under a "group" key — so "@group.partyInventory.quantity" walks through
  // the exact same resolveBinding/getValueAtPath machinery as any other
  // field, no new binding vocabulary needed. A derived, read-only view,
  // rebuilt on demand — never written into `state.draft` itself, which is
  // exactly what gets persisted as the Character's own saved JSON (group
  // data has no business ending up inside it). The shallow spread is cheap
  // (a character record's own top-level key count is small — this is not a
  // deep clone of the whole record).
  function getBindingContext() {
    return { ...state.draft, group: state.groupContext?.values || {} };
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
  mountField("new-character-name", createCompactField({ type: "text", id: "new-character-name", label: "Character Name", dataAttr: "data-new-character-name", name: "name", required: true, placeholder: "e.g. Elandra" }));
  mountField(
    "new-character-template",
    createCompactField({ type: "select", id: "new-character-template", label: "Template", controlClass: "form-select", dataAttr: "data-new-character-template", name: "template", required: true })
  );
  mountField(
    "import-character-mapping",
    createCompactField({ type: "select", id: "import-character-mapping", label: "Import Mapping", controlClass: "form-select", dataAttr: "data-import-character-mapping", name: "mapping", required: true })
  );
  mountField("import-character-name", createCompactField({ type: "text", id: "import-character-name", label: "Character Name", dataAttr: "data-import-character-name", name: "name", required: true, placeholder: "e.g. Elandra" }));
  mountField(
    "import-character-template",
    createCompactField({ type: "select", id: "import-character-template", label: "Template", controlClass: "form-select", dataAttr: "data-import-character-template", name: "template", required: true })
  );

  const elements = {
    characterSelect: document.querySelector("[data-character-select]"),
    canvasRoot: document.querySelector("[data-character-canvas-root]"),
    undoButton: document.querySelector('[data-action="undo-character"]'),
    redoButton: document.querySelector('[data-action="redo-character"]'),
    newCharacterButton: document.querySelector('[data-action="new-character"]'),
    duplicateCharacterButton: document.querySelector('[data-action="duplicate-character"]'),
    addCharacterModeBlank: document.querySelector('[data-add-character-mode="blank"]'),
    addCharacterModeImport: document.querySelector('[data-add-character-mode="import"]'),
    addCharacterSubmitBlank: document.querySelector('[data-add-character-submit="blank"]'),
    addCharacterSubmitImport: document.querySelector('[data-add-character-submit="import"]'),
    importCharacterForm: document.querySelector("[data-import-character-form]"),
    importCharacterStage1: document.querySelector("[data-import-stage-1]"),
    importCharacterStage2: document.querySelector("[data-import-stage-2]"),
    importCharacterMapping: document.querySelector("[data-import-character-mapping]"),
    importCharacterValue: document.querySelector("[data-import-character-value]"),
    importCharacterValueLabel: document.querySelector("[data-import-character-value-label]"),
    importCharacterFetchButton: document.querySelector("[data-import-character-fetch]"),
    importCharacterStatus: document.querySelector("[data-import-character-status]"),
    importCharacterName: document.querySelector("[data-import-character-name]"),
    importCharacterTemplate: document.querySelector("[data-import-character-template]"),
    importCharacterSubmit: document.querySelector("[data-import-character-submit]"),
    saveButton: document.querySelector('[data-action="save-character"]'),
    deleteCharacterButton: document.querySelector('[data-delete-character]'),
    reimportCharacterButton: document.querySelector('[data-reimport-character]'),
    notesSection: document.querySelector("[data-notes-section]"),
    noteEditor: document.querySelector("[data-note-editor]"),
    notesPanel: document.querySelector("[data-notes-panel]"),
    relationshipsMount: document.querySelector("[data-relationships-mount]"),
    relationshipsPanel: document.querySelector("[data-relationships-panel]"),
    relationshipsListMount: document.querySelector("[data-relationships-list-mount]"),
    relationshipsGraphWrap: document.querySelector("[data-relationships-graph-wrap]"),
    relationshipsGraphContainer: document.querySelector("[data-relationships-graph-container]"),
    relationshipsGraphContent: document.querySelector("[data-relationships-graph-content]"),
    relationshipsGraphSvg: document.querySelector("[data-relationships-graph-svg]"),
    relationshipsGraphControls: document.querySelector("[data-relationships-graph-controls]"),
    relationshipsGraphToolbarMount: document.querySelector("[data-relationships-graph-toolbar-mount]"),
    relationshipsGraphEmpty: document.querySelector("[data-relationships-graph-empty]"),
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
    newCharacterName: document.querySelector("[data-new-character-name]"),
    newCharacterTemplate: document.querySelector("[data-new-character-template]"),
    // The mode-gate ([data-workbench-mode-panel="character"]) lives on the
    // OUTER section (workbench.js's own applyPanelVisibility, a `.d-none`
    // class toggle) — this INNER wrapper is what renderGroupSharePanel
    // itself shows/hides for relevance, deliberately a separate element so
    // the two independent toggles (which mode is active vs. is there
    // anything to claim right now) never fight over the same node.
    groupShareRelevant: document.querySelector("[data-group-share-relevant]"),
    groupSharePanel: document.querySelector("[data-group-share-panel]"),
    groupShareStatus: document.querySelector("[data-group-share-status]"),
    gameLogSection: document.querySelector("[data-game-log-section]"),
    gameLogPanel: document.querySelector("[data-game-log-panel]"),
    gameLogRefresh: document.querySelector("[data-game-log-refresh]"),
    gameLogTitle: document.querySelector("[data-game-log-group]"),
    nowShowingSection: document.querySelector("[data-now-showing-section]"),
    nowShowingPanel: document.querySelector("[data-now-showing-panel]"),
    nowShowingContent: document.querySelector("[data-now-showing-content]"),
  };

  // Mounted inline (floating: false) into this page's own layout, unlike
  // the Dashboard's identical floating corner overlay — see
  // spotlight-panel.js's own createSpotlightPanel.
  nowShowingPanel = createSpotlightPanel({ container: elements.nowShowingContent, floating: false });

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
  if (elements.relationshipsMount && elements.relationshipsPanel) {
    const relationshipsSection = createCollapsibleSection({
      label: "Relationships",
      helpTopic: "character.relationships",
      collapsed: true,
      content: elements.relationshipsPanel,
    });
    elements.relationshipsMount.appendChild(relationshipsSection.section);
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
    // Establishes the initial hidden state right away — every OTHER call to
    // renderGroupSharePanel() is reactive (fires from the pending-share-
    // token flow, a claim/refresh, etc.), so without this the common case
    // (no share token at all — most characters are just opened directly)
    // never calls it even once, leaving the section in its static-HTML
    // default (visible) indefinitely.
    renderGroupSharePanel();
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
    onExport: () => {
      if (!state.draft) {
        status.show("Nothing to export yet.", { type: "info", timeout: 2000 });
        return;
      }
      exportDraft();
    },
  });
  document.querySelector("[data-character-json-mount]")?.appendChild(characterJsonPanel.section);
  const renderPreview = characterJsonPanel.render;

  setNotesCollapsed(true);
  setGroupShareCollapsed(groupShareState.collapsed);
  setDiceCollapsed(false);
  setNowShowingCollapsed(false);
  setGameLogCollapsed(false);

  // Single modal shared by both the "blank" and "import" ways to add a
  // character — a mode toggle inside it swaps which form/footer-button is
  // shown (see setAddCharacterMode). This used to be two separate toolbar
  // buttons/modals, but that pushed the toolbar past the six-button limit
  // (undercroft/README.md's UI & Style Conventions section, "Button count"
  // rule) the moment Import Character was added, so Import folded into the
  // existing New Character entry point
  // instead of getting its own toolbar slot.
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
  void refreshGroupsForPicker();
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
        if (!selectedId) return;
        // "group:<id>" values are this picker's own Campaigns optgroup (see
        // syncCharacterOptions) — Party Data mode, no character involved.
        if (selectedId.startsWith("group:")) {
          const option = elements.characterSelect.selectedOptions?.[0];
          await loadGroupPartyView(selectedId.slice(6), option?.dataset.groupName || "");
          return;
        }
        await loadCharacter(selectedId);
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

    if (elements.newCharacterButton) {
      elements.newCharacterButton.addEventListener("click", () => {
        openNewCharacterDialog();
      });
    }

    if (elements.duplicateCharacterButton) {
      elements.duplicateCharacterButton.addEventListener("click", () => {
        void duplicateCharacter();
      });
    }

    if (elements.addCharacterModeBlank) {
      elements.addCharacterModeBlank.addEventListener("click", () => {
        setAddCharacterMode("blank");
      });
    }

    if (elements.addCharacterModeImport) {
      elements.addCharacterModeImport.addEventListener("click", () => {
        setAddCharacterMode("import");
      });
    }

    if (elements.importCharacterMapping) {
      elements.importCharacterMapping.addEventListener("change", () => {
        void applyImportValuePlaceholder();
      });
    }

    if (elements.importCharacterFetchButton) {
      elements.importCharacterFetchButton.addEventListener("click", () => {
        void handleImportFetch();
      });
    }

    if (elements.importCharacterTemplate) {
      elements.importCharacterTemplate.addEventListener("change", () => {
        if (elements.importCharacterSubmit) {
          elements.importCharacterSubmit.disabled = !elements.importCharacterTemplate.value;
        }
      });
    }

    if (elements.importCharacterForm) {
      elements.importCharacterForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await createImportedCharacterFromForm();
      });
    }

    if (elements.deleteCharacterButton) {
      elements.deleteCharacterButton.addEventListener("click", () => {
        void deleteCurrentCharacter();
      });
    }

    if (elements.reimportCharacterButton) {
      elements.reimportCharacterButton.addEventListener("click", () => {
        void reimportCurrentCharacter();
      });
    }

    if (elements.saveButton) {
      elements.saveButton.addEventListener("click", async () => {
        await persistDraft({ silent: false });
        syncCharacterActions();
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

  // Independent of updateNowShowingVisibility (further below) — that toggles the
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
      void refreshDiceAndMoveButtons();
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
    void refreshDiceAndMoveButtons();
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
    // Campaigns (Party Data mode, loadGroupPartyView) — a separate optgroup,
    // "group:<id>" values so they can never collide with a real character
    // id in this same select's value space. groupName is stashed on the
    // option itself (not re-derived from groupCatalog) so the change
    // handler has it on hand without a second lookup.
    const groupOptions = Array.from(groupCatalog.values())
      .filter((entry) => entry.id)
      .map((entry) => ({
        value: `group:${entry.id}`,
        label: `${entry.name} (Party Data)`,
        sortLabel: entry.name.toLowerCase(),
        group: "Campaigns",
        dataset: { groupName: entry.name },
      }))
      .sort((a, b) => a.sortLabel.localeCompare(b.sortLabel, undefined, { sensitivity: "base" }));
    populateSelect(
      elements.characterSelect,
      [...options.map(({ value, label }) => ({ value, label })), ...groupOptions],
      { placeholder: "Select character" }
    );
    // state.partyMode, not state.groupContext — groupContext is populated
    // ambiently for ANY active campaign (see its own comment on state),
    // whether or not the user ever asked to see that campaign's Party Data;
    // using it here would show a campaign "selected" on a fresh page load
    // that nobody actually picked.
    const value = state.draft?.id || (state.partyMode && state.groupContext ? `group:${state.groupContext.groupId}` : "");
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
    // Universal choke point — called after every load/New/Save/Delete/clear
    // — so this is also where workbench.js's own inline empty-state message
    // (Mode/View header) learns a character became active/inactive, without
    // a dedicated event for every call site.
    if (typeof onStateChange === "function") onStateChange();
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

    updateToolbarButton(characterJsonPanel.exportButton, {
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

    // Unlike Save, doesn't care about unsaved changes or edit permission on
    // the SOURCE record — duplicating writes a brand new record, it never
    // touches the one being copied. Just needs something to copy and write
    // access in general.
    updateToolbarButton(elements.duplicateCharacterButton, {
      disabled: !draftHasId || locked || !canWrite,
      disabledTitle: !draftHasId
        ? "Select a character first."
        : locked
        ? "Group characters must be claimed before duplicating."
        : "You don't have permission to create characters.",
    });

    // Only meaningful for a character that actually carries both
    // (loom/js/app.js's own saveEntity sets them when a mapping produced the
    // saved content — see mergeImportedCharacterData's own comment for why
    // a hand-authored or hand-edited character never has either). Gated on
    // character owner, campaign owner, or admin — deliberately wider than
    // canEditRecord alone, since a campaign owner (the GM of the currently
    // active campaign, gameLogContext.access === "owner") may not have an
    // explicit edit-share on a player's own character at all, but re-import
    // is exactly the kind of "keep the party's sheets current" action a GM
    // should be able to do without needing one. The server's own
    // is_owner()/is_shared(require_edit=True) check on the actual save
    // still has final say either way — this only decides whether the button
    // even shows.
    if (elements.reimportCharacterButton) {
      const isAdminForReimport = dataManager.getUserTier() === "admin";
      const hasReimportSource = Boolean(state.draft?.url) && Boolean(state.draft?.mapping);
      const hasReimportPermission =
        isAdminForReimport || (draftHasId && userOwnsCharacter(state.draft.id)) || gameLogContext.access === "owner";
      const showReimport =
        draftHasId &&
        hasReimportSource &&
        hasReimportPermission &&
        canWrite &&
        !locked &&
        state.mode === "edit" &&
        document.body.dataset.workbenchMode === "character";
      elements.reimportCharacterButton.classList.toggle("d-none", !showReimport);
      updateToolbarButton(elements.reimportCharacterButton, {
        disabled: !showReimport,
        enabledTitle: "Re-fetch this character from its original source.",
      });
    }

    if (!elements.deleteCharacterButton) {
      return;
    }
    // Delete Character now lives in the shared left-pane toolbar rather than
    // a standalone button with its own data-workbench-mode-panel tag — it
    // already has this classList.toggle("d-none", ...) below, and tagging it
    // for mode-switching too would just fight over the same class (the
    // generic panel-toggle in workbench.js's applyPanelVisibility always
    // runs LAST on a mode/view change, so it would win over whatever this
    // function decided about permissions the last time a character loaded).
    // Folding "only in Edit view" into THIS check instead — reading
    // document.body.dataset.workbenchMode directly, the same shared signal
    // updateNowShowingVisibility's own comment already established — is the
    // one owner. That still needs this function to actually re-run on every
    // mode/view switch, not just the ones setMode itself covers — confirmed
    // real gap: switching from Character/Edit to Template never called
    // setMode at all (only mode === "character" does), so this never re-ran,
    // and the button — visible from Edit — simply stayed visible. Fixed by
    // exporting this function so workbench.js's setMode can call it on
    // every mode switch, not just the character one (see its own comment).
    //
    // Delete is deliberately wider than canEditRecord: an admin can delete
    // any character regardless of ownership (server's is_owner() already
    // grants this), but only the actual owner gets to edit/save it — so this
    // doesn't fold the admin bypass into canEditRecord itself.
    const isAdmin = dataManager.getUserTier() === "admin";
    const canDeleteRecord = draftHasId && (isAdmin || canEditRecord);
    const showDelete =
      canDeleteRecord && canWrite && state.mode === "edit" && document.body.dataset.workbenchMode === "character";
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
    const counts = parseQuickDiceCounts(expression, activeQuickDice);
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


  // Routed through dice-roll.js's shared rollExpression (not rollDiceExpression
  // directly) so this page's own roll buttons — the Dice tool pane AND every
  // ability/save/attack/roller-formula button (createRollOverlayButton →
  // handleComponentRoll → here) — get the 3D overlay for eligible plain
  // expressions, matching every other roll-and-report call site in the
  // suite. This was the confirmed Phase-2 gap: `preloadDiceOverlay` was
  // already called on this page, but nothing on it ever actually triggered
  // the overlay. `context` still threads through to rollDiceExpression's own
  // `@path` substitution for formula-driven buttons — see rollExpression's
  // own comment for why that's safe with the overlay path.
  async function executeDiceRoll(expression, { label = "", updateInput = true } = {}) {
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
    const rolled = await rollExpression(trimmed, {
      status,
      label,
      dataManager,
      dice: activeQuickDice,
      context: getBindingContext(),
    });
    if (!rolled || rolled.isTable) {
      return rolled;
    }
    recordGameLogRoll(rolled.result, { expression: trimmed, label });
    return rolled.result;
  }

  // Delegates straight to common/js/lib/spotlight.js's own
  // resolveActiveSpotlightId, kind-scoped to "encounter" — an encounter
  // spotlighted earlier is still active even if the GM later ALSO shows an
  // unrelated NPC/map card; only an encounter-kind spotlight/clear (or a
  // kind-agnostic global clear) actually changes whether combat is still
  // "on". Returns "" if nothing's currently spotlighted, the spotlighted
  // thing isn't an encounter, or there's no active campaign at all.
  async function resolveActiveEncounterId() {
    if (!gameLogContext.groupId && !gameLogContext.shareToken) {
      return "";
    }
    return resolveActiveSpotlightId(dataManager, {
      groupId: gameLogContext.groupId,
      shareToken: gameLogContext.shareToken,
      kind: "encounter",
    });
  }

  // Initiative is a one-way push, not a synced field (see the Initiative
  // component's own comment in the template) — a rolled result updates
  // whatever active encounter this character is currently in, not the
  // character record itself, since initiative isn't persistent state.
  async function pushInitiativeToActiveEncounter(value) {
    const encounterId = await resolveActiveEncounterId();
    if (!encounterId || !state.draft?.id) {
      return;
    }
    try {
      // preferLocal: false — this is a read-modify-write against the
      // encounter's real current state (other combatants may have changed
      // since this browser last touched it); a stale local copy here
      // wouldn't just display wrong, it would silently clobber those other
      // changes on save. Same bug, same fix, as combat-tracker.js's own
      // selectEncounter.
      const { payload: encounter } = await dataManager.get("encounter", encounterId, { preferLocal: false });
      const combatant = (encounter.combatants || []).find(
        (entry) => entry.refKind === "character" && entry.refId === state.draft.id
      );
      if (!combatant) {
        return;
      }
      combatant.initiative = value;
      const { id: _id, ...body } = encounter;
      await dataManager.save("encounter", encounterId, body);
      status.show(`Initiative ${value} sent to the encounter.`, { type: "success", timeout: 2000 });
    } catch (error) {
      console.warn("Character editor: unable to push initiative to the active encounter", error);
    }
  }

  async function handleComponentRoll(expression, label, component) {
    if (!expression) {
      return;
    }
    const text = typeof label === "string" && label.trim() ? label.trim() : "";
    const result = await executeDiceRoll(expression, { label: text, updateInput: true });
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
      void handleComponentRoll(expression, label, component);
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

    // Everything below except the symbol-pool section (built further down)
    // is the "standard" numeric-dice UI — grouped in its own container so
    // refreshDiceAndMoveButtons can hide the whole thing at once for a
    // System whose dice are all Tier-3 symbol dice (Section 1.4/3.4).
    const standardSection = document.createElement("div");
    standardSection.className = "d-flex flex-column gap-3";
    standardSection.setAttribute("data-dice-standard-section", "");
    form.appendChild(standardSection);

    const quickGrid = document.createElement("div");
    quickGrid.className = "dice-quick-grid";
    quickGrid.setAttribute("data-dice-quick", "");
    // Die buttons themselves are populated by renderDiceQuickButtons() below,
    // not here — they depend on activeQuickDice (Section 5's resolved
    // System dice), which isn't known yet the first time this markup is
    // built.
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "btn btn-outline-secondary btn-sm";
    clearButton.setAttribute("data-dice-clear", "");
    clearButton.textContent = "Clear";
    quickGrid.appendChild(clearButton);
    standardSection.appendChild(quickGrid);

    const inputId = "dice-expression";
    const label = document.createElement("label");
    label.className = "visually-hidden";
    label.setAttribute("for", inputId);
    label.textContent = "Dice expression";
    standardSection.appendChild(label);

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

    standardSection.appendChild(inputGroup);

    // Named Rolls/Moves (Section 1.3/4) — a curated button per System-
    // defined roll, in its OWN row below the expression input/Roll button,
    // not mixed in with the quick-dice grid above: a quick-dice button only
    // ever edits the expression string (nothing rolls until Roll is
    // clicked), while a Move button is a one-click roller in its own right —
    // visually grouping it with the input it has nothing to do with was
    // confusing. Populated by renderMoveButtons() below; hidden entirely
    // (not just empty) for the common case of a System with no "rolls"
    // field.
    const movesRow = document.createElement("div");
    movesRow.className = "dice-quick-grid";
    movesRow.setAttribute("data-dice-moves", "");
    standardSection.appendChild(movesRow);

    // Tier-3 symbol-dice pool (Section 1.4/3.4/6.3, Phase 5) — a +/- stepper
    // per symbol die instead of a text expression, since there's no
    // sensible way to type "assemble this ad hoc pool" as a formula string.
    // Hidden entirely (not just empty) unless the active System declares
    // any symbol dice; populated/toggled by refreshDiceAndMoveButtons and
    // renderSymbolPool below, not here — activeSymbolDice isn't known yet
    // the first time this markup is built.
    const symbolSection = document.createElement("div");
    symbolSection.className = "d-flex flex-column gap-2";
    symbolSection.setAttribute("data-dice-symbol-section", "");
    // NOT `.hidden` — see setElementVisible's own comment (dom.js) for why
    // that silently does nothing on a `d-flex` element.
    setElementVisible(symbolSection, false);

    const symbolLabel = document.createElement("span");
    symbolLabel.className = "small text-body-secondary";
    symbolLabel.textContent = "Dice Pool";
    symbolSection.appendChild(symbolLabel);

    const symbolSteppers = document.createElement("div");
    symbolSteppers.className = "d-flex flex-column gap-2";
    symbolSteppers.setAttribute("data-dice-symbol-steppers", "");
    symbolSection.appendChild(symbolSteppers);

    const symbolRollButton = document.createElement("button");
    symbolRollButton.type = "button";
    symbolRollButton.className = "btn btn-primary";
    symbolRollButton.setAttribute("data-dice-symbol-roll", "");
    symbolRollButton.textContent = "Roll pool";
    symbolSection.appendChild(symbolRollButton);

    const symbolResult = document.createElement("div");
    symbolResult.className = "small text-body-secondary";
    symbolResult.setAttribute("data-dice-symbol-result", "");
    symbolSection.appendChild(symbolResult);

    form.appendChild(symbolSection);
    elements.dicePanel.appendChild(form);

    elements.diceForm = form;
    elements.diceExpression = input;
    elements.diceStandardSection = standardSection;
    elements.diceMovesRow = movesRow;
    elements.diceQuickGrid = quickGrid;
    elements.diceClearButton = form.querySelector("[data-dice-clear]");
    elements.diceSymbolSection = symbolSection;
    elements.diceSymbolSteppers = symbolSteppers;
    elements.diceSymbolResult = symbolResult;
    symbolRollButton.addEventListener("click", () => void executeSymbolPoolRoll());
    return true;
  }

  // (Re)builds the Moves button row from activeSystemRolls — same "static
  // chrome once, rebuild the buttons whenever the resolved data changes"
  // split renderDiceQuickButtons below already uses, since both come from
  // the same async System-resolution in refreshDiceAndMoveButtons.
  function renderMoveButtons() {
    if (!elements.diceMovesRow) {
      return;
    }
    moveButtons.forEach((button) => button.remove());
    moveButtons.clear();
    // NOT `.hidden` — `.dice-quick-grid`'s own `display: grid` (an author
    // rule, no `!important` even needed) always beats the `[hidden]`
    // UA-stylesheet rule regardless of specificity, so it silently never
    // actually collapsed. See dom.js's own setElementVisible.
    setElementVisible(elements.diceMovesRow, activeSystemRolls.length > 0, "grid");
    activeSystemRolls.forEach((move, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-primary btn-sm";
      button.textContent = move.label;
      button.setAttribute("aria-label", `Roll ${move.label}`);
      if (move.expression) {
        button.title = move.expression;
      }
      button.addEventListener("click", () => void executeSystemMove(move));
      moveButtons.set(index, button);
      elements.diceMovesRow.appendChild(button);
    });
  }

  // Rolls a System-defined Move (Section 1.3/4) and posts it to the Game
  // Log exactly like executeDiceRoll's own plain rolls do — recordGameLogRoll
  // gains an optional `verdict` string here (see game-log.js's own
  // describeEntry) so anyone else watching the log sees "Partial Success",
  // not just the raw total.
  async function executeSystemMove(move) {
    openToolsPane();
    const rolled = await rollSystemMove(move, {
      status,
      dataManager,
      dice: activeQuickDice,
      context: getBindingContext(),
    });
    if (!rolled || rolled.isTable) {
      return;
    }
    recordGameLogRoll(rolled.result, {
      expression: move.expression,
      label: move.label,
      verdict: rolled.verdict?.label || undefined,
    });
  }

  // (Re)builds the quick-dice buttons from activeQuickDice — called once by
  // initDiceRoller on first mount, and again by refreshDiceAndMoveButtons
  // whenever the resolved active System's dice change (Section 5), since
  // group/System context resolves asynchronously, after the panel's own
  // static chrome (ensureDicePanelMarkup) is already built.
  function renderDiceQuickButtons() {
    if (!elements.diceQuickGrid) {
      return;
    }
    diceQuickButtons.forEach((button) => button.remove());
    diceQuickButtons.clear();
    activeQuickDice.forEach((die) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-secondary btn-sm";
      button.setAttribute("data-dice-button", die.id);
      const label = die.label || die.id;
      button.textContent = label;
      button.dataset.label = label;
      button.setAttribute("aria-label", `Add ${label}`);
      button.addEventListener("click", () => {
        const next = incrementDieInExpression(die.id, elements.diceExpression.value || "");
        elements.diceExpression.value = next;
        try {
          elements.diceExpression.focus({ preventScroll: true });
        } catch (focusError) {
          elements.diceExpression.focus();
        }
        syncQuickDiceButtons();
      });
      diceQuickButtons.set(die.id, button);
      elements.diceQuickGrid.insertBefore(button, elements.diceClearButton);
    });
    syncQuickDiceButtons();
  }

  // (Re)builds the symbol-pool steppers from activeSymbolDice — same
  // "static chrome once, rebuild the controls whenever the resolved data
  // changes" split renderDiceQuickButtons already uses. Counts persist
  // across re-renders/rolls (not reset to 0) so a pool stays "loaded"
  // between rolls the way a physical dice pool would (e.g. rerolling after
  // spending a Destiny Point) — only navigating away and back, or the
  // active System itself changing, clears symbolPoolCounts.
  function renderSymbolPool() {
    if (!elements.diceSymbolSteppers) {
      return;
    }
    elements.diceSymbolSteppers.innerHTML = "";
    activeSymbolDice.forEach((die) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2";

      const label = document.createElement("span");
      label.className = "small flex-grow-1";
      label.textContent = die.label;
      row.appendChild(label);

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "btn btn-outline-secondary btn-sm";
      minus.textContent = "−";
      minus.setAttribute("aria-label", `Remove one ${die.label}`);
      row.appendChild(minus);

      const countSpan = document.createElement("span");
      countSpan.className = "text-center";
      countSpan.style.minWidth = "1.5rem";
      countSpan.textContent = String(symbolPoolCounts.get(die.id) || 0);
      row.appendChild(countSpan);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "btn btn-outline-secondary btn-sm";
      plus.textContent = "+";
      plus.setAttribute("aria-label", `Add one ${die.label}`);
      row.appendChild(plus);

      minus.addEventListener("click", () => {
        const next = Math.max(0, (symbolPoolCounts.get(die.id) || 0) - 1);
        symbolPoolCounts.set(die.id, next);
        countSpan.textContent = String(next);
      });
      plus.addEventListener("click", () => {
        const next = (symbolPoolCounts.get(die.id) || 0) + 1;
        symbolPoolCounts.set(die.id, next);
        countSpan.textContent = String(next);
      });

      elements.diceSymbolSteppers.appendChild(row);
    });
  }

  // Rolls the current symbol-pool stepper counts (Section 1.4/3.4, Phase 5)
  // via the dedicated symbol-dice engine — never rollExpression/
  // rollDiceExpression, since a symbol pool has no numeric total to
  // compute. Posts to the Game Log via recordGameLogRoll's own `verdict`
  // slot (already rendered by game-log.js's describeEntry) carrying the
  // formatted symbol result, with no numeric total shown alongside it.
  async function executeSymbolPoolRoll() {
    openToolsPane();
    const diceById = new Map(activeSymbolDice.map((die) => [die.id.toLowerCase(), die]));
    const poolCounts = activeSymbolDice
      .map((die) => ({ dieId: die.id, count: symbolPoolCounts.get(die.id) || 0 }))
      .filter((entry) => entry.count > 0);
    if (!poolCounts.length) {
      status.show("Add at least one die to the pool first.", { type: "info", timeout: 2000 });
      return;
    }
    const rolled = await rollSymbolPoolExpression(poolCounts, { diceById, dataManager });
    const text = formatSymbolPoolResult(rolled.net);
    if (elements.diceSymbolResult) {
      elements.diceSymbolResult.textContent = text;
    }
    status.show(text, { type: "success", timeout: 2600 });
    recordGameLogRoll(
      { notation: poolCounts.map((entry) => `${entry.count} ${entry.dieId}`).join(" + ") },
      { label: "Symbol Pool", verdict: text }
    );
  }

  // Re-resolves activeQuickDice, activeSystemRolls, AND activeSymbolDice
  // (Section 2's group-then-character priority, shared by all three) and
  // rebuilds every row against the new answer — called from
  // updateSystemContext once the character's own System is known, and
  // needs its own group-context lookup since updateSystemContext only
  // resolves the character's own System, not the active campaign Group's.
  async function refreshDiceAndMoveButtons() {
    const groupSystemId = gameLogContext.systemId || "";
    const characterSystemId = Array.isArray(state.draft?.systemIds) ? state.draft.systemIds[0] : "";
    const resolvedSystemId = groupSystemId || characterSystemId || "";
    const systemDefinition = resolvedSystemId ? await fetchSystemDefinition(resolvedSystemId).catch(() => null) : null;
    activeQuickDice = resolveQuickDice({ systemDefinition });
    activeSystemRolls = extractSystemRolls(systemDefinition);
    activeSymbolDice = extractSystemSymbolDice(systemDefinition);
    renderDiceQuickButtons();
    renderMoveButtons();
    renderSymbolPool();
    // A System with any Tier-3 symbol dice replaces the numeric UI wholesale
    // (Section 1.4/3.4) — there's no meaningful hybrid, since a narrative
    // dice-pool System has no numeric expression worth typing at all.
    //
    // NOT `.hidden` — both sections carry `d-flex`, and Bootstrap's own
    // `.d-flex { display: flex !important; }` always beats the `[hidden]`
    // UA-stylesheet rule regardless of specificity, so the "hidden" side
    // never actually collapsed: Roll and Roll pool could both show at once
    // for a plain-numeric System (e.g. Daggerheart) that has zero symbol
    // dice. See dom.js's own setElementVisible for the real fix.
    const symbolMode = activeSymbolDice.length > 0;
    setElementVisible(elements.diceStandardSection, !symbolMode, "flex");
    setElementVisible(elements.diceSymbolSection, symbolMode, "flex");
  }

  function initDiceRoller() {
    if (!ensureDicePanelMarkup()) {
      return;
    }
    renderDiceQuickButtons();

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
        void executeDiceRoll(expression, { updateInput: false });
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

  // Populates groupCatalog for the character picker's own "Campaigns"
  // optgroup — includeMemberGroups: true is the same scope
  // syncGameLogContext's own dataManager.listGroups call already uses (owned
  // + campaigns you're merely a member of, via a character you own), and
  // dataManager's own request-level cache means this doesn't cost a second
  // real fetch when that call already ran this session.
  async function refreshGroupsForPicker() {
    if (!dataManager.isAuthenticated()) {
      groupCatalog.clear();
      syncCharacterOptions();
      return;
    }
    try {
      const { groups } = await dataManager.listGroups({ includeMemberGroups: true });
      groupCatalog.clear();
      (Array.isArray(groups) ? groups : []).forEach((group) => {
        if (!group?.id) return;
        groupCatalog.set(group.id, { id: group.id, name: group.name || group.id, templateId: group.template_id || "" });
      });
    } catch (error) {
      console.warn("Character editor: unable to list campaigns", error);
    }
    syncCharacterOptions();
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

  // Mounts the exact same Game Log widget the Dashboard uses
  // (common/js/lib/widgets/game-log.js) into this section's own content area
  // instead of a Dashboard widget card — no dashboard-toggle affordances
  // (resolveKindIcon/isSpotlightOnDashboard/onToggleSpotlight all omitted),
  // since Workbench has no per-viewer "dashboard" for a spotlight entry's
  // icon to add/remove itself from; the widget's own fallback already
  // renders those plain/non-interactive when no icon resolver is given (see
  // its own resolveEntryIcon). No setRightAction either — this section's own
  // header has no equivalent action slot, only the Refresh button below.
  // Always mounted, even with an empty groupId/shareToken — the widget's own
  // render() already shows "No active campaign — pick one from the header
  // menu." for that case, so there's no separate "unmounted" state to model
  // here at all, just "mounted against whatever the current campaign is (or
  // isn't)."
  function mountGameLog() {
    gameLogWidget?.destroy();
    gameLogWidget = initGameLogWidget(elements.gameLogPanel, {
      dataManager,
      status,
      groupId: gameLogContext.groupId,
      shareToken: gameLogContext.shareToken,
      roster: gameLogContext.members,
      ownerId: gameLogContext.ownerId,
    });
  }

  // (Re)subscribes state.groupContext to the active campaign's own Group
  // Properties — remounted alongside the Game Log widget above, off the
  // exact same gameLogContext this file already resolves (see
  // syncGameLogContext), rather than re-running that same group/access
  // resolution a second time. `isOwner` is captured once here rather than
  // re-derived per binding read since it only ever changes when this whole
  // function re-runs (i.e., when the active campaign itself changes).
  function mountGroupPropertyContext() {
    groupWatcher?.stop();
    groupWatcher = null;
    if (!gameLogContext.groupId) {
      state.groupContext = null;
      renderCanvas();
      return;
    }
    const groupId = gameLogContext.groupId;
    state.groupContext = {
      groupId,
      isOwner: gameLogContext.access === "owner",
      schema: [],
      values: {},
    };
    groupWatcher = watchGroupForChanges({
      dataManager,
      groupId,
      shareToken: gameLogContext.shareToken,
      onChange: (payload) => {
        // The active campaign may have already moved on by the time this
        // resolves (a poll/live-stream tick landing after the GM/player
        // switched campaigns) — discard rather than repopulating the WRONG
        // group's data.
        if (!state.groupContext || state.groupContext.groupId !== groupId) return;
        state.groupContext.schema = Array.isArray(payload?.properties) ? payload.properties : [];
        state.groupContext.values =
          payload?.propertyValues && typeof payload.propertyValues === "object" ? payload.propertyValues : {};
        renderCanvas();
      },
      onError: (error) => {
        console.error("Group property sync error", error);
      },
    });
  }

  function initGameLog() {
    if (elements.gameLogRefresh) {
      elements.gameLogRefresh.addEventListener("click", () => {
        void gameLogWidget?.refresh();
      });
    }
  }

  // Resets to "no active campaign" — same shape as setGameLogContext below,
  // just always landing on the empty case, so both funnel through one
  // real remount decision (`changed`) rather than duplicating it.
  function clearGameLogContext() {
    const changed = Boolean(gameLogContext.groupId || gameLogContext.shareToken) || !gameLogWidget;
    gameLogContext.groupId = "";
    gameLogContext.groupName = "";
    gameLogContext.shareToken = "";
    gameLogContext.systemId = "";
    gameLogContext.access = "none";
    gameLogContext.members = [];
    gameLogContext.ownerId = null;
    gameLogPanelState.collapsed = false;
    if (elements.gameLogTitle) {
      elements.gameLogTitle.textContent = "";
      elements.gameLogTitle.hidden = true;
    }
    if (changed) {
      mountGameLog();
      mountNowShowingWatcher();
      mountGroupPropertyContext();
    }
  }

  function setGameLogContext({
    groupId = "",
    shareToken = "",
    groupName = "",
    systemId = "",
    access = "none",
    members = [],
    ownerId = null,
  } = {}) {
    const normalizedId = typeof groupId === "string" ? groupId.trim() : "";
    const normalizedToken = typeof shareToken === "string" ? shareToken.trim() : "";
    const normalizedAccess = typeof access === "string" ? access : "none";
    if (!normalizedId && !normalizedToken) {
      clearGameLogContext();
      return;
    }
    const changed = normalizedId !== gameLogContext.groupId || normalizedToken !== gameLogContext.shareToken;
    gameLogContext.groupId = normalizedId;
    gameLogContext.shareToken = normalizedToken;
    gameLogContext.groupName = typeof groupName === "string" ? groupName.trim() : "";
    gameLogContext.systemId = typeof systemId === "string" ? systemId.trim() : "";
    gameLogContext.access = normalizedAccess;
    gameLogContext.members = Array.isArray(members) ? members : [];
    gameLogContext.ownerId = ownerId ?? null;
    if (elements.gameLogTitle) {
      elements.gameLogTitle.textContent = gameLogContext.groupName;
      elements.gameLogTitle.hidden = !gameLogContext.groupName;
    }
    if (changed) {
      mountGameLog();
      mountNowShowingWatcher();
      mountGroupPropertyContext();
    }
  }

  // "Now Showing" — the exact same read-only icon strip Dashboard uses for
  // its own floating spotlight panel (createSpotlightPanel,
  // common/js/lib/widgets/spotlight-panel.js), mounted inline here instead,
  // with `interactive: false`: Workbench has no per-viewer "dashboard" of
  // its own for a click to add/remove something from, so every icon just
  // reports what's currently shown, full stop — no click behavior, no
  // mine/available distinction. Replaces the old single-slot rich preview
  // (a Press-rendered card, or an "Open" link for Map/Encounter) with the
  // FULL currently-active set, same as Dashboard's own panel — the richer
  // per-entity preview and map/encounter deep links are gone, in exchange
  // for the same simple, always-current status display every other surface
  // in the suite now uses.
  // Two independent conditions decide whether this section shows at all: an
  // active spotlight AND the current top-level mode being Character — Now
  // Showing has no place in the Template editor, where there's no "now"
  // being played. workbench.js sets document.body.dataset.workbenchMode on
  // every mode switch; this section no longer carries
  // data-workbench-mode-panel itself (removed from index.html), so this is
  // the only thing gating it. Bootstrap's .d-flex/.d-none utility classes are
  // both declared `!important`, so toggling between them (never the plain
  // `hidden` attribute, which a `!important` `display` class silently
  // defeats) avoids any display-property specificity conflict.
  function updateNowShowingVisibility(hasActive) {
    if (!elements.nowShowingSection) {
      return;
    }
    const modeAllows = document.body.dataset.workbenchMode !== "template";
    const shouldShow = Boolean(hasActive) && modeAllows;
    elements.nowShowingSection.classList.toggle("d-none", !shouldShow);
    elements.nowShowingSection.classList.toggle("d-flex", shouldShow);
  }

  function renderNowShowing(activeEntries) {
    if (Array.isArray(activeEntries)) lastActiveNowShowingEntries = activeEntries;
    // A spotlight flagged data.hidden (combat-tracker.js's own
    // hideFromTable) is deliberately invisible everywhere, not just to
    // players — same filter dashboard.js's own refreshSpotlightPanel applies.
    const items = lastActiveNowShowingEntries
      .filter((entry) => entry.payload?.data?.hidden !== true)
      .map((entry) => {
        const kind = String(entry.payload?.kind || "").trim();
        const id = String(entry.payload?.id || "").trim();
        const key = `${kind}:${id}`;
        if (!SPOTLIGHT_INLINE_KINDS.has(kind)) {
          spotlightTitleCache.ensure(kind, id, () => renderNowShowing());
        }
        return {
          key,
          kind,
          id,
          templateId: entry.payload?.templateId || "",
          icon: SPOTLIGHT_KIND_ICONS[kind] || "tabler:sparkles",
          title: spotlightTitleCache.get(kind, id) || SPOTLIGHT_KIND_LABELS[kind] || kind,
          isOnDashboard: false,
          isNew: Array.isArray(activeEntries) && !knownNowShowingKeys.has(key),
        };
      });
    if (Array.isArray(activeEntries)) knownNowShowingKeys = new Set(items.map((item) => item.key));
    updateNowShowingVisibility(items.length > 0);
    nowShowingPanel.render(items, { interactive: false });
  }

  function mountNowShowingWatcher() {
    nowShowingWatcher?.destroy();
    lastActiveNowShowingEntries = [];
    knownNowShowingKeys = new Set();
    nowShowingWatcher = watchActiveSpotlights({
      dataManager,
      groupId: gameLogContext.groupId,
      shareToken: gameLogContext.shareToken,
      onChange: (active) => renderNowShowing(active),
    });
    // watchActiveSpotlights' own guard never calls onChange at all without a
    // groupId/shareToken (it just hands back an inert {destroy(){}}) — clear
    // whatever was showing before explicitly, since nothing else will.
    if (!gameLogContext.groupId && !gameLogContext.shareToken) {
      renderNowShowing([]);
    }
  }

  // Posting a plain chat message now goes entirely through the mounted Game
  // Log widget's own form (initGameLogWidget builds and wires that itself) —
  // this is the one kind of log entry Workbench still posts directly,
  // because rolling dice isn't something the shared widget has any concept
  // of initiating, only displaying (see game-log.js's own describeEntry
  // "roll" case). Posts straight to the same dataManager.createGroupLogEntry
  // endpoint the widget's own form uses, then asks the mounted widget to
  // refresh so it shows up immediately rather than waiting for its own next
  // poll tick/live-stream nudge.
  // Silently does nothing without an active campaign — the roll result
  // itself still renders inline wherever the dice roller shows it either
  // way, so nothing is lost except a persistent log entry there's nowhere to
  // put one.
  function recordGameLogRoll(result, { expression = "", label = "", verdict = "" } = {}) {
    if (!result || !dataManager.isAuthenticated() || (!gameLogContext.groupId && !gameLogContext.shareToken)) {
      return;
    }
    const context = resolveCurrentCharacterContext();
    const payload = {
      expression: expression || result.expression || result.notation || "",
      notation: result.notation || expression || "",
      total: result.total,
      label: label || undefined,
      // A System-defined Move's own matched band/compare label (Section
      // 1.3/4, e.g. "Partial Success") — optional, absent for a plain
      // roll. See game-log.js's own describeEntry "roll" case.
      verdict: verdict || undefined,
      character: context || undefined,
    };
    dataManager
      .createGroupLogEntry({
        groupId: gameLogContext.shareToken ? "" : gameLogContext.groupId,
        shareToken: gameLogContext.shareToken,
        type: "roll",
        message: "",
        payload,
      })
      .then(() => gameLogWidget?.refresh())
      .catch((error) => {
        console.error("Character editor: unable to send roll to the game log", error);
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

  // The active-campaign selector (the header's own Campaign dropdown,
  // shared cross-tool via getActiveGroup/setActiveGroup) is the single
  // source of truth for "which table am I watching" — see
  // common/js/lib/widgets/group-context.js's own resolveGroupContext (the
  // Dashboard-side mirror of this function) for the full reasoning. A
  // loaded character's own campaign membership used to take priority over
  // it — confirmed real bug this replaced: that silently overrode whatever
  // the header showed (a user could pick a DIFFERENT campaign there and see
  // nothing change), and had no way to express "I own characters in several
  // campaigns, let me pick which table I'm at right now." A character's
  // membership still determines whether a campaign is a legal choice in the
  // dropdown at all (listGroups' own member scope) — it just never silently
  // substitutes for actually choosing it.
  async function syncGameLogContext() {
    const shareToken = state.shareToken || groupShareState.token || "";
    const shareGroupId = shareToken ? groupShareState.groupId || "" : "";
    if (shareToken && shareGroupId) {
      const groupName = groupShareState.group?.name || gameLogContext.groupName;
      const access = dataManager.isAuthenticated() ? "share" : "viewer";
      setGameLogContext({
        groupId: shareGroupId,
        shareToken,
        groupName,
        systemId: groupShareState.group?.system_id || "",
        access,
        members: Array.isArray(groupShareState.group?.members) ? groupShareState.group.members : [],
        ownerId: groupShareState.group?.owner_id ?? null,
      });
      return;
    }
    if (!dataManager.isAuthenticated()) {
      clearGameLogContext();
      return;
    }
    const active = dataManager.getActiveGroup();
    if (active?.groupId) {
      // Resolve real ownership rather than assuming "owner" unconditionally
      // — listGroups' own member scope (see group-context.js's own
      // resolveGroupContext, this function's Dashboard-side mirror) lets a
      // mere MEMBER select a campaign they don't own too, and this file has
      // its own GM-only controls gated on gameLogContext's access (the
      // spotlight "show to table" affordances) that shouldn't show for a
      // non-owner even though the server-side check would still correctly
      // reject the actual action.
      try {
        const { groups } = await dataManager.listGroups({ includeMemberGroups: true });
        const match = Array.isArray(groups) ? groups.find((entry) => entry.id === active.groupId) : null;
        if (match) {
          const ownerId = match.owner_id ?? null;
          const userId = dataManager.session?.user?.id ?? null;
          setGameLogContext({
            groupId: active.groupId,
            groupName: match.name || active.name || "",
            systemId: match.system_id || "",
            access: ownerId === userId ? "owner" : "member",
            members: Array.isArray(match.members) ? match.members : [],
            ownerId,
          });
          return;
        }
      } catch (error) {
        // Falls through to the unconditional-owner shape below as a last
        // resort, matching group-context.js's own identical fallback.
      }
      setGameLogContext({
        groupId: active.groupId,
        groupName: active.name || "",
        systemId: "",
        access: "owner",
        members: [],
        ownerId: dataManager.session?.user?.id ?? null,
      });
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
    if (!elements.groupShareRelevant) {
      return;
    }
    const hasToken = Boolean(groupShareState.token);
    const available = Array.isArray(groupShareState.available) ? groupShareState.available : [];
    // Hidden whenever there's nothing actionable — no share token at all
    // (the common case: this character was opened directly, not via a
    // group invite link), or a token but every character in the group is
    // already claimed. Loading/error are still "something is happening,"
    // so those keep the section visible with its own message; only the
    // terminal "nothing to claim" state hides it entirely (header
    // included), rather than staying expanded to show an empty-feeling
    // "no unclaimed characters" line no one asked to see.
    // setElementVisible (NOT `.hidden`) — this element carries `.d-flex`,
    // and the native [hidden] UA rule carries no !important, so it silently
    // loses to Bootstrap's own !important display utility (see dom.js's own
    // comment on setElementVisible for the general case; this element is
    // exactly that trap). Targets a dedicated inner wrapper, not the outer
    // [data-group-share-section] itself — that outer element is also
    // gated by workbench.js's own Character/Template mode toggle
    // (data-workbench-mode-panel, a `.d-none` class flip); putting BOTH
    // toggles on one element would have them fight over the same node
    // (whichever last set an inline style vs. a class would win, not
    // "both conditions must hold").
    const relevant = hasToken && (groupShareState.loading || groupShareState.error || available.length > 0);
    setElementVisible(elements.groupShareRelevant, relevant);
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
    if (!available.length) {
      // Section is already hidden (see `relevant` above) — nothing left
      // to render here, just clear any leftover status text.
      setGroupShareStatus("");
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
      void syncGameLogContext();
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
      applyTemplateData(payload, { origin: metadata.source || "remote", id });
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

  // Workbench's "Party Data" mode — the exact same Template/Component/
  // Binding engine as a Character's own sheet, just rooted at a Group
  // instead of a character: state.draft stays {} throughout, and every
  // component in the campaign's own Party Template is expected to bind only
  // to @group.* paths — those already read/write/permission-check correctly
  // with no character present (getBindingContext/updateGroupBinding, built
  // earlier this session; unrelated to this function). Setting this
  // campaign active (dataManager.setActiveGroup) makes picking it here
  // equivalent to picking it in the header's own campaign selector — Now
  // Showing/Game Log deliberately follow along, the same way they would for
  // any other explicit campaign choice; syncGameLogContext (unchanged)
  // resolves ownership/access and, via setGameLogContext, remounts
  // mountGroupPropertyContext for us — no separate group-context resolution
  // needed here.
  async function loadGroupPartyView(groupId, groupName = "") {
    if (!groupId || !dataManager) {
      return;
    }
    state.character = null;
    state.draft = {};
    state.characterOrigin = null;
    state.template = null;
    state.components = [];
    collapsedComponents.clear();
    resetSystemContext();
    // state.mode is deliberately left untouched — same as loadCharacter,
    // which never resets it either, so switching to Party Data while
    // already in Edit mode stays in Edit mode instead of silently dropping
    // to view. A caller that specifically wants view mode (deleteCurrentCharacter's
    // own fallback) sets state.mode itself before calling this.
    state.partyMode = true;
    componentCounter = 0;
    currentNotesKey = "";
    state.shareToken = "";
    if (elements.characterSelect) {
      elements.characterSelect.value = `group:${groupId}`;
    }
    markCharacterClean();
    dataManager.setActiveGroup(groupId, groupName);
    await syncGameLogContext();
    renderCanvas();
    renderPreview();
    void refreshRelationshipsSection();
    syncCharacterActions();
    syncNotesEditor();
    let templateId = "";
    try {
      // preferLocal: false — same "this is the authoritative editor, never
      // trust a stale local cache" reasoning as loadCharacter/loadTemplateById
      // below use for their own fetches.
      const result = await dataManager.get("group", groupId, { preferLocal: false });
      templateId = result?.payload?.templateId || "";
    } catch (error) {
      console.error("Character editor: failed to load campaign", error);
      status.show("Unable to load this campaign", { type: "error", timeout: 2500 });
      return;
    }
    // The active campaign may have already moved on by the time this
    // resolves (the GM/player picked a different campaign or character
    // while the fetch above was in flight) — discard rather than loading
    // the WRONG campaign's template over whatever's now actually selected.
    if (gameLogContext.groupId !== groupId) {
      return;
    }
    if (!templateId) {
      elements.canvasRoot?.replaceChildren(
        createCanvasPlaceholder("This campaign has no Party Template assigned — pick one in Loom's Group tab.", {
          variant: "root",
        })
      );
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

  function applyTemplateData(payload, { origin = "remote", id = "" } = {}) {
    const template = {
      // Library-sourced templates never embed their own id in the JSON body
      // (same convention as every other Library kind) — fall back to the id
      // this was actually fetched by, same "defensive re-stamp from known
      // context" pattern as loadCharacter's own state.draft.id/state.character.id.
      id: payload.id || id || "",
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
    // `state.draft?.id` (not just `state.draft`) — Party Data mode (see
    // loadGroupPartyView) leaves `state.draft` at the standard {} "no
    // character" sentinel, which is truthy; without this check, loading a
    // campaign's Party Template would incidentally write a stray `template`
    // key into that otherwise-empty draft.
    if (state.draft?.id) {
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
    state.partyMode = false;
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
      void refreshRelationshipsSection();
      syncCharacterOptions();
      syncCharacterActions();
      syncCharacterToolbarVisibility();
      status.show(`Loaded ${state.draft.name || metadata.title || state.draft.id}`, {
        type: "success",
        timeout: 2000,
      });
      await syncGameLogContext();
    } catch (error) {
      console.error("Character editor: failed to load character", error);
      const pruned = handleCharacterLoadFailure(id, error);
      const message = pruned
        ? "That character is no longer available and was removed from your list."
        : "Unable to load character";
      const type = pruned ? "warning" : "error";
      status.show(message, { type, timeout: 2800 });
      syncCharacterToolbarVisibility();
      await syncGameLogContext();
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
      state.draft = {};
      state.characterOrigin = null;
      state.template = null;
      state.components = [];
      collapsedComponents.clear();
      resetSystemContext();
      markCharacterClean();
      renderCanvas();
      renderPreview();
      void refreshRelationshipsSection();
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
    if (!state.draft?.id && !state.template?.id) {
      // state.partyMode (NOT the mere presence of state.groupContext, which
      // populates ambiently for any active campaign regardless of whether
      // Party Data was ever actually chosen — see its own comment on state)
      // means loadGroupPartyView is active for a campaign with no Party
      // Template assigned — a more specific, actionable message than the
      // generic "pick something" one below (also covers the brief render
      // that happens before that function's own template lookup resolves).
      const message =
        state.partyMode && state.groupContext
          ? "This campaign has no Party Template assigned yet — pick one in Loom's Group tab."
          : "Select a character or campaign to view a sheet.";
      elements.canvasRoot.appendChild(createCanvasPlaceholder(message, { variant: "root" }));
      refreshTooltips(elements.canvasRoot);
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
      return;
    }
    if (!state.components.length) {
      elements.canvasRoot.appendChild(
        createCanvasPlaceholder("This template has no components yet.", { variant: "root" })
      );
      refreshTooltips(elements.canvasRoot);
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
      case "input": {
        // A binding that resolves to an array (a System's own "inventory"-
        // style field authored straight onto an Input, with no dedicated
        // Repeater template built for it) used to reach renderInputComponent
        // and silently corrupt itself the moment it was typed into (see
        // component-renderers.js's own array/object guard, added first as
        // the immediate stop-the-bleeding fix). This is the real fallback:
        // a generic rows-of-columns editor instead of a read-only warning.
        // Only intercepts Input — Repeater already handles its own array
        // data correctly and is never routed through here.
        const variant = (component.variant || "text").toLowerCase();
        if (variant !== "checkbox") {
          const resolvedValue = resolveComponentValue(component, component.value ?? "");
          if (Array.isArray(resolvedValue)) {
            return renderCollectionComponent(component, resolvedValue);
          }
        }
        return renderInputComponent(component);
      }
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
        return isRepeaterCellEditable(comp, itemContext);
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

  // True only for a plain field-shaped object that has a real "value"
  // property of its own (e.g. Saving Throws/Skills' `{name, proficiency,
  // friendlyName, value}` item) — an array never has one (Array.prototype
  // has no own "value" key), so Blades in the Dark's bare
  // `playbooks.Cutter` abilities array is unaffected. Shared between
  // resolveRepeaterItemValue's read side and resolveRepeaterItemPath's
  // write side so the two can't disagree about which case they're in.
  function itemHasOwnValueField(item) {
    return item !== null && typeof item === "object" && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, "value");
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
  // "@value" means "this item itself," checked before the object/primitive
  // branch below — EXCEPT when the item is a plain object with its own
  // real "value" field (itemHasOwnValueField above), which needs to resolve
  // as a normal property lookup instead, or that field becomes permanently
  // unreachable (confirmed real regression: the D&D Character - Tabs
  // template's Saving Throws/Skills repeater items are exactly this shape,
  // and their own "@value"-bound modifier Input started rendering "bound to
  // list/object data" instead of the actual number once the whole-item
  // convention below was added for a different, unrelated case). That
  // convention itself still exists for source-driven Tabs (Container's own
  // tabLabelsSourceBinding), which need "@value" to work when the item
  // genuinely **is** an array with nothing to shadow — e.g. Blades in the
  // Dark's restructured `playbooks.Cutter`, a bare abilities array with no
  // wrapping object at all.
  function resolveRepeaterItemValue(item, raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text.startsWith("@")) return raw;
    const path = text.slice(1).split(".").map((segment) => segment.trim()).filter(Boolean);
    if (!path.length) return undefined;
    if (path.length === 1 && path[0] === "value" && !itemHasOwnValueField(item)) {
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
  // [...repeaterPath, index] with no further segment. Same
  // itemHasOwnValueField disambiguation as the read side: an object item
  // with its own real "value" field writes to that field
  // ([...itemSlotPath, "value"]), not over the whole item slot — reads the
  // item's CURRENT value via getValueAtPath to decide, since this function
  // (unlike resolveRepeaterItemValue) is only ever given the index, not the
  // item itself.
  function resolveRepeaterItemPath(component, index, raw) {
    const repeaterPath = resolveBindingPath(component?.binding);
    if (!repeaterPath) return null;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text.startsWith("@")) return null;
    const itemPath = text.slice(1).split(".").map((segment) => segment.trim()).filter(Boolean);
    if (!itemPath.length) return null;
    const itemSlotPath = [...repeaterPath, String(index)];
    if (itemPath.length === 1 && itemPath[0] === "value") {
      if (itemHasOwnValueField(getValueAtPath(itemSlotPath))) {
        return [...itemSlotPath, "value"];
      }
      return itemSlotPath;
    }
    return [...itemSlotPath, ...itemPath];
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
    // A Repeater bound to "@group.partyInventory" computes a path rooted at
    // ["group", "partyInventory", ...] — same "group" first-segment
    // convention updateBinding itself checks, routed the exact same way
    // (see updateGroupBinding's own comment for why this can't just reuse
    // setValueAtPath/applyBindingValue: those mutate state.draft, which
    // group data must never end up inside).
    if (pathSegments[0] === "group") {
      updateGroupBinding(pathSegments.slice(1), value);
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
    // Same "group" first-segment routing as setRepeaterItemValue — a tab
    // binding like "@group.resources.{item}.current" must reach
    // updateGroupBinding, not state.draft.
    if (pathSegments[0] === "group") {
      updateGroupBinding(pathSegments.slice(1), value);
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
      // getBindingContext() is state.draft plus a "group" key — reading
      // through it here (rather than getValueAtPath/state.draft directly)
      // is what makes "@group.resources.{item}.current" resolvable, same
      // reasoning as setTabItemValue's write-side routing above.
      return pathSegments ? getValueAtContext(getBindingContext(), pathSegments) : undefined;
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
    // Adding/removing a whole row is this Repeater's OWN top-level binding
    // (component.binding, e.g. "@group.partyInventory"), unlike a single
    // cell's item-relative one — same group-permission reasoning as
    // isRepeaterCellEditable, checked directly against component.binding
    // here instead since there's no itemContext at this level.
    const canManage =
      Boolean(component.allowAddRemove) &&
      Boolean(component.binding) &&
      !isGroupBindingBlocked(component?.binding) &&
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

  // Column plan for renderCollectionComponent — derived primarily from
  // whatever keys actually appear across the array's own row objects (works
  // even with zero System metadata, the common case: the user's real
  // inventory arrays have no `item` declaration and still need this to
  // work). If the bound field's own System declaration also has
  // `item.children`, collectSystemFields already flattens that into
  // "path[].subkey" entries (the same lookup Binding/Formula autocomplete
  // uses) — folded in here purely to contribute a nicer label or a
  // number-vs-text hint for a key with no data yet, never to require
  // authoring metadata that most fields don't have. A row that's a bare
  // primitive (a plain string/number array, no object rows at all) collapses
  // to one synthetic "value" column representing the row itself.
  function resolveCollectionColumns(component, items) {
    const dataKeys = [];
    const seenKeys = new Set();
    let sawObjectItem = false;
    items.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        sawObjectItem = true;
        Object.keys(item).forEach((key) => {
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            dataKeys.push(key);
          }
        });
      }
    });
    const pathSegments = resolveBindingPath(component.binding);
    const arrayPath = pathSegments ? pathSegments.join(".") : "";
    const itemFieldPrefix = `${arrayPath}[].`;
    const itemFields =
      arrayPath && state.systemDefinition
        ? collectSystemFields(state.systemDefinition).filter((entry) => entry.path.startsWith(itemFieldPrefix))
        : [];
    itemFields.forEach((entry) => {
      const key = entry.path.slice(itemFieldPrefix.length);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        dataKeys.push(key);
      }
    });
    if (!sawObjectItem && !itemFields.length) {
      const numericOnly = items.length > 0 && items.every((item) => typeof item === "number");
      return [{ key: "value", label: component.label || component.name || "Value", numeric: numericOnly, primitive: true }];
    }
    return dataKeys.map((key) => {
      const match = itemFields.find((entry) => entry.path === `${itemFieldPrefix}${key}`);
      const numericFromData = items.some((item) => item && typeof item === "object" && typeof item[key] === "number");
      return {
        key,
        label: (match && match.label) || key,
        numeric: numericFromData || Boolean(match && match.category === "number"),
        primitive: false,
      };
    });
  }

  function getCollectionCellValue(item, column) {
    if (column.primitive) {
      return item;
    }
    return item && typeof item === "object" ? item[column.key] : undefined;
  }

  function setCollectionCellValue(item, column, value) {
    if (column.primitive) {
      return value;
    }
    const next = item && typeof item === "object" && !Array.isArray(item) ? { ...item } : {};
    next[column.key] = value;
    return next;
  }

  // A freshly added row starts with every known column defaulted (blank
  // string / 0), not a bare {} — unlike a Repeater's own item template
  // (createBlankRepeaterItem), this editor has no item-template nodes of its
  // own to fall back on for "how should an empty cell render," so the
  // columns computed above are the only source of truth for what the new
  // row should even contain.
  function createBlankCollectionItem(columns) {
    if (columns.length === 1 && columns[0].primitive) {
      return columns[0].numeric ? 0 : "";
    }
    const blank = {};
    columns.forEach((column) => {
      blank[column.key] = column.numeric ? 0 : "";
    });
    return blank;
  }

  function renderCollectionRow(component, columns, item, index, items, writeItems, editable) {
    const row = document.createElement("div");
    row.className = "d-flex align-items-center gap-2 flex-wrap";
    columns.forEach((column) => {
      const currentValue = getCollectionCellValue(item, column);
      if (!editable) {
        const text = document.createElement("div");
        text.className = "form-control-plaintext form-control-sm flex-grow-1 py-0";
        text.textContent = currentValue === null || currentValue === undefined ? "" : String(currentValue);
        row.appendChild(text);
        return;
      }
      const input = document.createElement("input");
      input.className = "form-control form-control-sm flex-grow-1";
      input.type = column.numeric ? "number" : "text";
      input.placeholder = column.label;
      input.setAttribute("aria-label", column.label);
      input.value = currentValue === null || currentValue === undefined ? "" : currentValue;
      // Unique per cell, not just per component — every other Input's
      // dataset.bindingPath is the component's own single binding, fine
      // when a component owns exactly one value. Here one component owns a
      // whole array of cells; without a per-cell key, restoreActiveField
      // (see updateBinding's own focus-preservation) would re-match the
      // FIRST cell in this component after every keystroke instead of the
      // one actually being typed into, since every cell would otherwise
      // share the identical dataset.bindingPath the component's own binding
      // already carries.
      input.dataset.bindingPath = `${component.binding || component.uid || ""}::${index}::${column.key}`;
      input.addEventListener("input", () => {
        const raw = input.value;
        let nextValue = raw;
        if (column.numeric) {
          if (raw === "") {
            nextValue = null;
          } else {
            const parsed = Number(raw);
            nextValue = Number.isNaN(parsed) ? raw : parsed;
          }
        }
        const nextItems = items.slice();
        nextItems[index] = setCollectionCellValue(item, column, nextValue);
        writeItems(nextItems);
      });
      row.appendChild(input);
    });
    if (editable) {
      row.appendChild(
        createIconButton({
          icon: "tabler:trash",
          label: "Remove item",
          variant: "outline-danger",
          onClick: () => {
            writeItems(items.filter((_, i) => i !== index));
          },
        })
      );
    }
    return row;
  }

  // Fallback editor for an Input-typed component whose binding resolves to
  // an array with no Repeater built for it — see renderComponentContent's
  // "input" case, the only caller. Deliberately simpler than a real
  // Repeater (no item-template authoring, no orientation/column-count
  // options): this exists so a bare array binding is never a dead end or a
  // silent data-corruption trap, not to replace authoring a proper Repeater
  // for anything that deserves one.
  function renderCollectionComponent(component, items) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column gap-2";
    const labelText = component.label || component.name;
    if (labelText) {
      const heading = document.createElement("div");
      heading.className = "fw-semibold text-body-secondary";
      heading.textContent = labelText;
      wrapper.appendChild(heading);
    }
    const editable = isEditable(component) && Boolean(component.binding);
    const columns = resolveCollectionColumns(component, items);
    const writeItems = (nextItems) => updateBinding(component.binding, nextItems);
    if (!items.length) {
      wrapper.appendChild(createCanvasPlaceholder("No items.", { variant: "compact" }));
      if (editable) {
        wrapper.appendChild(createRepeaterAddButton(() => writeItems([createBlankCollectionItem(columns)])));
      }
      return wrapper;
    }
    items.forEach((item, index) => {
      wrapper.appendChild(renderCollectionRow(component, columns, item, index, items, writeItems, editable));
    });
    if (editable) {
      wrapper.appendChild(createRepeaterAddButton(() => writeItems([...items, createBlankCollectionItem(columns)])));
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
    const dataContext = itemContext ? (itemContext.item && typeof itemContext.item === "object" ? itemContext.item : {}) : getBindingContext();
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
        return path ? getValueAtContext(getBindingContext(), path) : undefined;
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
        return path ? getValueAtContext(getBindingContext(), path) : undefined;
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
        const resolved = path ? getValueAtContext(getBindingContext(), path) : undefined;
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
        const result = evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression });
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
        const resolved = Number(getValueAtContext(getBindingContext(), path));
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
        return isRepeaterCellEditable(comp, itemContext);
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
        return isRepeaterCellEditable(comp, itemContext);
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
        // Same "@group.*" permission gate as isEditable/isRepeaterCellEditable
        // — checked against the enclosing Repeater's own binding when
        // nested, otherwise this Toggle's own binding directly.
        if (isGroupBindingBlocked(itemContext ? itemContext.repeaterComponent?.binding : comp?.binding)) {
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

  // A component's `binding` (writes to/reads from the character) and its
  // `sourceBinding` (reads a choice list from the System) must never share
  // the same key name. The contexts below are checked in priority order and
  // the live character's own draft data wins before the System's own lookup
  // list does — so if both use the same key, the moment a character gets a
  // real value for it, this starts resolving to THAT value instead of the
  // System's list, silently collapsing the dropdown to empty. Not validated
  // or warned about anywhere in the editor — give the System-side lookup
  // field a distinct (usually plural) name from the character-side field it
  // populates: `heritages` vs. `heritage`, `backgrounds` vs. `background`.
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
        return Boolean(evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression }));
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
        return Boolean(evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression }));
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
        return Boolean(evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression }));
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
      // Same Binding/Formula pair every other color field has — Font
      // Default is now the shared createColorPickerField (Template
      // Properties, workbench-template-view.js), not a plain native color
      // input, so it needs somewhere to hold a non-literal value too.
      // fontColor itself always stays a real, padded-in literal (above) —
      // these two are only ever non-empty when actively overriding it.
      fontColorBinding: typeof source.fontColorBinding === "string" ? source.fontColorBinding.trim() : "",
      fontColorFormula: typeof source.fontColorFormula === "string" ? source.fontColorFormula.trim() : "",
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

  // Font Default's own Formula-then-Binding-then-literal precedence — same
  // shape resolveTemplateColor below gives the sheet's own Background/
  // Border, just read off state.template.defaults (one level deeper)
  // instead of state.template directly, since a per-component fallback's
  // Binding/Formula pair lives alongside it there (normalizeTemplateDefaults).
  function resolveTemplateDefaultColor(defaultKey, templateDefaults) {
    const formula = templateDefaults[`${defaultKey}Formula`];
    if (formula) {
      try {
        const result = evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression });
        if (typeof result === "string" && result.trim()) return result.trim();
      } catch (error) {
        console.warn(`Character editor: unable to evaluate template default ${defaultKey} formula`, error);
      }
    }
    const binding = templateDefaults[`${defaultKey}Binding`];
    if (binding) {
      const resolved = getBindingValue(binding);
      if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
    }
    return templateDefaults[defaultKey] || "";
  }

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
        const result = evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression });
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
          const result = evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression });
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
        overridden[colorProp] = resolveTemplateDefaultColor(defaultKey, templateDefaults);
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

  // Shared by every item-template node type that supports real editing
  // (Input, Track, Select Group) — same "@group.*" permission gate as
  // isEditable's own, just checked against the ENCLOSING Repeater's own
  // top-level binding (itemContext.repeaterComponent) rather than the
  // cell's own binding, since a cell inside a repeater row is always
  // resolved item-relatively ("@name", never "@group.name" — see
  // resolveRepeaterItemValue) even when the repeater itself is bound to
  // "@group.partyInventory". Without this, state.mode === "edit" would let
  // a character's own owner edit another campaign member's non-public
  // group data just by opening their own sheet in Edit mode.
  function isRepeaterCellEditable(comp, itemContext) {
    if (!itemContext) {
      return isEditable(comp);
    }
    if (!comp.binding) {
      return false;
    }
    if (isGroupBindingBlocked(itemContext.repeaterComponent?.binding)) {
      return false;
    }
    return state.mode === "edit" || isRepeaterItemNodeEditableInPlay(comp, itemContext.item);
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
        overridden[colorProp] = resolveTemplateDefaultColor(defaultKey, templateDefaults);
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
        return Boolean(evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression }));
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
    // A component bound to "@group.*" carries its own, separate permission
    // gate (Loom's own per-property "Public" flag) underneath whatever this
    // component's own Editable-in-Play authoring settings say — even in
    // Edit mode (normally unconditionally editable just below, since
    // that's the character's own owner editing their own sheet) a
    // group-scoped field this viewer isn't the group owner for and isn't
    // marked public stays read-only, so the UI never shows something
    // interactive that updateGroupBinding is just going to reject anyway.
    // Editing a Character's own sheet doesn't imply GM-level authority over
    // whatever campaign it happens to be in.
    if (isGroupBindingBlocked(component?.binding)) {
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
        const dataContext = getBindingContext();
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
  // record" (Binding/Text vs Source vocabulary — undercroft/README.md's Code
  // Conventions section), so
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
    return resolveBinding(normalizedBinding, getBindingContext());
  }

  // Whether the CURRENT viewer may write `topLevelKey` — the group's own
  // owner (GM) can always edit any property; anyone else only if that
  // SPECIFIC property's own schema marks it `public` (set via Loom's Group
  // Properties editor). No campaign active at all means nothing is
  // editable, same as any other "@group.*" binding resolving to nothing.
  function isGroupPropertyEditable(topLevelKey) {
    if (!state.groupContext) return false;
    if (state.groupContext.isOwner) return true;
    const schema = Array.isArray(state.groupContext.schema) ? state.groupContext.schema : [];
    const property = schema.find((entry) => entry && entry.key === topLevelKey);
    return Boolean(property?.public);
  }

  // Shared by every editability check below (isEditable, isRepeaterCellEditable,
  // a Repeater's own canManage, Toggle's bespoke editable()) — true only
  // when `binding` actually resolves to a "@group.*" path this viewer
  // ISN'T allowed to write. A non-group binding, or one this viewer can
  // write, is never blocked here.
  function isGroupBindingBlocked(binding) {
    const path = resolveBindingPath(binding);
    return Boolean(path && path[0] === "group" && !isGroupPropertyEditable(path[1]));
  }

  // The write path for a "@group.*" binding — deliberately NOT routed
  // through setValueAtPath/applyBindingValue (those mutate state.draft,
  // which is exactly what gets persisted as the Character's own saved
  // JSON; group data must never end up inside it). Optimistically updates
  // state.groupContext.values for instant UI feedback, then persists via
  // the server's own narrow, per-property-permission endpoint (see
  // persistGroupPropertyValue's own comment for why this can't just be a
  // generic content save). No undo-stack integration, matching this
  // suite's existing precedent for other auto-saved/shared state (a
  // player's own Map drawings have no undo either) — Workbench's own undo
  // stack is scoped to THIS character's draft, which group data was never
  // part of.
  function updateGroupBinding(groupPathSegments, value) {
    if (!state.groupContext || !groupPathSegments.length) {
      return;
    }
    const topLevelKey = groupPathSegments[0];
    if (!isGroupPropertyEditable(topLevelKey)) {
      status?.show("You don't have permission to edit this.", { type: "warning", timeout: 2200 });
      return;
    }
    if (!state.groupContext.values || typeof state.groupContext.values !== "object") {
      state.groupContext.values = {};
    }
    const values = state.groupContext.values;
    const previousValue = cloneValue(getValueAtContext(values, groupPathSegments));
    const nextValue = cloneValue(value);
    if (valuesEqual(previousValue, nextValue)) {
      return;
    }
    setValueAtContext(values, groupPathSegments, nextValue);
    renderCanvas();
    renderPreview();
    const groupId = state.groupContext.groupId;
    void persistGroupPropertyValue({ dataManager, groupId, key: topLevelKey, value: values[topLevelKey] })
      .then(() => groupWatcher?.noteLocalWrite())
      .catch((error) => {
        status?.show(error?.message || "Unable to save that change.", { type: "danger" });
      });
  }

  function updateBinding(binding, value) {
    const pathSegments = resolveBindingPath(binding);
    if (!pathSegments) {
      return;
    }
    if (pathSegments[0] === "group") {
      updateGroupBinding(pathSegments.slice(1), value);
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
    if (elements.newCharacterForm && elements.newCharacterName && elements.newCharacterTemplate && newCharacterModalInstance) {
      setAddCharacterMode("blank");
      newCharacterModalInstance.show();
      return;
    }
    createNewCharacterPromptFallback();
  }

  // Toggles between the modal's two panels — a blank New Character form and
  // the Import Character one — sharing a single toolbar entry point/modal
  // instead of each getting its own toolbar button (see the comment on
  // newCharacterModalInstance above for why).
  function setAddCharacterMode(mode) {
    const isImport = mode === "import";
    elements.addCharacterModeBlank?.classList.toggle("btn-primary", !isImport);
    elements.addCharacterModeBlank?.classList.toggle("btn-outline-primary", isImport);
    elements.addCharacterModeImport?.classList.toggle("btn-primary", isImport);
    elements.addCharacterModeImport?.classList.toggle("btn-outline-primary", !isImport);
    elements.newCharacterForm?.classList.toggle("d-none", isImport);
    elements.importCharacterForm?.classList.toggle("d-none", !isImport);
    elements.addCharacterSubmitBlank?.classList.toggle("d-none", isImport);
    elements.addCharacterSubmitImport?.classList.toggle("d-none", !isImport);
    if (isImport) {
      void activateImportMode();
    } else {
      const defaultTemplate = state.template?.id || elements.newCharacterTemplate?.value || "";
      prepareNewCharacterForm(defaultTemplate);
    }
  }

  function prepareNewCharacterForm(defaultTemplate = "") {
    if (!elements.newCharacterForm) {
      return;
    }
    elements.newCharacterForm.reset();
    elements.newCharacterForm.classList.remove("was-validated");
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
    const name = (elements.newCharacterName.value || "").trim();
    const templateId = (elements.newCharacterTemplate.value || "").trim();
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
    let id = "";
    do {
      id = generateCharacterId(name);
    } while (id && characterCatalog.has(id));
    if (!id) {
      status.show("Unable to generate a character ID. Try again.", { type: "error", timeout: 2400 });
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

  // Clones the currently-loaded character into a brand new record — same
  // "generate a fresh id, register it, persist silently" tail
  // startNewCharacter uses below, except the source is the CURRENT draft's
  // own data (Template/systemIds/sheet values all carried over) instead of
  // a blank template-only shape.
  async function duplicateCharacter() {
    if (!state.draft?.id) {
      status.show("Select a character to duplicate.", { type: "warning", timeout: 2000 });
      return;
    }
    const sourceName = state.draft.title || state.draft.name || state.draft.id;
    const duplicateName = `${sourceName} Copy`;
    let id = "";
    do {
      id = generateCharacterId(duplicateName);
    } while (id && characterCatalog.has(id));
    if (!id) {
      status.show("Unable to generate a character ID. Try again.", { type: "error", timeout: 2400 });
      return;
    }
    const draft = cloneCharacter(state.draft);
    draft.id = id;
    draft.title = duplicateName;
    if (draft.data && typeof draft.data === "object") {
      draft.data = { ...draft.data, name: duplicateName };
    }
    state.character = cloneCharacter(draft);
    state.draft = cloneCharacter(draft);
    state.characterOrigin = "local";
    const user = sessionUser();
    registerCharacterRecord({
      id,
      title: duplicateName,
      template: draft.template || "",
      source: "local",
      ownership: user ? "owned" : "local",
      ownerId: user?.id ?? null,
      ownerUsername: user?.username ?? "",
      ownerTier: user?.tier ?? "",
    });
    if (elements.characterSelect) {
      elements.characterSelect.value = id;
    }
    await persistDraft({ silent: true });
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    void refreshRelationshipsSection();
    syncCharacterActions();
    state.shareToken = "";
    clearGameLogContext();
    status.show(`Duplicated as "${duplicateName}"`, { type: "success", timeout: 2000 });
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
    void refreshRelationshipsSection();
    syncCharacterActions();
    state.shareToken = "";
    clearGameLogContext();
    status.show(`Started ${trimmedName}`, { type: "success", timeout: 2000 });
    return true;
  }

  // --- Import Character (player-facing mapping import) ---------------------
  // Combines Loom's own mapping/fetch engine (reimportViaMapping — the exact
  // one-call "load the mapping definition, fetch the right source, apply the
  // mapping" function Re-import above already uses) with this file's own
  // "New Character" draft-building pattern (startNewCharacter above), so a
  // player can import their own character without ever needing Loom access.
  // The mapping picker only offers mappings a GM has tagged "Character" in
  // Loom's own Import tab ($dataType — see listCharacterMappings in
  // content-fetch.js), never the sub-entity ones (backgrounds/classes/
  // species/...) Loom's own multi-entity Import tab consumes.
  //
  // Two-stage modal: Stage 1 picks a mapping + fetches a URL/id; Stage 2
  // (revealed only once Fetch succeeds) confirms id/name/Template. No
  // window.prompt fallback like New Character's own — a multi-step fetch-
  // then-confirm flow has no reasonable prompt-chain equivalent, so this
  // simply requires the Bootstrap modal to be present.
  let pendingImport = null;

  // There's no Data Source control in this modal (Workbench never lets a
  // player edit $source — Loom is the only place a mapping's $source can be
  // set at all), so this just derives the URL/ID field's placeholder and
  // label from the chosen mapping's own $source, same metadata Loom's own
  // SOURCES-driven fields use.
  async function applyImportValuePlaceholder() {
    const mappingId = elements.importCharacterMapping?.value || "";
    if (!mappingId) {
      if (elements.importCharacterValue) elements.importCharacterValue.placeholder = "";
      if (elements.importCharacterValueLabel) elements.importCharacterValueLabel.textContent = "Character ID or URL";
      return;
    }
    let definition = null;
    try {
      definition = await loadMappingDefinition(mappingId);
    } catch (error) {
      console.warn("Import Character: unable to load mapping definition", error);
    }
    const sourceId = definition?.$source || "";
    const active = SOURCES.find((entry) => entry.id === sourceId) || SOURCES[0] || null;
    if (elements.importCharacterValue) {
      elements.importCharacterValue.placeholder = active?.placeholder || "";
    }
    if (elements.importCharacterValueLabel) {
      elements.importCharacterValueLabel.textContent = active?.valueLabel || "Character ID or URL";
    }
  }

  async function activateImportMode() {
    if (!elements.importCharacterForm) {
      status.show("Import isn't available in this browser.", { type: "warning", timeout: 2500 });
      return;
    }
    pendingImport = null;
    elements.importCharacterForm.reset();
    elements.importCharacterForm.classList.remove("was-validated");
    elements.importCharacterStage1?.classList.remove("d-none");
    elements.importCharacterStage2?.classList.add("d-none");
    if (elements.importCharacterSubmit) elements.importCharacterSubmit.disabled = true;
    if (elements.importCharacterStatus) elements.importCharacterStatus.textContent = "";
    if (elements.importCharacterMapping) {
      elements.importCharacterMapping.innerHTML = "";
      const loading = document.createElement("option");
      loading.value = "";
      loading.textContent = "Loading…";
      elements.importCharacterMapping.appendChild(loading);
    }
    let mappings = [];
    try {
      mappings = await listCharacterMappings();
    } catch (error) {
      console.warn("Import Character: unable to list mappings", error);
    }
    if (elements.importCharacterMapping) {
      elements.importCharacterMapping.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = mappings.length ? "Select what to import…" : "No character imports available yet";
      elements.importCharacterMapping.appendChild(blank);
      mappings.forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.description || entry.id;
        elements.importCharacterMapping.appendChild(option);
      });
    }
    await applyImportValuePlaceholder();
  }

  // Mirrors refreshNewCharacterTemplateOptions above, but filtered by System
  // when the mapping's own $source implies one — today every mapping-driven
  // source (ddb/srd) is D&D-5e-specific (see content-fetch.js's own
  // DND5E_SYSTEM_ID comment, the same hardcoded assumption
  // reimportViaMapping's own lookup-table resolution already relies on) —
  // not a new, more general "mapping declares its System" mechanism, since
  // no such field exists in the mapping schema today.
  function refreshImportTemplateOptions(sourceId) {
    if (!elements.importCharacterTemplate) return;
    const impliedSchema = sourceId === "ddb" || sourceId === "srd" ? "sys.dnd5e" : "";
    const options = Array.from(templateCatalog.values())
      .filter((entry) => entry.id)
      .filter((entry) => !impliedSchema || entry.schema === impliedSchema)
      .map((entry) => ({ value: entry.id, label: entry.title || entry.id }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    populateSelect(elements.importCharacterTemplate, options, { placeholder: "Select template" });
  }

  async function handleImportFetch() {
    const mappingId = elements.importCharacterMapping?.value || "";
    const sourceValue = (elements.importCharacterValue?.value || "").trim();
    if (elements.importCharacterStatus) elements.importCharacterStatus.textContent = "";
    if (!mappingId) {
      status.show("Select what to import.", { type: "warning", timeout: 2000 });
      return;
    }
    if (!sourceValue) {
      status.show("Enter a character ID or URL.", { type: "warning", timeout: 2000 });
      return;
    }
    if (elements.importCharacterFetchButton) elements.importCharacterFetchButton.disabled = true;
    if (elements.importCharacterStatus) elements.importCharacterStatus.textContent = "Fetching…";
    try {
      const mappedData = await reimportViaMapping(mappingId, sourceValue, dataManager);
      // Defensive, not the primary filter — the picker already only offers
      // $dataType: "character" mappings (listCharacterMappings), but a
      // mistagged mapping shouldn't be able to silently save garbage.
      if (!mappedData || mappedData.kind !== "character") {
        if (elements.importCharacterStatus) elements.importCharacterStatus.textContent = "";
        status.show("This mapping doesn't produce a character.", { type: "error", timeout: 3500 });
        return;
      }
      const suggestedName = (mappedData.name || "").trim() || "Imported Character";
      let suggestedId = "";
      do {
        suggestedId = generateCharacterId(suggestedName);
      } while (suggestedId && characterCatalog.has(suggestedId));
      pendingImport = { mappedData, mappingId, sourceValue, id: suggestedId };
      if (elements.importCharacterName) {
        elements.importCharacterName.value = suggestedName;
      }
      const mappingDefinition = await loadMappingDefinition(mappingId).catch(() => null);
      refreshImportTemplateOptions(mappingDefinition?.$source || "");
      elements.importCharacterStage2?.classList.remove("d-none");
      // Create Character stays disabled until Stage 2's Template select has a
      // value (see the importCharacterTemplate change listener) — Template is
      // the one piece of Stage 2 data the player has no other way to set.
      // No "Fetched X" status text here — Stage 2 revealing the (editable)
      // Character Name field already shows the same information.
      if (elements.importCharacterStatus) elements.importCharacterStatus.textContent = "";
      if (elements.importCharacterName) {
        elements.importCharacterName.focus();
        elements.importCharacterName.select();
      }
    } catch (error) {
      console.error("Import Character: fetch failed", error);
      if (elements.importCharacterStatus) elements.importCharacterStatus.textContent = "";
      status.show(error.message || "Unable to fetch that character.", { type: "error", timeout: 3500 });
    } finally {
      if (elements.importCharacterFetchButton) elements.importCharacterFetchButton.disabled = false;
    }
  }

  async function createImportedCharacterFromForm() {
    if (!pendingImport) {
      status.show("Fetch a character before creating it.", { type: "warning", timeout: 2200 });
      return;
    }
    let id = pendingImport.id || "";
    const name = (elements.importCharacterName?.value || "").trim();
    const templateId = (elements.importCharacterTemplate?.value || "").trim();
    if (id && characterCatalog.has(id)) {
      // The auto-generated id collided with one created after Fetch ran
      // (e.g. another tab) — regenerate rather than asking the player to
      // fix an id they never see.
      do {
        id = generateCharacterId(name || "character");
      } while (id && characterCatalog.has(id));
      pendingImport.id = id;
    }
    if (!id) {
      status.show("Unable to generate a character ID. Try fetching again.", { type: "error", timeout: 2400 });
      return;
    }
    if (!name) {
      elements.importCharacterForm?.classList.add("was-validated");
      status.show("Provide a name for the imported character.", { type: "warning", timeout: 2000 });
      return;
    }
    if (!templateId) {
      elements.importCharacterForm?.classList.add("was-validated");
      status.show("Select a template for the imported character.", { type: "warning", timeout: 2000 });
      return;
    }
    const created = await startImportedCharacter({
      id,
      name,
      templateId,
      mappedData: pendingImport.mappedData,
      mappingId: pendingImport.mappingId,
      sourceValue: pendingImport.sourceValue,
    });
    if (!created) {
      return;
    }
    pendingImport = null;
    if (newCharacterModalInstance) {
      newCharacterModalInstance.hide();
    }
    if (elements.importCharacterForm) {
      elements.importCharacterForm.reset();
      elements.importCharacterForm.classList.remove("was-validated");
    }
  }

  async function startImportedCharacter({ id, name, templateId, mappedData, mappingId, sourceValue }) {
    const trimmedName = (name || "").trim();
    const trimmedTemplate = (templateId || "").trim();
    const trimmedId = (id || "").trim();
    if (!trimmedId || !trimmedName || !trimmedTemplate) {
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
    const initialSchema = state.template?.schema || templateMetadata?.schema || "";
    // mergeImportedCharacterData(mappedData, null) — the exact same function
    // Loom's own saveEntity uses for a first-time save (no prior record):
    // every prior.* key it would otherwise preserve resolves to undefined
    // and drops out on serialization, leaving effectively {...mappedData}.
    // id/template/systemIds/mapping/url/data are then layered on top —
    // spread after, so they always win over anything mappedData itself
    // happens to carry under those same keys — same fields
    // startNewCharacter/saveEntity both set for a freshly created character.
    const merged = mergeImportedCharacterData(mappedData, null);
    const draft = {
      ...merged,
      id: trimmedId,
      title: trimmedName,
      template: trimmedTemplate,
      systemIds: initialSchema ? [initialSchema] : [],
      mapping: mappingId,
      url: sourceValue,
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
    void refreshRelationshipsSection();
    syncCharacterActions();
    state.shareToken = "";
    clearGameLogContext();
    // url/mapping are already set on the saved character above, so the
    // existing Re-import button (workbench-character-view.js's own
    // reimportCurrentCharacter, gated purely on ownership) works on it
    // immediately with no further wiring needed anywhere.
    status.show(`Imported ${trimmedName}`, { type: "success", timeout: 2000 });
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
    state.characterOrigin = null;
    componentCounter = 0;
    currentNotesKey = "";
    state.shareToken = "";
    markCharacterClean();
    // The campaign itself didn't go away just because this one character
    // did — fall back into its own Party Data view (loadGroupPartyView
    // already handles "no Party Template assigned" gracefully) rather than
    // a fully blank screen. Only a genuinely characterless AND campaignless
    // session resets everything, matching the previous behavior exactly.
    if (gameLogContext.groupId) {
      // Post-delete conventionally lands back in view mode, same as the
      // fully-blank branch below — loadGroupPartyView itself deliberately
      // never touches state.mode (see its own comment), so that has to
      // happen here instead.
      state.mode = "view";
      await loadGroupPartyView(gameLogContext.groupId, gameLogContext.groupName);
    } else {
      state.draft = {};
      state.template = null;
      state.components = [];
      collapsedComponents.clear();
      resetSystemContext();
      state.mode = "view";
      state.partyMode = false;
      if (elements.characterSelect) {
        elements.characterSelect.value = "";
      }
      syncNotesEditor();
      renderCanvas();
      renderPreview();
      void refreshRelationshipsSection();
      syncCharacterActions();
      clearGameLogContext();
    }
    status.show(`Deleted ${label}`, { type: "success", timeout: 2200 });
    if (button) {
      button.removeAttribute("aria-busy");
    }
  }

  // Top-level keys mergeImportedCharacterData always preserves verbatim from
  // the prior record (see that function's own comment) — diffing them would
  // only ever report "no change" by construction, so they're excluded from
  // the confirmation summary rather than padding it with guaranteed no-ops.
  const REIMPORT_PRESERVED_KEYS = ["id", "template", "systemIds", "data", "url", "mapping"];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // Short, human-readable stand-in for a value in the confirmation list —
  // never the raw value itself, which for a nested stats/identity object
  // would be unreadable JSON. Arrays/objects report their own size instead
  // of contents (e.g. "3 items" → "4 items") — enough to show something
  // changed without trying to render arbitrary nested shapes as text.
  function formatReimportValue(value) {
    if (value === undefined) return "(none)";
    if (value === null) return "null";
    if (typeof value === "string") {
      if (!value.trim()) return "(empty)";
      return value.length > 40 ? `${value.slice(0, 37)}...` : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
    if (isPlainObject(value)) return "(details)";
    return String(value);
  }

  // Flat list of {path, before, after} for every leaf value that actually
  // differs between two character payloads — recurses into plain objects
  // (dotted path per nested field, e.g. "identity.level"), but treats an
  // array, or any object vs. non-object shape mismatch, as ONE leaf (its
  // own before/after summary via formatReimportValue), not exploded into
  // every index — a reordered/resized array reads as one line ("3 items →
  // 4 items"), not a confusing burst of index-by-index entries.
  function diffCharacterFields(before, after, { skipKeys = [] } = {}) {
    const changes = [];
    function walk(a, b, path) {
      if (a === b) return;
      if (isPlainObject(a) && isPlainObject(b)) {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        keys.forEach((key) => walk(a[key], b[key], path ? `${path}.${key}` : key));
        return;
      }
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      changes.push({ path, before: formatReimportValue(a), after: formatReimportValue(b) });
    }
    const topKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    topKeys.forEach((key) => {
      if (skipKeys.includes(key)) return;
      walk((before || {})[key], (after || {})[key], key);
    });
    return changes;
  }

  // The confirm modal's own body — capped at a handful of list lines (a
  // full DDB re-import can easily touch 30+ leaf fields) so the dialog
  // stays readable instead of an unreadable wall of text; the total count
  // up top still tells the whole story even when most of the list is
  // summarized away. Every value comes from imported (external, untrusted)
  // character data, so every piece goes through escapeHtml before landing
  // in this innerHTML string — `change.path` is an internal field name
  // (safe/static), but before/after are as untrusted as the rest.
  function buildReimportChangesHtml(changes) {
    if (!changes.length) {
      return `<p class="text-body-secondary mb-0">No differences found between the current character and its source — nothing would actually change.</p>`;
    }
    const MAX_LINES = 8;
    const shown = changes.slice(0, MAX_LINES);
    const remaining = changes.length - shown.length;
    const items = shown
      .map(
        (change) =>
          `<li><code>${escapeHtml(change.path)}</code>: ${escapeHtml(change.before)} → ${escapeHtml(change.after)}</li>`
      )
      .join("");
    const remainingLine =
      remaining > 0
        ? `<p class="text-body-secondary small mb-0 mt-2">…and ${remaining} more field${remaining === 1 ? "" : "s"}.</p>`
        : "";
    return `
      <p class="mb-2">This will update <strong>${changes.length}</strong> field${changes.length === 1 ? "" : "s"}:</p>
      <ul class="small mb-0">${items}</ul>
      ${remainingLine}
    `;
  }

  // "Seamless" per the user's own framing once confirmed — no separate
  // preview screen, just re-runs exactly what Loom's own saveEntity would do
  // (fetch `url` through `mapping`, merge via content-fetch.js's shared
  // mergeImportedCharacterData) directly from the sheet, but stops for a
  // confirm() first — this overwrites real character data, and the
  // confirmation's own body is the diff computed above, not just a generic
  // "are you sure?". Deliberately never touches state.draft/state.character,
  // or even calls save, until AFTER that confirmation — canceling, or any
  // failure along the way (the fetch, the mapping, the merge fetch, the save
  // itself), leaves this editor showing exactly what it was showing before
  // the click, per the user's own explicit "character just isn't updated"
  // requirement.
  async function reimportCurrentCharacter() {
    const id = state.draft?.id;
    const url = state.draft?.url;
    const mapping = state.draft?.mapping;
    if (!id || !url || !mapping) return;
    const label = state.draft.name || characterCatalog.get(id)?.title || id;
    const button = elements.reimportCharacterButton;
    const resetButton = () => {
      if (!button) return;
      button.disabled = false;
      button.classList.remove("disabled");
      button.setAttribute("aria-disabled", "false");
    };
    if (button) {
      button.disabled = true;
      button.classList.add("disabled");
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-busy", "true");
    }
    try {
      const freshData = await reimportViaMapping(mapping, url, dataManager);
      // preferLocal: false — diff and merge against the record's real
      // current state on the server, not this browser's own possibly-stale
      // copy or any unsaved edits sitting in state.draft right now; a stale
      // base here could silently clobber a change made elsewhere since this
      // editor last loaded the character, and would show the wrong diff too.
      // Same reasoning as Loom's own saveEntity.
      const existing = await dataManager.get("character", id, { preferLocal: false });
      const priorPayload = existing?.payload || {};
      const merged = mergeImportedCharacterData(freshData, priorPayload);
      const changes = diffCharacterFields(priorPayload, merged, { skipKeys: REIMPORT_PRESERVED_KEYS });
      const confirmed = await showConfirmModal({
        title: `Re-import "${label}"?`,
        bodyHtml: `<p>This overwrites the character's current data with a fresh fetch from its original source.</p>${buildReimportChangesHtml(changes)}`,
        confirmLabel: "Re-import",
        cancelLabel: "Cancel",
      });
      if (!confirmed) {
        status.show("Re-import cancelled.", { type: "info", timeout: 2000 });
        resetButton();
        return;
      }
      await dataManager.save("character", id, merged);
      status.show(`Re-imported ${merged.name || label}.`, { type: "success", timeout: 2200 });
      // loadCharacter's own syncCharacterActions call recomputes this
      // button's disabled/hidden state fresh — nothing here needs to
      // restore it manually on success, only aria-busy (see finally below).
      await loadCharacter(id);
    } catch (error) {
      console.error("Character editor: unable to re-import character", error);
      status.show(error?.message ? `Unable to re-import: ${error.message}` : "Unable to re-import this character.", {
        type: "danger",
        timeout: 4000,
      });
      resetButton();
    } finally {
      if (button) button.removeAttribute("aria-busy");
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
    // A record's own id is filename/library_items metadata, not editable
    // content — never persisted in the body (same convention Location/
    // Setting/Journal already had; Feature/Wonder's embedded id and
    // Monster's "index" were both cleaned up as pure historical drift, and
    // this is the one spot in this file where a `state.draft.id` set by
    // duplicateCharacter()/mergeImportedCharacterData's own in-memory
    // convenience stamping would otherwise leak into a saved file). Deleted
    // from this CLONE only — state.draft.id itself stays populated for
    // every other in-memory read in this module.
    delete payload.id;
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

  // Driven by the outer suite-wide View toggle (createCycleToggleButton,
  // see workbench.js's own setSubView).
  async function setMode(nextMode) {
    if (state.viewLocked) return;
    if (nextMode !== "view" && nextMode !== "edit") return;
    if (state.mode === nextMode) return;
    if (state.mode === "edit" && state.draft?.id) {
      await persistDraft({ silent: true });
      renderPreview();
    }
    state.mode = nextMode;
    renderCanvas();
    syncCharacterActions();
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
    // Party Data mode (no character) keys Notes by campaign instead of the
    // generic "session" bucket, so switching between different campaigns'
    // Party Data doesn't collide/overwrite a shared Notes entry. Checks
    // state.partyMode, not just state.groupContext's presence — see its own
    // comment on state for why those two aren't the same thing.
    const id = state.draft?.id || (state.partyMode && state.groupContext ? `party:${state.groupContext.groupId}` : "session");
    return `undercroft.workbench.character.notes.${id}`;
  }

  // --- Relationships -----------------------------------------------------
  //
  // The active character's own target-kind whitelist and type-suggestion
  // vocabulary for the shared relationship-editor.js/relationship-graph.js
  // modules — see that pair's own header comments for the full suite-wide
  // mechanism, and Forge's own app.js for the first tool this pattern
  // shipped on. Reputation tracking lands here: `type: "Reputation with"`,
  // target a Faction NPC, `value` holds whatever standing the GM sets.
  const RELATIONSHIP_TARGET_KINDS = [
    { id: "npc", label: "NPC" },
    { id: "location", label: "Location" },
    { id: "monster", label: "Monster" },
    { id: "character", label: "Character" },
  ];
  const RELATIONSHIP_TYPE_SUGGESTIONS = [
    "Ally of",
    "Rival of",
    "Mentor",
    "Family",
    "Reputation with",
  ];

  let relationshipsForceGraph = null;
  let relationshipsIconByKind = {};

  function ensureRelationshipsForceGraph() {
    if (relationshipsForceGraph || !elements.relationshipsGraphContainer) return relationshipsForceGraph;
    relationshipsForceGraph = createForceGraph({
      container: elements.relationshipsGraphContainer,
      content: elements.relationshipsGraphContent,
      svg: elements.relationshipsGraphSvg,
      emptyMount: elements.relationshipsGraphEmpty,
      getNodeRadius: (node) => (node.kind === "character" && node.id === `character:${state.draft?.id}` ? 20 : 14),
      getNodeIcon: (node) => relationshipsIconByKind?.[node.kind] || null,
      getEdgeLabel: (edge) => edge.type || null,
      classPrefix: "relationship-graph",
      emptyIcon: "tabler:affiliate",
      emptyMessage: "No relationships yet.",
      defaultZoom: 1.4,
    });
    elements.relationshipsGraphControls?.addEventListener("pointerdown", (event) => event.stopPropagation());
    [
      { icon: "tabler:zoom-out", label: "Zoom out", onClick: () => relationshipsForceGraph.zoomBy(-0.25) },
      { icon: "tabler:refresh", label: "Reset zoom", onClick: () => relationshipsForceGraph.reset() },
      { icon: "tabler:zoom-in", label: "Zoom in", onClick: () => relationshipsForceGraph.zoomBy(0.25) },
    ].forEach((config) => elements.relationshipsGraphToolbarMount?.appendChild(createIconButton(config)));
    return relationshipsForceGraph;
  }

  async function refreshRelationshipsList() {
    if (!elements.relationshipsListMount) return;
    // No character loaded (Party Data mode — loadGroupPartyView's own
    // state.draft = {}) — clear rather than leave a stale prior
    // character's own relationships on screen.
    if (!state.draft?.id) {
      elements.relationshipsListMount.innerHTML =
        '<p class="small text-body-secondary mb-0">Select a character to see its relationships.</p>';
      return;
    }
    await renderRelationshipEditor({
      container: elements.relationshipsListMount,
      sourceKind: "character",
      sourceId: state.draft.id,
      targetKinds: RELATIONSHIP_TARGET_KINDS,
      typeSuggestions: RELATIONSHIP_TYPE_SUGGESTIONS,
      dataManager,
      status,
      onChange: () => {
        void refreshRelationshipsList();
        void refreshRelationshipsGraph();
      },
    });
  }

  async function refreshRelationshipsGraph() {
    const forceGraph = ensureRelationshipsForceGraph();
    if (!forceGraph || !state.draft?.id) return;
    try {
      const { nodes, edges, iconByKind } = await buildRelationshipGraph(dataManager, {
        nodes: [{ kind: "character", id: state.draft.id, label: state.draft.name || state.draft.title || state.draft.id }],
      });
      relationshipsIconByKind = iconByKind;
      forceGraph.setGraph({ nodes, edges });
    } catch (error) {
      status?.show?.("Unable to build the Relationships graph.", { type: "error" });
    }
  }

  // Called whenever the ACTIVE character changes (loadCharacter/
  // startNewCharacter/the Import Character flow) — not on every
  // renderPreview() (dozens of call sites, most just re-rendering an
  // in-progress edit to the same character), which would re-fetch the
  // relationship list far more often than the data could plausibly change.
  async function refreshRelationshipsSection() {
    await refreshRelationshipsList();
    void refreshRelationshipsGraph();
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
  // it elsewhere) should immediately follow it — the dropdown is now
  // syncGameLogContext's sole source of truth for the signed-in-user case,
  // not just a fallback.
  window.addEventListener("workbench:active-group-changed", () => {
    void syncGameLogContext();
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
    // Read by workbench.js's own renderEmptyState — the Mode/View header's
    // inline empty-state message shows only while Mode=Character AND no
    // character is loaded yet, same draftHasId check syncCharacterActions
    // itself already uses.
    hasActiveCharacter: () => Boolean(state.draft?.id),
    // Read by workbench.js's setMode when switching from Character to
    // Template mode, to auto-load whichever template this character is
    // actually built on (state.draft.template — the same field
    // reloadTemplateIfActive above already checks).
    getActiveTemplateId: () => state.draft?.template || null,
  };
}
