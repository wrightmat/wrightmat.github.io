import { initThemeControls, loadThemePacks, wireThemePackOptions } from "./theme.js";
import { initPaneToggles, collapsePane, expandPane } from "./panes.js";
import { StatusManager } from "./status.js";
import { UndoRedoStack } from "./undo-stack.js";
import { KeyboardShortcuts } from "./keyboard.js";
import { attachHoverDropdown } from "./dom.js";
import { initSuiteSearch } from "./suite-search.js";
import { initTooltip } from "./tooltips.js";

// `icon` is an Iconify `tabler:*` id — same convention used everywhere else
// across every tool page (`<span class="iconify" data-icon="tabler:...">`).
// `built` distinguishes real, navigable tools from ones that only exist as
// a name/spec so far — kept explicit here rather than inferred from
// whether resolveToolHref happens to return a real path, so adding a new
// tool to the roadmap doesn't silently produce a dead link.
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
    summary: "Wiki-style campaign journal",
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
  // Icon-only until shell.css's container query reveals it (see
  // .workbench-header-middle) — the toggle's own aria-label already
  // carries this same text for assistive tech, so display:none (not
  // visually-hidden) is correct here, unlike icon buttons with no other
  // label source.
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

  attachHoverDropdown(dropdown, toggle);
}

// One pane-toggle button — a fourth, header-only button shape distinct from
// ui-components.js's "compact"/"toolbar" kinds: default (non-btn-sm, non-p-2)
// Bootstrap button sizing, a `fs-5` icon, and a visually-hidden label.
// initPaneToggles (panes.js) owns the pressed/unpressed VISUAL state
// (solid vs. outline button, via updateToggleAppearance) — a real hover
// tooltip is still needed on top of that, same as every other icon-only
// button in the suite; that's a different concern (what does clicking do)
// from a pressed-state indicator (what's it doing right now). Used only
// here, twice per page — not worth generalizing into the shared icon-button
// factory for a shape that appears nowhere else in the suite.
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

// `ariaLabel` and `hiddenLabelText` are deliberately different strings in
// the original markup this replaces — e.g. aria-label="Use light theme" (an
// action) vs. the visually-hidden span's "Light theme" (a label) — kept
// distinct here rather than collapsed into one shared string.
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
// pack's own accent color, so the list previews the palette without
// loading each theme's CSS) plus its label. Styled as a real Bootstrap
// dropdown-item so its own .active state (toggled by theme.js's
// wireThemePackOptions) gets Bootstrap's native highlighted-item look for
// free, same as the tool-switcher's own dropdown items elsewhere in this
// file.
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

// Replaces the old flat 3-button light/system/dark group with one icon
// trigger — folds BOTH axes (mode and palette, see common/js/lib/theme.js)
// into a single dropdown, so this control needs no separate mobile
// compaction the way the header's other controls do: it's already one
// small button at every viewport width. Mode row is built eagerly (only
// ever 3 known, hardcoded options); the palette list below the divider is
// populated once loadThemePacks() resolves — async, since it's a fetch of
// common/data/theme-packs.json — via theme.js's own wireThemePackOptions
// (click handling + active-state bookkeeping lives there, not here, same
// split as initThemeControls/[data-theme-option] for the mode row).
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

  attachHoverDropdown(dropdown, toggle);
  return dropdown;
}

