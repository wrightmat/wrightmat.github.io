import { initThemeControls, loadThemePacks, wireThemePackOptions } from "./theme.js";
import { initPaneToggles, collapsePane, expandPane } from "./panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";
import { initSuiteSearch } from "./suite-search.js";
import { initTooltip, installTooltipAutoInit } from "./tooltips.js";
import { DEFAULT_SESSION_KEY, roleRank } from "./data-manager.js";
import { initEnvironmentTitle } from "./environment.js";

// `icon` is an Iconify `tabler:*` id, same convention used suite-wide.
// `built` distinguishes real tools from roadmap-only entries — kept
// explicit rather than inferred, so a new tool can't silently dead-link.
const TOOL_DEFINITIONS = [
  {
    id: "orrery",
    label: "Orrery",
    icon: "tabler:map-2",
    summary: "Map creator and viewer",
    built: true,
  },
  {
    id: "press",
    label: "Press",
    icon: "tabler:printer",
    summary: "Versatile printing utility",
    built: true,
  },
  {
    id: "repository",
    label: "Repository",
    icon: "tabler:notebook",
    summary: "Wiki-style game journal",
    built: true,
  },
  {
    id: "workbench",
    label: "Workbench",
    icon: "tabler:layout-dashboard",
    summary: "Character sheet and template editor",
    built: true,
  },
  {
    id: "crucible",
    label: "Crucible",
    icon: "tabler:flask",
    summary: "Monster and adversary creator",
    built: true,
  },
  {
    id: "forge",
    label: "Forge",
    icon: "tabler:hammer",
    summary: "Non-Player Character generator",
    built: true,
  },
  {
    id: "sanctum",
    label: "Sanctum",
    icon: "tabler:building-castle",
    summary: "Location and dungeon generator",
    built: true,
  },
  {
    id: "vault",
    label: "Vault",
    icon: "tabler:lock",
    summary: "Spell and magic item generator",
    built: true,
  },
  {
    id: "loom",
    label: "Loom",
    icon: "tabler:cloud-download",
    summary: "Manage data or import external content",
    built: true,
    // Lowest tier that sees the tool in the nav at all.
    minTier: "gm",
  },
];

// The signed-in user's tier as the session already stored it; no one signed in is "free".
function currentTier() {
  try {
    return JSON.parse(window.localStorage.getItem(DEFAULT_SESSION_KEY))?.user?.tier || "free";
  } catch (error) {
    return "free";
  }
}

function isToolVisible(tool) {
  return !tool.minTier || roleRank(currentTier()) >= roleRank(tool.minTier);
}


// The suite's own root folder name — every relative path here assumes this
// fixed layout. The Dashboard alone lives directly inside it rather than
// its own subfolder, which is why it needs special-casing below.
const SUITE_ROOT_FOLDER = "undercroft";

export function resolveToolContextPath(pathname = typeof window === "undefined" ? "" : window.location.pathname) {
  if (typeof window === "undefined") {
    return "workbench";
  }
  // A folder URL ("/undercroft/", "/undercroft/loom/") is that folder's index page.
  const segments = (pathname.endsWith("/") ? `${pathname}index.html` : pathname).split("/").filter(Boolean);
  if (segments.length < 2) {
    return "workbench";
  }
  const section = segments[segments.length - 2];
  // The Dashboard has no subfolder, so its "section" is the suite root
  // folder itself — remap to "home" so every resolver below treats it as
  // an ordinary section id.
  return section === SUITE_ROOT_FOLDER ? "home" : section;
}

// Display name for a resolveToolContextPath() section — the two non-tool
// pages (Dashboard, account) aren't in TOOL_DEFINITIONS. "" for a section
// with no name, so a caller can fall back rather than print a raw folder.
export function resolveToolLabel(section) {
  if (section === "home") return "Dashboard";
  if (section === "common") return "Account Settings";
  return TOOL_DEFINITIONS.find((tool) => tool.id === section)?.label || "";
}

