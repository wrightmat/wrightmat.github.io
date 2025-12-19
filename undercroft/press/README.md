# Undercroft Press

Undercroft Press is the printing utility for the Undercroft suite. It uses the
shared Workbench shell (theme controls, collapsible panes, and header actions)
and focuses on print fidelity first, ensuring the on-screen preview matches
printed output for cards and sheets.

## Current State (Epic 4)
- Source-first workflow that mirrors Undercroft Workbench: pick a Source,
  then a Template, then the Size and Orientation it supports.
- D&D Beyond, 5e API (SRD), JSON upload, and manual entry inputs are parsed into
  live source payloads when Generate Print is used, replacing placeholder data
  inside the preview and print stack.
- Poker card (3 × 3) and tarot (2 × 2) grids, 5 × 7 notecard, letter sheet, and
  A6 sheet templates with selectable size/orientation where applicable.
- Live overlay toggles for trim lines and safe areas to measure alignment before
  production. Preview labels include the selected source and format for quick
  verification.
- Templates live as JSON in the `templates/` directory using the Workbench-style
  component layout schema and are hydrated into the preview at runtime with
  source data payloads (falling back to bundled sample data when needed).
- Drag-and-drop component editing for each side of a template, including a
  palette, sortable layout outline, and component inspector for text, font
  sizing, visibility, and heading level tweaks. Layout edits flow to the live
  preview and print stack in real time.

## Usage
1. Open `index.html` in a browser (served relative to this folder).
2. Use the Selections card above the preview to pick a Source, Template, Size,
   and Orientation.
3. Enter the URL/ID/JSON file as needed, then press **Generate Print** to load
   live data into the selected template.
4. Use the overlay toggle to show trim and safe areas in both preview and print
   outputs, and use the preview side button to flip between front and back.
5. The preview canvas stays in a light, print-accurate palette regardless of
   the surrounding theme toggles.
6. Press **Print** from the left toolbar and choose 100% scaling / Actual Size.
   Enable double-sided printing and flip on the long edge for portrait layouts.

Future epics will refine the template catalog, palette constraints, and UX
polish needed for full Scriptorium parity.
