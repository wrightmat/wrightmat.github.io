# Undercroft Suite Style Guide

This document is the suite-wide source of truth for layout, color, and interaction
conventions across all nine Undercroft tools (Crucible, Forge, Loom, Orrery, Press,
Sanctum, Vault, Workbench) plus the shared `common/` shell. It was originally written
for Workbench's System Editor alone; a full cross-suite audit and standardization
pass brought every other tool in line with (or established new conventions
alongside) what Workbench had already established. Keep this updated as new tools
or patterns are added — it should always describe what the code actually does, not
an aspiration.

## Shared Suite Assets

- **Common shell styles (`undercroft/common/css/shell.css`)** — base UI shell, pane
  scaffolding, status toasts, hover elevation, shared inspector-control styles, and
  layout utilities used by every tool. Always link this stylesheet before a tool's
  own `css/styles.css`.
- **Sortable helpers (`undercroft/common/js/lib/dnd.js`)** — shared SortableJS
  helper for drag-and-drop.
- **JSON preview renderer (`undercroft/common/js/lib/json-preview.js`)** — standard
  preview formatting + byte counter.
- **Collapsible sections (`undercroft/common/js/lib/collapsible.js`)** —
  `bindCollapsibleToggle()`, the shared mechanism for section-level collapse (see
  "Collapsible Sections" below).
- **Copy-to-clipboard (`undercroft/common/js/lib/clipboard.js`)** —
  `bindCopyButton()`, the shared "Copied!" icon/tooltip feedback behavior for any
  copy button.
- **Shared UI factories (`undercroft/common/js/lib/ui-components.js`)** —
  `createIconButton`/`createCollapsibleSection`/`createJsonDataPanel`/
  `createToolbarButtonGroup`, DOM-building functions that compose the behavior
  modules above into the suite's most-repeated markup shapes, so a tool never
  hand-writes that markup itself (see "JSON Data panels" and "Shared UI factories"
  below).
- **Pane toggles (`undercroft/common/js/lib/panes.js`)** — the shared mechanism for
  left/right pane collapse, a distinct job from section collapse (see "Panes" below).
- **Help topics (`undercroft/common/js/lib/help.js` +
  `undercroft/common/data/help-topics.json`)** — the shared contextual-help system
  (see "Help Topics" below).

## Shell Layout

- **App frame (`.workbench-app`)** — apply to the `<body>` wrapper. Locks the tool
  to the viewport height; only the main canvas scrolls.
