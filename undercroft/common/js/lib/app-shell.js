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
    id: "home",
    label: "Dashboard",
    icon: "tabler:home",
    summary: "Customizable landing page — jump to a tool or build a play view.",
    built: true,
  },
  {
    id: "workbench",
    label: "Workbench",
    icon: "tabler:layout-dashboard",
    summary: "Character sheet, template, and system editor.",
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
    summary: "NPC generator.",
    built: true,
  },
  {
    id: "crucible",
    label: "Crucible",
    icon: "tabler:flask",
    summary: "Monster and adversary creator.",
    built: true,
  },
  {
    id: "vault",
    label: "Vault",
    icon: "tabler:lock",
    summary: "Spell and magic item generator.",
    built: true,
  },
  {
    id: "sanctum",
    label: "Sanctum",
    icon: "tabler:building-castle",
    summary: "Location and dungeon generator.",
    built: true,
  },
];

// The suite's own root folder name, hardcoded the same way every other
// relative path in this file already assumes a fixed layout (e.g.
// resolveAccountHref's "../common/account.html"). Only the Dashboard
// (undercroft/index.html) lives directly inside it rather than in its own
// subfolder, which is what makes it need special-casing everywhere else in
// this file just treats "one level up" as constant.
const SUITE_ROOT_FOLDER = "undercroft";

export function resolveToolContextPath() {
  if (typeof window === "undefined") {
    return "workbench";
  }
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "workbench";
  }
  const section = segments[segments.length - 2];
  // The Dashboard sits directly under undercroft/ (no subfolder of its own),
  // so its "section" is the suite root folder itself rather than a real tool
  // folder name — remap that to "home" so every other resolver below can
  // treat it as just another section id instead of a one-off case.
  return section === SUITE_ROOT_FOLDER ? "home" : section;
}

// Every built tool lives at undercroft/{id}/index.html — same page linking
// to itself resolves as a bare "index.html", any other tool reaches across
// via "../{id}/index.html". The Dashboard ("home") is the one exception —
// it lives at undercroft/index.html directly, one level shallower than
// every other tool — so both directions of that path math get a branch:
// linking to it is "../index.html" (not "../home/index.html"), and linking
// from it descends straight into "{toolId}/index.html" (not "../{toolId}/...").
export function resolveToolHref(toolId, currentSection) {
  const builtToolIds = ["home", "workbench", "press", "orrery", "loom", "forge", "crucible", "vault", "sanctum"];
  if (!builtToolIds.includes(toolId)) {
    return "#";
  }
  if (currentSection === "home") {
    return toolId === "home" ? "index.html" : `${toolId}/index.html`;
  }
  if (toolId === "home") {
    return "../index.html";
  }
  return currentSection === toolId ? "index.html" : `../${toolId}/index.html`;
}

// Account settings/owned-content isn't a "tool" (see TOOL_DEFINITIONS above —
// Admin was retired as a distinct tool entirely), just a flat page directly
// under common/ — undercroft/common/account.html, at the same nesting depth
// as every tool's own index.html, so this mirrors resolveToolHref's exact
// pattern (including the Dashboard's one-level-shallower special case).
export function resolveAccountHref(currentSection) {
  if (currentSection === "common") {
    return "account.html";
  }
  if (currentSection === "home") {
    return "common/account.html";
  }
  return "../common/account.html";
}

// The same tool-card grid the dropdown builds below, exposed for the
// Dashboard's "Jump to a tool" widget so it doesn't need its own duplicate
// of TOOL_DEFINITIONS/buildToolCard — one rendering path for both surfaces.
// "home" itself is excluded (no point linking to the Dashboard from within
// one of its own widgets).
export function renderToolGrid(container, { currentSection = resolveToolContextPath() } = {}) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const builtTools = TOOL_DEFINITIONS.filter((tool) => tool.built !== false && tool.id !== "home");
  const unbuiltOthers = TOOL_DEFINITIONS.filter((tool) => tool.built === false);
  const grid = document.createElement("div");
  grid.className = "undercroft-tool-grid";
  builtTools.forEach((tool) => grid.appendChild(buildToolCard(tool, currentSection, true, false)));
  container.appendChild(grid);
  if (unbuiltOthers.length) {
    const mutedGrid = document.createElement("div");
    mutedGrid.className = "undercroft-tool-grid undercroft-tool-grid--muted";
    unbuiltOthers.forEach((tool) => mutedGrid.appendChild(buildToolCard(tool, currentSection, false)));
    container.appendChild(mutedGrid);
  }
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
// Icon/label shown when the current page isn't one of TOOL_DEFINITIONS at
// all — e.g. undercroft/common/account.html, which is account settings, not
// a tool. Rather than the trigger going blank (the old behavior: no matching
// definition meant this function bailed out entirely), it falls back to a
// generic suite identity, with the full tool grid still available below it.
const SUITE_ICON = "tabler:door";

function initToolNavigation(root = document) {
  const toolNavs = Array.from(root.querySelectorAll("[data-undercroft-tool-nav]"));
  if (!toolNavs.length) {
    return;
  }
  const [primaryNav, ...extraNavs] = toolNavs;
  extraNavs.forEach((nav) => nav.remove());
  const activeTool = root.body?.dataset?.undercroftTool;
  const activeDefinition = TOOL_DEFINITIONS.find((tool) => tool.id === activeTool);
  const currentSection = resolveToolContextPath();
  // Current tool leads the grid (top-left), then the other built tools in
  // their definition order. When there's no matching definition (account.html
  // and any other non-tool page), nothing leads — just the plain built-tool
  // order, none marked current.
  const builtTools = TOOL_DEFINITIONS.filter((tool) => tool.built !== false);
  const orderedBuilt = activeDefinition
    ? [activeDefinition, ...builtTools.filter((tool) => tool.id !== activeTool)]
    : builtTools;
  const unbuiltOthers = TOOL_DEFINITIONS.filter((tool) => tool.built === false);

  primaryNav.innerHTML = "";

  const dropdown = document.createElement("div");
  dropdown.className = "dropdown undercroft-tool-switcher";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `btn dropdown-toggle undercroft-tool-trigger${activeDefinition ? ` tool-${activeDefinition.id}` : ""}`;
  toggle.dataset.bsToggle = "dropdown";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute(
    "aria-label",
    activeDefinition ? `Switch tool — currently ${activeDefinition.label}` : "Switch tool"
  );
  toggle.dataset.toolSwitcherToggle = "";
  const triggerIcon = document.createElement("span");
  triggerIcon.className = "iconify";
  triggerIcon.dataset.icon = activeDefinition ? activeDefinition.icon : SUITE_ICON;
  triggerIcon.setAttribute("aria-hidden", "true");
  const triggerLabel = document.createElement("span");
  triggerLabel.className = "undercroft-tool-trigger-label";
  // "Undercroft" prefix only on the trigger (it's replacing the page's own
  // "Undercroft {Tool}" title) — dropdown cards just say the tool name,
  // no need to repeat the suite name on every one of those. No matching
  // definition (account.html) just shows "Undercroft" alone.
  triggerLabel.textContent = activeDefinition ? `Undercroft ${activeDefinition.label}` : "Undercroft";
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
