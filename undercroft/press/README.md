# Undercroft Press

Undercroft Press is the printing utility for the Undercroft suite. It uses the
shared Workbench shell (theme controls, collapsible panes, and header actions)
and focuses on print fidelity first, ensuring the on-screen preview matches
printed output for cards and sheets.

## Current State (Epic 3)
- Source-first workflow that mirrors Undercroft Workbench: pick a Source,
  then a Template, then the Size and Orientation it supports.
- D&D Beyond, 5e API (SRD), JSON upload, and manual entry inputs are captured in
  the shell and reflected in the preview labels without altering print output.
- Poker card (3 × 3) and tarot (2 × 2) grids, 5 × 7 notecard, letter sheet, and
  A6 sheet templates with selectable size/orientation where applicable.
- Live overlay toggles for trim lines and safe areas to measure alignment before
  production. Preview labels include the selected source and format for quick
  verification.
- Templates live as JSON in the `templates/` directory using the Workbench-style
  component layout schema and are hydrated into the preview at runtime with
  bundled sample data for each side.
- Drag-and-drop component editing for each side of a template, including a
  palette, sortable layout outline, and component inspector for text, font
  sizing, visibility, and heading level tweaks. Layout edits flow to the live
  preview and print stack in real time.

## Usage
1. Open `index.html` in a browser (served relative to this folder).
2. Expand the left pane to pick a template and see the matching page size and
   supported sides.
3. Use the overlay toggle to show trim and safe areas in both preview and print
   outputs, and use the preview side button to flip between front and back.
4. The preview canvas stays in a light, print-accurate palette regardless of
   the surrounding theme toggles.
4. Press **Print** and choose 100% scaling / Actual Size. Enable double-sided
   printing and flip on the long edge for portrait layouts.

Future epics will introduce multi-source content loading, template catalogs, and
component-level editing consistent with the Undercroft Workbench shell.