- **Header (`.workbench-header`)** — sticky, full-width, `bg-body-tertiary` with a
  bottom border. Global controls (pane toggles, auth/theme buttons) live here.
  **Built entirely by JS now, not hand-typed markup**: every page's `<header>...
  </header>` block (pane toggles, tool-switcher mount, auth-control mount, theme
  toggle group — the same ~40 lines that used to be byte-identical across all 12
  pages) is replaced by a single `<div data-app-shell-header></div>` mount point;
  `initAppShell()` (`common/js/lib/app-shell.js`) builds and inserts the real
  `<header>` into it before anything else it does. A new page just needs that one
  mount div, plus (if its left/right pane isn't named "navigation"/"details", the
  suite-wide defaults) `leftPaneLabel`/`rightPaneLabel` options on its own
  `initAppShell({...})` call — see Vault/Crucible/Repository's `settingsSlotAttr`
  option too, for the one variant (a Settings-gear mount in the header's normally-
  empty first grid cell) that isn't a plain spacer. **Caution when adding new code
  that reads a header-internal element** (a pane-toggle button, a settings-slot
  mount): querying it via a module-top-level `const` only works if that line runs
  AFTER `initAppShell()` already has (several real bugs from exactly this ordering
  mistake — a `const` capturing `null` before the header existed yet — were caught
  and fixed during this migration); prefer a live `document.querySelector(...)`
  at the point of use over an eagerly-captured reference, or place the eager query
  provably after the `initAppShell()` call in the same synchronous script.
  Deliberately NOT built this way: the inline theme-flash-prevention `<script>` and
  the CDN `<link>`/`<script>` tags in each page's own `<head>` — both must run/load
  synchronously before first paint, which JS-building them after this module loads
  cannot provide.
- **Shell container (`.workbench-shell`)** — flex container holding the left pane,
  main canvas, and right pane.
- **Main column (`.workbench-main`)** — the only region that scrolls
  (`overflow: auto` is baked into the class itself in `shell.css` — don't add a
  redundant `overflow-auto` utility class alongside it).

## Three-Pane Layout

Every tool follows the same conceptual split: **left pane** is the primary/selection
surface (system picker, generation controls, toolbar), **center pane** is the actual
content (the generated/edited record), **right pane** is the inspector for whatever's
selected in the center.

- Wrap the center `<main>` as:
  `<main class="workbench-main flex-grow-1 p-3 overflow-auto">` (plain — no
  background utility, no centered container wrapper). `.workbench-main` on its own
  already inherits the page's own dark/near-black body background and scrolls
  independently (`overflow: auto` is baked into the class in `shell.css`); cards
  (`card shadow-theme`) sit directly on that background, full-bleed within the pane,
  with `p-3` for tight spacing. This is the original Crucible/Forge/Sanctum/Vault
  design and is now the standard for every tool — including Workbench and Press,
  which previously used a lighter `bg-body-secondary` canvas with a centered
  `container-xl` wrapper; that treatment read as a washed-out grey rather than the
  intended dark surface and was reverted.
  - Tools whose content needs consistent vertical spacing between top-level
    sections (Workbench, Press) add `d-flex flex-column gap-4` directly on `<main>`
    itself rather than introducing a nested wrapper `<div>` — no extra layout layer
    beyond what `<main>` already provides.
- **Named exception: Orrery.** Its `<main>` is a transparent, `pointer-events: none`
  click-through hole over a fixed, full-bleed Leaflet map
  (`orrery/css/styles.css`'s `.orrery-shell`/`#orrery-map` rules) — a full-viewport
  map can't live inside a scrolling flex column, so it carries no padding/background
  utility at all. This is intentional, not an oversight.
- **This applies to every page built on the shared shell, not just the 9 generator
  tools** — the dashboard (`index.html`), the account/admin page
  (`common/account.html`), and the docs browser (`common/docs.html`) all use
  the same `workbench-main` center pane and follow the same plain/dark treatment.