// Every built tool lives at undercroft/{id}/index.html; a self-link resolves
// as bare "index.html", any other tool as "../{id}/index.html". "home" (the
// Dashboard) is one level shallower, so both directions get a branch.
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

// Account settings isn't a tool — a flat page at undercroft/common/account.html,
// same nesting depth as a tool's index.html — so this mirrors resolveToolHref's
// pattern, including the Dashboard's shallower special case.
export function resolveAccountHref(currentSection) {
  if (currentSection === "common") {
    return "account.html";
  }
  if (currentSection === "home") {
    return "common/account.html";
  }
  return "../common/account.html";
}

// The documentation page sits beside account.html, so it resolves the same way.
export function resolveDocsHref(currentSection) {
  return resolveAccountHref(currentSection).replace("account.html", "docs.html");
}

export function resolveFindGameHref(currentSection) {
  return resolveAccountHref(currentSection).replace("account.html", "find-a-game.html");
}

// The same tool-card grid the dropdown builds below — one rendering path
// for both surfaces. The Dashboard isn't in TOOL_DEFINITIONS; it's reached
// via the dedicated home icon in initToolNavigation instead.
export function renderToolGrid(container, { currentSection = resolveToolContextPath() } = {}) {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const builtTools = TOOL_DEFINITIONS.filter((tool) => tool.built !== false && isToolVisible(tool));
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

// A card for one tool: a real <a> (built, not current), or an inert
// non-focusable <span> — either "coming soon" or "you are here".
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

// Trigger shows only the current tool (icon + name), one compact button
// instead of one per tool; hovering/clicking (same pattern as auth-ui.js's
// account dropdown) reveals the rest as cards.
// Fallback icon/label for pages with no matching TOOL_DEFINITIONS entry
// (e.g. account.html) — a generic suite identity instead of a blank trigger.
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
  // Current tool leads the grid, then the rest in definition order. No
  // matching definition (account.html) means plain order, none marked current.
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
  // Icon-only until shell.css's container query reveals it; aria-label
  // already carries this text for assistive tech, so display:none (not
  // visually-hidden) is correct here.
  triggerLabel.className = "undercroft-tool-trigger-label";
  // "Undercroft" prefix only on the trigger, replacing the page's own title
  // — dropdown cards just say the tool name. No match (account.html) shows
  // "Undercroft" alone.
  triggerLabel.textContent = activeDefinition ? `Undercroft ${activeDefinition.label}` : "Undercroft";
  toggle.append(triggerIcon, triggerLabel);

  const menu = document.createElement("div");
  menu.className = "dropdown-menu undercroft-tool-dropdown p-2";

  const grid = document.createElement("div");
  grid.className = "undercroft-tool-grid";
  // Rebuilt when the user signs in or out, since which tools show depends on their tier.
  const fillGrid = () => {
    const builtTools = TOOL_DEFINITIONS.filter((tool) => tool.built !== false && isToolVisible(tool));
    const orderedBuilt = activeDefinition && isToolVisible(activeDefinition)
      ? [activeDefinition, ...builtTools.filter((tool) => tool.id !== activeTool)]
      : builtTools;
    grid.replaceChildren(...orderedBuilt.map((tool) => buildToolCard(tool, currentSection, true, tool.id === activeTool)));
  };
  fillGrid();
  window.addEventListener("undercroft:auth-changed", fillGrid);
  menu.appendChild(grid);

  if (unbuiltOthers.length) {
    // No "Coming soon" heading needed — a muted grid beneath the built one
    // reads fine on its own.
    const mutedGrid = document.createElement("div");
    mutedGrid.className = "undercroft-tool-grid undercroft-tool-grid--muted";
    unbuiltOthers.forEach((tool) => mutedGrid.appendChild(buildToolCard(tool, currentSection, false)));
    menu.appendChild(mutedGrid);
  }

  dropdown.append(toggle, menu);

  // Always-present way back to the Dashboard, since it has no card of its
  // own in the dropdown. Omitted on the Dashboard itself, same reasoning
  // buildToolCard uses for the current-tool inert span. Sits before the
  // tool switcher.
  if (currentSection !== "home") {
    const homeLink = document.createElement("a");
    homeLink.className = "btn btn-outline-secondary d-flex align-items-center justify-content-center undercroft-header-icon-btn";
    homeLink.href = resolveToolHref("home", currentSection);
    homeLink.setAttribute("aria-label", "Home");
    const homeIcon = document.createElement("span");
    homeIcon.className = "iconify fs-5";
    homeIcon.dataset.icon = "tabler:home";
    homeIcon.setAttribute("aria-hidden", "true");
    homeLink.appendChild(homeIcon);
    primaryNav.appendChild(homeLink);
    initTooltip(homeLink, { title: "Home" });
  }
  primaryNav.appendChild(dropdown);

}

