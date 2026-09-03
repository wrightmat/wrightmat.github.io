import { populateSelect } from "../lib/dropdown.js";
import { createCanvasPlaceholder } from "../lib/editor-canvas.js";
import {
  createCanvasCardElement,
  createCollapseToggleButton,
  createStandardCardChrome,
} from "../lib/canvas-card.js";
import { setElementCollapsed, bindCollapsibleToggle } from "../../../common/js/lib/collapsible.js";
import { createJsonDataPanel, createCollapsibleSection, createIconButton, createCompactField, createToolbarButtonGroup } from "../../../common/js/lib/ui-components.js";
import { escapeHtml } from "../../../common/js/lib/auth-ui.js";
import { disposeTooltips, refreshTooltips, setDisabledTooltip, initTooltip } from "../../../common/js/lib/tooltips.js";
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
import { renderTextContent, renderImageContent, resolveImageUrl, renderIconContent, renderContainerContent, renderInputContent, renderLinearTrackContent, renderCircularTrackContent, renderSelectGroupContent, renderToggleContent, toggleStateEntryFromRaw, excludeToggleWrapperColors, isReferenceValue } from "../lib/component-renderers.js";
import { loadCustomFonts, DEFAULT_FONT_FAMILY } from "../../../common/js/lib/font-library.js";
import { evaluateFormula } from "../../../common/js/lib/formula-engine.js";
import { resolveBinding, createLookupFn, createLookupFieldFn, findRoleBoundField, findBindingByRole, fieldByKey } from "../../../common/js/lib/bindings.js";
// Same name-or-id macro resolver Board and Journal's inline `macro:Name` chips use.
import { runMacroReference } from "../../../repository/js/lib/journal-macro.js";
import { resolveDottedPath } from "../../../common/js/lib/dotted-path.js";
import { evaluateDerivedFormula } from "../../../common/js/lib/derived-formulas.js";
import { loadAbilityFieldDefs, loadArrayFieldValues, guessAbilityFieldKey } from "../../../common/js/lib/generator-kit.js";
import {
  findLevelUpBinding,
  resolveGrantChoices,
  matchFeaturesAtLevel,
  resolveChoiceList,
  resolveEquipmentChoice,
  applyEquipmentBundle,
  applyProficiencyGrant,
  getSubclassGrantLevel,
  grantSubclassFeaturesAtLevel,
  describeMulticlassPrerequisites,
  characterMeetsMulticlassPrerequisites,
  computeSpellSlots,
  mergeLimitedUses,
} from "../../../common/js/lib/level-up-bindings.js";
import { rollDiceExpression } from "../lib/dice.js";
import { rollExpression, resolveQuickDice, parseQuickDiceCounts, incrementDieInExpression, extractSystemRolls, extractSystemSymbolDice, rollSymbolPoolExpression } from "../../../common/js/lib/widgets/dice-roll.js";
import { fetchKindEntriesWithIds } from "../../../common/js/lib/content-fetch.js";
import {
  promoteEmbeddedFeatures,
  hasEmbeddedFeatures,
  linkCharacterSpellReferences,
  linkCharacterInventoryReferences,
  linkCharacterSpeciesClassReferences,
} from "../../../common/js/lib/content-feature-matching.js";
import { resolveNotes } from "../../../common/js/lib/library-reference.js";
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

