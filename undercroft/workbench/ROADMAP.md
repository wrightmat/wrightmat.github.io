# Project Undercroft: Workbench - Universal TTRPG Sheets – Roadmap

## Vision
Build a Universal TTRPG Character Sheet platform with a lightweight, maintainable stack where schemas, templates, and characters flow through a unified authoring and play experience that runs entirely in the browser with optional server persistence.

## Guiding Principles
- **Modularity:** Keep schema, template, and character tooling loosely coupled via JSON contracts.
- **Simplicity:** Use vanilla JavaScript and HTML with Bootstrap 5 delivered from a CDN—no bundlers or npm steps.
- **Flexibility:** Support any RPG system through data-driven configuration and drag-and-drop layout composition.
- **User Experience:** Provide responsive, accessible editors with undo/redo, live preview, and reusable components.
- **Progressive Enhancement:** Ensure anonymous users can load and edit content locally, while registered tiers unlock persistence.

## Data Model
- Systems - Define game system rules and data structures (D&D 5e, Blades in the Dark, etc.)
  - JSON files defining field types, validation rules, and categories
  - Example: "strength": { "type": "integer", "minimum": 3, "maximum": 18 }
- Templates - Define UI layout and field arrangement for character sheets
  - Visual composition of form elements, containers, and layouts
  - References schema fields via scope paths like `@abilities.strength`; formulas always resolve values through the `@` syntax that mirrors the keys defined within the active system.
  - May include formulas that reference system elements as well as math operators and functions
- Characters - Store actual character data instances
  - JSON objects containing values that conform to their schema
  - Example: { "name": "Elandra", "abilities": { "strength": 8 } }

## Core Components
- Data Layer:
  - DataManager - Central data store, handles all file operations and server communication functions. All edits begin as local-only changes and can be promoted to the server whenever a logged-in user has permission to modify the resource, ensuring anonymous sessions remain functional offline.
  - FormulaEngine - Evaluates calculated fields (ability modifiers, derived stats)
  - RenderingEngine:
    - Converts template definitions into interactive HTML
    - Supports rich form elements: inputs, tracks, toggles, arrays, images (all component types below)
    - Handles layout containers: groups, columns, tabs
    - Render both read-only (template editor) and interactive (character sheet) using as much of the same code as possible
  - Other managers: Undo/Redo, Keyboard Shortcuts
- User Interface:
  - index.html - Landing page with links to other pages, ability to log in, see and share characters, etc. Include three-part theme toggle for dark mode, light mode, and system default (system default selected by default).
  - system.html - Visual system editor with drag-and-drop reordering of components, and ability to define strings, enums/arrays, nested elements, etc. (everything needed to define all aspects of a TTRPG system).
  - template.html - Visual template builder with drag-and-drop editing of all components based on a defined system (supporting comprehensive form elements that cover all TTRPG needs):
    - Basic Inputs: text, number, checkbox, select, textarea
    - Advanced Widgets: LinearTrack (progress bars), CircularTrack (clocks), MultiStateToggle (pills/buttons for various things like conditions)
    - Layout Containers: Group/Container (fieldsets, columns, grids), Tabs
    - Complex Data: Arrays with multiple display styles (cards, compact lists, tables)
    - Media: Image upload with custom styling and shape options
  - character.html - Main character sheet interface for players. Ability to both view and edit a character based on a defined system and template.
  - SortableJS integration for intuitive element reordering. Toast UI for any rich text needs. Consistent UI elements thoughout the tools.

## Epics

### Epic 1 – Backend Stability
1. **Server Smoke Tests**
    - ✅ Verify endpoints for anonymous access, catalog listings, and persistence using the rebooted front-end flows.
2. **Role & Session Hooks**
    - ✅ Document how anonymous/local storage, registered tiers, and future admin endpoints interact so UI states remain aligned.
3. **Data Tooling**
    - ✅ Build DataManager script to handle communication between tools and server, as well as LocalStorage. All data for unregistered users is stored in the browser only, with the option to save to the server later after registration.

### Epic 2 – UI Construction
1. **App Shell & Layout**
   - ✅ Implement the three-pane responsive layout with collapsible sidebars, floating status footer, and theme toggle using Bootstrap utilities. Left and right panes should start collapsed, expand on demand, and collapse independently so the center pane reflows to occupy available space. Build out basic Index/Home page for future links to editors while ensuring the Bootstrap-driven theme toggle handles light, dark, and system modes.
2. **Shared Utilities**
   - ✅ Build reusable vanilla JS helpers for pane toggles, status messages, dropdown population, formula parsing, element rendering, undo/redo, and keyboard shortcuts. Undo/redo stacks should track up to the most recent 100 actions per page (system, template, or character) and persist locally so anonymous sessions retain history within the tab lifecycle.
3. **Drag-and-Drop Canvas**  
   - ✅ Integrate SortableJS for arranging components within system/template editors, ensuring the renderer powers both authoring and runtime views.

### Epic 3 – Authoring Workflows
1. **System Editor**  
   - ⬜ Support nested fields, validation rules, and formulas with clear inspector panels.  
2. **Template Editor**  
   - ⬜ Provide palette components and binding to system-defined fields, leveraging shared renderer primitives.  
3. **Character Experience**  
   - ⬜ Deliver live character sheets with undo/redo, dice roller, session notes, and offline storage for anonymous play.

### Epic 4 – Index Page Expansion
1. **Login/Register System**  
   - ⬜ Build registration page and login modal window so new users can save data to the server.
2. **Sharing Panel**  
   - ⬜ Section to list out owned content (characters primarily, but also owned templates and systems for higher tier users) with the ability to share links with others.
3. **Admin Panel**  
   - ⬜ Section for admins to adjust permissions for users (tier and other details), content (owner and other details), and anything else needed.

### Epic 5 – Quality & Delivery
1. **Testing**
   - ⬜ Add unit tests for data managers, renderer utilities, and formula evaluation.
   - ⬜ Explore lightweight integration tests (e.g., Playwright) once the UI stabilises. Keep unit coverage in simple Python test modules without pulling in additional testing frameworks so the stack stays lightweight.
2. **Tooling & Packaging**  
   - ⬜ Set up linting/formatting for Python and JavaScript.  
   - ⬜ Provide scripts/docs for running the server and syncing sample data.  
3. **Documentation**  
   - ⬜ Expand `/docs` with setup guides, contributor workflows, and user onboarding material.