// Builds the entire <header> — pane toggles, tool-switcher mount, auth
// control mount, theme toggle group — replacing what used to be ~47 lines of
// byte-identical hand-copied markup duplicated across every tool's own
// index.html. Purely additive: only runs when a page opts in with a
// `<div data-app-shell-header></div>` mount point — every page in the suite
// has that mount today (no page carries its own literal <header> markup any
// more), but the function still just no-ops safely on one that doesn't.
// Deliberately NOT touching the theme-flash-prevention inline <script> or
// the CDN <link>/<script> tags in each page's own <head> — both must
// run/load synchronously before first paint, which building them here
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
  middle.className = "workbench-header-middle d-flex align-items-center gap-3 w-100";

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

  // The suite-wide header search — sits in the space between the tool
  // switcher/Home link (leftGroup) and the auth/theme controls (rightGroup),
  // which is otherwise just empty flex-grow room. flex-grow-1 + max-width
  // keeps it a sensible search-box width rather than stretching edge to
  // edge on a wide viewport; rightGroup's own ms-auto still applies (it
  // still wins the remaining space once this box hits its max-width).
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

  // docs.html is the one page with no right pane at all — pass
  // rightPaneLabel: null there to omit this button entirely, same as its
  // hand-written markup already does today.
  if (rightPaneLabel) {
    rightGroup.appendChild(buildPaneToggleButton("right", rightPaneLabel));
  }

  middle.append(leftGroup, searchMount, rightGroup);
  grid.append(middle, document.createElement("div"));
  header.appendChild(grid);

  mount.replaceWith(header);
  initSuiteSearch({ container: searchMount });
  return header;
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
  // Below md, both panes start collapsed regardless of what each tool
  // requested — a phone viewport doesn't have room for an 18-20rem pane
  // plus content. This only overrides the INITIAL load state; the existing
  // header pane-toggle buttons (initPaneToggles, unchanged) still open/close
  // them exactly as before. Desktop viewports never hit this branch, so
  // their behavior is unchanged.
  const isNarrowViewport = window.matchMedia("(max-width: 767.98px)").matches;
  const effectiveInitial = isNarrowViewport ? "collapsed" : initial;
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
  return { aside, size, effectiveInitial };
}

