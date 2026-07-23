import { initThemeControls } from "./theme.js";
import { initPaneToggles } from "./panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";

// `icon` is an Iconify `tabler:*` id — same convention used everywhere else
// across every tool page (`<span class="iconify" data-icon="tabler:...">`).
// `built` distinguishes real, navigable tools from ones that only exist as
// a name/spec so far — kept explicit here rather than inferred from
// whether resolveToolHref happens to return a real path, so adding a new
// tool to the roadmap doesn't silently produce a dead link.
const TOOL_DEFINITIONS = [
  {
    id: "workbench",
    label: "Workbench",
    icon: "tabler:layout-dashboard",
    summary: "Character Sheet, Template, and System Editor.",
    built: true,
  },
  {
    id: "press",
    label: "Press",
    icon: "tabler:printer",
    summary: "Printing utility for sheets, cards, and booklets.",
    built: true,
  },
  {
    id: "orrery",
    label: "Orrery",
    icon: "tabler:map-2",
    summary: "Map creator and viewer.",
    built: true,
  },
  {
    id: "loom",
    label: "Loom",
    icon: "tabler:cloud-download",
    summary: "Fetches and normalizes external content.",
    built: true,
  },
  {
    id: "forge",
    label: "Forge",
    icon: "tabler:hammer",
    summary: "Rolls NPCs with Identity and 4D traits.",
    built: true,
  },
  {
    id: "admin",
    label: "Admin",
    icon: "tabler:shield-cog",
    summary: "Account tiers, ownership, sharing, and groups.",
    built: true,
  },
  {
    id: "crucible",
    label: "Crucible",
    icon: "tabler:flask",
    summary: "Generates monster concepts from Creature Type, Archetype, and Role.",
    built: true,
  },
  {
    id: "vault",
    label: "Vault",
    icon: "tabler:lock",
    summary: "Item and spell creator (not yet built).",
    built: false,
  },
  {
    id: "sanctum",
    label: "Sanctum",
    icon: "tabler:building-castle",
    summary: "Dungeon and location creator (not yet built).",
    built: false,
  },
];

export function resolveToolContextPath() {
  if (typeof window === "undefined") {
    return "workbench";
  }
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "workbench";
  }
  return segments[segments.length - 2];
}

// Every built tool lives at undercroft/{id}/index.html — same page linking
// to itself resolves as a bare "index.html", any other tool reaches across
// via "../{id}/index.html". Admin used to be nested under Workbench
// (workbench/admin.html); it's its own tool now, at the same level as
// Workbench/Press/Loom/Forge, so it follows this exact same rule instead of
// needing a special case.
export function resolveToolHref(toolId, currentSection) {
  const builtToolIds = ["workbench", "press", "orrery", "loom", "forge", "admin", "crucible"];
  if (!builtToolIds.includes(toolId)) {
    return "#";
  }
  return currentSection === toolId ? "index.html" : `../${toolId}/index.html`;
}

// A card for one tool inside the dropdown — a real <a> (built, and not the
// current tool), or an inert, non-focusable <span>: either "coming soon"
// (not yet built) or "you are here" (the current tool — full color, just
// not a link back to the page you're already on).
function buildToolCard(tool, currentSection, built, isCurrent = false) {
  const card = document.createElement(built && !isCurrent ? "a" : "span");
  const classes = [`undercroft-tool-card`, `tool-${tool.id}`];
  if (!built) classes.push("is-disabled");
  if (isCurrent) classes.push("is-current");
  card.className = classes.join(" ");
  if (built && !isCurrent) {
    card.setAttribute("href", resolveToolHref(tool.id, currentSection));
  } else if (isCurrent) {
    card.setAttribute("aria-current", "true");
    card.setAttribute("tabindex", "-1");
  } else {
    card.setAttribute("aria-disabled", "true");
    card.setAttribute("tabindex", "-1");
  }
  const icon = document.createElement("span");
  icon.className = "iconify undercroft-tool-card-icon";
  icon.dataset.icon = tool.icon;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "undercroft-tool-card-text";
  const name = document.createElement("span");
  name.className = "undercroft-tool-card-name";
  name.textContent = tool.label;
  const summary = document.createElement("small");
  summary.className = "undercroft-tool-card-summary";
  summary.textContent = tool.summary;
  text.append(name, summary);
  card.append(icon, text);
  return card;
}

