# Agent Guidelines for Project: Undercroft

## Project Overview
- The 'workbench' directory hosts the Universal TTRPG Character Sheet prototype (Undercroft: Workbench). Key folders:
  - Entry points: `index.html`, `template.html`, `system.html`, `character.html`.
  - `js/`: vanilla JavaScript ES modules (no frameworks) for runtime, editors, data access, and utilities.
  - `css/`: contains a single stylesheet (`styles.css`) for any custom rules that Bootstrap cannot express (kept to bare minimum).
  - `data/`: schemas, templates, and characters data consumed by the editors.
  - `docs/`, `ROADMAP.md`, and `COLLABORATION.md`: planning and collaboration artifacts.
- The 'server' directory hosts the shared Python server used for all projects, including this one.
- Other directories to be added later as additional tools are developed under this suite.

## Core Principles
1. **No Redundancy** – Extend or generalize existing behavior instead of duplicating functions or styles. Create re-usable libraries rather than duplicating functions or code across multiple pages.
2. **KISS (Keep It Simple, Stupid)** – Choose the simplest implementation that satisfies requirements; avoid speculative abstractions.
3. **Vanilla-First UI** – Stick to plain JavaScript and DOM APIs (without Node). SortableJS is the sole approved helper for drag-and-drop interactions, and Toast UI Editor for rich text.
4. **Bootstrap via CDN** – Use Bootstrap 5 utilities and components loaded from a CDN. Keep custom CSS minimal, centralised in `css/styles.css`, and lean on Bootstrap classes whenever possible.
5. **Consistent Layout** – Maintain the three-pane layout (left tools, center canvas, right utilities) with collapsible panes and a shared app shell.

## Authoring Guidelines
- Compose JavaScript as ES modules with explicit imports/exports. Share cross-editor utilities through `js/lib` (create the folder if needed).
- When updating HTML, ensure assets are referenced relative to this directory so the Python server can host them without extra configuration.
- Keep documentation current. Any workflow or data shape changes must be reflected in the relevant Markdown files alongside code updates.
- CSS additions must include a rationale in the PR summary when Bootstrap utilities are insufficient.

## Testing & Validation
- Run any available automated tests when modifying code. For UI-only changes without tests, manually exercise the affected pages (Template Editor, System Editor, Character page) and describe the steps taken.

These rules apply to every file within the `undercroft` directory and its subdirectories.
