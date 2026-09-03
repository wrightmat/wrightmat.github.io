import { initAppShell } from "../../../common/js/lib/app-shell.js";
import { DataManager } from "../../../common/js/lib/data-manager.js";
import { initAuthControls } from "../../../common/js/lib/auth-ui.js";
import { initTierVisibility } from "../../../common/js/lib/access.js";
import { initHelpSystem } from "../../../common/js/lib/help.js";
import { resolveApiBase } from "../../../common/js/lib/api.js";
import { disposeTooltips, refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { initTemplateView } from "./workbench-template-view.js";
import { initCharacterView } from "./workbench-character-view.js";
import {
  createIconButton,
  createModeToggleGroup,
  createCycleToggleButton,
  createCollapsibleSection,
  createEmptyStateCard,
} from "../../../common/js/lib/ui-components.js";

// Orchestrator for Workbench's single unified page. Owns what would
// otherwise be duplicated per-page: initAppShell (status/undo stack),
// DataManager, auth, help system, tier gating, and the Template/Character
// Mode+View switcher. Template Builder and Character Sheet logic live in
// workbench-template-view.js/workbench-character-view.js, exposed as
// initTemplateView/initCharacterView returning a small hook object this
// file uses for undo dispatch and dirty-state checks — their internal
// rendering/dirty-tracking machinery stays unmixed; only the page shell
// (nav, panes, toolbars, undo, tier gating) is shared.
//
// Mode ("template"/"character") plus a View toggle ("view"/"edit", only
// rendered while Mode = Character) mirrors every other tool's own Mode+View
// header. "View" replaces the old "Play" label — workbench-character-view.js's
// state.mode already used "view"/"edit" internally.
const MODES = ["character", "template"];

async function init() {
  let templateView = null;
  let characterView = null;

  const shell = initAppShell({
    namespace: "workbench",
    storagePrefix: "undercroft.workbench.undo",
    leftPaneLabel: "Toggle left pane",
    rightPaneLabel: "Toggle right pane",
    rightPane: { size: "lg", initial: "expanded" },
    // Routed by each undo entry's own `type` — template.js's structural
    // canvas entries vs. character.js's "binding" value-diff entries — the
    // same type-tagged-single-stack convention Loom's app.js uses to share
    // one stack across multiple independent editors.
    onUndo: (entry) => {
      const view = entry?.type === "binding" ? characterView : templateView;
      return view ? view.applyUndoEntry(entry) : { applied: false };
    },
    onRedo: (entry) => {
      const view = entry?.type === "binding" ? characterView : templateView;
      return view ? view.applyRedoEntry(entry) : { applied: false };
    },
  });

  const { status, undoStack, undo, redo } = shell;
  // Uses DataManager's shared "undercroft" storage prefix (not a
  // Workbench-specific one) — the bucket names (characters, templates)
  // already disambiguate content, and a second prefix layer only
  // fragmented suite-search.js's cross-tool local lookup.
  const dataManager = new DataManager({ baseUrl: resolveApiBase() });
  const auth = initAuthControls({ root: document, status, dataManager });
  initTierVisibility({ root: document, dataManager, status, auth });
  initHelpSystem({ root: document });

  // Built here (not in the two view files) since both query these by their
  // own data-action selector — one mount point avoids cross-file mount-order
  // coordination. createIconButton directly, not createToolbarButtonGroup,
  // since each action name is duplicated once per mode (two "New" buttons,
  // two "Save" buttons). `visible` mirrors each button's starting class
  // (`d-none` -> false); ongoing show/hide is driven by
  // [data-workbench-mode-panel]/[data-workbench-subview-panel] in
  // applyPanelVisibility.
  //
  // DOM order is [Template's 4] -> [Character's 4] — since only one mode's
  // 4 are ever visible, the visible sequence always reads New -> Save ->
  // Duplicate -> Delete. Undo/Redo (mode-agnostic, always visible) get
  // their own array — workbenchUndoRedoButtons below.
  const workbenchToolbarButtons = [
    { icon: "tabler:file-plus", label: "New Template", variant: "outline-primary", attrs: { "data-action": "new-template", "data-workbench-mode-panel": "template" } },
    {
      icon: "tabler:device-floppy",
      label: "Save Template",
      variant: "outline-success",
      visible: false,
      attrs: { "data-action": "save-template", "data-workbench-mode-panel": "template" },
    },
    {
      icon: "tabler:copy",
      label: "Duplicate Template",
      variant: "outline-success",
      visible: false,
      attrs: { "data-action": "duplicate-template", "data-duplicate-template": true, "data-workbench-mode-panel": "template" },
    },
    {
      icon: "tabler:trash",
      label: "Delete Template",
      variant: "outline-danger",
      visible: false,
      attrs: { "data-delete-template": true, "data-workbench-mode-panel": "template" },
    },
    {
      icon: "tabler:file-plus",
      label: "New Character",
      variant: "outline-primary",
      // Mode-gated but deliberately NOT data-workbench-subview-panel="edit"
      // — own JS-managed visibility instead (syncNewCharacterButtonVisibility
      // below), same precedent as Delete Character. The generic Edit-only
      // gate works for Save/Duplicate (nothing to act on without an already-
      // loaded character), but starting a FIRST character isn't "editing an
      // existing one" — the View/Edit toggle itself only appears once a
      // character is already active, so subView could never reach "edit" to
      // reveal this button on a fresh install with zero characters.
      attrs: { "data-action": "new-character", "data-workbench-mode-panel": "character" },
    },
    {
      icon: "tabler:device-floppy",
      label: "Save",
      variant: "outline-success",
      visible: false,
      attrs: { "data-action": "save-character", "data-workbench-mode-panel": "character", "data-workbench-subview-panel": "edit" },
    },
    {
      icon: "tabler:copy",
      label: "Duplicate Character",
      variant: "outline-success",
      visible: false,
      attrs: { "data-action": "duplicate-character", "data-workbench-mode-panel": "character", "data-workbench-subview-panel": "edit" },
    },
    {
      // Delete Character's visibility is fully JS-managed
      // (syncCharacterActions' showDelete), not the generic mode-panel
      // toggle, since it also depends on ownership/dirty state.
      icon: "tabler:trash",
      label: "Delete Character",
      variant: "outline-danger",
      visible: false,
      attrs: { "data-action": "delete-character", "data-delete-character": true },
    },
  ];
  // Undo/Redo get their own small two-button group (a visual break, not a
  // functional one) rather than joining the main cluster — same convention
  // every other tool's toolbar uses.
  const workbenchUndoRedoButtons = [
    { icon: "tabler:arrow-back-up", label: "Undo", attrs: { "data-action": "undo" } },
    { icon: "tabler:arrow-forward-up", label: "Redo", attrs: { "data-action": "redo" } },
  ];
  const workbenchToolbarMount = document.querySelector("[data-workbench-toolbar-mount]");
  workbenchToolbarButtons.forEach(({ visible = true, variant = "outline-secondary", ...config }) => {
    const button = createIconButton({ ...config, variant, kind: "toolbar" });
    button.classList.toggle("d-none", !visible);
    workbenchToolbarMount?.appendChild(button);
  });
  const workbenchUndoToolbarMount = document.querySelector("[data-workbench-undo-toolbar-mount]");
  workbenchUndoRedoButtons.forEach(({ visible = true, variant = "outline-secondary", ...config }) => {
    const button = createIconButton({ ...config, variant, kind: "toolbar" });
    button.classList.toggle("d-none", !visible);
    workbenchUndoToolbarMount?.appendChild(button);
  });

  const undoButton = document.querySelector('[data-action="undo"]');
  const redoButton = document.querySelector('[data-action="redo"]');
  if (undoButton) undoButton.addEventListener("click", () => undo());
  if (redoButton) redoButton.addEventListener("click", () => redo());

  const modeToggleMount = document.querySelector("[data-workbench-mode-toggle-mount]");
  const viewToggleMount = document.querySelector("[data-workbench-view-toggle-mount]");
  const emptyStateMount = document.querySelector("[data-workbench-empty-state-mount]");
  // Character is the default for every session regardless of tier — where
  // players spend most of their time, unlike Template (gm+ only, disabled
  // rather than removed for everyone else). A function, not a constant,
  // since it's also the fallback setMode uses when a session loses gm+
  // tier while on Template (auth-changed listener below).
  const defaultMode = () => "character";
  // Declared before the two view modules are constructed — their own
  // onStateChange callback (renderEmptyState) reads `mode`, and Template's
  // init can synchronously trigger that callback before this returns.
  let mode = defaultMode();
  let subView = "view"; // "view" | "edit" — only meaningful in character mode

  const canvasCard = document.querySelector("[data-workbench-canvas-card]");
  const sheetCard = document.querySelector("[data-workbench-sheet-card]");

  // The header's flush-left empty-state message, shown only while the
  // active mode's record isn't active yet — same treatment every other
  // tool's header uses. Also owns the Canvas/Sheet cards' visibility (fully
  // removed, not just an empty canvas), computed independently per mode so
  // switching modes never leaves a stale card showing. templateView/
  // characterView are read via closures so this stays correct regardless
  // of which one's onStateChange fired most recently.
  function renderEmptyState() {
    const hasTemplate = Boolean(templateView?.hasActiveTemplate?.());
    const hasCharacter = Boolean(characterView?.hasActiveCharacter?.());
    canvasCard?.classList.toggle("d-none", !hasTemplate);
    sheetCard?.classList.toggle("d-none", !hasCharacter);
    // renderViewToggle depends on this same hasCharacter signal — cheapest
    // way to keep it correct on load/unload without a second wire-up.
    renderViewToggle();
    syncNewCharacterButtonVisibility();
    if (!emptyStateMount) return;
    const hasRecord = mode === "template" ? hasTemplate : hasCharacter;
    emptyStateMount.innerHTML = "";
    if (hasRecord) return;
    const message =
      mode === "template"
        ? "Select a template from the list, or create a new one."
        : "Select a character from the list, or create a new one.";
    emptyStateMount.appendChild(createEmptyStateCard({ message, variant: "inline" }));
  }

  templateView = await initTemplateView({ status, undoStack, dataManager, onStateChange: renderEmptyState });
  characterView = await initCharacterView({
    status,
    undoStack,
    dataManager,
    onStateChange: renderEmptyState,
    // Called right after Blank/Import/Build creates a new character —
    // routes through the SAME setSubView the toggle itself uses (not a
    // direct state.mode write), so subView (this file's source of truth
    // for the toggle and Delete-button visibility) never drifts out of
    // sync with workbench-character-view.js's own state.mode.
    onRequestEditMode: () => setSubView("edit"),
  });

  // The Template/Character select for the active Mode — inner rows are
  // gated by data-workbench-mode-panel like every other mode-specific
  // section. Expanded by default, matching every other tool's left-pane
  // Selections section.
  const selectionsSection = createCollapsibleSection({
    label: "Selections",
    collapsed: false,
    content: document.querySelector("[data-selections-panel]"),
  });
  document.querySelector("[data-selections-mount]")?.appendChild(selectionsSection.section);

  function renderModeToggle() {
    if (!modeToggleMount) return;
    // Template requires gm+ tier. This toggle rebuilds fresh on every call,
    // so the suite-wide initTierVisibility mechanism (which snapshots
    // [data-requires-tier] elements once at init) can't reach it —
    // createModeToggleGroup's own disabled/tooltip option support is the
    // real equivalent, same mechanism every Relationships-option gate uses.
    const isGm = dataManager.meetsTier("gm");
    createModeToggleGroup({
      container: modeToggleMount,
      ariaLabel: "Workbench mode",
      options: [
        { value: "character", icon: "tabler:user", label: "Character" },
        {
          value: "template",
          icon: "tabler:layout",
          label: "Template",
          disabled: !isGm,
          tooltip: isGm ? undefined : "Requires GM tier or higher",
        },
      ],
      value: mode,
      onChange: (next) => setMode(next),
    });
  }

  // New Character's own visibility (see its attrs comment above for why
  // it's not the generic subview gate): visible in Character mode when
  // either subView is Edit, or there's no active character yet — the
  // second clause is what makes starting a character from a completely
  // empty Workbench possible.
  function syncNewCharacterButtonVisibility() {
    const button = document.querySelector('[data-action="new-character"]');
    if (!button) return;
    const show = mode === "character" && (subView === "edit" || !characterView?.hasActiveCharacter?.());
    button.classList.toggle("d-none", !show);
  }

  function renderViewToggle() {
    if (!viewToggleMount) return;
    // Meaningless with no character loaded — same hasActiveCharacter()
    // check renderEmptyState's own Sheet-card visibility already uses.
    if (mode !== "character" || !characterView?.hasActiveCharacter?.()) {
      disposeTooltips(viewToggleMount);
      viewToggleMount.innerHTML = "";
      return;
    }
    createCycleToggleButton({
      container: viewToggleMount,
      states: [
        { value: "view", icon: "tabler:eye", label: "View" },
        { value: "edit", icon: "tabler:pencil", label: "Edit" },
      ],
      value: subView,
      onSelect: (next) => setSubView(next),
    });
  }

  // Two independent attributes: data-workbench-mode-panel gates on Mode;
  // data-workbench-subview-panel additionally gates on View/Edit, for the
  // handful of elements (New Character/Save) that only make sense in Edit,
  // unlike Notes/Relationships/Dice/Game Log/Sheet which show for both.
  function applyPanelVisibility() {
    document.querySelectorAll("[data-workbench-mode-panel]").forEach((element) => {
      const panels = (element.dataset.workbenchModePanel || "").split(/\s+/);
      element.classList.toggle("d-none", !panels.includes(mode));
    });
    document.querySelectorAll("[data-workbench-subview-panel]").forEach((element) => {
      const panels = (element.dataset.workbenchSubviewPanel || "").split(/\s+/);
      element.classList.toggle("d-none", !(mode === "character" && panels.includes(subView)));
    });
    renderEmptyState();
  }

  function setMode(nextMode) {
    if (!MODES.includes(nextMode)) return;
    if (nextMode === "template" && !dataManager.meetsTier("gm")) return;
    mode = nextMode;
    // Read by workbench-character-view.js's Now Showing panel, whose
    // visibility depends on both "active spotlight" and "mode = Character"
    // — this is the shared signal between the two modules.
    document.body.dataset.workbenchMode = mode;
    applyPanelVisibility();
    renderModeToggle();
    renderViewToggle();
    syncNewCharacterButtonVisibility();
    if (characterView) {
      if (mode === "character") void characterView.setMode(subView);
      else {
        // Switching to Template needs its own explicit refresh — without
        // this, Delete Character (shown while editing) stayed visible after
        // switching modes, since nothing re-evaluated it. Idempotent, so
        // safe to call even when setMode already just did.
        characterView.refreshToolbar();
        // Auto-load whichever template the current character is built on —
        // selectTemplateById no-ops if it's already active.
        if (templateView && characterView.hasActiveCharacter()) {
          const templateId = characterView.getActiveTemplateId();
          if (templateId) void templateView.selectTemplateById(templateId);
        }
      }
    }
    refreshTooltips(document);
  }

  function setSubView(nextView) {
    if (nextView !== "view" && nextView !== "edit") return;
    subView = nextView;
    applyPanelVisibility();
    renderViewToggle();
    syncNewCharacterButtonVisibility();
    if (characterView) void characterView.setMode(subView);
    refreshTooltips(document);
  }

  window.addEventListener("undercroft:auth-changed", () => {
    if (mode === "template" && !dataManager.meetsTier("gm")) {
      setMode(defaultMode());
    } else {
      // No mode change needed, but Template's disabled state may be stale.
      renderModeToggle();
    }
  });

  // characterView loads its own copy of a template once and never
  // re-fetches it — without this, a Template-tab save left Character view
  // silently rendering a stale copy until a full reload.
  // reloadTemplateIfActive is a no-op unless the open character uses it.
  window.addEventListener("workbench:template-saved", (event) => {
    void characterView?.reloadTemplateIfActive?.(event.detail?.templateId);
  });

  window.addEventListener("beforeunload", (event) => {
    const dirty = Boolean(templateView?.hasUnsavedChanges?.()) || Boolean(characterView?.hasUnsavedChanges?.());
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // ?record=<bucket>:<id>&share=<token> deep links pick the initial mode;
  // each view module loads the actual record itself
  // (resolveSharedRecordParam/parseRecordParam). ?view=template|play|edit
  // is a lighter alternative with no specific record, mapping the legacy
  // three values onto the Mode+View split.
  let initialMode = defaultMode();
  let initialSubView = "view";
  try {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam === "template") {
      initialMode = "template";
    } else if (viewParam === "edit") {
      initialMode = "character";
      initialSubView = "edit";
    } else if (viewParam === "play") {
      initialMode = "character";
      initialSubView = "view";
    } else {
      const [bucket] = (params.get("record") || "").split(":");
      if (bucket === "templates") initialMode = "template";
    }
  } catch (error) {
    console.warn("Workbench: unable to parse deep-link query", error);
  }
  if (initialMode === "template" && !dataManager.meetsTier("gm")) {
    initialMode = defaultMode();
  }
  subView = initialSubView;
  setMode(initialMode);
}

init();
