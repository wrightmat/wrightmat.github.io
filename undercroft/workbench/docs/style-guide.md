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

## Toolbar and Actions

- Consolidate pane actions into an icon toolbar with outlined buttons by default. Tooltips (Bootstrap `data-bs-toggle="tooltip"`) provide accessible labels.
- Highlight active pane toggles by swapping to the filled `btn-secondary` style. The helper in `panes.js` already handles this state change when `data-active="true"` is set.
- Keep undo/redo placeholders sized like the other toolbar buttons so future functionality can drop in without shifting the layout.

## Theme and Surface Colors

- Lean on Bootstrap semantic tokens (`bg-body`, `bg-body-secondary`, `bg-body-tertiary`) instead of hard-coded colors to ensure light/dark theme support.
- Use `border-body-tertiary` on pane separators to keep dividers subtle against the light grey surface.
- Avoid mixing white backgrounds inside the side panes unless a control requires clear contrast (e.g., the JSON preview card). The new `.workbench-pane` background eliminates white gutters above or below pane content.

Keep this guide updated as new tools adopt the layout so cross-tool consistency is easy to maintain.