- **Cards always keep their default Bootstrap border — never add `border-0`.**
  Every center-pane card is `class="card shadow-theme"` (or `shadow-sm` for a
  denser nested card, e.g. a repeater item), full stop. A borderless card was a
  recurring one-off mistake (Workbench's Sheet/Notes/toolbar cards, the runtime
  character-sheet renderer's Tabs/Repeater cards, the dashboard's widget cards,
  the account page's admin panel, Loom's tier-gate card, the docs page's cards) —
  grep for `border-0` combined with `card` before adding a new card anywhere in the
  suite; if you find one, remove `border-0`, don't add another.
- Left/right panes: `.workbench-pane` (paints the full column with
  `var(--bs-tertiary-bg)`) wrapping `.workbench-pane-content` (padding/gap classes
  live here, on top of the grey background). Size with `.workbench-sidebar` (18rem)
  or `.workbench-sidebar-lg` (20rem). Apply `.workbench-sticky-pane` to the inner
  container when pane content should scroll independently, sticky beneath the
  header.
- Pane visibility is driven by `data-pane`, `data-pane-toggle`, and `panes.js` — see
  "Panes" below.

## Panes vs. Collapsible Sections

Two different jobs, two different mechanisms — don't mix them:

### Panes (`common/js/lib/panes.js`)

The left/right *pane* collapse (hide the whole sidebar). Config lives in data
attributes on the pane element: `data-pane`, `data-pane-collapsed-class` (usually
`d-none`), `data-pane-expanded-class` (usually `d-flex`), `data-pane-initial`
(`expanded` by default; Press's right pane is the one tool that starts
`collapsed`). The toggle button matches via `data-pane-toggle="<key>"`.
`initPaneToggles()` wires clicks, sets `aria-expanded`, and swaps the toggle button
between `btn-outline-secondary` (collapsed) and `btn-secondary` (expanded/active) —
no icon change. This mechanism is already 100% consistent suite-wide; leave it as
the one deliberately-different case from section collapse below.

### Collapsible Sections (`common/js/lib/collapsible.js`)

Section-level collapse *within* a pane — an icon button that rotates its chevron
(`tabler:chevron-right` collapsed → `tabler:chevron-down` expanded) via
`bindCollapsibleToggle(toggle, panel, { collapsed, expandLabel, collapseLabel,
labelElement })`. Markup:

```html
<button class="btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center collapsible-toggle"
        type="button" data-your-toggle aria-expanded="true">
  <span class="iconify" data-icon="tabler:chevron-down" aria-hidden="true"></span>
  <span class="visually-hidden" data-your-toggle-label>Collapse whatever</span>
</button>
...
<div data-your-panel>...</div>
```

This is now the *only* mechanism used for this job across the whole suite. If you
need programmatic (not just click-driven) control, capture `bindCollapsibleToggle`'s
return value — it's an `apply(collapsed)` function — rather than reaching for
`bootstrap.Collapse` directly.

### JSON Data panels — built via `createJsonDataPanel`, not hand-written markup

**Superseded convention, kept below crossed out only for history — do not follow
it.** ~~JSON Preview sections used a plain link-style toggle (`pane-card` +
`btn-link` + raw Bootstrap `data-bs-toggle="collapse"`), deliberately distinct from
the icon-button collapsible pattern above.~~ That produced a visibly different
outline/dark-background look from every other collapsible section in the suite and
was replaced suite-wide: JSON panels now use the *same* `collapsible-toggle`
icon-button pattern as everything else, generated by the shared factory instead of
typed out by hand in each tool's `index.html`.

```js
import { createJsonDataPanel } from "../../common/js/lib/ui-components.js";

const jsonPanel = createJsonDataPanel({
  label: "JSON Data",           // heading text; always "JSON Data", not "JSON Preview"
  helpTopic: "tool.jsonPreview", // optional — omit if the section has no help entry
  getData: () => buildRecordPayload(),
});
document.querySelector("[data-tool-json-mount]")?.appendChild(jsonPanel.section);
// jsonPanel.render() replaces the old direct updateJsonPreview(...)/
// createJsonPreviewRenderer(...) call site — call it anywhere the underlying
// record changes, exactly like the renderer it wraps.
```

`index.html` shrinks to a single mount point:

```html
<div class="mt-auto" data-tool-json-mount></div>
```

`createJsonDataPanel` composes three already-shared behavior modules — it doesn't
reimplement any of them: `collapsible.js`'s `bindCollapsibleToggle` (the chevron
toggle), `clipboard.js`'s `bindCopyButton` (the Copy button, with "Copied!"
icon/tooltip feedback), and `json-preview.js`'s `createJsonPreviewRenderer` (the
readonly textarea render + live byte-size tooltip on the Copy button — there is no
separate size badge anymore; the byte count lives in the Copy button's own tooltip,
e.g. "Copy to clipboard (1.2 KB)"). The rendered textarea uses the shared
`.json-preview-text` class (`common/css/shell.css`) for its font size — pass `rows`
to `createJsonDataPanel` for a taller/shorter panel rather than adding a modifier
class.

Every JSON panel in the suite (Crucible, Forge, Vault, Loom, Orrery, Press, Sanctum,
Workbench's Template *and* Character views) is built this way, and is always the
last section in its pane. Press's Sample Data section (a JSON-paste-in, not a
read-only preview) follows the same visual/markup convention via
`createCollapsibleSection` directly rather than `createJsonDataPanel` (its textarea
is editable, not readonly) — do not confuse it with Loom's separate "Sample Raw
Data" mapping-import feature, which is an unrelated tool and untouched by any of
this.

