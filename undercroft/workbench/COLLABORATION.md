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

## Redundancy Reduction Toolkit

The planned clean-up is now in place. Here is how to work with the shared pieces going forward:

### Template-driven HTML
- Author the outer shell for each page in `templates/pages/`. Reusable fragments (head, header, quick links, inline loader, script bundle) live under `templates/partials/`.
- Update `templates/navigation.json` when quick-link destinations or tier requirements change. The build step hydrates every page with consistent navigation badges.
- Run `python scripts/render_templates.py` from the `workbench/` folder whenever you change a template or partial. The script regenerates the deployable HTML files with the latest shared chrome and asset paths.

### `bootstrapWorkbenchPage`
- `js/lib/workbench-page.js` exposes `bootstrapWorkbenchPage(options)`. It wraps the common page plumbing: loading overlay, app shell, data manager, auth UI, tier gate, and help system.
- Each page passes its namespace, loading copy, undo handlers (where applicable), and tier gate metadata. The helper returns `{ pageLoading, releaseStartup, status, dataManager, auth, helpReady, gate, undoStack, undo, redo }` so editors can focus on their domain logic.
- Skip unused services by setting `useDataManager`, `useAuth`, or `useHelp` to `false` in the options object. The documentation site, for example, only uses the overlay.

### Shared Theme Bootstrap
- `js/lib/theme-bootstrap.js` contains the canonical inline theme loader. Templates pull it in automatically, so there is no longer a need to duplicate the preference script inside each page.

### Navigation Consistency
- The quick-link rail is generated from `templates/navigation.json`. Adjust labels, hrefs, or tier requirements there; rerun the template renderer to propagate updates across home, system, template, character, admin, and docs.

### Follow-up Opportunities
- The bootstrap helper highlights remaining duplication (e.g., editor-specific initialization pipelines). Capture any reusable patterns you spot while working in `ROADMAP.md` so we can plan additional clean-up passes.

