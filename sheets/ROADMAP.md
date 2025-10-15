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
1. **Schema tools**
   - Expand the system editor to manage nested objects, lists, enums, and validation rules.
   - Support reusable fragments (e.g., spell lists) and metadata references.
2. **Template language revamp**
   - Formalize template JSON structure with layout primitives (rows, columns, tabs, repeaters).
   - Document formula syntax and implement a deterministic evaluation engine with dependency tracking.
3. **Character runtime**
   - Implement reactive data binding so character views update when underlying data changes.
   - Add undo/redo history and import/export flows.

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
- ✅ Audit `web-server.py` to design the modular host interface (see [`docs/epic1-server-modernization.md`](docs/epic1-server-modernization.md)).
- ⬜ Inventory existing JSON schemas/templates/characters to determine migration steps.
- ⬜ Draft Tailwind adoption plan (build process, class mapping, and removal of legacy CSS).
- ⬜ Create issues/tasks per epic in your tracking tool of choice.