For the lower-level building blocks this factory is built from —
`createIconButton`/`createCollapsibleSection`/`createToolbarButtonGroup`, all in
`common/js/lib/ui-components.js` — see "Shared UI factories" below.

### Shared UI factories (`common/js/lib/ui-components.js`)

The other two generic factories this module exports, used directly (not just via
`createJsonDataPanel`):

- **`createIconButton({ icon, label, variant, kind, tooltipPlacement, attrs,
  onClick })`** — the tooltipped icon button. `kind` picks one of the two
  established shapes: `"compact"` (default — small inline actions like a JSON
  copy button or collapsible chevron: `btn-sm`, tooltip on top, aria-label only)
  or `"toolbar"` (left-pane action toolbars: `p-2`, `fs-5` icon, tooltip on
  bottom, plus a visually-hidden label span alongside aria-label — see "Toolbar
  Buttons" below). `label` drives the tooltip title *and* `aria-label` (and, for
  `kind: "toolbar"`, the visually-hidden span) in one place, so they can never
  drift out of sync the way copied markup sometimes does.
- **`createToolbarButtonGroup([{ action, label, icon, variant, onClick, visible,
  disabled, primary }, ...])`** — a left-pane action toolbar cluster, always
  built with `kind: "toolbar"`. `action` (`"undo"`/`"redo"`/`"new"`/`"generate"`/
  `"import"`/`"save"`/`"export"`/`"print"`/`"rename"`/`"duplicate"`/`"delete"`)
  picks the right icon + color from the "Toolbar Buttons" table below
  automatically; anything else falls back to plain `outline-secondary`. Pass
  `icon`/`variant` to override a preset's default for one tool-specific case
  (e.g. Repository's Duplicate Page is `outline-secondary`, not the preset's
  usual `outline-success`). Pass `primary: true` on the one button that's "this
  tool's one true primary activity" (e.g. Crucible's Generate, Press's Print)
  to get the filled `btn-primary` variant instead of the outline.
