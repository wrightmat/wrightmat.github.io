# Undercroft Workbench UI Style Guide

This document captures the shared layout and styling conventions introduced while building the System Editor. Use these patterns across other Workbench tools to keep the suite visually and structurally consistent.

## Shell Layout

- **App frame (`.workbench-app`)** – Apply to the `<body>` wrapper. It locks the workbench to the viewport height and disables overflow so only the main canvas scrolls.
- **Header (`.workbench-header`)** – Use a sticky, full-width header with `bg-body-tertiary` and a bottom border. Place global controls (pane toggles, auth/theme buttons) here so they stay visible.
- **Shell container (`.workbench-shell`)** – Flex container that holds the left pane, main canvas, and right pane. Keeps overflow hidden so side panes do not create their own scrollbars.
- **Main column (`.workbench-main`)** – The only region that scrolls. Pair with a light background (`bg-body-secondary`) and generous vertical padding so cards float against the canvas.

## Pane Structure

- Wrap each collapsible side pane with the `.workbench-pane` class. This paints the full column with `var(--bs-tertiary-bg)` so the light grey extends from header to footer even when the content is short.
- Inside each pane, nest a `.workbench-pane-content` element that holds the interactive controls. Apply spacing classes (`p-4`, `gap-*`) here so padding sits on top of the grey background.
- Continue to use `.workbench-sidebar` (18rem) and `.workbench-sidebar-lg` (20rem) to size the left and right panes respectively.
- Apply `.workbench-sticky-pane` to the inner container when the pane content should scroll independently. It enforces sticky positioning beneath the header while capping the height to the viewport.
- Pane visibility should still be managed through `data-pane`, `data-pane-toggle`, and the shared `panes.js` helper so toggle buttons update styles consistently.

## Cards, Palette, and Canvas

- Use `shadow-theme` on primary cards so they respect the active theme and share the same elevation behavior.
- Palette entries should remain compact `d-grid` tiles with `shadow-sm`, rounded borders, and iconography from Tabler to communicate field types quickly.
- Canvas cards rely on `.border-dashed` for placeholders and `.hover-lift` for draggable affordances; reuse them when building additional draggable regions.

### Shared drag & drop patterns

- Wire palette lists through `initPaletteInteractions` (see `js/lib/editor-canvas.js`). It attaches SortableJS for drag cloning *and* enables double-click to append the chosen component/field to the bottom of the root canvas.
- Always render empty states with `createCanvasPlaceholder()` so each editor shows the same single-line instruction with a dashed underline.
- Register SortableJS dropzones via `setupDropzones()`. The helper keeps zone teardown consistent and ensures both System and Template editors react to drops the same way.
- Apply the unified canvas card styles: `.workbench-canvas-card` for the shell, `.workbench-canvas-card__header` for the floating control rail, and `.workbench-canvas-card__actions` / `.workbench-canvas-card__type-icon` for the type badge + icon cluster.
- Build card headers through `createStandardCardChrome()` (see `js/lib/canvas-card.js`) so icons, tooltips, and delete buttons stay identical across editors.
- Use `createRootInsertionHandler()` (see `js/lib/root-inserter.js`) to wire palette double-click behavior and root-level appends. The helper standardizes undo logging, status toasts, selection, and inspector expansion across tools.
- When exposing nested drop regions, wrap them with `.workbench-dropzone` and label with `.workbench-dropzone-label` so subsequent tools inherit the same look and feel.

## Toolbar and Actions

- Consolidate pane actions into an icon toolbar with outlined buttons by default. Tooltips (Bootstrap `data-bs-toggle="tooltip"`) provide accessible labels.
- Include a dedicated “Clear canvas” control in that toolbar and mirror the collapsible JSON Preview card in each editor’s tools pane so reset and export workflows stay consistent.
- Highlight active pane toggles by swapping to the filled `btn-secondary` style. The helper in `panes.js` already handles this state change when `data-active="true"` is set.
- Keep undo/redo placeholders sized like the other toolbar buttons so future functionality can drop in without shifting the layout.
- Pair each creation control (New Template/System) with a sibling “Delete” button. Hide it until a record is selected, disable it for built-in content, and confirm before calling the shared DataManager delete helper so every editor removes files locally and remotely in the same way.

## JSON Preview

- Drive preview panes through `createJsonPreviewRenderer()` (see `js/lib/json-preview.js`) so formatting, byte counts, and follow-up hooks (like draft persistence) behave identically across editors.

## Developer Checks

- Run `scripts/check-modules.mjs` before committing changes to Workbench editors. The helper executes `node --check` across the shared libraries and page entry points so duplicate identifier regressions (like the `addComponentToRoot` collisions) are caught immediately.
- Wrap each page module in an IIFE (e.g. `(() => { /* page code */ })();`) so that, even if the browser evaluates the entry script twice, top-level `const` declarations are scoped to the invocation and cannot clash with prior loads.

## Template Authoring

- Require the “Create Template” dialog to include a system selector. Populate it from the shared system catalog (built-in, local, and remote entries) and block creation until the author chooses the backing system so bindings and formulas have a schema target.

## Theme and Surface Colors

- Lean on Bootstrap semantic tokens (`bg-body`, `bg-body-secondary`, `bg-body-tertiary`) instead of hard-coded colors to ensure light/dark theme support.
- Use `border-body-tertiary` on pane separators to keep dividers subtle against the light grey surface.
- Avoid mixing white backgrounds inside the side panes unless a control requires clear contrast (e.g., the JSON preview card). The new `.workbench-pane` background eliminates white gutters above or below pane content.

Keep this guide updated as new tools adopt the layout so cross-tool consistency is easy to maintain.
