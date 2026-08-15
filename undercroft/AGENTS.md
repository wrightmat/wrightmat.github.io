# Agent Guidelines for Project: Undercroft

## Project Overview
- Undercroft is a suite of TTRPG tools, each living in its own subfolder under this directory with the same shape: `index.html` (entry point), `js/` (vanilla ES modules — page orchestration, editors, data access, utilities), `css/styles.css` (tool-specific rules Bootstrap can't express, kept minimal). The suite's shared layer lives in `common/` (`js/lib/` for cross-tool utilities, `data/` for the kind registry and shared content, `css/shell.css` for shared layout).
- Built tools today: Workbench (character sheets + the live Play view), Loom (the generic Library/System editor, and where external content gets imported via mappings), Crucible, Forge, Sanctum, Vault (generators), Orrery (map builder), Press (print/export), Repository (campaign journal). See `undercroft/README.md` for what each one does and how they share accounts, content, and campaigns — that's the up-to-date suite reference, not this file.
- Workbench's own entry point is a single unified page with a Template/Play/Edit view switcher (`js/pages/workbench.js` orchestrates; `js/pages/workbench-template-view.js`/`workbench-character-view.js` hold each view's logic). System authoring lives in Loom, not Workbench.
- The "admin" tool was retired. Account settings and per-user owned-content browsing now live at the flat page `common/account.html` (+ `common/account.js`), reachable via "Account Settings" in the merged signed-in menu (`common/js/lib/auth-ui.js`) rather than the cross-tool switcher — it isn't a distinct tool. Suite-wide data administration (user tiers, Campaign Groups, cross-owner Library management/sharing) lives in Loom, tier-gated per tab (GM tier and up).
- The 'server' directory hosts the shared Python server used by the whole suite.

## Core Principles
1. **No Redundancy** – Extend or generalise existing behaviour instead of duplicating functions or styles.
2. **KISS (Keep It Simple, Stupid)** – Choose the simplest implementation that satisfies requirements; avoid speculative abstractions.
3. **Vanilla-First UI** – Stick to plain JavaScript and DOM APIs. SortableJS is the sole approved helper for drag-and-drop interactions, and Toast UI Editor for rich text.
4. **Bootstrap via CDN** – Use Bootstrap 5 utilities and components loaded from a CDN. Keep custom CSS minimal, centralised in `css/styles.css`, and lean on Bootstrap classes whenever possible.
5. **Consistent Layout** – Maintain the three-pane layout (left tools, center canvas, right utilities) with collapsible panes and a shared app shell.
6. **Match Existing Precedent** – Before adding new UI or architecture, name the nearest existing precedent and confirm the new work matches its *placement*, not just its shape (e.g. a kind-specific editor belongs on its own tab, never bolted onto Loom's kind-agnostic Library tab). If something must genuinely diverge from precedent, state why explicitly rather than burying the exception in the implementation.

## Authoring Guidelines
- Compose JavaScript as ES modules with explicit imports/exports. Share cross-editor utilities through `js/lib` (create the folder if needed).
- When creating functions, ensure that names don't conflict (avoid 'function' has already been declared errors). If functions names are similar, then first ensure that no duplication of functionality is created - reuse functions when possible).
- Wrap each page module in an IIFE (`(() => { /* page code */ })();`) so a double-evaluated script doesn't clash on top-level `const` declarations. Run `scripts/check-modules.mjs` before committing changes to Workbench editors — it catches duplicate-identifier regressions like this across shared libraries and page entry points.
- When updating HTML, ensure assets are referenced relative to this directory so the Python server can host them without extra configuration.
- Keep documentation current. Any workflow or data shape changes must be reflected in the relevant Markdown files alongside code updates.
- CSS additions must include a rationale in the PR summary when Bootstrap utilities are insufficient.

## Testing & Validation
- Run any available automated tests when modifying code. For UI-only changes without tests, manually exercise the affected pages (Template Editor, System Editor, Character page) and describe the steps taken.
- After editing shared markup (toolbars, collapsible sections, nav-tabs), verify in a real browser — a missing `.collapsible-toggle` class or wrong data attribute produces no build error, just a chevron that silently never rotates.

These rules apply to every file within the `undercroft` directory and its subdirectories.