- **`createCollapsibleSection({ label, id, collapsed, actions, helpTopic,
  content, className, panelClassName, autoBindToggle })`** — see "Collapsible
  Sections" above for the full markup shape this replaces. `content` is either
  an existing DOM node (adopted wholesale via `appendChild` — the standard way
  to migrate a section whose own content is hand-authored form markup you
  don't want to move into JS: query it with `document.querySelector` while
  it's still in its original static location, then pass it straight in) or a
  builder function `(panel) => Node|void`. `actions` are extra
  `createIconButton`-shaped configs rendered before the chevron (e.g. a Copy
  button) — their built nodes come back as `actionButtons`. **`autoBindToggle`
  defaults to `true`** (the toggle click auto-flips the panel, matching
  `bindCollapsibleToggle`'s normal behavior) — set it `false` when the caller
  needs fully custom click behavior (a gated toggle, or one that triggers a
  re-render on expand, e.g. Workbench Character view's Group Share section).
  **Do not try to "intercept and veto" the auto-bound click with a second
  listener on the same toggle instead** — per the DOM spec, listeners
  registered on the event's own target fire in registration order regardless
  of the `capture` flag (capture-vs-bubble ordering only affects *ancestor*
  nodes during the capturing/bubbling phases), so a later listener can never
  pre-empt an earlier one on the identical element; `autoBindToggle: false`
  is the correct mechanism, not a `capture: true` + `stopImmediatePropagation`
  listener stacked after it.

Each factory returns a real, already-wired DOM node (or array of nodes) —
`.appendChild()` it into a mount point. No custom elements, no attribute-driven
auto-init to reverse-engineer. Prefer these over hand-writing the equivalent markup
for any *new* instance of these patterns; migrating old ones is a mechanical,
lower-priority cleanup, not something to hold up unrelated work for.

### Canvas-card collapse (Workbench only) — an intentional visual variant

`.canvas-collapse-toggle` (`workbench/css/styles.css`, driven by
`workbench/js/lib/canvas-card.js`) is a compact, pill-shaped icon button used for
collapsing individual template-component cards on the canvas. It stays visually
distinct from `.collapsible-toggle` — canvas cards are a genuinely denser context
(many small cards, each with its own delete/duplicate/collapse control rail) — but
follows the same interaction language: chevron-right closed, rotated open.

## Toolbar Buttons

**Order** (left → right), using only the slots a given toolbar actually needs:

> Undo, Redo → New/Add/Generate → Import → Save → Export → Print → Rename →
> Duplicate → Delete

**Button count:** a single toolbar cluster shouldn't grow past six buttons —
confirmed real problem past that point: Workbench's left-pane toolbar started
wrapping/scrolling once a seventh (Re-import) was added. Hitting the limit
means designing an alternative *with the user* — a secondary toolbar, moving
the new action to a more relevant location instead (a full-text button in
whatever card it actually belongs to, as Re-import's own move to the
Character card did), a dropdown of less-common actions, etc. — never just
letting the cluster keep growing past six.

**Color:**

| Role | Class | Notes |
|---|---|---|
| Undo/Redo, Import, Export, Print, Rename | `btn-outline-secondary` | neutral |
| New/Add/Generate | `btn-outline-primary` | blue — most New/Generate actions in this suite already function as their toolbar's primary activity, so the whole family reads as blue rather than green |
| New/Add/Generate **when it's the tool's one true primary activity** | `btn-primary` | Crucible/Forge/Vault/Sanctum's "Generate", Press's "Print" — filled (still blue, no color change from the plain-outline case above), and moved to the front of the toolbar (right after Undo/Redo) |
| Save, Duplicate | `btn-outline-success` | "other object actions" — green |
| Delete, and bulk-destructive actions (e.g. "Clear canvas") | `btn-outline-danger` | always rightmost |

All toolbar buttons are icon-only with a visually-hidden label + Bootstrap tooltip:

```html
<button class="btn btn-outline-secondary p-2" type="button" data-action="..."
        data-bs-toggle="tooltip" data-bs-placement="bottom" data-bs-title="Label"
        aria-label="Label">
  <span class="iconify fs-5" data-icon="tabler:..." aria-hidden="true"></span>
  <span class="visually-hidden">Label</span>
</button>
```

Never mix in a visible text label — this part was already 100% consistent
suite-wide and should stay that way.

## Inspector / Property Panel Field Order

Any "select an item → edit its properties" panel (Workbench's Component Inspector
and Template Properties, Loom's System Property row editor, Orrery's marker
inspector) follows this order:

> **Identity** (identifier/key, then label/name) → **Type** → **Data/Binding/Source**
> → *component-specific fields* → **Appearance** (Colors: Text, Foreground (only
> for types with a genuine fill concept separate from their text — e.g. Toggle),
> Background, Border → Label position → Text size → Text style → Alignment) → **Behavior**
> (visibility/collapsible/read-only flags — always last, isolated from value
> fields)

Press's Component Inspector (`press/index.html`) is the reference example for the
"many possible fields" case — its fixed markup order already broadly follows
Content → Layout/Position → Appearance → Behavior → Advanced and wasn't
restructured (high risk, low incremental value for a 1600-line inspector).

## nav-tabs for View Switchers

Any top-level "switch what the center/main pane shows" control uses real Bootstrap
`nav-tabs`, not `nav-pills` or a custom button row:

```html
<ul class="nav nav-tabs" role="tablist" data-your-view-tabs>
  <li class="nav-item" role="presentation">
    <button class="nav-link active" type="button" role="tab" data-your-view-tab="...">Label</button>
  </li>
</ul>
```

Examples: Workbench's Template/Edit/Play switcher, Press's Live Preview/Grid View
switcher, Loom's Import/Library/Systems/Users/Groups switcher, the account page's
Account settings/Owned content switcher.

## Help Topics Over Inline Comments

Explanatory/conceptual text that a user would benefit from reading on demand — not
runtime-generated state — goes through the help-topic system instead of a
hardcoded `<p>`:

```html
<h2 class="...">
  <span>Section Name</span>
  <span class="align-middle" data-help-topic="tool.topicId" data-help-insert="replace"></span>
</h2>
```

For content generated dynamically (a section that only exists once something's
selected), build the same badge in JS and re-scan it into the help system:

```js
const help = document.createElement("span");
help.className = "align-middle";
help.dataset.helpTopic = "tool.topicId";
help.dataset.helpInsert = "replace";
container.appendChild(help);
initHelpSystem({ root: container }); // scoped re-scan — safe to call repeatedly
```

Add the actual topic content to `common/data/help-topics.json` (id, title, summary,
category, `details[]`, href pointing at an anchor on the tool's own page —
`../tool/index.html#some-section-id`). Match the tone of neighboring topics for the
same tool: a one-sentence, em-dash-structured summary, then 2–4 concrete detail
bullets — not generic UI-label restatement.

**Do NOT convert:** empty-state / placeholder text that gets replaced by real
content once something loads or is selected ("Select a node to edit its
properties.", "No mapped output yet.", "No custom properties yet.") — that's
runtime-generated content, not "random comments," and converting it would remove
the actual state signal it provides.

**Every `data-help-topic` reference in markup must have a matching entry in
`help-topics.json`.** A missing one fails silently (`help.js` logs a console
warning and leaves an empty, icon-less span) — there's no visual indication in the
UI itself that a badge is broken, so this is easy to miss. Check the browser
console after adding a new badge.

## CSS Organization

- **Shared, cross-tool rules live in `common/css/shell.css`.** Consolidations worth
  knowing about as precedent for future ones:
  - `.template-color-grid` / `.template-color-control` / `.template-radio-group`
    (inspector color-swatch and radio-button-group controls) — previously
    duplicated near-verbatim in `workbench/css/styles.css` and
    `press/css/styles.css`, and both were loaded on the same page at once
    (Workbench directly links `press/css/styles.css` for its spotlight card).
    Base rules now live in `shell.css`; each tool keeps only its own real modifier
    (`.template-radio-group--single-row` in Workbench,
    `.template-radio-group--nowrap` and the 3-column `.template-color-grid`
    override in Press).
  - `.json-preview-text` — replaces three near-identical tool-prefixed classes
    (`.workbench-json-preview`, `.press-json-preview`, `.orrery-json-preview`)
    that had drifted to slightly different font sizes. Settled on 0.65rem (the
    majority value); a tool can still add its own modifier class alongside it for
    genuinely different behavior (Orrery's `max-height`/`overflow`).
  - `.template-linear-track*` / `.template-circular-track*` / `.template-select-tags`
    / `.template-select-tag` / `.template-toggle-shape*` — segmented/circular
    progress widgets, tag-pill toggles, and shape-fill toggles. Moved from
    Workbench so a Press-rendered card (or any future tool) can render the same
    visual identity a template component already knows how to draw, instead of
    reinventing it. These are genuinely component-driven (the component's own
    `shape`/`variant`/`color` config selects the class), not hardcoded per
    instance — that was already true before the move, the move just makes the
    primitive reusable.
  - The dropzone family (`.template-dropzone`/`.workbench-dropzone`,
    `.workbench-drop-placeholder*`, `.template-dropzone-label`/
    `.workbench-dropzone-label`, `.template-container-grid`/
    `.template-container-zone`) — moved from Workbench, kept dual-classed under
    both names rather than renamed so no call site needed to change.
  - `.text-shadow-dark` / `.text-shadow-light` — the text-shadow analog to
    Bootstrap's box-shadow-only `.shadow-*` utilities. Moved from Press; the
    header's own `.undercroft-tool-trigger-label` now shares the same value via
    the `--undercroft-text-shadow-dark` custom property instead of hardcoding a
    near-duplicate rgba a second time.
  - `.circle` — a small circular marker/dot (e.g. a saving-throw proficiency
    indicator). Moved from Press so any rendered template can reuse it.
- **Tool-specific rules stay in the tool's own `css/styles.css`** when they're
  genuinely local — Loom's node/pipeline-tree mini design system
  (`.loom-node`/`.loom-step`/etc.), Orrery's map/layer/marker positioning, Press's
  print/page/card rendering. Don't promote something to `shell.css` just because it
  *could* be shared — promote it when it's actually duplicated or genuinely
  conceptually suite-wide (an inspector control, not "this tool's map").
- Before adding a new tool-local class, grep the other 8 tools' stylesheets for
  something that already does the same job.
- **Naming**: existing tool-specific classes are already reasonably scoped by
  domain vocabulary (`press-*` for most of Press's own chrome; `card-*`/`guide-*`/
  `chip-*`/`page-*` for its print domain; `character-*`/`dice-*`/`game-log-*` for
  Workbench's play-mode widgets) and none of them collide with anything elsewhere
  in the suite — a full mass-rename pass wasn't needed. Apply the "prefix with the
  tool name" rule when a *new* class's purpose isn't already obvious/collision-safe
  from its own name, not retroactively to names that already are.
- **Check for dead CSS before assuming something needs promoting or renaming.**
  Press's ~170-line "Character notecard template styles" block
  (`.ability-block`, `.stat-0`–`.stat-5`/`.str`–`.cha`, `.p1`/`.p3`/`.p4`,
  `.section`/`.heading`, `.skill`/`.skill-row`, `.item-list`) turned out to have
  zero references anywhere in shipped JS or template JSON — a verbatim copy-paste
  from an unrelated legacy tool's stylesheet that was never wired into Press's
  actual component system. It was deleted outright rather than migrated. The live
  character-notecard template already assigns ability-score colors via inline
  `style.color` per component — i.e. the "this should be component-level, not
  global CSS" instinct was already how the real template worked; the dead CSS was
  just unused weight sitting next to it. `shell.css` had its own small case of this
  too: `.dashboard-widget-card.sortable-ghost`/`.sortable-chosen` were unreachable
  since `common/js/lib/dnd.js`'s actual drag-state classes are Bootstrap's own
  `.opacity-50`/`.border-primary`. Before promoting or renaming a class, confirm
  it's actually referenced (grep JS *and* `common/data/template/*.json`, since a
  class name can be load-bearing in stored template data without appearing in any
  JS file) rather than assuming its presence in a stylesheet means it's live.

## Developer Checks

- Run `scripts/check-modules.mjs` before committing changes to Workbench editors —
  it runs `node --check` across shared libraries and page entry points to catch
  duplicate-identifier regressions.
- Wrap each page module in an IIFE (`(() => { /* page code */ })();`) so a
  double-evaluated script doesn't clash on top-level `const` declarations.
- After editing shared markup (toolbars, collapsible sections, nav-tabs), verify
  in a real browser — a missing `.collapsible-toggle` class or wrong data attribute
  produces no build error, just a chevron that silently never rotates.

## Template Authoring

- Require the "Create Template" dialog to include a system selector, populated
  from the shared system catalog (built-in, local, and remote entries); block
  creation until a system is chosen so bindings/formulas have a schema target.

## Theme and Surface Colors

- Use Bootstrap semantic tokens (`bg-body`, `bg-body-secondary`,
  `bg-body-tertiary`) instead of hard-coded colors for light/dark theme support.
- Use `border-body-tertiary` on pane separators to keep dividers subtle against the
  light-grey surface.
- Avoid white backgrounds inside side panes unless a control specifically needs
  contrast (e.g. the JSON Preview card) — `.workbench-pane`'s background already
  removes white gutters above/below pane content.
