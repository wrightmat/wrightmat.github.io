# Agent Guidelines for `sheets`

## Project Overview
- The `sheets` directory hosts the reboot of the Universal TTRPG Sheets prototype. Key folders:
  - Entry points: `index.html`, `template-editor.html`, `system-editor.html`, `character.html`.
  - `js/`: vanilla JavaScript ES modules (no frameworks) for runtime, editors, data access, and utilities.
  - `css/`: contains a single stylesheet (`styles.css`) for any custom rules that Tailwind cannot express.
  - `data/`: sample schemas, templates, and characters consumed by the editors.
  - `docs/`, `ROADMAP.md`, and `COLLABORATION.md`: planning and collaboration artifacts.

## Core Principles
1. **No Redundancy** – Extend or generalise existing behaviour instead of duplicating functions or styles.
2. **KISS (Keep It Simple, Stupid)** – Choose the simplest implementation that satisfies requirements; avoid speculative abstractions.
3. **Vanilla-First UI** – Stick to plain JavaScript and DOM APIs. SortableJS is the sole approved helper for drag-and-drop interactions.
4. **Tailwind via CDN** – Use Tailwind utility classes loaded from a CDN. Keep custom CSS minimal, centralised in `css/styles.css`, and prefer Tailwind utilities whenever possible.
5. **Consistent Layout** – Maintain the three-pane layout (left tools, centre canvas, right utilities) with collapsible panes and a shared app shell.

## Authoring Guidelines
- Compose JavaScript as ES modules with explicit imports/exports. Share cross-editor utilities through `js/lib` (create the folder if needed).
- When updating HTML, ensure assets are referenced relative to this directory so the Python server can host them without extra configuration.
- Keep documentation current. Any workflow or data shape changes must be reflected in the relevant Markdown files alongside code updates.
- CSS additions must include a rationale in the PR summary when Tailwind utilities are insufficient.

## Testing & Validation
- Run any available automated tests when modifying code. For UI-only changes without tests, manually exercise the affected pages (Template Editor, System Editor, Character page) and describe the steps taken.

These rules apply to every file within the `sheets` directory and its subdirectories.