// Trigger shows only the CURRENT tool (icon + name) — no permanent space
// cost beyond what today's single-letter row already used, since it's one
// compact button instead of one button per tool. Clicking/hovering it
// (same hover-open + focus-accessible pattern as auth-ui.js's own account
// dropdown) reveals the other tools as described cards instead of relying
// on a tooltip per button.
function initToolNavigation(root = document) {
  const toolNavs = Array.from(root.querySelectorAll("[data-undercroft-tool-nav]"));
  if (!toolNavs.length) {
    return;
  }
  const [primaryNav, ...extraNavs] = toolNavs;
  extraNavs.forEach((nav) => nav.remove());
  const activeTool = root.body?.dataset?.undercroftTool;
  if (!activeTool) {
    return;
  }
  const activeDefinition = TOOL_DEFINITIONS.find((tool) => tool.id === activeTool);
  if (!activeDefinition) {
    return;
  }
  const currentSection = resolveToolContextPath();
  // Current tool leads the grid (top-left), then the other built tools in
  // their definition order — with 4 built tools total this fills the 2x2
  // grid exactly, no blank cell.
  const builtTools = TOOL_DEFINITIONS.filter((tool) => tool.built !== false);
  const orderedBuilt = [activeDefinition, ...builtTools.filter((tool) => tool.id !== activeTool)];
  const unbuiltOthers = TOOL_DEFINITIONS.filter((tool) => tool.built === false);

  primaryNav.innerHTML = "";

  const dropdown = document.createElement("div");
  dropdown.className = "dropdown undercroft-tool-switcher";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `btn dropdown-toggle undercroft-tool-trigger tool-${activeDefinition.id}`;
  toggle.dataset.bsToggle = "dropdown";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", `Switch tool — currently ${activeDefinition.label}`);
  toggle.dataset.toolSwitcherToggle = "";
  const triggerIcon = document.createElement("span");
  triggerIcon.className = "iconify";
  triggerIcon.dataset.icon = activeDefinition.icon;
  triggerIcon.setAttribute("aria-hidden", "true");
  const triggerLabel = document.createElement("span");
  triggerLabel.className = "undercroft-tool-trigger-label";
  // "Undercroft" prefix only on the trigger (it's replacing the page's own
  // "Undercroft {Tool}" title) — dropdown cards just say the tool name,
  // no need to repeat the suite name on every one of those.
  triggerLabel.textContent = `Undercroft ${activeDefinition.label}`;
  toggle.append(triggerIcon, triggerLabel);

  const menu = document.createElement("div");
  menu.className = "dropdown-menu undercroft-tool-dropdown p-2";

  const grid = document.createElement("div");
  grid.className = "undercroft-tool-grid";
  orderedBuilt.forEach((tool) =>
    grid.appendChild(buildToolCard(tool, currentSection, true, tool.id === activeTool))
  );
  menu.appendChild(grid);

  if (unbuiltOthers.length) {
    // No "Coming soon" heading — the built/unbuilt split shifts constantly
    // as new tools ship, so a muted grid beneath the built one reads fine
    // without needing a label to explain it.
    const mutedGrid = document.createElement("div");
    mutedGrid.className = "undercroft-tool-grid undercroft-tool-grid--muted";
    unbuiltOthers.forEach((tool) => mutedGrid.appendChild(buildToolCard(tool, currentSection, false)));
    menu.appendChild(mutedGrid);
  }

  dropdown.append(toggle, menu);
  primaryNav.appendChild(dropdown);

  if (window.bootstrap && typeof window.bootstrap.Dropdown === "function") {
    const instance = window.bootstrap.Dropdown.getOrCreateInstance(toggle);
    let hideTimer = null;
    const cancelHide = () => {
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const showMenu = () => {
      cancelHide();
      instance.show();
    };
    // The trigger and menu are separate boxes with a small visual gap
    // between them — crossing it briefly leaves the pointer over neither,
    // which would otherwise close the menu before it reaches the cards.
    // Delaying the hide (and canceling it on re-entry) gives that crossing
    // room without needing the menu to visually touch the trigger.
    const scheduleHide = () => {
      cancelHide();
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        instance.hide();
      }, 200);
    };
    dropdown.addEventListener("mouseenter", showMenu);
    dropdown.addEventListener("mouseleave", scheduleHide);
    toggle.addEventListener("focus", showMenu);
    dropdown.addEventListener("focusout", (event) => {
      if (!dropdown.contains(event.relatedTarget)) {
        cancelHide();
        instance.hide();
      }
    });
  }
}