// The Character mode of Workbench's unified page (js/pages/workbench.js owns
// the shared initAppShell/status/undoStack/DataManager/auth/help). state.mode
// ("view"/"edit") is driven by the outer suite-wide View toggle, not an
// in-page button.
export async function initCharacterView({ status, undoStack, dataManager, onStateChange, onRequestEditMode }) {
  // Warm up the 3D dice overlay now rather than on first roll click.
  preloadDiceOverlay(dataManager);

  const templateCatalog = new Map();
  const characterCatalog = new Map();
  // Owned + member campaigns, offered in the character picker's own
  // "Campaigns" optgroup for Party Data mode (loadGroupPartyView).
  const groupCatalog = new Map();
  const systemCatalog = new Map();
  const systemDefinitionCache = new Map();

  function sessionUser() {
    return dataManager.session?.user || null;
  }

  // Every reserved-key System field (derivedFormulas, buildSteps, dice, ...)
  // lives as an entry inside `fields`, never a flat top-level property —
  // reads it correctly via fieldByKey rather than a direct property access.
  function systemFieldValues(systemDefinition, key) {
    const values = fieldByKey(systemDefinition?.fields, key)?.values;
    return Array.isArray(values) ? values : [];
  }

  const state = {
    mode: "view",
    template: null,
    components: [],
    character: null,
    // {} rather than null when nothing's loaded — Party Data mode also
    // leaves this at {} (never a real character), so `characterAllowsEdits`
    // only has one "empty" sentinel to check.
    draft: {},
    characterOrigin: null,
    systemDefinition: null,
    systemPreviewData: {},
    viewLocked: false,
    shareToken: "",
    // The active campaign's Group Properties, merged into the binding
    // context under "group" (see getBindingContext) so "group.partyInventory"
    // resolves like any ordinary binding. Never written into `draft` itself
    // — that's what gets persisted as the character's saved JSON.
    groupContext: null,
    // True only when loadGroupPartyView explicitly set this up — groupContext
    // itself gets populated ambiently for any active campaign (so Game
    // Log/Now Showing can follow it) whether or not Party Data was chosen.
    // Anything gating "are we showing Party Data right now" must check this
    // flag, not groupContext, or it flashes/restores state no one chose.
    partyMode: false,
  };

  let lastSavedCharacterSignature = null;

  const componentRollDirectives = new Map();
  const collapsedComponents = new Map();
  const diceQuickButtons = new Map();
  // Dice pane's quick-dice source: the active campaign Group's own System
  // wins over the character's own Assigned Systems, else the standard 7.
  // Starts at the standard-7 default; refreshDiceAndMoveButtons() (called
  // once group/System context resolves) rebuilds with the real answer.
  let activeQuickDice = resolveQuickDice({});
  const moveButtons = new Map();
  // Dice pane's named Rolls/Moves — same resolution as activeQuickDice,
  // empty until refreshDiceAndMoveButtons resolves. A System with no
  // "rolls" field just never shows this row.
  let activeSystemRolls = [];
  // Tier-3 symbol dice — mutually exclusive with the standard quick-dice/
  // expression/Moves UI: a narrative-dice System (Genesys) has no numeric
  // expression worth typing, so its presence swaps the whole panel over to
  // the stepper below. Same "resolved in refreshDiceAndMoveButtons" pattern.
  let activeSymbolDice = [];
  const symbolPoolCounts = new Map();
  // Which tab is showing per Tabs Container, keyed by component.uid — lives
  // outside the component object since components are deep-cloned on every
  // data change and wouldn't survive re-renders otherwise.
  const containerActiveTabs = new Map();

  // Just "which campaign, if any, is in view" — actual render/poll state
  // lives inside the shared widget instances mounted below (gameLogWidget,
  // nowShowingWatcher/nowShowingPanel — the Dashboard's own widgets, reused
  // rather than reimplemented; see setGameLogContext/clearGameLogContext).
  const gameLogContext = {
    groupId: "",
    groupName: "",
    shareToken: "",
    systemId: "",
    access: "none",
    members: [],
    ownerId: null,
  };
  // {refresh,destroy}/{refresh,stop,...} widget instances — none have an
  // "update groupId" method, so a campaign change destroys and recreates
  // them rather than mutating in place (see setGameLogContext/
  // clearGameLogContext).
  let gameLogWidget = null;
  let groupWatcher = null;
  let nowShowingWatcher = null;
  // Built once elements.nowShowingContent exists, a few lines below.
  let nowShowingPanel = null;
  let lastActiveNowShowingEntries = [];
  let knownNowShowingKeys = new Set();
  // Same fetch-once-cache-then-rerender lookup dashboard.js's spotlight
  // panel/Game Log use — see spotlight.js's createSpotlightTitleCache.
  const spotlightTitleCache = createSpotlightTitleCache(dataManager, () => gameLogContext.shareToken);

  markCharacterClean();

  let suppressNotesChange = false;
  let currentNotesKey = "";
  let componentCounter = 0;
  const initialRecordParam = parseRecordParam();
  // Accepts both the legacy plural bucket ("characters") this file's own
  // save/load calls use and the canonical singular one every other deep-link
  // builder in the suite uses (character-summary.js, share-modal.js, ...).
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
  const characterPropertiesState = { collapsed: true };
  const dicePanelState = { collapsed: false };
  const gameLogPanelState = { collapsed: false };
  const nowShowingPanelState = { collapsed: false };
  // Assigned once each section is built below (createCollapsibleSection's
  // setCollapsed) so the setXCollapsed functions further down can drive
  // them programmatically.
  let applyNotesCollapse = () => {};
  let applyCharacterPropertiesCollapse = () => {};
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
    // "classes[0].name" -> "classes.0.name" — same fix as dotted-path.js's
    // resolveDottedPath, needed since getValueAtContext/setValueAtContext
    // walk these segments via plain property access.
    const segments = normalized
      .slice(1)
      .replace(/\[(\d+)\]/g, ".$1")
      .split(".")
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments.length ? segments : null;
  }

  // Rooted against the full draft record, not a `.data` sub-bucket — a
  // record's real fields and a template author's freeform fields
  // (@data.whatever) are both just paths into the same record.
  // Context-agnostic: getValueAtPath/setValueAtPath below are thin wrappers
  // for the default Character case; group.* bindings read/write against
  // state.groupContext.values through these same two functions, so there's
  // one path-walking implementation, not two.
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

  // Merges the active campaign's Group Properties into the same context a
  // plain "@inventory" binding resolves against, under "group" — so
  // "@group.partyInventory.quantity" walks the same resolveBinding/
  // getValueAtPath machinery, no new binding vocabulary needed. Derived and
  // read-only; never written into state.draft (what gets persisted).
  function getBindingContext() {
    return { ...state.draft, group: state.groupContext?.values || {} };
  }

  // Edit view is dirty-gated like Template view and Loom (explicit Save
  // button, see syncCharacterActions/hasUnsavedCharacterChanges) — no
  // autosave on every change. Leaving Edit mode still force-persists as a
  // safety net.
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

  // replaceWith, not appendChild — an appended-into wrapper stays an
  // empty-but-in-flow flex item even while its field is conditionally
  // hidden, spending a full gap-3 on both sides (see press/js/app.js's
  // mountInspectorField). The mount div's own classes are merged onto the
  // built field first so removing the wrapper doesn't lose that layout.
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
  mountField("build-character-name", createCompactField({ type: "text", id: "build-character-name", label: "Character Name", dataAttr: "data-build-character-name", name: "name", required: true, placeholder: "e.g. Elandra" }));
  // Generic, not Daggerheart-specific — any System's character could
  // declare a `pronouns` field.
  mountField("build-character-pronouns", createCompactField({ type: "text", id: "build-character-pronouns", label: "Pronouns", dataAttr: "data-build-character-pronouns", name: "pronouns", placeholder: "e.g. she/her" }));
  mountField(
    "build-character-template",
    createCompactField({ type: "select", id: "build-character-template", label: "Template", controlClass: "form-select", dataAttr: "data-build-character-template", name: "template", required: true })
  );
  mountField(
    "build-character-image",
    createCompactField({ type: "text", id: "build-character-image", label: "Image URL", dataAttr: "data-build-character-image", name: "image", placeholder: "https://…" })
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
    addCharacterModeBuild: document.querySelector('[data-add-character-mode="build"]'),
    addCharacterSubmitBlank: document.querySelector('[data-add-character-submit="blank"]'),
    addCharacterSubmitImport: document.querySelector('[data-add-character-submit="import"]'),
    addCharacterSubmitBuild: document.querySelector('[data-add-character-submit="build"]'),
    buildWizard: document.querySelector("[data-build-wizard]"),
    buildStepLabel: document.querySelector("[data-build-step-label]"),
    buildCharacterName: document.querySelector("[data-build-character-name]"),
    buildCharacterPronouns: document.querySelector("[data-build-character-pronouns]"),
    buildCharacterTemplate: document.querySelector("[data-build-character-template]"),
    buildUnsupportedMessage: document.querySelector("[data-build-unsupported-message]"),
    buildCharacterImage: document.querySelector("[data-build-character-image]"),
    buildSpeciesMount: document.querySelector("[data-build-species-mount]"),
    buildClassMount: document.querySelector("[data-build-class-mount]"),
    buildSubclassMount: document.querySelector("[data-build-subclass-mount]"),
    buildBackgroundMount: document.querySelector("[data-build-background-mount]"),
    buildMixedAncestryCheckbox: document.querySelector("[data-build-mixed-ancestry]"),
    buildMixedAncestryStep: document.querySelector("[data-build-mixed-ancestry-step]"),
    buildSecondSpeciesStep: document.querySelector("[data-build-second-species-step]"),
    buildHeritageSecondPickLabel: document.querySelector("[data-build-heritage-second-pick-label]"),
    buildSecondSpeciesMount: document.querySelector("[data-build-second-species-mount]"),
    buildHeritageSpeciesMount: document.querySelector("[data-build-heritage-species-mount]"),
    buildHeritageBackgroundMount: document.querySelector("[data-build-heritage-background-mount]"),
    buildAbilitiesMount: document.querySelector("[data-build-abilities-mount]"),
    buildInputMount: document.querySelector("[data-build-input-mount]"),
    // One mount per pointAllocation USAGE (step id), not per step TYPE —
    // BitD's Actions step and CoC's Occupation Skills/Personal Interest
    // steps each need their own panel despite sharing the same mechanism.
    buildPointAllocationMounts: {
      actionDots: document.querySelector("[data-build-point-allocation-mount='actionDots']"),
      occupationSkills: document.querySelector("[data-build-point-allocation-mount='occupationSkills']"),
      personalInterest: document.querySelector("[data-build-point-allocation-mount='personalInterest']"),
    },
    // One mount per listPick USAGE (step id), not per step TYPE — a wizard
    // can declare more than one listPick step, each needing its own panel.
    buildListPickMounts: {
      specialAbility: document.querySelector("[data-build-listpick-mount='specialAbility']"),
      friendRival: document.querySelector("[data-build-listpick-mount='friendRival']"),
      crewUpgrades: document.querySelector("[data-build-listpick-mount='crewUpgrades']"),
      favoriteContact: document.querySelector("[data-build-listpick-mount='favoriteContact']"),
      vice: document.querySelector("[data-build-listpick-mount='vice']"),
      reputation: document.querySelector("[data-build-listpick-mount='reputation']"),
      favoredOperation: document.querySelector("[data-build-listpick-mount='favoredOperation']"),
    },
    buildReviewMount: document.querySelector("[data-build-review-mount]"),
    buildResolveMount: document.querySelector("[data-build-resolve-mount]"),
    buildBackButton: document.querySelector("[data-build-back]"),
    buildNextButton: document.querySelector("[data-build-next]"),
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
    characterPropertiesSection: document.querySelector("[data-character-properties-section]"),
    characterPropertiesPanel: document.querySelector("[data-character-properties-panel]"),
    characterPropertiesToolbarMount: document.querySelector("[data-character-properties-toolbar-mount]"),
    pendingChoicesMount: document.querySelector("[data-pending-choices-mount]"),
    levelUpModalEl: document.getElementById("level-up-modal"),
    levelUpModalBody: document.querySelector("[data-level-up-modal-body]"),
    levelUpCancelButton: document.querySelector("[data-level-up-cancel]"),
    levelUpConfirmButton: document.querySelector("[data-level-up-confirm]"),
    addClassModalEl: document.getElementById("add-class-modal"),
    addClassModalBody: document.querySelector("[data-add-class-modal-body]"),
    addClassCancelButton: document.querySelector("[data-add-class-cancel]"),
    addClassConfirmButton: document.querySelector("[data-add-class-confirm]"),
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
    // The mode-gate lives on the OUTER section (workbench.js's own
    // applyPanelVisibility); this INNER wrapper is what renderGroupSharePanel
    // shows/hides for relevance — two independent toggles, deliberately
    // separate elements so they never fight over the same node.
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

  // Mounted inline (floating: false), unlike the Dashboard's identical
  // floating corner overlay — see spotlight-panel.js's createSpotlightPanel.
  nowShowingPanel = createSpotlightPanel({ container: elements.nowShowingContent, floating: false });

  // Notes/Dice/Now Showing/Group Share each get a full createCollapsibleSection;
  // Game Log keeps its Refresh-button sibling, so only its toggle is built
  // via createIconButton + bindCollapsibleToggle directly.
  // Keeps a state object's `.collapsed` in sync after a factory-built
  // toggle's own click (which handles show/hide internally, no hook to
  // observe) — registered after the toggle so it fires after
  // bindCollapsibleToggle's own listener (same-element order).
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
  if (elements.characterPropertiesPanel) {
    const characterPropertiesSectionBuilt = createCollapsibleSection({
      label: "Character Properties",
      collapsed: characterPropertiesState.collapsed,
      content: elements.characterPropertiesPanel,
    });
    document.querySelector("[data-character-properties-mount]")?.appendChild(characterPropertiesSectionBuilt.section);
    applyCharacterPropertiesCollapse = characterPropertiesSectionBuilt.setCollapsed;
    syncCollapsedStateOnClick(characterPropertiesSectionBuilt.toggle, characterPropertiesState);
    // Same shape as Forge/Crucible's own NPC/Monster Properties toolbar —
    // an own-named right-pane section, not the primary toolbar. Always
    // visible (setDisabledTooltip, not d-none) so an unavailable action
    // reads as "disabled, here's why" rather than silently vanishing.
    createToolbarButtonGroup([
      {
        icon: "tabler:arrow-big-up-lines",
        label: "Level Up",
        disabled: true,
        attrs: { "data-level-up-character": true },
      },
      {
        icon: "tabler:stack-2",
        label: "Add a Class",
        disabled: true,
        attrs: { "data-add-class-character": true },
      },
      {
        icon: "tabler:cloud-download",
        label: "Re-import",
        disabled: true,
        attrs: { "data-reimport-character": true },
      },
    ]).forEach((button) => elements.characterPropertiesToolbarMount?.appendChild(button));
    elements.levelUpButton = document.querySelector("[data-level-up-character]");
    elements.levelUpButton?.addEventListener("click", () => void openLevelUpModal());
    elements.addClassButton = document.querySelector("[data-add-class-character]");
    elements.addClassButton?.addEventListener("click", () => void openAddClassModal());
    elements.levelUpConfirmButton?.addEventListener("click", () => {
      if (levelUpStage === "resolve") {
        levelUpModalInstance?.hide();
        return;
      }
      if (advancementMenuState) {
        void applyAdvancementMenu();
        return;
      }
      void applyLevelUp();
    });
    elements.addClassConfirmButton?.addEventListener("click", () => {
      if (addClassStage === "resolve") {
        addClassModalInstance?.hide();
        return;
      }
      void applyAddClass();
    });
    elements.reimportCharacterButton = document.querySelector("[data-reimport-character]");
    elements.reimportCharacterButton?.addEventListener("click", () => {
      void reimportCurrentCharacter();
    });
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
      // Group Share's click needs bespoke gating (blocked without an active
      // share token) and a post-expand re-render, so it keeps its own
      // explicit click handler below rather than the factory's auto-toggle.
      autoBindToggle: false,
    });
    document.querySelector("[data-group-share-mount]")?.appendChild(groupShareSectionBuilt.section);
    elements.groupShareToggle = groupShareSectionBuilt.toggle;
    applyGroupShareCollapse = groupShareSectionBuilt.setCollapsed;
    // Establishes the initial hidden state — every other call to this is
    // reactive (pending-share-token flow, a claim/refresh), so the common
    // case (no share token) would otherwise never call it at all.
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
  setCharacterPropertiesCollapsed(true);
  setGroupShareCollapsed(groupShareState.collapsed);
  setDiceCollapsed(false);
  setNowShowingCollapsed(false);
  setGameLogCollapsed(false);

  // Single modal shared by the "blank" and "import" ways to add a character
  // — a mode toggle inside it swaps which form/footer-button shows (see
  // setAddCharacterMode), since a separate Import toolbar button would
  // exceed the six-button toolbar limit (undercroft/README.md).
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
  // No Font field of its own to lazily load a custom/Google font the way the
  // Template editor does, so this must populate the shared library up front
  // (applyTextFormatting/findFontOptionByFamily in component-styles.js).
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
  // Covers the one case no other path into the game log handles: a GM who
  // opens Workbench with no character loaded and no share link, relying
  // solely on their active-campaign selection (syncGameLogContext's fallback).
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

    // Auto-saves as soon as a bound field is committed by leaving it (not on
    // every keystroke — the per-keystroke `input` listeners still just
    // update state.draft in memory) so a long edit session can't sit
    // unsaved indefinitely. One delegated listener since canvasRoot
    // persists across renderCanvas()'s innerHTML rebuilds; `focusout`
    // bubbles, unlike `blur`, which is what makes this work container-wide.
    if (elements.canvasRoot) {
      elements.canvasRoot.addEventListener("focusout", (event) => {
        const target = event.target.closest?.("[data-binding-path]");
        if (!target) return;
        // A disabled/read-only control can't receive focus/input at all, so
        // reaching here already means editing is allowed — no need to
        // re-derive that.
        if (target.disabled || target.readOnly) return;
        // renderCanvas() rebuilds the DOM on every keystroke, destroying and
        // recreating the field being typed into then synchronously
        // restoring focus (restoreActiveField) — a transient internal blur,
        // not the user leaving the field. Deferred one tick so
        // document.activeElement reflects where focus actually lands.
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

    if (elements.addCharacterModeBuild) {
      elements.addCharacterModeBuild.addEventListener("click", () => {
        setAddCharacterMode("build");
      });
    }

    if (elements.buildBackButton) {
      elements.buildBackButton.addEventListener("click", () => goToBuildStep(buildWizardState.step - 1));
    }
    if (elements.buildNextButton) {
      elements.buildNextButton.addEventListener("click", () => {
        const step = getActiveBuildSteps().steps[buildWizardState.step];
        if (step === "choices") {
          void finishBuildChoicesStep();
        } else if (step === "review") {
          void submitBuildWizard();
        } else {
          goToBuildStep(buildWizardState.step + 1);
        }
      });
    }
    if (elements.buildCharacterName) {
      elements.buildCharacterName.addEventListener("input", () => updateBuildNextState());
    }
    if (elements.buildCharacterTemplate) {
      elements.buildCharacterTemplate.addEventListener("change", () => {
        void applyBuildTemplateSelection();
      });
    }
    document.querySelectorAll("[data-build-ability-method]").forEach((button) => {
      button.addEventListener("click", () => {
        buildWizardState.abilityMethod = button.dataset.buildAbilityMethod;
        buildWizardState.abilityScores = {};
        renderBuildAbilitiesStep();
        updateBuildNextState();
      });
    });
    elements.buildMixedAncestryCheckbox?.addEventListener("change", () => {
      buildWizardState.mixedAncestry = Boolean(elements.buildMixedAncestryCheckbox.checked);
      if (!buildWizardState.mixedAncestry) {
        buildWizardState.secondSpeciesId = "";
        buildWizardState.secondSpeciesName = "";
      }
      setElementVisible(elements.buildSecondSpeciesStep, buildWizardState.mixedAncestry);
      updateBuildNextState();
    });

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

    // Notes/Dice/Game Log/Now Showing need no click handler here — their
    // factory-built toggles flip on click internally, with
    // syncCollapsedStateOnClick keeping state in sync. Group Share keeps
    // its own handler since its click needs bespoke gating.
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

  function setCharacterPropertiesCollapsed(collapsed) {
    const next = Boolean(collapsed);
    characterPropertiesState.collapsed = next;
    applyCharacterPropertiesCollapse(next);
  }

  function expandCharacterPropertiesSection() {
    setCharacterPropertiesCollapsed(false);
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
    // Network first, local only as an offline fallback — a System is edited
    // often, so a stale local cache must never win over a reachable server.
    // Same reasoning as fetchTemplate/fetchCharacterPayload below.
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
      // An untemplated character (e.g. Loom's DDB import) is included,
      // labeled "(No template)" — selecting it opens renderCanvas's own
      // createUntemplatedCharacterPrompt instead of a sheet.
      .filter((entry) => entry.id)
      .map((entry) => {
        const templateId = entry.template || "";
        const templateLabel = templateId ? templateCatalog.get(templateId)?.title || templateId : "No template";
        const baseLabel = entry.title || entry.id;
        const label = `${baseLabel} (${templateLabel})`;
        return { value: entry.id, label, sortLabel: label.toLowerCase() };
      })
      .sort((a, b) => a.sortLabel.localeCompare(b.sortLabel, undefined, { sensitivity: "base" }));
    // Party Data campaigns get a separate optgroup, "group:<id>" values so
    // they can't collide with a real character id. groupName is stashed on
    // the option itself so the change handler avoids a second lookup.
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
    // ambiently for any active campaign regardless of whether Party Data
    // was ever opened, so using it here would show a campaign "selected"
    // on a fresh page load nobody actually picked.
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
    // Each select keeps its own current selection (captured before
    // populateSelect wipes it) rather than sharing `selectedValue` —
    // registerTemplateRecord only knows the New Character modal's
    // selection, so without this an in-progress Build wizard's Template
    // select would go blank underneath the user.
    const newCharacterSelected = selectedValue || elements.newCharacterTemplate.value || "";
    populateSelect(elements.newCharacterTemplate, options, { placeholder: "Select template" });
    if (newCharacterSelected) {
      elements.newCharacterTemplate.value = newCharacterSelected;
    }
    // Build mode's own Template select shares this refresh rather than a
    // second near-identical function.
    if (elements.buildCharacterTemplate) {
      const buildSelected = elements.buildCharacterTemplate.value || selectedValue || "";
      populateSelect(elements.buildCharacterTemplate, options, { placeholder: "Select template" });
      if (buildSelected) {
        elements.buildCharacterTemplate.value = buildSelected;
      }
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
    // Called after every load/New/Save/Delete/clear — also how workbench.js's
    // empty-state message learns a character became active/inactive.
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
      button.setAttribute("aria-disabled", nextDisabled ? "true" : "false");
      // setDisabledTooltip owns the disabled-state explanation on a
      // separate wrapper, since a real `disabled` attribute blocks hover on
      // the button itself (see tooltips.js). initTooltip owns the button's
      // own ready-state tooltip, live only while enabled.
      setDisabledTooltip(button, nextDisabled ? disabledTitle || button.dataset.disabledTitle || "" : "");
      initTooltip(button, {
        title: nextDisabled ? "" : enabledTitle || button.dataset.defaultTitle || defaultTitle || "",
      });
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
    // the source record — duplicating writes a brand new record and never
    // touches the one being copied.
    updateToolbarButton(elements.duplicateCharacterButton, {
      disabled: !draftHasId || locked || !canWrite,
      disabledTitle: !draftHasId
        ? "Select a character first."
        : locked
        ? "Group characters must be claimed before duplicating."
        : "You don't have permission to create characters.",
    });

    // Only meaningful for a character carrying import metadata (loom/js/
    // app.js's saveEntity sets it when a mapping produced the content).
    // Gated on character owner, campaign owner, or admin — deliberately
    // wider than canEditRecord, since a campaign GM may lack an explicit
    // edit-share on a player's character but should still be able to
    // re-import to keep the party's sheets current. The server's own
    // ownership/share check has final say on the actual save; this only
    // decides whether the button shows.
    if (elements.reimportCharacterButton) {
      const isAdminForReimport = dataManager.getUserTier() === "admin";
      const hasReimportSource = Boolean(state.draft?.url) && Boolean(state.draft?.mapping);
      const hasReimportPermission =
        isAdminForReimport || (draftHasId && userOwnsCharacter(state.draft.id)) || gameLogContext.access === "owner";
      const showReimport =
        draftHasId && hasReimportSource && hasReimportPermission && canWrite && !locked && state.mode === "edit";
      // Always visible (not d-none-toggled) — setDisabledTooltip explains
      // an unavailable state instead of the button just vanishing.
      updateToolbarButton(elements.reimportCharacterButton, {
        disabled: !showReimport,
        disabledTitle: !draftHasId
          ? "Select a character first."
          : !hasReimportSource
            ? "This character wasn't imported from an external source."
            : !hasReimportPermission
              ? "You don't have permission to re-import this character."
              : locked
                ? "Group characters must be claimed before re-importing."
                : !canWrite
                  ? "You don't have permission to re-import this character."
                  : "Switch to Edit mode to re-import.",
        enabledTitle: "Re-fetch this character from its original source.",
      });
    }

    refreshCharacterPropertiesPanel({ draftHasId, canWrite, canEditRecord, locked });

    if (!elements.deleteCharacterButton) {
      return;
    }
    // Delete Character lives in the shared left-pane toolbar, not a
    // standalone data-workbench-mode-panel button (that class is owned by
    // workbench.js's applyPanelVisibility, which runs last) — so "only in
    // Edit view" is folded into this check via document.body.dataset.
    // workbenchMode directly. This function is exported so workbench.js's
    // setMode calls it on every mode/view switch, not just the ones it
    // covers natively — otherwise switching Character/Edit to Template left
    // the button visible.
    //
    // Delete is deliberately wider than canEditRecord: an admin can delete
    // any character regardless of ownership, but only the actual owner
    // gets to edit/save it.
    const isAdmin = dataManager.getUserTier() === "admin";
    const canDeleteRecord = draftHasId && (isAdmin || canEditRecord);
    const showDelete =
      canDeleteRecord && canWrite && state.mode === "edit" && document.body.dataset.workbenchMode === "character";
    elements.deleteCharacterButton.classList.toggle("d-none", !showDelete);
    if (!showDelete) {
      // Clears any stale disabled-tooltip wrapper before the button hides,
      // so nothing orphaned lingers behind d-none.
      setDisabledTooltip(elements.deleteCharacterButton, "");
      elements.deleteCharacterButton.disabled = true;
      elements.deleteCharacterButton.setAttribute("aria-disabled", "true");
      return;
    }
    const origin = state.characterOrigin || metadata?.source || metadata?.origin || state.character?.origin || "";
    const isBuiltin = origin === "builtin";
    const deletable = !isBuiltin;
    elements.deleteCharacterButton.setAttribute("aria-disabled", deletable ? "false" : "true");
    setDisabledTooltip(elements.deleteCharacterButton, deletable ? "" : "Built-in characters cannot be deleted.");
  }

  // --- Level Up ------------------------------------------------------------
  // "levelUpBindings" is a reserved System field key (see README's
  // "Reserved-key System fields"), found by key rather than role shape —
  // findRoleBoundField's ROLE_BOUND_ROLES set is combatBindings-specific and
  // doesn't cover levelUpBindings' own role vocabulary.
  function getLevelUpBindings() {
    const fields = Array.isArray(state.systemDefinition?.fields) ? state.systemDefinition.fields : [];
    const field = fields.find((entry) => entry?.key === "levelUpBindings");
    return Array.isArray(field?.values) ? field.values : [];
  }

  function getCombatBindings() {
    const fields = Array.isArray(state.systemDefinition?.fields) ? state.systemDefinition.fields : [];
    const field = findRoleBoundField(fields);
    return Array.isArray(field?.values) ? field.values : [];
  }

  function getPendingChoices() {
    return Array.isArray(state.draft?.pendingChoices) ? state.draft.pendingChoices : [];
  }

  // Recomputes multiclass-aware spell slots for `draft`'s full class list —
  // shared by every place classes[] changes (Level Up, Add a Class, Build
  // creation) so there's one implementation of resolving each class's
  // caster type against the System's spellSlotProgression/
  // pactMagicProgression tables and merging into limitedUses[] without
  // clobbering tracked `used`. A no-op if the System authored neither table.
  async function refreshCharacterSpellSlots(draft) {
    const classes = Array.isArray(draft?.identity?.classes) ? draft.identity.classes : [];
    if (!classes.length) {
      return;
    }
    const classIds = [...new Set(classes.map((cls) => cls?.refId).filter(Boolean))];
    const variantIds = [...new Set(classes.map((cls) => cls?.subclass?.refId).filter(Boolean))];
    const [classResults, variantResults] = await Promise.all([
      Promise.all(classIds.map((id) => dataManager.get("class", id, { preferLocal: false }).catch(() => null))),
      Promise.all(variantIds.map((id) => dataManager.get("variant", id, { preferLocal: false }).catch(() => null))),
    ]);
    const classRecordsById = new Map(
      classIds.map((id, index) => [id, classResults[index]?.payload]).filter(([, record]) => record)
    );
    const variantRecordsById = new Map(
      variantIds.map((id, index) => [id, variantResults[index]?.payload]).filter(([, record]) => record)
    );
    const fields = Array.isArray(state.systemDefinition?.fields) ? state.systemDefinition.fields : [];
    const spellSlotProgression = fields.find((field) => field?.key === "spellSlotProgression")?.values || [];
    const pactMagicProgression = fields.find((field) => field?.key === "pactMagicProgression")?.values || [];
    const computed = computeSpellSlots(classes, classRecordsById, variantRecordsById, spellSlotProgression, pactMagicProgression);
    draft.limitedUses = mergeLimitedUses(draft.limitedUses, computed);
  }

  // A subclass picked late needs its features backfilled through every
  // level up to the character's current one, not just the one exact level
  // grantSubclassFeaturesAtLevel (level-up-bindings.js) checks — loops that
  // same shared function per level instead of duplicating its logic.
  function grantSubclassFeaturesThroughLevel(variantRecord, throughLevel, featureNameById, existingFeatureIds) {
    const granted = [];
    const existing = [...(Array.isArray(existingFeatureIds) ? existingFeatureIds : [])];
    for (let level = 1; level <= throughLevel; level += 1) {
      grantSubclassFeaturesAtLevel(variantRecord, level, featureNameById, existing).forEach((id) => {
        if (!existing.includes(id)) {
          existing.push(id);
          granted.push(id);
        }
      });
    }
    return granted;
  }

  let levelUpModalInstance = null;
  // "confirm" (preview, nothing applied yet) or "resolve" (applied — any
  // pendingChoices render inline so the player can resolve without leaving
  // the modal; Close ends the flow either way, and anything unresolved just
  // shows up later in Character Properties from the same state.draft data).
  let levelUpStage = "confirm";
  let levelUpPreviewState = null;

  function setLevelUpModalStage(stage) {
    levelUpStage = stage;
    elements.levelUpCancelButton?.classList.toggle("d-none", stage === "resolve");
    if (elements.levelUpConfirmButton) {
      elements.levelUpConfirmButton.textContent = stage === "resolve" ? "Close" : "Level Up";
    }
  }

  // Pure — computes what a Level Up would do without touching state.draft,
  // so both the modal preview and the actual apply step use the exact same
  // numbers. `allClasses` is the full identity.classes list, since
  // multiclass proficiency bonus needs every class's level, not just the
  // one being leveled.
  async function computeLevelUpPreview(cls, classRecord, allClasses) {
    const nextLevel = (Number(cls.level) || 0) + 1;

    // Subclass features at this level too, if one's already chosen —
    // fetched up front so the feature-id fetch below covers both.
    let subclassRecord = null;
    if (cls.subclass?.refId) {
      try {
        const result = await dataManager.get("variant", cls.subclass.refId, { preferLocal: false });
        subclassRecord = result?.payload || null;
      } catch (error) {
        console.error("Character editor: unable to fetch subclass record for Level Up", error);
      }
    }

    // Feature grants — every class.features[] entry at this level, matched
    // against class.featureIds[] (the promoted real `feature` kind ids).
    // NOT a blind index pairing: the two arrays can drift out of alignment
    // in real content (e.g. fighter.json). Index is checked first as the
    // fast common-case match, falling back to a name-matched search across
    // featureIds — a level with no matching id anywhere grants nothing
    // rather than the wrong feature.
    const classFeatures = Array.isArray(classRecord.features) ? classRecord.features : [];
    const classFeatureIds = Array.isArray(classRecord.featureIds) ? classRecord.featureIds : [];
    const needsFeatureFetch = classFeatureIds.length || (Array.isArray(subclassRecord?.featureIds) && subclassRecord.featureIds.length);
    const featureEntries = needsFeatureFetch ? await fetchKindEntriesWithIds(dataManager, "feature") : [];
    const featureEntityById = new Map(featureEntries.map((entry) => [entry.id, entry.entity]));
    const featureNameById = new Map(featureEntries.map((entry) => [entry.id, (entry.entity?.name || "").trim().toLowerCase()]));
    const existingFeatureIds = Array.isArray(state.draft?.featureIds) ? state.draft.featureIds : [];
    const classFeatureMatches = matchFeaturesAtLevel(classFeatures, classFeatureIds, featureNameById, nextLevel, existingFeatureIds);
    const subclassFeatureMatches = subclassRecord
      ? grantSubclassFeaturesAtLevel(subclassRecord, nextLevel, featureNameById, [...existingFeatureIds, ...classFeatureMatches])
      : [];
    const newFeatureIds = [...classFeatureMatches, ...subclassFeatureMatches];

    // Does this level grant the subclass pick, per the class record's own
    // data (never assumed to be level 3)? Offered only if not already set.
    let subclassChoiceOptions = null;
    if (!cls.subclass && getSubclassGrantLevel(classRecord) === nextLevel) {
      try {
        const variantEntries = await fetchKindEntriesWithIds(dataManager, "variant");
        subclassChoiceOptions = variantEntries
          .filter((entry) => entry.entity?.parentKind === "class" && entry.entity?.parentId === cls.refId)
          .map((entry) => ({ id: entry.id, label: entry.entity?.name || entry.id, description: resolveNotes(entry.entity), raw: entry.entity }));
      } catch (error) {
        console.error("Character editor: unable to fetch subclass options for Level Up", error);
        subclassChoiceOptions = [];
      }
    }

    // Does any newly-granted feature (e.g. Ability Score Improvement) carry
    // a featChoice grant? Deferred rather than auto-granted — applyLevelUp
    // skips deferredFeatureId in its auto-push loop, offering a
    // pendingChoice instead.
    let featChoiceOptions = null;
    let deferredFeatureId = null;
    for (const featureId of newFeatureIds) {
      const record = featureEntityById.get(featureId);
      const featChoiceGrant = Array.isArray(record?.grants) ? record.grants.find((grant) => grant?.type === "featChoice") : null;
      if (featChoiceGrant) {
        deferredFeatureId = featureId;
        try {
          const featEntries = await fetchKindEntriesWithIds(dataManager, "feature");
          featChoiceOptions = featEntries
            .filter((entry) => Array.isArray(entry.entity?.tags?.categories) && entry.entity.tags.categories.includes("feat"))
            .map((entry) => ({ id: entry.id, label: entry.entity?.name || entry.id, description: resolveNotes(entry.entity), raw: entry.entity }));
        } catch (error) {
          console.error("Character editor: unable to fetch feat options for Level Up", error);
          featChoiceOptions = [];
        }
        break;
      }
    }

    // Resource growth (HP) — no-op if the System hasn't authored this
    // levelUpBindings role.
    const growthBinding = findLevelUpBinding(getLevelUpBindings(), "resourceGrowth", "class");
    let growth = 0;
    let resourceBinding = null;
    if (growthBinding?.path) {
      const hitDieSides = Number(classRecord[growthBinding.path]) || 0;
      const derivedFormulas = systemFieldValues(state.systemDefinition, "derivedFormulas");
      growth = evaluateDerivedFormula(derivedFormulas, "hitPointsPerLevelAverage", { sides: hitDieSides }) || 0;
      if (growth && growthBinding.abilityBinding) {
        const score = resolveBinding(growthBinding.abilityBinding, state.draft);
        growth += evaluateDerivedFormula(derivedFormulas, "abilityModifier", { score }) || 0;
      }
      resourceBinding = findBindingByRole(getCombatBindings(), growthBinding.resourceRole);
    }

    // Proficiency bonus off the total level across every class, not just
    // the one being leveled — nextLevel only equals total level pre-multiclass.
    const classes = Array.isArray(allClasses) && allClasses.length ? allClasses : [cls];
    const totalLevel = classes.reduce((sum, entry) => sum + (entry === cls ? nextLevel : Number(entry.level) || 0), 0);

    return {
      nextLevel,
      className: cls.name || "this class",
      newFeatureIds,
      featureEntityById,
      growth,
      resourceBinding,
      newProficiencyBonus: evaluateDerivedFormula(systemFieldValues(state.systemDefinition, "derivedFormulas"), "proficiencyBonusForLevel", { level: totalLevel }) || 0,
      subclassChoiceOptions,
      featChoiceOptions,
      deferredFeatureId,
    };
  }

  function renderLevelUpModalConfirm(preview) {
    const body = elements.levelUpModalBody;
    if (!body) {
      return;
    }
    body.innerHTML = "";
    const intro = document.createElement("p");
    intro.className = "mb-2";
    intro.textContent = `Level up ${preview.className} to level ${preview.nextLevel}.`;
    body.appendChild(intro);
    const lines = [];
    if (preview.newFeatureIds.length) {
      const names = preview.newFeatureIds.map((id) => preview.featureEntityById.get(id)?.name || id);
      lines.push(`New feature${names.length > 1 ? "s" : ""}: ${names.join(", ")}`);
    }
    if (preview.growth && preview.resourceBinding) {
      const maxPathSegs = resolveBindingPath(preview.resourceBinding.maxPath);
      const currentMax = maxPathSegs ? Number(getValueAtPath(maxPathSegs)) || 0 : 0;
      lines.push(`+${preview.growth} max HP (${currentMax} → ${currentMax + preview.growth})`);
    }
    if (preview.newProficiencyBonus) {
      lines.push(`Proficiency Bonus: +${preview.newProficiencyBonus}`);
    }
    if (preview.subclassChoiceOptions) {
      lines.push(`Choose a subclass (${preview.subclassChoiceOptions.length} options)`);
    }
    if (preview.featChoiceOptions) {
      lines.push("Choose a feat");
    }
    if (!lines.length) {
      lines.push("No other changes at this level.");
    }
    const list = document.createElement("ul");
    list.className = "d-flex flex-column gap-1 small mb-0 ps-3";
    lines.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    body.appendChild(list);
  }

  function renderLevelUpModalResolve(pendingEntries) {
    const body = elements.levelUpModalBody;
    if (!body) {
      return;
    }
    body.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "mb-2";
    summary.textContent = pendingEntries.length
      ? "Leveled up! Resolve the choices below, or close and finish them later from Character Properties."
      : "Leveled up!";
    body.appendChild(summary);
    if (pendingEntries.length) {
      const list = document.createElement("div");
      list.className = "d-flex flex-column gap-2";
      pendingEntries.forEach((choice) => {
        const row = renderPendingChoiceRow(choice, {
          onResolved: () => {
            row.remove();
            if (!list.children.length) {
              summary.textContent = "All done!";
            }
          },
        });
        list.appendChild(row);
      });
      body.appendChild(list);
    }
  }

  // 1 class: straight to the confirm screen. 2+ classes: a "which class?"
  // list first — Level Up always levels an existing class; adding a new
  // one is the separate "Add a Class" action.
  async function openLevelUpModal() {
    const classes = Array.isArray(state.draft?.identity?.classes) ? state.draft.identity.classes : [];
    if (!classes.length || !elements.levelUpModalEl || !state.draft) {
      return;
    }
    if (classes.length === 1) {
      await openLevelUpModalForClass(classes[0]);
      return;
    }
    setLevelUpModalStage("confirm");
    levelUpPreviewState = null;
    if (elements.levelUpConfirmButton) {
      elements.levelUpConfirmButton.disabled = true;
    }
    if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
      levelUpModalInstance = window.bootstrap.Modal.getOrCreateInstance(elements.levelUpModalEl);
      levelUpModalInstance.show();
    }
    renderLevelUpClassPicker(classes);
  }

  function renderLevelUpClassPicker(classes) {
    const body = elements.levelUpModalBody;
    if (!body) {
      return;
    }
    body.innerHTML = "";
    const intro = document.createElement("p");
    intro.className = "mb-2";
    intro.textContent = "Which class?";
    body.appendChild(intro);
    const list = document.createElement("div");
    list.className = "d-flex flex-column gap-1";
    classes.forEach((cls) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-secondary text-start";
      const level = Number(cls?.level) || 0;
      button.textContent = `${cls.name || "Class"} (${level} → ${level + 1})`;
      button.addEventListener("click", () => {
        void openLevelUpModalForClass(cls);
      });
      list.appendChild(button);
    });
    body.appendChild(list);
  }

  async function openLevelUpModalForClass(cls) {
    if (!cls || !cls.refId || !elements.levelUpModalEl || !state.draft) {
      return;
    }
    setLevelUpModalStage("confirm");
    levelUpPreviewState = null;
    advancementMenuState = null;
    if (elements.levelUpModalBody) {
      elements.levelUpModalBody.textContent = "Loading…";
    }
    if (elements.levelUpConfirmButton) {
      elements.levelUpConfirmButton.disabled = true;
    }
    if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
      levelUpModalInstance = window.bootstrap.Modal.getOrCreateInstance(elements.levelUpModalEl);
      levelUpModalInstance.show();
    }
    let classRecord;
    try {
      const result = await dataManager.get("class", cls.refId, { preferLocal: false });
      classRecord = result?.payload;
    } catch (error) {
      console.error("Character editor: unable to fetch class record for Level Up", error);
      classRecord = null;
    }
    if (!classRecord) {
      if (elements.levelUpModalBody) {
        elements.levelUpModalBody.textContent = "Unable to fetch this character's class record.";
      }
      return;
    }
    // A System declaring `advancementOptions` (Daggerheart's fixed "spend 2
    // picks from a menu" progression) has no per-level lookup table for
    // computeLevelUpPreview — routed to a separate engine instead of
    // forcing D&D's per-level-table model to fit. The two never coexist.
    if (usesAdvancementMenu()) {
      await openAdvancementMenuModalForClass(cls, classRecord);
      return;
    }
    const allClasses = Array.isArray(state.draft?.identity?.classes) ? state.draft.identity.classes : [cls];
    const preview = await computeLevelUpPreview(cls, classRecord, allClasses);
    levelUpPreviewState = { cls, preview };
    if (elements.levelUpConfirmButton) {
      elements.levelUpConfirmButton.disabled = false;
    }
    renderLevelUpModalConfirm(preview);
  }

  // --- Advancement-Menu Level Up (Daggerheart-style Systems) ---------------
  // For a System declaring `advancementOptions`+`tierAchievements` instead
  // of a per-level class features table — a fixed menu of reusable
  // advancement options with slot/cost tracking. `state.draft.stats.
  // advancementsTaken` (`{optionId, level}` per mark) is this System's
  // equivalent of D&D's `featureIds`, tracking how many times a repeatable
  // option has been taken, capped by its own `slots`.
  function usesAdvancementMenu() {
    return systemFieldValues(state.systemDefinition, "advancementOptions").length > 0;
  }

  // Which of the System's `tier` entries (`{tier, levels:[min,max],
  // achievementLevel}`) a level falls inside — drives eligible advancement
  // options (`minTier`) and which tier achievement fires this level-up.
  function tierForLevel(level) {
    const tiers = systemFieldValues(state.systemDefinition, "tier");
    const match = tiers.find((entry) => Array.isArray(entry.levels) && level >= entry.levels[0] && level <= entry.levels[1]);
    return match ? Number(match.sourceId) || 1 : 1;
  }

  let advancementMenuState = null;

  // Pure — mirrors computeLevelUpPreview's "no state.draft mutation"
  // contract, for the menu shape instead of a fixed feature/growth set.
  function computeAdvancementMenuPreview(cls) {
    const nextLevel = (Number(cls.level) || 0) + 1;
    const tierAchievements = systemFieldValues(state.systemDefinition, "tierAchievements");
    const tierAchievement = tierAchievements.find((entry) => Number(entry.level) === nextLevel) || null;
    const allOptions = systemFieldValues(state.systemDefinition, "advancementOptions");
    const taken = Array.isArray(state.draft?.stats?.advancementsTaken) ? state.draft.stats.advancementsTaken : [];
    const currentTier = tierForLevel(nextLevel);
    const options = allOptions
      .filter((opt) => currentTier >= (Number(opt.minTier) || 1))
      .map((opt) => {
        const takenCount = taken.filter((entry) => entry.optionId === opt.id).length;
        return { ...opt, remainingSlots: Math.max(0, (Number(opt.slots) || 1) - takenCount) };
      })
      .filter((opt) => opt.remainingSlots > 0);
    return { cls, nextLevel, tierAchievement, options };
  }

  // Checkbox menu capped at exactly 2 points (a cost:2 option consumes
  // both) — same modal chrome as renderLevelUpModalConfirm, different body.
  function renderAdvancementMenuConfirm(preview) {
    const body = elements.levelUpModalBody;
    if (!body) return;
    body.innerHTML = "";
    const intro = document.createElement("p");
    intro.className = "mb-2";
    intro.textContent = `Level ${Number(preview.cls.level) || 0} → ${preview.nextLevel}`;
    body.appendChild(intro);
    if (preview.tierAchievement) {
      const parts = [];
      if (preview.tierAchievement.grantsExperience) parts.push("gain a new Experience at +2");
      if (preview.tierAchievement.grantsProficiency) parts.push("Proficiency +1");
      if (preview.tierAchievement.clearsTraitMarks) parts.push("clear all marked Traits");
      const achievementNote = document.createElement("div");
      achievementNote.className = "alert alert-info py-2 px-3 small mb-3";
      achievementNote.textContent = `Tier achievement: ${parts.join(", ")}.`;
      body.appendChild(achievementNote);
    }
    const menuIntro = document.createElement("p");
    menuIntro.className = "mb-2 small text-body-secondary";
    menuIntro.textContent = "Choose advancements totaling exactly 2 points. A damage threshold increase and a new domain card are always granted too.";
    body.appendChild(menuIntro);
    const budgetLabel = document.createElement("div");
    budgetLabel.className = "fw-semibold small mb-2";
    body.appendChild(budgetLabel);
    const list = document.createElement("div");
    list.className = "d-flex flex-column gap-2";
    body.appendChild(list);
    const selections = new Map();
    const checkboxes = [];
    const updateBudget = () => {
      const spent = Array.from(selections.values()).reduce((sum, opt) => sum + (Number(opt.cost) || 1), 0);
      budgetLabel.textContent = `${spent} / 2 points selected`;
      if (elements.levelUpConfirmButton) {
        elements.levelUpConfirmButton.disabled = spent !== 2;
      }
      checkboxes.forEach(({ opt, input }) => {
        if (!selections.has(opt.id)) {
          input.disabled = spent + (Number(opt.cost) || 1) > 2;
        }
      });
    };
    preview.options.forEach((opt) => {
      const row = document.createElement("div");
      row.className = "form-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "form-check-input";
      input.id = `advancement-option-${opt.id}`;
      const label = document.createElement("label");
      label.className = "form-check-label";
      label.htmlFor = input.id;
      const costNote = Number(opt.cost) === 2 ? " (costs 2 points)" : "";
      const slotsNote = Number(opt.slots) > 1 ? ` (${opt.remainingSlots} of ${opt.slots} remaining)` : "";
      label.textContent = `${opt.label}${costNote}${slotsNote}`;
      input.addEventListener("change", () => {
        if (input.checked) selections.set(opt.id, opt);
        else selections.delete(opt.id);
        updateBudget();
      });
      row.appendChild(input);
      row.appendChild(label);
      list.appendChild(row);
      checkboxes.push({ opt, input });
    });
    updateBudget();
    advancementMenuState = { cls: preview.cls, nextLevel: preview.nextLevel, tierAchievement: preview.tierAchievement, selections, classRecord: advancementMenuState?.classRecord };
  }

  async function openAdvancementMenuModalForClass(cls, classRecord) {
    setLevelUpModalStage("confirm");
    advancementMenuState = null;
    if (elements.levelUpConfirmButton) {
      elements.levelUpConfirmButton.disabled = true;
    }
    if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
      levelUpModalInstance = window.bootstrap.Modal.getOrCreateInstance(elements.levelUpModalEl);
      levelUpModalInstance.show();
    }
    const preview = computeAdvancementMenuPreview(cls);
    renderAdvancementMenuConfirm(preview);
    if (advancementMenuState) {
      advancementMenuState.classRecord = classRecord;
    }
  }

  // A fixed, small, closed vocabulary of effect types — same "add a case
  // for a new one" convention resolveDynamicGrantOptions (level-up-
  // bindings.js) documents, not a generic plugin system. Domain-card-
  // access/subclass-upgrade defer to a pendingChoice (same mechanism
  // ordinary Level Up uses) with real fetched options. `alreadyOwnedIds`
  // excludes cards the character already has (matched by domainCards'
  // `refId`) so the same card can't be picked twice across separate
  // grants; omit it at creation time, when nothing's owned yet.
  async function fetchDomainCardOptions(classRecord, nextLevel, alreadyOwnedIds = []) {
    const domains = new Set((Array.isArray(classRecord?.domains) ? classRecord.domains : []).map((d) => String(d).toLowerCase()));
    if (!domains.size) return [];
    const owned = new Set(alreadyOwnedIds);
    // Domain cards split across two kinds: Spell/Grimoire cards are
    // `wonder` records (`properties.form:"domain-card"`), Ability cards are
    // `feature` records (`domain`/`level`/`recallCost` as plain top-level
    // fields, no `properties` wrapper) — both must be queried or half of
    // all domain cards are unreachable from Level Up.
    let wonders = [];
    let features = [];
    try {
      [wonders, features] = await Promise.all([fetchKindEntriesWithIds(dataManager, "wonder"), fetchKindEntriesWithIds(dataManager, "feature")]);
    } catch (error) {
      console.warn("Character editor: unable to fetch domain cards for advancement", error);
      return [];
    }
    const spellAndGrimoireCards = wonders
      .filter((entry) => entry?.entity?.properties?.form === "domain-card")
      .filter((entry) => domains.has(String(entry.entity.properties?.domain || "").toLowerCase()))
      .filter((entry) => Number(entry.entity.properties?.level) <= nextLevel)
      .filter((entry) => !owned.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id, level: Number(entry.entity.properties?.level) || 0, refKind: "wonder" }));
    const abilityCards = features
      .filter((entry) => entry?.entity?.domain != null)
      .filter((entry) => domains.has(String(entry.entity.domain || "").toLowerCase()))
      .filter((entry) => Number(entry.entity.level) <= nextLevel)
      .filter((entry) => !owned.has(entry.id))
      .map((entry) => ({ id: entry.id, name: entry.entity.name || entry.id, level: Number(entry.entity.level) || 0, refKind: "feature" }));
    return [...spellAndGrimoireCards, ...abilityCards];
  }

  function pushAdvancementPendingChoice(newlyPending, { id, label }, type, desc, options, choose = 1) {
    if (!Array.isArray(state.draft.pendingChoices)) {
      state.draft.pendingChoices = [];
    }
    const pending = {
      id: `advancement-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceKind: "advancement",
      sourceId: id,
      sourceName: label,
      type,
      desc,
      choose,
      options: options || [],
    };
    state.draft.pendingChoices.push(pending);
    newlyPending.push(pending);
  }

  async function applyAdvancementMenu() {
    if (!advancementMenuState || !state.draft) return;
    const { cls, nextLevel, tierAchievement, selections, classRecord } = advancementMenuState;
    if (!state.draft.stats || typeof state.draft.stats !== "object") {
      state.draft.stats = {};
    }
    if (!Array.isArray(state.draft.stats.advancementsTaken)) {
      state.draft.stats.advancementsTaken = [];
    }
    const newlyPending = [];

    // Step one: tier achievements (automatic).
    if (tierAchievement) {
      if (tierAchievement.grantsExperience) {
        if (!Array.isArray(state.draft.stats.experiences)) state.draft.stats.experiences = [];
        state.draft.stats.experiences.push({ name: "", modifier: 2 });
      }
      if (tierAchievement.grantsProficiency) {
        // stats.proficiencyBonus — the fixed cross-kind stats.* name every
        // System uses, same key creation-time seeding and skill/save
        // calculations already read.
        state.draft.stats.proficiencyBonus = (Number(state.draft.stats.proficiencyBonus) || 0) + 1;
      }
      if (tierAchievement.clearsTraitMarks) {
        state.draft.stats.traitMarks = [];
      }
    }

    // Step two: the player's own 2 selected advancement picks.
    const ownedDomainCardIds = (Array.isArray(state.draft.stats.domainCards) ? state.draft.stats.domainCards : []).map((card) => card.refId);
    const domainCardOptions = await fetchDomainCardOptions(classRecord, nextLevel, ownedDomainCardIds);
    for (const opt of selections.values()) {
      state.draft.stats.advancementsTaken.push({ optionId: opt.id, level: nextLevel });
      switch (opt.effectType) {
        case "hpSlot": {
          const hpBinding = (getCombatBindings() || []).find((entry) => String(entry.name || "").toLowerCase().includes("hit point"));
          if (hpBinding?.maxPath) {
            const maxSegs = resolveBindingPath(hpBinding.maxPath);
            if (maxSegs) setValueAtPath(maxSegs, (Number(getValueAtPath(maxSegs)) || 0) + 1);
          }
          break;
        }
        case "stressSlot": {
          const stressBinding = (getCombatBindings() || []).find((entry) => String(entry.name || "").toLowerCase().includes("stress"));
          if (stressBinding?.maxPath) {
            const maxSegs = resolveBindingPath(stressBinding.maxPath);
            if (maxSegs) setValueAtPath(maxSegs, (Number(getValueAtPath(maxSegs)) || 0) + 1);
          }
          break;
        }
        case "evasionIncrease": {
          const evasionBinding = findBindingByRole(getCombatBindings(), "value");
          if (evasionBinding?.binding) {
            const segs = resolveBindingPath(evasionBinding.binding);
            if (segs) setValueAtPath(segs, (Number(getValueAtPath(segs)) || 0) + 1);
          }
          break;
        }
        case "proficiencyIncrease": {
          state.draft.stats.proficiencyBonus = (Number(state.draft.stats.proficiencyBonus) || 0) + 1;
          break;
        }
        case "experienceIncrease": {
          const experienceOptions = (Array.isArray(state.draft.stats.experiences) ? state.draft.stats.experiences : []).map((entry, index) => ({
            id: String(index),
            name: entry.name || `Experience ${index + 1}`,
          }));
          pushAdvancementPendingChoice(newlyPending, opt, "experienceIncrease", "Choose two Experiences to increase by +1.", experienceOptions, 2);
          break;
        }
        case "traitIncrease": {
          const traitFields = Array.isArray(state.systemDefinition?.fields)
            ? state.systemDefinition.fields.find((entry) => entry.key === "traits")?.children || []
            : [];
          const traitOptions = traitFields.map((child) => ({ id: String(child.key || "").split(".").pop(), name: child.label || child.key }));
          pushAdvancementPendingChoice(newlyPending, opt, "traitIncrease", "Choose two Traits to increase by +1 and mark.", traitOptions, 2);
          break;
        }
        case "domainCardAccess":
          pushAdvancementPendingChoice(newlyPending, opt, "domainCardAccess", "Choose an additional domain card at or below your level.", domainCardOptions);
          break;
        case "subclassUpgrade": {
          // No choice here — always "take the next card" (Specialization
          // if only Foundation is owned, Mastery otherwise), applied
          // directly. Grants the matching tier's own features, not just
          // the tier counter, using the same "Foundation:"/
          // "Specialization:"/"Mastery:" name-prefix convention
          // buildCharacterFromWizard's Foundation grant reads.
          const nextTier = Math.min(3, (Number(state.draft.stats.subclassTier) || 1) + 1);
          state.draft.stats.subclassTier = nextTier;
          const tierPrefix = ["Foundation", "Foundation", "Specialization", "Mastery"][nextTier];
          const subclassRefId = cls?.subclass?.refId;
          if (tierPrefix && subclassRefId) {
            try {
              const variantResult = await dataManager.get("variant", subclassRefId, { preferLocal: false });
              const variantRecord = variantResult?.payload;
              const tierIndexes = (Array.isArray(variantRecord?.features) ? variantRecord.features : [])
                .map((entry, index) => ({ entry, index }))
                .filter(({ entry }) => new RegExp(`^${tierPrefix}:`).test(entry?.name || ""));
              const tierFeatureIds = tierIndexes.map(({ index }) => variantRecord.featureIds[index]).filter(Boolean);
              if (!Array.isArray(state.draft.featureIds)) state.draft.featureIds = [];
              tierFeatureIds.forEach((fid) => {
                if (!state.draft.featureIds.includes(fid)) state.draft.featureIds.push(fid);
              });
            } catch (error) {
              console.warn("Character editor: unable to fetch subclass record for subclassUpgrade", error);
            }
          }
          break;
        }
        case "multiclass":
          pushAdvancementPendingChoice(newlyPending, opt, "multiclass", "Choose an additional class and one of its domains.", [{ id: "open", name: "Open Add a Class" }]);
          break;
        default:
          break;
      }
    }

    // Step three: damage thresholds +1 (both), unconditional.
    if (state.draft.stats.thresholds && typeof state.draft.stats.thresholds === "object") {
      state.draft.stats.thresholds.major = (Number(state.draft.stats.thresholds.major) || 0) + 1;
      state.draft.stats.thresholds.severe = (Number(state.draft.stats.thresholds.severe) || 0) + 1;
    }

    // Step four: the guaranteed new domain card every level grants, on top
    // of (not instead of) any "domainCardAccess" advancement pick.
    pushAdvancementPendingChoice(
      newlyPending,
      { id: "level-card", label: "New Domain Card" },
      "domainCardAccess",
      "Acquire a new domain card at or below your level and add it to your loadout or vault.",
      domainCardOptions
    );

    cls.level = nextLevel;

    renderCanvas();
    renderPreview();
    await persistDraft({ silent: false });
    syncCharacterActions();
    expandCharacterPropertiesSection();
    status.show(`Leveled up ${cls.name || "this class"} to level ${nextLevel}.`, { type: "success", timeout: 2400 });

    setLevelUpModalStage("resolve");
    renderLevelUpModalResolve(newlyPending);
  }

  // --- Add a Class (multiclass) ---------------------------------------------
  // Separate from Level Up (which only levels an existing class) — this is
  // what actually starts multiclassing. Reuses the same level-1 grant
  // sequence Build Character's creation flow uses (matchFeaturesAtLevel,
  // resolveChoiceList/resolveEquipmentChoice as pendingChoices), with one
  // real-5e exception: saving-throw proficiency only ever comes from a
  // character's first class, never one added here (unless this genuinely
  // is their first).
  let addClassModalInstance = null;
  let addClassStage = "pick";
  let addClassPickedRecord = null;

  function setAddClassModalStage(stage) {
    addClassStage = stage;
    elements.addClassCancelButton?.classList.toggle("d-none", stage === "resolve");
    if (elements.addClassConfirmButton) {
      elements.addClassConfirmButton.textContent = stage === "resolve" ? "Close" : "Add Class";
      elements.addClassConfirmButton.disabled = stage === "pick" && !addClassPickedRecord;
    }
  }

  async function openAddClassModal() {
    if (!elements.addClassModalEl || !state.draft) {
      return;
    }
    addClassPickedRecord = null;
    setAddClassModalStage("pick");
    if (window.bootstrap && typeof window.bootstrap.Modal === "function") {
      addClassModalInstance = window.bootstrap.Modal.getOrCreateInstance(elements.addClassModalEl);
      addClassModalInstance.show();
    }
    await renderAddClassPicker();
  }

  // Multiclass prerequisites are shown inline in each candidate's
  // description — informational only, never filtering/disabling a
  // candidate, per this suite's "GM/player judgment stays authoritative"
  // policy.
  async function renderAddClassPicker() {
    const body = elements.addClassModalBody;
    if (!body) {
      return;
    }
    body.textContent = "Loading…";
    const existingRefIds = new Set(
      (Array.isArray(state.draft?.identity?.classes) ? state.draft.identity.classes : []).map((cls) => cls?.refId).filter(Boolean)
    );
    let entries = [];
    try {
      entries = await fetchKindEntriesWithIds(dataManager, "class");
    } catch (error) {
      body.textContent = "Unable to load class options.";
      return;
    }
    const systemId = state.template?.schema || "";
    const abilityDefs = await loadAbilityFieldDefs(dataManager, systemId);
    const abilityLabelByKey = new Map(abilityDefs.map((def) => [def.key, def.label]));
    const abilities = state.draft?.stats?.abilities || {};
    const candidates = entries
      .filter((entry) => !existingRefIds.has(entry.id))
      .filter((entry) => {
        const systemIds = entry.entity?.systemIds;
        return !systemId || !Array.isArray(systemIds) || !systemIds.length || systemIds.includes(systemId);
      })
      .map((entry) => {
        const prereqText = describeMulticlassPrerequisites(entry.entity?.multiclassPrerequisites, abilityLabelByKey);
        const meets = characterMeetsMulticlassPrerequisites(entry.entity?.multiclassPrerequisites, abilities);
        const prereqLine = prereqText
          ? `<p class="mb-1${meets ? "" : " text-warning"}"><strong>Requires:</strong> ${escapeHtml(prereqText)}${meets ? "" : " (not met)"}</p>`
          : "";
        return {
          id: entry.id,
          name: entry.entity?.name || entry.id,
          description: `${prereqLine}${resolveNotes(entry.entity) || ""}`,
          raw: entry.entity,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    body.innerHTML = "";
    const picker = createFilterableListPicker({
      options: candidates,
      emptyMessage: "No class options available.",
      onSelect: (option) => {
        addClassPickedRecord = { id: option.id, name: option.name, raw: option.raw };
        if (elements.addClassConfirmButton) {
          elements.addClassConfirmButton.disabled = false;
        }
      },
    });
    body.appendChild(picker.element);
  }

  async function applyAddClass() {
    if (!addClassPickedRecord || !state.draft) {
      return;
    }
    if (elements.addClassConfirmButton) {
      elements.addClassConfirmButton.disabled = true;
    }
    const classRecord = addClassPickedRecord.raw;
    const classId = addClassPickedRecord.id;

    if (!state.draft.identity || typeof state.draft.identity !== "object") {
      state.draft.identity = {};
    }
    if (!Array.isArray(state.draft.identity.classes)) {
      state.draft.identity.classes = [];
    }
    const classes = state.draft.identity.classes;
    const isFirstClass = classes.length === 0;
    classes.push({ name: classRecord.name || addClassPickedRecord.name || "", level: 1, refKind: "class", refId: classId });
    state.draft.identity.level = classes.reduce((sum, entry) => sum + (Number(entry.level) || 0), 0);

    const classFeatures = Array.isArray(classRecord.features) ? classRecord.features : [];
    const classFeatureIds = Array.isArray(classRecord.featureIds) ? classRecord.featureIds : [];
    const featureEntries = classFeatureIds.length ? await fetchKindEntriesWithIds(dataManager, "feature") : [];
    const featureEntityById = new Map(featureEntries.map((entry) => [entry.id, entry.entity]));
    const featureNameById = new Map(featureEntries.map((entry) => [entry.id, (entry.entity?.name || "").trim().toLowerCase()]));
    const existingFeatureIds = Array.isArray(state.draft.featureIds) ? state.draft.featureIds : [];
    const newFeatureIds = matchFeaturesAtLevel(classFeatures, classFeatureIds, featureNameById, 1, existingFeatureIds);
    if (!Array.isArray(state.draft.featureIds)) {
      state.draft.featureIds = [];
    }
    newFeatureIds.forEach((id) => {
      if (!state.draft.featureIds.includes(id)) {
        state.draft.featureIds.push(id);
      }
    });

    // HP growth uses the ordinary average-growth formula, never creation's
    // max-at-level-1 rule (specific to the character's very first level).
    const growthBinding = findLevelUpBinding(getLevelUpBindings(), "resourceGrowth", "class");
    if (growthBinding?.path) {
      const hitDieSides = Number(classRecord[growthBinding.path]) || 0;
      const derivedFormulas = systemFieldValues(state.systemDefinition, "derivedFormulas");
      let growth = evaluateDerivedFormula(derivedFormulas, "hitPointsPerLevelAverage", { sides: hitDieSides }) || 0;
      if (growth && growthBinding.abilityBinding) {
        const score = resolveBinding(growthBinding.abilityBinding, state.draft);
        growth += evaluateDerivedFormula(derivedFormulas, "abilityModifier", { score }) || 0;
      }
      const resourceBinding = findBindingByRole(getCombatBindings(), growthBinding.resourceRole);
      if (growth && resourceBinding) {
        const maxPathSegs = resolveBindingPath(resourceBinding.maxPath);
        const currentPathSegs = resolveBindingPath(resourceBinding.binding);
        if (maxPathSegs) {
          setValueAtPath(maxPathSegs, (Number(getValueAtPath(maxPathSegs)) || 0) + growth);
        }
        if (currentPathSegs) {
          setValueAtPath(currentPathSegs, (Number(getValueAtPath(currentPathSegs)) || 0) + growth);
        }
      }
    }

    if (!state.draft.stats || typeof state.draft.stats !== "object") {
      state.draft.stats = {};
    }
    state.draft.stats.proficiencyBonus =
      evaluateDerivedFormula(systemFieldValues(state.systemDefinition, "derivedFormulas"), "proficiencyBonusForLevel", { level: state.draft.identity.level }) || 0;

    // Only a character's first class ever grants saving-throw proficiency
    // (real 5e rule); mirrors buildCharacterFromWizard's own seeding,
    // reached only when Add a Class targets a character with zero classes.
    if (isFirstClass) {
      const systemId = state.template?.schema || "";
      const abilityDefs = await loadAbilityFieldDefs(dataManager, systemId);
      const abilities = state.draft.stats.abilities && typeof state.draft.stats.abilities === "object" ? state.draft.stats.abilities : {};
      // Field name from the System's "savingThrowGrants" levelUpBindings
      // role, never a literal.
      const savingThrowGrantsPath = findLevelUpBinding(getLevelUpBindings(), "savingThrowGrants", "class")?.path;
      const classSaveIndexes = new Set(
        (savingThrowGrantsPath && Array.isArray(classRecord?.[savingThrowGrantsPath]) ? classRecord[savingThrowGrantsPath] : []).map((entry) =>
          String(entry?.index || "").toLowerCase()
        )
      );
      state.draft.stats.savingThrows = abilityDefs.map((def, index) => {
        const isProficient = classSaveIndexes.has(String(def.label || "").toLowerCase());
        const modifier = evaluateDerivedFormula(systemFieldValues(state.systemDefinition, "derivedFormulas"), "abilityModifier", { score: abilities[def.key] ?? 10 }) || 0;
        return {
          id: index + 1,
          name: def.key,
          friendlyName: def.key.charAt(0).toUpperCase() + def.key.slice(1),
          shortName: def.label || def.key.slice(0, 3).toUpperCase(),
          value: modifier + (isProficient ? state.draft.stats.proficiencyBonus : 0),
          proficiency: isProficient ? 2 : 0,
          advantage: false,
          disadvantage: false,
        };
      });
    }

    await refreshCharacterSpellSlots(state.draft);

    if (!Array.isArray(state.draft.pendingChoices)) {
      state.draft.pendingChoices = [];
    }
    const newlyPending = [];
    const pushChoice = (resolved, sourceName) => {
      resolved.forEach((entry, index) => {
        const pending = {
          id: `${classId}-addclass-${index}-${Date.now()}`,
          sourceKind: "class",
          sourceId: classId,
          sourceName,
          type: entry.type || "",
          desc: entry.desc,
          choose: entry.choose,
          options: entry.options,
        };
        state.draft.pendingChoices.push(pending);
        newlyPending.push(pending);
      });
    };
    // Field name comes from the System's levelUpBindings role, never a
    // literal — Daggerheart declares neither role, so both lookups come
    // back null and this block no-ops for it, same graceful degradation
    // every optional System field follows.
    const proficiencyChoicesPath = findLevelUpBinding(getLevelUpBindings(), "proficiencyChoices", "class")?.path;
    const equipmentChoicesPath = findLevelUpBinding(getLevelUpBindings(), "equipmentChoices", "class")?.path;
    if (proficiencyChoicesPath) {
      pushChoice(resolveChoiceList(classRecord[proficiencyChoicesPath]).filter((entry) => entry.options.length), classRecord.name || "Class");
    }
    const equipmentChoice = equipmentChoicesPath ? resolveEquipmentChoice((classRecord[equipmentChoicesPath] || [])[0]) : null;
    if (equipmentChoice) {
      pushChoice([{ ...equipmentChoice, type: "equipmentChoice" }], classRecord.name || "Class");
    }
    newFeatureIds.forEach((featureId) => {
      const featureRecord = featureEntityById.get(featureId);
      if (!featureRecord || !Array.isArray(featureRecord.grants) || !featureRecord.grants.length) {
        return;
      }
      const resolved = resolveGrantChoices(featureRecord.grants, state.draft);
      resolved.forEach((entry, index) => {
        const pending = {
          id: `${featureId}-addclass-${index}-${Date.now()}`,
          sourceKind: "feature",
          sourceId: featureId,
          sourceName: featureRecord.name || featureId,
          type: entry.type,
          desc: entry.desc,
          choose: entry.choose,
          options: entry.options,
        };
        state.draft.pendingChoices.push(pending);
        newlyPending.push(pending);
      });
    });

    renderCanvas();
    renderPreview();
    await persistDraft({ silent: false });
    syncCharacterActions();
    expandCharacterPropertiesSection();
    status.show(`Added ${classRecord.name || "class"}.`, { type: "success", timeout: 2400 });

    setAddClassModalStage("resolve");
    renderAddClassResolvePanel(newlyPending);
  }

  function renderAddClassResolvePanel(pendingEntries) {
    const body = elements.addClassModalBody;
    if (!body) {
      return;
    }
    body.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "mb-2";
    summary.textContent = pendingEntries.length
      ? "Class added! Resolve the choices below, or close and finish them later from Character Properties."
      : "Class added!";
    body.appendChild(summary);
    if (pendingEntries.length) {
      const list = document.createElement("div");
      list.className = "d-flex flex-column gap-2";
      pendingEntries.forEach((choice) => {
        const row = renderPendingChoiceRow(choice, {
          onResolved: () => {
            row.remove();
            if (!list.children.length) {
              summary.textContent = "All done!";
            }
          },
        });
        list.appendChild(row);
      });
      body.appendChild(list);
    }
  }

  // Applies the already-computed preview (no second fetch/recompute) —
  // mutates state.draft directly as one bulk atomic action rather than a
  // series of updateBinding calls, which would fragment into many separate
  // undo entries, then switches the modal to resolve any pendingChoices.
  async function applyLevelUp() {
    if (!levelUpPreviewState || !state.draft) {
      return;
    }
    const { cls, preview } = levelUpPreviewState;

    if (!Array.isArray(state.draft.featureIds)) {
      state.draft.featureIds = [];
    }
    preview.newFeatureIds.forEach((id) => {
      // A feature deferred to a featChoice pendingChoice is NOT auto-granted
      // here — the player might pick a different feat than the trigger.
      if (id === preview.deferredFeatureId) {
        return;
      }
      if (!state.draft.featureIds.includes(id)) {
        state.draft.featureIds.push(id);
      }
    });

    if (preview.growth && preview.resourceBinding) {
      const maxPathSegs = resolveBindingPath(preview.resourceBinding.maxPath);
      const currentPathSegs = resolveBindingPath(preview.resourceBinding.binding);
      if (maxPathSegs) {
        setValueAtPath(maxPathSegs, (Number(getValueAtPath(maxPathSegs)) || 0) + preview.growth);
      }
      if (currentPathSegs) {
        setValueAtPath(currentPathSegs, (Number(getValueAtPath(currentPathSegs)) || 0) + preview.growth);
      }
    }

    if (!state.draft.stats || typeof state.draft.stats !== "object") {
      state.draft.stats = {};
    }
    state.draft.stats.proficiencyBonus = preview.newProficiencyBonus;

    cls.level = preview.nextLevel;
    if (!state.draft.identity || typeof state.draft.identity !== "object") {
      state.draft.identity = {};
    }
    const allClasses = Array.isArray(state.draft.identity.classes) ? state.draft.identity.classes : [cls];
    state.draft.identity.level = allClasses.reduce((sum, entry) => sum + (Number(entry.level) || 0), 0);

    // Recomputed for the full class list, not just this one — multiclass
    // caster-level math needs every class.
    await refreshCharacterSpellSlots(state.draft);

    if (!Array.isArray(state.draft.pendingChoices)) {
      state.draft.pendingChoices = [];
    }
    const newlyPending = [];

    // Subclass choice, if this level grants it.
    if (preview.subclassChoiceOptions) {
      const pending = {
        id: `${cls.refId}-subclass-${preview.nextLevel}-${Date.now()}`,
        sourceKind: "class",
        sourceId: cls.refId,
        sourceName: cls.name || "Class",
        type: "subclassChoice",
        desc: `Choose your ${cls.name || "class"} subclass.`,
        choose: 1,
        options: preview.subclassChoiceOptions,
        targetClassRefId: cls.refId,
      };
      state.draft.pendingChoices.push(pending);
      newlyPending.push(pending);
    }

    // Feat choice, if a newly-granted feature deferred to one.
    if (preview.featChoiceOptions) {
      const deferredRecord = preview.featureEntityById.get(preview.deferredFeatureId);
      const pending = {
        id: `${preview.deferredFeatureId}-feat-${preview.nextLevel}-${Date.now()}`,
        sourceKind: "feature",
        sourceId: preview.deferredFeatureId,
        sourceName: deferredRecord?.name || "Feature",
        type: "featChoice",
        desc: "Choose a feat.",
        choose: 1,
        options: preview.featChoiceOptions,
      };
      state.draft.pendingChoices.push(pending);
      newlyPending.push(pending);
    }

    // Every other newly granted feature's grants[], resolving any dynamic
    // source (e.g. "proficientSkills") against current state now, so the UI
    // never interprets a source string later. The deferred feature (if any)
    // is skipped — its grants resolve once the feat pick is known
    // (resolvePendingChoice's "featChoice" branch).
    preview.newFeatureIds.forEach((featureId) => {
      if (featureId === preview.deferredFeatureId) {
        return;
      }
      const featureRecord = preview.featureEntityById.get(featureId);
      if (!featureRecord || !Array.isArray(featureRecord.grants) || !featureRecord.grants.length) {
        return;
      }
      const resolved = resolveGrantChoices(featureRecord.grants, state.draft);
      if (!resolved.length) {
        return;
      }
      resolved.forEach((entry, index) => {
        const pending = {
          id: `${featureId}-${preview.nextLevel}-${index}-${Date.now()}`,
          sourceKind: "feature",
          sourceId: featureId,
          sourceName: featureRecord.name || featureId,
          type: entry.type,
          desc: entry.desc,
          choose: entry.choose,
          options: entry.options,
        };
        state.draft.pendingChoices.push(pending);
        newlyPending.push(pending);
      });
    });

    renderCanvas();
    renderPreview();
    await persistDraft({ silent: false });
    syncCharacterActions();
    expandCharacterPropertiesSection();
    status.show(`Leveled up ${preview.className} to level ${preview.nextLevel}.`, { type: "success", timeout: 2400 });

    setLevelUpModalStage("resolve");
    renderLevelUpModalResolve(newlyPending);
  }

  // Resolving a pending choice writes per its own `type`. abilityScoreBonus/
  // abilityScoreImprovement have no generic write here — they resolve
  // through their own dedicated path (resolveAbilityScoreBonusChoice
  // below), never through this generic picks-array signature.
  async function resolvePendingChoice(choice, picks) {
    if (!state.draft) {
      return;
    }
    const pendingChoices = getPendingChoices();
    const index = pendingChoices.findIndex((entry) => entry.id === choice.id);
    if (index === -1) {
      return;
    }
    const additionalPending = [];
    if (choice.type === "skillExpertise") {
      const skills = Array.isArray(state.draft.stats?.skills) ? state.draft.stats.skills : [];
      picks.forEach((pick) => {
        const skill = skills.find((entry) => entry?.name === pick.id);
        if (skill) {
          skill.proficiency = 3;
        }
      });
    } else if (choice.type === "proficiencies") {
      // A resolveChoiceList option's `raw` is the original {id, name}
      // reference — `name` carries the "Skill: X"/"Tool: X" prefix
      // applyProficiencyGrant parses, same function Background's
      // unconditional grants use, just one pick at a time here.
      picks.forEach((pick) => applyProficiencyGrant(pick?.raw?.name || pick?.label, state.draft));
    } else if (choice.type === "equipmentChoice") {
      picks.forEach((pick) => applyEquipmentBundle(pick?.raw?.bundle, state.draft));
    } else if (choice.type === "traitIncrease") {
      // pick.raw's id is the trait's field-key segment ("agility"),
      // matching stats.traits.<key> exactly.
      const traits = state.draft.stats.traits && typeof state.draft.stats.traits === "object" ? state.draft.stats.traits : (state.draft.stats.traits = {});
      picks.forEach((pick) => {
        const key = pick?.raw?.id;
        if (!key) return;
        traits[key] = (Number(traits[key]) || 0) + 1;
      });
      if (!Array.isArray(state.draft.stats.traitMarks)) state.draft.stats.traitMarks = [];
      picks.forEach((pick) => {
        if (pick?.raw?.id && !state.draft.stats.traitMarks.includes(pick.raw.id)) {
          state.draft.stats.traitMarks.push(pick.raw.id);
        }
      });
    } else if (choice.type === "experienceIncrease") {
      const experiences = Array.isArray(state.draft.stats.experiences) ? state.draft.stats.experiences : [];
      picks.forEach((pick) => {
        const index = Number(pick?.raw?.id);
        if (Number.isFinite(index) && experiences[index]) {
          experiences[index].modifier = (Number(experiences[index].modifier) || 0) + 1;
        }
      });
    } else if (choice.type === "domainCardAccess") {
      if (!Array.isArray(state.draft.stats.domainCards)) state.draft.stats.domainCards = [];
      picks.forEach((pick) => {
        const cardId = pick?.raw?.id;
        const cardName = pick?.raw?.name || pick?.label;
        const cardLevel = Number(pick?.raw?.level) || 0;
        // "wonder" for Spell/Grimoire cards, "feature" for Ability cards —
        // whichever kind fetchDomainCardOptions found this pick in.
        const cardRefKind = pick?.raw?.refKind || "wonder";
        if (cardId && !state.draft.stats.domainCards.some((entry) => entry.refId === cardId)) {
          state.draft.stats.domainCards.push({ name: cardName || "", refKind: cardRefKind, refId: cardId, level: cardLevel, inLoadout: true });
        }
      });
    } else if (choice.type === "fieldChoice") {
      // Generic "write the pick's name to a plain character field path" —
      // Daggerheart's creation-time weapon/armor picks (see
      // buildCharacterFromWizard's creationEquipmentChoices), reusable by
      // any future System. `choice.targetPath` is the "@..." binding the
      // pick's name is written to (only the first pick, `choose:1` only).
      const targetPathSegs = resolveBindingPath(choice.targetPath);
      const pick = picks[0];
      if (targetPathSegs && pick) {
        setValueAtContext(state.draft, targetPathSegs, pick.raw?.name || pick.label || "");
      }
      // Optional per-choice `statBindings` copies other fields off the same
      // picked option's `raw` (e.g. Armor's baseMajor/baseSevere) onto other
      // character bindings, each through an optional formula evaluated with
      // {base, level} so a threshold can add the character's level. Never a
      // hardcoded Armor-specific write — absent statBindings is a no-op.
      if (pick && Array.isArray(choice.statBindings)) {
        const level = Number(state.draft?.identity?.level) || 1;
        choice.statBindings.forEach((binding) => {
          const base = pick.raw?.[binding?.sourcePath];
          if (base === undefined) return;
          const value = binding.formula ? evaluateFormula(binding.formula, { base, level }, {}) : base;
          const path = resolveBindingPath(binding?.targetBinding);
          if (path && value !== null && value !== undefined) {
            setValueAtContext(state.draft, path, value);
          }
        });
      }
    } else if (choice.type === "multiclass") {
      // No real pick to apply — the option list is a single "open the
      // picker" placeholder (Add a Class is already the real multiclass
      // picker). Resolving just launches that flow instead of duplicating it.
      void openAddClassModal();
    } else if (choice.type === "subclassChoice") {
      // Filterable-picker picks carry {id, label, raw: choiceOption} — the
      // option object built in computeLevelUpPreview, same extra nesting
      // level equipmentChoice's pick.raw.bundle already established.
      const variantOption = picks[0]?.raw;
      const variantRecord = variantOption?.raw;
      const classes = Array.isArray(state.draft.identity?.classes) ? state.draft.identity.classes : [];
      const cls = classes.find((entry) => entry.refId === choice.targetClassRefId);
      if (cls && variantOption && variantRecord) {
        cls.subclass = { name: variantOption.label || variantRecord.name || "", refKind: "variant", refId: variantOption.id };
        const featureEntries = await fetchKindEntriesWithIds(dataManager, "feature");
        const featureNameById = new Map(featureEntries.map((entry) => [entry.id, (entry.entity?.name || "").trim().toLowerCase()]));
        const grantedIds = grantSubclassFeaturesThroughLevel(
          variantRecord,
          Number(cls.level) || 1,
          featureNameById,
          Array.isArray(state.draft.featureIds) ? state.draft.featureIds : []
        );
        if (!Array.isArray(state.draft.featureIds)) {
          state.draft.featureIds = [];
        }
        grantedIds.forEach((id) => {
          if (!state.draft.featureIds.includes(id)) {
            state.draft.featureIds.push(id);
          }
        });
        await refreshCharacterSpellSlots(state.draft);
      }
    } else if (choice.type === "featChoice") {
      const featOption = picks[0]?.raw;
      const featRecord = featOption?.raw;
      const featId = featOption?.id;
      if (featId) {
        if (!Array.isArray(state.draft.featureIds)) {
          state.draft.featureIds = [];
        }
        if (!state.draft.featureIds.includes(featId)) {
          state.draft.featureIds.push(featId);
        }
        // If the picked feat has its own grants (true for feat.ability-
        // score-improvement), resolve those too — one level of recursion,
        // filtering out any nested "featChoice" so re-picking ASI doesn't
        // re-trigger another "pick a feat" prompt.
        const secondaryGrants = Array.isArray(featRecord?.grants) ? featRecord.grants.filter((grant) => grant?.type !== "featChoice") : [];
        if (secondaryGrants.length) {
          const resolved = resolveGrantChoices(secondaryGrants, state.draft);
          resolved.forEach((entry, i) => {
            additionalPending.push({
              id: `${featId}-secondary-${i}-${Date.now()}`,
              sourceKind: "feature",
              sourceId: featId,
              sourceName: featRecord.name || featId,
              type: entry.type,
              desc: entry.desc,
              choose: entry.choose,
              options: entry.options,
            });
          });
        }
      }
    }
    const remaining = pendingChoices.filter((_, i) => i !== index);
    state.draft.pendingChoices = [...remaining, ...additionalPending];
    renderCanvas();
    renderPreview();
    await persistDraft({ silent: false });
    syncCharacterActions();
    status.show("Choice resolved.", { type: "success", timeout: 1800 });
  }

  // A choice a System marked `optional` (e.g. Daggerheart's Secondary
  // Weapon, skipped when Primary is Two-Handed) can sit pending forever
  // otherwise. Just removes it — no data write, nothing to apply — never
  // for a choice missing that flag (renderPendingChoiceRow/
  // renderFilterableChoiceRow only ever show the
  // Skip button when `choice.optional` is true in the first place, but this
  // guards the write path itself too, not just the button's visibility).
  async function dismissPendingChoice(choice) {
    if (!state.draft || !choice?.optional) {
      return;
    }
    const pendingChoices = getPendingChoices();
    const index = pendingChoices.findIndex((entry) => entry.id === choice.id);
    if (index === -1) {
      return;
    }
    state.draft.pendingChoices = pendingChoices.filter((_, i) => i !== index);
    renderCanvas();
    renderPreview();
    await persistDraft({ silent: false });
    syncCharacterActions();
    status.show("Choice skipped.", { type: "info", timeout: 1800 });
  }

  // Dispatches on choice.type — abilityScoreBonus/abilityScoreImprovement
  // are bespoke (not flat pick-N-of-M), so they get their own renderer;
  // subclassChoice/featChoice share a filterable-list-with-description
  // renderer (too many candidates for the flat shape below); everything
  // else (including equipmentChoice, whose options carry `label` not
  // `name`) shares this one generic flat-option-list shape.
  function renderPendingChoiceRow(choice, { onResolved } = {}) {
    if (choice.type === "abilityScoreBonus") {
      return renderAbilityScoreBonusChoiceRow(choice, { onResolved });
    }
    if (choice.type === "abilityScoreImprovement") {
      return renderClassAbilityScoreImprovementChoiceRow(choice, { onResolved });
    }
    if (choice.type === "subclassChoice" || choice.type === "featChoice") {
      return renderFilterableChoiceRow(choice, { onResolved });
    }
    const row = document.createElement("div");
    row.className = "d-flex flex-column gap-2 border rounded-3 p-2";
    const title = document.createElement("div");
    title.className = "small";
    title.innerHTML = `<span class="fw-semibold">${escapeHtml(choice.sourceName || "Feature")}</span>${
      choice.desc ? " — " + escapeHtml(choice.desc) : ""
    }`;
    row.appendChild(title);
    const rawOptions = Array.isArray(choice.options) ? choice.options : [];
    const options = rawOptions.map((option) => ({ label: option.label || option.name, id: option.id, kind: "", raw: option }));
    const choose = Math.max(1, Number(choice.choose) || 1);
    const fields = Array.from({ length: choose }, () =>
      createSearchField({
        ready: true,
        options,
        onChange: () => {
          refreshFieldOptions();
          updateConfirmState();
        },
      })
    );
    const controlsRow = document.createElement("div");
    controlsRow.className = "d-flex gap-2 align-items-center flex-wrap";
    fields.forEach((field) => controlsRow.appendChild(field.element));
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "btn btn-sm btn-outline-primary";
    confirmButton.textContent = "Confirm";
    confirmButton.disabled = true;
    // "Choose 2" shares one options pool across multiple fields — each
    // field excludes whatever's picked in every other field, same
    // already-picked-can't-repeat behavior the ability pickers use, so a
    // duplicate skill is never even offered.
    function refreshFieldOptions() {
      fields.forEach((field, index) => {
        const otherIds = fields
          .filter((_, i) => i !== index)
          .map((other) => other.getSelected()?.id)
          .filter((id) => id !== undefined);
        field.setOptions(options.filter((option) => !otherIds.includes(option.id)));
      });
    }
    function hasDuplicatePicks() {
      const picks = fields.map((field) => field.getSelected()?.id).filter((id) => id !== undefined);
      return new Set(picks).size !== picks.length;
    }
    function updateConfirmState() {
      confirmButton.disabled = fields.some((field) => !field.getSelected()) || hasDuplicatePicks();
    }
    // Single source of truth for "confirm this row" — both the button's
    // click handler and the Build Wizard's Finish button (which
    // auto-confirms already-filled rows) call this. Returns whether it
    // actually resolved, so a bulk caller knows which rows it skipped.
    async function tryConfirm() {
      const picks = fields.map((field) => field.getSelected());
      if (picks.some((pick) => !pick) || hasDuplicatePicks()) {
        return false;
      }
      await resolvePendingChoice(choice, picks);
      onResolved?.();
      return true;
    }
    confirmButton.addEventListener("click", () => {
      void tryConfirm();
    });
    controlsRow.appendChild(confirmButton);
    // Only when the System marked this choice skippable (e.g. Daggerheart's
    // Secondary Weapon) — everything else stays required.
    if (choice.optional) {
      const skipButton = document.createElement("button");
      skipButton.type = "button";
      skipButton.className = "btn btn-sm btn-outline-secondary";
      skipButton.textContent = "Skip";
      skipButton.addEventListener("click", () => {
        void dismissPendingChoice(choice).then(() => onResolved?.());
      });
      controlsRow.appendChild(skipButton);
    }
    row.appendChild(controlsRow);
    row._tryConfirm = tryConfirm;
    return row;
  }

  // Writes a resolved ability-score bonus directly onto stats.abilities —
  // a {abilityKey: bonus} distribution, not a list of picked options, so
  // it's its own function rather than a third branch on resolvePendingChoice.
  async function resolveAbilityScoreBonusChoice(choice, distribution) {
    if (!state.draft) {
      return;
    }
    const pendingChoices = getPendingChoices();
    const index = pendingChoices.findIndex((entry) => entry.id === choice.id);
    if (index === -1) {
      return;
    }
    if (!state.draft.stats || typeof state.draft.stats !== "object") {
      state.draft.stats = {};
    }
    if (!state.draft.stats.abilities || typeof state.draft.stats.abilities !== "object") {
      state.draft.stats.abilities = {};
    }
    Object.entries(distribution).forEach(([key, bonus]) => {
      state.draft.stats.abilities[key] = (Number(state.draft.stats.abilities[key]) || 0) + bonus;
    });
    state.draft.pendingChoices = pendingChoices.filter((_, i) => i !== index);
    renderCanvas();
    renderPreview();
    await persistDraft({ silent: false });
    syncCharacterActions();
    status.show("Choice resolved.", { type: "success", timeout: 1800 });
  }

  // Shared by Background's ability-score bonus and class-granted Ability
  // Score Improvement — "choose a distribution pattern, then which
  // ability(ies) get which bonus" isn't expressible as a flat pick-N-of-M.
  // `patterns` is `{value, label, slots: [{bonus, label}]}` — when a
  // pattern's slot count matches the full options list, every option gets
  // that bonus with no selection needed; otherwise each slot renders its
  // own `<select>`, cross-filtered against every other slot's current pick.
  function renderPointBuyAbilityChoiceRow(choice, patterns, { onResolved, resolveFn, defaultSourceLabel } = {}) {
    const row = document.createElement("div");
    row.className = "d-flex flex-column gap-2 border rounded-3 p-2";
    const title = document.createElement("div");
    title.className = "small";
    title.innerHTML = `<span class="fw-semibold">${escapeHtml(choice.sourceName || defaultSourceLabel || "")}</span>${
      choice.desc ? " — " + escapeHtml(choice.desc) : ""
    }`;
    row.appendChild(title);
    const options = Array.isArray(choice.options) ? choice.options : [];
    const patternRow = document.createElement("div");
    patternRow.className = "btn-group btn-group-sm";
    const pickerMount = document.createElement("div");
    pickerMount.className = "d-flex gap-2 align-items-center flex-wrap";
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "btn btn-sm btn-outline-primary align-self-start";
    confirmButton.textContent = "Confirm";
    let pattern = patterns[0]?.value;
    let selects = [];
    function activePattern() {
      return patterns.find((entry) => entry.value === pattern) || patterns[0];
    }
    function renderPatternButtons() {
      patternRow.innerHTML = "";
      patterns.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = entry.value === pattern ? "btn btn-primary" : "btn btn-outline-secondary";
        button.textContent = entry.label;
        button.addEventListener("click", () => {
          pattern = entry.value;
          renderPatternButtons();
          renderPicker();
        });
        patternRow.appendChild(button);
      });
    }
    function refreshSelectOptions() {
      selects.forEach((select, index) => {
        const current = select.value;
        const otherValues = selects.filter((_, i) => i !== index).map((entry) => entry.value);
        select.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "—";
        select.appendChild(blank);
        options.forEach((option) => {
          if (otherValues.includes(option.id) && option.id !== current) {
            return;
          }
          const opt = document.createElement("option");
          opt.value = option.id;
          opt.textContent = option.name;
          select.appendChild(opt);
        });
        select.value = current;
      });
    }
    function updateConfirm() {
      const values = selects.map((select) => select.value);
      confirmButton.disabled = values.some((value) => !value) || new Set(values).size !== values.length;
    }
    function renderPicker() {
      pickerMount.innerHTML = "";
      selects = [];
      const slots = activePattern()?.slots || [];
      if (slots.length >= options.length) {
        const note = document.createElement("div");
        note.className = "small text-body-secondary";
        note.textContent = `${slots[0]?.label || "+1"} to each: ${options.map((option) => option.name).join(", ")}`;
        pickerMount.appendChild(note);
        confirmButton.disabled = false;
        return;
      }
      slots.forEach((slot) => {
        const wrap = document.createElement("div");
        wrap.className = "d-flex align-items-center gap-1";
        const label = document.createElement("span");
        label.className = "small";
        label.textContent = slot.label;
        const select = document.createElement("select");
        select.className = "form-select form-select-sm";
        select.style.maxWidth = "8rem";
        wrap.append(label, select);
        pickerMount.appendChild(wrap);
        selects.push(select);
      });
      refreshSelectOptions();
      selects.forEach((select) => {
        select.addEventListener("change", () => {
          refreshSelectOptions();
          updateConfirm();
        });
      });
      updateConfirm();
    }
    renderPatternButtons();
    renderPicker();
    confirmButton.addEventListener("click", () => {
      const slots = activePattern()?.slots || [];
      const distribution = {};
      if (slots.length >= options.length) {
        options.forEach((option) => {
          distribution[option.id] = slots[0]?.bonus || 1;
        });
      } else {
        const values = selects.map((select) => select.value);
        if (values.some((value) => !value) || new Set(values).size !== values.length) {
          return;
        }
        slots.forEach((slot, index) => {
          distribution[values[index]] = slot.bonus;
        });
      }
      void resolveFn(choice, distribution).then(() => onResolved?.());
    });
    row.append(patternRow, pickerMount, confirmButton);
    return row;
  }

  const BACKGROUND_ABILITY_BONUS_PATTERNS = [
    { value: "2-1", label: "+2 / +1", slots: [{ bonus: 2, label: "+2" }, { bonus: 1, label: "+1" }] },
    {
      value: "1-1-1",
      label: "+1 / +1 / +1",
      slots: [{ bonus: 1, label: "+1" }, { bonus: 1, label: "+1" }, { bonus: 1, label: "+1" }],
    },
  ];

  // Background's 2024 ability-score bonus — choice.options is its 3
  // candidate abilities, sourced via loadAbilityFieldDefs, never hardcoded.
  function renderAbilityScoreBonusChoiceRow(choice, { onResolved } = {}) {
    return renderPointBuyAbilityChoiceRow(choice, BACKGROUND_ABILITY_BONUS_PATTERNS, {
      onResolved,
      resolveFn: resolveAbilityScoreBonusChoice,
      defaultSourceLabel: "Background",
    });
  }

  const CLASS_ABILITY_IMPROVEMENT_PATTERNS = [
    { value: "2", label: "+2 to one", slots: [{ bonus: 2, label: "+2" }] },
    { value: "1-1", label: "+1 to two", slots: [{ bonus: 1, label: "+1" }, { bonus: 1, label: "+1" }] },
  ];

  // A class-granted Ability Score Improvement, resolved once ASI is picked
  // as the feat — choice.options is every stats.abilities key (typically
  // all 6), so "+1 to two" needs a real 2-of-N picker, not Background's
  // "apply to all 3" shortcut. resolveAbilityScoreBonusChoice's write is
  // already fully generic, so no separate resolve function is needed.
  function renderClassAbilityScoreImprovementChoiceRow(choice, { onResolved } = {}) {
    return renderPointBuyAbilityChoiceRow(choice, CLASS_ABILITY_IMPROVEMENT_PATTERNS, {
      onResolved,
      resolveFn: resolveAbilityScoreBonusChoice,
      defaultSourceLabel: "Ability Score Improvement",
    });
  }

  // Shared by subclassChoice/featChoice — both are "pick one from a
  // Library-kind list where descriptions matter," same reasoning the Build
  // wizard's Species/Class/Background steps use for createFilterableListPicker
  // over the flat createSearchField shape above. Confirms via the same
  // resolvePendingChoice(choice, picks) signature every other type uses.
  function renderFilterableChoiceRow(choice, { onResolved } = {}) {
    const row = document.createElement("div");
    row.className = "d-flex flex-column gap-2 border rounded-3 p-2";
    const title = document.createElement("div");
    title.className = "small";
    title.innerHTML = `<span class="fw-semibold">${escapeHtml(choice.sourceName || "")}</span>${
      choice.desc ? " — " + escapeHtml(choice.desc) : ""
    }`;
    row.appendChild(title);
    const options = Array.isArray(choice.options) ? choice.options : [];
    let selected = null;
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "btn btn-sm btn-outline-primary align-self-start";
    confirmButton.textContent = "Confirm";
    confirmButton.disabled = true;
    const picker = createFilterableListPicker({
      options: options.map((option) => ({ id: option.id, name: option.label, description: option.description, raw: option })),
      emptyMessage: "No options available.",
      onSelect: (option) => {
        selected = option;
        confirmButton.disabled = false;
      },
    });
    row.appendChild(picker.element);
    // Same tryConfirm/row._tryConfirm convention as the generic pendingChoice
    // row — lets the Build Wizard's Finish button auto-confirm this too.
    async function tryConfirm() {
      if (!selected) {
        return false;
      }
      const pick = { id: selected.id, label: selected.name, raw: selected.raw };
      await resolvePendingChoice(choice, [pick]);
      onResolved?.();
      return true;
    }
    confirmButton.addEventListener("click", () => {
      void tryConfirm();
    });
    row.appendChild(confirmButton);
    // Same optional/Skip convention as the generic pendingChoice row above.
    if (choice.optional) {
      const skipButton = document.createElement("button");
      skipButton.type = "button";
      skipButton.className = "btn btn-sm btn-outline-secondary align-self-start ms-2";
      skipButton.textContent = "Skip";
      skipButton.addEventListener("click", () => {
        void dismissPendingChoice(choice).then(() => onResolved?.());
      });
      row.appendChild(skipButton);
    }
    row._tryConfirm = tryConfirm;
    return row;
  }

  function renderPendingChoices() {
    const mount = elements.pendingChoicesMount;
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const choices = getPendingChoices();
    if (!choices.length) {
      return;
    }
    const heading = document.createElement("div");
    heading.className = "fw-semibold text-body-secondary small";
    heading.textContent = "Pending choices";
    mount.appendChild(heading);
    choices.forEach((choice) => mount.appendChild(renderPendingChoiceRow(choice)));
  }

  // Called from syncCharacterActions (the universal choke point for every
  // load/Save/edit-permission change) — reuses the same draftHasId/
  // canWrite/canEditRecord/locked values Save/Duplicate/Delete compute.
  function refreshCharacterPropertiesPanel({ draftHasId = false, canWrite = false, canEditRecord = false, locked = false } = {}) {
    if (!elements.characterPropertiesPanel) {
      return;
    }
    const classes = Array.isArray(state.draft?.identity?.classes) ? state.draft.identity.classes : [];
    const hasLinkedClass = classes.some((cls) => cls?.refId);
    // Level Up levels an existing class ("which class?" appears once
    // there's more than one) — Add a Class handles actual multiclassing,
    // so Level Up only needs "at least one class, linked."
    const commonlyDisabled = !draftHasId || locked || !canEditRecord || !canWrite || state.mode !== "edit";
    const commonDisabledTitle = !draftHasId
      ? "Select a character first."
      : locked
        ? "Group characters must be claimed before use."
        : !canEditRecord || !canWrite
          ? "You don't have permission to edit this character."
          : state.mode !== "edit"
            ? "Switch to Edit mode."
            : "";
    const levelUpDisabled = commonlyDisabled || !hasLinkedClass;
    const levelUpDisabledTitle = commonlyDisabled
      ? commonDisabledTitle
      : !classes.length
        ? "This character has no class recorded."
        : "Link this character's class to a Library record first.";
    if (elements.levelUpButton) {
      setDisabledTooltip(elements.levelUpButton, levelUpDisabled ? levelUpDisabledTitle : "");
      initTooltip(elements.levelUpButton, { title: levelUpDisabled ? "" : "Level up this character" });
    }
    if (elements.addClassButton) {
      setDisabledTooltip(elements.addClassButton, commonlyDisabled ? commonDisabledTitle : "");
      initTooltip(elements.addClassButton, { title: commonlyDisabled ? "" : "Add a class (multiclass)" });
    }
    renderPendingChoices();
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


  // Routed through dice-roll.js's shared rollExpression (not
  // rollDiceExpression directly) so every roll button — Dice pane and
  // ability/save/attack/roller-formula buttons — gets the 3D overlay.
  // `context` threads through for `@path` substitution on formula buttons.
  // `targetValue` (optional) is a number the caller already read off a
  // bound field — used by a matched Move's `target*` bands
  // (matchesRangeBand) to grade the roll, e.g. a Skill button passes its
  // own percentage and the roll comes back labeled Regular/Hard/Extreme
  // Success or Fumble instead of a bare total.
  //
  // rollExpression itself recognizes both a real dice expression and a
  // System Roll's shortName — this function just hands it the right
  // `rolls` list for the caller's scope. `rollKey` truthy (a template
  // button's typed text) scopes the lookup to THIS CHARACTER's own System
  // Moves (state.systemDefinition) — never activeSystemRolls, which is
  // campaign-priority and would show a different System's Move bands
  // whenever another campaign happened to be active. A caller with no
  // `rollKey` checks the typed/inserted text against activeSystemRolls
  // instead — the same list rendered as that panel's buttons.
  async function executeDiceRoll(expression, { label = "", updateInput = true, targetValue = undefined, rollKey = "" } = {}) {
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
    const rolls = rollKey ? extractSystemRolls(state.systemDefinition) : activeSystemRolls;
    const rolled = await rollExpression(trimmed, {
      status,
      // "" would win over a Move's default label (rollSystemMove's
      // `label = move.label` only kicks in for an omitted argument) —
      // undefined lets that default apply.
      label: label || undefined,
      dataManager,
      dice: activeQuickDice,
      context: getBindingContext(),
      rolls,
      targetValue,
    });
    if (!rolled || rolled.isTable) {
      return rolled;
    }
    recordGameLogRoll(rolled.result, { expression: trimmed, label, verdict: rolled.verdict?.label || undefined });
    return rolled.result;
  }

  // Delegates to spotlight.js's resolveActiveSpotlightId, kind-scoped to
  // "encounter" — an encounter spotlighted earlier stays active even if
  // the GM later also shows an unrelated NPC/map card. Returns "" if
  // nothing's spotlighted, it isn't an encounter, or there's no campaign.
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

  // Initiative is a one-way push, not a synced field — a rolled result
  // updates the active encounter, not the character record, since
  // initiative isn't persistent state.
  async function pushInitiativeToActiveEncounter(value) {
    const encounterId = await resolveActiveEncounterId();
    if (!encounterId || !state.draft?.id) {
      return;
    }
    try {
      // preferLocal: false — a read-modify-write against the encounter's
      // real current state; a stale local copy would clobber other
      // combatants' changes on save. Same fix as combat-tracker.js's
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

  // The same resolution combat-tracker.js and character-sheet.js use for
  // HP/AC/Conditions/Initiative (findRoleBoundField, bindings.js) — "which
  // field is Initiative" is answered by whichever combatBindings entry the
  // System tags role:"modifier" (editable in Loom), never a component's
  // id/binding compared against a literal string.
  function findInitiativeCombatBinding() {
    const fields = Array.isArray(state.systemDefinition?.fields) ? state.systemDefinition.fields : [];
    const combatBindings = findRoleBoundField(fields)?.values;
    return findBindingByRole(combatBindings, "modifier");
  }

  async function handleComponentRoll(expression, label, component, targetValue, rollKey = "") {
    if (!expression) {
      return;
    }
    const text = typeof label === "string" && label.trim() ? label.trim() : "";
    const result = await executeDiceRoll(expression, { label: text, updateInput: true, targetValue, rollKey });
    const initiativeBinding = findInitiativeCombatBinding();
    if (result && initiativeBinding && component?.binding === initiativeBinding.binding) {
      void pushInitiativeToActiveEncounter(result.total);
    }
  }

  // `input` (optional) is the DOM control this roll button sits next to —
  // read live at click time so an edit made just before rolling is what
  // gets tested, not whatever was last saved. Only a finite number is
  // passed as targetValue; other field types roll as before.
  function createRollOverlayButton(component, expressions, input) {
    const container = document.createElement("div");
    container.className = "character-roll-overlay";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-primary btn-sm d-flex align-items-center justify-content-center";
    const label = component.label || component.name || "Roll";
    button.setAttribute("aria-label", `Roll ${label}`);
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute(
      "data-bs-title",
      Array.isArray(expressions) && expressions.length ? expressions.join(" • ") : `Roll ${label}`
    );
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
      const rawValue = input ? Number(input.value) : NaN;
      const targetValue = Number.isFinite(rawValue) ? rawValue : undefined;
      void handleComponentRoll(expression, label, component, targetValue);
    });
    container.appendChild(button);
    return container;
  }

  function createSpinnerButton(iconName, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary";
    button.setAttribute("aria-label", label);
    button.setAttribute("data-bs-toggle", "tooltip");
    button.setAttribute("data-bs-title", label);
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

    // Everything below except the symbol-pool section is the "standard"
    // numeric-dice UI, grouped so refreshDiceAndMoveButtons can hide it all
    // at once for a System whose dice are all Tier-3 symbol dice.
    const standardSection = document.createElement("div");
    standardSection.className = "d-flex flex-column gap-3";
    standardSection.setAttribute("data-dice-standard-section", "");
    form.appendChild(standardSection);

    const quickGrid = document.createElement("div");
    quickGrid.className = "dice-quick-grid";
    quickGrid.setAttribute("data-dice-quick", "");
    // Die buttons are populated by renderDiceQuickButtons() below, not here
    // — they depend on activeQuickDice, not known yet on first build.
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

    // Named Rolls/Moves — a curated button per System-defined roll, in its
    // own row, not mixed with the quick-dice grid: a quick-dice button only
    // edits the expression (nothing rolls until Roll is clicked), while a
    // Move button is a one-click roller. Populated by renderMoveButtons();
    // hidden entirely for a System with no "rolls" field.
    const movesRow = document.createElement("div");
    movesRow.className = "dice-quick-grid";
    movesRow.setAttribute("data-dice-moves", "");
    standardSection.appendChild(movesRow);

    // Tier-3 symbol-dice pool — a +/- stepper per symbol die instead of a
    // text expression, since "assemble this ad hoc pool" doesn't work as a
    // formula string. Hidden unless the active System declares symbol
    // dice; populated by refreshDiceAndMoveButtons/renderSymbolPool below.
    const symbolSection = document.createElement("div");
    symbolSection.className = "d-flex flex-column gap-2";
    symbolSection.setAttribute("data-dice-symbol-section", "");
    // NOT `.hidden` — see setElementVisible (dom.js): no-ops on `d-flex`.
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

  // (Re)builds the Moves button row from activeSystemRolls — same
  // "static chrome once, rebuild buttons on data change" split
  // renderDiceQuickButtons uses, both from refreshDiceAndMoveButtons.
  function renderMoveButtons() {
    if (!elements.diceMovesRow) {
      return;
    }
    // Disposed before removal, not after — see tooltips.js's BUG CLASS 2.
    // Scoped to diceMovesRow, not the whole canvasRoot sweep, since this
    // rebuilds independently on every System-resolution refresh.
    disposeTooltips(elements.diceMovesRow);
    moveButtons.forEach((button) => button.remove());
    moveButtons.clear();
    // NOT `.hidden` — `.dice-quick-grid`'s `display: grid` always beats the
    // `[hidden]` UA rule regardless of specificity. See dom.js's setElementVisible.
    setElementVisible(elements.diceMovesRow, activeSystemRolls.length > 0, "grid");
    activeSystemRolls.forEach((move, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline-primary btn-sm";
      button.textContent = move.label;
      button.setAttribute("aria-label", `Roll ${move.label}`);
      if (move.expression) {
        button.setAttribute("data-bs-toggle", "tooltip");
        button.setAttribute("data-bs-title", move.expression);
      }
      // One-click — inserts this Move's shortName into the expression box
      // and rolls that, the same path as typing the shortName by hand,
      // rather than calling rollSystemMove directly. Quick-dice buttons
      // stay insert-only since they stack multiple dice into one
      // expression; a Move is already a complete expression on its own.
      button.addEventListener("click", () => {
        if (elements.diceExpression) {
          elements.diceExpression.value = move.shortName;
          syncQuickDiceButtons();
        }
        void executeDiceRoll(move.shortName, { updateInput: false });
      });
      moveButtons.set(index, button);
      elements.diceMovesRow.appendChild(button);
    });
    refreshTooltips(elements.diceMovesRow);
  }

  // (Re)builds the quick-dice buttons from activeQuickDice — called once
  // by initDiceRoller on first mount, and again by refreshDiceAndMoveButtons
  // whenever the active System's dice change, since group/System context
  // resolves asynchronously after the panel's static chrome is built.
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
  // static-chrome/rebuild-on-change split as renderDiceQuickButtons. Counts
  // persist across re-renders/rolls so a pool stays "loaded" the way a
  // physical dice pool would; only navigating away or the System changing
  // clears symbolPoolCounts.
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

  // Rolls the current symbol-pool stepper counts via the dedicated
  // symbol-dice engine — never rollExpression/rollDiceExpression, since a
  // symbol pool has no numeric total. Posts to the Game Log via
  // recordGameLogRoll's `verdict` slot, no numeric total shown.
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

  // Re-resolves activeQuickDice, activeSystemRolls, and activeSymbolDice
  // (group-then-character priority, shared by all three) and rebuilds every
  // row — called from updateSystemContext once the character's System is
  // known; needs its own group-context lookup since updateSystemContext
  // only resolves the character's own System, not the active Group's.
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
    // — no meaningful hybrid, since a narrative dice-pool System has no
    // numeric expression worth typing.
    //
    // NOT `.hidden` — both sections carry `d-flex`, and Bootstrap's
    // `!important` always beats the `[hidden]` UA rule, so Roll and Roll
    // pool could both show at once. See dom.js's setElementVisible.
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
        // Same filter as the Template view's loadTemplateRecords — a
        // character can only open with a character template.
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

  // Populates groupCatalog for the character picker's "Campaigns" optgroup
  // — includeMemberGroups: true is the same scope syncGameLogContext's
  // dataManager.listGroups call uses (owned + member-via-character
  // campaigns), and dataManager's request-level cache means this doesn't cost a second
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
      // Public library characters (is_public=1 rows, owned by whoever
      // authored them) — reads remote.public explicitly, unlike
      // loadTemplateRecords' own collectListEntries which already defaults
      // to ["items","owned","shared","public"]. ownership:"public" is
      // already handled downstream (characterOwnership/
      // describeCharacterEditRestriction), so this is just the catalog entry.
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

      // Local storage mirrors every remote save, so a character deleted
      // elsewhere (Loom, a separate tab) leaves a stale local copy that
      // would otherwise linger forever. This fresh owned/shared/public
      // listing is authoritative — anything missing from it is confirmed
      // gone and pruned, same as handleCharacterLoadFailure does for a
      // 404'd load. Builtin/local-only (anonymous) entries untouched.
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

  // Mounts the same Game Log widget the Dashboard uses into this section's
  // content area — no dashboard-toggle affordances, since Workbench has no
  // per-viewer dashboard for a spotlight icon to add/remove itself from;
  // the widget's own fallback already renders those non-interactive. No
  // setRightAction either — only the Refresh button below. Always mounted,
  // even with an empty groupId/shareToken — the widget's own render()
  // already shows "No active campaign" for that case.
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

  // (Re)subscribes state.groupContext to the active campaign's Group
  // Properties — remounted alongside the Game Log widget, off the same
  // gameLogContext (see syncGameLogContext) rather than re-resolving
  // group/access a second time. `isOwner` is captured once, since it only
  // changes when this whole function re-runs.
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
      isOwner: gameLogContext.access === "owner",
      onChange: (payload) => {
        // The active campaign may have already moved on by the time this
        // resolves — discard rather than repopulating the wrong group's data.
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
  // just always landing on the empty case, so both share one `changed`
  // remount decision.
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

  // "Now Showing" — the same read-only icon strip Dashboard uses for its
  // floating spotlight panel, mounted inline here with `interactive: false`
  // since Workbench has no per-viewer dashboard for a click to add/remove
  // something from — every icon just reports what's shown. Shows the full
  // currently-active set, same as Dashboard's panel, rather than a
  // single-slot rich preview.
  // Two conditions decide whether this section shows: an active spotlight
  // AND the top-level mode being Character (Now Showing has no place in
  // the Template editor). workbench.js sets document.body.dataset.
  // workbenchMode on every switch; this section no longer carries
  // data-workbench-mode-panel itself, so this is the only gate. Toggles
  // Bootstrap's `!important` .d-flex/.d-none classes rather than the plain
  // `hidden` attribute, which a `!important` display class would defeat.
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
    // A spotlight flagged data.hidden (combat-tracker.js's hideFromTable)
    // is invisible everywhere, not just to players — same filter
    // dashboard.js's refreshSpotlightPanel applies.
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
    // watchActiveSpotlights' guard never calls onChange without a
    // groupId/shareToken — clear whatever was showing, since nothing else will.
    if (!gameLogContext.groupId && !gameLogContext.shareToken) {
      renderNowShowing([]);
    }
  }

  // A plain chat message goes through the mounted Game Log widget's own
  // form — this is the one kind of log entry Workbench still posts
  // directly, since the shared widget only displays rolls, never initiates
  // them (game-log.js's describeEntry "roll" case). Posts to the same
  // createGroupLogEntry endpoint, then refreshes the widget immediately
  // rather than waiting for its next poll/live-stream tick.
  // No-ops without an active campaign — the roll result still renders
  // inline wherever the dice roller shows it, so nothing is lost except a
  // persistent log entry with nowhere to go.
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
      // A System-defined Move's matched band/compare label (e.g. "Partial
      // Success") — optional, absent for a plain roll.
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
      // Resolve real ownership rather than assuming "owner" — listGroups'
      // member scope (group-context.js's resolveGroupContext) lets a mere
      // member select a campaign they don't own, and this file has GM-only
      // controls gated on gameLogContext's access that shouldn't show for
      // a non-owner even though the server would still reject the action.
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
        // Falls through to the unconditional-owner shape below, matching
        // group-context.js's identical fallback.
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
    // Hidden whenever there's nothing actionable — no share token, or a
    // token but every character in the group is already claimed.
    // Loading/error keep the section visible with its own message; only
    // the terminal "nothing to claim" state hides it entirely.
    // setElementVisible (NOT `.hidden`) — this element carries `.d-flex`,
    // which beats the native [hidden] rule (dom.js's setElementVisible).
    // Targets a dedicated inner wrapper, not the outer
    // [data-group-share-section] — that's also gated by workbench.js's own
    // Character/Template mode toggle, and both toggles on one element
    // would fight over the same node.
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
      // Section is already hidden — just clear leftover status text.
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
      let metadata = templateCatalog.get(id);
      if (!metadata) {
        // The local catalog only lists templates this user owns/shares/sees as public — a
        // campaign member's own Party Template usually belongs to the GM and was never
        // separately shared. Fall back to a direct fetch, which storage.py's
        // _template_visible_via_group grants any member of a group using this template.
        const fallback = await dataManager.get("templates", id, { preferLocal: false }).catch(() => null);
        if (fallback?.payload) {
          registerTemplateRecord({ id, title: fallback.payload.title || fallback.payload.name || id, source: "remote" });
          metadata = templateCatalog.get(id);
        }
      }
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

  // This file caches its own copy of a template on character load, so a save
  // from the Template editor tab needs an explicit push here or it stays stale.
  // No-op unless the open character actually uses the saved template.
  async function reloadTemplateIfActive(templateId) {
    if (!templateId || !state.draft || state.draft.template !== templateId) {
      return;
    }
    await loadTemplateById(templateId);
  }

  // "Party Data" mode: the same Template/Component/Binding engine as a
  // character sheet, rooted at a Group instead — state.draft stays {}, and
  // every component in the Party Template is expected to bind only to
  // @group.* paths (getBindingContext/updateGroupBinding already handle a
  // null character). Setting the campaign active makes picking it here
  // equivalent to the header's own selector, so Now Showing/Game Log follow
  // along the same as any other campaign switch.
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
    // state.mode is deliberately left untouched (same as loadCharacter) so
    // switching to Party Data mid-Edit stays in Edit mode; a caller that
    // wants view mode sets state.mode itself first.
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
      // /content/group/{id} only grants a non-owner reader via a share token — a
      // member with neither always 401'd here. gameLogContext.access/shareToken were
      // just resolved for this groupId by syncGameLogContext above, so the right
      // route is already known rather than guessed. preferLocal: false since this is
      // the authoritative editor, same as loadCharacter/loadTemplateById below.
      if (gameLogContext.access === "owner" || gameLogContext.shareToken) {
        const result = await dataManager.get("group", groupId, {
          shareToken: gameLogContext.shareToken,
          preferLocal: false,
        });
        templateId = result?.payload?.templateId || "";
      } else {
        const result = await dataManager.getGroupProperties(groupId);
        templateId = result?.templateId || "";
      }
    } catch (error) {
      console.error("Character editor: failed to load campaign", error);
      status.show("Unable to load this campaign", { type: "error", timeout: 2500 });
      return;
    }
    // The active campaign may have moved on while this fetch was in flight —
    // discard rather than loading the wrong campaign's template.
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
    // Re-sync now that state.template is populated — the earlier call above ran
    // before this fetch started and always saw partyMode with no template yet.
    syncCharacterActions();
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
      // preferLocal: false — a template gets edited directly in Loom out from under
      // whatever this browser last cached; a stale copy would silently render an old
      // sheet layout. Same reasoning as fetchCharacterPayload and Loom's editor.
      const result = await dataManager.get("templates", metadata.id, { preferLocal: false });
      return result?.payload || null;
    }
    return null;
  }

  function applyTemplateData(payload, { origin = "remote", id = "" } = {}) {
    const template = {
      // Library-sourced templates never embed their own id in the JSON body — fall
      // back to the id this was actually fetched by.
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
      // This file keeps its own separate template object from workbench-template-view.js,
      // so baseFontFamily/background/border need the same normalization duplicated here.
      baseFontFamily: typeof payload.baseFontFamily === "string" ? payload.baseFontFamily : "",
      defaults: normalizeTemplateDefaults(payload.defaults),
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
    // `state.draft?.id`, not just `state.draft` — Party Data mode leaves state.draft
    // at the truthy {} "no character" sentinel; without this, loading a Party
    // Template would write a stray `template` key into that empty draft.
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
      // Library-sourced characters never embed their own id in the JSON body — it's
      // the key fetched by, not a field inside it. Relying on a Workbench-created
      // character's own embedded id would leave state.draft.id undefined for
      // anything Loom manages.
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
      // Pre-warm every id-storage Repeater's reference cache (e.g. Features' @featureIds)
      // on load rather than lazily on that tab's first render, which used to show every
      // chip as a raw id until the fetch resolved. Fire-and-forget.
      collectIdStorageKinds(state.components).forEach((kind) => ensureSourceKindCached(kind));
      void refreshRelationshipsSection();
      syncCharacterOptions();
      syncCharacterActions();
      syncCharacterToolbarVisibility();
      // Always expands on load — holds Level Up/Add a Class/Re-import, core actions
      // relevant to every character, not just a "something's waiting" indicator.
      expandCharacterPropertiesSection();
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

    // removeCharacterRecord below only clears this page's in-memory catalog — a later
    // full catalog refresh would re-fetch the still-present server row otherwise.
    // Scoped to a confirmed-gone character record (never a Template hiccup, never
    // "builtin" — see markBuiltinMissing above). Fire-and-forget; the caller's toast
    // choice can't wait on it, and failure here is no worse than the stale row.
    if (isMissingCharacter && source !== "builtin") {
      dataManager.delete("characters", id, { mode: "auto" }).catch((cleanupError) => {
        console.warn("Character editor: unable to clean up orphaned catalog entry for", id, cleanupError);
      });
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
      // preferLocal: false — unlike the "local" branch above (a genuinely local-only
      // draft with no server copy), a "remote" character is server-synced. The cache
      // key "characters" has no awareness it's the same server record as Loom's
      // "character" bucket, so it can drift silently stale. Same as Loom's loadLibraryEntry.
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
    // Dispose every tooltip under the canvas BEFORE wiping it — this is the
    // single most-hit "lingering tooltip" bug site in the suite (renderCanvas
    // runs on every component add/remove/reorder/property edit), confirmed
    // real: refreshTooltips() further down only re-arms whatever's freshly
    // rebuilt, it does nothing for a popup a just-destroyed component's own
    // tooltip left behind on <body>.
    disposeTooltips(elements.canvasRoot);
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

  // Placeholder for a character with no `template` at all (vs. one whose linked
  // template failed to load): an actionable inline picker, not just plain text.
  // Most often reached for a raw Loom/DDB import.
  function createUntemplatedCharacterPrompt() {
    const wrap = document.createElement("div");
    wrap.className = "workbench-drop-placeholder workbench-drop-placeholder--root d-flex flex-column align-items-center gap-2";
    const message = document.createElement("div");
    message.textContent = "This character has no template assigned yet — pick one to start its sheet.";
    wrap.appendChild(message);

    const row = document.createElement("div");
    row.className = "d-flex gap-2 align-items-center";
    // .workbench-drop-placeholder sets pointer-events: none suite-wide (correct for
    // its usual decorative empty-dropzone job) — re-enable it here or the select/
    // button below silently never receive pointer events.
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

  // Wires an already-existing character (most often a template-less Loom/DDB
  // import) up to a Workbench template. Loads the template, sets `draft.template`,
  // and unions the template's schema into `draft.systemIds` (never replaces — an
  // imported character may already carry its own Assigned Systems), then persists.
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

  // `nested: true` for a Container zone child goes "bare": this file never shows the
  // type-icon badge/actions row in either Edit or Play mode — that's a
  // Template-editor-only affordance (a separate function there, not shared with
  // this one). Edit and Play render identically here except for isEditable().
  function renderComponentCard(component, { nested = false } = {}) {
    if (!isComponentVisible(component)) {
      return null;
    }
    const bare = nested;
    const collapsible = isComponentCollapsible(component);
    // `bare` drops the card box — the outer Container's own card already provides
    // that boundary once, so a nested child sits flush instead of stacking a second.
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
    // Resolved ONCE for both content and the wrapper's own applyComponentStyles below —
    // previously computed twice, with content getting the raw (unresolved-color)
    // component. Safe for every interactive renderer too — write-back keys off
    // component.uid/binding, never the object reference.
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
        // A binding resolving to an array (a System field authored onto an Input
        // with no dedicated Repeater built for it) used to reach renderInputComponent
        // and corrupt itself on typing. Real fallback: a generic rows-of-columns
        // editor. Only intercepts Input — Repeater handles its own array data already.
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

  // itemContext ({repeaterComponent, index, item}), when set, means this control
  // renders inside a Repeater item template — reads/writes scope to that array
  // item's own field instead of the top-level draft. Every editable component
  // type follows this pattern so Repeater items get the same control as elsewhere.
  //
  // Resolves this component's bound path's PARENT (binding minus trailing `.name`,
  // or the whole item for a bare "@name") and checks whether it resolves to a
  // {refKind, refId, name} object — the sibling-reference lookup Text/Input's chip
  // detection needs. A plain path getter, not resolveComponentValue (formula/
  // roller-aware, meant for the component's own bound leaf).
  function resolveComponentReference(comp, itemContext) {
    const binding = typeof comp.binding === "string" ? comp.binding : "";
    if (binding === "@name") {
      if (!itemContext) return null;
      const parentValue = resolveItemContextValue(itemContext, "@value");
      return isReferenceValue(parentValue) ? parentValue : null;
    }
    if (!binding.endsWith(".name")) return null;
    const parentBinding = binding.slice(0, -".name".length);
    const parentValue = itemContext
      ? resolveItemContextValue(itemContext, parentBinding)
      : (() => {
          const path = resolveBindingPath(parentBinding);
          return path ? getValueAtContext(getBindingContext(), path) : undefined;
        })();
    return isReferenceValue(parentValue) ? parentValue : null;
  }

  function renderInputComponent(component, itemContext = null) {
    const writeValue = (comp, value) => {
      if (itemContext) {
        setItemContextValue(itemContext, comp.binding, value);
      } else {
        updateBinding(comp.binding, value);
      }
    };
    return renderInputContent(component, {
      dataManager,
      // Same shape as renderImageComponent's ctx — Button's Icon/Image fields
      // resolve "@path"/"=formula" exactly like the real Icon/Image components do.
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
      resolveValue(comp, fallback) {
        if (itemContext) {
          const resolved = resolveItemContextValue(itemContext, comp.binding);
          return resolved != null ? resolved : fallback;
        }
        return resolveComponentValue(comp, fallback);
      },
      resolveReference(comp) {
        return resolveComponentReference(comp, itemContext);
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
      // A Checkbox/Radio group variant used to never consult its own Source binding
      // (only Select did) — a Source-bound checkbox group (e.g. BitD's Trauma/Armor/
      // Load) fell back to the component's static placeholder options instead of the
      // System's real vocabulary. Reuses resolveSelectionOptions rather than a second
      // fallback copy. allowBlank: false — no blank pill for a multi-select group.
      resolveChoiceOptions(comp) {
        return resolveSelectionOptions(comp, { allowBlank: false, itemContext });
      },
      // Play view only (caller already checked !editable) — reads like plain text
      // instead of a grayed-out disabled control. Edit view keeps the normal boxed
      // look, since a locked/formula-driven field there should still read as a real
      // field, just not touchable right now.
      plainReadOnly() {
        return state.mode !== "edit";
      },
      decorate(el, comp, meta) {
        assignBindingMetadata(el, comp, meta);
      },
      // Play/Edit's real executor. The Template editor's own preview passes an inert
      // no-op here instead.
      runButtonAction(comp) {
        void runButtonComponentAction(comp, itemContext);
      },
      // Number fields authored "Editable in Play" (HP, AC, ...) get +/- stepper
      // buttons instead of a plain input, for fast mid-combat adjustment. Item-aware
      // (isRepeaterItemNodeEditableInPlay) so a per-row counter inside a Repeater
      // gets the spinner too, not just top-level fields.
      wrapControl(input, comp, { labelText, editable }) {
        const variant = (comp.variant || "text").toLowerCase();
        const editableInPlay = itemContext
          ? isRepeaterItemNodeEditableInPlay(comp, itemContext.item)
          : isComponentEditableInPlay(comp);
        if (editable && variant === "number" && editableInPlay) {
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
        // Shown in both Play and Edit view — a rollable field is just as useful to
        // roll while editing as while playing.
        const showRollOverlay = Array.isArray(rollExpressions) && rollExpressions.length > 0;
        if (showRollOverlay) {
          input.classList.add("character-rollable-input");
        }
        inputContainer.appendChild(input);
        if (showRollOverlay) {
          inputContainer.appendChild(createRollOverlayButton(comp, rollExpressions, input));
        }
        return inputContainer;
      },
    });
  }

  // True only for a plain field-shaped object with a real "value" property of its
  // own (e.g. Saving Throws/Skills' `{name, proficiency, friendlyName, value}`) —
  // an array never has one, so BitD's bare `playbooks.Cutter` array is unaffected.
  // Shared between the read and write sides so they can't disagree.
  function itemHasOwnValueField(item) {
    return item !== null && typeof item === "object" && !Array.isArray(item) && Object.prototype.hasOwnProperty.call(item, "value");
  }

  // Resolves ONE item-template node's value against a single repeater item's data —
  // Press's per-item context convention: an object item's fields spread directly
  // into scope ("@name" means item.name), a primitive item binds via "@value".
  // See resolveRepeaterItemPath/setRepeaterItemValue below for the write-back side.
  //
  // "@value" means "this item itself" — EXCEPT when the item is a plain object with
  // its own real "value" field (itemHasOwnValueField), which resolves as a normal
  // property lookup instead, or that field becomes unreachable (the D&D "Character -
  // Tabs" template's Saving Throws/Skills items are exactly this shape). The "@value
  // means the whole item" convention still matters for source-driven Tabs, where the
  // item genuinely IS a bare array with nothing to shadow (e.g. BitD's `playbooks.Cutter`).
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

  // Single write dispatch every item-template node's writeValue closure calls,
  // instead of calling setRepeaterItemValue directly — picks the right strategy
  // for itemContext.kind ("repeater" vs "tab") so callers stay agnostic.
  function setItemContextValue(itemContext, raw, value) {
    if (itemContext?.kind === "tab") {
      setTabItemValue(raw, itemContext.key, value);
    } else {
      setRepeaterItemValue(itemContext?.repeaterComponent, itemContext?.index, raw, value);
    }
  }

  // Read counterpart to setItemContextValue. For `kind: "tab"`, itemContext.item is
  // the tab's SYSTEM-sourced item (e.g. a playbook's bare abilities array), which has
  // no character-draft properties on it — resolving against it directly always read
  // back undefined even though the write side correctly wrote into the draft.
  function resolveItemContextValue(itemContext, raw) {
    if (itemContext?.kind === "tab") {
      const pathSegments = resolveTabItemPath(raw, itemContext.key);
      // getBindingContext() is state.draft plus a "group" key — this is what makes
      // "@group.resources.{item}.current" resolvable.
      return pathSegments ? getValueAtContext(getBindingContext(), pathSegments) : undefined;
    }
    return resolveRepeaterItemValue(itemContext?.item, raw);
  }

  // One item-template node, rendered against one item. Input/Toggle/Select Group/
  // Track delegate to their own top-level renderers (with an itemContext override)
  // so an item control matches its top-level counterpart exactly, rather than a
  // separate hand-rolled implementation per type. Container/Repeater nested inside
  // an item template stay unsupported, falling back to a plain resolved-value text
  // line. repeaterComponent is omitted for a header cell — no specific array item
  // to write back to, so Input/Toggle/Select Group/Track fall back to top-level
  // rendering (headers render with the outer context, not item context).
  // Shared by renderRepeaterItemNode and renderTabItemNode below. `item` stays a
  // separate parameter — a header-row call (itemContext null) still needs it.
  function dispatchItemContextNode(node, item, itemContext) {
    // Resolved ONCE for the content dispatch AND the final applyComponentStyles call.
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
        // A Repeater nested inside another Repeater's item template — itemContext
        // (the outer repeater's own item/index) makes the nested Repeater's binding
        // resolve relative to THIS row rather than the top-level draft.
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
    // An item-template node deliberately skips renderComponentCard (no chrome
    // belongs on a repeater row cell), which also skips its applyComponentStyles
    // call — applied here once, after dispatch, so no future type in this switch
    // can miss it.
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

  // Source-driven Tabs' entry point (Container's tabLabelsSourceBinding) — same
  // dispatch as a Repeater item, but no character-owned array to index into (the
  // tab's "item" comes from System data), so writes key off `key` (the tab's
  // stable identity) via resolveTabItemPath/setTabItemValue instead of an index.
  function renderTabItemNode(node, item, containerComponent, index, key) {
    const itemContext = { kind: "tab", item, key, index, ownerComponent: containerComponent };
    return dispatchItemContextNode(node, item, itemContext);
  }

  // Ported from Press's Repeater decorator (none/bullet/number/custom) — bullet is
  // a literal "•", number is "N.", custom is a literal string or (if it starts
  // with "@") resolved per-item via resolveRepeaterItemValue.
  function resolveRepeaterDecorator(component, item, index) {
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : null;
    const type = decorator?.type || "none";
    if (type === "bullet") return "•";
    if (type === "number") return `${index + 1}.`;
    if (type === "custom") {
      // formula first, same precedence as Text/Icon/Image/Container — always
      // resolves against the current item, no top-level mode to consider.
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

  // Reads one column's zone nodes for a row-kind ("item"/"header"), falling back to
  // the legacy single `zones.item` array for item-column 0 — an old saved template
  // keeps this shape until it's next re-saved in the Template editor (which has its
  // own migration); this file has no equivalent hydrate pass to rely on instead.
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
    // A row whose own template nodes are all hidden (e.g. Speed of 0) renders
    // nothing at all, not an empty shell — the wrapper's flex `gap` applies
    // between every child regardless of content, so an empty row still ate a gap
    // on each side. `onRemoveItem` alone isn't reason to keep an otherwise-empty row.
    const visibleNodes = templateNodes.filter((node) => isRepeaterItemNodeVisible(node, item));
    if (!visibleNodes.length) return null;
    const row = document.createElement("div");
    // Divider is opt-in (component.itemDivider), never forced.
    row.className = component.itemDivider ? "d-flex align-items-start gap-2 border-bottom pb-2" : "d-flex align-items-start gap-2";
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
    visibleNodes.forEach((node) => {
      body.appendChild(renderRepeaterItemNode(node, item, component, index));
    });
    row.appendChild(body);
    if (onRemoveItem) {
      row.appendChild(createRepeaterRemoveButton(() => onRemoveItem(index)));
    }
    return row;
  }

  // The non-repeating header block for list mode (columns <= 1), rendered once
  // from the "header-0" zone. renderRepeaterTable is the columns > 1 counterpart.
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

  // A real <table>/<colgroup>/<thead>/<tbody> for a multi-column Repeater, ported
  // from Press's own "table" mode — not a CSS Grid, since the header row must
  // render exactly once regardless of item count, which Container zones can't do.
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

  // Horizontal's single-item-template case (rows === 1, the ability-score box case):
  // one item template repeated per array item, flowing left-to-right. Mirrors
  // renderRepeaterItemRow as a self-contained cell for a flex ROW of siblings.
  function renderRepeaterHorizontalItemCell(component, templateNodes, item, index, onRemoveItem = null) {
    // Same "nothing visible, render nothing" reasoning as renderRepeaterItemRow.
    const visibleNodes = templateNodes.filter((node) => isRepeaterItemNodeVisible(node, item));
    if (!visibleNodes.length) return null;
    const cell = document.createElement("div");
    cell.className = "d-flex flex-column gap-1";
    cell.dataset.repeaterIndex = String(index);
    // "Fill available width" (Horizontal-only) grows every cell equally instead of
    // each sizing to content. min-width:0 lets a flex-grow cell shrink below content.
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
    visibleNodes.forEach((node) => {
      cell.appendChild(renderRepeaterItemNode(node, item, component, index));
    });
    if (onRemoveItem) {
      cell.appendChild(createRepeaterRemoveButton(() => onRemoveItem(index)));
    }
    return cell;
  }

  // The non-repeating header cell for Horizontal's rows===1 case, placed before the
  // repeated items. renderRepeaterHorizontalGrid's own header column is the rows>1
  // counterpart.
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
    // Matches Container's own "Grid gap (px)" field — was previously a fixed
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
      const cell = renderRepeaterHorizontalItemCell(component, templateNodes, item, index, onRemoveItem);
      if (cell) row.appendChild(cell);
    });
    return row;
  }

  // Horizontal's multi-row case (rows > 1): the transpose of Vertical table mode.
  // Array items become GRID COLUMNS (auto-generated, no fixed count) instead of
  // table rows, and `rows` field templates become fixed GRID ROWS within each
  // item's column. CSS Grid, not a <table>, since items have no fixed count for a
  // <colgroup>-style width list. Decorator becomes an extra grid ROW of per-item
  // markers (transposed from Vertical's per-item column).
  function renderRepeaterHorizontalGrid(component, rows, itemColumns, items, onRemoveItem = null) {
    const grid = document.createElement("div");
    grid.className = "workbench-repeater-grid";
    const decorator = component.decorator && typeof component.decorator === "object" ? component.decorator : null;
    const hasDecorator = Boolean(decorator && decorator.type && decorator.type !== "none");
    const totalGridRows = rows + (hasDecorator ? 1 : 0) + (onRemoveItem ? 1 : 0);
    grid.style.gridTemplateRows = `repeat(${totalGridRows}, auto)`;
    // Overrides .workbench-repeater-grid's own fixed CSS gap (shell.css).
    const gapPx = Number.isFinite(Number(component.gap)) ? Number(component.gap) : 16;
    grid.style.gap = `${gapPx}px`;
    // "Fill available width": grid-auto-columns applies uniformly to every column
    // including the header, so a plain CSS override would stretch it too. items.length
    // is known at render time, so an explicit grid-template-columns keeps the header
    // column at its natural width while only the N item columns share the remainder.
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
    // A bare icon button with no visible tooltip is never acceptable in
    // this suite — aria-label alone covers screen readers, not a sighted
    // user hovering it. initTooltip is the same mechanism every other icon
    // button's tooltip already goes through.
    initTooltip(button, { title: "Remove item" });
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
  function createRepeaterAddButton(onAdd, { label = "Add item" } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    // Standard size (not btn-sm), no align-self override — when this sits
    // beside a Source picker's own input-group (Inventory's "Add custom
    // item"), it needs to match that control's height and vertical center
    // exactly, not anchor to its own top edge at a smaller size.
    button.className = "btn btn-outline-secondary d-inline-flex align-items-center gap-1";
    const icon = document.createElement("span");
    icon.className = "iconify";
    icon.dataset.icon = "tabler:plus";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.appendChild(document.createTextNode(label));
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
  // A Repeater's own binding sometimes points at a System field authored as
  // a fixed-keys OBJECT (sys.dnd5e.json's own "abilities" field —
  // {strength, dexterity, ...}), not an array — Ability Scores is the
  // motivating case, but this applies to ANY object-shaped binding, not
  // something hardcoded to "abilities" specifically. Confirmed real bug
  // this fixes: such a Repeater always showed "No items." —
  // Array.isArray(value) is false for a plain object, so `items` came back
  // empty regardless of how much real data the object held. Converts it
  // into the same per-entry shape a genuinely array-authored field (Saving
  // Throws, Skills) already stores directly on each of ITS OWN items:
  // {key, label, shortName, value}. shortName/label come from the matching
  // System field's own per-child metadata (e.g. abilities.children[]
  // .shortName) when the active System declares one — an item template
  // referencing @shortName (Ability Scores' own label + its
  // lookup("abilities", @shortName) border color) has nothing else to
  // resolve that from. `score` duplicates `value` under the specific name
  // Ability Scores' own item template already binds to (@score), authored
  // before this conversion existed — kept as an alias rather than forcing
  // a template edit for an already-correct binding.
  function expandObjectBindingToRepeaterItems(value, component) {
    const path = resolveBindingPath(component?.binding);
    const fieldKey = path && path.length ? path[path.length - 1] : "";
    const systemFields = Array.isArray(state.systemDefinition?.fields) ? state.systemDefinition.fields : [];
    const systemField = fieldKey ? systemFields.find((field) => field?.key === fieldKey) : null;
    const metaByKey = new Map();
    (Array.isArray(systemField?.children) ? systemField.children : []).forEach((child) => {
      const childKey = typeof child?.key === "string" ? child.key.split(".").pop() : "";
      if (childKey) metaByKey.set(childKey, child);
    });
    return Object.entries(value).map(([key, val]) => {
      const meta = metaByKey.get(key) || {};
      return {
        key,
        label: meta.label || key,
        shortName: meta.shortName || key.slice(0, 3).toUpperCase(),
        value: val,
        score: val,
      };
    });
  }

  // A Repeater's stored array is sometimes a COLLAPSED-REFERENCE array — bare
  // Library-kind ids (Character.featureIds, a structural convention shared with
  // Monster/NPC/Class/Species/Variant) even though the item template's cells
  // expect real object fields to bind against. `component.itemStorage === "id"` is
  // an ordinary authored field, so a Template author sees/changes it in the
  // Inspector. Which KIND to resolve against comes from the item template's own
  // pickable cell, never a hardcoded kind name, and reuses the same per-kind cache
  // the Add picker populates (sourceKindCache below).
  function isIdStorageRepeater(component) {
    return component?.itemStorage === "id";
  }

  // Reads a Repeater's real pickable cell, wherever it lives in the item template,
  // purely to get back its sourceFormula for the two display-side callers below
  // that need to know which kind a collapsed-reference array resolves against.
  function findRepeaterSourceFormula(component) {
    const columns = getRepeaterColumnCount(component);
    const itemColumns = Array.from({ length: columns }, (_, col) => getRepeaterColumnZoneNodes(component, "item", col));
    const cell = findPickableCell(itemColumns.flat());
    return typeof cell?.sourceFormula === "string" ? cell.sourceFormula : "";
  }

  function expandIdStorageItems(component, ids) {
    const kind = sourceFormulaKind(findRepeaterSourceFormula(component));
    if (!kind) return [];
    if (!sourceKindCache.has(kind)) {
      ensureSourceKindCached(kind);
      return [];
    }
    const entries = sourceKindCache.get(kind) || [];
    const byId = new Map(entries.map((entry) => [entry.id, entry.entity]));
    return (Array.isArray(ids) ? ids : [])
      .filter((id) => typeof id === "string" && id)
      .map((id) => {
        const entity = byId.get(id);
        return { refKind: kind, refId: id, name: entity?.name || id, description: resolveNotes(entity) };
      });
  }

  // Walks the whole template's component tree collecting distinct Library kinds
  // every id-storage Repeater resolves against, to pre-warm those kinds' caches on
  // character load. Generic over however many such repeaters exist, not hardcoded
  // to "feature".
  function collectIdStorageKinds(nodes) {
    const kinds = new Set();
    const walk = (list) => {
      for (const node of list || []) {
        if (!node) continue;
        if (node.type === "repeater" && isIdStorageRepeater(node)) {
          const kind = sourceFormulaKind(findRepeaterSourceFormula(node));
          if (kind) kinds.add(kind);
        }
        if (node.zones && typeof node.zones === "object") {
          Object.values(node.zones).forEach(walk);
        }
      }
    };
    walk(nodes);
    return [...kinds];
  }

  // --- Source-bound Add pickers for Repeaters -----------------------------
  // A Repeater's Add control normally just pushes a blank row. When authored with
  // a Source/Options binding (same field every Select has, now also accepting a
  // formula), Add opens a picker over that source instead of hand-typing a value
  // that already has a real authored home. `sourceBinding`/`sourceFormula` are
  // ordinary authored fields; `libraryEntries`'s filter arguments are plain data.

  // Per-kind Library entry cache — shared by the Add picker AND expandIdStorageItems
  // above, so displaying and adding an id-storage Repeater row never fetch a kind
  // twice. fetchKindEntriesWithIds is already cross-visit-cached (content-fetch.js).
  const sourceKindCache = new Map();
  const sourceKindFetchInFlight = new Set();
  function ensureSourceKindCached(kind) {
    if (!kind || sourceKindCache.has(kind) || sourceKindFetchInFlight.has(kind) || !dataManager) return;
    sourceKindFetchInFlight.add(kind);
    fetchKindEntriesWithIds(dataManager, kind)
      .then((entries) => {
        sourceKindCache.set(kind, entries);
        renderCanvas();
      })
      .catch(() => {
        sourceKindCache.set(kind, []);
      })
      .finally(() => {
        sourceKindFetchInFlight.delete(kind);
      });
  }

  // Registered as a real formula function alongside `lookup`, so a Source/Options
  // field holding "=libraryEntries('wonder', 'properties.form', 'spell')" resolves
  // through the ordinary formula engine. `path`/`value` are always plain literal
  // arguments, never a nested "@..." formula — evaluateFormula's "@path"
  // substitution runs blindly across the whole formula before any call is parsed,
  // so a per-candidate formula-as-string would get mangled. Covers: a scalar
  // match, a negated scalar match (leading "!"), and an array-contains match.
  // Omitting path/value returns every entry of the kind unfiltered.
  function libraryEntries(kind, path, value) {
    if (!kind || typeof kind !== "string") return [];
    if (!sourceKindCache.has(kind)) {
      ensureSourceKindCached(kind);
      return [];
    }
    const entries = sourceKindCache.get(kind) || [];
    if (!path) return entries;
    const negate = typeof value === "string" && value.startsWith("!");
    const target = negate ? value.slice(1) : value;
    return entries.filter((entry) => {
      const raw = resolveDottedPath(entry.entity, path);
      const matches = Array.isArray(raw) ? raw.includes(target) : raw === target;
      return negate ? !matches : matches;
    });
  }

  // Recursively collects every `refId` off an object anywhere in `root` whose
  // `refKind === kind` — the suite's ordinary ref shape, read generically rather
  // than via a hardcoded path per kind. Shared by restrictByCharacterKind below to
  // resolve both sides of a match with the same one function.
  function collectRefIdsForKind(root, kind) {
    const found = new Set();
    const visit = (node) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (node && typeof node === "object") {
        if (node.refKind === kind && node.refId) found.add(node.refId);
        Object.values(node).forEach(visit);
      }
    };
    visit(root);
    return found;
  }

  // A separate formula function from libraryEntries rather than folded into it —
  // libraryEntries is a pure literal filter, this one cross-references its input
  // against the LIVE character. A Source formula chains them as ordinary nested
  // calls, e.g. "=restrictByCharacterKind(libraryEntries('wonder', 'properties.form',
  // 'spell'), 'class')".
  //
  // Fails OPEN in both directions, never hiding content over a data gap: if the
  // character holds none of `kind` yet, every entry passes unfiltered; if an entry
  // has no refKind-tagged relation to `kind` at all, it passes too. Only entries
  // that DO carry `kind` refs, for a character that DOES hold some, get restricted.
  function restrictByCharacterKind(entries, kind) {
    if (!Array.isArray(entries) || !kind) return entries;
    const heldIds = collectRefIdsForKind(state.draft, kind);
    if (!heldIds.size) return entries;
    return entries.filter((entry) => {
      const candidateIds = collectRefIdsForKind(entry?.entity, kind);
      if (!candidateIds.size) return true;
      for (const id of candidateIds) {
        if (heldIds.has(id)) return true;
      }
      return false;
    });
  }

  // Lightweight pre-check for whether the picker should show "Loading…" instead of
  // "Nothing available" while a Library kind's entries are still in flight.
  // Recognizes libraryEntries' call shape well enough to read the kind name back out.
  function sourceFormulaKind(formula) {
    const trimmed = typeof formula === "string" ? formula.trim() : "";
    const match = trimmed.match(/libraryEntries\(\s*['"]([a-z][a-z0-9_-]*)['"]/i);
    return match ? match[1] : "";
  }

  function hasConfiguredSource(component) {
    return Boolean(
      (typeof component?.sourceBinding === "string" && component.sourceBinding.trim()) ||
        (typeof component?.sourceFormula === "string" && component.sourceFormula.trim())
    );
  }

  // Resolves a Repeater's Add-picker candidates — same two Source shapes every
  // Select distinguishes: a plain binding reads straight from the System's
  // vocabulary; a formula runs through evaluateFormulaWithLookup with
  // `libraryEntries` registered alongside `lookup`. `ready: false` while a fetch
  // is in flight, so the picker shows "Loading…" instead of an empty list.
  function resolveRepeaterAddCandidates(component) {
    const sourceBinding = typeof component?.sourceBinding === "string" ? component.sourceBinding.trim() : "";
    if (sourceBinding) {
      const values = resolveSystemFieldValues(sourceBinding) || [];
      return {
        ready: true,
        options: values.map((entry) => ({
          label: entry?.name || entry?.label || String(entry),
          kind: "",
          id: "",
          raw: entry,
        })),
      };
    }
    const formula = typeof component?.sourceFormula === "string" ? component.sourceFormula.trim() : "";
    if (!formula) return { ready: true, options: [] };
    const kind = sourceFormulaKind(formula);
    if (kind && !sourceKindCache.has(kind)) {
      ensureSourceKindCached(kind);
      return { ready: false, options: [] };
    }
    let result;
    try {
      result = evaluateFormulaWithLookup(formula, getBindingContext(), {});
    } catch (error) {
      console.warn("Character editor: unable to evaluate Add source formula", error);
      result = [];
    }
    const entries = Array.isArray(result) ? result : [];
    return {
      ready: true,
      options: entries
        .map((entry) => ({ label: entry.entity?.name || entry.id, kind, id: entry.id, raw: entry.entity }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    };
  }

  // Bare search-then-pick combobox — no Add button of its own. A text input filters
  // the candidate list as you type, a dropdown of matches appears below it (mirrors
  // icon-picker.js's own autocomplete), rather than a plain <select>, since
  // Spells/Features/Inventory can have hundreds of candidates. Exposes
  // `getSelected()`/`reset()` so createMultiPickerRow can combine several into one
  // Add action sharing a button.
  function createSearchField({ options, ready, placeholder = "Search…", onChange, narrow = false }) {
    const group = document.createElement("div");
    // Fixed width, not max-width, so every pickable cell in the suite matches
    // instead of drifting per call site. Narrowed once more than one field shares
    // an Add row (createMultiPickerRow).
    group.className = "position-relative";
    group.style.width = narrow ? "14rem" : "28rem";
    group.style.maxWidth = "100%";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "form-control";
    input.placeholder = !ready ? "Loading…" : options.length ? placeholder : "Nothing available";
    input.disabled = !ready || !options.length;
    const dropdown = document.createElement("div");
    dropdown.className = "list-group position-absolute top-100 start-0 w-100 shadow-sm bg-body border mt-1 d-none";
    dropdown.style.zIndex = "1300";
    dropdown.style.maxHeight = "16rem";
    dropdown.style.overflowY = "auto";
    dropdown.style.fontSize = "0.8125rem";
    // Without this, dragging the dropdown's own scrollbar fires a mousedown on the
    // container (only rows had preventDefault before), blurring the input and
    // closing the dropdown mid-scroll. One listener covers the scrollbar and rows.
    dropdown.addEventListener("mousedown", (event) => event.preventDefault());

    let selected = null;
    let matches = [];
    let activeIndex = -1;

    const closeDropdown = () => {
      dropdown.classList.add("d-none");
      dropdown.innerHTML = "";
      matches = [];
      activeIndex = -1;
    };
    const selectOption = (option) => {
      selected = option;
      input.value = option.label;
      onChange?.(option);
      closeDropdown();
    };
    const renderMatches = () => {
      dropdown.innerHTML = "";
      if (!matches.length) {
        closeDropdown();
        return;
      }
      matches.forEach((option, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `list-group-item list-group-item-action py-1${index === activeIndex ? " active" : ""}`;
        row.textContent = option.label;
        row.addEventListener("mousedown", (event) => event.preventDefault());
        row.addEventListener("click", () => selectOption(option));
        dropdown.appendChild(row);
      });
      dropdown.classList.remove("d-none");
    };
    const MAX_MATCHES = 25;
    // Recomputes the VISIBLE list only, no side effect on selection — used by
    // setOptions below (a programmatic refresh, e.g. a sibling field's pick
    // narrowing this one's options), distinct from the user clearing their own
    // input. Conflating the two into one `updateMatches` caused infinite recursion:
    // a multi-field "choose 2" refresh would clear+onChange(null) on every field,
    // each triggering another refresh round, wiping out the just-made selection.
    const refreshMatches = () => {
      const query = input.value.trim().toLowerCase();
      matches = (query ? options.filter((option) => option.label.toLowerCase().includes(query)) : options).slice(0, MAX_MATCHES);
      activeIndex = -1;
      renderMatches();
    };
    const updateMatches = () => {
      selected = null;
      onChange?.(null);
      refreshMatches();
    };

    input.addEventListener("input", updateMatches);
    input.addEventListener("focus", () => {
      if (!input.disabled) updateMatches();
    });
    input.addEventListener("keydown", (event) => {
      if (input.disabled) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!matches.length) updateMatches();
        else {
          activeIndex = Math.min(activeIndex + 1, matches.length - 1);
          renderMatches();
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        renderMatches();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeIndex >= 0 && matches[activeIndex]) selectOption(matches[activeIndex]);
      } else if (event.key === "Escape") {
        closeDropdown();
      }
    });
    // A short delay, not an immediate close, so a click on a dropdown row (which
    // blurs the input first) still lands — click order across browsers isn't
    // worth relying on for this alone.
    input.addEventListener("blur", () => {
      window.setTimeout(closeDropdown, 150);
    });

    group.append(input, dropdown);
    return {
      element: group,
      getSelected: () => selected,
      reset: () => {
        selected = null;
        input.value = "";
      },
      // Lets a caller with several fields sharing one options pool (e.g. a "choose
      // 2" pendingChoice) exclude whatever a sibling field already picked.
      // Re-validates the current selection too, clearing it if another field took it.
      setOptions: (nextOptions) => {
        options = Array.isArray(nextOptions) ? nextOptions : [];
        input.disabled = !ready || !options.length;
        input.placeholder = !ready ? "Loading…" : options.length ? placeholder : "Nothing available";
        if (selected && !options.some((option) => option.id === selected.id)) {
          selected = null;
          input.value = "";
          onChange?.(null);
        }
        // refreshMatches, NOT updateMatches — a programmatic refresh must never
        // clear a still-valid selection or re-fire onChange (see refreshMatches).
        if (!dropdown.classList.contains("d-none")) {
          refreshMatches();
        }
      },
    };
  }

  // Single-select, filterable, WITH a details panel — for the Build Character
  // wizard's Species/Class/Background steps, where seeing the description helps
  // unlike the Add/Remove picker's bare createSearchField combobox. Clicking a row
  // both selects it and renders its description below in one action.
  function createFilterableListPicker({ options, onSelect, emptyMessage = "Nothing available", initialSelectedId = null }) {
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    const filterInput = document.createElement("input");
    filterInput.type = "search";
    filterInput.className = "form-control form-control-sm";
    filterInput.placeholder = "Filter…";
    const list = document.createElement("div");
    list.className = "list-group";
    list.style.maxHeight = "11rem";
    list.style.overflowY = "auto";
    // Same mousedown-inside-a-scrollable-list hazard as createSearchField's dropdown.
    list.addEventListener("mousedown", (event) => event.preventDefault());
    const details = document.createElement("div");
    details.className = "border rounded-3 p-2 small text-body-secondary";
    details.style.maxHeight = "8rem";
    details.style.overflowY = "auto";
    // A caller that re-creates this picker from scratch on every pick hands the
    // existing selection back in as `initialSelectedId` so it isn't forgotten.
    const initialOption = initialSelectedId ? options.find((option) => option.id === initialSelectedId) : null;
    details.innerHTML = initialOption ? initialOption.description || "No description available." : "";
    if (!initialOption) {
      details.textContent = "Select an option to see its description.";
    }
    wrap.append(filterInput, list, details);

    let selectedId = initialSelectedId || null;

    function renderList() {
      const query = filterInput.value.trim().toLowerCase();
      const filtered = query ? options.filter((option) => option.name.toLowerCase().includes(query)) : options;
      list.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "text-body-secondary small p-2";
        empty.textContent = emptyMessage;
        list.appendChild(empty);
        return;
      }
      filtered.forEach((option) => {
        const row = document.createElement("button");
        row.type = "button";
        const isSelected = option.id === selectedId;
        row.className = `list-group-item list-group-item-action py-1 d-flex align-items-center gap-2${isSelected ? " active" : ""}`;
        const icon = document.createElement("span");
        icon.className = "iconify flex-shrink-0";
        icon.dataset.icon = isSelected ? "tabler:circle-check-filled" : "tabler:circle";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = option.name;
        row.append(icon, label);
        row.addEventListener("click", () => {
          selectedId = option.id;
          details.innerHTML = option.description || "No description available.";
          renderList();
          onSelect(option);
        });
        list.appendChild(row);
      });
    }
    filterInput.addEventListener("input", renderList);
    renderList();
    return {
      element: wrap,
      getSelectedId: () => selectedId,
      reset: () => {
        selectedId = null;
        filterInput.value = "";
        details.textContent = "Select an option to see its description.";
        renderList();
      },
    };
  }

  // Combines N pickable cells into one Add row — 1 for the common case
  // (Features/Spells/Inventory/Proficiencies), 2+ for a genuinely compound
  // row (Defenses). One search field per cell, sharing a single Add button
  // that only enables once every field has a selection — same physical
  // shape (and same Bootstrap input-group sizing) regardless of how many
  // pickable cells a given Repeater turns out to have.
  function createMultiPickerRow(pickableCells, onAdd) {
    const wrap = document.createElement("div");
    // align-items-center (not the default cross-axis start) so every field
    // and the shared Add button line up on one visual baseline.
    wrap.className = "d-flex gap-2 align-items-center flex-wrap";
    const narrow = pickableCells.length > 1;
    const fields = pickableCells.map((cell) => {
      const { ready, options } = resolveRepeaterAddCandidates(cell);
      return createSearchField({ ready, options, narrow, onChange: () => updateAddButton() });
    });
    const group = document.createElement("div");
    group.className = "input-group";
    group.style.width = "auto";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "btn btn-outline-secondary";
    initTooltip(addButton, { title: "Add" });
    const addIcon = document.createElement("span");
    addIcon.className = "iconify";
    addIcon.dataset.icon = "tabler:plus";
    addIcon.setAttribute("aria-hidden", "true");
    addButton.appendChild(addIcon);
    function updateAddButton() {
      addButton.disabled = fields.some((field) => !field.getSelected());
    }
    updateAddButton();
    addButton.addEventListener("click", (event) => {
      event.preventDefault();
      const selections = fields.map((field) => field.getSelected());
      if (selections.some((selection) => !selection)) return;
      onAdd(selections);
      fields.forEach((field) => field.reset());
      updateAddButton();
    });
    fields.forEach((field) => wrap.appendChild(field.element));
    group.appendChild(addButton);
    wrap.appendChild(group);
    return wrap;
  }

  // Resolves the write path for a picked cell: `binding` stripped of its
  // leading "@" — where a picked candidate's own value actually lands.
  function cellFieldPath(node) {
    const binding = typeof node?.binding === "string" ? node.binding.trim() : "";
    return binding.startsWith("@") ? binding.slice(1) : "";
  }

  function setDottedField(target, path, value) {
    if (!path) return;
    const segments = path.split(".").filter(Boolean);
    let cursor = target;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const key = segments[i];
      if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[segments[segments.length - 1]] = value;
  }

  // Recursively finds the first item-template node matching `predicate` —
  // container nodes nest their own children under `zones` (a Repeater row
  // is frequently a Container laying out several cells, e.g. Defenses' own
  // two-column row). A nested Repeater ALSO has its own `zones`, but those
  // describe ITS OWN item template — a separate scope — so recursion stops
  // there by default; pass `intoRepeaters: true` to deliberately cross
  // that boundary (used only when already looking inside a KNOWN nested
  // repeater, e.g. a grouped repeater's own inner list below).
  function findItemTemplateNode(nodes, predicate, { intoRepeaters = false } = {}) {
    for (const node of nodes || []) {
      if (!node) continue;
      if (predicate(node)) return node;
      if (node.zones && typeof node.zones === "object" && (intoRepeaters || node.type !== "repeater")) {
        for (const zoneNodes of Object.values(node.zones)) {
          const found = findItemTemplateNode(zoneNodes, predicate, { intoRepeaters });
          if (found) return found;
        }
      }
    }
    return null;
  }

  // The one signal the whole Add mechanism needs to find a searchable
  // field: any item-template node authored with its own Source/Options
  // (sourceBinding/sourceFormula) — the exact same field every Select
  // already has. Which binding path it targets, which column it lives in,
  // and which kind/System-field it searches are all ordinary authored
  // data; nothing here is hardcoded to any particular repeater's identity.
  function findPickableCell(nodes) {
    return findItemTemplateNode(nodes, (node) => hasConfiguredSource(node));
  }

  // A repeater's own items are GROUPS (Spells: one group per level) purely
  // by having `groupByBinding` authored — never a binding-path check. Its
  // own pickable field lives one level down, inside whichever nested
  // Repeater its item template contains, found generically here rather
  // than by name.
  function findNestedRepeater(nodes) {
    return findItemTemplateNode(nodes, (node) => node?.type === "repeater");
  }

  // Builds the object to push for a picked selection (or a SET of them,
  // for a compound row like Defenses). Each pickable cell writes its own
  // candidate's label to its own `binding` path — never a hardcoded
  // per-repeater shape. Any selection that came from a Library kind
  // (candidate.kind is non-empty) attaches a real `{refKind, refId}`
  // reference alongside whatever the cells wrote — a property of the PICK
  // itself, not of which repeater it landed in, so Inventory/Features/
  // Spells all get a real reference with no per-binding-path special case.
  function buildPickedItem(pickableCells, selections) {
    if (pickableCells.length === 1 && cellFieldPath(pickableCells[0]) === "value") {
      return selections[0]?.label;
    }
    const item = {};
    let libraryPick = null;
    pickableCells.forEach((cell, index) => {
      const candidate = selections[index];
      if (!candidate) return;
      setDottedField(item, cellFieldPath(cell), candidate.label);
      if (candidate.kind) libraryPick = candidate;
    });
    if (libraryPick) {
      item.refKind = libraryPick.kind;
      item.refId = libraryPick.id;
    }
    return item;
  }

  // The one Add-controls builder every Repeater with allowAdd goes through — no
  // per-repeater special case. Ungrouped repeaters render one search field per
  // pickable column, sharing one Add button. A grouped repeater
  // (component.groupByBinding set — Spells) finds its pickable field inside its
  // nested inner repeater and routes a pick into the matching group, creating it if
  // needed. `candidateBinding` on the group-key cell says where to read that key
  // from a picked candidate's own record, since the group's key field and the
  // source record's field path are different schemas.
  function renderGenericAddControls(component, items, writeback, itemColumns) {
    if (component.groupByBinding) {
      const innerRepeater = findNestedRepeater(itemColumns.flat());
      if (!innerRepeater) return null;
      const innerFieldPath = cellFieldPath(innerRepeater);
      const groupKeyPath = cellFieldPath({ binding: component.groupByBinding });
      if (!innerFieldPath || !groupKeyPath) return null;
      const innerColumns = Array.from({ length: getRepeaterColumnCount(innerRepeater) }, (_, col) =>
        getRepeaterColumnZoneNodes(innerRepeater, "item", col)
      );
      const pickableCells = innerColumns.map((nodes) => findPickableCell(nodes)).filter(Boolean);
      if (!pickableCells.length) return null;
      const groupKeyCell = findItemTemplateNode(itemColumns.flat(), (node) => cellFieldPath(node) === groupKeyPath);
      const candidatePath =
        typeof groupKeyCell?.candidateBinding === "string" ? groupKeyCell.candidateBinding.replace(/^@/, "") : "";
      return createMultiPickerRow(pickableCells, (selections) => {
        const item = buildPickedItem(pickableCells, selections);
        const primary = selections.find(Boolean);
        const keyValue = candidatePath && primary ? resolveDottedPath(primary.raw, candidatePath) : undefined;
        const key = keyValue !== undefined && keyValue !== null ? keyValue : 0;
        const existingIndex = items.findIndex((group) => resolveDottedPath(group, groupKeyPath) === key);
        let nextItems;
        if (existingIndex >= 0) {
          nextItems = items.map((group, index) => {
            if (index !== existingIndex) return group;
            const innerList = Array.isArray(group?.[innerFieldPath]) ? group[innerFieldPath] : [];
            return { ...group, [innerFieldPath]: [...innerList, item] };
          });
        } else {
          const newGroup = { [innerFieldPath]: [item] };
          setDottedField(newGroup, groupKeyPath, key);
          nextItems = [...items, newGroup].sort(
            (a, b) => (resolveDottedPath(a, groupKeyPath) ?? 0) - (resolveDottedPath(b, groupKeyPath) ?? 0)
          );
        }
        writeback(nextItems);
      });
    }
    const pickableCells = itemColumns.map((nodes) => findPickableCell(nodes)).filter(Boolean);
    if (!pickableCells.length) return null;
    return createMultiPickerRow(pickableCells, (selections) => {
      if (isIdStorageRepeater(component)) {
        const primary = selections.find(Boolean);
        if (!primary) return;
        writeback([...items, primary.id]);
        return;
      }
      writeback([...items, buildPickedItem(pickableCells, selections)]);
    });
  }

  function renderRepeaterComponent(component, itemContext = null) {
    const wrapper = document.createElement("div");
    wrapper.className = "d-flex flex-column";
    // Matches the Horizontal renderers' "Grid gap (px)" field — was a fixed
    // Bootstrap gap-2 class with no way to change it (Padding/Margin under
    // Advanced are a separate pair of fields, so neither one drove this).
    const gapPx = Number.isFinite(Number(component.gap)) ? Number(component.gap) : 16;
    wrapper.style.gap = `${gapPx}px`;
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
    // Repeater has no formula/roller support — a plain @path is all its binding
    // ever holds, so the item-relative resolver is enough here, no need for
    // resolveComponentValue's fuller formula/roller machinery.
    const value = itemContext
      ? resolveItemContextValue(itemContext, component.binding)
      : resolveComponentValue(component);
    let items =
      Array.isArray(value) && isIdStorageRepeater(component)
        ? expandIdStorageItems(component, value)
        : Array.isArray(value)
          ? value
          : value && typeof value === "object"
            ? expandObjectBindingToRepeaterItems(value, component)
            : [];
    // Sort (component.sortBinding, a bare field name within each item). Numeric-aware
    // compare — coerces both values to a number, or falls back to string compare.
    // Self-heals the STORED order to match once found different, rather than
    // sorting purely for display every render, since index-based writes below
    // (setRepeaterItemValue, Remove) key off this array's own position. Skipped
    // when there's nowhere to persist to, or the viewer doesn't own this data —
    // the sorted array is still used for THIS render either way, just not written back.
    if (component.sortBinding && items.length > 1) {
      const sortField = component.sortBinding;
      const direction = component.sortDirection === "desc" ? -1 : 1;
      const sortValueOf = (entry) => (entry && typeof entry === "object" ? entry[sortField] : undefined);
      const sorted = [...items].sort((a, b) => {
        const av = sortValueOf(a);
        const bv = sortValueOf(b);
        const an = Number(av);
        const bn = Number(bv);
        if (av !== "" && bv !== "" && av != null && bv != null && Number.isFinite(an) && Number.isFinite(bn)) {
          return (an - bn) * direction;
        }
        return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { sensitivity: "base", numeric: true }) * direction;
      });
      if (sorted.some((entry, index) => entry !== items[index])) {
        items = sorted;
        const groupBinding = itemContext ? itemContext.repeaterComponent?.binding : component?.binding;
        if (component.binding && !isGroupBindingBlocked(groupBinding)) {
          writeRepeaterItems(component, itemContext, sorted);
        }
      }
    }
    // Add and Remove are two separate authored toggles, off by default — most
    // Repeaters have fixed cardinality where either would be wrong to offer; only a
    // genuinely open-ended list turns them on independently (e.g. Spells' inner
    // per-level Repeater allows Remove but not Add — Add is owned by the outer
    // grouped Repeater instead). Checks itemContext.repeaterComponent?.binding for
    // a nested Repeater rather than component.binding directly — a nested Repeater
    // (Spells' inner list) has its own plain item-relative binding, never
    // "@group.*", so checking it directly would let isGroupBindingBlocked never
    // trip even when the outer Repeater's binding genuinely is group-owned.
    // Add/Remove only ever show in Edit mode — structurally a sheet-editing action,
    // never opting into Play mode like per-field "Editable in Play" does.
    const canManageBase =
      Boolean(component.binding) &&
      !isGroupBindingBlocked(itemContext ? itemContext.repeaterComponent?.binding : component?.binding) &&
      state.mode === "edit";
    // A grouped repeater's (component.groupByBinding set — Spells) "items" are
    // whole GROUPS — a generic per-row Remove there would delete every spell at a
    // level in one click. The inner per-level repeater (itemContext set, no
    // groupByBinding of its own) is where per-spell Remove actually lives.
    const suppressRowRemove = Boolean(component.groupByBinding) && !itemContext;
    const canAdd = canManageBase && Boolean(component.allowAdd);
    const canRemove = canManageBase && Boolean(component.allowRemove) && !suppressRowRemove;
    const handleAddItem = () => {
      writeRepeaterItems(component, itemContext, [...items, createBlankRepeaterItem(itemColumns)]);
    };
    const handleRemoveItem = (index) => {
      writeRepeaterItems(component, itemContext, items.filter((_, i) => i !== index));
    };
    const onRemoveItem = canRemove ? handleRemoveItem : null;
    // Add controls — either the plain blank-row button, a Source-bound picker
    // (renderGenericAddControls), or both at once in one row (component.allowCustomAdd
    // — Inventory's real-item-picker-plus-freeform-fallback).
    function renderAddControls() {
      if (!canAdd) return [];
      const writeback = (nextItems) => writeRepeaterItems(component, itemContext, nextItems);
      const pickerRow = renderGenericAddControls(component, items, writeback, itemColumns);
      const showCustomAdd = !pickerRow || component.allowCustomAdd;
      if (!pickerRow && !showCustomAdd) return [];
      // Flows left-to-right with a plain gap so "Add custom item" sits beside the
      // picker's Add button, not pushed to the far edge (space-between would read
      // as two unrelated controls).
      const row =
        pickerRow ||
        (() => {
          const empty = document.createElement("div");
          empty.className = "d-flex gap-2 align-items-center flex-wrap";
          return empty;
        })();
      if (showCustomAdd) {
        row.appendChild(createRepeaterAddButton(handleAddItem, { label: pickerRow ? "Add custom item" : "Add item" }));
      }
      return [row];
    }
    if (!items.length) {
      wrapper.appendChild(createCanvasPlaceholder("No items.", { variant: "compact" }));
      renderAddControls().forEach((node) => wrapper.appendChild(node));
      return wrapper;
    }
    if (component.orientation === "horizontal") {
      wrapper.appendChild(
        columns > 1
          ? renderRepeaterHorizontalGrid(component, columns, itemColumns, items, onRemoveItem)
          : renderRepeaterHorizontalList(component, itemColumns[0], items, onRemoveItem)
      );
      renderAddControls().forEach((node) => wrapper.appendChild(node));
      return wrapper;
    }
    if (columns > 1) {
      wrapper.appendChild(renderRepeaterTable(component, columns, itemColumns, items, onRemoveItem));
      renderAddControls().forEach((node) => wrapper.appendChild(node));
      return wrapper;
    }
    if (component.showHeader) {
      const headerNodes = getRepeaterColumnZoneNodes(component, "header", 0);
      if (headerNodes.length) {
        wrapper.appendChild(renderRepeaterListHeader(headerNodes));
      }
    }
    items.forEach((item, index) => {
      const row = renderRepeaterItemRow(component, itemColumns[0], item, index, onRemoveItem);
      if (row) wrapper.appendChild(row);
    });
    renderAddControls().forEach((node) => wrapper.appendChild(node));
    return wrapper;
  }

  // Column plan for renderCollectionComponent — derived primarily from whatever
  // keys actually appear across the array's row objects (works even with zero
  // System metadata, the common case). If the bound field's System declaration
  // also has `item.children`, collectSystemFields flattens that into "path[].subkey"
  // entries, folded in here for a nicer label or number-vs-text hint, never to
  // require metadata most fields don't have. A bare primitive array collapses to
  // one synthetic "value" column.
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

  // A freshly added row starts with every known column defaulted, not a bare {} —
  // unlike a Repeater's item template, this editor has no item-template nodes to
  // fall back on, so the computed columns are the only source of truth here.
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
      // Unique per cell, not just per component — one component owns a whole array
      // of cells here, so without a per-cell key, restoreActiveField's focus
      // preservation would re-match the FIRST cell after every keystroke.
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

  // Fallback editor for an Input-typed component whose binding resolves to an array
  // with no Repeater built for it. Deliberately simpler than a real Repeater — this
  // exists so a bare array binding is never a dead end or a data-corruption trap,
  // not to replace authoring a proper Repeater.
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

  // Shared by every "single field, three modes" content field (Icon, Image,
  // Container, a Repeater's item-template Text) — evaluates a formula against the
  // live draft record, or (when itemContext is set) against that one repeater item,
  // same "resolve relative to the current row" scoping other item-template nodes use.
  function resolveContextFormula(formula, itemContext) {
    const dataContext = itemContext ? (itemContext.item && typeof itemContext.item === "object" ? itemContext.item : {}) : getBindingContext();
    try {
      return evaluateFormulaWithLookup(formula, dataContext, itemContext ? {} : { rollDice: rollDiceExpression });
    } catch (error) {
      console.warn("Character editor: unable to evaluate formula", error);
      return undefined;
    }
  }

  // A Button's click executor — component.action's three verbs, each reusing an
  // already-established mechanism: rollDice goes through the same
  // handleComponentRoll the old Roller field's overlay button used; runMacro goes
  // through runMacroReference, the same resolver Board's macro-button cards use;
  // adjustField is the one genuinely new capability. Wrapped in try/catch
  // surfacing status.show on failure — a click expects a visible effect, unlike a
  // passive formula's silent console.warn.
  async function runButtonComponentAction(component, itemContext) {
    const action = component?.action;
    if (!action || typeof action !== "object") {
      return;
    }
    try {
      if (action.type === "rollDice") {
        // One authored field, either shape — `action.expression` is passed
        // straight through as both the text to roll and the rollKey (see
        // executeDiceRoll/rollExpression, which try it as a System Move's
        // own shortName against this character's own System first, and
        // only roll it literally as plain dice notation when that comes up
        // empty). Nothing here needs to know which shape it got.
        const expression = typeof action.expression === "string" ? action.expression.trim() : "";
        if (!expression) {
          return;
        }
        // Same "read the live value off whichever field this button is
        // tied to" targetValue behavior createRollOverlayButton's own
        // click handler already had — component.binding is reused, not a
        // new field, so a migrated Roller usage (which carries the
        // original Input's own binding, see the migration script) keeps
        // resolving a System Move match / Initiative push exactly as
        // before.
        const rawValue = itemContext
          ? resolveItemContextValue(itemContext, component.binding)
          : getBindingValue(component?.binding);
        const numericValue = Number(rawValue);
        const targetValue = Number.isFinite(numericValue) ? numericValue : undefined;
        const label = (component.label || component.name || "Roll").trim() || "Roll";
        await handleComponentRoll(expression, label, component, targetValue, expression);
        return;
      }
      if (action.type === "runMacro") {
        const macroRef = typeof action.macroRef === "string" ? action.macroRef.trim() : "";
        if (!macroRef) {
          return;
        }
        await runMacroReference(macroRef, {
          dataManager,
          groupContext: state.groupContext ? { groupId: state.groupContext.groupId } : null,
          status,
        });
        return;
      }
      if (action.type === "adjustField") {
        const amountRaw = resolveContextFormula(action.amount, itemContext);
        const amount = Number(amountRaw);
        const delta = Number.isFinite(amount) ? amount : 0;
        // mode:"delta" floors at 0 — a deliberately minimal, generic
        // safety rail (a decremented resource counter going negative
        // reads as broken on any bound display, regardless of what the
        // resource is). mode:"set" applies the resolved amount exactly
        // as given, no clamping, for anyone who wants full control.
        const resolveNext = (current) =>
          action.mode === "set" ? delta : Math.max(0, (Number.isFinite(current) ? current : 0) + delta);

        const lookupBinding = typeof action.lookupBinding === "string" ? action.lookupBinding.trim() : "";
        if (lookupBinding) {
          // Always top-level — the entire point of "look up an entry
          // first" is reaching OUTSIDE this button's own item context
          // into a different top-level array (e.g. a Spells-row button
          // adjusting @limitedUses, a sibling Repeater entirely).
          const arrayPath = resolveBindingPath(lookupBinding);
          if (!arrayPath) {
            throw new Error("No source array configured.");
          }
          const array = getValueAtContext(getBindingContext(), arrayPath);
          if (!Array.isArray(array)) {
            throw new Error("Source binding isn't a list.");
          }
          const matchField = typeof action.matchField === "string" ? action.matchField.trim() : "";
          const matchValue = resolveContextFormula(action.matchValue, itemContext);
          const foundIndex = array.findIndex((entry) => String(entry?.[matchField]) === String(matchValue));
          if (foundIndex === -1) {
            throw new Error("No matching entry found.");
          }
          const targetField = typeof action.targetField === "string" ? action.targetField.trim() : "";
          if (!targetField) {
            throw new Error("No target field configured.");
          }
          const fullPath = [...arrayPath, String(foundIndex), targetField];
          const next = resolveNext(Number(getValueAtPath(fullPath)));
          applyBindingValue(fullPath, next, {});
          return;
        }

        const binding = typeof action.binding === "string" ? action.binding.trim() : "";
        if (!binding) {
          throw new Error("No field configured.");
        }
        const raw = binding.startsWith("@") ? binding : `@${binding}`;
        // Resolved/written like an ordinary Input's binding — item-relative via
        // setRepeaterItemValue inside a Repeater item, else the top-level path.
        if (itemContext) {
          const current = Number(resolveItemContextValue(itemContext, raw));
          setRepeaterItemValue(itemContext.repeaterComponent, itemContext.index, raw, resolveNext(current));
          return;
        }
        const path = resolveBindingPath(raw);
        if (!path) {
          throw new Error("No field configured.");
        }
        if (path[0] === "group") {
          const current = Number(getValueAtContext(getBindingContext(), path));
          updateGroupBinding(path.slice(1), resolveNext(current));
          return;
        }
        const current = Number(getValueAtPath(path));
        applyBindingValue(path, resolveNext(current), {});
      }
    } catch (error) {
      status.show(`Unable to run this action: ${error.message}`, { type: "error", timeout: 4000 });
    }
  }

  // url — like Icon's iconClass, the binding-or-literal string, plus a separate
  // `formula` field for the "=" case, checked first (formula-before-binding).
  function renderImageComponent(component, itemContext = null) {
    const element = renderImageContent(component, {
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
    attachImageUrlEditing(component, element, itemContext);
    return element;
  }

  // Image is otherwise a pure display component — this is the only way to change
  // what it shows. Deliberately a plain window.prompt rather than a bespoke inline
  // editor or permanent template field: no sheet real estate spent on something
  // only relevant while editing. Scoped to a component whose url is a plain
  // "@path" binding — the only shape with somewhere real to write the result back to.
  function attachImageUrlEditing(component, element, itemContext) {
    if (itemContext || state.mode !== "edit") {
      return;
    }
    const formula = typeof component.formula === "string" ? component.formula.trim() : "";
    if (formula) {
      return;
    }
    const raw = resolveImageUrl(component);
    const path = typeof raw === "string" && raw.startsWith("@") ? resolveBindingPath(raw) : null;
    if (!path) {
      return;
    }
    element.style.cursor = "pointer";
    initTooltip(element, { title: "Click to set image URL" });
    element.addEventListener("click", () => {
      const current = getValueAtPath(path) || "";
      const next = window.prompt("Image URL", current);
      if (next === null) {
        return;
      }
      applyBindingValue(path, next.trim());
    });
  }

  // iconClass — an "@path" value resolves against the live draft record, or, when
  // itemContext is set, against that one repeater item.
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
      // Live dataManager, for renderTextContent's automatic reference-chip
      // detection — this is the only page that ever has one, so it's also the
      // only place a reference chip hovers/previews; the Template editor's
      // preview has no live record and falls back to plain text.
      dataManager,
      resolveValue(comp, fallback) {
        if (itemContext) {
          // Formula first, same precedence as the non-item branch below.
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
      resolveReference(comp) {
        return resolveComponentReference(comp, itemContext);
      },
    });
  }

  // resolveContainerColumns/resolveContainerZoneAlignItems/
  // resolveContainerZoneTextAlign now live in ../lib/component-renderers.js,
  // shared with workbench-template-view.js.
  function renderContainerComponent(component, itemContext = null) {
    return renderContainerContent(component, {
      // Container's Label field accepts a literal "@path" like Icon's iconClass,
      // plus a separate `formula` field, checked first. Binding/literal resolve
      // against the live draft, or (itemContext set) against that repeater item.
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
        // This is a CSS Grid item — with no explicit align-self, Grid's default
        // (stretch) forces it to fill the row's full height, and `alignItems`
        // above only governs its own children's cross axis, not where the cell
        // sits within that stretched height. A Repeater row mixing component
        // types of very different natural heights got top-packed within the
        // stretched height, misaligning each one's visual center. Scoped to
        // itemContext specifically, not a blanket change — a standalone
        // Container may have real reasons to want its cells stretched.
        if (itemContext) cell.style.alignSelf = "center";
        // A container whose tabs are Source-generated gives each tab's children an
        // item-relative context rooted at that tab's System-sourced item. Orthogonal
        // to whether this Container is also nested inside an outer Repeater.
        const sourceValues = resolveSystemFieldValues(comp.tabLabelsSourceBinding);
        const tabEntries = sourceValues ? resolveTabEntries(sourceValues) : null;
        const tabEntry = tabEntries && Number.isInteger(zoneIndex) ? tabEntries[zoneIndex] : null;
        (zone.components || []).forEach((child) => {
          if (tabEntry) {
            const node = renderTabItemNode(child, tabEntry.item, comp, zoneIndex, tabEntry.key);
            if (node) cell.appendChild(node);
            return;
          }
          // A Container nested inside a Repeater item renders its zone children the
          // same bare way every item-template node does, via renderRepeaterItemNode
          // (threads itemContext through) — not renderComponentCard, which has no
          // itemContext concept.
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
      // Keyed by component.uid + item index — the same Container template renders
      // once per array item, so a shared key would sync tab-switching across items.
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
      // Play view only (Edit always shows every tab, switchable). A Source-driven
      // tabs container with an authored `activeTabBinding` locks to whichever tab
      // matches the character's current value — every other tab hidden entirely,
      // same as any field not editable in Play. No `activeTabBinding` authored
      // falls through to null, normal switchable tabs.
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

  // Every real (non-preview) formula evaluation in this file goes through here
  // instead of evaluateFormula directly, so `lookup(table, key)` is available for
  // free — a template author shouldn't need each call site to wire it in. The
  // System's field list is always the fallback source regardless of `context`,
  // since the active System doesn't change for a repeater-item context.
  function evaluateFormulaWithLookup(formula, context, options = {}) {
    return evaluateFormula(formula, context, {
      ...options,
      functions: {
        ...(options.functions || {}),
        lookup: createLookupFn(context, state.systemDefinition?.fields),
        // Always the top-level record, never `context` (the current Repeater item
        // for an item-template formula) — a lookup table lives outside any one row.
        lookupField: createLookupFieldFn(getBindingContext()),
        // Registered here (not just for Repeater Add sources) so ANY formula field
        // — Visible, Editable in Play, a Select's Source — can search a Library
        // kind the same way `lookup` searches a System field.
        libraryEntries,
        restrictByCharacterKind,
      },
    });
  }

  // Resolves the track's segment COUNT (not its active value, still ordinary
  // component.binding) from segmentFormula/segmentBinding: formula first, then a
  // binding (literal number or @path), then the static `segments`, then 6.
  // `itemContext`, when set, resolves relative to the current repeater item
  // instead of the top-level draft — needed for a Repeater of Tracks where every
  // row's segment count genuinely differs (e.g. one row per spell level).
  function resolveTrackSegments(component, itemContext = null) {
    const formula = typeof component.segmentFormula === "string" ? component.segmentFormula.trim() : "";
    if (formula) {
      try {
        const result = itemContext
          ? resolveContextFormula(formula, itemContext)
          : evaluateFormulaWithLookup(formula, getBindingContext(), { rollDice: rollDiceExpression });
        const numeric = Number(result);
        if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
      } catch (error) {
        console.warn("Character view: unable to evaluate track segment formula", error);
      }
    }
    const binding = typeof component.segmentBinding === "string" ? component.segmentBinding.trim() : "";
    if (binding) {
      if (itemContext) {
        const resolved = Number(resolveItemContextValue(itemContext, binding));
        if (Number.isFinite(resolved) && resolved > 0) return Math.round(resolved);
      } else {
        const path = resolveBindingPath(binding);
        if (path) {
          const resolved = Number(getValueAtContext(getBindingContext(), path));
          if (Number.isFinite(resolved) && resolved > 0) return Math.round(resolved);
        } else {
          const numeric = Number(binding);
          if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
        }
      }
    }
    const fallback = Number(component.segments);
    return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 6;
  }

  function renderTrackComponent(component, itemContext = null) {
    const ctx = {
      resolveTrackState(comp) {
        const segments = Math.max(1, resolveTrackSegments(comp, itemContext));
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
        // A button click is a single discrete action — no keystroke-batching reason
        // to wait for blur, unlike free-typed input. Same as the HP/AC spinners.
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
      // Driven by the same authored "Editable in Play" setting every other type
      // uses — an explicit per-component opt-in, not a hardcoded Play-mode
      // carve-out inferred from the binding. Nothing changes for a Toggle unless
      // someone deliberately turns it on.
      editable(comp) {
        // Item-aware when nested (isRepeaterItemNodeLocked, same fix
        // isRepeaterCellEditable's own Input/Track/Select Group path just
        // got) — isComponentLocked alone always evaluates readOnlyFormula
        // against the top-level draft, wrong for a Toggle living inside a
        // Repeater item.
        if (componentHasFormula(comp) || (itemContext ? isRepeaterItemNodeLocked(comp, itemContext.item) : isComponentLocked(comp))) {
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
    // Legacy type strings rewritten here too since this file has its own separate
    // render dispatch, not a shared one, and would otherwise show "Unsupported
    // component" for an old saved template.
    if (clone.type === "linear-track" || clone.type === "circular-track") {
      if (!clone.trackShape) {
        clone.trackShape = clone.type === "circular-track" ? "circular" : "linear";
      }
      clone.type = "track";
    }
    if (clone.type === "label") {
      clone.type = "text";
    }
    // Toggle's Background used to get an unconditional grey backfill here, wrong
    // once Background got real unset/X-overlay support — "no background" became a
    // legitimate choice, and this hydration step silently overwrote it back to grey
    // on every load. Border keeps its own separate backfill since that wasn't the gap.
    if (clone.type === "toggle") {
      // borderStyle/borderWidth need the same backfill as borderColor —
      // renderToggleContent reads borderStyle directly to decide whether to draw a
      // border at all, so old saved data with no borderStyle rendered borderless.
      if (!clone.borderStyle || clone.borderStyle === "none") {
        clone.borderStyle = "solid";
      }
      if (!clone.borderColor) {
        clone.borderColor = "#343a40";
      }
      if (clone.borderWidth === null || clone.borderWidth === undefined) {
        clone.borderWidth = 1;
      }
      // foregroundColor (the shape's fill) used to just BE textColor. Inherits
      // whatever textColor currently is so an already-saved Toggle's fill doesn't
      // silently change appearance.
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
    // Track's active/filled segment color and Select Group's active option color —
    // previously hardcoded CSS, never a real field. Matches Bootstrap's default
    // --bs-primary so already-saved components keep their look until customized.
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

  // A component's `binding` (writes to/reads the character) and its `sourceBinding`
  // (reads a choice list from the System) must never share the same key name — the
  // live character's draft wins in priority order, so a shared key silently
  // collapses the dropdown to empty once the character gets a real value. Not
  // validated anywhere — give the System-side lookup field a distinct (usually
  // plural) name: `heritages` vs. `heritage`.
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

  // Real-time hide, evaluated against the actual character draft. Left blank on
  // both fields, a component always shows. Fails open (visible) on a bad formula
  // rather than silently disappearing UI a template author can't see the cause of.
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
    // No condition set — falls back to the manual switch (component.visible,
    // default true), matching Collapsible/Locked's identical shape.
    return component.visible !== false;
  }

  // Same shape as isComponentVisible — a plain boolean (component.collapsible)
  // overridable by a binding/formula pair.
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

  // Same shape again — "Locked" in the Inspector, component.readOnly in storage
  // (kept as-is to avoid renaming every existing read site).
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

  // Foreground/Background/Border each have a binding/formula pair that overrides
  // the literal hex when non-empty, same fallback chain as isComponentVisible/
  // isComponentCollapsible/isComponentLocked: formula first, then binding, else
  // the stored color. Returns a shallow-cloned component with colors overridden —
  // applyComponentStyles stays unaware any of this exists.
  const COLOR_BINDING_KEYS = {
    textColor: { binding: "textColorBinding", formula: "textColorFormula" },
    foregroundColor: { binding: "foregroundColorBinding", formula: "foregroundColorFormula" },
    backgroundColor: { binding: "backgroundColorBinding", formula: "backgroundColorFormula" },
    borderColor: { binding: "borderColorBinding", formula: "borderColorFormula" },
  };

  // This file has its own separate template object, so it needs its own copy of
  // this normalization. Font only, always a real value — Background/Border are NOT
  // per-component fallbacks: a component with its field cleared stays genuinely
  // transparent/borderless, not silently inheriting the template's sheet-wide color.
  function normalizeTemplateDefaults(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      fontColor: typeof source.fontColor === "string" && source.fontColor.trim() ? source.fontColor.trim() : "#ffffff",
      // Same Binding/Formula pair every other color field has. fontColor itself
      // always stays a real literal (above) — these are only non-empty when
      // actively overriding it.
      fontColorBinding: typeof source.fontColorBinding === "string" ? source.fontColorBinding.trim() : "",
      fontColorFormula: typeof source.fontColorFormula === "string" ? source.fontColorFormula.trim() : "",
    };
  }

  // Text only. There's always a text color to fall back to, which isn't true for
  // Background/Border — "no background"/"no border" are themselves legitimate
  // choices, so clearing one must mean "none," not "inherit the template's
  // sheet-wide setting." The template's own Background/Border are a separate,
  // literal concept applied once to the sheet root, not resolved per-component.
  const TEMPLATE_DEFAULT_COLOR_KEYS = { textColor: "fontColor" };

  // Font Default's Formula-then-Binding-then-literal precedence — same shape
  // resolveTemplateColor gives Background/Border, read off state.template.defaults
  // instead of state.template directly since the fallback's pair lives there.
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

  // The template's sheet-wide Background/Border color — same precedence as
  // resolveComponentColors, read off state.template and resolved against the live
  // draft (this file has no canvas-preview/sample-data concept). `prop` is
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
    // Still blank after binding/formula? Fall back to the template's default — the
    // only fallback any color field should ever reach now, no hardcoded Bootstrap
    // theme colors standing in for "nobody chose anything."
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

  // Same idea as isComponentVisible, but for a Repeater item-template node —
  // evaluated against the current item as the data context, same scoping an item
  // node's ordinary binding already uses.
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
  // item-template node stays live-adjustable in Play view — same precedence as
  // isComponentEditableInPlay below, evaluated against the current item.
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

  // Same idea again — "Locked", evaluated against the current item instead of the
  // top-level draft. isComponentLocked always evaluates against
  // getBindingContext(), so a Locked formula on a Repeater item node resolved
  // against the wrong record with no item-aware counterpart, unlike Visible/
  // Editable in Play above.
  function isRepeaterItemNodeLocked(node, item) {
    if (!node) return false;
    const formula = typeof node.readOnlyFormula === "string" ? node.readOnlyFormula.trim() : "";
    if (formula) {
      try {
        return Boolean(evaluateFormulaWithLookup(formula, item && typeof item === "object" ? item : {}, {}));
      } catch (error) {
        console.warn("Character editor: unable to evaluate item locked formula", error);
        return false;
      }
    }
    const binding = typeof node.readOnlyBinding === "string" ? node.readOnlyBinding.trim() : "";
    if (binding) {
      return Boolean(resolveRepeaterItemValue(item, binding));
    }
    return Boolean(node.readOnly);
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
    // A Button doesn't read/write comp.binding the way every OTHER
    // interactive item-template node does (Input/Toggle/Track all use it
    // as their own bound value's path) — its action.binding/lookupBinding
    // fields (runButtonComponentAction) are what actually matter, and an
    // action can legitimately need neither (a lookup-based adjustField,
    // a runMacro/rollDice with no associated field at all). Confirmed
    // real bug this fixes: a Repeater-item Button with no top-level
    // binding set (the normal case) was unconditionally non-editable
    // here, in EVERY mode, regardless of Editable in Play — clicking it
    // did nothing at all.
    const isButton = comp?.type === "input" && comp?.variant === "button";
    if (!comp.binding && !isButton) {
      return false;
    }
    // Same "Locked always wins, in both modes" precedence isEditable's own
    // isComponentLocked check has — confirmed real gap this closes: no
    // item-template node here (Input/Track/Select Group, Button included)
    // ever consulted Locked at all, so a Cast button's own Locked formula
    // had zero effect regardless of what it evaluated to.
    if (isRepeaterItemNodeLocked(comp, itemContext.item)) {
      return false;
    }
    if (isGroupBindingBlocked(itemContext.repeaterComponent?.binding)) {
      return false;
    }
    return state.mode === "edit" || isRepeaterItemNodeEditableInPlay(comp, itemContext.item);
  }

  // Same idea as resolveComponentColors, but for a Repeater item-template node —
  // evaluated against the current item as the data context.
  function resolveRepeaterItemNodeColors(node, item) {
    if (!node) return node;
    let overridden = null;
    Object.entries(COLOR_BINDING_KEYS).forEach(([colorProp, keys]) => {
      const formula = typeof node[keys.formula] === "string" ? node[keys.formula].trim() : "";
      // A formula calling lookup() has nothing to find until state.systemDefinition
      // finishes its own async fetch — the canvas's first render always runs
      // before that resolves. Self-correcting (a second render follows moments
      // later), so skipped rather than attempted-and-warned.
      if (formula && formula.includes("lookup(") && !Array.isArray(state.systemDefinition?.fields)) {
        return;
      }
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
    // Same template-default fallback as resolveComponentColors — a Repeater item's
    // row is still part of the same template.
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

  // Same shape as isComponentLocked/isComponentCollapsible — "Editable in Play" in
  // the Inspector, a genuine per-component authored setting for whether a
  // component stays live-adjustable in Play view instead of gated behind Edit
  // mode. HP/AC/Conditions/Initiative get adjusted mid-session, so an author opts
  // those in explicitly, rather than inferring it from a binding-path guess.
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
    // A component bound to "@group.*" carries its own separate permission gate
    // (Loom's per-property "Public" flag) underneath Editable-in-Play — even in Edit
    // mode, a group-scoped field this viewer doesn't own and isn't public stays
    // read-only, so the UI never shows something updateGroupBinding will reject.
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
    const applyRollDirectives = (extra) => {
      if (!componentUid) {
        return;
      }
      const combined = new Set();
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

  // A leading blank option makes sense for a single-select dropdown but not a
  // multi-select toggle group — there's no blank "pill." `allowBlank` lets
  // multi-select callers opt out.
  function resolveSelectionOptions(component, { allowBlank = true, itemContext = null } = {}) {
    const expectsSource = Boolean(component?.sourceBinding);
    const addBlank = expectsSource && allowBlank;
    // Item-relative first — a Source-bound Checkbox/Radio/Select inside a
    // Repeater's item template (or a Source-driven Tab) needs its Source resolved
    // relative to that item (e.g. a Tab's own `sourceBinding: "@value"`).
    // resolveRepeaterItemValue returns undefined for anything it can't resolve,
    // falling through to the global path below — purely additive.
    const itemValues = itemContext ? resolveRepeaterItemValue(itemContext.item, component?.sourceBinding) : undefined;
    // Prefer resolving straight against the System's field definition
    // (resolveSystemFieldValues, the same direct lookup Toggle's Source has always
    // used) over the generic, lossy resolveSourceBindingValue/systemPreviewData
    // path, which silently discards a Source option's own `description`. Falls
    // back to the old path only when the binding isn't a plain top-level field key.
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

  // A Source binding means specifically "a choices list from the System record" —
  // resolves DIRECTLY against the System's field schema, not through the generic
  // resolveSourceBindingValue/systemPreviewData machinery every plain Binding uses,
  // which is lossy for anything richer than a bare display name (it reduces an
  // array-of-choices field down to just each entry's .name, silently discarding
  // description/sourceId). Only a plain, single-segment field key is supported —
  // no Source binding in this suite has ever needed nesting.
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

  // Deliberately NOT normalizeOptionEntries — that shared helper collapses every
  // entry to a bare {value, label} without checking `sourceId`, discarding a
  // Source entry's canonical identity.
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

  // A plain-path read against the full draft record — same job as the shared
  // resolveBinding(), just without formula evaluation. Delegates to the shared
  // implementation instead of re-walking the path locally.
  function getBindingValue(binding) {
    const normalizedBinding = normalizeBinding(binding);
    if (!normalizedBinding || typeof normalizedBinding !== "string" || !normalizedBinding.trim().startsWith("@")) {
      return undefined;
    }
    return resolveBinding(normalizedBinding, getBindingContext());
  }

  // Whether the current viewer may write `topLevelKey` — the group owner (GM) can
  // always edit any property; anyone else only if that property's schema marks it
  // `public`. No campaign active means nothing is editable.
  function isGroupPropertyEditable(topLevelKey) {
    if (!state.groupContext) return false;
    if (state.groupContext.isOwner) return true;
    const schema = Array.isArray(state.groupContext.schema) ? state.groupContext.schema : [];
    const property = schema.find((entry) => entry && entry.key === topLevelKey);
    return Boolean(property?.public);
  }

  // Shared by every editability check below — true only when `binding` resolves to
  // a "@group.*" path this viewer isn't allowed to write.
  function isGroupBindingBlocked(binding) {
    const path = resolveBindingPath(binding);
    return Boolean(path && path[0] === "group" && !isGroupPropertyEditable(path[1]));
  }

  // The write path for a "@group.*" binding — deliberately NOT routed through
  // setValueAtPath/applyBindingValue (those mutate state.draft, which gets
  // persisted as the Character's saved JSON; group data must never end up inside
  // it). Optimistically updates state.groupContext.values, then persists via the
  // server's own narrow per-property-permission endpoint. No undo-stack
  // integration — Workbench's undo stack is scoped to this character's draft.
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

  // Toggles between the modal's three panels — a blank New Character form,
  // the Import Character one, and Build Character (a real multi-step
  // wizard) — sharing a single toolbar entry point/modal instead of each
  // getting its own toolbar button (see the comment on
  // newCharacterModalInstance above for why).
  function setAddCharacterMode(mode) {
    const normalized = mode === "import" || mode === "build" ? mode : "blank";
    elements.addCharacterModeBlank?.classList.toggle("btn-primary", normalized === "blank");
    elements.addCharacterModeBlank?.classList.toggle("btn-outline-primary", normalized !== "blank");
    elements.addCharacterModeImport?.classList.toggle("btn-primary", normalized === "import");
    elements.addCharacterModeImport?.classList.toggle("btn-outline-primary", normalized !== "import");
    elements.addCharacterModeBuild?.classList.toggle("btn-primary", normalized === "build");
    elements.addCharacterModeBuild?.classList.toggle("btn-outline-primary", normalized !== "build");
    elements.newCharacterForm?.classList.toggle("d-none", normalized !== "blank");
    elements.importCharacterForm?.classList.toggle("d-none", normalized !== "import");
    elements.buildWizard?.classList.toggle("d-none", normalized !== "build");
    elements.addCharacterSubmitBlank?.classList.toggle("d-none", normalized !== "blank");
    elements.addCharacterSubmitImport?.classList.toggle("d-none", normalized !== "import");
    elements.addCharacterSubmitBuild?.classList.toggle("d-none", normalized !== "build");
    elements.addCharacterSubmitBuild?.classList.toggle("d-flex", normalized === "build");
    if (normalized === "import") {
      void activateImportMode();
    } else if (normalized === "build") {
      void activateBuildMode();
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

  // --- Build Character -----------------------------------------------------
  // A real multi-step wizard living inside the same New Character modal as
  // Blank/Import — Import already establishes multi-stage-within-one-mode, so
  // Build's Back/Next navigation continues that pattern. Deliberately does NOT
  // resolve every choice (skill picks, starting equipment, ability bonus) inside
  // the wizard — those become ordinary pendingChoices entries, resolved via the
  // same Character Properties UI Level Up already built, once the character exists.
  //
  // "choices" is a real, counted step — reached only after Create Character on
  // Review actually creates the record, never via ordinary Back/Next
  // (goToBuildStep clamps navigation to stop right before it) — but still
  // occupies a real slot so the user sees "Step N of N," never a step that
  // materializes out of nowhere. Its position is wherever the System's own
  // `buildSteps` array puts it, a declared entry like any other. "required" is
  // the one exception, not in buildSteps at all — see below.
  //
  // The single fixed, non-System label for the landing step — deliberately the
  // only hardcoded label in this wizard. Reading a System-declared label for THIS
  // step would require already knowing which System is active, which is exactly
  // what this step's own Template picker is how the user chooses in the first
  // place. Holds ONLY what's genuinely required to create any valid Workbench
  // character regardless of System (Name, Template — never an optional field like
  // Pronouns, which lives on Details instead). Deliberately NOT called "identity"
  // — that name is left free for a System to use as a real declared step.
  const REQUIRED_STEP_LABEL = "Name & Template";

  // One entry of the System's declared `buildSteps` — the sole source for
  // everything a step needs (see README.md's "buildSteps" section). `buildSteps`'s
  // raw value is normally an array (one wizard per System). A System with more
  // than one creatable Template sharing it (BitD: Character AND Crew) needs a
  // different wizard per Template, so `buildSteps` may instead be a plain object
  // keyed by Template id, resolved here against whichever Template is selected.
  function getDeclaredBuildSteps(systemDefinition) {
    const raw = fieldByKey(systemDefinition?.fields, "buildSteps")?.values;
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === "object") {
      const templateId = elements.buildCharacterTemplate?.value || "";
      const forTemplate = raw[templateId];
      return Array.isArray(forTemplate) ? forTemplate : [];
    }
    return [];
  }

  function getBuildStepEntry(step, systemDefinition = buildWizardState.systemDefinition) {
    return getDeclaredBuildSteps(systemDefinition).find((entry) => entry?.step === step) || null;
  }

  // "required" is always first, unconditionally. Every other step is exactly the
  // System's declared `buildSteps`, in that array's own order. The only runtime
  // filter is "subclass": whether the selected class grants it at creation is
  // per-class data (getSubclassGrantLevel), not something a System-wide list can
  // express.
  function getActiveBuildSteps() {
    const declaredSteps = getDeclaredBuildSteps(buildWizardState.systemDefinition);
    const stepEntryById = new Map(declaredSteps.filter((entry) => entry?.step).map((entry) => [entry.step, entry]));
    const contentSteps = declaredSteps
      .map((entry) => entry?.step)
      .filter((step) => step && (step !== "subclass" || buildWizardState.needsSubclassStep));
    const steps = ["required", ...contentSteps];
    const labels = [REQUIRED_STEP_LABEL, ...contentSteps.map((step) => stepEntryById.get(step)?.label || step)];
    return { steps, labels };
  }

  const buildWizardState = {
    step: 0,
    // The System for whichever Template is picked IN THE WIZARD, not
    // state.systemDefinition (the character behind the modal). A plain cached
    // fetch so switching Templates mid-wizard never repaints the sheet behind it.
    systemDefinition: null,
    speciesId: "",
    speciesName: "",
    // Mixed Ancestry (Daggerheart: top ancestry feature from one, bottom from
    // another) — an optional second species pick blended with the first.
    mixedAncestry: false,
    secondSpeciesId: "",
    secondSpeciesName: "",
    classId: "",
    className: "",
    classRecord: null,
    needsSubclassStep: false,
    subclassId: "",
    subclassName: "",
    backgroundId: "",
    backgroundName: "",
    abilityMethod: "pointBuy",
    abilityScores: {},
    abilityDefs: [],
    rolledScores: [],
    // One entry per input an "input" buildStep declares (its `inputs[]`, by index)
    // — fully generic, not tied to any one concept.
    inputValues: [],
    // "pointAllocation" steps — one entry per step id, each
    // `{ [itemShortKey]: extraValuePlaced }`. Excludes a step's own `prefill`
    // value (e.g. BitD's class-granted action dots) — read fresh from classRecord
    // each render, so switching class mid-step always recomputes the right floor.
    pointAllocations: {},
    // "listPick" steps — one entry per step id, each `{ [slotIndex]: pickedRawValue }`.
    listPicks: {},
  };

  async function activateBuildMode() {
    buildWizardState.step = 0;
    buildWizardState.systemDefinition = null;
    buildWizardState.speciesId = "";
    buildWizardState.speciesName = "";
    buildWizardState.mixedAncestry = false;
    buildWizardState.secondSpeciesId = "";
    buildWizardState.secondSpeciesName = "";
    buildWizardState.classId = "";
    buildWizardState.className = "";
    buildWizardState.classRecord = null;
    buildWizardState.needsSubclassStep = false;
    buildWizardState.subclassId = "";
    buildWizardState.subclassName = "";
    buildWizardState.backgroundId = "";
    buildWizardState.backgroundName = "";
    buildWizardState.abilityMethod = "pointBuy";
    buildWizardState.abilityScores = {};
    buildWizardState.abilityDefs = [];
    buildWizardState.rolledScores = [];
    buildWizardState.inputValues = [];
    buildWizardState.pointAllocations = {};
    buildWizardState.listPicks = {};
    if (elements.buildCharacterName) {
      elements.buildCharacterName.value = "";
    }
    if (elements.buildCharacterPronouns) {
      elements.buildCharacterPronouns.value = "";
    }
    if (elements.buildCharacterImage) {
      elements.buildCharacterImage.value = "";
    }
    const defaultTemplate = state.template?.id || elements.newCharacterTemplate?.value || "";
    refreshNewCharacterTemplateOptions(defaultTemplate);
    if (elements.buildCharacterTemplate && defaultTemplate) {
      elements.buildCharacterTemplate.value = defaultTemplate;
    }
    goToBuildStep(0);
    await applyBuildTemplateSelection();
  }

  // Turns the wizard's picked Template into a System definition — fires on
  // activation and on every Template change. Populates
  // buildWizardState.systemDefinition and re-derives step chrome that depends on it.
  async function applyBuildTemplateSelection() {
    const templateId = elements.buildCharacterTemplate?.value || "";
    const systemId = templateCatalog.get(templateId)?.schema || "";
    buildWizardState.systemDefinition = await fetchSystemDefinition(systemId);
    buildWizardState.abilityDefs = [];
    // Species/Class/Background are System-filtered — a Template switch can
    // change the System, so prior picks/lists can no longer be trusted.
    await refreshBuildLibraryPickers();
    applyBuildStepChrome(buildWizardState.step);
    updateBuildNextState();
  }

  // Re-renders all three Library-kind steps against the selected Template,
  // clearing prior picks — a Species valid under the old System may not
  // exist in the new one's filtered list.
  async function refreshBuildLibraryPickers() {
    buildWizardState.speciesId = "";
    buildWizardState.speciesName = "";
    buildWizardState.mixedAncestry = false;
    buildWizardState.secondSpeciesId = "";
    buildWizardState.secondSpeciesName = "";
    buildWizardState.classId = "";
    buildWizardState.className = "";
    buildWizardState.classRecord = null;
    buildWizardState.needsSubclassStep = false;
    buildWizardState.subclassId = "";
    buildWizardState.subclassName = "";
    buildWizardState.backgroundId = "";
    buildWizardState.backgroundName = "";
    if (elements.buildMixedAncestryCheckbox) {
      elements.buildMixedAncestryCheckbox.checked = false;
    }
    setElementVisible(elements.buildSecondSpeciesStep, false);
    // A Heritage-step System renders its 2 kind picks into the heritage panel's
    // mounts instead of the standalone species/background steps (not in the
    // active sequence then). Every kind fetched below comes from the step's
    // declared `kind`/`picks[].kind`, never assumed from the id.
    const heritageEntry = getBuildStepEntry("heritage");
    const speciesKind = heritageEntry ? heritageEntry.picks?.[0]?.kind : getBuildStepEntry("species")?.kind;
    const backgroundKind = heritageEntry ? heritageEntry.picks?.[1]?.kind : getBuildStepEntry("background")?.kind;
    const classStepEntry = getBuildStepEntry("class");
    const classKind = classStepEntry?.kind;
    const speciesMount = heritageEntry ? elements.buildHeritageSpeciesMount : elements.buildSpeciesMount;
    const backgroundMount = heritageEntry ? elements.buildHeritageBackgroundMount : elements.buildBackgroundMount;
    setElementVisible(elements.buildMixedAncestryStep, Boolean(heritageEntry?.allowMixedAncestry));
    await Promise.all([
      renderBuildLibraryPicker(speciesMount, speciesKind, (option) => {
        buildWizardState.speciesId = option?.id || "";
        buildWizardState.speciesName = option?.label || "";
        updateBuildNextState();
      }),
      renderBuildLibraryPicker(elements.buildClassMount, classKind, (option) => {
        buildWizardState.classId = option?.id || "";
        buildWizardState.className = option?.label || "";
        buildWizardState.classRecord = option?.raw || null;
        // Only possible if the System's buildSteps declares a "subclass" step.
        // `atCreation` (Daggerheart: always) is checked first, short-circuiting
        // before getSubclassGrantLevel — which looks for a "{ClassName} Subclass"
        // feature D&D carries and Daggerheart doesn't.
        const subclassStepEntry = getBuildStepEntry("subclass");
        buildWizardState.needsSubclassStep =
          Boolean(subclassStepEntry) && (Boolean(subclassStepEntry.atCreation) || getSubclassGrantLevel(option?.raw) === 1);
        buildWizardState.subclassId = "";
        buildWizardState.subclassName = "";
        if (buildWizardState.needsSubclassStep) {
          void renderBuildSubclassPicker();
        }
        updateBuildNextState();
      }, classStepEntry?.matchField, classStepEntry?.matchValue),
      renderBuildLibraryPicker(backgroundMount, backgroundKind, (option) => {
        buildWizardState.backgroundId = option?.id || "";
        buildWizardState.backgroundName = option?.label || "";
        updateBuildNextState();
      }),
      renderBuildLibraryPicker(elements.buildSecondSpeciesMount, speciesKind, (option) => {
        buildWizardState.secondSpeciesId = option?.id || "";
        buildWizardState.secondSpeciesName = option?.label || "";
        updateBuildNextState();
      }),
    ]);
    updateBuildNextState();
  }

  // Subclass options filter to records matching the subclass step's own
  // `parentKind`/`parentId` — the class's real Library id, never its DDB-import
  // "index" slug, which a same-named class in another System can share.
  async function renderBuildSubclassPicker() {
    const mount = elements.buildSubclassMount;
    if (!mount || !buildWizardState.classRecord) {
      return;
    }
    mount.textContent = "Loading…";
    const subclassStepEntry = getBuildStepEntry("subclass");
    let entries = [];
    try {
      entries = await fetchKindEntriesWithIds(dataManager, subclassStepEntry?.kind);
    } catch (error) {
      mount.textContent = "Unable to load subclass options.";
      return;
    }
    const options = entries
      .filter((entry) => entry.entity?.parentKind === subclassStepEntry?.parentKind && entry.entity?.parentId === buildWizardState.classId)
      .map((entry) => ({ id: entry.id, name: entry.entity?.name || entry.id, description: resolveNotes(entry.entity), raw: entry.entity }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    mount.innerHTML = "";
    const picker = createFilterableListPicker({
      options,
      emptyMessage: "No subclass options available.",
      onSelect: (option) => {
        buildWizardState.subclassId = option.id;
        buildWizardState.subclassName = option.name;
        updateBuildNextState();
      },
    });
    mount.appendChild(picker.element);
  }

  // Shared by all three Library-kind picker steps. Filtered to the Template's
  // System via each record's `systemIds` — a record with no systemIds is left
  // visible, matching this suite's "absence restricts nothing" convention.
  async function renderBuildLibraryPicker(mount, kind, onPick, matchField, matchValue) {
    if (!mount) {
      return;
    }
    mount.textContent = "Loading…";
    let entries = [];
    try {
      entries = await fetchKindEntriesWithIds(dataManager, kind);
    } catch (error) {
      mount.textContent = `Unable to load ${kind} options.`;
      return;
    }
    const templateId = elements.buildCharacterTemplate?.value || "";
    const systemId = templateCatalog.get(templateId)?.schema || "";
    const filteredEntries = entries
      .filter((entry) => {
        if (!systemId) return true;
        const systemIds = entry.entity?.systemIds;
        return !Array.isArray(systemIds) || !systemIds.length || systemIds.includes(systemId);
      })
      // Generic, data-declared discriminator — the step says which field/value
      // scopes it (BitD's Crew Type step: matchField "form", matchValue "crew",
      // scoping the "class" kind without the wizard knowing what "form" means).
      .filter((entry) => !matchField || !matchValue || entry.entity?.[matchField] === matchValue);
    mount.innerHTML = "";
    const options = filteredEntries
      .map((entry) => ({ id: entry.id, name: entry.entity?.name || entry.id, description: resolveNotes(entry.entity), raw: entry.entity }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const picker = createFilterableListPicker({
      options,
      emptyMessage: systemId ? `No ${kind} options for this System.` : `No ${kind} options available.`,
      onSelect: (option) => onPick({ id: option.id, label: option.name, kind, raw: option.raw }),
    });
    mount.appendChild(picker.element);
  }

  // Shows/hides the right step panel and updates the label/Back/Next chrome —
  // shared by ordinary Back/Next navigation and submitBuildWizard's jump straight
  // to "choices". The step count always reflects the full active sequence
  // including "choices", so it never appears to grow mid-wizard.
  function applyBuildStepChrome(index) {
    const { steps, labels } = getActiveBuildSteps();
    steps.forEach((step, i) => {
      document.querySelector(`[data-build-step="${step}"]`)?.classList.toggle("d-none", i !== index);
    });
    // Before a Template is picked there's no System, so the step count would be a
    // meaningless "Step 1 of 4" — hidden until a real System is loaded.
    const hasSystem = Boolean(buildWizardState.systemDefinition);
    setElementVisible(elements.buildStepLabel, hasSystem, "inline");
    if (elements.buildStepLabel && hasSystem) {
      elements.buildStepLabel.textContent = `Step ${index + 1} of ${steps.length}: ${labels[index]}`;
    }
    // In-panel captions echo the same declared label as the step header, set
    // alongside it so they can't drift apart. Heritage is a composite (2 kinds in
    // one step) so it reads `picks[].label` instead of a single step label.
    document.querySelectorAll("[data-build-step-caption]").forEach((el) => {
      el.textContent = getBuildStepEntry(el.dataset.buildStepCaption)?.label || el.dataset.buildStepCaption;
    });
    const heritagePicks = getBuildStepEntry("heritage")?.picks;
    document.querySelectorAll("[data-build-heritage-pick-label]").forEach((el) => {
      const pickIndex = Number(el.dataset.buildHeritagePickLabel);
      el.textContent = heritagePicks?.[pickIndex]?.label || "";
    });
    if (elements.buildHeritageSecondPickLabel) {
      const primaryLabel = heritagePicks?.[0]?.label;
      elements.buildHeritageSecondPickLabel.textContent = primaryLabel ? `Second ${primaryLabel}` : "";
    }
    const step = steps[index];
    elements.buildBackButton?.classList.toggle("d-none", index === 0 || step === "choices");
    if (elements.buildNextButton) {
      elements.buildNextButton.textContent = step === "review" ? "Create Character" : step === "choices" ? "Finish" : "Next";
    }
  }

  // Ordinary Back/Next navigation, clamped to stop right before "choices" (found by
  // id, never assumed last) since that step only exists once Create Character has
  // run — submitBuildWizard is the sole path that shows it.
  function goToBuildStep(index) {
    const { steps } = getActiveBuildSteps();
    const choicesIndex = steps.indexOf("choices");
    const lastNavStep = choicesIndex === -1 ? steps.length - 1 : choicesIndex - 1;
    const clamped = Math.max(0, Math.min(index, lastNavStep));
    buildWizardState.step = clamped;
    applyBuildStepChrome(clamped);
    if (steps[clamped] === "subclass") {
      void renderBuildSubclassPicker();
    }
    if (steps[clamped] === "abilities") {
      void ensureBuildAbilityDefs();
    }
    if (steps[clamped] === "input") {
      renderBuildInputStep();
    }
    if (getBuildStepEntry(steps[clamped])?.type === "pointAllocation") {
      renderBuildPointAllocationStep(steps[clamped]);
    }
    if (getBuildStepEntry(steps[clamped])?.type === "listPick") {
      renderBuildListPickStep(steps[clamped]);
    }
    if (steps[clamped] === "review") {
      renderBuildReview();
    }
    updateBuildNextState();
  }

  // The wizard's content-step sequence is entirely driven by the System's declared
  // `buildSteps` — a System with none declared has no wizard at all. A single
  // top-level signal, not narrowed to one step's data (an incomplete "abilities"
  // `methods` only blocks that one step). `true` while no System is loaded yet.
  function buildWizardSupported() {
    return !buildWizardState.systemDefinition || getDeclaredBuildSteps(buildWizardState.systemDefinition).length > 0;
  }

  function updateBuildNextState() {
    if (!elements.buildNextButton) {
      return;
    }
    setElementVisible(elements.buildUnsupportedMessage, !buildWizardSupported(), "block");
    if (!buildWizardSupported()) {
      elements.buildNextButton.disabled = true;
      return;
    }
    const { steps } = getActiveBuildSteps();
    const step = steps[buildWizardState.step];
    let valid = true;
    if (step === "required") {
      valid = Boolean((elements.buildCharacterName?.value || "").trim()) && Boolean(elements.buildCharacterTemplate?.value);
    } else if (step === "species") {
      valid = Boolean(buildWizardState.speciesId);
    } else if (step === "class") {
      valid = Boolean(buildWizardState.classId);
    } else if (step === "subclass") {
      valid = Boolean(buildWizardState.subclassId);
    } else if (step === "background") {
      valid = Boolean(buildWizardState.backgroundId);
    } else if (step === "heritage") {
      valid = Boolean(buildWizardState.speciesId) && Boolean(buildWizardState.backgroundId) && (!buildWizardState.mixedAncestry || Boolean(buildWizardState.secondSpeciesId));
    } else if (step === "abilities") {
      valid = isBuildAbilitiesComplete();
    } else if (step === "input") {
      const inputDefs = getBuildStepEntry("input")?.inputs;
      valid =
        Array.isArray(inputDefs) &&
        inputDefs.length > 0 &&
        inputDefs.every((def, index) => def?.optional || Boolean((buildWizardState.inputValues[index] || "").trim()));
    } else {
      const stepEntry = getBuildStepEntry(step);
      if (stepEntry?.type === "pointAllocation") {
        const budget = resolvePointAllocationBudget(stepEntry);
        const allocations = buildWizardState.pointAllocations[step] || {};
        const spent = Object.values(allocations).reduce((total, value) => total + (Number(value) || 0), 0);
        valid = budget > 0 && spent === budget;
      } else if (stepEntry?.type === "listPick") {
        const picks = Array.isArray(stepEntry.picks) && stepEntry.picks.length ? stepEntry.picks : [{}];
        const selections = buildWizardState.listPicks[step] || {};
        valid = picks.every((_, slotIndex) => Boolean(selections[slotIndex]));
      }
    }
    elements.buildNextButton.disabled = !valid;
  }

  async function ensureBuildAbilityDefs() {
    if (!buildWizardState.abilityDefs.length) {
      const templateId = elements.buildCharacterTemplate?.value || "";
      const systemId = templateCatalog.get(templateId)?.schema || state.template?.schema || "";
      buildWizardState.abilityDefs = await loadAbilityFieldDefs(dataManager, systemId);
    }
    renderBuildAbilitiesStep();
  }

  function isBuildAbilitiesComplete() {
    return buildWizardState.abilityDefs.length > 0 && buildWizardState.abilityDefs.every((def) => buildWizardState.abilityScores[def.key] != null);
  }

  // A method's mechanics (point-buy curve/budget, roll formula/count,
  // fixed value array) are System data on the "abilities" step's own
  // `methods` entry — never a JS constant or hardcoded default. Nothing
  // declared means no usable method, surfaced via
  // renderBuildAbilitiesStep's own inline message, not a whole-wizard
  // block (see buildWizardSupported).
  function getBuildAbilityMethodConfig(methodName) {
    const declared = getBuildStepEntry("abilities")?.methods;
    const entry = Array.isArray(declared) ? declared.find((e) => (e?.name || e) === methodName) : null;
    return entry && typeof entry === "object" ? entry : null;
  }

  // A declared method only counts as usable once its own required config
  // is present — a System declaring "pointBuy" without min/max/budget/
  // costs is an authoring gap to surface, not paper over with a fallback.
  function isBuildAbilityMethodUsable(methodName, config) {
    if (methodName === "array") {
      return Array.isArray(config?.values) && config.values.length > 0;
    }
    if (methodName === "pointBuy") {
      return Number.isFinite(config?.min) && Number.isFinite(config?.max) && Number.isFinite(config?.budget) && config?.costs && typeof config.costs === "object";
    }
    if (methodName === "roll") {
      // Either a shared-formula/count shape (D&D: roll 6, assign freely) or a
      // per-ability `formulas` map (CoC: each ability rolls its own formula
      // directly, no shared pool) — see renderPerAbilityRollAbilities.
      const hasSharedFormula = typeof config?.formula === "string" && config.formula.trim().length > 0 && Number.isFinite(config?.count);
      const hasPerAbilityFormulas = config?.formulas && typeof config.formulas === "object" && Object.keys(config.formulas).length > 0;
      return hasSharedFormula || hasPerAbilityFormulas;
    }
    return false;
  }

  // Every method the System declares and fully configures — the wizard never
  // invents a method the System didn't ask for.
  function allowedBuildAbilityMethods() {
    const declared = getBuildStepEntry("abilities")?.methods;
    return (Array.isArray(declared) ? declared : [])
      .map((entry) => entry?.name || entry)
      .filter((name) => isBuildAbilityMethodUsable(name, getBuildAbilityMethodConfig(name)));
  }

  function renderBuildAbilitiesStep() {
    const mount = elements.buildAbilitiesMount;
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const allowedMethods = allowedBuildAbilityMethods();
    document.querySelectorAll("[data-build-ability-method]").forEach((button) => {
      setElementVisible(button, false);
    });
    if (!allowedMethods.length) {
      // Nothing to render, on purpose — no D&D-shaped stand-in. A single-step gap
      // only (buildWizardSupported blocks the whole wizard only when buildSteps
      // itself is undeclared).
      mount.textContent = "This System hasn't declared how ability scores are assigned yet.";
      return;
    }
    if (!allowedMethods.includes(buildWizardState.abilityMethod)) {
      buildWizardState.abilityMethod = allowedMethods[0];
      buildWizardState.abilityScores = {};
    }
    document.querySelectorAll("[data-build-ability-method]").forEach((button) => {
      const method = button.dataset.buildAbilityMethod;
      const allowed = allowedMethods.includes(method);
      setElementVisible(button, allowed);
      const active = allowed && method === buildWizardState.abilityMethod;
      button.classList.toggle("btn-primary", active);
      button.classList.toggle("btn-outline-secondary", !active);
    });
    const defs = buildWizardState.abilityDefs;
    if (!defs.length) {
      mount.textContent = "This System has no ability scores defined.";
      return;
    }
    if (buildWizardState.abilityMethod === "pointBuy") {
      renderPointBuyAbilities(mount, defs);
    } else if (buildWizardState.abilityMethod === "roll") {
      renderRollAbilities(mount, defs);
    } else {
      // "array" — its own `values` (non-empty already confirmed by isBuildAbilityMethodUsable).
      const declaredArray = getBuildAbilityMethodConfig("array")?.values || [];
      const values = declaredArray.map((entry) => Number(entry.value ?? entry));
      renderValueAssignmentAbilities(mount, defs, values);
    }
  }

  // A value set dipping below zero (Daggerheart's +2/+1/+1/0/0/-1) is a
  // signed modifier range, where "+" reads as meaningful; one that never
  // goes negative (D&D's Standard Array) is a raw score, where "+15
  // Strength" would be wrong. Driven by the actual numbers, not a
  // per-System special case.
  function formatSignedNumber(value, values) {
    const hasNegative = values.some((entry) => Number(entry) < 0);
    return hasNegative && value > 0 ? `+${value}` : String(value);
  }

  // Shared by Array (a fixed standard array) and Roll (6 freshly rolled
  // values) — both are "assign these N fixed values across the abilities,
  // each value used exactly once," differing only in where the value list
  // comes from.
  function renderValueAssignmentAbilities(mount, defs, values) {
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    defs.forEach((def) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2";
      const label = document.createElement("label");
      label.className = "fw-semibold";
      // min-width, not a hard width — aligns short names without clipping a long one.
      label.style.minWidth = "8rem";
      label.textContent = def.label;
      const select = document.createElement("select");
      select.className = "form-select form-select-sm";
      select.style.maxWidth = "8rem";
      select.dataset.abilityKey = def.key;
      row.append(label, select);
      wrap.appendChild(row);
    });
    mount.appendChild(wrap);
    const selects = Array.from(wrap.querySelectorAll("select"));
    // Tracked by SLOT (index into `values`), not by value — Roll can produce
    // duplicate numbers, and tracking "is this value used" would make every
    // duplicate unavailable once one was assigned.
    const assignments = {};
    function refresh() {
      selects.forEach((select) => {
        const key = select.dataset.abilityKey;
        const currentSlot = assignments[key];
        const usedSlots = new Set(
          Object.entries(assignments)
            .filter(([otherKey]) => otherKey !== key)
            .map(([, slot]) => slot)
        );
        select.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "—";
        select.appendChild(blank);
        values.forEach((value, slotIndex) => {
          if (usedSlots.has(slotIndex) && slotIndex !== currentSlot) {
            return;
          }
          const option = document.createElement("option");
          option.value = String(slotIndex);
          option.textContent = formatSignedNumber(value, values);
          select.appendChild(option);
        });
        select.value = currentSlot != null ? String(currentSlot) : "";
      });
    }
    selects.forEach((select) => {
      select.addEventListener("change", () => {
        const key = select.dataset.abilityKey;
        if (select.value === "") {
          delete assignments[key];
          buildWizardState.abilityScores[key] = undefined;
        } else {
          const slotIndex = Number(select.value);
          assignments[key] = slotIndex;
          buildWizardState.abilityScores[key] = values[slotIndex];
        }
        refresh();
        updateBuildNextState();
      });
    });
    refresh();
  }

  function renderPointBuyAbilities(mount, defs) {
    const { min, max, budget, costs } = getBuildAbilityMethodConfig("pointBuy");
    const costOf = (score) => Number(costs?.[score] ?? 0);
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    defs.forEach((def) => {
      if (buildWizardState.abilityScores[def.key] == null) {
        buildWizardState.abilityScores[def.key] = min;
      }
    });
    const remainingLabel = document.createElement("div");
    remainingLabel.className = "fw-semibold small";
    wrap.appendChild(remainingLabel);
    defs.forEach((def) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2";
      const label = document.createElement("label");
      label.className = "fw-semibold";
      // min-width, not a hard width — aligns short names without clipping a long one.
      label.style.minWidth = "8rem";
      label.textContent = def.label;
      const minusButton = document.createElement("button");
      minusButton.type = "button";
      minusButton.className = "btn btn-sm btn-outline-secondary";
      minusButton.textContent = "−";
      const valueSpan = document.createElement("span");
      valueSpan.className = "text-center";
      valueSpan.style.width = "2rem";
      const plusButton = document.createElement("button");
      plusButton.type = "button";
      plusButton.className = "btn btn-sm btn-outline-secondary";
      plusButton.textContent = "+";
      row.append(label, minusButton, valueSpan, plusButton);
      wrap.appendChild(row);
      const spent = () => defs.reduce((total, entry) => total + costOf(buildWizardState.abilityScores[entry.key]), 0);
      const refreshRow = () => {
        const score = buildWizardState.abilityScores[def.key];
        valueSpan.textContent = formatSignedNumber(score, [min, max]);
        minusButton.disabled = score <= min;
        const nextCost = costs?.[score + 1];
        plusButton.disabled = score >= max || nextCost === undefined || spent() - costOf(score) + Number(nextCost) > budget;
        remainingLabel.textContent = `Points remaining: ${budget - spent()}`;
      };
      minusButton.addEventListener("click", () => {
        buildWizardState.abilityScores[def.key] = Math.max(min, buildWizardState.abilityScores[def.key] - 1);
        refreshRow();
        updateBuildNextState();
      });
      plusButton.addEventListener("click", () => {
        buildWizardState.abilityScores[def.key] = Math.min(max, buildWizardState.abilityScores[def.key] + 1);
        refreshRow();
        updateBuildNextState();
      });
      refreshRow();
    });
    mount.appendChild(wrap);
    remainingLabel.textContent = `Points remaining: ${budget - defs.reduce((total, entry) => total + costOf(buildWizardState.abilityScores[entry.key]), 0)}`;
  }

  // A "roll" method with a `formulas` map (one formula per ability key, e.g. CoC's
  // STR/CON/.../POW vs SIZ/INT/EDU) rolls each ability directly, one row with its
  // own Roll/Reroll — unlike the shared-formula case, each formula IS the ability.
  function renderPerAbilityRollAbilities(mount, defs, config) {
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    const rollOne = (key) => {
      const formula = config.formulas[key] || config.formula;
      if (!formula) return;
      try {
        buildWizardState.abilityScores[key] = rollDiceExpression(formula).total;
      } catch (error) {
        console.warn("Character editor: unable to roll ability score", key, error);
      }
    };
    const rollAllButton = document.createElement("button");
    rollAllButton.type = "button";
    rollAllButton.className = "btn btn-outline-primary btn-sm align-self-start mb-2";
    rollAllButton.textContent = defs.some((def) => buildWizardState.abilityScores[def.key] != null) ? "Reroll All" : "Roll All";
    rollAllButton.addEventListener("click", () => {
      defs.forEach((def) => rollOne(def.key));
      renderBuildAbilitiesStep();
      updateBuildNextState();
    });
    wrap.appendChild(rollAllButton);
    defs.forEach((def) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2";
      const label = document.createElement("label");
      label.className = "fw-semibold";
      label.style.minWidth = "8rem";
      label.textContent = def.label;
      const valueSpan = document.createElement("span");
      valueSpan.className = "text-center";
      valueSpan.style.minWidth = "2rem";
      valueSpan.textContent = buildWizardState.abilityScores[def.key] ?? "—";
      const rollButton = document.createElement("button");
      rollButton.type = "button";
      rollButton.className = "btn btn-sm btn-outline-secondary";
      rollButton.textContent = buildWizardState.abilityScores[def.key] != null ? "Reroll" : "Roll";
      rollButton.addEventListener("click", () => {
        rollOne(def.key);
        valueSpan.textContent = buildWizardState.abilityScores[def.key];
        rollButton.textContent = "Reroll";
        updateBuildNextState();
      });
      row.append(label, valueSpan, rollButton);
      wrap.appendChild(row);
    });
    mount.appendChild(wrap);
  }

  function renderRollAbilities(mount, defs) {
    const config = getBuildAbilityMethodConfig("roll");
    if (config?.formulas && typeof config.formulas === "object" && Object.keys(config.formulas).length) {
      renderPerAbilityRollAbilities(mount, defs, config);
      return;
    }
    const { formula, count, label } = config;
    const rollLabel = label || formula;
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    const rollButton = document.createElement("button");
    rollButton.type = "button";
    rollButton.className = "btn btn-outline-primary btn-sm align-self-start";
    rollButton.textContent = buildWizardState.rolledScores.length ? `Reroll (${rollLabel})` : `Roll scores (${rollLabel})`;
    rollButton.addEventListener("click", () => {
      try {
        buildWizardState.rolledScores = Array.from({ length: Number(count) }, () => rollDiceExpression(formula).total);
      } catch (error) {
        console.warn("Character editor: unable to roll ability scores", error);
        return;
      }
      buildWizardState.abilityScores = {};
      renderBuildAbilitiesStep();
      updateBuildNextState();
    });
    wrap.appendChild(rollButton);
    mount.appendChild(wrap);
    if (buildWizardState.rolledScores.length) {
      const assignMount = document.createElement("div");
      assignMount.className = "mt-2";
      mount.appendChild(assignMount);
      renderValueAssignmentAbilities(assignMount, defs, buildWizardState.rolledScores);
    }
  }

  // Fully generic — one free-text input per entry in the "input" buildStep's
  // declared `inputs[]`, never a fixed count/labels baked into this file. A
  // future System's own "type a few labeled things" step reuses this unchanged.
  // Values live in buildWizardState.inputValues by index, read back directly in
  // buildCharacterFromWizard — no pendingChoice, since typing isn't a pick.
  function renderBuildInputStep() {
    const mount = elements.buildInputMount;
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const inputDefs = getBuildStepEntry("input")?.inputs;
    if (!Array.isArray(inputDefs) || !inputDefs.length) {
      mount.textContent = "This System hasn't declared any inputs for this step.";
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    inputDefs.forEach((def, index) => {
      const row = document.createElement("div");
      row.className = "d-flex align-items-center gap-2";
      const label = document.createElement("label");
      label.className = "fw-semibold";
      label.style.minWidth = "8rem";
      label.textContent = (def?.label || `Input ${index + 1}`) + (def?.optional ? " (optional)" : "");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "form-control form-control-sm";
      input.placeholder = def?.placeholder || "";
      input.value = buildWizardState.inputValues[index] || "";
      input.addEventListener("input", () => {
        buildWizardState.inputValues[index] = input.value;
        updateBuildNextState();
      });
      row.append(label, input);
      wrap.appendChild(row);
    });
    mount.appendChild(wrap);
  }

  // A pointAllocation step's own `scopeSource` (same {from, field} convention
  // listPick's `source` uses) names WHICH leaves of the target field the budget
  // may be spent on, by short key — absent means "every leaf." Returns a Set of
  // short keys, or null when nothing is declared.
  function resolvePointAllocationScope(stepEntry) {
    const scope = stepEntry?.scopeSource;
    if (!scope?.field) return null;
    const raw =
      scope.from === "class"
        ? buildWizardState.classRecord?.[scope.field]
        : scope.from === "system"
          ? systemFieldValues(buildWizardState.systemDefinition, scope.field)
          : null;
    if (!Array.isArray(raw)) return null;
    return new Set(raw.map((value) => (typeof value === "string" ? value : value?.key || value?.name)).filter(Boolean));
  }

  // The step's `targetPath` names a reserved System field to allocate across —
  // either a two-level object (BitD's grouped "actions") or a flat single-level
  // object (CoC's flat "skills"); either shape resolves to the same
  // {key,label,items} groups shape, a flat field wrapped in one implicit
  // unlabeled group. Further narrowed by `scopeSource` or `exclude`, never both.
  function getPointAllocationGroups(stepEntry, systemDefinition = buildWizardState.systemDefinition) {
    const targetField = fieldByKey(systemDefinition?.fields, stepEntry?.targetPath);
    const children = Array.isArray(targetField?.children) ? targetField.children : [];
    const isGrouped = children.some((child) => Array.isArray(child?.children) && child.children.length);
    const rawGroups = isGrouped
      ? children.map((group) => ({ key: group?.key || "", label: group?.label || group?.key || "", leaves: Array.isArray(group?.children) ? group.children : [] }))
      : [{ key: "", label: "", leaves: children }];
    const scopeNames = resolvePointAllocationScope(stepEntry);
    const exclude = Array.isArray(stepEntry?.exclude) ? stepEntry.exclude : null;
    return rawGroups
      .map((group) => ({
        key: group.key,
        label: group.label,
        items: group.leaves
          .map((leaf) => {
            const fullKey = String(leaf?.key || "");
            // A leaf's declared `maximum` (CoC skills: capped at 99) is an implicit
            // per-item ceiling, independent of the step's `maxRating` — the two
            // compose (lower wins), so a step can still add a tighter cap on a
            // field whose leaves declare no maximum.
            const declaredMax = Number(leaf?.maximum);
            // A leaf's declared `basePercentage` (CoC: Climb starts at 20%) is an
            // implicit floor every allocation builds on top of — generic to any
            // field whose children declare one, additive with `prefill`'s floor.
            const declaredBase = Number(leaf?.basePercentage);
            return {
              key: fullKey,
              shortKey: fullKey.split(".").pop(),
              label: leaf?.label || fullKey,
              description: leaf?.description || "",
              maximum: Number.isFinite(declaredMax) ? declaredMax : Infinity,
              basePercentage: Number.isFinite(declaredBase) ? declaredBase : 0,
            };
          })
          .filter((item) => !scopeNames || scopeNames.has(item.shortKey))
          .filter((item) => !exclude || !exclude.includes(item.key)),
      }))
      .filter((group) => group.items.length);
  }

  // How much a step's budget is, before anything is spent — a literal `budget`
  // (BitD's fixed 4 dots), or a `budgetFormula` evaluated against the character's
  // live data (CoC's `@characteristics.education * 4`), through the same formula
  // engine derivedFormulas uses. Never both on the same step.
  function resolvePointAllocationBudget(stepEntry) {
    // `budgetSource` reads the formula STRING off the picked class/occupation
    // record itself rather than a single literal on the step — CoC's own
    // occupations don't all use the same skill-point formula (most are EDU×4, a
    // few use EDU×2 + an alternate characteristic), so the formula travels WITH
    // the picked Occupation.
    const sourcedFormula =
      stepEntry?.budgetSource?.from === "class" ? buildWizardState.classRecord?.[stepEntry.budgetSource.field] : null;
    const formula = typeof sourcedFormula === "string" && sourcedFormula.trim() ? sourcedFormula : stepEntry?.budgetFormula;
    if (typeof formula === "string" && formula.trim()) {
      try {
        // getBindingContext() alone is whatever character was previously loaded —
        // a budget formula referencing an ability score generated earlier in THIS
        // wizard (CoC's EDU×4) needs buildWizardState.abilityScores merged in too,
        // since those don't land in the real draft until creation actually runs.
        // Exposed at the CONTEXT ROOT (bare "@education", matching every
        // other buildStep formula's own bare-key convention — BitD's own
        // derivedFormulas reference bare "@hunt", never a nested path)
        // rather than trying to reconstruct whatever nested shape the
        // System's own ability field happens to use.
        const context = { ...getBindingContext(), ...buildWizardState.abilityScores };
        const result = evaluateFormulaWithLookup(formula, context, { rollDice: rollDiceExpression });
        const numeric = Number(result);
        return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
      } catch (error) {
        console.warn("Character editor: unable to evaluate pointAllocation budget formula", error);
        return 0;
      }
    }
    return Number(stepEntry?.budget) || 0;
  }

  // How much an item starts at before the player spends anything — two
  // independent sources added together: the item's own `basePercentage`
  // (CoC skills, e.g. Climb starts at 20%) and the step's own `prefill`
  // block (BitD's class-granted primary/secondary action, read fresh off
  // classRecord every call so switching class recomputes the floor).
  // Either, both, or neither may apply — each System contributes only
  // through the channel that actually applies to it.
  function resolvePointAllocationPrefill(stepEntry, item) {
    const base = Number(item?.basePercentage) || 0;
    const prefill = stepEntry?.prefill;
    if (!prefill) return base;
    const record = prefill.source === "class" ? buildWizardState.classRecord : null;
    if (!record) return base;
    if (prefill.primaryField && record[prefill.primaryField] === item?.shortKey) return base + (Number(prefill.primaryValue) || 0);
    if (prefill.secondaryField && record[prefill.secondaryField] === item?.shortKey) return base + (Number(prefill.secondaryValue) || 0);
    return base;
  }

  // Spend a step's own budget (literal or formula-derived) across its own
  // target items (every leaf of one field, or a scoped/excluded subset),
  // respecting an optional flat per-item ceiling (`maxRating`) on top of
  // any `prefill` — same budgeted +/- shape as renderPointBuyAbilities.
  // Generic: BitD's Actions step (4 dots, capped at 2, class-prefilled)
  // and CoC's Occupation Skills (EDU×4, scoped subset, no cap/prefill)
  // both render through this one function unchanged.
  function renderBuildPointAllocationStep(stepId) {
    const mount = elements.buildPointAllocationMounts?.[stepId];
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const stepEntry = getBuildStepEntry(stepId);
    const budget = resolvePointAllocationBudget(stepEntry);
    const maxRating = Number(stepEntry?.maxRating) || Infinity;
    const groups = getPointAllocationGroups(stepEntry);
    if (!budget || !groups.length) {
      mount.textContent = "This System hasn't declared how this is assigned yet.";
      return;
    }
    if (!buildWizardState.pointAllocations[stepId]) {
      buildWizardState.pointAllocations[stepId] = {};
    }
    const allocations = buildWizardState.pointAllocations[stepId];
    const unitLabel = stepEntry?.unitLabel || "points";
    const spent = () => Object.values(allocations).reduce((total, value) => total + (Number(value) || 0), 0);
    const remainingLabel = document.createElement("div");
    remainingLabel.className = "fw-semibold small mb-2";
    mount.appendChild(remainingLabel);
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-3";
    groups.forEach((group) => {
      const groupWrap = document.createElement("div");
      if (group.label) {
        const groupLabel = document.createElement("div");
        groupLabel.className = "fw-semibold small text-body-secondary";
        groupLabel.textContent = group.label;
        groupWrap.appendChild(groupLabel);
      }
      // Long unscoped lists (CoC's Personal Interest: ~45 skills) flow
      // into two CSS columns once large enough to benefit; short groups
      // stay single-column. Multi-column (not grid) reads top-to-bottom
      // then wraps, the natural order for an alphabetical list.
      if (group.items.length > 10) {
        groupWrap.style.columnCount = "2";
        groupWrap.style.columnGap = "1.5rem";
      }
      group.items.forEach((item) => {
        // Computed once per row, not inside refreshRow — static for this
        // step/item pair, and setTotal needs the same value refreshRow
        // uses to stay in sync.
        const preFilled = resolvePointAllocationPrefill(stepEntry, item);
        const ceiling = () => Math.min(maxRating, item.maximum);
        const row = document.createElement("div");
        row.className = "d-flex align-items-center gap-2";
        // Multi-column layout splits block children across columns by
        // default — without this, one row could get torn across the break.
        row.style.breakInside = "avoid";
        row.style.marginBottom = "0.5rem";
        const label = document.createElement("label");
        label.className = "fw-semibold text-truncate";
        // A fixed width, not just a floor, so every row's controls land
        // in the same column regardless of label length — a long label
        // (e.g. "Operate Heavy Machinery") used to push that row's +/-
        // buttons out of alignment with the rest; text-truncate now
        // ellipsizes instead.
        label.style.width = "13rem";
        label.style.flex = "0 0 13rem";
        label.title = item.label;
        label.textContent = item.label;
        const minusButton = document.createElement("button");
        minusButton.type = "button";
        minusButton.className = "btn btn-sm btn-outline-secondary flex-shrink-0";
        minusButton.textContent = "−";
        // Direct-entry, not just +/-1 — CoC's own skill budgets run into
        // the hundreds, making +1 clicks unusable. Typed values still
        // respect every constraint (floor/ceiling/remaining budget) via
        // setTotal below, the single source of truth both routes through.
        const valueInput = document.createElement("input");
        valueInput.type = "number";
        valueInput.className = "form-control form-control-sm text-center flex-shrink-0";
        valueInput.style.width = "4.5rem";
        const plusButton = document.createElement("button");
        plusButton.type = "button";
        plusButton.className = "btn btn-sm btn-outline-secondary flex-shrink-0";
        plusButton.textContent = "+";
        row.append(label, minusButton, valueInput, plusButton);
        groupWrap.appendChild(row);
        // Single source of truth for "set this item's total to X" —
        // clamped to [preFilled, min(maxRating, item max, affordable)].
        // `+preFilled` in the affordability calc: this item's own current
        // extra is still part of spent(), so it must be added back before
        // comparing, or every row would look like it has less budget than
        // it actually does.
        const setTotal = (rawTotal) => {
          const currentExtra = Number(allocations[item.shortKey]) || 0;
          const affordableCeiling = preFilled + (budget - spent() + currentExtra);
          const requested = Math.round(Number(rawTotal));
          const clampedTotal = Number.isFinite(requested)
            ? Math.max(preFilled, Math.min(ceiling(), affordableCeiling, requested))
            : preFilled;
          allocations[item.shortKey] = clampedTotal - preFilled;
          groups.forEach((g) => g.items.forEach((i) => i._refresh?.()));
          updateBuildNextState();
        };
        const refreshRow = () => {
          const extra = Number(allocations[item.shortKey]) || 0;
          const total = preFilled + extra;
          valueInput.value = String(total);
          minusButton.disabled = extra <= 0;
          plusButton.disabled = total >= ceiling() || spent() >= budget;
          remainingLabel.textContent = `${budget - spent()} ${unitLabel} remaining`;
        };
        minusButton.addEventListener("click", () => setTotal(preFilled + (Number(allocations[item.shortKey]) || 0) - 1));
        plusButton.addEventListener("click", () => setTotal(preFilled + (Number(allocations[item.shortKey]) || 0) + 1));
        valueInput.addEventListener("change", () => setTotal(valueInput.value));
        item._refresh = refreshRow;
        refreshRow();
      });
      wrap.appendChild(groupWrap);
    });
    mount.appendChild(wrap);
    remainingLabel.textContent = `${budget - spent()} ${unitLabel} remaining`;
  }

  // Generic "choose N mutually-exclusive items from a curated list" step,
  // not feature/NPC-specific. `source.from` is "class" (a field off the
  // resolved class record) or "system" (a System-level reserved field,
  // matching `choices.equipmentChoices.sourceField`); `source` may also
  // be an array of `{from, field}` entries whose candidates are unioned.
  //
  // `idField` (class-sourced only) — when the display list and the real
  // value to write differ (a Playbook's `features[]` display objects vs.
  // its parallel `featureIds[]`), each option's value comes from
  // `idField`'s array at the same index, not from `source.field` itself.
  function resolveListPickSource(source, idField) {
    const sources = Array.isArray(source) ? source : [source].filter(Boolean);
    const seen = new Set();
    const options = [];
    sources.forEach((entry) => {
      let raw;
      let idList;
      if (entry?.from === "class") {
        raw = buildWizardState.classRecord?.[entry.field];
        idList = idField ? buildWizardState.classRecord?.[idField] : null;
      } else if (entry?.from === "system") {
        raw = systemFieldValues(buildWizardState.systemDefinition, entry.field);
      }
      (Array.isArray(raw) ? raw : []).forEach((value, index) => {
        const baseLabel = typeof value === "string" ? value : value?.name;
        if (!baseLabel) return;
        // A candidate with its own `descriptor` (BitD's Friend/Rival NPCs:
        // "Marlane" + "a pugilist") folds it into the label here — a
        // generic name+descriptor shape, not NPC-specific — so it reads
        // "Marlane, a pugilist" consistently everywhere downstream.
        const label = typeof value === "object" && value?.descriptor ? `${baseLabel}, ${value.descriptor}` : baseLabel;
        if (seen.has(label)) return;
        seen.add(label);
        const id = Array.isArray(idList) ? idList[index] : undefined;
        options.push({ label, raw: value, id });
      });
    });
    return options;
  }

  function renderBuildListPickStep(stepId) {
    const mount = elements.buildListPickMounts?.[stepId];
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const stepEntry = getBuildStepEntry(stepId);
    const options = resolveListPickSource(stepEntry?.source, stepEntry?.idField);
    const picks = Array.isArray(stepEntry?.picks) && stepEntry.picks.length ? stepEntry.picks : [{}];
    if (!options.length) {
      mount.textContent = "This System hasn't declared any options for this step yet.";
      return;
    }
    if (!buildWizardState.listPicks[stepId]) {
      buildWizardState.listPicks[stepId] = {};
    }
    const selections = buildWizardState.listPicks[stepId];
    const wrap = document.createElement("div");
    wrap.className = "d-flex flex-column gap-2";
    if (stepEntry?.searchable) {
      renderSearchableListPicks(wrap, options, picks, selections);
    } else {
      renderSelectListPicks(wrap, options, picks, selections);
    }
    mount.appendChild(wrap);
  }

  // Ordinary mutually-exclusive <select> picks, for a listPick step whose
  // candidates carry no real description worth a full picker panel.
  function renderSelectListPicks(wrap, options, picks, selections) {
    const selects = [];
    function refreshAll() {
      selects.forEach((select, slotIndex) => {
        const otherLabels = new Set(
          selects.map((_, i) => i).filter((i) => i !== slotIndex).map((i) => selections[i]?.label).filter(Boolean)
        );
        const current = select.value;
        select.innerHTML = "";
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "—";
        select.appendChild(blank);
        options
          .filter((option) => !otherLabels.has(option.label))
          .forEach((option) => {
            const el = document.createElement("option");
            el.value = option.label;
            el.textContent = option.label;
            select.appendChild(el);
          });
        select.value = options.some((option) => option.label === current) && !otherLabels.has(current) ? current : "";
      });
    }
    picks.forEach((pick, slotIndex) => {
      const row = document.createElement("div");
      row.className = "d-flex flex-column gap-1";
      if (pick?.label) {
        const label = document.createElement("label");
        label.className = "form-label small text-body-secondary fw-semibold mb-0";
        label.textContent = pick.label;
        row.appendChild(label);
      }
      const select = document.createElement("select");
      select.className = "form-select form-select-sm";
      select.addEventListener("change", () => {
        const picked = options.find((option) => option.label === select.value) || null;
        if (picked) {
          selections[slotIndex] = picked;
        } else {
          delete selections[slotIndex];
        }
        refreshAll();
        updateBuildNextState();
      });
      row.appendChild(select);
      wrap.appendChild(row);
      selects.push(select);
    });
    refreshAll();
  }

  // Same filterable, description-showing picker Playbook/Heritage/
  // Background use (createFilterableListPicker), for a listPick step
  // whose `searchable: true` means candidates carry real description text
  // worth reading first. Re-renders the whole set on every pick (lists
  // are small) so mutual exclusion works like the <select> version above.
  function renderSearchableListPicks(wrap, options, picks, selections) {
    function renderAll() {
      wrap.innerHTML = "";
      picks.forEach((pick, slotIndex) => {
        const row = document.createElement("div");
        row.className = "d-flex flex-column gap-1";
        if (pick?.label) {
          const label = document.createElement("label");
          label.className = "form-label small text-body-secondary fw-semibold mb-0";
          label.textContent = pick.label;
          row.appendChild(label);
        }
        const otherLabels = new Set(
          picks.map((_, i) => i).filter((i) => i !== slotIndex).map((i) => selections[i]?.label).filter(Boolean)
        );
        const pickerOptions = options
          .filter((option) => !otherLabels.has(option.label))
          .map((option) => ({
            id: option.id || option.label,
            name: option.label,
            description: resolveNotes(option.raw),
            raw: option.raw,
          }));
        const picker = createFilterableListPicker({
          options: pickerOptions,
          emptyMessage: "Nothing available.",
          initialSelectedId: selections[slotIndex]?.id ?? null,
          onSelect: (option) => {
            selections[slotIndex] = { label: option.name, raw: option.raw, id: option.id };
            renderAll();
            updateBuildNextState();
          },
        });
        row.appendChild(picker.element);
        wrap.appendChild(row);
      });
    }
    renderAll();
  }

  function renderBuildReview() {
    const mount = elements.buildReviewMount;
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const imageUrl = (elements.buildCharacterImage?.value || "").trim();
    const pronouns = (elements.buildCharacterPronouns?.value || "").trim();
    // Walks the actual active step sequence rather than a fixed
    // D&D-shaped summary — a "heritage" System gets its own 2 picks
    // summarized from that step's declared `picks[].label`, not
    // "Species"/"Background" lines it doesn't actually have.
    const { steps: activeSteps } = getActiveBuildSteps();
    const lines = [`Name: ${(elements.buildCharacterName?.value || "").trim() || "—"}`, ...(pronouns ? [`Pronouns: ${pronouns}`] : [])];
    activeSteps.forEach((step) => {
      const entry = getBuildStepEntry(step);
      if (step === "species") {
        lines.push(`${entry?.label || step}: ${buildWizardState.speciesName || "—"}`);
      } else if (step === "class") {
        lines.push(`${entry?.label || step}: ${buildWizardState.className || "—"}`);
      } else if (step === "subclass") {
        lines.push(`${entry?.label || step}: ${buildWizardState.subclassName || "—"}`);
      } else if (step === "background") {
        lines.push(`${entry?.label || step}: ${buildWizardState.backgroundName || "—"}`);
      } else if (step === "heritage") {
        const picks = Array.isArray(entry?.picks) ? entry.picks : [];
        lines.push(`${picks[0]?.label || "heritage"}: ${buildWizardState.speciesName || "—"}`);
        if (buildWizardState.mixedAncestry) {
          lines.push(`Mixed with: ${buildWizardState.secondSpeciesName || "—"}`);
        }
        lines.push(`${picks[1]?.label || "heritage"}: ${buildWizardState.backgroundName || "—"}`);
      } else if (step === "abilities") {
        buildWizardState.abilityDefs.forEach((def) => {
          const score = buildWizardState.abilityScores[def.key];
          lines.push(`${def.label}: ${score == null ? "—" : formatSignedNumber(score, Object.values(buildWizardState.abilityScores))}`);
        });
      } else if (step === "input") {
        (Array.isArray(entry?.inputs) ? entry.inputs : []).forEach((def, index) => {
          lines.push(`${def?.label || `Input ${index + 1}`}: ${buildWizardState.inputValues[index] || "—"}`);
        });
      } else if (entry?.type === "pointAllocation") {
        const allocations = buildWizardState.pointAllocations[step] || {};
        getPointAllocationGroups(entry).forEach((group) => {
          group.items.forEach((item) => {
            const total = resolvePointAllocationPrefill(entry, item) + (Number(allocations[item.shortKey]) || 0);
            if (total > 0) {
              lines.push(`${item.label}: ${total}`);
            }
          });
        });
      } else if (entry?.type === "listPick") {
        const picks = Array.isArray(entry.picks) && entry.picks.length ? entry.picks : [{}];
        const selections = buildWizardState.listPicks[step] || {};
        picks.forEach((pick, slotIndex) => {
          lines.push(`${pick?.label || entry?.label || step}: ${selections[slotIndex]?.label || "—"}`);
        });
      }
    });
    lines.push(`Image URL: ${imageUrl || "—"}`);
    const list = document.createElement("ul");
    list.className = "d-flex flex-column gap-1 small mb-0 ps-3";
    lines.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    mount.appendChild(list);
  }

  // Mirrors the Level Up modal's confirm→resolve transition: creating the
  // character advances to the wizard's own "choices" step (a real,
  // counted step) showing pendingChoices, rather than closing immediately.
  // The record is genuinely created here (pendingChoices need a real id),
  // but that's a background step — the success toast waits until Finish
  // (see the Next-button handler). Anything left unresolved on early
  // close already sits in state.draft.pendingChoices, which Character
  // Properties renders from the same data.
  async function submitBuildWizard() {
    if (elements.buildNextButton) {
      elements.buildNextButton.disabled = true;
    }
    let pendingChoices;
    try {
      pendingChoices = await buildCharacterFromWizard();
    } finally {
      if (elements.buildNextButton) {
        elements.buildNextButton.disabled = false;
      }
    }
    if (!Array.isArray(pendingChoices)) {
      return;
    }
    const { steps } = getActiveBuildSteps();
    const choicesIndex = steps.indexOf("choices");
    // No declared "choices" step means nothing to route to —
    // applyBuildStepChrome(-1) would hide every panel and leave the modal
    // stuck open. Finish immediately instead, as if the resolve panel
    // were already empty.
    if (choicesIndex === -1) {
      await finishBuildChoicesStep();
      return;
    }
    buildWizardState.step = choicesIndex;
    applyBuildStepChrome(choicesIndex);
    renderBuildResolvePanel(pendingChoices);
  }

  // Finish auto-confirms every still-present row whose tryConfirm() reports
  // it's actually ready (fully selected, no duplicates) — a user expects
  // "fill everything in, then click Finish" to work like every other
  // step's Next button. A blank/partial row is left untouched and stays
  // pending ("close and finish them later from Character Properties").
  async function finishBuildChoicesStep() {
    if (elements.buildNextButton) {
      elements.buildNextButton.disabled = true;
    }
    try {
      // Sequential, not Promise.all — each resolution mutates and
      // persists the same state.draft, so concurrent saves risk one
      // clobbering another's just-applied pick.
      const rows = Array.from(elements.buildResolveMount?.querySelectorAll("[data-build-resolve-list] > *") || []);
      for (const row of rows) {
        if (typeof row._tryConfirm === "function") {
          await row._tryConfirm();
        }
      }
    } catch (error) {
      console.warn("Character editor: unable to auto-confirm remaining Build Wizard choices", error);
    } finally {
      if (elements.buildNextButton) {
        elements.buildNextButton.disabled = false;
      }
    }
    // Only now — the last step, resolved or deliberately deferred — do we
    // tell the user this is finished. The record was created earlier (on
    // Review), but that was a background step, not its own "done" moment.
    const finishedName = (elements.buildCharacterName?.value || "").trim();
    if (finishedName) {
      status.show(`Created ${finishedName}`, { type: "success", timeout: 2400 });
    }
    // Bootstrap sets aria-hidden as the modal hides — blur first so that
    // never lands on a still-focused element (an a11y violation otherwise).
    if (document.activeElement instanceof HTMLElement && elements.buildResolveMount?.closest(".modal")?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    newCharacterModalInstance?.hide();
  }

  function renderBuildResolvePanel(pendingChoices) {
    const mount = elements.buildResolveMount;
    if (!mount) {
      return;
    }
    mount.innerHTML = "";
    const summary = document.createElement("p");
    summary.className = "mb-2";
    summary.textContent = pendingChoices.length
      ? "A few last choices to make — resolve them below, or close and finish them later from Character Properties."
      : "Nothing left to choose — click Finish.";
    mount.appendChild(summary);
    if (pendingChoices.length) {
      const list = document.createElement("div");
      list.className = "d-flex flex-column gap-2";
      // Finish reads this back to auto-confirm every fully-filled row —
      // children are the row elements below, each carrying `._tryConfirm`.
      list.setAttribute("data-build-resolve-list", "");
      pendingChoices.forEach((choice) => {
        const row = renderPendingChoiceRow(choice, {
          onResolved: () => {
            row.remove();
            if (!list.children.length) {
              summary.textContent = "All set — click Finish.";
            }
          },
        });
        list.appendChild(row);
      });
      mount.appendChild(list);
    }
  }

  // Applies everything the wizard collected: identity links (species/
  // class/background, all real refKind/refId), ability scores, starting
  // HP (level-1 SRD rule: max hit die + CON modifier, not the 2nd-level+
  // growth formula), proficiency bonus, every level-1/unconditional
  // feature grant, and a pendingChoices entry for every genuine pick —
  // resolved afterward via the same Character Properties Level Up UI,
  // never inside this wizard.
  async function buildCharacterFromWizard() {
    const name = (elements.buildCharacterName?.value || "").trim();
    const templateId = (elements.buildCharacterTemplate?.value || "").trim();
    if (!name || !templateId || !buildWizardState.classId) {
      status.show("Complete every step before creating the character.", { type: "warning", timeout: 2400 });
      return;
    }
    const id = generateCharacterId(name);
    if (characterCatalog.has(id)) {
      status.show("Character ID already exists. Choose another name.", { type: "warning", timeout: 2400 });
      return;
    }
    const templateMetadata = templateCatalog.get(templateId);
    if (!templateMetadata) {
      status.show("Template metadata unavailable.", { type: "warning", timeout: 2200 });
      return;
    }
    if (state.template?.id !== templateId) {
      await loadTemplateById(templateId);
    }
    // loadTemplateById's own updateSystemContext is fire-and-forget
    // internally — awaited explicitly here so downstream binding lookups
    // read this template's System, not whatever was active before.
    await updateSystemContext(state.template?.schema || templateMetadata.schema || "");

    let speciesRecord = null;
    let classRecord = null;
    let backgroundRecord = null;
    let subclassRecord = null;
    let secondSpeciesRecord = null;
    const pickedSubclassId = buildWizardState.needsSubclassStep ? buildWizardState.subclassId : "";
    const wantsSecondSpecies = buildWizardState.mixedAncestry && Boolean(buildWizardState.secondSpeciesId);
    // Kinds come from the relevant buildStep's own declared `kind` (or
    // heritage's `picks[].kind`) — reading buildWizardState.systemDefinition
    // directly is safe here since this function only ever runs for the
    // Template the wizard is actively building against.
    const heritageStepEntry = getBuildStepEntry("heritage");
    const speciesKind = heritageStepEntry ? heritageStepEntry.picks?.[0]?.kind : getBuildStepEntry("species")?.kind;
    const classKind = getBuildStepEntry("class")?.kind;
    const backgroundKind = heritageStepEntry ? heritageStepEntry.picks?.[1]?.kind : getBuildStepEntry("background")?.kind;
    const subclassKind = getBuildStepEntry("subclass")?.kind;
    try {
      const [speciesResult, classResult, backgroundResult, subclassResult, secondSpeciesResult] = await Promise.all([
        buildWizardState.speciesId ? dataManager.get(speciesKind, buildWizardState.speciesId, { preferLocal: false }) : null,
        dataManager.get(classKind, buildWizardState.classId, { preferLocal: false }),
        buildWizardState.backgroundId ? dataManager.get(backgroundKind, buildWizardState.backgroundId, { preferLocal: false }) : null,
        pickedSubclassId ? dataManager.get(subclassKind, pickedSubclassId, { preferLocal: false }) : null,
        wantsSecondSpecies ? dataManager.get(speciesKind, buildWizardState.secondSpeciesId, { preferLocal: false }) : null,
      ]);
      speciesRecord = speciesResult?.payload || null;
      classRecord = classResult?.payload || null;
      backgroundRecord = backgroundResult?.payload || null;
      subclassRecord = subclassResult?.payload || null;
      secondSpeciesRecord = secondSpeciesResult?.payload || null;
    } catch (error) {
      console.error("Character editor: unable to fetch Build Character source records", error);
    }
    if (!classRecord) {
      status.show("Unable to fetch the selected class.", { type: "danger", timeout: 2800 });
      return;
    }

    const initialSchema = state.template?.schema || templateMetadata?.schema || "";
    const abilities = {};
    buildWizardState.abilityDefs.forEach((def) => {
      // `!= null`, not `||` — an unset score defaults to 10, but 0 is a
      // real assigned value (Daggerheart's Standard Array has two "+0"
      // entries) and must round-trip as 0, not fall back to 10.
      const rawScore = buildWizardState.abilityScores[def.key];
      abilities[def.key] = rawScore != null ? Number(rawScore) : 10;
    });
    // Same auto-detection loadAbilityFieldDefs uses to find the System's
    // ability field (D&D's "abilities" vs CoC's "characteristics") —
    // without this, scores were always written to `stats.abilities`
    // regardless of what the System actually calls that field.
    const abilityFieldKey = guessAbilityFieldKey(buildWizardState.systemDefinition?.fields) || "abilities";
    const imageUrl = (elements.buildCharacterImage?.value || "").trim();
    const pronouns = (elements.buildCharacterPronouns?.value || "").trim();
    const draft = {
      id,
      name,
      title: name,
      template: templateId,
      systemIds: initialSchema ? [initialSchema] : [],
      data: { name },
      state: { timers: {}, log: [] },
      ...(imageUrl ? { image: imageUrl } : {}),
      identity: {
        name,
        ...(pronouns ? { pronouns } : {}),
        level: 1,
        classes: [
          {
            name: buildWizardState.className || classRecord.name || "",
            level: 1,
            refKind: classKind,
            refId: buildWizardState.classId,
            ...(buildWizardState.needsSubclassStep && buildWizardState.subclassId
              ? { subclass: { name: buildWizardState.subclassName || "", refKind: subclassKind, refId: buildWizardState.subclassId } }
              : {}),
          },
        ],
        ...(buildWizardState.speciesId
          ? {
              race: {
                name: secondSpeciesRecord
                  ? `${buildWizardState.speciesName || speciesRecord?.name || ""}/${buildWizardState.secondSpeciesName || secondSpeciesRecord.name || ""} (Mixed Ancestry)`
                  : buildWizardState.speciesName || speciesRecord?.name || "",
                refKind: speciesKind,
                refId: buildWizardState.speciesId,
              },
            }
          : {}),
        ...(buildWizardState.backgroundId
          ? {
              background: {
                name: buildWizardState.backgroundName || backgroundRecord?.name || "",
                refKind: backgroundKind,
                refId: buildWizardState.backgroundId,
              },
            }
          : {}),
      },
      // D&D/Daggerheart's own historical convention nests scores under
      // `stats.abilities` — kept exactly as-is, zero behavior change,
      // when the detected key literally IS "abilities". Any OTHER
      // detected key (Call of Cthulhu's own "characteristics") is a
      // TOP-LEVEL reserved field on the System, matching every other
      // buildStep target path in this whole file (skills, actions, vice,
      // ... — none of those get an implicit "stats." wrapper either), so
      // it's placed there instead — the `stats.abilities` nesting was
      // D&D-sheet-shape baggage, never a rule every System should inherit.
      stats: { ...(abilityFieldKey === "abilities" ? { abilities } : {}) },
      ...(abilityFieldKey !== "abilities" ? { [abilityFieldKey]: abilities } : {}),
      featureIds: [],
      currencies: {},
      inventory: [],
      proficiencies: {},
      pendingChoices: [],
    };

    // Building a character for `initialSchema`, which isn't necessarily the
    // System currently loaded as state.systemDefinition (that's whatever
    // record is CURRENTLY open, if any) — fetched once, reused for every
    // derivedFormulas lookup below.
    const buildSystemDefinition = await fetchSystemDefinition(initialSchema);
    // Only a System that actually declares a "proficiencyBonusForLevel"
    // derivedFormulas role (D&D 5e, Daggerheart) gets a stats.
    // proficiencyBonus written at all — a System with no such role (Call
    // of Cthulhu, Blades in the Dark) has no matching template binding
    // for it, so writing a bare "0" here would just be D&D-sheet-shape
    // cruft with nothing to read it.
    const hasProficiencyBonusRole = systemFieldValues(buildSystemDefinition, "derivedFormulas").some((entry) => entry?.role === "proficiencyBonusForLevel");
    if (hasProficiencyBonusRole) {
      draft.stats.proficiencyBonus = evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "proficiencyBonusForLevel", { level: 1 }) || 0;
    }

    // Generic "compute starting resource pools from this character's own
    // stat-block scores, once, at creation" pass — any System declaring
    // the matching derivedFormulas roles gets these written; a System
    // with none of these roles (Blades in the Dark, D&D) sees no writes
    // at all here. Call of Cthulhu's own Hit Points/Magic Points/Sanity/
    // Move Rate are the motivating case, but nothing below is CoC-
    // specific — roles and target paths are read from the System's own
    // derivedFormulas entries, never hardcoded. `derivedContext` uses
    // bare keys (strength, constitution, ...), matching every other
    // formula context this file already builds the same way.
    const derivedFormulaEntries = systemFieldValues(buildSystemDefinition, "derivedFormulas");
    const RESOURCE_POOL_ROLES = [
      { role: "hitPoints", maxPath: "@stats.hitPoints.max", currentPath: "@stats.hitPoints.current" },
      { role: "magicPoints", maxPath: "@stats.magicPoints.max", currentPath: "@stats.magicPoints.current" },
      { role: "sanityStart", maxPath: "@stats.sanity.max", currentPath: "@stats.sanity.current" },
    ];
    RESOURCE_POOL_ROLES.forEach(({ role, maxPath, currentPath }) => {
      const value = Number(evaluateDerivedFormula(derivedFormulaEntries, role, abilities));
      if (!Number.isFinite(value)) return;
      const maxSegs = resolveBindingPath(maxPath);
      if (maxSegs) setValueAtContext(draft, maxSegs, value);
      const currentSegs = resolveBindingPath(currentPath);
      if (currentSegs) setValueAtContext(draft, currentSegs, value);
    });
    const moveRateValue = Number(evaluateDerivedFormula(derivedFormulaEntries, "moveRate", abilities));
    if (Number.isFinite(moveRateValue)) {
      const segs = resolveBindingPath("@stats.moveRate");
      if (segs) setValueAtContext(draft, segs, moveRateValue);
    }

    // Any top-level System field carrying its own `rollFormula` (Call of
    // Cthulhu's own Luck: rolled once at creation, 3D6×5 — never part of
    // the "abilities" step's own array/roll methods, since Luck is
    // ALWAYS separately rolled even under the quickstart point-array
    // method) gets rolled here and written to its own path — generic to
    // any System declaring this on any field, not a Luck-specific hook.
    (buildSystemDefinition?.fields || []).forEach((field) => {
      if (typeof field?.rollFormula !== "string" || !field.rollFormula.trim()) return;
      try {
        const rolled = rollDiceExpression(field.rollFormula).total;
        const segs = resolveBindingPath(`@${field.key}`);
        if (segs && Number.isFinite(rolled)) setValueAtContext(draft, segs, rolled);
      } catch (error) {
        console.warn("Character editor: unable to roll", field.key, error);
      }
    });

    // A range-lookup table (Call of Cthulhu's own Damage Bonus/Build:
    // STR+SIZ against a breakpoint table) — generic to any System
    // declaring `sumFields` (which two stat-block leaves to add together)
    // on an array field whose own entries carry {min,max,...}. Every
    // OTHER property the matched row carries (Call of Cthulhu's own
    // damageBonus/build) is written to its own `stats.<propertyName>`
    // path — the table's own row shape decides what gets written, not a
    // hardcoded pair of field names.
    (buildSystemDefinition?.fields || [])
      .filter((field) => Array.isArray(field?.sumFields) && field.sumFields.length === 2 && Array.isArray(field?.values))
      .forEach((field) => {
        const sum = field.sumFields.reduce((total, key) => total + (Number(abilities[key]) || 0), 0);
        const row = field.values.find((entry) => sum >= Number(entry?.min) && sum <= Number(entry?.max));
        if (!row) return;
        Object.keys(row).forEach((key) => {
          if (key === "name" || key === "min" || key === "max") return;
          const segs = resolveBindingPath(`@stats.${key}`);
          if (segs) setValueAtContext(draft, segs, row[key]);
        });
      });

    // Seeds a real stats.skills[] from the System's own "skills" array field
    // (loadArrayFieldValues — the same generic array-field reader
    // loadAbilityFieldDefs' own module already exports, never a hardcoded
    // skill list) — without this, Background's own flat proficiency grants
    // below (applyProficiencyGrant's Skill: branch) would have nowhere real
    // to write a proficiency onto, since a freshly built character has no
    // skills array at all otherwise. `name` slugified to match the real
    // lowercase-hyphenated convention this suite's own character records
    // already use ("animal-handling") — confirmed against a real imported
    // character, not guessed.
    const systemSkills = await loadArrayFieldValues(dataManager, initialSchema, "skills");
    draft.stats.skills = systemSkills.map((entry) => {
      const abilityKey = String(entry.ability || "").toLowerCase();
      const abilityDef = buildWizardState.abilityDefs.find((def) => def.key === abilityKey);
      return {
        name: String(entry.name || "").toLowerCase().replace(/\s+/g, "-"),
        friendlyName: entry.name || "",
        ability: abilityDef?.label || abilityKey.slice(0, 3).toUpperCase(),
        value: evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "abilityModifier", { score: abilities[abilityKey] ?? 10 }) || 0,
        proficiency: 0,
        advantage: false,
        disadvantage: false,
      };
    });

    // Starting resource/value grants — level-1 SRD rule for HP (max die,
    // not the average-growth formula Level Up uses for every level after
    // this one), generalized to loop over EVERY class-kind "resourceGrowth"
    // binding (not just the first) since a System can declare more than
    // one — Daggerheart's own Evasion is exactly this same shape (a flat
    // class-record number written straight onto its own combatBindings
    // entry, no ability modifier), not a HP-specific mechanism. Reads off
    // `buildSystemDefinition` directly (NOT getLevelUpBindings()/
    // getCombatBindings(), which read whatever System happens to be open
    // in state.systemDefinition right now — not necessarily the one being
    // built, per this function's own buildSystemDefinition fetch above).
    const buildFields = Array.isArray(buildSystemDefinition?.fields) ? buildSystemDefinition.fields : [];
    const growthBindings = (buildFields.find((entry) => entry?.key === "levelUpBindings")?.values || []).filter(
      (entry) => entry?.role === "resourceGrowth" && entry?.kind === "class"
    );
    const buildCombatBindings = findRoleBoundField(buildFields)?.values;
    growthBindings.forEach((growthBinding) => {
      const resourceBinding = findBindingByRole(buildCombatBindings, growthBinding.resourceRole);
      if (!growthBinding.path || !resourceBinding) return;
      const baseValue = Number(classRecord[growthBinding.path]) || 0;
      if (!baseValue) {
        console.warn(`Character editor: class "${classRecord.name}" has no ${growthBinding.path} — starting ${resourceBinding.name} will be understated.`);
      }
      let total = baseValue;
      if (growthBinding.abilityBinding) {
        const score = resolveBinding(growthBinding.abilityBinding, draft);
        total += evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "abilityModifier", { score }) || 0;
      }
      const maxPathSegs = resolveBindingPath(resourceBinding.maxPath);
      const currentPathSegs = resolveBindingPath(resourceBinding.binding);
      if (maxPathSegs) setValueAtContext(draft, maxPathSegs, total);
      // `startFull` (declared on the resourceGrowth entry itself, default
      // true) — a "count down from max" resource (D&D's HP: you start at
      // full and take damage down toward 0) seeds current = max same as
      // before; a "count up from empty" one (Daggerheart's HP: unmarked
      // boxes fill in as you take damage, 0 marked = full health) must NOT
      // — writing current here would make a fresh character start already
      // half the way to death. Only meaningful when there's a real
      // current/max split (a flat "value"-role binding like Evasion has no
      // maxPathSegs at all, so it always falls through and seeds current
      // regardless, which is correct for it either way).
      if (currentPathSegs && (growthBinding.startFull !== false || !maxPathSegs)) {
        setValueAtContext(draft, currentPathSegs, total);
      }
    });

    // Saving Throws — same shape as stats.skills[], sourced from the
    // wizard's own ability defs rather than the System's separate "saves"
    // field (whose labels are full sentences like "Strength Saving Throw",
    // not display-ready). Class grants a fixed 2-save proficiency via
    // whatever field the System's own "savingThrowGrants" levelUpBindings
    // role names (never a literal "saving_throws") — a hard grant, not a
    // choice. Only built when the System actually declares a "saves"
    // field at all (D&D 5e) — a System with no such concept (Call of
    // Cthulhu, Blades in the Dark, Daggerheart) has nothing to bind
    // these entries to.
    const hasSavesField = (Array.isArray(buildSystemDefinition?.fields) ? buildSystemDefinition.fields : []).some((entry) => entry?.key === "saves");
    if (hasSavesField) {
      const buildLevelUpBindings = (Array.isArray(buildSystemDefinition?.fields) ? buildSystemDefinition.fields : []).find(
        (entry) => entry?.key === "levelUpBindings"
      )?.values;
      const savingThrowGrantsPath = findLevelUpBinding(buildLevelUpBindings, "savingThrowGrants", "class")?.path;
      const classSaveIndexes = new Set(
        (savingThrowGrantsPath && Array.isArray(classRecord?.[savingThrowGrantsPath]) ? classRecord[savingThrowGrantsPath] : []).map((entry) =>
          String(entry?.index || "").toLowerCase()
        )
      );
      draft.stats.savingThrows = buildWizardState.abilityDefs.map((def, index) => {
        const isProficient = classSaveIndexes.has(String(def.label || "").toLowerCase());
        const modifier = evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "abilityModifier", { score: abilities[def.key] ?? 10 }) || 0;
        return {
          id: index + 1,
          name: def.key,
          friendlyName: def.key.charAt(0).toUpperCase() + def.key.slice(1),
          shortName: def.label || def.key.slice(0, 3).toUpperCase(),
          value: modifier + (isProficient ? Number(draft.stats.proficiencyBonus) || 0 : 0),
          proficiency: isProficient ? 2 : 0,
          advantage: false,
          disadvantage: false,
        };
      });
    }

    // Initiative and Armor Class — resolved via the SAME combatBindings
    // role lookup Combat Tracker/character-sheet.js already use (role
    // "modifier"/"value"), never a hardcoded field path. Both entries only
    // resolve a default when the System's own binding carries an
    // `abilityBinding` (author-configurable, not assumed) — Armor Class
    // also adds its own `base` (10 for a System using the standard 5e
    // "unarmored" default) before equipment ever raises it.
    const initiativeBinding = findBindingByRole(buildCombatBindings, "modifier");
    if (initiativeBinding?.abilityBinding) {
      const initiativePathSegs = resolveBindingPath(initiativeBinding.binding);
      if (initiativePathSegs) {
        const score = resolveBinding(initiativeBinding.abilityBinding, draft);
        setValueAtContext(draft, initiativePathSegs, evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "abilityModifier", { score }) || 0);
      }
    }
    // role:"value" is ambiguous when a System declares more than one such
    // binding (Daggerheart: Evasion AND Armor Score) — findBindingByRole
    // always resolves the first, which for Daggerheart is Evasion.
    // Guarding on `base` being a real number scopes this to an
    // ability-modified "X + base" stat (D&D's AC); Daggerheart's Armor
    // Score is instead seeded by its Armor equipment choice's statBindings.
    const armorClassBinding = findBindingByRole(buildCombatBindings, "value");
    if (armorClassBinding && typeof armorClassBinding.base === "number") {
      const acPathSegs = resolveBindingPath(armorClassBinding.binding);
      if (acPathSegs) {
        const acAbilityMod = armorClassBinding.abilityBinding
          ? evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "abilityModifier", { score: resolveBinding(armorClassBinding.abilityBinding, draft) }) || 0
          : 0;
        setValueAtContext(draft, acPathSegs, armorClassBinding.base + acAbilityMod);
      }
    }

    // Every Species carries at least a walk speed; other movement types
    // stay 0 until a Feature grants them (no auto-applied Feature effects).
    if (speciesRecord) {
      draft.stats.speed = {
        walk: Number(speciesRecord.speed) || 0,
        burrow: 0,
        climb: 0,
        fly: 0,
        swim: 0,
      };
    }

    // Feature grants — species (every featureId, no level gate), class
    // (level-1 matched), subclass (level-1 matched, only when the wizard's
    // own conditional Subclass step actually ran), background's own
    // already-linked origin feat.
    const classFeatures = Array.isArray(classRecord.features) ? classRecord.features : [];
    const classFeatureIds = Array.isArray(classRecord.featureIds) ? classRecord.featureIds : [];
    // Mixed Ancestry: the top (first-listed) ancestry feature from the
    // primary species, the bottom (second-listed) from the second, rather
    // than either species' full featureIds list.
    const speciesFeatureIds = secondSpeciesRecord
      ? [speciesRecord?.featureIds?.[0], secondSpeciesRecord.featureIds?.[1]].filter(Boolean)
      : Array.isArray(speciesRecord?.featureIds) ? speciesRecord.featureIds : [];
    const subclassFeatureIds = Array.isArray(subclassRecord?.featureIds) ? subclassRecord.featureIds : [];
    const allCandidateIds = [
      ...new Set([
        ...classFeatureIds,
        ...speciesFeatureIds,
        ...subclassFeatureIds,
        ...(backgroundRecord?.feat?.refId ? [backgroundRecord.feat.refId] : []),
      ]),
    ];
    const featureEntries = allCandidateIds.length ? await fetchKindEntriesWithIds(dataManager, "feature") : [];
    const featureEntityById = new Map(featureEntries.map((entry) => [entry.id, entry.entity]));
    const featureNameById = new Map(featureEntries.map((entry) => [entry.id, (entry.entity?.name || "").trim().toLowerCase()]));
    const speciesFeaturesAsClassShape = speciesFeatureIds.map((fid) => ({
      name: featureEntityById.get(fid)?.name || "",
      level: null,
    }));
    const grantedFromSpecies = matchFeaturesAtLevel(speciesFeaturesAsClassShape, speciesFeatureIds, featureNameById, null, []);
    // targetLevel:null (grant every entry) when the class's own features[]
    // has no `level` field on any entry — Daggerheart's classes have no
    // per-level table at all, and matchFeaturesAtLevel's exact match
    // (`Number(entry.level) !== 1`) would otherwise discard all of them
    // since `Number(undefined)` is NaN. A level-tagged System (D&D) is
    // unaffected.
    const classFeaturesAreLevelTagged = classFeatures.some((entry) => Number.isFinite(Number(entry?.level)));
    // A listPick step already resolving one pick from the class's feature
    // list into @featureIds (BitD's Special Ability: "choose 1 of 8") must
    // not also get this blanket auto-grant — mutually exclusive
    // resolutions of the same field. Detected generically: a listPick
    // step sourcing "class" field "features"/"featureIds" targeting
    // "@featureIds".
    const classFeaturesHandledByListPick = getDeclaredBuildSteps(buildSystemDefinition).some((entry) => {
      if (entry?.type !== "listPick") return false;
      const sources = Array.isArray(entry.source) ? entry.source : [entry.source];
      const sourcesClassFeatures = sources.some((src) => src?.from === "class" && (src?.field === "features" || src?.field === "featureIds"));
      return sourcesClassFeatures && (entry.targetPath === "@featureIds" || entry.targetArrayPath === "@featureIds");
    });
    const grantedFromClass = classFeaturesHandledByListPick
      ? []
      : matchFeaturesAtLevel(classFeatures, classFeatureIds, featureNameById, classFeaturesAreLevelTagged ? 1 : null, grantedFromSpecies);
    // Same class of gap as classFeatures above, but Daggerheart's subclass
    // features carry tier ("Foundation:"/"Specialization:"/"Mastery:") as
    // a name prefix (no numeric per-level table exists), not a `level`
    // field. Scoped to the Build wizard, not the shared
    // matchFeaturesAtLevel, since this prefix convention is local to how
    // this repo's Daggerheart content was imported. At creation only
    // Foundation is granted — the rest come via subclassUpgrade.
    const subclassIsTierPrefixed = Array.isArray(subclassRecord?.features) && subclassRecord.features.some((entry) => /^(Foundation|Specialization|Mastery):/.test(entry?.name || ""));
    let grantedFromSubclass = [];
    if (subclassRecord && subclassIsTierPrefixed) {
      const foundationIndexes = subclassRecord.features
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => /^Foundation:/.test(entry?.name || ""));
      const foundationFeatures = foundationIndexes.map(({ entry }) => ({ name: entry.name, level: null }));
      const foundationFeatureIds = foundationIndexes.map(({ index }) => subclassRecord.featureIds[index]);
      grantedFromSubclass = matchFeaturesAtLevel(foundationFeatures, foundationFeatureIds, featureNameById, null, [...grantedFromSpecies, ...grantedFromClass]);
    } else if (subclassRecord) {
      grantedFromSubclass = grantSubclassFeaturesAtLevel(subclassRecord, 1, featureNameById, [...grantedFromSpecies, ...grantedFromClass]);
    }
    const grantedFeatureIds = [...grantedFromSpecies, ...grantedFromClass, ...grantedFromSubclass];
    if (backgroundRecord?.feat?.refKind === "feature" && backgroundRecord.feat.refId) {
      grantedFeatureIds.push(backgroundRecord.feat.refId);
    }
    grantedFeatureIds.forEach((fid) => {
      if (!draft.featureIds.includes(fid)) draft.featureIds.push(fid);
    });

    // Full multiclass spell-slot math even at creation (a single-class
    // character is the degenerate case), reusing Level Up's merge function.
    await refreshCharacterSpellSlots(draft);

    // Background's flat, hard-granted proficiencies — field name from the
    // System's "proficiencyGrants" levelUpBindings role, never a literal.
    const proficiencyGrantsPath = findLevelUpBinding(getLevelUpBindings(), "proficiencyGrants", "background")?.path;
    const grantedProficiencies = proficiencyGrantsPath && Array.isArray(backgroundRecord?.[proficiencyGrantsPath]) ? backgroundRecord[proficiencyGrantsPath] : [];
    grantedProficiencies.forEach((entry) => {
      applyProficiencyGrant(entry?.name, draft);
    });
    // Recomputes every now-proficient skill's `value` to include the
    // proficiency bonus just granted (expertise doubles it) — otherwise a
    // skill Background just made proficient shows a stale value.
    draft.stats.skills.forEach((skill) => {
      if (skill.proficiency >= 2) {
        const abilityDef = buildWizardState.abilityDefs.find((def) => def.label === skill.ability);
        const score = abilityDef ? abilities[abilityDef.key] : undefined;
        const abilityMod = evaluateDerivedFormula(systemFieldValues(buildSystemDefinition, "derivedFormulas"), "abilityModifier", { score: score ?? 10 }) || 0;
        skill.value = abilityMod + draft.stats.proficiencyBonus * (skill.proficiency === 3 ? 2 : 1);
      }
    });

    // Pending choices.
    const pendingChoices = [];
    const pushChoice = (source, resolved, targetPath) => {
      resolved.forEach((entry, index) => {
        pendingChoices.push({
          id: `${source.id}-create-${index}-${Date.now()}`,
          sourceKind: source.kind,
          sourceId: source.id,
          sourceName: source.name,
          type: entry.type || targetPath || "",
          desc: entry.desc,
          choose: entry.choose,
          options: entry.options,
        });
      });
    };
    // Field names come from the System's levelUpBindings roles, never a
    // literal. Daggerheart declares none of these roles, so every lookup
    // below returns null and this block no-ops for it — the same
    // graceful degradation as any other optional System field.
    const classProficiencyPath = findLevelUpBinding(getLevelUpBindings(), "proficiencyChoices", "class")?.path;
    const backgroundProficiencyPath = findLevelUpBinding(getLevelUpBindings(), "proficiencyChoices", "background")?.path;
    const classEquipmentPath = findLevelUpBinding(getLevelUpBindings(), "equipmentChoices", "class")?.path;
    const backgroundEquipmentPath = findLevelUpBinding(getLevelUpBindings(), "equipmentChoices", "background")?.path;
    if (classProficiencyPath) {
      pushChoice(
        { kind: "class", id: buildWizardState.classId, name: classRecord.name || "Class" },
        resolveChoiceList(classRecord[classProficiencyPath]).filter((entry) => entry.options.length),
        "proficiencies"
      );
    }
    if (backgroundRecord) {
      if (backgroundProficiencyPath) {
        pushChoice(
          { kind: "background", id: buildWizardState.backgroundId, name: backgroundRecord.name || "Background" },
          resolveChoiceList(backgroundRecord[backgroundProficiencyPath]).filter((entry) => entry.options.length),
          "proficiencies"
        );
      }
      const classEquipment = classEquipmentPath ? resolveEquipmentChoice((classRecord[classEquipmentPath] || [])[0]) : null;
      if (classEquipment) {
        pushChoice({ kind: "class", id: buildWizardState.classId, name: classRecord.name || "Class" }, [{ ...classEquipment, type: "equipmentChoice" }], "inventory");
      }
      const backgroundEquipment = backgroundEquipmentPath ? resolveEquipmentChoice((backgroundRecord[backgroundEquipmentPath] || [])[0]) : null;
      if (backgroundEquipment) {
        pushChoice(
          { kind: "background", id: buildWizardState.backgroundId, name: backgroundRecord.name || "Background" },
          [{ ...backgroundEquipment, type: "equipmentChoice" }],
          "inventory"
        );
      }
      // Background's ability-score bonus (2024 rules: +2/+1 or +1/+1/+1
      // among 3 candidates), synthesized directly rather than through
      // resolveGrantChoices, since `ability_scores` is a flat list, not a
      // {choose, from} shape.
      const candidates = Array.isArray(backgroundRecord.ability_scores) ? backgroundRecord.ability_scores : [];
      if (candidates.length) {
        const abilityByShortName = new Map(
          buildWizardState.abilityDefs.filter((def) => def.shortName).map((def) => [def.shortName.toUpperCase(), def])
        );
        const options = candidates
          .map((entry) => abilityByShortName.get((entry?.name || "").toUpperCase()))
          .filter(Boolean)
          .map((def) => ({ id: def.key, name: def.label }));
        if (options.length) {
          pendingChoices.push({
            id: `background-ability-bonus-${Date.now()}`,
            sourceKind: "background",
            sourceId: buildWizardState.backgroundId,
            sourceName: backgroundRecord.name || "Background",
            type: "abilityScoreBonus",
            desc: "Choose your background ability score bonus.",
            choose: 1,
            options,
          });
        }
      }
    }
    grantedFeatureIds.forEach((featureId) => {
      const featureRecord = featureEntityById.get(featureId);
      if (!featureRecord || !Array.isArray(featureRecord.grants) || !featureRecord.grants.length) {
        return;
      }
      pushChoice({ kind: "feature", id: featureId, name: featureRecord.name || featureId }, resolveGrantChoices(featureRecord.grants, draft), "");
    });

    // Creation-time equipment picks — generic, not D&D's per-class
    // equipmentChoices levelUpBindings role (Daggerheart's own choices are
    // fixed, System-wide tables with no per-class variation). Declared on
    // the "choices" buildSteps entry's own `equipmentChoices`, absent for
    // every System until this feature, so purely additive. Resolved via
    // the generic "fieldChoice" pendingChoice type (write the pick's name
    // to a field path) rather than equipmentChoice's 5e-API-shaped bundle.
    const choicesStepEntry = getBuildStepEntry("choices", buildSystemDefinition);
    const creationEquipmentChoices = Array.isArray(choicesStepEntry?.equipmentChoices) ? choicesStepEntry.equipmentChoices : [];
    creationEquipmentChoices.forEach((entry) => {
      const sourceValues = systemFieldValues(buildSystemDefinition, entry.sourceField);
      // Keeps every field the source entry carries, not just id/name —
      // statBindings reads them back off the resolved pick's `raw` to
      // compute things like Armor Score from whatever fields the
      // System's own entry declares, never a hardcoded field name.
      const options = sourceValues.map((value) => ({ ...value, id: value.name, name: value.name }));
      if (!options.length) return;
      pendingChoices.push({
        id: `creation-equipment-${entry.sourceField}-${Date.now()}`,
        sourceKind: "system",
        sourceId: entry.sourceField,
        sourceName: entry.name || entry.sourceField,
        type: "fieldChoice",
        desc: entry.desc || `Choose your ${entry.name || entry.sourceField}.`,
        choose: Number(entry.choose) || 1,
        options,
        targetPath: entry.targetPath,
        statBindings: Array.isArray(entry.statBindings) ? entry.statBindings : [],
        // Whether the System's entry declared itself skippable
        // (Daggerheart's Secondary Weapon: "Skip if your Primary Weapon
        // is Two-Handed") — the System's explicit say-so, never guessed.
        optional: Boolean(entry.optional),
      });
    });

    // Creation-time domain cards — reuses the same fetch/resolve pipeline
    // as the Advancement-Menu Level Up engine, for however many the
    // "choices" step declares (Daggerheart: 2) rather than the 1 a
    // level-up grants. Absent (0) for a System that doesn't declare it.
    const startingDomainCardCount = Number(choicesStepEntry?.startingDomainCards) || 0;
    if (startingDomainCardCount > 0) {
      const domainCardOptions = await fetchDomainCardOptions(classRecord, 1);
      if (domainCardOptions.length) {
        pendingChoices.push({
          id: `creation-domain-cards-${Date.now()}`,
          sourceKind: "class",
          sourceId: buildWizardState.classId,
          sourceName: classRecord.name || "Class",
          type: "domainCardAccess",
          desc: `Choose ${startingDomainCardCount} domain card(s) at level 1 from your class's own domains.`,
          choose: startingDomainCardCount,
          options: domainCardOptions,
        });
      }
    }
    draft.pendingChoices = pendingChoices;

    // Generic "input" step resolution — writes each typed value to
    // targetArrayPath/itemKey, merging itemDefaults onto the pushed
    // object (Daggerheart: 2 Experience names, each +2). Not specific to
    // Experiences — any future "input" step resolves through this same code.
    const inputStepEntry = getBuildStepEntry("input", buildSystemDefinition);
    if (inputStepEntry && Array.isArray(inputStepEntry.inputs)) {
      // `targetPaths[]` (parallel to `inputs[]`): each value writes
      // directly to its own scalar field (BitD's Alias/Look/Vice
      // Purveyor — independent fields, not array items). Alternative to
      // `targetArrayPath` (Daggerheart's Experiences, collected into one
      // array) — never both on the same step.
      if (Array.isArray(inputStepEntry.targetPaths)) {
        inputStepEntry.inputs.forEach((def, index) => {
          const typedValue = (buildWizardState.inputValues[index] || "").trim();
          const path = inputStepEntry.targetPaths[index];
          if (!typedValue || !path) return;
          const segs = resolveBindingPath(path);
          if (segs) {
            setValueAtContext(draft, segs, typedValue);
          }
        });
      } else if (inputStepEntry.targetArrayPath) {
        const targetSegs = resolveBindingPath(inputStepEntry.targetArrayPath);
        if (targetSegs) {
          const existing = getValueAtContext(draft, targetSegs);
          const targetArray = Array.isArray(existing) ? existing : [];
          const itemDefaults = inputStepEntry.itemDefaults && typeof inputStepEntry.itemDefaults === "object" ? inputStepEntry.itemDefaults : {};
          inputStepEntry.inputs.forEach((def, index) => {
            const typedValue = (buildWizardState.inputValues[index] || "").trim();
            if (!typedValue) return;
            targetArray.push({ ...itemDefaults, [inputStepEntry.itemKey || "value"]: typedValue });
          });
          setValueAtContext(draft, targetSegs, targetArray);
        }
      }
    }

    // Generic "pointAllocation" step resolution — every declared step
    // (BitD's Actions; CoC's Occupation Skills AND Personal Interest, two
    // independent budgets both spending on "skills") adds its
    // contribution to each item's binding path rather than overwriting
    // it — otherwise a skill scoped by both steps has the second step's
    // write erase the first's. Two passes: (1) each distinct target
    // field's leaves get `basePercentage` seeded exactly once regardless
    // of how many steps share that field; (2) each step's class-`prefill`
    // plus whatever the player placed is added on top.
    const pointAllocationSteps = getDeclaredBuildSteps(buildSystemDefinition).filter((entry) => entry?.type === "pointAllocation");
    const seededTargetPaths = new Set();
    pointAllocationSteps.forEach((entry) => {
      if (!entry?.targetPath || seededTargetPaths.has(entry.targetPath)) return;
      seededTargetPaths.add(entry.targetPath);
      getPointAllocationGroups({ targetPath: entry.targetPath }, buildSystemDefinition).forEach((group) => {
        group.items.forEach((item) => {
          if (!item.basePercentage) return;
          const segs = resolveBindingPath(`@${item.key}`);
          if (segs) setValueAtContext(draft, segs, item.basePercentage);
        });
      });
    });
    pointAllocationSteps.forEach((entry) => {
      const allocations = buildWizardState.pointAllocations[entry.step] || {};
      getPointAllocationGroups(entry, buildSystemDefinition).forEach((group) => {
        group.items.forEach((item) => {
          // Base already seeded above, once, for the whole field — only
          // this step's class-prefill and placed points get added here.
          const classPrefillOnly = resolvePointAllocationPrefill(entry, { ...item, basePercentage: 0 });
          const addition = classPrefillOnly + (Number(allocations[item.shortKey]) || 0);
          if (!addition) return;
          const segs = resolveBindingPath(`@${item.key}`);
          if (!segs) return;
          const existing = Number(getValueAtContext(draft, segs)) || 0;
          setValueAtContext(draft, segs, existing + addition);
        });
      });
    });

    // Generic "listPick" step resolution — every declared listPick step
    // resolves through this same code, keyed by whichever step ids the
    // System's buildSteps declares. Same targetPath/targetArrayPath/
    // itemKey/itemDefaults convention as the "input" step above.
    getDeclaredBuildSteps(buildSystemDefinition)
      .filter((entry) => entry?.type === "listPick")
      .forEach((entry) => {
        const picks = Array.isArray(entry.picks) && entry.picks.length ? entry.picks : [{}];
        const selections = buildWizardState.listPicks[entry.step] || {};
        const pickedValues = picks
          .map((pickDef, slotIndex) => ({ pickDef, selection: selections[slotIndex] }))
          .filter(({ selection }) => selection);
        if (!pickedValues.length) return;
        if (entry.targetArrayPath) {
          const targetSegs = resolveBindingPath(entry.targetArrayPath);
          if (!targetSegs) return;
          const existing = getValueAtContext(draft, targetSegs);
          const targetArray = Array.isArray(existing) ? existing : [];
          pickedValues.forEach(({ pickDef, selection }) => {
            // `label`, not `raw?.name`, is the fallback once `id` is
            // absent — for a name+descriptor source it's already the
            // combined "Marlane, a pugilist" text (resolveListPickSource);
            // raw.name alone would drop the descriptor.
            const rawValue = selection.id ?? selection.label ?? selection.raw?.name;
            if (entry.itemKey) {
              targetArray.push({ ...(entry.itemDefaults || {}), ...(pickDef?.itemDefaults || {}), [entry.itemKey]: rawValue });
            } else {
              targetArray.push(rawValue);
            }
          });
          setValueAtContext(draft, targetSegs, targetArray);
        } else if (entry.targetPath) {
          const targetSegs = resolveBindingPath(entry.targetPath);
          const rawValue = pickedValues[0].selection.id ?? pickedValues[0].selection.label ?? pickedValues[0].selection.raw?.name;
          if (targetSegs) {
            setValueAtContext(draft, targetSegs, rawValue);
          }
        }
      });

    // A class record's `startingUpgrades` (fixed, no player choice —
    // BitD's Crew Type auto-grants 2) reuses whichever listPick step
    // already resolves a picked upgrade from the same `typeUpgrades`
    // list, so the target shape stays data-driven, not a hardcoded path.
    if (Array.isArray(classRecord.startingUpgrades) && classRecord.startingUpgrades.length) {
      const upgradesStepEntry = getDeclaredBuildSteps(buildSystemDefinition).find((entry) => {
        if (entry?.type !== "listPick" || !entry.targetArrayPath) return false;
        const sources = Array.isArray(entry.source) ? entry.source : [entry.source];
        return sources.some((src) => src?.from === "class" && src?.field === "typeUpgrades");
      });
      if (upgradesStepEntry) {
        const targetSegs = resolveBindingPath(upgradesStepEntry.targetArrayPath);
        if (targetSegs) {
          const existing = getValueAtContext(draft, targetSegs);
          const targetArray = Array.isArray(existing) ? existing : [];
          classRecord.startingUpgrades.forEach((name) => {
            targetArray.push(
              upgradesStepEntry.itemKey ? { ...(upgradesStepEntry.itemDefaults || {}), [upgradesStepEntry.itemKey]: name } : name
            );
          });
          setValueAtContext(draft, targetSegs, targetArray);
        }
      }
    }

    state.character = cloneCharacter(draft);
    state.draft = cloneCharacter(draft);
    state.characterOrigin = "local";
    // A freshly created character (Blank/Import/Build — never Duplicate,
    // which keeps whatever mode you were already in) always drops the
    // player into Edit. Routed through onRequestEditMode
    // (workbench.js's setSubView("edit")) rather than a direct
    // `state.mode = "edit"` assignment, which left workbench.js's own
    // subView tracking (the real source of truth for the toggle/Delete
    // visibility) desynced until the next manual toggle click.
    if (onRequestEditMode) {
      onRequestEditMode();
    } else {
      state.mode = "edit";
    }
    const user = sessionUser();
    registerCharacterRecord({
      id,
      title: name,
      template: templateId,
      source: "local",
      ownership: user ? "owned" : "local",
      ownerId: user?.id ?? null,
      ownerUsername: user?.username ?? "",
      ownerTier: user?.tier ?? "",
    });
    if (elements.characterSelect) {
      elements.characterSelect.value = id;
    }
    await persistDraft({ silent: false });
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    void refreshRelationshipsSection();
    syncCharacterActions();
    if (pendingChoices.length) {
      expandCharacterPropertiesSection();
    }
    state.shareToken = "";
    clearGameLogContext();
    // No "Created X" toast here — the wizard isn't done from the user's
    // view (at least the "choices" step remains). The real success toast
    // fires once they click Finish there.
    return pendingChoices;
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

  // Clones the current character into a new record — same "fresh id,
  // register, persist silently" tail as startNewCharacter below, except
  // the source is the current draft's own data instead of a blank shape.
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
    draft.name = duplicateName;
    draft.title = duplicateName;
    if (draft.data && typeof draft.data === "object") {
      draft.data = { ...draft.data, name: duplicateName };
    }
    if (draft.identity && typeof draft.identity === "object") {
      draft.identity = { ...draft.identity, name: duplicateName };
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
    // systemIds (the same array every Library kind uses for "Assigned
    // Systems" in Loom) replaces the old singular `system` field; a fresh
    // character starts with just the Template's own schema, in array form.
    const initialSchema = state.template?.schema || templateMetadata?.schema || "";
    const draft = {
      id: trimmedId,
      name: trimmedName,
      title: trimmedName,
      template: trimmedTemplate,
      systemIds: initialSchema ? [initialSchema] : [],
      data: { name: trimmedName },
      state: { timers: {}, log: [] },
      identity: { name: trimmedName },
    };
    state.character = cloneCharacter(draft);
    state.draft = cloneCharacter(draft);
    state.characterOrigin = "local";
    // A freshly created character (Blank/Import/Build — never Duplicate,
    // which keeps whatever mode you were already in) always drops the
    // player into Edit. Routed through onRequestEditMode
    // (workbench.js's setSubView("edit")) rather than a direct
    // `state.mode = "edit"` assignment, which left workbench.js's own
    // subView tracking (the real source of truth for the toggle/Delete
    // visibility) desynced until the next manual toggle click.
    if (onRequestEditMode) {
      onRequestEditMode();
    } else {
      state.mode = "edit";
    }
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
  // Combines Loom's mapping/fetch engine (reimportViaMapping) with this
  // file's "New Character" draft-building pattern, so a player can import
  // their own character without Loom access. The mapping picker only
  // offers mappings a GM tagged "Character" ($dataType), never sub-entity
  // ones (backgrounds/classes/species).
  //
  // Two-stage modal: Stage 1 picks a mapping + fetches a URL/id; Stage 2
  // confirms id/name/Template once Fetch succeeds. No window.prompt
  // fallback — a fetch-then-confirm flow needs the Bootstrap modal.
  let pendingImport = null;

  // No Data Source control here — only Loom can set a mapping's $source —
  // so this just derives the URL/ID field's placeholder/label from the
  // chosen mapping's own $source.
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
      // $dataType: "character" mappings, but a mistagged one shouldn't
      // silently save garbage.
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
      // Create Character stays disabled until Stage 2's Template select
      // has a value. No "Fetched X" text — the revealed Name field
      // already shows the same information.
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
      // Auto-generated id collided with one created after Fetch ran (e.g.
      // another tab) — regenerate rather than asking the player to fix an
      // id they never see.
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
    // mergeImportedCharacterData(mappedData, null) — the same function
    // Loom's saveEntity uses for a first-time save: every prior.* key
    // resolves to undefined and drops out, leaving {...mappedData}.
    // id/template/systemIds/mapping/url/data are spread after, so they
    // always win over anything mappedData carries under those keys.
    const merged = mergeImportedCharacterData(mappedData, null);
    const draft = {
      ...merged,
      id: trimmedId,
      name: trimmedName,
      title: trimmedName,
      template: trimmedTemplate,
      systemIds: initialSchema ? [initialSchema] : [],
      mapping: mappingId,
      url: sourceValue,
      data: { name: trimmedName },
      state: { timers: {}, log: [] },
      identity: { ...(merged?.identity || {}), name: trimmedName },
    };
    state.character = cloneCharacter(draft);
    state.draft = cloneCharacter(draft);
    state.characterOrigin = "local";
    // A freshly created character (Blank/Import/Build — never Duplicate,
    // which keeps whatever mode you were already in) always drops the
    // player into Edit. Routed through onRequestEditMode
    // (workbench.js's setSubView("edit")) rather than a direct
    // `state.mode = "edit"` assignment, which left workbench.js's own
    // subView tracking (the real source of truth for the toggle/Delete
    // visibility) desynced until the next manual toggle click.
    if (onRequestEditMode) {
      onRequestEditMode();
    } else {
      state.mode = "edit";
    }
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
    // silent: false — one of persistDraft's documented deliberate saves,
    // not an autosave; silent:true here meant a brand-new imported
    // character's feats/features never got promoted to real Library
    // Features on its first save (see reimportCurrentCharacter above).
    await persistDraft({ silent: false });
    syncNotesEditor();
    renderCanvas();
    renderPreview();
    void refreshRelationshipsSection();
    syncCharacterActions();
    state.shareToken = "";
    clearGameLogContext();
    // url/mapping are already set on the saved character, so the existing
    // Re-import button works on it immediately with no further wiring.
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
    // The campaign didn't go away just because this character did — fall
    // back to Party Data view rather than a fully blank screen. Only a
    // characterless AND campaignless session resets everything.
    if (gameLogContext.groupId) {
      // loadGroupPartyView deliberately never touches state.mode, so
      // set it here to land back in view mode, same as the blank branch.
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

  // Top-level keys mergeImportedCharacterData always preserves verbatim —
  // diffing them would only report "no change" by construction, so
  // they're excluded from the confirmation summary.
  const REIMPORT_PRESERVED_KEYS = ["id", "template", "systemIds", "data", "url", "mapping"];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // Short, human-readable stand-in for a value in the confirmation list —
  // never the raw value, which for a nested object would be unreadable
  // JSON. Arrays/objects report their own size (e.g. "3 items → 4 items").
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

  // Flat list of {path, before, after} for every leaf value that differs
  // between two character payloads — recurses into plain objects (dotted
  // path, e.g. "identity.level"), but treats an array or shape mismatch
  // as one leaf via formatReimportValue, not exploded index-by-index.
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

  // The confirm modal's body — capped at a handful of lines (a full DDB
  // re-import can touch 30+ fields) so the dialog stays readable; the
  // total count still tells the whole story. Values are imported/
  // untrusted, so every piece goes through escapeHtml before this innerHTML.
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

  // Re-runs what Loom's saveEntity would do (fetch `url` through
  // `mapping`, merge via mergeImportedCharacterData), but stops for a
  // confirm() whose body is the diff computed above, not a generic "are
  // you sure?". Never touches state.draft/state.character, or saves,
  // until after confirmation — canceling or any failure leaves the editor
  // showing exactly what it did before the click.
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
      // Same automatic Feature promotion persistDraft's own explicit-Save
      // path already does — confirmed real, separate bug this fixes: Re-
      // import saves via dataManager.save directly, never going through
      // persistDraft at all, so a re-imported character's feats/features
      // never became real Library references no matter how many times Re-
      // import was clicked. Always runs here (no `!silent` gate) — unlike
      // persistDraft's own autosave-vs-explicit-Save distinction, Re-import
      // IS always an explicit, deliberate action.
      await linkCharacterSpeciesClassReferences(dataManager, merged);
      await linkCharacterSpellReferences(dataManager, merged);
      // Confirmed real gap this fixes: Re-import never called this at all,
      // so a re-imported character's inventory items never got a
      // refKind/refId stamp, no matter how many times Re-import was clicked.
      await linkCharacterInventoryReferences(dataManager, merged);
      if (hasEmbeddedFeatures(merged, "feats") || hasEmbeddedFeatures(merged, "features")) {
        try {
          const existingFeatures = await fetchKindEntriesWithIds(dataManager, "feature").then(
            (entries) => entries.map((entry) => ({ id: entry.id, ...entry.entity })),
            () => []
          );
          for (const sourceField of ["feats", "features"]) {
            // See loom/js/app.js's own identical fix for why this is
            // needed here too — a Character's own "features" list merges
            // in racial traits (Size, Speed, Creature Type, ...), the same
            // property-shaped entries Species promotion already excludes.
            await promoteEmbeddedFeatures(merged, {
              sourceField,
              category: "character",
              dataManager,
              existingFeatures,
              excludeSpeciesPropertyTraits: true,
            });
          }
        } catch (error) {
          console.warn("Character editor: unable to promote feats/features to Library Features", error);
        }
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
    // A record's id is filename/library_items metadata, not editable
    // content — never persisted in the body. Deleted from this clone
    // only; state.draft.id stays populated for every other in-memory read.
    delete payload.id;
    // Same automatic-on-save Feature promotion Loom's saveEntity does,
    // since persistDraft bypasses saveEntity entirely. Gated on `!silent`
    // — persistDraft fires on nearly every field edit (autosave), and a
    // real Library fetch on every keystroke would be wasteful; `!silent`
    // is the explicit Save click and the few other genuinely deliberate
    // saves. Reference linking now does a real fetch too, so it moved
    // into this same gate rather than running on every autosave.
    // Idempotent regardless — a later no-op autosave is always safe.
    if (!silent) {
      await linkCharacterSpeciesClassReferences(dataManager, payload);
      await linkCharacterSpellReferences(dataManager, payload);
      await linkCharacterInventoryReferences(dataManager, payload);
    }
    if (!silent && (hasEmbeddedFeatures(payload, "feats") || hasEmbeddedFeatures(payload, "features"))) {
      try {
        const existingFeatures = await fetchKindEntriesWithIds(dataManager, "feature").then(
          (entries) => entries.map((entry) => ({ id: entry.id, ...entry.entity })),
          () => []
        );
        for (const sourceField of ["feats", "features"]) {
          // A Character's "features" list merges in racial traits (Size,
          // Speed, Creature Type), the same property-shaped entries
          // Species promotion already excludes.
          await promoteEmbeddedFeatures(payload, {
            sourceField,
            category: "character",
            dataManager,
            existingFeatures,
            excludeSpeciesPropertyTraits: true,
          });
        }
      } catch (error) {
        console.warn("Character editor: unable to promote feats/features to Library Features", error);
      }
    }
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
    // Party Data mode keys Notes by campaign instead of the generic
    // "session" bucket, so different campaigns' Party Data don't collide.
    // Checks state.partyMode, not just groupContext's presence.
    const id = state.draft?.id || (state.partyMode && state.groupContext ? `party:${state.groupContext.groupId}` : "session");
    return `undercroft.workbench.character.notes.${id}`;
  }

  // --- Relationships -----------------------------------------------------
  //
  // The active character's target-kind whitelist and type-suggestion
  // vocabulary for the shared relationship-editor.js/relationship-graph.js
  // modules. Reputation tracking lands here: `type: "Reputation with"`,
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
    // No character loaded (Party Data mode) — clear rather than leave a
    // stale prior character's relationships on screen.
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

  // Called whenever the active character changes — not on every
  // renderPreview() (dozens of call sites re-rendering the same
  // in-progress character), which would re-fetch far more than needed.
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

  // Picking a different campaign from the header dropdown while Workbench
  // is already open should immediately follow it — the dropdown is
  // syncGameLogContext's sole source of truth for the signed-in case.
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
    // visibility (Delete Character) on every tab click, not just edit/play.
    refreshToolbar: syncCharacterActions,
    // Read by renderEmptyState — shows only while Mode=Character and no
    // character is loaded. Party Data is the other way "Sheet" can be
    // active with state.draft = {}, so draftHasId alone would leave the
    // empty-state stuck even after a Party Template finished loading.
    hasActiveCharacter: () => Boolean(state.draft?.id) || (state.partyMode && Boolean(state.template)),
    // Read by workbench.js's setMode to auto-load whichever template this
    // character is built on when switching to Template mode.
    getActiveTemplateId: () => state.draft?.template || null,
  };
}
