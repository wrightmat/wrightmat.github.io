import { initAppShell } from "../../../common/js/lib/app-shell.js";
import { DataManager } from "../../../common/js/lib/data-manager.js";
import { initAuthControls } from "../../../common/js/lib/auth-ui.js";
import { initTierVisibility } from "../../../common/js/lib/access.js";
import { initHelpSystem } from "../../../common/js/lib/help.js";
import { resolveApiBase } from "../../../common/js/lib/api.js";
import { refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { initTemplateView } from "./workbench-template-view.js";
import { initCharacterView } from "./workbench-character-view.js";
import { createIconButton } from "../../../common/js/lib/ui-components.js";

// Orchestrator for Workbench's single unified page (replacing the old
// separate template.html/character.html/index.html). Owns everything that
// used to be duplicated per-page: the one initAppShell call (status/undo
// stack), DataManager, auth, help system, tier gating, and the Template/Play/
// Edit view switcher. The actual Template Builder and Character Sheet logic
// lives in workbench-template-view.js/workbench-character-view.js — each
// relocated near-verbatim from the old per-page scripts and now exposed as
// initTemplateView/initCharacterView, returning a small hook object this
// file uses for undo dispatch and dirty-state checks. Deliberately does NOT
// try to unify the two views' internal rendering/dirty-tracking machinery —
// only the page shell (nav, panes, toolbars, undo, tier gating) is shared.
const VIEWS = ["template", "play", "edit"];

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
  // holds buttons three different files each query by their own data-action
  // selector (Undo/Redo here, Export/Clear in the Template view below,
  // New/Save/Export/Delete Character in the Character view below) — creating
  // them all in the one place that runs before any of those three consumers
  // keeps every existing selector/disabled-state call site working
  // unchanged, without needing cross-file mount-order coordination. Using
  // createIconButton directly (not createToolbarButtonGroup) since these
  // don't cleanly map to that helper's New/Save/Export/Delete preset
  // vocabulary — several reuse the same action name for different entities
  // (two different "Export JSON" buttons) or use a tool-specific icon
  // (tabler:download instead of the "export" preset's tabler:file-export,
  // tabler:eraser for Clear canvas). `visible` mirrors each button's
  // original starting class exactly (present `d-none` -> visible: false),
  // per-view show/hide after that point is still entirely driven by the
  // existing [data-workbench-view-panel] mechanism in setWorkbenchView.
  const workbenchToolbarButtons = [
    { icon: "tabler:arrow-back-up", label: "Undo", attrs: { "data-action": "undo" } },
    { icon: "tabler:arrow-forward-up", label: "Redo", attrs: { "data-action": "redo" } },
    {
      icon: "tabler:download",
      label: "Export JSON",
      visible: false,
      attrs: { "data-action": "export-template", "data-workbench-view-panel": "template" },
    },
    {
      icon: "tabler:eraser",
      label: "Clear canvas",
      variant: "outline-danger",
      visible: false,
      attrs: { "data-action": "clear-canvas", "data-workbench-view-panel": "template" },
    },
    {
      icon: "tabler:file-plus",
      label: "New Character",
      variant: "outline-primary",
      attrs: { "data-action": "new-character", "data-workbench-view-panel": "edit" },
    },
    {
      icon: "tabler:device-floppy",
      label: "Save",
      variant: "outline-success",
      visible: false,
      attrs: { "data-action": "save-character", "data-workbench-view-panel": "edit" },
    },
    {
      icon: "tabler:download",
      label: "Export JSON",
      attrs: { "data-action": "export-character", "data-workbench-view-panel": "play edit" },
    },
    {
      icon: "tabler:trash",
      label: "Delete Character",
      variant: "outline-danger",
      visible: false,
      attrs: { "data-action": "delete-character", "data-delete-character": true },
    },
  ];
  const workbenchToolbarMount = document.querySelector("[data-workbench-toolbar-mount]");
  workbenchToolbarButtons.forEach(({ visible = true, variant = "outline-secondary", ...config }) => {
    const button = createIconButton({ ...config, variant, kind: "toolbar" });
    button.classList.toggle("d-none", !visible);
    workbenchToolbarMount?.appendChild(button);
  });

  const undoButton = document.querySelector('[data-action="undo"]');
  const redoButton = document.querySelector('[data-action="redo"]');
  if (undoButton) undoButton.addEventListener("click", () => undo());
  if (redoButton) redoButton.addEventListener("click", () => redo());

  templateView = await initTemplateView({ status, undoStack, dataManager });
  characterView = await initCharacterView({ status, undoStack, dataManager });

  const viewTabsContainer = document.querySelector("[data-workbench-view-tabs]");
  // The left-most tab a given session can actually use — Template (gm+ only,
  // otherwise merely disabled/grayed rather than removed — see index.html's
  // own data-requires-tier on that tab) is the true left-most tab in the DOM
  // (Template, Edit, Play, in that order), but only gm+ can act on it; for
  // everyone else the left-most one they can actually open is Edit.
  const defaultView = () => (dataManager.meetsTier("gm") ? "template" : "edit");
  let currentView = defaultView();

  function setWorkbenchView(view) {
    if (!VIEWS.includes(view)) {
      return;
    }
    if (view === "template" && !dataManager.meetsTier("gm")) {
      // Denied clicks on the tab button itself are normally stopped before
      // this ever runs, by initTierVisibility's own capture-phase listener
      // on the same data-requires-tier="gm" attribute (see index.html) —
      // this check is only a safety net for programmatic callers (the
      // ?view=/?record= deep-link bootstrap below, or a future auth-change
      // re-check) that don't go through a real click event.
      return;
    }
    currentView = view;
    // Read by workbench-character-view.js's Now Showing panel — that
    // section's own visibility depends on both "is there an active
    // spotlight" AND "is the current view Play/Edit", two independent
    // conditions computed in two different modules; this is the one shared
    // signal between them (see setNowShowingVisible's own comment).
    document.body.dataset.workbenchView = view;
    document.querySelectorAll("[data-workbench-view-panel]").forEach((element) => {
      const panels = (element.dataset.workbenchViewPanel || "").split(/\s+/);
      element.classList.toggle("d-none", !panels.includes(view));
    });
    if (viewTabsContainer) {
      viewTabsContainer.querySelectorAll("[data-workbench-view-tab]").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.workbenchViewTab === view);
      });
    }
    if (characterView) {
      if (view === "edit") void characterView.setMode("edit");
      else if (view === "play") void characterView.setMode("view");
      // Switching to any OTHER view (Template, Systems, ...) hits neither
      // branch above, so setMode() — and the toolbar re-check it does
      // internally — never runs at all. Confirmed real bug: Delete
      // Character, shown while on the Edit tab, stayed visible after
      // clicking over to Template, since nothing ever re-evaluated it.
      // Cheap and idempotent to call again even when setMode already just
      // did (the edit/play cases above), so no need to gate this on view.
      else characterView.refreshToolbar();
    }
    refreshTooltips(document);
  }

  if (viewTabsContainer) {
    viewTabsContainer.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-workbench-view-tab]");
      if (!tab) return;
      setWorkbenchView(tab.dataset.workbenchViewTab);
    });
  }

  window.addEventListener("undercroft:auth-changed", () => {
    if (currentView === "template" && !dataManager.meetsTier("gm")) {
      setWorkbenchView(defaultView());
    }
  });

  // A save in the Template tab used to leave the Play/Edit tab silently
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
  // share links) pick the initial view; each view module already loads the
  // actual record from that same query string on its own
  // (resolveSharedRecordParam/parseRecordParam) — this only decides which
  // tab is showing when it does. ?view=template|play|edit is a lighter-
  // weight alternative for plain "just open this tab" links (e.g. Admin's
  // own Quick Links) with no specific record to load.
  let initialView = defaultView();
  try {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam && VIEWS.includes(viewParam)) {
      initialView = viewParam;
    } else {
      const [bucket] = (params.get("record") || "").split(":");
      if (bucket === "templates") initialView = "template";
    }
  } catch (error) {
    console.warn("Workbench: unable to parse deep-link query", error);
  }
  if (initialView === "template" && !dataManager.meetsTier("gm")) {
    initialView = defaultView();
  }
  setWorkbenchView(initialView);
}

init();
