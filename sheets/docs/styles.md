# Tailwind Migration Notes

This document tracks the Tailwind utility adoption for the Universal TTRPG Sheets UI.

## Generated Assets

- `sheets/css/tailwind.css` – authoring entry with component presets and utility aliases.
- `sheets/css/generated.css` – committed build artifact supplying the utilities used in development.
- `sheets/css/styles.css` – legacy placeholder kept minimal until remaining bespoke styles are removed.

## Component Mapping

| Legacy Area | Tailwind Replacement |
|-------------|----------------------|
| `.topbar`, `.panes`, `.pane` | `AppShell` layout via `.app-shell`, `.app-header`, `.pane-grid`, `.pane` |
| `.form-row`, `.input`, `.actions` | Tailwind component aliases defined in `tailwind.css` and emitted in `generated.css` |
| `.tree-row`, `.tree-list` | New utility set providing selectable lists for editors |
| `.btn`, `.btn.primary`, `.btn.small` | Utility-backed button tokens shared across editors |

## Completed Follow-ups

- Responsive pane stacking handled via `AppShell` order classes so tree and inspector panels collapse beneath the canvas on smaller viewports.
- Shared `createButton` helper introduced for consistent button styling and aria labelling across runtime and editors.

## Remaining Follow-ups

- Remove any inline layout tweaks from editor scripts once Tailwind utilities cover spacing.
