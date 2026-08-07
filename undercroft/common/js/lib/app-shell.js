import { initThemeControls } from "./theme.js";
import { initPaneToggles } from "./panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";
import { attachHoverDropdown } from "./dom.js";

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
  {
    id: "repository",
    label: "Repository",
    icon: "tabler:notebook",
    summary: "Campaign notes, lore, and wiki-style journal pages.",
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
  const builtToolIds = [
    "home",
    "workbench",
    "press",
    "orrery",
    "loom",
    "forge",
    "crucible",
    "vault",
    "sanctum",
    "repository",
  ];
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

// The same tool-card grid the dropdown builds below — one rendering path for
// both surfaces. The Dashboard ("home") isn't in TOOL_DEFINITIONS at all (see
// that array's own history: it used to be, back when the Dashboard had its
// own dropdown card and nav-list entry — it's reached via the dedicated home
// icon in initToolNavigation now instead), so there's nothing to exclude here
// anymore.
export function renderToolGrid(container, { currentSection = resolveToolContextPath() } = {}) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const builtTools = TOOL_DEFINITIONS.filter((tool) => tool.built !== false);
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
const SUITE_ICON = "tabler:building-arch";

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
  primaryNav.classList.add("d-flex", "align-items-center", "gap-2");

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

  // A small always-present way back to the Dashboard, now that it's not in
  // TOOL_DEFINITIONS (and so has no card of its own in the dropdown above).
  // Sits to the right of the switcher. Omitted on the Dashboard itself —
  // clicking it would just reload the page you're already on, same reasoning
  // buildToolCard uses to render the current tool as an inert span instead
  // of a link.
  if (currentSection !== "home") {
    const homeLink = document.createElement("a");
    homeLink.className = "btn btn-outline-secondary d-flex align-items-center justify-content-center";
    homeLink.href = resolveToolHref("home", currentSection);
    homeLink.title = "Home";
    homeLink.setAttribute("aria-label", "Home");
    const homeIcon = document.createElement("span");
    homeIcon.className = "iconify fs-5";
    homeIcon.dataset.icon = "tabler:home";
    homeIcon.setAttribute("aria-hidden", "true");
    homeLink.appendChild(homeIcon);
    primaryNav.appendChild(homeLink);
  }

  attachHoverDropdown(dropdown, toggle);
}

// One pane-toggle button — a fourth, header-only button shape distinct from
// ui-components.js's "compact"/"toolbar" kinds: default (non-btn-sm, non-p-2)
// Bootstrap button sizing, a `fs-5` icon, and a visually-hidden label, but
// deliberately no tooltip attributes at all (initPaneToggles, not Bootstrap's
// Tooltip, owns this control's affordance). Used only here, twice per page —
// not worth generalizing into the shared icon-button factory for a shape
// that appears nowhere else in the suite.
function buildPaneToggleButton(key, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-secondary d-flex align-items-center justify-content-center";
  button.dataset.paneToggle = key;
  button.setAttribute("aria-label", label);
  const icon = document.createElement("span");
  icon.className = "iconify fs-5";
  icon.dataset.icon = key === "left" ? "tabler:layout-sidebar-right" : "tabler:adjustments-horizontal";
  icon.setAttribute("aria-hidden", "true");
  const hiddenLabel = document.createElement("span");
  hiddenLabel.className = "visually-hidden";
  hiddenLabel.textContent = label;
  button.append(icon, hiddenLabel);
  return button;
}

// `ariaLabel` and `hiddenLabelText` are deliberately different strings in
// the original markup this replaces — e.g. aria-label="Use light theme" (an
// action) vs. the visually-hidden span's "Light theme" (a label) — kept
// distinct here rather than collapsed into one shared string.
function buildThemeToggleButton(option, ariaLabel, hiddenLabelText, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-primary";
  button.dataset.themeOption = option;
  if (!icon) {
    button.textContent = hiddenLabelText;
    return button;
  }
  button.setAttribute("aria-label", ariaLabel);
  const iconEl = document.createElement("span");
  iconEl.className = "iconify fs-5";
  iconEl.dataset.icon = icon;
  iconEl.setAttribute("aria-hidden", "true");
  const hiddenLabel = document.createElement("span");
  hiddenLabel.className = "visually-hidden";
  hiddenLabel.textContent = hiddenLabelText;
  button.append(iconEl, hiddenLabel);
  return button;
}

