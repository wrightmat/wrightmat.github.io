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

// Orchestrator for Workbench's single unified page (replacing the old
// separate template.html/character.html/index.html). Owns everything that
// used to be duplicated per-page: the one initAppShell call (status/undo
// stack), DataManager, auth, help system, tier gating, and the Template/
// Character Mode+View switcher. The actual Template Builder and Character
// Sheet logic lives in workbench-template-view.js/workbench-character-view.js
// — each relocated near-verbatim from the old per-page scripts and now
// exposed as initTemplateView/initCharacterView, returning a small hook
// object this file uses for undo dispatch and dirty-state checks.
// Deliberately does NOT try to unify the two views' internal rendering/
// dirty-tracking machinery — only the page shell (nav, panes, toolbars,
// undo, tier gating) is shared.
//
// Mode ("template"/"character", createModeToggleGroup) replaces the old
// flat 3-tab Template/Edit/Play nav — Edit and Play were never actually
// independent top-level destinations, just two ways of looking at the same
// Character content, so they collapse into a single View toggle
// ("view"/"edit", createCycleToggleButton) that only renders while
// Mode = Character, exactly mirroring Repository/Forge/Crucible/Sanctum/
// Vault's own Mode+View header. "View" replaces the old "Play" label; the
// underlying mechanism is unchanged — workbench-character-view.js's own
// state.mode already used exactly "view"/"edit" internally, so only the
// outer terminology/UI changed here, not the state machine.
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
    // Routed purely by each undo entry's own `type` — template.js's
    // structural canvas entries ("add"/"move"/"reorder"/"remove"/"clear")
    // vs. character.js's "binding" value-diff entries — the same
    // type-tagged-single-stack convention Loom's app.js established for
    // sharing one stack across multiple independent editors.
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
  const dataManager = new DataManager({ baseUrl: resolveApiBase(), storagePrefix: "undercroft.workbench" });
  const auth = initAuthControls({ root: document, status, dataManager });
  initTierVisibility({ root: document, dataManager, status, auth });
  initHelpSystem({ root: document });

  // Built and mounted here (not in workbench-template-view.js/
  // workbench-character-view.js individually) because this one btn-group
  // holds buttons both other files query by their own data-action selector
  // (New/Save/Duplicate/Delete Template in the Template view, New/Save/
  // Duplicate/Delete Character in the Character view) — creating them all in
  // the one place that runs before either of those two consumers keeps every
  // existing selector/disabled-state call site working unchanged, without
  // needing cross-file mount-order coordination. Using createIconButton
  // directly (not createToolbarButtonGroup) since these don't cleanly map to
  // that helper's preset vocabulary — every action name is duplicated once
  // for Template and once for Character (two different "New" buttons, two
  // different "Save" buttons, ...). `visible` mirrors each button's original
  // starting class exactly (present `d-none` -> visible: false); per-mode/
  // sub-view show/hide after that point is still entirely driven by the
  // [data-workbench-mode-panel]/[data-workbench-subview-panel] mechanism in
  // applyPanelVisibility.
  //
  // DOM order here is [Template's own 4] -> [Character's own 4] — since only
  // one mode's own 4 are ever visible at once (the other 4 sit d-none), the
  // VISIBLE sequence in either mode reads correctly as New -> Save ->
  // Duplicate -> Delete without needing separate physical button sets per
  // mode. Undo/Redo (mode-agnostic, always visible) are a separate array,
  // built into their own little two-button group right after — see
  // workbenchUndoRedoButtons below.
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
      // Edit-only (not the whole Character mode) — a standalone attribute
      // beyond data-workbench-mode-panel, since Character mode alone can't
      // distinguish the View/Edit sub-state; see applyPanelVisibility below.
      attrs: { "data-action": "new-character", "data-workbench-mode-panel": "character", "data-workbench-subview-panel": "edit" },
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
      // Delete Character's own visibility is fully JS-managed
      // (syncCharacterActions' own showDelete) rather than the generic
      // mode-panel toggle, since it also depends on ownership/dirty state
      // the generic mechanism can't express — no data-workbench-mode-panel
      // attr here, same as before this pass.
      icon: "tabler:trash",
      label: "Delete Character",
      variant: "outline-danger",
      visible: false,
      attrs: { "data-action": "delete-character", "data-delete-character": true },
    },
  ];
  // Undo/Redo get their own little two-button group (a small `ms-2` gap
  // before it in the static markup) rather than joining the main cluster's
  // btn-group — a small visual break, not a functional one, same convention
  // every other tool's toolbar now uses (see forge/js/app.js's own comment).
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
  // Character is the default for every session regardless of tier — it's
  // where players spend most of their time, unlike Template (gm+ only,
  // merely disabled/grayed for everyone else rather than removed — see
  // renderModeToggle). Still a function, not a bare constant, since it's
  // also the fallback setMode falls back to if a session loses gm+ tier
  // while on Template (auth-changed listener below).
  const defaultMode = () => "character";
  // Declared before the two view modules are constructed below — their own
  // onStateChange callback (renderEmptyState) reads `mode`, and Template's
  // own init can synchronously trigger that callback (a freshly-created
  // draft template) before this function returns.
  let mode = defaultMode();
  let subView = "view"; // "view" | "edit" — only meaningful while mode === "character"; matches workbench-character-view.js's own state.mode default

  const canvasCard = document.querySelector("[data-workbench-canvas-card]");
  const sheetCard = document.querySelector("[data-workbench-sheet-card]");

  // The Mode/View header's own flush-left empty-state message — "Select a
  // template/character from the list, or create a new one." — shown only
  // while the active mode's own record isn't active yet, same inline/
  // card-free treatment Repository/Forge/Crucible/Sanctum/Vault's own
  // header uses. Also owns the Canvas/Sheet cards' own visibility — both
  // stay removed entirely (not just an empty canvas) until their own record
  // is active, computed independently of the currently active Mode so
  // switching modes never leaves a stale card showing. templateView/
  // characterView are read via closures (not params) so this stays correct
  // regardless of which one's onStateChange fired most recently.
  function renderEmptyState() {
    const hasTemplate = Boolean(templateView?.hasActiveTemplate?.());
    const hasCharacter = Boolean(characterView?.hasActiveCharacter?.());
    canvasCard?.classList.toggle("d-none", !hasTemplate);
    sheetCard?.classList.toggle("d-none", !hasCharacter);
    // The View/Edit toggle depends on this exact same hasCharacter signal
    // (see renderViewToggle's own gate) — both templateView and
    // characterView already funnel every state change through this one
    // function, so re-running it here (a no-op while mode !== "character")
    // is the cheapest way to keep the toggle correct on load/unload without
    // a second onStateChange wire-up.
    renderViewToggle();
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
  characterView = await initCharacterView({ status, undoStack, dataManager, onStateChange: renderEmptyState });

  // Selections — the Template/Character select, whichever the active Mode
  // needs (the panel's own inner rows are individually gated by data-
  // workbench-mode-panel, same mechanism as every other mode-specific
  // section) — built once both view modules have mounted their own select
  // fields into the shared panel. Expanded by default, matching every other
  // tool's own left-pane Selections section.
  const selectionsSection = createCollapsibleSection({
    label: "Selections",
    collapsed: false,
    content: document.querySelector("[data-selections-panel]"),
  });
  document.querySelector("[data-selections-mount]")?.appendChild(selectionsSection.section);

  function renderModeToggle() {
    if (!modeToggleMount) return;
    // Template requires gm+ tier — this toggle rebuilds fresh on every
    // call, so the suite-wide initTierVisibility mechanism (which
    // snapshots [data-requires-tier] elements once at init) can never
    // reach it; createButtonCheckGroup's own disabled/tooltip option
    // support (ui-components.js) is the real equivalent instead of a
    // manual post-render querySelector patch — same mechanism every
    // tool's own Relationships-option gate now uses too.
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

  function renderViewToggle() {
    if (!viewToggleMount) return;
    // Meaningless with no character loaded yet (there's nothing to view or
    // edit) — confirmed real: it stayed visible the instant Character mode
    // was entered, before ever selecting/creating a character, same gap
    // renderEmptyState's own Sheet-card visibility already accounts for via
    // this exact hasActiveCharacter() check.
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

  // Two independent attributes, since Character mode alone can't tell
  // apart the handful of elements (New Character/Save) that only make
  // sense in the Edit sub-view, not the whole of Character mode (matching
  // Notes/Relationships/Dice/Game Log/Sheet, which show for View AND Edit
  // alike) — data-workbench-mode-panel gates on Mode, data-workbench-
  // subview-panel additionally gates on the View/Edit sub-state.
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
    // Read by workbench-character-view.js's Now Showing panel — that
    // section's own visibility depends on both "is there an active
    // spotlight" AND "is the current mode Character", two independent
    // conditions computed in two different modules; this is the one shared
    // signal between them (see updateNowShowingVisibility's own comment).
    document.body.dataset.workbenchMode = mode;
    applyPanelVisibility();
    renderModeToggle();
    renderViewToggle();
    if (characterView) {
      if (mode === "character") void characterView.setMode(subView);
      else {
        // Switching to Template hits neither branch, so setMode() — and the
        // toolbar re-check it does internally — never runs at all. Confirmed
        // real bug (pre-Mode/View redesign): Delete Character, shown while
        // editing, stayed visible after switching to Template, since nothing
        // ever re-evaluated it. Cheap and idempotent to call again even when
        // setMode already just did, so no need to gate this on mode.
        characterView.refreshToolbar();
        // Auto-load whichever template the currently-loaded character is
        // actually built on — selectTemplateById is already a no-op if
        // that's already the active template (same guard its own <select>'s
        // change handler relies on), so this is safe on every switch into
        // Template mode, not just the first one after selecting a character.
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
    if (characterView) void characterView.setMode(subView);
    refreshTooltips(document);
  }

  window.addEventListener("undercroft:auth-changed", () => {
    if (mode === "template" && !dataManager.meetsTier("gm")) {
      setMode(defaultMode());
    } else {
      // No mode change needed, but the Template option's disabled state
      // (see renderModeToggle) may still be stale after a tier change.
      renderModeToggle();
    }
  });

  // A save in the Template tab used to leave the Character view silently
  // rendering a stale copy of that same template until a full page
  // reload — characterView loads its own copy once, when a character is
  // loaded, and otherwise never re-fetches it. reloadTemplateIfActive is a
  // no-op unless the currently-open character actually uses the template
  // that was just saved.
  window.addEventListener("workbench:template-saved", (event) => {
    void characterView?.reloadTemplateIfActive?.(event.detail?.templateId);
  });

  window.addEventListener("beforeunload", (event) => {
    const dirty = Boolean(templateView?.hasUnsavedChanges?.()) || Boolean(characterView?.hasUnsavedChanges?.());
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // ?record=<bucket>:<id>&share=<token> deep links (used by the Admin tool's
  // share links) pick the initial mode; each view module already loads the
  // actual record from that same query string on its own
  // (resolveSharedRecordParam/parseRecordParam) — this only decides which
  // mode is showing when it does. ?view=template|play|edit is a lighter-
  // weight alternative for plain "just open this" links (e.g. Admin's own
  // Quick Links) with no specific record to load — the legacy three values
  // still map onto the new Mode+View split (template -> Template mode;
  // edit/play -> Character mode, with the sub-view set accordingly).
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
