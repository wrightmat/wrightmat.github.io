# Undercroft Workbench Technical Reference

This document describes the moving pieces of the Undercroft Workbench prototype so future contributors can maintain, extend, and troubleshoot the suite. It covers the shared front-end architecture, the three primary tools, the contextual help system, and the supporting Python server stack.

---

## Front-end architecture

### App shell & layout

All pages share a structural shell initialised through `initAppShell`, which wires up theme toggles, pane controls, a status manager, keyboard shortcuts, and a persisted undo/redo stack per namespace.【F:undercroft/workbench/js/lib/app-shell.js†L1-L97】 Each HTML entry point reuses the same three-pane layout (left tools, centre canvas, right utilities) and binds pane toggles via data attributes consumed by the shell utilities.【F:undercroft/workbench/index.html†L48-L141】【F:undercroft/workbench/system.html†L44-L138】 Undo history is stored in `localStorage` namespaced by tool, so reloading restores the latest draft even offline.【F:undercroft/workbench/js/lib/app-shell.js†L33-L76】

### Theme management

Theme controls rely on `initThemeControls`, which reads and persists preferences under `undercroft.workbench.theme`, applies CSS custom properties on both `<html>` and `<body>`, and keeps buttons in sync with `prefers-color-scheme` changes.【F:undercroft/common/js/lib/theme.js†L1-L107】 Every HTML page includes the same bootstrapping script to apply the stored theme before paint, guaranteeing flicker-free transitions.【F:undercroft/workbench/index.html†L4-L42】【F:undercroft/workbench/docs/index.html†L4-L42】

### Data management & offline cache

`DataManager` abstracts REST calls, session persistence, and local caching for characters, templates, systems, and groups.【F:undercroft/workbench/js/lib/data-manager.js†L1-L199】 It normalises tiers, scopes cache entries by the authenticated user, mirrors remote buckets into local storage, and exposes list/save/delete helpers used across tools.【F:undercroft/workbench/js/lib/data-manager.js†L200-L433】 Tier requirements for write operations (`characters`, `templates`, `systems`) are enforced client-side before hitting the API, aligning with server-side checks.【F:undercroft/workbench/js/lib/data-manager.js†L12-L44】

### Access control

Tier gating is handled by `initTierVisibility` and `initTierGate`, which read the current session, hide gated content until permissions resolve, and provide callbacks when users upgrade or downgrade access so pages can reload accordingly.【F:undercroft/workbench/js/lib/access.js†L1-L188】 UI affordances (`data-requires-tier`, `data-access-label`) toggle automatically once the DataManager resolves the user's role.【F:undercroft/workbench/index.html†L74-L124】

### Contextual help system

Help topics live in `../common/data/help-topics.json` and are loaded once via `loadHelpTopics`, which caches the parsed catalog and normalises metadata, titles, and category groupings.【F:undercroft/common/data/help-topics.json†L1-L229】【F:undercroft/common/js/lib/help.js†L1-L73】 `initHelpSystem` scans for elements tagged with `data-help-topic`, injects a tooltip-enabled “?” button that links back to the documentation page, and refreshes Bootstrap tooltips after attachment.【F:undercroft/common/js/lib/help.js†L122-L154】 Icons can be positioned using `data-help-insert` and customised with optional attributes, keeping help affordances declarative in markup.【F:undercroft/common/js/lib/help.js†L97-L151】

### Documentation site

The end-user documentation at `docs/index.html` consumes the same JSON catalog to render a table of contents, grouped topics, and metadata cards.【F:undercroft/workbench/docs/index.html†L1-L99】【F:undercroft/workbench/js/pages/docs.js†L1-L153】 Topic sections generate permalink anchors, include bullet-point deep dives, and expose an “Open in app” button that resolves relative paths to the Workbench entry points.【F:undercroft/workbench/js/pages/docs.js†L37-L111】 Theme toggles reuse the shared controls so the docs stay visually aligned with the tools.【F:undercroft/workbench/docs/index.html†L100-L135】

---

## Tool implementations

### System Editor