// Builds the entire <header> — pane toggles, tool-switcher mount, auth
// control mount, theme toggle group — replacing what used to be ~47 lines of
// byte-identical hand-copied markup duplicated across every tool's own
// index.html. Purely additive: only runs when a page opts in with a
// `<div data-app-shell-header></div>` mount point; pages that still carry
// their own literal <header> markup (not yet migrated) are left completely
// alone. Deliberately NOT touching the theme-flash-prevention inline
// <script> or the CDN <link>/<script> tags in each page's own <head> — both
// must run/load synchronously before first paint, which building them here
// (after this module has loaded and executed) cannot provide.
function buildAppShellHeader(root, { leftPaneLabel, rightPaneLabel, settingsSlotAttr }) {
  const mount = root.querySelector("[data-app-shell-header]");
  if (!mount) {
    return;
  }

  const header = document.createElement("header");
  header.className = "workbench-header border-bottom bg-body-tertiary";

  const grid = document.createElement("div");
  grid.className = "workbench-header-grid pe-2 py-3";
  // The header's first grid cell is a plain spacer on most tools, but
  // Vault/Crucible/Repository mount a Settings-gear button here instead
  // (common/js/lib/tool-settings.js, wired by each tool's own app.js —
  // this only reserves the slot, it doesn't build the button itself).
  if (settingsSlotAttr) {
    const settingsSlot = document.createElement("div");
    settingsSlot.className = "d-flex align-items-center justify-content-end ps-2";
    settingsSlot.setAttribute(settingsSlotAttr, "");
    grid.appendChild(settingsSlot);
  } else {
    grid.appendChild(document.createElement("div"));
  }

  const middle = document.createElement("div");
  middle.className = "d-flex align-items-center gap-3 w-100";

  const leftGroup = document.createElement("div");
  leftGroup.className = "d-flex align-items-center gap-3";
  leftGroup.appendChild(buildPaneToggleButton("left", leftPaneLabel));
  const h1 = document.createElement("h1");
  h1.className = "h5 mb-0 d-flex align-items-center gap-2";
  const nav = document.createElement("nav");
  nav.setAttribute("data-undercroft-tool-nav", "");
  nav.setAttribute("aria-label", "Undercroft tools");
  h1.appendChild(nav);
  leftGroup.appendChild(h1);

  const rightGroup = document.createElement("div");
  rightGroup.className = "ms-auto d-flex align-items-center gap-3 flex-wrap";

  const authControl = document.createElement("div");
  authControl.setAttribute("data-auth-control", "");
  authControl.className = "d-flex";
  rightGroup.appendChild(authControl);

  const themeGroup = document.createElement("div");
  themeGroup.className = "btn-group";
  themeGroup.setAttribute("role", "group");
  themeGroup.setAttribute("aria-label", "Theme toggle");
  themeGroup.append(
    buildThemeToggleButton("light", "Use light theme", "Light theme", "tabler:sun"),
    buildThemeToggleButton("system", "System", "System", null),
    buildThemeToggleButton("dark", "Use dark theme", "Dark theme", "tabler:moon")
  );
  rightGroup.appendChild(themeGroup);

  // docs.html is the one page with no right pane at all — pass
  // rightPaneLabel: null there to omit this button entirely, same as its
  // hand-written markup already does today.
  if (rightPaneLabel) {
    rightGroup.appendChild(buildPaneToggleButton("right", rightPaneLabel));
  }

  middle.append(leftGroup, rightGroup);
  grid.append(middle, document.createElement("div"));
  header.appendChild(grid);

  mount.replaceWith(header);
}

