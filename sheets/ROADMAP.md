# Universal TTRPG Sheets – Roadmap (Reboot)

## Vision
Rebuild the Universal TTRPG Sheets platform with a lightweight, maintainable stack where schemas, templates, and characters flow through a unified authoring and play experience that runs entirely in the browser with optional server persistence.

## Guiding Principles
- **Modularity:** Keep schema, template, and character tooling loosely coupled via JSON contracts.
- **Simplicity:** Use vanilla JavaScript and HTML with Tailwind utilities delivered from a CDN—no bundlers or npm steps.
- **Flexibility:** Support any RPG system through data-driven configuration and drag-and-drop layout composition.
- **User Experience:** Provide responsive, accessible editors with undo/redo, live preview, and reusable components.
- **Progressive Enhancement:** Ensure anonymous users can load and edit content locally, while registered tiers unlock persistence.

## Restart Strategy
The previous iteration surfaced valuable lessons (server modularity, data abstractions, app-shell requirements) but accumulated complexity in the front-end. The reboot will:
1. **Keep the modernised Python server and storage layer** as the baseline, with configuration pointing at `data/database.sqlite` and JSON buckets under `sheets/data/`.
2. **Archive prior UI experiments** by capturing their takeaways in documentation, then rebuilding the editors with a smaller, utility-first approach.
3. **Codify expectations in documentation** (this roadmap and `AGENTS.md`) so future contributors share the same constraints: vanilla JS, Tailwind via CDN, minimal custom CSS, and SortableJS for drag-and-drop.
4. **Incrementally rebuild features**, validating each layer (system → template → character) before layering advanced tooling.

## Epics

### Epic 0 – Foundation Reset
1. **Documentation Refresh**  
   - ✅ Update `AGENTS.md` with reboot guidance and constraints.  
   - ⬜ Summarise the restart plan and lessons learned in `/docs/reboot-notes.md`.  
2. **Configuration Audit**  
   - ✅ Confirm `server.config.json` points to `data/database.sqlite` and desired mounts.  
   - ⬜ Review sample data for parity with the new editor expectations (IDs, metadata).

### Epic 1 – Backend Stability
1. **Server Smoke Tests**  
   - ⬜ Verify endpoints for anonymous access, catalog listings, and persistence using the rebooted front-end flows.  
2. **Role & Session Hooks**  
   - ⬜ Document how anonymous/local storage, registered tiers, and future admin endpoints interact so UI states remain aligned.  
3. **Data Tooling**  
   - ⬜ Provide lightweight scripts or notes for seeding example systems/templates/characters during development.

### Epic 2 – UI Reconstruction
1. **App Shell & Layout**  
   - ⬜ Implement the three-pane responsive layout with collapsible sidebars, floating status footer, and theme toggle using Tailwind utilities.  
2. **Shared Utilities**  
   - ⬜ Build reusable vanilla JS helpers for pane toggles, status messages, dropdown catalog population, and keyboard shortcuts.  
3. **Drag-and-Drop Canvas**  
   - ⬜ Integrate SortableJS for arranging components within system/template editors, ensuring the renderer powers both authoring and runtime views.

### Epic 3 – Authoring Workflows
1. **System Editor**  
   - ⬜ Support nested fields, fragments, validation rules, and metadata catalogs with clear inspector panels.  
2. **Template Editor**  
   - ⬜ Provide palette components (stacks, rows, tabs, repeaters) and binding to schema fields, leveraging shared renderer primitives.  
3. **Character Experience**  
   - ⬜ Deliver live character sheets with undo/redo, dice roller, session notes, and offline storage for anonymous play.

### Epic 4 – Quality & Delivery
1. **Testing**  
   - ⬜ Add unit tests for data managers, renderer utilities, and formula evaluation.  
   - ⬜ Explore lightweight integration tests (e.g., Playwright) once the UI stabilises.  
2. **Tooling & Packaging**  
   - ⬜ Set up linting/formatting for Python and JavaScript.  
   - ⬜ Provide scripts/docs for running the server and syncing sample data.  
3. **Documentation**  
   - ⬜ Expand `/docs` with setup guides, contributor workflows, and user onboarding material.

## Immediate Next Steps
- ⬜ Draft `/docs/reboot-notes.md` capturing lessons and decisions from the restart.  
- ⬜ Perform a backend smoke test checklist to validate anonymous workflows.  
- ⬜ Define the UI reconstruction task list (wireframes, component inventory) before implementing Epic 2.