`system.html` provides palette, canvas, and inspector panes. Palette cards mirror the schema type definitions declared in `TYPE_DEFS` and feed drag-and-drop insertion handled by `createRootInsertionHandler`.【F:undercroft/workbench/system.html†L170-L236】【F:undercroft/workbench/js/pages/system.js†L43-L132】 The editor initialises the app shell, loads built-in content via `content-registry`, and guards the workspace behind a creator-tier gate.【F:undercroft/workbench/js/pages/system.js†L1-L69】【F:undercroft/workbench/js/pages/system.js†L197-L241】 Inspector interactions edit node metadata, validations, and computed formulas while writing undo entries for each change.【F:undercroft/workbench/js/pages/system.js†L242-L540】 JSON preview and export/import buttons surface the raw schema for debugging.【F:undercroft/workbench/system.html†L237-L305】

### Template Builder

`template.html` reuses the shared shell and exposes a component palette whose entries are defined in `COMPONENT_ICONS` and bound to dropzone handlers from `editor-canvas.js`.【F:undercroft/workbench/template.html†L160-L233】【F:undercroft/workbench/js/lib/component-styles.js†L1-L94】 `template.js` bootstraps the DataManager, hydrates system schemas for binding pickers, and manages undoable canvas mutations through the same root insertion helpers as the system editor.【F:undercroft/workbench/js/pages/template.js†L1-L132】 Properties panels synchronise binding updates with shared helpers like `resolveBindingFromContexts` and serialize layout metadata back to JSON previews for export.【F:undercroft/workbench/js/pages/template.js†L336-L618】 Tier gating restricts save actions to GM-level accounts, matching toolbar affordances.【F:undercroft/workbench/js/pages/template.js†L43-L86】

### Character Sheet

The character page initialises the app shell, loads DataManager session state, and attaches the help system before orchestrating template, system, and character catalogs.【F:undercroft/workbench/js/pages/character.js†L1-L67】 Canvas rendering uses shared component layout utilities and keeps undo stacks per component interaction, while value changes mark the active draft dirty until persisted.【F:undercroft/workbench/js/pages/character.js†L68-L382】 Dice rollers and formulas reuse the shared dice and formula engines, logging results to the game log pane and persisting history across reloads.【F:undercroft/workbench/js/pages/character.js†L21-L40】【F:undercroft/workbench/js/pages/character.js†L383-L629】 Collaboration tooling integrates share links, group membership, and live game log polling through the DataManager and server APIs.【F:undercroft/workbench/js/pages/character.js†L630-L1104】

---

## Server architecture

### HTTP server & routing

`server/app.py` defines a threading HTTP server that hot-reloads config when enabled, wraps a shared `Router`, and falls back to static file serving for unknown routes.【F:server/app.py†L1-L109】 Routes handle health checks, bucket listing, content CRUD, builtin catalog delivery, ownership queries, sharing, and group management. Each handler extracts URL params, enforces authentication with `AuthError`, and serialises JSON responses with consistent status codes.【F:server/app.py†L110-L366】【F:server/app.py†L366-L551】 Static file requests route through `serve_from_root`, letting the prototype serve the Workbench UI without a separate web server.【F:server/app.py†L54-L109】

### Authentication & sessions

`auth.py` encapsulates session persistence, password hashing, email/password updates, tier upgrades, and default user seeding. Helper functions expose login, logout, registration, verification, and retrieval by username or session token.【F:server/auth.py†L1-L249】 `cleanup_sessions` prunes expired tokens, while `ensure_default_admin` and `ensure_default_test_users` keep demo credentials available in development.【F:server/auth.py†L251-L381】 The request handler resolves `Authorization` headers to session users through `get_user_by_session`, which gates downstream handlers.【F:server/app.py†L69-L108】

### Storage layer

`storage.py` initialises SQLite tables for characters, templates, systems, shares, share links, groups, group members, and group logs, complete with indexes for lookup speed.【F:server/storage.py†L1-L121】 File locking utilities guard JSON payload writes across platforms, ensuring content saves remain atomic even under concurrency.【F:server/storage.py†L1-L38】 Storage helpers enforce ownership, update metadata timestamps, list bucket contents, and raise `AuthError` when non-owners attempt restricted operations.【F:server/storage.py†L123-L405】 Share tokens are resolved and touched on access, integrating with the collaboration workflows on the client.【F:server/storage.py†L13-L26】【F:server/storage.py†L266-L360】

### Shares & groups