// One pane-toggle button — a header-only shape distinct from
// ui-components.js's icon-button kinds. initPaneToggles (panes.js) owns the
// pressed/unpressed visual state; the tooltip here is a separate concern
// (what clicking does, not current state). Used only here, not worth
// generalizing further.
function buildPaneToggleButton(key, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-secondary d-flex align-items-center justify-content-center undercroft-header-icon-btn";
  button.dataset.paneToggle = key;
  button.setAttribute("aria-label", label);
  initTooltip(button, { title: label });
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

// `ariaLabel` (an action, e.g. "Use light theme") and `hiddenLabelText` (a
// label, "Light theme") are deliberately distinct strings, not collapsed
// into one.
function buildThemeToggleButton(option, ariaLabel, hiddenLabelText, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline-primary";
  button.dataset.themeOption = option;
  button.setAttribute("aria-label", ariaLabel);
  initTooltip(button, { title: hiddenLabelText });
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

// One row per common/data/theme-packs.json entry — a swatch dot (the
// pack's accent color, previewing the palette without loading its CSS)
// plus its label, as a real dropdown-item so Bootstrap's .active styling
// (theme.js's wireThemePackOptions) applies for free.
function buildThemePackOption(pack) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dropdown-item d-flex align-items-center gap-2";
  button.dataset.themePackOption = pack.id;
  const swatch = document.createElement("span");
  swatch.className = "undercroft-theme-swatch";
  swatch.style.backgroundColor = pack.swatch || "var(--bs-secondary)";
  swatch.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = pack.label || pack.id;
  button.append(swatch, label);
  return button;
}

// One icon trigger folding both mode and palette (theme.js) into a single
// dropdown — already compact at every viewport width, no mobile-collapse
// logic needed. Mode row builds eagerly (3 fixed options); the palette
// list populates once loadThemePacks() resolves, wired via theme.js's own
// wireThemePackOptions (click handling lives there, not here).
function buildThemeSwitcherDropdown() {
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown undercroft-theme-switcher";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn-outline-secondary d-flex align-items-center justify-content-center undercroft-header-icon-btn";
  toggle.dataset.bsToggle = "dropdown";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", "Appearance");
  const toggleIcon = document.createElement("span");
  toggleIcon.className = "iconify fs-5";
  toggleIcon.dataset.icon = "tabler:palette";
  toggleIcon.setAttribute("aria-hidden", "true");
  toggle.appendChild(toggleIcon);

  const menu = document.createElement("div");
  menu.className = "dropdown-menu dropdown-menu-end undercroft-theme-dropdown p-2";

  const modeRow = document.createElement("div");
  modeRow.className = "btn-group w-100 mb-2";
  modeRow.setAttribute("role", "group");
  modeRow.setAttribute("aria-label", "Theme mode");
  modeRow.append(
    buildThemeToggleButton("light", "Use light theme", "Light theme", "tabler:sun"),
    buildThemeToggleButton("system", "Use system theme", "System", "tabler:device-desktop"),
    buildThemeToggleButton("dark", "Use dark theme", "Dark theme", "tabler:moon")
  );
  menu.appendChild(modeRow);
  const divider = document.createElement("hr");
  divider.className = "dropdown-divider";
  menu.appendChild(divider);

  const packList = document.createElement("div");
  packList.className = "d-flex flex-column gap-1";
  packList.setAttribute("data-theme-pack-list", "");
  menu.appendChild(packList);

  dropdown.append(toggle, menu);

  loadThemePacks().then((packs) => {
    if (!packs.length) {
      return;
    }
    const buttons = packs.map((pack) => buildThemePackOption(pack));
    packList.append(...buttons);
    wireThemePackOptions(buttons);
  });

  return dropdown;
}

// Builds the entire <header> — pane toggles, tool-switcher mount, auth
// control, theme toggle group — replacing hand-copied markup once
// duplicated across every tool's index.html. Runs only when a page has a
// `<div data-app-shell-header></div>` mount point; no-ops otherwise.
// Deliberately doesn't touch the theme-flash-prevention inline <script> or
// CDN tags in <head> — both must run synchronously before first paint,
// which this module (loaded after) can't provide.
function buildAppShellHeader(root, { leftPaneLabel, rightPaneLabel, settingsSlotAttr }) {
  const mount = root.querySelector("[data-app-shell-header]");
  if (!mount) {
    return;
  }

  const header = document.createElement("header");
  header.className = "workbench-header border-bottom bg-body-tertiary";

  const grid = document.createElement("div");
  grid.className = "workbench-header-grid py-3";
  const middle = document.createElement("div");
  middle.className = "workbench-header-middle d-flex align-items-center gap-3 w-100";

  const leftGroup = document.createElement("div");
  leftGroup.className = "d-flex align-items-center gap-3";
  leftGroup.appendChild(buildPaneToggleButton("left", leftPaneLabel));
  // Tools with a Settings gear (tool-settings.js, wired by each tool's own app.js) mount it here, right after the
  // left pane toggle; this only reserves the slot.
  if (settingsSlotAttr) {
    const settingsSlot = document.createElement("div");
    settingsSlot.className = "d-flex align-items-center";
    settingsSlot.setAttribute(settingsSlotAttr, "");
    leftGroup.appendChild(settingsSlot);
  }
  const h1 = document.createElement("h1");
  h1.className = "h5 mb-0 d-flex align-items-center gap-2";
  const nav = document.createElement("nav");
  nav.setAttribute("data-undercroft-tool-nav", "");
  nav.setAttribute("aria-label", "Undercroft tools");
  h1.appendChild(nav);
  leftGroup.appendChild(h1);

  // Suite-wide header search, filling the space between leftGroup and
  // rightGroup. flex-grow-1 + max-width keeps a sensible width rather than
  // stretching edge to edge; rightGroup's ms-auto still wins past that cap.
  const searchMount = document.createElement("div");
  searchMount.className = "flex-grow-1 mx-2";
  searchMount.style.maxWidth = "28rem";
  searchMount.style.minWidth = "0";
  searchMount.setAttribute("data-suite-search-mount", "");

  const rightGroup = document.createElement("div");
  rightGroup.className = "ms-auto d-flex align-items-center gap-3 flex-wrap";

  const authControl = document.createElement("div");
  authControl.setAttribute("data-auth-control", "");
  authControl.className = "d-flex";
  rightGroup.appendChild(authControl);

  rightGroup.appendChild(buildThemeSwitcherDropdown());

  // docs.html has no right pane — pass rightPaneLabel: null to omit this
  // button entirely.
  if (rightPaneLabel) {
    rightGroup.appendChild(buildPaneToggleButton("right", rightPaneLabel));
  }

  middle.append(leftGroup, searchMount, rightGroup);
  grid.appendChild(middle);
  header.appendChild(grid);

  mount.replaceWith(header);
  initSuiteSearch({ container: searchMount });
  return header;
}

// Builds one left/right `<aside>` pane shell — the border/shadow/sizing/
// `.workbench-pane-content` wrapper every tool used to hand-write
// inconsistently. Only `side`/`size`/`initial` are real per-tool decisions;
// gap/padding/shadow are hardcoded to one canonical value so a new tool has
// no knob to drift on. `mountEl`'s CHILDREN (not the marker div itself) move
// wholesale into the new wrapper, preserving whatever structure was inside.
function buildPaneShell(mountEl, { side, size = "default", initial = "expanded", phoneInitial = "collapsed" }) {
  if (!mountEl) {
    return null;
  }
  // Below md a pane is a drawer, so it starts collapsed unless the tool asks for it open (`phoneInitial`: a tool
  // whose first act is picking something) — and even then not when the page was opened with a query string, which
  // means a resource was passed in and there is nothing to pick. Only the INITIAL state; the toggles work as usual.
  const isNarrowViewport = window.matchMedia("(max-width: 767.98px)").matches;
  const resourcePassed = [...new URLSearchParams(window.location.search).keys()].some((key) => key !== "invite");
  const phoneOpen = phoneInitial === "expanded" && !resourcePassed;
  const effectiveInitial = isNarrowViewport ? (phoneOpen ? "expanded" : "collapsed") : initial;
  const aside = document.createElement("aside");
  aside.dataset.pane = side;
  aside.setAttribute("data-pane-collapsed-class", "d-none");
  aside.setAttribute("data-pane-expanded-class", "d-flex");
  aside.setAttribute("data-pane-initial", effectiveInitial);
  const isCollapsed = effectiveInitial === "collapsed";
  aside.className = [
    side === "left" ? "border-end" : "border-start",
    "border-body-tertiary",
    "bg-body-tertiary",
    "shadow-theme",
    "flex-shrink-0",
    size === "lg" ? "workbench-sidebar-lg" : "workbench-sidebar",
    "workbench-pane",
    // Baked in directly so a pane that starts collapsed never flashes open
    // first.
    isCollapsed ? "d-none" : "d-flex",
  ].join(" ");

  const content = document.createElement("div");
  content.className = "workbench-pane-content d-flex flex-column gap-4 p-3 workbench-sticky-pane";
  while (mountEl.firstChild) {
    content.appendChild(mountEl.firstChild);
  }
  aside.appendChild(content);
  mountEl.replaceWith(aside);
  return { aside, size, effectiveInitial };
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

// Builds and inserts the real `<header>` into the page's own
// `[data-app-shell-header]` mount point before anything else here runs.
// Any code reading a header-internal element must query it AFTER this call
// — a module-top-level `const` capturing it too early has caused real bugs.
// Prefer a live `document.querySelector` at point of use.
// A generator's result is what the user came to read, so on a phone the left-pane drawer closes once Generate is
// pressed.
export function collapseLeftPaneOnPhone() {
  if (!window.matchMedia("(max-width: 767.98px)").matches) return;
  const pane = document.querySelector('[data-pane="left"]');
  const toggle = document.querySelector('[data-pane-toggle="left"]');
  if (pane && toggle && pane.dataset.state === "expanded") collapsePane(pane, toggle);
}

export function initAppShell({
  root = document,
  namespace = "default",
  storagePrefix = "undercroft.workbench.undo",
  onUndo = null,
  onRedo = null,
  undoLimit,
  // Defaults match the most common values across the suite; most tools only
  // override to name their own pane accurately. Pass rightPaneLabel: null
  // to omit the toggle entirely (docs.html has no right pane).
  leftPaneLabel = "Toggle navigation pane",
  rightPaneLabel = "Toggle details pane",
  // Set for Vault/Crucible/Repository, whose header reserves its first grid
  // cell for a Settings-gear button (e.g. "data-vault-settings-slot"). The
  // attribute name only — each tool's own app.js still builds/wires the
  // button via tool-settings.js.
  settingsSlotAttr = null,
  // { size: "default"|"lg", initial: "expanded"|"collapsed", phoneInitial } — every tool has a left pane, so this
  // always builds one (pass leftPane: null only if a page genuinely has none; none currently do). Most tools open
  // by picking something in it, so by default it starts open on a phone too; a tool where the pane is not the
  // first stop (Loom's tabs, the Dashboard) passes phoneInitial: "collapsed".
  leftPane = { size: "default", initial: "expanded", phoneInitial: "expanded" },
  // Same shape, but pass rightPane: null for a page with no right pane at
  // all (docs.html is the one page in the suite like this).
  rightPane = { size: "default", initial: "expanded" },
} = {}) {
  installTooltipAutoInit();
  initEnvironmentTitle();
  const headerEl = buildAppShellHeader(root, { leftPaneLabel, rightPaneLabel, settingsSlotAttr });
  if (leftPane) buildPaneShell(root.querySelector('[data-pane-content="left"]'), { side: "left", ...leftPane });
  if (rightPane) buildPaneShell(root.querySelector('[data-pane-content="right"]'), { side: "right", ...rightPane });
  const statusRoot = root.querySelector("[data-status-root]") || document.createElement("div");
  const status = new StatusManager(statusRoot);
  if (!statusRoot.parentElement) {
    document.body.appendChild(statusRoot);
  }

  initThemeControls(root);

  // Below md a pane is a drawer over the page (shell.css): the header's height is published for its top edge, only
  // one drawer is open at a time, and a tap outside closes it. Wider, panes sit beside the content and are closed
  // when they would squeeze it below a usable width.
  const MIN_MAIN_WIDTH_REM = 28;
  const drawerQuery = window.matchMedia("(max-width: 767.98px)");

  function publishHeaderHeight() {
    document.documentElement.style.setProperty("--undercroft-header-height", `${headerEl.getBoundingClientRect().height}px`);
  }
  publishHeaderHeight();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(publishHeaderHeight).observe(headerEl);

  function remToPx(remValue) {
    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return remValue * rootFontSizePx;
  }

  function mainWidth() {
    return root.querySelector(".workbench-main")?.getBoundingClientRect().width ?? Infinity;
  }

  const isExpanded = (side) => {
    const paneEl = root.querySelector(`[data-pane="${side}"]`);
    return Boolean(paneEl) && paneEl.dataset.state === "expanded";
  };

  function setPane(side, expand) {
    const paneEl = root.querySelector(`[data-pane="${side}"]`);
    if (!paneEl) return;
    const toggleEl = root.querySelector(`[data-pane-toggle="${side}"]`);
    if (expand) {
      expandPane(paneEl, toggleEl);
    } else {
      collapsePane(paneEl, toggleEl);
    }
  }

  const tooCrowded = () => drawerQuery.matches || mainWidth() < remToPx(MIN_MAIN_WIDTH_REM);

  initPaneToggles(root, {
    onChange: ({ key, state }) => {
      if (state !== "expanded") return;
      const otherSide = key === "left" ? "right" : "left";
      // A click always wins: the other pane gives way, never the one just opened.
      if (isExpanded(otherSide) && tooCrowded()) setPane(otherSide, false);
    },
  });
  initToolNavigation(root);

  document.addEventListener("pointerdown", (event) => {
    if (!drawerQuery.matches || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-pane], [data-pane-toggle], .modal, .dropdown-menu, .tooltip, .popover")) return;
    ["left", "right"].forEach((side) => {
      if (isExpanded(side)) setPane(side, false);
    });
  });

  // Both open and the room runs out with no click involved (a window narrowed, a phone turned): the right one closes.
  function closeCrowdedPane() {
    if (isExpanded("left") && isExpanded("right") && tooCrowded()) setPane("right", false);
  }
  drawerQuery.addEventListener?.("change", closeCrowdedPane);
  if (typeof ResizeObserver !== "undefined") {
    const main = root.querySelector(".workbench-main");
    if (main) new ResizeObserver(closeCrowdedPane).observe(main);
  }

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