// Keeps the header's own left/right spacer-grid columns (which visually
// align with the pane widths below them) in sync with whether that pane is
// ACTUALLY expanded or collapsed — not just a static viewport breakpoint.
// A collapsed pane is 0-width, so its header spacer should be too (`auto`,
// not a literal 0 — a settings-slot button, when present, still needs to
// size to its own content rather than being clipped). Called once at build
// time for each pane's initial state, then again from initPaneToggles's
// onChange every time a user toggles a pane afterward, at ANY viewport
// width — this is what fixes the header overlapping/squeezing that showed
// up on a narrowed desktop window even with both panes collapsed, since
// previously the header reserved a full 18-20rem for a collapsed pane
// regardless of viewport.
function syncHeaderPaneSpacerWidth(headerEl, side, expanded, size) {
  if (!headerEl) {
    return;
  }
  const configuredWidth = size === "lg" ? "20rem" : "18rem";
  headerEl.style.setProperty(`--undercroft-pane-${side}-width`, expanded ? configuredWidth : "auto");
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
// Caution for any code that reads a header-internal element (a pane-toggle
// button, a settings-slot mount): querying it via a module-top-level `const`
// only works if that line runs AFTER this function already has — several
// real bugs (a `const` capturing `null` before the header existed yet) came
// from exactly this ordering mistake. Prefer a live `document.querySelector`
// at the point of use, or place the eager query provably after this call in
// the same synchronous script.
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
  const headerEl = buildAppShellHeader(root, { leftPaneLabel, rightPaneLabel, settingsSlotAttr });
  if (leftPane) {
    const built = buildPaneShell(root.querySelector('[data-pane-content="left"]'), { side: "left", ...leftPane });
    if (built) {
      syncHeaderPaneSpacerWidth(headerEl, "left", built.effectiveInitial !== "collapsed", built.size);
    }
  }
  if (rightPane) {
    const built = buildPaneShell(root.querySelector('[data-pane-content="right"]'), { side: "right", ...rightPane });
    if (built) {
      syncHeaderPaneSpacerWidth(headerEl, "right", built.effectiveInitial !== "collapsed", built.size);
    }
  }
  const statusRoot = root.querySelector("[data-status-root]") || document.createElement("div");
  const status = new StatusManager(statusRoot);
  if (!statusRoot.parentElement) {
    document.body.appendChild(statusRoot);
  }

  initThemeControls(root);

  // Below DUAL_PANE_MIN_WIDTH_REM, .workbench-header-middle doesn't have
  // room for both panes' spacer columns AND its own content at once — a
  // FIXED viewport width (what buildPaneShell's own load-time check below
  // md still uses, unchanged, as a coarser phone-territory floor) can't
  // coordinate with that: at a typical desktop width with both panes
  // expanded, middle was already having to wrap (see shell.css's flex-wrap
  // comment) long before the viewport ever narrowed down to 767.98px.
  // Can't fix that with CSS alone either — panes live outside middle's own
  // DOM subtree entirely (siblings at the page level, not descendants),
  // and a @container query can only style a container's OWN descendants.
  //
  // Rule, below the threshold: at most ONE pane may be expanded at a time
  // — not a bidirectional auto-collapse/auto-expand system keyed to width
  // (an earlier version of this was exactly that, with a 4-threshold
  // hysteresis dance to avoid oscillating; the real problem it ran into
  // was that its own width-based logic would immediately re-collapse a
  // pane the instant after a user manually clicked to expand it, since
  // expanding it shrank middle right back below that pane's own collapse
  // threshold — the user could never actually force one open when they
  // needed it below that width). Instead: a manual click ALWAYS wins,
  // immediately closing the sibling pane to make room rather than being
  // fought by width logic afterward (below, in initPaneToggles's own
  // onChange). The ResizeObserver further down only ever has to step in
  // for the case a click can't cover — both panes already expanded and the
  // window narrows past the threshold with no click involved.
  // Measured: 475px ÷ 16 — the point where fully-compact header content
  // (every stage in shell.css's @container rules already collapsed)
  // exactly fills middle with no room left, was 448px/28rem.
  const DUAL_PANE_MIN_WIDTH_REM = 29.6875;

  function remToPx(remValue) {
    const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return remValue * rootFontSizePx;
  }

  function middleWidth() {
    return root.querySelector(".workbench-header-middle")?.getBoundingClientRect().width ?? Infinity;
  }

  function setPane(side, expand) {
    const paneEl = root.querySelector(`[data-pane="${side}"]`);
    if (!paneEl) return;
    const toggleEl = root.querySelector(`[data-pane-toggle="${side}"]`);
    if (expand) {
      expandPane(paneEl, toggleEl);
    } else {
      collapsePane(paneEl, toggleEl);
    }
    const pane = side === "left" ? leftPane : rightPane;
    syncHeaderPaneSpacerWidth(headerEl, side, expand, pane?.size);
  }

  initPaneToggles(root, {
    onChange: ({ key, state }) => {
      const size = key === "left" ? leftPane?.size : rightPane?.size;
      syncHeaderPaneSpacerWidth(headerEl, key, state === "expanded", size);
      // The click that just happened already applied its own pane's new
      // width to middle's grid track (syncHeaderPaneSpacerWidth above runs
      // synchronously) — reading middleWidth() here sees that.
      if (state !== "expanded" || middleWidth() >= remToPx(DUAL_PANE_MIN_WIDTH_REM)) {
        return;
      }
      const otherSide = key === "left" ? "right" : "left";
      const otherPaneEl = root.querySelector(`[data-pane="${otherSide}"]`);
      if (otherPaneEl && otherPaneEl.dataset.state !== "collapsed") {
        setPane(otherSide, false);
      }
    },
  });
  initToolNavigation(root);

  // Fallback for when both panes are already expanded and the window
  // narrows past the threshold with no click involved — the onChange path
  // above only fires on a click, so this is the only way that specific
  // case gets caught. No hysteresis/re-expand-on-widen here on purpose:
  // per explicit direction, a pane closed by this system only ever reopens
  // from an actual user click on its own toggle button (which panes.js's
  // own togglePane already handles unconditionally — clicking always
  // works, regardless of width) — never automatically from a resize.
  if (typeof ResizeObserver !== "undefined") {
    const middle = root.querySelector(".workbench-header-middle");
    if (middle) {
      new ResizeObserver(() => {
        if (middleWidth() >= remToPx(DUAL_PANE_MIN_WIDTH_REM)) {
          return;
        }
        const rightPaneEl = root.querySelector('[data-pane="right"]');
        const leftPaneEl = root.querySelector('[data-pane="left"]');
        if (rightPaneEl?.dataset.state !== "collapsed" && leftPaneEl?.dataset.state !== "collapsed") {
          // Both open: collapse right first. This resize's own effect
          // (right's spacer column shrinking) re-triggers this same
          // observer, so the branch below picks up from there — no manual
          // re-check needed here.
          setPane("right", false);
        } else if (rightPaneEl?.dataset.state === "collapsed" && leftPaneEl?.dataset.state !== "collapsed") {
          // Right alone wasn't enough — middle is still under the
          // threshold even with right already collapsed, so left has to
          // give up its own space too (same threshold, same as collapsing
          // right did — not a separate/second number).
          setPane("left", false);
        }
      }).observe(middle);
    }
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