`shares.py` encapsulates share-link CRUD, unique token generation, and listing shareable users by tier while preventing duplicate relationships.【F:server/shares.py†L1-L180】 `groups.py` provides CRUD for campaign groups, member assignments, and group game logs that back the character sheet’s collaboration panel.【F:server/groups.py†L1-L210】 Both modules rely on DataManager-tier expectations so only owners/admins can modify share state, matching the checks in `ensure_share_permission` inside `app.py`.【F:server/app.py†L219-L338】

### Configuration & runtime state

`config.py` loads `server.config.json`, exposing options such as ports, database paths, and CORS origins, while `state.py` centralises shared resources (config loader, thread pools, loggers) passed into request handlers.【F:server/config.py†L1-L145】【F:server/state.py†L1-L120】 Static asset serving honours the configured project root via `static.py`, so updating client assets requires no server code changes.【F:server/static.py†L1-L74】

---

## Workflows & data flows

### Built-in content

`content-registry.js` reconciles local caches with builtin definitions, verifying assets, surfacing missing content badges, and seeding demos for systems, templates, and characters used across all tools.【F:undercroft/workbench/js/lib/content-registry.js†L1-L261】 UI badges (e.g., “Requires Creator”) update automatically via the access module once the DataManager resolves tier info.【F:undercroft/workbench/index.html†L74-L124】

### Import/export & JSON previews

All editors expose import/export buttons bound to shared helpers. `json-preview.js` renders JSON snapshots into the right pane, while toolbar buttons call into DataManager save operations or download raw payloads using the shared downloader utilities.【F:undercroft/common/js/lib/json-preview.js†L1-L72】【F:undercroft/workbench/system.html†L170-L237】 Character, template, and system toolbars provide consistent undo/redo and clear actions, leveraging the same command wiring through the app shell.【F:undercroft/workbench/template.html†L160-L208】【F:undercroft/workbench/character.html†L18-L103】

### Importer pipeline roadmap

System definitions already reserve an `importers` collection so creators can describe how outside data maps into their schema.【F:undercroft/workbench/js/pages/system.js†L800-L815】【F:undercroft/workbench/data/systems/sys.dnd5e.json†L1-L39】 To turn that placeholder into a working feature we plan to:

1. **Model importer steps.** Extend the system schema so each importer captures a source label, supported file type (initially JSON), the top-level path to iterate over, and an ordered list of field mappings. Each mapping ties a system field path to either a direct JSON pointer or a formula expression evaluated with the existing formula runtime.【F:undercroft/workbench/js/pages/system.js†L1820-L2042】
2. **Surface a builder UI.** Add an “Importers” tab to the System inspector that lists configured importers, lets creators add/edit steps, and reuses the formula autocomplete widget for transformation expressions so field references and helper functions are easy to discover.【F:undercroft/workbench/js/lib/formula-autocomplete.js†L1-L316】
3. **Provide sample-data previews.** Allow creators to paste or upload a JSON example, run it through the importer configuration, and render a diff-style preview of the resulting system payload before saving. The preview flow should log validation errors inline so creators can refine mappings without leaving the modal.
4. **Match advanced transformation needs.** Support chaining formulas per field (e.g., normalising enumerations, splitting strings) and expose helper hooks inspired by the existing D&D Beyond parser so complex conversions stay possible without bespoke scripts.【F:codex/ddb_parser.js†L1-L72】
5. **Integrate with saves and exports.** Persist importer definitions alongside the system so export/import keeps them intact, and surface an “Run importer” command in the toolbar that prompts for JSON input and writes the transformed result into the canvas draft.

This roadmap ensures importers evolve in phases—starting with configuration storage, then UI, then execution—so we can ship incremental value while validating the workflow with real datasets.

### Inventory data modelling plan

Complex inventories (e.g., an equipment table with name, quantity, weight, notes) require richer structure than the current "flat" field definitions. Delivering them touches every layer of the stack, so we will stage the work as follows:

1. **Extend the system schema to describe collections.**
   - Promote `array` fields to carry an `item` contract that mirrors `object` children (e.g., `{ type: "array", key: "inventory", item: { type: "object", children: [...] } }`). The inspector needs UI to add/remove item columns, choose primitive types, mark required columns, and flag a display label column for templates.【F:undercroft/workbench/js/pages/system.js†L816-L866】【F:undercroft/workbench/js/pages/system.js†L2068-L2159】
   - Update field identity helpers (`collectSystemFields`, palette metadata, formula autocomplete) to surface child paths such as `inventory[].quantity` so formulas and bindings understand nested arrays.【F:undercroft/workbench/js/lib/system-schema.js†L1-L143】【F:undercroft/workbench/js/lib/formula-autocomplete.js†L1-L200】

   Array fields now persist this `item` contract in exported systems, and the bundled D&D 5E schema ships with an inline `inventory` table covering Name, Quantity, Weight, and Notes so authors can validate the flow immediately.【F:undercroft/workbench/js/pages/system.js†L816-L866】【F:undercroft/workbench/data/systems/sys.dnd5e.json†L1-L153】

2. **Teach the template editor how to render list layouts from schema metadata.**
   - Give the List component a `sourceBinding` (mirroring Select components) that targets the parent array while the regular `binding` points to a computed selection if needed. When a binding is chosen, pre-fill the column designer from the system `item` contract and allow authors to toggle visibility, override column labels, or add calculated columns (formula-backed, read-only cells).【F:undercroft/workbench/js/pages/template.js†L360-L438】【F:undercroft/workbench/js/pages/template.js†L2560-L2724】
   - Support multiple presentation variants (table, compact list, cards). Table mode should use Bootstrap responsive tables with editable cells, while cards reuse the existing grid preview but map each column to labeled rows inside the card.
   - Persist column settings in the component JSON (e.g., `columns: [{ key: "name", label: "Item", type: "string" }, …]`) so the character sheet renderer can build editors without re-deriving layout each load.

3. **Upgrade the character runtime to handle structured lists.**
   - Replace the JSON textarea renderer for `array` components with a purpose-built collection editor. It should list existing rows, provide add/remove controls, validate cell input against the system column types, and respect read-only or formula-derived columns by preventing edits and showing computed values.【F:undercroft/workbench/js/pages/character.js†L3055-L3101】
   - Ensure persistence writes back an array of objects that matches the system contract and fires undo entries per row edit so the existing history tooling continues to function.【F:undercroft/workbench/js/pages/character.js†L2828-L2891】
   - Extend formula evaluation to expose helper functions for aggregations (e.g., `=sum(@inventory[].quantity)`), enabling summary fields like total weight. This requires the formula engine to understand list iteration and provide guards against undefined rows.

4. **Round out supporting workflows.**
   - Update import/export, JSON previews, and validation to include the new `item` metadata so inventories survive round-trips without manual editing.【F:undercroft/common/js/lib/json-preview.js†L1-L72】
   - Add documentation snippets and starter content (e.g., an SRD-friendly backpack list) so creators can copy a working pattern into their systems and templates.

Phasing the work this way lets us unlock author-friendly inventory tables without regressing simpler lists: the schema gains the expressiveness first, the template editor consumes that structure next, and finally the character UI delivers a polished editing experience.

### Collaboration

Share management flows on the client call `list_shareable_users`, `create_share_link`, and `share_with_user` endpoints while enforcing tier checks via `ensure_share_permission` on the server.【F:server/app.py†L219-L338】 Group game logs persist via `group_log` handlers and surface in the character sheet’s collaboration pane, which polls for new entries and merges them with local drafts.【F:server/app.py†L339-L424】【F:undercroft/workbench/js/pages/character.js†L630-L1104】 Shared help topics now explain these flows directly in the UI via tooltips anchored to game log headers and character selectors.【F:undercroft/workbench/character.html†L40-L119】【F:undercroft/common/js/lib/help.js†L97-L154】

---

## Error handling & diagnostics

Client modules throw descriptive `Error` instances when required dependencies (fetch, storage) are missing, ensuring early failures in unsupported environments.【F:undercroft/workbench/js/lib/data-manager.js†L65-L106】 Server handlers catch `AuthError` and `StorageAuthError`, translating them into HTTP 401/403 responses, while unexpected exceptions log stack traces and return 500s.【F:server/app.py†L68-L208】 Status toasts surfaced through the shared `StatusManager` offer immediate feedback on undo/redo operations, saves, and palette interactions for every tool.【F:undercroft/workbench/js/lib/app-shell.js†L1-L76】【F:undercroft/workbench/js/lib/status.js†L1-L180】 Combined with the documentation site and contextual help, developers and end users now have a unified place to diagnose issues and learn workflows.
