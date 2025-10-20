# Collaboration & Workflow Guide

This guide explains how we can collaborate on Project Undercroft: Workbench, how work items are tracked, and what to expect from each development cycle.

## Roles & Responsibilities

- **You (project owner)**
  - Define priorities and approve roadmap updates.
  - Review pull requests that summarize the changes I make.
  - Provide feedback, new requirements, or clarifications.
- **Me (AI collaborator)**
  - Help refine requirements into actionable tasks.
  - Implement code and documentation changes in small, reviewable chunks.
  - Run tests or manual checks when applicable and report the results.
  - Prepare a pull request summary after each committed change set.

## Tracking Work

1. **Roadmap as the source of truth** – The `workbench/ROADMAP.md` document captures high-level epics and near-term tasks. We can expand it with status markers (`✅`, `🚧`, `📝`) or link out to deeper specifications as work progresses.
2. **Task breakdown** – When you request new work, we can reference the roadmap section and agree on a concrete deliverable (e.g., “Bootstrap base layout setup”). I will restate the scope before coding to ensure alignment.
3. **Iteration cadence** – Each interaction should produce either:
   - A documented plan/spec update, or
   - A committed code/documentation change accompanied by tests/checks when feasible.

## Development Workflow

1. **Plan** – We discuss the desired change. If it’s sizeable, I draft a plan or checklist and you confirm before implementation.
2. **Implement** – I modify the necessary files, respecting any coding guidelines. For significant UI updates, I’ll capture screenshots when tools are available.
3. **Test & Report** – I run relevant commands (unit tests, linters, manual scripts) and note the results in the final summary.
4. **Commit & PR** – I commit the changes directly in this environment and generate a PR summary using the `make_pr` tool so you have a concise record.
5. **Review & Iterate** – You review the summary and diff, provide feedback, and I follow up with additional commits or revisions as needed.

### Implementation Notes

- When adding or refactoring helper functions in the page scripts (for example `js/pages/template.js`), run a quick `rg function-name js/pages/template.js` search before introducing a new identifier. ES module parsing halts on duplicate `function` declarations, which prevents the editors from loading. Keeping names unique avoids the "Identifier has already been declared" console errors we've encountered.
- Prefer descriptive prefixes (e.g., `componentHas...`, `renderSelectGroup...`) for new helpers so their intent is obvious and so they are unlikely to collide with other utilities. Document renamed helpers in the PR summary when you consolidate or deduplicate them.

## Task Ownership

- I manage the in-session implementation details and keep the roadmap updated with progress notes when tasks change state.
- You maintain the overall backlog/prioritization. If you track items elsewhere (issues, personal notes), feel free to share; I can mirror them into the roadmap for continuity.

## Getting Started

1. Identify the first roadmap task you want tackled (e.g., server generalization, Bootstrap integration).
2. Share any constraints or success criteria.
3. I’ll confirm the task breakdown and begin the workflow above.

By following this loop, we maintain transparency on what’s being built, how it’s validated, and what’s next on deck.

## Redundancy Reduction Plan (Draft)

### 1. Consolidate Shared Layout Markup
- Files affected: `workbench/*.html` (`index.html`, `system.html`, `template.html`, `character.html`, `admin.html`, `docs/index.html`).
- Action: Extract the repeated `<header>` structure, sidebar scaffolding, and bootstrap `<script>` / `<link>` blocks into reusable partials.
- Approach: Introduce a lightweight templating step (Node-based build script under `workbench/scripts/`) that hydrates a `layout/base.html` with page-specific content sections, generating static HTML for deployment.
- Benefit: Single source of truth for header/toolbar/aside markup and theme bootstrap script, preventing drift when modifying navigation or accessibility hooks.

### 2. Centralise Client Bootstrap Logic
- Files affected: `js/pages/*.js` modules for system, template, character, admin, docs, and index pages.
- Action: Create a shared `initWorkbenchPage` helper in `js/lib/app-shell.js` (or sibling module) that wires up `initAppShell`, `initAuthControls`, `initTierVisibility`, `initHelpSystem`, and the loading overlay with consistent status messaging.
- Approach: Refactor page modules to pass configuration (page id, tier requirements, loading copy) into the helper and move duplicated promise wiring (`pageLoading.hold()`, `await helpPromise`, `DataManager` instantiation) into the shared routine.
- Benefit: Eliminates dozens of lines of duplicated setup per page, simplifies future adjustments (e.g., overlay timing fixes) to a single location.

### 3. Unify Loading Overlay Behaviour
- Files affected: `js/lib/loading.js`, `js/pages/*.js`, and page templates.
- Action: Ensure the overlay DOM exists before heavy modules run by moving markup into the base layout (see item 1) and exposing a synchronous `showImmediately` option in the shared bootstrap helper.
- Approach: Inline a minimal overlay stub in the generated HTML, call `hold()` during the earliest inline script, and release only after page-specific modules finish asynchronous work.
- Benefit: Guarantees the overlay is visible before network-bound initialization begins, addressing the delayed appearance reported on the System editor.

### 4. Deduplicate Theme Preference Bootstrapping
- Files affected: `workbench/*.html`, `js/lib/theme.js`.
- Action: Replace repeated inline scripts that read `undercroft.workbench.theme` with a single inline loader sourced from `js/lib/theme.js` (packaged/minified during the build step) or an auto-generated `<script>` include.
- Approach: Export a static bootstrap snippet from the build script that injects the theme preference before paint and reuse it across all pages.
- Benefit: One canonical implementation of theme application logic; future changes (e.g., additional themes) require editing only one module.

### 5. Standardise Sidebar Navigation and Access Gating
- Files affected: `index.html`, `system.html`, `template.html`, `character.html`, `admin.html`, `js/lib/access.js`.
- Action: Define navigation/menu structures in a shared JSON or JS configuration and render them via the templating/build process, including tier badges and `data-access` attributes.
- Approach: Move tier metadata (`data-requires-tier`, `data-access-behavior`) into the config and generate matching markup plus localized strings during build.
- Benefit: Keeps navigation consistent, reduces copy-paste errors, and makes it easier to adjust gate messaging across tools.

### 6. Align Documentation Site Shell with Workbench Layout
- Files affected: `docs/index.html`, `docs/*.md`, `js/pages/docs.js`.
- Action: Apply the same base layout and bootstrap helper to the documentation site so its header, theme controls, and overlay reuse the shared assets.
- Approach: Include docs-specific sections (table of contents, content frame) as slots in the layout template; rely on the shared bootstrap to hydrate help/tooltips.
- Benefit: Removes bespoke header/footer implementations in the docs, ensuring design parity and reducing maintenance overhead.

### 7. Catalogue Additional Duplication During Refactor
- Files affected: `js/pages/system.js`, `template.js`, `character.js`.
- Action: While centralising bootstrap logic, catalogue other repeated helper patterns (e.g., `initializeBuiltins`, JSON preview wiring) and schedule follow-up refactors to expose them via `js/lib/` modules once the layout consolidation is complete.
- Approach: Document findings in `ROADMAP.md` after each phase to maintain visibility into remaining clean-up tasks.
- Benefit: Ensures ongoing reduction of redundancy beyond the initial layout/loader focus and keeps planning artifacts up to date.