// Builds one left/right `<aside>` pane shell — the border/background/shadow/
// sizing/`.workbench-pane-content` wrapper every tool used to hand-write
// (~9 lines × 2 panes × 12 pages, and not even consistently: some pages
// baked `d-flex`/`d-none` directly into their static class list, others
// didn't and relied on `.workbench-pane`'s own CSS carrying no `display` at
// all — a latent flash-of-wrong-layout risk on any page whose pane started
// collapsed; gap/padding utility classes drifted per tool too, gap-3 vs
// gap-4, p-3 vs p-4, with no actual reason for the difference). Only `side`,
// `size`, and `initial` are real per-tool decisions (a pane's width, and
// whether it starts open) — gap/padding/shadow are hardcoded to one
// canonical value here on purpose, so a new tool has no knob to drift on.
// `mountEl` is the page's own `[data-pane-content="left"|"right"]` marker —
// its CHILDREN (not the marker div itself) are moved wholesale into the
// freshly-built `.workbench-pane-content`, so whatever tool-specific
// structure lives inside (a plain sequence of `<section>`s for most tools,
// a single custom widget container for the Dashboard/account's Help
// browser) is preserved exactly, unexamined.
function buildPaneShell(mountEl, { side, size = "default", initial = "expanded" }) {
  if (!mountEl) {
    return null;
  }
  const aside = document.createElement("aside");
  aside.dataset.pane = side;
  aside.setAttribute("data-pane-collapsed-class", "d-none");
  aside.setAttribute("data-pane-expanded-class", "d-flex");
  aside.setAttribute("data-pane-initial", initial);
  const isCollapsed = initial === "collapsed";
  aside.className = [
    side === "left" ? "border-end" : "border-start",
    "border-body-tertiary",
    "bg-body-tertiary",
    "shadow-theme",
    "flex-shrink-0",
    size === "lg" ? "workbench-sidebar-lg" : "workbench-sidebar",
    "workbench-pane",
    // Baked in directly (not left for initPaneToggles to apply on first
    // run) so a pane that starts collapsed never flashes open first — the
    // exact gap the old per-page markup had whenever it omitted this class
    // from its own static list.
    isCollapsed ? "d-none" : "d-flex",
  ].join(" ");

  const content = document.createElement("div");
  content.className = "workbench-pane-content d-flex flex-column gap-4 p-3 workbench-sticky-pane";
  while (mountEl.firstChild) {
    content.appendChild(mountEl.firstChild);
  }
  aside.appendChild(content);
  mountEl.replaceWith(aside);
  return aside;
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
  // Defaults match the most common values across the suite (see
  // buildAppShellHeader) — most tools only need to override one or both to
  // name their own left/right pane accurately; pass rightPaneLabel: null to
  // omit the right-pane toggle entirely (docs.html has no right pane).
  leftPaneLabel = "Toggle navigation pane",
  rightPaneLabel = "Toggle details pane",
  // Set for Vault/Crucible/Repository, whose header reserves its first grid
  // cell for a Settings-gear button instead of leaving it a plain spacer —
  // e.g. "data-vault-settings-slot". The attribute name only; building and
  // wiring the actual button is still each tool's own app.js's job (via
  // common/js/lib/tool-settings.js), same as before this migration.
  settingsSlotAttr = null,
  // { size: "default"|"lg", initial: "expanded"|"collapsed" } — every tool
  // has a left pane, so this always builds one (against the page's own
  // [data-pane-content="left"] marker). Pass leftPane: null only if a page
  // genuinely has no left pane at all (none currently do).
  leftPane = { size: "default", initial: "expanded" },
  // Same shape, but pass rightPane: null for a page with no right pane at
  // all (docs.html is the one page in the suite like this).
  rightPane = { size: "default", initial: "expanded" },
} = {}) {
  buildAppShellHeader(root, { leftPaneLabel, rightPaneLabel, settingsSlotAttr });
  if (leftPane) {
    buildPaneShell(root.querySelector('[data-pane-content="left"]'), { side: "left", ...leftPane });
  }
  if (rightPane) {
    buildPaneShell(root.querySelector('[data-pane-content="right"]'), { side: "right", ...rightPane });
  }
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
