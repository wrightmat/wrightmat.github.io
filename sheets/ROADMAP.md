# Universal TTRPG Sheets – Roadmap

## Vision
Build a modular three-layer platform (Schema → Template → Character) that lets tabletop RPG groups author systems, design sheets, and play directly in the browser with offline-friendly JSON storage and a lightweight Python server.

## Guiding Principles
- **Modularity:** Keep schema, template, and character tooling isolated yet interoperable through shared contracts.
- **Simplicity:** Favor vanilla JavaScript modules and minimal build tooling.
- **Flexibility:** Support arbitrary RPG systems by driving UI and validation from JSON definitions.
- **User Experience:** Provide responsive, accessible editors with live preview, drag-and-drop, undo/redo, and formula support.
- **Progressive Enhancement:** Ensure the core workflow functions offline with graceful degradation of optional features.

## Roadmap Overview
The work is grouped into four epics. Each epic can be developed in parallel by separate branches/PRs but should generally be approached in order to reduce rework.

### Epic 1 – Platform Infrastructure
1. **Server modernization**
   - Refactor `web-server.py` into a reusable static/JSON host with pluggable mounts.
   - Add configuration for serving other repository projects alongside the sheets app.
   - Implement role upgrade endpoints (free → player → GM → creator → admin) and persistence.
2. **Storage abstraction**
   - Define a shared storage interface that supports local (browser) persistence, JSON file buckets, and future APIs.
   - Migrate current sheet CRUD logic to the abstraction.
3. **Authentication & tier enforcement**
   - Replace the hard-coded `master/creator` checks so feature gates respect user tiers.
   - Provide a migration script to upgrade existing sample data.

### Epic 2 – Data Layer & Authoring Capabilities
1. **Schema tools** — ✅ Nested editing, fragments, and metadata-driven option catalogs now live in the system editor.
2. **Template language revamp** — ✅ Layout primitives (stack, row, tabs, repeater) power the new template editor and deterministic formula evaluation.
3. **Character runtime** — ✅ Reactive binding, undo/redo history, and JSON import/export are available in the character page.

### Epic 3 – UI & Styling Refresh
1. **Adopt Tailwind CSS** (recommended)
   - Configure Tailwind build pipeline (CLI or JIT) while maintaining vanilla JS.
   - Replace bespoke CSS with Tailwind utility classes and component patterns.
2. **Component architecture**
   - Break editors into reusable view components (panels, inspector, element palette).
   - Ensure responsive layouts and accessible interactions.
3. **Design system assets**
   - Establish typography, color palette, and iconography guidelines.
   - Provide shared Tailwind presets for dark/light themes.

### Epic 4 – Quality, Packaging & Deployment
1. **Testing**
   - Introduce unit tests for rendering engine, formula evaluation, and data validation.
   - Add end-to-end tests for core authoring flows.
2. **Tooling & DX**
   - Set up linting/formatting for Python and JavaScript.
   - Provide scripts for running the server, building assets, and packaging sample data.
3. **Documentation**
   - Publish setup guides, contribution instructions, and user documentation in `/docs`.
   - Maintain changelog and roadmap updates.

## Immediate Next Steps
- ✅ Ship the modular server implementation and configuration workflow (see [`docs/epic1-server-modernization.md`](docs/epic1-server-modernization.md)).
- ⬜ Smoke-test the new server against Sheets editors and Codex static pages, filing follow-up bugs.
- ✅ Inventory existing JSON schemas/templates/characters to determine migration steps.
- ✅ Draft Tailwind adoption plan (see [`docs/epic3-ui-plan.md`](docs/epic3-ui-plan.md)).
- ⬜ Create issues/tasks per epic in your tracking tool of choice.

