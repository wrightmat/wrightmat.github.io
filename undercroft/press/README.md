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
- Poker card (3 × 3), chip (1-inch circle), and tarot (2 × 2) grids, 5 × 7
  notecard and character notecard, letter sheet, and A6 sheet templates with
  selectable size/orientation where applicable.
- The 5e API source returns the raw dnd5eapi.co response as-is (same as JSON
  Upload) — no reshaping. The generic templates (Poker Card Grid, Chip Grid,
  Tarot Card Grid, Notecard, etc.) bind their repeated items to simple, common
  field names like `@name`/`@description` on purpose, so they're a reasonable
  first thing to try against any source; it's expected that fields specific to
  one shape (e.g. `@features`/`@attacks`, which come from D&D Beyond characters)
  won't resolve against unrelated content like a 5e API spell or background —
  that's fine for quick testing, not every value needs to line up. When a
  template's `repeat` binding doesn't resolve on the loaded data at all, the
  renderer falls back to treating the whole payload as a single card, so the
  preview is never simply blank.
- The 5e API source also handles index-listing endpoints (e.g. `/api/2024/classes`,
  `/api/spells`): instead of erroring, it fetches every linked item's full detail
  (bounded concurrency) and returns them as one array, so a repeat-based template
  prints one card per entry — e.g. all 12 2024 classes in one Generate Print.
- The D&D Beyond source also accepts a `classes`/`backgrounds`/`species` page URL
  (not just a character), since that content has no API — some of it isn't in the
  5e API at all (non-SRD content), and classes/backgrounds/subclasses have no
  documented endpoint. This fetches and parses the actual rendered page via a
  dedicated parser script, `common/ddb-content-parser.js`, kept separate from
  `ddb-parser.js` specifically because it depends on DDB's current page markup
  rather than a stable data contract — if that markup changes, or the
  fetch/parse strategy needs to change, only that one file needs to change. A
  class page's parsed result includes a `subclasses` array (each with its own
  `descLines`/`features`), extracted from the same page rather than needing a
  separate URL per subclass.
  - **Non-free content (most subclasses, several backgrounds/species) requires
    your logged-in D&D Beyond session** — signed out or via a generic proxy,
    DDB only serves the free Basic Rules subset. Fetches go through the shared
    server's `/ddb-proxy` route first (falling back to the public CORS proxy
    used for characters if that route isn't reachable at all), which can
    attach a session cookie you configure **locally, on your own machine only**:
    copy `server/ddb-session.local.json.example` to `server/ddb-session.local.json`
    (already gitignored) and paste in your `CobaltSession` cookie value from
    your browser's DevTools (Application/Storage → Cookies → dndbeyond.com).
    **That cookie grants full account access, not just read access — treat it
    like a password.** It's why this proxy runs server-side and talks directly
    to dndbeyond.com rather than through any third party: the cookie never
    leaves your machine except in that one direct, legitimate request. Expect
    to refresh it occasionally as it expires.
- Two dedicated templates (5e API Spell Card, 5e API Monster Card) bind directly
  to the raw 5e API field names (`@school.name`, `@casting_time`, `@desc.0`,
  `@armor_class.0.value`, `@special_abilities`, etc.) for a well-fitted single-card
  render of a spell or monster lookup.
- Live overlay toggles for trim lines and safe areas to measure alignment before
  production. Preview labels include the selected source and format for quick
  verification.
- The Template Inspector's Formats list can grow beyond the built-in Letter/Legal/
  ISO A/B sizes: the "Add custom size" form (label/width/height, inches) registers
  a new page size at runtime and persists it to `data/custom-page-sizes.json` via
  `POST /press/custom-sizes`, so it's available again after a reload.
- Card and chip grid templates support a `bleed` amount (with its own inspector
  field) and an optional full-bleed
  `background` (color and/or image) per template. Bleed only extends into the
  page margin at the sheet's outer edge or halfway into the gutter between
  neighboring cards — whichever is smaller — so adjacent cards can't overwrite
  each other and nothing runs off the printable page. A dashed bleed guide
  (screen preview only, not printed) shows exactly where each card's bleed
  extends to.
- Page bindings can optionally set the root data scope for each side and control
  repeat bindings for card/chip grids. Leaving the data binding blank keeps the
  full source payload in scope, while repeat bindings target arrays such as
  `@features` or `@attacks`.
- Binding inputs now surface `@` autocomplete suggestions sourced from the
  sample/loaded data, and they accept lightweight formulas prefixed with `=` for
  simple logic and string concatenation.
- Manual Entry accepts pasted JSON matching a template's bindings; leave it
  blank to fall back to the editable Sample Data panel instead (invalid JSON
  shows a clear error rather than silently rendering a blank card).
- When Generate Print loads data whose shape doesn't match the active
  template's `repeat`/`data` bindings (e.g. picking a character template
  right after loading SRD-shaped data), a warning toast flags which root
  fields are missing so it's clear why the preview may look empty.
- A card/chip template's back side can set `"repeat": "same"` to reuse the
  front side's own repeat binding against the same data, guaranteeing
  front[i]/back[i] are the same physical card (rather than two independently
  repeating arrays that may not line up). When a template's front and back use
  different repeat bindings and Generate Print resolves them to different
  lengths, a warning toast flags that fronts and backs won't pair up 1:1.
- Templates live as JSON in the `templates/` directory using the Workbench-style
  component layout schema. When running behind the shared dev server, templates
  are discovered via `/list/press-templates` (so a template saved from the New
  Template flow shows up on reload without editing anything); `templates/index.json`
  is only used as a fallback manifest for static/no-server hosting, or to pin the
  order of pre-existing templates. New templates and edits are saved via
  `POST /press/templates/{id}`, which now creates the file on first save.
  They are hydrated into the preview at runtime with
  raw source data payloads (falling back to the global sample data in
  `data/sample-data.json`, which is editable from the left-pane Sample Data
  section). The JSON Preview panel shows the template with `@` bindings resolved
  against the current raw data.
- List components render arrays directly; when an array item is an object they
  display the `name` field if present, otherwise the first key value.
- A template's `card` geometry (width/height/columns/rows) is shared across every
  Format it declares support for — pick dimensions that fit the smallest
  supported page size, since there's no per-format override yet (tracked in
  `ROADMAP.md`'s Backlog).
- Drag-and-drop component editing for each side of a template, including a
  palette, sortable layout outline, and component inspector for text, image
  URLs, font sizing (XS–XL plus custom points), orientation (vertical, diagonal,
  curved) with curve depth controls, visibility, and text size tweaks.
  Layout edits flow to the live preview and print stack in real time.

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
