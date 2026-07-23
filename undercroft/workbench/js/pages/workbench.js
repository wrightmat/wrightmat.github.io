import { initAppShell } from "../../../common/js/lib/app-shell.js";
import { DataManager } from "../../../common/js/lib/data-manager.js";
import { initAuthControls } from "../../../common/js/lib/auth-ui.js";
import { initTierVisibility } from "../../../common/js/lib/access.js";
import { initHelpSystem } from "../../../common/js/lib/help.js";
import { resolveApiBase } from "../../../common/js/lib/api.js";
import { refreshTooltips } from "../../../common/js/lib/tooltips.js";
import { initTemplateView } from "./workbench-template-view.js";
import { initCharacterView } from "./workbench-character-view.js";

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

  const undoButton = document.querySelector('[data-action="undo"]');
  const redoButton = document.querySelector('[data-action="redo"]');
  if (undoButton) undoButton.addEventListener("click", () => undo());
  if (redoButton) redoButton.addEventListener("click", () => redo());

  templateView = await initTemplateView({ status, undoStack, dataManager });
  characterView = await initCharacterView({ status, undoStack, dataManager });

  const viewTabsContainer = document.querySelector("[data-workbench-view-tabs]");
  let currentView = "play";

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
      setWorkbenchView("play");
    }
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
  let initialView = "play";
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
    initialView = "play";
  }
  setWorkbenchView(initialView);
}

init();
