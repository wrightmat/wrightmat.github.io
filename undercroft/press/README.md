# Undercroft Press

Undercroft Press is the printing utility for the Undercroft suite. It uses the
shared Workbench shell (theme controls, collapsible panes, and header actions)
and focuses on print fidelity first, ensuring the on-screen preview matches
printed output for cards and sheets.

## Current State (Epic 1)
- US Letter surfaces (8.5in × 11in) with 0.25in margins for trimming safety.
- Poker card grid (3 × 3) with paired front/back faces for duplex alignment.
- Letter character spread with a notes back page to validate long-edge flips.
- Live overlay toggles for trim lines and safe areas to measure alignment before
  production.

## Usage
1. Open `index.html` in a browser (served relative to this folder).
2. Expand the left pane to pick a template and see the matching page size and
   supported sides.
3. Use the overlay toggle to show trim and safe areas in both preview and print
   outputs, and use the preview side button to flip between front and back.
4. Press **Print** and choose 100% scaling / Actual Size. Enable double-sided
   printing and flip on the long edge for portrait layouts.

Future epics will introduce multi-source content loading, template catalogs, and
component-level editing consistent with the Undercroft Workbench shell.