function showFeedback(status, feedback, fallbackMessage) {
  if (!status || typeof status.show !== "function") {
    return;
  }
  if (!feedback) {
    if (fallbackMessage) {
      status.show(fallbackMessage, { type: "info", timeout: 1500 });
    }
    return;
  }
  if (typeof feedback === "string") {
    status.show(feedback, { timeout: 1500 });
    return;
  }
  if (typeof feedback === "object") {
    const { message, options } = feedback;
    if (message) {
      status.show(message, options);
    }
  }
}

export function initAppShell({
  root = document,
  namespace = "default",
  storagePrefix = "undercroft.workbench.undo",
  onUndo = null,
  onRedo = null,
  undoLimit,
} = {}) {
  const statusRoot = root.querySelector("[data-status-root]") || document.createElement("div");
  const status = new StatusManager(statusRoot);
  if (!statusRoot.parentElement) {
    document.body.appendChild(statusRoot);
  }

  initThemeControls(root);
  initPaneToggles(root);
  initToolNavigation(root);

  const undoStack = new UndoRedoStack({
    storageKey: `${storagePrefix}.${namespace}`,
    limit: typeof undoLimit === "number" ? undoLimit : undefined,
  });
  const keyboard = new KeyboardShortcuts();
  function performUndo({ silent = false } = {}) {
    const entry = undoStack.undoStep();
    if (!entry) {
      if (!silent) {
        status.show("Nothing to undo", { type: "info", timeout: 1200 });
      }
      return null;
    }
    const feedback = typeof onUndo === "function" ? onUndo(entry) : null;
    const applied = !(
      feedback &&
      typeof feedback === "object" &&
      Object.prototype.hasOwnProperty.call(feedback, "applied") &&
      feedback.applied === false
    );
    if (!applied) {
      undoStack.requeueUndo(entry);
    }
    if (!silent) {
      showFeedback(status, feedback, applied ? "Undid last action" : null);
    }
    return applied ? entry : null;
  }

  function performRedo({ silent = false } = {}) {
    const entry = undoStack.redoStep();
    if (!entry) {
      if (!silent) {
        status.show("Nothing to redo", { type: "info", timeout: 1200 });
      }
      return null;
    }
    const feedback = typeof onRedo === "function" ? onRedo(entry) : null;
    const applied = !(
      feedback &&
      typeof feedback === "object" &&
      Object.prototype.hasOwnProperty.call(feedback, "applied") &&
      feedback.applied === false
    );
    if (!applied) {
      undoStack.requeueRedo(entry);
    }
    if (!silent) {
      showFeedback(status, feedback, applied ? "Redid last action" : null);
    }
    return applied ? entry : null;
  }

  keyboard.register("ctrl+z", (event) => {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    performUndo();
  });
  keyboard.register(["ctrl", "shift", "z"], (event) => {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    performRedo();
  });

  return { status, undoStack, keyboard, undo: performUndo, redo: performRedo };
}
